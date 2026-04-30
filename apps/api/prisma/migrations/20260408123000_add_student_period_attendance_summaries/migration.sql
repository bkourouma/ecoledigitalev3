-- Add attendance summaries per student and period

CREATE TABLE IF NOT EXISTS student_period_attendance_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_period_id UUID NOT NULL REFERENCES academic_year_periods(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    absence_hours NUMERIC(7, 2) NOT NULL DEFAULT 0 CHECK (absence_hours >= 0),
    justified_hours NUMERIC(7, 2) NOT NULL DEFAULT 0 CHECK (justified_hours >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT student_period_attendance_summaries_unique UNIQUE (tenant_id, academic_year_period_id, class_id, student_id),
    CONSTRAINT student_period_attendance_summaries_justified_lte_absence CHECK (justified_hours <= absence_hours)
);

CREATE INDEX IF NOT EXISTS idx_sp_as_tenant ON student_period_attendance_summaries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sp_as_period ON student_period_attendance_summaries(academic_year_period_id);
CREATE INDEX IF NOT EXISTS idx_sp_as_class ON student_period_attendance_summaries(class_id);
CREATE INDEX IF NOT EXISTS idx_sp_as_student ON student_period_attendance_summaries(student_id);

ALTER TABLE student_period_attendance_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_period_attendance_summaries_tenant_policy ON student_period_attendance_summaries
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

DROP TRIGGER IF EXISTS update_student_period_attendance_summaries_updated_at ON student_period_attendance_summaries;
CREATE TRIGGER update_student_period_attendance_summaries_updated_at
    BEFORE UPDATE ON student_period_attendance_summaries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();