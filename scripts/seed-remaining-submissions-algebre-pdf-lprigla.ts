/**
 * Insère des soumissions « rendu PDF » pour les étudiants de la classe J-LP-RIGLA-A-717
 * qui n’ont pas encore de soumission soumise pour le devoir
 * « Algèbre — Devoir PDF (sujet joint) » (cours Algèbre Linéaire sous EXCEL).
 *
 * Les lignes sont enregistrées comme status `submitted` avec fichier fictif cohérent
 * (même schéma d’URL qu’une soumission existante si trouvée) pour apparaître dans
 * /teacher/corrections (compte enseignant koffi.nguessan.ci@example.com).
 *
 * Aucun libellé du type « automatique » dans les champs texte.
 *
 * Prérequis : DATABASE_URL (apps/api/.env ou racine .env), données seed (classe + devoir).
 *
 * Usage :
 *   pnpm exec tsx scripts/seed-remaining-submissions-algebre-pdf-lprigla.ts
 *   DRY_RUN=1 pnpm exec tsx scripts/seed-remaining-submissions-algebre-pdf-lprigla.ts
 *
 * Variables optionnelles :
 *   ASSIGNMENT_TITLE   — titre exact ou partiel (défaut : Algèbre — Devoir PDF (sujet joint))
 *   CLASS_CODE         — défaut J-LP-RIGLA-A-717
 *   COURSE_CODE        — défaut ALG-BRE-LIN-AIRE-SOU
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../apps/api/.env') });

const CLASS_CODE = process.env.CLASS_CODE || 'J-LP-RIGLA-A-717';
const COURSE_CODE = process.env.COURSE_CODE || 'ALG-BRE-LIN-AIRE-SOU';
const ASSIGNMENT_TITLE =
  process.env.ASSIGNMENT_TITLE || 'Algèbre — Devoir PDF (sujet joint)';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const FALLBACK_FILE_NAME = 'Rendu.pdf';
const FALLBACK_FILE_URL = '/api/v1/files/seed-rendu-algebre.pdf';
const FALLBACK_SIZE_MB = 0.08;

async function tableColumns(client: Client, table: string): Promise<Set<string>> {
  const r = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `,
    [table]
  );
  return new Set(r.rows.map((x) => x.column_name));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL manquant. Définissez-le dans apps/api/.env ou .env à la racine.');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const cols = await tableColumns(client, 'assignment_submissions');
    const hasInstanceId = cols.has('assignment_instance_id');

    const classRes = await client.query<{ id: string; tenant_id: string; name: string }>(
      `SELECT id, tenant_id, name FROM classes WHERE code = $1 LIMIT 1`,
      [CLASS_CODE]
    );
    if (classRes.rows.length === 0) {
      throw new Error(`Classe introuvable (code « ${CLASS_CODE} »).`);
    }
    const classRow = classRes.rows[0]!;
    const tenantId = classRow.tenant_id;
    const classId = classRow.id;

    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    const assignExact = await client.query<{
      assignment_id: string;
      title: string;
      instance_id: string | null;
    }>(
      `
      SELECT a.id AS assignment_id, a.title, ai.id AS instance_id
      FROM assignments a
      JOIN courses c ON c.id = a.course_id AND c.tenant_id = a.tenant_id
      LEFT JOIN assignment_instances ai
        ON ai.assignment_id = a.id AND ai.class_id = $3 AND ai.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
        AND c.code = $2
        AND a.title = $4
        AND a.status = 'published'
      LIMIT 1
    `,
      [tenantId, COURSE_CODE, classId, ASSIGNMENT_TITLE]
    );

    const assignRes =
      assignExact.rows.length > 0
        ? assignExact
        : await client.query<{
            assignment_id: string;
            title: string;
            instance_id: string | null;
          }>(
            `
      SELECT a.id AS assignment_id, a.title, ai.id AS instance_id
      FROM assignments a
      JOIN courses c ON c.id = a.course_id AND c.tenant_id = a.tenant_id
      LEFT JOIN assignment_instances ai
        ON ai.assignment_id = a.id AND ai.class_id = $3 AND ai.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
        AND c.code = $2
        AND a.type = 'homework'
        AND a.title ILIKE '%Devoir PDF%'
        AND a.title ILIKE '%sujet joint%'
        AND a.status = 'published'
      ORDER BY a.created_at DESC
      LIMIT 1
    `,
            [tenantId, COURSE_CODE, classId]
          );

    if (assignRes.rows.length === 0) {
      const hint = await client.query<{ id: string; title: string }>(
        `
        SELECT a.id, a.title
        FROM assignments a
        JOIN courses c ON c.id = a.course_id AND c.tenant_id = a.tenant_id
        JOIN assignment_instances ai ON ai.assignment_id = a.id AND ai.class_id = $2
        WHERE a.tenant_id = $1 AND c.code = $3 AND a.type = 'homework'
        ORDER BY a.created_at DESC
        LIMIT 8
      `,
        [tenantId, classId, COURSE_CODE]
      );
      console.error(
        `Devoir introuvable : titre exact « ${ASSIGNMENT_TITLE} », cours ${COURSE_CODE}, classe ${CLASS_CODE}.`
      );
      if (hint.rows.length) {
        console.error('Devoirs homework récents pour ce cours / classe :');
        hint.rows.forEach((r) => console.error(`  - ${r.title} (${r.id})`));
      }
      process.exit(1);
    }

    const { assignment_id: assignmentId, title, instance_id: instanceId } = assignRes.rows[0]!;
    if (!instanceId) {
      throw new Error(
        `Instance de devoir introuvable (assignment_instances) pour ce devoir et la classe ${CLASS_CODE}.`
      );
    }

    const sample = await client.query<{
      submitted_file_url: string | null;
      submitted_file_name: string | null;
      submitted_file_size_mb: string | null;
    }>(
      `
      SELECT submitted_file_url, submitted_file_name, submitted_file_size_mb
      FROM assignment_submissions
      WHERE tenant_id = $1 AND assignment_id = $2
        AND submitted_file_url IS NOT NULL
        AND submitted_file_url <> ''
      LIMIT 1
    `,
      [tenantId, assignmentId]
    );

    const refUrl = sample.rows[0]?.submitted_file_url || FALLBACK_FILE_URL;
    const refNameBase =
      sample.rows[0]?.submitted_file_name?.replace(/\.pdf$/i, '') || 'Rendu';
    const refSizeMb = sample.rows[0]?.submitted_file_size_mb
      ? parseFloat(String(sample.rows[0].submitted_file_size_mb))
      : FALLBACK_SIZE_MB;

    const students = await client.query<{
      student_id: string;
      first_name: string;
      last_name: string;
    }>(
      `
      SELECT DISTINCT sp.id AS student_id, u.first_name, u.last_name
      FROM student_enrollments se
      JOIN student_profiles sp ON sp.id = se.student_id
      JOIN users u ON u.id = sp.user_id
      WHERE se.class_id = $1
        AND se.tenant_id = $2
        AND (se.status = 'active' OR se.status IS NULL)
      ORDER BY u.last_name, u.first_name
    `,
      [classId, tenantId]
    );

    if (students.rows.length === 0) {
      throw new Error(`Aucun étudiant actif inscrit dans la classe « ${CLASS_CODE} ».`);
    }

    console.log(`Tenant: ${tenantId}`);
    console.log(`Classe: ${classRow.name} (${CLASS_CODE})`);
    console.log(`Devoir: ${title} (${assignmentId})`);
    console.log(`Instance: ${instanceId}`);
    console.log(`Étudiants inscrits: ${students.rows.length}\n`);

    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    for (const row of students.rows) {
      const { student_id, first_name, last_name } = row;
      const safeLast = (last_name || 'Etudiant').replace(/[^\wÀ-ÿ-]+/g, '_');
      const fileName = `${refNameBase}_${safeLast}.pdf`;

      const existing = await client.query<{ id: string; status: string }>(
        `
        SELECT id, status
        FROM assignment_submissions
        WHERE tenant_id = $1 AND assignment_id = $2 AND student_id = $3 AND attempt_number = 1
        LIMIT 1
      `,
        [tenantId, assignmentId, student_id]
      );

      if (existing.rows.length > 0) {
        const st = existing.rows[0]!.status;
        if (st === 'graded' || st === 'submitted') {
          console.log(`Ignoré (déjà ${st}) : ${first_name} ${last_name}`);
          skipped++;
          continue;
        }
        if (DRY_RUN) {
          console.log(`[DRY_RUN] Finaliserait in_progress → submitted : ${first_name} ${last_name}`);
          updated++;
          continue;
        }
        const instSet = hasInstanceId ? `, assignment_instance_id = $8` : '';
        const params: unknown[] = [
          refUrl,
          fileName,
          refSizeMb,
          student_id,
          assignmentId,
          tenantId,
          existing.rows[0]!.id,
        ];
        if (hasInstanceId) params.push(instanceId);
        await client.query(
          `
          UPDATE assignment_submissions
          SET
            submitted_file_url = $1,
            submitted_file_name = $2,
            submitted_file_size_mb = $3,
            status = 'submitted',
            submitted_at = NOW(),
            is_late = false,
            updated_at = NOW()
            ${instSet}
          WHERE student_id = $4 AND assignment_id = $5 AND tenant_id = $6 AND id = $7
        `,
          params
        );
        console.log(`Mis à jour (soumis) : ${first_name} ${last_name}`);
        updated++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[DRY_RUN] Insérerait soumission : ${first_name} ${last_name}`);
        inserted++;
        continue;
      }

      if (hasInstanceId) {
        await client.query(
          `
          INSERT INTO assignment_submissions (
            tenant_id, assignment_id, student_id, attempt_number,
            submitted_file_url, submitted_file_name, submitted_file_size_mb,
            status, is_late, submitted_at, assignment_instance_id
          ) VALUES (
            $1, $2, $3, 1,
            $4, $5, $6,
            'submitted', false, NOW(), $7
          )
        `,
          [tenantId, assignmentId, student_id, refUrl, fileName, refSizeMb, instanceId]
        );
      } else {
        await client.query(
          `
          INSERT INTO assignment_submissions (
            tenant_id, assignment_id, student_id, attempt_number,
            submitted_file_url, submitted_file_name, submitted_file_size_mb,
            status, is_late, submitted_at
          ) VALUES (
            $1, $2, $3, 1,
            $4, $5, $6,
            'submitted', false, NOW()
          )
        `,
          [tenantId, assignmentId, student_id, refUrl, fileName, refSizeMb]
        );
      }
      console.log(`Inséré : ${first_name} ${last_name}`);
      inserted++;
    }

    console.log('\nRésumé :');
    console.log(`  Insérés : ${inserted}`);
    console.log(`  Mis à jour : ${updated}`);
    console.log(`  Ignorés (déjà soumis/noté) : ${skipped}`);
    if (DRY_RUN) {
      console.log('\nMode DRY_RUN : aucune écriture en base.');
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
