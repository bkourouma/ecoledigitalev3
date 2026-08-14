-- 0093_professional_matricule_format.sql
-- Format CANONIQUE du matricule professionnel IPAM : `IPAM-<CODE>-<NNNN>`
--   ex. filière « LICENCE 1 GENIE LOGICIEL (L1GL) », 9e séquence → IPAM-L1GL-9009
--
-- Contexte : deux conventions cohabitaient dans `professional_student_matricules`
--   - `IPAM-L1GL-9009`  → format d'origine, produit par scripts/seed-genie-logiciel-workflow.js
--   - `IPAML1DAF001`    → format sans tiret, produit par le backfill de 0086 et par
--                         `ensureProfessionalMatricule()` (professional-enrollment.service.ts)
-- Le format à tirets est retenu comme unique modèle. Cette migration normalise
-- les lignes existantes ; la génération applicative est alignée en parallèle
-- (`formatProfessionalMatricule()` dans professional-enrollment.service.ts).
--
-- ATTENTION : les matricules déjà imprimés sur des bulletins/attestations émis
-- avant cette migration porteront l'ancien format. La normalisation ne réécrit
-- que la base ; les PDF déjà générés ne sont pas repris.
--
-- Additif et idempotent : recalculer deux fois donne le même résultat, et une
-- ligne déjà au bon format n'est pas touchée (clause WHERE ... IS DISTINCT FROM).

-- ===========================================================================
-- 1. Normalisation des matricules existants.
--    Le matricule est RECALCULÉ à partir du code de la filière et de `seq`
--    (colonnes qui font foi), pas parsé depuis l'ancienne chaîne : les deux
--    anciens formats convergent donc vers la même valeur canonique.
-- ===========================================================================
WITH canonical AS (
    SELECT psm.id,
           'IPAM-'
             || COALESCE(NULLIF(upper(regexp_replace(p.code, '[^A-Za-z0-9]', '', 'g')), ''), 'XXX')
             || '-'
             || lpad(psm.seq::text, 4, '0') AS matricule
    FROM professional_student_matricules psm
    JOIN programmes p ON p.id = psm.filiere_id
)
UPDATE professional_student_matricules psm
SET matricule = canonical.matricule
FROM canonical
WHERE psm.id = canonical.id
  AND psm.matricule IS DISTINCT FROM canonical.matricule;

-- ===========================================================================
-- 2. Documentation de la colonne.
-- ===========================================================================
COMMENT ON COLUMN professional_student_matricules.matricule IS
    'Matricule professionnel IPAM au format canonique IPAM-<CODE FILIERE>-<NNNN> '
    '(ex. IPAM-L1GL-9009). Genere par formatProfessionalMatricule() '
    '(apps/api/src/services/professional-enrollment.service.ts). La sequence est '
    'propre a la filiere (colonne seq).';

-- Fin de la migration 0093_professional_matricule_format.sql
