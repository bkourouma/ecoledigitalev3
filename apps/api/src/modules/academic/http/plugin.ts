/**
 * Plugin Fastify du module academic — `/api/v1/academic/*` (le registre applique le préfixe ; les routes sont
 * déclarées SANS préfixe, contrat `(app, runtime)` de `platform/runtime.ts`).
 *
 * - Authentification : `request.ctx` (RequestContext) posé en amont (module iam / authentification historique).
 * - Autorisation : `requirePermission('…')` du module rbac (injectable pour les tests). Aucun contrôle de rôle codé en dur.
 * - Entitlements : `academic.a-la-carte` (offres, catalogue, libre-service), `academic.state-assigned` (financement
 *   « affecté par l'État »), `academic.rollover` (reconduction) via `requireFeature` / `isFeatureEnabled`.
 * - Erreurs : `AppError` / Zod -> `toErrorBody` (`{ status, code, kind, message, issues?, requestId }`) ; jamais de message interne.
 * - Entrées STRICTES (champ inconnu refusé) ; aucun 500 pour une violation d'unicité ou de CHECK prévisible.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  toAppError,
  toErrorBody,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import * as c from "@ecoledigitale/contracts/src/v2/academic";
import type { ModuleRuntime } from "../../../platform/runtime";
import { academicAuditAdapter } from "../infrastructure/audit-adapter";
import { createTenancyInstitutionDirectory } from "../infrastructure/tenancy-directory";
import { createAcademicDeps, type AcademicDeps } from "../application/deps";
import { createAcademicPortRegistry, type AcademicPortRegistry } from "../application/port-registry";
import type { AcademicPorts } from "../application/ports";
import * as calendar from "../application/calendar";
import * as classrooms from "../application/classrooms";
import * as courses from "../application/courses";
import * as curriculum from "../application/curriculum";
import * as enrollments from "../application/enrollments";
import * as holidays from "../application/holidays";
import * as programs from "../application/programs";
import * as reads from "../application/reads";
import * as reference from "../application/reference";
import * as rollover from "../application/rollover";
import * as rolloverRun from "../application/rollover-run";
import { CLASSROOM_ACTION_TARGETS, type ClassroomAction } from "../domain/classroom";
import { ENROLLMENT_ACTION_TARGETS, type EnrollmentAction } from "../domain/enrollment";
import { AcademicCode } from "../domain/errors";

export const ACADEMIC_ROUTES_PREFIX = "/api/v1/academic";

export interface AcademicPluginOptions {
  deps: AcademicDeps;
  /** Garde de permission (défaut : celle du module rbac, injectée par le registre). */
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde de route `requireFeature(key)` du module entitlements. Absente : `isFeatureEnabled` (ou tout autorisé). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  isFeatureEnabled?: (ctx: RequestContext, featureKey: string) => Promise<boolean>;
  /** `request.ctx` ou `UnauthorizedError` (défaut : lit `request.ctx`). */
  resolveContext?: (request: FastifyRequest) => RequestContext;
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError(
    "Données invalides.",
    error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
    { code: AcademicCode.INVALID_INPUT },
  );
}

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function maybeFastifyValidation(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    const e = error as { statusCode?: number; code?: string };
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: "academic.payload_too_large" });
    if (e.statusCode === 415 || e.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return new ValidationError("Type de contenu non pris en charge (JSON attendu).", [], { code: "academic.unsupported_media_type" });
    }
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "academic.bad_request" });
  }
  return error;
}

const eligibilityDto = (r: courses.EligibilityReport): c.AcademicEligibilityDto => ({
  offeringId: r.offeringId,
  studentId: r.studentId,
  eligible: r.eligible,
  code: (r.failure?.code ?? null) as c.AcademicEligibilityDto["code"],
  message: r.failure?.message ?? null,
  missingPrerequisiteLineageIds: r.missingPrerequisites,
  warnings: r.warnings,
  remainingPlaces: r.remainingPlaces,
});

export async function academicPlugin(app: FastifyInstance, options: AcademicPluginOptions): Promise<void> {
  const { deps } = options;
  const perm = options.requirePermission;
  const ctxOf = (req: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(req);
    const ctx = (req as unknown as { ctx?: RequestContext }).ctx;
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };

  /** Permission PUIS feature : 403 `entitlements.feature_not_available` avant toute lecture du corps. */
  const withFeature = (permission: string, feature: string): preHandlerAsyncHookHandler[] => {
    const guards: preHandlerAsyncHookHandler[] = [perm(permission)];
    if (options.requireFeature) {
      const featureGuard = options.requireFeature(feature);
      guards.push(async function featureGate(request, reply) {
        return featureGuard.call(request.server, request, reply);
      });
    }
    return guards;
  };

  const featureEnabledOrThrow = async (ctx: RequestContext, feature: string): Promise<void> => {
    if (options.isFeatureEnabled && !(await options.isFeatureEnabled(ctx, feature))) {
      throw new ForbiddenError("Cette fonctionnalité n'est pas incluse dans l'offre de l'établissement.", { code: AcademicCode.FEATURE_DISABLED, details: { feature } });
    }
  };

  /** Garde « feature » seule, déjà liée à l'instance Fastify (tableau vide si le câblage ne fournit pas `requireFeature`). */
  const featureGuards = (feature: string): preHandlerAsyncHookHandler[] => {
    if (!options.requireFeature) return [];
    const featureGuard = options.requireFeature(feature);
    return [async (request, reply) => featureGuard.call(request.server, request, reply)];
  };

  /** Permission retenue par `anyOf` pour la requête (la première satisfaite). */
  const matchedPermission = new WeakMap<FastifyRequest, string>();

  /** Satisfait par l'une OU l'autre des permissions (ex. catalogue : `enrollment.read` ou `enrollment.self.read`). */
  const anyOf = (...permissions: string[]): preHandlerAsyncHookHandler =>
    async function anyOfGuard(this: FastifyInstance, request, reply) {
      let last: unknown;
      for (const p of permissions) {
        try {
          await perm(p).call(this, request, reply);
          matchedPermission.set(request, p);
          return;
        } catch (e) {
          last = e;
        }
      }
      throw last;
    };

  /** Garde appelée DANS un handler quand le corps le demande (dérogation `override`). */
  const overrideGuard = perm("enrollment.override");
  const requireOverridePermission = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await overrideGuard.call(app, req, reply);
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "academic : erreur inattendue");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  await app.register(
    async (scope) => {
      scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));

      // ===== Années ============================================================================================
      scope.get("/years", { preHandler: perm("academic.year.read") }, async (req) => {
        const q = parse(c.academicListYearsQuerySchema, req.query);
        return { items: unwrapOrThrow(await calendar.listAcademicYears(deps, ctxOf(req), q)) };
      });
      scope.get("/years/current", { preHandler: perm("academic.year.read") }, async (req) => {
        const q = parse(c.academicCurrentYearQuerySchema, req.query);
        return unwrapOrThrow(await calendar.getCurrentAcademicYear(deps, ctxOf(req), q.institutionId));
      });
      scope.get("/years/gaps", { preHandler: perm("academic.year.read") }, async (req) => ({ items: unwrapOrThrow(await calendar.findYearGaps(deps, ctxOf(req))) }));
      scope.get("/years/:id", { preHandler: perm("academic.year.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await calendar.getAcademicYear(deps, ctxOf(req), id));
      });
      scope.post("/years", { preHandler: perm("academic.year.manage") }, async (req, reply) => {
        const b = parse(c.academicCreateYearBodySchema, req.body);
        return reply.status(201).send(unwrapOrThrow(await calendar.createAcademicYear(deps, ctxOf(req), b)));
      });
      scope.patch("/years/:id", { preHandler: perm("academic.year.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await calendar.updateAcademicYear(deps, ctxOf(req), id, parse(c.academicUpdateYearBodySchema, req.body)));
      });
      scope.post("/years/:id/open", { preHandler: perm("academic.year.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await calendar.openAcademicYear(deps, ctxOf(req), id));
      });
      scope.post("/years/:id/set-current", { preHandler: perm("academic.year.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await calendar.setCurrentAcademicYear(deps, ctxOf(req), id));
      });
      scope.post("/years/:id/archive", { preHandler: perm("academic.year.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await calendar.archiveAcademicYear(deps, ctxOf(req), id));
      });
      scope.post("/years/:id/close", { preHandler: perm("academic.year.close") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicCloseYearBodySchema, req.body);
        return unwrapOrThrow(await calendar.closeAcademicYear(deps, ctxOf(req), id, b.reason));
      });

      // ===== Périodes ==========================================================================================
      scope.get("/years/:id/periods", { preHandler: perm("academic.period.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return { items: unwrapOrThrow(await calendar.listAcademicPeriods(deps, ctxOf(req), id)) };
      });
      scope.post("/years/:id/periods", { preHandler: perm("academic.period.manage") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicCreatePeriodBodySchema, req.body);
        return reply.status(201).send(unwrapOrThrow(await calendar.createPeriod(deps, ctxOf(req), id, b)));
      });
      scope.post("/years/:id/period-plan", { preHandler: perm("academic.period.manage") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicApplyPeriodPlanBodySchema, req.body);
        return reply.status(201).send({ items: unwrapOrThrow(await calendar.applyPeriodPlan(deps, ctxOf(req), id, b.planCode)) });
      });
      scope.get("/periods/resolve", { preHandler: perm("academic.period.read") }, async (req) => {
        const q = parse(c.academicResolvePeriodQuerySchema, req.query);
        const period = unwrapOrThrow(await calendar.resolvePeriodForDate(deps, ctxOf(req), { institutionId: q.institutionId ?? null, date: q.date, typeCode: q.type ?? null }));
        return { period };
      });
      scope.patch("/periods/:id", { preHandler: perm("academic.period.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await calendar.updatePeriod(deps, ctxOf(req), id, parse(c.academicUpdatePeriodBodySchema, req.body)));
      });
      scope.delete("/periods/:id", { preHandler: perm("academic.period.manage") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        unwrapOrThrow(await calendar.deletePeriod(deps, ctxOf(req), id));
        return reply.status(204).send();
      });
      scope.post("/periods/:id/open", { preHandler: perm("academic.period.close") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await calendar.openPeriod(deps, ctxOf(req), id));
      });
      scope.post("/periods/:id/close-grading", { preHandler: perm("academic.period.close") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await calendar.closePeriodGrading(deps, ctxOf(req), id));
      });
      scope.post("/periods/:id/close", { preHandler: perm("academic.period.close") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await calendar.closePeriod(deps, ctxOf(req), id));
      });
      scope.post("/periods/:id/reopen", { preHandler: perm("academic.period.reopen") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicReopenBodySchema, req.body);
        return unwrapOrThrow(await calendar.reopenPeriod(deps, ctxOf(req), id, b.reason));
      });

      // ===== Référentiels, paramètres, modèle de pack ==========================================================
      scope.get("/reference/:kind", { preHandler: perm("academic.read") }, async (req) => {
        const { kind } = parse(c.academicReferenceKindParamsSchema, req.params);
        return { items: unwrapOrThrow(await reference.listReference(deps, ctxOf(req), kind)) };
      });
      scope.put("/reference/:kind", { preHandler: perm("academic.settings.manage") }, async (req) => {
        const { kind } = parse(c.academicReferenceKindParamsSchema, req.params);
        const schemas = {
          "education-levels": c.academicPutEducationLevelsBodySchema,
          "grade-levels": c.academicPutGradeLevelsBodySchema,
          "period-types": c.academicPutPeriodTypesBodySchema,
          "period-plans": c.academicPutPeriodPlansBodySchema,
          "funding-types": c.academicPutFundingTypesBodySchema,
          "enrollment-outcomes": c.academicPutOutcomesBodySchema,
          "node-types": c.academicPutNodeTypesBodySchema,
        } as const;
        const body = parse(schemas[kind], req.body) as { items: Array<Record<string, unknown>> };
        const ctx = ctxOf(req);
        const result = unwrapOrThrow(await reference.putReference(deps, ctx, kind, body.items));
        return { ...result, items: unwrapOrThrow(await reference.listReference(deps, ctx, kind)) };
      });
      scope.get("/institutions/:id/settings", { preHandler: perm("academic.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await reference.getSettings(deps, ctxOf(req), id));
      });
      scope.put("/institutions/:id/settings", { preHandler: perm("academic.settings.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await reference.updateSettings(deps, ctxOf(req), id, parse(c.academicUpdateSettingsBodySchema, req.body)));
      });
      scope.post("/institutions/:id/apply-template", { preHandler: perm("academic.template.apply") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicApplyTemplateBodySchema, req.body);
        return unwrapOrThrow(await reference.instantiatePackReferenceData(deps, ctxOf(req), id, { pack: b.pack, educationSystem: b.educationSystem }));
      });

      // ===== Programmes et matières ============================================================================
      scope.get("/programs", { preHandler: perm("academic.program.read") }, async (req) => {
        const q = parse(c.academicListProgramsQuerySchema, req.query);
        return { items: unwrapOrThrow(await programs.listPrograms(deps, ctxOf(req), q)) };
      });
      scope.get("/programs/:id", { preHandler: perm("academic.program.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await programs.getProgram(deps, ctxOf(req), id));
      });
      scope.post("/programs", { preHandler: perm("academic.program.manage") }, async (req, reply) => {
        return reply.status(201).send(unwrapOrThrow(await programs.createProgram(deps, ctxOf(req), parse(c.academicCreateProgramBodySchema, req.body))));
      });
      scope.patch("/programs/:id", { preHandler: perm("academic.program.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await programs.updateProgram(deps, ctxOf(req), id, parse(c.academicUpdateProgramBodySchema, req.body)));
      });
      scope.put("/programs/:id/grade-levels", { preHandler: perm("academic.program.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicSetProgramGradeLevelsBodySchema, req.body);
        return unwrapOrThrow(await programs.setProgramGradeLevels(deps, ctxOf(req), id, b.gradeLevelIds));
      });
      scope.get("/subjects", { preHandler: perm("curriculum.read") }, async (req) => {
        const q = parse(c.academicListSubjectsQuerySchema, req.query);
        return { items: unwrapOrThrow(await programs.listSubjects(deps, ctxOf(req), q)) };
      });
      scope.get("/subjects/:id", { preHandler: perm("curriculum.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await programs.getSubject(deps, ctxOf(req), id));
      });
      scope.post("/subjects", { preHandler: perm("curriculum.manage") }, async (req, reply) => {
        return reply.status(201).send(unwrapOrThrow(await programs.createSubject(deps, ctxOf(req), parse(c.academicCreateSubjectBodySchema, req.body))));
      });
      scope.patch("/subjects/:id", { preHandler: perm("curriculum.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await programs.updateSubject(deps, ctxOf(req), id, parse(c.academicUpdateSubjectBodySchema, req.body)));
      });
      scope.delete("/subjects/:id", { preHandler: perm("curriculum.manage") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        unwrapOrThrow(await programs.deleteSubject(deps, ctxOf(req), id));
        return reply.status(204).send();
      });

      // ===== Curriculum ========================================================================================
      scope.get("/curriculum-versions", { preHandler: perm("curriculum.read") }, async (req) => {
        const q = parse(c.academicListCurriculumVersionsQuerySchema, req.query);
        return { items: unwrapOrThrow(await curriculum.listCurriculumVersions(deps, ctxOf(req), q)) };
      });
      scope.get("/curriculum-versions/:id", { preHandler: perm("curriculum.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await curriculum.getCurriculumTree(deps, ctxOf(req), { versionId: id }));
      });
      scope.post("/curriculum-versions", { preHandler: perm("curriculum.manage") }, async (req, reply) => {
        const b = parse(c.academicCreateCurriculumVersionBodySchema, req.body);
        return reply.status(201).send(unwrapOrThrow(await curriculum.createCurriculumVersion(deps, ctxOf(req), b)));
      });
      scope.post("/curriculum-versions/:id/clone", { preHandler: perm("curriculum.manage") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicCloneCurriculumBodySchema, req.body);
        return reply.status(201).send(unwrapOrThrow(await curriculum.cloneCurriculumVersion(deps, ctxOf(req), { sourceVersionId: id, targetAcademicYearId: b.academicYearId, note: b.note })));
      });
      scope.post("/curriculum-versions/:id/nodes", { preHandler: perm("curriculum.manage") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return reply.status(201).send(unwrapOrThrow(await curriculum.addCurriculumNode(deps, ctxOf(req), id, parse(c.academicCreateNodeBodySchema, req.body))));
      });
      scope.get("/curriculum-nodes/:id", { preHandler: perm("curriculum.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await curriculum.getCurriculumNode(deps, ctxOf(req), id));
      });
      scope.patch("/curriculum-nodes/:id", { preHandler: perm("curriculum.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await curriculum.updateCurriculumNode(deps, ctxOf(req), id, parse(c.academicUpdateNodeBodySchema, req.body)));
      });
      scope.delete("/curriculum-nodes/:id", { preHandler: perm("curriculum.manage") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        unwrapOrThrow(await curriculum.removeCurriculumNode(deps, ctxOf(req), id));
        return reply.status(204).send();
      });
      scope.post("/curriculum-nodes/:id/move", { preHandler: perm("curriculum.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await curriculum.moveCurriculumNode(deps, ctxOf(req), id, parse(c.academicMoveNodeBodySchema, req.body)));
      });
      scope.put("/curriculum-nodes/:id/prerequisites", { preHandler: perm("curriculum.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicSetPrerequisitesBodySchema, req.body);
        return unwrapOrThrow(await curriculum.setNodePrerequisites(deps, ctxOf(req), id, b.requiredLineageIds));
      });
      scope.get("/curriculum-nodes/:id/prerequisite-status", { preHandler: anyOf("curriculum.read", "enrollment.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicEligibilityQuerySchema, req.query);
        if (!q.studentId) throw new ValidationError("Un apprenant est requis.", [{ path: ["studentId"], message: "Requis.", code: AcademicCode.INVALID_INPUT }], { code: AcademicCode.INVALID_INPUT });
        return unwrapOrThrow(await curriculum.getNodePrerequisiteStatus(deps, ctxOf(req), { studentId: q.studentId, nodeId: id }));
      });
      scope.get("/curriculum-versions/:id/validate", { preHandler: perm("curriculum.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await curriculum.validateCurriculumVersion(deps, ctxOf(req), id));
      });
      scope.post("/curriculum-versions/:id/publish", { preHandler: perm("curriculum.publish") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await curriculum.publishCurriculumVersion(deps, ctxOf(req), id));
      });
      scope.post("/curriculum-versions/:id/amend", { preHandler: perm("curriculum.amend") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await curriculum.amendPublishedCurriculum(deps, ctxOf(req), id, parse(c.academicAmendBodySchema, req.body)));
      });
      scope.get("/curriculum-versions/:id/amendments", { preHandler: perm("curriculum.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return { items: unwrapOrThrow(await curriculum.listCurriculumAmendments(deps, ctxOf(req), id)) };
      });

      // ===== Classes ===========================================================================================
      scope.get("/classrooms", { preHandler: perm("academic.classroom.read") }, async (req) => {
        const q = parse(c.academicListClassroomsQuerySchema, req.query);
        return unwrapOrThrow(await classrooms.listClassrooms(deps, ctxOf(req), q));
      });
      scope.get("/classrooms/:id", { preHandler: perm("academic.classroom.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await classrooms.getClassroom(deps, ctxOf(req), id));
      });
      scope.post("/classrooms", { preHandler: perm("academic.classroom.manage") }, async (req, reply) => {
        return reply.status(201).send(unwrapOrThrow(await classrooms.createClassroom(deps, ctxOf(req), parse(c.academicCreateClassroomBodySchema, req.body))));
      });
      scope.patch("/classrooms/:id", { preHandler: perm("academic.classroom.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await classrooms.updateClassroom(deps, ctxOf(req), id, parse(c.academicUpdateClassroomBodySchema, req.body)));
      });
      for (const action of Object.keys(CLASSROOM_ACTION_TARGETS) as ClassroomAction[]) {
        scope.post(`/classrooms/:id/${action}`, { preHandler: perm("academic.classroom.manage") }, async (req) => {
          const { id } = parse(c.academicIdParamsSchema, req.params);
          const b = parse(c.academicClassroomActionBodySchema, req.body);
          return unwrapOrThrow(await classrooms.classroomAction(deps, ctxOf(req), id, action, b.reason));
        });
      }
      scope.get("/classrooms/:id/roster", { preHandler: perm("enrollment.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicRosterQuerySchema, req.query);
        return unwrapOrThrow(await reads.getRoster(deps, ctxOf(req), id, { onDate: q.onDate ?? null, nodeId: q.nodeId ?? null }));
      });
      scope.get("/classrooms/:id/nodes", { preHandler: anyOf("curriculum.read", "enrollment.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicRuleContextQuerySchema, req.query);
        return { items: unwrapOrThrow(await reads.listNodesForClassroom(deps, ctxOf(req), id, { periodId: q.periodId ?? null })) };
      });
      scope.get("/classrooms/:id/periods/:periodId", { preHandler: perm("academic.classroom.read") }, async (req) => {
        const p = parse(c.academicClassroomPeriodParamsSchema, req.params);
        return unwrapOrThrow(await calendar.getEffectivePeriodState(deps, ctxOf(req), { classroomId: p.id, periodId: p.periodId }));
      });
      scope.post("/classrooms/:id/periods/:periodId/close-grading", { preHandler: perm("academic.period.close") }, async (req) => {
        const p = parse(c.academicClassroomPeriodParamsSchema, req.params);
        return unwrapOrThrow(await calendar.closeClassroomPeriodGrading(deps, ctxOf(req), p.id, p.periodId));
      });
      scope.post("/classrooms/:id/periods/:periodId/close", { preHandler: perm("academic.period.close") }, async (req) => {
        const p = parse(c.academicClassroomPeriodParamsSchema, req.params);
        return unwrapOrThrow(await calendar.closeClassroomPeriod(deps, ctxOf(req), p.id, p.periodId));
      });
      scope.post("/classrooms/:id/periods/:periodId/reopen", { preHandler: perm("academic.period.reopen") }, async (req) => {
        const p = parse(c.academicClassroomPeriodParamsSchema, req.params);
        const b = parse(c.academicReopenBodySchema, req.body);
        return unwrapOrThrow(await calendar.reopenClassroomPeriod(deps, ctxOf(req), p.id, p.periodId, b.reason));
      });

      // ===== Offres (inscription à la carte) ===================================================================
      scope.get("/classrooms/:id/offerings", { preHandler: withFeature("academic.classroom.read", "academic.a-la-carte") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicListOfferingsQuerySchema, req.query);
        return { items: unwrapOrThrow(await classrooms.listOfferings(deps, ctxOf(req), { classroomId: id, status: q.status ?? null })) };
      });
      scope.post("/classrooms/:id/offerings", { preHandler: withFeature("academic.classroom.manage", "academic.a-la-carte") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return reply.status(201).send(unwrapOrThrow(await classrooms.createOffering(deps, ctxOf(req), id, parse(c.academicCreateOfferingBodySchema, req.body))));
      });
      scope.post("/classrooms/:id/offerings/open-period", { preHandler: withFeature("academic.classroom.manage", "academic.a-la-carte") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const r = unwrapOrThrow(await classrooms.openOfferingsForPeriod(deps, ctxOf(req), id, parse(c.academicOpenPeriodOfferingsBodySchema, req.body)));
        return reply.status(201).send(r);
      });
      scope.get("/offerings/:id", { preHandler: withFeature("academic.classroom.read", "academic.a-la-carte") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await classrooms.getOffering(deps, ctxOf(req), id));
      });
      scope.patch("/offerings/:id", { preHandler: withFeature("academic.classroom.manage", "academic.a-la-carte") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await classrooms.updateOffering(deps, ctxOf(req), id, parse(c.academicUpdateOfferingBodySchema, req.body)));
      });
      for (const action of ["open", "start", "complete", "cancel"] as const) {
        scope.post(`/offerings/:id/${action}`, { preHandler: withFeature("academic.classroom.manage", "academic.a-la-carte") }, async (req) => {
          const { id } = parse(c.academicIdParamsSchema, req.params);
          const b = parse(c.academicOfferingActionBodySchema, req.body);
          return unwrapOrThrow(await classrooms.offeringAction(deps, ctxOf(req), id, action, b.reason));
        });
      }
      scope.post("/offerings/:id/reopen", { preHandler: withFeature("academic.classroom.manage", "academic.a-la-carte") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await classrooms.reopenOffering(deps, ctxOf(req), id, parse(c.academicReopenOfferingBodySchema, req.body)));
      });
      scope.post("/offerings/:id/enroll", { preHandler: withFeature("enrollment.self.create", "academic.a-la-carte") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        parse(c.academicSelfEnrollBodySchema, req.body);
        const r = unwrapOrThrow(await courses.selfEnrollToOffering(deps, ctxOf(req), { offeringId: id }));
        return reply.status(201).send(r);
      });
      scope.get("/offerings/:id/eligibility", { preHandler: withFeature("enrollment.read", "academic.a-la-carte") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicEligibilityQuerySchema, req.query);
        if (!q.studentId) throw new ValidationError("Un apprenant est requis.", [{ path: ["studentId"], message: "Requis.", code: AcademicCode.INVALID_INPUT }], { code: AcademicCode.INVALID_INPUT });
        return eligibilityDto(unwrapOrThrow(await courses.checkOfferingEligibility(deps, ctxOf(req), { offeringId: id, studentId: q.studentId })));
      });
      scope.get("/catalog", { preHandler: [anyOf("enrollment.read", "enrollment.self.read"), ...featureGuards("academic.a-la-carte")] }, async (req) => {
        const ctx = ctxOf(req);
        await featureEnabledOrThrow(ctx, "academic.a-la-carte");
        const q = parse(c.academicCatalogQuerySchema, req.query);
        // Un apprenant n'évalue que SON éligibilité : sans `enrollment.read`, `studentId` est celui de l'utilisateur.
        let studentId = q.studentId ?? null;
        if (matchedPermission.get(req) !== "enrollment.read") {
          const lookup = deps.ports.students.findStudentByUserId;
          const mine = ctx.userId && lookup ? await lookup.call(deps.ports.students, ctx, ctx.userId) : null;
          studentId = mine?.studentId ?? null;
        }
        return { items: unwrapOrThrow(await reads.getCatalog(deps, ctx, { institutionId: q.institutionId ?? null, programId: q.programId ?? null, studentId })) };
      });

      // ===== Inscriptions ======================================================================================
      scope.get("/enrollments", { preHandler: perm("enrollment.read") }, async (req) => {
        const q = parse(c.academicListEnrollmentsQuerySchema, req.query);
        return unwrapOrThrow(await enrollments.listEnrollments(deps, ctxOf(req), q));
      });
      scope.post("/enrollments", { preHandler: perm("enrollment.create") }, async (req, reply) => {
        const b = parse(c.academicEnrollStudentBodySchema, req.body);
        const ctx = ctxOf(req);
        if (b.fundingType === "STATE_ASSIGNED") await featureEnabledOrThrow(ctx, "academic.state-assigned");
        if (b.mode === "A_LA_CARTE") await featureEnabledOrThrow(ctx, "academic.a-la-carte");
        return reply.status(201).send(unwrapOrThrow(await enrollments.enrollStudent(deps, ctx, b)));
      });
      scope.post("/enrollments/bulk", { preHandler: perm("enrollment.create") }, async (req, reply) => {
        const b = parse(c.academicEnrollBulkBodySchema, req.body);
        const ctx = ctxOf(req);
        if (b.items.some((i) => i.fundingType === "STATE_ASSIGNED")) await featureEnabledOrThrow(ctx, "academic.state-assigned");
        if (b.items.some((i) => i.mode === "A_LA_CARTE")) await featureEnabledOrThrow(ctx, "academic.a-la-carte");
        return reply.status(201).send(unwrapOrThrow(await enrollments.enrollStudentsBulk(deps, ctx, b.items)));
      });
      scope.get("/enrollments/:id", { preHandler: perm("enrollment.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await enrollments.getEnrollmentDetail(deps, ctxOf(req), id));
      });
      scope.get("/enrollments/:id/history", { preHandler: perm("enrollment.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return { items: unwrapOrThrow(await enrollments.getEnrollmentHistory(deps, ctxOf(req), id)) };
      });
      scope.get("/enrollments/:id/nodes", { preHandler: perm("enrollment.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicRuleContextQuerySchema, req.query);
        return { items: unwrapOrThrow(await reads.listNodesForEnrollment(deps, ctxOf(req), id, { periodId: q.periodId ?? null })) };
      });
      scope.get("/enrollments/:id/rule-context", { preHandler: perm("enrollment.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicRuleContextQuerySchema, req.query);
        return unwrapOrThrow(await reads.getRuleContext(deps, ctxOf(req), { enrollmentId: id, periodId: q.periodId ?? null }));
      });
      scope.get("/enrollments/:id/registrations", { preHandler: perm("enrollment.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicRuleContextQuerySchema, req.query);
        return { items: unwrapOrThrow(await reads.listCourseRegistrations(deps, ctxOf(req), { enrollmentId: id, periodId: q.periodId ?? null })) };
      });
      for (const action of Object.keys(ENROLLMENT_ACTION_TARGETS) as EnrollmentAction[]) {
        const permission = action === "withdraw" || action === "cancel" ? "enrollment.cancel" : "enrollment.update";
        scope.post(`/enrollments/:id/${action}`, { preHandler: perm(permission) }, async (req) => {
          const { id } = parse(c.academicIdParamsSchema, req.params);
          const b = parse(c.academicEnrollmentActionBodySchema, req.body);
          return unwrapOrThrow(await enrollments.transitionEnrollment(deps, ctxOf(req), id, action, b.reason));
        });
      }
      // Annulation d'une inscription EN ATTENTE (spec 007 §16) : idempotente ; une inscription confirmée se retire (`/withdraw`).
      scope.post("/enrollments/:id/cancel-pending", { preHandler: perm("enrollment.cancel") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicEnrollmentActionBodySchema, req.body ?? {});
        return unwrapOrThrow(await enrollments.cancelEnrollment(deps, ctxOf(req), id, { reason: b.reason }));
      });
      scope.post("/enrollments/:id/transfer",{ preHandler: perm("enrollment.update") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await enrollments.transferEnrollment(deps, ctxOf(req), id, parse(c.academicTransferBodySchema, req.body)));
      });
      scope.patch("/enrollments/:id/funding", { preHandler: perm("enrollment.funding.update") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicChangeFundingBodySchema, req.body);
        const ctx = ctxOf(req);
        if (b.fundingType === "STATE_ASSIGNED") await featureEnabledOrThrow(ctx, "academic.state-assigned");
        return unwrapOrThrow(await enrollments.changeEnrollmentFunding(deps, ctx, id, b));
      });
      scope.post("/enrollments/:id/outcome", { preHandler: perm("enrollment.outcome.record") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await enrollments.recordEnrollmentOutcome(deps, ctxOf(req), id, parse(c.academicRecordOutcomeBodySchema, req.body)));
      });

      // ----- Sélections de cours ------------------------------------------------------------------------------
      scope.get("/enrollments/:id/courses", { preHandler: anyOf("enrollment.course.manage", "enrollment.read") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return { items: unwrapOrThrow(await courses.listEnrollmentCourses(deps, ctxOf(req), id)) };
      });
      scope.post("/enrollments/:id/courses", { preHandler: perm("enrollment.course.manage") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicAddCourseBodySchema, req.body);
        const ctx = ctxOf(req);
        if (b.source === "A_LA_CARTE" || (b.offeringId && !b.source)) await featureEnabledOrThrow(ctx, "academic.a-la-carte");
        if (b.override) await requireOverridePermission(req, reply);
        return reply.status(201).send(unwrapOrThrow(await courses.addEnrollmentCourse(deps, ctx, id, b)));
      });
      scope.post("/enrollment-courses/:id/confirm", { preHandler: perm("enrollment.course.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicCourseActionBodySchema, req.body);
        const r = unwrapOrThrow(await courses.confirmEnrollmentCourse(deps, ctxOf(req), id, b.reason));
        return { outcome: r.kind, course: r.course };
      });
      scope.post("/enrollment-courses/:id/cancel", { preHandler: perm("enrollment.course.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicCourseActionBodySchema, req.body);
        return unwrapOrThrow(await courses.cancelEnrollmentCourse(deps, ctxOf(req), id, b.reason ?? ""));
      });
      scope.post("/enrollment-courses/:id/complete", { preHandler: perm("enrollment.course.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const b = parse(c.academicCourseActionBodySchema, req.body);
        return unwrapOrThrow(await courses.completeEnrollmentCourse(deps, ctxOf(req), { enrollmentCourseId: id, completedAt: b.completedAt, outcomeRef: b.outcomeRef }));
      });
      scope.post("/course-registrations", { preHandler: perm("enrollment.course.manage") }, async (req, reply) => {
        const b = parse(c.academicRegisterCourseBodySchema, req.body);
        return reply.status(201).send(unwrapOrThrow(await courses.registerCourse(deps, ctxOf(req), b)));
      });

      // ----- Portails ----------------------------------------------------------------------------------------
      scope.get("/me/enrollments", { preHandler: perm("enrollment.self.read") }, async (req) => ({ items: unwrapOrThrow(await reads.listMyEnrollments(deps, ctxOf(req))) }));
      scope.get("/children/:studentId/enrollments", { preHandler: perm("enrollment.child.read") }, async (req) => {
        const { studentId } = parse(c.academicChildParamsSchema, req.params);
        return { items: unwrapOrThrow(await reads.listChildEnrollments(deps, ctxOf(req), studentId)) };
      });

      // Libellés (classes, périodes, matières) des inscriptions de l'élève / de l'enfant : nomme les identifiants des notes,
      // résultats, présences et séances côté portail. Mêmes permissions et même contrôle de tutelle que les inscriptions.
      scope.get("/me/labels", { preHandler: perm("enrollment.self.read") }, async (req) => unwrapOrThrow(await reads.getMyLabels(deps, ctxOf(req))));
      scope.get("/children/:studentId/labels", { preHandler: perm("enrollment.child.read") }, async (req) => {
        const { studentId } = parse(c.academicChildParamsSchema, req.params);
        return unwrapOrThrow(await reads.getChildLabels(deps, ctxOf(req), studentId));
      });

      // ===== Reconduction annuelle ============================================================================
      scope.get("/years/:id/rollover/preview", { preHandler: withFeature("academic.year.rollover", "academic.rollover") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicRolloverPreviewQuerySchema, req.query);
        return unwrapOrThrow(await rollover.previewRollover(deps, ctxOf(req), id, { toAcademicYearId: q.toAcademicYearId, createMissingClassrooms: q.createMissingClassrooms ?? true }));
      });
      scope.post("/years/:id/rollover", { preHandler: withFeature("academic.year.rollover", "academic.rollover") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await rollover.rolloverAcademicYear(deps, ctxOf(req), id, parse(c.academicRolloverBodySchema, req.body)));
      });

      // ----- Assistant de reconduction : aperçu complet, exécution en tâche de fond (worker), progression, rapport -----
      const offeringsEnabled = async (ctx: RequestContext): Promise<boolean> => (options.isFeatureEnabled ? options.isFeatureEnabled(ctx, "academic.a-la-carte") : true);
      scope.get("/years/:id/rollover/plan", { preHandler: withFeature("academic.year.rollover", "academic.rollover") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const q = parse(c.academicRolloverPlanQuerySchema, req.query);
        const ctx = ctxOf(req);
        return unwrapOrThrow(await rolloverRun.previewRolloverPlan(deps, ctx, id, q, { offeringsEnabled: await offeringsEnabled(ctx) }));
      });
      scope.post("/years/:id/rollover/runs", { preHandler: withFeature("academic.year.rollover", "academic.rollover") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        const body = parse(c.academicRolloverRunBodySchema, req.body);
        const ctx = ctxOf(req);
        const r = unwrapOrThrow(await rolloverRun.startRolloverRun(deps, ctx, id, body, { offeringsEnabled: await offeringsEnabled(ctx) }));
        return reply.status(r.created ? 202 : 200).send(r.run);
      });
      scope.get("/years/:id/rollover/runs", { preHandler: withFeature("academic.year.rollover", "academic.rollover") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return { items: unwrapOrThrow(await rolloverRun.listRolloverRuns(deps, ctxOf(req), id)) };
      });
      scope.get("/rollover/runs/:id", { preHandler: withFeature("academic.year.rollover", "academic.rollover") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await rolloverRun.getRolloverRun(deps, ctxOf(req), id));
      });
      scope.post("/rollover/runs/:id/retry", { preHandler: withFeature("academic.year.rollover", "academic.rollover") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return reply.status(202).send(unwrapOrThrow(await rolloverRun.retryRolloverRun(deps, ctxOf(req), id)));
      });

      // ===== Calendrier de l'établissement (jours fériés, vacances, fermetures) ===================================
      scope.get("/holidays", { preHandler: perm("academic.read") }, async (req) => {
        const q = parse(c.academicListHolidaysQuerySchema, req.query);
        return { items: unwrapOrThrow(await holidays.listHolidays(deps, ctxOf(req), q)) };
      });
      scope.post("/holidays", { preHandler: perm("academic.settings.manage") }, async (req, reply) => {
        return reply.status(201).send(unwrapOrThrow(await holidays.createHoliday(deps, ctxOf(req), parse(c.academicCreateHolidayBodySchema, req.body))));
      });
      scope.patch("/holidays/:id", { preHandler: perm("academic.settings.manage") }, async (req) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        return unwrapOrThrow(await holidays.updateHoliday(deps, ctxOf(req), id, parse(c.academicUpdateHolidayBodySchema, req.body)));
      });
      scope.delete("/holidays/:id", { preHandler: perm("academic.settings.manage") }, async (req, reply) => {
        const { id } = parse(c.academicIdParamsSchema, req.params);
        unwrapOrThrow(await holidays.deleteHoliday(deps, ctxOf(req), id));
        return reply.status(204).send();
      });
    },
    { prefix: "" },
  );
}

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports d'academic (posé par `setup`, renseigné par `registerAcademicPorts`). */
    academicPorts: AcademicPortRegistry;
  }
}

/** Décore la RACINE avec le registre de ports (visible des adaptateurs de plateforme, quel que soit l'ordre de chargement). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("academicPorts")) app.decorate("academicPorts", createAcademicPortRegistry());
}

/** À appeler par la plateforme (adaptateurs) : `students`, `guardianship`, `readiness`, `schedule`, `registrationFee`, `invoiceFacts`… */
export function registerAcademicPorts(app: FastifyInstance, ports: Partial<AcademicPorts>): void {
  if (!app.hasDecorator("academicPorts")) app.decorate("academicPorts", createAcademicPortRegistry());
  app.academicPorts.register(ports);
}

/**
 * Contrat d'assemblage uniforme (`platform/runtime.ts`) : `(app, runtime)`, routes sans préfixe (le registre applique
 * `/api/v1/academic`). Les ports vers people / finance / scheduling / assess ne sont pas branchés ici : ils gardent
 * leur repli sûr jusqu'au câblage des modules concernés (voir README).
 */
export default async function academicModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("academicPorts")) app.decorate("academicPorts", createAcademicPortRegistry());
  const deps = createAcademicDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    logger: runtime.logger,
    audit: academicAuditAdapter(runtime.auditPort),
    ports: { institutions: createTenancyInstitutionDirectory({ db: runtime.tenantDb, clock: runtime.clock }) },
    portsProvider: () => app.academicPorts.current,
  });
  await academicPlugin(app, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    isFeatureEnabled: (ctx, featureKey) => runtime.entitlements.isFeatureEnabled(ctx, featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
  });
}
