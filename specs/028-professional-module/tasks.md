---
description: "Task list for Module Professionnel implementation"
---

# Tasks: Module Professionnel (inscription à la carte)

**Input**: Design documents from `specs/028-professional-module/`
**Branch**: `028-professional-module`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/professional-api.md, quickstart.md

**Tests**: Des tâches de test sont incluses. Bien que `spec.md` ne demande pas explicitement le TDD, `quickstart.md` §5 énumère une couverture de tests attendue et la fonctionnalité touche aux paiements et inscriptions (risque élevé) — les tests ciblent la logique métier serveur critique. Elles peuvent être retirées si non souhaitées.

**Organization**: Tâches groupées par user story (priorités P1→P3 de `spec.md`) pour une implémentation et un test indépendants.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: parallélisable (fichiers distincts, aucune dépendance sur une tâche non terminée)
- **[Story]**: user story rattachée (US1…US6)
- Chemins de fichiers exacts inclus dans chaque description

## Path Conventions

Monorepo pnpm : API `apps/api/src/`, web `apps/web/src/`, contrats `packages/contracts/src/`, migrations `infra/scripts/migrations/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Création des fichiers d'infrastructure du module.

- [X] T001 Écrire la migration `infra/scripts/migrations/0061_professional_module.sql` — 6 tables `professional_*`, policies RLS, index, contraintes (idempotente et non destructive, conforme à `data-model.md`)
- [X] T002 [P] Créer le runner de migration `scripts/apply-migration-0061-professional-module.js` (calqué sur `scripts/apply-migration-0055-unified-multitenancy.js`)
- [X] T003 [P] Créer le fichier de contrats `packages/contracts/src/professional.ts` (squelette `import { z } from "zod"`) et ajouter son re-export dans `packages/contracts/src/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schéma, contrats, câblage des routes/services. **Aucune user story ne peut démarrer avant la fin de cette phase.**

**⚠️ CRITICAL**: bloque toutes les user stories.

- [X] T004 Appliquer la migration `0061` sur la base de dev et vérifier les 6 tables + RLS activée (`quickstart.md` §1)
- [X] T005 [P] Implémenter tous les schémas Zod et types dans `packages/contracts/src/professional.ts` — enums (statuts matière/session/commande/inscription, mode/statut paiement), objets `ProfessionalSubject`/`Create`/`Update`, `SetPrerequisites`, `ProfessionalSession`/`Create`/`Update`/`SessionStatusTransition`, `ProfessionalCartItem`, `ProfessionalOrder`, `ProfessionalEnrollment`, `ProfessionalPayment`, `ProfessionalProgrammeOption`, `ProfessionalCatalogItem` — avec refinements (`date_fin >= date_debut`, fenêtre cohérente, `prix>=0`, `nb_uv>=0`, `capacite_max>0`)
- [X] T006 Créer le module de routes `apps/api/src/routes/professional.ts` (`export async function professionalRoutes(fastify)`) et l'enregistrer dans `apps/api/src/index.ts` **après `authMiddleware`** avec `prefix: "/api/v1/professional"`
- [X] T007 [P] Ajouter `"/api/v1/professional"` au tableau `tenantRequiredPrefixes` de `apps/api/src/plugins/tenant-context.ts`
- [X] T008 [P] Créer les gardes de rôle `requireAdmin`, `requireStudent`, `requireParent` dans `apps/api/src/middlewares/professional-guards.ts` (calqués sur `middlewares/requireOwner.ts`)
- [X] T009 [P] Créer les squelettes des 3 classes de service dans `apps/api/src/services/` : `professional-catalog.service.ts`, `professional-enrollment.service.ts`, `professional-payment.service.ts` (constructeur `Pool`, helpers communs : contexte tenant, enveloppe de réponse)
- [X] T010 [P] Créer la route proxy Next.js `apps/web/src/app/api/v1/professional/[...path]/route.ts` (relais vers l'API backend, en-têtes via `createApiHeaders`)

**Checkpoint**: Fondation prête — les user stories peuvent démarrer.

---

## Phase 3: User Story 1 - Catalogue professionnel administré (Priority: P1) 🎯 MVP

**Goal**: Un administrateur crée des matières rattachées à un programme et des sessions datées, et les ouvre à l'inscription.

**Independent Test**: Créer une matière + une session, la passer à « ouvert » ; vérifier qu'elle est exposée comme inscriptible côté étudiant dans sa fenêtre d'inscription.

### Tests for User Story 1

- [X] T011 [P] [US1] Test Jest CRUD des matières + unicité du code par tenant dans `apps/api/src/__tests__/professional-subjects.test.ts`
- [X] T012 [P] [US1] Test Jest création de session + validation dates/fenêtre + isolation multi-tenant dans `apps/api/src/__tests__/professional-sessions.test.ts`

### Implementation for User Story 1

- [X] T013 [US1] Implémenter le CRUD des matières dans `apps/api/src/services/professional-catalog.service.ts` (create/list/get/update, désactivation soft, code unique par tenant)
- [X] T014 [US1] Implémenter la gestion des sessions dans `apps/api/src/services/professional-catalog.service.ts` (create/list/get/update, transitions de statut manuelles, refus de session sur matière `inactif`)
- [X] T015 [US1] Implémenter les endpoints admin « matières » dans `apps/api/src/routes/professional.ts` (`GET/POST /subjects`, `GET/PATCH/DELETE /subjects/:id`) avec JSON-Schema + `requireAdmin`
- [X] T016 [US1] Implémenter les endpoints admin « sessions » dans `apps/api/src/routes/professional.ts` (`GET/POST /subjects/:id/sessions`, `GET/PATCH /sessions/:id`, `POST /sessions/:id/status`) avec `requireAdmin`
- [X] T017 [P] [US1] Créer le hook `apps/web/src/lib/hooks/use-professional-catalog-admin.ts` (TanStack Query : matières, sessions)
- [X] T018 [P] [US1] Créer les pages web admin des matières dans `apps/web/src/app/professionnel/admin/matieres/` (liste + création/édition)
- [X] T019 [P] [US1] Créer les pages web admin des sessions dans `apps/web/src/app/professionnel/admin/sessions/` (liste + création/édition + contrôle de statut)

**Checkpoint**: US1 fonctionnelle et testable — le catalogue admin est opérationnel.

---

## Phase 4: User Story 2 - Inscription à la carte de l'étudiant (Priority: P1) 🎯 MVP

**Goal**: L'étudiant choisit un programme, remplit un panier, valide une commande, paie et accède au contenu.

**Independent Test**: Avec un catalogue présent, dérouler programme → catalogue → panier → commande → paiement et vérifier l'accès post-paiement.

### Tests for User Story 2

- [X] T020 [P] [US2] Test Jest catalogue étudiant (sessions inscriptibles, `places_restantes`) dans `apps/api/src/__tests__/professional-catalog-student.test.ts`
- [X] T021 [P] [US2] Test Jest panier/commande (prix figé, total = somme exacte) dans `apps/api/src/__tests__/professional-cart.test.ts`
- [X] T022 [P] [US2] Test Jest paiement : confirmation + idempotence du rejeu dans `apps/api/src/__tests__/professional-payment.test.ts`
- [X] T023 [P] [US2] Test Jest éligibilité serveur (fenêtre, capacité, double inscription) dans `apps/api/src/__tests__/professional-eligibility.test.ts`

### Implementation for User Story 2

- [X] T024 [US2] Implémenter le catalogue étudiant dans `apps/api/src/services/professional-enrollment.service.ts` (programmes ayant ≥1 matière inscriptible ; matières d'un programme avec sessions inscriptibles, `places_restantes`, état des prérequis)
- [X] T025 [US2] Implémenter le contrôle d'éligibilité dans `apps/api/src/services/professional-enrollment.service.ts` (statut `ouvert`, fenêtre, capacité, absence d'inscription active, prérequis satisfaits — lecture de `professional_subject_prerequisites`)
- [X] T026 [US2] Implémenter le panier dans `apps/api/src/services/professional-enrollment.service.ts` (commande `brouillon` courante, ajout/retrait de ligne, prix figé, recalcul du `montant_total`)
- [X] T027 [US2] Implémenter la validation de commande dans `apps/api/src/services/professional-enrollment.service.ts` (panier → `en_attente_paiement`, revérification d'éligibilité de toutes les lignes)
- [X] T028 [US2] Implémenter le paiement dans `apps/api/src/services/professional-payment.service.ts` (création/confirmation, idempotence `INSERT … ON CONFLICT`, commande → `payee`, inscriptions → `confirmee`, génération `receipt_number`/`receipt_url`)
- [X] T029 [US2] Implémenter les endpoints étudiant dans `apps/api/src/routes/professional.ts` (`GET /student/programmes`, `/student/catalog`, `/student/cart`, `POST /student/cart/items`, `DELETE /student/cart/items/:id`, `POST /student/orders`, `GET /student/orders`, `GET /student/orders/:id`, `POST /student/orders/:id/payment`, `GET /student/enrollments`, `GET /student/receipts/:id`) avec `requireStudent`
- [X] T030 [P] [US2] Créer le hook `apps/web/src/lib/hooks/use-professional-student.ts` (programmes, catalogue, panier, commandes, paiement, inscriptions)
- [X] T031 [P] [US2] Créer les pages web étudiant dans `apps/web/src/app/professionnel/etudiant/` (choix programme, catalogue, panier, commande/paiement, mes inscriptions)

**Checkpoint**: US1 + US2 livrent le **MVP** — vente à la carte de bout en bout.

---

## Phase 5: User Story 3 - Prérequis entre matières (Priority: P2)

**Goal**: L'admin définit des prérequis entre matières d'un même programme ; cycles et prérequis hors programme sont rejetés.

**Independent Test**: Définir matière B avec prérequis A ; vérifier que B est verrouillée tant que A n'est pas terminée, puis déverrouillée ; vérifier le rejet d'un cycle.

### Tests for User Story 3

- [X] T032 [P] [US3] Test Jest définition de prérequis : détection de cycle (DFS), rejet hors programme, rejet auto-référence dans `apps/api/src/__tests__/professional-prerequisites.test.ts`

### Implementation for User Story 3

- [X] T033 [US3] Implémenter la gestion des prérequis dans `apps/api/src/services/professional-catalog.service.ts` (get/set, détection de cycle par DFS, contrôle même programme, contrôle auto-référence)
- [X] T034 [US3] Implémenter les endpoints prérequis dans `apps/api/src/routes/professional.ts` (`GET/PUT /subjects/:id/prerequisites`) avec `requireAdmin`
- [X] T035 [US3] Ajouter la gestion des prérequis à la page admin des matières `apps/web/src/app/professionnel/admin/matieres/` (sélection des prérequis, affichage des erreurs de validation)

**Checkpoint**: les prérequis sont définissables ; le verrouillage (déjà construit en US2) est piloté par des données réelles.

---

## Phase 6: User Story 4 - Cycle de vie des sessions et achèvement (Priority: P2)

**Goal**: Automatisation du statut de session par la capacité, achèvement d'inscription débloquant les matières dépendantes, suivi admin.

**Independent Test**: Remplir une session jusqu'à capacité → `complet` ; annuler une inscription → retour `ouvert` ; marquer une inscription `terminee` → matière dépendante déverrouillée.

### Tests for User Story 4

- [X] T036 [P] [US4] Test Jest automatisation de capacité (`ouvert`↔`complet`, aucune sur-réservation en concurrence) dans `apps/api/src/__tests__/professional-capacity.test.ts`
- [X] T037 [P] [US4] Test Jest achèvement débloquant les matières dépendantes dans `apps/api/src/__tests__/professional-completion.test.ts`

### Implementation for User Story 4

- [X] T038 [US4] Implémenter l'automatisation de capacité dans `apps/api/src/services/professional-enrollment.service.ts` (verrou `SELECT … FOR UPDATE` sur la session, passage `complet` à capacité atteinte, retour `ouvert` à la libération si fenêtre valide)
- [X] T039 [US4] Implémenter l'achèvement d'inscription dans `apps/api/src/services/professional-enrollment.service.ts` (`complete` → `terminee`, uniquement si `confirmee`)
- [X] T040 [US4] Implémenter les endpoints de suivi et d'achèvement dans `apps/api/src/routes/professional.ts` (`GET /enrollments`, `GET /payments` avec `requireAdmin` ; `POST /enrollments/:id/complete` avec `requireAdmin` ou rôle `teacher`)
- [X] T041 [P] [US4] Créer les pages web admin de suivi dans `apps/web/src/app/professionnel/admin/suivi/` (inscriptions, paiements, taux de remplissage) + hook associé dans `apps/web/src/lib/hooks/use-professional-suivi.ts`

**Checkpoint**: le cycle de vie complet des sessions et l'achèvement sont opérationnels.

---

## Phase 7: User Story 5 - Suivi parent (Priority: P3)

**Goal**: Un parent consulte en lecture seule les inscriptions et paiements professionnels de son enfant.

**Independent Test**: Avec un enfant ayant des inscriptions professionnelles, ouvrir l'espace parent et vérifier l'affichage en lecture seule.

### Tests for User Story 5

- [X] T042 [P] [US5] Test Jest accès parent lecture seule + restriction au périmètre de l'enfant (via `student_parents`) dans `apps/api/src/__tests__/professional-parent.test.ts`

### Implementation for User Story 5

- [X] T043 [US5] Implémenter les requêtes parent dans `apps/api/src/services/professional-enrollment.service.ts` (inscriptions/paiements d'un enfant, vérification du lien parent-enfant via `student_parents`)
- [X] T044 [US5] Implémenter les endpoints parent dans `apps/api/src/routes/professional.ts` (`GET /parent/enrollments`, `GET /parent/payments`) avec `requireParent`
- [X] T045 [P] [US5] Créer les pages web parent dans `apps/web/src/app/parent/professionnel/` + hook `apps/web/src/lib/hooks/use-professional-parent.ts`

**Checkpoint**: les vues parent sont disponibles, sans aucune capacité d'écriture.

---

## Phase 8: User Story 6 - Accès enseignant aux sessions professionnelles (Priority: P3)

**Goal**: Un enseignant retrouve ses sessions professionnelles parmi ses cours (appel, supports, notes via les mécanismes existants).

**Independent Test**: Affecter un enseignant à une session professionnelle ; vérifier qu'elle apparaît dans ses cours avec accès appel/supports/notes.

### Implementation for User Story 6

- [X] T046 [US6] Investiguer le schéma réel des tables de présences / supports / notes et arrêter le mécanisme de rattachement à une session professionnelle (FK `professional_session_id` nullable vs liaison) ; consigner la décision dans `specs/028-professional-module/research.md` (addendum R3)
- [X] T047 [US6] Implémenter le rattachement des présences / supports / notes aux sessions professionnelles selon la décision T046 (migration complémentaire `0062_*` si une colonne/table est nécessaire, idempotente)
- [X] T048 [US6] Exposer les sessions professionnelles dans la liste des cours de l'enseignant (extension des routes/vues enseignant existantes `apps/api/src/routes/` et `apps/web/src/app/teacher/`)

**Checkpoint**: toutes les user stories sont indépendamment fonctionnelles.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Intégrations transverses et validation finale.

- [X] T049 [P] Étendre `apps/api/src/services/financial-reports.service.ts` pour agréger `professional_payments` dans les rapports de revenus (research R3)
- [X] T050 [P] Ajouter les entrées de navigation / menu par rôle pour la zone « professionnel » dans `apps/web/src/`
- [X] T051 [P] Mettre à jour `specs/028-professional-module/quickstart.md` et `contracts/professional-api.md` si les endpoints ont divergé pendant l'implémentation
- [X] T052 Vérifier la non-régression : routes `/formations-pro*`, `/sessions-pro`, `/inscriptions-pro`, `/paiements-pro` et module académique classique inchangés (`quickstart.md` §4)
- [X] T053 Exécuter le smoke test de bout en bout de `quickstart.md` §3 (17 étapes)
- [X] T054 [P] Exécuter `pnpm --filter @ecoledigitale/api test` et garantir le passage de tous les `professional-*.test.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: aucune dépendance — démarrage immédiat.
- **Foundational (Phase 2)**: dépend de Setup — **bloque toutes les user stories**.
- **User Stories (Phases 3–8)**: toutes dépendent de la fin de Foundational. Ordre de priorité recommandé : US1 → US2 → US3 → US4 → US5 → US6.
- **Polish (Phase 9)**: dépend des user stories souhaitées.

### User Story Dependencies

- **US1 (P1)** — aucune dépendance sur une autre story.
- **US2 (P1)** — testable indépendamment ; en pratique consomme un catalogue (fourni par US1 ou par des données de test).
- **US3 (P2)** — la définition des prérequis ; l'application/affichage du verrouillage est déjà bâti par US2. Indépendamment testable.
- **US4 (P2)** — automatisation capacité + achèvement ; consomme des inscriptions (US2). Indépendamment testable.
- **US5 (P3)** — consomme inscriptions/paiements (US2). Indépendamment testable avec données de test.
- **US6 (P3)** — indépendante ; comporte une tâche d'investigation (T046).

### ⚠️ Fichiers partagés entre stories (contrainte de parallélisme)

`apps/api/src/routes/professional.ts` est touché par US1–US5 ; `professional-catalog.service.ts` par US1 et US3 ; `professional-enrollment.service.ts` par US2, US4, US5. Les stories restent **indépendamment testables**, mais un travail en parallèle par plusieurs développeurs sur ces fichiers exige une coordination (ou un découpage ultérieur du fichier de routes par rôle, à l'image de `formations-pro.ts`/`sessions-pro.ts`).

### Within Each User Story

- Les tests (si retenus) sont écrits avant l'implémentation et doivent échouer d'abord.
- Services avant endpoints ; endpoints avant intégration web ; hooks avant pages.

### Parallel Opportunities

- Setup : T002, T003 en parallèle.
- Foundational : T005, T007, T008, T009, T010 en parallèle après T004/T006.
- Tests d'une même story (fichiers distincts) en parallèle.
- Hooks et pages web de stories distinctes en parallèle (fichiers distincts).

---

## Parallel Example: User Story 2

```bash
# Lancer ensemble les tests de US2 (fichiers distincts) :
Task: "Test Jest catalogue étudiant dans apps/api/src/__tests__/professional-catalog-student.test.ts"
Task: "Test Jest panier/commande dans apps/api/src/__tests__/professional-cart.test.ts"
Task: "Test Jest paiement/idempotence dans apps/api/src/__tests__/professional-payment.test.ts"
Task: "Test Jest éligibilité dans apps/api/src/__tests__/professional-eligibility.test.ts"

# Lancer ensemble le hook et les pages (fichiers distincts) après les endpoints :
Task: "Hook use-professional-student.ts dans apps/web/src/lib/hooks/"
Task: "Pages étudiant dans apps/web/src/app/professionnel/etudiant/"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 : Setup
2. Phase 2 : Foundational (**bloquant**)
3. Phase 3 : US1 — catalogue admin
4. Phase 4 : US2 — inscription étudiant
5. **STOP & VALIDATE** : MVP = vente à la carte de bout en bout. Démo possible.

> US1 seule ne constitue pas un produit utilisable par l'étudiant ; le MVP réel = **US1 + US2** (les deux stories P1).

### Incremental Delivery

1. Setup + Foundational → fondation prête.
2. + US1 + US2 → **MVP** (démo).
3. + US3 (prérequis) → démo.
4. + US4 (cycle de vie + suivi) → démo.
5. + US5 (parent), + US6 (enseignant) → fonctionnalité complète.

### Parallel Team Strategy

Après Foundational : US1 et US2 d'abord (P1). US3/US4/US5/US6 ensuite, en coordonnant les éditions de `routes/professional.ts` et des fichiers de service partagés (voir contrainte ci-dessus).

---

## Notes

- `[P]` = fichiers distincts, aucune dépendance non satisfaite.
- Le label `[Story]` assure la traçabilité tâche ↔ user story.
- Chaque user story est indépendamment complétable et testable.
- Vérifier l'échec des tests avant d'implémenter.
- Committer après chaque tâche ou groupe logique cohérent.
- S'arrêter à chaque checkpoint pour valider la story de façon isolée.
- Migration toujours idempotente et non destructive ; aucun breaking change sur les modules existants.

## Summary

| Phase | Story | Priorité | Tâches |
|---|---|---|---|
| 1 — Setup | — | — | T001–T003 (3) |
| 2 — Foundational | — | — | T004–T010 (7) |
| 3 — US1 Catalogue admin | US1 | P1 🎯 | T011–T019 (9) |
| 4 — US2 Inscription étudiant | US2 | P1 🎯 | T020–T031 (12) |
| 5 — US3 Prérequis | US3 | P2 | T032–T035 (4) |
| 6 — US4 Cycle de vie sessions | US4 | P2 | T036–T041 (6) |
| 7 — US5 Suivi parent | US5 | P3 | T042–T045 (4) |
| 8 — US6 Accès enseignant | US6 | P3 | T046–T048 (3) |
| 9 — Polish | — | — | T049–T054 (6) |

**Total : 54 tâches** · MVP (US1+US2) : 31 tâches (T001–T031) · Tests : 12 tâches.
