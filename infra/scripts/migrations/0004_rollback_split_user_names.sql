-- EcoleDigitale Database Schema Migration 0004 ROLLBACK
-- Rollback the split of users.name field from first_name and last_name
-- This script reverses the changes made in 0004_split_user_names.sql

-- Start transaction for atomic rollback
BEGIN;

-- Step 1: Verify that we can safely rollback
DO $$
DECLARE
    first_name_exists BOOLEAN;
    last_name_exists BOOLEAN;
    computed_name_exists BOOLEAN;
    name_exists BOOLEAN;
BEGIN
    -- Check if the new columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'first_name'
    ) INTO first_name_exists;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'last_name'
    ) INTO last_name_exists;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'computed_name'
    ) INTO computed_name_exists;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'name'
    ) INTO name_exists;
    
    IF NOT first_name_exists OR NOT last_name_exists THEN
        RAISE EXCEPTION 'Cannot rollback: first_name or last_name columns do not exist';
    END IF;
    
    IF NOT name_exists THEN
        RAISE NOTICE 'Original name column does not exist, will recreate it';
    END IF;
    
    RAISE NOTICE 'Rollback verification passed';
END $$;

-- Step 2: Recreate the name column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'name'
    ) THEN
        ALTER TABLE users ADD COLUMN name VARCHAR(255);
        RAISE NOTICE 'Recreated name column';
    END IF;
END $$;

-- Step 3: Restore the name field from first_name and last_name
UPDATE users 
SET name = CASE 
    WHEN last_name = '' OR last_name IS NULL THEN first_name
    ELSE first_name || ' ' || last_name
END
WHERE name IS NULL OR name = '';

-- Step 4: Ensure name column is not null
UPDATE users 
SET name = COALESCE(
    CASE 
        WHEN last_name = '' OR last_name IS NULL THEN first_name
        ELSE first_name || ' ' || last_name
    END,
    'Unknown User'
)
WHERE name IS NULL OR name = '';

-- Step 5: Add NOT NULL constraint to name column
ALTER TABLE users ALTER COLUMN name SET NOT NULL;

-- Step 6: Drop indexes created for first_name and last_name
DROP INDEX IF EXISTS idx_users_first_name;
DROP INDEX IF EXISTS idx_users_last_name;
DROP INDEX IF EXISTS idx_users_full_name;

-- Step 7: Drop the new columns
ALTER TABLE users DROP COLUMN IF EXISTS computed_name;
ALTER TABLE users DROP COLUMN IF EXISTS first_name;
ALTER TABLE users DROP COLUMN IF EXISTS last_name;

-- Step 8: Recreate the original updated_at trigger
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Step 9: Verify rollback integrity
DO $$
DECLARE
    total_users INTEGER;
    users_with_name INTEGER;
    users_with_empty_name INTEGER;
    sample_user RECORD;
BEGIN
    SELECT COUNT(*) INTO total_users FROM users;
    SELECT COUNT(*) INTO users_with_name FROM users WHERE name IS NOT NULL AND name != '';
    SELECT COUNT(*) INTO users_with_empty_name FROM users WHERE name = '' OR name IS NULL;
    
    RAISE NOTICE 'Rollback verification:';
    RAISE NOTICE '  Total users: %', total_users;
    RAISE NOTICE '  Users with name: %', users_with_name;
    RAISE NOTICE '  Users with empty name: %', users_with_empty_name;
    
    -- Show sample of restored data
    RAISE NOTICE 'Sample of restored users:';
    FOR sample_user IN 
        SELECT id, email, name
        FROM users 
        LIMIT 3
    LOOP
        RAISE NOTICE '  User: % - %', sample_user.email, sample_user.name;
    END LOOP;
    
    -- Ensure no data loss
    IF total_users != users_with_name THEN
        RAISE EXCEPTION 'Rollback integrity check failed: Not all users have name populated';
    END IF;
END $$;

-- Commit the rollback transaction
COMMIT;

RAISE NOTICE 'Migration 0004 rollback completed successfully!';
RAISE NOTICE 'The users table has been restored to its original state with the name column.';
RAISE NOTICE 'Remember to update your application code to use the name field again.';
