/**
 * Script pour ajouter les 2 questions manquantes à une évaluation
 * Usage: npx tsx scripts/add-missing-questions.ts <assignmentId>
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../apps/api/.env') });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const TENANT_ID = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
const TEACHER_EMAIL = 'marie.kouame@imhotepacademy.ci';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'Enseignant2025!';

async function login(): Promise<{ token: string; userId: string }> {
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

async function createQuestion(assignmentId: string, question: any, token: string): Promise<void> {
  // Préparer les données selon le type de question
  const questionData: any = {
    type: question.type,
    question_text: question.question_text,
    correct_answer: question.correct_answer,
    points: question.points,
    order_index: question.order_index,
    ai_generated: question.ai_generated,
  };
  
  // Pour single_choice et multiple_choice, inclure les options
  // Pour short_text et fill_blank, envoyer un tableau vide
  // Pour true_false, ne pas inclure options
  if (question.type === 'single_choice' || question.type === 'multiple_choice') {
    questionData.options = question.options || [];
  } else if (question.type === 'short_text' || question.type === 'fill_blank') {
    questionData.options = []; // Tableau vide pour ces types
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
    let errorDetails: any = {};
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.message || error.error || error.details || errorText;
      errorDetails = error;
    } catch {
      errorMessage = errorText || response.statusText;
    }
    console.error(`   ❌ Status: ${response.status}`);
    console.error(`   ❌ Détails de l'erreur:`, errorDetails);
    console.error(`   ❌ Données envoyées:`, JSON.stringify(questionData, null, 2));
    throw new Error(`Erreur lors de la création de la question ${question.order_index + 1}: ${errorMessage}`);
  }

  const result = await response.json();
  console.log(`   ✅ Question ${question.order_index + 1} créée: "${question.question_text.substring(0, 50)}..."`);
}

async function main() {
  const assignmentId = process.argv[2];
  
  if (!assignmentId) {
    console.error('❌ Veuillez fournir l\'ID de l\'évaluation');
    console.log('Usage: npx tsx scripts/add-missing-questions.ts <assignmentId>');
    process.exit(1);
  }

  console.log('🚀 Ajout des questions manquantes...\n');

  try {
    const { token } = await login();
    console.log('✅ Connexion réussie\n');

    const questions = [
      {
        type: 'short_text',
        question_text: 'Qu\'est-ce que l\'API REST ?',
        correct_answer: 'REST (Representational State Transfer) est un style d\'architecture pour les services web',
        points: 5,
        order_index: 3,
        ai_generated: false,
      },
      {
        type: 'fill_blank',
        question_text: 'Le protocole HTTP utilise les méthodes GET, POST, PUT et _____ pour les opérations CRUD.',
        correct_answer: 'DELETE',
        points: 5,
        order_index: 4,
        ai_generated: false,
      },
    ];

    for (const question of questions) {
      await createQuestion(assignmentId, question, token);
    }

    console.log('\n✨ Toutes les questions ont été ajoutées avec succès !');
  } catch (error) {
    console.error('\n❌ Erreur:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();

