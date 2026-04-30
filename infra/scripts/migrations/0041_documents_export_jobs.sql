-- EcoleDigitale Database Schema Migration 0041
-- Description: Create documents and export_jobs tables for Phase 6 - Gestion Administrative & Documents
-- Date: 2025-01-27
-- Dependencies: 
--   - 0037_imhotep_data_professional_training.sql (inscriptions_professionnelles, sessions_professionnelles, entreprises_clientes tables)
--   - 0001_init.sql (tenants, users tables)
--
-- This migration creates:
--   - document_type ENUM for document types
--   - documents table for administrative document metadata
--   - export_type and job_status ENUMs for export jobs
--   - export_jobs table for asynchronous export job tracking
--   - Row Level Security (RLS) policies for multi-tenant isolation
--   - Indexes for query performance
--   - Triggers for updated_at timestamps

BEGIN;

-- ============================================================================
-- Create ENUM Types
-- ============================================================================

-- Document type ENUM
DO $$ BEGIN
    CREATE TYPE document_type AS ENUM (
        'convention',           -- Training convention document
        'attestation_presence', -- Attendance certificate
        'attestation_reussite', -- Success certificate
        'devis',                -- Quote/estimate
        'facture',              -- Individual invoice
        'facture_groupee'       -- Grouped invoice for enterprise
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Export type ENUM
DO $$ BEGIN
    CREATE TYPE export_type AS ENUM (
        'inscriptions',  -- Enrollment export
        'paiements',     -- Payment export
        'presences',    -- Attendance export
        'ca_formation', -- Revenue by training export
        'personnalise'   -- Custom export
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Export job status ENUM
DO $$ BEGIN
    CREATE TYPE job_status AS ENUM (
        'pending',    -- Job is pending processing
        'processing', -- Job is currently being processed
        'completed',  -- Job has completed successfully
        'failed',      -- Job has failed
        'cancelled'   -- Job has been cancelled
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- Create documents table
-- ============================================================================

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type document_type NOT NULL,
    numero VARCHAR(50) NOT NULL,
    inscription_id UUID REFERENCES inscriptions_professionnelles(id) ON DELETE SET NULL,
    session_id UUID REFERENCES sessions_professionnelles(id) ON DELETE SET NULL,
    entreprise_id UUID REFERENCES entreprises_clientes(id) ON DELETE SET NULL,
    fichier_url VARCHAR(500) NOT NULL,
    date_generation TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    genere_par UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_document_numero UNIQUE(tenant_id, type, numero),
    CONSTRAINT check_document_relationship CHECK (
        inscription_id IS NOT NULL OR 
        session_id IS NOT NULL OR 
        entreprise_id IS NOT NULL
    )
);

-- Enable Row Level Security
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY documents_tenant_policy ON documents
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id 
    ON documents(tenant_id);

CREATE INDEX IF NOT EXISTS idx_documents_type 
    ON documents(tenant_id, type);

CREATE INDEX IF NOT EXISTS idx_documents_numero 
    ON documents(tenant_id, type, numero);

CREATE INDEX IF NOT EXISTS idx_documents_inscription_id 
    ON documents(inscription_id) WHERE inscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_session_id 
    ON documents(session_id) WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_entreprise_id 
    ON documents(entreprise_id) WHERE entreprise_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_date_generation 
    ON documents(tenant_id, date_generation DESC);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;
CREATE TRIGGER update_documents_updated_at 
    BEFORE UPDATE ON documents 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comments for documentation
COMMENT ON TABLE documents IS 'Metadata for generated administrative documents (conventions, attestations, quotes, invoices)';
COMMENT ON COLUMN documents.numero IS 'Unique document number in format PREFIX-YYYY-NNNN (e.g., CONV-2024-0001)';
COMMENT ON COLUMN documents.fichier_url IS 'File path in FileStorageService where PDF is stored';
COMMENT ON COLUMN documents.metadata IS 'Additional document-specific data (client info for quotes, note for success certificates, validity date)';
COMMENT ON COLUMN documents.genere_par IS 'User who generated the document (or NULL for automatic generation)';

-- ============================================================================
-- Create export_jobs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS export_jobs (
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
    
    -- Constraints
    CONSTRAINT check_progress_range CHECK (progress >= 0 AND progress <= 100),
    CONSTRAINT check_processed_items CHECK (
        processed_items <= total_items OR total_items IS NULL
    )
);

-- Enable Row Level Security
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
DO $$ BEGIN
    CREATE POLICY export_jobs_tenant_policy ON export_jobs
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant_id 
    ON export_jobs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_export_jobs_status 
    ON export_jobs(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_export_jobs_created_by 
    ON export_jobs(created_by);

CREATE INDEX IF NOT EXISTS idx_export_jobs_created_at 
    ON export_jobs(tenant_id, created_at DESC);

-- Create trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_export_jobs_updated_at ON export_jobs;
CREATE TRIGGER update_export_jobs_updated_at 
    BEFORE UPDATE ON export_jobs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add table comments for documentation
COMMENT ON TABLE export_jobs IS 'Tracks asynchronous export generation jobs for large datasets';
COMMENT ON COLUMN export_jobs.config IS 'Export configuration (filters, columns, format, grouping)';
COMMENT ON COLUMN export_jobs.fichier_url IS 'Generated file path in FileStorageService (when completed)';
COMMENT ON COLUMN export_jobs.progress IS 'Progress percentage (0-100)';
COMMENT ON COLUMN export_jobs.total_items IS 'Total number of items to process';
COMMENT ON COLUMN export_jobs.processed_items IS 'Number of items processed so far';

COMMIT;

