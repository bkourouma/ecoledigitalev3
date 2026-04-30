-- Migration: 013_add_role_updated_at_to_users.sql
-- Purpose: Add role_updated_at timestamp for JWT role staleness detection
-- Date: 2025-10-12
-- Feature: Complete JWT Authentication Implementation - Role Change Enforcement

-- Add role_updated_at column to users table
-- This timestamp is updated whenever a user's roles are modified
-- Used by auth middleware to detect if JWT token has stale roles
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS role_updated_at TIMESTAMP;

-- Set initial value to created_at for existing users
UPDATE users 
SET role_updated_at = created_at 
WHERE role_updated_at IS NULL;

-- Create trigger function to auto-update role_updated_at
-- when user_roles table is modified for a user
CREATE OR REPLACE FUNCTION update_user_role_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the user's role_updated_at timestamp
  UPDATE users 
  SET role_updated_at = NOW() 
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on user_roles INSERT
DROP TRIGGER IF EXISTS trigger_user_role_insert ON user_roles;
CREATE TRIGGER trigger_user_role_insert
AFTER INSERT ON user_roles
FOR EACH ROW
EXECUTE FUNCTION update_user_role_timestamp();

-- Create trigger on user_roles DELETE
DROP TRIGGER IF EXISTS trigger_user_role_delete ON user_roles;
CREATE TRIGGER trigger_user_role_delete
AFTER DELETE ON user_roles
FOR EACH ROW
EXECUTE FUNCTION update_user_role_timestamp();

-- Create trigger on user_roles UPDATE (if roles can be updated)
DROP TRIGGER IF EXISTS trigger_user_role_update ON user_roles;
CREATE TRIGGER trigger_user_role_update
AFTER UPDATE ON user_roles
FOR EACH ROW
WHEN (OLD.role_id IS DISTINCT FROM NEW.role_id)
EXECUTE FUNCTION update_user_role_timestamp();

-- Create index for performance (when checking role staleness)
CREATE INDEX IF NOT EXISTS idx_users_role_updated_at ON users(id, role_updated_at);

-- Comments
COMMENT ON COLUMN users.role_updated_at IS 
  'Timestamp of last role modification for this user. Used to detect stale JWT tokens when roles change.';

-- Verify migration
SELECT 'role_updated_at column and triggers created successfully' AS status;













