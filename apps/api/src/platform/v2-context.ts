/**
 * Plateforme v2 côté API : pool Postgres applicatif, `TenantDb` / `SystemDb`, et
 * contexte de requête dérivé de l'authentification LEGACY.
 *
 *   await app.register(v2ContextPlugin, { connectionString, manifests });
 *   app.v2.tenantDb.run(request.ctx, async (tx) => ...)
 *
 * Garanties
 *  - Le rôle de connexion est vérifié au démarrage : superuser, BYPASSRLS, propriétaire
 *    (membre de `migrator`) ou non-membre de `app_user` ⇒ REFUS (le plugin lève, l'API
 *    ne démarre pas). Une RLS contournée n'isole rien (ADR-002).
 *  - `request.ctx` est posé APRÈS les hooks d'authentification legacy (même type de hook,
 *    enregistré plus tard). Il ne répond jamais, ne lève jamais et ne modifie aucune
 *    donnée legacy : sur une route legacy il n'a aucun effet observable.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { Pool } from "pg";
import { SystemDb, TenantBulkhead, TenantDb, bulkheadOptionsFromEnv, type BulkheadOptions } from "@ecoledigitale/database";
import {
  createRequestContext,
  isAppError,
  isUuid,
  newId,
  type Logger,
  type ModuleManifest,
  type RequestContext,
} from "@ecoledigitale/kernel";

// ---------------------------------------------------------------------------
// Types exposés
// ---------------------------------------------------------------------------

export interface V2Services {
  /** Accès transactionnel, isolé par RLS : l'UNIQUE porte d'accès aux données d'un tenant. */
  readonly tenantDb: TenantDb;
  /** Accès système explicite et audité (jobs, console plateforme). */
  readonly systemDb: SystemDb;
  /** Manifestes des modules chargés, en ordre topologique. */
  readonly manifests: readonly Readonly<ModuleManifest>[];
  readonly logger: Logger;
  /** Pool brut — réservé à la plateforme (synchronisation, santé) ; les modules n'y touchent pas. */
  readonly pool: Pool;
}

declare module "fastify" {
  interface FastifyInstance {
    v2: V2Services;
  }
  interface FastifyRequest {
    /**
     * Contexte v2. Garanti présent sur les routes de module non publiques (garde du registre) ;
     * `null` ailleurs (routes legacy, routes de module déclarées `config: { public: true }`).
     */
    ctx: RequestContext;
  }
}

// ---------------------------------------------------------------------------
// Vérification du rôle de connexion
// ---------------------------------------------------------------------------

export interface DbRoleRow {
  role: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  /** `false` si le rôle n'est pas membre de `app_user` (ou si `app_user` n'existe pas). */
  member_of_app_user: boolean;
  /** `true` si le rôle est membre de `migrator` (propriétaire des objets). */
  member_of_migrator: boolean;
  app_user_exists: boolean;
}

export class UnsafeDatabaseRoleError extends Error {
  readonly problems: readonly string[];
  constructor(role: string, problems: readonly string[]) {
    super(
      `V2_DATABASE_URL : le rôle de connexion "${role}" est refusé :\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        `\nUtilisez un rôle LOGIN membre de app_user (voir "pnpm db:v2:create-login-role" en développement).`,
    );
    this.name = "UnsafeDatabaseRoleError";
    this.problems = problems;
  }
}

/** Fonction pure : liste les raisons de refuser ce rôle (vide = acceptable). */
export function evaluateRoleSafety(row: DbRoleRow): string[] {
  const problems: string[] = [];
  if (row.rolsuper) problems.push("SUPERUSER : contourne toute la sécurité par ligne (RLS), même FORCE.");
  if (row.rolbypassrls) problems.push("BYPASSRLS : contourne la RLS.");
  if (!row.app_user_exists) {
    problems.push('le rôle "app_user" n\'existe pas : appliquez les migrations v2 (pnpm db:v2:migrate).');
  } else if (!row.member_of_app_user) {
    problems.push('n\'est pas membre de "app_user" (CREATE ROLE <nom> LOGIN ... IN ROLE app_user).');
  }
  if (row.member_of_migrator) {
    problems.push('est membre de "migrator" (propriétaire des objets) : l\'application ne doit pas pouvoir faire de DDL.');
  }
  return problems;
}

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

/** Lit les attributs du rôle courant et lève `UnsafeDatabaseRoleError` s'il est inacceptable. */
export async function assertSafeDbRole(db: Queryable): Promise<DbRoleRow> {
  const result = await db.query(
    `SELECT current_user::text AS role,
            COALESCE(r.rolsuper, false)     AS rolsuper,
            COALESCE(r.rolbypassrls, false) AS rolbypassrls,
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') AS app_user_exists,
            CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
                 THEN pg_has_role(current_user, 'app_user', 'member') ELSE false END AS member_of_app_user,
            CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator')
                 THEN pg_has_role(current_user, 'migrator', 'member') ELSE false END AS member_of_migrator
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const row = result.rows[0] as DbRoleRow | undefined;
  if (!row) throw new UnsafeDatabaseRoleError("?", ["rôle courant introuvable dans pg_roles."]);
  const problems = evaluateRoleSafety(row);
  if (problems.length > 0) throw new UnsafeDatabaseRoleError(row.role, problems);
  return row;
}

// ---------------------------------------------------------------------------
// Contexte de requête depuis l'authentification legacy
// ---------------------------------------------------------------------------

/** Forme minimale de ce que l'authentification legacy dépose sur la requête. */
export interface LegacyAuthSnapshot {
  tenantId?: string | undefined;
  userId?: string | undefined;
  user?:
    | {
        id: string;
        tenantId?: string | undefined;
        activeRole?: string | undefined;
        role?: string | undefined;
        roles?: readonly string[] | undefined;
        impersonatedBySuperAdminId?: string | undefined;
      }
    | undefined;
  superAdmin?: { id: string } | undefined;
  headers?: Record<string, unknown> | undefined;
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,100}$/;

export function requestIdFrom(headers: Record<string, unknown> | undefined): string {
  const raw = headers?.["x-request-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && REQUEST_ID_RE.test(value) ? value : newId();
}

/**
 * Construit le `RequestContext` v2 à partir de l'état posé par `auth-middleware` /
 * `tenant-context` (forme du jeton : userId, tenantId, roles, activeRole).
 *
 *  - rôles : le rôle ACTIF seul (le legacy applique « strict permission enforcement » sur
 *    `activeRole` ; élargir aux rôles disponibles accorderait plus que l'utilisateur n'a choisi) ;
 *  - super-admin avec tenant choisi : `actor = "superAdmin"`, `userId` = compte technique
 *    usurpé, comme le legacy ; toujours à auditer ;
 *  - tout défaut (pas d'utilisateur, identifiant non-UUID, tenants discordants…) ⇒ `null`.
 */
export function buildRequestContextFromLegacy(snapshot: LegacyAuthSnapshot): RequestContext | null {
  const user = snapshot.user;
  if (!user) return null;

  const tenantId = snapshot.tenantId ?? user.tenantId;
  const userId = user.id ?? snapshot.userId;
  if (!tenantId || !userId || !isUuid(tenantId) || !isUuid(userId)) return null;
  if (user.tenantId && user.tenantId.toLowerCase() !== tenantId.toLowerCase()) return null;

  const activeRole = user.activeRole ?? user.role ?? user.roles?.[0];
  const roles = activeRole ? [activeRole] : [...(user.roles ?? [])];
  const isSuperAdmin = Boolean(snapshot.superAdmin) || Boolean(user.impersonatedBySuperAdminId);

  try {
    return createRequestContext({
      tenantId,
      userId,
      roles,
      actor: isSuperAdmin ? "superAdmin" : "user",
      requestId: requestIdFrom(snapshot.headers),
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface V2ContextOptions {
  /** URL de connexion applicative (`V2_DATABASE_URL`). Ignorée si `pool` est fourni. */
  connectionString?: string;
  /** Pool déjà construit (tests). La vérification du rôle s'applique de la même façon. */
  pool?: Pool;
  manifests: readonly Readonly<ModuleManifest>[];
  logger?: Logger;
  /** Taille maximale du pool (défaut : `V2_DB_POOL_MAX` ou 10). */
  poolMax?: number;
  /** Délai maximal d'une instruction, ms (défaut : `V2_DB_STATEMENT_TIMEOUT_MS` ou 15000). */
  statementTimeoutMs?: number;
  /**
   * Isolation d'équité par tenant devant le pool. `false` = désactivé ; absent = lu dans l'environnement
   * (`V2_DB_TENANT_BULKHEAD=off` désactive ; voir `bulkheadOptionsFromEnv` pour les autres variables).
   */
  tenantBulkhead?: BulkheadOptions | false;
}

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const plugin: FastifyPluginAsync<V2ContextOptions> = async (app: FastifyInstance, options) => {
  const logger: Logger = options.logger ?? (app.log as unknown as Logger);

  let pool = options.pool;
  if (!pool) {
    if (!options.connectionString) {
      throw new Error("v2-context : connectionString (V2_DATABASE_URL) ou pool requis.");
    }
    pool = new Pool({
      connectionString: options.connectionString,
      max: options.poolMax ?? intFromEnv("V2_DB_POOL_MAX", 10),
      application_name: "ecoledigitale-api-v2",
    });
  }
  const ownedPool: Pool = pool;
  ownedPool.on("error", (err) => logger.error({ err: err.message }, "v2 : erreur sur une connexion inactive du pool"));

  try {
    const role = await assertSafeDbRole(ownedPool);
    logger.info({ role: role.role }, "v2 : rôle de connexion vérifié (non superuser, sans BYPASSRLS, membre de app_user)");
  } catch (e) {
    await ownedPool.end().catch(() => undefined);
    throw e;
  }

  const poolMax = options.poolMax ?? ownedPool.options?.max ?? intFromEnv("V2_DB_POOL_MAX", 10);
  const bulkheadOptions = options.tenantBulkhead === false ? undefined : (options.tenantBulkhead ?? bulkheadOptionsFromEnv(poolMax));
  const bulkhead = bulkheadOptions ? new TenantBulkhead(bulkheadOptions) : undefined;
  if (bulkhead) {
    // Un refus par tenant est journalisé au plus une fois toutes les 30 s (pas de tempête de journaux sous charge).
    const lastWarn = new Map<string, number>();
    bulkhead.observe({
      rejected: (reason, tenantId) => {
        const now = Date.now();
        if (now - (lastWarn.get(tenantId) ?? 0) < 30_000) return;
        if (lastWarn.size > 1000) lastWarn.clear();
        lastWarn.set(tenantId, now);
        logger.warn({ tenant_id: tenantId, reason, ...bulkhead.stats() }, "v2 : tenant_busy, transaction refusée par le bulkhead du tenant");
      },
    });
    logger.info({ ...bulkhead.options, observer: undefined }, "v2 : bulkhead par tenant actif");
  }
  const tenantDb = new TenantDb(ownedPool, {
    statementTimeoutMs: options.statementTimeoutMs ?? intFromEnv("V2_DB_STATEMENT_TIMEOUT_MS", 15_000),
    ...(bulkhead ? { bulkhead } : {}),
  });
  const systemDb = new SystemDb(tenantDb, { logger });

  app.decorate("v2", Object.freeze({ tenantDb, systemDb, manifests: options.manifests, logger, pool: ownedPool }));
  app.decorateRequest("ctx", null as unknown as RequestContext);

  // 503 « tenant_busy » : `Retry-After` posé avant le gestionnaire d'erreurs de n'importe quel module (le statut vient de
  // `AppError.httpStatus`, l'en-tête d'ici : un seul endroit pour toutes les routes).
  app.addHook("onError", async (_request, reply, error) => {
    if (isAppError(error) && error.kind === "unavailable") {
      const seconds = (error.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
      void reply.header("Retry-After", String(typeof seconds === "number" && seconds > 0 ? Math.ceil(seconds) : 1));
    }
  });

  // Enregistré après les hooks d'authentification legacy ⇒ exécuté après eux.
  app.addHook("preHandler", async (request: FastifyRequest) => {
    // Un jeton IAM v2 valide a déjà posé `request.ctx` (hook `onRequest` de platform/v2-auth.ts) : le contexte
    // legacy ne l'écrase JAMAIS (sinon un utilisateur IAM, sans état legacy, perdait son contexte ici).
    if (request.ctx) return;
    request.ctx = buildRequestContextFromLegacy({
      tenantId: request.tenantId,
      userId: request.userId,
      user: request.user,
      superAdmin: request.superAdmin,
      headers: request.headers as Record<string, unknown>,
    }) as RequestContext;
  });

  app.addHook("onClose", async () => {
    await ownedPool.end().catch(() => undefined);
  });
};

export const v2ContextPlugin = fp(plugin, { name: "v2-context" });
export default v2ContextPlugin;
