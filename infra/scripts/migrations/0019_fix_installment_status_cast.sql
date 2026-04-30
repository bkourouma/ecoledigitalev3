-- Fix: Cast CASE expression to installment_status enum when updating student_tuition_installments.status
-- Context: Error "column \"status\" is of type installment_status but expression is of type text"
-- Date: 2025-09-01

-- Recreate function with explicit enum casts
CREATE OR REPLACE FUNCTION update_installment_status()
RETURNS TRIGGER AS $$
DECLARE
    installment_amount DECIMAL(12,2);
    total_paid DECIMAL(12,2);
    installment_due_date DATE;
BEGIN
    -- Only process for tuition payments linked to a specific installment
    IF NEW.fee_type = 'scolarite' AND NEW.tuition_installment_id IS NOT NULL THEN
        -- Get installment details
        SELECT amount, due_date INTO installment_amount, installment_due_date
        FROM student_tuition_installments
        WHERE id = NEW.tuition_installment_id;

        -- Calculate total paid for this installment (only completed transactions)
        SELECT COALESCE(SUM(amount), 0) INTO total_paid
        FROM payment_transactions
        WHERE tuition_installment_id = NEW.tuition_installment_id
          AND status = 'completed';

        -- Update installment status and amount paid
        UPDATE student_tuition_installments
        SET
            amount_paid = total_paid,
            status = (
                CASE
                    WHEN total_paid >= installment_amount THEN 'completed'
                    WHEN total_paid > 0 THEN 'partial'
                    WHEN CURRENT_DATE > installment_due_date THEN 'overdue'
                    ELSE 'pending'
                END
            )::installment_status,
            updated_at = NOW()
        WHERE id = NEW.tuition_installment_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- End of migration

