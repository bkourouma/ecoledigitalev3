/**
 * Monde d'essai du moteur : base jetable migrée, deux tenants, un port cible FACTICE qui écrit dans une table de démonstration
 * (`public.demo_students`) par `db.run(ctx, …)` — donc dans la transaction du lot, exactement comme les vrais adaptateurs —
 * et un stockage d'objets en mémoire. Le moteur est ainsi éprouvé de bout en bout sans dépendre des modules cibles.
 */
import { createRequestContext, systemClock, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import type { ImportJobDto, ImporterKey } from "@ecoledigitale/contracts/src/v2/imports";
import { createImportsDeps, type ImportsDeps, type ImportsConfig } from "../../application/deps";
import { RecordingAudit, type ApplyItem, type ApplyResult, type ImportStoragePort, type ImportTargetPort, type PlanItem, type PlanResult, type PlanRun } from "../../application/ports";
import { setImportMapping, type Viewer } from "../../application/jobs";
import { processRun } from "../../application/run";
import { processValidation, requestImportValidation } from "../../application/validate";
import { requestImportRun } from "../../application/run";
import { uploadImportFile } from "../../application/upload";
import { issue } from "../../domain/types";
import { createModuleTestDb, type ModuleTestDb } from "./db";

export class MemoryStorage implements ImportStoragePort {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(key, new Uint8Array(bytes));
  }
  async get(key: string) {
    const b = this.objects.get(key);
    return b ? { bytes: b } : null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export interface DemoPortOptions {
  /** Références refusées à l'écriture (`FAILED`). */
  failRefs?: Set<string>;
  /** Références refusées à la planification (`ERROR`). */
  planErrorRefs?: Set<string>;
  /** Appelé avant chaque écriture (numéro d'appel à partir de 1) : point d'injection de pannes. */
  beforeApply?: (n: number, item: ApplyItem) => Promise<void> | void;
}

/** Port « élèves » factice : une ligne par référence dans `public.demo_students`, rien de plus. */
export class DemoStudentsPort implements ImportTargetPort {
  applyCalls = 0;
  planCalls = 0;
  constructor(
    private readonly db: TenantDb,
    private readonly options: DemoPortOptions = {},
  ) {}

  private refOf(item: PlanItem): string {
    return String((item.row as { externalRef?: string }).externalRef ?? item.key);
  }

  async plan(ctx: RequestContext, items: readonly PlanItem[], run: PlanRun): Promise<PlanResult[]> {
    const out: PlanResult[] = [];
    for (const item of items) {
      this.planCalls += 1;
      const ref = this.refOf(item);
      if (this.options.planErrorRefs?.has(ref)) {
        out.push({ rowNo: item.rowNo, action: "ERROR", issues: [issue(null, "people.possible_duplicate", "Doublon probable (essai).")] });
        continue;
      }
      const existing = await this.db.run(ctx, (tx) => tx.queryOne<{ id: string }>(`SELECT id FROM public.demo_students WHERE ref = $1`, [ref]));
      if (!existing) out.push({ rowNo: item.rowNo, action: "CREATE", issues: [] });
      else out.push({ rowNo: item.rowNo, action: run.onExisting === "UPDATE" ? "UPDATE" : "SKIP", entityId: existing.id, issues: [] });
    }
    return out;
  }

  async apply(ctx: RequestContext, item: ApplyItem): Promise<ApplyResult> {
    this.applyCalls += 1;
    await this.options.beforeApply?.(this.applyCalls, item);
    const ref = this.refOf(item);
    if (this.options.failRefs?.has(ref)) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("lastName", "people.external_ref_conflict", "Refusé par le module cible (essai).")] };
    const last = String((item.row as { lastName?: string }).lastName ?? "");
    return await this.db.run(ctx, async (tx) => {
      const existing = await tx.queryOne<{ id: string }>(`SELECT id FROM public.demo_students WHERE ref = $1`, [ref]);
      if (existing) {
        if (item.action !== "UPDATE") return { rowNo: item.rowNo, outcome: "SKIPPED" as const, entityId: existing.id, issues: [] };
        await tx.query(`UPDATE public.demo_students SET last_name = $2 WHERE id = $1`, [existing.id, last]);
        return { rowNo: item.rowNo, outcome: "UPDATED" as const, entityId: existing.id, issues: [] };
      }
      const row = await tx.queryOne<{ id: string }>(`INSERT INTO public.demo_students (id, tenant_id, ref, last_name) VALUES (gen_random_uuid(), current_setting('app.tenant_id')::uuid, $1, $2) RETURNING id`, [ref, last]);
      return { rowNo: item.rowNo, outcome: "CREATED" as const, entityId: (row as { id: string }).id, issues: [] };
    });
  }
}

export interface World {
  db: ModuleTestDb;
  tenantA: string;
  tenantB: string;
  storage: MemoryStorage;
  audit: RecordingAudit;
  userA: string;
  userB: string;
  /** Contexte de l'auteur (MFA satisfaite par défaut). */
  ctxA(overrides?: { mfa?: boolean; userId?: string }): RequestContext;
  ctxB(): RequestContext;
  deps(port: ImportTargetPort, config?: Partial<ImportsConfig>, key?: ImporterKey): ImportsDeps;
  viewer: Viewer;
  demoCount(tenant?: "A" | "B"): Promise<number>;
  drop(): Promise<void>;
}

export async function createWorld(): Promise<World> {
  const db = await createModuleTestDb();
  await db.admin.query(`CREATE TABLE public.demo_students (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, ref text NOT NULL, last_name text, UNIQUE (tenant_id, ref))`);
  await db.admin.query(`GRANT SELECT, INSERT, UPDATE ON public.demo_students TO app_user`);
  const tenantA = await db.createTenant("tenant-a");
  const tenantB = await db.createTenant("tenant-b");
  const storage = new MemoryStorage();
  const audit = new RecordingAudit();
  const userA = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
  const userB = "0192f0a4-7b1e-7c3a-8d2e-0000000000b2";
  return {
    db,
    tenantA,
    tenantB,
    storage,
    audit,
    userA,
    userB,
    ctxA: (o = {}) => createRequestContext({ tenantId: tenantA, userId: o.userId ?? userA, roles: ["directeur"], mfa: o.mfa ?? true }),
    ctxB: () => createRequestContext({ tenantId: tenantB, userId: userB, roles: ["directeur"], mfa: true }),
    deps(port, config = {}, key = "students") {
      return createImportsDeps({
        db: db.tenantDb,
        clock: systemClock,
        audit,
        ports: { targets: { [key]: port }, storage },
        config: { heartbeatMs: 25, leaseSeconds: 5, ...config },
      });
    },
    viewer: { manage: false },
    async demoCount(which = "A") {
      const r = await db.admin.query(`SELECT count(*)::int AS n FROM public.demo_students WHERE tenant_id = $1`, [which === "A" ? tenantA : tenantB]);
      return r.rows[0].n as number;
    },
    drop: () => db.drop(),
  };
}

/** Parcourt les étapes 1 à 3 : upload, mapping (celui proposé), validation (exécutée en ligne). */
export async function prepareJob(
  world: World,
  deps: ImportsDeps,
  ctx: RequestContext,
  bytes: Uint8Array,
  options: { fileName?: string; importerKey?: ImporterKey; runMode?: "ALL_OR_NOTHING" | "VALID_ONLY"; onExisting?: "SKIP" | "UPDATE"; importerOptions?: Record<string, string | number | boolean>; mapping?: Record<string, string | null> } = {},
): Promise<ImportJobDto> {
  const uploaded = unwrap(await uploadImportFile(deps, ctx, { importerKey: options.importerKey ?? "students", fileName: options.fileName ?? "eleves.csv", bytes }));
  const mapped = unwrap(
    await setImportMapping(
      deps,
      ctx,
      uploaded.job.id,
      { mapping: options.mapping ?? uploaded.suggestedMapping, ...(options.importerOptions ? { options: options.importerOptions } : {}), runMode: options.runMode ?? "VALID_ONLY", onExisting: options.onExisting ?? "SKIP" },
      world.viewer,
    ),
  );
  unwrap(await requestImportValidation(deps, ctx, mapped.id, world.viewer));
  const outcome = await processValidation(deps, ctx.tenantId, mapped.id, { workerId: `test-${mapped.id}` });
  if (!outcome.claimed) throw new Error("validation non prise en charge");
  const job = await world.db.admin.query(`SELECT status FROM imports.jobs WHERE id = $1`, [mapped.id]);
  if (job.rows[0].status !== "VALIDATED") throw new Error(`validation en échec : ${JSON.stringify(outcome)}`);
  return unwrap(await (await import("../../application/jobs")).getImportJob(deps, ctx, mapped.id, world.viewer));
}

/** Étape 6 : demande, puis exécution par un exécutant de test. */
export async function runJob(world: World, deps: ImportsDeps, ctx: RequestContext, jobId: string, mode: "ALL_OR_NOTHING" | "VALID_ONLY" = "VALID_ONLY", onExisting: "SKIP" | "UPDATE" = "SKIP", workerId = "test-worker") {
  unwrap(await requestImportRun(deps, ctx, jobId, { runMode: mode, onExisting, confirm: true }, world.viewer));
  return await processRun(deps, ctx.tenantId, jobId, { workerId });
}

export async function jobRow(world: World, jobId: string): Promise<Record<string, any>> {
  return (await world.db.admin.query(`SELECT * FROM imports.jobs WHERE id = $1`, [jobId])).rows[0] as Record<string, any>;
}

export { type ModuleTestDb };
