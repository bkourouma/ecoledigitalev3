/**
 * Écarts de caisse : fragment SQL partagé.
 *
 * POURQUOI CE FRAGMENT EXISTE
 *
 * Deux écrans posent la même question — « la caisse et les commandes
 * racontent-elles la même histoire ? » — et doivent donc y répondre par le même
 * calcul. Les Impayés l'affichaient déjà ; les Paiements en ont besoin depuis
 * que le journal de caisse y a déménagé, parce qu'une pièce comptable se lit
 * avec ses écarts sous les yeux, pas sur l'écran d'à côté.
 *
 * Recopier la requête aurait suffi à les faire diverger au premier correctif.
 *
 * LES DEUX ÉCARTS, ET CE QU'ILS SIGNIFIENT
 *
 * 1. `orders_no_payment` — une commande marquée « payée » sans aucune ligne de
 *    paiement en face. `adminUpdateEnrollment` force ce statut sans créer de
 *    règlement : la commande est soldée dans l'application et l'argent n'est
 *    jamais passé par la caisse. C'est le seul écart qui peut cacher une perte.
 *
 * 2. `no_receipt` — un encaissement confirmé sans numéro de reçu, passé
 *    quarante-huit heures. Le délai n'est pas décoratif : un reçu s'édite
 *    souvent le lendemain, et compter les règlements du jour ferait clignoter
 *    une alerte permanente que plus personne ne regarderait.
 *
 * LE PÉRIMÈTRE S'APPLIQUE, ET C'EST UN CORRECTIF
 *
 * Les deux écarts passent par `commandes_perimetre`. Sans cela, une carte rouge
 * comptait les anomalies de TOUT l'établissement sous un filtre de classe, et
 * faisait porter à cette classe des écarts qui n'étaient pas les siens.
 *
 * Dépend de `commandes_perimetre`, donc du socle complet, à déclarer avant lui
 * dans le WITH. Paramètres : les cinq du contrat de périmètre.
 */
export const ECARTS_DE_CAISSE_SQL = `
  SELECT
    (SELECT COUNT(*) FROM professional_orders o
      JOIN commandes_perimetre cp ON cp.order_id = o.id
      WHERE o.tenant_id = $1::uuid
        AND o.statut = 'payee'
        AND NOT EXISTS (SELECT 1 FROM professional_payments p
                         WHERE p.order_id = o.id AND p.tenant_id = o.tenant_id))::int
      AS orders_no_payment,
    (SELECT COALESCE(SUM(o.montant_total), 0) FROM professional_orders o
      JOIN commandes_perimetre cp ON cp.order_id = o.id
      WHERE o.tenant_id = $1::uuid
        AND o.statut = 'payee'
        AND NOT EXISTS (SELECT 1 FROM professional_payments p
                         WHERE p.order_id = o.id AND p.tenant_id = o.tenant_id))::float8
      AS orders_no_payment_amount,
    (SELECT COUNT(*) FROM professional_payments p
      JOIN commandes_perimetre cp ON cp.order_id = p.order_id
      WHERE p.tenant_id = $1::uuid
        AND p.statut = 'confirme'
        AND (p.receipt_number IS NULL OR TRIM(p.receipt_number) = '')
        AND COALESCE(p.paid_at, p.created_at) < now() - INTERVAL '48 hours')::int
      AS no_receipt,
    (SELECT COALESCE(SUM(p.montant), 0) FROM professional_payments p
      JOIN commandes_perimetre cp ON cp.order_id = p.order_id
      WHERE p.tenant_id = $1::uuid
        AND p.statut = 'confirme'
        AND (p.receipt_number IS NULL OR TRIM(p.receipt_number) = '')
        AND COALESCE(p.paid_at, p.created_at) < now() - INTERVAL '48 hours')::float8
      AS no_receipt_amount`;
