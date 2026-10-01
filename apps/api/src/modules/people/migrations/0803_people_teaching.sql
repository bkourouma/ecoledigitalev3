-- =============================================================================
-- 0803 — Module people (spec 009) : affectations d'enseignement
-- =============================================================================
--
-- Une affectation dit QUI est responsable de QUOI : (membre du personnel) x (classe) x (nœud de
-- curriculum) x (période éventuelle). Elle unifie `teacher_assignments` (classique),
-- `professional_session_ecue_teachers` (un titulaire par ECUE et par cohorte) et le « titulaire
-- de classe » (instituteur du primaire, professeur principal).
--
-- ATTENTION — l'affectation n'est PAS le bénéficiaire de la paie. La paie lit l'intervenant
-- réel d'une séance (`scheduling.occurrence_staff`, remplaçant compris), jamais le titulaire
-- (leçon du legacy, professional-seance-validation.service.ts:66-88).
--
-- Références (UUID, vérifiées par l'API publique de academic, sans clé étrangère) :
--   academic_year_id -> academic.academic_years.id      classroom_id -> academic.classrooms.id
--   curriculum_node_id -> academic.curriculum_nodes.id  period_id -> academic.academic_periods.id
-- =============================================================================

CREATE TABLE people.teaching_assignments (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id            uuid NOT NULL,
  academic_year_id    uuid NOT NULL,
  classroom_id        uuid NOT NULL,
  curriculum_node_id  uuid,
  period_id           uuid,
  role_code           text NOT NULL CHECK (role_code IN ('LEAD', 'CO_TEACHER', 'HOMEROOM', 'SUBSTITUTE', 'SUPERVISOR')),
  replaces_assignment_id uuid,                         -- SUBSTITUTE : l'affectation remplacée (congé de longue durée)
  covers_all_subjects boolean NOT NULL DEFAULT false,
  planned_hours       numeric(7, 2) CHECK (planned_hours IS NULL OR planned_hours >= 0),
  starts_on           date NOT NULL,
  ends_on             date,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'CANCELLED')),
  source              text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORT', 'TIMETABLE', 'ROLLOVER')),
  note                text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  -- Un titulaire de classe couvre la classe (ou tout son programme au primaire) : pas de nœud précis.
  CHECK (role_code <> 'HOMEROOM' OR curriculum_node_id IS NULL),
  -- Les autres rôles visent une matière ou, pour un généraliste, toutes les matières.
  CHECK (role_code = 'HOMEROOM' OR curriculum_node_id IS NOT NULL OR covers_all_subjects),
  CHECK (NOT covers_all_subjects OR curriculum_node_id IS NULL),
  -- Un remplaçant de longue durée désigne l'affectation qu'il remplace (la paie et l'historique
  -- savent qui couvre qui) ; seul un SUBSTITUTE peut porter ce lien.
  CHECK ((role_code = 'SUBSTITUTE') = (replaces_assignment_id IS NOT NULL)),
  CHECK (replaces_assignment_id IS NULL OR replaces_assignment_id <> id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id),
  FOREIGN KEY (tenant_id, replaces_assignment_id) REFERENCES people.teaching_assignments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.teaching_assignments');

-- Un seul responsable (LEAD) vivant par (classe, nœud, période) : « un enseignant par (cohorte,
-- ECUE) » du legacy, sans la limite du co-enseignement (CO_TEACHER est libre).
CREATE UNIQUE INDEX teaching_assignments_one_lead
  ON people.teaching_assignments (
    tenant_id, classroom_id,
    (coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(period_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE role_code = 'LEAD' AND status = 'ACTIVE';
-- Un seul titulaire de classe vivant par classe.
CREATE UNIQUE INDEX teaching_assignments_one_homeroom
  ON people.teaching_assignments (tenant_id, classroom_id) WHERE role_code = 'HOMEROOM' AND status = 'ACTIVE';
-- Pas de doublon strict d'une même personne sur le même objet et le même rôle.
CREATE UNIQUE INDEX teaching_assignments_no_dup
  ON people.teaching_assignments (
    tenant_id, staff_id, classroom_id, role_code,
    (coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(period_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE status = 'ACTIVE';
CREATE INDEX teaching_assignments_by_staff ON people.teaching_assignments (tenant_id, staff_id, academic_year_id, status);
CREATE INDEX teaching_assignments_by_classroom ON people.teaching_assignments (tenant_id, classroom_id, status);
CREATE INDEX teaching_assignments_by_node ON people.teaching_assignments (tenant_id, curriculum_node_id) WHERE curriculum_node_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON people.teaching_assignments TO app_user;

-- Journal des changements d'affectation (qui a affecté / retiré / remplacé qui). Append-only.
CREATE TABLE people.teaching_assignment_history (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  assignment_id  uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('CREATED', 'UPDATED', 'ENDED', 'CANCELLED', 'REPLACED')),
  from_value     jsonb,
  to_value       jsonb,
  reason         text,
  actor_id       uuid,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES people.teaching_assignments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.teaching_assignment_history');
CREATE INDEX teaching_assignment_history_by_assignment ON people.teaching_assignment_history (tenant_id, assignment_id, occurred_at);
GRANT SELECT, INSERT ON people.teaching_assignment_history TO app_user;
