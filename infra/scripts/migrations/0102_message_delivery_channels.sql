-- 0102 — Journal d'envoi multi-canal des messages
--
-- `app_whatsapp_delivery_log` ne traçait que le relais WhatsApp. Les messages
-- de l'administration peuvent désormais être relayés par email : la table
-- devient le journal commun des deux canaux.
--
-- `channel` vaut 'whatsapp' pour l'existant (défaut), 'email' pour les
-- nouvelles lignes email. `recipient_address` porte l'adresse email visée,
-- pendant de `phone_e164` pour WhatsApp.

CREATE TABLE IF NOT EXISTS app_whatsapp_delivery_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type VARCHAR(80) NOT NULL,
  source_id UUID,
  recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  phone_e164 VARCHAR(32),
  message_preview TEXT,
  status VARCHAR(32) NOT NULL,
  provider_response JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_whatsapp_delivery_log
  ADD COLUMN IF NOT EXISTS channel VARCHAR(16) NOT NULL DEFAULT 'whatsapp';

ALTER TABLE app_whatsapp_delivery_log
  ADD COLUMN IF NOT EXISTS recipient_address VARCHAR(320);

CREATE INDEX IF NOT EXISTS idx_app_whatsapp_delivery_log_tenant_created
  ON app_whatsapp_delivery_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_delivery_log_tenant_channel_created
  ON app_whatsapp_delivery_log(tenant_id, channel, created_at DESC);
