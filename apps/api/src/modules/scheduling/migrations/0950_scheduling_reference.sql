-- =============================================================================
-- 0950 — Module scheduling : schéma, référentiels, salles, équipements, grille, calendrier
-- =============================================================================
--
-- Plage de numéros réservée au module scheduling : 0950–0999 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md).
--
-- Trois couches du legacy Professional (grille hebdomadaire `professional_emploi_temps`,
-- planning ponctuel `professional_course_plannings`, séance réalisée `professional_ecue_seances`)
-- et l'unique objet daté de l'académique (`session_instances`) deviennent :
--     timetable_entries  (patron récurrent)  ->  session_occurrences  (instance datée)
-- avec des conflits imposés par la base (resource_claims). Les salles sont des clés (plus de
-- texte libre « TBD »), le fuseau vient de l'établissement (plus de `Europe/Paris` en dur).
-- Références inter-modules par UUID, sans FK : tenancy (établissement, campus), academic
-- (année, classe, nœud, offre), people (personnel).
--
-- Écarts assumés avec le DDL de référence de specs/v2/017-scheduling/data-model.md (voir README) :
--   * settings : + generation_horizon_weeks (génération glissante), + supervisors_paid (O-06).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS scheduling;
REVOKE ALL ON SCHEMA scheduling FROM PUBLIC;
GRANT USAGE ON SCHEMA scheduling TO app_user;

-- Opérateurs d'égalité (uuid, text) dans les index GiST des contraintes d'exclusion.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Types de salle (salle de classe, laboratoire, amphithéâtre, gymnase…), donnée de pack.
CREATE TABLE scheduling.room_types (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.room_types');
GRANT SELECT, INSERT, UPDATE ON scheduling.room_types TO app_user;

-- Types d'événements de calendrier (férié, vacances, fermeture, examen, réunion…).
CREATE TABLE scheduling.calendar_event_kinds (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  code                    text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                   text NOT NULL CHECK (length(btrim(label)) > 0),
  blocks_teaching_default boolean NOT NULL DEFAULT false,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.calendar_event_kinds');
GRANT SELECT, INSERT, UPDATE ON scheduling.calendar_event_kinds TO app_user;

-- Paramètres par établissement (une ligne).
--   timezone : fuseau IANA de l'établissement (copié du CountryProfile à la création) ;
--   staff_availability_mode : OPEN = disponible sauf indisponibilité déclarée ; CLOSED =
--       indisponible sauf disponibilité déclarée ;
--   max_generation_weeks : garde-fou technique de la génération d'occurrences (pas une règle
--       métier : la génération est bornée par la période / validité réelle) ;
--   generation_horizon_weeks : horizon de la génération glissante (job quotidien) ;
--   allow_self_validation : false = « quatre yeux » : celui qui crée une séance comptable ne peut
--       pas la valider (le legacy tolérait le cumul, seulement tracé par `saisie_comptable`) ;
--   supervisors_paid : les surveillants (rôle SUPERVISOR) sont-ils rémunérés ? (question O-06,
--       réponse par défaut : non, réglable) ;
--   opening_* : amplitude d'ouverture des salles (dénominateur du taux d'occupation) ; NULL =
--       taux d'occupation indisponible (le legacy codait 12 h x 6 j = 72 h par semaine).
CREATE TABLE scheduling.settings (
  tenant_id                uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id           uuid NOT NULL,
  timezone                 text NOT NULL DEFAULT 'Africa/Abidjan' CHECK (length(btrim(timezone)) > 0),
  staff_availability_mode  text NOT NULL DEFAULT 'OPEN' CHECK (staff_availability_mode IN ('OPEN', 'CLOSED')),
  max_generation_weeks     integer NOT NULL DEFAULT 60 CHECK (max_generation_weeks BETWEEN 1 AND 120),
  generation_horizon_weeks integer NOT NULL DEFAULT 6 CHECK (generation_horizon_weeks BETWEEN 1 AND 120),
  allow_self_validation    boolean NOT NULL DEFAULT false,
  supervisors_paid         boolean NOT NULL DEFAULT false,
  opening_start            time,
  opening_end              time,
  opening_weekdays         smallint[] CHECK (opening_weekdays IS NULL OR opening_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id),
  CHECK ((opening_start IS NULL) = (opening_end IS NULL) AND (opening_start IS NULL OR opening_end > opening_start)),
  CHECK (generation_horizon_weeks <= max_generation_weeks)
);
SELECT kernel.enable_tenant_rls('scheduling.settings');
GRANT SELECT, INSERT, UPDATE ON scheduling.settings TO app_user;

-- Politique de conflit par ressource : BLOCK (refus à l'écriture, imposé par la base) ou WARN
-- (autorisé, signalé). Absence de ligne = BLOCK.
CREATE TABLE scheduling.conflict_policies (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  resource_kind  text NOT NULL CHECK (resource_kind IN ('STAFF', 'CLASSROOM', 'ROOM', 'EQUIPMENT')),
  mode           text NOT NULL CHECK (mode IN ('BLOCK', 'WARN')),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id, resource_kind)
);
SELECT kernel.enable_tenant_rls('scheduling.conflict_policies');
GRANT SELECT, INSERT, UPDATE ON scheduling.conflict_policies TO app_user;

-- -----------------------------------------------------------------------------
-- Salles (physiques). NE PAS confondre avec academic.classrooms (la classe).
-- Une salle hors service refuse toute nouvelle réservation (garde dans 0953).
-- -----------------------------------------------------------------------------
CREATE TABLE scheduling.rooms (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  campus_id      uuid NOT NULL,
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  room_type_code text NOT NULL,
  capacity       integer CHECK (capacity IS NULL OR capacity > 0),
  building       text,
  floor_label    text,
  features       text[] NOT NULL DEFAULT '{}',        -- équipements fixes (vidéoprojecteur, tableau…), aide au placement
  status         text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OUT_OF_SERVICE', 'ARCHIVED')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campus_id, code),
  FOREIGN KEY (tenant_id, room_type_code) REFERENCES scheduling.room_types (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.rooms');
CREATE INDEX rooms_by_institution ON scheduling.rooms (tenant_id, institution_id, status);
GRANT SELECT, INSERT, UPDATE ON scheduling.rooms TO app_user;

-- Équipements réservables (vidéoprojecteurs, kits de TP…) : un STOCK par campus, le conflit
-- est un dépassement de quantité sur un créneau (et non une exclusivité).
CREATE TABLE scheduling.equipment_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  campus_id      uuid NOT NULL,
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  quantity       integer NOT NULL CHECK (quantity >= 1),
  status         text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OUT_OF_SERVICE', 'ARCHIVED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campus_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.equipment_items');
GRANT SELECT, INSERT, UPDATE ON scheduling.equipment_items TO app_user;

-- Grille horaire (cloches) de l'établissement. Facultative : le supérieur planifie en plages
-- libres, les conflits se calculent sur les heures réelles, jamais sur le créneau nominal.
CREATE TABLE scheduling.time_slots (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  campus_id      uuid,
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  starts_time    time NOT NULL,
  ends_time      time NOT NULL,
  is_break       boolean NOT NULL DEFAULT false,
  ordinal        integer NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_time > starts_time)
);
SELECT kernel.enable_tenant_rls('scheduling.time_slots');
CREATE UNIQUE INDEX time_slots_code_unique
  ON scheduling.time_slots (tenant_id, institution_id, (coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid)), code);
GRANT SELECT, INSERT, UPDATE ON scheduling.time_slots TO app_user;

-- -----------------------------------------------------------------------------
-- Calendrier de l'établissement : événements en PLAGE de dates (le legacy ne stockait qu'une
-- date par événement) ; `blocks_teaching` retire les jours de la génération des occurrences et
-- signale les occurrences existantes. Les jours fériés ne sont JAMAIS codés : l'établissement
-- (ou un référentiel pays validé ultérieurement) les saisit (question O-10).
-- -----------------------------------------------------------------------------
CREATE TABLE scheduling.calendar_events (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  campus_id        uuid,
  academic_year_id uuid,
  kind_code        text NOT NULL,
  title            text NOT NULL CHECK (length(btrim(title)) > 0),
  description      text,
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  starts_time      time,
  ends_time        time,
  blocks_teaching  boolean NOT NULL DEFAULT false,
  audience         text[] NOT NULL DEFAULT ARRAY['STAFF', 'STUDENTS', 'GUARDIANS'],
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_on >= starts_on),
  CHECK ((starts_time IS NULL) = (ends_time IS NULL)),
  CHECK (audience <@ ARRAY['STAFF', 'STUDENTS', 'GUARDIANS']),
  FOREIGN KEY (tenant_id, kind_code) REFERENCES scheduling.calendar_event_kinds (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.calendar_events');
CREATE INDEX calendar_events_by_range ON scheduling.calendar_events USING gist (tenant_id, institution_id, daterange(starts_on, ends_on, '[]'));
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.calendar_events TO app_user;
