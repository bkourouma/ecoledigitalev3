import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { CinetPayProvider, NOTIFY_TOKEN_FIELDS, mapCinetPayStatus, parseCinetPayDate, parseNotification, sanitizeDescription } from "../../infrastructure/providers/cinetpay";
import { decodePaymentReference, encodePaymentReference } from "../../infrastructure/providers/common";
import { CinetPayMock } from "../support/mock-providers";
import { PHONE, SECRETS, TEST_TENANT, expectNoSecrets, paymentId, testRuntime } from "../support/adapters";

const xof = (n: number) => Money.of(n, "XOF");
const SITE = "105899";
const NOTIFY = "https://api.example.test/api/v1/finance/webhooks/cinetpay/" + TEST_TENANT;

const settings = (over: Record<string, string | undefined> = {}) => ({
  mode: "production",
  site_id: SITE,
  api_key: SECRETS.cinetApiKey,
  secret_key: SECRETS.cinetSecretKey,
  channels: "MOBILE_MONEY",
  ...over,
});

describe("CinetPay Checkout v2 (serveur simulé conforme à la documentation)", () => {
  let mock: CinetPayMock;
  beforeAll(async () => {
    mock = await new CinetPayMock({ apiKey: SECRETS.cinetApiKey, siteId: SITE, secretKey: SECRETS.cinetSecretKey }).start();
  });
  afterAll(async () => {
    await mock.stop();
  });
  beforeEach(() => {
    mock.reset();
    mock.transactions.clear();
  });

  const make = (over: Record<string, string | undefined> = {}, rtOver = {}) => {
    const rt = testRuntime({ cinetpay: { production: mock.url, sandbox: mock.url } }, rtOver);
    return { rt, p: new CinetPayProvider(TEST_TENANT, settings(over) as never, rt) };
  };
  const initiate = (p: CinetPayProvider, id = paymentId(), amount = 25_000, payer: Record<string, string> = { phoneNumber: PHONE }) =>
    p.initiate({ tenantId: TEST_TENANT, paymentId: id, amount: xof(amount), payer, returnUrl: "https://app.example.test/retour", notifyUrl: NOTIFY, description: "Frais #1/2 & autres_" });

  it("initiation : transaction_id compact = paiement, montant entier multiple de 5, description assainie", async () => {
    const { p } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("PENDING");
    expect(r.value.providerRef).toMatch(/^cp_/);
    expect(r.value.redirectUrl).toContain("checkout.example.invalid");
    const body = JSON.parse(mock.calls("/v2/payment", "POST").find((c) => c.path === "/v2/payment")!.body);
    expect(body.transaction_id).toBe(encodePaymentReference(id));
    expect(body.transaction_id.length).toBeLessThanOrEqual(25);
    expect(body).toMatchObject({ apikey: SECRETS.cinetApiKey, site_id: SITE, amount: 25_000, currency: "XOF", channels: "MOBILE_MONEY", notify_url: NOTIFY });
    expect(Number.isInteger(body.amount)).toBe(true);
    expect(body.description).not.toMatch(/[#/&_]/);
  });

  it("montant non multiple de 5 ou inférieur à 100, devise étrangère : refus AVANT tout appel", async () => {
    const { p } = make();
    for (const amount of [101, 99, 25_003, 0, 5]) expect((await initiate(p, paymentId(), amount)).ok).toBe(false);
    expect((await p.initiate({ tenantId: TEST_TENANT, paymentId: paymentId(), amount: Money.of(1000, "EUR"), returnUrl: "https://a.t", notifyUrl: NOTIFY })).ok).toBe(false);
    expect((await initiate(p, paymentId(), 100)).ok).toBe(true);
    expect(mock.calls("/v2/payment", "POST").filter((c) => c.path === "/v2/payment")).toHaveLength(1);
  });

  it("canal carte : nom et e-mail du payeur obligatoires ; fournis => champs client complets", async () => {
    const { p } = make({ channels: "ALL" });
    const missing = await initiate(p, paymentId(), 1000, { phoneNumber: PHONE });
    expect(missing.ok).toBe(false);
    const r = await initiate(p, paymentId(), 1000, { name: "Awa Koné", email: "awa@example.test", phoneNumber: PHONE });
    expect(r.ok).toBe(true);
    const body = JSON.parse(mock.calls("/v2/payment", "POST").find((c) => c.path === "/v2/payment")!.body);
    expect(body).toMatchObject({ customer_name: "Awa", customer_surname: "Koné", customer_email: "awa@example.test", customer_country: "CI" });
  });

  it("rejet métier (HTTP 200 + code d'erreur) => erreur ; réponse malformée ; 5xx => pas de reprise du POST", async () => {
    const { p } = make();
    const id = paymentId();
    expect((await initiate(p, id)).ok).toBe(true);
    const dup = await initiate(p, id); // même transaction_id : refusée par CinetPay
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.details).toMatchObject({ reason: "rejected", upstreamCode: "-1" });
    mock.overrideNext({ json: { code: "201", message: "CREATED", data: {} } });
    const bad = await initiate(p);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.details).toMatchObject({ reason: "malformed_response" });
    mock.reset();
    mock.overrideNext({ status: 502 });
    expect((await initiate(p)).ok).toBe(false);
    expect(mock.calls("/v2/payment", "POST").filter((c) => c.path === "/v2/payment")).toHaveLength(1);
  });

  describe("vérification (/v2/payment/check)", () => {
    async function started() {
      const { p, rt } = make();
      const id = paymentId();
      const r = await initiate(p, id);
      return { p, rt, id, tid: encodePaymentReference(id), ref: r.ok ? r.value.providerRef : null };
    }
    it("WAITING => PENDING ; ACCEPTED (code 00) => SUCCEEDED avec montant, devise, date ; REFUSED => FAILED ; CANCELED => CANCELLED", async () => {
      const { p, id, tid, ref } = await started();
      const w = await p.verify({ paymentId: id, providerRef: ref });
      expect(w.ok && w.value.status).toBe("PENDING");
      mock.settle(tid, "ACCEPTED");
      const ok = await p.verify({ paymentId: id, providerRef: ref });
      expect(ok.ok && ok.value).toMatchObject({ status: "SUCCEEDED", amount: xof(25_000), providerRef: ref });
      expect(ok.ok && ok.value.paidAt?.toISOString()).toBe("2025-09-01T08:05:00.000Z");
      mock.settle(tid, "REFUSED");
      expect((await p.verify({ paymentId: id, providerRef: ref })).ok && true).toBe(true);
      const f = await p.verify({ paymentId: id, providerRef: ref });
      expect(f.ok && f.value).toMatchObject({ status: "FAILED", failureReason: "declined" });
      mock.settle(tid, "CANCELED");
      const c = await p.verify({ paymentId: id, providerRef: ref });
      expect(c.ok && c.value.status).toBe("CANCELLED");
    });
    it("transaction introuvable : en attente ; ACCEPTED sans code 00 : en attente (jamais un succès)", async () => {
      const { p } = make();
      const none = await p.verify({ paymentId: paymentId(), providerRef: null });
      expect(none.ok && none.value.status).toBe("PENDING");
      expect(mapCinetPayStatus("662", "ACCEPTED").status).toBe("PENDING");
      expect(mapCinetPayStatus("00", "ACCEPTED").status).toBe("SUCCEEDED");
      expect(mapCinetPayStatus("00", "SOMETHING").status).toBe("PENDING");
      expect(mapCinetPayStatus("600", undefined).status).toBe("PENDING");
    });
    it("devise étrangère ou montant décimal dans la réponse => malformé", async () => {
      const { p, id, tid, ref } = await started();
      mock.settle(tid, "ACCEPTED");
      mock.overrideNext({ json: { code: "00", message: "SUCCES", data: { amount: "25000", currency: "USD", status: "ACCEPTED" } } });
      expect((await p.verify({ paymentId: id, providerRef: ref })).ok).toBe(false);
      mock.overrideNext({ json: { code: "00", message: "SUCCES", data: { amount: "25000.5", currency: "XOF", status: "ACCEPTED" } } });
      expect((await p.verify({ paymentId: id, providerRef: ref })).ok).toBe(false);
    });
    it("5xx => reprise (lecture) puis succès", async () => {
      const { p, id, tid, ref } = await started();
      mock.settle(tid, "ACCEPTED");
      mock.reset();
      mock.overrideNext({ status: 503 }, { status: 500 });
      const v = await p.verify({ paymentId: id, providerRef: ref });
      expect(v.ok && v.value.status).toBe("SUCCEEDED");
      expect(mock.calls("/check")).toHaveLength(3);
    });
  });

  describe("notification (x-token HMAC) : indice à vérifier", () => {
    const fields = (id: string, over: Record<string, string> = {}): Record<string, string> => ({
      cpm_site_id: SITE,
      cpm_trans_id: encodePaymentReference(id),
      cpm_trans_date: "2025-09-01 08:05:00",
      cpm_amount: "25000",
      cpm_currency: "XOF",
      signature: "sig-opaque",
      payment_method: "OM",
      cel_phone_num: "0701020304",
      cpm_phone_prefixe: "225",
      cpm_language: "fr",
      cpm_version: "V2",
      cpm_payment_config: "SINGLE",
      cpm_page_action: "PAYMENT",
      cpm_custom: "",
      cpm_designation: "Frais",
      cpm_error_message: "SUCCES",
      ...over,
    });

    it("jeton valide => authentique ; événement indice : référence décodée, pas de montant cru, numéro masqué", async () => {
      const { p } = make();
      const id = paymentId();
      const n = CinetPayMock.notification(SECRETS.cinetSecretKey, fields(id));
      expect(p.verifySignature(n.rawBody, n.headers)).toBe(true);
      expect(p.computeNotifyToken(fields(id))).toBe(n.headers["x-token"]);
      const ev = await p.handleWebhook(n.rawBody, n.headers);
      expect(ev.ok).toBe(true);
      if (!ev.ok) return;
      expect(ev.value).toMatchObject({ paymentId: id, status: "SUCCEEDED", amount: null, requiresActiveVerification: true });
      expect(decodePaymentReference(encodePaymentReference(id))).toBe(id);
      const stored = JSON.stringify(ev.value.storedPayload);
      expect(stored).not.toContain("0701020304");
      expect(stored).toContain("225");
    });

    it("l'ordre documenté des champs est celui du jeton (modifier un champ invalide le jeton)", () => {
      const { p } = make();
      const id = paymentId();
      expect(NOTIFY_TOKEN_FIELDS[0]).toBe("cpm_site_id");
      expect(NOTIFY_TOKEN_FIELDS.at(-1)).toBe("cpm_error_message");
      for (const key of NOTIFY_TOKEN_FIELDS) {
        const n = CinetPayMock.notification(SECRETS.cinetSecretKey, fields(id));
        const tampered = new URLSearchParams(n.rawBody);
        tampered.set(key, `${tampered.get(key) ?? ""}x`);
        if (key === "cpm_site_id") continue; // couvert par le test du site
        expect(p.verifySignature(tampered.toString(), n.headers)).toBe(false);
      }
    });

    it("refuse : jeton faux, secret erroné, en-tête absent, autre site, corps vide, secret absent ou vide", () => {
      const { p } = make();
      const id = paymentId();
      const good = CinetPayMock.notification(SECRETS.cinetSecretKey, fields(id));
      expect(p.verifySignature(good.rawBody, { ...good.headers, "x-token": "0".repeat(64) })).toBe(false);
      const other = CinetPayMock.notification("autre-secret", fields(id));
      expect(p.verifySignature(other.rawBody, other.headers)).toBe(false);
      expect(p.verifySignature(good.rawBody, { "content-type": good.headers["content-type"] })).toBe(false);
      const wrongSite = CinetPayMock.notification(SECRETS.cinetSecretKey, fields(id, { cpm_site_id: "999" }));
      expect(p.verifySignature(wrongSite.rawBody, wrongSite.headers)).toBe(false);
      expect(p.verifySignature("", good.headers)).toBe(false);
      expect(make({ secret_key: undefined }).p.verifySignature(good.rawBody, good.headers)).toBe(false);
      const emptyKey = CinetPayMock.notification("", fields(id));
      expect(make({ secret_key: "" }).p.verifySignature(emptyKey.rawBody, emptyKey.headers)).toBe(false);
    });

    it("corps illisible ou transaction qui n'est pas la nôtre => erreur", async () => {
      const { p } = make();
      expect((await p.handleWebhook("", {})).ok).toBe(false);
      expect((await p.handleWebhook(new URLSearchParams({ cpm_trans_id: "ABC" }).toString(), {})).ok).toBe(false);
    });

    it("événement dédupliqué par contenu : même corps => même identifiant, corps différent => autre", async () => {
      const { p } = make();
      const id = paymentId();
      const a = CinetPayMock.notification(SECRETS.cinetSecretKey, fields(id));
      const b = CinetPayMock.notification(SECRETS.cinetSecretKey, fields(id, { cpm_error_message: "PAYMENT_FAILED" }));
      const ea = await p.handleWebhook(a.rawBody, a.headers);
      const ea2 = await p.handleWebhook(a.rawBody, a.headers);
      const eb = await p.handleWebhook(b.rawBody, b.headers);
      expect(ea.ok && ea2.ok && eb.ok).toBe(true);
      if (ea.ok && ea2.ok && eb.ok) {
        expect(ea.value.eventId).toBe(ea2.value.eventId);
        expect(ea.value.eventId).not.toBe(eb.value.eventId);
        expect(eb.value.status).toBe("PENDING");
      }
    });
  });

  it("test de connexion : identifiants valides => ok ; refusés => credentials_rejected", async () => {
    const good = await make().p.testConnection();
    expect(good.ok && good.value).toEqual({ ok: true, code: "ok" });
    const bad = await make({ api_key: "mauvaise-cle" }).p.testConnection();
    expect(bad.ok && bad.value).toEqual({ ok: false, code: "credentials_rejected" });
  });

  it("aucun remboursement documenté", () => {
    expect(make().p.refund).toBeUndefined();
  });

  it("utilitaires : notification JSON ou formulaire, date de Côte d'Ivoire (UTC+0), description", () => {
    expect(parseNotification("a=1&b=2")).toEqual({ a: "1", b: "2" });
    expect(parseNotification('{"a":1,"b":"x"}')).toEqual({ a: "1", b: "x" });
    expect(parseNotification("{pas json")).toBeNull();
    expect(parseCinetPayDate("2025-09-01 08:05:00")?.toISOString()).toBe("2025-09-01T08:05:00.000Z");
    expect(parseCinetPayDate("n'importe quoi")).toBeNull();
    expect(sanitizeDescription("a#b/c$d_e&f")).toBe("a b c d e f");
    expect(sanitizeDescription("")).toBe("Paiement scolarite");
  });

  it("aucun secret ni numéro complet dans les journaux d'un parcours complet", async () => {
    const { p, rt } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    mock.settle(encodePaymentReference(id), "ACCEPTED");
    await p.verify({ paymentId: id, providerRef: r.ok ? r.value.providerRef : null });
    await p.testConnection();
    const n = CinetPayMock.notification(SECRETS.cinetSecretKey, { cpm_site_id: SITE, cpm_trans_id: encodePaymentReference(id), cel_phone_num: "0701020304" });
    p.verifySignature(n.rawBody, n.headers);
    await p.handleWebhook(n.rawBody, n.headers);
    expect(expectNoSecrets(rt.logs.text())).toEqual([]);
  });
});
