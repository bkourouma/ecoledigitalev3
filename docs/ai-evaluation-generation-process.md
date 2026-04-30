# Processus de Génération d'Évaluation avec IA

## Vue d'ensemble

Le processus de génération d'évaluation avec IA fonctionne en plusieurs étapes :

1. **Création de l'évaluation** : L'évaluation est créée avec le statut `ai_generation_status = 'processing'`
2. **Génération asynchrone** : La génération des questions se fait de manière asynchrone en arrière-plan
3. **Extraction de texte** : Les documents PDF sont extraits et combinés
4. **Génération IA** : OpenAI génère les questions basées sur le contenu
5. **Insertion en base** : Les questions sont insérées dans la base de données
6. **Mise à jour du statut** : Le statut passe à `'completed'` ou `'failed'`

## Configuration Requise

### 1. Clé API OpenAI

La clé API OpenAI **DOIT** être configurée dans `apps/api/.env` :

```bash
OPENAI_API_KEY=sk-...votre-clé-api...
```

**⚠️ IMPORTANT** : 
- La clé doit être valide et avoir des crédits disponibles
- Le serveur API doit être redémarré après avoir ajouté/modifié la clé
- Vérifiez que la clé n'est pas un placeholder (comme "your-api-key-here")

### 2. Vérification de la Configuration

Utilisez le script de diagnostic :

```bash
npx tsx scripts/check-ai-config.ts
```

Pour vérifier une évaluation spécifique :

```bash
npx tsx scripts/check-ai-config.ts <assignment-id>
```

## Flux de Génération

### Étape 1 : Création de l'Évaluation

**Endpoint** : `POST /api/v1/assignments/ai-evaluation`

**Données requises** :
- `course_id` : ID du cours
- `title` : Titre de l'évaluation
- `source_documents` : Array d'IDs de documents (UUIDs)
- `ai_config` : Configuration des questions
  - `mcq` : Nombre de questions à choix multiples
  - `short_answer` : Nombre de questions à réponse courte
  - `long_answer` : Nombre de questions à développement
  - `true_false` : Nombre de questions Vrai/Faux
  - `difficulty` : Niveau de difficulté ('easy', 'medium', 'hard')

**Réponse** : L'évaluation est créée avec `ai_generation_status = 'processing'`

### Étape 2 : Génération Asynchrone

La génération se fait en arrière-plan via `setImmediate()` pour ne pas bloquer la réponse HTTP.

**Fonction** : `generateQuestionsForAssignment(fastify, assignmentId, tenantId)`

### Étape 3 : Extraction de Contenu

1. Récupération des documents depuis `course_materials` basés sur `source_documents`
2. Pour chaque document :
   - Récupération du fichier depuis le stockage (MinIO)
   - Extraction du texte avec `TextExtractionService`
   - Nettoyage du texte
3. Combinaison de tout le contenu en une seule chaîne

### Étape 4 : Génération IA

**Service** : `AIEvaluationService.generateQuestions()`

**Processus** :
1. Validation du contenu (minimum 100 caractères)
2. Vérification des limites de taux
3. Pour chaque type de question :
   - Construction du prompt spécifique
   - Appel à OpenAI API (modèle `gpt-4-turbo-preview`)
   - Parsing de la réponse JSON
   - Validation et formatage des questions
4. Retour de toutes les questions générées

### Étape 5 : Insertion en Base

Pour chaque question générée :
1. Insertion dans `evaluation_questions`
2. Insertion des métadonnées dans `ai_generated_questions`

### Étape 6 : Mise à Jour du Statut

- **Succès** : `ai_generation_status = 'completed'`
- **Échec** : `ai_generation_status = 'failed'` + `ai_generation_error = message d'erreur`

## Dépannage

### Problème : Les questions ne sont pas créées

**Vérifications** :

1. **Clé API manquante ou invalide**
   ```bash
   # Vérifier dans apps/api/.env
   cat apps/api/.env | grep OPENAI_API_KEY
   ```
   - La clé doit commencer par `sk-`
   - Vérifiez qu'elle n'est pas un placeholder

2. **Statut de génération**
   ```sql
   SELECT id, title, ai_generation_status, ai_generation_error 
   FROM assignments 
   WHERE id = '<assignment-id>';
   ```
   - Si `ai_generation_status = 'processing'` : La génération est en cours
   - Si `ai_generation_status = 'failed'` : Vérifiez `ai_generation_error`
   - Si `ai_generation_status = 'completed'` : Vérifiez les questions

3. **Logs du serveur API**
   ```bash
   # Cherchez les logs avec :
   # - "Starting AI question generation"
   # - "Failed to generate questions"
   # - "Successfully generated X questions"
   ```

4. **Documents source**
   ```sql
   SELECT cm.id, cm.title, cm.processing_status 
   FROM course_materials cm 
   WHERE cm.id = ANY(
     SELECT jsonb_array_elements_text(source_documents::jsonb)::uuid 
     FROM assignments 
     WHERE id = '<assignment-id>'
   );
   ```
   - Vérifiez que les documents existent
   - Vérifiez que `processing_status = 'completed'`

5. **Limites de taux**
   - Par défaut : 50 requêtes/heure, 100 000 tokens/heure
   - Vérifiez avec : `GET /api/v1/ai-evaluations/rate-limit/:tenantId`

### Problème : Erreur "OPENAI_API_KEY environment variable is required"

**Solution** :
1. Ajoutez `OPENAI_API_KEY=sk-...` dans `apps/api/.env`
2. Redémarrez le serveur API
3. Vérifiez que la variable est bien chargée au démarrage

### Problème : Erreur "Rate limit exceeded"

**Solution** :
- Attendez que la limite se réinitialise (toutes les heures)
- Ou augmentez les limites dans les variables d'environnement :
  ```bash
  AI_RATE_LIMIT_PER_HOUR=100
  AI_TOKEN_LIMIT_PER_HOUR=200000
  ```

### Problème : Erreur "No response from OpenAI"

**Causes possibles** :
- Clé API invalide ou expirée
- Pas de crédits sur le compte OpenAI
- Problème réseau avec l'API OpenAI
- Contenu trop court ou invalide

**Solution** :
1. Vérifiez votre compte OpenAI : https://platform.openai.com/usage
2. Testez la clé API manuellement
3. Vérifiez que le contenu extrait fait au moins 100 caractères

## Vérification Manuelle

### Vérifier les questions générées

```sql
SELECT 
  eq.id,
  eq.type,
  eq.question_text,
  eq.points,
  eq.order_index,
  eq.ai_generated,
  aiq.difficulty_level,
  aiq.ai_model_version
FROM evaluation_questions eq
LEFT JOIN ai_generated_questions aiq ON eq.id = aiq.evaluation_question_id
WHERE eq.assignment_id = '<assignment-id>'
ORDER BY eq.order_index;
```

### Vérifier le statut de génération

```sql
SELECT 
  id,
  title,
  ai_generation_status,
  ai_generation_error,
  created_at,
  updated_at
FROM assignments
WHERE id = '<assignment-id>';
```

## Logs Importants

Le serveur API log les étapes suivantes :

- `🤖 Starting AI question generation for assignment {id}`
- `📋 Step X: ...` (étapes de génération)
- `✅ Successfully completed AI generation for assignment {id}`
- `❌ Failed to generate questions for assignment {id}`

## Support

En cas de problème persistant :
1. Vérifiez les logs complets du serveur API
2. Vérifiez la configuration de la clé API
3. Testez avec le script de diagnostic
4. Vérifiez le statut dans la base de données





















