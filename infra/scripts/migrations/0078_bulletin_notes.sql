-- 0078_bulletin_notes.sql
-- Module Professionnel (feature 030) — Notes, moyennes et bulletin.
--
-- 1. Enrichit professional_ecue_results avec la décomposition de la note ECUE
--    (moyenne des devoirs + note d'examen) et le verrou éliminatoire, pour
--    appliquer la formule officielle : NoteECUE = devoirs×0,4 + examen×0,6.
-- 2. Crée professional_ecue_notes : saisie MANUELLE directe de notes par ECUE
--    (devoirs et examen), indépendamment des évaluations. L'examen est unique
--    par (ECUE, étudiant, cohorte).
--
-- Additif et idempotent (ADD COLUMN / CREATE TABLE IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- 1. Décomposition de la note ECUE sur professional_ecue_results.
-- ---------------------------------------------------------------------------
ALTER TABLE professional_ecue_results
    ADD COLUMN IF NOT EXISTS moyenne_devoirs NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS note_examen     NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS eliminee        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS note_source     TEXT NOT NULL DEFAULT 'auto'
        CHECK (note_source IN ('auto','manuel','mixte','aucune'));

-- ---------------------------------------------------------------------------
-- 2. professional_ecue_notes — saisie manuelle de notes par ECUE.
--    nature = 'devoir' (plusieurs possibles) | 'examen' (un seul par cohorte).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS professional_ecue_notes (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ecue_id       UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    student_id    UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    ue_session_id UUID NOT NULL REFERENCES professional_ue_sessions(id) ON DELETE CASCADE,
    nature        TEXT NOT NULL CHECK (nature IN ('devoir','examen')),
    libelle       TEXT,
    note          NUMERIC(6,2) NOT NULL CHECK (note >= 0),
    note_max      NUMERIC(6,2) NOT NULL DEFAULT 20 CHECK (note_max > 0),
    saisi_par     UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_notes_lookup
    ON professional_ecue_notes (tenant_id, ecue_id, ue_session_id, student_id);
CREATE INDEX IF NOT EXISTS idx_prof_ecue_notes_student
    ON professional_ecue_notes (tenant_id, student_id);
-- Un seul examen manuel par (ECUE, étudiant, cohorte).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_ecue_notes_examen
    ON professional_ecue_notes (tenant_id, ecue_id, student_id, ue_session_id)
    WHERE nature = 'examen';

ALTER TABLE professional_ecue_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY professional_ecue_notes_tenant_isolation ON professional_ecue_notes
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fin de la migration 0078_bulletin_notes.sql
