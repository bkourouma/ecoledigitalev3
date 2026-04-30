-- Migration: 0053_owner_pilotage_alerts.sql
-- Purpose: Pilotage alerts for Owner role (read + acknowledge)
-- Date: 2026-04-17

CREATE TABLE IF NOT EXISTS owner_pilotage_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  message TEXT NOT NULL,
  domain VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_owner_alerts_tenant_ack
  ON owner_pilotage_alerts (tenant_id, acknowledged_at);

CREATE INDEX IF NOT EXISTS idx_owner_alerts_tenant_sev_created
  ON owner_pilotage_alerts (tenant_id, severity, created_at DESC);

ALTER TABLE owner_pilotage_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_pilotage_alerts_tenant_policy ON owner_pilotage_alerts;

CREATE POLICY owner_pilotage_alerts_tenant_policy ON owner_pilotage_alerts
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);

COMMENT ON TABLE owner_pilotage_alerts IS
  'Strategic alerts for the Owner role; acknowledged by owner user id.';

SELECT 'Migration 0053_owner_pilotage_alerts.sql completed' AS status;
