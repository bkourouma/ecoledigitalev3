/**
 * Plugin Fastify du module admissions — routes SANS préfixe (le registre applique `/api/v1/admissions`). Contrat d'assemblage
 * `(app, runtime)` + `setup(app, runtime)` qui décore la RACINE avec le registre de ports (`app.admissionsPorts`) que les
 * adaptateurs de plateforme renseignent, et enregistre les routes PUBLIQUES sous `/api/v1/public/admissions`.
 *
 *  - Personnel : `requirePermission('admission.…')` (rbac) ; AUCUN rôle codé en dur. Une transition de workflow cite SA permission
 *    (`permission_key`) : l'API la vérifie à la demande (`requirePermission(permission_key)`). 404 si hors périmètre (RLS).
 *  - Public : `config: { public: true }`, sans authentification, limiteur par IP (Redis), réponses uniformes et neutres, `no-store`,
 *    `X-Robots-Tag: noindex`, schéma Zod STRICT, code de suivi dans le CORPS (jamais dans l'URL).
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `admissions.*`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import multipart from "@fastify/multipart";
import { ZodError, z, type ZodTypeAny } from "zod";
import { ForbiddenError, UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  admissionsAcceptOnBehalfBodySchema,
  admissionsAnonymizeBodySchema,
  admissionsBoardDtoSchema,
  admissionsBoardQuerySchema,
  admissionsConvertProspectBodySchema,
  admissionsCreateApplicationBodySchema,
  admissionsCreateCampaignBodySchema,
  admissionsAttachToStudentFileBodySchema,
  admissionsAttachToStudentFileResultDtoSchema,
  admissionsCreateInterviewBodySchema,
  admissionsCreateProspectBodySchema,
  admissionsCreateWorkflowBodySchema,
  admissionsDecisionBodySchema,
  admissionsInstitutionQuerySchema,
  admissionsIssueOfferBodySchema,
  admissionsListApplicationsQuerySchema,
  admissionsListCampaignsQuerySchema,
  admissionsListProspectsQuerySchema,
  admissionsPromoteBodySchema,
  admissionsPublicFormDtoSchema,
  admissionsPublicLinkBodySchema,
  admissionsPublicOfferRespondBodySchema,
  admissionsPublicOfferRespondDtoSchema,
  admissionsPublicOfferViewBodySchema,
  admissionsPublicOfferViewDtoSchema,
  admissionsPublicSlugSchema,
  admissionsPublicSubmitBodySchema,
  admissionsPublicSubmitResultDtoSchema,
  admissionsPublicTrackBodySchema,
  admissionsPublicTrackDtoSchema,
  admissionsPublishConsentTextBodySchema,
  admissionsRecordConsentBodySchema,
  admissionsReplaceCapacitiesBodySchema,
  admissionsReplaceStagesBodySchema,
  admissionsReplaceTransitionsBodySchema,
  admissionsReportQuerySchema,
  admissionsResolveDuplicateBodySchema,
  admissionsReviewDocumentBodySchema,
  admissionsTransitionBodySchema,
  admissionsUpdateApplicationBodySchema,
  admissionsUpdateCampaignBodySchema,
  admissionsUpdateInterviewBodySchema,
  admissionsUpdateProspectBodySchema,
  admissionsUpdateSettingsBodySchema,
  admissionsUpdateWorkflowBodySchema,
  admissionsUpsertDecisionReasonBodySchema,
  admissionsUpsertDocumentRequirementBodySchema,
  admissionsUpsertPriorityClassBodySchema,
  admissionsUuidSchema,
  admissionsWaitlistQuerySchema,
  admissionsWaitlistReorderBodySchema,
  admissionsWithdrawConsentBodySchema,
  admissionsWithdrawOfferBodySchema,
} from "@ecoledigitale/contracts/src/v2/admissions";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { anonymizeApplication, exportApplication } from "../application/anonymize";
import {
  allowedTransitions as _allowedTransitions,
  createApplication,
  getApplication,
  getBoard,
  getHistory,
  listApplications,
  peekTransition,
  recordConsent,
  transitionApplication,
  updateApplication,
  withdrawConsent,
} from "../application/applications";
import { closeCampaign, createCampaign, getCampaign, listCampaigns, openCampaign, updateCampaign, upsertCapacities } from "../application/campaigns";
import { ensureInstitutionDefaults } from "../application/defaults";
import { listApplicationExamResults } from "../application/exam-results";
import { recordDecision } from "../application/decisions";
import { createAdmissionsDeps, type AdmissionsDeps } from "../application/deps";
import { listDuplicates, resolveDuplicate, runDetection } from "../application/duplicates";
import { getDocumentUrl, reviewDocument, uploadDocument } from "../application/documents";
import { createInterview, updateInterview } from "../application/interviews";
import { attachDocumentsToStudentFile } from "../application/student-file";
import { acceptOffer, issueOffer, recordAcceptFailure, setOfferClassroom, withdrawOffer } from "../application/offers";
import { createAdmissionsPortRegistry, type AdmissionsPortRegistry } from "../application/port-registry";
import type { AdmissionsPorts } from "../application/ports";
import { convertProspect, createProspect, listProspects, updateProspect } from "../application/prospects";
import { getPublicForm, respondOfferPublic, submitPublicApplication, trackApplication, uploadTrackedDocument, viewOfferPublic, type PublicOutcome } from "../application/public-form";
import { listConsentTexts, listDecisionReasons, listPriorityClasses, listRequirements, getSettings, managePublicLink, publishConsentText, retireConsentText, updateSettings, upsertDecisionReason, upsertPriorityClass, upsertRequirement } from "../application/reference";
import { capacityReport, funnel, rejectionsReport, slaReport, sourcesReport } from "../application/reports";
import { getWaitlist, promoteManually, reorderWaitlist } from "../application/waitlist";
import { createWorkflow, deleteDraftWorkflow, getWorkflowDetail, listWorkflows, newWorkflowVersion, publishWorkflow, replaceStages, replaceTransitions, updateWorkflow } from "../application/workflows";
import { AdmissionsCode, HTTP_STATUS_BY_ADMISSIONS_CODE, validation } from "../domain/errors";
import { admissionsAuditAdapter } from "../infrastructure/audit-adapter";

void _allowedTransitions;

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par les adaptateurs de plateforme)
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module admissions (posé par `setup`). */
    admissionsPorts: AdmissionsPortRegistry;
  }
}

/** À appeler par `platform/adapters` (`wireApiPorts`) : enregistre (ou remplace) des ports ; relus à chaque appel. */
export function registerAdmissionsPorts(app: FastifyInstance, ports: Partial<AdmissionsPorts>): void {
  if (!app.hasDecorator("admissionsPorts")) app.decorate("admissionsPorts", createAdmissionsPortRegistry());
  app.admissionsPorts.register(ports);
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError("Données invalides.", error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })), { code: AdmissionsCode.INVALID_INPUT });
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

const uuidParam = (params: unknown, name = "id"): string => parse(admissionsUuidSchema, (params as Record<string, unknown> | undefined)?.[name]);

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function normalizeTransportError(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: string; statusCode?: number };
    if (e.code === "FST_REQ_FILE_TOO_LARGE" || e.code === "FST_FILES_LIMIT" || e.code === "FST_PARTS_LIMIT" || e.code === "FST_ERR_CTP_BODY_TOO_LARGE" || e.statusCode === 413) {
      return validation(AdmissionsCode.FILE_REJECTED, "Le fichier dépasse la taille maximale autorisée.", "file");
    }
    if (e.statusCode === 400) return validation(AdmissionsCode.INVALID_INPUT, "Requête invalide.", "body");
  }
  return error;
}

export interface RateLimiterLike {
  hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; count: number; retryAfterMs: number }>;
}

export interface AdmissionsPluginOptions {
  deps: AdmissionsDeps;
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde « fonction vendable » (entitlements) ; absente = toutes actives (tests autonomes). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  rateLimiter?: RateLimiterLike;
}

const noStore = (reply: FastifyReply): void => {
  void reply.header("Cache-Control", "no-store");
};

/** Limite de requêtes du formulaire public par IP et par minute (le dépôt a, en plus, son propre plafond par établissement). */
export const PUBLIC_RATE = Object.freeze({ read: { limit: 30, windowMs: 60_000 }, submit: { limit: 10, windowMs: 60_000 }, upload: { limit: 10, windowMs: 60_000 } });

interface ParsedUpload {
  fields: Record<string, string>;
  file: { fileName: string; bytes: Uint8Array } | null;
}

async function readUpload(request: FastifyRequest, maxFileBytes: number): Promise<ParsedUpload> {
  if (!request.isMultipart()) throw validation(AdmissionsCode.INVALID_INPUT, "Le dépôt doit être envoyé en multipart/form-data.", "body");
  const fields: Record<string, string> = {};
  let file: ParsedUpload["file"] = null;
  const parts = request.parts({ limits: { fileSize: maxFileBytes + 1, files: 1, fields: 8, parts: 10, fieldSize: 2_000, fieldNameSize: 40 } });
  for await (const part of parts) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        part.file.resume();
        continue;
      }
      const bytes = await part.toBuffer();
      file = { fileName: part.filename ?? "", bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
    } else if (typeof part.value === "string") {
      fields[part.fieldname] = part.value;
    }
  }
  return { fields, file };
}

const PUBLIC_CLOSED_BODY = { status: 404, code: AdmissionsCode.PUBLIC_FORM_CLOSED, kind: "not_found", message: "Page introuvable." };
const PUBLIC_INVALID_BODY = { status: 400, code: AdmissionsCode.INVALID_INPUT, kind: "validation", message: "Requête invalide. Rechargez la page et réessayez." };

// ---------------------------------------------------------------------------
// Routes du personnel
// ---------------------------------------------------------------------------

export async function admissionsPlugin(app: FastifyInstance, options: AdmissionsPluginOptions): Promise<void> {
  const { deps } = options;
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(normalizeTransportError(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "admissions : erreur inattendue");
    noStore(reply);
    const status = HTTP_STATUS_BY_ADMISSIONS_CODE[appError.code] ?? appError.httpStatus;
    void reply.status(status).send({ ...toErrorBody(appError, String(request.id)), status });
  };

  /** Au moins UNE des permissions. */
  const anyOf = (...permissions: string[]): preHandlerAsyncHookHandler =>
    async function anyOfGuard(this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
      let last: unknown = null;
      for (const p of permissions) {
        try {
          await options.requirePermission(p).call(this, request, reply);
          return;
        } catch (e) {
          if (e instanceof ForbiddenError) last = e;
          else throw e;
        }
      }
      throw last ?? new ForbiddenError("Action non autorisée.");
    };
  /** Permission DÉTERMINÉE À LA REQUÊTE (permission portée par une transition, dépassement de capacité…). */
  const check = async (scope: FastifyInstance, request: FastifyRequest, reply: FastifyReply, permission: string): Promise<void> => {
    await options.requirePermission(permission).call(scope, request, reply);
  };
  const feature = (key: string): preHandlerAsyncHookHandler[] => (options.requireFeature ? [options.requireFeature(key)] : []);

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    scope.addHook("onSend", async (_request, reply, payload) => {
      if (!reply.hasHeader("Cache-Control")) noStore(reply);
      return payload;
    });
    if (!scope.hasContentTypeParser("multipart/form-data")) {
      await scope.register(multipart, { limits: { fileSize: deps.config.hardMaxFileBytes + 1, files: 1, fields: 8 } });
    }

    const P = (permission: string, ...extra: preHandlerAsyncHookHandler[]) => ({ preHandler: [options.requirePermission(permission), ...feature("admissions.core"), ...extra] });
    const PA = (permissions: string[], ...extra: preHandlerAsyncHookHandler[]) => ({ preHandler: [anyOf(...permissions), ...feature("admissions.core"), ...extra] });
    const institutionOf = (request: FastifyRequest): string | undefined => parse(admissionsInstitutionQuerySchema, request.query).institutionId;

    // ===== Aides de saisie (listes de référence des écrans) =============================================================
    scope.get("/lookups", PA(["admission.read", "admission.settings.manage", "admission.campaign.manage", "admission.prospect.manage"]), async (req) => {
      const ctx = ctxOf(req);
      const institutions = await deps.ports.catalog.listInstitutions(ctx);
      const wanted = institutionOf(req) ?? (institutions.length === 1 ? (institutions[0] as { id: string }).id : undefined);
      return {
        institutions,
        gradeLevels: wanted ? await deps.ports.catalog.gradeLevels(ctx, wanted) : [],
        relationships: await deps.ports.catalog.relationshipTypes(ctx),
      };
    });
    scope.get("/lookups/classrooms", P("admission.read"), async (req) => {
      const q = parse(z.object({ institutionId: admissionsUuidSchema, academicYearId: admissionsUuidSchema, gradeLevelCode: z.string().min(1).max(40) }), req.query);
      return { items: await deps.ports.catalog.classroomsOf(ctxOf(req), q) };
    });

    // ===== Paramètres ===================================================================================================
    scope.get("/settings", PA(["admission.settings.manage", "admission.read"]), async (req) => unwrap(await getSettings(deps, ctxOf(req), institutionOf(req))));
    scope.put("/settings", P("admission.settings.manage"), async (req) => unwrap(await updateSettings(deps, ctxOf(req), parse(admissionsUpdateSettingsBodySchema, req.body))));
    scope.post("/settings/public-link", P("admission.settings.manage", ...feature("admissions.public-form")), async (req) => {
      const b = parse(admissionsPublicLinkBodySchema, req.body);
      return unwrap(await managePublicLink(deps, ctxOf(req), b));
    });
    scope.post("/settings/initialize", P("admission.settings.manage"), async (req, reply) => {
      const ctx = ctxOf(req);
      const inst = parse(admissionsInstitutionQuerySchema, req.body).institutionId ?? institutionOf(req);
      const institutions = inst ? [{ id: inst }] : await deps.ports.catalog.listInstitutions(ctx);
      if (institutions.length !== 1) throw validation(AdmissionsCode.INSTITUTION_REQUIRED, "Précisez institutionId.", "institutionId");
      const r = unwrap(await ensureInstitutionDefaults(deps, ctx, (institutions[0] as { id: string }).id));
      return reply.status(200).send(r);
    });

    scope.get("/priority-classes", PA(["admission.settings.manage", "admission.read"]), async (req) => ({ items: unwrap(await listPriorityClasses(deps, ctxOf(req), institutionOf(req))) }));
    scope.put("/priority-classes", P("admission.settings.manage"), async (req) => unwrap(await upsertPriorityClass(deps, ctxOf(req), parse(admissionsUpsertPriorityClassBodySchema, req.body))));
    scope.get("/decision-reasons", PA(["admission.settings.manage", "admission.read", "admission.decide"]), async (req) => ({ items: unwrap(await listDecisionReasons(deps, ctxOf(req), institutionOf(req))) }));
    scope.put("/decision-reasons", P("admission.settings.manage"), async (req) => unwrap(await upsertDecisionReason(deps, ctxOf(req), parse(admissionsUpsertDecisionReasonBodySchema, req.body))));
    scope.get("/document-requirements", PA(["admission.settings.manage", "admission.read", "admission.document.upload"]), async (req) => ({ items: unwrap(await listRequirements(deps, ctxOf(req), institutionOf(req))) }));
    scope.put("/document-requirements", P("admission.settings.manage"), async (req) => unwrap(await upsertRequirement(deps, ctxOf(req), parse(admissionsUpsertDocumentRequirementBodySchema, req.body))));
    scope.get("/consent-texts", PA(["admission.settings.manage", "admission.read"]), async (req) => ({ items: unwrap(await listConsentTexts(deps, ctxOf(req), institutionOf(req))) }));
    scope.post("/consent-texts", P("admission.settings.manage"), async (req, reply) => {
      const q = parse(z.object({ designate: z.coerce.boolean().optional() }), req.query);
      const created = unwrap(await publishConsentText(deps, ctxOf(req), parse(admissionsPublishConsentTextBodySchema, req.body), { designate: q.designate === true }));
      return reply.status(201).send(created);
    });
    scope.post("/consent-texts/retire", P("admission.settings.manage"), async (req) => {
      const b = parse(z.object({ institutionId: admissionsUuidSchema.optional(), kind: z.enum(["DATA_PROCESSING", "PHOTO", "ADMISSION_TERMS", "COMMUNICATIONS"]), version: z.string().min(1).max(20) }), req.body);
      return unwrap(await retireConsentText(deps, ctxOf(req), b));
    });

    // ===== Workflows ====================================================================================================
    scope.get("/workflows", PA(["admission.workflow.manage", "admission.read", "admission.campaign.manage"]), async (req) => {
      const ctx = ctxOf(req);
      let items = unwrap(await listWorkflows(deps, ctx, institutionOf(req)));
      if (items.length === 0) {
        // Établissement existant avant le module : le modèle livré en donnée est instancié à la première visite (idempotent).
        const first = (await deps.ports.catalog.listInstitutions(ctx)).find((i) => !institutionOf(req) || i.id === institutionOf(req));
        if (first) {
          unwrap(await ensureInstitutionDefaults(deps, ctx, first.id));
          items = unwrap(await listWorkflows(deps, ctx, first.id));
        }
      }
      return { items };
    });
    scope.post("/workflows", P("admission.workflow.manage"), async (req, reply) => reply.status(201).send(unwrap(await createWorkflow(deps, ctxOf(req), parse(admissionsCreateWorkflowBodySchema, req.body)))));
    scope.get("/workflows/:id", PA(["admission.workflow.manage", "admission.read", "admission.campaign.manage"]), async (req) => unwrap(await getWorkflowDetail(deps, ctxOf(req), uuidParam(req.params))));
    scope.patch("/workflows/:id", P("admission.workflow.manage"), async (req) => unwrap(await updateWorkflow(deps, ctxOf(req), uuidParam(req.params), parse(admissionsUpdateWorkflowBodySchema, req.body))));
    scope.put("/workflows/:id/stages", P("admission.workflow.manage"), async (req) => unwrap(await replaceStages(deps, ctxOf(req), uuidParam(req.params), parse(admissionsReplaceStagesBodySchema, req.body))));
    scope.put("/workflows/:id/transitions", P("admission.workflow.manage"), async (req) => unwrap(await replaceTransitions(deps, ctxOf(req), uuidParam(req.params), parse(admissionsReplaceTransitionsBodySchema, req.body))));
    scope.post("/workflows/:id/publish", P("admission.workflow.publish"), async (req) => unwrap(await publishWorkflow(deps, ctxOf(req), uuidParam(req.params))));
    scope.post("/workflows/:id/new-version", P("admission.workflow.manage"), async (req, reply) => reply.status(201).send(unwrap(await newWorkflowVersion(deps, ctxOf(req), uuidParam(req.params)))));
    scope.delete("/workflows/:id", P("admission.workflow.manage"), async (req) => unwrap(await deleteDraftWorkflow(deps, ctxOf(req), uuidParam(req.params))));

    // ===== Campagnes ====================================================================================================
    scope.get("/campaigns", PA(["admission.read", "admission.campaign.manage"]), async (req) => {
      const q = parse(admissionsListCampaignsQuerySchema, req.query);
      return { items: unwrap(await listCampaigns(deps, ctxOf(req), q)) };
    });
    scope.post("/campaigns", P("admission.campaign.manage"), async (req, reply) => reply.status(201).send(unwrap(await createCampaign(deps, ctxOf(req), parse(admissionsCreateCampaignBodySchema, req.body)))));
    scope.get("/campaigns/:id", PA(["admission.read", "admission.campaign.manage"]), async (req) => unwrap(await getCampaign(deps, ctxOf(req), uuidParam(req.params))));
    scope.patch("/campaigns/:id", P("admission.campaign.manage"), async (req) => unwrap(await updateCampaign(deps, ctxOf(req), uuidParam(req.params), parse(admissionsUpdateCampaignBodySchema, req.body))));
    scope.post("/campaigns/:id/open", P("admission.campaign.manage"), async (req) => unwrap(await openCampaign(deps, ctxOf(req), uuidParam(req.params))));
    scope.post("/campaigns/:id/close", P("admission.campaign.manage"), async (req) => unwrap(await closeCampaign(deps, ctxOf(req), uuidParam(req.params))));
    scope.put("/campaigns/:id/capacities", P("admission.campaign.manage"), async (req) => unwrap(await upsertCapacities(deps, ctxOf(req), uuidParam(req.params), parse(admissionsReplaceCapacitiesBodySchema, req.body))));

    // ===== Prospects ====================================================================================================
    scope.get("/prospects", P("admission.prospect.manage"), async (req) => unwrap(await listProspects(deps, ctxOf(req), parse(admissionsListProspectsQuerySchema, req.query))));
    scope.post("/prospects", P("admission.prospect.manage"), async (req, reply) => reply.status(201).send(unwrap(await createProspect(deps, ctxOf(req), parse(admissionsCreateProspectBodySchema, req.body)))));
    scope.patch("/prospects/:id", P("admission.prospect.manage"), async (req) => unwrap(await updateProspect(deps, ctxOf(req), uuidParam(req.params), parse(admissionsUpdateProspectBodySchema, req.body))));
    scope.post("/prospects/:id/convert", P("admission.prospect.manage"), async (req, reply) => reply.status(201).send(unwrap(await convertProspect(deps, ctxOf(req), uuidParam(req.params), parse(admissionsConvertProspectBodySchema, req.body)))));

    // ===== Candidatures =================================================================================================
    scope.get("/applications", P("admission.read"), async (req) => unwrap(await listApplications(deps, ctxOf(req), parse(admissionsListApplicationsQuerySchema, req.query), institutionOf(req))));
    scope.get("/applications/board", P("admission.read"), async (req) => admissionsBoardDtoSchema.parse(unwrap(await getBoard(deps, ctxOf(req), parse(admissionsBoardQuerySchema, req.query)))));
    scope.post("/applications", P("admission.create"), async (req, reply) => reply.status(201).send(unwrap(await createApplication(deps, ctxOf(req), parse(admissionsCreateApplicationBodySchema, req.body)))));
    scope.get("/applications/:id", P("admission.read"), async (req) => unwrap(await getApplication(deps, ctxOf(req), uuidParam(req.params))));
    scope.patch("/applications/:id", P("admission.update"), async (req) => unwrap(await updateApplication(deps, ctxOf(req), uuidParam(req.params), parse(admissionsUpdateApplicationBodySchema, req.body))));
    scope.get("/applications/:id/history", P("admission.read"), async (req) => unwrap(await getHistory(deps, ctxOf(req), uuidParam(req.params))));
    // Résultat d'examen transmis (Q-E18) : « admis / non admis » pour toute personne qui lit les dossiers ; la MOYENNE seulement avec la
    // permission dédiée `admission.exam_result.read` (lecture tracée) — la permission est évaluée ICI, sans jamais refuser le reste.
    scope.get("/applications/:id/exam-results", P("admission.read"), async (req, reply) => {
      let includeAverage = true;
      try {
        await check(scope, req, reply, "admission.exam_result.read");
      } catch (e) {
        if (!(e instanceof ForbiddenError)) throw e;
        includeAverage = false;
      }
      return unwrap(await listApplicationExamResults(deps, ctxOf(req), uuidParam(req.params), { includeAverage }));
    });

    // Changement d'étape : la permission est celle PORTÉE PAR LA TRANSITION du workflow.
    scope.post("/applications/:id/transition", P("admission.read"), async (req, reply) => {
      const ctx = ctxOf(req);
      const id = uuidParam(req.params);
      const body = parse(admissionsTransitionBodySchema, req.body);
      const peek = unwrap(await peekTransition(deps, ctx, id, body.toStageId));
      await check(scope, req, reply, peek.permissionKey);
      return unwrap(await transitionApplication(deps, ctx, id, body));
    });

    // Décision formelle : `admission.decide` + la permission de la transition (+ dépassement de capacité : permission sensible).
    scope.post("/applications/:id/decisions", P("admission.decide"), async (req, reply) => {
      const ctx = ctxOf(req);
      const id = uuidParam(req.params);
      const body = parse(admissionsDecisionBodySchema, req.body);
      const peek = unwrap(await peekTransition(deps, ctx, id, body.toStageId));
      if (peek.permissionKey !== "admission.decide") await check(scope, req, reply, peek.permissionKey);
      if (body.overrideCapacity) await check(scope, req, reply, "admission.capacity.override");
      return unwrap(await recordDecision(deps, ctx, id, body));
    });

    // Pièces
    scope.post("/applications/:id/documents", P("admission.document.upload"), async (req) => {
      const ctx = ctxOf(req);
      const id = uuidParam(req.params);
      const up = await readUpload(req, deps.config.hardMaxFileBytes);
      if (!up.file) throw validation(AdmissionsCode.FILE_REJECTED, "Aucun fichier reçu.", "file");
      const requirementId = parse(admissionsUuidSchema, up.fields["requirementId"]);
      return { items: unwrap(await uploadDocument(deps, ctx, { applicationId: id, requirementId, fileName: up.file.fileName, bytes: up.file.bytes, by: "STAFF" })) };
    });
    scope.post("/applications/:id/documents/:reqId/review", P("admission.document.review"), async (req) => ({ items: unwrap(await reviewDocument(deps, ctxOf(req), uuidParam(req.params), uuidParam(req.params, "reqId"), parse(admissionsReviewDocumentBodySchema, req.body))) }));
    scope.get("/applications/:id/documents/:reqId/url", P("admission.document.review"), async (req) => unwrap(await getDocumentUrl(deps, ctxOf(req), uuidParam(req.params), uuidParam(req.params, "reqId"))));

    // Consentements enregistrés par le personnel (voie papier ou délégation, pièce justificative obligatoire)
    scope.post("/applications/:id/consents", P("admission.update"), async (req) => unwrap(await recordConsent(deps, ctxOf(req), uuidParam(req.params), parse(admissionsRecordConsentBodySchema, req.body))));
    scope.post("/applications/:id/consents/withdraw", P("admission.update"), async (req) => unwrap(await withdrawConsent(deps, ctxOf(req), uuidParam(req.params), parse(admissionsWithdrawConsentBodySchema, req.body))));

    // Entretiens
    // Rattachement différé à la GED, confirmé par un humain : la personne doit aussi pouvoir déposer dans la GED (`documents.upload`).
    // Les droits GED RÉELS de la personne sont relus ici (niveau de la catégorie) et transmis tels quels : admissions n'élargit rien.
    scope.post("/applications/:id/documents/attach-to-student-file", P("admission.document.attach", options.requirePermission("documents.upload")), async (req, reply) => {
      const has = async (permission: string): Promise<boolean> => {
        try {
          await check(scope, req, reply, permission);
          return true;
        } catch (e) {
          if (e instanceof ForbiddenError) return false;
          throw e;
        }
      };
      const caps = { upload: true, read: await has("documents.read"), readRestricted: await has("documents.read.restricted"), readConfidential: await has("documents.read.confidential"), manage: await has("documents.manage") };
      return admissionsAttachToStudentFileResultDtoSchema.parse(unwrap(await attachDocumentsToStudentFile(deps, ctxOf(req), uuidParam(req.params), { ...parse(admissionsAttachToStudentFileBodySchema, req.body), caps })));
    });
    scope.post("/applications/:id/interviews", { preHandler: [options.requirePermission("admission.interview.manage"), ...feature("admissions.core"), ...feature("admissions.interviews")] }, async (req, reply) =>
      reply.status(201).send({ items: unwrap(await createInterview(deps, ctxOf(req), uuidParam(req.params), parse(admissionsCreateInterviewBodySchema, req.body))) }),
    );
    scope.patch("/applications/:id/interviews/:iid", { preHandler: [options.requirePermission("admission.interview.manage"), ...feature("admissions.core"), ...feature("admissions.interviews")] }, async (req) => ({
      items: unwrap(await updateInterview(deps, ctxOf(req), uuidParam(req.params), uuidParam(req.params, "iid"), parse(admissionsUpdateInterviewBodySchema, req.body))),
    }));

    // Offres
    scope.post("/applications/:id/offers", P("admission.offer.manage"), async (req, reply) => reply.status(201).send(unwrap(await issueOffer(deps, ctxOf(req), uuidParam(req.params), parse(admissionsIssueOfferBodySchema, req.body)))));
    scope.post("/offers/:id/withdraw", P("admission.offer.manage"), async (req) => unwrap(await withdrawOffer(deps, ctxOf(req), uuidParam(req.params), parse(admissionsWithdrawOfferBodySchema, req.body).reason)));
    scope.post("/offers/:id/classroom", P("admission.offer.manage"), async (req) => unwrap(await setOfferClassroom(deps, ctxOf(req), uuidParam(req.params), parse(z.object({ classroomId: admissionsUuidSchema }), req.body).classroomId)));
    scope.post("/offers/:id/accept-on-behalf", P("admission.offer.manage"), async (req, reply) => {
      const ctx = ctxOf(req);
      await check(scope, req, reply, "admission.enroll");
      const offerId = uuidParam(req.params);
      const body = parse(admissionsAcceptOnBehalfBodySchema, req.body);
      const r = await acceptOffer(deps, ctx, { offerId, via: "STAFF_DELEGATION", guardianId: body.guardianId, evidenceRef: body.evidenceRef, ...(body.classroomId ? { classroomId: body.classroomId } : {}) });
      if (!r.ok) {
        await recordAcceptFailure(deps, ctx, { offerId, code: r.error.code, via: "STAFF_DELEGATION" });
        throw r.error;
      }
      return r.value;
    });

    // Doublons
    scope.get("/applications/:id/duplicates", P("admission.read"), async (req) => ({ items: unwrap(await listDuplicates(deps, ctxOf(req), uuidParam(req.params))) }));
    scope.post("/applications/:id/duplicates/detect", P("admission.duplicate.resolve"), async (req) => ({ items: unwrap(await runDetection(deps, ctxOf(req), uuidParam(req.params))) }));
    scope.post("/applications/:id/duplicates/:did/resolve", P("admission.duplicate.resolve"), async (req) =>
      unwrap(await resolveDuplicate(deps, ctxOf(req), uuidParam(req.params), uuidParam(req.params, "did"), parse(admissionsResolveDuplicateBodySchema, req.body).resolution)),
    );

    // Anonymisation (sensible) et droit d'accès
    scope.post("/applications/:id/anonymize", P("admission.anonymize"), async (req) => unwrap(await anonymizeApplication(deps, ctxOf(req), { applicationId: uuidParam(req.params), reason: parse(admissionsAnonymizeBodySchema, req.body).reason })));
    scope.get("/applications/:id/export", P("admission.export"), async (req) => unwrap(await exportApplication(deps, ctxOf(req), uuidParam(req.params))));

    // Liste d'attente
    const waitlistGuard = { preHandler: [options.requirePermission("admission.waitlist.manage"), ...feature("admissions.core"), ...feature("admissions.waitlist")] };
    scope.get("/waitlist", waitlistGuard, async (req) => unwrap(await getWaitlist(deps, ctxOf(req), parse(admissionsWaitlistQuerySchema, req.query))));
    // Q-A03 : le rang est une décision de la direction (permission dédiée, trace + audit + événement).
    const waitlistReorderGuard = { preHandler: [options.requirePermission("admission.waitlist.reorder"), ...feature("admissions.core"), ...feature("admissions.waitlist")] };
    scope.put("/waitlist/order", waitlistReorderGuard, async (req) => unwrap(await reorderWaitlist(deps, ctxOf(req), parse(admissionsWaitlistReorderBodySchema, req.body))));
    scope.post("/waitlist/promote", waitlistGuard, async (req) => unwrap(await promoteManually(deps, ctxOf(req), parse(admissionsPromoteBodySchema, req.body))));

    // Rapports
    scope.get("/reports/funnel", P("admission.report.read"), async (req) => {
      const q = parse(admissionsReportQuerySchema, req.query);
      return unwrap(await funnel(deps, ctxOf(req), q.campaignId, q.grade));
    });
    scope.get("/reports/capacity", P("admission.report.read"), async (req) => unwrap(await capacityReport(deps, ctxOf(req), parse(admissionsReportQuerySchema, req.query).campaignId)));
    scope.get("/reports/sla", P("admission.report.read"), async (req) => unwrap(await slaReport(deps, ctxOf(req), parse(admissionsReportQuerySchema, req.query).campaignId)));
    scope.get("/reports/sources", P("admission.report.read"), async (req) => unwrap(await sourcesReport(deps, ctxOf(req), parse(admissionsReportQuerySchema, req.query).campaignId)));
    scope.get("/reports/rejections", P("admission.report.read"), async (req) => unwrap(await rejectionsReport(deps, ctxOf(req), parse(admissionsReportQuerySchema, req.query).campaignId)));
  });
}

// ---------------------------------------------------------------------------
// Routes PUBLIQUES (sans authentification)
// ---------------------------------------------------------------------------

export interface PublicRoutesOptions {
  deps: AdmissionsDeps;
  rateLimiter?: RateLimiterLike;
  prefix: string;
}

/**
 * Routes publiques : encapsulées (gestionnaire d'erreurs, `no-store`, `noindex` propres). Toute erreur est NEUTRE : un lien
 * inconnu, désactivé, fermé ou sans texte de consentement répondent la même chose ; aucune capacité, aucun effectif, aucune place
 * restante ; jamais d'identifiant interne ; le code de suivi et les jetons ne figurent jamais dans l'URL.
 */
export async function registerPublicRoutes(app: FastifyInstance, options: PublicRoutesOptions): Promise<void> {
  const { deps } = options;
  await app.register(
    async (scope) => {
      scope.addHook("onSend", async (_req, reply, payload) => {
        void reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex, nofollow").header("Referrer-Policy", "no-referrer");
        return payload;
      });
      scope.setNotFoundHandler((_req, reply) => {
        void reply.status(404).send(PUBLIC_CLOSED_BODY);
      });
      scope.setErrorHandler((error, request, reply) => {
        const e = normalizeTransportError(error);
        const appError = e instanceof ZodError ? null : toAppError(e);
        // Réponse NEUTRE : aucun détail interne ; 5xx journalisé côté serveur uniquement.
        if (!appError || appError.httpStatus < 500) {
          if (appError?.code === AdmissionsCode.FILE_REJECTED) return void reply.status(413).send({ ...PUBLIC_INVALID_BODY, status: 413, message: "Le fichier n'a pas pu être reçu." });
          return void reply.status(400).send(PUBLIC_INVALID_BODY);
        }
        request.log.error({ err: error }, "admissions public : erreur inattendue");
        void reply.status(503).send({ status: 503, code: AdmissionsCode.PORT_UNAVAILABLE, kind: "internal", message: "Service momentanément indisponible. Réessayez dans un instant." });
      });
      if (!scope.hasContentTypeParser("multipart/form-data")) {
        await scope.register(multipart, { limits: { fileSize: deps.config.hardMaxFileBytes + 1, files: 1, fields: 8 } });
      }

      const limited = async (request: FastifyRequest, reply: FastifyReply, kind: keyof typeof PUBLIC_RATE): Promise<boolean> => {
        if (!options.rateLimiter) return false;
        const d = await options.rateLimiter.hit(`admissions:public:${kind}:${request.ip}`, PUBLIC_RATE[kind]);
        if (d.allowed) return false;
        void reply.status(429).header("Retry-After", String(Math.max(1, Math.ceil(d.retryAfterMs / 1000)))).send({ status: 429, code: AdmissionsCode.RATE_LIMITED, kind: "rate_limited", message: "Trop de requêtes. Réessayez dans une minute." });
        return true;
      };

      /** Sortie uniforme d'un `PublicOutcome`. */
      const reply_ = <T>(reply: FastifyReply, outcome: PublicOutcome<T>, onOk: (value: T) => unknown, successStatus = 200): FastifyReply => {
        switch (outcome.kind) {
          case "ok":
            return reply.status(successStatus).send(onOk(outcome.value));
          case "closed":
            return reply.status(404).send(PUBLIC_CLOSED_BODY);
          case "rate_limited":
            return reply.status(429).header("Retry-After", String(outcome.retryAfterSeconds)).send({ status: 429, code: AdmissionsCode.RATE_LIMITED, kind: "rate_limited", message: "Trop de dépôts depuis cette connexion. Réessayez plus tard." });
          case "invalid":
            return reply.status(400).send(PUBLIC_INVALID_BODY);
          case "error": {
            const status = outcome.error.httpStatus;
            if (status >= 500 || outcome.error.code === AdmissionsCode.PORT_UNAVAILABLE) return reply.status(503).send({ status: 503, code: AdmissionsCode.PORT_UNAVAILABLE, kind: "internal", message: "Service momentanément indisponible. Réessayez dans un instant." });
            if (outcome.error.code === AdmissionsCode.OFFER_EXPIRED) return reply.status(410).send({ status: 410, code: AdmissionsCode.OFFER_EXPIRED, kind: "conflict", message: "Cette proposition est arrivée à échéance. Contactez l'établissement." });
            if (outcome.error.code === AdmissionsCode.FILE_REJECTED) return reply.status(400).send({ ...PUBLIC_INVALID_BODY, code: AdmissionsCode.FILE_REJECTED, message: outcome.error.message });
            // Tout autre refus est neutre : le détail (doublon, état interne) n'est jamais exposé.
            return reply.status(409).send({ status: 409, code: "admissions.public_unavailable", kind: "conflict", message: "Votre demande n'a pas pu être traitée automatiquement : l'établissement vous contactera." });
          }
        }
      };

      scope.get("/forms/:slug", { config: { public: true } }, async (req, reply) => {
        if (await limited(req, reply, "read")) return reply;
        const slug = admissionsPublicSlugSchema.safeParse((req.params as { slug?: string }).slug);
        if (!slug.success) return reply.status(404).send(PUBLIC_CLOSED_BODY);
        return reply_(reply, await getPublicForm(deps, { slug: slug.data, ip: req.ip }), (v) => admissionsPublicFormDtoSchema.parse(v));
      });

      scope.post("/forms/:slug/applications", { config: { public: true }, bodyLimit: 64 * 1024 }, async (req, reply) => {
        if (await limited(req, reply, "submit")) return reply;
        const slug = admissionsPublicSlugSchema.safeParse((req.params as { slug?: string }).slug);
        if (!slug.success) return reply.status(404).send(PUBLIC_CLOSED_BODY);
        const body = admissionsPublicSubmitBodySchema.safeParse(req.body ?? {});
        if (!body.success) return reply.status(400).send(PUBLIC_INVALID_BODY);
        const outcome = await submitPublicApplication(deps, { slug: slug.data, body: body.data, ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "") });
        return reply_(reply, outcome, (v) => admissionsPublicSubmitResultDtoSchema.parse(v), 201);
      });

      scope.post("/track", { config: { public: true }, bodyLimit: 4 * 1024 }, async (req, reply) => {
        if (await limited(req, reply, "read")) return reply;
        const body = admissionsPublicTrackBodySchema.safeParse(req.body ?? {});
        if (!body.success) return reply.status(404).send(PUBLIC_CLOSED_BODY);
        return reply_(reply, await trackApplication(deps, body.data), (v) => admissionsPublicTrackDtoSchema.parse(v));
      });

      scope.post("/track/documents", { config: { public: true } }, async (req, reply) => {
        if (await limited(req, reply, "upload")) return reply;
        const up = await readUpload(req, deps.config.hardMaxFileBytes);
        const meta = z.object({ school: admissionsPublicSlugSchema, trackingCode: z.string().trim().min(8).max(40), requirementId: admissionsUuidSchema }).strict().safeParse(up.fields);
        if (!meta.success || !up.file) return reply.status(400).send(PUBLIC_INVALID_BODY);
        return reply_(reply, await uploadTrackedDocument(deps, { school: meta.data.school, trackingCode: meta.data.trackingCode, requirementId: meta.data.requirementId, fileName: up.file.fileName, bytes: up.file.bytes }), () => ({ received: true }), 201);
      });

      scope.post("/offers/view", { config: { public: true }, bodyLimit: 4 * 1024 }, async (req, reply) => {
        if (await limited(req, reply, "read")) return reply;
        const body = admissionsPublicOfferViewBodySchema.safeParse(req.body ?? {});
        if (!body.success) return reply.status(404).send(PUBLIC_CLOSED_BODY);
        return reply_(reply, await viewOfferPublic(deps, body.data), (v) => admissionsPublicOfferViewDtoSchema.parse(v));
      });

      scope.post("/offers/respond", { config: { public: true }, bodyLimit: 4 * 1024 }, async (req, reply) => {
        if (await limited(req, reply, "submit")) return reply;
        const body = admissionsPublicOfferRespondBodySchema.safeParse(req.body ?? {});
        if (!body.success) return reply.status(404).send(PUBLIC_CLOSED_BODY);
        const outcome = await respondOfferPublic(deps, body.data);
        return reply_(
          reply,
          outcome,
          (v) =>
            admissionsPublicOfferRespondDtoSchema.parse({
              status: v.status,
              message: v.status === "ACCEPTED" ? "Merci : votre acceptation est enregistrée. L'établissement vous indiquera les frais d'inscription à régler pour confirmer l'inscription." : "Votre réponse est enregistrée. La place sera proposée à une autre famille.",
            }),
        );
      });
    },
    { prefix: options.prefix },
  );
}

// ---------------------------------------------------------------------------
// Assemblage par le registre
// ---------------------------------------------------------------------------

function depsFromRuntime(app: FastifyInstance, runtime: ModuleRuntime): AdmissionsDeps {
  const env = runtime.env;
  const toNumber = (key: string): number | undefined => {
    const n = Number(env[key]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return createAdmissionsDeps({
    db: runtime.tenantDb,
    systemDb: runtime.systemDb,
    clock: runtime.clock,
    audit: admissionsAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => app.admissionsPorts.current,
    features: { isEnabled: (ctx, key) => runtime.entitlements.isFeatureEnabled(ctx, key) },
    config: {
      fingerprintSecret: env.ADMISSIONS_FINGERPRINT_SECRET && env.ADMISSIONS_FINGERPRINT_SECRET.length >= 16 ? env.ADMISSIONS_FINGERPRINT_SECRET : null,
      publicBaseUrl: (env.ADMISSIONS_PUBLIC_BASE_URL ?? env.V2_APP_BASE_URL ?? "").trim().replace(/\/+$/, "") || null,
      ...(toNumber("ADMISSIONS_MAX_FILE_BYTES") ? { hardMaxFileBytes: Math.min(toNumber("ADMISSIONS_MAX_FILE_BYTES") as number, 52_428_800) } : {}),
    },
  });
}

/** Instance RACINE : registre de ports et routes PUBLIQUES (`/api/v1/public/admissions/*`). */
export async function setup(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("admissionsPorts")) app.decorate("admissionsPorts", createAdmissionsPortRegistry());
  const deps = depsFromRuntime(app, runtime);
  await registerPublicRoutes(app, {
    deps,
    rateLimiter: runtime.rateLimiter as unknown as RateLimiterLike,
    prefix: "/api/v1/public/admissions",
  });
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/admissions`). */
export default async function admissionsModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("admissionsPorts")) app.decorate("admissionsPorts", createAdmissionsPortRegistry());
  await app.register(admissionsPlugin, {
    deps: depsFromRuntime(app, runtime),
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (key) => runtime.entitlements.requireFeature(key),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: runtime.rateLimiter as unknown as RateLimiterLike,
  });
}
