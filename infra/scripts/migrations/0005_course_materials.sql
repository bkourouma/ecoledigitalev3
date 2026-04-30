-- Migration: Course Materials Management System
-- Description: Create tables and infrastructure for course materials with file storage and embeddings
-- Date: 2025-01-19

-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Create course_materials table
CREATE TABLE IF NOT EXISTS course_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    minio_key VARCHAR(500) NOT NULL,
    content_text TEXT,                          -- Extracted text for embeddings
    embedding vector(1536),                     -- OpenAI text-embedding-3-small dimension
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_course_materials_tenant_id ON course_materials(tenant_id);
CREATE INDEX IF NOT EXISTS idx_course_materials_course_id ON course_materials(tenant_id, course_id);
CREATE INDEX IF NOT EXISTS idx_course_materials_file_type ON course_materials(tenant_id, file_type);
CREATE INDEX IF NOT EXISTS idx_course_materials_uploaded_by ON course_materials(tenant_id, uploaded_by);
CREATE INDEX IF NOT EXISTS idx_course_materials_created_at ON course_materials(tenant_id, created_at DESC);

-- Create vector index for embeddings (using ivfflat)
-- Note: This will be created after some data is inserted
-- CREATE INDEX IF NOT EXISTS idx_course_materials_embedding ON course_materials 
-- USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Enable Row Level Security
ALTER TABLE course_materials ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
CREATE POLICY course_materials_tenant_policy ON course_materials
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_course_materials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER course_materials_updated_at_trigger
    BEFORE UPDATE ON course_materials
    FOR EACH ROW
    EXECUTE FUNCTION update_course_materials_updated_at();

-- Create enum for file processing status (for future use)
CREATE TYPE material_processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Add processing status column (for background job tracking)
ALTER TABLE course_materials 
ADD COLUMN processing_status material_processing_status DEFAULT 'pending',
ADD COLUMN processing_error TEXT,
ADD COLUMN processed_at TIMESTAMP WITH TIME ZONE;

-- Create index for processing status
CREATE INDEX IF NOT EXISTS idx_course_materials_processing_status 
ON course_materials(tenant_id, processing_status);

-- Grant permissions to application role (if exists)
-- Note: Adjust role name based on your setup
-- GRANT SELECT, INSERT, UPDATE, DELETE ON course_materials TO app_role;
-- GRANT USAGE ON SEQUENCE course_materials_id_seq TO app_role;

-- Add constraints for file validation
ALTER TABLE course_materials 
ADD CONSTRAINT chk_file_size_positive CHECK (file_size > 0),
ADD CONSTRAINT chk_file_type_not_empty CHECK (file_type != ''),
ADD CONSTRAINT chk_title_not_empty CHECK (title != ''),
ADD CONSTRAINT chk_file_name_not_empty CHECK (file_name != ''),
ADD CONSTRAINT chk_minio_key_not_empty CHECK (minio_key != '');

-- Add unique constraint for minio_key per tenant (prevent duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_materials_minio_key_unique 
ON course_materials(tenant_id, minio_key);

-- Comments for documentation
COMMENT ON TABLE course_materials IS 'Stores course materials metadata with file storage references and embeddings for semantic search';
COMMENT ON COLUMN course_materials.minio_key IS 'MinIO object key for file storage with tenant prefix';
COMMENT ON COLUMN course_materials.content_text IS 'Extracted text content from PDF/PowerPoint files for embedding generation';
COMMENT ON COLUMN course_materials.embedding IS 'OpenAI text-embedding-3-small vector (1536 dimensions) for semantic search';
COMMENT ON COLUMN course_materials.processing_status IS 'Status of background processing for text extraction and embedding generation';
