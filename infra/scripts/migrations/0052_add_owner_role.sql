-- Migration: 0052_add_owner_role.sql
-- Purpose: Add tenant-scoped "owner" (Propriétaire) role for strategic dashboard access
-- Date: 2026-04-17

INSERT INTO roles (tenant_id, key, name)
SELECT t.id, 'owner', 'Propriétaire'
FROM tenants t
ON CONFLICT (tenant_id, key) DO NOTHING;

SELECT 'Migration 0052_add_owner_role.sql completed' AS status;
