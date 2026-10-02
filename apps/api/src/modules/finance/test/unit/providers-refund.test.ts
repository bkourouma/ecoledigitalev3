/**
 * Capacités de remboursement des adaptateurs (spec 015 §US5) : ce que chaque fournisseur sait faire, la lecture d'état de
 * MTN, et surtout la CLASSIFICATION des réponses — refus définitif (4xx) ≠ réponse ambiguë (5xx, délai) : seule la seconde
 * laisse un remboursement « en vol » que le rapprochement concluera sans jamais renvoyer aveuglément.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { err } from "@ecoledigitale/kernel";
import { conflict, validation, FinanceCode } from "../../domain/errors";
import { OPEN_REFUND_STATUSES, REFUND_TRANSITIONS } from "../../domain/refund";
import { REFUND_STATUSES } from "../../domain/types";
import { isDefinitiveRefusal } from "../../application/refunds";
import { reconciliationConfigFromEnv } from "../../infrastructure/runtime";
import { SandboxProvider } from "../../infrastructure/providers/sandbox-provider";
import { toMtnReferenceId } from "../../infrastructure/providers/common";
import { createHarnesses, xof, type ProviderHarness } from "../support/harness";
import type { MtnMock, TresorPayMock, WaveMock } from "../support/mock-providers";
import { paymentId } from "../support/adapters";

describe("remboursement : capacités, états, classification des réponses", () => {
  let harnesses: ProviderHarness[];
  beforeAll(async () => {
    harnesses = await createHarnesses();
  });
  afterAll(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
  });
  const h = (name: string) => harnesses.find((x) => x.name === name)!;
  const provider = (name: string) => h(name).build().provider;

  it("capacités déclarées par fournisseur (aucune supposition : le registre décide la route sans appel réseau)", () => {
    expect(provider("wave").refundCapabilities).toEqual({ partial: false, idempotent: true, statusQuery: false });
    expect(provider("mtn_momo").refundCapabilities).toEqual({ partial: true, idempotent: true, statusQuery: true });
    expect(provider("tresorpay").refundCapabilities).toEqual({ partial: true, idempotent: false, statusQuery: false });
    expect(new SandboxProvider().refundCapabilities).toEqual({ partial: true, idempotent: true, statusQuery: true });
    for (const name of ["orange_money", "cinetpay"]) {
      expect(provider(name).refund, name).toBeUndefined();
      expect(provider(name).refundCapabilities, name).toBeUndefined();
    }
    // Un fournisseur qui ne sait pas relire un remboursement ne déclare pas `refundStatus`.
    expect(provider("mtn_momo").refundStatus).toBeTypeOf("function");
    expect(provider("wave").refundStatus).toBeUndefined();
    expect(provider("tresorpay").refundStatus).toBeUndefined();
  });

  it("vérification impossible sans référence : Orange Money et TresorPay seulement", () => {
    expect(provider("orange_money").cannotVerifyWithoutProviderRef).toBe(true);
    expect(provider("tresorpay").cannotVerifyWithoutProviderRef).toBe(true);
    for (const name of ["wave", "mtn_momo", "cinetpay"]) expect(provider(name).cannotVerifyWithoutProviderRef, name).toBeUndefined();
  });

  it("MTN : lecture d'état d'un remboursement (en attente, réussi, refusé avec motif, inconnu) ; confusion de référence refusée", async () => {
    const mtn = h("mtn_momo").mock as MtnMock;
    const p = provider("mtn_momo");
    const id = paymentId();
    const init = await p.initiate(h("mtn_momo").request(id));
    expect(init.ok).toBe(true);
    const ref = init.ok ? init.value.providerRef! : "";
    mtn.settle(ref, "SUCCESSFUL");
    const refundId = paymentId();
    const sent = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(5_000), refundId, reason: "Geste" });
    expect(sent.ok && sent.value).toMatchObject({ status: "PENDING", providerRefundRef: toMtnReferenceId(refundId) });
    const status = (amount = 5_000) => p.refundStatus!({ paymentId: id, providerRef: ref, refundId, providerRefundRef: null, amount: xof(amount) });
    expect(await status()).toMatchObject({ ok: true, value: { status: "PENDING" } });
    mtn.settleRefund(toMtnReferenceId(refundId), "SUCCESSFUL");
    expect(await status()).toMatchObject({ ok: true, value: { status: "SUCCEEDED", providerRefundRef: toMtnReferenceId(refundId) } });
    mtn.settleRefund(toMtnReferenceId(refundId), "FAILED", "PAYEE_NOT_ALLOWED_TO_RECEIVE");
    expect(await status()).toMatchObject({ ok: true, value: { status: "FAILED", failureReason: "payee_not_allowed_to_receive" } });
    // Jamais envoyé : le fournisseur n'en a aucune trace.
    const unknown = await p.refundStatus!({ paymentId: id, providerRef: ref, refundId: paymentId(), providerRefundRef: null, amount: xof(1) });
    expect(unknown).toMatchObject({ ok: true, value: { status: "NOT_FOUND", providerRefundRef: null } });
    // La réponse concerne un AUTRE remboursement (externalId différent) : jamais une conclusion.
    mtn.refundStates.get(toMtnReferenceId(refundId))!.externalId = "autre-remboursement";
    const mismatch = await status();
    expect(mismatch.ok).toBe(false);
  });

  it("TresorPay : 5xx = réponse AMBIGUË (erreur, jamais un échec définitif) ; 4xx = refus définitif ; aucun renvoi automatique", async () => {
    const tresor = h("tresorpay").mock as TresorPayMock;
    const p = provider("tresorpay");
    const id = paymentId();
    const init = await p.initiate(h("tresorpay").request(id));
    const ref = init.ok ? init.value.providerRef! : "";
    const calls = () => tresor.requests.filter((r) => r.path.endsWith("/refunds")).length;
    const base = calls();
    tresor.overrideNext({ status: 503, json: {} });
    const ambiguous = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(5_000), refundId: paymentId() });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.error.details).toMatchObject({ reason: "upstream_5xx", httpStatus: 503 });
    expect(calls() - base).toBe(1); // un seul appel : le POST non idempotent n'est jamais rejoué
    tresor.overrideNext({ status: 422, json: { status: "error", error: "refund_not_allowed" } });
    const refused = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(5_000), refundId: paymentId() });
    expect(refused).toMatchObject({ ok: true, value: { status: "FAILED", failureReason: "http_422" } });
  });

  it("Wave : 5xx = ambigu (erreur) ; montant partiel refusé avant tout appel de remboursement", async () => {
    const wave = h("wave").mock as WaveMock;
    const p = provider("wave");
    const id = paymentId();
    const init = await p.initiate(h("wave").request(id));
    const ref = init.ok ? init.value.providerRef! : "";
    wave.complete(ref);
    const before = wave.refundCalls;
    const partial = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(10_000), refundId: paymentId() });
    expect(partial.ok).toBe(false);
    expect(wave.refundCalls).toBe(before);
    wave.overrideNext(() => undefined, { status: 503, json: {} }, { status: 503, json: {} }, { status: 503, json: {} });
    const outage = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(25_000), refundId: paymentId() });
    expect(outage.ok).toBe(false);
    if (!outage.ok) expect(outage.error.details).toMatchObject({ reason: "upstream_5xx" });
  });

  it("classification : validation / 4xx = refus définitif ; délai, 5xx, 429, réponse illisible, identifiants refusés = ambigu", () => {
    const upstream = (reason: string, httpStatus?: number) => conflict(FinanceCode.PROVIDER_FAILED, "x", { reason, ...(httpStatus ? { httpStatus } : {}) });
    expect(isDefinitiveRefusal(validation(FinanceCode.INVALID_AMOUNT, "x", "amount"))).toBe(true);
    expect(isDefinitiveRefusal(conflict(FinanceCode.PROVIDER_CONFIG_INVALID, "x"))).toBe(true);
    expect(isDefinitiveRefusal(upstream("rejected", 400))).toBe(true);
    expect(isDefinitiveRefusal(upstream("rejected", 422))).toBe(true);
    expect(isDefinitiveRefusal(upstream("rejected", 408))).toBe(false);
    expect(isDefinitiveRefusal(upstream("rejected", 429))).toBe(false);
    expect(isDefinitiveRefusal(upstream("rejected", 500))).toBe(false);
    for (const reason of ["timeout", "network", "upstream_5xx", "upstream_429", "malformed_response", "credentials_rejected", "unavailable"]) {
      expect(isDefinitiveRefusal(upstream(reason)), reason).toBe(false);
    }
    expect(err(upstream("timeout")).ok).toBe(false);
  });

  it("états du remboursement : REFUND_PENDING réserve le montant, COMPLETED / REFUND_FAILED / REJECTED sont terminaux", () => {
    expect([...OPEN_REFUND_STATUSES]).toEqual(["REQUESTED", "APPROVED", "REFUND_PENDING"]);
    for (const terminal of ["COMPLETED", "REFUND_FAILED", "REJECTED"] as const) expect(REFUND_TRANSITIONS[terminal]).toEqual([]);
    expect(REFUND_TRANSITIONS.REFUND_PENDING).toEqual(["COMPLETED", "REFUND_FAILED"]);
    expect(REFUND_TRANSITIONS.APPROVED).toEqual(["REFUND_PENDING", "COMPLETED", "REJECTED"]);
    // Un remboursement en vol ne se rejette pas, un refus fournisseur ne se rejoue pas.
    expect(REFUND_TRANSITIONS.REFUND_PENDING).not.toContain("REJECTED");
    expect(REFUND_STATUSES).toContain("REFUND_FAILED");
  });

  it("réglages du rapprochement lus dans l'environnement : valeurs hors plage ou illisibles ignorées (défaut du module)", () => {
    expect(reconciliationConfigFromEnv({})).toEqual({});
    expect(
      reconciliationConfigFromEnv({
        FINANCE_RECONCILIATION_MIN_AGE_MS: "120000",
        FINANCE_RECONCILIATION_MAX_ATTEMPTS: "6",
        FINANCE_RECONCILIATION_BACKOFF_BASE_MS: "30000",
        FINANCE_RECONCILIATION_BACKOFF_MAX_MS: "3600000",
        FINANCE_RECONCILIATION_LEASE_MS: "300000",
        FINANCE_RECONCILIATION_BATCH_SIZE: "25",
      }),
    ).toEqual({ minAgeMs: 120_000, maxAttempts: 6, backoffBaseMs: 30_000, backoffMaxMs: 3_600_000, leaseMs: 300_000, batchSize: 25 });
    expect(
      reconciliationConfigFromEnv({
        FINANCE_RECONCILIATION_MIN_AGE_MS: "10", // < 60 s : trop court pour laisser sa chance au webhook
        FINANCE_RECONCILIATION_MAX_ATTEMPTS: "0",
        FINANCE_RECONCILIATION_BACKOFF_BASE_MS: "abc",
        FINANCE_RECONCILIATION_BACKOFF_MAX_MS: "1.5",
        FINANCE_RECONCILIATION_LEASE_MS: "-5",
        FINANCE_RECONCILIATION_BATCH_SIZE: "100000",
      }),
    ).toEqual({});
  });
});
