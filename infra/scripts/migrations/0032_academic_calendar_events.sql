-- Migration: 0032_academic_calendar_events.sql
-- Description: Create table for academic calendar events
-- Date: 2025-01-27

-- Create ENUM type for academic calendar event types
DO $$ BEGIN
    CREATE TYPE academic_calendar_event_type AS ENUM (
        'semester_start',
        'semester_end',
        'holiday',
        'break',
        'special_event',
        'academic_milestone'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create academic_calendar_events table
CREATE TABLE IF NOT EXISTS academic_calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type academic_calendar_event_type NOT NULL DEFAULT 'special_event',
    event_date DATE NOT NULL,
    description TEXT,
    semester INTEGER CHECK (semester >= 1 AND semester <= 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT academic_calendar_events_tenant_year_name_unique UNIQUE (tenant_id, academic_year_id, name, event_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_academic_calendar_events_tenant_id ON academic_calendar_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_events_academic_year_id ON academic_calendar_events(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_events_event_date ON academic_calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_events_type ON academic_calendar_events(type);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_events_semester ON academic_calendar_events(semester);

-- Enable Row Level Security
ALTER TABLE academic_calendar_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for academic_calendar_events
CREATE POLICY academic_calendar_events_tenant_policy ON academic_calendar_events
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_academic_calendar_events_updated_at
    BEFORE UPDATE ON academic_calendar_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE academic_calendar_events IS 'Academic calendar events such as semester starts, holidays, breaks, and special events';
COMMENT ON COLUMN academic_calendar_events.type IS 'Type of academic calendar event: semester_start, semester_end, holiday, break, special_event, academic_milestone';
COMMENT ON COLUMN academic_calendar_events.semester IS 'Semester number (1-8) associated with the event, if applicable';
COMMENT ON COLUMN academic_calendar_events.event_date IS 'Date of the academic calendar event';

-- Migration complete
SELECT 'Migration 0032_academic_calendar_events.sql completed successfully' as result;

