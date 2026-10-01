-- =============================================================================
-- 1302 — Module reportcards : snapshots immuables, rendus, lots, journaux
-- =============================================================================
--
-- `report_cards` : INSTANTANÉ immuable d'un document (valeurs calculées par le module results, identifiant de version de
-- règle, hash, signature Ed25519, trace d'explicabilité). Les gardes (1303) imposent l'immuabilité même à un superutilisateur
-- (un déclencheur s'exécute pour tout rôle) et recalculent le hash en SQL.
-- Références vers le cœur (élève, inscription, classe, année, période) : UUID SANS clé étrangère.
-- =============================================================================

CREATE TABLE reportcards.report_cards (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  document_kind       text NOT NULL CHECK (document_kind IN ('REPORT_CARD', 'TRANSCRIPT')),
  enrollment_id       uuid,
  student_id          uuid NOT NULL,
  classroom_id        uuid,
  academic_year_id    uuid,
  academic_period_id  uuid,
  scope               text NOT NULL CHECK (scope IN ('PERIOD', 'YEAR', 'CUMULATIVE')),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status              text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'PUBLISHED', 'SUPERSEDED', 'REVOKED')),
  provisional         boolean NOT NULL DEFAULT false,
  -- contenu figé
  snapshot_schema     text NOT NULL,
  snapshot            jsonb NOT NULL,
  explain             jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_hash       text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  -- provenance des règles et des résultats
  rule_set_code       text NOT NULL,
  rule_version_id     uuid NOT NULL,
  rule_version_no     integer NOT NULL,
  definition_hash     text NOT NULL,
  results_state_id    uuid NOT NULL,
  results_version     integer NOT NULL,
  closure_hash        text NOT NULL,
  template_key        text NOT NULL,
  template_version    integer NOT NULL,
  config_version      integer NOT NULL,
  -- authenticité
  verification_code   text NOT NULL UNIQUE CHECK (verification_code ~ '^[A-Z2-7]{26}$'),
  signing_key_id      text NOT NULL REFERENCES reportcards.signing_keys (key_id),
  signature           text NOT NULL,
  issued_at           timestamptz NOT NULL,
  issued_by           uuid,
  issued_by_name      text NOT NULL,
  -- cycle de vie
  supersedes_id       uuid,
  supersede_reason    text,
  superseded_at       timestamptz,
  superseded_by_id    uuid,
  revoked_at          timestamptz,
  revoked_by          uuid,
  revoked_by_name     text,
  revoke_reason       text,
  published_at        timestamptz,
  published_by        uuid,
  withdrawn_at        timestamptz,
  -- rendu courant (champs mutables autorisés)
  render_status       text NOT NULL DEFAULT 'PENDING' CHECK (render_status IN ('PENDING', 'RENDERING', 'RENDERED', 'FAILED')),
  current_render_id   uuid,
  batch_id            uuid,
  UNIQUE (tenant_id, id),
  CHECK ((scope = 'PERIOD') = (academic_period_id IS NOT NULL)),
  CHECK ((scope = 'CUMULATIVE') = (enrollment_id IS NULL)),
  CHECK (status <> 'SUPERSEDED' OR (superseded_at IS NOT NULL AND superseded_by_id IS NOT NULL)),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)),
  CHECK (version = 1 OR (supersedes_id IS NOT NULL AND supersede_reason IS NOT NULL)),
  CHECK (NOT provisional OR status IN ('ISSUED', 'REVOKED')),
  CHECK (NOT provisional OR published_at IS NULL)
);
-- R-RC-09 : le même contenu ne peut être émis deux fois
CREATE UNIQUE INDEX report_cards_hash_uq ON reportcards.report_cards (tenant_id, snapshot_hash);
-- R-RC-03 : une seule version « vivante » (ni remplacée ni révoquée) par clé fonctionnelle
CREATE UNIQUE INDEX report_cards_live_uq ON reportcards.report_cards
  (tenant_id, document_kind, coalesce(enrollment_id, '00000000-0000-0000-0000-000000000000'::uuid),
   student_id, coalesce(academic_period_id, '00000000-0000-0000-0000-000000000000'::uuid), scope)
  WHERE status IN ('ISSUED', 'PUBLISHED') AND NOT provisional;
CREATE UNIQUE INDEX report_cards_version_uq ON reportcards.report_cards
  (tenant_id, document_kind, coalesce(enrollment_id, '00000000-0000-0000-0000-000000000000'::uuid),
   student_id, coalesce(academic_period_id, '00000000-0000-0000-0000-000000000000'::uuid), scope, version)
  WHERE NOT provisional;
CREATE INDEX report_cards_class_idx ON reportcards.report_cards (tenant_id, classroom_id, academic_period_id, status);
CREATE INDEX report_cards_student_idx ON reportcards.report_cards (tenant_id, student_id, status);
CREATE INDEX report_cards_state_idx ON reportcards.report_cards (tenant_id, results_state_id, results_version);
CREATE INDEX report_cards_batch_idx ON reportcards.report_cards (tenant_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX report_cards_render_idx ON reportcards.report_cards (tenant_id, render_status, issued_at) WHERE render_status IN ('PENDING', 'RENDERING', 'FAILED');
SELECT kernel.enable_tenant_rls('reportcards.report_cards');
GRANT SELECT, INSERT, UPDATE ON reportcards.report_cards TO app_user;

CREATE TABLE reportcards.renders (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  report_card_id    uuid NOT NULL,
  status            text NOT NULL CHECK (status IN ('PENDING', 'RENDERING', 'RENDERED', 'FAILED')),
  object_key        text,
  pdf_hash          text CHECK (pdf_hash IS NULL OR pdf_hash ~ '^[0-9a-f]{64}$'),
  size_bytes        bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  pages             smallint,
  renderer_version  text,
  duration_ms       integer,
  attempts          smallint NOT NULL DEFAULT 0,
  error             text,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, report_card_id) REFERENCES reportcards.report_cards (tenant_id, id),
  CHECK (status <> 'RENDERED' OR (object_key IS NOT NULL AND pdf_hash IS NOT NULL AND size_bytes IS NOT NULL))
);
CREATE INDEX renders_card_idx ON reportcards.renders (tenant_id, report_card_id, requested_at DESC);
SELECT kernel.enable_tenant_rls('reportcards.renders');
GRANT SELECT, INSERT, UPDATE ON reportcards.renders TO app_user;

-- -----------------------------------------------------------------------------
-- Lots de génération
-- -----------------------------------------------------------------------------
CREATE TABLE reportcards.batches (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  document_kind       text NOT NULL CHECK (document_kind IN ('REPORT_CARD', 'TRANSCRIPT')),
  classroom_id        uuid NOT NULL,
  academic_period_id  uuid,
  results_state_id    uuid NOT NULL,
  results_version     integer NOT NULL,
  idempotency_key     text NOT NULL,
  provisional         boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SNAPSHOTTING', 'RENDERING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED')),
  total               integer NOT NULL DEFAULT 0,
  issued              integer NOT NULL DEFAULT 0,
  excluded            integer NOT NULL DEFAULT 0,
  failed              integer NOT NULL DEFAULT 0,
  rendered            integer NOT NULL DEFAULT 0,
  combined_pdf_key    text,
  requested_by        uuid,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);
SELECT kernel.enable_tenant_rls('reportcards.batches');
GRANT SELECT, INSERT, UPDATE ON reportcards.batches TO app_user;

CREATE TABLE reportcards.batch_items (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  batch_id        uuid NOT NULL,
  enrollment_id   uuid NOT NULL,
  report_card_id  uuid,
  outcome         text NOT NULL CHECK (outcome IN ('ISSUED', 'EXCLUDED', 'FAILED')),
  reason_code     text,
  message         text,
  UNIQUE (tenant_id, id),
  UNIQUE (batch_id, enrollment_id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES reportcards.batches (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('reportcards.batch_items');
GRANT SELECT, INSERT, UPDATE ON reportcards.batch_items TO app_user;

-- -----------------------------------------------------------------------------
-- Journaux (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE reportcards.verification_events (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  report_card_id  uuid,
  document_kind   text NOT NULL,
  result          text NOT NULL CHECK (result IN ('AUTHENTIC', 'SUPERSEDED', 'REVOKED', 'INVALID', 'FILE_MATCH', 'FILE_MISMATCH')),
  ip_prefix       text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_events_idx ON reportcards.verification_events (tenant_id, occurred_at DESC);
SELECT kernel.enable_tenant_rls('reportcards.verification_events');
GRANT SELECT, INSERT, DELETE ON reportcards.verification_events TO app_user;   -- DELETE : purge de rétention seulement (garde 1303)

CREATE TABLE reportcards.access_log (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  report_card_id  uuid NOT NULL,
  user_id         uuid NOT NULL,
  actor_kind      text NOT NULL CHECK (actor_kind IN ('STUDENT', 'GUARDIAN')),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, report_card_id) REFERENCES reportcards.report_cards (tenant_id, id)
);
CREATE INDEX access_log_card_idx ON reportcards.access_log (tenant_id, report_card_id, occurred_at DESC);
SELECT kernel.enable_tenant_rls('reportcards.access_log');
GRANT SELECT, INSERT ON reportcards.access_log TO app_user;
