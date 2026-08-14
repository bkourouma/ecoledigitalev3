import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerPulseKpi,
  OwnerPulseResponse,
  OwnerPulseStatus,
} from "@ecoledigitale/contracts/src/owner-stats.schema";
import { PRO_UNPAID_INSTALLMENTS_CTE } from "./owner-pro-outstanding.sql";

/**
 * Le « pouls » de l'établissement : les 8 chiffres qu'un propriétaire regarde
 * en premier, dans l'ordre où il se pose les questions —
 *   est-ce que l'argent rentre ? → est-ce que les effectifs tiennent ?
 *   → est-ce que la machine pédagogique tourne ? → où est-ce que je perds ?
 *
 * Deux principes non négociables ici :
 *
 * 1. AUCUN CHIFFRE INVENTÉ. Chaque valeur vient d'une requête sur des colonnes
 *    réelles. Quand la donnée n'existe pas (charges d'exploitation, échéancier
 *    du module professionnel), l'indicateur est renvoyé avec `measured: false`
 *    et le libellé dit ce qu'il mesure vraiment — « solde encaissements moins
 *    salaires », jamais « marge ».
 *
 * 2. AUCUNE TRONCATURE SILENCIEUSE. Tous les totaux sont des agrégats SQL sur
 *    l'intégralité du périmètre, jamais des sommes TypeScript sur une liste
 *    plafonnée.
 *
 * Le périmètre « école » consolide les deux moteurs métier : le scolaire
 * classique (`student_tuition_installments`, `payment_transactions`, `classes`)
 * et le professionnel UE/ECUE (`professional_orders`, `professional_payments`,
 * `professional_ue_sessions`). Aucun autre écran ne les additionne aujourd'hui.
 *
 * Performance : une requête par indicateur, chacune indépendante et tolérante à
 * l'échec (un KPI cassé n'emporte pas les sept autres). Si le temps de réponse
 * devient un sujet, c'est ici qu'une vue matérialisée rafraîchie toutes les
 * 15 min viendra se brancher, `computedAt` étant déjà exposé pour l'annoncer.
 */

/* --------------------------------- Outils --------------------------------- */

type Row = Record<string, unknown>;

/** Exécute une requête, renvoie la première ligne ou `null` en cas d'échec. */
async function safeRow<T extends Row>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<T | null> {
  try {
    const res = await client.query<T>(sql, params);
    return res.rows[0] ?? null;
  } catch (e) {
    log.warn({ err: e, label }, "owner pulse query failed");
    return null;
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** `null` si la valeur est absente — à distinguer d'un vrai zéro. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

const fcfa = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
function fmtFcfa(v: number): string {
  return `${fcfa.format(Math.round(v))} FCFA`;
}
function fmtPct(v: number): string {
  return `${v.toFixed(1).replace(".", ",")} %`;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Applique deux seuils décroissants (au-dessus = bien). */
function statusAbove(value: number | null, warn: number, crit: number): OwnerPulseStatus {
  if (value === null) return "neutral";
  if (value < crit) return "critical";
  if (value < warn) return "warning";
  return "good";
}

/* ------------------------- Fenêtres et paramètres -------------------------- */

/**
 * Fenêtre de l'année scolaire courante.
 *
 * On prend l'année académique active quand elle existe. Sinon on retombe sur le
 * pivot de septembre — la même convention que le reste du module professionnel,
 * qui n'a pas de colonne d'année scolaire.
 */
const ACADEMIC_WINDOW_CTE = `
  ay AS (
    SELECT name, start_date, end_date
    FROM academic_years
    WHERE tenant_id = $1::uuid AND is_active
    ORDER BY start_date DESC
    LIMIT 1
  ),
  win AS (
    SELECT
      COALESCE(
        (SELECT start_date FROM ay),
        make_date(
          CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 9
               THEN EXTRACT(YEAR FROM CURRENT_DATE)::int
               ELSE EXTRACT(YEAR FROM CURRENT_DATE)::int - 1 END,
          9, 1)
      ) AS d1,
      COALESCE((SELECT end_date FROM ay), CURRENT_DATE + INTERVAL '1 year') AS d2,
      (SELECT name FROM ay) AS label
  )`;

/** Ancienneté à partir de laquelle un impayé devient préoccupant. */
const AGED_DAYS = 60;

/* --------------------------------- Service -------------------------------- */

export async function fetchOwnerPulse(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<OwnerPulseResponse> {
  const client = await pool.connect();
  const kpis: OwnerPulseKpi[] = [];
  let academicYearLabel: string | null = null;

  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const yearRow = await safeRow<{ label: string | null }>(
      client,
      `WITH ${ACADEMIC_WINDOW_CTE} SELECT label FROM win`,
      [tenantId],
      log,
      "academicYear"
    );
    academicYearLabel = (yearRow?.label as string | null) ?? null;

    /* ---- KPI 1 — Encaissements du mois (toutes activités) ---------------- */
    // Scolaire (payment_transactions) + professionnel (professional_payments).
    // Comparaison à date : on ne compare que les jours déjà écoulés du mois
    // précédent, sinon le 3 du mois on se croit toujours en chute libre.
    const cash = await safeRow<Row>(
      client,
      `SELECT
         (SELECT COALESCE(SUM(amount), 0)::float8
            FROM payment_transactions
           WHERE tenant_id = $1::uuid
             AND status = 'completed'::transaction_status
             AND date_trunc('month', COALESCE(processed_at, created_at))
                 = date_trunc('month', CURRENT_DATE))
       + (SELECT COALESCE(SUM(montant), 0)::float8
            FROM professional_payments
           WHERE tenant_id = $1::uuid
             AND statut = 'confirme'
             AND date_trunc('month', COALESCE(paid_at, created_at))
                 = date_trunc('month', CURRENT_DATE)) AS current_month,
         (SELECT COALESCE(SUM(amount), 0)::float8
            FROM payment_transactions
           WHERE tenant_id = $1::uuid
             AND status = 'completed'::transaction_status
             AND date_trunc('month', COALESCE(processed_at, created_at))
                 = date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
             AND EXTRACT(DAY FROM COALESCE(processed_at, created_at))
                 <= EXTRACT(DAY FROM CURRENT_DATE))
       + (SELECT COALESCE(SUM(montant), 0)::float8
            FROM professional_payments
           WHERE tenant_id = $1::uuid
             AND statut = 'confirme'
             AND date_trunc('month', COALESCE(paid_at, created_at))
                 = date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
             AND EXTRACT(DAY FROM COALESCE(paid_at, created_at))
                 <= EXTRACT(DAY FROM CURRENT_DATE)) AS previous_month,
         (SELECT COALESCE(SUM(amount), 0)::float8
            FROM payment_transactions
           WHERE tenant_id = $1::uuid
             AND status = 'completed'::transaction_status
             AND date_trunc('month', COALESCE(processed_at, created_at))
                 = date_trunc('month', CURRENT_DATE - INTERVAL '1 year')
             AND EXTRACT(DAY FROM COALESCE(processed_at, created_at))
                 <= EXTRACT(DAY FROM CURRENT_DATE))
       + (SELECT COALESCE(SUM(montant), 0)::float8
            FROM professional_payments
           WHERE tenant_id = $1::uuid
             AND statut = 'confirme'
             AND date_trunc('month', COALESCE(paid_at, created_at))
                 = date_trunc('month', CURRENT_DATE - INTERVAL '1 year')
             AND EXTRACT(DAY FROM COALESCE(paid_at, created_at))
                 <= EXTRACT(DAY FROM CURRENT_DATE)) AS same_month_last_year`,
      [tenantId],
      log,
      "cashCollectedThisMonth"
    );

    const cashNow = num(cash?.current_month);
    const cashPrev = cash ? num(cash.previous_month) : null;
    const cashLastYear = cash ? num(cash.same_month_last_year) : 0;
    // Le calendrier scolaire est très saisonnier (pic septembre-octobre, creux
    // juillet-août) : l'écart au même mois de l'an dernier est plus parlant que
    // l'écart au mois précédent, on le met donc en sous-valeur.
    const cashStatus: OwnerPulseStatus =
      cashLastYear <= 0
        ? "neutral"
        : cashNow < cashLastYear * 0.75
          ? "critical"
          : cashNow < cashLastYear * 0.9
            ? "warning"
            : "good";

    kpis.push({
      key: "cash_collected_month",
      label: "Encaissements du mois",
      value: Math.round(cashNow),
      unit: "fcfa",
      previousValue: cashPrev === null ? null : Math.round(cashPrev),
      previousLabel: "mois dernier, à la même date",
      status: cashStatus,
      hint: "Scolarité et module professionnel confondus. Seuls les paiements confirmés sont comptés.",
      detail:
        cashLastYear > 0
          ? `${fmtFcfa(cashLastYear)} au même mois l'an dernier`
          : "Pas d'historique sur le même mois l'an dernier",
      href: "/owner/finances",
      measured: cash !== null,
    });

    /* ---- KPI 2 — Taux de recouvrement consolidé -------------------------- */
    const recovery = await safeRow<Row>(
      client,
      `WITH ${ACADEMIC_WINDOW_CTE},
       ${PRO_UNPAID_INSTALLMENTS_CTE},
       scolaire AS (
         SELECT COALESCE(SUM(sti.amount), 0)::float8 AS due,
                COALESCE(SUM(sti.amount_paid), 0)::float8 AS paid
         FROM student_tuition_installments sti
         JOIN student_enrollments se
           ON se.id = sti.enrollment_id AND se.tenant_id = sti.tenant_id
         CROSS JOIN win
         WHERE sti.tenant_id = $1::uuid
           AND sti.due_date BETWEEN win.d1 AND win.d2
       ),
       /* L'attendu professionnel est ancré sur les ÉCHÉANCES de la fenêtre, pas
          sur la date de création de la commande : sinon le taux de recouvrement
          ne parle pas de la même dette que la balance âgée.
          Le montant est ajusté au total réel de la commande et le reste dû suit
          l'imputation « plus ancienne échéance d'abord » — l'encaissé s'en
          déduit, sans second calcul qui divergerait. */
       pro AS (
         SELECT COALESCE(SUM(si.montant), 0)::float8 AS due,
                COALESCE(SUM(si.montant - COALESCE(pu.unpaid, 0)), 0)::float8 AS paid
         FROM pro_scaled_installments si
         LEFT JOIN pro_unpaid_installments pu
           ON pu.order_id = si.order_id AND pu.due_date = si.due_date
         CROSS JOIN win
         WHERE si.due_date BETWEEN win.d1 AND win.d2
       )
       SELECT (scolaire.due + pro.due) AS due,
              (scolaire.paid + pro.paid) AS paid
       FROM scolaire, pro`,
      [tenantId],
      log,
      "recoveryRateConsolidated"
    );

    const recDue = num(recovery?.due);
    const recPaid = num(recovery?.paid);
    const recRate = recDue > 0 ? round1((100 * recPaid) / recDue) : null;

    kpis.push({
      key: "recovery_rate",
      label: "Taux de recouvrement",
      value: recRate ?? 0,
      unit: "percent",
      previousValue: null,
      previousLabel: "sur l'année scolaire en cours",
      status: statusAbove(recRate, 85, 70),
      hint: "Encaissé rapporté à l'attendu sur l'année scolaire en cours, scolarité et module professionnel confondus. Un taux bas en octobre est normal ; en mai il ne l'est plus.",
      detail:
        recDue > 0
          ? `${fmtFcfa(recPaid)} encaissés sur ${fmtFcfa(recDue)}`
          : // Rien d'exigible sur l'année en cours ne veut pas dire « rien à
            // recouvrer » : la dette peut être entièrement antérieure.
            academicYearLabel
            ? `Aucune échéance sur l'année ${academicYearLabel} — voir le reste à recouvrer des années antérieures`
            : "Aucune année académique active : la fenêtre de calcul retombe sur le pivot de septembre",
      href: "/owner/finances",
      measured: recovery !== null && recDue > 0,
    });

    /* ---- KPI 3 — Reste à recouvrer, dont ancien --------------------------- */
    // L'ancienneté professionnelle s'appuie sur `professional_order_installments`
    // (migration 0096), avec la MÊME imputation que l'écran Trésorerie : un
    // versement solde les échéances les plus anciennes d'abord.
    //
    // C'est indispensable : ancrer l'ancienneté sur la date de création de la
    // commande donnerait ici un chiffre différent de celui affiché sur l'écran
    // de détail, pour la même dette. Deux nombres contradictoires sur le même
    // sujet valent moins que pas de nombre du tout.
    const outstanding = await safeRow<Row>(
      client,
      `WITH ${PRO_UNPAID_INSTALLMENTS_CTE},
       scolaire AS (
         SELECT COALESCE(SUM(GREATEST(0, sti.amount - sti.amount_paid)), 0)::float8 AS rest,
                COALESCE(SUM(CASE WHEN sti.due_date < CURRENT_DATE - INTERVAL '${AGED_DAYS} days'
                                  THEN GREATEST(0, sti.amount - sti.amount_paid) ELSE 0 END), 0)::float8 AS aged
         FROM student_tuition_installments sti
         WHERE sti.tenant_id = $1::uuid
           AND sti.status IN ('pending'::installment_status,
                              'partial'::installment_status,
                              'overdue'::installment_status)
       ),
       pro AS (
         SELECT COALESCE(SUM(unpaid), 0)::float8 AS rest,
                COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE - INTERVAL '${AGED_DAYS} days'
                                  THEN unpaid ELSE 0 END), 0)::float8 AS aged
         FROM pro_unpaid_installments
       ),
       /* Part des commandes encore adossées à l'échéance par défaut de la
          migration : au-dessus de zéro, l'ancienneté est une convention. */
       defaut AS (
         SELECT CASE WHEN COUNT(*) > 0
                     THEN 100.0 * COUNT(*) FILTER (WHERE is_default) / COUNT(*)
                     ELSE 0 END AS share
         FROM professional_order_installments
         WHERE tenant_id = $1::uuid
       )
       SELECT (scolaire.rest + pro.rest) AS rest,
              (scolaire.aged + pro.aged) AS aged,
              defaut.share AS default_share
       FROM scolaire, pro, defaut`,
      [tenantId],
      log,
      "outstanding"
    );

    const rest = num(outstanding?.rest);
    const aged = num(outstanding?.aged);
    const agedShare = rest > 0 ? (100 * aged) / rest : 0;
    const proDefaultShare = num(outstanding?.default_share);

    kpis.push({
      key: "outstanding",
      label: "Reste à recouvrer",
      value: Math.round(rest),
      unit: "fcfa",
      previousValue: null,
      previousLabel: "stock à date",
      status: rest <= 0 ? "good" : agedShare > 30 ? "critical" : agedShare > 15 ? "warning" : "good",
      hint:
        proDefaultShare > 0
          ? `Scolarité et module professionnel, ancienneté calculée sur les échéances. ${fmtPct(round1(proDefaultShare))} des commandes professionnelles utilisent encore l'échéance par défaut (exigible à l'ouverture de la cohorte) : leur ancienneté est une convention, pas une échéance négociée.`
          : "Scolarité et module professionnel, ancienneté calculée sur les échéances impayées, les plus anciennes soldées en premier.",
      detail:
        rest > 0
          ? `dont ${fmtFcfa(aged)} dus depuis plus de ${AGED_DAYS} jours (${fmtPct(round1(agedShare))})`
          : null,
      href: "/owner/finances",
      measured: outstanding !== null,
    });

    /* ---- KPI 4 — Effectif actif consolidé -------------------------------- */
    // Union sur `student_id` : un étudiant inscrit aux deux moteurs ne compte
    // qu'une fois. La comparaison est l'effectif de rentrée (toutes inscriptions
    // de l'année, quel que soit leur statut actuel) : l'écart mesure l'attrition.
    const headcount = await safeRow<Row>(
      client,
      `WITH ${ACADEMIC_WINDOW_CTE},
       inscrits AS (
         SELECT se.student_id, (sp.status = 'active'::student_status) AS still_active
         FROM student_enrollments se
         JOIN student_profiles sp ON sp.id = se.student_id AND sp.tenant_id = se.tenant_id
         JOIN academic_years a ON a.id = se.academic_year_id AND a.tenant_id = se.tenant_id
         WHERE se.tenant_id = $1::uuid AND a.is_active
         UNION
         SELECT pe.student_id, (pe.statut IN ('confirmee', 'terminee')) AS still_active
         FROM professional_enrollments pe
         CROSS JOIN win
         WHERE pe.tenant_id = $1::uuid
           AND pe.created_at::date BETWEEN win.d1 AND win.d2
       )
       SELECT
         (SELECT COUNT(DISTINCT student_id) FILTER (WHERE still_active) FROM inscrits)::int AS actifs,
         (SELECT COUNT(DISTINCT student_id) FROM inscrits)::int AS rentree,
         -- Fiches actives que rien ne rattache à l'année en cours : ce ne sont
         -- pas des départs, ce sont des réinscriptions à relancer.
         (SELECT COUNT(*) FROM student_profiles sp
           WHERE sp.tenant_id = $1::uuid
             AND sp.status = 'active'::student_status
             AND NOT EXISTS (SELECT 1 FROM inscrits i WHERE i.student_id = sp.id))::int AS sans_inscription`,
      [tenantId],
      log,
      "headcount"
    );

    const actifs = num(headcount?.actifs);
    const rentree = num(headcount?.rentree);
    const sansInscription = num(headcount?.sans_inscription);
    const attrition = rentree > 0 ? (100 * (rentree - actifs)) / rentree : 0;

    // Une fiche active sans inscription sur l'année en cours est du chiffre
    // d'affaires récupérable, pas une perte : c'est une file de relance.
    const headcountDetail =
      sansInscription > 0
        ? `${sansInscription} fiche(s) active(s) sans inscription sur l'année en cours — à relancer`
        : rentree > actifs
          ? `${rentree - actifs} départ(s) depuis la rentrée (${fmtPct(round1(attrition))})`
          : rentree > 0
            ? "Aucun départ depuis la rentrée"
            : null;

    kpis.push({
      key: "headcount_active",
      label: "Effectif actif",
      value: Math.round(actifs),
      unit: "count",
      previousValue: rentree > 0 ? Math.round(rentree) : null,
      previousLabel: "inscrits depuis la rentrée",
      status:
        rentree === 0
          ? sansInscription > 0
            ? "critical"
            : "neutral"
          : attrition > 5
            ? "critical"
            : attrition > 3
              ? "warning"
              : "good",
      hint: "Étudiants distincts ayant une inscription sur l'année en cours, scolaire et professionnel confondus : un étudiant inscrit aux deux moteurs ne compte qu'une fois.",
      detail: headcountDetail,
      href: "/owner/personnes",
      measured: headcount !== null,
    });

    /* ---- KPI 5 — Taux de remplissage ------------------------------------- */
    // Les deux moitiés existent déjà dans l'API sans être affichées nulle part :
    // `professional_ue_sessions.capacite_max` et `classes.max_students`.
    const fill = await safeRow<Row>(
      client,
      `WITH ${ACADEMIC_WINDOW_CTE},
       pro AS (
         SELECT COALESCE(SUM(s.capacite_max), 0)::float8 AS capacity,
                COALESCE(SUM((SELECT COUNT(*) FROM professional_enrollments pe
                               WHERE pe.ue_session_id = s.id
                                 AND pe.tenant_id = s.tenant_id
                                 AND pe.statut <> 'annulee')), 0)::float8 AS seats
         FROM professional_ue_sessions s
         WHERE s.tenant_id = $1::uuid
           AND s.capacite_max IS NOT NULL AND s.capacite_max > 0
           AND CURRENT_DATE BETWEEN s.date_debut AND s.date_fin
       ),
       scolaire AS (
         SELECT COALESCE(SUM(c.max_students), 0)::float8 AS capacity,
                COALESCE(SUM((SELECT COUNT(*) FROM student_enrollments se
                               WHERE se.class_id = c.id
                                 AND se.tenant_id = c.tenant_id
                                 AND se.status = 'active'::enrollment_status)), 0)::float8 AS seats
         FROM classes c
         JOIN academic_years a ON a.id = c.academic_year_id AND a.tenant_id = c.tenant_id
         WHERE c.tenant_id = $1::uuid
           AND a.is_active
           AND c.max_students IS NOT NULL AND c.max_students > 0
       )
       SELECT (pro.capacity + scolaire.capacity) AS capacity,
              (pro.seats + scolaire.seats) AS seats
       FROM pro, scolaire`,
      [tenantId],
      log,
      "fillRate"
    );

    const capacity = num(fill?.capacity);
    const seats = num(fill?.seats);
    const fillRate = capacity > 0 ? round1((100 * seats) / capacity) : null;

    kpis.push({
      key: "fill_rate",
      label: "Taux de remplissage",
      value: fillRate ?? 0,
      unit: "percent",
      previousValue: null,
      previousLabel: "cohortes et classes en cours",
      status:
        fillRate === null
          ? "neutral"
          : fillRate > 100
            ? "warning"
            : fillRate < 50
              ? "critical"
              : fillRate < 70
                ? "warning"
                : "good",
      hint: "Places occupées sur places déclarées, cohortes professionnelles en cours et classes de l'année active. Les cohortes et classes sans capacité renseignée sont exclues du calcul.",
      detail: capacity > 0 ? `${Math.round(seats)} places occupées sur ${Math.round(capacity)}` : null,
      href: "/owner/academique",
      measured: fill !== null && capacity > 0,
    });

    /* ---- KPI 6 — Taux de présence sur 30 jours --------------------------- */
    // EN HEURES, pas en nombre de pointages : une heure d'absence en atelier
    // n'a pas le même poids qu'un pointage manqué en amphi. `heure_debut` et
    // `heure_fin` étant NULLABLE, on mesure aussi la couverture et on l'annonce.
    const presence = await safeRow<Row>(
      client,
      `WITH marks AS (
         SELECT a.statut,
                CASE WHEN s.date >= CURRENT_DATE - INTERVAL '30 days' THEN 'now' ELSE 'before' END AS bucket,
                CASE WHEN s.heure_debut IS NOT NULL AND s.heure_fin IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (s.heure_fin - s.heure_debut)) / 3600.0
                     ELSE NULL END AS hours
         FROM professional_ecue_attendance a
         JOIN professional_ecue_seances s ON s.id = a.seance_id AND s.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1::uuid
           AND s.date >= CURRENT_DATE - INTERVAL '60 days'
       )
       SELECT
         COALESCE(SUM(hours) FILTER (WHERE bucket = 'now'), 0)::float8 AS hours_now,
         COALESCE(SUM(hours) FILTER (WHERE bucket = 'now' AND statut IN ('present', 'retard')), 0)::float8 AS hours_present_now,
         COALESCE(SUM(hours) FILTER (WHERE bucket = 'before'), 0)::float8 AS hours_before,
         COALESCE(SUM(hours) FILTER (WHERE bucket = 'before' AND statut IN ('present', 'retard')), 0)::float8 AS hours_present_before,
         COUNT(*) FILTER (WHERE bucket = 'now')::int AS marks_now,
         COUNT(*) FILTER (WHERE bucket = 'now' AND hours IS NULL)::int AS marks_without_hours
       FROM marks`,
      [tenantId],
      log,
      "presenceRate"
    );

    const hoursNow = num(presence?.hours_now);
    const presentNow = num(presence?.hours_present_now);
    const hoursBefore = num(presence?.hours_before);
    const presentBefore = num(presence?.hours_present_before);
    const marksNow = num(presence?.marks_now);
    const marksNoHours = num(presence?.marks_without_hours);

    const presenceRate = hoursNow > 0 ? round1((100 * presentNow) / hoursNow) : null;
    const presencePrev = hoursBefore > 0 ? round1((100 * presentBefore) / hoursBefore) : null;
    const uncovered = marksNow > 0 ? round1((100 * marksNoHours) / marksNow) : 0;

    kpis.push({
      key: "presence_rate",
      label: "Présence (30 jours)",
      value: presenceRate ?? 0,
      unit: "percent",
      previousValue: presencePrev,
      previousLabel: "30 jours précédents",
      status: statusAbove(presenceRate, 85, 70),
      hint:
        marksNoHours > 0
          ? `Calculé en heures de cours, pas en nombre d'appels. ${fmtPct(uncovered)} des pointages portent sur une séance sans horaire saisi et sont exclus du calcul.`
          : "Calculé en heures de cours et non en nombre d'appels : une heure d'absence en atelier ne vaut pas un pointage manqué en amphi.",
      detail:
        hoursNow > 0
          ? `${Math.round(hoursNow - presentNow)} h d'absence sur ${Math.round(hoursNow)} h suivies`
          : null,
      href: "/owner/assiduite",
      measured: presence !== null && hoursNow > 0,
    });

    /* ---- KPI 7 — Taux de réussite du dernier semestre clos ---------------- */
    const success = await safeRow<Row>(
      client,
      `WITH ranked AS (
         SELECT semestre_id, MAX(generated_at) AS last_gen
         FROM professional_bulletins
         WHERE tenant_id = $1::uuid
         GROUP BY semestre_id
         ORDER BY last_gen DESC
         LIMIT 2
       ),
       ordered AS (
         SELECT semestre_id, row_number() OVER (ORDER BY last_gen DESC) AS rk FROM ranked
       )
       SELECT
         COUNT(*) FILTER (WHERE o.rk = 1)::int AS total_current,
         COUNT(*) FILTER (WHERE o.rk = 1 AND b.data->>'decision' = 'admis')::int AS admis_current,
         COUNT(*) FILTER (WHERE o.rk = 2)::int AS total_previous,
         COUNT(*) FILTER (WHERE o.rk = 2 AND b.data->>'decision' = 'admis')::int AS admis_previous
       FROM professional_bulletins b
       JOIN ordered o ON o.semestre_id = b.semestre_id
       WHERE b.tenant_id = $1::uuid`,
      [tenantId],
      log,
      "successRate"
    );

    const totalCurrent = num(success?.total_current);
    const admisCurrent = num(success?.admis_current);
    const totalPrevious = num(success?.total_previous);
    const admisPrevious = num(success?.admis_previous);
    const successRate = totalCurrent > 0 ? round1((100 * admisCurrent) / totalCurrent) : null;
    const successPrev = totalPrevious > 0 ? round1((100 * admisPrevious) / totalPrevious) : null;

    // Un taux quasi parfait sur une cohorte nombreuse est un signal de notation
    // non discriminante, pas une bonne nouvelle : on le signale aussi.
    const successStatus: OwnerPulseStatus =
      successRate === null
        ? "neutral"
        : successRate > 97 && totalCurrent >= 20
          ? "warning"
          : statusAbove(successRate, 70, 55);

    kpis.push({
      key: "success_rate",
      label: "Réussite du dernier semestre",
      value: successRate ?? 0,
      unit: "percent",
      previousValue: successPrev,
      previousLabel: "semestre précédent",
      status: successStatus,
      hint:
        successRate !== null && successRate > 97 && totalCurrent >= 20
          ? "Part d'admis sur le dernier semestre dont des bulletins ont été générés. Au-delà de 97 % sur une promotion nombreuse, c'est la notation qu'il faut regarder, pas le résultat."
          : "Part d'admis sur le dernier semestre dont des bulletins ont été générés.",
      detail: totalCurrent > 0 ? `${Math.round(admisCurrent)} admis sur ${Math.round(totalCurrent)}` : null,
      href: "/owner/pedagogie",
      measured: success !== null && totalCurrent > 0,
    });

    /* ---- KPI 8 — Solde encaissements moins salaires ---------------------- */
    // Ce n'est PAS une marge : aucune table de dépenses n'existe (loyer,
    // énergie, fournitures, amortissements). Le libellé le dit, le `hint` aussi,
    // et `measured` reste vrai car les deux termes calculés sont exacts.
    const payroll = await safeRow<Row>(
      client,
      `SELECT COALESCE(SUM(total_amount), 0)::float8 AS v
         FROM teacher_payments
        WHERE tenant_id = $1::uuid
          AND status IN ('calculated'::payment_status,
                         'approved'::payment_status,
                         'paid'::payment_status)
          AND date_trunc('month', COALESCE(calculated_at, created_at))
              = date_trunc('month', CURRENT_DATE)`,
      [tenantId],
      log,
      "payrollThisMonth"
    );

    const payrollAmount = num(payroll?.v);
    const balance = cashNow - payrollAmount;
    const payrollShare = cashNow > 0 ? (100 * payrollAmount) / cashNow : 0;

    kpis.push({
      key: "operating_balance",
      label: "Encaissements − salaires",
      value: Math.round(balance),
      unit: "fcfa",
      previousValue: null,
      previousLabel: "mois en cours",
      status:
        balance < 0 ? "critical" : payrollShare > 60 ? "warning" : cashNow === 0 ? "neutral" : "good",
      hint: "Encaissements du mois moins les rémunérations enseignantes calculées, approuvées ou payées. Ce n'est pas un résultat d'exploitation : loyer, énergie, fournitures et amortissements ne sont dans aucune table.",
      detail:
        cashNow > 0
          ? `${fmtFcfa(payrollAmount)} de salaires, soit ${fmtPct(round1(payrollShare))} des encaissements`
          : payrollAmount > 0
            ? `${fmtFcfa(payrollAmount)} de salaires, aucun encaissement ce mois-ci`
            : null,
      href: "/owner/staff",
      measured: payroll !== null && cash !== null,
    });
  } finally {
    client.release();
  }

  return {
    computedAt: new Date().toISOString(),
    academicYearLabel,
    kpis,
  };
}
