-- =============================================================================
-- 1404 — Module higher : rattrapage (session 2)
-- =============================================================================
-- Une fenêtre de rattrapage par (classe, période) tant qu'elle est ouverte. Les notes de session 2 suivent le circuit
-- ordinaire d'assess ; la note retenue (la session 2 REMPLACE la session 1, décision du 2026-10-01) est choisie par la
-- règle `note_examen_retenue` dans le module results : AUCUNE logique de note ici.

CREATE TABLE higher.resit_windows (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id        uuid NOT NULL,
  academic_period_id  uuid NOT NULL,
  results_state_id    uuid,                                  -- results.period_states.id (renseigné par le port results)
  opens_on            date NOT NULL,
  closes_on           date NOT NULL,
  node_ids            uuid[],                                -- NULL = toutes les ECUE éligibles
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  opened_by           uuid NOT NULL,
  opened_at           timestamptz NOT NULL,
  closed_by           uuid,
  closed_at           timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (closes_on >= opens_on),
  CHECK (status = 'OPEN' OR closed_at IS NOT NULL)
);
CREATE UNIQUE INDEX resit_windows_open_uq ON higher.resit_windows (tenant_id, classroom_id, academic_period_id) WHERE status = 'OPEN';
SELECT kernel.enable_tenant_rls('higher.resit_windows');
GRANT SELECT, INSERT, UPDATE ON higher.resit_windows TO app_user;

CREATE TABLE higher.resit_registrations (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  window_id           uuid NOT NULL,
  enrollment_id       uuid NOT NULL,
  student_id          uuid NOT NULL,
  academic_period_id  uuid NOT NULL,
  ecue_node_id        uuid NOT NULL,
  ue_node_id          uuid NOT NULL,
  session1_average    numeric,                               -- note retenue en session 1 (affichage, exacte)
  status              text NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED', 'PRESENT', 'ABSENT', 'WAIVED', 'GRADED')),
  outcome             text CHECK (outcome IS NULL OR outcome IN ('VALIDATED', 'NOT_VALIDATED')),
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (window_id, enrollment_id, ecue_node_id),
  FOREIGN KEY (tenant_id, window_id) REFERENCES higher.resit_windows (tenant_id, id)
);
-- Un étudiant n'est inscrit qu'UNE fois au rattrapage d'une même ECUE et d'une même période (AC3.6),
-- quelle que soit la fenêtre.
CREATE UNIQUE INDEX resit_registrations_once_uq ON higher.resit_registrations (tenant_id, enrollment_id, ecue_node_id, academic_period_id);
CREATE INDEX resit_registrations_student_idx ON higher.resit_registrations (tenant_id, student_id, status);
CREATE INDEX resit_registrations_window_idx ON higher.resit_registrations (tenant_id, window_id);
SELECT kernel.enable_tenant_rls('higher.resit_registrations');
GRANT SELECT, INSERT, UPDATE ON higher.resit_registrations TO app_user;
