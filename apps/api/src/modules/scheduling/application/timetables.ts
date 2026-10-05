/**
 * Emplois du temps et patrons récurrents (spec 017 US2) : brouillon → publié → archivé, clonage,
 * patrons hebdomadaires (jour ISO, `[début, fin)` à la minute, alternance A/B, bornes propres),
 * contrôle des conflits entre patrons, propagation d'une modification, fin et retrait d'un patron.
 *
 * La génération des occurrences datées est dans `generation.ts`.
 */
import { NotFoundError, ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { classifyEntryConflictsFor } from "./entry-conflicts";
import { SchedulingCodes, conflictDetected, notFound, SchedulingCodes as Codes } from "../domain/errors";
import { SchedulingEvents } from "../domain/events";
import { describeEntryConflict, detectEntryConflicts, hasBlocking, type ConflictView } from "../domain/conflicts";
import { addDays, compareDates, firstWeekdayOnOrAfter, isIsoDate, isMonday, localDateOf, localToInstant, maxDate, minDate, parseTimeOfDay } from "../domain/time";
import { ENTRY_KINDS, WEEK_PATTERNS, type DeliveryMode, type EntryEquipment, type EntryKind, type EntryStaff, type Timetable, type TimetableEntry, type WeekPattern } from "../domain/types";
import * as occRepo from "../infrastructure/occurrence-repo";
import * as ref from "../infrastructure/reference-repo";
import * as tt from "../infrastructure/timetable-repo";
import { EventBuffer, inTx, lockResources, setChangeReason, type SchedulingDeps } from "./deps";
import { evaluatePlacement, resolveAcademic, type Placement } from "./placement";
import { checkStaffEligible, loadSettings, occurrenceEventPayload, OCCURRENCE_AGGREGATE, trimReason, validation } from "./support";
import { resourcesOfPlacement } from "./occurrences";

const TIMETABLE_AGGREGATE = "timetable";

// ---------------------------------------------------------------------------
// Emplois du temps
// ---------------------------------------------------------------------------

export interface CreateTimetableInput {
  institutionId: string;
  campusId?: string | null | undefined;
  academicYearId: string;
  periodId?: string | null | undefined;
  name: string;
  validFrom: string;
  validTo: string;
  weekAAnchor?: string | null | undefined;
}

export async function checkTimetableDates(deps: SchedulingDeps, ctx: RequestContext, i: { validFrom: string; validTo: string; weekAAnchor?: string | null | undefined; academicYearId: string; periodId?: string | null | undefined }): Promise<Result<void, AppError>> {
  if (!isIsoDate(i.validFrom) || !isIsoDate(i.validTo)) return err(validation("validFrom", "Dates invalides (AAAA-MM-JJ).", "invalid_date"));
  if (compareDates(i.validTo, i.validFrom) < 0) return err(validation("validTo", "La fin de validité précède son début.", "invalid_range"));
  if (i.weekAAnchor && (!isIsoDate(i.weekAAnchor) || !isMonday(i.weekAAnchor))) return err(validation("weekAAnchor", "L'ancre de l'alternance A/B est un lundi.", "anchor_not_monday"));
  if (i.periodId && deps.ports.academic) {
    const period = await deps.ports.academic.getPeriod(ctx, i.periodId);
    if (!period) return err(NotFoundError.of("Période", i.periodId, { code: SchedulingCodes.notFound }));
    if (period.academicYearId !== i.academicYearId) return err(validation("periodId", "La période n'appartient pas à l'année scolaire de l'emploi du temps.", "period_year_mismatch"));
    if (i.validFrom < period.startsOn || i.validTo > period.endsOn) {
      return err(validation("validFrom", `La validité de l'emploi du temps doit rester dans la période (${period.startsOn} → ${period.endsOn}).`, "outside_period"));
    }
  }
  return ok(undefined);
}

export async function createTimetable(deps: SchedulingDeps, ctx: RequestContext, input: CreateTimetableInput): Promise<Result<Timetable, AppError>> {
  const name = input.name.trim();
  if (name.length === 0) return err(validation("name", "Le nom est requis.", "required"));
  const dates = await checkTimetableDates(deps, ctx, input);
  if (!dates.ok) return dates;
  return inTx(deps, ctx, async (tx) => {
    const row = await tt.insertTimetable(
      tx,
      ctx.tenantId,
      { id: deps.newId(), institutionId: input.institutionId, campusId: input.campusId ?? null, academicYearId: input.academicYearId, periodId: input.periodId ?? null, name, validFrom: input.validFrom, validTo: input.validTo, weekAAnchor: input.weekAAnchor ?? null, clonedFromId: null },
      ctx.userId,
      deps.clock.now(),
    );
    return ok(row);
  });
}

export async function updateTimetable(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { timetableId: string; name?: string | undefined; validFrom?: string | undefined; validTo?: string | undefined; weekAAnchor?: string | null | undefined },
): Promise<Result<Timetable, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const t = await tt.getTimetable(tx, input.timetableId, true);
    if (!t) return err(notFound("Emploi du temps", input.timetableId));
    if (t.status !== "DRAFT") return err(new ValidationError("Seul un brouillon peut être modifié.", [], { code: SchedulingCodes.timetableNotEditable }));
    const dates = await checkTimetableDates(deps, ctx, {
      validFrom: input.validFrom ?? t.validFrom,
      validTo: input.validTo ?? t.validTo,
      weekAAnchor: input.weekAAnchor === undefined ? t.weekAAnchor : input.weekAAnchor,
      academicYearId: t.academicYearId,
      periodId: t.periodId,
    });
    if (!dates.ok) return dates;
    const patch: Parameters<typeof tt.updateTimetable>[2] = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.validFrom !== undefined) patch.validFrom = input.validFrom;
    if (input.validTo !== undefined) patch.validTo = input.validTo;
    if (input.weekAAnchor !== undefined) patch.weekAAnchor = input.weekAAnchor;
    return ok((await tt.updateTimetable(tx, t.id, patch, deps.clock.now())) as Timetable);
  });
}

export function listTimetables(deps: SchedulingDeps, ctx: RequestContext, filter: Parameters<typeof tt.listTimetables>[1]): Promise<Result<Timetable[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await tt.listTimetables(tx, filter)), { readOnly: true });
}

export function getTimetable(deps: SchedulingDeps, ctx: RequestContext, input: { timetableId: string }): Promise<Result<{ timetable: Timetable; entries: TimetableEntry[] }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const t = await tt.getTimetable(tx, input.timetableId);
      if (!t) return err(notFound("Emploi du temps", input.timetableId));
      return ok({ timetable: t, entries: await tt.listEntries(tx, t.id) });
    },
    { readOnly: true },
  );
}

export function listGenerationRuns(deps: SchedulingDeps, ctx: RequestContext, input: { timetableId: string }): Promise<Result<tt.GenerationRunRow[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await tt.listGenerationRuns(tx, input.timetableId)), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Patrons
// ---------------------------------------------------------------------------

export interface EntryInput {
  /** Présent : modification du patron ; absent : création. */
  entryId?: string | undefined;
  timetableId: string;
  kind?: EntryKind | undefined;
  classroomId?: string | null | undefined;
  curriculumNodeId?: string | null | undefined;
  offeringId?: string | null | undefined;
  claimsClassroom?: boolean | undefined;
  weekday: number;
  startTime: string;
  endTime: string;
  timeSlotId?: string | null | undefined;
  roomId?: string | null | undefined;
  weekPattern?: WeekPattern | undefined;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  deliveryMode?: DeliveryMode | undefined;
  title?: string | null | undefined;
  notes?: string | null | undefined;
  staff?: EntryStaff[] | undefined;
  equipment?: EntryEquipment[] | undefined;
  /** Sur modification : `FUTURE_PLANNED` met à jour les occurrences futures PLANNED non constatées. */
  propagate?: "NONE" | "FUTURE_PLANNED" | undefined;
  /** Dépassement motivé des conflits entre patrons (permission sensible vérifiée par la route). */
  overrideReason?: string | undefined;
}

export interface PropagationReport {
  updated: number;
  skipped: Array<{ occurrenceId: string; occursOn: string; reason: "MANUALLY_MODIFIED" | "CONFLICT" | "ERROR"; message: string }>;
}

export interface EntryResult {
  entry: TimetableEntry;
  conflicts: ConflictView[];
  warnings: ConflictView[];
  propagation: PropagationReport | null;
}

const BUSY_CODES = new Set(["STAFF_BUSY", "CLASSROOM_BUSY", "OFFERING_BUSY", "ROOM_BUSY", "EQUIPMENT_SHORTAGE"]);

interface EntryContext {
  timetable: Timetable;
  next: Omit<TimetableEntry, "endedAt">;
}

async function buildEntry(deps: SchedulingDeps, ctx: RequestContext, tx: Tx, input: EntryInput, t: Timetable, entryId: string): Promise<Result<EntryContext, AppError>> {
  const kind = input.kind ?? "LESSON";
  if (!ENTRY_KINDS.includes(kind)) return err(validation("kind", `Nature de patron inconnue : ${kind}.`, "invalid_kind"));
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) return err(validation("weekday", "Le jour ISO va de 1 (lundi) à 7 (dimanche).", "invalid_weekday"));
  let startMinute: number;
  let endMinute: number;
  try {
    startMinute = parseTimeOfDay(input.startTime);
    endMinute = parseTimeOfDay(input.endTime);
  } catch (e) {
    return err(validation("startTime", e instanceof Error ? e.message : "Heure invalide.", "invalid_time"));
  }
  if (endMinute <= startMinute) return err(validation("endTime", "L'heure de fin doit être postérieure à l'heure de début (pas de patron à cheval sur minuit).", "invalid_range"));
  const weekPattern = input.weekPattern ?? "EVERY";
  if (!WEEK_PATTERNS.includes(weekPattern)) return err(validation("weekPattern", "Alternance inconnue.", "invalid_week_pattern"));
  if (weekPattern !== "EVERY" && t.weekAAnchor === null) return err(validation("weekPattern", "Une alternance A/B exige l'ancre (lundi d'une semaine A) sur l'emploi du temps.", "anchor_required"));
  const validFrom = input.validFrom ?? null;
  const validTo = input.validTo ?? null;
  if ((validFrom && !isIsoDate(validFrom)) || (validTo && !isIsoDate(validTo))) return err(validation("validFrom", "Dates invalides (AAAA-MM-JJ).", "invalid_date"));
  if (validFrom && validTo && validTo < validFrom) return err(validation("validTo", "La fin de validité du patron précède son début.", "invalid_range"));
  const effFrom = validFrom ? maxDate(validFrom, t.validFrom) : t.validFrom;
  const effTo = validTo ? minDate(validTo, t.validTo) : t.validTo;
  if (effFrom > effTo) return err(validation("validFrom", "La validité du patron est hors de celle de l'emploi du temps.", "outside_timetable"));
  if (firstWeekdayOnOrAfter(effFrom, input.weekday) > effTo) return err(validation("weekday", "Ce jour n'a aucune date dans la validité du patron.", "never_occurs"));

  const claimsClassroom = input.claimsClassroom ?? true;
  if (kind === "LESSON" && (!input.classroomId || !input.curriculumNodeId)) return err(validation("classroomId", "Un cours exige une classe et un nœud de curriculum.", "lesson_requires_class_and_node"));
  if (!claimsClassroom && !input.offeringId) return err(validation("offeringId", "Un patron qui ne réunit pas la classe doit préciser l'offre à la carte.", "offering_required"));

  const ac = await resolveAcademic(deps, ctx, {
    classroomId: input.classroomId,
    offeringId: input.offeringId,
    curriculumNodeId: input.curriculumNodeId,
    claimsClassroom,
    institutionId: t.institutionId,
    academicYearId: t.academicYearId,
    campusId: t.campusId,
    date: effFrom,
    lenient: true,
  });
  if (!ac.ok) return ac;
  if (input.timeSlotId && !(await ref.getTimeSlot(tx, input.timeSlotId))) return err(NotFoundError.of("Créneau horaire", input.timeSlotId, { code: SchedulingCodes.notFound }));
  if (input.roomId) {
    const room = await ref.getRoom(tx, input.roomId);
    if (!room) return err(NotFoundError.of("Salle", input.roomId, { code: SchedulingCodes.notFound }));
    if (room.status !== "AVAILABLE") return err(validation("roomId", `La salle ${room.name} n'est pas disponible (${room.status}).`, "room_unavailable"));
  }
  const staff = input.staff ?? [];
  const seen = new Set<string>();
  for (const s of staff) {
    if (seen.has(s.staffId)) return err(validation("staff", "Un intervenant est listé deux fois.", "duplicate_staff"));
    seen.add(s.staffId);
  }
  const eligible = await checkStaffEligible(deps, ctx, staff.map((s) => s.staffId));
  if (!eligible.ok) return eligible;
  for (const e of input.equipment ?? []) {
    if (!Number.isInteger(e.quantity) || e.quantity < 1) return err(validation("equipment", "La quantité d'un équipement est un entier ≥ 1.", "invalid_quantity"));
  }

  return ok({
    timetable: t,
    next: {
      id: entryId,
      timetableId: t.id,
      kind,
      classroomId: ac.value.classroomId,
      curriculumNodeId: ac.value.curriculumNodeId,
      offeringId: ac.value.offeringId,
      claimsClassroom: ac.value.claimsClassroom,
      weekday: input.weekday,
      startMinute,
      endMinute,
      timeSlotId: input.timeSlotId ?? null,
      roomId: input.roomId ?? null,
      weekPattern,
      validFrom,
      validTo,
      deliveryMode: input.deliveryMode ?? "IN_PERSON",
      title: input.title ?? null,
      notes: input.notes ?? null,
      staff,
      equipment: input.equipment ?? [],
    },
  });
}

/** Exécution dans la transaction courante (utilisée aussi par le lot atomique). */
async function upsertEntryInTx(deps: SchedulingDeps, ctx: RequestContext, tx: Tx, buf: EventBuffer, input: EntryInput, t: Timetable): Promise<Result<EntryResult, AppError>> {
  const previous = input.entryId ? await tt.getEntry(tx, input.entryId, true) : null;
  if (input.entryId && (!previous || previous.timetableId !== t.id)) return err(notFound("Patron", input.entryId));
  const entryId = previous?.id ?? deps.newId();
  const built = await buildEntry(deps, ctx, tx, input, t, entryId);
  if (!built.ok) return built;
  const next = built.value.next;

  // Conflits avec les AUTRES patrons de l'emploi du temps (les patrons terminés ne comptent plus).
  const others = (await tt.listEntries(tx, t.id)).filter((e) => e.id !== entryId);
  const candidate: TimetableEntry = { ...next, endedAt: null };
  const settingsPolicies = await ref.getPolicies(tx, t.institutionId);
  const internal = detectEntryConflicts([...others, candidate], t).filter((c) => c.entryA === entryId || c.entryB === entryId);
  const labelsLookup = await classifyEntryConflictsFor(deps, ctx, tx, internal, settingsPolicies);
  const overrideReason = trimReason(input.overrideReason);
  if (hasBlocking(labelsLookup) && overrideReason.length < 5) return err(conflictDetected(labelsLookup));

  // Avertissements (disponibilité, compétence, affectation, capacité) sur la première date du patron.
  const warnings = await entryWarnings(deps, ctx, tx, t, candidate);

  const now = deps.clock.now();
  let propagation: PropagationReport | null = null;
  if (previous) {
    await tt.updateEntry(tx, ctx.tenantId, { ...next, equipment: next.equipment, staff: next.staff }, now);
    if ((input.propagate ?? "NONE") === "FUTURE_PLANNED") propagation = await propagateEntry(deps, ctx, tx, buf, previous, candidate, t);
  } else {
    await tt.insertEntry(tx, ctx.tenantId, next, now);
  }
  const entry = (await tt.getEntry(tx, entryId)) as TimetableEntry;
  return ok({ entry, conflicts: labelsLookup, warnings, propagation });
}

async function entryWarnings(deps: SchedulingDeps, ctx: RequestContext, tx: Tx, t: Timetable, e: TimetableEntry): Promise<ConflictView[]> {
  if (!deps.ports.people && !e.roomId) return [];
  const settings = await loadSettings(tx, t.institutionId);
  const from = e.validFrom ? maxDate(e.validFrom, t.validFrom) : t.validFrom;
  const date = firstWeekdayOnOrAfter(from, e.weekday);
  const placement: Placement = {
    institutionId: t.institutionId,
    kind: e.kind === "LESSON" ? "LESSON" : e.kind,
    origin: "GENERATED",
    startsAt: localToInstant(date, e.startMinute, settings.timezone),
    endsAt: localToInstant(date, e.endMinute, settings.timezone),
    staff: e.staff.map((s) => ({ staffId: s.staffId, role: s.role })),
    classroomId: e.classroomId,
    offeringId: e.offeringId,
    curriculumNodeId: e.curriculumNodeId,
    claimsClassroom: e.claimsClassroom,
    roomId: e.roomId,
    equipment: [],
    excludeOccurrenceId: null,
    override: true, // les chevauchements avec des séances déjà datées ne sont pas jugés ici
  };
  if (deps.ports.academic) {
    if (e.classroomId) placement.classroom = await deps.ports.academic.getClassroom(ctx, e.classroomId);
    if (e.curriculumNodeId) placement.node = await deps.ports.academic.getCurriculumNode(ctx, e.curriculumNodeId);
  }
  const evaluation = await evaluatePlacement(deps, ctx, tx, placement);
  return evaluation.conflicts.filter((c) => c.severity === "WARNING" && !BUSY_CODES.has(c.code) && c.code !== "CALENDAR_BLOCKED");
}

export async function upsertTimetableEntry(deps: SchedulingDeps, ctx: RequestContext, input: EntryInput): Promise<Result<EntryResult, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const t = await tt.getTimetable(tx, input.timetableId, true);
    if (!t) return err(notFound("Emploi du temps", input.timetableId));
    if (t.status === "ARCHIVED") return err(new ValidationError("Un emploi du temps archivé n'est plus modifiable.", [], { code: SchedulingCodes.timetableNotEditable }));
    const r = await upsertEntryInTx(deps, ctx, tx, buf, input, t);
    if (r.ok) await buf.flush(tx);
    return r;
  });
}

/** Lot ATOMIQUE de patrons (tout ou rien) : l'UI legacy créait N créneaux par appels successifs non atomiques (Q16). */
export async function upsertTimetableEntries(deps: SchedulingDeps, ctx: RequestContext, input: { timetableId: string; entries: Omit<EntryInput, "timetableId">[]; overrideReason?: string | undefined }): Promise<Result<EntryResult[], AppError>> {
  if (input.entries.length === 0) return err(validation("entries", "Aucun patron à enregistrer.", "empty_batch"));
  if (input.entries.length > 500) return err(validation("entries", "Un lot compte au plus 500 patrons.", "batch_too_large"));
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const t = await tt.getTimetable(tx, input.timetableId, true);
    if (!t) return err(notFound("Emploi du temps", input.timetableId));
    if (t.status === "ARCHIVED") return err(new ValidationError("Un emploi du temps archivé n'est plus modifiable.", [], { code: SchedulingCodes.timetableNotEditable }));
    const results: EntryResult[] = [];
    for (const [i, e] of input.entries.entries()) {
      const r = await upsertEntryInTx(deps, ctx, tx, buf, { ...e, timetableId: t.id, ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}) }, t);
      if (!r.ok) {
        return err(
          Object.assign(r.error, {
            details: { ...(r.error.details ?? {}), entryIndex: i },
          }) as AppError,
        );
      }
      results.push(r.value);
    }
    await buf.flush(tx);
    return ok(results);
  });
}

/** Met à jour les occurrences FUTURES `PLANNED` non constatées d'un patron modifié (AC2.4). */
async function propagateEntry(deps: SchedulingDeps, ctx: RequestContext, tx: Tx, buf: EventBuffer, previous: TimetableEntry, next: TimetableEntry, t: Timetable): Promise<PropagationReport> {
  const settings = await loadSettings(tx, t.institutionId);
  const tz = settings.timezone;
  const now = deps.clock.now();
  const rows = await tx.many<{ id: string }>(
    `SELECT id FROM scheduling.session_occurrences
      WHERE tenant_id = kernel.current_tenant_id() AND timetable_entry_id = $1 AND status = 'PLANNED' AND validated_at IS NULL AND starts_at > $2::timestamptz
      ORDER BY starts_at, id FOR UPDATE`,
    [previous.id, now],
  );
  const report: PropagationReport = { updated: 0, skipped: [] };
  const removedStaff = previous.staff.filter((s) => !next.staff.some((n) => n.staffId === s.staffId)).map((s) => s.staffId);
  const addedStaff = next.staff.filter((n) => !previous.staff.some((s) => s.staffId === n.staffId));
  for (const { id } of rows) {
    const occ = await occRepo.getOccurrence(tx, id);
    if (!occ || !occ.generatedFor) continue;
    // Référence = le patron TEL QU'IL ÉTAIT À LA GÉNÉRATION de cette occurrence (instantané), pas le patron
    // avant cette modification : une édition précédente sans propagation laisse des occurrences « en retard »
    // qui, elles, doivent être mises à jour ; seule une modification à la main les distingue.
    const base = occ.generatedFrom ?? { startMinute: previous.startMinute, endMinute: previous.endMinute, roomId: previous.roomId };
    const originalStart = localToInstant(occ.generatedFor, base.startMinute, tz).getTime();
    const originalEnd = localToInstant(occ.generatedFor, base.endMinute, tz).getTime();
    if (occ.startsAt.getTime() !== originalStart || occ.endsAt.getTime() !== originalEnd || occ.roomId !== base.roomId) {
      report.skipped.push({ occurrenceId: id, occursOn: occ.occursOn, reason: "MANUALLY_MODIFIED", message: "Séance déplacée ou modifiée à la main : conservée telle quelle." });
      continue;
    }
    const staffRows = (await occRepo.listStaffByOccurrence(tx, [id])).get(id) ?? [];
    const newStart = localToInstant(occ.generatedFor, next.startMinute, tz);
    const newEnd = localToInstant(occ.generatedFor, next.endMinute, tz);
    const nextStaff = [
      ...staffRows.filter((s) => !removedStaff.includes(s.staffId)).map((s) => ({ staffId: s.staffId, role: s.role })),
      ...addedStaff.filter((a) => !staffRows.some((s) => s.staffId === a.staffId)).map((a) => ({ staffId: a.staffId, role: a.role })),
    ];
    try {
      await tx.transaction(async (sp) => {
        const placement: Placement = {
          institutionId: occ.institutionId,
          kind: occ.kind,
          origin: occ.origin,
          startsAt: newStart,
          endsAt: newEnd,
          staff: nextStaff,
          classroomId: next.classroomId,
          offeringId: next.offeringId,
          curriculumNodeId: next.curriculumNodeId,
          claimsClassroom: next.claimsClassroom,
          roomId: next.roomId,
          equipment: [],
          excludeOccurrenceId: id,
          override: occ.conflictOverride,
        };
        await lockResources(sp, ctx, resourcesOfPlacement(placement));
        const evaluation = await evaluatePlacement(deps, ctx, sp, placement);
        if (evaluation.blocking) throw new PropagationConflict(evaluation.conflicts.find((c) => c.severity === "BLOCKING")?.message ?? "Conflit.");
        await setChangeReason(sp, "Propagation d'une modification du patron");
        await occRepo.updateTimes(sp, id, newStart, newEnd, localDateOf(newStart, tz), now);
        if (next.roomId !== occ.roomId) await occRepo.updateRoom(sp, id, next.roomId, now);
        for (const sid of removedStaff) if (staffRows.some((s) => s.staffId === sid)) await occRepo.deleteStaff(sp, id, sid);
        const add = addedStaff.filter((a) => !staffRows.some((s) => s.staffId === a.staffId));
        if (add.length > 0) {
          await occRepo.insertStaff(sp, ctx.tenantId, add.map((a) => ({ id: deps.newId(), occurrenceId: id, staffId: a.staffId, role: a.role, replacesStaffId: null, isPaidRole: a.role !== "SUPERVISOR" || settings.supervisorsPaid })));
        }
        await occRepo.updateDescriptive(sp, id, { title: next.title, deliveryMode: next.deliveryMode }, now);
        await occRepo.setGeneratedFrom(sp, id, { startMinute: next.startMinute, endMinute: next.endMinute, roomId: next.roomId }, now);
        await setChangeReason(sp, null);
      });
      report.updated += 1;
      buf.add(SchedulingEvents.occurrenceRescheduled, occurrenceEventPayload({ ...occ, startsAt: newStart, endsAt: newEnd }, nextStaff.map((s) => s.staffId), { reason: "pattern_changed" }), { type: OCCURRENCE_AGGREGATE, id });
    } catch (e) {
      if (e instanceof PropagationConflict) report.skipped.push({ occurrenceId: id, occursOn: occ.occursOn, reason: "CONFLICT", message: e.message });
      else throw e;
    }
  }
  return report;
}

class PropagationConflict extends Error {}

/**
 * Fin d'un patron (AC2.4) : il cesse de produire des occurrences et les occurrences futures PLANNED non
 * constatées qu'il a générées sont ANNULÉES (motif `pattern_removed`). Les occurrences HELD, validées ou
 * verrouillées ne changent jamais.
 */
export async function endTimetableEntry(deps: SchedulingDeps, ctx: RequestContext, input: { entryId: string }): Promise<Result<{ entryId: string; cancelledOccurrences: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const entry = await tt.getEntry(tx, input.entryId, true);
    if (!entry) return err(notFound("Patron", input.entryId));
    const t = (await tt.getTimetable(tx, entry.timetableId)) as Timetable;
    const settings = await loadSettings(tx, t.institutionId);
    const now = deps.clock.now();
    const today = localDateOf(now, settings.timezone);
    const yesterday = addDays(today, -1);
    const start = entry.validFrom ? maxDate(entry.validFrom, t.validFrom) : t.validFrom;
    await tt.endEntry(tx, entry.id, yesterday >= start ? minDate(yesterday, entry.validTo ?? yesterday) : (entry.validTo ?? t.validTo), now);
    const cancelled = await cancelFutureGenerated(deps, ctx, tx, buf, entry.id, now, "pattern_removed");
    buf.audit({ action: "scheduling.timetable_entry.ended", resourceType: "timetable_entry", resourceId: entry.id, metadata: { cancelledOccurrences: cancelled } });
    await buf.flush(tx);
    return ok({ entryId: entry.id, cancelledOccurrences: cancelled });
  });
}

async function cancelFutureGenerated(deps: SchedulingDeps, ctx: RequestContext, tx: Tx, buf: EventBuffer, entryId: string, now: Date, reason: string): Promise<number> {
  const rows = await tx.many<{ id: string }>(
    `SELECT id FROM scheduling.session_occurrences
      WHERE tenant_id = kernel.current_tenant_id() AND timetable_entry_id = $1 AND status = 'PLANNED' AND validated_at IS NULL AND starts_at > $2::timestamptz
      ORDER BY starts_at, id FOR UPDATE`,
    [entryId, now],
  );
  for (const { id } of rows) {
    await setChangeReason(tx, reason);
    await occRepo.markCancelled(tx, id, reason, now);
    await setChangeReason(tx, null);
    const occ = (await occRepo.getOccurrence(tx, id)) as NonNullable<Awaited<ReturnType<typeof occRepo.getOccurrence>>>;
    const staff = (await occRepo.listStaffByOccurrence(tx, [id])).get(id) ?? [];
    buf.add(SchedulingEvents.occurrenceCancelled, occurrenceEventPayload(occ, staff.map((s) => s.staffId), { reason }), { type: OCCURRENCE_AGGREGATE, id });
  }
  return rows.length;
}

/** Suppression physique SEULEMENT sans occurrence ; sinon le patron est terminé (AC2.4). */
export async function removeTimetableEntry(deps: SchedulingDeps, ctx: RequestContext, input: { entryId: string }): Promise<Result<{ deleted: boolean; ended: boolean; cancelledOccurrences: number }, AppError>> {
  const used = await inTx(deps, ctx, async (tx) => ok(await tt.entryHasOccurrences(tx, input.entryId)), { readOnly: true });
  if (!used.ok) return used;
  if (used.value) {
    const ended = await endTimetableEntry(deps, ctx, input);
    return ended.ok ? ok({ deleted: false, ended: true, cancelledOccurrences: ended.value.cancelledOccurrences }) : ended;
  }
  return inTx(deps, ctx, async (tx) => {
    const entry = await tt.getEntry(tx, input.entryId, true);
    if (!entry) return err(notFound("Patron", input.entryId));
    if (await tt.entryHasOccurrences(tx, entry.id)) return err(new ValidationError("Le patron a désormais des occurrences : terminez-le plutôt.", [], { code: Codes.concurrentUpdate }));
    await tt.deleteEntry(tx, entry.id);
    return ok({ deleted: true, ended: false, cancelledOccurrences: 0 });
  });
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

export async function getTimetableConflicts(deps: SchedulingDeps, ctx: RequestContext, input: { timetableId: string }): Promise<Result<ConflictView[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const t = await tt.getTimetable(tx, input.timetableId);
      if (!t) return err(notFound("Emploi du temps", input.timetableId));
      const entries = await tt.listEntries(tx, t.id);
      const policies = await ref.getPolicies(tx, t.institutionId);
      return ok(await classifyEntryConflictsFor(deps, ctx, tx, detectEntryConflicts(entries, t), policies));
    },
    { readOnly: true },
  );
}

export async function publishTimetable(deps: SchedulingDeps, ctx: RequestContext, input: { timetableId: string }): Promise<Result<Timetable, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const t = await tt.getTimetable(tx, input.timetableId, true);
    if (!t) return err(notFound("Emploi du temps", input.timetableId));
    if (t.status === "PUBLISHED") return ok(t);
    if (t.status === "ARCHIVED") return err(new ValidationError("Un emploi du temps archivé ne se publie plus.", [], { code: SchedulingCodes.timetableNotEditable }));
    const entries = await tt.listEntries(tx, t.id);
    if (entries.length === 0) return err(validation("timetableId", "Un emploi du temps vide ne peut pas être publié.", "empty_timetable"));
    const policies = await ref.getPolicies(tx, t.institutionId);
    const conflicts = await classifyEntryConflictsFor(deps, ctx, tx, detectEntryConflicts(entries, t), policies);
    if (hasBlocking(conflicts)) {
      return err(
        new ValidationError(`${conflicts.filter((c) => c.severity === "BLOCKING").length} conflit(s) entre patrons : corrigez-les avant de publier.`, [], {
          code: SchedulingCodes.timetableHasConflicts,
          details: { conflicts: conflicts.filter((c) => c.severity === "BLOCKING").map((c) => ({ code: c.code, resourceKind: c.resourceKind, resourceId: c.resourceId, message: c.message })) },
        }),
      );
    }
    const published = await tt.setTimetablePublished(tx, t.id, ctx.userId, deps.clock.now());
    buf.add(SchedulingEvents.timetablePublished, { v: 1, timetableId: t.id, institutionId: t.institutionId, academicYearId: t.academicYearId, periodId: t.periodId, validFrom: t.validFrom, validTo: t.validTo }, { type: TIMETABLE_AGGREGATE, id: t.id });
    buf.audit({ action: "scheduling.timetable.published", resourceType: "timetable", resourceId: t.id, metadata: { entries: entries.length } });
    await buf.flush(tx);
    return ok(published);
  });
}

export async function archiveTimetable(deps: SchedulingDeps, ctx: RequestContext, input: { timetableId: string }): Promise<Result<Timetable, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const t = await tt.getTimetable(tx, input.timetableId, true);
    if (!t) return err(notFound("Emploi du temps", input.timetableId));
    if (t.status === "ARCHIVED") return ok(t);
    const archived = await tt.setTimetableArchived(tx, t.id, deps.clock.now());
    buf.add(SchedulingEvents.timetableArchived, { v: 1, timetableId: t.id, institutionId: t.institutionId, academicYearId: t.academicYearId }, { type: TIMETABLE_AGGREGATE, id: t.id });
    buf.audit({ action: "scheduling.timetable.archived", resourceType: "timetable", resourceId: t.id });
    await buf.flush(tx);
    return ok(archived);
  });
}

export interface CloneInput {
  sourceId: string;
  name: string;
  validFrom: string;
  validTo: string;
  weekAAnchor?: string | null | undefined;
  academicYearId?: string | undefined;
  periodId?: string | null | undefined;
  /** Correspondances de nœuds / classes (année précédente → nouvelle) : les patrons sans cible sont listés. */
  nodeMap?: Record<string, string> | undefined;
  classroomMap?: Record<string, string> | undefined;
}

export async function cloneTimetable(deps: SchedulingDeps, ctx: RequestContext, input: CloneInput): Promise<Result<{ timetable: Timetable; copied: number; unmapped: Array<{ entryId: string; reason: string }> }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const src = await tt.getTimetable(tx, input.sourceId);
    if (!src) return err(notFound("Emploi du temps", input.sourceId));
    const academicYearId = input.academicYearId ?? src.academicYearId;
    const dates = await checkTimetableDates(deps, ctx, { validFrom: input.validFrom, validTo: input.validTo, weekAAnchor: input.weekAAnchor === undefined ? src.weekAAnchor : input.weekAAnchor, academicYearId, periodId: input.periodId ?? null });
    if (!dates.ok) return dates;
    const created = await tt.insertTimetable(
      tx,
      ctx.tenantId,
      { id: deps.newId(), institutionId: src.institutionId, campusId: src.campusId, academicYearId, periodId: input.periodId ?? null, name: input.name.trim(), validFrom: input.validFrom, validTo: input.validTo, weekAAnchor: input.weekAAnchor === undefined ? src.weekAAnchor : input.weekAAnchor, clonedFromId: src.id },
      ctx.userId,
      deps.clock.now(),
    );
    const unmapped: Array<{ entryId: string; reason: string }> = [];
    let copied = 0;
    for (const e of await tt.listEntries(tx, src.id)) {
      // Une offre à la carte est propre à l'année source : on ne la reporte pas (et on ne la transforme
      // surtout pas en séance de classe entière).
      if (!e.claimsClassroom) {
        unmapped.push({ entryId: e.id, reason: "OFFERING_NOT_CARRIED" });
        continue;
      }
      const node = e.curriculumNodeId && input.nodeMap ? input.nodeMap[e.curriculumNodeId] : e.curriculumNodeId;
      const classroom = e.classroomId && input.classroomMap ? input.classroomMap[e.classroomId] : e.classroomId;
      if ((input.nodeMap && e.curriculumNodeId && !node) || (input.classroomMap && e.classroomId && !classroom)) {
        unmapped.push({ entryId: e.id, reason: !node && e.curriculumNodeId ? "NODE_NOT_MAPPED" : "CLASSROOM_NOT_MAPPED" });
        continue;
      }
      await tt.insertEntry(
        tx,
        ctx.tenantId,
        {
          id: deps.newId(),
          timetableId: created.id,
          kind: e.kind,
          classroomId: classroom ?? null,
          curriculumNodeId: node ?? null,
          // Une offre est propre à l'année source : elle n'est pas reportée.
          offeringId: null,
          claimsClassroom: true,
          weekday: e.weekday,
          startMinute: e.startMinute,
          endMinute: e.endMinute,
          timeSlotId: e.timeSlotId,
          roomId: e.roomId,
          weekPattern: e.weekPattern,
          validFrom: null,
          validTo: null,
          deliveryMode: e.deliveryMode,
          title: e.title,
          notes: e.notes,
          staff: e.staff,
          equipment: e.equipment,
        },
        deps.clock.now(),
      );
      copied += 1;
    }
    return ok({ timetable: created, copied, unmapped });
  });
}
