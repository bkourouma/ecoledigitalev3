/**
 * Requêtes de lecture (vues, files de travail, rapports). Aucune écriture. Les filtres sont construits
 * à partir de clauses FIXES et de paramètres liés : jamais de nom de colonne issu d'une entrée.
 */
import type { Tx } from "@ecoledigitale/database";
import type { Occurrence, OccurrenceKind, OccurrenceStatus, PayableHourLine } from "../domain/types";
import { OCC_COLUMNS, mapOccurrence } from "./occurrence-repo";

export interface OccurrenceFilter {
  /** Fenêtre sur la date civile locale `occurs_on` (bornes incluses). */
  from?: string;
  to?: string;
  institutionId?: string;
  classroomId?: string;
  offeringId?: string;
  roomId?: string;
  staffId?: string;
  curriculumNodeId?: string;
  timetableId?: string;
  /** Vue élève/parent : séances de ces classes (réunies) ou de ces offres. */
  studentScope?: { classroomIds: readonly string[]; offeringIds: readonly string[] };
  statuses?: readonly OccurrenceStatus[];
  kinds?: readonly OccurrenceKind[];
  validated?: boolean;
  needsReplacement?: boolean;
  /** Séances terminées avant cet instant (séances non constatées). */
  endedBefore?: Date;
  /** Exclut les séances comptables (agendas : elles n'ont pas de plage réelle). */
  excludeAccounting?: boolean;
  /** Portails : emploi du temps publié uniquement, séances comptables exclues. */
  portalOnly?: boolean;
  /** Tri « passé d'abord (récent → ancien) puis futur », autour de cet instant. */
  pastFirstAround?: Date;
  limit?: number;
  offset?: number;
}

export const MAX_PAGE = 500;

interface Built {
  where: string;
  params: unknown[];
}

function buildWhere(f: OccurrenceFilter): Built {
  const params: unknown[] = [];
  const clauses: string[] = ["o.tenant_id = kernel.current_tenant_id()"];
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.from) clauses.push(`o.occurs_on >= ${p(f.from)}::date`);
  if (f.to) clauses.push(`o.occurs_on <= ${p(f.to)}::date`);
  if (f.institutionId) clauses.push(`o.institution_id = ${p(f.institutionId)}`);
  if (f.classroomId) clauses.push(`o.classroom_id = ${p(f.classroomId)}`);
  if (f.offeringId) clauses.push(`o.offering_id = ${p(f.offeringId)}`);
  if (f.roomId) clauses.push(`o.room_id = ${p(f.roomId)}`);
  if (f.curriculumNodeId) clauses.push(`o.curriculum_node_id = ${p(f.curriculumNodeId)}`);
  if (f.staffId) clauses.push(`EXISTS (SELECT 1 FROM scheduling.occurrence_staff s WHERE s.tenant_id = o.tenant_id AND s.occurrence_id = o.id AND s.staff_id = ${p(f.staffId)})`);
  if (f.timetableId) {
    clauses.push(
      `EXISTS (SELECT 1 FROM scheduling.timetable_entries e WHERE e.tenant_id = o.tenant_id AND e.id = o.timetable_entry_id AND e.timetable_id = ${p(f.timetableId)})`,
    );
  }
  if (f.studentScope) {
    const cls = p([...f.studentScope.classroomIds]);
    const off = p([...f.studentScope.offeringIds]);
    clauses.push(`((o.classroom_id = ANY(${cls}::uuid[]) AND o.claims_classroom) OR o.offering_id = ANY(${off}::uuid[]))`);
  }
  if (f.statuses && f.statuses.length > 0) clauses.push(`o.status = ANY(${p([...f.statuses])}::text[])`);
  if (f.kinds && f.kinds.length > 0) clauses.push(`o.kind = ANY(${p([...f.kinds])}::text[])`);
  if (f.validated === true) clauses.push("o.validated_at IS NOT NULL");
  if (f.validated === false) clauses.push("o.validated_at IS NULL");
  if (f.needsReplacement === true) clauses.push("o.needs_replacement");
  if (f.endedBefore) clauses.push(`o.ends_at < ${p(f.endedBefore)}::timestamptz`);
  if (f.excludeAccounting) clauses.push("o.origin <> 'ACCOUNTING'");
  if (f.portalOnly) {
    clauses.push("o.origin <> 'ACCOUNTING'");
    clauses.push(
      `(o.timetable_entry_id IS NULL OR EXISTS (SELECT 1 FROM scheduling.timetable_entries e JOIN scheduling.timetables t ON t.tenant_id = e.tenant_id AND t.id = e.timetable_id
         WHERE e.tenant_id = o.tenant_id AND e.id = o.timetable_entry_id AND t.status = 'PUBLISHED'))`,
    );
  }
  return { where: clauses.join(" AND "), params };
}

export async function listOccurrenceRows(tx: Tx, f: OccurrenceFilter): Promise<{ items: Occurrence[]; hasMore: boolean }> {
  const { where, params } = buildWhere(f);
  const limit = Math.min(Math.max(f.limit ?? 100, 1), MAX_PAGE);
  const offset = Math.max(f.offset ?? 0, 0);
  let order = "o.starts_at, o.id";
  if (f.pastFirstAround) {
    params.push(f.pastFirstAround);
    const n = `$${params.length}::timestamptz`;
    order = `(o.starts_at > ${n}), (CASE WHEN o.starts_at <= ${n} THEN -extract(epoch FROM o.starts_at) ELSE extract(epoch FROM o.starts_at) END), o.id`;
  }
  params.push(limit + 1, offset);
  const rows = await tx.many(
    `SELECT ${OCC_COLUMNS} FROM scheduling.session_occurrences o WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const items = rows.slice(0, limit).map(mapOccurrence);
  return { items, hasMore: rows.length > limit };
}

export async function countOccurrences(tx: Tx, f: OccurrenceFilter): Promise<number> {
  const { where, params } = buildWhere(f);
  const row = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM scheduling.session_occurrences o WHERE ${where}`, params);
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Heures payables
// ---------------------------------------------------------------------------

export async function payableLines(tx: Tx, range: { from: string; to: string }, staffIds: readonly string[] | null): Promise<PayableHourLine[]> {
  const rows = await tx.many(
    `SELECT occurrence_id, staff_id, occurs_on::text AS occurs_on, minutes, kind, classroom_id, curriculum_node_id, offering_id, title, locked, lock_ref
       FROM scheduling.payable_hours($1::date, $2::date, $3::uuid[])
      ORDER BY occurs_on, staff_id, occurrence_id`,
    [range.from, range.to, staffIds === null ? null : [...staffIds]],
  );
  return rows.map((r) => ({
    occurrenceId: r.occurrence_id,
    staffId: r.staff_id,
    occursOn: r.occurs_on,
    minutes: r.minutes,
    kind: r.kind as OccurrenceKind,
    classroomId: r.classroom_id,
    nodeId: r.curriculum_node_id,
    offeringId: r.offering_id,
    title: r.title,
    locked: r.locked,
    lockRef: r.lock_ref,
  }));
}

/** Lignes d'intervenants à verrouiller, avec verrou de ligne (ordre stable : aucun interblocage entre lots). */
export async function lockStaffRowsForUpdate(
  tx: Tx,
  lines: ReadonlyArray<{ occurrenceId: string; staffId: string }>,
): Promise<Array<{ occurrenceId: string; staffId: string; lockedAt: Date | null; lockRef: string | null }>> {
  const rows = await tx.many(
    `SELECT s.occurrence_id, s.staff_id, s.locked_at, s.lock_ref
       FROM scheduling.occurrence_staff s
       JOIN unnest($1::uuid[], $2::uuid[]) AS want(occurrence_id, staff_id) ON want.occurrence_id = s.occurrence_id AND want.staff_id = s.staff_id
      WHERE s.tenant_id = kernel.current_tenant_id()
      ORDER BY s.occurrence_id, s.staff_id
        FOR UPDATE OF s`,
    [lines.map((l) => l.occurrenceId), lines.map((l) => l.staffId)],
  );
  return rows.map((r) => ({ occurrenceId: r.occurrence_id, staffId: r.staff_id, lockedAt: r.locked_at, lockRef: r.lock_ref }));
}

export async function applyLock(tx: Tx, lines: ReadonlyArray<{ occurrenceId: string; staffId: string }>, lockRef: string, at: Date): Promise<number> {
  const res = await tx.query(
    `UPDATE scheduling.occurrence_staff s SET locked_at = $3, lock_ref = $4, updated_at = $3
       FROM unnest($1::uuid[], $2::uuid[]) AS want(occurrence_id, staff_id)
      WHERE s.tenant_id = kernel.current_tenant_id() AND s.occurrence_id = want.occurrence_id AND s.staff_id = want.staff_id AND s.locked_at IS NULL`,
    [lines.map((l) => l.occurrenceId), lines.map((l) => l.staffId), at, lockRef],
  );
  return res.rowCount;
}

export async function listLockedByRef(tx: Tx, lockRef: string): Promise<Array<{ occurrenceId: string; staffId: string }>> {
  const rows = await tx.many<{ occurrence_id: string; staff_id: string }>(
    `SELECT occurrence_id, staff_id FROM scheduling.occurrence_staff WHERE tenant_id = kernel.current_tenant_id() AND lock_ref = $1 ORDER BY occurrence_id, staff_id FOR UPDATE`,
    [lockRef],
  );
  return rows.map((r) => ({ occurrenceId: r.occurrence_id, staffId: r.staff_id }));
}

/** Déverrouille toutes les lignes d'un `lockRef` (la voie dédiée : réglage `scheduling.payroll_unlock`). */
export async function releaseLock(tx: Tx, lockRef: string, at: Date): Promise<number> {
  await tx.query("SELECT set_config('scheduling.payroll_unlock', 'on', true)");
  try {
    const res = await tx.query(
      `UPDATE scheduling.occurrence_staff SET locked_at = NULL, lock_ref = NULL, updated_at = $2 WHERE tenant_id = kernel.current_tenant_id() AND lock_ref = $1`,
      [lockRef, at],
    );
    return res.rowCount;
  } finally {
    await tx.query("SELECT set_config('scheduling.payroll_unlock', '', true)");
  }
}

// ---------------------------------------------------------------------------
// Rapports
// ---------------------------------------------------------------------------

export interface ValidatedOverlap {
  staffId: string;
  occurrenceA: string;
  occurrenceB: string;
  overlapStart: Date;
  overlapEnd: Date;
}

/** Deux séances VALIDÉES d'un même intervenant qui se chevauchent (information pour la paie, jamais un blocage). */
export async function validatedOverlaps(tx: Tx, range: { from: string; to: string }, staffIds: readonly string[] | null): Promise<ValidatedOverlap[]> {
  const rows = await tx.many(
    `SELECT sa.staff_id, oa.id AS a, ob.id AS b, greatest(oa.starts_at, ob.starts_at) AS s, least(oa.ends_at, ob.ends_at) AS e
       FROM scheduling.session_occurrences oa
       JOIN scheduling.occurrence_staff sa ON sa.tenant_id = oa.tenant_id AND sa.occurrence_id = oa.id
       JOIN scheduling.occurrence_staff sb ON sb.tenant_id = oa.tenant_id AND sb.staff_id = sa.staff_id AND sb.occurrence_id <> sa.occurrence_id
       JOIN scheduling.session_occurrences ob ON ob.tenant_id = sb.tenant_id AND ob.id = sb.occurrence_id
      WHERE oa.tenant_id = kernel.current_tenant_id()
        AND oa.id < ob.id
        AND oa.status = 'HELD' AND oa.validated_at IS NOT NULL AND ob.status = 'HELD' AND ob.validated_at IS NOT NULL
        AND oa.occurs_on BETWEEN $1::date AND $2::date AND ob.occurs_on BETWEEN $1::date - 1 AND $2::date + 1
        AND oa.during && ob.during
        AND ($3::uuid[] IS NULL OR sa.staff_id = ANY($3::uuid[]))
      ORDER BY sa.staff_id, s, a, b`,
    [range.from, range.to, staffIds === null ? null : [...staffIds]],
  );
  return rows.map((r) => ({ staffId: r.staff_id, occurrenceA: r.a, occurrenceB: r.b, overlapStart: r.s, overlapEnd: r.e }));
}

export interface RoomOccupancyRow {
  roomId: string;
  occupiedMinutes: number;
}

/** Minutes d'occupation par salle d'un campus (union des plages : deux séances simultanées ne comptent qu'une fois). */
export async function roomOccupancy(tx: Tx, campusId: string, range: { from: string; to: string }): Promise<RoomOccupancyRow[]> {
  const rows = await tx.many(
    `SELECT r.id AS room_id,
            coalesce((SELECT round(sum(extract(epoch FROM upper(x) - lower(x))) / 60)::integer
                        FROM (SELECT unnest(range_agg(o.during)) AS x
                                FROM scheduling.session_occurrences o
                               WHERE o.tenant_id = r.tenant_id AND o.room_id = r.id AND o.status <> 'CANCELLED'
                                 AND o.occurs_on BETWEEN $2::date AND $3::date) u), 0) AS minutes
       FROM scheduling.rooms r
      WHERE r.tenant_id = kernel.current_tenant_id() AND r.campus_id = $1 AND r.status <> 'ARCHIVED'
      ORDER BY r.code`,
    [campusId, range.from, range.to],
  );
  return rows.map((r) => ({ roomId: r.room_id, occupiedMinutes: Number(r.minutes) }));
}

export interface StaffLoadRow {
  occursOn: string;
  minutes: number;
}

/** Minutes planifiées (hors annulées) d'un intervenant par jour, sur une plage de dates. */
export async function staffLoadByDay(tx: Tx, staffId: string, range: { from: string; to: string }): Promise<StaffLoadRow[]> {
  const rows = await tx.many(
    `SELECT o.occurs_on::text AS occurs_on, round(sum(extract(epoch FROM o.ends_at - o.starts_at)) / 60)::integer AS minutes
       FROM scheduling.session_occurrences o
       JOIN scheduling.occurrence_staff s ON s.tenant_id = o.tenant_id AND s.occurrence_id = o.id
      WHERE o.tenant_id = kernel.current_tenant_id() AND s.staff_id = $1 AND o.status <> 'CANCELLED' AND o.occurs_on BETWEEN $2::date AND $3::date
      GROUP BY o.occurs_on ORDER BY o.occurs_on`,
    [staffId, range.from, range.to],
  );
  return rows.map((r) => ({ occursOn: r.occurs_on, minutes: Number(r.minutes) }));
}

/** Minutes planifiées par (classe, nœud) pour le plafond d'heures de la génération. */
export async function plannedMinutesByNode(tx: Tx, classroomIds: readonly string[], academicYearId: string): Promise<Map<string, number>> {
  const rows = await tx.many(
    `SELECT o.classroom_id, o.curriculum_node_id, round(sum(extract(epoch FROM o.ends_at - o.starts_at)) / 60)::integer AS minutes
       FROM scheduling.session_occurrences o
      WHERE o.tenant_id = kernel.current_tenant_id() AND o.academic_year_id = $2 AND o.kind = 'LESSON' AND o.status <> 'CANCELLED'
        AND o.origin <> 'ACCOUNTING' AND o.classroom_id = ANY($1::uuid[])
      GROUP BY o.classroom_id, o.curriculum_node_id`,
    [[...classroomIds], academicYearId],
  );
  return new Map(rows.map((r) => [`${r.classroom_id}|${r.curriculum_node_id}`, Number(r.minutes)]));
}

/** Futures séances PLANNED non constatées où des intervenants (donnés) sont affectés. */
export async function futurePlannedForStaff(
  tx: Tx,
  staffIds: readonly string[],
  after: Date,
  until: Date | null,
  classroomId: string | null = null,
): Promise<Array<{ occurrenceId: string; staffId: string }>> {
  const rows = await tx.many<{ occurrence_id: string; staff_id: string }>(
    `SELECT o.id AS occurrence_id, s.staff_id
       FROM scheduling.session_occurrences o
       JOIN scheduling.occurrence_staff s ON s.tenant_id = o.tenant_id AND s.occurrence_id = o.id
      WHERE o.tenant_id = kernel.current_tenant_id() AND o.status = 'PLANNED' AND o.validated_at IS NULL AND o.starts_at >= $2::timestamptz
        AND ($3::timestamptz IS NULL OR o.starts_at < $3::timestamptz) AND s.staff_id = ANY($1::uuid[])
        AND ($4::uuid IS NULL OR o.classroom_id = $4::uuid)
      ORDER BY o.starts_at, o.id`,
    [[...staffIds], after, until, classroomId],
  );
  return rows.map((r) => ({ occurrenceId: r.occurrence_id, staffId: r.staff_id }));
}

/** Identifiants des séances futures PLANNED non validées d'une offre ou d'une classe (annulation en cascade). */
export async function futurePlannedByTarget(tx: Tx, target: { offeringId?: string; classroomId?: string }, after: Date): Promise<string[]> {
  const rows = await tx.many<{ id: string }>(
    `SELECT id FROM scheduling.session_occurrences
      WHERE tenant_id = kernel.current_tenant_id() AND status = 'PLANNED' AND validated_at IS NULL AND starts_at >= $1::timestamptz
        AND (($2::uuid IS NOT NULL AND offering_id = $2::uuid) OR ($3::uuid IS NOT NULL AND classroom_id = $3::uuid))
      ORDER BY starts_at, id FOR UPDATE`,
    [after, target.offeringId ?? null, target.classroomId ?? null],
  );
  return rows.map((r) => r.id);
}

/** Minutes planifiées (hors annulées) par intervenant sur une plage de dates : charge hebdomadaire des remplaçants. */
export async function staffMinutesInRange(tx: Tx, staffIds: readonly string[], range: { from: string; to: string }): Promise<Map<string, number>> {
  if (staffIds.length === 0) return new Map();
  const rows = await tx.many<{ staff_id: string; minutes: string }>(
    `SELECT s.staff_id, round(sum(extract(epoch FROM o.ends_at - o.starts_at)) / 60)::text AS minutes
       FROM scheduling.session_occurrences o
       JOIN scheduling.occurrence_staff s ON s.tenant_id = o.tenant_id AND s.occurrence_id = o.id
      WHERE o.tenant_id = kernel.current_tenant_id() AND o.status <> 'CANCELLED' AND s.staff_id = ANY($1::uuid[]) AND o.occurs_on BETWEEN $2::date AND $3::date
      GROUP BY s.staff_id`,
    [[...staffIds], range.from, range.to],
  );
  return new Map(rows.map((r) => [r.staff_id, Number(r.minutes)]));
}

/** Intervenants (parmi `staffIds`) déjà réservés de façon exclusive sur la plage. */
export async function busyStaff(tx: Tx, staffIds: readonly string[], during: { start: Date; end: Date }, excludeOccurrenceId: string | null): Promise<Set<string>> {
  if (staffIds.length === 0) return new Set();
  const rows = await tx.many<{ resource_id: string }>(
    `SELECT DISTINCT resource_id FROM scheduling.resource_claims
      WHERE tenant_id = kernel.current_tenant_id() AND resource_kind = 'STAFF' AND exclusive AND resource_id = ANY($1::uuid[])
        AND during && tstzrange($2::timestamptz, $3::timestamptz, '[)') AND ($4::uuid IS NULL OR occurrence_id <> $4::uuid)`,
    [[...staffIds], during.start, during.end, excludeOccurrenceId],
  );
  return new Set(rows.map((r) => r.resource_id));
}

export interface StudentOverlap {
  targetOccurrenceId: string;
  otherOccurrenceId: string;
  startsAt: Date;
  endsAt: Date;
  otherOfferingId: string | null;
  otherClassroomId: string | null;
}

/** Séances futures d'une offre qui chevauchent d'autres séances des placements d'un apprenant. */
export async function studentOfferingOverlaps(
  tx: Tx,
  offeringId: string,
  placements: { classroomIds: readonly string[]; offeringIds: readonly string[] },
  after: Date,
  limit = 100,
): Promise<StudentOverlap[]> {
  const rows = await tx.many(
    `SELECT a.id AS target_id, b.id AS other_id, greatest(a.starts_at, b.starts_at) AS s, least(a.ends_at, b.ends_at) AS e, b.offering_id, b.classroom_id
       FROM scheduling.session_occurrences a
       JOIN scheduling.session_occurrences b ON b.tenant_id = a.tenant_id AND b.id <> a.id AND b.status <> 'CANCELLED' AND b.during && a.during
      WHERE a.tenant_id = kernel.current_tenant_id() AND a.offering_id = $1 AND a.status <> 'CANCELLED' AND a.ends_at > $4::timestamptz
        AND b.offering_id IS DISTINCT FROM $1
        AND ((b.classroom_id = ANY($2::uuid[]) AND b.claims_classroom) OR b.offering_id = ANY($3::uuid[]))
      ORDER BY s, a.id, b.id LIMIT $5`,
    [offeringId, [...placements.classroomIds], [...placements.offeringIds], after, limit],
  );
  return rows.map((r) => ({ targetOccurrenceId: r.target_id, otherOccurrenceId: r.other_id, startsAt: r.s, endsAt: r.e, otherOfferingId: r.offering_id, otherClassroomId: r.classroom_id }));
}
