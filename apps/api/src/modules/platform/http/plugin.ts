/**
 * Console plateforme — `/api/v1/platform/*` (le registre applique le préfixe).
 *
 * TOUTES les routes sont réservées aux opérateurs : elles s'authentifient par le `SuperAdminAuthorizer` du
 * runtime (JWT super-admin legacy, séparé du JWT tenant) et sont déclarées `config: { public: true }` — c'est-à-dire
 * « ni `request.ctx` de tenant, ni authentification legacy » : sans cela le registre répondait 401 (aucun
 * contexte de tenant) et le middleware legacy exigeait un tenant sélectionné pour un super-admin.
 *
 *   GET    /tenants                                    liste (statut, recherche, pagination)
 *   POST   /tenants                                    provisionne : organisation, rôles, essai, propriétaire
 *   GET    /tenants/:tenantId                          vue d'ensemble (profil, établissements, abonnement)
 *   PATCH  /tenants/:tenantId/status                   suspension / réactivation / archivage
 *   POST   /tenants/:tenantId/reconcile                reprise idempotente (rôles, abonnement)
 *   GET    /audit/logs                                 journal d'audit de PLATEFORME (curseur, filtres)
 *   GET    /plans                                      catalogue (plans, packs, features)
 *   PUT    /plans/:key · PUT /plans/:key/features      plan ; features du plan
 *   GET|PUT /tenants/:tenantId/subscription            abonnement
 *   GET    /tenants/:tenantId/overrides · PUT|DELETE …/overrides/:featureKey    surcharges
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, type ZodTypeAny } from "zod";
import { UnauthorizedError, ValidationError, unwrap } from "@ecoledigitale/kernel";
import { platformAuditLogListQuerySchema } from "@ecoledigitale/contracts/src/v2/audit";
import {
  PlatformListTenantsQuerySchema,
  PlatformProvisionTenantBodySchema,
  PlatformSetTenantStatusBodySchema,
  PlatformTenantParamsSchema,
} from "@ecoledigitale/contracts/src/v2/platform";
import { CatalogKeySchema, FeatureKeySchema } from "@ecoledigitale/contracts/src/v2/entitlements";
import { listPlatformAuditLogs, toAuditSummaryDto } from "../../audit";
import {
  toFeatureDto,
  toOverrideDto,
  toPackDto,
  toPlanDto,
  toSubscriptionDto,
  type EntitlementsService,
} from "../../entitlements";
import { toInstitutionDto, toTenantProfileDto } from "../../tenancy";
import type { ModuleRuntime } from "../../../platform/runtime";
import type { MemberProvisioner, Operator, OperatorRequestMeta, PlatformDeps } from "../application/deps";
import { DEFAULT_TRIAL } from "../application/deps";
import {
  changeTenantStatus,
  getTenantOverview,
  getTenantSubscription,
  listPlatformCatalog,
  listPlatformTenants,
  listTenantOverrides,
  provisionPlatformTenant,
  reconcileTenant,
  removeTenantOverride,
  setPlatformPlanFeatures,
  setTenantOverride,
  setTenantSubscription,
  upsertPlatformPlan,
} from "../application/console";

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  throw new ValidationError(
    "Données invalides.",
    result.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
  );
}

const PlanParams = z.object({ key: CatalogKeySchema }).strict();
const OverrideParams = PlatformTenantParamsSchema.extend({ featureKey: FeatureKeySchema });

const REQUEST_ID = /^[A-Za-z0-9._-]{8,100}$/;

function metaOf(request: FastifyRequest): OperatorRequestMeta {
  const header = request.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  const ua = request.headers["user-agent"];
  return {
    requestId: typeof value === "string" && REQUEST_ID.test(value) ? value : randomUUID(),
    ip: request.ip ?? null,
    userAgent: typeof ua === "string" ? ua.slice(0, 300) : null,
  };
}

function trialPolicy(env: ModuleRuntime["env"]): PlatformDeps["trial"] {
  const days = Number.parseInt(env.ENTITLEMENTS_TRIAL_DAYS ?? "", 10);
  return {
    planKey: env.ENTITLEMENTS_TRIAL_PLAN?.trim() || DEFAULT_TRIAL.planKey,
    days: Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_TRIAL.days,
  };
}

const isInvalidator = (r: unknown): r is { invalidate(t: string): void; invalidateAll(): void } =>
  typeof r === "object" && r !== null && "invalidate" in r && "invalidateAll" in r;

export function buildPlatformDeps(app: FastifyInstance, runtime: ModuleRuntime): PlatformDeps {
  const entitlements = (app as unknown as { entitlements?: EntitlementsService }).entitlements;
  const members: MemberProvisioner = { provisionMember: (ctx, input) => app.iam.provisionMember(ctx, input) };
  return {
    tenantDb: runtime.tenantDb,
    systemDb: runtime.systemDb,
    clock: runtime.clock,
    logger: runtime.logger,
    audit: runtime.auditPort,
    members,
    ...(entitlements && isInvalidator(entitlements.reader) ? { entitlementsCache: entitlements.reader } : {}),
    trial: trialPolicy(runtime.env),
  };
}

export default async function platformModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.iam) throw new Error("platform : le module iam doit être chargé avant la console (app.iam absent).");
  const deps = buildPlatformDeps(app, runtime);

  // Opérateur authentifié, mémorisé par requête (jamais lu depuis le corps ni les en-têtes).
  const operators = new WeakMap<FastifyRequest, Operator>();
  const authenticate = async (request: FastifyRequest): Promise<void> => {
    const identity = await runtime.superAdminAuthorizer.authorize(request);
    operators.set(request, { id: identity.actorId });
  };
  const operatorOf = (request: FastifyRequest): Operator => {
    const operator = operators.get(request);
    if (!operator) throw new UnauthorizedError("Authentification de l'opérateur requise.");
    return operator;
  };
  const route = { preHandler: authenticate, config: { public: true } };
  const noStore = (reply: { header(name: string, value: string): unknown }): void => {
    void reply.header("Cache-Control", "no-store");
  };

  // ------------------------------------------------------------------ organisations
  app.get("/tenants", route, async (request, reply) => {
    noStore(reply);
    const q = parse(PlatformListTenantsQuerySchema, request.query);
    const page = unwrap(
      await listPlatformTenants(deps, { limit: q.limit, offset: q.offset, ...(q.status ? { status: q.status } : {}), ...(q.search ? { search: q.search } : {}) }),
    );
    return {
      items: page.items.map((t) => ({ id: t.id, slug: t.slug, name: t.name, status: t.status, createdAt: t.createdAt.toISOString() })),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  });

  app.post("/tenants", route, async (request, reply) => {
    noStore(reply);
    const body = parse(PlatformProvisionTenantBodySchema, request.body);
    const result = unwrap(await provisionPlatformTenant(deps, operatorOf(request), body, metaOf(request)));
    return reply.status(201).send(result);
  });

  app.get("/tenants/:tenantId", route, async (request, reply) => {
    noStore(reply);
    const { tenantId } = parse(PlatformTenantParamsSchema, request.params);
    const overview = unwrap(await getTenantOverview(deps, tenantId, metaOf(request)));
    return {
      tenant: { ...overview.tenant, createdAt: overview.tenant.createdAt.toISOString() },
      profile: overview.profile ? toTenantProfileDto(overview.profile) : null,
      institutions: overview.institutions.map(toInstitutionDto),
      subscription: overview.subscription ? toSubscriptionDto(overview.subscription) : null,
    };
  });

  app.patch("/tenants/:tenantId/status", route, async (request, reply) => {
    noStore(reply);
    const { tenantId } = parse(PlatformTenantParamsSchema, request.params);
    const body = parse(PlatformSetTenantStatusBodySchema, request.body);
    return unwrap(await changeTenantStatus(deps, operatorOf(request), tenantId, body, metaOf(request)));
  });

  app.post("/tenants/:tenantId/reconcile", route, async (request, reply) => {
    noStore(reply);
    const { tenantId } = parse(PlatformTenantParamsSchema, request.params);
    return unwrap(await reconcileTenant(deps, operatorOf(request), tenantId, metaOf(request)));
  });

  // ------------------------------------------------------------------ journal d'audit de plateforme
  // LECTURE SEULE de `audit.platform_audit_log` (table globale, hors RLS) par l'API PUBLIQUE du module audit, dans une
  // transaction système en lecture seule. Même enveloppe que l'audit d'un tenant : `{ items, nextCursor }`, curseur opaque,
  // plus récent d'abord ; filtres action (exacte ou préfixe `x.*`), acteur, entité, sévérité, période.
  app.get("/audit/logs", route, async (request, reply) => {
    noStore(reply);
    const q = parse(platformAuditLogListQuerySchema, request.query);
    const page = await deps.systemDb.run(
      "platform-console-audit-read",
      (tx) =>
        listPlatformAuditLogs(
          tx,
          {
            ...(q.actorId ? { actorId: q.actorId } : {}),
            ...(q.entity ? { entity: q.entity } : {}),
            ...(q.entityId ? { entityId: q.entityId } : {}),
            ...(q.action ? { action: q.action } : {}),
            ...(q.severity ? { severity: q.severity } : {}),
            ...(q.from ? { from: q.from } : {}),
            ...(q.to ? { to: q.to } : {}),
          },
          { ...(q.cursor ? { cursor: q.cursor } : {}), limit: q.limit },
        ),
      { readOnly: true },
    );
    return { items: page.items.map(toAuditSummaryDto), nextCursor: page.nextCursor };
  });

  // ------------------------------------------------------------------ plans
  app.get("/plans", route, async (_request, reply) => {
    noStore(reply);
    const catalog = unwrap(await listPlatformCatalog(deps));
    return { plans: catalog.plans.map(toPlanDto), packs: catalog.packs.map(toPackDto), features: catalog.features.map(toFeatureDto) };
  });

  app.put("/plans/:key", route, async (request) => {
    const { key } = parse(PlanParams, request.params);
    return toPlanDto(unwrap(await upsertPlatformPlan(deps, operatorOf(request), key, request.body)));
  });

  app.put("/plans/:key/features", route, async (request) => {
    const { key } = parse(PlanParams, request.params);
    return toPlanDto(unwrap(await setPlatformPlanFeatures(deps, operatorOf(request), key, request.body)));
  });

  // ------------------------------------------------------------------ abonnement et surcharges
  app.get("/tenants/:tenantId/subscription", route, async (request, reply) => {
    noStore(reply);
    const { tenantId } = parse(PlatformTenantParamsSchema, request.params);
    const subscription = unwrap(await getTenantSubscription(deps, operatorOf(request), tenantId, metaOf(request)));
    return { subscription: subscription ? toSubscriptionDto(subscription) : null };
  });

  app.put("/tenants/:tenantId/subscription", route, async (request, reply) => {
    noStore(reply);
    const { tenantId } = parse(PlatformTenantParamsSchema, request.params);
    return toSubscriptionDto(unwrap(await setTenantSubscription(deps, operatorOf(request), tenantId, request.body, metaOf(request))));
  });

  app.get("/tenants/:tenantId/overrides", route, async (request, reply) => {
    noStore(reply);
    const { tenantId } = parse(PlatformTenantParamsSchema, request.params);
    return { items: unwrap(await listTenantOverrides(deps, operatorOf(request), tenantId, metaOf(request))).map(toOverrideDto) };
  });

  app.put("/tenants/:tenantId/overrides/:featureKey", route, async (request, reply) => {
    noStore(reply);
    const { tenantId, featureKey } = parse(OverrideParams, request.params);
    return toOverrideDto(unwrap(await setTenantOverride(deps, operatorOf(request), tenantId, featureKey, request.body, metaOf(request))));
  });

  app.delete("/tenants/:tenantId/overrides/:featureKey", route, async (request, reply) => {
    const { tenantId, featureKey } = parse(OverrideParams, request.params);
    unwrap(await removeTenantOverride(deps, operatorOf(request), tenantId, featureKey, metaOf(request)));
    return reply.status(204).send();
  });
}
