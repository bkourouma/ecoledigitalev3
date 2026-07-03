# Modèle de données pédagogique — la « Matière » et ses tables liées

> Objectif : donner une vue d'ensemble des modèles de données pédagogiques
> d'EcoleDigitale, en partant de l'entité centrale **Matière** et de toutes les
> tables qui gravitent autour (sessions, supports, évaluations, prérequis,
> diplômes…).
>
> Conventions communes à toutes les tables décrites :
> `id UUID PK`, `tenant_id UUID NOT NULL → tenants(id)` (isolation multi-tenant
> par **Row-Level Security**, GUC `app.tenant_id`), `created_at` / `updated_at`
> en `TIMESTAMPTZ`. Migrations idempotentes et non destructives.

---

## 1. Deux notions de « Matière » dans le système

EcoleDigitale distingue deux filières pédagogiques, chacune avec sa propre
entité « matière » :

| Notion | Table | Filière | Migration |
|---|---|---|---|
| **Matière académique** (cours d'un cursus diplômant classique) | `courses` | Académique (cycles → programmes → UE → cours) | `0002_academic.sql` |
| **Matière professionnelle** (module « à la carte » payant) | `professional_subjects` | Module Professionnel (features 028 / 029) | `0061_professional_module.sql` |

La suite du document détaille principalement la **matière professionnelle**
(`professional_subjects`), qui est le cœur des features actives 028 / 029 et
autour de laquelle gravite le plus grand nombre de tables. La matière
académique est rappelée en §7.

---

## 2. Carte relationnelle de la matière professionnelle

```text
                       programmes
                           │ (programme_id)
                           ▼
   professional_subject_prerequisites ──┐ (graphe acyclique des prérequis)
                           ▲            │
                           └──────< professional_subjects >── bilan_types (bilan_type_id)
                                          │
        ┌─────────────────┬──────────────┼─────────────────────┬─────────────────────┐
        ▼                 ▼              ▼                      ▼                     ▼
professional_      professional_   professional_        professional_         professional_diploma_
subject_sessions   subject_        assignments          subject_materials     requirements
   │               materials          │                     │                     │
   │               (supports          │                     ▼                     ▼
   │                pérennes)         ▼              professional_subject_   professional_diplomas
   │                          professional_          material_views               │
   ▼                          assignment_questions   (traces de lecture)          ▼
professional_session_                │                              student_professional_diplomas
materials (par session)              ▼
professional_session_         professional_assignment_submissions
attendance (présences)               │
   │                                 ▼
   ▼                          professional_assignment_question_answers
professional_enrollments  >──  professional_orders ──< professional_payments
(via session)
```

**Lecture** : une `programme` contient des `professional_subjects` (matières).
Chaque matière porte des **sessions** (occurrences datées et inscriptibles),
des **supports de cours**, des **évaluations**, des **prérequis** vers d'autres
matières, et peut être **comptabilisée dans un diplôme**.

---

## 3. Entité centrale — `professional_subjects` (Matière professionnelle)

`infra/scripts/migrations/0061_professional_module.sql` (+ `0063` pour
`bilan_type_id`).

| Champ | Type | Contraintes / sens |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `programme_id` | uuid | NOT NULL → `programmes(id)` — rattachement au cursus |
| `code` | text | NOT NULL ; **UNIQUE (`tenant_id`, `code`)** |
| `libelle` | text | NOT NULL — intitulé de la matière |
| `description` | text | NULL |
| `nb_uv` | integer | NOT NULL DEFAULT 0 ; `CHECK (nb_uv >= 0)` — nb d'unités de valeur |
| `prix` | numeric(14,2) | NOT NULL DEFAULT 0 ; `CHECK (prix >= 0)` — base de facturation |
| `statut` | text | DEFAULT `'actif'` ; `CHECK IN ('actif','inactif')` |
| `bilan_type_id` | uuid | NULL → `bilan_types(id)` — type de bulletin/bilan (ajout `0063`) |
| `created_at` / `updated_at` | timestamptz | DEFAULT now() |

**Règles métier**
- `programme_id` obligatoire ; une matière appartient à un seul programme.
- Une matière `inactif` n'accepte plus de **nouvelles sessions** (contrôle applicatif).
- `prix` est la base du calcul du montant des commandes (figé à l'ajout au panier).
- `nb_uv` : unités de valeur capitalisées par l'étudiant → servent à valider un diplôme (§6).

**Index** : `(tenant_id, programme_id)`, `(tenant_id, statut)`, `(tenant_id, bilan_type_id)`.

---

## 4. Tables directement liées à la Matière

### 4.1 `professional_subject_prerequisites` — Prérequis entre matières
`0061`. Graphe orienté des dépendances entre matières d'un même programme.

| Champ | Type | Sens |
|---|---|---|
| `professional_subject_id` | uuid → `professional_subjects(id)` CASCADE | la matière **qui exige** |
| `prerequisite_subject_id` | uuid → `professional_subjects(id)` CASCADE | la matière **prérequise** |

- `CHECK (professional_subject_id <> prerequisite_subject_id)` — pas d'auto-référence.
- `UNIQUE (tenant_id, professional_subject_id, prerequisite_subject_id)` — pas de doublon d'arête.
- **Validations applicatives** : les deux matières doivent être du **même programme** ; l'ajout d'une arête **ne doit pas créer de cycle** (détection DFS).
- Sémantique : une matière a `0..n` prérequis, tous à satisfaire (logique **ET**).

### 4.2 `professional_subject_sessions` — Session / Cours (occurrence inscriptible)
`0061`. Une matière a `0..n` sessions datées ; c'est l'objet auquel l'étudiant s'inscrit.

| Champ | Type | Sens |
|---|---|---|
| `professional_subject_id` | uuid → `professional_subjects(id)` CASCADE | matière parente |
| `libelle` | text | ex. « Session Janvier 2026 » |
| `date_debut` / `date_fin` | date | `CHECK (date_fin >= date_debut)` |
| `inscription_ouverte_le` / `inscription_fermee_le` | timestamptz | fenêtre d'inscription |
| `capacite_max` | integer NULL | NULL = illimité ; sinon `> 0` |
| `enseignant_id` | uuid NULL → `teachers(id)` | enseignant affecté |
| `classroom_id` | uuid NULL → `classrooms(id)` | salle |
| `statut` | text | `brouillon → ouvert ⇄ complet → en_cours → termine` ; `annule` (terminal) |

**Machine à états** : `ouvert→complet` automatique quand inscriptions actives = `capacite_max` ; `complet→ouvert` quand une place se libère dans la fenêtre. `termine` d'une matière satisfait les prérequis qui la visent.

### 4.3 `professional_subject_materials` — Supports de cours de la **matière**
`0065`. Supports **pérennes** (réutilisés d'une session à l'autre), rattachés à la matière.

| Champ | Type | Sens |
|---|---|---|
| `professional_subject_id` | uuid → `professional_subjects(id)` CASCADE | matière parente |
| `titre` / `description` | text | métadonnées |
| `kind` | varchar(20) | `CHECK IN ('pdf','pptx','video','image','autre')` |
| `storage_path` | text NOT NULL | emplacement du fichier |
| `mime_type` / `file_size` | text / bigint | métadonnées fichier |
| `uploaded_by` | uuid → `users(id)` | auteur du dépôt |

#### `professional_subject_material_views` — Traces de lecture
`0065`. Une ligne par consultation (lecture seule via le site, pas de téléchargement).
Champs : `material_id → professional_subject_materials`, `user_id → users`, `opened_at`.

### 4.4 `professional_session_materials` — Supports propres à **une session**
`0062`. Contrairement à 4.3, ces supports sont liés à **une session précise** (non pérennes).
Champs : `session_id → professional_subject_sessions`, `titre`, `url`, `description`, `uploaded_by`.

### 4.5 `professional_session_attendance` — Présences par session
`0062`. Une ligne par (session, étudiant).
Champs : `session_id`, `student_id → student_profiles`, `statut CHECK IN ('present','absent','retard','excuse')`, `marked_by → users`. `UNIQUE (tenant_id, session_id, student_id)`.

---

## 5. Évaluations rattachées à la Matière

### 5.1 `professional_assignments` — Évaluation (devoir / contrôle / examen…)
`0066` (+ `0067` pour l'extension multi-type). Rattachée à la **matière**, et
optionnellement à une **session** (`session_id` nullable → `ON DELETE SET NULL`).

| Groupe | Champs |
|---|---|
| Rattachement | `professional_subject_id → professional_subjects` (CASCADE), `session_id → professional_subject_sessions` (NULL) |
| Identité | `titre`, `description`, `type CHECK IN ('devoir','controle','examen','projet','qcm','autre')` |
| Barème | `note_max` (>0, déf. 20), `coefficient` (>0, déf. 1) |
| Planning | `starts_at`, `due_at`, `statut CHECK IN ('brouillon','publie','cloture')` |
| **Type d'éval (0067)** | `evaluation_type CHECK IN ('online','pdf','ai_generated')` |
| Sujet | `subject_content` (texte), `subject_document_url`, `consigne_url` |
| Online / IA | `duration_minutes`, `max_attempts`, `shuffle_questions`, `show_results_mode CHECK IN ('immediately','after_correction','never')` |
| PDF (homework) | `max_file_size_mb`, `late_submission_allowed`, `late_penalty_percent (0..100)` |
| Config IA | `ai_config` (JSONB : nb de questions par type, difficulté, instructions), `ai_source_material_ids` (UUID[] → supports source) |

### 5.2 `professional_assignment_questions` — Questions interactives
`0068`. Pour les évaluations `online` / `ai_generated`. `assignment_id → professional_assignments` (CASCADE).

| Champ | Sens |
|---|---|
| `position` | ordre d'affichage |
| `type` | `CHECK IN ('mcq_single','mcq_multi','short_answer','long_answer','true_false')` |
| `question_text`, `points` (>0), `explanation` | énoncé / barème / corrigé |
| `options` | JSONB `[{id,text,is_correct?}]` (MCQ et vrai/faux) |
| `correct_answer` | id d'option (single/true_false), array d'ids (multi), texte attendu (short), ou NULL (long → correction manuelle) |

### 5.3 `professional_assignment_submissions` — Copies des étudiants
`0066`. Une copie par (évaluation, étudiant). `UNIQUE (assignment_id, student_id)`.

Champs clés : `assignment_id`, `student_id → student_profiles`, `statut CHECK IN ('en_attente','soumis','en_correction','note','rejete')`, `file_url`, `contenu`, `note`, `appreciation`, `submitted_at`, `graded_at`, `graded_by → users`.

### 5.4 `professional_assignment_question_answers` — Réponses par question
`0068`. Une ligne par (soumission, question). `UNIQUE (submission_id, question_id)`.

Champs : `submission_id`, `question_id`, `answer_text` (short/long), `selected_option_ids` (JSONB, MCQ/vrai-faux), `is_correct`, `points_earned`, `graded_manually`, `feedback`. Auto-correction pour QCM/vrai-faux, manuelle pour les réponses libres.

---

## 6. Capitalisation : de la Matière au Diplôme (feature 029)

`0064_professional_diplomas.sql`. Le diplôme agrège des matières et se valide
sur les **UV** capitalisées par l'étudiant.

### 6.1 `professional_diplomas` — Diplôme
`programme_id → programmes`, `code` (UNIQUE par tenant), `libelle`, `description`, `uv_required` (>0), `statut CHECK IN ('actif','inactif')`, `created_by → users`.

### 6.2 `professional_diploma_requirements` — Matières exigées par le diplôme
Table de jonction **diplôme ⇄ matière**. `UNIQUE (diploma_id, subject_id)`.

| Champ | Sens |
|---|---|
| `diploma_id` | → `professional_diplomas(id)` CASCADE |
| `subject_id` | → `professional_subjects(id)` — matière comptabilisée |
| `est_obligatoire` | boolean — matière obligatoire ou au choix |
| `ordre` | integer ≥ 0 — ordre d'affichage |

Validation applicative : `subject_id` doit appartenir au **même programme** que le diplôme.

### 6.3 `student_professional_diplomas` — Diplôme octroyé à un étudiant
`diploma_id`, `student_id → student_profiles`, `reference` (UNIQUE par tenant), `statut CHECK IN ('en_cours','obtenu','revoque')`, `uv_total_validees`, `requirements_snapshot` (JSONB — gel des exigences au moment de l'octroi), `date_obtention`, `date_revocation`, `motif_revocation`, `octroye_par` / `revoque_par → users`.

- Index partiel unique `uniq_student_prof_diploma_active` : un seul octroi non révoqué par (diplôme, étudiant) ; un nouvel octroi reste possible après révocation.

---

## 7. Pour mémoire — la Matière académique (`courses`)

`0002_academic.sql`. Filière diplômante classique, hiérarchie :
`cycles → programmes → teaching_units (UE) → courses (matières) → course_assignments → teaching_hours`.

`courses` (la matière académique) :

| Champ | Sens |
|---|---|
| `teaching_unit_id → teaching_units` | rattachement à l'unité d'enseignement (≠ direct au programme) |
| `name`, `code`, `description`, `objectives TEXT[]` | identité et objectifs |
| `hours_total`, `hours_theory`, `hours_practical` | volumes horaires |
| `delivery_mode` | `presential / remote / hybrid / elearning` |
| `prerequisites TEXT[]`, `evaluation_methods TEXT[]`, `resources JSONB` | prérequis (texte libre), méthodes d'éval, ressources |
| `status` | `draft / active / inactive` |

Tables liées côté académique : `course_assignments` (attribution enseignant ↔ cours/année), `teaching_hours` (heures réellement enseignées et validées).

> **Différence clé** : la matière académique (`courses`) modélise prérequis et
> ressources en **champs texte/JSON** au sein d'un cursus annuel ; la matière
> professionnelle (`professional_subjects`) est **inscriptible/payante à la
> carte**, avec sessions datées, panier/commande, prérequis **relationnels**
> (graphe acyclique) et capitalisation vers un diplôme.

---

## 8. Fonctionnalités exposées (couche service / API)

Service principal : `apps/api/src/services/professional-catalog.service.ts`.
Contrats Zod : `packages/contracts/src/professional.ts` et `professional-diplomas.ts`.

### Sur la Matière
- **CRUD matière** : `createSubject`, `listSubjects`, `getSubject`, `updateSubject`, `deleteSubject`
  (validation `CreateProfessionalSubjectSchema` / `UpdateProfessionalSubjectSchema`, statut `actif`/`inactif`).
- **Prérequis** : `getPrerequisites`, `setPrerequisites` (vérifie même programme + absence de cycle).

### Sur les Sessions de la matière
- `createSession`, `listSessions`, `getSession`, `updateSession`, `deleteSession`
  (fenêtre d'inscription, capacité, enseignant, salle, machine à états).

### Sur les supports, évaluations, inscriptions, diplômes
- **Supports** : `professional-subject-materials.service.ts` (CRUD supports pérennes + traçage des consultations).
- **Évaluations** : `ProfessionalAssignmentsService` — `create` / `createQuestion`, soumission et correction (auto pour QCM, manuelle pour réponses libres).
- **Inscriptions / panier / paiement** : `professional-enrollment.service.ts` (commande, lignes d'inscription, paiement, confirmation).
- **Diplômes** : service `professional-diplomas` — gestion des exigences (matières) et octroi/révocation par étudiant.

---

## 9. Récapitulatif des tables liées à la Matière

| # | Table | Lien à la matière | Rôle |
|---|---|---|---|
| 1 | `professional_subjects` | — (table racine) | La matière professionnelle |
| 2 | `professional_subject_prerequisites` | `professional_subject_id` / `prerequisite_subject_id` | Graphe des prérequis |
| 3 | `professional_subject_sessions` | `professional_subject_id` | Sessions inscriptibles |
| 4 | `professional_subject_materials` | `professional_subject_id` | Supports pérennes de la matière |
| 5 | `professional_subject_material_views` | via `material_id` | Traces de lecture des supports |
| 6 | `professional_session_materials` | via `session_id` | Supports propres à une session |
| 7 | `professional_session_attendance` | via `session_id` | Présences par session |
| 8 | `professional_assignments` | `professional_subject_id` (+ `session_id`) | Évaluations de la matière |
| 9 | `professional_assignment_questions` | via `assignment_id` | Questions interactives |
| 10 | `professional_assignment_submissions` | via `assignment_id` | Copies des étudiants |
| 11 | `professional_assignment_question_answers` | via `submission_id` / `question_id` | Réponses par question |
| 12 | `professional_diploma_requirements` | `subject_id` | Matières exigées par un diplôme |
| 13 | `professional_diplomas` | via requirements | Diplôme |
| 14 | `student_professional_diplomas` | via `diploma_id` | Diplôme octroyé à un étudiant |
| 15 | `professional_enrollments` | via `session_id` | Inscription (ligne de commande) |
| — | `courses` (+ `teaching_units`, `course_assignments`, `teaching_hours`) | académique | Matière académique (filière classique) |

*Sources : migrations `0002`, `0061`–`0068` (`infra/scripts/migrations/`) ;
specs `028-professional-module` et `029-professional-diplomas`
(`data-model.md`).*
