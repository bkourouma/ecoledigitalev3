-- 0128 — Rattacher une charge à une cohorte, et non seulement à une classe.
--
-- CE QUI EXISTAIT
--
-- `0098_expenses.sql` a créé `expenses` avec un `programme_id` nullable et la
-- règle qui va avec : une charge sans programme est une charge d'ÉTABLISSEMENT,
-- et elle n'est jamais répartie entre les filières. Cette règle ne change pas.
--
-- CE QUI MANQUAIT
--
-- `programme_id` désigne la classe, pas l'exercice : « MASTER 2 AUDIT » a pu
-- ouvrir cinq années de suite. Une charge de cohorte — un car de sortie, des
-- supports imprimés, la vacation d'un intervenant — ne pouvait donc pas être
-- imputée à la promotion qui l'a engagée. Elle pesait sur toutes.
--
-- POURQUOI PAS `ue_session_id`
--
-- Une `professional_ue_sessions` est l'ouverture d'UNE UE. Ce que les écrans
-- appellent « ouverture de classe » regroupe plusieurs sessions — quatre sur un
-- semestre de Master 2. Rattacher une charge à une session obligerait le
-- comptable à choisir une UE au hasard, ou à répartir entre quatre. Choisir au
-- hasard fabrique une marge par UE fausse et silencieuse ; répartir invente une
-- clé, ce que `0098` interdit explicitement. Le grain retenu est donc le
-- triplet (filière, nom de classe, année scolaire) — celui du filtre.

BEGIN;

-- Cible de la clé étrangère composite : permet de garantir, sans trigger, que
-- la cohorte nommée appartient bien à la classe portée par la charge.
DO $$ BEGIN
    ALTER TABLE professional_classe_noms
        ADD CONSTRAINT professional_classe_noms_id_classe_unique
        UNIQUE (tenant_id, id, classe_id);
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN duplicate_table  THEN NULL;
END $$;

ALTER TABLE expenses
    -- Cohorte visée. NULL = charge de filière ou d'établissement.
    ADD COLUMN IF NOT EXISTS classe_nom_id  UUID,
    -- Exercice d'imputation, « AAAA-AAAA+1 ».
    -- NULL = déduit de `incurred_on` par pivot septembre.
    ADD COLUMN IF NOT EXISTS annee_scolaire TEXT;

DO $$ BEGIN
    ALTER TABLE expenses
        ADD CONSTRAINT expenses_annee_format
        CHECK (annee_scolaire IS NULL OR annee_scolaire ~ '^[0-9]{4}-[0-9]{4}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- « Classe A » sans année désigne cinq cohortes : une charge de cohorte porte
-- toujours son exercice, et toujours sa classe.
DO $$ BEGIN
    ALTER TABLE expenses
        ADD CONSTRAINT expenses_classe_exige_annee_et_programme
        CHECK (classe_nom_id IS NULL
               OR (annee_scolaire IS NOT NULL AND programme_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- MATCH SIMPLE : la contrainte s'endort dès qu'une des colonnes est NULL, donc
-- elle n'a aucun effet sur les charges d'établissement. Quand les deux sont
-- renseignées, la cohorte DOIT appartenir à la classe déclarée.
DO $$ BEGIN
    ALTER TABLE expenses
        ADD CONSTRAINT expenses_classe_coherente
        FOREIGN KEY (tenant_id, classe_nom_id, programme_id)
        REFERENCES professional_classe_noms (tenant_id, id, classe_id)
        ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_classe
    ON expenses (tenant_id, classe_nom_id, annee_scolaire)
    WHERE classe_nom_id IS NOT NULL;

COMMENT ON COLUMN expenses.classe_nom_id IS
  'Cohorte visée (professional_classe_noms). NULL = charge de filiere ou d''etablissement.';
COMMENT ON COLUMN expenses.annee_scolaire IS
  'Exercice d''imputation. NULL = deduit de incurred_on par pivot septembre. Renseigne pour deroger : une charge engagee en aout pour la rentree de septembre.';

COMMIT;

-- Aucun backfill : la table est vide, aucune route n'y ecrivait jusqu'ici.
-- Controle attendu apres application :
--   SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_name = 'expenses'
--      AND column_name IN ('classe_nom_id', 'annee_scolaire');  -- 2
