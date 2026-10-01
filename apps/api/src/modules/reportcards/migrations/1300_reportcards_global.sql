-- =============================================================================
-- 1300 — Module reportcards : schéma et tables GLOBALES (liste blanche d'isolation)
-- =============================================================================
--
-- Plage de numéros réservée au module reportcards : 1300–1399 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md).
--
-- Quatre tables sans isolation « tenant » classique, justifiées dans
-- `isolation-allowlist.reportcards.ts` :
--
--   platform_templates  gabarits fournis par la PLATEFORME (versionnés, immuables une fois publiés) ;
--                       lecture ouverte, écriture réservée à l'acteur `system` (patron rbac.permissions / rules.national_*) ;
--   signing_keys        clés PUBLIQUES de signature Ed25519 (la clé privée n'est JAMAIS en base) ;
--                       lecture ouverte, écriture `system` ;
--   verification_index  code de vérification -> (tenant, document), SANS donnée personnelle : nécessaire à une vérification
--                       non authentifiée dont le tenant n'est pas connu (le QR ne porte que le code) ;
--   file_hash_index     SHA-256 d'un PDF émis -> code, pour reconnaître un fichier téléversé (même raison).
--
-- verification_index et file_hash_index PORTENT un `tenant_id` et une RLS FORCÉE :
--   - lecture : l'acteur `system` (SystemDb, raison « public-verification ») OU le tenant propriétaire ;
--   - écriture : uniquement pour le tenant courant (WITH CHECK tenant_id = kernel.current_tenant_id()) — un tenant ne peut
--     pas inscrire un code au nom d'un autre ; pas d'UPDATE ni de DELETE (ni droit, ni policy).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS reportcards;
REVOKE ALL ON SCHEMA reportcards FROM PUBLIC;
GRANT USAGE ON SCHEMA reportcards TO app_user;

-- -----------------------------------------------------------------------------
-- Gabarits plateforme
-- -----------------------------------------------------------------------------
CREATE TABLE reportcards.platform_templates (
  key              text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]*$' AND length(key) <= 60),
  version          integer NOT NULL CHECK (version >= 1),
  document_kind    text NOT NULL CHECK (document_kind IN ('REPORT_CARD', 'TRANSCRIPT', 'DIPLOMA', 'ATTESTATION_SUCCESS', 'ATTESTATION_AUTHENTICITY', 'PAYSLIP')),
  pack             text NOT NULL CHECK (pack IN ('PRIMARY', 'SECONDARY', 'HIGHER', 'VIRTUAL', 'CORE')),
  snapshot_schema  text NOT NULL,
  title            text NOT NULL CHECK (length(btrim(title)) > 0),
  body             text NOT NULL,
  css              text NOT NULL DEFAULT '',
  options_schema   jsonb NOT NULL,
  signature_slots  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  content_hash     text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, version),
  CHECK (status = 'DRAFT' OR content_hash IS NOT NULL)
);

ALTER TABLE reportcards.platform_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE reportcards.platform_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY pt_read ON reportcards.platform_templates FOR SELECT USING (true);
CREATE POLICY pt_insert ON reportcards.platform_templates FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY pt_update ON reportcards.platform_templates FOR UPDATE
  USING (kernel.current_actor() = 'system') WITH CHECK (kernel.current_actor() = 'system');
GRANT SELECT, INSERT, UPDATE ON reportcards.platform_templates TO app_user;

-- -----------------------------------------------------------------------------
-- Clés publiques de signature
-- -----------------------------------------------------------------------------
CREATE TABLE reportcards.signing_keys (
  key_id       text PRIMARY KEY CHECK (key_id ~ '^[a-z0-9-]{6,40}$'),
  algorithm    text NOT NULL DEFAULT 'Ed25519' CHECK (algorithm = 'Ed25519'),
  public_key   text NOT NULL CHECK (length(public_key) BETWEEN 40 AND 200),
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  retired_at   timestamptz,
  CHECK (status <> 'RETIRED' OR retired_at IS NOT NULL)
);

ALTER TABLE reportcards.signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE reportcards.signing_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY sk_read ON reportcards.signing_keys FOR SELECT USING (true);
CREATE POLICY sk_insert ON reportcards.signing_keys FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY sk_update ON reportcards.signing_keys FOR UPDATE
  USING (kernel.current_actor() = 'system') WITH CHECK (kernel.current_actor() = 'system');
GRANT SELECT, INSERT, UPDATE ON reportcards.signing_keys TO app_user;

-- -----------------------------------------------------------------------------
-- Index de vérification (aucune donnée personnelle)
-- -----------------------------------------------------------------------------
CREATE TABLE reportcards.verification_index (
  code           text PRIMARY KEY CHECK (code ~ '^[A-Z2-7]{26}$'),
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  document_kind  text NOT NULL CHECK (document_kind IN ('REPORT_CARD', 'TRANSCRIPT', 'DIPLOMA', 'ATTESTATION_SUCCESS', 'ATTESTATION_AUTHENTICITY', 'PAYSLIP')),
  document_id    uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_kind, document_id)
);
CREATE INDEX verification_index_tenant_idx ON reportcards.verification_index (tenant_id, document_kind, document_id);

ALTER TABLE reportcards.verification_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE reportcards.verification_index FORCE ROW LEVEL SECURITY;
CREATE POLICY vi_read ON reportcards.verification_index FOR SELECT
  USING (kernel.current_actor() = 'system' OR tenant_id = kernel.current_tenant_id());
CREATE POLICY vi_insert ON reportcards.verification_index FOR INSERT
  WITH CHECK (tenant_id = kernel.current_tenant_id());
GRANT SELECT, INSERT ON reportcards.verification_index TO app_user;

-- -----------------------------------------------------------------------------
-- Index des empreintes de fichiers PDF émis (comparaison d'un fichier téléversé)
-- -----------------------------------------------------------------------------
CREATE TABLE reportcards.file_hash_index (
  pdf_hash    text PRIMARY KEY CHECK (pdf_hash ~ '^[0-9a-f]{64}$'),
  code        text NOT NULL REFERENCES reportcards.verification_index (code),
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_hash_index_tenant_idx ON reportcards.file_hash_index (tenant_id);

ALTER TABLE reportcards.file_hash_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE reportcards.file_hash_index FORCE ROW LEVEL SECURITY;
CREATE POLICY fhi_read ON reportcards.file_hash_index FOR SELECT
  USING (kernel.current_actor() = 'system' OR tenant_id = kernel.current_tenant_id());
CREATE POLICY fhi_insert ON reportcards.file_hash_index FOR INSERT
  WITH CHECK (tenant_id = kernel.current_tenant_id());
GRANT SELECT, INSERT ON reportcards.file_hash_index TO app_user;
