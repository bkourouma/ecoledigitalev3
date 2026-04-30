-- RSO Activities Table Migration
-- Creates rso_installations and rso_activities tables for activity management
-- Date: 2024-12-19

-- =================================================================
-- TABLE: rso_installations
-- =================================================================
CREATE TABLE IF NOT EXISTS rso_installations (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nom VARCHAR(200) NOT NULL,  -- e.g., "Port de commerce d'Abidjan"
    code VARCHAR(50) NOT NULL,  -- e.g., "ABJ-PORT"
    ville VARCHAR(100) NOT NULL,  -- e.g., "Abidjan"
    pays VARCHAR(100) NOT NULL DEFAULT 'Côte d''Ivoire',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_installations_tenant_code_unique UNIQUE (tenant_id, code)
);

-- Indexes for rso_installations
CREATE INDEX IF NOT EXISTS idx_rso_installations_tenant_id ON rso_installations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rso_installations_code ON rso_installations(code);

-- Trigger to update updated_at timestamp for rso_installations
CREATE OR REPLACE FUNCTION update_rso_installations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_rso_installations_updated_at
    BEFORE UPDATE ON rso_installations
    FOR EACH ROW
    EXECUTE FUNCTION update_rso_installations_updated_at();

-- Enable RLS on rso_installations
ALTER TABLE rso_installations ENABLE ROW LEVEL SECURITY;

-- RLS Policy for rso_installations
DROP POLICY IF EXISTS rso_installations_tenant_isolation ON rso_installations;
CREATE POLICY rso_installations_tenant_isolation ON rso_installations
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- =================================================================
-- TABLE: rso_activities
-- =================================================================
CREATE TABLE IF NOT EXISTS rso_activities (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    installation_id INT NOT NULL REFERENCES rso_installations(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,  -- e.g., 'inspection', 'drill', 'incident', 'maintenance', 'audit', 'training'
    titre VARCHAR(255) NOT NULL,
    description TEXT,
    date_activite TIMESTAMP WITH TIME ZONE NOT NULL,
    statut VARCHAR(20) NOT NULL DEFAULT 'planifie' CHECK (statut IN ('planifie', 'en_cours', 'termine', 'annule')),
    created_by INT NULL REFERENCES rso_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_activities_titre_not_empty CHECK (LENGTH(TRIM(titre)) > 0),
    CONSTRAINT rso_activities_type_not_empty CHECK (LENGTH(TRIM(type)) > 0)
);

-- Indexes for rso_activities
CREATE INDEX IF NOT EXISTS idx_rso_activities_tenant_id ON rso_activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rso_activities_installation_id ON rso_activities(installation_id);
CREATE INDEX IF NOT EXISTS idx_rso_activities_type ON rso_activities(type);
CREATE INDEX IF NOT EXISTS idx_rso_activities_statut ON rso_activities(statut);
CREATE INDEX IF NOT EXISTS idx_rso_activities_date_activite ON rso_activities(date_activite DESC);
CREATE INDEX IF NOT EXISTS idx_rso_activities_created_by ON rso_activities(created_by);
CREATE INDEX IF NOT EXISTS idx_rso_activities_created_at ON rso_activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rso_activities_tenant_installation_date ON rso_activities(tenant_id, installation_id, date_activite DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_rso_activities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_rso_activities_updated_at
    BEFORE UPDATE ON rso_activities
    FOR EACH ROW
    EXECUTE FUNCTION update_rso_activities_updated_at();

-- Enable RLS on rso_activities
ALTER TABLE rso_activities ENABLE ROW LEVEL SECURITY;

-- RLS Policy for rso_activities
DROP POLICY IF EXISTS rso_activities_tenant_isolation ON rso_activities;
CREATE POLICY rso_activities_tenant_isolation ON rso_activities
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Add activity management actions to activity log types
-- Note: These will be used in the activity logging service
-- Actions: 'create_activity', 'update_activity', 'delete_activity'

