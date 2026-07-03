---
description: "Task list for Diplômes Professionnels implementation"
---

# Tasks: Diplômes Professionnels

**Input**: Design documents from `specs/029-professional-diplomas/`
**Branch**: `029-professional-diplomas`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/diplomas-api.md, quickstart.md

**Tests**: Des tâches de test sont incluses. Le brief de feature exige explicitement ≥ 30 tests Jest et une approche TDD pour le service (`spec.md` + brief §11, §13) ; la logique d'éligibilité/octroi est critique. Tous les tests vivent dans **un seul fichier** `apps/api/src/services/__tests__/professional-diplomas.service.test.ts` — les tâches de test de stories différentes y ajoutent des blocs `describe` et **ne sont donc pas parallélisables entre elles**.

**Organization**: Tâches groupées par user story (priorités P1→P3 de `spec.md`) pour une implémentation et un test indépendants.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: parallélisable (fichiers distincts, aucune dépendance sur une tâche non terminée)
- **[Story]**: user story rattachée (US1…US5)
- Chemins de fichiers exacts inclus dans chaque description

## Path Conventions

Monorepo pnpm : API `apps/api/src/`, web `apps/web/src/`, contrats `packages/contracts/src/`, migrations `infra/scripts/migrations/`, docs `docs/`. Feature **additive** sur le Module Professionnel `028` (research [R1](./research.md)).

**Note d'infrastructure** : la route proxy Next.js `apps/web/src/app/api/v1/professional/[...path]/route.ts` existe déjà (livrée par `028`) et couvre tous les endpoints `/api/v1/professional/*` — **aucune tâche de proxy n'est nécessaire**. Le préfixe est déjà dans `tenantRequiredPrefixes` et déjà enregistré après `authMiddleware` (research [R12](./research.md)).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Création des fichiers d'infrastructure de la feature.

- [X] T001 Écrire la migration `infra/scripts/migrations/0064_professional_diplomas.sql` — 3 tables (`professional_diplomas`, `professional_diploma_requirements`, `student_professional_diplomas`), policies RLS `{table}_tenant_isolation`, index et contraintes conformes à `data-model.md` ; idempotente (`CREATE … IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object`), non destructive, `id` en `uuid_generate_v4()` (research [R2](./research.md), [R3](./research.md), [R4](./research.md))
- [X] T002 [P] Rédiger le document de besoin métier `docs/module-professionnel-diplomes-requirements.md` (objectif, décisions D1–D11, règles métier, machine à états, hors périmètre — aligné sur `spec.md`)
- [X] T003 [P] Créer le runner de migration `scripts/apply-migration-0064-professional-diplomas.js` (calqué sur un `scripts/apply-migration-*.js` existant, lecture de `DATABASE_URL` / `DB_*`)
- [X] T004 [P] Créer le fichier de contrats `packages/contracts/src/professional-diplomas.ts` (squelette `import { z } from "zod"`) et ajouter son re-export dans `packages/contracts/src/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schéma appliqué, contrats, socle du service. **Aucune user story ne peut démarrer avant la fin de cette phase.**

**⚠️ CRITICAL**: bloque toutes les user stories.

- [X] T005 Appliquer la migration `0064` sur la base de dev (qui contient déjà les données `028`) et vérifier les 3 tables + `rowsecurity = true` (`quickstart.md` §1) — dépend de T001
- [X] T006 [P] Implémenter tous les schémas Zod et types dans `packages/contracts/src/professional-diplomas.ts` — enums `DiplomaStatutSchema` (`actif`/`inactif`), `StudentDiplomaStatutSchema` (`en_cours`/`obtenu`/`revoque`) ; `DiplomaCreateInputSchema` (uv_required entier > 0), `DiplomaUpdateInputSchema`, `DiplomaRequirementInputSchema`, `DiplomaRequirementsReplaceInputSchema`, `DiplomaAwardManualInputSchema` (`force` défaut `false`), `DiplomaRevokeInputSchema` (`motif` non vide) ; DTO `DiplomaDtoSchema`, `DiplomaDetailDtoSchema`, `DiplomaRequirementDtoSchema`, `StudentDiplomaDtoSchema`, `StudentDiplomaSummaryDtoSchema`, `DiplomaProgressDtoSchema`, `DiplomaAttestationDtoSchema` (champs snake_case, dates ISO — research [R13](./research.md), `contracts/diplomas-api.md`)
- [X] T007 [P] Ajouter les 8 nouveaux codes d'erreur à la table `ERROR_STATUS` de `apps/api/src/routes/professional.ts` : `DIPLOMA_NOT_FOUND` (404), `DUPLICATE_DIPLOMA_CODE` (409), `CROSS_PROGRAMME_REQUIREMENT` (422), `DIPLOMA_HAS_AWARDS` (409), `DIPLOMA_ALREADY_AWARDED` (409), `DIPLOMA_NOT_ELIGIBLE` (422), `DIPLOMA_NOT_AWARDED` (404), `INVALID_DIPLOMA_STATUS_TRANSITION` (422)
- [X] T008 Créer le squelette du service `apps/api/src/services/professional-diplomas.service.ts` — classe `ProfessionalDiplomasService extends ProfessionalBaseService` (réutilise `withTenant` / `withTenantTx` / `ok` / `fail` du socle `028`), signatures de toutes les méthodes publiques (`list`, `getById`, `create`, `update`, `delete`, `getRequirements`, `replaceRequirements`, `computeProgress`, `listStudentDiplomas`, `getAttestation`, `awardManual`, `revoke`, `listAwarded`, `recomputeForStudent`, `recomputeAllForDiploma`)
- [X] T009 Implémenter la fonction pure d'évaluation d'éligibilité exportée depuis `apps/api/src/services/professional-diplomas.service.ts` — entrées : liste d'exigences `{subject_id, nb_uv, est_obligatoire}` + ensemble des `subject_id` validés ; sortie : `{uv_validees, obligatoires_ok, eligible, matieres_validees[], matieres_restantes[], matieres_obligatoires_manquantes[]}` (matières DISTINCT, research [R6](./research.md)) — dépend de T008
- [X] T010 [P] Créer le squelette du fichier de tests `apps/api/src/services/__tests__/professional-diplomas.service.test.ts` (imports, fixtures partagées, mock du `Pool` `pg` / helpers de test communs)

**Checkpoint**: Fondation prête — les user stories peuvent démarrer.

---

## Phase 3: User Story 1 - Définition d'un diplôme et de ses exigences (Priority: P1) 🎯 MVP

**Goal**: Un administrateur crée un diplôme rattaché à un programme, le configure (libellé, UV à valider, statut) et compose sa liste d'exigences (matières du programme, drapeau obligatoire, ordre).

**Independent Test**: Créer un diplôme, lui attacher des exigences (dont une obligatoire), vérifier l'enregistrement et la consultation ; vérifier le rejet d'un code dupliqué et d'une exigence cross-programme.

### Tests for User Story 1

- [X] T011 [US1] Ajouter à `professional-diplomas.service.test.ts` les tests CRUD diplôme : validation Zod (code requis, `uv_required > 0`), rejet `DUPLICATE_DIPLOMA_CODE`, rejet d'une exigence cross-programme (`CROSS_PROGRAMME_REQUIREMENT`), rejet de suppression avec octrois (`DIPLOMA_HAS_AWARDS`), remplacement atomique des exigences

### Implementation for User Story 1

- [X] T012 [US1] Implémenter dans `professional-diplomas.service.ts` les méthodes CRUD diplôme : `list(filters)` (filtres `programme_id`/`statut`/`q`), `getById(id)` → `DiplomaDetailDto` (exigences + `uv_total_atteignable` + `nb_diplomes_octroyes`), `create(input)` (garde unicité code → `DUPLICATE_DIPLOMA_CODE`), `update(id, input)`, `delete(id)` (garde `DIPLOMA_HAS_AWARDS` si octroi non révoqué)
- [X] T013 [US1] Implémenter dans `professional-diplomas.service.ts` les méthodes d'exigences : `getRequirements(diplomaId)`, `replaceRequirements(diplomaId, items)` — transaction `withTenantTx`, `DELETE` puis `INSERT`, validation cohérence de programme de chaque `subject_id` (research [R9](./research.md), [R10](./research.md))
- [X] T014 [US1] Câbler dans `apps/api/src/routes/professional.ts` les routes admin (instancier `ProfessionalDiplomasService`, garde `requireAdmin`) : `GET /diplomas`, `POST /diplomas`, `GET /diplomas/:id`, `PATCH /diplomas/:id`, `DELETE /diplomas/:id`, `GET /diplomas/:id/requirements`, `PUT /diplomas/:id/requirements`
- [X] T015 [P] [US1] Créer les hooks TanStack Query CRUD + exigences dans `apps/web/src/lib/hooks/use-professional-diplomas.ts` : `useDiplomas`, `useDiploma`, `useCreateDiploma`, `useUpdateDiploma`, `useDeleteDiploma`, `useDiplomaRequirements`, `useReplaceDiplomaRequirements` (conventions de cache keys de `028`)
- [X] T016 [P] [US1] Créer l'écran liste `apps/web/src/app/professionnel/admin/diplomes/page.tsx` (table shadcn, filtres programme/statut/recherche)
- [X] T017 [P] [US1] Créer l'écran création `apps/web/src/app/professionnel/admin/diplomes/new/page.tsx` (formulaire Zod + react-hook-form)
- [X] T018 [P] [US1] Créer l'écran détail `apps/web/src/app/professionnel/admin/diplomes/[id]/page.tsx` (vue d'ensemble + exigences ; les sections « étudiants diplômés » et actions octroi/révocation sont ajoutées en US4)
- [X] T019 [P] [US1] Créer l'écran édition `apps/web/src/app/professionnel/admin/diplomes/[id]/edit/page.tsx`
- [X] T020 [US1] Créer l'éditeur d'exigences `apps/web/src/app/professionnel/admin/diplomes/[id]/exigences/page.tsx` (sélecteur des matières **du programme du diplôme** uniquement, drapeau obligatoire, ordre, total UV calculé en live avec avertissement si `Σ UV < uv_required`) — dépend de T015

**Checkpoint**: US1 fonctionnelle — un admin peut définir des diplômes et leurs exigences de bout en bout.

---

## Phase 4: User Story 2 - Octroi automatique à la détection d'éligibilité (Priority: P1)

**Goal**: À l'achèvement d'une inscription professionnelle (`terminee`), le système réévalue les diplômes concernés et octroie automatiquement ceux que l'étudiant satisfait, avec snapshot, sans doublon.

**Independent Test**: Pour un étudiant qui devient éligible, déclencher `POST /enrollments/:id/complete` et vérifier la création d'un octroi `obtenu` (`octroye_par: null`, référence, snapshot) ; rejouer → aucun doublon.

### Tests for User Story 2

- [X] T021 [US2] Ajouter à `professional-diplomas.service.test.ts` les tests d'éligibilité et d'octroi automatique : calcul du cumul d'UV (matière comptée une seule fois), refus si matière obligatoire manquante, octroi automatique correct, absence de doublon d'octroi, présence du `requirements_snapshot`, `recomputeAllForDiploma` idempotent, non-révocation automatique après modification du diplôme

### Implementation for User Story 2

- [X] T022 [US2] Implémenter dans `professional-diplomas.service.ts` : le helper interne d'octroi (génération `reference` `DIP-{année}-{séquence}` en transaction, `requirements_snapshot`, `uv_total_validees`, garde octroi unique non révoqué), `recomputeForStudent(studentId, subjectId)` et `recomputeAllForDiploma(diplomaId)` (research [R5](./research.md), [R7](./research.md), [R8](./research.md), [R11](./research.md))
- [X] T023 [US2] Modifier `apps/api/src/services/professional-enrollment.service.ts` — `completeEnrollment` : étendre le `RETURNING` (jointure `professional_subject_sessions`) pour exposer aussi `subject_id`. Changement strictement additif, aucun autre comportement modifié (research [R5](./research.md))
- [X] T024 [US2] Dans `apps/api/src/routes/professional.ts` : appeler `recomputeForStudent` en **best-effort** (`try/catch`, journalisation, n'altère pas la réponse) dans le handler de `POST /enrollments/:id/complete` **après** succès de `completeEnrollment` ; câbler la route `POST /diplomas/:id/recompute` (`requireAdmin`) → `recomputeAllForDiploma` (FR-020, research [R5](./research.md))
- [X] T025 [P] [US2] Ajouter le hook `useRecomputeDiploma` dans `use-professional-diplomas.ts` et un bouton « Recalculer l'éligibilité » sur l'écran détail admin `apps/web/src/app/professionnel/admin/diplomes/[id]/page.tsx`

**Checkpoint**: US2 fonctionnelle — l'octroi automatique se déclenche à chaque achèvement d'inscription, sans compromettre `028`.

---

## Phase 5: User Story 3 - Suivi de progression par l'étudiant (Priority: P2)

**Goal**: Un étudiant visualise sa progression vers chaque diplôme de ses programmes (UV cumulées, pourcentage, matières validées/restantes/obligatoires manquantes) et accède aux données d'attestation d'un diplôme obtenu.

**Independent Test**: Pour un étudiant partiellement avancé, appeler `GET /student/diplomas/:id/progress` et vérifier que les UV, le pourcentage et les listes de matières reflètent l'état réel des inscriptions.

### Tests for User Story 3

- [X] T026 [US3] Ajouter à `professional-diplomas.service.test.ts` les tests de `computeProgress` (pourcentage borné à 100, `matieres_validees`/`matieres_restantes`/`matieres_obligatoires_manquantes`, `eligible`) et de `listStudentDiplomas`

### Implementation for User Story 3

- [X] T027 [US3] Implémenter dans `professional-diplomas.service.ts` : `computeProgress(diplomaId, studentId)` → `DiplomaProgressDto` (réutilise la fonction pure T009), `listStudentDiplomas(studentId)` → `StudentDiplomaSummaryDto[]` (diplômes des programmes de l'étudiant + progression + octrois), `getAttestation(diplomaId, studentId)` → `DiplomaAttestationDto` (`DIPLOMA_NOT_AWARDED` si non obtenu)
- [X] T028 [US3] Câbler dans `apps/api/src/routes/professional.ts` les routes étudiant (`requireStudent`) : `GET /student/diplomas`, `GET /student/diplomas/:id/progress`, `GET /student/diplomas/:id/attestation`
- [X] T029 [P] [US3] Ajouter les hooks `useStudentDiplomas` et `useStudentDiplomaProgress` dans `use-professional-diplomas.ts`
- [X] T030 [P] [US3] Créer l'écran « Mes diplômes » `apps/web/src/app/professionnel/etudiant/diplomes/page.tsx` (cards : diplômes disponibles, % d'avancement, diplômes obtenus)
- [X] T031 [US3] Créer l'écran progression `apps/web/src/app/professionnel/etudiant/diplomes/[id]/page.tsx` (barre de progression UV, compteur `X / Y UV`, listes deux colonnes validées/à valider, obligatoires manquantes, lien attestation si obtenu) — dépend de T029

**Checkpoint**: US3 fonctionnelle — un étudiant suit sa progression précise vers ses diplômes.

---

## Phase 6: User Story 4 - Octroi et révocation manuels par l'administrateur (Priority: P2)

**Goal**: Un administrateur octroie manuellement un diplôme (avec `force` possible si non éligible) et révoque un diplôme obtenu avec un motif obligatoire.

**Independent Test**: Octroyer manuellement à un étudiant éligible ; refuser un octroi non éligible sans `force`, l'autoriser avec `force` ; révoquer avec motif et vérifier le statut `revoque` ; vérifier qu'un nouvel octroi redevient possible.

### Tests for User Story 4

- [X] T032 [US4] Ajouter à `professional-diplomas.service.test.ts` les tests d'octroi/révocation manuels : octroi manuel refusé si non éligible sans `force` (`DIPLOMA_NOT_ELIGIBLE`), autorisé avec `force`, refus de doublon (`DIPLOMA_ALREADY_AWARDED`), révocation refusée sans motif, révocation refusée sur diplôme non obtenu (`DIPLOMA_NOT_AWARDED`), révocation puis nouvel octroi autorisé

### Implementation for User Story 4

- [X] T033 [US4] Implémenter dans `professional-diplomas.service.ts` : `awardManual(diplomaId, studentId, opts)` (vérifie éligibilité sauf `force`, `octroye_par` = admin), `revoke(diplomaId, studentId, motif, revokedBy)` (motif requis, statut terminal `revoque`), `listAwarded(diplomaId)` → `StudentDiplomaDto[]`
- [X] T034 [US4] Câbler dans `apps/api/src/routes/professional.ts` les routes admin (`requireAdmin`) : `POST /diplomas/:id/award`, `POST /diplomas/:id/revoke`, `GET /diplomas/:id/awarded`
- [X] T035 [P] [US4] Ajouter les hooks `useDiplomaAwarded`, `useAwardDiploma`, `useRevokeDiploma` dans `use-professional-diplomas.ts`
- [X] T036 [US4] Compléter l'écran détail admin `apps/web/src/app/professionnel/admin/diplomes/[id]/page.tsx` : liste des étudiants diplômés + actions d'octroi manuel (avec case `force`) et de révocation (motif obligatoire) — dépend de T035

**Checkpoint**: US4 fonctionnelle — l'admin dispose du contrôle manuel complet sur les octrois.

---

## Phase 7: User Story 5 - Consultation parent (Priority: P3)

**Goal**: Un parent consulte en lecture seule les diplômes obtenus et la progression des diplômes en cours de son enfant.

**Independent Test**: Pour un enfant avec un diplôme obtenu et un en cours, ouvrir l'espace parent et vérifier l'affichage en lecture seule ; vérifier le rejet `FORBIDDEN` pour un enfant non rattaché.

### Tests for User Story 5

- [X] T037 [US5] Ajouter à `professional-diplomas.service.test.ts` les tests d'accès parent : rejet `FORBIDDEN` si `child_id` n'est pas un enfant du parent, accès autorisé sinon

### Implementation for User Story 5

- [X] T038 [US5] Implémenter dans `professional-diplomas.service.ts` la lecture parent : vérification du rattachement parent-enfant via `student_parents`, puis réutilisation de `listStudentDiplomas` pour l'enfant
- [X] T039 [US5] Câbler dans `apps/api/src/routes/professional.ts` la route `GET /parent/diplomas?child_id=` (`requireParent`, `403 FORBIDDEN` si enfant non rattaché)
- [X] T040 [P] [US5] Ajouter le hook `useParentChildDiplomas(childId)` dans `use-professional-diplomas.ts`
- [X] T041 [US5] Créer l'écran `apps/web/src/app/parent/professionnel/diplomes/page.tsx` (sélecteur d'enfant + affichage lecture seule identique à l'étudiant) — dépend de T040

**Checkpoint**: Toutes les user stories sont indépendamment fonctionnelles.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Validation transverse et non-régression.

- [X] T042 [P] Lancer `pnpm --filter @ecoledigitale/api exec jest professional` et atteindre ≥ 100 tests verts (72 existants `028` + ≥ 30 nouveaux) ; corriger toute régression
- [X] T043 Dérouler le smoke test `quickstart.md` §3 (31 étapes) et les vérifications de non-régression §4 (parcours `028` intact, `completeEnrollment` renvoie `terminee` même si le recompute échoue, aucune table `028` modifiée)
- [X] T044 [P] Vérifier les 11 critères de succès `SC-001`–`SC-011` de `spec.md` (octroi auto, pas de doublon, refus non éligible, motif requis, cross-programme, suppression protégée, snapshot stable, isolation tenant, progression, non-régression, aucun accès enseignant)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** : aucune dépendance — démarrage immédiat.
- **Foundational (Phase 2)** : dépend de Setup. **Bloque toutes les user stories.** T005 dépend de T001 ; T009 dépend de T008.
- **User Stories (Phases 3–7)** : dépendent toutes de la fin de Foundational.
  - US1 (P1) et US2 (P1) : indépendantes l'une de l'autre côté API (méthodes distinctes du même service, fichier partagé → sérialiser les éditions du service).
  - US3, US4, US5 : indépendantes ; US3 et US4 réutilisent la fonction pure T009 ; US5 réutilise `listStudentDiplomas` (T027 d'US3) — si US5 est faite avant US3, implémenter d'abord `listStudentDiplomas`.
- **Polish (Phase 8)** : dépend de toutes les user stories visées.

### User Story Dependencies

- **US1 (P1)** : démarre après Foundational. Aucune dépendance sur une autre story.
- **US2 (P1)** : démarre après Foundational. Indépendante d'US1.
- **US3 (P2)** : démarre après Foundational. Indépendante.
- **US4 (P2)** : démarre après Foundational. T036 enrichit l'écran détail créé en US1 (T018) — si US4 précède US1, créer l'écran détail au préalable.
- **US5 (P3)** : démarre après Foundational. Réutilise `listStudentDiplomas` (US3).

### Contraintes de fichiers partagés (sérialiser, NON parallélisables entre elles)

- `professional-diplomas.service.ts` : T008 → T009 → T012/T013 (US1) → T022 (US2) → T027 (US3) → T033 (US4) → T038 (US5).
- `professional-diplomas.service.test.ts` : T010 → T011 → T021 → T026 → T032 → T037.
- `apps/api/src/routes/professional.ts` : T007 → T014 (US1) → T024 (US2) → T028 (US3) → T034 (US4) → T039 (US5).
- `use-professional-diplomas.ts` : T015 (US1) → T025 → T029 → T035 → T040.

### Within Each User Story

- Les tests sont écrits **avant** l'implémentation (TDD) et doivent échouer d'abord.
- Service avant routes ; routes avant hooks ; hooks avant écrans qui en dépendent.

### Parallel Opportunities

- Setup : T002, T003, T004 en parallèle (T001 indépendant peut aussi tourner en même temps).
- Foundational : T006, T007, T010 en parallèle (fichiers distincts) ; T008/T009 sur le service à part.
- Les **écrans web** d'une même story sont parallélisables entre eux (fichiers `page.tsx` distincts) : T016/T017/T018/T019 (US1) ; T030 (US3) ; etc.
- Une fois Foundational terminée, les stories peuvent être menées par des développeurs distincts, à condition de sérialiser les éditions des 4 fichiers partagés ci-dessus.

---

## Parallel Example: User Story 1

```bash
# Écrans admin US1 — fichiers page.tsx distincts, parallélisables :
Task T016: "Écran liste apps/web/src/app/professionnel/admin/diplomes/page.tsx"
Task T017: "Écran création apps/web/src/app/professionnel/admin/diplomes/new/page.tsx"
Task T018: "Écran détail apps/web/src/app/professionnel/admin/diplomes/[id]/page.tsx"
Task T019: "Écran édition apps/web/src/app/professionnel/admin/diplomes/[id]/edit/page.tsx"

# Les hooks (T015) tournent en parallèle des écrans ; T020 (éditeur d'exigences) attend T015.
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2)

1. Phase 1 : Setup.
2. Phase 2 : Foundational (CRITIQUE — bloque tout).
3. Phase 3 : US1 — définition des diplômes et exigences.
4. Phase 4 : US2 — octroi automatique. **US1 + US2 = MVP** : un établissement peut publier ses diplômes et le système les octroie automatiquement.
5. **STOP et VALIDER** : tester US1 + US2 indépendamment (`quickstart.md` §3a–3c).

### Incremental Delivery

1. Setup + Foundational → fondation prête.
2. US1 → test → diplômes définissables.
3. US2 → test → octroi automatique opérationnel (MVP livrable).
4. US3 → test → suivi de progression étudiant.
5. US4 → test → contrôle manuel admin.
6. US5 → test → consultation parent.
7. Polish → jest ≥ 100 vert, quickstart, critères de succès.

### Parallel Team Strategy

Après Foundational, avec plusieurs développeurs : un dév par story, en sérialisant les éditions des 4 fichiers partagés (service, fichier de tests, routes, hooks) — idéalement via de petits commits fréquents par tâche.

---

## Notes

- [P] = fichiers distincts, aucune dépendance sur une tâche non terminée.
- Le fichier de tests et le fichier de service étant uniques, les tâches qui les touchent sont sérialisées même entre stories (voir « Contraintes de fichiers partagés »).
- Feature **strictement additive** sur `028` : seuls 2 fichiers existants sont modifiés — `professional.ts` (routes + codes d'erreur, additif) et `professional-enrollment.service.ts` (T023, `RETURNING` additif). Aucune table existante n'est modifiée.
- Vérifier que les tests échouent avant d'implémenter.
- Commit après chaque tâche ou groupe logique.
- S'arrêter à chaque checkpoint pour valider la story indépendamment.
