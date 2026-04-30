-- Description: Student Payment Management System
-- Date: 2025-08-24
-- Author: EcoleDigitale Platform Team

-- Create enums for student payment system
DO $$ BEGIN
    CREATE TYPE installment_status AS ENUM ('pending', 'partial', 'completed', 'overdue');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_fee_type AS ENUM ('inscription', 'scolarite', 'annexes', 'autres');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_method_type AS ENUM ('orange_money', 'mtn_money', 'moov_money', 'card', 'bank_transfer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE transaction_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Tuition payment schedules (school-defined percentages and dates)
CREATE TABLE IF NOT EXISTS tuition_payment_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id), -- NULL means applies to all classes
    schedule_name VARCHAR(100) NOT NULL,
    installments JSONB NOT NULL, -- Array of {percentage: 30, due_date: "2025-10-15", label: "1st Installment"}
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, academic_year_id, class_id, schedule_name)
);

-- Student tuition installments (generated from schedule for each student)
CREATE TABLE IF NOT EXISTS student_tuition_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    enrollment_id UUID NOT NULL REFERENCES student_enrollments(id) ON DELETE CASCADE,
    schedule_id UUID NOT NULL REFERENCES tuition_payment_schedules(id) ON DELETE CASCADE,
    installment_number INTEGER NOT NULL,
    installment_label VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL, -- Calculated from percentage
    due_date DATE NOT NULL,
    status installment_status DEFAULT 'pending',
    amount_paid DECIMAL(12,2) DEFAULT 0,
    late_fee DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, enrollment_id, installment_number)
);

-- Payment transactions table
CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    enrollment_id UUID NOT NULL REFERENCES student_enrollments(id) ON DELETE CASCADE,
    tuition_installment_id UUID REFERENCES student_tuition_installments(id), -- NULL for non-tuition fees
    fee_type payment_fee_type NOT NULL,
    external_transaction_id VARCHAR(100), -- TresorPay transaction ID
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'XOF',
    payment_method payment_method_type,
    status transaction_status DEFAULT 'pending',
    gateway_response JSONB,
    receipt_url TEXT, -- URL to generated receipt PDF
    processed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id), -- Who initiated the payment
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment receipts table for tracking generated receipts
CREATE TABLE IF NOT EXISTS payment_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    transaction_id UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE CASCADE,
    receipt_number VARCHAR(50) NOT NULL, -- Auto-generated receipt number
    receipt_url TEXT NOT NULL, -- URL to PDF file
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, receipt_number)
);

-- Payment notifications log
CREATE TABLE IF NOT EXISTS payment_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL, -- 'reminder', 'confirmation', 'overdue'
    fee_type payment_fee_type,
    tuition_installment_id UUID REFERENCES student_tuition_installments(id),
    transaction_id UUID REFERENCES payment_transactions(id),
    sent_to VARCHAR(255) NOT NULL, -- Email or phone number
    sent_via VARCHAR(20) NOT NULL, -- 'email', 'sms'
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security on all tables
ALTER TABLE tuition_payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_tuition_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_notifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
DO $$ BEGIN
    CREATE POLICY tuition_payment_schedules_tenant_policy ON tuition_payment_schedules
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY student_tuition_installments_tenant_policy ON student_tuition_installments
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY payment_transactions_tenant_policy ON payment_transactions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY payment_receipts_tenant_policy ON payment_receipts
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY payment_notifications_tenant_policy ON payment_notifications
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tuition_payment_schedules_tenant_academic_year ON tuition_payment_schedules(tenant_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_tuition_payment_schedules_class ON tuition_payment_schedules(tenant_id, class_id);
CREATE INDEX IF NOT EXISTS idx_tuition_payment_schedules_active ON tuition_payment_schedules(tenant_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_student_tuition_installments_tenant_student ON student_tuition_installments(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_student_tuition_installments_enrollment ON student_tuition_installments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_student_tuition_installments_due_date ON student_tuition_installments(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_student_tuition_installments_status ON student_tuition_installments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_student_tuition_installments_overdue ON student_tuition_installments(tenant_id, due_date)
    WHERE status IN ('pending', 'partial') AND due_date < CURRENT_DATE;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_tenant_student ON payment_transactions(tenant_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_enrollment ON payment_transactions(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(tenant_id, status)
    WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_payment_transactions_fee_type ON payment_transactions(tenant_id, fee_type);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_external_id ON payment_transactions(external_transaction_id);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_transaction ON payment_receipts(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_receipt_number ON payment_receipts(tenant_id, receipt_number);

CREATE INDEX IF NOT EXISTS idx_payment_notifications_student ON payment_notifications(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_payment_notifications_type_status ON payment_notifications(notification_type, status);
CREATE INDEX IF NOT EXISTS idx_payment_notifications_sent_at ON payment_notifications(sent_at);

-- Create triggers for updated_at timestamps
CREATE TRIGGER update_tuition_payment_schedules_updated_at BEFORE UPDATE ON tuition_payment_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_student_tuition_installments_updated_at BEFORE UPDATE ON student_tuition_installments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_transactions_updated_at BEFORE UPDATE ON payment_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to generate receipt numbers
CREATE OR REPLACE FUNCTION generate_receipt_number(tenant_uuid UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    year_suffix VARCHAR(4);
    sequence_num INTEGER;
    receipt_num VARCHAR(50);
BEGIN
    -- Get current year
    year_suffix := EXTRACT(YEAR FROM NOW())::TEXT;

    -- Get next sequence number for this tenant and year
    SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM payment_receipts
    WHERE tenant_id = tenant_uuid
    AND receipt_number LIKE 'REC' || year_suffix || '%';

    -- Format: REC + year + 6-digit sequence (e.g., REC2024000001)
    receipt_num := 'REC' || year_suffix || LPAD(sequence_num::TEXT, 6, '0');

    RETURN receipt_num;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-generate receipt number
CREATE OR REPLACE FUNCTION set_receipt_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
        NEW.receipt_number := generate_receipt_number(NEW.tenant_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_receipt_number_trigger
    BEFORE INSERT ON payment_receipts
    FOR EACH ROW EXECUTE FUNCTION set_receipt_number();

-- Function to update installment status based on payments
CREATE OR REPLACE FUNCTION update_installment_status()
RETURNS TRIGGER AS $$
DECLARE
    installment_amount DECIMAL(12,2);
    total_paid DECIMAL(12,2);
    installment_due_date DATE;
BEGIN
    -- Only process for tuition payments
    IF NEW.fee_type = 'scolarite' AND NEW.tuition_installment_id IS NOT NULL THEN
        -- Get installment details
        SELECT amount, due_date INTO installment_amount, installment_due_date
        FROM student_tuition_installments
        WHERE id = NEW.tuition_installment_id;

        -- Calculate total paid for this installment
        SELECT COALESCE(SUM(amount), 0) INTO total_paid
        FROM payment_transactions
        WHERE tuition_installment_id = NEW.tuition_installment_id
        AND status = 'completed';

        -- Update installment status and amount paid
        UPDATE student_tuition_installments
        SET
            amount_paid = total_paid,
            status = CASE
                WHEN total_paid >= installment_amount THEN 'completed'
                WHEN total_paid > 0 THEN 'partial'
                WHEN CURRENT_DATE > installment_due_date THEN 'overdue'
                ELSE 'pending'
            END,
            updated_at = NOW()
        WHERE id = NEW.tuition_installment_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_installment_status_trigger
    AFTER INSERT OR UPDATE ON payment_transactions
    FOR EACH ROW EXECUTE FUNCTION update_installment_status();

-- Function to validate payment amounts
CREATE OR REPLACE FUNCTION validate_payment_amount(
    enrollment_uuid UUID,
    fee_type_param payment_fee_type,
    amount_param DECIMAL
) RETURNS BOOLEAN AS $$
DECLARE
    enrollment_fees JSONB;
    fee_amount DECIMAL;
BEGIN
    -- Get enrollment fees
    SELECT fees INTO enrollment_fees
    FROM student_enrollments
    WHERE id = enrollment_uuid;

    -- Extract the specific fee amount
    fee_amount := (enrollment_fees ->> fee_type_param::text)::DECIMAL;

    -- For non-tuition fees, amount must equal the fee amount (full payment required)
    IF fee_type_param IN ('inscription', 'annexes', 'autres') THEN
        RETURN amount_param = fee_amount;
    END IF;

    -- For tuition fees, amount can be partial (handled by installment logic)
    RETURN amount_param > 0 AND amount_param <= fee_amount;
END;
$$ LANGUAGE plpgsql;

-- Add helpful comments
COMMENT ON TABLE tuition_payment_schedules IS 'Defines tuition payment schedules with percentage breakdowns and due dates';
COMMENT ON TABLE student_tuition_installments IS 'Individual tuition installments generated from schedules for each student';
COMMENT ON TABLE payment_transactions IS 'All payment transactions with gateway integration and status tracking';
COMMENT ON TABLE payment_receipts IS 'Generated payment receipts with auto-numbered tracking';
COMMENT ON TABLE payment_notifications IS 'Payment reminder and confirmation notifications log';

COMMENT ON COLUMN tuition_payment_schedules.installments IS 'JSON array of installment definitions with percentage, due_date, and label';
COMMENT ON COLUMN student_tuition_installments.amount IS 'Calculated amount from percentage of total tuition fee';
COMMENT ON COLUMN payment_transactions.fee_type IS 'Type of fee being paid (inscription, scolarite, annexes, autres)';
COMMENT ON COLUMN payment_transactions.external_transaction_id IS 'Transaction ID from payment gateway (TresorPay)';
COMMENT ON COLUMN payment_transactions.gateway_response IS 'Full response from payment gateway for audit trail';

-- Migration complete
SELECT 'Migration 0012_student_payment_system.sql completed successfully' as result;
