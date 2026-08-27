import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerPayrollQuery,
  OwnerPayrollResponse,
  OwnerPayrollStatus,
} from "@ecoledigitale/contracts";

/**
 * Masse salariale enseignante, côté propriétaire.
 *
 * CE QUE LA BASE DIT VRAIMENT, et qui a dicté la forme de cet écran :
 *
 * 1. L'AXE DU TEMPS EST LA PÉRIODE DE PAIE, PAS LE MOIS. Les bulletins sont
 *    rattachés à des `payment_periods` annuelles (« Exercice 2025-2026 »), et
 *    `calculated_at` porte la date à laquelle le bulletin a été COMPOSÉ — sur
 *    cette base, les six exercices ont tous été calculés le même mois. Grouper
 *    par mois de calcul afficherait une barre unique et laisserait croire à une
 *    école qui n'aurait payé qu'une fois. On groupe donc par période, ordonnée
 *    sur `period_start`.
 *
 * 2. `payment_periods.academic_year_id` EST NUL PARTOUT sur cette base. Le
 *    filtre d'année ne s'y adosse donc pas seul : il retombe sur une déduction
 *    depuis le MILIEU de l'intervalle de la période, pivot en septembre — la
 *    même règle que la page administrateur des bulletins archivés, pour qu'un
 *    même bulletin tombe dans la même année des deux côtés. Cf. `ANNEE_SQL`.
 *
 * 3. `payment_status` A SIX VALEURS, pas trois : s'ajoutent `disputed`,
 *    `cancelled` et `unpaid`. Les annulées et contestées sont exclues de la
 *    masse salariale — mais leur montant est renvoyé à part (`montantHorsTotal`)
 *    pour que l'exclusion soit lisible plutôt que silencieuse.
 *
 * 4. L'ARCHIVAGE N'EST PAS UNE ANNULATION. Archiver classe un exercice clos ; la
 *    paie a bien été versée. Le filtre d'archivage vaut « toutes » par défaut,
 *    sans quoi un établissement dont tous les exercices sont clos ouvrirait un
 *    écran vide.
 *
 * 5. `teaching_hours` EST VIDE sur cette base : aucun coût horaire n'est
 *    calculable à partir d'elle. On ne publie donc AUCUN taux horaire — un
 *    « 0 FCFA/h » serait faux. Le coût par enseignant est la somme réelle de
 *    ses bulletins.
 *
 * Chaque requête est indépendante et tolérante à l'échec : un bloc cassé
 * n'emporte pas les autres.
 */

type Row = Record<string, unknown>;

async function safeQuery<T extends Row>(
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
    log.warn({ err: e, label }, "owner payroll query failed");
    return [];
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Arrondi au franc : le FCFA n'a pas de subdivision en circulation. */
function franc(v: unknown): number {
  return Math.round(num(v));
}

function isoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

/**
 * Statuts entrant dans la masse salariale.
 *
 * `unpaid` y figure : la dette existe, elle est simplement impayée — l'exclure
 * ferait disparaître un engagement pris. Seules `cancelled` et `disputed`
 * sortent du total.
 */
const STATUTS_COMPTES: OwnerPayrollStatus[] = ["calculated", "approved", "paid", "unpaid"];

/**
 * Année scolaire d'une période de paie, en SQL.
 *
 * DEUX SOURCES, DANS CET ORDRE :
 *
 *  1. `payment_periods.academic_year_id` → `academic_years.name`. C'est la
 *     source de vérité quand elle est renseignée.
 *  2. À défaut, déduction depuis le MILIEU de l'intervalle, l'année démarrant
 *     en SEPTEMBRE.
 *
 * Le repli n'est pas théorique : sur cette base, `academic_year_id` est nul sur
 * les six périodes. Sans lui, le filtre d'année n'aurait rien à proposer. Le
 * garder derrière la colonne, plutôt qu'à sa place, évite qu'un rattachement
 * saisi plus tard soit contredit par une date.
 *
 * POURQUOI LE MILIEU ET NON `period_start`. Le pivot posé sur la date de début
 * range une période dans l'année où elle COMMENCE, ce qui est faux dès qu'elle
 * ne commence pas en septembre : « Exercice 2026-2027 » court du 01/08/2026 au
 * 31/12/2026, donc démarre en août — le pivot le classait en 2025-2026. Le
 * filtre d'année n'offrait alors jamais 2026-2027, et choisir 2025-2026
 * empilait deux exercices sans le dire. Le milieu de l'intervalle range chaque
 * période dans l'année où elle se déroule RÉELLEMENT, et redonne le même
 * résultat que l'ancien calcul sur toutes les périodes de septembre à août.
 *
 * Suppose l'alias `pp` pour `payment_periods` et `ay` pour `academic_years`.
 */
const PIVOT_SQL = `(pp.period_start + (COALESCE(pp.period_end, pp.period_start) - pp.period_start) / 2)`;

const ANNEE_SQL = `
  COALESCE(
    ay.name,
    CASE WHEN EXTRACT(MONTH FROM ${PIVOT_SQL}) >= 9
         THEN EXTRACT(YEAR FROM ${PIVOT_SQL})::int || '-' || (EXTRACT(YEAR FROM ${PIVOT_SQL})::int + 1)
         ELSE (EXTRACT(YEAR FROM ${PIVOT_SQL})::int - 1) || '-' || EXTRACT(YEAR FROM ${PIVOT_SQL})::int
    END
  )`;

/**
 * Fragment SQL du filtre commun. Les paramètres sont numérotés à partir de $2,
 * $1 étant toujours le tenant.
 */
function filtreSql(q: OwnerPayrollQuery): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 2;

  if (q.periodId) {
    conditions.push(`tp.payment_period_id = $${i}::uuid`);
    params.push(q.periodId);
    i += 1;
  }
  // L'année restreint à SES périodes. Combinée à un choix de période, les deux
  // s'appliquent : choisir une période hors de l'année sélectionnée renvoie
  // vide, ce qui est la vérité — mais l'écran ne propose jamais ce cas, les
  // périodes offertes suivant l'année.
  if (q.anneeScolaire) {
    conditions.push(
      `tp.payment_period_id IN (
         SELECT pp.id
           FROM payment_periods pp
           LEFT JOIN academic_years ay ON ay.id = pp.academic_year_id AND ay.tenant_id = pp.tenant_id
          WHERE pp.tenant_id = $1::uuid AND ${ANNEE_SQL} = $${i})`
    );
    params.push(q.anneeScolaire);
    i += 1;
  }
  // « À qui ? » est la moitié de la question de l'écran : elle se filtre, comme
  // sur la page administrateur des bulletins archivés.
  if (q.teacherId) {
    conditions.push(`tp.teacher_id = $${i}::uuid`);
    params.push(q.teacherId);
    i += 1;
  }
  if (q.status) {
    conditions.push(`tp.status::text = $${i}`);
    params.push(q.status);
    i += 1;
  }
  if (q.archive === "actives") conditions.push("tp.archived_at IS NULL");
  if (q.archive === "archivees") conditions.push("tp.archived_at IS NOT NULL");

  return { sql: conditions.length ? `AND ${conditions.join(" AND ")}` : "", params };
}

/** Liste SQL des statuts comptés, en littéraux : aucune entrée utilisateur. */
const COMPTES_SQL = STATUTS_COMPTES.map((s) => `'${s}'`).join(", ");


/** Nom affichable d'un enseignant, avec repli sur le courriel. */
const NOM_ENSEIGNANT = `COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email, 'Enseignant')`;

export async function fetchOwnerPayrollMass(
  pool: Pool,
  tenantId: string,
  query: OwnerPayrollQuery,
  log: FastifyBaseLogger
): Promise<OwnerPayrollResponse> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const f = filtreSql(query);
    const p = [tenantId, ...f.params];

    /* ---- Périodes proposées au filtre ------------------------------------ */
    const periodRows = await safeQuery<Row>(
      client,
      `SELECT pp.id, pp.name, pp.period_start, pp.period_end, pp.status::text AS status,
              ${ANNEE_SQL} AS annee_scolaire
         FROM payment_periods pp
         LEFT JOIN academic_years ay ON ay.id = pp.academic_year_id AND ay.tenant_id = pp.tenant_id
        WHERE pp.tenant_id = $1::uuid
        ORDER BY pp.period_start DESC`,
      [tenantId],
      log,
      "payrollPeriods"
    );

    /**
     * Années réellement porteuses d'au moins un bulletin.
     *
     * Volontairement calculée sur `teacher_payments`, pas sur la liste des
     * périodes : une période créée sans qu'aucune paie n'y soit rattachée
     * apparaîtrait dans le filtre et n'y renverrait rien.
     */
    const anneeRows = await safeQuery<Row>(
      client,
      `SELECT DISTINCT ${ANNEE_SQL} AS annee
         FROM teacher_payments tp
         JOIN payment_periods pp ON pp.id = tp.payment_period_id AND pp.tenant_id = tp.tenant_id
         LEFT JOIN academic_years ay ON ay.id = pp.academic_year_id AND ay.tenant_id = pp.tenant_id
        WHERE tp.tenant_id = $1::uuid
        ORDER BY annee DESC`,
      [tenantId],
      log,
      "payrollAnnees"
    );

    /**
     * Enseignants proposés au filtre.
     *
     * Calculée sur `teacher_payments` et non sur `teachers` : la question de
     * l'écran est « à qui j'ai payé », pas « qui est employé ». Un enseignant
     * sans aucun bulletin n'ouvrirait qu'un écran vide.
     *
     * Volontairement HORS des filtres : le menu ne doit pas se réduire à la
     * seule personne déjà sélectionnée, sans quoi on ne peut plus en changer.
     */
    const teacherOptionRows = await safeQuery<Row>(
      client,
      `SELECT t.id, ${NOM_ENSEIGNANT} AS name, COUNT(tp.id)::int AS bulletins
         FROM teacher_payments tp
         JOIN teachers t ON t.id = tp.teacher_id AND t.tenant_id = tp.tenant_id
         JOIN users u ON u.id = t.user_id
        WHERE tp.tenant_id = $1::uuid
        GROUP BY t.id, u.first_name, u.last_name, u.email
        ORDER BY bulletins DESC, name ASC`,
      [tenantId],
      log,
      "payrollTeacherOptions"
    );

    /**
     * Statuts et archivage réellement représentés.
     *
     * Le filtre de statut et celui d'archivage sont retirés du périmètre — un
     * menu qui perd ses options dès qu'on en choisit une est un menu dont on ne
     * peut plus sortir. Le reste des filtres s'applique : l'effectif annoncé
     * par l'option est celui qu'elle ouvrira vraiment.
     */
    const scopeFilter = filtreSql({ ...query, status: undefined, archive: "toutes" });
    const scopeParams = [tenantId, ...scopeFilter.params];
    const statutRows = await safeQuery<Row>(
      client,
      `SELECT tp.status::text AS status, COUNT(*)::int AS bulletins
         FROM teacher_payments tp
        WHERE tp.tenant_id = $1::uuid ${scopeFilter.sql}
        GROUP BY tp.status
        ORDER BY bulletins DESC`,
      scopeParams,
      log,
      "payrollStatuts"
    );
    const archiveRows = await safeQuery<Row>(
      client,
      `SELECT COUNT(*) FILTER (WHERE tp.archived_at IS NULL)::int     AS actives,
              COUNT(*) FILTER (WHERE tp.archived_at IS NOT NULL)::int AS archivees
         FROM teacher_payments tp
        WHERE tp.tenant_id = $1::uuid ${scopeFilter.sql}`,
      scopeParams,
      log,
      "payrollArchiveCounts"
    );

    /* ---- Totaux et décomposition ----------------------------------------- */
    const totalRows = await safeQuery<Row>(
      client,
      `SELECT COALESCE(SUM(tp.base_amount) FILTER (WHERE tp.status::text IN (${COMPTES_SQL})), 0)::float8       AS base,
              COALESCE(SUM(tp.overtime_amount) FILTER (WHERE tp.status::text IN (${COMPTES_SQL})), 0)::float8   AS heures_sup,
              COALESCE(SUM(tp.bonus_amount) FILTER (WHERE tp.status::text IN (${COMPTES_SQL})), 0)::float8      AS primes,
              COALESCE(SUM(tp.deductions) FILTER (WHERE tp.status::text IN (${COMPTES_SQL})), 0)::float8        AS retenues,
              COALESCE(SUM(tp.total_amount) FILTER (WHERE tp.status::text IN (${COMPTES_SQL})), 0)::float8      AS total,
              COUNT(*) FILTER (WHERE tp.status::text IN (${COMPTES_SQL}))::int                                  AS bulletins,
              COUNT(DISTINCT tp.teacher_id) FILTER (WHERE tp.status::text IN (${COMPTES_SQL}))::int             AS enseignants,
              COUNT(*) FILTER (WHERE tp.status::text = 'calculated')::int                                       AS attente_n,
              COALESCE(SUM(tp.total_amount) FILTER (WHERE tp.status::text = 'calculated'), 0)::float8           AS attente_montant,
              COUNT(*) FILTER (WHERE tp.status::text = 'approved' AND tp.paid_at IS NULL)::int                  AS engage_n,
              COALESCE(SUM(tp.total_amount) FILTER (WHERE tp.status::text = 'approved' AND tp.paid_at IS NULL), 0)::float8 AS engage_montant,
              COALESCE(SUM(tp.total_amount) FILTER (WHERE tp.status::text NOT IN (${COMPTES_SQL})), 0)::float8  AS hors_total
         FROM teacher_payments tp
        WHERE tp.tenant_id = $1::uuid ${f.sql}`,
      p,
      log,
      "payrollTotals"
    );
    const t = totalRows[0] ?? {};

    /* ---- Évolution par période ------------------------------------------- */
    // Les filtres de PÉRIODE et d'ANNÉE sont délibérément absents ici : un
    // graphe d'évolution restreint à une seule période serait une barre unique,
    // et restreint à une année ne montrerait plus l'évolution qu'il est censé
    // montrer. Les filtres de statut et d'archivage, eux, s'appliquent — ils
    // décrivent quoi compter, pas sur quelle tranche de temps.
    const evolFilter = filtreSql({
      ...query,
      periodId: undefined,
      anneeScolaire: undefined,
    });
    const byPeriodRows = await safeQuery<Row>(
      client,
      `SELECT pp.id, pp.name, pp.period_start,
              COUNT(tp.id)::int                      AS bulletins,
              COUNT(DISTINCT tp.teacher_id)::int     AS enseignants,
              COALESCE(SUM(tp.total_amount), 0)::float8 AS montant
         FROM payment_periods pp
         JOIN teacher_payments tp
           ON tp.payment_period_id = pp.id
          AND tp.tenant_id = pp.tenant_id
          AND tp.status::text IN (${COMPTES_SQL})
              ${evolFilter.sql}
        WHERE pp.tenant_id = $1::uuid
        GROUP BY pp.id, pp.name, pp.period_start
        ORDER BY pp.period_start ASC`,
      [tenantId, ...evolFilter.params],
      log,
      "payrollByPeriod"
    );

    /* ---- Coût par enseignant --------------------------------------------- */
    const byTeacherRows = await safeQuery<Row>(
      client,
      `SELECT t.id AS teacher_id,
              ${NOM_ENSEIGNANT} AS teacher_name,
              u.email,
              COUNT(tp.id)::int AS bulletins,
              COALESCE(SUM(tp.base_amount), 0)::float8     AS base,
              COALESCE(SUM(tp.overtime_amount), 0)::float8 AS heures_sup,
              COALESCE(SUM(tp.bonus_amount), 0)::float8    AS primes,
              COALESCE(SUM(tp.deductions), 0)::float8      AS retenues,
              COALESCE(SUM(tp.total_amount), 0)::float8    AS total
         FROM teacher_payments tp
         JOIN teachers t ON t.id = tp.teacher_id AND t.tenant_id = tp.tenant_id
         JOIN users u ON u.id = t.user_id
        WHERE tp.tenant_id = $1::uuid
          AND tp.status::text IN (${COMPTES_SQL})
          ${f.sql}
        GROUP BY t.id, u.first_name, u.last_name, u.email
        ORDER BY total DESC`,
      p,
      log,
      "payrollByTeacher"
    );

    /* ---- Les bulletins du périmètre, ligne à ligne ------------------------ */
    //
    // Mêmes colonnes que la page administrateur des bulletins archivés : deux
    // dates distinctes, `archived_at` qui dit quand le montant a été ARRÊTÉ et
    // `paid_at` quand l'argent est PARTI. Les confondre est ce qui avait produit
    // des bulletins déclarés payés sans décaissement enregistré.
    //
    // Les annulés et contestés y figurent, contrairement aux agrégats : le
    // tableau explique la ligne « exclus de la masse salariale », il ne peut pas
    // le faire en masquant précisément ce qui est exclu — d'où la colonne de
    // statut, qui dit lesquels.
    const BULLETINS_LIMITE = 500;
    const bulletinRows = await safeQuery<Row>(
      client,
      `SELECT tp.id,
              t.id AS teacher_id,
              ${NOM_ENSEIGNANT} AS teacher_name,
              pp.id AS period_id,
              pp.name AS period_name,
              pp.period_start,
              pp.period_end,
              ${ANNEE_SQL} AS annee_scolaire,
              tp.status::text AS status,
              tp.total_amount::float8 AS amount,
              tp.archived_at,
              tp.paid_at
         FROM teacher_payments tp
         JOIN teachers t ON t.id = tp.teacher_id AND t.tenant_id = tp.tenant_id
         JOIN users u ON u.id = t.user_id
         LEFT JOIN payment_periods pp ON pp.id = tp.payment_period_id AND pp.tenant_id = tp.tenant_id
         LEFT JOIN academic_years ay ON ay.id = pp.academic_year_id AND ay.tenant_id = pp.tenant_id
        WHERE tp.tenant_id = $1::uuid ${f.sql}
        -- Le plus récemment classé en tête, comme sur l'historique. Les
        -- bulletins jamais archivés viennent ensuite, à leur date de calcul.
        ORDER BY tp.archived_at DESC NULLS FIRST, tp.calculated_at DESC NULLS LAST
        LIMIT ${BULLETINS_LIMITE}`,
      p,
      log,
      "payrollBulletins"
    );
    const bulletinCountRows = await safeQuery<Row>(
      client,
      `SELECT COUNT(*)::int AS total
         FROM teacher_payments tp
        WHERE tp.tenant_id = $1::uuid ${f.sql}`,
      p,
      log,
      "payrollBulletinsCount"
    );

    /* ---- Paies en attente de la signature du propriétaire ---------------- */
    // Non filtrées par `archive` ni par `status` : ce bloc est une file
    // d'attente d'action, pas une lecture du périmètre choisi. Une paie à
    // valider ne doit pas disparaître parce qu'on regarde « les archivées ».
    // La période et l'enseignant, eux, s'appliquent : ils désignent QUI et QUOI
    // on regarde, pas dans quel état.
    const pendingParams: unknown[] = [tenantId];
    let pendingPeriod = "";
    if (query.periodId) {
      pendingParams.push(query.periodId);
      pendingPeriod = `AND tp.payment_period_id = $${pendingParams.length}::uuid`;
    }
    if (query.teacherId) {
      pendingParams.push(query.teacherId);
      pendingPeriod += ` AND tp.teacher_id = $${pendingParams.length}::uuid`;
    }
    const pendingRows = await safeQuery<Row>(
      client,
      `SELECT tp.id,
              ${NOM_ENSEIGNANT} AS teacher_name,
              pp.name AS period_name,
              tp.total_amount::float8 AS amount,
              tp.calculated_at
         FROM teacher_payments tp
         JOIN teachers t ON t.id = tp.teacher_id AND t.tenant_id = tp.tenant_id
         JOIN users u ON u.id = t.user_id
         LEFT JOIN payment_periods pp ON pp.id = tp.payment_period_id
        WHERE tp.tenant_id = $1::uuid
          AND tp.status::text = 'calculated'
          AND tp.approved_at IS NULL
          ${pendingPeriod}
        ORDER BY tp.calculated_at DESC NULLS LAST`,
      pendingParams,
      log,
      "payrollPending"
    );

    /* ---- Cours sans titulaire actif -------------------------------------- */
    //
    // DEUX COMPTEURS, ET C'EST VOULU.
    //
    // Une seule requête de comptage, sans les jointures de la liste, mentait :
    // sur cette base, 23 `class_courses` n'ont pas d'affectation active, et
    // AUCUNE ne se joint à `courses` — la matière référencée n'existe pas. Le
    // compteur affichait donc 23 au-dessus d'un tableau vide, ce qui se lit
    // comme une troncature alors que c'est un problème d'intégrité des données.
    //
    // `total` compte désormais ce qui est réellement affichable (mêmes
    // jointures que la liste), et `orphelins` compte à part les lignes dont la
    // matière a disparu. Un écart de données se nomme, il ne se maquille pas.
    const gapCountRows = await safeQuery<Row>(
      client,
      `SELECT COUNT(*) FILTER (WHERE co.id IS NOT NULL AND c.id IS NOT NULL)::int AS total,
              COUNT(*) FILTER (WHERE co.id IS NULL OR c.id IS NULL)::int          AS orphelins
         FROM class_courses cc
         LEFT JOIN classes c ON c.id = cc.class_id AND c.tenant_id = cc.tenant_id
         LEFT JOIN courses co ON co.id = cc.course_id AND co.tenant_id = cc.tenant_id
         LEFT JOIN teacher_assignments ta
           ON ta.class_course_id = cc.id
          AND ta.tenant_id = cc.tenant_id
          AND ta.status = 'active'::assignment_status
        WHERE cc.tenant_id = $1::uuid AND ta.id IS NULL`,
      [tenantId],
      log,
      "payrollGapCount"
    );
    const gapRows = await safeQuery<Row>(
      client,
      `SELECT cc.id AS class_course_id, c.name AS class_name, co.name AS course_name
         FROM class_courses cc
         JOIN classes c ON c.id = cc.class_id AND c.tenant_id = cc.tenant_id
         JOIN courses co ON co.id = cc.course_id AND co.tenant_id = cc.tenant_id
         LEFT JOIN teacher_assignments ta
           ON ta.class_course_id = cc.id
          AND ta.tenant_id = cc.tenant_id
          AND ta.status = 'active'::assignment_status
        WHERE cc.tenant_id = $1::uuid AND ta.id IS NULL
        ORDER BY c.name, co.name
        LIMIT 200`,
      [tenantId],
      log,
      "payrollGaps"
    );

    const enseignantsPayes = Math.round(num(t.enseignants));
    const masse = franc(t.total);

    return {
      periodId: query.periodId ?? null,
      periodName:
        (periodRows.find((r) => String(r.id) === query.periodId)?.name as string) ?? null,
      anneeScolaire: query.anneeScolaire ?? null,
      teacherId: query.teacherId ?? null,
      teacherName:
        (teacherOptionRows.find((r) => String(r.id) === query.teacherId)?.name as string) ??
        null,
      status: query.status ?? null,
      archive: query.archive,
      periods: periodRows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        periodStart: isoDate(r.period_start),
        periodEnd: isoDate(r.period_end),
        status: String(r.status ?? ""),
        anneeScolaire: (r.annee_scolaire as string) ?? null,
      })),
      anneesScolaires: anneeRows
        .map((r) => r.annee)
        .filter((a): a is string => typeof a === "string" && a.length > 0),
      teachers: teacherOptionRows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        bulletins: Math.round(num(r.bulletins)),
      })),
      statuts: statutRows.map((r) => ({
        status: String(r.status) as OwnerPayrollStatus,
        bulletins: Math.round(num(r.bulletins)),
      })),
      archiveCounts: {
        actives: Math.round(num(archiveRows[0]?.actives)),
        archivees: Math.round(num(archiveRows[0]?.archivees)),
      },
      kpis: {
        masseSalariale: masse,
        bulletins: Math.round(num(t.bulletins)),
        enseignantsPayes,
        coutMoyenParEnseignant:
          enseignantsPayes > 0 ? Math.round(masse / enseignantsPayes) : null,
        enAttenteValidation: Math.round(num(t.attente_n)),
        montantEnAttente: franc(t.attente_montant),
        approuveNonVerse: Math.round(num(t.engage_n)),
        montantApprouveNonVerse: franc(t.engage_montant),
        montantHorsTotal: franc(t.hors_total),
      },
      breakdown: {
        base: franc(t.base),
        heuresSup: franc(t.heures_sup),
        primes: franc(t.primes),
        retenues: franc(t.retenues),
        total: masse,
      },
      byPeriod: byPeriodRows.map((r) => ({
        periodId: String(r.id),
        name: String(r.name),
        periodStart: isoDate(r.period_start),
        bulletins: Math.round(num(r.bulletins)),
        enseignantsPayes: Math.round(num(r.enseignants)),
        montant: franc(r.montant),
      })),
      byTeacher: byTeacherRows.map((r) => ({
        teacherId: String(r.teacher_id),
        teacherName: String(r.teacher_name),
        email: (r.email as string) ?? null,
        bulletins: Math.round(num(r.bulletins)),
        base: franc(r.base),
        heuresSup: franc(r.heures_sup),
        primes: franc(r.primes),
        retenues: franc(r.retenues),
        total: franc(r.total),
      })),
      bulletins: bulletinRows.map((r) => ({
        id: String(r.id),
        teacherId: String(r.teacher_id),
        teacherName: String(r.teacher_name),
        periodId: r.period_id ? String(r.period_id) : null,
        periodName: (r.period_name as string) ?? null,
        periodStart: r.period_start ? isoDate(r.period_start) : null,
        periodEnd: r.period_end ? isoDate(r.period_end) : null,
        anneeScolaire: (r.annee_scolaire as string) ?? null,
        status: String(r.status ?? ""),
        amount: franc(r.amount),
        archivedAt: r.archived_at instanceof Date ? r.archived_at.toISOString() : null,
        paidAt: r.paid_at instanceof Date ? r.paid_at.toISOString() : null,
      })),
      bulletinsTotal: Math.round(num(bulletinCountRows[0]?.total)),
      pending: pendingRows.map((r) => ({
        id: String(r.id),
        teacherName: String(r.teacher_name),
        periodName: (r.period_name as string) ?? null,
        calculatedAt:
          r.calculated_at instanceof Date ? r.calculated_at.toISOString() : null,
        amount: franc(r.amount),
      })),
      coursesWithoutTeacher: gapRows.map((r) => ({
        classCourseId: String(r.class_course_id),
        className: String(r.class_name),
        courseName: String(r.course_name),
      })),
      coursesWithoutTeacherTotal: Math.round(num(gapCountRows[0]?.total)),
      coursesWithoutTeacherOrphaned: Math.round(num(gapCountRows[0]?.orphelins)),
    };
  } finally {
    client.release();
  }
}
