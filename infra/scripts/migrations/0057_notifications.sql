-- Migration: Generic in-app notifications inbox
-- Per-user notification rows powering the bell UI in apps/web and apps/formation-pro-public.
-- Independent from the existing payment-specific notification.service.ts and from the
-- parent-only notification_preferences table (migration 0031).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- TABLE: notifications
-- ========================================
-- One row per delivered in-app notification. The dispatcher (notifications-dispatch.service.ts)
-- writes to this table for the in-app channel; for email/whatsapp it logs to its own delivery
-- tables (app_whatsapp_delivery_log already exists; we add app_email_delivery_log below).
--
-- payload is a free-form JSON object so notification consumers in the UI can embed extra context
-- (e.g. liveSessionId for a "live now" notification). channels_sent records which delivery
-- channels actually succeeded so the UI can show a discreet badge.

CREATE TABLE IF NOT EXISTS app_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Polymorphic recipient: subject_kind picks the user table.
    --   'tenant_user' → users.id (UUID)        — apps/web
    --   'public_user' → public_users.id (cuid) — apps/formation-pro-public
    subject_kind VARCHAR(16) NOT NULL CHECK (subject_kind IN ('tenant_user', 'public_user')),
    subject_user_id VARCHAR(64) NOT NULL,

    type VARCHAR(64) NOT NULL,          -- e.g. 'live_session.invite', 'live_session.started'
    title VARCHAR(255) NOT NULL,
    body TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_url VARCHAR(1024),           -- optional CTA URL the bell can deep-link to

    channels_sent JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of strings: ['inapp','email','whatsapp']
    read_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_notifications_tenant_subject_unread
    ON app_notifications(tenant_id, subject_kind, subject_user_id, read_at)
    WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_notifications_tenant_subject_created
    ON app_notifications(tenant_id, subject_kind, subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_notifications_type ON app_notifications(tenant_id, type);

ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY app_notifications_tenant_isolation ON app_notifications
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ========================================
-- TABLE: app_email_delivery_log
-- ========================================
-- Mirror of app_whatsapp_delivery_log for the email channel so the dispatcher has a single
-- consistent place to inspect / retry failed deliveries. Existing email.service.ts does not
-- log; we wire that here instead of patching email.service.ts.

CREATE TABLE IF NOT EXISTS app_email_delivery_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    notification_id UUID REFERENCES app_notifications(id) ON DELETE SET NULL,
    -- Polymorphic recipient identifier (no FK so it works for both school + public users).
    recipient_subject_kind VARCHAR(16),
    recipient_subject_user_id VARCHAR(64),
    recipient_email VARCHAR(320),
    subject VARCHAR(512),
    status VARCHAR(32) NOT NULL,        -- sent | failed | skipped_no_email | skipped_not_configured
    provider_response JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_email_delivery_log_tenant_created
    ON app_email_delivery_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_email_delivery_log_notification
    ON app_email_delivery_log(notification_id);

ALTER TABLE app_email_delivery_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY app_email_delivery_log_tenant_isolation ON app_email_delivery_log
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
