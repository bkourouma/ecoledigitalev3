# Scripts de test pour diagnostiquer l'accès aux assignments

Ces scripts permettent de diagnostiquer le problème d'accès aux assignments pour les enseignants.

## 📋 Prérequis

1. Node.js installé (pour le script JavaScript)
2. Accès à la base de données PostgreSQL
3. JWT token (optionnel, pour les tests API)

## 🔧 Configuration

### Script JavaScript

Modifiez les valeurs dans `test-teacher-assignment-access.js` :

```javascript
const TEST_CONFIG = {
  userId: 'c0148e26-e39e-4289-9613-579534a68103',
  tenantId: '6eb9c106-b650-4398-b6fa-091b6828c4ba',
  tenantSlug: 'imhotepacademy',
  assignmentId: 'a27f2f14-a166-4108-82f1-cba24c14e290',
  jwtToken: process.env.JWT_TOKEN || '' // Optionnel
};
```

### Script SQL

Modifiez les variables au début du fichier `test-assignment-access.sql` :

```sql
\set user_id 'c0148e26-e39e-4289-9613-579534a68103'
\set tenant_id '6eb9c106-b650-4398-b6fa-091b6828c4ba'
\set assignment_id 'a27f2f14-a166-4108-82f1-cba24c14e290'
```

## 🚀 Utilisation

### Option 1: Script JavaScript (teste les endpoints API)

```bash
# Avec JWT token
JWT_TOKEN="votre_token_ici" node scripts/test-teacher-assignment-access.js

# Sans JWT token (certains tests peuvent échouer)
node scripts/test-teacher-assignment-access.js
```

**Ce script teste :**
- ✅ Résolution user_id → teacher_id
- ✅ Accès à l'assignment spécifique
- ✅ Présence de l'assignment dans la liste
- ✅ Accès aux étudiants
- ✅ Accès à l'historique de présence

### Option 2: Script SQL (teste directement la base de données)

```bash
# Avec psql
psql -d dbecoledigitale -f scripts/test-assignment-access.sql

# Ou depuis psql
\i scripts/test-assignment-access.sql
```

**Ce script teste :**
- ✅ Existence du teacher
- ✅ Existence de l'assignment
- ✅ Correspondance teacher_id entre assignment et teacher
- ✅ Correspondance tenant_id
- ✅ Liste des assignments du teacher
- ✅ Classe et étudiants associés

## 📊 Interprétation des résultats

### ✅ Cas normal (tout fonctionne)

```
TEST 3: Vérifier la relation teacher-assignment
teacher_match: ✅ MATCH
tenant_match: ✅ MATCH
access_status: ✅ ACCÈS AUTORISÉ
```

### ❌ Problème identifié

#### Problème 1: Teacher ID ne correspond pas
```
teacher_match: ❌ NO MATCH
tenant_match: ✅ MATCH
access_status: ❌ ACCÈS REFUSÉ
```

**Solution :** L'assignment appartient à un autre teacher. Vérifiez pourquoi il apparaît dans la liste.

#### Problème 2: Tenant ID ne correspond pas
```
teacher_match: ✅ MATCH
tenant_match: ❌ NO MATCH
access_status: ❌ ACCÈS REFUSÉ
```

**Solution :** Problème de résolution du tenant. Vérifiez la configuration du tenant.

#### Problème 3: Aucune correspondance
```
teacher_match: ❌ NO MATCH
tenant_match: ❌ NO MATCH
access_status: ❌ ACCÈS REFUSÉ
```

**Solution :** L'assignment n'appartient pas à ce teacher dans ce tenant.

## 🔍 Diagnostic approfondi

### Vérifier les logs du serveur API

Les logs devraient maintenant afficher :
```
[GET /:assignmentId/students] Assignment found: {
  assignmentId: '...',
  assignmentTeacherId: '...',
  assignmentTenantId: '...',
  requestTenantId: '...',
  userIdHeader: '...'
}
[GET /:assignmentId/students] Resolved user_id ... to teacher_id ...
[GET /:assignmentId/students] Access denied: {
  teacherMatch: true/false,
  tenantMatch: true/false,
  ...
}
```

### Vérifier la base de données

Exécutez ces requêtes pour voir les données réelles :

```sql
-- Voir tous les teachers avec ce user_id
SELECT id, user_id, tenant_id FROM teachers WHERE user_id = '...';

-- Voir l'assignment et son teacher
SELECT ta.id, ta.teacher_id, ta.tenant_id, t.id as actual_teacher_id
FROM teacher_assignments ta
LEFT JOIN teachers t ON t.id = ta.teacher_id
WHERE ta.id = '...';
```

## 🐛 Problèmes courants

### 1. Assignment apparaît dans la liste mais accès refusé

**Cause :** La requête de liste utilise un filtre différent de la vérification d'accès.

**Solution :** Vérifiez que les deux utilisent la même logique de résolution teacher_id.

### 2. Teacher ID résolu ne correspond pas

**Cause :** Plusieurs teachers avec le même user_id dans différents tenants.

**Solution :** Vérifiez que vous utilisez le bon tenant_id pour la résolution.

### 3. Tenant ID ne correspond pas

**Cause :** L'assignment a un tenant_id différent de celui de la requête.

**Solution :** Vérifiez la résolution du tenant (UUID vs slug).

## 📝 Notes

- Les scripts utilisent les valeurs par défaut du problème rapporté
- Adaptez les IDs selon votre environnement
- Les scripts sont en mode lecture seule (pas de modifications de données)
- Pour obtenir un JWT token, connectez-vous via l'interface web et récupérez-le depuis les cookies ou les DevTools

