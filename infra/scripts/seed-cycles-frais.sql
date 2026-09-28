-- Barème de scolarité — création d'une ligne `cycles_frais` par classe.
--
-- La scolarité est CALCULÉE : pour chaque semestre de la classe
-- (`professional_semestres`), on somme le prix des UE qui le composent
-- (`professional_semestre_ue` → `professional_ue.prix`). C'est exactement ce
-- qu'affiche /admin/finances/scolarite.
--
-- Inscription, frais annexes et autres frais restent à 0 : ce sont des tarifs
-- propres à l'établissement, ils ne se déduisent d'aucune donnée existante et
-- se saisissent depuis l'écran Scolarité.
--
-- Idempotent : une classe qui a déjà son barème n'est pas touchée.
-- Multi-tenant : chaque classe apporte son `tenant_id`.

BEGIN;

INSERT INTO cycles_frais (
    tenant_id, cycle_id, programme_id, inscription, scolarite, annexes, autres, currency
)
SELECT
    p.tenant_id,
    p.cycle_id,
    p.id,
    0,
    COALESCE(ue.montant, 0),
    0,
    0,
    COALESCE(ue.devise, 'XOF')
FROM programmes p
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(u.prix), 0) AS montant, MIN(u.devise) AS devise
    FROM professional_semestres sm
    JOIN professional_semestre_ue su
      ON su.semestre_id = sm.id AND su.tenant_id = sm.tenant_id
    JOIN professional_ue u
      ON u.id = su.ue_id AND u.tenant_id = su.tenant_id
    WHERE sm.filiere_id = p.id AND sm.tenant_id = p.tenant_id
) ue ON TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM cycles_frais cf
    WHERE cf.tenant_id = p.tenant_id
      AND cf.cycle_id = p.cycle_id
      AND cf.programme_id = p.id
);

COMMIT;
