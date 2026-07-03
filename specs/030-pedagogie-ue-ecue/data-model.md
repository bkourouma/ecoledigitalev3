# Data Model — Restructuration pédagogique Filière → UE → ECUE (030)

Phase 1. Schéma cible de la migration **`0069_pedagogie_ue_ecue.sql`**.

> Conventions communes : `id UUID PK DEFAULT uuid_generate_v4()`,
> `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` + **RLS**
> (policy `FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID)`),
> `created_at`/`updated_at TIMESTAMPTZ DEFAULT now()` (updated_at maintenu par la
> couche service). Filière = `programmes(id)` via colonne `filiere_id`.

## Carte relationnelle cible

```text
programmes (Filière)
   │ filiere_id
   ▼
professional_ue ──< professional_ue_prerequisites (prerequisite_ue_id)
   │  │  │
   │  │  └──< professional_ue_sessions (cohortes)
   │  │            │
   │  │            ├──< professional_enrollments >── professional_orders ──< professional_payments
   │  │            └──< professional_ecue_seances ──< professional_ecue_attendance
   │  │                          │ (ecue_id)
   │  └──< professional_ue_ecue (liaison mutualisable) ──┐
   │                                                     ▼
   └─ (diplôme) professional_diploma_requirements   professional_ecue
                          │ (ue_id)                      │
                          ▼                  ┌───────────┼───────────────┐
                professional_diplomas        ▼           ▼               ▼
                          │          professional_  professional_   professional_ecue_results
                          ▼          ecue_materials  assignments     (moyenne/validation par
            student_professional_diplomas    │       (ecue_id,        étudiant/cohorte)
                          │                   ▼        ue_session_id?)
            student_professional_ue_results  …_material_views
            (capitalisation UV par UE)
```

## Tables NOUVELLES

### 1. `professional_ue` — Unité d'Enseignement (ADMIN)

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → tenants CASCADE |
| `filiere_id` | uuid | NOT NULL → programmes(id) |
| `code` | text | NOT NULL ; UNIQUE (tenant_id, code) |
| `libelle` | text | NOT NULL |
| `description` | text | NULL |
| `prix` | numeric(14,2) | NOT NULL DEFAULT 0 CHECK (prix >= 0) |
| `devise` | text | NOT NULL DEFAULT 'XOF' |
| `nb_uv` | integer | NOT NULL DEFAULT 0 CHECK (nb_uv >= 0) |
| `statut` | text | NOT NULL DEFAULT 'actif' CHECK IN ('actif','inactif') |
| `created_by` | uuid | NULL → users(id) |
| `created_at`/`updated_at` | timestamptz | DEFAULT now() |

Index : `(tenant_id, filiere_id)`, `(tenant_id, statut)`.

### 2. `professional_ecue` — Élément Constitutif d'UE (PÉDAGOGIE) *(ex-`professional_subjects`)*

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → tenants CASCADE |
| `code` | text | NOT NULL ; UNIQUE (tenant_id, code) |
| `libelle` | text | NOT NULL |
| `description` | text | NULL |
| `bilan_type_id` | uuid | NULL → bilan_types(id) |
| `statut` | text | NOT NULL DEFAULT 'actif' CHECK IN ('actif','inactif') |
| `created_at`/`updated_at` | timestamptz | DEFAULT now() |

**Sans `prix` ni `nb_uv` ni `filiere_id`** (le contexte filière vient de l'UE, mutualisation). Index : `(tenant_id, statut)`, `(tenant_id, bilan_type_id)`.

### 3. `professional_ue_ecue` — Liaison UE ↔ ECUE (mutualisable)

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → tenants CASCADE |
| `ue_id` | uuid | NOT NULL → professional_ue(id) CASCADE |
| `ecue_id` | uuid | NOT NULL → professional_ecue(id) CASCADE |
| `est_obligatoire` | boolean | NOT NULL DEFAULT true |
| `coefficient` | numeric(5,2) | NOT NULL DEFAULT 1 CHECK (coefficient > 0) |
| `ordre` | integer | NOT NULL DEFAULT 0 CHECK (ordre >= 0) |
| `created_at` | timestamptz | DEFAULT now() |

UNIQUE (`tenant_id`, `ue_id`, `ecue_id`). Index : `(tenant_id, ue_id, ordre)`, `(tenant_id, ecue_id)`. **Pas de contrainte de filière** (mutualisation inter-filières, D-R4).

### 4. `professional_ue_prerequisites` — Prérequis entre UE *(ex-`…subject_prerequisites`)*

| Champ | Type | Contraintes |
|---|---|---|
| `ue_id` | uuid | NOT NULL → professional_ue(id) CASCADE |
| `prerequisite_ue_id` | uuid | NOT NULL → professional_ue(id) CASCADE |

`CHECK (ue_id <> prerequisite_ue_id)`, UNIQUE (`tenant_id`, `ue_id`, `prerequisite_ue_id`). Validation appli : **même filière** + graphe **acyclique** (DFS). Index : `(tenant_id, ue_id)`, `(tenant_id, prerequisite_ue_id)`.

### 5. `professional_ue_sessions` — Cohorte d'UE *(ex-`…subject_sessions`)*

| Champ | Type | Contraintes |
|---|---|---|
| `ue_id` | uuid | NOT NULL → professional_ue(id) CASCADE |
| `libelle` | text | NOT NULL |
| `date_debut`/`date_fin` | date | NOT NULL ; CHECK (date_fin >= date_debut) |
| `inscription_ouverte_le`/`inscription_fermee_le` | timestamptz | NOT NULL ; CHECK (fermee >= ouverte) |
| `capacite_max` | integer | NULL = illimité ; CHECK (NULL OR > 0) |
| `enseignant_id` | uuid | NULL → teachers(id) |
| `classroom_id` | uuid | NULL → classrooms(id) |
| `statut` | text | DEFAULT 'brouillon' CHECK IN ('brouillon','ouvert','complet','en_cours','termine','annule') |

Index : `(tenant_id, ue_id)`, `(tenant_id, statut, inscription_ouverte_le, inscription_fermee_le)`.

### 6. `professional_ecue_seances` — Séance pédagogique (NOUVELLE)

| Champ | Type | Contraintes |
|---|---|---|
| `ecue_id` | uuid | NOT NULL → professional_ecue(id) CASCADE |
| `ue_session_id` | uuid | NOT NULL → professional_ue_sessions(id) CASCADE |
| `libelle` | text | NULL |
| `date` | date | NOT NULL |
| `heure_debut`/`heure_fin` | time | NULL ; CHECK (fin >= debut si les deux) |
| `enseignant_id` | uuid | NULL → teachers(id) |
| `classroom_id` | uuid | NULL → classrooms(id) |

Index : `(tenant_id, ue_session_id, date)`, `(tenant_id, ecue_id)`.

### 7. `professional_ecue_attendance` — Présence *(ex-`…session_attendance`)*

| Champ | Type | Contraintes |
|---|---|---|
| `seance_id` | uuid | NOT NULL → professional_ecue_seances(id) CASCADE |
| `student_id` | uuid | NOT NULL → student_profiles(id) CASCADE |
| `statut` | text | DEFAULT 'present' CHECK IN ('present','absent','retard','excuse') |
| `marked_by` | uuid | NULL → users(id) |

UNIQUE (`tenant_id`, `seance_id`, `student_id`). Index : `(tenant_id, seance_id)`.

### 8. `professional_ecue_materials` (+ `…_material_views`) *(ex-`…subject_materials`)*

Renommage simple, FK `ecue_id → professional_ecue(id) CASCADE`. Champs inchangés : `titre`, `description`, `kind CHECK IN ('pdf','pptx','video','image','autre')`, `storage_path NOT NULL`, `mime_type`, `file_size BIGINT`, `uploaded_by → users`. Trace : `professional_ecue_material_views (material_id → professional_ecue_materials, user_id → users, opened_at)`.

### 9. `professional_ecue_results` — Résultat ECUE par étudiant (NOUVELLE)

| Champ | Type | Contraintes |
|---|---|---|
| `ecue_id` | uuid | NOT NULL → professional_ecue(id) CASCADE |
| `student_id` | uuid | NOT NULL → student_profiles(id) CASCADE |
| `ue_session_id` | uuid | NOT NULL → professional_ue_sessions(id) CASCADE |
| `moyenne` | numeric(6,2) | NULL |
| `validee` | boolean | NOT NULL DEFAULT false |
| `validee_manuellement` | boolean | NOT NULL DEFAULT false |
| `valide_par` | uuid | NULL → users(id) |
| `date_validation` | timestamptz | NULL |

UNIQUE (`tenant_id`, `ecue_id`, `student_id`, `ue_session_id`). Index : `(tenant_id, ue_session_id)`, `(tenant_id, student_id)`. Règle : `validee = true` si `moyenne >= 10` **ou** `validee_manuellement = true` (override). Alimente la validation UE (FR-041).

### 10. `student_professional_ue_results` — Capitalisation UV par UE (NOUVELLE)

| Champ | Type | Contraintes |
|---|---|---|
| `ue_id` | uuid | NOT NULL → professional_ue(id) CASCADE |
| `student_id` | uuid | NOT NULL → student_profiles(id) CASCADE |
| `ue_session_id` | uuid | NULL → professional_ue_sessions(id) ON DELETE SET NULL |
| `statut` | text | DEFAULT 'en_cours' CHECK IN ('en_cours','validee','echec') |
| `uv_acquises` | integer | NOT NULL DEFAULT 0 CHECK (uv_acquises >= 0) |
| `date_validation` | timestamptz | NULL |

UNIQUE (`tenant_id`, `ue_id`, `student_id`). Index : `(tenant_id, student_id, statut)`, `(tenant_id, ue_id)`. Registre des UV capitalisées (FR-041 → FR-043).

## Tables REPOINTÉES (FK renommées)

### 11. `professional_assignments`
- `professional_subject_id` → **`ecue_id`** (→ `professional_ecue`, CASCADE).
- `session_id` → **`ue_session_id`** (→ `professional_ue_sessions`, ON DELETE SET NULL, nullable = contexte).
- Tout le reste **inchangé** (type, barème, planning, evaluation_type online/pdf/ai, ai_config, ai_source_material_ids). Index : `(tenant_id, ecue_id)`, `(tenant_id, ue_session_id)`.
- Filles `professional_assignment_questions`, `…_submissions`, `…_question_answers` : **inchangées**.

### 12. `professional_enrollments`
- `session_id` → **`ue_session_id`** (→ `professional_ue_sessions`).
- `prix_unitaire` = prix de l'**UE** (figé à l'ajout au panier).
- Index unique d'inscription active : `(tenant_id, student_id, ue_session_id) WHERE statut <> 'annulee'`.
- `professional_orders` / `professional_payments` : **inchangées** (logique panier/paiement).

### 13. `professional_diplomas`
- `programme_id` → **`filiere_id`** (→ `programmes(id)`). Reste : `code`, `libelle`, `description`, `uv_required > 0`, `statut`, `created_by`.

### 14. `professional_diploma_requirements`
- `subject_id` → **`ue_id`** (→ `professional_ue(id)`). UNIQUE (`diploma_id`, `ue_id`). Validation appli : UE de la **même filière** que le diplôme. Reste : `est_obligatoire`, `ordre`.

### 15. `student_professional_diplomas`
- **Inchangée**. `uv_total_validees` désormais agrégé depuis `student_professional_ue_results` (UE validées).

### 16. `live_sessions` (table partagée)
- Supprimer `professional_subject_session_id` (+ index) ; ajouter **`professional_ecue_seance_id`** (→ `professional_ecue_seances`, soft) + index.
- Recalculer `live_sessions_exactly_one_parent` : `(session_instance_id NOT NULL)::int + (session_professionnelle_id NOT NULL)::int + (professional_ecue_seance_id NOT NULL)::int = 1`.
- Pas de UNIQUE sur la colonne (plusieurs visios par séance possibles).

## Tables SUPPRIMÉES (DROP, D13 — aucune reprise)

`professional_session_materials`, `professional_session_attendance`,
`professional_subject_material_views`, `professional_subject_materials`,
`professional_assignments` (recréée repointée — voir note migration),
`professional_subject_prerequisites`, `professional_subject_sessions`,
`professional_subjects`.

> Note migration : `professional_assignments` et `professional_enrollments` et
> les tables diplômes sont **recréées/altérées** plutôt que purement perdues —
> on supprime les anciennes contraintes FK vers `professional_subjects` /
> `professional_subject_sessions` et on recrée la structure repointée. L'ordre
> de DROP respecte les dépendances (filles → parents), avec `DROP … CASCADE`.

## Règles de validation (couche service)

| Règle | Où | Détail |
|---|---|---|
| Code UE/ECUE unique par tenant | DB + service | UNIQUE (tenant_id, code) |
| ECUE sans prix/UV | DB (colonnes absentes) | impossible structurellement |
| Liaison unique UE↔ECUE | DB | UNIQUE (tenant_id, ue_id, ecue_id) |
| Prérequis UE même filière | service | `professional_ue.filiere_id` identiques |
| Prérequis UE acyclique | service | DFS avant insertion |
| UE inactive → pas de cohorte/inscription | service | refus si `statut='inactif'` |
| Catalogue inscriptible | service | UE `actif` + cohorte fenêtre ouverte |
| Prix figé = prix UE | service enrollment | `prix_unitaire = ue.prix` |
| Une inscription active / cohorte | DB | index partiel unique |
| Prérequis UE validés avant inscription | service enrollment | `student_professional_ue_results.statut='validee'` |
| ECUE validée | service results | `moyenne >= 10` OU `validee_manuellement` |
| UE validée | service results | toutes ECUE obligatoires validées → octroi UV |
| Diplôme = UE même filière | service diplomas | `ue.filiere_id = diploma.filiere_id` |
| Diplôme obtenu | service diplomas | `uv_total >= uv_required` + UE obligatoires validées |
