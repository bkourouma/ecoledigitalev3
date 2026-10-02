import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { WaveProvider, mapWaveSession } from "../../infrastructure/providers/wave";
import { WaveMock } from "../support/mock-providers";
import { SECRETS, TEST_TENANT, expectNoSecrets, paymentId, testRuntime } from "../support/adapters";

const xof = (n: number) => Money.of(n, "XOF");
const RETURN = "https://app.example.test/retour";

const settings = (over: Record<string, string | undefined> = {}) => ({
  mode: "production",
  api_key: SECRETS.waveApiKey,
  webhook_secret: SECRETS.waveWebhookSecret,
  ...over,
});

describe("Wave Checkout (serveur simulé conforme à la documentation)", () => {
  let mock: WaveMock;
  beforeAll(async () => {
    mock = await new WaveMock(SECRETS.waveApiKey).start();
  });
  afterAll(async () => {
    await mock.stop();
  });
  beforeEach(() => {
    mock.reset();
    mock.sessions.clear();
    mock.refunded.clear();
    mock.creations = 0;
  });

  const make = (over: Record<string, string | undefined> = {}, rtOver = {}) => {
    const rt = testRuntime({ wave: { production: mock.url, sandbox: mock.url } }, rtOver);
    return { rt, p: new WaveProvider(TEST_TENANT, settings(over) as never, rt) };
  };
  const initiate = (p: WaveProvider, id = paymentId(), amount = 25_000) =>
    p.initiate({ tenantId: TEST_TENANT, paymentId: id, amount: xof(amount), returnUrl: RETURN, notifyUrl: "https://x.test/hook" });

  it("initiation : montant en CHAÎNE d'entiers, client_reference = paiement, URLs HTTPS", async () => {
    const { p } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ status: "PENDING", providerRef: "cos-000001" });
    expect(r.value.redirectUrl).toContain("pay.wave.com");
    expect(r.value.expiresAt).toBeInstanceOf(Date);
    const create = mock.calls("/v1/checkout/sessions", "POST")[0]!;
    expect(JSON.parse(create.body)).toMatchObject({ amount: "25000", currency: "XOF", client_reference: id });
    expect(JSON.parse(create.body).success_url).toContain("https://");
    expect(create.headers.authorization).toBe(`Bearer ${SECRETS.waveApiKey}`);
  });

  it("rejeu : une session existante pour ce paiement est réutilisée, jamais dupliquée", async () => {
    const { p } = make();
    const id = paymentId();
    const a = await initiate(p, id);
    const b = await initiate(p, id);
    expect(a.ok && b.ok).toBe(true);
    expect(b.ok && b.value.providerRef).toBe(a.ok ? a.value.providerRef : "");
    expect(mock.creations).toBe(1);
  });

  it("réponse ambiguë (5xx) : on cherche AVANT de réessayer ; session créée malgré l'erreur => réutilisée", async () => {
    const { p } = make();
    const id = paymentId();
    // Le serveur crée la session puis répond 502 (le traitement a eu lieu).

    mock.overrideNext(
      () => undefined, // recherche initiale (normale)
      (req) => {
        mock.sessions.set("cos-ghost", {
          id: "cos-ghost", amount: "25000", currency: "XOF", client_reference: id, checkout_status: "open", payment_status: "processing",
          wave_launch_url: "https://pay.wave.com/c/cos-ghost", when_expires: "2025-09-02T08:00:00Z",
        });
        return req.method === "POST" ? { status: 502 } : undefined;
      },
    );
    const r = await initiate(p, id);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.providerRef).toBe("cos-ghost");
    expect(mock.calls("/v1/checkout/sessions", "POST")).toHaveLength(1); // une seule tentative de création
  });

  it("5xx persistant à la création : erreur, au plus 2 tentatives, aucun doublon", async () => {
    const { p } = make();
    mock.overrideNext(() => undefined, { status: 500 }, () => undefined, { status: 500 });
    const r = await initiate(p);
    expect(r.ok).toBe(false);
    expect(mock.creations).toBe(0);
  });

  it("recherche indisponible (404) : on crée quand même", async () => {
    const m2 = await new WaveMock(SECRETS.waveApiKey, false).start();
    try {
      const rt = testRuntime({ wave: { production: m2.url } });
      const p = new WaveProvider(TEST_TENANT, settings() as never, rt);
      expect((await initiate(p)).ok).toBe(true);
      expect(m2.creations).toBe(1);
    } finally {
      await m2.stop();
    }
  });

  it("session expirée ou montant différent lors d'un rejeu : échec explicite, pas de nouvelle session", async () => {
    const { p } = make();
    const id = paymentId();
    const a = await initiate(p, id);
    mock.expire(a.ok ? a.value.providerRef! : "");
    const b = await initiate(p, id);
    expect(b.ok && b.value).toMatchObject({ status: "FAILED", failureReason: "expired" });
    const id2 = paymentId();
    await initiate(p, id2, 10_000);
    const c = await initiate(p, id2, 12_000);
    expect(c.ok).toBe(false);
    expect(mock.creations).toBe(2);
  });

  it("refus avant tout appel : devise, montant, URL de retour non HTTPS", async () => {
    const { p } = make();
    expect((await p.initiate({ tenantId: TEST_TENANT, paymentId: paymentId(), amount: Money.of(100, "EUR"), returnUrl: RETURN })).ok).toBe(false);
    expect((await initiate(p, paymentId(), 0)).ok).toBe(false);
    expect((await p.initiate({ tenantId: TEST_TENANT, paymentId: paymentId(), amount: xof(1000), returnUrl: "http://a.test" })).ok).toBe(false);
    expect(mock.requests).toHaveLength(0);
  });

  it("clé d'API refusée : credentials_rejected, aucun secret dans l'erreur", async () => {
    const { p } = make({ api_key: "mauvaise-cle-wave" });
    const r = await initiate(p);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.ok ? {} : r.error)).not.toContain("mauvaise-cle-wave");
    const t = await p.testConnection();
    expect(t.ok && t.value).toEqual({ ok: false, code: "credentials_rejected" });
    expect((await make().p.testConnection()).ok).toBe(true);
  });

  describe("vérification", () => {
    it("processing => PENDING ; succeeded => SUCCEEDED avec montant/devise Wave ; expired => FAILED ; cancelled => CANCELLED", async () => {
      const { p } = make();
      const id = paymentId();
      const r = await initiate(p, id);
      const ref = r.ok ? r.value.providerRef! : "";
      expect((await p.verify({ paymentId: id, providerRef: ref })).ok).toBe(true);
      const pend = await p.verify({ paymentId: id, providerRef: ref });
      expect(pend.ok && pend.value.status).toBe("PENDING");
      mock.complete(ref);
      const done = await p.verify({ paymentId: id, providerRef: ref });
      expect(done.ok && done.value).toMatchObject({ status: "SUCCEEDED", amount: xof(25_000), providerRef: ref });
      expect(done.ok && done.value.paidAt?.toISOString()).toBe("2025-09-01T08:05:00.000Z");

      const id2 = paymentId();
      const r2 = await initiate(p, id2);
      const ref2 = r2.ok ? r2.value.providerRef! : "";
      mock.expire(ref2);
      const ex = await p.verify({ paymentId: id2, providerRef: ref2 });
      expect(ex.ok && ex.value).toMatchObject({ status: "FAILED", failureReason: "expired" });
      mock.sessions.get(ref2)!.payment_status = "cancelled";
      mock.sessions.get(ref2)!.checkout_status = "open";
      const ca = await p.verify({ paymentId: id2, providerRef: ref2 });
      expect(ca.ok && ca.value.status).toBe("CANCELLED");
    });
    it("sans référence fournisseur : recherche par client_reference ; rien trouvé => en attente", async () => {
      const { p } = make();
      const id = paymentId();
      const none = await p.verify({ paymentId: id, providerRef: null });
      expect(none.ok && none.value.status).toBe("PENDING");
      const r = await initiate(p, id);
      mock.complete(r.ok ? r.value.providerRef! : "");
      const v = await p.verify({ paymentId: id, providerRef: null });
      expect(v.ok && v.value.status).toBe("SUCCEEDED");
    });
    it("session d'une autre référence => refus ; montant illisible => malformé ; 5xx => reprise puis succès", async () => {
      const { p } = make();
      const id = paymentId();
      const r = await initiate(p, id);
      const ref = r.ok ? r.value.providerRef! : "";
      mock.complete(ref);
      mock.sessions.get(ref)!.client_reference = paymentId();
      expect((await p.verify({ paymentId: id, providerRef: ref })).ok).toBe(false);
      mock.sessions.get(ref)!.client_reference = id;
      mock.sessions.get(ref)!.amount = "25000.75";
      const bad = await p.verify({ paymentId: id, providerRef: ref });
      expect(bad.ok).toBe(false);
      mock.sessions.get(ref)!.amount = "25000";
      mock.overrideNext({ status: 503 }, { status: 500 });
      const good = await p.verify({ paymentId: id, providerRef: ref });
      expect(good.ok && good.value.status).toBe("SUCCEEDED");
    });
    it("statut inconnu => en attente ; tentative échouée sur session ouverte => en attente", () => {
      expect(mapWaveSession({ payment_status: "weird", checkout_status: "open" }).status).toBe("PENDING");
      expect(mapWaveSession({ payment_status: "failed", checkout_status: "open" }).status).toBe("PENDING");
    });
  });

  describe("webhook signé (Wave-Signature)", () => {
    const event = (over: Record<string, unknown> = {}, type = "checkout.session.completed") => ({
      id: "EV_QvEZuDSQbLdI",
      type,
      data: { id: "cos-000001", amount: "25000", currency: "XOF", client_reference: paymentId(), payment_status: "succeeded", checkout_status: "complete", when_completed: "2025-09-01T08:05:00Z", ...over },
    });
    const secret = SECRETS.waveWebhookSecret;

    it("signature valide => authentique ; événement complet avec montant entier et référence", async () => {
      const { p, rt } = make();
      const ev = event();
      const w = WaveMock.webhook(secret, ev, { timestamp: Math.floor(rt.clock.now().getTime() / 1000) });
      expect(p.verifySignature(w.rawBody, w.headers)).toBe(true);
      const parsed = await p.handleWebhook(w.rawBody, w.headers);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value).toMatchObject({ eventId: "EV_QvEZuDSQbLdI", providerRef: "cos-000001", status: "SUCCEEDED", amount: xof(25_000) });
      expect(parsed.value.paymentId).toBe(ev.data.client_reference);
      expect(parsed.value.requiresActiveVerification).toBeUndefined();
    });

    it("refuse : signature altérée, corps modifié, secret erroné, en-tête absent ou mal formé", () => {
      const { p, rt } = make();
      const t = Math.floor(rt.clock.now().getTime() / 1000);
      const w = WaveMock.webhook(secret, event(), { timestamp: t });
      const flip = (h: string) => h.replace(/v1=([0-9a-f])/, (_m, c) => `v1=${c === "a" ? "b" : "a"}`);
      expect(p.verifySignature(w.rawBody, { "wave-signature": flip(w.headers["wave-signature"]!) })).toBe(false);
      expect(p.verifySignature(w.rawBody.replace("25000", "25001"), w.headers)).toBe(false);
      const other = WaveMock.webhook("autre-secret", event(), { timestamp: t });
      expect(p.verifySignature(other.rawBody, other.headers)).toBe(false);
      expect(p.verifySignature(w.rawBody, {})).toBe(false);
      for (const bad of ["", "t=abc,v1=zz", `t=${t}`, `v1=${"a".repeat(64)}`, `t=${t},v1=short`]) {
        expect(p.verifySignature(w.rawBody, { "wave-signature": bad })).toBe(false);
      }
    });

    it("secret absent ou vide => refus, même avec une signature calculée avec un secret vide", () => {
      const w = WaveMock.webhook("", event());
      expect(make({ webhook_secret: undefined }).p.verifySignature(w.rawBody, w.headers)).toBe(false);
      expect(make({ webhook_secret: "" }).p.verifySignature(w.rawBody, w.headers)).toBe(false);
      expect(make({ webhook_secret: "   " }).p.verifySignature(w.rawBody, w.headers)).toBe(false);
    });

    it("horodatage hors tolérance (rejeu d'un vieux webhook) => refus ; dans la tolérance => accepté", () => {
      const { p, rt } = make();
      const now = Math.floor(rt.clock.now().getTime() / 1000);
      const old = WaveMock.webhook(secret, event(), { timestamp: now - 301 });
      expect(p.verifySignature(old.rawBody, old.headers)).toBe(false);
      const future = WaveMock.webhook(secret, event(), { timestamp: now + 301 });
      expect(p.verifySignature(future.rawBody, future.headers)).toBe(false);
      const edge = WaveMock.webhook(secret, event(), { timestamp: now - 299 });
      expect(p.verifySignature(edge.rawBody, edge.headers)).toBe(true);
      rt.clock.advance(10 * 60_000);
      expect(p.verifySignature(edge.rawBody, edge.headers)).toBe(false);
    });

    it("plusieurs signatures v1 (rotation de clé) : valide si l'une d'elles l'est", () => {
      const { p, rt } = make();
      const t = Math.floor(rt.clock.now().getTime() / 1000);
      const w = WaveMock.webhook(secret, event(), { timestamp: t });
      const header = `t=${t},v1=${"0".repeat(64)},${w.headers["wave-signature"]!.split(",")[1]}`;
      expect(p.verifySignature(w.rawBody, { "wave-signature": header })).toBe(true);
    });

    it("stratégie « shared secret » : Authorization Bearer exact, sinon refus", () => {
      const { p } = make({ webhook_strategy: "shared_secret" });
      const w = WaveMock.webhook(secret, event(), { strategy: "shared_secret" });
      expect(p.verifySignature(w.rawBody, w.headers)).toBe(true);
      expect(p.verifySignature(w.rawBody, { authorization: "Bearer faux" })).toBe(false);
      expect(p.verifySignature(w.rawBody, { authorization: secret })).toBe(false);
      expect(p.verifySignature(w.rawBody, {})).toBe(false);
      expect(make({ webhook_strategy: "shared_secret", webhook_secret: undefined }).p.verifySignature(w.rawBody, w.headers)).toBe(false);
    });

    it("SEC-08 : en « shared secret », le webhook exige la vérification active ; en signing_secret non", async () => {
      const shared = make({ webhook_strategy: "shared_secret" }).p;
      const a = await shared.handleWebhook(JSON.stringify(event()), {});
      expect(a.ok && a.value.requiresActiveVerification).toBe(true);
      const signed = make().p;
      const b = await signed.handleWebhook(JSON.stringify(event()), {});
      expect(b.ok && b.value.requiresActiveVerification).toBeUndefined();
    });

    it("payment_failed = tentative échouée (EN ATTENTE, la session reste ouverte) ; expirée => échec ; événements étrangers => sans effet", async () => {
      const { p } = make();
      const failed = await p.handleWebhook(JSON.stringify(event({ payment_status: "failed", checkout_status: "failed" }, "checkout.session.payment_failed")), {});
      expect(failed.ok && failed.value.status).toBe("PENDING");
      const expired = await p.handleWebhook(JSON.stringify(event({ payment_status: "processing", checkout_status: "expired" }, "checkout.session.payment_failed")), {});
      expect(expired.ok && expired.value.status).toBe("FAILED");
      const test = await p.handleWebhook(JSON.stringify({ id: "EV_x", type: "test.test_event", data: {} }), {});
      expect(test.ok && test.value).toMatchObject({ status: "PENDING", paymentId: null, providerRef: null });
      const b2b = await p.handleWebhook(JSON.stringify({ id: "EV_y", type: "b2b.payment_received", data: { amount: "5" } }), {});
      expect(b2b.ok && b2b.value.paymentId).toBeNull();
    });

    it("completed mais non payé => en attente ; montant décimal ou devise étrangère => rejeté", async () => {
      const { p } = make();
      const notPaid = await p.handleWebhook(JSON.stringify(event({ payment_status: "processing" })), {});
      expect(notPaid.ok && notPaid.value.status).toBe("PENDING");
      expect((await p.handleWebhook(JSON.stringify(event({ amount: "25000.5" })), {})).ok).toBe(false);
      expect((await p.handleWebhook(JSON.stringify(event({ currency: "USD" })), {})).ok).toBe(false);
      expect((await p.handleWebhook("pas du json", {})).ok).toBe(false);
      expect((await p.handleWebhook(JSON.stringify({ type: "checkout.session.completed" }), {})).ok).toBe(false);
    });
  });

  describe("remboursement", () => {
    it("total uniquement : montant égal au paiement, appel idempotent côté Wave ; partiel refusé", async () => {
      const { p } = make();
      const id = paymentId();
      const r = await initiate(p, id);
      const ref = r.ok ? r.value.providerRef! : "";
      mock.complete(ref);
      const partial = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(10_000), refundId: paymentId() });
      expect(partial.ok).toBe(false);
      const full = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(25_000), refundId: paymentId() });
      expect(full.ok && full.value).toMatchObject({ status: "SUCCEEDED", providerRefundRef: ref });
      expect(mock.refunded.has(ref)).toBe(true);
    });
    it("paiement non abouti => échec rapporté (pas d'exception) ; sans référence => refus", async () => {
      const { p } = make();
      const id = paymentId();
      const r = await initiate(p, id);
      const ref = r.ok ? r.value.providerRef! : "";
      const out = await p.refund!({ paymentId: id, providerRef: ref, amount: xof(25_000), refundId: paymentId() });
      expect(out.ok && out.value.status).toBe("FAILED");
      expect((await p.refund!({ paymentId: id, providerRef: null, amount: xof(1), refundId: paymentId() })).ok).toBe(false);
    });
  });

  it("aucun secret dans les journaux d'un parcours complet", async () => {
    const { p, rt } = make();
    const id = paymentId();
    const r = await initiate(p, id);
    const ref = r.ok ? r.value.providerRef! : "";
    mock.complete(ref);
    await p.verify({ paymentId: id, providerRef: ref });
    await p.testConnection();
    const w = WaveMock.webhook(SECRETS.waveWebhookSecret, { id: "EV_1", type: "checkout.session.completed", data: { id: ref, amount: "25000", currency: "XOF", client_reference: id, payment_status: "succeeded" } });
    p.verifySignature(w.rawBody, w.headers);
    await p.handleWebhook(w.rawBody, w.headers);
    expect(expectNoSecrets(rt.logs.text())).toEqual([]);
  });
});
