-- =============================================================================
-- 0952 — Module scheduling (spec 017) : occurrences, intervenants, réservations de ressources
-- =============================================================================
--
-- UN SEUL agrégat « séance » : planification, constat de réalisation, validation pour la paie,
-- avec une machine d'états explicite :
--
--     PLANNED --constat (appel soumis ou action admin)--> HELD --validation--> HELD + validated_at
--        \--> CANCELLED (depuis PLANNED, ou HELD non validée)
--
-- La validation (`validated_at`) est un acte de gestion DISTINCT du constat pédagogique
-- (parité : professional-seance-validation). Le bénéficiaire de la paie est l'INTERVENANT RÉEL
-- (`occurrence_staff`, remplaçant compris), jamais le titulaire de l'affectation d'enseignement.
--
-- Écarts assumés avec le DDL de référence (voir README, « Écarts avec la spec 017 ») :
--   * generated_for : date du patron pour laquelle l'occurrence a été générée. L'unicité porte
--     sur (patron, generated_for) et non (patron, date, heure) : une occurrence REPORTÉE ne doit
--     pas être régénérée à son créneau d'origine, et un patron modifié (propagate = NONE) ne doit
--     pas créer de doublon à côté des occurrences déjà générées (question Q3 de parity.md).
--   * replacement_reason : pourquoi la séance est « à remplacer » (absence, départ, salle…).
-- =============================================================================

CREATE TABLE scheduling.session_occurrences (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id           uuid NOT NULL,
  campus_id                uuid,
  academic_year_id         uuid NOT NULL,
  timetable_entry_id       uuid,
  generated_for            date,                              -- date du patron ayant produit l'occurrence (NULL hors génération)
  generated_from           jsonb CHECK (generated_from IS NULL OR jsonb_typeof(generated_from) = 'object'),   -- horaire et salle du patron à la génération (détecte une modification à la main)
  kind                     text NOT NULL DEFAULT 'LESSON' CHECK (kind IN ('LESSON', 'EXAM', 'MEETING', 'EVENT', 'RESERVATION', 'COUNCIL', 'OTHER')),
  title                    text,
  classroom_id             uuid,                              -- academic.classrooms.id
  curriculum_node_id       uuid,                              -- academic.curriculum_nodes.id
  offering_id              uuid,                              -- academic.classroom_offerings.id
  claims_classroom         boolean NOT NULL DEFAULT true,     -- false pour une offre à la carte (la classe n'est pas réunie)
  room_id                  uuid,
  starts_at                timestamptz NOT NULL,
  ends_at                  timestamptz NOT NULL,
  occurs_on                date NOT NULL,                     -- date civile dans le fuseau de l'établissement
  during                   tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  delivery_mode            text NOT NULL DEFAULT 'IN_PERSON' CHECK (delivery_mode IN ('IN_PERSON', 'ONLINE', 'HYBRID')),
  virtual_session_ref      uuid,                              -- classe virtuelle (modules 022/023)
  status                   text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'HELD', 'CANCELLED')),
  held_at                  timestamptz,
  held_source              text CHECK (held_source IN ('ATTENDANCE', 'ADMIN', 'AUTO')),
  held_by                  uuid,
  cancelled_at             timestamptz,
  cancel_reason            text,
  validated_at             timestamptz,
  validated_by             uuid,
  origin                   text NOT NULL DEFAULT 'GENERATED' CHECK (origin IN ('GENERATED', 'AD_HOC', 'ACCOUNTING', 'IMPORT')),
  conflict_override        boolean NOT NULL DEFAULT false,
  conflict_override_reason text,
  conflict_override_by     uuid,
  needs_replacement        boolean NOT NULL DEFAULT false,
  replacement_reason       text CHECK (replacement_reason IN ('STAFF_LEAVE', 'STAFF_LEFT', 'STAFF_SUSPENDED', 'ASSIGNMENT_ENDED', 'ROOM_UNAVAILABLE', 'OTHER')),
  notes                    text,
  location_label           text,                              -- lieu libre hors salle du référentiel (sortie, examen délocalisé)
  attributes               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),   -- ex. type d'examen, surveillants
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK (abs(occurs_on - (starts_at AT TIME ZONE 'UTC')::date) <= 1),
  CHECK (kind <> 'LESSON' OR (classroom_id IS NOT NULL AND curriculum_node_id IS NOT NULL) OR origin = 'ACCOUNTING'),
  CHECK (claims_classroom OR offering_id IS NOT NULL),
  CHECK (status <> 'HELD' OR (held_at IS NOT NULL AND held_source IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)),
  CHECK (validated_at IS NULL OR status = 'HELD'),
  CHECK ((validated_at IS NULL) = (validated_by IS NULL)),
  CHECK (NOT conflict_override OR (conflict_override_reason IS NOT NULL AND conflict_override_by IS NOT NULL)),
  CHECK (needs_replacement = (replacement_reason IS NOT NULL)),
  FOREIGN KEY (tenant_id, timetable_entry_id) REFERENCES scheduling.timetable_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES scheduling.rooms (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.session_occurrences');
-- Génération idempotente : un patron ne produit qu'une occurrence par date de patron.
CREATE UNIQUE INDEX occurrences_entry_generated_for
  ON scheduling.session_occurrences (tenant_id, timetable_entry_id, generated_for)
  WHERE timetable_entry_id IS NOT NULL;
CREATE INDEX occurrences_by_date ON scheduling.session_occurrences (tenant_id, institution_id, occurs_on, starts_at);
CREATE INDEX occurrences_by_class ON scheduling.session_occurrences (tenant_id, classroom_id, occurs_on) WHERE classroom_id IS NOT NULL;
CREATE INDEX occurrences_by_offering ON scheduling.session_occurrences (tenant_id, offering_id, occurs_on) WHERE offering_id IS NOT NULL;
CREATE INDEX occurrences_by_room ON scheduling.session_occurrences (tenant_id, room_id, occurs_on) WHERE room_id IS NOT NULL;
CREATE INDEX occurrences_by_node ON scheduling.session_occurrences (tenant_id, curriculum_node_id, occurs_on) WHERE curriculum_node_id IS NOT NULL;
CREATE INDEX occurrences_to_hold ON scheduling.session_occurrences (tenant_id, occurs_on) WHERE status = 'PLANNED';
CREATE INDEX occurrences_to_validate ON scheduling.session_occurrences (tenant_id, occurs_on) WHERE status = 'HELD' AND validated_at IS NULL;
CREATE INDEX occurrences_to_replace ON scheduling.session_occurrences (tenant_id, occurs_on) WHERE needs_replacement;
GRANT SELECT, INSERT, UPDATE ON scheduling.session_occurrences TO app_user;

-- Intervenants d'une occurrence. `paid_minutes` = dérogation comptable (« durée payée »), la
-- durée planifiée restant intacte. `locked_at` : posé par la paie quand les heures sont
-- incluses dans un bulletin non annulé ; une ligne verrouillée ne change plus.
CREATE TABLE scheduling.occurrence_staff (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  occurrence_id     uuid NOT NULL,
  staff_id          uuid NOT NULL,                        -- people.staff.id
  role              text NOT NULL DEFAULT 'LEAD' CHECK (role IN ('LEAD', 'CO_TEACHER', 'SUBSTITUTE', 'SUPERVISOR')),
  replaces_staff_id uuid,
  is_paid_role      boolean NOT NULL DEFAULT true,
  paid_minutes      integer CHECK (paid_minutes IS NULL OR paid_minutes BETWEEN 1 AND 1440),   -- au plus une journée (garde-fou technique, pas un plafond de paie)
  paid_minutes_by   uuid,
  paid_minutes_at   timestamptz,
  locked_at         timestamptz,
  lock_ref          uuid,                                  -- identifiant du bulletin / de la ligne de paie
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, occurrence_id, staff_id),
  CHECK (role <> 'SUBSTITUTE' OR replaces_staff_id IS NOT NULL),
  CHECK (replaces_staff_id IS NULL OR replaces_staff_id <> staff_id),
  CHECK ((paid_minutes IS NULL) = (paid_minutes_by IS NULL)),
  CHECK ((locked_at IS NULL) = (lock_ref IS NULL)),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES scheduling.session_occurrences (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.occurrence_staff');
CREATE INDEX occurrence_staff_by_staff ON scheduling.occurrence_staff (tenant_id, staff_id);
CREATE INDEX occurrence_staff_locked ON scheduling.occurrence_staff (tenant_id, lock_ref) WHERE locked_at IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.occurrence_staff TO app_user;

CREATE TABLE scheduling.occurrence_equipment (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  occurrence_id uuid NOT NULL,
  equipment_id  uuid NOT NULL,
  quantity      integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  PRIMARY KEY (tenant_id, occurrence_id, equipment_id),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES scheduling.session_occurrences (tenant_id, id),
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES scheduling.equipment_items (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.occurrence_equipment');
CREATE INDEX occurrence_equipment_by_item ON scheduling.occurrence_equipment (tenant_id, equipment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.occurrence_equipment TO app_user;

-- -----------------------------------------------------------------------------
-- Réservations de ressources exclusives (enseignant, classe, salle). Table DÉRIVÉE, maintenue
-- exclusivement par les déclencheurs SECURITY DEFINER de 0953 (l'application n'a que SELECT) ;
-- c'est elle qui rend le double-booking IMPOSSIBLE même sous concurrence : la contrainte
-- d'exclusion est vérifiée au COMMIT (DEFERRABLE) pour permettre d'échanger deux enseignants
-- dans la même transaction (les cas d'usage la passent en IMMEDIATE pour localiser l'erreur).
-- `exclusive = false` pour une politique WARN ou un dépassement autorisé (`conflict_override`,
-- motivé et audité).
-- -----------------------------------------------------------------------------
CREATE TABLE scheduling.resource_claims (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  occurrence_id  uuid NOT NULL,
  resource_kind  text NOT NULL CHECK (resource_kind IN ('STAFF', 'CLASSROOM', 'ROOM')),
  resource_id    uuid NOT NULL,
  during         tstzrange NOT NULL,
  exclusive      boolean NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, occurrence_id, resource_kind, resource_id),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES scheduling.session_occurrences (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT resource_claims_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, resource_kind WITH =, resource_id WITH =, during WITH &&
  ) WHERE (exclusive) DEFERRABLE INITIALLY DEFERRED
);
SELECT kernel.enable_tenant_rls('scheduling.resource_claims');
CREATE INDEX resource_claims_by_resource ON scheduling.resource_claims (tenant_id, resource_kind, resource_id);
GRANT SELECT ON scheduling.resource_claims TO app_user;

-- Journal des changements d'une occurrence (heure, salle, intervenant, statut, validation) :
-- le legacy ne gardait aucune trace des séances modifiées après validation. Append-only.
CREATE TABLE scheduling.occurrence_changes (
  id             uuid PRIMARY KEY,
  seq            bigint GENERATED ALWAYS AS IDENTITY,   -- ordre total du journal (plusieurs lignes dans une même transaction)
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  occurrence_id  uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('CREATED', 'RESCHEDULED', 'ROOM_CHANGED', 'STAFF_CHANGED', 'HELD', 'UNHELD', 'CANCELLED', 'VALIDATED', 'UNVALIDATED', 'PAID_MINUTES', 'OVERRIDE', 'LOCKED', 'UNLOCKED', 'OTHER')),
  from_value     jsonb,
  to_value       jsonb,
  reason         text,
  actor_id       uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES scheduling.session_occurrences (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.occurrence_changes');
CREATE INDEX occurrence_changes_by_occurrence ON scheduling.occurrence_changes (tenant_id, occurrence_id, seq);
GRANT SELECT, INSERT ON scheduling.occurrence_changes TO app_user;
