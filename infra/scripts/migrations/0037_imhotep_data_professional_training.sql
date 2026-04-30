-- EcoleDigitale Database Schema Migration 0037
-- Description: Create Imhotep Data professional training module schema
-- Date: 2025-01-27
-- Dependencies: 
--   - 0001_init.sql (tenants, users tables)
--   - 0002_academic.sql (delivery_mode ENUM type - reused)
--
-- This migration creates the complete database schema for the Imhotep Data
-- professional training module, including:
--   - 9 new tables for professional training management
--   - 6 new ENUM types for status and configuration fields
--   - Row Level Security (RLS) policies for multi-tenant isolation
--   - Indexes for query performance
--   - Triggers for audit trails and auto-generated fields
--
-- All tables follow the existing multi-tenant pattern with tenant_id foreign keys
-- and RLS policies to ensure complete data isolation between tenants.

BEGIN;

-- ============================================================================
-- Phase 2: Foundational - ENUM Types & Base Infrastructure
-- ============================================================================

-- Create ENUM types for professional training module
-- Note: delivery_mode ENUM is reused from migration 0002_academic.sql

-- Session status ENUM
DO $$ BEGIN
    CREATE TYPE session_professional_status AS ENUM (
        'planifiee',    -- Session is planned but not yet open for enrollment
        'ouverte',      -- Session is open for enrollment
        'complete',     -- Session is full (no more places available)
        'en_cours',     -- Session is currently in progress
        'terminee',     -- Session has been completed
        'annulee'       -- Session has been cancelled
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Enrollment type ENUM
DO $$ BEGIN
    CREATE TYPE enrollment_type AS ENUM (
        'individuelle', -- Individual enrollment
        'entreprise'    -- Company/enterprise enrollment
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Enrollment status ENUM
DO $$ BEGIN
    CREATE TYPE enrollment_professional_status AS ENUM (
        'en_attente',   -- Enrollment is pending confirmation
        'confirmee',    -- Enrollment is confirmed
        'annulee',      -- Enrollment has been cancelled
        'terminee'      -- Enrollment is completed (training finished)
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Promotional code reduction type ENUM
DO $$ BEGIN
    CREATE TYPE promo_code_reduction_type AS ENUM (
        'pourcentage',  -- Percentage discount (e.g., 10%)
        'montant_fixe'  -- Fixed amount discount (e.g., 50 EUR)
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Payment method ENUM
DO $$ BEGIN
    CREATE TYPE payment_method AS ENUM (
        'orange_money',     -- Orange Money mobile payment
        'mtn_money',        -- MTN Money mobile payment
        'wave',             -- Wave mobile payment
        'carte_bancaire',   -- Bank card payment
        'tresorpay',        -- TresorPay payment
        'virement',         -- Bank transfer
        'cheque'            -- Check payment
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Payment status ENUM
DO $$ BEGIN
    CREATE TYPE payment_professional_status AS ENUM (
        'en_attente',   -- Payment is pending
        'valide',       -- Payment has been validated
        'echoue',       -- Payment has failed
        'rembourse',    -- Payment has been refunded
        'annule'        -- Payment has been cancelled
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Verify delivery_mode ENUM exists (reused from migration 0002_academic.sql)
-- This ENUM is used in sessions_professionnelles.mode_formation
-- Values: 'presential', 'remote', 'hybrid', 'elearning'
-- If this check fails, ensure migration 0002_academic.sql has been applied
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_mode') THEN
        RAISE EXCEPTION 'delivery_mode ENUM type not found. Please ensure migration 0002_academic.sql has been applied.';
    END IF;
END $$;

-- ============================================================================
-- Phase 3: User Story 1 - Professional Training Catalog Management
-- ============================================================================

-- Create formations_professionnelles table (Professional training program catalog)
CREATE TABLE IF NOT EXISTS formations_professionnelles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    titre VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    description_courte TEXT,
    description_complete TEXT,
    objectifs JSONB,
    programme_detaille JSONB,
    prerequis TEXT,
    public_cible TEXT,
    duree_jours INTEGER,
    duree_heures INTEGER,
    prix_ht DECIMAL(10,2),
    prix_ttc DECIMAL(10,2),
    type_certification VARCHAR(100),
    nom_certification VARCHAR(255),
    brochure_pdf_url VARCHAR(500),
    themes JSONB,
    niveau VARCHAR(50),
    actif BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, slug),
    CHECK(duree_jours > 0 OR duree_heures > 0),
    CHECK(prix_ht >= 0 AND prix_ttc >= 0)
);

-- Create indexes for formations_professionnelles
CREATE INDEX IF NOT EXISTS idx_formations_professionnelles_tenant_id 
    ON formations_professionnelles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_formations_professionnelles_slug 
    ON formations_professionnelles(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_formations_professionnelles_actif 
    ON formations_professionnelles(tenant_id, actif);
CREATE INDEX IF NOT EXISTS idx_formations_professionnelles_themes 
    ON formations_professionnelles USING GIN(themes);

-- Enable Row Level Security for formations_professionnelles
ALTER TABLE formations_professionnelles ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for formations_professionnelles
DROP POLICY IF EXISTS formations_professionnelles_tenant_policy ON formations_professionnelles;
CREATE POLICY formations_professionnelles_tenant_policy ON formations_professionnelles
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_formations_professionnelles_updated_at ON formations_professionnelles;
CREATE TRIGGER update_formations_professionnelles_updated_at 
    BEFORE UPDATE ON formations_professionnelles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE formations_professionnelles IS 'Professional training program catalog';

-- ============================================================================
-- Phase 4: User Story 2 - Training Session Scheduling
-- ============================================================================

-- Create sessions_professionnelles table (Scheduled training sessions)
CREATE TABLE IF NOT EXISTS sessions_professionnelles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    formation_pro_id UUID NOT NULL REFERENCES formations_professionnelles(id) ON DELETE CASCADE,
    code_session VARCHAR(50),
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    horaires VARCHAR(100),
    mode_formation delivery_mode NOT NULL,
    lieu VARCHAR(500),
    lien_visio VARCHAR(500),
    places_totales INTEGER NOT NULL,
    places_reservees INTEGER DEFAULT 0,
    places_disponibles INTEGER GENERATED ALWAYS AS (places_totales - places_reservees) STORED,
    prix_ht DECIMAL(10,2),
    prix_ttc DECIMAL(10,2),
    statut session_professional_status DEFAULT 'planifiee',
    notes_internes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, code_session),
    CHECK(date_fin >= date_debut),
    CHECK(places_totales > 0),
    CHECK(places_reservees >= 0 AND places_reservees <= places_totales)
);

-- Create indexes for sessions_professionnelles
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_tenant_id 
    ON sessions_professionnelles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_formation_pro_id 
    ON sessions_professionnelles(formation_pro_id);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_code_session 
    ON sessions_professionnelles(tenant_id, code_session);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_statut 
    ON sessions_professionnelles(tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_date_debut 
    ON sessions_professionnelles(tenant_id, date_debut);

-- Enable Row Level Security for sessions_professionnelles
ALTER TABLE sessions_professionnelles ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for sessions_professionnelles
DROP POLICY IF EXISTS sessions_professionnelles_tenant_policy ON sessions_professionnelles;
CREATE POLICY sessions_professionnelles_tenant_policy ON sessions_professionnelles
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_sessions_professionnelles_updated_at ON sessions_professionnelles;
CREATE TRIGGER update_sessions_professionnelles_updated_at 
    BEFORE UPDATE ON sessions_professionnelles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to auto-generate session code
CREATE OR REPLACE FUNCTION generate_session_code(tenant_uuid UUID, formation_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    year_suffix VARCHAR(4);
    sequence_num INTEGER;
    session_code VARCHAR(50);
BEGIN
    -- Get current year suffix
    year_suffix := EXTRACT(YEAR FROM NOW())::TEXT;
    
    -- Get next sequence number for this tenant and year
    SELECT COALESCE(MAX(CAST(SUBSTRING(code_session FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM sessions_professionnelles 
    WHERE tenant_id = tenant_uuid 
    AND code_session LIKE 'DATA-' || year_suffix || '-%';
    
    -- Format: DATA-YYYY-NNN (e.g., DATA-2024-001)
    session_code := 'DATA-' || year_suffix || '-' || LPAD(sequence_num::TEXT, 3, '0');
    
    RETURN session_code;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to auto-generate session code if not provided
CREATE OR REPLACE FUNCTION set_session_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.code_session IS NULL OR NEW.code_session = '' THEN
        NEW.code_session := generate_session_code(NEW.tenant_id, NEW.formation_pro_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate session code
DROP TRIGGER IF EXISTS set_session_code_trigger ON sessions_professionnelles;
CREATE TRIGGER set_session_code_trigger
    BEFORE INSERT ON sessions_professionnelles
    FOR EACH ROW EXECUTE FUNCTION set_session_code();

-- Add table comment
COMMENT ON TABLE sessions_professionnelles IS 'Scheduled training sessions';

-- ============================================================================
-- Phase 5: User Story 3 - Trainer Management and Assignment
-- ============================================================================

-- Create formateurs table (Professional training instructors)
CREATE TABLE IF NOT EXISTS formateurs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    civilite VARCHAR(20),
    nom VARCHAR(100) NOT NULL,
    prenom VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    telephone VARCHAR(20),
    specialites JSONB,
    bio TEXT,
    cv_url VARCHAR(500),
    photo_url VARCHAR(500),
    linkedin_url VARCHAR(500),
    tarif_journalier DECIMAL(10,2),
    actif BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, email),
    CHECK(tarif_journalier >= 0 OR tarif_journalier IS NULL)
);

-- Create indexes for formateurs
CREATE INDEX IF NOT EXISTS idx_formateurs_tenant_id 
    ON formateurs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_formateurs_email 
    ON formateurs(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_formateurs_actif 
    ON formateurs(tenant_id, actif);
CREATE INDEX IF NOT EXISTS idx_formateurs_specialites 
    ON formateurs USING GIN(specialites);

-- Enable Row Level Security for formateurs
ALTER TABLE formateurs ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for formateurs
DROP POLICY IF EXISTS formateurs_tenant_policy ON formateurs;
CREATE POLICY formateurs_tenant_policy ON formateurs
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_formateurs_updated_at ON formateurs;
CREATE TRIGGER update_formateurs_updated_at 
    BEFORE UPDATE ON formateurs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create session_formateurs table (Junction table for trainers assigned to sessions)
CREATE TABLE IF NOT EXISTS session_formateurs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions_professionnelles(id) ON DELETE CASCADE,
    formateur_id UUID NOT NULL REFERENCES formateurs(id) ON DELETE CASCADE,
    role VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, session_id, formateur_id)
);

-- Create indexes for session_formateurs
CREATE INDEX IF NOT EXISTS idx_session_formateurs_tenant_id 
    ON session_formateurs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_session_formateurs_session_id 
    ON session_formateurs(session_id);
CREATE INDEX IF NOT EXISTS idx_session_formateurs_formateur_id 
    ON session_formateurs(formateur_id);

-- Enable Row Level Security for session_formateurs
ALTER TABLE session_formateurs ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for session_formateurs
DROP POLICY IF EXISTS session_formateurs_tenant_policy ON session_formateurs;
CREATE POLICY session_formateurs_tenant_policy ON session_formateurs
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Add table comments
COMMENT ON TABLE formateurs IS 'Professional training instructors';
COMMENT ON TABLE session_formateurs IS 'Junction table for trainers assigned to training sessions';

-- ============================================================================
-- Phase 6: User Story 4 - Company Client Management
-- ============================================================================

-- Create entreprises_clientes table (Company clients for enterprise training)
CREATE TABLE IF NOT EXISTS entreprises_clientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    raison_sociale VARCHAR(255) NOT NULL,
    siret VARCHAR(14),
    forme_juridique VARCHAR(50),
    adresse TEXT,
    code_postal VARCHAR(10),
    ville VARCHAR(100),
    pays VARCHAR(100) DEFAULT 'Côte d''Ivoire',
    contact_nom VARCHAR(100),
    contact_prenom VARCHAR(100),
    contact_email VARCHAR(255),
    contact_telephone VARCHAR(20),
    secteur_activite VARCHAR(100),
    nombre_employes INTEGER,
    notes TEXT,
    actif BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, siret)
);

-- Create indexes for entreprises_clientes
CREATE INDEX IF NOT EXISTS idx_entreprises_clientes_tenant_id 
    ON entreprises_clientes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_entreprises_clientes_siret 
    ON entreprises_clientes(tenant_id, siret);
CREATE INDEX IF NOT EXISTS idx_entreprises_clientes_raison_sociale 
    ON entreprises_clientes(tenant_id, raison_sociale);
CREATE INDEX IF NOT EXISTS idx_entreprises_clientes_actif 
    ON entreprises_clientes(tenant_id, actif);

-- Enable Row Level Security for entreprises_clientes
ALTER TABLE entreprises_clientes ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for entreprises_clientes
DROP POLICY IF EXISTS entreprises_clientes_tenant_policy ON entreprises_clientes;
CREATE POLICY entreprises_clientes_tenant_policy ON entreprises_clientes
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_entreprises_clientes_updated_at ON entreprises_clientes;
CREATE TRIGGER update_entreprises_clientes_updated_at 
    BEFORE UPDATE ON entreprises_clientes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE entreprises_clientes IS 'Company clients for enterprise training';

-- ============================================================================
-- Phase 7: User Story 5 - Participant Enrollment Management
-- ============================================================================

-- Create inscriptions_professionnelles table (Participant enrollments in training sessions)
CREATE TABLE IF NOT EXISTS inscriptions_professionnelles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    numero_inscription VARCHAR(50),
    session_id UUID NOT NULL REFERENCES sessions_professionnelles(id) ON DELETE CASCADE,
    apprenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entreprise_id UUID REFERENCES entreprises_clientes(id) ON DELETE SET NULL,
    type_inscription enrollment_type NOT NULL,
    statut enrollment_professional_status DEFAULT 'en_attente',
    montant_ht DECIMAL(10,2) NOT NULL,
    montant_ttc DECIMAL(10,2) NOT NULL,
    code_promo_utilise VARCHAR(50),
    reduction_appliquee DECIMAL(10,2) DEFAULT 0,
    date_inscription TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, numero_inscription),
    CHECK(montant_ht >= 0 AND montant_ttc >= 0),
    CHECK(reduction_appliquee >= 0),
    CHECK((type_inscription = 'entreprise' AND entreprise_id IS NOT NULL) OR (type_inscription = 'individuelle' AND entreprise_id IS NULL))
);

-- Create indexes for inscriptions_professionnelles
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_tenant_id 
    ON inscriptions_professionnelles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_numero_inscription 
    ON inscriptions_professionnelles(tenant_id, numero_inscription);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_session_id 
    ON inscriptions_professionnelles(session_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_apprenant_id 
    ON inscriptions_professionnelles(apprenant_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_entreprise_id 
    ON inscriptions_professionnelles(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_statut 
    ON inscriptions_professionnelles(tenant_id, statut);

-- Enable Row Level Security for inscriptions_professionnelles
ALTER TABLE inscriptions_professionnelles ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for inscriptions_professionnelles
DROP POLICY IF EXISTS inscriptions_professionnelles_tenant_policy ON inscriptions_professionnelles;
CREATE POLICY inscriptions_professionnelles_tenant_policy ON inscriptions_professionnelles
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_inscriptions_professionnelles_updated_at ON inscriptions_professionnelles;
CREATE TRIGGER update_inscriptions_professionnelles_updated_at 
    BEFORE UPDATE ON inscriptions_professionnelles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to auto-generate enrollment number
CREATE OR REPLACE FUNCTION generate_enrollment_number(tenant_uuid UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    year_suffix VARCHAR(4);
    sequence_num INTEGER;
    enrollment_num VARCHAR(50);
BEGIN
    -- Get current year suffix
    year_suffix := EXTRACT(YEAR FROM NOW())::TEXT;
    
    -- Get next sequence number for this tenant and year
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_inscription FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM inscriptions_professionnelles 
    WHERE tenant_id = tenant_uuid 
    AND numero_inscription LIKE 'INS-DATA-' || year_suffix || '-%';
    
    -- Format: INS-DATA-YYYY-NNN (e.g., INS-DATA-2024-001)
    enrollment_num := 'INS-DATA-' || year_suffix || '-' || LPAD(sequence_num::TEXT, 3, '0');
    
    RETURN enrollment_num;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to auto-generate enrollment number if not provided
CREATE OR REPLACE FUNCTION set_enrollment_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.numero_inscription IS NULL OR NEW.numero_inscription = '' THEN
        NEW.numero_inscription := generate_enrollment_number(NEW.tenant_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate enrollment number
DROP TRIGGER IF EXISTS set_enrollment_number_trigger ON inscriptions_professionnelles;
CREATE TRIGGER set_enrollment_number_trigger
    BEFORE INSERT ON inscriptions_professionnelles
    FOR EACH ROW EXECUTE FUNCTION set_enrollment_number();

-- Add table comment
COMMENT ON TABLE inscriptions_professionnelles IS 'Participant enrollments in training sessions';

-- ============================================================================
-- Phase 8: User Story 6 - Payment Processing and Tracking
-- ============================================================================

-- Create paiements_professionnels table (Payment transactions for enrollments)
CREATE TABLE IF NOT EXISTS paiements_professionnels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    inscription_id UUID NOT NULL REFERENCES inscriptions_professionnelles(id) ON DELETE CASCADE,
    numero_transaction VARCHAR(100),
    montant DECIMAL(10,2) NOT NULL,
    methode_paiement payment_method NOT NULL,
    statut payment_professional_status DEFAULT 'en_attente',
    reference_externe VARCHAR(255),
    date_paiement TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, numero_transaction),
    CHECK(montant > 0)
);

-- Create indexes for paiements_professionnels
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_tenant_id 
    ON paiements_professionnels(tenant_id);
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_inscription_id 
    ON paiements_professionnels(inscription_id);
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_numero_transaction 
    ON paiements_professionnels(tenant_id, numero_transaction);
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_statut 
    ON paiements_professionnels(tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_methode_paiement 
    ON paiements_professionnels(tenant_id, methode_paiement);

-- Enable Row Level Security for paiements_professionnels
ALTER TABLE paiements_professionnels ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for paiements_professionnels
DROP POLICY IF EXISTS paiements_professionnels_tenant_policy ON paiements_professionnels;
CREATE POLICY paiements_professionnels_tenant_policy ON paiements_professionnels
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_paiements_professionnels_updated_at ON paiements_professionnels;
CREATE TRIGGER update_paiements_professionnels_updated_at 
    BEFORE UPDATE ON paiements_professionnels 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE paiements_professionnels IS 'Payment transactions for enrollments';

-- ============================================================================
-- Phase 9: User Story 7 - Promotional Code Management
-- ============================================================================

-- Create codes_promo table (Promotional codes for discounts)
CREATE TABLE IF NOT EXISTS codes_promo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    type_reduction promo_code_reduction_type NOT NULL,
    valeur_reduction DECIMAL(10,2) NOT NULL,
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    utilisations_max INTEGER,
    utilisations_actuelles INTEGER DEFAULT 0,
    formations_applicables JSONB,
    actif BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, code),
    CHECK(date_fin >= date_debut),
    CHECK(valeur_reduction > 0),
    CHECK((type_reduction = 'pourcentage' AND valeur_reduction <= 100) OR type_reduction = 'montant_fixe'),
    CHECK(utilisations_max IS NULL OR utilisations_max > 0),
    CHECK(utilisations_actuelles >= 0),
    CHECK(utilisations_max IS NULL OR utilisations_actuelles <= utilisations_max)
);

-- Create indexes for codes_promo
CREATE INDEX IF NOT EXISTS idx_codes_promo_tenant_id 
    ON codes_promo(tenant_id);
CREATE INDEX IF NOT EXISTS idx_codes_promo_code 
    ON codes_promo(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_codes_promo_actif 
    ON codes_promo(tenant_id, actif);
CREATE INDEX IF NOT EXISTS idx_codes_promo_dates 
    ON codes_promo(tenant_id, date_debut, date_fin);

-- Enable Row Level Security for codes_promo
ALTER TABLE codes_promo ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for codes_promo
DROP POLICY IF EXISTS codes_promo_tenant_policy ON codes_promo;
CREATE POLICY codes_promo_tenant_policy ON codes_promo
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_codes_promo_updated_at ON codes_promo;
CREATE TRIGGER update_codes_promo_updated_at 
    BEFORE UPDATE ON codes_promo 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE codes_promo IS 'Promotional codes for discounts';

-- ============================================================================
-- Phase 10: User Story 8 - Training Materials and Resources Management
-- ============================================================================

-- Create supports_cours table (Training materials and resources)
CREATE TABLE IF NOT EXISTS supports_cours (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    formateur_id UUID NOT NULL REFERENCES formateurs(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions_professionnelles(id) ON DELETE CASCADE,
    formation_id UUID REFERENCES formations_professionnelles(id) ON DELETE CASCADE,
    titre VARCHAR(255) NOT NULL,
    description TEXT,
    type_fichier VARCHAR(50),
    fichier_url VARCHAR(500) NOT NULL,
    taille_fichier BIGINT,
    visible_apprenants BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK(session_id IS NOT NULL OR formation_id IS NOT NULL),
    CHECK(taille_fichier >= 0 OR taille_fichier IS NULL)
);

-- Create indexes for supports_cours
CREATE INDEX IF NOT EXISTS idx_supports_cours_tenant_id 
    ON supports_cours(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supports_cours_formateur_id 
    ON supports_cours(formateur_id);
CREATE INDEX IF NOT EXISTS idx_supports_cours_session_id 
    ON supports_cours(session_id);
CREATE INDEX IF NOT EXISTS idx_supports_cours_formation_id 
    ON supports_cours(formation_id);
CREATE INDEX IF NOT EXISTS idx_supports_cours_visible_apprenants 
    ON supports_cours(tenant_id, visible_apprenants);

-- Enable Row Level Security for supports_cours
ALTER TABLE supports_cours ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for supports_cours
DROP POLICY IF EXISTS supports_cours_tenant_policy ON supports_cours;
CREATE POLICY supports_cours_tenant_policy ON supports_cours
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_supports_cours_updated_at ON supports_cours;
CREATE TRIGGER update_supports_cours_updated_at 
    BEFORE UPDATE ON supports_cours 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE supports_cours IS 'Training materials and resources';

-- ============================================================================
-- Phase 11: Polish & Cross-Cutting Concerns - Migration Completion
-- ============================================================================

-- Migration completion message
SELECT 'Migration 0037_imhotep_data_professional_training.sql completed successfully' as result;

COMMIT;

