-- 0106_un_bulletin_par_periode.sql
-- Un enseignant n'a qu'UN bulletin par période, quel que soit son type de
-- rémunération (feature 031).
--
-- LE DÉFAUT
-- `unique_teacher_payment_per_period` portait sur
--     (tenant_id, teacher_id, payment_period_id, payment_type)
-- Le TYPE en faisant partie, la contrainte n'empêchait pas deux bulletins pour
-- le même enseignant sur la même période — elle l'autorisait explicitement dès
-- que les types différaient.
--
-- Or le type de rémunération n'est pas une catégorie de paiement : c'est une
-- propriété de la CONFIGURATION de l'enseignant à un instant donné. Quand cette
-- configuration passe de `hourly` à `salary` en cours de période, le calcul ne
-- retrouvait pas le bulletin existant (il le cherchait avec l'ancien type) et
-- en créait un second à côté. L'ancien restait, au même montant, sur la même
-- période.
--
-- Payer les deux, c'est payer l'enseignant deux fois. Constaté en base :
-- deux enseignants portaient chacun un bulletin `paid` et un `calculated` sur
-- la même période, pour des montants différents.
--
-- CE QUE CETTE MIGRATION FAIT
-- Elle resserre la contrainte sur (tenant_id, teacher_id, payment_period_id).
-- Le type devient une simple colonne du bulletin, que le recalcul met à jour
-- comme les montants.
--
-- PRÉREQUIS
-- Aucun doublon ne doit subsister. La migration s'arrête avec un message
-- actionnable sinon — supprimer un bulletin est une décision de gestion, pas un
-- effet de bord de migration :
--
--     node scripts/resoudre-doublons-bulletins.js            (aperçu)
--     node scripts/resoudre-doublons-bulletins.js --appliquer
--
-- CÔTÉ CODE
-- `routes/teacher-payments.ts` cherche désormais le bulletin existant SANS le
-- type, et met `payment_type` à jour. Sans ce changement, la contrainte ferait
-- échouer l'insertion au lieu de mettre à jour l'existant.
--
-- Idempotente. Rollback : revenir à la contrainte à quatre colonnes (et
-- réintroduire le défaut).

BEGIN;

DO $$
DECLARE doublons INT;
BEGIN
    SELECT count(*) INTO doublons FROM (
        SELECT 1 FROM teacher_payments
        GROUP BY tenant_id, teacher_id, payment_period_id
        HAVING count(*) > 1
    ) d;

    IF doublons > 0 THEN
        RAISE EXCEPTION
            '0106: % enseignant(s) ont plusieurs bulletins sur une même période. Lancer scripts/resoudre-doublons-bulletins.js avant de rejouer.', doublons;
    END IF;
END $$;

ALTER TABLE teacher_payments
    DROP CONSTRAINT IF EXISTS unique_teacher_payment_per_period;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_teacher_payment_per_period'
    ) THEN
        ALTER TABLE teacher_payments
            ADD CONSTRAINT unique_teacher_payment_per_period
            UNIQUE (tenant_id, teacher_id, payment_period_id);
    END IF;
END $$;

COMMENT ON CONSTRAINT unique_teacher_payment_per_period ON teacher_payments IS
    'Un seul bulletin par enseignant et par période. Le type de rémunération n''en fait PAS partie : il suit la configuration de l''enseignant et change avec elle, sans créer un second bulletin.';

COMMIT;
