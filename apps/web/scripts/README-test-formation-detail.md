# Script de Test pour les Détails d'une Formation

Ce script permet de diagnostiquer les problèmes d'affichage des détails d'une formation professionnelle.

## Utilisation

### Option 1: Via pnpm (Recommandé)

Depuis la racine du projet :

```bash
cd apps/web
pnpm test:formation-detail
```

### Option 2: Directement avec tsx

Depuis le dossier `apps/web` :

```bash
tsx scripts/test-formation-detail.ts
```

### Option 3: Avec variables d'environnement

```bash
API_BASE_URL=http://localhost:4000 \
NEXT_API_URL=http://localhost:3000 \
TENANT_ID=imhotepdata \
tsx scripts/test-formation-detail.ts
```

## Prérequis

1. **API Backend démarrée** sur le port 4000 (ou celui configuré dans `API_BASE_URL`)
2. **Serveur Next.js démarré** sur le port 3000 (ou celui configuré dans `NEXT_API_URL`)
3. **Node.js** et **tsx** installés

## Ce que le script teste

Le script effectue 5 tests dans l'ordre :

### 1. Vérification dans la base de données
- Affiche la requête SQL attendue pour trouver la formation
- Indique le tenant ID et le slug recherchés

### 2. Test de l'API Backend directement
- Appelle directement l'API backend avec le slug
- Vérifie la réponse et affiche les détails de la formation si trouvée

### 3. Test de la route API Next.js
- Appelle la route proxy Next.js (`/api/v1/formations-pro/[id]`)
- Vérifie que la route transmet correctement la requête au backend

### 4. Liste des formations disponibles
- Récupère la liste complète des formations
- Vérifie si le slug de test existe dans la liste
- Affiche tous les slugs disponibles pour comparaison

### 5. Test avec différentes variations du slug
- Teste différentes variations du slug (encodé, décodé, minuscules, majuscules, etc.)
- Utile si le slug dans l'URL ne correspond pas exactement au slug en base

## Variables d'environnement

Le script utilise les variables d'environnement suivantes (optionnelles) :

- `API_BASE_URL` : URL de l'API backend (défaut: `http://localhost:4000`)
- `NEXT_API_URL` : URL du serveur Next.js (défaut: `http://localhost:3000`)
- `TENANT_ID` : ID du tenant à utiliser (défaut: `imhotepdata`)

## Slug de test

Par défaut, le script teste le slug : `formation-test-data-science`

Pour tester un autre slug, modifiez la constante `TEST_SLUG` dans le fichier `test-formation-detail.ts`.

## Résultats attendus

Si tout fonctionne correctement, vous devriez voir :

```
✅ API Backend: Formation trouvée
✅ Next.js API: Formation trouvée
```

## Dépannage

### Erreur: "API is not running"
- Vérifiez que l'API backend est démarrée : `cd apps/api && pnpm dev`
- Vérifiez le port (défaut: 4000)

### Erreur: "Next.js API: Formation non trouvée"
- Vérifiez que le serveur Next.js est démarré : `cd apps/web && pnpm dev`
- Vérifiez le port (défaut: 3000)

### Formation non trouvée dans la base de données
- Vérifiez que la formation a `actif = true` dans la base
- Vérifiez que le `slug` correspond exactement (sensible à la casse)
- Vérifiez que le `tenant_id` correspond
- Consultez les logs de l'API pour voir quel tenant_id est utilisé

### Le slug dans l'URL ne correspond pas au slug en base
- Le script teste automatiquement différentes variations
- Vérifiez les résultats du "Test 5" pour voir quelle variation fonctionne
- Mettez à jour le slug en base de données si nécessaire

## Exemple de sortie

```
🧪 Test de diagnostic pour l'affichage des détails d'une formation
============================================================
Slug à tester: formation-test-data-science
API Backend: http://localhost:4000
Next.js API: http://localhost:3000
Tenant ID: imhotepdata

📊 Test 1: Vérification dans la base de données
============================================================
Recherche de la formation avec le slug: "formation-test-data-science"
Tenant ID attendu: imhotepdata

🌐 Test 2: Test de l'API Backend directement
============================================================
URL: http://localhost:4000/api/v1/formations-pro/formation-test-data-science
Status: 200 OK
✅ Succès! Formation trouvée:
   ID: 123e4567-e89b-12d3-a456-426614174000
   Titre: Formation Test Data Science
   Slug: formation-test-data-science

🔗 Test 3: Test de la route API Next.js
============================================================
URL: http://localhost:3000/api/v1/formations-pro/formation-test-data-science
Status: 200 OK
✅ Succès! Formation trouvée via Next.js API

📋 Test 4: Liste des formations disponibles
============================================================
✅ Trouvé 3 formation(s):
1. Formation Test Data Science
   Slug: formation-test-data-science
   ID: 123e4567-e89b-12d3-a456-426614174000
   Actif: Oui

✅ Le slug "formation-test-data-science" existe dans la liste!

============================================================
📋 RÉSUMÉ
============================================================
✅ API Backend: Formation trouvée
✅ Next.js API: Formation trouvée
```

