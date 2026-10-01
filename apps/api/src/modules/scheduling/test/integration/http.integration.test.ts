/**
 * API HTTP `/api/v1/scheduling/*` (Fastify `inject` + Postgres réel) : authentification, autorisation (dont les
 * accès « personnel / élève / parent » dérivés de l'identité), validation Zod, erreurs normalisées, contrats de
 * réponse, fonctionnalités du plan, et abonnement iCalendar par jeton révocable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId } from "@ecoledigitale/kernel";
import {
  schedulingCalendarEventDtoSchema,
  schedulingConflictViewDtoSchema,
  schedulingEntryDtoSchema,
  schedulingEquipmentDtoSchema,
  schedulingGenerationReportDtoSchema,
  schedulingOccurrenceDtoSchema,
  schedulingOccurrencePageDtoSchema,
  schedulingOccurrenceResultDtoSchema,
  schedulingPayableHourLineDtoSchema,
  schedulingPreviewResultDtoSchema,
  schedulingRoomDtoSchema,
  schedulingSettingsDtoSchema,
  schedulingTimeSlotDtoSchema,
  schedulingTimetableDtoSchema,
} from "@ecoledigitale/contracts/src/v2/scheduling";
import manifest from "../../manifest";
import { schedulingPlugin } from "../../http/plugin";
import { holdOccurrence } from "../../application/occurrences";
import { createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";
import { addClass, addStaff, createWorld, unwrap, type World } from "../support/world";

const ALL = manifest.permissions.map((p) => p.key);

interface CallOptions {
  user?: string | null;
  perms?: string[];
  body?: unknown;
  query?: Record<string, string>;
  tenant?: string | "none";
  headers?: Record<string, string>;
}

describeIntegration("API HTTP /api/v1/scheduling/*", () => {
  let db: SchedulingTestDb;
  let w: World;
  let app: FastifyInstance;
  let features: Set<string>;
  const limiterHits = new Map<string, number>();
  const admin = newId();
  const teacherUser = newId();
  const studentUser = newId();
  const parentUser = newId();
  const otherParent = newId();
  let teacherId: string;
  let otherTeacherId: string;
  let studentId: string;
  let otherStudentId: string;

  beforeAll(async () => {
    db = await createSchedulingTestDb(24);
    w = await createWorld({ db });
    features = new Set(["scheduling.equipment", "scheduling.generation", "scheduling.payroll-hours"]);
    teacherId = addStaff(w, "Prof Http", { userId: teacherUser });
    otherTeacherId = addStaff(w, "Autre Prof", { userId: newId() });
    studentId = newId();
    otherStudentId = newId();
    w.people.linkStudent(studentUser, studentId);
    w.people.addGuardian(parentUser, studentId);
    w.people.addGuardian(otherParent, otherStudentId);

    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-test-tenant"];
      const user = req.headers["x-test-user"];
      if (typeof tenant === "string") {
        (req as unknown as { ctx: unknown }).ctx = createRequestContext({
          tenantId: tenant,
          userId: typeof user === "string" && user !== "" ? user : newId(),
          roles: [],
          institutionId: w.institutionId,
        });
      }
    });
    await app.register(schedulingPlugin, {
      deps: w.deps,
      prefix: "/api/v1/scheduling",
      requirePermission: (permission) => async (req) => {
        const ctx = (req as unknown as { ctx?: unknown }).ctx;
        if (!ctx) throw new UnauthorizedError();
        const granted = String(req.headers["x-test-perms"] ?? "").split(",");
        if (!granted.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      requireFeature: (feature) => async (req, reply) => {
        void req;
        if (!features.has(feature)) {
          return reply.status(403).send({ status: 403, code: "entitlements.feature_not_available", kind: "forbidden", message: "Fonctionnalité non incluse.", details: { feature } });
        }
        return undefined;
      },
      rateLimiter: {
        hit: async (key, rule) => {
          const n = (limiterHits.get(key) ?? 0) + 1;
          limiterHits.set(key, n);
          return { allowed: n <= rule.limit, retryAfterMs: 1000 };
        },
      },
      icsRateLimit: { limit: 5, windowMs: 60_000 },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  async function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, o: CallOptions = {}) {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.tenant !== "none") headers["x-test-tenant"] = o.tenant ?? w.tenantId;
    if (o.user !== null) headers["x-test-user"] = o.user ?? admin;
    headers["x-test-perms"] = (o.perms ?? ALL).join(",");
    let payload: string | undefined;
    if (o.body !== undefined) {
      payload = JSON.stringify(o.body);
      headers["content-type"] = "application/json";
    }
    const res = await app.inject({ method, url: `/api/v1/scheduling${url}`, headers, payload, query: o.query });
    let json: any;
    try {
      json = res.json();
    } catch {
      json = undefined;
    }
    return { status: res.statusCode, json, res, text: res.body };
  }

  describe("authentification, autorisation, erreurs", () => {
    it("401 sans contexte ; 403 sans la permission avec corps normalisé", async () => {
      expect((await call("GET", "/rooms", { tenant: "none" })).status).toBe(401);
      const r = await call("GET", "/rooms", { perms: ["schedule.manage"] });
      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({ status: 403, code: "FORBIDDEN", kind: "forbidden" });
      expect(typeof r.json.requestId).toBe("string");
    });

    it("validation Zod : 400 avec le détail des champs, jamais de 500", async () => {
      const r = await call("POST", "/rooms", { body: { code: "A1" } });
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ code: "VALIDATION_FAILED", kind: "validation" });
      expect(r.json.issues.map((i: { path: string[] }) => i.path[0]).sort()).toEqual(expect.arrayContaining(["institutionId", "campusId", "name", "roomTypeCode"]));
      expect((await call("GET", "/occurrences/not-a-uuid")).status).toBe(400);
      expect((await call("POST", "/occurrences", { body: { kind: "LESSON" } })).status).toBe(400); // fenêtre manquante
      const badJson = await app.inject({ method: "POST", url: "/api/v1/scheduling/rooms", headers: { "x-test-tenant": w.tenantId, "x-test-perms": ALL.join(","), "content-type": "application/json" }, payload: "{" });
      expect(badJson.statusCode).toBe(400);
    });

    it("l'isolation par tenant s'applique via l'API", async () => {
      const other = await db.createTenant();
      const r = await call("GET", "/rooms", { tenant: other });
      expect(r.status).toBe(200);
      expect(r.json.items).toEqual([]);
    });
  });

  describe("référentiels", () => {
    it("salles : création, lecture, modification, statut ; contrats de réponse", async () => {
      const created = await call("POST", "/rooms", { body: { institutionId: w.institutionId, campusId: w.campusId, code: "h1", name: "Salle HTTP", roomTypeCode: "CLASSROOM", capacity: 30, features: ["vidéoprojecteur"] } });
      expect(created.status).toBe(201);
      expect(schedulingRoomDtoSchema.parse(created.json)).toMatchObject({ code: "H1", capacity: 30, status: "AVAILABLE" });
      const dup = await call("POST", "/rooms", { body: { institutionId: w.institutionId, campusId: w.campusId, code: "H1", name: "Doublon", roomTypeCode: "CLASSROOM" } });
      expect(dup.status).toBe(409);
      expect(dup.json.code).toBe("scheduling.duplicate");
      const unknownType = await call("POST", "/rooms", { body: { institutionId: w.institutionId, campusId: w.campusId, code: "H2", name: "x", roomTypeCode: "INCONNU" } });
      expect(unknownType.status).toBe(400);
      const patched = await call("PATCH", `/rooms/${created.json.id}`, { body: { capacity: 35, name: "Salle HTTP 1" } });
      expect(patched.json).toMatchObject({ capacity: 35, name: "Salle HTTP 1" });
      const list = await call("GET", "/rooms", { query: { campusId: w.campusId, status: "AVAILABLE" } });
      expect(list.json.items.map((r: { code: string }) => r.code)).toContain("H1");
      const status = await call("POST", `/rooms/${created.json.id}/status`, { body: { status: "OUT_OF_SERVICE", reason: "Travaux" } });
      expect(status.json).toMatchObject({ room: { status: "OUT_OF_SERVICE" }, flagged: [] });
      expect((await call("GET", `/rooms/${newId()}`)).status).toBe(404);
      const types = await call("GET", "/reference/room-types");
      expect(types.json.items.map((t: { code: string }) => t.code)).toEqual(expect.arrayContaining(["CLASSROOM", "LAB"]));
    });

    it("équipements : soumis à la fonctionnalité du plan (403 entitlements.feature_not_available), puis CRUD", async () => {
      features.delete("scheduling.equipment");
      const refused = await call("GET", "/equipment");
      expect(refused.status).toBe(403);
      expect(refused.json.code).toBe("entitlements.feature_not_available");
      features.add("scheduling.equipment");
      const created = await call("POST", "/equipment", { body: { institutionId: w.institutionId, campusId: w.campusId, code: "vp", label: "Vidéoprojecteur", quantity: 3 } });
      expect(created.status).toBe(201);
      expect(schedulingEquipmentDtoSchema.parse(created.json).quantity).toBe(3);
      const updated = await call("PATCH", `/equipment/${created.json.id}`, { body: { quantity: 2 } });
      expect(updated.json).toMatchObject({ item: { quantity: 2 }, overbooked: [] });
    });

    it("grille horaire, calendrier (plages), paramètres et politiques", async () => {
      const slot = await call("PUT", "/time-slots", { body: { institutionId: w.institutionId, code: "m1", label: "Matin 1", startsTime: "08:00", endsTime: "09:00", ordinal: 1 } });
      expect(schedulingTimeSlotDtoSchema.parse(slot.json)).toMatchObject({ code: "M1", startsTime: "08:00", endsTime: "09:00" });
      const again = await call("PUT", "/time-slots", { body: { institutionId: w.institutionId, code: "M1", label: "Matin 1 bis", startsTime: "08:00", endsTime: "09:30" } });
      expect(again.json.id).toBe(slot.json.id); // upsert par code
      expect((await call("PUT", "/time-slots", { body: { institutionId: w.institutionId, code: "M2", label: "x", startsTime: "10:00", endsTime: "09:00" } })).status).toBe(400);
      expect((await call("POST", `/time-slots/${slot.json.id}/deactivate`)).json.active).toBe(false);
      expect((await call("GET", "/time-slots", { query: { activeOnly: "true" } })).json.items).toEqual([]);

      const ev = await call("POST", "/calendar-events", { body: { institutionId: w.institutionId, kindCode: "HOLIDAY", title: "Fête du travail", startsOn: "2027-05-01", endsOn: "2027-05-01" } });
      expect(ev.status).toBe(201);
      expect(schedulingCalendarEventDtoSchema.parse(ev.json.event)).toMatchObject({ blocksTeaching: true, audience: ["STAFF", "STUDENTS", "GUARDIANS"] });
      const patched = await call("PATCH", `/calendar-events/${ev.json.event.id}`, { body: { kindCode: "HOLIDAY", title: "Fête du travail (pont)", startsOn: "2027-05-01", endsOn: "2027-05-03", audience: ["STAFF"] } });
      expect(patched.json.event).toMatchObject({ endsOn: "2027-05-03", audience: ["STAFF"] });
      const listed = await call("GET", "/calendar-events", { query: { from: "2027-05-02", to: "2027-05-02", blocksTeachingOnly: "true" } });
      expect(listed.json.items).toHaveLength(1);
      expect((await call("DELETE", `/calendar-events/${ev.json.event.id}`)).json).toEqual({ deleted: true });
      expect((await call("DELETE", `/calendar-events/${ev.json.event.id}`)).status).toBe(404);

      const settings = await call("PUT", "/reference/settings", { body: { institutionId: w.institutionId, openingStart: "07:30", openingEnd: "17:30", openingWeekdays: [1, 2, 3, 4, 5], allowSelfValidation: false } });
      expect(schedulingSettingsDtoSchema.parse(settings.json)).toMatchObject({ timezone: "Africa/Abidjan", openingStart: "07:30", openingWeekdays: [1, 2, 3, 4, 5] });
      expect((await call("PUT", "/reference/settings", { body: { institutionId: w.institutionId, timezone: "Mars/Olympus" } })).status).toBe(400);
      expect((await call("PUT", "/reference/settings", { body: { institutionId: w.institutionId, openingStart: "07:30", openingEnd: null } })).status).toBe(400); // début sans fin
      const policies = await call("PUT", "/reference/conflict-policies", { body: { institutionId: w.institutionId, resourceKind: "EQUIPMENT", mode: "WARN" } });
      expect(policies.json).toMatchObject({ EQUIPMENT: "WARN", STAFF: "BLOCK" });
      await call("PUT", "/reference/conflict-policies", { body: { institutionId: w.institutionId, resourceKind: "EQUIPMENT", mode: "BLOCK" } });
    });
  });

  describe("emplois du temps, séances et conflits", () => {
    it("parcours : brouillon → patrons → conflits → publication → génération (fonctionnalité) → séances → conflit 409 → aperçu", async () => {
      const cls = addClass(w, "6e HTTP");
      const tt = await call("POST", "/timetables", { body: { institutionId: w.institutionId, academicYearId: w.yearId, name: "EDT HTTP", validFrom: "2026-09-07", validTo: "2026-12-18", weekAAnchor: "2026-09-07" } });
      expect(tt.status).toBe(201);
      expect(schedulingTimetableDtoSchema.parse(tt.json)).toMatchObject({ status: "DRAFT" });
      const entryBody = { classroomId: cls.classroomId, curriculumNodeId: cls.nodeId, weekday: 1, startTime: "08:00", endTime: "10:00", staff: [{ staffId: teacherId }] };
      const e1 = await call("POST", `/timetables/${tt.json.id}/entries`, { body: entryBody });
      expect(e1.status).toBe(201);
      expect(schedulingEntryDtoSchema.parse(e1.json.entry)).toMatchObject({ weekday: 1, startTime: "08:00", endTime: "10:00" });
      const conflict = await call("POST", `/timetables/${tt.json.id}/entries`, { body: { ...entryBody, classroomId: addClass(w, "6e HTTP B").classroomId, startTime: "09:00" } });
      expect(conflict.status).toBe(409);
      expect(conflict.json.code).toBe("scheduling.conflict_detected");
      expect(conflict.json.details.conflicts[0]).toMatchObject({ code: "STAFF_BUSY", severity: "BLOCKING" });
      // Dépasser un conflit exige la permission sensible.
      const noOverride = await call("POST", `/timetables/${tt.json.id}/entries`, { perms: ALL.filter((p) => p !== "schedule.conflict.override"), body: { ...entryBody, classroomId: addClass(w, "6e HTTP C").classroomId, startTime: "09:00", overrideReason: "Co-enseignement" } });
      expect(noOverride.status).toBe(403);
      expect(noOverride.json.details.permission).toBe("schedule.conflict.override");
      const confl = await call("GET", `/timetables/${tt.json.id}/conflicts`);
      expect(confl.json.items).toEqual([]);

      // Génération : la fonctionnalité du plan est vérifiée avant le corps.
      expect((await call("POST", `/timetables/${tt.json.id}/generate`, { body: { from: "2026-09-07", to: "2026-10-04" } })).json.code).toBe("scheduling.invalid_window"); // brouillon
      const pub = await call("POST", `/timetables/${tt.json.id}/publish`, { perms: ["schedule.publish"] });
      expect(pub.json.status).toBe("PUBLISHED");
      features.delete("scheduling.generation");
      expect((await call("POST", `/timetables/${tt.json.id}/generate`, { body: { from: "2026-09-07", to: "2026-10-04" } })).json.code).toBe("entitlements.feature_not_available");
      features.add("scheduling.generation");
      const gen = await call("POST", `/timetables/${tt.json.id}/generate`, { body: { from: "2026-09-07", to: "2026-10-04" } });
      expect(gen.status).toBe(200);
      expect(schedulingGenerationReportDtoSchema.parse(gen.json)).toMatchObject({ created: 4, skippedExisting: 0 });
      expect((await call("POST", `/timetables/${tt.json.id}/generate`, { body: { from: "2026-09-07", to: "2026-10-04" } })).json.created).toBe(0);
      expect((await call("GET", `/timetables/${tt.json.id}/generation-runs`)).json.items).toHaveLength(2);
      expect((await call("GET", `/timetables/${tt.json.id}/missing`, { query: { from: "2026-09-07", to: "2026-09-30" } })).json.items).toEqual([]);

      const page = await call("GET", "/occurrences", { query: { classroomId: cls.classroomId, limit: "2" } });
      expect(schedulingOccurrencePageDtoSchema.parse(page.json)).toMatchObject({ hasMore: true, total: 4 });
      const first = page.json.items[0];
      const detail = await call("GET", `/occurrences/${first.id}`);
      expect(schedulingOccurrenceDtoSchema.parse(detail.json)).toMatchObject({ id: first.id, status: "PLANNED", origin: "GENERATED", durationMinutes: 120 });

      // Aperçu puis création en conflit : 409 avec le détail.
      const preview = await call("POST", "/conflicts/preview", { body: { kind: "MEETING", date: "2026-09-14", startTime: "09:00", endTime: "10:00", staffIds: [teacherId] } });
      expect(schedulingPreviewResultDtoSchema.parse(preview.json)).toMatchObject({ blocking: true });
      expect(schedulingConflictViewDtoSchema.parse(preview.json.conflicts[0]).code).toBe("STAFF_BUSY");
      const refused = await call("POST", "/occurrences", { body: { kind: "MEETING", title: "Réunion", date: "2026-09-14", startTime: "09:00", endTime: "10:00", staff: [{ staffId: teacherId }] } });
      expect(refused.status).toBe(409);
      expect(refused.json.message).toContain("Prof Http est déjà occupé(e) le 14/09/2026 de 08:00 à 10:00");
      const done = await call("POST", "/occurrences", { body: { kind: "MEETING", title: "Réunion", date: "2026-09-14", startTime: "10:00", endTime: "11:00", staff: [{ staffId: teacherId }] } });
      expect(done.status).toBe(201);
      expect(schedulingOccurrenceResultDtoSchema.parse(done.json).occurrence.kind).toBe("MEETING");
    });

    it("cycle : report, salle, intervenants, remplacement, annulation, restauration, constat, historique", async () => {
      const cls = addClass(w, "6e Cycle");
      const created = await call("POST", "/occurrences", {
        body: { kind: "LESSON", classroomId: cls.classroomId, curriculumNodeId: cls.nodeId, date: "2026-10-05", startTime: "14:00", endTime: "15:00", staff: [{ staffId: teacherId }] },
      });
      const id = created.json.occurrence.id;
      const moved = await call("POST", `/occurrences/${id}/reschedule`, { body: { date: "2026-10-05", startTime: "15:00", endTime: "16:00", reason: "Réunion" } });
      expect(moved.json.occurrence.startsAt).toBe("2026-10-05T15:00:00.000Z");
      expect((await call("POST", `/occurrences/${id}/reschedule`, { body: { date: "2026-10-05" } })).status).toBe(400);
      const sub = await call("POST", `/occurrences/${id}/substitute`, { body: { originalStaffId: teacherId, substituteStaffId: otherTeacherId, reason: "Congé maladie" } });
      expect(sub.json.occurrence.staff).toMatchObject([{ staffId: otherTeacherId, role: "SUBSTITUTE", replacesStaffId: teacherId }]);
      expect((await call("POST", `/occurrences/${id}/substitute`, { body: { originalStaffId: teacherId, substituteStaffId: otherTeacherId, reason: "x" } })).status).toBe(400); // motif trop court
      const suggestions = await call("POST", `/occurrences/${id}/substitutes/suggest`, { body: {} });
      expect(suggestions.status).toBe(200);
      expect(suggestions.json.items.every((s: { staffId: string }) => s.staffId !== otherTeacherId)).toBe(true);
      const cancelled = await call("POST", `/occurrences/${id}/cancel`, { body: { reason: "Grève" } });
      expect(cancelled.json).toMatchObject({ alreadyCancelled: false, occurrence: { status: "CANCELLED" } });
      expect((await call("POST", `/occurrences/${id}/restore`, { body: {} })).json.occurrence.status).toBe("PLANNED");
      const hist = await call("GET", `/occurrences/${id}/history`);
      expect(hist.json.items.map((h: { kind: string }) => h.kind)).toEqual(expect.arrayContaining(["CREATED", "RESCHEDULED", "STAFF_CHANGED", "CANCELLED"]));
      // Constat manuel : motif requis, séance déjà commencée.
      expect((await call("POST", `/occurrences/${id}/hold`, { body: {} })).status).toBe(400);
      w.clock.set("2026-10-06T00:00:00.000Z");
      try {
        const held = await call("POST", `/occurrences/${id}/hold`, { perms: ["schedule.occurrence.hold"], body: { reason: "Constat direction" } });
        expect(held.json).toMatchObject({ alreadyHeld: false, occurrence: { status: "HELD" } });
        expect((await call("POST", `/occurrences/${id}/unhold`, { body: { reason: "Erreur" } })).json.status).toBe("PLANNED");
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });

    it("paie : séance comptable, validation (sensible), durée payée, lot partiel, heures payables, dévalidation", async () => {
      const t = addStaff(w, "Vacataire HTTP");
      w.clock.set("2026-11-20T00:00:00.000Z");
      try {
        const noPerm = await call("POST", "/occurrences/accounting", { perms: ["schedule.read"], body: { staffId: t, date: "2026-11-16", minutes: 90 } });
        expect(noPerm.status).toBe(403);
        const acc = await call("POST", "/occurrences/accounting", { user: admin, body: { staffId: t, date: "2026-11-16", minutes: 90, title: "TP" } });
        expect(acc.status).toBe(201);
        expect(acc.json.occurrence).toMatchObject({ origin: "ACCOUNTING", status: "HELD", validatedAt: null, durationMinutes: 90 });
        const id = acc.json.occurrence.id;
        // Le créateur ne valide pas lui-même (quatre yeux) ; un autre utilisateur le peut.
        expect((await call("POST", `/occurrences/${id}/validate`, { user: admin, perms: ["schedule.occurrence.validate"] })).json.code).toBe("scheduling.self_validation_forbidden");
        expect((await call("PUT", `/occurrences/${id}/staff/${t}/paid-minutes`, { user: newId(), perms: ["schedule.occurrence.validate"], body: { minutes: 60, reason: "Retard" } })).json.paidMinutes).toBe(60);
        const ok = await call("POST", `/occurrences/${id}/validate`, { user: newId(), perms: ["schedule.occurrence.validate"] });
        expect(ok.json).toEqual({ occurrenceId: id, alreadyValidated: false });
        expect((await call("POST", `/occurrences/${id}/validate`, { user: newId(), perms: ["schedule.read"] })).status).toBe(403);
        expect((await call("PUT", `/occurrences/${id}/staff/${t}/paid-minutes`, { body: { minutes: 30 } })).json.code).toBe("scheduling.occurrence_validated");

        const batch = await call("POST", "/occurrences/validate-batch", { user: newId(), perms: ["schedule.occurrence.validate"], body: { occurrenceIds: [id, newId()] } });
        expect(batch.json).toMatchObject({ validated: [], alreadyValidated: [id], rejected: [{ reason: "NOT_FOUND" }] });
        expect((await call("POST", "/occurrences/validate-batch", { perms: ["schedule.occurrence.validate"], body: { occurrenceIds: [] } })).status).toBe(400);

        const pending = await call("GET", "/occurrences/pending-validation");
        expect(pending.json.items.every((o: { validatedAt: string | null }) => o.validatedAt === null)).toBe(true);
        const un = await call("POST", `/occurrences/${id}/unvalidate`, { user: newId(), perms: ["schedule.occurrence.validate"], body: { reason: "Heures contestées" } });
        expect(un.json).toEqual({ occurrenceId: id, wasValidated: true });
        expect((await call("GET", "/reports/overlaps", { query: { from: "2026-11-01", to: "2026-11-30" } })).json.items).toEqual([]);
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
      // Aucune route HTTP ne verrouille les heures : la paie appelle le module.
      const missing = await call("POST", "/hours/lock", { body: { lines: [], lockRef: newId() } });
      expect(missing.status).toBe(404);
    });
  });

  describe("accès personnel / élève / parent (identité dérivée du contexte)", () => {
    let clsHttp: ReturnType<typeof addClass>;
    beforeAll(async () => {
      clsHttp = addClass(w, "6e Portail");
      w.academic.place(studentId, { classroomIds: [clsHttp.classroomId], offeringIds: [] });
      const mk = (date: string, start: string, staff: string) =>
        call("POST", "/occurrences", { body: { kind: "LESSON", classroomId: clsHttp.classroomId, curriculumNodeId: clsHttp.nodeId, date, startTime: start, endTime: `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00`, staff: [{ staffId: staff }] } });
      expect((await mk("2026-10-05", "08:00", teacherId)).status).toBe(201);
      expect((await mk("2026-10-06", "08:00", teacherId)).status).toBe(201);
      expect((await mk("2026-10-07", "08:00", otherTeacherId)).status).toBe(201);
    });

    it("enseignant : « aujourd'hui » et ses séances ; jamais celles d'un collègue", async () => {
      w.clock.set("2026-10-05T10:00:00.000Z");
      try {
        const own = { user: teacherUser, perms: ["schedule.own.read"] };
        const today = await call("GET", "/me/today", own);
        expect(today.status).toBe(200);
        expect(today.json).toMatchObject({ date: "2026-10-05", staffId: teacherId });
        expect(today.json.items.map((o: { occursOn: string }) => o.occursOn)).toEqual(["2026-10-05"]);
        expect((await call("GET", `/views/staff/${teacherId}`, { ...own, query: { from: "2026-10-01", to: "2026-10-31" } })).json.items).toHaveLength(2);
        const peer = await call("GET", `/views/staff/${otherTeacherId}`, { ...own, query: { from: "2026-10-01", to: "2026-10-31" } });
        expect(peer.status).toBe(403);
        // La direction (schedule.read) voit tout.
        expect((await call("GET", `/views/staff/${otherTeacherId}`, { query: { from: "2026-10-01", to: "2026-10-31" } })).json.items.length).toBeGreaterThan(0);
        // Un compte sans lien avec le personnel n'a pas de « aujourd'hui ».
        expect((await call("GET", "/me/today", { user: newId(), perms: ["schedule.own.read"] })).status).toBe(403);
        expect((await call("GET", "/me/timetable", { ...own, query: { from: "2026-10-01", to: "2026-10-31" } })).json).toMatchObject({ subject: "STAFF", subjectId: teacherId });
        expect((await call("GET", "/reports/staff-load", { ...own, query: { staffId: otherTeacherId, week: "2026-10-05" } })).status).toBe(403);
        const load = await call("GET", "/reports/staff-load", { ...own, query: { staffId: teacherId, week: "2026-10-07" } });
        expect(load.json).toMatchObject({ weekStart: "2026-10-05", weekEnd: "2026-10-11", totalMinutes: 120 });
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });

    it("élève : le sien seulement ; parent : ses enfants seulement ; brouillons et séances comptables invisibles", async () => {
      const win = { from: "2026-10-01", to: "2026-10-31" };
      const student = { user: studentUser, perms: ["schedule.self.read"] };
      const mine = await call("GET", `/views/student/${studentId}`, { ...student, query: win });
      expect(mine.status).toBe(200);
      expect(mine.json.items.map((o: { occursOn: string }) => o.occursOn)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
      expect((await call("GET", `/views/student/${otherStudentId}`, { ...student, query: win })).status).toBe(403);
      expect((await call("GET", "/me/timetable", { ...student, query: win })).json).toMatchObject({ subject: "STUDENT", subjectId: studentId });

      const parent = { user: parentUser, perms: ["schedule.child.read"] };
      expect((await call("GET", `/children/${studentId}/timetable`, { ...parent, query: win })).json.items).toHaveLength(3);
      expect((await call("GET", `/children/${otherStudentId}/timetable`, { ...parent, query: win })).status).toBe(403);
      expect((await call("GET", `/children/${studentId}/timetable`, { user: otherParent, perms: ["schedule.child.read"], query: win })).status).toBe(403);
      expect((await call("GET", `/views/student/${studentId}`, { ...parent, query: win })).json.items).toHaveLength(3);
      // Sans la bonne permission : refus.
      expect((await call("GET", `/children/${studentId}/timetable`, { user: parentUser, perms: ["schedule.self.read"], query: win })).status).toBe(403);
      // Les portails ne voient que l'à-venir : les séances passées disparaissent quand la date avance.
      w.clock.set("2026-10-07T07:00:00.000Z");
      try {
        expect((await call("GET", `/children/${studentId}/timetable`, { ...parent, query: win })).json.items.map((o: { occursOn: string }) => o.occursOn)).toEqual(["2026-10-07"]);
        expect((await call("GET", `/views/student/${studentId}`, { query: win })).json.items).toHaveLength(3); // la direction voit tout
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });

    it("déclaration (schedule.occurrence.declare) : seulement ses classes ; réservation de salle = schedule.room.book ; room.book ne planifie pas un cours", async () => {
      const mineClass = addClass(w, "6e Déclarée");
      w.people.assign(teacherId, mineClass.classroomId);
      const declare = { user: teacherUser, perms: ["schedule.occurrence.declare"] };
      const body = { kind: "LESSON", classroomId: mineClass.classroomId, curriculumNodeId: mineClass.nodeId, date: "2026-10-12", startTime: "08:00", endTime: "09:00" };
      const ok = await call("POST", "/occurrences", { ...declare, body });
      expect(ok.status).toBe(201);
      expect(ok.json.occurrence.staff.map((s: { staffId: string }) => s.staffId)).toEqual([teacherId]);
      const elsewhere = await call("POST", "/occurrences", { ...declare, body: { ...body, classroomId: clsHttp.classroomId, curriculumNodeId: clsHttp.nodeId, date: "2026-10-13" } });
      expect(elsewhere.status).toBe(403);
      expect(elsewhere.json.code).toBe("scheduling.not_assigned");
      // Avec une salle, la permission de réservation est exigée en plus.
      const room = (await call("POST", "/rooms", { body: { institutionId: w.institutionId, campusId: w.campusId, code: "DECL", name: "Salle déclarée", roomTypeCode: "CLASSROOM" } })).json;
      const withRoom = await call("POST", "/occurrences", { ...declare, body: { ...body, date: "2026-10-14", roomId: room.id } });
      expect(withRoom.status).toBe(403);
      expect(withRoom.json.details.permission).toBe("schedule.room.book");
      const withBoth = await call("POST", "/occurrences", { user: teacherUser, perms: ["schedule.occurrence.declare", "schedule.room.book"], body: { ...body, date: "2026-10-14", roomId: room.id } });
      expect(withBoth.status).toBe(201);
      // schedule.room.book seul : réservation de salle oui, cours non.
      const book = { user: newId(), perms: ["schedule.room.book"] };
      expect((await call("POST", "/occurrences", { ...book, body: { kind: "RESERVATION", roomId: room.id, title: "Réunion", date: "2026-10-15", startTime: "10:00", endTime: "11:00" } })).status).toBe(201);
      const lessonByBooker = await call("POST", "/occurrences", { ...book, body: { ...body, date: "2026-10-16" } });
      expect(lessonByBooker.status).toBe(403);
      expect((await call("POST", "/occurrences", { user: newId(), perms: ["schedule.read"], body: { ...body, date: "2026-10-16" } })).status).toBe(403);
    });
  });

  describe("export iCalendar par jeton révocable", () => {
    it("jeton créé par l'élève pour lui-même : flux public, limité à son sujet et à son périmètre, révocable, limité en débit", async () => {
      const student = { user: studentUser, perms: ["schedule.self.read"] };
      expect((await call("POST", "/export/tokens", { ...student, body: { scope: "STUDENT", subjectId: otherStudentId } })).status).toBe(403);
      expect((await call("POST", "/export/tokens", { ...student, body: { scope: "CLASSROOM", subjectId: newId() } })).status).toBe(403);
      const created = await call("POST", "/export/tokens", { ...student, body: { scope: "STUDENT", subjectId: studentId, label: "Téléphone", expiresInDays: 30 } });
      expect(created.status).toBe(201);
      const token = created.json.token as string;
      expect(token.startsWith(`${w.tenantId}.`)).toBe(true);
      // Le jeton n'est stocké qu'en empreinte.
      const stored = await db.admin.query("SELECT token_hash FROM scheduling.ics_tokens WHERE id = $1", [created.json.tokenId]);
      expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored.rows)).not.toContain(token);

      w.clock.set("2026-10-05T07:00:00.000Z");
      try {
        // Route PUBLIQUE : aucun contexte, aucune permission — le jeton fait foi.
        const feed = await app.inject({ method: "GET", url: "/api/v1/scheduling/export/timetable.ics", query: { scope: "STUDENT", token } });
        expect(feed.statusCode).toBe(200);
        expect(feed.headers["content-type"]).toContain("text/calendar");
        expect(feed.body.startsWith("BEGIN:VCALENDAR")).toBe(true);
        expect((feed.body.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
        expect(feed.body).toContain("X-WR-TIMEZONE:Africa/Abidjan");
        // Mauvais périmètre / jeton inconnu / jeton d'un autre tenant : même 404 générique.
        const wrongScope = await app.inject({ method: "GET", url: "/api/v1/scheduling/export/timetable.ics", query: { scope: "STAFF", token } });
        expect(wrongScope.statusCode).toBe(404);
        const forged = await app.inject({ method: "GET", url: "/api/v1/scheduling/export/timetable.ics", query: { scope: "STUDENT", token: `${w.tenantId}.${"x".repeat(43)}` } });
        expect(forged.statusCode).toBe(404);
        expect(forged.json().code).toBe("scheduling.token_invalid");
        const crossTenant = await app.inject({ method: "GET", url: "/api/v1/scheduling/export/timetable.ics", query: { scope: "STUDENT", token: `${newId()}.${token.split(".")[1]}` } });
        expect(crossTenant.statusCode).toBe(404);
        expect((await app.inject({ method: "GET", url: "/api/v1/scheduling/export/timetable.ics", query: { scope: "STUDENT", token: "court" } })).statusCode).toBe(400);

        // Liste puis révocation : plus aucun accès valide.
        const listed = await call("GET", "/export/tokens", { ...student, query: { scope: "STUDENT", subjectId: studentId } });
        expect(listed.json.items).toHaveLength(1);
        expect(listed.json.items[0]).not.toHaveProperty("token");
        expect((await call("DELETE", `/export/tokens/${created.json.tokenId}`, { user: otherParent, perms: ["schedule.child.read"] })).status).toBe(403); // pas son sujet
        expect((await call("DELETE", `/export/tokens/${created.json.tokenId}`, student)).json).toEqual({ revoked: true });
        const afterRevoke = await app.inject({ method: "GET", url: "/api/v1/scheduling/export/timetable.ics", query: { scope: "STUDENT", token } });
        expect(afterRevoke.statusCode).toBe(404);
        expect((await call("DELETE", `/export/tokens/${created.json.tokenId}`, student)).json).toEqual({ revoked: false });
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });

    it("jeton expiré refusé ; flux d'une classe et d'une salle par la direction ; téléchargement authentifié ; débit limité", async () => {
      const cls = addClass(w, "6e ICS");
      const t = addStaff(w, "Prof ICS");
      await call("POST", "/occurrences", { body: { kind: "LESSON", classroomId: cls.classroomId, curriculumNodeId: cls.nodeId, date: "2026-10-19", startTime: "08:00", endTime: "09:00", staff: [{ staffId: t }], title: "Histoire, géo" } });
      limiterHits.clear();
      const created = await call("POST", "/export/tokens", { body: { scope: "CLASSROOM", subjectId: cls.classroomId, expiresInDays: 1 } });
      const token = created.json.token as string;
      try {
        const feed = await app.inject({ method: "GET", url: "/api/v1/scheduling/export/timetable.ics", query: { scope: "CLASSROOM", token } });
        expect(feed.statusCode).toBe(200);
        expect(feed.body).toContain("SUMMARY:Histoire\\, géo");
        const dl = await call("GET", "/export/download.ics", { query: { scope: "CLASSROOM", subjectId: cls.classroomId, from: "2026-10-01", to: "2026-10-31" } });
        expect(dl.status).toBe(200);
        expect(dl.res.headers["content-disposition"]).toContain("attachment");
        expect(dl.text).toContain("BEGIN:VEVENT");
        w.clock.set("2026-10-20T00:00:00.000Z"); // le jeton valait 1 jour
        expect((await app.inject({ method: "GET", url: "/api/v1/scheduling/export/timetable.ics", query: { scope: "CLASSROOM", token } })).statusCode).toBe(404);
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
      // Limiteur de débit (5 requêtes par fenêtre dans ce test).
      limiterHits.clear();
      const codes: number[] = [];
      for (let i = 0; i < 7; i += 1) codes.push((await app.inject({ method: "GET", url: "/api/v1/scheduling/export/timetable.ics", query: { scope: "CLASSROOM", token: `${w.tenantId}.${"y".repeat(43)}` } })).statusCode);
      expect(codes).toEqual([404, 404, 404, 404, 404, 429, 429]);
    });
  });

  it("réservations de salle : conflit entre réservations ; occupation des salles avec amplitude d'ouverture", async () => {
    const room = (await call("POST", "/rooms", { body: { institutionId: w.institutionId, campusId: w.campusId, code: "OCC", name: "Salle occupation", roomTypeCode: "CLASSROOM" } })).json;
    const book = (start: string, end: string) => call("POST", "/occurrences", { body: { kind: "RESERVATION", roomId: room.id, title: "Réservation", date: "2026-11-23", startTime: start, endTime: end } });
    expect((await book("08:00", "10:00")).status).toBe(201);
    const clash = await book("09:00", "11:00");
    expect(clash.status).toBe(409);
    expect(clash.json.message).toContain("La salle Salle occupation est déjà réservée le 23/11/2026 de 08:00 à 10:00");
    expect((await book("10:00", "11:00")).status).toBe(201);
    const occ = await call("GET", "/reports/room-occupancy", { query: { campusId: w.campusId, from: "2026-11-23", to: "2026-11-23" } });
    const row = occ.json.rooms.find((r: { roomId: string }) => r.roomId === room.id);
    // Ouverture 07:30–17:30 un lundi = 600 min ; occupé 180 min → 30 %.
    expect(row).toMatchObject({ occupiedMinutes: 180, availableMinutes: 600, rateBp: 3000 });
    void holdOccurrence;
    void unwrap;
  });
});
