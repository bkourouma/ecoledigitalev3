-- =============================================================================
-- 0110 — Le journal d'audit conserve son auteur, même compte supprimé
-- Feature: 031-remuneration-professionnelle
-- =============================================================================
--
-- LE DÉFAUT
-- `payment_audit_log.changed_by` référençait `users(id)` sans clause
-- ON DELETE : le comportement par défaut est NO ACTION, donc RESTRICT à la
-- vérification. Supprimer un compte ayant touché ne serait-ce qu'un paiement
-- était impossible — le journal le retenait indéfiniment.
--
-- C'est le pendant exact du défaut corrigé en 0109 sur `payment_id` : une table
-- d'audit ne doit pas empêcher la vie de continuer autour d'elle.
--
-- POURQUOI SUPPRIMER LA CONTRAINTE PLUTÔT QUE CASCADER OU ANNULER
-- Les trois options n'ont pas le même coût :
--
--   CASCADE  — supprimerait les lignes d'audit avec le compte. Autrement dit,
--              effacer un utilisateur effacerait la trace de ce qu'il a fait :
--              exactement ce qu'un journal doit rendre impossible.
--   SET NULL — conserverait la ligne mais perdrait l'auteur. Un audit qui ne
--              dit plus QUI a agi ne vaut pas grand-chose, et la colonne est
--              NOT NULL, ce qu'il faudrait relâcher.
--   sans FK  — la ligne et l'identifiant survivent tous les deux. Le compte
--              n'existe plus, mais on sait toujours lequel a agi, et les
--              jointures d'affichage sont déjà en LEFT JOIN : elles se
--              contentent d'un auteur inconnu sans casser.
--
-- Le schéma ne tranche pas à notre place — il compte 36 NO ACTION, 27 CASCADE
-- et 11 SET NULL vers `users` — donc le choix se fait sur le rôle de la table,
-- pas sur un usage majoritaire.
--
-- NOTE
-- `changed_by` reste NOT NULL : le déclencheur l'alimente toujours depuis
-- `created_by` ou `approved_by`, tous deux renseignés.
-- =============================================================================

BEGIN;

ALTER TABLE payment_audit_log
    DROP CONSTRAINT IF EXISTS payment_audit_log_changed_by_fkey;

COMMENT ON COLUMN payment_audit_log.changed_by IS
    'Auteur de l''action. Volontairement SANS clé étrangère : le journal doit '
    'survivre à la suppression du compte, et conserver QUI a agi plutôt que de '
    'perdre l''information ou de disparaître avec lui. Les écrans résolvent le '
    'nom en LEFT JOIN et tolèrent donc un auteur inconnu.';

-- « Qu'a fait ce compte ? » devient une question sans index une fois la
-- contrainte retirée.
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_auteur
    ON payment_audit_log (changed_by, changed_at DESC);

COMMIT;
