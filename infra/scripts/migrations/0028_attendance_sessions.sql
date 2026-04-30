-- Migration: Teacher Attendance Sessions System
-- Date: 2025-01-27
-- Description: Create teacher_attendance_sessions and teacher_attendance_records tables

-- ========================================
-- TABLE: teacher_attendance_sessions
-- ========================================
-- Stores actual attendance sessions that have been created
-- Links to: teacher_assignments, attendance_records

CREATE TABLE IF NOT EXISTS teacher_attendance_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Link to the teacher assignment
    assignment_id UUID NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,

    -- Optional link to class course for reporting
    class_course_id UUID REFERENCES class_courses(id) ON DELETE SET NULL,

    -- Session details
    session_date DATE NOT NULL,
    time_slot VARCHAR(20) NOT NULL CHECK (time_slot IN ('08:00-12:00', '13:00-17:00', '18:00-20:00')),
    session_title VARCHAR(255) NOT NULL,

    -- Duration in hours (calculated from time slot)
    duration_hours INTEGER NOT NULL,

    -- Teacher who created the session
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,

    -- Status
    status VARCHAR(50) DEFAULT 'completed' CHECK (status IN ('draft', 'completed', 'cancelled')),

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT teacher_attendance_sessions_unique_assignment_date_slot
        UNIQUE (tenant_id, assignment_id, session_date, time_slot)
);

-- Indexes for teacher_attendance_sessions
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_sessions_tenant ON teacher_attendance_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_sessions_assignment ON teacher_attendance_sessions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_sessions_teacher ON teacher_attendance_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_sessions_date ON teacher_attendance_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_sessions_status ON teacher_attendance_sessions(status);

-- RLS for teacher_attendance_sessions
ALTER TABLE teacher_attendance_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY teacher_attendance_sessions_tenant_isolation ON teacher_attendance_sessions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Trigger for updated_at on teacher_attendance_sessions
DROP TRIGGER IF EXISTS update_teacher_attendance_sessions_updated_at ON teacher_attendance_sessions;
CREATE TRIGGER update_teacher_attendance_sessions_updated_at
    BEFORE UPDATE ON teacher_attendance_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- TABLE: teacher_attendance_records
-- ========================================

CREATE TABLE IF NOT EXISTS teacher_attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES teacher_attendance_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    attendance_status attendance_status NOT NULL,
    notes TEXT,
    marked_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marked_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT teacher_attendance_records_unique_student UNIQUE (tenant_id, session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_attendance_records_tenant ON teacher_attendance_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_records_session ON teacher_attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_records_student ON teacher_attendance_records(student_id);

ALTER TABLE teacher_attendance_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY teacher_attendance_records_tenant_isolation ON teacher_attendance_records
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DROP TRIGGER IF EXISTS update_teacher_attendance_records_updated_at ON teacher_attendance_records;
CREATE TRIGGER update_teacher_attendance_records_updated_at
    BEFORE UPDATE ON teacher_attendance_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- VIEW: teacher_attendance_sessions_with_details
-- ========================================
-- View for easier querying with assignment and teacher details

CREATE OR REPLACE VIEW teacher_attendance_sessions_with_details AS
SELECT
    asess.*,
    ta.course_name,
    ta.course_code,
    ta.class_name,
    ta.class_code,
    t.first_name || ' ' || t.last_name as teacher_name,
    u.email as teacher_email
FROM teacher_attendance_sessions asess
LEFT JOIN teacher_assignments ta ON asess.assignment_id = ta.id
LEFT JOIN teachers t ON asess.teacher_id = t.id
LEFT JOIN users u ON t.user_id = u.id;

-- Grant permissions on the view
GRANT SELECT ON teacher_attendance_sessions_with_details TO authenticated;
