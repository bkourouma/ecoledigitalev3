import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { OrangeMoneyProvider, mapOrangeStatus } from "../../infrastructure/providers/orange-money";
import { OrangeMock } from "../support/mock-providers";
import { SECRETS, TEST_TENANT, OTHER_TENANT, expectNoSecrets, paymentId, testRuntime } from "../support/adapters";

import { decodePaymentReference } from "../../infrastructure/providers/common";

const xof = (n: number) => Money.of(n, "XOF");
/** Identifiant du paiement de la dernière commande reçue (décodage de l'order_id compact). */
const paymentIdOf = (mock: OrangeMock): string => decodePaymentReference([...mock.orders.values()].at(-1)!.orderId)!;
const NOTIFY = "https://api.example.test/api/v1/finance/webhooks/orange_money/" + TEST_TENANT;

function settings(over: Record<string, string | undefined> = {}) {
  return {
    mode: "sandbox",
    client_id: "om-client",
    client_secret: SECRETS.orangeClientSecret,
    merchant_key: SECRETS.orangeMerchantKey,
    webhook_secret: SECRETS.webhookSecret,
    ...over,
  };
}

describe("Orange Money Web Payment (serveur simulé conforme à la documentation)", () => {
  let mock: OrangeMock;
  beforeAll(async () => {
    mock = await new OrangeMock({ clientId: "om-client", clientSecret: SECRETS.orangeClientSecret, merchantKey: SECRETS.orangeMerchantKey, segment: "dev", currency: "OUV" }).start();
  });
  afterAll(async () => {
    await mock.stop();
  });
  beforeEach(() => {
    mock.reset();
    mock.orders.clear();
    mock.revokeTokens();
    mock.tokensIssued = 0;
  });

  const make = (over: Record<string, string | undefined> = {}, rtOver = {}) => {
    const rt = testRuntime({ orange_money: { sandbox: mock.url, production: mock.url } }, rtOver);
    return { rt, p: new OrangeMoneyProvider(TEST_TENANT, settings(over) as never, rt) };
  };
  const initiate = (p: OrangeMoneyProvider, id = paymentId(), amount = 25_000) =>
    p.initiate({ tenantId: TEST_TENANT, paymentId: id, amount: xof(amount), returnUrl: "https://app.example.test/retour", notifyUrl: NOTIFY, description: "Scolarite" });

  it("initiation : jeton OAuth, order_id compact = paiement, montant entier, URL de notification signée", async () => {
    const { p } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("PENDING");
    expect(r.value.providerRef).toMatch(/^pt_/);
    expect(r.value.redirectUrl).toContain("webpayment.example.invalid");
    const call = mock.calls("webpayment")[0]!;
    const body = JSON.parse(call.body);
    expect(body).toMatchObject({ merchant_key: SECRETS.orangeMerchantKey, currency: "OUV", amount: 25_000, lang: "fr" });
    expect(Number.isInteger(body.amount)).toBe(true);
    expect(body.order_id).toHaveLength(22);
    expect(body.reference).toBe(body.order_id);
    const notif = new URL(body.notif_url);
    expect(notif.searchParams.get("ref")).toBe(id);
    expect(notif.searchParams.get("t")).toMatch(/^[0-9a-f]{64}$/);
    expect(call.headers.authorization).toBe("Bearer om-tok-1");
  });

  it("mode production : chemin du pays (ci) et devise XOF", async () => {
    const prod = await new OrangeMock({ clientId: "om-client", clientSecret: SECRETS.orangeClientSecret, merchantKey: SECRETS.orangeMerchantKey, segment: "ci", currency: "XOF" }).start();
    try {
      const rt = testRuntime({ orange_money: { production: prod.url } });
      const p = new OrangeMoneyProvider(TEST_TENANT, settings({ mode: "production", country: "CI" }) as never, rt);
      expect((await initiate(p)).ok).toBe(true);
      expect(prod.calls("/orange-money-webpay/ci/v1/webpayment")).toHaveLength(1);
    } finally {
      await prod.stop();
    }
  });

  it("jeton mis en cache entre les appels, renouvelé une seule fois après un 401", async () => {
    const { p } = make();
    const a = await initiate(p);
    expect(a.ok).toBe(true);
    const payToken = a.ok ? a.value.providerRef! : "";
    expect((await p.verify({ paymentId: paymentIdOf(mock), providerRef: payToken, amount: xof(25_000) })).ok).toBe(true);
    expect(mock.tokensIssued).toBe(1);
    mock.revokeTokens();
    const v = await p.verify({ paymentId: paymentIdOf(mock), providerRef: payToken, amount: xof(25_000) });
    expect(v.ok).toBe(true);
    expect(mock.tokensIssued).toBe(2);
  });

  it("des initiations concurrentes ne demandent qu'UN jeton", async () => {
    const { p } = make();
    const results = await Promise.all(Array.from({ length: 8 }, () => initiate(p)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(mock.tokensIssued).toBe(1);
  });

  it("identifiants refusés : erreur sans secret, testConnection => credentials_rejected", async () => {
    const { p, rt } = make({ client_secret: "mauvais-secret" });
    const r = await initiate(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("finance.provider_failed");
      expect(r.error.details).toMatchObject({ reason: "credentials_rejected" });
      expect(JSON.stringify(r.error)).not.toContain("mauvais-secret");
    }
    const t = await p.testConnection();
    expect(t.ok && t.value).toEqual({ ok: false, code: "credentials_rejected" });
    expect(rt.logs.text()).not.toContain("mauvais-secret");
    const good = await make().p.testConnection();
    expect(good.ok && good.value).toEqual({ ok: true, code: "ok" });
  });

  it("5xx ou délai dépassé à l'initiation : AUCUNE reprise du POST (non idempotent)", async () => {
    const { p } = make();
    await p.testConnection(); // chauffe le jeton
    mock.reset();
    mock.overrideNext({ status: 503, json: { code: 1 } });
    const r = await initiate(p);
    expect(r.ok).toBe(false);
    expect(mock.calls("webpayment")).toHaveLength(1);

    mock.reset();
    const { p: p2 } = make({}, { timeoutMs: 100 });
    await p2.testConnection();
    mock.overrideNext({ delayMs: 400 });
    const t = await initiate(p2);
    expect(t.ok).toBe(false);
    expect(mock.calls("webpayment")).toHaveLength(1);
  });

  it("réponse malformée ou rejet métier : erreur typée, jamais un succès", async () => {
    const { p } = make();
    await p.testConnection();
    mock.overrideNext({ status: 200, json: { status: 201, message: "OK" } }); // pas de pay_token
    const a = await initiate(p);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error.details).toMatchObject({ reason: "malformed_response" });
    mock.overrideNext({ status: 200, text: "<html>proxy</html>" });
    expect((await initiate(p)).ok).toBe(false);
    mock.overrideNext({ status: 400, json: { code: 7, message: "Détail interne Orange" } });
    const c = await initiate(p);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.error.details).toMatchObject({ reason: "rejected", upstreamCode: "7" });
      expect(JSON.stringify(c.error)).not.toContain("Détail interne");
    }
  });

  it("refuse avant tout appel : devise, URL de retour, URL de notification, secret de notification absent", async () => {
    const { p } = make();
    const base = { tenantId: TEST_TENANT, paymentId: paymentId(), returnUrl: "https://a.test/r", notifyUrl: NOTIFY };
    expect((await p.initiate({ ...base, amount: Money.of(100, "EUR") })).ok).toBe(false);
    expect((await p.initiate({ ...base, amount: xof(0) })).ok).toBe(false);
    expect((await p.initiate({ ...base, amount: xof(1000), returnUrl: "" })).ok).toBe(false);
    expect((await p.initiate({ tenantId: TEST_TENANT, paymentId: paymentId(), amount: xof(1000), returnUrl: "https://a.test/r" })).ok).toBe(false);
    const noSecret = make({ webhook_secret: undefined }).p;
    expect((await noSecret.initiate({ ...base, amount: xof(1000) })).ok).toBe(false);
    expect(mock.calls("webpayment")).toHaveLength(0);
  });

  describe("vérification (transactionstatus)", () => {
    async function pending(p: OrangeMoneyProvider, amount = 25_000) {
      const id = paymentId();
      const r = await initiate(p, id, amount);
      if (!r.ok) throw r.error;
      return { id, payToken: r.value.providerRef! };
    }

    it.each([
      ["INITIATED", "PENDING"],
      ["PENDING", "PENDING"],
      ["SUCCESS", "SUCCEEDED"],
      ["FAILED", "FAILED"],
      ["EXPIRED", "FAILED"],
    ] as const)("statut %s => %s ; montant et référence contrôlés", async (om, expected) => {
      const { p } = make();
      const { id, payToken } = await pending(p);
      mock.settle(payToken, om);
      const v = await p.verify({ paymentId: id, providerRef: payToken, amount: xof(25_000) });
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(v.value.status).toBe(expected);
      expect(v.value.providerRef).toBe(payToken);
      if (expected === "SUCCEEDED") expect(v.value.amount).toEqual(xof(25_000));
      else expect(v.value.amount).toBeNull();
      if (om === "EXPIRED") expect(v.value.failureReason).toBe("expired");
    });

    it("statut inconnu => en attente (jamais un succès ni un échec définitif)", () => {
      expect(mapOrangeStatus("MYSTERY").status).toBe("PENDING");
      expect(mapOrangeStatus("success").status).toBe("SUCCEEDED");
    });

    it("sans pay_token (réponse d'initiation perdue) : en attente, aucun appel réseau", async () => {
      const { p } = make();
      const v = await p.verify({ paymentId: paymentId(), providerRef: null, amount: xof(1000) });
      expect(v.ok && v.value.status).toBe("PENDING");
      expect(mock.requests).toHaveLength(0);
    });

    it("montant attendu absent => refus ; montant divergent => transaction introuvable chez Orange (pas de succès)", async () => {
      const { p } = make();
      const { id, payToken } = await pending(p);
      mock.settle(payToken, "SUCCESS");
      expect((await p.verify({ paymentId: id, providerRef: payToken })).ok).toBe(false);
      const wrong = await p.verify({ paymentId: id, providerRef: payToken, amount: xof(24_000) });
      expect(wrong.ok).toBe(false);
    });

    it("la réponse d'une AUTRE commande est refusée (reference_mismatch)", async () => {
      const { p } = make();
      const { id, payToken } = await pending(p);
      mock.settle(payToken, "SUCCESS");
      mock.reset();
      mock.overrideNext({ json: { status: "SUCCESS", order_id: "AUTRECOMMANDE000000000", txnid: "MP1" } });
      const v = await p.verify({ paymentId: id, providerRef: payToken, amount: xof(25_000) });
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error.details).toMatchObject({ reason: "reference_mismatch" });
    });

    it("5xx à la vérification : reprise (lecture sûre) puis succès", async () => {
      const { p } = make();
      const { id, payToken } = await pending(p);
      mock.settle(payToken, "SUCCESS");
      mock.overrideNext({ status: 503 }, { status: 502 });
      const v = await p.verify({ paymentId: id, providerRef: payToken, amount: xof(25_000) });
      expect(v.ok && v.value.status).toBe("SUCCEEDED");
      expect(mock.calls("transactionstatus")).toHaveLength(3);
    });
  });

  describe("webhook (notification non signée => URL signée + vérification active)", () => {
    async function notified() {
      const { p, rt } = make();
      const id = paymentId();
      const r = await initiate(p, id);
      if (!r.ok) throw r.error;
      const payToken = r.value.providerRef!;
      mock.settle(payToken, "SUCCESS");
      const n = mock.notification(payToken);
      const meta = { tenantId: TEST_TENANT, query: Object.fromEntries(n.url.searchParams) };
      return { p, rt, id, payToken, n, meta };
    }

    it("accepte la notification dont l'URL porte le jeton émis à l'initiation", async () => {
      const { p, n, meta, id } = await notified();
      expect(p.verifySignature(n.rawBody, {}, meta)).toBe(true);
      const ev = await p.handleWebhook(n.rawBody, {}, meta);
      expect(ev.ok).toBe(true);
      if (!ev.ok) return;
      expect(ev.value).toMatchObject({ paymentId: id, status: "SUCCEEDED", requiresActiveVerification: true, amount: null });
      expect(JSON.stringify(ev.value.storedPayload)).not.toContain("nt_");
      expect(ev.value.eventId).toContain(id);
    });

    it("refuse : jeton altéré, référence d'un autre paiement, autre tenant, query absente, secret absent", async () => {
      const { p, n, meta } = await notified();
      const flip = (s: string) => (s.startsWith("a") ? "b" : "a") + s.slice(1);
      expect(p.verifySignature(n.rawBody, {}, { ...meta, query: { ...meta.query, t: flip(meta.query.t!) } })).toBe(false);
      expect(p.verifySignature(n.rawBody, {}, { ...meta, query: { ...meta.query, ref: paymentId() } })).toBe(false);
      expect(p.verifySignature(n.rawBody, {}, { ...meta, tenantId: OTHER_TENANT })).toBe(false);
      expect(p.verifySignature(n.rawBody, {}, { tenantId: TEST_TENANT, query: {} })).toBe(false);
      expect(p.verifySignature(n.rawBody, {})).toBe(false);
      const noSecret = make({ webhook_secret: undefined }).p;
      expect(noSecret.verifySignature(n.rawBody, {}, meta)).toBe(false);
      const emptySecret = make({ webhook_secret: "" }).p;
      expect(emptySecret.verifySignature(n.rawBody, {}, meta)).toBe(false);
    });

    it("corps illisible ou sans statut => erreur de validation", async () => {
      const { p, meta } = await notified();
      expect((await p.handleWebhook("pas du json", {}, meta)).ok).toBe(false);
      expect((await p.handleWebhook("{}", {}, meta)).ok).toBe(false);
      expect((await p.handleWebhook(JSON.stringify({ status: "SUCCESS" }), {}, { tenantId: TEST_TENANT, query: {} })).ok).toBe(false);
    });
  });

  it("aucun remboursement (API Web Payment sans remboursement documenté)", () => {
    expect(make().p.refund).toBeUndefined();
  });

  it("aucun secret ni numéro complet dans les journaux d'un parcours complet", async () => {
    const { p, rt } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    const payToken = r.ok ? r.value.providerRef! : "";
    mock.settle(payToken, "SUCCESS");
    await p.verify({ paymentId: id, providerRef: payToken, amount: xof(25_000) });
    await p.testConnection();
    expect(expectNoSecrets(rt.logs.text(), [payToken, "om-tok-"])).toEqual([]);
  });
});

