import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerFinancesProMode,
  OwnerFinancesProQuery,
  OwnerFinancesProResponse,
} from "@ecoledigitale/contracts";

/**
 * Recouvrement du Module Professionnel (UE / ECUE), absent de /owner/finances qui
 * ne couvre que `payment_transactions` (module académique).
 *
 * Pièges appliqués :
 *  - §4.4-1  `professional_payments` n'a ni `student_id` ni `enrollment_id` :
 *            on remonte systématiquement par `order_id → professional_orders.student_id`.
 *  - §4.4-2  seul `statut = 'confirme'` compte comme encaissement.
 *  - §4.4-3  `professional_orders.statut = 'payee'` ne prouve AUCUN encaissement
 *            (`adminUpdateEnrollment` le force sans ligne de paiement). L'encaissé
 *            vient donc toujours de SUM(professional_payments.montant).
 *  - §4.4-4  un règlement utilisateur unique produit N lignes payments (une par
 *            commande touchée) : les transactions *métier* sont comptées
 *            DISTINCT sur (student_id, paid_at), jamais COUNT(*).
 *  - §4.4-6  DÉCISION PRODUIT : les UE « Conduite » sont INCLUSES ici — c'est du
 *            chiffre d'affaires réellement facturé et encaissé. L'écran admin
 *            /professionnel/admin/paiements les exclut : l'écart est assumé et
 *            signalé au front par `includesConduite: true`.
 *  - §4.4-8  on requête `professional_ue_sessions` en direct (l'endpoint REST
 *            clôturerait les sessions échues au passage).
 *
 * Piège de double comptage (non listé au §4.4, mais structurant) : une commande
 * porte N inscriptions. Tout `orders JOIN enrollments JOIN payments` multiplie les
 * montants par N. On agrège donc les paiements par `order_id` dans un CTE dédié,
 * et on filtre les commandes par filière avec EXISTS — jamais avec un JOIN.
 */

/** Reste dû au-delà duquel un étudiant est considéré non soldé (tolérance d'arrondi). */
export const OWNER_FINANCES_PRO_SETTLED_EPSILON = 0.5;

/** Nombre de lignes du tableau des impayés. */
export const OWNER_FINANCES_PRO_TOP_UNPAID = 20;

/** Profondeur du graphique d'encaissements mensuels. */
export const OWNER_FINANCES_PRO_MONTHS = 12;

async function safeQuery<T>(
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
    log.warn({ err: e, label }, "owner finances pro query failed");
    return [];
  }
}

/**
 * Fenêtre temporelle. Elle filtre la COHORTE de commandes (`orders.created_at`),
 * pas les paiements : l'encaissé est ensuite mesuré sur ces mêmes commandes, quelle
 * que soit la date de règlement. C'est ce qui rend le taux de recouvrement
 * interprétable (sinon on divise des encaissements d'une période par un attendu
 * d'une autre). Le graphique mensuel, lui, est volontairement en 12 mois glissants
 * toutes cohortes confondues — c'est indiqué dans l'UI.
 */
function resolvePeriod(filters: OwnerFinancesProQuery): {
  start: string;
  end: string;
} {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  switch (filters.period) {
    case "month":
      return { start: iso(new Date(Date.UTC(y, m, 1))), end: iso(new Date(Date.UTC(y, m + 1, 1))) };
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      return { start: iso(new Date(Date.UTC(y, q, 1))), end: iso(new Date(Date.UTC(y, q + 3, 1))) };
    }
    case "year":
      return { start: iso(new Date(Date.UTC(y, 0, 1))), end: iso(new Date(Date.UTC(y + 1, 0, 1))) };
    case "academic_year": {
      // Pivot septembre, cohérent avec la dérivation d'année scolaire du module pédagogie.
      const label = filters.anneeScolaire;
      const startYear = label ? Number(label.split("-")[0]) : m >= 8 ? y : y - 1;
      return {
        start: iso(new Date(Date.UTC(startYear, 8, 1))),
        end: iso(new Date(Date.UTC(startYear + 1, 8, 1))),
      };
    }
    case "custom":
    default:
      return {
        start: filters.dateDebut ?? iso(new Date(Date.UTC(y, 0, 1))),
        end: filters.dateFin ?? iso(new Date(Date.UTC(y + 1, 0, 1))),
      };
  }
}

/**
 * Cohorte de commandes du périmètre.
 * $1 tenantId, $2 filiereIds (uuid[] | null), $3 semestreId (uuid | null),
 * $4 start (date), $5 end (date, borne exclue).
 */
const ORDER_SCOPE_CTE = `
  order_scope AS (
    SELECT o.id, o.student_id, o.montant_total::float8 AS montant_total, o.created_at
    FROM professional_orders o
    WHERE o.tenant_id = $1::uuid
      -- §4.4-3 : on ne se fie pas au statut pour l'encaissement, mais une commande
      -- annulée ne fait pas partie du chiffre d'affaires attendu.
      AND o.statut <> 'annulee'
      AND o.created_at >= $4::date
      AND o.created_at <  $5::date
      AND ($2::uuid[] IS NULL OR EXISTS (
        SELECT 1
        FROM professional_enrollments en
        JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
        JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
        WHERE en.order_id = o.id
          AND en.tenant_id = o.tenant_id
          AND en.statut <> 'annulee'
          AND u.filiere_id = ANY($2::uuid[])
      ))
      AND ($3::uuid IS NULL OR EXISTS (
        SELECT 1
        FROM professional_enrollments en
        JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
        WHERE en.order_id = o.id
          AND en.tenant_id = o.tenant_id
          AND en.statut <> 'annulee'
          -- Piège §4.4-5 : double chemin semestre → sessions.
          AND (
            s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                     WHERE semestre_id = $3::uuid AND tenant_id = $1::uuid)
            OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                           WHERE semestre_id = $3::uuid AND tenant_id = $1::uuid)
          )
      ))
  )`;

/**
 * Encaissé par commande — agrégé AVANT toute jointure, pour ne jamais multiplier
 * les montants par le nombre d'inscriptions de la commande.
 */
const PAID_PER_ORDER_CTE = `
  paid_per_order AS (
    SELECT p.order_id, SUM(p.montant)::float8 AS paid
    FROM professional_payments p
    WHERE p.tenant_id = $1::uuid
      AND p.statut = 'confirme'   -- §4.4-2
    GROUP BY p.order_id
  )`;

export async function fetchOwnerFinancesPro(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerFinancesProQuery
): Promise<OwnerFinancesProResponse> {
  const filiereIds =
    filters.filiereIds && filters.filiereIds.length > 0 ? filters.filiereIds : null;
  const semestreId = filters.semestreId ?? null;
  const mode = filters.mode ?? null;
  const etat = filters.etat ?? "tous";
  const { start, end } = resolvePeriod(filters);

  const scopeParams = [tenantId, filiereIds, semestreId, start, end];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- Totaux : attendu, encaissé, recouvrement, étudiants non soldés ---- */
    const totalRows = await safeQuery<{
      expected: string | number | null;
      collected: string | number | null;
      unsettled: string | number;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE},
            ${PAID_PER_ORDER_CTE},
       per_student AS (
         SELECT os.student_id,
                SUM(os.montant_total) AS due,
                SUM(COALESCE(pp.paid, 0)) AS paid
         FROM order_scope os
         LEFT JOIN paid_per_order pp ON pp.order_id = os.id
         GROUP BY os.student_id
       )
       SELECT COALESCE(SUM(due), 0)::float8 AS expected,
              COALESCE(SUM(paid), 0)::float8 AS collected,
              COUNT(*) FILTER (WHERE due - paid > $6::float8)::int AS unsettled
       FROM per_student`,
      [...scopeParams, OWNER_FINANCES_PRO_SETTLED_EPSILON],
      log,
      "totals"
    );

    const t = totalRows[0] ?? { expected: 0, collected: 0, unsettled: 0 };
    const expected = Number(t.expected) || 0;
    const collected = Number(t.collected) || 0;

    /* ---- Encaissements mensuels, 12 mois glissants, toutes cohortes ---- */
    const monthlyRows = await safeQuery<{
      month: string;
      amount: string | number | null;
      tx_count: string | number;
    }>(
      client,
      `SELECT TO_CHAR(COALESCE(p.paid_at, p.created_at), 'YYYY-MM') AS month,
              COALESCE(SUM(p.montant), 0)::float8 AS amount,
              -- §4.4-4 : transactions métier = règlements distincts, pas de lignes.
              COUNT(DISTINCT (o.student_id, p.paid_at))::int AS tx_count
       FROM professional_payments p
       JOIN professional_orders o ON o.id = p.order_id AND o.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1::uuid
         AND p.statut = 'confirme'
         AND COALESCE(p.paid_at, p.created_at)
             >= date_trunc('month', CURRENT_DATE) - make_interval(months => $2::int - 1)
         AND ($3::uuid[] IS NULL OR EXISTS (
           SELECT 1
           FROM professional_enrollments en
           JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
           JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
           WHERE en.order_id = o.id
             AND en.tenant_id = o.tenant_id
             AND en.statut <> 'annulee'
             AND u.filiere_id = ANY($3::uuid[])
         ))
       GROUP BY month
       ORDER BY month`,
      [tenantId, OWNER_FINANCES_PRO_MONTHS, filiereIds],
      log,
      "monthlyCollections"
    );

    /* ---- Répartition par mode de paiement, sur la cohorte du périmètre ---- */
    const modeRows = await safeQuery<{
      mode: string;
      amount: string | number | null;
      count: string | number;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE}
       SELECT p.mode,
              COALESCE(SUM(p.montant), 0)::float8 AS amount,
              COUNT(DISTINCT (os.student_id, p.paid_at))::int AS count
       FROM professional_payments p
       JOIN order_scope os ON os.id = p.order_id
       WHERE p.tenant_id = $1::uuid
         AND p.statut = 'confirme'
         AND ($6::text IS NULL OR p.mode = $6::text)
       GROUP BY p.mode
       ORDER BY amount DESC`,
      [...scopeParams, mode],
      log,
      "byPaymentMode"
    );

    /* ---- Recouvrement par filière ---- */
    const recoveryRows = await safeQuery<{
      filiere_id: string;
      filiere_name: string;
      expected: string | number | null;
      collected: string | number | null;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE},
            ${PAID_PER_ORDER_CTE},
       -- L'attendu est réparti au prorata des inscriptions : une commande peut
       -- porter des UE de plusieurs filières, on ne peut pas l'affecter en bloc.
       enrollment_share AS (
         SELECT en.order_id,
                u.filiere_id,
                SUM(en.prix_unitaire)::float8 AS share
         FROM professional_enrollments en
         JOIN order_scope os ON os.id = en.order_id
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE en.tenant_id = $1::uuid
           AND en.statut <> 'annulee'
         GROUP BY en.order_id, u.filiere_id
       ),
       order_share_total AS (
         SELECT order_id, SUM(share) AS total FROM enrollment_share GROUP BY order_id
       )
       SELECT es.filiere_id,
              p.name AS filiere_name,
              COALESCE(SUM(es.share), 0)::float8 AS expected,
              COALESCE(SUM(COALESCE(pp.paid, 0) * es.share / NULLIF(ost.total, 0)), 0)::float8 AS collected
       FROM enrollment_share es
       JOIN order_share_total ost ON ost.order_id = es.order_id
       LEFT JOIN paid_per_order pp ON pp.order_id = es.order_id
       JOIN programmes p ON p.id = es.filiere_id AND p.tenant_id = $1::uuid
       GROUP BY es.filiere_id, p.name
       ORDER BY p.name`,
      scopeParams,
      log,
      "recoveryByFiliere"
    );

    /* ---- Top des impayés ---- */
    const unpaidRows = await safeQuery<{
      student_id: string;
      student_name: string;
      matricule: string | null;
      filiere_names: string | null;
      due: string | number;
      paid: string | number;
      oldest_unpaid_at: Date | string | null;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE},
            ${PAID_PER_ORDER_CTE},
       per_student AS (
         SELECT os.student_id,
                SUM(os.montant_total) AS due,
                SUM(COALESCE(pp.paid, 0)) AS paid,
                MIN(os.created_at) FILTER (
                  WHERE os.montant_total - COALESCE(pp.paid, 0) > $6::float8
                ) AS oldest_unpaid_at
         FROM order_scope os
         LEFT JOIN paid_per_order pp ON pp.order_id = os.id
         GROUP BY os.student_id
       )
       SELECT ps.student_id,
              TRIM(COALESCE(us.first_name, '') || ' ' || COALESCE(us.last_name, '')) AS student_name,
              -- establishment_matricule n'existe dans aucune migration : on utilise
              -- student_number, la seule colonne matricule réellement définie (0003).
              sp.student_number AS matricule,
              (SELECT string_agg(DISTINCT pr.name, ', ')
               FROM professional_enrollments en
               JOIN order_scope os2 ON os2.id = en.order_id AND os2.student_id = ps.student_id
               JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
               JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
               JOIN programmes pr ON pr.id = u.filiere_id AND pr.tenant_id = $1::uuid
               WHERE en.tenant_id = $1::uuid AND en.statut <> 'annulee') AS filiere_names,
              ps.due::float8 AS due,
              ps.paid::float8 AS paid,
              ps.oldest_unpaid_at
       FROM per_student ps
       JOIN student_profiles sp ON sp.id = ps.student_id AND sp.tenant_id = $1::uuid
       JOIN users us ON us.id = sp.user_id AND us.tenant_id = sp.tenant_id
       WHERE CASE $7::text
               WHEN 'non_regle' THEN ps.paid <= $6::float8
               WHEN 'partiel'   THEN ps.paid > $6::float8 AND ps.due - ps.paid > $6::float8
               WHEN 'solde'     THEN ps.due - ps.paid <= $6::float8
               ELSE ps.due - ps.paid > $6::float8
             END
       ORDER BY (ps.due - ps.paid) DESC
       LIMIT $8::int`,
      [
        ...scopeParams,
        OWNER_FINANCES_PRO_SETTLED_EPSILON,
        etat,
        OWNER_FINANCES_PRO_TOP_UNPAID,
      ],
      log,
      "topUnpaid"
    );

    /* ---- Chiffre d'affaires par UE ---- */
    const ueRevenueRows = await safeQuery<{
      ue_id: string;
      code: string;
      libelle: string;
      filiere_name: string;
      confirmed: string | number;
      revenue: string | number | null;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE}
       SELECT u.id AS ue_id,
              u.code,
              u.libelle,
              p.name AS filiere_name,
              COUNT(*)::int AS confirmed,
              -- Le CA réel est la somme des prix figés à l'inscription, pas
              -- professional_ue.prix × N : le tarif de l'UE a pu changer depuis.
              COALESCE(SUM(en.prix_unitaire), 0)::float8 AS revenue
       FROM professional_enrollments en
       JOIN order_scope os ON os.id = en.order_id
       JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = $1::uuid
       WHERE en.tenant_id = $1::uuid
         AND en.statut IN ('confirmee', 'terminee')
       GROUP BY u.id, u.code, u.libelle, p.name
       ORDER BY revenue DESC
       LIMIT 20`,
      scopeParams,
      log,
      "revenueByUe"
    );

    /* ---- Entonnoir des inscriptions ---- */
    const funnelRows = await safeQuery<{
      created: string | number;
      confirmed: string | number;
      completed: string | number;
      cancelled: string | number;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE}
       SELECT COUNT(*)::int AS created,
              COUNT(*) FILTER (WHERE en.statut = 'confirmee')::int AS confirmed,
              COUNT(*) FILTER (WHERE en.statut = 'terminee')::int AS completed,
              COUNT(*) FILTER (WHERE en.statut = 'annulee')::int AS cancelled
       FROM professional_enrollments en
       JOIN order_scope os ON os.id = en.order_id
       WHERE en.tenant_id = $1::uuid`,
      scopeParams,
      log,
      "enrollmentFunnel"
    );

    const f = funnelRows[0] ?? { created: 0, confirmed: 0, completed: 0, cancelled: 0 };

    return {
      period: filters.period ?? "year",
      periodStart: start,
      periodEnd: end,
      filiereIds: filiereIds ?? [],
      semestreId,
      mode: mode as OwnerFinancesProMode | null,
      etat,
      includesConduite: true,
      totals: {
        expected: Math.round(expected),
        collected: Math.round(collected),
        recoveryRate:
          expected > 0 ? Math.round((collected * 1000) / expected) / 10 : 0,
        outstanding: Math.max(0, Math.round(expected - collected)),
        unsettledStudents: Number(t.unsettled) || 0,
      },
      monthlyCollections: monthlyRows.map((r) => ({
        month: r.month,
        amount: Math.round(Number(r.amount) || 0),
        transactionCount: Number(r.tx_count) || 0,
      })),
      byPaymentMode: modeRows
        .filter((r): r is typeof r & { mode: OwnerFinancesProMode } =>
          ["especes", "mobile_money", "virement", "autre"].includes(r.mode)
        )
        .map((r) => ({
          mode: r.mode,
          amount: Math.round(Number(r.amount) || 0),
          count: Number(r.count) || 0,
        })),
      recoveryByFiliere: recoveryRows.map((r) => {
        const exp = Number(r.expected) || 0;
        const col = Number(r.collected) || 0;
        return {
          filiereId: r.filiere_id,
          filiereName: r.filiere_name,
          expected: Math.round(exp),
          collected: Math.round(col),
          recoveryRate: exp > 0 ? Math.round((col * 1000) / exp) / 10 : 0,
        };
      }),
      topUnpaid: unpaidRows.map((r) => {
        const due = Number(r.due) || 0;
        const paid = Number(r.paid) || 0;
        return {
          studentId: r.student_id,
          studentName: r.student_name || "—",
          matricule: r.matricule,
          filiereNames: r.filiere_names,
          due: Math.round(due),
          paid: Math.round(paid),
          outstanding: Math.round(due - paid),
          oldestUnpaidAt:
            r.oldest_unpaid_at instanceof Date
              ? r.oldest_unpaid_at.toISOString().slice(0, 10)
              : r.oldest_unpaid_at
                ? String(r.oldest_unpaid_at).slice(0, 10)
                : null,
        };
      }),
      revenueByUe: ueRevenueRows.map((r) => ({
        ueId: r.ue_id,
        code: r.code,
        libelle: r.libelle,
        filiereName: r.filiere_name,
        confirmedEnrollments: Number(r.confirmed) || 0,
        revenue: Math.round(Number(r.revenue) || 0),
      })),
      enrollmentFunnel: {
        created: Number(f.created) || 0,
        confirmed: Number(f.confirmed) || 0,
        completed: Number(f.completed) || 0,
        cancelled: Number(f.cancelled) || 0,
      },
    };
  } finally {
    client.release();
  }
}
