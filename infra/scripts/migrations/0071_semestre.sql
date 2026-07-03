-- ===========================================================================
-- 0071_semestre.sql
-- Module Professionnel — Semestre : regroupement de cohortes (sessions d'UE).
--
-- Un Semestre appartient a une FILIERE (table programmes). Il regroupe des
-- sessions d'UE (professional_ue_sessions) de cette filiere qui ne sont pas
-- encore terminees. Une meme session peut appartenir a plusieurs semestres
-- (table de liaison sans unicite sur la session, seulement par couple
-- semestre/session pour eviter les doublons au sein d'un meme semestre).
--
-- Multi-tenant : tenant_id NOT NULL + RLS (GUC app.tenant_id). Idempotent.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS professional_semestres (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filiere_id  UUID NOT NULL REFERENCES programmes(id),
    libelle     TEXT NOT NULL,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Pas deux semestres de meme libelle dans la meme filiere.
    UNIQUE (tenant_id, filiere_id, libelle)
);
CREATE INDEX IF NOT EXISTS idx_professional_semestres_tenant_filiere
    ON professional_semestres (tenant_id, filiere_id);

ALTER TABLE professional_semestres ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY professional_semestres_tenant_isolation ON professional_semestres
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Liaison Semestre <-> Session d'UE. Une session peut figurer dans plusieurs
-- semestres ; on empeche seulement le doublon (meme session deux fois dans le
-- meme semestre). La suppression d'un semestre ou d'une session retire la
-- liaison (ON DELETE CASCADE).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS professional_semestre_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    semestre_id   UUID NOT NULL REFERENCES professional_semestres(id) ON DELETE CASCADE,
    ue_session_id UUID NOT NULL REFERENCES professional_ue_sessions(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, semestre_id, ue_session_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_semestre_sessions_semestre
    ON professional_semestre_sessions (tenant_id, semestre_id);
CREATE INDEX IF NOT EXISTS idx_prof_semestre_sessions_session
    ON professional_semestre_sessions (tenant_id, ue_session_id);

ALTER TABLE professional_semestre_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY professional_semestre_sessions_tenant_isolation
        ON professional_semestre_sessions
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
