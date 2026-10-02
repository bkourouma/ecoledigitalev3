/**
 * Intégration (Postgres réel, s'ignore sans TEST_DATABASE_URL) : abonnés ajoutés — alertes internes de rapprochement et
 * d'élèves affectés par l'État, vie scolaire (texte neutre), admissions (candidat). Canaux SCRIPTÉS : aucun envoi réel.
 *
 * Prouve : alerte au rôle économe/direction, idempotence et déduplication par fait ; aucune donnée sensible dans le journal
 * ni dans le message rendu ; règles de vie scolaire et d'admissions désactivées par défaut puis activables par établissement ;
 * préférences, heures calmes et consentement respectés ; port candidat absent = échec fermé ; isolation entre établissements.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, createSystemContext, ManualClock, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { dispatchTenant } from "../../application/dispatch";
import { createNotificationsDeps, type NotificationsDeps } from "../../application/deps";
import { onDomainEvent } from "../../application/events";
import { updateMyNotificationPreferences } from "../../application/preferences";
import { RecordingAudit } from "../../application/ports";
import { saveRule } from "../../application/rules";
import { updateNotificationSettings } from "../../application/settings";
import { DEFAULT_RULES } from "../../domain/default-rules";
import { createInAppChannel } from "../../infrastructure/channels/in-app";
import { inMemoryPorts, type InMemoryWorld } from "../../infrastructure/in-memory-ports";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { ACADEMIC_R, buildWorld, ECONOME_R, GUARDIAN_A, GUARDIAN_B, IDS, recipient, registryOf, scriptedChannels, type ScriptedChannels } from "../support/world";

const U = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${n.toString(16).padStart(12, "0")}`;
const PAYMENT = U(0xa01);
const REFUND = U(0xa02);
const RECEIVABLE = U(0xa03);
const CONTROL = U(0xa04);
const ASSIGNMENT = U(0xa05);
const MEASURE = U(0xa06);
const CONVOCATION = U(0xa07);
const APPLICATION = U(0xa08);
const OFFER = U(0xa09);
const money = (amount: number) => ({ amount, currency: "XOF" });

const RECONCILIATION = (over: Record<string, unknown> = {}) => ({
  v: 1, subject: "PAYMENT", paymentId: PAYMENT, learnerId: IDS.S1, amount: money(25000), provider: "orange_money", reason: "attempts_exhausted", attempts: 6, lastErrorCode: "E42", ...over,
});

describeIntegration("module notifications : abonnés ajoutés (base réelle)", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  let mem: InMemoryWorld;
  let ch: ScriptedChannels;
  let deps: NotificationsDeps;
  const clock = new ManualClock("2026-10-02T09:00:00.000Z");
  let evt = 0;
  const APPLICANT = recipient("person:0192f0a4-7b1e-7c3a-8d2e-00000000b001", { name: "OUATTARA Fanta", email: "fanta.ouattara@famille.example.org", phone: "07 08 09 10 11", flags: { primary: true } });

  const sys = (tenant = tenantA): RequestContext => createSystemContext(tenant);
  const admin = (): RequestContext => createRequestContext({ tenantId: tenantA, userId: IDS.admin });
  const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => db.admin.query(sql, params).then((r) => r.rows as T[]);
  const event = (type: string, payload: unknown, tenant = tenantA) => onDomainEvent(deps, sys(tenant), { eventId: IDS.EVT(5000 + ++evt), eventType: type, payload });
  const journal = (where = "TRUE") =>
    q<{ channel: string; status: string; skip_reason: string | null; subject_key: string; template_code: string; context: Record<string, string> }>(
      `SELECT channel, status, skip_reason, subject_key, template_code, context FROM notifications.deliveries WHERE tenant_id = '${tenantA}' AND ${where} ORDER BY created_at, channel, subject_key`,
    );
  const reset = async (): Promise<void> => {
    for (const t of ["deliveries", "rules", "channel_preferences", "subject_preferences", "consent_log", "settings"]) await q(`DELETE FROM notifications.${t}`);
    await q("DELETE FROM messaging.messages");
    await q("DELETE FROM messaging.notifications");
    for (const c of [ch.EMAIL, ch.SMS, ch.WHATSAPP, ch.PUSH]) {
      c.script.length = 0;
      c.sent.length = 0;
      c.calls = 0;
    }
    clock.set("2026-10-02T09:00:00.000Z");
    mem.applicants.applications.clear();
  };
  /** Active une règle livrée (désactivée par défaut) pour l'établissement A. */
  const enableShipped = async (key: string, patch: { channels?: ("IN_APP" | "EMAIL" | "SMS" | "WHATSAPP" | "PUSH")[] } = {}): Promise<void> => {
    const r = DEFAULT_RULES.find((x) => x.key === key)!;
    unwrap(await saveRule(deps, admin(), key, { enabled: true, templateCode: r.templateCode, audience: r.audience, channels: patch.channels ?? [...r.channels], strategy: r.strategy, urgent: r.urgent, conditions: r.conditions }));
  };

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("tenant-a");
    tenantB = await db.createTenant("tenant-b");
    mem = inMemoryPorts();
    const world = buildWorld();
    world.roles.set("directeur", [ACADEMIC_R]);
    mem.ports = { ...mem.ports, directory: world };
    ch = scriptedChannels();
    deps = createNotificationsDeps({
      db: db.tenantDb,
      clock,
      audit: new RecordingAudit(),
      ports: mem.ports,
      channels: registryOf(createInAppChannel({ db: db.tenantDb, clock }), ch),
      config: { appBaseUrl: "https://ecole.example.org", unsubscribeSecret: "secret-de-test", webhookSecret: "secret-webhook", production: false },
      random: () => 0,
    });
  });
  afterAll(async () => {
    await db?.drop();
  });

  describe("alertes internes : rapprochement finance", () => {
    it("alerte l'économe ET la direction, sans nom d'élève ni message du fournisseur ; le lien pointe l'écran des paiements à rapprocher", async () => {
      await reset();
      const r = unwrap(await event("finance.payment.reconciliation_needed", RECONCILIATION()));
      expect(r).toMatchObject({ rules: 1, ignored: null });
      const rows = await journal();
      expect(rows.map((x) => `${x.subject_key}|${x.channel}`).sort()).toEqual([`${ECONOME_R.subjectKey}|EMAIL`, `${ECONOME_R.subjectKey}|IN_APP`, `${ACADEMIC_R.subjectKey}|EMAIL`, `${ACADEMIC_R.subjectKey}|IN_APP`].sort());
      expect(rows.every((x) => x.template_code === "reconciliation_needed" && x.status === "PENDING")).toBe(true);
      // Le journal ne contient que des identifiants de contexte : ni élève, ni code d'erreur du fournisseur.
      expect(JSON.stringify(rows)).not.toContain(IDS.S1);
      expect(JSON.stringify(rows)).not.toContain("E42");

      await dispatchTenant(deps, tenantA);
      const email = ch.EMAIL.sent[0]!;
      expect(email.text).toContain("paiement");
      expect(email.text).toMatch(/25\s?000/);
      expect(email.text).toContain("https://ecole.example.org/v2/finance/payments/pending");
      expect(email.text).not.toContain("Awa");
      // Messagerie in-app réelle : la notification porte le lien interne.
      const inApp = await q("SELECT * FROM messaging.messages WHERE tenant_id = $1", [tenantA]);
      expect(inApp.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(inApp)).toContain("https://ecole.example.org/v2/finance/payments/pending");
    });

    it("idempotence : rejeu, nouvel événement pour le même élément et le même motif ne doublent rien ; un autre motif ré-alerte", async () => {
      await reset();
      const first = unwrap(await event("finance.payment.reconciliation_needed", RECONCILIATION()));
      const again = unwrap(await event("finance.payment.reconciliation_needed", RECONCILIATION({ attempts: 7 })));
      expect(first.queued).toBe(4);
      expect(again).toMatchObject({ queued: 0 });
      const other = unwrap(await event("finance.payment.reconciliation_needed", RECONCILIATION({ reason: "provider_mismatch" })));
      expect(other.queued).toBe(4);
      expect(await journal()).toHaveLength(8);
    });

    it("remboursement : alerte distincte (par identifiant de remboursement)", async () => {
      await reset();
      const r = unwrap(await event("finance.refund.reconciliation_needed", RECONCILIATION({ subject: "REFUND", refundId: REFUND })));
      expect(r.queued).toBe(4);
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent[0]!.text).toContain("remboursement");
    });

    it("préférences respectées : un responsable qui a coupé l'e-mail ne le reçoit pas (consigné) ; l'in-app reste", async () => {
      await reset();
      unwrap(await updateMyNotificationPreferences(deps, createRequestContext({ tenantId: tenantA, userId: IDS.econome }), { channels: [{ channel: "EMAIL", category: "*", enabled: false }] }));
      unwrap(await event("finance.payment.reconciliation_needed", RECONCILIATION()));
      const mine = (await journal()).filter((x) => x.subject_key === ECONOME_R.subjectKey);
      expect(mine.map((x) => `${x.channel}:${x.status}:${x.skip_reason ?? ""}`).sort()).toEqual(["EMAIL:SKIPPED:consent_revoked", "IN_APP:PENDING:"]);
    });

    it("isolation : le même événement dans l'établissement B ne touche pas A", async () => {
      await reset();
      unwrap(await event("finance.payment.reconciliation_needed", RECONCILIATION(), tenantB));
      expect(await journal()).toEqual([]);
      expect((await q("SELECT count(*)::int AS n FROM notifications.deliveries WHERE tenant_id = $1", [tenantB]))[0]!.n).toBe(4);
    });
  });

  describe("alertes internes : élèves affectés par l'État", () => {
    const RECEIVABLE_OVERDUE = { v: 1, receivableId: RECEIVABLE, assignmentId: ASSIGNMENT, enrollmentId: U(0xb01), studentId: IDS.S1, institutionId: U(0xb02), dueOn: "2026-09-30", expected: money(300000), received: money(100000), status: "OVERDUE", daysOverdue: 12 };

    it("créance en retard : l'économe seul, sans nom d'élève ; une seule alerte par créance", async () => {
      await reset();
      const r = unwrap(await event("stateassign.receivable.overdue", RECEIVABLE_OVERDUE));
      expect(r.queued).toBe(2);
      const rows = await journal();
      expect(new Set(rows.map((x) => x.subject_key))).toEqual(new Set([ECONOME_R.subjectKey]));
      await dispatchTenant(deps, tenantA);
      const text = ch.EMAIL.sent[0]!.text;
      expect(text).toContain("Créance de l'État en retard");
      expect(text).toMatch(/200\s?000/);
      expect(text).toContain("12 jours");
      expect(text).not.toContain("Awa");
      expect(unwrap(await event("stateassign.receivable.overdue", { ...RECEIVABLE_OVERDUE, daysOverdue: 13 })).queued).toBe(0);
    });

    it("écart de rapprochement, contrôle à effectuer et anomalie : alertes par rôle ; un rapprochement équilibré est ignoré", async () => {
      await reset();
      const base = { v: 1, assignmentId: ASSIGNMENT, enrollmentId: U(0xb01), studentId: IDS.S1, institutionId: U(0xb02), academicYearId: U(0xb03), version: 2 };
      expect(unwrap(await event("stateassign.reconciliation.discrepancy", { ...base, status: "DISCREPANCY", stateDelta: money(5000), parentDelta: money(0) })).queued).toBe(2);
      expect(unwrap(await event("stateassign.reconciliation.discrepancy", { ...base, version: 3, status: "BALANCED", stateDelta: money(0), parentDelta: money(0) })).ignored).toBe("balanced");
      const control = { v: 1, controlId: CONTROL, assignmentId: ASSIGNMENT, enrollmentId: U(0xb01), studentId: IDS.S1, institutionId: U(0xb02), kind: "ATTENDANCE", status: "PENDING", dueOn: "2026-10-05" };
      // « à effectuer » : in-app seulement, à l'économe et à la direction
      expect(unwrap(await event("stateassign.control.due", control)).queued).toBe(2);
      // anomalie : in-app + e-mail, économe et direction
      expect(unwrap(await event("stateassign.control.anomaly_detected", { ...control, status: "ANOMALY" })).queued).toBe(4);
      const bySubject = new Set((await journal("template_code = 'stateassign_alert'")).map((x) => x.subject_key));
      expect(bySubject).toEqual(new Set([ECONOME_R.subjectKey, ACADEMIC_R.subjectKey]));
    });

    it("événement illisible : bénin (consigné, non rejoué), rien n'est écrit", async () => {
      await reset();
      expect(unwrap(await event("stateassign.control.due", { v: 1 })).ignored).toBe("payload_unreadable");
      expect(await journal()).toEqual([]);
    });
  });

  describe("vie scolaire : texte neutre, règles désactivées par défaut", () => {
    const MEASURE_NOTIFIED = { v: 1, measureId: MEASURE, enrollmentId: U(0xc01), studentId: IDS.S1, kind: "EXCLUSION", typeId: U(0xc02), severityCode: "GRAVE", startsOn: "2026-10-12", endsOn: "2026-10-14", confidentiality: "NORMAL", visibleToGuardians: true };
    const CONVOCATION_SENT = { v: 1, convocationId: CONVOCATION, enrollmentId: U(0xc01), studentId: IDS.S1, reasonKind: "DISCIPLINE", scheduledAt: "2026-10-09T09:30:00Z" };

    it("par défaut : aucune remise (le canal direct de schoollife a déjà informé les tuteurs : pas de doublon)", async () => {
      await reset();
      expect(unwrap(await event("schoollife.measure.notified", MEASURE_NOTIFIED)).ignored).toBe("no_rule");
      expect(unwrap(await event("schoollife.convocation.sent", CONVOCATION_SENT)).ignored).toBe("no_rule");
      expect(await journal()).toEqual([]);
    });

    it("activée par l'établissement : décision notifiée -> tuteurs, texte neutre (ni nature, ni gravité, ni dates, ni motif)", async () => {
      await reset();
      await enableShipped("schoollife.measure_notified.guardians");
      const r = unwrap(await event("schoollife.measure.notified", MEASURE_NOTIFIED));
      expect(r.rules).toBe(1);
      const rows = await journal();
      expect(rows.every((x) => x.template_code === "schoollife_measure_notified")).toBe(true);
      expect(new Set(rows.map((x) => x.subject_key))).toEqual(new Set([GUARDIAN_A.subjectKey, GUARDIAN_B.subjectKey]));
      await dispatchTenant(deps, tenantA);
      const text = ch.EMAIL.sent.map((m) => m.text).join("\n");
      expect(text).toContain("décision de vie scolaire");
      expect(text).toContain("Awa Koné");
      expect(text).not.toMatch(/EXCLUSION|exclusion|GRAVE|2026-10-1|sanction|motif/);
      // rejeu : aucune remise supplémentaire
      expect(unwrap(await event("schoollife.measure.notified", MEASURE_NOTIFIED)).queued).toBe(0);
      expect(await journal("channel = 'EMAIL' AND status IN ('PENDING','SENT')")).toHaveLength(1);
    });

    it("mesure confidentielle ou non visible des tuteurs : ignorée même règle activée", async () => {
      await reset();
      await enableShipped("schoollife.measure_notified.guardians");
      expect(unwrap(await event("schoollife.measure.notified", { ...MEASURE_NOTIFIED, confidentiality: "CONFIDENTIAL" })).ignored).toBe("not_shareable");
      expect(unwrap(await event("schoollife.measure.notified", { ...MEASURE_NOTIFIED, visibleToGuardians: false })).ignored).toBe("not_shareable");
      expect(await journal()).toEqual([]);
    });

    it("convocation envoyée : date et heure LOCALES, jamais le motif ; opt-out de catégorie respecté", async () => {
      await reset();
      await enableShipped("schoollife.convocation_sent.guardians");
      unwrap(await updateMyNotificationPreferences(deps, createRequestContext({ tenantId: tenantA, userId: IDS.guardianFinancial }), { channels: [{ channel: "EMAIL", category: "ANNOUNCEMENT", enabled: false }] }));
      unwrap(await event("schoollife.convocation.sent", CONVOCATION_SENT));
      const optedOut = (await journal("channel = 'EMAIL'")).filter((x) => x.subject_key === GUARDIAN_A.subjectKey);
      expect(optedOut.every((x) => x.status === "SKIPPED" && x.skip_reason === "category_opt_out")).toBe(true);
      await dispatchTenant(deps, tenantA);
      const all = JSON.stringify(await q("SELECT * FROM messaging.messages WHERE tenant_id = $1", [tenantA]));
      expect(all).toContain("09:30");
      expect(all).toContain("09/10/2026");
      expect(all).not.toMatch(/DISCIPLINE|disciplin|annulée/);
    });

    it("convocation annulée : message d'annulation, même texte neutre", async () => {
      await reset();
      await enableShipped("schoollife.convocation_cancelled.guardians");
      unwrap(await event("schoollife.convocation.cancelled", CONVOCATION_SENT));
      await dispatchTenant(deps, tenantA);
      const all = JSON.stringify(await q("SELECT * FROM messaging.messages WHERE tenant_id = $1", [tenantA]));
      expect(all).toContain("annulée");
      expect(all).toContain("09:30");
      expect(all).not.toMatch(/DISCIPLINE|disciplin/);
      expect(ch.EMAIL.sent[0]!.text).toContain("convocation annulée");
    });
  });

  describe("admissions : candidat", () => {
    const SUBMITTED = { v: 1, applicationId: APPLICATION, campaignId: U(0xd01), institutionId: U(0xd02), gradeLevelCode: "6EME", via: "PUBLIC_FORM" };

    it("par défaut : aucune remise (règles d'admissions en option)", async () => {
      await reset();
      mem.applicants.applications.set(APPLICATION, [APPLICANT]);
      expect(unwrap(await event("admissions.application.submitted", SUBMITTED)).ignored).toBe("no_rule");
      expect(await journal()).toEqual([]);
    });

    it("activée : accusé de réception au responsable du dossier, par le premier canal joignable (e-mail), sans nom", async () => {
      await reset();
      await enableShipped("admissions.application_received.applicant");
      mem.applicants.applications.set(APPLICATION, [APPLICANT]);
      const r = unwrap(await event("admissions.application.submitted", SUBMITTED));
      expect(r).toMatchObject({ rules: 1, queued: 1 });
      const rows = await journal();
      expect(rows.map((x) => `${x.channel}:${x.status}`)).toEqual(["EMAIL:PENDING"]);
      await dispatchTenant(deps, tenantA);
      const msg = ch.EMAIL.sent[0]!;
      expect(msg.text).toContain("bien reçu votre dossier");
      expect(msg.text).not.toContain("Fanta");
      expect(msg.text).not.toContain("6EME");
      expect(msg.address).toBe("fanta.ouattara@famille.example.org");
      // Rejeu : rien de plus.
      expect(unwrap(await event("admissions.application.submitted", SUBMITTED)).queued).toBe(0);
    });

    it("offre émise : message neutre ; un import en masse ne déclenche pas d'accusé ; dossier inconnu ou sans contact : aucun envoi", async () => {
      await reset();
      await enableShipped("admissions.offer_issued.applicant");
      await enableShipped("admissions.application_received.applicant");
      mem.applicants.applications.set(APPLICATION, [APPLICANT]);
      expect(unwrap(await event("admissions.offer.issued", { v: 1, applicationId: APPLICATION, campaignId: U(0xd01), institutionId: U(0xd02), gradeLevelCode: "6EME", offerId: OFFER, classroomId: null })).queued).toBe(1);
      expect(unwrap(await event("admissions.application.submitted", { ...SUBMITTED, via: "IMPORT" })).ignored).toBe("via_not_applicant_facing");
      expect(unwrap(await event("admissions.application.submitted", { ...SUBMITTED, applicationId: U(0xd99) })).queued).toBe(0);
      await dispatchTenant(deps, tenantA);
      expect(ch.EMAIL.sent).toHaveLength(1);
      expect(ch.EMAIL.sent[0]!.text).toContain("offre d'admission");
    });

    it("heures calmes : un SMS au candidat de nuit est REPORTÉ ; refus de canal du candidat par désinscription respecté", async () => {
      await reset();
      await enableShipped("admissions.application_received.applicant", { channels: ["SMS"] });
      mem.applicants.applications.set(APPLICATION, [APPLICANT]);
      clock.set("2026-10-02T22:30:00.000Z");
      unwrap(await event("admissions.application.submitted", SUBMITTED));
      const rows = await q<{ status: string; available_at: Date }>("SELECT status, available_at FROM notifications.deliveries WHERE tenant_id = $1 AND channel = 'SMS'", [tenantA]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("PENDING");
      expect(rows[0]!.available_at.toISOString()).toBe("2026-10-03T07:00:00.000Z");
      await dispatchTenant(deps, tenantA);
      expect(ch.SMS.sent).toHaveLength(0);
      clock.set("2026-10-03T07:00:30.000Z");
      await dispatchTenant(deps, tenantA);
      expect(ch.SMS.sent).toHaveLength(1);
    });

    it("modèle EXPLICIT : sans accord du candidat, rien ne part (consigné)", async () => {
      await reset();
      unwrap(await updateNotificationSettings(deps, admin(), { consentModels: { EMAIL: "EXPLICIT" } }));
      await enableShipped("admissions.application_received.applicant", { channels: ["EMAIL"] });
      mem.applicants.applications.set(APPLICATION, [APPLICANT]);
      unwrap(await event("admissions.application.submitted", SUBMITTED));
      expect((await journal())[0]).toMatchObject({ channel: "EMAIL", status: "SKIPPED", skip_reason: "consent_revoked" });
    });

    it("port des candidatures absent : échec fermé (le worker rejoue), jamais un message perdu en silence", async () => {
      await reset();
      await enableShipped("admissions.application_received.applicant");
      const bare = createNotificationsDeps({ db: db.tenantDb, clock, ports: { directory: mem.ports.directory }, channels: registryOf(createInAppChannel({ db: db.tenantDb, clock }), ch), config: { production: false } });
      const r = await onDomainEvent(bare, sys(), { eventId: IDS.EVT(7777), eventType: "admissions.application.submitted", payload: SUBMITTED });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("notifications.port_unavailable");
    });
  });
});
