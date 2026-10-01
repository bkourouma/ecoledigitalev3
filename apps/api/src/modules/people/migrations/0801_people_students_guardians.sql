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
