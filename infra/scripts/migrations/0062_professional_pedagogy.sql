-- 0062_professional_pedagogy.sql
-- Feature 028-professional-module — US6 : rattachement pédagogique des
-- sessions professionnelles (présences, supports de cours).
--
-- Décision research R3-addendum : les tables académiques (attendance_sessions,
-- course_materials, assignments) ont des FK NOT NULL vers le modèle académique
-- et ne peuvent être réutilisées sans risque de régression. On crée donc des
-- TABLES SŒURS DÉDIÉES, clés directement sur professional_subject_sessions.
--
-- Migration IDEMPOTENTE et NON DESTRUCTIVE (aucune table existante modifiée).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Supports de cours d'une session professionnelle
CREATE TABLE IF NOT EXISTS professional_session_materials (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id  UUID NOT NULL REFERENCES professional_subject_sessions(id) ON DELETE CASCADE,
    titre       TEXT NOT NULL,
    url         TEXT,
    description TEXT,
    uploaded_by UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_session_materials
    ON professional_session_materials (tenant_id, session_id);

-- Présence par étudiant pour une session professionnelle
CREATE TABLE IF NOT EXISTS professional_session_attendance (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id  UUID NOT NULL REFERENCES professional_subject_sessions(id) ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    statut      TEXT NOT NULL DEFAULT 'present'
                  CHECK (statut IN ('present','absent','retard','excuse')),
    marked_by   UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, session_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_session_attendance
    ON professional_session_attendance (tenant_id, session_id);

-- Row-Level Security — patron identique à 0061.
ALTER TABLE professional_session_materials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_session_attendance ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY professional_session_materials_tenant_isolation ON professional_session_materials
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_session_attendance_tenant_isolation ON professional_session_attendance
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fin de la migration 0062_professional_pedagogy.sql
