-- =============================================================================
-- 0400 — Module iam : identités globales, accès par tenant, sessions, MFA
-- =============================================================================
--
-- Voir docs/adr/ADR-008-identite-et-sessions.md. Résumé du modèle :
--
--   GLOBALES (hors RLS, allowlist d'isolation + justification) :
--     iam.identities           une personne = une identité (e-mail unique global,
--                              hash du mot de passe, secret TOTP chiffré)
--     iam.identity_tenants     ANNUAIRE (identity_id, tenant_id) : « cette personne
--                              a un accès dans ce tenant ». Aucune autre colonne.
--                              Lecture seule pour l'application ; alimenté par un
--                              trigger SECURITY DEFINER depuis iam.memberships.
--     iam.mfa_recovery_codes   codes de secours (empreintes) d'une identité
--     iam.password_reset_tokens  jetons de réinitialisation / d'invitation (empreintes)
--
--   TENANT (RLS forcée par kernel.enable_tenant_rls) :
--     iam.memberships         identité ↔ tenant (statut, rôles) — AUTORITÉ de l'accès
--     iam.sessions            sessions (appareil, IP, révocation)
--     iam.refresh_tokens      jetons de rafraîchissement hachés, à rotation
--     iam.login_challenges    étapes MFA en cours (challenge / enrôlement)
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS iam;
REVOKE ALL ON SCHEMA iam FROM PUBLIC;
GRANT USAGE ON SCHEMA iam TO app_user;

-- -----------------------------------------------------------------------------
-- iam.identities  (GLOBALE)
-- -----------------------------------------------------------------------------
CREATE TABLE iam.identities (
  id                     uuid PRIMARY KEY,
  -- E-mail normalisé par l'application (NFKC, trim, minuscules).
  email                  text NOT NULL
                         CHECK (email = btrim(email) AND length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1),
  email_verified_at      timestamptz,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- scrypt ($scrypt$...) ou bcrypt legacy ($2a$...). NULL = pas encore de mot de passe (invitation).
  password_hash          text,
  password_changed_at    timestamptz,
  -- Compteur d'invalidation globale : toute session dont auth_epoch <> identities.auth_epoch est morte.
  -- Un seul UPDATE révoque instantanément les sessions de TOUS les tenants (changement de mot de passe, etc.).
  auth_epoch             integer NOT NULL DEFAULT 0 CHECK (auth_epoch >= 0),
  mfa_enabled            boolean NOT NULL DEFAULT false,
  -- Enveloppes AES-256-GCM (v1.<keyId>.<iv>.<ct>.<tag>), jamais le secret en clair.
  mfa_secret_enc         text,
  mfa_pending_secret_enc text,
  mfa_enrolled_at        timestamptz,
  -- Dernier pas TOTP accepté : refuse le rejeu d'un code déjà utilisé.
  mfa_last_step          bigint NOT NULL DEFAULT 0,
  last_tenant_id         uuid REFERENCES kernel.tenants (id),
  last_login_at          timestamptz,
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,
  CONSTRAINT identities_mfa_consistent CHECK (mfa_enabled = (mfa_secret_enc IS NOT NULL))
);
CREATE UNIQUE INDEX identities_email_key ON iam.identities (email);

-- Pas de DELETE : l'effacement (RGPD) passe par une procédure dédiée, pas par l'application courante.
GRANT SELECT, INSERT ON iam.identities TO app_user;
GRANT UPDATE (email_verified_at, status, password_hash, password_changed_at, auth_epoch, mfa_enabled,
              mfa_secret_enc, mfa_pending_secret_enc, mfa_enrolled_at, mfa_last_step,
              last_tenant_id, last_login_at, updated_at)
  ON iam.identities TO app_user;

-- -----------------------------------------------------------------------------
-- iam.identity_tenants  (GLOBALE — annuaire minimal, lecture seule pour l'application)
-- -----------------------------------------------------------------------------
CREATE TABLE iam.identity_tenants (
  identity_id uuid NOT NULL REFERENCES iam.identities (id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, tenant_id)
);
CREATE INDEX identity_tenants_tenant_idx ON iam.identity_tenants (tenant_id);
GRANT SELECT ON iam.identity_tenants TO app_user;

-- -----------------------------------------------------------------------------
-- iam.memberships  (TENANT, RLS)
-- -----------------------------------------------------------------------------
CREATE TABLE iam.memberships (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  identity_id uuid NOT NULL REFERENCES iam.identities (id),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  base_role   text NOT NULL CHECK (base_role ~ '^[a-z][a-z0-9_]{0,63}$'),
  roles       text[] NOT NULL CHECK (cardinality(roles) BETWEEN 1 AND 32),
  active_role text,
  invited_by  uuid,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  CONSTRAINT memberships_base_in_roles CHECK (base_role = ANY (roles)),
  CONSTRAINT memberships_active_in_roles CHECK (active_role IS NULL OR active_role = ANY (roles)),
  CONSTRAINT memberships_tenant_identity_key UNIQUE (tenant_id, identity_id)
);
CREATE INDEX memberships_identity_idx ON iam.memberships (identity_id);
SELECT kernel.enable_tenant_rls('iam.memberships');

-- identity_id et tenant_id sont immuables (pas de colonne dans le GRANT UPDATE).
GRANT SELECT, INSERT ON iam.memberships TO app_user;
GRANT UPDATE (status, base_role, roles, active_role, updated_at) ON iam.memberships TO app_user;

-- Annuaire alimenté par trigger : l'application ne l'écrit jamais directement.
CREATE FUNCTION iam.sync_identity_tenants() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO iam.identity_tenants (identity_id, tenant_id)
    VALUES (NEW.identity_id, NEW.tenant_id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM iam.identity_tenants WHERE identity_id = OLD.identity_id AND tenant_id = OLD.tenant_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION iam.sync_identity_tenants() FROM PUBLIC;

CREATE TRIGGER memberships_sync_directory
  AFTER INSERT OR DELETE ON iam.memberships
  FOR EACH ROW EXECUTE FUNCTION iam.sync_identity_tenants();

-- -----------------------------------------------------------------------------
-- iam.sessions  (TENANT, RLS)
-- -----------------------------------------------------------------------------
CREATE TABLE iam.sessions (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  identity_id   uuid NOT NULL REFERENCES iam.identities (id),
  membership_id uuid NOT NULL REFERENCES iam.memberships (id),
  kind          text NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'impersonation')),
  active_role   text NOT NULL,
  auth_epoch    integer NOT NULL CHECK (auth_epoch >= 0),
  mfa_verified  boolean NOT NULL DEFAULT false,
  amr           text[] NOT NULL DEFAULT '{}',
  ip            inet,
  last_ip       inet,
  user_agent    text CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  device_name   text CHECK (device_name IS NULL OR length(device_name) <= 80),
  -- Impersonation : acteur réel (super-admin, hors schéma iam) et motif obligatoires.
  actor_id      uuid,
  reason        text CHECK (reason IS NULL OR length(reason) <= 500),
  created_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR length(revoked_reason) <= 100),
  revoked_by    uuid,
  CONSTRAINT sessions_impersonation_has_actor CHECK (kind = 'user' OR (actor_id IS NOT NULL AND reason IS NOT NULL))
);
CREATE INDEX sessions_identity_active_idx ON iam.sessions (tenant_id, identity_id) WHERE revoked_at IS NULL;
SELECT kernel.enable_tenant_rls('iam.sessions');

GRANT SELECT, INSERT, DELETE ON iam.sessions TO app_user;
GRANT UPDATE (last_seen_at, last_ip, revoked_at, revoked_reason, revoked_by) ON iam.sessions TO app_user;

-- -----------------------------------------------------------------------------
-- iam.refresh_tokens  (TENANT, RLS) — un jeton par rotation, la session est la « famille »
-- -----------------------------------------------------------------------------
CREATE TABLE iam.refresh_tokens (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id  uuid NOT NULL REFERENCES iam.sessions (id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  -- Renseigné à l'usage : un jeton déjà utilisé qui revient = réutilisation = vol présumé.
  used_at     timestamptz,
  replaced_by uuid
);
CREATE UNIQUE INDEX refresh_tokens_hash_key ON iam.refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_session_idx ON iam.refresh_tokens (session_id);
SELECT kernel.enable_tenant_rls('iam.refresh_tokens');

GRANT SELECT, INSERT, DELETE ON iam.refresh_tokens TO app_user;
GRANT UPDATE (used_at, replaced_by) ON iam.refresh_tokens TO app_user;

-- -----------------------------------------------------------------------------
-- iam.login_challenges  (TENANT, RLS) — étapes MFA en cours
-- -----------------------------------------------------------------------------
CREATE TABLE iam.login_challenges (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  identity_id       uuid NOT NULL REFERENCES iam.identities (id),
  membership_id     uuid NOT NULL REFERENCES iam.memberships (id),
  purpose           text NOT NULL CHECK (purpose IN ('login', 'enroll')),
  active_role       text NOT NULL,
  -- Session à révoquer une fois la bascule de tenant (switch-tenant) validée (dans SON tenant).
  source_session_id uuid,
  source_tenant_id  uuid,
  ip                inet,
  user_agent        text CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  device_name       text CHECK (device_name IS NULL OR length(device_name) <= 80),
  attempts          integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts      integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  created_at        timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz
);
SELECT kernel.enable_tenant_rls('iam.login_challenges');

GRANT SELECT, INSERT, DELETE ON iam.login_challenges TO app_user;
GRANT UPDATE (attempts, consumed_at) ON iam.login_challenges TO app_user;

-- -----------------------------------------------------------------------------
-- iam.mfa_recovery_codes  (GLOBALE) — codes de secours à usage unique (empreintes HMAC)
-- -----------------------------------------------------------------------------
CREATE TABLE iam.mfa_recovery_codes (
  id          uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES iam.identities (id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  created_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CONSTRAINT mfa_recovery_codes_unique UNIQUE (identity_id, code_hash)
);
GRANT SELECT, INSERT, DELETE ON iam.mfa_recovery_codes TO app_user;
GRANT UPDATE (used_at) ON iam.mfa_recovery_codes TO app_user;

-- -----------------------------------------------------------------------------
-- iam.password_reset_tokens  (GLOBALE) — réinitialisation et invitation (empreintes HMAC)
-- -----------------------------------------------------------------------------
CREATE TABLE iam.password_reset_tokens (
  id           uuid PRIMARY KEY,
  identity_id  uuid NOT NULL REFERENCES iam.identities (id) ON DELETE CASCADE,
  purpose      text NOT NULL CHECK (purpose IN ('reset', 'invitation')),
  token_hash   text NOT NULL,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  requested_ip inet
);
CREATE UNIQUE INDEX password_reset_tokens_hash_key ON iam.password_reset_tokens (token_hash);
CREATE INDEX password_reset_tokens_identity_idx ON iam.password_reset_tokens (identity_id) WHERE used_at IS NULL;
GRANT SELECT, INSERT, DELETE ON iam.password_reset_tokens TO app_user;
GRANT UPDATE (used_at) ON iam.password_reset_tokens TO app_user;
