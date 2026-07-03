---
description: "Task list — Restructuration pédagogique Filière → UE → ECUE"
---

# Tasks: Restructuration pédagogique — Filière → UE → ECUE

**Input**: Design documents from `specs/030-pedagogie-ue-ecue/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: inclus — la spec exige (SC-008) que les suites professional-* passent
sur le nouveau modèle ; les tâches de test adaptent les suites Jest existantes.

**Organization**: par user story (US1–US4) pour livraison incrémentale.

## Format: `[ID] [P?] [Story] Description`

- **[P]** : parallélisable (fichiers différents, sans dépendance bloquante)
- **[Story]** : US1..US4 (phases user story uniquement)

## Path Conventions

- DB : `infra/scripts/migrations/`, runners `scripts/`
- Contrats : `packages/contracts/src/`
- API : `apps/api/src/routes|services|middlewares`, tests `apps/api/src/__tests__`
- Web : `apps/web/src/app|components`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: préparer la branche et les emplacements de fichiers.

- [X] T001 Vérifier la branche `030-pedagogie-ue-ecue` active et `.specify/feature.json` pointant sur `specs/030-pedagogie-ue-ecue` (déjà fait par /speckit-specify)
- [X] T002 [P] Recenser les usages des symboles obsolètes à renommer → `specs/030-pedagogie-ue-ecue/_impact.txt` (API : routes + 7 services + 2 tests ; web : ~10 fichiers ; seeds : 2)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schéma DB + contrats Zod + socle d'erreurs/gardes. **BLOQUE toutes les user stories.**

**⚠️ CRITICAL**: aucune US ne peut démarrer avant cette phase.

### Base de données

- [X] T003 Écrire `infra/scripts/migrations/0069_pedagogie_ue_ecue.sql` : en-tête d'avertissement (destructif, D13) + `DROP` ordonné (filles→parents) des tables `professional_session_attendance`, `professional_session_materials`, `professional_subject_material_views`, `professional_subject_materials`, `professional_assignment_question_answers`→ conserver via repoint (voir T004), `professional_subject_prerequisites`, `professional_subject_sessions` puis `professional_subjects` (avec `CASCADE`)
- [X] T004 Dans `0069` : créer les 10 tables cibles (`professional_ue`, `professional_ecue`, `professional_ue_ecue`, `professional_ue_prerequisites`, `professional_ue_sessions`, `professional_ecue_seances`, `professional_ecue_attendance`, `professional_ecue_materials` + `…_material_views`, `professional_ecue_results`, `student_professional_ue_results`) avec colonnes/contraintes/index de `data-model.md`, RLS + policy `app.tenant_id` (patron 0061)
- [X] T005 Dans `0069` : repointer/recréer `professional_assignments` (`professional_subject_id`→`ecue_id`, `session_id`→`ue_session_id`) en conservant ses colonnes étendues (0067) et ses filles `…_questions`/`…_submissions`/`…_question_answers` ; repointer `professional_enrollments` (`session_id`→`ue_session_id`, index unique actif) ; `professional_diplomas` (`programme_id`→`filiere_id`) ; `professional_diploma_requirements` (`subject_id`→`ue_id`, `UNIQUE (diploma_id, ue_id)`)
- [X] T006 Dans `0069` : altérer `live_sessions` — `DROP COLUMN professional_subject_session_id` (+ index), `ADD COLUMN professional_ecue_seance_id`, recalculer `live_sessions_exactly_one_parent` (3 colonnes) + index
- [X] T007 Runner `scripts/apply-migration-0069-pedagogie-ue-ecue.js` créé et **exécuté en dev** ✅ : 21 tables pro (10 nouvelles + repointées), tables `subject*`/`session*` supprimées, `live_sessions.professional_ecue_seance_id` en place

### Contrats partagés

- [X] T008 [P] `packages/contracts/src/professional.ts` : renommer `ProfessionalSubject*` → `ProfessionalEcue*` (retirer `prix`/`nb_uv`/`programme_id` de l'ECUE) ; ajouter `ProfessionalUe*` (avec `filiere_id`/`prix`/`devise`/`nb_uv`/`statut`), `ProfessionalUeEcue*` (liaison : `est_obligatoire`/`coefficient`/`ordre`), `ProfessionalUePrerequisite*`, `ProfessionalUeSession*`, `ProfessionalEcueSeance*`, `ProfessionalEcueAttendance*`, `ProfessionalEcueResult*`
- [X] T009 [P] `packages/contracts/src/professional-diplomas.ts` : `DiplomaRequirement` → `ue_id` ; `professional_diplomas` → `filiere_id` ; ajouter `StudentProfessionalUeResult*`
- [X] T010 `packages/contracts/src/index.ts` : barrel `export *` propage les nouveaux schémas (anciens `*Subject*` retirés) ; `pnpm --filter @ecoledigitale/contracts type-check` ✅ zéro erreur TS

### Socle API

- [X] T011 `apps/api/src/routes/professional.ts` : étendre `ERROR_STATUS` avec les codes de `contracts/professional-ue-ecue-api.md` §9 (`ECUE_NOT_FOUND`, `UE_NOT_FOUND`, `UE_INACTIVE`, `UE_ECUE_LINK_EXISTS`, `ECUE_STILL_LINKED`, `UE_PREREQ_NOT_SAME_FILIERE`, `UE_PREREQ_CYCLE`, `UE_PREREQ_NOT_VALIDATED`, `UE_SESSION_NOT_FOUND`, `SEANCE_NOT_FOUND`, `ECUE_RESULT_NOT_FOUND`, `DIPLOMA_UE_NOT_SAME_FILIERE`)
- [X] T012 [P] Ajouter la constante partagée `ECUE_VALIDATION_THRESHOLD = 10` (ex. `apps/api/src/services/professional-base.service.ts` ou un module de constantes pro)

**Checkpoint**: schéma + contrats + socle prêts — les user stories peuvent démarrer.

---

## Phase 3: User Story 1 — Référentiel Filière → UE → ECUE (Priority: P1) 🎯 MVP

**Goal**: un admin crée Filière → UE → ECUE, compose une UE (coefficient/obligatoire/ordre) avec ECUE mutualisées, et gère les prérequis UE.

**Independent Test**: créer une UE (prix/UV) + 2 ECUE, composer l'UE, rattacher une ECUE à une 2ᵉ UE d'une autre filière, définir un prérequis UE.

### Service & API

- [X] T013 [US1] `apps/api/src/services/professional-catalog.service.ts` : basculer la sémantique Subject→ECUE (CRUD ECUE : `code`/`libelle`/`description`/`bilan_type_id`/`statut`, **sans** prix/UV ; table `professional_ecue`) ; conserver l'arbre catalogue
- [X] T014 [US1] Créer `apps/api/src/services/professional-ue.service.ts` héritant de `ProfessionalBaseService` : CRUD UE (`professional_ue`, validation `filiere_id`), garde « UE inactive »
- [X] T015 [US1] Dans `professional-ue.service.ts` : composition UE↔ECUE (`professional_ue_ecue` : add/update/remove liaison, `UNIQUE (ue_id, ecue_id)`, mutualisation inter-filières autorisée), refus suppression ECUE encore liée
- [X] T016 [US1] Dans `professional-ue.service.ts` : prérequis UE (`professional_ue_prerequisites`) avec validations **même filière** + **acyclique** (DFS) + anti-auto-référence
- [X] T017 [US1] `apps/api/src/routes/professional.ts` : routes `/ecue*` (ex-`/subjects`) et `/ue*` (CRUD UE, `/ue/:id/ecue`, `/ue/:id/prerequisites`) sous gardes admin (cf. contrat §1–§2)

### Web (admin)

- [X] T018 [P] [US1] Écran admin **ECUE** ✅ : pages `matieres/page.tsx` (liste), `matieres/new`, `matieres/[id]`, `matieres/[id]/edit` converties en ECUE (sans prix/UV/programme) ; hook materials repointé `/ecue`. Type-check OK.
- [X] T019 [P] [US1] Écran admin **UE** ✅ : `ue/page.tsx` (liste, filtre filière, prix/UV), `ue/new`, `ue/[id]/edit`, `ue/[id]` (détail = **composition UE↔ECUE** add/remove coef/obligatoire/ordre + **prérequis UE** même-filière + **cohortes** create/list). Nav Sidebar : UE + ECUE. Type-check OK.
- [X] T020 [US1] Hook `use-professional-catalog-admin.ts` réécrit (ECUE+UE+composition+prérequis+cohortes+séances+résultats) ✅

### Tests

- [X] T021 [P] [US1] Renommer/adapter `apps/api/src/__tests__/professional-subjects.test.ts` → `professional-ecue.test.ts` (ECUE sans prix/UV)
- [X] T022 [P] [US1] Adapter `apps/api/src/__tests__/professional-prerequisites.test.ts` au niveau **UE** (même filière + acyclique) ; ajouter un test de composition/mutualisation UE↔ECUE

**Checkpoint**: référentiel complet et testable indépendamment.

---

## Phase 4: User Story 2 — Inscription à une UE et accès aux ECUE (Priority: P1)

**Goal**: l'étudiant achète une UE (cohorte) au prix de l'UE et accède à toutes ses ECUE ; prérequis UE contrôlés.

**Independent Test**: inscrire à une cohorte UE ouverte, payer, vérifier l'accès aux ECUE ; vérifier le blocage par prérequis non validés.

### Service & API

- [X] T023 [US2] Dans `professional-ue.service.ts` : cohortes UE (`professional_ue_sessions`) CRUD + machine à états + garde « UE inactive → pas de cohorte »
- [X] T024 [US2] `apps/api/src/services/professional-enrollment.service.ts` : repointer sur `ue_session_id`, `prix_unitaire = ue.prix`, contrôle des prérequis UE (`student_professional_ue_results.statut='validee'`), unicité d'inscription active
- [X] T025 [US2] `professional-catalog.service.ts` (volet étudiant) : catalogue Filière → UE inscriptibles → ECUE (UE `actif` + cohorte fenêtre ouverte) ; endpoint d'accès aux ECUE débloquées
- [X] T026 [US2] `apps/api/src/routes/professional.ts` : routes `/ue/:id/sessions`, `/ue-sessions/:id*`, `/student/catalog`, `/student/cart*`, `/student/orders*`, `/student/enrollments`, `/student/ue/:ueSessionId/ecue` (cf. contrat §3, §7)

### Web (étudiant)

- [X] T027 [P] [US2] Catalogue étudiant par **UE** + page détail UE (prix, ECUE incluses, cohortes)
- [X] T028 [P] [US2] Panier/commande/paiement à l'**UE** ; après confirmation, accès aux ECUE de l'UE
- [X] T029 [US2] Écran admin **cohortes d'UE** (dates, fenêtre, capacité, statut)

### Tests

- [X] T030 [P] [US2] Adapter `professional-sessions.test.ts` → cohortes UE ; `professional-cart.test.ts` (prix UE) ; `professional-capacity.test.ts`
- [X] T031 [P] [US2] Adapter `professional-eligibility.test.ts` (prérequis UE) et `professional-catalog-student.test.ts` (catalogue par UE)

**Checkpoint**: parcours commercial UE complet et testable.

---

## Phase 5: User Story 3 — Pédagogie au niveau ECUE (Priority: P2)

**Goal**: supports/devoirs/notes par ECUE ; séances par ECUE dans une cohorte ; présence par séance ; visios sur la séance.

**Independent Test**: déposer un support ECUE, créer un devoir ECUE, planifier une séance, marquer une présence, créer une visio.

### Service & API

- [X] T032 [US3] Renommer `apps/api/src/services/professional-subject-materials.service.ts` → `professional-ecue-materials.service.ts` (FK `ecue_id`, traces de lecture)
- [X] T033 [US3] `apps/api/src/services/professional-assignments.service.ts` : repointer création/listing sur `ecue_id` + `ue_session_id?` (contexte) ; corriger `ai_source_material_ids` (→ supports ECUE)
- [X] T034 [US3] Dans `professional-ue.service.ts` (ou nouveau `professional-seances`) : séances ECUE (`professional_ecue_seances`) + présence (`professional_ecue_attendance`, unicité séance/étudiant)
- [X] T035 [US3] `apps/api/src/services/professional-live-sessions.service.ts` : rattacher la visio à `professional_ecue_seance_id` (au lieu de la session de matière)
- [X] T036 [US3] `apps/api/src/routes/professional.ts` : routes `/ecue/:id/materials*`, `/ecue/:id/assignments`, `/ue-sessions/:id/seances`, `/seances/:seanceId*` (attendance, live-sessions) (cf. contrat §4, §5)

### Web (enseignant/admin)

- [X] T037 [P] [US3] Écran supports/devoirs **par ECUE** (renommer les écrans « matière »)
- [X] T038 [P] [US3] Écran **séances** d'une cohorte + **fiche de présence par séance** ; rattachement visio à la séance

### Tests

- [X] T039 [P] [US3] Adapter les tests d'évaluations/présence au modèle ECUE/séance ; vérifier l'auto-correction QCM inchangée

**Checkpoint**: pédagogie ECUE opérationnelle.

---

## Phase 6: User Story 4 — Validation ECUE/UE, UV & diplôme (Priority: P2)

**Goal**: consolidation des résultats ECUE (auto ≥10/20 ou manuel), validation UE (toutes ECUE obligatoires) → octroi UV, diplôme composé d'UE.

**Independent Test**: valider toutes les ECUE obligatoires d'une UE → UV capitalisées ; valider manuellement une ECUE en échec ; obtenir un diplôme.

### Service & API

- [X] T040 [US4] Créer `apps/api/src/services/professional-results.service.ts` : calcul `moyenne` ECUE (depuis copies/notes, pondérée par coefficient), `validee` = `moyenne ≥ ECUE_VALIDATION_THRESHOLD` OU `validee_manuellement` ; persistance `professional_ecue_results`
- [X] T041 [US4] Dans `professional-results.service.ts` : validation UE (toutes ECUE obligatoires validées, **sans compensation**) → upsert `student_professional_ue_results` (`statut='validee'`, `uv_acquises=ue.nb_uv`) ; endpoint de validation manuelle (override tracé `valide_par`)
- [X] T042 [US4] `apps/api/src/services/professional-diplomas.service.ts` : exigences = **UE** (`ue_id`, validation même filière) ; `uv_total_validees` agrégé depuis `student_professional_ue_results` ; recalcul d'éligibilité (UV + UE obligatoires)
- [X] T043 [US4] `apps/api/src/routes/professional.ts` : routes `/ue-sessions/:id/results*`, `/ecue-results/:resultId/validate`, `/students/:studentId/ue-results`, `/diplomas/:id/requirements` (UE) (cf. contrat §6, §8)

### Web

- [X] T044 [P] [US4] Écran résultats cohorte (moyennes ECUE, validation manuelle) + capitalisation UV par UE
- [X] T045 [P] [US4] Écran admin **diplôme = UE** (exigences) + progression étudiant (UV)

### Tests

- [X] T046 [P] [US4] Adapter `apps/api/src/services/__tests__/professional-diplomas.service.test.ts` (exigences UE, UV par UE) ; `professional-completion.test.ts` (validation UE → diplôme)
- [X] T047 [P] [US4] Ajouter des tests de validation ECUE (seuil 10/20 + override manuel) et de validation UE (toutes obligatoires, sans compensation)

**Checkpoint**: boucle UV → diplôme complète.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T048 [P] Réécrire `scripts/seed-professional-module-029.js` sur le modèle Filière→UE→ECUE (UE avec prix/UV, ECUE mutualisée, liaisons, cohortes, séances)
- [X] T049 [P] Réécrire `scripts/seed-professional-session-evaluations.js` (évaluations ECUE + résultats + validation UE)
- [X] T050 Mettre à jour la doc : `docs/modele-donnees-pedagogique-matiere.md` (ou nouveau doc UE/ECUE) et la mémoire [[pedagogy-ue-ecue-restructure]]
- [~] T051 Cœur **propre** : `apps/api/src`, `apps/web/src`, `packages` — 0 occurrence résiduelle `professional_subject*`/`session*`. **Restent** 2 scripts de dev ad-hoc hors périmètre (`apps/api/scripts/seed-more-evaluations.js`, `seed-online-evaluation.js`) encore sur l'ancien schéma — à repointer séparément.
- [X] T052 Exécuter la validation `quickstart.md` (parcours admin → étudiant → enseignant → diplôme) et lancer `pnpm --filter @ecoledigitale/api test -- professional` (toutes suites vertes — SC-008)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Ph1)** : immédiat.
- **Foundational (Ph2)** : dépend de Ph1 — **BLOQUE** toutes les US. La DB (T003–T007) précède les services ; les contrats (T008–T010) précèdent l'API.
- **US1 (Ph3)** : après Ph2.
- **US2 (Ph4)** : après Ph2 ; T024 (enrollment) dépend de T023 (cohortes) et de la notion de validation UE (lecture de `student_professional_ue_results`, écrite en US4 — le contrôle de prérequis tolère l'absence de résultats = non validé).
- **US3 (Ph5)** : après Ph2 ; indépendante de US2 (pédagogie).
- **US4 (Ph6)** : après Ph2 ; consomme les notes (US3) et alimente les prérequis (US2) et le diplôme.
- **Polish (Ph7)** : après les US visées.

### Within Each User Story

- Services avant routes ; routes avant écrans web ; tests adaptés en fin de story.

### Parallel Opportunities

- T008/T009 (contrats) en parallèle ; T018/T019, T027/T028, T037/T038, T044/T045 (écrans web) en parallèle ; toutes les tâches de test [P] en parallèle.

---

## Implementation Strategy

### MVP (US1 + US2)

1. Ph1 Setup → Ph2 Foundational (DB + contrats) — **critique**.
2. Ph3 US1 (référentiel) → valider.
3. Ph4 US2 (achat UE + accès ECUE) → valider : MVP commercial.

### Incrémental

US3 (pédagogie) puis US4 (validation/UV/diplôme), chacune testée indépendamment, puis Polish (seeds, doc, suite de tests complète).

---

## Notes

- Migration `0069` **destructive** (D13) : à n'exécuter qu'en dev/seed.
- Mutualisation ECUE **inter-filières** : pas de contrainte filière sur la liaison ; « même filière » sur prérequis UE et diplôme.
- Seuil ECUE 10/20 **figé** + override manuel ; validation UE **sans compensation**.
- Rupture directe des endpoints (`/subjects`→`/ecue`, `/sessions`→`/ue-sessions`) : mettre à jour le web dans la même story.
