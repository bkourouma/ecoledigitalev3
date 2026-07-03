-- 0075_semestre_ue.sql
-- Lien direct Semestre ↔ UE (Module Professionnel).
--
-- Évolution du modèle : un semestre est désormais composé d'UE sélectionnées
-- d'une filière (on crée les semestres AVANT les sessions). La table de liaison
-- semestre↔session (professional_semestre_sessions) est conservée pour la
-- rétro-compatibilité mais n'est plus utilisée par le flux de création.
--
-- Convention : id UUID PK, tenant_id NOT NULL → tenants(id) + RLS (GUC
-- app.tenant_id). Voir specs/030-pedagogie-ue-ecue/data-model.md.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS professional_semestre_ue (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    semestre_id UUID NOT NULL REFERENCES professional_semestres(id) ON DELETE CASCADE,
    ue_id       UUID NOT NULL REFERENCES professional_ue(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, semestre_id, ue_id)
);
CREATE INDEX IF NOT EXISTS idx_prof_semestre_ue_semestre
    ON professional_semestre_ue (tenant_id, semestre_id);
CREATE INDEX IF NOT EXISTS idx_prof_semestre_ue_ue
    ON professional_semestre_ue (tenant_id, ue_id);

ALTER TABLE professional_semestre_ue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY professional_semestre_ue_tenant_isolation ON professional_semestre_ue
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
