-- Migration 0055: unified multi-tenant model
-- - One reference tenant: ecoledigitale
-- - Global roles, tenant-scoped users, tenant_id on user_roles
-- - Separate super-admin authentication and audit tables
-- - ASPCI dedicated tables copied back into base tables, then removed
-- - Professional training simplified without sessions/formateurs
-- - RLS enabled on every tenantized table

BEGIN;
SET LOCAL session_replication_role = replica;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Tenant metadata and reference tenant
-- ---------------------------------------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_reference BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_by_super_admin_id UUID;

INSERT INTO tenants (slug, name, settings_json, is_active, is_reference, created_at, updated_at)
VALUES ('ecoledigitale', 'ecoledigitale', '{}'::jsonb, true, true, NOW(), NOW())
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  is_active = true,
  is_reference = true,
  updated_at = NOW();

UPDATE tenants SET is_reference = (slug = 'ecoledigitale');

-- ---------------------------------------------------------------------------
-- Super-admin global tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS super_admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  singleton_key VARCHAR(32) NOT NULL DEFAULT 'primary',
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL DEFAULT 'Super Administrateur',
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMP WITH TIME ZONE,
  last_bootstrapped_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT super_admin_users_singleton_key UNIQUE (singleton_key),
  CONSTRAINT super_admin_users_email_unique UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS super_admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  super_admin_id UUID NOT NULL REFERENCES super_admin_users(id) ON DELETE CASCADE,
  selected_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  selected_tenant_slug VARCHAR(50),
  impersonated_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(255) NOT NULL,
  method VARCHAR(16) NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_audit_logs_super_admin
  ON super_admin_audit_logs(super_admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_super_admin_audit_logs_tenant
  ON super_admin_audit_logs(selected_tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Roles become global. Keep tenant_id nullable temporarily for compatibility.
-- ---------------------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roles ALTER COLUMN tenant_id DROP NOT NULL;

UPDATE roles
SET key = LOWER(TRIM(key)),
    name = COALESCE(NULLIF(TRIM(name), ''), LOWER(TRIM(key))),
    updated_at = NOW()
WHERE key IS DISTINCT FROM LOWER(TRIM(key))
   OR name IS DISTINCT FROM COALESCE(NULLIF(TRIM(name), ''), LOWER(TRIM(key)));

ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE user_roles ur
SET tenant_id = u.tenant_id
FROM users u
WHERE ur.user_id = u.id
  AND ur.tenant_id IS NULL;

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'user_roles'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END $$;

CREATE TEMP TABLE tmp_role_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    r.id AS old_id,
    FIRST_VALUE(r.id) OVER (
      PARTITION BY LOWER(r.key)
      ORDER BY
        CASE WHEN t.slug = 'ecoledigitale' THEN 0 ELSE 1 END,
        (SELECT COUNT(*) FROM jsonb_each(jsonb_strip_nulls(to_jsonb(r)))) DESC,
        r.created_at ASC NULLS LAST,
        r.id ASC
    ) AS base_id
  FROM roles r
  LEFT JOIN tenants t ON t.id = r.tenant_id
  WHERE r.key IS NOT NULL
)
SELECT old_id, base_id FROM ranked;

UPDATE user_roles ur
SET role_id = m.base_id
FROM tmp_role_merge m
WHERE ur.role_id = m.old_id
  AND m.old_id <> m.base_id;

DELETE FROM user_roles ur
USING user_roles kept
WHERE ur.id <> kept.id
  AND ur.tenant_id = kept.tenant_id
  AND ur.user_id = kept.user_id
  AND ur.role_id = kept.role_id;

UPDATE roles kept
SET name = preferred.name,
    is_active = kept.is_active OR preferred.is_active,
    is_system = kept.is_system OR preferred.is_system,
    tenant_id = NULL,
    updated_at = NOW()
FROM roles preferred
JOIN tmp_role_merge m ON m.old_id = preferred.id
WHERE kept.id = m.base_id
  AND preferred.id <> kept.id
  AND preferred.name IS NOT NULL
  AND (
    kept.name IS NULL
    OR (SELECT COUNT(*) FROM jsonb_each(jsonb_strip_nulls(to_jsonb(preferred)))) >
       (SELECT COUNT(*) FROM jsonb_each(jsonb_strip_nulls(to_jsonb(kept))))
  );

DELETE FROM roles r
USING tmp_role_merge m
WHERE r.id = m.old_id
  AND m.old_id <> m.base_id;

INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
SELECT key, name, is_active, is_system, NOW(), NOW()
FROM (VALUES
  ('admin', 'Administrateur', true, true, NOW(), NOW()),
  ('owner', 'Propriétaire', true, true, NOW(), NOW()),
  ('teacher', 'Enseignant', true, true, NOW(), NOW()),
  ('student', 'Étudiant', true, true, NOW(), NOW()),
  ('parent', 'Parent', true, true, NOW(), NOW()),
  ('formateur', 'Formateur', true, true, NOW(), NOW())
) AS defaults(key, name, is_active, is_system, created_at, updated_at)
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.key = defaults.key
);

UPDATE roles SET tenant_id = NULL, updated_at = NOW();

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'roles'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE roles DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS roles_key_global_key ON roles(key);
CREATE INDEX IF NOT EXISTS idx_roles_is_active ON roles(is_active);

CREATE OR REPLACE FUNCTION prevent_role_key_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'roles.key is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_role_key_update_trigger ON roles;
CREATE TRIGGER prevent_role_key_update_trigger
  BEFORE UPDATE OF key ON roles
  FOR EACH ROW EXECUTE FUNCTION prevent_role_key_update();

-- ---------------------------------------------------------------------------
-- Users: tenant-scoped rows, globally unique normalized email
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS initial_password VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_updated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_technical_account BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_role_key VARCHAR(50);

UPDATE users
SET email = LOWER(TRIM(email)),
    first_name = COALESCE(first_name, NULLIF(SPLIT_PART(name, ' ', 1), '')),
    last_name = COALESCE(last_name, NULLIF(TRIM(SUBSTRING(name FROM POSITION(' ' IN name) + 1)), '')),
    role_updated_at = COALESCE(role_updated_at, NOW()),
    updated_at = NOW();

CREATE OR REPLACE FUNCTION pg_temp.repoint_references(target_table regclass, mapping_table text)
RETURNS void AS $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      ns.nspname AS child_schema,
      child.relname AS child_table,
      att.attname AS child_column
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    JOIN unnest(c.conkey) WITH ORDINALITY ck(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = child.oid AND att.attnum = ck.attnum
    WHERE c.contype = 'f'
      AND c.confrelid = target_table
      AND array_length(c.conkey, 1) = 1
      AND array_length(c.confkey, 1) = 1
  LOOP
    EXECUTE format(
      'UPDATE %I.%I AS child
       SET %I = merge_map.base_id
       FROM %s AS merge_map
       WHERE child.%I = merge_map.old_id
         AND merge_map.old_id <> merge_map.base_id',
      rec.child_schema,
      rec.child_table,
      rec.child_column,
      mapping_table,
      rec.child_column
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE TEMP TABLE tmp_user_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    u.id AS old_id,
    FIRST_VALUE(u.id) OVER (
      PARTITION BY LOWER(u.email)
      ORDER BY
        (SELECT COUNT(*) FROM jsonb_each(jsonb_strip_nulls(to_jsonb(u)))) DESC,
        u.created_at ASC NULLS LAST,
        u.id ASC
    ) AS base_id
  FROM users u
  WHERE u.email IS NOT NULL
)
SELECT old_id, base_id FROM ranked;

-- Keep roles from the selected base account only.
DELETE FROM user_roles ur
USING tmp_user_merge m
WHERE ur.user_id = m.old_id
  AND m.old_id <> m.base_id;

SELECT pg_temp.repoint_references('users'::regclass, 'tmp_user_merge');

DELETE FROM users u
USING tmp_user_merge m
WHERE u.id = m.old_id
  AND m.old_id <> m.base_id;

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_global_key ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_active ON users(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_users_technical_accounts ON users(tenant_id, is_technical_account);

UPDATE user_roles ur
SET tenant_id = u.tenant_id
FROM users u
WHERE ur.user_id = u.id;

DELETE FROM user_roles ur
WHERE ur.user_id IS NULL
   OR NOT EXISTS (
     SELECT 1
     FROM users u
     WHERE u.id = ur.user_id
   );

DELETE FROM user_roles
WHERE tenant_id IS NULL;

ALTER TABLE user_roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_tenant_id_fkey;
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

DELETE FROM user_roles ur
USING user_roles kept
WHERE ur.id <> kept.id
  AND ur.tenant_id = kept.tenant_id
  AND ur.user_id = kept.user_id
  AND ur.role_id = kept.role_id;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_tenant_user_role_key
  ON user_roles(tenant_id, user_id, role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant_user ON user_roles(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant_role ON user_roles(tenant_id, role_id);

-- ---------------------------------------------------------------------------
-- Merge obvious duplicated reference/business records before tenant collapse.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.cycles') IS NOT NULL THEN
    DROP TABLE IF EXISTS pg_temp.tmp_cycles_merge;
    CREATE TEMP TABLE tmp_cycles_merge ON COMMIT DROP AS
    WITH ranked AS (
      SELECT
        id AS old_id,
        FIRST_VALUE(id) OVER (
          PARTITION BY LOWER(COALESCE(NULLIF(code, ''), name))
          ORDER BY (SELECT COUNT(*) FROM jsonb_each(jsonb_strip_nulls(to_jsonb(cycles)))) DESC, created_at ASC NULLS LAST, id ASC
        ) AS base_id
      FROM cycles
    )
    SELECT old_id, base_id FROM ranked;

    PERFORM pg_temp.repoint_references('cycles'::regclass, 'tmp_cycles_merge');

    DELETE FROM cycles c
    USING tmp_cycles_merge m
    WHERE c.id = m.old_id
      AND m.old_id <> m.base_id;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.programmes') IS NOT NULL THEN
    DROP TABLE IF EXISTS pg_temp.tmp_programmes_merge;
    CREATE TEMP TABLE tmp_programmes_merge ON COMMIT DROP AS
    WITH ranked AS (
      SELECT
        id AS old_id,
        FIRST_VALUE(id) OVER (
          PARTITION BY LOWER(COALESCE(NULLIF(code, ''), name)), COALESCE(version, '1.0')
          ORDER BY (SELECT COUNT(*) FROM jsonb_each(jsonb_strip_nulls(to_jsonb(programmes)))) DESC, created_at ASC NULLS LAST, id ASC
        ) AS base_id
      FROM programmes
    )
    SELECT old_id, base_id FROM ranked;

    PERFORM pg_temp.repoint_references('programmes'::regclass, 'tmp_programmes_merge');

    DELETE FROM programmes p
    USING tmp_programmes_merge m
    WHERE p.id = m.old_id
      AND m.old_id <> m.base_id;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.courses') IS NOT NULL THEN
    DROP TABLE IF EXISTS pg_temp.tmp_courses_merge;
    CREATE TEMP TABLE tmp_courses_merge ON COMMIT DROP AS
    WITH ranked AS (
      SELECT
        id AS old_id,
        FIRST_VALUE(id) OVER (
          PARTITION BY COALESCE(programme_id::text, ''), LOWER(COALESCE(NULLIF(code, ''), name))
          ORDER BY (SELECT COUNT(*) FROM jsonb_each(jsonb_strip_nulls(to_jsonb(courses)))) DESC, created_at ASC NULLS LAST, id ASC
        ) AS base_id
      FROM courses
    )
    SELECT old_id, base_id FROM ranked;

    PERFORM pg_temp.repoint_references('courses'::regclass, 'tmp_courses_merge');

    DELETE FROM courses c
    USING tmp_courses_merge m
    WHERE c.id = m.old_id
      AND m.old_id <> m.base_id;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.time_slots') IS NOT NULL THEN
    DROP TABLE IF EXISTS pg_temp.tmp_time_slots_merge;
    CREATE TEMP TABLE tmp_time_slots_merge ON COMMIT DROP AS
    WITH ranked AS (
      SELECT
        id AS old_id,
        FIRST_VALUE(id) OVER (
          PARTITION BY day_of_week, start_time, end_time
          ORDER BY (SELECT COUNT(*) FROM jsonb_each(jsonb_strip_nulls(to_jsonb(time_slots)))) DESC, created_at ASC NULLS LAST, id ASC
        ) AS base_id
      FROM time_slots
    )
    SELECT old_id, base_id FROM ranked;

    PERFORM pg_temp.repoint_references('time_slots'::regclass, 'tmp_time_slots_merge');

    DELETE FROM time_slots ts
    USING tmp_time_slots_merge m
    WHERE ts.id = m.old_id
      AND m.old_id <> m.base_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Copy ASPCI dedicated tables back into the unified base tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.copy_common_columns_if_exists(
  source_table TEXT,
  target_table TEXT,
  filter_sql TEXT DEFAULT 'TRUE'
)
RETURNS void AS $$
DECLARE cols TEXT;
BEGIN
  IF to_regclass('public.' || source_table) IS NULL OR to_regclass('public.' || target_table) IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(format('%I', target_cols.column_name), ', ' ORDER BY target_cols.ordinal_position)
  INTO cols
  FROM information_schema.columns target_cols
  JOIN information_schema.columns source_cols
    ON source_cols.table_schema = target_cols.table_schema
   AND source_cols.column_name = target_cols.column_name
   AND source_cols.table_name = source_table
  WHERE target_cols.table_schema = 'public'
    AND target_cols.table_name = target_table
    AND target_cols.is_generated = 'NEVER'
    AND target_cols.is_identity = 'NO';

  IF cols IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'INSERT INTO %I (%s) SELECT %s FROM %I WHERE %s ON CONFLICT (id) DO NOTHING',
    target_table,
    cols,
    cols,
    source_table,
    filter_sql
  );
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.inscriptions_professionnelles_aspci') IS NOT NULL
     AND to_regclass('public.sessions_professionnelles_aspci') IS NOT NULL THEN
    ALTER TABLE inscriptions_professionnelles_aspci ADD COLUMN IF NOT EXISTS formation_pro_id UUID;
    UPDATE inscriptions_professionnelles_aspci i
    SET formation_pro_id = s.formation_pro_id
    FROM sessions_professionnelles_aspci s
    WHERE i.session_id = s.id
      AND i.formation_pro_id IS NULL;
  END IF;

  IF to_regclass('public.reservations_temporaires_aspci') IS NOT NULL
     AND to_regclass('public.sessions_professionnelles_aspci') IS NOT NULL THEN
    ALTER TABLE reservations_temporaires_aspci ADD COLUMN IF NOT EXISTS formation_pro_id UUID;
    UPDATE reservations_temporaires_aspci r
    SET formation_pro_id = s.formation_pro_id
    FROM sessions_professionnelles_aspci s
    WHERE r.session_id = s.id
      AND r.formation_pro_id IS NULL;
  END IF;

  IF to_regclass('public.support_telechargements_aspci') IS NOT NULL
     AND to_regclass('public.sessions_professionnelles_aspci') IS NOT NULL THEN
    ALTER TABLE support_telechargements_aspci ADD COLUMN IF NOT EXISTS formation_pro_id UUID;
    UPDATE support_telechargements_aspci st
    SET formation_pro_id = s.formation_pro_id
    FROM sessions_professionnelles_aspci s
    WHERE st.session_id = s.id
      AND st.formation_pro_id IS NULL;
  END IF;

  IF to_regclass('public.documents_aspci') IS NOT NULL
     AND to_regclass('public.sessions_professionnelles_aspci') IS NOT NULL THEN
    ALTER TABLE documents_aspci ADD COLUMN IF NOT EXISTS formation_pro_id UUID;
    UPDATE documents_aspci d
    SET formation_pro_id = s.formation_pro_id
    FROM sessions_professionnelles_aspci s
    WHERE d.session_id = s.id
      AND d.formation_pro_id IS NULL;
  END IF;

  IF to_regclass('public.supports_cours_aspci') IS NOT NULL
     AND to_regclass('public.sessions_professionnelles_aspci') IS NOT NULL THEN
    UPDATE supports_cours_aspci sc
    SET formation_id = s.formation_pro_id
    FROM sessions_professionnelles_aspci s
    WHERE sc.session_id = s.id
      AND sc.formation_id IS NULL;
  END IF;
END $$;

SELECT pg_temp.copy_common_columns_if_exists('formations_professionnelles_aspci', 'formations_professionnelles');
SELECT pg_temp.copy_common_columns_if_exists('entreprises_clientes_aspci', 'entreprises_clientes');
SELECT pg_temp.copy_common_columns_if_exists('codes_promo_aspci', 'codes_promo');
SELECT pg_temp.copy_common_columns_if_exists('supports_cours_aspci', 'supports_cours', 'formation_id IS NOT NULL');
SELECT pg_temp.copy_common_columns_if_exists('inscriptions_professionnelles_aspci', 'inscriptions_professionnelles', 'formation_pro_id IS NOT NULL');
SELECT pg_temp.copy_common_columns_if_exists(
  'paiements_professionnels_aspci',
  'paiements_professionnels',
  'EXISTS (SELECT 1 FROM inscriptions_professionnelles i WHERE i.id = inscription_id)'
);
SELECT pg_temp.copy_common_columns_if_exists('reservations_temporaires_aspci', 'reservations_temporaires', 'formation_pro_id IS NOT NULL');
SELECT pg_temp.copy_common_columns_if_exists('support_telechargements_aspci', 'support_telechargements');
SELECT pg_temp.copy_common_columns_if_exists('documents_aspci', 'documents');
SELECT pg_temp.copy_common_columns_if_exists('export_jobs_aspci', 'export_jobs');

-- Final simplified professional training model: no sessions/formateurs tables.
DROP TABLE IF EXISTS session_attendance CASCADE;
DROP TABLE IF EXISTS session_attendance_aspci CASCADE;
DROP TABLE IF EXISTS support_session_associations CASCADE;
DROP TABLE IF EXISTS support_session_associations_aspci CASCADE;
DROP TABLE IF EXISTS notifications_formateurs CASCADE;
DROP TABLE IF EXISTS notifications_formateurs_aspci CASCADE;
DROP TABLE IF EXISTS formateur_indisponibilites CASCADE;
DROP TABLE IF EXISTS formateur_indisponibilites_aspci CASCADE;
DROP TABLE IF EXISTS session_formateurs CASCADE;
DROP TABLE IF EXISTS session_formateurs_aspci CASCADE;
DROP TABLE IF EXISTS sessions_professionnelles CASCADE;
DROP TABLE IF EXISTS sessions_professionnelles_aspci CASCADE;
DROP TABLE IF EXISTS formateurs CASCADE;
DROP TABLE IF EXISTS formateurs_aspci CASCADE;
DROP TABLE IF EXISTS formations_professionnelles_aspci CASCADE;
DROP TABLE IF EXISTS entreprises_clientes_aspci CASCADE;
DROP TABLE IF EXISTS inscriptions_professionnelles_aspci CASCADE;
DROP TABLE IF EXISTS paiements_professionnels_aspci CASCADE;
DROP TABLE IF EXISTS codes_promo_aspci CASCADE;
DROP TABLE IF EXISTS supports_cours_aspci CASCADE;
DROP TABLE IF EXISTS reservations_temporaires_aspci CASCADE;
DROP TABLE IF EXISTS support_telechargements_aspci CASCADE;
DROP TABLE IF EXISTS documents_aspci CASCADE;
DROP TABLE IF EXISTS export_jobs_aspci CASCADE;

-- ---------------------------------------------------------------------------
-- Attach all existing tenantized data to the reference tenant.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  ref_tenant_id UUID;
  rec RECORD;
BEGIN
  SELECT id INTO ref_tenant_id FROM tenants WHERE slug = 'ecoledigitale';

  FOR rec IN
    SELECT DISTINCT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN (
        'tenants',
        'roles',
        'token_blacklist',
        'super_admin_users',
        'super_admin_audit_logs'
      )
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET tenant_id = $1 WHERE tenant_id IS DISTINCT FROM $1',
      rec.table_schema,
      rec.table_name
    )
    USING ref_tenant_id;
  END LOOP;
END $$;

-- Add tenant_id to any remaining tenantized technical/association tables that did not have it.
DO $$
DECLARE
  ref_tenant_id UUID;
  rec RECORD;
  constraint_name TEXT;
BEGIN
  SELECT id INTO ref_tenant_id FROM tenants WHERE slug = 'ecoledigitale';

  FOR rec IN
    SELECT t.table_schema, t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name NOT IN (
        'tenants',
        'roles',
        'token_blacklist',
        'super_admin_users',
        'super_admin_audit_logs'
      )
      AND t.table_name NOT LIKE '%\_aspci' ESCAPE '\'
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = t.table_schema
          AND c.table_name = t.table_name
          AND c.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN tenant_id UUID', rec.table_schema, rec.table_name);
    EXECUTE format('UPDATE %I.%I SET tenant_id = $1 WHERE tenant_id IS NULL', rec.table_schema, rec.table_name)
    USING ref_tenant_id;
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN tenant_id SET NOT NULL', rec.table_schema, rec.table_name);

    constraint_name := LEFT('fk_' || rec.table_name || '_tenant_id', 60);
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE',
        rec.table_schema,
        rec.table_name,
        constraint_name
      );
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END $$;

DELETE FROM token_blacklist;
DELETE FROM tenants WHERE slug <> 'ecoledigitale';

-- ---------------------------------------------------------------------------
-- Token blacklist is global and supports tenant-user and super-admin tokens.
-- ---------------------------------------------------------------------------
ALTER TABLE token_blacklist ADD COLUMN IF NOT EXISTS scope VARCHAR(32) NOT NULL DEFAULT 'tenant_user';
ALTER TABLE token_blacklist ADD COLUMN IF NOT EXISTS super_admin_id UUID REFERENCES super_admin_users(id) ON DELETE CASCADE;
ALTER TABLE token_blacklist ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE token_blacklist ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE token_blacklist DROP CONSTRAINT IF EXISTS unique_tenant_token;

DROP INDEX IF EXISTS idx_blacklist_lookup;
DROP INDEX IF EXISTS idx_token_blacklist_scope_tenant_jti;
CREATE UNIQUE INDEX IF NOT EXISTS idx_token_blacklist_scope_tenant_jti
  ON token_blacklist(scope, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), token_jti);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_user ON token_blacklist(scope, tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_super_admin ON token_blacklist(scope, super_admin_id);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_cleanup ON token_blacklist(expires_at);

-- Invalidate all previously issued tenant JWTs after the model migration.
UPDATE users SET role_updated_at = NOW(), updated_at = NOW();

-- ---------------------------------------------------------------------------
-- RLS helpers and policies for all tenantized tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS UUID AS $$
DECLARE tenant_setting TEXT;
BEGIN
  tenant_setting := COALESCE(
    NULLIF(current_setting('app.tenant_id', true), ''),
    NULLIF(current_setting('app.current_tenant_id', true), '')
  );
  RETURN tenant_setting::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION app_is_super_admin_context()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(NULLIF(current_setting('app.super_admin', true), ''), 'false') = 'true';
END;
$$ LANGUAGE plpgsql STABLE;

DO $$
DECLARE
  rec RECORD;
  pol RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN (
        'tenants',
        'roles',
        'token_blacklist',
        'super_admin_users',
        'super_admin_audit_logs'
      )
  LOOP
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = rec.table_schema
        AND tablename = rec.table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, rec.table_schema, rec.table_name);
    END LOOP;

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', rec.table_schema, rec.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', rec.table_schema, rec.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %I.%I
       FOR ALL
       USING (app_is_super_admin_context() OR tenant_id = app_current_tenant_id())
       WITH CHECK (app_is_super_admin_context() OR tenant_id = app_current_tenant_id())',
      rec.table_schema,
      rec.table_name
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I(tenant_id)',
      LEFT('idx_' || rec.table_name || '_tenant_id', 63),
      rec.table_schema,
      rec.table_name
    );
  END LOOP;
END $$;

ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE token_blacklist DISABLE ROW LEVEL SECURITY;
ALTER TABLE super_admin_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE super_admin_audit_logs DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE roles IS 'Global role catalogue shared by all tenants; assignments are tenant-scoped through user_roles. roles.key is immutable.';
COMMENT ON TABLE super_admin_users IS 'Single global super-administrator account bootstrapped from environment variables.';
COMMENT ON TABLE super_admin_audit_logs IS 'Global audit trail for every super-admin action and impersonation.';
COMMENT ON COLUMN user_roles.tenant_id IS 'Physical tenant scope for a user-role assignment.';

COMMIT;

SELECT 'Migration 0055_unified_multitenancy.sql completed successfully' AS result;
