-- Migration: 0029_parent_messages_system.sql
-- Description: Create tables for parent communications and messages system
-- Date: 2025-01-27
-- Feature: Parent Communications & Messages (010-parent-messages)

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ENUM types for messages system
DO $$ BEGIN
    CREATE TYPE message_priority AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE conversation_status AS ENUM ('active', 'archived', 'closed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM ('message', 'announcement', 'event', 'grade', 'payment', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE rsvp_status AS ENUM ('pending', 'accepted', 'declined', 'tentative');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create teacher_messages table
CREATE TABLE IF NOT EXISTS teacher_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority_level message_priority,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create school_announcements table
CREATE TABLE IF NOT EXISTS school_announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority_level message_priority,
    posted_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create parent_teacher_conversations table
CREATE TABLE IF NOT EXISTS parent_teacher_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    status conversation_status DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create conversation_messages table
CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES parent_teacher_conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    action_link TEXT,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create event_invitations table
CREATE TABLE IF NOT EXISTS event_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID, -- Optional reference to events table if it exists
    parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID REFERENCES student_profiles(id) ON DELETE CASCADE,
    event_name VARCHAR(255) NOT NULL,
    event_description TEXT,
    event_date TIMESTAMPTZ NOT NULL,
    event_location VARCHAR(255),
    organizer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rsvp_status rsvp_status DEFAULT 'pending',
    rsvp_deadline DATE,
    rsvp_response_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Drop existing announcement_reads table if it exists with wrong structure
DO $$ 
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'announcement_reads'
    ) AND NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'announcement_reads' 
        AND column_name = 'tenant_id'
    ) THEN
        DROP TABLE announcement_reads CASCADE;
    END IF;
END $$;

-- Create announcement_reads table for tracking read status
CREATE TABLE IF NOT EXISTS announcement_reads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    announcement_id UUID NOT NULL REFERENCES school_announcements(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(announcement_id, parent_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_teacher_messages_tenant_id ON teacher_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teacher_messages_parent_id ON teacher_messages(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_teacher_messages_student_id ON teacher_messages(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_teacher_messages_teacher_id ON teacher_messages(tenant_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_messages_sent_at ON teacher_messages(tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_messages_read_at ON teacher_messages(tenant_id, read_at);

CREATE INDEX IF NOT EXISTS idx_school_announcements_tenant_id ON school_announcements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_school_announcements_posted_at ON school_announcements(tenant_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_announcements_author_id ON school_announcements(tenant_id, author_id);

CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_tenant_id ON parent_teacher_conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_parent_id ON parent_teacher_conversations(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_teacher_id ON parent_teacher_conversations(tenant_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_student_id ON parent_teacher_conversations(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_updated_at ON parent_teacher_conversations(tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_tenant_id ON conversation_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_sent_at ON conversation_messages(tenant_id, conversation_id, sent_at ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_read_at ON conversation_messages(tenant_id, read_at);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_parent_id ON notifications(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(tenant_id, parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(tenant_id, parent_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(tenant_id, parent_id, notification_type);

CREATE INDEX IF NOT EXISTS idx_event_invitations_tenant_id ON event_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_event_invitations_parent_id ON event_invitations(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_event_invitations_student_id ON event_invitations(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_event_invitations_event_date ON event_invitations(tenant_id, event_date ASC);
CREATE INDEX IF NOT EXISTS idx_event_invitations_rsvp_status ON event_invitations(tenant_id, parent_id, rsvp_status);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_tenant_id ON announcement_reads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement_id ON announcement_reads(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_parent_id ON announcement_reads(parent_id);

-- Enable Row Level Security on all tables
ALTER TABLE teacher_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_teacher_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
DO $$ BEGIN
    CREATE POLICY teacher_messages_tenant_policy ON teacher_messages
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY school_announcements_tenant_policy ON school_announcements
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY parent_teacher_conversations_tenant_policy ON parent_teacher_conversations
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY conversation_messages_tenant_policy ON conversation_messages
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY notifications_tenant_policy ON notifications
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY event_invitations_tenant_policy ON event_invitations
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY announcement_reads_tenant_policy ON announcement_reads
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_teacher_messages_updated_at BEFORE UPDATE ON teacher_messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_school_announcements_updated_at BEFORE UPDATE ON school_announcements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_parent_teacher_conversations_updated_at BEFORE UPDATE ON parent_teacher_conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_invitations_updated_at BEFORE UPDATE ON event_invitations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create trigger to update conversation updated_at when a message is added
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE parent_teacher_conversations
    SET updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_conversation_on_message_insert AFTER INSERT ON conversation_messages
    FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();

