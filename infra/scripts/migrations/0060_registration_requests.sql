-- Migration: Public self-registration requests for students and parents
--
-- Students and parents can submit a registration request from the public site.
-- The request is stored here with status 'pending'. An administrator reviews it
-- in the validation interface and either approves it (which creates the real
-- user account + profile and emails the credentials) or rejects it.
--
-- No account is created until an administrator approves the request.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS registration_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Which kind of account the visitor is requesting.
    account_type VARCHAR(16) NOT NULL CHECK (account_type IN ('student', 'parent')),

    -- Identity fields common to both account types.
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(320) NOT NULL,
    phone VARCHAR(40),
    date_of_birth DATE,
    gender VARCHAR(16),
    address TEXT,

    -- Type-specific fields kept flexible: place_of_birth, nationality,
    -- current_year, father_name, mother_name (student) and relationship,
    -- child_matricule, profession (parent).
    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Review workflow.
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    review_notes TEXT,
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,

    -- Account created once the request is approved.
    created_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registration_requests_tenant_status
    ON registration_requests(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registration_requests_tenant_email
    ON registration_requests(tenant_id, LOWER(email));

-- Only one open (pending) request per email per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_registration_requests_pending_email
    ON registration_requests(tenant_id, LOWER(email))
    WHERE status = 'pending';

ALTER TABLE registration_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY registration_requests_tenant_isolation ON registration_requests
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
