-- 0065_professional_subject_materials.sql
-- Supports de cours rattachés à la MATIERE (pérennes d'une session à l'autre)
-- + tracking des consultations (lecture seule via le site, pas de download).
--
-- Extension ADDITIVE du Module Professionnel (feature 028) : la table existante
-- `professional_session_materials` n'est pas touchée. Migration IDEMPOTENTE
-- (CREATE ... IF NOT EXISTS) et NON DESTRUCTIVE (aucun DROP).
--
-- Contexte tenant : GUC `app.tenant_id`.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================================================
-- 1. professional_subject_materials — Support de cours d'une matière
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_subject_materials (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_subject_id  UUID NOT NULL REFERENCES professional_subjects(id) ON DELETE CASCADE,
    titre                    TEXT NOT NULL,
    description              TEXT,
    kind                     VARCHAR(20) NOT NULL DEFAULT 'autre'
                                CHECK (kind IN ('pdf','pptx','video','image','autre')),
    storage_path             TEXT NOT NULL,
    mime_type                TEXT,
    file_size                BIGINT,
    uploaded_by              UUID REFERENCES users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_subject_materials_subject
    ON professional_subject_materials (tenant_id, professional_subject_id);

-- ===========================================================================
-- 2. professional_subject_material_views — Trace de lecture
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_subject_material_views (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES professional_subject_materials(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opened_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_subject_material_views_material
    ON professional_subject_material_views (tenant_id, material_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_prof_subject_material_views_user
    ON professional_subject_material_views (tenant_id, user_id, opened_at DESC);

-- ===========================================================================
-- Row-Level Security — isolation multi-tenant
-- ===========================================================================
ALTER TABLE professional_subject_materials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_subject_material_views  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY professional_subject_materials_tenant_isolation ON professional_subject_materials
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_subject_material_views_tenant_isolation ON professional_subject_material_views
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fin de la migration 0065_professional_subject_materials.sql
