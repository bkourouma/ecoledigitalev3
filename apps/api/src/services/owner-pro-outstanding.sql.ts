/**
 * Impayés du Module Professionnel : fragment SQL partagé.
 *
 * Trois écrans datent la même dette — le pouls, la trésorerie et le risque de
 * décrochage. Ils DOIVENT produire le même chiffre : deux montants
 * contradictoires pour le même étudiant valent moins que pas de montant du tout.
 * D'où ce fragment unique plutôt que trois copies qui divergeront.
 *
 * DEUX RÈGLES, ET POURQUOI
 *
 * 1. LE MONTANT FAIT FOI CÔTÉ COMMANDE, LA DATE CÔTÉ ÉCHÉANCIER.
 *    `professional_order_installments` (migration 0096) donne à la dette
 *    professionnelle les dates d'exigibilité qui lui manquaient. Mais son
 *    montant est une COPIE prise au moment du backfill : ajouter une UE au
 *    panier augmente `professional_orders.montant_total` sans toucher
 *    l'échéancier, qui devient alors sous-évalué. Constaté en base : des
 *    échéances à 7 500 FCFA pour des commandes à 75 000.
 *
 *    On rapporte donc chaque échéance au total réel de la commande. La somme
 *    des échéances ajustées vaut exactement `montant_total`, par construction.
 *    Un échéancier désynchronisé décale au pire une date, jamais un montant.
 *
 * 2. LES VERSEMENTS SOLDENT LES ÉCHÉANCES LES PLUS ANCIENNES D'ABORD.
 *    C'est la convention comptable usuelle, et la seule qui ne fasse pas
 *    vieillir artificiellement la dette : imputer un paiement sur la dernière
 *    échéance laisserait la première éternellement « en retard ».
 *
 * Colonnes produites par `pro_unpaid_installments` :
 *   order_id, student_id, due_date, unpaid
 *
 * Le fragment attend `$1::uuid` = tenant. Il définit `paid_per_order`, qui peut
 * être réutilisé par la requête appelante.
 */
export const PRO_UNPAID_INSTALLMENTS_CTE = `
  paid_per_order AS (
    SELECT p.order_id, SUM(p.montant)::float8 AS paid
    FROM professional_payments p
    WHERE p.tenant_id = $1::uuid AND p.statut = 'confirme'
    GROUP BY p.order_id
  ),
  pro_schedule_total AS (
    SELECT order_id, SUM(montant)::float8 AS sched_total
    FROM professional_order_installments
    WHERE tenant_id = $1::uuid
    GROUP BY order_id
  ),
  pro_scaled_installments AS (
    SELECT
      i.order_id,
      o.student_id,
      i.due_date,
      i.rang,
      -- Échéance rapportée au total réel de la commande (règle 1).
      (i.montant::float8 * o.montant_total::float8 / NULLIF(st.sched_total, 0)) AS montant
    FROM professional_order_installments i
    JOIN professional_orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
    JOIN pro_schedule_total st ON st.order_id = i.order_id
    WHERE i.tenant_id = $1::uuid AND o.statut <> 'annulee'
  ),
  pro_unpaid_installments AS (
    SELECT
      si.order_id,
      si.student_id,
      si.due_date,
      -- Reste dû de CETTE échéance : son montant, moins ce que les versements
      -- ont déjà absorbé sur elle et les précédentes (règle 2), borné à
      -- [0, montant].
      GREATEST(0, LEAST(
        si.montant,
        SUM(si.montant) OVER (
          PARTITION BY si.order_id ORDER BY si.due_date, si.rang
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) - COALESCE(pp.paid, 0)
      )) AS unpaid
    FROM pro_scaled_installments si
    LEFT JOIN paid_per_order pp ON pp.order_id = si.order_id
  )`;
