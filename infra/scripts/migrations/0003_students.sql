-- EcoleDigitale Database Schema Migration 0003
-- Creates student management tables with RLS policies

-- Create ENUM types for student management
CREATE TYPE student_status AS ENUM ('active', 'graduated', 'suspended', 'dropped', 'transfer');
CREATE TYPE parent_relationship AS ENUM ('parent', 'guardian', 'emergency_contact');

-- Create student_profiles table
CREATE TABLE IF NOT EXISTS student_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_number VARCHAR(50),
    current_year INTEGER DEFAULT 1,
    status student_status DEFAULT 'active',
    bio TEXT,
    date_of_birth DATE,
    place_of_birth VARCHAR(255),
    nationality VARCHAR(100),
    address TEXT,
    phone VARCHAR(20),
    emergency_phone VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, user_id),
    UNIQUE(tenant_id, student_number)
);

-- Create student_parents table for parent-student relationships
CREATE TABLE IF NOT EXISTS student_parents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relationship_type parent_relationship DEFAULT 'parent',
    is_primary_contact BOOLEAN DEFAULT false,
    emergency_contact BOOLEAN DEFAULT false,
    can_pickup BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, student_id, parent_id)
);

-- Enable Row Level Security
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_parents ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for student_profiles table
CREATE POLICY student_profiles_tenant_policy ON student_profiles
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for student_parents table
CREATE POLICY student_parents_tenant_policy ON student_parents
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_student_profiles_tenant_id ON student_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON student_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_student_number ON student_profiles(tenant_id, student_number);
CREATE INDEX IF NOT EXISTS idx_student_profiles_status ON student_profiles(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_student_profiles_current_year ON student_profiles(tenant_id, current_year);

CREATE INDEX IF NOT EXISTS idx_student_parents_tenant_id ON student_parents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_student_parents_student_id ON student_parents(student_id);
CREATE INDEX IF NOT EXISTS idx_student_parents_parent_id ON student_parents(parent_id);
CREATE INDEX IF NOT EXISTS idx_student_parents_relationship ON student_parents(tenant_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_student_parents_primary_contact ON student_parents(tenant_id, is_primary_contact) WHERE is_primary_contact = true;

-- Create triggers for updated_at
CREATE TRIGGER update_student_profiles_updated_at 
    BEFORE UPDATE ON student_profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to auto-generate student number
CREATE OR REPLACE FUNCTION generate_student_number(tenant_uuid UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    year_suffix VARCHAR(4);
    sequence_num INTEGER;
    student_num VARCHAR(50);
BEGIN
    -- Get current academic year suffix (last 2 digits of current year)
    year_suffix := EXTRACT(YEAR FROM NOW())::TEXT;
    
    -- Get next sequence number for this tenant and year
    SELECT COALESCE(MAX(CAST(SUBSTRING(student_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM student_profiles 
    WHERE tenant_id = tenant_uuid 
    AND student_number LIKE 'STU' || year_suffix || '%';
    
    -- Format: STU + year + 3-digit sequence (e.g., STU2024001)
    student_num := 'STU' || year_suffix || LPAD(sequence_num::TEXT, 3, '0');
    
    RETURN student_num;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate student number if not provided
CREATE OR REPLACE FUNCTION set_student_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.student_number IS NULL OR NEW.student_number = '' THEN
        NEW.student_number := generate_student_number(NEW.tenant_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_student_number_trigger
    BEFORE INSERT ON student_profiles
    FOR EACH ROW EXECUTE FUNCTION set_student_number();

-- Comments for documentation
COMMENT ON TABLE student_profiles IS 'Student profiles with academic and personal information';
COMMENT ON TABLE student_parents IS 'Parent-student relationships and emergency contacts';

COMMENT ON COLUMN student_profiles.student_number IS 'Auto-generated unique student identifier (STU + year + sequence)';
COMMENT ON COLUMN student_profiles.current_year IS 'Current academic year level (1, 2, 3, etc.)';
COMMENT ON COLUMN student_profiles.status IS 'Current enrollment status';
COMMENT ON COLUMN student_profiles.bio IS 'Student biography or additional notes';

COMMENT ON COLUMN student_parents.relationship_type IS 'Type of relationship (parent, guardian, emergency_contact)';
COMMENT ON COLUMN student_parents.is_primary_contact IS 'Primary contact for school communications';
COMMENT ON COLUMN student_parents.emergency_contact IS 'Can be contacted in emergencies';
COMMENT ON COLUMN student_parents.can_pickup IS 'Authorized to pick up student';

-- Migration complete
SELECT 'Migration 0003_students.sql completed successfully' as result;
