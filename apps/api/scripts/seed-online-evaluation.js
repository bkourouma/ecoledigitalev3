const { Client } = require("pg");
require("dotenv").config({ path: ".env" });

(async () => {
  const c = new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "dbecoledigitale",
    user: process.env.DB_USER || "postgres",
    password:
      process.env.DB_PASSWORD ||
      process.env.POSTGRES_PASSWORD ||
      "mysecretpassword",
  });
  await c.connect();

  const sessionId = "dae93750-186a-4488-a445-75c1a7aa9919";

  // Récupère le tenant_id et professional_subject_id depuis la session
  const sess = await c.query(
    `SELECT tenant_id, professional_subject_id
     FROM professional_subject_sessions WHERE id = $1`,
    [sessionId]
  );
  if (sess.rowCount === 0) {
    console.error("Session not found:", sessionId);
    process.exit(1);
  }
  const tenantId = sess.rows[0].tenant_id;
  const subjectId = sess.rows[0].professional_subject_id;
  console.log("Session OK | tenant:", tenantId, "| subject:", subjectId);

  // Récupère un user admin (pour created_by)
  const adminUser = await c.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.tenant_id = $1 AND lower(r.key) IN ('admin','administrateur','super_admin')
     LIMIT 1`,
    [tenantId]
  );
  const createdBy = adminUser.rowCount > 0 ? adminUser.rows[0].id : null;

  // Insère l'évaluation en ligne
  const a = await c.query(
    `INSERT INTO professional_assignments
      (tenant_id, professional_subject_id, session_id, titre, description,
       type, evaluation_type, note_max, coefficient, statut,
       duration_minutes, max_attempts, shuffle_questions, show_results_mode,
       created_by)
     VALUES ($1, $2, $3, $4, $5,
       'devoir', 'online', $6, $7, 'publie',
       45, 1, false, 'after_correction', $8)
     RETURNING id`,
    [
      tenantId,
      subjectId,
      sessionId,
      "Évaluation en ligne N1 — Comptabilité analytique (Juillet 2026)",
      "Évaluation en ligne notée sur 20 points : 1 QCM (choix unique), 1 vrai/faux, 1 réponse courte, 1 réponse longue. Durée 45 min, 1 seule tentative autorisée.",
      20,
      1,
      createdBy,
    ]
  );
  const assignmentId = a.rows[0].id;
  console.log("Évaluation créée :", assignmentId);

  // 4 questions : une de chaque type
  const questions = [
    {
      position: 1,
      type: "mcq_single",
      question_text:
        "Parmi les méthodes suivantes, laquelle attribue uniquement les charges DIRECTES (matières, main-d'œuvre directe) à chaque produit, sans répartir les charges indirectes ?",
      points: 5,
      options: [
        { id: "a", text: "Méthode du coût complet" },
        { id: "b", text: "Méthode du coût variable (direct costing)" },
        { id: "c", text: "Méthode ABC (Activity-Based Costing)" },
        { id: "d", text: "Méthode de l'imputation rationnelle" },
      ],
      correct_answer: "b",
      explanation:
        "La méthode du coût variable n'intègre que les charges variables (essentiellement directes). Les méthodes du coût complet, ABC et imputation rationnelle répartissent toutes les charges indirectes.",
    },
    {
      position: 2,
      type: "true_false",
      question_text:
        "La marge sur coût variable est égale à la différence entre le chiffre d'affaires et les charges variables.",
      points: 3,
      options: [
        { id: "true", text: "Vrai" },
        { id: "false", text: "Faux" },
      ],
      correct_answer: "true",
      explanation:
        "Exact. MCV = CA − Charges variables. C'est l'indicateur clé pour calculer le seuil de rentabilité (point mort).",
    },
    {
      position: 3,
      type: "short_answer",
      question_text:
        "Une entreprise réalise 500 000 € de CA avec un taux de marge sur coût variable de 40 %. Ses charges fixes sont de 120 000 €. Quel est son seuil de rentabilité (en €) ?",
      points: 4,
      options: null,
      correct_answer: "300000",
      explanation:
        "Seuil de rentabilité = Charges fixes / Taux de MCV = 120 000 / 0,40 = 300 000 €.",
    },
    {
      position: 4,
      type: "long_answer",
      question_text:
        "Expliquez en 10 à 15 lignes la différence entre la méthode du coût complet et la méthode ABC (Activity-Based Costing). Illustrez avec un exemple chiffré simple et indiquez dans quels cas l'ABC est plus pertinente.",
      points: 8,
      options: null,
      correct_answer: null,
      explanation: null,
    },
  ];

  for (const q of questions) {
    await c.query(
      `INSERT INTO professional_assignment_questions
        (tenant_id, assignment_id, position, type, question_text,
         points, options, correct_answer, explanation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        assignmentId,
        q.position,
        q.type,
        q.question_text,
        q.points,
        q.options ? JSON.stringify(q.options) : null,
        q.correct_answer,
        q.explanation,
      ]
    );
    console.log(`  ${q.position}. [${q.type}] ${q.question_text.slice(0, 60)}…`);
  }

  console.log("\n✅ Évaluation et 4 questions créées avec succès.");
  console.log("\nIds utiles pour les tests :");
  console.log("  Session:    ", sessionId);
  console.log("  Évaluation: ", assignmentId);

  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
