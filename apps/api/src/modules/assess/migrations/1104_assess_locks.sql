-- =============================================================================
-- 1104 — Module assess : verrous de période (classe × période, par session) et reçus de lots idempotents
-- =============================================================================

CREATE TABLE assess.period_locks (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  locked_at          timestamptz NOT NULL DEFAULT now(),
  locked_by          uuid NOT NULL,
  lock_reason        text,
  -- sessions verrouillées : {1,2} = tout ; {1} = fenêtre de rattrapage ouverte (la session 2 redevient saisissable)
  locked_sessions    smallint[] NOT NULL DEFAULT '{1,2}' CHECK (locked_sessions <@ '{1,2}'::smallint[] AND cardinality(locked_sessions) >= 1),
  released_at        timestamptz,
  released_by        uuid,
  release_reason     text,
  UNIQUE (tenant_id, id),
  CHECK (released_at IS NULL OR release_reason IS NOT NULL)
);
-- un seul verrou actif par classe × période
CREATE UNIQUE INDEX period_locks_active_uq ON assess.period_locks (tenant_id, classroom_id, academic_period_id) WHERE released_at IS NULL;
CREATE INDEX period_locks_lookup_idx ON assess.period_locks (tenant_id, classroom_id, academic_period_id);
SELECT kernel.enable_tenant_rls('assess.period_locks');
GRANT SELECT, INSERT, UPDATE ON assess.period_locks TO app_user;

-- Reçus de saisie en lot : la même clé d'idempotence rejoue le résultat enregistré (pas de réécriture).
CREATE TABLE assess.batch_receipts (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  assessment_id    uuid NOT NULL,
  idempotency_key  text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  payload_hash     text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result           jsonb NOT NULL,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, assessment_id, idempotency_key),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES assess.assessments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('assess.batch_receipts');
GRANT SELECT, INSERT, DELETE ON assess.batch_receipts TO app_user;         -- purge des reçus anciens (job)
