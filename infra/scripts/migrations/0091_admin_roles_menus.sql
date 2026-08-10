-- 0091_admin_roles_menus.sql
-- Rôles administratifs personnalisés + permissions sur les menus du sidebar admin.
--
-- Contexte : la table `roles` est GLOBALE depuis 0055 (clé unique sans tenant,
-- `roles.key` immuable via trigger). On ne peut donc pas y créer des rôles
-- « métier » propres à un établissement sans risque de collision entre tenants.
-- Ces trois tables introduisent une couche de rôles applicatifs, scoppée au
-- tenant, qui ne remplace pas les rôles socle (admin/teacher/...) mais restreint
-- les menus du sidebar « Administration » visibles par l'utilisateur.
--
--   admin_roles        → un rôle personnalisé par établissement (« Comptable »…)
--   admin_role_menus   → les clés de menu autorisées pour ce rôle
--   user_admin_roles   → le rôle personnalisé d'un utilisateur (un seul)
--
-- Un utilisateur SANS ligne dans `user_admin_roles` conserve l'accès complet
-- (comportement historique). Les clés de menu (`menu_key`) sont définies côté
-- code dans `packages/contracts/src/admin-roles.schema.ts` : la base ne les
-- contraint pas, pour qu'un ajout de menu ne demande pas de migration.
--
-- Additif et idempotent (patron RLS 0061/0069/0087).

-- ===========================================================================
-- 1. Rôles administratifs personnalisés (scopés au tenant).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS admin_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unicité insensible à la casse et aux espaces : « Comptable » = « comptable ».
CREATE UNIQUE INDEX IF NOT EXISTS uniq_admin_roles_tenant_name
    ON admin_roles (tenant_id, LOWER(TRIM(name)));
CREATE INDEX IF NOT EXISTS idx_admin_roles_tenant
    ON admin_roles (tenant_id, is_active);

-- ===========================================================================
-- 2. Menus autorisés par rôle.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS admin_role_menus (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admin_role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    menu_key      VARCHAR(120) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (admin_role_id, menu_key)
);
CREATE INDEX IF NOT EXISTS idx_admin_role_menus_role
    ON admin_role_menus (admin_role_id);
CREATE INDEX IF NOT EXISTS idx_admin_role_menus_tenant
    ON admin_role_menus (tenant_id);

-- ===========================================================================
-- 3. Rôle administratif d'un utilisateur (au plus un, d'où la PK sur user_id).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS user_admin_roles (
    user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admin_role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_admin_roles_role
    ON user_admin_roles (admin_role_id);
CREATE INDEX IF NOT EXISTS idx_user_admin_roles_tenant
    ON user_admin_roles (tenant_id);

-- ===========================================================================
-- 4. Row-Level Security — isolation multi-tenant (patron 0061/0069/0087).
-- ===========================================================================
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY admin_roles_tenant_isolation
        ON admin_roles
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE admin_role_menus ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY admin_role_menus_tenant_isolation
        ON admin_role_menus
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE user_admin_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY user_admin_roles_tenant_isolation
        ON user_admin_roles
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fin de la migration 0091_admin_roles_menus.sql
