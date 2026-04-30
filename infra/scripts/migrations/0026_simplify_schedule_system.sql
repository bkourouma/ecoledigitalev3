-- Migration: Simplify Schedule System
-- Date: 2025-11-01
-- Description: Simplified schedule generation - direct to session_instances, no intermediate tables
-- This removes complexity and makes the system easier to use
--
-- ⚠️ SUPERSEDED: This migration is replaced by 0027_cleanup_old_schedule_tables.sql
-- which fully drops old tables and recreates session_instances with correct schema

-- ========================================
-- DROP OLD COMPLEX TABLES (BACKUP FIRST!)
-- ========================================

-- Note: Commenting out drops for safety. Uncomment if you want to remove old tables
-- DROP TABLE IF EXISTS session_instances CASCADE;
-- DROP TABLE IF EXISTS scheduled_sessions CASCADE;
-- DROP TABLE IF EXISTS approved_schedules CASCADE;
-- DROP TABLE IF EXISTS generated_schedules CASCADE;
-- DROP TABLE IF EXISTS schedule_generation_requests CASCADE;

-- ========================================
-- SIMPLIFIED session_instances TABLE
-- ========================================
-- This table now stores individual sessions directly, no templates

DROP TABLE IF EXISTS session_instances CASCADE;

CREATE TABLE session_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Session assignment
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
    
    -- Session date/time
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ NOT NULL,
    
    -- Session details
    classroom VARCHAR(255),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    
    -- Session status
    status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    attendance_taken BOOLEAN DEFAULT false,
    notes TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Constraints
    CONSTRAINT session_instances_datetime_order CHECK (start_datetime < end_datetime),
    CONSTRAINT session_instances_time_order CHECK (start_time < end_time)
);

-- Indexes
CREATE INDEX idx_session_instances_tenant ON session_instances(tenant_id);
CREATE INDEX idx_session_instances_class ON session_instances(class_id);
CREATE INDEX idx_session_instances_course ON session_instances(course_id);
CREATE INDEX idx_session_instances_teacher ON session_instances(teacher_id);
CREATE INDEX idx_session_instances_date ON session_instances(session_date);
CREATE INDEX idx_session_instances_datetime ON session_instances(start_datetime, end_datetime);
CREATE INDEX idx_session_instances_status ON session_instances(status);

-- RLS
ALTER TABLE session_instances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY session_instances_tenant_isolation ON session_instances
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Trigger
DROP TRIGGER IF EXISTS update_session_instances_updated_at ON session_instances;
CREATE TRIGGER update_session_instances_updated_at
    BEFORE UPDATE ON session_instances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE session_instances IS 'Individual course sessions - simplified direct storage, no templates';
COMMENT ON COLUMN session_instances.class_id IS 'Direct reference to class';
COMMENT ON COLUMN session_instances.course_id IS 'Direct reference to course';
COMMENT ON COLUMN session_instances.duration_minutes IS 'Session duration calculated from times';

SELECT 'Migration 0026_simplify_schedule_system.sql completed - Simplified session storage' as result;

