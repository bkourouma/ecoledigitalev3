# Plan de Tests End-to-End - Système de Devoirs PDF

## Comptes de Test

### Enseignant
- **Email**: kouadio.assi@ecoledigitale.ci
- **Mot de passe**: teacher123
- **Rôle**: Enseignant

### Étudiant
- **Email**: kacoucelestin@gmail.com
- **Mot de passe**: sUQgv9@MGT58
- **Rôle**: Étudiant

## Scénarios de Test

### 1. Workflow Complet - Création à Notation

#### 1.1 Création d'un Devoir (Enseignant)
- [ ] Connexion avec le compte enseignant
- [ ] Navigation vers `/teacher/assignments/create`
- [ ] Création d'un nouveau devoir PDF avec:
  - Titre: "Test E2E - Devoir Mathématiques"
  - Description: "Devoir de test pour validation E2E"
  - Type: "homework" (PDF)
  - Date limite: J+7
  - Taille max: 10MB
- [ ] Sauvegarde du devoir
- [ ] Vérification de la création dans `/teacher/assignments/list`

#### 1.2 Assignation du Devoir (Enseignant)
- [ ] Navigation vers `/academic/assignments/assign`
- [ ] Sélection du devoir créé
- [ ] Assignation à une classe
- [ ] Confirmation de l'assignation

#### 1.3 Consultation du Devoir (Étudiant)
- [ ] Déconnexion du compte enseignant
- [ ] Connexion avec le compte étudiant
- [ ] Navigation vers `/student/assignments`
- [ ] Vérification de la présence du devoir assigné
- [ ] Consultation des détails du devoir
- [ ] Téléchargement du PDF du devoir (si applicable)

#### 1.4 Soumission du Devoir (Étudiant)
- [ ] Préparation d'un fichier PDF de test (< 10MB)
- [ ] Upload du fichier PDF
- [ ] Vérification du statut "En cours"
- [ ] Finalisation de la soumission
- [ ] Vérification du statut "Soumis"
- [ ] Vérification de l'impossibilité de re-soumettre

#### 1.5 Correction du Devoir (Enseignant)
- [ ] Connexion avec le compte enseignant
- [ ] Navigation vers `/teacher/corrections`
- [ ] Localisation de la soumission de l'étudiant
- [ ] Ouverture du PDF soumis
- [ ] Attribution d'une note (ex: 15/20)
- [ ] Ajout de commentaires de feedback
- [ ] Sauvegarde de la correction

#### 1.6 Consultation de la Note (Étudiant)
- [ ] Connexion avec le compte étudiant
- [ ] Navigation vers `/student/grades`
- [ ] Vérification de la présence de la nouvelle note
- [ ] Consultation des commentaires du professeur
- [ ] Vérification des statistiques mises à jour

### 2. Tests de Validation

#### 2.1 Validation des Fichiers
- [ ] Tentative d'upload d'un fichier non-PDF (doit échouer)
- [ ] Tentative d'upload d'un fichier > 10MB (doit échouer)
- [ ] Tentative d'upload d'un fichier corrompu (doit échouer)
- [ ] Upload d'un PDF valide (doit réussir)

#### 2.2 Validation des Permissions
- [ ] Tentative d'accès étudiant aux pages enseignant (doit rediriger)
- [ ] Tentative d'accès enseignant aux pages étudiant (doit rediriger)
- [ ] Tentative d'accès aux fichiers d'autres étudiants (doit échouer)

#### 2.3 Validation des Délais
- [ ] Soumission avant la date limite (doit réussir)
- [ ] Soumission après la date limite (doit marquer "En retard")

### 3. Tests d'Interface Utilisateur

#### 3.1 Responsive Design
- [ ] Test sur mobile (375px)
- [ ] Test sur tablette (768px)
- [ ] Test sur desktop (1024px+)

#### 3.2 États de Chargement
- [ ] Vérification des spinners pendant les uploads
- [ ] Vérification des états de chargement des listes
- [ ] Vérification des messages d'erreur

#### 3.3 Navigation
- [ ] Vérification de la navigation dans le menu latéral
- [ ] Vérification des liens actifs
- [ ] Vérification des breadcrumbs

### 4. Tests de Performance

#### 4.1 Temps de Chargement
- [ ] Page d'accueil < 2s
- [ ] Liste des devoirs < 3s
- [ ] Upload de fichier < 10s (pour 5MB)
- [ ] Ouverture PDF < 3s

#### 4.2 Gestion des Erreurs
- [ ] Perte de connexion réseau
- [ ] Erreur serveur (500)
- [ ] Timeout de requête

## Critères de Succès

### Fonctionnalité
- ✅ Workflow complet fonctionnel de bout en bout
- ✅ Toutes les validations de sécurité opérationnelles
- ✅ Gestion correcte des permissions et rôles
- ✅ Interface utilisateur intuitive et responsive

### Performance
- ✅ Temps de chargement acceptables (< 3s)
- ✅ Upload de fichiers fluide
- ✅ Pas d'erreurs console critiques

### Sécurité
- ✅ Validation des fichiers PDF
- ✅ Contrôle d'accès aux ressources
- ✅ Sanitisation des noms de fichiers
- ✅ Protection contre les attaques par upload

## Outils de Test

### Recommandés
- **Playwright**: Tests E2E automatisés
- **Cypress**: Alternative pour tests E2E
- **Jest**: Tests unitaires
- **Testing Library**: Tests de composants React

### Configuration
```bash
# Installation Playwright
npm install -D @playwright/test
npx playwright install

# Lancement des tests
npx playwright test
```

## Fichiers de Test

### Structure Recommandée
```
tests/
├── e2e/
│   ├── auth.spec.ts
│   ├── assignments.spec.ts
│   ├── submissions.spec.ts
│   ├── corrections.spec.ts
│   └── grades.spec.ts
├── fixtures/
│   ├── test-assignment.pdf
│   ├── large-file.pdf
│   └── invalid-file.txt
└── utils/
    ├── auth-helpers.ts
    ├── file-helpers.ts
    └── page-helpers.ts
```

## Rapport de Test

À la fin des tests, générer un rapport incluant:
- ✅ Nombre de tests passés/échoués
- ✅ Temps d'exécution total
- ✅ Captures d'écran des échecs
- ✅ Logs des erreurs
- ✅ Métriques de performance
