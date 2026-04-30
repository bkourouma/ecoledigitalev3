-- Migration: 0031_notification_preferences.sql
-- Description: Create table for parent notification preferences
-- Date: 2025-01-27
-- Feature: Parent Settings - Notification Preferences (011-parent-settings)

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Note: notification_type ENUM already exists from migration 0029_parent_messages_system.sql
-- If it doesn't exist, create it
DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM ('message', 'announcement', 'event', 'grade', 'payment', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create notification_preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type notification_type NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    delivery_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, parent_id, notification_type)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_notification_preferences_tenant_id ON notification_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_parent_id ON notification_preferences(parent_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_tenant_parent ON notification_preferences(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_type ON notification_preferences(tenant_id, parent_id, notification_type);

-- Enable Row Level Security
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for notification_preferences table
-- Policy: Parents can only access their own notification preferences
CREATE POLICY notification_preferences_tenant_policy ON notification_preferences
    FOR ALL
    USING (
        tenant_id = current_setting('app.tenant_id', true)::UUID
        AND parent_id = current_setting('app.user_id', true)::UUID
    )
    WITH CHECK (
        tenant_id = current_setting('app.tenant_id', true)::UUID
        AND parent_id = current_setting('app.user_id', true)::UUID
    );

-- Add comments for documentation
COMMENT ON TABLE notification_preferences IS 'Notification preferences for parents';
COMMENT ON COLUMN notification_preferences.id IS 'Primary key';
COMMENT ON COLUMN notification_preferences.tenant_id IS 'Multi-tenant isolation';
COMMENT ON COLUMN notification_preferences.parent_id IS 'Reference to parent user';
COMMENT ON COLUMN notification_preferences.notification_type IS 'Type of notification (message, announcement, event, grade, payment, other)';
COMMENT ON COLUMN notification_preferences.enabled IS 'Whether notifications are enabled for this type';
COMMENT ON COLUMN notification_preferences.delivery_methods IS 'Delivery methods array (email, in-app, sms) as JSONB';
COMMENT ON COLUMN notification_preferences.created_at IS 'Creation timestamp';
COMMENT ON COLUMN notification_preferences.updated_at IS 'Last update timestamp';

