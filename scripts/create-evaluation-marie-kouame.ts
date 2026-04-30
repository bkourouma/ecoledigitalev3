/**
 * Script pour créer une évaluation en ligne avec 5 questions
 * pour le compte Prof. Marie Kouamé
 * 
 * Usage: npx tsx scripts/create-evaluation-marie-kouame.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from root directory
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../apps/api/.env') });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const TENANT_SLUG = 'imhotepacademy';
const TENANT_ID = '6eb9c106-b650-4398-b6fa-091b6828c4ba'; // UUID pour imhotepacademy
const TEACHER_EMAIL = 'marie.kouame@imhotepacademy.ci';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'Enseignant2025!'; // Mot de passe par défaut ou depuis .env

interface Question {
  type: 'single_choice' | 'multiple_choice' | 'true_false' | 'short_text' | 'fill_blank';
  question_text: string;
  options?: string[];
  correct_answer: any;
  points: number;
  order_index: number;
  ai_generated: boolean;
}

async function login(): Promise<{ token: string; userId: string }> {
  // Se connecter pour obtenir un token JWT
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_ID,
    },
    body: JSON.stringify({
      email: TEACHER_EMAIL,
      password: TEACHER_PASSWORD,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(`Erreur lors de la connexion: ${error.message || error.error || response.statusText}`);
  }

  const result = await response.json();
  return {
    token: result.token,
    userId: result.user.id,
  };
}

async function getTeacherUserId(token: string, userId: string): Promise<string> {
  // Retourner directement l'userId obtenu lors du login
  return userId;
}

async function getCourseId(userId: string, token: string): Promise<string> {
  // Utiliser l'API pour obtenir les cours de l'enseignant
  const response = await fetch(`${API_BASE_URL}/api/v1/teacher/courses`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_ID,
      'X-User-Id': userId,
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(`Erreur lors de la recherche des cours: ${error.message || error.error || response.statusText}`);
  }

  const courses = await response.json();

  if (Array.isArray(courses) && courses.length > 0) {
    console.log(`✅ Cours trouvé: ${courses[0].courseName || courses[0].name}`);
    return courses[0].courseId || courses[0].id;
  }

  // Si aucun cours assigné, essayer de récupérer n'importe quel cours actif
  const allCoursesResponse = await fetch(`${API_BASE_URL}/api/v1/courses?status=active&limit=1`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_ID,
      'Authorization': `Bearer ${token}`,
    },
  });

  if (allCoursesResponse.ok) {
    const allCourses = await allCoursesResponse.json();
    const course = allCourses.data?.[0] || allCourses[0];
    if (course) {
      console.log(`⚠️  Aucun cours assigné trouvé, utilisation du cours: ${course.name}`);
      return course.id;
    }
  }

  throw new Error('Aucun cours actif trouvé pour ce tenant');
}

async function createEvaluation(courseId: string, userId: string, token: string): Promise<string> {
  const now = new Date();
  const startsAt = new Date(now);
  startsAt.setDate(startsAt.getDate() + 1); // Demain
  const endsAt = new Date(startsAt);
  endsAt.setHours(endsAt.getHours() + 2); // 2 heures après le début

  const evaluationData = {
    course_id: courseId,
    title: 'Contrôle de connaissances - Gestion des Ressources Humaines',
    description: 'Évaluation sur les fondamentaux de la gestion des ressources humaines, les processus de recrutement et la gestion du personnel.',
    type: 'evaluation',
    creation_mode: 'manual',
    evaluation_type: 'online',
    duration_minutes: 60,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    max_attempts: 1,
    shuffle_questions: false,
    show_results_mode: 'after_correction',
  };

  const response = await fetch(`${API_BASE_URL}/api/v1/assignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_ID,
      'X-User-Id': userId,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(evaluationData),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(`Erreur lors de la création de l'évaluation: ${error.message || error.error || response.statusText}`);
  }

  const result = await response.json();
  console.log(`✅ Évaluation créée avec succès: ${result.id}`);
  console.log(`   Titre: ${result.title}`);
  return result.id;
}

async function createQuestion(assignmentId: string, question: Question, token: string): Promise<void> {
  // Préparer les données selon le type de question (identique au code de l'interface)
  const questionData: any = {
    type: question.type,
    question_text: question.question_text,
    correct_answer: question.correct_answer,
    points: question.points,
    order_index: question.order_index,
    ai_generated: question.ai_generated,
  };
  
  // Pour single_choice et multiple_choice, inclure les options
  // Pour short_text et fill_blank, envoyer un tableau vide (comme dans l'interface)
  // Pour true_false, ne pas inclure options
  if (question.type === 'single_choice' || question.type === 'multiple_choice') {
    questionData.options = question.options || [];
  } else if (question.type === 'short_text' || question.type === 'fill_blank') {
    questionData.options = []; // Tableau vide pour ces types (comme dans l'interface)
  }
  // Pour true_false, on n'inclut pas options du tout

  const response = await fetch(`${API_BASE_URL}/api/v1/assignments/${assignmentId}/questions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_ID,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(questionData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = 'Unknown error';
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.message || error.error || error.details || errorText;
    } catch {
      errorMessage = errorText || response.statusText;
    }
    console.error(`   ❌ Détails de l'erreur: ${errorMessage}`);
    throw new Error(`Erreur lors de la création de la question ${question.order_index + 1}: ${errorMessage}`);
  }

  const result = await response.json();
  console.log(`   ✅ Question ${question.order_index + 1} créée: "${question.question_text.substring(0, 50)}..."`);
}

async function main() {
  console.log('🚀 Démarrage de la création de l\'évaluation...\n');

  try {
    // 1. Se connecter pour obtenir un token
    console.log('1️⃣  Connexion de l\'enseignant...');
    const { token, userId } = await login();
    console.log(`   ✅ Connexion réussie: ${TEACHER_EMAIL} (ID: ${userId})\n`);

    // 2. Obtenir un course_id
    console.log('2️⃣  Recherche d\'un cours...');
    const courseId = await getCourseId(userId, token);
    console.log(`   ✅ Cours ID: ${courseId}\n`);

    // 3. Créer l'évaluation
    console.log('3️⃣  Création de l\'évaluation...');
    const assignmentId = await createEvaluation(courseId, userId, token);
    console.log(`   ✅ Évaluation ID: ${assignmentId}\n`);

    // 4. Créer les 4 questions
    console.log('4️⃣  Création des questions...\n');

    const questions: Question[] = [
      {
        type: 'single_choice',
        question_text: 'Quelle est la première étape du processus de recrutement ?',
        options: [
          'La sélection des candidats',
          'L\'analyse des besoins en recrutement',
          'L\'entretien d\'embauche',
          'L\'intégration du nouveau salarié'
        ],
        correct_answer: 1, // L'analyse des besoins en recrutement
        points: 5,
        order_index: 0,
        ai_generated: false,
      },
      {
        type: 'multiple_choice',
        question_text: 'Quels sont les éléments essentiels d\'une fiche de poste ? (Sélectionnez toutes les bonnes réponses)',
        options: [
          'La description des missions',
          'Le profil recherché',
          'Les conditions de travail',
          'Le salaire exact du poste',
          'Les compétences requises'
        ],
        correct_answer: [0, 1, 2, 4], // Description, profil, conditions, compétences
        points: 5,
        order_index: 1,
        ai_generated: false,
      },
      {
        type: 'true_false',
        question_text: 'La gestion des ressources humaines se limite uniquement au recrutement et à la paie.',
        correct_answer: false,
        points: 5,
        order_index: 2,
        ai_generated: false,
      },
      {
        type: 'short_text',
        question_text: 'Expliquez brièvement ce qu\'est la gestion prévisionnelle des emplois et des compétences (GPEC).',
        correct_answer: 'La GPEC est une démarche stratégique qui consiste à anticiper les besoins futurs de l\'entreprise en termes d\'emplois et de compétences, et à mettre en place des actions pour y répondre.',
        points: 5,
        order_index: 3,
        ai_generated: false,
      },
    ];

    for (const question of questions) {
      await createQuestion(assignmentId, question, token);
    }

    console.log('\n✨ Toutes les questions ont été créées avec succès !');
    console.log(`\n📝 Résumé:`);
    console.log(`   - Évaluation ID: ${assignmentId}`);
    console.log(`   - Titre: Contrôle de connaissances - Gestion des Ressources Humaines`);
    console.log(`   - Nombre de questions: ${questions.length}`);
    console.log(`   - Points par question: 5`);
    console.log(`   - Total des points: ${questions.length * 5}`);
    console.log(`\n🔗 URL de l'évaluation: http://localhost:3000/academic/evaluations/${assignmentId}`);

  } catch (error) {
    console.error('\n❌ Erreur:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();

