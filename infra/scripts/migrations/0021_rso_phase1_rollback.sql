-- RSO-PFSO Phase 1 Database Migration ROLLBACK
-- Drops all RSO Phase 1 tables and related objects
-- Date: 2025-01-XX
-- WARNING: This will delete all data in RSO Phase 1 tables

-- =================================================================
-- DROP TRIGGERS
-- =================================================================

DROP TRIGGER IF EXISTS trigger_rso_users_updated_at ON rso_users;
DROP FUNCTION IF EXISTS update_rso_users_updated_at();

-- =================================================================
-- DROP RLS POLICIES
-- =================================================================

DROP POLICY IF EXISTS rso_users_tenant_isolation ON rso_users;
DROP POLICY IF EXISTS rso_sessions_tenant_isolation ON rso_user_sessions;
DROP POLICY IF EXISTS rso_logs_tenant_isolation ON rso_activity_logs;

-- =================================================================
-- DROP INDEXES
-- =================================================================

-- rso_users indexes
DROP INDEX IF EXISTS idx_rso_users_tenant_id;
DROP INDEX IF EXISTS idx_rso_users_email;
DROP INDEX IF EXISTS idx_rso_users_username;
DROP INDEX IF EXISTS idx_rso_users_role;
DROP INDEX IF EXISTS idx_rso_users_statut;
DROP INDEX IF EXISTS idx_rso_users_installation_id;
DROP INDEX IF EXISTS idx_rso_users_password_reset_token;

-- rso_user_sessions indexes
DROP INDEX IF EXISTS idx_rso_sessions_user_id;
DROP INDEX IF EXISTS idx_rso_sessions_token;
DROP INDEX IF EXISTS idx_rso_sessions_statut;
DROP INDEX IF EXISTS idx_rso_sessions_expires_at;
DROP INDEX IF EXISTS idx_rso_sessions_active;

-- rso_activity_logs indexes
DROP INDEX IF EXISTS idx_rso_logs_user_id;
DROP INDEX IF EXISTS idx_rso_logs_action;
DROP INDEX IF EXISTS idx_rso_logs_entity;
DROP INDEX IF EXISTS idx_rso_logs_created_at;
DROP INDEX IF EXISTS idx_rso_logs_user_action;

-- rso_permissions indexes
DROP INDEX IF EXISTS idx_rso_permissions_role;
DROP INDEX IF EXISTS idx_rso_permissions_module;

-- =================================================================
-- DROP TABLES (in reverse dependency order)
-- =================================================================

-- Drop tables that reference rso_users first
DROP TABLE IF EXISTS rso_user_sessions CASCADE;
DROP TABLE IF EXISTS rso_activity_logs CASCADE;

-- Drop rso_permissions (no foreign keys to rso_users)
DROP TABLE IF EXISTS rso_permissions CASCADE;

-- Finally drop rso_users (may be referenced by other phases)
-- Note: This will fail if other tables reference rso_users
-- If that's the case, those tables need to be dropped first
DROP TABLE IF EXISTS rso_users CASCADE;

-- =================================================================
-- COMMENTS
-- =================================================================

-- All RSO Phase 1 tables and related objects have been removed

