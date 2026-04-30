-- EcoleDigitale Database Schema Migration 0045
-- Description: Setup ASPCI professional training module (same tables as imhotepdata, tenant-aware code generation)
-- Date: 2025-01-28
-- Dependencies: 
--   - 0037_imhotep_data_professional_training.sql (all professional training tables)
--   - 0038_add_formations_pro_fts_index.sql
--   - 0039_reservations_temporaires.sql
--   - 0040_formateur_space_tables.sql
--   - 0041_documents_export_jobs.sql
--   - 0044_add_carriere_to_formations_professionnelles.sql
--
-- This migration ensures that all professional training tables and functions
-- work correctly for the ASPCI tenant. The tables are already multi-tenant
-- and work for all tenants, but we need to update the code generation functions
-- to be tenant-aware instead of using hardcoded "DATA-" prefix.
--
-- Note: All tables are already created by migration 0037 and are multi-tenant.
-- This migration only updates functions to support tenant-specific prefixes.

BEGIN;

-- ============================================================================
-- Update generate_session_code function to be tenant-aware
-- ============================================================================

-- The function should use tenant slug to determine prefix
-- For ASPCI: ASPCI-YYYY-NNN
-- For imhotepdata: DATA-YYYY-NNN (or based on formation slug)
CREATE OR REPLACE FUNCTION generate_session_code(tenant_uuid UUID, formation_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    year_suffix VARCHAR(4);
    sequence_num INTEGER;
    session_code VARCHAR(50);
    tenant_slug VARCHAR(50);
    prefix VARCHAR(10);
BEGIN
    -- Get tenant slug
    SELECT slug INTO tenant_slug
    FROM tenants
    WHERE id = tenant_uuid;
    
    -- Determine prefix based on tenant slug
    -- ASPCI -> ASPCI, imhotepdata -> DATA, others -> first 4 chars of slug
    IF tenant_slug = 'aspci' THEN
        prefix := 'ASPCI';
    ELSIF tenant_slug = 'imhotepdata' THEN
        prefix := 'DATA';
    ELSE
        -- Use first 4 uppercase alphanumeric characters of slug
        prefix := UPPER(SUBSTRING(REGEXP_REPLACE(tenant_slug, '[^A-Z0-9]', '', 'g') FROM 1 FOR 4));
        IF LENGTH(prefix) < 4 THEN
            prefix := LPAD(prefix, 4, 'X');
        END IF;
    END IF;
    
    -- Get current year suffix
    year_suffix := EXTRACT(YEAR FROM NOW())::TEXT;
    
    -- Get next sequence number for this tenant and year
    SELECT COALESCE(MAX(CAST(SUBSTRING(code_session FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM sessions_professionnelles 
    WHERE tenant_id = tenant_uuid 
    AND code_session LIKE prefix || '-' || year_suffix || '-%';
    
    -- Format: PREFIX-YYYY-NNN (e.g., ASPCI-2025-001, DATA-2025-001)
    session_code := prefix || '-' || year_suffix || '-' || LPAD(sequence_num::TEXT, 3, '0');
    
    RETURN session_code;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION generate_session_code(UUID, UUID) IS 'Generates tenant-aware session code in format PREFIX-YYYY-NNN (ASPCI for aspci tenant, DATA for imhotepdata, or based on tenant slug)';

-- ============================================================================
-- Update generate_enrollment_number function to be tenant-aware
-- ============================================================================

-- Update the function in migration 0039 to be tenant-aware
-- For ASPCI: INS-ASPCI-YYYYMMDD-XXX
-- For imhotepdata: INS-DATA-YYYYMMDD-XXX
CREATE OR REPLACE FUNCTION generate_enrollment_number(tenant_uuid UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    today VARCHAR(8);
    prefix VARCHAR(20);
    count_num INTEGER;
    numero VARCHAR(50);
    tenant_slug VARCHAR(50);
    tenant_prefix VARCHAR(10);
BEGIN
    -- Get tenant slug
    SELECT slug INTO tenant_slug
    FROM tenants
    WHERE id = tenant_uuid;
    
    -- Determine prefix based on tenant slug
    IF tenant_slug = 'aspci' THEN
        tenant_prefix := 'ASPCI';
    ELSIF tenant_slug = 'imhotepdata' THEN
        tenant_prefix := 'DATA';
    ELSE
        -- Use first 4 uppercase alphanumeric characters of slug
        tenant_prefix := UPPER(SUBSTRING(REGEXP_REPLACE(tenant_slug, '[^A-Z0-9]', '', 'g') FROM 1 FOR 4));
        IF LENGTH(tenant_prefix) < 4 THEN
            tenant_prefix := LPAD(tenant_prefix, 4, 'X');
        END IF;
    END IF;
    
    today := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    prefix := 'INS-' || tenant_prefix || '-' || today || '-';
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_inscription FROM LENGTH(prefix) + 1) AS INTEGER)), 0) + 1
    INTO count_num
    FROM inscriptions_professionnelles
    WHERE tenant_id = tenant_uuid
      AND numero_inscription LIKE prefix || '%';
    
    numero := prefix || LPAD(count_num::TEXT, 3, '0');
    RETURN numero;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION generate_enrollment_number(UUID) IS 'Generates tenant-aware enrollment number in format INS-PREFIX-YYYYMMDD-XXX (ASPCI for aspci tenant, DATA for imhotepdata, or based on tenant slug)';

-- ============================================================================
-- Verify all tables exist (they should already exist from migration 0037)
-- ============================================================================

DO $$
BEGIN
    -- Check that all required tables exist
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'formations_professionnelles') THEN
        RAISE EXCEPTION 'Table formations_professionnelles does not exist. Please run migration 0037 first.';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sessions_professionnelles') THEN
        RAISE EXCEPTION 'Table sessions_professionnelles does not exist. Please run migration 0037 first.';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'formateurs') THEN
        RAISE EXCEPTION 'Table formateurs does not exist. Please run migration 0037 first.';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'inscriptions_professionnelles') THEN
        RAISE EXCEPTION 'Table inscriptions_professionnelles does not exist. Please run migration 0037 first.';
    END IF;
    
    RAISE NOTICE 'All professional training tables verified. ASPCI tenant setup complete.';
END $$;

-- Migration completion message
SELECT 'Migration 0045_aspci_professional_training_setup.sql completed successfully' as result;
SELECT 'ASPCI tenant can now use all professional training features with tenant-specific code generation' as note;

COMMIT;

