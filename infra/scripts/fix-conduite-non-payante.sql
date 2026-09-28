-- La conduite ne se paie pas : prix à zéro, et barème recalculé en conséquence.
--
-- À passer APRÈS la migration 0123, qui sort les commandes de conduite du
-- périmètre facturable.
--
-- Trois temps :
--   1. le prix des UE de conduite passe à 0 — plus aucune inscription future
--      ne facturera la conduite ;
--   2. `cycles_frais.scolarite` est recalculé depuis les UE restantes de chaque
--      semestre (la conduite ne pèse plus) ;
--   3. les commandes de complément de scolarité sont réajustées au nouveau
--      barème.
--
-- Ce qui n'est PAS touché : les paiements déjà enregistrés, y compris ceux
-- imputés à des commandes de conduite. Ils restent en base avec leurs reçus.
-- Les montants d'inscription et de frais annexes ne bougent pas non plus.
--
-- Idempotent : une deuxième exécution ne change rien.

BEGIN;

-- 1. La conduite est gratuite.
UPDATE professional_ue
SET prix = 0, updated_at = now()
WHERE libelle ILIKE 'conduite%' AND prix <> 0;

-- 2. Barème de scolarité par classe = somme des UE de ses semestres, conduite
--    désormais à 0 donc naturellement neutre.
UPDATE cycles_frais cf
SET scolarite = calc.montant, updated_at = now()
FROM (
    SELECT
        p.tenant_id,
        p.id AS programme_id,
        COALESCE(SUM(u.prix), 0) AS montant
    FROM programmes p
    LEFT JOIN professional_semestres sm
      ON sm.filiere_id = p.id AND sm.tenant_id = p.tenant_id
    LEFT JOIN professional_semestre_ue su
      ON su.semestre_id = sm.id AND su.tenant_id = sm.tenant_id
    LEFT JOIN professional_ue u
      ON u.id = su.ue_id AND u.tenant_id = su.tenant_id
    GROUP BY p.tenant_id, p.id
) calc
WHERE cf.tenant_id = calc.tenant_id
  AND cf.programme_id = calc.programme_id
  AND cf.scolarite <> calc.montant;

-- 3. Complément de scolarité = barème moins ce que couvrent les commandes d'UE
--    facturables du lot (la conduite, devenue `transversal`, en est exclue).
UPDATE professional_orders o
SET montant_total = calc.complement, updated_at = now()
FROM (
    SELECT
        lot.tenant_id,
        lot.student_id,
        lot.programme_id,
        GREATEST(cf.scolarite - lot.ue_couvert, 0) AS complement
    FROM (
        SELECT tenant_id, student_id, programme_id, SUM(montant_total) AS ue_couvert
        FROM professional_orders
        WHERE nature = 'ue' AND programme_id IS NOT NULL AND statut <> 'annulee'
        GROUP BY tenant_id, student_id, programme_id
    ) lot
    JOIN cycles_frais cf
      ON cf.tenant_id = lot.tenant_id AND cf.programme_id = lot.programme_id
) calc
WHERE o.nature = 'scolarite'
  AND o.tenant_id = calc.tenant_id
  AND o.student_id = calc.student_id
  AND o.programme_id = calc.programme_id
  AND o.montant_total <> calc.complement;

-- Un complément tombé à zéro n'a plus lieu d'être ; il n'a jamais porté de
-- paiement (les compléments sont créés après coup), on le retire.
DELETE FROM professional_orders o
WHERE o.nature = 'scolarite'
  AND o.montant_total = 0
  AND NOT EXISTS (SELECT 1 FROM professional_payments p WHERE p.order_id = o.id);

COMMIT;
