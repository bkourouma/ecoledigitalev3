-- ===========================================================================
-- 0114 — Le versement devient un acte distinct de l'archivage
-- ===========================================================================
--
-- CE QUI N'ALLAIT PAS
-- `archiverBulletins` posait `status = 'paid'` au moment du classement. Or
-- classer un bulletin n'est pas verser de l'argent. Résultat constaté avant
-- cette migration :
--
--     203 bulletins | 138 avec paid_at | 173 archivés | 173 au statut « payé »
--
-- 35 bulletins déclarés payés sans qu'aucun décaissement n'ait jamais été
-- enregistré. La colonne `paid_at` existait pourtant, alimentée correctement
-- par PATCH /api/v1/payment-reports/:id/status — le parcours de rémunération la
-- contournait.
--
-- LE CYCLE RETENU
--   générer  -> calculated             (calculated_at)
--   archiver -> approved  « Impayé »   (archived_at, archived_by, approved_at)
--   verser   -> paid      « Payé »     (paid_at, paid_by)
--
-- `approved` appartient déjà à LOCKING_STATUSES
-- (professional-seance-validation.service.ts) : les séances restent donc
-- verrouillées après archivage, exactement comme avec `paid` auparavant.
--
-- POUR REVENIR EN ARRIÈRE
--   UPDATE teacher_payments SET status = 'paid' WHERE status = 'approved'
--     AND archived_at IS NOT NULL;
--   ALTER TABLE teacher_payments DROP COLUMN IF EXISTS paid_by;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Qui a constaté le versement
--
-- `archived_by` et `approved_by` existaient, pas `paid_by`. Le journal d'audit
-- attribuait donc la ligne de versement à l'approbateur — celui qui a arrêté le
-- montant, pas celui qui a sorti l'argent.
-- ---------------------------------------------------------------------------
ALTER TABLE teacher_payments
    ADD COLUMN IF NOT EXISTS paid_by uuid NULL;

COMMENT ON COLUMN teacher_payments.paid_by IS
    'Utilisateur ayant constaté le versement. Sans clé étrangère, comme changed_by du journal d''audit : la trace doit survivre à la suppression du compte.';

-- ---------------------------------------------------------------------------
-- 2. Requalification de l'existant
--
-- Un versement qui n'a jamais été saisi ne peut pas être reconstitué après
-- coup. Les bulletins « payés » sans date repassent donc à « arrêté, à
-- verser » : mieux vaut une dette visible qu'un paiement fictif.
-- ---------------------------------------------------------------------------
UPDATE teacher_payments
   SET status      = 'approved',
       approved_at = COALESCE(approved_at, archived_at, updated_at),
       approved_by = COALESCE(approved_by, archived_by),
       updated_at  = now()
 WHERE status = 'paid'
   AND paid_at IS NULL;

-- Les bulletins réellement versés (paid_at renseigné) ne bougent pas, mais
-- gagnent leur approbation manquante : ils sont passés par l'archivage.
UPDATE teacher_payments
   SET approved_at = COALESCE(approved_at, archived_at),
       approved_by = COALESCE(approved_by, archived_by),
       updated_at  = now()
 WHERE status = 'paid'
   AND paid_at IS NOT NULL
   AND approved_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Bulletins à zéro : ils n'ont plus lieu d'être
--
-- Un bulletin est un document de paiement ; sans montant, il n'y a rien à
-- documenter. Le calculateur écarte de nouveau les enseignants sans heure
-- validée (motif NO_HOURS), si bien qu'aucun bulletin à zéro ne sera plus
-- produit. Ceux qui subsistent viennent de la parenthèse où ce garde-fou avait
-- été levé.
--
-- Suppression restreinte aux bulletins NON archivés et SANS ligne de détail :
-- on ne touche à rien qui ait déjà été classé ou qui porte des heures.
-- ---------------------------------------------------------------------------
DELETE FROM teacher_payments tp
 WHERE tp.total_amount <= 0
   AND tp.archived_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM payment_hour_details d WHERE d.payment_id = tp.id);

-- ---------------------------------------------------------------------------
-- 4. `unpaid` est abandonné
--
-- Introduite par la 0113, cette valeur désignait « bulletin sans rien à
-- verser » — soit l'inverse de ce que le mot signifie en comptabilité. Le cas
-- qu'elle couvrait n'existe plus (aucun bulletin à zéro n'est émis), et
-- « impayé » est désormais l'affichage de `approved`.
--
-- La valeur reste dans l'enum : PostgreSQL ne sait pas retirer une valeur sans
-- recréer le type. Plus aucun code ne l'écrit.
-- ---------------------------------------------------------------------------
UPDATE teacher_payments
   SET status = 'approved', updated_at = now()
 WHERE status = 'unpaid';
