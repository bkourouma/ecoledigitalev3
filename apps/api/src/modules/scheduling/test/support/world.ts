/**
 * Monde de test : base jetable, dépendances avec ports EN MÉMOIRE (academic, people, attendance),
 * horloge figée, audit enregistré, et fabriques pour les scénarios.
 */
import { ManualClock, createRequestContext, newId, type RequestContext, type Result, type AppError } from "@ecoledigitale/kernel";
import { expect } from "vitest";
import { createSchedulingDeps, type SchedulingDeps } from "../../application/deps";
import { RecordingAudit } from "../../application/ports/audit";
import { InMemoryAcademicQuery, InMemoryAttendanceQuery, InMemoryPeopleQuery } from "../../application/ports/in-memory";
import type { StaffInfo } from "../../application/ports/people";
import { createRoom, seedReference, createEquipmentItem } from "../../application/reference";
import type { Room, EquipmentItem } from "../../domain/types";
import { adminRows, createSchedulingTestDb, type SchedulingTestDb } from "./db";

export interface World {
  db: SchedulingTestDb;
  deps: SchedulingDeps;
  clock: ManualClock;
  audit: RecordingAudit;
  academic: InMemoryAcademicQuery;
  people: InMemoryPeopleQuery;
  attendance: InMemoryAttendanceQuery;
  tenantId: string;
  ctx: RequestContext;
  institutionId: string;
  campusId: string;
  yearId: string;
  /** Contexte d'un autre utilisateur du même tenant. */
  ctxOf(userId?: string): RequestContext;
}

/** 1er octobre 2026, 07:00 UTC (un jeudi) : les séances de test sont placées autour de cette date. */
export const NOW = "2026-10-01T07:00:00.000Z";

export async function createWorld(options: { db?: SchedulingTestDb; timezone?: string } = {}): Promise<World> {
  const db = options.db ?? (await createSchedulingTestDb());
  const clock = new ManualClock(NOW);
  const audit = new RecordingAudit();
  const academic = new InMemoryAcademicQuery();
  const people = new InMemoryPeopleQuery();
  const attendance = new InMemoryAttendanceQuery();
  const deps = createSchedulingDeps({ db: db.tenantDb, clock, audit, ports: { academic, people, attendance } });
  const tenantId = await db.createTenant();
  const institutionId = newId();
  const ctxIn = (userId: string): RequestContext => createRequestContext({ tenantId, userId, roles: ["scheduler"], institutionId });
  const ctx = ctxIn(newId());
  const campusId = newId();
  const yearId = newId();
  academic.yearForDates = { academicYearId: yearId, periodId: null, from: "2026-09-01", to: "2027-07-31" };
  const seeded = await seedReference(deps, ctx);
  if (!seeded.ok) throw seeded.error;
  const world: World = {
    db,
    deps,
    clock,
    audit,
    academic,
    people,
    attendance,
    tenantId,
    ctx,
    institutionId,
    campusId,
    yearId,
    ctxOf: (userId = newId()) => ctxIn(userId),
  };
  if (options.timezone) {
    const { updateSchedulingSettings } = await import("../../application/reference");
    unwrap(await updateSchedulingSettings(deps, ctx, { institutionId, patch: { timezone: options.timezone } }));
  }
  return world;
}

export function unwrap<T>(r: Result<T, AppError>): T {
  if (!r.ok) throw r.error;
  return r.value;
}

export async function expectErr<T>(p: Promise<Result<T, AppError>>, code: string): Promise<AppError> {
  const r = await p;
  expect(r.ok, `succès inattendu (attendu : ${code})`).toBe(false);
  if (r.ok) throw new Error("unreachable");
  expect(r.error.code).toBe(code);
  return r.error;
}

export function addStaff(w: World, name: string, over: Partial<StaffInfo> = {}): string {
  const id = newId();
  w.people.addStaff({ id, displayName: name, status: "ACTIVE", userId: null, ...over });
  return id;
}

export interface ClassFixture {
  classroomId: string;
  nodeId: string;
  offeringId: string;
}

export function addClass(w: World, name = "6e A", over: { headcount?: number | null; hoursTotalMinutes?: number | null; subjectId?: string | null; aLaCarte?: boolean } = {}): ClassFixture {
  const classroomId = newId();
  const nodeId = newId();
  const offeringId = newId();
  w.academic.addClassroom({ id: classroomId, institutionId: w.institutionId, campusId: w.campusId, academicYearId: w.yearId, name, headcount: over.headcount ?? null });
  w.academic.addNode({ id: nodeId, label: `Matière de ${name}`, hoursTotalMinutes: over.hoursTotalMinutes ?? null, subjectId: over.subjectId ?? null });
  w.academic.addOffering({
    id: offeringId,
    classroomId,
    curriculumNodeId: nodeId,
    status: "OPEN",
    startsOn: null,
    endsOn: null,
    label: `Cours ${name}`,
    aLaCarte: over.aLaCarte ?? false,
    headcount: null,
  });
  return { classroomId, nodeId, offeringId };
}

export async function addRoom(w: World, code: string, capacity: number | null = null, features: string[] = []): Promise<Room> {
  return unwrap(await createRoom(w.deps, w.ctx, { institutionId: w.institutionId, campusId: w.campusId, code, name: code, roomTypeCode: "CLASSROOM", capacity, features }));
}

export async function addEquipment(w: World, code: string, quantity: number): Promise<EquipmentItem> {
  return unwrap(await createEquipmentItem(w.deps, w.ctx, { institutionId: w.institutionId, campusId: w.campusId, code, label: `Matériel ${code}`, quantity }));
}

/** Dates de test : lundi 5 octobre 2026 et jours suivants (UTC = heure locale à Abidjan). */
export const D = (day: number): string => `2026-10-${String(day).padStart(2, "0")}`;

export async function outboxTypes(w: World, aggregateId?: string): Promise<string[]> {
  const rows = await adminRows<{ type: string }>(
    w.db,
    aggregateId
      ? "SELECT type FROM kernel.domain_events WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY occurred_at, id"
      : "SELECT type FROM kernel.domain_events WHERE tenant_id = $1 ORDER BY occurred_at, id",
    aggregateId ? [w.tenantId, aggregateId] : [w.tenantId],
  );
  return rows.map((r) => r.type);
}

export { createRequestContext };
