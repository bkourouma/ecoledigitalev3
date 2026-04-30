-- RSO-PFSO Phase 6 Database Migration - Incident Management
-- Creates all tables, indexes, and RLS policies for incident management system
-- Date: 2025-01-27
-- Feature: Phase 6 - Gestion des Incidents

-- =================================================================
-- TABLE: rso_incidents
-- =================================================================

CREATE TABLE IF NOT EXISTS rso_incidents (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Identification
    code_incident VARCHAR(50) NOT NULL,
    titre VARCHAR(255) NOT NULL,
    
    -- Relations
    installation_id INT NOT NULL REFERENCES rso_installations(id) ON DELETE RESTRICT,
    annee_id INT NOT NULL REFERENCES rso_annees(id) ON DELETE RESTRICT,
    
    -- Classification
    type_incident VARCHAR(50) NOT NULL CHECK (type_incident IN (
        'intrusion', 
        'vol', 
        'vandalisme', 
        'incendie',
        'accident',
        'acces_non_autorise',
        'falsification_documents',
        'equipement_defectueux',
        'violation_procedure',
        'cyber_incident',
        'autre'
    )),
    
    categorie VARCHAR(20) NOT NULL DEFAULT 'modere' CHECK (categorie IN ('mineur', 'modere', 'grave', 'critique')),
    niveau_urgence VARCHAR(20) NOT NULL DEFAULT 'moyen' CHECK (niveau_urgence IN ('bas', 'moyen', 'eleve', 'critique')),
    
    -- Localisation et temporalité
    zone_incident VARCHAR(255) NOT NULL,
    date_incident TIMESTAMP WITH TIME ZONE NOT NULL,
    date_decouverte TIMESTAMP WITH TIME ZONE NULL,
    
    -- Description
    description_courte TEXT NOT NULL,
    description_detaillee TEXT NOT NULL,
    circonstances TEXT NULL,
    
    -- Personnes impliquées (JSON)
    temoins JSONB NULL,
    suspects JSONB NULL,
    victimes JSONB NULL,
    
    -- Impact
    impact_materiel TEXT NULL,
    impact_operationnel TEXT NULL,
    impact_humain TEXT NULL,
    cout_estime DECIMAL(12,2) NULL,
    
    -- Statut et traitement
    statut VARCHAR(30) NOT NULL DEFAULT 'nouveau' CHECK (statut IN (
        'nouveau',
        'en_investigation',
        'en_traitement',
        'resolu',
        'clos',
        'archive'
    )),
    
    priorite VARCHAR(10) NOT NULL DEFAULT 'P3' CHECK (priorite IN ('P1', 'P2', 'P3', 'P4')),
    
    -- Responsables
    declare_par INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    assigne_a INT NULL REFERENCES rso_users(id) ON DELETE SET NULL,
    valide_par INT NULL REFERENCES rso_users(id) ON DELETE SET NULL,
    
    -- Dates de suivi
    date_prise_en_charge TIMESTAMP WITH TIME ZONE NULL,
    date_resolution TIMESTAMP WITH TIME ZONE NULL,
    date_validation TIMESTAMP WITH TIME ZONE NULL,
    date_cloture TIMESTAMP WITH TIME ZONE NULL,
    
    -- Mesures prises
    mesures_immediates TEXT NULL,
    mesures_correctives TEXT NULL,
    mesures_preventives TEXT NULL,
    
    -- Conformité code ISPS
    conforme_isps BOOLEAN NOT NULL DEFAULT TRUE,
    raison_non_conformite TEXT NULL,
    
    -- Confidentialité
    niveau_confidentialite VARCHAR(20) NOT NULL DEFAULT 'restreint' CHECK (niveau_confidentialite IN ('public', 'restreint', 'confidentiel', 'secret')),
    
    -- Métadonnées
    tags JSONB NULL,
    donnees_supplementaires JSONB NULL,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    
    CONSTRAINT rso_incidents_code_unique UNIQUE (code_incident),
    CONSTRAINT rso_incidents_tenant_code_unique UNIQUE (tenant_id, code_incident),
    CONSTRAINT rso_incidents_code_format CHECK (
        code_incident ~ '^INC-[0-9]{4}-[A-Z0-9_]+-[0-9]+$'
    ),
    CONSTRAINT rso_incidents_titre_length CHECK (
        LENGTH(TRIM(titre)) >= 5 AND LENGTH(TRIM(titre)) <= 255
    ),
    CONSTRAINT rso_incidents_description_courte_length CHECK (
        LENGTH(TRIM(description_courte)) >= 20
    ),
    CONSTRAINT rso_incidents_date_incident_not_future CHECK (
        date_incident <= CURRENT_TIMESTAMP + INTERVAL '1 day'
    ),
    CONSTRAINT rso_incidents_date_decouverte_after_incident CHECK (
        date_decouverte IS NULL OR date_decouverte >= date_incident
    )
);

-- =================================================================
-- TABLE: rso_incidents_medias
-- =================================================================

CREATE TABLE IF NOT EXISTS rso_incidents_medias (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id INT NOT NULL REFERENCES rso_incidents(id) ON DELETE CASCADE,
    
    type_media VARCHAR(20) NOT NULL CHECK (type_media IN ('image', 'video', 'audio', 'document')),
    nom_fichier VARCHAR(255) NOT NULL,
    nom_original VARCHAR(255) NOT NULL,
    chemin_fichier VARCHAR(500) NOT NULL,
    chemin_thumbnail VARCHAR(500) NULL,
    
    taille_octets BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    
    description TEXT NULL,
    est_preuve BOOLEAN NOT NULL DEFAULT FALSE,
    ordre INT NOT NULL DEFAULT 0,
    
    uploaded_by INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_incidents_medias_taille_check CHECK (taille_octets > 0 AND taille_octets <= 104857600),
    CONSTRAINT rso_incidents_medias_mime_type_check CHECK (
        mime_type IN (
            'image/jpeg', 'image/png', 'image/jpg',
            'video/mp4', 'video/quicktime',
            'audio/mpeg', 'audio/wav',
            'application/pdf'
        )
    )
);

-- =================================================================
-- TABLE: rso_incidents_historique
-- =================================================================

CREATE TABLE IF NOT EXISTS rso_incidents_historique (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id INT NOT NULL REFERENCES rso_incidents(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    
    action VARCHAR(50) NOT NULL CHECK (action IN (
        'creation',
        'modification',
        'changement_statut',
        'assignation',
        'ajout_media',
        'ajout_commentaire',
        'mesure_prise',
        'validation',
        'cloture'
    )),
    
    ancien_statut VARCHAR(30) NULL,
    nouveau_statut VARCHAR(30) NULL,
    
    commentaire TEXT NULL,
    donnees_modifiees JSONB NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_incidents_historique_statut_transition CHECK (
        (action = 'changement_statut' AND ancien_statut IS NOT NULL AND nouveau_statut IS NOT NULL)
        OR (action != 'changement_statut')
    )
);

-- =================================================================
-- TABLE: rso_incidents_commentaires
-- =================================================================

CREATE TABLE IF NOT EXISTS rso_incidents_commentaires (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id INT NOT NULL REFERENCES rso_incidents(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    
    commentaire TEXT NOT NULL,
    type_commentaire VARCHAR(30) NOT NULL DEFAULT 'general' CHECK (type_commentaire IN ('general', 'investigation', 'mesure', 'interne')),
    
    visible_agents_surete BOOLEAN NOT NULL DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    
    CONSTRAINT rso_incidents_commentaires_commentaire_length CHECK (
        LENGTH(TRIM(commentaire)) >= 1
    )
);

-- =================================================================
-- TABLE: rso_incidents_mesures
-- =================================================================

CREATE TABLE IF NOT EXISTS rso_incidents_mesures (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id INT NOT NULL REFERENCES rso_incidents(id) ON DELETE CASCADE,
    
    type_mesure VARCHAR(30) NOT NULL CHECK (type_mesure IN ('immediate', 'corrective', 'preventive')),
    description TEXT NOT NULL,
    
    responsable_id INT NULL REFERENCES rso_users(id) ON DELETE SET NULL,
    date_echeance DATE NULL,
    
    statut VARCHAR(30) NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee', 'en_cours', 'terminee', 'annulee')),
    date_realisation DATE NULL,
    
    cout_estime DECIMAL(10,2) NULL,
    cout_reel DECIMAL(10,2) NULL,
    
    efficacite VARCHAR(20) NULL CHECK (efficacite IN ('faible', 'moyenne', 'bonne', 'excellente')),
    commentaire_efficacite TEXT NULL,
    
    created_by INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_incidents_mesures_description_length CHECK (
        LENGTH(TRIM(description)) >= 10
    ),
    CONSTRAINT rso_incidents_mesures_date_realisation_after_creation CHECK (
        date_realisation IS NULL OR date_realisation >= DATE(created_at)
    ),
    CONSTRAINT rso_incidents_mesures_statut_terminee_requires_date CHECK (
        (statut = 'terminee' AND date_realisation IS NOT NULL)
        OR (statut != 'terminee')
    )
);

-- =================================================================
-- TABLE: rso_incidents_stats
-- =================================================================

CREATE TABLE IF NOT EXISTS rso_incidents_stats (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    date_stat DATE NOT NULL,
    installation_id INT NULL REFERENCES rso_installations(id) ON DELETE CASCADE,
    
    total_incidents INT NOT NULL DEFAULT 0,
    incidents_mineurs INT NOT NULL DEFAULT 0,
    incidents_moderes INT NOT NULL DEFAULT 0,
    incidents_graves INT NOT NULL DEFAULT 0,
    incidents_critiques INT NOT NULL DEFAULT 0,
    
    incidents_nouveaux INT NOT NULL DEFAULT 0,
    incidents_en_cours INT NOT NULL DEFAULT 0,
    incidents_resolus INT NOT NULL DEFAULT 0,
    incidents_clos INT NOT NULL DEFAULT 0,
    
    temps_moyen_resolution DECIMAL(10,2) NULL,
    
    cout_total DECIMAL(12,2) NOT NULL DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_incidents_stats_date_installation_unique UNIQUE (tenant_id, date_stat, installation_id),
    CONSTRAINT rso_incidents_stats_totals_check CHECK (
        total_incidents >= incidents_mineurs + incidents_moderes + incidents_graves + incidents_critiques
    )
);

-- =================================================================
-- INDEXES: rso_incidents
-- =================================================================

CREATE INDEX IF NOT EXISTS idx_rso_incidents_tenant_id ON rso_incidents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_code ON rso_incidents(code_incident);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_installation ON rso_incidents(installation_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_annee ON rso_incidents(annee_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_type ON rso_incidents(type_incident);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_statut ON rso_incidents(statut);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_date ON rso_incidents(date_incident);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_urgence ON rso_incidents(niveau_urgence);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_categorie ON rso_incidents(categorie);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_priorite ON rso_incidents(priorite);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_declare_par ON rso_incidents(declare_par);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_assigne_a ON rso_incidents(assigne_a);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_deleted_at ON rso_incidents(deleted_at) WHERE deleted_at IS NULL;

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_rso_incidents_recherche ON rso_incidents USING GIN(
    to_tsvector('french', 
        COALESCE(titre, '') || ' ' || 
        COALESCE(description_courte, '') || ' ' || 
        COALESCE(description_detaillee, '')
    )
);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_rso_incidents_installation_statut ON rso_incidents(installation_id, statut);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_statut_urgence ON rso_incidents(statut, niveau_urgence);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_date_statut ON rso_incidents(date_incident DESC, statut);

-- =================================================================
-- INDEXES: rso_incidents_medias
-- =================================================================

CREATE INDEX IF NOT EXISTS idx_rso_incidents_medias_tenant_id ON rso_incidents_medias(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_medias_incident ON rso_incidents_medias(incident_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_medias_type ON rso_incidents_medias(type_media);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_medias_uploaded_by ON rso_incidents_medias(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_medias_ordre ON rso_incidents_medias(incident_id, ordre);

-- =================================================================
-- INDEXES: rso_incidents_historique
-- =================================================================

CREATE INDEX IF NOT EXISTS idx_rso_incidents_historique_tenant_id ON rso_incidents_historique(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_historique_incident ON rso_incidents_historique(incident_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_historique_action ON rso_incidents_historique(action);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_historique_user ON rso_incidents_historique(user_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_historique_created_at ON rso_incidents_historique(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_historique_incident_created ON rso_incidents_historique(incident_id, created_at DESC);

-- =================================================================
-- INDEXES: rso_incidents_commentaires
-- =================================================================

CREATE INDEX IF NOT EXISTS idx_rso_incidents_commentaires_tenant_id ON rso_incidents_commentaires(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_commentaires_incident ON rso_incidents_commentaires(incident_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_commentaires_user ON rso_incidents_commentaires(user_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_commentaires_type ON rso_incidents_commentaires(type_commentaire);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_commentaires_deleted_at ON rso_incidents_commentaires(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rso_incidents_commentaires_incident_created ON rso_incidents_commentaires(incident_id, created_at DESC);

-- =================================================================
-- INDEXES: rso_incidents_mesures
-- =================================================================

CREATE INDEX IF NOT EXISTS idx_rso_incidents_mesures_tenant_id ON rso_incidents_mesures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_mesures_incident ON rso_incidents_mesures(incident_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_mesures_type ON rso_incidents_mesures(type_mesure);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_mesures_statut ON rso_incidents_mesures(statut);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_mesures_responsable ON rso_incidents_mesures(responsable_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_mesures_date_echeance ON rso_incidents_mesures(date_echeance) WHERE date_echeance IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rso_incidents_mesures_incident_type ON rso_incidents_mesures(incident_id, type_mesure);

-- =================================================================
-- INDEXES: rso_incidents_stats
-- =================================================================

CREATE INDEX IF NOT EXISTS idx_rso_incidents_stats_tenant_id ON rso_incidents_stats(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_stats_date ON rso_incidents_stats(date_stat);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_stats_installation ON rso_incidents_stats(installation_id);
CREATE INDEX IF NOT EXISTS idx_rso_incidents_stats_date_installation ON rso_incidents_stats(date_stat, installation_id);

-- =================================================================
-- TRIGGERS: Auto-update updated_at timestamps
-- =================================================================

-- Function for rso_incidents
CREATE OR REPLACE FUNCTION update_rso_incidents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rso_incidents_updated_at ON rso_incidents;
CREATE TRIGGER trigger_rso_incidents_updated_at
    BEFORE UPDATE ON rso_incidents
    FOR EACH ROW
    EXECUTE FUNCTION update_rso_incidents_updated_at();

-- Function for rso_incidents_commentaires
CREATE OR REPLACE FUNCTION update_rso_incidents_commentaires_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rso_incidents_commentaires_updated_at ON rso_incidents_commentaires;
CREATE TRIGGER trigger_rso_incidents_commentaires_updated_at
    BEFORE UPDATE ON rso_incidents_commentaires
    FOR EACH ROW
    EXECUTE FUNCTION update_rso_incidents_commentaires_updated_at();

-- Function for rso_incidents_mesures
CREATE OR REPLACE FUNCTION update_rso_incidents_mesures_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rso_incidents_mesures_updated_at ON rso_incidents_mesures;
CREATE TRIGGER trigger_rso_incidents_mesures_updated_at
    BEFORE UPDATE ON rso_incidents_mesures
    FOR EACH ROW
    EXECUTE FUNCTION update_rso_incidents_mesures_updated_at();

-- =================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =================================================================

-- Enable RLS on all incident tables
ALTER TABLE rso_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_incidents_medias ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_incidents_historique ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_incidents_commentaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_incidents_mesures ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_incidents_stats ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS rso_incidents_tenant_isolation ON rso_incidents;
DROP POLICY IF EXISTS rso_incidents_medias_tenant_isolation ON rso_incidents_medias;
DROP POLICY IF EXISTS rso_incidents_historique_tenant_isolation ON rso_incidents_historique;
DROP POLICY IF EXISTS rso_incidents_commentaires_tenant_isolation ON rso_incidents_commentaires;
DROP POLICY IF EXISTS rso_incidents_mesures_tenant_isolation ON rso_incidents_mesures;
DROP POLICY IF EXISTS rso_incidents_stats_tenant_isolation ON rso_incidents_stats;

-- RLS Policy: Incidents isolated by tenant
CREATE POLICY rso_incidents_tenant_isolation ON rso_incidents
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_installations
            WHERE rso_installations.id = rso_incidents.installation_id
            AND rso_installations.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- RLS Policy: Incident medias isolated by incident's tenant
CREATE POLICY rso_incidents_medias_tenant_isolation ON rso_incidents_medias
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_incidents
            JOIN rso_installations ON rso_installations.id = rso_incidents.installation_id
            WHERE rso_incidents.id = rso_incidents_medias.incident_id
            AND rso_installations.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- RLS Policy: Incident history isolated by incident's tenant
CREATE POLICY rso_incidents_historique_tenant_isolation ON rso_incidents_historique
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_incidents
            JOIN rso_installations ON rso_installations.id = rso_incidents.installation_id
            WHERE rso_incidents.id = rso_incidents_historique.incident_id
            AND rso_installations.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- RLS Policy: Incident comments isolated by incident's tenant
CREATE POLICY rso_incidents_commentaires_tenant_isolation ON rso_incidents_commentaires
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_incidents
            JOIN rso_installations ON rso_installations.id = rso_incidents.installation_id
            WHERE rso_incidents.id = rso_incidents_commentaires.incident_id
            AND rso_installations.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- RLS Policy: Incident measures isolated by incident's tenant
CREATE POLICY rso_incidents_mesures_tenant_isolation ON rso_incidents_mesures
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_incidents
            JOIN rso_installations ON rso_installations.id = rso_incidents.installation_id
            WHERE rso_incidents.id = rso_incidents_mesures.incident_id
            AND rso_installations.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- RLS Policy: Incident statistics isolated by tenant
CREATE POLICY rso_incidents_stats_tenant_isolation ON rso_incidents_stats
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- =================================================================
-- COMMENTS: Table and column documentation
-- =================================================================

COMMENT ON TABLE rso_incidents IS 'Stores security incidents in port facilities';
COMMENT ON TABLE rso_incidents_medias IS 'Stores evidence files (photos, videos, documents) attached to incidents';
COMMENT ON TABLE rso_incidents_historique IS 'Maintains complete audit trail of all actions performed on incidents';
COMMENT ON TABLE rso_incidents_commentaires IS 'Stores comments and notes added to incidents by users';
COMMENT ON TABLE rso_incidents_mesures IS 'Tracks measures (immediate, corrective, preventive) taken for incidents';
COMMENT ON TABLE rso_incidents_stats IS 'Cached statistics for incidents, aggregated daily for performance';

