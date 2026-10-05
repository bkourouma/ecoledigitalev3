/**
 * Notifications assemblées sur Postgres réel avec les VRAIS adaptateurs (people + academic + rbac + iam + finance +
 * messaging -> notifications) : destinataires et coordonnées réels (tuteur avec et sans compte, lien clos exclu), échéances en
 * retard réelles (finance), relances par paliers sur de vraies factures, arrêt dès paiement, annonce publiée réelle, charge
 * d'enseignement réelle. Canaux SCRIPTÉS (aucun envoi réel) ; canal in-app RÉEL (messaging).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money, createRequestContext, createSystemContext, newId, noopLogger, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { PgOutboxWriter } from "@ecoledigitale/database";
import { createGuardian, linkGuardian, unlinkGuardian } from "../../src/modules/people";
import { assignSystemRoleUseCase, instantiateSystemRoles, noopAudit as noopRbacAudit } from "../../src/modules/rbac";
import { createFinanceDeps, createInvoice, recordManualPayment, type FinanceDeps } from "../../src/modules/finance";
import { createAnnouncement, createMessagingDeps, withdrawAnnouncement, InMemoryStorage } from "../../src/modules/messaging";
import { createNotificationsDeps, dispatchTenant, onDomainEvent, runDunning, type ChannelAdapter, type NotificationsDeps } from "../../src/modules/notifications";
import { createInAppChannel } from "../../src/modules/notifications/infrastructure/channels/in-app";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const xof = (n: number): Money => Money.of(n, "XOF");
const dayOffset = (w: AssemblyWorld, days: number): string => new Date(w.clock.now().getTime() + days * 86_400_000).toISOString().slice(0, 10);

class Scripted implements ChannelAdapter {
  readonly sent: Array<{ address: string; subject: string | null; text: string; channel: string }> = [];
  constructor(readonly channel: ChannelAdapter["channel"]) {}
  readonly provider = "scripted";
  status() {
    return { configured: true, missing: [] as string[] };
  }
  async deliver(m: Parameters<ChannelAdapter["deliver"]>[0]) {
    this.sent.push({ address: m.address, subject: m.subject, text: m.text, channel: m.channel });
    return { status: "SENT" as const, providerId: `${this.channel}-${this.sent.length}` };
  }
}

describeIntegration("notifications : adaptateurs réels (people, academic, rbac, iam, finance, messaging)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let deps: NotificationsDeps;
  let fin: FinanceDeps;
  let yearCode: string;
  const ch = { EMAIL: new Scripted("EMAIL"), SMS: new Scripted("SMS"), WHATSAPP: new Scripted("WHATSAPP"), PUSH: new Scripted("PUSH") };
  const u = { payer: newId(), director: newId(), secretary: newId(), student1: newId(), econome: newId() };
  const guardianIds: { payer?: string; second?: string; former?: string } = {};
  let seq = 0;
  const sys = (): RequestContext => createSystemContext(w.tenantId);

  const link = async (studentId: string, identity: string | null, code: "FATHER" | "MOTHER" | "LEGAL_GUARDIAN", person: { name: string; email?: string; phone?: string }, flags: Record<string, unknown> = {}) => {
    seq += 1;
    const g = unwrap(await createGuardian(w.kit.people, w.director, { person: { lastName: person.name, firstName: `Prenom${seq}`, sex: "F", birthDate: `19${70 + seq}-05-0${seq}`, ...(person.email ? { email: person.email } : {}), ...(person.phone ? { phone: person.phone } : {}) } })).guardian;
    if (identity) await w.db.admin.query("UPDATE people.persons SET identity_id = $2 WHERE id = $1", [g.personId, identity]);
    const l = unwrap(await linkGuardian(w.kit.people, w.director, studentId, { guardianId: g.id, relationshipCode: code, ...flags }));
    return { guardian: g, link: l };
  };

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 2 });
    // Midi UTC : hors heures calmes (20:00-07:00), quelle que soit l'heure de lancement des tests.
    const noon = new Date(w.clock.now());
    noon.setUTCHours(12, 0, 0, 0);
    w.clock.set(noon);
    fin = createFinanceDeps({ db: w.tenantDb, clock: w.clock, logger: noopLogger, portsProvider: () => w.ports.finance });
    yearCode = (await adminRows<{ code: string }>(w, "SELECT code FROM academic.academic_years WHERE id = $1", [school.seed.yearId]))[0]!.code;
    const [p1, p2] = school.pupils;
    // Compte de l'élève 1 ; tuteur responsable financier AVEC compte, second tuteur SANS compte (téléphone), ancien tuteur (lien clos).
    await w.db.admin.query("UPDATE people.persons SET identity_id = $2, email = 'eleve1@example.test', phone = '0101010101' WHERE id = (SELECT person_id FROM people.students WHERE id = $1)", [p1!.studentId, u.student1]);
    const payer = await link(p1!.studentId, u.payer, "FATHER", { name: "PAYEUR", email: "payeur@famille.example.test", phone: "07 07 07 07 07" }, { isFinancialResponsible: true });
    const second = await link(p1!.studentId, null, "MOTHER", { name: "SANSCOMPTE", phone: "05 55 55 55 12" });
    const former = await link(p1!.studentId, newId(), "LEGAL_GUARDIAN", { name: "ANCIEN", email: "ancien@example.test" });
    unwrap(await unlinkGuardian(w.kit.people, w.director, p1!.studentId, former.link.id, { reason: "Fin de la tutelle" }));
    guardianIds.payer = payer.guardian.id;
    guardianIds.second = second.guardian.id;
    guardianIds.former = former.guardian.id;
    // Rôles RBAC réels : direction, secrétariat, économe.
    const s = createSystemContext(w.tenantId);
    await w.tenantDb.run(s, async (tx) => {
      await instantiateSystemRoles(tx, w.tenantId, { logger: noopLogger, clock: w.clock });
      const rbacDeps = { tx, clock: w.clock, outbox: new PgOutboxWriter(tx), audit: noopRbacAudit, logger: noopLogger };
      unwrap(await assignSystemRoleUseCase(rbacDeps, s, { templateKey: "directeur", userId: u.director }));
      unwrap(await assignSystemRoleUseCase(rbacDeps, s, { templateKey: "secretariat", userId: u.secretary }));
      unwrap(await assignSystemRoleUseCase(rbacDeps, s, { templateKey: "econome", userId: u.econome }));
    });
    const inApp = createInAppChannel({ db: w.tenantDb, clock: w.clock });
    const all = [inApp, ch.EMAIL, ch.SMS, ch.WHATSAPP, ch.PUSH];
    deps = createNotificationsDeps({
      db: w.tenantDb,
      clock: w.clock,
      ports: w.ports.notifications,
      channels: { get: (c) => all.find((a) => a.channel === c)!, all: () => all, simulation: false },
      config: { appBaseUrl: "https://ecole.example.org", unsubscribeSecret: "secret-test" },
      random: () => 0,
    });
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("annuaire : élève, tuteurs AVEC et SANS compte (clé de personne + alias), lien clos exclu, indicateur de responsable financier", async () => {
    const [contacts] = await w.ports.notifications.directory!.studentContacts(sys(), [school.pupils[0]!.studentId]);
    expect(contacts!.studentName).toContain("ETUDIANT1");
    expect(contacts!.student).toMatchObject({ subjectKey: `user:${u.student1}`, userId: u.student1, email: "eleve1@example.test", kind: "STUDENT" });
    expect(contacts!.guardians).toHaveLength(2); // le lien clos est exclu
    const payer = contacts!.guardians.find((g) => g.displayName.includes("PAYEUR"))!;
    expect(payer).toMatchObject({ userId: u.payer, subjectKey: `user:${u.payer}`, email: "payeur@famille.example.test", phone: "0707070707", flags: { financial: true } });
    expect(payer.aliasKeys).toEqual([expect.stringMatching(/^person:/)]);
    const second = contacts!.guardians.find((g) => g.displayName.includes("SANSCOMPTE"))!;
    expect(second).toMatchObject({ userId: null, email: null, phone: "0555555512" });
    expect(second.subjectKey).toMatch(/^person:/);
    expect(contacts!.guardians.some((g) => g.displayName.includes("ANCIEN"))).toBe(false);
    expect(await w.ports.notifications.directory!.studentContacts(sys(), [newId()])).toEqual([]);
  });

  it("annuaire : classe (élèves, tuteurs, enseignant affecté), personnel par fiche, titulaires de rôles RBAC, comptes", async () => {
    const dir = w.ports.notifications.directory!;
    const room = await dir.classroomContacts(sys(), school.ref.classroomId, ["STUDENTS", "GUARDIANS", "TEACHERS"]);
    expect(room.classroomName).toBe("Licence 1 A");
    expect(room.recipients.filter((r) => r.kind === "GUARDIAN")).toHaveLength(2);
    expect(room.recipients.filter((r) => r.kind === "STAFF").map((r) => r.email)).toEqual(["ens@example.test"]);
    expect((await dir.classroomContacts(sys(), newId(), ["STUDENTS"])).classroomName).toBeNull();
    const staff = await dir.staffContact(sys(), school.teacher.staffId);
    expect(staff).toMatchObject({ displayName: expect.stringContaining("ENSEIGNANT"), recipient: { email: "ens@example.test", userId: school.teacher.ctx.userId } });
    expect(await dir.staffContact(sys(), newId())).toBeNull();
    const holders = await dir.usersWithRoles(sys(), ["directeur", "secretariat"]);
    expect(holders.map((h) => h.userId).sort()).toEqual([u.director, u.secretary].sort());
    expect(await dir.usersWithRoles(sys(), ["role_inexistant"])).toEqual([]);
    const users = await dir.contactsOfUsers(sys(), [u.payer, school.teacher.ctx.userId as string]);
    expect(users.find((x) => x.userId === u.payer)).toMatchObject({ email: "payeur@famille.example.test", phone: "0707070707" });
  });

  it("finance : échéances en retard réelles (payeur = apprenant), paginées ; relues avant l'envoi ; soldées = absentes", async () => {
    const learnerId = school.pupils[0]!.studentId;
    const created = unwrap(await createInvoice(fin, w.director, { learnerId, academicYear: yearCode, lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(90_000) }], dueDate: dayOffset(w, -12), issue: true }));
    const invoice = created.invoices[0]!.invoice;
    const overdue = w.ports.notifications.overdue!;
    const asOf = dayOffset(w, 0);
    const list = await overdue.listOverdueInstallments(sys(), { asOf, minDaysOverdue: 3, limit: 50 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ invoiceId: invoice.id, invoiceNumber: invoice.number, learnerId, daysOverdue: 12, remaining: { amount: 90_000, currency: "XOF" } });
    expect(await overdue.listOverdueInstallments(sys(), { asOf, minDaysOverdue: 13, limit: 50 })).toEqual([]);
    expect(await overdue.listOverdueInstallments(sys(), { asOf, minDaysOverdue: 3, limit: 50, afterInstallmentId: list[0]!.installmentId })).toEqual([]);
    expect(await overdue.isInstallmentStillOverdue(sys(), list[0]!.installmentId)).toBe(true);
    // Paiement partiel : toujours en retard, le reste dû baisse.
    unwrap(await recordManualPayment(fin, w.director, { idempotencyKey: `pay-${newId()}`, learnerId, amount: xof(30_000), method: "TRANSFER", reference: "VIR-A", allocation: { mode: "AUTO", invoiceIds: [invoice.id] } }));
    expect((await overdue.listOverdueInstallments(sys(), { asOf, minDaysOverdue: 3, limit: 50 }))[0]!.remaining.amount).toBe(60_000);
  });

  it("relances sur de VRAIES factures : coordonnées réelles du responsable financier, un palier à la fois, jamais deux fois, arrêt dès paiement", async () => {
    const learnerId = school.pupils[0]!.studentId;
    const sendersBefore = ch.EMAIL.sent.length;
    const first = unwrap(await runDunning(deps, sys()));
    expect(first).toMatchObject({ examined: 1, notified: 1 }); // 12 jours : palier J+7
    expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 0 });
    const rows = await adminRows<{ channel: string; status: string; skip_reason: string | null; recipient_masked: string }>(w, "SELECT channel, status, skip_reason, recipient_masked FROM notifications.deliveries WHERE source_kind = 'DUNNING' ORDER BY channel");
    // Responsable financier seul (financialFirst) : in-app, e-mail, WhatsApp ; jamais le tuteur sans compte ni l'ancien tuteur.
    expect(rows.map((r) => `${r.channel}:${r.status}`)).toEqual(["EMAIL:PENDING", "IN_APP:PENDING", "WHATSAPP:PENDING"]);
    expect(rows.find((r) => r.channel === "EMAIL")!.recipient_masked).toBe("p***@famille.example.test");
    await dispatchTenant(deps, w.tenantId);
    const mail = ch.EMAIL.sent.slice(sendersBefore).find((m) => m.address === "payeur@famille.example.test")!;
    expect(mail.text).toContain("60 000 F CFA");
    expect(mail.text).toContain("12 jours de retard");
    expect(ch.WHATSAPP.sent.at(-1)!.address).toBe("+2250707070707");
    const inApp = await adminRows<{ body: string; system_code: string }>(w, "SELECT body, system_code FROM messaging.messages WHERE system_code = 'notifications.payment_reminder'");
    expect(inApp).toHaveLength(1);
    // Facture soldée : plus aucune relance, et une relance en attente est annulée à l'envoi.
    w.clock.advance(35 * 86_400_000); // +35 jours : palier J+45 atteint (47 jours de retard)
    expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ notified: 1 });
    const invoiceId = (await adminRows<{ id: string }>(w, "SELECT id FROM finance.invoices WHERE learner_id = $1", [learnerId]))[0]!.id;
    unwrap(await recordManualPayment(fin, w.director, { idempotencyKey: `pay-${newId()}`, learnerId, amount: xof(60_000), method: "TRANSFER", reference: "VIR-B", allocation: { mode: "AUTO", invoiceIds: [invoiceId] } }));
    const report = await dispatchTenant(deps, w.tenantId);
    expect(report.cancelled).toBeGreaterThanOrEqual(1);
    expect(unwrap(await runDunning(deps, sys()))).toMatchObject({ examined: 0, notified: 0 });
    const stages = (await adminRows<{ stage_days: number }>(w, "SELECT stage_days FROM notifications.dunning_steps ORDER BY stage_days")).map((s) => s.stage_days);
    expect(stages).toEqual([7, 21, 45]);
  });

  it("événement réel -> règle -> tuteurs réels : absence notifiée par le premier canal joignable (WhatsApp), numéro normalisé", async () => {
    const before = ch.WHATSAPP.sent.length;
    const r = unwrap(await onDomainEvent(deps, sys(), { eventId: newId(), eventType: "attendance.absence.recorded", payload: { v: 1, sessionId: newId(), recordId: newId(), enrollmentId: school.pupils[0]!.enrollmentId, studentId: school.pupils[0]!.studentId, classroomId: school.ref.classroomId, date: dayOffset(w, 0), occurrenceId: null, statusCode: "ABSENT", excused: false, countedMinutes: null, correction: false } }));
    expect(r.queued).toBe(2);
    await dispatchTenant(deps, w.tenantId);
    const sent = ch.WHATSAPP.sent.slice(before).map((m) => m.address).sort();
    expect(sent).toEqual(["+2250555555512", "+2250707070707"]); // le tuteur SANS compte est joint par son téléphone
  });

  it("annonce publiée réelle : titre, extrait, priorité et destinataires figés ; retirée = non relayée", async () => {
    const msg = createMessagingDeps({ db: w.tenantDb, clock: w.clock, ports: { ...w.ports.messaging, storage: new InMemoryStorage() } });
    const admin = createRequestContext({ tenantId: w.tenantId, userId: u.director });
    const created = unwrap(
      await createAnnouncement(msg, admin, {
        title: "Fermeture exceptionnelle",
        body: "L'établissement est fermé demain.\nMerci de votre compréhension.",
        priority: "URGENT",
        audience: { targets: [{ kind: "CLASSROOM", ref: school.ref.classroomId }], audiences: ["GUARDIANS", "STUDENTS"] },
        requireAck: false,
        pinned: false,
        attachmentIds: [],
        publish: true,
        caps: { announcementPublish: true, announcementManage: true },
      }),
    );
    const feed = w.ports.notifications.announcements!;
    const view = await feed.read(sys(), created.id);
    expect(view).toMatchObject({ title: "Fermeture exceptionnelle", summary: "L'établissement est fermé demain.", priority: "URGENT" });
    expect([...view!.recipientUserIds].sort()).toEqual([u.payer, u.student1].sort());
    unwrap(await withdrawAnnouncement(msg, admin, { announcementId: created.id, reason: "Erreur", caps: { announcementManage: true, announcementPublish: true } }));
    expect(await feed.read(sys(), created.id)).toBeNull();
    expect(await feed.read(sys(), newId())).toBeNull();
  });

  it("charge d'enseignement réelle (heures planifiées de l'année en cours) et résultats FINAL : rien de clôturé = aucune paire", async () => {
    await w.db.admin.query("UPDATE people.teaching_assignments SET planned_hours = 900 WHERE staff_id = $1", [school.teacher.staffId]);
    const loads = await w.ports.notifications.teachingLoad!.listLoads(sys());
    expect(loads).toEqual([{ staffId: school.teacher.staffId, staffName: expect.stringContaining("ENSEIGNANT"), plannedHours: 900 }]);
    expect(await w.ports.notifications.grades!.listConsecutiveFinals(sys())).toEqual([]);
  });
});
