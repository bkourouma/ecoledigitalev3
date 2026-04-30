-- Migration: Schedule Generation System Consolidation
-- Date: 2025-01-27
-- Description: Consolidate schedule generation tables to match actual database schema and remove duplicates
-- This migration ensures all schedule-related tables use consistent column names
--
-- ⚠️ DEPRECATED: This migration is superseded by migration 0027
-- The consolidation approach was replaced by complete simplification

-- ========================================
-- TABLE 1: schedule_generation_requests (already exists, fix if needed)
-- ========================================
-- Creates requests for schedule generation with parameters

-- ========================================
-- TABLE 2: generated_schedules (already exists)
-- ========================================
-- Stores the results of schedule generation algorithm
-- Links to: schedule_generation_requests

-- ========================================
-- TABLE 3: approved_schedules (ensure exists with correct schema)
-- ========================================
CREATE TABLE IF NOT EXISTS approved_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    generation_request_id VARCHAR(255) NOT NULL,  -- Links to request ID
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    approved_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Academic period
    academic_start_date DATE NOT NULL,
    academic_end_date DATE,
    academic_year VARCHAR(20),
    semester VARCHAR(50),
    
    -- Schedule metrics
    total_sessions INTEGER DEFAULT 0,
    total_hours NUMERIC(8,2) DEFAULT 0,
    optimization_score NUMERIC(5,2),
    generation_algorithm VARCHAR(100),
    
    -- Status management
    is_active BOOLEAN DEFAULT true,
    deactivated_at TIMESTAMPTZ,
    deactivated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    deactivation_reason TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Uniqueness: one approved schedule per request
    CONSTRAINT approved_schedules_request_unique UNIQUE (generation_request_id)
);

-- Indexes for approved_schedules
CREATE INDEX IF NOT EXISTS idx_approved_schedules_tenant ON approved_schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_approved_schedules_request ON approved_schedules(generation_request_id);
CREATE INDEX IF NOT EXISTS idx_approved_schedules_class ON approved_schedules(class_id);
CREATE INDEX IF NOT EXISTS idx_approved_schedules_active ON approved_schedules(is_active);
CREATE INDEX IF NOT EXISTS idx_approved_schedules_academic_dates ON approved_schedules(academic_start_date, academic_end_date);

-- RLS for approved_schedules
ALTER TABLE approved_schedules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY approved_schedules_tenant_isolation ON approved_schedules
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Trigger for updated_at on approved_schedules
DROP TRIGGER IF EXISTS update_approved_schedules_updated_at ON approved_schedules;
CREATE TRIGGER update_approved_schedules_updated_at
    BEFORE UPDATE ON approved_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ========================================
-- TABLE 4: scheduled_sessions (ensure exists with correct schema)
-- ========================================
-- Final approved recurring sessions that will generate instances
-- Links to: generation_request_id, class_id, course_id
-- Note: This table stores the WEEKLY RECURRING pattern

CREATE TABLE IF NOT EXISTS scheduled_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Link to generation request
    generation_request_id VARCHAR(255) NOT NULL,
    
    -- Session assignment (direct references for simplicity)
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
    classroom_name VARCHAR(255),  -- Direct storage for flexibility
    
    -- Recurring pattern
    day_of_week VARCHAR(20) NOT NULL CHECK (day_of_week IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    week_pattern VARCHAR(50) DEFAULT 'weekly' CHECK (week_pattern IN ('weekly', 'biweekly', 'monthly')),
    
    -- Recurrence date range
    start_date DATE NOT NULL,
    end_date DATE,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Approval tracking
    approved_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT scheduled_sessions_time_order CHECK (start_time < end_time),
    CONSTRAINT scheduled_sessions_dates_order CHECK (start_date <= COALESCE(end_date, start_date))
);

-- Indexes for scheduled_sessions
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_tenant ON scheduled_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_class ON scheduled_sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_course ON scheduled_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_teacher ON scheduled_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_day ON scheduled_sessions(day_of_week);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_dates ON scheduled_sessions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_active ON scheduled_sessions(is_active);

-- RLS for scheduled_sessions
ALTER TABLE scheduled_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY scheduled_sessions_tenant_isolation ON scheduled_sessions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Trigger for updated_at on scheduled_sessions
DROP TRIGGER IF EXISTS update_scheduled_sessions_updated_at ON scheduled_sessions;
CREATE TRIGGER update_scheduled_sessions_updated_at
    BEFORE UPDATE ON scheduled_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- TABLE 5: session_instances (ensure exists with correct schema)
-- ========================================
-- Individual session dates generated from scheduled_sessions
-- Links to: scheduled_sessions
-- Note: This table stores the ACTUAL CALENDAR DATES

CREATE TABLE IF NOT EXISTS session_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    scheduled_session_id UUID NOT NULL REFERENCES scheduled_sessions(id) ON DELETE CASCADE,
    
    -- Actual session date/time
    session_date DATE NOT NULL,
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ NOT NULL,
    
    -- Session status
    status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    attendance_taken BOOLEAN DEFAULT false,
    notes TEXT,
    
    -- Override fields (if session needs different teacher/room than template)
    actual_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
    actual_classroom VARCHAR(255),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT session_instances_datetime_order CHECK (start_datetime < end_datetime),
    CONSTRAINT session_instances_unique_date UNIQUE (scheduled_session_id, session_date)
);

-- Indexes for session_instances
CREATE INDEX IF NOT EXISTS idx_session_instances_tenant ON session_instances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_session_instances_scheduled_session ON session_instances(scheduled_session_id);
CREATE INDEX IF NOT EXISTS idx_session_instances_date ON session_instances(session_date);
CREATE INDEX IF NOT EXISTS idx_session_instances_datetime ON session_instances(start_datetime, end_datetime);
CREATE INDEX IF NOT EXISTS idx_session_instances_status ON session_instances(status);

-- RLS for session_instances
ALTER TABLE session_instances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY session_instances_tenant_isolation ON session_instances
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Trigger for updated_at on session_instances
DROP TRIGGER IF EXISTS update_session_instances_updated_at ON session_instances;
CREATE TRIGGER update_session_instances_updated_at
    BEFORE UPDATE ON session_instances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- COMMENTS FOR DOCUMENTATION
-- ========================================
COMMENT ON TABLE approved_schedules IS 'Approved schedule generation requests with metadata';
COMMENT ON TABLE scheduled_sessions IS 'Recurring weekly session templates (e.g., Monday 2-4pm)';
COMMENT ON TABLE session_instances IS 'Individual calendar dates generated from scheduled_sessions';

COMMENT ON COLUMN scheduled_sessions.class_id IS 'Direct reference to classes table for easier querying';
COMMENT ON COLUMN scheduled_sessions.course_id IS 'Direct reference to courses table for easier querying';
COMMENT ON COLUMN scheduled_sessions.classroom_name IS 'Classroom name stored directly for flexibility';
COMMENT ON COLUMN session_instances.scheduled_session_id IS 'Link to parent recurring session template';

SELECT 'Migration 0025_schedule_consolidation.sql completed successfully - Schedule tables consolidated' as result;

