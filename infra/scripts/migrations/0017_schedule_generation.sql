-- EcoleDigitale Database Schema Migration 0017
-- Creates schedule generation system for automatic timetable creation
-- This migration adds comprehensive schedule generation functionality
-- 
-- ⚠️ DEPRECATED: This migration is superseded by migration 0026/0027
-- Tables: scheduled_sessions, generated_schedules, approved_schedules, schedule_generation_requests
-- have been removed in favor of simplified direct session_instances approach

-- Enable UUID extension (should already exist)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- ENUM TYPES FOR SCHEDULE GENERATION SYSTEM
-- ========================================

-- Status for schedule generation requests
CREATE TYPE schedule_generation_status AS ENUM (
    'pending',      -- Request is queued for processing
    'processing',   -- Generation algorithm is running
    'completed',    -- Generation completed successfully
    'failed',       -- Generation failed due to constraints
    'cancelled'     -- Request was cancelled by user
);

-- Week pattern types for recurring schedules
CREATE TYPE week_pattern_type AS ENUM (
    'weekly',       -- Every week
    'biweekly',     -- Every two weeks
    'monthly',      -- Monthly pattern
    'custom'        -- Custom pattern defined by user
);

-- Day of week enum for time slots
CREATE TYPE day_of_week AS ENUM (
    'monday',
    'tuesday', 
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday'
);

-- ========================================
-- TIME SLOTS TABLE
-- ========================================

-- Configurable time slots for schedule generation
CREATE TABLE IF NOT EXISTS time_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Time slot definition
    name VARCHAR(100) NOT NULL,
    day_of_week day_of_week NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    
    -- Metadata
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 1, -- Higher priority slots are preferred
    max_concurrent_sessions INTEGER DEFAULT 1,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT time_slots_valid_time CHECK (start_time < end_time),
    CONSTRAINT time_slots_priority_positive CHECK (priority > 0),
    CONSTRAINT time_slots_max_sessions_positive CHECK (max_concurrent_sessions > 0)
);

-- ========================================
-- SCHEDULE GENERATION REQUESTS TABLE
-- ========================================

-- Tracks schedule generation requests and their parameters
CREATE TABLE IF NOT EXISTS schedule_generation_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Request metadata
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Generation parameters
    selected_courses JSONB NOT NULL, -- Array of course IDs with their required hours
    available_time_slots JSONB NOT NULL, -- Array of time slot IDs
    generation_preferences JSONB DEFAULT '{}', -- Optional preferences (balance, constraints)
    
    -- Request status
    status schedule_generation_status DEFAULT 'pending',
    error_message TEXT,
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- GENERATED SCHEDULES TABLE
-- ========================================

-- Stores the results of schedule generation
CREATE TABLE IF NOT EXISTS generated_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Links to generation request
    generation_request_id UUID NOT NULL REFERENCES schedule_generation_requests(id) ON DELETE CASCADE,
    
    -- Schedule data
    schedule_data JSONB NOT NULL, -- Complete schedule with sessions, times, rooms
    optimization_score DECIMAL(5,2), -- Quality score of the generated schedule
    conflicts_detected JSONB DEFAULT '[]', -- Array of detected conflicts
    
    -- Metadata
    generation_algorithm VARCHAR(50) DEFAULT 'genetic',
    generation_duration_ms INTEGER,
    is_approved BOOLEAN DEFAULT false,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- SCHEDULED SESSIONS TABLE
-- ========================================

-- Final approved sessions that will be used for attendance
CREATE TABLE IF NOT EXISTS scheduled_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Links to generated schedule
    generated_schedule_id UUID NOT NULL REFERENCES generated_schedules(id) ON DELETE CASCADE,
    
    -- Session details (similar to attendance_sessions but for planning)
    class_course_id UUID NOT NULL REFERENCES class_courses(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
    classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
    
    -- Timing information
    day_of_week day_of_week NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL,
    
    -- Recurrence pattern
    week_pattern week_pattern_type DEFAULT 'weekly',
    start_date DATE NOT NULL,
    end_date DATE,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT scheduled_sessions_valid_time CHECK (start_time < end_time),
    CONSTRAINT scheduled_sessions_valid_duration CHECK (duration_minutes > 0),
    CONSTRAINT scheduled_sessions_valid_dates CHECK (start_date <= COALESCE(end_date, start_date))
);

-- ========================================
-- INDEXES FOR PERFORMANCE
-- ========================================

-- Time slots indexes
CREATE INDEX IF NOT EXISTS idx_time_slots_tenant_id ON time_slots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_time_slots_day_time ON time_slots(day_of_week, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_time_slots_active ON time_slots(tenant_id, is_active);

-- Schedule generation requests indexes
CREATE INDEX IF NOT EXISTS idx_schedule_requests_tenant_id ON schedule_generation_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_schedule_requests_class_id ON schedule_generation_requests(class_id);
CREATE INDEX IF NOT EXISTS idx_schedule_requests_status ON schedule_generation_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_schedule_requests_requested_by ON schedule_generation_requests(requested_by);

-- Generated schedules indexes
CREATE INDEX IF NOT EXISTS idx_generated_schedules_tenant_id ON generated_schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_generated_schedules_request_id ON generated_schedules(generation_request_id);
CREATE INDEX IF NOT EXISTS idx_generated_schedules_approved ON generated_schedules(tenant_id, is_approved);

-- Scheduled sessions indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_tenant_id ON scheduled_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_schedule_id ON scheduled_sessions(generated_schedule_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_class_course ON scheduled_sessions(class_course_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_teacher ON scheduled_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_classroom ON scheduled_sessions(classroom_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_timing ON scheduled_sessions(day_of_week, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_active ON scheduled_sessions(tenant_id, is_active);

-- ========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================

-- Enable RLS on all tables
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_sessions ENABLE ROW LEVEL SECURITY;

-- Time slots policies
CREATE POLICY time_slots_tenant_isolation ON time_slots
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Schedule generation requests policies  
CREATE POLICY schedule_requests_tenant_isolation ON schedule_generation_requests
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Generated schedules policies
CREATE POLICY generated_schedules_tenant_isolation ON generated_schedules
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Scheduled sessions policies
CREATE POLICY scheduled_sessions_tenant_isolation ON scheduled_sessions
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- ========================================
-- TRIGGERS FOR UPDATED_AT
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for all tables
CREATE TRIGGER update_time_slots_updated_at
    BEFORE UPDATE ON time_slots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_schedule_requests_updated_at
    BEFORE UPDATE ON schedule_generation_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_generated_schedules_updated_at
    BEFORE UPDATE ON generated_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scheduled_sessions_updated_at
    BEFORE UPDATE ON scheduled_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- SAMPLE DATA FOR DEVELOPMENT
-- ========================================

-- Insert default time slots for Imhotep Academy
INSERT INTO time_slots (tenant_id, name, day_of_week, start_time, end_time, priority) VALUES
-- Monday
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Lundi Matin 1', 'monday', '08:00:00', '10:00:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Lundi Matin 2', 'monday', '10:15:00', '12:15:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Lundi Après-midi 1', 'monday', '14:00:00', '16:00:00', 2),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Lundi Après-midi 2', 'monday', '16:15:00', '18:15:00', 1),

-- Tuesday  
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Mardi Matin 1', 'tuesday', '08:00:00', '10:00:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Mardi Matin 2', 'tuesday', '10:15:00', '12:15:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Mardi Après-midi 1', 'tuesday', '14:00:00', '16:00:00', 2),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Mardi Après-midi 2', 'tuesday', '16:15:00', '18:15:00', 1),

-- Wednesday
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Mercredi Matin 1', 'wednesday', '08:00:00', '10:00:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Mercredi Matin 2', 'wednesday', '10:15:00', '12:15:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Mercredi Après-midi 1', 'wednesday', '14:00:00', '16:00:00', 2),

-- Thursday
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Jeudi Matin 1', 'thursday', '08:00:00', '10:00:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Jeudi Matin 2', 'thursday', '10:15:00', '12:15:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Jeudi Après-midi 1', 'thursday', '14:00:00', '16:00:00', 2),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Jeudi Après-midi 2', 'thursday', '16:15:00', '18:15:00', 1),

-- Friday
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Vendredi Matin 1', 'friday', '08:00:00', '10:00:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Vendredi Matin 2', 'friday', '10:15:00', '12:15:00', 3),
('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Vendredi Après-midi 1', 'friday', '14:00:00', '16:00:00', 2);

-- Add comments for documentation
COMMENT ON TABLE time_slots IS 'Configurable time slots for schedule generation';
COMMENT ON TABLE schedule_generation_requests IS 'Tracks schedule generation requests and parameters';
COMMENT ON TABLE generated_schedules IS 'Stores results of schedule generation with optimization scores';
COMMENT ON TABLE scheduled_sessions IS 'Final approved sessions for attendance tracking';

COMMENT ON COLUMN time_slots.priority IS 'Higher priority slots are preferred during generation (1=low, 3=high)';
COMMENT ON COLUMN generated_schedules.optimization_score IS 'Quality score of generated schedule (0-100)';
COMMENT ON COLUMN scheduled_sessions.week_pattern IS 'Recurrence pattern for the session';
