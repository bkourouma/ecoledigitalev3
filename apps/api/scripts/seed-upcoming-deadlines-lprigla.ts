/**
 * Seed d'échéances à venir (démo) pour la classe J-LP-RIGLA-A-717.
 * Crée des assignments + assignment_instances avec ends_at sur les 30 prochains jours.
 * Idempotent : supprime les anciennes données seed (titre commençant par "[DEMO] ").
 *
 * Depuis apps/api : npx tsx scripts/seed-upcoming-deadlines-lprigla.ts
 */
import "dotenv/config";
import { Client } from "pg";

const CLASS_CODE = "J-LP-RIGLA-A-717";
const SEED_TITLE_PREFIX = "[DEMO] ";

type DeadlineSpec = {
  title: string;
  description: string;
  type: "homework" | "evaluation";
  daysAhead: number;
  hoursAhead?: number;
  durationMinutes?: number | null;
  courseHint?: string; // sous-chaîne du nom de cours pour ciblage; sinon round-robin
};

const DEADLINES: DeadlineSpec[] = [
  {
    title: "Devoir maison — Algèbre matricielle",
    description: "Résolution d'un système 3×3 avec EXCEL et interprétation des résultats.",
    type: "homework",
    daysAhead: 2,
    courseHint: "Algèbre",
  },
  {
    title: "Évaluation surprise — Algorithmes récursifs",
    description: "Petit contrôle de 30 minutes : récursion, complexité et trace d'exécution.",
    type: "evaluation",
    daysAhead: 5,
    durationMinutes: 30,
    courseHint: "Algorithme",
  },
  {
    title: "Compréhension écrite — Article technique en anglais",
    description: "Lecture et synthèse d'un article (≈800 mots) suivi de 5 questions.",
    type: "homework",
    daysAhead: 9,
    courseHint: "Anglais",
  },
  {
    title: "Mini-projet SQL — Conception d'une base bibliothèque",
    description: "Schéma relationnel + scripts CREATE TABLE et requêtes SELECT/JOIN.",
    type: "homework",
    daysAhead: 14,
    courseHint: "SQL",
  },
  {
    title: "Évaluation de mi-parcours — Algèbre Linéaire",
    description: "Épreuve sur table de 1h30 portant sur les chapitres 1 à 3.",
    type: "evaluation",
    daysAhead: 21,
    durationMinutes: 90,
    courseHint: "Algèbre",
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL est absent. Définissez-le dans apps/api/.env");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // 1. Classe + tenant + academic_year
    const classRes = await client.query<{
      id: string;
      tenant_id: string;
      academic_year_id: string;
    }>(
      `SELECT id, tenant_id, academic_year_id FROM classes WHERE code = $1 LIMIT 1`,
      [CLASS_CODE]
    );
    if (classRes.rows.length === 0) {
      throw new Error(`Classe ${CLASS_CODE} introuvable.`);
    }
    const { id: classId, tenant_id: tenantId, academic_year_id: academicYearId } = classRes.rows[0];

    // 2. Cours rattachés à la classe
    const ccRes = await client.query<{ course_id: string; course_name: string }>(
      `SELECT cc.course_id, c.name AS course_name
       FROM class_courses cc
       JOIN courses c ON c.id = cc.course_id
       WHERE cc.class_id = $1 AND cc.tenant_id = $2 AND c.status = 'active'
       ORDER BY c.name`,
      [classId, tenantId]
    );
    if (ccRes.rows.length === 0) {
      throw new Error("Aucun cours actif trouvé pour cette classe.");
    }
    const classCourses = ccRes.rows;

    // 3. Un enseignant pour servir de teacher_id (priorité aux affectés à la classe)
    const teacherRes = await client.query<{ teacher_id: string }>(
      `SELECT DISTINCT t.id AS teacher_id
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN class_courses cc ON cc.id = ta.class_course_id
       WHERE ta.tenant_id = $1
         AND cc.class_id = $2
         AND ta.status = 'active'
       LIMIT 1`,
      [tenantId, classId]
    );
    let teacherId: string | null = teacherRes.rows[0]?.teacher_id ?? null;
    if (!teacherId) {
      const fallback = await client.query<{ id: string }>(
        `SELECT id FROM teachers WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
        [tenantId]
      );
      teacherId = fallback.rows[0]?.id ?? null;
    }
    if (!teacherId) {
      throw new Error("Aucun enseignant disponible pour servir de teacher_id.");
    }

    console.log(
      `Tenant=${tenantId}\nClasse=${classId}\nAcademicYear=${academicYearId}\nTeacher=${teacherId}\nCours dispo=${classCourses.length}`
    );

    // 4. Nettoyage idempotent : supprime les anciens [DEMO]
    const oldAssignments = await client.query<{ id: string }>(
      `SELECT id FROM assignments
       WHERE tenant_id = $1 AND title LIKE $2`,
      [tenantId, `${SEED_TITLE_PREFIX}%`]
    );
    if (oldAssignments.rows.length > 0) {
      const ids = oldAssignments.rows.map((r) => r.id);
      // Les FK de assignment_instances et assignment_submissions vers assignments n'ont
      // pas forcément ON DELETE CASCADE — on supprime explicitement dans l'ordre.
      await client.query(
        `DELETE FROM assignment_submissions
         WHERE tenant_id = $1 AND assignment_id = ANY($2::uuid[])`,
        [tenantId, ids]
      );
      await client.query(
        `DELETE FROM assignment_instances
         WHERE tenant_id = $1 AND assignment_id = ANY($2::uuid[])`,
        [tenantId, ids]
      );
      await client.query(
        `DELETE FROM assignments
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, ids]
      );
      console.log(`Nettoyage : ${ids.length} ancienne(s) [DEMO] supprimée(s).`);
    }

    // 5. Insertion des nouvelles échéances
    const now = new Date();
    let inserted = 0;

    for (let i = 0; i < DEADLINES.length; i++) {
      const d = DEADLINES[i];
      // Choix du cours : par hint si possible, sinon round-robin
      const matched = d.courseHint
        ? classCourses.find((c) =>
            c.course_name.toLowerCase().includes(d.courseHint!.toLowerCase())
          )
        : null;
      const cc = matched ?? classCourses[i % classCourses.length];

      const ends = new Date(now);
      ends.setDate(ends.getDate() + d.daysAhead);
      ends.setHours(18, 0, 0, 0); // échéance à 18:00 locale
      if (d.hoursAhead) ends.setHours(ends.getHours() + d.hoursAhead);

      const starts = new Date(now);
      starts.setHours(starts.getHours() - 1); // déjà ouverte

      const title = `${SEED_TITLE_PREFIX}${d.title}`;

      await client.query("BEGIN");
      try {
        const aRes = await client.query<{ id: string }>(
          `INSERT INTO assignments (
             tenant_id, course_id, teacher_id, title, description, type,
             starts_at, ends_at, duration_minutes, status, evaluation_type, creation_mode
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', 'pdf', 'manual'
           )
           RETURNING id`,
          [
            tenantId,
            cc.course_id,
            teacherId,
            title,
            d.description,
            d.type,
            starts.toISOString(),
            ends.toISOString(),
            d.durationMinutes ?? null,
          ]
        );
        const assignmentId = aRes.rows[0].id;

        await client.query(
          `INSERT INTO assignment_instances (
             tenant_id, assignment_id, class_id, academic_year_id,
             starts_at, ends_at, status, duration_minutes, teacher_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, 'published', $7, $8
           )`,
          [
            tenantId,
            assignmentId,
            classId,
            academicYearId,
            starts.toISOString(),
            ends.toISOString(),
            d.durationMinutes ?? null,
            teacherId,
          ]
        );

        await client.query("COMMIT");
        inserted++;
        const dueLabel = ends.toISOString().split("T")[0];
        console.log(`  + ${dueLabel} — ${d.type.padEnd(10)} — ${cc.course_name} — ${d.title}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    console.log(`\nTerminé : ${inserted} échéance(s) à venir seedée(s) pour ${CLASS_CODE}.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
