/**
 * Plugin Fastify du module results — routes SANS préfixe (le registre applique `/api/v1/results`). Contrat d'assemblage
 * `(app, runtime)` + `setup(app, runtime)` qui décore la RACINE avec le registre de ports (`app.resultsPorts`) que
 * `academic` et `people` renseignent (`registerResultsPorts`). Les ports `assess` et `rules` sont branchés par l'API
 * publique de ces modules (`app.rules`, posé par le `setup` de `rules`) : tant que `rules` n'est pas chargé, le calcul
 * est indisponible (échec fermé, jamais de règle par défaut).
 *
 *  - Authentification : `request.ctx` posé en amont. Aucune confiance dans un en-tête client.
 *  - Autorisation : `requirePermission('…')` (rbac) ; permissions sensibles (surcharge approuvée, verrou, clôture,
 *    réouverture, décision modifiée) exigent la MFA. Les décisions CONTEXTUELLES passent par les capacités.
 *  - Aucun `GET` n'écrit (sauf la file de recalcul n'est jamais alimentée par une lecture).
 *  - Les entrées de calcul et les traces ne sortent que par `GET /results/:id/explain` (`result.explain`).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, z, type ZodTypeAny } from "zod";
import { ForbiddenError, UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  resultsAppreciationBodySchema,
  resultsAppreciationsQuerySchema,
  resultsChildParamsSchema,
  resultsCloseBodySchema,
  resultsDecisionConfirmBodySchema,
  resultsDecisionsQuerySchema,
  resultsDeliberateBodySchema,
  resultsDeliberationCreateBodySchema,
  resultsDeliberationsQuerySchema,
  resultsDeliberationUpdateBodySchema,
  resultsEnrollmentPeriodParamsSchema,
  resultsEnrollmentYearParamsSchema,
  resultsIdParamsSchema,
  resultsLockBodySchema,
  resultsMatrixQuerySchema,
  resultsOverrideCreateBodySchema,
  resultsOverrideDecisionBodySchema,
  resultsOverrideRejectBodySchema,
  resultsOverrideRevokeBodySchema,
  resultsOverridesQuerySchema,
  resultsPeriodParamsSchema,
  resultsRecomputeBodySchema,
  resultsReopenBodySchema,
  resultsSettingsUpdateBodySchema,
} from "@ecoledigitale/contracts/src/v2/results";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createResultsDeps, type ResultsCaps, type ResultsDeps } from "../application/deps";
import { approveOverride, confirmDecisionUseCase, createDeliberation, getResultsSettings, listAppreciationsView, listDecisionsView, listDeliberationsView, listOverridesView, rejectOverride, requestOverride, revokeOverrideUseCase, updateDeliberationUseCase, updateResultsSettings, writeAppreciation } from "../application/governance";
import { closePeriod, deliberatePeriod, lockPeriod, reopenPeriod, repinPeriod } from "../application/lifecycle";
import type { ResultsPorts } from "../application/ports";
import { recomputeNow } from "../application/recompute";
import { getYearResult } from "../application/year";
import { explainResult, getClassMatrix, getEnrollmentResult, getPeriodView, getStateView, listChildResults, listMyResults } from "../application/reads";
import { createAssessDeps } from "../../assess";
import { assessPortFrom } from "../infrastructure/assess-adapter";
import { rulesPortFrom } from "../infrastructure/rules-adapter";
import { createPermissionKit, PERMISSIONS as P, type PermissionKit } from "./guards";
import * as present from "./presenters";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par academic, people)
// ---------------------------------------------------------------------------

export interface ResultsPortRegistry {
  register(ports: Partial<ResultsPorts>): void;
  readonly current: Partial<ResultsPorts>;
}

export function createPortRegistry(initial: Partial<ResultsPorts> = {}): ResultsPortRegistry {
  let current: Partial<ResultsPorts> = { ...initial };
  return {
    register(ports) {
      current = { ...current, ...ports };
    },
    get current() {
      return current;
    },
  };
}

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module results (posé par `setup`). */
    resultsPorts: ResultsPortRegistry;
  }
}

/** À appeler par les modules voisins (`academic`, `people`) dans leur `setup(app, runtime)`. */
export function registerResultsPorts(app: FastifyInstance, ports: Partial<ResultsPorts>): void {
  if (!app.hasDecorator("resultsPorts")) app.decorate("resultsPorts", createPortRegistry());
  app.resultsPorts.register(ports);
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError("Données invalides.", error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })));
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function maybeFastifyValidation(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const e = error as { statusCode?: number };
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "results.bad_request" });
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: "results.payload_too_large" });
  }
  return error;
}

export interface ResultsPluginOptions {
  deps: ResultsDeps;
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
}

const ALL_CAPS = ["recompute", "overrideRequest", "overrideApprove", "lock", "close", "repin", "reopen", "decisionRecord", "decisionApprove", "appreciationWrite", "explain", "read"] as const;

export async function resultsPlugin(app: FastifyInstance, options: ResultsPluginOptions): Promise<void> {
  const { deps } = options;
  const kit: PermissionKit = createPermissionKit(options.requirePermission);
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (!options.resolveContext) throw new UnauthorizedError();
    return options.resolveContext(request);
  };
  const feature = (key: string): preHandlerAsyncHookHandler[] => {
    if (!options.requireFeature) return [];
    const guard = options.requireFeature(key);
    return [
      async function featureGate(this: FastifyInstance, request, reply) {
        return guard.call(this, request, reply);
      },
    ];
  };
  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "results : erreur inattendue");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    const caps = (req: FastifyRequest, reply: FastifyReply): Promise<ResultsCaps> => kit.capsFor(scope, req, reply, ALL_CAPS);

    // ===== Lecture des résultats ============================================================================
    scope.get("/classrooms/:classroomId/periods/:periodId", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const p = parse(resultsPeriodParamsSchema, req.params);
      const q = parse(resultsMatrixQuerySchema, req.query);
      const m = unwrapOrThrow(await getClassMatrix(deps, ctxOf(req), { classroomId: p.classroomId, academicPeriodId: p.periodId, withLines: q.lines, caps: await caps(req, reply) }));
      return { state: present.stateDto(m.state), rows: m.rows.map((r) => ({ header: present.headerDto(r.header), lines: r.lines.map(present.lineDto) })), decisions: m.decisions.map(present.decisionDto) };
    });

    scope.get("/classrooms/:classroomId/periods/:periodId/state", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const p = parse(resultsPeriodParamsSchema, req.params);
      const v = unwrapOrThrow(await getPeriodView(deps, ctxOf(req), { classroomId: p.classroomId, academicPeriodId: p.periodId, caps: await caps(req, reply) }));
      return {
        state: present.stateDto(v.state),
        ruleLag: v.ruleLag,
        counts: v.counts,
        pendingAssessments: v.pendingAssessments,
        closures: v.closures.map((c) => ({ id: c.id, resultsVersion: c.resultsVersion, resultsCount: c.resultsCount, closureHash: c.closureHash, closedAt: c.closedAt.toISOString(), forcedReason: c.forcedReason })),
        deliberations: v.deliberations.map(present.deliberationDto),
        recompute: v.recompute.map((r) => ({ id: r.id, status: r.status, notBefore: r.notBefore.toISOString(), blockedReason: r.blockedReason, attempts: r.attempts })),
      };
    });

    scope.get("/enrollments/:enrollmentId/periods/:periodId", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const p = parse(resultsEnrollmentPeriodParamsSchema, req.params);
      const r = unwrapOrThrow(await getEnrollmentResult(deps, ctxOf(req), { enrollmentId: p.enrollmentId, academicPeriodId: p.periodId, caps: await caps(req, reply) }));
      return { header: present.headerDto(r.header), lines: r.lines.map(present.lineDto), decisions: r.decisions.map(present.decisionDto) };
    });

    scope.get("/enrollments/:enrollmentId/years/:yearId", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const p = parse(resultsEnrollmentYearParamsSchema, req.params);
      return unwrapOrThrow(await getYearResult(deps, ctxOf(req), { enrollmentId: p.enrollmentId, academicYearId: p.yearId, caps: await caps(req, reply) }));
    });

    scope.get("/results/:id/explain",{ preHandler: kit.require(P.explain) }, async (req, reply) => {
      const { id } = parse(resultsIdParamsSchema, req.params);
      const r = unwrapOrThrow(await explainResult(deps, ctxOf(req), { resultId: id, caps: await caps(req, reply) }));
      return { header: present.headerDto(r.header), source: r.source, lines: r.lines };
    });

    scope.post("/recompute", { preHandler: kit.require(P.recompute) }, async (req, reply) => {
      const b = parse(resultsRecomputeBodySchema, req.body);
      const r = unwrapOrThrow(await recomputeNow(deps, ctxOf(req), { classroomId: b.classroomId, academicPeriodId: b.periodId, enrollmentIds: b.enrollmentIds, caps: await caps(req, reply) }));
      return r.report;
    });

    // ===== Cycle de période =================================================================================
    scope.post("/classrooms/:classroomId/periods/:periodId/lock", { preHandler: kit.require(P.lock) }, async (req, reply) => {
      const p = parse(resultsPeriodParamsSchema, req.params);
      const b = parse(resultsLockBodySchema, req.body);
      return present.stateDto(unwrapOrThrow(await lockPeriod(deps, ctxOf(req), { classroomId: p.classroomId, academicPeriodId: p.periodId, force: b.force, reason: b.reason, caps: await caps(req, reply) })));
    });

    scope.post("/classrooms/:classroomId/periods/:periodId/deliberate", { preHandler: [...feature("results.deliberation"), kit.require(P.decisionRecord)] }, async (req, reply) => {
      const p = parse(resultsPeriodParamsSchema, req.params);
      const b = parse(resultsDeliberateBodySchema, req.body);
      return present.stateDto(unwrapOrThrow(await deliberatePeriod(deps, ctxOf(req), { classroomId: p.classroomId, academicPeriodId: p.periodId, confirmProposed: b.confirmProposed, caps: await caps(req, reply) })));
    });

    scope.post("/classrooms/:classroomId/periods/:periodId/close", { preHandler: kit.require(P.close) }, async (req, reply) => {
      const p = parse(resultsPeriodParamsSchema, req.params);
      const b = parse(resultsCloseBodySchema, req.body);
      const r = unwrapOrThrow(await closePeriod(deps, ctxOf(req), { classroomId: p.classroomId, academicPeriodId: p.periodId, force: b.force, reason: b.reason, caps: await caps(req, reply) }));
      return { state: present.stateDto(r.state), closureId: r.closureId, closureHash: r.closureHash, resultsVersion: r.resultsVersion, resultsCount: r.resultsCount, excluded: r.excluded, withoutDeliberation: r.withoutDeliberation };
    });

    scope.post("/classrooms/:classroomId/periods/:periodId/reopen", { preHandler: kit.require(P.reopen) }, async (req, reply) => {
      const p = parse(resultsPeriodParamsSchema, req.params);
      const b = parse(resultsReopenBodySchema, req.body);
      return present.stateDto(unwrapOrThrow(await reopenPeriod(deps, ctxOf(req), { classroomId: p.classroomId, academicPeriodId: p.periodId, kind: b.kind, reason: b.reason, caps: await caps(req, reply) })));
    });

    scope.post("/periods/:id/repin", { preHandler: kit.require(P.repin) }, async (req, reply) => {
      const { id } = parse(resultsIdParamsSchema, req.params);
      const state = unwrapOrThrow(await getStateView(deps, ctxOf(req), { stateId: id }));
      if (!state.academicPeriodId) throw new ValidationError("Un état d'année ne se re-pinne pas.", [], { code: "results.repin_not_allowed" });
      const r = unwrapOrThrow(await repinPeriod(deps, ctxOf(req), { classroomId: state.classroomId, academicPeriodId: state.academicPeriodId, caps: await caps(req, reply) }));
      return { state: present.stateDto(r.state), changed: r.changed, simulation: r.simulation };
    });

    // ===== Surcharges =======================================================================================
    scope.get("/overrides", { preHandler: kit.anyOf(P.overrideRequest, P.overrideApprove) }, async (req, reply) => {
      const q = parse(resultsOverridesQuerySchema, req.query);
      return { items: unwrapOrThrow(await listOverridesView(deps, ctxOf(req), { ...q, caps: await caps(req, reply) })).map(present.overrideDto) };
    });
    scope.post("/overrides", { preHandler: kit.require(P.overrideRequest) }, async (req, reply) => {
      const b = parse(resultsOverrideCreateBodySchema, req.body);
      return reply.status(201).send(present.overrideDto(unwrapOrThrow(await requestOverride(deps, ctxOf(req), { ...b, caps: await caps(req, reply) }))));
    });
    scope.post("/overrides/:id/approve", { preHandler: kit.require(P.overrideApprove) }, async (req, reply) => {
      const { id } = parse(resultsIdParamsSchema, req.params);
      const b = parse(resultsOverrideDecisionBodySchema, req.body);
      return present.overrideDto(unwrapOrThrow(await approveOverride(deps, ctxOf(req), { overrideId: id, comment: b.comment, caps: await caps(req, reply) })));
    });
    scope.post("/overrides/:id/reject", { preHandler: kit.require(P.overrideApprove) }, async (req, reply) => {
      const { id } = parse(resultsIdParamsSchema, req.params);
      const b = parse(resultsOverrideRejectBodySchema, req.body);
      return present.overrideDto(unwrapOrThrow(await rejectOverride(deps, ctxOf(req), { overrideId: id, comment: b.comment, caps: await caps(req, reply) })));
    });
    scope.post("/overrides/:id/revoke", { preHandler: kit.require(P.overrideApprove) }, async (req, reply) => {
      const { id } = parse(resultsIdParamsSchema, req.params);
      const b = parse(resultsOverrideRevokeBodySchema, req.body);
      return present.overrideDto(unwrapOrThrow(await revokeOverrideUseCase(deps, ctxOf(req), { overrideId: id, reason: b.reason, caps: await caps(req, reply) })));
    });

    // ===== Décisions, délibérations, appréciations ===========================================================
    scope.get("/decisions", { preHandler: kit.anyOf(P.read, P.decisionRecord, P.decisionApprove) }, async (req, reply) => {
      const q = parse(resultsDecisionsQuerySchema, req.query);
      return { items: unwrapOrThrow(await listDecisionsView(deps, ctxOf(req), { ...q, caps: await caps(req, reply) })).map(present.decisionDto) };
    });
    scope.post("/decisions/:id/confirm", { preHandler: kit.anyOf(P.decisionRecord, P.decisionApprove) }, async (req, reply) => {
      const { id } = parse(resultsIdParamsSchema, req.params);
      const b = parse(resultsDecisionConfirmBodySchema, req.body);
      return present.decisionDto(unwrapOrThrow(await confirmDecisionUseCase(deps, ctxOf(req), { decisionId: id, ...b, caps: await caps(req, reply) })));
    });

    scope.get("/deliberations", { preHandler: [...feature("results.deliberation"), kit.anyOf(P.read, P.decisionRecord)] }, async (req, reply) => {
      const q = parse(resultsDeliberationsQuerySchema, req.query);
      return { items: unwrapOrThrow(await listDeliberationsView(deps, ctxOf(req), { stateId: q.stateId, caps: await caps(req, reply) })).map(present.deliberationDto) };
    });
    scope.post("/deliberations", { preHandler: [...feature("results.deliberation"), kit.require(P.decisionRecord)] }, async (req, reply) => {
      const b = parse(resultsDeliberationCreateBodySchema, req.body);
      return reply.status(201).send(present.deliberationDto(unwrapOrThrow(await createDeliberation(deps, ctxOf(req), { ...b, caps: await caps(req, reply) }))));
    });
    scope.patch("/deliberations/:id", { preHandler: [...feature("results.deliberation"), kit.require(P.decisionRecord)] }, async (req, reply) => {
      const { id } = parse(resultsIdParamsSchema, req.params);
      const b = parse(resultsDeliberationUpdateBodySchema, req.body);
      return present.deliberationDto(unwrapOrThrow(await updateDeliberationUseCase(deps, ctxOf(req), { deliberationId: id, ...b, caps: await caps(req, reply) })));
    });

    scope.get("/appreciations", { preHandler: kit.anyOf(P.read, P.appreciationWrite) }, async (req, reply) => {
      const q = parse(resultsAppreciationsQuerySchema, req.query);
      return { items: unwrapOrThrow(await listAppreciationsView(deps, ctxOf(req), { ...q, caps: await caps(req, reply) })).map(present.appreciationDto) };
    });
    scope.put("/appreciations", { preHandler: kit.require(P.appreciationWrite) }, async (req, reply) => {
      const b = parse(resultsAppreciationBodySchema, req.body);
      const ctx = ctxOf(req);
      // l'auteur est le membre du personnel lié au compte (jamais un identifiant fourni par le client)
      const authorStaffId = ctx.userId ? await deps.ports.names.staffIdForUser(ctx, ctx.userId) : null;
      if (!authorStaffId) throw new ForbiddenError("Aucun profil de personnel n'est lié à votre compte.", { code: "results.forbidden" });
      return present.appreciationDto(unwrapOrThrow(await writeAppreciation(deps, ctx, { ...b, authorStaffId, caps: await caps(req, reply) })));
    });

    // ===== Réglages =========================================================================================
    scope.get("/settings", { preHandler: kit.anyOf(P.read, P.settingsManage) }, async (req) => present.settingsDto(unwrapOrThrow(await getResultsSettings(deps, ctxOf(req)))));
    scope.put("/settings", { preHandler: kit.require(P.settingsManage) }, async (req) => present.settingsDto(unwrapOrThrow(await updateResultsSettings(deps, ctxOf(req), parse(resultsSettingsUpdateBodySchema, req.body)))));

    // ===== Élève et tuteur ==================================================================================
    scope.get("/me/results", { preHandler: [...feature("results.public-visibility"), kit.require(P.selfRead)] }, async (req) => ({ items: unwrapOrThrow(await listMyResults(deps, ctxOf(req))) }));
    scope.get("/children/:studentId/results", { preHandler: [...feature("results.public-visibility"), kit.require(P.childRead)] }, async (req) => {
      const { studentId } = parse(resultsChildParamsSchema, req.params);
      return { items: unwrapOrThrow(await listChildResults(deps, ctxOf(req), { studentId })) };
    });
  });
}

// ---------------------------------------------------------------------------
// Contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

/** Instance RACINE : pose le registre de ports que les modules voisins renseignent (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("resultsPorts")) app.decorate("resultsPorts", createPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/results`). */
export default async function resultsModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("resultsPorts")) app.decorate("resultsPorts", createPortRegistry());
  const assessDeps = createAssessDeps({ db: runtime.tenantDb, clock: runtime.clock, audit: runtime.auditPort, logger: runtime.logger, portsProvider: () => ({}) });
  const assessPort = assessPortFrom(assessDeps);
  let rulesPort: ReturnType<typeof rulesPortFrom> | undefined;
  const deps = createResultsDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: runtime.auditPort,
    logger: runtime.logger,
    portsProvider: () => {
      // `app.rules` (API du module rules) est posé par son `setup` à la racine : résolu à la requête, ordre de chargement indifférent
      if (!rulesPort && app.hasDecorator("rules")) rulesPort = rulesPortFrom(app.rules);
      return { assess: assessPort, ...(rulesPort ? { rules: rulesPort } : {}), ...app.resultsPorts.current };
    },
  });
  await app.register(resultsPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
  });
}
