-- RSO-PFSO Phase 6 Rollback Migration
-- Removes incident management tables
-- Date: 2025-01-27
-- Feature: Phase 6 - Gestion des Incidents (ROLLBACK)

-- =================================================================
-- DROP TRIGGERS
-- =================================================================

-- Drop triggers for rso_incidents
DROP TRIGGER IF EXISTS trigger_rso_incidents_updated_at ON rso_incidents;
DROP FUNCTION IF EXISTS update_rso_incidents_updated_at();

-- Drop triggers for rso_incidents_commentaires
DROP TRIGGER IF EXISTS trigger_rso_incidents_commentaires_updated_at ON rso_incidents_commentaires;
DROP FUNCTION IF EXISTS update_rso_incidents_commentaires_updated_at();

-- Drop triggers for rso_incidents_mesures
DROP TRIGGER IF EXISTS trigger_rso_incidents_mesures_updated_at ON rso_incidents_mesures;
DROP FUNCTION IF EXISTS update_rso_incidents_mesures_updated_at();

-- =================================================================
-- DROP RLS POLICIES
-- =================================================================

DROP POLICY IF EXISTS rso_incidents_tenant_isolation ON rso_incidents;
DROP POLICY IF EXISTS rso_incidents_medias_tenant_isolation ON rso_incidents_medias;
DROP POLICY IF EXISTS rso_incidents_historique_tenant_isolation ON rso_incidents_historique;
DROP POLICY IF EXISTS rso_incidents_commentaires_tenant_isolation ON rso_incidents_commentaires;
DROP POLICY IF EXISTS rso_incidents_mesures_tenant_isolation ON rso_incidents_mesures;
DROP POLICY IF EXISTS rso_incidents_stats_tenant_isolation ON rso_incidents_stats;

-- =================================================================
-- DROP INDEXES
-- =================================================================

-- Drop full-text search index
DROP INDEX IF EXISTS idx_rso_incidents_recherche;

-- Drop indexes for rso_incidents
DROP INDEX IF EXISTS idx_rso_incidents_tenant_id;
DROP INDEX IF EXISTS idx_rso_incidents_code;
DROP INDEX IF EXISTS idx_rso_incidents_installation;
DROP INDEX IF EXISTS idx_rso_incidents_annee;
DROP INDEX IF EXISTS idx_rso_incidents_type;
DROP INDEX IF EXISTS idx_rso_incidents_statut;
DROP INDEX IF EXISTS idx_rso_incidents_date;
DROP INDEX IF EXISTS idx_rso_incidents_urgence;
DROP INDEX IF EXISTS idx_rso_incidents_categorie;
DROP INDEX IF EXISTS idx_rso_incidents_priorite;
DROP INDEX IF EXISTS idx_rso_incidents_declare_par;
DROP INDEX IF EXISTS idx_rso_incidents_assigne_a;
DROP INDEX IF EXISTS idx_rso_incidents_deleted_at;
DROP INDEX IF EXISTS idx_rso_incidents_installation_statut;
DROP INDEX IF EXISTS idx_rso_incidents_statut_urgence;
DROP INDEX IF EXISTS idx_rso_incidents_date_statut;

-- Drop indexes for rso_incidents_medias
DROP INDEX IF EXISTS idx_rso_incidents_medias_tenant_id;
DROP INDEX IF EXISTS idx_rso_incidents_medias_incident;
DROP INDEX IF EXISTS idx_rso_incidents_medias_type;
DROP INDEX IF EXISTS idx_rso_incidents_medias_uploaded_by;
DROP INDEX IF EXISTS idx_rso_incidents_medias_ordre;

-- Drop indexes for rso_incidents_historique
DROP INDEX IF EXISTS idx_rso_incidents_historique_tenant_id;
DROP INDEX IF EXISTS idx_rso_incidents_historique_incident;
DROP INDEX IF EXISTS idx_rso_incidents_historique_action;
DROP INDEX IF EXISTS idx_rso_incidents_historique_user;
DROP INDEX IF EXISTS idx_rso_incidents_historique_created_at;
DROP INDEX IF EXISTS idx_rso_incidents_historique_incident_created;

-- Drop indexes for rso_incidents_commentaires
DROP INDEX IF EXISTS idx_rso_incidents_commentaires_tenant_id;
DROP INDEX IF EXISTS idx_rso_incidents_commentaires_incident;
DROP INDEX IF EXISTS idx_rso_incidents_commentaires_user;
DROP INDEX IF EXISTS idx_rso_incidents_commentaires_type;
DROP INDEX IF EXISTS idx_rso_incidents_commentaires_deleted_at;
DROP INDEX IF EXISTS idx_rso_incidents_commentaires_incident_created;

-- Drop indexes for rso_incidents_mesures
DROP INDEX IF EXISTS idx_rso_incidents_mesures_tenant_id;
DROP INDEX IF EXISTS idx_rso_incidents_mesures_incident;
DROP INDEX IF EXISTS idx_rso_incidents_mesures_type;
DROP INDEX IF EXISTS idx_rso_incidents_mesures_statut;
DROP INDEX IF EXISTS idx_rso_incidents_mesures_responsable;
DROP INDEX IF EXISTS idx_rso_incidents_mesures_date_echeance;
DROP INDEX IF EXISTS idx_rso_incidents_mesures_incident_type;

-- Drop indexes for rso_incidents_stats
DROP INDEX IF EXISTS idx_rso_incidents_stats_tenant_id;
DROP INDEX IF EXISTS idx_rso_incidents_stats_date;
DROP INDEX IF EXISTS idx_rso_incidents_stats_installation;
DROP INDEX IF EXISTS idx_rso_incidents_stats_date_installation;

-- =================================================================
-- DROP TABLES (in reverse dependency order)
-- =================================================================

-- Drop dependent tables first
DROP TABLE IF EXISTS rso_incidents_medias CASCADE;
DROP TABLE IF EXISTS rso_incidents_historique CASCADE;
DROP TABLE IF EXISTS rso_incidents_commentaires CASCADE;
DROP TABLE IF EXISTS rso_incidents_mesures CASCADE;
DROP TABLE IF EXISTS rso_incidents_stats CASCADE;

-- Drop main incidents table
DROP TABLE IF EXISTS rso_incidents CASCADE;

