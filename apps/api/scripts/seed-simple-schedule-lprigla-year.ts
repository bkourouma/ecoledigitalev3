/**
 * Emploi du temps annuel (session_instances) pour la classe J-LP-RIGLA-A-717,
 * à partir des teacher_assignments + class_courses (même logique métier que /simple-schedule).
 * Idempotent : supprime d’abord les sessions avec la note seed dédiée.
 *
 * Depuis apps/api : npx tsx scripts/seed-simple-schedule-lprigla-year.ts
 */
import "dotenv/config";
import { Client } from "pg";

const CLASS_CODE = "J-LP-RIGLA-A-717";
const SEED_NOTE = "Seed planning annuel LPRIGL-A";

const TIME_SLOT_CONFIG: Record<
  string,
  { start: string; end: string; duration: number }
> = {
  "08:00-10:00": { start: "08:00:00", end: "10:00:00", duration: 120 },
  "10:00-12:00": { start: "10:00:00", end: "12:00:00", duration: 120 },
  "14:00-16:00": { start: "14:00:00", end: "16:00:00", duration: 120 },
  "16:00-18:00": { start: "16:00:00", end: "18:00:00", duration: 120 },
};

const SLOT_KEYS = ["08:00-10:00", "10:00-12:00", "14:00-16:00", "16:00-18:00"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Lundi de la semaine calendaire (heure locale minuit). */
function mondayOfWeekContaining(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0=dim … 1=lun
  const delta = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + delta);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL est absent dans apps/api/.env");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const cl = await client.query<{
      id: string;
      tenant_id: string;
      academic_year_id: string;
    }>(
      `SELECT id, tenant_id, academic_year_id FROM classes WHERE code = $1 LIMIT 1`,
      [CLASS_CODE]
    );
    if (cl.rows.length === 0) throw new Error(`Classe ${CLASS_CODE} introuvable.`);

    const { id: classId, tenant_id: tenantId, academic_year_id: ayId } = cl.rows[0];

    const ay = await client.query<{ start_date: Date | null; end_date: Date | null }>(
      `SELECT start_date, end_date FROM academic_years WHERE id = $1 AND tenant_id = $2`,
      [ayId, tenantId]
    );
    const rawStart = ay.rows[0]?.start_date
      ? new Date(ay.rows[0].start_date)
      : parseYmd("2025-09-01");
    const rawEnd = ay.rows[0]?.end_date ? new Date(ay.rows[0].end_date) : parseYmd("2026-06-30");
    const ayStart = new Date(rawStart.getFullYear(), rawStart.getMonth(), rawStart.getDate());
    const ayEnd = new Date(rawEnd.getFullYear(), rawEnd.getMonth(), rawEnd.getDate());
    ayStart.setHours(0, 0, 0, 0);
    ayEnd.setHours(23, 59, 59, 999);

    const admin = await client.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id AND r.tenant_id = u.tenant_id
       WHERE u.tenant_id = $1 AND r.key IN ('admin', 'super_admin')
       LIMIT 1`,
      [tenantId]
    );
    const createdBy = admin.rows[0]?.id ?? null;

    const assignRes = await client.query<{
      course_id: string;
      teacher_id: string;
      course_name: string;
    }>(
      `SELECT DISTINCT ON (cc.course_id) cc.course_id, ta.teacher_id, c.name AS course_name
       FROM teacher_assignments ta
       INNER JOIN class_courses cc ON cc.id = ta.class_course_id AND cc.tenant_id = ta.tenant_id
       INNER JOIN courses c ON c.id = cc.course_id
       WHERE cc.class_id = $1 AND ta.tenant_id = $2 AND ta.status = 'active'
       ORDER BY cc.course_id, ta.created_at ASC`,
      [classId, tenantId]
    );
    const assignments = assignRes.rows;

    if (assignments.length === 0) {
      throw new Error(
        "Aucune affectation enseignant–cours pour cette classe. Lancez seed:teacher-assignments-lprigla."
      );
    }

    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query("BEGIN");

    const del = await client.query(
      `DELETE FROM session_instances
       WHERE tenant_id = $1 AND class_id = $2 AND notes = $3`,
      [tenantId, classId, SEED_NOTE]
    );
    console.log(`Anciennes sessions seed supprimées : ${del.rowCount ?? 0}`);

    let inserted = 0;
    const weekStart0 = mondayOfWeekContaining(ayStart);

    for (let weekStart = new Date(weekStart0); weekStart <= ayEnd; weekStart = addDays(weekStart, 7)) {
      for (let i = 0; i < assignments.length; i++) {
        const row = assignments[i];
        const dayOffset = i % 5;
        const sessionDay = addDays(weekStart, dayOffset);
        if (sessionDay < ayStart || sessionDay > ayEnd) continue;

        const slotKey = SLOT_KEYS[i % SLOT_KEYS.length];
        const config = TIME_SLOT_CONFIG[slotKey];
        const [sh, sm] = config.start.split(":").map(Number);
        const [eh, em] = config.end.split(":").map(Number);

        const startDt = new Date(
          sessionDay.getFullYear(),
          sessionDay.getMonth(),
          sessionDay.getDate(),
          sh,
          sm,
          0,
          0
        );
        const endDt = new Date(
          sessionDay.getFullYear(),
          sessionDay.getMonth(),
          sessionDay.getDate(),
          eh,
          em,
          0,
          0
        );

        const sessionDateStr = toYmdLocal(sessionDay);

        await client.query(
          `INSERT INTO session_instances (
             tenant_id, class_id, course_id, teacher_id,
             session_date, start_time, end_time, start_datetime, end_datetime,
             classroom, duration_minutes, status, notes, created_by
           )
           VALUES ($1, $2, $3, $4, $5::date, $6::time, $7::time, $8::timestamptz, $9::timestamptz,
                   $10, $11, 'scheduled', $12, $13)`,
          [
            tenantId,
            classId,
            row.course_id,
            row.teacher_id,
            sessionDateStr,
            config.start,
            config.end,
            startDt.toISOString(),
            endDt.toISOString(),
            "TBD",
            config.duration,
            SEED_NOTE,
            createdBy,
          ]
        );
        inserted++;
      }
    }

    await client.query("COMMIT");
    console.log(
      `\n${inserted} séance(s) créée(s) pour ${assignments.length} matière(s), du ${toYmdLocal(ayStart)} au ${toYmdLocal(ayEnd)} (1 créneau / matière / semaine, lun–ven).`
    );
    console.log("Affichage : http://localhost:3000/simple-schedule (calendrier classe) ou l’écran calendrier lié après génération.");
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
