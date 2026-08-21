-- ===========================================================================
-- 0115 — Clôture des bulletins d'un semestre
-- ===========================================================================
--
-- CE QUI MANQUAIT
-- La page « Bulletins & moyennes » listait tous les semestres de la filière,
-- indéfiniment. Une fois les bulletins générés et vérifiés, rien ne permettait
-- de sortir le semestre de l'écran de travail : il restait mélangé aux
-- semestres en cours, avec ses boutons « Recalculer » et « Générer » actifs.
--
-- L'historique des bulletins, lui, DÉRIVE le statut d'un semestre
-- (`getBulletinHistory`) : « terminé » si tous les bulletins générés sont
-- définitifs, ou s'il ne reste aucune cohorte active. Cette dérivation décrit
-- l'avancement pédagogique, pas une décision d'archivage — un seul étudiant
-- ajourné (bulletin provisoire) suffit à faire repasser le semestre « en
-- cours ». Elle ne pouvait donc pas servir de clôture.
--
-- CE QUE FAIT CETTE MIGRATION
-- Ajoute la décision explicite : QUAND et PAR QUI les bulletins ont été
-- clôturés. Un semestre clôturé quitte la page de travail pour l'historique,
-- où il est en lecture seule.
--
-- À NE PAS CONFONDRE avec la clôture des NOTES
-- (`cloturerSemestre` / POST /semestres/:id/cloturer), qui passe les cohortes
-- d'UE en « terminé » et fait basculer le semestre de la saisie des notes vers
-- l'historique des notes. Les deux gestes sont indépendants et dans cet ordre :
-- on clôture les notes, on génère les bulletins, puis on clôture les bulletins.
--
-- POUR REVENIR EN ARRIÈRE (rouvrir un semestre)
--   UPDATE professional_semestres
--      SET bulletins_clotures_at = NULL, bulletins_clotures_par = NULL
--    WHERE id = '<semestre_id>';
--
-- Additif et idempotent (patron 0086/0088/0114).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Date de clôture — c'est elle qui porte l'état.
--
-- NULL = bulletins ouverts (le semestre reste sur la page de travail).
-- Renseignée = clôturés (le semestre n'apparaît plus que dans l'historique).
-- ---------------------------------------------------------------------------
ALTER TABLE professional_semestres
    ADD COLUMN IF NOT EXISTS bulletins_clotures_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN professional_semestres.bulletins_clotures_at IS
    'Date de clôture des bulletins du semestre. NULL = ouverts. Distincte de la clôture des NOTES, qui passe les cohortes d''UE en « terminé ».';

-- ---------------------------------------------------------------------------
-- 2. Auteur de la clôture
--
-- Sans clé étrangère, comme `paid_by` (0114) et `changed_by` du journal
-- d'audit : la trace doit survivre à la suppression du compte.
-- ---------------------------------------------------------------------------
ALTER TABLE professional_semestres
    ADD COLUMN IF NOT EXISTS bulletins_clotures_par UUID NULL;

COMMENT ON COLUMN professional_semestres.bulletins_clotures_par IS
    'Utilisateur ayant clôturé les bulletins. Sans clé étrangère : la trace doit survivre à la suppression du compte.';

-- ---------------------------------------------------------------------------
-- 3. Index de la liste de travail
--
-- La page « Bulletins » ne demande que les semestres ouverts d'une filière ;
-- l'index partiel ne porte donc que ceux-là.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_prof_semestres_bulletins_ouverts
    ON professional_semestres (tenant_id, filiere_id)
    WHERE bulletins_clotures_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Aucune requalification de l'existant
--
-- Les semestres déjà traités ne sont PAS clôturés d'office : on ne peut pas
-- deviner après coup lesquels ont été vérifiés. Ils restent sur la page de
-- travail jusqu'à ce que la scolarité les clôture elle-même — un geste qui
-- reste à faire est préférable à un archivage inventé.
-- ---------------------------------------------------------------------------
