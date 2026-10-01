/** Dépendances communes des use cases `entitlements` et petits utilitaires. */
import { SystemDb, type TenantDb, type Tx } from "@ecoledigitale/database";
import {
  ValidationError,
  err,
  isAppError,
  newId as generateId,
  ok,
  systemClock,
  type AppError,
  type Clock,
  type Logger,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import type { ZodTypeAny, z } from "zod";

/** Audit de l'opération sensible, dans la MÊME transaction (convention 8). Branché par le module `audit`. */
export interface AuditEntry {
  action: string;
  resource: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  ctx: RequestContext;
}
export interface AuditRecorder {
  record(tx: Tx, entry: AuditEntry): Promise<void>;
}

/** Invalidation du cache de droits, appelée APRÈS le commit d'une modification. */
export interface CacheInvalidator {
  invalidate(tenantId: string): void;
  invalidateAll(): void;
}

export interface EntitlementsDeps {
  db: TenantDb;
  /** Défaut : `new SystemDb(db)`. */
  systemDb?: SystemDb;
  clock?: Clock;
  audit?: AuditRecorder;
  cache?: CacheInvalidator;
  logger?: Logger;
  /** Générateur d'identifiants ; défaut `newId()` du kernel (injectable en test). */
  newId?: () => string;
}

export interface ResolvedDeps {
  db: TenantDb;
  systemDb: SystemDb;
  clock: Clock;
  audit: AuditRecorder | undefined;
  cache: CacheInvalidator | undefined;
  newId: () => string;
}

export function resolveDeps(deps: EntitlementsDeps): ResolvedDeps {
  return {
    db: deps.db,
    systemDb: deps.systemDb ?? new SystemDb(deps.db, deps.logger ? { logger: deps.logger } : {}),
    clock: deps.clock ?? systemClock,
    audit: deps.audit,
    cache: deps.cache,
    newId: deps.newId ?? (() => generateId()),
  };
}

/** Valide `data` avec un schéma Zod ; l'échec devient une `ValidationError` (400) détaillée champ par champ. */
export function parseWith<S extends ZodTypeAny>(schema: S, data: unknown): Result<z.infer<S>, ValidationError> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return ok(parsed.data);
  return err(
    new ValidationError(
      "Données invalides.",
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
    ),
  );
}

/**
 * Exécute `fn` dans `db.run(ctx, ...)` et convertit les `AppError` levées en
 * `Err` : la transaction est ANNULÉE (l'exception traverse `run`), mais
 * l'appelant reçoit un `Result`. Les erreurs inattendues sont relancées.
 */
export async function runResult<T>(
  db: TenantDb,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
  options?: { readOnly?: boolean },
): Promise<Result<T, AppError>> {
  try {
    return ok(await db.run(ctx, fn, options));
  } catch (e) {
    if (isAppError(e)) return err(e);
    throw e;
  }
}

/** Idem pour une transaction système sans tenant (tables globales). */
export async function runSystemResult<T>(
  systemDb: SystemDb,
  reason: string,
  fn: (tx: Tx) => Promise<T>,
  options?: { readOnly?: boolean },
): Promise<Result<T, AppError>> {
  try {
    return ok(await systemDb.run(reason, fn, options));
  } catch (e) {
    if (isAppError(e)) return err(e);
    throw e;
  }
}
