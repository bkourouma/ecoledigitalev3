-- Migration: 0034_report_cards.sql
-- Description: Create table for report cards
-- Date: 2025-01-27

-- Create report_cards table
CREATE TABLE IF NOT EXISTS report_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    semester INTEGER NOT NULL CHECK (semester >= 1 AND semester <= 8),
    report_date DATE NOT NULL,
    overall_grade DECIMAL(5,2) NOT NULL CHECK (overall_grade >= 0 AND overall_grade <= 20),
    report_url VARCHAR(500), -- URL to the report file (PDF, etc.)
    downloadable BOOLEAN DEFAULT true,
    viewable BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT report_cards_tenant_student_year_semester_unique UNIQUE (tenant_id, student_id, academic_year_id, semester)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_report_cards_tenant_id ON report_cards(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_student_id ON report_cards(student_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_academic_year_id ON report_cards(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_semester ON report_cards(semester);
CREATE INDEX IF NOT EXISTS idx_report_cards_report_date ON report_cards(report_date);

-- Enable Row Level Security
ALTER TABLE report_cards ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for report_cards
CREATE POLICY report_cards_tenant_policy ON report_cards
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_report_cards_updated_at
    BEFORE UPDATE ON report_cards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE report_cards IS 'Report cards for students, including semester grades and overall performance';
COMMENT ON COLUMN report_cards.semester IS 'Semester number (1-8) for which the report card is issued';
COMMENT ON COLUMN report_cards.report_date IS 'Date when the report card was issued';
COMMENT ON COLUMN report_cards.overall_grade IS 'Overall grade for the semester (0-20)';
COMMENT ON COLUMN report_cards.report_url IS 'URL to the report card file (PDF, HTML, etc.)';
COMMENT ON COLUMN report_cards.downloadable IS 'Whether the report card can be downloaded';
COMMENT ON COLUMN report_cards.viewable IS 'Whether the report card can be viewed in browser';

-- Migration complete
SELECT 'Migration 0034_report_cards.sql completed successfully' as result;

