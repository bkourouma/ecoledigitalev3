-- Migration 0014: cycles_frais (cycle-level default fees)
-- Creates a tenant-scoped table to store default fees per academic cycle

-- Create table
CREATE TABLE IF NOT EXISTS cycles_frais (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    inscription DECIMAL(12,2) NOT NULL DEFAULT 0,
    scolarite DECIMAL(12,2) NOT NULL DEFAULT 0,
    annexes DECIMAL(12,2) NOT NULL DEFAULT 0,
    autres DECIMAL(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'XOF',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, cycle_id)
);

-- Enable RLS
ALTER TABLE cycles_frais ENABLE ROW LEVEL SECURITY;

-- RLS policy: restrict by tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cycles_frais' AND policyname = 'cycles_frais_tenant_policy'
  ) THEN
    CREATE POLICY cycles_frais_tenant_policy ON cycles_frais
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cycles_frais_tenant_id ON cycles_frais(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cycles_frais_cycle_id ON cycles_frais(cycle_id);

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_cycles_frais ON cycles_frais;
CREATE TRIGGER set_timestamp_cycles_frais
BEFORE UPDATE ON cycles_frais
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

