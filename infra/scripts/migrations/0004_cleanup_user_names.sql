-- EcoleDigitale Database Schema Migration 0004 Cleanup
-- Remove the old name column after successful migration to first_name/last_name
-- This should be run after verifying that the application works with the new columns

-- Start transaction for atomic cleanup
BEGIN;

-- Step 1: Verify that first_name and last_name are properly populated
DO $$
DECLARE
    total_users INTEGER;
    users_with_first_name INTEGER;
    users_with_last_name INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_users FROM users;
    SELECT COUNT(*) INTO users_with_first_name FROM users WHERE first_name IS NOT NULL AND first_name != '';
    SELECT COUNT(*) INTO users_with_last_name FROM users WHERE last_name IS NOT NULL;
    
    RAISE NOTICE 'Cleanup verification:';
    RAISE NOTICE '  Total users: %', total_users;
    RAISE NOTICE '  Users with first_name: %', users_with_first_name;
    RAISE NOTICE '  Users with last_name: %', users_with_last_name;
    
    -- Ensure no data loss
    IF total_users != users_with_first_name THEN
        RAISE EXCEPTION 'Cleanup verification failed: Not all users have first_name populated';
    END IF;
END $$;

-- Step 2: Drop the computed_name column (temporary column)
ALTER TABLE users DROP COLUMN IF EXISTS computed_name;

-- Step 3: Drop the old name column
ALTER TABLE users DROP COLUMN IF EXISTS name;

-- Step 4: Update comments
COMMENT ON TABLE users IS 'Tenant-scoped user accounts with separate first and last names';

-- Commit the cleanup transaction
COMMIT;

RAISE NOTICE 'Migration 0004 cleanup completed successfully!';
RAISE NOTICE 'The old name column has been removed.';
RAISE NOTICE 'Users table now uses first_name and last_name columns only.';
