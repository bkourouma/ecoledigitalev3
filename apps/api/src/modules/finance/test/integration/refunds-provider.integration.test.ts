/**
 * REMBOURSEMENT RÉEL chez le fournisseur (spec 015 §US5) : Wave (total, idempotent), MTN MoMo (partiel, asynchrone, lecture
 * d'état), TresorPay (non idempotent, aucune lecture), Orange Money (aucune API) — serveurs HTTP simulés, Postgres réel.
 *
 * Invariants vérifiés : JAMAIS DE DOUBLE REMBOURSEMENT (rejeu, réponse perdue, plantage, concurrence), écritures inverses
 * passées SEULEMENT quand le fournisseur confirme, montant réservé pendant l'envoi, repli manuel explicite et audité,
 * rapprochement par le même job, résolution manuelle à quatre yeux d'un remboursement indéterminé.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { getInvoiceById } from "../../application/invoices";
import { verifyPendingPayment } from "../../application/online-payments";
import { approveManualResolution, requestManualResolution } from "../../application/manual-resolution";
import { getPaymentView } from "../../application/payments";
import { reconcileTenant } from "../../application/reconciliation";
import { approveRefund, completeRefund, getRefundById, rejectRefund, requestRefund } from "../../application/refunds";
import { RecordingAudit } from "../../application/ports/audit";
import { adminRows, ctxFor, describeIntegration } from "../support/db";
import { xof } from "../support/harness";
import { ledgerViolations } from "../support/invariants";
import { createReconEnv, eventsOf, paymentByKey, refundStateRow, startOnline, type ReconEnv, type TestDeps } from "../support/recon-env";
import { learnerId, nextKey } from "../support/scenario";
import { recordManualPayment } from "../../application/payments";
import { openCashier } from "../support/scenario";

const AMOUNT = 25_000;

describeIntegration("remboursement réel chez le fournisseur", () => {
  let env: ReconEnv;
  beforeAll(async () => {
    env = await createReconEnv();
  });
  afterAll(async () => {
    await env.stop();
  });

  /** Paiement en ligne CONFIRMÉ chez `provider` (réglé chez le fournisseur puis vérifié), imputé sur une facture de 100 000. */
  async function confirmed(provider: "wave" | "mtn_momo" | "tresorpay" | "orange_money" | "cinetpay", t: TestDeps, tenantId: string) {
    const s = await startOnline(t, tenantId, provider);
    const p = await paymentByKey(env.db, s.key);
    if (provider === "wave") env.wave.complete(p.provider_ref!);
    else if (provider === "mtn_momo") env.mtn.settle(p.provider_ref!, "SUCCESSFUL");
    else if (provider === "tresorpay") env.tresor.payments.get(p.provider_ref!)!.status = "completed";
    else if (provider === "orange_money") env.orange.settle(p.provider_ref!, "SUCCESS");
    else env.harness("cinetpay").settleSuccess(p.id, p.provider_ref);
    const view = unwrap(await verifyPendingPayment(t.deps, s.ctx, { paymentId: p.id }));
    expect(view.payment.status).toBe("CONFIRMED");
    return { ...s, paymentId: p.id, providerRef: p.provider_ref! };
  }

  const people = (tenantId: string) => ({ requester: ctxFor(tenantId), approver: ctxFor(tenantId) });
  const refundRow = async (id: string) =>
    (
      await adminRows<{ status: string; execution_mode: string | null; provider: string | null; provider_refund_ref: string | null; failure_reason: string | null; manual_reference: string | null; provider_status: string | null }>(
        env.db,
        "SELECT status, execution_mode, provider, provider_refund_ref, failure_reason, manual_reference, provider_status FROM finance.refunds WHERE id = $1",
        [id],
      )
    )[0]!;
  const paymentNums = async (id: string) =>
    (await adminRows<{ status: string; refunded: string; allocated: string }>(env.db, "SELECT status, refunded_amount::text AS refunded, allocated_amount::text AS allocated FROM finance.payments WHERE id = $1", [id]))[0]!;
  const reversals = async (refundId: string) => adminRows(env.db, "SELECT 1 FROM finance.allocation_reversals WHERE refund_id = $1", [refundId]);

  describe("Wave : remboursement total, idempotent", () => {
    it("total : envoyé UNE fois, écritures inverses à la confirmation, paiement REFUNDED, facture rouverte, événements et audit", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed("wave", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Double paiement de la famille" }));
      const calls = env.wave.refundCalls;
      const done = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(done).toMatchObject({ status: "COMPLETED", executionMode: "PROVIDER", provider: "wave", providerRefundRef: c.providerRef });
      expect(env.wave.refundCalls).toBe(calls + 1);
      expect(env.wave.refunded.has(c.providerRef)).toBe(true);
      expect(await paymentNums(c.paymentId)).toEqual({ status: "REFUNDED", refunded: String(AMOUNT), allocated: "0" });
      expect((await reversals(req.id)).length).toBeGreaterThan(0);
      const inv = unwrap(await getInvoiceById(t.deps, requester, c.invoice.id));
      expect(inv.invoice.paid.amount).toBe(0);
      expect(["ISSUED", "OVERDUE"]).toContain(inv.invoice.status);
      expect((await eventsOf(env.db, "finance.refund.submitted", "refundId", req.id))).toHaveLength(1);
      expect((await eventsOf(env.db, "finance.refund.completed", "refundId", req.id))[0]!.payload).toMatchObject({ status: "COMPLETED", executionMode: "PROVIDER", provider: "wave" });
      expect(t.audit.actions()).toEqual(expect.arrayContaining(["finance.refund.approved", "finance.refund.submitted", "finance.refund.completed"]));
      expect(t.counters.some((c) => c.name === "finance_provider_refund_total" && c.labels.provider === "wave" && c.labels.outcome === "completed")).toBe(true);
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);

      // REJEU : jamais un second remboursement.
      for (const again of [await approveRefund(t.deps, approver, { refundId: req.id }), await completeRefund(t.deps, approver, { refundId: req.id }), await rejectRefund(t.deps, approver, { refundId: req.id, reason: "Trop tard pour refuser" })]) {
        expect(again.ok).toBe(false);
      }
      expect(env.wave.refundCalls).toBe(calls + 1);
      expect(env.wave.refunded.size).toBeGreaterThan(0);
      // Le paiement est REFUNDED : plus remboursable, nouvelle demande refusée.
      expect((await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(5_000), reason: "Encore un remboursement" })).ok).toBe(false);
    });

    it("approbations CONCURRENTES du même remboursement : un seul envoi au fournisseur, un seul succès", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester } = people(tenantId);
      const c = await confirmed("wave", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Demande unique" }));
      const before = env.wave.refundCalls;
      const results = await Promise.all(Array.from({ length: 6 }, () => approveRefund(t.deps, ctxFor(tenantId), { refundId: req.id })));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(env.wave.refundCalls - before).toBe(1);
      expect((await refundRow(req.id)).status).toBe("COMPLETED");
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("refus définitif du fournisseur : REFUND_FAILED, rien n'est remboursé, le montant est de nouveau remboursable", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed("wave", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Erreur de caisse" }));
      env.wave.overrideNext(
        () => undefined, // lecture de la session
        { status: 422, json: { code: "refund-not-possible" } },
      );
      const failed = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(failed.status).toBe("REFUND_FAILED");
      expect(failed.failureReason).toBe("refund-not-possible");
      expect(await paymentNums(c.paymentId)).toEqual({ status: "CONFIRMED", refunded: "0", allocated: String(AMOUNT) });
      expect(await reversals(req.id)).toHaveLength(0);
      expect((await eventsOf(env.db, "finance.refund.failed", "refundId", req.id))).toHaveLength(1);
      expect(t.audit.actions()).toContain("finance.refund.failed");
      // Terminal : on ne le rejoue pas ; une NOUVELLE demande est possible.
      expect((await approveRefund(t.deps, approver, { refundId: req.id })).ok).toBe(false);
      const second = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Nouvelle tentative de remboursement" }));
      const ok = unwrap(await approveRefund(t.deps, approver, { refundId: second.id }));
      expect(ok.status).toBe("COMPLETED");
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("plantage APRÈS l'envoi (la conclusion n'est pas enregistrée) : REFUND_PENDING ; le job renvoie la MÊME demande (idempotente) — jamais deux remboursements", async () => {
      const tenantId = await env.newTenant();
      let crash = true;
      const audit = new RecordingAudit();
      const flaky = {
        async record(tx: Parameters<RecordingAudit["record"]>[0], ctx: Parameters<RecordingAudit["record"]>[1], entry: Parameters<RecordingAudit["record"]>[2]) {
          if (crash && entry.action === "finance.refund.completed") throw new Error("plantage simulé du worker");
          await audit.record(tx, ctx, entry);
        },
      };
      const t = env.makeDeps({ audit: flaky });
      const { requester, approver } = people(tenantId);
      const c = await confirmed("wave", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Remboursement interrompu" }));
      const pending = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(pending.status).toBe("REFUND_PENDING");
      expect(env.wave.refunded.has(c.providerRef)).toBe(true);
      expect(await paymentNums(c.paymentId)).toMatchObject({ status: "CONFIRMED", refunded: "0" }); // grand livre intact tant que non conclu
      // Le montant reste RÉSERVÉ : pas de seconde demande sur le même montant.
      expect((await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(1_000), reason: "Demande pendant l'envoi" })).ok).toBe(false);

      crash = false;
      t.clock.advance(61_000);
      const refundedBefore = env.wave.refunded.size;
      const r = await reconcileTenant(t.deps, tenantId);
      expect(r.refunds).toMatchObject({ examined: 1, confirmed: 1 });
      expect(env.wave.refunded.size).toBe(refundedBefore); // le fournisseur n'a remboursé qu'UNE fois (idempotent)
      expect(await refundRow(req.id)).toMatchObject({ status: "COMPLETED", execution_mode: "PROVIDER" });
      expect(await paymentNums(c.paymentId)).toEqual({ status: "REFUNDED", refunded: String(AMOUNT), allocated: "0" });
      expect((await eventsOf(env.db, "finance.refund.completed", "refundId", req.id))).toHaveLength(1);
      expect((await refundStateRow(env.db, req.id))?.resolved_at).not.toBeNull();
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("remboursement PARTIEL : refusé par Wave (total seulement) => repli manuel explicite exigé, jamais d'appel", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed("wave", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(10_000), reason: "Remise accordée a posteriori" }));
      const calls = env.wave.refundCalls;
      const approved = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(approved.status).toBe("APPROVED"); // approuvé, PAS exécuté
      expect(env.wave.refundCalls).toBe(calls);
      const noProof = await completeRefund(t.deps, approver, { refundId: req.id });
      expect(noProof.ok).toBe(false);
      if (!noProof.ok) expect(noProof.error.code).toBe("finance.refund_manual_required");
      const badProof = await completeRefund(t.deps, approver, { refundId: req.id, manual: { reference: "x" } });
      expect(badProof.ok).toBe(false);
      const manual = unwrap(await completeRefund(t.deps, approver, { refundId: req.id, manual: { reference: "WAVE-BO-20250901-77", note: "Remboursé depuis le portail Wave Business" } }));
      expect(manual).toMatchObject({ status: "COMPLETED", executionMode: "MANUAL", manualReference: "WAVE-BO-20250901-77" });
      expect(env.wave.refundCalls).toBe(calls);
      expect(await paymentNums(c.paymentId)).toMatchObject({ status: "CONFIRMED", refunded: "10000", allocated: "15000" });
      const audited = t.audit.entries.find((e) => e.entry.action === "finance.refund.completed_manually")!.entry;
      expect(audited.sensitive).toBe(true);
      expect(audited.after).toMatchObject({ reference: "WAVE-BO-20250901-77", reason: "partial_not_supported" });
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });
  });

  describe("MTN MoMo : partiel, asynchrone, lecture d'état", () => {
    it("envoyé => REFUND_PENDING sans écriture comptable ; le job conclut quand MTN confirme (jamais avant) ; le montant est réservé", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed("mtn_momo", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(10_000), reason: "Frais de cantine remboursés" }));
      const sent = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(sent).toMatchObject({ status: "REFUND_PENDING", executionMode: "PROVIDER", provider: "mtn_momo" });
      expect(env.mtn.refunds.filter((r) => r.externalId === req.id)).toHaveLength(1);
      expect(await paymentNums(c.paymentId)).toMatchObject({ status: "CONFIRMED", refunded: "0", allocated: String(AMOUNT) });
      expect(await reversals(req.id)).toHaveLength(0);
      // Réservé : 25 000 − 10 000 = 15 000 remboursables, pas 20 000.
      const tooMuch = await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(20_000), reason: "Demande supérieure au reste" });
      expect(tooMuch.ok).toBe(false);
      if (!tooMuch.ok) expect(tooMuch.error.code).toBe("finance.refund_exceeds_refundable");
      // Un remboursement en vol ne se rejoue pas, ne se refuse pas.
      for (const again of [await approveRefund(t.deps, approver, { refundId: req.id }), await completeRefund(t.deps, approver, { refundId: req.id }), await rejectRefund(t.deps, approver, { refundId: req.id, reason: "Refus tardif impossible" })]) {
        expect(again.ok).toBe(false);
      }
      const inFlight = await completeRefund(t.deps, approver, { refundId: req.id });
      if (!inFlight.ok) expect(inFlight.error.code).toBe("finance.refund_in_flight");

      t.clock.advance(61_000);
      const pendingRun = await reconcileTenant(t.deps, tenantId);
      expect(pendingRun.refunds).toMatchObject({ examined: 1, deferred: 1, confirmed: 0 });
      expect((await refundRow(req.id)).status).toBe("REFUND_PENDING");

      const refRef = [...env.mtn.refundStates.entries()].find(([, v]) => v.externalId === req.id)![0];
      env.mtn.settleRefund(refRef, "SUCCESSFUL");
      t.clock.advance(61_000);
      const done = await reconcileTenant(t.deps, tenantId);
      expect(done.refunds).toMatchObject({ examined: 1, confirmed: 1 });
      expect(await refundRow(req.id)).toMatchObject({ status: "COMPLETED", provider_status: "SUCCEEDED", provider_refund_ref: refRef });
      expect(await paymentNums(c.paymentId)).toEqual({ status: "CONFIRMED", refunded: "10000", allocated: "15000" });
      expect(unwrap(await getInvoiceById(t.deps, requester, c.invoice.id)).invoice.paid.amount).toBe(15_000);
      expect(env.mtn.refunds.filter((r) => r.externalId === req.id)).toHaveLength(1); // jamais un second envoi
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("refus de MTN (FAILED) : REFUND_FAILED, rien n'est remboursé, montant libéré", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed("mtn_momo", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Annulation de l'inscription" }));
      unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      const refRef = [...env.mtn.refundStates.entries()].find(([, v]) => v.externalId === req.id)![0];
      env.mtn.settleRefund(refRef, "FAILED", "PAYEE_NOT_ALLOWED_TO_RECEIVE");
      t.clock.advance(61_000);
      const r = await reconcileTenant(t.deps, tenantId);
      expect(r.refunds).toMatchObject({ examined: 1, failed: 1 });
      expect(await refundRow(req.id)).toMatchObject({ status: "REFUND_FAILED", failure_reason: "payee_not_allowed_to_receive" });
      expect(await paymentNums(c.paymentId)).toMatchObject({ status: "CONFIRMED", refunded: "0", allocated: String(AMOUNT) });
      expect((await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Nouvelle demande après refus" })).ok).toBe(true);
    });

    it("réponse PERDUE (MTN a traité) : REFUND_PENDING, le job lit l'état — un seul remboursement chez MTN", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed("mtn_momo", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(5_000), reason: "Geste commercial de l'école" }));
      env.mtn.loseNextResponses(1, (r) => r.path.endsWith("/refund") && r.method === "POST");
      const sent = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(sent.status).toBe("REFUND_PENDING");
      expect(env.mtn.refunds.filter((r) => r.externalId === req.id)).toHaveLength(1);
      const refRef = [...env.mtn.refundStates.entries()].find(([, v]) => v.externalId === req.id)![0];
      env.mtn.settleRefund(refRef, "SUCCESSFUL");
      t.clock.advance(61_000);
      expect((await reconcileTenant(t.deps, tenantId)).refunds).toMatchObject({ confirmed: 1 });
      expect(env.mtn.refunds.filter((r) => r.externalId === req.id)).toHaveLength(1);
      expect((await refundRow(req.id)).status).toBe("COMPLETED");
    });

    it("panne de MTN à l'envoi (5xx) : REFUND_PENDING, le job constate « inconnu chez le fournisseur » et renvoie la MÊME référence UNE fois", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed("mtn_momo", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(7_000), reason: "Remboursement après panne" }));
      env.mtn.overrideNext({ status: 503, json: {} }, { status: 503, json: {} }, { status: 503, json: {} });
      const sent = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(sent.status).toBe("REFUND_PENDING");
      expect([...env.mtn.refundStates.values()].some((v) => v.externalId === req.id)).toBe(false); // rien n'est parti
      t.clock.advance(61_000);
      const r = await reconcileTenant(t.deps, tenantId);
      expect(r.refunds).toMatchObject({ examined: 1, deferred: 1 });
      const entries = [...env.mtn.refundStates.entries()].filter(([, v]) => v.externalId === req.id);
      expect(entries).toHaveLength(1); // renvoyé UNE fois, même X-Reference-Id
      env.mtn.settleRefund(entries[0]![0], "SUCCESSFUL");
      t.clock.advance(61_000);
      expect((await reconcileTenant(t.deps, tenantId)).refunds).toMatchObject({ confirmed: 1 });
      expect(await paymentNums(c.paymentId)).toMatchObject({ refunded: "7000" });
      expect(env.mtn.refunds.filter((r) => r.externalId === req.id)).toHaveLength(1);
    });

    it("toujours en vol après le plafond de tentatives : signalé « à rapprocher » (événement + alerte), plus aucun appel", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps({ reconciliation: { maxAttempts: 2 } });
      const { requester, approver } = people(tenantId);
      const c = await confirmed("mtn_momo", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(4_000), reason: "Remboursement très lent" }));
      unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      t.clock.advance(61_000);
      expect((await reconcileTenant(t.deps, tenantId)).refunds).toMatchObject({ deferred: 1 });
      t.clock.advance(10 * 60_000);
      expect((await reconcileTenant(t.deps, tenantId)).refunds).toMatchObject({ flagged: 1 });
      expect(await refundStateRow(env.db, req.id)).toMatchObject({ flag_reason: "attempts_exhausted" });
      const ev = await eventsOf(env.db, "finance.refund.reconciliation_needed", "refundId", req.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]!.payload).toMatchObject({ subject: "REFUND", reason: "attempts_exhausted", provider: "mtn_momo" });
      expect(t.alerts.map((a) => a.code)).toEqual(["finance.refund.reconciliation_needed"]);
      const calls = env.mtn.requests.length;
      t.clock.advance(24 * 3_600_000);
      expect((await reconcileTenant(t.deps, tenantId)).refunds.examined).toBe(0);
      expect(env.mtn.requests.length).toBe(calls);
      expect((await refundRow(req.id)).status).toBe("REFUND_PENDING");
    });
  });

  describe("TresorPay : non idempotent, aucune lecture d'état => jamais de renvoi", () => {
    it("réponse ambiguë (5xx) : REFUND_PENDING, le job SIGNALE sans renvoyer ; résolution manuelle à quatre yeux conclut le grand livre", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed("tresorpay", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Retrait de l'élève en cours d'année" }));
      // Le fournisseur TRAITE la demande mais la réponse est perdue.
      env.tresor.loseNextResponses(1, (r) => r.path.endsWith("/refunds"));
      const done = env.tresor.refundsDone.length;
      const sent = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(sent.status).toBe("REFUND_PENDING");
      expect(env.tresor.refundsDone.length).toBe(done + 1);

      t.clock.advance(61_000);
      const r = await reconcileTenant(t.deps, tenantId);
      expect(r.refunds).toMatchObject({ examined: 1, flagged: 1 });
      expect(env.tresor.refundsDone.length).toBe(done + 1); // JAMAIS un second envoi
      expect(await refundStateRow(env.db, req.id)).toMatchObject({ flag_reason: "unverifiable_refund" });
      expect(t.alerts.map((a) => a.reason)).toEqual(["unverifiable_refund"]);
      expect(await paymentNums(c.paymentId)).toMatchObject({ status: "CONFIRMED", refunded: "0" });

      // Quatre yeux : une demande motivée avec preuve, une AUTRE personne approuve.
      const proposer = ctxFor(tenantId);
      const res = unwrap(await requestManualResolution(t.deps, proposer, { refundId: req.id, outcome: "SUCCEEDED", reason: "Relevé TresorPay du 01/09 : remboursement exécuté", evidenceRef: "TP-RF-0901-0042" }));
      const self = await approveManualResolution(t.deps, proposer, { resolutionId: res.id });
      expect(self.ok).toBe(false);
      expect((await refundRow(req.id)).status).toBe("REFUND_PENDING");
      unwrap(await approveManualResolution(t.deps, ctxFor(tenantId), { resolutionId: res.id }));
      expect(await refundRow(req.id)).toMatchObject({ status: "COMPLETED", execution_mode: "PROVIDER", manual_reference: "TP-RF-0901-0042", provider_status: "MANUAL_CONFIRMED" });
      expect(await paymentNums(c.paymentId)).toEqual({ status: "REFUNDED", refunded: String(AMOUNT), allocated: "0" });
      expect(t.audit.actions()).toEqual(expect.arrayContaining(["finance.resolution.approved", "finance.refund.completed_manually"]));
      expect(env.tresor.refundsDone.length).toBe(done + 1);
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("refus après envoi non reçu (5xx avant traitement) : la résolution manuelle « FAILED » libère le montant, rien n'est remboursé", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed("tresorpay", t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Remboursement sans suite" }));
      env.tresor.overrideNext({ status: 502, json: {} });
      const sent = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(sent.status).toBe("REFUND_PENDING");
      t.clock.advance(61_000);
      await reconcileTenant(t.deps, tenantId);
      const res = unwrap(await requestManualResolution(t.deps, requester, { refundId: req.id, outcome: "FAILED", reason: "Relevé TresorPay : aucun remboursement émis", evidenceRef: "RELEVE-TP-0901" }));
      unwrap(await approveManualResolution(t.deps, approver, { resolutionId: res.id }));
      expect(await refundRow(req.id)).toMatchObject({ status: "REFUND_FAILED", failure_reason: "manual_not_sent" });
      expect(await paymentNums(c.paymentId)).toMatchObject({ status: "CONFIRMED", refunded: "0" });
      expect(env.tresor.refundsDone.filter((r) => r.transaction_id === c.providerRef)).toHaveLength(0);
    });
  });

  describe("fournisseurs sans API de remboursement : repli MANUEL explicite et audité", () => {
    it.each(["orange_money", "cinetpay"] as const)("%s : approuvé mais non exécuté ; l'exécution exige l'attestation avec preuve", async (provider) => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const c = await confirmed(provider, t, tenantId);
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Paiement en double" }));
      const approved = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(approved.status).toBe("APPROVED");
      expect(await paymentNums(c.paymentId)).toMatchObject({ status: "CONFIRMED", refunded: "0" });
      const refused = await completeRefund(t.deps, approver, { refundId: req.id });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toMatchObject({ code: "finance.refund_manual_required", details: { reason: "no_refund_api", provider } });
      const done = unwrap(await completeRefund(t.deps, approver, { refundId: req.id, manual: { reference: "OM-REMB-250901-55" } }));
      expect(done).toMatchObject({ status: "COMPLETED", executionMode: "MANUAL", manualReference: "OM-REMB-250901-55" });
      expect(await paymentNums(c.paymentId)).toEqual({ status: "REFUNDED", refunded: String(AMOUNT), allocated: "0" });
      const audited = t.audit.entries.find((e) => e.entry.action === "finance.refund.completed_manually")!.entry;
      expect(audited).toMatchObject({ sensitive: true, resourceId: req.id });
      expect((await eventsOf(env.db, "finance.refund.completed", "refundId", req.id))[0]!.payload).toMatchObject({ executionMode: "MANUAL" });
      expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
    });

    it("approbation ET attestation en une fois (`manual` dans l'approbation) ; le repli manuel est REFUSÉ quand le fournisseur sait rembourser", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const om = await confirmed("orange_money", t, tenantId);
      const r1 = unwrap(await requestRefund(t.deps, requester, { paymentId: om.paymentId, amount: xof(AMOUNT), reason: "Paiement Orange en double" }));
      const direct = unwrap(await approveRefund(t.deps, approver, { refundId: r1.id, manual: { reference: "OM-DIRECT-1" } }));
      expect(direct).toMatchObject({ status: "COMPLETED", executionMode: "MANUAL" });

      const mtn = await confirmed("mtn_momo", t, tenantId);
      const r2 = unwrap(await requestRefund(t.deps, requester, { paymentId: mtn.paymentId, amount: xof(AMOUNT), reason: "Paiement MTN en double" }));
      const calls = env.mtn.refunds.length;
      const denied = await approveRefund(t.deps, approver, { refundId: r2.id, manual: { reference: "MTN-MANUEL-1" } });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe("finance.refund_manual_not_allowed");
      expect(env.mtn.refunds.length).toBe(calls);
      expect((await refundRow(r2.id)).status).toBe("REQUESTED"); // rien n'a été approuvé non plus
      expect(unwrap(await getRefundById(t.deps, requester, r2.id)).status).toBe("REQUESTED");
    });

    it("paiement saisi à la main (espèces) : route comptable inchangée ; une preuve manuelle n'a pas de sens", async () => {
      const tenantId = await env.newTenant();
      const t = env.makeDeps();
      const { requester, approver } = people(tenantId);
      const cashier = ctxFor(tenantId);
      await openCashier(t.deps, cashier, 0, "CAISSE-REC");
      const learner = learnerId();
      const p = unwrap(await recordManualPayment(t.deps, cashier, { idempotencyKey: nextKey("cash"), learnerId: learner, amount: xof(30_000), method: "CASH", reference: "RC-1" }));
      const req = unwrap(await requestRefund(t.deps, requester, { paymentId: p.payment.id, amount: xof(10_000), reason: "Erreur de saisie en caisse" }));
      const bad = await approveRefund(t.deps, approver, { refundId: req.id, manual: { reference: "PREUVE-INUTILE" } });
      expect(bad.ok).toBe(false);
      await openCashier(t.deps, approver, 0, "CAISSE-REC-2");
      const done = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
      expect(done).toMatchObject({ status: "COMPLETED", executionMode: "LEDGER" });
      expect(await getPaymentView(t.deps, requester, p.payment.id).then((r) => unwrap(r).payment.refunded.amount)).toBe(10_000);
    });
  });
});
