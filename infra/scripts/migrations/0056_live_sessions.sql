-- Migration: LiveKit live sessions, recordings and attendance
-- Adds the polymorphic live_sessions table (school session_instances OR formation-pro sessions_professionnelles),
-- recording metadata captured from LiveKit Egress webhooks, and per-user attendance derived from
-- participant_joined / participant_left webhook events. Also adds a marked_via column to the existing
-- student_attendance table so rows produced by the LiveKit webhook can be distinguished from
-- teacher-marked rows.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- TABLE: live_sessions
-- ========================================
-- Exactly one of session_instance_id or session_professionnelle_id must be set.
-- room_name is the unique LiveKit room identifier and is prefixed with the tenant id
-- to guarantee no cross-tenant collisions.

CREATE TABLE IF NOT EXISTS live_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- FKs are intentionally soft (no REFERENCES). Each environment may have only one of the
    -- parent session tables provisioned (school-only tenants don't have sessions_professionnelles).
    -- The exactly-one-parent CHECK below + service-layer validation guards integrity.
    session_instance_id UUID,
    session_professionnelle_id UUID,

    room_name VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'live', 'ended')),
    recording_enabled BOOLEAN NOT NULL DEFAULT true,

    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT live_sessions_exactly_one_parent CHECK (
        (session_instance_id IS NOT NULL)::int
      + (session_professionnelle_id IS NOT NULL)::int
      = 1
    ),
    CONSTRAINT live_sessions_unique_per_session_instance UNIQUE (session_instance_id),
    CONSTRAINT live_sessions_unique_per_session_pro UNIQUE (session_professionnelle_id)
);

CREATE INDEX IF NOT EXISTS idx_live_sessions_tenant ON live_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_session_instance ON live_sessions(session_instance_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_session_pro ON live_sessions(session_professionnelle_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions(status);
CREATE INDEX IF NOT EXISTS idx_live_sessions_created_by ON live_sessions(created_by_user_id);

ALTER TABLE live_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY live_sessions_tenant_isolation ON live_sessions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS update_live_sessions_updated_at ON live_sessions;
CREATE TRIGGER update_live_sessions_updated_at
    BEFORE UPDATE ON live_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- TABLE: live_session_recordings
-- ========================================
-- One row per LiveKit Egress. egress_id is LiveKit's identifier and is unique per egress.

CREATE TABLE IF NOT EXISTS live_session_recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    live_session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,

    egress_id VARCHAR(128) NOT NULL UNIQUE,
    s3_key VARCHAR(1024),
    status VARCHAR(20) NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'ready', 'failed', 'aborted')),
    duration_sec INTEGER,
    file_size_bytes BIGINT,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_session_recordings_tenant ON live_session_recordings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_live_session_recordings_session ON live_session_recordings(live_session_id);
CREATE INDEX IF NOT EXISTS idx_live_session_recordings_status ON live_session_recordings(status);

ALTER TABLE live_session_recordings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY live_session_recordings_tenant_isolation ON live_session_recordings
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS update_live_session_recordings_updated_at ON live_session_recordings;
CREATE TRIGGER update_live_session_recordings_updated_at
    BEFORE UPDATE ON live_session_recordings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- TABLE: live_session_attendances
-- ========================================
-- One row per (live_session, attendee). total_seconds is the cumulative connected duration across
-- all join/leave pairs. counted_present is set on the room_finished webhook based on the
-- 50% attendance threshold described in PR scope.
--
-- Polymorphic identity: subject_kind tells us which user table the subject_user_id refers to:
--   'tenant_user'  → users.id (UUID)        — apps/web school side
--   'public_user'  → public_users.id (cuid) — apps/formation-pro-public side
-- We don't FK to either table because Postgres can't conditionally FK; integrity is enforced
-- at the application layer (the join-token endpoints validate the identity before any insert).

CREATE TABLE IF NOT EXISTS live_session_attendances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    live_session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    subject_kind VARCHAR(16) NOT NULL CHECK (subject_kind IN ('tenant_user', 'public_user')),
    subject_user_id VARCHAR(64) NOT NULL,
    participant_identity VARCHAR(255) NOT NULL,

    first_joined_at TIMESTAMPTZ,
    last_left_at TIMESTAMPTZ,
    total_seconds INTEGER NOT NULL DEFAULT 0,
    join_count INTEGER NOT NULL DEFAULT 0,

    counted_present BOOLEAN NOT NULL DEFAULT false,
    last_session_join_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT live_session_attendances_unique_subject UNIQUE (live_session_id, subject_kind, subject_user_id)
);

CREATE INDEX IF NOT EXISTS idx_live_session_attendances_tenant ON live_session_attendances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_live_session_attendances_session ON live_session_attendances(live_session_id);
CREATE INDEX IF NOT EXISTS idx_live_session_attendances_subject ON live_session_attendances(subject_kind, subject_user_id);
CREATE INDEX IF NOT EXISTS idx_live_session_attendances_present ON live_session_attendances(counted_present);

ALTER TABLE live_session_attendances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY live_session_attendances_tenant_isolation ON live_session_attendances
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS update_live_session_attendances_updated_at ON live_session_attendances;
CREATE TRIGGER update_live_session_attendances_updated_at
    BEFORE UPDATE ON live_session_attendances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- TABLE: live_session_webhook_events
-- ========================================
-- Idempotency log so retried webhook deliveries from LiveKit don't double-count attendance
-- or create duplicate recording rows. event_id comes from the LiveKit webhook payload.

CREATE TABLE IF NOT EXISTS live_session_webhook_events (
    event_id VARCHAR(128) PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================
-- ALTER: student_attendance.marked_via
-- ========================================
-- Lets the LiveKit webhook flag rows it produces as marked_via='livekit' so reporting can
-- distinguish them from teacher-marked rows. Existing rows default to 'teacher' for backfill.

ALTER TABLE student_attendance
    ADD COLUMN IF NOT EXISTS marked_via VARCHAR(32) NOT NULL DEFAULT 'teacher';

CREATE INDEX IF NOT EXISTS idx_student_attendance_marked_via ON student_attendance(marked_via);
