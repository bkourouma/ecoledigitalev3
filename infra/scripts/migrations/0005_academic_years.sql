-- EcoleDigitale Database Schema Migration 0005
-- Creates academic year management tables and removes unused academic tables
-- Inserts comprehensive Imhotep Academy data

-- First, remove tables that are no longer needed
DROP TABLE IF EXISTS teaching_hours CASCADE;
DROP TABLE IF EXISTS course_assignments CASCADE;
DROP TABLE IF EXISTS teaching_units CASCADE;

-- Modify courses table to reference programmes directly instead of teaching_units
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_teaching_unit_id_fkey;
ALTER TABLE courses DROP COLUMN IF EXISTS teaching_unit_id;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES programmes(id) ON DELETE CASCADE;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS semester INTEGER;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS credits INTEGER;

-- Assignment-specific enums and extension
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
    CREATE TYPE assignment_status AS ENUM ('active', 'paused', 'ended', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE assignment_contract_type AS ENUM ('salarie', 'vacataire');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create ENUM types for academic year management
DO $$ BEGIN
    CREATE TYPE enrollment_status AS ENUM ('active', 'suspended', 'completed', 'dropped', 'transferred');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create academic_years table
CREATE TABLE IF NOT EXISTS academic_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, name),
    CONSTRAINT academic_year_dates_check CHECK (end_date > start_date),
    CONSTRAINT academic_year_one_active_per_tenant EXCLUDE USING btree (tenant_id WITH =) WHERE (is_active = true)
);

-- Create classes table (child of programmes) - adapted for existing schema
CREATE TABLE IF NOT EXISTS classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    level INTEGER DEFAULT 1, -- Added level field (1, 2, etc.)
    capacity INTEGER DEFAULT 30, -- Renamed from max_students for clarity
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, code, academic_year_id),
    CONSTRAINT capacity_positive CHECK (capacity > 0)
);

-- Create class_courses table (many-to-many between classes and courses)

-- Create teacher_assignments table (teacher-course assignments with date range)
CREATE TABLE IF NOT EXISTS teacher_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    class_course_id UUID NOT NULL REFERENCES class_courses(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    contract_type assignment_contract_type NOT NULL,
    datebut DATE NOT NULL,
    datefin DATE NOT NULL,
    course_amount DECIMAL(10,2),
    status assignment_status DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT teacher_assignments_dates_check CHECK (datefin >= datebut)
);

CREATE TABLE IF NOT EXISTS class_courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    is_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, class_id, course_id)
);

-- Create student_enrollments table
CREATE TABLE IF NOT EXISTS student_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    fees JSONB NOT NULL DEFAULT '{"inscription": 0, "scolarite": 0, "annexes": 0, "autres": 0, "total": 0, "currency": "XOF"}',
    enrollment_date DATE DEFAULT CURRENT_DATE,
    status enrollment_status DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, student_id, academic_year_id),
    CONSTRAINT enrollment_date_valid CHECK (enrollment_date <= CURRENT_DATE)

-- Indexes for teacher_assignments
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_tenant ON teacher_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON teacher_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class_course ON teacher_assignments(class_course_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_status ON teacher_assignments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_dates ON teacher_assignments(tenant_id, datebut, datefin);

);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_academic_years_tenant_id ON academic_years(tenant_id);
CREATE INDEX IF NOT EXISTS idx_academic_years_active ON academic_years(tenant_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_academic_years_dates ON academic_years(tenant_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_classes_tenant_id ON classes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_classes_programme_id ON classes(programme_id);
CREATE INDEX IF NOT EXISTS idx_classes_academic_year_id ON classes(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_classes_code ON classes(tenant_id, code, academic_year_id);


-- Enable RLS for teacher_assignments
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY teacher_assignments_tenant_policy ON teacher_assignments
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- updated_at trigger for teacher_assignments
CREATE TRIGGER update_teacher_assignments_updated_at
    BEFORE UPDATE ON teacher_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_class_courses_tenant_id ON class_courses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_class_courses_class_id ON class_courses(class_id);
CREATE INDEX IF NOT EXISTS idx_class_courses_course_id ON class_courses(course_id);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_tenant_id ON student_enrollments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_student_id ON student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_class_id ON student_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_academic_year_id ON student_enrollments(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_status ON student_enrollments(tenant_id, status);

-- Enable Row Level Security for all new tables
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for academic_years
CREATE POLICY academic_years_tenant_policy ON academic_years
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);


-- Overlap prevention using exclusion constraint
ALTER TABLE teacher_assignments
    ADD CONSTRAINT teacher_assignments_no_overlap
    EXCLUDE USING gist (
        tenant_id WITH =,
        class_course_id WITH =,
        teacher_id WITH =,
        daterange(datebut, datefin, '[]') WITH &&
    );

-- Comments for teacher_assignments
COMMENT ON TABLE teacher_assignments IS 'Assignments of teachers to class courses with date range and compensation';
COMMENT ON COLUMN teacher_assignments.contract_type IS 'Assignment-specific contract type (salarie or vacataire)';
COMMENT ON COLUMN teacher_assignments.course_amount IS 'Total course compensation amount for vacataire teachers';
COMMENT ON CONSTRAINT teacher_assignments_no_overlap ON teacher_assignments IS 'Prevents overlapping assignments for the same teacher and class_course within the same tenant';

-- Create RLS policies for classes
CREATE POLICY classes_tenant_policy ON classes
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for class_courses
CREATE POLICY class_courses_tenant_policy ON class_courses
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for student_enrollments
CREATE POLICY student_enrollments_tenant_policy ON student_enrollments
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create function to automatically update fees total
CREATE OR REPLACE FUNCTION update_enrollment_fees_total()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate total from individual fee components
    NEW.fees = jsonb_set(
        NEW.fees,
        '{total}',
        to_jsonb(
            COALESCE((NEW.fees->>'inscription')::numeric, 0) +
            COALESCE((NEW.fees->>'scolarite')::numeric, 0) +
            COALESCE((NEW.fees->>'annexes')::numeric, 0) +
            COALESCE((NEW.fees->>'autres')::numeric, 0)
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update fees total
CREATE TRIGGER trigger_update_enrollment_fees_total
    BEFORE INSERT OR UPDATE ON student_enrollments
    FOR EACH ROW
    EXECUTE FUNCTION update_enrollment_fees_total();

-- Comments for documentation
COMMENT ON TABLE academic_years IS 'Academic years with start/end dates and active status';
COMMENT ON TABLE classes IS 'Classes within programmes for specific academic years';
COMMENT ON TABLE class_courses IS 'Many-to-many relationship between classes and courses';
COMMENT ON TABLE student_enrollments IS 'Student enrollments in classes with fee information';

COMMENT ON COLUMN academic_years.is_active IS 'Only one academic year can be active per tenant';
COMMENT ON COLUMN classes.capacity IS 'Maximum number of students allowed in this class';
COMMENT ON COLUMN classes.level IS 'Academic level (1, 2, 3, etc.)';
COMMENT ON COLUMN class_courses.is_required IS 'Whether this course is required for the class';
COMMENT ON COLUMN student_enrollments.fees IS 'Fee structure in JSON format with inscription, scolarite, annexes, autres, total, currency';
COMMENT ON COLUMN student_enrollments.status IS 'Current enrollment status';

-- ========================================
-- IMHOTEP ACADEMY DATA INSERTION
-- ========================================
-- NOTE: Replace 'TENANT_ID_HERE' with actual tenant UUID before execution

-- 1. CYCLES ACADÉMIQUES (adapted to existing cycles table structure)
INSERT INTO cycles (id, tenant_id, name, code, type, duration_months, description, certification_level, status)
VALUES
    ('550e8400-e29b-41d4-a716-446655440001', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'BTS', 'BTS', 'academic', 24, 'Brevet de Technicien Supérieur', 'bac+2', 'active'),
    ('550e8400-e29b-41d4-a716-446655440002', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Licence', 'LIC', 'academic', 12, 'Licence (Bac+3)', 'bac+3', 'active'),
    ('550e8400-e29b-41d4-a716-446655440003', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Master', 'MAST', 'academic', 24, 'Master (Bac+5)', 'bac+5', 'active'),
    ('550e8400-e29b-41d4-a716-446655440004', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'BBA', 'BBA', 'academic', 36, 'Bachelor of Business Administration', 'bac+3', 'active'),
    ('550e8400-e29b-41d4-a716-446655440005', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'MBA', 'MBA', 'academic', 24, 'Master of Business Administration', 'bac+5', 'active'),
    ('550e8400-e29b-41d4-a716-446655440006', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'EDBA', 'EDBA', 'academic', 36, 'Executive Doctorate in Business Administration', 'bac+8', 'active');

-- 2. PROGRAMMES BTS - FILIÈRES TERTIAIRES (adapted to existing programmes table structure)
INSERT INTO programmes (id, tenant_id, cycle_id, code, name, description, status, academic_year)
VALUES
    -- BTS Tertiaires
    ('650e8400-e29b-41d4-a716-446655440001', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-RHC', 'Ressources Humaines et Communication', 'Formation en gestion des ressources humaines et communication', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440002', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-GC', 'Gestion Commerciale', 'Formation en techniques commerciales et marketing', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440003', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-FCGE', 'Finance, Comptabilité et Gestion des Entreprises', 'Formation en finance et comptabilité d''entreprise', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440004', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-AD', 'Assistanat de Direction', 'Formation d''assistants de direction polyvalents', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440005', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-TH', 'Tourisme et Hôtellerie', 'Formation dans le secteur du tourisme et de l''hôtellerie', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440006', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-LOG', 'Logistique', 'Formation en gestion logistique et supply chain', 'active', '2024-2025'),

    -- BTS Industrielles
    ('650e8400-e29b-41d4-a716-446655440007', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-IDA', 'Informatique – Développeur d''Application', 'Formation en développement d''applications informatiques', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440008', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-RIT', 'Réseau Informatique et Télécommunication', 'Formation en réseaux et télécommunications', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440009', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-SIP', 'Sécurité Incendie et Prévention', 'Formation en sécurité incendie et prévention des risques', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440010', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-HST', 'Hygiène et Sécurité au Travail', 'Formation en hygiène et sécurité au travail', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440011', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-MGP', 'Mine, Géologie et Pétrole', 'Formation dans les secteurs minier, géologique et pétrolier', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440012', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-GCB', 'Génie Civil (option Bâtiment)', 'Formation en génie civil spécialité bâtiment', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440013', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-GCTP', 'Génie Civil (option Travaux Publics)', 'Formation en génie civil spécialité travaux publics', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440014', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-MSP', 'Maintenance et Systèmes de Production', 'Formation en maintenance industrielle', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440015', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440001', 'BTS-ELEC', 'Électronique', 'Formation en électronique et systèmes électroniques', 'active', '2024-2025');

-- 3. PROGRAMMES POST-BTS (Licences et Masters)
INSERT INTO programmes (id, tenant_id, cycle_id, code, name, description, status, academic_year)
VALUES
    -- Licences
    ('650e8400-e29b-41d4-a716-446655440016', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440002', 'LIC-RH', 'Licence Ressources Humaines', 'Approfondissement en management des ressources humaines', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440017', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440002', 'LIC-GL', 'Licence Génie Logiciel', 'Spécialisation en développement logiciel et informatique', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440018', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440002', 'LIC-FC', 'Licence Finance & Comptabilité', 'Approfondissement en gestion financière et comptable', 'active', '2024-2025'),

    -- Masters
    ('650e8400-e29b-41d4-a716-446655440019', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440003', 'MAST-RH', 'Master Ressources Humaines', 'Master en management des ressources humaines', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440020', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440003', 'MAST-GL', 'Master Génie Logiciel', 'Master en développement logiciel et architecture', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440021', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440003', 'MAST-FC', 'Master Finance & Comptabilité', 'Master en gestion financière et comptable', 'active', '2024-2025'),

    -- Programmes Internationaux
    ('650e8400-e29b-41d4-a716-446655440022', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440004', 'BBA-GEN', 'Bachelor of Business Administration', 'Programme international de gestion d''entreprise', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440023', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440005', 'MBA-GEN', 'Master of Business Administration', 'Programme MBA international', 'active', '2024-2025'),
    ('650e8400-e29b-41d4-a716-446655440024', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '550e8400-e29b-41d4-a716-446655440006', 'EDBA-GEN', 'Executive Doctorate in Business Administration', 'Doctorat exécutif en administration des affaires', 'active', '2024-2025');

-- 4. COURS EXEMPLES (adapted to existing courses table structure)
-- Cours pour BTS Informatique – Développeur d'Application
INSERT INTO courses (id, tenant_id, programme_id, code, name, description, hours_total, hours_theory, hours_practical, delivery_mode, semester, credits, status)
VALUES
    ('850e8400-e29b-41d4-a716-446655440001', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440007', 'ALGO101', 'Introduction à l''Algorithmique', 'Cours fondamental d''algorithmique et structures de données', 60, 20, 40, 'hybrid', 1, 6, 'active'),
    ('850e8400-e29b-41d4-a716-446655440002', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440007', 'PROG101', 'Programmation en C', 'Apprentissage de la programmation en langage C', 80, 20, 60, 'hybrid', 1, 6, 'active'),
    ('850e8400-e29b-41d4-a716-446655440003', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440007', 'BDD101', 'Modélisation de Données', 'Conception et modélisation de bases de données', 40, 25, 15, 'hybrid', 1, 4, 'active'),
    ('850e8400-e29b-41d4-a716-446655440004', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440007', 'SQL101', 'Langage SQL', 'Maîtrise du langage SQL et requêtes avancées', 50, 15, 35, 'hybrid', 1, 4, 'active'),
    ('850e8400-e29b-41d4-a716-446655440005', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440007', 'WEB101', 'Développement Web HTML/CSS', 'Création de sites web avec HTML5 et CSS3', 60, 15, 45, 'hybrid', 1, 5, 'active'),
    ('850e8400-e29b-41d4-a716-446655440006', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440007', 'POO101', 'Programmation Orientée Objet', 'Concepts et pratique de la POO', 70, 20, 50, 'hybrid', 2, 6, 'active'),
    ('850e8400-e29b-41d4-a716-446655440007', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440007', 'GL101', 'Génie Logiciel', 'Méthodologies de développement logiciel', 50, 30, 20, 'hybrid', 2, 4, 'active'),
    ('850e8400-e29b-41d4-a716-446655440008', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440007', 'STAGE101', 'Stage Professionnel', 'Stage en entreprise de fin d''études', 0, 0, 0, 'presential', 2, 8, 'active');

-- Cours pour BTS Gestion Commerciale
INSERT INTO courses (id, tenant_id, programme_id, code, name, description, hours_total, hours_theory, hours_practical, delivery_mode, semester, credits, status)
VALUES
    ('850e8400-e29b-41d4-a716-446655440009', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440002', 'VENTE101', 'Fondamentaux de la Vente', 'Techniques de vente et relation client', 45, 25, 20, 'hybrid', 1, 5, 'active'),
    ('850e8400-e29b-41d4-a716-446655440010', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440002', 'VENTE102', 'Psychologie du Client', 'Comprendre le comportement d''achat', 35, 25, 10, 'hybrid', 1, 4, 'active'),
    ('850e8400-e29b-41d4-a716-446655440011', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440002', 'MKT101', 'Marketing Fondamental', 'Principes et stratégies marketing', 50, 30, 20, 'hybrid', 1, 4, 'active'),
    ('850e8400-e29b-41d4-a716-446655440012', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440002', 'GCOM101', 'Gestion Commerciale', 'Organisation et gestion d''équipes commerciales', 60, 35, 25, 'hybrid', 1, 6, 'active'),
    ('850e8400-e29b-41d4-a716-446655440013', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440002', 'MKTD101', 'Marketing Digital', 'Stratégies marketing en ligne', 55, 25, 30, 'hybrid', 2, 5, 'active'),
    ('850e8400-e29b-41d4-a716-446655440014', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440002', 'NEGO101', 'Négociation Commerciale', 'Techniques de négociation avancées', 40, 20, 20, 'hybrid', 2, 4, 'active'),
    ('850e8400-e29b-41d4-a716-446655440015', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440002', 'PROJ101', 'Projet Commercial', 'Projet de fin d''études commercial', 50, 10, 40, 'hybrid', 2, 6, 'active');

-- Cours pour BTS Finance, Comptabilité et Gestion des Entreprises
INSERT INTO courses (id, tenant_id, programme_id, code, name, description, hours_total, hours_theory, hours_practical, delivery_mode, semester, credits, status)
VALUES
    ('850e8400-e29b-41d4-a716-446655440016', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440003', 'COMPTA101', 'Comptabilité Générale', 'Principes et techniques comptables', 70, 40, 30, 'hybrid', 1, 6, 'active'),
    ('850e8400-e29b-41d4-a716-446655440017', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440003', 'FINANCE101', 'Finance d''Entreprise', 'Gestion financière et analyse', 60, 30, 30, 'hybrid', 1, 5, 'active'),
    ('850e8400-e29b-41d4-a716-446655440018', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440003', 'DROIT101', 'Droit des Affaires', 'Cadre juridique des entreprises', 45, 40, 5, 'hybrid', 1, 4, 'active'),
    ('850e8400-e29b-41d4-a716-446655440019', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440003', 'FISCA101', 'Fiscalité des Entreprises', 'Système fiscal et optimisation', 50, 30, 20, 'hybrid', 2, 5, 'active'),
    ('850e8400-e29b-41d4-a716-446655440020', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440003', 'AUDIT101', 'Audit et Contrôle de Gestion', 'Techniques d''audit et contrôle', 55, 25, 30, 'hybrid', 2, 5, 'active'),
    ('850e8400-e29b-41d4-a716-446655440021', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '650e8400-e29b-41d4-a716-446655440003', 'STAGE102', 'Stage Comptable', 'Stage en cabinet ou entreprise', 0, 0, 0, 'presential', 2, 5, 'active');

-- 5. ANNÉE ACADÉMIQUE ACTUELLE
INSERT INTO academic_years (id, tenant_id, name, start_date, end_date, is_active)
VALUES
    ('950e8400-e29b-41d4-a716-446655440001', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '2024-2025', '2024-09-01', '2025-07-31', true);

-- 6. CLASSES EXEMPLES (adapted to existing classes table structure)
-- Classes BTS 1ère année
INSERT INTO classes (id, tenant_id, academic_year_id, programme_id, name, code, level, capacity)
VALUES
    ('A50e8400-e29b-41d4-a716-446655440001', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '950e8400-e29b-41d4-a716-446655440001', '650e8400-e29b-41d4-a716-446655440007', 'IDA 1A', 'IDA1A', 1, 30),
    ('A50e8400-e29b-41d4-a716-446655440002', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '950e8400-e29b-41d4-a716-446655440001', '650e8400-e29b-41d4-a716-446655440007', 'IDA 1B', 'IDA1B', 1, 30),
    ('A50e8400-e29b-41d4-a716-446655440003', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '950e8400-e29b-41d4-a716-446655440001', '650e8400-e29b-41d4-a716-446655440002', 'GC 1A', 'GC1A', 1, 35),
    ('A50e8400-e29b-41d4-a716-446655440004', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '950e8400-e29b-41d4-a716-446655440001', '650e8400-e29b-41d4-a716-446655440003', 'FCGE 1A', 'FCGE1A', 1, 30);

-- Classes BTS 2ème année
INSERT INTO classes (id, tenant_id, academic_year_id, programme_id, name, code, level, capacity)
VALUES
    ('A50e8400-e29b-41d4-a716-446655440005', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '950e8400-e29b-41d4-a716-446655440001', '650e8400-e29b-41d4-a716-446655440007', 'IDA 2A', 'IDA2A', 2, 25),
    ('A50e8400-e29b-41d4-a716-446655440006', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '950e8400-e29b-41d4-a716-446655440001', '650e8400-e29b-41d4-a716-446655440002', 'GC 2A', 'GC2A', 2, 28),
    ('A50e8400-e29b-41d4-a716-446655440007', '6eb9c106-b650-4398-b6fa-091b6828c4ba', '950e8400-e29b-41d4-a716-446655440001', '650e8400-e29b-41d4-a716-446655440003', 'FCGE 2A', 'FCGE2A', 2, 25);

-- 7. ASSOCIATIONS COURS-CLASSES (exemples)
-- Cours pour la classe IDA 1A
INSERT INTO class_courses (id, tenant_id, class_id, course_id)
VALUES
    ('B50e8400-e29b-41d4-a716-446655440001', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440001', '850e8400-e29b-41d4-a716-446655440001'),
    ('B50e8400-e29b-41d4-a716-446655440002', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440001', '850e8400-e29b-41d4-a716-446655440002'),
    ('B50e8400-e29b-41d4-a716-446655440003', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440001', '850e8400-e29b-41d4-a716-446655440003'),
    ('B50e8400-e29b-41d4-a716-446655440004', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440001', '850e8400-e29b-41d4-a716-446655440004'),
    ('B50e8400-e29b-41d4-a716-446655440005', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440001', '850e8400-e29b-41d4-a716-446655440005');

-- Cours pour la classe GC 1A
INSERT INTO class_courses (id, tenant_id, class_id, course_id)
VALUES
    ('B50e8400-e29b-41d4-a716-446655440006', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440003', '850e8400-e29b-41d4-a716-446655440009'),
    ('B50e8400-e29b-41d4-a716-446655440007', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440003', '850e8400-e29b-41d4-a716-446655440010'),
    ('B50e8400-e29b-41d4-a716-446655440008', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440003', '850e8400-e29b-41d4-a716-446655440011'),
    ('B50e8400-e29b-41d4-a716-446655440009', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440003', '850e8400-e29b-41d4-a716-446655440012');

-- Cours pour la classe FCGE 1A
INSERT INTO class_courses (id, tenant_id, class_id, course_id)
VALUES
    ('B50e8400-e29b-41d4-a716-446655440010', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440004', '850e8400-e29b-41d4-a716-446655440016'),
    ('B50e8400-e29b-41d4-a716-446655440011', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440004', '850e8400-e29b-41d4-a716-446655440017'),
    ('B50e8400-e29b-41d4-a716-446655440012', '6eb9c106-b650-4398-b6fa-091b6828c4ba', 'A50e8400-e29b-41d4-a716-446655440004', '850e8400-e29b-41d4-a716-446655440018');

-- NOTES IMPORTANTES POUR L'UTILISATION :
-- 1. ✅ Tenant ID mis à jour avec l'UUID d'Imhotep Academy: 6eb9c106-b650-4398-b6fa-091b6828c4ba
-- 2. Les cours sont maintenant liés directement aux programmes (plus d'unités d'enseignement)
-- 3. Chaque cours a des crédits, un semestre et une répartition horaire (theory/practical)
-- 4. Les frais de scolarité peuvent être ajoutés via la colonne 'fees' lors des inscriptions d'étudiants
-- 5. Les modalités hybrides (présentiel/en ligne) sont gérées via le champ delivery_mode

-- Migration complete
SELECT 'Migration 0005_academic_years.sql completed successfully' as result;
