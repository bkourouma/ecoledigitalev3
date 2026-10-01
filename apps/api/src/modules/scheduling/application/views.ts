/**
 * Emploi du temps en LECTURE (spec 017 US6) : par classe, enseignant, salle, élève/parent ; « aujourd'hui »
 * de l'enseignant ; files de travail (à valider, non constatées, à remplacer) ; occupation des salles ;
 * charge hebdomadaire ; export iCalendar avec jetons d'abonnement révocables.
 *
 * Accès : `ALL` (permission `schedule.read`) voit tout ; les portails passent par l'identité du contexte —
 * un enseignant ne voit que SES séances, un élève que les siennes, un parent que celles de SES enfants,
 * jamais celles d'un autre. Les portails n'exposent que les emplois du temps PUBLIÉS et jamais les séances
 * comptables.
 */
import { createHash, randomBytes } from "node:crypto";
import { ABIDJAN_TZ, createSystemContext, ForbiddenError, NotFoundError, err, isUuid, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { buildIcs, type IcsEvent } from "../domain/ical";
import { SchedulingCodes, notFound } from "../domain/errors";
import { addDays, compareDates, daysBetween, eachDate, isoWeekday, mondayOf, parseTimeOfDay } from "../domain/time";
import type { Occurrence, OccurrenceDetail, SchedulingSettings } from "../domain/types";
import { listChanges, getOccurrenceDetail, withDetails, type ChangeRow } from "../infrastructure/occurrence-repo";
import * as ics from "../infrastructure/ics-repo";
import * as q from "../infrastructure/read-queries";
import { getRoom, getRoomsByIds, listRooms, listSettingsInstitutions } from "../infrastructure/reference-repo";
import { inTx, EventBuffer, type SchedulingDeps } from "./deps";
import { loadSettings, validation } from "./support";
import { localDateOf } from "../domain/time";

export type ViewAccess = "ALL" | "OWN";

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export interface WindowInput {
  from: string;
  to: string;
  limit?: number | undefined;
  offset?: number | undefined;
  includeCancelled?: boolean | undefined;
}

const statusesOf = (includeCancelled: boolean | undefined): q.OccurrenceFilter["statuses"] => (includeCancelled ? undefined : ["PLANNED", "HELD"]);

function checkWindow(w: { from: string; to: string }): Result<void, AppError> {
  if (w.to < w.from) return err(validation("to", "La fin de la fenêtre précède son début.", "invalid_range"));
  if (daysBetween(w.from, w.to) > 400) return err(validation("to", "La fenêtre ne peut pas dépasser 400 jours.", "window_too_large"));
  return ok(undefined);
}

async function resolveTimezone(tx: Tx, ctx: RequestContext): Promise<string> {
  if (ctx.institutionId) return (await loadSettings(tx, ctx.institutionId)).timezone;
  const all = await listSettingsInstitutions(tx);
  return all[0]?.timezone ?? ABIDJAN_TZ;
}

async function page(tx: Tx, filter: q.OccurrenceFilter): Promise<Page<OccurrenceDetail>> {
  const { items, hasMore } = await q.listOccurrenceRows(tx, filter);
  return { items: await withDetails(tx, items), hasMore };
}

// ---------------------------------------------------------------------------
// Détail et journal
// ---------------------------------------------------------------------------

export interface OccurrenceView extends OccurrenceDetail {
  attendanceSubmitted: boolean | null;
}

export async function getOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceId: string }): Promise<Result<OccurrenceView, AppError>> {
  const detail = await deps.db.run(ctx, (tx) => getOccurrenceDetail(tx, input.occurrenceId), { readOnly: true });
  if (!detail) return err(notFound("Séance", input.occurrenceId));
  const attendanceSubmitted = deps.ports.attendance ? await deps.ports.attendance.hasSubmittedAttendance(ctx, detail.id) : null;
  return ok({ ...detail, attendanceSubmitted });
}

export async function getOccurrenceHistory(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceId: string }): Promise<Result<ChangeRow[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const exists = await getOccurrenceDetail(tx, input.occurrenceId);
      if (!exists) return err(notFound("Séance", input.occurrenceId));
      return ok(await listChanges(tx, input.occurrenceId));
    },
    { readOnly: true },
  );
}

export interface ListOccurrencesInput {
  from?: string | undefined;
  to?: string | undefined;
  classroomId?: string | undefined;
  offeringId?: string | undefined;
  roomId?: string | undefined;
  staffId?: string | undefined;
  curriculumNodeId?: string | undefined;
  timetableId?: string | undefined;
  institutionId?: string | undefined;
  statuses?: Array<"PLANNED" | "HELD" | "CANCELLED"> | undefined;
  kinds?: q.OccurrenceFilter["kinds"];
  validated?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function listOccurrences(deps: SchedulingDeps, ctx: RequestContext, input: ListOccurrencesInput): Promise<Result<Page<OccurrenceDetail> & { total: number }, AppError>> {
  if (input.from && input.to) {
    const w = checkWindow({ from: input.from, to: input.to });
    if (!w.ok) return w;
  }
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const filter: q.OccurrenceFilter = { ...stripUndefined(input) };
      const [p, total] = await Promise.all([page(tx, filter), q.countOccurrences(tx, filter)]);
      return ok({ ...p, total });
    },
    { readOnly: true },
  );
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

// ---------------------------------------------------------------------------
// Vues par ressource
// ---------------------------------------------------------------------------

export function listOccurrencesForClassroom(deps: SchedulingDeps, ctx: RequestContext, input: WindowInput & { classroomId: string }): Promise<Result<Page<OccurrenceDetail>, AppError>> {
  const w = checkWindow(input);
  if (!w.ok) return Promise.resolve(w);
  return inTx(deps, ctx, async (tx) => ok(await page(tx, { from: input.from, to: input.to, classroomId: input.classroomId, statuses: statusesOf(input.includeCancelled), ...pageOf(input) })), { readOnly: true });
}

export function listOccurrencesForRoom(deps: SchedulingDeps, ctx: RequestContext, input: WindowInput & { roomId: string }): Promise<Result<Page<OccurrenceDetail>, AppError>> {
  const w = checkWindow(input);
  if (!w.ok) return Promise.resolve(w);
  return inTx(deps, ctx, async (tx) => ok(await page(tx, { from: input.from, to: input.to, roomId: input.roomId, statuses: statusesOf(input.includeCancelled), ...pageOf(input) })), { readOnly: true });
}

const pageOf = (i: { limit?: number | undefined; offset?: number | undefined }): { limit?: number; offset?: number } => ({
  ...(i.limit !== undefined ? { limit: i.limit } : {}),
  ...(i.offset !== undefined ? { offset: i.offset } : {}),
});

/** Séances d'un intervenant. `OWN` : l'identité de l'appelant doit être ce membre du personnel (identité dérivée du contexte). */
export async function listOccurrencesForStaff(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: WindowInput & { staffId: string; access: ViewAccess },
): Promise<Result<Page<OccurrenceDetail>, AppError>> {
  const w = checkWindow(input);
  if (!w.ok) return w;
  if (input.access === "OWN") {
    const mine = await ownStaffId(deps, ctx);
    if (!mine.ok) return mine;
    if (mine.value !== input.staffId) return err(new ForbiddenError("Vous ne pouvez consulter que votre propre emploi du temps.", { code: "FORBIDDEN" }));
  }
  return inTx(deps, ctx, async (tx) => ok(await page(tx, { from: input.from, to: input.to, staffId: input.staffId, statuses: statusesOf(input.includeCancelled), excludeAccounting: input.access === "OWN", ...pageOf(input) })), { readOnly: true });
}

async function ownStaffId(deps: SchedulingDeps, ctx: RequestContext): Promise<Result<string, AppError>> {
  const people = deps.ports.people;
  if (!people || !ctx.userId) return err(new ForbiddenError("L'identité du personnel n'est pas disponible.", { code: SchedulingCodes.peopleUnavailable }));
  const id = await people.resolveStaffForUser(ctx, ctx.userId);
  return id ? ok(id) : err(new ForbiddenError("Votre compte n'est lié à aucun membre du personnel.", { code: SchedulingCodes.notAssigned }));
}

export type StudentAccess = "MANAGER" | "SELF" | "GUARDIAN";

/**
 * Emploi du temps d'un apprenant : résout ses placements actifs (classes et offres à la carte) via
 * `AcademicQuery`. `SELF` : l'élève du contexte uniquement ; `GUARDIAN` : tuteur lié (revérifié à chaque
 * lecture) ; les portails ne voient que le publié, à venir, sans séances comptables.
 */
export async function listOccurrencesForStudent(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: WindowInput & { studentId: string; access: StudentAccess },
): Promise<Result<Page<OccurrenceDetail>, AppError>> {
  const w = checkWindow(input);
  if (!w.ok) return w;
  const academic = deps.ports.academic;
  if (!academic) return err(new ForbiddenError("Le référentiel des inscriptions n'est pas disponible.", { code: SchedulingCodes.academicUnavailable }));
  if (input.access !== "MANAGER") {
    const people = deps.ports.people;
    if (!people || !ctx.userId) return err(new ForbiddenError("Le référentiel des personnes n'est pas disponible.", { code: SchedulingCodes.peopleUnavailable }));
    if (input.access === "SELF") {
      const me = await people.resolveStudentForUser(ctx, ctx.userId);
      if (!me || me !== input.studentId) return err(new ForbiddenError("Vous ne pouvez consulter que votre propre emploi du temps.", { code: "FORBIDDEN" }));
    } else if (!(await people.isGuardianOfStudent(ctx, ctx.userId, input.studentId))) {
      return err(new ForbiddenError("Vous n'êtes pas le tuteur de cet élève.", { code: "FORBIDDEN" }));
    }
  }
  const placements = await academic.listStudentPlacements(ctx, input.studentId);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      let from = input.from;
      if (input.access !== "MANAGER") {
        // Portails : occurrences à venir seulement (début de la journée locale comme plancher).
        const tz = await resolveTimezone(tx, ctx);
        const today = localDateOf(deps.clock.now(), tz);
        if (compareDates(from, today) < 0) from = today;
      }
      if (placements.classroomIds.length === 0 && placements.offeringIds.length === 0) return ok({ items: [], hasMore: false });
      return ok(
        await page(tx, {
          from,
          to: input.to,
          studentScope: placements,
          statuses: statusesOf(input.includeCancelled),
          portalOnly: input.access !== "MANAGER",
          ...pageOf(input),
        }),
      );
    },
    { readOnly: true },
  );
}

/** « Aujourd'hui » de l'enseignant connecté : séances du jour (fuseau de l'établissement), triées. */
export async function listMyToday(deps: SchedulingDeps, ctx: RequestContext): Promise<Result<{ date: string; items: OccurrenceDetail[]; staffId: string }, AppError>> {
  const mine = await ownStaffId(deps, ctx);
  if (!mine.ok) return mine;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const tz = await resolveTimezone(tx, ctx);
      const date = localDateOf(deps.clock.now(), tz);
      const p = await page(tx, { from: date, to: date, staffId: mine.value, statuses: ["PLANNED", "HELD"], limit: 200, excludeAccounting: true });
      return ok({ date, items: p.items, staffId: mine.value });
    },
    { readOnly: true },
  );
}

/** « Mon emploi du temps » : enseignant, sinon élève, selon le compte. */
export async function listMyTimetable(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: WindowInput,
): Promise<Result<{ subject: "STAFF" | "STUDENT"; subjectId: string; page: Page<OccurrenceDetail> }, AppError>> {
  const people = deps.ports.people;
  if (!people || !ctx.userId) return err(new ForbiddenError("L'identité n'est pas disponible.", { code: SchedulingCodes.peopleUnavailable }));
  const staffId = await people.resolveStaffForUser(ctx, ctx.userId);
  if (staffId) {
    const r = await listOccurrencesForStaff(deps, ctx, { ...input, staffId, access: "OWN" });
    return r.ok ? ok({ subject: "STAFF" as const, subjectId: staffId, page: r.value }) : r;
  }
  const studentId = await people.resolveStudentForUser(ctx, ctx.userId);
  if (studentId) {
    const r = await listOccurrencesForStudent(deps, ctx, { ...input, studentId, access: "SELF" });
    return r.ok ? ok({ subject: "STUDENT" as const, subjectId: studentId, page: r.value }) : r;
  }
  return err(new ForbiddenError("Votre compte n'est lié ni à un membre du personnel ni à un élève.", { code: SchedulingCodes.notAssigned }));
}

// ---------------------------------------------------------------------------
// Files de travail
// ---------------------------------------------------------------------------

export function listPendingValidation(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { from?: string | undefined; to?: string | undefined; staffId?: string | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<Result<Page<OccurrenceDetail>, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await page(tx, {
          ...(input.from ? { from: input.from } : {}),
          ...(input.to ? { to: input.to } : {}),
          ...(input.staffId ? { staffId: input.staffId } : {}),
          statuses: ["HELD"],
          validated: false,
          pastFirstAround: deps.clock.now(),
          ...pageOf(input),
        }),
      ),
    { readOnly: true },
  );
}

/** Séances PLANNED dont l'heure de fin est passée (jamais constatées) — rapprochement « séances non réalisées ». */
export function listUnrealizedOccurrences(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { from?: string | undefined; to?: string | undefined; classroomId?: string | undefined; staffId?: string | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<Result<Page<OccurrenceDetail>, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await page(tx, {
          ...(input.from ? { from: input.from } : {}),
          ...(input.to ? { to: input.to } : {}),
          ...(input.classroomId ? { classroomId: input.classroomId } : {}),
          ...(input.staffId ? { staffId: input.staffId } : {}),
          statuses: ["PLANNED"],
          kinds: ["LESSON"],
          endedBefore: deps.clock.now(),
          ...pageOf(input),
        }),
      ),
    { readOnly: true },
  );
}

export function listPendingReplacements(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { from?: string | undefined; to?: string | undefined; classroomId?: string | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<Result<Page<OccurrenceDetail>, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await page(tx, {
          ...(input.from ? { from: input.from } : {}),
          ...(input.to ? { to: input.to } : {}),
          ...(input.classroomId ? { classroomId: input.classroomId } : {}),
          needsReplacement: true,
          statuses: ["PLANNED", "HELD"],
          ...pageOf(input),
        }),
      ),
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Occupation des salles, charge d'un intervenant
// ---------------------------------------------------------------------------

export interface RoomOccupancyView {
  roomId: string;
  code: string;
  name: string;
  occupiedMinutes: number;
  /** Minutes d'ouverture sur la période (null si l'amplitude d'ouverture n'est pas renseignée). */
  availableMinutes: number | null;
  /** Taux d'occupation en points de base (10000 = 100 %), null sans amplitude d'ouverture. */
  rateBp: number | null;
}

export function openingMinutesBetween(settings: Pick<SchedulingSettings, "openingStart" | "openingEnd" | "openingWeekdays">, from: string, to: string): number | null {
  if (!settings.openingStart || !settings.openingEnd) return null;
  const perDay = parseTimeOfDay(settings.openingEnd) - parseTimeOfDay(settings.openingStart);
  const days = settings.openingWeekdays ?? [1, 2, 3, 4, 5, 6, 7];
  let n = 0;
  for (const d of eachDate(from, to)) if (days.includes(isoWeekday(d))) n += 1;
  return n * perDay;
}

export function getRoomOccupancy(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { campusId: string; from: string; to: string },
): Promise<Result<{ rooms: RoomOccupancyView[]; totalOccupiedMinutes: number; totalAvailableMinutes: number | null; rateBp: number | null }, AppError>> {
  const w = checkWindow(input);
  if (!w.ok) return Promise.resolve(w);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rooms = await listRooms(tx, { campusId: input.campusId });
      const occ = new Map((await q.roomOccupancy(tx, input.campusId, input)).map((r) => [r.roomId, r.occupiedMinutes]));
      const institutionId = rooms[0]?.institutionId;
      const settings = institutionId ? await loadSettings(tx, institutionId) : null;
      const per = settings ? openingMinutesBetween(settings, input.from, input.to) : null;
      const views = rooms
        .filter((r) => r.status !== "ARCHIVED")
        .map<RoomOccupancyView>((r) => {
          const occupiedMinutes = occ.get(r.id) ?? 0;
          return { roomId: r.id, code: r.code, name: r.name, occupiedMinutes, availableMinutes: per, rateBp: per && per > 0 ? Math.round((occupiedMinutes * 10_000) / per) : null };
        });
      const totalOccupiedMinutes = views.reduce((s, v) => s + v.occupiedMinutes, 0);
      const totalAvailableMinutes = per === null ? null : per * views.length;
      return ok({
        rooms: views,
        totalOccupiedMinutes,
        totalAvailableMinutes,
        rateBp: totalAvailableMinutes && totalAvailableMinutes > 0 ? Math.round((totalOccupiedMinutes * 10_000) / totalAvailableMinutes) : null,
      });
    },
    { readOnly: true },
  );
}

/** Heures planifiées d'une semaine (lundi → dimanche) pour un intervenant : AUCUN seuil ni alerte. */
export function getStaffWeeklyLoad(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { staffId: string; weekOf: string },
): Promise<Result<{ weekStart: string; weekEnd: string; days: Array<{ date: string; minutes: number }>; totalMinutes: number }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const weekStart = mondayOf(input.weekOf);
      const weekEnd = addDays(weekStart, 6);
      const rows = new Map((await q.staffLoadByDay(tx, input.staffId, { from: weekStart, to: weekEnd })).map((r) => [r.occursOn, r.minutes]));
      const days = [...eachDate(weekStart, weekEnd)].map((date) => ({ date, minutes: rows.get(date) ?? 0 }));
      return ok({ weekStart, weekEnd, days, totalMinutes: days.reduce((s, d) => s + d.minutes, 0) });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// iCalendar
// ---------------------------------------------------------------------------

export type IcsScope = ics.IcsScope;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Droit de consulter le sujet d'un abonnement. `OWN` : soi-même (personnel/élève) ou son enfant (tuteur). */
async function authorizeSubject(deps: SchedulingDeps, ctx: RequestContext, scope: IcsScope, subjectId: string, access: ViewAccess): Promise<Result<void, AppError>> {
  if (access === "ALL") return ok(undefined);
  const people = deps.ports.people;
  if (!people || !ctx.userId) return err(new ForbiddenError("L'identité n'est pas disponible.", { code: SchedulingCodes.peopleUnavailable }));
  if (scope === "STAFF") {
    const me = await people.resolveStaffForUser(ctx, ctx.userId);
    if (me === subjectId) return ok(undefined);
  } else if (scope === "STUDENT") {
    const me = await people.resolveStudentForUser(ctx, ctx.userId);
    if (me === subjectId || (await people.isGuardianOfStudent(ctx, ctx.userId, subjectId))) return ok(undefined);
  }
  return err(new ForbiddenError("Vous n'avez pas accès à cet emploi du temps.", { code: "FORBIDDEN" }));
}

export interface CreatedIcsToken {
  tokenId: string;
  /** Jeton en clair : montré UNE fois (seule son empreinte est stockée). */
  token: string;
  expiresAt: Date | null;
}

export async function createIcsToken(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { scope: IcsScope; subjectId: string; label?: string | undefined; expiresInDays?: number | undefined; access: ViewAccess },
): Promise<Result<CreatedIcsToken, AppError>> {
  const allowed = await authorizeSubject(deps, ctx, input.scope, input.subjectId, input.access);
  if (!allowed.ok) return allowed;
  if (input.expiresInDays !== undefined && (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 3650)) {
    return err(validation("expiresInDays", "La durée de validité est un nombre entier de jours (1 à 3650).", "invalid_expiry"));
  }
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const now = deps.clock.now();
    const token = `${ctx.tenantId}.${randomBytes(32).toString("base64url")}`;
    const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86_400_000) : null;
    const row = await ics.insertToken(tx, ctx.tenantId, { id: deps.newId(), scope: input.scope, subjectId: input.subjectId, label: input.label ?? null, tokenHash: sha256(token), expiresAt }, ctx.userId, now);
    buf.audit({ action: "scheduling.ics_token.created", resourceType: "ics_token", resourceId: row.id, metadata: { scope: input.scope, subjectId: input.subjectId } });
    await buf.flush(tx);
    return ok({ tokenId: row.id, token, expiresAt });
  });
}

export async function revokeIcsToken(deps: SchedulingDeps, ctx: RequestContext, input: { tokenId: string; access: ViewAccess }): Promise<Result<{ revoked: boolean }, AppError>> {
  if (!ctx.userId) return err(validation("userId", "La révocation exige un utilisateur identifié.", "user_required"));
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const existing = await ics.getToken(tx, input.tokenId);
    if (!existing) return err(notFound("Jeton d'abonnement", input.tokenId));
    const allowed = await authorizeSubject(deps, ctx, existing.scope, existing.subjectId, input.access);
    if (!allowed.ok) return allowed;
    const row = await ics.revokeToken(tx, input.tokenId, ctx.userId as string, deps.clock.now());
    if (row) buf.audit({ action: "scheduling.ics_token.revoked", resourceType: "ics_token", resourceId: row.id, metadata: { scope: row.scope, subjectId: row.subjectId } });
    await buf.flush(tx);
    return ok({ revoked: row !== null });
  });
}

export async function listIcsTokens(deps: SchedulingDeps, ctx: RequestContext, input: { scope: IcsScope; subjectId: string; access: ViewAccess }): Promise<Result<ics.IcsTokenRow[], AppError>> {
  const allowed = await authorizeSubject(deps, ctx, input.scope, input.subjectId, input.access);
  if (!allowed.ok) return allowed;
  return inTx(deps, ctx, async (tx) => ok(await ics.listTokens(tx, input.scope, input.subjectId)), { readOnly: true });
}

async function buildCalendar(deps: SchedulingDeps, ctx: RequestContext, tx: Tx, scope: IcsScope, subjectId: string, window: { from: string; to: string }, portal: boolean): Promise<Result<string, AppError>> {
  const filter: q.OccurrenceFilter = { from: window.from, to: window.to, limit: q.MAX_PAGE, excludeAccounting: true, ...(portal ? { portalOnly: true } : {}) };
  let name = "Emploi du temps";
  if (scope === "CLASSROOM") {
    filter.classroomId = subjectId;
    const c = deps.ports.academic ? await deps.ports.academic.getClassroom(ctx, subjectId) : null;
    name = c ? `Emploi du temps — ${c.name}` : name;
  } else if (scope === "STAFF") {
    filter.staffId = subjectId;
    const s = deps.ports.people ? (await deps.ports.people.getStaffByIds(ctx, [subjectId]))[0] : undefined;
    name = s ? `Emploi du temps — ${s.displayName}` : name;
  } else if (scope === "ROOM") {
    filter.roomId = subjectId;
    const r = await getRoom(tx, subjectId);
    name = r ? `Salle ${r.name}` : name;
  } else {
    const academic = deps.ports.academic;
    if (!academic) return err(new ForbiddenError("Le référentiel des inscriptions n'est pas disponible.", { code: SchedulingCodes.academicUnavailable }));
    filter.studentScope = await academic.listStudentPlacements(ctx, subjectId);
    filter.portalOnly = true;
  }
  const events: IcsEvent[] = [];
  const settingsCache = new Map<string, SchedulingSettings>();
  let offset = 0;
  for (let i = 0; i < 20; i += 1) {
    const { items, hasMore } = await q.listOccurrenceRows(tx, { ...filter, offset });
    const rooms = new Map((await getRoomsByIds(tx, [...new Set(items.flatMap((o) => (o.roomId ? [o.roomId] : [])))])).map((r) => [r.id, r.name]));
    for (const o of items) {
      let settings = settingsCache.get(o.institutionId);
      if (!settings) {
        settings = await loadSettings(tx, o.institutionId);
        settingsCache.set(o.institutionId, settings);
      }
      events.push(toIcsEvent(o, rooms.get(o.roomId ?? "") ?? o.locationLabel));
    }
    if (!hasMore) break;
    offset += q.MAX_PAGE;
  }
  const tz = [...settingsCache.values()][0]?.timezone ?? (await resolveTimezone(tx, ctx));
  return ok(buildIcs({ name, timeZone: tz, events, now: deps.clock.now() }));
}

const KIND_LABELS: Record<string, string> = { LESSON: "Cours", EXAM: "Examen", MEETING: "Réunion", EVENT: "Événement", RESERVATION: "Réservation de salle", COUNCIL: "Conseil", OTHER: "Séance" };

function toIcsEvent(o: Occurrence, location: string | null): IcsEvent {
  return {
    uid: o.id,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    summary: o.title ?? KIND_LABELS[o.kind] ?? "Séance",
    location,
    description: o.status === "CANCELLED" ? `Séance annulée${o.cancelReason ? ` : ${o.cancelReason}` : ""}` : null,
    status: o.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
    updatedAt: o.cancelledAt ?? o.validatedAt ?? o.heldAt ?? o.createdAt,
  };
}

function defaultIcsWindow(now: Date, from?: string, to?: string): { from: string; to: string } {
  const today = now.toISOString().slice(0, 10);
  const f = from ?? addDays(today, -14);
  return { from: f, to: to ?? addDays(f, 200) };
}

/** Export authentifié (session de l'utilisateur). */
export async function exportTimetableIcs(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { scope: IcsScope; subjectId: string; from?: string | undefined; to?: string | undefined; access: ViewAccess },
): Promise<Result<string, AppError>> {
  const allowed = await authorizeSubject(deps, ctx, input.scope, input.subjectId, input.access);
  if (!allowed.ok) return allowed;
  const window = defaultIcsWindow(deps.clock.now(), input.from, input.to);
  const w = checkWindow(window);
  if (!w.ok) return w;
  return inTx(deps, ctx, (tx) => buildCalendar(deps, ctx, tx, input.scope, input.subjectId, window, input.access === "OWN"), { readOnly: true });
}

export interface IcsTokenFeed {
  ics: string;
}

/**
 * Flux d'abonnement par jeton (route publique) : le tenant est le préfixe du jeton ; on ne confie rien
 * au client — jeton inconnu, révoqué, expiré ou mal formé donnent la MÊME erreur générique.
 */
export async function readIcsFeed(deps: SchedulingDeps, input: { token: string; scope: IcsScope }): Promise<Result<IcsTokenFeed, AppError>> {
  const invalid = (): AppError => new NotFoundError("Abonnement introuvable ou révoqué.", { code: SchedulingCodes.tokenInvalid });
  const dot = input.token.indexOf(".");
  if (dot !== 36) return err(invalid());
  const tenantId = input.token.slice(0, dot);
  if (!isUuid(tenantId) || input.token.length > 200) return err(invalid());
  const ctx = createSystemContext(tenantId);
  const now = deps.clock.now();
  return inTx(deps, ctx, async (tx) => {
    const row = await ics.findTokenByHash(tx, sha256(input.token));
    if (!row || row.revokedAt !== null || row.scope !== input.scope || (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime())) return err(invalid());
    await ics.touchToken(tx, row.id, now);
    const window = defaultIcsWindow(now);
    const feed = await buildCalendar(deps, ctx, tx, row.scope, row.subjectId, window, row.scope === "STUDENT");
    return feed.ok ? ok({ ics: feed.value }) : feed;
  });
}
