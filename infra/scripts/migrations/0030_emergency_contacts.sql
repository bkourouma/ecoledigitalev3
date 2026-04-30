-- Migration: 0030_emergency_contacts.sql
-- Description: Create table for parent emergency contacts
-- Date: 2025-01-27
-- Feature: Parent Settings - Emergency Contacts (011-parent-settings)

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create emergency_contacts table
CREATE TABLE IF NOT EXISTS emergency_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_name VARCHAR(255) NOT NULL,
    relationship VARCHAR(100) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_tenant_id ON emergency_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_parent_id ON emergency_contacts(parent_id);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_tenant_parent ON emergency_contacts(tenant_id, parent_id);

-- Enable Row Level Security
ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for emergency_contacts table
-- Policy: Parents can only access their own emergency contacts
CREATE POLICY emergency_contacts_tenant_policy ON emergency_contacts
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
COMMENT ON TABLE emergency_contacts IS 'Emergency contacts for parents';
COMMENT ON COLUMN emergency_contacts.id IS 'Primary key';
COMMENT ON COLUMN emergency_contacts.tenant_id IS 'Multi-tenant isolation';
COMMENT ON COLUMN emergency_contacts.parent_id IS 'Reference to parent user';
COMMENT ON COLUMN emergency_contacts.contact_name IS 'Full name of the emergency contact';
COMMENT ON COLUMN emergency_contacts.relationship IS 'Relationship to parent (e.g., spouse, sibling, friend)';
COMMENT ON COLUMN emergency_contacts.phone IS 'Phone number of the emergency contact';
COMMENT ON COLUMN emergency_contacts.email IS 'Email address of the emergency contact (optional)';
COMMENT ON COLUMN emergency_contacts.created_at IS 'Creation timestamp';
COMMENT ON COLUMN emergency_contacts.updated_at IS 'Last update timestamp';

