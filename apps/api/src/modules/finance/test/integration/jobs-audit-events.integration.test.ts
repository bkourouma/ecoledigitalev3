import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import {
  changeScholarshipStatus,
  createDiscount,
  createFee,
  createFeeSchedule,
  deactivateSchedule,
  getLearnerFunding,
  listDiscountCatalog,
  listFeeCatalog,
  listInstallmentPlans,
  listSchedules,
  resolveFeeAmount,
  setFeeStatus,
} from "../../application/catalog";
import { getMyOpenSession, listRegisters, listSessionPage, getCashSessionSummary } from "../../application/cash";
import { createFinanceDeps } from "../../application/deps";
import { markOverdueForAllTenants } from "../../application/jobs";
import { getInvoiceById, issueInvoiceFromSchedule, cancelInvoice, issueCreditNote } from "../../application/invoices";
import { listPaymentPage, listReceiptPage, recordManualPayment } from "../../application/payments";
import { approveRefund, getRefundById, listRefundPage, requestRefund } from "../../application/refunds";
import { closeCashSession } from "../../application/cash";
import type { AuditEntry, AuditPort } from "../../application/ports/audit";
import { ALL_FINANCE_EVENT_TYPES } from "../../domain/events";
import { adminOne, adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, openCashier, pay, seedCatalog, simpleInvoice, tuitionInvoice, xof, YEAR } from "../support/scenario";

describeIntegration("tâches planifiées, audit atomique, événements outbox, catalogue (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;

  beforeAll(async () => {
    db = await createFinanceTestDb();
    world = makeWorld(db);
  });
  afterAll(async () => {
    await db.drop();
  });

  describe("tâche des retards (SystemDb.forEachTenant)", () => {
    it("traite chaque tenant dans sa transaction, avec l'acteur système ; second passage sans effet", async () => {
      const w = makeWorld(db);
      const [t1, t2, t3] = [await db.createTenant(), await db.createTenant(), await db.createTenant()];
      const invoices: Record<string, string> = {};
      for (const t of [t1, t2, t3]) {
        const c = ctxFor(t);
        await seedCatalog(w.deps, c);
        if (t !== t3) invoices[t] = (await tuitionInvoice(w.deps, c, learnerId())).invoice.id;
      }
      // t3 : facture à échéance lointaine
      await simpleInvoice(w.deps, ctxFor(t3), learnerId(), 10_000, "2026-12-31");

      w.clock.set("2025-09-05T08:00:00.000Z");
      const first = await markOverdueForAllTenants(w.deps, db.systemDb);
      expect(first.failed).toEqual([]);
      const byTenant = new Map(first.succeeded.map((s) => [s.tenantId, s.result]));
      expect(byTenant.get(t1)!.invoiceIds).toEqual([invoices[t1]]);
      expect(byTenant.get(t2)!.invoiceIds).toEqual([invoices[t2]]);
      expect(byTenant.get(t3)!.invoiceIds).toEqual([]);

      for (const t of [t1, t2]) {
        const [ev] = await adminRows<{ actor_id: string | null; tenant_id: string; payload: { invoiceId: string } }>(
          db,
          "SELECT actor_id, tenant_id, payload FROM kernel.domain_events WHERE type = 'finance.invoice.overdue' AND tenant_id = $1",
          [t],
        );
        expect(ev).toMatchObject({ actor_id: null, tenant_id: t });
        expect(ev!.payload.invoiceId).toBe(invoices[t]);
      }
      expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.invoice.overdue' AND tenant_id = $1", [t3])).toHaveLength(0);

      const second = await markOverdueForAllTenants(w.deps, db.systemDb);
      expect(second.succeeded.flatMap((s) => s.result.invoiceIds)).toEqual([]);
      expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.invoice.overdue'")).toHaveLength(2);
    });
  });

  describe("audit : écrit dans la MÊME transaction que l'opération", () => {
    class ExplodingAudit implements AuditPort {
      constructor(private readonly explodeOn: string) {}
      readonly seen: string[] = [];
      async record(_tx: Tx, _ctx: RequestContext, entry: AuditEntry): Promise<void> {
        this.seen.push(entry.action);
        if (entry.action === this.explodeOn) throw new Error("journal d'audit indisponible");
      }
    }

    it("si l'audit échoue, TOUT est annulé : paiement, reçu, imputations, numéro, événements", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const audit = new ExplodingAudit("finance.payment.completed");
      const w = makeWorld(db);
      const deps = createFinanceDeps({ db: db.tenantDb, clock: w.clock, audit, providers: w.providers, config: { environment: "test" } });
      await seedCatalog(deps, c);
      const learner = learnerId();
      await simpleInvoice(deps, c, learner, 100_000);
      const eventsBefore = (await adminOne<{ n: number }>(db, "SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1", [t])).n;

      await expect(pay(deps, c, learner, 40_000)).rejects.toThrow("journal d'audit indisponible");
      expect(audit.seen).toContain("finance.payment.completed");

      expect(await adminRows(db, "SELECT 1 FROM finance.payments WHERE tenant_id = $1", [t])).toHaveLength(0);
      expect(await adminRows(db, "SELECT 1 FROM finance.receipts WHERE tenant_id = $1", [t])).toHaveLength(0);
      expect(await adminRows(db, "SELECT 1 FROM finance.payment_allocations WHERE tenant_id = $1", [t])).toHaveLength(0);
      expect(await adminRows(db, "SELECT 1 FROM finance.number_sequences WHERE tenant_id = $1 AND kind = 'RECEIPT'", [t])).toHaveLength(0);
      const eventsAfter = (await adminOne<{ n: number }>(db, "SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1", [t])).n;
      expect(eventsAfter).toBe(eventsBefore);
      const inv = await adminOne<{ paid_amount: string }>(db, "SELECT paid_amount::text FROM finance.invoices WHERE tenant_id = $1", [t]);
      expect(inv.paid_amount).toBe("0");

      // l'audit rétabli, le même numéro 1 est attribué
      const healthy = createFinanceDeps({ db: db.tenantDb, clock: w.clock, providers: w.providers, config: { environment: "test" } });
      expect(unwrap(await pay(healthy, c, learner, 40_000)).receipt!.number).toBe("REC-2025-000001");
    });

    it("opérations sensibles auditées avec les bons marqueurs", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const approver = ctxFor(t);
      const w = makeWorld(db);
      await seedCatalog(w.deps, c);
      const learner = learnerId();
      const inv = await simpleInvoice(w.deps, c, learner, 100_000);
      const view = unwrap(await pay(w.deps, c, learner, 50_000));
      const r = unwrap(await requestRefund(w.deps, c, { paymentId: view.payment.id, amount: xof(10_000), reason: "Erreur de saisie" }));
      unwrap(await approveRefund(w.deps, approver, { refundId: r.id }));
      unwrap(await issueCreditNote(w.deps, c, { invoiceId: inv.invoice.id, amount: xof(10_000), reason: "Remise accordée" }));
      const other = await simpleInvoice(w.deps, c, learnerId(), 20_000);
      unwrap(await cancelInvoice(w.deps, c, { invoiceId: other.invoice.id, reason: "Facture en double" }));
      const { session } = await openCashier(w.deps, c, 0, "AUDIT");
      unwrap(await closeCashSession(w.deps, c, { sessionId: session.id, countedAmount: xof(0) }));

      const byAction = new Map(w.audit.entries.map((e) => [e.entry.action, e]));
      for (const action of [
        "finance.fee.created",
        "finance.fee_schedule.created",
        "finance.invoice.created",
        "finance.invoice.issued",
        "finance.payment.completed",
        "finance.refund.requested",
        "finance.refund.approved",
        "finance.refund.completed",
        "finance.credit_note.issued",
        "finance.invoice.cancelled",
        "finance.cash_register.created",
        "finance.cash_session.opened",
        "finance.cash_session.closed",
      ]) {
        expect(byAction.has(action), action).toBe(true);
      }
      for (const sensitive of ["finance.refund.requested", "finance.refund.approved", "finance.refund.completed", "finance.credit_note.issued", "finance.invoice.cancelled"]) {
        expect(byAction.get(sensitive)!.entry.sensitive, sensitive).toBe(true);
      }
      // l'acteur est celui du contexte de la transaction
      expect(byAction.get("finance.refund.approved")!.ctx.userId).toBe(approver.userId);
      expect(byAction.get("finance.refund.requested")!.ctx.userId).toBe(c.userId);
      // le format des actions respecte la convention du module audit (entité.verbe) et les ressources sont en snake_case
      for (const { entry } of w.audit.entries) {
        expect(entry.action).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
        expect(entry.resourceType).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(entry.resourceId).toBeTruthy();
      }
    });
  });

  describe("événements outbox", () => {
    it("tous versionnés {v:1}, rattachés à un agrégat, au bon tenant, dans le catalogue du manifeste", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const boss = ctxFor(t);
      const w = makeWorld(db);
      await seedCatalog(w.deps, c);
      await openCashier(w.deps, boss, 5_000, "EVT");
      const learner = learnerId();
      const inv = await tuitionInvoice(w.deps, c, learner);
      const view = unwrap(await pay(w.deps, boss, learner, 120_000, { method: "CASH", reference: undefined }));
      const r = unwrap(await requestRefund(w.deps, c, { paymentId: view.payment.id, amount: xof(10_000), reason: "Erreur de saisie" }));
      const approver = ctxFor(t);
      await openCashier(w.deps, approver, 0, "EVT2");
      unwrap(await approveRefund(w.deps, approver, { refundId: r.id }));
      unwrap(await issueCreditNote(w.deps, c, { invoiceId: inv.invoice.id, amount: xof(10_000), reason: "Remise accordée" }));

      const events = await adminRows<{
        type: string;
        version: number;
        aggregate_type: string | null;
        aggregate_id: string | null;
        actor_id: string | null;
        request_id: string | null;
        payload: Record<string, any>;
        published_at: string | null;
      }>(db, "SELECT type, version, aggregate_type, aggregate_id, actor_id, request_id, payload, published_at FROM kernel.domain_events WHERE tenant_id = $1 ORDER BY id", [t]);
      expect(events.length).toBeGreaterThan(8);
      for (const e of events) {
        expect(ALL_FINANCE_EVENT_TYPES as readonly string[], e.type).toContain(e.type);
        expect(e.version).toBe(1);
        expect(e.payload.v, e.type).toBe(1);
        expect(e.aggregate_type, e.type).toBeTruthy();
        expect(e.aggregate_id, e.type).toBeTruthy();
        expect(e.actor_id, e.type).toBeTruthy();
        expect(e.request_id, e.type).toBeTruthy();
        expect(e.published_at).toBeNull(); // le relais les publiera
      }
      const types = new Set(events.map((e) => e.type));
      for (const expected of [
        "finance.invoice.issued",
        "finance.payment.completed",
        "finance.payment.allocated",
        "finance.receipt.issued",
        "finance.refund.requested",
        "finance.refund.completed",
        "finance.credit_note.issued",
        "finance.cash_session.opened",
      ]) {
        expect(types.has(expected), expected).toBe(true);
      }
      const completed = events.find((e) => e.type === "finance.payment.completed")!;
      expect(completed.payload).toMatchObject({
        paymentId: view.payment.id,
        learnerId: learner,
        method: "CASH",
        amount: { amount: 120_000, currency: "XOF" },
        receiptNumber: view.receipt!.number,
        unallocated: { amount: 0, currency: "XOF" },
      });
      expect(completed.payload.allocations.reduce((a: number, x: { amount: number }) => a + x.amount, 0)).toBe(120_000);
      const issued = events.find((e) => e.type === "finance.invoice.issued")!;
      expect(issued.payload).toMatchObject({ invoiceId: inv.invoice.id, number: inv.invoice.number, total: { amount: 500_000, currency: "XOF" }, payerKind: "LEARNER" });
      // un seul événement de chaque type pour une action unique
      expect(events.filter((e) => e.type === "finance.payment.completed")).toHaveLength(1);
      expect(events.filter((e) => e.type === "finance.receipt.issued")).toHaveLength(1);
    });
  });

  describe("catalogue et listes", () => {
    it("désactiver un frais ou un barème les retire de la facturation", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const w = makeWorld(db);
      const cat = await seedCatalog(w.deps, c);

      const fees = unwrap(await listFeeCatalog(w.deps, c));
      expect(fees.map((f) => f.code).sort()).toEqual(["CANT", "INSC", "SCOL"]);
      expect(unwrap(await listFeeCatalog(w.deps, c, { category: "CANTEEN" })).map((f) => f.code)).toEqual(["CANT"]);

      unwrap(await setFeeStatus(w.deps, c, { feeId: cat.canteen.id, active: false }));
      expect(unwrap(await listFeeCatalog(w.deps, c, { activeOnly: true })).map((f) => f.code).sort()).toEqual(["INSC", "SCOL"]);
      const refused = await issueInvoiceFromSchedule(w.deps, c, { learnerId: learnerId(), academicYear: YEAR, items: [{ feeCode: "CANT" }] });
      expect(refused.ok).toBe(false);
      unwrap(await setFeeStatus(w.deps, c, { feeId: cat.canteen.id, active: true }));
      expect((await issueInvoiceFromSchedule(w.deps, c, { learnerId: learnerId(), academicYear: YEAR, items: [{ feeCode: "CANT" }] })).ok).toBe(true);
      expect((await setFeeStatus(w.deps, c, { feeId: newId(), active: true })).ok).toBe(false);

      const schedules = unwrap(await listSchedules(w.deps, c, { feeId: cat.tuition.id }));
      expect(schedules).toHaveLength(1);
      unwrap(await deactivateSchedule(w.deps, c, cat.tuitionSchedule.id));
      expect(unwrap(await listSchedules(w.deps, c, { feeId: cat.tuition.id, activeOnly: true }))).toHaveLength(0);
      const gone = await resolveFeeAmount(w.deps, c, { feeId: cat.tuition.id, academicYear: YEAR, onDate: "2025-09-01" });
      expect(gone.ok).toBe(false);
      expect((await deactivateSchedule(w.deps, c, newId())).ok).toBe(false);
      // un nouveau barème peut alors couvrir la même période
      const again = await createFeeSchedule(w.deps, c, { feeId: cat.tuition.id, academicYear: YEAR, amount: xof(520_000), effectiveFrom: "2025-06-01" });
      expect(again.ok).toBe(true);
    });

    it("devise du barème = devise du frais ; plan inconnu refusé ; code de frais unique par tenant", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const w = makeWorld(db);
      const fee = unwrap(await createFee(w.deps, c, { code: "X1", name: "Frais X", category: "OTHER" }));
      const eur = await createFeeSchedule(w.deps, c, {
        feeId: fee.id,
        academicYear: YEAR,
        amount: (await import("@ecoledigitale/kernel")).Money.of(1000, "EUR"),
        effectiveFrom: "2025-06-01",
      });
      expect(eur.ok).toBe(false);
      const badPlan = await createFeeSchedule(w.deps, c, { feeId: fee.id, academicYear: YEAR, amount: xof(1000), effectiveFrom: "2025-06-01", planId: newId() });
      expect(badPlan.ok).toBe(false);
      expect((await createFee(w.deps, c, { code: "x1", name: "Doublon", category: "OTHER" })).ok).toBe(false);
      expect(unwrap(await listInstallmentPlans(w.deps, c))).toEqual([]);
      expect(unwrap(await listDiscountCatalog(w.deps, c))).toEqual([]);
      unwrap(await createDiscount(w.deps, c, { code: "d1", name: "D1", kind: "AMOUNT", amount: xof(500) }));
      expect(unwrap(await listDiscountCatalog(w.deps, c)).map((d) => d.code)).toEqual(["D1"]);
      expect((await createDiscount(w.deps, c, { code: "D1", name: "Doublon", kind: "AMOUNT", amount: xof(500) })).ok).toBe(false);
    });

    it("compte de financement par défaut PRIVATE ; statut de bourse inconnu refusé", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const w = makeWorld(db);
      const funding = unwrap(await getLearnerFunding(w.deps, c, learnerId()));
      expect(funding.account.fundingType).toBe("PRIVATE");
      expect(funding.scholarships).toEqual([]);
      expect((await changeScholarshipStatus(w.deps, c, { scholarshipId: newId(), status: "ENDED" })).ok).toBe(false);
      expect((await changeScholarshipStatus(w.deps, c, { scholarshipId: newId(), status: "BOF" as never })).ok).toBe(false);
    });

    it("listes de paiements, reçus, remboursements, caisses et sessions", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const approver = ctxFor(t);
      const w = makeWorld(db);
      await seedCatalog(w.deps, c);
      const { register, session } = await openCashier(w.deps, c, 1_000, "LIST");
      const l1 = learnerId();
      const l2 = learnerId();
      await simpleInvoice(w.deps, c, l1, 50_000);
      await simpleInvoice(w.deps, c, l2, 50_000);
      const p1 = unwrap(await pay(w.deps, c, l1, 20_000, { method: "CASH", reference: undefined }));
      unwrap(await pay(w.deps, c, l2, 10_000));
      unwrap(await pay(w.deps, c, l2, 5_000, { method: "CHEQUE", reference: "CHQ-1" }));

      expect(unwrap(await listPaymentPage(w.deps, c)).total).toBe(3);
      expect(unwrap(await listPaymentPage(w.deps, c, { learnerId: l2 })).total).toBe(2);
      expect(unwrap(await listPaymentPage(w.deps, c, { method: "CASH" })).items.map((p) => p.id)).toEqual([p1.payment.id]);
      expect(unwrap(await listPaymentPage(w.deps, c, { status: "FAILED" })).total).toBe(0);
      expect(unwrap(await listPaymentPage(w.deps, c, { limit: 1, offset: 1 })).items).toHaveLength(1);
      expect(unwrap(await listPaymentPage(w.deps, c, { from: "2030-01-01T00:00:00.000Z" })).total).toBe(0);
      expect(unwrap(await listReceiptPage(w.deps, c)).total).toBe(3);
      expect(unwrap(await listReceiptPage(w.deps, c, { learnerId: l1 })).items).toHaveLength(1);

      await openCashier(w.deps, approver, 0, "LIST2");
      const r = unwrap(await requestRefund(w.deps, c, { paymentId: p1.payment.id, amount: xof(2_000), reason: "Erreur de caisse" }));
      expect(unwrap(await listRefundPage(w.deps, c, { status: "REQUESTED" }))).toHaveLength(1);
      unwrap(await approveRefund(w.deps, approver, { refundId: r.id }));
      expect(unwrap(await listRefundPage(w.deps, c, { paymentId: p1.payment.id }))[0]!.status).toBe("COMPLETED");
      expect(unwrap(await getRefundById(w.deps, c, r.id)).id).toBe(r.id);
      expect((await getRefundById(w.deps, c, newId())).ok).toBe(false);

      expect(unwrap(await listRegisters(w.deps, c)).map((x) => x.code).sort()).toEqual(["LIST", "LIST2"]);
      expect(unwrap(await getMyOpenSession(w.deps, c))?.id).toBe(session.id);
      expect(unwrap(await listSessionPage(w.deps, c, { registerId: register.id }))).toHaveLength(1);
      expect(unwrap(await listSessionPage(w.deps, c, { status: "OPEN" }))).toHaveLength(2);
      expect(unwrap(await listSessionPage(w.deps, c, { status: "CLOSED" }))).toHaveLength(0);
      expect((await getCashSessionSummary(w.deps, c, newId())).ok).toBe(false);
      expect(unwrap(await getMyOpenSession(w.deps, ctxFor(t)))).toBeNull();
      const inv = await getInvoiceById(w.deps, c, newId());
      expect(inv.ok).toBe(false);
    });
  });

  it("un enregistrement manuel rejette une clé d'idempotence trop courte avant toute écriture", async () => {
    const t = await db.createTenant();
    const c = ctxFor(t);
    const r = await recordManualPayment(world.deps, c, { idempotencyKey: "abc", learnerId: learnerId(), amount: xof(1_000), method: "TRANSFER", reference: "x" });
    expect(r.ok).toBe(false);
    expect(await adminRows(db, "SELECT 1 FROM finance.payments WHERE tenant_id = $1", [t])).toHaveLength(0);
  });
});
