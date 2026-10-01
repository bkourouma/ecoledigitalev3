/**
 * Accès SQL aux emplois du temps, patrons (et leurs intervenants/équipements) et journaux de génération.
 */
import type { Tx } from "@ecoledigitale/database";
import { formatTimeOfDay, parseTimeOfDay } from "../domain/time";
import type {
  DeliveryMode,
  EntryEquipment,
  EntryKind,
  EntryStaff,
  EntryStaffRole,
  Timetable,
  TimetableEntry,
  TimetableStatus,
  WeekPattern,
} from "../domain/types";

const TT_COLUMNS = `id, institution_id, campus_id, academic_year_id, period_id, name, status, valid_from::text AS valid_from, valid_to::text AS valid_to,
  week_a_anchor::text AS week_a_anchor, cloned_from_id, published_at`;

function mapTimetable(r: Record<string, any>): Timetable {
  return {
    id: r.id,
    institutionId: r.institution_id,
    campusId: r.campus_id,
    academicYearId: r.academic_year_id,
    periodId: r.period_id,
    name: r.name,
    status: r.status as TimetableStatus,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    weekAAnchor: r.week_a_anchor,
    clonedFromId: r.cloned_from_id,
    publishedAt: r.published_at,
  };
}

export async function getTimetable(tx: Tx, id: string, forUpdate = false): Promise<Timetable | null> {
  const r = await tx.queryOne(`SELECT ${TT_COLUMNS} FROM scheduling.timetables WHERE tenant_id = kernel.current_tenant_id() AND id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? mapTimetable(r) : null;
}

export async function listTimetables(tx: Tx, f: { institutionId?: string; academicYearId?: string; status?: TimetableStatus; campusId?: string }): Promise<Timetable[]> {
  const params: unknown[] = [];
  const clauses = ["tenant_id = kernel.current_tenant_id()"];
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.institutionId) clauses.push(`institution_id = ${p(f.institutionId)}`);
  if (f.academicYearId) clauses.push(`academic_year_id = ${p(f.academicYearId)}`);
  if (f.status) clauses.push(`status = ${p(f.status)}`);
  if (f.campusId) clauses.push(`campus_id = ${p(f.campusId)}`);
  const rows = await tx.many(`SELECT ${TT_COLUMNS} FROM scheduling.timetables WHERE ${clauses.join(" AND ")} ORDER BY valid_from DESC, name, id`, params);
  return rows.map(mapTimetable);
}

export async function listPublishedTimetables(tx: Tx): Promise<Timetable[]> {
  const rows = await tx.many(`SELECT ${TT_COLUMNS} FROM scheduling.timetables WHERE tenant_id = kernel.current_tenant_id() AND status = 'PUBLISHED' ORDER BY id`);
  return rows.map(mapTimetable);
}

export interface NewTimetable {
  id: string;
  institutionId: string;
  campusId: string | null;
  academicYearId: string;
  periodId: string | null;
  name: string;
  validFrom: string;
  validTo: string;
  weekAAnchor: string | null;
  clonedFromId: string | null;
}

export async function insertTimetable(tx: Tx, tenantId: string, t: NewTimetable, by: string | null, at: Date): Promise<Timetable> {
  const r = await tx.queryOne(
    `INSERT INTO scheduling.timetables (id, tenant_id, institution_id, campus_id, academic_year_id, period_id, name, valid_from, valid_to, week_a_anchor, cloned_from_id, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING ${TT_COLUMNS}`,
    [t.id, tenantId, t.institutionId, t.campusId, t.academicYearId, t.periodId, t.name, t.validFrom, t.validTo, t.weekAAnchor, t.clonedFromId, by, at],
  );
  return mapTimetable(r as Record<string, any>);
}

export async function updateTimetable(
  tx: Tx,
  id: string,
  patch: { name?: string; validFrom?: string; validTo?: string; weekAAnchor?: string | null },
  at: Date,
): Promise<Timetable | null> {
  const sets = ["updated_at = $2"];
  const params: unknown[] = [id, at];
  const push = (col: string, v: unknown): void => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.name !== undefined) push("name", patch.name);
  if (patch.validFrom !== undefined) push("valid_from", patch.validFrom);
  if (patch.validTo !== undefined) push("valid_to", patch.validTo);
  if (patch.weekAAnchor !== undefined) push("week_a_anchor", patch.weekAAnchor);
  const r = await tx.queryOne(`UPDATE scheduling.timetables SET ${sets.join(", ")} WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${TT_COLUMNS}`, params);
  return r ? mapTimetable(r) : null;
}

export async function setTimetablePublished(tx: Tx, id: string, by: string | null, at: Date): Promise<Timetable> {
  const r = await tx.queryOne(
    `UPDATE scheduling.timetables SET status = 'PUBLISHED', published_at = $2, published_by = $3, updated_at = $2 WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${TT_COLUMNS}`,
    [id, at, by],
  );
  return mapTimetable(r as Record<string, any>);
}

export async function setTimetableArchived(tx: Tx, id: string, at: Date): Promise<Timetable> {
  const r = await tx.queryOne(
    `UPDATE scheduling.timetables SET status = 'ARCHIVED', archived_at = $2, updated_at = $2 WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${TT_COLUMNS}`,
    [id, at],
  );
  return mapTimetable(r as Record<string, any>);
}

// ---------------------------------------------------------------------------
// Patrons
// ---------------------------------------------------------------------------

const ENTRY_COLUMNS = `e.id, e.timetable_id, e.kind, e.classroom_id, e.curriculum_node_id, e.offering_id, e.claims_classroom, e.weekday,
  e.starts_time::text AS starts_time, e.ends_time::text AS ends_time, e.time_slot_id, e.room_id, e.week_pattern,
  e.valid_from::text AS valid_from, e.valid_to::text AS valid_to, e.delivery_mode, e.title, e.notes, e.ended_at`;

function mapEntryBase(r: Record<string, any>): TimetableEntry {
  return {
    id: r.id,
    timetableId: r.timetable_id,
    kind: r.kind as EntryKind,
    classroomId: r.classroom_id,
    curriculumNodeId: r.curriculum_node_id,
    offeringId: r.offering_id,
    claimsClassroom: r.claims_classroom,
    weekday: r.weekday,
    startMinute: parseTimeOfDay(String(r.starts_time).slice(0, 5)),
    endMinute: parseTimeOfDay(String(r.ends_time).slice(0, 5)),
    timeSlotId: r.time_slot_id,
    roomId: r.room_id,
    weekPattern: r.week_pattern as WeekPattern,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    deliveryMode: r.delivery_mode as DeliveryMode,
    title: r.title,
    notes: r.notes,
    endedAt: r.ended_at,
    staff: [],
    equipment: [],
  };
}

async function attachChildren(tx: Tx, entries: TimetableEntry[]): Promise<TimetableEntry[]> {
  if (entries.length === 0) return entries;
  const ids = entries.map((e) => e.id);
  const [staffRows, equipRows] = await Promise.all([
    tx.many<{ entry_id: string; staff_id: string; role: EntryStaffRole }>(
      `SELECT entry_id, staff_id, role FROM scheduling.timetable_entry_staff WHERE tenant_id = kernel.current_tenant_id() AND entry_id = ANY($1::uuid[]) ORDER BY role, staff_id`,
      [ids],
    ),
    tx.many<{ entry_id: string; equipment_id: string; quantity: number }>(
      `SELECT entry_id, equipment_id, quantity FROM scheduling.timetable_entry_equipment WHERE tenant_id = kernel.current_tenant_id() AND entry_id = ANY($1::uuid[]) ORDER BY equipment_id`,
      [ids],
    ),
  ]);
  const staff = new Map<string, EntryStaff[]>();
  for (const r of staffRows) (staff.get(r.entry_id) ?? staff.set(r.entry_id, []).get(r.entry_id))?.push({ staffId: r.staff_id, role: r.role });
  const equip = new Map<string, EntryEquipment[]>();
  for (const r of equipRows) (equip.get(r.entry_id) ?? equip.set(r.entry_id, []).get(r.entry_id))?.push({ equipmentId: r.equipment_id, quantity: r.quantity });
  return entries.map((e) => ({ ...e, staff: staff.get(e.id) ?? [], equipment: equip.get(e.id) ?? [] }));
}

export async function getEntry(tx: Tx, id: string, forUpdate = false): Promise<TimetableEntry | null> {
  const r = await tx.queryOne(`SELECT ${ENTRY_COLUMNS} FROM scheduling.timetable_entries e WHERE e.tenant_id = kernel.current_tenant_id() AND e.id = $1${forUpdate ? " FOR UPDATE OF e" : ""}`, [id]);
  if (!r) return null;
  return (await attachChildren(tx, [mapEntryBase(r)]))[0] ?? null;
}

export async function listEntries(tx: Tx, timetableId: string, options: { includeEnded?: boolean } = {}): Promise<TimetableEntry[]> {
  const rows = await tx.many(
    `SELECT ${ENTRY_COLUMNS} FROM scheduling.timetable_entries e WHERE e.tenant_id = kernel.current_tenant_id() AND e.timetable_id = $1
        ${options.includeEnded ? "" : "AND e.ended_at IS NULL"} ORDER BY e.weekday, e.starts_time, e.id`,
    [timetableId],
  );
  return attachChildren(tx, rows.map(mapEntryBase));
}

export interface NewEntry {
  id: string;
  timetableId: string;
  kind: EntryKind;
  classroomId: string | null;
  curriculumNodeId: string | null;
  offeringId: string | null;
  claimsClassroom: boolean;
  weekday: number;
  startMinute: number;
  endMinute: number;
  timeSlotId: string | null;
  roomId: string | null;
  weekPattern: WeekPattern;
  validFrom: string | null;
  validTo: string | null;
  deliveryMode: DeliveryMode;
  title: string | null;
  notes: string | null;
  staff: readonly EntryStaff[];
  equipment: readonly EntryEquipment[];
}

export async function insertEntry(tx: Tx, tenantId: string, e: NewEntry, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO scheduling.timetable_entries (id, tenant_id, timetable_id, kind, classroom_id, curriculum_node_id, offering_id, claims_classroom, weekday, starts_time, ends_time,
        time_slot_id, room_id, week_pattern, valid_from, valid_to, delivery_mode, title, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20)`,
    [
      e.id, tenantId, e.timetableId, e.kind, e.classroomId, e.curriculumNodeId, e.offeringId, e.claimsClassroom, e.weekday, formatTimeOfDay(e.startMinute), formatTimeOfDay(e.endMinute),
      e.timeSlotId, e.roomId, e.weekPattern, e.validFrom, e.validTo, e.deliveryMode, e.title, e.notes, at,
    ],
  );
  await replaceEntryChildren(tx, tenantId, e.id, e.staff, e.equipment);
}

export async function updateEntry(tx: Tx, tenantId: string, e: NewEntry, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.timetable_entries SET kind = $2, classroom_id = $3, curriculum_node_id = $4, offering_id = $5, claims_classroom = $6, weekday = $7, starts_time = $8, ends_time = $9,
        time_slot_id = $10, room_id = $11, week_pattern = $12, valid_from = $13, valid_to = $14, delivery_mode = $15, title = $16, notes = $17, updated_at = $18
      WHERE tenant_id = kernel.current_tenant_id() AND id = $1`,
    [
      e.id, e.kind, e.classroomId, e.curriculumNodeId, e.offeringId, e.claimsClassroom, e.weekday, formatTimeOfDay(e.startMinute), formatTimeOfDay(e.endMinute),
      e.timeSlotId, e.roomId, e.weekPattern, e.validFrom, e.validTo, e.deliveryMode, e.title, e.notes, at,
    ],
  );
  await replaceEntryChildren(tx, tenantId, e.id, e.staff, e.equipment);
}

async function replaceEntryChildren(tx: Tx, tenantId: string, entryId: string, staff: readonly EntryStaff[], equipment: readonly EntryEquipment[]): Promise<void> {
  await tx.query(`DELETE FROM scheduling.timetable_entry_staff WHERE tenant_id = kernel.current_tenant_id() AND entry_id = $1`, [entryId]);
  await tx.query(`DELETE FROM scheduling.timetable_entry_equipment WHERE tenant_id = kernel.current_tenant_id() AND entry_id = $1`, [entryId]);
  for (const s of staff) {
    await tx.query(`INSERT INTO scheduling.timetable_entry_staff (tenant_id, entry_id, staff_id, role) VALUES ($1, $2, $3, $4)`, [tenantId, entryId, s.staffId, s.role]);
  }
  for (const q of equipment) {
    await tx.query(`INSERT INTO scheduling.timetable_entry_equipment (tenant_id, entry_id, equipment_id, quantity) VALUES ($1, $2, $3, $4)`, [tenantId, entryId, q.equipmentId, q.quantity]);
  }
}

export async function endEntry(tx: Tx, id: string, validTo: string, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.timetable_entries SET valid_to = $2, ended_at = $3, updated_at = $3 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`,
    [id, validTo, at],
  );
}

export async function entryHasOccurrences(tx: Tx, id: string): Promise<boolean> {
  const r = await tx.queryOne(`SELECT 1 AS x FROM scheduling.session_occurrences WHERE tenant_id = kernel.current_tenant_id() AND timetable_entry_id = $1 LIMIT 1`, [id]);
  return r !== null;
}

export async function deleteEntry(tx: Tx, id: string): Promise<boolean> {
  const res = await tx.query(`DELETE FROM scheduling.timetable_entries WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id]);
  return res.rowCount === 1;
}

// ---------------------------------------------------------------------------
// Journal des générations
// ---------------------------------------------------------------------------

export interface GenerationRunRow {
  id: string;
  timetableId: string;
  fromDate: string;
  toDate: string;
  createdCount: number;
  skippedExisting: number;
  skippedBlocked: number;
  skippedConflict: number;
  skippedCapped: number;
  warnings: unknown[];
  requestedBy: string | null;
  requestedAt: Date;
}

export async function insertGenerationRun(tx: Tx, tenantId: string, r: Omit<GenerationRunRow, "requestedAt">, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO scheduling.generation_runs (id, tenant_id, timetable_id, from_date, to_date, created_count, skipped_existing, skipped_blocked, skipped_conflict, skipped_capped, warnings, requested_by, requested_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
    [r.id, tenantId, r.timetableId, r.fromDate, r.toDate, r.createdCount, r.skippedExisting, r.skippedBlocked, r.skippedConflict, r.skippedCapped, JSON.stringify(r.warnings), r.requestedBy, at],
  );
}

export async function listGenerationRuns(tx: Tx, timetableId: string, limit = 50): Promise<GenerationRunRow[]> {
  const rows = await tx.many(
    `SELECT id, timetable_id, from_date::text AS from_date, to_date::text AS to_date, created_count, skipped_existing, skipped_blocked, skipped_conflict, skipped_capped, warnings, requested_by, requested_at
       FROM scheduling.generation_runs WHERE tenant_id = kernel.current_tenant_id() AND timetable_id = $1 ORDER BY requested_at DESC, id LIMIT $2`,
    [timetableId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((r) => ({
    id: r.id,
    timetableId: r.timetable_id,
    fromDate: r.from_date,
    toDate: r.to_date,
    createdCount: r.created_count,
    skippedExisting: r.skipped_existing,
    skippedBlocked: r.skipped_blocked,
    skippedConflict: r.skipped_conflict,
    skippedCapped: r.skipped_capped,
    warnings: r.warnings ?? [],
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
  }));
}

/** Date maximale déjà générée pour un patron (génération glissante), ou null. */
export async function lastGeneratedDate(tx: Tx, timetableId: string): Promise<string | null> {
  const r = await tx.queryOne<{ d: string | null }>(
    `SELECT max(o.generated_for)::text AS d FROM scheduling.session_occurrences o
       JOIN scheduling.timetable_entries e ON e.tenant_id = o.tenant_id AND e.id = o.timetable_entry_id
      WHERE o.tenant_id = kernel.current_tenant_id() AND e.timetable_id = $1`,
    [timetableId],
  );
  return r?.d ?? null;
}
