/**
 * Aides à la planification (spec 017 US1 et US9) : aperçu des conflits avant enregistrement, suggestion
 * de créneaux libres, suggestion de remplaçants. Lecture seule. Ce n'est PAS un solveur (question O-05).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { ResourceBook, availabilityStatus, type AvailabilityRule, type ConflictView } from "../domain/conflicts";
import { SchedulingCodes, notFound } from "../domain/errors";
import { rankSubstitutes, suggestSlots as computeSlots, type Slot, type SlotRoom, type SubstituteSuggestion } from "../domain/suggest";
import { addDays, daysBetween, localDateOf, localMinuteOf, localToInstant, mondayOf, parseTimeOfDay } from "../domain/time";
import type { EntryEquipment, OccurrenceKind, StaffRole } from "../domain/types";
import { getOccurrence, listExclusiveClaims, listStaffByOccurrence } from "../infrastructure/occurrence-repo";
import { busyStaff, staffMinutesInRange } from "../infrastructure/read-queries";
import { listCalendarEvents, listRooms, listTimeSlots } from "../infrastructure/reference-repo";
import { inTx, type SchedulingDeps } from "./deps";
import { classroomKeyOf, evaluatePlacement, resolveAcademic, type Placement } from "./placement";
import { loadSettings, resolveWindow, validation, type TimeInput } from "./support";

// ---------------------------------------------------------------------------
// Aperçu des conflits
// ---------------------------------------------------------------------------

export interface PreviewInput extends TimeInput {
  kind?: OccurrenceKind | undefined;
  institutionId?: string | undefined;
  classroomId?: string | null | undefined;
  offeringId?: string | null | undefined;
  claimsClassroom?: boolean | undefined;
  curriculumNodeId?: string | null | undefined;
  roomId?: string | null | undefined;
  staffIds?: string[] | undefined;
  staff?: Array<{ staffId: string; role?: StaffRole | undefined }> | undefined;
  equipment?: EntryEquipment[] | undefined;
  /** Séance à ignorer (en cours de modification). */
  excludeOccurrenceId?: string | undefined;
}

export interface PreviewResult {
  conflicts: ConflictView[];
  /** Au moins un conflit BLOQUANT : l'écriture serait refusée. */
  blocking: boolean;
  timezone: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Aperçu AC1.1 : enseignant, classe/offre, salle, équipement ET avertissements non bloquants
 * (indisponibilité déclarée, salle trop petite, compétence manquante, intervenant non affecté).
 */
export async function previewConflicts(deps: SchedulingDeps, ctx: RequestContext, input: PreviewInput): Promise<Result<PreviewResult, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const excluded = input.excludeOccurrenceId ? await getOccurrence(tx, input.excludeOccurrenceId) : null;
      if (input.excludeOccurrenceId && !excluded) return err(notFound("Séance", input.excludeOccurrenceId));
      const hint =
        input.institutionId ??
        excluded?.institutionId ??
        ctx.institutionId ??
        (input.classroomId && deps.ports.academic ? (await deps.ports.academic.getClassroom(ctx, input.classroomId))?.institutionId : undefined);
      if (!hint) return err(validation("institutionId", "L'établissement est requis (institutionId).", "institution_required"));
      const settings = await loadSettings(tx, hint);
      const win = resolveWindow(input, settings.timezone);
      if (!win.ok) return win;
      const ac = await resolveAcademic(deps, ctx, {
        classroomId: input.classroomId ?? excluded?.classroomId,
        offeringId: input.offeringId ?? excluded?.offeringId,
        curriculumNodeId: input.curriculumNodeId ?? excluded?.curriculumNodeId,
        claimsClassroom: input.claimsClassroom ?? excluded?.claimsClassroom,
        institutionId: hint,
        date: win.value.occursOn,
        lenient: true,
        academicYearId: excluded?.academicYearId,
      });
      if (!ac.ok) return ac;
      const existingStaff = excluded ? ((await listStaffByOccurrence(tx, [excluded.id])).get(excluded.id) ?? []) : [];
      const staff = input.staff
        ? input.staff.map((s) => ({ staffId: s.staffId, role: s.role ?? "LEAD" }))
        : input.staffIds
          ? input.staffIds.map((id) => ({ staffId: id, role: "LEAD" as StaffRole }))
          : existingStaff.map((s) => ({ staffId: s.staffId, role: s.role }));
      const placement: Placement = {
        institutionId: hint,
        kind: input.kind ?? excluded?.kind ?? (ac.value.classroomId ? "LESSON" : "MEETING"),
        origin: "AD_HOC",
        startsAt: win.value.startsAt,
        endsAt: win.value.endsAt,
        staff,
        classroomId: ac.value.classroomId,
        offeringId: ac.value.offeringId,
        curriculumNodeId: ac.value.curriculumNodeId,
        claimsClassroom: ac.value.claimsClassroom,
        roomId: input.roomId === undefined ? (excluded?.roomId ?? null) : input.roomId,
        equipment: input.equipment ?? [],
        excludeOccurrenceId: excluded?.id ?? null,
        override: false,
        headcount: ac.value.offering?.headcount ?? ac.value.classroom?.headcount ?? null,
        classroom: ac.value.classroom,
        offering: ac.value.offering,
        node: ac.value.node,
      };
      const evaluation = await evaluatePlacement(deps, ctx, tx, placement);
      return ok({ conflicts: evaluation.conflicts, blocking: evaluation.blocking, timezone: settings.timezone, startsAt: win.value.startsAt.toISOString(), endsAt: win.value.endsAt.toISOString() });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Suggestion de créneaux
// ---------------------------------------------------------------------------

export interface SuggestSlotsInput {
  institutionId: string;
  durationMinutes: number;
  staffIds?: string[] | undefined;
  classroomId?: string | null | undefined;
  offeringId?: string | null | undefined;
  claimsClassroom?: boolean | undefined;
  roomId?: string | null | undefined;
  roomType?: string | undefined;
  features?: string[] | undefined;
  campusId?: string | null | undefined;
  window: { from: string; to: string };
  count: number;
  /** Surcharges de l'ouverture de l'établissement (sinon `settings.opening_*`). */
  weekdays?: number[] | undefined;
  dayStart?: string | undefined;
  dayEnd?: string | undefined;
  stepMinutes?: number | undefined;
  /** Se caler sur la grille horaire (`time_slots` actifs, hors pauses) quand elle existe (défaut : oui). */
  useTimeSlots?: boolean | undefined;
}

export const MAX_SUGGEST_WINDOW_DAYS = 92;

export async function suggestSlots(deps: SchedulingDeps, ctx: RequestContext, input: SuggestSlotsInput): Promise<Result<Slot[], AppError>> {
  if (input.window.to < input.window.from) return err(validation("window", "La fin de la fenêtre précède son début.", "invalid_range"));
  if (daysBetween(input.window.from, input.window.to) > MAX_SUGGEST_WINDOW_DAYS) return err(validation("window", `La fenêtre ne peut pas dépasser ${MAX_SUGGEST_WINDOW_DAYS} jours.`, "window_too_large"));
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 1440) return err(validation("durationMinutes", "La durée est un nombre entier de minutes (5 à 1440).", "invalid_duration"));
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 100) return err(validation("count", "Le nombre de créneaux demandés va de 1 à 100.", "invalid_count"));

  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await loadSettings(tx, input.institutionId);
      const weekdays = input.weekdays ?? settings.openingWeekdays;
      const dayStartText = input.dayStart ?? settings.openingStart;
      const dayEndText = input.dayEnd ?? settings.openingEnd;
      if (!weekdays || !dayStartText || !dayEndText) {
        return err(validation("window", "Renseignez l'ouverture de l'établissement (paramètres) ou précisez les jours et les heures à explorer.", "opening_required"));
      }
      const dayStartMinute = parseTimeOfDay(dayStartText);
      const dayEndMinute = parseTimeOfDay(dayEndText);

      const ac = await resolveAcademic(deps, ctx, {
        classroomId: input.classroomId,
        offeringId: input.offeringId,
        claimsClassroom: input.claimsClassroom,
        institutionId: input.institutionId,
        date: input.window.from,
        lenient: true,
      });
      if (!ac.ok) return ac;
      const classroomKey = classroomKeyOf({ kind: "LESSON", claimsClassroom: ac.value.claimsClassroom, classroomId: ac.value.classroomId, offeringId: ac.value.offeringId });

      // Salles candidates.
      const roomRequired = Boolean(input.roomId || input.roomType || (input.features && input.features.length > 0));
      let rooms: SlotRoom[] = [];
      if (roomRequired) {
        const all = await listRooms(tx, { institutionId: input.institutionId, ...(input.campusId ? { campusId: input.campusId } : {}), status: "AVAILABLE", ...(input.roomType ? { roomTypeCode: input.roomType } : {}) });
        rooms = all
          .filter((r) => (input.roomId ? r.id === input.roomId : true))
          .filter((r) => (input.features ?? []).every((f) => r.features.includes(f)))
          .map((r) => ({ id: r.id, code: r.code, capacity: r.capacity, roomTypeCode: r.roomTypeCode, features: r.features }));
      }

      // Cloches de la grille (non-pauses) si elle existe.
      let startMinutes: number[] | null = null;
      if (input.useTimeSlots ?? true) {
        const slots = (await listTimeSlots(tx, { institutionId: input.institutionId, campusId: input.campusId ?? null, activeOnly: true })).filter((s) => !s.isBreak);
        if (slots.length > 0) startMinutes = slots.map((s) => parseTimeOfDay(s.startsTime));
      }

      // Réservations exclusives existantes, sur toute la fenêtre.
      const staffIds = input.staffIds ?? [];
      const windowStart = localToInstant(input.window.from, 0, settings.timezone);
      const windowEnd = localToInstant(addDays(input.window.to, 1), 0, settings.timezone);
      const claims = await listExclusiveClaims(tx, { start: windowStart, end: windowEnd }, { staffIds, classroomKeys: classroomKey ? [classroomKey] : [], roomIds: rooms.map((r) => r.id) });
      const book = new ResourceBook();
      for (const c of claims) book.add(ResourceBook.key(c.resourceKind, c.resourceId), { start: c.start, end: c.end, ref: c.occurrenceId });

      const events = await listCalendarEvents(tx, { institutionId: input.institutionId, from: input.window.from, to: input.window.to, blocksTeachingOnly: true });
      const availability = new Map<string, AvailabilityRule[]>();
      if (deps.ports.people && staffIds.length > 0) {
        for (const a of await deps.ports.people.listAvailabilities(ctx, staffIds, input.window)) {
          const list = availability.get(a.staffId) ?? [];
          list.push({ weekday: a.weekday, date: a.date, startMinute: parseTimeOfDay(a.startTime), endMinute: parseTimeOfDay(a.endTime), kind: a.kind });
          availability.set(a.staffId, list);
        }
      }

      return ok(
        computeSlots({
          window: input.window,
          durationMinutes: input.durationMinutes,
          count: input.count,
          timeZone: settings.timezone,
          weekdays,
          dayStartMinute,
          dayEndMinute,
          startMinutes,
          stepMinutes: input.stepMinutes ?? 30,
          campusId: input.campusId ?? null,
          events,
          book,
          staffIds,
          classroomKey,
          rooms,
          roomRequired,
          headcount: ac.value.offering?.headcount ?? ac.value.classroom?.headcount ?? null,
          availability,
          availabilityMode: settings.staffAvailabilityMode,
          now: deps.clock.now(),
        }),
      );
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Suggestion de remplaçants
// ---------------------------------------------------------------------------

export interface SubstituteView extends SubstituteSuggestion {
  displayName: string | null;
}

/**
 * Remplaçants possibles d'une séance (AC4.3) : enseignants libres sur la plage, non indisponibles,
 * compétents pour la matière, affectés à la classe si connu, triés par moindre charge hebdomadaire.
 * Sans port `people`, aucune suggestion n'est possible (liste vide).
 */
export async function suggestSubstitutes(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceId: string; count?: number | undefined }): Promise<Result<SubstituteView[], AppError>> {
  const people = deps.ports.people;
  if (!people) return ok([]);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const occ = await getOccurrence(tx, input.occurrenceId);
      if (!occ) return err(notFound("Séance", input.occurrenceId));
      const current = (await listStaffByOccurrence(tx, [occ.id])).get(occ.id) ?? [];
      const settings = await loadSettings(tx, occ.institutionId);
      const pool = (await people.listTeachingStaff(ctx)).filter((s) => !current.some((c) => c.staffId === s.id)).slice(0, 200);
      const ids = pool.map((s) => s.id);
      const date = occ.occursOn;
      const startMinute = localMinuteOf(occ.startsAt, settings.timezone);
      const endMinute = Math.min(1440, startMinute + Math.round((occ.endsAt.getTime() - occ.startsAt.getTime()) / 60_000));
      const [busy, availability, competencies, loads] = await Promise.all([
        busyStaff(tx, ids, { start: occ.startsAt, end: occ.endsAt }, occ.id),
        people.listAvailabilities(ctx, ids, { from: date, to: date }),
        people.listCompetencies(ctx, ids),
        staffMinutesInRange(tx, ids, { from: mondayOf(date), to: addDays(mondayOf(date), 6) }),
      ]);
      const node = deps.ports.academic && occ.curriculumNodeId ? await deps.ports.academic.getCurriculumNode(ctx, occ.curriculumNodeId) : null;
      const rulesBy = new Map<string, AvailabilityRule[]>();
      for (const a of availability) {
        const list = rulesBy.get(a.staffId) ?? [];
        list.push({ weekday: a.weekday, date: a.date, startMinute: parseTimeOfDay(a.startTime), endMinute: parseTimeOfDay(a.endTime), kind: a.kind });
        rulesBy.set(a.staffId, list);
      }
      const candidates = [];
      for (const s of pool) {
        const mine = competencies.filter((c) => c.staffId === s.id);
        const competent = occ.curriculumNodeId ? (mine.length === 0 ? null : mine.some((c) => c.curriculumNodeId === occ.curriculumNodeId || (node?.subjectId != null && c.subjectId === node.subjectId))) : null;
        candidates.push({
          staffId: s.id,
          status: s.status,
          busy: busy.has(s.id),
          availability: availabilityStatus(rulesBy.get(s.id) ?? [], settings.staffAvailabilityMode, date, startMinute, endMinute),
          competent,
          assignedToClassroom: occ.classroomId ? await people.isStaffAssignedToClassroom(ctx, s.id, occ.classroomId, date) : null,
          weeklyLoadMinutes: loads.get(s.id) ?? 0,
        });
      }
      const names = new Map(pool.map((s) => [s.id, s.displayName]));
      return ok(
        rankSubstitutes(candidates)
          .slice(0, Math.min(Math.max(input.count ?? 10, 1), 50))
          .map((c) => ({ ...c, displayName: names.get(c.staffId) ?? null })),
      );
    },
    { readOnly: true },
  );
}

void SchedulingCodes;
void localDateOf;
