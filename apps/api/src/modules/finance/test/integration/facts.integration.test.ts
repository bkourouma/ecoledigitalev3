/**
 * Faits publiés pour la plateforme (extension du module) : charge ENRICHIE de `finance.invoice.paid`
 * (inscription visée, frais d'inscription, objets soldés), « frais d'inscription soldés », frais dus, impayé.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { financeInvoicePaidEventPayloadSchema } from "@ecoledigitale/contracts/src/v2/finance";
import { getInvoiceFacts, getRegistrationFeeStatus, hasOverdueBalance, isRegistrationFeeDue } from "../../application/facts";
import { createInvoice, getInvoiceById, markOverdueInvoices } from "../../application/invoices";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { YEAR, learnerId, pay, seedCatalog, xof } from "../support/scenario";

describeIntegration("faits publiés : frais d'inscription soldés, charge enrichie de finance.invoice.paid (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createFinanceTestDb(24);
    world = makeWorld(db);
    tenantId = await db.createTenant();
    ctx = ctxFor(tenantId);
  });
  afterAll(async () => {
    await db.drop();
  });

  function enroll(learner: string): string {
    const enrollmentId = newId();
    world.enrollments.add({ enrollmentId, learnerId: learner, academicYear: YEAR, levelKey: "L1", trackKey: "INFO", learnerType: "PRIVATE" });
    return enrollmentId;
  }

  it("la facture d'inscription soldée publie l'inscription visée, les frais d'inscription et les objets soldés", async () => {
    const learner = learnerId();
    const enrollmentId = enroll(learner);
    const courseRef = newId();
    const created = unwrap(
      await createInvoice(world.deps, ctx, {
        learnerId: learner,
        enrollmentId,
        lines: [
          { category: "REGISTRATION", description: "Frais d'inscription", unitAmount: xof(25_000) },
          { category: "TUITION", description: "UE à la carte", unitAmount: xof(75_000), sourceRef: courseRef },
        ],
        dueDate: "2025-12-31",
        issue: true,
      }),
    );
    const invoice = created.invoices[0]!;
    expect(invoice.lines.map((l) => [l.category, l.sourceRef])).toEqual([["REGISTRATION", null], ["TUITION", courseRef]]);

    // Avant paiement : facturés mais pas soldés.
    expect(unwrap(await getRegistrationFeeStatus(world.deps, ctx, { enrollmentId }))).toEqual({ invoiced: true, paid: false, invoiceIds: [invoice.invoice.id], status: "PENDING" });

    unwrap(await pay(world.deps, ctx, learner, 100_000));
    expect(unwrap(await getInvoiceById(world.deps, ctx, invoice.invoice.id)).invoice.status).toBe("PAID");

    const events = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'finance.invoice.paid' AND tenant_id = $1", [tenantId]);
    expect(events).toHaveLength(1);
    const payload = financeInvoicePaidEventPayloadSchema.parse(events[0]!.payload);
    expect(payload).toMatchObject({ invoiceId: invoice.invoice.id, learnerId: learner, enrollmentId, containsRegistrationFee: true });
    expect(payload.sourceRefs).toEqual([{ sourceRef: courseRef, category: "TUITION" }]);

    expect(unwrap(await getRegistrationFeeStatus(world.deps, ctx, { enrollmentId }))).toEqual({ invoiced: true, paid: true, invoiceIds: [invoice.invoice.id], status: "PAID" });
    expect(unwrap(await getInvoiceFacts(world.deps, ctx, invoice.invoice.id))).toEqual({
      invoiceId: invoice.invoice.id,
      learnerId: learner,
      enrollmentId,
      status: "PAID",
      lines: [{ category: "REGISTRATION", sourceRef: null }, { category: "TUITION", sourceRef: courseRef }],
    });
  });

  it("une facture sans frais d'inscription ni objet source : indicateurs faux et liste vide", async () => {
    const learner = learnerId();
    const enrollmentId = enroll(learner);
    const created = unwrap(await createInvoice(world.deps, ctx, { learnerId: learner, enrollmentId, lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(40_000) }], dueDate: "2025-12-31", issue: true }));
    unwrap(await pay(world.deps, ctx, learner, 40_000));
    const events = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'finance.invoice.paid' AND aggregate_id = $1", [created.invoices[0]!.invoice.id]);
    expect(financeInvoicePaidEventPayloadSchema.parse(events[0]!.payload)).toMatchObject({ enrollmentId, containsRegistrationFee: false, sourceRefs: [] });
    expect(unwrap(await getRegistrationFeeStatus(world.deps, ctx, { enrollmentId }))).toEqual({ invoiced: false, paid: false, invoiceIds: [], status: "NOT_BILLED" });
    expect(unwrap(await getInvoiceFacts(world.deps, ctx, newId()))).toBeNull();
  });

  it("frais d'inscription dus : barème applicable = dus ; aucun frais ou aucun barème applicable = non dus ; périmètre précis", async () => {
    const t = await db.createTenant();
    const c = ctxFor(t);
    const base = { academicYear: YEAR, onDate: "2025-09-01" };
    // Aucun frais d'inscription configuré : aucun frais dû (confirmation immédiate).
    expect(unwrap(await isRegistrationFeeDue(world.deps, c, base))).toBe(false);
    await seedCatalog(world.deps, c);
    expect(unwrap(await isRegistrationFeeDue(world.deps, c, { ...base, levelKey: "L1", trackKey: "INFO" }))).toBe(true);
    // Année sans barème : non dus.
    expect(unwrap(await isRegistrationFeeDue(world.deps, c, { academicYear: "2030-2031", onDate: "2030-09-01" }))).toBe(false);
  });

  it("impayé exigible : seule une facture en retard compte, sans montant ni détail", async () => {
    const t = await db.createTenant();
    const c = ctxFor(t);
    const learner = learnerId();
    expect(unwrap(await hasOverdueBalance(world.deps, c, learner))).toBe(false);
    unwrap(await createInvoice(world.deps, c, { learnerId: learner, academicYear: YEAR, lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(40_000) }], dueDate: "2025-10-01", issue: true }));
    expect(unwrap(await hasOverdueBalance(world.deps, c, learner))).toBe(false);
    world.clock.set("2025-11-15T08:00:00.000Z");
    unwrap(await markOverdueInvoices(world.deps, c));
    expect(unwrap(await hasOverdueBalance(world.deps, c, learner))).toBe(true);
    expect(unwrap(await hasOverdueBalance(world.deps, c, learnerId()))).toBe(false);
  });
});
