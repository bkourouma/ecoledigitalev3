-- EcoleDigitale Database Schema Migration 0002
-- Creates academic management tables (cycles, programmes, courses, teachers)

-- Create ENUM types for academic module
CREATE TYPE cycle_type AS ENUM ('academic', 'professional', 'short', 'certification');
CREATE TYPE cycle_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE programme_status AS ENUM ('draft', 'review', 'approved', 'active', 'archived');
CREATE TYPE course_status AS ENUM ('draft', 'active', 'inactive');
CREATE TYPE delivery_mode AS ENUM ('presential', 'remote', 'hybrid', 'elearning');
CREATE TYPE contract_type AS ENUM ('permanent', 'temporary', 'freelance');
CREATE TYPE teacher_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE session_type AS ENUM ('theory', 'practical', 'exam', 'evaluation');

-- Create cycles table (academic cycles like BTS, Post-BTS, etc.)
CREATE TABLE IF NOT EXISTS cycles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(20) NOT NULL,
    type cycle_type NOT NULL,
    duration_months INTEGER NOT NULL,
    description TEXT,
    certification_level VARCHAR(50),
    status cycle_status DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- Create programmes table (academic programmes within cycles)
CREATE TABLE IF NOT EXISTS programmes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(20) NOT NULL,
    version VARCHAR(10) DEFAULT '1.0',
    description TEXT,
    objectives TEXT[],
    ects_credits INTEGER,
    academic_year VARCHAR(9),
    status programme_status DEFAULT 'draft',
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, code, version)
);

-- Create teaching_units table (unités d'enseignement)
CREATE TABLE IF NOT EXISTS teaching_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(20) NOT NULL,
    ects_credits INTEGER,
    semester INTEGER CHECK (semester BETWEEN 1 AND 8),
    is_mandatory BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create courses table (cours/matières)
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    teaching_unit_id UUID NOT NULL REFERENCES teaching_units(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(20) NOT NULL,
    description TEXT,
    objectives TEXT[],
    hours_total INTEGER NOT NULL,
    hours_theory INTEGER DEFAULT 0,
    hours_practical INTEGER DEFAULT 0,
    delivery_mode delivery_mode NOT NULL,
    prerequisites TEXT[],
    evaluation_methods TEXT[],
    resources JSONB DEFAULT '{}',
    status course_status DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create teachers table (enseignants/vacataires)
CREATE TABLE IF NOT EXISTS teachers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    employee_number VARCHAR(20),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    specialties TEXT[],
    bio TEXT,
    qualifications TEXT[],
    hire_date DATE,
    contract_type contract_type NOT NULL,
    hourly_rate DECIMAL(8,2),
    status teacher_status DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- Create course_assignments table (attribution cours-enseignants)
CREATE TABLE IF NOT EXISTS course_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    academic_year VARCHAR(9) NOT NULL,
    semester INTEGER,
    hours_assigned INTEGER NOT NULL,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, course_id, teacher_id, academic_year, semester)
);

-- Create teaching_hours table (suivi des heures enseignées)
CREATE TABLE IF NOT EXISTS teaching_hours (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL REFERENCES course_assignments(id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    hours_taught DECIMAL(4,2) NOT NULL,
    session_type session_type NOT NULL,
    notes TEXT,
    validated_by UUID REFERENCES users(id),
    validated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security for all academic tables
ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmes ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_hours ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for cycles
CREATE POLICY cycles_tenant_policy ON cycles
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for programmes
CREATE POLICY programmes_tenant_policy ON programmes
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for teaching_units
CREATE POLICY teaching_units_tenant_policy ON teaching_units
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for courses
CREATE POLICY courses_tenant_policy ON courses
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for teachers
CREATE POLICY teachers_tenant_policy ON teachers
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for course_assignments
CREATE POLICY course_assignments_tenant_policy ON course_assignments
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for teaching_hours
CREATE POLICY teaching_hours_tenant_policy ON teaching_hours
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_cycles_tenant_id ON cycles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cycles_code ON cycles(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_cycles_status ON cycles(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_programmes_tenant_id ON programmes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_programmes_cycle_id ON programmes(cycle_id);
CREATE INDEX IF NOT EXISTS idx_programmes_code ON programmes(tenant_id, code, version);
CREATE INDEX IF NOT EXISTS idx_programmes_status ON programmes(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_programmes_academic_year ON programmes(tenant_id, academic_year);

CREATE INDEX IF NOT EXISTS idx_teaching_units_tenant_id ON teaching_units(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teaching_units_programme_id ON teaching_units(programme_id);
CREATE INDEX IF NOT EXISTS idx_teaching_units_semester ON teaching_units(tenant_id, semester);

CREATE INDEX IF NOT EXISTS idx_courses_tenant_id ON courses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_courses_teaching_unit_id ON courses(teaching_unit_id);
CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_teachers_tenant_id ON teachers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teachers_email ON teachers(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_teachers_status ON teachers(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_teachers_contract_type ON teachers(tenant_id, contract_type);

CREATE INDEX IF NOT EXISTS idx_course_assignments_tenant_id ON course_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_course_assignments_course_id ON course_assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_course_assignments_teacher_id ON course_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_course_assignments_academic_year ON course_assignments(tenant_id, academic_year);

CREATE INDEX IF NOT EXISTS idx_teaching_hours_tenant_id ON teaching_hours(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teaching_hours_assignment_id ON teaching_hours(assignment_id);
CREATE INDEX IF NOT EXISTS idx_teaching_hours_session_date ON teaching_hours(tenant_id, session_date);

-- Create triggers for updated_at columns
CREATE TRIGGER update_cycles_updated_at 
    BEFORE UPDATE ON cycles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_programmes_updated_at 
    BEFORE UPDATE ON programmes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teaching_units_updated_at 
    BEFORE UPDATE ON teaching_units 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_courses_updated_at 
    BEFORE UPDATE ON courses 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teachers_updated_at 
    BEFORE UPDATE ON teachers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_course_assignments_updated_at 
    BEFORE UPDATE ON course_assignments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE cycles IS 'Academic cycles (BTS, Post-BTS, formations courtes, etc.)';
COMMENT ON TABLE programmes IS 'Academic programmes within cycles';
COMMENT ON TABLE teaching_units IS 'Teaching units (unités d''enseignement) within programmes';
COMMENT ON TABLE courses IS 'Individual courses/subjects within teaching units';
COMMENT ON TABLE teachers IS 'Teachers and lecturers (permanent and freelance)';
COMMENT ON TABLE course_assignments IS 'Assignment of teachers to courses';
COMMENT ON TABLE teaching_hours IS 'Tracking of actual teaching hours';

COMMENT ON COLUMN cycles.code IS 'Unique code for the cycle (e.g., BTS-SIO, POST-BTS-DEV)';
COMMENT ON COLUMN cycles.certification_level IS 'Level of certification (bac+2, bac+3, etc.)';
COMMENT ON COLUMN programmes.version IS 'Programme version for tracking changes over years';
COMMENT ON COLUMN programmes.academic_year IS 'Academic year in format YYYY-YYYY (e.g., 2024-2025)';
COMMENT ON COLUMN teachers.hourly_rate IS 'Hourly rate for freelance teachers';
COMMENT ON COLUMN course_assignments.hours_assigned IS 'Total hours assigned for this course';
COMMENT ON COLUMN teaching_hours.hours_taught IS 'Actual hours taught in this session';

-- Migration complete
SELECT 'Migration 0002_academic.sql completed successfully' as result;
