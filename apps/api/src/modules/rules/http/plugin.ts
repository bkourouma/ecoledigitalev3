/**
 * Plugin Fastify du module rules — préfixe `/api/v1/rules` appliqué par le registre (routes déclarées SANS préfixe).
 *
 * Contrat d'assemblage `(app, runtime)` (docs/architecture/platform-assembly.md) :
 *   - `setup(app, runtime)` (instance RACINE) : construit les dépendances, décore `app.rules` (API inter-modules) et charge
 *     les RuleSets de départ du catalogue national (idempotent, verrou consultatif) ;
 *   - `default(app, runtime)` : les routes. Aucune SQL ici : tout passe par les cas d'usage de `application/`.
 *
 * ── Établissement (JWT du tenant, `requirePermission` + `requireFeature`) ────────────────────────────
 *   GET    /rule-sets                           rules.ruleset.read
 *   GET    /rule-versions/:id                   rules.ruleset.read
 *   GET    /rule-versions/:id/events            rules.ruleset.read
 *   POST   /rule-sets/:code/variants            rules.version.create        + rules.variants
 *   PATCH  /rule-versions/:id/parameters        rules.version.edit
 *   PUT    /rule-versions/:id/rules/:key        rules.version.edit_expression (sensible) + rules.expression-editor
 *   POST   /rule-versions/:id/validate          rules.version.edit
 *   POST   /rule-versions/:id/simulations       rules.version.simulate      + rules.simulation        → 202
 *   GET    /simulations/:id                     rules.version.simulate
 *   POST   /rule-versions/:id/transitions       rules.version.propose (sensible)
 *   GET|PUT /bindings, DELETE /bindings/:id     rules.ruleset.read / rules.binding.manage (sensible)
 *   GET    /contracts, /contracts/:id           rules.ruleset.read
 *   GET    /resolve                             rules.ruleset.read
 *   POST   /evaluate                            rules.version.edit (banc d'essai, 30 appels/min/utilisateur)
 *
 * ── Console du super-administrateur (`SuperAdminAuthorizer`, routes `config.public`) ──────────────────
 *   GET    /platform/rule-sets · GET /platform/rule-versions/:id[?tenantId]
 *   GET    /platform/queue · GET /platform/impact · GET|PUT /platform/settings
 *   POST   /platform/rule-sets · POST /platform/rule-sets/:code/versions · PUT /platform/rule-versions/:id/rules
 *   POST   /platform/rule-versions/:id/(approve|reject|publish|retire|transitions|close-period)
 *
 * NB : la spec 012 §8 nomme ces routes `/api/v1/platform/rules/*` ; un module ne peut déclarer que des routes sous son propre
 * préfixe (`/api/v1/rules`), elles sont donc sous `/api/v1/rules/platform/*`.
 */
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { z, type ZodTypeAny } from "zod";
import { UnauthorizedError, ValidationError, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import {
  RulesBindingBodySchema,
  RulesCodeParamsSchema,
  RulesDeriveVariantBodySchema,
  RulesEditExpressionBodySchema,
  RulesEditParametersBodySchema,
  RulesEvaluateBodySchema,
  RulesIdParamsSchema,
  RulesListBindingsQuerySchema,
  RulesListRuleSetsQuerySchema,
  RulesPlatformClosePeriodBodySchema,
  RulesPlatformCreateRuleSetBodySchema,
  RulesPlatformCreateVersionBodySchema,
  RulesPlatformDecisionBodySchema,
  RulesPlatformReplaceRulesBodySchema,
  RulesPlatformSettingsBodySchema,
  RulesPlatformTransitionBodySchema,
  RulesRequestSimulationBodySchema,
  RulesResolveQuerySchema,
  RulesTransitionBodySchema,
  RulesVersionRuleParamsSchema,
} from "@ecoledigitale/contracts/src/v2/rules";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createRulesApi, type RulesApi } from "../application/api";
import { listPlatformImpact, getPlatformVersionDetail, getVersionDetail, getVersionEvents, listApprovalQueue, listPlatformCatalog, listTenantCatalog } from "../application/catalog";
import { listTenantBindings, putBinding, removeBinding } from "../application/bindings";
import { createRulesDeps, type RulesDeps } from "../application/deps";
import {
  createNationalRuleSet,
  createNationalVersion,
  getPlatformSettings,
  replaceNationalDraftRules,
  updatePlatformSettings,
} from "../application/national";
import { resolve } from "../application/resolve";
import { ensureNationalCatalog } from "../application/seed";
import { getSimulationView, requestSimulation, startSimulation } from "../application/simulations";
import { closeVersionPeriod, transitionAsOperator, transitionTenantVersion, type Operator } from "../application/transitions";
import { deriveVariant, editExpression, editParameters, validateVersion } from "../application/variants";
import { getContract, listContracts } from "../contracts";
import { RulesCode, notFound } from "../domain/errors";
import { isUndefinedTable } from "../infrastructure/pg";
import {
  toBindingDto,
  toContractDto,
  toEventDto,
  toRuleSetDto,
  toSimulationDto,
  toValidateResponse,
  toVersionDetailDto,
  toVersionSummaryDto,
} from "./presenters";

declare module "fastify" {
  interface FastifyInstance {
    /** API inter-modules du module `rules` (posée par `setup`). */
    rules: RulesApi;
  }
}

/** 30 évaluations par minute et par utilisateur sur le banc d'essai (AC7.1). */
export const EVALUATE_RATE_LIMIT = Object.freeze({ limit: 30, windowMs: 60_000 });

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  throw new ValidationError(
    "Données invalides.",
    result.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
  );
}

function rulesApiOf(app: FastifyInstance, runtime: ModuleRuntime): RulesApi {
  if (app.hasDecorator("rules")) return app.rules;
  return createRulesApi(
    createRulesDeps({
      db: runtime.tenantDb,
      systemDb: runtime.systemDb,
      clock: runtime.clock,
      logger: runtime.logger,
      audit: runtime.auditPort,
    }),
  );
}

/**
 * Assemblage, étape 1 (instance RACINE) : API `app.rules` + données de départ du catalogue national.
 * Un échec de chargement des données de départ (hash divergent, contrat violé) est BRUYANT ; seule l'absence des
 * tables (migrations non appliquées) est tolérée avec un avertissement.
 */
export async function setup(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  const api = createRulesApi(
    createRulesDeps({
      db: runtime.tenantDb,
      systemDb: runtime.systemDb,
      clock: runtime.clock,
      logger: runtime.logger,
      audit: runtime.auditPort,
    }),
  );
  if (!app.hasDecorator("rules")) app.decorate("rules", api);
  app.addHook("onClose", async () => {
    await api.deps.background.drain();
  });
  try {
    const report = await ensureNationalCatalog(api.deps);
    runtime.logger.info({ created: report.created, verified: report.verified }, "rules : catalogue national chargé");
  } catch (e) {
    if (isUndefinedTable(e)) {
      runtime.logger.warn({}, "rules : tables absentes (migrations 1000-1003 non appliquées) — données de départ non chargées.");
      return;
    }
    throw e;
  }
}

const operatorOf = new WeakMap<FastifyRequest, Operator>();

export default async function rulesModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  const api = rulesApiOf(app, runtime);
  const deps: RulesDeps = api.deps;

  const ctxOf = (request: FastifyRequest): RequestContext => runtime.resolveContext(request);
  const perm = (key: string): preHandlerAsyncHookHandler => runtime.requirePermission(key);
  const feature = (key: string): preHandlerAsyncHookHandler => runtime.entitlements.requireFeature(key);
  const guards = (permission: string, featureKey?: string): preHandlerAsyncHookHandler[] => [perm(permission), ...(featureKey ? [feature(featureKey)] : [])];

  // ---------------------------------------------------------------------------------------- catalogue
  app.get("/rule-sets", { preHandler: guards("rules.ruleset.read") }, async (request) => {
    const query = parse(RulesListRuleSetsQuerySchema, request.query);
    const sets = unwrap(await listTenantCatalog(deps, ctxOf(request), query));
    return { items: sets.map((s) => toRuleSetDto(s.set, s.versions)) };
  });

  app.get("/rule-versions/:id", { preHandler: guards("rules.ruleset.read") }, async (request) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    return toVersionDetailDto(unwrap(await getVersionDetail(deps, ctxOf(request), id)));
  });

  app.get("/rule-versions/:id/events", { preHandler: guards("rules.ruleset.read") }, async (request) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    const events = unwrap(await getVersionEvents(deps, ctxOf(request), id));
    return { items: events.map(toEventDto) };
  });

  // ---------------------------------------------------------------------------------------- variantes
  app.post("/rule-sets/:code/variants", { preHandler: guards("rules.version.create", "rules.variants") }, async (request, reply) => {
    const { code } = parse(RulesCodeParamsSchema, request.params);
    const body = parse(RulesDeriveVariantBodySchema, request.body);
    const version = unwrap(await deriveVariant(deps, ctxOf(request), { ruleSetCode: code, ...body }));
    const detail = unwrap(await getVersionDetail(deps, ctxOf(request), version.id));
    return reply.status(201).send(toVersionDetailDto(detail));
  });

  app.patch("/rule-versions/:id/parameters", { preHandler: guards("rules.version.edit") }, async (request) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    const body = parse(RulesEditParametersBodySchema, request.body);
    unwrap(await editParameters(deps, ctxOf(request), { versionId: id, ...body }));
    return toVersionDetailDto(unwrap(await getVersionDetail(deps, ctxOf(request), id)));
  });

  app.put("/rule-versions/:id/rules/:key", { preHandler: guards("rules.version.edit_expression", "rules.expression-editor") }, async (request) => {
    const { id, key } = parse(RulesVersionRuleParamsSchema, request.params);
    const body = parse(RulesEditExpressionBodySchema, request.body);
    unwrap(await editExpression(deps, ctxOf(request), { versionId: id, ruleKey: key, ...body }));
    return toVersionDetailDto(unwrap(await getVersionDetail(deps, ctxOf(request), id)));
  });

  app.post("/rule-versions/:id/validate", { preHandler: guards("rules.version.edit") }, async (request) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    return toValidateResponse(unwrap(await validateVersion(deps, ctxOf(request), id)));
  });

  // ---------------------------------------------------------------------------------------- simulation
  app.post("/rule-versions/:id/simulations", { preHandler: guards("rules.version.simulate", "rules.simulation") }, async (request, reply) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    const body = parse(RulesRequestSimulationBodySchema, request.body);
    const ctx = ctxOf(request);
    const simulation = unwrap(await requestSimulation(deps, ctx, { versionId: id, ...body }));
    startSimulation(deps, ctx, simulation.id); // tâche de fond : 202 immédiat, la progression se lit sur GET /simulations/:id
    return reply.status(202).send({ simulationId: simulation.id, status: simulation.status });
  });

  app.get("/simulations/:id", { preHandler: guards("rules.version.simulate") }, async (request) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    const view = unwrap(await getSimulationView(deps, ctxOf(request), id));
    return toSimulationDto(view.simulation, view.differences);
  });

  // ---------------------------------------------------------------------------------------- gouvernance
  app.post("/rule-versions/:id/transitions", { preHandler: guards("rules.version.propose") }, async (request) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    const body = parse(RulesTransitionBodySchema, request.body);
    const outcome = unwrap(await transitionTenantVersion(deps, ctxOf(request), { versionId: id, ...body }));
    return { version: toVersionSummaryDto(outcome.version), decisionChangedPercent: outcome.decisionChangedPercent };
  });

  // ---------------------------------------------------------------------------------------- liaisons
  app.get("/bindings", { preHandler: guards("rules.ruleset.read") }, async (request) => {
    const query = parse(RulesListBindingsQuerySchema, request.query);
    const items = unwrap(await listTenantBindings(deps, ctxOf(request), query.contractId));
    return { items: items.map(toBindingDto) };
  });

  app.put("/bindings", { preHandler: guards("rules.binding.manage") }, async (request) => {
    const body = parse(RulesBindingBodySchema, request.body);
    return toBindingDto(unwrap(await putBinding(deps, ctxOf(request), body)));
  });

  app.delete("/bindings/:id", { preHandler: guards("rules.binding.manage") }, async (request, reply) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    unwrap(await removeBinding(deps, ctxOf(request), id));
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------------------- contrats, résolution, banc d'essai
  app.get("/contracts", { preHandler: guards("rules.ruleset.read") }, async () => ({
    items: listContracts().map((c) => ({ id: c.id, name: c.name, description: c.description })),
  }));

  app.get("/contracts/:id", { preHandler: guards("rules.ruleset.read") }, async (request) => {
    const { id } = parse(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*@[0-9]+$/) }).strict(), request.params);
    const contract = getContract(id);
    if (!contract) throw notFound(RulesCode.UNKNOWN_CONTRACT, "Contrat", id);
    return toContractDto(contract);
  });

  app.get("/resolve", { preHandler: guards("rules.ruleset.read") }, async (request) => {
    const query = parse(RulesResolveQuerySchema, request.query);
    const resolution = unwrap(await resolve(deps, ctxOf(request), query));
    return {
      resolved: resolution.resolved,
      considered: resolution.considered,
    };
  });

  app.post("/evaluate", { preHandler: guards("rules.version.edit") }, async (request, reply) => {
    const ctx = ctxOf(request);
    const decision = await runtime.rateLimiter.hit(`rules:evaluate:${ctx.tenantId}:${ctx.userId ?? "anonymous"}`, EVALUATE_RATE_LIMIT);
    if (!decision.allowed) {
      void reply.header("Retry-After", String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
      throw Object.assign(new Error("Trop d'évaluations : 30 par minute au maximum."), { statusCode: 429, code: RulesCode.RATE_LIMITED });
    }
    const body = parse(RulesEvaluateBodySchema, request.body);
    const out = unwrap(
      await api.benchEvaluate(ctx, body.versionId, {
        ruleKey: body.ruleKey,
        context: { variables: body.context.variables, lookups: body.context.lookups },
        overrides: body.overrides,
        trace: body.trace,
      }),
    );
    return { ...out, trace: [...out.trace] };
  });

  // ======================================================================================== console plateforme
  const authenticate = async (request: FastifyRequest): Promise<void> => {
    const identity = await runtime.superAdminAuthorizer.authorize(request);
    operatorOf.set(request, { id: identity.actorId, ...(identity.email ? { name: identity.email } : {}) });
  };
  const operator = (request: FastifyRequest): Operator => {
    const op = operatorOf.get(request);
    if (!op) throw new UnauthorizedError("Authentification de l'opérateur requise.");
    return op;
  };
  const platform = { preHandler: authenticate, config: { public: true } };
  const noStore = (reply: { header(name: string, value: string): unknown }): void => {
    void reply.header("Cache-Control", "no-store");
  };

  app.get("/platform/rule-sets", platform, async (request, reply) => {
    noStore(reply);
    const query = parse(RulesListRuleSetsQuerySchema, request.query);
    const sets = unwrap(await listPlatformCatalog(deps, query));
    return { items: sets.map((s) => toRuleSetDto(s.set, s.versions)) };
  });

  app.get("/platform/rule-versions/:id", platform, async (request, reply) => {
    noStore(reply);
    const { id } = parse(RulesIdParamsSchema, request.params);
    const { tenantId } = parse(z.object({ tenantId: z.string().uuid().optional() }).strict(), request.query);
    return toVersionDetailDto(unwrap(await getPlatformVersionDetail(deps, id, tenantId)));
  });

  app.get("/platform/queue", platform, async (_request, reply) => {
    noStore(reply);
    const items = await listApprovalQueue(deps);
    return {
      items: items.map((i) => ({
        tenantId: i.tenantId,
        tenantSlug: i.tenantSlug,
        version: toVersionSummaryDto(i.version),
        ruleSetName: i.ruleSetName,
        lastSimulationId: i.version.lastSimulationId,
        decisionChangedPercent: i.decisionChangedPercent,
        decisionImpactConfirmed: i.decisionImpactConfirmed,
      })),
    };
  });

  app.get("/platform/impact", platform, async (_request, reply) => {
    noStore(reply);
    const items = await listPlatformImpact(deps);
    return { items: items.map((i) => ({ tenantId: i.tenantId, tenantSlug: i.tenantSlug, activeVariants: i.activeVariants.map(toVersionSummaryDto) })) };
  });

  app.get("/platform/settings", platform, async (_request, reply) => {
    noStore(reply);
    return getPlatformSettings(deps);
  });

  app.put("/platform/settings", platform, async (request) => {
    const body = parse(RulesPlatformSettingsBodySchema, request.body);
    return unwrap(
      await updatePlatformSettings(deps, operator(request), {
        ...(body.decisionImpactConfirmPercent !== undefined ? { decisionImpactConfirmPercent: body.decisionImpactConfirmPercent } : {}),
        ...(body.nationalFourEyes !== undefined ? { nationalFourEyes: body.nationalFourEyes } : {}),
        ...(body.replaySamplePercent !== undefined ? { replaySamplePercent: body.replaySamplePercent } : {}),
      }),
    );
  });

  app.post("/platform/rule-sets", platform, async (request, reply) => {
    const body = parse(RulesPlatformCreateRuleSetBodySchema, request.body);
    const set = unwrap(await createNationalRuleSet(deps, operator(request), body));
    return reply.status(201).send(toRuleSetDto(set, []));
  });

  app.post("/platform/rule-sets/:code/versions", platform, async (request, reply) => {
    const { code } = parse(RulesCodeParamsSchema, request.params);
    const body = parse(RulesPlatformCreateVersionBodySchema, request.body);
    const version = unwrap(
      await createNationalVersion(deps, operator(request), {
        ruleSetCode: code,
        contractId: body.contractId,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        source: body.source,
        rules: body.rules,
        notes: body.notes,
      }),
    );
    const detail = unwrap(await getPlatformVersionDetail(deps, version.id));
    return reply.status(201).send(toVersionDetailDto(detail));
  });

  app.put("/platform/rule-versions/:id/rules", platform, async (request) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    const body = parse(RulesPlatformReplaceRulesBodySchema, request.body);
    unwrap(await replaceNationalDraftRules(deps, operator(request), id, body.rules));
    return toVersionDetailDto(unwrap(await getPlatformVersionDetail(deps, id)));
  });

  const decision = (to: "approved" | "published" | "retired" | "draft") =>
    async (request: FastifyRequest) => {
      const { id } = parse(RulesIdParamsSchema, request.params);
      const body = parse(RulesPlatformDecisionBodySchema, request.body);
      const outcome = unwrap(
        await transitionAsOperator(deps, operator(request), { versionId: id, to, comment: body.comment, tenantId: body.tenantId, requestId: String(request.id) }),
      );
      return { version: toVersionSummaryDto(outcome.version), decisionChangedPercent: outcome.decisionChangedPercent };
    };
  app.post("/platform/rule-versions/:id/approve", platform, decision("approved"));
  app.post("/platform/rule-versions/:id/reject", platform, decision("draft"));
  app.post("/platform/rule-versions/:id/publish", platform, decision("published"));
  app.post("/platform/rule-versions/:id/retire", platform, decision("retired"));

  app.post("/platform/rule-versions/:id/close-period", platform, async (request) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    const body = parse(RulesPlatformClosePeriodBodySchema, request.body);
    const version = unwrap(
      await closeVersionPeriod(deps, operator(request), { versionId: id, effectiveTo: body.effectiveTo, comment: body.comment, tenantId: body.tenantId, requestId: String(request.id) }),
    );
    return toVersionSummaryDto(version);
  });

  app.post("/platform/rule-versions/:id/transitions", platform, async (request) => {
    const { id } = parse(RulesIdParamsSchema, request.params);
    const body = parse(RulesPlatformTransitionBodySchema, request.body);
    const outcome = unwrap(
      await transitionAsOperator(deps, operator(request), { versionId: id, to: body.to, comment: body.comment, tenantId: body.tenantId, requestId: String(request.id) }),
    );
    return { version: toVersionSummaryDto(outcome.version), decisionChangedPercent: outcome.decisionChangedPercent };
  });
}
