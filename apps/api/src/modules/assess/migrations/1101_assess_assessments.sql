-- =============================================================================
-- 1101 — Module assess : évaluations et historique des transitions du circuit
-- =============================================================================

CREATE TABLE assess.assessments (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  type_id            uuid NOT NULL,
  -- références du cœur : UUID sans clé étrangère
  classroom_id       uuid NOT NULL,
  curriculum_node_id uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  academic_year_id   uuid NOT NULL,
  teacher_id         uuid NOT NULL,                       -- people.staff.id
  title              text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  assessed_on        date NOT NULL,
  scale_max          numeric(8,3) NOT NULL CHECK (scale_max > 0),
  weight             numeric(8,3) NOT NULL DEFAULT 1 CHECK (weight >= 0),
  session_no         smallint NOT NULL DEFAULT 1 CHECK (session_no IN (1, 2)),
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'PUBLISHED', 'CANCELLED')),
  submitted_at       timestamptz,
  submitted_by       uuid,
  reviewed_at        timestamptz,
  reviewed_by        uuid,
  approved_at        timestamptz,
  approved_by        uuid,
  published_at       timestamptz,
  published_by       uuid,
  cancelled_at       timestamptz,
  cancelled_by       uuid,
  cancel_reason      text,
  four_eyes_waived   boolean NOT NULL DEFAULT false,      -- dérogation tracée (Q-11)
  return_comment     text,                                -- dernier motif de retour à DRAFT
  row_version        integer NOT NULL DEFAULT 1,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES assess.assessment_types (tenant_id, id),
  -- cohérence statut / horodatage
  CHECK (status NOT IN ('SUBMITTED', 'REVIEWED', 'APPROVED', 'PUBLISHED') OR (submitted_at IS NOT NULL AND submitted_by IS NOT NULL)),
  CHECK (status NOT IN ('REVIEWED', 'APPROVED', 'PUBLISHED') OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)),
  CHECK (status NOT IN ('APPROVED', 'PUBLISHED') OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CHECK (status <> 'PUBLISHED' OR (published_at IS NOT NULL AND published_by IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE INDEX assessments_class_period_idx ON assess.assessments (tenant_id, classroom_id, academic_period_id, status);
CREATE INDEX assessments_node_idx         ON assess.assessments (tenant_id, curriculum_node_id, academic_period_id);
CREATE INDEX assessments_teacher_idx      ON assess.assessments (tenant_id, teacher_id, status);
SELECT kernel.enable_tenant_rls('assess.assessments');
GRANT SELECT, INSERT, UPDATE ON assess.assessments TO app_user;       -- jamais DELETE

-- Historique APPEND-ONLY des transitions du circuit (acteur, date, commentaire, dérogation).
CREATE TABLE assess.assessment_transitions (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  assessment_id     uuid NOT NULL,
  from_status       text,
  to_status         text NOT NULL,
  actor_id          uuid,
  actor_name        text,
  comment           text,
  four_eyes_waived  boolean NOT NULL DEFAULT false,
  at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES assess.assessments (tenant_id, id)
);
CREATE INDEX assessment_transitions_idx ON assess.assessment_transitions (tenant_id, assessment_id, at);
SELECT kernel.enable_tenant_rls('assess.assessment_transitions');
GRANT SELECT, INSERT ON assess.assessment_transitions TO app_user;
