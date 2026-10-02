/**
 * Canaux SMS (adaptateur HTTP générique), WhatsApp (WaSender) et Web Push contre des serveurs HTTP SIMULÉS.
 * Aucun envoi réel : tout passe par 127.0.0.1.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createECDH, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import webpush from "web-push";
import type { ChannelMessage, PushSubscriptionRecord, PushSubscriptionStore } from "../../application/ports";
import { createSmsHttpChannel, readPath, readSmsHttpSettings } from "../../infrastructure/channels/sms-http";
import { createWasenderChannel, wasenderStatus } from "../../infrastructure/channels/whatsapp-wasender";
import { createWebPushChannel, webPushStatus } from "../../infrastructure/channels/web-push";

interface Hit {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
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
      const hit = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body: Buffer.concat(chunks) };
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

const message = (patch: Partial<ChannelMessage> = {}): ChannelMessage => ({
  tenantId: "0190aaaa-0000-7000-8000-000000000001",
  deliveryId: "0190aaaa-0000-7000-8000-0000000000d1",
  channel: "SMS",
  address: "+2250707070734",
  userId: "0190aaaa-0000-7000-8000-0000000000u1".replace("u", "a"),
  subject: null,
  text: "Les Palmiers : Awa a été signalée absente le 02/10/2026.",
  templateCode: "absence",
  category: "ATTENDANCE",
  urgent: false,
  link: null,
  idempotencyKey: "0190aaaa-0000-7000-8000-0000000000d1",
  schoolName: "Les Palmiers",
  senderName: "Les Palmiers",
  replyTo: null,
  legalFooter: null,
  unsubscribeUrl: "https://ecole.example.org/v2/notifications/unsubscribe?t=abc",
  ...patch,
});

describe("SMS : adaptateur HTTP générique configurable", () => {
  const genericEnv = (extra: Record<string, string> = {}) => ({
    SMS_HTTP_URL: `${base}/sms/send`,
    SMS_HTTP_API_KEY: "cle-secrete-de-test",
    SMS_HTTP_SENDER_ID: "PALMIERS",
    SMS_HTTP_SUCCESS_PATH: "status",
    SMS_HTTP_SUCCESS_EQUALS: "queued",
    SMS_HTTP_ID_PATH: "data.messageId",
    SMS_HTTP_COST_PATH: "data.cost",
    SMS_HTTP_COST_CURRENCY: "XOF",
    ...extra,
  });

  it("applique le modèle de requête (jetons, en-tête d'authentification) et lit identifiant et coût dans la réponse", async () => {
    handler = (_hit, res) => json(res, 200, { status: "queued", data: { messageId: "SM-42", cost: "12.4" } });
    const channel = createSmsHttpChannel({ env: { ...genericEnv(), SMS_HTTP_BODY: '{"to":"{{to}}","text":"{{text}}","from":"{{sender}}","ref":"{{reference}}"}' } });
    expect(channel.status().configured).toBe(true);
    const outcome = await channel.deliver(message());
    expect(outcome).toEqual({ status: "SENT", providerId: "SM-42", cost: { amount: 12, currency: "XOF" } });
    const hit = hits[0]!;
    expect(hit.method).toBe("POST");
    expect(hit.url).toBe("/sms/send");
    expect(hit.headers.authorization).toBe("Bearer cle-secrete-de-test");
    expect(hit.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(hit.body.toString())).toEqual({ to: "+2250707070734", text: "Les Palmiers : Awa a été signalée absente le 02/10/2026.", from: "PALMIERS", ref: "0190aaaa-0000-7000-8000-0000000000d1" });
  });

  it("le modèle est entièrement configurable : formulaire, en-tête de clé, préfixe, jeton sans « + »", async () => {
    handler = (_hit, res) => json(res, 200, { status: "queued", data: { messageId: "X1" } });
    const channel = createSmsHttpChannel({
      env: genericEnv({ SMS_HTTP_CONTENT_TYPE: "form", SMS_HTTP_BODY: '{"msisdn":"{{toDigits}}","msg":"{{text}}"}', SMS_HTTP_API_KEY_HEADER: "X-Api-Key", SMS_HTTP_API_KEY_PREFIX: "", SMS_HTTP_HEADERS: '{"Accept":"application/json"}' }),
    });
    expect((await channel.deliver(message())).status).toBe("SENT");
    const hit = hits[0]!;
    expect(hit.headers["x-api-key"]).toBe("cle-secrete-de-test");
    expect(hit.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(hit.headers.accept).toBe("application/json");
    const form = new URLSearchParams(hit.body.toString());
    expect(form.get("msisdn")).toBe("2250707070734");
    expect(form.get("msg")).toContain("absente");
  });

  it("profil de référence « africastalking » : préremplit URL, formulaire, clé `apiKey`, critère de succès", async () => {
    handler = (_hit, res) => json(res, 201, { SMSMessageData: { Recipients: [{ status: "Success", messageId: "ATXid_1", cost: "KES 0.8000" }] } });
    const channel = createSmsHttpChannel({ env: { SMS_HTTP_PROFILE: "africastalking", SMS_HTTP_URL: `${base}/version1/messaging`, SMS_HTTP_API_KEY: "at-key", SMS_HTTP_USERNAME: "sandbox", SMS_HTTP_SENDER_ID: "PALMIERS" } });
    const outcome = await channel.deliver(message());
    expect(outcome).toMatchObject({ status: "SENT", providerId: "ATXid_1" });
    const hit = hits[0]!;
    expect(hit.headers.apikey).toBe("at-key");
    const form = new URLSearchParams(hit.body.toString());
    expect(form.get("username")).toBe("sandbox");
    expect(form.get("to")).toBe("+2250707070734");
    expect(form.get("from")).toBe("PALMIERS");
    handler = (_hit, res) => json(res, 200, { SMSMessageData: { Recipients: [{ status: "InvalidPhoneNumber" }] } });
    expect(await channel.deliver(message())).toMatchObject({ status: "FAILED", code: "provider_rejected" });
  });

  it("classe les réponses : 429/5xx passager (Retry-After respecté), 4xx définitif, critère de succès non satisfait définitif", async () => {
    const channel = createSmsHttpChannel({ env: genericEnv({ SMS_HTTP_ERROR_PATH: "error" }) });
    handler = (_hit, res) => json(res, 429, { error: "slow down" }, { "Retry-After": "30" });
    expect(await channel.deliver(message())).toMatchObject({ status: "RETRY", code: "http_429", retryAfterMs: 30_000 });
    handler = (_hit, res) => json(res, 503, {});
    expect(await channel.deliver(message())).toMatchObject({ status: "RETRY", code: "http_503" });
    handler = (_hit, res) => json(res, 400, { error: "numéro invalide +2250707070734" });
    const bad = await channel.deliver(message());
    expect(bad).toMatchObject({ status: "FAILED", code: "http_400" });
    if (bad.status === "FAILED") expect(bad.message).not.toContain("0707070734");
    handler = (_hit, res) => json(res, 200, { status: "rejected", error: "solde insuffisant" });
    expect(await channel.deliver(message())).toMatchObject({ status: "FAILED", code: "provider_rejected", message: "solde insuffisant" });
  });

  it("coupure et délai : pannes passagères (reprise avec backoff)", async () => {
    const down = createSmsHttpChannel({ env: genericEnv({ SMS_HTTP_URL: "http://127.0.0.1:1/x" }) });
    expect(await down.deliver(message())).toMatchObject({ status: "RETRY", code: "sms_unreachable" });
    handler = () => {
      /* ne répond jamais */
    };
    const slow = createSmsHttpChannel({ env: genericEnv({ SMS_HTTP_TIMEOUT_MS: "150" }) });
    expect(await slow.deliver(message())).toMatchObject({ status: "RETRY", code: "sms_timeout" });
  });

  it("non configuré ou mal configuré : échec EXPLICITE avec la liste des variables en cause", async () => {
    const channel = createSmsHttpChannel({ env: {} });
    expect(channel.status()).toEqual({ configured: false, missing: ["SMS_HTTP_URL"] });
    expect(await channel.deliver(message())).toMatchObject({ status: "FAILED", code: "channel_not_configured" });
    expect(readSmsHttpSettings({ SMS_HTTP_URL: "ftp://x", SMS_HTTP_BODY: "pas du json" }).problems.length).toBe(2);
    expect(readSmsHttpSettings({ SMS_HTTP_PROFILE: "inconnu", SMS_HTTP_URL: "https://x.example" }).problems.join(" ")).toMatch(/PROFILE/);
  });

  it("lecture d'un chemin JSON", () => {
    expect(readPath({ a: { b: [{ c: 7 }] } }, "a.b.0.c")).toBe(7);
    expect(readPath({ a: null }, "a.b")).toBeUndefined();
  });
});

describe("WhatsApp : WaSender derrière le port", () => {
  const env = (extra: Record<string, string> = {}) => ({ WASENDER_API_KEY: "wasender-secret", WASENDER_API_BASE_URL: base, ...extra });

  it("vérifie la session puis envoie (comportement du legacy), avec lien de désinscription et clé en en-tête Bearer", async () => {
    handler = (hit, res) => {
      if (hit.url === "/status") return json(res, 200, { status: "connected" });
      return json(res, 200, { data: { msgId: "WA-9" } });
    };
    const channel = createWasenderChannel({ env: env({ WASENDER_SESSION: "s1" }) });
    const outcome = await channel.deliver(message({ channel: "WHATSAPP" }));
    expect(outcome).toEqual({ status: "SENT", providerId: "WA-9" });
    expect(hits.map((h) => `${h.method} ${h.url}`)).toEqual(["GET /status", "POST /send-message"]);
    expect(hits[1]!.headers.authorization).toBe("Bearer wasender-secret");
    const sent = JSON.parse(hits[1]!.body.toString()) as { to: string; text: string; session: string };
    expect(sent.to).toBe("+2250707070734");
    expect(sent.session).toBe("s1");
    expect(sent.text).toContain("Ne plus recevoir de messages WhatsApp");
  });

  it("session déconnectée : reprise ; 429 / 5xx : reprise ; 4xx : échec définitif ; coupure : reprise", async () => {
    const channel = createWasenderChannel({ env: env() });
    handler = (_hit, res) => json(res, 200, { status: "disconnected" });
    expect(await channel.deliver(message({ channel: "WHATSAPP" }))).toMatchObject({ status: "RETRY", code: "wasender_session_not_connected" });
    handler = (hit, res) => (hit.url === "/status" ? json(res, 200, { status: "connected" }) : json(res, 429, { message: "rate" }, { "Retry-After": "5" }));
    expect(await channel.deliver(message({ channel: "WHATSAPP" }))).toMatchObject({ status: "RETRY", code: "http_429", retryAfterMs: 5000 });
    handler = (hit, res) => (hit.url === "/status" ? json(res, 200, { status: "connected" }) : json(res, 422, { message: "numéro +2250707070734 non WhatsApp" }));
    const bad = await channel.deliver(message({ channel: "WHATSAPP" }));
    expect(bad).toMatchObject({ status: "FAILED", code: "http_422" });
    if (bad.status === "FAILED") expect(bad.message).not.toContain("0707070734");
    const down = createWasenderChannel({ env: env({ WASENDER_API_BASE_URL: "http://127.0.0.1:1" }) });
    expect(await down.deliver(message({ channel: "WHATSAPP" }))).toMatchObject({ status: "RETRY", code: "wasender_unreachable" });
  });

  it("WASENDER_SKIP_STATUS_CHECK : pas de contrôle de session", async () => {
    handler = (_hit, res) => json(res, 200, { data: { id: 7 } });
    const channel = createWasenderChannel({ env: env({ WASENDER_SKIP_STATUS_CHECK: "1" }) });
    expect(await channel.deliver(message({ channel: "WHATSAPP" }))).toEqual({ status: "SENT", providerId: "7" });
    expect(hits).toHaveLength(1);
  });

  it("non configuré : échec explicite ; WHATSAPP_PROVIDER différent de wasender : non configuré", async () => {
    expect(wasenderStatus({})).toEqual({ configured: false, missing: ["WASENDER_API_KEY"] });
    expect(wasenderStatus({ WASENDER_API_KEY: "k", WHATSAPP_PROVIDER: "twilio" }).configured).toBe(false);
    expect(wasenderStatus({ WASENDER_API_KEY: "k", WHATSAPP_PROVIDER: "wasender" }).configured).toBe(true);
    expect(await createWasenderChannel({ env: {} }).deliver(message({ channel: "WHATSAPP" }))).toMatchObject({ status: "FAILED", code: "channel_not_configured" });
  });
});

describe("Web Push (VAPID)", () => {
  const vapid = webpush.generateVAPIDKeys();
  const env = { NOTIFICATIONS_VAPID_PUBLIC_KEY: vapid.publicKey, NOTIFICATIONS_VAPID_PRIVATE_KEY: vapid.privateKey, NOTIFICATIONS_VAPID_SUBJECT: "mailto:support@ecole.example.org" };

  function newDevice(id: string): { record: PushSubscriptionRecord; ecdh: ReturnType<typeof createECDH>; auth: Buffer } {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const auth = randomBytes(16);
    return { record: { id, endpoint: `${base}/push/${id}`, p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") }, ecdh, auth };
  }

  function memoryStore(devices: PushSubscriptionRecord[]): PushSubscriptionStore & { removed: string[]; failures: string[]; touched: string[] } {
    const state = { removed: [] as string[], failures: [] as string[], touched: [] as string[] };
    return {
      ...state,
      async listForUser() {
        return devices.filter((d) => !state.removed.includes(d.id));
      },
      async remove(_t, id) {
        state.removed.push(id);
      },
      async touch(_t, id) {
        state.touched.push(id);
      },
      async recordFailure(_t, id) {
        state.failures.push(id);
      },
    } as never;
  }

  it("envoie la notification chiffrée (RFC 8291) à chaque appareil, avec les en-têtes VAPID", async () => {
    const d1 = newDevice("d1");
    const d2 = newDevice("d2");
    const store = memoryStore([d1.record, d2.record]);
    handler = (_hit, res) => res.writeHead(201).end();
    const channel = createWebPushChannel({ env, store });
    expect(channel.status().configured).toBe(true);
    const outcome = await channel.deliver(message({ channel: "PUSH", address: "0190aaaa-0000-7000-8000-0000000000a1", subject: "Absence de Awa", link: "https://ecole.example.org/v2/parent", urgent: true }));
    expect(outcome).toEqual({ status: "SENT" });
    expect(hits.map((h) => h.url).sort()).toEqual(["/push/d1", "/push/d2"]);
    const hit = hits.find((h) => h.url === "/push/d1")!;
    expect(hit.headers["content-encoding"]).toBe("aes128gcm");
    expect(hit.headers.authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(hit.headers.urgency).toBe("high");
    expect(hit.headers.ttl).toBe(String(24 * 3600));
    // Déchiffrement avec la clé de l'appareil : le contenu est bien celui de la notification.
    const require = createRequire(createRequire(import.meta.url).resolve("web-push"));
    const ece = require("http_ece") as { decrypt(buf: Buffer, params: Record<string, unknown>): Buffer };
    const clear = ece.decrypt(hit.body, { version: "aes128gcm", privateKey: d1.ecdh, authSecret: d1.auth }).toString("utf8");
    expect(JSON.parse(clear)).toMatchObject({ title: "Absence de Awa", url: "https://ecole.example.org/v2/parent", urgent: true, tag: "absence" });
  });

  it("nettoyage : un abonnement expiré (410) est supprimé ; tous expirés = ignoré, sans abonnement vivant", async () => {
    const d1 = newDevice("e1");
    const d2 = newDevice("e2");
    const store = memoryStore([d1.record, d2.record]);
    handler = (hit, res) => res.writeHead(hit.url.endsWith("e1") ? 410 : 404).end();
    const channel = createWebPushChannel({ env, store });
    expect(await channel.deliver(message({ channel: "PUSH", address: "u" }))).toEqual({ status: "SKIPPED", reason: "no_subscription" });
    expect(store.removed.sort()).toEqual(["e1", "e2"]);
  });

  it("un appareil expiré n'empêche pas l'envoi aux autres ; une panne passagère est reprise", async () => {
    const dead = newDevice("x1");
    const live = newDevice("x2");
    const store = memoryStore([dead.record, live.record]);
    handler = (hit, res) => res.writeHead(hit.url.endsWith("x1") ? 410 : 201).end();
    const channel = createWebPushChannel({ env, store });
    expect(await channel.deliver(message({ channel: "PUSH", address: "u" }))).toEqual({ status: "SENT" });
    expect(store.removed).toEqual(["x1"]);
    expect(store.touched).toEqual(["x2"]);
    handler = (_hit, res) => res.writeHead(503).end();
    const retry = await createWebPushChannel({ env, store: memoryStore([newDevice("y1").record]) }).deliver(message({ channel: "PUSH", address: "u" }));
    expect(retry).toMatchObject({ status: "RETRY" });
  });

  it("sans abonnement : ignoré ; non configuré : échec explicite", async () => {
    const channel = createWebPushChannel({ env, store: memoryStore([]) });
    expect(await channel.deliver(message({ channel: "PUSH", address: "u" }))).toEqual({ status: "SKIPPED", reason: "no_subscription" });
    const unconfigured = createWebPushChannel({ env: {}, store: memoryStore([]) });
    expect(unconfigured.status().missing).toEqual(["NOTIFICATIONS_VAPID_PUBLIC_KEY", "NOTIFICATIONS_VAPID_PRIVATE_KEY", "NOTIFICATIONS_VAPID_SUBJECT"]);
    expect(await unconfigured.deliver(message({ channel: "PUSH", address: "u" }))).toMatchObject({ status: "FAILED", code: "channel_not_configured" });
    expect(webPushStatus({ ...env, NOTIFICATIONS_VAPID_SUBJECT: "support@ecole" }).configured).toBe(false);
  });
});
