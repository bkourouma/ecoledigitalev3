-- =============================================================================
-- 0802 — Module people (spec 009) : personnel, contrats, qualifications, disponibilités
-- =============================================================================
--
-- `people.staff.id` est l'identifiant stable consommé par scheduling, attendance, la paie
-- (spec 032) et les évaluations (assess). Le legacy ne connaissait que `teachers` (une fiche
-- sans disponibilité, sans contrat daté, sans personnel administratif) : tout le personnel est
-- désormais une ligne `staff`, l'enseignant étant un membre du personnel dont la catégorie
-- `can_teach`.
-- =============================================================================

CREATE TABLE people.staff (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  person_id              uuid NOT NULL,
  staff_number           text NOT NULL CHECK (length(btrim(staff_number)) > 0),
  category_code          text NOT NULL,
  job_title              text,
  status                 text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'LEFT')),
  hired_on               date,
  left_on                date,
  primary_institution_id uuid,                    -- tenancy.institutions.id (sans FK)
  primary_campus_id      uuid,                    -- tenancy.campuses.id (sans FK)
  attributes             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  external_ref           text CHECK (external_ref IS NULL OR length(btrim(external_ref)) > 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, person_id),
  UNIQUE (tenant_id, staff_number),
  CHECK (left_on IS NULL OR hired_on IS NULL OR left_on >= hired_on),
  CHECK (status <> 'LEFT' OR left_on IS NOT NULL),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.persons (tenant_id, id),
  FOREIGN KEY (tenant_id, category_code) REFERENCES people.staff_categories (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('people.staff');
CREATE UNIQUE INDEX staff_external_ref_unique ON people.staff (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX staff_by_status ON people.staff (tenant_id, status, category_code);
GRANT SELECT, INSERT, UPDATE ON people.staff TO app_user;

-- Établissements / campus où le membre du personnel intervient (un enseignant du collège et du
-- lycée du même groupe). Alimente le périmètre RBAC et les listes par établissement.
CREATE TABLE people.staff_affiliations (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id       uuid NOT NULL,
  institution_id uuid NOT NULL,
  campus_id      uuid,
  valid_from     date NOT NULL DEFAULT current_date,
  valid_to       date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id),
  EXCLUDE USING gist (
    tenant_id WITH =, staff_id WITH =, institution_id WITH =,
    (coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('people.staff_affiliations');
CREATE INDEX staff_affiliations_by_institution ON people.staff_affiliations (tenant_id, institution_id, staff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON people.staff_affiliations TO app_user;

-- Contrats DATÉS (le legacy n'avait qu'un `contract_type` libre sur la fiche, sans durée). Les
-- tarifs et la rémunération restent dans la paie (spec 031/032) : ici, la relation de travail.
CREATE TABLE people.staff_contracts (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id            uuid NOT NULL,
  contract_type_code  text NOT NULL,
  starts_on           date NOT NULL,
  ends_on             date,
  committed_hours     numeric(7, 2) CHECK (committed_hours IS NULL OR committed_hours >= 0),
  committed_hours_unit text CHECK (committed_hours_unit IN ('PER_WEEK', 'PER_YEAR')),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED')),
  document_ref        uuid,                        -- documents.documents.id (module 024)
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK ((committed_hours IS NULL) = (committed_hours_unit IS NULL)),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id),
  FOREIGN KEY (tenant_id, contract_type_code) REFERENCES people.contract_types (tenant_id, code),
  EXCLUDE USING gist (
    tenant_id WITH =, staff_id WITH =, contract_type_code WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  ) WHERE (status IN ('DRAFT', 'ACTIVE'))
);
SELECT kernel.enable_tenant_rls('people.staff_contracts');
CREATE INDEX staff_contracts_by_staff ON people.staff_contracts (tenant_id, staff_id, starts_on DESC);
GRANT SELECT, INSERT, UPDATE ON people.staff_contracts TO app_user;

-- Qualifications, diplômes, habilitations (avec expiration : alerte « document qui expire »).
CREATE TABLE people.staff_qualifications (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id     uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('DIPLOMA', 'CERTIFICATION', 'AUTHORIZATION', 'OTHER')),
  label        text NOT NULL CHECK (length(btrim(label)) > 0),
  issuer       text,
  obtained_on  date,
  expires_on   date,
  -- Date d'expiration pour laquelle l'alerte `people.staff_qualification.expiring` a déjà été publiée : une alerte par
  -- franchissement de seuil (idempotence du job) ; si l'expiration est repoussée, une nouvelle alerte redevient possible.
  expiry_alerted_for date,
  document_ref uuid,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (expires_on IS NULL OR obtained_on IS NULL OR expires_on >= obtained_on),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.staff_qualifications');
CREATE INDEX staff_qualifications_expiry ON people.staff_qualifications (tenant_id, expires_on) WHERE expires_on IS NOT NULL;
CREATE INDEX staff_qualifications_by_staff ON people.staff_qualifications (tenant_id, staff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON people.staff_qualifications TO app_user;

-- Compétences d'enseignement : « peut enseigner la matière X (niveaux Y) ». Information de
-- planification (avertissement, jamais blocage) pour l'affectation et l'emploi du temps.
CREATE TABLE people.staff_competencies (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id          uuid NOT NULL,
  subject_id        uuid NOT NULL,                  -- academic.subjects.id (sans FK)
  grade_level_codes text[] NOT NULL DEFAULT '{}',   -- vide = tous niveaux
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, staff_id, subject_id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.staff_competencies');
GRANT SELECT, INSERT, UPDATE, DELETE ON people.staff_competencies TO app_user;

-- Disponibilités hebdomadaires (le legacy n'en avait que pour les formateurs Imhotep, supprimés).
-- UNAVAILABLE l'emporte sur AVAILABLE ; aucune ligne = disponible (sauf politique contraire du
-- tenant côté scheduling). Jour ISO 1 (lundi) à 7 (dimanche).
CREATE TABLE people.staff_availabilities (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id    uuid NOT NULL,
  campus_id   uuid,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  kind        text NOT NULL DEFAULT 'UNAVAILABLE' CHECK (kind IN ('AVAILABLE', 'UNAVAILABLE')),
  valid_from  date,
  valid_to    date,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (end_time > start_time),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.staff_availabilities');
CREATE INDEX staff_availabilities_by_staff ON people.staff_availabilities (tenant_id, staff_id, weekday);
GRANT SELECT, INSERT, UPDATE, DELETE ON people.staff_availabilities TO app_user;

CREATE TABLE people.staff_status_history (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id     uuid NOT NULL,
  from_status  text,
  to_status    text NOT NULL,
  reason_text  text,
  effective_on date NOT NULL DEFAULT current_date,
  changed_by   uuid,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.staff_status_history');
CREATE INDEX staff_status_history_by_staff ON people.staff_status_history (tenant_id, staff_id, changed_at DESC);
GRANT SELECT, INSERT ON people.staff_status_history TO app_user;
