/**
 * Messagerie assemblée sur Postgres réel avec les VRAIS adaptateurs (people + academic + rbac -> messaging, aucun port en
 * mémoire entre modules) : liens de tutelle et d'affectation réels, titulaires de rôles réels, comptes réels (`identity_id`).
 *
 *   école supérieure d'assemblage (1 classe, 3 élèves inscrits), un enseignant AFFECTÉ, un enseignant NON affecté, des tuteurs
 *   (père et mère d'un élève, tuteur d'un autre, tuteur SANS accès au portail, tuteur dont le lien est CLOS), des comptes
 *   d'élèves, une direction et un secrétariat (rôles RBAC réels).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, createSystemContext, newId, noopLogger, unwrap, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PgOutboxWriter } from "@ecoledigitale/database";
import { createGuardian, createStaff, linkGuardian, unlinkGuardian } from "../../src/modules/people";
import { assignSystemRoleUseCase, instantiateSystemRoles, noopAudit as noopRbacAudit } from "../../src/modules/rbac";
import {
  createAnnouncement,
  createConversation,
  createMessagingDeps,
  InMemoryStorage,
  listAllowedRecipients,
  listConversations,
  onAttendanceRecorded,
  previewAudience,
  type CallerCaps,
  type CreateConversationInput,
  type MessagingDeps,
} from "../../src/modules/messaging";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const CAPS = {
  admin: { sendAny: true, send: true, announcementPublish: true, announcementManage: true } satisfies CallerCaps,
  teacher: { send: true, announcementPublishClass: true } satisfies CallerCaps,
  parent: { childSend: true } satisfies CallerCaps,
  student: { selfSend: true } satisfies CallerCaps,
};

function expectErr<T>(r: Result<T, AppError>, code: string): void {
  expect(r.ok, `attendu : erreur « ${code} »`).toBe(false);
  if (!r.ok) expect(r.error.code).toBe(code);
}

describeIntegration("messagerie : people + academic + rbac -> messaging (adaptateurs réels)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let deps: MessagingDeps;
  const u = {
    teacher: newId(), // affecté à la classe
    teacherOut: newId(), // personnel enseignant NON affecté
    father: newId(), // père de l'élève 1
    mother: newId(), // mère de l'élève 1
    guardian2: newId(), // tuteur de l'élève 2
    noPortal: newId(), // tuteur de l'élève 3 SANS accès au portail
    formerGuardian: newId(), // tuteur de l'élève 1 dont le lien est clos
    student1: newId(),
    student2: newId(),
    director: newId(),
    secretary: newId(),
    ghost: newId(), // aucun lien avec l'école
  };
  const ctxOf = (userId: string): RequestContext => createRequestContext({ tenantId: w.tenantId, userId });

  let seq = 0;
  const link = async (studentId: string, identity: string, code: "FATHER" | "MOTHER" | "LEGAL_GUARDIAN", extra: Record<string, unknown> = {}, name = "TUTEUR") => {
    seq += 1;
    const g = unwrap(await createGuardian(w.kit.people, w.director, { person: { lastName: name, firstName: `${code}${seq}`, sex: code === "MOTHER" ? "F" : "M", birthDate: `19${70 + seq}-05-0${seq}`, email: `g${identity.slice(-12)}@example.test` } })).guardian;
    await w.db.admin.query("UPDATE people.persons SET identity_id = $2 WHERE id = $1", [g.personId, identity]);
    const l = unwrap(await linkGuardian(w.kit.people, w.director, studentId, { guardianId: g.id, relationshipCode: code, ...extra }));
    return { guardian: g, link: l };
  };

  const send = (from: string, caps: CallerCaps, input: Partial<CreateConversationInput> & { to?: string }) =>
    createConversation(deps, ctxOf(from), {
      kind: "DIRECT",
      body: "Bonjour",
      priority: "NORMAL",
      recipients: { userIds: input.to ? [input.to] : [], classrooms: [], toAdministration: false },
      attachmentIds: [],
      caps,
      ...input,
    });

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 3 });
    // L'annuaire des établissements (tenancy) connaît l'établissement de la graine : requis pour valider une cible INSTITUTION.
    await w.db.admin.query("INSERT INTO tenancy.institutions (id, tenant_id, code, name, pack, education_system, country_code) VALUES ($1, $2, 'inst-asm', 'Institut', 'HIGHER', 'CI', 'CI')", [w.academic.institutionId, w.tenantId]);
    deps = createMessagingDeps({ db: w.tenantDb, clock: w.clock, ports: { ...w.ports.messaging, storage: new InMemoryStorage() } });
    const [p1, p2, p3] = school.pupils;

    // Comptes d'élèves (liaison explicite personne <-> identité).
    for (const [pupil, identity] of [[p1!, u.student1], [p2!, u.student2]] as const) {
      await w.db.admin.query("UPDATE people.persons SET identity_id = $2 WHERE id = (SELECT person_id FROM people.students WHERE id = $1)", [pupil.studentId, identity]);
    }
    // Tuteurs.
    await link(p1!.studentId, u.father, "FATHER", {}, "PERE");
    await link(p1!.studentId, u.mother, "MOTHER", {}, "MERE");
    await link(p2!.studentId, u.guardian2, "LEGAL_GUARDIAN", {}, "TUTEUR2");
    await link(p3!.studentId, u.noPortal, "LEGAL_GUARDIAN", { portalAccess: false }, "SANSPORTAIL");
    const former = await link(p1!.studentId, u.formerGuardian, "LEGAL_GUARDIAN", {}, "ANCIEN");
    unwrap(await unlinkGuardian(w.kit.people, w.director, p1!.studentId, former.link.id, { reason: "Fin de la tutelle" }));

    // Personnel : un enseignant NON affecté (fiche + compte) ; l'enseignant affecté vient de la graine (compte `teacher.ctx.userId`).
    const out = unwrap(await createStaff(w.kit.people, w.director, { person: { lastName: "HORS", firstName: "Classe", sex: "M", birthDate: "1988-02-02", email: "hors@example.test" }, categoryCode: "TEACHER" }));
    if (out.kind !== "created") throw new Error("création attendue");
    await w.db.admin.query("UPDATE people.persons SET identity_id = $2 WHERE id = $1", [out.staff.personId, u.teacherOut]);
    u.teacher = school.teacher.ctx.userId as string;

    // Direction et secrétariat : rôles RBAC réels (aucune fiche de personnel : le rôle prouve l'existence du compte).
    const sys = createSystemContext(w.tenantId);
    await w.tenantDb.run(sys, async (tx) => {
      await instantiateSystemRoles(tx, w.tenantId, { logger: noopLogger, clock: w.clock });
      const rbacDeps = { tx, clock: w.clock, outbox: new PgOutboxWriter(tx), audit: noopRbacAudit, logger: noopLogger };
      unwrap(await assignSystemRoleUseCase(rbacDeps, sys, { templateKey: "directeur", userId: u.director }));
      unwrap(await assignSystemRoleUseCase(rbacDeps, sys, { templateKey: "secretariat", userId: u.secretary }));
    });
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  // ---------------------------------------------------------------------------------------------------------
  it("annuaire : profils réels (élève, tuteur, enseignant affecté, direction par rôle) ; compte inconnu absent", async () => {
    const dir = w.ports.messaging.directory!;
    const profiles = await dir.getProfiles(ctxOf(u.father), [u.father, u.teacher, u.student1, u.director, u.ghost, u.formerGuardian, u.noPortal]);
    const classroom = school.ref.classroomId;
    expect(profiles.get(u.father)).toMatchObject({ childStudentIds: [school.pupils[0]!.studentId], childClassroomIds: [classroom], staffId: null, studentId: null });
    expect(profiles.get(u.father)!.displayName).toContain("PERE");
    expect(profiles.get(u.teacher)).toMatchObject({ staffId: school.teacher.staffId, teachingClassroomIds: [classroom] });
    expect(profiles.get(u.student1)).toMatchObject({ studentId: school.pupils[0]!.studentId, studentClassroomIds: [classroom] });
    expect(profiles.get(u.director)).toMatchObject({ staffId: null, studentId: null, childStudentIds: [] }); // existe par son rôle
    expect(profiles.has(u.ghost)).toBe(false);
    // Le lien clos et l'accès « sans portail » n'ouvrent AUCUNE tutelle (même règle que le reste de la plateforme).
    expect(profiles.get(u.formerGuardian)).toBeUndefined();
    expect(profiles.get(u.noPortal)).toBeUndefined();
  });

  it("annuaire : personnes joignables d'une classe (élèves avec compte, tuteurs, enseignants affectés)", async () => {
    const dir = w.ports.messaging.directory!;
    const room = await dir.listClassroomContacts(ctxOf(u.teacher), school.ref.classroomId, ["STUDENTS", "GUARDIANS", "TEACHERS"]);
    expect(room.classroom?.name).toBe("Licence 1 A");
    const byKind = (kind: string) => room.contacts.filter((c) => c.kind === kind).map((c) => c.userId).sort();
    expect(byKind("STUDENT")).toEqual([u.student1, u.student2].sort());
    expect(byKind("GUARDIAN")).toEqual([u.father, u.mother, u.guardian2].sort()); // ni l'ancien tuteur, ni le tuteur sans portail
    expect(byKind("STAFF")).toEqual([u.teacher]);
    expect(room.contacts.find((c) => c.userId === u.father)).toMatchObject({ studentId: school.pupils[0]!.studentId, studentName: expect.stringContaining("ETUDIANT1") });
    expect((await dir.listClassroomContacts(ctxOf(u.teacher), newId(), ["STUDENTS"])).classroom).toBeNull();
  });

  it("annuaire : titulaires de rôles RBAC réels (contacts de l'administration)", async () => {
    const holders = await w.ports.messaging.directory!.listUsersWithRoles(ctxOf(u.father), ["directeur", "secretariat"]);
    expect(holders.map((h) => h.userId).sort()).toEqual([u.director, u.secretary].sort());
    expect(await w.ports.messaging.directory!.listUsersWithRoles(ctxOf(u.father), ["role_inexistant"])).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------
  it("matrice réelle : le tuteur lié écrit à l'enseignant affecté et à la direction ; pas à l'enseignant hors classe, ni à un autre tuteur", async () => {
    unwrap(await send(u.father, CAPS.parent, { to: u.teacher, subject: "Devoirs" }));
    unwrap(await send(u.father, CAPS.parent, { to: u.director, subject: "Certificat" }));
    expectErr(await send(u.father, CAPS.parent, { to: u.teacherOut, subject: "Hors classe" }), "messaging.recipient_not_allowed");
    expectErr(await send(u.father, CAPS.parent, { to: u.mother, subject: "Parent à parent" }), "messaging.recipient_not_allowed");
    expectErr(await send(u.father, CAPS.parent, { to: u.student1, subject: "Parent à élève" }), "messaging.recipient_not_allowed");
    expectErr(await send(u.father, CAPS.parent, { to: u.ghost, subject: "Inconnu" }), "messaging.recipient_not_allowed");
  });

  it("tuteur dont le lien est CLOS, tuteur SANS accès au portail, compte sans lien : aucune initiative", async () => {
    for (const user of [u.formerGuardian, u.noPortal, u.ghost]) {
      expectErr(await send(user, CAPS.parent, { to: u.teacher, subject: "Sans lien" }), "messaging.forbidden");
    }
  });

  it("l'enseignant affecté écrit aux élèves et à TOUS les tuteurs de sa classe ; pas à celui d'un lien clos ni sans portail", async () => {
    const r = unwrap(
      await createConversation(deps, ctxOf(u.teacher), {
        kind: "GROUP", subject: "Réunion de classe", body: "Réunion mardi", priority: "NORMAL",
        recipients: { userIds: [], classrooms: [{ classroomId: school.ref.classroomId, include: ["GUARDIANS"] }], toAdministration: false }, attachmentIds: [], caps: CAPS.teacher,
      }),
    );
    expect(r.conversation!.participants.map((p) => p.userId).sort()).toEqual([u.father, u.mother, u.guardian2].sort());
    unwrap(await send(u.teacher, CAPS.teacher, { to: u.student1, subject: "Rappel" }));
    unwrap(await send(u.teacher, CAPS.teacher, { to: u.father, subject: "Rappel parent" }));
    expectErr(await send(u.teacher, CAPS.teacher, { to: u.formerGuardian, subject: "Ancien tuteur" }), "messaging.recipient_not_allowed");
    expectErr(await send(u.teacher, CAPS.teacher, { to: u.noPortal, subject: "Sans portail" }), "messaging.recipient_not_allowed");
    expectErr(await send(u.teacher, CAPS.teacher, { to: u.ghost, subject: "Sans lien" }), "messaging.recipient_not_allowed");
  });

  it("l'enseignant NON affecté n'écrit ni aux élèves ni aux tuteurs de la classe ; il écrit au personnel", async () => {
    expectErr(await send(u.teacherOut, CAPS.teacher, { to: u.student1, subject: "Hors classe" }), "messaging.recipient_not_allowed");
    expectErr(await send(u.teacherOut, CAPS.teacher, { to: u.father, subject: "Hors classe" }), "messaging.recipient_not_allowed");
    expectErr(
      await createConversation(deps, ctxOf(u.teacherOut), {
        kind: "GROUP", subject: "Classe étrangère", body: "x", priority: "NORMAL",
        recipients: { userIds: [], classrooms: [{ classroomId: school.ref.classroomId, include: ["STUDENTS"] }], toAdministration: false }, attachmentIds: [], caps: CAPS.teacher,
      }),
      "messaging.recipient_not_allowed",
    );
    unwrap(await send(u.teacherOut, CAPS.teacher, { to: u.teacher, subject: "Entre collègues" }));
    unwrap(await send(u.teacherOut, CAPS.teacher, { to: u.director, subject: "À la direction" }));
  });

  it("l'élève : politique de l'établissement appliquée (enseignants de sa classe, direction)", async () => {
    const settingsUpdate = (studentPolicy: "DISABLED" | "TEACHERS" | "TEACHERS_AND_ADMIN") =>
      w.db.admin.query("INSERT INTO messaging.settings (tenant_id, student_policy) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET student_policy = EXCLUDED.student_policy", [w.tenantId, studentPolicy]);
    await settingsUpdate("TEACHERS");
    unwrap(await send(u.student1, CAPS.student, { to: u.teacher, subject: "Question" }));
    expectErr(await send(u.student1, CAPS.student, { to: u.teacherOut, subject: "Hors classe" }), "messaging.recipient_not_allowed");
    expectErr(await send(u.student1, CAPS.student, { to: u.director, subject: "Direction" }), "messaging.recipient_not_allowed");
    expectErr(await send(u.student1, CAPS.student, { to: u.student2, subject: "Camarade" }), "messaging.recipient_not_allowed");
    await settingsUpdate("TEACHERS_AND_ADMIN");
    unwrap(await send(u.student1, CAPS.student, { to: u.director, subject: "Certificat de scolarité" }));
    await settingsUpdate("DISABLED");
    expectErr(await send(u.student1, CAPS.student, { to: u.teacher, subject: "Désactivé" }), "messaging.student_messaging_disabled");
    await settingsUpdate("TEACHERS_AND_ADMIN");
  });

  it("le sélecteur de destinataires ne propose que des personnes autorisées (réel)", async () => {
    const father = unwrap(await listAllowedRecipients(deps, ctxOf(u.father), { limit: 50, caps: CAPS.parent })).items;
    const ids = father.map((i) => i.userId);
    expect(ids).toContain(u.teacher);
    expect(ids).toContain(u.director);
    expect(ids).toContain(u.secretary);
    for (const forbidden of [u.teacherOut, u.mother, u.student1, u.ghost]) expect(ids).not.toContain(forbidden);
    expect(father.find((i) => i.userId === u.teacher)!.relation).toContain("Licence 1 A");
    const byName = unwrap(await listAllowedRecipients(deps, ctxOf(u.father), { q: "HORS", limit: 20, caps: CAPS.parent })).items;
    expect(byName).toEqual([]); // l'enseignant hors classe existe, mais n'est pas proposé
    const teacher = unwrap(await listAllowedRecipients(deps, ctxOf(u.teacher), { q: "PERE", limit: 20, caps: CAPS.teacher })).items;
    expect(teacher.map((i) => i.userId)).toEqual([u.father]);
  });

  // ---------------------------------------------------------------------------------------------------------
  it("annonces : audience résolue par les vrais liens (classe, établissement, personnel, rôle)", async () => {
    const preview = async (targets: Array<{ kind: "TENANT" | "INSTITUTION" | "CLASSROOM" | "ROLE"; ref?: string }>, audiences: Array<"STUDENTS" | "GUARDIANS" | "STAFF">) =>
      unwrap(await previewAudience(deps, ctxOf(u.director), { audience: { targets, audiences }, caps: CAPS.admin }));
    expect((await preview([{ kind: "CLASSROOM", ref: school.ref.classroomId }], ["GUARDIANS"])).count).toBe(3);
    expect((await preview([{ kind: "CLASSROOM", ref: school.ref.classroomId }], ["STUDENTS"])).count).toBe(2);
    expect((await preview([{ kind: "CLASSROOM", ref: school.ref.classroomId }], ["STAFF"])).count).toBe(1);
    expect((await preview([{ kind: "CLASSROOM", ref: school.ref.classroomId }], ["STUDENTS", "GUARDIANS", "STAFF"])).count).toBe(6);
    expect((await preview([{ kind: "INSTITUTION", ref: w.academic.institutionId }], ["GUARDIANS"])).count).toBe(3);
    expect((await preview([{ kind: "TENANT" }], ["STAFF"])).count).toBe(2); // deux fiches de personnel avec compte
    expect((await preview([{ kind: "ROLE", ref: "secretariat" }], ["STAFF"])).count).toBe(1);
    expectErr(await previewAudience(deps, ctxOf(u.director), { audience: { targets: [{ kind: "CLASSROOM", ref: newId() }], audiences: ["GUARDIANS"] }, caps: CAPS.admin }), "messaging.target_not_found");
    expectErr(await previewAudience(deps, ctxOf(u.director), { audience: { targets: [{ kind: "INSTITUTION", ref: newId() }], audiences: ["GUARDIANS"] }, caps: CAPS.admin }), "messaging.target_not_found");
    expectErr(await createAnnouncement(deps, ctxOf(u.director), { title: "Vide", body: "x", priority: "NORMAL", audience: { targets: [{ kind: "ROLE", ref: "role_inexistant" }], audiences: ["STAFF"] }, requireAck: false, pinned: false, attachmentIds: [], publish: true, caps: CAPS.admin }), "messaging.audience_empty");
  });

  it("annonce publiée : seuls les vrais tuteurs de la classe la reçoivent", async () => {
    const a = unwrap(await createAnnouncement(deps, ctxOf(u.director), { title: "Réunion", body: "Mardi 17h", priority: "HIGH", audience: { targets: [{ kind: "CLASSROOM", ref: school.ref.classroomId }], audiences: ["GUARDIANS"] }, requireAck: true, pinned: false, attachmentIds: [], publish: true, caps: CAPS.admin }));
    expect(a.stats).toMatchObject({ recipients: 3 });
    const rows = await adminRows<{ user_id: string }>(w, "SELECT user_id FROM messaging.announcement_recipients WHERE announcement_id = $1", [a.id]);
    expect(rows.map((r) => r.user_id).sort()).toEqual([u.father, u.mother, u.guardian2].sort());
  });

  // ---------------------------------------------------------------------------------------------------------
  it("absence détectée : les VRAIS tuteurs de l'élève reçoivent le message système (pas l'ancien tuteur ni le tuteur sans portail)", async () => {
    const studentId = school.pupils[0]!.studentId;
    const payload = { v: 1, studentId, date: "2026-10-02", excused: false, correction: false, recordId: newId() };
    const r = unwrap(await onAttendanceRecorded(deps, createSystemContext(w.tenantId), { eventId: newId(), kind: "ABSENCE", payload }));
    expect(r.delivered).toBe(2);
    for (const parent of [u.father, u.mother]) {
      const alerts = unwrap(await listConversations(deps, ctxOf(parent), { folder: "inbox", limit: 20 })).items.find((c) => c.kind === "SYSTEM");
      expect(alerts, parent).toBeDefined();
    }
    for (const other of [u.formerGuardian, u.noPortal, u.guardian2]) {
      expect(unwrap(await listConversations(deps, ctxOf(other), { folder: "inbox", limit: 20 })).items.some((c) => c.kind === "SYSTEM")).toBe(false);
    }
    const unknown = unwrap(await onAttendanceRecorded(deps, createSystemContext(w.tenantId), { eventId: newId(), kind: "ABSENCE", payload: { ...payload, studentId: newId() } }));
    expect(unknown.skipped).toBe("student_unknown");
  });

  it("compte suspendu (projection IAM) : plus joignable ; réactivé : à nouveau joignable", async () => {
    const setMembership = (status: string) =>
      w.db.admin.query(
        `INSERT INTO people.identity_memberships (tenant_id, identity_id, status, source_event_id, source_occurred_at) VALUES ($1, $2, $3, gen_random_uuid(), now())
         ON CONFLICT (tenant_id, identity_id) DO UPDATE SET status = EXCLUDED.status`,
        [w.tenantId, u.mother, status],
      );
    await setMembership("suspended");
    expectErr(await send(u.teacher, CAPS.teacher, { to: u.mother, subject: "Compte suspendu" }), "messaging.recipient_not_allowed");
    const room = await w.ports.messaging.directory!.listClassroomContacts(ctxOf(u.teacher), school.ref.classroomId, ["GUARDIANS"]);
    expect(room.contacts.some((c) => c.userId === u.mother)).toBe(false);
    await setMembership("active");
    unwrap(await send(u.teacher, CAPS.teacher, { to: u.mother, subject: "Compte réactivé" }));
  });

  it("isolation : un autre tenant ne voit aucune conversation du tenant d'assemblage", async () => {
    const otherTenant = newId();
    await w.db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [otherTenant, `autre-${otherTenant.slice(-8)}`, "Autre"]);
    const ctx = createRequestContext({ tenantId: otherTenant, userId: u.father });
    expect(unwrap(await listConversations(deps, ctx, { folder: "inbox", limit: 50 })).items).toEqual([]);
    const profiles = await w.ports.messaging.directory!.getProfiles(ctx, [u.father, u.teacher, u.director]);
    expect(profiles.size).toBe(0);
  });
});
