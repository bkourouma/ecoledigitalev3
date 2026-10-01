# Plan d'implémentation — 011-assessments-grades (modules `assess` et `results`)

**Statut** : Rédigé. Tranche du plan : **2.5** (« Évaluations, notes, workflow, `GradeRevision`, résultats, clôture de période, rattrapage »), précédée de la tranche **2.0** (tests de caractérisation) et de la **2.4** (Rules Engine, spec 012). Tâches parallélisables ; chaque tâche a un périmètre de fichiers disjoint.

## 1. Prérequis et ordre

```
Prérequis : kernel, TenantDb/SystemDb, outbox, worker, rbac, audit, entitlements (Phase 1) ;
            004 (curriculum, périodes, classes, inscriptions), 008/009 (élèves, tuteurs, affectations) — au moins leurs PORTS (faux fournisseurs acceptés) ;
            012 : T-CONTRACTS, T-GOLD, T-DB, T-RESOLVE (API `rules` utilisable)
                           │
 ┌───────────────┬─────────┴──────────┬──────────────────┐
 ▼               ▼                    ▼                  ▼
T-A-DB          T-R-DB              T-CHAR             T-PORTS
(assess : DDL,  (results : DDL,     (2.0 : figer les   (interfaces des ports
 triggers)       triggers)           sorties legacy)    + faux fournisseurs)
 │               │                    │                  │
 ▼               ▼                    │                  │
T-A-DOMAIN     T-R-DOMAIN ◄───────────┴──────────────────┘
(workflow,     (contextes, pipelines,
 révisions)     surcharges, états)
 │               │
 ▼               ▼
T-A-HTTP       T-R-JOBS (recompute, close, replay)
 │               │
 └──────┬────────┘
        ▼
     T-R-HTTP ──► T-WEB-T (enseignant) ─┐
        │         T-WEB-D (direction)   ├─► T-E2E ─► T-CLEAN (suppression du legacy)
        │         T-WEB-F (famille)    ─┘
        ▼
     T-OFFLINE (029, squelette de file de mutations)
```

## 2. Tâches

### T-CHAR — Tests de caractérisation (tranche 2.0) (M) — **premier à démarrer**
- **Fichiers** : `tests/characterization/{professional-lmd,classic-semester}/*` (hors modules).
- **Contenu** : seeds déterministes (un jeu par contrat) ; exécution du **code legacy actuel** sur ces scénarios et figement des sorties en JSON : notes ECUE, moyennes UE, crédits, décision, mention, rang, moyenne annuelle ; sources : `professional-results.test.ts`, `professional-ecue.test.ts`, `moyennes-semestre.spec.ts`, scénario S17-T. Le jeu inclut les **cas d'égalité de seuil** (24 couples) pour documenter les écarts.
- **Fin** : JSON versionnés, rejouables sans base legacy ; liste des écarts attendus (E1-E3) signée.

### T-PORTS — Ports et faux fournisseurs (S)
- **Fichiers** : `modules/results/ports/*.ts`, `modules/assess/ports/*.ts`, `modules/*/testing/fakes/*`.
- **Contenu** : `CurriculumReader`, `EnrollmentDirectory`, `PeriodReader`, `TeachingAssignmentPort`, `GuardianshipPort`, `AttendanceSummaryPort` (§5.2 de la spec) ; faux en mémoire alimentés par les seeds ; contrats de test que les vrais fournisseurs (004/008/009/010) doivent satisfaire (« contract tests »).
- **Fin** : `assess` et `results` testables sans 004/008/009 réels.

### T-A-DB — Schéma `assess` (M)
- **Fichiers** : `modules/assess/migrations/1100-1106_*.sql`, `isolation-allowlist` (aucune table globale).
- **Fin** : `data-model.md` §1 ; test d'isolation générique ; **tests de triggers** : `UPDATE`/`DELETE` d'une note publiée refusés, `apply_revision` accepté si approuvée, période verrouillée refusée, transition illégale refusée, séparation des tâches.

### T-A-DOMAIN — Workflow, saisie, révisions (L)
- **Fichiers** : `modules/assess/{domain,application,infrastructure}/*`.
- **Contenu** : machine à états (domaine pur), cas d'usage `createAssessment`, `bulkCreate`, `saveGrades` (idempotence + `row_version`), `transition`, `requestRevision`, `decideRevision`, `applyRevision`, `cancelAssessment`, `lockPeriod/unlockPeriod` (API publique pour `results`), lectures élève/tuteur ; `audit.record` partout ; outbox ; manifeste (permissions, features, événements).
- **Fin** : couverture du domaine pur ≥ seuil spec 000 ; `expectAudited` ; un événement par évaluation publiée ; test de concurrence des lots.

### T-A-HTTP — Plugin Fastify `assess` (M)
- **Fichiers** : `modules/assess/http/*`, `packages/contracts/src/v2/assess.ts`.
- **Fin** : tests d'intégration par route (nominal, 401/403/404/409/422) ; aucune SQL dans `http/` ; `requireFeature` sur la session 2.

### T-R-DB — Schéma `results` (M)
- **Fichiers** : `modules/results/migrations/1200-1205_*.sql`.
- **Fin** : `data-model.md` §2 ; triggers d'immutabilité `FINAL`, `closures` append-only, unicité des versions ; isolation générique.

### T-R-DOMAIN — Contextes, pipelines, états (L) — *cœur du risque*
- **Fichiers** : `modules/results/domain/{context-builders,pipelines,period-state,overrides,decisions}/*` (pur), `application/*`, `infrastructure/*`.
- **Contenu** : constructeurs de contexte purs (tri déterministe, absence ≠ 0, minimisation) ; pipelines `credit-semester@1` et `coef-semester@1` appelant `rules.evaluate` ; phase 2 (rang) ; calcul de `inputs_hash/outputs_hash` ; surcharges injectées ; décisions ; états de période ; clôture avec `closure_hash`.
- **Fin** : **golden tests différentiels** contre T-CHAR (à l'écart documenté près) ; tests de propriété (permutation des élèves ⇒ mêmes sorties) ; 60 × 12 ≤ 5 s ; aucune constante de seuil (lint R2 vert).

### T-R-JOBS — Recalcul, clôture, rejeu (M)
- **Fichiers** : `modules/results/{subscribers,jobs}.ts` (découverts par le worker).
- **Contenu** : abonnés `assess.grade.published|revised`, `results.override.*`, `academic.enrollment.*`, `rules.binding.changed|version.*`, `tenancy.tenant.provisioned` ; file `recompute_requests` (coalescence, `SKIP LOCKED`) ; job de clôture en lot ; purge ; abonné `rules.simulation.requested` (construit les cas et rappelle `rules.recordSimulationReport`) ; job de rejeu (avec 012 T-REPLAY).
- **Fin** : 40 publications ⇒ un calcul ; recalcul bloqué sur période verrouillée ; reprise après crash (job rejouable, idempotent).

### T-R-HTTP — Plugin Fastify `results` (M)
- **Fichiers** : `modules/results/http/*`, `packages/contracts/src/v2/results.ts`.
- **Fin** : routes de la spec §8.2 ; réponses sans identité des autres élèves ; lecture famille limitée aux résultats `FINAL` visibles.

### T-WEB-T / T-WEB-D / T-WEB-F — Écrans (L) — *après 033-web-foundation*
- T-WEB-T : « Mes évaluations », grille de saisie mobile (clavier numérique, états d'absence, contrôle de barème), soumission.
- T-WEB-D : relecture, corrections, tableau de bord de période, résultats de classe, délibération, « Pourquoi ce résultat ? ».
- T-WEB-F : « Mes notes », « Mes résultats » (élève, tuteur).
- **Fin** : Playwright par portail ; **grep CI : aucun calcul de moyenne/rang/mention dans `apps/web/src`**.

### T-OFFLINE — File de mutations de notes (S) — *squelette 029*
- **Contenu** : stockage local des mutations (`Idempotency-Key`, `row_version` attendus), rejeu, gestion des conflits `409 assess.stale_grade`.
- **Fin** : scénario hors ligne ⇒ resynchronisation sans doublon ni écrasement.

### T-E2E — Année simulée (M)
- **Scénario** : tenant Higher et tenant classique ; saisie → circuit → publication → clôture → réouverture/correction → bulletin (013) ; comparaison aux sorties figées de T-CHAR ; test S17-T (notes).

### T-CLEAN — Suppression du legacy (M) — **règle de sortie de tranche**
- Supprimer `professional-assignments.service.ts`, `professional-results.service.ts`, `professional-cloture-guard.ts`, la partie « moyennes » de `semester-averages.ts`, les routes `student-grades.ts`/`parent-grades.ts` (lecture) ou les basculer sur les lecteurs v2, les tables listées en tête de `parity.md`, les doublons web ; documenter dans `docs/inventory`.
- **Fin** : golden tests verts, ancien code et tables supprimés, aucun accès web au calcul (plan §4, règle de sortie).

## 3. Risques

| # | Risque | P / I | Atténuation |
|---|---|---|---|
| R1 | Le **comportement réel** diffère du comportement documenté (semestre validé, session 2) | forte / forte | T-CHAR fige le réel ; Q-01/Q-02 ; règles inactives conservées. |
| R2 | Les **attributs de nœud** de 004 (`grading_mode`, `resit_allowed`, `counts_in_average`, `category`, `terminal_exam_required`, type/rang des périodes) ne sont pas fournis à temps | moyenne / forte | Liste d'exigences envoyée à l'architecte de 004 (§5.2) ; faux fournisseurs ; sans eux, T-R-DOMAIN ne se termine pas. |
| R3 | Tempête de recalculs (import massif de notes, 031) | moyenne / moyenne | Coalescence par clé + `not_before` ; `scope_enrollments` ; limitation de concurrence par tenant. |
| R4 | Coût des triggers (mirror de statut, vérification des révisions) sur 60+ lignes | faible / moyenne | Mesure en T-A-DB (objectif : publication de 300 notes ≤ 200 ms). |
| R5 | Trigger `grades_guard` trop strict casse la saisie hors ligne | moyenne / moyenne | Saisie en lot qui n'écrit qu'en `DRAFT` ; tests de synchronisation. |
| R6 | Dépendances circulaires (`assess ↔ results ↔ rules`) | moyenne / forte | A-08 : verrou dans `assess`, simulation par événements, ports ; dépendency-cruiser. |
| R7 | Divergence entre trace stockée et rejeu (version du moteur) | faible / forte | `engine_version` stocké ; rejeu nocturne ; politique de montée de version (012 R-RUL-13). |
| R8 | Volume de `period_results` (versions) | moyenne / faible | Purge `DRAFT/SUPERSEDED` hors `FINAL` après 90 jours. |
| R9 | Mutation de classe en cours de période (Q-39) non tranchée | moyenne / moyenne | Comportement par défaut documenté (notes liées à l'inscription d'origine) ; point à valider. |
| R10 | La suppression de l'ancien code casse les portails parent/élève | moyenne / forte | T-WEB-F et la tranche 2.8 : lecteurs v2 livrés **avant** la suppression ; routes `parent-*`/`student-*` listées en T-CLEAN. |

## 4. Estimation relative

S ≈ 1-2 sem., M ≈ 3-5, L ≈ 6-10. Cumul : **XL** (M+S+M+L+M+M+L+M+M+L+S+M+M). Chemin critique : T-CHAR → T-PORTS → T-R-DOMAIN → T-R-JOBS → T-E2E → T-CLEAN.

## 5. Définition de fini

CI verte (unitaires, intégration, isolation, `dependency-cruiser`, lint R2) ; golden tests verts avec écarts documentés ; manifestes (permissions, features, événements) à jour ; audit présent (tests d'architecture) ; migrations appliquées sur base vide **et** incrémentale ; documentation de l'API publique d'`assess` et `results` ; anciens artefacts supprimés pour la tranche.
