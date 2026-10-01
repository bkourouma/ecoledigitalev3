/**
 * Accès SQL aux référentiels : paramètres, politiques de conflit, types de salle et de calendrier,
 * salles, équipements, grille horaire, calendrier de l'établissement.
 */
import type { Tx } from "@ecoledigitale/database";
import {
  DEFAULT_CONFLICT_POLICIES,
  type Audience,
  type AvailabilityMode,
  type CalendarEvent,
  type ConflictMode,
  type ConflictPolicies,
  type EquipmentItem,
  type ResourceKind,
  type ResourceStatus,
  type Room,
  type SchedulingSettings,
  type TimeSlot,
} from "../domain/types";

// ---------------------------------------------------------------------------
// Paramètres et politiques
// ---------------------------------------------------------------------------

const SETTINGS_COLUMNS = `institution_id, timezone, staff_availability_mode, max_generation_weeks, generation_horizon_weeks, allow_self_validation,
  supervisors_paid, opening_start::text AS opening_start, opening_end::text AS opening_end, opening_weekdays`;

function mapSettings(r: Record<string, any>): SchedulingSettings {
  return {
    institutionId: r.institution_id,
    timezone: r.timezone,
    staffAvailabilityMode: r.staff_availability_mode as AvailabilityMode,
    maxGenerationWeeks: r.max_generation_weeks,
    generationHorizonWeeks: r.generation_horizon_weeks,
    allowSelfValidation: r.allow_self_validation,
    supervisorsPaid: r.supervisors_paid,
    openingStart: r.opening_start ? String(r.opening_start).slice(0, 5) : null,
    openingEnd: r.opening_end ? String(r.opening_end).slice(0, 5) : null,
    openingWeekdays: r.opening_weekdays ? (r.opening_weekdays as number[]).map(Number) : null,
  };
}

export const DEFAULT_SETTINGS = (institutionId: string, timezone: string): SchedulingSettings => ({
  institutionId,
  timezone,
  staffAvailabilityMode: "OPEN",
  maxGenerationWeeks: 60,
  generationHorizonWeeks: 6,
  allowSelfValidation: false,
  supervisorsPaid: false,
  openingStart: null,
  openingEnd: null,
  openingWeekdays: null,
});

/** Paramètres de l'établissement ; à défaut de ligne, les valeurs par défaut du module (fuseau fourni par l'appelant). */
export async function getSettings(tx: Tx, institutionId: string, defaultTimezone: string): Promise<SchedulingSettings> {
  const row = await tx.queryOne(
    `SELECT ${SETTINGS_COLUMNS} FROM scheduling.settings WHERE tenant_id = kernel.current_tenant_id() AND institution_id = $1`,
    [institutionId],
  );
  return row ? mapSettings(row) : DEFAULT_SETTINGS(institutionId, defaultTimezone);
}

export async function upsertSettings(tx: Tx, tenantId: string, s: SchedulingSettings, at: Date): Promise<SchedulingSettings> {
  const row = await tx.queryOne(
    `INSERT INTO scheduling.settings (tenant_id, institution_id, timezone, staff_availability_mode, max_generation_weeks, generation_horizon_weeks,
        allow_self_validation, supervisors_paid, opening_start, opening_end, opening_weekdays, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     ON CONFLICT (tenant_id, institution_id) DO UPDATE SET timezone = EXCLUDED.timezone, staff_availability_mode = EXCLUDED.staff_availability_mode,
        max_generation_weeks = EXCLUDED.max_generation_weeks, generation_horizon_weeks = EXCLUDED.generation_horizon_weeks,
        allow_self_validation = EXCLUDED.allow_self_validation, supervisors_paid = EXCLUDED.supervisors_paid, opening_start = EXCLUDED.opening_start,
        opening_end = EXCLUDED.opening_end, opening_weekdays = EXCLUDED.opening_weekdays, updated_at = EXCLUDED.updated_at
     RETURNING ${SETTINGS_COLUMNS}`,
    [tenantId, s.institutionId, s.timezone, s.staffAvailabilityMode, s.maxGenerationWeeks, s.generationHorizonWeeks, s.allowSelfValidation, s.supervisorsPaid, s.openingStart, s.openingEnd, s.openingWeekdays ? [...s.openingWeekdays] : null, at],
  );
  return mapSettings(row as Record<string, any>);
}

export async function listSettingsInstitutions(tx: Tx): Promise<SchedulingSettings[]> {
  const rows = await tx.many(`SELECT ${SETTINGS_COLUMNS} FROM scheduling.settings WHERE tenant_id = kernel.current_tenant_id() ORDER BY institution_id`);
  return rows.map(mapSettings);
}

export async function getPolicies(tx: Tx, institutionId: string): Promise<ConflictPolicies> {
  const rows = await tx.many<{ resource_kind: ResourceKind; mode: ConflictMode }>(
    `SELECT resource_kind, mode FROM scheduling.conflict_policies WHERE tenant_id = kernel.current_tenant_id() AND institution_id = $1`,
    [institutionId],
  );
  const out: Record<ResourceKind, ConflictMode> = { ...DEFAULT_CONFLICT_POLICIES };
  for (const r of rows) out[r.resource_kind] = r.mode;
  return out;
}

export async function upsertPolicy(tx: Tx, tenantId: string, institutionId: string, kind: ResourceKind, mode: ConflictMode, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO scheduling.conflict_policies (tenant_id, institution_id, resource_kind, mode, updated_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, institution_id, resource_kind) DO UPDATE SET mode = EXCLUDED.mode, updated_at = EXCLUDED.updated_at`,
    [tenantId, institutionId, kind, mode, at],
  );
}

// ---------------------------------------------------------------------------
// Types de salle, types d'événement de calendrier
// ---------------------------------------------------------------------------

export interface CodeLabel {
  id: string;
  code: string;
  label: string;
  active: boolean;
}
export interface EventKind extends CodeLabel {
  blocksTeachingDefault: boolean;
}

export async function listRoomTypes(tx: Tx): Promise<CodeLabel[]> {
  const rows = await tx.many(`SELECT id, code, label, active FROM scheduling.room_types WHERE tenant_id = kernel.current_tenant_id() ORDER BY code`);
  return rows.map((r) => ({ id: r.id, code: r.code, label: r.label, active: r.active }));
}

export async function upsertRoomType(tx: Tx, tenantId: string, id: string, code: string, label: string, active: boolean, at: Date): Promise<CodeLabel> {
  const r = await tx.queryOne(
    `INSERT INTO scheduling.room_types (id, tenant_id, code, label, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at
     RETURNING id, code, label, active`,
    [id, tenantId, code, label, active, at],
  );
  return { id: r?.id, code: r?.code, label: r?.label, active: r?.active };
}

export async function listEventKinds(tx: Tx): Promise<EventKind[]> {
  const rows = await tx.many(
    `SELECT id, code, label, active, blocks_teaching_default FROM scheduling.calendar_event_kinds WHERE tenant_id = kernel.current_tenant_id() ORDER BY code`,
  );
  return rows.map((r) => ({ id: r.id, code: r.code, label: r.label, active: r.active, blocksTeachingDefault: r.blocks_teaching_default }));
}

export async function upsertEventKind(
  tx: Tx,
  tenantId: string,
  id: string,
  code: string,
  label: string,
  blocksTeachingDefault: boolean,
  active: boolean,
  at: Date,
): Promise<EventKind> {
  const r = await tx.queryOne(
    `INSERT INTO scheduling.calendar_event_kinds (id, tenant_id, code, label, blocks_teaching_default, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, blocks_teaching_default = EXCLUDED.blocks_teaching_default, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at
     RETURNING id, code, label, active, blocks_teaching_default`,
    [id, tenantId, code, label, blocksTeachingDefault, active, at],
  );
  return { id: r?.id, code: r?.code, label: r?.label, active: r?.active, blocksTeachingDefault: r?.blocks_teaching_default };
}

export async function getEventKind(tx: Tx, code: string): Promise<EventKind | null> {
  const r = await tx.queryOne(
    `SELECT id, code, label, active, blocks_teaching_default FROM scheduling.calendar_event_kinds WHERE tenant_id = kernel.current_tenant_id() AND code = $1`,
    [code],
  );
  return r ? { id: r.id, code: r.code, label: r.label, active: r.active, blocksTeachingDefault: r.blocks_teaching_default } : null;
}

export async function roomTypeExists(tx: Tx, code: string): Promise<boolean> {
  const r = await tx.queryOne(`SELECT 1 AS x FROM scheduling.room_types WHERE tenant_id = kernel.current_tenant_id() AND code = $1 AND active`, [code]);
  return r !== null;
}

// ---------------------------------------------------------------------------
// Salles
// ---------------------------------------------------------------------------

const ROOM_COLUMNS = `id, institution_id, campus_id, code, name, room_type_code, capacity, building, floor_label, features, status, notes`;

function mapRoom(r: Record<string, any>): Room {
  return {
    id: r.id,
    institutionId: r.institution_id,
    campusId: r.campus_id,
    code: r.code,
    name: r.name,
    roomTypeCode: r.room_type_code,
    capacity: r.capacity,
    building: r.building,
    floorLabel: r.floor_label,
    features: r.features ?? [],
    status: r.status as ResourceStatus,
    notes: r.notes,
  };
}

export async function getRoom(tx: Tx, id: string, forUpdate = false): Promise<Room | null> {
  const r = await tx.queryOne(`SELECT ${ROOM_COLUMNS} FROM scheduling.rooms WHERE tenant_id = kernel.current_tenant_id() AND id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? mapRoom(r) : null;
}

export async function getRoomsByIds(tx: Tx, ids: readonly string[]): Promise<Room[]> {
  if (ids.length === 0) return [];
  const rows = await tx.many(`SELECT ${ROOM_COLUMNS} FROM scheduling.rooms WHERE tenant_id = kernel.current_tenant_id() AND id = ANY($1::uuid[])`, [ids]);
  return rows.map(mapRoom);
}

export interface RoomFilter {
  institutionId?: string;
  campusId?: string;
  roomTypeCode?: string;
  status?: ResourceStatus;
  building?: string;
}

export async function listRooms(tx: Tx, f: RoomFilter): Promise<Room[]> {
  const params: unknown[] = [];
  const clauses = ["tenant_id = kernel.current_tenant_id()"];
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.institutionId) clauses.push(`institution_id = ${p(f.institutionId)}`);
  if (f.campusId) clauses.push(`campus_id = ${p(f.campusId)}`);
  if (f.roomTypeCode) clauses.push(`room_type_code = ${p(f.roomTypeCode)}`);
  if (f.status) clauses.push(`status = ${p(f.status)}`);
  if (f.building) clauses.push(`building = ${p(f.building)}`);
  const rows = await tx.many(`SELECT ${ROOM_COLUMNS} FROM scheduling.rooms WHERE ${clauses.join(" AND ")} ORDER BY campus_id, code`, params);
  return rows.map(mapRoom);
}

export interface NewRoom {
  id: string;
  institutionId: string;
  campusId: string;
  code: string;
  name: string;
  roomTypeCode: string;
  capacity: number | null;
  building: string | null;
  floorLabel: string | null;
  features: readonly string[];
  notes: string | null;
}

export async function insertRoom(tx: Tx, tenantId: string, r: NewRoom, at: Date): Promise<Room> {
  const row = await tx.queryOne(
    `INSERT INTO scheduling.rooms (id, tenant_id, institution_id, campus_id, code, name, room_type_code, capacity, building, floor_label, features, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING ${ROOM_COLUMNS}`,
    [r.id, tenantId, r.institutionId, r.campusId, r.code, r.name, r.roomTypeCode, r.capacity, r.building, r.floorLabel, [...r.features], r.notes, at],
  );
  return mapRoom(row as Record<string, any>);
}

export async function updateRoom(
  tx: Tx,
  id: string,
  patch: Partial<Pick<NewRoom, "name" | "roomTypeCode" | "capacity" | "building" | "floorLabel" | "notes">> & { features?: readonly string[] },
  at: Date,
): Promise<Room | null> {
  const sets = ["updated_at = $2"];
  const params: unknown[] = [id, at];
  const push = (col: string, v: unknown): void => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.name !== undefined) push("name", patch.name);
  if (patch.roomTypeCode !== undefined) push("room_type_code", patch.roomTypeCode);
  if (patch.capacity !== undefined) push("capacity", patch.capacity);
  if (patch.building !== undefined) push("building", patch.building);
  if (patch.floorLabel !== undefined) push("floor_label", patch.floorLabel);
  if (patch.notes !== undefined) push("notes", patch.notes);
  if (patch.features !== undefined) push("features", [...patch.features]);
  const row = await tx.queryOne(`UPDATE scheduling.rooms SET ${sets.join(", ")} WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${ROOM_COLUMNS}`, params);
  return row ? mapRoom(row) : null;
}

export async function setRoomStatus(tx: Tx, id: string, status: ResourceStatus, at: Date): Promise<void> {
  await tx.query(`UPDATE scheduling.rooms SET status = $2, updated_at = $3 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id, status, at]);
}

// ---------------------------------------------------------------------------
// Équipements
// ---------------------------------------------------------------------------

const EQUIPMENT_COLUMNS = "id, institution_id, campus_id, code, label, quantity, status";

function mapEquipment(r: Record<string, any>): EquipmentItem {
  return { id: r.id, institutionId: r.institution_id, campusId: r.campus_id, code: r.code, label: r.label, quantity: r.quantity, status: r.status as ResourceStatus };
}

export async function getEquipment(tx: Tx, id: string): Promise<EquipmentItem | null> {
  const r = await tx.queryOne(`SELECT ${EQUIPMENT_COLUMNS} FROM scheduling.equipment_items WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id]);
  return r ? mapEquipment(r) : null;
}

export async function getEquipmentByIds(tx: Tx, ids: readonly string[]): Promise<EquipmentItem[]> {
  if (ids.length === 0) return [];
  const rows = await tx.many(`SELECT ${EQUIPMENT_COLUMNS} FROM scheduling.equipment_items WHERE tenant_id = kernel.current_tenant_id() AND id = ANY($1::uuid[])`, [ids]);
  return rows.map(mapEquipment);
}

export async function listEquipment(tx: Tx, f: { institutionId?: string; campusId?: string; status?: ResourceStatus }): Promise<EquipmentItem[]> {
  const params: unknown[] = [];
  const clauses = ["tenant_id = kernel.current_tenant_id()"];
  if (f.institutionId) {
    params.push(f.institutionId);
    clauses.push(`institution_id = $${params.length}`);
  }
  if (f.campusId) {
    params.push(f.campusId);
    clauses.push(`campus_id = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    clauses.push(`status = $${params.length}`);
  }
  const rows = await tx.many(`SELECT ${EQUIPMENT_COLUMNS} FROM scheduling.equipment_items WHERE ${clauses.join(" AND ")} ORDER BY campus_id, code`, params);
  return rows.map(mapEquipment);
}

export async function insertEquipment(
  tx: Tx,
  tenantId: string,
  e: { id: string; institutionId: string; campusId: string; code: string; label: string; quantity: number },
  at: Date,
): Promise<EquipmentItem> {
  const row = await tx.queryOne(
    `INSERT INTO scheduling.equipment_items (id, tenant_id, institution_id, campus_id, code, label, quantity, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING ${EQUIPMENT_COLUMNS}`,
    [e.id, tenantId, e.institutionId, e.campusId, e.code, e.label, e.quantity, at],
  );
  return mapEquipment(row as Record<string, any>);
}

export async function updateEquipment(
  tx: Tx,
  id: string,
  patch: { label?: string; quantity?: number; status?: ResourceStatus },
  at: Date,
): Promise<EquipmentItem | null> {
  const sets = ["updated_at = $2"];
  const params: unknown[] = [id, at];
  if (patch.label !== undefined) {
    params.push(patch.label);
    sets.push(`label = $${params.length}`);
  }
  if (patch.quantity !== undefined) {
    params.push(patch.quantity);
    sets.push(`quantity = $${params.length}`);
  }
  if (patch.status !== undefined) {
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
  }
  const row = await tx.queryOne(`UPDATE scheduling.equipment_items SET ${sets.join(", ")} WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${EQUIPMENT_COLUMNS}`, params);
  return row ? mapEquipment(row) : null;
}

// ---------------------------------------------------------------------------
// Grille horaire
// ---------------------------------------------------------------------------

const SLOT_COLUMNS = "id, institution_id, campus_id, code, label, starts_time::text AS starts_time, ends_time::text AS ends_time, is_break, ordinal, active";

function mapSlot(r: Record<string, any>): TimeSlot {
  return {
    id: r.id,
    institutionId: r.institution_id,
    campusId: r.campus_id,
    code: r.code,
    label: r.label,
    startsTime: String(r.starts_time).slice(0, 5),
    endsTime: String(r.ends_time).slice(0, 5),
    isBreak: r.is_break,
    ordinal: r.ordinal,
    active: r.active,
  };
}

export async function listTimeSlots(tx: Tx, f: { institutionId?: string; campusId?: string | null; activeOnly?: boolean }): Promise<TimeSlot[]> {
  const params: unknown[] = [];
  const clauses = ["tenant_id = kernel.current_tenant_id()"];
  if (f.institutionId) {
    params.push(f.institutionId);
    clauses.push(`institution_id = $${params.length}`);
  }
  if (f.campusId !== undefined) {
    params.push(f.campusId);
    clauses.push(`(campus_id IS NULL OR campus_id = $${params.length})`);
  }
  if (f.activeOnly) clauses.push("active");
  const rows = await tx.many(`SELECT ${SLOT_COLUMNS} FROM scheduling.time_slots WHERE ${clauses.join(" AND ")} ORDER BY ordinal, starts_time, code`, params);
  return rows.map(mapSlot);
}

export async function getTimeSlot(tx: Tx, id: string): Promise<TimeSlot | null> {
  const r = await tx.queryOne(`SELECT ${SLOT_COLUMNS} FROM scheduling.time_slots WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id]);
  return r ? mapSlot(r) : null;
}

export async function upsertTimeSlot(
  tx: Tx,
  tenantId: string,
  s: { id: string; institutionId: string; campusId: string | null; code: string; label: string; startsTime: string; endsTime: string; isBreak: boolean; ordinal: number; active: boolean },
  at: Date,
): Promise<TimeSlot> {
  const existing = await tx.queryOne<{ id: string }>(
    `SELECT id FROM scheduling.time_slots WHERE tenant_id = kernel.current_tenant_id() AND institution_id = $1
        AND coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid) AND code = $3`,
    [s.institutionId, s.campusId, s.code],
  );
  if (existing) {
    const r = await tx.queryOne(
      `UPDATE scheduling.time_slots SET label = $2, starts_time = $3, ends_time = $4, is_break = $5, ordinal = $6, active = $7, updated_at = $8
        WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${SLOT_COLUMNS}`,
      [existing.id, s.label, s.startsTime, s.endsTime, s.isBreak, s.ordinal, s.active, at],
    );
    return mapSlot(r as Record<string, any>);
  }
  const r = await tx.queryOne(
    `INSERT INTO scheduling.time_slots (id, tenant_id, institution_id, campus_id, code, label, starts_time, ends_time, is_break, ordinal, active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING ${SLOT_COLUMNS}`,
    [s.id, tenantId, s.institutionId, s.campusId, s.code, s.label, s.startsTime, s.endsTime, s.isBreak, s.ordinal, s.active, at],
  );
  return mapSlot(r as Record<string, any>);
}

export async function deactivateTimeSlot(tx: Tx, id: string, at: Date): Promise<TimeSlot | null> {
  const r = await tx.queryOne(`UPDATE scheduling.time_slots SET active = false, updated_at = $2 WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${SLOT_COLUMNS}`, [id, at]);
  return r ? mapSlot(r) : null;
}

// ---------------------------------------------------------------------------
// Calendrier
// ---------------------------------------------------------------------------

const EVENT_COLUMNS = `id, institution_id, campus_id, academic_year_id, kind_code, title, description, starts_on::text AS starts_on, ends_on::text AS ends_on,
  starts_time::text AS starts_time, ends_time::text AS ends_time, blocks_teaching, audience`;

function mapEvent(r: Record<string, any>): CalendarEvent {
  return {
    id: r.id,
    institutionId: r.institution_id,
    campusId: r.campus_id,
    academicYearId: r.academic_year_id,
    kindCode: r.kind_code,
    title: r.title,
    description: r.description,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    startsTime: r.starts_time ? String(r.starts_time).slice(0, 5) : null,
    endsTime: r.ends_time ? String(r.ends_time).slice(0, 5) : null,
    blocksTeaching: r.blocks_teaching,
    audience: (r.audience ?? []) as Audience[],
  };
}

export async function getCalendarEvent(tx: Tx, id: string): Promise<CalendarEvent | null> {
  const r = await tx.queryOne(`SELECT ${EVENT_COLUMNS} FROM scheduling.calendar_events WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id]);
  return r ? mapEvent(r) : null;
}

export async function listCalendarEvents(
  tx: Tx,
  f: { institutionId?: string; campusId?: string | null; from?: string; to?: string; blocksTeachingOnly?: boolean; audience?: Audience },
): Promise<CalendarEvent[]> {
  const params: unknown[] = [];
  const clauses = ["tenant_id = kernel.current_tenant_id()"];
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.institutionId) clauses.push(`institution_id = ${p(f.institutionId)}`);
  if (f.campusId !== undefined && f.campusId !== null) clauses.push(`(campus_id IS NULL OR campus_id = ${p(f.campusId)})`);
  if (f.from) clauses.push(`ends_on >= ${p(f.from)}::date`);
  if (f.to) clauses.push(`starts_on <= ${p(f.to)}::date`);
  if (f.blocksTeachingOnly) clauses.push("blocks_teaching");
  if (f.audience) clauses.push(`${p(f.audience)} = ANY(audience)`);
  const rows = await tx.many(`SELECT ${EVENT_COLUMNS} FROM scheduling.calendar_events WHERE ${clauses.join(" AND ")} ORDER BY starts_on, ends_on, title, id`, params);
  return rows.map(mapEvent);
}

export interface NewCalendarEvent {
  id: string;
  institutionId: string;
  campusId: string | null;
  academicYearId: string | null;
  kindCode: string;
  title: string;
  description: string | null;
  startsOn: string;
  endsOn: string;
  startsTime: string | null;
  endsTime: string | null;
  blocksTeaching: boolean;
  audience: readonly Audience[];
}

export async function insertCalendarEvent(tx: Tx, tenantId: string, e: NewCalendarEvent, by: string | null, at: Date): Promise<CalendarEvent> {
  const r = await tx.queryOne(
    `INSERT INTO scheduling.calendar_events (id, tenant_id, institution_id, campus_id, academic_year_id, kind_code, title, description, starts_on, ends_on, starts_time, ends_time,
        blocks_teaching, audience, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16) RETURNING ${EVENT_COLUMNS}`,
    [e.id, tenantId, e.institutionId, e.campusId, e.academicYearId, e.kindCode, e.title, e.description, e.startsOn, e.endsOn, e.startsTime, e.endsTime, e.blocksTeaching, [...e.audience], by, at],
  );
  return mapEvent(r as Record<string, any>);
}

export async function updateCalendarEvent(tx: Tx, id: string, e: Omit<NewCalendarEvent, "id" | "institutionId">, at: Date): Promise<CalendarEvent | null> {
  const r = await tx.queryOne(
    `UPDATE scheduling.calendar_events SET campus_id = $2, academic_year_id = $3, kind_code = $4, title = $5, description = $6, starts_on = $7, ends_on = $8,
        starts_time = $9, ends_time = $10, blocks_teaching = $11, audience = $12, updated_at = $13
      WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${EVENT_COLUMNS}`,
    [id, e.campusId, e.academicYearId, e.kindCode, e.title, e.description, e.startsOn, e.endsOn, e.startsTime, e.endsTime, e.blocksTeaching, [...e.audience], at],
  );
  return r ? mapEvent(r) : null;
}

export async function deleteCalendarEvent(tx: Tx, id: string): Promise<boolean> {
  const res = await tx.query(`DELETE FROM scheduling.calendar_events WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id]);
  return res.rowCount === 1;
}

/** Même titre sur la même plage dans l'établissement (avertissement de doublon, Q7). */
export async function findDuplicateEvents(tx: Tx, institutionId: string, title: string, startsOn: string, endsOn: string, excludeId: string | null): Promise<string[]> {
  const rows = await tx.many<{ id: string }>(
    `SELECT id FROM scheduling.calendar_events WHERE tenant_id = kernel.current_tenant_id() AND institution_id = $1 AND lower(title) = lower($2)
        AND starts_on = $3::date AND ends_on = $4::date AND ($5::uuid IS NULL OR id <> $5::uuid)`,
    [institutionId, title, startsOn, endsOn, excludeId],
  );
  return rows.map((r) => r.id);
}

/** Séances PLANNED non constatées qui tombent un jour bloquant (signalement, aucune annulation). */
export async function plannedOccurrencesInRange(tx: Tx, institutionId: string, from: string, to: string, campusId: string | null): Promise<Array<{ id: string; occursOn: string }>> {
  const rows = await tx.many<{ id: string; occurs_on: string }>(
    `SELECT id, occurs_on::text AS occurs_on FROM scheduling.session_occurrences
      WHERE tenant_id = kernel.current_tenant_id() AND institution_id = $1 AND status = 'PLANNED' AND validated_at IS NULL
        AND occurs_on BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR campus_id IS NULL OR campus_id = $4::uuid)
      ORDER BY occurs_on, id`,
    [institutionId, from, to, campusId],
  );
  return rows.map((r) => ({ id: r.id, occursOn: r.occurs_on }));
}
