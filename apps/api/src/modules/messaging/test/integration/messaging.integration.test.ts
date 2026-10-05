/**
 * Intégration (Postgres réel, rôle applicatif soumis à la RLS ; s'ignore sans TEST_DATABASE_URL).
 *
 * Prouve : isolation A/B (structure + comportement + vraies données dans chaque table), matrice d'autorisation
 * parent / enseignant / élève / administration avec les liens du monde de test, diffusions privées, pièces jointes
 * (type réel, taille, liaison unique, accès), annonces ciblées (destinataires, expiration, retrait, accusés, programmation),
 * notifications (dédoublonnage, préférences, compteurs), modération (signalement, décision, restriction, supervision
 * motivée et auditée), quotas anti-spam, messages système idempotents, atomicité (rollback si l'audit échoue).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { createRequestContext, createSystemContext, ManualClock, unwrap, type RequestContext, type Result, type AppError } from "@ecoledigitale/kernel";
import allowlist, { fixtures } from "../../../isolation-allowlist.messaging";
import {
  acknowledgeAnnouncement,
  createAnnouncement,
  deleteAnnouncementDraft,
  getAnnouncementDetail,
  listAnnouncementReceipts,
  listAnnouncements,
  markAnnouncementRead,
  previewAudience,
  publishAnnouncement,
  publishDueAnnouncements,
  updateAnnouncement,
  withdrawAnnouncement,
} from "../../application/announcements";
import { getAttachmentUrl, purgeOrphanAttachments, uploadAttachment } from "../../application/attachments";
import { onAttendanceRecorded } from "../../application/consumers";
import {
  createConversation,
  getConversationDetail,
  leaveConversation,
  listConversationMessages,
  listConversations,
  markConversationRead,
  postMessage,
  removeOwnMessage,
  searchMyMessages,
  setParticipantState,
  type CreateConversationInput,
} from "../../application/conversations";
import { createMessagingDeps, type MessagingDeps } from "../../application/deps";
import { decideReport, getReportContext, liftRestriction, listActiveRestrictions, listReports, reportMessage, restrictUser, superviseListConversations, superviseReadMessages } from "../../application/moderation";
import { getMyPreferences, getUnreadSummary, listMyNotifications, markAllNotificationsRead, markNotificationRead, purgeOldNotifications, updateMyPreferences } from "../../application/notifications";
import { RecordingAudit } from "../../application/ports";
import { getMyAudience, listAllowedRecipients } from "../../application/recipients";
import { getMessagingSettings, listSystemTemplates, updateMessagingSettings, updateSystemTemplate } from "../../application/settings";
import { MessagingCode, RateLimitedError } from "../../domain/errors";
import { InMemoryDirectory, InMemoryStorage, inMemoryPorts } from "../../infrastructure/in-memory-ports";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { buildWorld, capsOf, IDS } from "../support/world";

const PDF = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n"));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EXE = new Uint8Array(Buffer.from("MZ\x90\x00\x03\x00\x00\x00 programme"));

const ALL_TABLES = [
  "settings", "conversations", "conversation_participants", "messages", "attachments", "announcements", "announcement_targets",
  "announcement_recipients", "notifications", "notification_preferences", "reports", "restrictions", "system_templates",
];

function expectErr<T>(r: Result<T, AppError>, code: string): AppError {
  expect(r.ok, `attendu : erreur « ${code} »`).toBe(false);
  if (r.ok) throw new Error("unreachable");
  expect(r.error.code).toBe(code);
  return r.error;
}

describeIntegration("module messaging : base réelle", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  let world: InMemoryDirectory;
  let storage: InMemoryStorage;
  let audit: RecordingAudit;
  let deps: MessagingDeps;
  const clock = new ManualClock("2026-10-02T09:00:00.000Z");

  const ctxOf = (userId: string, tenantId = tenantA): RequestContext => createRequestContext({ tenantId, userId });
  const as = (userId: string) => ({ ctx: ctxOf(userId), caps: capsOf(userId) });

  const direct = (from: string, to: string, extra: Partial<CreateConversationInput> = {}) => {
    const { ctx, caps } = as(from);
    return createConversation(deps, ctx, { kind: "DIRECT", body: "Bonjour", priority: "NORMAL", recipients: { userIds: [to], classrooms: [], toAdministration: false }, attachmentIds: [], caps, ...extra });
  };
  const group = (from: string, userIds: string[], subject: string, extra: Partial<CreateConversationInput> = {}) => {
    const { ctx, caps } = as(from);
    return createConversation(deps, ctx, { kind: "GROUP", subject, body: "Bonjour à tous", priority: "NORMAL", recipients: { userIds, classrooms: [], toAdministration: false }, attachmentIds: [], caps, ...extra });
  };
  const toClass = (from: string, classroomId: string, include: Array<"STUDENTS" | "GUARDIANS" | "TEACHERS">, kind: "GROUP" | "BROADCAST", subject: string) => {
    const { ctx, caps } = as(from);
    return createConversation(deps, ctx, { kind, subject, body: `Message à ${subject}`, priority: "NORMAL", recipients: { userIds: [], classrooms: [{ classroomId, include }], toAdministration: false }, attachmentIds: [], caps });
  };
  const reply = (from: string, conversationId: string, body = "Réponse") => {
    const { ctx, caps } = as(from);
    return postMessage(deps, ctx, { conversationId, body, attachmentIds: [], caps });
  };
  const unreadOf = async (userId: string) => unwrap(await getUnreadSummary(deps, ctxOf(userId)));
  const inbox = async (userId: string, folder: "inbox" | "archived" | "starred" | "sent" = "inbox") => unwrap(await listConversations(deps, ctxOf(userId), { folder, limit: 100 })).items;
  const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => db.admin.query(sql, params).then((r) => r.rows as T[]);

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("tenant-a");
    tenantB = await db.createTenant("tenant-b");
    world = buildWorld();
    storage = new InMemoryStorage();
    audit = new RecordingAudit();
    deps = createMessagingDeps({ db: db.tenantDb, clock, audit, ports: inMemoryPorts(world, storage) });
  });
  afterAll(async () => {
    await db?.drop();
  });

  // =========================================================================================================
  describe("isolation multi-tenant (RLS)", () => {
    it("assertTenantIsolation : chaque table du schéma est isolée (structure + comportement A/B)", async () => {
      const report = await assertTenantIsolation({ pool: db.appPool, schemas: ["messaging"], allowlist: allowlist.map((e) => e.table), ...(fixtures ? { fixtures } : {}) } as Parameters<typeof assertTenantIsolation>[0]);
      expect(report.violations).toEqual([]);
      expect(report.staleAllowlist).toEqual([]);
      // Le générateur fabrique les lignes des tables sans clé étrangère interne ; les autres sont prouvées avec de vraies données
      // dans le test suivant (comme `people`).
      expect(report.behavioural).toEqual(expect.arrayContaining(["messaging.settings", "messaging.restrictions", "messaging.system_templates"]));
    });

    it("un autre tenant ne voit ni conversation, ni annonce, ni notification, ni pièce (vraies données)", async () => {
      const sent = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Isolation" }));
      const announcement = unwrap(await createAnnouncement(deps, ctxOf(IDS.admin), { title: "Isolation", body: "…", priority: "NORMAL", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] }, requireAck: false, pinned: false, attachmentIds: [], publish: true, caps: capsOf(IDS.admin) }));
      unwrap(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "iso.pdf", content: PDF }));
      // Même identifiants d'utilisateur dans le tenant B : rien ne doit apparaître.
      expect(await inbox(IDS.parent1)).not.toHaveLength(0);
      const other = ctxOf(IDS.parent1, tenantB);
      expect(unwrap(await listConversations(deps, other, { folder: "inbox", limit: 50 })).items).toEqual([]);
      expect(unwrap(await listAnnouncements(deps, other, { scope: "inbox", limit: 50 })).items).toEqual([]);
      expect(unwrap(await listMyNotifications(deps, other, { limit: 50 })).items).toEqual([]);
      expectErr(await getConversationDetail(deps, other, { conversationId: sent.conversation!.id }), MessagingCode.CONVERSATION_NOT_FOUND);
      expectErr(await getAnnouncementDetail(deps, other, { announcementId: announcement.id }), MessagingCode.ANNOUNCEMENT_NOT_FOUND);
      // Les tables à clés étrangères composites ne sont pas fabricables par le test générique : on les remplit avec de VRAIES
      // données (signalement, restriction, préférence, gabarit, paramètres) puis on compte sous chaque tenant.
      const bad = unwrap(await direct(IDS.parent1, IDS.teacher6A, { subject: "Isolation signalement" }));
      const msg = unwrap(await postMessage(deps, ctxOf(IDS.parent1), { conversationId: bad.conversation!.id, body: "À signaler", attachmentIds: [], caps: capsOf(IDS.parent1) })).message;
      unwrap(await reportMessage(deps, ctxOf(IDS.teacher6A), { messageId: msg.id, reason: "OTHER" }));
      unwrap(await restrictUser(deps, ctxOf(IDS.admin), { userId: IDS.outsider, reason: "Isolation", untilDays: 1 }));
      unwrap(await updateMyPreferences(deps, ctxOf(IDS.outsider), { preferences: [{ category: "SYSTEM", inApp: false }] }));
      unwrap(await updateSystemTemplate(deps, ctxOf(IDS.admin), { code: "attendance.absence", enabled: true }));
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { notificationRetentionDays: 91 }));
      // Accès SQL direct sous le rôle applicatif : zéro ligne chez B, au moins une chez A, pour CHAQUE table.
      const countUnder = async (tenant: string, table: string): Promise<number> => {
        const client = await db.appPool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
          const res = await client.query(`SELECT count(*)::int AS n FROM messaging.${table}`);
          await client.query("ROLLBACK");
          return res.rows[0].n as number;
        } finally {
          client.release();
        }
      };
      for (const table of ALL_TABLES) {
        expect(await countUnder(tenantB, table), `${table} chez B`).toBe(0);
        expect(await countUnder(tenantA, table), `${table} chez A`).toBeGreaterThan(0);
      }
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { notificationRetentionDays: 90 }));
      unwrap(await updateSystemTemplate(deps, ctxOf(IDS.admin), { code: "attendance.absence", enabled: true }));
    });

    it("le tenant B a ses propres paramètres : modifier ceux de A ne change pas B", async () => {
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { studentPolicy: "TEACHERS" }));
      expect(unwrap(await getMessagingSettings(deps, ctxOf(IDS.admin, tenantB))).studentPolicy).toBe("TEACHERS_AND_ADMIN");
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { studentPolicy: "TEACHERS_AND_ADMIN" }));
    });
  });

  // =========================================================================================================
  describe("matrice d'autorisation (liens réels)", () => {
    it("parent -> enseignant de la classe de son enfant : accepté ; le message arrive", async () => {
      const r = unwrap(await direct(IDS.parent1, IDS.teacher6A, { subject: "Devoirs", aboutStudentId: IDS.S1 }));
      expect(r.reused).toBe(false);
      expect(r.conversation?.participants.map((p) => p.userId)).toEqual([IDS.teacher6A]);
      const seen = await inbox(IDS.teacher6A);
      expect(seen.find((c) => c.id === r.conversation!.id)?.unreadCount).toBe(1);
    });

    it("parent -> enseignant d'une AUTRE classe, autre parent, élève, personnel sans lien : refusés (sans révéler l'existence)", async () => {
      for (const to of [IDS.teacher6B, IDS.parent2, IDS.student1, IDS.staff1]) {
        const err = expectErr(await direct(IDS.parent1, to), MessagingCode.RECIPIENT_NOT_ALLOWED);
        expect(err.httpStatus).toBe(403);
      }
      // Un compte inconnu ou inactif : EXACTEMENT le même refus qu'un destinataire interdit.
      const unknown = expectErr(await direct(IDS.parent1, "0192f0a4-7b1e-7c3a-8d2e-00000000ffff"), MessagingCode.RECIPIENT_NOT_ALLOWED);
      expect(unknown.message).toBe(expectErr(await direct(IDS.parent1, IDS.teacher6B), MessagingCode.RECIPIENT_NOT_ALLOWED).message);
      expectErr(await direct(IDS.parent1, IDS.inactive), MessagingCode.RECIPIENT_NOT_ALLOWED);
    });

    it("parent : l'élève de contexte doit être l'un de SES enfants", async () => {
      expectErr(await direct(IDS.parent1, IDS.teacher6A, { subject: "Autre élève", aboutStudentId: IDS.S3 }), MessagingCode.RECIPIENT_NOT_ALLOWED);
    });

    it("parent sans enfant lié (compte orphelin) : aucune initiative", async () => {
      expectErr(await direct(IDS.outsider, IDS.teacher6A), MessagingCode.FORBIDDEN);
    });

    it("parent -> l'administration (contacts paramétrés) : un seul fil partagé avec les contacts", async () => {
      const { ctx, caps } = as(IDS.parent1);
      const r = unwrap(await createConversation(deps, ctx, { kind: "GROUP", subject: "Frais", body: "Question sur les frais", priority: "NORMAL", recipients: { userIds: [], classrooms: [], toAdministration: true }, attachmentIds: [], caps }));
      expect(r.recipientCount).toBe(2); // directeur + secrétariat
      expect((await inbox(IDS.admin)).some((c) => c.id === r.conversation!.id)).toBe(true);
      expect((await inbox(IDS.secretary)).some((c) => c.id === r.conversation!.id)).toBe(true);
    });

    it("enseignant -> classe : TOUS les tuteurs reçoivent (legacy : un seul), seulement ceux de SA classe", async () => {
      const r = unwrap(await toClass(IDS.teacher6A, IDS.C6A, ["GUARDIANS"], "GROUP", "Réunion 6A"));
      const recipients = new Set(r.conversation!.participants.map((p) => p.userId));
      expect(recipients.has(IDS.parent1)).toBe(true);
      expect(recipients.has(IDS.parent2)).toBe(true); // mère de S1 ET S3
      expect(recipients.has(IDS.parent3)).toBe(false); // parent d'un élève de 6B
      expect(recipients.has(IDS.student1)).toBe(false);
    });

    it("enseignant -> classe qui n'est pas la sienne : refusé", async () => {
      expectErr(await toClass(IDS.teacher6A, IDS.C6B, ["STUDENTS"], "GROUP", "Hors périmètre"), MessagingCode.RECIPIENT_NOT_ALLOWED);
      expectErr(await direct(IDS.teacher6A, IDS.student3), MessagingCode.RECIPIENT_NOT_ALLOWED);
      expectErr(await direct(IDS.teacher6A, IDS.parent3), MessagingCode.RECIPIENT_NOT_ALLOWED);
    });

    it("enseignant : pas d'audience par cibles (réservée à l'administration)", async () => {
      const { ctx, caps } = as(IDS.teacher6A);
      expectErr(
        await createConversation(deps, ctx, { kind: "BROADCAST", subject: "Tous", body: "x", priority: "NORMAL", recipients: { userIds: [], classrooms: [], audience: { targets: [{ kind: "TENANT" }], audiences: ["GUARDIANS"] }, toAdministration: false }, attachmentIds: [], caps }),
        MessagingCode.TARGET_NOT_ALLOWED,
      );
    });

    it("élève : selon la politique du tenant", async () => {
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { studentPolicy: "DISABLED" }));
      expectErr(await direct(IDS.student1, IDS.teacher6A), MessagingCode.STUDENT_MESSAGING_DISABLED);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { studentPolicy: "REPLY_ONLY" }));
      expectErr(await direct(IDS.student1, IDS.teacher6A), MessagingCode.STUDENT_MESSAGING_DISABLED);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { studentPolicy: "TEACHERS" }));
      unwrap(await direct(IDS.student1, IDS.teacher6A, { subject: "Question" }));
      expectErr(await direct(IDS.student1, IDS.teacher6B), MessagingCode.RECIPIENT_NOT_ALLOWED);
      expectErr(await direct(IDS.student1, IDS.admin), MessagingCode.RECIPIENT_NOT_ALLOWED);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { studentPolicy: "TEACHERS_AND_ADMIN" }));
      unwrap(await direct(IDS.student1, IDS.admin, { subject: "Certificat" }));
      expectErr(await direct(IDS.student1, IDS.student3), MessagingCode.RECIPIENT_NOT_ALLOWED);
      expectErr(await direct(IDS.student1, IDS.parent1), MessagingCode.RECIPIENT_NOT_ALLOWED);
    });

    it("élève avec REPLY_ONLY : répond à l'enseignant qui lui a écrit, n'initie pas", async () => {
      const opened = unwrap(await direct(IDS.teacher6A, IDS.student1, { subject: "Devoir à rendre" }));
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { studentPolicy: "REPLY_ONLY" }));
      unwrap(await reply(IDS.student1, opened.conversation!.id, "Bien reçu"));
      expectErr(await direct(IDS.student1, IDS.teacher6A, { subject: "Nouvelle question" }), MessagingCode.STUDENT_MESSAGING_DISABLED);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { studentPolicy: "DISABLED" }));
      expectErr(await reply(IDS.student1, opened.conversation!.id, "Encore"), MessagingCode.STUDENT_MESSAGING_DISABLED);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { studentPolicy: "TEACHERS_AND_ADMIN" }));
    });

    it("administration -> tout utilisateur, y compris sans lien ; le compte inconnu est signalé", async () => {
      unwrap(await direct(IDS.admin, IDS.outsider, { subject: "Bienvenue" }));
      expectErr(await direct(IDS.admin, "0192f0a4-7b1e-7c3a-8d2e-00000000ffff"), MessagingCode.RECIPIENT_NOT_FOUND);
    });

    it("un utilisateur sans aucun droit d'envoi est refusé", async () => {
      const { ctx } = as(IDS.parent1);
      expectErr(await createConversation(deps, ctx, { kind: "DIRECT", body: "x", priority: "NORMAL", recipients: { userIds: [IDS.teacher6A], classrooms: [], toAdministration: false }, attachmentIds: [], caps: {} }), MessagingCode.FORBIDDEN);
    });

    it("un contexte système ne peut pas envoyer", async () => {
      expectErr(
        await createConversation(deps, createSystemContext(tenantA), { kind: "DIRECT", body: "x", priority: "NORMAL", recipients: { userIds: [IDS.teacher6A], classrooms: [], toAdministration: false }, attachmentIds: [], caps: capsOf(IDS.admin) }),
        MessagingCode.FORBIDDEN,
      );
    });

    it("sélecteur de destinataires : uniquement des personnes autorisées", async () => {
      const parent = unwrap(await listAllowedRecipients(deps, ctxOf(IDS.parent1), { limit: 50, caps: capsOf(IDS.parent1) }));
      const ids = parent.items.map((i) => i.userId);
      expect(ids).toEqual(expect.arrayContaining([IDS.teacher6A, IDS.teacherBoth, IDS.admin, IDS.secretary]));
      expect(ids).not.toContain(IDS.teacher6B);
      expect(ids).not.toContain(IDS.parent2);
      const byName = unwrap(await listAllowedRecipients(deps, ctxOf(IDS.parent1), { q: "Enseignant", limit: 50, caps: capsOf(IDS.parent1) }));
      expect(byName.items.map((i) => i.userId).sort()).toEqual([IDS.teacher6A, IDS.teacherBoth].sort());
      const teacher = unwrap(await listAllowedRecipients(deps, ctxOf(IDS.teacher6A), { classroomId: IDS.C6A, kind: "GUARDIAN", limit: 50, caps: capsOf(IDS.teacher6A) }));
      expect(teacher.items.every((i) => i.kind === "GUARDIAN")).toBe(true);
      expect(teacher.items.map((i) => i.userId)).toEqual(expect.arrayContaining([IDS.parent1, IDS.parent2]));
      expect(unwrap(await listAllowedRecipients(deps, ctxOf(IDS.teacher6A), { classroomId: IDS.C6B, limit: 50, caps: capsOf(IDS.teacher6A) })).items).toEqual([]);
      expect(unwrap(await listAllowedRecipients(deps, ctxOf(IDS.outsider), { limit: 50, caps: capsOf(IDS.outsider) })).items).toEqual([]);
    });

    it("profil d'audience : classes du personnel, politique élève, droits", async () => {
      const t = unwrap(await getMyAudience(deps, ctxOf(IDS.teacherBoth), { caps: capsOf(IDS.teacherBoth) }));
      expect(t).toMatchObject({ canSend: true, canSendAny: false, isStaff: true, isGuardian: false });
      expect(t.classrooms.map((c) => c.name).sort()).toEqual(["6ème A", "6ème B"]);
      const a = unwrap(await getMyAudience(deps, ctxOf(IDS.admin), { caps: capsOf(IDS.admin) }));
      expect(a).toMatchObject({ canSendAny: true, canManageAnnouncements: true, canModerate: true });
      const p = unwrap(await getMyAudience(deps, ctxOf(IDS.parent1), { caps: capsOf(IDS.parent1) }));
      expect(p).toMatchObject({ isGuardian: true, canSend: true, canPublishAnnouncements: false });
    });
  });

  // =========================================================================================================
  describe("fils, lecture et état par utilisateur", () => {
    it("un second message vers la même personne, même objet, rejoint le fil ; un autre objet crée un fil", async () => {
      const first = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Notes du trimestre" }));
      const second = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "notes du trimestre", body: "Complément" }));
      expect(second.reused).toBe(true);
      expect(second.conversation!.id).toBe(first.conversation!.id);
      expect(second.message!.seq).toBe(2);
      const third = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Sortie scolaire" }));
      expect(third.conversation!.id).not.toBe(first.conversation!.id);
    });

    it("idempotence : rejouer un envoi avec le même clientId ne crée aucun doublon", async () => {
      const clientId = "0192f0a4-7b1e-7c3a-8d2e-00000000c001";
      const a = unwrap(await direct(IDS.teacher6A, IDS.parent2, { subject: "Idempotence", clientId }));
      const b = unwrap(await direct(IDS.teacher6A, IDS.parent2, { subject: "Idempotence", clientId }));
      expect(b.conversation!.id).toBe(a.conversation!.id);
      expect(b.message!.id).toBe(a.message!.id);
      const rows = await q("SELECT count(*)::int AS n FROM messaging.messages WHERE conversation_id = $1", [a.conversation!.id]);
      expect(rows[0]!.n).toBe(1);
      const c2 = "0192f0a4-7b1e-7c3a-8d2e-00000000c002";
      const p1 = unwrap(await reply(IDS.parent2, a.conversation!.id, "Merci"));
      void p1;
      const { ctx, caps } = as(IDS.parent2);
      const r1 = unwrap(await postMessage(deps, ctx, { conversationId: a.conversation!.id, body: "Dedupe", attachmentIds: [], clientId: c2, caps }));
      const r2 = unwrap(await postMessage(deps, ctx, { conversationId: a.conversation!.id, body: "Dedupe", attachmentIds: [], clientId: c2, caps }));
      expect(r2.message.id).toBe(r1.message.id);
    });

    it("non-lus : compteur par fil, pastille globale, lecture, sourdine et archivage", async () => {
      const c = unwrap(await direct(IDS.teacher6B, IDS.parent3, { subject: "Compteurs" })).conversation!;
      expect((await inbox(IDS.parent3)).find((x) => x.id === c.id)?.unreadCount).toBe(1);
      const before = (await unreadOf(IDS.parent3)).conversations;
      expect(before).toBeGreaterThanOrEqual(1);
      unwrap(await reply(IDS.teacher6B, c.id, "Deuxième"));
      expect((await inbox(IDS.parent3)).find((x) => x.id === c.id)?.unreadCount).toBe(2);
      const read = unwrap(await markConversationRead(deps, ctxOf(IDS.parent3), { conversationId: c.id }));
      expect(read.unreadCount).toBe(0);
      expect((await unreadOf(IDS.parent3)).conversations).toBe(before - 1);
      // Mettre en sourdine : la pastille ignore le fil.
      unwrap(await reply(IDS.teacher6B, c.id, "Troisième"));
      expect((await unreadOf(IDS.parent3)).conversations).toBe(before);
      unwrap(await setParticipantState(deps, ctxOf(IDS.parent3), { conversationId: c.id, muted: true }));
      expect((await unreadOf(IDS.parent3)).conversations).toBe(before - 1);
      unwrap(await setParticipantState(deps, ctxOf(IDS.parent3), { conversationId: c.id, muted: false }));
      // Archiver : sort de la boîte ; un nouveau message le fait revenir.
      unwrap(await setParticipantState(deps, ctxOf(IDS.parent3), { conversationId: c.id, archived: true }));
      expect((await inbox(IDS.parent3)).some((x) => x.id === c.id)).toBe(false);
      expect((await inbox(IDS.parent3, "archived")).some((x) => x.id === c.id)).toBe(true);
      unwrap(await reply(IDS.teacher6B, c.id, "Quatrième"));
      expect((await inbox(IDS.parent3)).some((x) => x.id === c.id)).toBe(true);
      // Favori.
      unwrap(await setParticipantState(deps, ctxOf(IDS.parent3), { conversationId: c.id, starred: true }));
      expect((await inbox(IDS.parent3, "starred")).map((x) => x.id)).toContain(c.id);
    });

    it("marquer lu au-delà du dernier message ne dépasse pas ; en arrière ne recule pas", async () => {
      const c = unwrap(await direct(IDS.teacher6A, IDS.student1, { subject: "Lecture partielle" })).conversation!;
      unwrap(await reply(IDS.teacher6A, c.id, "2"));
      unwrap(await reply(IDS.teacher6A, c.id, "3"));
      const part = unwrap(await markConversationRead(deps, ctxOf(IDS.student1), { conversationId: c.id, upToSeq: 2 }));
      expect(part).toEqual({ lastReadSeq: 2, unreadCount: 1 });
      expect(unwrap(await markConversationRead(deps, ctxOf(IDS.student1), { conversationId: c.id, upToSeq: 1 })).lastReadSeq).toBe(2);
      expect(unwrap(await markConversationRead(deps, ctxOf(IDS.student1), { conversationId: c.id, upToSeq: 999 })).lastReadSeq).toBe(3);
    });

    it("un non-participant reçoit 404 partout (jamais la confirmation que le fil existe)", async () => {
      const c = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Confidentiel" })).conversation!;
      const stranger = ctxOf(IDS.parent3);
      expectErr(await getConversationDetail(deps, stranger, { conversationId: c.id, caps: capsOf(IDS.parent3) }), MessagingCode.CONVERSATION_NOT_FOUND);
      expectErr(await listConversationMessages(deps, stranger, { conversationId: c.id, limit: 20 }), MessagingCode.CONVERSATION_NOT_FOUND);
      expectErr(await reply(IDS.parent3, c.id), MessagingCode.CONVERSATION_NOT_FOUND);
      expectErr(await markConversationRead(deps, stranger, { conversationId: c.id }), MessagingCode.CONVERSATION_NOT_FOUND);
      expectErr(await setParticipantState(deps, stranger, { conversationId: c.id, archived: true }), MessagingCode.CONVERSATION_NOT_FOUND);
    });

    it("pagination des messages par seq et par curseur de boîte", async () => {
      const c = unwrap(await direct(IDS.admin, IDS.parent3, { subject: "Pagination" })).conversation!;
      for (let i = 2; i <= 7; i += 1) unwrap(await reply(IDS.admin, c.id, `msg ${i}`));
      const page1 = unwrap(await listConversationMessages(deps, ctxOf(IDS.parent3), { conversationId: c.id, limit: 3 }));
      expect(page1.items.map((m) => m.seq)).toEqual([5, 6, 7]);
      expect(page1.nextBefore).toBe(5);
      const page2 = unwrap(await listConversationMessages(deps, ctxOf(IDS.parent3), { conversationId: c.id, before: 5, limit: 3 }));
      expect(page2.items.map((m) => m.seq)).toEqual([2, 3, 4]);
      const page3 = unwrap(await listConversationMessages(deps, ctxOf(IDS.parent3), { conversationId: c.id, before: 2, limit: 3 }));
      expect(page3).toMatchObject({ nextBefore: null });
      const first = unwrap(await listConversations(deps, ctxOf(IDS.parent3), { folder: "inbox", limit: 1 }));
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const next = unwrap(await listConversations(deps, ctxOf(IDS.parent3), { folder: "inbox", limit: 1, cursor: first.nextCursor! }));
      expect(next.items[0]!.id).not.toBe(first.items[0]!.id);
    });

    it("quitter un groupe : on n'y accède plus ; un fil direct ne se quitte pas", async () => {
      const g = unwrap(await group(IDS.admin, [IDS.teacher6A, IDS.teacher6B], "Équipe")).conversation!;
      unwrap(await leaveConversation(deps, ctxOf(IDS.teacher6B), { conversationId: g.id }));
      expectErr(await reply(IDS.teacher6B, g.id), MessagingCode.CONVERSATION_NOT_FOUND);
      expect((await inbox(IDS.teacher6B)).some((c) => c.id === g.id)).toBe(false);
      unwrap(await reply(IDS.teacher6A, g.id, "Toujours là"));
      const d = unwrap(await direct(IDS.admin, IDS.outsider, { subject: "Direct" })).conversation!;
      expectErr(await leaveConversation(deps, ctxOf(IDS.admin), { conversationId: d.id }), MessagingCode.INVALID_INPUT);
    });

    it("réponses désactivées : seuls les propriétaires écrivent", async () => {
      const g = unwrap(await group(IDS.admin, [IDS.parent1, IDS.parent2], "Information", { allowReplies: false })).conversation!;
      expectErr(await reply(IDS.parent1, g.id), MessagingCode.REPLIES_DISABLED);
      const detail = unwrap(await getConversationDetail(deps, ctxOf(IDS.parent1), { conversationId: g.id, caps: capsOf(IDS.parent1) }));
      expect(detail.canReply).toBe(false);
      expect(detail.replyBlockedReason).toMatch(/désactivées/);
      unwrap(await reply(IDS.admin, g.id, "Complément"));
    });

    it("un parent répond à un enseignant qui n'enseigne plus à son enfant (aucun lien exigé pour répondre)", async () => {
      const c = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Fil existant" })).conversation!;
      world.users.set(IDS.teacher6A, { ...world.users.get(IDS.teacher6A)!, teachingClassroomIds: [] });
      try {
        unwrap(await reply(IDS.parent1, c.id, "Merci pour ces informations"));
        expectErr(await direct(IDS.parent1, IDS.teacher6A, { subject: "Nouveau sujet" }), MessagingCode.RECIPIENT_NOT_ALLOWED);
      } finally {
        world.users.set(IDS.teacher6A, { ...world.users.get(IDS.teacher6A)!, teachingClassroomIds: [IDS.C6A] });
      }
    });

    it("retrait par l'auteur : le contenu disparaît pour les participants, l'aperçu est recalculé", async () => {
      const c = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Retrait", body: "Premier" })).conversation!;
      const second = unwrap(await reply(IDS.teacher6A, c.id, "Message à retirer")).message;
      unwrap(await removeOwnMessage(deps, ctxOf(IDS.teacher6A), { messageId: second.id }));
      const msgs = unwrap(await listConversationMessages(deps, ctxOf(IDS.parent1), { conversationId: c.id, limit: 10 })).items;
      expect(msgs.find((m) => m.id === second.id)).toMatchObject({ removed: true, body: null, removalKind: "SENDER" });
      expect((await inbox(IDS.parent1)).find((x) => x.id === c.id)?.lastPreview).toBe("Premier");
      expectErr(await removeOwnMessage(deps, ctxOf(IDS.parent1), { messageId: msgs[0]!.id }), MessagingCode.MESSAGE_NOT_FOUND);
    });

    it("recherche : dans MES fils seulement, insensible aux accents et à la casse", async () => {
      unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Recherche", body: "La réunion de rentrée est confirmée" }));
      const hits = unwrap(await searchMyMessages(deps, ctxOf(IDS.parent1), { q: "REUNION RENTREE".split(" ")[0]!, limit: 10 })).items;
      expect(hits.some((h) => h.snippet.includes("réunion"))).toBe(true);
      expect(unwrap(await searchMyMessages(deps, ctxOf(IDS.parent3), { q: "réunion", limit: 10 })).items).toEqual([]);
      expect(unwrap(await searchMyMessages(deps, ctxOf(IDS.parent1), { q: "réunion", limit: 10 })).items.length).toBeGreaterThan(0);
    });

    it("un message trop long est refusé selon les paramètres d'établissement", async () => {
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { messageMaxLength: 100 }));
      expectErr(await direct(IDS.teacher6A, IDS.parent1, { subject: "Long", body: "x".repeat(101) }), MessagingCode.MESSAGE_TOO_LONG);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { messageMaxLength: 5000 }));
    });
  });

  // =========================================================================================================
  describe("diffusion (un fil privé par destinataire)", () => {
    it("chaque destinataire ne voit que SON fil ; l'expéditeur n'est pas inondé ; la réponse fait ressortir le fil", async () => {
      const r = unwrap(await toClass(IDS.teacher6A, IDS.C6A, ["GUARDIANS"], "BROADCAST", "Convocation 6A"));
      expect(r.conversation).toBeNull();
      expect(r.recipientCount).toBe(2);
      expect(r.broadcastId).not.toBeNull();
      const p1 = (await inbox(IDS.parent1)).find((c) => c.subject === "Convocation 6A")!;
      const p2 = (await inbox(IDS.parent2)).find((c) => c.subject === "Convocation 6A")!;
      expect(p1.id).not.toBe(p2.id);
      expect(p1.participants.map((p) => p.userId)).toEqual([IDS.teacher6A]); // ne voit pas parent2
      expect(p1.participantCount).toBe(2);
      // L'expéditeur : fils archivés, pas dans sa boîte ; une ligne dans « envoyés ».
      expect((await inbox(IDS.teacher6A)).some((c) => c.subject === "Convocation 6A")).toBe(false);
      const sent = (await inbox(IDS.teacher6A, "sent")).filter((c) => c.subject === "Convocation 6A");
      expect(sent).toHaveLength(1);
      expect(sent[0]!.broadcastCount).toBe(2);
      // Un parent répond : le fil ressort dans la boîte de l'enseignant ; l'autre parent ne voit rien.
      unwrap(await reply(IDS.parent1, p1.id, "Je serai présent"));
      expect((await inbox(IDS.teacher6A)).filter((c) => c.subject === "Convocation 6A")).toHaveLength(1);
      const msgs2 = unwrap(await listConversationMessages(deps, ctxOf(IDS.parent2), { conversationId: p2.id, limit: 10 })).items;
      expect(msgs2.map((m) => m.body)).toEqual(["Message à Convocation 6A"]);
      expectErr(await getConversationDetail(deps, ctxOf(IDS.parent2), { conversationId: p1.id, caps: capsOf(IDS.parent2) }), MessagingCode.CONVERSATION_NOT_FOUND);
    });

    it("rejouer la diffusion avec le même clientId ne crée aucun doublon", async () => {
      const { ctx, caps } = as(IDS.teacher6A);
      const input: CreateConversationInput = { kind: "BROADCAST", subject: "Diffusion idempotente", body: "x", priority: "HIGH", recipients: { userIds: [], classrooms: [{ classroomId: IDS.C6A, include: ["STUDENTS"] }], toAdministration: false }, attachmentIds: [], clientId: "0192f0a4-7b1e-7c3a-8d2e-00000000c010", caps };
      const a = unwrap(await createConversation(deps, ctx, input));
      const b = unwrap(await createConversation(deps, ctx, input));
      expect(b.reused).toBe(true);
      expect(b.broadcastId).toBe(a.broadcastId);
      const rows = await q("SELECT count(*)::int AS n FROM messaging.messages WHERE broadcast_id = $1", [a.broadcastId]);
      expect(rows[0]!.n).toBe(a.recipientCount);
    });

    it("un destinataire déjà en fil avec le même objet reçoit le message dans son fil existant", async () => {
      unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Fil préexistant" }));
      const r = unwrap(await toClass(IDS.teacher6A, IDS.C6A, ["GUARDIANS"], "BROADCAST", "Fil préexistant"));
      expect(r.recipientCount).toBe(2);
      const mine = (await inbox(IDS.parent1)).filter((c) => c.subject === "Fil préexistant");
      expect(mine).toHaveLength(1);
      const msgs = unwrap(await listConversationMessages(deps, ctxOf(IDS.parent1), { conversationId: mine[0]!.id, limit: 10 })).items;
      expect(msgs).toHaveLength(2);
    });

    it("administration -> audience par cibles (niveau) ; parent et élève ne diffusent pas", async () => {
      const { ctx, caps } = as(IDS.admin);
      const r = unwrap(
        await createConversation(deps, ctx, {
          kind: "BROADCAST", subject: "Niveau 6", body: "Information niveau", priority: "NORMAL",
          recipients: { userIds: [], classrooms: [], audience: { targets: [{ kind: "LEVEL", ref: IDS.LEVEL_6 }], audiences: ["GUARDIANS"] }, toAdministration: false }, attachmentIds: [], caps,
        }),
      );
      expect(r.recipientCount).toBe(3); // parent1, parent2, parent3 ; parent2 une seule fois malgré deux enfants
      const { ctx: pctx, caps: pcaps } = as(IDS.parent1);
      expectErr(
        await createConversation(deps, pctx, { kind: "BROADCAST", subject: "Moi", body: "x", priority: "NORMAL", recipients: { userIds: [IDS.teacher6A], classrooms: [], toAdministration: false }, attachmentIds: [], caps: pcaps }),
        MessagingCode.RECIPIENT_NOT_ALLOWED,
      );
    });

    it("plafonds : groupe et diffusion limités par les paramètres", async () => {
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { maxGroupParticipants: 2, maxBroadcastParticipants: 3 }));
      try {
        expectErr(await group(IDS.teacher6A, [IDS.parent1, IDS.parent2], "Trop gros"), MessagingCode.TOO_MANY_RECIPIENTS);
        const { ctx, caps } = as(IDS.admin);
        expectErr(
          await createConversation(deps, ctx, { kind: "BROADCAST", subject: "Trop", body: "x", priority: "NORMAL", recipients: { userIds: [], classrooms: [{ classroomId: IDS.C6A, include: ["STUDENTS", "GUARDIANS", "TEACHERS"] }, { classroomId: IDS.C6B, include: ["STUDENTS", "GUARDIANS", "TEACHERS"] }], toAdministration: false }, attachmentIds: [], caps }),
          MessagingCode.TOO_MANY_RECIPIENTS,
        );
      } finally {
        unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { maxGroupParticipants: 200, maxBroadcastParticipants: 5000 }));
      }
    });
  });

  // =========================================================================================================
  describe("pièces jointes (StoragePort)", () => {
    it("dépôt d'un PDF : type détecté, stocké sous le préfixe du tenant, empreinte conservée", async () => {
      const a = unwrap(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "..\\convocation.pdf", content: PDF }));
      expect(a).toMatchObject({ fileName: "convocation.pdf", mimeType: "application/pdf", sizeBytes: PDF.byteLength });
      const rows = await q<{ storage_key: string; sha256: string }>("SELECT storage_key, sha256 FROM messaging.attachments WHERE id = $1", [a.id]);
      expect(rows[0]!.storage_key.startsWith(`messaging/${tenantA}/`)).toBe(true);
      expect(storage.objects.get(rows[0]!.storage_key)?.contentType).toBe("application/pdf");
      expect(rows[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("un exécutable déguisé en .pdf est refusé ; un fichier vide aussi", async () => {
      expectErr(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "facture.pdf", content: EXE }), MessagingCode.ATTACHMENT_TYPE_REJECTED);
      expectErr(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "vide.pdf", content: new Uint8Array() }), MessagingCode.INVALID_INPUT);
    });

    it("la taille et les types suivent les paramètres d'établissement", async () => {
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { attachmentMaxBytes: 16 }));
      expectErr(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "gros.pdf", content: PDF }), MessagingCode.ATTACHMENT_TOO_LARGE);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { attachmentMaxBytes: 1024 * 1024, allowedAttachmentTypes: ["image/png"] }));
      expectErr(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "doc.pdf", content: PDF }), MessagingCode.ATTACHMENT_TYPE_REJECTED);
      unwrap(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "image.png", content: PNG }));
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { attachmentsEnabled: false }));
      expectErr(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "image.png", content: PNG }), MessagingCode.ATTACHMENTS_DISABLED);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { attachmentsEnabled: true, allowedAttachmentTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"], attachmentMaxBytes: 5 * 1024 * 1024 }));
    });

    it("pièce liée à un message : lisible par les participants seulement ; liée une seule fois", async () => {
      const a = unwrap(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "bulletin.pdf", content: PDF }));
      const sent = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Avec pièce", attachmentIds: [a.id] }));
      expect(sent.message!.attachments).toEqual([a]);
      const url = unwrap(await getAttachmentUrl(deps, ctxOf(IDS.parent1), { attachmentId: a.id }));
      expect(url.url).toMatch(/^https:\/\/storage\.test\/messaging\//);
      expectErr(await getAttachmentUrl(deps, ctxOf(IDS.parent3), { attachmentId: a.id }), MessagingCode.ATTACHMENT_NOT_FOUND);
      expectErr(await getAttachmentUrl(deps, ctxOf(IDS.parent3, tenantB), { attachmentId: a.id }), MessagingCode.ATTACHMENT_NOT_FOUND);
      // Réutiliser la même pièce pour un autre message est refusé.
      expectErr(await direct(IDS.teacher6A, IDS.parent2, { subject: "Réutilisation", attachmentIds: [a.id] }), MessagingCode.ATTACHMENT_NOT_FOUND);
    });

    it("la pièce d'un autre utilisateur ne peut pas être attachée à mon message", async () => {
      const mine = unwrap(await uploadAttachment(deps, ctxOf(IDS.teacher6B), { fileName: "autre.pdf", content: PDF }));
      expectErr(await direct(IDS.teacher6A, IDS.parent1, { subject: "Vol de pièce", attachmentIds: [mine.id] }), MessagingCode.ATTACHMENT_NOT_FOUND);
    });

    it("trop de pièces : refusé selon les paramètres", async () => {
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { attachmentMaxPerItem: 1 }));
      const a = unwrap(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "a.pdf", content: PDF }));
      const b = unwrap(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "b.pdf", content: PDF }));
      expectErr(await direct(IDS.teacher6A, IDS.parent1, { subject: "Deux pièces", attachmentIds: [a.id, b.id] }), MessagingCode.TOO_MANY_ATTACHMENTS);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { attachmentMaxPerItem: 5 }));
    });

    it("diffusion avec pièce : chaque destinataire peut ouvrir la sienne ; pas les autres", async () => {
      const a = unwrap(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "circulaire.pdf", content: PDF }));
      const { ctx, caps } = as(IDS.teacher6A);
      unwrap(await createConversation(deps, ctx, { kind: "BROADCAST", subject: "Circulaire", body: "Voir la pièce", priority: "NORMAL", recipients: { userIds: [], classrooms: [{ classroomId: IDS.C6A, include: ["GUARDIANS"] }], toAdministration: false }, attachmentIds: [a.id], caps }));
      for (const user of [IDS.parent1, IDS.parent2]) {
        const conv = (await inbox(user)).find((c) => c.subject === "Circulaire")!;
        const msgs = unwrap(await listConversationMessages(deps, ctxOf(user), { conversationId: conv.id, limit: 5 })).items;
        expect(msgs[0]!.attachments).toHaveLength(1);
        expect(unwrap(await getAttachmentUrl(deps, ctxOf(user), { attachmentId: msgs[0]!.attachments[0]!.id })).url).toContain("storage.test");
      }
    });

    it("pièces jamais liées : purgées après 24 h, objets supprimés ; les pièces liées restent", async () => {
      const orphan = unwrap(await uploadAttachment(deps, ctxOf(IDS.teacher6A), { fileName: "oubliee.pdf", content: PDF }));
      const key = (await q<{ storage_key: string }>("SELECT storage_key FROM messaging.attachments WHERE id = $1", [orphan.id]))[0]!.storage_key;
      expect(await purgeOrphanAttachments(deps, createSystemContext(tenantA))).toBe(0);
      clock.advance(25 * 3_600_000);
      try {
        expect(await purgeOrphanAttachments(deps, createSystemContext(tenantA))).toBeGreaterThanOrEqual(1);
        expect(storage.objects.has(key)).toBe(false);
        expect(await q("SELECT 1 FROM messaging.attachments WHERE id = $1", [orphan.id])).toEqual([]);
        expect((await q("SELECT count(*)::int AS n FROM messaging.attachments WHERE message_id IS NOT NULL"))[0]!.n).toBeGreaterThan(0);
      } finally {
        clock.advance(0);
      }
    });
  });

  // =========================================================================================================
  describe("annonces ciblées", () => {
    const publish = async (author: string, input: Partial<Parameters<typeof createAnnouncement>[2]> & { title: string }) => {
      const { ctx, caps } = as(author);
      return createAnnouncement(deps, ctx, {
        body: "Contenu de l'annonce", priority: "NORMAL", audience: { targets: [{ kind: "TENANT" }], audiences: ["STUDENTS", "GUARDIANS", "STAFF"] }, requireAck: false, pinned: false, attachmentIds: [], publish: true, caps, ...input,
      });
    };
    const inboxOf = async (userId: string, includeExpired = false) => unwrap(await listAnnouncements(deps, ctxOf(userId), { scope: "inbox", limit: 100, includeExpired, caps: capsOf(userId) })).items;

    it("ciblage par classe : seuls les tuteurs de la classe la reçoivent", async () => {
      const a = unwrap(await publish(IDS.admin, { title: "Réunion 6A", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] } }));
      expect(a).toMatchObject({ status: "PUBLISHED", stats: { recipients: 2, read: 0, acknowledged: 0 } });
      expect((await inboxOf(IDS.parent1)).some((x) => x.id === a.id)).toBe(true);
      expect((await inboxOf(IDS.parent2)).some((x) => x.id === a.id)).toBe(true);
      for (const user of [IDS.parent3, IDS.student1, IDS.teacher6A, IDS.outsider]) expect((await inboxOf(user)).some((x) => x.id === a.id), user).toBe(false);
      expectErr(await getAnnouncementDetail(deps, ctxOf(IDS.parent3), { announcementId: a.id, caps: capsOf(IDS.parent3) }), MessagingCode.ANNOUNCEMENT_NOT_FOUND);
    });

    it("ciblage par niveau, par campus, par établissement, par rôle", async () => {
      const level = unwrap(await publish(IDS.admin, { title: "Niveau 6", audience: { targets: [{ kind: "LEVEL", ref: IDS.LEVEL_6 }], audiences: ["STUDENTS"] } }));
      expect(level.stats!.recipients).toBe(2); // S1 et S3 ont un compte élève
      const campus = unwrap(await publish(IDS.admin, { title: "Campus", audience: { targets: [{ kind: "CAMPUS", ref: IDS.CAMPUS_1 }], audiences: ["GUARDIANS"] } }));
      expect(campus.stats!.recipients).toBe(3);
      const inst = unwrap(await publish(IDS.admin, { title: "Établissement scolaire", audience: { targets: [{ kind: "INSTITUTION", ref: IDS.INSTITUTION_1 }], audiences: ["STAFF"] } }));
      expect(inst.stats!.recipients).toBeGreaterThanOrEqual(3);
      const role = unwrap(await publish(IDS.admin, { title: "Secrétariat", audience: { targets: [{ kind: "ROLE", ref: "secretariat" }], audiences: ["STAFF"] } }));
      expect(role.stats!.recipients).toBe(1);
      expect((await inboxOf(IDS.secretary)).some((x) => x.id === role.id)).toBe(true);
      expect((await inboxOf(IDS.teacher6A)).some((x) => x.id === role.id)).toBe(false);
    });

    it("cible inconnue et audience vide : refusées", async () => {
      expectErr(await publish(IDS.admin, { title: "Classe fantôme", audience: { targets: [{ kind: "CLASSROOM", ref: "0192f0a4-7b1e-7c3a-8d2e-00000000ffff" }], audiences: ["GUARDIANS"] } }), MessagingCode.TARGET_NOT_FOUND);
      expectErr(await publish(IDS.admin, { title: "Classe vide", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C5A }], audiences: ["GUARDIANS"] } }), MessagingCode.AUDIENCE_EMPTY);
    });

    it("droits : l'enseignant publie vers SES classes (élèves, tuteurs) seulement", async () => {
      unwrap(await publish(IDS.teacher6A, { title: "Devoir 6A", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["STUDENTS", "GUARDIANS"] } }));
      expectErr(await publish(IDS.teacher6A, { title: "Hors classe", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6B }], audiences: ["GUARDIANS"] } }), MessagingCode.TARGET_NOT_ALLOWED);
      expectErr(await publish(IDS.teacher6A, { title: "Tout le monde", audience: { targets: [{ kind: "TENANT" }], audiences: ["GUARDIANS"] } }), MessagingCode.TARGET_NOT_ALLOWED);
      expectErr(await publish(IDS.teacher6A, { title: "Au personnel", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["STAFF"] } }), MessagingCode.TARGET_NOT_ALLOWED);
      expectErr(await publish(IDS.parent1, { title: "Parent éditeur" }), MessagingCode.FORBIDDEN);
    });

    it("expiration : l'annonce disparaît de la boîte, reste dans l'historique ; retrait : invisible, motif obligatoire tracé", async () => {
      const soon = new Date(clock.now().getTime() + 3_600_000).toISOString();
      const a = unwrap(await publish(IDS.admin, { title: "Éphémère", expiresAt: soon, audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] } }));
      expect((await inboxOf(IDS.parent1)).some((x) => x.id === a.id)).toBe(true);
      clock.advance(2 * 3_600_000);
      expect((await inboxOf(IDS.parent1)).some((x) => x.id === a.id)).toBe(false);
      const history = (await inboxOf(IDS.parent1, true)).find((x) => x.id === a.id);
      expect(history).toMatchObject({ expired: true });
      expect((await getUnreadSummary(deps, ctxOf(IDS.parent1))).ok && (await unreadOf(IDS.parent1)).announcements).toBeDefined();
      const w = unwrap(await publish(IDS.admin, { title: "À retirer", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] } }));
      const withdrawn = unwrap(await withdrawAnnouncement(deps, ctxOf(IDS.admin), { announcementId: w.id, reason: "Erreur de date", caps: capsOf(IDS.admin) }));
      expect(withdrawn.status).toBe("WITHDRAWN");
      expect((await inboxOf(IDS.parent1, true)).some((x) => x.id === w.id)).toBe(false);
      expectErr(await getAnnouncementDetail(deps, ctxOf(IDS.parent1), { announcementId: w.id, caps: capsOf(IDS.parent1) }), MessagingCode.ANNOUNCEMENT_NOT_FOUND);
      expectErr(await withdrawAnnouncement(deps, ctxOf(IDS.admin), { announcementId: w.id, reason: "Encore", caps: capsOf(IDS.admin) }), MessagingCode.ANNOUNCEMENT_INVALID_STATE);
      expect(audit.entries.some((e) => e.entry.action === "messaging.announcement.withdrawn" && e.entry.reason === "Erreur de date")).toBe(true);
    });

    it("accusés : lecture idempotente, accusé de réception demandé, compteurs exacts, liste filtrable", async () => {
      const a = unwrap(await publish(IDS.admin, { title: "Accusé requis", requireAck: true, audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] } }));
      expect(a.stats).toMatchObject({ recipients: 2, read: 0, acknowledged: 0 });
      const read1 = unwrap(await markAnnouncementRead(deps, ctxOf(IDS.parent1), { announcementId: a.id }));
      const read2 = unwrap(await markAnnouncementRead(deps, ctxOf(IDS.parent1), { announcementId: a.id }));
      expect(read2.readAt).toBe(read1.readAt);
      unwrap(await acknowledgeAnnouncement(deps, ctxOf(IDS.parent1), { announcementId: a.id }));
      unwrap(await acknowledgeAnnouncement(deps, ctxOf(IDS.parent1), { announcementId: a.id }));
      const stats = unwrap(await getAnnouncementDetail(deps, ctxOf(IDS.admin), { announcementId: a.id, caps: capsOf(IDS.admin) })).stats;
      expect(stats).toMatchObject({ recipients: 2, read: 1, acknowledged: 1 });
      const pending = unwrap(await listAnnouncementReceipts(deps, ctxOf(IDS.admin), { announcementId: a.id, state: "pending_ack", limit: 10, caps: capsOf(IDS.admin) }));
      expect(pending.items.map((i) => i.userId)).toEqual([IDS.parent2]);
      expect(pending.items[0]!.displayName).toBe("KONE Mère");
      const acked = unwrap(await listAnnouncementReceipts(deps, ctxOf(IDS.admin), { announcementId: a.id, state: "acknowledged", limit: 10, caps: capsOf(IDS.admin) }));
      expect(acked.items.map((i) => i.userId)).toEqual([IDS.parent1]);
      // Un destinataire ne voit pas les chiffres ; un non-destinataire ne lit ni n'accuse.
      expect(unwrap(await getAnnouncementDetail(deps, ctxOf(IDS.parent2), { announcementId: a.id, caps: capsOf(IDS.parent2) })).stats).toBeNull();
      expectErr(await markAnnouncementRead(deps, ctxOf(IDS.parent3), { announcementId: a.id }), MessagingCode.ANNOUNCEMENT_NOT_FOUND);
      expectErr(await acknowledgeAnnouncement(deps, ctxOf(IDS.parent3), { announcementId: a.id }), MessagingCode.ANNOUNCEMENT_NOT_FOUND);
      expectErr(await listAnnouncementReceipts(deps, ctxOf(IDS.parent1), { announcementId: a.id, state: "all", limit: 10, caps: capsOf(IDS.parent1) }), MessagingCode.ANNOUNCEMENT_NOT_FOUND);
      // Accuser une annonce qui ne le demande pas : refusé.
      const plain = unwrap(await publish(IDS.admin, { title: "Sans accusé", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] } }));
      expectErr(await acknowledgeAnnouncement(deps, ctxOf(IDS.parent1), { announcementId: plain.id }), MessagingCode.ANNOUNCEMENT_INVALID_STATE);
    });

    it("brouillon, modification, programmation, publication par le job à l'échéance", async () => {
      const draft = unwrap(await publish(IDS.admin, { title: "Brouillon", publish: false, audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] } }));
      expect(draft).toMatchObject({ status: "DRAFT", stats: { recipients: 0 } });
      expect((await inboxOf(IDS.parent1)).some((x) => x.id === draft.id)).toBe(false);
      const edited = unwrap(await updateAnnouncement(deps, ctxOf(IDS.admin), { announcementId: draft.id, title: "Brouillon modifié", priority: "URGENT", caps: capsOf(IDS.admin) }));
      expect(edited).toMatchObject({ title: "Brouillon modifié", priority: "URGENT" });
      const at = new Date(clock.now().getTime() + 3 * 3_600_000).toISOString();
      const scheduled = unwrap(await publishAnnouncement(deps, ctxOf(IDS.admin), { announcementId: draft.id, publishAt: at, caps: capsOf(IDS.admin) }));
      expect(scheduled).toMatchObject({ status: "SCHEDULED", stats: { recipients: 2 } });
      expect((await inboxOf(IDS.parent1)).some((x) => x.id === draft.id)).toBe(false);
      expect(await publishDueAnnouncements(deps, createSystemContext(tenantA))).toBe(0);
      clock.advance(4 * 3_600_000);
      expect(await publishDueAnnouncements(deps, createSystemContext(tenantA))).toBeGreaterThanOrEqual(1);
      expect(await publishDueAnnouncements(deps, createSystemContext(tenantA))).toBe(0); // idempotent
      const live = (await inboxOf(IDS.parent1)).find((x) => x.id === draft.id)!;
      expect(live).toMatchObject({ status: "PUBLISHED", title: "Brouillon modifié" });
      const notifs = unwrap(await listMyNotifications(deps, ctxOf(IDS.parent1), { limit: 100 })).items;
      expect(notifs.some((n) => n.category === "ANNOUNCEMENT" && n.link === `/v2/announcements/${draft.id}`)).toBe(true);
    });

    it("annonce publiée : seuls l'expiration et l'épinglage changent ; un brouillon se supprime, une annonce publiée non", async () => {
      const a = unwrap(await publish(IDS.admin, { title: "Figée", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] } }));
      expectErr(await updateAnnouncement(deps, ctxOf(IDS.admin), { announcementId: a.id, title: "Autre", caps: capsOf(IDS.admin) }), MessagingCode.ANNOUNCEMENT_NOT_EDITABLE);
      const pinned = unwrap(await updateAnnouncement(deps, ctxOf(IDS.admin), { announcementId: a.id, pinned: true, expiresAt: new Date(clock.now().getTime() + 86_400_000).toISOString(), caps: capsOf(IDS.admin) }));
      expect(pinned.pinned).toBe(true);
      expect((await inboxOf(IDS.parent1))[0]!.pinned).toBe(true); // épinglées d'abord
      expectErr(await deleteAnnouncementDraft(deps, ctxOf(IDS.admin), { announcementId: a.id, caps: capsOf(IDS.admin) }), MessagingCode.ANNOUNCEMENT_INVALID_STATE);
      const d = unwrap(await publish(IDS.admin, { title: "À supprimer", publish: false }));
      unwrap(await deleteAnnouncementDraft(deps, ctxOf(IDS.admin), { announcementId: d.id, caps: capsOf(IDS.admin) }));
      expectErr(await getAnnouncementDetail(deps, ctxOf(IDS.admin), { announcementId: d.id, caps: capsOf(IDS.admin) }), MessagingCode.ANNOUNCEMENT_NOT_FOUND);
    });

    it("l'auteur gère la sienne ; un autre enseignant ne touche pas celle d'autrui ; la direction gère tout", async () => {
      const mine = unwrap(await publish(IDS.teacher6A, { title: "Mienne", publish: false, audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] } }));
      expectErr(await updateAnnouncement(deps, ctxOf(IDS.teacher6B), { announcementId: mine.id, title: "Volée", caps: capsOf(IDS.teacher6B) }), MessagingCode.ANNOUNCEMENT_NOT_FOUND);
      unwrap(await updateAnnouncement(deps, ctxOf(IDS.teacher6A), { announcementId: mine.id, title: "Mienne v2", caps: capsOf(IDS.teacher6A) }));
      unwrap(await updateAnnouncement(deps, ctxOf(IDS.admin), { announcementId: mine.id, title: "Mienne v3", caps: capsOf(IDS.admin) }));
      const managedByTeacher = unwrap(await listAnnouncements(deps, ctxOf(IDS.teacher6A), { scope: "managed", limit: 100, caps: capsOf(IDS.teacher6A) })).items;
      expect(managedByTeacher.every((x) => x.authorId === IDS.teacher6A)).toBe(true);
      const managedByAdmin = unwrap(await listAnnouncements(deps, ctxOf(IDS.admin), { scope: "managed", limit: 100, caps: capsOf(IDS.admin) })).items;
      expect(managedByAdmin.some((x) => x.authorId === IDS.teacher6A)).toBe(true);
      expectErr(await listAnnouncements(deps, ctxOf(IDS.parent1), { scope: "managed", limit: 10, caps: capsOf(IDS.parent1) }), MessagingCode.FORBIDDEN);
    });

    it("aperçu de l'audience : décompte sans rien écrire", async () => {
      const r = unwrap(await previewAudience(deps, ctxOf(IDS.admin), { audience: { targets: [{ kind: "LEVEL", ref: IDS.LEVEL_6 }], audiences: ["GUARDIANS"] }, caps: capsOf(IDS.admin) }));
      expect(r).toEqual({ count: 3, truncated: false });
      expectErr(await previewAudience(deps, ctxOf(IDS.teacher6A), { audience: { targets: [{ kind: "LEVEL", ref: IDS.LEVEL_6 }], audiences: ["GUARDIANS"] }, caps: capsOf(IDS.teacher6A) }), MessagingCode.TARGET_NOT_ALLOWED);
    });

    it("pièce jointe d'annonce : lisible par un destinataire, pas par un autre", async () => {
      const att = unwrap(await uploadAttachment(deps, ctxOf(IDS.admin), { fileName: "calendrier.pdf", content: PDF }));
      const a = unwrap(await publish(IDS.admin, { title: "Avec calendrier", attachmentIds: [att.id], audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] } }));
      expect(a.attachments).toEqual([att]);
      expect(unwrap(await getAttachmentUrl(deps, ctxOf(IDS.parent1), { attachmentId: att.id })).url).toContain("storage.test");
      expectErr(await getAttachmentUrl(deps, ctxOf(IDS.parent3), { attachmentId: att.id }), MessagingCode.ATTACHMENT_NOT_FOUND);
    });
  });

  // =========================================================================================================
  describe("notifications in-app et préférences", () => {
    it("une notification NON LUE par fil, avec compteur d'occurrences ; la lecture du fil la lit", async () => {
      const c = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Notifications" })).conversation!;
      unwrap(await reply(IDS.teacher6A, c.id, "2"));
      unwrap(await reply(IDS.teacher6A, c.id, "3"));
      const items = unwrap(await listMyNotifications(deps, ctxOf(IDS.parent1), { limit: 100 })).items.filter((n) => n.link === `/v2/messages/${c.id}`);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ category: "MESSAGE", occurrences: 3, readAt: null });
      expect(items[0]!.body).toBe("Notifications"); // l'objet, jamais le contenu du message
      const before = (await unreadOf(IDS.parent1)).notifications;
      unwrap(await markConversationRead(deps, ctxOf(IDS.parent1), { conversationId: c.id }));
      expect((await unreadOf(IDS.parent1)).notifications).toBe(before - 1);
      // Un nouveau message après lecture crée une NOUVELLE notification non lue.
      unwrap(await reply(IDS.teacher6A, c.id, "4"));
      expect((await unreadOf(IDS.parent1)).notifications).toBe(before);
    });

    it("l'expéditeur n'est pas notifié de son propre message ; une conversation en sourdine ne notifie pas", async () => {
      const before = (await unreadOf(IDS.teacher6B)).notifications;
      const c = unwrap(await direct(IDS.teacher6B, IDS.parent3, { subject: "Auto" })).conversation!;
      expect((await unreadOf(IDS.teacher6B)).notifications).toBe(before);
      unwrap(await setParticipantState(deps, ctxOf(IDS.parent3), { conversationId: c.id, muted: true }));
      const parentBefore = (await unreadOf(IDS.parent3)).notifications;
      unwrap(await reply(IDS.teacher6B, c.id, "Silence"));
      expect((await unreadOf(IDS.parent3)).notifications).toBe(parentBefore);
    });

    it("préférences : désactiver la catégorie MESSAGE supprime la notification ; une annonce URGENTE passe quand même", async () => {
      unwrap(await updateMyPreferences(deps, ctxOf(IDS.parent2), { preferences: [{ category: "MESSAGE", inApp: false }, { category: "ANNOUNCEMENT", inApp: false }] }));
      const prefs = unwrap(await getMyPreferences(deps, ctxOf(IDS.parent2))).items;
      expect(prefs.find((p) => p.category === "MESSAGE")).toMatchObject({ inApp: false });
      expect(prefs.find((p) => p.category === "SYSTEM")).toMatchObject({ inApp: true, externalChannels: ["EMAIL", "SMS", "WHATSAPP", "PUSH"] });
      const before = (await unreadOf(IDS.parent2)).notifications;
      unwrap(await direct(IDS.teacher6A, IDS.parent2, { subject: "Sans notification" }));
      expect((await unreadOf(IDS.parent2)).notifications).toBe(before);
      expect((await inbox(IDS.parent2)).some((c) => c.subject === "Sans notification")).toBe(true); // le message est bien reçu
      const normal = unwrap(await createAnnouncement(deps, ctxOf(IDS.admin), { title: "Normale", body: "x", priority: "NORMAL", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] }, requireAck: false, pinned: false, attachmentIds: [], publish: true, caps: capsOf(IDS.admin) }));
      expect((await unreadOf(IDS.parent2)).notifications).toBe(before);
      const urgent = unwrap(await createAnnouncement(deps, ctxOf(IDS.admin), { title: "Urgente", body: "x", priority: "URGENT", audience: { targets: [{ kind: "CLASSROOM", ref: IDS.C6A }], audiences: ["GUARDIANS"] }, requireAck: false, pinned: false, attachmentIds: [], publish: true, caps: capsOf(IDS.admin) }));
      expect((await unreadOf(IDS.parent2)).notifications).toBe(before + 1);
      void normal;
      void urgent;
      unwrap(await updateMyPreferences(deps, ctxOf(IDS.parent2), { preferences: [{ category: "MESSAGE", inApp: true }, { category: "ANNOUNCEMENT", inApp: true, externalChannels: ["EMAIL"] }] }));
      expect(unwrap(await getMyPreferences(deps, ctxOf(IDS.parent2))).items.find((p) => p.category === "ANNOUNCEMENT")!.externalChannels).toEqual(["EMAIL"]);
    });

    it("lire une notification, tout lire, liens internes uniquement ; pas celle d'autrui", async () => {
      const page = unwrap(await listMyNotifications(deps, ctxOf(IDS.parent1), { unreadOnly: true, limit: 100 }));
      expect(page.items.length).toBeGreaterThan(0);
      for (const n of page.items) expect(n.link === null || n.link.startsWith("/")).toBe(true);
      const first = page.items[0]!;
      expect(unwrap(await markNotificationRead(deps, ctxOf(IDS.parent1), { notificationId: first.id })).unreadCount).toBe(page.unreadCount - 1);
      expect(unwrap(await markNotificationRead(deps, ctxOf(IDS.parent1), { notificationId: first.id })).unreadCount).toBe(page.unreadCount - 1); // idempotent
      expectErr(await markNotificationRead(deps, ctxOf(IDS.parent3), { notificationId: first.id }), MessagingCode.NOTIFICATION_NOT_FOUND);
      unwrap(await markAllNotificationsRead(deps, ctxOf(IDS.parent1)));
      expect((await unreadOf(IDS.parent1)).notifications).toBe(0);
      expect(unwrap(await listMyNotifications(deps, ctxOf(IDS.parent1), { unreadOnly: true, limit: 10 })).items).toEqual([]);
    });

    it("la purge supprime les notifications LUES anciennes, jamais les non lues", async () => {
      unwrap(await direct(IDS.teacher6B, IDS.parent3, { subject: "Purge" }));
      const unread = (await unreadOf(IDS.parent3)).notifications;
      expect(unread).toBeGreaterThan(0);
      clock.advance(120 * 86_400_000);
      expect(await purgeOldNotifications(deps, createSystemContext(tenantA), 90)).toBeGreaterThanOrEqual(0);
      expect((await unreadOf(IDS.parent3)).notifications).toBe(unread);
      const readOld = unwrap(await listMyNotifications(deps, ctxOf(IDS.parent1), { limit: 100 })).items;
      expect(readOld.every((n) => n.readAt === null || Date.parse(n.readAt) > clock.now().getTime() - 90 * 86_400_000)).toBe(true);
    });
  });

  // =========================================================================================================
  describe("modération et supervision", () => {
    it("signalement par un participant ; pas de signalement de son propre message ni d'un fil étranger ; une seule fois", async () => {
      const c = unwrap(await direct(IDS.parent1, IDS.teacher6A, { subject: "Litige" })).conversation!;
      const bad = unwrap(await reply(IDS.parent1, c.id, "Contenu injurieux")).message;
      const r = unwrap(await reportMessage(deps, ctxOf(IDS.teacher6A), { messageId: bad.id, reason: "HARASSMENT", details: "Propos déplacés" }));
      expect(r.reportId).toBeDefined();
      expectErr(await reportMessage(deps, ctxOf(IDS.teacher6A), { messageId: bad.id, reason: "SPAM" }), MessagingCode.ALREADY_REPORTED);
      expectErr(await reportMessage(deps, ctxOf(IDS.parent1), { messageId: bad.id, reason: "SPAM" }), MessagingCode.INVALID_INPUT);
      expectErr(await reportMessage(deps, ctxOf(IDS.parent3), { messageId: bad.id, reason: "SPAM" }), MessagingCode.MESSAGE_NOT_FOUND);
      const open = unwrap(await listReports(deps, ctxOf(IDS.admin), { status: "OPEN", limit: 50 }));
      expect(open.items.find((i) => i.id === r.reportId)).toMatchObject({ reason: "HARASSMENT", reporterName: "KONAN Enseignant6A", status: "OPEN" });
    });

    it("lecture du contexte : corps réel, voisins, AUDITÉE", async () => {
      const report = unwrap(await listReports(deps, ctxOf(IDS.admin), { status: "OPEN", limit: 50 })).items[0]!;
      const before = audit.entries.length;
      const context = unwrap(await getReportContext(deps, ctxOf(IDS.admin), { reportId: report.id }));
      expect(context.messages.some((m) => m.rawBody === "Contenu injurieux")).toBe(true);
      expect(context.subject).toBe("Litige");
      const entry = audit.entries.slice(before).find((e) => e.entry.action === "messaging.report.context_read");
      expect(entry?.entry).toMatchObject({ sensitive: true, resourceId: report.id });
    });

    it("décision : retirer le message ET restreindre l'auteur ; l'auteur est notifié ; la restriction bloque tout envoi", async () => {
      const report = unwrap(await listReports(deps, ctxOf(IDS.admin), { status: "OPEN", limit: 50 })).items[0]!;
      const decided = unwrap(await decideReport(deps, ctxOf(IDS.admin), { reportId: report.id, decision: "ACTION", note: "Propos injurieux confirmés", removeMessage: true, restrictSender: { untilDays: 7 } }));
      expect(decided.status).toBe("ACTIONED");
      const msgs = unwrap(await listConversationMessages(deps, ctxOf(IDS.teacher6A), { conversationId: report.conversationId, limit: 10 })).items;
      expect(msgs.find((m) => m.id === report.messageId)).toMatchObject({ removed: true, body: null, removalKind: "MODERATOR" });
      const notified = unwrap(await listMyNotifications(deps, ctxOf(IDS.parent1), { limit: 100 })).items.find((n) => n.category === "MODERATION");
      expect(notified?.title).toBe("Votre envoi de messages a été restreint");
      expect(unwrap(await getMyAudience(deps, ctxOf(IDS.parent1), { caps: capsOf(IDS.parent1) }))).toMatchObject({ restricted: true, canSend: false });
      expectErr(await direct(IDS.parent1, IDS.teacher6A, { subject: "Après sanction" }), MessagingCode.SENDER_RESTRICTED);
      expectErr(await reply(IDS.parent1, report.conversationId), MessagingCode.SENDER_RESTRICTED);
      expectErr(await decideReport(deps, ctxOf(IDS.admin), { reportId: report.id, decision: "DISMISS", note: "Trop tard" }), MessagingCode.REPORT_ALREADY_DECIDED);
      // La restriction expire d'elle-même.
      clock.advance(8 * 86_400_000);
      unwrap(await direct(IDS.parent1, IDS.teacher6A, { subject: "Après expiration" }));
    });

    it("restrictions manuelles : pose, liste, levée ; audit sensible", async () => {
      unwrap(await restrictUser(deps, ctxOf(IDS.admin), { userId: IDS.student1, reason: "Messages répétés hors sujet", untilDays: null }));
      expect(unwrap(await listActiveRestrictions(deps, ctxOf(IDS.admin))).items.map((r) => r.userId)).toContain(IDS.student1);
      expectErr(await direct(IDS.student1, IDS.teacher6A, { subject: "Restreint" }), MessagingCode.SENDER_RESTRICTED);
      expectErr(await restrictUser(deps, ctxOf(IDS.admin), { userId: IDS.admin, reason: "Moi-même", untilDays: 1 }), MessagingCode.INVALID_INPUT);
      unwrap(await liftRestriction(deps, ctxOf(IDS.admin), { userId: IDS.student1 }));
      unwrap(await direct(IDS.student1, IDS.teacher6A, { subject: "Levée" }));
      expectErr(await liftRestriction(deps, ctxOf(IDS.admin), { userId: IDS.student1 }), MessagingCode.RESTRICTION_NOT_FOUND);
      expect(audit.entries.filter((e) => e.entry.action === "messaging.restriction.set").every((e) => e.entry.sensitive === true)).toBe(true);
    });

    it("rejet d'un signalement : aucun effet sur le message ni sur l'auteur", async () => {
      const c = unwrap(await direct(IDS.parent3, IDS.teacherBoth, { subject: "Rejet" })).conversation!;
      void c;
      const conv = (await inbox(IDS.teacherBoth)).find((x) => x.subject === "Rejet")!;
      const m = unwrap(await listConversationMessages(deps, ctxOf(IDS.teacherBoth), { conversationId: conv.id, limit: 5 })).items[0]!;
      const rep = unwrap(await reportMessage(deps, ctxOf(IDS.teacherBoth), { messageId: m.id, reason: "OTHER" }));
      const dismissed = unwrap(await decideReport(deps, ctxOf(IDS.admin), { reportId: rep.reportId, decision: "DISMISS", note: "Rien d'anormal" }));
      expect(dismissed).toMatchObject({ status: "DISMISSED", decisionNote: "Rien d'anormal" });
      expect(unwrap(await listConversationMessages(deps, ctxOf(IDS.teacherBoth), { conversationId: conv.id, limit: 5 })).items[0]!.removed).toBe(false);
    });

    it("supervision : liste sans contenu, lecture avec motif OBLIGATOIRE et AUDITÉE (motif conservé)", async () => {
      const list = unwrap(await superviseListConversations(deps, ctxOf(IDS.admin), { q: "Litige", limit: 20 }));
      expect(list.items.length).toBeGreaterThan(0);
      expect(list.items.every((i) => i.lastPreview === null)).toBe(true);
      const conv = list.items[0]!;
      expectErr(await superviseReadMessages(deps, ctxOf(IDS.admin), { conversationId: conv.id, reason: " ", limit: 10 }), MessagingCode.INVALID_INPUT);
      const before = audit.entries.length;
      const read = unwrap(await superviseReadMessages(deps, ctxOf(IDS.admin), { conversationId: conv.id, reason: "Enquête suite à un signalement parent", limit: 10 }));
      expect(read.items.length).toBeGreaterThan(0);
      expect(read.items.some((m) => m.removed && m.rawBody.length > 0)).toBe(true); // le message retiré reste lisible pour la modération
      const entry = audit.entries.slice(before).find((e) => e.entry.action === "messaging.supervision.read");
      expect(entry?.entry).toMatchObject({ sensitive: true, reason: "Enquête suite à un signalement parent", resourceId: conv.id });
      expect(JSON.stringify(entry?.entry.metadata)).not.toContain("injurieux"); // l'audit ne contient jamais le contenu
      // Les fils système ne se supervisent pas.
      const sys = await q<{ id: string }>("SELECT id FROM messaging.conversations WHERE kind = 'SYSTEM' LIMIT 1");
      if (sys[0]) expectErr(await superviseReadMessages(deps, ctxOf(IDS.admin), { conversationId: sys[0].id, reason: "Curiosité", limit: 10 }), MessagingCode.CONVERSATION_NOT_FOUND);
    });
  });

  // =========================================================================================================
  describe("quotas anti-spam", () => {
    it("messages par heure : dépassement = 429 avec Retry-After ; la fenêtre se libère", async () => {
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { maxMessagesPerHour: 100 }));
      clock.advance(2 * 3_600_000); // fenêtre propre
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { maxMessagesPerHour: 3 }));
      const c = unwrap(await direct(IDS.teacher6B, IDS.parent3, { subject: "Quota" })).conversation!;
      unwrap(await reply(IDS.teacher6B, c.id, "2"));
      unwrap(await reply(IDS.teacher6B, c.id, "3"));
      const blocked = expectErr(await reply(IDS.teacher6B, c.id, "4"), MessagingCode.RATE_LIMITED);
      expect(blocked).toBeInstanceOf(RateLimitedError);
      expect((blocked as RateLimitedError).retryAfterSec).toBeGreaterThan(0);
      clock.advance(3_700_000);
      unwrap(await reply(IDS.teacher6B, c.id, "5"));
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { maxMessagesPerHour: 60 }));
    });

    it("nouvelles conversations par jour ; une diffusion compte pour UNE", async () => {
      clock.advance(25 * 3_600_000);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { maxNewConversationsPerDay: 3, maxMessagesPerHour: 100 }));
      unwrap(await direct(IDS.teacherBoth, IDS.parent1, { subject: "Q1" }));
      unwrap(await toClass(IDS.teacherBoth, IDS.C6A, ["GUARDIANS"], "BROADCAST", "Diffusion quota")); // 1 conversation (2 fils)
      unwrap(await direct(IDS.teacherBoth, IDS.parent3, { subject: "Q2" }));
      expectErr(await direct(IDS.teacherBoth, IDS.parent3, { subject: "Q3" }), MessagingCode.RATE_LIMITED);
      // Répondre dans un fil existant n'est pas une nouvelle conversation.
      const existing = (await inbox(IDS.teacherBoth)).find((c) => c.subject === "Q2")!;
      unwrap(await reply(IDS.teacherBoth, existing.id, "Suite"));
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { maxNewConversationsPerDay: 30, maxMessagesPerHour: 60 }));
    });
  });

  // =========================================================================================================
  describe("messages système (événements consommés)", () => {
    const eventOf = (studentId: string, extra: Record<string, unknown> = {}) => ({ v: 1, studentId, date: "2026-10-02", excused: false, correction: false, recordId: "0192f0a4-7b1e-7c3a-8d2e-00000000d001", ...extra });
    const sysCtx = () => createSystemContext(tenantA);

    it("absence détectée : TOUS les tuteurs joignables reçoivent un message dans leur fil d'alertes ; rejouer ne duplique pas", async () => {
      const r = unwrap(await onAttendanceRecorded(deps, sysCtx(), { eventId: "0192f0a4-7b1e-7c3a-8d2e-00000000e001", kind: "ABSENCE", payload: eventOf(IDS.S1) }));
      expect(r).toEqual({ delivered: 2, skipped: null });
      for (const parent of [IDS.parent1, IDS.parent2]) {
        const alerts = (await inbox(parent)).find((c) => c.kind === "SYSTEM")!;
        expect(alerts).toMatchObject({ allowReplies: false, unreadCount: expect.any(Number) });
        const msgs = unwrap(await listConversationMessages(deps, ctxOf(parent), { conversationId: alerts.id, limit: 10 })).items;
        const last = msgs[msgs.length - 1]!;
        expect(last).toMatchObject({ kind: "SYSTEM", senderId: null, systemCode: "attendance.absence" });
        expect(last.body).toContain("Awa Koné");
        expect(last.body).toContain("02/10/2026");
      }
      const again = unwrap(await onAttendanceRecorded(deps, sysCtx(), { eventId: "0192f0a4-7b1e-7c3a-8d2e-00000000e001", kind: "ABSENCE", payload: eventOf(IDS.S1) }));
      expect(again.delivered).toBe(0);
      const n = await q("SELECT count(*)::int AS n FROM messaging.messages WHERE system_code = 'attendance.absence' AND dedupe_key = 'evt:0192f0a4-7b1e-7c3a-8d2e-00000000e001'");
      expect(n[0]!.n).toBe(2);
      // On ne répond pas à un fil système.
      const alerts = (await inbox(IDS.parent1)).find((c) => c.kind === "SYSTEM")!;
      expectErr(await reply(IDS.parent1, alerts.id), MessagingCode.REPLIES_DISABLED);
      // La notification est de catégorie SYSTEM.
      const notifs = unwrap(await listMyNotifications(deps, ctxOf(IDS.parent1), { limit: 100 })).items;
      expect(notifs.some((x) => x.category === "SYSTEM" && x.title.startsWith("Absence de"))).toBe(true);
    });

    it("absence déjà excusée, correction, élève inconnu, payload illisible : aucun message", async () => {
      const send = (eventId: string, payload: unknown) => onAttendanceRecorded(deps, sysCtx(), { eventId, kind: "ABSENCE", payload });
      expect(unwrap(await send("0192f0a4-7b1e-7c3a-8d2e-00000000e002", eventOf(IDS.S1, { excused: true }))).skipped).toBe("excused");
      expect(unwrap(await send("0192f0a4-7b1e-7c3a-8d2e-00000000e003", eventOf(IDS.S1, { correction: true }))).skipped).toBe("correction");
      expect(unwrap(await send("0192f0a4-7b1e-7c3a-8d2e-00000000e004", eventOf("0192f0a4-7b1e-7c3a-8d2e-00000000ffff"))).skipped).toBe("student_unknown");
      expect(unwrap(await send("0192f0a4-7b1e-7c3a-8d2e-00000000e005", { rien: 1 })).skipped).toBe("payload_unreadable");
    });

    it("retard : gabarit désactivé par défaut ; le tenant l'active et le personnalise", async () => {
      const late = (id: string) => onAttendanceRecorded(deps, sysCtx(), { eventId: id, kind: "LATE", payload: eventOf(IDS.S1, { minutesLate: 10 }) });
      expect(unwrap(await late("0192f0a4-7b1e-7c3a-8d2e-00000000e010")).skipped).toBe("template_disabled");
      const templates = unwrap(await listSystemTemplates(deps, ctxOf(IDS.admin))).items;
      expect(templates.find((t) => t.code === "attendance.late")).toMatchObject({ enabled: false, customized: false });
      unwrap(await updateSystemTemplate(deps, ctxOf(IDS.admin), { code: "attendance.late", enabled: true, body: "{{studentName}} a eu du retard le {{date}}." }));
      expect(unwrap(await late("0192f0a4-7b1e-7c3a-8d2e-00000000e011")).delivered).toBe(2);
      const alerts = (await inbox(IDS.parent1)).find((c) => c.kind === "SYSTEM")!;
      const msgs = unwrap(await listConversationMessages(deps, ctxOf(IDS.parent1), { conversationId: alerts.id, limit: 10 })).items;
      expect(msgs[msgs.length - 1]!.body).toContain("a eu du retard le 02/10/2026");
      expectErr(await updateSystemTemplate(deps, ctxOf(IDS.admin), { code: "attendance.late", body: "{{inconnue}}" }), MessagingCode.INVALID_INPUT);
      expectErr(await updateSystemTemplate(deps, ctxOf(IDS.admin), { code: "autre.chose", body: "x" }), MessagingCode.TEMPLATE_NOT_FOUND);
    });

    it("l'absence est désactivable par le tenant", async () => {
      unwrap(await updateSystemTemplate(deps, ctxOf(IDS.admin), { code: "attendance.absence", enabled: false }));
      expect(unwrap(await onAttendanceRecorded(deps, sysCtx(), { eventId: "0192f0a4-7b1e-7c3a-8d2e-00000000e020", kind: "ABSENCE", payload: eventOf(IDS.S1) })).skipped).toBe("template_disabled");
      unwrap(await updateSystemTemplate(deps, ctxOf(IDS.admin), { code: "attendance.absence", enabled: true }));
    });

    it("le tenant B n'a pas les gabarits ni les fils du tenant A", async () => {
      expect(unwrap(await listSystemTemplates(deps, ctxOf(IDS.admin, tenantB))).items.every((t) => !t.customized)).toBe(true);
      expect(unwrap(await listConversations(deps, ctxOf(IDS.parent1, tenantB), { folder: "inbox", limit: 20 })).items).toEqual([]);
    });
  });

  // =========================================================================================================
  describe("atomicité, événements, audit, paramètres", () => {
    it("écrit les événements d'outbox (sans texte de message) dans la même transaction", async () => {
      const c = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Outbox", body: "Contenu confidentiel du message" }));
      const rows = await q<{ type: string; payload: Record<string, unknown>; tenant_id: string }>("SELECT type, payload, tenant_id FROM kernel.domain_events WHERE aggregate_id = $1 ORDER BY occurred_at", [c.conversation!.id]);
      expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(["messaging.conversation.created", "messaging.message.sent"]));
      const sent = rows.find((r) => r.type === "messaging.message.sent")!;
      expect(sent.tenant_id).toBe(tenantA);
      expect(sent.payload).toMatchObject({ v: 1, conversationId: c.conversation!.id, messageId: c.message!.id, senderId: IDS.teacher6A, recipientCount: 1, kind: "USER" });
      expect(JSON.stringify(rows)).not.toContain("confidentiel");
    });

    it("annule TOUT (conversation, message, notification, événement) si l'audit échoue", async () => {
      const failing = createMessagingDeps({
        db: db.tenantDb, clock, ports: inMemoryPorts(world, storage),
        audit: { record: async () => { throw new Error("audit indisponible"); } },
      });
      const { ctx, caps } = as(IDS.admin);
      await expect(
        createConversation(failing, ctx, { kind: "GROUP", subject: "Atomicité", body: "x", priority: "NORMAL", recipients: { userIds: [IDS.parent1, IDS.parent2], classrooms: [], toAdministration: false }, attachmentIds: [], caps }),
      ).rejects.toThrow(/audit indisponible/);
      expect(await q("SELECT 1 FROM messaging.conversations WHERE subject = 'Atomicité'")).toEqual([]);
      // Ni notification orpheline, ni événement fantôme : tout événement de conversation pointe une conversation qui existe.
      expect(await q("SELECT 1 FROM messaging.notifications n WHERE n.entity_type = 'conversation' AND n.entity_id NOT IN (SELECT id FROM messaging.conversations)")).toEqual([]);
      expect(await q("SELECT 1 FROM kernel.domain_events e WHERE e.type = 'messaging.conversation.created' AND e.aggregate_id NOT IN (SELECT id::text FROM messaging.conversations)")).toEqual([]);
    });

    it("annule l'envoi si une pièce est invalide (rien n'est écrit)", async () => {
      const before = (await q<{ n: number }>("SELECT count(*)::int AS n FROM messaging.conversations"))[0]!.n;
      expectErr(await direct(IDS.teacher6A, IDS.parent1, { subject: "Pièce fantôme", attachmentIds: ["0192f0a4-7b1e-7c3a-8d2e-00000000aaaa"] }), MessagingCode.ATTACHMENT_NOT_FOUND);
      expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM messaging.conversations"))[0]!.n).toBe(before);
    });

    it("paramètres : valeurs par défaut sans ligne, mise à jour auditée (avant / après), cohérence des plafonds", async () => {
      const fresh = unwrap(await getMessagingSettings(deps, ctxOf(IDS.admin, tenantB)));
      expect(fresh).toMatchObject({ studentPolicy: "TEACHERS_AND_ADMIN", maxMessagesPerHour: 120, previousYearWindowDays: 90, attachmentMaxBytes: 5 * 1024 * 1024, adminContactRoles: ["directeur", "secretariat"] });
      const before = audit.entries.length;
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { adminContactRoles: ["directeur"] }));
      const entry = audit.entries.slice(before).find((e) => e.entry.action === "messaging.settings.updated")!.entry;
      expect(entry).toMatchObject({ sensitive: true, before: { adminContactRoles: ["directeur", "secretariat"] }, after: { adminContactRoles: ["directeur"] } });
      expectErr(await updateMessagingSettings(deps, ctxOf(IDS.admin), { maxGroupParticipants: 900, maxBroadcastParticipants: 100 }), MessagingCode.INVALID_INPUT);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { adminContactRoles: ["directeur", "secretariat"] }));
    });

    it("les défauts du code sont identiques aux défauts de la table `settings`", async () => {
      const row = (await q("INSERT INTO messaging.settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id RETURNING *", [tenantB]))[0]!;
      const code = unwrap(await getMessagingSettings(deps, ctxOf(IDS.admin, tenantB)));
      expect(code).toEqual({
        studentPolicy: row.student_policy, adminContactRoles: row.admin_contact_roles, attachmentsEnabled: row.attachments_enabled, attachmentMaxBytes: row.attachment_max_bytes,
        attachmentMaxPerItem: row.attachment_max_per_item, allowedAttachmentTypes: row.allowed_attachment_types, maxMessagesPerHour: row.max_messages_per_hour,
        maxNewConversationsPerDay: row.max_new_conversations_per_day, maxGroupParticipants: row.max_group_participants, maxBroadcastParticipants: row.max_broadcast_participants,
        messageMaxLength: row.message_max_length, notificationRetentionDays: row.notification_retention_days, previousYearWindowDays: row.previous_year_window_days,
      });
      expect(row.max_messages_per_hour).toBe(120); // Q-06 : plafond par défaut 120 messages/h
      await q("DELETE FROM messaging.settings WHERE tenant_id = $1", [tenantB]);
    });

    it("garde-fous SQL : message immuable en seq, retrait cohérent, fil système sans expéditeur", async () => {
      const c = unwrap(await direct(IDS.teacher6A, IDS.parent1, { subject: "Garde-fous" })).conversation!;
      await expect(q("INSERT INTO messaging.messages (id, tenant_id, conversation_id, seq, kind, sender_id, body) VALUES (gen_random_uuid(), $1, $2, 1, 'USER', $3, 'doublon de seq')", [tenantA, c.id, IDS.teacher6A])).rejects.toThrow();
      await expect(q("INSERT INTO messaging.messages (id, tenant_id, conversation_id, seq, kind, sender_id, body) VALUES (gen_random_uuid(), $1, $2, 99, 'SYSTEM', $3, 'système avec expéditeur')", [tenantA, c.id, IDS.teacher6A])).rejects.toThrow();
      await expect(q("UPDATE messaging.messages SET removed_at = now() WHERE conversation_id = $1", [c.id])).rejects.toThrow(); // removal_kind obligatoire avec removed_at
    });
  });

  // =========================================================================================================
  describe("Q-05 : un parent écrit aux enseignants de l'année précédente (fenêtre configurable)", () => {
    const S5 = "0192f0a4-7b1e-7c3a-8d2e-000000000305";
    const PARENT_PY = "0192f0a4-7b1e-7c3a-8d2e-000000000125";
    const FORMER = "0192f0a4-7b1e-7c3a-8d2e-000000000118";
    const FORMER_STAFF = "0192f0a4-7b1e-7c3a-8d2e-000000000408";
    const anchor = (): string => new Date(clock.now().getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    let fixedAnchor = "";
    const caps = (id: string) => (id === PARENT_PY ? { childSend: true } : capsOf(id));
    const send = (from: string, to: string, subject: string) =>
      createConversation(deps, ctxOf(from), { kind: "DIRECT", subject, body: "Bonjour", priority: "NORMAL", recipients: { userIds: [to], classrooms: [], toAdministration: false }, attachmentIds: [], caps: caps(from) });

    beforeAll(() => {
      // L'enfant (S5) était en 5ème A l'an dernier, il est en 6ème A ; l'ancien professeur de 5ème A n'enseigne plus aujourd'hui.
      world.studentClasses.set(S5, [IDS.C6A]);
      world.studentPreviousYearClasses.set(S5, [IDS.C5A]);
      world.studentNames.set(S5, "Ibrahim Test");
      world.addUser({ userId: PARENT_PY, displayName: "TEST Parent Précédent", childStudentIds: [S5] });
      world.addUser({ userId: FORMER, displayName: "LAMINE Ancien professeur", staffId: FORMER_STAFF, teachingClassroomIds: [], pastTeachingClassroomIds: [IDS.C5A] });
      fixedAnchor = anchor();
      world.previousYearWindowAnchorOn = fixedAnchor; // début de l'année en cours : on est au jour 30
    });
    afterAll(() => {
      world.previousYearWindowAnchorOn = null;
    });

    it("dans la fenêtre (90 jours par défaut) : autorisé ; un enseignant sans lien avec l'ANCIENNE classe de l'enfant reste refusé", async () => {
      unwrap(await send(PARENT_PY, FORMER, "Ancien professeur"));
      // Les enseignants de la classe ACTUELLE restent joignables ; un enseignant d'une autre classe, jamais.
      unwrap(await send(PARENT_PY, IDS.teacher6A, "Professeur actuel"));
      expectErr(await send(PARENT_PY, IDS.teacher6B, "Autre classe"), MessagingCode.RECIPIENT_NOT_ALLOWED);
      // Le lien n'est pas symétrique : l'ancien professeur n'ouvre rien à un parent d'un autre enfant.
      expectErr(await send(IDS.parent3, FORMER, "Sans lien"), MessagingCode.RECIPIENT_NOT_ALLOWED);
      // Le sélecteur de destinataires propose cet enseignant (par nom, par classe de l'an dernier, et dans les contacts naturels).
      const byName = unwrap(await listAllowedRecipients(deps, ctxOf(PARENT_PY), { q: "Ancien", limit: 20, caps: caps(PARENT_PY) }));
      expect(byName.items.map((i) => i.userId)).toEqual([FORMER]);
      const byClass = unwrap(await listAllowedRecipients(deps, ctxOf(PARENT_PY), { classroomId: IDS.C5A, limit: 20, caps: caps(PARENT_PY) }));
      expect(byClass.items.map((i) => i.userId)).toEqual([FORMER]);
      const natural = unwrap(await listAllowedRecipients(deps, ctxOf(PARENT_PY), { limit: 50, caps: caps(PARENT_PY) }));
      expect(natural.items.map((i) => i.userId)).toEqual(expect.arrayContaining([FORMER, IDS.teacher6A]));
      // Un autre parent ne voit pas cette classe de l'an dernier.
      const other = unwrap(await listAllowedRecipients(deps, ctxOf(IDS.parent3), { classroomId: IDS.C5A, limit: 20, caps: capsOf(IDS.parent3) }));
      expect(other.items).toEqual([]);
    });

    it("la fenêtre se ferme : au-delà de la durée configurée, ou fermée par l'établissement (0 jour) ; isolation A/B des réglages", async () => {
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { previousYearWindowDays: 20 })); // jour 30 > 20
      expectErr(await send(PARENT_PY, FORMER, "Fenêtre échue"), MessagingCode.RECIPIENT_NOT_ALLOWED);
      expect(unwrap(await listAllowedRecipients(deps, ctxOf(PARENT_PY), { q: "Ancien", limit: 20, caps: caps(PARENT_PY) })).items).toEqual([]);
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { previousYearWindowDays: 40 }));
      unwrap(await send(PARENT_PY, FORMER, "Fenêtre rouverte"));
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { previousYearWindowDays: 0 }));
      expectErr(await send(PARENT_PY, FORMER, "Fenêtre fermée"), MessagingCode.RECIPIENT_NOT_ALLOWED);
      // Le réglage est PAR établissement : le tenant B garde le défaut.
      expect(unwrap(await getMessagingSettings(deps, ctxOf(IDS.admin, tenantB))).previousYearWindowDays).toBe(90);
      expect((await q("SELECT previous_year_window_days AS d FROM messaging.settings WHERE tenant_id = $1", [tenantA]))[0]!.d).toBe(0);
      // Le temps passe : à 90 jours + 1, la fenêtre par défaut est échue.
      unwrap(await updateMessagingSettings(deps, ctxOf(IDS.admin), { previousYearWindowDays: 90 }));
      unwrap(await send(PARENT_PY, FORMER, "Dernier jour"));
      clock.advance(62 * 86_400_000); // jour 92 : la fenêtre de 90 jours (bornes incluses) est échue
      try {
        expectErr(await send(PARENT_PY, FORMER, "Trop tard"), MessagingCode.RECIPIENT_NOT_ALLOWED);
        // Sans année précédente connue (aucun ancrage), la fenêtre reste fermée (échec fermé).
        world.previousYearWindowAnchorOn = null;
        clock.advance(-62 * 86_400_000);
        expectErr(await send(PARENT_PY, FORMER, "Sans ancrage"), MessagingCode.RECIPIENT_NOT_ALLOWED);
      } finally {
        world.previousYearWindowAnchorOn = fixedAnchor;
      }
    });
  });
});
