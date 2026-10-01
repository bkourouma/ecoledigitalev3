/**
 * Paramétrage : salles, équipements (stock), grille horaire, calendrier de l'établissement (plages),
 * politiques de conflit, paramètres (fuseau, ouverture, quatre yeux), types de salle et d'événement.
 *
 * Aucun jour férié, créneau, amplitude ni volume n'est codé : tout est donnée d'établissement (R13).
 */
import { NotFoundError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { SchedulingCodes, notFound } from "../domain/errors";
import { SchedulingEvents } from "../domain/events";
import { isIsoDate, parseTimeOfDay, assertTimeZone } from "../domain/time";
import {
  AUDIENCES,
  RESOURCE_KINDS,
  type Audience,
  type CalendarEvent,
  type ConflictMode,
  type EquipmentItem,
  type ResourceKind,
  type ResourceStatus,
  type Room,
  type SchedulingSettings,
  type TimeSlot,
} from "../domain/types";
import * as occRepo from "../infrastructure/occurrence-repo";
import * as ref from "../infrastructure/reference-repo";
import { DEFAULT_EVENT_KINDS, DEFAULT_ROOM_TYPES } from "../templates/reference-defaults";
import { EventBuffer, inTx, type SchedulingDeps } from "./deps";
import { OCCURRENCE_AGGREGATE, loadSettings, trimReason, validation } from "./support";

const CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{0,39}$/;
const normalizeCode = (code: string): string => code.trim().toUpperCase();

// ---------------------------------------------------------------------------
// Types de salle, types d'événement
// ---------------------------------------------------------------------------

export function listRoomTypes(deps: SchedulingDeps, ctx: RequestContext): Promise<Result<ref.CodeLabel[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await ref.listRoomTypes(tx)), { readOnly: true });
}

export async function upsertRoomType(deps: SchedulingDeps, ctx: RequestContext, input: { code: string; label: string; active?: boolean | undefined }): Promise<Result<ref.CodeLabel, AppError>> {
  const code = normalizeCode(input.code);
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(code)) return err(validation("code", "Code invalide (majuscules, chiffres et _, 40 caractères au plus).", "invalid_code"));
  if (input.label.trim().length === 0) return err(validation("label", "Le libellé est requis.", "required"));
  return inTx(deps, ctx, async (tx) => ok(await ref.upsertRoomType(tx, ctx.tenantId, deps.newId(), code, input.label.trim(), input.active ?? true, deps.clock.now())));
}

export function listEventKinds(deps: SchedulingDeps, ctx: RequestContext): Promise<Result<ref.EventKind[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await ref.listEventKinds(tx)), { readOnly: true });
}

export async function upsertEventKind(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { code: string; label: string; blocksTeachingDefault?: boolean | undefined; active?: boolean | undefined },
): Promise<Result<ref.EventKind, AppError>> {
  const code = normalizeCode(input.code);
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(code)) return err(validation("code", "Code invalide (majuscules, chiffres et _, 40 caractères au plus).", "invalid_code"));
  if (input.label.trim().length === 0) return err(validation("label", "Le libellé est requis.", "required"));
  return inTx(deps, ctx, async (tx) =>
    ok(await ref.upsertEventKind(tx, ctx.tenantId, deps.newId(), code, input.label.trim(), input.blocksTeachingDefault ?? false, input.active ?? true, deps.clock.now())),
  );
}

/** Amorçage idempotent des référentiels de pack (types de salle, types d'événement). Rejouable à volonté. */
export async function seedReferenceData(tx: Tx, tenantId: string, deps: Pick<SchedulingDeps, "clock" | "newId">): Promise<{ roomTypes: number; eventKinds: number }> {
  const now = deps.clock.now();
  const existingRooms = new Set((await ref.listRoomTypes(tx)).map((r) => r.code));
  const existingKinds = new Set((await ref.listEventKinds(tx)).map((k) => k.code));
  let roomTypes = 0;
  let eventKinds = 0;
  for (const t of DEFAULT_ROOM_TYPES) {
    if (existingRooms.has(t.code)) continue; // l'établissement a pu les renommer : on n'écrase jamais
    await ref.upsertRoomType(tx, tenantId, deps.newId(), t.code, t.label, true, now);
    roomTypes += 1;
  }
  for (const k of DEFAULT_EVENT_KINDS) {
    if (existingKinds.has(k.code)) continue;
    await ref.upsertEventKind(tx, tenantId, deps.newId(), k.code, k.label, k.blocksTeaching, true, now);
    eventKinds += 1;
  }
  return { roomTypes, eventKinds };
}

export function seedReference(deps: SchedulingDeps, ctx: RequestContext): Promise<Result<{ roomTypes: number; eventKinds: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await seedReferenceData(tx, ctx.tenantId, deps)));
}

// ---------------------------------------------------------------------------
// Salles
// ---------------------------------------------------------------------------

export interface RoomInput {
  institutionId: string;
  campusId: string;
  code: string;
  name: string;
  roomTypeCode: string;
  capacity?: number | null | undefined;
  building?: string | null | undefined;
  floorLabel?: string | null | undefined;
  features?: string[] | undefined;
  notes?: string | null | undefined;
}

export async function createRoom(deps: SchedulingDeps, ctx: RequestContext, input: RoomInput): Promise<Result<Room, AppError>> {
  const code = normalizeCode(input.code);
  if (!CODE_RE.test(code)) return err(validation("code", "Code invalide (lettres, chiffres, . _ -).", "invalid_code"));
  if (input.name.trim().length === 0) return err(validation("name", "Le nom est requis.", "required"));
  if (input.capacity != null && (!Number.isInteger(input.capacity) || input.capacity < 1)) return err(validation("capacity", "La capacité est un entier ≥ 1.", "invalid_capacity"));
  return inTx(deps, ctx, async (tx) => {
    if (!(await ref.roomTypeExists(tx, input.roomTypeCode))) return err(validation("roomTypeCode", `Type de salle inconnu ou inactif : ${input.roomTypeCode}.`, "unknown_room_type"));
    const room = await ref.insertRoom(
      tx,
      ctx.tenantId,
      { id: deps.newId(), institutionId: input.institutionId, campusId: input.campusId, code, name: input.name.trim(), roomTypeCode: input.roomTypeCode, capacity: input.capacity ?? null, building: input.building ?? null, floorLabel: input.floorLabel ?? null, features: input.features ?? [], notes: input.notes ?? null },
      deps.clock.now(),
    );
    return ok(room);
  });
}

export async function updateRoom(deps: SchedulingDeps, ctx: RequestContext, input: { roomId: string } & Partial<Omit<RoomInput, "institutionId" | "campusId" | "code">>): Promise<Result<Room, AppError>> {
  if (input.capacity != null && (!Number.isInteger(input.capacity) || input.capacity < 1)) return err(validation("capacity", "La capacité est un entier ≥ 1.", "invalid_capacity"));
  return inTx(deps, ctx, async (tx) => {
    if (input.roomTypeCode && !(await ref.roomTypeExists(tx, input.roomTypeCode))) return err(validation("roomTypeCode", `Type de salle inconnu ou inactif : ${input.roomTypeCode}.`, "unknown_room_type"));
    const patch: Parameters<typeof ref.updateRoom>[2] = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.roomTypeCode !== undefined) patch.roomTypeCode = input.roomTypeCode;
    if (input.capacity !== undefined) patch.capacity = input.capacity;
    if (input.building !== undefined) patch.building = input.building;
    if (input.floorLabel !== undefined) patch.floorLabel = input.floorLabel;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.features !== undefined) patch.features = input.features;
    const room = await ref.updateRoom(tx, input.roomId, patch, deps.clock.now());
    return room ? ok(room) : err(notFound("Salle", input.roomId));
  });
}

export function listRooms(deps: SchedulingDeps, ctx: RequestContext, filter: ref.RoomFilter): Promise<Result<Room[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await ref.listRooms(tx, filter)), { readOnly: true });
}

export function getRoom(deps: SchedulingDeps, ctx: RequestContext, input: { roomId: string }): Promise<Result<Room, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const room = await ref.getRoom(tx, input.roomId);
    return room ? ok(room) : err(notFound("Salle", input.roomId));
  }, { readOnly: true });
}

export interface FlaggedOccurrence {
  occurrenceId: string;
  occursOn: string;
}

/**
 * Changement de statut d'une salle (AC1.7). Hors service ou archivée : elle n'est plus réservable (la base
 * refuse toute NOUVELLE affectation) et les séances futures déjà affectées sont SIGNALÉES « à remplacer »
 * (événement `replacement_needed`, raison `room_unavailable`), jamais annulées automatiquement.
 */
export async function setRoomStatus(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { roomId: string; status: ResourceStatus; reason?: string | undefined },
): Promise<Result<{ room: Room; flagged: FlaggedOccurrence[]; cleared: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const room = await ref.getRoom(tx, input.roomId, true);
    if (!room) return err(notFound("Salle", input.roomId));
    const now = deps.clock.now();
    if (room.status === input.status) return ok({ room, flagged: [], cleared: 0 });
    await ref.setRoomStatus(tx, room.id, input.status, now);
    let flagged: FlaggedOccurrence[] = [];
    let cleared = 0;
    if (input.status !== "AVAILABLE") {
      const rows = await tx.many<{ id: string; occurs_on: string }>(
        `SELECT id, occurs_on::text AS occurs_on FROM scheduling.session_occurrences
          WHERE tenant_id = kernel.current_tenant_id() AND room_id = $1 AND status = 'PLANNED' AND validated_at IS NULL AND starts_at > $2::timestamptz AND NOT needs_replacement
          ORDER BY starts_at, id FOR UPDATE`,
        [room.id, now],
      );
      flagged = rows.map((r) => ({ occurrenceId: r.id, occursOn: r.occurs_on }));
      await occRepo.setNeedsReplacement(tx, flagged.map((f) => f.occurrenceId), "ROOM_UNAVAILABLE", now);
      for (const f of flagged) {
        buf.add(SchedulingEvents.occurrenceReplacementNeeded, { v: 1, occurrenceId: f.occurrenceId, reason: "room_unavailable", roomId: room.id, occursOn: f.occursOn }, { type: OCCURRENCE_AGGREGATE, id: f.occurrenceId });
      }
    } else {
      const rows = await tx.many<{ id: string }>(
        `SELECT id FROM scheduling.session_occurrences WHERE tenant_id = kernel.current_tenant_id() AND room_id = $1 AND needs_replacement AND replacement_reason = 'ROOM_UNAVAILABLE' FOR UPDATE`,
        [room.id],
      );
      cleared = await occRepo.setNeedsReplacement(tx, rows.map((r) => r.id), null, now);
    }
    buf.audit({ action: "scheduling.room.status_changed", resourceType: "room", resourceId: room.id, ...(trimReason(input.reason) ? { reason: trimReason(input.reason) } : {}), before: { status: room.status }, after: { status: input.status }, metadata: { flagged: flagged.length } });
    await buf.flush(tx);
    return ok({ room: { ...room, status: input.status }, flagged, cleared });
  });
}

// ---------------------------------------------------------------------------
// Équipements
// ---------------------------------------------------------------------------

export async function createEquipmentItem(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { institutionId: string; campusId: string; code: string; label: string; quantity: number },
): Promise<Result<EquipmentItem, AppError>> {
  const code = normalizeCode(input.code);
  if (!CODE_RE.test(code)) return err(validation("code", "Code invalide (lettres, chiffres, . _ -).", "invalid_code"));
  if (input.label.trim().length === 0) return err(validation("label", "Le libellé est requis.", "required"));
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return err(validation("quantity", "Le stock est un entier ≥ 1.", "invalid_quantity"));
  return inTx(deps, ctx, async (tx) => ok(await ref.insertEquipment(tx, ctx.tenantId, { id: deps.newId(), institutionId: input.institutionId, campusId: input.campusId, code, label: input.label.trim(), quantity: input.quantity }, deps.clock.now())));
}

export interface OverbookedOccurrence {
  occurrenceId: string;
  startsAt: Date;
  requested: number;
}

/**
 * Mise à jour d'un équipement. Réduire le stock ou le mettre hors service ne casse rien en base (le
 * contrôle porte sur les NOUVELLES réservations) : les séances futures désormais en dépassement sont
 * SIGNALÉES dans le retour (cas limite « stock réduit sous des réservations existantes »).
 */
export async function updateEquipmentItem(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { equipmentId: string; label?: string | undefined; quantity?: number | undefined; status?: ResourceStatus | undefined },
): Promise<Result<{ item: EquipmentItem; overbooked: OverbookedOccurrence[] }, AppError>> {
  if (input.quantity !== undefined && (!Number.isInteger(input.quantity) || input.quantity < 1)) return err(validation("quantity", "Le stock est un entier ≥ 1.", "invalid_quantity"));
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const before = await ref.getEquipment(tx, input.equipmentId);
    if (!before) return err(notFound("Équipement", input.equipmentId));
    const patch: Parameters<typeof ref.updateEquipment>[2] = {};
    if (input.label !== undefined) patch.label = input.label.trim();
    if (input.quantity !== undefined) patch.quantity = input.quantity;
    if (input.status !== undefined) patch.status = input.status;
    const item = (await ref.updateEquipment(tx, input.equipmentId, patch, deps.clock.now())) as EquipmentItem;
    let overbooked: OverbookedOccurrence[] = [];
    if ((input.quantity !== undefined && input.quantity < before.quantity) || (input.status !== undefined && input.status !== "AVAILABLE")) {
      const stock = item.status === "AVAILABLE" ? item.quantity : 0;
      const rows = await tx.many<{ id: string; starts_at: Date; qty: number }>(
        `SELECT o.id, o.starts_at, e.quantity AS qty
           FROM scheduling.occurrence_equipment e
           JOIN scheduling.session_occurrences o ON o.tenant_id = e.tenant_id AND o.id = e.occurrence_id
          WHERE e.tenant_id = kernel.current_tenant_id() AND e.equipment_id = $1 AND o.status <> 'CANCELLED' AND o.ends_at > $2::timestamptz
            AND (SELECT coalesce(sum(e2.quantity), 0) FROM scheduling.occurrence_equipment e2
                   JOIN scheduling.session_occurrences o2 ON o2.tenant_id = e2.tenant_id AND o2.id = e2.occurrence_id
                  WHERE e2.tenant_id = e.tenant_id AND e2.equipment_id = e.equipment_id AND o2.status <> 'CANCELLED' AND o2.during && o.during) > $3
          ORDER BY o.starts_at, o.id`,
        [item.id, deps.clock.now(), stock],
      );
      overbooked = rows.map((r) => ({ occurrenceId: r.id, startsAt: r.starts_at, requested: r.qty }));
    }
    buf.audit({ action: "scheduling.equipment.updated", resourceType: "equipment", resourceId: item.id, before: { quantity: before.quantity, status: before.status }, after: { quantity: item.quantity, status: item.status }, metadata: { overbooked: overbooked.length } });
    await buf.flush(tx);
    return ok({ item, overbooked });
  });
}

export function listEquipmentItems(deps: SchedulingDeps, ctx: RequestContext, filter: { institutionId?: string; campusId?: string; status?: ResourceStatus }): Promise<Result<EquipmentItem[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await ref.listEquipment(tx, filter)), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Grille horaire
// ---------------------------------------------------------------------------

export interface TimeSlotInput {
  institutionId: string;
  campusId?: string | null | undefined;
  code: string;
  label: string;
  startsTime: string;
  endsTime: string;
  isBreak?: boolean | undefined;
  ordinal?: number | undefined;
  active?: boolean | undefined;
}

export async function upsertTimeSlot(deps: SchedulingDeps, ctx: RequestContext, input: TimeSlotInput): Promise<Result<TimeSlot, AppError>> {
  const code = normalizeCode(input.code);
  if (!CODE_RE.test(code)) return err(validation("code", "Code invalide (lettres, chiffres, . _ -).", "invalid_code"));
  try {
    if (parseTimeOfDay(input.endsTime) <= parseTimeOfDay(input.startsTime)) return err(validation("endsTime", "La fin du créneau doit être postérieure à son début.", "invalid_range"));
  } catch (e) {
    return err(validation("startsTime", e instanceof Error ? e.message : "Heure invalide.", "invalid_time"));
  }
  return inTx(deps, ctx, async (tx) =>
    ok(
      await ref.upsertTimeSlot(
        tx,
        ctx.tenantId,
        { id: deps.newId(), institutionId: input.institutionId, campusId: input.campusId ?? null, code, label: input.label.trim(), startsTime: input.startsTime, endsTime: input.endsTime, isBreak: input.isBreak ?? false, ordinal: input.ordinal ?? 0, active: input.active ?? true },
        deps.clock.now(),
      ),
    ),
  );
}

export function deactivateTimeSlot(deps: SchedulingDeps, ctx: RequestContext, input: { timeSlotId: string }): Promise<Result<TimeSlot, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const slot = await ref.deactivateTimeSlot(tx, input.timeSlotId, deps.clock.now());
    return slot ? ok(slot) : err(notFound("Créneau horaire", input.timeSlotId));
  });
}

export function listTimeSlots(deps: SchedulingDeps, ctx: RequestContext, filter: { institutionId?: string; campusId?: string | null; activeOnly?: boolean }): Promise<Result<TimeSlot[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await ref.listTimeSlots(tx, filter)), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Calendrier de l'établissement (plages)
// ---------------------------------------------------------------------------

export interface CalendarEventInput {
  institutionId: string;
  campusId?: string | null | undefined;
  academicYearId?: string | null | undefined;
  kindCode: string;
  title: string;
  description?: string | null | undefined;
  startsOn: string;
  endsOn: string;
  startsTime?: string | null | undefined;
  endsTime?: string | null | undefined;
  /** Défaut : celui du type d'événement. */
  blocksTeaching?: boolean | undefined;
  audience?: Audience[] | undefined;
}

export interface CalendarEventResult {
  event: CalendarEvent;
  /** Séances PLANNED non constatées déjà datées sur une plage bloquante : signalées, jamais annulées (R11). */
  affectedOccurrences: FlaggedOccurrence[];
  /** Événements de même titre et même plage déjà saisis (avertissement de doublon, Q7). */
  duplicates: string[];
}

function validateEventShape(i: Pick<CalendarEventInput, "startsOn" | "endsOn" | "startsTime" | "endsTime" | "audience" | "title">): AppError | null {
  if (i.title.trim().length === 0) return validation("title", "Le titre est requis.", "required");
  if (!isIsoDate(i.startsOn) || !isIsoDate(i.endsOn)) return validation("startsOn", "Dates invalides (AAAA-MM-JJ).", "invalid_date");
  if (i.endsOn < i.startsOn) return validation("endsOn", "La fin de l'événement précède son début.", "invalid_range");
  if ((i.startsTime == null) !== (i.endsTime == null)) return validation("startsTime", "Les heures de début et de fin vont ensemble.", "times_together");
  if (i.startsTime != null && i.endsTime != null) {
    try {
      if (parseTimeOfDay(i.endsTime) <= parseTimeOfDay(i.startsTime)) return validation("endsTime", "L'heure de fin doit être postérieure à l'heure de début.", "invalid_range");
    } catch (e) {
      return validation("startsTime", e instanceof Error ? e.message : "Heure invalide.", "invalid_time");
    }
  }
  for (const a of i.audience ?? []) if (!AUDIENCES.includes(a)) return validation("audience", `Audience inconnue : ${a}.`, "invalid_audience");
  return null;
}

async function flagBlocked(deps: SchedulingDeps, tx: Tx, buf: EventBuffer, ev: CalendarEvent): Promise<FlaggedOccurrence[]> {
  if (!ev.blocksTeaching) return [];
  const rows = await ref.plannedOccurrencesInRange(tx, ev.institutionId, ev.startsOn, ev.endsOn, ev.campusId);
  if (rows.length > 0) {
    buf.add(
      SchedulingEvents.calendarBlockingOverlap,
      { v: 1, calendarEventId: ev.id, title: ev.title, startsOn: ev.startsOn, endsOn: ev.endsOn, count: rows.length, occurrenceIds: rows.slice(0, 500).map((r) => r.id) },
      { type: "calendar_event", id: ev.id },
    );
  }
  void deps;
  return rows.map((r) => ({ occurrenceId: r.id, occursOn: r.occursOn }));
}

export async function createCalendarEvent(deps: SchedulingDeps, ctx: RequestContext, input: CalendarEventInput): Promise<Result<CalendarEventResult, AppError>> {
  const bad = validateEventShape(input);
  if (bad) return err(bad);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const kind = await ref.getEventKind(tx, input.kindCode);
    if (!kind || !kind.active) return err(validation("kindCode", `Type d'événement inconnu ou inactif : ${input.kindCode}.`, "unknown_kind"));
    const duplicates = await ref.findDuplicateEvents(tx, input.institutionId, input.title.trim(), input.startsOn, input.endsOn, null);
    const event = await ref.insertCalendarEvent(
      tx,
      ctx.tenantId,
      {
        id: deps.newId(),
        institutionId: input.institutionId,
        campusId: input.campusId ?? null,
        academicYearId: input.academicYearId ?? null,
        kindCode: input.kindCode,
        title: input.title.trim(),
        description: input.description ?? null,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        startsTime: input.startsTime ?? null,
        endsTime: input.endsTime ?? null,
        blocksTeaching: input.blocksTeaching ?? kind.blocksTeachingDefault,
        audience: input.audience ?? [...AUDIENCES],
      },
      ctx.userId,
      deps.clock.now(),
    );
    buf.add(SchedulingEvents.calendarEventCreated, { v: 1, calendarEventId: event.id, kindCode: event.kindCode, startsOn: event.startsOn, endsOn: event.endsOn, blocksTeaching: event.blocksTeaching, audience: event.audience }, { type: "calendar_event", id: event.id });
    const affectedOccurrences = await flagBlocked(deps, tx, buf, event);
    await buf.flush(tx);
    return ok({ event, affectedOccurrences, duplicates });
  });
}

export async function updateCalendarEvent(deps: SchedulingDeps, ctx: RequestContext, input: Omit<CalendarEventInput, "institutionId"> & { eventId: string }): Promise<Result<CalendarEventResult, AppError>> {
  const bad = validateEventShape(input);
  if (bad) return err(bad);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const before = await ref.getCalendarEvent(tx, input.eventId);
    if (!before) return err(notFound("Événement", input.eventId));
    const kind = await ref.getEventKind(tx, input.kindCode);
    if (!kind || !kind.active) return err(validation("kindCode", `Type d'événement inconnu ou inactif : ${input.kindCode}.`, "unknown_kind"));
    const duplicates = await ref.findDuplicateEvents(tx, before.institutionId, input.title.trim(), input.startsOn, input.endsOn, before.id);
    const event = (await ref.updateCalendarEvent(
      tx,
      before.id,
      {
        campusId: input.campusId ?? null,
        academicYearId: input.academicYearId ?? null,
        kindCode: input.kindCode,
        title: input.title.trim(),
        description: input.description ?? null,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        startsTime: input.startsTime ?? null,
        endsTime: input.endsTime ?? null,
        blocksTeaching: input.blocksTeaching ?? kind.blocksTeachingDefault,
        audience: input.audience ?? [...AUDIENCES],
      },
      deps.clock.now(),
    )) as CalendarEvent;
    buf.add(SchedulingEvents.calendarEventUpdated, { v: 1, calendarEventId: event.id, kindCode: event.kindCode, startsOn: event.startsOn, endsOn: event.endsOn, blocksTeaching: event.blocksTeaching, audience: event.audience }, { type: "calendar_event", id: event.id });
    const affectedOccurrences = await flagBlocked(deps, tx, buf, event);
    await buf.flush(tx);
    return ok({ event, affectedOccurrences, duplicates });
  });
}

export function deleteCalendarEvent(deps: SchedulingDeps, ctx: RequestContext, input: { eventId: string }): Promise<Result<{ deleted: true }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const existing = await ref.getCalendarEvent(tx, input.eventId);
    if (!existing) return err(notFound("Événement", input.eventId));
    await ref.deleteCalendarEvent(tx, input.eventId);
    buf.add(SchedulingEvents.calendarEventDeleted, { v: 1, calendarEventId: existing.id, kindCode: existing.kindCode, startsOn: existing.startsOn, endsOn: existing.endsOn, blocksTeaching: existing.blocksTeaching }, { type: "calendar_event", id: existing.id });
    await buf.flush(tx);
    return ok({ deleted: true as const });
  });
}

export function listCalendarEvents(
  deps: SchedulingDeps,
  ctx: RequestContext,
  filter: { institutionId?: string; campusId?: string | null; from?: string; to?: string; blocksTeachingOnly?: boolean; audience?: Audience },
): Promise<Result<CalendarEvent[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await ref.listCalendarEvents(tx, filter)), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Politiques de conflit, paramètres
// ---------------------------------------------------------------------------

export async function upsertConflictPolicy(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { institutionId: string; resourceKind: ResourceKind; mode: ConflictMode },
): Promise<Result<Record<ResourceKind, ConflictMode>, AppError>> {
  if (!RESOURCE_KINDS.includes(input.resourceKind)) return err(validation("resourceKind", "Ressource inconnue.", "invalid_resource"));
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const before = await ref.getPolicies(tx, input.institutionId);
    await ref.upsertPolicy(tx, ctx.tenantId, input.institutionId, input.resourceKind, input.mode, deps.clock.now());
    buf.audit({
      action: "scheduling.conflict_policy.changed",
      resourceType: "conflict_policy",
      resourceId: `${input.institutionId}:${input.resourceKind}`,
      sensitive: true,
      before: { mode: before[input.resourceKind] },
      after: { mode: input.mode },
      metadata: { note: "S'applique aux séances créées ou modifiées ensuite ; les réservations existantes gardent leur exclusivité." },
    });
    await buf.flush(tx);
    return ok(await ref.getPolicies(tx, input.institutionId));
  });
}

export function getConflictPolicies(deps: SchedulingDeps, ctx: RequestContext, input: { institutionId: string }): Promise<Result<Record<ResourceKind, ConflictMode>, AppError>> {
  return inTx(deps, ctx, async (tx) => ok({ ...(await ref.getPolicies(tx, input.institutionId)) }), { readOnly: true });
}

export function getSchedulingSettings(deps: SchedulingDeps, ctx: RequestContext, input: { institutionId: string }): Promise<Result<SchedulingSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await loadSettings(tx, input.institutionId)), { readOnly: true });
}

export type SettingsPatch = Partial<Omit<SchedulingSettings, "institutionId">>;

export async function updateSchedulingSettings(deps: SchedulingDeps, ctx: RequestContext, input: { institutionId: string; patch: SettingsPatch }): Promise<Result<SchedulingSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const before = await loadSettings(tx, input.institutionId);
    const next: SchedulingSettings = { ...before, ...stripUndefined(input.patch), institutionId: input.institutionId };
    try {
      assertTimeZone(next.timezone);
      if ((next.openingStart === null) !== (next.openingEnd === null)) return err(validation("openingStart", "Les heures d'ouverture vont ensemble (début et fin).", "opening_together"));
      if (next.openingStart !== null && next.openingEnd !== null && parseTimeOfDay(next.openingEnd) <= parseTimeOfDay(next.openingStart)) {
        return err(validation("openingEnd", "La fermeture doit être postérieure à l'ouverture.", "invalid_range"));
      }
    } catch (e) {
      return err(validation("timezone", e instanceof Error ? e.message : "Valeur invalide.", "invalid"));
    }
    if (next.openingWeekdays && next.openingWeekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return err(validation("openingWeekdays", "Jours ISO de 1 à 7.", "invalid_weekdays"));
    if (!Number.isInteger(next.maxGenerationWeeks) || next.maxGenerationWeeks < 1 || next.maxGenerationWeeks > 120) return err(validation("maxGenerationWeeks", "Entre 1 et 120 semaines.", "invalid_weeks"));
    if (!Number.isInteger(next.generationHorizonWeeks) || next.generationHorizonWeeks < 1 || next.generationHorizonWeeks > next.maxGenerationWeeks) {
      return err(validation("generationHorizonWeeks", "L'horizon de génération va de 1 semaine au garde-fou maximal.", "invalid_weeks"));
    }
    const saved = await ref.upsertSettings(tx, ctx.tenantId, next, deps.clock.now());
    buf.audit({
      action: "scheduling.settings.updated",
      resourceType: "settings",
      resourceId: input.institutionId,
      sensitive: before.allowSelfValidation !== saved.allowSelfValidation || before.supervisorsPaid !== saved.supervisorsPaid,
      before,
      after: saved,
    });
    await buf.flush(tx);
    return ok(saved);
  });
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

void NotFoundError;
void SchedulingCodes;
