-- Migration: 0048_academic_year_periods.sql
-- Semestres / trimestres rattachés à une année académique

CREATE TABLE IF NOT EXISTS academic_year_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT academic_year_period_dates_check CHECK (end_date > start_date)
);

CREATE INDEX IF NOT EXISTS idx_academic_year_periods_tenant ON academic_year_periods(tenant_id);
CREATE INDEX IF NOT EXISTS idx_academic_year_periods_year ON academic_year_periods(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_academic_year_periods_year_sort ON academic_year_periods(academic_year_id, sort_order);

ALTER TABLE academic_year_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY academic_year_periods_tenant_policy ON academic_year_periods
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

DROP TRIGGER IF EXISTS update_academic_year_periods_updated_at ON academic_year_periods;
CREATE TRIGGER update_academic_year_periods_updated_at
    BEFORE UPDATE ON academic_year_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE academic_year_periods IS 'Périodes (semestre, trimestre) d''une année académique';
