import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerEconomieQuery,
  OwnerEconomieResponse,
} from "@ecoledigitale/contracts/src/owner-stats.schema";
import { PRO_ORDER_DATES_CTE, anneeDe } from "./owner-pro-annee.sql";

/**
 * Économie de l'établissement.
 *
 * Quatrième et dernière question d'un propriétaire : « où est-ce que je perds de
 * l'argent sans le voir ? » Trois lectures :
 *
 *   1. MARGE BRUTE PÉDAGOGIQUE par filière — encaissé moins coût enseignant
 *      direct, moins les charges effectivement affectées à la filière ;
 *   2. VALEUR PAR FAMILLE, et non par élève : en Afrique de l'Ouest la décision
 *      de scolarisation se prend au niveau du foyer, et une fratrie qui part,
 *      ce sont trois scolarités perdues d'un coup ;
 *   3. RÉTENTION inter-semestres, le meilleur prédicteur de chiffre d'affaires
 *      de l'année suivante.
 *
 * HONNÊTETÉ DES CHIFFRES — la contrainte structurante de cet écran.
 *
 * Le mot « marge » est réservé à un résultat d'exploitation, qui suppose que
 * TOUTES les charges soient saisies. Tant que ce n'est pas le cas, l'indicateur
 * s'appelle « marge brute pédagogique » et la réponse expose une COUVERTURE :
 * combien de sources de coût portent réellement des données. Une marge de 80 %
 * calculée sans aucune charge enregistrée n'est pas une bonne nouvelle, c'est
 * une comptabilité absente — et l'écran doit le dire, pas le laisser deviner.
 *
 * CE QUI A ÉTÉ RETIRÉ — la prévision de trésorerie à 13 semaines.
 *
 * Elle allumait une carte rouge « Rupture de trésorerie · Semaine 1 » sur toute
 * base, et ses deux côtés étaient faux :
 *
 *   - ENTRÉES lues dans student_tuition_installments et les échéances
 *     professionnelles. Ces deux tables sont vides, et le module professionnel
 *     ne pratique pas l'échéancier : les recettes attendues valaient 0 sur les
 *     treize semaines, structurellement et pour toujours ;
 *   - SORTIES retenues sur calculated_at BETWEEN debut_de_semaine - 30 AND fin.
 *     Cette fenêtre glissante de 30 jours faisait retomber un même bulletin non
 *     versé dans CINQ semaines consécutives — 675 000 FCFA de salaires dus
 *     annoncés comme 3 375 000 FCFA de décaissements.
 *
 * Zéro recette face à des salaires quintuplés : la rupture était garantie quelle
 * que soit la santé réelle de l'école. Une prévision honnête demanderait des
 * échéances saisies ; en attendant, l'absence de carte vaut mieux qu'une alarme
 * qui ne peut pas ne pas se déclencher.
 *
 * PÉRIMÈTRE ANNUEL — cf. owner-pro-annee.sql.
 *
 * Sans année choisie l'écran cumule les cinq rentrées, ce qui répond à « qu'ont
 * rapporté ces filières depuis toujours ». Avec une année, chaque bloc se
 * restreint à elle en passant par la seule date qui décrive un fait pédagogique :
 * le début de l'ouverture de classe, jamais l'horodatage d'écriture de la ligne.
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
    log.warn({ err: e, label }, "owner economie query failed");
    return [];
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function round0(v: number): number {
  return Math.round(v);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function rate(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return round1((100 * part) / whole);
}

const ROWS_LIMIT = 100;

/**
 * Encaissé confirmé par commande professionnelle.
 *
 * Fragment isolé du bloc d'échéancier qui le portait autrefois : cet écran a
 * besoin des versements, pas des échéances — et importer la machinerie complète
 * laissait croire que la balance âgée servait ici à quelque chose.
 *
 * Paramètre attendu : $1 = tenant.
 */
const PAID_PER_ORDER_CTE = `
  paid_per_order AS (
    SELECT p.order_id, SUM(p.montant)::float8 AS paid
      FROM professional_payments p
     WHERE p.tenant_id = $1::uuid AND p.statut = 'confirme'
     GROUP BY p.order_id
  )`;

/**
 * Année scolaire d'un bulletin de paie : le millésime porté par la période, ou
 * à défaut le pivot de septembre sur son début.
 *
 * Deux origines de date, un seul millésime — c'est la règle de l'écran « Masse
 * salariale », et les deux écrans doivent tomber sur le même total pour une
 * année donnée, sans quoi le propriétaire arbitre entre deux chiffres.
 */
const ANNEE_PAIE_SQL = `COALESCE(ay.name, ${anneeDe("pp.period_start")})`;

/* --------------------------------- Service -------------------------------- */

export async function fetchOwnerEconomie(
  pool: Pool,
  tenantId: string,
  query: OwnerEconomieQuery,
  log: FastifyBaseLogger
): Promise<OwnerEconomieResponse> {
  const filiereIds = query.filiereIds && query.filiereIds.length > 0 ? query.filiereIds : null;
  const annee = query.anneeScolaire ?? null;
  const client = await pool.connect();

  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- Couverture des sources de coût ----------------------------------- */
    // Sans cette mesure, une marge élevée se lit comme une performance alors
    // qu'elle ne traduit qu'une absence de saisie.
    //
    // Volontairement NON restreinte à l'année : elle décrit l'état de la SAISIE,
    // pas celui de l'exercice. « Aucune charge enregistrée » reste la même
    // information qu'on regarde 2021-2022 ou l'année en cours.
    const coverageRows = await safeRows<Row>(
      client,
      `SELECT
         (SELECT COUNT(*) FROM teacher_payments WHERE tenant_id = $1::uuid)::int AS paiements_enseignants,
         (SELECT COUNT(*) FROM teacher_assignments WHERE tenant_id = $1::uuid)::int AS affectations,
         (SELECT COUNT(*) FROM teaching_hours th
            JOIN teacher_assignments ta ON ta.id = th.assignment_id AND ta.tenant_id = th.tenant_id
           WHERE th.tenant_id = $1::uuid)::int AS heures_declarees,
         (SELECT COUNT(*) FROM expenses WHERE tenant_id = $1::uuid)::int AS charges,
         (SELECT COUNT(*) FROM expenses WHERE tenant_id = $1::uuid AND programme_id IS NOT NULL)::int AS charges_affectees,
         (SELECT MIN(changed_at)::date::text FROM student_status_history WHERE tenant_id = $1::uuid) AS historique_depuis`,
      [tenantId],
      log,
      "couverture"
    );
    const cov = coverageRows[0] ?? {};
    const coutEnseignantSaisi =
      num(cov.paiements_enseignants) > 0 || num(cov.affectations) > 0;
    const chargesSaisies = num(cov.charges) > 0;

    /* ---- Marge brute pédagogique par filière ------------------------------- */
    const margeRows = await safeRows<Row>(
      client,
      `WITH ${PAID_PER_ORDER_CTE},
       ${PRO_ORDER_DATES_CTE},
       /* Commandes du périmètre : celles dont la classe s'est ouverte pendant
          l'année demandée. Un seul endroit décide de l'appartenance annuelle,
          et tous les blocs de revenus en dépendent. */
       commandes AS (
         SELECT d.order_id
           FROM pro_order_dates d
          WHERE $3::text IS NULL OR ${anneeDe("d.debut")} = $3::text
       ),
       /* Encaissé réparti par filière au prorata des inscriptions : une commande
          peut porter des UE de plusieurs filières, on ne l'affecte jamais en bloc. */
       part_filiere AS (
         SELECT en.order_id, u.filiere_id, SUM(en.prix_unitaire)::float8 AS part
         FROM professional_enrollments en
         JOIN commandes c ON c.order_id = en.order_id
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE en.tenant_id = $1::uuid AND en.statut <> 'annulee'
         GROUP BY en.order_id, u.filiere_id
       ),
       total_commande AS (
         SELECT order_id, SUM(part) AS total FROM part_filiere GROUP BY order_id
       ),
       revenu AS (
         SELECT pf.filiere_id,
                SUM(COALESCE(pp.paid, 0) * pf.part / NULLIF(tc.total, 0))::float8 AS encaisse
         FROM part_filiere pf
         JOIN total_commande tc ON tc.order_id = pf.order_id
         LEFT JOIN paid_per_order pp ON pp.order_id = pf.order_id
         GROUP BY pf.filiere_id
       ),
       /* Coût enseignant direct : ce qui a effectivement été payé, rattaché à la
          filière par les ECUE enseignées. La table des paiements enseignants ne
          porte aucun centre de coût — la jointure passe donc par les
          affectations d'ECUE, et le montant est réparti entre les filières où
          l'enseignant intervient.

          UNE LIGNE PAR FILIÈRE DISTINCTE, et le diviseur compté sur ce même
          ensemble. La forme précédente joignait le bulletin à CHAQUE affectation
          d'ECUE : un enseignant assurant deux matières dans la même filière y
          voyait son salaire compté deux fois. Le total ne tombait juste que
          parce que ces données comportent exactement une affectation par filière
          et par enseignant — une coïncidence, pas une garantie.

          Les affectations sont restreintes à la MÊME année que le bulletin :
          sinon un salaire de 2021-2022 se répartirait sur les filières que
          l'enseignant a rejointes depuis, et les parts tombant hors de l'année
          disparaîtraient du total — mesuré : 8 613 000 FCFA de paie réelle
          affichés 3 036 400 sur 2025-2026. */
       cout_enseignant AS (
         SELECT aff.filiere_id,
                SUM(tp.total_amount / aff.nb_filieres)::float8 AS cout
         FROM teacher_payments tp
         JOIN payment_periods pp
           ON pp.id = tp.payment_period_id AND pp.tenant_id = tp.tenant_id
         LEFT JOIN academic_years ay
           ON ay.id = pp.academic_year_id AND ay.tenant_id = pp.tenant_id
         JOIN LATERAL (
           SELECT f.filiere_id, COUNT(*) OVER () AS nb_filieres
           FROM (
             SELECT DISTINCT u2.filiere_id
             FROM professional_session_ecue_teachers st
             JOIN professional_ue_sessions s2 ON s2.id = st.ue_session_id AND s2.tenant_id = st.tenant_id
             JOIN professional_ue u2 ON u2.id = s2.ue_id AND u2.tenant_id = s2.tenant_id
             WHERE st.enseignant_id = tp.teacher_id
               AND st.tenant_id = tp.tenant_id
               AND u2.filiere_id IS NOT NULL
               AND ($3::text IS NULL OR ${anneeDe("s2.date_debut")} = $3::text)
           ) f
         ) aff ON TRUE
         WHERE tp.tenant_id = $1::uuid
           AND tp.status IN ('calculated'::payment_status, 'approved'::payment_status, 'paid'::payment_status)
           AND ($3::text IS NULL OR ${ANNEE_PAIE_SQL} = $3::text)
         GROUP BY aff.filiere_id
       ),
       /* Charges explicitement affectées à la filière. Les charges d'établissement
          (programme_id NULL) ne sont JAMAIS réparties : une clé inventée
          fabriquerait des marges sans signification comptable. */
       charges AS (
         SELECT programme_id AS filiere_id, SUM(amount)::float8 AS montant
         FROM expenses
         WHERE tenant_id = $1::uuid AND programme_id IS NOT NULL
         GROUP BY programme_id
       ),
       effectifs AS (
         SELECT u.filiere_id, COUNT(DISTINCT en.student_id)::int AS etudiants
         FROM professional_enrollments en
         JOIN commandes c ON c.order_id = en.order_id
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE en.tenant_id = $1::uuid AND en.statut <> 'annulee'
         GROUP BY u.filiere_id
       )
       SELECT
         pr.id AS filiere_id,
         pr.name AS filiere_name,
         COALESCE(r.encaisse, 0)::float8 AS encaisse,
         COALESCE(ce.cout, 0)::float8 AS cout_enseignant,
         COALESCE(ch.montant, 0)::float8 AS charges_affectees,
         COALESCE(ef.etudiants, 0)::int AS etudiants
       FROM programmes pr
       LEFT JOIN revenu r ON r.filiere_id = pr.id
       LEFT JOIN cout_enseignant ce ON ce.filiere_id = pr.id
       LEFT JOIN charges ch ON ch.filiere_id = pr.id
       LEFT JOIN effectifs ef ON ef.filiere_id = pr.id
       WHERE pr.tenant_id = $1::uuid
         AND ($2::uuid[] IS NULL OR pr.id = ANY($2::uuid[]))
         AND (r.encaisse IS NOT NULL OR ef.etudiants IS NOT NULL)
       ORDER BY COALESCE(r.encaisse, 0) DESC
       LIMIT ${ROWS_LIMIT}`,
      [tenantId, filiereIds, annee],
      log,
      "margeParFiliere"
    );

    const marges = margeRows.map((r) => {
      const encaisse = round0(num(r.encaisse));
      const coutEnseignant = round0(num(r.cout_enseignant));
      const chargesAff = round0(num(r.charges_affectees));
      const marge = encaisse - coutEnseignant - chargesAff;
      const etudiants = Math.round(num(r.etudiants));
      return {
        filiereId: String(r.filiere_id),
        filiereName: String(r.filiere_name),
        encaisse,
        coutEnseignant,
        chargesAffectees: chargesAff,
        margeBrute: marge,
        tauxMarge: rate(marge, encaisse),
        etudiants,
        margeParEtudiant: etudiants > 0 ? round0(marge / etudiants) : null,
      };
    });

    /* ---- Valeur par famille ------------------------------------------------ */
    // L'unité économique est le foyer : une fratrie qui part, ce sont plusieurs
    // scolarités perdues le même jour.
    //
    // L'ANNÉE RESTREINT LA LISTE, PAS LE MONTANT. La valeur d'une famille se
    // mesure sur sa durée — la tronquer à douze mois en ferait un chiffre
    // d'affaires annuel, ce que la colonne « revenu annuel moyen » donne déjà.
    // Le filtre choisit donc QUELLES familles apparaissent (celles présentes
    // cette année-là), et chacune reste affichée avec tout ce qu'elle a versé.
    const familleRows = await safeRows<Row>(
      client,
      `WITH ${PAID_PER_ORDER_CTE},
       perimetre AS (
         SELECT DISTINCT en.student_id
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE en.tenant_id = $1::uuid
           AND en.statut <> 'annulee'
           AND ($2::uuid[] IS NULL OR u.filiere_id = ANY($2::uuid[]))
           AND ($3::text IS NULL OR ${anneeDe("s.date_debut")} = $3::text)
       ),
       paiement_par_etudiant AS (
         SELECT o.student_id, SUM(COALESCE(pp.paid, 0))::float8 AS encaisse
         FROM professional_orders o
         LEFT JOIN paid_per_order pp ON pp.order_id = o.id
         WHERE o.tenant_id = $1::uuid AND o.statut <> 'annulee'
         GROUP BY o.student_id
       ),
       anciennete AS (
         SELECT en.student_id,
                MIN(s.date_debut) AS premiere,
                MAX(s.date_fin) AS derniere
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         WHERE en.tenant_id = $1::uuid AND en.statut <> 'annulee'
         GROUP BY en.student_id
       )
       SELECT
         u.id AS parent_id,
         TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS parent_nom,
         COUNT(DISTINCT sp.student_id)::int AS enfants,
         COALESCE(SUM(pe.encaisse), 0)::float8 AS encaisse_total,
         MIN(an.premiere) AS premiere_inscription,
         MAX(an.derniere) AS derniere_activite
       FROM student_parents sp
       JOIN perimetre pm ON pm.student_id = sp.student_id
       JOIN users u ON u.id = sp.parent_id AND u.tenant_id = sp.tenant_id
       LEFT JOIN paiement_par_etudiant pe ON pe.student_id = sp.student_id
       LEFT JOIN anciennete an ON an.student_id = sp.student_id
       WHERE sp.tenant_id = $1::uuid
       GROUP BY u.id, u.first_name, u.last_name
       HAVING COALESCE(SUM(pe.encaisse), 0) > 0 OR COUNT(DISTINCT sp.student_id) > 1
       ORDER BY 4 DESC
       LIMIT ${ROWS_LIMIT}`,
      [tenantId, filiereIds, annee],
      log,
      "ltvFamille"
    );

    const familles = familleRows.map((r) => {
      const encaisse = round0(num(r.encaisse_total));
      const debut = r.premiere_inscription ? new Date(r.premiere_inscription as string) : null;
      const fin = r.derniere_activite ? new Date(r.derniere_activite as string) : null;
      const anneesPresence =
        debut && fin ? Math.max(0.5, (fin.getTime() - debut.getTime()) / (365.25 * 86_400_000)) : null;
      return {
        parentId: String(r.parent_id),
        parentNom: String(r.parent_nom || "").trim() || "Parent inconnu",
        enfants: Math.round(num(r.enfants)),
        encaisseTotal: encaisse,
        anneesPresence: anneesPresence === null ? null : round1(anneesPresence),
        // VALEUR RÉALISÉE : ce que la famille a effectivement payé. Pas une
        // projection — une valeur prédictive exigerait un historique de sortie
        // que la migration 0099 ne commence qu'aujourd'hui à constituer.
        revenuAnnuelMoyen:
          anneesPresence && anneesPresence > 0 ? round0(encaisse / anneesPresence) : null,
      };
    });

    const fratries = familles.filter((f) => f.enfants > 1);

    /* ---- Rétention inter-semestres ----------------------------------------- */
    // Un étudiant est « retenu » s'il réapparaît sur une cohorte démarrant après
    // la fin de la précédente. Mesure directe, sans hypothèse.
    //
    // L'année restreint la COHORTE observée, jamais la recherche de la suite :
    // demander « qu'ont fait les étudiants de 2023-2024 ? » impose de regarder
    // 2024-2025 pour répondre. Restreindre les deux donnerait 0 % partout.
    const retentionRows = await safeRows<Row>(
      client,
      `WITH parcours AS (
         SELECT DISTINCT en.student_id, u.filiere_id, s.date_debut, s.date_fin
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE en.tenant_id = $1::uuid
           AND en.statut <> 'annulee'
       ),
       cohorte AS (
         SELECT * FROM parcours p
          WHERE ($2::uuid[] IS NULL OR p.filiere_id = ANY($2::uuid[]))
            AND ($3::text IS NULL OR ${anneeDe("p.date_debut")} = $3::text)
       ),
       bornes AS (
         SELECT student_id, filiere_id,
                MIN(date_debut) AS debut,
                MAX(date_fin) AS fin
         FROM cohorte GROUP BY student_id, filiere_id
       )
       SELECT
         pr.id AS filiere_id,
         pr.name AS filiere_name,
         COUNT(DISTINCT b.student_id)::int AS cohorte,
         COUNT(DISTINCT b.student_id) FILTER (WHERE EXISTS (
           SELECT 1 FROM parcours p2
            WHERE p2.student_id = b.student_id
              AND p2.date_debut > b.fin
         ))::int AS poursuivis
       FROM bornes b
       JOIN programmes pr ON pr.id = b.filiere_id AND pr.tenant_id = $1::uuid
       GROUP BY pr.id, pr.name
       ORDER BY pr.name
       LIMIT ${ROWS_LIMIT}`,
      [tenantId, filiereIds, annee],
      log,
      "retention"
    );

    const retention = retentionRows.map((r) => {
      const cohorte = Math.round(num(r.cohorte));
      const poursuivis = Math.round(num(r.poursuivis));
      return {
        filiereId: String(r.filiere_id),
        filiereName: String(r.filiere_name),
        cohorte,
        poursuivis,
        tauxRetention: rate(poursuivis, cohorte),
      };
    });

    const totalEncaisse = marges.reduce((s, m) => s + m.encaisse, 0);
    const totalCout = marges.reduce((s, m) => s + m.coutEnseignant + m.chargesAffectees, 0);

    return {
      computedAt: new Date().toISOString(),
      anneeScolaire: annee,
      couverture: {
        coutEnseignantSaisi,
        chargesSaisies,
        nombreCharges: Math.round(num(cov.charges)),
        chargesAffectees: Math.round(num(cov.charges_affectees)),
        historiqueStatutsDepuis: (cov.historique_depuis as string | null) ?? null,
        /**
         * Tant que les deux sources de coût sont vides, l'indicateur ne mesure
         * qu'un chiffre d'affaires : l'écran doit refuser de l'appeler « marge ».
         */
        margeInterpretable: coutEnseignantSaisi || chargesSaisies,
      },
      kpis: {
        encaisseTotal: round0(totalEncaisse),
        coutTotal: round0(totalCout),
        margeBruteTotale: round0(totalEncaisse - totalCout),
        tauxMargeBrute: rate(totalEncaisse - totalCout, totalEncaisse),
        famillesSuivies: familles.length,
        fratries: fratries.length,
      },
      marges,
      familles,
      retention,
    };
  } finally {
    client.release();
  }
}

/** Export CSV : marges par filière et rétention. */
export function buildOwnerEconomieCsv(data: OwnerEconomieResponse): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];

  // Le périmètre est écrit EN TÊTE : un CSV se relit hors de l'écran qui l'a
  // produit, et « 18 000 000 » ne veut rien dire sans son année.
  lines.push(`Périmètre;${data.anneeScolaire ?? "toutes années cumulées"}`);
  lines.push("");

  if (!data.couverture.margeInterpretable) {
    lines.push(
      "ATTENTION : aucun coût enseignant ni aucune charge n'est saisi. Les montants ci-dessous sont un chiffre d'affaires, pas une marge."
    );
    lines.push("");
  }

  lines.push("Marge brute pédagogique par filière");
  lines.push("Filière;Étudiants;Encaissé;Coût enseignant;Charges affectées;Marge brute;Taux %;Marge par étudiant");
  for (const m of data.marges) {
    lines.push(
      [
        esc(m.filiereName),
        m.etudiants,
        m.encaisse,
        m.coutEnseignant,
        m.chargesAffectees,
        m.margeBrute,
        m.tauxMarge ?? "",
        m.margeParEtudiant ?? "",
      ].join(";")
    );
  }

  lines.push("");
  lines.push("Rétention inter-semestres");
  lines.push("Filière;Cohorte;Poursuivent;Taux %");
  for (const r of data.retention) {
    lines.push([esc(r.filiereName), r.cohorte, r.poursuivis, r.tauxRetention ?? ""].join(";"));
  }

  return lines.join("\n");
}
