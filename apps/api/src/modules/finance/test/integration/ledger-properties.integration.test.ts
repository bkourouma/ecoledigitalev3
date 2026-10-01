/**
 * Tests de PROPRIÉTÉS sur le grand livre : des opérations aléatoires (graine fixée, donc reproductibles),
 * séquentielles puis CONCURRENTES, sur un vrai Postgres. Après chaque lot, l'audit indépendant
 * (`ledgerViolations`, SQL brut) doit ne trouver aucune violation : aucun montant négatif, argent
 * conservé, cumuls = écritures, reçus et numéros sans trou, sessions de caisse exactes.
 *
 * Aucune opération ne doit LEVER d'exception : un refus attendu est un `Err` ; une exception
 * signalerait une contrainte SQL violée, donc un bug.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { Money, unwrap, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { cancelInvoice, createInvoice, generateInstallmentPlan, issueCreditNote, markOverdueInvoices } from "../../application/invoices";
import { allocatePayment, recordManualPayment } from "../../application/payments";
import { approveRefund, requestRefund } from "../../application/refunds";
import { addDays } from "../../domain/dates";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { ledgerReport, ledgerViolations } from "../support/invariants";
import { Rng } from "../support/rng";
import { learnerId, nextKey, openCashier, seedCatalog, xof, YEAR } from "../support/scenario";

interface Env {
  db: FinanceTestDb;
  world: TestWorld;
  tenantId: string;
  accountant: RequestContext;
  cashier: RequestContext;
  approver: RequestContext;
  learners: string[];
  rng: Rng;
  stats: Record<string, number>;
}

const bump = (env: Env, key: string, r: Result<unknown>): void => {
  env.stats[`${key}.${r.ok ? "ok" : "refusé"}`] = (env.stats[`${key}.${r.ok ? "ok" : "refusé"}`] ?? 0) + 1;
};

const today = (env: Env): string => env.world.clock.now().toISOString().slice(0, 10);

type Op = (env: Env) => Promise<void>;

const ops: Record<string, Op> = {
  async invoice(env) {
    const learner = env.rng.pick(env.learners);
    const due = addDays(today(env), env.rng.int(-60, 120));
    const r = await createInvoice(env.world.deps, env.accountant, {
      learnerId: learner,
      academicYear: YEAR,
      groupKey: env.rng.pick(["6A", "6B", "5A"]),
      lines: [
        { category: "TUITION", description: "Scolarité", unitAmount: xof(env.rng.int(10, 600) * 1_000 + env.rng.int(0, 999)) },
        ...(env.rng.bool(0.4) ? [{ category: "CANTEEN" as const, description: "Cantine", quantity: env.rng.int(1, 3), unitAmount: xof(env.rng.int(1, 30) * 1_000) }] : []),
      ],
      dueDate: due,
      ...(env.rng.bool(0.5) ? { installments: { planCode: "STD4", baseDate: addDays(today(env), env.rng.int(-30, 30)) } } : {}),
      issue: true,
    });
    bump(env, "invoice", r);
  },

  async pay(env) {
    const open = await adminRows<{ learner_id: string; outstanding: string; inst: string; remaining: string }>(
      env.db,
      `SELECT i.learner_id, (i.total_amount - i.paid_amount - i.credited_amount)::text AS outstanding, n.id AS inst,
              (n.amount - n.paid_amount - n.credited_amount)::text AS remaining
         FROM finance.invoices i JOIN finance.installments n ON n.invoice_id = i.id
        WHERE i.tenant_id = $1 AND i.payer_kind = 'LEARNER' AND i.status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')
          AND n.paid_amount + n.credited_amount < n.amount`,
      [env.tenantId],
    );
    const pick = open.length > 0 && env.rng.bool(0.85) ? env.rng.pick(open) : undefined;
    const learner = pick?.learner_id ?? env.rng.pick(env.learners);
    const amount = pick ? Math.max(1, Math.floor(Number(pick.outstanding) * (env.rng.int(10, 130) / 100))) : env.rng.int(1, 50) * 1_000;
    const mode = env.rng.int(0, 9);
    const method = env.rng.pick(["TRANSFER", "CASH", "CARD", "MOBILE_MONEY"] as const);
    const r = await recordManualPayment(env.world.deps, method === "CASH" ? env.cashier : env.accountant, {
      idempotencyKey: nextKey("fz"),
      learnerId: learner,
      amount: xof(amount),
      method,
      ...(method === "TRANSFER" ? { reference: "VIR" } : {}),
      allocation:
        mode < 6
          ? { mode: "AUTO" }
          : mode < 8 || !pick
            ? { mode: "NONE" }
            : { mode: "MANUAL", items: [{ installmentId: pick.inst, amount: xof(Math.max(1, Math.min(Number(pick.remaining), amount))) }] },
    });
    bump(env, "pay", r);
  },

  async allocate(env) {
    const rows = await adminRows<{ id: string }>(
      env.db,
      "SELECT id FROM finance.payments WHERE tenant_id = $1 AND status = 'CONFIRMED' AND amount - allocated_amount - refunded_amount > 0",
      [env.tenantId],
    );
    if (rows.length === 0) return;
    bump(env, "allocate", await allocatePayment(env.world.deps, env.accountant, { paymentId: env.rng.pick(rows).id, allocation: { mode: "AUTO" } }));
  },

  async refund(env) {
    const rows = await adminRows<{ id: string; refundable: string }>(
      env.db,
      "SELECT id, (amount - refunded_amount)::text AS refundable FROM finance.payments WHERE tenant_id = $1 AND status = 'CONFIRMED'",
      [env.tenantId],
    );
    if (rows.length === 0) return;
    const p = env.rng.pick(rows);
    const amount = Math.max(1, Math.floor(Number(p.refundable) * (env.rng.int(5, 105) / 100)));
    const req = await requestRefund(env.world.deps, env.accountant, { paymentId: p.id, amount: xof(amount), reason: "Remboursement aléatoire" });
    bump(env, "refund.request", req);
    if (!req.ok) return;
    if (env.rng.bool(0.8)) bump(env, "refund.approve", await approveRefund(env.world.deps, env.approver, { refundId: req.value.id }));
  },

  async credit(env) {
    const rows = await adminRows<{ id: string; balance: string }>(
      env.db,
      `SELECT id, (total_amount - paid_amount - credited_amount)::text AS balance FROM finance.invoices
        WHERE tenant_id = $1 AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')`,
      [env.tenantId],
    );
    if (rows.length === 0) return;
    const inv = env.rng.pick(rows);
    const amount = Math.max(1, Math.floor(Number(inv.balance) * (env.rng.int(5, 115) / 100)));
    bump(env, "credit", await issueCreditNote(env.world.deps, env.accountant, { invoiceId: inv.id, amount: xof(amount), reason: "Avoir aléatoire" }));
  },

  async cancel(env) {
    const rows = await adminRows<{ id: string }>(
      env.db,
      "SELECT id FROM finance.invoices WHERE tenant_id = $1 AND status IN ('ISSUED','OVERDUE') AND paid_amount = 0 AND credited_amount = 0",
      [env.tenantId],
    );
    if (rows.length === 0 || !env.rng.bool(0.4)) return;
    bump(env, "cancel", await cancelInvoice(env.world.deps, env.accountant, { invoiceId: env.rng.pick(rows).id, reason: "Annulation aléatoire" }));
  },

  async replan(env) {
    const rows = await adminRows<{ id: string }>(
      env.db,
      "SELECT id FROM finance.invoices WHERE tenant_id = $1 AND status IN ('ISSUED','OVERDUE') AND paid_amount = 0 AND credited_amount = 0",
      [env.tenantId],
    );
    if (rows.length === 0 || !env.rng.bool(0.3)) return;
    bump(env, "replan", await generateInstallmentPlan(env.world.deps, env.accountant, { invoiceId: env.rng.pick(rows).id, planCode: "STD4", baseDate: today(env) }));
  },

  async time(env) {
    env.world.clock.advance(env.rng.int(1, 20) * 86_400_000);
    bump(env, "overdue", await markOverdueInvoices(env.world.deps, env.accountant));
  },
};

const OP_NAMES = ["invoice", "invoice", "pay", "pay", "pay", "pay", "allocate", "refund", "refund", "credit", "cancel", "replan", "time"] as const;

describeIntegration("propriétés du grand livre : opérations aléatoires séquentielles et concurrentes (Postgres réel)", () => {
  let db: FinanceTestDb;

  beforeAll(async () => {
    db = await createFinanceTestDb(16);
  });
  afterAll(async () => {
    await db.drop();
  });

  for (const seed of [11, 2024, 90210]) {
    it(`graine ${seed} : aucune violation d'invariant après chaque lot, aucune exception`, async () => {
      const world = makeWorld(db);
      const tenantId = await db.createTenant();
      const accountant = ctxFor(tenantId);
      const cashier = ctxFor(tenantId);
      const approver = ctxFor(tenantId);
      await seedCatalog(world.deps, accountant);
      await openCashier(world.deps, cashier, 25_000, `FZ-${seed}-A`);
      await openCashier(world.deps, approver, 0, `FZ-${seed}-B`);
      const env: Env = {
        db,
        world,
        tenantId,
        accountant,
        cashier,
        approver,
        learners: Array.from({ length: 8 }, () => learnerId()),
        rng: new Rng(seed),
        stats: {},
      };

      for (let round = 0; round < 10; round++) {
        // 1. une série séquentielle
        for (let k = 0; k < 8; k++) await ops[env.rng.pick(OP_NAMES)]!(env);
        expect(await ledgerViolations(db, tenantId), `après la série séquentielle ${round} (graine ${seed})`).toEqual([]);
        // 2. un lot CONCURRENT d'opérations indépendantes sur les mêmes données
        await Promise.all(Array.from({ length: 6 }, () => ops[env.rng.pick(OP_NAMES.filter((n) => n !== "time"))]!(env)));
        expect(await ledgerViolations(db, tenantId), `après le lot concurrent ${round} (graine ${seed})`).toEqual([]);
      }

      const report = await ledgerReport(db, tenantId);
      expect(report.payments).toBeGreaterThan(15);
      expect(report.invoices).toBeGreaterThan(8);
      expect(report.receipts).toBeGreaterThan(10);
      // les opérations ont réellement exercé les chemins sensibles
      expect(env.stats["refund.approve.ok"] ?? 0).toBeGreaterThan(0);
      expect(env.stats["credit.ok"] ?? 0).toBeGreaterThan(0);
      expect(env.stats["pay.ok"] ?? 0).toBeGreaterThan(10);
      // statistiques d'exécution, utiles pour diagnostiquer une dérive de couverture des chemins (FINANCE_TEST_VERBOSE=1)
      if (process.env.FINANCE_TEST_VERBOSE) console.info(`[ledger seed=${seed}]`, JSON.stringify({ ...report, ...env.stats }));
    });
  }

  it("remboursements concurrents : jamais plus que le montant payé", async () => {
    const world = makeWorld(db);
    const tenantId = await db.createTenant();
    const c = ctxFor(tenantId);
    const approver = ctxFor(tenantId);
    await seedCatalog(world.deps, c);
    const learner = learnerId();
    await createInvoice(world.deps, c, { learnerId: learner, academicYear: YEAR, lines: [{ category: "TUITION", description: "S", unitAmount: xof(100_000) }], dueDate: "2025-12-31", issue: true });
    const pay = unwrap(await recordManualPayment(world.deps, c, { idempotencyKey: nextKey("rc"), learnerId: learner, amount: xof(100_000), method: "TRANSFER", reference: "V" }));
    const requests = await Promise.all(
      Array.from({ length: 10 }, () => requestRefund(world.deps, c, { paymentId: pay.payment.id, amount: xof(30_000), reason: "Demande concurrente" })),
    );
    const accepted = requests.filter((r) => r.ok);
    expect(accepted).toHaveLength(3); // 3 × 30 000 ≤ 100 000 < 4 × 30 000
    const approvals = await Promise.all(accepted.map((r) => approveRefund(world.deps, approver, { refundId: (r as { value: { id: string } }).value.id })));
    expect(approvals.every((a) => a.ok)).toBe(true);
    expect(await ledgerViolations(db, tenantId)).toEqual([]);
    const [row] = await adminRows<{ refunded: string }>(db, "SELECT refunded_amount::text AS refunded FROM finance.payments WHERE id = $1", [pay.payment.id]);
    expect(row!.refunded).toBe("90000");
  });

  it("approbations concurrentes du MÊME remboursement : exécuté une seule fois", async () => {
    const world = makeWorld(db);
    const tenantId = await db.createTenant();
    const c = ctxFor(tenantId);
    await seedCatalog(world.deps, c);
    const learner = learnerId();
    await createInvoice(world.deps, c, { learnerId: learner, academicYear: YEAR, lines: [{ category: "TUITION", description: "S", unitAmount: xof(100_000) }], dueDate: "2025-12-31", issue: true });
    const pay = unwrap(await recordManualPayment(world.deps, c, { idempotencyKey: nextKey("ra"), learnerId: learner, amount: xof(100_000), method: "TRANSFER", reference: "V" }));
    const req = unwrap(await requestRefund(world.deps, c, { paymentId: pay.payment.id, amount: xof(40_000), reason: "Demande unique" }));
    const results = await Promise.all(Array.from({ length: 6 }, () => approveRefund(world.deps, ctxFor(tenantId), { refundId: req.id })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await ledgerViolations(db, tenantId)).toEqual([]);
    const [row] = await adminRows<{ refunded: string }>(db, "SELECT refunded_amount::text AS refunded FROM finance.payments WHERE id = $1", [pay.payment.id]);
    expect(row!.refunded).toBe("40000");
  });

  it("avoirs concurrents sur une même facture : la somme ne dépasse jamais le reste dû", async () => {
    const world = makeWorld(db);
    const tenantId = await db.createTenant();
    const c = ctxFor(tenantId);
    await seedCatalog(world.deps, c);
    const inv = unwrap(
      await createInvoice(world.deps, c, { learnerId: learnerId(), academicYear: YEAR, lines: [{ category: "TUITION", description: "S", unitAmount: xof(100_000) }], dueDate: "2025-12-31", issue: true }),
    ).invoices[0]!;
    const results = await Promise.all(Array.from({ length: 8 }, () => issueCreditNote(world.deps, c, { invoiceId: inv.invoice.id, amount: xof(30_000), reason: "Avoir concurrent" })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await ledgerViolations(db, tenantId)).toEqual([]);
    const [row] = await adminRows<{ credited: string; status: string }>(db, "SELECT credited_amount::text AS credited, status FROM finance.invoices WHERE id = $1", [inv.invoice.id]);
    expect(row).toEqual({ credited: "90000", status: "ISSUED" });
  });

  it("imputations concurrentes d'un même paiement : le non-imputé est consommé exactement une fois", async () => {
    const world = makeWorld(db);
    const tenantId = await db.createTenant();
    const c = ctxFor(tenantId);
    await seedCatalog(world.deps, c);
    const learner = learnerId();
    const pay = unwrap(await recordManualPayment(world.deps, c, { idempotencyKey: nextKey("ia"), learnerId: learner, amount: xof(100_000), method: "TRANSFER", reference: "V", allocation: { mode: "NONE" } }));
    for (let i = 0; i < 3; i++) {
      await createInvoice(world.deps, c, { learnerId: learner, academicYear: YEAR, lines: [{ category: "TUITION", description: "S", unitAmount: xof(60_000) }], dueDate: "2025-12-31", issue: true });
    }
    const results = await Promise.all(Array.from({ length: 5 }, () => allocatePayment(world.deps, c, { paymentId: pay.payment.id, allocation: { mode: "AUTO" } })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await ledgerViolations(db, tenantId)).toEqual([]);
    const [row] = await adminRows<{ allocated: string }>(db, "SELECT allocated_amount::text AS allocated FROM finance.payments WHERE id = $1", [pay.payment.id]);
    expect(row!.allocated).toBe("100000");
  });

  it("monnaie : Money reste entier de bout en bout (aucun flottant en base ni dans les montants relus)", async () => {
    const m = Money.of(123_456);
    expect(Number.isInteger(m.amount)).toBe(true);
    const cols = await adminRows<{ column_name: string; data_type: string }>(
      db,
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'finance' AND (column_name LIKE '%amount%' OR column_name LIKE '%float%' OR column_name = 'last_value')`,
    );
    expect(cols.length).toBeGreaterThan(25);
    for (const c of cols) expect(c.data_type, c.column_name).toBe("bigint");
    const bad = await adminRows(db, "SELECT 1 FROM information_schema.columns WHERE table_schema = 'finance' AND data_type IN ('real','double precision','numeric','money')");
    expect(bad).toEqual([]);
  });
});
