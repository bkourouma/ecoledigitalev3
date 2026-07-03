-- ===========================================================================
-- 0070_session_ecue_teachers.sql
-- Feature 030 — Affectation des enseignants au niveau ECUE (et non plus UE).
--
-- Une UE regroupe plusieurs ECUE, pas forcement enseignes par le meme
-- enseignant. On affecte donc un enseignant a chaque ECUE d'une SESSION d'UE
-- (occurrence datee). L'enseignant ne peut creer/animer des seances que pour
-- les ECUE qui lui sont affectes dans cette session.
--
-- Multi-tenant : tenant_id NOT NULL + RLS (GUC app.tenant_id). Idempotent.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS professional_session_ecue_teachers (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ue_session_id UUID NOT NULL REFERENCES professional_ue_sessions(id) ON DELETE CASCADE,
    ecue_id       UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    enseignant_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Un seul enseignant par ECUE et par session.
    UNIQUE (tenant_id, ue_session_id, ecue_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_sess_ecue_teacher_session
    ON professional_session_ecue_teachers (tenant_id, ue_session_id);
CREATE INDEX IF NOT EXISTS idx_prof_sess_ecue_teacher_teacher
    ON professional_session_ecue_teachers (tenant_id, enseignant_id);

-- Row-Level Security (meme schema que les autres tables professional_*).
ALTER TABLE professional_session_ecue_teachers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY professional_session_ecue_teachers_tenant_isolation
        ON professional_session_ecue_teachers
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Backfill : pour chaque session ayant deja un enseignant (modele precedent),
-- on l'affecte a TOUS les ECUE de l'UE de la session afin de ne pas perdre les
-- affectations existantes (la demo continue de fonctionner).
-- ---------------------------------------------------------------------------
INSERT INTO professional_session_ecue_teachers (tenant_id, ue_session_id, ecue_id, enseignant_id)
SELECT s.tenant_id, s.id, l.ecue_id, s.enseignant_id
FROM professional_ue_sessions s
JOIN professional_ue_ecue l
  ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
WHERE s.enseignant_id IS NOT NULL
ON CONFLICT (tenant_id, ue_session_id, ecue_id) DO NOTHING;
