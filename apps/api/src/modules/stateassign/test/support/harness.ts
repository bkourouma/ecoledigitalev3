/**
 * Harnais des tests d'intégration de stateassign : base jetable migrée (baseline + module), rôle applicatif soumis à la RLS,
 * monde en mémoire pour les ports (academic, finance, attendance, documents, people), audit enregistreur, horloge manuelle.
 */
import { randomUUID } from "node:crypto";
import { ManualClock, createRequestContext, createSystemContext, type RequestContext } from "@ecoledigitale/kernel";
import { createStateassignDeps, type StateassignDeps } from "../../application/deps";
import { InMemoryWorld } from "../../infrastructure/in-memory-ports";
import { RecordingAudit } from "../../application/ports";
import { createModuleTestDb, type ModuleTestDb } from "./db";

export const uuid = (): string => randomUUID();

/** Personnes de test : identifiants stables (jamais d'identité réelle). */
export const PEOPLE = {
  secretary: "0192f0a4-7b1e-7c3a-8d2e-0000000000b1",
  bursar: "0192f0a4-7b1e-7c3a-8d2e-0000000000b2",
  director: "0192f0a4-7b1e-7c3a-8d2e-0000000000b3",
  parent: "0192f0a4-7b1e-7c3a-8d2e-0000000000b4",
} as const;

export interface Env {
  readonly db: ModuleTestDb;
  readonly world: InMemoryWorld;
  readonly audit: RecordingAudit;
  readonly clock: ManualClock;
  readonly deps: StateassignDeps;
  tenant(slug?: string): Promise<string>;
  user(tenantId: string, userId: string, extra?: { institutionId?: string; roles?: string[] }): RequestContext;
  system(tenantId: string): RequestContext;
  /** Inscription connue du monde (academic), prête pour un dossier. */
  enroll(input?: { institutionId?: string; yearId?: string; studentName?: string; status?: string }): { enrollmentId: string; studentId: string; institutionId: string; yearId: string };
  close(): Promise<void>;
}

export async function createEnv(options: { startAt?: string } = {}): Promise<Env> {
  const db = await createModuleTestDb();
  const world = new InMemoryWorld();
  const audit = new RecordingAudit();
  const clock = new ManualClock(new Date(options.startAt ?? "2026-10-15T09:00:00.000Z"));
  const deps = createStateassignDeps({ db: db.tenantDb, clock, audit, ports: world });
  let n = 0;
  return {
    db,
    world,
    audit,
    clock,
    deps,
    async tenant(slug) {
      n += 1;
      return db.createTenant(slug ?? `t${n}-${uuid().slice(0, 6)}`);
    },
    user: (tenantId, userId, extra = {}) => createRequestContext({ tenantId, userId, roles: extra.roles ?? [], ...(extra.institutionId ? { institutionId: extra.institutionId } : {}) }),
    system: (tenantId) => createSystemContext(tenantId),
    enroll(input = {}) {
      const institutionId = input.institutionId ?? uuid();
      const yearId = input.yearId ?? uuid();
      const enrollmentId = uuid();
      const studentId = uuid();
      world.addEnrollment({ enrollmentId, studentId, institutionId, academicYearId: yearId, ...(input.status ? { status: input.status } : {}) });
      if (input.studentName) world.studentNames.set(studentId, input.studentName);
      return { enrollmentId, studentId, institutionId, yearId };
    },
    close: () => db.drop(),
  };
}

/** Types d'événements d'outbox d'un agrégat, dans l'ordre d'écriture. */
export async function outboxTypes(db: ModuleTestDb, aggregateId: string): Promise<string[]> {
  const r = await db.admin.query("SELECT type FROM kernel.domain_events WHERE aggregate_id = $1 ORDER BY occurred_at, id", [aggregateId]);
  return r.rows.map((row: { type: string }) => row.type);
}

export async function outboxPayloads(db: ModuleTestDb, type: string): Promise<Array<Record<string, any>>> {
  const r = await db.admin.query("SELECT payload FROM kernel.domain_events WHERE type = $1 ORDER BY occurred_at, id", [type]);
  return r.rows.map((row: { payload: Record<string, any> }) => row.payload);
}

export function unwrapOk<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`Résultat attendu OK, reçu ${result.error.code} : ${result.error.message}`);
  return result.value;
}

export function errorCodeOf(result: { ok: boolean; error?: { code: string } }): string | null {
  return result.ok ? null : (result.error?.code ?? null);
}
