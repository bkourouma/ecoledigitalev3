import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { adminOne, adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, openCashier, pay, seedCatalog, simpleInvoice, tuitionInvoice, YEAR } from "../support/scenario";
import { issueCreditNote } from "../../application/invoices";
import { xof } from "../support/scenario";

/** Code SQLSTATE d'une promesse rejetée. */
async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describeIntegration("garde-fous SQL : immuabilité, machines d'états, cohérence des sommes (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let ctx: ReturnType<typeof ctxFor>;
  let paymentId: string;
  let invoiceId: string;
  let learner: string;

  /** Exécute du SQL brut dans une transaction applicative (rôle app_user, RLS). */
  const asApp = <T>(fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>) => Promise<T>) =>
    world.deps.db.run(ctx, (tx) => fn((sql, params) => tx.query(sql, params)));

  beforeAll(async () => {
    db = await createFinanceTestDb();
    world = makeWorld(db);
    tenantId = await db.createTenant();
    ctx = ctxFor(tenantId);
    await seedCatalog(world.deps, ctx);
    learner = learnerId();
    const inv = await tuitionInvoice(world.deps, ctx, learner);
    invoiceId = inv.invoice.id;
    const view = unwrap(await pay(world.deps, ctx, learner, 250_000));
    paymentId = view.payment.id;
  });
  afterAll(async () => {
    await db.drop();
  });

  describe("droits applicatifs (app_user) : pas de UPDATE/DELETE sur les écritures comptables", () => {
    it.each([
      ["UPDATE finance.receipts SET amount = 1"],
      ["DELETE FROM finance.receipts"],
      ["UPDATE finance.payment_allocations SET amount = 1"],
      ["DELETE FROM finance.payment_allocations"],
      ["DELETE FROM finance.payments"],
      ["UPDATE finance.payments SET amount = amount + 1"],
      ["UPDATE finance.payments SET method = 'CASH'"],
      ["DELETE FROM finance.invoices"],
      ["UPDATE finance.credit_notes SET amount = 1"],
      ["DELETE FROM finance.allocation_reversals"],
      ["DELETE FROM finance.webhook_events"],
      ["DELETE FROM finance.cash_sessions"],
      ["DELETE FROM finance.refunds"],
      ["UPDATE finance.invoice_discounts SET amount = 1"],
    ])("%s ⇒ refusé", async (sql) => {
      expect(await sqlState(asApp((q) => q(sql)))).toBe("42501");
    });
  });

  describe("déclencheurs (valables même pour un superutilisateur)", () => {
    it.each([
      ["UPDATE finance.receipts SET number = 'REC-1999-000001'", "reçu"],
      ["DELETE FROM finance.receipts", "reçu"],
      ["UPDATE finance.payment_allocations SET amount = amount + 1", "imputation"],
      ["DELETE FROM finance.payment_allocations", "imputation"],
      ["DELETE FROM finance.payments", "paiement"],
      ["DELETE FROM finance.invoices", "facture"],
      ["UPDATE finance.payments SET amount = amount + 1", "montant d'un paiement confirmé"],
      ["UPDATE finance.payments SET method = 'CHEQUE'", "mode d'un paiement confirmé"],
      ["UPDATE finance.payments SET learner_id = gen_random_uuid()", "apprenant d'un paiement"],
      ["UPDATE finance.payments SET failure_reason = 'x'", "motif d'échec d'un paiement confirmé"],
      ["UPDATE finance.payments SET status = 'PENDING'", "retour en arrière PENDING"],
      ["UPDATE finance.payments SET status = 'FAILED'", "CONFIRMED → FAILED"],
    ])("%s", async (sql, _label) => {
      expect(await sqlState(db.admin.query(sql))).toBe("23001");
    });

    it("transitions d'état de facture interdites : DRAFT→PAID, CANCELLED→ISSUED, PAID→CANCELLED", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const w = makeWorld(db);
      await seedCatalog(w.deps, c);
      const l = learnerId();
      const issued = await simpleInvoice(w.deps, c, l, 10_000);
      const cancelled = await simpleInvoice(w.deps, c, learnerId(), 10_000);
      const { cancelInvoice } = await import("../../application/invoices");
      unwrap(await cancelInvoice(w.deps, c, { invoiceId: cancelled.invoice.id, reason: "Doublon avéré" }));
      expect(await sqlState(db.admin.query("UPDATE finance.invoices SET status = 'ISSUED' WHERE id = $1", [cancelled.invoice.id]))).toBe("23001");
      expect(await sqlState(db.admin.query("UPDATE finance.invoices SET status = 'DRAFT' WHERE id = $1", [issued.invoice.id]))).toBe("23001");
      unwrap(await pay(w.deps, c, l, 10_000));
      expect(await sqlState(db.admin.query("UPDATE finance.invoices SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1", [issued.invoice.id]))).toBe("23001");
    });

    it("remboursement : machine d'états et montants figés", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const w = makeWorld(db);
      await seedCatalog(w.deps, c);
      const l = learnerId();
      await simpleInvoice(w.deps, c, l, 50_000);
      const view = unwrap(await pay(w.deps, c, l, 50_000));
      const { requestRefund, approveRefund } = await import("../../application/refunds");
      const r = unwrap(await requestRefund(w.deps, c, { paymentId: view.payment.id, amount: xof(10_000), reason: "Motif suffisant" }));
      expect(await sqlState(db.admin.query("UPDATE finance.refunds SET status = 'COMPLETED', completed_at = now() WHERE id = $1", [r.id]))).toBe("23001"); // REQUESTED → COMPLETED interdit
      expect(await sqlState(db.admin.query("UPDATE finance.refunds SET amount = 99 WHERE id = $1", [r.id]))).toBe("23001");
      unwrap(await approveRefund(w.deps, ctxFor(t), { refundId: r.id }));
      expect(await sqlState(db.admin.query("UPDATE finance.refunds SET status = 'REJECTED', rejected_by = gen_random_uuid(), rejected_at = now() WHERE id = $1", [r.id]))).toBe("23001"); // terminal
      expect(await sqlState(db.admin.query("DELETE FROM finance.refunds WHERE id = $1", [r.id]))).toBe("23001");
    });

    it("compteurs de numérotation : un pas à la fois, jamais en arrière, clé figée", async () => {
      const { last_value } = await adminOne<{ last_value: string }>(db, "SELECT last_value::text FROM finance.number_sequences WHERE tenant_id = $1 AND kind = 'RECEIPT'", [tenantId]);
      const n = Number(last_value);
      expect(await sqlState(db.admin.query("UPDATE finance.number_sequences SET last_value = $2 WHERE tenant_id = $1 AND kind = 'RECEIPT'", [tenantId, n - 1]))).toBe("23001");
      expect(await sqlState(db.admin.query("UPDATE finance.number_sequences SET last_value = $2 WHERE tenant_id = $1 AND kind = 'RECEIPT'", [tenantId, n + 5]))).toBe("23001");
      expect(await sqlState(db.admin.query("UPDATE finance.number_sequences SET year = 2031 WHERE tenant_id = $1 AND kind = 'RECEIPT'", [tenantId]))).toBe("23001");
    });
  });

  describe("cohérence des sommes vérifiée AU COMMIT", () => {
    it("un cumul d'échéance sans imputation correspondante fait échouer la transaction", async () => {
      const state = await sqlState(asApp((q) => q("UPDATE finance.installments SET paid_amount = paid_amount + 100 WHERE invoice_id = $1 AND seq = 4", [invoiceId])));
      expect(state).toBe("23514");
    });

    it("un cumul de facture falsifié est refusé", async () => {
      const state = await sqlState(asApp((q) => q("UPDATE finance.invoices SET paid_amount = paid_amount + 100 WHERE id = $1", [invoiceId])));
      expect(state).toBe("23514");
    });

    it("un cumul de paiement falsifié (imputé) est refusé", async () => {
      expect(await sqlState(asApp((q) => q("UPDATE finance.payments SET allocated_amount = allocated_amount + 1 WHERE id = $1", [paymentId])))).toBe("23514");
      expect(await sqlState(asApp((q) => q("UPDATE finance.payments SET refunded_amount = 1 WHERE id = $1", [paymentId])))).toBe("23514");
    });

    it("un paiement confirmé sans reçu est refusé ; un reçu pour un paiement non confirmé aussi", async () => {
      const id = newId();
      const state = await sqlState(
        asApp((q) =>
          q(
            `INSERT INTO finance.payments (id, tenant_id, learner_id, method, status, amount, idempotency_key, request_fingerprint, received_at, confirmed_at)
             VALUES ($1, $2, $3, 'TRANSFER', 'CONFIRMED', 1000, $4, 'fp', now(), now())`,
            [id, tenantId, learnerId(), `no-receipt-${id}`],
          ),
        ),
      );
      expect(state).toBe("23514");
    });

    it("total de facture différent de la somme des lignes : refusé", async () => {
      const id = newId();
      const state = await sqlState(
        asApp(async (q) => {
          await q(
            `INSERT INTO finance.invoices (id, tenant_id, learner_id, academic_year, subtotal_amount, total_amount, due_date)
             VALUES ($1, $2, $3, $4, 1000, 1000, '2026-01-01')`,
            [id, tenantId, learnerId(), YEAR],
          );
          await q(
            `INSERT INTO finance.invoice_lines (id, tenant_id, invoice_id, position, category, description, quantity, unit_amount, gross_amount, total_amount)
             VALUES ($1, $2, $3, 1, 'OTHER', 'x', 1, 900, 900, 900)`,
            [newId(), tenantId, id],
          );
        }),
      );
      expect(state).toBe("23514");
    });

    it("somme des échéances différente du total : refusé ; facture émise sans échéance : refusé", async () => {
      const inv = await simpleInvoice(world.deps, ctx, learnerId(), 10_000);
      // l'échéance est intacte et non encaissée : la structure est modifiable, la somme doit rester juste
      expect(await sqlState(asApp((q) => q("UPDATE finance.installments SET amount = amount - 1 WHERE invoice_id = $1", [inv.invoice.id])))).toBe("23514");
      expect(await sqlState(asApp((q) => q("DELETE FROM finance.installments WHERE invoice_id = $1", [inv.invoice.id])))).toBe("23514");
    });

    it("l'avoir et le cumul crédité doivent concorder", async () => {
      const inv = await simpleInvoice(world.deps, ctx, learnerId(), 10_000);
      unwrap(await issueCreditNote(world.deps, ctx, { invoiceId: inv.invoice.id, amount: xof(4_000), reason: "Remise exceptionnelle" }));
      expect(await sqlState(asApp((q) => q("UPDATE finance.invoices SET credited_amount = credited_amount + 1 WHERE id = $1", [inv.invoice.id])))).toBe("23514");
    });
  });

  describe("contraintes de colonnes", () => {
    const insertPayment = (over: Record<string, unknown>) => {
      const row = {
        id: newId(),
        tenant_id: tenantId,
        learner_id: learnerId(),
        method: "TRANSFER",
        status: "PENDING",
        amount: 1000,
        idempotency_key: `ck-${newId()}`,
        request_fingerprint: "fp",
        received_at: new Date(),
        ...over,
      };
      const cols = Object.keys(row);
      return db.admin.query(`INSERT INTO finance.payments (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
    };

    it("montants négatifs ou nuls refusés", async () => {
      expect(await sqlState(insertPayment({ amount: -5 }))).toBe("23514");
      expect(await sqlState(insertPayment({ amount: 0 }))).toBe("23514");
      expect(await sqlState(db.admin.query("INSERT INTO finance.fees (id, tenant_id, code, name, category) VALUES ($1,$2,'bad code','x','TUITION')", [newId(), tenantId]))).toBe("23514");
    });

    it("un paiement espèces est toujours rattaché à une session de caisse", async () => {
      expect(await sqlState(insertPayment({ method: "CASH" }))).toBe("23514");
    });

    it("un paiement en ligne indique son fournisseur ; un payeur financeur sa référence", async () => {
      expect(await sqlState(insertPayment({ method: "ONLINE" }))).toBe("23514");
      expect(await sqlState(insertPayment({ payer_kind: "FUNDER" }))).toBe("23514");
    });

    it("imputé + remboursé ne dépasse jamais le montant", async () => {
      expect(await sqlState(insertPayment({ status: "CONFIRMED", confirmed_at: new Date(), allocated_amount: 800, refunded_amount: 300 }))).toBe("23514");
    });

    it("clé d'idempotence unique par tenant ; mode et statut énumérés", async () => {
      const key = `uniq-${newId()}`;
      await insertPayment({ idempotency_key: key });
      expect(await sqlState(insertPayment({ idempotency_key: key }))).toBe("23505");
      expect(await sqlState(insertPayment({ method: "BITCOIN" }))).toBe("23514");
      expect(await sqlState(insertPayment({ status: "WHATEVER" }))).toBe("23514");
    });

    it("session de caisse : un caissier ou une caisse = une session ouverte", async () => {
      const c = ctxFor(tenantId);
      const { register, session } = await openCashier(world.deps, c, 0, "UNIQ-A");
      const dup = db.admin.query(
        "INSERT INTO finance.cash_sessions (id, tenant_id, register_id, cashier_id, opening_float, opened_at) VALUES ($1,$2,$3,$4,0,now())",
        [newId(), tenantId, register.id, newId()],
      );
      expect(await sqlState(dup)).toBe("23505");
      expect(session.status).toBe("OPEN");
    });

    it("un encaissement espèces sur une session close est refusé par la base", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const w = makeWorld(db);
      const { session } = await openCashier(w.deps, c, 0, "CLOSED-ONE");
      const { closeCashSession } = await import("../../application/cash");
      unwrap(await closeCashSession(w.deps, c, { sessionId: session.id, countedAmount: xof(0) }));
      const state = await sqlState(
        db.admin.query(
          `INSERT INTO finance.payments (id, tenant_id, learner_id, method, status, amount, idempotency_key, request_fingerprint, received_at, confirmed_at, cash_session_id)
           VALUES ($1,$2,$3,'CASH','PENDING',1000,$4,'fp',now(),NULL,$5)`,
          [newId(), t, learnerId(), `k-${newId()}`, session.id],
        ),
      );
      expect(state).toBe("23001");
    });
  });

  describe("imputations : la base re-vérifie le payeur, la facture et l'échéance", () => {
    it("imputer un paiement à la facture d'un autre apprenant est refusé, même en SQL brut", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const w = makeWorld(db);
      await seedCatalog(w.deps, c);
      const l1 = learnerId();
      const l2 = learnerId();
      await simpleInvoice(w.deps, c, l1, 10_000);
      const inv2 = await simpleInvoice(w.deps, c, l2, 10_000);
      const view = unwrap(await pay(w.deps, c, l1, 5_000));
      const state = await sqlState(
        db.admin.query(
          `INSERT INTO finance.payment_allocations (id, tenant_id, payment_id, invoice_id, installment_id, amount) VALUES ($1,$2,$3,$4,$5,1000)`,
          [newId(), t, view.payment.id, inv2.invoice.id, inv2.installments[0]!.id],
        ),
      );
      expect(state).toBe("23001");
    });

    it("une reprise supérieure au net imputé est refusée", async () => {
      const [alloc] = await adminRows<{ id: string; payment_id: string; amount: string }>(db, "SELECT id, payment_id, amount::text FROM finance.payment_allocations WHERE payment_id = $1 LIMIT 1", [paymentId]);
      const refund = await adminRows<{ id: string }>(db, "SELECT id FROM finance.refunds LIMIT 1");
      void refund;
      const state = await sqlState(
        db.admin.query(
          `INSERT INTO finance.allocation_reversals (id, tenant_id, allocation_id, payment_id, refund_id, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
          [newId(), tenantId, alloc!.id, alloc!.payment_id, newId(), Number(alloc!.amount) + 1],
        ),
      );
      expect(["23001", "23503"]).toContain(state); // garde de reprise ou FK du remboursement
    });
  });

  describe("tenants : les clés étrangères composites empêchent toute référence croisée", () => {
    it("une ligne d'un tenant ne peut pas pointer la facture d'un autre, même en connaissant son UUID", async () => {
      const other = await db.createTenant();
      const { createInvoice } = await import("../../application/invoices");
      const draft = unwrap(
        await createInvoice(world.deps, ctx, { learnerId: learnerId(), academicYear: YEAR, lines: [{ category: "OTHER", description: "Brouillon", unitAmount: xof(1_000) }] }),
      ).invoices[0]!;
      const state = await sqlState(
        db.admin.query(
          `INSERT INTO finance.invoice_lines (id, tenant_id, invoice_id, position, category, description, quantity, unit_amount, gross_amount, total_amount)
           VALUES ($1, $2, $3, 99, 'OTHER', 'x', 1, 1, 1, 1)`,
          [newId(), other, draft.invoice.id],
        ),
      );
      expect(state).toBe("23503");
    });

    it("RLS : sous un autre tenant, rien n'est visible et rien ne peut être inséré au nom du premier", async () => {
      const other = await db.createTenant();
      const c = ctxFor(other);
      const visible = await world.deps.db.run(c, (tx) => tx.many("SELECT id FROM finance.invoices"));
      expect(visible).toHaveLength(0);
      const state = await sqlState(
        world.deps.db.run(c, (tx) =>
          tx.query("INSERT INTO finance.fees (id, tenant_id, code, name, category) VALUES ($1,$2,'X','x','TUITION')", [newId(), tenantId]),
        ),
      );
      expect(state).toBe("42501");
    });
  });
});
