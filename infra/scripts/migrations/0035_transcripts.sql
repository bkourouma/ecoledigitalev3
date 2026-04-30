-- Migration: 0035_transcripts.sql
-- Description: Create table for transcripts (relevés de notes)
-- Date: 2025-01-27

-- Create transcripts table
CREATE TABLE IF NOT EXISTS transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    transcript_date DATE NOT NULL,
    total_credits INTEGER NOT NULL DEFAULT 0 CHECK (total_credits >= 0),
    gpa DECIMAL(5,2) NOT NULL CHECK (gpa >= 0 AND gpa <= 20),
    transcript_url VARCHAR(500), -- URL to the transcript file (PDF, etc.)
    downloadable BOOLEAN DEFAULT true,
    viewable BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT transcripts_tenant_student_year_unique UNIQUE (tenant_id, student_id, academic_year_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_transcripts_tenant_id ON transcripts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_student_id ON transcripts(student_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_academic_year_id ON transcripts(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_transcript_date ON transcripts(transcript_date);

-- Enable Row Level Security
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for transcripts
CREATE POLICY transcripts_tenant_policy ON transcripts
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_transcripts_updated_at
    BEFORE UPDATE ON transcripts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE transcripts IS 'Transcripts (relevés de notes) for students, including GPA and total credits';
COMMENT ON COLUMN transcripts.transcript_date IS 'Date when the transcript was issued';
COMMENT ON COLUMN transcripts.total_credits IS 'Total credits earned by the student';
COMMENT ON COLUMN transcripts.gpa IS 'Grade point average (0-20)';
COMMENT ON COLUMN transcripts.transcript_url IS 'URL to the transcript file (PDF, HTML, etc.)';
COMMENT ON COLUMN transcripts.downloadable IS 'Whether the transcript can be downloaded';
COMMENT ON COLUMN transcripts.viewable IS 'Whether the transcript can be viewed in browser';

-- Migration complete
SELECT 'Migration 0035_transcripts.sql completed successfully' as result;

