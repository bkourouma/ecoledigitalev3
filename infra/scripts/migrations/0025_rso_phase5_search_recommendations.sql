-- RSO-PFSO Phase 5 Database Migration
-- Creates advanced search and recommendation management tables with Row Level Security (RLS) for tenant isolation
-- Date: 2025-01-27
-- Feature: Phase 5 - Recherche Avancée et Gestion des Recommandations

-- =================================================================
-- TABLE: rso_tags
-- =================================================================
CREATE TABLE IF NOT EXISTS rso_tags (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    nom VARCHAR(50) NOT NULL,
    slug VARCHAR(50) NOT NULL,
    description TEXT,
    couleur VARCHAR(7) NOT NULL DEFAULT '#3498db',
    icone VARCHAR(50),
    categorie VARCHAR(20) NOT NULL DEFAULT 'autre' CHECK (categorie IN ('theme', 'priorite', 'type_incident', 'equipement', 'zone', 'autre')),
    nb_utilisations INT NOT NULL DEFAULT 0 CHECK (nb_utilisations >= 0),
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_tags_nom_unique UNIQUE (nom),
    CONSTRAINT rso_tags_slug_unique UNIQUE (slug),
    CONSTRAINT rso_tags_couleur_format CHECK (couleur ~ '^#[0-9A-Fa-f]{6}$')
);

-- Indexes for rso_tags
CREATE INDEX IF NOT EXISTS idx_rso_tags_categorie ON rso_tags(categorie);
CREATE INDEX IF NOT EXISTS idx_rso_tags_actif ON rso_tags(actif);
CREATE INDEX IF NOT EXISTS idx_rso_tags_nb_utilisations ON rso_tags(nb_utilisations);

-- =================================================================
-- TABLE: rso_activites_tags
-- =================================================================
CREATE TABLE IF NOT EXISTS rso_activites_tags (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    activite_id INT NOT NULL REFERENCES rso_activites(id) ON DELETE CASCADE,
    tag_id INT NOT NULL REFERENCES rso_tags(id) ON DELETE CASCADE,
    ajout_par INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    ajout_le TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_activites_tags_unique UNIQUE (activite_id, tag_id)
);

-- Indexes for rso_activites_tags
CREATE INDEX IF NOT EXISTS idx_rso_activites_tags_activite ON rso_activites_tags(activite_id);
CREATE INDEX IF NOT EXISTS idx_rso_activites_tags_tag ON rso_activites_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_rso_activites_tags_ajout_par ON rso_activites_tags(ajout_par);

-- =================================================================
-- TABLE: rso_recherches_enregistrees
-- =================================================================
CREATE TABLE IF NOT EXISTS rso_recherches_enregistrees (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE CASCADE,
    nom VARCHAR(100) NOT NULL,
    description TEXT,
    criteres JSONB NOT NULL,
    notification_active BOOLEAN NOT NULL DEFAULT FALSE,
    frequence_notification VARCHAR(20) NOT NULL DEFAULT 'quotidien' CHECK (frequence_notification IN ('immediate', 'quotidien', 'hebdomadaire')),
    derniere_notification TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Indexes for rso_recherches_enregistrees
CREATE INDEX IF NOT EXISTS idx_rso_recherches_enregistrees_user ON rso_recherches_enregistrees(user_id);
CREATE INDEX IF NOT EXISTS idx_rso_recherches_enregistrees_notification ON rso_recherches_enregistrees(notification_active, frequence_notification) WHERE notification_active = TRUE;

-- =================================================================
-- TABLE: rso_notifications
-- =================================================================
CREATE TABLE IF NOT EXISTS rso_notifications (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('recommandation_nouvelle', 'recommandation_echeance', 'recommandation_retard', 'activite_nouvelle', 'activite_modifiee', 'commentaire', 'validation', 'autre')),
    titre VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    entite_type VARCHAR(50),
    entite_id INT,
    url VARCHAR(500),
    lue BOOLEAN NOT NULL DEFAULT FALSE,
    lue_le TIMESTAMP WITH TIME ZONE,
    priorite VARCHAR(20) NOT NULL DEFAULT 'normale' CHECK (priorite IN ('basse', 'normale', 'haute', 'urgente')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expire_le TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT rso_notifications_titre_length CHECK (LENGTH(TRIM(titre)) > 0),
    CONSTRAINT rso_notifications_message_length CHECK (LENGTH(TRIM(message)) > 0)
);

-- Indexes for rso_notifications
CREATE INDEX IF NOT EXISTS idx_rso_notifications_user_lue ON rso_notifications(user_id, lue);
CREATE INDEX IF NOT EXISTS idx_rso_notifications_type ON rso_notifications(type);
CREATE INDEX IF NOT EXISTS idx_rso_notifications_priorite ON rso_notifications(priorite);
CREATE INDEX IF NOT EXISTS idx_rso_notifications_created_at ON rso_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_rso_notifications_expire_le ON rso_notifications(expire_le) WHERE expire_le IS NOT NULL;

-- =================================================================
-- TABLE: rso_rapports_planifies
-- =================================================================
CREATE TABLE IF NOT EXISTS rso_rapports_planifies (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE CASCADE,
    nom VARCHAR(100) NOT NULL,
    description TEXT,
    type_rapport VARCHAR(20) NOT NULL CHECK (type_rapport IN ('activites', 'recommandations', 'statistiques', 'personnalise')),
    parametres JSONB NOT NULL,
    frequence VARCHAR(20) NOT NULL CHECK (frequence IN ('quotidien', 'hebdomadaire', 'mensuel', 'trimestriel')),
    jour_semaine INT CHECK (jour_semaine IS NULL OR (jour_semaine >= 1 AND jour_semaine <= 7)),
    jour_mois INT CHECK (jour_mois IS NULL OR (jour_mois >= 1 AND jour_mois <= 31)),
    heure TIME NOT NULL DEFAULT '08:00:00',
    format VARCHAR(10) NOT NULL CHECK (format IN ('pdf', 'excel', 'csv', 'email')),
    email_destinataires TEXT, -- JSON array stored as text
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    derniere_execution TIMESTAMP WITH TIME ZONE,
    prochaine_execution TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_rapports_planifies_jour_semaine_check CHECK (
        frequence != 'hebdomadaire' OR jour_semaine IS NOT NULL
    ),
    CONSTRAINT rso_rapports_planifies_jour_mois_check CHECK (
        frequence NOT IN ('mensuel', 'trimestriel') OR jour_mois IS NOT NULL
    )
);

-- Indexes for rso_rapports_planifies
CREATE INDEX IF NOT EXISTS idx_rso_rapports_planifies_user ON rso_rapports_planifies(user_id);
CREATE INDEX IF NOT EXISTS idx_rso_rapports_planifies_prochaine_execution ON rso_rapports_planifies(prochaine_execution, actif) WHERE actif = TRUE AND prochaine_execution IS NOT NULL;

-- =================================================================
-- TABLE: rso_recommandations_historique
-- =================================================================
CREATE TABLE IF NOT EXISTS rso_recommandations_historique (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    recommandation_id INT NOT NULL REFERENCES rso_recommandations(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    action VARCHAR(30) NOT NULL CHECK (action IN ('creation', 'modification', 'changement_statut', 'commentaire', 'validation', 'cloture')),
    ancien_statut VARCHAR(50),
    nouveau_statut VARCHAR(50),
    commentaire TEXT,
    donnees_modifiees JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_recommandations_historique_statut_check CHECK (
        action != 'changement_statut' OR (ancien_statut IS NOT NULL AND nouveau_statut IS NOT NULL)
    )
);

-- Indexes for rso_recommandations_historique
CREATE INDEX IF NOT EXISTS idx_rso_recommandations_historique_recommandation ON rso_recommandations_historique(recommandation_id);
CREATE INDEX IF NOT EXISTS idx_rso_recommandations_historique_action ON rso_recommandations_historique(action);
CREATE INDEX IF NOT EXISTS idx_rso_recommandations_historique_created_at ON rso_recommandations_historique(created_at);

-- =================================================================
-- ENHANCE: rso_recommandations table (add new columns)
-- =================================================================
ALTER TABLE rso_recommandations 
    ADD COLUMN IF NOT EXISTS categorie VARCHAR(50),
    ADD COLUMN IF NOT EXISTS impact VARCHAR(20) NOT NULL DEFAULT 'moyen' CHECK (impact IN ('faible', 'moyen', 'eleve', 'critique')),
    ADD COLUMN IF NOT EXISTS cout_estime DECIMAL(10,2) CHECK (cout_estime IS NULL OR cout_estime >= 0),
    ADD COLUMN IF NOT EXISTS delai_jours INT CHECK (delai_jours IS NULL OR delai_jours > 0),
    ADD COLUMN IF NOT EXISTS piece_jointe VARCHAR(500),
    ADD COLUMN IF NOT EXISTS validation_requise BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS validee_par INT REFERENCES rso_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS date_validation TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS commentaire_validation TEXT;

-- New indexes for enhanced rso_recommandations
CREATE INDEX IF NOT EXISTS idx_rso_recommandations_impact ON rso_recommandations(impact);
CREATE INDEX IF NOT EXISTS idx_rso_recommandations_validation_requise ON rso_recommandations(validation_requise);
CREATE INDEX IF NOT EXISTS idx_rso_recommandations_date_echeance ON rso_recommandations(date_echeance) WHERE date_echeance IS NOT NULL;

-- =================================================================
-- FULL-TEXT SEARCH INDEXES
-- =================================================================

-- Full-text search index on activities (using GIN with French language)
CREATE INDEX IF NOT EXISTS idx_activites_recherche ON rso_activites 
    USING GIN (to_tsvector('french', COALESCE(titre, '') || ' ' || COALESCE(contenu_texte, '')));

-- Full-text search index on recommendations (using GIN with French language)
CREATE INDEX IF NOT EXISTS idx_recommandations_recherche ON rso_recommandations 
    USING GIN (to_tsvector('french', COALESCE(titre, '') || ' ' || COALESCE(description, '')));

-- =================================================================
-- TRIGGERS: Auto-update updated_at timestamps
-- =================================================================

-- Trigger for rso_recherches_enregistrees
CREATE OR REPLACE FUNCTION update_rso_recherches_enregistrees_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rso_recherches_enregistrees_updated_at ON rso_recherches_enregistrees;
CREATE TRIGGER trigger_rso_recherches_enregistrees_updated_at
    BEFORE UPDATE ON rso_recherches_enregistrees
    FOR EACH ROW
    EXECUTE FUNCTION update_rso_recherches_enregistrees_updated_at();

-- Trigger for rso_rapports_planifies
CREATE OR REPLACE FUNCTION update_rso_rapports_planifies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rso_rapports_planifies_updated_at ON rso_rapports_planifies;
CREATE TRIGGER trigger_rso_rapports_planifies_updated_at
    BEFORE UPDATE ON rso_rapports_planifies
    FOR EACH ROW
    EXECUTE FUNCTION update_rso_rapports_planifies_updated_at();

-- Trigger to update notification read timestamp
CREATE OR REPLACE FUNCTION update_rso_notifications_lue_le()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.lue = TRUE AND OLD.lue = FALSE THEN
        NEW.lue_le = CURRENT_TIMESTAMP;
    ELSIF NEW.lue = FALSE THEN
        NEW.lue_le = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rso_notifications_lue_le ON rso_notifications;
CREATE TRIGGER trigger_rso_notifications_lue_le
    BEFORE UPDATE ON rso_notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_rso_notifications_lue_le();

-- Trigger to set notification expiration (30 days default)
CREATE OR REPLACE FUNCTION set_rso_notifications_expire_le()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.expire_le IS NULL THEN
        NEW.expire_le = NEW.created_at + INTERVAL '30 days';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rso_notifications_expire_le ON rso_notifications;
CREATE TRIGGER trigger_rso_notifications_expire_le
    BEFORE INSERT ON rso_notifications
    FOR EACH ROW
    EXECUTE FUNCTION set_rso_notifications_expire_le();

-- Trigger to update tag usage count when tag is associated with activity
CREATE OR REPLACE FUNCTION increment_tag_usage()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE rso_tags 
    SET nb_utilisations = nb_utilisations + 1 
    WHERE id = NEW.tag_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_increment_tag_usage ON rso_activites_tags;
CREATE TRIGGER trigger_increment_tag_usage
    AFTER INSERT ON rso_activites_tags
    FOR EACH ROW
    EXECUTE FUNCTION increment_tag_usage();

-- Trigger to decrement tag usage count when tag is removed from activity
CREATE OR REPLACE FUNCTION decrement_tag_usage()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE rso_tags 
    SET nb_utilisations = GREATEST(0, nb_utilisations - 1) 
    WHERE id = OLD.tag_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_decrement_tag_usage ON rso_activites_tags;
CREATE TRIGGER trigger_decrement_tag_usage
    AFTER DELETE ON rso_activites_tags
    FOR EACH ROW
    EXECUTE FUNCTION decrement_tag_usage();

-- =================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =================================================================

-- Enable RLS on all Phase 5 tables
ALTER TABLE rso_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_activites_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_recherches_enregistrees ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_rapports_planifies ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_recommandations_historique ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS rso_tags_tenant_isolation ON rso_tags;
DROP POLICY IF EXISTS rso_activites_tags_tenant_isolation ON rso_activites_tags;
DROP POLICY IF EXISTS rso_recherches_enregistrees_tenant_isolation ON rso_recherches_enregistrees;
DROP POLICY IF EXISTS rso_notifications_tenant_isolation ON rso_notifications;
DROP POLICY IF EXISTS rso_rapports_planifies_tenant_isolation ON rso_rapports_planifies;
DROP POLICY IF EXISTS rso_recommandations_historique_tenant_isolation ON rso_recommandations_historique;

-- RLS Policy: Tags are shared within tenant (ASPCI tenant only, enforced via application logic)
CREATE POLICY rso_tags_tenant_isolation ON rso_tags
    FOR ALL
    USING (TRUE); -- Tags are shared within tenant, isolation enforced at application level

-- RLS Policy: Activity-tag associations isolated by activity's tenant
CREATE POLICY rso_activites_tags_tenant_isolation ON rso_activites_tags
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_activites
            JOIN rso_installations ON rso_installations.id = rso_activites.installation_id
            WHERE rso_activites.id = rso_activites_tags.activite_id
            AND rso_installations.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- RLS Policy: Saved searches isolated by user's tenant
CREATE POLICY rso_recherches_enregistrees_tenant_isolation ON rso_recherches_enregistrees
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_users
            WHERE rso_users.id = rso_recherches_enregistrees.user_id
            AND rso_users.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- RLS Policy: Notifications isolated by user's tenant
CREATE POLICY rso_notifications_tenant_isolation ON rso_notifications
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_users
            WHERE rso_users.id = rso_notifications.user_id
            AND rso_users.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- RLS Policy: Scheduled reports isolated by user's tenant
CREATE POLICY rso_rapports_planifies_tenant_isolation ON rso_rapports_planifies
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_users
            WHERE rso_users.id = rso_rapports_planifies.user_id
            AND rso_users.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- RLS Policy: Recommendation history isolated by recommendation's tenant
CREATE POLICY rso_recommandations_historique_tenant_isolation ON rso_recommandations_historique
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_recommandations
            JOIN rso_activites ON rso_activites.id = rso_recommandations.activite_id
            JOIN rso_installations ON rso_installations.id = rso_activites.installation_id
            WHERE rso_recommandations.id = rso_recommandations_historique.recommandation_id
            AND rso_installations.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- =================================================================
-- COMMENTS
-- =================================================================

COMMENT ON TABLE rso_tags IS 'Tags (keywords/labels) used to categorize activities, organized by categories';
COMMENT ON TABLE rso_activites_tags IS 'Junction table linking activities to tags (many-to-many relationship)';
COMMENT ON TABLE rso_recherches_enregistrees IS 'User saved search criteria for future reuse and automated alerts';
COMMENT ON TABLE rso_notifications IS 'Notifications for users about important events (deadlines, assignments, etc.)';
COMMENT ON TABLE rso_rapports_planifies IS 'Scheduled report configurations that execute automatically at specified intervals';
COMMENT ON TABLE rso_recommandations_historique IS 'Audit trail tracking all changes and events related to recommendations';

COMMENT ON COLUMN rso_tags.slug IS 'URL-friendly identifier (lowercase, hyphens, no spaces)';
COMMENT ON COLUMN rso_tags.nb_utilisations IS 'Usage count (number of activities using this tag)';
COMMENT ON COLUMN rso_tags.actif IS 'Active status (inactive tags do not appear in selection)';
COMMENT ON COLUMN rso_recherches_enregistrees.criteres IS 'Search criteria stored as JSON (query, filters, sort)';
COMMENT ON COLUMN rso_recherches_enregistrees.notification_active IS 'Whether automated alerts are enabled for this saved search';
COMMENT ON COLUMN rso_notifications.expire_le IS 'Expiration timestamp (auto-cleanup after 30 days if not set)';
COMMENT ON COLUMN rso_rapports_planifies.prochaine_execution IS 'Next execution timestamp (calculated automatically based on frequency)';
COMMENT ON COLUMN rso_recommandations_historique.donnees_modifiees IS 'Modified data stored as JSON for detailed change tracking';

COMMENT ON COLUMN rso_recommandations.impact IS 'Impact level: faible, moyen, eleve, critique';
COMMENT ON COLUMN rso_recommandations.cout_estime IS 'Estimated cost in FCFA';
COMMENT ON COLUMN rso_recommandations.delai_jours IS 'Estimated duration in days';
COMMENT ON COLUMN rso_recommandations.validation_requise IS 'Whether validation is required before closure';

