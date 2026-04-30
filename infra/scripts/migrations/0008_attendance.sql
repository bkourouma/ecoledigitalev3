-- EcoleDigitale Database Schema Migration 0008
-- Creates attendance tracking system with sessions and student attendance records
-- This migration adds comprehensive attendance management functionality

-- Enable UUID extension (should already exist)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- ENUM TYPES FOR ATTENDANCE SYSTEM
-- ========================================

-- Attendance status for individual student records
CREATE TYPE attendance_status AS ENUM (
    'present',      -- Student was present for the entire session
    'absent',       -- Student was absent without excuse
    'late',         -- Student arrived late but attended
    'excused',      -- Student was absent with valid excuse
    'medical_leave' -- Student on medical leave
);

-- Add new values to existing session_type enum
-- Note: session_type already exists with: theory, practical, exam, evaluation
ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'regular';
ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'makeup';
ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'field_trip';
ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'lab';

-- Session status for tracking session lifecycle
CREATE TYPE session_status AS ENUM (
    'scheduled',    -- Session is planned but not started
    'in_progress',  -- Session is currently active
    'completed',    -- Session has been completed
    'cancelled'     -- Session was cancelled
);

-- ========================================
-- ATTENDANCE SESSIONS TABLE
-- ========================================

-- Main table for attendance sessions
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    class_course_id UUID NOT NULL REFERENCES class_courses(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    
    -- Session timing information
    session_date DATE NOT NULL,
    session_time TIME NOT NULL,
    duration_minutes INTEGER DEFAULT 120,
    
    -- Session details
    session_type session_type DEFAULT 'theory',
    location VARCHAR(255),
    notes TEXT,
    
    -- Session status tracking
    status session_status DEFAULT 'scheduled',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT duration_positive CHECK (duration_minutes > 0),
    CONSTRAINT session_date_valid CHECK (session_date >= CURRENT_DATE - INTERVAL '1 year'),
    CONSTRAINT status_timestamps_consistent CHECK (
        (status = 'in_progress' AND started_at IS NOT NULL) OR
        (status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL) OR
        (status IN ('scheduled', 'cancelled'))
    )
);

-- ========================================
-- STUDENT ATTENDANCE TABLE
-- ========================================

-- Individual student attendance records for each session
CREATE TABLE IF NOT EXISTS student_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    
    -- Attendance details
    attendance_status attendance_status NOT NULL,
    arrival_time TIME,              -- For tracking late arrivals
    departure_time TIME,            -- For tracking early departures
    
    -- Excuse and documentation
    excuse_reason TEXT,
    excuse_document_url TEXT,
    
    -- Audit information
    marked_by UUID NOT NULL REFERENCES users(id),
    marked_at TIMESTAMPTZ DEFAULT NOW(),
    is_makeup BOOLEAN DEFAULT FALSE,
    notes TEXT,
    
    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT arrival_departure_logical CHECK (
        departure_time IS NULL OR arrival_time IS NULL OR departure_time >= arrival_time
    ),
    CONSTRAINT excuse_reason_required CHECK (
        (attendance_status IN ('excused', 'medical_leave') AND excuse_reason IS NOT NULL) OR
        (attendance_status NOT IN ('excused', 'medical_leave'))
    )
);

-- ========================================
-- INDEXES FOR PERFORMANCE
-- ========================================

-- Attendance sessions indexes
CREATE INDEX idx_attendance_sessions_tenant_id ON attendance_sessions(tenant_id);
CREATE INDEX idx_attendance_sessions_class_course_date ON attendance_sessions(tenant_id, class_course_id, session_date);
CREATE INDEX idx_attendance_sessions_teacher_date ON attendance_sessions(tenant_id, teacher_id, session_date);
CREATE INDEX idx_attendance_sessions_status ON attendance_sessions(tenant_id, status);
CREATE INDEX idx_attendance_sessions_date_range ON attendance_sessions(tenant_id, session_date);

-- Student attendance indexes
CREATE INDEX idx_student_attendance_tenant_id ON student_attendance(tenant_id);
CREATE INDEX idx_student_attendance_session ON student_attendance(tenant_id, session_id);
CREATE INDEX idx_student_attendance_student_status ON student_attendance(tenant_id, student_id, attendance_status);
CREATE INDEX idx_student_attendance_student_date ON student_attendance(tenant_id, student_id, created_at);
CREATE INDEX idx_student_attendance_marked_by ON student_attendance(tenant_id, marked_by);

-- ========================================
-- UNIQUE CONSTRAINTS
-- ========================================

-- Prevent duplicate attendance records for same student in same session
ALTER TABLE student_attendance ADD CONSTRAINT unique_student_session 
UNIQUE(tenant_id, session_id, student_id);

-- Prevent overlapping sessions for same class course (optional business rule)
-- Note: This is commented out as schools might have back-to-back sessions
-- CREATE UNIQUE INDEX unique_class_course_session_time 
-- ON attendance_sessions(tenant_id, class_course_id, session_date, session_time);

-- ========================================
-- ROW LEVEL SECURITY POLICIES
-- ========================================

-- Enable RLS on attendance tables
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_attendance ENABLE ROW LEVEL SECURITY;

-- RLS policies for attendance_sessions
CREATE POLICY attendance_sessions_tenant_isolation ON attendance_sessions
    FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- RLS policies for student_attendance  
CREATE POLICY student_attendance_tenant_isolation ON student_attendance
    FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ========================================
-- TRIGGERS FOR UPDATED_AT
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for attendance tables
CREATE TRIGGER update_attendance_sessions_updated_at 
    BEFORE UPDATE ON attendance_sessions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_student_attendance_updated_at 
    BEFORE UPDATE ON student_attendance 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- COMMENTS FOR DOCUMENTATION
-- ========================================

COMMENT ON TABLE attendance_sessions IS 'Attendance sessions for class courses with timing and status tracking';
COMMENT ON TABLE student_attendance IS 'Individual student attendance records for each session';

COMMENT ON COLUMN attendance_sessions.duration_minutes IS 'Expected duration of the session in minutes';
COMMENT ON COLUMN attendance_sessions.session_type IS 'Type of session: regular, makeup, exam, field_trip, lab, evaluation';
COMMENT ON COLUMN attendance_sessions.status IS 'Current status: scheduled, in_progress, completed, cancelled';

COMMENT ON COLUMN student_attendance.attendance_status IS 'Student attendance status: present, absent, late, excused, medical_leave';
COMMENT ON COLUMN student_attendance.arrival_time IS 'Time student arrived (for late tracking)';
COMMENT ON COLUMN student_attendance.departure_time IS 'Time student left (for early departure tracking)';
COMMENT ON COLUMN student_attendance.is_makeup IS 'Whether this attendance record is for a makeup session';
COMMENT ON COLUMN student_attendance.marked_by IS 'User who recorded this attendance (teacher, admin, etc.)';

-- ========================================
-- SAMPLE DATA FOR TESTING (OPTIONAL)
-- ========================================

-- Note: Sample data insertion would go here for testing purposes
-- This is commented out for production deployment

/*
-- Sample attendance session
INSERT INTO attendance_sessions (
    tenant_id, class_course_id, teacher_id, session_date, session_time, 
    duration_minutes, session_type, location, status
) VALUES (
    '6eb9c106-b650-4398-b6fa-091b6828c4ba',  -- Imhotep Academy tenant
    'B50e8400-e29b-41d4-a716-446655440001',  -- Sample class_course_id
    '950e8400-e29b-41d4-a716-446655440001',  -- Sample teacher_id
    CURRENT_DATE,
    '09:00:00',
    120,
    'regular',
    'Salle A101',
    'scheduled'
);
*/
