# Plan d'implémentation — 006-secondary

**Statut** : Rédigé. Phase du plan : **5 — Pack Secondary** (plan §4). Dépend de **2.5** (011 : résultats, délibérations, décisions), **2.4** (012), **2.6** (013 : rendu des documents), **2.2-2.3** (008-010) et de 004. Les tâches sont parallélisables ; chacune a un périmètre de fichiers disjoint. Tailles relatives : S ≈ 1-2 semaines-développeur, M ≈ 3-5, L ≈ 6-10 (comme le plan général ; le calendrier réel dépend de la capacité de l'équipe, plan §8 point 1).

> Le DDL est **déjà écrit et testé** (`data-model.md`, `ddl-test/`, 85 tests) : les tâches `T6-DB-*` consistent à le **poser tel quel** dans les modules générés, pas à le concevoir.

## 1. Ordre et dépendances

```
Prérequis (livrés ou en cours) : kernel/TenantDb/outbox/worker ; 004 (classes, inscriptions, issues, financement) ; 008-010 ;
          011 (results.deliberations/decisions/appreciations) ; 012 (rules, contrat coef-semester@1) ; 013 (DocumentRenderer, StoragePort) ; 016 (messaging)
                                       │
   ┌──────────────┬────────────────────┼────────────────────┬──────────────────┬────────────────────┐
   ▼              ▼                    ▼                    ▼                  ▼                    ▼
T6-DB-C        T6-DB-V             T6-DB-S            T6-CONTRACTS      T6-REQ-RULES         T6-REQ-RC / T6-REQ-RES
(councils      (schoollife         (stateassign       (Zod v2/ : DTO,   (placeholder +       (COUNCIL_MINUTES ; ResultsWritePort
 1800-1804)     1900-1902)          2000-2001)         événements)       secondary-annual@1)  — avec les propriétaires de 013 et 011)
   │              │                    │                    │                  │
   ▼              ▼                    ▼                    │                  │
T6-C-DOMAIN   T6-V-DOMAIN          T6-A-DOMAIN              │                  │
(machines,    (machines,           (machines, avenant,      │                  │
 facts, PV,    visibilité,          rapprochement)          │                  │
 effets)       solde)                                       │                  │
   │              │                    │                    │                  │
   ▼              ▼                    ▼                    ▼                  ▼
T6-C-APP       T6-V-APP            T6-A-APP ◄────── T6-PORTS (adaptateurs platform/adapters : results, academic, people,
(préparer,     (incidents,         (dossiers,                 attendance, messaging, finance, reportcards, storage)
 décider, PV,   mesures, recours,   contrôles,
 déverrouiller) notes, convocations) documents)
   │              │                    │
   ├─► T6-ORIENT  ├─► T6-V-CONDUCT     └─► T6-A-GATEWAY (port NotConfigured)
   │   (parcours, │   (barèmes, solde)
   │    dossiers, │
   │    transferts)
   ▼              ▼                    ▼
T6-C-HTTP      T6-V-HTTP           T6-A-HTTP
   │              │                    │
   ├─► T6-C-WORKER (effets, rendu PV, expiration)   T6-V-JOBS (rappels, bornes d'exclusion)   T6-A-JOBS (contrôles, rapprochement)
   ▼
T6-PACK (modèles de pack, abonnés d'instanciation, features, menus, rôles rbac)  ──►  T6-EXAM-FACTS (faits pour 018)
   │
   ├─► T6-WEB-COUNCIL   T6-WEB-LIFE   T6-WEB-ASSIGN   T6-WEB-PORTALS   (parallèles, sur 033)
   ▼
T6-GUARDS (lints, tests de contenu) ─► T6-E2E ─► T6-CLEAN (indicateur « Affecté(e) » du legacy : avec la tranche 2.6)
```

## 2. Tâches

### T6-DB-C — Module `councils` : migrations (S)
- **Fichiers** : `pnpm module:new councils --range 1800` ; `modules/councils/migrations/1800-1804_*.sql` (extraites de `data-model.md` §5.1-5.5), `isolation-allowlist.councils.ts` (vide), ligne de plage dans `module-conventions.md`.
- **Fin** : migrations appliquées de zéro avec `migrator` ; test d'isolation générique (18 tables) ; **les tests de `ddl-test/councils.test.mjs` portés** dans `modules/councils/test/integration/` (mêmes assertions, `TEST_DATABASE_URL`) ; allowlist vide.
- **À savoir** : les gardes exigent un **acteur humain** (`app.actor = 'user'` + `app.user_id`) ; le contrôle comportemental du test générique ne fabrique pas ce contexte et rapportera donc « structure seule » (jamais « testée ») pour les tables à garde, sans échec. Le contrôle **structurel** (tenant_id, RLS forcée, policy unique, index) est complet (`structuralIsolationViolations` du harnais le rejoue) et la preuve A/B est apportée par les tests propres du module.

### T6-DB-V — Module `schoollife` : migrations (S)
- **Fichiers** : `modules/schoollife/migrations/1900-1902_*.sql`, allowlist vide, plage dans `module-conventions.md`.
- **Fin** : 14 tables, tests de `schoollife.test.mjs` portés ; fonctions `audience_may_see` et `conduct_balance` couvertes.

### T6-DB-S — Module `stateassign` : migrations (S)
- **Fichiers** : `modules/stateassign/migrations/2300-2303_*.sql`, allowlist vide.
- **Fin** : 8 tables, tests de `stateassign.test.mjs` portés.

### T6-CONTRACTS — Contrats Zod et événements (S)
- **Fichiers** : `packages/contracts/src/v2/{councils,schoollife,stateassign}.ts`, réexport dans `v2/index.ts`.
- **Contenu** : DTO d'entrée (entrées `strict`), DTO de sortie (jamais de donnée confidentielle dans les DTO de portail), **schéma `council-facts/1`** (chaînes, entiers, booléens, null) et **`council-minutes/1`**, schémas de payload des événements (`{ v: 1, … }`), codes d'erreur stables (`councils.*`, `schoollife.*`, `stateassign.*`) traduisant les messages de la base.
- **Fin** : tests de schémas ; refus de tout flottant dans les snapshots ; compatibilité ascendante d'un snapshot v1 après ajout d'un v2.

### T6-REQ-RULES — Jeu fictif et contrat N périodes (S, avec le propriétaire de 012)
- **Fichiers** : `rules` (valeur `placeholder` de `source_kind`, `resolve`), `packages/rules-engine/test/fixtures/` (jeu `CI-SECONDARY-PLACEHOLDER`, copie de `CI-CLASSIC-SEMESTRE` v1 marquée), contrat `secondary-annual@1`, seed national.
- **Fin** : test de gouvernance « un `placeholder` ne se publie jamais comme `regulation` » ; golden tests `classique-terminale` inchangés ; le contrat `secondary-annual@1` compile ses règles sur 2, 3 et 4 périodes (cas de test).

### T6-REQ-RC — Type de document `COUNCIL_MINUTES` (S, avec le propriétaire de 013)
- **Fichiers** : `reportcards` (registre de types de documents, gabarit plateforme `council-minutes`, options validées), snapshot `council-minutes/1`.
- **Fin** : rendu d'un PV fictif ; test d'injection sur le gabarit ; mention « jeu de démonstration » rendue ; aucun nom d'établissement par défaut.

### T6-REQ-RES — Port d'écriture de `results` (S, avec le propriétaire de 011)
- **Fichiers** : `results/index.ts` (fonctions `openDeliberationForCouncil`, `markDeliberationHeld`, `publishYearDecision`, `writeCouncilAppreciation`, `recordDistinction`), tests de contrat.
- **Fin** : un code final hors contrat est refusé ; `results.decision.confirmed` inchangé ; aucune écriture sur une période `CLOSED`.

### T6-C-DOMAIN — Domaine du conseil (M)
- **Fichiers** : `modules/councils/domain/*` (pur).
- **Contenu** : machine à états de la séance, des effets, des demandes de déverrouillage (en **miroir** de la base : test de parité transitions SQL ↔ TypeScript) ; construction de l'instantané `council-facts/1` (sans arithmétique, sans flottant) ; construction du snapshot de PV déterministe ; mapping décision → effets (famille, `needs_human_application`, codes de `results`) ; calcul des participants proposés ; règles de quorum (miroir de `check_quorum`).
- **Fin** : tests unitaires ≥ 90 % des lignes du domaine ; aucune constante réglementaire (lint R2) ; aucun import `pg`/`fastify`.

### T6-C-APP — Cas d'usage du conseil (L)
- **Fichiers** : `modules/councils/{application,infrastructure}/*`, `ports.ts`.
- **Contenu** : `createCouncil`, `prepareCouncil`/`rebuildAgendaItem`, `convokeCouncil`, `setPresence`, `openCouncil`, `addProposal`/`resolveProposal`, `recordDecision`/`withdrawDecision`, `closeCouncil`, `generateMinutes`, `signMinutes`/`addPaperSignature`/`revokeMinutes`, `requestUnlock`/`approveUnlock`/`reopenCouncil`, `planEffects`/`applyEffect`/`revertEffect`/`applyExclusion`, lectures (agenda, fiche élève, journal, synthèse de classe, portails). Chaque cas d'usage sensible : écriture → événement d'outbox → `audit.record` (dans l'ordre, une transaction). Traduction des erreurs SQL en codes `councils.*` (jamais de `500`).
- **Fin** : AC1-AC6 ; `expectAudited` ; parcours d'intégration complet (préparer → réouvrir → reclôturer) ; concurrence (deux signataires).
- **Dépend de** : T6-DB-C, T6-C-DOMAIN, T6-CONTRACTS, T6-PORTS (au moins en simulacre).

### T6-ORIENT — Orientation et transferts de série (M)
- **Fichiers** : `modules/councils/application/orientation/*`.
- **Contenu** : parcours autorisés (CRUD, import), dossiers, vœux (portail famille), consentement, transferts (décision du conseil ou acte de direction), application à `academic` (`REDIRECT` ou transfert de classe), dérogations.
- **Fin** : AC7 ; test « une série ajoutée par la donnée » ; aucune liste en code.

### T6-V-DOMAIN / T6-V-APP / T6-V-CONDUCT — Vie scolaire (S + L + M)
- **Fichiers** : `modules/schoollife/{domain,application,infrastructure}/*`.
- **Contenu** : machines à états (incident, mesure, recours, convocation, barème) en miroir de la base ; règle de visibilité (miroir de `audience_may_see`) ; solde de conduite (miroir de `conduct_balance`) ; cas d'usage incidents, implications, mesures (validation, quatre yeux, notification via `messaging`), recours, notes, convocations (envoi, accusé, report), barèmes, mouvements ; lecture confidentielle **journalisée avant** réponse ; vue d'`attendance` ; faits pour 018 et le conseil.
- **Fin** : AC8, AC9 ; matrice d'autorisation ; aucune donnée disciplinaire dans les logs ni les événements.

### T6-A-DOMAIN / T6-A-APP / T6-A-GATEWAY — Affectés par l'État (S + M + S)
- **Fichiers** : `modules/stateassign/*`.
- **Contenu** : machines à états ; dossiers, vérification (avec `academic.changeEnrollmentFunding`), avenant (remplacer puis créer la version n+1), contrôles, documents ; rapprochement avec `finance` (job + manuel) ; port `StateAssignmentGateway` avec adaptateur `NotConfigured` ; rapports.
- **Fin** : AC10 ; la référence d'`academic` provient du dossier vérifié ; aucun appel externe.

### T6-PORTS — Adaptateurs de plateforme (M)
- **Fichiers** : `apps/api/src/platform/adapters/{results-councils,academic-councils,people-councils,attendance-councils,messaging-councils,reportcards-councils,finance-stateassign,academic-stateassign,storage-councils}.ts`, `registerCouncilsPorts`, `registerSchoollifePorts`, `registerStateassignPorts`, `set*WorkerPorts`.
- **Fin** : tests d'adaptateurs réels (Postgres + modules voisins) ; comportement de repli (§3) testé ; les appels aux ports sont **séquentiels** dans une transaction (connexion partagée : ne pas les paralléliser, voir `attendance/README.md`).

### T6-C-HTTP / T6-V-HTTP / T6-A-HTTP — Plugins Fastify (M chacun)
- **Fichiers** : `modules/*/http/plugin.ts`, `schemas.ts`.
- **Contenu** : routes de la spec §8 ; `requirePermission` d'une permission du manifeste (scope pour les routes par ressource) ; `requireFeature` ; 404 hors périmètre ; `Cache-Control: no-store`.
- **Fin** : 401 sans contexte, 403 sans permission, matrice de la spec §12 ; contrats Zod.

### T6-C-WORKER / T6-V-JOBS / T6-A-JOBS — Abonnés et jobs (M)
- **Fichiers** : `modules/*/{subscribers,jobs}.ts` ; `pnpm --filter @ecoledigitale/worker build` après tout changement.
- **Contenu** : `councils.apply-effects`, `councils.render-minutes`, `councils.expire-unlock-requests`, `schoollife.remind-convocations`, `schoollife.exclusion-boundaries`, `stateassign.plan-controls`, `stateassign.reconcile` ; abonnés idempotents (`event.id`).
- **Fin** : rejeu sans doublon ; reprise après échec ; aucun `setInterval` (jobs répétables).

### T6-PACK — Modèles de pack, features, menus, rôles (M)
- **Fichiers** : `tenancy/templates/councils/CI/secondary.json`, `tenancy/templates/schoollife/CI/secondary.json` (sections de `data-model.md` §7), abonnés `*.instantiate-reference-data`, `manifest.ts` (permissions, features, menus), PR `rbac` (rôles système), liaison du RuleSet `CI-SECONDARY-PLACEHOLDER`.
- **Fin** : AC13 ; test « aucune valeur réglementaire par défaut » sur les modèles ; idempotence de l'instanciation ; un tenant `SECONDARY` provisionné est opérationnel par l'API seule.

### T6-EXAM-FACTS — Faits pour les examens (S, avec 018)
- **Fichiers** : `councils`/`schoollife`/`stateassign` `index.ts` (`getExamEligibilityFacts`, `getDisciplineFacts`, `getAssignmentFacts`), alignement des noms d'événements avec 018.
- **Fin** : AC11 ; contrat compilé contre le simulacre de 018 ; aucune éligibilité calculée.

### T6-WEB-COUNCIL / T6-WEB-LIFE / T6-WEB-ASSIGN / T6-WEB-PORTALS — Écrans (M chacun, après la fondation web 033)
- **Fichiers** : `apps/web/src/app/(admin|teacher|parent|student)/...`.
- **Contenu** : écrans de la spec §9 ; **aucun calcul** ; suggestions clairement étiquetées ; mode mobile et hors-ligne limité (§US12).
- **Fin** : Playwright par portail ; grep CI « aucune moyenne, aucun rang, aucun solde calculé dans `apps/web/src` ».

### T6-GUARDS — Garde-fous de contenu (S)
- **Fichiers** : règles `eslint`/scripts `check:*`, tests de modèles de pack.
- **Contenu** : (1) aucune liste de séries / langues / coefficients / types de sanction dans le code ; (2) aucune arithmétique sur les résultats dans `councils` ; (3) modèles de pack sans valeur réglementaire (§AC13.3) ; (4) aucun acteur système dans les cas d'usage d'acte humain (analyse statique : ces cas d'usage lisent `ctx.actor`) ; (5) frontières de modules.
- **Fin** : une violation volontaire de chaque règle fait échouer la CI.

### T6-E2E — Parcours de bout en bout (M)
- **Contenu** : conseil complet (préparation → signature → effets), incident → sanction → recours, affecté (dossier → vérification → rapprochement → contrôle), portail parent.
- **Fin** : jeux de seeds déterministes (un jeu par pack, plan §5.3) ; exécution sur `main` et avant release.

### T6-CLEAN — Nettoyage (S, rattaché à la tranche 2.6 de 013)
- **Contenu** : suppression de `buildAssignmentFlagsFromDecision` et de l'affichage « Affecté(e) » déduit de la décision ; aucune table du legacy n'est supprimée par 006 (le pack ne remplace aucune table existante : ni conseil de classe ni vie scolaire n'existaient).
- **Fin** : le bulletin lit le type de financement de l'inscription.

## 3. Repli explicite des ports non câblés (échec fermé pour les écritures)

| Port | Si non câblé |
|---|---|
| `ResultsReadPort` | `prepareCouncil` refuse (`councils.port_unavailable`) |
| `ResultsWritePort` | `openCouncil` refuse ; les effets `RESULTS_*` restent `PENDING` (jamais appliqués à moitié) |
| `AttendanceSummaryPort` | l'instantané porte `attendance: null` avec avertissement bloquant à l'ouverture (décision de la direction avec trace) |
| `RosterPort`, `EnrollmentPort` | refus (échec fermé) |
| `StaffAssignmentPort` | pas de participants proposés (saisie manuelle) |
| `NotificationPort` | convocation créée, `notified_at` vide, avertissement ; aucune notification simulée |
| `DocumentRenderPort` | le PV est généré et signable ; le rendu reste `PENDING` |
| `EnrollmentOutcomePort`, `EnrollmentFundingPort`, `StudentStatusPort` | effet `FAILED` avec diagnostic, repris plus tard |
| `FinancePort` | rapprochement impossible (`reconciliation_status` reste `NEVER`) |
| `StateAssignmentGateway` | adaptateur `NotConfigured` (réponse « non disponible ») : comportement **normal** en V1 |

Aucune simulation silencieuse en production (plan §3.11-3.12) ; les implémentations en mémoire sont réservées aux tests.

## 4. Vagues de livraison

| Vague | Contenu | Sortie |
|---|---|---|
| 0 | T6-DB-C/V/S, T6-CONTRACTS, T6-REQ-RULES, T6-REQ-RC, T6-REQ-RES | Trois modules posés ; demandes aux voisins actées ; isolation verte |
| 1 | T6-C-DOMAIN, T6-V-DOMAIN, T6-A-DOMAIN, T6-PORTS (simulacres puis réels) | Domaines purs testés ; adaptateurs |
| 2 | T6-C-APP, T6-V-APP, T6-A-APP, T6-ORIENT, T6-V-CONDUCT, T6-A-GATEWAY | Cas d'usage complets |
| 3 | T6-*-HTTP, T6-*-WORKER/JOBS, T6-PACK, T6-EXAM-FACTS | API et pack opérationnels |
| 4 | T6-WEB-*, T6-GUARDS | Écrans, garde-fous |
| 5 | T6-E2E, T6-CLEAN | Critères de sortie de la spec §15 |

**Chemin critique** : T6-REQ-RES (011) et T6-REQ-RC (013) conditionnent les effets `RESULTS_*` et le rendu du PV ; T6-C-APP est le plus long. La vie scolaire et l'affectation sont indépendantes du conseil (hors lecture de synthèse) et peuvent partir dès la vague 0.

## 5. Risques

| # | Risque | Mitigation |
|---|---|---|
| R-1 | **Textes officiels indisponibles** (composition et quorum du conseil, passage, redoublement, orientation, BEPC/BAC, discipline, affectation) | Mécanisme + jeu `placeholder` ; aucune valeur réglementaire par défaut ; liste de collecte `regulatory-sources-needed.md` ; un RuleSet `regulation` n'est écrit qu'avec texte **et** exemple chiffré validé par un référent |
| R-2 | Confusion entre jeu fictif et règlement | Mention imprimée sur PV, résultats, bulletins ; avertissement bloquant à la première séance ; marquage `placeholder` des types, barèmes, modèles |
| R-3 | **Collision de plages de migrations** avec 005, 007, 018 (plage 1800+ libre à ce jour) | Plages 1800/1900/2000 **proposées** ; `pnpm module:new` attribue dans l'ordre ; renuméroter les fichiers `*.sql` à la pose si nécessaire (le contenu est indépendant des numéros) ; ligne dans `module-conventions.md` dans la même PR |
| R-4 | Écriture de `results.decisions` par un autre module (changement d'un contrat de 011) | Demande formalisée (§7.4 de la spec) ; port étroit ; tests de contrat ; `results` reste seule source lue par `academic` |
| R-5 | Reproductibilité du hash `jsonb::text` d'une version de PostgreSQL à l'autre | Le hash est **calculé par la base** et vérifié par le job d'intégrité nocturne ; un test fige des vecteurs ; fonction de repli `canonical_json` de 013 envisageable si le format changeait (migration de rejeu) |
| R-6 | Pic de rendu PDF en fin de période (tous les PV et bulletins) | File équitable par tenant (013) ; PV légers ; rendu asynchrone ; signature possible avant rendu |
| R-7 | Valeur juridique de la signature (accusé daté et haché) | Hors périmètre : question juridique `regulatory-sources-needed.md` §6 ; signature papier numérisée prévue en complément |
| R-8 | Interprétation de « Affecté(e) » (legacy : « non redoublant ») | Q6-23 ; le pack distingue `STATE_ASSIGNED` du résultat ; correction documentée en parité |
| R-9 | Données disciplinaires de mineurs : fuite, durée de conservation | Confidentialité en trois niveaux, lectures journalisées, `no-store`, aucun texte dans les événements, `retention_days` paramétrable, question Q6-17 |
| R-10 | 018 (examens) en cours de rédaction : noms d'événements et de ports | Marqués ⚠ ; alignement dans T6-EXAM-FACTS ; le pack ne dépend d'aucun nom de 018 pour fonctionner |
| R-11 | Charge d'écran du conseil sur mobile | Fiche élève unitaire, navigation par élève, états de séance simples ; test mobile Playwright |
| R-12 | Dérive vers un « moteur de décision » | Garde-fous : acteur humain imposé en base ; lint « aucune arithmétique sur les résultats » ; aucune règle de décision dans les modules du pack |
| R-13 | Nombre de périodes (trimestres vs semestres) non tranché | Contrat `secondary-annual@1` demandé ; `coef-semester@1` suffit pour deux périodes ; Q6-01 |

## 6. Commandes

```bash
# DDL de référence : tests de comportement (Postgres éphémère dans Docker, supprimé à la fin)
ED_PG_IMAGE=postgres:17-alpine node specs/v2/006-secondary/ddl-test/run.mjs

# Une fois les modules générés (pnpm module:new councils|schoollife|stateassign)
pnpm check:boundaries
pnpm --filter @ecoledigitale/api type-check:v2
node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/councils   # idem schoollife, stateassign
pnpm test:isolation
```

## 7. Définition de « terminé » pour une tâche

Contrat Zod avant la route ; cas d'usage transactionnel (écriture → événement → audit) ; traduction des erreurs de la base en codes stables ; tests unitaires et d'intégration verts ; aucune constante réglementaire ; aucune donnée disciplinaire ni note dans les logs/événements ; permissions et features déclarées dans le manifeste ; README du module mis à jour ; `pnpm --filter @ecoledigitale/worker build` si abonné ou job.
