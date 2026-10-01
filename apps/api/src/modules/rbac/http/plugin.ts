/**
 * Plugin Fastify du module rbac.
 *
 * Enregistrement (SANS préfixe externe : le plugin déclare `/api/v1/rbac` lui-même,
 * modifiable par l'option `prefix`) :
 *
 *   await app.register(rbacPlugin, { tenantDb, manifests, eventBus });
 *
 * Effets :
 *  - décore l'instance : `fastify.rbac` (utilisé par `requirePermission`) — visible
 *    de TOUS les modules (le plugin est « fastify-plugin ») ;
 *  - enregistre les routes `/api/v1/rbac/*` dans un contexte encapsulé, avec un
 *    gestionnaire d'erreurs local (AppError / Zod -> `toErrorBody`) ;
 *  - abonne le cache de permissions aux événements d'invalidation.
 *
 * Routes (toutes derrière `request.ctx`) :
 *   GET    /permissions                catalogue                         rbac.role.read
 *   GET    /roles                      liste                             rbac.role.read
 *   GET    /roles/:id                  détail                            rbac.role.read
 *   POST   /roles                      création                          rbac.role.manage
 *   POST   /roles/:id/clone            clonage                           rbac.role.manage
 *   PATCH  /roles/:id                  modification                      rbac.role.manage
 *   DELETE /roles/:id                  suppression (si non assigné)      rbac.role.manage
 *   GET    /assignments                liste                             rbac.role.read
 *   POST   /assignments                attribution                       rbac.assignment.manage (sur le périmètre)
 *   PATCH  /assignments/:id            validité                          rbac.assignment.manage (sur le périmètre)
 *   DELETE /assignments/:id            retrait                           rbac.assignment.manage (sur le périmètre)
 *   GET    /me/permissions             mes permissions effectives        authentifié
 *   GET    /me/navigation              mes menus par portail             authentifié
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { ZodTypeAny, z } from "zod";
import {
  PgOutboxWriter,
  type TenantDb,
} from "@ecoledigitale/database";
import {
  AppError,
  UnauthorizedError,
  ValidationError,
  consoleLogger,
  systemClock,
  toErrorBody,
  type Clock,
  type EventBus,
  type Logger,
  type ModuleManifest,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import {
  rbacCloneRoleBodySchema,
  rbacCreateAssignmentBodySchema,
  rbacCreateRoleBodySchema,
  rbacIdParamsSchema,
  rbacListAssignmentsQuerySchema,
  rbacUpdateAssignmentBodySchema,
  rbacUpdateRoleBodySchema,
} from "@ecoledigitale/contracts/src/v2/rbac";
import {
  assignRoleUseCase,
  listAssignmentsUseCase,
  revokeAssignmentUseCase,
  updateAssignmentUseCase,
} from "../application/assignments";
import { loadPermissionCatalog } from "../application/catalog";
import { PermissionSetService } from "../application/load-permission-set";
import { PermissionSetCache, subscribeCacheInvalidation } from "../application/permission-cache";
import { noopAudit, type AuditPort, type EntitlementsPort, type UseCaseDeps } from "../application/ports";
import {
  cloneRoleUseCase,
  createRoleUseCase,
  deleteRoleUseCase,
  getRoleUseCase,
  listRolesUseCase,
  updateRoleUseCase,
} from "../application/roles";
import { buildNavigation, coreOnlyEntitlements } from "../domain/navigation";
import { ANY_SCOPE, TENANT_SCOPE, emptyScopeTreeProvider, scopeFromParts, type ScopeTreeProvider } from "../domain/scope";
import {
  getRequestCtx,
  loadAuthorization,
  requirePermission,
  type RbacRuntime,
} from "./guard";
import {
  presentAssignment,
  presentMyPermissions,
  presentNavigation,
  presentPermission,
  presentRoleDetail,
  presentRoleSummary,
} from "./presenters";

export const DEFAULT_PREFIX = "/api/v1/rbac";

export interface RbacPluginOptions {
  tenantDb: TenantDb;
  /** Manifestes de tous les modules chargés (navigation, titres du catalogue). */
  manifests: readonly ModuleManifest[];
  /** Hiérarchie des périmètres (tenancy). Défaut : vide (seul « tenant » couvre les sous-périmètres). */
  scopeTrees?: ScopeTreeProvider;
  /** Entitlements. Défaut : seules les features des modules CORE sont actives. */
  entitlements?: EntitlementsPort;
  /** Port d'audit. Défaut : no-op (le module audit consomme les événements `rbac.*.changed`). */
  audit?: AuditPort;
  clock?: Clock;
  logger?: Logger;
  cache?: PermissionSetCache;
  /** Bus des événements relayés depuis l'outbox : invalide le cache entre instances. */
  eventBus?: EventBus;
  /** Préfixe des routes. Défaut `/api/v1/rbac`. */
  prefix?: string;
  /** Installer le gestionnaire d'erreurs local des routes rbac (défaut : oui). */
  errorHandler?: boolean;
}

function parseWith<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new ValidationError(
    "Données invalides.",
    result.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
  );
}

function errorHandler(logger: Logger) {
  return (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    let appError: AppError | undefined;
    if (error instanceof AppError) appError = error;
    else if (
      typeof error === "object" &&
      error !== null &&
      typeof (error as { statusCode?: unknown }).statusCode === "number" &&
      (error as { statusCode: number }).statusCode >= 400 &&
      (error as { statusCode: number }).statusCode < 500
    ) {
      // Erreurs de Fastify lui-même (JSON invalide, corps trop gros…).
      appError = new ValidationError("Requête invalide.", [], { code: "VALIDATION_FAILED" });
    }
    if (!appError) {
      logger.error({ err: error, requestId: request.id }, "rbac : erreur inattendue");
    }
    const body = toErrorBody(appError ?? error, request.id);
    void reply.status(body.status).send(body);
  };
}

async function routes(app: FastifyInstance, opts: RoutesDeps): Promise<void> {
  const { tenantDb, clock, logger, audit, cache, manifests } = opts;
  const moduleTitles = new Map(manifests.map((m) => [m.key, m.title]));

  if (opts.installErrorHandler) app.setErrorHandler(errorHandler(logger));

  /** Exécute un use case dans UNE transaction du tenant ; un `Err` annule la transaction. */
  async function execute<T>(
    request: FastifyRequest,
    options: { readOnly?: boolean },
    fn: (deps: UseCaseDeps, ctx: RequestContext) => Promise<Result<T, AppError>>,
  ): Promise<T> {
    const auth = await loadAuthorization(request);
    const ctx = getRequestCtx(request) as RequestContext;
    return tenantDb.run(
      ctx,
      async (tx) => {
        const deps: UseCaseDeps = {
          tx,
          clock,
          outbox: new PgOutboxWriter(tx),
          audit,
          logger,
          actor: auth,
          scopeTree: auth.tree,
        };
        const result = await fn(deps, ctx);
        if (!result.ok) throw result.error;
        return result.value;
      },
      options.readOnly ? { readOnly: true } : undefined,
    );
  }

  const read = requirePermission("rbac.role.read", { scope: ANY_SCOPE });
  const manageRoles = requirePermission("rbac.role.manage", { scope: TENANT_SCOPE });
  // Le périmètre exact d'une assignation n'est connu qu'une fois le corps/la ligne lus : le use case le vérifie.
  const manageAssignments = requirePermission("rbac.assignment.manage", { scope: ANY_SCOPE });

  // ------------------------------------------------------------------ catalogue
  app.get("/permissions", { preHandler: read }, async (request) => {
    const catalog = await execute(request, { readOnly: true }, async (deps) => ({
      ok: true as const,
      value: await loadPermissionCatalog(deps.tx),
    }));
    return { permissions: catalog.entries.map((e) => presentPermission(e, moduleTitles)) };
  });

  // ------------------------------------------------------------------ rôles
  app.get("/roles", { preHandler: read }, async (request) => {
    const roles = await execute(request, { readOnly: true }, (deps, ctx) => listRolesUseCase(deps, ctx));
    return { roles: roles.map(presentRoleSummary) };
  });

  app.get("/roles/:id", { preHandler: read }, async (request) => {
    const { id } = parseWith(rbacIdParamsSchema, request.params);
    return presentRoleDetail(await execute(request, { readOnly: true }, (deps, ctx) => getRoleUseCase(deps, ctx, id)));
  });

  app.post("/roles", { preHandler: manageRoles }, async (request, reply) => {
    const body = parseWith(rbacCreateRoleBodySchema, request.body);
    const detail = await execute(request, {}, (deps, ctx) =>
      createRoleUseCase(deps, ctx, {
        label: body.label,
        permissions: body.permissions,
        ...(body.key !== undefined ? { key: body.key } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      }),
    );
    cache.invalidateTenant((getRequestCtx(request) as RequestContext).tenantId);
    return reply.status(201).send(presentRoleDetail(detail));
  });

  app.post("/roles/:id/clone", { preHandler: manageRoles }, async (request, reply) => {
    const { id } = parseWith(rbacIdParamsSchema, request.params);
    const body = parseWith(rbacCloneRoleBodySchema, request.body);
    const detail = await execute(request, {}, (deps, ctx) =>
      cloneRoleUseCase(deps, ctx, id, {
        label: body.label,
        ...(body.key !== undefined ? { key: body.key } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      }),
    );
    cache.invalidateTenant((getRequestCtx(request) as RequestContext).tenantId);
    return reply.status(201).send(presentRoleDetail(detail));
  });

  app.patch("/roles/:id", { preHandler: manageRoles }, async (request) => {
    const { id } = parseWith(rbacIdParamsSchema, request.params);
    const body = parseWith(rbacUpdateRoleBodySchema, request.body);
    const detail = await execute(request, {}, (deps, ctx) =>
      updateRoleUseCase(deps, ctx, id, {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
      }),
    );
    cache.invalidateTenant((getRequestCtx(request) as RequestContext).tenantId);
    return presentRoleDetail(detail);
  });

  app.delete("/roles/:id", { preHandler: manageRoles }, async (request) => {
    const { id } = parseWith(rbacIdParamsSchema, request.params);
    const result = await execute(request, {}, (deps, ctx) => deleteRoleUseCase(deps, ctx, id));
    cache.invalidateTenant((getRequestCtx(request) as RequestContext).tenantId);
    return result;
  });

  // ------------------------------------------------------------------ assignations
  app.get("/assignments", { preHandler: read }, async (request) => {
    const q = parseWith(rbacListAssignmentsQuerySchema, request.query);
    const rows = await execute(request, { readOnly: true }, (deps, ctx) =>
      listAssignmentsUseCase(deps, ctx, {
        limit: q.limit,
        offset: q.offset,
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.roleId ? { roleId: q.roleId } : {}),
      }),
    );
    return { assignments: rows.map(presentAssignment) };
  });

  app.post("/assignments", { preHandler: manageAssignments }, async (request, reply) => {
    const body = parseWith(rbacCreateAssignmentBodySchema, request.body);
    const row = await execute(request, {}, (deps, ctx) =>
      assignRoleUseCase(deps, ctx, {
        userId: body.userId,
        roleId: body.roleId,
        scope: scopeFromParts(body.scope.type, body.scope.type === "tenant" ? null : body.scope.id),
        identityId: body.identityId ?? null,
        validFrom: body.validFrom ? new Date(body.validFrom) : null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      }),
    );
    cache.invalidateUser((getRequestCtx(request) as RequestContext).tenantId, row.userId);
    return reply.status(201).send(presentAssignment(row));
  });

  app.patch("/assignments/:id", { preHandler: manageAssignments }, async (request) => {
    const { id } = parseWith(rbacIdParamsSchema, request.params);
    const body = parseWith(rbacUpdateAssignmentBodySchema, request.body);
    const row = await execute(request, {}, (deps, ctx) =>
      updateAssignmentUseCase(deps, ctx, id, {
        ...(body.validFrom !== undefined ? { validFrom: body.validFrom ? new Date(body.validFrom) : null } : {}),
        ...(body.validUntil !== undefined ? { validUntil: body.validUntil ? new Date(body.validUntil) : null } : {}),
      }),
    );
    cache.invalidateUser((getRequestCtx(request) as RequestContext).tenantId, row.userId);
    return presentAssignment(row);
  });

  app.delete("/assignments/:id", { preHandler: manageAssignments }, async (request) => {
    const { id } = parseWith(rbacIdParamsSchema, request.params);
    const result = await execute(request, {}, (deps, ctx) => revokeAssignmentUseCase(deps, ctx, id));
    cache.invalidateUser((getRequestCtx(request) as RequestContext).tenantId, result.userId);
    return { revoked: result.revoked };
  });

  // ------------------------------------------------------------------ moi
  app.get("/me/permissions", async (request) => {
    return presentMyPermissions(await loadAuthorization(request));
  });

  app.get("/me/navigation", async (request) => {
    const auth = await loadAuthorization(request);
    const ctx = getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    const entitlements = opts.entitlements
      ? await opts.entitlements.forTenant(ctx.tenantId)
      : coreOnlyEntitlements(manifests);
    return presentNavigation(buildNavigation(manifests, auth, entitlements));
  });
}

interface RoutesDeps {
  tenantDb: TenantDb;
  clock: Clock;
  logger: Logger;
  audit: AuditPort;
  cache: PermissionSetCache;
  manifests: readonly ModuleManifest[];
  entitlements: EntitlementsPort | undefined;
  installErrorHandler: boolean;
}

async function rbacPluginImpl(app: FastifyInstance, options: RbacPluginOptions): Promise<void> {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? consoleLogger;
  const cache = options.cache ?? new PermissionSetCache({ clock });

  const runtime: RbacRuntime = {
    permissions: new PermissionSetService({ tenantDb: options.tenantDb, cache, clock }),
    scopeTrees: options.scopeTrees ?? emptyScopeTreeProvider,
    clock,
    logger,
  };
  if (app.hasDecorator("rbac")) {
    throw new Error("Le plugin rbac est déjà enregistré sur cette instance.");
  }
  app.decorate("rbac", runtime);

  if (options.eventBus) {
    const unsubscribe = subscribeCacheInvalidation(options.eventBus, cache);
    app.addHook("onClose", async () => unsubscribe());
  }

  await app.register(routes, {
    prefix: options.prefix ?? DEFAULT_PREFIX,
    tenantDb: options.tenantDb,
    clock,
    logger,
    audit: options.audit ?? noopAudit,
    cache,
    manifests: options.manifests,
    entitlements: options.entitlements,
    installErrorHandler: options.errorHandler !== false,
  } satisfies RoutesDeps & { prefix: string });
}

export const rbacPlugin = fp(rbacPluginImpl, { name: "rbac" });
export default rbacPlugin;
