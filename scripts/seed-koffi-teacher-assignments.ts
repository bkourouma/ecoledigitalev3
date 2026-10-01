/**
 * Crée 7 devoirs/évaluations pour l'enseignant Koffi N'Guessan (imhotepacademy) :
 * - Cours : Algèbre Linéaire sous EXCEL (code ALG-BRE-LIN-AIRE-SOU) et Algorithme 2 (ALGORITHME-2-1)
 * - Types : évaluations en ligne (questions) + devoirs PDF (avec fichier PDF joint)
 *
 * Prérequis : API sur localhost:4000, base seedée (utilisateur enseignant + affectations cours).
 *
 * Usage :
 *   pnpm exec tsx scripts/seed-koffi-teacher-assignments.ts
 *
 * Variables d'environnement (optionnel) :
 *   NEXT_PUBLIC_API_URL  — défaut http://localhost:4000
 *   TEACHER_KOFFI_PASSWORD — défaut : même mot de passe que la page /login (compte démo enseignant)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../apps/api/.env') });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const TENANT_HEADER = 'imhotepacademy';

const TEACHER_EMAIL = 'koffi.nguessan.ci@example.com';
/** Mot de passe de ce compte : fourni par TEACHER_KOFFI_PASSWORD (aucune valeur par défaut). */
const TEACHER_PASSWORD =
  process.env.TEACHER_KOFFI_PASSWORD || (() => { throw new Error("TEACHER_KOFFI_PASSWORD est requis"); })();

const TARGET_COURSES = [
  { code: 'ALG-BRE-LIN-AIRE-SOU', label: 'Algèbre Linéaire sous EXCEL' },
  { code: 'ALGORITHME-2-1', label: 'Algorithme 2' },
] as const;

/** PDF minimal valide (%PDF…) pour les devoirs type PDF. */
function buildMinimalPdfBuffer(title: string): Buffer {
  const safe = title.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length ${Buffer.byteLength(content, 'utf8')} >>stream
${content}
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000065 00000 n 
0000000126 00000 n 
0000000280 00000 n 
0000000400 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
480
%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

type Auth = { token: string; userId: string };

async function login(): Promise<Auth> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_HEADER,
    },
    body: JSON.stringify({
      email: TEACHER_EMAIL,
      password: TEACHER_PASSWORD,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      `Connexion échouée (${response.status}): ${(err as any).message || (err as any).error || response.statusText}`
    );
  }

  const result = (await response.json()) as { token: string; user: { id: string } };
  return { token: result.token, userId: result.user.id };
}

type TeacherCourseRow = {
  courseId: string;
  courseName: string;
  courseCode: string;
  className: string;
};

async function fetchTeacherCourses(auth: Auth): Promise<TeacherCourseRow[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/teacher/courses`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_HEADER,
      'X-User-Id': auth.userId,
      Authorization: `Bearer ${auth.token}`,
    },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      `Liste des cours enseignant (${response.status}): ${(err as any).message || (err as any).error || response.statusText}`
    );
  }

  const data = (await response.json()) as TeacherCourseRow[];
  return Array.isArray(data) ? data : [];
}

function resolveCourseId(
  courses: TeacherCourseRow[],
  code: string,
  label: string
): string {
  const norm = (s: string) => s.trim().toUpperCase();
  const target = norm(code);
  const row = courses.find((c) => norm(c.courseCode) === target);
  if (row) return row.courseId;

  const byName = courses.find(
    (c) =>
      c.courseName.toLowerCase().includes(label.toLowerCase().slice(0, 12)) ||
      c.courseCode.toUpperCase().includes(target.slice(0, 8))
  );
  if (byName) {
    console.warn(
      `⚠️  Code exact "${code}" introuvable — utilisation du cours "${byName.courseName}" (${byName.courseCode}).`
    );
    return byName.courseId;
  }

  console.error(
    'Cours disponibles:',
    courses.map((c) => `${c.courseCode} — ${c.courseName}`).join('\n')
  );
  throw new Error(`Cours introuvable pour code "${code}" (${label}).`);
}

function authHeaders(auth: Auth): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Tenant': TENANT_HEADER,
    'X-User-Id': auth.userId,
    Authorization: `Bearer ${auth.token}`,
  };
}

async function createAssignment(
  auth: Auth,
  body: Record<string, unknown>
): Promise<{ id: string; title: string }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assignments`, {
    method: 'POST',
    headers: authHeaders(auth),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Création assignment (${response.status}): ${text}`);
  }

  return response.json() as Promise<{ id: string; title: string }>;
}

async function createSampleQuestion(
  auth: Auth,
  assignmentId: string,
  orderIndex: number,
  label: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/assignments/${assignmentId}/questions`,
    {
      method: 'POST',
      headers: authHeaders(auth),
      body: JSON.stringify({
        type: 'single_choice',
        question_text: `${label} — Choisissez la bonne réponse.`,
        options: ['Réponse A', 'Réponse B', 'Réponse C', 'Réponse D'],
        correct_answer: 1,
        points: 5,
        order_index: orderIndex,
        ai_generated: false,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Question (${response.status}): ${text}`);
  }
}

async function uploadSubjectPdf(
  auth: Auth,
  assignmentId: string,
  filename: string,
  pdf: Buffer
): Promise<void> {
  // Utiliser FormData / File natifs (undici) : le package `form-data` + fetch() ne sérialise pas le fichier correctement.
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const form = new FormData();
  form.append('assignmentId', assignmentId);
  form.append('documentType', 'subject_document');
  form.append('file', blob, filename);

  const response = await fetch(
    `${API_BASE_URL}/api/v1/assignments/upload-document`,
    {
      method: 'POST',
      headers: {
        'X-Tenant': TENANT_HEADER,
        'X-User-Id': auth.userId,
        Authorization: `Bearer ${auth.token}`,
      },
      body: form,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload PDF (${response.status}): ${text}`);
  }
}

function windowDates(index: number): { starts_at: string; ends_at: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1 + index);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

async function main() {
  console.log('Connexion enseignant…');
  const auth = await login();
  console.log(`OK — ${TEACHER_EMAIL} (user ${auth.userId})\n`);

  const courses = await fetchTeacherCourses(auth);
  const algId = resolveCourseId(
    courses,
    TARGET_COURSES[0].code,
    TARGET_COURSES[0].label
  );
  const algoId = resolveCourseId(
    courses,
    TARGET_COURSES[1].code,
    TARGET_COURSES[1].label
  );
  console.log(`Cours Algèbre → ${algId}`);
  console.log(`Cours Algorithme 2 → ${algoId}\n`);

  /** 7 créations : 5 évaluations en ligne + 2 devoirs PDF (1 par cours). */
  const plan: Array<{
    courseId: string;
    kind: 'online' | 'pdf';
    title: string;
  }> = [
    {
      courseId: algId,
      kind: 'online',
      title: 'Algèbre — Évaluation en ligne 1/3',
    },
    {
      courseId: algId,
      kind: 'online',
      title: 'Algèbre — Évaluation en ligne 2/3',
    },
    {
      courseId: algId,
      kind: 'pdf',
      title: 'Algèbre — Devoir PDF (sujet joint)',
    },
    {
      courseId: algId,
      kind: 'online',
      title: 'Algèbre — Évaluation en ligne 3/3',
    },
    {
      courseId: algoId,
      kind: 'online',
      title: 'Algorithme 2 — Évaluation en ligne 1/2',
    },
    {
      courseId: algoId,
      kind: 'online',
      title: 'Algorithme 2 — Évaluation en ligne 2/2',
    },
    {
      courseId: algoId,
      kind: 'pdf',
      title: 'Algorithme 2 — Devoir PDF (sujet joint)',
    },
  ];

  const created: { id: string; title: string; url: string }[] = [];

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i]!;
    const dates = windowDates(i);

    if (item.kind === 'online') {
      const row = await createAssignment(auth, {
        course_id: item.courseId,
        title: item.title,
        description:
          'Évaluation en ligne : questions à choix multiples et réponses courtes.',
        type: 'evaluation',
        creation_mode: 'manual',
        evaluation_type: 'online',
        duration_minutes: 60,
        starts_at: dates.starts_at,
        ends_at: dates.ends_at,
        max_attempts: 1,
        shuffle_questions: false,
        show_results_mode: 'after_correction',
      });
      await createSampleQuestion(auth, row.id, 0, item.title);
      created.push({
        id: row.id,
        title: row.title,
        url: `http://localhost:3000/academic/evaluations/${row.id}`,
      });
      console.log(`✅ En ligne — ${row.title} → ${row.id}`);
    } else {
      const row = await createAssignment(auth, {
        course_id: item.courseId,
        title: item.title,
        description:
          'Devoir sur document PDF : sujet en pièce jointe, remise des fichiers dans les délais indiqués.',
        type: 'homework',
        creation_mode: 'manual',
        evaluation_type: 'pdf',
        subject_content:
          'Consultez le sujet en PDF joint et déposez votre copie avant la date limite.',
        starts_at: dates.starts_at,
        ends_at: dates.ends_at,
        max_attempts: 1,
        max_file_size_mb: 15,
        late_submission_allowed: false,
        show_results_mode: 'after_correction',
      });
      const slug = item.title.replace(/[^\w.-]+/g, '_').slice(0, 40);
      const pdf = buildMinimalPdfBuffer(item.title);
      await uploadSubjectPdf(auth, row.id, `${slug}.pdf`, pdf);
      created.push({
        id: row.id,
        title: row.title,
        url: `http://localhost:3000/academic/evaluations/${row.id}`,
      });
      console.log(`✅ PDF — ${row.title} → ${row.id} (+ fichier sujet)`);
    }
  }

  console.log(`\nTerminé — ${created.length} enregistrement(s).\n`);
  for (const c of created) {
    console.log(` - ${c.url}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
