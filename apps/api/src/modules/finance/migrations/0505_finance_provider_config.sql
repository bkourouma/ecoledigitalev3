-- =============================================================================
-- 0505 — Module finance : configuration des fournisseurs de paiement par tenant
--        (spec 015-payments)
-- =============================================================================
--
-- Une ligne par (tenant, fournisseur). Les réglages NON secrets (identifiant de site, canaux…) sont en clair ;
-- les secrets (clés d'API, secrets de webhook) sont des ENVELOPPES AES-256-GCM produites par l'application
-- (`SecretStorePort`) : la base ne reçoit jamais un secret en clair — la contrainte ci-dessous REFUSE toute valeur
-- qui n'a pas la forme d'une enveloppe, même écrite par un script ou un superutilisateur.
-- Aucun DELETE : on efface les secrets et on désactive ; l'historique est dans l'audit.
-- =============================================================================

CREATE FUNCTION finance.secrets_are_sealed(secrets jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(secrets) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(secrets) e
        WHERE jsonb_typeof(e.value) <> 'string'
           OR (e.value #>> '{}') !~ '^v1\.[A-Za-z0-9]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$'
     )
$$;

CREATE TABLE finance.provider_configs (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  provider       text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  enabled        boolean NOT NULL DEFAULT false,
  mode           text NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox', 'production')),
  -- réglages non secrets : objet de chaînes
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  -- champ -> enveloppe chiffrée ; jamais de clair
  secrets        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (finance.secrets_are_sealed(secrets)),
  last_test_at   timestamptz,
  last_test_ok   boolean,
  last_test_code text CHECK (last_test_code IS NULL OR last_test_code ~ '^[a-z_]{1,40}$'),
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider),
  UNIQUE (tenant_id, id),
  CHECK ((last_test_at IS NULL) = (last_test_ok IS NULL))
);
SELECT kernel.enable_tenant_rls('finance.provider_configs');
GRANT SELECT, INSERT, UPDATE ON finance.provider_configs TO app_user;
