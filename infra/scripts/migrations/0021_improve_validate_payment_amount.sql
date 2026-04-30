-- Update: Improve validate_payment_amount function with better error handling
-- This migration improves the validation function to handle NULL values and edge cases
-- Date: 2025-01-27

-- First, create a function that returns detailed validation results
CREATE OR REPLACE FUNCTION validate_payment_amount_detailed(
    enrollment_uuid UUID,
    fee_type_param payment_fee_type,
    amount_param DECIMAL
) RETURNS JSONB AS $$
DECLARE
    enrollment_fees JSONB;
    fee_amount DECIMAL;
    paid_so_far DECIMAL := 0;
    outstanding DECIMAL;
    validation_result JSONB;
BEGIN
    -- Get enrollment fees
    SELECT fees INTO enrollment_fees
    FROM student_enrollments
    WHERE id = enrollment_uuid;

    -- Check if enrollment exists
    IF enrollment_fees IS NULL THEN
        RETURN jsonb_build_object(
            'is_valid', false,
            'error', 'ENROLLMENT_NOT_FOUND',
            'message', 'Enrollment not found'
        );
    END IF;

    -- Extract configured fee amount (handle NULL)
    fee_amount := COALESCE((enrollment_fees ->> fee_type_param::text)::DECIMAL, 0);

    -- Check if fee is configured
    IF fee_amount IS NULL OR fee_amount <= 0 THEN
        RETURN jsonb_build_object(
            'is_valid', false,
            'error', 'FEE_NOT_CONFIGURED',
            'message', format('Fee type %s is not configured for this enrollment', fee_type_param),
            'configured_amount', 0
        );
    END IF;

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
            RETURN jsonb_build_object(
                'is_valid', false,
                'error', 'ALREADY_FULLY_PAID',
                'message', format('Fee type %s is already fully paid', fee_type_param),
                'configured_amount', fee_amount,
                'paid_amount', paid_so_far,
                'outstanding', 0
            );
        END IF;

        -- Check if amount exceeds outstanding
        IF amount_param > outstanding THEN
            RETURN jsonb_build_object(
                'is_valid', false,
                'error', 'AMOUNT_EXCEEDS_OUTSTANDING',
                'message', format('Payment amount (%.2f) exceeds outstanding amount (%.2f)', amount_param, outstanding),
                'configured_amount', fee_amount,
                'paid_amount', paid_so_far,
                'outstanding', outstanding,
                'requested_amount', amount_param
            );
        END IF;

        -- Check if amount is positive
        IF amount_param <= 0 THEN
            RETURN jsonb_build_object(
                'is_valid', false,
                'error', 'INVALID_AMOUNT',
                'message', 'Payment amount must be greater than 0',
                'outstanding', outstanding
            );
        END IF;

        -- Valid payment
        RETURN jsonb_build_object(
            'is_valid', true,
            'configured_amount', fee_amount,
            'paid_amount', paid_so_far,
            'outstanding', outstanding,
            'requested_amount', amount_param
        );
    END IF;

    -- Tuition fees: still require positive amount not exceeding configured tuition
    IF amount_param <= 0 THEN
        RETURN jsonb_build_object(
            'is_valid', false,
            'error', 'INVALID_AMOUNT',
            'message', 'Payment amount must be greater than 0',
            'configured_amount', fee_amount
        );
    END IF;

    IF amount_param > fee_amount THEN
        RETURN jsonb_build_object(
            'is_valid', false,
            'error', 'AMOUNT_EXCEEDS_CONFIGURED',
            'message', format('Payment amount (%.2f) exceeds configured tuition amount (%.2f)', amount_param, fee_amount),
            'configured_amount', fee_amount,
            'requested_amount', amount_param
        );
    END IF;

    -- Valid payment
    RETURN jsonb_build_object(
        'is_valid', true,
        'configured_amount', fee_amount,
        'requested_amount', amount_param
    );
END;
$$ LANGUAGE plpgsql;

-- Update the original function to use the detailed version
CREATE OR REPLACE FUNCTION validate_payment_amount(
    enrollment_uuid UUID,
    fee_type_param payment_fee_type,
    amount_param DECIMAL
) RETURNS BOOLEAN AS $$
DECLARE
    result JSONB;
BEGIN
    result := validate_payment_amount_detailed(enrollment_uuid, fee_type_param, amount_param);
    RETURN (result->>'is_valid')::boolean;
END;
$$ LANGUAGE plpgsql;

-- End of migration

