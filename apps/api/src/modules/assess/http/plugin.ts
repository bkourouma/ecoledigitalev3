/**
 * Plugin Fastify du module assess — routes SANS préfixe (le registre applique `/api/v1/assess`, voir
 * `docs/architecture/platform-assembly.md`). Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la
 * RACINE avec le registre de ports (`app.assessPorts`) que `academic`, `people` et `scheduling` renseignent
 * (`registerAssessPorts`).
 *
 *  - Authentification : `request.ctx` posé en amont (iam v2 / legacy dérivé). Aucune confiance dans un en-tête client.
 *  - Autorisation : `requirePermission('…')` du module rbac, jamais un rôle codé en dur ; les permissions sensibles
 *    (approuver, publier, approuver une correction, gérer les types) exigent la MFA (garde rbac). Les décisions
 *    CONTEXTUELLES (évaluation d'un autre enseignant, affectation) sont prises par les cas d'usage avec les capacités.
 *  - Entitlements : `requireFeature('assess.session2')` pour la création d'une évaluation de session 2.
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `assess.*` ; jamais de message interne.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, z, type ZodTypeAny } from "zod";
import { UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  assessAdditionRequestBodySchema,
  assessCancelBodySchema,
  assessChildParamsSchema,
  assessIdempotencyKeySchema,
  assessIdParamsSchema,
  assessListAssessmentsQuerySchema,
  assessListRevisionsQuerySchema,
  assessMyGradesQuerySchema,
  assessRejectRevisionBodySchema,
  assessRevisionDecisionBodySchema,
  assessRevisionRequestBodySchema,
  assessSaveGradesBodySchema,
  assessSettingsUpdateBodySchema,
  assessTransitionBodySchema,
  assessTypeCreateBodySchema,
  assessTypeUpdateBodySchema,
  assessmentBulkCreateBodySchema,
  assessmentCreateBodySchema,
  assessmentUpdateBodySchema,
} from "@ecoledigitale/contracts/src/v2/assess";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createAssessDeps, type AssessCaps, type AssessDeps } from "../application/deps";
import { bulkCreateAssessments, createAssessment, getAssessmentTransitions, getAssessmentView, listAssessmentsView, updateAssessment } from "../application/assessments";
import { getGradeSheet, saveGrades } from "../application/grades";
import { getPeriodLock } from "../application/locks";
import type { AssessPorts } from "../application/ports";
import { listChildGrades, listMyGrades } from "../application/reads";
import { applyRevision, approveRevision, getGradeHistory, getRevisionView, listRevisionsView, rejectRevision, requestAddition, requestRevision } from "../application/revisions";
import { createAssessmentType, getAssessSettings, listAssessmentTypes, updateAssessmentType, updateAssessSettings } from "../application/types";
import { cancelAssessment, transitionAssessment } from "../application/workflow";
import type { TransitionTarget } from "../domain/workflow";
import { createPermissionKit, PERMISSIONS as P, type PermissionKit } from "./guards";
import * as present from "./presenters";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par academic, people, scheduling…)
// ---------------------------------------------------------------------------

export interface AssessPortRegistry {
  /** Enregistre (ou remplace) des ports ; les cas d'usage les relisent à chaque appel. */
  register(ports: Partial<AssessPorts>): void;
  readonly current: Partial<AssessPorts>;
}

export function createPortRegistry(initial: Partial<AssessPorts> = {}): AssessPortRegistry {
  let current: Partial<AssessPorts> = { ...initial };
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
    /** Registre des ports du module assess (posé par `setup`). */
    assessPorts: AssessPortRegistry;
  }
}

/** À appeler par les modules voisins (`academic`, `people`) dans leur `setup(app, runtime)`. */
export function registerAssessPorts(app: FastifyInstance, ports: Partial<AssessPorts>): void {
  if (!app.hasDecorator("assessPorts")) app.decorate("assessPorts", createPortRegistry());
  app.assessPorts.register(ports);
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
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "assess.bad_request" });
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: "assess.payload_too_large" });
  }
  return error;
}

export interface AssessPluginOptions {
  deps: AssessDeps;
  /** Garde `requirePermission` du module rbac (`runtime.requirePermission`). */
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde `requireFeature` du module entitlements ; absente = toutes les features actives (tests autonomes). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
}

const TARGET_PERMISSION: Readonly<Record<TransitionTarget, readonly string[]>> = Object.freeze({
  SUBMITTED: [P.gradeEnter],
  REVIEWED: [P.gradeReview],
  APPROVED: [P.gradeValidate],
  PUBLISHED: [P.gradePublish],
  DRAFT: [P.gradeEnter, P.gradeReview, P.gradeValidate, P.gradePublish],
});

export async function assessPlugin(app: FastifyInstance, options: AssessPluginOptions): Promise<void> {
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
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "assess : erreur inattendue");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    const caps = (req: FastifyRequest, reply: FastifyReply, keys: ReadonlyArray<keyof AssessCaps>): Promise<AssessCaps> => kit.capsFor(scope, req, reply, keys);
    const ALL_CAPS = ["manage", "review", "validate", "publish", "reviseRequest", "reviseApprove"] as const;

    // ===== Types d'évaluation et réglages ===================================================================
    scope.get("/assessment-types", { preHandler: kit.anyOf(P.typeRead, P.assessmentRead) }, async (req) => {
      const q = parse(assessIncludeInactiveSchema, req.query);
      return { items: unwrapOrThrow(await listAssessmentTypes(deps, ctxOf(req), q)).map(present.typeDto) };
    });
    scope.post("/assessment-types", { preHandler: kit.require(P.typeManage) }, async (req, reply) =>
      reply.status(201).send(present.typeDto(unwrapOrThrow(await createAssessmentType(deps, ctxOf(req), parse(assessTypeCreateBodySchema, req.body))))),
    );
    scope.patch("/assessment-types/:id", { preHandler: kit.require(P.typeManage) }, async (req) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      return present.typeDto(unwrapOrThrow(await updateAssessmentType(deps, ctxOf(req), { typeId: id, patch: parse(assessTypeUpdateBodySchema, req.body) })));
    });
    scope.get("/settings", { preHandler: kit.anyOf(P.typeRead, P.typeManage) }, async (req) => present.settingsDto(unwrapOrThrow(await getAssessSettings(deps, ctxOf(req)))));
    scope.put("/settings", { preHandler: kit.require(P.typeManage) }, async (req) =>
      present.settingsDto(unwrapOrThrow(await updateAssessSettings(deps, ctxOf(req), parse(assessSettingsUpdateBodySchema, req.body)))),
    );

    // ===== Évaluations ======================================================================================
    scope.get("/assessments", { preHandler: kit.anyOf(P.assessmentRead, P.gradeRead) }, async (req, reply) => {
      const q = parse(assessListAssessmentsQuerySchema, req.query);
      const page = unwrapOrThrow(await listAssessmentsView(deps, ctxOf(req), { ...q, caps: await caps(req, reply, ALL_CAPS) }));
      return { items: page.items.map(present.assessmentDto), nextCursor: page.nextCursor };
    });

    scope.post("/assessments", { preHandler: kit.anyOf(P.assessmentCreate, P.assessmentManage) }, async (req, reply) => {
      const b = parse(assessmentCreateBodySchema, req.body);
      if (b.sessionNo === 2) await runGuard(scope, feature("assess.session2"), req, reply);
      const a = unwrapOrThrow(await createAssessment(deps, ctxOf(req), { ...b, caps: await caps(req, reply, ["manage"]) }));
      return reply.status(201).send(present.assessmentDto(a));
    });

    scope.post("/assessments/bulk", { preHandler: kit.anyOf(P.assessmentCreate, P.assessmentManage) }, async (req, reply) => {
      const b = parse(assessmentBulkCreateBodySchema, req.body);
      if (b.sessionNo === 2) await runGuard(scope, feature("assess.session2"), req, reply);
      const items = unwrapOrThrow(await bulkCreateAssessments(deps, ctxOf(req), { ...b, caps: await caps(req, reply, ["manage"]) }));
      return reply.status(201).send({ items: items.map(present.assessmentDto) });
    });

    scope.get("/assessments/:id", { preHandler: kit.anyOf(P.assessmentRead, P.gradeRead) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      return present.assessmentDto(unwrapOrThrow(await getAssessmentView(deps, ctxOf(req), { assessmentId: id, caps: await caps(req, reply, ALL_CAPS) })));
    });

    scope.patch("/assessments/:id", { preHandler: kit.anyOf(P.assessmentUpdate, P.assessmentManage) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const b = parse(assessmentUpdateBodySchema, req.body);
      if (b.sessionNo === 2) await runGuard(scope, feature("assess.session2"), req, reply);
      return present.assessmentDto(unwrapOrThrow(await updateAssessment(deps, ctxOf(req), { assessmentId: id, ...b, caps: await caps(req, reply, ["manage"]) })));
    });

    scope.get("/assessments/:id/transitions", { preHandler: kit.anyOf(P.assessmentRead, P.gradeRead) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const items = unwrapOrThrow(await getAssessmentTransitions(deps, ctxOf(req), { assessmentId: id, caps: await caps(req, reply, ALL_CAPS) }));
      return {
        items: items.map((t) => ({ id: t.id, from: t.fromStatus, to: t.toStatus, actorId: t.actorId, actorName: t.actorName, comment: t.comment, fourEyesWaived: t.fourEyesWaived, at: t.at.toISOString() })),
      };
    });

    // ===== Notes ============================================================================================
    scope.get("/assessments/:id/grades", { preHandler: kit.anyOf(P.gradeRead, P.gradeEnter) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const sheet = unwrapOrThrow(await getGradeSheet(deps, ctxOf(req), { assessmentId: id, caps: await caps(req, reply, ALL_CAPS) }));
      return {
        assessment: present.assessmentDto(sheet.assessment),
        grades: sheet.grades.map(present.gradeDto),
        pending: sheet.pending.map((p) => ({ enrollmentId: p.enrollmentId, studentId: p.studentId })),
      };
    });

    scope.put("/assessments/:id/grades", { preHandler: kit.require(P.gradeEnter) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const b = parse(assessSaveGradesBodySchema, req.body);
      const rawKey = req.headers["idempotency-key"];
      const key = rawKey === undefined ? undefined : parse(assessIdempotencyKeySchema, Array.isArray(rawKey) ? rawKey[0] : rawKey);
      const r = unwrapOrThrow(await saveGrades(deps, ctxOf(req), { assessmentId: id, entries: b.entries, idempotencyKey: key, caps: await caps(req, reply, ["manage"]) }));
      return { assessmentId: r.assessmentId, created: r.created, updated: r.updated, unchanged: r.unchanged, replayed: r.replayed, grades: r.grades.map(present.gradeDto) };
    });

    // ===== Circuit de validation ============================================================================
    scope.post("/assessments/:id/transitions", async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const b = parse(assessTransitionBodySchema, req.body);
      // La permission dépend de l'étape visée : soumettre = saisir ; relire ; approuver ; publier.
      await runGuard(scope, [kit.anyOf(...(TARGET_PERMISSION[b.to] ?? []))], req, reply);
      const r = unwrapOrThrow(await transitionAssessment(deps, ctxOf(req), { assessmentId: id, to: b.to, comment: b.comment, rowVersion: b.rowVersion, caps: await caps(req, reply, ALL_CAPS) }));
      return { assessment: present.assessmentDto(r.assessment), autoPublished: r.autoPublished };
    });

    scope.post("/assessments/:id/cancel", { preHandler: kit.anyOf(P.reviseRequest, P.assessmentUpdate, P.assessmentManage) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const b = parse(assessCancelBodySchema, req.body);
      const r = unwrapOrThrow(await cancelAssessment(deps, ctxOf(req), { assessmentId: id, reason: b.reason, caps: await caps(req, reply, ALL_CAPS) }));
      return reply.status(r.assessment ? 200 : 202).send({ assessment: r.assessment ? present.assessmentDto(r.assessment) : null, revisions: r.revisions.map(present.revisionDto) });
    });

    // ===== Révisions ========================================================================================
    scope.post("/grades/:id/revisions", { preHandler: kit.require(P.reviseRequest) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const b = parse(assessRevisionRequestBodySchema, req.body);
      const r = unwrapOrThrow(await requestRevision(deps, ctxOf(req), { gradeId: id, ...b, caps: await caps(req, reply, ALL_CAPS) }));
      return reply.status(201).send(present.revisionDto(r));
    });

    scope.post("/assessments/:id/additions", { preHandler: kit.require(P.reviseRequest) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const b = parse(assessAdditionRequestBodySchema, req.body);
      const r = unwrapOrThrow(await requestAddition(deps, ctxOf(req), { assessmentId: id, ...b, caps: await caps(req, reply, ALL_CAPS) }));
      return reply.status(201).send(present.revisionDto(r));
    });

    scope.get("/grades/:id/history", { preHandler: kit.anyOf(P.gradeValidate, P.gradeReview, P.gradePublish, P.reviseApprove, P.assessmentManage) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const h = unwrapOrThrow(await getGradeHistory(deps, ctxOf(req), { gradeId: id, caps: await caps(req, reply, ALL_CAPS) }));
      return {
        gradeId: h.grade.id,
        assessmentId: h.assessment.id,
        enrollmentId: h.grade.enrollmentId,
        current: present.gradeDto(h.grade),
        assessmentStatusTrail: h.trail.map((t) => ({ status: t.toStatus, at: t.at.toISOString(), by: t.actorId })),
        revisions: h.revisions.map(present.revisionDto),
      };
    });

    scope.get("/revisions", { preHandler: kit.anyOf(P.reviseApprove, P.reviseRequest) }, async (req, reply) => {
      const q = parse(assessListRevisionsQuerySchema, req.query);
      const page = unwrapOrThrow(await listRevisionsView(deps, ctxOf(req), { ...q, caps: await caps(req, reply, ALL_CAPS) }));
      return { items: page.items.map(present.revisionDto), nextCursor: page.nextCursor };
    });

    scope.get("/revisions/:id", { preHandler: kit.anyOf(P.reviseApprove, P.reviseRequest) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      return present.revisionDto(unwrapOrThrow(await getRevisionView(deps, ctxOf(req), { revisionId: id, caps: await caps(req, reply, ALL_CAPS) })));
    });

    scope.post("/revisions/:id/approve", { preHandler: kit.require(P.reviseApprove) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const b = parse(assessRevisionDecisionBodySchema, req.body);
      const r = unwrapOrThrow(await approveRevision(deps, ctxOf(req), { revisionId: id, comment: b.comment, caps: await caps(req, reply, ALL_CAPS) }));
      return { revisions: r.revisions.map(present.revisionDto), applied: r.applied, cancelled: r.cancelled ? present.assessmentDto(r.cancelled) : null };
    });

    scope.post("/revisions/:id/reject", { preHandler: kit.require(P.reviseApprove) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      const b = parse(assessRejectRevisionBodySchema, req.body);
      const r = unwrapOrThrow(await rejectRevision(deps, ctxOf(req), { revisionId: id, comment: b.comment, caps: await caps(req, reply, ALL_CAPS) }));
      return { revisions: r.map(present.revisionDto) };
    });

    scope.post("/revisions/:id/apply", { preHandler: kit.require(P.reviseApprove) }, async (req, reply) => {
      const { id } = parse(assessIdParamsSchema, req.params);
      return present.revisionDto(unwrapOrThrow(await applyRevision(deps, ctxOf(req), { revisionId: id, caps: await caps(req, reply, ALL_CAPS) })));
    });

    // ===== Verrous (lecture) ================================================================================
    scope.get("/classrooms/:classroomId/periods/:periodId/lock", { preHandler: kit.anyOf(P.assessmentRead, P.gradeRead) }, async (req) => {
      const p = parse(assessLockParamsSchema, req.params);
      const lock = unwrapOrThrow(await getPeriodLock(deps, ctxOf(req), { classroomId: p.classroomId, academicPeriodId: p.periodId }));
      return { lock: lock ? present.lockDto(lock) : null };
    });

    // ===== Élève et tuteur ==================================================================================
    scope.get("/me/grades", { preHandler: kit.require(P.selfRead) }, async (req) => {
      const q = parse(assessMyGradesQuerySchema, req.query);
      const page = unwrapOrThrow(await listMyGrades(deps, ctxOf(req), q));
      return { items: page.items.map(present.publishedGradeDto), nextCursor: page.nextCursor };
    });

    scope.get("/children/:studentId/grades", { preHandler: kit.require(P.childRead) }, async (req) => {
      const { studentId } = parse(assessChildParamsSchema, req.params);
      const q = parse(assessMyGradesQuerySchema, req.query);
      const page = unwrapOrThrow(await listChildGrades(deps, ctxOf(req), { studentId, ...q }));
      return { items: page.items.map(present.publishedGradeDto), nextCursor: page.nextCursor };
    });
  });
}

const assessIncludeInactiveSchema = z.object({ includeInactive: z.enum(["true", "false"]).transform((v) => v === "true").optional() }).strict();
const assessLockParamsSchema = z.object({ classroomId: z.string().uuid(), periodId: z.string().uuid() }).strict();

/** Exécute des gardes Fastify (`preHandler`) depuis un handler (permission dépendant du corps de la requête). */
async function runGuard(scope: FastifyInstance, guards: preHandlerAsyncHookHandler[], req: FastifyRequest, reply: FastifyReply): Promise<void> {
  for (const g of guards) await g.call(scope, req, reply);
}

// ---------------------------------------------------------------------------
// Contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

/** Instance RACINE : pose le registre de ports que les modules voisins renseignent (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("assessPorts")) app.decorate("assessPorts", createPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/assess`). */
export default async function assessModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("assessPorts")) app.decorate("assessPorts", createPortRegistry());
  const deps = createAssessDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: runtime.auditPort,
    logger: runtime.logger,
    portsProvider: () => app.assessPorts.current,
  });
  await app.register(assessPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
  });
}
