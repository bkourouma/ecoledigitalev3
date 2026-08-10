-- 0086_professional_student_matricule.sql
-- Matricule PROFESSIONNEL par (étudiant, filière) : IPAM + code filière + NNN.
--   Ex. filière « LICENCE 1 DROIT DES AFFAIRES ET FISCALITE (L1DAF) »,
--       1er inscrit → IPAML1DAF001, 2e → IPAML1DAF002, …
--
-- Ce matricule est distinct du `student_profiles.student_number` (numéro
-- d'établissement générique, numérique) : il est propre au module professionnel
-- et sert d'identité de l'étudiant sur ses BULLETINS de la filière.
-- Il est attribué automatiquement à la 1ère inscription dans la filière
-- (service professional-enrollment) puis affiché en priorité sur les bulletins.
--
-- Additif et idempotent (patron RLS 0061/0069).

-- ===========================================================================
-- 1. Table de correspondance (étudiant, filière) → matricule professionnel.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS professional_student_matricules (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    filiere_id UUID NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL CHECK (seq > 0),
    matricule  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Un seul matricule par étudiant et par filière.
    UNIQUE (tenant_id, student_id, filiere_id),
    -- Séquence stricte par filière (garantit l'unicité des numéros).
    UNIQUE (tenant_id, filiere_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_prof_student_matricule_filiere
    ON professional_student_matricules (tenant_id, filiere_id, seq);
CREATE INDEX IF NOT EXISTS idx_prof_student_matricule_student
    ON professional_student_matricules (tenant_id, student_id);

-- ===========================================================================
-- 2. Row-Level Security — isolation multi-tenant (patron 0061/0069).
-- ===========================================================================
ALTER TABLE professional_student_matricules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY professional_student_matricules_tenant_isolation
        ON professional_student_matricules
        FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 3. Backfill — attribue un matricule à chaque (étudiant, filière) déjà inscrit
--    (inscriptions non annulées), numéroté par ordre de 1ère inscription.
--    Idempotent : ON CONFLICT DO NOTHING (ne réécrit pas les existants).
-- ===========================================================================
INSERT INTO professional_student_matricules (tenant_id, student_id, filiere_id, seq, matricule)
SELECT tenant_id, student_id, filiere_id, seq,
       'IPAM' || code_clean || lpad(seq::text, 3, '0')
FROM (
    SELECT tenant_id, student_id, filiere_id, code_clean,
           row_number() OVER (
               PARTITION BY tenant_id, filiere_id
               ORDER BY first_enrolled, student_id
           ) AS seq
    FROM (
        SELECT en.tenant_id,
               en.student_id,
               ue.filiere_id,
               COALESCE(NULLIF(upper(regexp_replace(p.code, '[^A-Za-z0-9]', '', 'g')), ''), 'XXX') AS code_clean,
               min(en.created_at) AS first_enrolled
        FROM professional_enrollments en
        JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
        JOIN professional_ue ue         ON ue.id = s.ue_id        AND ue.tenant_id = s.tenant_id
        JOIN programmes p               ON p.id = ue.filiere_id
        WHERE en.statut <> 'annulee'
        GROUP BY en.tenant_id, en.student_id, ue.filiere_id, p.code
    ) agg
) numbered
ON CONFLICT (tenant_id, student_id, filiere_id) DO NOTHING;

-- Fin de la migration 0086_professional_student_matricule.sql
