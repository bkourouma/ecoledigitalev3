-- ===========================================================================
-- 0072_course_planning.sql
-- Module Professionnel — Planning des cours.
--
-- Un planning rattache un ECUE d'une SESSION d'UE OUVERTE à un créneau
-- (date_debut → date_fin). Saisi par un administrateur ou un enseignant
-- (l'enseignant ne planifie que les ECUE qui lui sont affectés dans la session).
-- Visualisé sous forme de calendrier.
--
-- Multi-tenant : tenant_id NOT NULL + RLS (GUC app.tenant_id). Idempotent.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS professional_course_plannings (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ue_session_id UUID NOT NULL REFERENCES professional_ue_sessions(id) ON DELETE CASCADE,
    ecue_id       UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    -- Enseignant déduit de l'affectation ECUE de la session (peut être null).
    enseignant_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
    titre         TEXT,
    date_debut    TIMESTAMPTZ NOT NULL,
    date_fin      TIMESTAMPTZ NOT NULL,
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (date_fin >= date_debut)
);

CREATE INDEX IF NOT EXISTS idx_prof_course_planning_session
    ON professional_course_plannings (tenant_id, ue_session_id);
CREATE INDEX IF NOT EXISTS idx_prof_course_planning_ecue
    ON professional_course_plannings (tenant_id, ecue_id);
CREATE INDEX IF NOT EXISTS idx_prof_course_planning_enseignant
    ON professional_course_plannings (tenant_id, enseignant_id);
CREATE INDEX IF NOT EXISTS idx_prof_course_planning_dates
    ON professional_course_plannings (tenant_id, date_debut, date_fin);

ALTER TABLE professional_course_plannings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY professional_course_plannings_tenant_isolation
        ON professional_course_plannings
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
