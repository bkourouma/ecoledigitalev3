-- EcoleDigitale Database Schema Migration 0004
-- Split users.name field into first_name and last_name
-- This migration preserves all existing data and maintains RLS policies

-- Enable UUID extension (should already exist)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Start transaction for atomic migration
BEGIN;

-- Step 1: Add new columns to users table
ALTER TABLE users 
ADD COLUMN first_name VARCHAR(100),
ADD COLUMN last_name VARCHAR(100);

-- Step 2: Create function to intelligently split names
CREATE OR REPLACE FUNCTION split_user_name(full_name TEXT, OUT first_name TEXT, OUT last_name TEXT) AS $$
BEGIN
    -- Handle null or empty names
    IF full_name IS NULL OR TRIM(full_name) = '' THEN
        first_name := '';
        last_name := '';
        RETURN;
    END IF;
    
    -- Trim whitespace and normalize spaces
    full_name := TRIM(REGEXP_REPLACE(full_name, '\s+', ' ', 'g'));
    
    -- Split on first space
    IF POSITION(' ' IN full_name) > 0 THEN
        first_name := TRIM(SUBSTRING(full_name FROM 1 FOR POSITION(' ' IN full_name) - 1));
        last_name := TRIM(SUBSTRING(full_name FROM POSITION(' ' IN full_name) + 1));
    ELSE
        -- Single name goes to first_name, last_name is empty
        first_name := full_name;
        last_name := '';
    END IF;
    
    -- Ensure we don't exceed column limits
    first_name := SUBSTRING(first_name FROM 1 FOR 100);
    last_name := SUBSTRING(last_name FROM 1 FOR 100);
END;
$$ LANGUAGE plpgsql;

-- Step 3: Migrate existing data
UPDATE users 
SET (first_name, last_name) = (
    SELECT first_name, last_name 
    FROM split_user_name(name)
)
WHERE first_name IS NULL OR last_name IS NULL;

-- Step 4: Add NOT NULL constraints to new columns
ALTER TABLE users 
ALTER COLUMN first_name SET NOT NULL,
ALTER COLUMN last_name SET NOT NULL;

-- Step 5: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_first_name ON users(tenant_id, first_name);
CREATE INDEX IF NOT EXISTS idx_users_last_name ON users(tenant_id, last_name);
CREATE INDEX IF NOT EXISTS idx_users_full_name ON users(tenant_id, first_name, last_name);

-- Step 6: Add computed column for backward compatibility (temporary)
ALTER TABLE users ADD COLUMN computed_name VARCHAR(255) GENERATED ALWAYS AS (
    CASE 
        WHEN last_name = '' THEN first_name
        ELSE first_name || ' ' || last_name
    END
) STORED;

-- Step 7: Update the updated_at trigger to include new columns
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Step 8: Verify data integrity
DO $$
DECLARE
    total_users INTEGER;
    users_with_first_name INTEGER;
    users_with_last_name INTEGER;
    users_with_empty_names INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_users FROM users;
    SELECT COUNT(*) INTO users_with_first_name FROM users WHERE first_name IS NOT NULL AND first_name != '';
    SELECT COUNT(*) INTO users_with_last_name FROM users WHERE last_name IS NOT NULL;
    SELECT COUNT(*) INTO users_with_empty_names FROM users WHERE first_name = '' AND last_name = '';
    
    RAISE NOTICE 'Migration verification:';
    RAISE NOTICE '  Total users: %', total_users;
    RAISE NOTICE '  Users with first_name: %', users_with_first_name;
    RAISE NOTICE '  Users with last_name: %', users_with_last_name;
    RAISE NOTICE '  Users with empty names: %', users_with_empty_names;
    
    -- Ensure no data loss
    IF total_users != users_with_first_name THEN
        RAISE EXCEPTION 'Data integrity check failed: Not all users have first_name populated';
    END IF;
END $$;

-- Step 9: Add comments for documentation
COMMENT ON COLUMN users.first_name IS 'User first name (migrated from name field)';
COMMENT ON COLUMN users.last_name IS 'User last name (migrated from name field)';
COMMENT ON COLUMN users.computed_name IS 'Computed full name for backward compatibility (temporary)';

-- Step 10: Clean up the split function (no longer needed)
DROP FUNCTION split_user_name(TEXT);

-- Commit the transaction
COMMIT;

-- Final verification outside transaction
DO $$
DECLARE
    sample_users RECORD;
BEGIN
    RAISE NOTICE 'Sample of migrated users:';
    FOR sample_users IN 
        SELECT first_name, last_name, computed_name, name
        FROM users 
        LIMIT 5
    LOOP
        RAISE NOTICE '  % % -> computed: %, original: %', 
            sample_users.first_name, 
            sample_users.last_name, 
            sample_users.computed_name,
            sample_users.name;
    END LOOP;
END $$;

RAISE NOTICE 'Migration 0004 completed successfully!';
RAISE NOTICE 'Next steps:';
RAISE NOTICE '1. Update application code to use first_name and last_name';
RAISE NOTICE '2. Test thoroughly with the computed_name column';
RAISE NOTICE '3. Run the cleanup migration to remove the old name column';
