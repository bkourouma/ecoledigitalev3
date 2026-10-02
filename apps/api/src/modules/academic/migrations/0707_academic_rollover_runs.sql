-- =============================================================================
-- 0707 — Module academic : exécutions de la reconduction annuelle (assistant `/v2/academic/rollover`)
-- =============================================================================
--
-- La reconduction (calendrier, curriculum, classes, offres, réinscriptions) s'exécute en TÂCHE DE FOND dans le worker
-- (événement `academic.rollover.requested`). Cette table porte l'état de l'exécution : statut, progression par étape,
-- rapport final. Elle ne contient aucune donnée personnelle (identifiants et compteurs).
--
--   status  PENDING (en attente du worker) -> RUNNING -> COMPLETED | FAILED ; un échec se REPREND (nouvelle exécution
--           idempotente : les étapes ne recréent jamais ce qui existe).
--   Une seule exécution vivante (PENDING | RUNNING) par couple (année source, année cible).
-- =============================================================================

CREATE TABLE academic.rollover_runs (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id        uuid NOT NULL,                              -- tenancy.institutions.id (sans FK)
  from_academic_year_id uuid NOT NULL,
  to_academic_year_id   uuid NOT NULL,
  status                text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  options               jsonb NOT NULL,                             -- corps validé de la demande (étapes retenues, classes visées)
  requested_by          uuid,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  attempts              integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  progress              jsonb NOT NULL DEFAULT '{}'::jsonb,         -- { stage, steps: [{ key, status, done, total, message? }] }
  report                jsonb,                                      -- rapport final (compteurs par étape, avertissements, anomalies)
  error_message         text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (from_academic_year_id <> to_academic_year_id),
  CHECK (status NOT IN ('COMPLETED', 'FAILED') OR finished_at IS NOT NULL),
  FOREIGN KEY (tenant_id, from_academic_year_id) REFERENCES academic.academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, to_academic_year_id) REFERENCES academic.academic_years (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.rollover_runs');
CREATE UNIQUE INDEX rollover_runs_one_live ON academic.rollover_runs (tenant_id, from_academic_year_id, to_academic_year_id) WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX rollover_runs_by_year ON academic.rollover_runs (tenant_id, from_academic_year_id, requested_at DESC);
GRANT SELECT, INSERT, UPDATE ON academic.rollover_runs TO app_user;
