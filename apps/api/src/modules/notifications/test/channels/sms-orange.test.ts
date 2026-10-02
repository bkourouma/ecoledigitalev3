/**
 * Adaptateur « Orange SMS API » contre un serveur HTTP LOCAL factice (127.0.0.1) : aucun appel réseau réel, aucun secret réel.
 * Les identifiants ci-dessous sont des valeurs de test fabriquées pour ce fichier.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ChannelMessage } from "../../application/ports";
import { createOrangeSmsChannel, orangeDestination, readOrangeSmsSettings } from "../../infrastructure/channels/sms-orange";
import { createSmsChannel } from "../../infrastructure/channels/sms-provider";

interface Hit {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}
type Handler = (hit: Hit, res: ServerResponse) => void;

let server: Server;
let base: string;
let handler: Handler = (_hit, res) => res.writeHead(500).end();
const hits: Hit[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const hit = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      hits.push(hit);
      handler(hit, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  hits.length = 0;
  handler = (_hit, res) => res.writeHead(500).end();
});

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));
};

const TEST_ID = "test-client-id";
const TEST_SECRET = "test-client-secret-not-real";

const env = (extra: Record<string, string> = {}): Record<string, string> => ({
  NOTIFICATIONS_SMS_PROVIDER: "orange",
  ORANGE_SMS_MODE: "live",
  ORANGE_SMS_CLIENT_ID: TEST_ID,
  ORANGE_SMS_CLIENT_SECRET: TEST_SECRET,
  ORANGE_SMS_SENDER: "+2250000",
  ORANGE_SMS_API_BASE_URL: base,
  ORANGE_SMS_TIMEOUT_MS: "2000",
  ...extra,
});

const message = (patch: Partial<ChannelMessage> = {}): ChannelMessage => ({
  tenantId: "0190aaaa-0000-7000-8000-000000000001",
  deliveryId: "0190aaaa-0000-7000-8000-0000000000d1",
  channel: "SMS",
  address: "+2250707070734",
  userId: null,
  subject: null,
  text: "Les Palmiers : Awa a été signalée absente le 02/10/2026.",
  templateCode: "absence",
  category: "ATTENDANCE",
  urgent: false,
  link: null,
  idempotencyKey: "key-1",
  schoolName: "Les Palmiers",
  senderName: "Les Palmiers",
  replyTo: null,
  legalFooter: null,
  unsubscribeUrl: null,
  ...patch,
});

const tokenOk = (res: ServerResponse, expiresIn = 7_776_000): void => json(res, 200, { token_type: "Bearer", access_token: "tok-abc-123456", expires_in: expiresIn });
const sendOk = (res: ServerResponse): void => json(res, 201, { outboundSMSMessageRequest: { resourceURL: "https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B2250000/requests/req-42" } });

/** Serveur nominal : `/oauth/v3/token` puis `/requests`. */
const nominal = (onSend?: (hit: Hit, res: ServerResponse) => void): Handler => (hit, res) => {
  if (hit.url === "/oauth/v3/token") return tokenOk(res);
  if (onSend) return onSend(hit, res);
  return sendOk(res);
};

describe("Orange SMS : configuration", () => {
  it("désactivé par défaut : le canal échoue explicitement, sans appel réseau", async () => {
    const ch = createOrangeSmsChannel({ env: { NOTIFICATIONS_SMS_PROVIDER: "orange" } });
    expect(ch.status().configured).toBe(false);
    expect(ch.status().missing.join(" ")).toContain("ORANGE_SMS_MODE");
    const out = await ch.deliver(message());
    expect(out).toMatchObject({ status: "FAILED", code: "channel_not_configured" });
    expect(hits).toHaveLength(0);
  });

  it("live : exige identifiants et expéditeur (jamais leurs valeurs dans le diagnostic)", () => {
    const r = readOrangeSmsSettings({ ORANGE_SMS_MODE: "live" });
    expect(r.settings).toBeNull();
    expect(r.missing).toEqual(["ORANGE_SMS_CLIENT_ID", "ORANGE_SMS_CLIENT_SECRET", "ORANGE_SMS_SENDER"]);
    const ok = readOrangeSmsSettings(env());
    expect(ok.settings?.authorization).toBe(`Basic ${Buffer.from(`${TEST_ID}:${TEST_SECRET}`).toString("base64")}`);
    expect(JSON.stringify({ missing: ok.missing, problems: ok.problems })).not.toContain(TEST_SECRET);
  });

  it("accepte l'en-tête d'autorisation fourni par le portail, avec ou sans « Basic »", () => {
    expect(readOrangeSmsSettings({ ORANGE_SMS_MODE: "live", ORANGE_SMS_AUTHORIZATION_HEADER: "abc123==", ORANGE_SMS_SENDER: "+2250000" }).settings?.authorization).toBe("Basic abc123==");
    expect(readOrangeSmsSettings({ ORANGE_SMS_MODE: "live", ORANGE_SMS_AUTHORIZATION_HEADER: "Basic abc123==", ORANGE_SMS_SENDER: "+2250000" }).settings?.authorization).toBe("Basic abc123==");
  });

  it("le bac à sable est interdit en production et ne fait aucun appel réseau", async () => {
    const prod = createOrangeSmsChannel({ env: { ORANGE_SMS_MODE: "sandbox" }, production: true });
    expect(prod.status()).toMatchObject({ configured: false });
    expect(prod.status().missing.join(" ")).toContain("interdit en production");
    const sandbox = createOrangeSmsChannel({ env: { ORANGE_SMS_MODE: "sandbox" }, fetch: (() => Promise.reject(new Error("réseau interdit"))) as typeof fetch });
    expect(sandbox.status().configured).toBe(true);
    expect(await sandbox.deliver(message())).toMatchObject({ status: "SIMULATED", providerId: "orange-sandbox:key-1" });
    // le bac à sable valide quand même le numéro et la longueur
    expect(await sandbox.deliver(message({ address: "+33612345678", idempotencyKey: "k2" }))).toMatchObject({ status: "FAILED", code: "invalid_recipient" });
  });

  it("valeurs invalides signalées (mode, URL, expéditeur, nom)", () => {
    expect(readOrangeSmsSettings({ ORANGE_SMS_MODE: "prod" }).problems[0]).toContain("ORANGE_SMS_MODE inconnu");
    const r = readOrangeSmsSettings(env({ ORANGE_SMS_API_BASE_URL: "ftp://x", ORANGE_SMS_SENDER: "abc", ORANGE_SMS_SENDER_NAME: "Nom beaucoup trop long" }));
    expect(r.settings).toBeNull();
    expect(r.problems.length).toBe(3);
  });
});

describe("Orange SMS : sélection par NOTIFICATIONS_SMS_PROVIDER", () => {
  it("http (défaut) = adaptateur générique ; orange = adaptateur dédié ; inconnu / none = échec explicite", async () => {
    expect(createSmsChannel({ env: {} }).provider).toBe("http-sms");
    expect(createSmsChannel({ env: { NOTIFICATIONS_SMS_PROVIDER: "http" } }).provider).toBe("http-sms");
    expect(createSmsChannel({ env: { NOTIFICATIONS_SMS_PROVIDER: "ORANGE" } }).provider).toBe("orange-sms");
    for (const v of ["none", "twilio"]) {
      const ch = createSmsChannel({ env: { NOTIFICATIONS_SMS_PROVIDER: v } });
      expect(ch.status().configured).toBe(false);
      expect(await ch.deliver(message())).toMatchObject({ status: "FAILED", code: "channel_not_configured" });
    }
  });
});

describe("Orange SMS : destinataires", () => {
  const s = { defaultDialCode: "225", allowInternational: false };
  it("normalise en E.164 et refuse les indicatifs étrangers par défaut", () => {
    expect(orangeDestination("07 07 07 07 34", s)).toBe("+2250707070734");
    expect(orangeDestination("00225 07 07 07 07 34", s)).toBe("+2250707070734");
    expect(orangeDestination("+221771234567", s)).toBeNull();
    expect(orangeDestination("+221771234567", { ...s, allowInternational: true })).toBe("+221771234567");
    expect(orangeDestination("abc", s)).toBeNull();
  });
});

describe("Orange SMS : flux OAuth2 puis envoi", () => {
  it("obtient un jeton (Basic), envoie au bon chemin, lit l'identifiant et le coût", async () => {
    handler = nominal();
    const ch = createOrangeSmsChannel({ env: env({ ORANGE_SMS_UNIT_COST: "25", ORANGE_SMS_SENDER_NAME: "Palmiers" }) });
    const out = await ch.deliver(message());
    expect(out).toEqual({ status: "SENT", providerId: "req-42", cost: { amount: 25, currency: "XOF" } });
    expect(hits).toHaveLength(2);
    const [tokenHit, sendHit] = hits as [Hit, Hit];
    expect(tokenHit.method).toBe("POST");
    expect(tokenHit.headers.authorization).toBe(`Basic ${Buffer.from(`${TEST_ID}:${TEST_SECRET}`).toString("base64")}`);
    expect(tokenHit.body).toBe("grant_type=client_credentials");
    expect(sendHit.url).toBe("/smsmessaging/v1/outbound/tel%3A%2B2250000/requests");
    expect(sendHit.headers.authorization).toBe("Bearer tok-abc-123456");
    const body = JSON.parse(sendHit.body).outboundSMSMessageRequest;
    expect(body).toMatchObject({ address: "tel:+2250707070734", senderAddress: "tel:+2250000", senderName: "Palmiers", outboundSMSTextMessage: { message: expect.stringContaining("signalée absente") } });
  });

  it("met le jeton en cache (un seul appel de jeton pour plusieurs envois) puis le renouvelle à l'expiration", async () => {
    let clock = 1_000_000;
    handler = (hit, res) => (hit.url === "/oauth/v3/token" ? tokenOk(res, 120) : sendOk(res));
    const ch = createOrangeSmsChannel({ env: env(), now: () => clock });
    await ch.deliver(message({ idempotencyKey: "a" }));
    await ch.deliver(message({ idempotencyKey: "b" }));
    expect(hits.filter((h) => h.url === "/oauth/v3/token")).toHaveLength(1);
    clock += 61_000; // expires_in 120 s - marge 60 s : expiré
    await ch.deliver(message({ idempotencyKey: "c" }));
    expect(hits.filter((h) => h.url === "/oauth/v3/token")).toHaveLength(2);
  });

  it("un seul appel de jeton pour des envois concurrents", async () => {
    handler = nominal();
    const ch = createOrangeSmsChannel({ env: env() });
    const outs = await Promise.all([1, 2, 3].map((i) => ch.deliver(message({ idempotencyKey: `c${i}` }))));
    expect(outs.every((o) => o.status === "SENT")).toBe(true);
    expect(hits.filter((h) => h.url === "/oauth/v3/token")).toHaveLength(1);
  });

  it("401 : renouvelle le jeton et reprend UNE fois", async () => {
    let sends = 0;
    handler = nominal((_hit, res) => {
      sends += 1;
      if (sends === 1) return json(res, 401, { code: 42, message: "Expired credentials", description: "Expired credentials" });
      return sendOk(res);
    });
    const ch = createOrangeSmsChannel({ env: env() });
    expect(await ch.deliver(message())).toMatchObject({ status: "SENT" });
    expect(hits.filter((h) => h.url === "/oauth/v3/token")).toHaveLength(2);
    expect(sends).toBe(2);
  });

  it("401 persistant : échec définitif d'authentification (pas de boucle)", async () => {
    handler = nominal((_hit, res) => json(res, 401, { code: 42, message: "Invalid credentials" }));
    const ch = createOrangeSmsChannel({ env: env() });
    expect(await ch.deliver(message())).toMatchObject({ status: "FAILED", code: "orange_auth_failed" });
    expect(hits).toHaveLength(4); // jeton, envoi, jeton, envoi
  });

  it("identifiants refusés par le serveur de jeton : échec définitif sans fuite de secret ; panne du serveur de jeton : reprise", async () => {
    handler = (_hit, res) => json(res, 401, { error: "invalid_client", error_description: "Client authentication failed" });
    const bad = await createOrangeSmsChannel({ env: env() }).deliver(message());
    expect(bad).toMatchObject({ status: "FAILED", code: "orange_auth_failed" });
    expect(JSON.stringify(bad)).not.toContain(TEST_SECRET);
    handler = (_hit, res) => json(res, 503, {});
    expect(await createOrangeSmsChannel({ env: env() }).deliver(message())).toMatchObject({ status: "RETRY", code: "orange_token_http_503" });
  });
});

describe("Orange SMS : erreurs, limites, idempotence", () => {
  it("429 / 5xx / coupure / délai : reprise, Retry-After respecté", async () => {
    handler = nominal((_hit, res) => json(res, 429, { requestError: { serviceException: { messageId: "SVC1000", text: "Too many requests" } } }, { "Retry-After": "30" }));
    expect(await createOrangeSmsChannel({ env: env() }).deliver(message())).toMatchObject({ status: "RETRY", code: "http_429", retryAfterMs: 30_000 });
    handler = nominal((_hit, res) => json(res, 503, {}));
    expect(await createOrangeSmsChannel({ env: env() }).deliver(message())).toMatchObject({ status: "RETRY", code: "http_503" });
    const unreachable = createOrangeSmsChannel({ env: env({ ORANGE_SMS_API_BASE_URL: "http://127.0.0.1:1", ORANGE_SMS_TOKEN_URL: "http://127.0.0.1:1/t" }) });
    expect(await unreachable.deliver(message())).toMatchObject({ status: "RETRY", code: "orange_token_unreachable" });
  });

  it("délai dépassé à l'envoi : reprise", async () => {
    handler = nominal(() => undefined); // ne répond jamais
    const ch = createOrangeSmsChannel({ env: env({ ORANGE_SMS_TIMEOUT_MS: "150" }) });
    expect(await ch.deliver(message())).toMatchObject({ status: "RETRY", code: "sms_timeout" });
  });

  it("400 : échec définitif, numéro masqué dans le message d'erreur", async () => {
    handler = nominal((_hit, res) => json(res, 400, { requestError: { serviceException: { messageId: "SVC0002", text: "Invalid input value for tel:+2250707070734" } } }));
    const out = await createOrangeSmsChannel({ env: env() }).deliver(message());
    expect(out).toMatchObject({ status: "FAILED", code: "http_400" });
    expect(JSON.stringify(out)).not.toContain("0707070734");
    expect(JSON.stringify(out)).toContain("SVC0002");
  });

  it("quota épuisé : reprise différée et pause locale (les envois suivants n'appellent pas Orange)", async () => {
    let clock = 5_000_000;
    handler = nominal((_hit, res) => json(res, 403, { requestError: { policyException: { messageId: "POL1000", text: "Insufficient bundle: out of quota" } } }));
    const ch = createOrangeSmsChannel({ env: env({ ORANGE_SMS_QUOTA_PAUSE_SECONDS: "600" }), now: () => clock });
    expect(await ch.deliver(message({ idempotencyKey: "q1" }))).toMatchObject({ status: "RETRY", code: "orange_quota_exhausted", retryAfterMs: 600_000 });
    const before = hits.length;
    clock += 10_000;
    expect(await ch.deliver(message({ idempotencyKey: "q2" }))).toMatchObject({ status: "RETRY", code: "orange_quota_paused", retryAfterMs: 590_000 });
    expect(hits.length).toBe(before);
    clock += 600_000;
    handler = nominal();
    expect(await ch.deliver(message({ idempotencyKey: "q3" }))).toMatchObject({ status: "SENT" });
  });

  it("plafond local par minute : au-delà, reprise sans appel", async () => {
    let clock = 9_000_000;
    handler = nominal();
    const ch = createOrangeSmsChannel({ env: env({ ORANGE_SMS_MAX_PER_MINUTE: "2" }), now: () => clock });
    expect((await ch.deliver(message({ idempotencyKey: "r1" }))).status).toBe("SENT");
    expect((await ch.deliver(message({ idempotencyKey: "r2" }))).status).toBe("SENT");
    const before = hits.length;
    expect(await ch.deliver(message({ idempotencyKey: "r3" }))).toMatchObject({ status: "RETRY", code: "orange_local_rate_limit" });
    expect(hits.length).toBe(before);
    clock += 61_000;
    expect((await ch.deliver(message({ idempotencyKey: "r3" }))).status).toBe("SENT");
  });

  it("idempotence : une clé déjà acceptée n'est pas renvoyée", async () => {
    handler = nominal();
    const ch = createOrangeSmsChannel({ env: env() });
    const a = await ch.deliver(message({ idempotencyKey: "same" }));
    const sendsBefore = hits.filter((h) => h.url.includes("/requests")).length;
    const b = await ch.deliver(message({ idempotencyKey: "same" }));
    expect(b).toEqual(a);
    expect(hits.filter((h) => h.url.includes("/requests")).length).toBe(sendsBefore);
  });

  it("refuse un message trop long (coût maîtrisé), un numéro étranger et un texte vide, sans appel", async () => {
    handler = nominal();
    const ch = createOrangeSmsChannel({ env: env({ ORANGE_SMS_MAX_SEGMENTS: "2" }) });
    expect(await ch.deliver(message({ text: "a".repeat(400), idempotencyKey: "l1" }))).toMatchObject({ status: "FAILED", code: "sms_too_long" });
    expect(await ch.deliver(message({ address: "+221771234567", idempotencyKey: "l2" }))).toMatchObject({ status: "FAILED", code: "invalid_recipient" });
    expect(await ch.deliver(message({ text: "  ", idempotencyKey: "l3" }))).toMatchObject({ status: "FAILED", code: "empty_message" });
    expect(hits).toHaveLength(0);
  });

  it("n'inclut jamais le secret, le jeton ni le numéro complet dans une issue", async () => {
    handler = nominal((_hit, res) => json(res, 500, { message: `échec pour +2250707070734 avec tok-abc-123456` }));
    const out = await createOrangeSmsChannel({ env: env() }).deliver(message());
    const s = JSON.stringify(out);
    expect(s).not.toContain(TEST_SECRET);
    expect(s).not.toContain("0707070734");
  });
});
