import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money, unwrap } from "@ecoledigitale/kernel";
import { createDiscount } from "../../application/catalog";
import { issueCreditNote, issueInvoiceFromSchedule } from "../../application/invoices";
import { approveRefund, requestRefund } from "../../application/refunds";
import { getAgedBalance, getCollectionsTrend, getFinanceSummary, getReceivablesByGroup, getReceivablesByLearner } from "../../application/reports";
import { diffDays } from "../../domain/dates";
import { installmentRemaining, type Installment } from "../../domain/installments";
import { AGING_BUCKETS, agingBucket, collectionRateBps, computeAgedBalance, summarizeReceivables } from "../../domain/reporting";
import type { InvoiceRecord } from "../../domain/records";
import { getInstallments, listInvoices } from "../../infrastructure/billing-repository";
import { createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, openCashier, pay, seedCatalog, xof, YEAR } from "../support/scenario";

describeIntegration("reporting financier : SQL conforme aux règles du domaine (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let ctx: ReturnType<typeof ctxFor>;
  let boss: ReturnType<typeof ctxFor>;
  const learners: Record<string, string> = {};
  const ASOF = "2025-12-01";

  beforeAll(async () => {
    db = await createFinanceTestDb();
    world = makeWorld(db);
    tenantId = await db.createTenant();
    ctx = ctxFor(tenantId);
    boss = ctxFor(tenantId);
    await seedCatalog(world.deps, ctx);
    await openCashier(world.deps, boss, 0, "RAPPORT");
    const discount = unwrap(await createDiscount(world.deps, ctx, { code: "REMISE5", name: "Remise 5 %", kind: "PERCENT", bps: 500 }));

    const layout: Array<[string, string | null, string | null]> = [
      ["l1", "6A", "Sixième A"],
      ["l2", "6A", "Sixième A"],
      ["l3", "6A", "Sixième A"],
      ["l4", "6B", "Sixième B"],
      ["l5", "6B", "Sixième B"],
      ["l6", null, null],
    ];
    world.clock.set("2025-09-01T08:00:00.000Z");
    for (const [name, group, label] of layout) {
      learners[name] = learnerId();
      unwrap(
        await issueInvoiceFromSchedule(world.deps, ctx, {
          learnerId: learners[name]!,
          academicYear: YEAR,
          items: [{ feeCode: "SCOL" }],
          ...(group ? { groupKey: group, groupLabel: label! } : {}),
          ...(name === "l2" ? { discountIds: [discount.id] } : {}),
        }),
      );
    }
    // Encaissements étalés dans le temps
    const at = (iso: string) => world.clock.set(iso);
    at("2025-09-01T09:00:00.000Z");
    unwrap(await pay(world.deps, boss, learners.l1!, 100_000, { method: "CASH", reference: undefined }));
    unwrap(await pay(world.deps, boss, learners.l2!, 250_000));
    at("2025-09-10T09:00:00.000Z");
    const l3 = unwrap(await pay(world.deps, boss, learners.l3!, 500_000));
    at("2025-10-20T09:00:00.000Z");
    unwrap(await pay(world.deps, boss, learners.l4!, 100_000));
    at("2025-11-05T09:00:00.000Z");
    unwrap(await pay(world.deps, boss, learners.l1!, 150_000));
    // un avoir et un remboursement
    const l5Invoice = (await world.deps.db.run(ctx, (tx) => listInvoices(tx, { learnerId: learners.l5!, limit: 10, offset: 0 }))).items[0]!;
    unwrap(await issueCreditNote(world.deps, ctx, { invoiceId: l5Invoice.id, amount: xof(100_000), reason: "Bourse accordée" }));
    at("2025-11-20T09:00:00.000Z");
    unwrap(await requestRefund(world.deps, ctx, { paymentId: l3.payment.id, amount: xof(50_000), reason: "Trop perçu" }));
    at(`${ASOF}T09:00:00.000Z`);
  });
  afterAll(async () => {
    await db.drop();
  });

  /** Relit toutes les factures + échéances : la « vérité » pour recalculer en TypeScript. */
  async function load(): Promise<{ invoices: InvoiceRecord[]; installments: Map<string, Installment[]> }> {
    return world.deps.db.run(ctx, async (tx) => {
      const invoices = (await listInvoices(tx, { limit: 200, offset: 0 })).items;
      const installments = new Map<string, Installment[]>();
      for (const inv of invoices) installments.set(inv.id, await getInstallments(tx, inv.id));
      return { invoices, installments };
    });
  }

  it("synthèse : facturé, encaissé, restant dû, retard, taux de recouvrement = calcul de référence", async () => {
    const { invoices, installments } = await load();
    const ref = summarizeReceivables(invoices.map((i) => ({ status: i.status, total: i.total, paid: i.paid, credited: i.credited })), "XOF");
    const summary = unwrap(await getFinanceSummary(world.deps, ctx, { academicYear: YEAR, asOf: ASOF }));
    expect(summary.billed.amount).toBe(ref.billed.amount);
    expect(summary.credited.amount).toBe(ref.credited.amount);
    expect(summary.netBilled.amount).toBe(ref.netBilled.amount);
    expect(summary.collected.amount).toBe(ref.collected.amount);
    expect(summary.outstanding.amount).toBe(ref.outstanding.amount);
    expect(summary.collectionRateBps).toBe(ref.collectionRateBps);

    // valeurs attendues à la main : 5 × 500 000 + 475 000 (l2 : −5 %) = 2 975 000 facturés
    expect(summary.billed.amount).toBe(2_975_000);
    expect(summary.credited.amount).toBe(100_000);
    // encaissé : l1 250 000 + l2 250 000 + l3 500 000 + l4 100 000 = 1 100 000 (le remboursement de 50 000 est encore « demandé »)
    expect(summary.collected.amount).toBe(1_100_000);
    expect(summary.outstanding.amount).toBe(2_975_000 - 100_000 - 1_100_000);
    expect(summary.collectionRateBps).toBe(Math.round((1_100_000 / 2_875_000) * 10_000));

    // retard à ASOF = somme du reste des échéances échues (09-01, 10-15) des factures actives
    let overdue = 0;
    for (const inv of invoices) {
      if (!["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status)) continue;
      for (const i of installments.get(inv.id)!) if (i.dueDate < ASOF) overdue += installmentRemaining(i).amount;
    }
    expect(summary.overdue.amount).toBe(overdue);
    expect(summary.overdue.amount).toBeGreaterThan(0);
    // aucun paiement non imputé dans ce jeu
    expect(summary.unallocatedPayments.amount).toBe(0);
  });

  it("créances par classe (clé libre de regroupement) : somme des groupes = total, sans-classe séparé", async () => {
    const rows = unwrap(await getReceivablesByGroup(world.deps, ctx, { academicYear: YEAR, asOf: ASOF }));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect([...byKey.keys()].sort((a, b) => String(a).localeCompare(String(b)))).toEqual(["6A", "6B", null]);
    expect(byKey.get("6A")!.label).toBe("Sixième A");
    expect(byKey.get("6A")!.learnerCount).toBe(3);
    // 6A : l1 500k (250k payés), l2 475k (250k payés), l3 500k (500k payés)
    expect(byKey.get("6A")!.billed.amount).toBe(1_475_000);
    expect(byKey.get("6A")!.collected.amount).toBe(1_000_000);
    expect(byKey.get("6A")!.outstanding.amount).toBe(475_000);
    // 6B : l4 500k (100k), l5 500k (avoir 100k)
    expect(byKey.get("6B")!.credited.amount).toBe(100_000);
    expect(byKey.get("6B")!.outstanding.amount).toBe(1_000_000 - 100_000 - 100_000);
    expect(byKey.get(null)!.outstanding.amount).toBe(500_000);
    const total = rows.reduce((a, r) => a + r.outstanding.amount, 0);
    expect(total).toBe(unwrap(await getFinanceSummary(world.deps, ctx, { academicYear: YEAR, asOf: ASOF })).outstanding.amount);
    expect(rows[0]!.outstanding.amount).toBeGreaterThanOrEqual(rows[1]!.outstanding.amount); // tri décroissant
    // filtre par classe
    const only = unwrap(await getFinanceSummary(world.deps, ctx, { academicYear: YEAR, asOf: ASOF, groupKey: "6B" }));
    expect(only.invoiceCount).toBe(2);
  });

  it("créances par apprenant : triées par restant dû, ancienneté du plus vieux retard", async () => {
    const page = unwrap(await getReceivablesByLearner(world.deps, ctx, { academicYear: YEAR, asOf: ASOF, limit: 10 }));
    expect(page.total).toBe(5); // l3 est soldé et exclu (onlyOutstanding par défaut)
    const outstanding = page.items.map((r) => r.outstanding.amount);
    expect([...outstanding].sort((a, b) => b - a)).toEqual(outstanding);
    const l6 = page.items.find((r) => r.learnerId === learners.l6)!;
    expect(l6.outstanding.amount).toBe(500_000);
    expect(l6.overdue.amount).toBe(250_000); // inscription (01/09) + 1re tranche (15/10) échues au 01/12
    expect(l6.oldestOverdueDate).toBe("2025-09-01");
    const l1 = page.items.find((r) => r.learnerId === learners.l1)!;
    expect(l1.collected.amount).toBe(250_000);
    expect(l1.collectionRateBps).toBe(5_000);
    const all = unwrap(await getReceivablesByLearner(world.deps, ctx, { academicYear: YEAR, asOf: ASOF, onlyOutstanding: false, limit: 2, offset: 0 }));
    expect(all.total).toBe(6);
    expect(all.items).toHaveLength(2);
  });

  it("balance âgée : tranches SQL = règles du domaine", async () => {
    const { invoices, installments } = await load();
    const rows = invoices.flatMap((inv) => installments.get(inv.id)!.map((installment) => ({ invoiceId: inv.id, status: inv.status, installment })));
    const expected = computeAgedBalance(rows, ASOF, "XOF");
    const report = unwrap(await getAgedBalance(world.deps, ctx, { academicYear: YEAR, asOf: ASOF, byLearner: 10 }));
    for (const b of AGING_BUCKETS) expect(report.buckets[b].amount.amount, b).toBe(expected[b].amount);
    const total = AGING_BUCKETS.reduce((a, b) => a + expected[b].amount, 0);
    expect(report.total.amount).toBe(total);
    // 01/09 → 91 jours (D91_PLUS), 15/10 → 47 jours (D31_60), 15/01 et 15/03 non échues
    expect(agingBucket(diffDays("2025-09-01", ASOF))).toBe("D91_PLUS");
    expect(agingBucket(diffDays("2025-10-15", ASOF))).toBe("D31_60");
    expect(report.buckets.D91_PLUS.amount.amount).toBeGreaterThan(0);
    expect(report.buckets.D31_60.amount.amount).toBeGreaterThan(0);
    expect(report.buckets.NOT_DUE.amount.amount).toBeGreaterThan(0);
    // détail par apprenant : la somme des tranches de chacun égale son total, et le tout égale la balance globale
    expect(report.learners.length).toBeGreaterThan(0);
    for (const l of report.learners) {
      expect(AGING_BUCKETS.reduce((a, b) => a + l.buckets[b].amount, 0)).toBe(l.total.amount);
    }
    expect(report.learners.reduce((a, l) => a + l.total.amount, 0)).toBe(total);
    // à une autre date, les tranches se décalent (au 01/03/2026 plus rien n'est « non échu » avant le 15/03)
    const later = unwrap(await getAgedBalance(world.deps, ctx, { academicYear: YEAR, asOf: "2026-04-01" }));
    expect(later.buckets.NOT_DUE.amount.amount).toBe(0);
    expect(later.total.amount).toBe(report.total.amount);
  });

  it("évolution des encaissements : seaux journaliers, hebdomadaires et mensuels sans trou, nets des remboursements", async () => {
    const days = unwrap(await getCollectionsTrend(world.deps, ctx, { from: "2025-09-01", to: "2025-11-30", granularity: "day" }));
    expect(days).toHaveLength(91);
    const at = (d: string) => days.find((p) => p.bucket === d)!;
    expect(at("2025-09-01").collected.amount).toBe(350_000); // l1 100 000 + l2 250 000
    expect(at("2025-09-01").paymentCount).toBe(2);
    expect(at("2025-09-10").collected.amount).toBe(500_000);
    expect(at("2025-09-02").collected.amount).toBe(0);
    expect(at("2025-10-20").collected.amount).toBe(100_000);
    expect(at("2025-11-05").collected.amount).toBe(150_000);
    expect(days.reduce((a, p) => a + p.collected.amount, 0)).toBe(1_100_000);

    const months = unwrap(await getCollectionsTrend(world.deps, ctx, { from: "2025-09-01", to: "2025-11-30", granularity: "month" }));
    expect(months.map((p) => p.bucket)).toEqual(["2025-09-01", "2025-10-01", "2025-11-01"]);
    expect(months.map((p) => p.collected.amount)).toEqual([850_000, 100_000, 150_000]);

    const weeks = unwrap(await getCollectionsTrend(world.deps, ctx, { from: "2025-09-01", to: "2025-11-30", granularity: "week" }));
    expect(weeks.reduce((a, p) => a + p.collected.amount, 0)).toBe(1_100_000);
    expect(weeks[0]!.bucket).toBe("2025-09-01"); // lundi
  });

  it("le remboursement exécuté vient en déduction dans l'évolution et dans le facturé net encaissé", async () => {
    const approver = ctxFor(tenantId);
    world.clock.set("2025-11-20T10:00:00.000Z");
    const refunds = await world.deps.db.run(ctx, (tx) => tx.many<{ id: string }>("SELECT id FROM finance.refunds WHERE status = 'REQUESTED'"));
    expect(refunds).toHaveLength(1);
    // l3 a payé par virement : pas de caisse requise pour l'exécutant
    unwrap(await approveRefund(world.deps, approver, { refundId: refunds[0]!.id }));
    world.clock.set(`${ASOF}T09:00:00.000Z`);

    const days = unwrap(await getCollectionsTrend(world.deps, ctx, { from: "2025-11-15", to: "2025-11-25" }));
    const d = days.find((p) => p.bucket === "2025-11-20")!;
    expect(d.refunded.amount).toBe(50_000);
    expect(d.net.amount).toBe(-50_000);
    const summary = unwrap(await getFinanceSummary(world.deps, ctx, { academicYear: YEAR, asOf: ASOF }));
    expect(summary.collected.amount).toBe(1_050_000);
    const { invoices } = await load();
    const ref = summarizeReceivables(invoices.map((i) => ({ status: i.status, total: i.total, paid: i.paid, credited: i.credited })), "XOF");
    expect(summary.collected.amount).toBe(ref.collected.amount);
    expect(summary.collectionRateBps).toBe(collectionRateBps(Money.of(1_050_000), Money.of(2_875_000)));
  });

  it("période invalide ou trop longue : refusée", async () => {
    expect((await getCollectionsTrend(world.deps, ctx, { from: "2025-12-01", to: "2025-11-01" })).ok).toBe(false);
    expect((await getCollectionsTrend(world.deps, ctx, { from: "2000-01-01", to: "2030-01-01", granularity: "day" })).ok).toBe(false);
    expect((await getCollectionsTrend(world.deps, ctx, { from: "2025-13-01", to: "2025-12-01" })).ok).toBe(false);
    expect((await getFinanceSummary(world.deps, ctx, { asOf: "pas-une-date" })).ok).toBe(false);
  });
});
