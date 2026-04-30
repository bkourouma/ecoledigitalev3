# Prompt pour Cursor AI : Créer un monorepo avec SpectKit

Crée un projet monorepo TypeScript moderne avec SpectKit (Specification Kit) intégré et configuré pour Cursor AI. Le projet doit être immédiatement utilisable avec toutes les configurations nécessaires.

## Structure requise

```
monorepo-root/
├── .cursor/
│   ├── commands/          # Commandes SpectKit pour Cursor
│   └── rules/            # Règles de développement
├── .specify/
│   ├── memory/           # Constitution et mémoire
│   ├── scripts/powershell/  # Scripts d'automatisation
│   └── templates/        # Templates de documents
├── apps/
│   ├── api/             # Backend API
│   └── web/             # Frontend
├── packages/
│   ├── contracts/       # Contrats TypeScript
│   ├── ui/              # Composants UI
│   └── utils/           # Utilitaires
├── specs/               # Spécifications de fonctionnalités
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

## Configuration monorepo

1. **pnpm workspaces** : `apps/*` et `packages/*`
2. **TypeScript 5.x** : Configuration stricte avec références de projet
3. **Apps** : API (Fastify) et Web (Next.js 15)
4. **Packages** : contracts, ui, utils avec noms scoped `@monorepo/*`

## Commandes SpectKit à créer (.cursor/commands/)

Crée ces 8 commandes avec leur logique complète :

1. **speckit.specify.md** - Crée une nouvelle spécification
   - Exécute `.specify/scripts/powershell/create-new-feature.ps1`
   - Crée `specs/###-feature-name/spec.md` depuis template
   - Crée branche Git automatiquement

2. **speckit.plan.md** - Génère le plan d'implémentation
   - Exécute `setup-plan.ps1` pour initialiser
   - Lit `spec.md` et `constitution.md`
   - Génère `plan.md`, `research.md`, `data-model.md`, `contracts/`
   - Vérifie conformité constitution

3. **speckit.tasks.md** - Génère les tâches
   - Lit `spec.md` et `plan.md`
   - Organise par user stories (P1, P2, P3...)
   - Génère `tasks.md` avec dépendances et parallélisation

4. **speckit.analyze.md** - Analyse la cohérence
   - Compare `spec.md`, `plan.md`, `tasks.md`
   - Détecte duplications, ambiguïtés, incohérences
   - Génère rapport d'analyse

5. **speckit.implement.md** - Implémente les tâches
   - Lit `tasks.md`
   - Implémente séquentiellement ou en parallèle
   - Met à jour la progression

6. **speckit.checklist.md** - Génère checklists
7. **speckit.clarify.md** - Clarifie les ambiguïtés
8. **speckit.constitution.md** - Gère la constitution

## Scripts PowerShell (.specify/scripts/powershell/)

Crée ces scripts avec support JSON pour Cursor AI :

1. **common.ps1** - Fonctions partagées :
   - `Get-FeaturePathsEnv` : Retourne chemins absolus (FEATURE_DIR, SPEC_FILE, etc.)
   - `Test-FeatureBranch` : Vérifie format branche `###-feature-name`
   - `Find-RepositoryRoot` : Trouve racine repo

2. **create-new-feature.ps1** :
   - Prend description fonctionnalité en paramètre
   - Génère numéro suivant (001, 002, 003...)
   - Crée branche Git `###-feature-name`
   - Crée dossier `specs/###-feature-name/`
   - Copie template `spec.md`
   - Support `-Json` pour output JSON

3. **setup-plan.ps1** :
   - Détecte branche courante
   - Vérifie existence `spec.md`
   - Copie template `plan.md`
   - Retourne chemins en JSON

4. **check-prerequisites.ps1** :
   - Vérifie fichiers requis (spec.md, plan.md, tasks.md)
   - Retourne liste fichiers disponibles
   - Support `-RequireTasks`, `-IncludeTasks`

5. **update-agent-context.ps1** :
   - Met à jour `.cursor/rules/specify-rules.mdc`
   - Ajoute technologies du plan actuel
   - Préserve ajouts manuels entre marqueurs

## Templates (.specify/templates/)

Crée templates complets avec instructions :

1. **spec-template.md** :
   - Structure avec User Stories prioritaires (P1, P2, P3)
   - Sections : Scenarios, Requirements, Success Criteria
   - Format Given/When/Then pour tests

2. **plan-template.md** :
   - Technical Context (stack, dépendances, contraintes)
   - Constitution Check (gates de validation)
   - Project Structure
   - Phases (0: Research, 1: Design, 2: Implementation)

3. **tasks-template.md** :
   - Organisation par User Stories
   - Phases : Setup → Foundational → User Stories → Polish
   - Marqueurs [P] pour parallélisation
   - Dépendances entre tâches

4. **checklist-template.md** - Template checklists
5. **agent-file-template.md** - Template contexte agent

## Constitution (.specify/memory/constitution.md)

Crée constitution avec :
- Principes fondamentaux (ex: TDD, Library-First, etc.)
- Stack technique (TypeScript, pnpm, PostgreSQL, etc.)
- Standards de code et architecture
- Workflow Git et branches
- Tests et qualité
- Version et gouvernance

## Règles Cursor (.cursor/rules/specify-rules.mdc)

Crée fichier avec :
- Technologies actives du projet
- Structure du projet
- Commandes SpectKit disponibles
- Guidelines de développement
- Section pour ajouts manuels

## Configuration TypeScript

- **Racine** : `tsconfig.json` avec références
- **Apps/Packages** : `tsconfig.json` avec extends et paths
- Configuration stricte activée
- Paths pour imports `@monorepo/*`

## Package.json racine

```json
{
  "name": "monorepo",
  "private": true,
  "packageManager": "pnpm@10.14.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "concurrently \"pnpm --filter @monorepo/api dev\" \"pnpm --filter @monorepo/web dev\"",
    "dev:api": "pnpm --filter @monorepo/api dev",
    "dev:web": "pnpm --filter @monorepo/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "type-check": "pnpm -r type-check"
  }
}
```

## Apps et Packages de base

Crée structure minimale pour :

**apps/api** :
- Fastify avec TypeScript
- Structure `src/` avec `index.ts`
- Scripts dev, build, start

**apps/web** :
- Next.js 15 avec TypeScript
- Structure `src/app/`
- Scripts dev, build, start

**packages/contracts** :
- Types et schémas Zod
- Exports TypeScript

**packages/ui** :
- Composants React réutilisables
- Exports nommés

**packages/utils** :
- Fonctions utilitaires
- Helpers partagés

## README.md

Documente :
- Installation (`pnpm install`)
- Développement (`pnpm dev`)
- Workflow SpectKit complet
- Commandes Cursor disponibles
- Structure du projet

## Validation

Le projet doit permettre immédiatement :
1. ✅ `pnpm install` fonctionne
2. ✅ `pnpm dev` lance api et web
3. ✅ `/speckit.specify "ma fonctionnalité"` crée une spec
4. ✅ `/speckit.plan` génère un plan
5. ✅ `/speckit.tasks` génère des tâches
6. ✅ Tous les scripts PowerShell retournent JSON valide
7. ✅ Tous les templates sont complets et utilisables

## Instructions d'exécution

1. Crée TOUS les fichiers listés ci-dessus
2. Remplis chaque fichier avec du contenu COMPLET et FONCTIONNEL
3. Ne laisse PAS de placeholders vides dans les fichiers critiques
4. Teste que les scripts PowerShell sont syntaxiquement corrects
5. Assure-toi que les commandes Cursor suivent le format attendu
6. Vérifie que tous les package.json sont valides
7. Crée un README complet et utile

**IMPORTANT** : Le projet doit être immédiatement utilisable après création. Tous les fichiers doivent être complets et fonctionnels, pas des squelettes.

