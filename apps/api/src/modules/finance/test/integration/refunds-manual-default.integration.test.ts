/**
 * Q-PAY-32 : le remboursement chez le fournisseur est TOUJOURS MANUEL par défaut.
 *
 * `config.providerRefundAutoExecution` vaut `false` : même un fournisseur qui sait rembourser (Wave total, MTN, sandbox) n'est
 * jamais appelé ; le remboursement reste `APPROVED` jusqu'à l'attestation manuelle avec preuve (audit sensible
 * `finance.refund.completed_manually`). Le réglage activé rétablit la route `PROVIDER`. Isolation A/B vérifiée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { verifyPendingPayment } from "../../application/online-payments";
import { approveRefund, completeRefund, getRefundById, planRefundRoute, requestRefund } from "../../application/refunds";
import { DEFAULT_FINANCE_CONFIG } from "../../application/deps";
import { getPayment } from "../../infrastructure/payments-repository";
import { adminRows, ctxFor, describeIntegration } from "../support/db";
import { xof } from "../support/harness";
import { ledgerViolations } from "../support/invariants";
import { createReconEnv, paymentByKey, startOnline, type ReconEnv, type TestDeps } from "../support/recon-env";

const AMOUNT = 25_000;

describeIntegration("Q-PAY-32 : remboursement fournisseur manuel par défaut", () => {
  let env: ReconEnv;
  beforeAll(async () => {
    env = await createReconEnv();
  });
  afterAll(async () => {
    await env.stop();
  });

  async function confirmedWave(t: TestDeps, tenantId: string) {
    const s = await startOnline(t, tenantId, "wave", AMOUNT);
    const p = await paymentByKey(env.db, s.key);
    env.wave.complete(p.provider_ref!);
    const view = unwrap(await verifyPendingPayment(t.deps, s.ctx, { paymentId: p.id }));
    expect(view.payment.status).toBe("CONFIRMED");
    return { ...s, paymentId: p.id, providerRef: p.provider_ref! };
  }

  it("le défaut livré est désactivé", () => {
    expect(DEFAULT_FINANCE_CONFIG.providerRefundAutoExecution).toBe(false);
  });

  it("Wave total, réglage par défaut : approuvé mais JAMAIS envoyé au fournisseur ; l'attestation avec preuve conclut, auditée", async () => {
    const tenantId = await env.newTenant();
    const t = env.makeDeps({ config: { providerRefundAutoExecution: false } });
    const requester = ctxFor(tenantId);
    const approver = ctxFor(tenantId);
    const c = await confirmedWave(t, tenantId);
    const req = unwrap(await requestRefund(t.deps, requester, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Double paiement de la famille" }));
    const calls = env.wave.refundCalls;

    const approved = unwrap(await approveRefund(t.deps, approver, { refundId: req.id }));
    expect(approved.status).toBe("APPROVED");
    expect(env.wave.refundCalls).toBe(calls);

    const refused = await completeRefund(t.deps, approver, { refundId: req.id });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatchObject({ code: "finance.refund_manual_required", details: { reason: "auto_refund_disabled", provider: "wave" } });

    const done = unwrap(await completeRefund(t.deps, approver, { refundId: req.id, manual: { reference: "WAVE-BO-20260905-12", note: "Remboursé depuis le portail Wave Business" } }));
    expect(done).toMatchObject({ status: "COMPLETED", executionMode: "MANUAL", manualReference: "WAVE-BO-20260905-12" });
    expect(env.wave.refundCalls).toBe(calls);
    const audited = t.audit.entries.find((e) => e.entry.action === "finance.refund.completed_manually")!.entry;
    expect(audited).toMatchObject({ sensitive: true, resourceId: req.id });
    expect(audited.after).toMatchObject({ reference: "WAVE-BO-20260905-12", reason: "auto_refund_disabled" });
    expect(await ledgerViolations(env.db, tenantId)).toEqual([]);
  });

  it("approbation ET attestation en une fois : acceptée (la route n'est plus PROVIDER, donc le repli manuel n'expose pas à un double remboursement)", async () => {
    const tenantId = await env.newTenant();
    const t = env.makeDeps({ config: { providerRefundAutoExecution: false } });
    const c = await confirmedWave(t, tenantId);
    const req = unwrap(await requestRefund(t.deps, ctxFor(tenantId), { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Erreur de saisie" }));
    const done = unwrap(await approveRefund(t.deps, ctxFor(tenantId), { refundId: req.id, manual: { reference: "WAVE-DIRECT-1" } }));
    expect(done).toMatchObject({ status: "COMPLETED", executionMode: "MANUAL" });
  });

  it("l'auto-approbation reste interdite (quatre yeux) même en mode manuel", async () => {
    const tenantId = await env.newTenant();
    const t = env.makeDeps({ config: { providerRefundAutoExecution: false } });
    const same = ctxFor(tenantId);
    const c = await confirmedWave(t, tenantId);
    const req = unwrap(await requestRefund(t.deps, same, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Erreur de saisie" }));
    const r = await approveRefund(t.deps, same, { refundId: req.id, manual: { reference: "WAVE-SELF-1" } });
    expect(r.ok).toBe(false);
    expect((unwrap(await getRefundById(t.deps, same, req.id))).status).toBe("REQUESTED");
  });

  it("réglage ACTIVÉ : la route PROVIDER est rétablie (envoi chez le fournisseur)", async () => {
    const tenantId = await env.newTenant();
    const t = env.makeDeps({ config: { providerRefundAutoExecution: true } });
    const c = await confirmedWave(t, tenantId);
    const req = unwrap(await requestRefund(t.deps, ctxFor(tenantId), { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Double paiement" }));
    const calls = env.wave.refundCalls;
    const done = unwrap(await approveRefund(t.deps, ctxFor(tenantId), { refundId: req.id }));
    expect(done).toMatchObject({ status: "COMPLETED", executionMode: "PROVIDER" });
    expect(env.wave.refundCalls).toBe(calls + 1);
  });

  it("la route décidée sans appel réseau est MANUAL_REQUIRED (auto_refund_disabled) pour un paiement en ligne", async () => {
    const tenantId = await env.newTenant();
    const t = env.makeDeps({ config: { providerRefundAutoExecution: false } });
    const c = await confirmedWave(t, tenantId);
    const ctx = ctxFor(tenantId);
    const route = await env.db.tenantDb.run(ctx, async (tx) => getPayment(tx, c.paymentId), { readOnly: true });
    expect(route?.method).toBe("ONLINE");
    const req = unwrap(await requestRefund(t.deps, ctx, { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Test route" }));
    const plan = await planRefundRoute(t.deps, ctx, req, route!);
    expect(plan).toEqual({ kind: "MANUAL_REQUIRED", reason: "auto_refund_disabled" });
  });

  it("isolation A/B : le locataire B ne voit ni le remboursement ni la preuve manuelle du locataire A", async () => {
    const tenantA = await env.newTenant();
    const tenantB = await env.newTenant();
    const t = env.makeDeps({ config: { providerRefundAutoExecution: false } });
    const c = await confirmedWave(t, tenantA);
    const req = unwrap(await requestRefund(t.deps, ctxFor(tenantA), { paymentId: c.paymentId, amount: xof(AMOUNT), reason: "Double paiement" }));
    unwrap(await approveRefund(t.deps, ctxFor(tenantA), { refundId: req.id, manual: { reference: "WAVE-ISO-1" } }));
    const seenByB = await env.db.tenantDb.run(ctxFor(tenantB), async (tx) => (await tx.query("SELECT id FROM finance.refunds")).rows, { readOnly: true });
    expect(seenByB).toEqual([]);
    const adminA = await adminRows(env.db, "SELECT manual_reference FROM finance.refunds WHERE tenant_id = $1", [tenantA]);
    expect(adminA).toEqual([{ manual_reference: "WAVE-ISO-1" }]);
  });
});
