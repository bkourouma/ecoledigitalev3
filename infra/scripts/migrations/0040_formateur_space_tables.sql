-- EcoleDigitale Database Schema Migration 0040
-- Description: Create trainer space (Espace Formateurs) tables and schema updates
-- Date: 2025-11-20
-- Dependencies: 
--   - 0037_imhotep_data_professional_training.sql (formateurs, sessions_professionnelles, inscriptions_professionnelles, supports_cours tables)
--
-- This migration creates:
--   - session_attendance table for learner attendance tracking
--   - support_session_associations table for many-to-many material-session relationships
--   - support_telechargements table for download tracking
--   - formateur_indisponibilites table for trainer unavailability periods
--   - notifications_formateurs table for trainer notifications
--   - Updates sessions_professionnelles with notes_formateur and notes_updated_at columns
--   - Row Level Security (RLS) policies for multi-tenant isolation
--   - Indexes for query performance
--   - Triggers for updated_at timestamps

BEGIN;

-- ============================================================================
-- Create session_attendance table
-- ============================================================================

CREATE TABLE IF NOT EXISTS session_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions_professionnelles(id) ON DELETE CASCADE,
    inscription_id UUID NOT NULL REFERENCES inscriptions_professionnelles(id) ON DELETE CASCADE,
    present BOOLEAN NOT NULL,
    marked_by UUID NOT NULL REFERENCES formateurs(id) ON DELETE RESTRICT,
    marked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_session_inscription UNIQUE(tenant_id, session_id, inscription_id)
);

-- Enable Row Level Security
ALTER TABLE session_attendance ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY session_attendance_tenant_policy ON session_attendance
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_session_attendance_tenant_id 
    ON session_attendance(tenant_id);

CREATE INDEX IF NOT EXISTS idx_session_attendance_session_id 
    ON session_attendance(session_id);

CREATE INDEX IF NOT EXISTS idx_session_attendance_inscription_id 
    ON session_attendance(inscription_id);

CREATE INDEX IF NOT EXISTS idx_session_attendance_marked_by 
    ON session_attendance(marked_by);

-- Add comments for documentation
COMMENT ON TABLE session_attendance IS 'Learner attendance records for training sessions';
COMMENT ON COLUMN session_attendance.present IS 'Attendance status: true = present, false = absent';
COMMENT ON COLUMN session_attendance.marked_by IS 'Trainer who marked the attendance';
COMMENT ON COLUMN session_attendance.marked_at IS 'Timestamp when attendance was marked';

-- ============================================================================
-- Create support_session_associations table
-- ============================================================================

CREATE TABLE IF NOT EXISTS support_session_associations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    support_id UUID NOT NULL REFERENCES supports_cours(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions_professionnelles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_support_session UNIQUE(tenant_id, support_id, session_id)
);

-- Enable Row Level Security
ALTER TABLE support_session_associations ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY support_session_assoc_tenant_policy ON support_session_associations
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_support_session_assoc_tenant_id 
    ON support_session_associations(tenant_id);

CREATE INDEX IF NOT EXISTS idx_support_session_assoc_support_id 
    ON support_session_associations(support_id);

CREATE INDEX IF NOT EXISTS idx_support_session_assoc_session_id 
    ON support_session_associations(session_id);

-- Add comment for documentation
COMMENT ON TABLE support_session_associations IS 'Many-to-many relationship between course materials and sessions';

-- ============================================================================
-- Create support_telechargements table
-- ============================================================================

CREATE TABLE IF NOT EXISTS support_telechargements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    support_id UUID NOT NULL REFERENCES supports_cours(id) ON DELETE CASCADE,
    apprenant_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id UUID REFERENCES sessions_professionnelles(id) ON DELETE SET NULL,
    downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE support_telechargements ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY support_telechargements_tenant_policy ON support_telechargements
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_support_telechargements_tenant_id 
    ON support_telechargements(tenant_id);

CREATE INDEX IF NOT EXISTS idx_support_telechargements_support_id 
    ON support_telechargements(support_id);

CREATE INDEX IF NOT EXISTS idx_support_telechargements_apprenant_id 
    ON support_telechargements(apprenant_id);

CREATE INDEX IF NOT EXISTS idx_support_telechargements_session_id 
    ON support_telechargements(session_id);

CREATE INDEX IF NOT EXISTS idx_support_telechargements_downloaded_at 
    ON support_telechargements(downloaded_at);

-- Add comment for documentation
COMMENT ON TABLE support_telechargements IS 'Track course material downloads for statistics';

-- ============================================================================
-- Create formateur_indisponibilites table
-- ============================================================================

CREATE TABLE IF NOT EXISTS formateur_indisponibilites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    formateur_id UUID NOT NULL REFERENCES formateurs(id) ON DELETE CASCADE,
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    raison TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT check_date_fin_after_debut CHECK(date_fin >= date_debut)
);

-- Enable Row Level Security
ALTER TABLE formateur_indisponibilites ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY formateur_indispo_tenant_policy ON formateur_indisponibilites
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_formateur_indispo_tenant_id 
    ON formateur_indisponibilites(tenant_id);

CREATE INDEX IF NOT EXISTS idx_formateur_indispo_formateur_id 
    ON formateur_indisponibilites(formateur_id);

CREATE INDEX IF NOT EXISTS idx_formateur_indispo_dates 
    ON formateur_indisponibilites(tenant_id, formateur_id, date_debut, date_fin);

-- Add comment for documentation
COMMENT ON TABLE formateur_indisponibilites IS 'Periods when trainers are unavailable';

-- ============================================================================
-- Create notifications_formateurs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications_formateurs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    formateur_id UUID NOT NULL REFERENCES formateurs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    titre VARCHAR(255) NOT NULL,
    message TEXT,
    metadata JSONB,
    lue BOOLEAN DEFAULT false,
    lue_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE notifications_formateurs ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY notifications_formateurs_tenant_policy ON notifications_formateurs
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_tenant_id 
    ON notifications_formateurs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_formateur_id 
    ON notifications_formateurs(formateur_id);

CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_lue 
    ON notifications_formateurs(tenant_id, formateur_id, lue);

CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_created_at 
    ON notifications_formateurs(tenant_id, formateur_id, created_at DESC);

-- Add comment for documentation
COMMENT ON TABLE notifications_formateurs IS 'In-app notifications for trainers';
COMMENT ON COLUMN notifications_formateurs.type IS 'Notification type: nouvelle_inscription, session_modifiee, session_annulee, message_admin, rappel_session';

-- ============================================================================
-- Update sessions_professionnelles table
-- ============================================================================

-- Add notes_formateur and notes_updated_at columns
ALTER TABLE sessions_professionnelles
    ADD COLUMN IF NOT EXISTS notes_formateur TEXT,
    ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMP WITH TIME ZONE;

-- Add comments for documentation
COMMENT ON COLUMN sessions_professionnelles.notes_formateur IS 'Private notes added by trainers for their own reference';
COMMENT ON COLUMN sessions_professionnelles.notes_updated_at IS 'Last timestamp when trainer notes were updated';

-- ============================================================================
-- Create triggers for updated_at timestamps
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for session_attendance
DROP TRIGGER IF EXISTS trigger_update_session_attendance_updated_at ON session_attendance;
CREATE TRIGGER trigger_update_session_attendance_updated_at
    BEFORE UPDATE ON session_attendance
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for supports_cours (if not already exists)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'trigger_update_supports_cours_updated_at'
    ) THEN
        CREATE TRIGGER trigger_update_supports_cours_updated_at
            BEFORE UPDATE ON supports_cours
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMIT;

