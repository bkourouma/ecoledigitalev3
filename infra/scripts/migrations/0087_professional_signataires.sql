-- 0087_professional_signataires.sql
-- Signataires configurables des documents officiels du module professionnel.
--
-- Les noms/qualités/fonctions imprimés sur l'attestation de réussite, le
-- diplôme (2 signataires) et l'attestation d'authenticité étaient codés en dur
-- côté front (`apps/web/src/lib/diplome-format.ts`). Cette table les rend
-- modifiables depuis l'administration, avec UN SEUL enregistrement par « titre »
-- (contrainte d'unicité sur (tenant_id, cle)).
--
-- Clés (« titres ») gérées :
--   attestation_reussite → « Je soussigné, <nom>, <qualite>, <fonction> … »
--   diplome_gauche       → signataire gauche du diplôme
--   diplome_droite       → signataire droit du diplôme
--   authenticite         → « Je soussigné(e), <nom> » + bloc « Le Responsable »
--
-- Additif et idempotent (patron RLS 0061/0069/0086).

-- ===========================================================================
-- 1. Table des signataires.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_signataires (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cle        TEXT NOT NULL CHECK (cle IN (
                   'attestation_reussite', 'diplome_gauche',
                   'diplome_droite', 'authenticite')),
    nom        TEXT NOT NULL,
    -- Qualité (ex. « Enseignant Chercheur »), facultative.
    qualite    TEXT,
    -- Fonction / titre, peut tenir sur plusieurs lignes (séparateur « \n »).
    fonction   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Un seul nom enregistré par titre et par établissement.
    UNIQUE (tenant_id, cle)
);
CREATE INDEX IF NOT EXISTS idx_prof_signataires_tenant
    ON professional_signataires (tenant_id, cle);

-- ===========================================================================
-- 2. Row-Level Security — isolation multi-tenant (patron 0061/0069).
-- ===========================================================================
ALTER TABLE professional_signataires ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY professional_signataires_tenant_isolation
        ON professional_signataires
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 3. Valeurs par défaut — reprise exacte des libellés codés en dur, pour que
--    les documents restent identiques tant que rien n'est modifié.
--    Idempotent : ON CONFLICT DO NOTHING (ne réécrit pas une valeur saisie).
-- ===========================================================================
INSERT INTO professional_signataires (tenant_id, cle, nom, qualite, fonction)
SELECT t.id, d.cle, d.nom, d.qualite, d.fonction
FROM tenants t
CROSS JOIN (VALUES
    ('attestation_reussite',
     'Celeste BAH',
     'Enseignant Chercheur',
     'Directeur des Etudes'),
    ('diplome_gauche',
     'PROFESSEUR PENE BI GUIME CREPIN',
     NULL,
     E'Directeur du Comité Scientifique\nDirecteur de Recherche'),
    ('diplome_droite',
     'CELESTE BAH, Enseignant - chercheur',
     NULL,
     E'Membre du Comité Scientifique\nDirecteur Général Adjoint'),
    ('authenticite',
     'BAH CELESTE',
     NULL,
     'Directeur Général Adjoint')
) AS d(cle, nom, qualite, fonction)
ON CONFLICT (tenant_id, cle) DO NOTHING;

-- Fin de la migration 0087_professional_signataires.sql
