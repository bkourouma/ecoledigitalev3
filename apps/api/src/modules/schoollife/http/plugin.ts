/**
 * Plugin Fastify du module "schoollife" (vie scolaire), chargé automatiquement par le registre sous `/api/v1/schoollife`.
 *
 * Contrat d'assemblage (platform/runtime.ts) : `export default async function (app, runtime)` ; routes SANS préfixe ;
 * `setup(app, runtime)` pose le registre de ports (échec fermé tant que la plateforme n'a rien branché).
 *
 *  - Chaque route est gardée par une permission du manifeste (rbac) ; les décisions contextuelles (habilitation de
 *    confidentialité, portée générale, permission d'approbation d'un TYPE) sont prises par les cas d'usage à partir des
 *    capacités de l'appelant.
 *  - Aucun `GET` n'écrit (sauf la lecture confidentielle, qui est un POST journalisé). Réponses `Cache-Control: no-store`.
 *  - Acteur, déclarant, proposant, validateur : toujours l'utilisateur de la session (`runtime.resolveContext`), jamais un
 *    champ de la requête ; un contexte non humain est refusé (`schoollife.human_actor_required`).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import * as C from "@ecoledigitale/contracts/src/v2/schoollife";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createSchoolLifeDeps, type CallerCaps, type SchoolLifeDeps } from "../application/deps";
import type { SchoolLifePorts } from "../application/ports";
import { adjustConduct, activateScale, createScale, getStudentConduct, listScalesView, retireScale, setScaleItems } from "../application/conduct";
import { listConfidentialReadsView, readConfidential } from "../application/confidential";
import { acknowledgeConvocation, cancelConvocation, createConvocation, holdConvocation, listConvocationsView, markConvocationMissed, rescheduleConvocation, sendConvocation } from "../application/convocations";
import { getClassroomSummary, getDashboard, getFamilyLife, getStudentLife, listMyChildren } from "../application/dossier";
import { applyEffect, listEffectsView, revertEffect, skipEffect } from "../application/effects";
import { addInvolvement, closeIncident, confirmIncident, declareIncident, dismissIncident, getIncidentView, listIncidentsView, raiseIncidentConfidentiality, reviewIncident } from "../application/incidents";
import { cancelMeasure, decideAppeal, executeMeasure, fileAppeal, getMeasureView, listMeasuresView, notifyMeasure, proposeMeasure, rejectMeasure, revokeMeasure, validateMeasure, withdrawAppeal } from "../application/measures";
import { createNote, listNotesView, withdrawNote } from "../application/notes";
import { getReference, upsertEventType, upsertSettings, upsertSeverity } from "../application/reference";
import { schoollifeAuditAdapter } from "../infrastructure/audit-adapter";
import { createPermissionKit, PERMISSIONS as P, type PermissionKit } from "./guards";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par la plateforme : academic, people, attendance, notifications)
// ---------------------------------------------------------------------------

export interface SchoolLifePortRegistry {
  register(ports: Partial<SchoolLifePorts>): void;
  readonly current: Partial<SchoolLifePorts>;
}

export function createPortRegistry(initial: Partial<SchoolLifePorts> = {}): SchoolLifePortRegistry {
  let current: Partial<SchoolLifePorts> = { ...initial };
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
    /** Registre des ports du module schoollife (posé par `setup`). */
    schoollifePorts: SchoolLifePortRegistry;
  }
}

/** À appeler par la plateforme (`platform/adapters`) : branche les ports ; ordre de chargement indifférent. */
export function registerSchoolLifePorts(app: FastifyInstance, ports: Partial<SchoolLifePorts>): void {
  if (!app.hasDecorator("schoollifePorts")) app.decorate("schoollifePorts", createPortRegistry());
  app.schoollifePorts.register(ports);
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Clé d'idempotence portée par l'en-tête `Idempotency-Key` (équivalent du champ `clientKey`). */
function headerKey(req: { headers: Record<string, unknown> }): string | undefined {
  const v = req.headers["idempotency-key"];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

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
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "schoollife.bad_request" });
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: "schoollife.payload_too_large" });
  }
  return error;
}

const idParams = C.schoollifeUuidSchema;
const idOf = (req: FastifyRequest, key = "id"): string => parse(idParams, (req.params as Record<string, string>)[key]);

export interface SchoolLifePluginOptions {
  deps: SchoolLifeDeps;
  /** Garde `requirePermission` du module rbac (`runtime.requirePermission`). */
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde `requireFeature` du module entitlements ; absente = toutes les features actives (tests autonomes). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
}

export async function schoollifePlugin(app: FastifyInstance, options: SchoolLifePluginOptions): Promise<void> {
  const { deps } = options;
  const kit: PermissionKit = createPermissionKit(options.requirePermission);
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
    if (!ctx) throw new UnauthorizedError();
    return ctx;
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

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
      if (appError.httpStatus >= 500) request.log.error({ err: error }, "schoollife : erreur inattendue");
      void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
    });
    // Contenu privé (mineurs, discipline) : jamais mis en cache.
    scope.addHook("onSend", async (_req, reply) => {
      void reply.header("Cache-Control", "no-store");
    });
    const caps = (req: FastifyRequest, reply: FastifyReply): Promise<CallerCaps> => kit.capsFor(scope, req, reply);
    const core = feature("schoollife.core");
    const conductFeature = feature("schoollife.conduct-points");
    const convocationFeature = feature("schoollife.convocations");
    const staffRead = kit.anyOf(P.read, P.readAll);

    // ===== Paramètres ========================================================================================
    scope.get("/reference", { preHandler: [...core, kit.anyOf(P.read, P.readAll, P.settingsManage)] }, async (req) => unwrapOrThrow(await getReference(deps, ctxOf(req))));
    scope.get("/settings", { preHandler: [...core, kit.anyOf(P.read, P.readAll, P.settingsManage)] }, async (req) => ({ items: unwrapOrThrow(await getReference(deps, ctxOf(req))).settings }));
    scope.get("/severity-levels", { preHandler: [...core, kit.anyOf(P.read, P.readAll, P.settingsManage)] }, async (req) => ({ items: unwrapOrThrow(await getReference(deps, ctxOf(req))).severityLevels }));
    scope.get("/event-types", { preHandler: [...core, kit.anyOf(P.read, P.readAll, P.settingsManage)] }, async (req) => ({ items: unwrapOrThrow(await getReference(deps, ctxOf(req))).eventTypes }));
    scope.put("/settings", { preHandler: [...core, kit.require(P.settingsManage)] }, async (req) => unwrapOrThrow(await upsertSettings(deps, ctxOf(req), parse(C.schoollifeSettingsInputSchema, req.body))));
    scope.put("/severity-levels", { preHandler: [...core, kit.require(P.settingsManage)] }, async (req) => unwrapOrThrow(await upsertSeverity(deps, ctxOf(req), parse(C.schoollifeSeverityInputSchema, req.body))));
    scope.put("/event-types", { preHandler: [...core, kit.require(P.settingsManage)] }, async (req) => unwrapOrThrow(await upsertEventType(deps, ctxOf(req), parse(C.schoollifeEventTypeInputSchema, req.body))));

    // ===== Incidents =========================================================================================
    scope.get("/incidents", { preHandler: [...core, staffRead] }, async (req, reply) => {
      const q = parse(C.schoollifeIncidentListQuerySchema, req.query);
      return { items: unwrapOrThrow(await listIncidentsView(deps, ctxOf(req), await caps(req, reply), q)) };
    });
    scope.get("/incidents/:id", { preHandler: [...core, staffRead] }, async (req, reply) => unwrapOrThrow(await getIncidentView(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.post("/incidents", { preHandler: [...core, kit.require(P.incidentWrite)] }, async (req, reply) => {
      const body = parse(C.schoollifeIncidentCreateSchema, { ...(req.body as object | undefined), ...(headerKey(req) && !(req.body as { clientKey?: unknown } | undefined)?.clientKey ? { clientKey: headerKey(req) } : {}) });
      let replayed = false;
      const dto = unwrapOrThrow(await declareIncident(deps, ctxOf(req), await caps(req, reply), body, { onReplay: () => { replayed = true; } }));
      // Rejeu d'une saisie déjà enregistrée : 200 (et non 201), même corps.
      return reply.status(replayed ? 200 : 201).header("Idempotent-Replay", replayed ? "true" : "false").send(dto);
    });
    scope.post("/incidents/:id/involvements", { preHandler: [...core, kit.require(P.incidentWrite)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await addInvolvement(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeInvolvementInputSchema, req.body)))),
    );
    scope.post("/incidents/:id/review", { preHandler: [...core, kit.require(P.incidentReview)] }, async (req, reply) =>
      unwrapOrThrow(await reviewIncident(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeIncidentReviewSchema, req.body))),
    );
    scope.post("/incidents/:id/confirm", { preHandler: [...core, kit.require(P.incidentReview)] }, async (req, reply) => {
      parse(C.schoollifeIncidentConfirmSchema, req.body);
      return unwrapOrThrow(await confirmIncident(deps, ctxOf(req), await caps(req, reply), idOf(req)));
    });
    scope.post("/incidents/:id/dismiss", { preHandler: [...core, kit.require(P.incidentReview)] }, async (req, reply) =>
      unwrapOrThrow(await dismissIncident(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeIncidentResolveSchema, req.body))),
    );
    scope.post("/incidents/:id/close", { preHandler: [...core, kit.require(P.incidentReview)] }, async (req, reply) =>
      unwrapOrThrow(await closeIncident(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeIncidentResolveSchema, req.body))),
    );
    scope.post("/incidents/:id/confidentiality", { preHandler: [...core, kit.require(P.incidentReview)] }, async (req, reply) =>
      unwrapOrThrow(await raiseIncidentConfidentiality(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeIncidentRaiseConfidentialitySchema, req.body).confidentiality)),
    );

    // ===== Mesures et recours ================================================================================
    const decide = kit.anyOf(P.measureValidate, P.exclusionValidate);
    scope.get("/measures", { preHandler: [...core, staffRead] }, async (req, reply) => ({ items: unwrapOrThrow(await listMeasuresView(deps, ctxOf(req), await caps(req, reply), parse(C.schoollifeMeasureListQuerySchema, req.query))) }));
    scope.get("/measures/:id", { preHandler: [...core, staffRead] }, async (req, reply) => unwrapOrThrow(await getMeasureView(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.post("/measures", { preHandler: [...core, kit.require(P.measurePropose)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await proposeMeasure(deps, ctxOf(req), await caps(req, reply), parse(C.schoollifeMeasureProposeSchema, req.body)))),
    );
    scope.post("/measures/:id/validate", { preHandler: [...core, decide] }, async (req, reply) => unwrapOrThrow(await validateMeasure(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeMeasureValidateSchema, req.body))));
    scope.post("/measures/:id/reject", { preHandler: [...core, decide] }, async (req, reply) => unwrapOrThrow(await rejectMeasure(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeMeasureRejectSchema, req.body))));
    scope.post("/measures/:id/cancel", { preHandler: [...core, kit.anyOf(P.measurePropose, P.measureValidate, P.exclusionValidate)] }, async (req, reply) =>
      unwrapOrThrow(await cancelMeasure(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeMeasureCancelSchema, req.body))),
    );
    scope.post("/measures/:id/notify", { preHandler: [...core, decide] }, async (req, reply) => {
      parse(C.schoollifeMeasureNotifySchema, req.body);
      return unwrapOrThrow(await notifyMeasure(deps, ctxOf(req), await caps(req, reply), idOf(req)));
    });
    scope.post("/measures/:id/execute", { preHandler: [...core, kit.anyOf(P.measurePropose, P.measureValidate, P.exclusionValidate)] }, async (req, reply) => {
      parse(C.schoollifeMeasureExecuteSchema, req.body);
      return unwrapOrThrow(await executeMeasure(deps, ctxOf(req), await caps(req, reply), idOf(req)));
    });
    scope.post("/measures/:id/revoke", { preHandler: [...core, kit.require(P.measureRevoke)] }, async (req, reply) =>
      unwrapOrThrow(await revokeMeasure(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeMeasureRevokeSchema, req.body))),
    );
    scope.post("/measures/:id/appeals", { preHandler: [...core, kit.anyOf(P.appealFile, P.childAppeal, P.selfAppeal)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await fileAppeal(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeAppealFileSchema, req.body)))),
    );
    scope.post("/appeals/:id/uphold", { preHandler: [...core, kit.require(P.appealDecide)] }, async (req, reply) =>
      unwrapOrThrow(await decideAppeal(deps, ctxOf(req), await caps(req, reply), idOf(req), { outcome: "UPHELD", ...parse(C.schoollifeAppealDecideSchema, req.body) })),
    );
    scope.post("/appeals/:id/overturn", { preHandler: [...core, kit.require(P.appealDecide)] }, async (req, reply) =>
      unwrapOrThrow(await decideAppeal(deps, ctxOf(req), await caps(req, reply), idOf(req), { outcome: "OVERTURNED", ...parse(C.schoollifeAppealDecideSchema, req.body) })),
    );
    scope.post("/appeals/:id/withdraw", { preHandler: [...core, kit.anyOf(P.appealFile, P.childAppeal, P.selfAppeal)] }, async (req) => {
      parse(C.schoollifeAppealWithdrawSchema, req.body);
      return unwrapOrThrow(await withdrawAppeal(deps, ctxOf(req), idOf(req)));
    });

    // ===== Effets d'une exclusion (acte humain) ==============================================================
    scope.get("/measure-effects", { preHandler: [...core, kit.require(P.exclusionApply)] }, async (req) => ({ items: unwrapOrThrow(await listEffectsView(deps, ctxOf(req), parse(C.schoollifeEffectListQuerySchema, req.query))) }));
    scope.post("/measure-effects/:id/apply", { preHandler: [...core, kit.require(P.exclusionApply)] }, async (req, reply) =>
      unwrapOrThrow(await applyEffect(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeEffectApplySchema, req.body))),
    );
    scope.post("/measure-effects/:id/skip", { preHandler: [...core, kit.require(P.exclusionApply)] }, async (req, reply) =>
      unwrapOrThrow(await skipEffect(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeEffectSkipSchema, req.body))),
    );
    scope.post("/measure-effects/:id/revert", { preHandler: [...core, kit.require(P.exclusionApply)] }, async (req, reply) =>
      unwrapOrThrow(await revertEffect(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeEffectRevertSchema, req.body))),
    );

    // ===== Encouragements et observations ====================================================================
    scope.get("/notes", { preHandler: [...core, staffRead] }, async (req, reply) => ({ items: unwrapOrThrow(await listNotesView(deps, ctxOf(req), await caps(req, reply), parse(C.schoollifeNoteListQuerySchema, req.query))) }));
    scope.post("/notes", { preHandler: [...core, kit.require(P.noteWrite)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await createNote(deps, ctxOf(req), await caps(req, reply), parse(C.schoollifeNoteCreateSchema, req.body)))),
    );
    scope.post("/notes/:id/withdraw", { preHandler: [...core, kit.anyOf(P.noteWrite, P.incidentReview)] }, async (req, reply) =>
      unwrapOrThrow(await withdrawNote(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeNoteWithdrawSchema, req.body))),
    );

    // ===== Convocations ======================================================================================
    scope.get("/convocations", { preHandler: [...core, ...convocationFeature, staffRead] }, async (req, reply) => ({ items: unwrapOrThrow(await listConvocationsView(deps, ctxOf(req), await caps(req, reply), parse(C.schoollifeConvocationListQuerySchema, req.query))) }));
    scope.post("/convocations", { preHandler: [...core, ...convocationFeature, kit.require(P.convocationManage)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await createConvocation(deps, ctxOf(req), await caps(req, reply), parse(C.schoollifeConvocationCreateSchema, req.body)))),
    );
    scope.post("/convocations/:id/send", { preHandler: [...core, ...convocationFeature, kit.require(P.convocationManage)] }, async (req, reply) =>
      unwrapOrThrow(await sendConvocation(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeConvocationSendSchema, req.body))),
    );
    scope.post("/convocations/:id/acknowledge", { preHandler: [...core, ...convocationFeature, kit.require(P.childAcknowledge)] }, async (req, reply) =>
      unwrapOrThrow(await acknowledgeConvocation(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeConvocationAcknowledgeSchema, req.body))),
    );
    scope.post("/convocations/:id/hold", { preHandler: [...core, ...convocationFeature, kit.require(P.convocationManage)] }, async (req, reply) =>
      unwrapOrThrow(await holdConvocation(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeConvocationHoldSchema, req.body))),
    );
    scope.post("/convocations/:id/no-show", { preHandler: [...core, ...convocationFeature, kit.require(P.convocationManage)] }, async (req, reply) =>
      unwrapOrThrow(await markConvocationMissed(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeConvocationNoShowSchema, req.body))),
    );
    scope.post("/convocations/:id/cancel", { preHandler: [...core, ...convocationFeature, kit.require(P.convocationManage)] }, async (req, reply) =>
      unwrapOrThrow(await cancelConvocation(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeConvocationCancelSchema, req.body))),
    );
    scope.post("/convocations/:id/reschedule", { preHandler: [...core, ...convocationFeature, kit.require(P.convocationManage)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await rescheduleConvocation(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.schoollifeConvocationRescheduleSchema, req.body)))),
    );

    // ===== Barèmes de conduite (paramètres) ==================================================================
    scope.get("/conduct-scales", { preHandler: [...core, ...conductFeature, kit.anyOf(P.conductManage, P.read, P.readAll)] }, async (req) => {
      const q = (req.query ?? {}) as { institutionId?: string; status?: string };
      return { items: unwrapOrThrow(await listScalesView(deps, ctxOf(req), { institutionId: q.institutionId, status: q.status })) };
    });
    scope.post("/conduct-scales", { preHandler: [...core, ...conductFeature, kit.require(P.conductManage)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await createScale(deps, ctxOf(req), parse(C.schoollifeScaleCreateSchema, req.body)))),
    );
    scope.put("/conduct-scales/:id/items", { preHandler: [...core, ...conductFeature, kit.require(P.conductManage)] }, async (req) =>
      unwrapOrThrow(await setScaleItems(deps, ctxOf(req), idOf(req), parse(C.schoollifeScaleItemsSchema, req.body).items)),
    );
    scope.post("/conduct-scales/:id/activate", { preHandler: [...core, ...conductFeature, kit.require(P.conductManage)] }, async (req) => {
      parse(C.schoollifeScaleActivateSchema, req.body);
      return unwrapOrThrow(await activateScale(deps, ctxOf(req), idOf(req)));
    });
    scope.post("/conduct-scales/:id/retire", { preHandler: [...core, ...conductFeature, kit.require(P.conductManage)] }, async (req) =>
      unwrapOrThrow(await retireScale(deps, ctxOf(req), idOf(req), parse(C.schoollifeScaleRetireSchema, req.body))),
    );
    scope.post("/conduct-movements", { preHandler: [...core, ...conductFeature, kit.require(P.conductAdjust)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await adjustConduct(deps, ctxOf(req), await caps(req, reply), parse(C.schoollifeManualAdjustmentSchema, req.body)))),
    );
    scope.get("/students/:id/conduct", { preHandler: [...core, ...conductFeature, staffRead] }, async (req, reply) => {
      const q = parse(C.schoollifeConductQuerySchema, req.query);
      return unwrapOrThrow(await getStudentConduct(deps, ctxOf(req), await caps(req, reply), { studentId: idOf(req), academicYearId: q.academicYearId, periodId: q.periodId }));
    });

    // ===== Lectures confidentielles (journalisées) ===========================================================
    scope.post("/confidential-reads", { preHandler: [...core, kit.require(P.confidentialRead)] }, async (req, reply) =>
      unwrapOrThrow(await readConfidential(deps, ctxOf(req), await caps(req, reply), parse(C.schoollifeConfidentialReadSchema, req.body))),
    );
    scope.get("/confidential-reads", { preHandler: [...core, kit.require(P.confidentialAudit)] }, async (req) => ({ items: unwrapOrThrow(await listConfidentialReadsView(deps, ctxOf(req), parse(C.schoollifeConfidentialReadsQuerySchema, req.query))) }));

    // ===== Dossier, synthèses, tableau de bord ===============================================================
    scope.get("/students/:id/life", { preHandler: [...core, staffRead] }, async (req, reply) => {
      const q = parse(C.schoollifeLifeQuerySchema, req.query);
      return unwrapOrThrow(await getStudentLife(deps, ctxOf(req), await caps(req, reply), { studentId: idOf(req), ...q }));
    });
    scope.get("/students/:id/absences", { preHandler: [...core, staffRead] }, async (req, reply) => {
      const q = parse(C.schoollifeLifeQuerySchema, req.query);
      const life = unwrapOrThrow(await getStudentLife(deps, ctxOf(req), await caps(req, reply), { studentId: idOf(req), ...q }));
      return life.attendance;
    });
    scope.get("/classrooms/:id/summary", { preHandler: [...core, staffRead] }, async (req, reply) => unwrapOrThrow(await getClassroomSummary(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.get("/dashboard", { preHandler: [...core, kit.require(P.readAll)] }, async (req, reply) => unwrapOrThrow(await getDashboard(deps, ctxOf(req), await caps(req, reply), parse(C.schoollifeDashboardQuerySchema, req.query))));

    // ===== Portails ==========================================================================================
    scope.get("/me/life", { preHandler: [...core, kit.require(P.selfRead)] }, async (req, reply) => unwrapOrThrow(await getFamilyLife(deps, ctxOf(req), await caps(req, reply), { audience: "STUDENT" })));
    scope.get("/me/children", { preHandler: [...core, kit.require(P.childRead)] }, async (req) => ({ items: unwrapOrThrow(await listMyChildren(deps, ctxOf(req))) }));
    scope.get("/children/:studentId/life", { preHandler: [...core, kit.require(P.childRead)] }, async (req, reply) =>
      unwrapOrThrow(await getFamilyLife(deps, ctxOf(req), await caps(req, reply), { audience: "GUARDIAN", studentId: idOf(req, "studentId") })),
    );
  });
}

// ---------------------------------------------------------------------------
// Contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

/** Instance RACINE : pose le registre de ports que la plateforme renseigne (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("schoollifePorts")) app.decorate("schoollifePorts", createPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/schoollife`). */
export default async function schoollifeModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("schoollifePorts")) app.decorate("schoollifePorts", createPortRegistry());
  const deps = createSchoolLifeDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: schoollifeAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => app.schoollifePorts.current,
  });
  await app.register(schoollifePlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
  });
}
