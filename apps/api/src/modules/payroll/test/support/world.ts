/** Monde de test d'intégration : tenant, doublures des ports, dépendances, fabriques de données. */
import { ManualClock, createRequestContext, newId, noopLogger, type RequestContext } from "@ecoledigitale/kernel";
import { expect } from "vitest";
import { createPayrollDeps, type PayrollDeps } from "../../application/deps";
import { RecordingAudit } from "../../application/audit";
import { inMemoryPorts, type InMemoryPayrollWorld } from "../../infrastructure/in-memory-ports";
import { createPayConfig, createHourlyRate, type ConfigInput, type RateInput } from "../../application/configs";
import { createPeriod, type CreatePeriodInput } from "../../application/periods";
import type { PayConfigRecord, PayPeriodRecord } from "../../domain/records";
import type { HourFact } from "../../domain/types";
import type { PayrollTestDb } from "./db";
import { adminRows } from "./db";
import type { AppError, Result } from "@ecoledigitale/kernel";

export function unwrap<T>(r: Result<T, AppError>): T {
  if (!r.ok) throw r.error;
  return r.value;
}

export async function expectErr<T>(p: Promise<Result<T, AppError>>, code: string): Promise<AppError> {
  const r = await p;
  if (r.ok) throw new Error(`Erreur attendue (${code}) mais succès`);
  expect(r.error.code).toBe(code);
  return r.error;
}

export interface World {
  db: PayrollTestDb;
  tenantId: string;
  yearId: string;
  clock: ManualClock;
  audit: RecordingAudit;
  deps: PayrollDeps;
  mem: InMemoryPayrollWorld;
  /** Comptable qui calcule par défaut. */
  accountant: string;
  ctxOf(userId?: string): RequestContext;
}

export async function createWorld(opts: { db: PayrollTestDb; tenantId?: string }): Promise<World> {
  const tenantId = opts.tenantId ?? (await opts.db.createTenant());
  const mem = inMemoryPorts();
  const audit = new RecordingAudit();
  const clock = new ManualClock(new Date());
  const deps = createPayrollDeps({ db: opts.db.tenantDb, clock, audit, ports: mem.ports as never, logger: noopLogger });
  const accountant = newId();
  mem.staff.nameUser(accountant, "Comptable Test");
  const w: World = {
    db: opts.db,
    tenantId,
    yearId: newId(),
    clock,
    audit,
    deps,
    mem,
    accountant,
    ctxOf: (userId = accountant) => createRequestContext({ tenantId, userId, roles: [] }),
  };
  return w;
}

export function addStaff(w: World, name: string, over: { userId?: string; active?: boolean; matricule?: string } = {}): string {
  const staffId = newId();
  w.mem.staff.add({ staffId, displayName: name, matricule: over.matricule ?? `M-${staffId.slice(-4)}`, active: over.active ?? true, userId: over.userId ?? null });
  return staffId;
}

export async function addConfig(w: World, over: Partial<ConfigInput> & { staffId: string }): Promise<PayConfigRecord> {
  return unwrap(
    await createPayConfig(w.deps, w.ctxOf(), {
      type: "HOURLY",
      defaultHourlyRate: 10_000,
      effectiveFrom: "2025-09-01",
      ...over,
    }),
  );
}

export async function addRate(w: World, over: Partial<RateInput> & { curriculumNodeId: string; rate: number }) {
  return unwrap(await createHourlyRate(w.deps, w.ctxOf(), { validFrom: "2025-09-01", ...over }));
}

export async function addPeriod(w: World, over: Partial<CreatePeriodInput> = {}): Promise<PayPeriodRecord> {
  return unwrap(await createPeriod(w.deps, w.ctxOf(), { name: `Paie ${newId().slice(-6)}`, startDate: "2026-01-05", endDate: "2026-01-31", academicYearId: w.yearId, ...over }));
}

/** Libère « la période en attente » pour pouvoir en créer une autre (les tests créent plusieurs périodes). */
export async function releasePending(w: World): Promise<void> {
  await w.db.admin.query("UPDATE payroll.pay_periods SET awaiting_calculation = false WHERE tenant_id = $1", [w.tenantId]);
}

let seq = 0;
const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Séance réalisée ET validée de `minutes` minutes à partir de 08:00 (payable). */
export function session(staffId: string, date: string, minutes: number, over: Partial<HourFact> = {}): HourFact {
  seq += 1;
  const start = over.startTime === undefined ? 8 * 60 : null;
  return {
    kind: "SESSION",
    refId: newId(),
    staffId,
    date,
    startTime: start === null ? null : hhmm(start),
    endTime: start === null ? null : hhmm(start + minutes),
    durationMinutes: null,
    paidMinutesOverride: null,
    realized: true,
    validated: true,
    nodeId: null,
    classroomId: null,
    label: `Séance ${seq}`,
    code: `S${seq}`,
    classroomLabel: null,
    ...over,
  };
}

/** Présence enseignant COMPLETED de `minutes` minutes (durée explicite). */
export function attendance(staffId: string, date: string, minutes: number, over: Partial<HourFact> = {}): HourFact {
  seq += 1;
  return {
    kind: "ATTENDANCE",
    refId: newId(),
    staffId,
    date,
    startTime: null,
    endTime: null,
    durationMinutes: minutes,
    paidMinutesOverride: null,
    realized: true,
    validated: true,
    nodeId: null,
    classroomId: null,
    label: `Présence ${seq}`,
    code: `P${seq}`,
    classroomLabel: null,
    ...over,
  };
}

/** `where` : la clause SQL ; `$1` est le tenant, les paramètres supplémentaires commencent à `$2`. */
export const payslipRows = (w: World, where = "TRUE", params: unknown[] = []) =>
  adminRows<Record<string, any>>(w.db, `SELECT * FROM payroll.payslips WHERE tenant_id = $1 AND ${where} ORDER BY created_at, id`, [w.tenantId, ...params]);

/** Requête exécutée SOUS la RLS du tenant (comme l'application) : pour les vues qui dépendent du contexte de tenant. */
export async function tenantRows<R = Record<string, any>>(w: World, sql: string, params: unknown[] = []): Promise<R[]> {
  return w.db.tenantDb.run(w.ctxOf(), (tx) => tx.many<R>(sql, params));
}
