import { afterAll, beforeAll, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, noopLogger, type RequestContext } from "@ecoledigitale/kernel";
import {
  attendanceAbsencesPageDtoSchema,
  attendanceAttachmentDtoSchema,
  attendanceCallPolicyDtoSchema,
  attendanceClassroomSummaryDtoSchema,
  attendanceComplianceDtoSchema,
  attendanceJustificationDtoSchema,
  attendanceMarkResultDtoSchema,
  attendanceOpenSessionResultDtoSchema,
  attendancePortalDtoSchema,
  attendanceRecordHistoryDtoSchema,
  attendanceSessionDetailDtoSchema,
  attendanceSessionDtoSchema,
  attendanceSettingsDtoSchema,
  attendanceSignedUrlDtoSchema,
  attendanceStaffRecordDtoSchema,
  attendanceStaffSummaryDtoSchema,
  attendanceStatusDefinitionDtoSchema,
  attendanceSummaryDtoSchema,
  attendanceSyncConflictDtoSchema,
  attendanceSyncResultDtoSchema,
  attendanceLeaveDtoSchema,
  attendanceEventPayloadSchemas,
} from "@ecoledigitale/contracts/src/v2/attendance";
import type { ModuleRuntime } from "../../../../platform/runtime";
import manifest from "../../manifest";
import attendanceModulePlugin, { attendancePlugin, registerAttendancePorts, setup } from "../../http/plugin";
import { createAttendanceDeps } from "../../application/deps";
import { unavailablePorts } from "../../infrastructure/in-memory-ports";
import { adminOne, adminRows, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

const ALL = manifest.permissions.map((p) => p.key);
const PDF_B64 = Buffer.from("%PDF-1.4\nordonnance de test").toString("base64");
const EXE_B64 = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4]).toString("base64");

interface Who {
  ctx: RequestContext;
  perms: string[];
}

describeIntegration("API HTTP /api/v1/attendance/* (Fastify + Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;
  let app: FastifyInstance;
  let features: Set<string>;
  const identities = new Map<string, Who>();

  const as = (name: string, ctx: RequestContext, perms: string[]) => {
    identities.set(name, { ctx, perms });
    return name;
  };
  let teacher: string;
  let coTeacher: string;
  let director: string;
  let guardian: string;
  let otherGuardian: string;
  let pupil: string;
  let anonymous: string;

  const call = async (who: string | null, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({
      method,
      url: `/api/v1/attendance${url}`,
      headers: { ...(who ? { "x-test-identity": who } : {}), ...headers },
      ...(body !== undefined ? { payload: body as never } : {}),
    });
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON (CSV) */
    }
    return { status: res.statusCode, json, body: res.body, headers: res.headers };
  };
  const ok = <T>(r: { status: number; json: T }, status = 200): T => {
    expect(r.status, JSON.stringify(r.json)).toBe(status);
    return r.json;
  };

  beforeAll(async () => {
    db = await createAttendanceTestDb();
    world = makeWorld(db, "2025-10-01T12:00:00.000Z");
    school = await seedSchool(db, world, { students: 6 });
    features = new Set(["attendance.staff", "attendance.offline", "attendance.live-bridge"]);
    teacher = as("teacher", school.teacher.ctx, ["attendance.read", "attendance.take"]);
    coTeacher = as("coTeacher", school.coTeacher.ctx, ["attendance.read", "attendance.take"]);
    director = as("director", school.admin.ctx, ALL);
    guardian = as("guardian", school.guardian.ctx, ["attendance.child.read", "attendance.child.justify"]);
    otherGuardian = as("otherGuardian", school.otherGuardian.ctx, ["attendance.child.read", "attendance.child.justify"]);
    pupil = as("pupil", school.pupil.ctx, ["attendance.self.read", "attendance.self.justify"]);
    anonymous = as("anonymous", createRequestContext({ tenantId: school.tenantId, userId: newId(), roles: [] }), []);
    as("outsider", school.outsider.ctx, ["attendance.read", "attendance.take", "attendance.own.read", "attendance.own.record", "attendance.leave.request"]);

    app = Fastify({ logger: false });
    // Authentification simulée : `request.ctx` posé en amont (iam en production). Aucun en-tête d'identité du client n'est lu par le module.
    app.addHook("onRequest", async (req) => {
      const id = req.headers["x-test-identity"];
      const who = typeof id === "string" ? identities.get(id) : undefined;
      if (who) (req as unknown as { ctx: RequestContext }).ctx = who.ctx;
    });
    const requirePermission = (permission: string) =>
      async function guard(this: FastifyInstance, req: FastifyRequest): Promise<void> {
        const id = req.headers["x-test-identity"];
        const who = typeof id === "string" ? identities.get(id) : undefined;
        if (!who) throw new UnauthorizedError();
        if (!who.perms.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      };
    await app.register(attendancePlugin, {
      deps: createAttendanceDeps({ db: db.tenantDb, clock: world.clock, ports: world.ports, audit: world.audit }),
      requirePermission,
      requireFeature: (feature: string) =>
        async function gate() {
          if (!features.has(feature)) throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
        },
      prefix: "/api/v1/attendance",
    } as never);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  let sessionId: string;
  let occurrenceId: string;

  it("401 sans contexte, 403 sans permission, 404 inconnu ; l'identité vient du contexte et JAMAIS d'un en-tête client (x-user-id)", async () => {
    expect((await call(null, "GET", "/sessions")).status).toBe(401);
    const forbidden = await call(anonymous, "GET", "/sessions");
    expect(forbidden.status).toBe(403);
    expect(forbidden.json).toMatchObject({ status: 403, kind: "forbidden" });
    expect((await call(teacher, "POST", "/sessions/" + newId() + "/validate")).status).toBe(403);
    expect((await call(teacher, "GET", `/sessions/${newId()}`)).json).toMatchObject({ status: 404, code: "attendance.session_not_found" });

    const occ = addOccurrence(world, school);
    occurrenceId = occ.occurrenceId;
    const opened = ok(await call(teacher, "POST", "/sessions", { occurrenceId }, { "x-user-id": school.admin.userId }), 201);
    const parsed = attendanceOpenSessionResultDtoSchema.parse(opened);
    sessionId = parsed.session.id;
    expect(parsed.session.takenByUserId).toBe(school.teacher.userId); // pas l'identifiant forgé de l'en-tête
    expect(parsed.created).toBe(true);
  });

  it("valide strictement les entrées : champ inconnu, UUID invalide, statut mal formé, lot vide ou trop gros -> 400 stable", async () => {
    for (const [body, url] of [
      [{ occurrenceId, extra: 1 }, "/sessions"],
      [{ occurrenceId: "pas-un-uuid" }, "/sessions"],
      [{ entries: [] }, `/sessions/${sessionId}/records`],
      [{ entries: [{ studentId: school.students[0]!.studentId, statusCode: "absent" }] }, `/sessions/${sessionId}/records`],
      [{ entries: Array.from({ length: 501 }, () => ({ studentId: newId(), statusCode: "ABSENT" })) }, `/sessions/${sessionId}/records`],
    ] as const) {
      const r = await call(teacher, url.endsWith("records") ? "PUT" : "POST", url, body);
      expect(r.status, url).toBe(400);
      expect(r.json).toMatchObject({ status: 400, kind: "validation", code: "VALIDATION_FAILED" });
      expect(Array.isArray(r.json.issues)).toBe(true);
    }
    expect((await call(teacher, "GET", "/sessions/pas-un-uuid")).status).toBe(400);
    const malformed = await app.inject({ method: "POST", url: "/api/v1/attendance/sessions", headers: { "x-test-identity": teacher, "content-type": "application/json" }, payload: "{oops" });
    expect(malformed.statusCode).toBe(400);
  });

  it("appel complet en HTTP : ouvrir (idempotent), pointer en lot (idempotent), consulter, soumettre, historique, valider, rouvrir (sensible)", async () => {
    const again = ok(await call(coTeacher, "POST", "/sessions", { occurrenceId }), 200);
    expect(attendanceOpenSessionResultDtoSchema.parse(again)).toMatchObject({ created: false, session: { id: sessionId } });
    expect((await call(as("stranger", createRequestContext({ tenantId: school.tenantId, userId: newId(), roles: [] }), ["attendance.take", "attendance.read"]), "POST", "/sessions", { occurrenceId })).json).toMatchObject({ code: "attendance.not_call_taker" });

    const [s0, s1, s2] = school.students;
    const entries = [
      { studentId: s0!.studentId, statusCode: "ABSENT", note: "Pas là" },
      { studentId: s1!.studentId, statusCode: "LATE", minutesLate: 9 },
      { studentId: s2!.studentId, statusCode: "PRESENT" },
    ];
    const bodySize = Buffer.byteLength(JSON.stringify({ entries: school.students.concat(school.students, school.students, school.students, school.students, school.students, school.students, school.students, school.students, school.students).slice(0, 60).map((s) => ({ studentId: s.studentId, statusCode: "PRESENT" })) }));
    expect(bodySize).toBeLessThan(20 * 1024); // AC1.5 : < 20 Ko pour 60 élèves

    const marked = attendanceMarkResultDtoSchema.parse(ok(await call(teacher, "PUT", `/sessions/${sessionId}/records`, { entries })));
    expect(marked).toMatchObject({ created: 3, updated: 0, unchanged: 0 });
    const replay = attendanceMarkResultDtoSchema.parse(ok(await call(teacher, "PUT", `/sessions/${sessionId}/records`, { entries })));
    expect(replay).toMatchObject({ created: 0, updated: 0, unchanged: 3 });

    const detail = attendanceSessionDetailDtoSchema.parse(ok(await call(teacher, "GET", `/sessions/${sessionId}`)));
    expect(detail.counts).toMatchObject({ rosterSize: 6, marked: 3, unmarked: 3, absent: 1, late: 1 });
    expect(detail.editable).toBe(true);
    expect(detail.students.find((s) => s.studentId === s0!.studentId)).toMatchObject({ displayName: "Élève 01", inRoster: true, record: { statusCode: "ABSENT" } });

    const refused = await call(teacher, "POST", `/sessions/${sessionId}/submit`, {});
    expect(refused.json).toMatchObject({ status: 400, code: "attendance.unmarked_students" });
    const submitted = ok(await call(teacher, "POST", `/sessions/${sessionId}/submit`, { allPresent: true }));
    expect(submitted).toMatchObject({ alreadySubmitted: false, filledByDefault: 3, absentCount: 1, lateCount: 1 });
    attendanceSessionDtoSchema.parse(submitted.session);

    const rid = marked.records.find((r) => r.studentId === s0!.studentId)!.id;
    ok(await call(teacher, "PUT", `/sessions/${sessionId}/records`, { entries: [{ studentId: s0!.studentId, statusCode: "PRESENT" }] }));
    const history = attendanceRecordHistoryDtoSchema.parse(ok(await call(teacher, "GET", `/sessions/${sessionId}/records/${rid}/history`)));
    expect(history.items.map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, "ABSENT"], ["ABSENT", "PRESENT"]]);

    expect((await call(teacher, "POST", `/sessions/${sessionId}/validate`)).status).toBe(403);
    ok(await call(director, "POST", `/sessions/${sessionId}/validate`));
    const locked = await call(director, "PUT", `/sessions/${sessionId}/records`, { entries: [{ studentId: s0!.studentId, statusCode: "ABSENT" }] });
    expect(locked.json).toMatchObject({ status: 409, code: "attendance.session_locked" });

    // Réouverture : permission sensible dédiée (la garde RBAC exige aussi la MFA), motif obligatoire.
    expect((await call(as("manager", school.admin.ctx, ALL.filter((p) => p !== "attendance.session.reopen")), "POST", `/sessions/${sessionId}/reopen`, { reason: "Erreur de saisie" })).status).toBe(403);
    expect((await call(director, "POST", `/sessions/${sessionId}/reopen`, { reason: "x" })).status).toBe(400);
    const reopened = ok(await call(director, "POST", `/sessions/${sessionId}/reopen`, { reason: "Erreur de saisie de l'enseignant" }));
    expect(reopened).toMatchObject({ status: "SUBMITTED", reopenedCount: 1 });
    expect(world.audit.actions()).toContain("attendance.session.reopened");
  });

  it("événements publiés conformes aux schémas du contrat (versionnés v1, sans donnée sensible)", async () => {
    const rows = await adminRows<{ type: string; payload: unknown; version: number }>(db, "SELECT type, payload, version FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE 'attendance.%'", [school.tenantId]);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      const schema = (attendanceEventPayloadSchemas as Record<string, { parse: (v: unknown) => unknown }>)[r.type];
      expect(schema, r.type).toBeDefined();
      expect(() => schema!.parse(r.payload), r.type).not.toThrow();
      expect(r.version).toBe(1);
    }
    expect([...new Set(rows.map((r) => r.type))]).toEqual(expect.arrayContaining(["attendance.session.opened", "attendance.session.submitted", "attendance.absence.recorded", "attendance.late.recorded", "attendance.session.validated", "attendance.session.reopened"]));
    // Tous les événements déclarés par le manifeste ont un schéma ; aucun n'est oublié.
    expect([...manifest.events.publishes].sort()).toEqual(Object.keys(attendanceEventPayloadSchemas).sort());
  });

  it("justificatif en HTTP : le parent dépose avec pièce, l'enseignant ne voit rien, la direction décide, le parent voit la décision", async () => {
    const created = ok(
      await call(guardian, "POST", "/justifications", { studentId: school.guardian.studentId, fromDate: "2025-10-01", toDate: "2025-10-01", reasonCode: "ILLNESS", comment: "Fièvre" }),
      201,
    );
    const j = attendanceJustificationDtoSchema.parse(created);
    expect(j).toMatchObject({ status: "PENDING", submittedByKind: "GUARDIAN", coveredRecordCount: 0 });

    const bad = await call(guardian, "POST", `/justifications/${j.id}/attachments`, { fileName: "virus.pdf", contentBase64: EXE_B64 });
    expect(bad.json).toMatchObject({ status: 400, code: "attendance.attachment_type_rejected" });
    const att = attendanceAttachmentDtoSchema.parse(ok(await call(guardian, "POST", `/justifications/${j.id}/attachments`, { fileName: "ordonnance.pdf", contentBase64: PDF_B64 }), 201));
    expect(att).toMatchObject({ detectedMime: "application/pdf" });
    expect(JSON.stringify(att)).not.toMatch(/storage|attendance\/[0-9a-f-]+\/justifications/);

    // Le personnel enseignant (attendance.read/take) n'a ni la liste ni la pièce.
    expect((await call(teacher, "GET", "/justifications")).status).toBe(403);
    expect((await call(teacher, "GET", `/justifications/${j.id}`)).status).toBe(403);
    expect((await call(otherGuardian, "POST", "/justifications", { studentId: school.guardian.studentId, fromDate: "2025-10-01", toDate: "2025-10-01", reasonCode: "ILLNESS" })).json).toMatchObject({ code: "attendance.not_guardian" });
    expect((await call(otherGuardian, "GET", `/justifications/${j.id}`)).json).toMatchObject({ status: 404 });

    const url = attendanceSignedUrlDtoSchema.parse(ok(await call(guardian, "GET", `/justifications/${j.id}/attachments/${att.id}`)));
    expect(url.url).toContain("memory://");

    expect((await call(guardian, "POST", `/justifications/${j.id}/accept`, {})).status).toBe(403);
    const accepted = attendanceJustificationDtoSchema.parse(ok(await call(director, "POST", `/justifications/${j.id}/accept`, { note: "Vu" })));
    expect(accepted).toMatchObject({ status: "ACCEPTED", decisionNote: "Vu" });

    // Portail parent : motif et décision visibles ; un autre parent n'y accède pas (404) ; l'élève voit les siens.
    const portal = attendancePortalDtoSchema.parse(ok(await call(guardian, "GET", `/children/${school.guardian.studentId}/attendance?periodId=${school.termId}`)));
    expect(portal.justifications[0]).toMatchObject({ status: "ACCEPTED", reasonCode: "ILLNESS" });
    expect(portal.summary?.derived.sessionsTotal).toBeGreaterThanOrEqual(1);
    expect((await call(otherGuardian, "GET", `/children/${school.guardian.studentId}/attendance`)).status).toBe(404);
    expect(attendancePortalDtoSchema.parse(ok(await call(pupil, "GET", "/me/attendance"))).studentId).toBe(school.pupil.studentId);
    expect((await call(guardian, "GET", "/me/attendance")).status).toBe(403);

    const withdrawn = await call(guardian, "POST", `/justifications/${j.id}/withdraw`);
    expect(withdrawn.status).toBe(409);
    const removed = await call(guardian, "DELETE", `/justifications/${j.id}/attachments/${att.id}`);
    expect(removed.status).toBe(409); // plus de retrait après décision
  });

  it("récapitulatifs, surcharge tracée et rapports en HTTP (JSON et CSV sûr)", async () => {
    const e = school.students[0]!;
    const summary = attendanceSummaryDtoSchema.parse(ok(await call(director, "GET", `/enrollments/${e.enrollmentId}/summary?periodId=${school.termId}`)));
    expect(summary.derived.sessionsTotal).toBe(1);
    const viaStudent = attendanceSummaryDtoSchema.parse(ok(await call(director, "GET", `/students/${e.studentId}/summary?periodId=${school.termId}`)));
    expect(viaStudent.enrollmentId).toBe(e.enrollmentId);
    const klass = attendanceClassroomSummaryDtoSchema.parse(ok(await call(director, "GET", `/classrooms/${school.classroomId}/summary?periodId=${school.termId}`)));
    expect(klass.rows).toHaveLength(6);

    expect((await call(teacher, "PUT", "/summary-overrides", { enrollmentId: e.enrollmentId, periodId: school.termId, absentMinutes: 60, excusedMinutes: 0, reason: "Reprise papier" })).status).toBe(403);
    const over = attendanceSummaryDtoSchema.parse(ok(await call(director, "PUT", "/summary-overrides", { enrollmentId: e.enrollmentId, periodId: school.termId, absentMinutes: 600, excusedMinutes: 120, reason: "Reprise de l'historique" })));
    expect(over).toMatchObject({ overridden: true, effective: { absentMinutes: 600, excusedMinutes: 120 } });
    expect((await call(director, "PUT", "/summary-overrides", { enrollmentId: e.enrollmentId, periodId: school.termId, absentMinutes: 1, excusedMinutes: 5, reason: "Reprise de l'historique" })).status).toBe(400);
    expect(attendanceSummaryDtoSchema.parse(ok(await call(director, "DELETE", `/summary-overrides?enrollmentId=${e.enrollmentId}&periodId=${school.termId}`))).overridden).toBe(false);

    const absences = attendanceAbsencesPageDtoSchema.parse(ok(await call(director, "GET", `/reports/absences?classroomId=${school.classroomId}&limit=5`)));
    expect(absences.items.length).toBeGreaterThan(0);
    expect(absences.items.every((r) => r.classroomId === school.classroomId)).toBe(true);
    const csv = await call(director, "GET", `/reports/absences?classroomId=${school.classroomId}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\r\n")[0]).toBe("date;eleve_id;eleve;classe_id;statut;justifie;minutes;justificatif_id");
    expect(world.audit.actions()).toContain("attendance.report.exported");
    expect((await call(teacher, "GET", "/reports/absences")).status).toBe(403);

    world.clock.advance(3 * 86_400_000);
    const unattended = addOccurrence(world, school, { date: "2025-10-02" });
    const compliance = attendanceComplianceDtoSchema.parse(ok(await call(director, "GET", "/reports/call-compliance?from=2025-10-01&to=2025-10-04")));
    expect(compliance.expected).toBeGreaterThanOrEqual(2);
    expect(compliance.missingOccurrences.some((o) => o.occurrenceId === unattended.occurrenceId)).toBe(true);
    expect(compliance.rateBps).not.toBeNull();
  });

  it("hors-ligne en HTTP : lot idempotent (rejeu identique), file de conflits, porte d'entitlement", async () => {
    const occ = addOccurrence(world, school, { date: "2025-10-04" });
    const batch = {
      batchId: newId(),
      deviceId: "tablette-01",
      clientSentAt: "2025-10-04T11:00:00.000Z",
      sessions: [{
        clientId: newId(),
        target: { occurrenceId: occ.occurrenceId },
        clientOpenedAt: "2025-10-04T10:00:00.000Z",
        records: school.students.slice(0, 3).map((s, i) => ({ clientId: newId(), studentId: s.studentId, statusCode: i === 0 ? "ABSENT" : "PRESENT", clientMarkedAt: "2025-10-04T10:05:00.000Z" })),
        submit: { defaultStatus: "PRESENT" },
      }],
    };
    const first = attendanceSyncResultDtoSchema.parse(ok(await call(teacher, "POST", "/sync", batch)));
    expect(first.totals).toMatchObject({ applied: 3, replayed: 0 });
    expect(first.sessions[0]).toMatchObject({ outcome: "OPENED", submitted: true });
    const second = attendanceSyncResultDtoSchema.parse(ok(await call(teacher, "POST", "/sync", batch)));
    expect(second.totals).toMatchObject({ applied: 0, replayed: 3 });
    expect(second.sessions[0]!.sessionId).toBe(first.sessions[0]!.sessionId);

    // Pointage tardif sur appel validé -> conflit, listé pour arbitrage.
    ok(await call(director, "POST", `/sessions/${first.sessions[0]!.sessionId}/validate`));
    const late = { ...batch, batchId: newId(), sessions: [{ ...batch.sessions[0]!, clientId: newId(), records: [{ clientId: newId(), studentId: school.students[3]!.studentId, statusCode: "ABSENT", clientMarkedAt: "2025-10-04T10:30:00.000Z" }], submit: undefined }] };
    const conflicted = attendanceSyncResultDtoSchema.parse(ok(await call(teacher, "POST", "/sync", late)));
    expect(conflicted.totals.conflicts).toBe(1);
    expect((await call(teacher, "GET", "/sync/conflicts")).status).toBe(403);
    const list = ok(await call(director, "GET", "/sync/conflicts?status=OPEN"));
    expect(attendanceSyncConflictDtoSchema.parse(list.items[0])).toMatchObject({ kind: "SESSION_LOCKED" });
    expect((await call(director, "POST", `/sync/conflicts/${list.items[0].id}/resolve`, { resolution: "KEEP_EXISTING", note: "Appel déjà validé" })).status).toBe(200);

    features.delete("attendance.offline");
    const gated = await call(teacher, "POST", "/sync", batch);
    expect(gated.status).toBe(403);
    expect(gated.json).toMatchObject({ code: "entitlements.feature_not_available" });
    features.add("attendance.offline");
  });

  it("personnel et paramétrage en HTTP", async () => {
    const outsider = "outsider";
    const checkIn = await call(outsider, "POST", "/staff/check-in", {});
    const day = attendanceStaffRecordDtoSchema.parse(ok(checkIn, 200).record);
    expect(day).toMatchObject({ staffId: school.outsider.staffId, source: "SELF" });
    expect((await call(outsider, "PUT", "/staff/records", { staffId: school.teacher.staffId, workDate: "2025-10-04", statusCode: "ABSENT" })).status).toBe(403);

    const leave = attendanceLeaveDtoSchema.parse(ok(await call(outsider, "POST", "/staff/leaves", { leaveTypeCode: "ANNUAL", startsOn: "2025-12-22", endsOn: "2025-12-31" }), 201));
    expect((await call(outsider, "POST", `/staff/leaves/${leave.id}/approve`, {})).status).toBe(403);
    expect(attendanceLeaveDtoSchema.parse(ok(await call(director, "POST", `/staff/leaves/${leave.id}/approve`, { note: "Accordé" }))).status).toBe("APPROVED");
    expect(attendanceStaffSummaryDtoSchema.parse(ok(await call(director, "GET", "/reports/staff-summary?from=2025-10-01&to=2025-12-31"))).rows.length).toBeGreaterThan(0);

    features.delete("attendance.staff");
    expect((await call(director, "GET", "/staff/records?from=2025-10-01&to=2025-10-31")).status).toBe(403);
    features.add("attendance.staff");

    const statuses = ok(await call(teacher, "GET", "/reference/status-definitions"));
    expect(statuses.items.map((s: any) => attendanceStatusDefinitionDtoSchema.parse(s).code)).toEqual(expect.arrayContaining(["PRESENT", "ABSENT", "LATE", "EXCUSED", "EARLY_LEAVE", "ON_LEAVE"]));
    expect((await call(teacher, "PUT", "/reference/status-definitions", { subjectKind: "STUDENT", code: "TARDIF", label: "Très en retard", countsAsLate: true })).status).toBe(403);
    const created = attendanceStatusDefinitionDtoSchema.parse(ok(await call(director, "PUT", "/reference/status-definitions", { subjectKind: "STUDENT", code: "TARDIF", label: "Très en retard", countsAsLate: true, countsAsPresent: true })));
    expect(created).toMatchObject({ code: "TARDIF", isSystem: false });
    expect((await call(director, "PUT", "/reference/status-definitions", { subjectKind: "STUDENT", code: "ABSENT", label: "Absent", countsAsPresent: true })).json).toMatchObject({ code: "attendance.system_status_immutable" });
    const settings = attendanceSettingsDtoSchema.parse(ok(await call(director, "PUT", "/reference/settings", { alertRules: [{ code: "ABS", metric: "ABSENT_COUNT", threshold: 4 }] })));
    expect(settings.alertRules).toEqual([{ code: "ABS", metric: "ABSENT_COUNT", threshold: 4, active: true }]);
    expect((await call(director, "PUT", "/reference/settings", { alertRules: [{ code: "ABS", metric: "ABSENT_COUNT", threshold: 0 }] })).status).toBe(400);
    ok(await call(director, "PUT", "/reference/settings", { alertRules: [] }));
    const policy = attendanceCallPolicyDtoSchema.parse(ok(await call(director, "PUT", "/reference/call-policies", { institutionId: school.institutionId, educationLevelCode: "SECONDARY_1", callScope: "SESSION", editWindowMinutes: 240 })));
    expect(policy.editWindowMinutes).toBe(240);
  });

  it("AUCUN GET n'écrit (hors l'audit de la lecture d'une pièce) : lignes, événements et audit inchangés", async () => {
    const snapshot = async () => ({
      tables: await adminRows<{ t: string; n: string }>(
        db,
        "SELECT 'sessions' t, count(*) n FROM attendance.sessions UNION ALL SELECT 'records', count(*) FROM attendance.student_records UNION ALL SELECT 'summaries', count(*) FROM attendance.period_summaries UNION ALL SELECT 'history', count(*) FROM attendance.record_history UNION ALL SELECT 'justifications', count(*) FROM attendance.justifications UNION ALL SELECT 'ops', count(*) FROM attendance.sync_ops UNION ALL SELECT 'staff', count(*) FROM attendance.staff_records",
      ),
      events: Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM kernel.domain_events")).n),
      audit: world.audit.entries.length,
    });
    const before = await snapshot();
    const gets = [
      "/sessions", `/sessions/${sessionId}`, `/students/${school.students[0]!.studentId}/records`, `/classrooms/${school.classroomId}/summary?periodId=${school.termId}`,
      `/enrollments/${school.students[1]!.enrollmentId}/summary?periodId=${school.semesterId}`, "/justifications", "/reports/absences", "/reports/call-compliance?from=2025-10-01&to=2025-10-05",
      "/staff/records?from=2025-10-01&to=2025-10-31", "/staff/leaves", "/reference/settings", "/reference/call-policies", "/sync/conflicts",
      `/children/${school.guardian.studentId}/attendance?periodId=${school.termId}`,
    ];
    for (const url of gets) {
      const who = url.startsWith("/children") ? guardian : director;
      expect((await call(who, "GET", url)).status, url).toBe(200);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("contrat d'assemblage (app, runtime) : `setup` décore la racine, les ports enregistrés tardivement sont utilisés, ports absents = échec FERMÉ", async () => {
    const root = Fastify({ logger: false });
    const runtime = {
      tenantDb: db.tenantDb,
      systemDb: db.systemDb,
      clock: world.clock,
      logger: noopLogger,
      env: {},
      manifests: [manifest],
      requirePermission: () => async () => undefined,
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      entitlements: { reader: {}, requireFeature: () => async () => undefined, isFeatureEnabled: async () => true },
      resolveContext: (req: FastifyRequest) => (req as unknown as { ctx: RequestContext }).ctx,
    } as unknown as ModuleRuntime;
    root.addHook("onRequest", async (req) => {
      (req as unknown as { ctx: RequestContext }).ctx = school.teacher.ctx;
    });
    setup(root, runtime);
    await root.register(async (scope) => attendanceModulePlugin(scope, runtime), { prefix: "/api/v1/attendance" });
    await root.ready();
    expect(root.hasDecorator("attendancePorts")).toBe(true);

    const occ = addOccurrence(world, school, { date: "2025-10-06" });
    const failClosed = await root.inject({ method: "POST", url: "/api/v1/attendance/sessions", payload: { occurrenceId: occ.occurrenceId } });
    expect(failClosed.statusCode).toBe(500);
    expect(JSON.parse(failClosed.body)).toMatchObject({ code: "attendance.port_unavailable" });
    expect(JSON.stringify(JSON.parse(failClosed.body))).not.toMatch(/Proxy|at |node_modules/);

    registerAttendancePorts(root, world.ports); // un autre module fournit ses ports après coup
    const opened = await root.inject({ method: "POST", url: "/api/v1/attendance/sessions", payload: { occurrenceId: occ.occurrenceId } });
    expect(opened.statusCode).toBe(201);
    expect(unavailablePorts().roster).toBeDefined();
    await root.close();
  });
});
