/**
 * Intégration HTTP (Fastify `inject`, Postgres réel, rôle applicatif soumis à la RLS ; s'ignore sans TEST_DATABASE_URL).
 * Les gardes de permission sont simulées à partir des capacités des rôles (parent = `*.child.*`, élève = `*.self.*`, personnel,
 * administration) ; la RELATION (tuteur lié, affectation) est vérifiée par les cas d'usage sur l'annuaire du monde de test.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, ManualClock, createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import { createMessagingDeps, type MessagingDeps } from "../../application/deps";
import { RecordingAudit } from "../../application/ports";
import { messagingPlugin } from "../../http/plugin";
import { InMemoryStorage, inMemoryPorts } from "../../infrastructure/in-memory-ports";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { buildWorld, IDS, permissionsOf, registerRole } from "../support/world";

const PDF_B64 = Buffer.from("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n").toString("base64");
const EXE_B64 = Buffer.from("MZ\x90\x00\x03\x00 programme").toString("base64");

describeIntegration("module messaging : HTTP (matrice par rôle)", () => {
  let db: ModuleTestDb;
  let app: FastifyInstance;
  let tenantA: string;
  let tenantB: string;
  let deps: MessagingDeps;
  const audit = new RecordingAudit();
  const clock = new ManualClock("2026-10-02T09:00:00.000Z");

  const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, user: string | null, payload?: unknown, tenant = tenantA) =>
    app.inject({
      method,
      url,
      headers: { ...(user ? { "x-user": user, "x-tenant": tenant } : {}) },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });

  const world = buildWorld();

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("http-a");
    tenantB = await db.createTenant("http-b");
    deps = createMessagingDeps({ db: db.tenantDb, clock, audit, ports: inMemoryPorts(world, new InMemoryStorage()) });
    app = Fastify({ logger: false });
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      const user = request.headers["x-user"];
      const tenant = request.headers["x-tenant"];
      if (typeof user === "string" && typeof tenant === "string") (request as unknown as { ctx: RequestContext }).ctx = createRequestContext({ tenantId: tenant, userId: user });
    });
    await app.register(messagingPlugin, {
      deps,
      resolveContext: (request) => {
        const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
        if (!ctx) throw new ForbiddenError("sans contexte");
        return ctx;
      },
      requirePermission: (permission) => async (request) => {
        const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
        if (!ctx) throw new ForbiddenError("Authentification requise.", { code: "UNAUTHORIZED" });
        if (!permissionsOf(ctx.userId as string).has(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it("sans contexte : refus (aucune donnée) ; en-tête usurpé sans effet (l'identité vient du contexte)", async () => {
    expect((await call("GET", "/conversations", null)).statusCode).toBeGreaterThanOrEqual(401);
    const res = await app.inject({ method: "GET", url: "/conversations", headers: { "x-user": IDS.parent1, "x-tenant": tenantA, "x-user-id": IDS.admin } });
    expect(res.statusCode).toBe(200);
  });

  it("parent -> enseignant lié : 201 ; second message même objet : 200 (fil réutilisé) ; réponse de l'enseignant ; lecture", async () => {
    const created = await call("POST", "/conversations", IDS.parent1, { kind: "DIRECT", subject: "Devoirs de maths", body: "Bonjour", recipients: { userIds: [IDS.teacher6A] }, aboutStudentId: IDS.S1 });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    const { conversation, message } = created.json();
    expect(message).toMatchObject({ seq: 1, mine: true, body: "Bonjour" });
    const again = await call("POST", "/conversations", IDS.parent1, { kind: "DIRECT", subject: "Devoirs de maths", body: "Un complément", recipients: { userIds: [IDS.teacher6A] }, aboutStudentId: IDS.S1 });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ reused: true, conversation: { id: conversation.id } });

    const inbox = (await call("GET", "/conversations", IDS.teacher6A)).json();
    expect(inbox.items.find((c: { id: string }) => c.id === conversation.id)).toMatchObject({ unreadCount: 2, subject: "Devoirs de maths" });
    expect((await call("GET", "/me/unread", IDS.teacher6A)).json().conversations).toBeGreaterThanOrEqual(1);

    const replied = await call("POST", `/conversations/${conversation.id}/messages`, IDS.teacher6A, { body: "Voir la page 12" });
    expect(replied.statusCode).toBe(201);
    const msgs = (await call("GET", `/conversations/${conversation.id}/messages`, IDS.parent1)).json();
    expect(msgs.items.map((m: { body: string }) => m.body)).toEqual(["Bonjour", "Un complément", "Voir la page 12"]);
    expect(msgs.items.map((m: { mine: boolean }) => m.mine)).toEqual([true, true, false]);
    const read = await call("POST", `/conversations/${conversation.id}/read`, IDS.parent1, {});
    expect(read.json()).toEqual({ lastReadSeq: 3, unreadCount: 0 });
    const detail = (await call("GET", `/conversations/${conversation.id}`, IDS.parent1)).json();
    expect(detail).toMatchObject({ canReply: true, replyBlockedReason: null });
    expect(detail.participants.map((p: { userId: string }) => p.userId).sort()).toEqual([IDS.parent1, IDS.teacher6A].sort());
  });

  it("parent -> enseignant d'une autre classe : 403 avec code stable ; élève inconnu / non participant : 404 ; corps invalide : 400", async () => {
    const denied = await call("POST", "/conversations", IDS.parent1, { kind: "DIRECT", body: "Bonjour", recipients: { userIds: [IDS.teacher6B] } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "messaging.recipient_not_allowed", kind: "forbidden" });
    const other = (await call("POST", "/conversations", IDS.teacher6A, { kind: "DIRECT", subject: "Privé", body: "x", recipients: { userIds: [IDS.parent2] } })).json().conversation.id;
    expect((await call("GET", `/conversations/${other}`, IDS.parent1)).statusCode).toBe(404);
    expect((await call("GET", `/conversations/${other}/messages`, IDS.parent1)).statusCode).toBe(404);
    expect((await call("POST", `/conversations/${other}/messages`, IDS.parent1, { body: "intrus" })).statusCode).toBe(404);
    expect((await call("POST", "/conversations", IDS.parent1, { kind: "DIRECT", body: "  ", recipients: { userIds: [IDS.teacher6A] } })).statusCode).toBe(400);
    expect((await call("GET", "/conversations/pas-un-uuid", IDS.parent1)).statusCode).toBe(400);
    expect((await call("GET", "/conversations?folder=nimportequoi", IDS.parent1)).statusCode).toBe(400);
  });

  it("Q-13 par HTTP : 403 stable sans la permission explicite ; avec elle, 201 et le profil d'audience l'annonce", async () => {
    const TF = "0192f0a4-7b1e-7c3a-8d2e-000000000a91";
    world.addUser({ userId: TF, displayName: "HABILITE Enseignant", staffId: "0192f0a4-7b1e-7c3a-8d2e-000000000a92", teachingClassroomIds: [IDS.C6A] });
    registerRole(TF, "teacherFamily");
    // parent3 : tuteur d'un élève de 6B, hors des classes de teacher6A comme de TF
    const denied = await call("POST", "/conversations", IDS.teacher6A, { kind: "DIRECT", subject: "Hors classe", body: "Bonjour", recipients: { userIds: [IDS.parent3] } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "messaging.recipient_not_allowed", kind: "forbidden" });
    expect((await call("GET", "/me/audience", IDS.teacher6A)).json()).toMatchObject({ canSend: true, canSendAnyFamily: false });
    const sent = await call("POST", "/conversations", TF, { kind: "DIRECT", subject: "Hors classe", body: "Bonjour", recipients: { userIds: [IDS.parent3] } });
    expect(sent.statusCode).toBe(201);
    expect((await call("GET", "/me/audience", TF)).json()).toMatchObject({ canSend: true, canSendAnyFamily: true });
    expect((await call("GET", `/conversations/${sent.json().conversation.id}`, IDS.parent3)).statusCode).toBe(200);
    // la permission d'extension ne donne pas accès aux fonctions d'administration
    expect((await call("PUT", "/settings", TF, { studentPolicy: "DISABLED" })).statusCode).toBe(403);
    expect((await call("GET", "/moderation/reports", TF)).statusCode).toBe(403);
  });

  it("élève (politique par défaut) : écrit à son enseignant et à la direction, pas à un camarade ; permissions manquantes : 403", async () => {
    expect((await call("POST", "/conversations", IDS.student1, { kind: "DIRECT", subject: "Question", body: "x", recipients: { userIds: [IDS.teacher6A] } })).statusCode).toBe(201);
    expect((await call("POST", "/conversations", IDS.student1, { kind: "DIRECT", subject: "Camarade", body: "x", recipients: { userIds: [IDS.student3] } })).statusCode).toBe(403);
    // Un compte sans aucune permission de messagerie (aucun rôle) est refusé par le garde.
    expect((await call("GET", "/conversations", "0192f0a4-7b1e-7c3a-8d2e-0000000009ff")).statusCode).toBe(403);
    expect((await call("GET", "/moderation/reports", IDS.teacher6A)).statusCode).toBe(403);
    expect((await call("PUT", "/settings", IDS.parent1, { studentPolicy: "DISABLED" })).statusCode).toBe(403);
    expect((await call("GET", "/moderation/conversations", IDS.admin)).statusCode).toBe(200);
  });

  it("sélecteur de destinataires et profil d'audience", async () => {
    const recipients = (await call("GET", "/recipients", IDS.parent1)).json();
    expect(recipients.items.map((i: { userId: string }) => i.userId)).toEqual(expect.arrayContaining([IDS.teacher6A, IDS.admin]));
    expect(recipients.items.map((i: { userId: string }) => i.userId)).not.toContain(IDS.teacher6B);
    const audience = (await call("GET", "/me/audience", IDS.teacherBoth)).json();
    expect(audience).toMatchObject({ canSend: true, canSendAny: false, isStaff: true });
    expect(audience.classrooms).toHaveLength(2);
    expect((await call("GET", "/recipients", IDS.parent1)).headers["cache-control"]).toBe("no-store");
  });

  it("diffusion : 201 sans fil unique ; chaque destinataire a le sien ; archivage et favori par PATCH", async () => {
    const r = await call("POST", "/conversations", IDS.teacher6A, { kind: "BROADCAST", subject: "Circulaire HTTP", body: "Voir la pièce", recipients: { classrooms: [{ classroomId: IDS.C6A, include: ["GUARDIANS"] }] } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ conversation: null, message: null, recipientCount: 2 });
    const mine = (await call("GET", "/conversations", IDS.parent1)).json().items.find((c: { subject: string }) => c.subject === "Circulaire HTTP");
    const patched = await call("PATCH", `/conversations/${mine.id}/me`, IDS.parent1, { archived: true, starred: true });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ archived: true, starred: true });
    expect((await call("PATCH", `/conversations/${mine.id}/me`, IDS.parent1, {})).statusCode).toBe(400);
    expect((await call("GET", "/conversations?folder=archived", IDS.parent1)).json().items.map((c: { id: string }) => c.id)).toContain(mine.id);
    expect((await call("GET", "/conversations?folder=sent", IDS.teacher6A)).json().items.find((c: { subject: string }) => c.subject === "Circulaire HTTP")).toMatchObject({ broadcastCount: 2 });
  });

  it("pièce jointe : dépôt base64 (201), exécutable refusé (400), message avec pièce, URL signée seulement pour les participants", async () => {
    const bad = await call("POST", "/attachments", IDS.teacher6A, { fileName: "facture.pdf", contentBase64: EXE_B64 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code ?? bad.json().issues?.[0]?.code).toBe("messaging.attachment_type_rejected");
    const up = await call("POST", "/attachments", IDS.teacher6A, { fileName: "bulletin.pdf", contentBase64: PDF_B64 });
    expect(up.statusCode).toBe(201);
    const att = up.json();
    expect(att).toMatchObject({ fileName: "bulletin.pdf", mimeType: "application/pdf" });
    const sent = await call("POST", "/conversations", IDS.teacher6A, { kind: "DIRECT", subject: "Bulletin", body: "Ci-joint", recipients: { userIds: [IDS.parent1] }, attachmentIds: [att.id] });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().message.attachments).toEqual([att]);
    const url = await call("GET", `/attachments/${att.id}/url`, IDS.parent1);
    expect(url.statusCode).toBe(200);
    expect(url.json().url).toContain("storage.test");
    expect((await call("GET", `/attachments/${att.id}/url`, IDS.parent3)).statusCode).toBe(404);
  });

  it("annonces : publication ciblée, boîte du destinataire, lecture, accusé, chiffres réservés au gestionnaire", async () => {
    const forbidden = await call("POST", "/announcements", IDS.parent1, { title: "Hack", body: "x", audience: { targets: [{ kind: "TENANT" }] }, publish: true });
    expect(forbidden.statusCode).toBe(403);
    const hostile = await call("POST", "/announcements", IDS.teacher6A, { title: "Hors classe", body: "x", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6B }], audiences: ["GUARDIANS"] }, publish: true });
    expect(hostile.statusCode).toBe(403);
    expect(hostile.json().code).toBe("messaging.target_not_allowed");

    const created = await call("POST", "/announcements", IDS.admin, { title: "Réunion HTTP", body: "Mardi 17h", priority: "HIGH", requireAck: true, audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] }, publish: true });
    expect(created.statusCode).toBe(201);
    const a = created.json();
    expect(a).toMatchObject({ status: "PUBLISHED", stats: { recipients: 2, read: 0, acknowledged: 0 } });
    const listed = (await call("GET", "/announcements", IDS.parent1)).json();
    const mine = listed.items.find((x: { id: string }) => x.id === a.id);
    expect(mine).toMatchObject({ title: "Réunion HTTP", stats: null, myReadAt: null });
    expect((await call("GET", `/announcements/${a.id}`, IDS.parent3)).statusCode).toBe(404);
    expect((await call("GET", `/announcements/${a.id}`, IDS.parent1)).statusCode).toBe(200); // un GET n'écrit pas
    expect((await call("GET", `/announcements/${a.id}`, IDS.parent1)).json().myReadAt).toBeNull();
    expect((await call("POST", `/announcements/${a.id}/read`, IDS.parent1)).statusCode).toBe(200);
    expect((await call("POST", `/announcements/${a.id}/acknowledge`, IDS.parent1)).statusCode).toBe(200);
    const receipts = (await call("GET", `/announcements/${a.id}/receipts?state=acknowledged`, IDS.admin)).json();
    expect(receipts.items.map((r: { userId: string }) => r.userId)).toEqual([IDS.parent1]);
    expect((await call("GET", `/announcements/${a.id}/receipts`, IDS.parent1)).statusCode).toBe(403);
    expect((await call("GET", `/announcements?scope=managed`, IDS.admin)).json().items.find((x: { id: string }) => x.id === a.id)).toMatchObject({ stats: { recipients: 2, read: 1, acknowledged: 1 } });
    expect((await call("GET", `/announcements?scope=managed`, IDS.parent1)).statusCode).toBe(403);
    const preview = await call("POST", "/announcements/audience-preview", IDS.admin, { targets: [{ kind: "LEVEL", ref: IDS.LEVEL_6 }], audiences: ["GUARDIANS"] });
    expect(preview.json()).toEqual({ count: 3, truncated: false });
    const withdrawn = await call("POST", `/announcements/${a.id}/withdraw`, IDS.admin, { reason: "Date erronée" });
    expect(withdrawn.json().status).toBe("WITHDRAWN");
    expect((await call("POST", `/announcements/${a.id}/withdraw`, IDS.admin, { reason: "Encore" })).statusCode).toBe(409);
    expect((await call("GET", `/announcements/${a.id}`, IDS.parent1)).statusCode).toBe(404);
  });

  it("notifications : liste, lecture, tout lire ; préférences", async () => {
    const page = (await call("GET", "/notifications?unread=true", IDS.parent1)).json();
    expect(page.unreadCount).toBeGreaterThan(0);
    const first = page.items[0];
    expect((await call("POST", `/notifications/${first.id}/read`, IDS.parent1)).json().unreadCount).toBe(page.unreadCount - 1);
    expect((await call("POST", `/notifications/${first.id}/read`, IDS.parent3)).statusCode).toBe(404);
    expect((await call("POST", "/notifications/read-all", IDS.parent1)).json().markedRead).toBeGreaterThanOrEqual(0);
    expect((await call("GET", "/me/unread", IDS.parent1)).json().notifications).toBe(0);
    const prefs = await call("PUT", "/me/preferences", IDS.parent1, { preferences: [{ category: "MESSAGE", inApp: false, externalChannels: ["SMS"] }] });
    expect(prefs.statusCode).toBe(200);
    expect(prefs.json().items.find((p: { category: string }) => p.category === "MESSAGE")).toMatchObject({ inApp: false, externalChannels: ["SMS"] });
    expect((await call("PUT", "/me/preferences", IDS.parent1, { preferences: [{ category: "MODERATION", inApp: false }] })).statusCode).toBe(400);
  });

  it("modération par HTTP : signalement, contexte (audité), décision, restriction ; supervision avec motif obligatoire", async () => {
    const c = (await call("POST", "/conversations", IDS.parent2, { kind: "DIRECT", subject: "Litige HTTP", body: "Propos déplacés", recipients: { userIds: [IDS.teacher6A] } })).json();
    const rep = await call("POST", `/messages/${c.message.id}/report`, IDS.teacher6A, { reason: "HARASSMENT", details: "Insultes" });
    expect(rep.statusCode).toBe(201);
    expect((await call("POST", `/messages/${c.message.id}/report`, IDS.teacher6A, { reason: "SPAM" })).statusCode).toBe(409);
    const reports = (await call("GET", "/moderation/reports?status=OPEN", IDS.admin)).json();
    const reportId = reports.items.find((r: { messageId: string }) => r.messageId === c.message.id).id;
    const before = audit.entries.length;
    const ctx = await call("GET", `/moderation/reports/${reportId}`, IDS.admin);
    expect(ctx.statusCode).toBe(200);
    expect(ctx.json().messages[0].rawBody).toBe("Propos déplacés");
    expect(audit.entries.slice(before).map((e) => e.entry.action)).toContain("messaging.report.context_read");
    expect((await call("GET", `/moderation/reports/${reportId}`, IDS.teacher6A)).statusCode).toBe(403);
    const bad = await call("POST", `/moderation/reports/${reportId}/decide`, IDS.admin, { decision: "ACTION", note: "Confirmé" });
    expect(bad.statusCode).toBe(400);
    const decided = await call("POST", `/moderation/reports/${reportId}/decide`, IDS.admin, { decision: "ACTION", note: "Propos confirmés", removeMessage: true, restrictSender: { untilDays: 3 } });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().status).toBe("ACTIONED");
    const blocked = await call("POST", "/conversations", IDS.parent2, { kind: "DIRECT", subject: "Après sanction", body: "x", recipients: { userIds: [IDS.teacher6A] } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("messaging.sender_restricted");
    expect((await call("GET", "/moderation/restrictions", IDS.admin)).json().items.map((r: { userId: string }) => r.userId)).toContain(IDS.parent2);
    expect((await call("DELETE", `/moderation/restrictions/${IDS.parent2}`, IDS.admin)).statusCode).toBe(204);
    // Supervision : motif obligatoire.
    const noReason = await call("GET", `/moderation/conversations/${c.conversation.id}/messages`, IDS.admin);
    expect(noReason.statusCode).toBe(400);
    const sup = await call("GET", `/moderation/conversations/${c.conversation.id}/messages?reason=${encodeURIComponent("Enquête parent")}`, IDS.admin);
    expect(sup.statusCode).toBe(200);
    expect(sup.json().items[0].rawBody).toBe("Propos déplacés");
    expect(audit.entries.some((e) => e.entry.action === "messaging.supervision.read" && e.entry.reason === "Enquête parent")).toBe(true);
  });

  it("paramètres et gabarits : lecture pour tous les lecteurs, écriture réservée ; validation des plafonds", async () => {
    expect((await call("GET", "/settings", IDS.parent1)).json()).toMatchObject({ studentPolicy: "TEACHERS_AND_ADMIN" });
    const put = await call("PUT", "/settings", IDS.admin, { studentPolicy: "TEACHERS", maxMessagesPerHour: 100 });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ studentPolicy: "TEACHERS", maxMessagesPerHour: 100 });
    expect((await call("PUT", "/settings", IDS.admin, {})).statusCode).toBe(400);
    expect((await call("PUT", "/settings", IDS.admin, { maxMessagesPerHour: 0 })).statusCode).toBe(400);
    expect((await call("PUT", "/settings", IDS.admin, { surprise: true })).statusCode).toBe(400);
    expect((await call("GET", "/templates", IDS.admin)).json().items.map((t: { code: string }) => t.code)).toEqual(["attendance.absence", "attendance.late"]);
    expect((await call("PUT", "/templates/attendance.late", IDS.admin, { enabled: true })).json()).toMatchObject({ enabled: true, customized: true });
    expect((await call("PUT", "/templates/attendance.late", IDS.admin, { body: "{{nope}}" })).statusCode).toBe(400);
    expect((await call("PUT", "/templates/inconnu.code", IDS.admin, { enabled: true })).statusCode).toBe(404);
    expect((await call("PUT", "/templates/attendance.late", IDS.teacher6A, { enabled: false })).statusCode).toBe(403);
  });

  it("isolation HTTP : le même utilisateur vu depuis un autre tenant ne voit rien", async () => {
    const list = (await call("GET", "/conversations", IDS.parent1, undefined, tenantB)).json();
    expect(list.items).toEqual([]);
    const ann = (await call("GET", "/announcements", IDS.parent1, undefined, tenantB)).json();
    expect(ann.items).toEqual([]);
  });
});
