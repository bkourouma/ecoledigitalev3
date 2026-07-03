# Phase 1 — Data Model: Diplômes Professionnels

**Feature**: 029-professional-diplomas | **Date**: 2026-05-22 | **Migration**: `infra/scripts/migrations/0064_professional_diplomas.sql`

Conventions communes aux 3 nouvelles tables (reprises des tables `028` — voir research [R2](./research.md), [R4](./research.md)) :
- `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()` (extension `uuid-ossp`)
- `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` (+ `updated_at` pour les tables mutables)
- Row-Level Security **activée**, policy d'isolation `{table}_tenant_isolation` (`tenant_id = current_setting('app.tenant_id', true)::UUID`)
- Migration **idempotente** (`CREATE … IF NOT EXISTS`, policies en `DO $$ … EXCEPTION WHEN duplicate_object`) et **non destructive** (aucun `DROP`, aucun `ALTER` de table existante)
- `updated_at` maintenu par la couche de service (pas de trigger), comme dans `028`

Tables existantes référencées (non modifiées) : `tenants`, `programmes`, `users`, `professional_subjects`, `professional_subject_sessions`, `professional_enrollments`, `student_profiles`.

---

## Diagramme relationnel (logique)

```text
programmes ──< professional_diplomas ──< professional_diploma_requirements >── professional_subjects
                      │                                                            │
                      │                                                            │ (matière validée si
                      └──< student_professional_diplomas >── student_profiles       │  inscription terminee)
                                                                                    │
   professional_enrollments (statut='terminee') ──> professional_subject_sessions ──┘
```

Un diplôme appartient à **un** programme (D7). Ses exigences pointent vers des `professional_subjects` du **même** programme (FR-006, validation applicative — research R9). Un octroi relie un diplôme à un `student_profiles`.

---

## 1. `professional_diplomas` — Diplôme

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK `DEFAULT uuid_generate_v4()` |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `programme_id` | uuid | NOT NULL → `programmes(id)` |
| `code` | varchar(50) | NOT NULL ; **UNIQUE (`tenant_id`, `code`)** |
| `libelle` | varchar(255) | NOT NULL |
| `description` | text | NULL |
| `uv_required` | integer | NOT NULL ; `CHECK (uv_required > 0)` |
| `statut` | varchar(20) | NOT NULL DEFAULT `'actif'` ; `CHECK (statut IN ('actif','inactif'))` |
| `created_by` | uuid | NULL → `users(id)` |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

**Règles** : `programme_id` obligatoire (D7). `code` unique par tenant → rejet `DUPLICATE_DIPLOMA_CODE` (FR-003). `uv_required` strictement positif → rejet `VALIDATION_ERROR` sinon (FR-004). Un diplôme `inactif` n'est plus octroyé automatiquement, mais les octrois existants restent valides (FR-015, FR-006 du spec). Suppression refusée s'il existe un octroi non révoqué (FR-010, voir table 3).

**Index** :
- `UNIQUE (tenant_id, code)` → `uniq_professional_diplomas_code`
- `idx_professional_diplomas_tenant_programme (tenant_id, programme_id)`
- `idx_professional_diplomas_tenant_statut (tenant_id, statut)`

---

## 2. `professional_diploma_requirements` — Exigence (matière comptabilisée)

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK `DEFAULT uuid_generate_v4()` |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `diploma_id` | uuid | NOT NULL → `professional_diplomas(id)` **ON DELETE CASCADE** |
| `subject_id` | uuid | NOT NULL → `professional_subjects(id)` |
| `est_obligatoire` | boolean | NOT NULL DEFAULT `false` |
| `ordre` | integer | NOT NULL DEFAULT `0` |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

**Contraintes** :
- `UNIQUE (diploma_id, subject_id)` → `uniq_prof_diploma_req_subject` — une matière au plus une fois par diplôme.
- **Validation applicative** (`ProfessionalDiplomasService`, research R9) : `subject_id` doit pointer vers une matière dont `programme_id` = `programme_id` du diplôme → sinon `CROSS_PROGRAMME_REQUIREMENT` (FR-006).
- `ON DELETE CASCADE` depuis `professional_diplomas` : supprimer un diplôme (autorisé seulement sans octroi non révoqué) supprime ses exigences (FR-010).

**Sémantique** : `est_obligatoire = true` → la matière doit être terminée pour l'éligibilité (D2). Toute matière exigée (obligatoire ou non) compte dans le cumul d'UV si validée (D3). `ordre` sert uniquement à l'affichage.

**Index** :
- `UNIQUE (diploma_id, subject_id)`
- `idx_prof_diploma_req_diploma (tenant_id, diploma_id)`
- `idx_prof_diploma_req_subject (tenant_id, subject_id)` — accélère `recomputeForStudent` (« quels diplômes incluent cette matière ? »)

---

## 3. `student_professional_diplomas` — Diplôme octroyé à un étudiant

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK `DEFAULT uuid_generate_v4()` |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `diploma_id` | uuid | NOT NULL → `professional_diplomas(id)` |
| `student_id` | uuid | NOT NULL → `student_profiles(id)` |
| `reference` | varchar(50) | NOT NULL ; **UNIQUE (`tenant_id`, `reference`)** ; format `DIP-{année}-{séquence 6 chiffres}` (research R8) |
| `statut` | varchar(20) | NOT NULL ; `CHECK (statut IN ('en_cours','obtenu','revoque'))` |
| `uv_total_validees` | integer | NOT NULL DEFAULT `0` — cumul d'UV figé au moment de l'octroi |
| `requirements_snapshot` | jsonb | NULL — instantané des exigences au moment de l'octroi (research R7) |
| `date_obtention` | timestamptz | NULL — renseigné quand `statut = 'obtenu'` |
| `date_revocation` | timestamptz | NULL — renseigné quand `statut = 'revoque'` |
| `motif_revocation` | text | NULL — obligatoire (applicatif) quand `statut = 'revoque'` |
| `octroye_par` | uuid | NULL → `users(id)` — NULL si octroi automatique |
| `revoque_par` | uuid | NULL → `users(id)` |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

**Contraintes** :
- index partiel `UNIQUE (diploma_id, student_id) WHERE statut <> 'revoque'` → `uniq_student_prof_diploma_active` — un seul octroi non révoqué par couple (diplôme, étudiant) (FR-016, FR-024) ; un nouvel octroi reste possible après révocation (FR-028).
- `UNIQUE (tenant_id, reference)` → `uniq_student_prof_diploma_reference` (FR-039).

**Machine à états** (research R14 ; le statut `en_cours` est réservé Phase 2, jamais produit au MVP — D11) :

```text
(octroi automatique R5 / manuel)
        │
        ▼
     obtenu ──(révocation admin, motif requis)──> revoque   [terminal]
```

- `obtenu` : créé à l'octroi ; `date_obtention`, `uv_total_validees`, `requirements_snapshot` renseignés ; `octroye_par` = admin (manuel) ou `NULL` (automatique).
- `revoque` : terminal ; `date_revocation`, `motif_revocation` (non vide), `revoque_par` renseignés. Toute autre transition → `INVALID_DIPLOMA_STATUS_TRANSITION`.

**Règles** :
- Octroi sur un couple détenant déjà un octroi non révoqué → `DIPLOMA_ALREADY_AWARDED` (409).
- Révocation d'un diplôme non détenu (`obtenu`) → `DIPLOMA_NOT_AWARDED` (404).
- Révocation sans motif → `VALIDATION_ERROR` (422).
- Modifier le diplôme/les exigences après octroi ne touche ni `requirements_snapshot` ni `uv_total_validees` (FR-017, FR-018).

**Index** :
- `uniq_student_prof_diploma_active` (partiel, ci-dessus)
- `uniq_student_prof_diploma_reference`
- `idx_student_prof_diploma_diploma (tenant_id, diploma_id, statut)` — `listAwarded`
- `idx_student_prof_diploma_student (tenant_id, student_id, statut)` — `listStudentDiplomas`

---

## Logique d'éligibilité (résumé — voir research R6)

Pour un couple (diplôme `D`, étudiant `E`) :

1. **Matières exigées de `D`** : lignes `professional_diploma_requirements` de `D`, jointes à `professional_subjects` pour `nb_uv` et `est_obligatoire`.
2. **Matières validées par `E`** : `professional_subjects.id` DISTINCT pour lesquels il existe une `professional_enrollments` au statut `terminee` (jointe via `professional_subject_sessions`).
3. **`uv_validees`** = Σ `nb_uv` des matières exigées **et** validées (DISTINCT par matière).
4. **`obligatoires_ok`** = toutes les matières exigées `est_obligatoire = true` sont validées.
5. **`eligible`** = `obligatoires_ok` ET `uv_validees >= D.uv_required`.

La fonction d'évaluation pure (exigences + ensemble des matières validées → `{uv_validees, obligatoires_ok, eligible, matieres_validees, matieres_restantes, matieres_obligatoires_manquantes}`) est isolée pour les tests Jest « logique pure » (sans base).

---

## Hook de recomputation (research R5)

`recomputeForStudent(tenantId, studentId, subjectId)` :
1. Sélectionne les diplômes `actif` dont une exigence référence `subjectId`.
2. Pour chacun, calcule l'éligibilité de `studentId` (logique ci-dessus).
3. Si éligible **et** absence d'octroi non révoqué pour ce couple : crée une ligne `student_professional_diplomas` au statut `obtenu`, `octroye_par = NULL`, `reference` générée (R8), `requirements_snapshot` et `uv_total_validees` figés.
4. Jamais de révocation automatique (FR-017).

Appelé en **best-effort** depuis le handler de `POST /enrollments/:id/complete`, hors de la transaction d'achèvement (research R5, FR-020).

---

## Tables existantes — intégrations (non modifiées par la migration `0064`)

| Table / fichier existant | Intégration |
|---|---|
| `programmes` | Source de `professional_diplomas.programme_id`. |
| `professional_subjects` | Source de `professional_diploma_requirements.subject_id` ; fournit `nb_uv` et `programme_id` (cohérence de programme). |
| `professional_subject_sessions` | Maillon de jointure inscription → matière dans le calcul d'éligibilité. |
| `professional_enrollments` | Le statut `terminee` est le fait générateur de la validation d'une matière. |
| `student_profiles` | Source de `student_professional_diplomas.student_id` ; liaison parent-enfant via `student_parents` (vue parent). |
| `users` | Source de `created_by`, `octroye_par`, `revoque_par`. |
| `professional-enrollment.service.ts` | `completeEnrollment` **étendu** (additif) pour exposer `subject_id` ; déclenche le recalcul best-effort (research R5). |

---

## Règles de validation transverses (résumé pour les contrats Zod)

- `programme_id` requis sur un diplôme ; `code` non vide (≤ 50), `libelle` non vide (≤ 255).
- `uv_required` entier `> 0`.
- `statut` diplôme ∈ `{actif, inactif}` ; `statut` octroi ∈ `{en_cours, obtenu, revoque}` (MVP : `obtenu`/`revoque` seulement).
- Exigence : `subject_id` du programme du diplôme ; `ordre` entier `>= 0` ; pas de doublon `(diploma_id, subject_id)`.
- Octroi manuel : `student_id` requis ; `force` booléen optionnel (défaut `false`).
- Révocation : `student_id` requis ; `motif` non vide.
- `reference` unique par tenant ; un seul octroi non révoqué par couple `(diploma_id, student_id)`.

## Volumétrie & performance

Volumétrie par tenant attendue : dizaines de diplômes, quelques matières exigées par diplôme, milliers d'octrois cumulés. Les index ci-dessus couvrent les accès critiques : liste des diplômes par programme/statut, exigences par diplôme, diplômes incluant une matière donnée (recompute), octrois par diplôme et par étudiant. Objectif progression/recompute < 1 s (plan, *Performance Goals*), soutenu en outre par les index `028` `idx_prof_enroll_student (tenant_id, student_id, statut)`.
