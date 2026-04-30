-- RSO-PFSO Phase 2 Database Migration ROLLBACK
-- Drops all RSO Phase 2 tables and related objects
-- Date: 2025-01-XX
-- WARNING: This will delete all data in RSO Phase 2 tables

-- =================================================================
-- DROP FOREIGN KEY CONSTRAINT: rso_users.installation_id
-- =================================================================
-- Remove foreign key constraint from rso_users (if it exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'rso_users_installation_id_fkey'
    ) THEN
        ALTER TABLE rso_users
        DROP CONSTRAINT rso_users_installation_id_fkey;
    END IF;
END $$;

-- =================================================================
-- DROP TRIGGERS
-- =================================================================

DROP TRIGGER IF EXISTS trigger_rso_installations_updated_at ON rso_installations;
DROP FUNCTION IF EXISTS update_rso_installations_updated_at();

-- =================================================================
-- DROP RLS POLICIES
-- =================================================================

DROP POLICY IF EXISTS rso_installations_tenant_isolation ON rso_installations;
DROP POLICY IF EXISTS rso_annees_tenant_isolation ON rso_annees;
DROP POLICY IF EXISTS rso_responsables_tenant_isolation ON rso_installation_responsables;

-- =================================================================
-- DROP INDEXES
-- =================================================================

-- rso_installations indexes
DROP INDEX IF EXISTS idx_rso_installations_tenant_id;
DROP INDEX IF EXISTS idx_rso_installations_code;
DROP INDEX IF EXISTS idx_rso_installations_ville;
DROP INDEX IF EXISTS idx_rso_installations_type;
DROP INDEX IF EXISTS idx_rso_installations_statut;
DROP INDEX IF EXISTS idx_rso_installations_created_by;
DROP INDEX IF EXISTS idx_rso_installations_deleted_at;
DROP INDEX IF EXISTS idx_rso_installations_search;

-- rso_annees indexes
DROP INDEX IF EXISTS idx_rso_annees_annee;
DROP INDEX IF EXISTS idx_rso_annees_statut;
DROP INDEX IF EXISTS idx_rso_annees_active;

-- rso_installation_responsables indexes
DROP INDEX IF EXISTS idx_rso_responsables_unique_active_principal;
DROP INDEX IF EXISTS idx_rso_responsables_installation_id;
DROP INDEX IF EXISTS idx_rso_responsables_user_id;
DROP INDEX IF EXISTS idx_rso_responsables_type;
DROP INDEX IF EXISTS idx_rso_responsables_statut;
DROP INDEX IF EXISTS idx_rso_responsables_active;
DROP INDEX IF EXISTS idx_rso_responsables_dates;

-- =================================================================
-- DROP TABLES (in reverse dependency order)
-- =================================================================

-- Drop tables that reference rso_installations first
DROP TABLE IF EXISTS rso_installation_responsables CASCADE;

-- Drop rso_annees (no foreign keys to other RSO tables)
DROP TABLE IF EXISTS rso_annees CASCADE;

-- Finally drop rso_installations (may be referenced by other phases)
-- Note: This will fail if other tables reference rso_installations
-- If that's the case, those tables need to be dropped first
DROP TABLE IF EXISTS rso_installations CASCADE;

-- =================================================================
-- COMMENTS
-- =================================================================

-- All RSO Phase 2 tables and related objects have been removed

