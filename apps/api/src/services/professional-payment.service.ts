import type { PoolClient } from "pg";
import type { CreateProfessionalPayment } from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
import {
  confirmerSiInscriptionSoldee,
  inscriptionSoldee,
} from "./professional-inscription-gate";

/**
 * Service paiement — Module Professionnel (feature 028, US2).
 *
 * Paiement d'une commande : idempotent (`reference_transaction` unique),
 * bascule commande → `payee` et inscriptions → `confirmee`, génération du reçu.
 */

/**
 * Colonnes exposées d'un paiement. Plus de `receipt_url` : la route qu'elle
 * pointait n'existe plus, et l'espace étudiant ne délivre pas de reçu — la
 * colonne reste en base (les lignes anciennes la portent encore) mais n'est ni
 * écrite ni lue.
 */
const PAYMENT_COLS = `id, tenant_id, order_id, montant::float8 AS montant, mode,
  reference_transaction, statut, paid_at, receipt_number,
  created_at, updated_at`;

/**
 * Mêmes colonnes, qualifiées par l'alias `p` — pour les requêtes qui joignent
 * la commande, où `id` et `created_at` seraient ambigus.
 */
const PAYMENT_COLS_P = `p.id, p.tenant_id, p.order_id, p.montant::float8 AS montant, p.mode,
  p.reference_transaction, p.statut, p.paid_at, p.receipt_number,
  p.created_at, p.updated_at`;

/** Les quatre lignes du barème (`cycles_frais`), dans l'ordre d'affichage. */
export const LIGNES_BAREME = ["inscription", "scolarite", "annexes", "autres"] as const;
export type LigneBareme = (typeof LIGNES_BAREME)[number];

/**
 * Ligne de barème alimentée par une commande : les UE nourrissent la scolarité.
 *
 * Une commande `transversal` (la conduite — notée et moyennée, jamais facturée)
 * ne correspond à aucune ligne ; `assembleLots` l'écarte alors du dû comme du
 * payé, sans que ses paiements historiques soient supprimés pour autant.
 */
function ligneOfNature(nature: string): LigneBareme | null {
  if (nature === "ue") return "scolarite";
  return (LIGNES_BAREME as readonly string[]).includes(nature) ? (nature as LigneBareme) : null;
}

/**
 * Replie les lignes « une par (lot, nature) » en un lot par étudiant × classe,
 * avec ses quatre lignes de barème et ses totaux.
 */
function assembleLots(rows: any[]): any[] {
  const lots = new Map<string, any>();

  for (const r of rows) {
    const key = `${r.student_id}|${r.programme_id}`;
    let lot = lots.get(key);
    if (!lot) {
      lot = {
        studentId: r.student_id,
        programmeId: r.programme_id,
        firstName: r.first_name,
        lastName: r.last_name,
        matricule: r.matricule,
        classeNom: r.classe_nom,
        classeCode: r.classe_code,
        filiereId: r.filiere_id,
        filiereNom: r.filiere_nom,
        cycleNom: r.cycle_nom,
        devise: r.devise || "XOF",
        lignes: Object.fromEntries(LIGNES_BAREME.map((l) => [l, { du: 0, paye: 0 }])),
        du: 0,
        paye: 0,
      };
      lots.set(key, lot);
    }
    const cle = ligneOfNature(r.nature);
    if (!cle) continue; // Commande transversale : hors périmètre facturable.
    const ligne = lot.lignes[cle];
    if (!ligne) continue;
    ligne.du += Number(r.du);
    ligne.paye += Number(r.paye);
    lot.du += Number(r.du);
    lot.paye += Number(r.paye);
  }

  return [...lots.values()]
    .map((lot) => {
      for (const l of LIGNES_BAREME) {
        lot.lignes[l].reste = Math.max(0, lot.lignes[l].du - lot.lignes[l].paye);
      }
      const reste = Math.max(0, lot.du - lot.paye);
      return {
        ...lot,
        reste,
        etat: lot.paye <= 0.5 ? "non_regle" : reste <= 0.5 ? "solde" : "partiel",
      };
    })
    .sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "fr")
    );
}

export class ProfessionalPaymentService extends ProfessionalBaseService {
  private async getStudentProfileId(
    client: PoolClient,
    tenantId: string,
    userId: string
  ): Promise<string | null> {
    const res = await client.query(
      `SELECT id FROM student_profiles WHERE user_id=$1 AND tenant_id=$2 LIMIT 1`,
      [userId, tenantId]
    );
    return res.rowCount && res.rowCount > 0 ? (res.rows[0].id as string) : null;
  }

  private async generateReceiptNumber(
    client: PoolClient,
    tenantId: string,
    attempt: number
  ): Promise<string> {
    const year = new Date().getFullYear();
    const cnt = await client.query(
      `SELECT count(*)::int AS n FROM professional_payments
       WHERE tenant_id=$1 AND receipt_number LIKE $2`,
      [tenantId, `REC-PRO-${year}-%`]
    );
    return `REC-PRO-${year}-${String((cnt.rows[0].n as number) + 1 + attempt).padStart(6, "0")}`;
  }

  /**
   * Les frais d'inscription du lot sont-ils soldés ?
   *
   * La règle vit désormais dans `professional-inscription-gate`, parce qu'elle
   * doit aussi être évaluée à la CRÉATION d'une inscription : une classe sans
   * frais d'inscription ne doit bloquer personne, or aucun encaissement ne
   * survient jamais dans ce cas pour déclencher l'évaluation.
   */
  private async inscriptionSoldee(
    client: PoolClient,
    tenantId: string,
    studentId: string,
    programmeId: string | null
  ): Promise<boolean> {
    return inscriptionSoldee(client, tenantId, studentId, programmeId);
  }

  /**
   * Confirme les inscriptions aux UE d'un lot, mais seulement si les frais
   * d'inscription sont soldés. Sans quoi elles restent en attente : c'est ce
   * qui rend l'inscription « incomplète » côté étudiant.
   */
  private async confirmerSiInscriptionSoldee(
    client: PoolClient,
    tenantId: string,
    studentId: string,
    programmeId: string | null
  ): Promise<boolean> {
    return confirmerSiInscriptionSoldee(client, tenantId, studentId, programmeId);
  }

  /**
   * Répartit un règlement sur des commandes, de la plus ancienne à la plus
   * récente, sans jamais dépasser le reste dû de chacune. Une ligne de paiement
   * (donc un reçu) est créée par commande servie ; la référence de transaction
   * ne porte que sur la première, pour ne pas la dupliquer.
   *
   * `orders` doit venir d'un SELECT ... FOR UPDATE, dans l'ordre d'imputation
   * voulu, et porter `order_id`, `montant_total` et `paid`.
   *
   * Renvoie ce qui n'a pas pu être imputé (0 dans le cas nominal).
   */
  private async allocateAcrossOrders(
    client: PoolClient,
    tenantId: string,
    orders: { order_id: string; montant_total: number; paid: number }[],
    input: { montant: number; mode: string; reference_transaction?: string | null }
  ): Promise<number> {
    let left = input.montant;
    let refUsed = false;

    for (const r of orders) {
      if (left <= 0.001) break;
      const rRemaining = Math.max(0, r.montant_total - r.paid);
      if (rRemaining <= 0.001) continue;
      const alloc = Math.min(rRemaining, left);

      for (let attempt = 0; attempt < 5; attempt++) {
        const rn = await this.generateReceiptNumber(client, tenantId, attempt);
        // Sans SAVEPOINT, l'échec de l'INSERT annule TOUTE la transaction :
        // la tentative suivante se heurterait alors à un 25P02 et le règlement
        // partirait en 500 au lieu de se rejouer.
        await client.query("SAVEPOINT ligne_paiement");
        try {
          await client.query(
            `INSERT INTO professional_payments
               (tenant_id, order_id, montant, mode, reference_transaction, statut, paid_at, receipt_number)
             VALUES ($1,$2,$3,$4,$5,'confirme',now(),$6)`,
            [
              tenantId,
              r.order_id,
              alloc,
              input.mode,
              !refUsed && input.reference_transaction ? input.reference_transaction : null,
              rn,
            ]
          );
          await client.query("RELEASE SAVEPOINT ligne_paiement");
          break;
        } catch (e: any) {
          await client.query("ROLLBACK TO SAVEPOINT ligne_paiement");
          // Numéro de reçu déjà pris : on en régénère un. Toute autre unicité
          // (la référence de transaction) est une vraie erreur d'appel.
          if (e?.code === "23505" && e?.constraint === "uniq_prof_payment_receipt" && attempt < 4) {
            continue;
          }
          throw e;
        }
      }
      refUsed = true;
      left -= alloc;
      const fully = r.paid + alloc + 0.001 >= r.montant_total;
      await client.query(`UPDATE professional_orders SET statut=$1, updated_at=now() WHERE id=$2`, [
        fully ? "payee" : "en_attente_paiement",
        r.order_id,
      ]);
    }

    return left;
  }

  /**
   * Règle et confirme le paiement d'une commande. Idempotent : rejouer la même
   * `reference_transaction` renvoie le paiement existant sans créer de doublon.
   */
  async payOrder(
    tenantId: string,
    userId: string,
    orderId: string,
    input: CreateProfessionalPayment
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");

      // Verrou de la commande — sérialise les paiements concurrents.
      const orderRes = await client.query(
        `SELECT id, montant_total::float8 AS montant_total, statut
         FROM professional_orders
         WHERE id=$1 AND student_id=$2 FOR UPDATE`,
        [orderId, studentId]
      );
      if (orderRes.rowCount === 0) return fail("NOT_FOUND", "Commande introuvable.");
      const order = orderRes.rows[0];

      // Idempotence : rejeu d'une référence de transaction déjà enregistrée.
      if (input.reference_transaction) {
        const existing = await client.query(
          `SELECT ${PAYMENT_COLS} FROM professional_payments
           WHERE tenant_id=$1 AND reference_transaction=$2`,
          [tenantId, input.reference_transaction]
        );
        if (existing.rowCount && existing.rowCount > 0) {
          return ok({ ...existing.rows[0], idempotent_replay: true });
        }
      }

      if (order.statut === "payee") {
        return fail("ALREADY_PAID", "Cette commande est déjà payée.");
      }
      if (order.statut !== "en_attente_paiement") {
        return fail(
          "INVALID_ORDER_STATE",
          "La commande doit être validée (en attente de paiement) avant le règlement."
        );
      }

      // Création du paiement confirmé + reçu.
      let payment: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const receiptNumber = await this.generateReceiptNumber(client, tenantId, attempt);
        try {
          const ins = await client.query(
            `INSERT INTO professional_payments
               (tenant_id, order_id, montant, mode, reference_transaction,
                statut, paid_at, receipt_number)
             VALUES ($1,$2,$3,$4,$5,'confirme',now(),$6)
             RETURNING ${PAYMENT_COLS}`,
            [
              tenantId,
              orderId,
              order.montant_total,
              input.mode,
              input.reference_transaction ?? null,
              receiptNumber,
            ]
          );
          payment = ins.rows[0];
          break;
        } catch (e: any) {
          // Conflit reçu → nouvelle tentative ; conflit référence → rejeu concurrent.
          if (e?.code === "23505") {
            if (input.reference_transaction) {
              const existing = await client.query(
                `SELECT ${PAYMENT_COLS} FROM professional_payments
                 WHERE tenant_id=$1 AND reference_transaction=$2`,
                [tenantId, input.reference_transaction]
              );
              if (existing.rowCount && existing.rowCount > 0) {
                return ok({ ...existing.rows[0], idempotent_replay: true });
              }
            }
            if (attempt < 4) continue; // collision de receipt_number → retry
          }
          throw e;
        }
      }
      if (!payment) {
        return fail("INTERNAL_ERROR", "Échec de génération du reçu de paiement.");
      }

      // Bascule commande → payee et inscriptions → confirmee (FR-020).
      await client.query(
        `UPDATE professional_orders SET statut='payee', updated_at=now() WHERE id=$1`,
        [orderId]
      );
      // Complète seulement si les frais d'inscription de la classe sont soldés.
      const ordreLot = await client.query(
        `SELECT student_id, programme_id FROM professional_orders WHERE id = $1 AND tenant_id = $2`,
        [orderId, tenantId]
      );
      if (ordreLot.rowCount) {
        await this.confirmerSiInscriptionSoldee(
          client,
          tenantId,
          ordreLot.rows[0].student_id,
          ordreLot.rows[0].programme_id
        );
      }

      return ok(payment);
    });
  }

  /**
   * Enregistre un paiement (partiel possible) d'un ADMIN sur une inscription.
   * Dès qu'un paiement existe, l'inscription passe « confirmée » (l'étudiant est
   * inscrit). La commande passe « payée » uniquement quand elle est soldée.
   */
  async adminRecordPayment(
    tenantId: string,
    enrollmentId: string,
    input: { montant: number; mode: string; reference_transaction?: string | null }
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const enr = await client.query(
        `SELECT order_id, ue_session_id FROM professional_enrollments
         WHERE id=$1 AND tenant_id=$2`,
        [enrollmentId, tenantId]
      );
      if (enr.rowCount === 0) return fail("NOT_FOUND", "Inscription introuvable.");
      const orderId = enr.rows[0].order_id as string;

      const ordRes = await client.query(
        `SELECT id, student_id, programme_id, montant_total::float8 AS montant_total
         FROM professional_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [orderId, tenantId]
      );
      if (ordRes.rowCount === 0) return fail("NOT_FOUND", "Commande introuvable.");
      const order = ordRes.rows[0];

      const montant = Number(input.montant);
      if (!(montant > 0)) return fail("VALIDATION_ERROR", "Le montant doit être positif.");

      const paidRes = await client.query(
        `SELECT COALESCE(sum(montant),0)::float8 AS paid FROM professional_payments
         WHERE order_id=$1 AND statut='confirme'`,
        [orderId]
      );
      const paid = paidRes.rows[0].paid as number;
      const remaining = Math.max(0, order.montant_total - paid);
      if (remaining <= 0.001) return fail("ALREADY_PAID", "Cette inscription est déjà soldée.");
      if (montant > remaining + 0.001) {
        return fail(
          "AMOUNT_EXCEEDS",
          `Le montant dépasse le reste à payer (${Math.round(remaining)} FCFA).`
        );
      }

      let payment: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const receiptNumber = await this.generateReceiptNumber(client, tenantId, attempt);
        try {
          const ins = await client.query(
            `INSERT INTO professional_payments
               (tenant_id, order_id, montant, mode, reference_transaction, statut, paid_at, receipt_number)
             VALUES ($1,$2,$3,$4,$5,'confirme',now(),$6)
             RETURNING ${PAYMENT_COLS}`,
            [tenantId, orderId, montant, input.mode, input.reference_transaction ?? null, receiptNumber]
          );
          payment = ins.rows[0];
          break;
        } catch (e: any) {
          if (e?.code === "23505" && attempt < 4) continue;
          throw e;
        }
      }
      if (!payment) return fail("INTERNAL_ERROR", "Échec de génération du reçu.");

      const newPaid = paid + montant;
      const fullyPaid = newPaid + 0.001 >= order.montant_total;
      // Complète seulement si les frais d'inscription de la classe sont soldés.
      await this.confirmerSiInscriptionSoldee(
        client,
        tenantId,
        order.student_id,
        order.programme_id
      );
      await client.query(
        `UPDATE professional_orders SET statut=$1, updated_at=now() WHERE id=$2`,
        [fullyPaid ? "payee" : "en_attente_paiement", orderId]
      );

      return ok({
        payment,
        montant_du: order.montant_total,
        montant_paye: newPaid,
        reste: Math.max(0, order.montant_total - newPaid),
        fully_paid: fullyPaid,
      });
    });
  }

  /**
   * Versements de l'étudiant authentifié — la traçabilité de son espace
   * « Mes paiements », en regard de la page admin Paiements.
   *
   * Volontairement sans `receipt_number` ni `receipt_url` : l'espace étudiant
   * montre le suivi des versements, pas les reçus. Ce qu'une charge utile ne
   * porte pas ne peut pas fuiter par un écran.
   */
  async studentListPayments(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      const res = await client.query(
        `SELECT p.id, p.order_id, p.montant::float8 AS montant, p.mode, p.statut,
                -- Un encaissement réparti sur plusieurs commandes crée une ligne
                -- par commande, mais reference_transaction est UNIQUE : seule
                -- la première la porte, les autres sont NULL. On la rediffuse
                -- sur toutes les lignes du même encaissement — même instant de
                -- versement, même mode — sinon l'étudiant voit une référence
                -- sur une ligne et rien sur les onze suivantes.
                max(p.reference_transaction) OVER (
                  PARTITION BY COALESCE(p.paid_at, p.created_at), p.mode
                ) AS reference_transaction,
                p.paid_at, p.created_at,
                o.reference AS order_reference,
                o.montant_total::float8 AS order_montant
         FROM professional_payments p
         JOIN professional_orders o ON o.id = p.order_id
         WHERE p.tenant_id = $1 AND o.student_id = $2
         ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.created_at DESC`,
        [tenantId, studentId]
      );
      const confirmes = res.rows.filter((r: any) => r.statut === "confirme");
      return ok({
        payments: res.rows,
        total_verse: confirmes.reduce((s: number, r: any) => s + Number(r.montant ?? 0), 0),
      });
    });
  }

  /* ---------------------------------------------------------------------- *
   * Scolarité — le barème complet d'un lot (un étudiant × une classe).
   *
   * Le dû d'un lot est la somme de ses commandes, qui vaut le barème de la
   * classe (`cycles_frais`). Les commandes d'UE alimentent la ligne
   * « scolarité », au même titre que l'éventuel complément de scolarité.
   * ---------------------------------------------------------------------- */

  /** Commandes d'un lot concernées par une ligne du barème. */
  private naturesOf(ligne: LigneBareme): string[] {
    return ligne === "scolarite" ? ["ue", "scolarite"] : [ligne];
  }

  /** Colonnes et jointures communes aux deux requêtes de lot. */
  private lotSelect(): string {
    return `o.student_id, o.programme_id, o.nature,
            SUM(o.montant_total)::float8       AS du,
            COALESCE(SUM(pay.paye), 0)::float8 AS paye,
            MIN(u.first_name)  AS first_name,
            MIN(u.last_name)   AS last_name,
            MIN(psm.matricule) AS matricule,
            MIN(p.name)        AS classe_nom,
            MIN(p.code)        AS classe_code,
            MIN(p.filiere_id::text) AS filiere_id,
            MIN(f.name)        AS filiere_nom,
            MIN(c.name)        AS cycle_nom,
            MIN(o.devise)      AS devise
     FROM professional_orders o
     JOIN programmes p        ON p.id = o.programme_id
     JOIN cycles c            ON c.id = p.cycle_id
     LEFT JOIN filieres f     ON f.id = p.filiere_id AND f.tenant_id = p.tenant_id
     JOIN student_profiles sp ON sp.id = o.student_id
     JOIN users u             ON u.id = sp.user_id
     LEFT JOIN professional_student_matricules psm
            ON psm.student_id = o.student_id
           AND psm.filiere_id = o.programme_id
           AND psm.tenant_id = o.tenant_id
     LEFT JOIN LATERAL (
       SELECT SUM(pm.montant)::float8 AS paye
       FROM professional_payments pm
       WHERE pm.order_id = o.id AND pm.statut = 'confirme'
     ) pay ON TRUE`;
  }

  /**
   * Situation financière de chaque lot, ligne de barème par ligne de barème.
   * Une seule requête : les cartes de la liste comme le résumé s'en servent.
   */
  async adminListScolariteLots(
    tenantId: string,
    filters: { filiereId?: string; programmeId?: string } = {}
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = [
        "o.tenant_id = $1",
        "o.statut <> 'annulee'",
        "o.programme_id IS NOT NULL",
      ];
      const params: any[] = [tenantId];
      let i = 2;
      if (filters.filiereId) {
        where.push(`p.filiere_id = $${i++}`);
        params.push(filters.filiereId);
      }
      if (filters.programmeId) {
        where.push(`o.programme_id = $${i++}`);
        params.push(filters.programmeId);
      }

      const res = await client.query(
        `SELECT ${this.lotSelect()}
         WHERE ${where.join(" AND ")}
         GROUP BY o.student_id, o.programme_id, o.nature`,
        params
      );

      // Classes dont une ouverture est encore active, au sens de l'écran
      // Sessions : ni brouillon, ni terminée, ni annulée. Un lot n'existant que
      // si l'étudiant est inscrit, marquer les lots suffit à obtenir
      // « classe ouverte ET pourvue d'au moins une inscription ».
      const ouvertes = await client.query(
        `SELECT DISTINCT ue.filiere_id AS programme_id
         FROM professional_ue_sessions s
         JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
         WHERE s.tenant_id = $1
           AND s.statut NOT IN ('brouillon', 'termine', 'annule')`,
        [tenantId]
      );
      const classesOuvertes = new Set(ouvertes.rows.map((r) => r.programme_id));

      const items = assembleLots(res.rows).map((lot) => ({
        ...lot,
        classeOuverte: classesOuvertes.has(lot.programmeId),
      }));

      return ok({ items });
    });
  }

  /**
   * Détail d'un lot : ses lignes de barème, les UE qui composent sa scolarité
   * et l'intégralité de ses paiements (pour l'historique et les reçus).
   */
  async adminGetScolariteLot(
    tenantId: string,
    studentId: string,
    programmeId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT ${this.lotSelect()}
         WHERE o.tenant_id = $1 AND o.student_id = $2 AND o.programme_id = $3
           AND o.statut <> 'annulee'
         GROUP BY o.student_id, o.programme_id, o.nature`,
        [tenantId, studentId, programmeId]
      );
      const lots = assembleLots(res.rows);
      if (!lots.length) {
        return fail("NOT_FOUND", "Aucune inscription pour cet étudiant dans cette classe.");
      }
      const lot = lots[0];

      // Le semestre d'une UE suivie : rattachement direct de la cohorte, ou via
      // son UE. Même résolution que la liste des inscriptions, pour que les deux
      // écrans regroupent à l'identique.
      const ues = await client.query(
        `SELECT e.id, ue.code AS ue_code, ue.libelle AS ue_libelle,
                s.libelle AS session_libelle,
                sem.id AS semestre_id, sem.libelle AS semestre_libelle,
                o.montant_total::float8 AS montant
         FROM professional_enrollments e
         JOIN professional_orders o        ON o.id = e.order_id
         JOIN professional_ue_sessions s   ON s.id = e.ue_session_id AND s.tenant_id = e.tenant_id
         JOIN professional_ue ue           ON ue.id = s.ue_id        AND ue.tenant_id = s.tenant_id
         LEFT JOIN LATERAL (
           SELECT sm.id, sm.libelle
           FROM professional_semestres sm
           WHERE sm.tenant_id = s.tenant_id
             AND (EXISTS (SELECT 1 FROM professional_semestre_sessions ss
                          WHERE ss.semestre_id = sm.id AND ss.ue_session_id = s.id
                            AND ss.tenant_id = s.tenant_id)
               OR EXISTS (SELECT 1 FROM professional_semestre_ue su
                          WHERE su.semestre_id = sm.id AND su.ue_id = s.ue_id
                            AND su.tenant_id = s.tenant_id))
           ORDER BY sm.libelle
           LIMIT 1
         ) sem ON TRUE
         WHERE e.tenant_id = $1 AND e.student_id = $2 AND ue.filiere_id = $3
           AND e.statut <> 'annulee'
           AND o.nature <> 'transversal'
         ORDER BY sem.libelle NULLS LAST, ue.code`,
        [tenantId, studentId, programmeId]
      );

      const payments = await client.query(
        `SELECT ${PAYMENT_COLS_P}, o.nature
         FROM professional_payments p
         JOIN professional_orders o ON o.id = p.order_id
         WHERE p.tenant_id = $1 AND o.student_id = $2 AND o.programme_id = $3
         ORDER BY p.paid_at, p.created_at`,
        [tenantId, studentId, programmeId]
      );

      return ok({ ...lot, ues: ues.rows, payments: payments.rows });
    });
  }

  /**
   * Encaisse un règlement sur UNE ligne du barème d'un lot. Le montant est
   * réparti sur les commandes de cette ligne, de la plus ancienne à la plus
   * récente ; chaque commande servie produit son reçu.
   */
  async adminRecordLotPayment(
    tenantId: string,
    studentId: string,
    programmeId: string,
    ligne: LigneBareme,
    input: { montant: number; mode: string; reference_transaction?: string | null }
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const montant = Number(input.montant);
      if (!(montant > 0)) return fail("VALIDATION_ERROR", "Le montant doit être positif.");

      // La référence de transaction est unique par locataire : on le dit
      // clairement plutôt que de laisser l'INSERT échouer en fin de course.
      if (input.reference_transaction) {
        const deja = await client.query(
          `SELECT 1 FROM professional_payments
           WHERE tenant_id = $1 AND reference_transaction = $2 LIMIT 1`,
          [tenantId, input.reference_transaction]
        );
        if (deja.rowCount) {
          return fail(
            "REFERENCE_DEJA_UTILISEE",
            `La référence « ${input.reference_transaction} » a déjà été enregistrée sur un autre paiement.`
          );
        }
      }

      const rows = await client.query(
        `SELECT o.id AS order_id, o.montant_total::float8 AS montant_total,
                (SELECT COALESCE(sum(pm.montant),0)::float8 FROM professional_payments pm
                 WHERE pm.order_id = o.id AND pm.statut = 'confirme') AS paid
         FROM professional_orders o
         WHERE o.tenant_id = $1 AND o.student_id = $2 AND o.programme_id = $3
           AND o.nature = ANY($4::text[]) AND o.statut <> 'annulee'
         ORDER BY o.created_at
         FOR UPDATE`,
        [tenantId, studentId, programmeId, this.naturesOf(ligne)]
      );
      if (rows.rowCount === 0) {
        return fail("NOT_FOUND", `Aucun frais « ${ligne} » n'est dû pour cet étudiant.`);
      }

      const totalDue = rows.rows.reduce((a: number, r: any) => a + r.montant_total, 0);
      const totalPaid = rows.rows.reduce((a: number, r: any) => a + r.paid, 0);
      const remaining = Math.max(0, totalDue - totalPaid);
      if (remaining <= 0.5) return fail("ALREADY_PAID", "Cette ligne est déjà entièrement réglée.");
      if (montant > remaining + 0.5) {
        return fail(
          "AMOUNT_EXCEEDS",
          `Le montant dépasse le reste à payer (${Math.round(remaining)} FCFA).`
        );
      }

      const left = await this.allocateAcrossOrders(client, tenantId, rows.rows, {
        montant,
        mode: input.mode,
        reference_transaction: input.reference_transaction ?? null,
      });

      // L'inscription n'est complète qu'une fois les frais d'inscription
      // soldés — un règlement sur une autre ligne ne suffit pas.
      const inscriptionComplete = await this.confirmerSiInscriptionSoldee(
        client,
        tenantId,
        studentId,
        programmeId
      );

      const newPaid = totalPaid + (montant - left);
      return ok({
        ligne,
        montant_du: totalDue,
        montant_paye: newPaid,
        reste: Math.max(0, totalDue - newPaid),
        fully_paid: totalDue - newPaid <= 0.5,
        inscription_complete: inscriptionComplete,
      });
    });
  }
}
