/**
 * Intégration (Postgres réel, rôle applicatif soumis à la RLS ; s'ignore sans TEST_DATABASE_URL).
 *
 * Prouve : isolation A/B (structure + comportement + vraies données dans chaque table) ; événement -> règles -> journal ->
 * envoi (canaux scriptés, canal in-app RÉEL via `messaging`) ; idempotence ; consentement, heures calmes, urgence ; reprise
 * avec backoff, panne du canal, rebond et liste de suppression, bail expiré ; relances d'impayés par paliers (jamais deux fois,
 * arrêt dès paiement) ; alertes ; envoi manuel ; gabarits versionnés ; plafonds ; confidentialité du journal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { createRequestContext, createSystemContext, ManualClock, unwrap, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import allowlist, { fixtures } from "../../../isolation-allowlist.notifications";
import { dispatchTenant } from "../../application/dispatch";
import { createNotificationsDeps, type NotificationsDeps } from "../../application/deps";
import { runDunning } from "../../application/dunning";
import { evaluateAlerts } from "../../application/alerts";
import { onDomainEvent, onInvoicePaid } from "../../application/events";
import { getChannelsHealth, sendChannelTest } from "../../application/health";
import { deliveryStats, listDeliveries } from "../../application/journal";
import { applyUnsubscribe, getConsentLog, getMyNotificationPreferences, setSubjectConsent, updateMyNotificationPreferences } from "../../application/preferences";
import { RecordingAudit } from "../../application/ports";
import { listMyPushDevices, subscribePush, unsubscribePush } from "../../application/push";
import { listRules, resetRule, saveRule } from "../../application/rules";
import { sendManualNotification } from "../../application/send";
import { getNotificationSettings, updateNotificationSettings } from "../../application/settings";
import { activateTemplateVersion, listTemplates, listTemplateVersions, previewTemplate, publishTemplateVersion, setTemplateEnabled } from "../../application/templates";
import { applyDeliveryStatusWebhook } from "../../application/webhooks";
import { housekeepingTenant } from "../../application/housekeeping";
import { signUnsubscribeToken } from "../../domain/tokens";
import { NotifCode } from "../../domain/errors";
import { createInAppChannel } from "../../infrastructure/channels/in-app";
import { inMemoryPorts, type InMemoryWorld } from "../../infrastructure/in-memory-ports";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { ACADEMIC_R, buildWorld, ECONOME_R, GUARDIAN_A, GUARDIAN_B, HR_R, IDS, registryOf, scriptedChannels, TEACHER_R, type ScriptedChannels } from "../support/world";

const NOTIF_TABLES = [
  "settings", "template_versions", "templates", "rules", "deliveries", "channel_preferences", "subject_preferences", "consent_log",
  "suppressions", "push_subscriptions", "dunning_steps",
];

function expectErr<T>(r: Result<T, AppError>, code: string): AppError {
  expect(r.ok, `attendu : erreur « ${code} »`).toBe(false);
  if (r.ok) throw new Error("unreachable");
  expect(r.error.code).toBe(code);
  return r.error;
}

const ABSENCE = (n: number, over: Record<string, unknown> = {}) => ({
  v: 1, sessionId: IDS.EVT(100), recordId: IDS.EVT(200 + n), enrollmentId: IDS.EVT(300), studentId: IDS.S1, classroomId: IDS.C1, date: "2026-10-02",
  occurrenceId: null, statusCode: "ABSENT", excused: false, countedMinutes: null, correction: false, ...over,
});

describeIntegration("module notifications : base réelle", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  let mem: InMemoryWorld;
  let ch: ScriptedChannels;
  let audit: RecordingAudit;
  let deps: NotificationsDeps;
  const clock = new ManualClock("2026-10-02T09:00:00.000Z");
  let evt = 0;

  const sys = (tenant = tenantA): RequestContext => createSystemContext(tenant);
  const user = (userId: string, tenant = tenantA): RequestContext => createRequestContext({ tenantId: tenant, userId });
  const admin = (): RequestContext => user(IDS.admin);
  const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => db.admin.query(sql, params).then((r) => r.rows as T[]);
  const event = (type: string, payload: unknown, tenant = tenantA) => onDomainEvent(deps, sys(tenant), { eventId: IDS.EVT(++evt), eventType: type, payload });
  const journal = (where = "TRUE", params: unknown[] = []) =>
    q<{ id: string; channel: string; status: string; skip_reason: string | null; subject_key: string; template_code: string; template_version: number; attempts: number; available_at: Date; recipient_masked: string; last_error_code: string | null; provider_id: string | null; urgent: boolean }>(
      `SELECT id, channel, status, skip_reason, subject_key, template_code, template_version, attempts, available_at, recipient_masked, last_error_code, provider_id, urgent FROM notifications.deliveries WHERE tenant_id = '${tenantA}' AND ${where} ORDER BY created_at, channel, subject_key`,
      params,
    );
  const reset = async (): Promise<void> => {
    await q("DELETE FROM notifications.deliveries");
    await q("DELETE FROM notifications.dunning_steps");
    await q("DELETE FROM notifications.channel_preferences");
    await q("DELETE FROM notifications.subject_preferences");
    await q("DELETE FROM notifications.suppressions");
    await q("DELETE FROM notifications.rules");
    await q("DELETE FROM notifications.push_subscriptions");
    await q("DELETE FROM notifications.consent_log");
    await q("DELETE FROM messaging.messages");
    await q("DELETE FROM messaging.notifications");
    await q("DELETE FROM notifications.templates");
    await q("DELETE FROM notifications.template_versions");
    await q("DELETE FROM notifications.settings");
    for (const c of [ch.EMAIL, ch.SMS, ch.WHATSAPP, ch.PUSH]) {
      c.script.length = 0;
      c.sent.length = 0;
      c.down = false;
      c.calls = 0;
    }
    clock.set("2026-10-02T09:00:00.000Z");
    mem.overdue.items = [];
    mem.overdue.settled.clear();
    mem.grades.pairs = [];
    mem.teachingLoad.loads = [];
  };

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("tenant-a");
    tenantB = await db.createTenant("tenant-b");
    mem = inMemoryPorts();
    const world = buildWorld();
    mem.ports = { ...mem.ports, directory: world };
    ch = scriptedChannels();
    audit = new RecordingAudit();
    deps = createNotificationsDeps({
      db: db.tenantDb,
      clock,
      audit,
      ports: mem.ports,
      channels: registryOf(createInAppChannel({ db: db.tenantDb, clock }), ch),
      config: { appBaseUrl: "https://ecole.example.org", unsubscribeSecret: "secret-de-test", webhookSecret: "secret-webhook", production: false },
      random: () => 0,
    });
  });
  afterAll(async () => {
    await db?.drop();
  });

  // =========================================================================================================
  describe("isolation multi-tenant (RLS)", () => {
    it("assertTenantIsolation : chaque table du schéma est isolée (structure + comportement A/B)", async () => {
      const report = await assertTenantIsolation({ pool: db.appPool, schemas: ["notifications"], allowlist: allowlist.map((e) => e.table), ...(fixtures ? { fixtures } : {}) } as Parameters<typeof assertTenantIsolation>[0]);
      expect(report.violations).toEqual([]);
      expect(report.staleAllowlist).toEqual([]);
    });

    it("un autre tenant ne voit rien : zéro ligne chez B, au moins une chez A, pour CHAQUE table (vraies données)", async () => {
      await reset();
      // Remplit chaque table du tenant A par les cas d'usage.
      unwrap(await updateNotificationSettings(deps, admin(), { senderName: "Les Palmiers" })); // settings
      unwrap(await publishTemplateVersion(deps, admin(), { code: "absence", channel: "SMS", locale: "fr-CI", body: "{{studentName}} absent le {{date}}", note: "isolation" })); // template_versions, templates
      unwrap(await saveRule(deps, admin(), "custom.isolation", { enabled: true, trigger: "attendance.absence.recorded", templateCode: "absence", audience: { kind: "STUDENT_GUARDIANS", financialFirst: false, fallbackToStudent: false }, channels: ["EMAIL"], strategy: "ALL", urgent: false, conditions: {} })); // rules
      unwrap(await event("attendance.absence.recorded", ABSENCE(1))); // deliveries
      unwrap(await updateMyNotificationPreferences(deps, user(IDS.guardianFinancial), { channels: [{ channel: "SMS", category: "*", enabled: false }], quietHours: { enabled: true, start: "21:00", end: "06:00" } })); // channel_preferences, subject_preferences, consent_log
      await q(`INSERT INTO notifications.suppressions (tenant_id, channel, address_hash, address_masked, reason, created_at) VALUES ($1,'EMAIL',$2,'a***@x.org','MANUAL',now())`, [tenantA, "a".repeat(64)]); // suppressions
      unwrap(await subscribePush(deps, user(IDS.guardianFinancial), { endpoint: "https://push.example.org/send/abc", keys: { p256dh: "B".repeat(87), auth: "c".repeat(22) } })).id; // push_subscriptions
      mem.overdue.items = [{ installmentId: IDS.INST1, invoiceId: IDS.INV1, invoiceNumber: "FAC-1", learnerId: IDS.S1, dueDate: "2026-09-25", daysOverdue: 7, remaining: { amount: 50000, currency: "XOF" } }];
      unwrap(await runDunning(deps, sys())); // dunning_steps
      const countUnder = async (tenant: string, table: string): Promise<number> => {
        const client = await db.appPool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
          const res = await client.query(`SELECT count(*)::int AS n FROM notifications.${table}`);
          await client.query("ROLLBACK");
          return res.rows[0].n as number;
        } finally {
          client.release();
        }
      };
      for (const table of NOTIF_TABLES) {
        expect(await countUnder(tenantA, table), `A / ${table}`).toBeGreaterThan(0);
        expect(await countUnder(tenantB, table), `B / ${table}`).toBe(0);
      }
      // Cas d'usage : le tenant B ne lit ni journal, ni gabarits, ni règles, ni préférences de A.
      expect(unwrap(await listDeliveries(deps, sys(tenantB), { limit: 50 })).items).toEqual([]);
      expect(unwrap(await listRules(deps, sys(tenantB))).items.filter((r) => r.custom)).toEqual([]);
      expect(unwrap(await listTemplates(deps, sys(tenantB))).items.every((t) => t.source === "SHIPPED")).toBe(true);
      expect(unwrap(await getNotificationSettings(deps, sys(tenantB))).senderName).toBeNull();
    });

    it("un même événement dans deux tenants produit des remises séparées (clés d'idempotence par tenant)", async () => {
      await reset();
      const payload = ABSENCE(2);
      unwrap(await onDomainEvent(deps, sys(tenantA), { eventId: IDS.EVT(9001), eventType: "attendance.absence.recorded", payload }));
      unwrap(await onDomainEvent(deps, sys(tenantB), { eventId: IDS.EVT(9001), eventType: "attendance.absence.recorded", payload }));
      const n = await q<{ tenant_id: string; n: string }>("SELECT tenant_id, count(*)::text AS n FROM notifications.deliveries GROUP BY tenant_id");
      expect(n).toHaveLength(2);
      expect(n[0]!.n).toBe(n[1]!.n);
    });
  });

  // =========================================================================================================
  describe("événement -> règles -> journal -> envoi", () => {
    it("une absence : un message par tuteur, premier canal joignable, journal complet (écartés consignés avec leur raison)", async () => {
      await reset();
      const r = unwrap(await event("attendance.absence.recorded", ABSENCE(1)));
      expect(r).toMatchObject({ rules: 1, queued: 2, skipped: 2, ignored: null });
      const rows = await journal();
      expect(rows.map((x) => `${x.channel}:${x.status}:${x.skip_reason ?? ""}`).sort()).toEqual(["PUSH:SKIPPED:no_contact", "PUSH:SKIPPED:no_subscription", "WHATSAPP:PENDING:", "WHATSAPP:PENDING:"].sort());
      // Le tuteur sans compte est joint par téléphone ; le journal ne montre qu'un numéro masqué.
      for (const row of rows.filter((x) => x.channel === "WHATSAPP")) expect(row.recipient_masked).toMatch(/^\+225 \*\* \*\* \*\* \d\d$/);
      expect(rows.every((x) => x.template_code === "absence" && x.template_version === 0)).toBe(true);

      const report = await dispatchTenant(deps, tenantA);
      expect(report).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
      expect(ch.WHATSAPP.sent).toHaveLength(2);
      const msg = ch.WHATSAPP.sent[0]!;
      expect(msg.text).toContain("Awa Koné");
      expect(msg.text).toContain("02/10/2026");
      expect(msg.address).toMatch(/^\+225/);
      expect(msg.unsubscribeUrl).toContain("https://ecole.example.org/v2/notifications/unsubscribe?t=");
      const after = await journal("channel = 'WHATSAPP'");
      expect(after.every((x) => x.status === "SENT" && x.provider_id?.startsWith("WHATSAPP-"))).toBe(true);
      // Minimisation : adresse complète et contenu effacés une fois la remise terminale.
      const leaks = await q("SELECT id FROM notifications.deliveries WHERE status IN ('SENT','SKIPPED','FAILED','BOUNCED','CANCELLED') AND (recipient_address IS NOT NULL OR content IS NOT NULL)");
      expect(leaks).toEqual([]);
    });

    it("idempotence : le même événement rejoué ne double aucun envoi", async () => {
      await reset();
      const payload = ABSENCE(3);
      const first = unwrap(await onDomainEvent(deps, sys(), { eventId: IDS.EVT(9100), eventType: "attendance.absence.recorded", payload }));
      const replay = unwrap(await onDomainEvent(deps, sys(), { eventId: IDS.EVT(9100), eventType: "attendance.absence.recorded", payload }));
      expect(first.queued).toBe(2);
      expect(replay).toMatchObject({ queued: 0, skipped: 0 });
      // Un autre événement pour le MÊME fait source (même enregistrement d'appel) ne double pas non plus.
      const again = unwrap(await onDomainEvent(deps, sys(), { eventId: IDS.EVT(9101), eventType: "attendance.absence.recorded", payload }));
      expect(again.queued).toBe(0);
      expect((await journal()).length).toBe(4);
      await dispatchTenant(deps, tenantA);
      await dispatchTenant(deps, tenantA);
      expect(ch.WHATSAPP.sent).toHaveLength(2);
    });

    it("absence excusée, correction ou élève inconnu : aucune notification (bénin)", async () => {
      await reset();
      expect(unwrap(await event("attendance.absence.recorded", ABSENCE(4, { excused: true }))).ignored).toBe("excused");
      expect(unwrap(await event("attendance.absence.recorded", ABSENCE(5, { correction: true }))).ignored).toBe("correction");
      expect(unwrap(await event("attendance.absence.recorded", ABSENCE(6, { studentId: IDS.EVT(777) }))).ignored).toBe("student_unknown");
      expect(unwrap(await event("attendance.absence.recorded", "pas un objet")).ignored).toBe("payload_unreadable");
      expect(unwrap(await event("finance.invoice.overdue", { v: 1 })).ignored).toBe("payload_unreadable");
      expect(await journal()).toEqual([]);
    });

    it("paiement reçu : le responsable financier seul, en in-app (réel, via messaging), e-mail ; push ignoré sans abonnement", async () => {
      await reset();
      const r = unwrap(
        await event("finance.payment.completed", { v: 1, paymentId: IDS.EVT(55), learnerId: IDS.S1, enrollmentId: null, payerKind: "LEARNER", method: "CASH", amount: { amount: 25000, currency: "XOF" }, receiptId: IDS.EVT(56), receiptNumber: "REC-2026-7", allocations: [], unallocated: { amount: 0, currency: "XOF" }, provider: null, confirmedAt: clock.now().toISOString() }),
      );
      expect(r).toMatchObject({ rules: 1, queued: 2, skipped: 1 });
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent).toHaveLength(1);
      const mail = ch.EMAIL.sent[0]!;
      expect(mail.subject).toBe("Paiement reçu pour Awa Koné");
      expect(mail.text).toContain("25 000 F CFA");
      expect(mail.text).toContain("REC-2026-7");
      expect(mail.address).toBe("mariam.kone@famille.example.org");
      // Canal IN_APP réel : un message système est posé dans le fil d'alertes du tuteur.
      const sys1 = await q<{ body: string; system_code: string }>("SELECT body, system_code FROM messaging.messages WHERE system_code = 'notifications.payment_received'");
      expect(sys1).toHaveLength(1);
      expect(sys1[0]!.body).toContain("Paiement reçu pour Awa Koné");
      const inApp = await journal("channel = 'IN_APP'");
      expect(inApp[0]).toMatchObject({ status: "SENT", provider_id: expect.stringMatching(/^messaging:/) });
    });

    it("facture émise : montant et échéance typés ; facture d'un financeur ignorée", async () => {
      await reset();
      const payload = { v: 1, invoiceId: IDS.INV1, number: "FAC-2026-42", learnerId: IDS.S1, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026-2027", total: { amount: 150000, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null };
      unwrap(await event("finance.invoice.issued", payload));
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent[0]!.text).toContain("150 000 F CFA");
      expect(ch.EMAIL.sent[0]!.text).toContain("31/10/2026");
      expect(ch.EMAIL.sent[0]!.text).toContain("FAC-2026-42");
      expect(unwrap(await event("finance.invoice.issued", { ...payload, payerKind: "FUNDER" })).ignored).toBe("funder_invoice");
    });

    it("bulletin publié : parents (e-mail, in-app) et élève (in-app) ; cours annulé : classe entière, heure LOCALE", async () => {
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { timezone: "Europe/Paris" }));
      unwrap(await event("reportcards.report_card.published", { v: 1, reportCardId: IDS.EVT(60), studentId: IDS.S1, version: 1 }));
      const rows = await journal("template_code = 'report_card_published'");
      expect(rows.filter((x) => x.status === "PENDING").length).toBe(3); // parent A : in-app + e-mail ; élève : in-app (B sans compte ni e-mail : ignoré)
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { timezone: "Europe/Paris" }));
      unwrap(await event("scheduling.occurrence.cancelled", { v: 1, occurrenceId: IDS.EVT(61), kind: "LESSON", classroomId: IDS.C1, offeringId: null, curriculumNodeId: null, roomId: null, startsAt: "2026-10-05T06:00:00.000Z", endsAt: "2026-10-05T07:00:00.000Z", occursOn: "2026-10-05", status: "CANCELLED", staffIds: [] }));
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent.length).toBeGreaterThanOrEqual(2);
      expect(ch.EMAIL.sent[0]!.text).toContain("05/10/2026 à 08:00"); // 06:00 UTC = 08:00 à Paris (été)
      expect(ch.EMAIL.sent[0]!.text).toContain("6ème A");
      // Séance sans classe : aucune notification.
      expect(unwrap(await event("scheduling.occurrence.cancelled", { v: 1, occurrenceId: IDS.EVT(62), kind: "STAFF_MEETING", classroomId: null, offeringId: null, curriculumNodeId: null, roomId: null, startsAt: "2026-10-05T06:00:00.000Z", endsAt: "2026-10-05T07:00:00.000Z", occursOn: "2026-10-05", status: "CANCELLED", staffIds: [] })).ignored).toBe("no_classroom");
    });

    it("annonce : importante -> e-mail (destinataires figés par messaging) ; urgente -> tous canaux, même la nuit", async () => {
      await reset();
      mem.announcements.items.set(IDS.EVT(70), { title: "Réunion des parents", summary: "Samedi à 9 h.", priority: "HIGH", recipientUserIds: [IDS.guardianFinancial, IDS.studentUser] });
      mem.announcements.items.set(IDS.EVT(71), { title: "Fermeture exceptionnelle", summary: "Intempéries.", priority: "URGENT", recipientUserIds: [IDS.guardianFinancial] });
      unwrap(await event("messaging.announcement.published", { v: 1, announcementId: IDS.EVT(70), priority: "HIGH", authorId: IDS.admin, recipientCount: 2, requireAck: false }));
      unwrap(await event("messaging.announcement.published", { v: 1, announcementId: IDS.EVT(71), priority: "URGENT", authorId: IDS.admin, recipientCount: 1, requireAck: false }));
      clock.set("2026-10-02T23:30:00.000Z"); // en pleine nuit (heures calmes 20:00-07:00)
      await dispatchTenant(deps, tenantA);
      const urgentRows = await journal("urgent = true");
      expect(urgentRows.map((x) => x.channel).sort()).toEqual(["EMAIL", "PUSH", "SMS", "WHATSAPP"].sort());
      // L'urgence part tout de suite sur SMS et WhatsApp malgré les heures calmes ; push sans abonnement est ignoré.
      expect(urgentRows.find((x) => x.channel === "SMS")!.status).toBe("SENT");
      expect(urgentRows.find((x) => x.channel === "WHATSAPP")!.status).toBe("SENT");
      expect(urgentRows.find((x) => x.channel === "PUSH")!.status).toBe("SKIPPED");
      expect(ch.SMS.sent[0]!.text).toContain("Fermeture exceptionnelle");
      expect(ch.SMS.sent[0]!.urgent).toBe(true);
      // L'annonce « importante » n'est envoyée que par e-mail (et push) : jamais de SMS.
      const important = await journal("urgent = false AND template_code = 'announcement'");
      expect(important.map((x) => x.channel).sort()).toEqual(["EMAIL", "EMAIL", "PUSH", "PUSH"]);
    });
  });

  // =========================================================================================================
  describe("consentement, préférences et heures calmes", () => {
    it("opt-out WhatsApp : le canal est écarté (consigné) et le message part par le canal suivant (SMS)", async () => {
      await reset();
      unwrap(await updateMyNotificationPreferences(deps, user(IDS.guardianFinancial), { channels: [{ channel: "WHATSAPP", category: "*", enabled: false }] }));
      unwrap(await event("attendance.absence.recorded", ABSENCE(10)));
      const mine = (await journal()).filter((x) => x.subject_key === GUARDIAN_A.subjectKey);
      expect(mine.map((x) => `${x.channel}:${x.status}:${x.skip_reason ?? ""}`)).toEqual(expect.arrayContaining(["WHATSAPP:SKIPPED:consent_revoked", "SMS:PENDING:"]));
      // Le tuteur sans compte, lui, n'est pas concerné.
      expect((await journal()).filter((x) => x.subject_key === GUARDIAN_B.subjectKey && x.channel === "WHATSAPP")[0]!.status).toBe("PENDING");
      // Preuve de consentement.
      const log = unwrap(await getConsentLog(deps, admin(), { userId: IDS.guardianFinancial, limit: 10 }));
      expect(log.items[0]).toMatchObject({ channel: "WHATSAPP", category: "*", enabled: false, source: "SELF", actorUserId: IDS.guardianFinancial });
      expect(await q("SELECT 1 FROM kernel.domain_events WHERE type = 'notifications.consent.changed'")).not.toHaveLength(0);
    });

    it("désinscription par lien signé : coupe le canal, idempotente, refuse un jeton falsifié ou d'un autre tenant", async () => {
      await reset();
      const token = signUnsubscribeToken({ tenantId: tenantA, subjectKey: GUARDIAN_A.subjectKey, channel: "EMAIL" }, "secret-de-test");
      expect(unwrap(await applyUnsubscribe(deps, sys(), token))).toEqual({ channel: "EMAIL", applied: true });
      expect(unwrap(await applyUnsubscribe(deps, sys(), token))).toEqual({ channel: "EMAIL", applied: false });
      expectErr(await applyUnsubscribe(deps, sys(), token.slice(0, -3) + "AAA"), NotifCode.TOKEN_INVALID);
      expectErr(await applyUnsubscribe(deps, sys(tenantB), token), NotifCode.TOKEN_INVALID);
      unwrap(await event("finance.invoice.issued", { v: 1, invoiceId: IDS.INV1, number: "F-1", learnerId: IDS.S1, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 1000, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null }));
      const email = (await journal("channel = 'EMAIL'"))[0]!;
      expect(email).toMatchObject({ status: "SKIPPED", skip_reason: "consent_revoked" });
      const log = await q<{ source: string; enabled: boolean }>("SELECT source, enabled FROM notifications.consent_log WHERE tenant_id = $1", [tenantA]);
      expect(log).toEqual([{ source: "UNSUBSCRIBE_LINK", enabled: false }]);
    });

    it("modèle EXPLICIT : rien ne part sans accord ; l'accord enregistré par le personnel (preuve) débloque", async () => {
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { consentModels: { EMAIL: "EXPLICIT" } }));
      const payload = { v: 1, invoiceId: IDS.INV1, number: "F-1", learnerId: IDS.S1, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 1000, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null };
      unwrap(await event("finance.invoice.issued", payload));
      expect((await journal("channel = 'EMAIL'"))[0]).toMatchObject({ status: "SKIPPED", skip_reason: "consent_revoked" });
      unwrap(await setSubjectConsent(deps, admin(), { userId: IDS.guardianFinancial, channel: "EMAIL", category: "*", enabled: true, note: "demande reçue au guichet" }));
      unwrap(await event("finance.invoice.issued", { ...payload, invoiceId: IDS.INV2, number: "F-2" }));
      const rows = await journal("channel = 'EMAIL'");
      expect(rows.map((x) => x.status)).toEqual(["SKIPPED", "PENDING"]);
      const log = unwrap(await getConsentLog(deps, admin(), { userId: IDS.guardianFinancial, limit: 5 }));
      expect(log.items[0]).toMatchObject({ source: "ADMIN", enabled: true, actorUserId: IDS.admin });
      expect(audit.actions()).toContain("notifications.consent.set");
    });

    it("heures calmes : un SMS de nuit est REPORTÉ à 07:00 puis envoyé ; l'e-mail et l'in-app ne sont pas concernés", async () => {
      await reset();
      clock.set("2026-10-02T22:30:00.000Z");
      unwrap(await event("attendance.absence.recorded", ABSENCE(11)));
      // WhatsApp (premier canal joignable) est un canal intrusif : reporté.
      const rows = await journal("channel = 'WHATSAPP'");
      expect(rows.every((x) => x.status === "PENDING" && x.available_at.toISOString() === "2026-10-03T07:00:00.000Z")).toBe(true);
      await dispatchTenant(deps, tenantA);
      expect(ch.WHATSAPP.sent).toHaveLength(0);
      clock.set("2026-10-03T07:00:30.000Z");
      await dispatchTenant(deps, tenantA);
      expect(ch.WHATSAPP.sent).toHaveLength(2);
    });

    it("heures calmes personnelles : la surcharge de la personne l'emporte ; mises à jour relues à l'envoi", async () => {
      await reset();
      unwrap(await updateMyNotificationPreferences(deps, user(IDS.guardianFinancial), { quietHours: { enabled: false } }));
      clock.set("2026-10-02T22:30:00.000Z");
      unwrap(await event("attendance.absence.recorded", ABSENCE(12)));
      const mine = (await journal("channel = 'WHATSAPP'")).find((x) => x.subject_key === GUARDIAN_A.subjectKey)!;
      expect(mine.available_at.toISOString()).toBe("2026-10-02T22:30:00.000Z"); // pas de report pour cette personne
      const other = (await journal("channel = 'WHATSAPP'")).find((x) => x.subject_key === GUARDIAN_B.subjectKey)!;
      expect(other.available_at.toISOString()).toBe("2026-10-03T07:00:00.000Z");
      const prefs = unwrap(await getMyNotificationPreferences(deps, user(IDS.guardianFinancial)));
      expect(prefs.quietHours).toMatchObject({ enabled: false, inherited: false });
      expect(prefs.urgentBypassesQuietHours).toBe(true);
      // Revenir au réglage de l'établissement.
      expect(unwrap(await updateMyNotificationPreferences(deps, user(IDS.guardianFinancial), { quietHours: { inherit: true } })).quietHours.inherited).toBe(true);
    });

    it("le consentement est relu AU MOMENT de l'envoi (opt-out entre la mise en file et l'envoi)", async () => {
      await reset();
      unwrap(await event("attendance.absence.recorded", ABSENCE(13)));
      unwrap(await updateMyNotificationPreferences(deps, user(IDS.guardianFinancial), { channels: [{ channel: "WHATSAPP", category: "*", enabled: false }] }));
      await dispatchTenant(deps, tenantA);
      expect(ch.WHATSAPP.sent).toHaveLength(1); // seul le tuteur sans compte
      const skipped = (await journal("channel = 'WHATSAPP'")).find((x) => x.subject_key === GUARDIAN_A.subjectKey)!;
      expect(skipped).toMatchObject({ status: "SKIPPED", skip_reason: "consent_revoked" });
    });

    it("préférences : un canal indisponible est signalé, un changement identique n'écrit pas de preuve en double", async () => {
      await reset();
      const p = unwrap(await getMyNotificationPreferences(deps, user(IDS.guardianFinancial)));
      expect(p.channels.map((c) => c.channel)).toEqual(["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"]);
      expect(p.channels.every((c) => c.enabled && c.consentModel === "IMPLIED")).toBe(true);
      unwrap(await updateMyNotificationPreferences(deps, user(IDS.guardianFinancial), { channels: [{ channel: "SMS", category: "FINANCE", enabled: false }] }));
      unwrap(await updateMyNotificationPreferences(deps, user(IDS.guardianFinancial), { channels: [{ channel: "SMS", category: "FINANCE", enabled: false }] }));
      expect(await q("SELECT 1 FROM notifications.consent_log WHERE tenant_id = $1 AND category = 'FINANCE'", [tenantA])).toHaveLength(1);
      expect(unwrap(await getMyNotificationPreferences(deps, user(IDS.guardianFinancial))).channels.find((c) => c.channel === "SMS")!.categories).toEqual({ FINANCE: false });
    });
  });

  // =========================================================================================================
  describe("reprise, panne de canal, rebonds", () => {
    const oneInvoice = async () =>
      event("finance.invoice.issued", { v: 1, invoiceId: IDS.INV1, number: "F-1", learnerId: IDS.S2, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 1000, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null });

    it("panne passagère : reprise avec backoff exponentiel puis envoi ; au-delà de max_attempts : échec définitif + événement", async () => {
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { maxAttempts: 3 }));
      await oneInvoice();
      ch.EMAIL.script.push({ status: "RETRY", code: "smtp_450", message: "greylist" }, { status: "RETRY", code: "smtp_450", message: "greylist" });
      await dispatchTenant(deps, tenantA);
      let row = (await journal("channel = 'EMAIL'"))[0]!;
      expect(row).toMatchObject({ status: "PENDING", attempts: 1, last_error_code: "smtp_450" });
      expect(row.available_at.getTime() - clock.now().getTime()).toBe(60_000); // 1 min
      await dispatchTenant(deps, tenantA); // trop tôt : rien
      expect(ch.EMAIL.calls).toBe(1);
      clock.advance(60_001);
      await dispatchTenant(deps, tenantA);
      row = (await journal("channel = 'EMAIL'"))[0]!;
      expect(row).toMatchObject({ status: "PENDING", attempts: 2 });
      expect(row.available_at.getTime() - clock.now().getTime()).toBe(120_000); // 2 min
      clock.advance(120_001);
      await dispatchTenant(deps, tenantA); // 3e tentative : le script est vide -> succès
      expect((await journal("channel = 'EMAIL'"))[0]).toMatchObject({ status: "SENT", attempts: 3 });

      // Échec définitif après épuisement.
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { maxAttempts: 2 }));
      await oneInvoice();
      ch.EMAIL.script.push({ status: "RETRY", code: "smtp_unreachable", message: "x" }, { status: "RETRY", code: "smtp_unreachable", message: "x" });
      await dispatchTenant(deps, tenantA);
      clock.advance(60_001);
      await dispatchTenant(deps, tenantA);
      expect((await journal("channel = 'EMAIL'"))[0]).toMatchObject({ status: "FAILED", attempts: 2, last_error_code: "smtp_unreachable" });
      const failed = await q<{ payload: Record<string, unknown> }>("SELECT payload FROM kernel.domain_events WHERE type = 'notifications.delivery.failed'");
      expect(failed.at(-1)!.payload).toMatchObject({ v: 1, channel: "EMAIL", errorCode: "smtp_unreachable", attempts: 2 });
    });

    it("panne totale du canal (exception) : tout est repris dès le retour du canal, rien n'est perdu ni doublé", async () => {
      await reset();
      unwrap(await event("attendance.absence.recorded", ABSENCE(20)));
      ch.WHATSAPP.down = true;
      const down = await dispatchTenant(deps, tenantA);
      expect(down).toMatchObject({ claimed: 2, retried: 2, sent: 0 });
      const rows = await journal("channel = 'WHATSAPP'");
      expect(rows.every((x) => x.status === "PENDING" && x.last_error_code === "adapter_error")).toBe(true);
      // Le message d'erreur du fournisseur ne divulgue aucune adresse.
      const err = await q<{ last_error: string }>("SELECT last_error FROM notifications.deliveries WHERE channel = 'WHATSAPP' LIMIT 1");
      expect(err[0]!.last_error).not.toContain("awa.kone@famille.example.org");
      ch.WHATSAPP.down = false;
      clock.advance(61_000);
      const up = await dispatchTenant(deps, tenantA);
      expect(up).toMatchObject({ claimed: 2, sent: 2 });
      clock.advance(86_400_000);
      await dispatchTenant(deps, tenantA);
      expect(ch.WHATSAPP.sent).toHaveLength(2);
    });

    it("bail expiré (worker tué en cours d'envoi) : la remise est reprise ; un bail valide n'est pas volé", async () => {
      await reset();
      await oneInvoice();
      await q("UPDATE notifications.deliveries SET status = 'SENDING', attempts = 1, locked_until = $1 WHERE channel = 'EMAIL'", [new Date(clock.now().getTime() + 60_000)]);
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent).toHaveLength(0);
      clock.advance(61_000);
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent).toHaveLength(1);
      expect((await journal("channel = 'EMAIL'"))[0]).toMatchObject({ status: "SENT", attempts: 2 });
    });

    it("deux workers simultanés ne prennent jamais la même remise (SKIP LOCKED)", async () => {
      await reset();
      for (let i = 0; i < 6; i += 1) {
        unwrap(await event("finance.invoice.issued", { v: 1, invoiceId: IDS.EVT(800 + i), number: `F-${i}`, learnerId: IDS.S2, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 1000 + i, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null }));
      }
      await Promise.all([dispatchTenant(deps, tenantA), dispatchTenant(deps, tenantA), dispatchTenant(deps, tenantA)]);
      expect(ch.EMAIL.sent).toHaveLength(6);
      expect(new Set(ch.EMAIL.sent.map((m) => m.deliveryId)).size).toBe(6);
    });

    it("rebond définitif : remise BOUNCED, adresse en liste de suppression, plus aucun envoi (même urgent) ; événement publié", async () => {
      await reset();
      await oneInvoice();
      ch.EMAIL.script.push({ status: "BOUNCED", code: "smtp_550", message: "User unknown" });
      await dispatchTenant(deps, tenantA);
      expect((await journal("channel = 'EMAIL'"))[0]).toMatchObject({ status: "BOUNCED", last_error_code: "smtp_550" });
      const sup = await q<{ address_masked: string; reason: string }>("SELECT address_masked, reason FROM notifications.suppressions");
      expect(sup).toEqual([{ address_masked: "m***@famille.example.org", reason: "HARD_BOUNCE" }]);
      expect(await q("SELECT 1 FROM kernel.domain_events WHERE type = 'notifications.delivery.bounced'")).not.toHaveLength(0);
      // Nouvelle notification : écartée, même en urgence.
      unwrap(await event("finance.invoice.issued", { v: 1, invoiceId: IDS.INV2, number: "F-2", learnerId: IDS.S2, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 1, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null }));
      const rows = await journal("channel = 'EMAIL'");
      expect(rows.map((x) => `${x.status}:${x.skip_reason ?? ""}`)).toEqual(["BOUNCED:", "SKIPPED:suppressed"]);
    });

    it("accusés différés signés (rebond tardif, remise confirmée) : statut mis à jour, suppression par empreinte", async () => {
      await reset();
      await oneInvoice();
      ch.EMAIL.script.push({ status: "SENT", providerId: "msg-777" });
      await dispatchTenant(deps, tenantA);
      expect(unwrap(await applyDeliveryStatusWebhook(deps, sys(), { providerId: "msg-777", status: "DELIVERED" }))).toEqual({ matched: 1 });
      expect((await journal("channel = 'EMAIL'"))[0]!.status).toBe("DELIVERED");
      expect(unwrap(await applyDeliveryStatusWebhook(deps, sys(), { providerId: "inconnu", status: "DELIVERED" }))).toEqual({ matched: 0 });
      expect(unwrap(await applyDeliveryStatusWebhook(deps, sys(), { providerId: "msg-777", status: "BOUNCED", reason: "mailbox disabled" }))).toEqual({ matched: 1 });
      expect((await journal("channel = 'EMAIL'"))[0]).toMatchObject({ status: "BOUNCED", last_error_code: "hard_bounce" });
      expect(await q("SELECT 1 FROM notifications.suppressions WHERE reason = 'HARD_BOUNCE'")).toHaveLength(1);
      expect(unwrap(await applyDeliveryStatusWebhook(deps, sys(tenantB), { providerId: "msg-777", status: "BOUNCED" }))).toEqual({ matched: 0 });
    });

    it("canal désactivé par l'établissement après la mise en file : la remise est ignorée à l'envoi", async () => {
      await reset();
      await oneInvoice();
      unwrap(await updateNotificationSettings(deps, admin(), { enabledChannels: ["IN_APP", "PUSH"] }));
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent).toHaveLength(0);
      expect((await journal("channel = 'EMAIL'"))[0]).toMatchObject({ status: "SKIPPED", skip_reason: "channel_disabled" });
    });

    it("canal non configuré (adaptateur réel du registre) : échec EXPLICITE, jamais une simulation silencieuse", async () => {
      await reset();
      const { createChannelRegistry } = await import("../../infrastructure/channels/registry");
      const strict = createNotificationsDeps({
        db: db.tenantDb,
        clock,
        ports: mem.ports,
        channels: (d) => createChannelRegistry(d, { env: {} }),
        config: { appBaseUrl: "https://ecole.example.org", production: true, simulate: true },
      });
      expect(strict.channels.simulation).toBe(false); // la simulation est refusée en production
      unwrap(await onDomainEvent(strict, sys(), { eventId: IDS.EVT(9500), eventType: "finance.invoice.issued", payload: { v: 1, invoiceId: IDS.INV3, number: "F-3", learnerId: IDS.S2, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 1, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null } }));
      const report = await dispatchTenant(strict, tenantA);
      expect(report.failed).toBeGreaterThanOrEqual(1);
      const email = (await journal("channel = 'EMAIL'"))[0]!;
      expect(email).toMatchObject({ status: "FAILED", last_error_code: "channel_not_configured" });
      // Hors production, la simulation n'existe que si elle est DEMANDÉE ; elle est alors consignée comme telle.
      await reset();
      const sim = createNotificationsDeps({ db: db.tenantDb, clock, ports: mem.ports, channels: (d) => createChannelRegistry(d, { env: {} }), config: { appBaseUrl: "https://ecole.example.org", simulate: true } });
      expect(sim.channels.simulation).toBe(true);
      unwrap(await onDomainEvent(sim, sys(), { eventId: IDS.EVT(9501), eventType: "finance.invoice.issued", payload: { v: 1, invoiceId: IDS.INV3, number: "F-3", learnerId: IDS.S2, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 1, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null } }));
      await dispatchTenant(sim, tenantA);
      expect((await journal("channel = 'EMAIL'"))[0]).toMatchObject({ status: "SIMULATED" });
    });
  });

  // =========================================================================================================
  describe("relances d'impayés", () => {
    const inst = (id: string, days: number, over: Record<string, unknown> = {}) => ({ installmentId: id, invoiceId: IDS.INV1, invoiceNumber: "FAC-2026-1", learnerId: IDS.S1, dueDate: "2026-09-01", daysOverdue: days, remaining: { amount: 75000, currency: "XOF" }, ...over });

    it("paliers J+3 / J+10 / J+30 : un message par palier atteint, jamais deux fois le même, même job rejoué", async () => {
      await reset();
      mem.overdue.items = [inst(IDS.INST1, 2)];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 0 }); // palier non atteint : la source ne remonte même pas l'échéance
      mem.overdue.items = [inst(IDS.INST1, 3)];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 1 });
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 0 }); // rejoué : rien
      mem.overdue.items = [inst(IDS.INST1, 4)];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 0 }); // même palier
      mem.overdue.items = [inst(IDS.INST1, 12)];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 1 }); // palier 10
      mem.overdue.items = [inst(IDS.INST1, 45)];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 1 }); // palier 30
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 0 });
      const stages = await q<{ stage_days: number; notified: boolean }>("SELECT stage_days, notified FROM notifications.dunning_steps ORDER BY stage_days");
      expect(stages).toEqual([{ stage_days: 3, notified: true }, { stage_days: 10, notified: true }, { stage_days: 30, notified: true }]);
      const rows = await journal("source_kind = 'DUNNING' AND channel = 'EMAIL'");
      expect(rows).toHaveLength(3); // un e-mail par palier (le responsable financier est seul visé)
    });

    it("un job en retard d'une semaine n'envoie QUE le palier le plus récent ; les paliers rattrapés sont consignés sans envoi", async () => {
      await reset();
      mem.overdue.items = [inst(IDS.INST2, 12)];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 1 });
      expect((await journal("source_kind = 'DUNNING' AND channel = 'EMAIL'")).length).toBe(1);
      const stages = await q<{ stage_days: number; notified: boolean }>("SELECT stage_days, notified FROM notifications.dunning_steps ORDER BY stage_days");
      expect(stages).toEqual([{ stage_days: 3, notified: false }, { stage_days: 10, notified: true }]);
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent[0]!.text).toContain("12 jours de retard");
      expect(ch.EMAIL.sent[0]!.text).toContain("75 000 F CFA");
      expect(ch.EMAIL.sent[0]!.text).toContain("FAC-2026-1");
    });

    it("arrêt dès paiement : l'échéance soldée entre la mise en file et l'envoi est ANNULÉE (relue à l'envoi)", async () => {
      await reset();
      mem.overdue.items = [inst(IDS.INST1, 5)];
      unwrap(await runDunning(deps, sys()));
      mem.overdue.settled.add(IDS.INST1);
      const report = await dispatchTenant(deps, tenantA);
      expect(report.cancelled).toBeGreaterThanOrEqual(1);
      expect(ch.EMAIL.sent).toHaveLength(0);
      expect(ch.WHATSAPP.sent).toHaveLength(0);
      const rows = await journal("source_kind = 'DUNNING' AND status = 'CANCELLED'");
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((x) => x.skip_reason === "paid")).toBe(true);
      // Plus aucune relance pour une échéance soldée.
      mem.overdue.items = [inst(IDS.INST1, 40)];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ examined: 0, notified: 0 });
    });

    it("facture soldée (finance.invoice.paid) : les relances EN ATTENTE de la facture sont annulées ; celles d'une autre facture restent", async () => {
      await reset();
      mem.overdue.items = [inst(IDS.INST1, 5), inst(IDS.INST3, 5, { invoiceId: IDS.INV2 })];
      unwrap(await runDunning(deps, sys()));
      const before = (await journal("status = 'PENDING' AND source_kind = 'DUNNING'")).length;
      expect(unwrap(await onInvoicePaid(deps, sys(), { payload: { v: 1, invoiceId: IDS.INV1, number: "F", learnerId: IDS.S1, total: { amount: 1, currency: "XOF" } } })).cancelled).toBeGreaterThan(0);
      const after = (await journal("status = 'PENDING' AND source_kind = 'DUNNING'")).length;
      expect(after).toBe(before / 2);
      expect(unwrap(await onInvoicePaid(deps, sys(), { payload: { rien: true } })).cancelled).toBe(0);
    });

    it("famille injoignable : le palier n'est pas consommé (nouvel essai à la prochaine passe)", async () => {
      await reset();
      mem.overdue.items = [inst(IDS.INST1, 5, { learnerId: IDS.EVT(990) })];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ unreachable: 1, notified: 0 });
      expect(await q("SELECT 1 FROM notifications.dunning_steps")).toHaveLength(0);
    });

    it("paliers configurables par l'établissement ; règle désactivée : aucune relance", async () => {
      await reset();
      const rule = unwrap(await listRules(deps, sys())).items.find((r) => r.key === "dunning.default")!;
      unwrap(await saveRule(deps, admin(), "dunning.default", { enabled: true, templateCode: rule.templateCode, audience: rule.audience, channels: ["EMAIL"], strategy: "ALL", urgent: false, conditions: { stages: [1, 7] } }));
      mem.overdue.items = [inst(IDS.INST1, 1)];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 1 });
      expect((await q<{ stage_days: number }>("SELECT stage_days FROM notifications.dunning_steps")).map((x) => x.stage_days)).toEqual([1]);
      unwrap(await saveRule(deps, admin(), "dunning.default", { enabled: false, templateCode: rule.templateCode, audience: rule.audience, channels: ["EMAIL"], strategy: "ALL", urgent: false, conditions: { stages: [1, 7] } }));
      mem.overdue.items = [inst(IDS.INST1, 9)];
      expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ examined: 0 });
    });
  });

  // =========================================================================================================
  describe("alertes intelligentes", () => {
    it("retard de paiement >= 15 j -> économat : une alerte par échéance, jamais deux fois", async () => {
      await reset();
      mem.overdue.items = [
        { installmentId: IDS.INST1, invoiceId: IDS.INV1, invoiceNumber: "FAC-1", learnerId: IDS.S1, dueDate: "2026-09-10", daysOverdue: 22, remaining: { amount: 60000, currency: "XOF" } },
        { installmentId: IDS.INST2, invoiceId: IDS.INV2, invoiceNumber: "FAC-2", learnerId: IDS.S2, dueDate: "2026-09-25", daysOverdue: 7, remaining: { amount: 10000, currency: "XOF" } },
      ];
      expect(unwrap(await evaluateAlerts(deps, sys())).overdue).toBe(2); // IN_APP + EMAIL de l'économe pour UNE échéance
      expect(unwrap(await evaluateAlerts(deps, sys())).overdue).toBe(0);
      await dispatchTenant(deps, tenantA);
      const mail = ch.EMAIL.sent.find((m) => m.address === ECONOME_R.email)!;
      expect(mail.text).toContain("Awa Koné");
      expect(mail.text).toContain("22 jours de retard");
    });

    it("baisse de résultats FINAL >= seuil -> enseignants de la classe ; règle activée par l'établissement, seuil configurable", async () => {
      await reset();
      mem.grades.pairs = [
        { studentId: IDS.S1, studentName: "Awa Koné", classroomId: IDS.C1, className: "6ème A", previousPeriodId: IDS.EVT(1), currentPeriodId: IDS.EVT(2), previous: "14.50", current: "10.00" },
        { studentId: IDS.S2, studentName: "Moussa Koné", classroomId: IDS.C1, className: "6ème A", previousPeriodId: IDS.EVT(1), currentPeriodId: IDS.EVT(2), previous: "12", current: "11" },
      ];
      expect(unwrap(await evaluateAlerts(deps, sys())).gradeDrops).toBe(0); // règle désactivée par défaut
      const shipped = unwrap(await listRules(deps, sys())).items.find((r) => r.key === "alert.grade_drop.teachers")!;
      unwrap(await saveRule(deps, admin(), shipped.key, { enabled: true, templateCode: shipped.templateCode, audience: shipped.audience, channels: ["EMAIL"], strategy: "ALL", urgent: false, conditions: { minDrop: 4 } }));
      expect(unwrap(await evaluateAlerts(deps, sys())).gradeDrops).toBe(1);
      expect(unwrap(await evaluateAlerts(deps, sys())).gradeDrops).toBe(0);
      await dispatchTenant(deps, tenantA);
      const mail = ch.EMAIL.sent.find((m) => m.address === TEACHER_R.email)!;
      expect(mail.text).toContain("14,5");
      expect(mail.text).toContain("10");
      expect(mail.text).toContain("4"); // écart
    });

    it("charge d'enseignement > seuil -> administration, une fois par mois", async () => {
      await reset();
      mem.teachingLoad.loads = [{ staffId: IDS.STAFF1, staffName: "M. Diallo", plannedHours: 900 }, { staffId: IDS.EVT(5), staffName: "Mme Bamba", plannedHours: 700 }];
      expect(unwrap(await evaluateAlerts(deps, sys())).teachingLoad).toBe(2);
      expect(unwrap(await evaluateAlerts(deps, sys())).teachingLoad).toBe(0);
      clock.set("2026-11-03T09:00:00.000Z");
      expect(unwrap(await evaluateAlerts(deps, sys())).teachingLoad).toBe(2); // nouveau mois : nouvelle alerte
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent.find((m) => m.address === ACADEMIC_R.email)!.text).toContain("M. Diallo");
    });

    it("document expirant -> l'intéressé et les ressources humaines ; alerte d'absences -> parents (seuil de la règle)", async () => {
      await reset();
      unwrap(await event("people.staff_qualification.expiring", { v: 1, staffId: IDS.STAFF1, qualificationId: IDS.EVT(30), expiresOn: "2026-11-01", daysLeft: 30 }));
      const rows = await journal("template_code = 'document_expiring'");
      expect(new Set(rows.map((x) => x.subject_key))).toEqual(new Set([TEACHER_R.subjectKey, HR_R.subjectKey]));
      expect(unwrap(await event("people.staff_qualification.expiring", { v: 1, staffId: IDS.STAFF1, qualificationId: IDS.EVT(31), expiresOn: "2027-01-01", daysLeft: 90 })).queued).toBe(0); // préavis 30 j
      await reset();
      expect(unwrap(await event("attendance.alert.triggered", { v: 1, ruleCode: "abs3", metric: "ABSENT_COUNT", threshold: 3, value: 2, enrollmentId: IDS.EVT(1), studentId: IDS.S1, periodId: IDS.EVT(2) })).queued).toBe(0); // sous le seuil de la règle (3)
      expect(unwrap(await event("attendance.alert.triggered", { v: 1, ruleCode: "abs3", metric: "ABSENT_COUNT", threshold: 3, value: 5, enrollmentId: IDS.EVT(1), studentId: IDS.S1, periodId: IDS.EVT(2) })).queued).toBe(2);
      await dispatchTenant(deps, tenantA);
      expect(ch.WHATSAPP.sent[0]!.text).toContain("5 absences");
    });

    it("bulletin de paie disponible : notifie son titulaire (compte résolu par la paie)", async () => {
      await reset();
      unwrap(await event("payroll.payslip.notification_requested", { v: 1, payslipId: IDS.EVT(40), periodId: IDS.EVT(41), staffId: IDS.STAFF1, recipientUserId: IDS.holder, amount: 250000, currency: "XOF" }));
      expect((await journal("template_code = 'payslip_available' AND status = 'PENDING'")).length).toBe(2); // in-app + e-mail
      expect(unwrap(await event("payroll.payslip.notification_requested", { v: 1, payslipId: IDS.EVT(42), periodId: IDS.EVT(41), staffId: IDS.STAFF1, recipientUserId: null, amount: 1, currency: "XOF" })).ignored).toBe("no_account");
    });

    it("un port d'alerte indisponible n'arrête pas les autres alertes ; l'erreur est rapportée", async () => {
      await reset();
      mem.teachingLoad.loads = [{ staffId: IDS.STAFF1, staffName: "M. Diallo", plannedHours: 900 }];
      const broken = createNotificationsDeps({ db: db.tenantDb, clock, ports: { ...mem.ports, overdue: { listOverdueInstallments: async () => { throw new Error("finance indisponible"); }, isInstallmentStillOverdue: async () => true } }, channels: deps.channels });
      const r = unwrap(await evaluateAlerts(broken, sys()));
      expect(r.errors.join(" ")).toContain("finance indisponible");
      expect(r.teachingLoad).toBe(2);
    });
  });

  // =========================================================================================================
  describe("règles configurables", () => {
    it("désactiver une règle livrée supprime ses notifications ; la remise aux valeurs livrées les rétablit", async () => {
      await reset();
      const shipped = unwrap(await listRules(deps, sys())).items.find((r) => r.key === "attendance.absence")!;
      expect(shipped.source).toBe("SHIPPED");
      const saved = unwrap(await saveRule(deps, admin(), shipped.key, { enabled: false, templateCode: shipped.templateCode, audience: shipped.audience, channels: shipped.channels, strategy: shipped.strategy, urgent: false, conditions: {} }));
      expect(saved).toMatchObject({ source: "TENANT", enabled: false });
      expect(unwrap(await event("attendance.absence.recorded", ABSENCE(50))).ignored).toBe("no_rule");
      expect(unwrap(await resetRule(deps, admin(), shipped.key))).toMatchObject({ source: "SHIPPED", enabled: true });
      expect(unwrap(await event("attendance.absence.recorded", ABSENCE(51))).queued).toBe(2);
      expect(audit.actions()).toEqual(expect.arrayContaining(["notifications.rule.update", "notifications.rule.reset"]));
      expect(await q("SELECT 1 FROM kernel.domain_events WHERE type = 'notifications.rule.updated'")).not.toHaveLength(0);
    });

    it("qui est notifié et par quel canal : audience et canaux d'une règle modifiés (parents -> élève, SMS seul)", async () => {
      await reset();
      const shipped = unwrap(await listRules(deps, sys())).items.find((r) => r.key === "attendance.absence")!;
      unwrap(await saveRule(deps, admin(), shipped.key, { enabled: true, templateCode: "absence", audience: { kind: "STUDENT" }, channels: ["SMS", "EMAIL"], strategy: "ALL", urgent: false, conditions: {} }));
      unwrap(await event("attendance.absence.recorded", ABSENCE(52)));
      const rows = await journal();
      expect(new Set(rows.map((x) => x.subject_key))).toEqual(new Set(["user:" + IDS.studentUser]));
      expect(rows.map((x) => `${x.channel}:${x.skip_reason ?? x.status}`).sort()).toEqual(["EMAIL:PENDING", "SMS:no_contact"]);
    });

    it("règle personnalisée : créée, validée (variables fournies par le déclencheur), supprimée ; une règle invalide est refusée", async () => {
      await reset();
      const body = { enabled: true, trigger: "attendance.late.recorded", templateCode: "late" as const, audience: { kind: "STUDENT_GUARDIANS" as const, financialFirst: false, fallbackToStudent: false }, channels: ["EMAIL" as const], strategy: "ALL" as const, urgent: false, conditions: {} };
      unwrap(await saveRule(deps, admin(), "custom.retards", { ...body, label: "Retards par e-mail" }));
      expect(unwrap(await listRules(deps, sys())).items.find((r) => r.key === "custom.retards")).toMatchObject({ custom: true, kind: "EVENT", trigger: "attendance.late.recorded" });
      unwrap(await event("attendance.late.recorded", { v: 1, sessionId: IDS.EVT(1), recordId: IDS.EVT(2), enrollmentId: IDS.EVT(3), studentId: IDS.S1, classroomId: IDS.C1, date: "2026-10-02", occurrenceId: null, statusCode: "LATE", excused: false, minutesLate: 12, correction: false }));
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent.map((m) => m.text).join(" ")).toContain("12 minutes");
      expectErr(await saveRule(deps, admin(), "custom.mauvais", { ...body, templateCode: "payment_received" }), NotifCode.RULE_INVALID); // exige `amount`
      expectErr(await saveRule(deps, admin(), "retards", body), NotifCode.RULE_INVALID); // clé non personnalisée
      expectErr(await saveRule(deps, admin(), "custom.sans", { ...body, trigger: undefined }), NotifCode.RULE_INVALID);
      expectErr(await saveRule(deps, admin(), "custom.alerte", { ...body, trigger: "inconnu.evt.fait" }), NotifCode.RULE_INVALID);
      expect(unwrap(await resetRule(deps, admin(), "custom.retards"))).toBeNull();
      expectErr(await resetRule(deps, admin(), "custom.retards"), NotifCode.RULE_NOT_FOUND);
    });
  });

  // =========================================================================================================
  describe("gabarits versionnés par établissement", () => {
    it("version propre, aperçu, version figée dans le journal, retour arrière, retour au gabarit livré", async () => {
      await reset();
      const v1 = unwrap(await publishTemplateVersion(deps, admin(), { code: "absence", channel: "WHATSAPP", locale: "fr-CI", body: "V1 — {{studentName}} absent(e) le {{date}}.", note: "première version" }));
      expect(v1.version).toBe(1);
      const listed = unwrap(await listTemplates(deps, admin())).items.find((t) => t.code === "absence" && t.channel === "WHATSAPP")!;
      expect(listed).toMatchObject({ source: "TENANT", version: 1, subject: null });
      unwrap(await event("attendance.absence.recorded", ABSENCE(60)));
      expect((await journal("channel = 'WHATSAPP'")).every((x) => x.template_version === 1)).toBe(true);
      await dispatchTenant(deps, tenantA);
      expect(ch.WHATSAPP.sent[0]!.text).toBe("V1 — Awa Koné absent(e) le 02/10/2026.");

      const v2 = unwrap(await publishTemplateVersion(deps, admin(), { code: "absence", channel: "WHATSAPP", locale: "fr-CI", body: "V2 — {{studentName}}, {{date}}." }));
      expect(v2.version).toBe(2);
      unwrap(await event("attendance.absence.recorded", ABSENCE(61)));
      expect((await journal("channel = 'WHATSAPP' AND template_version = 2")).length).toBe(2);
      const versions = unwrap(await listTemplateVersions(deps, admin(), { code: "absence", channel: "WHATSAPP" })).items;
      expect(versions.map((v) => `${v.version}:${v.active}`)).toEqual(["2:true", "1:false"]);
      unwrap(await activateTemplateVersion(deps, admin(), { code: "absence", channel: "WHATSAPP", locale: "fr-CI", version: 1 }));
      unwrap(await event("attendance.absence.recorded", ABSENCE(62)));
      expect((await journal("channel = 'WHATSAPP' AND template_version = 1")).length).toBe(4);
      unwrap(await activateTemplateVersion(deps, admin(), { code: "absence", channel: "WHATSAPP", locale: "fr-CI", version: 0 }));
      unwrap(await event("attendance.absence.recorded", ABSENCE(63)));
      expect((await journal("channel = 'WHATSAPP' AND template_version = 0")).length).toBe(2);
      expectErr(await activateTemplateVersion(deps, admin(), { code: "absence", channel: "WHATSAPP", locale: "fr-CI", version: 9 }), NotifCode.VERSION_NOT_FOUND);
      expect(await q("SELECT 1 FROM kernel.domain_events WHERE type = 'notifications.template.published'")).not.toHaveLength(0);
    });

    it("variables validées : variable inconnue, balise mal formée, objet manquant ou en trop sont refusés", async () => {
      await reset();
      const unknown = expectErr(await publishTemplateVersion(deps, admin(), { code: "absence", channel: "SMS", locale: "fr-CI", body: "Bonjour {{parent}}" }), NotifCode.TEMPLATE_VARIABLE_UNKNOWN);
      expect(unknown.details).toMatchObject({ variables: ["parent"] });
      expectErr(await publishTemplateVersion(deps, admin(), { code: "absence", channel: "SMS", locale: "fr-CI", body: "{{#studentName}}ouvert" }), NotifCode.TEMPLATE_INVALID);
      expectErr(await publishTemplateVersion(deps, admin(), { code: "absence", channel: "EMAIL", locale: "fr-CI", body: "sans objet {{studentName}}" }), NotifCode.TEMPLATE_INVALID);
      expectErr(await publishTemplateVersion(deps, admin(), { code: "absence", channel: "SMS", locale: "fr-CI", subject: "objet", body: "x" }), NotifCode.TEMPLATE_INVALID);
      expect(await q("SELECT 1 FROM notifications.template_versions")).toHaveLength(0);
    });

    it("aperçu : texte, HTML d'e-mail échappé avec pied de page de conformité, segments SMS, brouillon sans enregistrement", async () => {
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { senderName: "Les Palmiers", legalFooter: "RCCM CI-ABJ-2020-B-1" }));
      const mail = unwrap(await previewTemplate(deps, admin(), { code: "invoice_issued", channel: "EMAIL", locale: "fr-CI" }));
      expect(mail.subject).toContain("Nouvelle facture");
      expect(mail.text).toContain("150 000 F CFA");
      expect(mail.html).toContain("Se désinscrire");
      expect(mail.html).toContain("RCCM CI-ABJ-2020-B-1");
      expect(mail.html).toContain("Les Palmiers");
      const draft = unwrap(await previewTemplate(deps, admin(), { code: "absence", channel: "SMS", locale: "fr-CI", body: "<b>{{studentName}}</b> ".repeat(20), variables: { studentName: "Awa <script>" } }));
      expect(draft.segments).toBeGreaterThan(1);
      expect(draft.warnings.join(" ")).toContain("segments");
      expect(await q("SELECT 1 FROM notifications.template_versions")).toHaveLength(0);
      const bad = unwrap(await previewTemplate(deps, admin(), { code: "absence", channel: "SMS", locale: "fr-CI", variables: { studentName: 12 } }));
      expect(bad.warnings.join(" ")).toContain("studentName");
    });

    it("gabarit désactivé : plus de remise sur ce canal (consignée) ; réactivé : le canal repart", async () => {
      await reset();
      unwrap(await setTemplateEnabled(deps, admin(), { code: "absence", channel: "WHATSAPP", locale: "fr-CI", enabled: false }));
      unwrap(await event("attendance.absence.recorded", ABSENCE(70)));
      const rows = await journal("subject_key = $1", [GUARDIAN_A.subjectKey]);
      expect(rows.map((x) => `${x.channel}:${x.status}:${x.skip_reason ?? ""}`)).toEqual(expect.arrayContaining(["WHATSAPP:SKIPPED:channel_disabled", "SMS:PENDING:"]));
      unwrap(await setTemplateEnabled(deps, admin(), { code: "absence", channel: "WHATSAPP", locale: "fr-CI", enabled: true }));
      unwrap(await event("attendance.absence.recorded", ABSENCE(71)));
      expect((await journal("channel = 'WHATSAPP' AND status = 'PENDING'")).length).toBe(2);
    });
  });

  // =========================================================================================================
  describe("envoi manuel : convocation, annonce, urgence", () => {
    const convocation = (extra: Record<string, unknown> = {}) => ({
      templateCode: "convocation" as const,
      audience: { kind: "STUDENT_GUARDIANS" as const, studentIds: [IDS.S1], financialFirst: false },
      variables: { subject: "Entretien avec la direction", date: "2026-10-09", time: "09:30", place: "Bureau de la direction", note: "Merci de vous munir du carnet." },
      channels: ["EMAIL" as const, "WHATSAPP" as const],
      strategy: "ALL" as const,
      urgent: false,
      ...extra,
    });

    it("convocation aux tuteurs d'un élève : variables typées, nom de l'élève injecté, idempotence par clé client", async () => {
      await reset();
      const r = unwrap(await sendManualNotification(deps, admin(), { ...convocation(), clientKey: "convocation-0001" }, { urgent: false }));
      expect(r).toMatchObject({ recipients: 2, deliveries: 3, reused: false }); // A : e-mail + WhatsApp ; B : WhatsApp (pas d'e-mail)
      const again = unwrap(await sendManualNotification(deps, admin(), { ...convocation(), clientKey: "convocation-0001" }, { urgent: false }));
      expect(again).toMatchObject({ deliveries: 0, reused: true });
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent[0]!.text).toContain("Entretien avec la direction");
      expect(ch.EMAIL.sent[0]!.text).toContain("09/10/2026 à 09:30");
      expect(ch.EMAIL.sent[0]!.text).toContain("Élève concerné : Awa Koné");
      expect(ch.EMAIL.sent[0]!.text).toContain("carnet");
      expect(audit.actions()).toContain("notifications.send");
    });

    it("variable manquante ou mal typée : refus AVANT toute mise en file ; gabarit non manuel refusé ; trop de destinataires refusé", async () => {
      await reset();
      expectErr(await sendManualNotification(deps, admin(), convocation({ variables: { subject: "x" } }), { urgent: false }), NotifCode.TEMPLATE_VARIABLE_INVALID);
      expectErr(await sendManualNotification(deps, admin(), convocation({ variables: { subject: "x", date: "demain", time: "9h", place: "ici" } }), { urgent: false }), NotifCode.TEMPLATE_VARIABLE_INVALID);
      expectErr(await sendManualNotification(deps, admin(), { ...convocation(), templateCode: "absence" }, { urgent: false }), NotifCode.INVALID_INPUT);
      expectErr(await sendManualNotification(deps, admin(), convocation({ audience: { kind: "STUDENT_GUARDIANS", studentIds: [IDS.EVT(1)], financialFirst: false } }), { urgent: false }), NotifCode.RECIPIENT_NOT_FOUND);
      expect(await journal()).toEqual([]);
    });

    it("avis urgent : exige l'autorisation spécifique ; contourne heures calmes et refus de catégorie ; audité et publié ; jamais la suppression", async () => {
      await reset();
      const notice = { templateCode: "urgent_notice" as const, audience: { kind: "USERS" as const, userIds: [IDS.guardianFinancial] }, variables: { title: "Fermeture", message: "L'école est fermée demain." }, channels: ["SMS" as const, "EMAIL" as const], strategy: "ALL" as const, urgent: false };
      expectErr(await sendManualNotification(deps, admin(), notice, { urgent: false }), NotifCode.FORBIDDEN);
      unwrap(await updateMyNotificationPreferences(deps, user(IDS.guardianFinancial), { channels: [{ channel: "SMS", category: "URGENT", enabled: false }] }));
      clock.set("2026-10-02T23:00:00.000Z");
      const r = unwrap(await sendManualNotification(deps, admin(), notice, { urgent: true }));
      expect(r).toMatchObject({ recipients: 1, deliveries: 2 });
      const rows = await journal("urgent = true");
      expect(rows.map((x) => `${x.channel}:${x.status}`).sort()).toEqual(["EMAIL:PENDING", "SMS:PENDING"]);
      expect(rows.find((x) => x.channel === "SMS")!.available_at.toISOString()).toBe(clock.now().toISOString());
      await dispatchTenant(deps, tenantA);
      expect(ch.SMS.sent[0]!.text).toContain("URGENT");
      expect(audit.entries.find((e) => e.action === "notifications.urgent.send")).toMatchObject({ severity: "warning" });
      expect(await q("SELECT 1 FROM kernel.domain_events WHERE type = 'notifications.urgent.sent'")).not.toHaveLength(0);
    });

    it("audience par classe et par rôle ; plafond de destinataires", async () => {
      await reset();
      const klass = unwrap(await sendManualNotification(deps, admin(), { templateCode: "announcement", audience: { kind: "CLASSROOM", classroomIds: [IDS.C1], include: ["GUARDIANS", "TEACHERS"] }, variables: { title: "Sortie scolaire" }, channels: ["EMAIL"], strategy: "ALL", urgent: false }, { urgent: false }));
      expect(klass.recipients).toBe(3);
      const roles = unwrap(await sendManualNotification(deps, admin(), { templateCode: "announcement", audience: { kind: "ROLES", roleKeys: ["econome"] }, variables: { title: "Clôture de caisse" }, channels: ["EMAIL"], strategy: "ALL", urgent: false }, { urgent: false }));
      expect(roles.recipients).toBe(1);
    });
  });

  // =========================================================================================================
  describe("plafonds anti-abus", () => {
    it("plafond journalier par canal : l'excédent attend (jamais perdu) ; plafond par destinataire ; file maximale", async () => {
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { dailyCaps: { EMAIL: 2 } }));
      for (let i = 0; i < 5; i += 1) {
        unwrap(await event("finance.invoice.issued", { v: 1, invoiceId: IDS.EVT(1000 + i), number: `F-${i}`, learnerId: IDS.S2, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 100 + i, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null }));
      }
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent).toHaveLength(2);
      expect((await journal("channel = 'EMAIL' AND status = 'PENDING'")).length).toBe(3);
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent).toHaveLength(2); // plafond atteint : rien de plus aujourd'hui
      clock.advance(25 * 3_600_000); // le lendemain : la fenêtre glissante a libéré le quota
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent).toHaveLength(4);
    });

    it("plafond par destinataire : au-delà, les remises sont écartées (consignées), sauf urgence", async () => {
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { perRecipientDailyCap: 2 }));
      for (let i = 0; i < 4; i += 1) {
        unwrap(await event("finance.invoice.issued", { v: 1, invoiceId: IDS.EVT(1100 + i), number: `F-${i}`, learnerId: IDS.S2, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 100 + i, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null }));
      }
      const rows = await journal("channel = 'EMAIL'");
      expect(rows.map((x) => `${x.status}:${x.skip_reason ?? ""}`)).toEqual(["PENDING:", "PENDING:", "SKIPPED:recipient_cap", "SKIPPED:recipient_cap"]);
    });

    it("file maximale par établissement : les nouvelles remises sont écartées, consignées (anti-emballement)", async () => {
      await reset();
      const tiny = createNotificationsDeps({ db: db.tenantDb, clock, ports: mem.ports, channels: deps.channels, config: { maxPendingPerTenant: 1 } });
      unwrap(await onDomainEvent(tiny, sys(), { eventId: IDS.EVT(9800), eventType: "attendance.absence.recorded", payload: ABSENCE(80) }));
      const rows = await journal("status IN ('PENDING','SKIPPED')");
      expect(rows.filter((x) => x.status === "PENDING")).toHaveLength(1);
      expect(rows.some((x) => x.skip_reason === "backlog_limit")).toBe(true);
    });
  });

  // =========================================================================================================
  describe("Web Push : abonnements par appareil", () => {
    it("abonnement par appareil, mise à jour sur le même point d'accès, désabonnement ; l'envoi push vise l'utilisateur", async () => {
      await reset();
      const guardian = user(IDS.guardianFinancial);
      const a = unwrap(await subscribePush(deps, guardian, { endpoint: "https://push.example.org/send/A", keys: { p256dh: "B".repeat(87), auth: "c".repeat(22) }, deviceLabel: "Téléphone de Mariam" }));
      unwrap(await subscribePush(deps, guardian, { endpoint: "https://push.example.org/send/B", keys: { p256dh: "B".repeat(87), auth: "c".repeat(22) } }));
      expect(unwrap(await subscribePush(deps, guardian, { endpoint: "https://push.example.org/send/A", keys: { p256dh: "D".repeat(87), auth: "e".repeat(22) } })).id).toBe(a.id); // même appareil
      expect(unwrap(await listMyPushDevices(deps, guardian)).items).toHaveLength(2);
      expect(unwrap(await listMyPushDevices(deps, user(IDS.studentUser))).items).toHaveLength(0);
      // Avec un abonnement, la règle d'absence choisit le push (premier canal joignable).
      unwrap(await event("attendance.absence.recorded", ABSENCE(90)));
      const mine = (await journal()).filter((x) => x.subject_key === GUARDIAN_A.subjectKey);
      expect(mine.map((x) => `${x.channel}:${x.status}`)).toEqual(["PUSH:PENDING"]);
      await dispatchTenant(deps, tenantA);
      expect(ch.PUSH.sent[0]).toMatchObject({ address: IDS.guardianFinancial, channel: "PUSH" });
      expect(unwrap(await unsubscribePush(deps, guardian, "https://push.example.org/send/A"))).toEqual({ removed: true });
      expect(unwrap(await unsubscribePush(deps, user(IDS.studentUser), "https://push.example.org/send/B"))).toEqual({ removed: false }); // pas celui d'autrui
      await q("DELETE FROM notifications.push_subscriptions");
    });
  });

  // =========================================================================================================
  describe("administration : paramètres, canaux, journal, entretien", () => {
    it("paramètres : validation, fusion, audit ; fuseau inconnu refusé", async () => {
      await reset();
      const s = unwrap(await updateNotificationSettings(deps, admin(), { senderName: "Les Palmiers", quietStart: "21:00", dailyCaps: { SMS: 100 }, perRecipientDailyCap: 5 }));
      expect(s).toMatchObject({ senderName: "Les Palmiers", quietStart: "21:00", quietEnd: "07:00", perRecipientDailyCap: 5 });
      expect(s.dailyCaps).toEqual({ SMS: 100 });
      expect(unwrap(await updateNotificationSettings(deps, admin(), { dailyCaps: { EMAIL: 7 } })).dailyCaps).toEqual({ SMS: 100, EMAIL: 7 });
      expectErr(await updateNotificationSettings(deps, admin(), { timezone: "Mars/Olympus" }), NotifCode.INVALID_INPUT);
      expect(audit.actions()).toContain("notifications.settings.update");
    });

    it("état de santé des canaux : configuration, 24 h, file, plafond, dernière erreur ; l'essai passe par le journal", async () => {
      await reset();
      unwrap(await event("attendance.absence.recorded", ABSENCE(95)));
      ch.WHATSAPP.script.push({ status: "FAILED", code: "http_422", message: "numéro non WhatsApp" });
      await dispatchTenant(deps, tenantA);
      unwrap(await updateNotificationSettings(deps, admin(), { enabledChannels: ["IN_APP", "EMAIL", "WHATSAPP", "PUSH"] }));
      const health = unwrap(await getChannelsHealth(deps, admin()));
      expect(health.simulation).toBe(false);
      const wa = health.items.find((c) => c.channel === "WHATSAPP")!;
      expect(wa).toMatchObject({ configured: true, enabled: true, provider: "scripted", last24h: { sent: 1, failed: 1 }, lastErrorCode: "http_422", dailyCap: 1500, sentToday: 1 });
      expect(health.items.find((c) => c.channel === "SMS")).toMatchObject({ enabled: false, state: "DISABLED" });
      const test = unwrap(await sendChannelTest(deps, user(IDS.guardianFinancial), { channels: ["EMAIL"] }));
      expect(test.queued).toBe(1);
      expect((await journal("source_kind = 'TEST'"))[0]).toMatchObject({ channel: "EMAIL", template_code: "channel_test", urgent: true });
    });

    it("journal : filtres, pagination par curseur, destinataires MASQUÉS, statistiques ; aucun contenu ni adresse complète", async () => {
      await reset();
      for (let i = 0; i < 4; i += 1) unwrap(await event("attendance.absence.recorded", ABSENCE(100 + i)));
      await dispatchTenant(deps, tenantA);
      const page1 = unwrap(await listDeliveries(deps, admin(), { limit: 5 }));
      expect(page1.items).toHaveLength(5);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = unwrap(await listDeliveries(deps, admin(), { limit: 5, cursor: page1.nextCursor! }));
      expect(page2.items.every((i) => !page1.items.some((p) => p.id === i.id))).toBe(true);
      const sent = unwrap(await listDeliveries(deps, admin(), { limit: 50, status: "SENT", channel: "WHATSAPP" }));
      expect(sent.items).toHaveLength(8);
      expect(sent.items.every((i) => i.status === "SENT" && i.providerId?.startsWith("WHATSAPP-") && i.recipient.includes("**"))).toBe(true);
      const dump = JSON.stringify(unwrap(await listDeliveries(deps, admin(), { limit: 100 })));
      expect(dump).not.toMatch(/@famille|@eleve|0707070734|0555555512/);
      expect(dump).not.toContain("Awa Koné"); // aucun contenu de message
      expect(unwrap(await listDeliveries(deps, admin(), { limit: 50, status: "SKIPPED" })).items.every((i) => i.skipReason !== null)).toBe(true);
      expect(unwrap(await listDeliveries(deps, admin(), { limit: 50, userId: IDS.guardianFinancial })).items.every((i) => i.recipientUserId === IDS.guardianFinancial)).toBe(true);
      const stats = unwrap(await deliveryStats(deps, admin(), { days: 7 }));
      expect(stats.byStatus.SENT).toBe(8);
      expect(stats.byChannel.WHATSAPP).toBe(8);
    });

    it("entretien : le journal terminal périmé est purgé selon la rétention de l'établissement, jamais une remise en attente", async () => {
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { journalRetentionDays: 30 }));
      unwrap(await event("attendance.absence.recorded", ABSENCE(120)));
      await dispatchTenant(deps, tenantA);
      unwrap(await event("finance.invoice.issued", { v: 1, invoiceId: IDS.EVT(1200), number: "F-X", learnerId: IDS.S2, enrollmentId: null, payerKind: "LEARNER", academicYear: "2026", total: { amount: 1, currency: "XOF" }, dueDate: "2026-10-31", fundingType: null }));
      await q("UPDATE notifications.deliveries SET created_at = created_at - interval '40 days'");
      const r = await housekeepingTenant(deps, sys());
      expect(r.deliveries).toBeGreaterThan(0);
      const left = await journal();
      expect(left.every((x) => x.status === "PENDING" || x.status === "SENDING")).toBe(true);
      expect(left.length).toBeGreaterThan(0);
    });

    it("atomicité : un échec d'audit annule la publication d'un gabarit (ni version, ni événement)", async () => {
      await reset();
      const before = (await q<{ n: string }>("SELECT count(*)::text AS n FROM kernel.domain_events WHERE type = 'notifications.template.published'"))[0]!.n;
      const failing = createNotificationsDeps({ db: db.tenantDb, clock, ports: mem.ports, channels: deps.channels, audit: { record: async () => { throw new Error("audit indisponible"); } } });
      await expect(publishTemplateVersion(failing, admin(), { code: "absence", channel: "SMS", locale: "fr-CI", body: "{{studentName}}" })).rejects.toThrow("audit indisponible");
      expect(await q("SELECT 1 FROM notifications.template_versions")).toHaveLength(0);
      expect((await q<{ n: string }>("SELECT count(*)::text AS n FROM kernel.domain_events WHERE type = 'notifications.template.published'"))[0]!.n).toBe(before);
    });

    it("événements publiés : aucun contenu de message ni adresse dans l'outbox du module", async () => {
      const rows = await q<{ payload: unknown; type: string }>("SELECT type, payload FROM kernel.domain_events WHERE type LIKE 'notifications.%'");
      expect(rows.length).toBeGreaterThan(3);
      const dump = JSON.stringify(rows);
      expect(dump).not.toMatch(/@famille|@ecole|Awa Koné|Entretien avec/);
    });
  });
});
