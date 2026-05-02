/**
 * Seed d'historique d'absences (démo) pour Fabrice Kouadio (classe J-LP-RIGLA-A-717).
 * Idempotent : supprime d'abord les sessions/absences marquées "DEMO_ABSENCE_SEED".
 *
 * Depuis apps/api : npx tsx scripts/seed-absences-fabrice-lprigla.ts
 */
import "dotenv/config";
import { Client } from "pg";

const STUDENT_EMAIL = "fabrice.kouadio.lprigla01@example.com";
const CLASS_CODE = "J-LP-RIGLA-A-717";
const SEED_MARKER = "DEMO_ABSENCE_SEED";

type AbsenceSpec = {
  daysAgo: number;
  status: "absent" | "excused" | "medical_leave";
  excuseReason: string | null;
  courseIndex: number; // index dans la liste des class_courses (modulo)
  sessionTime: string; // "HH:MM:SS"
};

const ABSENCES: AbsenceSpec[] = [
  { daysAgo: 3, status: "absent", excuseReason: null, courseIndex: 0, sessionTime: "08:00:00" },
  { daysAgo: 7, status: "excused", excuseReason: "Rendez-vous médical", courseIndex: 1, sessionTime: "10:00:00" },
  { daysAgo: 12, status: "medical_leave", excuseReason: "Certificat médical (grippe)", courseIndex: 2, sessionTime: "14:00:00" },
  { daysAgo: 18, status: "absent", excuseReason: null, courseIndex: 3, sessionTime: "16:00:00" },
  { daysAgo: 24, status: "excused", excuseReason: "Démarche administrative familiale", courseIndex: 0, sessionTime: "08:00:00" },
  { daysAgo: 35, status: "medical_leave", excuseReason: "Certificat médical (gastro-entérite)", courseIndex: 1, sessionTime: "10:00:00" },
  { daysAgo: 48, status: "absent", excuseReason: null, courseIndex: 2, sessionTime: "14:00:00" },
];

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    // 1. Classe + tenant
    const classRes = await client.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM classes WHERE code = $1 LIMIT 1`,
      [CLASS_CODE]
    );
    if (classRes.rows.length === 0) {
      throw new Error(`Classe ${CLASS_CODE} introuvable.`);
    }
    const { id: classId, tenant_id: tenantId } = classRes.rows[0];

    // 2. Étudiant (student_profile)
    const studentRes = await client.query<{ id: string }>(
      `SELECT sp.id
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       WHERE u.email = $1 AND sp.tenant_id = $2
       LIMIT 1`,
      [STUDENT_EMAIL, tenantId]
    );
    if (studentRes.rows.length === 0) {
      throw new Error(`Étudiant ${STUDENT_EMAIL} introuvable pour ce tenant.`);
    }
    const studentId = studentRes.rows[0].id;

    // 3. class_courses pour la classe (pour pouvoir créer des sessions)
    const ccRes = await client.query<{ id: string; course_id: string; course_name: string }>(
      `SELECT cc.id, cc.course_id, c.name AS course_name
       FROM class_courses cc
       JOIN courses c ON c.id = cc.course_id
       WHERE cc.class_id = $1 AND cc.tenant_id = $2 AND c.status = 'active'
       ORDER BY c.name`,
      [classId, tenantId]
    );
    if (ccRes.rows.length === 0) {
      throw new Error("Aucun class_course actif trouvé pour cette classe.");
    }
    const classCourses = ccRes.rows;

    // 4. Trouver un teacher_id et son user_id (pour teacher_id / marked_by)
    //    On prend de préférence un enseignant déjà affecté à un cours de la classe.
    const teacherRes = await client.query<{ teacher_id: string; user_id: string | null }>(
      `SELECT DISTINCT t.id AS teacher_id, t.user_id
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       WHERE ta.tenant_id = $1
         AND ta.class_course_id = ANY($2::uuid[])
         AND ta.status = 'active'
       LIMIT 1`,
      [tenantId, classCourses.map((cc) => cc.id)]
    );
    let teacherId: string | null = teacherRes.rows[0]?.teacher_id ?? null;
    let teacherUserId: string | null = teacherRes.rows[0]?.user_id ?? null;

    if (!teacherId) {
      const fallback = await client.query<{ id: string; user_id: string | null }>(
        `SELECT id, user_id FROM teachers WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
        [tenantId]
      );
      teacherId = fallback.rows[0]?.id ?? null;
      teacherUserId = fallback.rows[0]?.user_id ?? null;
    }

    if (!teacherId) {
      throw new Error("Aucun enseignant disponible pour servir de teacher_id.");
    }

    // marked_by attend un users.id. On essaie en cascade :
    //   1) le user_id du teacher choisi, 2) tout teacher du tenant ayant un user_id,
    //   3) un admin/super_admin du tenant.
    let markedBy = teacherUserId;
    if (!markedBy) {
      const anyTeacherUser = await client.query<{ user_id: string }>(
        `SELECT user_id FROM teachers
         WHERE tenant_id = $1 AND user_id IS NOT NULL AND status = 'active'
         LIMIT 1`,
        [tenantId]
      );
      markedBy = anyTeacherUser.rows[0]?.user_id ?? null;
    }
    if (!markedBy) {
      const adminRes = await client.query<{ id: string }>(
        `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = $1 AND r.key IN ('admin', 'super_admin')
         LIMIT 1`,
        [tenantId]
      );
      markedBy = adminRes.rows[0]?.id ?? null;
    }
    if (!markedBy) {
      throw new Error("Impossible de résoudre marked_by (aucun user enseignant ni admin).");
    }

    console.log(`Tenant=${tenantId}\nClasse=${classId}\nÉtudiant=${studentId}\nTeacher=${teacherId}\nMarkedBy=${markedBy}\nCours dispo=${classCourses.length}`);

    // 5. Nettoyage idempotent : supprimer les anciennes données seed
    //    (cascade implicite : on supprime d'abord les attendances, puis les sessions seed)
    const oldSessions = await client.query<{ id: string }>(
      `SELECT id FROM attendance_sessions
       WHERE tenant_id = $1 AND notes = $2`,
      [tenantId, SEED_MARKER]
    );
    if (oldSessions.rows.length > 0) {
      const ids = oldSessions.rows.map((r) => r.id);
      await client.query(
        `DELETE FROM student_attendance WHERE tenant_id = $1 AND session_id = ANY($2::uuid[])`,
        [tenantId, ids]
      );
      await client.query(
        `DELETE FROM attendance_sessions WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, ids]
      );
      console.log(`Nettoyage : ${ids.length} session(s) seed supprimée(s).`);
    }

    // 6. Insertion des absences
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let inserted = 0;
    for (const a of ABSENCES) {
      const cc = classCourses[a.courseIndex % classCourses.length];
      const sessionDate = new Date(today);
      sessionDate.setDate(sessionDate.getDate() - a.daysAgo);

      await client.query("BEGIN");
      try {
        const sessionInsert = await client.query<{ id: string }>(
          `INSERT INTO attendance_sessions (
             tenant_id, class_course_id, teacher_id, session_date, session_time,
             duration_minutes, session_type, status, notes, started_at, completed_at
           ) VALUES (
             $1, $2, $3, $4, $5, 120, 'theory', 'completed', $6, $7, $8
           )
           RETURNING id`,
          [
            tenantId,
            cc.id,
            teacherId,
            ymd(sessionDate),
            a.sessionTime,
            SEED_MARKER,
            new Date(`${ymd(sessionDate)}T${a.sessionTime}Z`).toISOString(),
            new Date(`${ymd(sessionDate)}T${a.sessionTime}Z`).toISOString(),
          ]
        );
        const sessionId = sessionInsert.rows[0].id;

        await client.query(
          `INSERT INTO student_attendance (
             tenant_id, session_id, student_id, attendance_status,
             excuse_reason, marked_by, marked_at, notes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tenantId,
            sessionId,
            studentId,
            a.status,
            a.excuseReason,
            markedBy,
            new Date(`${ymd(sessionDate)}T${a.sessionTime}Z`).toISOString(),
            SEED_MARKER,
          ]
        );

        await client.query("COMMIT");
        inserted++;
        console.log(`  + ${ymd(sessionDate)} ${a.sessionTime} — ${a.status} — ${cc.course_name}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    console.log(`\nTerminé : ${inserted} absence(s) seedée(s) pour ${STUDENT_EMAIL}.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
