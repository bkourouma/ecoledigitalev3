/**
 * Intégration (Postgres réel, s'ignore sans TEST_DATABASE_URL) : livraison des alertes de direction d'`analytics`
 * (`analytics.alert.raised`) par `notifications`. Canaux SCRIPTÉS : aucun envoi réel.
 *
 * Prouve : les rôles destinataires choisis par l'établissement dans `analytics` remplacent ceux de la règle livrée ; les
 * préférences et le consentement de chaque destinataire restent respectés (rien n'est contourné) ; une même clé de créneau ne
 * double jamais une remise, un créneau suivant en crée une nouvelle ; le message ne contient ni nom ni donnée d'élève ;
 * la règle est désactivable par l'établissement ; isolation entre établissements.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, createSystemContext, ManualClock, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { dispatchTenant } from "../../application/dispatch";
import { createNotificationsDeps, type NotificationsDeps } from "../../application/deps";
import { onDomainEvent } from "../../application/events";
import { updateMyNotificationPreferences } from "../../application/preferences";
import { RecordingAudit } from "../../application/ports";
import { saveRule } from "../../application/rules";
import { DEFAULT_RULES } from "../../domain/default-rules";
import { createInAppChannel } from "../../infrastructure/channels/in-app";
import { inMemoryPorts, type InMemoryWorld } from "../../infrastructure/in-memory-ports";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { ACADEMIC_R, buildWorld, ECONOME_R, HR_R, IDS, registryOf, scriptedChannels, type ScriptedChannels } from "../support/world";

const U = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${n.toString(16).padStart(12, "0")}`;
const ALERT = U(0xd01);
const RULE = U(0xd02);

const RAISED = (over: Record<string, unknown> = {}) => ({
  v: 1,
  alertId: ALERT,
  ruleId: RULE,
  metric: "ATTENDANCE_RATE",
  metricLabel: "Taux de présence des élèves",
  severity: "CRITICAL",
  reason: "RAISED",
  unit: "BPS",
  comparator: "BELOW",
  value: 6250,
  threshold: 7000,
  currency: null,
  recipientRoles: ["secretariat"],
  dedupeKey: `${RULE}:CRITICAL:2026-10-02`,
  institutionId: null,
  campusId: null,
  ...over,
});

describeIntegration("module notifications : alertes de direction d'analytics (base réelle)", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  let mem: InMemoryWorld;
  let ch: ScriptedChannels;
  let deps: NotificationsDeps;
  const clock = new ManualClock("2026-10-02T09:00:00.000Z");
  let evt = 0;

  const sys = (tenant = tenantA): RequestContext => createSystemContext(tenant);
  const admin = (): RequestContext => createRequestContext({ tenantId: tenantA, userId: IDS.admin });
  const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => db.admin.query(sql, params).then((r) => r.rows as T[]);
  const event = (payload: unknown, tenant = tenantA) => onDomainEvent(deps, sys(tenant), { eventId: IDS.EVT(7000 + ++evt), eventType: "analytics.alert.raised", payload });
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

  it("la règle livrée existe, est active, interne (jamais adressée à une famille) et ne force aucune urgence", () => {
    const rule = DEFAULT_RULES.find((r) => r.key === "analytics.alert_raised");
    expect(rule).toMatchObject({ enabled: true, kind: "EVENT", trigger: "analytics.alert.raised", templateCode: "analytics_alert", urgent: false });
    expect(rule?.audience.kind).toBe("ROLES");
  });

  it("les rôles de l'alerte REMPLACENT ceux de la règle : seul le rôle choisi par l'établissement est prévenu", async () => {
    await reset();
    const r = unwrap(await event(RAISED()));
    expect(r).toMatchObject({ rules: 1, ignored: null });
    const rows = await journal();
    expect(rows.map((x) => `${x.subject_key}|${x.channel}`).sort()).toEqual([`${HR_R.subjectKey}|EMAIL`, `${HR_R.subjectKey}|IN_APP`].sort());
    expect(rows.every((x) => x.template_code === "analytics_alert" && x.status === "PENDING")).toBe(true);
    // Ni le directeur (rôle de repli de la règle) ni l'économe ne reçoivent quoi que ce soit.
    expect(rows.some((x) => x.subject_key === ACADEMIC_R.subjectKey || x.subject_key === ECONOME_R.subjectKey)).toBe(false);
  });

  it("plusieurs rôles : chacun est prévenu une fois par canal", async () => {
    await reset();
    unwrap(await event(RAISED({ recipientRoles: ["secretariat", "econome", "directeur"] })));
    const rows = await journal("channel = 'IN_APP'");
    expect(new Set(rows.map((x) => x.subject_key))).toEqual(new Set([HR_R.subjectKey, ECONOME_R.subjectKey, ACADEMIC_R.subjectKey]));
  });

  it("le message dit l'indicateur, la valeur, le seuil et pointe l'écran des alertes ; aucun nom ni donnée d'élève", async () => {
    await reset();
    unwrap(await event(RAISED()));
    await dispatchTenant(deps, tenantA);
    const mail = ch.EMAIL.sent[0]!;
    expect(mail.text).toContain("Alerte critique : Taux de présence des élèves");
    expect(mail.text).toContain("62,5 %");
    expect(mail.text).toContain("70 %");
    expect(mail.text).toContain("sous le seuil");
    expect(mail.text).toContain("https://ecole.example.org/v2/analytics/alertes");
    expect(mail.text).not.toMatch(/Awa|Koné|KONE|élève :|studentId/i);
    expect(JSON.stringify(await journal())).not.toContain(IDS.S1);
  });

  it("montants : la devise est reprise de l'alerte", async () => {
    await reset();
    unwrap(await event(RAISED({ metric: "OVERDUE_AMOUNT", metricLabel: "Montant des impayés échus", unit: "AMOUNT", comparator: "ABOVE", value: 2_500_000, threshold: 2_000_000, currency: "XOF", severity: "WARNING" })));
    await dispatchTenant(deps, tenantA);
    const mail = ch.EMAIL.sent[0]!;
    expect(mail.text).toContain("Alerte d'attention : Montant des impayés échus");
    expect(mail.text).toMatch(/2\s?500\s?000 XOF/);
    expect(mail.text).toContain("au-dessus du seuil");
  });

  it("ne contourne ni les préférences ni le consentement : un destinataire qui a coupé l'e-mail ne le reçoit pas", async () => {
    await reset();
    unwrap(await updateMyNotificationPreferences(deps, createRequestContext({ tenantId: tenantA, userId: IDS.hr }), { channels: [{ channel: "EMAIL", category: "*", enabled: false }] }));
    unwrap(await event(RAISED()));
    const mine = await journal(`subject_key = '${HR_R.subjectKey}'`);
    expect(mine.map((x) => `${x.channel}:${x.status}:${x.skip_reason ?? ""}`).sort()).toEqual(["EMAIL:SKIPPED:consent_revoked", "IN_APP:PENDING:"]);
    await dispatchTenant(deps, tenantA);
    expect(ch.EMAIL.sent).toHaveLength(0);
  });

  it("anti-doublon : le même créneau (même clé) ne double rien, même avec un nouvel identifiant d'événement ; le créneau suivant notifie", async () => {
    await reset();
    expect(unwrap(await event(RAISED())).queued).toBe(2);
    expect(unwrap(await event(RAISED())).queued).toBe(0); // rejeu / seconde évaluation du même jour
    expect(await journal()).toHaveLength(2);
    expect(unwrap(await event(RAISED({ dedupeKey: `${RULE}:CRITICAL:2026-10-03` }))).queued).toBe(2); // rappel du lendemain
    expect(await journal()).toHaveLength(4);
    expect(unwrap(await event(RAISED({ dedupeKey: `${RULE}:WARNING:2026-10-03`, severity: "WARNING" }))).queued).toBe(2); // autre gravité : autre clé
  });

  it("l'établissement peut désactiver la règle ; sans rôle valable ou charge illisible, rien n'est envoyé (événement bénin)", async () => {
    await reset();
    const base = DEFAULT_RULES.find((x) => x.key === "analytics.alert_raised")!;
    unwrap(await saveRule(deps, admin(), base.key, { enabled: false, templateCode: base.templateCode, audience: base.audience, channels: [...base.channels], strategy: base.strategy, urgent: base.urgent, conditions: base.conditions }));
    expect(unwrap(await event(RAISED())).ignored).toBe("no_rule");
    expect(await journal()).toEqual([]);

    await reset();
    expect(unwrap(await event(RAISED({ recipientRoles: ["Rôle Invalide", 42] }))).ignored).toBe("no_recipient_role");
    expect(unwrap(await event({ v: 1, alertId: "pas-un-uuid" })).ignored).toBe("payload_unreadable");
    expect(unwrap(await event(null)).ignored).toBe("payload_unreadable");
    expect(await journal()).toEqual([]);
  });

  it("une alerte sans aucun rôle valable est ignorée : jamais de repli silencieux vers tout le monde", async () => {
    await reset();
    // Pas de rôle dans l'alerte : l'événement est ignoré (la liste de la règle livrée n'est qu'indicative).
    expect(unwrap(await event(RAISED({ recipientRoles: [] }))).ignored).toBe("no_recipient_role");
    expect(await journal()).toEqual([]);
  });

  it("isolation : une alerte d'un autre établissement n'écrit rien dans le journal de celui-ci", async () => {
    await reset();
    unwrap(await event(RAISED(), tenantB));
    expect(await journal()).toEqual([]);
    expect((await q(`SELECT count(*)::int AS n FROM notifications.deliveries WHERE tenant_id = '${tenantB}'`))[0]!.n).toBeGreaterThan(0);
  });
});
