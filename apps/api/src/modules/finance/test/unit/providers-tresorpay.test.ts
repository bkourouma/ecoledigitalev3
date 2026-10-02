import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { TresorPayProvider, mapTresorPayStatus } from "../../infrastructure/providers/tresorpay";
import { TresorPayMock } from "../support/mock-providers";
import { PHONE, SECRETS, TEST_TENANT, expectNoSecrets, paymentId, testRuntime } from "../support/adapters";

const xof = (n: number) => Money.of(n, "XOF");
const NOTIFY = "https://api.example.test/api/v1/finance/webhooks/tresorpay/" + TEST_TENANT;
const creds = { apiKey: SECRETS.tresorApiKey, secretKey: SECRETS.tresorSecretKey, merchantId: "MERCH-1" };

const settings = (over: Record<string, string | undefined> = {}) => ({
  mode: "production",
  merchant_id: "MERCH-1",
  api_key: SECRETS.tresorApiKey,
  secret_key: SECRETS.tresorSecretKey,
  webhook_secret: SECRETS.tresorWebhookSecret,
  ...over,
});

describe("TresorPay (contrat du client legacy ; serveur simulé)", () => {
  let mock: TresorPayMock;
  beforeAll(async () => {
    mock = await new TresorPayMock(creds).start();
  });
  afterAll(async () => {
    await mock.stop();
  });
  beforeEach(() => {
    mock.reset();
    mock.payments.clear();
  });

  const make = (over: Record<string, string | undefined> = {}, rtOver = {}) => {
    const rt = testRuntime({ tresorpay: { production: `${mock.url}/v1`, sandbox: `${mock.url}/v1` } }, rtOver);
    return { rt, p: new TresorPayProvider(TEST_TENANT, settings(over) as never, rt) };
  };
  const initiate = (p: TresorPayProvider, id = paymentId(), amount = 25_000) =>
    p.initiate({
      tenantId: TEST_TENANT,
      paymentId: id,
      amount: xof(amount),
      payer: { name: "Awa Koné", email: "awa@example.test", phoneNumber: PHONE },
      returnUrl: "https://app.example.test/retour",
      notifyUrl: NOTIFY,
      description: "Scolarité",
    });

  it("initiation : appel signé (HMAC méthode+chemin+corps+horodatage), montant entier, référence marchande = paiement", async () => {
    const { p } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ status: "PENDING", providerRef: "tp_1" });
    const body = JSON.parse(mock.calls("initialize")[0]!.body);
    expect(body).toMatchObject({ amount: 25_000, currency: "XOF", transaction_id: id, webhook_url: NOTIFY, customer_phone: PHONE });
    expect(Number.isInteger(body.amount)).toBe(true);
    expect(mock.payments.get("tp_1")!.merchantTransactionId).toBe(id);
  });

  it("signature d'appel fausse (secret erroné) => 401 du fournisseur => credentials_rejected, sans fuite", async () => {
    const { p, rt } = make({ secret_key: "mauvais-secret" });
    const r = await initiate(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.details).toMatchObject({ reason: "credentials_rejected" });
    expect(JSON.stringify(r.ok ? {} : r.error)).not.toContain("mauvais-secret");
    expect(rt.logs.text()).not.toContain("mauvais-secret");
    const t = await p.testConnection();
    expect(t.ok && t.value.code).toBe("credentials_rejected");
    expect((await make().p.testConnection()).ok).toBe(true);
  });

  it("refus avant appel : payeur sans nom/e-mail, devise, montant, URLs", async () => {
    const { p } = make();
    const base = { tenantId: TEST_TENANT, paymentId: paymentId(), returnUrl: "https://a.t/r", notifyUrl: NOTIFY };
    expect((await p.initiate({ ...base, amount: xof(1000) })).ok).toBe(false);
    expect((await p.initiate({ ...base, amount: Money.of(5, "EUR"), payer: { name: "A", email: "a@b.c" } })).ok).toBe(false);
    expect((await p.initiate({ ...base, amount: xof(0), payer: { name: "A", email: "a@b.c" } })).ok).toBe(false);
    expect((await p.initiate({ ...base, returnUrl: "", amount: xof(10), payer: { name: "A", email: "a@b.c" } })).ok).toBe(false);
    expect(mock.requests).toHaveLength(0);
  });

  it("5xx à l'initiation : pas de reprise du POST ; réponse non conforme => erreur", async () => {
    const { p } = make();
    mock.overrideNext({ status: 500 });
    expect((await initiate(p)).ok).toBe(false);
    expect(mock.calls("initialize")).toHaveLength(1);
    mock.overrideNext({ json: { status: "success", data: {} } });
    const bad = await initiate(p);
    expect(bad.ok).toBe(false);
    mock.overrideNext({ json: { status: "error", error: "montant invalide" } });
    expect((await initiate(p)).ok).toBe(false);
  });

  describe("vérification", () => {
    it("pending => PENDING ; completed => SUCCEEDED (montant/devise) ; failed ; cancelled ; inconnu => en attente (le legacy échouait)", async () => {
      const { p } = make();
      const id = paymentId();
      const r = await initiate(p, id);
      const ref = r.ok ? r.value.providerRef! : "";
      const pend = await p.verify({ paymentId: id, providerRef: ref });
      expect(pend.ok && pend.value.status).toBe("PENDING");
      mock.payments.get(ref)!.status = "completed";
      const done = await p.verify({ paymentId: id, providerRef: ref });
      expect(done.ok && done.value).toMatchObject({ status: "SUCCEEDED", amount: xof(25_000) });
      mock.payments.get(ref)!.status = "failed";
      expect((await p.verify({ paymentId: id, providerRef: ref })).ok && true).toBe(true);
      const failed = await p.verify({ paymentId: id, providerRef: ref });
      expect(failed.ok && failed.value.status).toBe("FAILED");
      mock.payments.get(ref)!.status = "cancelled";
      const cancelled = await p.verify({ paymentId: id, providerRef: ref });
      expect(cancelled.ok && cancelled.value.status).toBe("CANCELLED");
      expect(mapTresorPayStatus("processing").status).toBe("PENDING");
      expect(mapTresorPayStatus("???").status).toBe("PENDING");
    });
    it("sans référence ou référence inconnue : en attente ; réponse d'une autre transaction ou montant décimal : refus", async () => {
      const { p } = make();
      const none = await p.verify({ paymentId: paymentId(), providerRef: null });
      expect(none.ok && none.value.status).toBe("PENDING");
      const unknown = await p.verify({ paymentId: paymentId(), providerRef: "tp_999" });
      expect(unknown.ok && unknown.value.status).toBe("PENDING");
      const id = paymentId();
      const r = await initiate(p, id);
      const ref = r.ok ? r.value.providerRef! : "";
      mock.payments.get(ref)!.status = "completed";
      mock.overrideNext({ json: { status: "success", data: { transaction_id: "tp_other", status: "completed", amount: 25000, currency: "XOF" } } });
      expect((await p.verify({ paymentId: id, providerRef: ref })).ok).toBe(false);
      mock.overrideNext({ json: { status: "success", data: { transaction_id: ref, status: "completed", amount: 25000.5, currency: "XOF" } } });
      expect((await p.verify({ paymentId: id, providerRef: ref })).ok).toBe(false);
    });
    it("5xx => reprise (lecture) puis succès", async () => {
      const { p } = make();
      const id = paymentId();
      const r = await initiate(p, id);
      const ref = r.ok ? r.value.providerRef! : "";
      mock.payments.get(ref)!.status = "completed";
      mock.reset();
      mock.overrideNext({ status: 502 }, { status: 503 });
      const v = await p.verify({ paymentId: id, providerRef: ref });
      expect(v.ok && v.value.status).toBe("SUCCEEDED");
      expect(mock.calls("verify")).toHaveLength(3);
    });
  });

  describe("webhook (x-signature = HMAC du corps brut)", () => {
    const body = (over: Record<string, unknown> = {}) => ({ transaction_id: "tp_1", status: "success", amount: 25000, currency: "XOF", customer_phone: PHONE, ...over });

    it("signature valide => authentique ; rapprochement par référence fournisseur ; numéro masqué dans le contenu stocké", async () => {
      const { p } = make();
      const w = TresorPayMock.webhook(SECRETS.tresorWebhookSecret, body());
      expect(p.verifySignature(w.rawBody, w.headers)).toBe(true);
      const ev = await p.handleWebhook(w.rawBody, w.headers);
      expect(ev.ok).toBe(true);
      if (!ev.ok) return;
      expect(ev.value).toMatchObject({ providerRef: "tp_1", paymentId: null, status: "SUCCEEDED", amount: xof(25_000), eventId: "tp:tp_1:success" });
      expect(JSON.stringify(ev.value.storedPayload)).not.toContain(PHONE);
    });
    it("refuse : corps modifié, secret erroné, signature absente, mal formée ; secret absent ou vide", () => {
      const { p } = make();
      const w = TresorPayMock.webhook(SECRETS.tresorWebhookSecret, body());
      expect(p.verifySignature(w.rawBody.replace("25000", "1"), w.headers)).toBe(false);
      const other = TresorPayMock.webhook("autre", body());
      expect(p.verifySignature(other.rawBody, other.headers)).toBe(false);
      expect(p.verifySignature(w.rawBody, {})).toBe(false);
      expect(p.verifySignature(w.rawBody, { "x-signature": "zz" })).toBe(false);
      expect(make({ webhook_secret: undefined }).p.verifySignature(w.rawBody, w.headers)).toBe(false);
      const empty = TresorPayMock.webhook("", body());
      expect(make({ webhook_secret: "" }).p.verifySignature(empty.rawBody, empty.headers)).toBe(false);
    });
    it("statut inconnu => en attente (jamais un échec définitif comme dans le legacy) ; succès sans montant valide => rejeté", async () => {
      const { p } = make();
      const unknown = await p.handleWebhook(JSON.stringify(body({ status: "weird" })), {});
      expect(unknown.ok && unknown.value.status).toBe("PENDING");
      expect((await p.handleWebhook(JSON.stringify(body({ amount: "25000.5" })), {})).ok).toBe(false);
      expect((await p.handleWebhook(JSON.stringify(body({ currency: "USD" })), {})).ok).toBe(false);
      expect((await p.handleWebhook("nope", {})).ok).toBe(false);
      expect((await p.handleWebhook(JSON.stringify({ status: "success" }), {})).ok).toBe(false);
    });
  });

  it("remboursement via /refunds", async () => {
    const { p } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    const ref = r.ok ? r.value.providerRef! : "";
    const out = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(5_000), refundId: paymentId(), reason: "Erreur" });
    expect(out.ok && out.value).toMatchObject({ status: "SUCCEEDED", providerRefundRef: "rf_1" });
    expect((await p.refund!({ paymentId: id, providerRef: null, amount: xof(5), refundId: paymentId() })).ok).toBe(false);
  });

  it("sandbox sans point d'accès de test : refus (jamais l'hôte de production)", async () => {
    const rt = testRuntime({});
    const p = new TresorPayProvider(TEST_TENANT, settings({ mode: "sandbox" }) as never, rt);
    const r = await initiate(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.provider_config_invalid");
  });

  it("aucun secret ni numéro complet dans les journaux d'un parcours complet", async () => {
    const { p, rt } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    const ref = r.ok ? r.value.providerRef! : "";
    mock.payments.get(ref)!.status = "completed";
    await p.verify({ paymentId: id, providerRef: ref });
    await p.testConnection();
    const w = TresorPayMock.webhook(SECRETS.tresorWebhookSecret, { transaction_id: ref, status: "success", amount: 25000, currency: "XOF", customer_phone: PHONE });
    p.verifySignature(w.rawBody, w.headers);
    await p.handleWebhook(w.rawBody, w.headers);
    expect(expectNoSecrets(rt.logs.text())).toEqual([]);
  });
});
