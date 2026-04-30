/**
 * Met à jour les devoirs déjà créés : retire le préfixe [Auto] des titres et
 * remplace les descriptions qui mentionnent une création automatique / script.
 *
 * À lancer une fois si vous aviez exécuté une ancienne version du seed.
 *
 * Usage : npx tsx scripts/fix-koffi-assignment-labels.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../apps/api/.env') });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
/** UUID tenant imhotepacademy — requis pour PUT /assignments/:id (header brut). */
const TENANT_UUID = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
const TENANT_LOGIN = 'imhotepacademy';

const TEACHER_EMAIL = 'koffi.nguessan.ci@example.com';
const TEACHER_PASSWORD =
  process.env.TEACHER_KOFFI_PASSWORD || 'VbVVr@Ejp88$';

type Auth = { token: string; userId: string };

async function login(): Promise<Auth> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_LOGIN,
    },
    body: JSON.stringify({ email: TEACHER_EMAIL, password: TEACHER_PASSWORD }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      `Connexion (${response.status}): ${(err as any).message || (err as any).error || response.statusText}`
    );
  }
  const result = (await response.json()) as { token: string; user: { id: string } };
  return { token: result.token, userId: result.user.id };
}

async function listAssignments(auth: Auth): Promise<any[]> {
  const url = `${API_BASE_URL}/api/v1/assignments?limit=100`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_UUID,
      'X-User-Id': auth.userId,
      Authorization: `Bearer ${auth.token}`,
    },
  });
  if (!response.ok) {
    const t = await response.text();
    throw new Error(`Liste assignments (${response.status}): ${t}`);
  }
  const data = await response.json();
  return data.assignments || data.data || [];
}

function cleanTitle(title: string): string {
  return title.replace(/^\[Auto\]\s*/i, '').trim();
}

function cleanDescription(
  type: string,
  description: string | null | undefined
): string | undefined {
  if (!description) return undefined;
  const needsFix =
    /\[Auto\]/i.test(description) ||
    /créé automatiquement/i.test(description) ||
    /script\s/i.test(description) ||
    /seed-koffi/i.test(description);
  if (!needsFix) return undefined;
  if (type === 'homework') {
    return 'Devoir sur document PDF : sujet en pièce jointe, remise des fichiers dans les délais indiqués.';
  }
  return 'Évaluation en ligne : questions à choix multiples et réponses courtes.';
}

async function updateAssignment(
  auth: Auth,
  id: string,
  payload: { title?: string; description?: string; subject_content?: string }
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assignments/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_UUID,
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const t = await response.text();
    throw new Error(`PUT ${id} (${response.status}): ${t}`);
  }
}

async function main() {
  const auth = await login();
  const rows = await listAssignments(auth);
  let n = 0;

  for (const a of rows) {
    const title = a.title as string;
    const newTitle = cleanTitle(title);
    const newDesc = cleanDescription(a.type, a.description);
    const payload: {
      title?: string;
      description?: string;
      subject_content?: string;
    } = {};

    if (newTitle !== title) payload.title = newTitle;
    if (newDesc !== undefined) payload.description = newDesc;

    if (a.type === 'homework' && a.subject_content) {
      const sc = a.subject_content as string;
      if (/script|automatique/i.test(sc)) {
        payload.subject_content =
          'Consultez le sujet en PDF joint et déposez votre copie avant la date limite.';
      }
    }

    if (Object.keys(payload).length === 0) continue;

    await updateAssignment(auth, a.id, payload);
    console.log(`✅ ${a.id} — ${title} → ${payload.title ?? title}`);
    n++;
  }

  if (n === 0) {
    console.log('Aucun devoir à corriger (titres/descriptions déjà propres).');
  } else {
    console.log(`\n${n} devoir(s) mis à jour.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
