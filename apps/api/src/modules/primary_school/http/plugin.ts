/**
 * Plugin Fastify du module primary_school — routes SANS préfixe (le registre applique `/api/v1/primary_school`, voir
 * `docs/architecture/platform-assembly.md`). Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la RACINE avec
 * le registre de ports (`app.primarySchoolPorts`) que les adaptateurs de plateforme renseignent.
 *
 *  - Authentification : `request.ctx` posé en amont (iam v2 / legacy dérivé). Aucune identité lue d'un en-tête client.
 *  - Autorisation : `requirePermission('primary.…')` du module rbac, jamais un rôle codé en dur ; les permissions SENSIBLES
 *    (révision, scellement, réémission, gel, modèle de pack) exigent la MFA (garde rbac). Le LIEN (classe affectée, tuteur lié)
 *    est vérifié par les cas d'usage : 404 hors périmètre.
 *  - Limiteur de débit : `runtime.rateLimiter` par utilisateur sur la saisie en lot : 429 + Retry-After.
 *  - Aucun `GET` n'écrit. Réponses `Cache-Control: no-store` (données d'enfants).
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `primary_school.*`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, z, type ZodTypeAny } from "zod";
import { ForbiddenError, UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  primaryApplyTemplateBodySchema,
  primaryArchiveListQuerySchema,
  primaryBulkRecordBodySchema,
  primaryCreateFrameworkBodySchema,
  primaryCreatePhraseBodySchema,
  primaryCreateScaleBodySchema,
  primaryDecideCaseBodySchema,
  primaryFrameworkListQuerySchema,
  primaryPhraseListQuerySchema,
  primaryPrepareArchiveBodySchema,
  primaryPrepareCouncilBodySchema,
  primaryPrepareReviewsBodySchema,
  primaryPutAttendanceBodySchema,
  primaryPutLevelsBodySchema,
  primaryReissueBodySchema,
  primaryReportKeySchema,
  primaryReportQuerySchema,
  primaryReviewListQuerySchema,
  primaryReviseBodySchema,
  primarySettingsQuerySchema,
  primarySheetQuerySchema,
  primaryStructureBodySchema,
  primarySummaryQuerySchema,
  primaryUpdateCaseBodySchema,
  primaryUpdatePhraseBodySchema,
  primaryUpdateScaleBodySchema,
  primaryUpdateSettingsBodySchema,
  primaryUuidSchema,
  primaryValidateBodySchema,
  primaryCouncilListQuerySchema,
} from "@ecoledigitale/contracts/src/v2/primary_school";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { freezeYearArchive, getYearArchive, listYearArchives, prepareYearArchive } from "../application/archives";
import { bulkRecordCompetencies, getCompetencySheet, getCompetencySummary, getFamilyCompetencySummary, listAssessmentRevisions, listMyClassrooms, reviseCompetencyAssessment, validateCompetencies } from "../application/competencies";
import { decideCouncilCase, getCouncil, listCouncils, prepareCouncil, putCouncilAttendance, requestCouncilMinutes, updateCouncilCase } from "../application/council";
import { createPrimarySchoolDeps, type PrimarySchoolDeps } from "../application/deps";
import { createFramework, createScale, deleteDraftFrameworkUseCase, getFrameworkDetail, listFrameworks, listScales, newFrameworkVersion, publishFramework, putLevels, putStructure, updateScale } from "../application/frameworks";
import { createPhrase, listPhrases, updatePhrase } from "../application/phrases";
import { createPrimarySchoolPortRegistry, type PrimarySchoolPortRegistry } from "../application/port-registry";
import type { PrimarySchoolPorts } from "../application/ports";
import { buildReport, getProgress, getRuleBanner, reportToCsv } from "../application/reports";
import { getAnnualReview, listAnnualReviews, listFamilyAnnualReviews, prepareAnnualReviews, reissueAnnualReview, sealAnnualReview } from "../application/reviews";
import { getSettings, updateSettings } from "../application/settings";
import { instantiatePrimaryReferenceData } from "../application/template";
import type { CallerCaps } from "../domain/types";
import { primarySchoolAuditAdapter } from "../infrastructure/audit-adapter";
import { ALL_CAPS, createPermissionKit, PERMISSIONS as P, type PermissionKit } from "./guards";
import { archiveDto, assessmentDto, councilDto, frameworkDetailDto, frameworkDto, phraseDto, reviewDto, revisionDto, scaleDto, settingsDto, sheetDto, caseDto } from "./presenters";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par les adaptateurs de plateforme)
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module primary_school (posé par `setup`). */
    primarySchoolPorts: PrimarySchoolPortRegistry;
  }
}

/** À appeler par `platform/adapters` (`wireApiPorts`) : enregistre (ou remplace) des ports ; relus à chaque appel. */
export function registerPrimarySchoolPorts(app: FastifyInstance, ports: Partial<PrimarySchoolPorts>): void {
  if (!app.hasDecorator("primarySchoolPorts")) app.decorate("primarySchoolPorts", createPrimarySchoolPortRegistry());
  app.primarySchoolPorts.register(ports);
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

const idParam = (params: unknown, name = "id"): string => parse(primaryUuidSchema, (params as Record<string, unknown> | undefined)?.[name]);

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** Erreur Fastify (schéma, JSON invalide, corps trop gros) -> `ValidationError` ; sinon inchangée. */
function maybeFastifyValidation(error: unknown): unknown {
  const e = error as { statusCode?: number; code?: string; message?: string } | null;
  if (e && typeof e === "object" && typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500 && typeof e.code === "string" && e.code.startsWith("FST_")) {
    return new ValidationError("Requête invalide.", [{ path: [], message: e.message ?? "Requête invalide.", code: e.code }]);
  }
  return error;
}

class RateLimitedError extends ForbiddenError {
  constructor(readonly retryAfterSec: number) {
    super("Trop de requêtes : réessayez dans un instant.", { code: "primary_school.rate_limited", details: { retryAfterSec } });
  }
}

export interface RateLimiterLike {
  hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

export interface PrimarySchoolPluginOptions {
  deps: PrimarySchoolDeps;
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  rateLimiter?: RateLimiterLike;
}

const HTTP_RATE = Object.freeze({ bulk: { limit: 60, windowMs: 60_000 } });

const noStore = (reply: FastifyReply): void => {
  void reply.header("Cache-Control", "no-store");
};

export async function primarySchoolPlugin(app: FastifyInstance, options: PrimarySchoolPluginOptions): Promise<void> {
  const { deps } = options;
  const kit: PermissionKit = createPermissionKit(options.requirePermission);
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "primary_school : erreur inattendue");
    noStore(reply);
    if (appError instanceof RateLimitedError) {
      void reply.header("Retry-After", String(appError.retryAfterSec));
      void reply.status(429).send({ ...toErrorBody(appError, String(request.id)), status: 429 });
      return;
    }
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    scope.addHook("onSend", async (_request, reply, payload) => {
      if (!reply.hasHeader("Cache-Control")) noStore(reply);
      return payload;
    });
    const caps = (req: FastifyRequest, reply: FastifyReply, keys: ReadonlyArray<keyof CallerCaps> = ALL_CAPS): Promise<CallerCaps> => kit.capsFor(scope, req, reply, keys);
    const throttle = (kind: keyof typeof HTTP_RATE): preHandlerAsyncHookHandler =>
      async function throttleGuard(this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
        if (!options.rateLimiter) return;
        const ctx = ctxOf(request);
        const d = await options.rateLimiter.hit(`primary_school:${kind}:${ctx.tenantId}:${ctx.userId ?? request.ip}`, HTTP_RATE[kind]);
        if (!d.allowed) {
          const retry = Math.max(1, Math.ceil(d.retryAfterMs / 1000));
          void reply.header("Retry-After", String(retry));
          throw new RateLimitedError(retry);
        }
      };
    const STAFF_READ = kit.anyOf(P.competencyRead, P.competencyRecord, P.councilRead, P.councilPrepare, P.bilanRead, P.classReadAll);

    // ===== Paramètres et modèle de pack ======================================================================
    scope.get("/settings", { preHandler: kit.require(P.settingsManage) }, async (req) => settingsDto(unwrap(await getSettings(deps, ctxOf(req), parse(primarySettingsQuerySchema, req.query)))));
    scope.put("/settings", { preHandler: kit.require(P.settingsManage) }, async (req) => settingsDto(unwrap(await updateSettings(deps, ctxOf(req), parse(primaryUpdateSettingsBodySchema, req.body)))));
    scope.post("/template/apply", { preHandler: kit.require(P.templateApply) }, async (req) => unwrap(await instantiatePrimaryReferenceData(deps, ctxOf(req), parse(primaryApplyTemplateBodySchema, req.body))));

    // ===== Échelles d'appréciation ===========================================================================
    scope.get("/rating-scales", { preHandler: kit.anyOf(P.scaleManage, P.frameworkRead, P.competencyRead, P.competencyRecord) }, async (req) => ({ items: unwrap(await listScales(deps, ctxOf(req))).map(scaleDto) }));
    scope.post("/rating-scales", { preHandler: kit.require(P.scaleManage) }, async (req, reply) => reply.status(201).send(scaleDto(unwrap(await createScale(deps, ctxOf(req), parse(primaryCreateScaleBodySchema, req.body))))));
    scope.patch("/rating-scales/:id", { preHandler: kit.require(P.scaleManage) }, async (req) => scaleDto(unwrap(await updateScale(deps, ctxOf(req), idParam(req.params), parse(primaryUpdateScaleBodySchema, req.body)))));
    scope.put("/rating-scales/:id/levels", { preHandler: kit.require(P.scaleManage) }, async (req) => scaleDto(unwrap(await putLevels(deps, ctxOf(req), idParam(req.params), parse(primaryPutLevelsBodySchema, req.body).levels))));

    // ===== Référentiels de compétences =======================================================================
    scope.get("/frameworks", { preHandler: kit.anyOf(P.frameworkRead, P.frameworkManage, P.competencyRead, P.competencyRecord) }, async (req) => ({ items: unwrap(await listFrameworks(deps, ctxOf(req), parse(primaryFrameworkListQuerySchema, req.query))).map(frameworkDto) }));
    scope.post("/frameworks", { preHandler: kit.require(P.frameworkManage) }, async (req, reply) => reply.status(201).send(frameworkDetailDto(unwrap(await createFramework(deps, ctxOf(req), parse(primaryCreateFrameworkBodySchema, req.body))))));
    scope.get("/frameworks/:id", { preHandler: kit.anyOf(P.frameworkRead, P.frameworkManage, P.competencyRead, P.competencyRecord) }, async (req) => frameworkDetailDto(unwrap(await getFrameworkDetail(deps, ctxOf(req), idParam(req.params)))));
    scope.put("/frameworks/:id/structure", { preHandler: kit.require(P.frameworkManage) }, async (req) => frameworkDetailDto(unwrap(await putStructure(deps, ctxOf(req), idParam(req.params), parse(primaryStructureBodySchema, req.body)))));
    scope.delete("/frameworks/:id", { preHandler: kit.require(P.frameworkManage) }, async (req, reply) => {
      unwrap(await deleteDraftFrameworkUseCase(deps, ctxOf(req), idParam(req.params)));
      return reply.status(204).send();
    });
    scope.post("/frameworks/:id/publish", { preHandler: kit.require(P.frameworkPublish) }, async (req) => frameworkDetailDto(unwrap(await publishFramework(deps, ctxOf(req), idParam(req.params)))));
    scope.post("/frameworks/:id/new-version", { preHandler: kit.require(P.frameworkPublish) }, async (req, reply) => reply.status(201).send(frameworkDetailDto(unwrap(await newFrameworkVersion(deps, ctxOf(req), idParam(req.params))))));

    // ===== Mes classes, grille et saisie des compétences =====================================================
    scope.get("/my-classrooms", { preHandler: STAFF_READ }, async (req, reply) => ({ items: unwrap(await listMyClassrooms(deps, ctxOf(req), await caps(req, reply))) }));
    scope.get("/rule-banner", { preHandler: STAFF_READ }, async (req, reply) => {
      const q = parse(z.object({ classroomId: primaryUuidSchema.optional() }), req.query);
      return unwrap(await getRuleBanner(deps, ctxOf(req), q, await caps(req, reply)));
    });
    scope.get("/classrooms/:id/competency-sheet", { preHandler: kit.anyOf(P.competencyRead, P.competencyRecord) }, async (req, reply) => {
      const q = parse(primarySheetQuerySchema, req.query);
      return sheetDto(unwrap(await getCompetencySheet(deps, ctxOf(req), { classroomId: idParam(req.params), periodId: q.periodId, frameworkId: q.frameworkId }, await caps(req, reply))));
    });
    scope.put("/competency-assessments/bulk", { preHandler: [kit.require(P.competencyRecord), throttle("bulk")] }, async (req, reply) => {
      const r = unwrap(await bulkRecordCompetencies(deps, ctxOf(req), parse(primaryBulkRecordBodySchema, req.body), await caps(req, reply)));
      return { created: r.created, updated: r.updated, unchanged: r.unchanged, assessments: r.assessments.map(assessmentDto) };
    });
    scope.post("/classrooms/:id/periods/:pid/competencies/validate", { preHandler: kit.require(P.competencyValidate) }, async (req, reply) => {
      const body = parse(primaryValidateBodySchema, req.body);
      return unwrap(await validateCompetencies(deps, ctxOf(req), { classroomId: idParam(req.params), periodId: idParam(req.params, "pid"), frameworkId: body.frameworkId }, await caps(req, reply)));
    });
    scope.post("/competency-assessments/:id/revisions", { preHandler: kit.require(P.competencyRevise) }, async (req, reply) => {
      const r = unwrap(await reviseCompetencyAssessment(deps, ctxOf(req), idParam(req.params), parse(primaryReviseBodySchema, req.body), await caps(req, reply)));
      return reply.status(201).send({ assessment: assessmentDto(r.assessment), revision: revisionDto(r.revision) });
    });
    scope.get("/competency-assessments/:id/revisions", { preHandler: kit.anyOf(P.competencyRead, P.competencyRevise) }, async (req, reply) => ({
      items: unwrap(await listAssessmentRevisions(deps, ctxOf(req), idParam(req.params), await caps(req, reply))).map(revisionDto),
    }));
    scope.get("/enrollments/:id/competency-summary", { preHandler: kit.anyOf(P.competencyRead, P.competencyChildRead, P.competencySelfRead) }, async (req, reply) => {
      const q = parse(primarySummaryQuerySchema, req.query);
      const enrollmentId = idParam(req.params);
      // Personnel : lignes validées de la classe ; famille : périodes dont le bulletin est publié seulement.
      if (await kit.has(scope, req, reply, P.competencyRead)) return unwrap(await getCompetencySummary(deps, ctxOf(req), { enrollmentId, periodIds: q.periodIds }, await caps(req, reply)));
      return unwrap(await getFamilyCompetencySummary(deps, ctxOf(req), { studentId: null, enrollmentId, periodIds: q.periodIds }));
    });
    scope.get("/children/:studentId/enrollments/:id/competency-summary", { preHandler: kit.require(P.competencyChildRead) }, async (req) => {
      const q = parse(primarySummaryQuerySchema, req.query);
      return unwrap(await getFamilyCompetencySummary(deps, ctxOf(req), { studentId: idParam(req.params, "studentId"), enrollmentId: idParam(req.params), periodIds: q.periodIds }));
    });

    // ===== Banque d'appréciations ============================================================================
    scope.get("/phrases", { preHandler: kit.anyOf(P.phraseRead, P.phraseManage) }, async (req) => ({ items: unwrap(await listPhrases(deps, ctxOf(req), parse(primaryPhraseListQuerySchema, req.query))).map(phraseDto) }));
    scope.post("/phrases", { preHandler: kit.require(P.phraseManage) }, async (req, reply) => reply.status(201).send(phraseDto(unwrap(await createPhrase(deps, ctxOf(req), parse(primaryCreatePhraseBodySchema, req.body))))));
    scope.patch("/phrases/:id", { preHandler: kit.require(P.phraseManage) }, async (req) => phraseDto(unwrap(await updatePhrase(deps, ctxOf(req), idParam(req.params), parse(primaryUpdatePhraseBodySchema, req.body)))));

    // ===== Conseil des maîtres ===============================================================================
    scope.get("/councils", { preHandler: kit.anyOf(P.councilRead, P.councilPrepare, P.councilManage) }, async (req, reply) => ({
      items: unwrap(await listCouncils(deps, ctxOf(req), parse(primaryCouncilListQuerySchema, req.query), await caps(req, reply))),
    }));
    scope.post("/councils/prepare", { preHandler: kit.anyOf(P.councilPrepare, P.councilManage) }, async (req, reply) =>
      reply.status(201).send(councilDto(unwrap(await prepareCouncil(deps, ctxOf(req), parse(primaryPrepareCouncilBodySchema, req.body), await caps(req, reply))))),
    );
    scope.get("/councils/:deliberationId", { preHandler: kit.anyOf(P.councilRead, P.councilPrepare, P.councilManage) }, async (req, reply) =>
      councilDto(unwrap(await getCouncil(deps, ctxOf(req), idParam(req.params, "deliberationId"), await caps(req, reply)))),
    );
    scope.get("/councils/:deliberationId/cases", { preHandler: kit.anyOf(P.councilRead, P.councilPrepare, P.councilManage) }, async (req, reply) => ({
      items: councilDto(unwrap(await getCouncil(deps, ctxOf(req), idParam(req.params, "deliberationId"), await caps(req, reply)))).cases,
    }));
    scope.patch("/councils/:deliberationId/cases/:caseId", { preHandler: kit.anyOf(P.councilPrepare, P.councilManage) }, async (req, reply) => {
      const c = unwrap(await updateCouncilCase(deps, ctxOf(req), idParam(req.params, "caseId"), parse(primaryUpdateCaseBodySchema, req.body), await caps(req, reply)));
      return { id: c.id, status: c.status, proposalCode: c.proposalCode, proposalNote: c.proposalNote, discussionNote: c.discussionNote, reasonCodes: c.reasonCodes };
    });
    scope.post("/councils/:deliberationId/cases/:caseId/decide", { preHandler: kit.require(P.councilManage) }, async (req, reply) => {
      const r = unwrap(await decideCouncilCase(deps, ctxOf(req), idParam(req.params, "caseId"), parse(primaryDecideCaseBodySchema, req.body), await caps(req, reply)));
      return { caseId: r.case.id, status: r.case.status, decisionId: r.decisionId, finalCode: r.finalCode, ruleProposalCode: r.ruleProposalCode, changedFromProposal: r.changedFromProposal, outcomeRecorded: r.outcomeRecorded };
    });
    scope.put("/councils/:deliberationId/attendance", { preHandler: kit.require(P.councilManage) }, async (req, reply) =>
      councilDto(unwrap(await putCouncilAttendance(deps, ctxOf(req), idParam(req.params, "deliberationId"), parse(primaryPutAttendanceBodySchema, req.body), await caps(req, reply)))),
    );
    scope.post("/councils/:deliberationId/minutes", { preHandler: kit.require(P.councilManage) }, async (req, reply) => {
      const body = parse(z.object({ heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(), req.body);
      return reply.status(201).send(unwrap(await requestCouncilMinutes(deps, ctxOf(req), idParam(req.params, "deliberationId"), body, await caps(req, reply))));
    });

    // ===== Bilan annuel ======================================================================================
    scope.post("/annual-reviews/prepare", { preHandler: kit.require(P.bilanPrepare) }, async (req, reply) => {
      const r = unwrap(await prepareAnnualReviews(deps, ctxOf(req), parse(primaryPrepareReviewsBodySchema, req.body), await caps(req, reply)));
      return { created: r.created, refreshed: r.refreshed, skippedSealed: r.skippedSealed, reviews: r.reviews.map(reviewDto) };
    });
    scope.get("/annual-reviews", { preHandler: kit.anyOf(P.bilanRead, P.bilanPrepare) }, async (req, reply) => {
      const q = parse(primaryReviewListQuerySchema, req.query);
      return { items: unwrap(await listAnnualReviews(deps, ctxOf(req), q, await caps(req, reply))).map(reviewDto) };
    });
    scope.get("/annual-reviews/:id", { preHandler: kit.anyOf(P.bilanRead, P.bilanPrepare) }, async (req, reply) => reviewDto(unwrap(await getAnnualReview(deps, ctxOf(req), idParam(req.params), await caps(req, reply)))));
    scope.post("/annual-reviews/:id/seal", { preHandler: kit.require(P.bilanSeal) }, async (req, reply) => reviewDto(unwrap(await sealAnnualReview(deps, ctxOf(req), idParam(req.params), await caps(req, reply)))));
    scope.post("/annual-reviews/:id/reissue", { preHandler: kit.require(P.bilanReissue) }, async (req, reply) =>
      reply.status(201).send(reviewDto(unwrap(await reissueAnnualReview(deps, ctxOf(req), idParam(req.params), parse(primaryReissueBodySchema, req.body), await caps(req, reply))))),
    );
    scope.get("/me/annual-reviews", { preHandler: kit.require(P.bilanSelfRead) }, async (req) => ({ items: unwrap(await listFamilyAnnualReviews(deps, ctxOf(req), null)).map(reviewDto) }));
    scope.get("/children/:studentId/annual-reviews", { preHandler: kit.require(P.bilanChildRead) }, async (req) => ({
      items: unwrap(await listFamilyAnnualReviews(deps, ctxOf(req), idParam(req.params, "studentId"))).map(reviewDto),
    }));

    // ===== Archives d'année ==================================================================================
    scope.post("/year-archives/prepare", { preHandler: kit.require(P.archivePrepare) }, async (req) => archiveDto(unwrap(await prepareYearArchive(deps, ctxOf(req), parse(primaryPrepareArchiveBodySchema, req.body)))));
    scope.get("/year-archives", { preHandler: kit.anyOf(P.archivePrepare, P.archiveFreeze, P.bilanRead) }, async (req) => ({ items: unwrap(await listYearArchives(deps, ctxOf(req), parse(primaryArchiveListQuerySchema, req.query))).map((a) => archiveDto(a)) }));
    scope.get("/year-archives/:id", { preHandler: kit.anyOf(P.archivePrepare, P.archiveFreeze, P.bilanRead) }, async (req) => archiveDto(unwrap(await getYearArchive(deps, ctxOf(req), idParam(req.params)))));
    scope.post("/year-archives/:id/freeze", { preHandler: kit.require(P.archiveFreeze) }, async (req) => archiveDto(unwrap(await freezeYearArchive(deps, ctxOf(req), idParam(req.params)))));

    // ===== Rapports ==========================================================================================
    scope.get("/progress", { preHandler: kit.require(P.reportRead) }, async (req, reply) => {
      const q = parse(z.object({ yearId: primaryUuidSchema.optional() }), req.query);
      return { items: unwrap(await getProgress(deps, ctxOf(req), q, await caps(req, reply))) };
    });
    scope.get("/reports/:key", { preHandler: kit.require(P.reportRead) }, async (req, reply) => {
      const key = parse(primaryReportKeySchema, (req.params as { key?: unknown }).key);
      const q = parse(primaryReportQuerySchema, req.query);
      const report = unwrap(await buildReport(deps, ctxOf(req), key, q, await caps(req, reply)));
      if (q.format === "csv") {
        void reply.header("Content-Type", "text/csv; charset=utf-8");
        void reply.header("Content-Disposition", `attachment; filename="${key}.csv"`);
        return reply.send(reportToCsv(report));
      }
      return report;
    });
  });
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

/** Instance RACINE : pose le registre de ports que les adaptateurs de plateforme renseignent (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("primarySchoolPorts")) app.decorate("primarySchoolPorts", createPrimarySchoolPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/primary_school`). */
export default async function primarySchoolModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("primarySchoolPorts")) app.decorate("primarySchoolPorts", createPrimarySchoolPortRegistry());
  const deps = createPrimarySchoolDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: primarySchoolAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => app.primarySchoolPorts.current,
  });
  await app.register(primarySchoolPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: runtime.rateLimiter as unknown as RateLimiterLike,
  });
}

export { caseDto };
