-- =============================================================================
-- 1103 — Module assess : révisions de notes publiées (GradeRevision)
-- =============================================================================
--
-- Toute correction d'une note publiée passe par une révision : ancienne et nouvelle valeur (l'ancienne est RELUE
-- en base à l'insertion par le déclencheur : impossible de mentir), motif obligatoire, demandeur, approbateur,
-- dates. Append-only sauf progression de statut (REQUESTED -> APPROVED|REJECTED, APPROVED -> APPLIED).

CREATE TABLE assess.grade_revisions (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  assessment_id      uuid NOT NULL,
  grade_id           uuid,                                  -- NULL pour kind = ADDITION avant application
  enrollment_id      uuid NOT NULL,
  student_id         uuid,                                  -- relu en base (CORRECTION|REMOVAL) ou fourni (ADDITION)
  kind               text NOT NULL CHECK (kind IN ('CORRECTION', 'ADDITION', 'REMOVAL')),
  old_score          numeric(8,3),
  old_entry_status   text,
  new_score          numeric(8,3),
  new_entry_status   text,
  reason             text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by       uuid NOT NULL,
  requested_by_name  text NOT NULL,                         -- identité figée
  requested_at       timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'APPLIED')),
  decided_by         uuid,
  decided_by_name    text,
  decided_at         timestamptz,
  decision_comment   text,
  four_eyes_waived   boolean NOT NULL DEFAULT false,
  applied_at         timestamptz,
  batch_id           uuid,                                  -- annulation d'évaluation : lot de REMOVAL
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES assess.assessments (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_id)      REFERENCES assess.grades (tenant_id, id),
  CHECK (new_entry_status IS NULL OR new_entry_status IN ('ENTERED', 'ABSENT_EXCUSED', 'ABSENT_UNEXCUSED', 'EXEMPT', 'NOT_GRADED')),
  CHECK ((new_entry_status = 'ENTERED') = (new_score IS NOT NULL) OR new_entry_status IS NULL),
  CHECK (kind <> 'CORRECTION' OR (grade_id IS NOT NULL AND new_entry_status IS NOT NULL)),
  CHECK (kind <> 'ADDITION'   OR (old_score IS NULL AND new_entry_status IS NOT NULL AND student_id IS NOT NULL)),
  CHECK (kind <> 'REMOVAL'    OR (grade_id IS NOT NULL AND new_entry_status = 'NOT_GRADED' AND new_score IS NULL)),
  CHECK (status NOT IN ('APPROVED', 'REJECTED', 'APPLIED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'APPLIED' OR applied_at IS NOT NULL),
  CHECK (decided_by IS NULL OR four_eyes_waived OR decided_by <> requested_by)
);
CREATE INDEX grade_revisions_assessment_idx ON assess.grade_revisions (tenant_id, assessment_id, status);
CREATE INDEX grade_revisions_grade_idx      ON assess.grade_revisions (tenant_id, grade_id);
CREATE INDEX grade_revisions_batch_idx      ON assess.grade_revisions (tenant_id, batch_id) WHERE batch_id IS NOT NULL;
-- une seule demande en cours par note (évite deux corrections concurrentes de la même note)
CREATE UNIQUE INDEX grade_revisions_open_uq ON assess.grade_revisions (tenant_id, grade_id) WHERE status IN ('REQUESTED', 'APPROVED') AND grade_id IS NOT NULL;
CREATE UNIQUE INDEX grade_revisions_open_addition_uq ON assess.grade_revisions (tenant_id, assessment_id, enrollment_id)
  WHERE status IN ('REQUESTED', 'APPROVED') AND kind = 'ADDITION';
SELECT kernel.enable_tenant_rls('assess.grade_revisions');
GRANT SELECT, INSERT, UPDATE ON assess.grade_revisions TO app_user;       -- jamais DELETE
