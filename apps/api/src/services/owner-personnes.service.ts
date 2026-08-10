import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerPersonnesQuery, OwnerPersonnesResponse } from "@ecoledigitale/contracts";

/**
 * Démographie et état des comptes : étudiants, enseignants, parents.
 *
 * Pièges appliqués :
 *  - §4.4-9  on ne passe JAMAIS par GET /api/v1/students : cet endpoint déclenche
 *            `enforceSequentialMatricules()`, qui réécrit les matricules de tout le
 *            tenant à chaque appel. On requête `student_profiles` directement.
 *  - §4.4-10 il n'existe pas de table `parents` : un parent est une ligne `users`
 *            portant le rôle `parent`, hors comptes techniques.
 *  - §4.4-11 `teachers.user_id` est nullable — on remonte les enseignants sans
 *            compte plutôt que de les exclure silencieusement.
 *
 * Deux limites du modèle, assumées et exposées à l'écran :
 *  - `student_profiles.is_repeating` n'existe dans AUCUNE migration (la colonne du
 *    même nom vit sur `student_enrollments`, migration 0059). L'indicateur
 *    « étudiants redoublants » du brief n'est donc pas calculable ici : il n'est
 *    pas produit plutôt que d'être approximé.
 *  - aucune colonne ne trace l'ENVOI des identifiants. On mesure la présence de
 *    `users.initial_password`, ce qui dit « généré », pas « transmis ».
 */

/** Nombre de nationalités remontées. */
export const OWNER_PERSONNES_TOP_NATIONALITIES = 10;

/** Amplitude des tranches d'âge, en années. */
export const OWNER_PERSONNES_AGE_BUCKET = 2;

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
    log.warn({ err: e, label }, "owner personnes query failed");
    return [];
  }
}

/**
 * Étudiants du périmètre.
 * $1 tenant, $2 academicYearId (uuid | null), $3 filiereIds (uuid[] | null).
 *
 * `DISTINCT ON (sp.id)` : un étudiant peut avoir plusieurs inscriptions (années
 * successives). Sans cela il serait compté une fois par inscription.
 */
const STUDENT_SCOPE_CTE = `
  student_scope AS (
    SELECT DISTINCT ON (sp.id)
           sp.id, sp.gender::text AS gender, sp.date_of_birth,
           sp.nationality, sp.user_id
    FROM student_profiles sp
    LEFT JOIN student_enrollments se
           ON se.student_id = sp.id AND se.tenant_id = sp.tenant_id
    LEFT JOIN classes cl
           ON cl.id = se.class_id AND cl.tenant_id = se.tenant_id
    WHERE sp.tenant_id = $1::uuid
      AND sp.status = 'active'
      AND ($2::uuid IS NULL OR se.academic_year_id = $2::uuid)
      AND ($3::uuid[] IS NULL OR cl.programme_id = ANY($3::uuid[]))
    ORDER BY sp.id
  )`;

export async function fetchOwnerPersonnes(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerPersonnesQuery
): Promise<OwnerPersonnesResponse> {
  const academicYearId = filters.academicYearId ?? null;
  const filiereIds =
    filters.filiereIds && filters.filiereIds.length > 0 ? filters.filiereIds : null;

  const scopeParams = [tenantId, academicYearId, filiereIds];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- KPI ---- */
    const kpiRows = await safeQuery<{
      active_students: string | number;
      active_teachers: string | number;
      parents: string | number;
      accounts_without_credentials: string | number;
    }>(
      client,
      `WITH ${STUDENT_SCOPE_CTE}
       SELECT (SELECT COUNT(*) FROM student_scope)::int AS active_students,
              (SELECT COUNT(*) FROM teachers t
                WHERE t.tenant_id = $1::uuid AND t.status = 'active')::int AS active_teachers,
              -- §4.4-10 : pas de table parents, on passe par users + user_roles.
              (SELECT COUNT(DISTINCT u.id)
                 FROM users u
                 JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
                 JOIN roles r ON r.id = ur.role_id AND r.key = 'parent'
                WHERE u.tenant_id = $1::uuid
                  AND COALESCE(u.is_technical_account, false) = false)::int AS parents,
              (SELECT COUNT(*) FROM users u
                WHERE u.tenant_id = $1::uuid
                  AND COALESCE(u.is_technical_account, false) = false
                  AND u.initial_password IS NULL)::int AS accounts_without_credentials`,
      scopeParams,
      log,
      "kpis"
    );

    const k = kpiRows[0] ?? {
      active_students: 0,
      active_teachers: 0,
      parents: 0,
      accounts_without_credentials: 0,
    };
    const activeStudents = Number(k.active_students) || 0;
    const activeTeachers = Number(k.active_teachers) || 0;

    /* ---- Répartition par sexe ---- */
    const genderRows = await safeQuery<{ gender: string | null; count: string | number }>(
      client,
      `WITH ${STUDENT_SCOPE_CTE}
       -- La colonne gender est déclarée en ENUM par 0042 et en TEXT par 0079, les
       -- deux en IF NOT EXISTS : le type réel dépend de l'ordre d'application.
       -- Le cast ::text en amont rend la requête indépendante de ce choix.
       SELECT NULLIF(LOWER(TRIM(gender)), '') AS gender, COUNT(*)::int AS count
       FROM student_scope
       GROUP BY NULLIF(LOWER(TRIM(gender)), '')
       ORDER BY count DESC`,
      scopeParams,
      log,
      "genderDistribution"
    );

    /* ---- Pyramide des âges ---- */
    const ageRows = await safeQuery<{ bucket_start: string | number; count: string | number }>(
      client,
      `WITH ${STUDENT_SCOPE_CTE}
       SELECT (FLOOR(EXTRACT(YEAR FROM AGE(date_of_birth)) / $4::int) * $4::int)::int
                AS bucket_start,
              COUNT(*)::int AS count
       FROM student_scope
       WHERE date_of_birth IS NOT NULL
         -- Garde-fou : des dates de naissance aberrantes existent en saisie libre
         -- et écraseraient l'échelle de la pyramide.
         AND EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 5 AND 100
       GROUP BY bucket_start
       ORDER BY bucket_start`,
      [...scopeParams, OWNER_PERSONNES_AGE_BUCKET],
      log,
      "agePyramid"
    );

    /* ---- Effectifs par filière ---- */
    const headcountRows = await safeQuery<{
      filiere_id: string;
      filiere_name: string;
      cycle_name: string | null;
      count: string | number;
    }>(
      client,
      `SELECT p.id AS filiere_id, p.name AS filiere_name, c.name AS cycle_name,
              COUNT(DISTINCT se.student_id)::int AS count
       FROM student_enrollments se
       JOIN classes cl ON cl.id = se.class_id AND cl.tenant_id = se.tenant_id
       JOIN programmes p ON p.id = cl.programme_id AND p.tenant_id = cl.tenant_id
       LEFT JOIN cycles c ON c.id = p.cycle_id AND c.tenant_id = p.tenant_id
       WHERE se.tenant_id = $1::uuid
         AND se.status = 'active'
         AND ($2::uuid IS NULL OR se.academic_year_id = $2::uuid)
         AND ($3::uuid[] IS NULL OR p.id = ANY($3::uuid[]))
       GROUP BY p.id, p.name, c.name
       ORDER BY count DESC, p.name`,
      scopeParams,
      log,
      "headcountByFiliere"
    );

    /* ---- Enseignants par type de contrat ---- */
    const contractRows = await safeQuery<{
      contract_type: string;
      count: string | number;
    }>(
      client,
      `SELECT t.contract_type::text AS contract_type, COUNT(*)::int AS count
       FROM teachers t
       WHERE t.tenant_id = $1::uuid AND t.status = 'active'
       GROUP BY t.contract_type
       ORDER BY count DESC`,
      [tenantId],
      log,
      "teachersByContract"
    );

    /* ---- Détail enseignants ---- */
    const teacherRows = await safeQuery<{
      teacher_id: string;
      teacher_name: string;
      contract_type: string;
      status: string;
      hire_date: Date | string | null;
      seniority_years: string | number | null;
      ecue_count: string | number;
      filiere_count: string | number;
      has_user_account: boolean;
    }>(
      client,
      `SELECT t.id AS teacher_id,
              TRIM(t.first_name || ' ' || t.last_name) AS teacher_name,
              t.contract_type::text AS contract_type,
              t.status::text AS status,
              t.hire_date,
              CASE WHEN t.hire_date IS NULL THEN NULL
                   ELSE EXTRACT(YEAR FROM AGE(t.hire_date))::int END AS seniority_years,
              (SELECT COUNT(DISTINCT st.ecue_id)
                 FROM professional_session_ecue_teachers st
                WHERE st.enseignant_id = t.id AND st.tenant_id = t.tenant_id)::int AS ecue_count,
              (SELECT COUNT(DISTINCT u.filiere_id)
                 FROM professional_session_ecue_teachers st
                 JOIN professional_ue_sessions s
                      ON s.id = st.ue_session_id AND s.tenant_id = st.tenant_id
                 JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
                WHERE st.enseignant_id = t.id AND st.tenant_id = t.tenant_id)::int AS filiere_count,
              (t.user_id IS NOT NULL) AS has_user_account
       FROM teachers t
       WHERE t.tenant_id = $1::uuid
       ORDER BY t.last_name, t.first_name
       LIMIT 200`,
      [tenantId],
      log,
      "teachers"
    );

    /* ---- Nationalités ---- */
    const nationalityRows = await safeQuery<{
      nationality: string;
      count: string | number;
    }>(
      client,
      `WITH ${STUDENT_SCOPE_CTE}
       SELECT TRIM(nationality) AS nationality, COUNT(*)::int AS count
       FROM student_scope
       WHERE NULLIF(TRIM(nationality), '') IS NOT NULL
       GROUP BY TRIM(nationality)
       ORDER BY count DESC, nationality
       LIMIT $4::int`,
      [...scopeParams, OWNER_PERSONNES_TOP_NATIONALITIES],
      log,
      "topNationalities"
    );

    /* ---- Indicateurs de couverture ---- */
    const coverageRows = await safeQuery<{
      students_without_parent: string | number;
      parents_without_child: string | number;
      teachers_without_account: string | number;
      students_without_birth_date: string | number;
    }>(
      client,
      `WITH ${STUDENT_SCOPE_CTE}
       SELECT (SELECT COUNT(*) FROM student_scope ss
                WHERE NOT EXISTS (
                  SELECT 1 FROM student_parents sp2
                  WHERE sp2.student_id = ss.id AND sp2.tenant_id = $1::uuid
                ))::int AS students_without_parent,
              (SELECT COUNT(DISTINCT u.id)
                 FROM users u
                 JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
                 JOIN roles r ON r.id = ur.role_id AND r.key = 'parent'
                WHERE u.tenant_id = $1::uuid
                  AND COALESCE(u.is_technical_account, false) = false
                  AND NOT EXISTS (
                    SELECT 1 FROM student_parents sp3
                    WHERE sp3.parent_id = u.id AND sp3.tenant_id = u.tenant_id
                  ))::int AS parents_without_child,
              (SELECT COUNT(*) FROM teachers t
                WHERE t.tenant_id = $1::uuid AND t.user_id IS NULL)::int
                AS teachers_without_account,
              (SELECT COUNT(*) FROM student_scope
                WHERE date_of_birth IS NULL)::int AS students_without_birth_date`,
      scopeParams,
      log,
      "coverage"
    );

    const cov = coverageRows[0] ?? {
      students_without_parent: 0,
      parents_without_child: 0,
      teachers_without_account: 0,
      students_without_birth_date: 0,
    };

    return {
      academicYearId,
      filiereIds: filiereIds ?? [],
      kpis: {
        activeStudents,
        activeTeachers,
        parents: Number(k.parents) || 0,
        studentTeacherRatio:
          activeTeachers > 0
            ? Math.round((activeStudents / activeTeachers) * 10) / 10
            : null,
        accountsWithoutCredentials: Number(k.accounts_without_credentials) || 0,
      },
      genderDistribution: genderRows.map((r) => ({
        gender: r.gender,
        count: Number(r.count) || 0,
      })),
      agePyramid: ageRows.map((r) => ({
        bucketStart: Number(r.bucket_start) || 0,
        count: Number(r.count) || 0,
      })),
      headcountByFiliere: headcountRows.map((r) => ({
        filiereId: r.filiere_id,
        filiereName: r.filiere_name,
        cycleName: r.cycle_name,
        count: Number(r.count) || 0,
      })),
      teachersByContract: contractRows.map((r) => ({
        contractType: r.contract_type,
        count: Number(r.count) || 0,
      })),
      teachers: teacherRows.map((r) => ({
        teacherId: r.teacher_id,
        teacherName: r.teacher_name || "—",
        contractType: r.contract_type,
        status: r.status,
        hireDate:
          r.hire_date instanceof Date
            ? r.hire_date.toISOString().slice(0, 10)
            : r.hire_date
              ? String(r.hire_date).slice(0, 10)
              : null,
        seniorityYears: r.seniority_years === null ? null : Number(r.seniority_years),
        ecueCount: Number(r.ecue_count) || 0,
        filiereCount: Number(r.filiere_count) || 0,
        hasUserAccount: Boolean(r.has_user_account),
      })),
      topNationalities: nationalityRows.map((r) => ({
        nationality: r.nationality,
        count: Number(r.count) || 0,
      })),
      coverage: {
        studentsWithoutParent: Number(cov.students_without_parent) || 0,
        parentsWithoutChild: Number(cov.parents_without_child) || 0,
        teachersWithoutAccount: Number(cov.teachers_without_account) || 0,
        studentsWithoutBirthDate: Number(cov.students_without_birth_date) || 0,
      },
    };
  } finally {
    client.release();
  }
}
