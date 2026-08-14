import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerEconomieQuery,
  OwnerEconomieResponse,
} from "@ecoledigitale/contracts/src/owner-stats.schema";
import { PRO_UNPAID_INSTALLMENTS_CTE } from "./owner-pro-outstanding.sql";

/**
 * Économie de l'établissement.
 *
 * Quatrième et dernière question d'un propriétaire : « où est-ce que je perds de
 * l'argent sans le voir ? » Quatre lectures :
 *
 *   1. MARGE BRUTE PÉDAGOGIQUE par filière — encaissé moins coût enseignant
 *      direct, moins les charges effectivement affectées à la filière ;
 *   2. LTV PAR FAMILLE, et non par élève : en Afrique de l'Ouest la décision de
 *      scolarisation se prend au niveau du foyer, et une fratrie qui part, ce
 *      sont trois scolarités perdues d'un coup ;
 *   3. RÉTENTION inter-semestres, le meilleur prédicteur de chiffre d'affaires
 *      de l'année suivante ;
 *   4. PRÉVISION DE TRÉSORERIE à 13 semaines, dont le croisement de la courbe
 *      avec zéro est le chiffre le plus important de tout le pilotage.
 *
 * HONNÊTETÉ DES CHIFFRES — la contrainte structurante de cet écran.
 *
 * Le mot « marge » est réservé à un résultat d'exploitation, qui suppose que
 * TOUTES les charges soient saisies. Tant que ce n'est pas le cas, l'indicateur
 * s'appelle « marge brute pédagogique » et la réponse expose une COUVERTURE :
 * combien de sources de coût portent réellement des données. Une marge de 80 %
 * calculée sans aucune charge enregistrée n'est pas une bonne nouvelle, c'est
 * une comptabilité absente — et l'écran doit le dire, pas le laisser deviner.
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

/** Horizon de la prévision de trésorerie, en semaines. */
const FORECAST_WEEKS = 13;

/**
 * Taux de recouvrement retenus pour les trois scénarios de prévision.
 *
 * Ce ne sont pas des paramètres décoratifs : la date à laquelle la courbe croise
 * zéro dépend entièrement d'eux. Les afficher côte à côte évite de faire passer
 * une hypothèse optimiste pour une prédiction.
 */
const FORECAST_SCENARIOS = [
  { key: "prudent", label: "Prudent (70 %)", rate: 0.7 },
  { key: "median", label: "Médian (85 %)", rate: 0.85 },
  { key: "optimiste", label: "Optimiste (100 %)", rate: 1 },
] as const;

const ROWS_LIMIT = 100;

/* --------------------------------- Service -------------------------------- */

export async function fetchOwnerEconomie(
  pool: Pool,
  tenantId: string,
  query: OwnerEconomieQuery,
  log: FastifyBaseLogger
): Promise<OwnerEconomieResponse> {
  const filiereIds = query.filiereIds && query.filiereIds.length > 0 ? query.filiereIds : null;
  const client = await pool.connect();

  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- Couverture des sources de coût ----------------------------------- */
    // Sans cette mesure, une marge élevée se lit comme une performance alors
    // qu'elle ne traduit qu'une absence de saisie.
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
      `WITH ${PRO_UNPAID_INSTALLMENTS_CTE},
       /* Encaissé réparti par filière au prorata des inscriptions : une commande
          peut porter des UE de plusieurs filières, on ne l'affecte jamais en bloc. */
       part_filiere AS (
         SELECT en.order_id, u.filiere_id, SUM(en.prix_unitaire)::float8 AS part
         FROM professional_enrollments en
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
          l'enseignant intervient. */
       cout_enseignant AS (
         SELECT u.filiere_id,
                SUM(tp.total_amount / NULLIF(aff.nb_filieres, 0))::float8 AS cout
         FROM teacher_payments tp
         JOIN LATERAL (
           SELECT COUNT(DISTINCT u2.filiere_id) AS nb_filieres
           FROM professional_session_ecue_teachers st2
           JOIN professional_ue_sessions s2 ON s2.id = st2.ue_session_id AND s2.tenant_id = st2.tenant_id
           JOIN professional_ue u2 ON u2.id = s2.ue_id AND u2.tenant_id = s2.tenant_id
           WHERE st2.enseignant_id = tp.teacher_id AND st2.tenant_id = tp.tenant_id
         ) aff ON aff.nb_filieres > 0
         JOIN professional_session_ecue_teachers st
           ON st.enseignant_id = tp.teacher_id AND st.tenant_id = tp.tenant_id
         JOIN professional_ue_sessions s ON s.id = st.ue_session_id AND s.tenant_id = st.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE tp.tenant_id = $1::uuid
           AND tp.status IN ('calculated'::payment_status, 'approved'::payment_status, 'paid'::payment_status)
         GROUP BY u.filiere_id
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
      [tenantId, filiereIds],
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

    /* ---- LTV par famille --------------------------------------------------- */
    // L'unité économique est le foyer : une fratrie qui part, ce sont plusieurs
    // scolarités perdues le même jour.
    const familleRows = await safeRows<Row>(
      client,
      `WITH ${PRO_UNPAID_INSTALLMENTS_CTE},
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
       JOIN users u ON u.id = sp.parent_id AND u.tenant_id = sp.tenant_id
       LEFT JOIN paiement_par_etudiant pe ON pe.student_id = sp.student_id
       LEFT JOIN anciennete an ON an.student_id = sp.student_id
       WHERE sp.tenant_id = $1::uuid
       GROUP BY u.id, u.first_name, u.last_name
       HAVING COALESCE(SUM(pe.encaisse), 0) > 0 OR COUNT(DISTINCT sp.student_id) > 1
       ORDER BY 4 DESC
       LIMIT ${ROWS_LIMIT}`,
      [tenantId],
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
        // LTV RÉALISÉE : ce que la famille a effectivement payé. Pas une
        // projection — la LTV prédictive exigerait un historique de sortie
        // que la migration 0099 ne commence qu'aujourd'hui à constituer.
        revenuAnnuelMoyen:
          anneesPresence && anneesPresence > 0 ? round0(encaisse / anneesPresence) : null,
      };
    });

    const fratries = familles.filter((f) => f.enfants > 1);

    /* ---- Rétention inter-semestres ----------------------------------------- */
    // Un étudiant est « retenu » s'il réapparaît sur une cohorte démarrant après
    // la fin de la précédente. Mesure directe, sans hypothèse.
    const retentionRows = await safeRows<Row>(
      client,
      `WITH parcours AS (
         SELECT DISTINCT en.student_id, u.filiere_id, s.date_debut, s.date_fin
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE en.tenant_id = $1::uuid
           AND en.statut <> 'annulee'
           AND ($2::uuid[] IS NULL OR u.filiere_id = ANY($2::uuid[]))
       ),
       bornes AS (
         SELECT student_id, filiere_id,
                MIN(date_debut) AS debut,
                MAX(date_fin) AS fin
         FROM parcours GROUP BY student_id, filiere_id
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
      [tenantId, filiereIds],
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

    /* ---- Prévision de trésorerie à 13 semaines ----------------------------- */
    const forecastRows = await safeRows<Row>(
      client,
      `WITH ${PRO_UNPAID_INSTALLMENTS_CTE},
       semaines AS (
         SELECT generate_series(0, ${FORECAST_WEEKS - 1}) AS n
       ),
       grille AS (
         -- Le cast en date précède la soustraction : date_trunc renvoie un
         -- timestamp, et retrancher un entier à un timestamp n'existe pas.
         SELECT n,
                (date_trunc('week', CURRENT_DATE) + (n || ' weeks')::interval)::date AS debut,
                ((date_trunc('week', CURRENT_DATE) + ((n + 1) || ' weeks')::interval)::date - 1) AS fin
         FROM semaines
       )
       SELECT
         g.n,
         g.debut::text AS debut,
         /* Entrées attendues : échéances scolaires + échéances professionnelles
            encore impayées, tombant dans la semaine. */
         COALESCE((
           SELECT SUM(GREATEST(0, sti.amount - sti.amount_paid))::float8
           FROM student_tuition_installments sti
           WHERE sti.tenant_id = $1::uuid
             AND sti.status IN ('pending'::installment_status,
                                'partial'::installment_status,
                                'overdue'::installment_status)
             AND sti.due_date BETWEEN g.debut AND g.fin
         ), 0) AS entrees_scolaire,
         COALESCE((
           SELECT SUM(pu.unpaid)::float8
           FROM pro_unpaid_installments pu
           WHERE pu.due_date BETWEEN g.debut AND g.fin
         ), 0) AS entrees_pro,
         /* Sorties : rémunérations enseignantes calculées ou approuvées et non
            encore payées, plus les charges engagées non décaissées. */
         COALESCE((
           SELECT SUM(tp.total_amount)::float8
           FROM teacher_payments tp
           WHERE tp.tenant_id = $1::uuid
             AND tp.status IN ('calculated'::payment_status, 'approved'::payment_status)
             AND tp.paid_at IS NULL
             AND COALESCE(tp.calculated_at, tp.created_at)::date BETWEEN g.debut - 30 AND g.fin
         ), 0) AS sorties_salaires,
         COALESCE((
           SELECT SUM(e.amount)::float8
           FROM expenses e
           WHERE e.tenant_id = $1::uuid
             AND e.paid_on IS NULL
             AND e.incurred_on BETWEEN g.debut AND g.fin
         ), 0) AS sorties_charges
       FROM grille g
       ORDER BY g.n`,
      [tenantId],
      log,
      "previsionTresorerie"
    );

    // Le solde cumulé part de zéro : c'est une prévision de FLUX, pas de compte
    // en banque — aucune table ne porte le solde bancaire de l'établissement.
    const cumul: Record<string, number> = { prudent: 0, median: 0, optimiste: 0 };
    const forecast = forecastRows.map((r) => {
      const entrees = num(r.entrees_scolaire) + num(r.entrees_pro);
      const sorties = num(r.sorties_salaires) + num(r.sorties_charges);
      const point: Record<string, unknown> = {
        semaine: Math.round(num(r.n)) + 1,
        debut: String(r.debut),
        entreesAttendues: round0(entrees),
        sortiesPrevues: round0(sorties),
      };
      for (const sc of FORECAST_SCENARIOS) {
        cumul[sc.key] += entrees * sc.rate - sorties;
        point[`solde_${sc.key}`] = round0(cumul[sc.key]);
      }
      return point as {
        semaine: number;
        debut: string;
        entreesAttendues: number;
        sortiesPrevues: number;
        solde_prudent: number;
        solde_median: number;
        solde_optimiste: number;
      };
    });

    // Première semaine où le scénario médian passe sous zéro : le chiffre le plus
    // important du tableau de bord, quand il existe.
    const rupture = forecast.find((p) => p.solde_median < 0);

    const totalEncaisse = marges.reduce((s, m) => s + m.encaisse, 0);
    const totalCout = marges.reduce((s, m) => s + m.coutEnseignant + m.chargesAffectees, 0);

    return {
      computedAt: new Date().toISOString(),
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
        semaineRupture: rupture ? rupture.semaine : null,
        dateRupture: rupture ? rupture.debut : null,
      },
      marges,
      familles,
      retention,
      forecast,
      scenarios: FORECAST_SCENARIOS.map((s) => ({ key: s.key, label: s.label })),
    };
  } finally {
    client.release();
  }
}

/** Export CSV : marges par filière et prévision de trésorerie. */
export function buildOwnerEconomieCsv(data: OwnerEconomieResponse): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];

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
  lines.push(`Prévision de trésorerie sur ${data.forecast.length} semaines`);
  lines.push("Semaine;Début;Entrées attendues;Sorties prévues;Solde prudent;Solde médian;Solde optimiste");
  for (const p of data.forecast) {
    lines.push(
      [
        p.semaine,
        p.debut,
        p.entreesAttendues,
        p.sortiesPrevues,
        p.solde_prudent,
        p.solde_median,
        p.solde_optimiste,
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
