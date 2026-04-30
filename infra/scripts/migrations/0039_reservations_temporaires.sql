-- EcoleDigitale Database Schema Migration 0039
-- Description: Create temporary reservations table and helper functions for enrollment system
-- Date: 2025-11-20
-- Dependencies: 
--   - 0037_imhotep_data_professional_training.sql (inscriptions_professionnelles, sessions_professionnelles tables)
--
-- This migration creates:
--   - reservations_temporaires table for 15-minute place reservations during enrollment
--   - generate_enrollment_number() function for unique enrollment number generation
--   - generate_invoice_number() function for unique invoice number generation
--   - Row Level Security (RLS) policies for multi-tenant isolation
--   - Indexes for query performance

BEGIN;

-- ============================================================================
-- Create reservations_temporaires table
-- ============================================================================

CREATE TABLE IF NOT EXISTS reservations_temporaires (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    inscription_id UUID NOT NULL REFERENCES inscriptions_professionnelles(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions_professionnelles(id) ON DELETE CASCADE,
    expire_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_tenant_inscription UNIQUE(tenant_id, inscription_id),
    CONSTRAINT check_expire_after_created CHECK(expire_at > created_at)
);

-- Enable Row Level Security
ALTER TABLE reservations_temporaires ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY reservations_temporaires_tenant_policy ON reservations_temporaires
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_tenant_id 
    ON reservations_temporaires(tenant_id);

CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_inscription_id 
    ON reservations_temporaires(inscription_id);

CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_session_id 
    ON reservations_temporaires(session_id);

CREATE INDEX IF NOT EXISTS idx_reservations_temporaires_expire_at 
    ON reservations_temporaires(expire_at);

-- Add comment for documentation
COMMENT ON TABLE reservations_temporaires IS 'Temporary place reservations during enrollment process (15-minute expiration)';
COMMENT ON COLUMN reservations_temporaires.expire_at IS 'Reservation expiration timestamp (15 minutes after creation)';

-- ============================================================================
-- Database Functions
-- ============================================================================

-- Generate Enrollment Number Function
-- Format: INS-DATA-YYYYMMDD-XXX (e.g., INS-DATA-20251120-001)
CREATE OR REPLACE FUNCTION generate_enrollment_number(tenant_uuid UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    today VARCHAR(8);
    prefix VARCHAR(20);
    count_num INTEGER;
    numero VARCHAR(50);
BEGIN
    today := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    prefix := 'INS-DATA-' || today || '-';
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_inscription FROM LENGTH(prefix) + 1) AS INTEGER)), 0) + 1
    INTO count_num
    FROM inscriptions_professionnelles
    WHERE tenant_id = tenant_uuid
      AND numero_inscription LIKE prefix || '%';
    
    numero := prefix || LPAD(count_num::TEXT, 3, '0');
    RETURN numero;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON FUNCTION generate_enrollment_number(UUID) IS 'Generates unique enrollment number in format INS-DATA-YYYYMMDD-XXX';

-- Generate Invoice Number Function
-- Format: FACT-YYYY-NNNN (e.g., FACT-2025-0001)
CREATE OR REPLACE FUNCTION generate_invoice_number(tenant_uuid UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    year VARCHAR(4);
    prefix VARCHAR(20);
    count_num INTEGER;
    numero VARCHAR(50);
BEGIN
    year := TO_CHAR(CURRENT_DATE, 'YYYY');
    prefix := 'FACT-' || year || '-';
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(facture_numero FROM LENGTH(prefix) + 1) AS INTEGER)), 0) + 1
    INTO count_num
    FROM inscriptions_professionnelles
    WHERE tenant_id = tenant_uuid
      AND facture_numero LIKE prefix || '%'
      AND facture_numero IS NOT NULL;
    
    numero := prefix || LPAD(count_num::TEXT, 4, '0');
    RETURN numero;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON FUNCTION generate_invoice_number(UUID) IS 'Generates unique invoice number in format FACT-YYYY-NNNN';

COMMIT;

