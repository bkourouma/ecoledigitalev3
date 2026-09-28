-- 0122 — Nature des commandes du module professionnel
--
-- Jusqu'ici une commande (`professional_orders`) ne pouvait représenter qu'une
-- chose : des UE. Les paiements étudiants ne couvraient donc que la scolarité
-- consommée, jamais l'inscription, les frais annexes ni les autres frais du
-- barème (`cycles_frais`, écran /admin/finances/scolarite).
--
-- On qualifie désormais chaque commande par sa `nature`, et on lui attache la
-- CLASSE concernée (`programme_id` — rappel : `programmes` porte la classe,
-- voir 0116). Le moteur de paiement, les reçus et l'historique restent
-- inchangés : ils travaillent sur des commandes, quelle que soit leur nature.
--
-- Natures :
--   ue          commandes historiques, une par inscription à une UE
--   scolarite   complément de scolarité, quand les UE suivies ne couvrent pas
--               le barème de la classe
--   inscription / annexes / autres   les trois autres lignes du barème
--
-- Les montants eux-mêmes ne sont PAS créés ici : voir
-- `infra/scripts/seed-professional-frais.sql`.
--
-- Idempotent.

BEGIN;

ALTER TABLE professional_orders
    ADD COLUMN IF NOT EXISTS nature TEXT NOT NULL DEFAULT 'ue';

DO $$ BEGIN
    ALTER TABLE professional_orders
        ADD CONSTRAINT professional_orders_nature_check
        CHECK (nature IN ('ue', 'scolarite', 'inscription', 'annexes', 'autres'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE professional_orders
    ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES programmes(id);

-- Les commandes d'UE existantes portent déjà leur classe, indirectement :
-- inscription → session d'UE → UE → `filiere_id` (qui pointe sur `programmes`).
UPDATE professional_orders o
SET programme_id = lot.programme_id
FROM (
    SELECT DISTINCT e.order_id, ue.filiere_id AS programme_id
    FROM professional_enrollments e
    JOIN professional_ue_sessions s ON s.id = e.ue_session_id AND s.tenant_id = e.tenant_id
    JOIN professional_ue ue         ON ue.id = s.ue_id        AND ue.tenant_id = s.tenant_id
) lot
WHERE lot.order_id = o.id
  AND o.programme_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_prof_orders_lot
    ON professional_orders (tenant_id, student_id, programme_id, nature);

-- Une seule commande de frais par étudiant, par classe et par nature. Les
-- commandes d'UE en sont exclues : il y en a une par inscription.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_order_frais
    ON professional_orders (tenant_id, student_id, programme_id, nature)
    WHERE nature <> 'ue';

COMMIT;
