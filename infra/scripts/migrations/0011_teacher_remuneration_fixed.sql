-- Description: Teacher Remuneration Tracking System (Fixed)
-- Date: 2025-08-23
-- Author: EcoleDigitale Platform Team

-- Create enums for payment system
DO $$ BEGIN
    CREATE TYPE payment_period_status AS ENUM ('draft', 'active', 'closed', 'archived');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_config_type AS ENUM ('salary', 'hourly', 'mixed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_type AS ENUM ('salary', 'hourly', 'bonus', 'deduction');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('calculated', 'approved', 'paid', 'disputed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE rate_type AS ENUM ('theory', 'practical', 'exam', 'evaluation', 'supervision');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Payment periods for organizing payments
CREATE TABLE IF NOT EXISTS payment_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  description text,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status payment_period_status DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Teacher payment configurations
CREATE TABLE IF NOT EXISTS teacher_payment_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  config_type payment_config_type NOT NULL,
  
  -- Salary configuration
  monthly_salary decimal(10,2),
  annual_salary decimal(12,2),
  
  -- Hourly configuration
  default_hourly_rate decimal(8,2),
  overtime_threshold integer DEFAULT 40, -- Hours per week before overtime
  overtime_multiplier decimal(3,2) DEFAULT 1.5,
  
  -- Effective period
  effective_from date NOT NULL,
  effective_to date,
  
  -- Metadata
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Individual payment records
CREATE TABLE IF NOT EXISTS teacher_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  payment_period_id uuid NOT NULL REFERENCES payment_periods(id) ON DELETE CASCADE,
  payment_config_id uuid REFERENCES teacher_payment_configs(id),
  
  -- Payment breakdown
  payment_type payment_type NOT NULL,
  base_amount decimal(10,2) NOT NULL DEFAULT 0,
  overtime_amount decimal(10,2) DEFAULT 0,
  bonus_amount decimal(10,2) DEFAULT 0,
  deductions decimal(10,2) DEFAULT 0,
  total_amount decimal(10,2) NOT NULL,
  
  -- Currency and calculation details
  currency varchar(3) DEFAULT 'XOF',
  calculation_details jsonb, -- Store detailed calculation breakdown
  
  -- Workflow status
  status payment_status DEFAULT 'calculated',
  calculated_at timestamptz DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  
  -- Additional info
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Link payments to specific teaching hours
CREATE TABLE IF NOT EXISTS payment_hour_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES teacher_payments(id) ON DELETE CASCADE,
  teaching_hours_id uuid NOT NULL REFERENCES teaching_hours(id) ON DELETE CASCADE,
  
  -- Hour details
  hours_count decimal(4,2) NOT NULL,
  hourly_rate decimal(8,2) NOT NULL,
  amount decimal(10,2) NOT NULL,
  is_overtime boolean DEFAULT false,
  
  -- Metadata
  created_at timestamptz DEFAULT now()
);

-- Course-specific hourly rates
CREATE TABLE IF NOT EXISTS course_hourly_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE, -- NULL for default rates
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE, -- NULL for course default
  
  -- Rate configuration
  rate_amount decimal(8,2) NOT NULL,
  rate_type rate_type NOT NULL,
  
  -- Effective period
  effective_from date NOT NULL,
  effective_to date,
  
  -- Metadata
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Payment audit log for tracking changes
CREATE TABLE IF NOT EXISTS payment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES teacher_payments(id) ON DELETE CASCADE,
  
  -- Change details
  action varchar(20) NOT NULL, -- 'created', 'updated', 'approved', 'paid', 'cancelled'
  old_values jsonb,
  new_values jsonb,
  reason text,
  
  -- Audit metadata
  changed_by uuid NOT NULL REFERENCES users(id),
  changed_at timestamptz DEFAULT now()
);

-- Enable Row Level Security on all tables
ALTER TABLE payment_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_payment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_hour_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_hourly_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_audit_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
DO $$ BEGIN
    CREATE POLICY payment_periods_tenant_policy ON payment_periods
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY teacher_payment_configs_tenant_policy ON teacher_payment_configs
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY teacher_payments_tenant_policy ON teacher_payments
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY payment_hour_details_tenant_policy ON payment_hour_details
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY course_hourly_rates_tenant_policy ON course_hourly_rates
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY payment_audit_log_tenant_policy ON payment_audit_log
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_payment_periods_tenant_status ON payment_periods(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_periods_dates ON payment_periods(period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_teacher_payment_configs_tenant_teacher ON teacher_payment_configs(tenant_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_payment_configs_effective ON teacher_payment_configs(effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_teacher_payments_tenant_teacher ON teacher_payments(tenant_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_payments_period ON teacher_payments(payment_period_id);
CREATE INDEX IF NOT EXISTS idx_teacher_payments_status ON teacher_payments(status);
CREATE INDEX IF NOT EXISTS idx_teacher_payments_dates ON teacher_payments(calculated_at, approved_at, paid_at);

CREATE INDEX IF NOT EXISTS idx_payment_hour_details_payment ON payment_hour_details(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_hour_details_teaching_hours ON payment_hour_details(teaching_hours_id);

CREATE INDEX IF NOT EXISTS idx_course_hourly_rates_tenant_course ON course_hourly_rates(tenant_id, course_id);
CREATE INDEX IF NOT EXISTS idx_course_hourly_rates_tenant_teacher ON course_hourly_rates(tenant_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_course_hourly_rates_effective ON course_hourly_rates(effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_payment_audit_log_payment ON payment_audit_log(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_changed_at ON payment_audit_log(changed_at);

-- Create triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_payment_periods_updated_at ON payment_periods;
CREATE TRIGGER update_payment_periods_updated_at BEFORE UPDATE ON payment_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_teacher_payment_configs_updated_at ON teacher_payment_configs;
CREATE TRIGGER update_teacher_payment_configs_updated_at BEFORE UPDATE ON teacher_payment_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_teacher_payments_updated_at ON teacher_payments;
CREATE TRIGGER update_teacher_payments_updated_at BEFORE UPDATE ON teacher_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_course_hourly_rates_updated_at ON course_hourly_rates;
CREATE TRIGGER update_course_hourly_rates_updated_at BEFORE UPDATE ON course_hourly_rates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create audit trigger for teacher_payments
CREATE OR REPLACE FUNCTION audit_teacher_payments()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO payment_audit_log (tenant_id, payment_id, action, new_values, changed_by)
        VALUES (NEW.tenant_id, NEW.id, 'created', to_jsonb(NEW), NEW.created_by);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO payment_audit_log (tenant_id, payment_id, action, old_values, new_values, changed_by)
        VALUES (NEW.tenant_id, NEW.id, 'updated', to_jsonb(OLD), to_jsonb(NEW), 
                COALESCE(NEW.approved_by, OLD.created_by));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO payment_audit_log (tenant_id, payment_id, action, old_values, changed_by)
        VALUES (OLD.tenant_id, OLD.id, 'deleted', to_jsonb(OLD), OLD.created_by);
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_teacher_payments_trigger ON teacher_payments;
CREATE TRIGGER audit_teacher_payments_trigger
    AFTER INSERT OR UPDATE OR DELETE ON teacher_payments
    FOR EACH ROW EXECUTE FUNCTION audit_teacher_payments();

-- Add helpful comments
COMMENT ON TABLE payment_periods IS 'Defines payment periods for organizing teacher payments';
COMMENT ON TABLE teacher_payment_configs IS 'Stores payment configuration for each teacher (salary, hourly rates, etc.)';
COMMENT ON TABLE teacher_payments IS 'Individual payment records with calculation details and approval workflow';
COMMENT ON TABLE payment_hour_details IS 'Links payments to specific teaching hours for detailed tracking';
COMMENT ON TABLE course_hourly_rates IS 'Course-specific and teacher-specific hourly rates with versioning';
COMMENT ON TABLE payment_audit_log IS 'Audit trail for all payment-related changes';