-- Migration: explicit DDL for app_whatsapp_delivery_log
-- The whatsapp helper at apps/api/src/services/whatsapp-delivery-log.ts creates this table
-- lazily via ensureWhatsAppDeliveryLogTable(), but the notifications dispatcher in PR 2 INSERTs
-- directly without going through that wrapper. On a fresh DB where no chat-driven WhatsApp send
-- has happened yet, the dispatcher hits "relation does not exist" and the in-flight notification
-- loop bails out after the first recipient — silently dropping notifications for everyone else.
--
-- Owning the table in a real migration removes that ordering dependency.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

CREATE INDEX IF NOT EXISTS idx_app_whatsapp_delivery_log_tenant_created
    ON app_whatsapp_delivery_log(tenant_id, created_at DESC);
