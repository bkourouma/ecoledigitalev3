-- Migration: 012_create_token_blacklist_table.sql
-- Purpose: Create token blacklist table for JWT token revocation
-- Date: 2025-10-12
-- Feature: Complete JWT Authentication Implementation

-- Create token_blacklist table
CREATE TABLE IF NOT EXISTS token_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Tenant isolation (CRITICAL for multi-tenancy)
  tenant_id UUID NOT NULL,
  
  -- Token identification
  token_jti VARCHAR(64) NOT NULL,           -- JWT ID claim (from JWT payload)
  user_id UUID NOT NULL,                    -- User who owned the token
  
  -- Revocation metadata
  revoked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,             -- Copy of token exp (for cleanup)
  reason VARCHAR(50),                        -- 'role_change', 'account_deleted', 'forced_logout', 'admin_revoked'
  revoked_by UUID,                           -- Admin user who revoked (if applicable)
  
  -- Constraints
  CONSTRAINT fk_token_blacklist_tenant FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_token_blacklist_user FOREIGN KEY (user_id) 
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT unique_tenant_token UNIQUE(tenant_id, token_jti)
);

-- Indexes for performance
-- Primary lookup index: check if token is blacklisted (tenant + jti)
CREATE INDEX idx_blacklist_lookup ON token_blacklist(tenant_id, token_jti, expires_at);

-- Index for querying user's blacklisted tokens
CREATE INDEX idx_blacklist_user ON token_blacklist(tenant_id, user_id);

-- Index for cleanup operations (daily cron job)
CREATE INDEX idx_blacklist_cleanup ON token_blacklist(expires_at);

-- Row Level Security (RLS) for tenant isolation
ALTER TABLE token_blacklist ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see tokens from their tenant
-- This enforces Constitution Principle I: Multi-Tenant Isolation
CREATE POLICY tenant_isolation_policy ON token_blacklist
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Comments for documentation
COMMENT ON TABLE token_blacklist IS 
  'Stores revoked JWT tokens that remain valid by signature but must be rejected. Used for immediate role change enforcement, forced logout, and account deletion. Tokens are automatically cleaned up after expiration via daily cron job.';

COMMENT ON COLUMN token_blacklist.token_jti IS 
  'JWT ID claim from token payload - used for O(1) lookup during validation';

COMMENT ON COLUMN token_blacklist.expires_at IS 
  'Copied from token exp claim - enables automatic cleanup of expired entries';

COMMENT ON COLUMN token_blacklist.reason IS 
  'Why token was revoked: role_change | account_deleted | forced_logout | admin_revoked';

COMMENT ON COLUMN token_blacklist.revoked_by IS 
  'UUID of admin user who revoked the token (NULL for automatic revocations)';

-- Verify table created
SELECT 'Token blacklist table created successfully' AS status;

