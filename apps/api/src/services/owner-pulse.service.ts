import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerPulseKpi,
  OwnerPulseResponse,
  OwnerPulseStatus,
} from "@ecoledigitale/contracts/src/owner-stats.schema";
import { PRO_UNPAID_INSTALLMENTS_CTE } from "./owner-pro-outstanding.sql";
import { PRO_ORDER_DATES_CTE } from "./owner-pro-annee.sql";

/**
 * Le « pouls » de l'établissement : les chiffres qu'un propriétaire regarde en
 * premier, dans l'ordre où il se pose les questions —
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
 * l'échec (un KPI cassé n'emporte pas les autres). Si le temps de réponse
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

/** Date SQL en `AAAA-MM-JJ`, ou `null` quand la fenêtre n'a pas pu être résolue. */
function isoDay(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
  return null;
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
 * Fenêtre de l'année scolaire regardée.
 *
 * `$2` porte l'année au format « AAAA-AAAA+1 » ; à NULL, on prend l'année en
 * cours, déduite de la date du jour.
 *
 * AUCUNE LECTURE DE `academic_years` ICI, ET C'EST VOLONTAIRE.
 * Le module professionnel n'a pas de table d'années scolaires : une année
 * existe parce qu'une classe a été ouverte, et son millésime se lit sur
 * `professional_ue_sessions.date_debut` avec un pivot en septembre. C'est la
 * convention de `/owner/stats/filters`, de la page d'historique des bulletins
 * et de tous les écrans professionnels.
 *
 * S'adosser à `academic_years` produisait un filtre qui montrait le contraire
 * de l'activité : la table ignorait trois années portant douze ouvertures
 * chacune et déclarait une année qui n'en portait aucune.
 *
 * La fenêtre est donc PUREMENT CALCULÉE : du 1er septembre de N au 31 août de
 * N+1. Douze mois pleins, contigus d'une année à l'autre, sans trou de juillet
 * et août — c'est la même règle que la migration 0118 a appliquée aux dates de
 * `academic_years`, pour que les deux vocabulaires coïncident au moins.
 */
const ACADEMIC_WINDOW_CTE = `
  an AS (
    SELECT
      -- Millésime d'ouverture : celui demandé, sinon celui du jour.
      COALESCE(
        NULLIF(split_part($2::text, '-', 1), '')::int,
        CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 9
             THEN EXTRACT(YEAR FROM CURRENT_DATE)::int
             ELSE EXTRACT(YEAR FROM CURRENT_DATE)::int - 1 END
      ) AS n
    -- Le tenant n'entre PAS dans le calcul de la fenêtre : c'est de
    -- l'arithmétique de dates, identique pour tout le monde. Il reste
    -- néanmoins cité ici pour que Postgres puisse typer $1, que les requêtes
    -- consommatrices utilisent toutes. Sans cette ligne, la seule requête qui
    -- ne lit que la fenêtre échoue sur « n'a pas pu déterminer le type de
    -- données du paramètre $1 ».
    WHERE $1::uuid IS NOT NULL
  ),
  win AS (
    SELECT
      make_date(n, 9, 1) AS d1,
      make_date(n + 1, 8, 31) AS d2,
      n::text || '-' || (n + 1)::text AS label
    FROM an
  )`;

/** Ancienneté à partir de laquelle un impayé devient préoccupant. */
const AGED_DAYS = 60;

/* --------------------------------- Service -------------------------------- */

export async function fetchOwnerPulse(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  /**
   * Année scolaire regardée, au format « AAAA-AAAA+1 », DÉRIVÉE des ouvertures
   * de classe et non lue dans une table. Absente, le pouls décrit le présent :
   * le mois en cours, les 30 derniers jours. Présente, il décrit cette année-là
   * de bout en bout — et les indicateurs concernés changent de libellé.
   */
  anneeScolaire?: string
): Promise<OwnerPulseResponse> {
  const client = await pool.connect();
  const kpis: OwnerPulseKpi[] = [];
  let academicYearLabel: string | null = null;

  // Une année explicitement demandée bascule le pouls en lecture d'année.
  const surAnnee = !!anneeScolaire;
  /** Paramètres communs à toute requête qui monte la fenêtre d'année. */
  const P: unknown[] = [tenantId, anneeScolaire ?? null];

  let windowStart: string | null = null;
  let windowEnd: string | null = null;

  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const yearRow = await safeRow<Row>(
      client,
      `WITH ${ACADEMIC_WINDOW_CTE}
       SELECT label, d1::date AS d1, d2::date AS d2 FROM win`,
      P,
      log,
      "academicYear"
    );
    academicYearLabel = (yearRow?.label as string | null) ?? null;
    windowStart = isoDay(yearRow?.d1);
    windowEnd = isoDay(yearRow?.d2);

    /* ---- KPI 1 — Encaissements du mois (toutes activités) ---------------- */
    // Scolaire (payment_transactions) + professionnel (professional_payments).
    // Comparaison à date : on ne compare que les jours déjà écoulés du mois
    // précédent, sinon le 3 du mois on se croit toujours en chute libre.
    /**
     * Sur une année choisie, « le mois en cours » n'a plus de sens : le mois
     * courant est hors de 2023-2024. L'indicateur bascule donc sur la fenêtre
     * de l'année, comparée à la fenêtre de l'année précédente — et son libellé
     * le dit. Laisser « du mois » afficher un chiffre hors du périmètre choisi
     * serait un filtre qui n'agit pas.
     */
    const cash = surAnnee
      ? await safeRow<Row>(
          client,
          // Le professionnel est daté par la CLASSE OUVERTE, pas par
          // l'horodatage du paiement (cf. `PRO_ORDER_DATES_CTE`) : sur une base
          // reprise, `paid_at` est identique sur cinq années et vidait les
          // années passées au profit de l'année de chargement.
          `WITH ${ACADEMIC_WINDOW_CTE},
                ${PRO_ORDER_DATES_CTE}
           SELECT
             (SELECT COALESCE(SUM(amount), 0)::float8
                FROM payment_transactions, win
               WHERE tenant_id = $1::uuid
                 AND status = 'completed'::transaction_status
                 AND COALESCE(processed_at, created_at)::date BETWEEN win.d1 AND win.d2)
           + (SELECT COALESCE(SUM(pp.montant), 0)::float8
                FROM professional_payments pp
                JOIN pro_order_dates d ON d.order_id = pp.order_id
                CROSS JOIN win
               WHERE pp.tenant_id = $1::uuid
                 AND pp.statut = 'confirme'
                 AND d.debut BETWEEN win.d1 AND win.d2) AS current_month,
             NULL::float8 AS previous_month,
             (SELECT COALESCE(SUM(amount), 0)::float8
                FROM payment_transactions, win
               WHERE tenant_id = $1::uuid
                 AND status = 'completed'::transaction_status
                 AND COALESCE(processed_at, created_at)::date
                     BETWEEN win.d1 - INTERVAL '1 year' AND win.d2 - INTERVAL '1 year')
           + (SELECT COALESCE(SUM(pp.montant), 0)::float8
                FROM professional_payments pp
                JOIN pro_order_dates d ON d.order_id = pp.order_id
                CROSS JOIN win
               WHERE pp.tenant_id = $1::uuid
                 AND pp.statut = 'confirme'
                 AND d.debut BETWEEN win.d1 - INTERVAL '1 year' AND win.d2 - INTERVAL '1 year')
             AS same_month_last_year`,
          P,
          log,
          "cashCollectedOverYear"
        )
      : await safeRow<Row>(
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
    const cashLastYear = cash ? num(cash.same_month_last_year) : 0;
    // En lecture d'année, la comparaison utile est l'année précédente : il n'y a
    // pas de « mois dernier » dans une année close. `num(null)` vaudrait 0 et
    // afficherait une chute de 100 % — d'où le choix explicite plutôt qu'un
    // repli silencieux sur zéro.
    const cashPrev = surAnnee
      ? cashLastYear > 0
        ? cashLastYear
        : null
      : cash
        ? num(cash.previous_month)
        : null;
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
      label: surAnnee ? "Encaissements de l'année" : "Encaissements du mois",
      value: Math.round(cashNow),
      unit: "fcfa",
      previousValue: cashPrev === null ? null : Math.round(cashPrev),
      previousLabel: surAnnee ? "année précédente" : "mois dernier, à la même date",
      status: cashStatus,
      hint: surAnnee
        ? "Scolarité et module professionnel confondus, sur toute l'année scolaire choisie. Seuls les paiements confirmés sont comptés."
        : "Scolarité et module professionnel confondus. Seuls les paiements confirmés sont comptés.",
      detail: surAnnee
        ? cashLastYear > 0
          ? `${fmtFcfa(cashLastYear)} sur l'année précédente`
          : "Pas d'historique sur l'année précédente"
        : cashLastYear > 0
          ? `${fmtFcfa(cashLastYear)} au même mois l'an dernier`
          : "Pas d'historique sur le même mois l'an dernier",
      href: "/owner/finances",
      measured: cash !== null,
    });

    /* ---- KPI 2 retiré — Taux de recouvrement ------------------------------
       Retiré sur décision métier : le module professionnel ne fonctionne pas
       par échéancier. Un « taux de recouvrement » y suppose un attendu échelonné
       dans le temps qui n'existe pas — une commande est réglée ou ne l'est pas.
       Le montant qui reste dû garde tout son sens et reste affiché ci-dessous. */

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
      // Volontairement PAS annualisé, et le libellé le dit quand une année est
      // choisie. Le reste à recouvrer est un STOCK — ce qu'on vous doit
      // aujourd'hui — et non un flux de l'année : les échéances impayées ne
      // portent aucune année scolaire à laquelle les rattacher. Le restreindre
      // sur la fenêtre reviendrait à filtrer sur la date d'échéance, ce qui
      // effacerait des dettes anciennes toujours dues.
      label: surAnnee ? "Reste à recouvrer (toutes années)" : "Reste à recouvrer",
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
         WHERE se.tenant_id = $1::uuid
           -- Même rapprochement que le taux de remplissage : l'année dérivée
           -- fait foi. Filtrer sur a.is_active rendait l'effectif sourd au
           -- filtre : on gardait toujours l'année cochée active, quelle que
           -- soit celle choisie dans la barre.
           --
           -- Sous-requête scalaire et non win.label : chaque branche d'une
           -- UNION a son propre FROM, et référencer win sans l'y joindre
           -- faisait échouer la requête entière — l'effectif affichait « non
           -- mesuré » sur toutes les années.
           AND a.name = (SELECT label FROM win)
         UNION
         SELECT pe.student_id, (pe.statut IN ('confirmee', 'terminee')) AS still_active
         FROM professional_enrollments pe
         -- Daté par la CLASSE OUVERTE, pas par pe.created_at : sur une base
         -- reprise, toutes les inscriptions de cinq années portent le même
         -- horodatage, et l'effectif des années passées tombait à zéro.
         JOIN professional_ue_sessions ses
           ON ses.id = pe.ue_session_id AND ses.tenant_id = pe.tenant_id
         CROSS JOIN win
         WHERE pe.tenant_id = $1::uuid
           AND ses.date_debut BETWEEN win.d1 AND win.d2
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
      P,
      log,
      "headcount"
    );

    const actifs = num(headcount?.actifs);
    const rentree = num(headcount?.rentree);
    const sansInscription = num(headcount?.sans_inscription);
    const attrition = rentree > 0 ? (100 * (rentree - actifs)) / rentree : 0;

    // Une fiche active sans inscription sur l'année regardée est du chiffre
    // d'affaires récupérable, pas une perte : c'est une file de relance.
    const headcountDetail =
      sansInscription > 0
        ? `${sansInscription} fiche(s) active(s) sans inscription sur l'année ${academicYearLabel ?? "en cours"} — à relancer`
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
      hint: surAnnee
        ? "Étudiants distincts ayant une inscription sur l'année choisie, scolaire et professionnel confondus : un étudiant inscrit aux deux moteurs ne compte qu'une fois."
        : "Étudiants distincts ayant une inscription sur l'année en cours, scolaire et professionnel confondus : un étudiant inscrit aux deux moteurs ne compte qu'une fois.",
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
         CROSS JOIN win
         WHERE s.tenant_id = $1::uuid
           AND s.capacite_max IS NOT NULL AND s.capacite_max > 0
           AND ${
             surAnnee
               ? // Sur une année, toute cohorte qui la CHEVAUCHE compte : une
                 // cohorte close en mars appartient à l'année, même si elle ne
                 // tourne plus aujourd'hui.
                 `s.date_debut <= win.d2 AND s.date_fin >= win.d1`
               : `CURRENT_DATE BETWEEN s.date_debut AND s.date_fin`
           }
       ),
       scolaire AS (
         SELECT COALESCE(SUM(c.max_students), 0)::float8 AS capacity,
                COALESCE(SUM((SELECT COUNT(*) FROM student_enrollments se
                               WHERE se.class_id = c.id
                                 AND se.tenant_id = c.tenant_id
                                 AND se.status = 'active'::enrollment_status)), 0)::float8 AS seats
         FROM classes c
         JOIN academic_years a
           ON a.id = c.academic_year_id
          AND a.tenant_id = c.tenant_id
         CROSS JOIN win
         WHERE c.tenant_id = $1::uuid
           -- Rapprochement PAR LE NOM, dans ce sens-là : l'année dérivée fait
           -- foi, et l'on cherche la ligne de academic_years qui porte le même
           -- millésime. Une année sans ligne correspondante — 2021-2022 ici —
           -- ne contribue simplement pas : il n'y avait pas de classes cette
           -- année-là non plus. Filtrer sur a.is_active rendait l'indicateur
           -- sourd au filtre d'année.
           AND a.name = win.label
           AND c.max_students IS NOT NULL AND c.max_students > 0
       )
       SELECT (pro.capacity + scolaire.capacity) AS capacity,
              (pro.seats + scolaire.seats) AS seats
       FROM pro, scolaire`,
      P,
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
      // Le périmètre des cohortes CHANGE entre les deux lectures : « en cours
      // aujourd'hui » sans filtre, « qui chevauchent l'année » avec. Les deux
      // chiffres diffèrent donc légitimement, et le libellé doit dire lequel on
      // regarde — sinon on croit à une incohérence.
      hint: surAnnee
        ? "Places occupées sur places déclarées, pour les cohortes professionnelles qui chevauchent l'année choisie et les classes de cette année. Les cohortes et classes sans capacité renseignée sont exclues du calcul."
        : "Places occupées sur places déclarées, cohortes professionnelles en cours et classes de l'année active. Les cohortes et classes sans capacité renseignée sont exclues du calcul.",
      detail: capacity > 0 ? `${Math.round(seats)} places occupées sur ${Math.round(capacity)}` : null,
      href: "/owner/remplissage",
      measured: fill !== null && capacity > 0,
    });

    /* ---- KPI 6 — Taux de présence sur 30 jours --------------------------- */
    // EN HEURES, pas en nombre de pointages : une heure d'absence en atelier
    // n'a pas le même poids qu'un pointage manqué en amphi. `heure_debut` et
    // `heure_fin` étant NULLABLE, on mesure aussi la couverture et on l'annonce.
    const presence = await safeRow<Row>(
      client,
      // Deux découpages selon le mode. En lecture d'année, « avant » est l'année
      // précédente : comparer une année à ses 30 derniers jours n'aurait pas de
      // sens, et laisser la fenêtre glissante afficherait des séances hors du
      // périmètre choisi.
      `WITH ${ACADEMIC_WINDOW_CTE},
       marks AS (
         SELECT a.statut,
                ${
                  surAnnee
                    ? `CASE WHEN s.date BETWEEN win.d1 AND win.d2 THEN 'now'
                            WHEN s.date BETWEEN win.d1 - INTERVAL '1 year' AND win.d2 - INTERVAL '1 year' THEN 'before'
                       END`
                    : `CASE WHEN s.date >= CURRENT_DATE - INTERVAL '30 days' THEN 'now' ELSE 'before' END`
                } AS bucket,
                CASE WHEN s.heure_debut IS NOT NULL AND s.heure_fin IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (s.heure_fin - s.heure_debut)) / 3600.0
                     ELSE NULL END AS hours
         FROM professional_ecue_attendance a
         JOIN professional_ecue_seances s ON s.id = a.seance_id AND s.tenant_id = a.tenant_id
         CROSS JOIN win
         WHERE a.tenant_id = $1::uuid
           AND ${
             surAnnee
               ? `s.date BETWEEN win.d1 - INTERVAL '1 year' AND win.d2`
               : `s.date >= CURRENT_DATE - INTERVAL '60 days'`
           }
       )
       SELECT
         COALESCE(SUM(hours) FILTER (WHERE bucket = 'now'), 0)::float8 AS hours_now,
         COALESCE(SUM(hours) FILTER (WHERE bucket = 'now' AND statut IN ('present', 'retard')), 0)::float8 AS hours_present_now,
         COALESCE(SUM(hours) FILTER (WHERE bucket = 'before'), 0)::float8 AS hours_before,
         COALESCE(SUM(hours) FILTER (WHERE bucket = 'before' AND statut IN ('present', 'retard')), 0)::float8 AS hours_present_before,
         COUNT(*) FILTER (WHERE bucket = 'now')::int AS marks_now,
         COUNT(*) FILTER (WHERE bucket = 'now' AND hours IS NULL)::int AS marks_without_hours
       FROM marks`,
      P,
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
      label: surAnnee ? "Présence sur l'année" : "Présence (30 jours)",
      value: presenceRate ?? 0,
      unit: "percent",
      previousValue: presencePrev,
      previousLabel: surAnnee ? "année précédente" : "30 jours précédents",
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

    /* ---- KPI 7 retiré — Réussite du dernier semestre ----------------------
       Retiré sur décision métier. La réussite par semestre reste consultable,
       filtrable et exportable sur l'écran Résultats, où elle se lit avec les
       décisions de jury et le poids du rattrapage qui l'expliquent. */

    /* ---- KPI 8 — Solde encaissements moins salaires ---------------------- */
    // Ce n'est PAS une marge : aucune table de dépenses n'existe (loyer,
    // énergie, fournitures, amortissements). Le libellé le dit, le `hint` aussi,
    // et `measured` reste vrai car les deux termes calculés sont exacts.
    const payroll = await safeRow<Row>(
      client,
      // Un bulletin de paie est daté par sa PÉRIODE DE PAIE, pas par
      // `calculated_at` qui porte la date de composition du document. Sur cette
      // base, les six exercices ont été calculés le même mois : les rattacher à
      // `calculated_at` mettait toute la masse salariale de cinq ans sur
      // l'année en cours, et laissait les autres à zéro. C'est le même défaut
      // que sur les commandes professionnelles, et la même correction.
      //
      // Un bulletin sans période rattachée est EXCLU plutôt que rattaché au
      // hasard : il vaut mieux un total incomplet et annoncé qu'un total faux.
      `WITH ${ACADEMIC_WINDOW_CTE}
       SELECT COALESCE(SUM(tp.total_amount), 0)::float8 AS v
         FROM teacher_payments tp
         JOIN payment_periods pp ON pp.id = tp.payment_period_id AND pp.tenant_id = tp.tenant_id
         CROSS JOIN win
        WHERE tp.tenant_id = $1::uuid
          AND tp.status IN ('calculated'::payment_status,
                            'approved'::payment_status,
                            'paid'::payment_status)
          AND ${
            surAnnee
              ? // Les exercices dont la période DÉMARRE dans l'année regardée —
                // même règle que l'écran Masse salariale, pour que les deux
                // écrans ne se contredisent pas.
                `pp.period_start BETWEEN win.d1 AND win.d2`
              : // Sans filtre : l'exercice de paie EN COURS. « Les salaires du
                // mois » n'existe pas quand les exercices sont annuels.
                `CURRENT_DATE BETWEEN pp.period_start AND pp.period_end`
          }`,
      P,
      log,
      surAnnee ? "payrollOverYear" : "payrollThisMonth"
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
      previousLabel: surAnnee ? "année scolaire" : "exercice de paie en cours",
      status:
        balance < 0 ? "critical" : payrollShare > 60 ? "warning" : cashNow === 0 ? "neutral" : "good",
      hint: `${
        surAnnee
          ? "Encaissements de l'année moins les rémunérations des exercices de paie ouverts dans cette même année"
          : "Encaissements du mois moins les rémunérations de l'exercice de paie en cours"
      }, calculées, approuvées ou payées. Les deux termes sont rattachés à leur période d'activité — classe ouverte pour l'argent qui rentre, exercice de paie pour celui qui sort — et non à leur date d'enregistrement. Ce n'est pas un résultat d'exploitation : loyer, énergie, fournitures et amortissements ne sont dans aucune table.`,
      detail:
        cashNow > 0
          ? `${fmtFcfa(payrollAmount)} de salaires, soit ${fmtPct(round1(payrollShare))} des encaissements`
          : payrollAmount > 0
            ? `${fmtFcfa(payrollAmount)} de salaires, aucun encaissement sur ${
                surAnnee ? "l'année" : "ce mois-ci"
              }`
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
    windowStart,
    windowEnd,
    kpis,
  };
}
