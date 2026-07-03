#!/usr/bin/env node

/**
 * Seeds two professional evaluations on a given session, one per requested type:
 *   1. « Évaluation en ligne »      (evaluation_type = 'online')
 *      → questions interactives : QCM choix unique / multiple, vrai-faux,
 *        réponse courte, réponse longue.
 *   2. « Évaluation à sujet unique » (evaluation_type = 'pdf')
 *      → sujet au format texte (subject_content) + remise de fichier activée.
 *
 * Cible par défaut la session indiquée par l'utilisateur. Un autre id de session
 * peut être passé en argument : `node scripts/seed-professional-session-evaluations.js <sessionId>`.
 *
 * Mirroir SQL de ProfessionalAssignmentsService.create / createQuestion afin que
 * les évaluations soient listées par l'admin (onglet « Évaluations » de la
 * session) et corrigeables. Idempotent : ré-exécuter remplace proprement les
 * évaluations de démo (mêmes titres) et leurs questions.
 *
 * Connection order: DATABASE_URL → DB_* env vars → local development defaults.
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadEnv(relativePath) {
  const envPath = path.join(__dirname, "..", relativePath);
  if (!fs.existsSync(envPath)) return;
  try {
    require("dotenv").config({ path: envPath });
  } catch {
    try {
      require(path.join(__dirname, "..", "apps", "api", "node_modules", "dotenv")).config({
        path: envPath,
      });
    } catch {
      // Environment variables already present are enough.
    }
  }
}

loadEnv(".env");
loadEnv(path.join("apps", "api", ".env"));

const DATABASE_URL = process.env.DATABASE_URL;
const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "dbecoledigitale",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || "mysecretpassword",
};

function clientFromEnv() {
  if (DATABASE_URL) return new Client({ connectionString: DATABASE_URL });
  return new Client(DB_CONFIG);
}

// Optional explicit cohorte id (professional_ue_sessions). Otherwise the first
// cohorte with at least one ECUE is used.
const OVERRIDE_SESSION_ID = process.argv[2] || null;

// --- Questions de l'évaluation en ligne (total = 20 pts, aligné sur note_max) ---
const ONLINE_QUESTIONS = [
  {
    position: 1,
    type: "mcq_single",
    question_text:
      "Quelle est la complexité temporelle de la recherche dichotomique dans un tableau trié ?",
    points: 4,
    options: [
      { id: "a", text: "O(n)" },
      { id: "b", text: "O(log n)" },
      { id: "c", text: "O(n log n)" },
      { id: "d", text: "O(1)" },
    ],
    correct_answer: "b",
    explanation: "À chaque étape l'espace de recherche est divisé par deux → O(log n).",
  },
  {
    position: 2,
    type: "mcq_multi",
    question_text:
      "Parmi les structures suivantes, lesquelles sont des structures de données linéaires ?",
    points: 4,
    options: [
      { id: "a", text: "Pile (stack)" },
      { id: "b", text: "File (queue)" },
      { id: "c", text: "Arbre binaire" },
      { id: "d", text: "Liste chaînée" },
    ],
    correct_answer: JSON.stringify(["a", "b", "d"]),
    explanation: "Pile, file et liste chaînée sont linéaires ; l'arbre binaire est hiérarchique.",
  },
  {
    position: 3,
    type: "true_false",
    question_text: "Le tri à bulles (bubble sort) a une complexité moyenne en O(n²).",
    points: 2,
    options: [
      { id: "true", text: "Vrai" },
      { id: "false", text: "Faux" },
    ],
    correct_answer: "true",
    explanation: "Le tri à bulles compare les éléments deux à deux → O(n²) en moyenne et au pire.",
  },
  {
    position: 4,
    type: "short_answer",
    question_text: "Comment appelle-t-on une fonction qui s'appelle elle-même ?",
    points: 4,
    options: null,
    correct_answer: "récursive",
    explanation: "Une fonction récursive s'appelle elle-même jusqu'à un cas d'arrêt.",
  },
  {
    position: 5,
    type: "long_answer",
    question_text:
      "Expliquez la différence entre une recherche séquentielle et une recherche dichotomique, en précisant les conditions d'utilisation de chacune.",
    points: 6,
    options: null,
    correct_answer: null, // correction manuelle
    explanation:
      "La recherche séquentielle parcourt tous les éléments (O(n)) et fonctionne sur des données non triées ; la dichotomique (O(log n)) exige un tableau trié.",
  },
];

async function upsertAssignment(client, tenantId, subjectId, sessionId, createdBy, base) {
  // Retrouve une évaluation de démo existante (même session + type + titre).
  const existing = await client.query(
    `SELECT id FROM professional_assignments
     WHERE tenant_id = $1 AND ue_session_id = $2 AND evaluation_type = $3 AND titre = $4
     LIMIT 1`,
    [tenantId, sessionId, base.evaluation_type, base.titre]
  );

  const cols = {
    tenant_id: tenantId,
    ecue_id: subjectId,
    ue_session_id: sessionId,
    titre: base.titre,
    description: base.description ?? null,
    type: base.type ?? "devoir",
    evaluation_type: base.evaluation_type,
    note_max: base.note_max ?? 20,
    coefficient: base.coefficient ?? 1,
    consigne_url: null,
    starts_at: base.starts_at ?? null,
    due_at: base.due_at ?? null,
    statut: base.statut ?? "publie",
    created_by: createdBy,
    duration_minutes: base.duration_minutes ?? null,
    max_attempts: base.max_attempts ?? 1,
    shuffle_questions: base.shuffle_questions ?? false,
    show_results_mode: base.show_results_mode ?? "after_correction",
    subject_content: base.subject_content ?? null,
    subject_document_url: base.subject_document_url ?? null,
    max_file_size_mb: base.max_file_size_mb ?? 10,
    late_submission_allowed: base.late_submission_allowed ?? false,
    late_penalty_percent: base.late_penalty_percent ?? 0,
    ai_config: base.ai_config ? JSON.stringify(base.ai_config) : null,
    ai_source_material_ids: base.ai_source_material_ids ?? null,
  };

  if (existing.rowCount > 0) {
    const id = existing.rows[0].id;
    const keys = Object.keys(cols).filter((k) => k !== "tenant_id");
    const sets = keys.map((k, i) => `${k} = $${i + 1}`);
    const params = keys.map((k) => cols[k]);
    params.push(id);
    await client.query(
      `UPDATE professional_assignments SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${params.length}`,
      params
    );
    return { id, created: false };
  }

  const keys = Object.keys(cols);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const params = keys.map((k) => cols[k]);
  const res = await client.query(
    `INSERT INTO professional_assignments (${keys.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING id`,
    params
  );
  return { id: res.rows[0].id, created: true };
}

async function replaceQuestions(client, tenantId, assignmentId, questions) {
  await client.query(
    `DELETE FROM professional_assignment_questions WHERE assignment_id = $1 AND tenant_id = $2`,
    [assignmentId, tenantId]
  );
  for (const q of questions) {
    await client.query(
      `INSERT INTO professional_assignment_questions
         (tenant_id, assignment_id, position, type, question_text, points,
          options, correct_answer, explanation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        assignmentId,
        q.position ?? 0,
        q.type,
        q.question_text,
        q.points ?? 1,
        q.options ? JSON.stringify(q.options) : null,
        q.correct_answer ?? null,
        q.explanation ?? null,
      ]
    );
  }
}

async function main() {
  const client = clientFromEnv();
  await client.connect();

  try {
    // Cohorte cible + une ECUE de son UE + tenant (dynamique, ou override CLI).
    const sess = await client.query(
      `SELECT s.id, s.tenant_id, s.libelle,
              e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle
       FROM professional_ue_sessions s
       JOIN professional_ue_ecue l ON l.ue_id = s.ue_id
       JOIN professional_ecue e ON e.id = l.ecue_id
       WHERE ($1::uuid IS NULL OR s.id = $1)
       ORDER BY s.created_at, l.ordre
       LIMIT 1`,
      [OVERRIDE_SESSION_ID]
    );
    if (sess.rowCount === 0) {
      throw new Error("Aucune cohorte avec une ECUE rattachée — exécutez d'abord seed-professional-module-029.js.");
    }
    const { tenant_id: tenantId, ecue_id: subjectId } = sess.rows[0];
    const ueSessionId = sess.rows[0].id;
    console.log(
      `Cohorte « ${sess.rows[0].libelle} » — ECUE ${sess.rows[0].ecue_code} (${sess.rows[0].ecue_libelle})`
    );

    // RLS context (sans effet pour le superuser postgres, requis sinon).
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);

    // Auteur (admin).
    const admin = await client.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND active_role_key IN ('admin','owner')
       ORDER BY active_role_key LIMIT 1`,
      [tenantId]
    );
    const createdBy = admin.rows[0]?.id ?? null;

    // --- 1. Évaluation en ligne -----------------------------------------------
    const online = await upsertAssignment(client, tenantId, subjectId, ueSessionId, createdBy, {
      titre: "Évaluation en ligne — Algorithmique (démo)",
      description:
        "Évaluation interactive : QCM (choix unique / multiple), vrai-faux, réponse courte et réponse longue. Correction automatique des QCM/vrai-faux, correction manuelle des réponses rédigées.",
      type: "qcm",
      evaluation_type: "online",
      note_max: 20,
      coefficient: 1,
      starts_at: "2026-07-01T08:00:00.000Z",
      due_at: "2026-09-15T23:59:00.000Z",
      statut: "publie",
      duration_minutes: 60,
      max_attempts: 1,
      shuffle_questions: false,
      show_results_mode: "after_correction",
    });
    await replaceQuestions(client, tenantId, online.id, ONLINE_QUESTIONS);
    console.log(
      `  [online] ${online.created ? "créée" : "mise à jour"} → ${online.id} (${ONLINE_QUESTIONS.length} questions)`
    );

    // --- 2. Évaluation à sujet unique (PDF / texte) ---------------------------
    const pdf = await upsertAssignment(client, tenantId, subjectId, ueSessionId, createdBy, {
      titre: "Évaluation à sujet unique — Projet algorithmique (démo)",
      description:
        "Sujet unique à traiter et à rendre sous forme de fichier (PDF / Word). L'énoncé est fourni ci-dessous au format texte.",
      type: "projet",
      evaluation_type: "pdf",
      note_max: 20,
      coefficient: 2,
      starts_at: "2026-07-01T08:00:00.000Z",
      due_at: "2026-09-20T23:59:00.000Z",
      statut: "publie",
      subject_content:
        "SUJET — Projet algorithmique\n\n" +
        "1. Implémentez une fonction de tri par insertion et analysez sa complexité.\n" +
        "2. Implémentez une recherche dichotomique récursive sur un tableau trié.\n" +
        "3. Comparez expérimentalement les deux approches de recherche (séquentielle vs dichotomique) sur des jeux de données de tailles croissantes.\n\n" +
        "Rendez un document (PDF ou Word) contenant votre code commenté, vos mesures et votre analyse.",
      subject_document_url: null,
      max_file_size_mb: 20,
      late_submission_allowed: true,
      late_penalty_percent: 10,
    });
    console.log(`  [pdf]    ${pdf.created ? "créée" : "mise à jour"} → ${pdf.id}`);

    // Vérification finale : ce que verra l'onglet « Évaluations » (liste par matière).
    const check = await client.query(
      `SELECT a.titre, a.evaluation_type, a.statut, a.note_max, a.coefficient,
              (SELECT count(*)::int FROM professional_assignment_questions q
                 WHERE q.assignment_id = a.id) AS nb_questions
       FROM professional_assignments a
       WHERE a.ecue_id = $1 AND a.tenant_id = $2
       ORDER BY a.created_at`,
      [subjectId, tenantId]
    );
    console.log("\nÉvaluations visibles pour l'ECUE :");
    console.table(check.rows);
    console.log("\nSeed terminé.");
  } catch (error) {
    console.error("Seed échoué :", error.message);
    if (error.code) console.error("Code:", error.code);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
