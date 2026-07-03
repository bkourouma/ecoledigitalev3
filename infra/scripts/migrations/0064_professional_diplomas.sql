-- 0064_professional_diplomas.sql
-- Feature 029-professional-diplomas — Diplômes Professionnels.
--
-- Crée les 3 tables `professional_diploma*` / `student_professional_diplomas`
-- avec isolation multi-tenant (Row-Level Security), index et contraintes,
-- conformément à specs/029-professional-diplomas/data-model.md.
--
-- Extension ADDITIVE du Module Professionnel (feature 028) : aucune table
-- existante n'est modifiée. Cette migration est IDEMPOTENTE (CREATE ... IF NOT
-- EXISTS, policies en DO $$ ... EXCEPTION WHEN duplicate_object) et NON
-- DESTRUCTIVE (aucun DROP). Elle peut être rejouée sans risque et s'applique
-- sur une base contenant déjà les données 028.
--
-- Contexte tenant : GUC `app.tenant_id`, positionné sur chaque connexion par
-- ProfessionalBaseService.withTenant (set_config('app.tenant_id', ...)).
-- Note : `updated_at` est maintenu par la couche de service (pas de trigger).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================================================
-- 1. professional_diplomas — Diplôme
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_diplomas (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    programme_id UUID NOT NULL REFERENCES programmes(id),
    code         VARCHAR(50) NOT NULL,
    libelle      VARCHAR(255) NOT NULL,
    description  TEXT,
    uv_required  INTEGER NOT NULL CHECK (uv_required > 0),
    statut       VARCHAR(20) NOT NULL DEFAULT 'actif'
                   CHECK (statut IN ('actif','inactif')),
    created_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_professional_diplomas_tenant_programme
    ON professional_diplomas (tenant_id, programme_id);
CREATE INDEX IF NOT EXISTS idx_professional_diplomas_tenant_statut
    ON professional_diplomas (tenant_id, statut);

-- ===========================================================================
-- 2. professional_diploma_requirements — Exigence (matière comptabilisée)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_diploma_requirements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    diploma_id      UUID NOT NULL REFERENCES professional_diplomas(id) ON DELETE CASCADE,
    subject_id      UUID NOT NULL REFERENCES professional_subjects(id),
    est_obligatoire BOOLEAN NOT NULL DEFAULT false,
    ordre           INTEGER NOT NULL DEFAULT 0 CHECK (ordre >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (diploma_id, subject_id)
);
-- Validation applicative complémentaire (service professional-diplomas) :
-- subject_id doit appartenir au même programme que le diplôme.
CREATE INDEX IF NOT EXISTS idx_prof_diploma_req_diploma
    ON professional_diploma_requirements (tenant_id, diploma_id);
CREATE INDEX IF NOT EXISTS idx_prof_diploma_req_subject
    ON professional_diploma_requirements (tenant_id, subject_id);

-- ===========================================================================
-- 3. student_professional_diplomas — Diplôme octroyé à un étudiant
-- ===========================================================================
CREATE TABLE IF NOT EXISTS student_professional_diplomas (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    diploma_id            UUID NOT NULL REFERENCES professional_diplomas(id),
    student_id            UUID NOT NULL REFERENCES student_profiles(id),
    reference             VARCHAR(50) NOT NULL,
    statut                VARCHAR(20) NOT NULL
                            CHECK (statut IN ('en_cours','obtenu','revoque')),
    uv_total_validees     INTEGER NOT NULL DEFAULT 0,
    requirements_snapshot JSONB,
    date_obtention        TIMESTAMPTZ,
    date_revocation       TIMESTAMPTZ,
    motif_revocation      TEXT,
    octroye_par           UUID REFERENCES users(id),
    revoque_par           UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, reference)
);
-- Un seul octroi non révoqué par couple (diplôme, étudiant) ; un nouvel octroi
-- reste possible après révocation.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_student_prof_diploma_active
    ON student_professional_diplomas (diploma_id, student_id)
    WHERE statut <> 'revoque';
CREATE INDEX IF NOT EXISTS idx_student_prof_diploma_diploma
    ON student_professional_diplomas (tenant_id, diploma_id, statut);
CREATE INDEX IF NOT EXISTS idx_student_prof_diploma_student
    ON student_professional_diplomas (tenant_id, student_id, statut);

-- ===========================================================================
-- Row-Level Security — isolation multi-tenant
-- Patron repris de 0061_professional_module.sql (GUC app.tenant_id).
-- ===========================================================================
ALTER TABLE professional_diplomas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_diploma_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_professional_diplomas     ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY professional_diplomas_tenant_isolation ON professional_diplomas
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY professional_diploma_requirements_tenant_isolation ON professional_diploma_requirements
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY student_professional_diplomas_tenant_isolation ON student_professional_diplomas
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fin de la migration 0064_professional_diplomas.sql
