-- Migration 0022: Fix courses table schema to match DATABASE_SCHEMA.md
-- This aligns the actual database with the documented schema

BEGIN;

-- Step 1: Check if teaching_units table exists (required for FK)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'teaching_units') THEN
        RAISE EXCEPTION 'teaching_units table does not exist. Please run migration 0002_academic.sql first';
    END IF;
END $$;

-- Step 2: Backup existing courses data (if any)
CREATE TEMP TABLE courses_backup AS SELECT * FROM courses;

-- Step 3: Drop the old courses table
DROP TABLE IF EXISTS courses CASCADE;

-- Step 4: Recreate courses table with correct schema from DATABASE_SCHEMA.md
CREATE TABLE courses (
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

-- Step 5: Create indexes
CREATE INDEX idx_courses_tenant_id ON courses(tenant_id);
CREATE INDEX idx_courses_teaching_unit_id ON courses(teaching_unit_id);
CREATE INDEX idx_courses_code ON courses(tenant_id, code);
CREATE INDEX idx_courses_status ON courses(tenant_id, status);

-- Step 6: Enable Row Level Security
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

-- Step 7: Create RLS policy
CREATE POLICY courses_tenant_policy ON courses
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Step 8: Create updated_at trigger
CREATE TRIGGER update_courses_updated_at
    BEFORE UPDATE ON courses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Note: Old data cannot be migrated automatically because:
-- 1. program_id references non-existent programs table (should be teaching_unit_id)
-- 2. Schema is fundamentally different (title vs name, credits vs hours_total, etc.)
-- 3. Missing required fields (delivery_mode)
-- Data will need to be re-seeded with correct structure

COMMIT;

-- Verification
SELECT 'Migration 0022 completed successfully' AS status;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'courses' 
ORDER BY ordinal_position;

