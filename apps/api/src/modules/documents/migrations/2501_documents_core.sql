-- =============================================================================
-- 2501 — Module documents : documents, versions, partages, historique, quarantaine
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Documents (descripteurs + tête de version dénormalisée pour les listes)
-- -----------------------------------------------------------------------------
CREATE TABLE documents.documents (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  kind                 text NOT NULL CHECK (kind IN ('STUDENT', 'TEACHER', 'INSTITUTION', 'ACADEMIC', 'FINANCIAL')),
  category_id          uuid NOT NULL,
  title                text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description          text CHECK (description IS NULL OR length(description) <= 2000),
  tags                 text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  -- Propriétaire : élève ou membre du personnel (UUID vérifiés par le port, sans FK) ; NONE = document d'établissement.
  owner_type           text NOT NULL DEFAULT 'NONE' CHECK (owner_type IN ('STUDENT', 'STAFF', 'NONE')),
  owner_id             uuid,
  visibility           text NOT NULL DEFAULT 'INHERIT' CHECK (visibility IN ('INHERIT', 'STAFF_ONLY', 'PRIVATE')),
  status               text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  -- Tête de version (dénormalisée : listes, recherche) ; FK composite DIFFÉRÉE vers versions (le document et sa version 1
  -- s'insèrent dans la même transaction).
  current_version_no   integer NOT NULL CHECK (current_version_no >= 1),
  version_count        integer NOT NULL DEFAULT 1 CHECK (version_count >= 1),
  current_file_name    text NOT NULL,
  current_extension    text NOT NULL,
  current_mime         text NOT NULL,
  current_size_bytes   bigint NOT NULL CHECK (current_size_bytes > 0),
  -- Expiration : échéance, seuils propres, seuils déjà émis POUR l'échéance courante, alerte « échu » émise.
  expires_on           date,
  alert_days           integer[] CHECK (alert_days IS NULL OR cardinality(alert_days) BETWEEN 1 AND 10),
  alerts_sent          integer[] NOT NULL DEFAULT '{}',
  expired_notified_at  timestamptz,
  -- Archivage (suppression logique) et rétention.
  archived_at          timestamptz,
  archived_by          uuid,
  archive_reason       text CHECK (archive_reason IS NULL OR length(archive_reason) <= 500),
  purge_after          timestamptz,
  purged_at            timestamptz,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  search_key           text NOT NULL DEFAULT '',
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES documents.categories (tenant_id, id),
  CHECK ((owner_type = 'NONE') = (owner_id IS NULL)),
  CHECK (kind <> 'STUDENT' OR owner_type = 'STUDENT'),
  CHECK (kind <> 'TEACHER' OR owner_type = 'STAFF'),
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('documents.documents');
CREATE INDEX documents_by_category ON documents.documents (tenant_id, category_id, status);
CREATE INDEX documents_by_owner ON documents.documents (tenant_id, owner_type, owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX documents_by_creator ON documents.documents (tenant_id, created_by);
CREATE INDEX documents_by_expiry ON documents.documents (tenant_id, expires_on) WHERE status = 'ACTIVE' AND expires_on IS NOT NULL;
CREATE INDEX documents_by_purge ON documents.documents (tenant_id, purge_after) WHERE purge_after IS NOT NULL AND purged_at IS NULL;
CREATE INDEX documents_listing ON documents.documents (tenant_id, kind, status, updated_at DESC, id DESC);
CREATE INDEX documents_search ON documents.documents USING gin (search_key public.gin_trgm_ops);
GRANT SELECT, INSERT, UPDATE ON documents.documents TO app_user;

-- -----------------------------------------------------------------------------
-- Versions IMMUABLES (le déclencheur de 2502 interdit toute modification du contenu et tout DELETE)
-- -----------------------------------------------------------------------------
CREATE TABLE documents.versions (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  document_id   uuid NOT NULL,
  version_no    integer NOT NULL CHECK (version_no >= 1),
  -- Une clé de stockage PAR version (jamais partagée) : la purge d'une version ne peut pas toucher l'objet d'une autre.
  storage_key   text NOT NULL,
  file_name     text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  extension     text NOT NULL,
  detected_mime text NOT NULL,                          -- type RÉEL (octets magiques), jamais le type déclaré
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status   text NOT NULL CHECK (scan_status IN ('CLEAN', 'UNSCANNED')),
  scan_engine   text,
  scanned_at    timestamptz,
  note          text CHECK (note IS NULL OR length(note) <= 500),
  uploaded_by   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  state         text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'PURGED')),
  purged_at     timestamptz,
  -- Rendition PDF dérivée d'un document Office (jetable, hors quota).
  rendition_key text,
  rendition_at  timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, document_id, version_no),
  UNIQUE (tenant_id, storage_key),
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents.documents (tenant_id, id),
  CHECK ((state = 'PURGED') = (purged_at IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('documents.versions');
CREATE INDEX versions_by_hash ON documents.versions (tenant_id, sha256);
CREATE INDEX versions_by_uploader ON documents.versions (tenant_id, uploaded_by);
GRANT SELECT, INSERT, UPDATE ON documents.versions TO app_user;

ALTER TABLE documents.documents
  ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (tenant_id, id, current_version_no) REFERENCES documents.versions (tenant_id, document_id, version_no)
  DEFERRABLE INITIALLY DEFERRED;

-- -----------------------------------------------------------------------------
-- Partages explicites (personne, niveau, durée) — retirés par marqueur, jamais effacés
-- -----------------------------------------------------------------------------
CREATE TABLE documents.shares (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  document_id  uuid NOT NULL,
  user_id      uuid NOT NULL,                     -- identité IAM (port)
  level        text NOT NULL CHECK (level IN ('READ', 'WRITE')),
  expires_at   timestamptz,
  note         text CHECK (note IS NULL OR length(note) <= 500),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  revoked_by   uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents.documents (tenant_id, id),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
SELECT kernel.enable_tenant_rls('documents.shares');
CREATE UNIQUE INDEX shares_one_active ON documents.shares (tenant_id, document_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX shares_by_user ON documents.shares (tenant_id, user_id) WHERE revoked_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON documents.shares TO app_user;

-- -----------------------------------------------------------------------------
-- Historique du document (append-only : lectures, téléchargements, partages, versions…)
-- -----------------------------------------------------------------------------
CREATE TABLE documents.document_events (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  document_id  uuid NOT NULL,
  version_no   integer,
  action       text NOT NULL CHECK (action IN (
    'CREATED', 'VERSION_ADDED', 'UPDATED', 'VIEWED', 'PREVIEWED', 'DOWNLOADED', 'SHARED', 'UNSHARED',
    'ARCHIVED', 'RESTORED', 'EXPIRY_ALERTED', 'EXPIRED', 'PURGED', 'INTEGRITY_FAILED')),
  actor_id     uuid,                              -- NULL = système (jobs)
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents.documents (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('documents.document_events');
CREATE INDEX document_events_by_document ON documents.document_events (tenant_id, document_id, occurred_at DESC, id DESC);
GRANT SELECT, INSERT ON documents.document_events TO app_user;

-- -----------------------------------------------------------------------------
-- Quarantaine : fichiers détectés infectés, jamais servis ; libérés ou détruits par décision motivée
-- -----------------------------------------------------------------------------
CREATE TABLE documents.quarantine (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  status               text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'RELEASED', 'DELETED')),
  storage_key          text NOT NULL,
  file_name            text NOT NULL,
  extension            text NOT NULL,
  detected_mime        text NOT NULL,
  size_bytes           bigint NOT NULL CHECK (size_bytes > 0),
  sha256               text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  signature            text NOT NULL,             -- nom du programme malveillant rapporté par le scanner
  engine               text NOT NULL,
  -- Ce que l'upload voulait faire : { mode: 'CREATE', fields: {...} } ou { mode: 'VERSION', documentId, fields: {...} }.
  intent               jsonb NOT NULL CHECK (jsonb_typeof(intent) = 'object'),
  uploaded_by          uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  decided_by           uuid,
  decided_at           timestamptz,
  decision_note        text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  released_document_id uuid,
  UNIQUE (tenant_id, id),
  CHECK ((status = 'HELD') = (decided_at IS NULL)),
  CHECK (status <> 'RELEASED' OR released_document_id IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('documents.quarantine');
CREATE INDEX quarantine_by_status ON documents.quarantine (tenant_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON documents.quarantine TO app_user;
