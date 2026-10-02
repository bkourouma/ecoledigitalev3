/**
 * Lectures « solde » additives pour stateassign (spec 014 AC5.5) : `getLearnerStanding`, `getLinkedInvoicesTotals`,
 * `getBilledAmounts` — Postgres réel, rôle soumis à la RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createScholarship, setLearnerFunding } from "../../application/catalog";
import { getBilledAmounts, getLearnerStanding, getLinkedInvoicesTotals } from "../../application/facts";
import { cancelInvoice, createInvoice, issueInvoiceFromSchedule, markOverdueInvoices } from "../../application/invoices";
import { createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { YEAR, learnerId, nextKey, pay, seedCatalog, xof } from "../support/scenario";

describeIntegration("lectures de solde : apprenant, factures liées à une bourse, montants facturés d'une inscription (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let otherTenantId: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createFinanceTestDb(24);
    world = makeWorld(db);
    tenantId = await db.createTenant();
    otherTenantId = await db.createTenant();
    ctx = ctxFor(tenantId);
    await seedCatalog(world.deps, ctx);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("apprenant sans facture : tout à zéro, jamais une erreur", async () => {
    const s = unwrap(await getLearnerStanding(world.deps, ctx, { learnerId: learnerId() }));
    expect(s).toMatchObject({ invoiceCount: 0, billed: 0, credited: 0, paid: 0, outstanding: 0, hasOverdue: false, currency: "XOF" });
  });

  it("solde : facturé, encaissé, reste dû ; une facture annulée ne compte pas ; le retard est signalé sans montant", async () => {
    const learner = learnerId();
    unwrap(await createInvoice(world.deps, ctx, { learnerId: learner, academicYear: YEAR, lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(100_000) }], dueDate: "2025-12-31", issue: true }));
    const cancelled = unwrap(await createInvoice(world.deps, ctx, { learnerId: learner, academicYear: YEAR, lines: [{ category: "CANTEEN", description: "Cantine", unitAmount: xof(30_000) }], dueDate: "2025-12-31", issue: true }));
    unwrap(await cancelInvoice(world.deps, ctx, { invoiceId: cancelled.invoices[0]!.invoice.id, reason: "Saisie erronée, facture annulée" }));
    unwrap(await pay(world.deps, ctx, learner, 40_000));

    const s = unwrap(await getLearnerStanding(world.deps, ctx, { learnerId: learner }));
    expect(s).toMatchObject({ invoiceCount: 1, billed: 100_000, paid: 40_000, credited: 0, outstanding: 60_000, hasOverdue: false });
    // filtre d'année : une année sans facture donne zéro
    expect(unwrap(await getLearnerStanding(world.deps, ctx, { learnerId: learner, academicYear: "1999-2000" })).billed).toBe(0);

    // le retard : échéance dépassée + job de marquage
    const late = learnerId();
    unwrap(await createInvoice(world.deps, ctx, { learnerId: late, academicYear: YEAR, lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(50_000) }], dueDate: "2020-01-31", issue: true }));
    unwrap(await markOverdueInvoices(world.deps, ctx));
    expect(unwrap(await getLearnerStanding(world.deps, ctx, { learnerId: late })).hasOverdue).toBe(true);
  });

  it("bourse État 60 % : totaux des factures liées (part de l'État) et montants facturés de l'inscription (famille / financeur)", async () => {
    const learner = learnerId();
    const enrollmentId = newId();
    world.enrollments.add({ enrollmentId, learnerId: learner, academicYear: YEAR, levelKey: "L1", trackKey: "INFO", learnerType: "PRIVATE" });
    unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-2025-9001" }));
    const sch = unwrap(
      await createScholarship(world.deps, ctx, {
        learnerId: learner,
        academicYear: YEAR,
        funderKind: "STATE",
        funderName: "État de Côte d'Ivoire",
        reference: "AFF-2025-9001",
        coverage: { kind: "PERCENT", bps: 6000 },
      }),
    );
    const r = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, enrollmentId, academicYear: YEAR, items: [{ feeCode: "SCOL" }], idempotencyKey: nextKey("sa") }));
    expect(r.invoices).toHaveLength(2);

    const linked = unwrap(await getLinkedInvoicesTotals(world.deps, ctx, sch.id));
    expect(linked).toMatchObject({ invoiceCount: 1, billed: 300_000, paid: 0, outstanding: 300_000 });

    const billed = unwrap(await getBilledAmounts(world.deps, ctx, { enrollmentId }));
    expect(billed.byPayer).toEqual({ LEARNER: 200_000, FUNDER: 300_000 });
    expect(billed.billed).toBe(500_000);
    expect(billed.invoiceCount).toBe(2);

    // une bourse inconnue ou une inscription inconnue : zéros
    expect(unwrap(await getLinkedInvoicesTotals(world.deps, ctx, newId())).billed).toBe(0);
    expect(unwrap(await getBilledAmounts(world.deps, ctx, { enrollmentId: newId() })).billed).toBe(0);
  });

  it("isolation : un autre tenant ne voit ni solde, ni factures liées, ni montants", async () => {
    const learner = learnerId();
    unwrap(await createInvoice(world.deps, ctx, { learnerId: learner, academicYear: YEAR, lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(70_000) }], dueDate: "2025-12-31", issue: true }));
    expect(unwrap(await getLearnerStanding(world.deps, ctx, { learnerId: learner })).billed).toBe(70_000);
    const other = ctxFor(otherTenantId);
    expect(unwrap(await getLearnerStanding(world.deps, other, { learnerId: learner })).billed).toBe(0);
  });
});
