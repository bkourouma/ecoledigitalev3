/**
 * Affecte des matières (courses) du programme LP RIGL aux enseignants seed « CI »
 * pour la classe J-LP-RIGLA-A-717 (class_courses + teacher_assignments).
 * Le premier enseignant (Koffi N'Guessan) reçoit au moins deux matières.
 *
 * Depuis apps/api : npx tsx scripts/seed-teacher-assignments-lprigla.ts
 */
import "dotenv/config";
import { Client } from "pg";

const CLASS_CODE = "J-LP-RIGLA-A-717";

function toYmd(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().slice(0, 10);
}

async function getOrCreateClassCourseId(
  client: Client,
  tenantId: string,
  classId: string,
  courseId: string
): Promise<string> {
  const ex = await client.query<{ id: string }>(
    `SELECT id FROM class_courses WHERE tenant_id = $1 AND class_id = $2 AND course_id = $3`,
    [tenantId, classId, courseId]
  );
  if (ex.rows.length > 0) return ex.rows[0].id;

  const ins = await client.query<{ id: string }>(
    `INSERT INTO class_courses (tenant_id, class_id, course_id, is_required)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (tenant_id, class_id, course_id) DO UPDATE SET is_required = EXCLUDED.is_required
     RETURNING id`,
    [tenantId, classId, courseId]
  );
  return ins.rows[0].id;
}

async function assignmentExists(
  client: Client,
  tenantId: string,
  teacherId: string,
  classId: string,
  courseId: string
): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM teacher_assignments ta
     INNER JOIN class_courses cc ON cc.id = ta.class_course_id
     WHERE ta.tenant_id = $1 AND ta.teacher_id = $2 AND cc.class_id = $3 AND cc.course_id = $4
       AND ta.status = 'active'
     LIMIT 1`,
    [tenantId, teacherId, classId, courseId]
  );
  return r.rows.length > 0;
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
    const cl = await client.query<{
      id: string;
      tenant_id: string;
      academic_year_id: string;
      programme_id: string;
    }>(
      `SELECT c.id, c.tenant_id, c.academic_year_id, c.programme_id
       FROM classes c
       WHERE c.code = $1
       LIMIT 1`,
      [CLASS_CODE]
    );
    if (cl.rows.length === 0) {
      throw new Error(`Classe « ${CLASS_CODE} » introuvable.`);
    }
    const { id: classId, tenant_id: tenantId, academic_year_id: academicYearId, programme_id: programmeId } =
      cl.rows[0];

    const ay = await client.query<{ start_date: Date | null; end_date: Date | null }>(
      `SELECT start_date, end_date FROM academic_years WHERE id = $1 AND tenant_id = $2`,
      [academicYearId, tenantId]
    );
    let datebut =
      toYmd(ay.rows[0]?.start_date) ?? "2024-09-01";
    let datefin = toYmd(ay.rows[0]?.end_date) ?? "2025-08-31";
    if (datefin < datebut) {
      [datebut, datefin] = [datefin, datebut];
    }

    const teachers = await client.query<{ id: string; email: string; first_name: string; last_name: string }>(
      `SELECT id, email, first_name, last_name
       FROM teachers
       WHERE tenant_id = $1
         AND (email LIKE '%.ci@example.com' OR employee_number LIKE 'CI-ENS-%')
       ORDER BY employee_number NULLS LAST, email`,
      [tenantId]
    );
    if (teachers.rows.length < 2) {
      throw new Error(
        "Enseignants seed CI introuvables. Lancez d’abord npm run seed:teachers-ci."
      );
    }

    const courses = await client.query<{ id: string; name: string }>(
      `SELECT DISTINCT ON (LOWER(TRIM(c.name))) c.id, c.name
       FROM courses c
       WHERE c.tenant_id = $1 AND c.programme_id = $2 AND c.status = 'active'::course_status
       ORDER BY LOWER(TRIM(c.name)), c.created_at DESC`,
      [tenantId, programmeId]
    );
    if (courses.rows.length < 3) {
      throw new Error("Pas assez de matières actives pour ce programme.");
    }

    const t = teachers.rows;
    const crs = courses.rows;

    /** Paires (index enseignant, index cours) — enseignant 0 a deux cours */
    const pairs: [number, number][] = [];
    pairs.push([0, 0], [0, 1]);
    let ci = 1;
    let cj = 2;
    while (ci < t.length && cj < crs.length) {
      pairs.push([ci, cj]);
      ci++;
      cj++;
    }

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    let created = 0;
    let skipped = 0;

    for (const [ti, cjdx] of pairs) {
      const teacher = t[ti];
      const course = crs[cjdx];
      if (await assignmentExists(client, tenantId, teacher.id, classId, course.id)) {
        skipped++;
        console.log(`  = déjà actif : ${teacher.first_name} ${teacher.last_name} → ${course.name}`);
        continue;
      }
      const ccId = await getOrCreateClassCourseId(client, tenantId, classId, course.id);
      await client.query(
        `INSERT INTO teacher_assignments (
           tenant_id, class_course_id, teacher_id, contract_type, datebut, datefin, course_amount, status, notes
         )
         VALUES ($1, $2, $3, 'salarie'::assignment_contract_type, $4::date, $5::date, NULL, 'active', $6)`,
        [
          tenantId,
          ccId,
          teacher.id,
          datebut,
          datefin,
          `Seed affectation LP RIGL (${CLASS_CODE})`,
        ]
      );
      created++;
      console.log(`  + ${teacher.first_name} ${teacher.last_name} → ${course.name}`);
    }

    await client.query("COMMIT");
    console.log(
      `\nTerminé : ${created} affectation(s) créée(s), ${skipped} déjà présente(s). Période : ${datebut} → ${datefin}.`
    );
    console.log(
      `Rappel : la page /academic/assignments filtre sur l’année académique active ; elle doit correspondre à l’année de cette classe (${academicYearId}).`
    );
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
