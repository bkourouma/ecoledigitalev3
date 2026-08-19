-- =============================================================================
-- 0109 — Le journal d'audit des paiements doit survivre à la suppression
-- Feature: 031-remuneration-professionnelle
-- =============================================================================
--
-- LE DÉFAUT
-- `payment_audit_log.payment_id` référençait `teacher_payments(id)` en
-- ON DELETE CASCADE, alors que le déclencheur `audit_teacher_payments()`
-- enregistre justement une action 'deleted'. Deux conséquences, l'une visible,
-- l'autre non :
--
--   1. SUPPRIMER UN PAIEMENT ÉTAIT IMPOSSIBLE. Le déclencheur insère la ligne
--      d'audit pendant la suppression ; la contrainte est vérifiée après, la
--      ligne référencée n'existe plus, et PostgreSQL rejette :
--        « la clé (payment_id)=(...) n'est pas présente dans teacher_payments »
--      Toute tentative échouait, y compris la suppression d'une période portant
--      des bulletins.
--
--   2. LA TRACE N'AURAIT DE TOUTE FAÇON PAS SURVÉCU. À supposer que
--      l'insertion passe, le CASCADE aurait effacé cette même ligne dans la
--      foulée. L'action 'deleted' était donc inatteignable par construction :
--      la branche DELETE du déclencheur n'a jamais rien pu écrire.
--
-- LA CORRECTION
-- Un journal d'audit doit SURVIVRE à ce qu'il audite — sinon il ne documente
-- que ce qui existe encore, ce qui est l'inverse de son rôle. `payment_id`
-- reste la référence fonctionnelle du paiement, mais cesse d'être une clé
-- étrangère : la ligne d'audit devient autonome.
--
-- Les valeurs supprimées restent lisibles dans `old_values` (to_jsonb(OLD)),
-- donc rien n'est perdu quand le paiement disparaît.
--
-- CE QUE CETTE MIGRATION NE CHANGE PAS
-- Le déclencheur lui-même est correct et n'est pas modifié. Le défaut était
-- dans la contrainte, pas dans la logique d'audit.
-- =============================================================================

BEGIN;

ALTER TABLE payment_audit_log
    DROP CONSTRAINT IF EXISTS payment_audit_log_payment_id_fkey;

COMMENT ON COLUMN payment_audit_log.payment_id IS
    'Paiement concerné. Volontairement SANS clé étrangère : le journal doit '
    'survivre à la suppression du paiement, sinon l''action ''deleted'' ne peut '
    'être ni écrite ni conservée. Les valeurs d''alors restent dans old_values.';

-- La contrainte disparue n'indexait rien côté référençant, mais la recherche
-- « historique de ce paiement » est le seul accès réel à cette table.
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_payment
    ON payment_audit_log (payment_id, changed_at DESC);

COMMIT;
