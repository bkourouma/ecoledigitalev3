-- 0076_emploi_temps.sql
-- Emploi du temps HEBDOMADAIRE (Module Professionnel).
--
-- Contrairement au planning daté (professional_course_plannings, conservé), on
-- décrit ici, pour une ECUE programmée (= une session d'UE), SUR QUEL JOUR de la
-- semaine et à QUEL CRÉNEAU elle a lieu, pour toute la période de la session.
-- La grille est consultée par filière + semestre.
--
-- jour : 1 = Lundi … 7 = Dimanche.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS professional_emploi_temps (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ue_session_id UUID NOT NULL REFERENCES professional_ue_sessions(id) ON DELETE CASCADE,
    ecue_id       UUID NOT NULL REFERENCES professional_ecue(id) ON DELETE CASCADE,
    enseignant_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
    classroom_id  UUID REFERENCES classrooms(id) ON DELETE SET NULL,
    jour          SMALLINT NOT NULL CHECK (jour BETWEEN 1 AND 7),
    heure_debut   TIME NOT NULL,
    heure_fin     TIME NOT NULL,
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (heure_fin > heure_debut)
);
CREATE INDEX IF NOT EXISTS idx_prof_emploi_temps_session
    ON professional_emploi_temps (tenant_id, ue_session_id);
CREATE INDEX IF NOT EXISTS idx_prof_emploi_temps_ecue
    ON professional_emploi_temps (tenant_id, ecue_id);
CREATE INDEX IF NOT EXISTS idx_prof_emploi_temps_jour
    ON professional_emploi_temps (tenant_id, jour, heure_debut);

ALTER TABLE professional_emploi_temps ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY professional_emploi_temps_tenant_isolation ON professional_emploi_temps
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
