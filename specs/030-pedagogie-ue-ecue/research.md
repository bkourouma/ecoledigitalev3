# Research — Restructuration pédagogique Filière → UE → ECUE (030)

Phase 0 du plan. Résout les inconnues techniques et fige les décisions issues
des points ouverts du PRD §10. Aucune `NEEDS CLARIFICATION` ne subsiste.

## Contexte de départ (état des lieux 028/029)

Migrations existantes du Module Professionnel (`infra/scripts/migrations`) :

| Migration | Contenu |
|---|---|
| `0061` | `professional_subjects`, `…_prerequisites`, `…_sessions`, `professional_orders`, `professional_enrollments`, `professional_payments` |
| `0062` | `professional_session_materials`, `professional_session_attendance` |
| `0063` | ajoute `bilan_type_id` à `professional_subjects` |
| `0064` | `professional_diplomas`, `…_requirements (subject_id)`, `student_professional_diplomas` |
| `0065` | `professional_subject_materials` (+ `…_material_views`) |
| `0066` | `professional_assignments` (+ `…_submissions`), 3ᵉ colonne parent `live_sessions.professional_subject_session_id` |
| `0067` | colonnes étendues de `professional_assignments` (online/pdf/ai) |
| `0068` | `professional_assignment_questions`, `…_question_answers` |

Patron technique observé (à conserver à l'identique en `0069`) :
- `id UUID PK DEFAULT uuid_generate_v4()`, `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
- RLS `ENABLE ROW LEVEL SECURITY` + policy `… FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID)` enveloppée dans `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL; END $$`.
- `updated_at` maintenu par la couche service (pas de trigger).
- Contexte tenant via `ProfessionalBaseService.withTenant` / `withTenantTx` (`set_config('app.tenant_id', …, true)`).

## Décisions

### D-R1 — Stratégie de migration : rupture directe, non idempotente, destructive (assumée)

- **Décision** : la migration `0069_pedagogie_ue_ecue.sql` **supprime** (`DROP TABLE … CASCADE`) les tables obsolètes `professional_subject_*` / `professional_session_*` puis crée le nouveau modèle. Contrairement aux migrations `0061`–`0068` (idempotentes/non destructives), `0069` est **destructive et à passage unique** car le PRD acte « aucune reprise de données » (D13) et seules des données de dev/seed existent.
- **Rationale** : repartir propre évite des colonnes mortes et des FK ambiguës ; la complexité d'un renommage en place (avec données) n'est pas justifiée sans reprise.
- **Précautions** : DROP ordonné (filles avant parents), `IF EXISTS`, en-tête d'avertissement explicite. Les `CREATE TABLE` restent `IF NOT EXISTS` + policies `EXCEPTION WHEN duplicate_object` pour rester rejouables après le premier passage.
- **Alternatives rejetées** : `ALTER TABLE … RENAME` en place (garderait des colonnes prix/UV sur l'ECUE à nettoyer, et un historique de FK trompeur) ; migration de données (hors périmètre D13).

### D-R2 — Filière = `programmes` (non renommée), FK pro = `filiere_id`

- **Décision** : la table `programmes` est **partagée** avec l'Académique et n'est pas renommée. Les tables pro référencent `programmes(id)` via une colonne nommée **`filiere_id`** (libellé métier « Filière »).
- **Rationale** : éviter tout breaking change sur l'Académique (D1) ; « Filière » est une vue métier du même objet.

### D-R3 — Seuil de validation ECUE : 10/20 figé + validation manuelle (override)

- **Décision** : l'auto-validation d'une ECUE se fait sur `moyenne ≥ 10.00` (constante applicative, pas de colonne de seuil). `professional_ecue_results` porte `validee BOOLEAN`, `validee_manuellement BOOLEAN`, `valide_par UUID → users`, `date_validation`. Un responsable peut forcer `validee = true` même si `moyenne < 10` (override tracé) ; il peut aussi invalider.
- **Rationale** : simple (pas de paramétrage par ECUE/bilan_type/cohorte pour le MVP) tout en couvrant les cas pédagogiques réels (rattrapage, jury) via l'override.
- **Alternatives rejetées** : colonne `seuil_validation` paramétrable (reportée — la constante + override couvre le besoin immédiat) ; seuil par `bilan_type` (complexité non justifiée au MVP).

### D-R4 — Mutualisation ECUE inter-filières autorisée

- **Décision** : la liaison `professional_ue_ecue` n'impose **aucune** contrainte de filière ; une ECUE peut appartenir à des UE de filières différentes. La règle « même filière » s'applique uniquement :
  1. aux **prérequis UE** (`professional_ue_prerequisites` : les deux UE de la même filière) ;
  2. à la **composition du diplôme** (`professional_diploma_requirements` : UE de la même filière que le diplôme).
- **Rationale** : maximise la réutilisation pédagogique (une ECUE « Anglais » partagée entre filières) tout en gardant cohérents le parcours de prérequis et le périmètre d'un diplôme.

### D-R5 — Validation UE : toutes les ECUE obligatoires validées, sans compensation

- **Décision** : `professional_ue` est validée pour un étudiant/cohorte quand **toutes** les ECUE rattachées avec `est_obligatoire = true` ont un `professional_ecue_results.validee = true`. Aucune moyenne d'UE compensatoire. Les ECUE non obligatoires n'entrent pas dans la condition. La validation crée/met à jour `student_professional_ue_results` (`statut = 'validee'`, `uv_acquises = professional_ue.nb_uv`).
- **Rationale** : applique D9 littéralement ; le `coefficient` de la liaison sert à calculer une moyenne d'UE indicative/affichage, pas à compenser.

### D-R6 — Supports consolidés au niveau ECUE

- **Décision** : suppression de `professional_session_materials` (supports par session). Tous les supports passent par `professional_ecue_materials` (pérennes). Les séances (`professional_ecue_seances`) ne portent pas de supports propres au MVP.
- **Rationale** : un seul emplacement de vérité pour le contenu, réutilisable d'une cohorte à l'autre (FR-030).

### D-R7 — Présence repointée sur la séance ECUE

- **Décision** : `professional_session_attendance` (présence par session) est remplacée par `professional_ecue_attendance` (présence par **séance** ECUE). La séance (`professional_ecue_seances`) appartient à une ECUE et à une cohorte UE (`ue_session_id`).
- **Rationale** : granularité pédagogique réelle (un étudiant est présent à une séance d'ECUE, pas à « la session » globale).

### D-R8 — Visio (`live_sessions`) repointée sur la séance ECUE

- **Décision** : remplacer la colonne `live_sessions.professional_subject_session_id` par **`professional_ecue_seance_id`** (→ `professional_ecue_seances`). La contrainte `live_sessions_exactly_one_parent` est recalculée avec les trois colonnes parent : `session_instance_id`, `session_professionnelle_id`, `professional_ecue_seance_id`. Pas de UNIQUE strict (une séance peut avoir plusieurs visios).
- **Rationale** : aligne la visio sur la nouvelle granularité (FR-034). `live_sessions` étant partagée, l'altération est ciblée (DROP de l'ancienne colonne + index + contrainte, ADD de la nouvelle).

### D-R9 — Évaluations repointées (ECUE + contexte cohorte)

- **Décision** : `professional_assignments.professional_subject_id` → **`ecue_id`** (→ `professional_ecue`, CASCADE) ; `session_id` → **`ue_session_id`** (→ `professional_ue_sessions`, `ON DELETE SET NULL`, nullable = contexte). Tables filles (`…_questions`, `…_submissions`, `…_question_answers`) **inchangées** (FK via `assignment_id`/`submission_id`). `ai_source_material_ids` reste un `UUID[]` (FK soft → `professional_ecue_materials`).
- **Rationale** : la pédagogie reste portée par l'ECUE ; la cohorte n'est qu'un contexte optionnel.

### D-R10 — Renommage des endpoints API : rupture directe

- **Décision** : `/api/v1/professional/subjects*` → `/api/v1/professional/ecue*` ; ajout de `/api/v1/professional/ue*` (CRUD UE, composition UE↔ECUE, prérequis UE, cohortes), `/api/v1/professional/ue-sessions/:id/seances*`, etc. Pas de période de compatibilité (dev only, D2/D13).
- **Rationale** : éviter une couche d'alias jetable ; le front est mis à jour dans la même feature.

### D-R11 — Couche service : un nouveau service UE + renommage du catalogue

- **Décision** :
  - `professional-catalog.service.ts` : renommer la sémantique subject→ecue (CRUD ECUE pédagogique : code/libellé/description/bilan_type/statut, sans prix/UV) ; conserver l'arbre de catalogue.
  - **Nouveau** `professional-ue.service.ts` : CRUD UE (prix/UV/statut/filière), composition UE↔ECUE (coefficient/obligatoire/ordre), prérequis UE (même filière + acyclique), cohortes UE (machine à états), séances ECUE.
  - `professional-enrollment.service.ts` : repointer sur `ue_session_id`, prix figé = prix UE, contrôle des prérequis UE.
  - `professional-diplomas.service.ts` : exigences = UE, capitalisation UV par UE (`student_professional_ue_results`), recalcul du diplôme.
  - **Nouveau** `professional-results.service.ts` (ou intégré au diplômes) : consolidation `professional_ecue_results` (auto/ manuelle), validation UE → octroi UV.
  - `professional-subject-materials.service.ts` → `professional-ecue-materials.service.ts`.
- **Rationale** : isole l'administratif (UE) du pédagogique (ECUE) conformément au principe directeur.

### D-R12 — Contrats Zod

- **Décision** : `packages/contracts/src/professional.ts` : `ProfessionalSubject*` → `ProfessionalEcue*` ; ajout de `ProfessionalUe*`, `ProfessionalUeEcue*` (liaison), `ProfessionalUePrerequisite*`, `ProfessionalUeSession*`, `ProfessionalEcueSeance*`, `ProfessionalEcueAttendance*`, `ProfessionalEcueResult*`. `professional-diplomas.ts` : exigences `ue_id`, `StudentProfessionalUeResult*`. Re-export via le barrel `index.ts`.
- **Rationale** : type-safety partagée API/web, validation côté serveur.

## Synthèse des constantes & énumérations

- Devise par défaut : `XOF`.
- Statut UE / ECUE : `actif` | `inactif`.
- Statut cohorte UE : `brouillon` → `ouvert` ⇄ `complet` → `en_cours` → `termine` ; `annule` (terminal).
- Statut présence : `present` | `absent` | `retard` | `excuse`.
- Statut résultat UE étudiant : `en_cours` | `validee` | `echec`.
- Seuil ECUE : `10.00 / 20` (constante `ECUE_VALIDATION_THRESHOLD`).
- Coefficient liaison : `numeric(5,2) > 0` défaut `1`.
