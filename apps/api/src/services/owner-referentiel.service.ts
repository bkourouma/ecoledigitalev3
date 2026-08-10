import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerReferentielIssue,
  OwnerReferentielQuery,
  OwnerReferentielResponse,
  OwnerUeCategorie,
} from "@ecoledigitale/contracts";

/**
 * Santé du catalogue : vue transversale cycle → filière → { matières | UE → ECUE },
 * et surtout détection des incohérences structurelles.
 *
 * Cet écran remplace les KPI « Total » des pages Cycles / Filières / Matières, qui
 * sont aujourd'hui calculés côté client sur une liste paginée à 20 lignes et sont
 * donc faux dès que le catalogue dépasse cette taille. Ici tout est compté en SQL,
 * sur l'intégralité du tenant.
 *
 * Pièges appliqués :
 *  - §4.4-7  `nb_uv` (déclaré) et Σ crédits des ECUE (réellement utilisé en
 *            pondération) peuvent diverger : c'est précisément ce qu'on remonte.
 *  - §4.4-8  requêtage direct de professional_ue_sessions.
 *  - §6-11   les matières académiques orphelines (programme_id ou bilan_type_id NULL)
 *            sont invisibles dans GET /courses, qui utilise des JOIN internes. On
 *            les remonte ici en LEFT JOIN, sinon elles resteraient introuvables.
 */

/** Plafond de lignes remontées par type d'incohérence, pour borner la réponse. */
export const OWNER_REFERENTIEL_ISSUE_LIMIT = 50;

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
    log.warn({ err: e, label }, "owner referentiel query failed");
    return [];
  }
}

type IssueRow = {
  id: string;
  label: string;
  detail: string | null;
  filiere_name: string | null;
};

export async function fetchOwnerReferentiel(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerReferentielQuery
): Promise<OwnerReferentielResponse> {
  const cycleId = filters.cycleId ?? null;
  const filiereIds =
    filters.filiereIds && filters.filiereIds.length > 0 ? filters.filiereIds : null;
  const categorie = filters.categorie ?? null;

  // $1 tenant, $2 cycleId, $3 filiereIds, $4 categorie
  const params = [tenantId, cycleId, filiereIds, categorie];
  const issueParams = [...params, OWNER_REFERENTIEL_ISSUE_LIMIT];

  /** Restriction commune : filière retenue par le filtre cycle / filières. */
  const FILIERE_FILTER = `
      AND ($2::uuid IS NULL OR p.cycle_id = $2::uuid)
      AND ($3::uuid[] IS NULL OR p.id = ANY($3::uuid[]))`;

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- KPI du catalogue ---- */
    const kpiRows = await safeQuery<{
      active_cycles: string | number;
      active_filieres: string | number;
      active_ue: string | number;
      active_ecue: string | number;
      avg_credits: string | number | null;
    }>(
      client,
      `SELECT
         (SELECT COUNT(*) FROM cycles c
           WHERE c.tenant_id = $1::uuid AND c.status = 'active')::int AS active_cycles,
         (SELECT COUNT(*) FROM programmes p
           WHERE p.tenant_id = $1::uuid AND p.status = 'active' ${FILIERE_FILTER})::int AS active_filieres,
         (SELECT COUNT(*) FROM professional_ue u
           JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = u.tenant_id
           WHERE u.tenant_id = $1::uuid AND u.statut = 'actif'
             AND ($4::text IS NULL OR u.categorie = $4::text)
             ${FILIERE_FILTER})::int AS active_ue,
         (SELECT COUNT(*) FROM professional_ecue e
           WHERE e.tenant_id = $1::uuid AND e.statut = 'actif')::int AS active_ecue,
         (SELECT AVG(sem_credits)::float8 FROM (
            SELECT COALESCE(SUM(e.credits), 0) AS sem_credits
            FROM professional_semestres sem
            JOIN programmes p ON p.id = sem.filiere_id AND p.tenant_id = sem.tenant_id
            LEFT JOIN professional_semestre_ue su
                   ON su.semestre_id = sem.id AND su.tenant_id = sem.tenant_id
            LEFT JOIN professional_ue_ecue l
                   ON l.ue_id = su.ue_id AND l.tenant_id = sem.tenant_id
            LEFT JOIN professional_ecue e
                   ON e.id = l.ecue_id AND e.tenant_id = sem.tenant_id
            WHERE sem.tenant_id = $1::uuid ${FILIERE_FILTER}
            GROUP BY sem.id
          ) s) AS avg_credits`,
      params,
      log,
      "kpis"
    );

    const k = kpiRows[0] ?? {
      active_cycles: 0,
      active_filieres: 0,
      active_ue: 0,
      active_ecue: 0,
      avg_credits: null,
    };

    /* ---- Tableau des filières ---- */
    const filiereRows = await safeQuery<{
      filiere_id: string;
      name: string;
      code: string;
      cycle_name: string | null;
      domaine: string | null;
      semestre_count: string | number;
      ue_count: string | number;
      ecue_count: string | number;
      sum_nb_uv: string | number;
      sum_credits: string | number;
      student_count: string | number;
    }>(
      client,
      `SELECT p.id AS filiere_id,
              p.name,
              p.code,
              c.name AS cycle_name,
              p.domaine,
              (SELECT COUNT(*) FROM professional_semestres sem
                WHERE sem.filiere_id = p.id AND sem.tenant_id = p.tenant_id)::int AS semestre_count,
              (SELECT COUNT(*) FROM professional_ue u
                WHERE u.filiere_id = p.id AND u.tenant_id = p.tenant_id)::int AS ue_count,
              -- DISTINCT obligatoire : une ECUE mutualisée est rattachée à
              -- plusieurs UE de la filière et serait comptée autant de fois.
              (SELECT COUNT(DISTINCT l.ecue_id)
                 FROM professional_ue u
                 JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
                WHERE u.filiere_id = p.id AND u.tenant_id = p.tenant_id)::int AS ecue_count,
              (SELECT COALESCE(SUM(u.nb_uv), 0) FROM professional_ue u
                WHERE u.filiere_id = p.id AND u.tenant_id = p.tenant_id)::int AS sum_nb_uv,
              (SELECT COALESCE(SUM(e.credits), 0)
                 FROM professional_ue u
                 JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
                 JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = u.tenant_id
                WHERE u.filiere_id = p.id AND u.tenant_id = p.tenant_id)::int AS sum_credits,
              (SELECT COUNT(DISTINCT en.student_id)
                 FROM professional_enrollments en
                 JOIN professional_ue_sessions s
                      ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
                 JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
                WHERE u.filiere_id = p.id AND en.tenant_id = p.tenant_id
                  AND en.statut IN ('confirmee', 'terminee'))::int AS student_count
       FROM programmes p
       LEFT JOIN cycles c ON c.id = p.cycle_id AND c.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1::uuid ${FILIERE_FILTER}
       ORDER BY p.name`,
      // Pas de $4 ici : cette requête n'utilise pas le filtre catégorie, et
      // PostgreSQL rejette un paramètre fourni mais jamais référencé.
      [tenantId, cycleId, filiereIds],
      log,
      "filieres"
    );

    /* ---- Incohérences ---- */

    // UE dont le nombre d'UV n'a jamais été renseigné : le formulaire de création
    // force nb_uv = 0, la valeur reste donc à 0 tant qu'on ne l'édite pas.
    const ueNbUvZero = await safeQuery<IssueRow>(
      client,
      `SELECT u.id, u.code || ' — ' || u.libelle AS label,
              NULL::text AS detail, p.name AS filiere_name
       FROM professional_ue u
       JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = u.tenant_id
       WHERE u.tenant_id = $1::uuid AND u.nb_uv = 0
         AND ($4::text IS NULL OR u.categorie = $4::text)
         ${FILIERE_FILTER}
       ORDER BY p.name, u.code
       LIMIT $5::int`,
      issueParams,
      log,
      "ue_nb_uv_zero"
    );

    // nb_uv déclaré ≠ Σ crédits des ECUE réellement rattachées. C'est l'écart que
    // les migrations correctives 0083-0085 ont dû rattraper à la main.
    const ueNbUvMismatch = await safeQuery<IssueRow>(
      client,
      `SELECT u.id, u.code || ' — ' || u.libelle AS label,
              'nb_uv = ' || u.nb_uv || ', Σ crédits ECUE = ' || COALESCE(SUM(e.credits), 0) AS detail,
              p.name AS filiere_name
       FROM professional_ue u
       JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = u.tenant_id
       JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
       JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = u.tenant_id
       WHERE u.tenant_id = $1::uuid
         AND ($4::text IS NULL OR u.categorie = $4::text)
         ${FILIERE_FILTER}
       GROUP BY u.id, u.code, u.libelle, u.nb_uv, p.name
       HAVING u.nb_uv <> COALESCE(SUM(e.credits), 0) AND u.nb_uv > 0
       ORDER BY p.name, u.code
       LIMIT $5::int`,
      issueParams,
      log,
      "ue_nb_uv_mismatch"
    );

    // ECUE sans crédits : elles faussent silencieusement la moyenne d'UE, qui
    // pondère par les crédits (§4.5).
    const ecueCreditsNull = await safeQuery<IssueRow>(
      client,
      `SELECT DISTINCT e.id, e.code || ' — ' || e.libelle AS label,
              NULL::text AS detail, NULL::text AS filiere_name
       FROM professional_ecue e
       WHERE e.tenant_id = $1::uuid AND e.credits IS NULL AND e.statut = 'actif'
       ORDER BY label
       LIMIT $2::int`,
      [tenantId, OWNER_REFERENTIEL_ISSUE_LIMIT],
      log,
      "ecue_credits_null"
    );

    // ECUE rattachée à aucune UE : invisible dans tout parcours pédagogique.
    const ecueOrphan = await safeQuery<IssueRow>(
      client,
      `SELECT e.id, e.code || ' — ' || e.libelle AS label,
              NULL::text AS detail, NULL::text AS filiere_name
       FROM professional_ecue e
       WHERE e.tenant_id = $1::uuid
         AND NOT EXISTS (SELECT 1 FROM professional_ue_ecue l
                          WHERE l.ecue_id = e.id AND l.tenant_id = e.tenant_id)
       ORDER BY e.code
       LIMIT $2::int`,
      [tenantId, OWNER_REFERENTIEL_ISSUE_LIMIT],
      log,
      "ecue_orphan"
    );

    // UE sans aucune ECUE : sa moyenne ne peut pas être calculée.
    const ueWithoutEcue = await safeQuery<IssueRow>(
      client,
      `SELECT u.id, u.code || ' — ' || u.libelle AS label,
              NULL::text AS detail, p.name AS filiere_name
       FROM professional_ue u
       JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = u.tenant_id
       WHERE u.tenant_id = $1::uuid
         AND ($4::text IS NULL OR u.categorie = $4::text)
         ${FILIERE_FILTER}
         AND NOT EXISTS (SELECT 1 FROM professional_ue_ecue l
                          WHERE l.ue_id = u.id AND l.tenant_id = u.tenant_id)
       ORDER BY p.name, u.code
       LIMIT $5::int`,
      issueParams,
      log,
      "ue_without_ecue"
    );

    const uePriceZero = await safeQuery<IssueRow>(
      client,
      `SELECT u.id, u.code || ' — ' || u.libelle AS label,
              NULL::text AS detail, p.name AS filiere_name
       FROM professional_ue u
       JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = u.tenant_id
       WHERE u.tenant_id = $1::uuid AND u.prix <= 0 AND u.statut = 'actif'
         AND ($4::text IS NULL OR u.categorie = $4::text)
         ${FILIERE_FILTER}
       ORDER BY p.name, u.code
       LIMIT $5::int`,
      issueParams,
      log,
      "ue_price_zero"
    );

    // Semestre sans aucune session, par l'un OU l'autre des deux chemins (§4.4-5).
    const semestreWithoutSession = await safeQuery<IssueRow>(
      client,
      `SELECT sem.id, sem.libelle AS label,
              NULL::text AS detail, p.name AS filiere_name
       FROM professional_semestres sem
       JOIN programmes p ON p.id = sem.filiere_id AND p.tenant_id = sem.tenant_id
       WHERE sem.tenant_id = $1::uuid ${FILIERE_FILTER}
         AND NOT EXISTS (
           SELECT 1 FROM professional_ue_sessions s
           WHERE s.tenant_id = sem.tenant_id
             AND (
               s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                        WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
               OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                              WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
             )
         )
       ORDER BY p.name, sem.libelle
       LIMIT $4::int`,
      // La catégorie d'UE n'a pas de sens sur un semestre : on renumérote plutôt
      // que de laisser un $4 non référencé, que PostgreSQL rejetterait.
      [tenantId, cycleId, filiereIds, OWNER_REFERENTIEL_ISSUE_LIMIT],
      log,
      "semestre_without_session"
    );

    // ECUE obligatoire d'une session ouverte, sans enseignant affecté.
    const ecueWithoutTeacher = await safeQuery<IssueRow>(
      client,
      `SELECT e.id, e.code || ' — ' || e.libelle AS label,
              'Session ' || s.libelle AS detail, p.name AS filiere_name
       FROM professional_ue_sessions s
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = u.tenant_id
       JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
       JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
       WHERE s.tenant_id = $1::uuid
         AND s.statut IN ('ouvert', 'complet', 'en_cours')
         AND l.est_obligatoire = true
         AND ($4::text IS NULL OR u.categorie = $4::text)
         ${FILIERE_FILTER}
         AND NOT EXISTS (
           SELECT 1 FROM professional_session_ecue_teachers t
           WHERE t.ue_session_id = s.id AND t.ecue_id = e.id AND t.tenant_id = s.tenant_id
         )
       ORDER BY p.name, s.libelle, e.code
       LIMIT $5::int`,
      issueParams,
      log,
      "ecue_without_teacher"
    );

    // Matières académiques orphelines : GET /courses les masque (JOIN interne au
    // lieu de LEFT JOIN), elles n'apparaissent donc nulle part dans l'UI.
    const courseOrphan = await safeQuery<IssueRow>(
      client,
      `SELECT co.id, co.name AS label,
              CASE WHEN co.programme_id IS NULL AND co.bilan_type_id IS NULL
                     THEN 'Sans filière ni type de bilan'
                   WHEN co.programme_id IS NULL THEN 'Sans filière'
                   ELSE 'Sans type de bilan' END AS detail,
              NULL::text AS filiere_name
       FROM courses co
       WHERE co.tenant_id = $1::uuid
         AND (co.programme_id IS NULL OR co.bilan_type_id IS NULL)
       ORDER BY co.name
       LIMIT $2::int`,
      [tenantId, OWNER_REFERENTIEL_ISSUE_LIMIT],
      log,
      "course_orphan"
    );

    /* ---- Mutualisation des ECUE ---- */
    const mutualisationRows = await safeQuery<{
      ecue_id: string;
      code: string;
      libelle: string;
      ue_count: string | number;
    }>(
      client,
      `SELECT e.id AS ecue_id, e.code, e.libelle,
              COUNT(DISTINCT l.ue_id)::int AS ue_count
       FROM professional_ecue e
       JOIN professional_ue_ecue l ON l.ecue_id = e.id AND l.tenant_id = e.tenant_id
       WHERE e.tenant_id = $1::uuid
       GROUP BY e.id, e.code, e.libelle
       HAVING COUNT(DISTINCT l.ue_id) > 1
       ORDER BY ue_count DESC, e.code
       LIMIT 20`,
      [tenantId],
      log,
      "ecueMutualisation"
    );

    const toIssues = (
      kind: OwnerReferentielIssue["kind"],
      rows: IssueRow[]
    ): OwnerReferentielIssue[] =>
      rows.map((r) => ({
        kind,
        id: r.id,
        label: r.label,
        detail: r.detail,
        filiereName: r.filiere_name,
      }));

    const groups: [OwnerReferentielIssue["kind"], IssueRow[]][] = [
      ["ue_nb_uv_mismatch", ueNbUvMismatch],
      ["ecue_credits_null", ecueCreditsNull],
      ["ue_without_ecue", ueWithoutEcue],
      ["ecue_orphan", ecueOrphan],
      ["ecue_without_teacher", ecueWithoutTeacher],
      ["semestre_without_session", semestreWithoutSession],
      ["ue_nb_uv_zero", ueNbUvZero],
      ["ue_price_zero", uePriceZero],
      ["course_orphan", courseOrphan],
    ];

    const issues = groups.flatMap(([kind, rows]) => toIssues(kind, rows));
    const issueCounts: Record<string, number> = {};
    for (const [kind, rows] of groups) issueCounts[kind] = rows.length;

    return {
      cycleId,
      filiereIds: filiereIds ?? [],
      categorie: categorie as OwnerUeCategorie | null,
      kpis: {
        activeCycles: Number(k.active_cycles) || 0,
        activeFilieres: Number(k.active_filieres) || 0,
        activeUe: Number(k.active_ue) || 0,
        activeEcue: Number(k.active_ecue) || 0,
        avgCreditsPerSemestre:
          k.avg_credits === null ? null : Math.round((Number(k.avg_credits) || 0) * 10) / 10,
      },
      filieres: filiereRows.map((r) => ({
        filiereId: r.filiere_id,
        name: r.name,
        code: r.code,
        cycleName: r.cycle_name,
        domaine: r.domaine,
        semestreCount: Number(r.semestre_count) || 0,
        ueCount: Number(r.ue_count) || 0,
        ecueCount: Number(r.ecue_count) || 0,
        sumNbUv: Number(r.sum_nb_uv) || 0,
        sumCredits: Number(r.sum_credits) || 0,
        studentCount: Number(r.student_count) || 0,
      })),
      issues,
      issueCounts,
      ecueMutualisation: mutualisationRows.map((r) => ({
        ecueId: r.ecue_id,
        code: r.code,
        libelle: r.libelle,
        ueCount: Number(r.ue_count) || 0,
      })),
    };
  } finally {
    client.release();
  }
}
