import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId } from "@ecoledigitale/kernel";
import {
  financeAgedBalanceDtoSchema,
  financeCashSessionSummaryDtoSchema,
  financeDiscountDtoSchema,
  financeFeeDtoSchema,
  financeFeeScheduleDtoSchema,
  financeInvoiceDetailDtoSchema,
  financeInvoicePreviewDtoSchema,
  financeInvoicesResultDtoSchema,
  financeLearnerFundingDtoSchema,
  financeLearnerReceivableRowDtoSchema,
  financeLearnerStatementDtoSchema,
  financeOnlinePaymentDtoSchema,
  financePaymentViewDtoSchema,
  financePlanDtoSchema,
  financeReceiptDtoSchema,
  financeReceivableRowDtoSchema,
  financeRefundDtoSchema,
  financeScholarshipDtoSchema,
  financeSummaryDtoSchema,
  financeTrendPointDtoSchema,
} from "@ecoledigitale/contracts/src/v2/finance";
import manifest from "../../manifest";
import { FAMILY_PERMISSIONS } from "../../application/family";
import { financePlugin } from "../../http/plugin";
import { SANDBOX_PROVIDER_NAME, type SandboxProvider } from "../../infrastructure/providers/sandbox-provider";
import { createFinanceDeps } from "../../application/deps";
import { createFinanceTestDb, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";

const ALL_PERMISSIONS = manifest.permissions.map((p) => p.key);
const here = fileURLToPath(new URL(".", import.meta.url));

interface CallOptions {
  tenant?: string;
  user?: string | null;
  perms?: string[];
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

describeIntegration("API HTTP /api/v1/finance/* (Fastify + Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let app: FastifyInstance;
  let tenantId: string;
  let features: Set<string>;
  const accountant = newId();
  const director = newId();

  beforeAll(async () => {
    db = await createFinanceTestDb();
    world = makeWorld(db);
    tenantId = await db.createTenant();
    features = new Set(["finance.online-payment", "finance.installments", "finance.state-assigned"]);

    app = Fastify({ logger: false });
    // Authentification simulée : `request.ctx` posé en amont (module iam en production).
    app.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-test-tenant"];
      const user = req.headers["x-test-user"];
      if (typeof tenant === "string") {
        (req as unknown as { ctx: unknown }).ctx = createRequestContext({
          tenantId: tenant,
          userId: typeof user === "string" && user !== "" ? user : newId(),
          roles: [],
        });
      }
    });
    await app.register(financePlugin, {
      deps: createFinanceDeps({ db: db.tenantDb, clock: world.clock, providers: world.providers, enrollments: world.enrollments, config: { environment: "test", providerRefundAutoExecution: true } }),
      requirePermission: (permission) => async (req) => {
        const ctx = (req as unknown as { ctx?: unknown }).ctx;
        if (!ctx) throw new UnauthorizedError();
        const granted = String(req.headers["x-test-perms"] ?? "").split(",");
        if (!granted.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      isFeatureEnabled: async (_ctx, key) => features.has(key),
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  async function call(method: "GET" | "POST" | "PUT" | "PATCH", url: string, o: CallOptions = {}) {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.tenant !== "none") headers["x-test-tenant"] = o.tenant ?? tenantId;
    if (o.user !== null) headers["x-test-user"] = o.user ?? accountant;
    headers["x-test-perms"] = (o.perms ?? ALL_PERMISSIONS).join(",");
    let payload: string | undefined;
    if (o.rawBody !== undefined) payload = o.rawBody;
    else if (o.body !== undefined) payload = JSON.stringify(o.body);
    if (payload !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    const res = await app.inject({ method, url: `/api/v1/finance${url}`, headers, payload, query: o.query });
    let json: any;
    try {
      json = res.json();
    } catch {
      json = undefined;
    }
    return { status: res.statusCode, json, res };
  }

  describe("authentification, autorisation, erreurs", () => {
    it("401 sans contexte ; 403 sans la permission ; corps d'erreur normalisé", async () => {
      const noCtx = await call("GET", "/fees", { tenant: "none" });
      expect(noCtx.status).toBe(401);
      const forbidden = await call("GET", "/fees", { perms: ["finance.invoice.read"] });
      expect(forbidden.status).toBe(403);
      expect(forbidden.json).toMatchObject({ status: 403, code: "FORBIDDEN", kind: "forbidden" });
      expect(typeof forbidden.json.requestId).toBe("string");
    });

    it("validation Zod : 400 avec le détail des champs ; champs inconnus refusés ; JSON illisible", async () => {
      const bad = await call("POST", "/fees", { body: { code: "X", name: "", category: "NOPE" } });
      expect(bad.status).toBe(400);
      expect(bad.json.code).toBe("VALIDATION_FAILED");
      expect(bad.json.issues.map((i: any) => i.path[0]).sort()).toEqual(["category", "name"]);
      const extra = await call("POST", "/fees", { body: { code: "X", name: "x", category: "TUITION", surprise: 1 } });
      expect(extra.status).toBe(400);
      const broken = await call("POST", "/fees", { rawBody: "{pas du json" });
      expect(broken.status).toBe(400);
      expect(broken.json.message).not.toMatch(/Unexpected|JSON\.parse/);
    });

    it("les montants décimaux, négatifs ou énormes sont refusés ; une chaîne de chiffres est acceptée", async () => {
      const fee = await call("POST", "/fees", { body: { code: "HTTP-A", name: "Frais HTTP", category: "TUITION" } });
      expect(fee.status).toBe(201);
      const base = { feeId: fee.json.id, academicYear: "2025-2026", effectiveFrom: "2025-06-01" };
      for (const amount of [12.5, "12.5", -1, "-5", 1e21, "9".repeat(16), "abc", null]) {
        const r = await call("POST", "/fee-schedules", { body: { ...base, amount } });
        expect(r.status, JSON.stringify(amount)).toBe(400);
      }
      const ok = await call("POST", "/fee-schedules", { body: { ...base, amount: "500000" } });
      expect(ok.status).toBe(201);
      expect(ok.json.amount).toEqual({ amount: 500000, currency: "XOF" });
      expect(financeFeeScheduleDtoSchema.parse(ok.json)).toBeTruthy();
    });

    it("erreur inattendue : 500 sans fuite d'information interne", async () => {
      const broken = Fastify({ logger: false });
      broken.addHook("onRequest", async (req) => {
        (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId, userId: accountant, roles: [] });
      });
      const failing = createFinanceDeps({
        db: { run: async () => { throw new Error("password=hunter2 SELECT secret FROM x"); } } as never,
        providers: world.providers,
      });
      await broken.register(financePlugin, { deps: failing, requirePermission: () => async () => undefined });
      const res = await broken.inject({ method: "GET", url: "/api/v1/finance/fees" });
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toMatch(/hunter2|secret|SELECT/);
      expect(res.json()).toMatchObject({ code: "INTERNAL" });
      await broken.close();
    });

    it("pagination bornée (limit ≤ 200)", async () => {
      expect((await call("GET", "/invoices", { query: { limit: "500" } })).status).toBe(400);
      expect((await call("GET", "/invoices", { query: { limit: "5", offset: "0" } })).status).toBe(200);
    });
  });

  describe("parcours complet : barème → facture → paiement → reçu → remboursement → caisse → rapports", () => {
    const learner = newId();
    let invoiceId: string;
    let installmentIds: string[];
    let paymentId: string;
    let receiptId: string;
    let refundId: string;
    let sessionId: string;

    it("catalogue : frais, plan d'échéancier, barème avec plan, remise", async () => {
      const fee = await call("POST", "/fees", { body: { code: "SCOL-H", name: "Scolarité", category: "TUITION" } });
      expect(fee.status).toBe(201);
      expect(financeFeeDtoSchema.parse(fee.json).category).toBe("TUITION");
      const dup = await call("POST", "/fees", { body: { code: "scol-h", name: "Doublon", category: "TUITION" } });
      expect(dup.status).toBe(409);

      const plan = await call("POST", "/installment-plans", {
        body: {
          code: "P4",
          name: "4 tranches",
          steps: [
            { label: "Inscription", share: { kind: "WEIGHT", weight: 100 }, due: { type: "OFFSET_DAYS", days: 0 } },
            { label: "T1", share: { kind: "WEIGHT", weight: 150 }, due: { type: "MONTH_DAY", month: 10, day: 15 } },
            { label: "T2", share: { kind: "WEIGHT", weight: 150 }, due: { type: "MONTH_DAY", month: 1, day: 15 } },
            { label: "T3", share: { kind: "WEIGHT", weight: 100 }, due: { type: "MONTH_DAY", month: 3, day: 15 } },
          ],
        },
      });
      expect(plan.status).toBe(201);
      expect(financePlanDtoSchema.parse(plan.json).steps).toHaveLength(4);

      const schedule = await call("POST", "/fee-schedules", {
        body: { feeId: fee.json.id, academicYear: "2025-2026", amount: 500000, effectiveFrom: "2025-06-01", planId: plan.json.id },
      });
      expect(schedule.status).toBe(201);
      const overlap = await call("POST", "/fee-schedules", {
        body: { feeId: fee.json.id, academicYear: "2025-2026", amount: 600000, effectiveFrom: "2025-07-01" },
      });
      expect(overlap.status).toBe(409);
      expect(overlap.json.code).toBe("finance.fee_schedule_overlap");

      const resolved = await call("GET", "/fee-schedules/resolve", { query: { feeId: fee.json.id, academicYear: "2025-2026", onDate: "2025-09-01" } });
      expect(resolved.status).toBe(200);
      expect(resolved.json.amount.amount).toBe(500000);
      const missing = await call("GET", "/fee-schedules/resolve", { query: { feeId: fee.json.id, academicYear: "2031-2032" } });
      expect(missing.status).toBe(409);
      expect(missing.json.code).toBe("finance.fee_schedule_not_found");

      const discount = await call("POST", "/discounts", { body: { code: "FR", name: "Fratrie", kind: "PERCENT", bps: 1000 } });
      expect(discount.status).toBe(201);
      expect(financeDiscountDtoSchema.parse(discount.json).bps).toBe(1000);
      const list = await call("GET", "/fees");
      expect(list.json.items.length).toBeGreaterThanOrEqual(2);
    });

    it("facture depuis le barème : aperçu, émission idempotente (en-tête Idempotency-Key), lecture", async () => {
      const body = { learnerId: learner, academicYear: "2025-2026", items: [{ feeCode: "SCOL-H" }] };
      const preview = await call("POST", "/invoices/from-schedule/preview", { body });
      expect(preview.status).toBe(200);
      expect(financeInvoicePreviewDtoSchema.parse(preview.json).invoices[0]!.total.amount).toBe(500000);

      const key = `http-inv-${newId()}`;
      const created = await call("POST", "/invoices/from-schedule", { body, headers: { "idempotency-key": key } });
      expect(created.status).toBe(201);
      const parsed = financeInvoicesResultDtoSchema.parse(created.json);
      expect(parsed.replayed).toBe(false);
      invoiceId = parsed.invoices[0]!.id;
      installmentIds = parsed.invoices[0]!.installments.map((i) => i.id);
      expect(parsed.invoices[0]!.number).toMatch(/^FAC-\d{4}-\d{6}$/);
      expect(parsed.invoices[0]!.installments.map((i) => i.amount.amount)).toEqual([100000, 150000, 150000, 100000]);

      const replay = await call("POST", "/invoices/from-schedule", { body, headers: { "idempotency-key": key } });
      expect(replay.status).toBe(200);
      expect(replay.json.replayed).toBe(true);
      expect(replay.json.invoices[0].id).toBe(invoiceId);
      const conflict = await call("POST", "/invoices/from-schedule", { body: { ...body, items: [{ feeCode: "CANT-X" }] }, headers: { "idempotency-key": key } });
      expect(conflict.status).toBe(409);
      expect(conflict.json.code).toBe("finance.idempotency_key_reused");

      const got = await call("GET", `/invoices/${invoiceId}`);
      expect(financeInvoiceDetailDtoSchema.parse(got.json).balance.amount).toBe(500000);
      expect((await call("GET", `/invoices/${newId()}`)).status).toBe(404);
      expect((await call("GET", "/invoices/pas-un-uuid")).status).toBe(400);
      const listed = await call("GET", "/invoices", { query: { learnerId: learner } });
      expect(listed.json.total).toBe(1);
    });

    it("paiement : clé d'idempotence obligatoire, rejeu, reçu, imputation", async () => {
      const body = { learnerId: learner, amount: 180000, method: "TRANSFER", reference: "VIR-HTTP-1" };
      const noKey = await call("POST", "/payments", { body });
      expect(noKey.status).toBe(400);
      const key = `http-pay-${newId()}`;
      const created = await call("POST", "/payments", { body, headers: { "idempotency-key": key } });
      expect(created.status).toBe(201);
      const view = financePaymentViewDtoSchema.parse(created.json);
      paymentId = view.payment.id;
      receiptId = view.receipt!.id;
      expect(view.allocations.map((a) => a.amount.amount)).toEqual([100000, 80000]);
      expect(view.receipt!.number).toMatch(/^REC-\d{4}-\d{6}$/);
      const replay = await call("POST", "/payments", { body, headers: { "idempotency-key": key } });
      expect(replay.status).toBe(200);
      expect(replay.json.replayed).toBe(true);
      expect(replay.json.payment.id).toBe(paymentId);
      const changed = await call("POST", "/payments", { body: { ...body, amount: 180001 }, headers: { "idempotency-key": key } });
      expect(changed.status).toBe(409);

      expect(financeReceiptDtoSchema.parse((await call("GET", `/receipts/${receiptId}`)).json).paymentId).toBe(paymentId);
      expect(financeReceiptDtoSchema.parse((await call("GET", `/payments/${paymentId}/receipt`)).json).id).toBe(receiptId);
      expect((await call("GET", "/receipts", { query: { learnerId: learner } })).json.total).toBe(1);
      expect((await call("GET", "/payments", { query: { learnerId: learner, status: "CONFIRMED" } })).json.total).toBe(1);

      // imputation manuelle d'un second paiement sur la dernière échéance
      const second = await call("POST", "/payments", {
        body: { learnerId: learner, amount: 100000, method: "TRANSFER", reference: "VIR-HTTP-2", allocation: { mode: "MANUAL", items: [{ installmentId: installmentIds[3], amount: 60000 }] } },
        headers: { "idempotency-key": `http-pay-${newId()}` },
      });
      expect(second.status).toBe(201);
      expect(second.json.payment.unallocated.amount).toBe(40000);
      const allocated = await call("POST", `/payments/${second.json.payment.id}/allocations`, { body: { allocation: { mode: "AUTO" } } });
      expect(allocated.status).toBe(200);
      expect(allocated.json.payment.unallocated.amount).toBe(0);
    });

    it("remboursement : quatre yeux, permission sensible dédiée", async () => {
      const without = await call("POST", `/payments/${paymentId}/refunds`, { perms: ["finance.payment.create"], body: { amount: 20000, reason: "Trop perçu" } });
      expect(without.status).toBe(403);
      const req = await call("POST", `/payments/${paymentId}/refunds`, { body: { amount: 20000, reason: "Trop perçu" } });
      expect(req.status).toBe(201);
      refundId = financeRefundDtoSchema.parse(req.json).id;
      expect(req.json.status).toBe("REQUESTED");
      const self = await call("POST", `/refunds/${refundId}/approve`, { body: {} });
      expect(self.status).toBe(409);
      expect(self.json.code).toBe("finance.refund_self_approval");
      const approved = await call("POST", `/refunds/${refundId}/approve`, { user: director, body: {} });
      expect(approved.status).toBe(200);
      expect(approved.json.status).toBe("COMPLETED");
      const rejectDone = await call("POST", `/refunds/${refundId}/reject`, { user: director, body: { reason: "Trop tard pour refuser" } });
      expect(rejectDone.status).toBe(409);
      expect((await call("GET", "/refunds", { query: { paymentId } })).json.items).toHaveLength(1);
    });

    it("avoir et annulation", async () => {
      const credit = await call("POST", `/invoices/${invoiceId}/credit-notes`, { body: { amount: 50000, reason: "Bourse accordée" } });
      expect(credit.status).toBe(201);
      expect(credit.json.creditNote.number).toMatch(/^AV-\d{4}-\d{6}$/);
      financeInvoiceDetailDtoSchema.parse(credit.json.invoice);
      const cancel = await call("POST", `/invoices/${invoiceId}/cancel`, { body: { reason: "Annulation impossible ici" } });
      expect(cancel.status).toBe(409);
      expect(cancel.json.code).toBe("finance.invoice_has_payments");
    });

    it("caisse : registre, ouverture, encaissement espèces, clôture avec écart", async () => {
      const register = await call("POST", "/cash-registers", { body: { code: "H1", name: "Caisse HTTP" } });
      expect(register.status).toBe(201);
      const noSession = await call("POST", "/payments", {
        body: { learnerId: learner, amount: 1000, method: "CASH" },
        headers: { "idempotency-key": `http-cash-${newId()}` },
      });
      expect(noSession.status).toBe(409);
      expect(noSession.json.code).toBe("finance.cash_session_required");

      const opened = await call("POST", `/cash-registers/${register.json.id}/sessions`, { body: { openingFloat: 10000 } });
      expect(opened.status).toBe(201);
      sessionId = opened.json.id;
      expect((await call("GET", "/cash-sessions/mine")).json.session.id).toBe(sessionId);
      const cash = await call("POST", "/payments", {
        body: { learnerId: learner, amount: 25000, method: "CASH" },
        headers: { "idempotency-key": `http-cash-${newId()}` },
      });
      expect(cash.status).toBe(201);
      expect(cash.json.payment.cashSessionId).toBe(sessionId);

      const noNote = await call("POST", `/cash-sessions/${sessionId}/close`, { body: { countedAmount: 34000 } });
      expect(noNote.status).toBe(400);
      const closed = await call("POST", `/cash-sessions/${sessionId}/close`, { body: { countedAmount: 34000, note: "Pièce de 1 000 manquante" } });
      expect(closed.status).toBe(200);
      const summary = financeCashSessionSummaryDtoSchema.parse(closed.json);
      expect(summary.session.expected?.amount).toBe(35000);
      expect(summary.session.variance?.amount).toBe(-1000);
      expect(summary.movements.received.amount).toBe(25000);
      expect(financeCashSessionSummaryDtoSchema.parse((await call("GET", `/cash-sessions/${sessionId}`)).json).session.status).toBe("CLOSED");
    });

    it("rapports et relevé conformes aux contrats", async () => {
      const summary = financeSummaryDtoSchema.parse((await call("GET", "/reports/summary", { query: { academicYear: "2025-2026" } })).json);
      expect(summary.billed.amount).toBe(500000);
      expect(summary.credited.amount).toBe(50000);
      const groups = (await call("GET", "/reports/receivables-by-group")).json.items;
      groups.forEach((g: unknown) => financeReceivableRowDtoSchema.parse(g));
      const byLearner = (await call("GET", "/reports/receivables-by-learner", { query: { onlyOutstanding: "false" } })).json;
      byLearner.items.forEach((g: unknown) => financeLearnerReceivableRowDtoSchema.parse(g));
      expect(byLearner.total).toBeGreaterThan(0);
      const trend = await call("GET", "/reports/collections-trend", { query: { from: "2025-08-01", to: "2025-09-30", granularity: "week" } });
      expect(trend.status).toBe(200);
      trend.json.items.forEach((p: unknown) => financeTrendPointDtoSchema.parse(p));
      const aged = financeAgedBalanceDtoSchema.parse((await call("GET", "/reports/aged-balance", { query: { byLearner: "5" } })).json);
      expect(aged.total.amount).toBeGreaterThan(0);
      const stmt = financeLearnerStatementDtoSchema.parse((await call("GET", `/learners/${learner}/statement`)).json);
      expect(stmt.totals.collected.amount).toBeGreaterThan(0);
      expect((await call("GET", "/reports/summary", { perms: ["finance.invoice.read"] })).status).toBe(403);
      expect((await call("GET", "/reports/collections-trend", { query: { from: "2025-12-01", to: "2025-01-01" } })).status).toBe(400);
    });
  });

  describe("financement État/parent et fonctionnalités (entitlements)", () => {
    it("bourse État + type STATE_ASSIGNED exigent la fonctionnalité finance.state-assigned", async () => {
      const learner = newId();
      features.delete("finance.state-assigned");
      const denied = await call("PUT", `/learners/${learner}/funding`, { body: { fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-1" } });
      expect(denied.status).toBe(403);
      expect(denied.json.code).toBe("finance.feature_disabled");
      const deniedSch = await call("POST", "/scholarships", {
        body: { learnerId: learner, academicYear: "2025-2026", funderKind: "STATE", funderName: "État", coverage: { kind: "PERCENT", bps: 6000 } },
      });
      expect(deniedSch.status).toBe(403);
      // une bourse d'entreprise n'exige pas la fonctionnalité
      const company = await call("POST", "/scholarships", {
        body: { learnerId: learner, academicYear: "2025-2026", funderKind: "COMPANY", funderName: "ACME", coverage: { kind: "FIXED", amount: 100000 } },
      });
      expect(company.status).toBe(201);
      financeScholarshipDtoSchema.parse(company.json);

      features.add("finance.state-assigned");
      const ok = await call("PUT", `/learners/${learner}/funding`, { body: { fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-1" } });
      expect(ok.status).toBe(200);
      const sch = await call("POST", "/scholarships", {
        body: { learnerId: learner, academicYear: "2025-2026", funderKind: "STATE", funderName: "État", reference: "AFF-1", coverage: { kind: "PERCENT", bps: 6000 } },
      });
      expect(sch.status).toBe(201);
      const funding = financeLearnerFundingDtoSchema.parse((await call("GET", `/learners/${learner}/funding`)).json);
      expect(funding.account.fundingType).toBe("STATE_ASSIGNED");
      expect(funding.scholarships).toHaveLength(2);
      expect((await call("PATCH", `/scholarships/${sch.json.id}/status`, { body: { status: "ENDED" } })).status).toBe(200);
    });

    it("paiement en ligne et échéanciers : désactivés sans leur fonctionnalité", async () => {
      features.delete("finance.online-payment");
      const online = await call("POST", "/payments/online", {
        body: { learnerId: newId(), amount: 25000, provider: "sandbox" },
        headers: { "idempotency-key": `http-online-${newId()}` },
      });
      expect(online.status).toBe(403);
      features.add("finance.online-payment");
      features.delete("finance.installments");
      const plan = await call("POST", "/installment-plans", { body: { code: "NOPE", name: "x", steps: [{ label: "a", share: { kind: "WEIGHT", weight: 1 }, due: { type: "OFFSET_DAYS", days: 0 } }] } });
      expect(plan.status).toBe(403);
      features.add("finance.installments");
    });
  });

  describe("paiement en ligne (sandbox) et webhooks", () => {
    it("initiation, webhook signé sur corps brut, rejeu, signature invalide, fournisseur inconnu", async () => {
      const learner = newId();
      const invoice = await call("POST", "/invoices", {
        body: { learnerId: learner, academicYear: "2025-2026", lines: [{ category: "TUITION", description: "Scolarité", unitAmount: 100000 }], dueDate: "2025-12-31", issue: true },
      });
      expect(invoice.status).toBe(201);

      const key = `http-online-${newId()}`;
      const init = await call("POST", "/payments/online", {
        body: { learnerId: learner, amount: 25001, provider: "sandbox", invoiceId: invoice.json.invoices[0].id },
        headers: { "idempotency-key": key },
      });
      expect(init.status).toBe(201);
      const view = financeOnlinePaymentDtoSchema.parse(init.json);
      expect(view.payment.status).toBe("PENDING");
      expect(view.payment.simulated).toBe(true);
      expect(view.instructions?.redirectUrl).toContain("sandbox.invalid");

      const replayInit = await call("POST", "/payments/online", {
        body: { learnerId: learner, amount: 25001, provider: "sandbox", invoiceId: invoice.json.invoices[0].id },
        headers: { "idempotency-key": key },
      });
      expect(replayInit.status).toBe(200);

      const sandbox = (await world.providers.resolve(tenantId, SANDBOX_PROVIDER_NAME)) as { ok: true; value: SandboxProvider };
      const ref = view.payment.providerRef!;
      sandbox.value.settle(ref, "success");
      const wh = sandbox.value.buildWebhook(ref);
      const url = `/webhooks/sandbox/${tenantId}`;

      // pas d'authentification utilisateur : la signature fait foi
      const bad = await call("POST", url, { tenant: "none", rawBody: wh.rawBody, headers: { ...wh.headers, "x-sandbox-signature": "0".repeat(64) } });
      expect(bad.status).toBe(401);
      expect(bad.json.code).toBe("finance.webhook_signature_invalid");
      const tampered = await call("POST", url, { tenant: "none", rawBody: wh.rawBody.replace("25001", "10"), headers: wh.headers });
      expect(tampered.status).toBe(401);

      const good = await call("POST", url, { tenant: "none", rawBody: wh.rawBody, headers: wh.headers });
      expect(good.status).toBe(200);
      expect(good.json).toMatchObject({ status: "PROCESSED", replayed: false, paymentId: view.payment.id });
      const again = await call("POST", url, { tenant: "none", rawBody: wh.rawBody, headers: wh.headers });
      expect(again.status).toBe(200);
      expect(again.json).toMatchObject({ status: "PROCESSED", replayed: true });

      const final = financePaymentViewDtoSchema.parse((await call("GET", `/payments/${view.payment.id}`)).json);
      expect(final.payment.status).toBe("CONFIRMED");
      expect(final.allocations).toHaveLength(1);

      const unknown = await call("POST", `/webhooks/inconnu/${tenantId}`, { tenant: "none", rawBody: "{}" });
      expect(unknown.status).toBe(409);
      const wrongType = await call("POST", url, { tenant: "none", rawBody: wh.rawBody, headers: { ...wh.headers, "content-type": "application/xml" } });
      expect(wrongType.status).toBe(400);
      expect(wrongType.json.code).toBe("finance.unsupported_media_type");
      const badTenant = await call("POST", "/webhooks/sandbox/pas-un-uuid", { tenant: "none", rawBody: "{}" });
      expect(badTenant.status).toBe(400);
    });

    it("vérification active d'un paiement en attente", async () => {
      const learner = newId();
      await call("POST", "/invoices", {
        body: { learnerId: learner, academicYear: "2025-2026", lines: [{ category: "TUITION", description: "Scolarité", unitAmount: 100000 }], dueDate: "2025-12-31", issue: true },
      });
      const init = await call("POST", "/payments/online", {
        body: { learnerId: learner, amount: 25001, provider: "sandbox" },
        headers: { "idempotency-key": `http-online-${newId()}` },
      });
      const sandbox = (await world.providers.resolve(tenantId, SANDBOX_PROVIDER_NAME)) as { ok: true; value: SandboxProvider };
      sandbox.value.settle(init.json.payment.providerRef, "success");
      const verified = await call("POST", `/payments/${init.json.payment.id}/verify`);
      expect(verified.status).toBe(200);
      expect(verified.json.payment.status).toBe("CONFIRMED");
    });
  });

  describe("cohérence manifeste ↔ routes", () => {
    const source = readFileSync(resolve(here, "../../http/plugin.ts"), "utf8");

    it("toute permission utilisée par une route est déclarée au manifeste, et inversement", () => {
      // Permissions des routes famille : calculées par `FAMILY_PERMISSIONS` (application/family.ts, vérifié par family.integration.test.ts).
      const family = Object.values(FAMILY_PERMISSIONS).flatMap((r) => Object.values(r));
      const used = new Set([...[...source.matchAll(/perm\("([a-z_.]+)"\)/g)].map((m) => m[1]!), ...family]);
      const declared = new Set(ALL_PERMISSIONS);
      expect([...used].filter((p) => !declared.has(p))).toEqual([]);
      expect([...declared].filter((p) => !used.has(p))).toEqual([]);
    });

    it("les fonctionnalités gardées par le plugin sont déclarées au manifeste", () => {
      const used = new Set([...source.matchAll(/requireFeature\(ctx, "([a-z.\-]+)"\)/g)].map((m) => m[1]!));
      const declared = new Set(manifest.features.map((f) => f.key));
      expect([...used].filter((f) => !declared.has(f))).toEqual([]);
      expect([...declared].sort()).toEqual(["finance.installments", "finance.online-payment", "finance.state-assigned"]);
    });

    it("les seules permissions sensibles sont le remboursement, le rapprochement manuel et la configuration des fournisseurs de paiement", () => {
      expect(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key)).toEqual(["finance.payment.refund", "finance.payment.reconcile", "finance.webhook.replay", "finance.provider.manage"]);
    });
  });
});
