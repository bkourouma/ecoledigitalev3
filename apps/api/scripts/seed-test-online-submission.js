/**
 * Crée une soumission de test pour l'évaluation en ligne N1
 * avec les réponses de Fatoumata. Q1, Q2 : auto-OK. Q3 : auto-OK
 * (réponse `300000`). Q4 : longue, à corriger manuellement.
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

  const ASSIGNMENT_ID = "216b5fb6-6c28-4823-83ef-92e668c6c1c9"; // Évaluation en ligne N1
  const studentRes = await c.query(
    `SELECT sp.id, sp.tenant_id FROM student_profiles sp
     WHERE sp.user_id = '71076362-6255-4cf8-8c82-295cb7a1798a'`
  );
  const student = studentRes.rows[0];

  // Crée la soumission
  const subRes = await c.query(
    `INSERT INTO professional_assignment_submissions
       (tenant_id, assignment_id, student_id, statut, submitted_at)
     VALUES ($1, $2, $3, 'soumis', now())
     ON CONFLICT (assignment_id, student_id) DO UPDATE
       SET statut = 'soumis', submitted_at = now(), updated_at = now()
     RETURNING id`,
    [student.tenant_id, ASSIGNMENT_ID, student.id]
  );
  const submissionId = subRes.rows[0].id;
  console.log("Soumission créée :", submissionId);

  // Récupère les questions
  const qs = await c.query(
    `SELECT id, type, points, correct_answer, position
     FROM professional_assignment_questions
     WHERE assignment_id = $1 ORDER BY position`,
    [ASSIGNMENT_ID]
  );

  // Insère des réponses avec auto-correction
  const answers = [
    { qIdx: 0, selected: ["b"], correct: true }, // Q1 mcq_single : bonne réponse
    { qIdx: 1, selected: ["true"], correct: true }, // Q2 true_false : bonne
    { qIdx: 2, text: "300000", correct: true }, // Q3 short_answer : bonne réponse exacte
    {
      qIdx: 3,
      text:
        "Le coût complet répartit toutes les charges (directes ET indirectes) sur les produits en utilisant des clés de répartition globales (unités d'œuvre). La méthode ABC, elle, identifie les activités consommées par chaque produit et utilise des inducteurs de coût plus fins. Exemple : pour une PME qui fabrique 3 produits, le coût complet répartira les frais d'usine au prorata des heures-machine, alors que l'ABC distinguera les coûts de réglage, de contrôle qualité et de logistique. L'ABC est plus pertinente quand les produits consomment très différemment les ressources de support.",
      correct: null, // à corriger manuellement
    },
  ];

  for (const a of answers) {
    const q = qs.rows[a.qIdx];
    const isCorrect = a.correct;
    let pointsEarned = null;
    if (isCorrect === true) pointsEarned = Number(q.points);
    else if (isCorrect === false) pointsEarned = 0;
    // sinon null = à corriger manuellement

    await c.query(
      `INSERT INTO professional_assignment_question_answers
         (tenant_id, submission_id, question_id, answer_text, selected_option_ids,
          is_correct, points_earned, graded_manually)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)
       ON CONFLICT (submission_id, question_id) DO UPDATE
         SET answer_text = EXCLUDED.answer_text,
             selected_option_ids = EXCLUDED.selected_option_ids,
             is_correct = EXCLUDED.is_correct,
             points_earned = EXCLUDED.points_earned,
             updated_at = now()`,
      [
        student.tenant_id,
        submissionId,
        q.id,
        a.text ?? null,
        a.selected ? JSON.stringify(a.selected) : null,
        isCorrect,
        pointsEarned,
      ]
    );
    console.log(
      "  Q" + q.position + " [" + q.type + "] " + (isCorrect === true ? "auto-OK" : isCorrect === false ? "auto-KO" : "manuel")
    );
  }
  console.log("\n✅ Soumission test prête pour la correction.");
  console.log("  Submission ID:", submissionId);
  console.log("  Étudiant: Fatoumata (Q1+Q2+Q3 auto = 12pts, Q4 à corriger sur 8)");

  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
