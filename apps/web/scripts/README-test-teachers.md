# Scripts de test pour diagnostiquer le problème des enseignants dans /admin/messages

## Problème

Dans la page `/admin/messages`, on voit "1 enseignant(s) disponible(s)" alors qu'il y a 3 enseignants dans la base de données.

## Solution rapide : Test depuis le navigateur

### Méthode 1 : Script automatique (Recommandé)

1. Ouvrez la page `http://localhost:3000/admin/messages` dans votre navigateur
2. Ouvrez la console du navigateur (F12)
3. Copiez-collez le contenu du fichier `test-teachers-browser.js` dans la console
4. Appuyez sur Entrée

Le script va :
- ✅ Récupérer tous les enseignants depuis l'API
- ✅ Analyser combien ont un `userId` (requis pour les messages)
- ✅ Expliquer pourquoi certains enseignants ne s'affichent pas
- ✅ Donner des recommandations pour résoudre le problème

### Méthode 2 : Test manuel dans la console

Copiez ce code dans la console du navigateur :

```javascript
(async function() {
  const response = await fetch('/api/v1/teachers?limit=100&page=1');
  const data = await response.json();
  const all = data.data || [];
  const withUserId = all.filter(t => t.userId);
  const withoutUserId = all.filter(t => !t.userId);
  
  console.log('Total:', all.length);
  console.log('Avec userId:', withUserId.length);
  console.log('Sans userId:', withoutUserId.length);
  
  console.log('\nAvec userId:');
  withUserId.forEach(t => console.log(`  - ${t.firstName} ${t.lastName} (userId: ${t.userId})`));
  
  if (withoutUserId.length > 0) {
    console.log('\nSans userId (non affichés):');
    withoutUserId.forEach(t => console.log(`  - ${t.firstName} ${t.lastName} (id: ${t.id}, userId: ${t.userId || 'NULL'})`));
  }
})();
```

## Test depuis le terminal (Node.js)

### Prérequis

1. Avoir Node.js installé
2. Avoir un token JWT valide (optionnel, mais recommandé)

### Obtenir un token JWT

1. Connectez-vous sur `http://localhost:3000/login`
2. Ouvrez la console du navigateur (F12)
3. Allez dans l'onglet "Application" > "Local Storage"
4. Cherchez la clé contenant le token JWT
5. Ou utilisez ce code dans la console :
   ```javascript
   document.cookie.split(';').find(c => c.includes('token'))
   ```

### Exécuter le script

```bash
# Depuis le dossier apps/web
cd apps/web

# Avec un token JWT (recommandé)
JWT_TOKEN="votre-token-jwt" node scripts/test-teachers-messages.js

# Sans token (peut échouer si l'API nécessite une authentification)
node scripts/test-teachers-messages.js
```

## Comprendre les résultats

### Cas 1 : Tous les enseignants ont un userId
```
✅ Tous les enseignants ont un userId et peuvent recevoir des messages!
```
→ Tous les enseignants devraient s'afficher dans l'interface.

### Cas 2 : Certains enseignants n'ont pas de userId
```
⚠️  PROBLÈME DÉTECTÉ:
   2 enseignant(s) sur 3 n'ont pas de userId.
   → Ces enseignants ne peuvent pas recevoir de messages.
   → Ils n'apparaissent pas dans la liste de sélection.
```
→ C'est probablement votre cas. Les enseignants sans `userId` ne peuvent pas recevoir de messages.

### Cas 3 : Aucun enseignant n'a de userId
```
❌ PROBLÈME CRITIQUE:
   Aucun enseignant n'a de userId!
   → Aucun enseignant ne peut recevoir de messages.
```
→ Il faut créer des comptes utilisateurs pour les enseignants.

## Solution : Corriger les enseignants sans userId

### Option 1 : Vérifier dans la base de données

```sql
-- Voir tous les enseignants et leur user_id
SELECT 
  t.id,
  t.first_name,
  t.last_name,
  t.email,
  t.user_id,
  u.email as user_email
FROM teachers t
LEFT JOIN users u ON t.user_id = u.id
WHERE t.tenant_id = 'votre-tenant-id'
ORDER BY t.first_name;
```

### Option 2 : Créer des comptes utilisateurs pour les enseignants

Si un enseignant n'a pas de `user_id`, il faut :
1. Créer un compte utilisateur dans la table `users`
2. Lier l'enseignant à cet utilisateur en mettant à jour `teachers.user_id`

### Option 3 : Mettre à jour manuellement

```sql
-- Exemple : Lier un enseignant à un utilisateur existant
UPDATE teachers 
SET user_id = 'uuid-de-l-utilisateur'
WHERE id = 'uuid-de-l-enseignant';
```

## Fichiers

- `test-teachers-browser.js` : Script à utiliser dans la console du navigateur (recommandé)
- `test-teachers-messages.js` : Script Node.js pour tester depuis le terminal
- `README-test-teachers.md` : Ce fichier

## Notes

- Le `userId` est requis car l'API de messages utilise `users.id` pour identifier les destinataires
- Les enseignants sans `userId` ne peuvent pas recevoir de messages
- C'est une limitation de conception : seuls les enseignants avec un compte utilisateur peuvent recevoir des messages

