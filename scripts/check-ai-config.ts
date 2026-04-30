/**
 * Script de diagnostic pour vérifier la configuration de l'API OpenAI
 * et le processus de génération de questions IA
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Charger les variables d'environnement
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../apps/api/.env') });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const TENANT_ID = '6eb9c106-b650-4398-b6fa-091b6828c4ba';

async function checkAIConfiguration() {
  console.log('🔍 Vérification de la configuration IA\n');

  // 1. Vérifier la clé API OpenAI
  console.log('1️⃣  Vérification de la clé API OpenAI...');
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.log('   ❌ OPENAI_API_KEY n\'est pas définie dans les variables d\'environnement');
    console.log('   📝 Pour configurer :');
    console.log('      - Ajoutez OPENAI_API_KEY=sk-... dans apps/api/.env');
    console.log('      - Redémarrez le serveur API\n');
    return false;
  } else {
    console.log(`   ✅ OPENAI_API_KEY est configurée (finissant par: ...${openaiKey.slice(-10)})\n`);
  }

  // 2. Vérifier que l'API est accessible
  console.log('2️⃣  Vérification de l\'accessibilité de l\'API...');
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/ai-evaluations/rate-limit/${TENANT_ID}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': TENANT_ID,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log('   ✅ API accessible');
      console.log(`   📊 Limites de taux:`, data);
    } else {
      console.log(`   ⚠️  API accessible mais erreur: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log(`   📄 Détails: ${errorText}`);
    }
  } catch (error) {
    console.log(`   ❌ Impossible d'accéder à l'API: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`   💡 Vérifiez que le serveur API est démarré sur ${API_BASE_URL}\n`);
    return false;
  }

  // 3. Vérifier le service AI
  console.log('\n3️⃣  Vérification du service AI...');
  try {
    // Tester avec un appel simple
    const testResponse = await fetch(`${API_BASE_URL}/api/v1/ai-evaluations/generate-questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': TENANT_ID,
      },
      body: JSON.stringify({
        extractedContent: 'Test content for AI service verification',
        questionConfig: {
          mcq: 1,
          short_answer: 0,
          long_answer: 0,
          true_false: 0,
          difficulty: 'medium'
        }
      }),
    });

    if (testResponse.ok) {
      const testData = await testResponse.json();
      console.log('   ✅ Service AI fonctionnel');
      console.log(`   📊 Questions générées: ${testData.questions?.length || 0}`);
    } else {
      const errorData = await testResponse.json().catch(() => ({ error: 'Unknown error' }));
      console.log(`   ❌ Erreur du service AI: ${errorData.error || errorData.message || testResponse.statusText}`);
      
      if (errorData.error?.includes('OPENAI_API_KEY')) {
        console.log('   💡 La clé API OpenAI n\'est pas correctement configurée côté serveur');
      }
    }
  } catch (error) {
    console.log(`   ❌ Erreur lors du test du service AI: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 4. Instructions
  console.log('\n📋 Instructions pour résoudre les problèmes:');
  console.log('   1. Vérifiez que OPENAI_API_KEY est définie dans apps/api/.env');
  console.log('   2. Redémarrez le serveur API après avoir ajouté la clé');
  console.log('   3. Vérifiez les logs du serveur API pour les erreurs détaillées');
  console.log('   4. Assurez-vous que la clé API OpenAI est valide et a des crédits\n');

  return true;
}

async function checkAssignmentGeneration(assignmentId?: string) {
  if (!assignmentId) {
    console.log('\n💡 Pour vérifier la génération d\'une évaluation spécifique:');
    console.log('   node scripts/check-ai-config.ts <assignment-id>\n');
    return;
  }

  console.log(`\n🔍 Vérification de la génération pour l'évaluation ${assignmentId}\n`);

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/assignments/${assignmentId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': TENANT_ID,
      },
    });

    if (response.ok) {
      const assignment = await response.json();
      console.log('📋 Informations sur l\'évaluation:');
      console.log(`   - Titre: ${assignment.title}`);
      console.log(`   - Type: ${assignment.type}`);
      console.log(`   - Mode de création: ${assignment.creation_mode}`);
      console.log(`   - Statut de génération IA: ${assignment.ai_generation_status || 'N/A'}`);
      
      if (assignment.ai_generation_error) {
        console.log(`   ❌ Erreur de génération: ${assignment.ai_generation_error}`);
      }

      // Vérifier les questions
      const questionsResponse = await fetch(`${API_BASE_URL}/api/v1/assignments/${assignmentId}/questions`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': TENANT_ID,
        },
      });

      if (questionsResponse.ok) {
        const questionsData = await questionsResponse.json();
        const questions = questionsData.questions || questionsData;
        console.log(`\n📝 Questions: ${Array.isArray(questions) ? questions.length : 0} trouvée(s)`);
        
        if (Array.isArray(questions) && questions.length === 0) {
          console.log('   ⚠️  Aucune question générée');
          console.log('   💡 Vérifiez les logs du serveur API pour voir les erreurs de génération');
        }
      }
    } else {
      console.log(`❌ Impossible de récupérer l'évaluation: ${response.status}`);
    }
  } catch (error) {
    console.log(`❌ Erreur: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const assignmentId = process.argv[2];

  await checkAIConfiguration();
  
  if (assignmentId) {
    await checkAssignmentGeneration(assignmentId);
  } else {
    await checkAssignmentGeneration();
  }
}

main().catch(console.error);





















