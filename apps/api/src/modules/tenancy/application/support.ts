/**
 * Dépendances communes des use cases `tenancy` et petits utilitaires.
 */
import { SystemDb, type TenantDb, type Tx } from "@ecoledigitale/database";
import {
  err,
  isAppError,
  newId as generateId,
  ok,
  systemClock,
  type AppError,
  type Clock,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import type { ZodTypeAny, z } from "zod";
import { ValidationError } from "@ecoledigitale/kernel";
import type { PackTemplates } from "../templates";
import { defaultPackTemplates } from "../templates";

/**
 * Audit de l'opération sensible, dans la MÊME transaction (convention 8). Port minimal, structurellement
 * compatible avec `AuditService` du module `audit` (`audit.record(tx, { action, entity, entityId, before, after })`) :
 * l'acteur, le tenant et la requête sont dérivés du RequestContext de la transaction.
 */
export interface AuditEntry {
  /** `entité.verbe`, ex. `tenancy.institution.create`. */
  action: string;
  /** Type d'objet (snake_case), ex. `institution`. */
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}
export interface AuditRecorder {
  record(tx: Tx, entry: AuditEntry): Promise<unknown>;
}

export interface TenancyDeps {
  db: TenantDb;
  /** Accès système (liste des tenants de la console). Défaut : `new SystemDb(db)`. */
  systemDb?: SystemDb;
  clock?: Clock;
  audit?: AuditRecorder;
  /** Modèles de pack ; défaut : ceux livrés dans `templates/`. */
  templates?: PackTemplates;
  /** Générateur d'identifiants ; défaut `newId()` du kernel (injectable en test). */
  newId?: () => string;
}

export interface ResolvedDeps {
  db: TenantDb;
  systemDb: SystemDb;
  clock: Clock;
  audit: AuditRecorder | undefined;
  templates: PackTemplates;
  newId: () => string;
}

export function resolveDeps(deps: TenancyDeps): ResolvedDeps {
  return {
    db: deps.db,
    systemDb: deps.systemDb ?? new SystemDb(deps.db),
    clock: deps.clock ?? systemClock,
    audit: deps.audit,
    templates: deps.templates ?? defaultPackTemplates(),
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

/** Idem pour une transaction système sans tenant (tables globales, console plateforme). */
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

/**
 * Exécute `fn` dans `db.run(ctx, ...)` et convertit les `AppError` levées en
 * `Err` : la transaction est ANNULÉE (l'exception traverse `run`), mais l'appelant
 * reçoit un `Result`. Les erreurs inattendues sont relancées telles quelles.
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
