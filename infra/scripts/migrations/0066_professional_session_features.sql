-- 0066_professional_session_features.sql
-- Évaluations professionnelles + extension de live_sessions pour rattacher
-- les séances visio LiveKit à une session professionnelle (feature 028).
--
-- 1. professional_assignments + professional_assignment_submissions
-- 2. Ajout d'une 3ᵉ colonne parent à live_sessions pour pointer sur
--    professional_subject_sessions (parent_type = 'professional_subject').
-- Migration ADDITIVE, IDEMPOTENTE.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================================================
-- 1. professional_assignments — évaluations par matière (et optionnellement
--    rattachées à une session)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_assignments (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_subject_id  UUID NOT NULL REFERENCES professional_subjects(id) ON DELETE CASCADE,
    session_id               UUID REFERENCES professional_subject_sessions(id) ON DELETE SET NULL,
    titre                    VARCHAR(255) NOT NULL,
    description              TEXT,
    type                     VARCHAR(30) NOT NULL DEFAULT 'devoir'
                                CHECK (type IN ('devoir','controle','examen','projet','qcm','autre')),
    note_max                 NUMERIC(6,2) NOT NULL DEFAULT 20 CHECK (note_max > 0),
    coefficient              NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (coefficient > 0),
    consigne_url             TEXT,
    starts_at                TIMESTAMPTZ,
    due_at                   TIMESTAMPTZ,
    statut                   VARCHAR(20) NOT NULL DEFAULT 'publie'
                                CHECK (statut IN ('brouillon','publie','cloture')),
    created_by               UUID REFERENCES users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_assignments_subject
    ON professional_assignments (tenant_id, professional_subject_id);
CREATE INDEX IF NOT EXISTS idx_prof_assignments_session
    ON professional_assignments (tenant_id, session_id);

-- ===========================================================================
-- 2. professional_assignment_submissions — copies des étudiants
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_assignment_submissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    assignment_id   UUID NOT NULL REFERENCES professional_assignments(id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    statut          VARCHAR(20) NOT NULL DEFAULT 'en_attente'
                       CHECK (statut IN ('en_attente','soumis','en_correction','note','rejete')),
    file_url        TEXT,
    contenu         TEXT,
    note            NUMERIC(6,2),
    appreciation    TEXT,
    submitted_at    TIMESTAMPTZ,
    graded_at       TIMESTAMPTZ,
    graded_by       UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_submissions_assignment
    ON professional_assignment_submissions (tenant_id, assignment_id);
CREATE INDEX IF NOT EXISTS idx_prof_submissions_student
    ON professional_assignment_submissions (tenant_id, student_id);

-- ===========================================================================
-- 3. Row-Level Security
-- ===========================================================================
ALTER TABLE professional_assignments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_assignment_submissions   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY professional_assignments_tenant_isolation ON professional_assignments
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_assignment_submissions_tenant_isolation ON professional_assignment_submissions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- 4. live_sessions : ajout d'une 3ᵉ colonne parent pour
--    professional_subject_sessions (séances visio rattachées à une session pro
--    du Module Professionnel feature 028).
-- ===========================================================================
ALTER TABLE live_sessions
    ADD COLUMN IF NOT EXISTS professional_subject_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_live_sessions_prof_subject_session
    ON live_sessions(professional_subject_session_id);

-- Recrée la contrainte « exactement un parent » pour inclure la 3ᵉ colonne.
DO $$ BEGIN
    ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_exactly_one_parent;
    ALTER TABLE live_sessions ADD CONSTRAINT live_sessions_exactly_one_parent CHECK (
        (session_instance_id IS NOT NULL)::int
      + (session_professionnelle_id IS NOT NULL)::int
      + (professional_subject_session_id IS NOT NULL)::int
      = 1
    );
EXCEPTION WHEN others THEN NULL;
END $$;

-- Plus de UNIQUE strict : une session pro peut avoir PLUSIEURS séances visio
-- programmées (matin/après-midi, plusieurs sessions de cours).
-- On ne crée donc PAS de contrainte UNIQUE sur professional_subject_session_id.

-- Fin de la migration 0066_professional_session_features.sql
