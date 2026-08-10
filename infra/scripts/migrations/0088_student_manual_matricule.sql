-- 0088_student_manual_matricule.sql
-- Matricule SAISI MANUELLEMENT sur la fiche étudiant (page /academic/students/new).
--
-- Contexte : `student_profiles` porte déjà deux matricules NUMÉRIQUES AUTOMATIQUES
-- qui sont réécrits en permanence par `enforceSequentialMatricules()`
-- (apps/api/src/routes/students.ts) à chaque listing des étudiants :
--     student_number          → 10001, 10002, … (séquence par tenant)
--     establishment_matricule → identique, maintenu synchronisé
-- Toute valeur saisie à la main dans ces deux colonnes serait donc écrasée.
--
-- Cette migration ajoute une colonne DISTINCTE, jamais touchée par la
-- reséquenciation, destinée au matricule propre à l'établissement que la
-- scolarité saisit elle-même (format libre : lettres, chiffres, tirets).
--
-- À ne pas confondre avec :
--     dsps_matricule / dsps_previous_matricule → matricules DSPS (tutelle)
--     professional_student_matricules (0086)   → matricule IPAM par filière,
--                                                automatique, module pro
--
-- Additif et idempotent (patron 0086/0087).

-- ===========================================================================
-- 1. Colonne du matricule saisi.
-- ===========================================================================
ALTER TABLE student_profiles
    ADD COLUMN IF NOT EXISTS student_matricule TEXT;

COMMENT ON COLUMN student_profiles.student_matricule IS
    'Matricule saisi manuellement par la scolarité (format libre). Distinct de '
    'student_number / establishment_matricule qui sont numériques et générés '
    'automatiquement par enforceSequentialMatricules().';

-- ===========================================================================
-- 2. Unicité par tenant, uniquement sur les valeurs renseignées.
--    Un index partiel laisse coexister les fiches antérieures (NULL) sans
--    bloquer la migration, tout en interdisant deux fois le même matricule.
-- ===========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profiles_student_matricule
    ON student_profiles (tenant_id, student_matricule)
    WHERE student_matricule IS NOT NULL;

-- Recherche « ILIKE %terme% » depuis la liste des étudiants.
CREATE INDEX IF NOT EXISTS idx_student_profiles_student_matricule_search
    ON student_profiles (tenant_id, lower(student_matricule));

-- Fin de la migration 0088_student_manual_matricule.sql
