-- Migration: 0036_attendance_reports.sql
-- Description: Create table for attendance reports (rapports de présence)
-- Date: 2025-01-27

-- Create attendance_reports table
CREATE TABLE IF NOT EXISTS attendance_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    report_period VARCHAR(100), -- Period of the report (e.g., "Q1 2024", "Semester 1", "January 2024")
    report_date DATE NOT NULL,
    attendance_rate DECIMAL(5,2) NOT NULL CHECK (attendance_rate >= 0 AND attendance_rate <= 100),
    total_days INTEGER NOT NULL DEFAULT 0 CHECK (total_days >= 0),
    present_days INTEGER NOT NULL DEFAULT 0 CHECK (present_days >= 0),
    absent_days INTEGER NOT NULL DEFAULT 0 CHECK (absent_days >= 0),
    report_url VARCHAR(500), -- URL to the report file (PDF, etc.)
    downloadable BOOLEAN DEFAULT true,
    viewable BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT attendance_reports_present_absent_total CHECK (present_days + absent_days <= total_days)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_reports_tenant_id ON attendance_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_reports_student_id ON attendance_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_reports_academic_year_id ON attendance_reports(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_attendance_reports_report_date ON attendance_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_attendance_reports_tenant_student_year ON attendance_reports(tenant_id, student_id, academic_year_id);

-- Enable Row Level Security
ALTER TABLE attendance_reports ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for attendance_reports
CREATE POLICY attendance_reports_tenant_policy ON attendance_reports
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_attendance_reports_updated_at
    BEFORE UPDATE ON attendance_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE attendance_reports IS 'Attendance reports for students, including attendance rate, present/absent days, and total days';
COMMENT ON COLUMN attendance_reports.report_period IS 'Period of the report (e.g., "Q1 2024", "Semester 1", "January 2024")';
COMMENT ON COLUMN attendance_reports.report_date IS 'Date when the attendance report was issued';
COMMENT ON COLUMN attendance_reports.attendance_rate IS 'Attendance rate as a percentage (0-100)';
COMMENT ON COLUMN attendance_reports.total_days IS 'Total number of days in the period';
COMMENT ON COLUMN attendance_reports.present_days IS 'Number of days the student was present';
COMMENT ON COLUMN attendance_reports.absent_days IS 'Number of days the student was absent';
COMMENT ON COLUMN attendance_reports.report_url IS 'URL to the attendance report file (PDF, HTML, etc.)';
COMMENT ON COLUMN attendance_reports.downloadable IS 'Whether the attendance report can be downloaded';
COMMENT ON COLUMN attendance_reports.viewable IS 'Whether the attendance report can be viewed in browser';

-- Migration complete
SELECT 'Migration 0036_attendance_reports.sql completed successfully' as result;

