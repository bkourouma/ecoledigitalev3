-- RSO-PFSO Phase 4 Database Migration ROLLBACK
-- Removes Phase 4 extensions and tables
-- Date: 2025-01-XX
-- WARNING: This will delete all data in RSO Phase 4 tables and remove Phase 4 columns

-- =================================================================
-- DROP TRIGGERS
-- =================================================================

DROP TRIGGER IF EXISTS trigger_rso_activites_medias_updated_at ON rso_activites_medias;
DROP TRIGGER IF EXISTS trigger_rso_quotas_utilisateurs_updated_at ON rso_quotas_utilisateurs;
DROP FUNCTION IF EXISTS update_rso_activites_medias_updated_at();
DROP FUNCTION IF EXISTS update_rso_quotas_utilisateurs_updated_at();

-- =================================================================
-- DROP RLS POLICIES
-- =================================================================

DROP POLICY IF EXISTS rso_documents_exports_tenant_isolation ON rso_documents_exports;
DROP POLICY IF EXISTS rso_quotas_utilisateurs_tenant_isolation ON rso_quotas_utilisateurs;

-- =================================================================
-- DROP INDEXES
-- =================================================================

-- rso_activites_medias Phase 4 indexes
DROP INDEX IF EXISTS idx_rso_activites_medias_statut;
DROP INDEX IF EXISTS idx_rso_activites_medias_uploaded_by;
DROP INDEX IF EXISTS idx_rso_activites_medias_deleted_at;
DROP INDEX IF EXISTS idx_rso_activites_medias_est_principal;

-- rso_documents_exports indexes
DROP INDEX IF EXISTS idx_rso_documents_exports_user;
DROP INDEX IF EXISTS idx_rso_documents_exports_activite;
DROP INDEX IF EXISTS idx_rso_documents_exports_statut;
DROP INDEX IF EXISTS idx_rso_documents_exports_expire;
DROP INDEX IF EXISTS idx_rso_documents_exports_type;

-- rso_quotas_utilisateurs indexes
DROP INDEX IF EXISTS idx_rso_quotas_utilisateurs_user;
DROP INDEX IF EXISTS idx_rso_quotas_utilisateurs_quota_utilise;

-- =================================================================
-- DROP TABLES
-- =================================================================

-- Drop new tables created in Phase 4
DROP TABLE IF EXISTS rso_documents_exports CASCADE;
DROP TABLE IF EXISTS rso_quotas_utilisateurs CASCADE;

-- =================================================================
-- REMOVE PHASE 4 COLUMNS FROM rso_activites_medias
-- =================================================================
-- Note: Since Phase 3 (rso_activites_medias) was already removed,
-- this section is included for completeness but may not be needed
-- if the table doesn't exist

-- Remove Phase 4 columns from rso_activites_medias (if table exists)
DO $$
BEGIN
    -- Check if table exists before attempting to drop columns
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rso_activites_medias') THEN
        -- Drop Phase 4 added columns
        ALTER TABLE rso_activites_medias
            DROP COLUMN IF EXISTS nom_original,
            DROP COLUMN IF EXISTS chemin_thumbnail,
            DROP COLUMN IF EXISTS chemin_optimise,
            DROP COLUMN IF EXISTS taille_humaine,
            DROP COLUMN IF EXISTS extension,
            DROP COLUMN IF EXISTS largeur,
            DROP COLUMN IF EXISTS hauteur,
            DROP COLUMN IF EXISTS duree_secondes,
            DROP COLUMN IF EXISTS description,
            DROP COLUMN IF EXISTS est_principal,
            DROP COLUMN IF EXISTS statut,
            DROP COLUMN IF EXISTS erreur_message,
            DROP COLUMN IF EXISTS exif_data,
            DROP COLUMN IF EXISTS url_original,
            DROP COLUMN IF EXISTS url_optimise,
            DROP COLUMN IF EXISTS url_thumbnail,
            DROP COLUMN IF EXISTS updated_at,
            DROP COLUMN IF EXISTS deleted_at;
        
        -- Revert type_media constraint to Phase 3 version (remove 'audio')
        ALTER TABLE rso_activites_medias
            DROP CONSTRAINT IF EXISTS rso_activites_medias_type_media_check;
        
        ALTER TABLE rso_activites_medias
            ADD CONSTRAINT rso_activites_medias_type_media_check 
            CHECK (type_media IN ('image', 'video', 'document'));
        
        -- Revert activite_id to NOT NULL (if it was made nullable in Phase 4)
        ALTER TABLE rso_activites_medias
            ALTER COLUMN activite_id SET NOT NULL;
    END IF;
END $$;

-- =================================================================
-- COMMENTS
-- =================================================================

-- All RSO Phase 4 tables and extensions have been removed

