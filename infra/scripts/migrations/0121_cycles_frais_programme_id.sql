-- 0121 — Rattrapage : `cycles_frais.programme_id`
--
-- La colonne existe en base et l'API s'en sert (barème de scolarité par
-- CLASSE, `/api/v1/cycle-fees`), mais aucune migration ne la crée :
-- `0014_cycle_fees.sql` déclare encore un barème par cycle seul, avec
-- `UNIQUE (tenant_id, cycle_id)`. Une base reconstruite depuis les migrations
-- casse donc la page Scolarité et l'inscription des étudiants.
--
-- Rappel de vocabulaire (voir 0116) : la table `programmes` porte la CLASSE
-- (« MASTER 2 AUDIT ET CONTROLE DE GESTION »), la filière vit dans `filieres`.
-- Le barème est bien défini par classe, pas par filière.
--
-- Idempotent : sur une base déjà à jour, rien ne bouge.

BEGIN;

ALTER TABLE cycles_frais
    ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES programmes(id) ON DELETE CASCADE;

-- L'unicité par (tenant, cycle) tombe d'abord : sans cela la déclinaison
-- ci-dessous, qui crée plusieurs lignes sur un même cycle, se heurterait à
-- l'ancienne contrainte.
ALTER TABLE cycles_frais
    DROP CONSTRAINT IF EXISTS cycles_frais_tenant_id_cycle_id_key;

-- ---------------------------------------------------------------------------
-- Reprise des lignes d'avant : un barème posé au niveau du cycle s'appliquait
-- à toutes les classes de ce cycle. On le décline donc en une ligne par
-- classe — même montant, même portée, rien d'inventé.
-- ---------------------------------------------------------------------------
INSERT INTO cycles_frais (
    tenant_id, cycle_id, programme_id, inscription, scolarite, annexes, autres, currency
)
SELECT
    cf.tenant_id,
    cf.cycle_id,
    p.id,
    cf.inscription,
    cf.scolarite,
    cf.annexes,
    cf.autres,
    cf.currency
FROM cycles_frais cf
JOIN programmes p
  ON p.cycle_id = cf.cycle_id
 AND p.tenant_id = cf.tenant_id
WHERE cf.programme_id IS NULL
  -- La classe ne doit pas déjà avoir son propre barème : celui-ci fait foi.
  AND NOT EXISTS (
      SELECT 1
      FROM cycles_frais existant
      WHERE existant.tenant_id = cf.tenant_id
        AND existant.cycle_id = cf.cycle_id
        AND existant.programme_id = p.id
  );

-- Les lignes sans classe ont fait leur office : soit elles ont été déclinées
-- ci-dessus, soit leur cycle ne porte aucune classe et plus aucun code ne
-- pouvait les lire (tous les appelants joignent sur `programme_id`).
DELETE FROM cycles_frais WHERE programme_id IS NULL;

ALTER TABLE cycles_frais
    ALTER COLUMN programme_id SET NOT NULL;

-- Le barème est désormais unique par (tenant, cycle, classe) : c'est cette
-- unicité que vise le `ON CONFLICT` de l'upsert.
CREATE UNIQUE INDEX IF NOT EXISTS cycles_frais_tenant_id_cycle_id_programme_id_key
    ON cycles_frais (tenant_id, cycle_id, programme_id);

CREATE INDEX IF NOT EXISTS idx_cycles_frais_programme_id
    ON cycles_frais (programme_id);

COMMIT;
