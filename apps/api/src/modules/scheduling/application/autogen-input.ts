/**
 * Générateur d'emploi du temps : construction du PROBLÈME à partir des paramètres de la demande et de l'état de
 * l'établissement (grille horaire, salles, disponibilités des enseignants, classes, occupation d'un autre emploi
 * du temps). Lecture seule. Aucune règle officielle : tout vient de la demande ou des paramètres de l'école.
 */
import { NotFoundError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { availabilityStatus, type AvailabilityRule } from "../domain/conflicts";
import { validateProblem } from "../domain/autogen/engine";
import {
  DEFAULT_WEIGHTS,
  GenProblemError,
  type GenClass,
  type GenFixedPlacement,
  type GenPeriod,
  type GenProblem,
  type GenRequirement,
  type GenRoom,
  type GenTeacher,
  type GenWeights,
  type SlotRef,
} from "../domain/autogen/types";
import { SchedulingCodes, academicUnavailable } from "../domain/errors";
import { firstWeekdayOnOrAfter, formatTimeOfDay, parseTimeOfDay } from "../domain/time";
import type { Room, SchedulingSettings, TimeSlot } from "../domain/types";
import * as ref from "../infrastructure/reference-repo";
import * as tt from "../infrastructure/timetable-repo";
import type { SchedulingDeps } from "./deps";
import { PLANNABLE_STAFF_STATUSES } from "./ports/people";
import { checkStaffEligible, loadSettings, validation } from "./support";

// ---------------------------------------------------------------------------
// Paramètres de la demande (miroir de `schedulingAutogenRunBodySchema`)
// ---------------------------------------------------------------------------

export interface AutogenRange {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface AutogenRequirementInput {
  classroomId: string;
  curriculumNodeId: string;
  label?: string | undefined;
  sessionsPerWeek: number;
  sessionPeriods?: number | undefined;
  teacherIds?: string[] | undefined;
  needsRoom?: boolean | undefined;
  roomType?: string | undefined;
  features?: string[] | undefined;
  roomId?: string | undefined;
  maxPerDay?: number | undefined;
  preferredStartTimes?: string[] | undefined;
}

export interface AutogenTeacherInput {
  staffId: string;
  maxPeriodsPerDay?: number | null | undefined;
  maxPeriodsPerWeek?: number | null | undefined;
  unavailable?: AutogenRange[] | undefined;
  avoid?: AutogenRange[] | undefined;
  prefer?: AutogenRange[] | undefined;
}

export interface AutogenParams {
  institutionId: string;
  campusId?: string | null | undefined;
  academicYearId: string;
  periodId?: string | null | undefined;
  name: string;
  validFrom: string;
  validTo: string;
  seed?: string | undefined;
  timeLimitSeconds?: number | undefined;
  maxIterations?: number | undefined;
  weights?: Partial<GenWeights> | undefined;
  weekdays?: number[] | undefined;
  grid?: { mode?: "TIME_SLOTS" | "REGULAR" | undefined; dayStart?: string | undefined; dayEnd?: string | undefined; periodMinutes?: number | undefined } | undefined;
  closedRanges?: AutogenRange[] | undefined;
  requirements: AutogenRequirementInput[];
  teachers?: AutogenTeacherInput[] | undefined;
  fixedTimetableId?: string | null | undefined;
  deriveTeachers?: boolean | undefined;
  mode?: "AUTO" | "SYNC" | "ASYNC" | undefined;
}

export const AUTOGEN_DEFAULTS = Object.freeze({
  timeLimitSeconds: 20,
  maxTimeLimitSeconds: 600,
  maxIterations: 100_000,
  maxIterationsCap: 2_000_000,
  periodMinutes: 60,
  /** Au plus ce nombre de séances : calcul immédiat dans la requête ; au-delà, tâche asynchrone. */
  syncSessionLimit: 250,
  /** Limite de temps au-delà de laquelle le calcul n'est jamais fait dans la requête. */
  syncMaxSeconds: 30,
  maxSessions: 8000,
  deriveTeachersCap: 5,
});

export interface PreparedLabels {
  classrooms: Record<string, string>;
  staff: Record<string, string>;
  rooms: Record<string, string>;
  nodes: Record<string, string>;
}

export interface PreparedProblem {
  problem: GenProblem;
  grid: { weekdays: number[]; periods: Array<{ index: number; startTime: string; endTime: string; label: string | null }>; source: "TIME_SLOTS" | "REGULAR" };
  labels: PreparedLabels;
  publishedTimetable: { id: string; name: string } | null;
  warnings: Array<{ code: string; message: string; requirementId?: string }>;
  sessionCount: number;
}

// ---------------------------------------------------------------------------
// Grille
// ---------------------------------------------------------------------------

export interface ResolvedGrid {
  periods: GenPeriod[];
  source: "TIME_SLOTS" | "REGULAR";
  warnings: Array<{ code: string; message: string }>;
}

/** Périodes d'une journée : cloches de la grille de l'établissement (hors pauses) ou périodes régulières. */
export async function resolveGrid(
  tx: Tx,
  settings: SchedulingSettings,
  input: { institutionId: string; campusId: string | null; grid?: AutogenParams["grid"] },
): Promise<Result<ResolvedGrid, AppError>> {
  const warnings: Array<{ code: string; message: string }> = [];
  const slots = (await ref.listTimeSlots(tx, { institutionId: input.institutionId, campusId: input.campusId, activeOnly: true })).filter((s) => !s.isBreak);
  const mode = input.grid?.mode ?? (slots.length > 0 ? "TIME_SLOTS" : "REGULAR");
  if (mode === "TIME_SLOTS") {
    if (slots.length === 0) return err(validation("grid", "Aucune plage horaire n'est définie dans la grille de l'établissement.", "time_slots_required"));
    const periods: GenPeriod[] = [];
    let end = -1;
    for (const s of [...slots].sort((a: TimeSlot, b: TimeSlot) => parseTimeOfDay(a.startsTime) - parseTimeOfDay(b.startsTime) || a.ordinal - b.ordinal || a.code.localeCompare(b.code))) {
      const start = parseTimeOfDay(s.startsTime);
      if (start < end) {
        warnings.push({ code: "TIME_SLOT_OVERLAP", message: `La plage « ${s.label} » chevauche la précédente : ignorée.` });
        continue;
      }
      periods.push({ startMinute: start, endMinute: parseTimeOfDay(s.endsTime), timeSlotId: s.id, label: s.label });
      end = parseTimeOfDay(s.endsTime);
    }
    return ok({ periods, source: "TIME_SLOTS", warnings });
  }
  const startText = input.grid?.dayStart ?? settings.openingStart;
  const endText = input.grid?.dayEnd ?? settings.openingEnd;
  if (!startText || !endText) return err(validation("grid", "Renseignez l'ouverture de l'établissement (paramètres) ou précisez l'heure de début et de fin de journée.", "opening_required"));
  const length = input.grid?.periodMinutes ?? AUTOGEN_DEFAULTS.periodMinutes;
  const dayStart = parseTimeOfDay(startText);
  const dayEnd = parseTimeOfDay(endText);
  if (dayEnd <= dayStart) return err(validation("grid", "La fin de journée précède son début.", "invalid_range"));
  const periods: GenPeriod[] = [];
  for (let m = dayStart; m + length <= dayEnd; m += length) periods.push({ startMinute: m, endMinute: m + length, timeSlotId: null, label: null });
  if (periods.length === 0) return err(validation("grid", "La journée est trop courte pour une période.", "no_period"));
  return ok({ periods, source: "REGULAR", warnings });
}

const periodDto = (periods: readonly GenPeriod[]): PreparedProblem["grid"]["periods"] =>
  periods.map((p, index) => ({ index, startTime: formatTimeOfDay(p.startMinute), endTime: formatTimeOfDay(p.endMinute), label: p.label ?? null }));

/** Cases (jour, période) touchées par une plage horaire. */
function rangeToSlots(range: AutogenRange, weekdays: readonly number[], periods: readonly GenPeriod[]): SlotRef[] {
  if (!weekdays.includes(range.weekday)) return [];
  const start = parseTimeOfDay(range.startTime);
  const end = parseTimeOfDay(range.endTime);
  const out: SlotRef[] = [];
  periods.forEach((p, period) => {
    if (p.startMinute < end && start < p.endMinute) out.push({ weekday: range.weekday, period });
  });
  return out;
}

/** Jours ouvrés : ceux de la demande, sinon ceux de l'établissement ; jamais inventés. */
export function resolveWeekdays(settings: SchedulingSettings, requested: readonly number[] | undefined): Result<number[], AppError> {
  const days = requested ?? settings.openingWeekdays ?? null;
  if (!days || days.length === 0) return err(validation("weekdays", "Renseignez les jours ouvrés (paramètres de l'établissement) ou précisez-les dans la demande.", "opening_required"));
  return ok([...new Set(days)].sort((a, b) => a - b));
}

// ---------------------------------------------------------------------------
// Problème
// ---------------------------------------------------------------------------

function toWeights(overrides: Partial<GenWeights> | undefined): GenWeights {
  const out: Record<string, number> = { ...DEFAULT_WEIGHTS };
  for (const [k, v] of Object.entries(overrides ?? {})) if (typeof v === "number") out[k] = v;
  return out as unknown as GenWeights;
}

export async function prepareProblem(deps: SchedulingDeps, ctx: RequestContext, tx: Tx, params: AutogenParams, seed: string): Promise<Result<PreparedProblem, AppError>> {
  const academic = deps.ports.academic;
  if (!academic) return err(academicUnavailable());
  const warnings: PreparedProblem["warnings"] = [];
  const settings = await loadSettings(tx, params.institutionId);

  const weekdaysR = resolveWeekdays(settings, params.weekdays);
  if (!weekdaysR.ok) return weekdaysR;
  const weekdays = weekdaysR.value;
  const campusId = params.campusId ?? null;
  const gridR = await resolveGrid(tx, settings, { institutionId: params.institutionId, campusId, grid: params.grid });
  if (!gridR.ok) return gridR;
  const periods = gridR.value.periods;
  for (const w of gridR.value.warnings) warnings.push(w);
  for (const [i, r] of params.requirements.entries()) {
    if ((r.sessionPeriods ?? 1) > periods.length) return err(validation(`requirements.${i}.sessionPeriods`, `Une séance de ${r.sessionPeriods} périodes ne tient pas dans une journée de ${periods.length} périodes.`, "session_too_long"));
  }

  // Cases fermées pour tous.
  const closed: SlotRef[] = (params.closedRanges ?? []).flatMap((r) => rangeToSlots(r, weekdays, periods));

  // Salles.
  const roomRows: Room[] = await ref.listRooms(tx, { institutionId: params.institutionId, ...(campusId ? { campusId } : {}), status: "AVAILABLE" });
  const rooms: GenRoom[] = roomRows.map((r) => ({ id: r.id, code: r.code, capacity: r.capacity, roomTypeCode: r.roomTypeCode, features: r.features, closed: [] }));

  // Classes et matières : contrôle auprès du référentiel académique.
  const classIds = [...new Set(params.requirements.map((r) => r.classroomId))];
  const classes: GenClass[] = [];
  const labels: PreparedLabels = { classrooms: {}, staff: {}, rooms: Object.fromEntries(roomRows.map((r) => [r.id, r.code])), nodes: {} };
  for (const id of classIds) {
    const c = await academic.getClassroom(ctx, id);
    if (!c) return err(NotFoundError.of("Classe", id, { code: SchedulingCodes.notFound }));
    if (c.institutionId !== params.institutionId) return err(validation("classroomId", `La classe ${c.name} n'appartient pas à cet établissement.`, "classroom_institution_mismatch"));
    if (c.academicYearId !== params.academicYearId) return err(validation("classroomId", `La classe ${c.name} n'appartient pas à l'année scolaire choisie.`, "classroom_year_mismatch"));
    if (campusId && c.campusId && c.campusId !== campusId) return err(validation("classroomId", `La classe ${c.name} est rattachée à un autre campus.`, "classroom_campus_mismatch"));
    classes.push({ id: c.id, label: c.name, headcount: c.headcount, closed: [] });
    labels.classrooms[c.id] = c.name;
  }
  const nodeIds = [...new Set(params.requirements.map((r) => r.curriculumNodeId))];
  const nodeInfo = new Map<string, { label: string; subjectId: string | null }>();
  for (const id of nodeIds) {
    const n = await academic.getCurriculumNode(ctx, id);
    if (!n) return err(NotFoundError.of("Matière (nœud de curriculum)", id, { code: SchedulingCodes.notFound }));
    nodeInfo.set(id, { label: n.label, subjectId: n.subjectId });
    labels.nodes[id] = n.label;
  }

  // Enseignants candidats.
  const people = deps.ports.people;
  const requirementsTeachers = params.requirements.map((r) => [...(r.teacherIds ?? [])]);
  if (params.deriveTeachers) {
    if (!people) {
      warnings.push({ code: "PEOPLE_UNAVAILABLE", message: "Le référentiel du personnel n'est pas disponible : les enseignants ne peuvent pas être proposés automatiquement." });
    } else if (requirementsTeachers.some((t) => t.length === 0)) {
      const staff = await people.listTeachingStaff(ctx);
      const plannable = staff.filter((s) => PLANNABLE_STAFF_STATUSES.includes(s.status));
      const competencies = await people.listCompetencies(ctx, plannable.map((s) => s.id));
      const byName = [...plannable].sort((a, b) => a.displayName.localeCompare(b.displayName, "fr") || a.id.localeCompare(b.id));
      params.requirements.forEach((r, i) => {
        if (requirementsTeachers[i]!.length > 0) return;
        const info = nodeInfo.get(r.curriculumNodeId)!;
        const able = byName.filter((s) => competencies.some((c) => c.staffId === s.id && (c.curriculumNodeId === r.curriculumNodeId || (info.subjectId !== null && c.subjectId === info.subjectId))));
        requirementsTeachers[i] = able.slice(0, AUTOGEN_DEFAULTS.deriveTeachersCap).map((s) => s.id);
      });
    }
  }
  const staffIds = [...new Set([...requirementsTeachers.flat(), ...(params.teachers ?? []).map((t) => t.staffId)])];
  const eligible = await checkStaffEligible(deps, ctx, staffIds);
  if (!eligible.ok) return eligible;
  for (const [id, info] of eligible.value) labels.staff[id] = info.displayName;
  for (const id of staffIds) labels.staff[id] ??= `Enseignant …${id.slice(-6)}`;

  // Disponibilités déclarées (règles hebdomadaires uniquement : une semaine type ne porte pas une date précise).
  const rulesBy = new Map<string, AvailabilityRule[]>();
  if (people && staffIds.length > 0) {
    for (const a of await people.listAvailabilities(ctx, staffIds, { from: params.validFrom, to: params.validTo })) {
      if (a.weekday === null) continue;
      const list = rulesBy.get(a.staffId) ?? [];
      list.push({ weekday: a.weekday, date: null, startMinute: parseTimeOfDay(a.startTime), endMinute: parseTimeOfDay(a.endTime), kind: a.kind });
      rulesBy.set(a.staffId, list);
    }
  }
  const teacherParams = new Map((params.teachers ?? []).map((t) => [t.staffId, t]));
  const teachers: GenTeacher[] = staffIds.map((id) => {
    const unavailable: SlotRef[] = [];
    const prefer: SlotRef[] = [];
    const rules = rulesBy.get(id) ?? [];
    if (people) {
      for (const weekday of weekdays) {
        const sample = firstWeekdayOnOrAfter(params.validFrom, weekday);
        periods.forEach((p, period) => {
          const status = availabilityStatus(rules, settings.staffAvailabilityMode, sample, p.startMinute, p.endMinute);
          if (status === "DECLARED_UNAVAILABLE" || status === "UNDECLARED_UNAVAILABLE") unavailable.push({ weekday, period });
          else if (status === "DECLARED_AVAILABLE") prefer.push({ weekday, period });
        });
      }
    }
    const extra = teacherParams.get(id);
    return {
      id,
      label: labels.staff[id] ?? null,
      unavailable: [...unavailable, ...(extra?.unavailable ?? []).flatMap((r) => rangeToSlots(r, weekdays, periods))],
      avoid: (extra?.avoid ?? []).flatMap((r) => rangeToSlots(r, weekdays, periods)),
      prefer: [...prefer, ...(extra?.prefer ?? []).flatMap((r) => rangeToSlots(r, weekdays, periods))],
      maxPeriodsPerDay: extra?.maxPeriodsPerDay ?? null,
      maxPeriodsPerWeek: extra?.maxPeriodsPerWeek ?? null,
    };
  });
  if (!people) warnings.push({ code: "PEOPLE_UNAVAILABLE", message: "Le référentiel du personnel n'est pas disponible : disponibilités et statut des enseignants non contrôlés." });

  // Besoins.
  const roomIds = new Set(roomRows.map((r) => r.id));
  const requirements: GenRequirement[] = [];
  for (const [i, r] of params.requirements.entries()) {
    if (r.roomId && !roomIds.has(r.roomId)) return err(validation(`requirements.${i}.roomId`, "La salle demandée n'existe pas ou n'est pas disponible.", "room_unavailable"));
    const preferredPeriods: number[] = [];
    for (const time of r.preferredStartTimes ?? []) {
      const minute = parseTimeOfDay(time);
      const idx = periods.findIndex((p) => p.startMinute === minute);
      if (idx >= 0) preferredPeriods.push(idx);
      else warnings.push({ code: "PREFERRED_TIME_IGNORED", requirementId: `req-${i + 1}`, message: `Heure préférée ${time} absente de la grille : ignorée.` });
    }
    const info = nodeInfo.get(r.curriculumNodeId)!;
    requirements.push({
      id: `req-${i + 1}`,
      classroomId: r.classroomId,
      curriculumNodeId: r.curriculumNodeId,
      offeringId: null,
      label: r.label?.trim() || `${info.label} — ${labels.classrooms[r.classroomId] ?? r.classroomId}`,
      sessionsPerWeek: r.sessionsPerWeek,
      sessionPeriods: r.sessionPeriods ?? 1,
      teacherIds: requirementsTeachers[i]!,
      needsRoom: r.needsRoom ?? true,
      roomTypeCode: r.roomType ?? null,
      requiredFeatures: r.features ?? [],
      roomId: r.roomId ?? null,
      maxPerDay: r.maxPerDay ?? null,
      preferredPeriods,
    });
  }

  // Occupation d'un autre emploi du temps à respecter.
  const fixed: GenFixedPlacement[] = [];
  if (params.fixedTimetableId) {
    const other = await tt.getTimetable(tx, params.fixedTimetableId);
    if (!other) return err(NotFoundError.of("Emploi du temps", params.fixedTimetableId, { code: SchedulingCodes.notFound }));
    for (const e of await tt.listEntries(tx, other.id)) {
      if (!weekdays.includes(e.weekday)) continue;
      const covered: number[] = [];
      periods.forEach((p, idx) => {
        if (p.startMinute < e.endMinute && e.startMinute < p.endMinute) covered.push(idx);
      });
      if (covered.length === 0) continue;
      const base = { weekday: e.weekday, startPeriod: covered[0]!, periods: covered.length };
      const classroomId = e.claimsClassroom ? e.classroomId : null;
      if (e.staff.length === 0) fixed.push({ ...base, classroomId, teacherId: null, roomId: e.roomId });
      e.staff.forEach((s, k) => fixed.push({ ...base, classroomId: k === 0 ? classroomId : null, teacherId: s.staffId, roomId: k === 0 ? e.roomId : null }));
    }
    // Classes et enseignants inconnus du problème : leur occupation est tout de même portée par les ressources existantes.
    const knownTeachers = new Set(teachers.map((t) => t.id));
    for (const f of fixed) {
      if (f.teacherId && !knownTeachers.has(f.teacherId)) {
        knownTeachers.add(f.teacherId);
        teachers.push({ id: f.teacherId, label: null, unavailable: [], avoid: [], prefer: [], maxPeriodsPerDay: null, maxPeriodsPerWeek: null });
      }
    }
    const knownClasses = new Set(classes.map((c) => c.id));
    for (const f of fixed) {
      if (f.classroomId && !knownClasses.has(f.classroomId)) {
        knownClasses.add(f.classroomId);
        classes.push({ id: f.classroomId, label: null, headcount: null, closed: [] });
      }
    }
    const knownRooms = new Set(rooms.map((r) => r.id));
    for (const f of fixed) {
      if (f.roomId && !knownRooms.has(f.roomId)) {
        // Salle hors service ou d'un autre campus : jamais candidate (fermée sur toute la semaine), son occupation est sans objet.
        knownRooms.add(f.roomId);
        const everything = weekdays.flatMap((weekday) => periods.map((_, period) => ({ weekday, period })));
        rooms.push({ id: f.roomId, code: f.roomId.slice(0, 8), capacity: null, roomTypeCode: "__FIXED__", features: [], closed: everything });
      }
    }
  }

  // Emploi du temps publié existant (information : jamais écrasé).
  const published = (await tt.listTimetables(tx, { institutionId: params.institutionId, academicYearId: params.academicYearId, status: "PUBLISHED" })).find(
    (t) => (t.periodId ?? null) === (params.periodId ?? null) && (t.campusId ?? null) === campusId,
  );

  const problem: GenProblem = {
    weekdays,
    periods,
    closed,
    classes,
    teachers,
    rooms,
    requirements,
    fixed,
    weights: toWeights(params.weights),
    seed,
    maxIterations: params.maxIterations ?? AUTOGEN_DEFAULTS.maxIterations,
    timeLimitMs: (params.timeLimitSeconds ?? AUTOGEN_DEFAULTS.timeLimitSeconds) * 1000,
  };
  try {
    validateProblem(problem);
  } catch (e) {
    if (e instanceof GenProblemError) return err(validation(e.path ?? "requirements", e.message, e.code));
    throw e;
  }
  const sessionCount = requirements.reduce((n, r) => n + r.sessionsPerWeek, 0);
  if (sessionCount > AUTOGEN_DEFAULTS.maxSessions) return err(validation("requirements", `Trop de séances à placer (${sessionCount}, maximum ${AUTOGEN_DEFAULTS.maxSessions}) : découpez la demande par niveau ou par cycle.`, "too_many_sessions"));
  return ok({
    problem,
    grid: { weekdays, periods: periodDto(periods), source: gridR.value.source },
    labels,
    publishedTimetable: published ? { id: published.id, name: published.name } : null,
    warnings,
    sessionCount,
  });
}
