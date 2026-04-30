# Scripts de test pour diagnostiquer les doublons de grades

Ce dossier contient des scripts pour diagnostiquer le problème des doublons de grades dans l'application.

## Scripts disponibles

### 1. Test côté serveur (API)

**Fichier:** `scripts/test-grades-duplicates.ts`

**Description:** Teste l'API pour voir si elle retourne des doublons et vérifie la déduplication côté serveur.

**Usage:**
```bash
# Définir les variables d'environnement dans .env.local
TEST_USER_ID=your-user-id
TEST_TENANT_ID=your-tenant-id

# Exécuter le test
pnpm test:grades-duplicates
```

**Ce que le script teste:**
- ✅ Si la requête SQL retourne des doublons
- ✅ Si la déduplication côté serveur fonctionne correctement
- ✅ Si des doublons persistent après déduplication
- ✅ Si les clés React sont uniques

**Résultats attendus:**
- Aucun doublon dans les résultats SQL (grâce à `DISTINCT ON`)
- Aucun doublon après déduplication côté serveur
- Toutes les clés React sont uniques

### 2. Test côté client (Navigateur)

**Fichier:** `scripts/test-grades-duplicates-browser.js`

**Description:** Script à exécuter dans la console du navigateur pour tester les doublons côté client.

**Usage:**
1. Ouvrez la page `/parent/homework` dans votre navigateur
2. Ouvrez la console (F12)
3. Copiez-collez le contenu du fichier `scripts/test-grades-duplicates-browser.js` dans la console
4. Appuyez sur Entrée

**Ce que le script teste:**
- ✅ Si les données reçues contiennent des doublons
- ✅ Si la déduplication côté client fonctionne correctement
- ✅ Si les clés React sont uniques
- ✅ Inspection des données React Query

**Fonctions exposées:**
Après l'exécution du script, les fonctions suivantes sont disponibles dans la console:

```javascript
// Tester la déduplication avec les vraies données
window.testGradesDuplicates.testDeduplication(grades);

// Tester les clés React avec les vraies données
window.testGradesDuplicates.testReactKeys(grades);

// Trouver des doublons dans un tableau
window.testGradesDuplicates.findDuplicates(arr, keyFn);
```

**Pour utiliser avec les vraies données:**
1. Ouvrez React DevTools
2. Inspectez le composant `GradesReceived`
3. Vérifiez la prop `grades`
4. Dans la console, exécutez:
   ```javascript
   // Récupérer les grades depuis React DevTools
   const grades = /* copiez les grades depuis React DevTools */;
   
   // Tester la déduplication
   window.testGradesDuplicates.testDeduplication(grades);
   
   // Tester les clés React
   window.testGradesDuplicates.testReactKeys(grades);
   ```

## Diagnostic

### Si les logs `[GradesReceived]` n'apparaissent pas dans la console:

**Problème:** Le composant `GradesReceived` n'est pas rendu ou les données `grades` sont `null`/vides.

**Solutions:**
1. Vérifiez que vous êtes sur la page `/parent/homework`
2. Vérifiez que vous êtes connecté en tant que parent
3. Vérifiez que des grades existent dans la base de données
4. Vérifiez les logs du serveur pour voir si l'API retourne des données

### Si les logs `[GradesReceived]` apparaissent mais montrent des doublons:

**Problème:** Les données arrivent dupliquées depuis l'API.

**Solutions:**
1. Vérifiez les logs du serveur pour voir si des doublons sont retournés
2. Exécutez le script de test côté serveur: `pnpm test:grades-duplicates`
3. Vérifiez la requête SQL dans `apps/api/src/routes/parent-homework.ts`

### Si les logs `[GradesReceived]` apparaissent et ne montrent pas de doublons, mais l'erreur persiste:

**Problème:** Un autre composant affiche aussi les grades avec `grade.id` comme clé.

**Solutions:**
1. Recherchez tous les endroits où les grades sont affichés
2. Vérifiez que tous utilisent une clé unique (pas seulement `grade.id`)
3. Utilisez le script de test côté client pour identifier le composant problématique

## Résolution des problèmes

### Problème 1: Doublons dans la requête SQL

**Solution:** Vérifiez que `DISTINCT ON (sub.id)` est bien utilisé dans la requête SQL.

### Problème 2: Doublons après déduplication côté serveur

**Solution:** Vérifiez que la déduplication avec `Map` et `Set` fonctionne correctement.

### Problème 3: Doublons côté client

**Solution:** Vérifiez que la déduplication dans `useMemo` fonctionne correctement.

### Problème 4: Clés React dupliquées

**Solution:** Utilisez une clé basée uniquement sur l'index: `key={`grade-card-${index}`}`

## Logs à surveiller

### Côté serveur:
- `Duplicate submission_id found` - Indique qu'un doublon a été détecté et supprimé
- `Skipping duplicate submission` - Confirme qu'un doublon a été ignoré

### Côté client:
- `[GradesReceived] Processing X grades:` - Nombre de grades reçus
- `[GradesReceived] Duplicate grade ID found:` - Doublon détecté
- `[GradesReceived] Deduplicated grades: X -> Y` - Nombre de doublons supprimés
- `[GradesReceived] Final unique grades:` - Grades finaux après déduplication

## Support

Si le problème persiste après avoir exécuté ces tests, vérifiez:
1. Les logs du serveur pour voir si des doublons sont retournés
2. Les logs de la console du navigateur pour voir si des doublons sont détectés
3. Les données dans React DevTools pour voir si des doublons sont présents

