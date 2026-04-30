-- Update: Allow partial payments for immediate fees (inscription, annexes, autres)
-- The previous implementation required exact full amount and ignored prior payments,
-- causing valid admin collections to be rejected.
-- Date: 2025-09-01

CREATE OR REPLACE FUNCTION validate_payment_amount(
    enrollment_uuid UUID,
    fee_type_param payment_fee_type,
    amount_param DECIMAL
) RETURNS BOOLEAN AS $$
DECLARE
    enrollment_fees JSONB;
    fee_amount DECIMAL;
    paid_so_far DECIMAL := 0;
    outstanding DECIMAL;
BEGIN
    -- Get enrollment fees
    SELECT fees INTO enrollment_fees
    FROM student_enrollments
    WHERE id = enrollment_uuid;

    -- Extract configured fee amount
    fee_amount := (enrollment_fees ->> fee_type_param::text)::DECIMAL;

    -- Immediate fees: allow partial payments up to the outstanding amount
    IF fee_type_param IN ('inscription', 'annexes', 'autres') THEN
        SELECT COALESCE(SUM(amount), 0) INTO paid_so_far
        FROM payment_transactions
        WHERE enrollment_id = enrollment_uuid
          AND fee_type = fee_type_param
          AND status = 'completed';

        outstanding := GREATEST(fee_amount - paid_so_far, 0);

        -- Reject if already fully paid
        IF outstanding <= 0 THEN
            RETURN FALSE;
        END IF;

        -- Allow any positive amount up to the remaining outstanding
        RETURN amount_param > 0 AND amount_param <= outstanding;
    END IF;

    -- Tuition fees: still require positive amount not exceeding configured tuition
    RETURN amount_param > 0 AND amount_param <= fee_amount;
END;
$$ LANGUAGE plpgsql;

-- End of migration

