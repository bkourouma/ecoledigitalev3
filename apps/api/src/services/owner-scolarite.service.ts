import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerScolariteQuery, OwnerScolariteResponse } from "@ecoledigitale/contracts";
import {
  COMMANDES_PERIMETRE_CTE,
  ETUDIANTS_PERIMETRE_CTE,
  OUVERTURES_CTE,
  OUVERTURES_PERIMETRE_CTE,
  perimetreArgs,
} from "./owner-perimetre.sql";

/**
 * Scolarité — inscriptions, barème et effectifs inscrits.
 *
 * LE TROU QUE CET ÉCRAN COMBLE
 *
 * Le menu administrateur a « Scolarité » depuis toujours ; l'espace
 * propriétaire n'en avait aucun pendant. Pire, `/owner/finances` a délibérément
 * SORTI la scolarité de son périmètre, parce qu'un zéro non mesuré s'y lisait
 * comme une contre-performance. Résultat : le poste le plus lourd de l'école —
 * la scolarité, 810 000 à 900 000 FCFA par lot sur cette base — n'apparaissait
 * nulle part côté fondateur.
 *
 * L'UNITÉ : LE LOT (ÉTUDIANT × CLASSE)
 *
 * Ni l'étudiant, ni la commande. Un étudiant inscrit dans deux classes doit
 * deux barèmes ; une commande ne dit rien de ce qui AURAIT DÛ être commandé.
 * Le lot est la seule unité qui porte une dette, et le socle de périmètre le
 * produit déjà : `etudiants_perimetre` rend un couple (étudiant, classe) par
 * ligne.
 *
 * LE BARÈME
 *
 * `cycles_frais` porte quatre postes — inscription, scolarité, annexes, autres
 * — qui sont exactement les quatre natures facturables de
 * `professional_orders`. Sa clé utile est `programme_id`, c'est-à-dire LA
 * CLASSE : le barème est tarifé par classe et non par cycle, malgré le nom de
 * la table. Un lot doit le barème COMPLET de sa classe.
 *
 * CE QU'ON NE FAIT PAS, ET C'EST LE POINT LE PLUS IMPORTANT
 *
 * Une classe sans ligne de `cycles_frais` ne produit AUCUN dû — et surtout pas
 * zéro. Zéro se lirait « classe gratuite » quand la vérité est « grille
 * tarifaire jamais saisie », donc un trou de facturation où chaque inscrit est
 * facturé 0 en silence. Le dû est nullable de bout en bout, l'écart qui en
 * découle aussi, et les classes concernées sortent dans une liste à part.
 * Mesuré le 22/09/2026 : 40 grilles pour 41 classes, la non tarifée portant
 * 3 inscrits.
 *
 * L'écart global se calcule sur le SEUL périmètre tarifé. L'étendre à tous les
 * lots ferait entrer au numérateur des montants commandés qui n'ont aucun dû en
 * face, et l'écart annoncerait une surfacturation là où il n'y a qu'une grille
 * manquante.
 */

/* --------------------------------- Outils --------------------------------- */

type Row = Record<string, unknown>;

async function safeRows<T extends Row>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<T[]> {
  try {
    const res = await client.query<T>(sql, params);
    return res.rows;
  } catch (e) {
    log.warn({ err: e, label }, "owner scolarite query failed");
    return [];
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** `null` et non 0 : une valeur absente n'est pas une valeur nulle. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Libellés des natures de commande, telles que les migrations 0122 et 0123 les
 * ont posées. `transversal` n'est pas facturable : il porte la conduite, qui
 * traverse les classes sans être vendue.
 */
const LIBELLE_NATURE: Record<string, string> = {
  inscription: "Frais d'inscription",
  scolarite: "Scolarité",
  annexes: "Frais annexes",
  autres: "Autres frais",
  ue: "Unités d'enseignement",
  transversal: "Transversal (non facturable)",
};

const ENCAISSE_CTE = `
  encaisse_par_commande AS (
    /* Seul le statut confirme vaut encaissement : le statut payee d une
       commande ne prouve rien, adminUpdateEnrollment le force sans aucune
       ligne de paiement en face. Regle partagee avec owner-finances-pro. */
    SELECT p.order_id, SUM(p.montant)::float8 AS encaisse
      FROM professional_payments p
     WHERE p.tenant_id = $1::uuid
       AND p.statut = 'confirme'
     GROUP BY p.order_id
  )`;

/* ------------------------------- Agrégation ------------------------------- */

export async function fetchOwnerScolarite(
  pool: Pool,
  tenantId: string,
  query: OwnerScolariteQuery,
  log: FastifyBaseLogger
): Promise<OwnerScolariteResponse> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const filiereIds = query.filiereIds && query.filiereIds.length > 0 ? query.filiereIds : null;
    const nomClasse = query.nomClasse?.trim() ? query.nomClasse.trim() : null;
    const perimetre = perimetreArgs({
      tenantId,
      anneeScolaire: query.anneeScolaire ?? null,
      filiereIds,
      nomClasse,
      semestreId: query.semestreId ?? null,
    });

    const SOCLE = [
      OUVERTURES_CTE,
      OUVERTURES_PERIMETRE_CTE,
      COMMANDES_PERIMETRE_CTE,
      ETUDIANTS_PERIMETRE_CTE,
      ENCAISSE_CTE,
    ].join(",\n");

    /* ---- Une ligne par classe : inscrits, barème, commandé, encaissé ------ */
    const classeRows = await safeRows<Row>(
      client,
      `WITH ${SOCLE},
       lots AS (
         /* Le lot : un couple (etudiant, classe). etudiants_perimetre pose deja
            un DISTINCT, mais il porte aussi l annee : un etudiant present sur
            deux annees de la meme classe ne doit compter qu une fois ici. */
         SELECT DISTINCT ep.student_id, ep.filiere_id, ep.cle_classe, ep.nom_classe
           FROM etudiants_perimetre ep
       ),
       par_classe AS (
         SELECT l.filiere_id,
                l.cle_classe,
                MIN(l.nom_classe) AS nom_classe,
                COUNT(DISTINCT l.student_id)::int AS inscrits
           FROM lots l
          GROUP BY l.filiere_id, l.cle_classe
       ),
       commande_par_classe AS (
         /* La commande se rattache a sa classe par programme_id quand elle le
            porte — c est le cas des frais depuis la migration 0122 — et sinon
            par la classe de l etudiant dans le perimetre. */
         SELECT COALESCE(cp.programme_id, ep.filiere_id) AS filiere_id,
                SUM(cp.montant_total)::float8 AS commande,
                SUM(COALESCE(ec.encaisse, 0))::float8 AS encaisse
           FROM commandes_perimetre cp
           LEFT JOIN encaisse_par_commande ec ON ec.order_id = cp.order_id
           LEFT JOIN LATERAL (
             SELECT e.filiere_id FROM etudiants_perimetre e
              WHERE e.student_id = cp.student_id LIMIT 1
           ) ep ON TRUE
          WHERE cp.nature IS DISTINCT FROM 'transversal'
          GROUP BY 1
       )
       SELECT pc.filiere_id,
              pc.cle_classe,
              pc.nom_classe,
              pr.name                       AS filiere_name,
              pc.inscrits,
              cf.inscription::float8        AS bareme_inscription,
              cf.scolarite::float8          AS bareme_scolarite,
              cf.annexes::float8            AS bareme_annexes,
              cf.autres::float8             AS bareme_autres,
              COALESCE(cc.commande, 0)      AS commande,
              COALESCE(cc.encaisse, 0)      AS encaisse
         FROM par_classe pc
         LEFT JOIN programmes pr ON pr.id = pc.filiere_id AND pr.tenant_id = $1::uuid
         LEFT JOIN cycles_frais cf ON cf.programme_id = pc.filiere_id AND cf.tenant_id = $1::uuid
         LEFT JOIN commande_par_classe cc ON cc.filiere_id = pc.filiere_id
        ORDER BY pc.nom_classe`,
      perimetre,
      log,
      "scolariteParClasse"
    );

    /* ---- Ventilation par nature de commande ------------------------------ */
    const natureRows = await safeRows<Row>(
      client,
      `WITH ${SOCLE}
       SELECT cp.nature,
              COUNT(*)::int                          AS commandes,
              SUM(cp.montant_total)::float8          AS montant,
              SUM(COALESCE(ec.encaisse, 0))::float8  AS encaisse
         FROM commandes_perimetre cp
         LEFT JOIN encaisse_par_commande ec ON ec.order_id = cp.order_id
        GROUP BY cp.nature
        ORDER BY 3 DESC NULLS LAST`,
      perimetre,
      log,
      "scolariteParNature"
    );

    /* ---- Entonnoir : de l'inscription au paiement ------------------------ */
    const entonnoirRows = await safeRows<Row>(
      client,
      `WITH ${SOCLE}
       SELECT
         (SELECT COUNT(DISTINCT en.id)::int
            FROM professional_enrollments en
            JOIN ouvertures_perimetre op ON op.ue_session_id = en.ue_session_id
           WHERE en.tenant_id = $1::uuid AND en.statut <> 'annulee')          AS inscriptions,
         (SELECT COUNT(DISTINCT en.id)::int
            FROM professional_enrollments en
            JOIN ouvertures_perimetre op ON op.ue_session_id = en.ue_session_id
           WHERE en.tenant_id = $1::uuid
             AND en.statut IN ('confirmee', 'terminee'))                      AS confirmees,
         (SELECT COUNT(*)::int FROM commandes_perimetre)                      AS commandes,
         (SELECT COUNT(DISTINCT cp.order_id)::int
            FROM commandes_perimetre cp
            JOIN encaisse_par_commande ec ON ec.order_id = cp.order_id
           WHERE ec.encaisse > 0)                                             AS commandes_payees,
         (SELECT COUNT(DISTINCT en.id)::int
            FROM professional_enrollments en
            JOIN ouvertures_perimetre op ON op.ue_session_id = en.ue_session_id
           WHERE en.tenant_id = $1::uuid AND en.statut = 'terminee')          AS terminees,
         /* Des PERSONNES, pas des lots : un etudiant inscrit dans deux classes
            doit deux baremes mais ne compte qu une tete. Deduire l effectif du
            nombre de lots le compterait deux fois. */
         (SELECT COUNT(DISTINCT student_id)::int FROM etudiants_perimetre)    AS etudiants`,
      perimetre,
      log,
      "scolariteEntonnoir"
    );

    /* ---- Anomalies, dans les deux sens ----------------------------------- */
    const anomalieRows = await safeRows<Row>(
      client,
      `WITH ${SOCLE}
       SELECT
         (SELECT COUNT(*)::int FROM commandes_perimetre WHERE NOT par_inscription)
                                                                   AS commandes_sans_inscription,
         (SELECT COALESCE(SUM(montant_total), 0)::float8 FROM commandes_perimetre
           WHERE NOT par_inscription)                              AS montant_sans_inscription,
         (SELECT COUNT(DISTINCT en.id)::int
            FROM professional_enrollments en
            JOIN ouvertures_perimetre op ON op.ue_session_id = en.ue_session_id
           WHERE en.tenant_id = $1::uuid
             AND en.statut <> 'annulee'
             AND en.order_id IS NULL)                              AS inscrits_sans_commande`,
      perimetre,
      log,
      "scolariteAnomalies"
    );

    /* ---- Assemblage ------------------------------------------------------ */
    const parClasse = classeRows.map((r) => {
      const inscrits = Math.round(num(r.inscrits));
      const insc = numOrNull(r.bareme_inscription);
      const scol = numOrNull(r.bareme_scolarite);
      const annx = numOrNull(r.bareme_annexes);
      const autr = numOrNull(r.bareme_autres);
      /* Le barème existe ou n'existe pas : un poste absent n'est pas un poste à
         zéro, et un demi-barème ne se complète pas. */
      const tarife = insc !== null && scol !== null && annx !== null && autr !== null;
      const total = tarife ? (insc as number) + (scol as number) + (annx as number) + (autr as number) : null;
      const commande = num(r.commande);
      const duBareme = total === null ? null : total * inscrits;
      return {
        filiereId: String(r.filiere_id),
        nomClasse: String(r.nom_classe ?? ""),
        cleClasse: String(r.cle_classe ?? ""),
        filiereName: (r.filiere_name as string | null) ?? null,
        inscrits,
        bareme:
          tarife && total !== null
            ? {
                inscription: insc as number,
                scolarite: scol as number,
                annexes: annx as number,
                autres: autr as number,
                total,
              }
            : null,
        duBareme,
        commande,
        encaisse: num(r.encaisse),
        ecart: duBareme === null ? null : commande - duBareme,
      };
    });

    const trousFacturation = parClasse
      .filter((c) => c.bareme === null && c.inscrits > 0)
      .map((c) => ({
        filiereId: c.filiereId,
        filiereName: c.filiereName ?? c.nomClasse,
        inscrits: c.inscrits,
        commande: c.commande,
      }));

    const tarifes = parClasse.filter((c) => c.duBareme !== null);
    const duBareme = tarifes.length > 0 ? tarifes.reduce((s, c) => s + (c.duBareme ?? 0), 0) : null;
    const commandeTarifee = tarifes.reduce((s, c) => s + c.commande, 0);
    const commande = parClasse.reduce((s, c) => s + c.commande, 0);
    const encaisse = parClasse.reduce((s, c) => s + c.encaisse, 0);

    const lots = parClasse.reduce((s, c) => s + c.inscrits, 0);
    const lotsAvecBareme = tarifes.reduce((s, c) => s + c.inscrits, 0);

    const e = entonnoirRows[0] ?? {};
    const a = anomalieRows[0] ?? {};

    return {
      computedAt: new Date().toISOString(),
      kpis: {
        lots,
        lotsAvecBareme,
        etudiants: Math.round(num(e.etudiants)),
        classes: parClasse.length,
        duBareme,
        commande,
        encaisse,
        resteDu: Math.max(0, commande - encaisse),
        /* Sur le SEUL périmètre tarifé : voir l'en-tête du fichier. */
        ecartBaremeCommande: duBareme === null ? null : commandeTarifee - duBareme,
      },
      parClasse,
      parNature: natureRows.map((r) => {
        const nature = String(r.nature ?? "autres");
        return {
          nature,
          libelle: LIBELLE_NATURE[nature] ?? nature,
          commandes: Math.round(num(r.commandes)),
          montant: num(r.montant),
          encaisse: num(r.encaisse),
        };
      }),
      entonnoir: [
        /*
         * Les demandes en ligne n'ont AUCUNE source dans cet environnement :
         * `registration_requests` (migration 0060) n'existe dans aucune base,
         * le déploiement ne lançant que `prisma migrate deploy`. Un zéro se
         * lirait « aucune demande » ; la mention dit « non mesuré ».
         */
        { cle: "demandes", libelle: "Demandes en ligne", valeur: 0, mesuree: false },
        {
          cle: "inscriptions",
          libelle: "Inscriptions créées",
          valeur: Math.round(num(e.inscriptions)),
          mesuree: true,
        },
        {
          cle: "confirmees",
          libelle: "Confirmées",
          valeur: Math.round(num(e.confirmees)),
          mesuree: true,
        },
        {
          cle: "commandes",
          libelle: "Commandes émises",
          valeur: Math.round(num(e.commandes)),
          mesuree: true,
        },
        {
          cle: "payees",
          libelle: "Commandes encaissées",
          valeur: Math.round(num(e.commandes_payees)),
          mesuree: true,
        },
        {
          cle: "terminees",
          libelle: "Terminées",
          valeur: Math.round(num(e.terminees)),
          mesuree: true,
        },
      ],
      trousFacturation,
      anomalies: {
        commandesSansInscription: Math.round(num(a.commandes_sans_inscription)),
        montantSansInscription: num(a.montant_sans_inscription),
        inscritsSansCommande: Math.round(num(a.inscrits_sans_commande)),
        lotsSansBareme: lots - lotsAvecBareme,
      },
      couverture: {
        partTarifee: lots > 0 ? round1((100 * lotsAvecBareme) / lots) : null,
        duInterpretable: lots > 0 && lotsAvecBareme === lots,
      },
      anneeScolaire: query.anneeScolaire ?? null,
      filiereIds: filiereIds ?? [],
      nomClasse,
    };
  } finally {
    client.release();
  }
}

/** Export : la ventilation par classe, telle qu'affichée à l'écran. */
export function buildOwnerScolariteCsv(data: OwnerScolariteResponse): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];

  lines.push("Scolarité — barème appliqué et facturation réelle");
  lines.push("Année scolaire;" + esc(data.anneeScolaire ?? "Toutes années"));
  lines.push(
    "Périmètre;" +
      esc(
        data.nomClasse
          ? `Classe : ${data.nomClasse.split("|").pop()}`
          : data.filiereIds.length > 0
            ? `${data.filiereIds.length} filière(s)`
            : "Toutes filières"
      )
  );
  /* Le lecteur doit savoir, AVANT de lire une colonne « écart », si le dû est
     mesurable — sinon il lira une grille manquante comme une sous-facturation. */
  lines.push(
    "Dû mesurable;" +
      esc(
        data.couverture.duInterpretable
          ? "Oui — toutes les classes du périmètre sont tarifées"
          : `Non — ${data.anomalies.lotsSansBareme} lot(s) sans grille tarifaire`
      )
  );
  lines.push("");

  lines.push(
    "Classe;Inscrits;Barème inscription;Barème scolarité;Barème annexes;Barème autres;Barème total;Dû au barème;Commandé;Encaissé;Écart"
  );
  for (const c of data.parClasse) {
    lines.push(
      [
        esc(c.filiereName ?? c.nomClasse),
        c.inscrits,
        c.bareme?.inscription ?? "",
        c.bareme?.scolarite ?? "",
        c.bareme?.annexes ?? "",
        c.bareme?.autres ?? "",
        c.bareme?.total ?? "",
        c.duBareme ?? "",
        c.commande,
        c.encaisse,
        c.ecart ?? "",
      ].join(";")
    );
  }

  if (data.trousFacturation.length > 0) {
    lines.push("");
    lines.push("Classes sans grille tarifaire — chaque inscrit y est facturé 0");
    lines.push("Classe;Inscrits;Commandé malgré tout");
    for (const t of data.trousFacturation) {
      lines.push([esc(t.filiereName ?? ""), t.inscrits, t.commande].join(";"));
    }
  }

  lines.push("");
  lines.push("Nature;Commandes;Montant;Encaissé");
  for (const n of data.parNature) {
    lines.push([esc(n.libelle), n.commandes, n.montant, n.encaisse].join(";"));
  }

  return lines.join("\n");
}
