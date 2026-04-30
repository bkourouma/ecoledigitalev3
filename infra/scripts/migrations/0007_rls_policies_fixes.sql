-- 0007_rls_policies_fixes.sql
-- Add missing RLS policies for tenant-scoped tables used by teacher assignments

-- Ensure RLS is enabled
ALTER TABLE IF EXISTS classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS class_courses ENABLE ROW LEVEL SECURITY;

-- Create tenant policies safely (idempotent)
DO $$ BEGIN
    CREATE POLICY classes_tenant_policy ON classes
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY class_courses_tenant_policy ON class_courses
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Optional: ensure a policy exists for academic_years (already added in 0005, but keep safe)
DO $$ BEGIN
    CREATE POLICY academic_years_tenant_policy ON academic_years
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

