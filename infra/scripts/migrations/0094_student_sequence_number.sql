-- 0094_student_sequence_number.sql
-- Numéro d'ordre FIGÉ de l'étudiant, attribué à la création : 1, 2, 3, … par
-- tenant, affiché sur 4 chiffres (0001, 0002, …). Il devient la base du
-- matricule professionnel IPAM :
--
--     IPAM - <code filière> - <numéro de l'étudiant sur 4 chiffres>
--     ex. étudiant n°1 inscrit en L1GL  →  IPAM-L1GL-0001
--         le même étudiant en M1TL      →  IPAM-M1TL-0001
--
-- Pourquoi une NOUVELLE colonne plutôt que `establishment_matricule` :
-- `enforceSequentialMatricules()` (apps/api/src/routes/students.ts) réécrit
-- `student_number` ET `establishment_matricule` de TOUT le tenant à chaque appel
-- de GET /api/v1/students, renumérotés par `created_at`. Une suppression décale
-- donc tous les suivants. Un matricule IPAM imprimé sur un bulletin cesserait de
-- désigner le bon étudiant. `sequence_number` n'est JAMAIS recalculé.
--
-- Additif et idempotent (patron 0086/0088/0093).

-- ===========================================================================
-- 1. Colonne du numéro d'ordre.
-- ===========================================================================
ALTER TABLE student_profiles
    ADD COLUMN IF NOT EXISTS sequence_number INTEGER;

COMMENT ON COLUMN student_profiles.sequence_number IS
    'Numero d''ordre de l''etudiant dans le tenant, attribue A LA CREATION et '
    'jamais recalcule (contrairement a student_number / establishment_matricule). '
    'Affiche sur 4 chiffres et utilise comme segment final du matricule IPAM '
    '(IPAM-<CODE FILIERE>-<NNNN>). Assigne automatiquement par le trigger '
    'trg_student_profiles_sequence_number.';

-- ===========================================================================
-- 2. Backfill des fiches existantes, par ordre de création.
--    Ne touche que les lignes encore NULL : un second passage ne renumérote pas.
-- ===========================================================================
WITH numbered AS (
    SELECT id,
           row_number() OVER (PARTITION BY tenant_id ORDER BY created_at ASC, id ASC)
             + COALESCE(
                 (SELECT max(s2.sequence_number)
                  FROM student_profiles s2
                  WHERE s2.tenant_id = student_profiles.tenant_id), 0
               ) AS n
    FROM student_profiles
    WHERE sequence_number IS NULL
)
UPDATE student_profiles sp
SET sequence_number = numbered.n
FROM numbered
WHERE sp.id = numbered.id;

-- ===========================================================================
-- 3. Unicité par tenant.
-- ===========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profiles_sequence_number
    ON student_profiles (tenant_id, sequence_number)
    WHERE sequence_number IS NOT NULL;

-- ===========================================================================
-- 4. Attribution automatique à l'INSERT.
--    Le trigger couvre TOUS les chemins de création (les deux endpoints
--    POST /api/v1/students, l'approbation d'une demande d'inscription, les
--    scripts de seed) : impossible d'oublier l'attribution en ajoutant un
--    nouveau point d'entrée.
--
--    SECURITY DEFINER : le calcul du MAX doit voir toutes les fiches du tenant
--    même si `app.tenant_id` n'est pas positionné sur la session (RLS 0003).
--    Le filtre `tenant_id = NEW.tenant_id` garde le cloisonnement.
--
--    Le verrou consultatif sérialise les créations concurrentes d'un même
--    tenant, sans bloquer les autres tenants.
-- ===========================================================================
CREATE OR REPLACE FUNCTION assign_student_sequence_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.sequence_number IS NULL THEN
        PERFORM pg_advisory_xact_lock(
            hashtext('student_profiles.sequence_number'),
            hashtext(NEW.tenant_id::text)
        );
        SELECT COALESCE(MAX(sp.sequence_number), 0) + 1
          INTO NEW.sequence_number
          FROM student_profiles sp
         WHERE sp.tenant_id = NEW.tenant_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_profiles_sequence_number ON student_profiles;
CREATE TRIGGER trg_student_profiles_sequence_number
    BEFORE INSERT ON student_profiles
    FOR EACH ROW
    EXECUTE FUNCTION assign_student_sequence_number();

-- ===========================================================================
-- 5. Réalignement des matricules IPAM existants sur le nouveau principe.
--    `seq` ne porte plus un rang par filière mais le numéro de l'étudiant.
--
--    En deux temps : la contrainte UNIQUE (tenant_id, filiere_id, seq) n'est pas
--    différable, donc une renumérotation en une seule passe peut se heurter à
--    une collision transitoire. On gare d'abord les valeurs dans un espace libre
--    (+1000000, qui reste positif pour la contrainte CHECK (seq > 0)).
-- ===========================================================================
UPDATE professional_student_matricules
SET seq = seq + 1000000
WHERE seq < 1000000;

UPDATE professional_student_matricules psm
SET seq = sp.sequence_number,
    matricule = 'IPAM-'
      || COALESCE(NULLIF(upper(regexp_replace(p.code, '[^A-Za-z0-9]', '', 'g')), ''), 'XXX')
      || '-' || lpad(sp.sequence_number::text, 4, '0')
FROM student_profiles sp, programmes p
WHERE sp.id = psm.student_id
  AND p.id = psm.filiere_id
  AND sp.sequence_number IS NOT NULL;

COMMENT ON COLUMN professional_student_matricules.seq IS
    'Numero d''ordre de l''etudiant dans le tenant (student_profiles.sequence_number), '
    'repris tel quel comme segment final du matricule. Ce n''est plus un rang par '
    'filiere depuis la migration 0094.';

COMMENT ON COLUMN professional_student_matricules.matricule IS
    'Matricule professionnel IPAM au format IPAM-<CODE FILIERE>-<NNNN> '
    '(ex. IPAM-L1GL-0001), ou NNNN est le numero d''ordre de l''etudiant. Genere '
    'par formatProfessionalMatricule() (apps/api/src/services/professional-enrollment.service.ts).';

-- Fin de la migration 0094_student_sequence_number.sql
