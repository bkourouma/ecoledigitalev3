-- Frais du barème pour les étudiants du module professionnel.
--
-- Pour chaque LOT (un étudiant × une classe), crée les commandes manquantes qui
-- portent le barème de la classe (`cycles_frais`) :
--
--   inscription / annexes / autres  le montant du barème, tel quel
--   scolarite                       le COMPLÉMENT : barème de scolarité moins
--                                   ce que couvrent déjà les commandes d'UE du
--                                   lot. Un étudiant inscrit à tous les
--                                   semestres n'a aucun complément.
--
-- Le dû d'un lot devient ainsi la somme de toutes ses commandes, et vaut
-- exactement le total du barème de la classe.
--
-- Les commandes d'UE existantes ne sont pas touchées : elles gardent leurs
-- paiements, leurs reçus et leur historique.
--
-- Idempotent : `uniq_prof_order_frais` (migration 0122) garantit une seule
-- commande par lot et par nature ; une deuxième exécution ne crée rien.
-- Les montants à 0 ne donnent pas lieu à commande.

BEGIN;

WITH lots AS (
    -- Un lot = un étudiant sur une classe, vu par ses commandes d'UE.
    SELECT
        o.tenant_id,
        o.student_id,
        o.programme_id,
        SUM(o.montant_total) AS ue_couvert
    FROM professional_orders o
    WHERE o.nature = 'ue'
      AND o.programme_id IS NOT NULL
      AND o.statut <> 'annulee'
    GROUP BY o.tenant_id, o.student_id, o.programme_id
),
lignes AS (
    SELECT
        l.tenant_id,
        l.student_id,
        l.programme_id,
        v.nature,
        v.montant,
        cf.currency
    FROM lots l
    JOIN cycles_frais cf
      ON cf.tenant_id = l.tenant_id AND cf.programme_id = l.programme_id
    CROSS JOIN LATERAL (VALUES
        ('inscription', cf.inscription),
        ('annexes',     cf.annexes),
        ('autres',      cf.autres),
        ('scolarite',   GREATEST(cf.scolarite - l.ue_couvert, 0))
    ) AS v(nature, montant)
    WHERE v.montant > 0
)
INSERT INTO professional_orders (
    tenant_id, student_id, programme_id, nature, reference, montant_total, devise, statut
)
SELECT
    ln.tenant_id,
    ln.student_id,
    ln.programme_id,
    ln.nature,
    'FRAIS-' || ln.student_id || '-' || ln.programme_id || '-' || ln.nature,
    ln.montant,
    COALESCE(ln.currency, 'XOF'),
    'en_attente_paiement'
FROM lignes ln
ON CONFLICT DO NOTHING;

COMMIT;
