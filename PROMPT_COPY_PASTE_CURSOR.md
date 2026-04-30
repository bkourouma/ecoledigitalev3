# Prompt à copier-coller dans Cursor AI

```
Crée un projet monorepo TypeScript avec SpectKit intégré pour Cursor AI. Structure complète avec toutes les configurations.

STRUCTURE REQUISE:
- .cursor/commands/ : 8 commandes SpectKit (speckit.specify, speckit.plan, speckit.tasks, speckit.analyze, speckit.implement, speckit.checklist, speckit.clarify, speckit.constitution)
- .cursor/rules/specify-rules.mdc : Règles de développement
- .specify/memory/constitution.md : Constitution du projet avec principes
- .specify/scripts/powershell/ : 5 scripts (common.ps1, create-new-feature.ps1, setup-plan.ps1, check-prerequisites.ps1, update-agent-context.ps1)
- .specify/templates/ : 5 templates (spec-template.md, plan-template.md, tasks-template.md, checklist-template.md, agent-file-template.md)
- apps/api/ : Backend Fastify TypeScript
- apps/web/ : Frontend Next.js 15 TypeScript
- packages/contracts/, packages/ui/, packages/utils/ : Packages partagés
- specs/ : Dossier pour fonctionnalités
- Configuration : pnpm workspaces, TypeScript 5.x, tsconfig.json avec références

COMMANDES SPECTKIT (.cursor/commands/*.md):
Chaque commande doit avoir format:
---
description: [description]
---
## User Input
```text
$ARGUMENTS
```
[Instructions d'exécution détaillées]

1. speckit.specify.md : Crée fonctionnalité, exécute create-new-feature.ps1, crée spec.md
2. speckit.plan.md : Génère plan, exécute setup-plan.ps1, lit spec.md et constitution.md, génère plan.md/research.md/data-model.md/contracts/
3. speckit.tasks.md : Génère tâches, lit spec.md et plan.md, organise par user stories (P1/P2/P3), génère tasks.md
4. speckit.analyze.md : Analyse cohérence spec/plan/tasks, détecte problèmes
5. speckit.implement.md : Implémente tâches depuis tasks.md
6. speckit.checklist.md : Génère checklists
7. speckit.clarify.md : Clarifie ambiguïtés
8. speckit.constitution.md : Gère constitution

SCRIPTS POWERSHELL (.specify/scripts/powershell/*.ps1):
Tous avec support -Json pour Cursor AI, chemins absolus, gestion Git gracieuse.

1. common.ps1 : Get-RepoRoot, Get-CurrentBranch, Test-FeatureBranch, Get-FeaturePathsEnv (retourne REPO_ROOT, CURRENT_BRANCH, FEATURE_DIR, FEATURE_SPEC, IMPL_PLAN, TASKS, etc.)
2. create-new-feature.ps1 : Prend description, génère numéro suivant (001, 002...), crée branche Git ###-feature-name, crée specs/###-feature-name/, copie spec-template.md
3. setup-plan.ps1 : Détecte branche, vérifie spec.md, copie plan-template.md, retourne chemins JSON
4. check-prerequisites.ps1 : Vérifie fichiers requis, retourne liste disponibles, support -RequireTasks -IncludeTasks
5. update-agent-context.ps1 : Met à jour .cursor/rules/specify-rules.mdc avec technologies du plan

TEMPLATES (.specify/templates/*.md):
Tous complets avec instructions, pas de placeholders vides.

1. spec-template.md : User Stories avec priorités P1/P2/P3, Scenarios (Given/When/Then), Requirements, Success Criteria
2. plan-template.md : Technical Context, Constitution Check, Project Structure, Phases (0: Research, 1: Design, 2: Implementation)
3. tasks-template.md : Organisation par User Stories, Phases (Setup → Foundational → User Stories → Polish), marqueurs [P] pour parallélisation
4. checklist-template.md : Template checklists
5. agent-file-template.md : Template contexte agent

CONSTITUTION (.specify/memory/constitution.md):
Principes fondamentaux, stack technique (TypeScript, pnpm, PostgreSQL), standards code, workflow Git, tests, version.

CONFIGURATION:
- package.json racine : pnpm workspaces (apps/*, packages/*), scripts dev/build/test
- pnpm-workspace.yaml : packages: ['apps/*', 'packages/*']
- tsconfig.json racine : Références aux projets
- Apps/Packages : package.json avec noms scoped @monorepo/*, tsconfig.json avec extends

APPS ET PACKAGES:
- apps/api : Fastify, src/index.ts, scripts dev/build/start
- apps/web : Next.js 15, src/app/, scripts dev/build/start
- packages/contracts : Types Zod, exports TypeScript
- packages/ui : Composants React, exports nommés
- packages/utils : Fonctions utilitaires

README.md : Installation, développement, workflow SpectKit, commandes Cursor.

VALIDATION:
Le projet doit permettre immédiatement:
- pnpm install fonctionne
- pnpm dev lance api et web
- /speckit.specify "ma fonctionnalité" crée une spec
- /speckit.plan génère un plan
- /speckit.tasks génère des tâches
- Scripts PowerShell retournent JSON valide
- Templates complets et utilisables

CRÉE TOUS LES FICHIERS avec contenu COMPLET et FONCTIONNEL. Pas de placeholders vides. Projet immédiatement utilisable.
```

