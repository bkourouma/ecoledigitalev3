/**
 * Plugin Fastify du module examinations — routes SANS préfixe (le registre applique `/api/v1/examinations`, voir
 * `docs/architecture/platform-assembly.md`). Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la RACINE
 * avec le registre de ports (`app.examinationsPorts`) que les adaptateurs de plateforme renseignent.
 *
 *  - Authentification : `request.ctx` posé en amont (iam v2 / legacy dérivé). Aucune identité lue d'un en-tête ou d'un corps.
 *  - Autorisation : `requirePermission('exam.…')` du module rbac, jamais un rôle codé en dur ; les permissions SENSIBLES
 *    (publication, application d'un import, révision, dérogation) exigent la MFA (garde rbac). L'approbateur d'une révision est
 *    TOUJOURS l'utilisateur authentifié.
 *  - Features : `examinations.core` partout ; `.mock` pour les examens blancs ; `.exports` pour les exports.
 *  - Portée : une ressource d'un autre tenant, ou hors du périmètre d'un parent, répond 404 (RLS ; lien de tutelle relu à chaque requête).
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `examinations.*`.
 *  - Limiteur de débit (`runtime.rateLimiter`) sur la saisie en lot, les imports et les exports.
 *  - Réponses `Cache-Control: no-store` (données d'enfants).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, z, type ZodTypeAny } from "zod";
import { ForbiddenError, UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  examAnonymizeBodySchema,
  examAssignBodySchema,
  examAutoAssignBodySchema,
  examBulkResultsBodySchema,
  examBulkScoresBodySchema,
  examCandidateListQuerySchema,
  examCreateCandidateBodySchema,
  examCreateCenterBodySchema,
  examCreateExternalCandidateBodySchema,
  examCreateExportFormatBodySchema,
  examCreateImportBodySchema,
  examCreateImportFormatBodySchema,
  examCreatePaperBodySchema,
  examCreateRequirementBodySchema,
  examCreateRoomBodySchema,
  examCreateSessionBodySchema,
  examCreateTrackBodySchema,
  examCreateTypeBodySchema,
  examEligibilityBodySchema,
  examExternalBatchBodySchema,
  examRefundDoneBodySchema,
  examSetFeeItemsBodySchema,
  examFromClassroomBodySchema,
  examIdentifierBodySchema,
  examImportRowsQuerySchema,
  examInstantiatePackBodySchema,
  examIssueBatchBodySchema,
  examIssueDocumentBodySchema,
  examIssuedDocumentListQuerySchema,
  examMockLinkBodySchema,
  examPieceActionBodySchema,
  examRegisterBatchBodySchema,
  examRejectRevisionBodySchema,
  examResultListQuerySchema,
  examResultRevisionBodySchema,
  examRevisionListQuerySchema,
  examRevokeDocumentBodySchema,
  examRunExportBodySchema,
  examScoreRevisionBodySchema,
  examSessionCentersBodySchema,
  examSessionListQuerySchema,
  examStatisticsQuerySchema,
  examTransitionBodySchema,
  examUpdateCandidateBodySchema,
  examUpdateCenterBodySchema,
  examUpdateExportFormatBodySchema,
  examUpdateExternalCandidateBodySchema,
  examUpdateImportFormatBodySchema,
  examUpdatePaperBodySchema,
  examUpdateRequirementBodySchema,
  examUpdateRoomBodySchema,
  examUpdateSessionBodySchema,
  examUpdateTrackBodySchema,
  examUpdateTypeBodySchema,
  examUuidSchema,
  examWithdrawBodySchema,
} from "@ecoledigitale/contracts/src/v2/examinations";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { actOnPiece, listPieces } from "../application/pieces";
import { autoAssign, assignCandidate, getAssignmentsOverview, setSessionCenters, unassignCandidate } from "../application/assignments";
import { confirmRefund, getCandidateFee, listFeeCatalog, listFeeItems, setFeeItems, syncCandidateFee, syncSessionFees } from "../application/fees";
import { anonymizeExternalCandidate, createExternalBatch, createExternalCandidate, getExternalProfile, updateExternalCandidate } from "../application/external-candidates";
import { createCandidate, createFromClassroom, getCandidateDetail, listCandidates, registerBatch, registerCandidate, setIdentifier, updateCandidateTrack, withdrawCandidate } from "../application/candidates";
import { createExaminationsDeps, type ExaminationsDeps } from "../application/deps";
import { evaluateAll, evaluateEligibility } from "../application/eligibility";
import { createExportFormat, createImportFormat, getExportFormat, getImportFormat, listExportFormats, listImportFormats, newExportFormatVersion, publishExportFormat, publishImportFormat, updateExportFormat, updateImportFormat } from "../application/formats";
import { applyImport, createImport, getBatch, listBatches, validateImport } from "../application/imports";
import { familyAccess, listAllChildrenExams, listChildExamDocuments, listChildExams, listMyExamDocuments, listMyExams } from "../application/family";
import { issueBatch, issueDocument, listIssuedDocuments, readIssuedDocumentFile, revokeIssuedDocument } from "../application/issued-documents";
import { computeMock, importFromAssess, linkAssessment, listLinks, unlinkAssessment } from "../application/mock";
import { createExaminationsPortRegistry, type ExaminationsPortRegistry } from "../application/port-registry";
import type { ExaminationsPorts } from "../application/ports";
import { createCenter, createExamType, createPaper, createRequirement, createRoom, createTrack, getExamType, instantiatePack, listCenters, listExamTypes, updateCenter, updateExamType, updatePaper, updateRequirement, updateRoom, updateTrack } from "../application/reference";
import { listResults, publishResult, saveResults } from "../application/results";
import { approveRevision, listRevisionRequests, rejectRevision, requestResultRevision, requestScoreRevision } from "../application/revisions";
import { bulkSaveScores, getScoreMatrix } from "../application/scores";
import { createSession, getSessionDetail, instantiateSession, listSessions, transitionSession, updateSession } from "../application/sessions";
import { getStatistics } from "../application/statistics";
import { getExport, getExportDownload, listExports, runExport } from "../application/exports";
import { ExamCode, HTTP_STATUS_BY_EXAM_CODE, forbidden, validation } from "../domain/errors";
import { examinationsAuditAdapter } from "../infrastructure/audit-adapter";
import { createPermissionKit, PERMISSIONS as P, type PermissionKit } from "./guards";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par les adaptateurs de plateforme)
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module examinations (posé par `setup`). */
    examinationsPorts: ExaminationsPortRegistry;
  }
}

/** À appeler par `platform/adapters` (`wireApiPorts`) : enregistre (ou remplace) des ports ; relus à chaque appel. */
export function registerExaminationsPorts(app: FastifyInstance, ports: Partial<ExaminationsPorts>): void {
  if (!app.hasDecorator("examinationsPorts")) app.decorate("examinationsPorts", createExaminationsPortRegistry());
  app.examinationsPorts.register(ports);
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError("Données invalides.", error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })), { code: ExamCode.INVALID_INPUT });
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

const idOf = (params: unknown, key = "id"): string => parse(examUuidSchema, (params as Record<string, unknown> | undefined)?.[key]);

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** Erreurs du transport (corps trop gros, JSON invalide) vers les codes stables du module. */
function normalizeTransportError(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: string; statusCode?: number };
    if (e.code === "FST_ERR_CTP_BODY_TOO_LARGE" || e.statusCode === 413) return validation(ExamCode.FILE_TOO_LARGE, "Le fichier dépasse la taille maximale autorisée.", "body");
    if (typeof e.code === "string" && e.code.startsWith("FST_") && e.statusCode === 400) return validation(ExamCode.INVALID_INPUT, "Requête invalide.", "body");
    if (e.statusCode === 400) return validation(ExamCode.INVALID_INPUT, "Requête invalide.", "body");
  }
  return error;
}

const HTTP_RATE = Object.freeze({
  bulk: { limit: 60, windowMs: 60_000 },
  upload: { limit: 20, windowMs: 60_000 },
  export: { limit: 20, windowMs: 60_000 },
});

export interface RateLimiterLike {
  hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; count: number; retryAfterMs: number }>;
}

export interface ExaminationsPluginOptions {
  deps: ExaminationsDeps;
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  rateLimiter?: RateLimiterLike;
  /** Contrôle de feature (entitlements) ; absent = toutes les features actives (tests autonomes). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
}

const noStore = (reply: FastifyReply): void => {
  void reply.header("Cache-Control", "no-store");
};

export async function examinationsPlugin(app: FastifyInstance, options: ExaminationsPluginOptions): Promise<void> {
  const { deps } = options;
  const kit: PermissionKit = createPermissionKit(options.requirePermission);
  const featureGuard = (feature: string): preHandlerAsyncHookHandler[] => (options.requireFeature ? [options.requireFeature(feature)] : []);
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };
  const limit = async (request: FastifyRequest, reply: FastifyReply, bucket: keyof typeof HTTP_RATE): Promise<void> => {
    if (!options.rateLimiter) return;
    const ctx = ctxOf(request);
    const rule = HTTP_RATE[bucket];
    const hit = await options.rateLimiter.hit(`examinations:${bucket}:${ctx.tenantId}:${ctx.userId ?? "system"}`, rule);
    if (!hit.allowed) {
      void reply.header("Retry-After", String(Math.max(1, Math.ceil(hit.retryAfterMs / 1000))));
      throw new ForbiddenError("Trop de requêtes : réessayer dans un instant.", { code: ExamCode.RATE_LIMITED });
    }
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(normalizeTransportError(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "examinations : erreur inattendue");
    noStore(reply);
    const status = appError.code === ExamCode.RATE_LIMITED ? 429 : HTTP_STATUS_BY_EXAM_CODE[appError.code] ?? appError.httpStatus;
    void reply.status(status).send({ ...toErrorBody(appError, String(request.id)), status });
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    scope.addHook("onSend", async (_request, reply, payload) => {
      if (!reply.hasHeader("Cache-Control")) noStore(reply);
      return payload;
    });
    const core = featureGuard("examinations.core");
    const mock = [...core, ...featureGuard("examinations.mock")];
    const exp = [...core, ...featureGuard("examinations.exports")];
    const g = (...guards: preHandlerAsyncHookHandler[]): { preHandler: preHandlerAsyncHookHandler[] } => ({ preHandler: guards });

    // ------------------------------------------------------------------ types et données de référence
    scope.get("/exam-types", g(kit.require(P.typeRead), ...core), async (request) => {
      const q = parse(z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() }).strict(), request.query);
      return { items: unwrapOrThrow(await listExamTypes(deps, ctxOf(request), q.status ? { status: q.status } : {})) };
    });
    scope.post("/exam-types", g(kit.require(P.typeManage), ...core), async (request, reply) => {
      const r = unwrapOrThrow(await createExamType(deps, ctxOf(request), parse(examCreateTypeBodySchema, request.body)));
      return reply.status(201).send(r);
    });
    scope.post("/exam-types/instantiate-pack", g(kit.require(P.typeManage), ...core), async (request) => {
      const body = parse(examInstantiatePackBodySchema, request.body);
      return unwrapOrThrow(await instantiatePack(deps, ctxOf(request), body.pack));
    });
    scope.get("/exam-types/:id", g(kit.require(P.typeRead), ...core), async (request) => unwrapOrThrow(await getExamType(deps, ctxOf(request), idOf(request.params))));
    scope.patch("/exam-types/:id", g(kit.require(P.typeManage), ...core), async (request) => unwrapOrThrow(await updateExamType(deps, ctxOf(request), idOf(request.params), parse(examUpdateTypeBodySchema, request.body))));
    scope.post("/exam-types/:id/tracks", g(kit.require(P.typeManage), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createTrack(deps, ctxOf(request), idOf(request.params), parse(examCreateTrackBodySchema, request.body)))));
    scope.patch("/exam-types/:id/tracks/:trackId", g(kit.require(P.typeManage), ...core), async (request) => unwrapOrThrow(await updateTrack(deps, ctxOf(request), idOf(request.params), idOf(request.params, "trackId"), parse(examUpdateTrackBodySchema, request.body))));
    scope.post("/exam-types/:id/papers", g(kit.require(P.typeManage), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createPaper(deps, ctxOf(request), idOf(request.params), parse(examCreatePaperBodySchema, request.body)))));
    scope.patch("/exam-types/:id/papers/:paperId", g(kit.require(P.typeManage), ...core), async (request) => unwrapOrThrow(await updatePaper(deps, ctxOf(request), idOf(request.params), idOf(request.params, "paperId"), parse(examUpdatePaperBodySchema, request.body))));
    scope.post("/exam-types/:id/document-requirements", g(kit.require(P.typeManage), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createRequirement(deps, ctxOf(request), idOf(request.params), parse(examCreateRequirementBodySchema, request.body)))));
    scope.patch("/exam-types/:id/document-requirements/:reqId", g(kit.require(P.typeManage), ...core), async (request) => unwrapOrThrow(await updateRequirement(deps, ctxOf(request), idOf(request.params), idOf(request.params, "reqId"), parse(examUpdateRequirementBodySchema, request.body))));

    // ------------------------------------------------------------------ centres et salles
    scope.get("/centers", g(kit.anyOf(P.centerManage, P.sessionRead), ...core), async (request) => ({ items: unwrapOrThrow(await listCenters(deps, ctxOf(request))) }));
    scope.post("/centers", g(kit.require(P.centerManage), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createCenter(deps, ctxOf(request), parse(examCreateCenterBodySchema, request.body)))));
    scope.patch("/centers/:id", g(kit.require(P.centerManage), ...core), async (request) => unwrapOrThrow(await updateCenter(deps, ctxOf(request), idOf(request.params), parse(examUpdateCenterBodySchema, request.body))));
    scope.post("/centers/:id/rooms", g(kit.require(P.centerManage), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createRoom(deps, ctxOf(request), idOf(request.params), parse(examCreateRoomBodySchema, request.body)))));
    scope.patch("/centers/:id/rooms/:roomId", g(kit.require(P.centerManage), ...core), async (request) => unwrapOrThrow(await updateRoom(deps, ctxOf(request), idOf(request.params), idOf(request.params, "roomId"), parse(examUpdateRoomBodySchema, request.body))));

    // ------------------------------------------------------------------ sessions
    scope.get("/sessions", g(kit.require(P.sessionRead), ...core), async (request) => unwrapOrThrow(await listSessions(deps, ctxOf(request), parse(examSessionListQuerySchema, request.query))));
    scope.post("/sessions", g(kit.require(P.sessionManage), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createSession(deps, ctxOf(request), parse(examCreateSessionBodySchema, request.body)))));
    scope.get("/sessions/:id", g(kit.require(P.sessionRead), ...core), async (request) => unwrapOrThrow(await getSessionDetail(deps, ctxOf(request), idOf(request.params))));
    scope.patch("/sessions/:id", g(kit.require(P.sessionManage), ...core), async (request) => unwrapOrThrow(await updateSession(deps, ctxOf(request), idOf(request.params), parse(examUpdateSessionBodySchema, request.body))));
    scope.post("/sessions/:id/instantiate", g(kit.require(P.sessionManage), ...core), async (request) => unwrapOrThrow(await instantiateSession(deps, ctxOf(request), idOf(request.params))));
    scope.post("/sessions/:id/transition", g(kit.require(P.sessionManage), ...core), async (request, reply) => {
      const body = parse(examTransitionBodySchema, request.body);
      // Publier = acte sensible : la permission de publication (MFA) est exigée en plus de la gestion de session.
      if (body.to === "PUBLISHED" && !(await kit.has(scope, request, reply, P.resultPublish))) throw forbidden(ExamCode.FORBIDDEN, "La publication des résultats exige la permission « exam.result.publish ».", { permission: P.resultPublish });
      return unwrapOrThrow(await transitionSession(deps, ctxOf(request), idOf(request.params), body.to));
    });

    // ------------------------------------------------------------------ candidats
    scope.get("/sessions/:id/candidates", g(kit.anyOf(P.candidateRead, P.candidateManage), ...core), async (request) => unwrapOrThrow(await listCandidates(deps, ctxOf(request), idOf(request.params), parse(examCandidateListQuerySchema, request.query))));
    scope.post("/sessions/:id/candidates", g(kit.require(P.candidateManage), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createCandidate(deps, ctxOf(request), idOf(request.params), parse(examCreateCandidateBodySchema, request.body)))));
    scope.post("/sessions/:id/candidates/from-classroom", g(kit.require(P.candidateManage), ...core), async (request) => unwrapOrThrow(await createFromClassroom(deps, ctxOf(request), idOf(request.params), parse(examFromClassroomBodySchema, request.body))));
    scope.post("/sessions/:id/candidates/register-batch", g(kit.require(P.candidateManage), ...core), async (request, reply) => {
      await limit(request, reply, "bulk");
      return unwrapOrThrow(await registerBatch(deps, ctxOf(request), parse(examRegisterBatchBodySchema, request.body).candidateIds));
    });
    scope.post("/sessions/:id/eligibility/evaluate-all", g(kit.require(P.eligibilityEvaluate), ...core), async (request) => unwrapOrThrow(await evaluateAll(deps, ctxOf(request), idOf(request.params))));
    scope.get("/candidates/:id", g(kit.anyOf(P.candidateRead, P.candidateManage), ...core), async (request) => unwrapOrThrow(await getCandidateDetail(deps, ctxOf(request), idOf(request.params))));
    scope.patch("/candidates/:id", g(kit.require(P.candidateManage), ...core), async (request) => unwrapOrThrow(await updateCandidateTrack(deps, ctxOf(request), idOf(request.params), parse(examUpdateCandidateBodySchema, request.body).trackCode)));
    scope.post("/candidates/:id/register", g(kit.require(P.candidateManage), ...core), async (request) => unwrapOrThrow(await registerCandidate(deps, ctxOf(request), idOf(request.params))));
    scope.post("/candidates/:id/withdraw", g(kit.require(P.candidateManage), ...core), async (request) => unwrapOrThrow(await withdrawCandidate(deps, ctxOf(request), idOf(request.params), parse(examWithdrawBodySchema, request.body).reason)));
    scope.post("/candidates/:id/eligibility", g(kit.require(P.eligibilityEvaluate), ...core), async (request, reply) => {
      const body = parse(examEligibilityBodySchema, request.body);
      // Dérogation = acte sensible : permission dédiée (MFA) en plus de l'évaluation.
      if (body.mode === "OVERRIDE" && !(await kit.has(scope, request, reply, P.eligibilityOverride))) throw forbidden(ExamCode.FORBIDDEN, "Une dérogation d'éligibilité exige la permission « exam.eligibility.override ».", { permission: P.eligibilityOverride });
      return unwrapOrThrow(await evaluateEligibility(deps, ctxOf(request), idOf(request.params), body));
    });
    // --- candidats libres (Q-E15) : saisie / import, profil restreint (lecture auditée), anonymisation
    scope.post("/sessions/:id/external-candidates", g(kit.require(P.externalManage), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createExternalCandidate(deps, ctxOf(request), idOf(request.params), parse(examCreateExternalCandidateBodySchema, request.body)))));
    scope.post("/sessions/:id/external-candidates/batch", g(kit.require(P.externalManage), ...core), async (request, reply) => {
      await limit(request, reply, "bulk");
      const body = parse(examExternalBatchBodySchema, request.body);
      return unwrapOrThrow(await createExternalBatch(deps, ctxOf(request), idOf(request.params), body.items, body.source));
    });
    scope.get("/candidates/:id/external-profile", g(kit.require(P.externalRead), ...core), async (request) => {
      const q = parse(z.object({ reveal: z.enum(["true", "false"]).default("false") }).strict(), request.query);
      return unwrapOrThrow(await getExternalProfile(deps, ctxOf(request), idOf(request.params), { reveal: q.reveal === "true" }));
    });
    scope.put("/candidates/:id/external-profile", g(kit.require(P.externalManage), ...core), async (request) => unwrapOrThrow(await updateExternalCandidate(deps, ctxOf(request), idOf(request.params), parse(examUpdateExternalCandidateBodySchema, request.body))));
    scope.post("/candidates/:id/anonymize", g(kit.require(P.externalAnonymize), ...core), async (request) => unwrapOrThrow(await anonymizeExternalCandidate(deps, ctxOf(request), idOf(request.params), parse(examAnonymizeBodySchema, request.body).reason)));
    // --- frais d'examen intégrés à l'inscription (Q-E13) : barème par type, obligation du candidat, reprise, remboursement manuel
    scope.get("/exam-types/:id/fee-items", g(kit.anyOf(P.feeRead, P.feeManage), ...core), async (request) => ({ items: unwrapOrThrow(await listFeeItems(deps, ctxOf(request), idOf(request.params))) }));
    scope.put("/exam-types/:id/fee-items", g(kit.require(P.feeManage), ...core), async (request) => ({ items: unwrapOrThrow(await setFeeItems(deps, ctxOf(request), idOf(request.params), parse(examSetFeeItemsBodySchema, request.body))) }));
    scope.get("/fee-catalog", g(kit.require(P.feeManage), ...core), async (request) => ({ items: unwrapOrThrow(await listFeeCatalog(deps, ctxOf(request))) }));
    scope.get("/candidates/:id/fee", g(kit.anyOf(P.feeRead, P.feeManage), ...core), async (request) => unwrapOrThrow(await getCandidateFee(deps, ctxOf(request), idOf(request.params))));
    scope.post("/candidates/:id/fee/sync", g(kit.require(P.feeManage), ...core), async (request) => unwrapOrThrow(await syncCandidateFee(deps, ctxOf(request), idOf(request.params))));
    scope.post("/candidates/:id/fee/refund-done", g(kit.require(P.feeManage), ...core), async (request) => unwrapOrThrow(await confirmRefund(deps, ctxOf(request), idOf(request.params), parse(examRefundDoneBodySchema, request.body).note)));
    scope.post("/sessions/:id/fees/sync", g(kit.require(P.feeManage), ...core), async (request, reply) => {
      await limit(request, reply, "bulk");
      return unwrapOrThrow(await syncSessionFees(deps, ctxOf(request), idOf(request.params)));
    });
    scope.get("/candidates/:id/documents", g(kit.anyOf(P.candidateRead, P.candidateManage), ...core), async (request) => unwrapOrThrow(await listPieces(deps, ctxOf(request), idOf(request.params))));
    scope.put("/candidates/:id/documents/:reqId", g(kit.require(P.candidateManage), ...core), async (request) => unwrapOrThrow(await actOnPiece(deps, ctxOf(request), idOf(request.params), idOf(request.params, "reqId"), parse(examPieceActionBodySchema, request.body))));
    scope.put("/candidates/:id/identifiers", g(kit.require(P.candidateManage), ...core), async (request) => unwrapOrThrow(await setIdentifier(deps, ctxOf(request), idOf(request.params), parse(examIdentifierBodySchema, request.body))));

    // ------------------------------------------------------------------ centres de la session et répartition
    scope.get("/sessions/:id/centers", g(kit.anyOf(P.centerManage, P.sessionRead), ...core), async (request) => unwrapOrThrow(await getAssignmentsOverview(deps, ctxOf(request), idOf(request.params))));
    scope.put("/sessions/:id/centers", g(kit.require(P.centerManage), ...core), async (request) => unwrapOrThrow(await setSessionCenters(deps, ctxOf(request), idOf(request.params), parse(examSessionCentersBodySchema, request.body).centerIds)));
    scope.post("/sessions/:id/assignments/auto", g(kit.require(P.centerManage), ...core), async (request) => unwrapOrThrow(await autoAssign(deps, ctxOf(request), idOf(request.params), parse(examAutoAssignBodySchema, request.body))));
    scope.put("/assignments/:candidateId", g(kit.require(P.centerManage), ...core), async (request) => unwrapOrThrow(await assignCandidate(deps, ctxOf(request), idOf(request.params, "candidateId"), parse(examAssignBodySchema, request.body))));
    scope.delete("/assignments/:candidateId", g(kit.require(P.centerManage), ...core), async (request) => unwrapOrThrow(await unassignCandidate(deps, ctxOf(request), idOf(request.params, "candidateId"))));

    // ------------------------------------------------------------------ notes et résultats
    scope.get("/sessions/:id/scores", g(kit.anyOf(P.scoreEnter, P.resultRead), ...core), async (request) => unwrapOrThrow(await getScoreMatrix(deps, ctxOf(request), idOf(request.params))));
    scope.put("/sessions/:id/scores/bulk", g(kit.require(P.scoreEnter), ...core), async (request, reply) => {
      await limit(request, reply, "bulk");
      return unwrapOrThrow(await bulkSaveScores(deps, ctxOf(request), idOf(request.params), parse(examBulkScoresBodySchema, request.body)));
    });
    scope.get("/sessions/:id/results", g(kit.anyOf(P.resultRead, P.resultEnter), ...core), async (request) => unwrapOrThrow(await listResults(deps, ctxOf(request), idOf(request.params), parse(examResultListQuerySchema, request.query))));
    scope.put("/sessions/:id/results", g(kit.require(P.resultEnter), ...core), async (request, reply) => {
      await limit(request, reply, "bulk");
      return unwrapOrThrow(await saveResults(deps, ctxOf(request), idOf(request.params), parse(examBulkResultsBodySchema, request.body)));
    });
    scope.post("/results/:id/publish", g(kit.require(P.resultPublish), ...core), async (request) => unwrapOrThrow(await publishResult(deps, ctxOf(request), idOf(request.params))));

    // ------------------------------------------------------------------ révisions (quatre yeux)
    scope.post("/results/:id/revisions", g(kit.anyOf(P.resultEnter, P.resultRevise), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await requestResultRevision(deps, ctxOf(request), idOf(request.params), parse(examResultRevisionBodySchema, request.body)))));
    scope.post("/scores/:id/revisions", g(kit.anyOf(P.resultEnter, P.resultRevise), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await requestScoreRevision(deps, ctxOf(request), idOf(request.params), parse(examScoreRevisionBodySchema, request.body)))));
    scope.get("/sessions/:id/revision-requests", g(kit.anyOf(P.resultRead, P.resultRevise), ...core), async (request) => unwrapOrThrow(await listRevisionRequests(deps, ctxOf(request), idOf(request.params), parse(examRevisionListQuerySchema, request.query))));
    scope.post("/revision-requests/:id/approve", g(kit.require(P.resultRevise), ...core), async (request) => unwrapOrThrow(await approveRevision(deps, ctxOf(request), idOf(request.params))));
    scope.post("/revision-requests/:id/reject", g(kit.require(P.resultRevise), ...core), async (request) => unwrapOrThrow(await rejectRevision(deps, ctxOf(request), idOf(request.params), parse(examRejectRevisionBodySchema, request.body).note)));

    // ------------------------------------------------------------------ imports
    scope.get("/import-formats", g(kit.anyOf(P.importManage, P.sessionRead), ...core), async (request) => {
      const q = parse(z.object({ status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).optional(), kind: z.enum(["OFFICIAL_NUMBERS", "SCORES", "RESULTS"]).optional() }).strict(), request.query);
      return { items: unwrapOrThrow(await listImportFormats(deps, ctxOf(request), { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) })) };
    });
    scope.post("/import-formats", g(kit.require(P.importManage), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createImportFormat(deps, ctxOf(request), parse(examCreateImportFormatBodySchema, request.body)))));
    scope.get("/import-formats/:id", g(kit.anyOf(P.importManage, P.sessionRead), ...core), async (request) => unwrapOrThrow(await getImportFormat(deps, ctxOf(request), idOf(request.params))));
    scope.patch("/import-formats/:id", g(kit.require(P.importManage), ...core), async (request) => unwrapOrThrow(await updateImportFormat(deps, ctxOf(request), idOf(request.params), parse(examUpdateImportFormatBodySchema, request.body))));
    scope.post("/import-formats/:id/publish", g(kit.require(P.importManage), ...core), async (request) => unwrapOrThrow(await publishImportFormat(deps, ctxOf(request), idOf(request.params))));
    scope.get("/sessions/:id/imports", g(kit.require(P.importManage), ...core), async (request) => ({ items: unwrapOrThrow(await listBatches(deps, ctxOf(request), idOf(request.params))) }));
    scope.post("/sessions/:id/imports", { ...g(kit.require(P.importManage), ...core), bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
      await limit(request, reply, "upload");
      return reply.status(201).send(unwrapOrThrow(await createImport(deps, ctxOf(request), idOf(request.params), parse(examCreateImportBodySchema, request.body))));
    });
    scope.get("/imports/:id", g(kit.require(P.importManage), ...core), async (request) => unwrapOrThrow(await getBatch(deps, ctxOf(request), idOf(request.params), parse(examImportRowsQuerySchema, request.query))));
    scope.post("/imports/:id/validate", g(kit.require(P.importManage), ...core), async (request) => unwrapOrThrow(await validateImport(deps, ctxOf(request), idOf(request.params))));
    scope.post("/imports/:id/apply", g(kit.require(P.resultRelease), ...core), async (request) => unwrapOrThrow(await applyImport(deps, ctxOf(request), idOf(request.params))));

    // ------------------------------------------------------------------ examens blancs
    scope.get("/sessions/:id/mock/links", g(kit.require(P.mockManage), ...mock), async (request) => ({ items: unwrapOrThrow(await listLinks(deps, ctxOf(request), idOf(request.params))) }));
    scope.post("/sessions/:id/mock/link", g(kit.require(P.mockManage), ...mock), async (request, reply) => reply.status(201).send(unwrapOrThrow(await linkAssessment(deps, ctxOf(request), idOf(request.params), parse(examMockLinkBodySchema, request.body)))));
    scope.delete("/sessions/:id/mock/links/:linkId", g(kit.require(P.mockManage), ...mock), async (request) => unwrapOrThrow(await unlinkAssessment(deps, ctxOf(request), idOf(request.params), idOf(request.params, "linkId"))));
    scope.post("/sessions/:id/mock/import-from-assess", g(kit.require(P.mockManage), ...mock), async (request) => unwrapOrThrow(await importFromAssess(deps, ctxOf(request), idOf(request.params))));
    scope.post("/sessions/:id/mock/compute", g(kit.require(P.mockManage), ...mock), async (request) => unwrapOrThrow(await computeMock(deps, ctxOf(request), idOf(request.params))));

    // ------------------------------------------------------------------ statistiques
    scope.get("/sessions/:id/statistics", g(kit.require(P.statisticsRead), ...core), async (request) => unwrapOrThrow(await getStatistics(deps, ctxOf(request), idOf(request.params), parse(examStatisticsQuerySchema, request.query))));

    // ------------------------------------------------------------------ exports
    scope.get("/export-formats", g(kit.anyOf(P.exportManage, P.exportRun), ...exp), async (request) => {
      const q = parse(z.object({ status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).optional(), kind: z.enum(["CANDIDATE_LIST", "CENTER_ASSIGNMENTS", "RESULTS", "STATISTICS"]).optional() }).strict(), request.query);
      return { items: unwrapOrThrow(await listExportFormats(deps, ctxOf(request), { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) })) };
    });
    scope.post("/export-formats", g(kit.require(P.exportManage), ...exp), async (request, reply) => reply.status(201).send(unwrapOrThrow(await createExportFormat(deps, ctxOf(request), parse(examCreateExportFormatBodySchema, request.body)))));
    scope.get("/export-formats/:id", g(kit.anyOf(P.exportManage, P.exportRun), ...exp), async (request) => unwrapOrThrow(await getExportFormat(deps, ctxOf(request), idOf(request.params))));
    scope.patch("/export-formats/:id", g(kit.require(P.exportManage), ...exp), async (request) => unwrapOrThrow(await updateExportFormat(deps, ctxOf(request), idOf(request.params), parse(examUpdateExportFormatBodySchema, request.body))));
    scope.post("/export-formats/:id/publish", g(kit.require(P.exportManage), ...exp), async (request) => unwrapOrThrow(await publishExportFormat(deps, ctxOf(request), idOf(request.params))));
    scope.post("/export-formats/:id/new-version", g(kit.require(P.exportManage), ...exp), async (request, reply) => reply.status(201).send(unwrapOrThrow(await newExportFormatVersion(deps, ctxOf(request), idOf(request.params)))));
    scope.get("/sessions/:id/exports", g(kit.require(P.exportRun), ...exp), async (request) => ({ items: unwrapOrThrow(await listExports(deps, ctxOf(request), idOf(request.params))) }));
    scope.post("/sessions/:id/exports", g(kit.require(P.exportRun), ...exp), async (request, reply) => {
      await limit(request, reply, "export");
      return reply.status(201).send(unwrapOrThrow(await runExport(deps, ctxOf(request), idOf(request.params), parse(examRunExportBodySchema, request.body))));
    });
    scope.get("/exports/:id", g(kit.require(P.exportRun), ...exp), async (request) => unwrapOrThrow(await getExport(deps, ctxOf(request), idOf(request.params))));
    scope.get("/exports/:id/download", g(kit.require(P.exportRun), ...exp), async (request) => unwrapOrThrow(await getExportDownload(deps, ctxOf(request), idOf(request.params))));

    // ------------------------------------------------------------------ documents
    scope.get("/sessions/:id/issued-documents", g(kit.require(P.documentIssue), ...core), async (request) => unwrapOrThrow(await listIssuedDocuments(deps, ctxOf(request), idOf(request.params), parse(examIssuedDocumentListQuerySchema, request.query))));
    scope.post("/sessions/:id/documents/issue-batch", g(kit.require(P.documentIssue), ...core), async (request, reply) => {
      await limit(request, reply, "bulk");
      return unwrapOrThrow(await issueBatch(deps, ctxOf(request), idOf(request.params), parse(examIssueBatchBodySchema, request.body)));
    });
    scope.post("/candidates/:id/documents/issue", g(kit.require(P.documentIssue), ...core), async (request, reply) => reply.status(201).send(unwrapOrThrow(await issueDocument(deps, ctxOf(request), idOf(request.params), parse(examIssueDocumentBodySchema, request.body).kind))));
    scope.post("/issued-documents/:id/revoke", g(kit.require(P.documentIssue), ...core), async (request) => unwrapOrThrow(await revokeIssuedDocument(deps, ctxOf(request), idOf(request.params), parse(examRevokeDocumentBodySchema, request.body).reason)));
    scope.get("/issued-documents/:id/file", g(kit.require(P.documentIssue), ...core), async (request, reply) => sendFile(reply, unwrapOrThrow(await readIssuedDocumentFile(deps, ctxOf(request), idOf(request.params)))));

    // ------------------------------------------------------------------ famille
    scope.get("/me/exams", g(kit.require(P.documentSelfRead), ...core), async (request) => ({ items: unwrapOrThrow(await listMyExams(deps, ctxOf(request))) }));
    scope.get("/me/exam-documents", g(kit.require(P.documentSelfRead), ...core), async (request) => ({ items: unwrapOrThrow(await listMyExamDocuments(deps, ctxOf(request))) }));
    scope.get("/family/exams", g(kit.require(P.documentChildRead), ...core), async (request) => ({ items: unwrapOrThrow(await listAllChildrenExams(deps, ctxOf(request))) }));
    scope.get("/children/:studentId/exams", g(kit.require(P.documentChildRead), ...core), async (request) => ({ items: unwrapOrThrow(await listChildExams(deps, ctxOf(request), idOf(request.params, "studentId"))) }));
    scope.get("/children/:studentId/exam-documents", g(kit.require(P.documentChildRead), ...core), async (request) => ({ items: unwrapOrThrow(await listChildExamDocuments(deps, ctxOf(request), idOf(request.params, "studentId"))) }));
    scope.get("/family/exam-documents/:id/file", g(kit.anyOf(P.documentChildRead, P.documentSelfRead), ...core), async (request, reply) => {
      const ctx = ctxOf(request);
      return sendFile(reply, unwrapOrThrow(await readIssuedDocumentFile(deps, ctx, idOf(request.params), { allow: familyAccess(deps, ctx) })));
    });
  });
}

function sendFile(reply: FastifyReply, file: { fileName: string; bytes: Uint8Array; verificationCode: string | null } | null): FastifyReply {
  noStore(reply);
  if (!file) return reply.status(202).send({ status: "PENDING", retryAfterSeconds: 2, message: "Le document est en cours de rendu : réessayer dans un instant." });
  const ascii = file.fileName.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_");
  return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="${ascii}"`).header("X-Content-Type-Options", "nosniff").send(Buffer.from(file.bytes));
}

export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("examinationsPorts")) app.decorate("examinationsPorts", createExaminationsPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/examinations`). */
export default async function examinationsModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("examinationsPorts")) app.decorate("examinationsPorts", createExaminationsPortRegistry());
  const deps = createExaminationsDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: examinationsAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => app.examinationsPorts.current,
  });
  await app.register(examinationsPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: runtime.rateLimiter as unknown as RateLimiterLike,
    requireFeature: (feature) => runtime.entitlements.requireFeature(feature),
  });
}
