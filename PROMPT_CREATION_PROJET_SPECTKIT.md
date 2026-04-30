# Prompt pour créer un projet monorepo avec SpectKit et Cursor AI

## Instructions complètes pour Cursor AI

Crée un projet monorepo TypeScript moderne avec SpectKit (Specification Kit) intégré et configuré pour travailler avec Cursor AI. Le projet doit être prêt pour le développement immédiat avec toutes les configurations nécessaires.

### Structure du projet

Le projet doit suivre cette structure :

```
monorepo-root/
├── .cursor/
│   ├── commands/
│   │   ├── speckit.specify.md
│   │   ├── speckit.plan.md
│   │   ├── speckit.tasks.md
│   │   ├── speckit.analyze.md
│   │   ├── speckit.implement.md
│   │   ├── speckit.checklist.md
│   │   ├── speckit.clarify.md
│   │   └── speckit.constitution.md
│   └── rules/
│       └── specify-rules.mdc
├── .specify/
│   ├── memory/
│   │   └── constitution.md
│   ├── scripts/
│   │   └── powershell/
│   │       ├── common.ps1
│   │       ├── create-new-feature.ps1
│   │       ├── setup-plan.ps1
│   │       ├── check-prerequisites.ps1
│   │       └── update-agent-context.ps1
│   └── templates/
│       ├── spec-template.md
│       ├── plan-template.md
│       ├── tasks-template.md
│       ├── checklist-template.md
│       └── agent-file-template.md
├── apps/
│   ├── api/
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── ui/
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── utils/
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── specs/
│   └── (vide au départ, sera rempli par les fonctionnalités)
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

### Configuration du monorepo

1. **Gestionnaire de paquets** : Utilise `pnpm` avec workspaces
2. **TypeScript** : Version 5.x avec configuration stricte
3. **Structure** : Monorepo avec apps (api, web) et packages partagés (contracts, ui, utils)

### Fichiers à créer

#### 1. Configuration racine

**package.json** (racine) :
- Workspaces configurés pour `apps/*` et `packages/*`
- Scripts pour dev, build, test
- pnpm comme packageManager

**pnpm-workspace.yaml** :
- Configuration des workspaces

**tsconfig.json** (racine) :
- Configuration TypeScript de base avec références aux projets

**.gitignore** :
- node_modules, dist, .env, etc.

#### 2. Configuration SpectKit - Commandes Cursor

Crée toutes les commandes SpectKit dans `.cursor/commands/` :

- **speckit.specify.md** : Commande pour créer une nouvelle spécification de fonctionnalité
- **speckit.plan.md** : Commande pour générer un plan d'implémentation
- **speckit.tasks.md** : Commande pour générer les tâches à partir du plan
- **speckit.analyze.md** : Commande pour analyser la cohérence des artefacts
- **speckit.implement.md** : Commande pour implémenter les tâches
- **speckit.checklist.md** : Commande pour générer des checklists
- **speckit.clarify.md** : Commande pour clarifier les ambiguïtés
- **speckit.constitution.md** : Commande pour gérer la constitution

Chaque commande doit suivre le format :
```markdown
---
description: [Description de la commande]
---

## User Input

```text
$ARGUMENTS
```

[Instructions détaillées pour l'exécution]
```

#### 3. Scripts PowerShell SpectKit

Crée tous les scripts dans `.specify/scripts/powershell/` :

- **common.ps1** : Fonctions utilitaires partagées (Get-FeaturePathsEnv, Test-FeatureBranch, etc.)
- **create-new-feature.ps1** : Crée une nouvelle fonctionnalité avec numérotation automatique
- **setup-plan.ps1** : Configure le plan d'implémentation
- **check-prerequisites.ps1** : Vérifie les prérequis avant exécution
- **update-agent-context.ps1** : Met à jour le contexte de l'agent AI

#### 4. Templates SpectKit

Crée tous les templates dans `.specify/templates/` :

- **spec-template.md** : Template pour les spécifications de fonctionnalités
- **plan-template.md** : Template pour les plans d'implémentation
- **tasks-template.md** : Template pour les listes de tâches
- **checklist-template.md** : Template pour les checklists
- **agent-file-template.md** : Template pour les fichiers de contexte agent

#### 5. Constitution du projet

Crée `.specify/memory/constitution.md` avec :
- Principes fondamentaux du projet
- Contraintes techniques
- Standards de qualité
- Workflow de développement

#### 6. Règles Cursor

Crée `.cursor/rules/specify-rules.mdc` avec :
- Guidelines de développement
- Technologies actives
- Structure du projet
- Commandes disponibles

#### 7. Applications et packages

Crée la structure de base pour :
- **apps/api** : Backend API (Fastify ou Express)
- **apps/web** : Frontend (Next.js ou React)
- **packages/contracts** : Contrats TypeScript partagés
- **packages/ui** : Composants UI partagés
- **packages/utils** : Utilitaires partagés

Chaque package doit avoir :
- `package.json` avec nom scoped (`@monorepo/package-name`)
- `tsconfig.json` configuré
- Structure `src/` de base

### Fonctionnalités SpectKit à implémenter

1. **Workflow de spécification** :
   - Création de fonctionnalité avec `/speckit.specify`
   - Génération automatique de numéro de fonctionnalité (001-, 002-, etc.)
   - Création de branche Git automatique
   - Template de spec.md pré-rempli

2. **Workflow de planification** :
   - Génération de plan avec `/speckit.plan`
   - Recherche et résolution des ambiguïtés
   - Génération de data-model.md
   - Génération de contrats API
   - Vérification de conformité avec la constitution

3. **Workflow de tâches** :
   - Génération de tasks.md avec `/speckit.tasks`
   - Organisation par user stories avec priorités
   - Détection de tâches parallélisables
   - Dépendances entre tâches

4. **Workflow d'analyse** :
   - Analyse de cohérence avec `/speckit.analyze`
   - Détection de duplications, ambiguïtés, incohérences
   - Vérification de couverture des requirements

5. **Workflow d'implémentation** :
   - Implémentation guidée avec `/speckit.implement`
   - Suivi de progression
   - Génération de checklists

### Détails techniques importants

1. **Scripts PowerShell** :
   - Support JSON pour intégration avec Cursor AI
   - Gestion des chemins absolus
   - Détection automatique de la racine du repo
   - Support Git (avec fallback si non disponible)

2. **Numérotation des fonctionnalités** :
   - Format : `###-feature-name` (ex: `001-user-auth`)
   - Détection automatique du prochain numéro disponible
   - Génération intelligente du nom de branche

3. **Constitution** :
   - Fichier de référence pour toutes les décisions
   - Vérification obligatoire avant implémentation
   - Peut être mise à jour mais nécessite justification

4. **Templates** :
   - Placeholders clairs à remplir
   - Instructions intégrées
   - Structure cohérente entre tous les templates

### Exemple de constitution de base

La constitution doit inclure :
- Principes de développement (TDD, architecture, etc.)
- Stack technique (TypeScript, pnpm, etc.)
- Standards de code
- Workflow Git (branches, commits, etc.)
- Tests et qualité

### Commandes à implémenter dans package.json

```json
{
  "scripts": {
    "dev": "concurrently \"pnpm --filter @monorepo/api dev\" \"pnpm --filter @monorepo/web dev\"",
    "dev:api": "pnpm --filter @monorepo/api dev",
    "dev:web": "pnpm --filter @monorepo/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "type-check": "pnpm -r type-check"
  }
}
```

### README.md

Crée un README complet avec :
- Description du projet
- Structure du monorepo
- Installation et setup
- Commandes disponibles
- Workflow SpectKit expliqué
- Guide d'utilisation des commandes Cursor

### Points d'attention

1. **Compatibilité Windows** : Tous les scripts PowerShell doivent fonctionner sur Windows
2. **Chemins** : Utiliser des chemins absolus dans les scripts
3. **JSON** : Support JSON pour toutes les commandes PowerShell pour intégration AI
4. **Git** : Gestion gracieuse si Git n'est pas disponible
5. **Templates** : Tous les templates doivent être complets et utilisables immédiatement

### Validation finale

Le projet créé doit permettre :
1. ✅ Créer une nouvelle fonctionnalité avec `/speckit.specify`
2. ✅ Générer un plan avec `/speckit.plan`
3. ✅ Générer des tâches avec `/speckit.tasks`
4. ✅ Analyser la cohérence avec `/speckit.analyze`
5. ✅ Implémenter avec `/speckit.implement`
6. ✅ Lancer le développement avec `pnpm dev`
7. ✅ Builder tous les packages avec `pnpm build`

### Instructions finales

Crée TOUS les fichiers nécessaires avec du contenu complet et fonctionnel. Ne laisse pas de placeholders non remplis dans les fichiers critiques. Le projet doit être immédiatement utilisable après création.

Assure-toi que :
- Tous les scripts PowerShell sont testables
- Toutes les commandes Cursor sont documentées
- Tous les templates sont complets
- La constitution est définie avec des principes clairs
- La structure du monorepo est cohérente
- Les configurations TypeScript sont correctes
- Les package.json sont valides

Commence par créer la structure de base, puis remplis chaque fichier avec du contenu complet et fonctionnel.

