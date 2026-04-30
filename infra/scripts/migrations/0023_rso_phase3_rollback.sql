-- RSO-PFSO Phase 3 Database Migration ROLLBACK
-- Drops all RSO Phase 3 tables and related objects
-- Date: 2025-01-XX
-- WARNING: This will delete all data in RSO Phase 3 tables

-- =================================================================
-- DROP TRIGGERS
-- =================================================================

DROP TRIGGER IF EXISTS trigger_rso_activites_updated_at ON rso_activites;
DROP TRIGGER IF EXISTS trigger_rso_recommandations_updated_at ON rso_recommandations;
DROP FUNCTION IF EXISTS update_rso_activites_updated_at();
DROP FUNCTION IF EXISTS update_rso_recommandations_updated_at();

-- =================================================================
-- DROP RLS POLICIES
-- =================================================================

DROP POLICY IF EXISTS rso_types_activites_tenant_isolation ON rso_types_activites;
DROP POLICY IF EXISTS rso_activites_tenant_isolation ON rso_activites;
DROP POLICY IF EXISTS rso_recommandations_tenant_isolation ON rso_recommandations;
DROP POLICY IF EXISTS rso_activites_pfso_access_tenant_isolation ON rso_activites_pfso_access;
DROP POLICY IF EXISTS rso_activites_medias_tenant_isolation ON rso_activites_medias;

-- =================================================================
-- DROP INDEXES
-- =================================================================

-- rso_types_activites indexes
DROP INDEX IF EXISTS idx_rso_types_activites_parent;
DROP INDEX IF EXISTS idx_rso_types_activites_ordre;
DROP INDEX IF EXISTS idx_rso_types_activites_actif;

-- rso_activites indexes
DROP INDEX IF EXISTS idx_rso_activites_code;
DROP INDEX IF EXISTS idx_rso_activites_type;
DROP INDEX IF EXISTS idx_rso_activites_date;
DROP INDEX IF EXISTS idx_rso_activites_installation;
DROP INDEX IF EXISTS idx_rso_activites_annee;
DROP INDEX IF EXISTS idx_rso_activites_statut;
DROP INDEX IF EXISTS idx_rso_activites_created_by;
DROP INDEX IF EXISTS idx_rso_activites_deleted_at;

-- rso_recommandations indexes
DROP INDEX IF EXISTS idx_rso_recommandations_activite;
DROP INDEX IF EXISTS idx_rso_recommandations_statut;
DROP INDEX IF EXISTS idx_rso_recommandations_priorite;
DROP INDEX IF EXISTS idx_rso_recommandations_responsable;
DROP INDEX IF EXISTS idx_rso_recommandations_date_echeance;
DROP INDEX IF EXISTS idx_rso_recommandations_en_retard;

-- rso_activites_pfso_access indexes
DROP INDEX IF EXISTS idx_rso_activites_pfso_access_activite;
DROP INDEX IF EXISTS idx_rso_activites_pfso_access_user;
DROP INDEX IF EXISTS idx_rso_activites_pfso_access_granted_by;

-- rso_activites_medias indexes
DROP INDEX IF EXISTS idx_rso_activites_medias_activite;
DROP INDEX IF EXISTS idx_rso_activites_medias_type;
DROP INDEX IF EXISTS idx_rso_activites_medias_ordre;

-- =================================================================
-- DROP TABLES (in reverse dependency order)
-- =================================================================

-- Drop tables that reference rso_activites first
DROP TABLE IF EXISTS rso_activites_medias CASCADE;
DROP TABLE IF EXISTS rso_activites_pfso_access CASCADE;
DROP TABLE IF EXISTS rso_recommandations CASCADE;

-- Drop rso_activites (references rso_types_activites, rso_annees, rso_installations)
DROP TABLE IF EXISTS rso_activites CASCADE;

-- Finally drop rso_types_activites (self-referential, no other dependencies)
DROP TABLE IF EXISTS rso_types_activites CASCADE;

-- =================================================================
-- COMMENTS
-- =================================================================

-- All RSO Phase 3 tables and related objects have been removed

