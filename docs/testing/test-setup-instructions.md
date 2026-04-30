# Instructions de Configuration des Tests E2E

## Installation des Dépendances

```bash
# Installer Playwright
pnpm install

# Installer les navigateurs Playwright
pnpm run test:install
```

## Configuration Requise

### 1. Base de Données
Assurez-vous que la base de données PostgreSQL est configurée et que les migrations sont appliquées :

```bash
pnpm run migrate
pnpm run seed
```

### 2. Comptes de Test
Les comptes suivants doivent exister dans la base de données :

**Enseignant :**
- Email: kouadio.assi@ecoledigitale.ci
- Mot de passe: teacher123

**Étudiant :**
- Email: kacoucelestin@gmail.com
- Mot de passe: sUQgv9@MGT58

### 3. Services en Cours d'Exécution
Avant de lancer les tests, démarrez les services :

```bash
# Terminal 1 - API Backend
pnpm run dev:api

# Terminal 2 - Frontend Web
pnpm run dev:web

# Ou les deux ensemble
pnpm run dev
```

## Lancement des Tests

### Tests Complets
```bash
# Lancer tous les tests E2E
pnpm run test:e2e

# Lancer avec interface graphique
pnpm run test:e2e:ui

# Lancer en mode visible (headed)
pnpm run test:e2e:headed

# Lancer en mode debug
pnpm run test:e2e:debug
```

### Tests Spécifiques
```bash
# Tests d'authentification uniquement
npx playwright test auth.spec.ts

# Tests de workflow complet
npx playwright test assignment-workflow.spec.ts

# Tests de validation de fichiers
npx playwright test file-validation.spec.ts
```

## Structure des Tests

```
tests/
├── e2e/
│   ├── auth.spec.ts                 # Tests d'authentification
│   ├── assignment-workflow.spec.ts  # Workflow complet
│   └── file-validation.spec.ts      # Validation des fichiers
├── fixtures/
│   ├── valid-test.pdf              # PDF valide pour tests
│   ├── invalid-file.txt            # Fichier non-PDF
│   ├── large-file.pdf              # Fichier trop volumineux
│   └── corrupt-file.pdf            # PDF corrompu
└── utils/
    └── auth-helpers.ts             # Utilitaires d'authentification
```

## Fichiers de Test Requis

Les tests créent automatiquement les fichiers de test nécessaires, mais vous pouvez les préparer manuellement :

### 1. PDF Valide (tests/fixtures/valid-test.pdf)
Un petit fichier PDF valide (< 1MB) pour tester les uploads réussis.

### 2. Fichier Texte (tests/fixtures/invalid-file.txt)
Un fichier texte simple pour tester le rejet des non-PDF.

### 3. Fichier Volumineux (tests/fixtures/large-file.pdf)
Un fichier PDF > 10MB pour tester la limite de taille.

### 4. PDF Corrompu (tests/fixtures/corrupt-file.pdf)
Un fichier avec extension .pdf mais contenu invalide.

## Résultats des Tests

### Rapports
Les résultats sont générés dans :
- `test-results/` - Captures d'écran et vidéos des échecs
- `playwright-report/` - Rapport HTML détaillé

### Visualisation
```bash
# Ouvrir le rapport HTML
npx playwright show-report
```

## Dépannage

### Problèmes Courants

1. **Services non démarrés**
   ```
   Error: connect ECONNREFUSED 127.0.0.1:3000
   ```
   Solution : Vérifiez que `pnpm run dev` est en cours d'exécution.

2. **Comptes de test manquants**
   ```
   Error: Invalid credentials
   ```
   Solution : Vérifiez que les comptes de test existent dans la base de données.

3. **Base de données non configurée**
   ```
   Error: relation "users" does not exist
   ```
   Solution : Exécutez `pnpm run migrate` et `pnpm run seed`.

4. **Timeouts**
   ```
   Error: Timeout 30000ms exceeded
   ```
   Solution : Augmentez les timeouts dans `playwright.config.ts` ou vérifiez les performances.

### Logs de Debug
```bash
# Activer les logs détaillés
DEBUG=pw:api pnpm run test:e2e

# Lancer un test spécifique en mode debug
npx playwright test auth.spec.ts --debug
```

## Intégration Continue

### GitHub Actions (exemple)
```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: pnpm install
      - name: Install Playwright
        run: pnpm run test:install
      - name: Setup database
        run: |
          pnpm run migrate
          pnpm run seed
      - name: Run E2E tests
        run: pnpm run test:e2e
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Maintenance des Tests

### Mise à Jour des Tests
- Mettre à jour les sélecteurs si l'interface change
- Ajouter de nouveaux tests pour les nouvelles fonctionnalités
- Maintenir les fichiers de fixtures à jour

### Performance
- Utiliser `page.waitForLoadState('networkidle')` pour les pages lentes
- Éviter les `page.waitForTimeout()` fixes, préférer les attentes conditionnelles
- Paralléliser les tests indépendants

### Bonnes Pratiques
- Nettoyer les données de test après chaque test
- Utiliser des données de test uniques (timestamps)
- Isoler les tests les uns des autres
- Documenter les cas de test complexes
