/**
 * Intégration HTTP (Fastify `inject`, Postgres réel, rôle applicatif soumis à la RLS ; s'ignore sans TEST_DATABASE_URL).
 * Les gardes de permission sont simulées à partir de matrices de rôles ; les cas d'usage, la RLS et les routes publiques
 * signées sont ceux du module.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, ManualClock, createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import { createNotificationsDeps, type NotificationsDeps } from "../../application/deps";
import { dispatchTenant } from "../../application/dispatch";
import { onDomainEvent } from "../../application/events";
import { RecordingAudit } from "../../application/ports";
import { notificationsPlugin } from "../../http/plugin";
import { signBody, signUnsubscribeToken } from "../../domain/tokens";
import { createInAppChannel } from "../../infrastructure/channels/in-app";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { buildWorld, GUARDIAN_A, IDS, registryOf, scriptedChannels, type ScriptedChannels } from "../support/world";

const STAFF = IDS.teacher;
const PERMISSIONS: Record<string, string[]> = {
  [IDS.admin]: ["notifications.read", "notifications.templates.manage", "notifications.rules.manage", "notifications.settings.manage", "notifications.send", "notifications.send.urgent", "notifications.consent.manage", "notifications.own.manage"],
  [STAFF]: ["notifications.read", "notifications.send", "notifications.own.manage"],
  [IDS.guardianFinancial]: ["notifications.child.manage"],
  [IDS.studentUser]: ["notifications.self.manage"],
};

describeIntegration("module notifications : HTTP (matrice par rôle, routes publiques signées)", () => {
  let db: ModuleTestDb;
  let app: FastifyInstance;
  let tenantA: string;
  let tenantB: string;
  let deps: NotificationsDeps;
  let ch: ScriptedChannels;
  const audit = new RecordingAudit();
  const clock = new ManualClock("2026-10-02T09:00:00.000Z");
  const SECRET_U = "secret-desinscription";
  const SECRET_W = "secret-accuses";

  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, user: string | null, payload?: unknown, tenant = tenantA, headers: Record<string, string> = {}) =>
    app.inject({
      method,
      url,
      headers: { ...(user ? { "x-user": user, "x-tenant": tenant } : {}), ...headers },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> | string } : {}),
    });
  const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => db.admin.query(sql, params).then((r) => r.rows as T[]);

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("http-a");
    tenantB = await db.createTenant("http-b");
    ch = scriptedChannels();
    const mem = inMemoryPorts();
    deps = createNotificationsDeps({
      db: db.tenantDb,
      clock,
      audit,
      ports: { ...mem.ports, directory: buildWorld() },
      channels: registryOf(createInAppChannel({ db: db.tenantDb, clock }), ch),
      config: { appBaseUrl: "https://ecole.example.org", unsubscribeSecret: SECRET_U, webhookSecret: SECRET_W },
      random: () => 0,
    });
    app = Fastify({ logger: false });
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      const user = request.headers["x-user"];
      const tenant = request.headers["x-tenant"];
      if (typeof user === "string" && typeof tenant === "string") (request as unknown as { ctx: RequestContext }).ctx = createRequestContext({ tenantId: tenant, userId: user });
    });
    await app.register(notificationsPlugin, {
      deps,
      resolveContext: (request) => {
        const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
        if (!ctx) throw new ForbiddenError("sans contexte");
        return ctx;
      },
      requirePermission: (permission) => async (request) => {
        const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
        if (!ctx) throw new ForbiddenError("Authentification requise.", { code: "UNAUTHORIZED" });
        if (!(PERMISSIONS[ctx.userId as string] ?? []).includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it("préférences de la personne : parent et élève gèrent LES LEURS ; un compte sans permission de portée est refusé ; identité usurpée sans effet", async () => {
    expect((await call("GET", "/me/preferences", null)).statusCode).toBeGreaterThanOrEqual(401);
    expect((await call("GET", "/me/preferences", IDS.hr)).statusCode).toBe(403);
    const prefs = await call("GET", "/me/preferences", IDS.guardianFinancial);
    expect(prefs.statusCode).toBe(200);
    expect(prefs.json().channels.map((c: { channel: string }) => c.channel)).toEqual(["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"]);
    expect(prefs.json().channels.find((c: { channel: string }) => c.channel === "EMAIL")).toMatchObject({ available: true, enabled: true, consentModel: "IMPLIED" });
    const put = await call("PUT", "/me/preferences", IDS.guardianFinancial, { channels: [{ channel: "SMS", category: "*", enabled: false }], quietHours: { enabled: true, start: "21:00", end: "06:30" } }, tenantA, { "x-user-id": IDS.admin });
    expect(put.statusCode).toBe(200);
    expect(put.json().channels.find((c: { channel: string }) => c.channel === "SMS").enabled).toBe(false);
    expect(put.json().quietHours).toMatchObject({ enabled: true, start: "21:00", end: "06:30", inherited: false });
    // L'élève ne voit pas les préférences du parent.
    expect((await call("GET", "/me/preferences", IDS.studentUser)).json().channels.find((c: { channel: string }) => c.channel === "SMS").enabled).toBe(true);
    expect((await call("PUT", "/me/preferences", IDS.studentUser, {})).statusCode).toBe(400);
    expect((await call("PUT", "/me/preferences", IDS.studentUser, { channels: [{ channel: "FAX", category: "*", enabled: false }] })).statusCode).toBe(400);
    const log = (await call("GET", `/consent/log?userId=${IDS.guardianFinancial}`, IDS.admin)).json();
    expect(log.items[0]).toMatchObject({ channel: "SMS", enabled: false, source: "SELF" });
    expect((await call("GET", `/consent/log?userId=${IDS.guardianFinancial}`, STAFF)).statusCode).toBe(403);
  });

  it("gabarits : publication (201), versions, retour arrière, aperçu ; validation 400 ; réservé à la gestion des gabarits", async () => {
    expect((await call("POST", "/templates/absence", STAFF, { channel: "SMS", body: "x" })).statusCode).toBe(403);
    const published = await call("POST", "/templates/absence", IDS.admin, { channel: "SMS", body: "{{studentName}} absent(e) le {{date}}", note: "court" });
    expect(published.statusCode).toBe(201);
    expect(published.json()).toEqual({ version: 1 });
    const bad = await call("POST", "/templates/absence", IDS.admin, { channel: "SMS", body: "{{inconnue}}" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: "notifications.template_variable_unknown" });
    expect((await call("POST", "/templates/absence", IDS.admin, { channel: "EMAIL", body: "sans objet" })).statusCode).toBe(400);
    const versions = (await call("GET", "/templates/absence/versions?channel=SMS", IDS.admin)).json();
    expect(versions.items).toMatchObject([{ version: 1, active: true, note: "court" }]);
    const list = (await call("GET", "/templates", STAFF)).json();
    expect(list.items.find((t: { code: string; channel: string }) => t.code === "absence" && t.channel === "SMS")).toMatchObject({ source: "TENANT", version: 1 });
    expect(list.items.find((t: { code: string; channel: string }) => t.code === "absence" && t.channel === "EMAIL")).toMatchObject({ source: "SHIPPED", version: 0 });
    expect((await call("POST", "/templates/absence/activate", IDS.admin, { channel: "SMS", version: 0 })).json()).toEqual({ version: 0 });
    expect((await call("POST", "/templates/absence/activate", IDS.admin, { channel: "SMS", version: 7 })).statusCode).toBe(404);
    const preview = await call("POST", "/templates/invoice_issued/preview", IDS.admin, { channel: "EMAIL" });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().html).toContain("Se désinscrire");
    expect((await call("POST", "/templates/absence/enable", IDS.admin, { channel: "SMS", enabled: false })).json()).toEqual({ enabled: false });
    await call("POST", "/templates/absence/enable", IDS.admin, { channel: "SMS", enabled: true });
  });

  it("règles : liste fusionnée, surcharge, remise aux valeurs livrées (204) ; règle invalide : 400 avec code stable", async () => {
    const rules = (await call("GET", "/rules", STAFF)).json().items;
    expect(rules.find((r: { key: string }) => r.key === "dunning.default")).toMatchObject({ kind: "DUNNING", source: "SHIPPED", conditions: { stages: [7, 21, 45] } });
    const body = { enabled: true, templateCode: "payment_reminder", audience: { kind: "STUDENT_GUARDIANS" }, channels: ["EMAIL"], strategy: "ALL", urgent: false, conditions: { stages: [2, 8] } };
    expect((await call("PUT", "/rules/dunning.default", STAFF, body)).statusCode).toBe(403);
    const saved = await call("PUT", "/rules/dunning.default", IDS.admin, body);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ source: "TENANT", conditions: { stages: [2, 8] } });
    const bad = await call("PUT", "/rules/dunning.default", IDS.admin, { ...body, conditions: { stages: [8, 2] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: "notifications.rule_invalid" });
    expect((await call("DELETE", "/rules/dunning.default", IDS.admin)).statusCode).toBe(204);
    expect((await call("GET", "/rules", IDS.admin)).json().items.find((r: { key: string }) => r.key === "dunning.default")).toMatchObject({ source: "SHIPPED" });
    expect((await call("DELETE", "/rules/custom.inexistante", IDS.admin)).statusCode).toBe(404);
  });

  it("envoi manuel : le personnel envoie, l'urgence exige l'autorisation sensible ; 202 puis réutilisation par clé client (200)", async () => {
    const convocation = { templateCode: "convocation", audience: { kind: "STUDENT_GUARDIANS", studentIds: [IDS.S1] }, variables: { subject: "Entretien", date: "2026-10-09", time: "09:30", place: "Bureau" }, channels: ["EMAIL"], clientKey: "http-conv-0001" };
    const first = await call("POST", "/send", STAFF, convocation);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ recipients: 2, deliveries: 1, reused: false });
    const again = await call("POST", "/send", STAFF, convocation);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ reused: true, deliveries: 0 });
    const urgent = { templateCode: "urgent_notice", audience: { kind: "USERS", userIds: [IDS.guardianFinancial] }, variables: { title: "Fermeture", message: "Demain" }, channels: ["EMAIL"] };
    expect((await call("POST", "/send", STAFF, urgent)).statusCode).toBe(403);
    expect((await call("POST", "/send", IDS.admin, urgent)).statusCode).toBe(202);
    expect((await call("POST", "/send", STAFF, { ...convocation, variables: { subject: "x" }, clientKey: "http-conv-0002" })).statusCode).toBe(400);
    expect((await call("POST", "/send", IDS.studentUser, convocation)).statusCode).toBe(403);
  });

  it("journal : lecture réservée, destinataires masqués, filtres ; le tenant B ne voit rien de A", async () => {
    await dispatchTenant(deps, tenantA);
    expect((await call("GET", "/deliveries", IDS.guardianFinancial)).statusCode).toBe(403);
    const res = await call("GET", "/deliveries?status=SENT&limit=50", STAFF);
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(JSON.stringify(items)).not.toMatch(/mariam\.kone|0707070734|Entretien/i); // ni adresse complète, ni contenu
    expect(items.every((i: { recipient: string }) => /\*\*\*|\*\*|compte /.test(i.recipient))).toBe(true);
    expect((await call("GET", "/deliveries", STAFF, undefined, tenantB)).json().items).toEqual([]);
    expect((await call("GET", "/deliveries/stats?days=7", STAFF)).json().byStatus.SENT).toBeGreaterThan(0);
    expect((await call("GET", "/deliveries?limit=1000", STAFF)).statusCode).toBe(400);
  });

  it("canaux : état de santé et essai (202) réservés à la gestion ; paramètres validés", async () => {
    const health = await call("GET", "/channels", STAFF);
    expect(health.statusCode).toBe(200);
    expect(health.json().items).toHaveLength(5);
    expect(health.json().items.find((c: { channel: string }) => c.channel === "EMAIL")).toMatchObject({ configured: true, state: expect.stringMatching(/OK|DEGRADED/) });
    expect((await call("POST", "/channels/test", STAFF, { channels: ["EMAIL"] })).statusCode).toBe(403);
    const test = await call("POST", "/channels/test", IDS.admin, { channels: ["EMAIL"] });
    expect(test.statusCode).toBe(202);
    expect(test.json()).toEqual({ queued: 1, skipped: 0 });
    expect((await call("PUT", "/settings", IDS.admin, { quietStart: "25:00" })).statusCode).toBe(400);
    expect((await call("PUT", "/settings", IDS.admin, { timezone: "Mars/Olympus" })).statusCode).toBe(400);
    const s = await call("PUT", "/settings", IDS.admin, { senderName: "Les Palmiers", legalFooter: "RCCM CI-ABJ-1" });
    expect(s.json()).toMatchObject({ senderName: "Les Palmiers" });
    expect((await call("GET", "/settings", STAFF)).json().senderName).toBe("Les Palmiers");
  });

  it("Web Push : clé VAPID, abonnement (HTTPS exigé), liste, retrait ; uniquement SES appareils", async () => {
    const key = await call("GET", "/me/push/vapid-key", IDS.guardianFinancial);
    expect(key.json()).toEqual({ publicKey: null, configured: true }); // canal configuré, clé publique non fournie par l'environnement du test
    const sub = { endpoint: "https://push.example.org/send/xyz", keys: { p256dh: "B".repeat(87), auth: "c".repeat(22) }, deviceLabel: "Mon téléphone" };
    const created = await call("POST", "/me/push/subscriptions", IDS.guardianFinancial, sub);
    expect(created.statusCode).toBe(201);
    expect((await call("GET", "/me/push/devices", IDS.guardianFinancial)).json().items).toMatchObject([{ deviceLabel: "Mon téléphone" }]);
    expect((await call("GET", "/me/push/devices", IDS.studentUser)).json().items).toEqual([]);
    const id = created.json().id as string;
    expect((await call("DELETE", `/me/push/devices/${id}`, IDS.studentUser)).statusCode).toBe(204);
    expect((await call("GET", "/me/push/devices", IDS.guardianFinancial)).json().items).toHaveLength(1); // pas celui d'autrui
    expect((await call("POST", "/me/push/unsubscribe", IDS.guardianFinancial, { endpoint: sub.endpoint })).json()).toEqual({ removed: true });
  });

  it("désinscription publique : GET n'écrit pas, POST applique ; jeton falsifié ou d'un autre tenant refusé ; preuve consignée", async () => {
    const token = signUnsubscribeToken({ tenantId: tenantA, subjectKey: GUARDIAN_A.subjectKey, channel: "EMAIL" }, SECRET_U);
    const before = (await q("SELECT 1 FROM notifications.channel_preferences WHERE channel = 'EMAIL'")).length;
    const info = await call("GET", `/public/unsubscribe?t=${encodeURIComponent(token)}`, null);
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ channel: "EMAIL", applied: false, organization: "Les Palmiers" });
    expect((await q("SELECT 1 FROM notifications.channel_preferences WHERE channel = 'EMAIL'")).length).toBe(before); // aucun GET n'écrit
    const applied = await call("POST", `/public/unsubscribe?t=${encodeURIComponent(token)}`, null);
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ channel: "EMAIL", applied: true });
    expect((await call("POST", `/public/unsubscribe?t=${encodeURIComponent(token)}`, null)).json().applied).toBe(false); // idempotent
    expect((await call("POST", `/public/unsubscribe?t=${encodeURIComponent(token.slice(0, -2) + "zz")}`, null)).statusCode).toBe(403);
    const foreign = signUnsubscribeToken({ tenantId: tenantB, subjectKey: GUARDIAN_A.subjectKey, channel: "EMAIL" }, SECRET_U);
    expect((await call("POST", `/public/unsubscribe?t=${encodeURIComponent(foreign)}`, null)).statusCode).toBe(200); // valide pour B... mais n'écrit que chez B
    expect((await q("SELECT 1 FROM notifications.channel_preferences WHERE tenant_id = $1 AND channel = 'EMAIL'", [tenantB])).length).toBe(1);
    expect((await q("SELECT 1 FROM notifications.consent_log WHERE tenant_id = $1 AND source = 'UNSUBSCRIBE_LINK'", [tenantA])).length).toBe(1);
  });

  it("accusés de fournisseurs : corps signé exigé ; remise confirmée ; tenant de l'URL respecté ; signature sur le corps exact", async () => {
    await onDomainEvent(deps, createRequestContext({ tenantId: tenantA, actor: "system", userId: null }), {
      eventId: IDS.EVT(5000),
      eventType: "finance.invoice.issued",
      payload: { v: 1, invoiceId: IDS.INV1, number: "F-WH", learnerId: IDS.S2, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 1000, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null },
    });
    ch.EMAIL.script.push({ status: "SENT", providerId: "wh-1" });
    await dispatchTenant(deps, tenantA);
    const body = JSON.stringify({ providerId: "wh-1", status: "DELIVERED" });
    const url = `/webhooks/${tenantA}/delivery-status`;
    const unsigned = await call("POST", url, null, body, tenantA, { "content-type": "application/json" });
    expect(unsigned.statusCode).toBe(403);
    const tampered = await call("POST", url, null, body.replace("DELIVERED", "BOUNCED"), tenantA, { "content-type": "application/json", "x-notifications-signature": signBody(body, SECRET_W) });
    expect(tampered.statusCode).toBe(403);
    const ok = await call("POST", url, null, body, tenantA, { "content-type": "application/json", "x-notifications-signature": signBody(body, SECRET_W) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ matched: 1 });
    expect((await q("SELECT status FROM notifications.deliveries WHERE provider_id = 'wh-1'"))[0]).toEqual({ status: "DELIVERED" });
    // Même signature pour un autre tenant : aucune remise de A n'est touchée.
    const other = await call("POST", `/webhooks/${tenantB}/delivery-status`, null, body, tenantB, { "content-type": "application/json", "x-notifications-signature": signBody(body, SECRET_W) });
    expect(other.json()).toEqual({ matched: 0 });
    expect((await call("POST", "/webhooks/pas-un-uuid/delivery-status", null, body, tenantA, { "content-type": "application/json", "x-notifications-signature": signBody(body, SECRET_W) })).statusCode).toBe(400);
  });
});
