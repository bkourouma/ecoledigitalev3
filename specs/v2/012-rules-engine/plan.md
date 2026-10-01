# Plan d'implémentation — 012-rules-engine

**Statut** : Rédigé. Tranche du plan : **2.4** (« Rules Engine + RuleSets BTS/LMD et classique + golden tests contre 2.0 »). Les tâches sont écrites pour être confiées en parallèle à des agents ; chaque tâche liste son périmètre de fichiers (conflits évités), ses prérequis et sa preuve de fin.

## 1. Ordre et dépendances

```
Prérequis (livrés en Phase 1) : kernel, TenantDb/SystemDb, enable_tenant_rls, outbox, worker, rbac (manifestes), audit.record, entitlements
                                  │
 ┌──────────────┬────────────────┼───────────────────┐
 ▼              ▼                ▼                   ▼
T-CONTRACTS   T-GOLD            T-DB               T-LINT
(Zod + code   (package :        (migrations        (dependency-cruiser,
 des contrats) règles NOUVELLES) 1000-1002,gardes)  lint R2)
 │              │                │
 └──────┬───────┴───────┬────────┘
        ▼               ▼
     T-DOMAIN       T-SEED  ◄── (fixtures T-GOLD)
     (modèle↔moteur, hash, cache)
        │
 ┌──────┼───────────────┬──────────────┐
 ▼      ▼               ▼              ▼
T-RESOLVE  T-GOV        T-SIM          T-REPLAY
(resolve,  (transitions (simulation,   (rejeu de
 evaluate)  événements)  avec 011)      reproductibilité)
        │
        ▼
     T-HTTP ──► T-WEB (après 033-web-foundation)
        │
        ▼
     T-E2E (variante de bout en bout) ─► T-DOC
```

`T-SIM` et `T-REPLAY` dépendent du pipeline `results` (011 : T-PIPE) pour la partie « construire les cas » ; ils peuvent démarrer avec un **faux fournisseur de cas** (fixtures) et se brancher ensuite.

## 2. Tâches

### T-CONTRACTS — Contrats Zod et contrats de règles (S)
- **Fichiers** : `packages/contracts/src/v2/rules.ts` (+ réexport `index.ts`), `apps/api/src/modules/rules/contracts/{credit-semester.ts,coef-semester.ts,index.ts}`.
- **Contenu** : schémas Zod de toutes les requêtes/réponses de `spec.md` §8 ; constantes `RULE_KEYS`, `RuleContract` (clés, type, `RuleSchemaSpec`, `ResultTypeSpec`, optionnel) ; codes de sortie (`MENTION_CODES`, `DECISION_CODES`…).
- **Fin** : tests unitaires de conformité d'un `RuleVersion` fixture à son contrat (positifs et négatifs) ; aucun schéma sans route (R4 inversé : contrats avant routes).

### T-GOLD — Règles NOUVELLES et codes stables dans le package (M)
- **Fichiers** : `packages/rules-engine/test/fixtures/rulesets.ts` (ajouts), `packages/rules-engine/test/golden-*.test.ts` (ajouts) — **sans modifier `src/`** (le langage est figé par l'ADR-003).
- **Contenu** : ajouter les règles marquées NOUVELLE de `rule-contracts.md` ; remplacer les libellés de sortie par des **codes** + `label_map` ; renommer `semestre_valide` (fixture) en `semestre_valide_par_credits` et introduire `semestre_valide` = « toutes les UE validées » (voir `rulesets-de-depart.md` E7) ; golden tests différentiels vs le code historique (`legacy-semester-averages.ts`, `bulletin-calc.ts` recopié en oracle) ; cas de régression nommés (24 couples de 10 exact, 0,2/8,2 → 5 exact, 9,995).
- **Fin** : `pnpm --filter @ecoledigitale/rules-engine test` vert (≥ 293 + nouveaux) ; couverture du package inchangée ou supérieure (seuil de la spec 000).
- **Note** : si une règle nouvelle exige une fonction absente de la liste blanche, **stop** : demande au propriétaire du package (ADR-003 « Évolution du langage »). Aucune n'est prévue (`all`, `any`, `filter`, `map`, `max`, `sum`, `wavg`, `rank`, `round_half_up` suffisent).

### T-DB — Migrations et gardes (M)
- **Fichiers** : `apps/api/src/modules/rules/migrations/{1000_rules_schema.sql,1001_rules_national.sql,1002_rules_tenant.sql,1003_rules_guards.sql,1090_rules_seed.sql}`, `isolation-allowlist.rules.ts`.
- **Contenu** : `data-model.md` ; triggers d'immutabilité, miroir des transitions, hash, `no_delete`, `forbid_mutation` ; policies système.
- **Fin** : test d'isolation générique vert (tables tenant) ; tables nationales en liste blanche avec justification ; tests d'intégration : `UPDATE` d'une règle `approved` refusé, transition illégale refusée, chevauchement d'effet refusé, `DELETE` refusé, admin tenant ne peut pas passer à `approved`.

### T-LINT — Garde-fous (S)
- **Fichiers** : `.dependency-cruiser.cjs` (règle : seul `modules/rules/**` importe `@ecoledigitale/rules-engine`), config du lint R2 (interdiction des littéraux de seuil dans `modules/{assess,results,reportcards,higher}/**`).
- **Fin** : violation volontaire de test ⇒ CI rouge ; liste blanche des constantes structurelles revue.

### T-DOMAIN — Mapping base ↔ moteur, hash, cache (M)
- **Fichiers** : `modules/rules/domain/*` (pur), `modules/rules/infrastructure/repositories/*`.
- **Contenu** : conversion lignes ↔ `RuleSet/RuleVersion` du moteur (`RuleSetSchema.parse` en sortie de dépôt) ; `computeDefinitionHash` ; cache LRU de `CompiledVersion` par `(versionId, definitionHash)` ; invalidation sur événements.
- **Fin** : tests unitaires purs ; égalité hash applicatif/SQL ; `loadVersion` ≤ 5 ms à chaud.

### T-SEED — Seed des RuleSets de départ (S)
- **Fichiers** : `scripts/rules-seed.ts` (génère `1090_rules_seed.sql` depuis les fixtures du package — source unique), test de non-régression « seed = fixtures ».
- **Fin** : base vide + migrations ⇒ 3 RuleSets `published` dont chaque règle compile et le hash égale le hash stocké.

### T-RESOLVE — `resolve` / `loadVersion` / `evaluate` (M)
- **Contenu** : API publique §5.2 ; liaisons ; `resolveRuleSet` avec statuts actifs par défaut ; erreurs `Result` typées ; journal `evaluation_failures` ; métriques (compteur d'évaluations, p95).
- **Fin** : table de vérité `resolve` (variante > national, dates, spécificité, versions écartées avec raison) ; budget dépassé ⇒ erreur de règle journalisée.

### T-GOV — Gouvernance (M)
- **Contenu** : cas d'usage `deriveVariant`, `editParameters`, `editExpression`, `validateVersion`, `transition` (utilise `canTransition`) ; invalidation de simulation à la modification ; confirmation d'impact (AC2.5) ; séparation des tâches ; événements `rules.version.*` ; `audit.record` ; verrou optimiste.
- **Fin** : tests d'intégration acteur × transition ; commentaires obligatoires ; audit présent (test `expectAudited`) ; atomicité (`expectAuditRolledBack`).

### T-SIM — Simulation (M) — *dépend de 011 T-PIPE pour le branchement réel*
- **Contenu** : `requestSimulation`/`recordSimulationReport` ; abonné worker `results.simulate-on-request` (dans 011) ; persistance du rapport et des différences plafonnées ; progression ; annulation.
- **Fin** : simulation de 1 000 cas ≤ 60 s ; rapport égal à `simulate()` du package ; compteurs exacts au-delà du plafond.

### T-REPLAY — Rejeu de reproductibilité (S)
- **Contenu** : job planifié `rules.replay` (échantillon `replay_sample_percent` + résultats de bulletins contestés) ; compare `outputs_hash` ; événement `rules.replay.mismatch`.
- **Fin** : détection d'une altération volontaire d'une règle (test) ; 0 écart sur le jeu de test.

### T-HTTP — Plugin Fastify (M)
- **Contenu** : routes `spec.md` §8 ; `requirePermission` ; `requireFeature` ; rate limiting du banc d'essai ; schémas Zod de T-CONTRACTS.
- **Fin** : tests d'intégration par route (nominal, 401/403/404/409/422) ; aucune SQL dans `http/` (lint).

### T-WEB — Écrans (L) — *après 033-web-foundation*
- **Contenu** : écrans de `spec.md` §9 ; éditeur d'expressions (colorisation + `validate` ≤ 300 ms) ; rapport de simulation ; file d'approbation.
- **Fin** : Playwright par portail (admin, super-admin) ; accessibilité clavier de l'éditeur.

### T-E2E — Variante de bout en bout (S)
- **Scénario** : tenant de test → variante (`poids_devoirs = 0,5`) → simulation (rapport non vide) → proposition → approbation super-admin → création d'une période ouverte → calcul utilise la variante ; période antérieure inchangée.

### T-DOC — Documentation d'exploitation (S)
- Runbook : retirer une version fautive, traiter `rules.replay.mismatch`, ajouter un contrat `@2`, procédure de montée de version du moteur.

## 3. Risques

| # | Risque | Probabilité / impact | Atténuation |
|---|---|---|---|
| R1 | **Le périmètre de `RuleDefinition.type` ne couvre pas `diplomation`/`capitalisation`** | faible / faible | Réutilisation de `promotion` / `credit_validation` (décision tranchée, `open-questions.md` A-12). Pas de changement de moteur. |
| R2 | Écart entre fixtures (clés/codes français) et contrats (codes anglais) | moyenne / moyenne | T-GOLD fait la bascule en un lot unique, tests différentiels contre le legacy ; table d'alias dans `rule-contracts.md`. |
| R3 | **Semantique réelle ≠ semantique documentée** (semestre validé par UE vs 20 crédits) | **forte** / forte | Q-01 posée au propriétaire ; v1 = comportement réellement appliqué ; règles par crédits livrées mais inactives. |
| R4 | Les rédacteurs d'établissement cassent un calcul par une expression valide mais absurde | moyenne / forte | Simulation obligatoire, confirmation d'impact, rapport de transitions, approbation du super-admin (D5), édition d'expressions derrière feature + permission sensible. |
| R5 | Coût de maintenance du DSL maison | moyenne / moyenne | Surface petite, 293 tests, aucun mécanisme d'extension par RuleSet (ADR-003). |
| R6 | Performance des simulations sur de grosses cohortes | moyenne / moyenne | Job worker, plafond de différences, progression, annulation ; débit moteur ≥ 40 000 éval./s. |
| R7 | Dérive entre hash applicatif et SQL | faible / forte | Test de contrat croisé, fonction SQL unique de référence pour les migrations. |
| R8 | Collision de plage de migrations avec les modules écrits en parallèle (004, 008-010, 017) | moyenne / faible | Plage `1000-1099` proposée ; le lead tranche et complète `module-conventions.md`. |
| R9 | Absence de textes officiels pour 005/006/018 | **forte** / forte (pour ces specs) | Mécanisme livré sans règles ivoiriennes officielles ; liste des textes à obtenir (`regulatory-sources-needed.md`). |

## 4. Estimation relative

S ≈ 1-2 semaines, M ≈ 3-5, L ≈ 6-10 (plan §4). Total 012 : ≈ **M+L** en cumulé ; chemin critique : T-GOLD → T-SEED → T-RESOLVE → T-GOV → T-SIM/T-E2E.

## 5. Définition de fini (par tâche)

Tests verts en CI ; revue de l'invariant concerné (R-RUL-xx) ; mise à jour du manifeste (`manifest.ts`) pour toute permission/feature/événement ajouté ; aucun import interdit ; migration appliquée sur base vide ET incrémentale ; documentation de l'API publique (`index.ts`) à jour.
