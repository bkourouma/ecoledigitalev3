-- Moyennes par matière et période (semestre/trimestre) saisies par l'administration

CREATE TABLE IF NOT EXISTS student_period_course_averages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_period_id UUID NOT NULL REFERENCES academic_year_periods(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    average NUMERIC(5, 2) NOT NULL CHECK (average >= 0 AND average <= 20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT student_period_course_averages_unique UNIQUE (tenant_id, academic_year_period_id, student_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_ca_tenant ON student_period_course_averages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sp_ca_period ON student_period_course_averages(academic_year_period_id);
CREATE INDEX IF NOT EXISTS idx_sp_ca_class ON student_period_course_averages(class_id);
CREATE INDEX IF NOT EXISTS idx_sp_ca_student ON student_period_course_averages(student_id);

ALTER TABLE student_period_course_averages ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_period_course_averages_tenant_policy ON student_period_course_averages
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

DROP TRIGGER IF EXISTS update_student_period_course_averages_updated_at ON student_period_course_averages;
CREATE TRIGGER update_student_period_course_averages_updated_at
    BEFORE UPDATE ON student_period_course_averages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE student_period_course_averages IS 'Moyenne sur 20 par étudiant, matière et période académique';
