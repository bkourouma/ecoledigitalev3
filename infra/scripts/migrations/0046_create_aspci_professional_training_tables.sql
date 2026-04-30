-- EcoleDigitale Database Schema Migration 0046
-- Description: Create dedicated ASPCI professional training tables (separate from imhotepdata)
-- Date: 2025-01-28
-- Dependencies: 
--   - 0037_imhotep_data_professional_training.sql (for reference structure)
--
-- This migration creates dedicated tables for ASPCI tenant with suffix _aspci.
-- Each tenant has its own isolated tables:
--   - imhotepdata uses: formations_professionnelles, sessions_professionnelles, etc.
--   - ASPCI uses: formations_professionnelles_aspci, sessions_professionnelles_aspci, etc.
--
-- This ensures complete data isolation between tenants at the database level.

BEGIN;

-- ============================================================================
-- Create ASPCI-specific tables (identical structure to imhotepdata tables)
-- ============================================================================

-- Create formations_professionnelles_aspci table
CREATE TABLE IF NOT EXISTS formations_professionnelles_aspci (
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
    carriere VARCHAR(255),
    actif BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, slug),
    CHECK(duree_jours > 0 OR duree_heures > 0),
    CHECK(prix_ht >= 0 AND prix_ttc >= 0)
);

-- Create indexes for formations_professionnelles_aspci
CREATE INDEX IF NOT EXISTS idx_formations_professionnelles_aspci_tenant_id 
    ON formations_professionnelles_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_formations_professionnelles_aspci_slug 
    ON formations_professionnelles_aspci(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_formations_professionnelles_aspci_actif 
    ON formations_professionnelles_aspci(tenant_id, actif);
CREATE INDEX IF NOT EXISTS idx_formations_professionnelles_aspci_themes 
    ON formations_professionnelles_aspci USING GIN(themes);
CREATE INDEX IF NOT EXISTS idx_formations_pro_aspci_fts 
    ON formations_professionnelles_aspci 
    USING GIN (
      to_tsvector(
        'french',
        COALESCE(titre, '') || ' ' || 
        COALESCE(description_courte, '') || ' ' || 
        COALESCE(description_complete, '')
      )
    );

-- Enable Row Level Security for formations_professionnelles_aspci
ALTER TABLE formations_professionnelles_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for formations_professionnelles_aspci
DROP POLICY IF EXISTS formations_professionnelles_aspci_tenant_policy ON formations_professionnelles_aspci;
CREATE POLICY formations_professionnelles_aspci_tenant_policy ON formations_professionnelles_aspci
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_formations_professionnelles_aspci_updated_at ON formations_professionnelles_aspci;
CREATE TRIGGER update_formations_professionnelles_aspci_updated_at 
    BEFORE UPDATE ON formations_professionnelles_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE formations_professionnelles_aspci IS 'Professional training program catalog for ASPCI tenant';

-- ============================================================================
-- Create sessions_professionnelles_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions_professionnelles_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    formation_pro_id UUID NOT NULL REFERENCES formations_professionnelles_aspci(id) ON DELETE CASCADE,
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
    notes_formateur TEXT,
    notes_updated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, code_session),
    CHECK(date_fin >= date_debut),
    CHECK(places_totales > 0),
    CHECK(places_reservees >= 0 AND places_reservees <= places_totales)
);

-- Create indexes for sessions_professionnelles_aspci
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_aspci_tenant_id 
    ON sessions_professionnelles_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_aspci_formation_pro_id 
    ON sessions_professionnelles_aspci(formation_pro_id);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_aspci_code_session 
    ON sessions_professionnelles_aspci(tenant_id, code_session);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_aspci_statut 
    ON sessions_professionnelles_aspci(tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_sessions_professionnelles_aspci_date_debut 
    ON sessions_professionnelles_aspci(tenant_id, date_debut);

-- Enable Row Level Security for sessions_professionnelles_aspci
ALTER TABLE sessions_professionnelles_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for sessions_professionnelles_aspci
DROP POLICY IF EXISTS sessions_professionnelles_aspci_tenant_policy ON sessions_professionnelles_aspci;
CREATE POLICY sessions_professionnelles_aspci_tenant_policy ON sessions_professionnelles_aspci
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_sessions_professionnelles_aspci_updated_at ON sessions_professionnelles_aspci;
CREATE TRIGGER update_sessions_professionnelles_aspci_updated_at 
    BEFORE UPDATE ON sessions_professionnelles_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to auto-generate session code for ASPCI
CREATE OR REPLACE FUNCTION generate_session_code_aspci(tenant_uuid UUID, formation_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    year_suffix VARCHAR(4);
    sequence_num INTEGER;
    session_code VARCHAR(50);
BEGIN
    year_suffix := EXTRACT(YEAR FROM NOW())::TEXT;
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(code_session FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM sessions_professionnelles_aspci 
    WHERE tenant_id = tenant_uuid 
    AND code_session LIKE 'ASPCI-' || year_suffix || '-%';
    
    session_code := 'ASPCI-' || year_suffix || '-' || LPAD(sequence_num::TEXT, 3, '0');
    
    RETURN session_code;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to auto-generate session code for ASPCI
CREATE OR REPLACE FUNCTION set_session_code_aspci()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.code_session IS NULL OR NEW.code_session = '' THEN
        NEW.code_session := generate_session_code_aspci(NEW.tenant_id, NEW.formation_pro_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate session code for ASPCI
DROP TRIGGER IF EXISTS set_session_code_aspci_trigger ON sessions_professionnelles_aspci;
CREATE TRIGGER set_session_code_aspci_trigger
    BEFORE INSERT ON sessions_professionnelles_aspci
    FOR EACH ROW EXECUTE FUNCTION set_session_code_aspci();

-- Add table comment
COMMENT ON TABLE sessions_professionnelles_aspci IS 'Scheduled training sessions for ASPCI tenant';

-- ============================================================================
-- Create formateurs_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS formateurs_aspci (
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

-- Create indexes for formateurs_aspci
CREATE INDEX IF NOT EXISTS idx_formateurs_aspci_tenant_id 
    ON formateurs_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_formateurs_aspci_email 
    ON formateurs_aspci(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_formateurs_aspci_actif 
    ON formateurs_aspci(tenant_id, actif);
CREATE INDEX IF NOT EXISTS idx_formateurs_aspci_specialites 
    ON formateurs_aspci USING GIN(specialites);

-- Enable Row Level Security for formateurs_aspci
ALTER TABLE formateurs_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for formateurs_aspci
DROP POLICY IF EXISTS formateurs_aspci_tenant_policy ON formateurs_aspci;
CREATE POLICY formateurs_aspci_tenant_policy ON formateurs_aspci
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_formateurs_aspci_updated_at ON formateurs_aspci;
CREATE TRIGGER update_formateurs_aspci_updated_at 
    BEFORE UPDATE ON formateurs_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE formateurs_aspci IS 'Professional training instructors for ASPCI tenant';

-- ============================================================================
-- Create session_formateurs_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS session_formateurs_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions_professionnelles_aspci(id) ON DELETE CASCADE,
    formateur_id UUID NOT NULL REFERENCES formateurs_aspci(id) ON DELETE CASCADE,
    role VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, session_id, formateur_id)
);

-- Create indexes for session_formateurs_aspci
CREATE INDEX IF NOT EXISTS idx_session_formateurs_aspci_tenant_id 
    ON session_formateurs_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_session_formateurs_aspci_session_id 
    ON session_formateurs_aspci(session_id);
CREATE INDEX IF NOT EXISTS idx_session_formateurs_aspci_formateur_id 
    ON session_formateurs_aspci(formateur_id);

-- Enable Row Level Security for session_formateurs_aspci
ALTER TABLE session_formateurs_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for session_formateurs_aspci
DROP POLICY IF EXISTS session_formateurs_aspci_tenant_policy ON session_formateurs_aspci;
CREATE POLICY session_formateurs_aspci_tenant_policy ON session_formateurs_aspci
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Add table comment
COMMENT ON TABLE session_formateurs_aspci IS 'Junction table for trainers assigned to training sessions for ASPCI tenant';

-- ============================================================================
-- Create entreprises_clientes_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS entreprises_clientes_aspci (
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

-- Create indexes for entreprises_clientes_aspci
CREATE INDEX IF NOT EXISTS idx_entreprises_clientes_aspci_tenant_id 
    ON entreprises_clientes_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_entreprises_clientes_aspci_siret 
    ON entreprises_clientes_aspci(tenant_id, siret);
CREATE INDEX IF NOT EXISTS idx_entreprises_clientes_aspci_raison_sociale 
    ON entreprises_clientes_aspci(tenant_id, raison_sociale);
CREATE INDEX IF NOT EXISTS idx_entreprises_clientes_aspci_actif 
    ON entreprises_clientes_aspci(tenant_id, actif);

-- Enable Row Level Security for entreprises_clientes_aspci
ALTER TABLE entreprises_clientes_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for entreprises_clientes_aspci
DROP POLICY IF EXISTS entreprises_clientes_aspci_tenant_policy ON entreprises_clientes_aspci;
CREATE POLICY entreprises_clientes_aspci_tenant_policy ON entreprises_clientes_aspci
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_entreprises_clientes_aspci_updated_at ON entreprises_clientes_aspci;
CREATE TRIGGER update_entreprises_clientes_aspci_updated_at 
    BEFORE UPDATE ON entreprises_clientes_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE entreprises_clientes_aspci IS 'Company clients for enterprise training for ASPCI tenant';

-- ============================================================================
-- Create inscriptions_professionnelles_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS inscriptions_professionnelles_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    numero_inscription VARCHAR(50),
    session_id UUID NOT NULL REFERENCES sessions_professionnelles_aspci(id) ON DELETE CASCADE,
    apprenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entreprise_id UUID REFERENCES entreprises_clientes_aspci(id) ON DELETE SET NULL,
    type_inscription enrollment_type NOT NULL,
    statut enrollment_professional_status DEFAULT 'en_attente',
    montant_ht DECIMAL(10,2) NOT NULL,
    montant_ttc DECIMAL(10,2) NOT NULL,
    code_promo_utilise VARCHAR(50),
    reduction_appliquee DECIMAL(10,2) DEFAULT 0,
    date_inscription TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    facture_numero VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, numero_inscription),
    CHECK(montant_ht >= 0 AND montant_ttc >= 0),
    CHECK(reduction_appliquee >= 0),
    CHECK((type_inscription = 'entreprise' AND entreprise_id IS NOT NULL) OR (type_inscription = 'individuelle' AND entreprise_id IS NULL))
);

-- Create indexes for inscriptions_professionnelles_aspci
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_aspci_tenant_id 
    ON inscriptions_professionnelles_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_aspci_numero_inscription 
    ON inscriptions_professionnelles_aspci(tenant_id, numero_inscription);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_aspci_session_id 
    ON inscriptions_professionnelles_aspci(session_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_aspci_apprenant_id 
    ON inscriptions_professionnelles_aspci(apprenant_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_aspci_entreprise_id 
    ON inscriptions_professionnelles_aspci(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_professionnelles_aspci_statut 
    ON inscriptions_professionnelles_aspci(tenant_id, statut);

-- Enable Row Level Security for inscriptions_professionnelles_aspci
ALTER TABLE inscriptions_professionnelles_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for inscriptions_professionnelles_aspci
DROP POLICY IF EXISTS inscriptions_professionnelles_aspci_tenant_policy ON inscriptions_professionnelles_aspci;
CREATE POLICY inscriptions_professionnelles_aspci_tenant_policy ON inscriptions_professionnelles_aspci
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_inscriptions_professionnelles_aspci_updated_at ON inscriptions_professionnelles_aspci;
CREATE TRIGGER update_inscriptions_professionnelles_aspci_updated_at 
    BEFORE UPDATE ON inscriptions_professionnelles_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to auto-generate enrollment number for ASPCI
CREATE OR REPLACE FUNCTION generate_enrollment_number_aspci(tenant_uuid UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    today VARCHAR(8);
    prefix VARCHAR(20);
    count_num INTEGER;
    numero VARCHAR(50);
BEGIN
    today := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    prefix := 'INS-ASPCI-' || today || '-';
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_inscription FROM LENGTH(prefix) + 1) AS INTEGER)), 0) + 1
    INTO count_num
    FROM inscriptions_professionnelles_aspci
    WHERE tenant_id = tenant_uuid
      AND numero_inscription LIKE prefix || '%';
    
    numero := prefix || LPAD(count_num::TEXT, 3, '0');
    RETURN numero;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to auto-generate enrollment number for ASPCI
CREATE OR REPLACE FUNCTION set_enrollment_number_aspci()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.numero_inscription IS NULL OR NEW.numero_inscription = '' THEN
        NEW.numero_inscription := generate_enrollment_number_aspci(NEW.tenant_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate enrollment number for ASPCI
DROP TRIGGER IF EXISTS set_enrollment_number_aspci_trigger ON inscriptions_professionnelles_aspci;
CREATE TRIGGER set_enrollment_number_aspci_trigger
    BEFORE INSERT ON inscriptions_professionnelles_aspci
    FOR EACH ROW EXECUTE FUNCTION set_enrollment_number_aspci();

-- Add table comment
COMMENT ON TABLE inscriptions_professionnelles_aspci IS 'Participant enrollments in training sessions for ASPCI tenant';

-- ============================================================================
-- Create paiements_professionnels_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS paiements_professionnels_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    inscription_id UUID NOT NULL REFERENCES inscriptions_professionnelles_aspci(id) ON DELETE CASCADE,
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

-- Create indexes for paiements_professionnels_aspci
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_aspci_tenant_id 
    ON paiements_professionnels_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_aspci_inscription_id 
    ON paiements_professionnels_aspci(inscription_id);
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_aspci_numero_transaction 
    ON paiements_professionnels_aspci(tenant_id, numero_transaction);
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_aspci_statut 
    ON paiements_professionnels_aspci(tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_paiements_professionnels_aspci_methode_paiement 
    ON paiements_professionnels_aspci(tenant_id, methode_paiement);

-- Enable Row Level Security for paiements_professionnels_aspci
ALTER TABLE paiements_professionnels_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for paiements_professionnels_aspci
DROP POLICY IF EXISTS paiements_professionnels_aspci_tenant_policy ON paiements_professionnels_aspci;
CREATE POLICY paiements_professionnels_aspci_tenant_policy ON paiements_professionnels_aspci
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_paiements_professionnels_aspci_updated_at ON paiements_professionnels_aspci;
CREATE TRIGGER update_paiements_professionnels_aspci_updated_at 
    BEFORE UPDATE ON paiements_professionnels_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE paiements_professionnels_aspci IS 'Payment transactions for enrollments for ASPCI tenant';

-- ============================================================================
-- Create codes_promo_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS codes_promo_aspci (
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

-- Create indexes for codes_promo_aspci
CREATE INDEX IF NOT EXISTS idx_codes_promo_aspci_tenant_id 
    ON codes_promo_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_codes_promo_aspci_code 
    ON codes_promo_aspci(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_codes_promo_aspci_actif 
    ON codes_promo_aspci(tenant_id, actif);
CREATE INDEX IF NOT EXISTS idx_codes_promo_aspci_dates 
    ON codes_promo_aspci(tenant_id, date_debut, date_fin);

-- Enable Row Level Security for codes_promo_aspci
ALTER TABLE codes_promo_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for codes_promo_aspci
DROP POLICY IF EXISTS codes_promo_aspci_tenant_policy ON codes_promo_aspci;
CREATE POLICY codes_promo_aspci_tenant_policy ON codes_promo_aspci
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_codes_promo_aspci_updated_at ON codes_promo_aspci;
CREATE TRIGGER update_codes_promo_aspci_updated_at 
    BEFORE UPDATE ON codes_promo_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE codes_promo_aspci IS 'Promotional codes for discounts for ASPCI tenant';

-- ============================================================================
-- Create supports_cours_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS supports_cours_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    formateur_id UUID NOT NULL REFERENCES formateurs_aspci(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions_professionnelles_aspci(id) ON DELETE CASCADE,
    formation_id UUID REFERENCES formations_professionnelles_aspci(id) ON DELETE CASCADE,
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

-- Create indexes for supports_cours_aspci
CREATE INDEX IF NOT EXISTS idx_supports_cours_aspci_tenant_id 
    ON supports_cours_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supports_cours_aspci_formateur_id 
    ON supports_cours_aspci(formateur_id);
CREATE INDEX IF NOT EXISTS idx_supports_cours_aspci_session_id 
    ON supports_cours_aspci(session_id);
CREATE INDEX IF NOT EXISTS idx_supports_cours_aspci_formation_id 
    ON supports_cours_aspci(formation_id);
CREATE INDEX IF NOT EXISTS idx_supports_cours_aspci_visible_apprenants 
    ON supports_cours_aspci(tenant_id, visible_apprenants);

-- Enable Row Level Security for supports_cours_aspci
ALTER TABLE supports_cours_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for supports_cours_aspci
DROP POLICY IF EXISTS supports_cours_aspci_tenant_policy ON supports_cours_aspci;
CREATE POLICY supports_cours_aspci_tenant_policy ON supports_cours_aspci
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_supports_cours_aspci_updated_at ON supports_cours_aspci;
CREATE TRIGGER update_supports_cours_aspci_updated_at 
    BEFORE UPDATE ON supports_cours_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comment
COMMENT ON TABLE supports_cours_aspci IS 'Training materials and resources for ASPCI tenant';

-- ============================================================================
-- Create reservations_temporaires_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS reservations_temporaires_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    inscription_id UUID NOT NULL REFERENCES inscriptions_professionnelles_aspci(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions_professionnelles_aspci(id) ON DELETE CASCADE,
    expire_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_tenant_inscription_aspci UNIQUE(tenant_id, inscription_id),
    CONSTRAINT check_expire_after_created_aspci CHECK(expire_at > created_at)
);

-- Enable Row Level Security
ALTER TABLE reservations_temporaires_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY reservations_temporaires_aspci_tenant_policy ON reservations_temporaires_aspci
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_aspci_tenant_id 
    ON reservations_temporaires_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_aspci_inscription_id 
    ON reservations_temporaires_aspci(inscription_id);
CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_aspci_session_id 
    ON reservations_temporaires_aspci(session_id);
CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_aspci_expire_at 
    ON reservations_temporaires_aspci(expire_at);

-- Add comment for documentation
COMMENT ON TABLE reservations_temporaires_aspci IS 'Temporary place reservations during enrollment process (15-minute expiration) for ASPCI tenant';

-- ============================================================================
-- Create session_attendance_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS session_attendance_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions_professionnelles_aspci(id) ON DELETE CASCADE,
    inscription_id UUID NOT NULL REFERENCES inscriptions_professionnelles_aspci(id) ON DELETE CASCADE,
    present BOOLEAN NOT NULL,
    marked_by UUID NOT NULL REFERENCES formateurs_aspci(id) ON DELETE RESTRICT,
    marked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_session_inscription_aspci UNIQUE(tenant_id, session_id, inscription_id)
);

-- Enable Row Level Security
ALTER TABLE session_attendance_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY session_attendance_aspci_tenant_policy ON session_attendance_aspci
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_session_attendance_aspci_tenant_id 
    ON session_attendance_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_session_attendance_aspci_session_id 
    ON session_attendance_aspci(session_id);
CREATE INDEX IF NOT EXISTS idx_session_attendance_aspci_inscription_id 
    ON session_attendance_aspci(inscription_id);
CREATE INDEX IF NOT EXISTS idx_session_attendance_aspci_marked_by 
    ON session_attendance_aspci(marked_by);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS trigger_update_session_attendance_aspci_updated_at ON session_attendance_aspci;
CREATE TRIGGER trigger_update_session_attendance_aspci_updated_at
    BEFORE UPDATE ON session_attendance_aspci
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE session_attendance_aspci IS 'Learner attendance records for training sessions for ASPCI tenant';

-- ============================================================================
-- Create support_session_associations_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS support_session_associations_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    support_id UUID NOT NULL REFERENCES supports_cours_aspci(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions_professionnelles_aspci(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_support_session_aspci UNIQUE(tenant_id, support_id, session_id)
);

-- Enable Row Level Security
ALTER TABLE support_session_associations_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY support_session_assoc_aspci_tenant_policy ON support_session_associations_aspci
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_support_session_assoc_aspci_tenant_id 
    ON support_session_associations_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_session_assoc_aspci_support_id 
    ON support_session_associations_aspci(support_id);
CREATE INDEX IF NOT EXISTS idx_support_session_assoc_aspci_session_id 
    ON support_session_associations_aspci(session_id);

-- Add comment for documentation
COMMENT ON TABLE support_session_associations_aspci IS 'Many-to-many relationship between course materials and sessions for ASPCI tenant';

-- ============================================================================
-- Create support_telechargements_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS support_telechargements_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    support_id UUID NOT NULL REFERENCES supports_cours_aspci(id) ON DELETE CASCADE,
    apprenant_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id UUID REFERENCES sessions_professionnelles_aspci(id) ON DELETE SET NULL,
    downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE support_telechargements_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY support_telechargements_aspci_tenant_policy ON support_telechargements_aspci
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_support_telechargements_aspci_tenant_id 
    ON support_telechargements_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_telechargements_aspci_support_id 
    ON support_telechargements_aspci(support_id);
CREATE INDEX IF NOT EXISTS idx_support_telechargements_aspci_apprenant_id 
    ON support_telechargements_aspci(apprenant_id);
CREATE INDEX IF NOT EXISTS idx_support_telechargements_aspci_session_id 
    ON support_telechargements_aspci(session_id);
CREATE INDEX IF NOT EXISTS idx_support_telechargements_aspci_downloaded_at 
    ON support_telechargements_aspci(downloaded_at);

-- Add comment for documentation
COMMENT ON TABLE support_telechargements_aspci IS 'Track course material downloads for statistics for ASPCI tenant';

-- ============================================================================
-- Create formateur_indisponibilites_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS formateur_indisponibilites_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    formateur_id UUID NOT NULL REFERENCES formateurs_aspci(id) ON DELETE CASCADE,
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    raison TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT check_date_fin_after_debut_aspci CHECK(date_fin >= date_debut)
);

-- Enable Row Level Security
ALTER TABLE formateur_indisponibilites_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY formateur_indispo_aspci_tenant_policy ON formateur_indisponibilites_aspci
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_formateur_indispo_aspci_tenant_id 
    ON formateur_indisponibilites_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_formateur_indispo_aspci_formateur_id 
    ON formateur_indisponibilites_aspci(formateur_id);
CREATE INDEX IF NOT EXISTS idx_formateur_indispo_aspci_dates 
    ON formateur_indisponibilites_aspci(tenant_id, formateur_id, date_debut, date_fin);

-- Add comment for documentation
COMMENT ON TABLE formateur_indisponibilites_aspci IS 'Periods when trainers are unavailable for ASPCI tenant';

-- ============================================================================
-- Create notifications_formateurs_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications_formateurs_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    formateur_id UUID NOT NULL REFERENCES formateurs_aspci(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    titre VARCHAR(255) NOT NULL,
    message TEXT,
    metadata JSONB,
    lue BOOLEAN DEFAULT false,
    lue_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE notifications_formateurs_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY notifications_formateurs_aspci_tenant_policy ON notifications_formateurs_aspci
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_aspci_tenant_id 
    ON notifications_formateurs_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_aspci_formateur_id 
    ON notifications_formateurs_aspci(formateur_id);
CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_aspci_lue 
    ON notifications_formateurs_aspci(tenant_id, formateur_id, lue);
CREATE INDEX IF NOT EXISTS idx_notifications_formateurs_aspci_created_at 
    ON notifications_formateurs_aspci(tenant_id, formateur_id, created_at DESC);

-- Add comment for documentation
COMMENT ON TABLE notifications_formateurs_aspci IS 'In-app notifications for trainers for ASPCI tenant';

-- ============================================================================
-- Create documents_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS documents_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type document_type NOT NULL,
    numero VARCHAR(50) NOT NULL,
    inscription_id UUID REFERENCES inscriptions_professionnelles_aspci(id) ON DELETE SET NULL,
    session_id UUID REFERENCES sessions_professionnelles_aspci(id) ON DELETE SET NULL,
    entreprise_id UUID REFERENCES entreprises_clientes_aspci(id) ON DELETE SET NULL,
    fichier_url VARCHAR(500) NOT NULL,
    date_generation TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    genere_par UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_document_numero_aspci UNIQUE(tenant_id, type, numero),
    CONSTRAINT check_document_relationship_aspci CHECK (
        inscription_id IS NOT NULL OR 
        session_id IS NOT NULL OR 
        entreprise_id IS NOT NULL
    )
);

-- Enable Row Level Security
ALTER TABLE documents_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY documents_aspci_tenant_policy ON documents_aspci
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_aspci_tenant_id 
    ON documents_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_aspci_type 
    ON documents_aspci(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_documents_aspci_numero 
    ON documents_aspci(tenant_id, type, numero);
CREATE INDEX IF NOT EXISTS idx_documents_aspci_inscription_id 
    ON documents_aspci(inscription_id) WHERE inscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_aspci_session_id 
    ON documents_aspci(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_aspci_entreprise_id 
    ON documents_aspci(entreprise_id) WHERE entreprise_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_aspci_date_generation 
    ON documents_aspci(tenant_id, date_generation DESC);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_documents_aspci_updated_at ON documents_aspci;
CREATE TRIGGER update_documents_aspci_updated_at 
    BEFORE UPDATE ON documents_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comments for documentation
COMMENT ON TABLE documents_aspci IS 'Metadata for generated administrative documents for ASPCI tenant';

-- ============================================================================
-- Create export_jobs_aspci table
-- ============================================================================

CREATE TABLE IF NOT EXISTS export_jobs_aspci (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type export_type NOT NULL,
    status job_status DEFAULT 'pending',
    fichier_url VARCHAR(500),
    progress INTEGER DEFAULT 0,
    total_items INTEGER,
    processed_items INTEGER DEFAULT 0,
    config JSONB NOT NULL,
    error_message TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT check_progress_range_aspci CHECK (progress >= 0 AND progress <= 100),
    CONSTRAINT check_processed_items_aspci CHECK (
        processed_items <= total_items OR total_items IS NULL
    )
);

-- Enable Row Level Security
ALTER TABLE export_jobs_aspci ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY export_jobs_aspci_tenant_policy ON export_jobs_aspci
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_export_jobs_aspci_tenant_id 
    ON export_jobs_aspci(tenant_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_aspci_status 
    ON export_jobs_aspci(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_export_jobs_aspci_created_by 
    ON export_jobs_aspci(created_by);
CREATE INDEX IF NOT EXISTS idx_export_jobs_aspci_created_at 
    ON export_jobs_aspci(tenant_id, created_at DESC);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_export_jobs_aspci_updated_at ON export_jobs_aspci;
CREATE TRIGGER update_export_jobs_aspci_updated_at 
    BEFORE UPDATE ON export_jobs_aspci 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comments for documentation
COMMENT ON TABLE export_jobs_aspci IS 'Tracks asynchronous export generation jobs for large datasets for ASPCI tenant';

-- ============================================================================
-- Migration completion message
-- ============================================================================

SELECT 'Migration 0046_create_aspci_professional_training_tables.sql completed successfully' as result;
SELECT 'ASPCI tenant now has dedicated tables with complete data isolation' as note;

COMMIT;

