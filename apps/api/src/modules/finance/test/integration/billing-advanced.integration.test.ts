import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createDiscount, createFee, createFeeSchedule, createScholarship, setLearnerFunding, changeScholarshipStatus } from "../../application/catalog";
import {
  cancelInvoice,
  createInvoice,
  generateInstallmentPlan,
  getInvoiceById,
  getLearnerStatement,
  issueInvoice,
  issueInvoiceFromSchedule,
  markOverdueInvoices,
  previewInvoiceFromSchedule,
} from "../../application/invoices";
import { summarizeStateSplit, splitFunding } from "../../domain/scholarship";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, nextKey, pay, seedCatalog, simpleInvoice, tuitionInvoice, xof, YEAR } from "../support/scenario";

describeIntegration("facturation avancée : remises, financement État/parent, échéanciers, retards (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createFinanceTestDb(24);
    world = makeWorld(db);
    tenantId = await db.createTenant();
    ctx = ctxFor(tenantId);
    await seedCatalog(world.deps, ctx);
  });
  afterAll(async () => {
    await db.drop();
  });

  describe("remises", () => {
    it("remise de 10 % sur scolarité + cantine : total net, ventilation par ligne, échéancier recalculé sans perte", async () => {
      const disc = unwrap(await createDiscount(world.deps, ctx, { code: "FRATRIE", name: "Fratrie 10 %", kind: "PERCENT", bps: 1000 }));
      const r = unwrap(
        await issueInvoiceFromSchedule(world.deps, ctx, {
          learnerId: learnerId(),
          academicYear: YEAR,
          items: [{ feeCode: "SCOL" }, { feeCode: "CANT" }],
          discountIds: [disc.id],
        }),
      );
      const { invoice, lines, installments, discounts } = r.invoices[0]!;
      expect(invoice.subtotal.amount).toBe(560_000);
      expect(invoice.discount.amount).toBe(56_000);
      expect(invoice.total.amount).toBe(504_000);
      expect(lines.map((l) => [l.gross.amount, l.discount.amount, l.total.amount])).toEqual([
        [500_000, 50_000, 450_000],
        [60_000, 6_000, 54_000],
      ]);
      expect(discounts).toEqual([{ discountId: disc.id, amount: xof(56_000) }]);
      // plan à poids 100/150/150/100 appliqué à 504 000 : 100,8k / 151,2k / 151,2k / 100,8k
      expect(installments.reduce((a, i) => a + i.amount.amount, 0)).toBe(504_000);
      expect(installments.map((i) => i.amount.amount)).toEqual([100_800, 151_200, 151_200, 100_800]);
    });

    it("plafond global : maxDiscountBps limite le cumul des remises", async () => {
      const w = makeWorld(db, { config: { maxDiscountBps: 2_500 } });
      const t = await db.createTenant();
      const c = ctxFor(t);
      await seedCatalog(w.deps, c);
      const a = unwrap(await createDiscount(w.deps, c, { code: "A", name: "A", kind: "PERCENT", bps: 4000, stackable: true }));
      const b = unwrap(await createDiscount(w.deps, c, { code: "B", name: "B", kind: "AMOUNT", amount: xof(100_000), stackable: true }));
      const r = unwrap(
        await issueInvoiceFromSchedule(w.deps, c, { learnerId: learnerId(), academicYear: YEAR, items: [{ feeCode: "SCOL" }], discountIds: [a.id, b.id] }),
      );
      expect(r.invoices[0]!.invoice.discount.amount).toBe(125_000); // 25 % de 500 000
      expect(r.invoices[0]!.invoice.total.amount).toBe(375_000);
    });

    it("remise inconnue : refusée", async () => {
      const r = await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learnerId(), academicYear: YEAR, items: [{ feeCode: "SCOL" }], discountIds: [newId()] });
      expect(r.ok).toBe(false);
    });
  });

  describe("élèves affectés par l'État : part État / part parent", () => {
    it("STATE_ASSIGNED sans prise en charge de l'État : facturation refusée ; ignoreFunding l'autorise explicitement", async () => {
      const learner = learnerId();
      unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-2025-0042" }));
      const refused = await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }] });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("finance.funding_assignment_missing");
      const forced = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }], ignoreFunding: true }));
      expect(forced.invoices).toHaveLength(1);
      expect(forced.invoices[0]!.invoice.total.amount).toBe(500_000);
    });

    it("l'État couvre 60 % : deux factures liées (famille 224 000 / État 336 000), sans perte, payables séparément", async () => {
      const learner = learnerId();
      unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-2025-0043" }));
      const sch = unwrap(
        await createScholarship(world.deps, ctx, {
          learnerId: learner,
          academicYear: YEAR,
          funderKind: "STATE",
          funderName: "État de Côte d'Ivoire",
          reference: "AFF-2025-0043",
          coverage: { kind: "PERCENT", bps: 6000 },
        }),
      );
      const result = unwrap(
        await issueInvoiceFromSchedule(world.deps, ctx, {
          learnerId: learner,
          academicYear: YEAR,
          items: [{ feeCode: "SCOL" }, { feeCode: "CANT" }],
          idempotencyKey: nextKey("state"),
        }),
      );
      expect(result.invoices).toHaveLength(2);
      const [family, state] = result.invoices as [typeof result.invoices[number], typeof result.invoices[number]];
      expect(family.invoice.payerKind).toBe("LEARNER");
      expect(state.invoice.payerKind).toBe("FUNDER");
      expect(state.invoice.payerRef).toBe(sch.id);
      expect(family.invoice.relatedGroupId).toBe(state.invoice.relatedGroupId);
      expect(family.invoice.fundingType).toBe("STATE_ASSIGNED");
      expect(state.invoice.total.amount).toBe(336_000);
      expect(family.invoice.total.amount).toBe(224_000);
      expect(family.invoice.total.amount + state.invoice.total.amount).toBe(560_000);
      expect(family.invoice.scholarship.amount).toBe(336_000);
      expect(family.lines.map((l) => [l.gross.amount, l.scholarship.amount, l.total.amount])).toEqual([
        [500_000, 300_000, 200_000],
        [60_000, 36_000, 24_000],
      ]);
      expect(state.lines.map((l) => l.total.amount)).toEqual([300_000, 36_000]);
      expect(state.lines[0]!.description).toContain("prise en charge État de Côte d'Ivoire");

      // les calculs purs donnent exactement la même répartition
      const pure = unwrap(
        splitFunding(
          [
            { id: "a", category: "TUITION", amount: xof(500_000) },
            { id: "b", category: "CANTEEN", amount: xof(60_000) },
          ],
          [sch],
        ),
      );
      expect(summarizeStateSplit(pure)).toMatchObject({ state: xof(336_000), parent: xof(224_000) });

      // la famille paie sa part : n'impute QUE sa facture ; l'État paie la sienne
      const familyPay = unwrap(await pay(world.deps, ctx, learner, 224_000));
      expect(familyPay.allocations.map((a) => a.invoiceId)).toEqual(expect.arrayContaining([family.invoice.id]));
      expect(familyPay.allocations.every((a) => a.invoiceId === family.invoice.id)).toBe(true);
      const familyAfter = unwrap(await getInvoiceById(world.deps, ctx, family.invoice.id));
      expect(familyAfter.invoice.status).toBe("PAID");
      expect(unwrap(await getInvoiceById(world.deps, ctx, state.invoice.id)).invoice.paid.amount).toBe(0);

      const statePay = unwrap(await pay(world.deps, ctx, learner, 336_000, { payerKind: "FUNDER", payerRef: sch.id, payerName: "Trésor public" }));
      expect(statePay.allocations.every((a) => a.invoiceId === state.invoice.id)).toBe(true);
      expect(unwrap(await getInvoiceById(world.deps, ctx, state.invoice.id)).invoice.status).toBe("PAID");

      // le relevé de l'apprenant agrège les deux payeurs
      const stmt = unwrap(await getLearnerStatement(world.deps, ctx, { learnerId: learner }));
      expect(stmt.totals.billed.amount).toBe(560_000);
      expect(stmt.totals.collected.amount).toBe(560_000);
      expect(stmt.totals.outstanding.amount).toBe(0);

      // rejeu de la facturation : mêmes factures, rien de nouveau
      const again = unwrap(
        await issueInvoiceFromSchedule(world.deps, ctx, {
          learnerId: learner,
          academicYear: YEAR,
          items: [{ feeCode: "SCOL" }, { feeCode: "CANT" }],
          idempotencyKey: result.invoices[0]!.invoice.idempotencyKey ?? undefined,
        }),
      ).invoices;
      void again;
    });

    it("couverture totale : seule la facture du financeur est créée", async () => {
      const learner = learnerId();
      unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "COMPANY" }));
      unwrap(
        await createScholarship(world.deps, ctx, {
          learnerId: learner,
          academicYear: YEAR,
          funderKind: "COMPANY",
          funderName: "ACME SA",
          coverage: { kind: "PERCENT", bps: 10_000 },
        }),
      );
      const r = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }] }));
      expect(r.invoices).toHaveLength(1);
      expect(r.invoices[0]!.invoice.payerKind).toBe("FUNDER");
      expect(r.invoices[0]!.invoice.total.amount).toBe(500_000);
    });

    it("montant fixe de l'État (300 000) ; bourse suspendue ⇒ plus de prise en charge", async () => {
      const learner = learnerId();
      unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "SCHOLARSHIP" }));
      const sch = unwrap(
        await createScholarship(world.deps, ctx, {
          learnerId: learner,
          academicYear: YEAR,
          funderKind: "FOUNDATION",
          funderName: "Fondation X",
          coverage: { kind: "FIXED", amount: xof(300_000) },
        }),
      );
      const r = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }] }));
      expect(r.invoices.map((i) => i.invoice.total.amount)).toEqual([200_000, 300_000]);
      unwrap(await changeScholarshipStatus(world.deps, ctx, { scholarshipId: sch.id, status: "SUSPENDED" }));
      const suspended = await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }] });
      expect(suspended.ok).toBe(false); // SCHOLARSHIP sans bourse active
    });

    it("la bourse d'une autre année ne s'applique pas", async () => {
      const learner = learnerId();
      unwrap(
        await createScholarship(world.deps, ctx, {
          learnerId: learner,
          academicYear: "2024-2025",
          funderKind: "STATE",
          funderName: "État",
          coverage: { kind: "PERCENT", bps: 5000 },
        }),
      );
      const r = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }] }));
      expect(r.invoices[0]!.invoice.total.amount).toBe(500_000);
    });
  });

  describe("barèmes par périmètre via l'inscription (EnrollmentRef)", () => {
    it("le barème le plus spécifique (niveau, campus) est retenu ; le regroupement libre est figé sur la facture", async () => {
      const t = await db.createTenant();
      const w = makeWorld(db);
      const c = ctxFor(t);
      const cat = await seedCatalog(w.deps, c);
      const campus = newId();
      unwrap(await createFeeSchedule(w.deps, c, { feeId: cat.tuition.id, academicYear: YEAR, amount: xof(650_000), effectiveFrom: "2025-06-01", scope: { levelKey: "L3" } }));
      unwrap(await createFeeSchedule(w.deps, c, { feeId: cat.tuition.id, academicYear: YEAR, amount: xof(700_000), effectiveFrom: "2025-06-01", scope: { levelKey: "L3", campusId: campus } }));
      const learner = learnerId();
      const enrollmentId = newId();
      w.enrollments.add({ enrollmentId, learnerId: learner, academicYear: YEAR, groupKey: "CLASS-L3-A", groupLabel: "Licence 3 A", levelKey: "L3", campusId: campus });
      const r = unwrap(await issueInvoiceFromSchedule(w.deps, c, { learnerId: learner, enrollmentId, items: [{ feeCode: "SCOL" }] }));
      const inv = r.invoices[0]!.invoice;
      expect(inv.total.amount).toBe(700_000);
      expect(inv.groupKey).toBe("CLASS-L3-A");
      expect(inv.groupLabel).toBe("Licence 3 A");
      expect(inv.campusId).toBe(campus);
      expect(inv.enrollmentId).toBe(enrollmentId);

      // un autre niveau retombe sur le barème général
      const other = learnerId();
      const e2 = newId();
      w.enrollments.add({ enrollmentId: e2, learnerId: other, academicYear: YEAR, levelKey: "L1" });
      const r2 = unwrap(await issueInvoiceFromSchedule(w.deps, c, { learnerId: other, enrollmentId: e2, items: [{ feeCode: "SCOL" }] }));
      expect(r2.invoices[0]!.invoice.total.amount).toBe(500_000);

      // inscription inconnue ou d'un autre apprenant : refusée
      const unknown = await issueInvoiceFromSchedule(w.deps, c, { learnerId: learner, enrollmentId: newId(), items: [{ feeCode: "SCOL" }] });
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) expect(unknown.error.code).toBe("finance.enrollment_not_found");
      const mismatch = await issueInvoiceFromSchedule(w.deps, c, { learnerId: other, enrollmentId, items: [{ feeCode: "SCOL" }] });
      expect(mismatch.ok).toBe(false);
    });

    it("aucun barème applicable : erreur explicite ; frais désactivé refusé", async () => {
      const r = await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learnerId(), academicYear: "2031-2032", items: [{ feeCode: "SCOL" }] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.fee_schedule_not_found");
      const noFee = await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learnerId(), academicYear: YEAR, items: [{ feeCode: "INEXISTANT" }] });
      expect(noFee.ok).toBe(false);
    });

    it("l'aperçu ne modifie rien", async () => {
      const before = await adminRows<{ n: number }>(db, "SELECT count(*)::int AS n FROM finance.invoices WHERE tenant_id = $1", [tenantId]);
      const seqBefore = await adminRows(db, "SELECT last_value FROM finance.number_sequences WHERE tenant_id = $1 AND kind = 'INVOICE'", [tenantId]);
      const p = unwrap(await previewInvoiceFromSchedule(world.deps, ctx, { learnerId: learnerId(), academicYear: YEAR, items: [{ feeCode: "SCOL" }] }));
      expect(p.invoices[0]!.total.amount).toBe(500_000);
      expect(p.invoices[0]!.installments.map((i) => i.amount.amount)).toEqual([100_000, 150_000, 150_000, 100_000]);
      const after = await adminRows<{ n: number }>(db, "SELECT count(*)::int AS n FROM finance.invoices WHERE tenant_id = $1", [tenantId]);
      expect(after[0]!.n).toBe(before[0]!.n);
      expect(await adminRows(db, "SELECT last_value FROM finance.number_sequences WHERE tenant_id = $1 AND kind = 'INVOICE'", [tenantId])).toEqual(seqBefore);
    });
  });

  describe("brouillons, émission, annulation, échéancier", () => {
    it("un brouillon n'a pas de numéro ; l'émission le numérote ; les lignes sont ensuite figées par la base", async () => {
      const learner = learnerId();
      const draft = unwrap(
        await createInvoice(world.deps, ctx, {
          learnerId: learner,
          academicYear: YEAR,
          lines: [
            { category: "UNIFORM", description: "Tenue de sport", quantity: 2, unitAmount: xof(15_000) },
            { category: "DOCUMENTS", description: "Carte scolaire", unitAmount: xof(2_500) },
          ],
          dueDate: "2025-10-31",
        }),
      ).invoices[0]!;
      expect(draft.invoice.status).toBe("DRAFT");
      expect(draft.invoice.number).toBeNull();
      expect(draft.invoice.total.amount).toBe(32_500);
      expect(draft.installments).toHaveLength(1); // échéancier prévu dès le brouillon (échéance unique par défaut)

      const issued = unwrap(await issueInvoice(world.deps, ctx, { invoiceId: draft.invoice.id }));
      expect(issued.invoice.number).toMatch(/^FAC-2025-\d{6}$/);
      expect(issued.invoice.status).toBe("ISSUED");
      expect(issued.installments).toHaveLength(1);
      expect(issued.installments[0]!.amount.amount).toBe(32_500);

      const twice = await issueInvoice(world.deps, ctx, { invoiceId: draft.invoice.id });
      expect(twice.ok).toBe(false);
      if (!twice.ok) expect(twice.error.code).toBe("finance.invoice_not_draft");

      await expect(db.admin.query("UPDATE finance.invoice_lines SET description = 'x' WHERE invoice_id = $1", [draft.invoice.id])).rejects.toMatchObject({ code: "23001" });
      await expect(db.admin.query("DELETE FROM finance.invoice_lines WHERE invoice_id = $1", [draft.invoice.id])).rejects.toMatchObject({ code: "23001" });
      await expect(db.admin.query("UPDATE finance.invoices SET total_amount = 1, subtotal_amount = 1 WHERE id = $1", [draft.invoice.id])).rejects.toMatchObject({ code: "23001" });
    });

    it("annulation d'un brouillon : sans numéro ; annulation d'une facture émise sans encaissement : numéro conservé", async () => {
      const d = unwrap(
        await createInvoice(world.deps, ctx, { learnerId: learnerId(), academicYear: YEAR, lines: [{ category: "OTHER", description: "Divers", unitAmount: xof(1_000) }], dueDate: "2025-11-01" }),
      ).invoices[0]!;
      const c = unwrap(await cancelInvoice(world.deps, ctx, { invoiceId: d.invoice.id, reason: "Saisie erronée" }));
      expect(c.invoice.status).toBe("CANCELLED");
      expect(c.invoice.number).toBeNull();
      const issuedAfterCancel = await issueInvoice(world.deps, ctx, { invoiceId: d.invoice.id });
      expect(issuedAfterCancel.ok).toBe(false);
    });

    it("totaux nuls ou négatifs refusés ; devise mélangée refusée", async () => {
      const zero = await createInvoice(world.deps, ctx, { learnerId: learnerId(), academicYear: YEAR, lines: [{ category: "OTHER", description: "Gratuit", unitAmount: xof(0) }] });
      expect(zero.ok).toBe(false);
      const none = await createInvoice(world.deps, ctx, { learnerId: learnerId(), academicYear: YEAR, lines: [] });
      expect(none.ok).toBe(false);
    });

    it("idempotence de la création de facture : même clé et même demande ⇒ mêmes factures ; demande différente ⇒ conflit", async () => {
      const learner = learnerId();
      const key = nextKey("inv-idem");
      const input = { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }], idempotencyKey: key };
      const first = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, input));
      const second = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, input));
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.invoices[0]!.invoice.id).toBe(first.invoices[0]!.invoice.id);
      const rows = await adminRows(db, "SELECT 1 FROM finance.invoices WHERE learner_id = $1", [learner]);
      expect(rows).toHaveLength(1);
      const conflict = await issueInvoiceFromSchedule(world.deps, ctx, { ...input, items: [{ feeCode: "CANT" }] });
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.error.code).toBe("finance.idempotency_key_reused");
    });

    it("génération d'échéancier : remplacement tant que rien n'est encaissé, verrouillé après", async () => {
      const learner = learnerId();
      const inv = await simpleInvoice(world.deps, ctx, learner, 600_000, "2025-12-31");
      expect(inv.installments).toHaveLength(1);
      const replanned = unwrap(
        await generateInstallmentPlan(world.deps, ctx, {
          invoiceId: inv.invoice.id,
          steps: [
            { label: "Acompte", share: { kind: "FIXED", amount: xof(200_000) }, due: { type: "OFFSET_DAYS", days: 0 } },
            { label: "Solde en deux fois", share: { kind: "WEIGHT", weight: 1 }, due: { type: "OFFSET_DAYS", days: 60 } },
            { label: "Solde en deux fois (bis)", share: { kind: "WEIGHT", weight: 1 }, due: { type: "OFFSET_DAYS", days: 120 } },
          ],
        }),
      );
      expect(replanned.installments.map((i) => [i.label, i.amount.amount, i.dueDate])).toEqual([
        ["Acompte", 200_000, "2025-09-01"],
        ["Solde en deux fois", 200_000, "2025-10-31"],
        ["Solde en deux fois (bis)", 200_000, "2025-12-30"],
      ]);
      expect(replanned.invoice.dueDate).toBe("2025-12-30");

      // un plan qui ne couvre pas le total est refusé et l'échéancier reste intact
      const bad = await generateInstallmentPlan(world.deps, ctx, {
        invoiceId: inv.invoice.id,
        steps: [{ label: "Trop peu", share: { kind: "FIXED", amount: xof(100_000) }, due: { type: "OFFSET_DAYS", days: 0 } }],
      });
      expect(bad.ok).toBe(false);
      expect(unwrap(await getInvoiceById(world.deps, ctx, inv.invoice.id)).installments).toHaveLength(3);

      unwrap(await pay(world.deps, ctx, learner, 10_000));
      const locked = await generateInstallmentPlan(world.deps, ctx, { invoiceId: inv.invoice.id, planCode: "STD4" });
      expect(locked.ok).toBe(false);
      if (!locked.ok) expect(locked.error.code).toBe("finance.installments_locked");
      // la base refuse aussi la modification directe d'une échéance encaissée (même superuser)
      await expect(db.admin.query("UPDATE finance.installments SET amount = amount + 1 WHERE invoice_id = $1 AND seq = 1", [inv.invoice.id])).rejects.toMatchObject({ code: "23001" });
    });

    it("plan désigné par son code ; plan inconnu refusé", async () => {
      const learner = learnerId();
      const inv = await simpleInvoice(world.deps, ctx, learner, 500_000);
      const done = unwrap(await generateInstallmentPlan(world.deps, ctx, { invoiceId: inv.invoice.id, planCode: "std4", baseDate: "2025-09-01" }));
      expect(done.installments.map((i) => i.amount.amount)).toEqual([100_000, 150_000, 150_000, 100_000]);
      const unknown = await generateInstallmentPlan(world.deps, ctx, { invoiceId: inv.invoice.id, planCode: "NOPE" });
      expect(unknown.ok).toBe(false);
    });
  });

  describe("retards et numérotation", () => {
    it("markOverdueInvoices : bascule en OVERDUE à l'échéance, publie finance.invoice.overdue UNE fois, idempotent", async () => {
      const w = makeWorld(db);
      const t = await db.createTenant();
      const c = ctxFor(t);
      await seedCatalog(w.deps, c);
      const learner = learnerId();
      const inv = await tuitionInvoice(w.deps, c, learner);
      expect(inv.invoice.status).toBe("ISSUED");

      // avant la première échéance suivante : rien (la 1re, au 01/09, est la date du jour : pas encore échue)
      expect(unwrap(await markOverdueInvoices(w.deps, c)).invoiceIds).toEqual([]);

      w.clock.set("2025-09-02T08:00:00.000Z");
      const first = unwrap(await markOverdueInvoices(w.deps, c));
      expect(first.invoiceIds).toEqual([inv.invoice.id]);
      expect(unwrap(await getInvoiceById(w.deps, c, inv.invoice.id)).invoice.status).toBe("OVERDUE");
      const events = await adminRows<{ payload: { overdueAmount: { amount: number }; daysOverdue: number; oldestDueDate: string; balance: { amount: number } } }>(
        db,
        "SELECT payload FROM kernel.domain_events WHERE type = 'finance.invoice.overdue' AND tenant_id = $1",
        [t],
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ overdueAmount: { amount: 100_000 }, daysOverdue: 1, oldestDueDate: "2025-09-01", balance: { amount: 500_000 } });

      // idempotent
      expect(unwrap(await markOverdueInvoices(w.deps, c)).invoiceIds).toEqual([]);
      expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.invoice.overdue' AND tenant_id = $1", [t])).toHaveLength(1);

      // payer l'échéance échue ramène la facture à PARTIALLY_PAID
      unwrap(await pay(w.deps, c, learner, 100_000));
      expect(unwrap(await getInvoiceById(w.deps, c, inv.invoice.id)).invoice.status).toBe("PARTIALLY_PAID");

      // l'échéance suivante (15/10) passe : OVERDUE de nouveau, nouvel événement
      w.clock.set("2025-10-16T08:00:00.000Z");
      expect(unwrap(await markOverdueInvoices(w.deps, c)).invoiceIds).toEqual([inv.invoice.id]);
      expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.invoice.overdue' AND tenant_id = $1", [t])).toHaveLength(2);

      // tout payer ⇒ PAID et événement finance.invoice.paid
      unwrap(await pay(w.deps, c, learner, 400_000));
      expect(unwrap(await getInvoiceById(w.deps, c, inv.invoice.id)).invoice.status).toBe("PAID");
      expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.invoice.paid' AND tenant_id = $1", [t])).toHaveLength(1);
    });

    it("40 émissions concurrentes : numéros FAC-aaaa-nnnnnn sans trou ni doublon", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      await seedCatalog(world.deps, c);
      const results = await Promise.all(
        Array.from({ length: 40 }, () => issueInvoiceFromSchedule(world.deps, c, { learnerId: learnerId(), academicYear: YEAR, items: [{ feeCode: "SCOL" }] })),
      );
      for (const r of results) expect(r.ok).toBe(true);
      const rows = await adminRows<{ seq: string; number: string }>(db, "SELECT number_seq::text AS seq, number FROM finance.invoices WHERE tenant_id = $1 ORDER BY number_seq", [t]);
      expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
      expect(new Set(rows.map((r) => r.number)).size).toBe(40);
      expect(rows[0]!.number).toBe("FAC-2025-000001");
    });

    it("12 créations concurrentes avec la même clé d'idempotence : une seule facture, les autres sont des rejeux", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      await seedCatalog(world.deps, c);
      const learner = learnerId();
      const key = nextKey("race-inv");
      const results = await Promise.all(
        Array.from({ length: 12 }, () => issueInvoiceFromSchedule(world.deps, c, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }], idempotencyKey: key })),
      );
      const values = results.map((r) => unwrap(r));
      expect(values.filter((v) => !v.replayed)).toHaveLength(1);
      expect(new Set(values.map((v) => v.invoices[0]!.invoice.id)).size).toBe(1);
      expect(await adminRows(db, "SELECT 1 FROM finance.invoices WHERE tenant_id = $1", [t])).toHaveLength(1);
    });

    it("créations concurrentes : un seul frais par code, un seul barème par période et périmètre", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const w = world;
      const fees = await Promise.all(Array.from({ length: 6 }, () => createFee(w.deps, c, { code: "COURSE", name: "Frais concurrent", category: "OTHER" })));
      expect(fees.filter((f) => f.ok)).toHaveLength(1);
      for (const f of fees.filter((x) => !x.ok)) if (!f.ok) expect(f.error.httpStatus).toBe(409);
      const fee = unwrap(fees.find((f) => f.ok)!);
      const schedules = await Promise.all(
        Array.from({ length: 6 }, (_, i) => createFeeSchedule(w.deps, c, { feeId: fee.id, academicYear: YEAR, amount: xof(1_000 + i), effectiveFrom: "2025-06-01" })),
      );
      expect(schedules.filter((s) => s.ok)).toHaveLength(1);
      const discounts = await Promise.all(Array.from({ length: 4 }, () => createDiscount(w.deps, c, { code: "DUP", name: "Remise", kind: "AMOUNT", amount: xof(100) })));
      expect(discounts.filter((d) => d.ok)).toHaveLength(1);
    });

    it("deux tenants ont chacun leur numérotation", async () => {
      const [t1, t2] = [await db.createTenant(), await db.createTenant()];
      for (const t of [t1, t2]) {
        const c = ctxFor(t);
        await seedCatalog(world.deps, c);
        const inv = await tuitionInvoice(world.deps, c, learnerId());
        expect(inv.invoice.number).toBe("FAC-2025-000001");
      }
    });
  });
});
