-- =============================================================================
-- 0200 — Module rbac : catalogue de permissions, rôles par tenant, assignations
-- =============================================================================
--
-- Numérotation : les numéros de migration sont GLOBAUX à tous les modules
-- (runner à checksum, ADR-006). Le module rbac réserve la plage 0200-0299 ;
-- il ne dépend que de la baseline (0001-0003 : rôles, kernel, outbox).
--
-- Tables :
--   rbac.permissions                catalogue GLOBAL (reflet des manifestes), écrit
--                                   par la synchro (acteur `system`) uniquement ;
--   rbac.roles                      rôles PAR TENANT (système verrouillés ou personnalisés) ;
--   rbac.role_permissions           permissions concrètes d'un rôle ;
--   rbac.role_pending_permissions   motifs des modèles système sans correspondance
--                                   dans le catalogue (en attente, re-résolus à la synchro) ;
--   rbac.user_role_assignments      rôle d'un utilisateur sur un PÉRIMÈTRE
--                                   (tenant | institution | campus) avec validité.
--
-- Pas de clé étrangère vers un autre module (ADR-006) : user_id / identity_id /
-- scope_id sont des UUID de référence. Seules FK externes : kernel.tenants(id).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS rbac;

REVOKE ALL ON SCHEMA rbac FROM PUBLIC;
GRANT USAGE ON SCHEMA rbac TO app_user;

-- -----------------------------------------------------------------------------
-- Catalogue global. Hors RLS « tenant » (déclaré dans l'allowlist d'isolation) mais
-- protégé : lecture pour tous, écriture réservée à l'acteur `system` (synchro au
-- démarrage). Jamais de DELETE : une permission retirée des manifestes est
-- « retirée » (retired_at) pour que les rôles qui la portent ne perdent rien en
-- silence si un module est désactivé temporairement.
-- -----------------------------------------------------------------------------
CREATE TABLE rbac.permissions (
  key         text PRIMARY KEY
              CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  module_key  text NOT NULL CHECK (module_key ~ '^[a-z][a-z0-9_]*$'),
  label       text NOT NULL CHECK (length(btrim(label)) > 0),
  description text,
  sensitive   boolean NOT NULL DEFAULT false,
  retired_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rbac.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY permissions_read ON rbac.permissions
  FOR SELECT USING (true);
CREATE POLICY permissions_system_insert ON rbac.permissions
  FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY permissions_system_update ON rbac.permissions
  FOR UPDATE USING (kernel.current_actor() = 'system')
  WITH CHECK (kernel.current_actor() = 'system');

GRANT SELECT, INSERT, UPDATE ON rbac.permissions TO app_user;

-- -----------------------------------------------------------------------------
-- Rôles par tenant.
-- -----------------------------------------------------------------------------
CREATE TABLE rbac.roles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  key                 text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label               text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  description         text CHECK (description IS NULL OR length(description) <= 1000),
  -- Rôle système : instancié depuis un modèle (template_key), verrouillé.
  is_system           boolean NOT NULL DEFAULT false,
  template_key        text,
  cloned_from_role_id uuid,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_system_has_template CHECK (is_system = (template_key IS NOT NULL)),
  CONSTRAINT roles_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT roles_tenant_key_key UNIQUE (tenant_id, key)
);

-- Un seul rôle par modèle et par tenant : l'instanciation est idempotente.
CREATE UNIQUE INDEX roles_tenant_template_key
  ON rbac.roles (tenant_id, template_key)
  WHERE template_key IS NOT NULL;

SELECT kernel.enable_tenant_rls('rbac.roles');

-- Identité d'un rôle protégée ; un rôle système ne se supprime pas.
CREATE FUNCTION rbac.guard_role_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'rbac: le rôle système "%" ne peut pas être supprimé', OLD.key
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  -- La clé d'un rôle système est immuable ; celle d'un rôle personnalisé ne change que
  -- pour libérer une clé réservée par un nouveau modèle système (voir instantiate).
  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.is_system <> OLD.is_system
     OR NEW.template_key IS DISTINCT FROM OLD.template_key
     OR (OLD.is_system AND NEW.key <> OLD.key) THEN
    RAISE EXCEPTION 'rbac: tenant, nature (système/personnalisé), modèle et clé d''un rôle système sont immuables'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER roles_guard_identity
  BEFORE UPDATE OR DELETE ON rbac.roles
  FOR EACH ROW EXECUTE FUNCTION rbac.guard_role_identity();

GRANT SELECT, INSERT, UPDATE, DELETE ON rbac.roles TO app_user;

-- -----------------------------------------------------------------------------
-- Permissions d'un rôle. FK composite (tenant_id, role_id) : une ligne ne peut
-- JAMAIS référencer le rôle d'un autre tenant, même en connaissant son id.
-- -----------------------------------------------------------------------------
CREATE TABLE rbac.role_permissions (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  role_id        uuid NOT NULL,
  permission_key text NOT NULL REFERENCES rbac.permissions (key),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_id, permission_key),
  FOREIGN KEY (tenant_id, role_id) REFERENCES rbac.roles (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX role_permissions_permission_idx ON rbac.role_permissions (permission_key);

SELECT kernel.enable_tenant_rls('rbac.role_permissions');

GRANT SELECT, INSERT, DELETE ON rbac.role_permissions TO app_user;

-- -----------------------------------------------------------------------------
-- Motifs de modèles système sans correspondance dans le catalogue courant.
-- -----------------------------------------------------------------------------
CREATE TABLE rbac.role_pending_permissions (
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  role_id    uuid NOT NULL,
  pattern    text NOT NULL CHECK (length(pattern) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_id, pattern),
  FOREIGN KEY (tenant_id, role_id) REFERENCES rbac.roles (tenant_id, id) ON DELETE CASCADE
);

SELECT kernel.enable_tenant_rls('rbac.role_pending_permissions');

GRANT SELECT, INSERT, DELETE ON rbac.role_pending_permissions TO app_user;

-- -----------------------------------------------------------------------------
-- Assignations rôle -> utilisateur sur un périmètre, avec validité.
-- -----------------------------------------------------------------------------
CREATE TABLE rbac.user_role_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  -- Références par UUID, sans FK vers un autre module.
  user_id      uuid NOT NULL,
  identity_id  uuid,
  role_id      uuid NOT NULL,
  scope_type   text NOT NULL DEFAULT 'tenant'
               CHECK (scope_type IN ('tenant', 'institution', 'campus')),
  scope_id     uuid,
  valid_from   timestamptz,
  valid_until  timestamptz,
  granted_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignments_scope_shape CHECK (
    (scope_type = 'tenant' AND scope_id IS NULL)
    OR (scope_type <> 'tenant' AND scope_id IS NOT NULL)
  ),
  CONSTRAINT assignments_validity_order CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  ),
  -- RESTRICT : un rôle assigné ne se supprime pas (garde-fou en base).
  FOREIGN KEY (tenant_id, role_id) REFERENCES rbac.roles (tenant_id, id) ON DELETE RESTRICT
);

-- Une assignation par (utilisateur, rôle, périmètre) : on met à jour sa validité.
CREATE UNIQUE INDEX user_role_assignments_unique
  ON rbac.user_role_assignments (
    tenant_id, user_id, role_id, scope_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX user_role_assignments_user_idx ON rbac.user_role_assignments (tenant_id, user_id);
CREATE INDEX user_role_assignments_role_idx ON rbac.user_role_assignments (tenant_id, role_id);

SELECT kernel.enable_tenant_rls('rbac.user_role_assignments');

GRANT SELECT, INSERT, UPDATE, DELETE ON rbac.user_role_assignments TO app_user;
