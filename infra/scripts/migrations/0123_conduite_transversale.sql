-- 0123 — La conduite est une matière transversale, pas une ligne facturable
--
-- La conduite est notée et compte dans les moyennes et les bulletins, mais elle
-- ne se paie pas. Or elle vivait jusqu'ici comme une UE ordinaire : un prix, une
-- commande par inscription, et donc une présence dans tous les écrans de
-- paiement.
--
-- On lui donne une `nature` à part : `transversal`. Les lots de scolarité ne
-- connaissent que les quatre lignes du barème (inscription, scolarite, annexes,
-- autres) plus les commandes d'UE ; une commande `transversal` sort donc du
-- périmètre facturable — sans que rien ne soit supprimé.
--
-- Ce qui est PRÉSERVÉ : les commandes de conduite et leurs paiements restent en
-- base, avec leurs numéros de reçu. Ces écritures ne sont pas détruites, elles
-- sortent seulement du décompte des écrans de paiement.
--
-- Le prix des UE de conduite et le recalcul du barème sont traités à part, par
-- `infra/scripts/fix-conduite-non-payante.sql`.
--
-- Idempotent.

BEGIN;

-- La contrainte doit accepter la nouvelle nature avant qu'on l'utilise.
ALTER TABLE professional_orders
    DROP CONSTRAINT IF EXISTS professional_orders_nature_check;

ALTER TABLE professional_orders
    ADD CONSTRAINT professional_orders_nature_check
    CHECK (nature IN ('ue', 'scolarite', 'inscription', 'annexes', 'autres', 'transversal'));

-- `uniq_prof_order_frais` (migration 0122) impose une commande par lot et par
-- nature — vrai pour les quatre lignes du barème, faux pour la conduite : un
-- étudiant en suit une par semestre. On l'exclut de l'unicité, au même titre
-- que les commandes d'UE.
DROP INDEX IF EXISTS uniq_prof_order_frais;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_order_frais
    ON professional_orders (tenant_id, student_id, programme_id, nature)
    WHERE nature NOT IN ('ue', 'transversal');

-- Une commande d'UE dont l'UE est de la conduite devient transversale.
-- Le repère est le libellé, comme partout ailleurs dans le code.
UPDATE professional_orders o
SET nature = 'transversal', updated_at = now()
WHERE o.nature = 'ue'
  AND EXISTS (
      SELECT 1
      FROM professional_enrollments e
      JOIN professional_ue_sessions s ON s.id = e.ue_session_id AND s.tenant_id = e.tenant_id
      JOIN professional_ue ue         ON ue.id = s.ue_id        AND ue.tenant_id = s.tenant_id
      WHERE e.order_id = o.id
        AND e.tenant_id = o.tenant_id
        AND ue.libelle ILIKE 'conduite%'
  );

COMMIT;
