import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock, Money, err, newId, ok } from "@ecoledigitale/kernel";
import {
  COMPACT_REFERENCE_LENGTH,
  constantTimeEqual,
  decodePaymentReference,
  encodePaymentReference,
  hmacSha256Hex,
  integerAmountString,
  maskMsisdn,
  normalizeMsisdn,
  parseProviderAmount,
  toMtnReferenceId,
  verifyWebhookUrlToken,
  webhookUrlToken,
} from "../../infrastructure/providers/common";
import { ProviderHttp } from "../../infrastructure/providers/http";
import { TokenCache } from "../../infrastructure/providers/token-cache";
import { conflict, FinanceCode } from "../../domain/errors";
import { captureLogs } from "../support/adapters";
import { MockHttp, type MockReply, type RecordedRequest } from "../support/mock-providers";

describe("montants rapportés par un fournisseur : entiers stricts, jamais d'arrondi", () => {
  it.each([
    [1000, 1000],
    ["1000", 1000],
    ["1000.00", 1000],
    [" 25000 ", 25000],
    [0, 0],
  ])("accepte %j", (input, expected) => {
    expect(parseProviderAmount(input, "XOF")?.amount).toBe(expected);
  });
  it.each([["1000.5"], [1000.5], ["1e3"], [-5], ["-5"], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 2], [null], [undefined], [{}], [[]], [""], ["abc"], ["1 000"], ["1000,00"]])(
    "rejette %j (réponse malformée)",
    (input) => {
      expect(parseProviderAmount(input, "XOF")).toBeNull();
    },
  );
  it("montant sortant : chaîne d'entiers, aucune décimale", () => {
    expect(integerAmountString(Money.of(25_000, "XOF"))).toBe("25000");
    expect(integerAmountString(Money.of(1, "XOF"))).toBe("1");
  });
});

describe("comparaison à temps constant", () => {
  it("égalité exacte uniquement, quelle que soit la longueur", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("", "a")).toBe(false);
    expect(constantTimeEqual("a".repeat(5000), "a".repeat(5000))).toBe(true);
  });
  it("hmac hexadécimal de 64 caractères, déterministe", () => {
    const a = hmacSha256Hex("secret", "message");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacSha256Hex("secret", "message")).toBe(a);
    expect(hmacSha256Hex("secret2", "message")).not.toBe(a);
  });
});

describe("références compactes réversibles", () => {
  it("UUID <-> 22 caractères alphanumériques, aller-retour exact", () => {
    for (let i = 0; i < 200; i++) {
      const id = newId();
      const ref = encodePaymentReference(id);
      expect(ref).toHaveLength(COMPACT_REFERENCE_LENGTH);
      expect(ref).toMatch(/^[0-9A-Za-z]{22}$/);
      expect(decodePaymentReference(ref)).toBe(id);
    }
    expect(decodePaymentReference(encodePaymentReference("00000000-0000-0000-0000-000000000000"))).toBe("00000000-0000-0000-0000-000000000000");
  });
  it("respecte les limites des fournisseurs (Orange 30, CinetPay 25)", () => {
    expect(encodePaymentReference(newId()).length).toBeLessThanOrEqual(25);
  });
  it("refuse ce qui n'est pas une de nos références", () => {
    expect(decodePaymentReference("short")).toBeNull();
    expect(decodePaymentReference("!".repeat(22))).toBeNull();
    expect(decodePaymentReference("z".repeat(22))).toBeNull(); // dépasse 2^128
    expect(() => encodePaymentReference("pas-un-uuid")).toThrow();
  });
  it("MTN : UUID v7 -> UUID v4 valide, déterministe et injectif", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = newId();
      const ref = toMtnReferenceId(id);
      expect(ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(toMtnReferenceId(id)).toBe(ref);
      seen.add(ref);
    }
    expect(seen.size).toBe(100);
    const odd = toMtnReferenceId("pas-un-uuid");
    expect(odd).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("numéros de téléphone", () => {
  it("normalise vers les chiffres avec préfixe pays", () => {
    expect(normalizeMsisdn("+225 07 01 02 03 04")).toBe("2250701020304");
    expect(normalizeMsisdn("00225 0701020304")).toBe("2250701020304");
    expect(normalizeMsisdn("0701020304")).toBe("2250701020304");
    expect(normalizeMsisdn("2250701020304")).toBe("2250701020304");
  });
  it("refuse l'implausible", () => {
    expect(normalizeMsisdn("abc")).toBeNull();
    expect(normalizeMsisdn("12")).toBeNull();
    expect(normalizeMsisdn(undefined)).toBeNull();
  });
  it("masque : jamais un numéro complet", () => {
    const m = maskMsisdn("2250701020304");
    expect(m).toBe("225••••••0304");
    expect(m).not.toContain("0701020");
    expect(maskMsisdn("123")).toBe("•••");
    expect(maskMsisdn(undefined)).toBe("•••");
  });
});

describe("jeton d'URL de webhook (Orange, MTN)", () => {
  const secret = "s3cret";
  it("lié au tenant, au fournisseur et à la référence", () => {
    const t = webhookUrlToken(secret, "tenant-a", "orange_money", "ref1");
    expect(verifyWebhookUrlToken(secret, t, "tenant-a", "orange_money", "ref1")).toBe(true);
    expect(verifyWebhookUrlToken(secret, t, "tenant-b", "orange_money", "ref1")).toBe(false);
    expect(verifyWebhookUrlToken(secret, t, "tenant-a", "mtn_momo", "ref1")).toBe(false);
    expect(verifyWebhookUrlToken(secret, t, "tenant-a", "orange_money", "ref2")).toBe(false);
    expect(verifyWebhookUrlToken("autre", t, "tenant-a", "orange_money", "ref1")).toBe(false);
  });
  it("secret absent, jeton absent ou tenant absent => refus (jamais « vrai » par défaut)", () => {
    const t = webhookUrlToken(secret, "tenant-a", "orange_money");
    expect(verifyWebhookUrlToken(undefined, t, "tenant-a", "orange_money")).toBe(false);
    expect(verifyWebhookUrlToken("", t, "tenant-a", "orange_money")).toBe(false);
    expect(verifyWebhookUrlToken(secret, undefined, "tenant-a", "orange_money")).toBe(false);
    expect(verifyWebhookUrlToken(secret, "", "tenant-a", "orange_money")).toBe(false);
    expect(verifyWebhookUrlToken(secret, t, undefined, "orange_money")).toBe(false);
  });
});

describe("TokenCache", () => {
  const make = (clock: ManualClock, calls: { n: number }, ttl = 3600) =>
    new TokenCache({
      clock,
      fetchToken: async () => {
        calls.n++;
        await new Promise((r) => setTimeout(r, 10));
        return ok({ token: `tok-${calls.n}`, expiresInSec: ttl });
      },
    });

  it("met en cache jusqu'à 60 s avant l'expiration puis renouvelle", async () => {
    const clock = new ManualClock("2025-09-01T08:00:00Z");
    const calls = { n: 0 };
    const cache = make(clock, calls, 3600);
    expect(await cache.get()).toEqual(ok("tok-1"));
    clock.advance(3_000_000);
    expect(await cache.get()).toEqual(ok("tok-1"));
    expect(calls.n).toBe(1);
    clock.advance(541_000); // 3 541 s écoulées : moins de 60 s avant l'expiration
    expect(await cache.get()).toEqual(ok("tok-2"));
    expect(calls.n).toBe(2);
  });

  it("single-flight : des appels concurrents partagent UNE requête de renouvellement", async () => {
    const calls = { n: 0 };
    const cache = make(new ManualClock(), calls);
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.get()));
    expect(calls.n).toBe(1);
    expect(new Set(results.map((r) => (r.ok ? r.value : "x"))).size).toBe(1);
  });

  it("invalidate force un nouveau jeton ; un échec n'est jamais mis en cache", async () => {
    const calls = { n: 0 };
    const clock = new ManualClock();
    let fail = true;
    const cache = new TokenCache({
      clock,
      fetchToken: async () => {
        calls.n++;
        return fail ? err(conflict(FinanceCode.PROVIDER_FAILED, "x")) : ok({ token: `tok-${calls.n}`, expiresInSec: 3600 });
      },
    });
    expect((await cache.get()).ok).toBe(false);
    fail = false;
    expect(await cache.get()).toEqual(ok("tok-2"));
    cache.invalidate();
    expect(await cache.get()).toEqual(ok("tok-3"));
  });

  it("un renouvellement en vol invalidé n'est pas conservé", async () => {
    const calls = { n: 0 };
    const cache = make(new ManualClock(), calls);
    const p = cache.get();
    cache.invalidate();
    await p;
    await cache.get();
    expect(calls.n).toBe(2);
  });
});

class Scripted extends MockHttp {
  hits = 0;
  protected handle(_req: RecordedRequest): MockReply {
    this.hits++;
    return { json: { ok: true } };
  }
}

describe("ProviderHttp : délais, reprises, journalisation expurgée", () => {
  let server: Scripted;
  beforeAll(async () => {
    server = await new Scripted().start();
  });
  afterAll(async () => {
    await server.stop();
  });
  const client = (overrides: Record<string, unknown> = {}) => {
    const logs = captureLogs();
    const sleeps: number[] = [];
    const http = new ProviderHttp({ provider: "test", allowInsecureHttp: true, timeoutMs: 150, retries: 2, sleep: async (ms) => void sleeps.push(ms), logger: logs.logger, ...overrides });
    return { http, logs, sleeps };
  };

  it("refuse http: hors développement et une URL invalide", async () => {
    const { http } = client({ allowInsecureHttp: false });
    const r = await http.request({ method: "GET", url: `${server.url}/x`, operation: "t", safeToRetry: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.provider_config_invalid");
    const bad = await client().http.request({ method: "GET", url: "pas une url", operation: "t", safeToRetry: true });
    expect(bad.ok).toBe(false);
  });

  it("GET : 5xx puis succès => reprise avec attente exponentielle", async () => {
    server.reset();
    server.overrideNext({ status: 503 }, { status: 502 });
    const { http, sleeps } = client();
    const r = await http.request({ method: "GET", url: `${server.url}/x`, operation: "t", safeToRetry: true });
    expect(r.ok && r.value.status).toBe(200);
    expect(server.requests).toHaveLength(3);
    expect(sleeps).toEqual([300, 600]);
  });

  it("GET : 5xx persistant => échec provider_failed borné", async () => {
    server.reset();
    server.overrideNext({ status: 500 }, { status: 500 }, { status: 500 });
    const r = await client().http.request({ method: "GET", url: `${server.url}/x`, operation: "t", safeToRetry: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("finance.provider_failed");
      expect(r.error.details).toMatchObject({ provider: "test", reason: "upstream_5xx", httpStatus: 500 });
    }
    expect(server.requests).toHaveLength(3);
  });

  it("POST non idempotent : une réponse 5xx n'est JAMAIS rejouée (rendue telle quelle à l'adaptateur)", async () => {
    server.reset();
    server.overrideNext({ status: 500, json: { code: "boom" } });
    const r = await client().http.request({ method: "POST", url: `${server.url}/x`, body: "{}", operation: "t", safeToRetry: false });
    expect(r.ok && r.value.status).toBe(500);
    expect(server.requests).toHaveLength(1);
  });

  it("POST non idempotent : un délai dépassé n'est pas rejoué ; un GET l'est", async () => {
    server.reset();
    server.overrideNext({ delayMs: 400 });
    const post = await client().http.request({ method: "POST", url: `${server.url}/x`, body: "{}", operation: "t", safeToRetry: false });
    expect(post.ok).toBe(false);
    if (!post.ok) expect(post.error.details).toMatchObject({ reason: "timeout" });
    expect(server.requests).toHaveLength(1);

    server.reset();
    server.overrideNext({ delayMs: 400 });
    const get = await client().http.request({ method: "GET", url: `${server.url}/x`, operation: "t", safeToRetry: true });
    expect(get.ok && get.value.status).toBe(200);
    expect(server.requests).toHaveLength(2);
  });

  it("429 : rejoué même pour un POST (non traité), en respectant Retry-After", async () => {
    server.reset();
    server.overrideNext({ status: 429, headers: { "retry-after": "2" } });
    const { http, sleeps } = client();
    const r = await http.request({ method: "POST", url: `${server.url}/x`, body: "{}", operation: "t", safeToRetry: false });
    expect(r.ok && r.value.status).toBe(200);
    expect(sleeps).toEqual([2000]);
  });

  it("connexion refusée : rejouée même pour un POST (la requête n'est pas partie)", async () => {
    const { http } = client({ retries: 1 });
    const r = await http.request({ method: "POST", url: "http://127.0.0.1:1/x", body: "{}", operation: "t", safeToRetry: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.details).toMatchObject({ reason: "network" });
  });

  it("corps non JSON : jsonValid = false, aucune exception", async () => {
    server.reset();
    server.overrideNext({ text: "<html>oups</html>" });
    const r = await client().http.request({ method: "GET", url: `${server.url}/x`, operation: "t", safeToRetry: true });
    expect(r.ok && r.value.jsonValid).toBe(false);
  });

  it("ne suit pas les redirections (SSRF) et journalise sans URL, en-tête ni corps", async () => {
    server.reset();
    server.overrideNext({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    const { http, logs } = client({ retries: 0 });
    const r = await http.request({
      method: "POST",
      url: `${server.url}/pay?token=URL-TOKEN-SECRET`,
      headers: { authorization: "Bearer HEADER-SECRET" },
      body: JSON.stringify({ secret: "BODY-SECRET" }),
      operation: "initiate",
      safeToRetry: false,
    });
    expect(r.ok).toBe(false);
    const text = logs.text();
    for (const leak of ["URL-TOKEN-SECRET", "HEADER-SECRET", "BODY-SECRET", server.url, "169.254"]) expect(text).not.toContain(leak);
    expect(text).toContain("initiate");
  });
});
