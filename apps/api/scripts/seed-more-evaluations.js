/**
 * Seed plusieurs évaluations complètes pour la session
 * "Juillet 2026 — Comptabilité analytique" afin de tester :
 *   1. Évaluation en ligne complète (5 questions de tous types y compris MCQ multiple)
 *   2. Évaluation à sujet PDF (déjà gérée séparément)
 *   3. Évaluation IA (config sans génération réelle)
 *   4. Évaluation en ligne courte (2 questions) — rapide pour démo
 */

const { Client } = require("pg");
require("dotenv").config({ path: ".env" });

(async () => {
  const c = new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "dbecoledigitale",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || "mysecretpassword",
  });
  await c.connect();

  const sessionId = "dae93750-186a-4488-a445-75c1a7aa9919";
  const sess = await c.query(
    `SELECT tenant_id, professional_subject_id FROM professional_subject_sessions WHERE id = $1`,
    [sessionId]
  );
  const tenantId = sess.rows[0].tenant_id;
  const subjectId = sess.rows[0].professional_subject_id;

  const adminUser = await c.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.tenant_id = $1 AND lower(r.key) IN ('admin','super_admin','administrateur')
     LIMIT 1`,
    [tenantId]
  );
  const createdBy = adminUser.rowCount > 0 ? adminUser.rows[0].id : null;

  /* ===== Évaluation 2 : Online complète avec MCQ multiple ===== */
  const a2 = await c.query(
    `INSERT INTO professional_assignments
     (tenant_id, professional_subject_id, session_id, titre, description,
      type, evaluation_type, note_max, coefficient, statut,
      duration_minutes, max_attempts, shuffle_questions, show_results_mode,
      created_by)
     VALUES ($1, $2, $3, $4, $5, 'devoir', 'online', 30, 2, 'publie',
             60, 1, true, 'after_correction', $6)
     RETURNING id`,
    [tenantId, subjectId, sessionId,
     "Évaluation en ligne N2 — Coûts et marges (Juillet 2026)",
     "Évaluation 60 min sur les coûts complets, ABC et marges. 6 questions, /30."],
    createdBy
  ).catch(() => null) || await c.query(
    `INSERT INTO professional_assignments
     (tenant_id, professional_subject_id, session_id, titre, description,
      type, evaluation_type, note_max, coefficient, statut,
      duration_minutes, max_attempts, shuffle_questions, show_results_mode,
      created_by)
     VALUES ($1, $2, $3, $4, $5, 'devoir', 'online', 30, 2, 'publie',
             60, 1, true, 'after_correction', $6)
     RETURNING id`,
    [tenantId, subjectId, sessionId,
     "Évaluation en ligne N2 — Coûts et marges (Juillet 2026)",
     "Évaluation 60 min sur les coûts complets, ABC et marges. 6 questions, /30.",
     createdBy]
  );
  const evalOnline2 = a2.rows[0].id;
  console.log("Évaluation 'En ligne N2' créée :", evalOnline2);

  const questionsN2 = [
    {
      position: 1,
      type: "mcq_single",
      question_text: "Quelle formule donne le seuil de rentabilité (en chiffre d'affaires) ?",
      points: 4,
      options: [
        { id: "a", text: "Charges fixes × Taux de marge sur coût variable" },
        { id: "b", text: "Charges fixes / Taux de marge sur coût variable" },
        { id: "c", text: "Charges variables / Charges fixes" },
        { id: "d", text: "Chiffre d'affaires − Charges fixes" },
      ],
      correct_answer: "b",
      explanation: "SR (CA) = Charges fixes / Taux de MCV. La MCV doit couvrir d'abord les CF.",
    },
    {
      position: 2,
      type: "mcq_multi",
      question_text:
        "Parmi les éléments suivants, lesquels sont des CHARGES INDIRECTES ? (cochez toutes les bonnes réponses)",
      points: 6,
      options: [
        { id: "a", text: "Salaire d'un ouvrier travaillant sur un seul produit" },
        { id: "b", text: "Loyer de l'atelier (multiples produits)" },
        { id: "c", text: "Matières premières spécifiques à un produit" },
        { id: "d", text: "Amortissement d'une machine partagée" },
        { id: "e", text: "Énergie générale de l'usine" },
      ],
      correct_answer: JSON.stringify(["b", "d", "e"]),
      explanation:
        "Les charges indirectes ne peuvent être affectées à un produit unique sans clé de répartition.",
    },
    {
      position: 3,
      type: "true_false",
      question_text:
        "Dans la méthode ABC, on identifie d'abord les activités, puis on attribue les charges via des inducteurs de coûts.",
      points: 3,
      options: [
        { id: "true", text: "Vrai" },
        { id: "false", text: "Faux" },
      ],
      correct_answer: "true",
      explanation:
        "Exact. ABC = Activity-Based Costing. Étapes : activités → inducteurs → produits.",
    },
    {
      position: 4,
      type: "short_answer",
      question_text:
        "Une entreprise a un CA de 800 000 €, des charges variables de 480 000 € et des charges fixes de 200 000 €. Quel est son résultat (en €) ?",
      points: 5,
      options: null,
      correct_answer: "120000",
      explanation:
        "Résultat = CA − CV − CF = 800 000 − 480 000 − 200 000 = 120 000 €.",
    },
    {
      position: 5,
      type: "short_answer",
      question_text:
        "Reprenez l'entreprise précédente. Quel est son taux de marge sur coût variable en % ?",
      points: 4,
      options: null,
      correct_answer: "40",
      explanation:
        "MCV = 800 000 − 480 000 = 320 000 €. Taux MCV = 320 000 / 800 000 = 40 %.",
    },
    {
      position: 6,
      type: "long_answer",
      question_text:
        "Une PME hésite entre la méthode du coût complet et la méthode du coût variable pour piloter sa marge. Présentez en 10-15 lignes les avantages et inconvénients de chaque méthode et conseillez-la selon son contexte.",
      points: 8,
      options: null,
      correct_answer: null,
      explanation: null,
    },
  ];

  for (const q of questionsN2) {
    await c.query(
      `INSERT INTO professional_assignment_questions
        (tenant_id, assignment_id, position, type, question_text, points, options, correct_answer, explanation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tenantId, evalOnline2, q.position, q.type, q.question_text, q.points,
       q.options ? JSON.stringify(q.options) : null, q.correct_answer, q.explanation]
    );
  }
  console.log("  → 6 questions ajoutées (1 mcq_single, 1 mcq_multi, 1 tf, 2 short, 1 long)");

  /* ===== Évaluation 3 : Online courte ===== */
  const a3 = await c.query(
    `INSERT INTO professional_assignments
     (tenant_id, professional_subject_id, session_id, titre, description,
      type, evaluation_type, note_max, coefficient, statut,
      duration_minutes, max_attempts, shuffle_questions, show_results_mode,
      created_by)
     VALUES ($1, $2, $3, $4, $5, 'controle', 'online', 10, 1, 'publie',
             20, 1, false, 'immediately', $6)
     RETURNING id`,
    [tenantId, subjectId, sessionId,
     "Test rapide — Quiz Comptabilité (5 min)",
     "Petit quiz d'auto-évaluation, 2 questions, résultats immédiats.",
     createdBy]
  );
  const evalOnline3 = a3.rows[0].id;
  console.log("Évaluation 'Test rapide' créée :", evalOnline3);

  const questionsQuick = [
    {
      position: 1,
      type: "mcq_single",
      question_text: "Le coût marginal correspond au coût…",
      points: 5,
      options: [
        { id: "a", text: "Total moyen d'une unité produite" },
        { id: "b", text: "De la dernière unité supplémentaire produite" },
        { id: "c", text: "Des charges fixes uniquement" },
        { id: "d", text: "Variable total divisé par les ventes" },
      ],
      correct_answer: "b",
      explanation: "Le coût marginal = coût de la dernière unité ajoutée (utile pour décisions de production).",
    },
    {
      position: 2,
      type: "true_false",
      question_text: "Le point mort est atteint quand la marge sur coût variable couvre exactement les charges fixes.",
      points: 5,
      options: [
        { id: "true", text: "Vrai" },
        { id: "false", text: "Faux" },
      ],
      correct_answer: "true",
      explanation: "Au point mort : MCV = CF, donc résultat = 0.",
    },
  ];
  for (const q of questionsQuick) {
    await c.query(
      `INSERT INTO professional_assignment_questions
        (tenant_id, assignment_id, position, type, question_text, points, options, correct_answer, explanation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tenantId, evalOnline3, q.position, q.type, q.question_text, q.points,
       JSON.stringify(q.options), q.correct_answer, q.explanation]
    );
  }
  console.log("  → 2 questions ajoutées");

  /* ===== Évaluation 4 : IA générée (config seulement) ===== */
  const a4 = await c.query(
    `INSERT INTO professional_assignments
     (tenant_id, professional_subject_id, session_id, titre, description,
      type, evaluation_type, note_max, coefficient, statut,
      duration_minutes, max_attempts, shuffle_questions, show_results_mode,
      ai_config, created_by)
     VALUES ($1, $2, $3, $4, $5, 'examen', 'ai_generated', 25, 2, 'brouillon',
             50, 1, true, 'after_correction', $6, $7)
     RETURNING id`,
    [tenantId, subjectId, sessionId,
     "Examen IA — Synthèse Comptabilité analytique",
     "Évaluation générée à partir des supports de cours. Statut brouillon — à valider par l'enseignant avant publication.",
     JSON.stringify({
       mcq: 8, short_answer: 4, long_answer: 2, true_false: 6,
       difficulty: "medium",
       instructions: "Focus sur les méthodes ABC et imputation rationnelle, exemples pratiques.",
     }),
     createdBy]
  );
  console.log("Évaluation 'IA' créée (brouillon) :", a4.rows[0].id);

  console.log("\n✅ 3 nouvelles évaluations créées (+ la N1 existante = 4 au total)");
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
