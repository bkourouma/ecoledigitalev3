-- RSO-PFSO Phase 5 Rollback Migration
-- Removes advanced search and recommendation management tables
-- Date: 2025-01-27
-- Feature: Phase 5 - Recherche Avancée et Gestion des Recommandations (ROLLBACK)

-- =================================================================
-- DROP TRIGGERS
-- =================================================================

-- Drop triggers for rso_recherches_enregistrees
DROP TRIGGER IF EXISTS trigger_rso_recherches_enregistrees_updated_at ON rso_recherches_enregistrees;
DROP FUNCTION IF EXISTS update_rso_recherches_enregistrees_updated_at();

-- Drop triggers for rso_rapports_planifies
DROP TRIGGER IF EXISTS trigger_rso_rapports_planifies_updated_at ON rso_rapports_planifies;
DROP FUNCTION IF EXISTS update_rso_rapports_planifies_updated_at();

-- Drop triggers for rso_notifications
DROP TRIGGER IF EXISTS trigger_rso_notifications_lue_le ON rso_notifications;
DROP FUNCTION IF EXISTS update_rso_notifications_lue_le();
DROP TRIGGER IF EXISTS trigger_rso_notifications_expire_le ON rso_notifications;
DROP FUNCTION IF EXISTS set_rso_notifications_expire_le();

-- Drop triggers for rso_activites_tags (tag usage count)
DROP TRIGGER IF EXISTS trigger_increment_tag_usage ON rso_activites_tags;
DROP FUNCTION IF EXISTS increment_tag_usage();
DROP TRIGGER IF EXISTS trigger_decrement_tag_usage ON rso_activites_tags;
DROP FUNCTION IF EXISTS decrement_tag_usage();

-- =================================================================
-- DROP RLS POLICIES
-- =================================================================

DROP POLICY IF EXISTS rso_tags_tenant_isolation ON rso_tags;
DROP POLICY IF EXISTS rso_activites_tags_tenant_isolation ON rso_activites_tags;
DROP POLICY IF EXISTS rso_recherches_enregistrees_tenant_isolation ON rso_recherches_enregistrees;
DROP POLICY IF EXISTS rso_notifications_tenant_isolation ON rso_notifications;
DROP POLICY IF EXISTS rso_rapports_planifies_tenant_isolation ON rso_rapports_planifies;
DROP POLICY IF EXISTS rso_recommandations_historique_tenant_isolation ON rso_recommandations_historique;

-- =================================================================
-- DROP INDEXES
-- =================================================================

-- Drop full-text search indexes
DROP INDEX IF EXISTS idx_activites_recherche;
DROP INDEX IF EXISTS idx_recommandations_recherche;

-- Drop indexes for rso_tags
DROP INDEX IF EXISTS idx_rso_tags_categorie;
DROP INDEX IF EXISTS idx_rso_tags_actif;
DROP INDEX IF EXISTS idx_rso_tags_nb_utilisations;

-- Drop indexes for rso_activites_tags
DROP INDEX IF EXISTS idx_rso_activites_tags_activite;
DROP INDEX IF EXISTS idx_rso_activites_tags_tag;
DROP INDEX IF EXISTS idx_rso_activites_tags_ajout_par;

-- Drop indexes for rso_recherches_enregistrees
DROP INDEX IF EXISTS idx_rso_recherches_enregistrees_user;
DROP INDEX IF EXISTS idx_rso_recherches_enregistrees_notification;

-- Drop indexes for rso_notifications
DROP INDEX IF EXISTS idx_rso_notifications_user_lue;
DROP INDEX IF EXISTS idx_rso_notifications_type;
DROP INDEX IF EXISTS idx_rso_notifications_priorite;
DROP INDEX IF EXISTS idx_rso_notifications_created_at;
DROP INDEX IF EXISTS idx_rso_notifications_expire_le;

-- Drop indexes for rso_rapports_planifies
DROP INDEX IF EXISTS idx_rso_rapports_planifies_user;
DROP INDEX IF EXISTS idx_rso_rapports_planifies_prochaine_execution;

-- Drop indexes for rso_recommandations_historique
DROP INDEX IF EXISTS idx_rso_recommandations_historique_recommandation;
DROP INDEX IF EXISTS idx_rso_recommandations_historique_action;
DROP INDEX IF EXISTS idx_rso_recommandations_historique_created_at;

-- Drop indexes for enhanced rso_recommandations (if table still exists)
DROP INDEX IF EXISTS idx_rso_recommandations_impact;
DROP INDEX IF EXISTS idx_rso_recommandations_validation_requise;
DROP INDEX IF EXISTS idx_rso_recommandations_date_echeance;

-- =================================================================
-- REMOVE ENHANCED COLUMNS FROM rso_recommandations (if table exists)
-- =================================================================
-- Note: If rso_recommandations was already dropped in Phase 3 rollback, 
-- these ALTER TABLE statements will fail gracefully

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rso_recommandations') THEN
        ALTER TABLE rso_recommandations 
            DROP COLUMN IF EXISTS categorie,
            DROP COLUMN IF EXISTS impact,
            DROP COLUMN IF EXISTS cout_estime,
            DROP COLUMN IF EXISTS delai_jours,
            DROP COLUMN IF EXISTS piece_jointe,
            DROP COLUMN IF EXISTS validation_requise,
            DROP COLUMN IF EXISTS validee_par,
            DROP COLUMN IF EXISTS date_validation,
            DROP COLUMN IF EXISTS commentaire_validation;
    END IF;
END $$;

-- =================================================================
-- DROP TABLES (in reverse dependency order)
-- =================================================================

-- Drop junction table first (has foreign keys to both rso_activites and rso_tags)
DROP TABLE IF EXISTS rso_activites_tags CASCADE;

-- Drop tables with foreign keys to rso_users
DROP TABLE IF EXISTS rso_recherches_enregistrees CASCADE;
DROP TABLE IF EXISTS rso_notifications CASCADE;
DROP TABLE IF EXISTS rso_rapports_planifies CASCADE;

-- Drop table with foreign key to rso_recommandations
DROP TABLE IF EXISTS rso_recommandations_historique CASCADE;

-- Drop rso_tags (no dependencies from other Phase 5 tables)
DROP TABLE IF EXISTS rso_tags CASCADE;

