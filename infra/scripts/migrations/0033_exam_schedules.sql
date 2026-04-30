-- Migration: 0033_exam_schedules.sql
-- Description: Create table for exam schedules
-- Date: 2025-01-27

-- Create ENUM type for exam types
DO $$ BEGIN
    CREATE TYPE exam_type AS ENUM (
        'midterm',
        'final',
        'quiz',
        'assignment',
        'other'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create exam_schedules table
CREATE TABLE IF NOT EXISTS exam_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type exam_type NOT NULL DEFAULT 'other',
    exam_date DATE NOT NULL,
    exam_time TIME,
    duration INTEGER, -- Duration in minutes
    location VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT exam_schedules_tenant_course_date_unique UNIQUE (tenant_id, course_id, name, exam_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_exam_schedules_tenant_id ON exam_schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_course_id ON exam_schedules(course_id);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_academic_year_id ON exam_schedules(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_exam_date ON exam_schedules(exam_date);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_type ON exam_schedules(type);

-- Enable Row Level Security
ALTER TABLE exam_schedules ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for exam_schedules
CREATE POLICY exam_schedules_tenant_policy ON exam_schedules
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_exam_schedules_updated_at
    BEFORE UPDATE ON exam_schedules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE exam_schedules IS 'Exam schedules for courses, including midterm exams, final exams, quizzes, assignments, and other exam types';
COMMENT ON COLUMN exam_schedules.type IS 'Type of exam: midterm, final, quiz, assignment, other';
COMMENT ON COLUMN exam_schedules.exam_date IS 'Date of the exam';
COMMENT ON COLUMN exam_schedules.exam_time IS 'Time of the exam (HH:MM format)';
COMMENT ON COLUMN exam_schedules.duration IS 'Duration of the exam in minutes';
COMMENT ON COLUMN exam_schedules.location IS 'Location where the exam will take place';

-- Migration complete
SELECT 'Migration 0033_exam_schedules.sql completed successfully' as result;

