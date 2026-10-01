/**
 * Cas d'usage du cycle de vie d'une séance : création (ponctuelle, examen, réunion, réservation de
 * salle, déclaration par l'enseignant, séance comptable), report, changement de salle et
 * d'intervenants, remplacement, constat, annulation, restauration, dépassement de conflit.
 *
 * Toute écriture : UNE transaction ; verrous consultatifs sur les ressources réservées ; aperçu des
 * conflits expliqué AVANT l'écriture ; la base impose ensuite l'invariant (exclusion, gel, stock) ;
 * événements d'outbox et audit dans la même transaction.
 */
import { ForbiddenError, NotFoundError, ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { conflictDetected, hoursLocked, invalidTransition, occurrenceCancelled, occurrenceValidated, reasonRequired, SchedulingCodes } from "../domain/errors";
import type { ConflictView } from "../domain/conflicts";
import { editability, nextStatus, defaultPaidRole, type Editability } from "../domain/occurrence-rules";
import { SchedulingEvents } from "../domain/events";
import { localDateOf, localToInstant } from "../domain/time";
import type {
  DeliveryMode,
  EntryEquipment,
  HeldSource,
  Occurrence,
  OccurrenceDetail,
  OccurrenceKind,
  OccurrenceStaff,
  ReplacementReason,
  SchedulingSettings,
  StaffRole,
} from "../domain/types";
import { OCCURRENCE_KINDS } from "../domain/types";
import * as occRepo from "../infrastructure/occurrence-repo";
import { getRoom } from "../infrastructure/reference-repo";
import { EventBuffer, inTx, lockResources, setChangeReason, type ResourceRef, type SchedulingDeps } from "./deps";
import { classroomKeyOf, evaluatePlacement, resolveAcademic, type AcademicContext, type Placement } from "./placement";
import {
  MIN_OVERRIDE_REASON_LENGTH,
  MIN_REASON_LENGTH,
  OCCURRENCE_AGGREGATE,
  checkStaffEligible,
  loadSettings,
  occurrenceEventPayload,
  resolveWindow,
  trimReason,
  validation,
  type TimeInput,
} from "./support";

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

export interface StaffAssignmentInput {
  staffId: string;
  role?: StaffRole | undefined;
  replacesStaffId?: string | null | undefined;
  /** Défaut : selon le rôle et le paramètre `supervisorsPaid` de l'établissement. */
  isPaidRole?: boolean | undefined;
}

export interface OverrideInput {
  reason: string;
}

export interface CreateOccurrenceInput extends TimeInput {
  kind: OccurrenceKind;
  title?: string | null | undefined;
  institutionId?: string | undefined;
  campusId?: string | null | undefined;
  academicYearId?: string | undefined;
  classroomId?: string | null | undefined;
  curriculumNodeId?: string | null | undefined;
  offeringId?: string | null | undefined;
  claimsClassroom?: boolean | undefined;
  roomId?: string | null | undefined;
  deliveryMode?: DeliveryMode | undefined;
  virtualSessionRef?: string | null | undefined;
  notes?: string | null | undefined;
  locationLabel?: string | null | undefined;
  attributes?: Record<string, unknown> | undefined;
  staff?: StaffAssignmentInput[] | undefined;
  equipment?: EntryEquipment[] | undefined;
  /** `HELD` : constat immédiat d'une séance déjà tenue (déclaration a posteriori). */
  status?: "PLANNED" | "HELD" | undefined;
  override?: OverrideInput | undefined;
  reason?: string | undefined;
  /** `DECLARE` : un enseignant déclare une séance ponctuelle de SES classes (identité tirée du contexte). */
  mode?: "MANAGE" | "DECLARE" | undefined;
}

export interface OccurrenceResult {
  occurrence: OccurrenceDetail;
  /** Avertissements non bloquants (indisponibilité, capacité, compétence…). */
  warnings: ConflictView[];
}

export const editBlocked = (e: Extract<Editability, { ok: false }>): AppError =>
  e.reason === "LOCKED" ? hoursLocked(e.lockRef ?? null) : e.reason === "VALIDATED" ? occurrenceValidated() : occurrenceCancelled();

export const notFoundOccurrence = (id: string): AppError => NotFoundError.of("Séance", id, { code: SchedulingCodes.notFound });

function normalizeStaff(inputs: readonly StaffAssignmentInput[] | undefined, settings: SchedulingSettings): Result<Array<{ staffId: string; role: StaffRole; replacesStaffId: string | null; isPaidRole: boolean }>, AppError> {
  const seen = new Set<string>();
  const out: Array<{ staffId: string; role: StaffRole; replacesStaffId: string | null; isPaidRole: boolean }> = [];
  for (const s of inputs ?? []) {
    if (seen.has(s.staffId)) return err(validation("staff", `L'intervenant ${s.staffId} est listé deux fois.`, "duplicate_staff"));
    seen.add(s.staffId);
    const role = s.role ?? "LEAD";
    if (role === "SUBSTITUTE" && !s.replacesStaffId) return err(validation("staff", "Un remplaçant doit désigner l'intervenant remplacé (replacesStaffId).", "replaces_required"));
    if (s.replacesStaffId && s.replacesStaffId === s.staffId) return err(validation("staff", "Un intervenant ne peut pas se remplacer lui-même.", "replaces_self"));
    out.push({ staffId: s.staffId, role, replacesStaffId: s.replacesStaffId ?? null, isPaidRole: s.isPaidRole ?? defaultPaidRole(role, settings.supervisorsPaid) });
  }
  return ok(out);
}

function normalizeEquipment(items: readonly EntryEquipment[] | undefined): Result<EntryEquipment[], AppError> {
  const seen = new Set<string>();
  for (const it of items ?? []) {
    if (seen.has(it.equipmentId)) return err(validation("equipment", "Un équipement est listé deux fois.", "duplicate_equipment"));
    seen.add(it.equipmentId);
    if (!Number.isInteger(it.quantity) || it.quantity < 1) return err(validation("equipment", "La quantité d'un équipement est un entier ≥ 1.", "invalid_quantity"));
  }
  return ok([...(items ?? [])]);
}

function requireOverrideReason(o: OverrideInput | undefined): Result<string | null, AppError> {
  if (!o) return ok(null);
  const reason = trimReason(o.reason);
  if (reason.length < MIN_OVERRIDE_REASON_LENGTH) {
    return err(
      new ValidationError(`Le motif du dépassement de conflit doit faire au moins ${MIN_OVERRIDE_REASON_LENGTH} caractères.`, [{ path: ["override", "reason"], message: "Motif trop court.", code: "too_short" }], {
        code: SchedulingCodes.overrideReasonRequired,
      }),
    );
  }
  return ok(reason);
}

export function resourcesOfPlacement(p: Pick<Placement, "kind" | "claimsClassroom" | "classroomId" | "offeringId" | "roomId" | "staff" | "origin">): ResourceRef[] {
  if (p.origin === "ACCOUNTING") return [];
  const out: ResourceRef[] = p.staff.map((s) => ({ kind: "STAFF" as const, id: s.staffId }));
  const key = classroomKeyOf(p);
  if (key) out.push({ kind: "CLASSROOM", id: key });
  if (p.roomId) out.push({ kind: "ROOM", id: p.roomId });
  return out;
}

/** Établissement d'une séance avant de connaître le fuseau (classe/offre → établissement). */
async function institutionHint(deps: SchedulingDeps, ctx: RequestContext, input: { institutionId?: string | undefined; classroomId?: string | null | undefined; offeringId?: string | null | undefined }): Promise<Result<string, AppError>> {
  const direct = input.institutionId ?? ctx.institutionId;
  if (direct) return ok(direct);
  const academic = deps.ports.academic;
  if (academic) {
    let classroomId = input.classroomId ?? null;
    if (!classroomId && input.offeringId) classroomId = (await academic.getOffering(ctx, input.offeringId))?.classroomId ?? null;
    if (classroomId) {
      const c = await academic.getClassroom(ctx, classroomId);
      if (c) return ok(c.institutionId);
    }
  }
  return err(validation("institutionId", "L'établissement est requis (institutionId).", "institution_required"));
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export async function createOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: CreateOccurrenceInput): Promise<Result<OccurrenceResult, AppError>> {
  if (!OCCURRENCE_KINDS.includes(input.kind)) return err(validation("kind", `Nature de séance inconnue : ${input.kind}.`, "invalid_kind"));
  const overrideReason = requireOverrideReason(input.override);
  if (!overrideReason.ok) return overrideReason;

  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const now = deps.clock.now();

    const inst = await institutionHint(deps, ctx, input);
    if (!inst.ok) return inst;
    const settings = await loadSettings(tx, inst.value);
    const win = resolveWindow(input, settings.timezone);
    if (!win.ok) return win;

    // Déclaration par un enseignant : identité dérivée du contexte, jamais d'un paramètre.
    let staffInputs = input.staff;
    let declaredBy: string | null = null;
    if (input.mode === "DECLARE") {
      const people = deps.ports.people;
      if (!people || !ctx.userId) return err(new ForbiddenError("La déclaration d'une séance par un enseignant n'est pas disponible.", { code: SchedulingCodes.peopleUnavailable }));
      declaredBy = await people.resolveStaffForUser(ctx, ctx.userId);
      if (!declaredBy) return err(new ForbiddenError("Votre compte n'est lié à aucun membre du personnel.", { code: SchedulingCodes.notAssigned }));
      if (input.kind !== "LESSON" || !input.classroomId) {
        return err(new ForbiddenError("Un enseignant ne peut déclarer qu'une séance de cours de l'une de ses classes.", { code: SchedulingCodes.notAssigned }));
      }
      staffInputs = [{ staffId: declaredBy, role: "LEAD" }];
    }

    const ac = await resolveAcademic(deps, ctx, {
      classroomId: input.classroomId,
      offeringId: input.offeringId,
      curriculumNodeId: input.curriculumNodeId,
      claimsClassroom: input.claimsClassroom,
      institutionId: inst.value,
      campusId: input.campusId,
      academicYearId: input.academicYearId,
      date: win.value.occursOn,
    });
    if (!ac.ok) return ac;
    if (input.kind === "LESSON" && (!ac.value.classroomId || !ac.value.curriculumNodeId)) {
      return err(validation("classroomId", "Une séance de cours exige une classe et un nœud de curriculum.", "lesson_requires_class_and_node"));
    }
    if (input.kind === "RESERVATION" && (ac.value.classroomId || ac.value.curriculumNodeId)) {
      return err(validation("classroomId", "Une réservation de salle ne vise ni classe ni nœud de curriculum.", "reservation_without_class"));
    }
    if (input.kind === "RESERVATION" && !input.roomId) return err(validation("roomId", "Une réservation de salle précise la salle.", "room_required"));

    if (declaredBy && deps.ports.people) {
      const assigned = await deps.ports.people.isStaffAssignedToClassroom(ctx, declaredBy, ac.value.classroomId as string, win.value.occursOn);
      if (!assigned) return err(new ForbiddenError("Vous n'avez pas d'affectation d'enseignement dans cette classe.", { code: SchedulingCodes.notAssigned }));
    }

    const staff = normalizeStaff(staffInputs, settings);
    if (!staff.ok) return staff;
    const equipment = normalizeEquipment(input.equipment);
    if (!equipment.ok) return equipment;
    const eligible = await checkStaffEligible(deps, ctx, staff.value.map((s) => s.staffId));
    if (!eligible.ok) return eligible;

    if (input.status === "HELD" && win.value.startsAt.getTime() > now.getTime()) {
      return err(validation("status", "Une séance qui n'a pas encore commencé ne peut pas être constatée.", "hold_future"));
    }

    const placement: Placement = {
      institutionId: inst.value,
      kind: input.kind,
      origin: "AD_HOC",
      startsAt: win.value.startsAt,
      endsAt: win.value.endsAt,
      staff: staff.value,
      classroomId: ac.value.classroomId,
      offeringId: ac.value.offeringId,
      curriculumNodeId: ac.value.curriculumNodeId,
      claimsClassroom: ac.value.claimsClassroom,
      roomId: input.roomId ?? null,
      equipment: equipment.value,
      excludeOccurrenceId: null,
      override: overrideReason.value !== null,
      headcount: ac.value.offering?.headcount ?? ac.value.classroom?.headcount ?? null,
      classroom: ac.value.classroom,
      offering: ac.value.offering,
      node: ac.value.node,
    };

    await lockResources(tx, ctx, resourcesOfPlacement(placement));
    const evaluation = await evaluatePlacement(deps, ctx, tx, placement);
    if (evaluation.blocking) return err(conflictDetected(evaluation.conflicts));

    const id = deps.newId();
    await setChangeReason(tx, trimReason(input.reason) || (input.mode === "DECLARE" ? "Séance déclarée par l'enseignant" : null));
    await occRepo.insertOccurrence(tx, {
      id,
      tenantId: ctx.tenantId,
      institutionId: inst.value,
      campusId: ac.value.campusId,
      academicYearId: ac.value.academicYearId as string,
      timetableEntryId: null,
      generatedFor: null,
      kind: input.kind,
      title: input.title ?? null,
      classroomId: ac.value.classroomId,
      curriculumNodeId: ac.value.curriculumNodeId,
      offeringId: ac.value.offeringId,
      claimsClassroom: ac.value.claimsClassroom,
      roomId: input.roomId ?? null,
      startsAt: win.value.startsAt,
      endsAt: win.value.endsAt,
      occursOn: win.value.occursOn,
      deliveryMode: input.deliveryMode ?? "IN_PERSON",
      status: input.status === "HELD" ? "HELD" : "PLANNED",
      heldAt: input.status === "HELD" ? now : null,
      heldSource: input.status === "HELD" ? "ADMIN" : null,
      heldBy: input.status === "HELD" ? ctx.userId : null,
      origin: "AD_HOC",
      conflictOverride: overrideReason.value !== null,
      conflictOverrideReason: overrideReason.value,
      conflictOverrideBy: overrideReason.value !== null ? ctx.userId : null,
      notes: input.notes ?? null,
      locationLabel: input.locationLabel ?? null,
      attributes: input.attributes ?? {},
      createdBy: ctx.userId,
    });
    if (input.virtualSessionRef) await occRepo.updateDescriptive(tx, id, { virtualSessionRef: input.virtualSessionRef }, now);
    await occRepo.insertStaff(
      tx,
      ctx.tenantId,
      staff.value.map((s) => ({ id: deps.newId(), occurrenceId: id, staffId: s.staffId, role: s.role, replacesStaffId: s.replacesStaffId, isPaidRole: s.isPaidRole })),
    );
    await occRepo.insertEquipment(tx, ctx.tenantId, id, equipment.value);
    await setChangeReason(tx, null);

    const detail = await occRepo.getOccurrenceDetail(tx, id);
    if (!detail) throw new Error("Séance introuvable après création.");
    buf.add(SchedulingEvents.occurrenceCreated, occurrenceEventPayload(detail, staff.value.map((s) => s.staffId), { origin: "AD_HOC", declaredByTeacher: declaredBy !== null }), { type: OCCURRENCE_AGGREGATE, id });
    if (input.status === "HELD") buf.add(SchedulingEvents.occurrenceHeld, occurrenceEventPayload(detail, staff.value.map((s) => s.staffId), { source: "ADMIN" }), { type: OCCURRENCE_AGGREGATE, id });
    if (overrideReason.value !== null) {
      buf.add(SchedulingEvents.conflictOverridden, { v: 1, occurrenceId: id, reason: overrideReason.value }, { type: OCCURRENCE_AGGREGATE, id });
      buf.audit({ action: "scheduling.conflict.overridden", resourceType: "occurrence", resourceId: id, sensitive: true, reason: overrideReason.value, metadata: { conflicts: evaluation.conflicts.length } });
    }
    await buf.flush(tx);
    return ok({ occurrence: detail, warnings: evaluation.conflicts });
  });
}

// ---------------------------------------------------------------------------
// Séance comptable (AC5.7)
// ---------------------------------------------------------------------------

export interface CreateAccountingOccurrenceInput extends TimeInput {
  staffId: string;
  /** Minutes entières (1..1440) ; fenêtre synthétique en début de journée si aucune plage n'est donnée. */
  minutes?: number | undefined;
  institutionId?: string | undefined;
  academicYearId?: string | undefined;
  classroomId?: string | null | undefined;
  curriculumNodeId?: string | null | undefined;
  title?: string | null | undefined;
  role?: StaffRole | undefined;
  reason?: string | undefined;
  /** Date civile (obligatoire avec `minutes`). */
  date?: string | undefined;
}

export async function createAccountingOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: CreateAccountingOccurrenceInput): Promise<Result<OccurrenceResult, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const now = deps.clock.now();
    const inst = await institutionHint(deps, ctx, input);
    if (!inst.ok) return inst;
    const settings = await loadSettings(tx, inst.value);

    let startsAt: Date;
    let endsAt: Date;
    let occursOn: string;
    if (input.minutes !== undefined) {
      if (!input.date) return err(validation("date", "La date est requise avec une durée en minutes.", "date_required"));
      if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440) return err(validation("minutes", "La durée est un nombre entier de minutes entre 1 et 1440.", "invalid_minutes"));
      try {
        startsAt = localToInstant(input.date, 0, settings.timezone);
      } catch {
        return err(validation("date", "Date invalide.", "invalid_date"));
      }
      endsAt = new Date(startsAt.getTime() + input.minutes * 60_000);
      occursOn = input.date;
      if (localDateOf(new Date(endsAt.getTime() - 1), settings.timezone) !== occursOn && input.minutes < 1440) {
        // fenêtre synthétique qui déborderait sur le lendemain local (jour de changement d'heure) : on borne.
        endsAt = localToInstant(input.date, 1440, settings.timezone);
      }
    } else {
      const win = resolveWindow(input, settings.timezone);
      if (!win.ok) return win;
      ({ startsAt, endsAt, occursOn } = win.value);
    }
    if (startsAt.getTime() > now.getTime() + 24 * 3_600_000) return err(validation("date", "Une séance comptable concerne des heures déjà effectuées.", "future_accounting"));

    const hasClass = Boolean(input.classroomId && input.curriculumNodeId);
    if ((input.classroomId || input.curriculumNodeId) && !hasClass) return err(validation("classroomId", "Précisez la classe ET le nœud de curriculum, ou aucun des deux.", "class_and_node"));
    const ac = await resolveAcademic(deps, ctx, {
      classroomId: input.classroomId,
      curriculumNodeId: input.curriculumNodeId,
      institutionId: inst.value,
      academicYearId: input.academicYearId,
      date: occursOn,
    });
    if (!ac.ok) return ac;

    const role = input.role ?? "LEAD";
    const staff = normalizeStaff([{ staffId: input.staffId, role }], settings);
    if (!staff.ok) return staff;
    const eligible = await checkStaffEligible(deps, ctx, [input.staffId]);
    if (!eligible.ok) return eligible;

    const id = deps.newId();
    await setChangeReason(tx, trimReason(input.reason) || "Saisie comptable");
    await occRepo.insertOccurrence(tx, {
      id,
      tenantId: ctx.tenantId,
      institutionId: inst.value,
      campusId: ac.value.campusId,
      academicYearId: ac.value.academicYearId as string,
      timetableEntryId: null,
      generatedFor: null,
      kind: hasClass ? "LESSON" : "OTHER",
      title: input.title ?? "Saisie comptable",
      classroomId: ac.value.classroomId,
      curriculumNodeId: ac.value.curriculumNodeId,
      offeringId: null,
      claimsClassroom: true,
      roomId: null,
      startsAt,
      endsAt,
      occursOn,
      deliveryMode: "IN_PERSON",
      status: "HELD",
      heldAt: now,
      heldSource: "ADMIN",
      heldBy: ctx.userId,
      origin: "ACCOUNTING",
      conflictOverride: false,
      conflictOverrideReason: null,
      conflictOverrideBy: null,
      notes: null,
      locationLabel: null,
      attributes: {},
      createdBy: ctx.userId,
    });
    await occRepo.insertStaff(tx, ctx.tenantId, staff.value.map((s) => ({ id: deps.newId(), occurrenceId: id, staffId: s.staffId, role: s.role, replacesStaffId: null, isPaidRole: s.isPaidRole })));
    await setChangeReason(tx, null);
    const detail = await occRepo.getOccurrenceDetail(tx, id);
    if (!detail) throw new Error("Séance introuvable après création.");
    buf.add(SchedulingEvents.occurrenceCreated, occurrenceEventPayload(detail, [input.staffId], { origin: "ACCOUNTING" }), { type: OCCURRENCE_AGGREGATE, id });
    buf.audit({ action: "scheduling.occurrence.accounting_created", resourceType: "occurrence", resourceId: id, sensitive: true, metadata: { staffId: input.staffId, minutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000), occursOn } });
    await buf.flush(tx);
    return ok({ occurrence: detail, warnings: [] });
  });
}

// ---------------------------------------------------------------------------
// Aide : chargement d'une séance modifiable
// ---------------------------------------------------------------------------

interface Loaded {
  occ: Occurrence;
  staff: OccurrenceStaff[];
  settings: SchedulingSettings;
}

async function loadForUpdate(tx: Tx, id: string, options: { allowCancelled?: boolean } = {}): Promise<Result<Loaded, AppError>> {
  const occ = await occRepo.getOccurrence(tx, id, { forUpdate: true });
  if (!occ) return err(notFoundOccurrence(id));
  const staff = (await occRepo.listStaffByOccurrence(tx, [id])).get(id) ?? [];
  const edit = editability(occ, staff, options);
  if (!edit.ok) return err(editBlocked(edit));
  const settings = await loadSettings(tx, occ.institutionId);
  return ok({ occ, staff, settings });
}

async function placementFromOccurrence(deps: SchedulingDeps, ctx: RequestContext, occ: Occurrence, staff: readonly OccurrenceStaff[], overrides: Partial<Placement> = {}): Promise<Placement> {
  const academic = deps.ports.academic;
  const classroom = academic && occ.classroomId ? await academic.getClassroom(ctx, occ.classroomId) : null;
  const offering = academic && occ.offeringId ? await academic.getOffering(ctx, occ.offeringId) : null;
  const node = academic && occ.curriculumNodeId ? await academic.getCurriculumNode(ctx, occ.curriculumNodeId) : null;
  return {
    institutionId: occ.institutionId,
    kind: occ.kind,
    origin: occ.origin,
    startsAt: occ.startsAt,
    endsAt: occ.endsAt,
    staff: staff.map((s) => ({ staffId: s.staffId, role: s.role })),
    classroomId: occ.classroomId,
    offeringId: occ.offeringId,
    curriculumNodeId: occ.curriculumNodeId,
    claimsClassroom: occ.claimsClassroom,
    roomId: occ.roomId,
    equipment: [],
    excludeOccurrenceId: occ.id,
    override: occ.conflictOverride,
    headcount: offering?.headcount ?? classroom?.headcount ?? null,
    classroom,
    offering,
    node,
    ...overrides,
  };
}

async function reload(tx: Tx, id: string): Promise<OccurrenceDetail> {
  const detail = await occRepo.getOccurrenceDetail(tx, id);
  if (!detail) throw new Error(`Séance ${id} introuvable.`);
  return detail;
}

const staffIdsOf = (staff: readonly { staffId: string }[]): string[] => staff.map((s) => s.staffId);

// ---------------------------------------------------------------------------
// Report, salle, intervenants
// ---------------------------------------------------------------------------

export interface RescheduleInput extends TimeInput {
  occurrenceId: string;
  reason?: string | undefined;
  override?: OverrideInput | undefined;
}

export async function rescheduleOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: RescheduleInput): Promise<Result<OccurrenceResult, AppError>> {
  const overrideReason = requireOverrideReason(input.override);
  if (!overrideReason.ok) return overrideReason;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const loaded = await loadForUpdate(tx, input.occurrenceId);
    if (!loaded.ok) return loaded;
    const { occ, staff, settings } = loaded.value;
    const win = resolveWindow(input, settings.timezone);
    if (!win.ok) return win;
    if (win.value.startsAt.getTime() === occ.startsAt.getTime() && win.value.endsAt.getTime() === occ.endsAt.getTime()) {
      return ok({ occurrence: await reload(tx, occ.id), warnings: [] });
    }
    const placement = await placementFromOccurrence(deps, ctx, occ, staff, {
      startsAt: win.value.startsAt,
      endsAt: win.value.endsAt,
      override: occ.conflictOverride || overrideReason.value !== null,
      equipment: ((await occRepo.listEquipmentByOccurrence(tx, [occ.id])).get(occ.id) ?? []),
    });
    await lockResources(tx, ctx, resourcesOfPlacement(placement));
    const evaluation = await evaluatePlacement(deps, ctx, tx, placement);
    if (evaluation.blocking) return err(conflictDetected(evaluation.conflicts));

    await setChangeReason(tx, trimReason(input.reason) || null);
    if (overrideReason.value !== null && !occ.conflictOverride) await occRepo.setOverride(tx, occ.id, overrideReason.value, ctx.userId as string, deps.clock.now());
    await occRepo.updateTimes(tx, occ.id, win.value.startsAt, win.value.endsAt, win.value.occursOn, deps.clock.now());
    await setChangeReason(tx, null);

    const detail = await reload(tx, occ.id);
    buf.add(
      SchedulingEvents.occurrenceRescheduled,
      occurrenceEventPayload(detail, staffIdsOf(staff), { from: { startsAt: occ.startsAt.toISOString(), endsAt: occ.endsAt.toISOString() }, reason: trimReason(input.reason) || null }),
      { type: OCCURRENCE_AGGREGATE, id: occ.id },
    );
    if (overrideReason.value !== null && !occ.conflictOverride) {
      buf.add(SchedulingEvents.conflictOverridden, { v: 1, occurrenceId: occ.id, reason: overrideReason.value }, { type: OCCURRENCE_AGGREGATE, id: occ.id });
      buf.audit({ action: "scheduling.conflict.overridden", resourceType: "occurrence", resourceId: occ.id, sensitive: true, reason: overrideReason.value });
    }
    await buf.flush(tx);
    return ok({ occurrence: detail, warnings: evaluation.conflicts });
  });
}

export interface ChangeRoomInput {
  occurrenceId: string;
  roomId: string | null;
  reason?: string | undefined;
  override?: OverrideInput | undefined;
}

export async function changeOccurrenceRoom(deps: SchedulingDeps, ctx: RequestContext, input: ChangeRoomInput): Promise<Result<OccurrenceResult, AppError>> {
  const overrideReason = requireOverrideReason(input.override);
  if (!overrideReason.ok) return overrideReason;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const loaded = await loadForUpdate(tx, input.occurrenceId);
    if (!loaded.ok) return loaded;
    const { occ, staff } = loaded.value;
    if ((input.roomId ?? null) === occ.roomId) return ok({ occurrence: await reload(tx, occ.id), warnings: [] });
    if (input.roomId) {
      const room = await getRoom(tx, input.roomId);
      if (!room) return err(NotFoundError.of("Salle", input.roomId, { code: SchedulingCodes.notFound }));
    }
    const placement = await placementFromOccurrence(deps, ctx, occ, staff, {
      roomId: input.roomId,
      override: occ.conflictOverride || overrideReason.value !== null,
      equipment: ((await occRepo.listEquipmentByOccurrence(tx, [occ.id])).get(occ.id) ?? []),
    });
    await lockResources(tx, ctx, resourcesOfPlacement(placement));
    const evaluation = await evaluatePlacement(deps, ctx, tx, placement);
    if (evaluation.blocking) return err(conflictDetected(evaluation.conflicts));

    await setChangeReason(tx, trimReason(input.reason) || null);
    if (overrideReason.value !== null && !occ.conflictOverride) await occRepo.setOverride(tx, occ.id, overrideReason.value, ctx.userId as string, deps.clock.now());
    await occRepo.updateRoom(tx, occ.id, input.roomId, deps.clock.now());
    // Une séance « à remplacer » faute de salle est réglée par le changement de salle.
    if (occ.needsReplacement && occ.replacementReason === "ROOM_UNAVAILABLE") await occRepo.setNeedsReplacement(tx, [occ.id], null, deps.clock.now());
    await setChangeReason(tx, null);

    const detail = await reload(tx, occ.id);
    buf.add(SchedulingEvents.occurrenceRoomChanged, occurrenceEventPayload(detail, staffIdsOf(staff), { fromRoomId: occ.roomId, reason: trimReason(input.reason) || null }), { type: OCCURRENCE_AGGREGATE, id: occ.id });
    if (overrideReason.value !== null && !occ.conflictOverride) {
      buf.add(SchedulingEvents.conflictOverridden, { v: 1, occurrenceId: occ.id, reason: overrideReason.value }, { type: OCCURRENCE_AGGREGATE, id: occ.id });
      buf.audit({ action: "scheduling.conflict.overridden", resourceType: "occurrence", resourceId: occ.id, sensitive: true, reason: overrideReason.value });
    }
    await buf.flush(tx);
    return ok({ occurrence: detail, warnings: evaluation.conflicts });
  });
}

export interface SetStaffInput {
  occurrenceId: string;
  /** Liste COMPLÈTE des intervenants souhaitée (les absents de la liste sont retirés). */
  staff: StaffAssignmentInput[];
  reason?: string | undefined;
  override?: OverrideInput | undefined;
}

const STAFF_REPLACEMENT_REASONS: readonly ReplacementReason[] = ["STAFF_LEAVE", "STAFF_LEFT", "STAFF_SUSPENDED", "ASSIGNMENT_ENDED"];

export async function setOccurrenceStaff(deps: SchedulingDeps, ctx: RequestContext, input: SetStaffInput): Promise<Result<OccurrenceResult, AppError>> {
  const overrideReason = requireOverrideReason(input.override);
  if (!overrideReason.ok) return overrideReason;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const loaded = await loadForUpdate(tx, input.occurrenceId);
    if (!loaded.ok) return loaded;
    const { occ, staff: current, settings } = loaded.value;
    const wanted = normalizeStaff(input.staff, settings);
    if (!wanted.ok) return wanted;
    const added = wanted.value.filter((w) => !current.some((c) => c.staffId === w.staffId));
    const eligible = await checkStaffEligible(deps, ctx, added.map((a) => a.staffId));
    if (!eligible.ok) return eligible;

    const placement = await placementFromOccurrence(deps, ctx, occ, current, {
      staff: wanted.value.map((w) => ({ staffId: w.staffId, role: w.role })),
      override: occ.conflictOverride || overrideReason.value !== null,
      equipment: ((await occRepo.listEquipmentByOccurrence(tx, [occ.id])).get(occ.id) ?? []),
    });
    await lockResources(tx, ctx, [...resourcesOfPlacement(placement), ...current.map((c) => ({ kind: "STAFF" as const, id: c.staffId }))]);
    const evaluation = await evaluatePlacement(deps, ctx, tx, placement);
    if (evaluation.blocking) return err(conflictDetected(evaluation.conflicts));

    await setChangeReason(tx, trimReason(input.reason) || null);
    if (overrideReason.value !== null && !occ.conflictOverride) await occRepo.setOverride(tx, occ.id, overrideReason.value, ctx.userId as string, deps.clock.now());
    const now = deps.clock.now();
    for (const c of current) {
      if (!wanted.value.some((w) => w.staffId === c.staffId)) await occRepo.deleteStaff(tx, occ.id, c.staffId);
    }
    for (const w of wanted.value) {
      const existing = current.find((c) => c.staffId === w.staffId);
      if (existing && (existing.role !== w.role || existing.isPaidRole !== w.isPaidRole)) await occRepo.updateStaffRole(tx, occ.id, w.staffId, w.role, w.isPaidRole, now);
    }
    await occRepo.insertStaff(tx, ctx.tenantId, added.map((a) => ({ id: deps.newId(), occurrenceId: occ.id, staffId: a.staffId, role: a.role, replacesStaffId: a.replacesStaffId, isPaidRole: a.isPaidRole })));
    if (occ.needsReplacement && occ.replacementReason && STAFF_REPLACEMENT_REASONS.includes(occ.replacementReason)) await occRepo.setNeedsReplacement(tx, [occ.id], null, now);
    await setChangeReason(tx, null);

    const detail = await reload(tx, occ.id);
    buf.add(SchedulingEvents.occurrenceStaffChanged, occurrenceEventPayload(detail, staffIdsOf(detail.staff), { previousStaffIds: staffIdsOf(current), reason: trimReason(input.reason) || null }), { type: OCCURRENCE_AGGREGATE, id: occ.id });
    if (overrideReason.value !== null && !occ.conflictOverride) {
      buf.add(SchedulingEvents.conflictOverridden, { v: 1, occurrenceId: occ.id, reason: overrideReason.value }, { type: OCCURRENCE_AGGREGATE, id: occ.id });
      buf.audit({ action: "scheduling.conflict.overridden", resourceType: "occurrence", resourceId: occ.id, sensitive: true, reason: overrideReason.value });
    }
    await buf.flush(tx);
    return ok({ occurrence: detail, warnings: evaluation.conflicts });
  });
}

export interface SubstituteInput {
  occurrenceId: string;
  originalStaffId: string;
  substituteStaffId: string;
  reason: string;
  override?: OverrideInput | undefined;
}

/**
 * Remplacement (AC4.1) : retire la ligne du remplacé (journalisée) et crée une ligne SUBSTITUTE qui le
 * désigne ; le bénéficiaire de la paie est le remplaçant. Les conflits du remplaçant sont contrôlés.
 */
export async function substituteStaff(deps: SchedulingDeps, ctx: RequestContext, input: SubstituteInput): Promise<Result<OccurrenceResult, AppError>> {
  const reason = trimReason(input.reason);
  if (reason.length < MIN_REASON_LENGTH) return err(reasonRequired("un remplacement"));
  if (input.originalStaffId === input.substituteStaffId) return err(validation("substituteStaffId", "Le remplaçant doit être une autre personne.", "same_staff"));
  const overrideReason = requireOverrideReason(input.override);
  if (!overrideReason.ok) return overrideReason;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const loaded = await loadForUpdate(tx, input.occurrenceId);
    if (!loaded.ok) return loaded;
    const { occ, staff: current } = loaded.value;
    const original = current.find((s) => s.staffId === input.originalStaffId);
    if (!original) return err(NotFoundError.of("Intervenant de la séance", input.originalStaffId, { code: SchedulingCodes.notFound }));
    if (current.some((s) => s.staffId === input.substituteStaffId)) return err(validation("substituteStaffId", "Le remplaçant est déjà intervenant de cette séance.", "already_on_occurrence"));
    const eligible = await checkStaffEligible(deps, ctx, [input.substituteStaffId]);
    if (!eligible.ok) return eligible;

    const nextStaff = [
      ...current.filter((s) => s.staffId !== input.originalStaffId).map((s) => ({ staffId: s.staffId, role: s.role })),
      { staffId: input.substituteStaffId, role: "SUBSTITUTE" as const },
    ];
    const placement = await placementFromOccurrence(deps, ctx, occ, current, {
      staff: nextStaff,
      override: occ.conflictOverride || overrideReason.value !== null,
      equipment: ((await occRepo.listEquipmentByOccurrence(tx, [occ.id])).get(occ.id) ?? []),
    });
    await lockResources(tx, ctx, [...resourcesOfPlacement(placement), { kind: "STAFF", id: input.originalStaffId }]);
    const evaluation = await evaluatePlacement(deps, ctx, tx, placement);
    if (evaluation.blocking) return err(conflictDetected(evaluation.conflicts));

    const now = deps.clock.now();
    await setChangeReason(tx, reason);
    if (overrideReason.value !== null && !occ.conflictOverride) await occRepo.setOverride(tx, occ.id, overrideReason.value, ctx.userId as string, now);
    await occRepo.deleteStaff(tx, occ.id, input.originalStaffId);
    await occRepo.insertStaff(tx, ctx.tenantId, [
      { id: deps.newId(), occurrenceId: occ.id, staffId: input.substituteStaffId, role: "SUBSTITUTE", replacesStaffId: input.originalStaffId, isPaidRole: original.isPaidRole },
    ]);
    if (occ.needsReplacement && occ.replacementReason && STAFF_REPLACEMENT_REASONS.includes(occ.replacementReason)) await occRepo.setNeedsReplacement(tx, [occ.id], null, now);
    await setChangeReason(tx, null);

    const detail = await reload(tx, occ.id);
    buf.add(
      SchedulingEvents.occurrenceStaffChanged,
      occurrenceEventPayload(detail, staffIdsOf(detail.staff), { substitution: { replaced: input.originalStaffId, substitute: input.substituteStaffId }, reason }),
      { type: OCCURRENCE_AGGREGATE, id: occ.id },
    );
    buf.audit({ action: "scheduling.occurrence.staff_substituted", resourceType: "occurrence", resourceId: occ.id, reason, metadata: { replaced: input.originalStaffId, substitute: input.substituteStaffId } });
    if (overrideReason.value !== null && !occ.conflictOverride) {
      buf.add(SchedulingEvents.conflictOverridden, { v: 1, occurrenceId: occ.id, reason: overrideReason.value }, { type: OCCURRENCE_AGGREGATE, id: occ.id });
      buf.audit({ action: "scheduling.conflict.overridden", resourceType: "occurrence", resourceId: occ.id, sensitive: true, reason: overrideReason.value });
    }
    await buf.flush(tx);
    return ok({ occurrence: detail, warnings: evaluation.conflicts });
  });
}

// ---------------------------------------------------------------------------
// Constat, annulation, restauration
// ---------------------------------------------------------------------------

export interface HoldInput {
  occurrenceId: string;
  source: HeldSource;
  /** Obligatoire pour un constat manuel (`ADMIN`). */
  reason?: string | undefined;
}

export interface HoldResult {
  occurrence: OccurrenceDetail;
  /** `true` si la séance était déjà constatée (idempotence). */
  alreadyHeld: boolean;
  /** `true` si le constat a été ignoré car la séance est annulée (un appel tardif ne la ressuscite pas). */
  ignoredCancelled: boolean;
  /** AC4.4 : le constateur n'est pas un intervenant déclaré de la séance. */
  warnings: Array<"NON_PARTICIPANT_HELD">;
}

export async function holdOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: HoldInput): Promise<Result<HoldResult, AppError>> {
  const reason = trimReason(input.reason);
  if (input.source === "ADMIN" && reason.length < MIN_REASON_LENGTH) return err(reasonRequired("un constat manuel"));
  return inTx<HoldResult>(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const occ = await occRepo.getOccurrence(tx, input.occurrenceId, { forUpdate: true });
    if (!occ) return err(notFoundOccurrence(input.occurrenceId));
    const staff = (await occRepo.listStaffByOccurrence(tx, [occ.id])).get(occ.id) ?? [];
    if (occ.status === "HELD") return ok({ occurrence: await reload(tx, occ.id), alreadyHeld: true, ignoredCancelled: false, warnings: [] });
    if (occ.status === "CANCELLED") {
      if (input.source === "ATTENDANCE") return ok({ occurrence: await reload(tx, occ.id), alreadyHeld: false, ignoredCancelled: true, warnings: [] });
      return err(occurrenceCancelled());
    }
    const now = deps.clock.now();
    if (input.source === "ADMIN" && occ.startsAt.getTime() > now.getTime()) {
      return err(validation("occurrenceId", "Une séance qui n'a pas encore commencé ne peut pas être constatée.", "hold_future"));
    }
    if (nextStatus(occ.status, "HELD") === null) return err(invalidTransition(occ.status, "HELD"));

    const warnings: HoldResult["warnings"] = [];
    if (input.source === "ADMIN" && ctx.userId && deps.ports.people && staff.length > 0) {
      const mine = await deps.ports.people.resolveStaffForUser(ctx, ctx.userId);
      if (mine && !staff.some((s) => s.staffId === mine)) warnings.push("NON_PARTICIPANT_HELD");
    }

    await setChangeReason(tx, reason || (input.source === "ATTENDANCE" ? "Appel soumis" : null));
    await occRepo.markHeld(tx, occ.id, input.source, ctx.userId, now);
    await setChangeReason(tx, null);
    const detail = await reload(tx, occ.id);
    buf.add(SchedulingEvents.occurrenceHeld, occurrenceEventPayload(detail, staffIdsOf(staff), { source: input.source, heldByNonParticipant: warnings.length > 0 }), { type: OCCURRENCE_AGGREGATE, id: occ.id });
    await buf.flush(tx);
    return ok({ occurrence: detail, alreadyHeld: false, ignoredCancelled: false, warnings });
  });
}

export async function unholdOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceId: string; reason: string }): Promise<Result<OccurrenceDetail, AppError>> {
  const reason = trimReason(input.reason);
  if (reason.length < MIN_REASON_LENGTH) return err(reasonRequired("annuler un constat"));
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const loaded = await loadForUpdate(tx, input.occurrenceId);
    if (!loaded.ok) return loaded;
    const { occ, staff } = loaded.value;
    if (nextStatus(occ.status, "UNHELD") === null) return err(invalidTransition(occ.status, "PLANNED"));
    await setChangeReason(tx, reason);
    await occRepo.markUnheld(tx, occ.id, deps.clock.now());
    await setChangeReason(tx, null);
    const detail = await reload(tx, occ.id);
    buf.add(SchedulingEvents.occurrenceUnheld, occurrenceEventPayload(detail, staffIdsOf(staff), { reason }), { type: OCCURRENCE_AGGREGATE, id: occ.id });
    await buf.flush(tx);
    return ok(detail);
  });
}

export interface CancelResult {
  occurrence: OccurrenceDetail;
  alreadyCancelled: boolean;
}

export async function cancelOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceId: string; reason: string }): Promise<Result<CancelResult, AppError>> {
  const reason = trimReason(input.reason);
  if (reason.length < MIN_REASON_LENGTH) return err(reasonRequired("annuler une séance"));
  return inTx<CancelResult>(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const loaded = await loadForUpdate(tx, input.occurrenceId, { allowCancelled: true });
    if (!loaded.ok) return loaded;
    const { occ, staff } = loaded.value;
    if (occ.status === "CANCELLED") return ok({ occurrence: await reload(tx, occ.id), alreadyCancelled: true });
    await setChangeReason(tx, reason);
    await occRepo.markCancelled(tx, occ.id, reason, deps.clock.now());
    await setChangeReason(tx, null);
    const detail = await reload(tx, occ.id);
    buf.add(SchedulingEvents.occurrenceCancelled, occurrenceEventPayload(detail, staffIdsOf(staff), { reason }), { type: OCCURRENCE_AGGREGATE, id: occ.id });
    buf.audit({ action: "scheduling.occurrence.cancelled", resourceType: "occurrence", resourceId: occ.id, reason, metadata: { wasHeld: occ.status === "HELD" } });
    await buf.flush(tx);
    return ok({ occurrence: detail, alreadyCancelled: false });
  });
}

export async function restoreOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceId: string; reason?: string | undefined; override?: OverrideInput | undefined }): Promise<Result<OccurrenceResult, AppError>> {
  const overrideReason = requireOverrideReason(input.override);
  if (!overrideReason.ok) return overrideReason;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const loaded = await loadForUpdate(tx, input.occurrenceId, { allowCancelled: true });
    if (!loaded.ok) return loaded;
    const { occ, staff } = loaded.value;
    if (nextStatus(occ.status, "RESTORED") === null) return err(invalidTransition(occ.status, "PLANNED"));
    // La restauration réserve de nouveau les ressources : contrôle de conflit complet.
    const placement = await placementFromOccurrence(deps, ctx, occ, staff, {
      override: occ.conflictOverride || overrideReason.value !== null,
      equipment: ((await occRepo.listEquipmentByOccurrence(tx, [occ.id])).get(occ.id) ?? []),
    });
    await lockResources(tx, ctx, resourcesOfPlacement(placement));
    const evaluation = await evaluatePlacement(deps, ctx, tx, placement);
    if (evaluation.blocking) return err(conflictDetected(evaluation.conflicts));
    const now = deps.clock.now();
    await setChangeReason(tx, trimReason(input.reason) || "Séance restaurée");
    if (overrideReason.value !== null && !occ.conflictOverride) await occRepo.setOverride(tx, occ.id, overrideReason.value, ctx.userId as string, now);
    await occRepo.markRestored(tx, occ.id, now);
    await setChangeReason(tx, null);
    const detail = await reload(tx, occ.id);
    buf.add(SchedulingEvents.occurrenceRestored, occurrenceEventPayload(detail, staffIdsOf(staff)), { type: OCCURRENCE_AGGREGATE, id: occ.id });
    if (overrideReason.value !== null && !occ.conflictOverride) {
      buf.add(SchedulingEvents.conflictOverridden, { v: 1, occurrenceId: occ.id, reason: overrideReason.value }, { type: OCCURRENCE_AGGREGATE, id: occ.id });
      buf.audit({ action: "scheduling.conflict.overridden", resourceType: "occurrence", resourceId: occ.id, sensitive: true, reason: overrideReason.value });
    }
    await buf.flush(tx);
    return ok({ occurrence: detail, warnings: evaluation.conflicts });
  });
}

/**
 * Dépassement motivé d'un conflit bloquant pour une séance (AC1.5). Permission sensible
 * (`schedule.conflict.override`, contrôlée par la route) ; journalisé (`OVERRIDE`) et publié.
 */
export async function overrideConflict(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceId: string; reason: string }): Promise<Result<OccurrenceDetail, AppError>> {
  const reason = requireOverrideReason({ reason: input.reason });
  if (!reason.ok) return reason;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const loaded = await loadForUpdate(tx, input.occurrenceId);
    if (!loaded.ok) return loaded;
    const { occ, staff } = loaded.value;
    if (occ.conflictOverride) return ok(await reload(tx, occ.id));
    await lockResources(tx, ctx, [
      ...staff.map((s) => ({ kind: "STAFF" as const, id: s.staffId })),
      ...(classroomKeyOf(occ) ? [{ kind: "CLASSROOM" as const, id: classroomKeyOf(occ) as string }] : []),
      ...(occ.roomId ? [{ kind: "ROOM" as const, id: occ.roomId }] : []),
    ]);
    await occRepo.setOverride(tx, occ.id, reason.value as string, ctx.userId as string, deps.clock.now());
    const detail = await reload(tx, occ.id);
    buf.add(SchedulingEvents.conflictOverridden, { v: 1, occurrenceId: occ.id, reason: reason.value }, { type: OCCURRENCE_AGGREGATE, id: occ.id });
    buf.audit({ action: "scheduling.conflict.overridden", resourceType: "occurrence", resourceId: occ.id, sensitive: true, reason: reason.value as string });
    await buf.flush(tx);
    return ok(detail);
  });
}

/** Informations descriptives modifiables sans impact sur les ressources. */
export async function updateOccurrenceDetails(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { occurrenceId: string; title?: string | null | undefined; notes?: string | null | undefined; locationLabel?: string | null | undefined; deliveryMode?: DeliveryMode | undefined; virtualSessionRef?: string | null | undefined },
): Promise<Result<OccurrenceDetail, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const occ = await occRepo.getOccurrence(tx, input.occurrenceId, { forUpdate: true });
    if (!occ) return err(notFoundOccurrence(input.occurrenceId));
    const { occurrenceId: _id, ...patch } = input;
    await occRepo.updateDescriptive(tx, occ.id, patch, deps.clock.now());
    return ok(await reload(tx, occ.id));
  });
}
