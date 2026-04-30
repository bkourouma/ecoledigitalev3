-- Migration: Cleanup Old Schedule Generation Tables
-- Date: 2025-11-01
-- Description: Remove old complex schedule generation tables that are no longer used
-- After simplification migration 0026, these tables are obsolete

-- ========================================
-- DROP OLD TABLES (ORDER MATTERS DUE TO FK)
-- ========================================

-- Drop views that depend on old tables first
DROP VIEW IF EXISTS calendar_sessions CASCADE;

-- Drop tables in dependency order
DROP TABLE IF EXISTS session_instances CASCADE;  -- Will be recreated with new schema
DROP TABLE IF EXISTS scheduled_sessions CASCADE;
DROP TABLE IF EXISTS approved_schedules CASCADE;
DROP TABLE IF EXISTS generated_schedules CASCADE;
DROP TABLE IF EXISTS schedule_generation_requests CASCADE;

-- ========================================
-- RECREATE session_instances WITH CLEAN SCHEMA
-- ========================================
-- This is the only table we need now

CREATE TABLE session_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Direct session assignment (no templates)
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

-- ========================================
-- INDEXES FOR PERFORMANCE
-- ========================================

CREATE INDEX idx_session_instances_tenant ON session_instances(tenant_id);
CREATE INDEX idx_session_instances_class ON session_instances(class_id);
CREATE INDEX idx_session_instances_course ON session_instances(course_id);
CREATE INDEX idx_session_instances_teacher ON session_instances(teacher_id);
CREATE INDEX idx_session_instances_date ON session_instances(session_date);
CREATE INDEX idx_session_instances_datetime ON session_instances(start_datetime, end_datetime);
CREATE INDEX idx_session_instances_status ON session_instances(status);

-- ========================================
-- ROW LEVEL SECURITY
-- ========================================

ALTER TABLE session_instances ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY session_instances_tenant_isolation ON session_instances
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ========================================
-- TRIGGERS
-- ========================================

DROP TRIGGER IF EXISTS update_session_instances_updated_at ON session_instances;
CREATE TRIGGER update_session_instances_updated_at
    BEFORE UPDATE ON session_instances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- COMMENTS
-- ========================================

COMMENT ON TABLE session_instances IS 'Individual course sessions - simplified direct storage, no templates';
COMMENT ON COLUMN session_instances.class_id IS 'Direct reference to class';
COMMENT ON COLUMN session_instances.course_id IS 'Direct reference to course';
COMMENT ON COLUMN session_instances.duration_minutes IS 'Session duration calculated from times';

SELECT 'Migration 0027 completed - Old schedule tables removed, session_instances recreated' as result;

