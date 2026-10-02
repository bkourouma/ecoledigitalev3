/**
 * Extensions Phase 4-5 de `finance` pour les packs (specs 005 §8, 006 §7.4, 007 §16) : frais d'inscription utilisables AVANT
 * facturation (`NOT_BILLED`), facturation idempotente par clé d'offre, annulation d'une facture sans paiement, catégories de
 * frais du modèle de pack (libellés, aucun montant).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { getRegistrationFeeStatus, isRegistrationFeeDue } from "../../application/facts";
import { cancelInvoice, getInvoiceById, issueInvoiceFromSchedule } from "../../application/invoices";
import { instantiateFinancePack } from "../../application/pack";
import { setFeeStatus } from "../../application/catalog";
import { registrationFeeStateOf } from "../../application/facts";
import { FINANCE_PACK_TEMPLATES } from "../../domain/pack-template";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { YEAR, learnerId, pay, seedCatalog } from "../support/scenario";

describeIntegration("frais d'inscription avant facturation, facturation par offre, annulation (Postgres réel)", () => {
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

  function enroll(learner: string): string {
    const enrollmentId = newId();
    world.enrollments.add({ enrollmentId, learnerId: learner, academicYear: YEAR, levelKey: "L1", trackKey: "INFO", learnerType: "PRIVATE" });
    return enrollmentId;
  }
  const codeOf = (r: { ok: boolean; error?: unknown }): string | undefined => (r.ok ? undefined : (r.error as { code: string }).code);
  const offerKey = (offerId: string, what = "registration"): string => `admission:${offerId}:${what}`;

  describe("getRegistrationFeeStatus / isRegistrationFeeDue avant facturation", () => {
    it("aucune facture : NOT_BILLED, ni erreur ni « payé » ; inscription inconnue de finance : même réponse", async () => {
      const learner = learnerId();
      const enrollmentId = enroll(learner);
      expect(unwrap(await getRegistrationFeeStatus(world.deps, ctx, { enrollmentId }))).toEqual({ invoiced: false, paid: false, invoiceIds: [], status: "NOT_BILLED" });
      expect(unwrap(await getRegistrationFeeStatus(world.deps, ctx, { enrollmentId: newId() }))).toMatchObject({ invoiced: false, paid: false, status: "NOT_BILLED" });
    });

    it("les frais sont dus avant toute facture (barème applicable) ; non dus sans barème : l'appelant décide de facturer ou de confirmer", async () => {
      const q = { academicYear: YEAR, onDate: "2025-09-01", levelKey: "L1", trackKey: "INFO" };
      expect(unwrap(await isRegistrationFeeDue(world.deps, ctx, q))).toBe(true);
      expect(unwrap(await isRegistrationFeeDue(world.deps, ctx, { academicYear: "2031-2032", onDate: "2031-09-01" }))).toBe(false);
    });

    it("NOT_BILLED -> PENDING (facture émise) -> PAID (soldée) ; une facture annulée n'est plus comptée", async () => {
      const learner = learnerId();
      const enrollmentId = enroll(learner);
      const key = offerKey(newId());
      const issued = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, enrollmentId, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: key }));
      const invoiceId = issued.invoices[0]!.invoice.id;
      expect(unwrap(await getRegistrationFeeStatus(world.deps, ctx, { enrollmentId }))).toMatchObject({ status: "PENDING", invoiced: true, paid: false, invoiceIds: [invoiceId] });
      unwrap(await cancelInvoice(world.deps, ctx, { invoiceId, reason: "Retrait de la famille avant paiement" }));
      expect(unwrap(await getRegistrationFeeStatus(world.deps, ctx, { enrollmentId }))).toMatchObject({ status: "NOT_BILLED", invoiced: false, paid: false, invoiceIds: [] });

      const learner2 = learnerId();
      const enrollment2 = enroll(learner2);
      unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner2, enrollmentId: enrollment2, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: offerKey(newId()) }));
      unwrap(await pay(world.deps, ctx, learner2, 25_000));
      expect(unwrap(await getRegistrationFeeStatus(world.deps, ctx, { enrollmentId: enrollment2 }))).toMatchObject({ status: "PAID", invoiced: true, paid: true });
    });

    it("état pur : aucune facture = NOT_BILLED ; une facture non soldée parmi d'autres = PENDING", () => {
      expect(registrationFeeStateOf([])).toBe("NOT_BILLED");
      expect(registrationFeeStateOf(["PAID"])).toBe("PAID");
      expect(registrationFeeStateOf(["PAID", "ISSUED"])).toBe("PENDING");
      expect(registrationFeeStateOf(["OVERDUE"])).toBe("PENDING");
    });
  });

  describe("issueInvoiceFromSchedule idempotent par clé d'offre", () => {
    it("même clé (identifiant d'offre) et même demande : même facture, aucun doublon, aucun numéro consommé ; demande différente : conflit", async () => {
      const learner = learnerId();
      const enrollmentId = enroll(learner);
      const key = offerKey(newId());
      const input = { learnerId: learner, enrollmentId, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: key };
      const first = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, input));
      const again = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, input));
      expect(first.replayed).toBe(false);
      expect(again.replayed).toBe(true);
      expect(again.invoices[0]!.invoice.id).toBe(first.invoices[0]!.invoice.id);
      expect(again.invoices[0]!.invoice.number).toBe(first.invoices[0]!.invoice.number);
      const rows = await adminRows(db, "SELECT 1 FROM finance.invoices WHERE tenant_id = $1 AND idempotency_key = $2", [tenantId, key]);
      expect(rows).toHaveLength(1);
      const different = await issueInvoiceFromSchedule(world.deps, ctx, { ...input, items: [{ feeCode: "SCOL" }] });
      expect(codeOf(different)).toBe("finance.idempotency_key_reused");
    });

    it("une clé UUID nue (identifiant d'offre) est acceptée ; la contrainte d'unicité SQL est la dernière barrière", async () => {
      const learner = learnerId();
      const offerId = newId();
      const first = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: offerId }));
      expect(first.replayed).toBe(false);
      const unique = await adminRows<{ def: string }>(db, "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'finance.invoices'::regclass AND contype = 'u'");
      expect(unique.some((u) => u.def.includes("tenant_id") && u.def.includes("idempotency_key"))).toBe(true);
      expect(await adminRows(db, "SELECT 1 FROM finance.invoices WHERE tenant_id = $1 AND idempotency_key = $2", [tenantId, offerId])).toHaveLength(1);
    });

    it("20 acceptations simultanées de la même offre : une seule facture, les autres rejouent, numérotation sans trou", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      await seedCatalog(world.deps, c);
      const learner = learnerId();
      const key = offerKey(newId());
      const results = await Promise.all(
        Array.from({ length: 20 }, () => issueInvoiceFromSchedule(world.deps, c, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: key })),
      );
      const values = results.map((r) => unwrap(r));
      expect(values.filter((v) => !v.replayed)).toHaveLength(1);
      expect(new Set(values.map((v) => v.invoices[0]!.invoice.id)).size).toBe(1);
      const rows = await adminRows<{ seq: string }>(db, "SELECT number_seq::text AS seq FROM finance.invoices WHERE tenant_id = $1 ORDER BY number_seq", [t]);
      expect(rows.map((r) => Number(r.seq))).toEqual([1]);
    });

    it("deux clés d'offre (inscription, scolarité) pour la même famille : deux factures distinctes, chacune rejouable", async () => {
      const learner = learnerId();
      const offerId = newId();
      const reg = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: offerKey(offerId, "registration") }));
      const tui = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }], idempotencyKey: offerKey(offerId, "tuition") }));
      expect(reg.invoices[0]!.invoice.id).not.toBe(tui.invoices[0]!.invoice.id);
      expect(unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: offerKey(offerId, "registration") })).replayed).toBe(true);
    });
  });

  describe("cancelInvoice sur facture sans paiement", () => {
    it("CANCELLED, motif obligatoire, audit sensible, événement finance.invoice.cancelled publié une fois, numéro conservé", async () => {
      const learner = learnerId();
      const issued = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: offerKey(newId()) })).invoices[0]!;
      const invoiceId = issued.invoice.id;
      expect(codeOf(await cancelInvoice(world.deps, ctx, { invoiceId, reason: "" }))).toBeDefined();
      expect(codeOf(await cancelInvoice(world.deps, ctx, { invoiceId, reason: "   " }))).toBeDefined();
      expect(unwrap(await getInvoiceById(world.deps, ctx, invoiceId)).invoice.status).toBe("ISSUED");
      const cancelled = unwrap(await cancelInvoice(world.deps, ctx, { invoiceId, reason: "Délai de paiement dépassé" }));
      expect(cancelled.invoice.status).toBe("CANCELLED");
      expect(cancelled.invoice.number).toBe(issued.invoice.number);
      const events = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'finance.invoice.cancelled' AND aggregate_id = $1", [invoiceId]);
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ v: 1, invoiceId, learnerId: learner });
      const audit = world.audit.entries.filter((e) => e.entry.action === "finance.invoice.cancelled" && e.entry.resourceId === invoiceId);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.entry).toMatchObject({ sensitive: true });
      // une facture déjà annulée ne s'annule pas deux fois (pas de second événement)
      expect(codeOf(await cancelInvoice(world.deps, ctx, { invoiceId, reason: "Encore" }))).toBeDefined();
      expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.invoice.cancelled' AND aggregate_id = $1", [invoiceId])).toHaveLength(1);
    });

    it("refusée dès qu'un paiement est imputé : finance.invoice_has_payments (remboursement puis avoir) ; rien n'est écrit", async () => {
      const learner = learnerId();
      const issued = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: offerKey(newId()) })).invoices[0]!;
      unwrap(await pay(world.deps, ctx, learner, 10_000));
      const refused = await cancelInvoice(world.deps, ctx, { invoiceId: issued.invoice.id, reason: "Tentative" });
      expect(codeOf(refused)).toBe("finance.invoice_has_payments");
      expect(unwrap(await getInvoiceById(world.deps, ctx, issued.invoice.id)).invoice.status).toBe("PARTIALLY_PAID");
      expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.invoice.cancelled' AND aggregate_id = $1", [issued.invoice.id])).toHaveLength(0);
    });

    it("l'annulation puis le rejeu de la même clé renvoient la facture annulée (jamais une seconde facture)", async () => {
      const learner = learnerId();
      const key = offerKey(newId());
      const input = { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "INSC" }], idempotencyKey: key };
      const issued = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, input)).invoices[0]!;
      unwrap(await cancelInvoice(world.deps, ctx, { invoiceId: issued.invoice.id, reason: "Offre retirée" }));
      const replay = unwrap(await issueInvoiceFromSchedule(world.deps, ctx, input));
      expect(replay.replayed).toBe(true);
      expect(replay.invoices[0]!.invoice).toMatchObject({ id: issued.invoice.id, status: "CANCELLED" });
    });
  });

  describe("modèle de pack finance : catégories REGISTRATION / TUITION, aucun montant", () => {
    it("PRIMARY et SECONDARY : deux frais sans barème ; idempotent, non destructif ; HIGHER et pack inconnu : rien", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const first = unwrap(await instantiateFinancePack(world.deps, c, { pack: "PRIMARY" }));
      expect(first).toEqual({ created: ["REGISTRATION", "TUITION"], existing: [] });
      const fees = await adminRows<{ code: string; category: string; active: boolean }>(db, "SELECT code, category, active FROM finance.fees WHERE tenant_id = $1 ORDER BY code", [t]);
      expect(fees).toEqual([
        { code: "REGISTRATION", category: "REGISTRATION", active: true },
        { code: "TUITION", category: "TUITION", active: true },
      ]);
      // aucun montant, aucun barème, aucun échéancier
      expect(await adminRows(db, "SELECT 1 FROM finance.fee_schedules WHERE tenant_id = $1", [t])).toHaveLength(0);
      expect(await adminRows(db, "SELECT 1 FROM finance.installment_plans WHERE tenant_id = $1", [t])).toHaveLength(0);
      // frais sans barème : jamais « dus »
      expect(unwrap(await isRegistrationFeeDue(world.deps, c, { academicYear: YEAR, onDate: "2025-09-01" }))).toBe(false);
      // l'établissement désactive un frais : un nouvel amorçage n'y touche pas
      const reg = fees.find((f) => f.code === "REGISTRATION")!;
      const regId = (await adminRows<{ id: string }>(db, "SELECT id FROM finance.fees WHERE tenant_id = $1 AND code = 'REGISTRATION'", [t]))[0]!.id;
      void reg;
      unwrap(await setFeeStatus(world.deps, c, { feeId: regId, active: false }));
      expect(unwrap(await instantiateFinancePack(world.deps, c, { pack: "SECONDARY" }))).toEqual({ created: [], existing: ["REGISTRATION", "TUITION"] });
      expect((await adminRows<{ active: boolean }>(db, "SELECT active FROM finance.fees WHERE id = $1", [regId]))[0]!.active).toBe(false);
      expect(unwrap(await instantiateFinancePack(world.deps, c, { pack: "HIGHER" }))).toEqual({ created: [], existing: [] });
      expect(unwrap(await instantiateFinancePack(world.deps, c, { pack: "INCONNU" }))).toEqual({ created: [], existing: [] });
      expect(FINANCE_PACK_TEMPLATES.PRIMARY.map((f) => f.category)).toEqual(["REGISTRATION", "TUITION"]);
    });

    it("amorçages simultanés : un seul jeu de frais, aucune erreur", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const results = await Promise.all(Array.from({ length: 8 }, () => instantiateFinancePack(world.deps, c, { pack: "PRIMARY" })));
      for (const r of results) expect(r.ok).toBe(true);
      const created = results.flatMap((r) => (r.ok ? r.value.created : []));
      expect(created.sort()).toEqual(["REGISTRATION", "TUITION"]);
      expect(await adminRows(db, "SELECT 1 FROM finance.fees WHERE tenant_id = $1", [t])).toHaveLength(2);
    });
  });
});
