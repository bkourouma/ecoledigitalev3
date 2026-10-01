/**
 * TenantDb : l'unique porte d'accès aux données pour le code applicatif.
 *
 *   await tenantDb.run(ctx, async (tx) => {
 *     const rows = await tx.many("SELECT id FROM academic.classes WHERE archived = false");
 *     ...
 *   });
 *
 * `run` ouvre une transaction, pose le contexte (`app.tenant_id`, `app.user_id`,
 * `app.actor`, `app.request_id`) en portée TRANSACTION, exécute `fn`, puis
 * COMMIT (ou ROLLBACK si `fn` lève). Les requêtes n'ont PAS besoin de
 * `WHERE tenant_id = $1` pour être isolées : c'est la RLS (rôle `app_user`) qui
 * l'impose. On l'écrit quand même quand cela sert un index ou la lisibilité.
 */
import {
  InternalError,
  ValidationError,
  isUuid,
  runWithContext,
  type RequestContext,
} from "@ecoledigitale/kernel";
import { TransactionExecutor, type DbActor, type ExecutorOptions, type SessionSettings } from "./executor";
import type { PgPoolLike, RunOptions, Tx } from "./types";

const ACTORS: readonly DbActor[] = ["user", "system", "superAdmin"];

export type TenantDbOptions = ExecutorOptions;

/**
 * Revalide un contexte même s'il vient du type `RequestContext` : un objet
 * fabriqué à la main ou désérialisé ne passe pas par `createRequestContext`.
 * Le `tenantId` est ensuite passé en paramètre SQL, jamais interpolé.
 */
export function settingsFromContext(ctx: RequestContext): SessionSettings {
  if (typeof ctx !== "object" || ctx === null) {
    throw new ValidationError("RequestContext manquant.");
  }
  if (!isUuid(ctx.tenantId)) {
    throw ValidationError.field("tenantId", "tenantId doit être un UUID valide.", "invalid_uuid");
  }
  if (!ACTORS.includes(ctx.actor)) {
    throw ValidationError.field("actor", "actor invalide.", "invalid_actor");
  }
  if (ctx.userId !== null && !isUuid(ctx.userId)) {
    throw ValidationError.field("userId", "userId doit être un UUID valide ou null.", "invalid_uuid");
  }
  if (ctx.actor !== "system" && ctx.userId === null) {
    throw ValidationError.field("userId", `Un acteur ${ctx.actor} exige un userId.`, "user_required");
  }
  if (typeof ctx.requestId !== "string" || ctx.requestId.length === 0 || ctx.requestId.length > 200) {
    throw ValidationError.field("requestId", "requestId invalide.", "invalid_request_id");
  }
  return {
    tenantId: ctx.tenantId.toLowerCase(),
    userId: ctx.userId ?? "",
    actor: ctx.actor,
    requestId: ctx.requestId,
    reason: "",
  };
}

export class TenantDb {
  /** @internal partagé avec SystemDb pour que les `run` imbriqués se reconnaissent. */
  readonly executor: TransactionExecutor;

  constructor(pool: PgPoolLike, options: TenantDbOptions = {}) {
    if (!pool || typeof pool.connect !== "function") {
      throw new InternalError("TenantDb : pool invalide.", { code: "DB_POOL_INVALID" });
    }
    this.executor = new TransactionExecutor(pool, options);
  }

  /**
   * Exécute `fn` dans une transaction portant l'identité de `ctx`.
   * Imbrication : un `run` à l'intérieur d'un `run` du MÊME contexte devient un
   * SAVEPOINT ; un contexte différent est refusé (`TX_IDENTITY_SWITCH`).
   * Pendant `fn`, `getRequestContext()` renvoie `ctx`.
   */
  async run<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>, options?: RunOptions): Promise<T> {
    const settings = settingsFromContext(ctx);
    return await this.executor.execute(settings, fn, options, (inner) => runWithContext(ctx, inner));
  }
}
