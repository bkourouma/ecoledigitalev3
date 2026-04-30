/**
 * Enregistre des moyennes (sur 20) + assiduité (absence/justifié) pour les étudiants GERNA.
 * Cible: classe BTS-GERNA-1-500, périodes Semestre 1 et Semestre 2 (si présentes).
 *
 * Depuis apps/api :
 *   npx tsx scripts/seed-semester-averages-bts-gerna-1-500.ts
 */
import "dotenv/config";
import { Client } from "pg";

const CLASS_CODE = "BTS-GERNA-1-500";
const GERNA_EMAIL_PATTERN = "%.gerna%@example.com";

function normalizedKey(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildAverage(studentId: string, courseId: string, periodName: string): number {
  const seed = `${studentId}:${courseId}:${normalizedKey(periodName)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  // Génère une note stable entre 8.00 et 17.80
  const raw = 8 + (hash % 99) / 10;
  return Math.round(raw * 100) / 100;
}

function buildAttendance(studentId: string, periodName: string): { absenceHours: number; justifiedHours: number } {
  const seed = `${studentId}:attendance:${normalizedKey(periodName)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }

  const absenceHours = hash % 9; // 0 -> 8h (entier)
  const justifiedFactor = ((hash >>> 3) % 101) / 100; // 0 -> 1
  const justifiedHours = Math.floor(Math.min(absenceHours, absenceHours * justifiedFactor)); // entier
  return { absenceHours, justifiedHours };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL est absent. Définissez-le dans apps/api/.env");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const classRes = await client.query<{
      id: string;
      tenant_id: string;
      academic_year_id: string;
      name: string;
      programme_id: string | null;
    }>(
      `
      SELECT id, tenant_id, academic_year_id, name, programme_id
      FROM classes
      WHERE code = $1
      LIMIT 1
      `,
      [CLASS_CODE]
    );

    if (classRes.rows.length === 0) {
      throw new Error(`Classe introuvable: ${CLASS_CODE}`);
    }

    const classRow = classRes.rows[0];
    if (!classRow.programme_id) {
      throw new Error(`La classe ${CLASS_CODE} n'a pas de programme associé.`);
    }

    const periodsRes = await client.query<{ id: string; name: string }>(
      `
      SELECT id, name
      FROM academic_year_periods
      WHERE tenant_id = $1 AND academic_year_id = $2
      ORDER BY COALESCE(start_date, created_at) ASC, created_at ASC
      `,
      [classRow.tenant_id, classRow.academic_year_id]
    );
    if (periodsRes.rows.length === 0) {
      throw new Error("Aucune période académique trouvée pour l'année de la classe.");
    }

    const semesterPeriods = periodsRes.rows.filter((p) => {
      const n = normalizedKey(p.name);
      return n.includes("semestre 1") || n.includes("semestre 2");
    });
    const targetPeriods =
      semesterPeriods.length > 0 ? semesterPeriods : [periodsRes.rows[0]];

    const coursesRes = await client.query<{ id: string; code: string; name: string }>(
      `
      SELECT c.id, c.code, c.name
      FROM courses c
      WHERE c.tenant_id = $1 AND c.programme_id = $2
      ORDER BY c.created_at DESC
      `,
      [classRow.tenant_id, classRow.programme_id]
    );
    if (coursesRes.rows.length === 0) {
      throw new Error("Aucune matière trouvée pour le programme de la classe.");
    }

    const studentsRes = await client.query<{ student_id: string; email: string; full_name: string }>(
      `
      SELECT
        sp.id AS student_id,
        LOWER(u.email) AS email,
        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS full_name
      FROM student_enrollments se
      JOIN student_profiles sp ON sp.id = se.student_id
      JOIN users u ON u.id = sp.user_id
      WHERE se.tenant_id = $1
        AND se.class_id = $2
        AND se.status = 'active'
        AND LOWER(u.email) LIKE LOWER($3)
      ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST
      `,
      [classRow.tenant_id, classRow.id, GERNA_EMAIL_PATTERN]
    );

    if (studentsRes.rows.length === 0) {
      throw new Error("Aucun étudiant GERNA ciblé trouvé dans cette classe.");
    }

    await client.query("BEGIN");

    let gradeUpserts = 0;
    let attendanceUpserts = 0;
    for (const period of targetPeriods) {
      for (const student of studentsRes.rows) {
        for (const course of coursesRes.rows) {
          const average = buildAverage(student.student_id, course.id, period.name);
          await client.query(
            `
            INSERT INTO student_period_course_averages (
              tenant_id, academic_year_period_id, class_id, student_id, course_id, average
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (tenant_id, academic_year_period_id, student_id, course_id)
            DO UPDATE SET
              average = EXCLUDED.average,
              class_id = EXCLUDED.class_id,
              updated_at = NOW()
            `,
            [classRow.tenant_id, period.id, classRow.id, student.student_id, course.id, average]
          );
          gradeUpserts++;
        }

        const attendance = buildAttendance(student.student_id, period.name);
        await client.query(
          `
          INSERT INTO student_period_attendance_summaries (
            tenant_id, academic_year_period_id, class_id, student_id, absence_hours, justified_hours
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (tenant_id, academic_year_period_id, class_id, student_id)
          DO UPDATE SET
            absence_hours = EXCLUDED.absence_hours,
            justified_hours = EXCLUDED.justified_hours,
            updated_at = NOW()
          `,
          [
            classRow.tenant_id,
            period.id,
            classRow.id,
            student.student_id,
            attendance.absenceHours,
            attendance.justifiedHours,
          ]
        );
        attendanceUpserts++;
      }
    }

    await client.query("COMMIT");

    console.log(`Classe: ${classRow.name} (${CLASS_CODE})`);
    console.log(
      `Périodes cibles: ${targetPeriods.map((p) => `${p.name} (${p.id})`).join(" | ")}`
    );
    console.log(`Étudiants ciblés: ${studentsRes.rows.length}`);
    console.log(`Matières trouvées: ${coursesRes.rows.length}`);
    console.log(`Total moyennes upsertées: ${gradeUpserts}`);
    console.log(`Total assiduités upsertées: ${attendanceUpserts}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
