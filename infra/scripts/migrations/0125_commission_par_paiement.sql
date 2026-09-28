-- 0125 — Une commission se règle PAIEMENT PAR PAIEMENT
--
-- Jusqu'ici un versement à un commercial portait un montant libre, imputé sur
-- son solde global. On ne pouvait donc pas dire QUELS encaissements avaient été
-- rémunérés : seulement combien avait été payé au total.
--
-- Désormais chaque paiement de scolarité d'un étudiant amené par un commercial
-- forme une LIGNE DE COMMISSION (montant du paiement × taux figé sur la fiche
-- de l'étudiant), qui est payée ou ne l'est pas. Le règlement pointe donc le
-- paiement qu'il rémunère.
--
-- Conséquences :
--   * commission acquise  = somme des lignes ;
--   * commission versée   = somme des lignes réglées ;
--   * reste à payer       = somme des lignes non réglées.
-- Les trois se déduisent des mêmes lignes : ils ne peuvent plus diverger.
--
-- Un seul règlement par paiement, garanti par l'index d'unicité. La suppression
-- du paiement de scolarité (remboursement, saisie erronée) emporte celle du
-- règlement de commission : la commission n'a plus d'assiette.
--
-- `payment_id` est rendu obligatoire uniquement si la table ne contient aucun
-- versement libre antérieur — sur une base qui en porterait, ils sont conservés
-- tels quels et comptés dans le total versé.
--
-- Idempotent.

BEGIN;

ALTER TABLE commissions_versements
    ADD COLUMN IF NOT EXISTS payment_id UUID
        REFERENCES professional_payments(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_par_paiement
    ON commissions_versements (tenant_id, payment_id)
    WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commissions_versements_payment
    ON commissions_versements (payment_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM commissions_versements WHERE payment_id IS NULL) THEN
        ALTER TABLE commissions_versements ALTER COLUMN payment_id SET NOT NULL;
    END IF;
END $$;

COMMIT;
