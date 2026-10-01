-- =============================================================================
-- 1202 — Module results : surcharges, délibérations, décisions, appréciations
-- =============================================================================

CREATE TABLE results.overrides (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id           uuid NOT NULL,
  enrollment_id      uuid NOT NULL,
  level              text NOT NULL CHECK (level IN ('ECUE', 'SUBJECT', 'UE', 'SECTION', 'PERIOD', 'YEAR')),
  curriculum_node_id uuid,
  rule_key           text NOT NULL,                   -- étape surchargée (ex. note_ecue, ecue_validee)
  kind               text NOT NULL CHECK (kind IN ('VALUE', 'VALIDATION')),
  original_value     text,                            -- décimal exact ou booléen, tel que calculé
  override_value     numeric,
  override_flag      boolean,
  justification      text NOT NULL CHECK (length(btrim(justification)) >= 20),
  requested_by       uuid NOT NULL,
  requested_by_name  text NOT NULL,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED')),
  decided_by         uuid,
  decided_by_name    text,
  decided_at         timestamptz,
  decision_comment   text,
  revoked_reason     text,
  four_eyes_waived   boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id),
  CHECK ((kind = 'VALUE') = (override_value IS NOT NULL)),
  CHECK ((kind = 'VALIDATION') = (override_flag IS NOT NULL)),
  CHECK (status NOT IN ('APPROVED', 'REJECTED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (decided_by IS NULL OR four_eyes_waived OR decided_by <> requested_by),
  CHECK (status <> 'REVOKED' OR revoked_reason IS NOT NULL)
);
-- une seule surcharge ACTIVE par cible
CREATE UNIQUE INDEX overrides_active_uq ON results.overrides
  (tenant_id, state_id, enrollment_id, rule_key, coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('REQUESTED', 'APPROVED');
CREATE INDEX overrides_state_idx ON results.overrides (tenant_id, state_id, status);
SELECT kernel.enable_tenant_rls('results.overrides');
GRANT SELECT, INSERT, UPDATE ON results.overrides TO app_user;

CREATE TABLE results.deliberations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,
  state_id           uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('COUNCIL', 'JURY')),
  held_on            date,
  status             text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'HELD', 'SIGNED', 'CANCELLED')),
  participants       jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{ staffId, role }]
  minutes_object_key text,                                      -- procès-verbal (StoragePort)
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id),
  CHECK (status NOT IN ('HELD', 'SIGNED') OR held_on IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('results.deliberations');
GRANT SELECT, INSERT, UPDATE ON results.deliberations TO app_user;

CREATE TABLE results.decisions (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id           uuid NOT NULL,
  enrollment_id      uuid NOT NULL,
  scope              text NOT NULL CHECK (scope IN ('PERIOD', 'YEAR')),
  kind               text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]{1,40}$'),     -- ex. SEMESTER_STATUS, COUNCIL, YEAR_END
  source_result_id   uuid,                                      -- en-tête period_results dont la règle a proposé
  proposed_code      text,
  proposed_outcome   text,
  final_code         text,
  final_outcome      text,
  status             text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'CONFIRMED', 'PUBLISHED', 'WITHDRAWN')),
  deliberation_id    uuid,
  justification      text,
  decided_by         uuid,
  decided_by_name    text,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id),
  FOREIGN KEY (tenant_id, deliberation_id) REFERENCES results.deliberations (tenant_id, id),
  CHECK (status = 'PROPOSED' OR final_code IS NOT NULL),
  -- R-RES-05 : une décision confirmée différente de la proposition exige une justification ; les deux sont conservées
  CHECK (final_code IS NULL OR final_code = proposed_code OR length(btrim(coalesce(justification, ''))) >= 20)
);
CREATE UNIQUE INDEX decisions_active_uq ON results.decisions (tenant_id, state_id, enrollment_id, kind) WHERE status <> 'WITHDRAWN';
SELECT kernel.enable_tenant_rls('results.decisions');
GRANT SELECT, INSERT, UPDATE ON results.decisions TO app_user;

CREATE TABLE results.appreciations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id           uuid NOT NULL,
  enrollment_id      uuid NOT NULL,
  curriculum_node_id uuid,                                       -- NULL = appréciation générale (conseil)
  author_staff_id    uuid NOT NULL,
  author_role        text NOT NULL CHECK (author_role IN ('TEACHER', 'COUNCIL', 'DIRECTOR')),
  body               text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id)
);
CREATE UNIQUE INDEX appreciations_uq ON results.appreciations
  (tenant_id, state_id, enrollment_id, author_role, coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid));
SELECT kernel.enable_tenant_rls('results.appreciations');
GRANT SELECT, INSERT, UPDATE ON results.appreciations TO app_user;      -- figées après clôture (déclencheur)

-- File de recalcul : une demande PENDING par classe × période (coalescence), temporisation `not_before`.
CREATE TABLE results.recompute_requests (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  scope_enrollments  uuid[],                      -- NULL = toute la classe
  causes             jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{ event, id, at }] plafonné à 50
  not_before         timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'BLOCKED', 'FAILED')),
  blocked_reason     text,
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX recompute_pending_uq ON results.recompute_requests (tenant_id, classroom_id, academic_period_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX recompute_running_uq ON results.recompute_requests (tenant_id, classroom_id, academic_period_id) WHERE status = 'RUNNING';
CREATE INDEX recompute_due_idx ON results.recompute_requests (not_before) WHERE status = 'PENDING';
SELECT kernel.enable_tenant_rls('results.recompute_requests');
GRANT SELECT, INSERT, UPDATE, DELETE ON results.recompute_requests TO app_user;      -- purge des DONE > 30 j
