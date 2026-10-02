import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { MtnMomoProvider, mapMtnStatus } from "../../infrastructure/providers/mtn-momo";
import { toMtnReferenceId, webhookUrlToken } from "../../infrastructure/providers/common";
import { MtnMock } from "../support/mock-providers";
import { PHONE, SECRETS, TEST_TENANT, OTHER_TENANT, expectNoSecrets, paymentId, testRuntime } from "../support/adapters";

const xof = (n: number) => Money.of(n, "XOF");
const NOTIFY = "https://api.example.test/api/v1/finance/webhooks/mtn_momo/" + TEST_TENANT;

const settings = (over: Record<string, string | undefined> = {}) => ({
  mode: "sandbox",
  api_user: "11111111-2222-4333-8444-555555555555",
  api_key: SECRETS.mtnApiKey,
  subscription_key: SECRETS.mtnSubscriptionKey,
  webhook_secret: SECRETS.webhookSecret,
  ...over,
});

describe("MTN MoMo Collection (serveur simulé conforme à la documentation)", () => {
  let sandbox: MtnMock;
  beforeAll(async () => {
    sandbox = await new MtnMock({
      apiUser: "11111111-2222-4333-8444-555555555555",
      apiKey: SECRETS.mtnApiKey,
      subscriptionKey: SECRETS.mtnSubscriptionKey,
      targetEnvironment: "sandbox",
      currency: "EUR",
      callbacksAllowed: false,
    }).start();
  });
  afterAll(async () => {
    await sandbox.stop();
  });
  beforeEach(() => {
    sandbox.reset();
    sandbox.transactions.clear();
    sandbox.revokeTokens();
    sandbox.tokensIssued = 0;
  });

  const make = (over: Record<string, string | undefined> = {}, rtOver = {}) => {
    const rt = testRuntime({ mtn_momo: { sandbox: sandbox.url, production: sandbox.url } }, rtOver);
    return { rt, p: new MtnMomoProvider(TEST_TENANT, settings(over) as never, rt) };
  };
  const initiate = (p: MtnMomoProvider, id = paymentId(), amount = 25_000, phone: string | null = PHONE) =>
    p.initiate({ tenantId: TEST_TENANT, paymentId: id, amount: xof(amount), payer: phone ? { phoneNumber: phone } : {}, notifyUrl: NOTIFY, description: "Scolarité" });

  it("initiation sandbox : UUID v4 dérivé du paiement, EUR, montant chaîne d'entiers, pas de X-Callback-Url", async () => {
    const { p } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ status: "PENDING", providerRef: toMtnReferenceId(id) });
    const call = sandbox.calls("requesttopay", "POST")[0]!;
    expect(call.headers["x-reference-id"]).toBe(toMtnReferenceId(id));
    expect(call.headers["x-target-environment"]).toBe("sandbox");
    expect(call.headers["x-callback-url"]).toBeUndefined();
    const body = JSON.parse(call.body);
    expect(body).toMatchObject({ amount: "25000", currency: "EUR", externalId: id, payer: { partyIdType: "MSISDN", partyId: PHONE } });
    expect(typeof body.amount).toBe("string");
  });

  it("production : X-Callback-Url porteur du jeton du tenant, devise XOF, environnement cible du pays", async () => {
    const prod = await new MtnMock({
      apiUser: "11111111-2222-4333-8444-555555555555",
      apiKey: SECRETS.mtnApiKey,
      subscriptionKey: SECRETS.mtnSubscriptionKey,
      targetEnvironment: "mtnivorycoast",
      currency: "XOF",
      callbacksAllowed: true,
    }).start();
    try {
      const rt = testRuntime({ mtn_momo: { production: prod.url } });
      const p = new MtnMomoProvider(TEST_TENANT, settings({ mode: "production" }) as never, rt);
      const r = await initiate(p);
      expect(r.ok).toBe(true);
      const cb = String(prod.calls("requesttopay", "POST")[0]!.headers["x-callback-url"]);
      expect(new URL(cb).searchParams.get("t")).toBe(webhookUrlToken(SECRETS.webhookSecret, TEST_TENANT, "mtn_momo"));
      expect(p.webhookUrl(NOTIFY, TEST_TENANT)).toBe(cb);
    } finally {
      await prod.stop();
    }
  });

  it("rejeu idempotent : 409 (référence déjà utilisée) = même transaction, jamais une seconde", async () => {
    const { p } = make();
    const id = paymentId();
    const a = await initiate(p, id);
    const b = await initiate(p, id);
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && b.ok && a.value.providerRef).toBe(b.ok ? b.value.providerRef : "");
    expect(sandbox.transactions.size).toBe(1);
  });

  it("5xx à l'initiation : reprise sûre (référence stable) puis succès", async () => {
    const { p } = make();
    await p.testConnection();
    sandbox.reset();
    sandbox.overrideNext({ status: 503 }, { status: 500 });
    const r = await initiate(p);
    expect(r.ok).toBe(true);
    expect(sandbox.calls("requesttopay", "POST")).toHaveLength(3);
    expect(sandbox.transactions.size).toBe(1);
  });

  it("numéro absent ou invalide, devise, montant : refus avant tout appel", async () => {
    const { p } = make();
    expect((await initiate(p, paymentId(), 1000, null)).ok).toBe(false);
    expect((await initiate(p, paymentId(), 1000, "abc")).ok).toBe(false);
    expect((await p.initiate({ tenantId: TEST_TENANT, paymentId: paymentId(), amount: Money.of(5, "EUR"), payer: { phoneNumber: PHONE } })).ok).toBe(false);
    expect((await initiate(p, paymentId(), 0)).ok).toBe(false);
    expect(sandbox.requests).toHaveLength(0);
  });

  it("clés refusées : credentials_rejected sans fuite ; jeton renouvelé après un 401", async () => {
    const bad = make({ api_key: "mauvaise-cle" });
    const r = await initiate(bad.p);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.ok ? {} : r.error)).not.toContain("mauvaise-cle");
    expect((await bad.p.testConnection()).ok).toBe(true);
    const t = await bad.p.testConnection();
    expect(t.ok && t.value.code).toBe("credentials_rejected");

    const { p } = make();
    expect((await initiate(p)).ok).toBe(true);
    sandbox.revokeTokens();
    expect((await initiate(p)).ok).toBe(true);
    expect(sandbox.tokensIssued).toBe(2);
  });

  describe("vérification", () => {
    async function started(over = {}) {
      const { p, rt } = make(over);
      const id = paymentId();
      const r = await initiate(p, id);
      if (!r.ok) throw r.error;
      return { p, rt, id, ref: r.value.providerRef! };
    }
    it("PENDING => PENDING ; SUCCESSFUL => SUCCEEDED avec le montant et la devise du fournisseur (EUR de sandbox ramené à XOF)", async () => {
      const { p, id, ref } = await started();
      const pend = await p.verify({ paymentId: id, providerRef: ref });
      expect(pend.ok && pend.value.status).toBe("PENDING");
      sandbox.settle(ref, "SUCCESSFUL");
      const ok = await p.verify({ paymentId: id, providerRef: ref });
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.value.status).toBe("SUCCEEDED");
        expect(ok.value.amount).toEqual(xof(25_000));
        expect(ok.value.paidAt).toBeInstanceOf(Date);
      }
    });
    it("FAILED : motif court (code), jamais le message du fournisseur", async () => {
      const { p, id, ref } = await started();
      sandbox.settle(ref, "FAILED", "NOT_ENOUGH_FUNDS");
      const v = await p.verify({ paymentId: id, providerRef: ref });
      expect(v.ok && v.value).toMatchObject({ status: "FAILED", failureReason: "not_enough_funds", amount: null });
    });
    it("transaction inconnue de MTN (404) : en attente, pas un échec", async () => {
      const { p } = make();
      const id = paymentId();
      const v = await p.verify({ paymentId: id, providerRef: null });
      expect(v.ok && v.value.status).toBe("PENDING");
    });
    it("externalId d'un autre paiement => refus ; montant illisible => réponse malformée", async () => {
      const { p, id, ref } = await started();
      sandbox.settle(ref, "SUCCESSFUL");
      sandbox.transactions.get(ref)!.externalId = paymentId();
      const v = await p.verify({ paymentId: id, providerRef: ref });
      expect(v.ok).toBe(false);
      sandbox.transactions.get(ref)!.externalId = id;
      sandbox.transactions.get(ref)!.amount = "25000.5";
      const m = await p.verify({ paymentId: id, providerRef: ref });
      expect(m.ok).toBe(false);
      if (!m.ok) expect(m.error.details).toMatchObject({ reason: "malformed_response" });
    });
    it("statut inconnu => en attente", () => {
      expect(mapMtnStatus("WEIRD", undefined).status).toBe("PENDING");
      expect(mapMtnStatus("SUCCESSFUL", undefined).status).toBe("SUCCEEDED");
    });
  });

  describe("rappel (callback) : URL à jeton + vérification active", () => {
    const token = webhookUrlToken(SECRETS.webhookSecret, TEST_TENANT, "mtn_momo");
    it("jeton exact => authentique ; l'événement est un INDICE à vérifier, sans montant ni numéro complet", async () => {
      const { p } = make();
      const id = paymentId();
      const r = await initiate(p, id);
      const ref = r.ok ? r.value.providerRef! : "";
      sandbox.settle(ref, "SUCCESSFUL");
      const raw = sandbox.callbackBody(ref);
      const meta = { tenantId: TEST_TENANT, query: { t: token } };
      expect(p.verifySignature(raw, {}, meta)).toBe(true);
      const ev = await p.handleWebhook(raw, {}, meta);
      expect(ev.ok).toBe(true);
      if (!ev.ok) return;
      expect(ev.value).toMatchObject({ paymentId: id, providerRef: ref, status: "SUCCEEDED", requiresActiveVerification: true, amount: null, eventId: `mtn:${id}:SUCCESSFUL` });
      expect(JSON.stringify(ev.value.storedPayload)).not.toContain(PHONE);
      expect(JSON.stringify(ev.value.storedPayload)).toContain("225");
    });
    it("refuse : sans jeton, mauvais jeton, autre tenant, secret absent ou vide", () => {
      const { p } = make();
      const raw = "{}";
      expect(p.verifySignature(raw, {}, { tenantId: TEST_TENANT, query: {} })).toBe(false);
      expect(p.verifySignature(raw, {}, { tenantId: TEST_TENANT, query: { t: "0".repeat(64) } })).toBe(false);
      expect(p.verifySignature(raw, {}, { tenantId: OTHER_TENANT, query: { t: token } })).toBe(false);
      expect(p.verifySignature(raw, {})).toBe(false);
      expect(make({ webhook_secret: undefined }).p.verifySignature(raw, {}, { tenantId: TEST_TENANT, query: { t: token } })).toBe(false);
      expect(make({ webhook_secret: "" }).p.verifySignature(raw, {}, { tenantId: TEST_TENANT, query: { t: token } })).toBe(false);
    });
    it("corps malformé ou externalId non UUID => erreur", async () => {
      const { p } = make();
      expect((await p.handleWebhook("nope", {})).ok).toBe(false);
      expect((await p.handleWebhook(JSON.stringify({ externalId: "abc", status: "SUCCESSFUL" }), {})).ok).toBe(false);
      expect((await p.handleWebhook(JSON.stringify({ externalId: paymentId() }), {})).ok).toBe(false);
    });
  });

  it("remboursement (Q-PAY-10) : demande idempotente par référence, devise du mode", async () => {
    const { p } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    const ref = r.ok ? r.value.providerRef! : "";
    const refundId = paymentId();
    const out = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(10_000), refundId, reason: "Erreur" });
    expect(out.ok && out.value).toMatchObject({ status: "PENDING", providerRefundRef: toMtnReferenceId(refundId) });
    expect(sandbox.refunds[0]).toMatchObject({ amount: "10000", currency: "EUR", referenceIdToRefund: ref });
    expect((await p.refund!({ paymentId: id, providerRef: null, amount: xof(1), refundId })).ok).toBe(false);
  });

  it("aucun secret ni numéro complet dans les journaux d'un parcours complet", async () => {
    const { p, rt, id, ref } = await (async () => {
      const m = make();
      const id = paymentId();
      const r = await initiate(m.p, id);
      return { ...m, id, ref: r.ok ? r.value.providerRef! : "" };
    })();
    sandbox.settle(ref, "SUCCESSFUL");
    await p.verify({ paymentId: id, providerRef: ref });
    await p.testConnection();
    expect(expectNoSecrets(rt.logs.text(), ["mtn-tok-"])).toEqual([]);
  });
});
