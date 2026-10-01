/**
 * Accès SQL aux occurrences, intervenants, équipements, réservations dérivées et journal.
 * Toutes les fonctions prennent le `Tx` d'un `TenantDb.run` : la RLS isole le tenant, on écrit tout de
 * même `tenant_id` quand l'index ou la lisibilité l'exigent. Les dates (`date`) sont lues en TEXTE
 * (`::text`) pour éviter le piège du fuseau de `pg`.
 */
import type { Tx } from "@ecoledigitale/database";
import type { ClaimHit } from "../domain/conflicts";
import type {
  ClaimResourceKind,
  EntryEquipment,
  HeldSource,
  Occurrence,
  OccurrenceDetail,
  OccurrenceKind,
  OccurrenceOrigin,
  OccurrenceStaff,
  OccurrenceStatus,
  ReplacementReason,
  StaffRole,
  DeliveryMode,
} from "../domain/types";

export const OCC_COLUMNS = `o.id, o.institution_id, o.campus_id, o.academic_year_id, o.timetable_entry_id, o.generated_for::text AS generated_for, o.generated_from,
  o.kind, o.title, o.classroom_id, o.curriculum_node_id, o.offering_id, o.claims_classroom, o.room_id, o.starts_at, o.ends_at,
  o.occurs_on::text AS occurs_on, o.delivery_mode, o.virtual_session_ref, o.status, o.held_at, o.held_source, o.held_by, o.cancelled_at,
  o.cancel_reason, o.validated_at, o.validated_by, o.origin, o.conflict_override, o.conflict_override_reason, o.needs_replacement,
  o.replacement_reason, o.notes, o.location_label, o.attributes, o.created_by, o.created_at`;

export function mapOccurrence(r: Record<string, any>): Occurrence {
  return {
    id: r.id,
    institutionId: r.institution_id,
    campusId: r.campus_id,
    academicYearId: r.academic_year_id,
    timetableEntryId: r.timetable_entry_id,
    generatedFor: r.generated_for,
    generatedFrom: r.generated_from ?? null,
    kind: r.kind as OccurrenceKind,
    title: r.title,
    classroomId: r.classroom_id,
    curriculumNodeId: r.curriculum_node_id,
    offeringId: r.offering_id,
    claimsClassroom: r.claims_classroom,
    roomId: r.room_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    occursOn: r.occurs_on,
    deliveryMode: r.delivery_mode as DeliveryMode,
    virtualSessionRef: r.virtual_session_ref,
    status: r.status as OccurrenceStatus,
    heldAt: r.held_at,
    heldSource: r.held_source as HeldSource | null,
    heldBy: r.held_by,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    validatedAt: r.validated_at,
    validatedBy: r.validated_by,
    origin: r.origin as OccurrenceOrigin,
    conflictOverride: r.conflict_override,
    conflictOverrideReason: r.conflict_override_reason,
    needsReplacement: r.needs_replacement,
    replacementReason: r.replacement_reason as ReplacementReason | null,
    notes: r.notes,
    locationLabel: r.location_label,
    attributes: r.attributes ?? {},
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export const STAFF_COLUMNS = `s.id, s.occurrence_id, s.staff_id, s.role, s.replaces_staff_id, s.is_paid_role, s.paid_minutes, s.paid_minutes_by,
  s.paid_minutes_at, s.locked_at, s.lock_ref`;

export function mapStaff(r: Record<string, any>): OccurrenceStaff {
  return {
    id: r.id,
    occurrenceId: r.occurrence_id,
    staffId: r.staff_id,
    role: r.role as StaffRole,
    replacesStaffId: r.replaces_staff_id,
    isPaidRole: r.is_paid_role,
    paidMinutes: r.paid_minutes,
    paidMinutesBy: r.paid_minutes_by,
    paidMinutesAt: r.paid_minutes_at,
    lockedAt: r.locked_at,
    lockRef: r.lock_ref,
  };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function getOccurrence(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<Occurrence | null> {
  const row = await tx.queryOne(
    `SELECT ${OCC_COLUMNS} FROM scheduling.session_occurrences o WHERE o.tenant_id = kernel.current_tenant_id() AND o.id = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  return row ? mapOccurrence(row) : null;
}

export async function getOccurrencesByIds(tx: Tx, ids: readonly string[]): Promise<Occurrence[]> {
  if (ids.length === 0) return [];
  const rows = await tx.many(`SELECT ${OCC_COLUMNS} FROM scheduling.session_occurrences o WHERE o.tenant_id = kernel.current_tenant_id() AND o.id = ANY($1::uuid[])`, [ids]);
  return rows.map(mapOccurrence);
}

export async function listStaffByOccurrence(tx: Tx, occurrenceIds: readonly string[]): Promise<Map<string, OccurrenceStaff[]>> {
  const out = new Map<string, OccurrenceStaff[]>();
  if (occurrenceIds.length === 0) return out;
  const rows = await tx.many(
    `SELECT ${STAFF_COLUMNS} FROM scheduling.occurrence_staff s WHERE s.tenant_id = kernel.current_tenant_id() AND s.occurrence_id = ANY($1::uuid[]) ORDER BY s.created_at, s.id`,
    [occurrenceIds],
  );
  for (const r of rows) {
    const s = mapStaff(r);
    const list = out.get(s.occurrenceId);
    if (list) list.push(s);
    else out.set(s.occurrenceId, [s]);
  }
  return out;
}

export async function listEquipmentByOccurrence(tx: Tx, occurrenceIds: readonly string[]): Promise<Map<string, EntryEquipment[]>> {
  const out = new Map<string, EntryEquipment[]>();
  if (occurrenceIds.length === 0) return out;
  const rows = await tx.many<{ occurrence_id: string; equipment_id: string; quantity: number }>(
    `SELECT occurrence_id, equipment_id, quantity FROM scheduling.occurrence_equipment WHERE tenant_id = kernel.current_tenant_id() AND occurrence_id = ANY($1::uuid[]) ORDER BY equipment_id`,
    [occurrenceIds],
  );
  for (const r of rows) {
    const list = out.get(r.occurrence_id);
    const item = { equipmentId: r.equipment_id, quantity: r.quantity };
    if (list) list.push(item);
    else out.set(r.occurrence_id, [item]);
  }
  return out;
}

/** Séances avec leurs intervenants et équipements (deux requêtes pour tout le lot). */
export async function withDetails(tx: Tx, occurrences: readonly Occurrence[]): Promise<OccurrenceDetail[]> {
  const ids = occurrences.map((o) => o.id);
  const [staff, equipment] = await Promise.all([listStaffByOccurrence(tx, ids), listEquipmentByOccurrence(tx, ids)]);
  return occurrences.map((o) => ({ ...o, staff: staff.get(o.id) ?? [], equipment: equipment.get(o.id) ?? [] }));
}

export async function getOccurrenceDetail(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<OccurrenceDetail | null> {
  const occ = await getOccurrence(tx, id, options);
  if (!occ) return null;
  return (await withDetails(tx, [occ]))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export interface NewOccurrence {
  id: string;
  tenantId: string;
  institutionId: string;
  campusId: string | null;
  academicYearId: string;
  timetableEntryId: string | null;
  generatedFor: string | null;
  generatedFrom?: { startMinute: number; endMinute: number; roomId: string | null } | null;
  kind: OccurrenceKind;
  title: string | null;
  classroomId: string | null;
  curriculumNodeId: string | null;
  offeringId: string | null;
  claimsClassroom: boolean;
  roomId: string | null;
  startsAt: Date;
  endsAt: Date;
  occursOn: string;
  deliveryMode: DeliveryMode;
  status: OccurrenceStatus;
  heldAt: Date | null;
  heldSource: HeldSource | null;
  heldBy: string | null;
  origin: OccurrenceOrigin;
  conflictOverride: boolean;
  conflictOverrideReason: string | null;
  conflictOverrideBy: string | null;
  notes: string | null;
  locationLabel: string | null;
  attributes: Record<string, unknown>;
  createdBy: string | null;
}

const INSERT_COLUMNS = [
  "id", "tenant_id", "institution_id", "campus_id", "academic_year_id", "timetable_entry_id", "generated_for", "generated_from", "kind", "title", "classroom_id",
  "curriculum_node_id", "offering_id", "claims_classroom", "room_id", "starts_at", "ends_at", "occurs_on", "delivery_mode", "status", "held_at",
  "held_source", "held_by", "origin", "conflict_override", "conflict_override_reason", "conflict_override_by", "notes", "location_label",
  "attributes", "created_by",
] as const;

function occurrenceParams(o: NewOccurrence): unknown[] {
  return [
    o.id, o.tenantId, o.institutionId, o.campusId, o.academicYearId, o.timetableEntryId, o.generatedFor, o.generatedFrom ? JSON.stringify(o.generatedFrom) : null, o.kind, o.title, o.classroomId,
    o.curriculumNodeId, o.offeringId, o.claimsClassroom, o.roomId, o.startsAt, o.endsAt, o.occursOn, o.deliveryMode, o.status, o.heldAt,
    o.heldSource, o.heldBy, o.origin, o.conflictOverride, o.conflictOverrideReason, o.conflictOverrideBy, o.notes, o.locationLabel,
    JSON.stringify(o.attributes), o.createdBy,
  ];
}

const placeholders = (offset: number): string =>
  `(${INSERT_COLUMNS.map((c, i) => (c === "attributes" || c === "generated_from" ? `$${offset + i + 1}::jsonb` : `$${offset + i + 1}`)).join(", ")})`;

export async function insertOccurrence(tx: Tx, o: NewOccurrence): Promise<void> {
  await tx.query(`INSERT INTO scheduling.session_occurrences (${INSERT_COLUMNS.join(", ")}) VALUES ${placeholders(0)}`, occurrenceParams(o));
}

/**
 * Insertion en lot IDEMPOTENTE (génération) : une occurrence par (patron, date de patron) ; les
 * doublons sont ignorés. Renvoie les identifiants réellement insérés.
 */
export async function insertGeneratedBatch(tx: Tx, rows: readonly NewOccurrence[]): Promise<Set<string>> {
  const inserted = new Set<string>();
  const CHUNK = 200;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const params: unknown[] = [];
    const values = chunk.map((o, i) => {
      params.push(...occurrenceParams(o));
      return placeholders(i * INSERT_COLUMNS.length);
    });
    const res = await tx.many<{ id: string }>(
      `INSERT INTO scheduling.session_occurrences (${INSERT_COLUMNS.join(", ")}) VALUES ${values.join(", ")}
       ON CONFLICT (tenant_id, timetable_entry_id, generated_for) WHERE timetable_entry_id IS NOT NULL DO NOTHING
       RETURNING id`,
      params,
    );
    for (const r of res) inserted.add(r.id);
  }
  return inserted;
}

export interface NewStaff {
  id: string;
  occurrenceId: string;
  staffId: string;
  role: StaffRole;
  replacesStaffId: string | null;
  isPaidRole: boolean;
}

export async function insertStaff(tx: Tx, tenantId: string, rows: readonly NewStaff[]): Promise<void> {
  const CHUNK = 500;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const params: unknown[] = [];
    const values = chunk.map((s, i) => {
      params.push(s.id, tenantId, s.occurrenceId, s.staffId, s.role, s.replacesStaffId, s.isPaidRole);
      const o = i * 7;
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`;
    });
    await tx.query(
      `INSERT INTO scheduling.occurrence_staff (id, tenant_id, occurrence_id, staff_id, role, replaces_staff_id, is_paid_role) VALUES ${values.join(", ")}`,
      params,
    );
  }
}

export async function deleteStaff(tx: Tx, occurrenceId: string, staffId: string): Promise<number> {
  const res = await tx.query(`DELETE FROM scheduling.occurrence_staff WHERE tenant_id = kernel.current_tenant_id() AND occurrence_id = $1 AND staff_id = $2`, [occurrenceId, staffId]);
  return res.rowCount;
}

export async function insertEquipment(tx: Tx, tenantId: string, occurrenceId: string, items: readonly EntryEquipment[]): Promise<void> {
  for (const it of [...items].sort((a, b) => a.equipmentId.localeCompare(b.equipmentId))) {
    await tx.query(`INSERT INTO scheduling.occurrence_equipment (tenant_id, occurrence_id, equipment_id, quantity) VALUES ($1, $2, $3, $4)`, [tenantId, occurrenceId, it.equipmentId, it.quantity]);
  }
}

export async function insertEquipmentBatch(tx: Tx, tenantId: string, rows: ReadonlyArray<{ occurrenceId: string } & EntryEquipment>): Promise<void> {
  const sorted = [...rows].sort((a, b) => a.equipmentId.localeCompare(b.equipmentId) || a.occurrenceId.localeCompare(b.occurrenceId));
  for (const r of sorted) {
    await tx.query(`INSERT INTO scheduling.occurrence_equipment (tenant_id, occurrence_id, equipment_id, quantity) VALUES ($1, $2, $3, $4)`, [tenantId, r.occurrenceId, r.equipmentId, r.quantity]);
  }
}

export async function updateTimes(tx: Tx, id: string, startsAt: Date, endsAt: Date, occursOn: string, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.session_occurrences SET starts_at = $2, ends_at = $3, occurs_on = $4, updated_at = $5 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`,
    [id, startsAt, endsAt, occursOn, at],
  );
}

export async function updateRoom(tx: Tx, id: string, roomId: string | null, at: Date): Promise<void> {
  await tx.query(`UPDATE scheduling.session_occurrences SET room_id = $2, updated_at = $3 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id, roomId, at]);
}

/** Met à jour l'instantané du patron (après une propagation) sans toucher à la planification de la séance. */
export async function setGeneratedFrom(tx: Tx, id: string, snapshot: { startMinute: number; endMinute: number; roomId: string | null }, at: Date): Promise<void> {
  await tx.query(`UPDATE scheduling.session_occurrences SET generated_from = $2::jsonb, updated_at = $3 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id, JSON.stringify(snapshot), at]);
}

export async function updateDescriptive(
  tx: Tx,
  id: string,
  patch: { title?: string | null; notes?: string | null; locationLabel?: string | null; deliveryMode?: DeliveryMode; virtualSessionRef?: string | null },
  at: Date,
): Promise<void> {
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, at];
  const push = (col: string, v: unknown): void => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.title !== undefined) push("title", patch.title);
  if (patch.notes !== undefined) push("notes", patch.notes);
  if (patch.locationLabel !== undefined) push("location_label", patch.locationLabel);
  if (patch.deliveryMode !== undefined) push("delivery_mode", patch.deliveryMode);
  if (patch.virtualSessionRef !== undefined) push("virtual_session_ref", patch.virtualSessionRef);
  await tx.query(`UPDATE scheduling.session_occurrences SET ${sets.join(", ")} WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, params);
}

export async function markHeld(tx: Tx, id: string, source: HeldSource, by: string | null, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.session_occurrences SET status = 'HELD', held_at = $2, held_source = $3, held_by = $4, updated_at = $2 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`,
    [id, at, source, by],
  );
}

export async function markUnheld(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.session_occurrences SET status = 'PLANNED', held_at = NULL, held_source = NULL, held_by = NULL, updated_at = $2 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`,
    [id, at],
  );
}

export async function markCancelled(tx: Tx, id: string, reason: string, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.session_occurrences
        SET status = 'CANCELLED', cancelled_at = $2, cancel_reason = $3, needs_replacement = false, replacement_reason = NULL, updated_at = $2
      WHERE tenant_id = kernel.current_tenant_id() AND id = $1`,
    [id, at, reason],
  );
}

export async function markRestored(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.session_occurrences SET status = 'PLANNED', cancelled_at = NULL, cancel_reason = NULL, updated_at = $2 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`,
    [id, at],
  );
}

/** Pose la validation ; renvoie `false` si la séance était déjà validée (course entre deux validateurs). */
export async function setValidated(tx: Tx, id: string, by: string, at: Date): Promise<boolean> {
  const res = await tx.query(
    `UPDATE scheduling.session_occurrences SET validated_at = $2, validated_by = $3, updated_at = $2
      WHERE tenant_id = kernel.current_tenant_id() AND id = $1 AND validated_at IS NULL AND status = 'HELD'`,
    [id, at, by],
  );
  return res.rowCount === 1;
}

export async function clearValidated(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.session_occurrences SET validated_at = NULL, validated_by = NULL, updated_at = $2 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`,
    [id, at],
  );
}

export async function setOverride(tx: Tx, id: string, reason: string, by: string, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.session_occurrences SET conflict_override = true, conflict_override_reason = $2, conflict_override_by = $3, updated_at = $4
      WHERE tenant_id = kernel.current_tenant_id() AND id = $1`,
    [id, reason, by, at],
  );
}

export async function setNeedsReplacement(tx: Tx, ids: readonly string[], reason: ReplacementReason | null, at: Date): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await tx.query(
    `UPDATE scheduling.session_occurrences SET needs_replacement = $2::text IS NOT NULL, replacement_reason = $2, updated_at = $3
      WHERE tenant_id = kernel.current_tenant_id() AND id = ANY($1::uuid[])`,
    [ids, reason, at],
  );
  return res.rowCount;
}

export async function updateStaffRole(tx: Tx, occurrenceId: string, staffId: string, role: StaffRole, isPaidRole: boolean, at: Date): Promise<void> {
  await tx.query(
    `UPDATE scheduling.occurrence_staff SET role = $3, is_paid_role = $4, updated_at = $5 WHERE tenant_id = kernel.current_tenant_id() AND occurrence_id = $1 AND staff_id = $2`,
    [occurrenceId, staffId, role, isPaidRole, at],
  );
}

export async function setPaidMinutes(tx: Tx, occurrenceId: string, staffId: string, minutes: number | null, by: string | null, at: Date): Promise<boolean> {
  const res = await tx.query(
    minutes === null
      ? `UPDATE scheduling.occurrence_staff SET paid_minutes = NULL, paid_minutes_by = NULL, paid_minutes_at = NULL, updated_at = $3 WHERE tenant_id = kernel.current_tenant_id() AND occurrence_id = $1 AND staff_id = $2`
      : `UPDATE scheduling.occurrence_staff SET paid_minutes = $4, paid_minutes_by = $5, paid_minutes_at = $3, updated_at = $3 WHERE tenant_id = kernel.current_tenant_id() AND occurrence_id = $1 AND staff_id = $2`,
    minutes === null ? [occurrenceId, staffId, at] : [occurrenceId, staffId, at, minutes, by],
  );
  return res.rowCount === 1;
}

// ---------------------------------------------------------------------------
// Réservations (conflits)
// ---------------------------------------------------------------------------

export interface ClaimQuery {
  during: { start: Date; end: Date };
  staffIds: readonly string[];
  /** Identifiant de la famille CLASSROOM : classe, ou offre à la carte. */
  classroomKey: string | null;
  roomId: string | null;
  excludeOccurrenceId: string | null;
}

export async function findClaimHits(tx: Tx, q: ClaimQuery): Promise<ClaimHit[]> {
  const rows = await tx.many(
    `SELECT c.resource_kind, c.resource_id, c.occurrence_id, lower(c.during) AS starts_at, upper(c.during) AS ends_at, c.exclusive, o.title, o.classroom_id
       FROM scheduling.find_conflicts(tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3::uuid[], $4::uuid, $5::uuid, $6::uuid) c
       JOIN scheduling.session_occurrences o ON o.tenant_id = kernel.current_tenant_id() AND o.id = c.occurrence_id
      ORDER BY lower(c.during), c.resource_kind, c.resource_id`,
    [q.during.start, q.during.end, [...q.staffIds], q.classroomKey, q.roomId, q.excludeOccurrenceId],
  );
  return rows.map((r) => ({
    resourceKind: r.resource_kind as ClaimResourceKind,
    resourceId: r.resource_id,
    occurrenceId: r.occurrence_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    exclusive: r.exclusive,
    title: r.title,
    classroomId: r.classroom_id,
  }));
}

export interface ExclusiveClaim {
  resourceKind: ClaimResourceKind;
  resourceId: string;
  occurrenceId: string;
  start: number;
  end: number;
}

/** Réservations exclusives qui touchent des ressources données dans une fenêtre (carnet de génération). */
export async function listExclusiveClaims(
  tx: Tx,
  window: { start: Date; end: Date },
  resources: { staffIds: readonly string[]; classroomKeys: readonly string[]; roomIds: readonly string[] },
): Promise<ExclusiveClaim[]> {
  const rows = await tx.many(
    `SELECT resource_kind, resource_id, occurrence_id, lower(during) AS s, upper(during) AS e
       FROM scheduling.resource_claims
      WHERE tenant_id = kernel.current_tenant_id() AND exclusive AND during && tstzrange($1::timestamptz, $2::timestamptz, '[)')
        AND ((resource_kind = 'STAFF' AND resource_id = ANY($3::uuid[]))
          OR (resource_kind = 'CLASSROOM' AND resource_id = ANY($4::uuid[]))
          OR (resource_kind = 'ROOM' AND resource_id = ANY($5::uuid[])))`,
    [window.start, window.end, [...resources.staffIds], [...resources.classroomKeys], [...resources.roomIds]],
  );
  return rows.map((r) => ({
    resourceKind: r.resource_kind as ClaimResourceKind,
    resourceId: r.resource_id,
    occurrenceId: r.occurrence_id,
    start: (r.s as Date).getTime(),
    end: (r.e as Date).getTime(),
  }));
}

export async function equipmentInUse(tx: Tx, equipmentId: string, during: { start: Date; end: Date }, excludeOccurrenceId: string | null): Promise<number> {
  const row = await tx.queryOne<{ used: number }>(`SELECT scheduling.equipment_in_use($1::uuid, tstzrange($2::timestamptz, $3::timestamptz, '[)'), $4::uuid) AS used`, [
    equipmentId,
    during.start,
    during.end,
    excludeOccurrenceId,
  ]);
  return row?.used ?? 0;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export interface ChangeRow {
  id: string;
  occurrenceId: string;
  kind: string;
  fromValue: unknown;
  toValue: unknown;
  reason: string | null;
  actorId: string | null;
  changedAt: Date;
}

export async function listChanges(tx: Tx, occurrenceId: string): Promise<ChangeRow[]> {
  const rows = await tx.many(
    `SELECT id, occurrence_id, kind, from_value, to_value, reason, actor_id, changed_at FROM scheduling.occurrence_changes
      WHERE tenant_id = kernel.current_tenant_id() AND occurrence_id = $1 ORDER BY seq`,
    [occurrenceId],
  );
  return rows.map((r) => ({
    id: r.id,
    occurrenceId: r.occurrence_id,
    kind: r.kind,
    fromValue: r.from_value,
    toValue: r.to_value,
    reason: r.reason,
    actorId: r.actor_id,
    changedAt: r.changed_at,
  }));
}
