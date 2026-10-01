# 🧪 Scripts de Test RSO Login

Ce dossier contient des scripts pour tester l'endpoint de connexion RSO et diagnostiquer les problèmes d'authentification.

## 📋 Scripts Disponibles

### 1. **test-rso-login.js** (Node.js - Multiplateforme)
Script Node.js qui teste directement l'API backend.

**Usage:**
```bash
cd apps/api
node scripts/test-rso-login.js
```

**Variables d'environnement:**
- `API_URL`: URL de base de l'API (défaut: `http://localhost:4000`)

### 2. **test-rso-login.ps1** (PowerShell - Windows)
Script PowerShell pour Windows.

**Usage:**
```powershell
cd apps/api
.\scripts\test-rso-login.ps1
```

**Variables d'environnement:**
- `$env:API_URL`: URL de base de l'API (défaut: `http://localhost:4000`)

### 3. **test-rso-login.sh** (Bash - Linux/Mac)
Script Bash pour Linux et Mac.

**Usage:**
```bash
cd apps/api
chmod +x scripts/test-rso-login.sh
./scripts/test-rso-login.sh
```

**Variables d'environnement:**
- `API_URL`: URL de base de l'API (défaut: `http://localhost:4000`)

## 🔧 Prérequis

1. **Serveur API démarré**
   ```bash
   cd apps/api
   pnpm dev
   ```

2. **Base de données accessible**
   - Le serveur doit pouvoir se connecter à PostgreSQL
   - Le tenant ASPCI doit exister dans la base de données

3. **Utilisateur de test**
   - Identifier: `admin@aspci.rso`
   - Password: (défini par SEED_PASSWORD lors de `pnpm seed:rso-admin`)

## 📊 Ce que les scripts testent

1. **Test de santé de l'API**
   - Vérifie que l'API répond sur le port 4000
   - Teste l'endpoint `/api/v1/health`

2. **Test de login RSO**
   - Envoie une requête POST à `/api/v1/rso/auth/login`
   - Utilise les credentials de test
   - Affiche la réponse complète (status, headers, body)

## 🔍 Diagnostic

Les scripts affichent des informations détaillées pour aider au diagnostic:

- **Status Code**: Code HTTP de la réponse
- **Headers**: En-têtes de la réponse (notamment Content-Type)
- **Body**: Corps de la réponse (JSON formaté si possible)
- **Messages d'erreur**: Codes et messages d'erreur détaillés

### Codes d'erreur courants

- **401 Unauthorized**: 
  - Le middleware ne reconnaît pas la route comme publique
  - Vérifier les logs du serveur pour voir l'URL exacte reçue
  - Vérifier que le middleware RSO est bien configuré

- **400 Bad Request**:
  - Requête mal formée
  - Credentials manquants ou invalides

- **500 Internal Server Error**:
  - Erreur serveur
  - Vérifier les logs du serveur pour plus de détails

- **ECONNREFUSED**:
  - Le serveur API n'est pas démarré
  - Vérifier que le serveur tourne sur le port 4000

## 🐛 Débogage

### Vérifier les logs du serveur

Lors d'une tentative de login, le middleware RSO affiche maintenant des logs détaillés:

```
[RSO Auth Middleware] ========================================
[RSO Auth Middleware] Login attempt detected
[RSO Auth Middleware] URL path: /api/v1/rso/auth/login
[RSO Auth Middleware] Full URL: /api/v1/rso/auth/login
[RSO Auth Middleware] Method: POST
[RSO Auth Middleware] Router path: /login
[RSO Auth Middleware] ✅ Public route matched (exact): /api/v1/rso/auth/login
[RSO Auth Middleware] ✅ Skipping authentication for public route
[RSO Auth Middleware] ========================================
```

Si vous voyez `❌ Route NOT recognized as public`, cela signifie que:
- L'URL reçue ne correspond pas exactement aux routes publiques
- Il y a peut-être un problème avec le format de l'URL

### Vérifier l'ordre d'enregistrement des middlewares

Dans `apps/api/src/index.ts`, l'ordre d'enregistrement est important:

```typescript
// 1. Routes publiques d'abord
await fastify.register(healthRoutes, { prefix: "/api/v1" });
await fastify.register(authRoutes, { prefix: "/api/v1/auth" });

// 2. Plugins de contexte
await fastify.register(tenantContextPlugin);
await fastify.register(authMiddleware);

// 3. Middleware RSO (après les autres middlewares)
await fastify.register(rsoAuthMiddleware);

// 4. Routes RSO (après le middleware)
await fastify.register(rsoAuthRoutes, { prefix: "/api/v1/rso/auth" });
```

## 📝 Exemple de sortie

### Succès (200)
```
🧪 Test de l'endpoint RSO Login
============================================================
URL: http://localhost:4000/api/v1/rso/auth/login
============================================================

🏥 Test de santé de l'API...
   ✅ API est accessible

📤 Envoi de la requête de login...

📥 Réponse reçue:
   Status Code: 200
   Content-Type: application/json

📋 Body (JSON):
{
  "user": { ... },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2024-01-01T12:00:00.000Z"
}

============================================================
✅ SUCCÈS: Connexion réussie!
   Token reçu: eyJhbGciOiJIUzI1NiIs...
```

### Erreur 401
```
📥 Réponse reçue:
   Status Code: 401

📋 Body (JSON):
{
  "error": "Authentication Required",
  "message": "No authentication token provided",
  "code": "TOKEN_MISSING"
}

============================================================
❌ ERREUR 401: Non autorisé
   Code: TOKEN_MISSING
   Message: No authentication token provided

💡 Vérifications:
   1. Le middleware RSO reconnaît-il la route comme publique?
   2. L'URL exacte reçue par le serveur correspond-elle?
   3. Y a-t-il d'autres middlewares qui interfèrent?
```

## 🔗 Liens utiles

- [Documentation Fastify Hooks](https://www.fastify.io/docs/latest/Reference/Hooks/)
- [Middleware RSO](../src/plugins/rso-auth-middleware.ts)
- [Routes RSO Auth](../src/routes/rso/auth.ts)

