import type { PoolClient } from "pg";
import type { CreateProfessionalPayment } from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Service paiement — Module Professionnel (feature 028, US2).
 *
 * Paiement d'une commande : idempotent (`reference_transaction` unique),
 * bascule commande → `payee` et inscriptions → `confirmee`, génération du reçu.
 */

const PAYMENT_COLS = `id, tenant_id, order_id, montant::float8 AS montant, mode,
  reference_transaction, statut, paid_at, receipt_number, receipt_url,
  created_at, updated_at`;

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

      const receiptUrl = `/api/v1/professional/student/receipts/${payment.id}`;
      const updated = await client.query(
        `UPDATE professional_payments SET receipt_url=$1, updated_at=now()
         WHERE id=$2 RETURNING ${PAYMENT_COLS}`,
        [receiptUrl, payment.id]
      );
      payment = updated.rows[0];

      // Bascule commande → payee et inscriptions → confirmee (FR-020).
      await client.query(
        `UPDATE professional_orders SET statut='payee', updated_at=now() WHERE id=$1`,
        [orderId]
      );
      await client.query(
        `UPDATE professional_enrollments SET statut='confirmee', updated_at=now()
         WHERE order_id=$1 AND statut='en_attente_paiement'`,
        [orderId]
      );

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
        `SELECT id, montant_total::float8 AS montant_total FROM professional_orders
         WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
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

      const receiptUrl = `/api/v1/professional/student/receipts/${payment.id}`;
      const upd = await client.query(
        `UPDATE professional_payments SET receipt_url=$1, updated_at=now() WHERE id=$2 RETURNING ${PAYMENT_COLS}`,
        [receiptUrl, payment.id]
      );
      payment = upd.rows[0];

      const newPaid = paid + montant;
      const fullyPaid = newPaid + 0.001 >= order.montant_total;
      // Au moins un paiement → inscription confirmée.
      await client.query(
        `UPDATE professional_enrollments SET statut='confirmee', updated_at=now()
         WHERE order_id=$1 AND statut='en_attente_paiement'`,
        [orderId]
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

  /** Historique des paiements d'une inscription (via sa commande). */
  async adminListEnrollmentPayments(
    tenantId: string,
    enrollmentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const enr = await client.query(
        `SELECT e.order_id, o.montant_total::float8 AS montant_total
         FROM professional_enrollments e JOIN professional_orders o ON o.id = e.order_id
         WHERE e.id=$1 AND e.tenant_id=$2`,
        [enrollmentId, tenantId]
      );
      if (enr.rowCount === 0) return fail("NOT_FOUND", "Inscription introuvable.");
      const res = await client.query(
        `SELECT ${PAYMENT_COLS} FROM professional_payments
         WHERE order_id=$1 AND tenant_id=$2 ORDER BY created_at`,
        [enr.rows[0].order_id, tenantId]
      );
      const paid = res.rows.reduce(
        (a: number, p: any) => a + (p.statut === "confirme" ? Number(p.montant) : 0),
        0
      );
      const montantTotal = enr.rows[0].montant_total as number;
      return ok({
        payments: res.rows,
        montant_du: montantTotal,
        montant_paye: paid,
        reste: Math.max(0, montantTotal - paid),
      });
    });
  }

  /**
   * Enregistre un paiement (partiel possible) pour un ÉTUDIANT, réparti sur
   * plusieurs inscriptions (ses UE d'un lot). Le montant est imputé sur les
   * inscriptions non soldées dans l'ordre. Dès un paiement, toutes les
   * inscriptions du lot passent « confirmée » (l'étudiant est inscrit).
   */
  async adminRecordStudentPayment(
    tenantId: string,
    enrollmentIds: string[],
    input: { montant: number; mode: string; reference_transaction?: string | null }
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      if (!enrollmentIds.length) return fail("VALIDATION_ERROR", "Aucune inscription fournie.");
      const rows = await client.query(
        `SELECT e.id, e.order_id, o.montant_total::float8 AS montant_total,
                (SELECT COALESCE(sum(pm.montant),0)::float8 FROM professional_payments pm
                 WHERE pm.order_id = e.order_id AND pm.statut = 'confirme') AS paid
         FROM professional_enrollments e
         JOIN professional_orders o ON o.id = e.order_id
         WHERE e.id = ANY($1::uuid[]) AND e.tenant_id = $2 AND e.statut <> 'annulee'
         ORDER BY e.created_at
         FOR UPDATE OF o`,
        [enrollmentIds, tenantId]
      );
      if (rows.rowCount === 0) return fail("NOT_FOUND", "Inscriptions introuvables.");

      const totalDue = rows.rows.reduce((a: number, r: any) => a + r.montant_total, 0);
      const totalPaid = rows.rows.reduce((a: number, r: any) => a + r.paid, 0);
      const remaining = Math.max(0, totalDue - totalPaid);
      const montant = Number(input.montant);
      if (!(montant > 0)) return fail("VALIDATION_ERROR", "Le montant doit être positif.");
      if (remaining <= 0.5) return fail("ALREADY_PAID", "Ce lot est déjà entièrement réglé.");
      if (montant > remaining + 0.5) {
        return fail("AMOUNT_EXCEEDS", `Le montant dépasse le reste à payer (${Math.round(remaining)} FCFA).`);
      }

      let left = montant;
      let refUsed = false;
      for (const r of rows.rows) {
        if (left <= 0.001) break;
        const rRemaining = Math.max(0, r.montant_total - r.paid);
        if (rRemaining <= 0.001) continue;
        const alloc = Math.min(rRemaining, left);

        let payId: string | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const rn = await this.generateReceiptNumber(client, tenantId, attempt);
          try {
            const ins = await client.query(
              `INSERT INTO professional_payments
                 (tenant_id, order_id, montant, mode, reference_transaction, statut, paid_at, receipt_number)
               VALUES ($1,$2,$3,$4,$5,'confirme',now(),$6) RETURNING id`,
              [
                tenantId,
                r.order_id,
                alloc,
                input.mode,
                !refUsed && input.reference_transaction ? input.reference_transaction : null,
                rn,
              ]
            );
            payId = ins.rows[0].id;
            break;
          } catch (e: any) {
            if (e?.code === "23505" && attempt < 4) continue;
            throw e;
          }
        }
        if (payId) {
          await client.query(
            `UPDATE professional_payments SET receipt_url=$1 WHERE id=$2`,
            [`/api/v1/professional/student/receipts/${payId}`, payId]
          );
        }
        refUsed = true;
        left -= alloc;
        const fully = r.paid + alloc + 0.001 >= r.montant_total;
        await client.query(
          `UPDATE professional_orders SET statut=$1, updated_at=now() WHERE id=$2`,
          [fully ? "payee" : "en_attente_paiement", r.order_id]
        );
      }

      // Au moins un paiement → toutes les inscriptions du lot sont confirmées.
      await client.query(
        `UPDATE professional_enrollments SET statut='confirmee', updated_at=now()
         WHERE id = ANY($1::uuid[]) AND statut = 'en_attente_paiement'`,
        [enrollmentIds]
      );

      const newPaid = totalPaid + (montant - left);
      return ok({
        montant_du: totalDue,
        montant_paye: newPaid,
        reste: Math.max(0, totalDue - newPaid),
        fully_paid: totalDue - newPaid <= 0.5,
      });
    });
  }

  /** Historique fusionné des paiements d'un ensemble d'inscriptions (un lot étudiant). */
  async adminListPaymentsForEnrollments(
    tenantId: string,
    enrollmentIds: string[]
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (!enrollmentIds.length) return ok({ payments: [] });
      const res = await client.query(
        `SELECT ${PAYMENT_COLS} FROM professional_payments p
         WHERE p.tenant_id = $1
           AND p.order_id IN (
             SELECT order_id FROM professional_enrollments WHERE id = ANY($2::uuid[]) AND tenant_id = $1
           )
         ORDER BY p.created_at`,
        [tenantId, enrollmentIds]
      );
      return ok({ payments: res.rows });
    });
  }

  /** Reçu d'un paiement confirmé appartenant à l'étudiant authentifié. */
  async getReceipt(
    tenantId: string,
    userId: string,
    paymentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      const res = await client.query(
        `SELECT p.id, p.receipt_number, p.receipt_url,
                p.montant::float8 AS montant, p.mode, p.statut, p.paid_at,
                o.reference AS order_reference
         FROM professional_payments p
         JOIN professional_orders o ON o.id = p.order_id
         WHERE p.id=$1 AND o.student_id=$2`,
        [paymentId, studentId]
      );
      if (res.rowCount === 0) return fail("NOT_FOUND", "Reçu introuvable.");
      if (res.rows[0].statut !== "confirme") {
        return fail("NOT_FOUND", "Reçu indisponible : le paiement n'est pas confirmé.");
      }
      return ok(res.rows[0]);
    });
  }

  /** Liste des paiements professionnels (vue admin) avec filtres et pagination. */
  async adminListPayments(
    tenantId: string,
    filters: { statut?: string; order_id?: string; page?: number; pageSize?: number }
  ): Promise<ServiceResult<any>> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ["p.tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;
      if (filters.statut) {
        where.push(`p.statut = $${i++}`);
        params.push(filters.statut);
      }
      if (filters.order_id) {
        where.push(`p.order_id = $${i++}`);
        params.push(filters.order_id);
      }
      const whereSql = where.join(" AND ");
      const countRes = await client.query(
        `SELECT count(*)::int AS total FROM professional_payments p WHERE ${whereSql}`,
        params
      );
      const listRes = await client.query(
        `SELECT p.id, p.order_id, p.montant::float8 AS montant, p.mode, p.statut,
                p.reference_transaction, p.paid_at, p.receipt_number, p.created_at,
                o.reference AS order_reference
         FROM professional_payments p
         JOIN professional_orders o ON o.id = p.order_id
         WHERE ${whereSql}
         ORDER BY p.created_at DESC, p.id LIMIT $${i++} OFFSET $${i++}`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return ok({ items: listRes.rows, total: countRes.rows[0].total, page, pageSize });
    });
  }
}
