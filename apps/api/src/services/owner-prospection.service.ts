import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerProspectionCanal,
  OwnerProspectionQuery,
  OwnerProspectionResponse,
} from "@ecoledigitale/contracts";
import { CLE_NOM_DE_CLASSE_SQL, anneeDe } from "./owner-pro-annee.sql";
import {
  OUVERTURES_CTE,
  OUVERTURES_PERIMETRE_CTE,
  COMMANDES_PERIMETRE_CTE,
} from "./owner-perimetre.sql";

/**
 * Prospection — lecture propriétaire (migration `0120_prospection_commerciaux.sql`).
 *
 * L'administration a ses écrans d'exploitation (`/professionnel/admin/prospection`) :
 * saisir une provenance, tenir les commerciaux, régler une commission ligne à
 * ligne. Ce service ne les double pas. Il répond à ce qu'un fondateur demande :
 * d'où viennent les étudiants, quel canal rapporte, et combien coûtent les
 * commerciaux.
 *
 * TROIS DÉCISIONS QUI GOUVERNENT TOUS LES CHIFFRES
 *
 * 1. L'ASSIETTE EST LA LIGNE « SCOLARITÉ » DU BARÈME — commandes de nature
 *    `ue` ou `scolarite`, paiements confirmés, commandes non annulées. C'est
 *    mot pour mot celle de `prospection.service.ts` : les deux écrans doivent
 *    dire le même montant, sans quoi le propriétaire et son administration
 *    négocient avec deux vérités. Les frais d'inscription et les frais annexes
 *    n'ouvrent aucune commission ; la conduite (`transversal`) n'est pas
 *    facturée du tout.
 *
 * 2. LA COMMISSION N'EST PAS STOCKÉE, elle se recalcule paiement par paiement
 *    (montant × taux figé sur la fiche de l'étudiant), l'arrondi étant fait
 *    ligne à ligne comme au règlement. Seul le FAIT d'avoir réglé est stocké,
 *    dans `commissions_versements.payment_id`.
 *
 * 3. LE PÉRIMÈTRE DATE L'ÉTUDIANT, PAS LA COMMANDE. Un filtre d'année retient
 *    les étudiants dont une ouverture de classe commence cette année-là, puis
 *    compte TOUT ce qu'ils ont payé — même deux ans plus tard. C'est le seul
 *    découpage possible ici, et il se trouve être aussi le bon :
 *      * possible, parce que dater la commande via `PRO_ORDER_DATES_CTE` passe
 *        par `professional_enrollments` — or les commandes de nature
 *        `scolarite` (le complément de barème) n'ont AUCUNE inscription, donc
 *        aucune date. Elles disparaîtraient silencieusement de l'assiette, et
 *        la commission affichée au propriétaire serait inférieure à celle que
 *        l'administration règle ;
 *      * bon, parce qu'une commission rémunère un ÉTUDIANT AMENÉ. Le
 *        commercial qui l'a amené en 2023 touche encore sa part en 2025 : ce
 *        coût appartient à la cohorte 2023, qui l'a engendré.
 *    Les libellés de l'écran le disent en toutes lettres.
 */

/** Profondeur maximale du classement des commerciaux affiché. */
export const OWNER_PROSPECTION_MAX_COMMERCIAUX = 25;

/** Seuil en deçà duquel la répartition par canal est annoncée non représentative. */
export const OWNER_PROSPECTION_COUVERTURE_MIN = 50;

async function safeQuery<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<T[]> {
  try {
    const r = await client.query<T>(sql, params);
    return r.rows;
  } catch (e) {
    log.warn({ err: e, label }, "owner prospection query failed");
    return [];
  }
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const int = (v: unknown): number => Math.trunc(num(v));

/** Pourcentage arrondi au dixième. `null` quand le dénominateur est nul. */
function pct(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round((part * 1000) / total) / 10;
}

/**
 * Rattachement (étudiant, filière, année) — même UNION que `owner-personnes`,
 * pour que « la filière Transport en 2024-2025 » désigne les mêmes étudiants
 * d'un écran propriétaire à l'autre.
 *
 * $1 tenant.
 */
const STUDENT_FILIERE_CTE = `
  student_filiere AS (
    /*
       La branche professionnelle porte la CLÉ DE CLASSE de son ouverture :
       sans elle, le filtre « nom de classe » n'agissait que sur l'argent, et
       l'écran annonçait quatre étudiants sur une classe qui n'existe pas.
       L alias de l UE est ue et non u : c est celui qu attend le fragment
       partagé — une seule définition du nom de classe pour toute l'application.
    */
    SELECT pe.student_id, ue.filiere_id, ${anneeDe("s.date_debut")} AS annee,
           ${CLE_NOM_DE_CLASSE_SQL} AS cle_classe
      FROM professional_enrollments pe
      JOIN professional_ue_sessions s
        ON s.id = pe.ue_session_id AND s.tenant_id = pe.tenant_id
      JOIN professional_ue ue
        ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
     WHERE pe.tenant_id = $1::uuid
       AND pe.statut <> 'annulee'
       AND ue.filiere_id IS NOT NULL
       AND s.date_debut IS NOT NULL
    UNION
    /* La scolarité classique n'a pas d'ouverture, donc pas de nom de classe. */
    SELECT se.student_id, cl.programme_id AS filiere_id, ay.name AS annee, NULL::text
      FROM student_enrollments se
      JOIN classes cl ON cl.id = se.class_id AND cl.tenant_id = se.tenant_id
      LEFT JOIN academic_years ay
        ON ay.id = se.academic_year_id AND ay.tenant_id = se.tenant_id
     WHERE se.tenant_id = $1::uuid
       AND se.status = 'active'
       AND cl.programme_id IS NOT NULL
  )`;

/**
 * Étudiants du périmètre.
 * $1 tenant, $2 anneeScolaire (text | null), $3 filiereIds (uuid[] | null).
 *
 * AUCUN FILTRE DE STATUT, contrairement aux écrans d'effectifs. Une commission
 * reste due sur un étudiant parti, et l'argent qu'il a versé a bien été
 * encaissé : l'écarter ferait fondre une dette qui, elle, ne fond pas.
 *
 * Requiert STUDENT_FILIERE_CTE en amont.
 */
const STUDENT_SCOPE_CTE = `
  student_scope AS (
    SELECT sp.id
      FROM student_profiles sp
     WHERE sp.tenant_id = $1::uuid
       AND (
         ($2::text IS NULL AND $3::uuid[] IS NULL AND $4::text IS NULL)
         OR EXISTS (
           SELECT 1 FROM student_filiere f
            WHERE f.student_id = sp.id
              AND ($3::uuid[] IS NULL OR f.filiere_id = ANY($3::uuid[]))
              AND ($2::text IS NULL OR f.annee = $2::text)
              AND ($4::text IS NULL OR f.cle_classe = $4::text)
         )
       )
  )`;

/**
 * Scolarité encaissée — assiette de la commission.
 *
 * DATÉE PAR LA COMMANDE, PAS PAR L'ÉTUDIANT. Ce CTE joignait `student_scope` :
 * tout paiement d'un étudiant appartenant au périmètre y entrait, quelle que
 * soit l'année de la commande payée. Un étudiant inscrit deux années de suite
 * appartient aux deux périmètres, et ses versements étaient donc comptés DEUX
 * FOIS — une fois par année. La commission acquise était doublée sur les
 * pluriannuels.
 *
 * Le socle (`commandes_perimetre`) date la commande par l'ouverture qu'elle
 * finance : un versement n'appartient plus qu'à un exercice.
 *
 * Requiert le socle de périmètre. $1 tenant.
 */
const PAIEMENTS_CTE = `
  paiements_par_etudiant AS (
    SELECT po.student_id,
           COALESCE(SUM(pp.montant), 0)::float8 AS total_paye
      FROM professional_payments pp
      JOIN professional_orders po
        ON po.id = pp.order_id AND po.tenant_id = pp.tenant_id
      JOIN commandes_perimetre cp ON cp.order_id = pp.order_id
     WHERE pp.tenant_id = $1::uuid
       AND pp.statut = 'confirme'
       AND po.statut <> 'annulee'
       AND po.nature IN ('ue', 'scolarite')
     GROUP BY po.student_id
  )`;

/**
 * Une ligne par PAIEMENT de scolarité ouvrant droit à commission, avec son
 * état de règlement. Maille de référence du module depuis la migration 0125 —
 * reprise telle quelle pour que le solde lu ici soit celui que l'administration
 * règle.
 *
 * MÊME CORRECTION QUE L'ASSIETTE : la ligne se rattache au périmètre par sa
 * COMMANDE, non par la présence de l'étudiant. Voir `paiements_par_etudiant`.
 *
 * Requiert le socle de périmètre. $1 tenant.
 */
const LIGNES_CTE = `
  lignes_commission AS (
    SELECT pp.id AS payment_id,
           prov.commercial_id,
           prov.student_id,
           pp.paid_at,
           pp.montant::float8 AS montant_scolarite,
           ROUND((pp.montant * prov.taux_commission / 100)::numeric)::float8 AS commission,
           EXISTS (
             SELECT 1 FROM commissions_versements cv
              WHERE cv.payment_id = pp.id AND cv.tenant_id = pp.tenant_id
           ) AS reglee
      FROM professional_payments pp
      JOIN professional_orders po
        ON po.id = pp.order_id AND po.tenant_id = pp.tenant_id
      JOIN student_provenances prov
        ON prov.student_id = po.student_id AND prov.tenant_id = pp.tenant_id
       AND prov.canal = 'commercial'
      JOIN commandes_perimetre cp ON cp.order_id = pp.order_id
     WHERE pp.tenant_id = $1::uuid
       AND pp.statut = 'confirme'
       AND po.statut <> 'annulee'
       AND po.nature IN ('ue', 'scolarite')
  )`;

/**
 * Arrivée de l'étudiant : début de la première ouverture qu'il suit DANS LE
 * PÉRIMÈTRE. Restreindre par les mêmes filtres que le périmètre évite qu'un
 * écran filtré sur 2025-2026 trace des arrivées en 2023.
 *
 * $1 tenant, $2 année, $3 filières. Requiert STUDENT_SCOPE_CTE.
 */
const ARRIVEES_CTE = `
  arrivees AS (
    SELECT pe.student_id, MIN(s.date_debut) AS arrivee
      FROM professional_enrollments pe
      JOIN professional_ue_sessions s
        ON s.id = pe.ue_session_id AND s.tenant_id = pe.tenant_id
      JOIN professional_ue u
        ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
      JOIN student_scope ss ON ss.id = pe.student_id
     WHERE pe.tenant_id = $1::uuid
       AND pe.statut <> 'annulee'
       AND s.date_debut IS NOT NULL
       AND ($2::text IS NULL OR ${anneeDe("s.date_debut")} = $2::text)
       AND ($3::uuid[] IS NULL OR u.filiere_id = ANY($3::uuid[]))
     GROUP BY pe.student_id
  )`;

/** Commission acquise, agrégée par étudiant. Requiert LIGNES_CTE. */
const COMMISSION_PAR_ETUDIANT_CTE = `
  commission_par_etudiant AS (
    SELECT student_id,
           COALESCE(SUM(commission), 0)::float8 AS acquise
      FROM lignes_commission
     GROUP BY student_id
  )`;

/*
   Le socle de perimetre precede les deux CTE d argent, qui le consomment.

   Il n est PAS place avant student_scope : celui-la repond a une autre
   question — ou l etudiant a-t-il ete present — et garde sa propre datation.
   Les deux cohabitent dans la meme requete, chacun sur son objet.
*/
const BASE_CTES = [
  STUDENT_FILIERE_CTE,
  STUDENT_SCOPE_CTE,
  OUVERTURES_CTE,
  OUVERTURES_PERIMETRE_CTE,
  COMMANDES_PERIMETRE_CTE,
  PAIEMENTS_CTE,
  LIGNES_CTE,
].join(",\n");

const CANAUX_CONNUS = [
  "google",
  "facebook",
  "autre_media",
  "commercial",
  "connaissance",
  "etudiant",
  "autre",
  "non_renseigne",
] as const;

function isCanal(value: string): value is OwnerProspectionCanal {
  return (CANAUX_CONNUS as readonly string[]).includes(value);
}

function isoDate(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function fetchOwnerProspection(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerProspectionQuery
): Promise<OwnerProspectionResponse> {
  const anneeScolaire = filters.anneeScolaire ?? null;
  const filiereIds =
    filters.filiereIds && filters.filiereIds.length > 0 ? filters.filiereIds : null;
  /*
     Ce service numérotait déjà [tenant, année, filières] : il suffit de le
     compléter pour suivre le contrat de owner-perimetre.sql.

     DEUX DATATIONS COHABITENT ICI, et c'est voulu. Les blocs « d'où viennent
     les étudiants » datent l'ÉTUDIANT par sa première ouverture — c'est la
     question posée. Les blocs d'argent datent la COMMANDE. Confondre les deux
     est précisément ce qui doublait les commissions.
  */
  const nomClasse = filters.nomClasse?.trim() ? filters.nomClasse.trim() : null;
  const semestreId = filters.semestreId ?? null;
  const params = [tenantId, anneeScolaire, filiereIds, nomClasse, semestreId];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- Effectifs, couverture et assiette ---- */
    const totauxRows = await safeQuery<{
      etudiants: number;
      renseignes: number;
      via_commercial: number;
      scolarite: number;
      scolarite_non_rattachee: number;
      sans_date: number;
    }>(
      client,
      `WITH ${STUDENT_FILIERE_CTE},
       ${STUDENT_SCOPE_CTE},
       ${OUVERTURES_CTE},
       ${OUVERTURES_PERIMETRE_CTE},
       ${COMMANDES_PERIMETRE_CTE},
       ${PAIEMENTS_CTE},
       ${ARRIVEES_CTE}
       SELECT COUNT(*)::int AS etudiants,
              COUNT(prov.student_id)::int AS renseignes,
              COUNT(*) FILTER (WHERE prov.canal = 'commercial')::int AS via_commercial,
              COALESCE(SUM(COALESCE(pe.total_paye, 0)), 0)::float8 AS scolarite,
              -- L'angle mort, chiffré : ce que rapportent les étudiants dont on
              -- ignore d'où ils viennent.
              COALESCE(SUM(COALESCE(pe.total_paye, 0))
                       FILTER (WHERE prov.student_id IS NULL), 0)::float8
                AS scolarite_non_rattachee,
              COUNT(*) FILTER (WHERE a.student_id IS NULL)::int AS sans_date
         FROM student_scope ss
         LEFT JOIN student_provenances prov
           ON prov.student_id = ss.id AND prov.tenant_id = $1::uuid
         LEFT JOIN paiements_par_etudiant pe ON pe.student_id = ss.id
         LEFT JOIN arrivees a ON a.student_id = ss.id`,
      params,
      log,
      "totaux"
    );

    const t = totauxRows[0];
    const etudiants = int(t?.etudiants);
    const renseignes = int(t?.renseignes);
    const viaCommercial = int(t?.via_commercial);
    const scolariteEncaissee = num(t?.scolarite);
    const scolariteNonRattachee = num(t?.scolarite_non_rattachee);
    const etudiantsSansDate = int(t?.sans_date);

    /* ---- Répartition par canal ---- */
    const canalRows = await safeQuery<{
      canal: string;
      etudiants: number;
      scolarite: number;
      commission: number;
    }>(
      client,
      `WITH ${BASE_CTES},
       ${COMMISSION_PAR_ETUDIANT_CTE}
       SELECT COALESCE(prov.canal, 'non_renseigne') AS canal,
              COUNT(*)::int AS etudiants,
              COALESCE(SUM(COALESCE(pe.total_paye, 0)), 0)::float8 AS scolarite,
              COALESCE(SUM(COALESCE(cpe.acquise, 0)), 0)::float8 AS commission
         FROM student_scope ss
         LEFT JOIN student_provenances prov
           ON prov.student_id = ss.id AND prov.tenant_id = $1::uuid
         LEFT JOIN paiements_par_etudiant pe ON pe.student_id = ss.id
         LEFT JOIN commission_par_etudiant cpe ON cpe.student_id = ss.id
        GROUP BY 1
        ORDER BY scolarite DESC, etudiants DESC, canal`,
      params,
      log,
      "parCanal"
    );

    /* ---- Arrivées par mois ---- */
    const moisRows = await safeQuery<{
      mois: string;
      total: number;
      commercial: number;
      medias: number;
      bouche_a_oreille: number;
      autre: number;
    }>(
      client,
      `WITH ${STUDENT_FILIERE_CTE},
       ${STUDENT_SCOPE_CTE},
       ${OUVERTURES_CTE},
       ${OUVERTURES_PERIMETRE_CTE},
       ${COMMANDES_PERIMETRE_CTE},
       ${ARRIVEES_CTE}
       SELECT to_char(date_trunc('month', a.arrivee), 'YYYY-MM') AS mois,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE prov.canal = 'commercial')::int AS commercial,
              COUNT(*) FILTER (
                WHERE prov.canal IN ('google', 'facebook', 'autre_media')
              )::int AS medias,
              COUNT(*) FILTER (
                WHERE prov.canal IN ('connaissance', 'etudiant')
              )::int AS bouche_a_oreille,
              -- « Autre » ET les provenances jamais renseignées : la colonne
              -- porte tout ce qu'on ne sait pas nommer, et le total reste la
              -- somme exacte des quatre familles.
              COUNT(*) FILTER (
                WHERE prov.canal = 'autre' OR prov.student_id IS NULL
              )::int AS autre
         FROM arrivees a
         LEFT JOIN student_provenances prov
           ON prov.student_id = a.student_id AND prov.tenant_id = $1::uuid
        GROUP BY 1
        ORDER BY 1`,
      params,
      log,
      "parMois"
    );

    /* ---- Commerciaux ---- */
    const commerciauxRows = await safeQuery<{
      commercial_id: string;
      nom: string;
      actif: boolean;
      etudiants: number;
      scolarite: number;
      acquise: number;
      versee: number;
      lignes_dues: number;
    }>(
      client,
      `WITH ${BASE_CTES},
       acquis AS (
         SELECT commercial_id,
                COALESCE(SUM(montant_scolarite), 0)::float8 AS scolarite,
                COALESCE(SUM(commission), 0)::float8 AS acquise,
                COALESCE(SUM(commission) FILTER (WHERE reglee), 0)::float8 AS versee,
                COUNT(*) FILTER (WHERE NOT reglee)::int AS lignes_dues
           FROM lignes_commission
          GROUP BY commercial_id
       ),
       effectif AS (
         SELECT prov.commercial_id, COUNT(*)::int AS etudiants
           FROM student_provenances prov
           JOIN student_scope ss ON ss.id = prov.student_id
          WHERE prov.tenant_id = $1::uuid AND prov.canal = 'commercial'
          GROUP BY prov.commercial_id
       )
       SELECT c.id AS commercial_id,
              c.nom,
              c.actif,
              COALESCE(e.etudiants, 0)::int AS etudiants,
              COALESCE(a.scolarite, 0)::float8 AS scolarite,
              COALESCE(a.acquise, 0)::float8 AS acquise,
              COALESCE(a.versee, 0)::float8 AS versee,
              COALESCE(a.lignes_dues, 0)::int AS lignes_dues
         FROM commerciaux c
         LEFT JOIN acquis a ON a.commercial_id = c.id
         LEFT JOIN effectif e ON e.commercial_id = c.id
        WHERE c.tenant_id = $1::uuid
          -- Un commercial sans le moindre étudiant dans le périmètre n'y a rien
          -- fait : l'afficher à zéro allongerait le tableau sans rien apprendre.
          AND (COALESCE(e.etudiants, 0) > 0 OR COALESCE(a.acquise, 0) > 0)
        ORDER BY (COALESCE(a.acquise, 0) - COALESCE(a.versee, 0)) DESC,
                 COALESCE(a.acquise, 0) DESC,
                 c.nom
        LIMIT $6::int`,
      [...params, OWNER_PROSPECTION_MAX_COMMERCIAUX],
      log,
      "commerciaux"
    );

    /* ---- Dette de commissions ---- */
    const detteRows = await safeQuery<{
      total: number;
      lignes: number;
      plus_ancienne: Date | string | null;
      commerciaux: number;
    }>(
      client,
      `WITH ${BASE_CTES}
       SELECT COALESCE(SUM(commission), 0)::float8 AS total,
              COUNT(*)::int AS lignes,
              MIN(paid_at)::date AS plus_ancienne,
              COUNT(DISTINCT commercial_id)::int AS commerciaux
         FROM lignes_commission
        WHERE NOT reglee`,
      params,
      log,
      "dette"
    );

    /* ---- Assiette et acquis, tous commerciaux confondus ---- */
    const acquisRows = await safeQuery<{
      scolarite: number;
      acquise: number;
      versee: number;
    }>(
      client,
      `WITH ${BASE_CTES}
       SELECT COALESCE(SUM(montant_scolarite), 0)::float8 AS scolarite,
              COALESCE(SUM(commission), 0)::float8 AS acquise,
              COALESCE(SUM(commission) FILTER (WHERE reglee), 0)::float8 AS versee
         FROM lignes_commission`,
      params,
      log,
      "acquis"
    );

    const d = detteRows[0];
    const detteTotal = num(d?.total);
    const plusAncienne = isoDate(d?.plus_ancienne ?? null);
    const ageJours =
      plusAncienne === null
        ? null
        : Math.max(
            0,
            Math.round(
              (Date.now() - new Date(`${plusAncienne}T00:00:00Z`).getTime()) / 86400000
            )
          );

    // Les totaux viennent des LIGNES, jamais de la somme du tableau affiché :
    // ce dernier est plafonné, et un indicateur qui suivrait son plafond
    // annoncerait une dette plus petite que la dette.
    //
    // Acquis, versé et dû reposent tous trois sur la commission RECALCULÉE —
    // la base des écrans de règlement de l'administration — et non sur le
    // montant figé dans `commissions_versements`. Les trois se recomposent
    // donc exactement : acquis = versé + dû, quoi qu'il arrive aux montants
    // historiques.
    const commissionAcquise = num(acquisRows[0]?.acquise);
    const commissionVersee = num(acquisRows[0]?.versee);
    const scolariteCommerciale = num(acquisRows[0]?.scolarite);

    return {
      anneeScolaire,
      filiereIds: filiereIds ?? [],
      nomClasse,
      kpis: {
        etudiants,
        couverture: pct(renseignes, etudiants) ?? 0,
        viaCommercial,
        scolariteEncaissee,
        commissionAcquise,
        commissionVersee,
        commissionDue: detteTotal,
        tauxEffectif: pct(commissionAcquise, scolariteCommerciale),
      },
      couverture: {
        etudiants,
        renseignes,
        nonRenseignes: etudiants - renseignes,
        representative:
          etudiants > 0 &&
          (pct(renseignes, etudiants) ?? 0) >= OWNER_PROSPECTION_COUVERTURE_MIN,
        scolariteNonRattachee,
      },
      parCanal: canalRows
        .filter((r) => isCanal(r.canal))
        .map((r) => {
          const eff = int(r.etudiants);
          const encaisse = num(r.scolarite);
          const commission = num(r.commission);
          return {
            canal: r.canal as OwnerProspectionCanal,
            etudiants: eff,
            part: pct(eff, etudiants) ?? 0,
            scolariteEncaissee: encaisse,
            scolariteParEtudiant: eff > 0 ? Math.round(encaisse / eff) : null,
            commissionAcquise: commission,
            net: encaisse - commission,
          };
        }),
      parMois: moisRows.map((r) => ({
        mois: String(r.mois),
        total: int(r.total),
        commercial: int(r.commercial),
        medias: int(r.medias),
        boucheAOreille: int(r.bouche_a_oreille),
        autre: int(r.autre),
      })),
      commerciaux: commerciauxRows.map((r) => {
        const acquise = num(r.acquise);
        const versee = num(r.versee);
        const scolarite = num(r.scolarite);
        return {
          commercialId: r.commercial_id,
          nom: r.nom,
          actif: !!r.actif,
          etudiants: int(r.etudiants),
          scolariteEncaissee: scolarite,
          commissionAcquise: acquise,
          commissionVersee: versee,
          solde: acquise - versee,
          tauxEffectif: pct(acquise, scolarite),
          lignesDues: int(r.lignes_dues),
        };
      }),
      dette: {
        total: detteTotal,
        lignes: int(d?.lignes),
        plusAncienne,
        ageJours,
        commerciaux: int(d?.commerciaux),
      },
      etudiantsSansDate,
    };
  } finally {
    client.release();
  }
}
