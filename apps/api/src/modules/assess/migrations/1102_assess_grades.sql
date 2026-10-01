-- =============================================================================
-- 1102 — Module assess : notes
-- =============================================================================
--
-- Une note par inscription et par évaluation. Seul l'état d'entrée ENTERED porte un score : une absence, une
-- dispense, une note non saisie N'EST PAS un zéro (la règle de calcul décide). `status` reflète l'évaluation
-- (miroir tenu par déclencheur, voir 1106). Après publication, la note ne change QUE par une révision approuvée
-- appliquée par `assess.apply_revision` (l'application ET le déclencheur le garantissent, même pour un superuser).

CREATE TABLE assess.grades (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  assessment_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,                      -- academic.enrollments.id
  student_id    uuid NOT NULL,                      -- people.students.id (dénormalisé pour les lectures)
  score         numeric(8,3),
  entry_status  text NOT NULL DEFAULT 'ENTERED' CHECK (entry_status IN ('ENTERED', 'ABSENT_EXCUSED', 'ABSENT_UNEXCUSED', 'EXEMPT', 'NOT_GRADED')),
  comment       text CHECK (comment IS NULL OR length(comment) <= 500),
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'PUBLISHED', 'CANCELLED')),
  row_version   integer NOT NULL DEFAULT 1,
  entered_by    uuid,
  entered_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (assessment_id, enrollment_id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES assess.assessments (tenant_id, id),
  CHECK ((entry_status = 'ENTERED') = (score IS NOT NULL)),
  CHECK (score IS NULL OR score >= 0)
);
CREATE INDEX grades_assessment_idx ON assess.grades (tenant_id, assessment_id);
CREATE INDEX grades_enrollment_idx ON assess.grades (tenant_id, enrollment_id, status);
CREATE INDEX grades_student_idx    ON assess.grades (tenant_id, student_id, status);
SELECT kernel.enable_tenant_rls('assess.grades');
-- UPDATE / DELETE gardés par déclencheur (brouillon uniquement, ou révision approuvée désignée)
GRANT SELECT, INSERT, UPDATE, DELETE ON assess.grades TO app_user;
