-- EcoleDigitale Database Migration 0006
-- Insert predefined cycles (BTS, Licence, Master, BBA, MBA, EDBA)

-- Get the tenant ID for imhotepacademy
DO $$
DECLARE
    tenant_id UUID;
BEGIN
    -- Get tenant ID
    SELECT id INTO tenant_id FROM tenants WHERE slug = 'imhotepacademy';
    
    IF tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant "imhotepacademy" not found. Please run the basic seed script first.';
    END IF;

    -- Insert cycles with proper schema adaptation
    INSERT INTO cycles (id, tenant_id, name, code, type, duration_months, description, certification_level, status)
    VALUES 
        ('550e8400-e29b-41d4-a716-446655440001', tenant_id, 'BTS', 'BTS', 'professional', 24, 'Brevet de Technicien Supérieur', 'Bac+2', 'active'),
        ('550e8400-e29b-41d4-a716-446655440002', tenant_id, 'Licence', 'LICENCE', 'academic', 36, 'Licence (Bac+3)', 'Bac+3', 'active'),
        ('550e8400-e29b-41d4-a716-446655440003', tenant_id, 'Master', 'MASTER', 'academic', 24, 'Master (Bac+5)', 'Bac+5', 'active'),
        ('550e8400-e29b-41d4-a716-446655440004', tenant_id, 'BBA', 'BBA', 'academic', 36, 'Bachelor of Business Administration', 'Bac+3', 'active'),
        ('550e8400-e29b-41d4-a716-446655440005', tenant_id, 'MBA', 'MBA', 'academic', 24, 'Master of Business Administration', 'Bac+5', 'active'),
        ('550e8400-e29b-41d4-a716-446655440006', tenant_id, 'EDBA', 'EDBA', 'academic', 36, 'Executive Doctorate in Business Administration', 'Bac+8', 'active')
    ON CONFLICT (cycles.tenant_id, cycles.code) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        duration_months = EXCLUDED.duration_months,
        description = EXCLUDED.description,
        certification_level = EXCLUDED.certification_level,
        status = EXCLUDED.status,
        updated_at = NOW();

    RAISE NOTICE 'Successfully inserted/updated 6 cycles for tenant %', tenant_id;
END $$;

-- Migration complete
SELECT 'Migration 0006_insert_cycles.sql completed successfully' as result;
