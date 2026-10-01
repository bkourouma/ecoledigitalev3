# Modèle de données — 004-academic-core (schéma Postgres `academic`)

**Statut** : DDL de référence, exécuté et testé sur PostgreSQL 17 (38 tests de comportement : exclusions, grammaire, publication, capacité, `FULL` dérivé, surcharge de clôture par classe, RLS). Les fichiers ci-dessous sont les migrations cibles `apps/api/src/modules/academic/migrations/0700…0704` ; ils font foi sur les noms et les contraintes. Les blocs `<!-- migration: … -->` sont extraits par les outils de contrôle.

**Sources** : `docs/architecture/module-conventions.md`, ADR-002 (RLS), ADR-005 (types de ligne à la main), ADR-006 (un schéma par module), ADR-007 (UUID, UTC, snake_case anglais), plan §3.7, `docs/modele-donnees-pedagogique-matiere.md`, `docs/PRD-restructuration-pedagogique-filiere-ue-ecue.md`.

## 1. Conventions appliquées

| Règle | Application dans `academic` |
|---|---|
| Un module = un schéma | `academic` ; aucune FK vers un autre schéma que `kernel.tenants(id)`. Les références vers `tenancy` (`institution_id`, `campus_id`), `people` (`student_id`), `finance`, `assess` sont des UUID **sans FK**, validées par l'API publique du module concerné. |
| Toute table de tenant | `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + `kernel.enable_tenant_rls()` (ENABLE + FORCE, policy unique `tenant_isolation`, index en tête sur `tenant_id`) + `GRANT` explicite à `app_user`. **Aucune table globale** : l'allowlist d'isolation du module est vide. |
| FK internes composites | `(tenant_id, id)` partout : une ligne ne peut pas pointer une ligne d'un autre tenant (les contrôles de FK contournent la RLS). Chaque table porte `UNIQUE (tenant_id, id)`. |
| Identifiants | `uuid` fourni par l'application (`newId()`, UUID v7) ; pas de défaut côté base sauf `gen_random_uuid()` dans les tests. |
| Dates | `timestamptz` en UTC pour les instants ; `date` pour les dates civiles (début d'année, naissance…). Aucune dérivation de l'année par « pivot au 1er septembre » : l'année est une ligne. |
| Montants | **Aucun** dans ce module (prix, remises, échéances = finance). |
| Constantes réglementaires | **Aucune**. Niveaux, types de périodes, grammaire du curriculum, types de financement, issues d'année = données de pack (§7). Coefficients et crédits sont des données de curriculum ; leurs formules d'agrégation sont des RuleSets. |
| Suppression | Pas de `DELETE` applicatif sur les inscriptions, classes, versions de curriculum (déclencheurs `forbid_mutation`) ; on change un statut. Les périodes `PLANNED` et les nœuds d'un brouillon peuvent être supprimés. |
| Audit | Les cas d'usage sensibles appellent `audit.record(tx, …)` dans la même transaction (liste en spec §Audit). L'historique métier propre au module (`enrollment_history`, `curriculum_amendments`, `enrollment_placements`) est **append-only**, indépendamment de l'audit. |
| Événements | Écrits dans `kernel.domain_events` par `PgOutboxWriter(tx)` dans la transaction de la donnée. |

## 2. Vue d'ensemble

```
tenancy.institutions (UUID)                                        people.students (UUID)
        │                                                                  │
 academic_years ─< academic_periods (arbre : année > période > sous-période)
        │                    ▲
        │                    └── period_types (donnée)
        │
 programs ─< program_grade_levels >─ grade_levels >─ education_levels
    │ (série > spécialité)         (next_grade_level_id = donnée de passage)
    │
 curriculum_versions (programme x année) ─< curriculum_nodes (arbre polymorphe, node_type = donnée)
    │                                          │  ├─ subject_id ─> subjects (catalogue, mutualisable)
    │                                          │  └─ curriculum_prerequisites (par lineage_id)
    │                                          └─ curriculum_amendments (journal)
    │
 classrooms (classe/promotion de l'année, 1 version de curriculum)
    ├─< classroom_period_states (clôture par classe)
    ├─< classroom_offerings (classe x nœud : fenêtre, capacité, statut — l'ex « cohorte d'UE »)
    └─< enrollments ─< enrollment_courses (option / à la carte / reprise) ─> classroom_offerings
              ├─< enrollment_placements (changements de classe, historisés)
              ├─< enrollment_history (append-only)
              ├─ registration_number ─> registration_numbers (registre : apprenant x programme x niveau)
              └─ funding_type ─> funding_types ; outcome_code ─> enrollment_outcomes
```

## 3. Catalogue des tables

| Table | Rôle | Cardinalité indicative (établissement de 1 500 apprenants) |
|---|---|---|
| `education_levels`, `grade_levels`, `period_types`, `funding_types`, `enrollment_outcomes`, `curriculum_node_types` | Référentiels instanciés depuis le modèle de pack, modifiables par le tenant (sauf `is_system`) | < 100 lignes chacun |
| `institution_settings` | Politique de confirmation d'inscription, durée de réservation, motif du numéro d'inscription | 1 par établissement |
| `template_applications` | Versions de modèle de pack déjà appliquées (idempotence) | quelques lignes |
| `academic_years`, `academic_periods` | Calendrier académique typé | 1 année / établissement / an ; 3 à 12 périodes par année |
| `programs`, `program_grade_levels` | Filières, séries, parcours ; niveaux couverts | 1 à 200 |
| `subjects` | Catalogue réutilisable (matière, ECUE) | 50 à 2 000 |
| `curriculum_versions`, `curriculum_nodes`, `curriculum_prerequisites`, `curriculum_amendments` | Curriculum versionné par programme et année | 1 version par (programme, année) ; 30 à 3 000 nœuds par version |
| `classrooms`, `classroom_period_states` | Classes / promotions et clôture par classe | 20 à 400 par année |
| `classroom_offerings` | Dispensation d'un nœud à une classe (à la carte) | 0 à 5 000 par année |
| `enrollments`, `enrollment_courses`, `enrollment_placements`, `enrollment_history` | Inscription annuelle, sélections, historiques | 1 par apprenant et par an ; history ≈ 5 lignes par inscription |
| `registration_numbers` | Registre des numéros d'inscription (un par apprenant, programme et niveau, stable aux réinscriptions) | 1 par apprenant et par niveau parcouru |

## 4. Les trois décisions de modélisation à connaître

1. **Arbre polymorphe, grammaire en donnée.** Un seul `curriculum_nodes` exprime les quatre packs. Le primaire et le secondaire utilisent `LEVEL > [GROUP] > SUBJECT` (coefficient sur `SUBJECT`) ; le supérieur `LEVEL > PERIOD > UE > ECUE` (crédits sur `UE` et `ECUE`, coefficient sur `ECUE`). Les types, leurs parents admis et leurs attributs autorisés sont des lignes de `curriculum_node_types` ; le déclencheur `curriculum_nodes_guard` les impose (parent admis, matière exigée, niveau exigé, crédits/coefficient autorisés, pas de cycle, pas de modification d'un curriculum verrouillé). Ajouter un type (ex. `MODULE` pour le pack Virtual) = une ligne, pas du code.
2. **Identité d'une position à travers les années : `lineage_id`.** Le curriculum est versionné par (programme, année) ; `cloneCurriculumVersion` copie l'arbre en conservant `lineage_id`. Les prérequis visent une lignée (« avoir validé l'UE de lignée X »), donc restent vrais d'une année à l'autre ; la capitalisation des crédits (spec 019) s'ancre aussi sur la lignée. Une matière mutualisée = un même `subject_id` dans plusieurs nœuds (chacun avec son coefficient, son caractère obligatoire et sa lignée propres), conformément à la décision D11 du PRD de restructuration.
3. **Offre ≠ classe ≠ inscription.** La classe regroupe des apprenants ; l'offre (`classroom_offerings`) est la dispensation d'un nœud à cette classe avec fenêtre d'inscription, capacité et statut — l'ancienne « cohorte d'UE » qui n'avait pas d'entité « classe » (le nom de classe était le préfixe du libellé de cohorte, `split_part(libelle, ' — ', 1)`). L'inscription (`enrollments`) place un apprenant dans une classe pour l'année ; en mode `A_LA_CARTE`, ses `enrollment_courses` désignent les offres suivies. Changer de classe = nouvelle ligne `enrollment_placements`, **pas** une nouvelle inscription : les résultats gardent un `enrollment_id` stable pour toute l'année.

## 5. DDL de référence

### 5.1 Référentiels

<!-- migration: 0700_academic_reference.sql -->
```sql
-- =============================================================================
-- 0700 — Module academic : schéma et référentiels pilotés par les modèles de pack
-- =============================================================================
--
-- Plage de numéros réservée au module academic : 0700–0799 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; plage à inscrire dans ce tableau).
--
-- Règles (module-conventions.md, ADR-002/006/007) :
--   - un module = un schéma (`academic`) ; AUCUNE clé étrangère vers le schéma d'un autre
--     module, sauf `kernel.tenants(id)`. Les références vers `tenancy` (établissement,
--     campus), `people` (élève) et `assess` sont des UUID vérifiés par l'API publique ;
--   - toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, puis
--     `kernel.enable_tenant_rls()`, puis GRANT explicite à `app_user` ;
--   - clés étrangères internes COMPOSITES (tenant_id, id) : une ligne ne peut pas pointer la
--     ligne d'un autre tenant, même en connaissant son UUID (les contrôles de FK contournent
--     la RLS) ;
--   - horodatages `timestamptz` en UTC, dates civiles en `date`, identifiants `uuid` fournis
--     par l'application (`newId()`), pas de montant dans ce module ;
--   - AUCUNE constante réglementaire : seuils et formules relèvent des RuleSets. Les
--     référentiels ci-dessous (niveaux, types de périodes, grammaire du curriculum, types de
--     financement, issues d'année) sont de la DONNÉE instanciée depuis les modèles de pack.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS academic;
REVOKE ALL ON SCHEMA academic FROM PUBLIC;
GRANT USAGE ON SCHEMA academic TO app_user;

-- Extension « de confiance » (PG >= 13) : nécessaire aux contraintes d'exclusion qui mêlent
-- égalité (uuid, text) et chevauchement de plages.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- Cycles d'enseignement (maternelle, primaire, collège, lycée, licence, master, BTS…)
-- -----------------------------------------------------------------------------
CREATE TABLE academic.education_levels (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  ordinal    integer NOT NULL CHECK (ordinal >= 0),
  pack       text CHECK (pack IN ('PRIMARY', 'SECONDARY', 'HIGHER', 'VIRTUAL')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.education_levels');
GRANT SELECT, INSERT, UPDATE ON academic.education_levels TO app_user;

-- -----------------------------------------------------------------------------
-- Niveaux (PS, CP1, 6e, Tle, L1, M2, BTS1…). `next_grade_level_id` est la DONNÉE qui dit
-- vers quel niveau mène un passage ; NULL + is_final = fin de parcours.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.grade_levels (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  education_level_id  uuid NOT NULL,
  code                text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  short_label         text,
  ordinal             integer NOT NULL CHECK (ordinal >= 0),
  next_grade_level_id uuid,
  is_final            boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, education_level_id) REFERENCES academic.education_levels (tenant_id, id),
  FOREIGN KEY (tenant_id, next_grade_level_id) REFERENCES academic.grade_levels (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (next_grade_level_id IS NULL OR next_grade_level_id <> id),
  CHECK (NOT (is_final AND next_grade_level_id IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('academic.grade_levels');
GRANT SELECT, INSERT, UPDATE ON academic.grade_levels TO app_user;

-- -----------------------------------------------------------------------------
-- Types de périodes (composition, trimestre, semestre, session, module…). Aucune
-- périodicité n'est codée en dur : un type est une ligne de données.
--   kind = TEACHING_PERIOD : période d'enseignement (trimestre, semestre, module)
--   kind = EXAM_SESSION    : session d'examen (normale, rattrapage)
-- -----------------------------------------------------------------------------
CREATE TABLE academic.period_types (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  kind       text NOT NULL CHECK (kind IN ('TEACHING_PERIOD', 'EXAM_SESSION')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.period_types');
GRANT SELECT, INSERT, UPDATE ON academic.period_types TO app_user;

-- -----------------------------------------------------------------------------
-- Types de financement de l'apprenant (PRD §20). Le jeu de codes reste celui du module
-- finance (CHECK de finance.learner_accounts) ; ici la DONNÉE est le libellé et l'exigence
-- de référence d'affectation.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.funding_types (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  code                text NOT NULL CHECK (code IN ('PRIVATE', 'STATE_ASSIGNED', 'SCHOLARSHIP', 'COMPANY', 'STAFF_CHILD', 'OTHER')),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  requires_reference  boolean NOT NULL DEFAULT false,
  requires_funder     boolean NOT NULL DEFAULT false,
  sort_order          integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.funding_types');
GRANT SELECT, INSERT, UPDATE ON academic.funding_types TO app_user;

-- -----------------------------------------------------------------------------
-- Issues de fin d'inscription (promu, redoublant, diplômé, orienté, exclu…). `kind` pilote
-- la reconduction annuelle : ADVANCE -> niveau suivant ; REPEAT -> même niveau ;
-- REDIRECT -> programme/niveau désigné ; EXIT -> aucune inscription l'année suivante.
-- La décision elle-même (et ses seuils) vient du module de bulletins / RuleSet.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.enrollment_outcomes (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  kind       text NOT NULL CHECK (kind IN ('ADVANCE', 'REPEAT', 'REDIRECT', 'EXIT')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.enrollment_outcomes');
GRANT SELECT, INSERT, UPDATE ON academic.enrollment_outcomes TO app_user;

-- -----------------------------------------------------------------------------
-- Grammaire de l'arbre de curriculum : quels types de nœuds existent, sous quels parents,
-- avec quels attributs. C'est ce qui rend l'arbre polymorphe : le primaire/secondaire
-- utilisent LEVEL > SUBJECT, le supérieur LEVEL > PERIOD > UE > ECUE.
-- `allowed_parent_codes` contient 'ROOT' pour un nœud de premier niveau.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_node_types (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  code                 text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                text NOT NULL CHECK (length(btrim(label)) > 0),
  allowed_parent_codes text[] NOT NULL CHECK (cardinality(allowed_parent_codes) >= 1),
  requires_grade_level boolean NOT NULL DEFAULT false,
  requires_period_slot boolean NOT NULL DEFAULT false,
  requires_subject     boolean NOT NULL DEFAULT false,
  allows_coefficient   boolean NOT NULL DEFAULT false,
  allows_credits       boolean NOT NULL DEFAULT false,
  credits_must_equal_children boolean NOT NULL DEFAULT false,   -- UE : crédits = somme des crédits des ECUE (contrôlé à la publication)
  is_enrollable        boolean NOT NULL DEFAULT false,
  is_system            boolean NOT NULL DEFAULT false,
  sort_order           integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (NOT (requires_grade_level AND requires_period_slot))
);
SELECT kernel.enable_tenant_rls('academic.curriculum_node_types');
GRANT SELECT, INSERT, UPDATE ON academic.curriculum_node_types TO app_user;

-- -----------------------------------------------------------------------------
-- Paramètres par établissement (une ligne). Politiques d'établissement, PAS des règles
-- réglementaires : leurs valeurs par défaut viennent du modèle de pack.
--   enrollment_confirmation_policy : quand une inscription devient ACTIVE
--       AUTO                        dès la création (écoles sans préalable financier)
--       ON_REGISTRATION_FEE_PAID    quand les frais d'inscription sont soldés ou inexistants
--       ON_FULL_PAYMENT             quand la facture d'inscription est intégralement soldée
--       MANUAL                      par action d'un utilisateur habilité
--   pending_hold_minutes : durée pendant laquelle une place PENDING est réservée (NULL = sans
--       expiration)
--   registration_number_pattern : motif du numéro d'inscription, jetons {PREFIX} {PROGRAM}
--       {LEVEL} {STUDENT_SEQ:n} {YEAR} ; NULL = pas de numéro d'inscription (registre
--       `registration_numbers` : un numéro par apprenant, programme et niveau, stable)
-- -----------------------------------------------------------------------------
CREATE TABLE academic.institution_settings (
  tenant_id                      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id                 uuid NOT NULL,
  enrollment_confirmation_policy text NOT NULL DEFAULT 'AUTO'
    CHECK (enrollment_confirmation_policy IN ('AUTO', 'ON_REGISTRATION_FEE_PAID', 'ON_FULL_PAYMENT', 'MANUAL')),
  -- Confirmation d'une SÉLECTION de cours à la carte (indépendante de celle de l'inscription) :
  --   AUTO          dès la demande ; ON_LINE_PAID  quand la ligne de facture de la sélection est
  --   soldée (sourceRef = enrollmentCourseId) ; MANUAL  par action d'un utilisateur habilité.
  course_confirmation_policy     text NOT NULL DEFAULT 'ON_LINE_PAID'
    CHECK (course_confirmation_policy IN ('AUTO', 'ON_LINE_PAID', 'MANUAL')),
  pending_hold_minutes           integer CHECK (pending_hold_minutes IS NULL OR pending_hold_minutes > 0),
  registration_number_prefix     text CHECK (registration_number_prefix IS NULL OR registration_number_prefix ~ '^[A-Z0-9]{1,12}$'),
  registration_number_pattern    text CHECK (registration_number_pattern IS NULL OR length(registration_number_pattern) BETWEEN 3 AND 80),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);
SELECT kernel.enable_tenant_rls('academic.institution_settings');
GRANT SELECT, INSERT, UPDATE ON academic.institution_settings TO app_user;

-- Versions de modèle de pack appliquées (idempotence de instantiatePackReferenceData).
CREATE TABLE academic.template_applications (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  pack            text NOT NULL CHECK (pack IN ('PRIMARY', 'SECONDARY', 'HIGHER', 'VIRTUAL')),
  education_system text NOT NULL,
  template_version integer NOT NULL CHECK (template_version >= 1),
  applied_at      timestamptz NOT NULL DEFAULT now(),
  applied_by      uuid,
  summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, pack, education_system, template_version)
);
SELECT kernel.enable_tenant_rls('academic.template_applications');
GRANT SELECT, INSERT ON academic.template_applications TO app_user;
```

### 5.2 Années et périodes

<!-- migration: 0701_academic_calendar.sql -->
```sql
-- =============================================================================
-- 0701 — Module academic : années académiques et périodes typées
-- =============================================================================
--
-- L'année académique est LA source unique (fin des cinq dérivations « pivot au 1er septembre »
-- du code historique). Une année appartient à un établissement : un groupe qui exploite un
-- collège et une grande école peut avoir des calendriers différents.
-- Règle héritée de 0118 : deux années d'un même établissement ne se chevauchent jamais
-- (contrainte d'exclusion ci-dessous) et ne laissent aucun trou entre elles (règle appliquée
-- par `createAcademicYear`, vérifiable par `academic.find_year_gaps()`).
-- =============================================================================

CREATE TABLE academic.academic_years (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,                       -- tenancy.institutions.id (sans FK)
  code           text NOT NULL CHECK (code ~ '^[0-9A-Za-z][0-9A-Za-z_./-]{0,19}$'),   -- '2026-2027'
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED')),
  is_current     boolean NOT NULL DEFAULT false,
  opened_at      timestamptz,
  closed_at      timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (ends_on > starts_on),
  CHECK (NOT is_current OR status = 'OPEN'),
  EXCLUDE USING gist (
    tenant_id WITH =,
    institution_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('academic.academic_years');
-- Une seule année courante par établissement.
CREATE UNIQUE INDEX academic_years_one_current
  ON academic.academic_years (tenant_id, institution_id) WHERE is_current;
CREATE INDEX academic_years_by_institution
  ON academic.academic_years (tenant_id, institution_id, starts_on DESC);
GRANT SELECT, INSERT, UPDATE ON academic.academic_years TO app_user;

-- Contrôle d'exploitation : années consécutives sans trou (0118).
-- Renvoie les couples (année précédente, année suivante) séparés par plus d'un jour.
CREATE FUNCTION academic.find_year_gaps()
RETURNS TABLE (institution_id uuid, previous_year_id uuid, next_year_id uuid, gap_days integer)
LANGUAGE sql STABLE AS $$
  SELECT y.institution_id, y.id, y.next_id, (y.next_start - y.ends_on - 1)::integer
    FROM (
      SELECT a.institution_id, a.id, a.ends_on,
             lead(a.id)        OVER w AS next_id,
             lead(a.starts_on) OVER w AS next_start
        FROM academic.academic_years a
       WHERE a.tenant_id = kernel.current_tenant_id()
      WINDOW w AS (PARTITION BY a.institution_id ORDER BY a.starts_on)
    ) y
   WHERE y.next_id IS NOT NULL AND y.next_start - y.ends_on > 1
$$;
GRANT EXECUTE ON FUNCTION academic.find_year_gaps() TO app_user;

-- -----------------------------------------------------------------------------
-- Périodes typées d'une année. Arbre à deux niveaux d'imbrication maximum sous l'année :
-- année > semestre > session (normale / rattrapage). Les périodes sœurs de même type ne se
-- chevauchent pas ; un enfant tient dans son parent (déclencheur ci-dessous).
--
-- status : PLANNED -> OPEN -> GRADING_CLOSED -> CLOSED
--   GRADING_CLOSED : la saisie et la correction des notes sont arrêtées (« clôture des notes »)
--   CLOSED         : résultats et bulletins arrêtés (« clôture des bulletins »)
-- La réouverture (pas en arrière) est une opération sensible, motivée et auditée.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.academic_periods (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  academic_year_id  uuid NOT NULL,
  parent_period_id  uuid,
  period_type_code  text NOT NULL,
  ordinal           integer NOT NULL CHECK (ordinal >= 1),
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label             text NOT NULL CHECK (length(btrim(label)) > 0),
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,
  status            text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'OPEN', 'GRADING_CLOSED', 'CLOSED')),
  opened_at         timestamptz,
  grading_closed_at timestamptz,
  closed_at         timestamptz,
  closed_by         uuid,
  reopened_count    integer NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, academic_year_id, code),
  CHECK (ends_on >= starts_on),
  CHECK (parent_period_id IS NULL OR parent_period_id <> id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic.academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_period_id) REFERENCES academic.academic_periods (tenant_id, id),
  FOREIGN KEY (tenant_id, period_type_code) REFERENCES academic.period_types (tenant_id, code),
  EXCLUDE USING gist (
    tenant_id WITH =,
    academic_year_id WITH =,
    (coalesce(parent_period_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    period_type_code WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('academic.academic_periods');
-- Numéro d'ordre unique parmi les périodes sœurs de même type.
CREATE UNIQUE INDEX academic_periods_ordinal_unique
  ON academic.academic_periods (
    tenant_id, academic_year_id,
    (coalesce(parent_period_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    period_type_code, ordinal);
CREATE INDEX academic_periods_by_year ON academic.academic_periods (tenant_id, academic_year_id, starts_on);
GRANT SELECT, INSERT, UPDATE ON academic.academic_periods TO app_user;

-- Garde : une période tient dans son année et dans son parent, parent de la même année,
-- profondeur <= 2 niveaux sous l'année, statut cohérent avec les horodatages.
CREATE FUNCTION academic.academic_periods_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_year   academic.academic_years%ROWTYPE;
  v_parent academic.academic_periods%ROWTYPE;
BEGIN
  SELECT * INTO v_year FROM academic.academic_years
   WHERE tenant_id = NEW.tenant_id AND id = NEW.academic_year_id;
  IF NEW.starts_on < v_year.starts_on OR NEW.ends_on > v_year.ends_on THEN
    RAISE EXCEPTION 'academic.period_outside_year: la période % (% -> %) dépasse l''année % (% -> %)',
      NEW.code, NEW.starts_on, NEW.ends_on, v_year.code, v_year.starts_on, v_year.ends_on
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.parent_period_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM academic.academic_periods
     WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_period_id;
    IF v_parent.academic_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'academic.period_parent_other_year: le parent appartient à une autre année'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_parent.parent_period_id IS NOT NULL THEN
      -- année > période > sous-période : pas plus profond.
      IF EXISTS (SELECT 1 FROM academic.academic_periods g
                  WHERE g.tenant_id = NEW.tenant_id AND g.id = v_parent.parent_period_id AND g.parent_period_id IS NOT NULL) THEN
        RAISE EXCEPTION 'academic.period_too_deep: au plus trois niveaux de périodes'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.starts_on < v_parent.starts_on OR NEW.ends_on > v_parent.ends_on THEN
      RAISE EXCEPTION 'academic.period_outside_parent: la période % dépasse son parent %', NEW.code, v_parent.code
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.academic_year_id <> OLD.academic_year_id OR NEW.period_type_code <> OLD.period_type_code THEN
      RAISE EXCEPTION 'academic.period_identity_immutable: année et type d''une période sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- Pas de saut d'état : PLANNED -> OPEN -> GRADING_CLOSED -> CLOSED, retour d'un seul pas (réouverture).
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'PLANNED'        AND NEW.status = 'OPEN') OR
        (OLD.status = 'OPEN'           AND NEW.status IN ('GRADING_CLOSED', 'PLANNED')) OR
        (OLD.status = 'GRADING_CLOSED' AND NEW.status IN ('CLOSED', 'OPEN')) OR
        (OLD.status = 'CLOSED'         AND NEW.status = 'GRADING_CLOSED')
      ) THEN
        RAISE EXCEPTION 'academic.period_transition: % -> % interdit', OLD.status, NEW.status
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    -- Les bornes d'une période close ne bougent plus.
    IF OLD.status IN ('GRADING_CLOSED', 'CLOSED') AND (NEW.starts_on <> OLD.starts_on OR NEW.ends_on <> OLD.ends_on) THEN
      RAISE EXCEPTION 'academic.period_closed_dates: les dates d''une période close sont figées'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER academic_periods_guard BEFORE INSERT OR UPDATE ON academic.academic_periods
  FOR EACH ROW EXECUTE FUNCTION academic.academic_periods_guard();

-- Une période ne se supprime pas si quelque chose la référence (les autres modules la citent
-- par UUID sans FK) : on la désactive en la laissant ; la suppression n'est autorisée que
-- tant que la période est PLANNED.
CREATE FUNCTION academic.academic_periods_no_delete_started() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'academic.period_delete_forbidden: la période % est % ; elle ne peut plus être supprimée', OLD.code, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER academic_periods_no_delete BEFORE DELETE ON academic.academic_periods
  FOR EACH ROW EXECUTE FUNCTION academic.academic_periods_no_delete_started();
GRANT DELETE ON academic.academic_periods TO app_user;
```

### 5.3 Programmes, matières, curriculum

<!-- migration: 0702_academic_curriculum.sql -->
```sql
-- =============================================================================
-- 0702 — Module academic : programmes, matières, curriculum polymorphe versionné
-- =============================================================================
--
-- Un seul arbre `curriculum_nodes` exprime tous les packs :
--   primaire / secondaire :  LEVEL > SUBJECT(coefficient)                  ou  LEVEL > GROUP > SUBJECT
--   supérieur (LMD, BTS)  :  LEVEL > PERIOD(semestre) > UE(crédits) > ECUE(crédits, coefficient)
-- La grammaire (quel type sous quel parent) est de la DONNÉE (`curriculum_node_types`),
-- contrôlée par un déclencheur. Un curriculum est versionné par année académique : on le
-- clone d'une année à l'autre (`lineage_id` conserve l'identité d'une position à travers
-- les clones, pour les prérequis et la capitalisation inter-annuelle).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Programmes : filière (supérieur), série / spécialité / option (secondaire), parcours
-- général (primaire). `parent_program_id` modélise série > spécialité (2 niveaux max).
-- Plus aucune détection par expression régulière sur le nom (« licence 1 »…) : le cycle est
-- `education_level_id`, le niveau est un `grade_levels`.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.programs (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid NOT NULL,                   -- tenancy.institutions.id (sans FK)
  education_level_id  uuid NOT NULL,
  parent_program_id   uuid,
  code                text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  kind_code           text NOT NULL DEFAULT 'PROGRAM' CHECK (kind_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  domain_code         text CHECK (domain_code IS NULL OR domain_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  description         text,
  duration_months     integer CHECK (duration_months IS NULL OR duration_months > 0),
  attributes          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),   -- ex. niveau de certification, type de cycle propre au système éducatif
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (parent_program_id IS NULL OR parent_program_id <> id),
  FOREIGN KEY (tenant_id, education_level_id) REFERENCES academic.education_levels (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_program_id) REFERENCES academic.programs (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.programs');
CREATE INDEX programs_by_institution ON academic.programs (tenant_id, institution_id, status);
GRANT SELECT, INSERT, UPDATE ON academic.programs TO app_user;

-- Niveaux couverts par un programme (L1, L2, L3 pour une licence ; 2nde, 1ère, Tle pour une série).
CREATE TABLE academic.program_grade_levels (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  program_id     uuid NOT NULL,
  grade_level_id uuid NOT NULL,
  ordinal        integer NOT NULL CHECK (ordinal >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, program_id, grade_level_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES academic.programs (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_level_id) REFERENCES academic.grade_levels (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.program_grade_levels');
GRANT SELECT, INSERT, UPDATE, DELETE ON academic.program_grade_levels TO app_user;

-- Contrôle d'intégrité : le parent d'un programme est du même établissement, pas de cycle.
CREATE FUNCTION academic.programs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_parent academic.programs%ROWTYPE;
BEGIN
  IF NEW.parent_program_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM academic.programs WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_program_id;
    IF v_parent.institution_id <> NEW.institution_id THEN
      RAISE EXCEPTION 'academic.program_parent_other_institution: le programme parent est d''un autre établissement'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_parent.parent_program_id IS NOT NULL THEN
      RAISE EXCEPTION 'academic.program_too_deep: deux niveaux de programmes au plus (série > spécialité)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.institution_id <> OLD.institution_id THEN
    RAISE EXCEPTION 'academic.program_institution_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER programs_guard BEFORE INSERT OR UPDATE ON academic.programs
  FOR EACH ROW EXECUTE FUNCTION academic.programs_guard();

-- -----------------------------------------------------------------------------
-- Catalogue des matières (Subject / ECUE réutilisable). Une matière peut apparaître dans
-- plusieurs nœuds (mutualisation d'une ECUE entre plusieurs UE, d'une matière entre séries).
-- Les supports de cours, devoirs et évaluations s'accrochent à `subjects.id` lorsqu'ils sont
-- mutualisables, au nœud sinon (choix du module d'évaluation).
-- -----------------------------------------------------------------------------
CREATE TABLE academic.subjects (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid,                                  -- NULL = commune à tous les établissements du tenant
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  short_label    text,
  domain_code    text CHECK (domain_code IS NULL OR domain_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  description    text,
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.subjects');
GRANT SELECT, INSERT, UPDATE ON academic.subjects TO app_user;

-- -----------------------------------------------------------------------------
-- Version de curriculum : un programme, une année académique, un arbre.
--   DRAFT      structure librement modifiable
--   PUBLISHED  publiée : seuls libellés, coefficients, crédits, volumes horaires sont modifiables
--              (journalisés dans curriculum_amendments) ; la structure ne bouge que par
--              `amendPublishedCurriculum` (réglage de session `academic.structural_change`)
--   LOCKED     verrouillée à la clôture de l'année : plus aucune modification
--   ARCHIVED   historique
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_versions (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  program_id            uuid NOT NULL,
  academic_year_id      uuid NOT NULL,
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'LOCKED', 'ARCHIVED')),
  cloned_from_version_id uuid,
  published_at          timestamptz,
  published_by          uuid,
  locked_at             timestamptz,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, program_id, academic_year_id),
  CHECK ((status = 'DRAFT') = (published_at IS NULL)),
  FOREIGN KEY (tenant_id, program_id) REFERENCES academic.programs (tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic.academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, cloned_from_version_id) REFERENCES academic.curriculum_versions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.curriculum_versions');
GRANT SELECT, INSERT, UPDATE ON academic.curriculum_versions TO app_user;

CREATE FUNCTION academic.curriculum_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.program_id <> OLD.program_id OR NEW.academic_year_id <> OLD.academic_year_id THEN
      RAISE EXCEPTION 'academic.version_identity_immutable: programme et année d''une version sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT'     AND NEW.status = 'PUBLISHED') OR
         (OLD.status = 'PUBLISHED' AND NEW.status IN ('LOCKED', 'DRAFT')) OR
         (OLD.status = 'LOCKED'    AND NEW.status = 'ARCHIVED')) THEN
      RAISE EXCEPTION 'academic.version_transition: % -> % interdit', OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER curriculum_versions_guard BEFORE INSERT OR UPDATE ON academic.curriculum_versions
  FOR EACH ROW EXECUTE FUNCTION academic.curriculum_versions_guard();

-- -----------------------------------------------------------------------------
-- Nœuds du curriculum
--   id          identifiant stable consommé par assess / reportcards / higher (curriculum_node_id)
--   lineage_id  identité de la POSITION à travers les clones d'une année à l'autre
--   subject_id  matière du catalogue (types qui l'exigent : SUBJECT, ECUE)
--   grade_level_id  pour LEVEL ; period_type_code + period_ordinal pour PERIOD
--   coefficient / credits : optionnels, autorisés selon le type
--   is_mandatory : obligatoire (true) ou à option (false)
--   is_transversal : matière transversale (ex. conduite) : jamais inscrite à la carte, jamais
--                    affectée à un enseignant, comptée dans les moyennes selon le RuleSet
--   category_code : regroupement d'affichage (ex. UE fondamentale / spécialité / culture générale)
--   attributes : paramètres propres à un type, validés par Zod côté module (ex. choix {min,max})
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_nodes (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  version_id        uuid NOT NULL,
  parent_id         uuid,
  node_type_code    text NOT NULL,
  lineage_id        uuid NOT NULL,
  subject_id        uuid,
  grade_level_id    uuid,
  period_type_code  text,
  period_ordinal    integer CHECK (period_ordinal IS NULL OR period_ordinal >= 1),
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label             text NOT NULL CHECK (length(btrim(label)) > 0),
  ordinal           integer NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  coefficient       numeric(7, 3) CHECK (coefficient IS NULL OR coefficient > 0),
  credits           numeric(6, 2) CHECK (credits IS NULL OR credits >= 0),
  is_mandatory      boolean NOT NULL DEFAULT true,
  is_transversal    boolean NOT NULL DEFAULT false,
  category_code     text CHECK (category_code IS NULL OR category_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  hours_total       numeric(7, 2) CHECK (hours_total IS NULL OR hours_total >= 0),
  hours_lecture     numeric(7, 2) CHECK (hours_lecture IS NULL OR hours_lecture >= 0),      -- CM
  hours_tutorial    numeric(7, 2) CHECK (hours_tutorial IS NULL OR hours_tutorial >= 0),    -- TD
  hours_practical   numeric(7, 2) CHECK (hours_practical IS NULL OR hours_practical >= 0),  -- TP
  attributes        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, version_id, id),
  UNIQUE (tenant_id, version_id, lineage_id),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK ((period_type_code IS NULL) = (period_ordinal IS NULL)),
  CHECK (hours_total IS NULL OR coalesce(hours_lecture, 0) + coalesce(hours_tutorial, 0) + coalesce(hours_practical, 0) <= hours_total),
  FOREIGN KEY (tenant_id, version_id) REFERENCES academic.curriculum_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id, parent_id) REFERENCES academic.curriculum_nodes (tenant_id, version_id, id),
  FOREIGN KEY (tenant_id, node_type_code) REFERENCES academic.curriculum_node_types (tenant_id, code),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES academic.subjects (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_level_id) REFERENCES academic.grade_levels (tenant_id, id),
  FOREIGN KEY (tenant_id, period_type_code) REFERENCES academic.period_types (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.curriculum_nodes');
-- Code unique parmi les frères (affichage, imports).
CREATE UNIQUE INDEX curriculum_nodes_sibling_code
  ON academic.curriculum_nodes (tenant_id, version_id, (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)), code);
CREATE INDEX curriculum_nodes_by_parent ON academic.curriculum_nodes (tenant_id, version_id, parent_id, ordinal);
CREATE INDEX curriculum_nodes_by_subject ON academic.curriculum_nodes (tenant_id, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX curriculum_nodes_by_lineage ON academic.curriculum_nodes (tenant_id, lineage_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON academic.curriculum_nodes TO app_user;

CREATE FUNCTION academic.curriculum_nodes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ver     academic.curriculum_versions%ROWTYPE;
  v_type    academic.curriculum_node_types%ROWTYPE;
  v_ptype   text;
  v_cycle   boolean;
  v_depth   integer;
  v_struct  boolean := coalesce(current_setting('academic.structural_change', true), '') = 'on';
  v_row     academic.curriculum_nodes%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

  SELECT * INTO v_ver FROM academic.curriculum_versions WHERE tenant_id = v_row.tenant_id AND id = v_row.version_id;

  -- Verrouillage par statut de version.
  IF v_ver.status IN ('LOCKED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'academic.curriculum_locked: la version du curriculum est % ; aucune modification', v_ver.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_ver.status = 'PUBLISHED' AND NOT v_struct THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'academic.curriculum_published: la structure d''un curriculum publié ne change que par amendement'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.node_type_code <> OLD.node_type_code
       OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.grade_level_id IS DISTINCT FROM OLD.grade_level_id
       OR NEW.period_type_code IS DISTINCT FROM OLD.period_type_code OR NEW.period_ordinal IS DISTINCT FROM OLD.period_ordinal
       OR NEW.is_mandatory <> OLD.is_mandatory OR NEW.is_transversal <> OLD.is_transversal THEN
      RAISE EXCEPTION 'academic.curriculum_published: modification structurelle refusée sur un curriculum publié'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT * INTO v_type FROM academic.curriculum_node_types WHERE tenant_id = NEW.tenant_id AND code = NEW.node_type_code;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.lineage_id <> OLD.lineage_id OR NEW.version_id <> OLD.version_id OR NEW.node_type_code <> OLD.node_type_code THEN
      RAISE EXCEPTION 'academic.node_identity_immutable: version, type et lignée d''un nœud sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  -- Grammaire : le type du parent doit figurer dans les parents admis.
  IF NEW.parent_id IS NULL THEN
    IF NOT ('ROOT' = ANY (v_type.allowed_parent_codes)) THEN
      RAISE EXCEPTION 'academic.node_needs_parent: un nœud % ne peut pas être à la racine', NEW.node_type_code
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT node_type_code INTO v_ptype FROM academic.curriculum_nodes
     WHERE tenant_id = NEW.tenant_id AND version_id = NEW.version_id AND id = NEW.parent_id;
    IF NOT (v_ptype = ANY (v_type.allowed_parent_codes)) THEN
      RAISE EXCEPTION 'academic.node_bad_parent: un nœud % ne peut pas être sous un nœud %', NEW.node_type_code, v_ptype
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      WITH RECURSIVE anc(id, parent_id, depth) AS (
        SELECT n.id, n.parent_id, 1 FROM academic.curriculum_nodes n
         WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.parent_id
        UNION ALL
        SELECT n.id, n.parent_id, a.depth + 1 FROM academic.curriculum_nodes n
          JOIN anc a ON n.id = a.parent_id AND n.tenant_id = NEW.tenant_id
         WHERE a.depth < 16
      )
      SELECT bool_or(id = NEW.id), coalesce(max(depth), 0) INTO v_cycle, v_depth FROM anc;
      IF coalesce(v_cycle, false) THEN
        RAISE EXCEPTION 'academic.node_cycle: ce déplacement créerait un cycle' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Attributs exigés ou interdits par le type.
  IF v_type.requires_subject AND NEW.subject_id IS NULL THEN
    RAISE EXCEPTION 'academic.node_subject_required: un nœud % exige une matière', NEW.node_type_code USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_type.requires_subject AND NEW.subject_id IS NOT NULL THEN
    RAISE EXCEPTION 'academic.node_subject_forbidden: un nœud % ne porte pas de matière', NEW.node_type_code USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_grade_level AND NEW.grade_level_id IS NULL THEN
    RAISE EXCEPTION 'academic.node_grade_level_required' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_type.requires_grade_level AND NEW.grade_level_id IS NOT NULL THEN
    RAISE EXCEPTION 'academic.node_grade_level_forbidden' USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_period_slot AND NEW.period_type_code IS NULL THEN
    RAISE EXCEPTION 'academic.node_period_slot_required' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_type.requires_period_slot AND NEW.period_type_code IS NOT NULL THEN
    RAISE EXCEPTION 'academic.node_period_slot_forbidden' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.coefficient IS NOT NULL AND NOT v_type.allows_coefficient THEN
    RAISE EXCEPTION 'academic.node_coefficient_forbidden: pas de coefficient sur un nœud %', NEW.node_type_code USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.credits IS NOT NULL AND NOT v_type.allows_credits THEN
    RAISE EXCEPTION 'academic.node_credits_forbidden: pas de crédits sur un nœud %', NEW.node_type_code USING ERRCODE = 'check_violation';
  END IF;

  -- Un nœud LEVEL ne peut viser qu'un niveau couvert par le programme de la version.
  IF v_type.requires_grade_level AND NOT EXISTS (
       SELECT 1 FROM academic.program_grade_levels pgl
        WHERE pgl.tenant_id = NEW.tenant_id AND pgl.program_id = v_ver.program_id AND pgl.grade_level_id = NEW.grade_level_id) THEN
    RAISE EXCEPTION 'academic.node_level_not_in_program: le niveau n''est pas couvert par le programme' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER curriculum_nodes_guard BEFORE INSERT OR UPDATE OR DELETE ON academic.curriculum_nodes
  FOR EACH ROW EXECUTE FUNCTION academic.curriculum_nodes_guard();

-- -----------------------------------------------------------------------------
-- Prérequis : « pour s'inscrire à ce nœud, il faut avoir VALIDÉ la position X » (logique ET).
-- La cible est une lignée (lineage_id) : le prérequis reste vrai d'une année à l'autre et
-- d'un clone de curriculum à l'autre. Pas d'auto-référence, pas de cycle (déclencheur).
-- Même établissement ; programmes différents admis (mutualisation inter-filières).
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_prerequisites (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  version_id           uuid NOT NULL,
  node_id              uuid NOT NULL,
  required_lineage_id  uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, node_id, required_lineage_id),
  FOREIGN KEY (tenant_id, version_id, node_id) REFERENCES academic.curriculum_nodes (tenant_id, version_id, id) ON DELETE CASCADE
);
SELECT kernel.enable_tenant_rls('academic.curriculum_prerequisites');
CREATE INDEX curriculum_prerequisites_by_required ON academic.curriculum_prerequisites (tenant_id, required_lineage_id);
GRANT SELECT, INSERT, DELETE ON academic.curriculum_prerequisites TO app_user;

CREATE FUNCTION academic.curriculum_prerequisites_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_node_lineage uuid;
  v_status       text;
  v_institution  uuid;
  v_cycle        boolean;
BEGIN
  SELECT n.lineage_id, v.status, p.institution_id INTO v_node_lineage, v_status, v_institution
    FROM academic.curriculum_nodes n
    JOIN academic.curriculum_versions v ON v.tenant_id = n.tenant_id AND v.id = n.version_id
    JOIN academic.programs p ON p.tenant_id = v.tenant_id AND p.id = v.program_id
   WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.node_id;
  IF v_node_lineage = NEW.required_lineage_id THEN
    RAISE EXCEPTION 'academic.prerequisite_self: un nœud ne peut pas être son propre prérequis' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status IN ('LOCKED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'academic.curriculum_locked' USING ERRCODE = 'restrict_violation';
  END IF;
  -- Un prérequis est de la structure : sur un curriculum publié, seul un amendement le change.
  IF v_status = 'PUBLISHED' AND coalesce(current_setting('academic.structural_change', true), '') <> 'on' THEN
    RAISE EXCEPTION 'academic.curriculum_published: un prérequis d''un curriculum publié ne change que par amendement' USING ERRCODE = 'restrict_violation';
  END IF;
  -- La lignée visée existe dans le même établissement.
  IF NOT EXISTS (
       SELECT 1 FROM academic.curriculum_nodes rn
         JOIN academic.curriculum_versions rv ON rv.tenant_id = rn.tenant_id AND rv.id = rn.version_id
         JOIN academic.programs rp ON rp.tenant_id = rv.tenant_id AND rp.id = rv.program_id
        WHERE rn.tenant_id = NEW.tenant_id AND rn.lineage_id = NEW.required_lineage_id AND rp.institution_id = v_institution) THEN
    RAISE EXCEPTION 'academic.prerequisite_unknown_lineage: prérequis inconnu dans cet établissement' USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- Cycle : le prérequis ne doit pas (transitivement) exiger le nœud courant.
  WITH RECURSIVE chain(lineage_id, depth) AS (
    SELECT NEW.required_lineage_id, 1
    UNION ALL
    SELECT pr.required_lineage_id, c.depth + 1
      FROM chain c
      JOIN academic.curriculum_nodes cn ON cn.tenant_id = NEW.tenant_id AND cn.lineage_id = c.lineage_id
      JOIN academic.curriculum_prerequisites pr ON pr.tenant_id = NEW.tenant_id AND pr.node_id = cn.id
     WHERE c.depth < 32
  )
  SELECT bool_or(lineage_id = v_node_lineage) INTO v_cycle FROM chain;
  IF coalesce(v_cycle, false) THEN
    RAISE EXCEPTION 'academic.prerequisite_cycle: ce prérequis créerait un cycle' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER curriculum_prerequisites_guard BEFORE INSERT ON academic.curriculum_prerequisites
  FOR EACH ROW EXECUTE FUNCTION academic.curriculum_prerequisites_guard();

CREATE FUNCTION academic.curriculum_prerequisites_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT v.status INTO v_status
    FROM academic.curriculum_versions v WHERE v.tenant_id = OLD.tenant_id AND v.id = OLD.version_id;
  IF v_status IN ('LOCKED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'academic.curriculum_locked' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_status = 'PUBLISHED' AND coalesce(current_setting('academic.structural_change', true), '') <> 'on' THEN
    RAISE EXCEPTION 'academic.curriculum_published: un prérequis d''un curriculum publié ne change que par amendement' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER curriculum_prerequisites_delete_guard BEFORE DELETE ON academic.curriculum_prerequisites
  FOR EACH ROW EXECUTE FUNCTION academic.curriculum_prerequisites_delete_guard();

-- -----------------------------------------------------------------------------
-- Journal des amendements d'un curriculum publié (coefficient, crédits, structure).
-- Append-only. Lu par le moteur de résultats pour signaler les recalculs nécessaires.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_amendments (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  version_id  uuid NOT NULL,
  node_id     uuid,
  kind        text NOT NULL CHECK (kind IN ('NODE_ADDED', 'NODE_REMOVED', 'NODE_MOVED', 'COEFFICIENT', 'CREDITS', 'MANDATORY', 'PREREQUISITE', 'OTHER')),
  old_value   jsonb,
  new_value   jsonb,
  reason      text NOT NULL CHECK (length(btrim(reason)) >= 5),
  amended_by  uuid NOT NULL,
  amended_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES academic.curriculum_versions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.curriculum_amendments');
CREATE INDEX curriculum_amendments_by_version ON academic.curriculum_amendments (tenant_id, version_id, amended_at DESC);
GRANT SELECT, INSERT ON academic.curriculum_amendments TO app_user;
```

### 5.4 Classes, offres, inscriptions

<!-- migration: 0703_academic_classrooms_enrollments.sql -->
```sql
-- =============================================================================
-- 0703 — Module academic : classes / promotions, offres, inscriptions
-- =============================================================================
--
-- Vocabulaire (glossaire ADR-007) :
--   Classroom = la CLASSE ou PROMOTION (« 6e A », « Licence 2 Informatique — promotion 2026 »),
--               jamais la salle physique (qui est `scheduling.rooms`).
--   Offering  = la dispensation d'un nœud du curriculum à une classe pendant une fenêtre
--               (l'ancienne « cohorte / session d'UE ») : dates, fenêtre d'inscription,
--               capacité, statut. Obligatoire pour l'inscription à la carte, facultative sinon.
--   Enrollment = l'inscription annuelle d'un apprenant dans une classe ; elle HISTORISE (le
--               dossier permanent de l'élève ne change jamais).
-- =============================================================================

CREATE TABLE academic.classrooms (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id         uuid NOT NULL,                 -- tenancy.institutions.id (sans FK)
  campus_id              uuid,                          -- tenancy.campuses.id (sans FK)
  academic_year_id       uuid NOT NULL,
  program_id             uuid NOT NULL,
  grade_level_id         uuid NOT NULL,
  curriculum_version_id  uuid,                          -- NULL tant que le curriculum n'est pas choisi
  kind                   text NOT NULL DEFAULT 'CLASS' CHECK (kind IN ('CLASS', 'COHORT')),
  code                   text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  name                   text NOT NULL CHECK (length(btrim(name)) > 0),
  capacity               integer CHECK (capacity IS NULL OR capacity > 0),
  capacity_is_hard       boolean NOT NULL DEFAULT true,       -- parité : le legacy refusait au-delà de la capacité (NULL = illimité)
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED')),
  starts_on              date,
  ends_on                date,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, academic_year_id, program_id, grade_level_id, code),
  UNIQUE (tenant_id, academic_year_id, program_id, grade_level_id, name),
  -- Une classe n'est active qu'avec un curriculum choisi (publié : contrôlé par le déclencheur).
  CHECK (status IN ('DRAFT', 'CANCELLED') OR curriculum_version_id IS NOT NULL),
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic.academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES academic.programs (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_level_id) REFERENCES academic.grade_levels (tenant_id, id),
  FOREIGN KEY (tenant_id, curriculum_version_id) REFERENCES academic.curriculum_versions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.classrooms');
CREATE INDEX classrooms_by_year ON academic.classrooms (tenant_id, academic_year_id, institution_id, status);
CREATE INDEX classrooms_by_program ON academic.classrooms (tenant_id, program_id, grade_level_id);
GRANT SELECT, INSERT, UPDATE ON academic.classrooms TO app_user;

-- Cohérence : la version de curriculum est celle du programme ET de l'année de la classe ; le
-- niveau est couvert par le programme ; l'établissement ne change pas.
CREATE FUNCTION academic.classrooms_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ver  academic.curriculum_versions%ROWTYPE;
  v_year academic.academic_years%ROWTYPE;
BEGIN
  SELECT * INTO v_year FROM academic.academic_years WHERE tenant_id = NEW.tenant_id AND id = NEW.academic_year_id;
  IF v_year.institution_id <> NEW.institution_id THEN
    RAISE EXCEPTION 'academic.classroom_year_institution: l''année appartient à un autre établissement' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM academic.program_grade_levels g
                  WHERE g.tenant_id = NEW.tenant_id AND g.program_id = NEW.program_id AND g.grade_level_id = NEW.grade_level_id) THEN
    RAISE EXCEPTION 'academic.classroom_level_not_in_program: le niveau n''est pas couvert par le programme' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.curriculum_version_id IS NOT NULL THEN
    SELECT * INTO v_ver FROM academic.curriculum_versions WHERE tenant_id = NEW.tenant_id AND id = NEW.curriculum_version_id;
    IF v_ver.program_id <> NEW.program_id OR v_ver.academic_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'academic.classroom_curriculum_mismatch: la version de curriculum ne correspond pas au programme et à l''année' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ver.status = 'DRAFT' AND NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'academic.classroom_curriculum_draft: le curriculum doit être publié avant d''activer la classe' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id
       OR NEW.program_id <> OLD.program_id OR NEW.grade_level_id <> OLD.grade_level_id THEN
      RAISE EXCEPTION 'academic.classroom_identity_immutable: établissement, année, programme et niveau d''une classe sont figés' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT'     AND NEW.status IN ('ACTIVE', 'CANCELLED')) OR
         (OLD.status = 'ACTIVE'    AND NEW.status IN ('COMPLETED', 'CANCELLED', 'DRAFT')) OR
         (OLD.status = 'COMPLETED' AND NEW.status IN ('ARCHIVED', 'ACTIVE')) OR
         (OLD.status = 'CANCELLED' AND NEW.status IN ('DRAFT')) OR
         (OLD.status = 'ARCHIVED'  AND NEW.status = 'COMPLETED')) THEN
      RAISE EXCEPTION 'academic.classroom_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER classrooms_guard BEFORE INSERT OR UPDATE ON academic.classrooms
  FOR EACH ROW EXECUTE FUNCTION academic.classrooms_guard();

-- -----------------------------------------------------------------------------
-- Clôture par classe : l'état EFFECTIF d'une période pour une classe est le plus avancé de
-- (statut de la période, statut de la classe dans la période). Permet de clore les notes d'une
-- classe sans clore celles d'une autre (bug historique : la clôture d'un semestre fermait
-- toutes les cohortes de l'UE, tous noms de classe confondus).
-- -----------------------------------------------------------------------------
CREATE TABLE academic.classroom_period_states (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id  uuid NOT NULL,
  period_id     uuid NOT NULL,
  status        text NOT NULL CHECK (status IN ('OPEN', 'GRADING_CLOSED', 'CLOSED')),
  changed_at    timestamptz NOT NULL DEFAULT now(),
  changed_by    uuid,
  reason        text,
  PRIMARY KEY (tenant_id, classroom_id, period_id),
  FOREIGN KEY (tenant_id, classroom_id) REFERENCES academic.classrooms (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES academic.academic_periods (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.classroom_period_states');
GRANT SELECT, INSERT, UPDATE ON academic.classroom_period_states TO app_user;

-- -----------------------------------------------------------------------------
-- Offres (ancienne « cohorte / session d'UE »)
--   status : DRAFT -> OPEN <-> FULL -> IN_PROGRESS -> COMPLETED ; CANCELLED terminal.
--   FULL n'est jamais posé à la main : il est dérivé de la capacité (déclencheur + cas d'usage).
--   Nombre d'inscrits actifs = enrollment_courses non annulés de l'offre (+ inscriptions de
--   classe pour une offre dont la classe inscrit en bloc).
-- -----------------------------------------------------------------------------
CREATE TABLE academic.classroom_offerings (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id             uuid NOT NULL,
  curriculum_node_id       uuid NOT NULL,
  label                    text NOT NULL CHECK (length(btrim(label)) > 0),
  starts_on                date NOT NULL,
  ends_on                  date NOT NULL,
  registration_opens_at    timestamptz,
  registration_closes_at   timestamptz,
  capacity                 integer CHECK (capacity IS NULL OR capacity > 0),
  status                   text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, classroom_id, curriculum_node_id),
  CHECK (ends_on >= starts_on),
  CHECK ((registration_opens_at IS NULL) = (registration_closes_at IS NULL)),
  CHECK (registration_closes_at IS NULL OR registration_closes_at >= registration_opens_at),
  FOREIGN KEY (tenant_id, classroom_id) REFERENCES academic.classrooms (tenant_id, id),
  FOREIGN KEY (tenant_id, curriculum_node_id) REFERENCES academic.curriculum_nodes (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.classroom_offerings');
CREATE INDEX classroom_offerings_open ON academic.classroom_offerings (tenant_id, status, registration_opens_at, registration_closes_at);
CREATE INDEX classroom_offerings_by_node ON academic.classroom_offerings (tenant_id, curriculum_node_id);
GRANT SELECT, INSERT, UPDATE ON academic.classroom_offerings TO app_user;

-- Le nœud appartient au curriculum de la classe et est inscriptible ; transitions légales.
CREATE FUNCTION academic.classroom_offerings_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_class academic.classrooms%ROWTYPE;
  v_node  academic.curriculum_nodes%ROWTYPE;
  v_type  academic.curriculum_node_types%ROWTYPE;
  v_year  academic.academic_years%ROWTYPE;
  v_held  integer;
BEGIN
  SELECT * INTO v_class FROM academic.classrooms WHERE tenant_id = NEW.tenant_id AND id = NEW.classroom_id;
  SELECT * INTO v_node  FROM academic.curriculum_nodes WHERE tenant_id = NEW.tenant_id AND id = NEW.curriculum_node_id;
  SELECT * INTO v_year  FROM academic.academic_years WHERE tenant_id = NEW.tenant_id AND id = v_class.academic_year_id;
  IF NEW.starts_on < v_year.starts_on OR NEW.ends_on > v_year.ends_on THEN
    RAISE EXCEPTION 'academic.offering_outside_year: les dates de l''offre dépassent l''année % (% -> %)', v_year.code, v_year.starts_on, v_year.ends_on
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_class.curriculum_version_id IS NULL OR v_node.version_id <> v_class.curriculum_version_id THEN
    RAISE EXCEPTION 'academic.offering_node_not_in_curriculum: le nœud n''appartient pas au curriculum de la classe' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_type FROM academic.curriculum_node_types WHERE tenant_id = NEW.tenant_id AND code = v_node.node_type_code;
  IF NOT v_type.is_enrollable THEN
    RAISE EXCEPTION 'academic.offering_node_not_enrollable: un nœud % ne s''offre pas à l''inscription', v_node.node_type_code USING ERRCODE = 'check_violation';
  END IF;
  IF v_node.is_transversal THEN
    RAISE EXCEPTION 'academic.offering_node_transversal: une matière transversale n''est jamais offerte à l''inscription' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.classroom_id <> OLD.classroom_id OR NEW.curriculum_node_id <> OLD.curriculum_node_id THEN
      RAISE EXCEPTION 'academic.offering_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT'       AND NEW.status IN ('OPEN', 'CANCELLED')) OR
         (OLD.status = 'OPEN'        AND NEW.status IN ('DRAFT', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) OR
         (OLD.status = 'FULL'        AND NEW.status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) OR
         (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('COMPLETED', 'CANCELLED')) OR
         -- Réouverture (legacy POST /sessions/reopen), sous contrôle du cas d'usage `transitionOffering`
         -- (permission, nouvelle fenêtre et nouvelle date de fin valides, motif).
         (OLD.status = 'COMPLETED'   AND NEW.status IN ('OPEN', 'IN_PROGRESS')) OR
         (OLD.status = 'CANCELLED'   AND NEW.status = 'DRAFT')) THEN
      RAISE EXCEPTION 'academic.offering_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    -- La capacité ne peut pas descendre sous les places déjà réservées.
    IF NEW.capacity IS NOT NULL AND NEW.capacity IS DISTINCT FROM OLD.capacity THEN
      SELECT count(*) INTO v_held FROM academic.enrollment_courses c
       WHERE c.tenant_id = NEW.tenant_id AND c.offering_id = NEW.id
         AND (c.status IN ('CONFIRMED', 'COMPLETED')
              OR (c.status = 'PENDING' AND (c.hold_expires_at IS NULL OR c.hold_expires_at > now())));
      IF NEW.capacity < v_held THEN
        RAISE EXCEPTION 'academic.capacity_below_reserved: % places réservées pour une capacité de %', v_held, NEW.capacity
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER classroom_offerings_guard BEFORE INSERT OR UPDATE ON academic.classroom_offerings
  FOR EACH ROW EXECUTE FUNCTION academic.classroom_offerings_guard();

-- -----------------------------------------------------------------------------
-- Inscriptions
--   mode   CLASS        l'apprenant suit tout le curriculum obligatoire de la classe
--          A_LA_CARTE   il ne suit que les offres listées dans enrollment_courses
--   status PENDING (en attente de confirmation) -> ACTIVE -> COMPLETED ; SUSPENDED ; WITHDRAWN ;
--          TRANSFERRED_OUT ; CANCELLED. PENDING et ACTIVE réservent une place.
--   funding_type, assignment_reference… : type de financement (PRD §20) porté par l'inscription.
--          Les montants (part État / part parent) appartiennent au module finance.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.enrollments (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id          uuid NOT NULL,
  campus_id               uuid,
  academic_year_id        uuid NOT NULL,
  student_id              uuid NOT NULL,                 -- people.students.id (sans FK)
  classroom_id            uuid NOT NULL,                 -- placement courant (historique : enrollment_placements)
  mode                    text NOT NULL DEFAULT 'CLASS' CHECK (mode IN ('CLASS', 'A_LA_CARTE')),
  status                  text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'CANCELLED')),
  registration_number     text,
  enrolled_on             date NOT NULL,
  ended_on                date,
  end_reason              text,
  is_repeating            boolean NOT NULL DEFAULT false,
  is_transfer_in          boolean NOT NULL DEFAULT false,   -- arrive d'un autre établissement cette année
  origin_school           text,
  previous_enrollment_id  uuid,
  funding_type            text NOT NULL DEFAULT 'PRIVATE',
  assignment_reference    text CHECK (assignment_reference IS NULL OR length(btrim(assignment_reference)) > 0),
  assignment_issued_on    date,
  funder_label            text,
  funding_notes           text,
  outcome_code            text,
  outcome_decided_at      timestamptz,
  outcome_source_ref      uuid,                           -- identifiant de la décision (module bulletins)
  source_kind             text CHECK (source_kind IS NULL OR source_kind IN ('ADMISSION', 'IMPORT', 'MANUAL', 'ROLLOVER', 'ONLINE')),
  source_ref              uuid,
  confirmed_at            timestamptz,
  cancelled_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ended_on IS NULL OR ended_on >= enrolled_on),
  CHECK (status NOT IN ('WITHDRAWN', 'TRANSFERRED_OUT', 'CANCELLED') OR ended_on IS NOT NULL),
  CHECK (status NOT IN ('PENDING', 'ACTIVE', 'SUSPENDED') OR ended_on IS NULL),
  CHECK (previous_enrollment_id IS NULL OR previous_enrollment_id <> id),
  CHECK (funding_type <> 'PRIVATE' OR assignment_reference IS NULL),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic.academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, classroom_id) REFERENCES academic.classrooms (tenant_id, id),
  FOREIGN KEY (tenant_id, previous_enrollment_id) REFERENCES academic.enrollments (tenant_id, id),
  FOREIGN KEY (tenant_id, funding_type) REFERENCES academic.funding_types (tenant_id, code),
  FOREIGN KEY (tenant_id, outcome_code) REFERENCES academic.enrollment_outcomes (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.enrollments');
-- Un apprenant n'a qu'une inscription vivante par classe.
CREATE UNIQUE INDEX enrollments_one_live_per_class
  ON academic.enrollments (tenant_id, student_id, classroom_id)
  WHERE status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'COMPLETED');
-- Inscription « de classe » : une seule par apprenant, année et établissement.
CREATE UNIQUE INDEX enrollments_one_class_mode_per_year
  ON academic.enrollments (tenant_id, student_id, academic_year_id, institution_id)
  WHERE mode = 'CLASS' AND status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'COMPLETED');
CREATE INDEX enrollments_registration_number
  ON academic.enrollments (tenant_id, institution_id, registration_number) WHERE registration_number IS NOT NULL;
CREATE INDEX enrollments_by_classroom ON academic.enrollments (tenant_id, classroom_id, status);
CREATE INDEX enrollments_by_student ON academic.enrollments (tenant_id, student_id, academic_year_id);
CREATE INDEX enrollments_by_year ON academic.enrollments (tenant_id, academic_year_id, institution_id, status);
CREATE INDEX enrollments_by_funding ON academic.enrollments (tenant_id, funding_type) WHERE funding_type <> 'PRIVATE';
GRANT SELECT, INSERT, UPDATE ON academic.enrollments TO app_user;

-- Sélections de cours : options (langue vivante 2…), inscription à la carte, reprise de dette,
-- chacune rattachée à un nœud du curriculum et, à la carte, à une offre.
CREATE TABLE academic.enrollment_courses (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id       uuid NOT NULL,
  curriculum_node_id  uuid NOT NULL,
  offering_id         uuid,
  source              text NOT NULL CHECK (source IN ('OPTION', 'A_LA_CARTE', 'CARRY_OVER')),
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
  hold_expires_at     timestamptz,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (source <> 'A_LA_CARTE' OR offering_id IS NOT NULL),
  CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES academic.enrollments (tenant_id, id),
  FOREIGN KEY (tenant_id, curriculum_node_id) REFERENCES academic.curriculum_nodes (tenant_id, id),
  FOREIGN KEY (tenant_id, offering_id) REFERENCES academic.classroom_offerings (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.enrollment_courses');
-- Une sélection vivante par (inscription, nœud).
CREATE UNIQUE INDEX enrollment_courses_one_live
  ON academic.enrollment_courses (tenant_id, enrollment_id, curriculum_node_id) WHERE status <> 'CANCELLED';
CREATE INDEX enrollment_courses_by_offering ON academic.enrollment_courses (tenant_id, offering_id, status) WHERE offering_id IS NOT NULL;
CREATE INDEX enrollment_courses_hold ON academic.enrollment_courses (tenant_id, hold_expires_at) WHERE status = 'PENDING' AND hold_expires_at IS NOT NULL;
CREATE INDEX enrollment_courses_by_node ON academic.enrollment_courses (tenant_id, curriculum_node_id, status);
GRANT SELECT, INSERT, UPDATE ON academic.enrollment_courses TO app_user;

-- Historique des affectations de classe (changement de classe en cours d'année, changement de
-- groupe d'un semestre à l'autre). Les périodes d'une même inscription ne se chevauchent pas.
CREATE TABLE academic.enrollment_placements (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id  uuid NOT NULL,
  classroom_id   uuid NOT NULL,
  starts_on      date NOT NULL,
  ends_on        date,
  reason         text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES academic.enrollments (tenant_id, id),
  FOREIGN KEY (tenant_id, classroom_id) REFERENCES academic.classrooms (tenant_id, id),
  EXCLUDE USING gist (
    tenant_id WITH =,
    enrollment_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('academic.enrollment_placements');
CREATE INDEX enrollment_placements_by_class ON academic.enrollment_placements (tenant_id, classroom_id, starts_on);
GRANT SELECT, INSERT, UPDATE ON academic.enrollment_placements TO app_user;

-- Journal d'historique des inscriptions (statut, financement, placement, sélection de cours).
-- Append-only : « l'Enrollment historise ».
CREATE TABLE academic.enrollment_history (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id  uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('CREATED', 'STATUS', 'FUNDING', 'PLACEMENT', 'COURSE', 'OUTCOME', 'NOTE')),
  from_value     jsonb,
  to_value       jsonb,
  reason         text,
  actor_id       uuid,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES academic.enrollments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.enrollment_history');
CREATE INDEX enrollment_history_by_enrollment ON academic.enrollment_history (tenant_id, enrollment_id, occurred_at);
GRANT SELECT, INSERT ON academic.enrollment_history TO app_user;

-- -----------------------------------------------------------------------------
-- Registre des numéros d'inscription (ex-« matricule professionnel » IPAM-<CODE>-<NNNN>) : un
-- numéro est attribué UNE fois par (apprenant, programme, niveau) et reste identique à chaque
-- réinscription (redoublement compris) ; deux apprenants ne partagent jamais un numéro dans un
-- établissement. Le motif est la donnée `institution_settings.registration_number_pattern`
-- (jetons {PREFIX} {PROGRAM} {LEVEL} {YEAR} {STUDENT_SEQ:n}) : le préfixe n'est plus codé en dur.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.registration_numbers (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid NOT NULL,
  student_id          uuid NOT NULL,                     -- people.students.id (sans FK)
  program_id          uuid NOT NULL,
  grade_level_id      uuid NOT NULL,
  registration_number text NOT NULL CHECK (length(btrim(registration_number)) > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, registration_number),
  UNIQUE (tenant_id, institution_id, student_id, program_id, grade_level_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES academic.programs (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_level_id) REFERENCES academic.grade_levels (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.registration_numbers');
GRANT SELECT, INSERT ON academic.registration_numbers TO app_user;
```

### 5.5 Invariants imposés par la base

<!-- migration: 0704_academic_guards.sql -->
```sql
-- =============================================================================
-- 0704 — Module academic : invariants imposés par la base
-- =============================================================================
--
-- Défense en profondeur (même esprit que finance/0503) : le domaine TypeScript applique ces
-- règles, la base les IMPOSE — un bug applicatif ou une requête manuelle ne peut pas dépasser
-- une capacité, réécrire l'historique d'une inscription ni faire sauter une transition d'état.
-- Codes d'erreur : `restrict_violation` (23001) pour une écriture interdite, `check_violation`
-- (23514) pour une incohérence. Le message commence par un code stable `academic.*`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Journaux append-only
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'academic.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER enrollment_history_immutable BEFORE UPDATE OR DELETE ON academic.enrollment_history
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();
CREATE TRIGGER curriculum_amendments_immutable BEFORE UPDATE OR DELETE ON academic.curriculum_amendments
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();
CREATE TRIGGER template_applications_immutable BEFORE UPDATE OR DELETE ON academic.template_applications
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Inscriptions : identité figée, transitions légales, exigences de financement, cohérence
-- établissement / année / classe.
-- Machine d'états (miroir de ENROLLMENT_TRANSITIONS du domaine) :
--   PENDING   -> ACTIVE | CANCELLED | WITHDRAWN
--   ACTIVE    -> SUSPENDED | COMPLETED | WITHDRAWN | TRANSFERRED_OUT | CANCELLED
--   SUSPENDED -> ACTIVE | WITHDRAWN | TRANSFERRED_OUT
--   COMPLETED -> ACTIVE            (réouverture exceptionnelle, auditée)
--   WITHDRAWN / TRANSFERRED_OUT / CANCELLED -> terminaux
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.enrollments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_class academic.classrooms%ROWTYPE;
  v_fund  academic.funding_types%ROWTYPE;
BEGIN
  SELECT * INTO v_class FROM academic.classrooms WHERE tenant_id = NEW.tenant_id AND id = NEW.classroom_id;
  IF v_class.institution_id <> NEW.institution_id OR v_class.academic_year_id <> NEW.academic_year_id THEN
    RAISE EXCEPTION 'academic.enrollment_class_mismatch: la classe n''appartient pas à l''établissement et à l''année de l''inscription'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_fund FROM academic.funding_types WHERE tenant_id = NEW.tenant_id AND code = NEW.funding_type;
  IF v_fund.requires_reference AND NEW.assignment_reference IS NULL THEN
    RAISE EXCEPTION 'academic.funding_reference_required: le financement % exige une référence d''affectation', NEW.funding_type
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_fund.requires_funder AND NEW.funder_label IS NULL THEN
    RAISE EXCEPTION 'academic.funding_funder_required: le financement % exige l''identification du financeur', NEW.funding_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.student_id <> OLD.student_id OR NEW.academic_year_id <> OLD.academic_year_id
       OR NEW.institution_id <> OLD.institution_id OR NEW.enrolled_on <> OLD.enrolled_on THEN
      RAISE EXCEPTION 'academic.enrollment_identity_immutable: apprenant, année, établissement et date d''inscription sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'PENDING'   AND NEW.status IN ('ACTIVE', 'CANCELLED', 'WITHDRAWN')) OR
         (OLD.status = 'ACTIVE'    AND NEW.status IN ('SUSPENDED', 'COMPLETED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'CANCELLED')) OR
         (OLD.status = 'SUSPENDED' AND NEW.status IN ('ACTIVE', 'WITHDRAWN', 'TRANSFERRED_OUT')) OR
         (OLD.status = 'COMPLETED' AND NEW.status = 'ACTIVE')) THEN
      RAISE EXCEPTION 'academic.enrollment_transition: % -> % interdit', OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enrollments_guard BEFORE INSERT OR UPDATE ON academic.enrollments
  FOR EACH ROW EXECUTE FUNCTION academic.enrollments_guard();

-- Une inscription ne se supprime jamais (annuler = statut CANCELLED) : les autres modules la
-- citent par UUID, sans clé étrangère, et l'historique est une exigence du produit.
CREATE TRIGGER enrollments_no_delete BEFORE DELETE ON academic.enrollments
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();
CREATE TRIGGER enrollment_courses_no_delete BEFORE DELETE ON academic.enrollment_courses
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();
CREATE TRIGGER classrooms_no_delete BEFORE DELETE ON academic.classrooms
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Capacité. Le verrou de ligne sur la classe / l'offre SÉRIALISE les inscriptions concurrentes
-- (l'ancien décompte `count(*)` sans verrou laissait dépasser la capacité).
--   - classe : seulement si capacity_is_hard (capacité indicative sinon) ;
--   - offre  : toujours, et seulement pour une sélection de cours qui réserve une place
--              (PENDING sous réserve de hold_expires_at, CONFIRMED, COMPLETED).
-- Les places réservées par une sélection PENDING expirée ne comptent plus.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.enforce_classroom_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cap   integer;
  v_hard  boolean;
  v_count integer;
BEGIN
  -- La capacité d'une classe ne compte que les inscriptions « de classe » ; les inscriptions à la
  -- carte sont limitées par la capacité de chaque offre.
  IF NEW.mode <> 'CLASS' OR NEW.status NOT IN ('PENDING', 'ACTIVE', 'SUSPENDED') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.classroom_id = OLD.classroom_id AND OLD.status IN ('PENDING', 'ACTIVE', 'SUSPENDED') THEN
    RETURN NEW;                                   -- déjà compté : ni place de plus, ni verrou
  END IF;
  SELECT capacity, capacity_is_hard INTO v_cap, v_hard
    FROM academic.classrooms WHERE tenant_id = NEW.tenant_id AND id = NEW.classroom_id FOR UPDATE;
  IF v_cap IS NULL OR NOT v_hard THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM academic.enrollments e
   WHERE e.tenant_id = NEW.tenant_id AND e.classroom_id = NEW.classroom_id AND e.mode = 'CLASS'
     AND e.status IN ('PENDING', 'ACTIVE', 'SUSPENDED') AND e.id <> NEW.id;
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'academic.classroom_full: la classe est complète (% places)', v_cap USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enrollments_capacity BEFORE INSERT OR UPDATE OF status, classroom_id ON academic.enrollments
  FOR EACH ROW EXECUTE FUNCTION academic.enforce_classroom_capacity();

CREATE FUNCTION academic.enforce_offering_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cap    integer;
  v_status text;
  v_count  integer;
  v_node   uuid;
BEGIN
  IF NEW.offering_id IS NULL OR NEW.status = 'CANCELLED' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.offering_id IS NOT DISTINCT FROM OLD.offering_id AND OLD.status <> 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  SELECT capacity, status, curriculum_node_id INTO v_cap, v_status, v_node
    FROM academic.classroom_offerings WHERE tenant_id = NEW.tenant_id AND id = NEW.offering_id FOR UPDATE;
  IF v_node <> NEW.curriculum_node_id THEN
    RAISE EXCEPTION 'academic.offering_node_mismatch: le nœud de la sélection ne correspond pas à l''offre' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status IN ('CANCELLED', 'COMPLETED') THEN
    RAISE EXCEPTION 'academic.offering_closed: l''offre est %', v_status USING ERRCODE = 'check_violation';
  END IF;
  IF v_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM academic.enrollment_courses c
     WHERE c.tenant_id = NEW.tenant_id AND c.offering_id = NEW.offering_id AND c.id <> NEW.id
       AND (c.status IN ('CONFIRMED', 'COMPLETED')
            OR (c.status = 'PENDING' AND (c.hold_expires_at IS NULL OR c.hold_expires_at > now())));
    IF v_count >= v_cap THEN
      RAISE EXCEPTION 'academic.offering_full: l''offre est complète (% places)', v_cap USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enrollment_courses_capacity BEFORE INSERT OR UPDATE OF status, offering_id ON academic.enrollment_courses
  FOR EACH ROW EXECUTE FUNCTION academic.enforce_offering_capacity();

-- -----------------------------------------------------------------------------
-- Sélection de cours : transitions légales et cohérence avec l'inscription.
--   PENDING -> CONFIRMED | CANCELLED ; CONFIRMED -> COMPLETED | CANCELLED ; COMPLETED terminal.
-- Une inscription à la carte ne porte que des sélections ; le nœud doit appartenir au
-- curriculum d'une classe de la même année.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.enrollment_courses_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_enr   academic.enrollments%ROWTYPE;
  v_node  academic.curriculum_nodes%ROWTYPE;
  v_year  uuid;
  v_trans boolean;
BEGIN
  SELECT * INTO v_enr FROM academic.enrollments WHERE tenant_id = NEW.tenant_id AND id = NEW.enrollment_id;
  SELECT * INTO v_node FROM academic.curriculum_nodes WHERE tenant_id = NEW.tenant_id AND id = NEW.curriculum_node_id;
  SELECT academic_year_id INTO v_year FROM academic.curriculum_versions WHERE tenant_id = NEW.tenant_id AND id = v_node.version_id;
  IF v_year <> v_enr.academic_year_id AND NEW.source <> 'CARRY_OVER' THEN
    RAISE EXCEPTION 'academic.course_other_year: le nœud appartient à un curriculum d''une autre année' USING ERRCODE = 'check_violation';
  END IF;
  IF v_node.is_transversal AND NEW.source = 'A_LA_CARTE' THEN
    RAISE EXCEPTION 'academic.course_transversal: une matière transversale ne s''achète pas à la carte' USING ERRCODE = 'check_violation';
  END IF;
  -- À la carte : l'offre est celle de la classe de l'inscription (le « lot » apprenant × classe).
  -- Reprise de dette (CARRY_OVER) et options : l'offre peut venir d'une autre classe.
  IF NEW.source = 'A_LA_CARTE' AND NOT EXISTS (
       SELECT 1 FROM academic.classroom_offerings o
        WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.offering_id AND o.classroom_id = v_enr.classroom_id) THEN
    RAISE EXCEPTION 'academic.course_offering_other_class: l''offre n''appartient pas à la classe de l''inscription' USING ERRCODE = 'check_violation';
  END IF;
  -- Une sélection n'est CONFIRMÉE que si l'inscription est ACTIVE (la confirmation de l'inscription
  -- précède celle des cours : porte d'entrée des frais d'inscription).
  IF NEW.status IN ('CONFIRMED', 'COMPLETED') AND v_enr.status NOT IN ('ACTIVE', 'COMPLETED') THEN
    RAISE EXCEPTION 'academic.course_enrollment_not_active: l''inscription est % ; confirmez-la d''abord', v_enr.status
      USING ERRCODE = 'check_violation';
  END IF;
  -- Un apprenant ne suit pas deux fois le même nœud la même année (ex. même UE dans deux classes du
  -- même programme) ; reprendre un nœud échoué se fait l'année suivante ou après annulation.
  IF NEW.status <> 'CANCELLED' AND EXISTS (
       SELECT 1 FROM academic.enrollment_courses c
         JOIN academic.enrollments e ON e.tenant_id = c.tenant_id AND e.id = c.enrollment_id
        WHERE c.tenant_id = NEW.tenant_id AND c.id <> NEW.id AND c.status <> 'CANCELLED'
          AND c.curriculum_node_id = NEW.curriculum_node_id
          AND e.student_id = v_enr.student_id AND e.academic_year_id = v_enr.academic_year_id) THEN
    RAISE EXCEPTION 'academic.duplicate_enrollment: l''apprenant suit déjà ce nœud cette année' USING ERRCODE = 'unique_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.enrollment_id <> OLD.enrollment_id OR NEW.curriculum_node_id <> OLD.curriculum_node_id OR NEW.source <> OLD.source THEN
      RAISE EXCEPTION 'academic.course_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'PENDING'   AND NEW.status IN ('CONFIRMED', 'CANCELLED')) OR
         (OLD.status = 'CONFIRMED' AND NEW.status IN ('COMPLETED', 'CANCELLED'))) THEN
      RAISE EXCEPTION 'academic.course_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enrollment_courses_guard BEFORE INSERT OR UPDATE ON academic.enrollment_courses
  FOR EACH ROW EXECUTE FUNCTION academic.enrollment_courses_guard();

-- -----------------------------------------------------------------------------
-- Un seul placement ouvert (sans date de fin) par inscription.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX enrollment_placements_one_open
  ON academic.enrollment_placements (tenant_id, enrollment_id) WHERE ends_on IS NULL;

-- -----------------------------------------------------------------------------
-- FULL / OPEN dérivés de la capacité (parité : computeSessionCapacityStatus du legacy) :
--   OPEN -> FULL  quand les places réservées atteignent la capacité ;
--   FULL -> OPEN  quand une place se libère ET que la fenêtre d'inscription est encore valide
--                 (ou n'existe pas). Jamais posé à la main, jamais depuis un autre état.
-- Déclenché après toute écriture de sélection ; l'offre est verrouillée par le garde de capacité.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.sync_offering_fullness() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_offering uuid := coalesce(NEW.offering_id, OLD.offering_id);
  o          academic.classroom_offerings%ROWTYPE;
  v_held     integer;
BEGIN
  IF v_offering IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO o FROM academic.classroom_offerings WHERE tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id) AND id = v_offering;
  IF NOT FOUND OR o.capacity IS NULL OR o.status NOT IN ('OPEN', 'FULL') THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_held FROM academic.enrollment_courses c
   WHERE c.tenant_id = o.tenant_id AND c.offering_id = o.id
     AND (c.status IN ('CONFIRMED', 'COMPLETED')
          OR (c.status = 'PENDING' AND (c.hold_expires_at IS NULL OR c.hold_expires_at > now())));
  IF o.status = 'OPEN' AND v_held >= o.capacity THEN
    UPDATE academic.classroom_offerings SET status = 'FULL', updated_at = now() WHERE tenant_id = o.tenant_id AND id = o.id;
  ELSIF o.status = 'FULL' AND v_held < o.capacity
        AND (o.registration_closes_at IS NULL OR now() <= o.registration_closes_at) THEN
    UPDATE academic.classroom_offerings SET status = 'OPEN', updated_at = now() WHERE tenant_id = o.tenant_id AND id = o.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER enrollment_courses_fullness AFTER INSERT OR UPDATE OF status, offering_id, hold_expires_at OR DELETE ON academic.enrollment_courses
  FOR EACH ROW EXECUTE FUNCTION academic.sync_offering_fullness();

-- -----------------------------------------------------------------------------
-- Clôture par classe : la période appartient à l'année de la classe ; transitions
-- OPEN -> GRADING_CLOSED -> CLOSED, retour d'un pas ; l'état d'une classe SURCHARGE celui de la
-- période (permet de rouvrir une seule classe après une clôture globale, ou d'en clore une seule).
-- Clore la période entière (closePeriod*) aligne en une opération les états explicites existants.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.classroom_period_states_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_class_year  uuid;
  v_period_year uuid;
BEGIN
  SELECT academic_year_id INTO v_class_year FROM academic.classrooms WHERE tenant_id = NEW.tenant_id AND id = NEW.classroom_id;
  SELECT academic_year_id INTO v_period_year FROM academic.academic_periods WHERE tenant_id = NEW.tenant_id AND id = NEW.period_id;
  IF v_class_year <> v_period_year THEN
    RAISE EXCEPTION 'academic.classroom_period_other_year: la période n''appartient pas à l''année de la classe' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> OLD.status AND NOT (
       (OLD.status = 'OPEN'           AND NEW.status = 'GRADING_CLOSED') OR
       (OLD.status = 'GRADING_CLOSED' AND NEW.status IN ('CLOSED', 'OPEN')) OR
       (OLD.status = 'CLOSED'         AND NEW.status IN ('GRADING_CLOSED', 'OPEN'))) THEN
    RAISE EXCEPTION 'academic.classroom_period_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER classroom_period_states_guard BEFORE INSERT OR UPDATE ON academic.classroom_period_states
  FOR EACH ROW EXECUTE FUNCTION academic.classroom_period_states_guard();

-- -----------------------------------------------------------------------------
-- Aide à la lecture : état effectif d'une période pour une classe = l'état explicite de la
-- classe s'il existe, sinon celui de la période.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.effective_period_status(p_classroom uuid, p_period uuid)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(s.status, p.status)
    FROM academic.academic_periods p
    LEFT JOIN academic.classroom_period_states s
           ON s.tenant_id = p.tenant_id AND s.classroom_id = p_classroom AND s.period_id = p.id
   WHERE p.tenant_id = kernel.current_tenant_id() AND p.id = p_period
$$;
GRANT EXECUTE ON FUNCTION academic.effective_period_status(uuid, uuid) TO app_user;
```

## 6. Invariants : qui les garantit

| Invariant | Base (DDL) | Domaine / cas d'usage |
|---|---|---|
| Deux années d'un établissement ne se chevauchent pas | `EXCLUDE` sur `daterange` | `createAcademicYear` vérifie aussi l'**absence de trou** (règle 0118) ; `find_year_gaps()` pour le contrôle d'exploitation |
| Une seule année courante par établissement | index unique partiel `academic_years_one_current` | `setCurrentAcademicYear` (bascule atomique) |
| Une période tient dans son année et dans son parent ; sœurs de même type sans chevauchement | `academic_periods_guard`, `EXCLUDE` | `applyPeriodPlan` répartit l'année en parts égales (modifiable) |
| Statuts de période PLANNED → OPEN → GRADING_CLOSED → CLOSED, retour d'un pas | `academic_periods_guard` | `PeriodClosureGuard` (modules 011/013) peuvent refuser la clôture ; réouverture motivée + audit ; l'état explicite d'une classe surcharge celui de la période (`effective_period_status`) |
| Grammaire du curriculum, absence de cycle | `curriculum_nodes_guard` | `validateCurriculum` (rapport complet avant publication) |
| Curriculum publié : structure gelée, coefficients/crédits modifiables avec journal | `curriculum_nodes_guard` + réglage `academic.structural_change` | `amendPublishedCurriculum` écrit `curriculum_amendments` et contrôle `CurriculumUsageGuard` |
| Prérequis sans auto-référence ni cycle, même établissement | `curriculum_prerequisites_guard` | `setNodePrerequisites` |
| Un apprenant : une inscription vivante par classe ; une seule inscription « de classe » par année et établissement | index uniques partiels | `enrollStudent` (messages explicites au lieu d'un 500) |
| Capacité d'une classe (dure par défaut, `capacity_is_hard`) / d'une offre | `enforce_classroom_capacity`, `enforce_offering_capacity` (verrou de ligne, sérialise les concurrents) ; capacité d'offre jamais inférieure aux places réservées | `checkOfferingEligibility` renvoie la cause avant l'écriture |
| `OPEN ⇄ FULL` dérivés de la capacité | `sync_offering_fullness` (déclencheur sur les sélections) | jamais posé à la main ; retour à `OPEN` seulement si la fenêtre est valide |
| Une sélection `CONFIRMED` exige une inscription `ACTIVE` ; un apprenant ne suit pas deux fois un nœud la même année | `enrollment_courses_guard` | `confirmEnrollmentCourse`, `addEnrollmentCourse` |
| Dates d'une offre dans l'année de la classe ; réouverture d'une offre terminée/annulée | `classroom_offerings_guard` | `reopenOffering` |
| Classe active ⇒ curriculum choisi (et publié) ; état de classe dans la période ⇒ période de l'année de la classe | CHECK, `classrooms_guard`, `classroom_period_states_guard` | `activateClassroom` |
| Prérequis d'un curriculum publié ne changent que par amendement | `curriculum_prerequisites_guard`, `…_delete_guard` | `amendPublishedCurriculum` |
| Réservation de place avec expiration | décompte ignorant `hold_expires_at` dépassé | job `expirePendingHolds` passe les sélections expirées en CANCELLED |
| Inscription : identité figée, transitions légales, exigences de financement | `enrollments_guard` | `STATE_ASSIGNED` exige `assignment_reference` (donnée `funding_types.requires_reference`) |
| Historique d'inscription immuable ; pas de suppression | `forbid_mutation` | chaque cas d'usage écrit `enrollment_history` |
| Un numéro d'inscription par (apprenant, programme, niveau), jamais partagé entre deux apprenants | `UNIQUE` du registre (établissement, numéro) et (établissement, apprenant, programme, niveau) | `enrollStudent` lit ou crée l'entrée du registre dans la transaction ; le motif est `institution_settings.registration_number_pattern` |
| Matière transversale (conduite) jamais offerte ni achetée à la carte | `classroom_offerings_guard`, `enrollment_courses_guard` | `curriculum_nodes.is_transversal` remplace `libelle ILIKE 'conduite%'` |

## 7. Données de référence : modèle de pack

Les référentiels sont instanciés dans le tenant par `instantiatePackReferenceData(ctx, institutionId)` à partir de `apps/api/src/modules/tenancy/templates/academic/<educationSystem>/<pack>.json` (validé par `AcademicPackTemplateSchema`, propriété du module academic ; chargé par la fonction publique `tenancy.getPackTemplateSection(pack, educationSystem, 'academic')` — voir `plan.md`, demande de changement à la spec 003). L'opération est **idempotente** (upsert par `code`, enregistrée dans `template_applications`) et ne modifie jamais une ligne que le tenant a personnalisée (`updated_at` > date d'application) ; elle ne retire rien.

Exemple CI, pack `PRIMARY` (libellés issus du PRD §12 ; **aucune règle réglementaire** — coefficients, séries et matières officiels ne sont pas inventés, voir `open-questions.md`) :

```json
{
  "section": "academic",
  "schemaVersion": 1,
  "educationSystem": "CI",
  "pack": "PRIMARY",
  "educationLevels": [
    { "code": "PRESCHOOL", "label": "Maternelle", "ordinal": 1 },
    { "code": "PRIMARY",   "label": "Primaire",   "ordinal": 2 }
  ],
  "gradeLevels": [
    { "code": "PS",  "label": "Petite Section",  "educationLevel": "PRESCHOOL", "ordinal": 1, "next": "MS" },
    { "code": "MS",  "label": "Moyenne Section", "educationLevel": "PRESCHOOL", "ordinal": 2, "next": "GS" },
    { "code": "GS",  "label": "Grande Section",  "educationLevel": "PRESCHOOL", "ordinal": 3, "next": "CP1" },
    { "code": "CP1", "label": "CP1", "educationLevel": "PRIMARY", "ordinal": 1, "next": "CP2" },
    { "code": "CP2", "label": "CP2", "educationLevel": "PRIMARY", "ordinal": 2, "next": "CE1" },
    { "code": "CE1", "label": "CE1", "educationLevel": "PRIMARY", "ordinal": 3, "next": "CE2" },
    { "code": "CE2", "label": "CE2", "educationLevel": "PRIMARY", "ordinal": 4, "next": "CM1" },
    { "code": "CM1", "label": "CM1", "educationLevel": "PRIMARY", "ordinal": 5, "next": "CM2" },
    { "code": "CM2", "label": "CM2", "educationLevel": "PRIMARY", "ordinal": 6, "next": null }
  ],
  "periodTypes": [
    { "code": "TRIMESTER",   "label": "Trimestre",   "kind": "TEACHING_PERIOD" },
    { "code": "SEMESTER",    "label": "Semestre",    "kind": "TEACHING_PERIOD" },
    { "code": "COMPOSITION", "label": "Composition", "kind": "TEACHING_PERIOD" },
    { "code": "MODULE",      "label": "Module",      "kind": "TEACHING_PERIOD" },
    { "code": "NORMAL_SESSION", "label": "Session normale",       "kind": "EXAM_SESSION" },
    { "code": "MAKEUP_SESSION", "label": "Session de rattrapage", "kind": "EXAM_SESSION" }
  ],
  "periodPlans": [
    { "code": "THREE_TERMS",  "label": "Trois trimestres", "slots": [
        { "type": "TRIMESTER", "ordinal": 1, "label": "Trimestre 1" },
        { "type": "TRIMESTER", "ordinal": 2, "label": "Trimestre 2" },
        { "type": "TRIMESTER", "ordinal": 3, "label": "Trimestre 3" } ] },
    { "code": "TWO_SEMESTERS", "label": "Deux semestres", "slots": [
        { "type": "SEMESTER", "ordinal": 1, "label": "Semestre 1" },
        { "type": "SEMESTER", "ordinal": 2, "label": "Semestre 2" } ] }
  ],
  "nodeTypes": [
    { "code": "LEVEL",   "label": "Niveau",   "allowedParents": ["ROOT"], "requiresGradeLevel": true, "system": true },
    { "code": "GROUP",   "label": "Groupe de matières", "allowedParents": ["LEVEL", "PERIOD"], "system": true },
    { "code": "SUBJECT", "label": "Matière",  "allowedParents": ["LEVEL", "PERIOD", "GROUP"],
      "requiresSubject": true, "allowsCoefficient": true, "allowsCredits": true, "enrollable": true, "system": true }
  ],
  "fundingTypes": [
    { "code": "PRIVATE",        "label": "Privé" },
    { "code": "STATE_ASSIGNED", "label": "Affecté par l'État", "requiresReference": true },
    { "code": "SCHOLARSHIP",    "label": "Boursier",           "requiresFunder": true },
    { "code": "COMPANY",        "label": "Pris en charge par une entreprise", "requiresFunder": true },
    { "code": "STAFF_CHILD",    "label": "Enfant du personnel" },
    { "code": "OTHER",          "label": "Autre" }
  ],
  "enrollmentOutcomes": [
    { "code": "PROMOTED",   "label": "Passage",       "kind": "ADVANCE" },
    { "code": "REPEATED",   "label": "Redoublement",  "kind": "REPEAT" },
    { "code": "ORIENTED",   "label": "Orientation",   "kind": "REDIRECT" },
    { "code": "REORIENTED", "label": "Réorientation", "kind": "REDIRECT" },
    { "code": "EXCLUDED",   "label": "Exclusion",     "kind": "EXIT" },
    { "code": "GRADUATED",  "label": "Diplômé",       "kind": "EXIT" }
  ],
  "programs": [
    { "code": "MATERNELLE", "label": "Enseignement préscolaire", "educationLevel": "PRESCHOOL", "gradeLevels": ["PS", "MS", "GS"] },
    { "code": "PRIMAIRE",   "label": "Enseignement primaire",    "educationLevel": "PRIMARY",   "gradeLevels": ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"] }
  ],
  "settings": { "enrollmentConfirmationPolicy": "AUTO", "pendingHoldMinutes": null }
}
```

Les packs `SECONDARY` (6e → 3e, 2nde → Tle, PRD §15) et `HIGHER` (cycles `LICENCE`, `MASTER`, `BTS` ; niveaux `L1…L3`, `M1`, `M2`, `BTS1`, `BTS2`, PRD §22 et §24 ; types `PERIOD`, `UE`, `ECUE` avec `creditsMustEqualChildren: true` sur `UE`) suivent le même schéma ; les définitions d'un même type de nœud doivent être **identiques** d'un pack à l'autre (test de cohérence des modèles). Les listes de séries, de matières et de coefficients officiels de la Côte d'Ivoire ne figurent pas dans les modèles tant que le propriétaire n'a pas fourni les textes de référence (question O-02 de `open-questions.md`).

## 8. Chemins d'accès et index

| Besoin | Requête | Index |
|---|---|---|
| Année courante d'un établissement | `WHERE institution_id = $1 AND is_current` | `academic_years_one_current` |
| Période contenant une date | `WHERE academic_year_id = $1 AND $2 BETWEEN starts_on AND ends_on` (la plus profonde de type demandé) | `academic_periods_by_year` |
| Arbre d'une version | CTE récursive sur `parent_id` (profondeur ≤ 16) | `curriculum_nodes_by_parent` |
| Nœuds d'une classe/période | version de la classe + sous-arbre du nœud `LEVEL` de son niveau + nœuds `PERIOD` correspondants | idem + `curriculum_nodes_by_lineage` |
| Effectif d'une classe | `WHERE classroom_id = $1 AND status IN (…)` | `enrollments_by_classroom` |
| Inscriptions d'un apprenant | `WHERE student_id = $1 ORDER BY academic_year_id` | `enrollments_by_student` |
| Offres ouvertes à l'inscription | `WHERE status = 'OPEN' AND now() BETWEEN registration_opens_at AND registration_closes_at` | `classroom_offerings_open` |
| Réservations à expirer | `WHERE status = 'PENDING' AND hold_expires_at < now()` | `enrollment_courses_hold` |
| Historique d'une inscription | `WHERE enrollment_id = $1 ORDER BY occurred_at` | `enrollment_history_by_enrollment` |

## 9. Projections et lectures croisées

- Les listes d'élèves filtrées par classe passent par la projection `people.student_enrollment_summaries` (alimentée par `academic.enrollment.*`), jamais par une jointure inter-schémas (ADR-006).
- Le module ne lit aucune table d'un autre schéma. Il lit `people` via le port `StudentDirectory`, `scheduling` via `ScheduleConflictChecker`, `finance` par événement.
- Aucune vue SQL ne traverse les schémas.

## 10. Rejeu de l'historique et reprise

Aucune donnée de production n'est reprise (D8) : le legacy `cycles`, `filieres`, `programmes`, `classes`, `academic_years`, `academic_year_periods`, `courses`, `class_courses`, `professional_*` (structure et inscriptions) est supprimé par tranche (plan §4, tranches 2.1 et 2.2). Les environnements de démonstration, de test et d'e2e sont construits par seeds déterministes alimentés par les mêmes modèles de pack ; ces seeds servent aussi aux tests de caractérisation (tranche 2.0).
