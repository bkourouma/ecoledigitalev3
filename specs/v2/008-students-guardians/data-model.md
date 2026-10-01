# Modèle de données — 008-students-guardians (schéma Postgres `people`, partie élèves et tuteurs)

**Statut** : DDL de référence, exécuté et testé sur PostgreSQL 17 (17 tests de comportement pour l'ensemble du module `people` : numérotation, immuabilité, contact principal, RLS…). Migrations cibles `apps/api/src/modules/people/migrations/0800`, `0801`, `0804`. Les migrations `0802`, `0803`, `0805` (personnel, affectations) sont décrites dans `specs/v2/009-teachers-staff/data-model.md` ; elles supposent `0800` et `0804`.

**Sources** : `docs/architecture/module-conventions.md`, ADR-002/005/006/007/008, plan §3.4 et §3.7, PRD §10 et §20.

## 1. Conventions appliquées

Identiques à `specs/v2/004-academic-core/data-model.md` §1 (un schéma, `tenant_id` + RLS forcée, FK composites `(tenant_id, id)`, UUID applicatifs, `timestamptz` UTC, aucune table globale ⇒ allowlist d'isolation vide). Particularités du module :

| Règle | Application |
|---|---|
| Références hors schéma sans FK | `identity_id` → `iam.identities` (global) ; `institution_id`, `campus_id` → `tenancy` ; `student_enrollment_summaries.*_id` → `academic` ; `document_ref` → futur `documents` ; vérifiées par l'API publique du module concerné. |
| Personne commune | `persons` porte l'état civil partagé par élève, tuteur et personnel (spec 009) ; un rôle = une ligne (`students`, `guardians`, `staff`) reliée par `person_id` (`UNIQUE (tenant_id, person_id)` par rôle). |
| Aucune suppression physique | Déclencheurs `forbid_mutation` sur `persons`, `students`, `guardians` ; archivage par statut. |
| Données sensibles | `birth_certificate_*`, `national_student_id`, `civil_registry_office`, `attributes`, pièces : séparées en lecture par permission (`student.sensitive.read`). Aucune donnée de ce type dans les payloads d'événements. |
| Pas de mot de passe | Aucune colonne `initial_password` (le legacy en stockait en clair dans `users` et `student_profiles`). Les accès passent par `iam`. |
| Recherche | `search_key` (colonne générée, minuscules sans accents) + index trigramme ; extension `unaccent` et `pg_trgm` (de confiance, PG ≥ 13). |
| Numérotation | `people.next_number(kind, scope)` : compteur gapless par tenant (technique de `finance.next_number`) ; le motif de formatage est une donnée (`settings`). |

## 2. Vue d'ensemble

```
iam.identities (global, UUID)                       academic.enrollments (UUID, événements)
        ·                                                   ·
        · identity_id                                       · projection
 persons ─1:0..1─ students ─< student_status_history        ▼
    │                 ├─< student_prior_education      student_enrollment_summaries
    │                 ├─< student_emergency_contacts
    │                 └─< student_guardians >─ guardians ─1:1─ persons
    │                              │
    │                              └─ relationship_type (donnée)
    └─1:0..1─ guardians                                     (staff : spec 009)
 settings (1 ligne / tenant) · number_sequences (compteurs gapless)
```

## 3. Catalogue des tables (partie 008)

| Table | Rôle | Cardinalité indicative (1 500 élèves) |
|---|---|---|
| `relationship_types` | Types de liens (père, mère, tuteur légal, contact d'urgence…) — donnée de pack | ~10 |
| `settings` | Motifs de numérotation, contrôle de doublons, préavis d'alerte | 1 par tenant |
| `number_sequences` | Compteurs gapless (`STUDENT`, `STAFF`) | 2 lignes |
| `persons` | État civil commun | 2 à 4 par élève (élève + tuteurs) |
| `students` | Dossier permanent (matricule immuable, statut) | 1 par apprenant, pour toute sa scolarité |
| `student_status_history` | Historique de statut avec auteur et motif (création comprise) | ~3 par élève |
| `student_prior_education` | Parcours d'avant l'établissement, diplômes d'entrée (bac…) | 0 à 3 |
| `guardians` | Tuteurs (personne + profession) | ~1,2 par élève |
| `student_guardians` | Lien élève-tuteur et drapeaux (principal, urgence, répondant financier, autorité, retrait, accès portail) | ~2 par élève |
| `student_emergency_contacts` | Contacts d'urgence de l'élève | 1 à 3 |
| `student_enrollment_summaries` | Projection de lecture des inscriptions (alimentée par événements) | 1 par inscription |

## 4. Décisions de modélisation à connaître

1. **Le dossier permanent ne contient aucune donnée d'année.** Le legacy dupliquait dix champs entre la fiche et l'inscription (`is_repeating`, `lv2`, `scholarship_level`, `is_transfer`, `transfer_decision`, `affectation_status`, `affectation_decision`, `cepe_code`, `origin_school`, `is_inscribed`) : ils vivent désormais sur `academic.enrollments` / `enrollment_courses` (spec 004). Conséquence : un redoublement ou un changement de classe ne touche jamais `students`.
2. **Un tuteur est une personne, pas un utilisateur.** `guardians` ↔ `persons`, accès portail optionnel via `persons.identity_id` (identité `iam` globale, ADR-008). `student_guardians.portal_access` coupe l'accès « enfant » sans supprimer le lien. Le contrôle « ce parent est bien le parent de cet enfant » est `isGuardianOfStudent`, règle de domaine de ce module.
3. **Les contacts d'urgence appartiennent à l'élève** (`student_emergency_contacts`) et non au parent ; un tuteur peut en plus porter le drapeau `is_emergency_contact`.
4. **Pas d'état dérivé stocké dans le dossier.** « Classe actuelle », « année d'entrée », « statut financier » sont lus via la projection ou les annuaires, jamais recopiés.
5. **Projection au lieu de jointure.** `student_enrollment_summaries` est le seul endroit où le module connaît des données d'inscription ; elle est idempotente par `source_event_id` et reconstructible.
6. **Valeurs spécifiques à un système éducatif** (sous-préfecture, centre d'état civil, matricules de tutelle) sont des clés de `attributes` validées par un schéma Zod du modèle de pack, pas des colonnes.

## 5. DDL de référence

### 5.1 Schéma, référentiels, numérotation, personnes

<!-- migration: 0800_people_reference_persons.sql -->
```sql
-- =============================================================================
-- 0800 — Module people : schéma, référentiels, numérotation, personnes
-- =============================================================================
--
-- Plage de numéros réservée au module people : 0800–0899 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; plage à inscrire dans ce tableau).
--   008-students-guardians : 0800 (référentiels, personnes), 0801 (élèves, tuteurs)
--   009-teachers-staff     : 0802 (personnel), 0803 (affectations d'enseignement)
--   transverse             : 0804 (invariants)
--
-- Règles : voir 0700 (academic). En particulier : AUCUNE clé étrangère vers un autre schéma
-- que `kernel.tenants` ; les références vers `iam` (identité), `tenancy` (établissement,
-- campus) et `academic` (année, classe, nœud de curriculum, matière) sont des UUID vérifiés
-- par l'API publique de ces modules.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS people;
REVOKE ALL ON SCHEMA people FROM PUBLIC;
GRANT USAGE ON SCHEMA people TO app_user;

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;   -- contraintes d'exclusion (contrats, affiliations)

-- Clé de recherche normalisée : minuscules, sans accents (« Kouamé » = « kouame »).
-- IMMUTABLE par construction (dictionnaire fixé) pour pouvoir servir de colonne générée.
CREATE FUNCTION people.normalize_search(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p_text, '')))
$$;

-- -----------------------------------------------------------------------------
-- Référentiels pilotés par les modèles de pack (données, pas code)
-- -----------------------------------------------------------------------------
-- Liens de parenté / de responsabilité (père, mère, tuteur légal, oncle, contact d'urgence…).
CREATE TABLE people.relationship_types (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  kind       text NOT NULL DEFAULT 'GUARDIAN' CHECK (kind IN ('GUARDIAN', 'EMERGENCY', 'OTHER')),
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('people.relationship_types');
GRANT SELECT, INSERT, UPDATE ON people.relationship_types TO app_user;

-- Catégories de personnel : enseignant, éducateur, administratif, direction, appui…
CREATE TABLE people.staff_categories (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  code         text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label        text NOT NULL CHECK (length(btrim(label)) > 0),
  can_teach    boolean NOT NULL DEFAULT false,
  can_supervise boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('people.staff_categories');
GRANT SELECT, INSERT, UPDATE ON people.staff_categories TO app_user;

-- Types de contrat : CDI, CDD, vacation… (`kind` sert aux rapports et à la paie, pas à des seuils).
CREATE TABLE people.contract_types (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  kind       text NOT NULL CHECK (kind IN ('PERMANENT', 'FIXED_TERM', 'CASUAL', 'OTHER')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('people.contract_types');
GRANT SELECT, INSERT, UPDATE ON people.contract_types TO app_user;

-- Paramètres du tenant (une ligne). Formats de numéros : jetons {SEQ:n} {YYYY} {YY} {PREFIX}.
CREATE TABLE people.settings (
  tenant_id               uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  student_number_pattern  text NOT NULL DEFAULT '{SEQ:5}' CHECK (student_number_pattern LIKE '%{SEQ:%}%'),
  staff_number_pattern    text NOT NULL DEFAULT 'P{SEQ:4}' CHECK (staff_number_pattern LIKE '%{SEQ:%}%'),
  number_prefix           text CHECK (number_prefix IS NULL OR number_prefix ~ '^[A-Z0-9]{1,12}$'),
  duplicate_check_enabled boolean NOT NULL DEFAULT true,
  -- Préavis (en jours) des alertes de qualification qui expire ; NULL = alertes désactivées tant
  -- que le modèle de pack ou le tenant n'a pas fixé de valeur (aucune durée en dur dans le code).
  expiry_alert_days       integer CHECK (expiry_alert_days IS NULL OR expiry_alert_days BETWEEN 1 AND 365),
  -- Délai de conservation (en jours) d'un dossier ARCHIVED avant anonymisation possible (droit à
  -- l'effacement, spec 008 AC3.6). NULL = durée non fixée par le tenant : l'anonymisation est refusée
  -- (aucune durée légale n'est codée ici, question O-15).
  student_retention_days  integer CHECK (student_retention_days IS NULL OR student_retention_days BETWEEN 0 AND 36500),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('people.settings');
GRANT SELECT, INSERT, UPDATE ON people.settings TO app_user;

-- -----------------------------------------------------------------------------
-- Numérotation gapless (même technique que finance.next_number) : la ligne de compteur reste
-- verrouillée jusqu'au COMMIT ; une transaction annulée rend son numéro à la suivante.
-- Remplace les SIX numérotations historiques (10001+ réécrit à chaque lecture, IPAM, STU…).
-- -----------------------------------------------------------------------------
CREATE TABLE people.number_sequences (
  tenant_id  uuid   NOT NULL REFERENCES kernel.tenants (id),
  kind       text   NOT NULL CHECK (kind IN ('STUDENT', 'STAFF')),
  scope_key  text   NOT NULL DEFAULT '',
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (tenant_id, kind, scope_key)
);
SELECT kernel.enable_tenant_rls('people.number_sequences');
GRANT SELECT, INSERT, UPDATE ON people.number_sequences TO app_user;

CREATE FUNCTION people.number_sequences_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.scope_key <> OLD.scope_key THEN
    RAISE EXCEPTION 'people.sequence_immutable_key' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.last_value <> OLD.last_value + 1 THEN
    RAISE EXCEPTION 'people.sequence_step: un compteur avance d''un pas exactement (% -> %)', OLD.last_value, NEW.last_value
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER number_sequences_guard BEFORE UPDATE ON people.number_sequences
  FOR EACH ROW EXECUTE FUNCTION people.number_sequences_guard();

CREATE FUNCTION people.next_number(p_kind text, p_scope text DEFAULT '') RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := kernel.current_tenant_id();
  v_value  bigint;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'people.next_number: contexte de tenant absent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO people.number_sequences AS s (tenant_id, kind, scope_key, last_value)
  VALUES (v_tenant, p_kind, p_scope, 1)
  ON CONFLICT (tenant_id, kind, scope_key) DO UPDATE SET last_value = s.last_value + 1
  RETURNING s.last_value INTO v_value;
  RETURN v_value;
END
$$;
REVOKE ALL ON FUNCTION people.next_number(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.next_number(text, text) TO app_user;

-- -----------------------------------------------------------------------------
-- Personnes : l'état civil commun à un élève, un tuteur, un membre du personnel. Une même
-- personne peut cumuler les rôles (un parent qui est enseignant : financement STAFF_CHILD).
-- `identity_id` relie à l'identité de connexion (iam, ADR-008) quand la personne a un compte.
-- -----------------------------------------------------------------------------
CREATE TABLE people.persons (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  identity_id   uuid,
  last_name     text NOT NULL CHECK (length(btrim(last_name)) > 0),
  first_name    text NOT NULL CHECK (length(btrim(first_name)) > 0),
  other_names   text,
  sex           text CHECK (sex IN ('M', 'F')),
  birth_date    date CHECK (birth_date IS NULL OR birth_date BETWEEN DATE '1900-01-01' AND DATE '2100-01-01'),
  birth_place   text,
  nationality   text CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$'),
  email         text CHECK (email IS NULL OR (length(email) <= 320 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  phone         text CHECK (phone IS NULL OR length(phone) BETWEEN 5 AND 40),
  phone_alt     text CHECK (phone_alt IS NULL OR length(phone_alt) BETWEEN 5 AND 40),
  address_line  text,
  city          text,
  residence     text,
  photo_object_key text,
  external_ref  text CHECK (external_ref IS NULL OR length(btrim(external_ref)) > 0),
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  anonymized_at timestamptz,
  search_key    text GENERATED ALWAYS AS (people.normalize_search(last_name || ' ' || first_name || ' ' || coalesce(other_names, ''))) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.persons');
CREATE UNIQUE INDEX persons_identity_unique ON people.persons (tenant_id, identity_id) WHERE identity_id IS NOT NULL;
CREATE UNIQUE INDEX persons_external_ref_unique ON people.persons (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX persons_search_trgm ON people.persons USING gin (search_key gin_trgm_ops);
CREATE INDEX persons_duplicate_probe ON people.persons (tenant_id, search_key, birth_date);
CREATE INDEX persons_email ON people.persons (tenant_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX persons_phone ON people.persons (tenant_id, phone) WHERE phone IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON people.persons TO app_user;
```

### 5.2 Élèves, tuteurs, liens, projection

<!-- migration: 0801_people_students_guardians.sql -->
```sql
-- =============================================================================
-- 0801 — Module people (spec 008) : dossier permanent de l'élève, tuteurs, liens
-- =============================================================================
--
-- Principe PRD §10 : « Un changement de classe ou d'année ne crée jamais un nouvel élève. »
-- Le dossier permanent (`students`) ne porte AUCUNE donnée d'année : niveau, classe, financement,
-- redoublement, option… vivent sur `academic.enrollments`. `student_enrollment_summaries` n'est
-- qu'une PROJECTION de lecture alimentée par les événements `academic.enrollment.*` (pas de
-- jointure SQL entre schémas, ADR-006).
-- =============================================================================

CREATE TABLE people.students (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  person_id             uuid NOT NULL,
  student_number        text NOT NULL CHECK (length(btrim(student_number)) > 0),   -- matricule interne, immuable
  sequence_number       integer NOT NULL CHECK (sequence_number > 0),               -- n° d'ordre figé par tenant
  national_student_id   text CHECK (national_student_id IS NULL OR length(btrim(national_student_id)) > 0),
  status                text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'EXCLUDED', 'ARCHIVED')),
  first_enrolled_on     date,
  left_on               date,
  birth_certificate_number text,
  birth_certificate_date   date,
  civil_registry_office    text,
  attributes            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  external_ref          text CHECK (external_ref IS NULL OR length(btrim(external_ref)) > 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, person_id),
  UNIQUE (tenant_id, student_number),
  UNIQUE (tenant_id, sequence_number),
  CHECK (left_on IS NULL OR first_enrolled_on IS NULL OR left_on >= first_enrolled_on),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.persons (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.students');
CREATE UNIQUE INDEX students_national_id_unique ON people.students (tenant_id, national_student_id) WHERE national_student_id IS NOT NULL;
CREATE UNIQUE INDEX students_external_ref_unique ON people.students (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX students_by_status ON people.students (tenant_id, status);
GRANT SELECT, INSERT, UPDATE ON people.students TO app_user;

-- Historique de statut (fin du déclencheur 0099 : le motif et l'auteur sont désormais
-- renseignés et la création est historisée). Append-only.
CREATE TABLE people.student_status_history (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id   uuid NOT NULL,
  from_status  text,
  to_status    text NOT NULL,
  reason_code  text,
  reason_text  text,
  effective_on date NOT NULL DEFAULT current_date,
  changed_by   uuid,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES people.students (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.student_status_history');
CREATE INDEX student_status_history_by_student ON people.student_status_history (tenant_id, student_id, changed_at DESC);
GRANT SELECT, INSERT ON people.student_status_history TO app_user;

-- Historique scolaire d'avant l'établissement et diplômes d'entrée (bac, dernier diplôme…).
CREATE TABLE people.student_prior_education (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id    uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('SCHOOL', 'DIPLOMA', 'CERTIFICATE', 'OTHER')),
  label         text NOT NULL CHECK (length(btrim(label)) > 0),
  institution_name text,
  school_year   text,
  level_label   text,
  series_label  text,
  obtained_on   date,
  reference_number text,                    -- numéro du diplôme / de l'attestation (CEPE, BEPC, BAC…)
  document_ref  uuid,                       -- documents.documents.id (module 024) ; NULL tant que 024 n'existe pas
  attachment_object_key text,               -- pièce stockée via StoragePort en attendant 024
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES people.students (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.student_prior_education');
CREATE INDEX student_prior_education_by_student ON people.student_prior_education (tenant_id, student_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON people.student_prior_education TO app_user;

-- -----------------------------------------------------------------------------
-- Tuteurs (parents, tuteurs légaux, répondants financiers). Un tuteur est une personne ; il
-- n'a PAS besoin d'un compte pour exister (fin de « un parent = un utilisateur »).
-- -----------------------------------------------------------------------------
CREATE TABLE people.guardians (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  person_id   uuid NOT NULL,
  occupation  text,
  employer    text,
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, person_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.persons (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.guardians');
GRANT SELECT, INSERT, UPDATE ON people.guardians TO app_user;

-- Lien élève <-> tuteur. `portal_access` gouverne l'accès « enfant » des portails
-- (permissions `*.child.*` : la règle « cet élève est bien l'enfant de ce parent » est une
-- règle de domaine appliquée ici, pas un périmètre RBAC). Les drapeaux ne sont modifiables que
-- par le personnel habilité (fin de « le parent modifie lui-même `can_pickup` »).
CREATE TABLE people.student_guardians (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id              uuid NOT NULL,
  guardian_id             uuid NOT NULL,
  relationship_code       text NOT NULL,
  is_primary_contact      boolean NOT NULL DEFAULT false,
  is_emergency_contact    boolean NOT NULL DEFAULT false,
  is_financial_responsible boolean NOT NULL DEFAULT false,
  has_legal_custody       boolean NOT NULL DEFAULT false,
  can_pickup              boolean NOT NULL DEFAULT false,
  portal_access           boolean NOT NULL DEFAULT true,
  priority                integer NOT NULL DEFAULT 100 CHECK (priority >= 0),
  valid_from              date NOT NULL DEFAULT current_date,
  valid_to                date,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (tenant_id, student_id) REFERENCES people.students (tenant_id, id),
  FOREIGN KEY (tenant_id, guardian_id) REFERENCES people.guardians (tenant_id, id),
  FOREIGN KEY (tenant_id, relationship_code) REFERENCES people.relationship_types (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('people.student_guardians');
-- Un seul contact principal vivant par élève (le legacy n'imposait rien).
CREATE UNIQUE INDEX student_guardians_one_primary
  ON people.student_guardians (tenant_id, student_id) WHERE is_primary_contact AND valid_to IS NULL;
-- Un seul lien VIVANT par couple (élève, tuteur). Les liens clos restent (historique des tuteurs successifs) et un
-- lien clos puis rétabli donne une NOUVELLE ligne (correction de la spec : UNIQUE (tenant_id, student_id,
-- guardian_id) empêchait de rétablir un lien clos).
CREATE UNIQUE INDEX student_guardians_one_alive
  ON people.student_guardians (tenant_id, student_id, guardian_id) WHERE valid_to IS NULL;
CREATE INDEX student_guardians_by_student ON people.student_guardians (tenant_id, student_id, valid_to);
CREATE INDEX student_guardians_by_guardian ON people.student_guardians (tenant_id, guardian_id) WHERE valid_to IS NULL;
-- Pas de DELETE : un lien se clôt par valid_to (l'historique des tuteurs successifs est conservé).
GRANT SELECT, INSERT, UPDATE ON people.student_guardians TO app_user;

-- Contacts d'urgence rattachés à l'ÉLÈVE (le legacy les rattachait au parent).
CREATE TABLE people.student_emergency_contacts (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id    uuid NOT NULL,
  contact_name  text NOT NULL CHECK (length(btrim(contact_name)) > 0),
  relationship_label text,
  phone         text NOT NULL CHECK (length(phone) BETWEEN 5 AND 40),
  phone_alt     text CHECK (phone_alt IS NULL OR length(phone_alt) BETWEEN 5 AND 40),
  email         text CHECK (email IS NULL OR (length(email) <= 320 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  priority      integer NOT NULL DEFAULT 100 CHECK (priority >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES people.students (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.student_emergency_contacts');
CREATE INDEX student_emergency_contacts_by_student ON people.student_emergency_contacts (tenant_id, student_id, priority);
GRANT SELECT, INSERT, UPDATE, DELETE ON people.student_emergency_contacts TO app_user;

-- -----------------------------------------------------------------------------
-- Projection de lecture « élève x inscription » (alimentée par les événements academic.*,
-- idempotente par `source_event_id`, reconstructible par `rebuildEnrollmentProjection`).
-- Sert aux listes d'élèves filtrées par classe / année / statut et aux portails parent, sans
-- jointure inter-schémas.
-- -----------------------------------------------------------------------------
CREATE TABLE people.student_enrollment_summaries (
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id      uuid NOT NULL,                     -- academic.enrollments.id
  student_id         uuid NOT NULL,
  academic_year_id   uuid NOT NULL,
  institution_id     uuid NOT NULL,
  classroom_id       uuid NOT NULL,
  -- Libellés et références facultatifs : les payloads `academic.enrollment.*` sont minimaux (correction de la spec,
  -- qui les déclarait NOT NULL) ; la projection ne contient que ce que l'événement porte.
  classroom_name     text,
  program_id         uuid,
  program_label      text,
  grade_level_id     uuid,
  grade_level_label  text,
  mode               text NOT NULL DEFAULT 'CLASS',
  status             text NOT NULL,
  funding_type       text NOT NULL DEFAULT 'PRIVATE',
  registration_number text,
  enrolled_on        date NOT NULL,
  source_event_id    uuid NOT NULL,
  -- Instant de l'événement source : un événement plus ancien que l'état projeté est ignoré (l'ordre de livraison
  -- n'est pas garanti).
  source_occurred_at timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, enrollment_id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES people.students (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.student_enrollment_summaries');
CREATE INDEX student_enrollment_summaries_by_student ON people.student_enrollment_summaries (tenant_id, student_id, academic_year_id);
CREATE INDEX student_enrollment_summaries_by_class ON people.student_enrollment_summaries (tenant_id, classroom_id, status);
CREATE INDEX student_enrollment_summaries_by_year ON people.student_enrollment_summaries (tenant_id, academic_year_id, institution_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON people.student_enrollment_summaries TO app_user;
```

### 5.3 Invariants imposés par la base

<!-- migration: 0804_people_guards.sql -->
```sql
-- =============================================================================
-- 0804 — Module people (spec 008) : invariants des personnes, élèves et tuteurs
-- =============================================================================
-- (les invariants du personnel et des affectations sont en 0805, spec 009)

CREATE FUNCTION people.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'people.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER student_status_history_immutable BEFORE UPDATE OR DELETE ON people.student_status_history
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();

-- Jamais de suppression physique d'un dossier : on change le statut (le legacy supprimait en
-- cascade notes, présences, paiements et échéances avec la fiche élève).
CREATE TRIGGER persons_no_delete BEFORE DELETE ON people.persons
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER students_no_delete BEFORE DELETE ON people.students
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER guardians_no_delete BEFORE DELETE ON people.guardians
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER student_guardians_no_delete BEFORE DELETE ON people.student_guardians
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Élève : le matricule interne et le numéro d'ordre sont IMMUABLES (le legacy les réécrivait à
-- chaque lecture de la liste) ; transitions de statut légales.
--   ACTIVE <-> INACTIVE ; ACTIVE <-> SUSPENDED ; SUSPENDED -> INACTIVE ;
--   ACTIVE|INACTIVE|SUSPENDED -> GRADUATED | WITHDRAWN | TRANSFERRED_OUT | EXCLUDED ;
--   tout statut final -> ARCHIVED ; GRADUATED | WITHDRAWN | TRANSFERRED_OUT | EXCLUDED -> ACTIVE
--   (retour : réinscription ; motif exigé côté domaine) ; ARCHIVED -> ACTIVE.
-- -----------------------------------------------------------------------------
CREATE FUNCTION people.students_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_number <> OLD.student_number OR NEW.sequence_number <> OLD.sequence_number
     OR NEW.person_id <> OLD.person_id THEN
    RAISE EXCEPTION 'people.student_identity_immutable: matricule, numéro d''ordre et personne d''un élève sont figés'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'ACTIVE'    AND NEW.status IN ('INACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'EXCLUDED')) OR
       (OLD.status = 'INACTIVE'  AND NEW.status IN ('ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'EXCLUDED')) OR
       (OLD.status = 'SUSPENDED' AND NEW.status IN ('ACTIVE', 'INACTIVE', 'WITHDRAWN', 'TRANSFERRED_OUT', 'EXCLUDED')) OR
       (OLD.status IN ('GRADUATED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'EXCLUDED') AND NEW.status IN ('ARCHIVED', 'ACTIVE')) OR
       (OLD.status = 'ARCHIVED' AND NEW.status = 'ACTIVE')) THEN
    RAISE EXCEPTION 'people.student_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER students_guard BEFORE UPDATE ON people.students
  FOR EACH ROW EXECUTE FUNCTION people.students_guard();
```

### 5.4 Projection des accès IAM (liaison identité <-> personne)

<!-- migration: 0806_people_identity_links.sql -->
```sql
-- =============================================================================
-- 0806 — Module people : projection des accès IAM (liaison identité <-> personne)
-- =============================================================================
--
-- `persons.identity_id` désigne l'identité de connexion (module `iam`, schéma qu'on ne lit jamais : ADR-001/006).
-- Pour pouvoir (1) refuser de lier une personne à une identité qui n'a aucun accès dans CE tenant, (2) afficher
-- l'état du compte de portail d'une personne (actif / suspendu / aucun) sans jointure inter-schémas, le module
-- tient une PROJECTION minimale des accès, alimentée par les événements `iam.membership.created|changed`
-- (abonné `people.project-membership`, idempotent, insensible à l'ordre de livraison).
--
-- Aucune donnée personnelle : des UUID, un statut et des clés de rôle. Table de tenant (RLS forcée).
-- =============================================================================

CREATE TABLE people.identity_memberships (
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  identity_id        uuid NOT NULL,
  membership_id      uuid,
  status             text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked', 'invited', 'unknown')),
  roles              text[] NOT NULL DEFAULT '{}',
  source_event_id    uuid NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, identity_id)
);
SELECT kernel.enable_tenant_rls('people.identity_memberships');
GRANT SELECT, INSERT, UPDATE ON people.identity_memberships TO app_user;
```

> **Corrections apportées à la spec au moment de l'implémentation** (voir `apps/api/src/modules/people/README.md` §Écarts) : (1) `student_guardians` n'a plus `UNIQUE (tenant_id, student_id, guardian_id)` mais un index unique partiel sur les liens VIVANTS (un lien clos puis rétabli donne une nouvelle ligne) ; (2) `student_enrollment_summaries` : libellés et références facultatifs, `source_occurred_at` (insensibilité à l'ordre de livraison) ; (3) `settings.student_retention_days` (durée de conservation, donnée du tenant) ; (4) `persons.anonymized_at` ; (5) `staff_qualifications.expiry_alerted_for` (une alerte par franchissement de seuil) ; (6) extensions créées `WITH SCHEMA public` ; (7) index `persons_phone`.

## 6. Invariants : qui les garantit

| Invariant | Base (DDL) | Domaine / cas d'usage |
|---|---|---|
| Matricule et numéro d'ordre immuables, gapless | `students_guard`, `number_sequences_guard`, `next_number` | `createStudent` appelle `next_number` tard dans la transaction |
| Une personne = au plus un dossier élève / tuteur | `UNIQUE (tenant_id, person_id)` | `createStudent` réutilise une `persons` existante (confirmation explicite) |
| Un seul contact principal vivant par élève | index unique partiel `student_guardians_one_primary` | `updateGuardianLink` bascule le principal dans une transaction |
| Pas de doublon d'identifiant national / externe | index uniques partiels | `createStudent` idempotent par `externalRef` |
| Transitions de statut | `students_guard` | motif obligatoire pour les sorties |
| Historique de statut append-only | `forbid_mutation` | chaque changement écrit une ligne (auteur, motif) |
| Pas de suppression physique | `forbid_mutation` | archivage par statut |
| Détection de doublons de personnes | `persons_duplicate_probe` (index) | avertissement humain (`409 people.possible_duplicate`), jamais une contrainte |
| Téléphone / e-mail plausibles | CHECK de longueur / format | normalisation E.164 par le domaine |

## 7. Données de référence : modèle de pack

Section `people` du modèle de pack (`tenancy/templates/people/<educationSystem>/<pack>.json`, schéma Zod propriété du module), appliquée par `instantiatePackReferenceData` (idempotent, ne modifie pas les lignes personnalisées) :

```json
{
  "section": "people",
  "schemaVersion": 1,
  "educationSystem": "CI",
  "relationshipTypes": [
    { "code": "FATHER", "label": "Père", "kind": "GUARDIAN" },
    { "code": "MOTHER", "label": "Mère", "kind": "GUARDIAN" },
    { "code": "LEGAL_GUARDIAN", "label": "Tuteur légal", "kind": "GUARDIAN" },
    { "code": "GRANDPARENT", "label": "Grand-parent", "kind": "GUARDIAN" },
    { "code": "SIBLING", "label": "Frère ou sœur", "kind": "GUARDIAN" },
    { "code": "UNCLE_AUNT", "label": "Oncle ou tante", "kind": "GUARDIAN" },
    { "code": "EMERGENCY_CONTACT", "label": "Contact d'urgence", "kind": "EMERGENCY" },
    { "code": "OTHER", "label": "Autre", "kind": "OTHER" }
  ],
  "staffCategories": [
    { "code": "TEACHER", "label": "Enseignant", "canTeach": true },
    { "code": "EDUCATOR", "label": "Éducateur", "canSupervise": true },
    { "code": "ADMIN", "label": "Personnel administratif" },
    { "code": "DIRECTION", "label": "Direction" },
    { "code": "SUPPORT", "label": "Personnel d'appui" }
  ],
  "contractTypes": [
    { "code": "CDI", "label": "Contrat à durée indéterminée", "kind": "PERMANENT" },
    { "code": "CDD", "label": "Contrat à durée déterminée", "kind": "FIXED_TERM" },
    { "code": "VACATION", "label": "Vacation", "kind": "CASUAL" },
    { "code": "OTHER", "label": "Autre", "kind": "OTHER" }
  ],
  "settings": { "studentNumberPattern": "{SEQ:5}", "staffNumberPattern": "P{SEQ:4}", "duplicateCheckEnabled": true, "expiryAlertDays": 60 },
  "studentAttributesSchema": "ci-student-v1"
}
```

Les durées légales de contrats, congés ou stages ne sont pas des données de pack tant que le propriétaire n'a pas fourni les textes (voir `open-questions.md`).

## 8. Chemins d'accès et index

| Besoin | Requête | Index |
|---|---|---|
| Recherche par nom | `search_key % $q` ou `LIKE` normalisé | `persons_search_trgm` |
| Détection de doublon | `search_key = $k AND birth_date = $d` | `persons_duplicate_probe` |
| Dossier d'un compte portail | `WHERE identity_id = $1` | `persons_identity_unique` |
| Matricule | `WHERE student_number = $1` | `UNIQUE (tenant_id, student_number)` |
| Enfants d'un parent | `student_guardians` par `guardian_id` vivant → `students` | `student_guardians_by_guardian` |
| Élèves d'une classe | projection par `classroom_id` + `status` | `student_enrollment_summaries_by_class` |
| Historique de statut | `WHERE student_id = $1 ORDER BY changed_at DESC` | `student_status_history_by_student` |

## 9. Reprise de l'existant

Aucune donnée de production n'est reprise (D8). Les tables `student_profiles`, `student_parents`, `emergency_contacts`, `student_status_history` (legacy), `professional_student_matricules`, `student_provenances` (hors périmètre : prospection) sont supprimées dans la tranche 2.2. Les seeds déterministes des environnements de démonstration créent élèves, tuteurs et liens via les cas d'usage (jamais par SQL), ce qui exerce la numérotation et les événements.
