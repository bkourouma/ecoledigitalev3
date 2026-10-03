/**
 * Plugin Fastify du module "councils" (conseil de classe, procès-verbal, orientation), chargé automatiquement par le registre sous
 * `/api/v1/councils`.
 *
 * Contrat d'assemblage (platform/runtime.ts) : `export default async function (app, runtime)` ; routes SANS préfixe ;
 * `setup(app, runtime)` pose le registre de ports (échec fermé tant que la plateforme n'a rien branché).
 *
 *  - Chaque route est gardée par une permission du manifeste (rbac) ; les décisions contextuelles (périmètre d'un enseignant, permission
 *    propre à un acte) sont prises par les cas d'usage à partir des capacités de l'appelant.
 *  - Aucun `GET` n'écrit (sauf l'URL signée du PV, qui est journalisée). Réponses `Cache-Control: no-store`.
 *  - Décideur, résolveur, signataire, approbateur d'un déverrouillage : toujours l'utilisateur de la session (`runtime.resolveContext`),
 *    jamais un champ de la requête ; un contexte non humain est refusé (`councils.human_decision_required`).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import * as C from "@ecoledigitale/contracts/src/v2/councils";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createCouncilsDeps, type CallerCaps, type CouncilsDeps } from "../application/deps";
import type { CouncilsPorts } from "../application/ports";
import { createCouncilsPortRegistry, type CouncilsPortRegistry } from "../application/port-registry";
import { bundledTemplatePort } from "../templates";
import { getAgenda, getAgendaItemDetail, prepareCouncil, rebuildAgendaItem, reviewAgendaItem } from "../application/agenda";
import { addParticipant, cancelCouncil, closeCouncil, convokeCouncil, createCouncil, getCouncilDetail, listCouncilsView, listParticipantsView, listProposedParticipants, openCouncil, patchParticipant, removeParticipant, setPresence, updateCouncil } from "../application/councils";
import { addProposal, listDecisionsView, listProposalsView, recordDecision, resolveProposal, withdrawDecision } from "../application/deliberation";
import { applyEffect, listEffectsOfCouncilView, listEffectsView, planCouncilEffects, retryEffect, revertEffect, skipEffect } from "../application/effects";
import { addPaperSignature, generateMinutes, getMinutesDetail, getMinutesPdf, listMinutesView, revokeMinutes, signMinutes } from "../application/minutes";
import { getChildOrientation, getMyOrientation } from "../application/family-orientation";
import { addWish, applyTransfer, cancelTransfer, createFile, createTransfer, listFilesView, listPathsView, listTransfersView, recordConsent, upsertPath } from "../application/orientation";
import { getChildDecisions, getClassroomSummary, getMyDecisions, listEventsView } from "../application/reads";
import { getReference, upsertCouncilType, upsertDecisionType, upsertRole, upsertSettings } from "../application/reference";
import { approveUnlock, listUnlockRequests, reopenCouncil, rejectUnlock, requestUnlock } from "../application/unlock";
import { councilsAuditAdapter } from "../infrastructure/audit-adapter";
import { createPermissionKit, PERMISSIONS as P, type PermissionKit } from "./guards";

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module councils (posé par `setup`). */
    councilsPorts: CouncilsPortRegistry;
  }
}

/** À appeler par la plateforme (`platform/adapters`) : branche les ports ; ordre de chargement indifférent. */
export function registerCouncilsPorts(app: FastifyInstance, ports: Partial<CouncilsPorts>): void {
  if (!app.hasDecorator("councilsPorts")) app.decorate("councilsPorts", createCouncilsPortRegistry());
  app.councilsPorts.register(ports);
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
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "councils.bad_request" });
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: "councils.payload_too_large" });
  }
  return error;
}

const idOf = (req: FastifyRequest, key = "id"): string => parse(C.councilsUuidSchema, (req.params as Record<string, string>)[key]);

export interface CouncilsPluginOptions {
  deps: CouncilsDeps;
  /** Garde `requirePermission` du module rbac (`runtime.requirePermission`). */
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde `requireFeature` du module entitlements ; absente = toutes les features actives (tests autonomes). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
}

export async function councilsPlugin(app: FastifyInstance, options: CouncilsPluginOptions): Promise<void> {
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
      if (appError.httpStatus >= 500) request.log.error({ err: error }, "councils : erreur inattendue");
      void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
    });
    // Contenu privé (mineurs, délibérations) : jamais mis en cache.
    scope.addHook("onSend", async (_req, reply) => {
      void reply.header("Cache-Control", "no-store");
    });
    const caps = (req: FastifyRequest, reply: FastifyReply): Promise<CallerCaps> => kit.capsFor(scope, req, reply);
    const core = feature("councils.core");
    const orientationFeature = feature("councils.orientation");
    const viewers = kit.anyOf(P.read, P.manage, P.proposalWrite);
    const staffViewers = kit.anyOf(P.read, P.manage);

    // ===== Référentiels (données d'établissement) ============================================================
    scope.get("/reference", { preHandler: [...core, kit.anyOf(P.read, P.manage, P.settingsManage, P.proposalWrite)] }, async (req) => unwrapOrThrow(await getReference(deps, ctxOf(req))));
    scope.get("/participant-roles", { preHandler: [...core, kit.anyOf(P.read, P.manage, P.settingsManage, P.proposalWrite)] }, async (req) => ({ items: unwrapOrThrow(await getReference(deps, ctxOf(req))).roles }));
    scope.get("/council-types", { preHandler: [...core, kit.anyOf(P.read, P.manage, P.settingsManage, P.proposalWrite)] }, async (req) => ({ items: unwrapOrThrow(await getReference(deps, ctxOf(req))).councilTypes }));
    scope.get("/decision-types", { preHandler: [...core, kit.anyOf(P.read, P.manage, P.settingsManage, P.proposalWrite)] }, async (req) => ({ items: unwrapOrThrow(await getReference(deps, ctxOf(req))).decisionTypes }));
    scope.get("/settings", { preHandler: [...core, kit.anyOf(P.read, P.manage, P.settingsManage)] }, async (req) => ({ items: unwrapOrThrow(await getReference(deps, ctxOf(req))).settings }));
    scope.put("/participant-roles", { preHandler: [...core, kit.require(P.settingsManage)] }, async (req) => unwrapOrThrow(await upsertRole(deps, ctxOf(req), parse(C.councilsParticipantRoleInputSchema, req.body))));
    scope.put("/council-types", { preHandler: [...core, kit.require(P.settingsManage)] }, async (req) => unwrapOrThrow(await upsertCouncilType(deps, ctxOf(req), parse(C.councilsCouncilTypeInputSchema, req.body))));
    scope.put("/decision-types", { preHandler: [...core, kit.require(P.settingsManage)] }, async (req) => unwrapOrThrow(await upsertDecisionType(deps, ctxOf(req), parse(C.councilsDecisionTypeInputSchema, req.body))));
    scope.put("/settings", { preHandler: [...core, kit.require(P.settingsManage)] }, async (req) => unwrapOrThrow(await upsertSettings(deps, ctxOf(req), parse(C.councilsSettingsInputSchema, req.body))));

    // ===== Séances ===========================================================================================
    scope.get("/councils", { preHandler: [...core, viewers] }, async (req, reply) => unwrapOrThrow(await listCouncilsView(deps, ctxOf(req), await caps(req, reply), parse(C.councilsListQuerySchema, req.query))));
    scope.post("/councils", { preHandler: [...core, kit.require(P.manage)] }, async (req, reply) => reply.status(201).send(unwrapOrThrow(await createCouncil(deps, ctxOf(req), parse(C.councilsCreateSchema, req.body)))));
    scope.get("/councils/:id", { preHandler: [...core, viewers] }, async (req, reply) => unwrapOrThrow(await getCouncilDetail(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.patch("/councils/:id", { preHandler: [...core, kit.require(P.manage)] }, async (req) => unwrapOrThrow(await updateCouncil(deps, ctxOf(req), idOf(req), parse(C.councilsUpdateSchema, req.body))));
    scope.post("/councils/:id/prepare", { preHandler: [...core, kit.anyOf(P.prepare, P.manage)] }, async (req, reply) => {
      parse(C.councilsPrepareSchema, req.body);
      return unwrapOrThrow(await prepareCouncil(deps, ctxOf(req), await caps(req, reply), idOf(req)));
    });
    scope.post("/councils/:id/convoke", { preHandler: [...core, kit.require(P.manage)] }, async (req) => unwrapOrThrow(await convokeCouncil(deps, ctxOf(req), idOf(req), parse(C.councilsConvokeSchema, req.body))));
    scope.post("/councils/:id/open", { preHandler: [...core, kit.require(P.sessionRun)] }, async (req, reply) => unwrapOrThrow(await openCouncil(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsOpenSchema, req.body))));
    scope.post("/councils/:id/close", { preHandler: [...core, kit.require(P.sessionRun)] }, async (req, reply) => {
      parse(C.councilsCloseSchema, req.body);
      return unwrapOrThrow(await closeCouncil(deps, ctxOf(req), await caps(req, reply), idOf(req)));
    });
    scope.post("/councils/:id/cancel", { preHandler: [...core, kit.require(P.manage)] }, async (req) => unwrapOrThrow(await cancelCouncil(deps, ctxOf(req), idOf(req), parse(C.councilsCancelSchema, req.body))));

    // ===== Participants ======================================================================================
    scope.get("/councils/:id/proposed-participants", { preHandler: [...core, staffViewers] }, async (req, reply) => ({ items: unwrapOrThrow(await listProposedParticipants(deps, ctxOf(req), await caps(req, reply), idOf(req))) }));
    scope.get("/councils/:id/participants", { preHandler: [...core, viewers] }, async (req, reply) => ({ items: unwrapOrThrow(await listParticipantsView(deps, ctxOf(req), await caps(req, reply), idOf(req))) }));
    scope.post("/councils/:id/participants", { preHandler: [...core, kit.require(P.manage)] }, async (req, reply) => reply.status(201).send(unwrapOrThrow(await addParticipant(deps, ctxOf(req), idOf(req), parse(C.councilsParticipantInputSchema, req.body)))));
    scope.patch("/councils/:id/participants/:pid", { preHandler: [...core, kit.require(P.manage)] }, async (req) => unwrapOrThrow(await patchParticipant(deps, ctxOf(req), idOf(req), idOf(req, "pid"), parse(C.councilsParticipantPatchSchema, req.body))));
    scope.delete("/councils/:id/participants/:pid", { preHandler: [...core, kit.require(P.manage)] }, async (req, reply) => {
      unwrapOrThrow(await removeParticipant(deps, ctxOf(req), idOf(req), idOf(req, "pid")));
      return reply.status(204).send();
    });
    scope.post("/councils/:id/participants/:pid/presence", { preHandler: [...core, kit.require(P.manage)] }, async (req) => unwrapOrThrow(await setPresence(deps, ctxOf(req), idOf(req), idOf(req, "pid"), parse(C.councilsPresenceInputSchema, req.body).presence)));

    // ===== Ordre du jour, propositions, décisions ============================================================
    scope.get("/councils/:id/agenda", { preHandler: [...core, viewers] }, async (req, reply) => unwrapOrThrow(await getAgenda(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.get("/agenda/:itemId", { preHandler: [...core, viewers] }, async (req, reply) => unwrapOrThrow(await getAgendaItemDetail(deps, ctxOf(req), await caps(req, reply), idOf(req, "itemId"))));
    scope.post("/agenda/:itemId/rebuild", { preHandler: [...core, kit.anyOf(P.prepare, P.manage)] }, async (req, reply) => unwrapOrThrow(await rebuildAgendaItem(deps, ctxOf(req), await caps(req, reply), idOf(req, "itemId"))));
    scope.post("/agenda/:itemId/review", { preHandler: [...core, kit.anyOf(P.prepare, P.manage)] }, async (req, reply) => unwrapOrThrow(await reviewAgendaItem(deps, ctxOf(req), await caps(req, reply), idOf(req, "itemId"))));
    scope.get("/agenda/:itemId/proposals", { preHandler: [...core, viewers] }, async (req, reply) => ({ items: unwrapOrThrow(await listProposalsView(deps, ctxOf(req), await caps(req, reply), idOf(req, "itemId"))) }));
    scope.post("/agenda/:itemId/proposals", { preHandler: [...core, kit.anyOf(P.proposalWrite, P.decisionRecord)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await addProposal(deps, ctxOf(req), await caps(req, reply), idOf(req, "itemId"), parse(C.councilsProposalInputSchema, req.body)))),
    );
    for (const [action, status] of [["accept", "ACCEPTED"], ["reject", "REJECTED"], ["withdraw", "WITHDRAWN"]] as const) {
      scope.post(`/proposals/:id/${action}`, { preHandler: [...core, kit.require(P.decisionRecord)] }, async (req, reply) => unwrapOrThrow(await resolveProposal(deps, ctxOf(req), await caps(req, reply), idOf(req), status, parse(C.councilsProposalResolveSchema, req.body))));
    }
    scope.get("/agenda/:itemId/decisions", { preHandler: [...core, viewers] }, async (req, reply) => ({ items: unwrapOrThrow(await listDecisionsView(deps, ctxOf(req), await caps(req, reply), idOf(req, "itemId"))) }));
    scope.post("/agenda/:itemId/decisions", { preHandler: [...core, kit.require(P.decisionRecord)] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await recordDecision(deps, ctxOf(req), await caps(req, reply), idOf(req, "itemId"), parse(C.councilsDecisionInputSchema, req.body)))),
    );
    scope.post("/decisions/:id/withdraw", { preHandler: [...core, kit.require(P.decisionRecord)] }, async (req, reply) => unwrapOrThrow(await withdrawDecision(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsDecisionWithdrawSchema, req.body))));

    // ===== Procès-verbal et signatures =======================================================================
    scope.get("/councils/:id/minutes", { preHandler: [...core, kit.require(P.minutesRead)] }, async (req, reply) => unwrapOrThrow(await listMinutesView(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.post("/councils/:id/minutes", { preHandler: [...core, kit.require(P.minutesGenerate)] }, async (req, reply) => {
      parse(C.councilsMinutesGenerateSchema, req.body);
      return reply.status(201).send(unwrapOrThrow(await generateMinutes(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    });
    scope.get("/minutes/:id", { preHandler: [...core, kit.require(P.minutesRead)] }, async (req, reply) => unwrapOrThrow(await getMinutesDetail(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.get("/minutes/:id/pdf", { preHandler: [...core, kit.require(P.minutesRead)] }, async (req, reply) => unwrapOrThrow(await getMinutesPdf(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.post("/minutes/:id/sign", { preHandler: [...core, kit.require(P.minutesSign)] }, async (req, reply) => {
      parse(C.councilsSignSchema, req.body);
      return unwrapOrThrow(await signMinutes(deps, ctxOf(req), await caps(req, reply), idOf(req)));
    });
    scope.post("/minutes/:id/signatures/paper", { preHandler: [...core, kit.require(P.minutesSign)] }, async (req, reply) => unwrapOrThrow(await addPaperSignature(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsPaperSignatureSchema, req.body))));
    scope.post("/minutes/:id/revoke", { preHandler: [...core, kit.require(P.minutesRevoke)] }, async (req, reply) => unwrapOrThrow(await revokeMinutes(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsMinutesRevokeSchema, req.body))));

    // ===== Déverrouillage motivé =============================================================================
    scope.get("/councils/:id/unlock-requests", { preHandler: [...core, kit.anyOf(P.read, P.manage, P.unlockRequest, P.unlockApprove)] }, async (req, reply) => unwrapOrThrow(await listUnlockRequests(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.post("/councils/:id/unlock-requests", { preHandler: [...core, kit.require(P.unlockRequest)] }, async (req, reply) => reply.status(201).send(unwrapOrThrow(await requestUnlock(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsUnlockRequestSchema, req.body)))));
    scope.post("/unlock-requests/:id/approve", { preHandler: [...core, kit.require(P.unlockApprove)] }, async (req, reply) => unwrapOrThrow(await approveUnlock(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsUnlockApproveSchema, req.body))));
    scope.post("/unlock-requests/:id/reject", { preHandler: [...core, kit.require(P.unlockApprove)] }, async (req, reply) => unwrapOrThrow(await rejectUnlock(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsUnlockRejectSchema, req.body))));
    scope.post("/councils/:id/reopen", { preHandler: [...core, kit.require(P.unlockApprove)] }, async (req, reply) => {
      parse(C.councilsReopenSchema, req.body);
      return unwrapOrThrow(await reopenCouncil(deps, ctxOf(req), await caps(req, reply), idOf(req)));
    });

    // ===== Effets (file idempotente ; l'exclusion n'est appliquée que par un humain habilité) =================
    const effectActors = kit.anyOf(P.effectManage, P.exclusionApply);
    scope.get("/councils/:id/effects", { preHandler: [...core, kit.anyOf(P.read, P.manage, P.effectManage, P.exclusionApply)] }, async (req, reply) => unwrapOrThrow(await listEffectsOfCouncilView(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.get("/effects", { preHandler: [...core, effectActors] }, async (req) => unwrapOrThrow(await listEffectsView(deps, ctxOf(req), parse(C.councilsEffectListQuerySchema, req.query))));
    scope.post("/councils/:id/effects/plan", { preHandler: [...core, kit.require(P.effectManage)] }, async (req) => unwrapOrThrow(await planCouncilEffects(deps, ctxOf(req), idOf(req))));
    scope.post("/effects/:id/retry", { preHandler: [...core, effectActors] }, async (req, reply) => {
      parse(C.councilsEffectActionSchema, req.body);
      return unwrapOrThrow(await retryEffect(deps, ctxOf(req), await caps(req, reply), idOf(req)));
    });
    scope.post("/effects/:id/apply", { preHandler: [...core, effectActors] }, async (req, reply) => {
      parse(C.councilsEffectActionSchema, req.body);
      return unwrapOrThrow(await applyEffect(deps, ctxOf(req), await caps(req, reply), idOf(req)));
    });
    scope.post("/effects/:id/skip", { preHandler: [...core, effectActors] }, async (req, reply) => unwrapOrThrow(await skipEffect(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsEffectActionSchema, req.body))));
    scope.post("/effects/:id/revert", { preHandler: [...core, effectActors] }, async (req, reply) => unwrapOrThrow(await revertEffect(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsEffectRevertSchema, req.body))));
    scope.get("/councils/:id/events", { preHandler: [...core, staffViewers] }, async (req, reply) => unwrapOrThrow(await listEventsView(deps, ctxOf(req), await caps(req, reply), idOf(req))));

    // ===== Orientation et transferts de série =================================================================
    const orientationViewers = kit.anyOf(P.orientationRead, P.orientationManage);
    scope.get("/orientation-paths", { preHandler: [...core, ...orientationFeature, orientationViewers] }, async (req) => unwrapOrThrow(await listPathsView(deps, ctxOf(req))));
    scope.put("/orientation-paths", { preHandler: [...core, ...orientationFeature, kit.require(P.orientationManage)] }, async (req) => unwrapOrThrow(await upsertPath(deps, ctxOf(req), parse(C.councilsOrientationPathInputSchema, req.body))));
    scope.get("/orientation-files", { preHandler: [...core, ...orientationFeature, orientationViewers] }, async (req) => unwrapOrThrow(await listFilesView(deps, ctxOf(req), parse(C.councilsOrientationFileListQuerySchema, req.query))));
    scope.post("/orientation-files", { preHandler: [...core, ...orientationFeature, kit.require(P.orientationManage)] }, async (req, reply) => reply.status(201).send(unwrapOrThrow(await createFile(deps, ctxOf(req), parse(C.councilsOrientationFileCreateSchema, req.body)))));
    scope.post("/orientation-files/:id/wishes", { preHandler: [...core, ...orientationFeature, kit.anyOf(P.orientationManage, P.childRead)] }, async (req, reply) => unwrapOrThrow(await addWish(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsWishInputSchema, req.body))));
    scope.post("/orientation-files/:id/consent", { preHandler: [...core, ...orientationFeature, kit.anyOf(P.orientationManage, P.childRead)] }, async (req, reply) => unwrapOrThrow(await recordConsent(deps, ctxOf(req), await caps(req, reply), idOf(req), parse(C.councilsConsentInputSchema, req.body))));
    scope.get("/series-transfers", { preHandler: [...core, ...orientationFeature, orientationViewers] }, async (req) => {
      const q = (req.query ?? {}) as { enrollmentId?: string; status?: string };
      return unwrapOrThrow(await listTransfersView(deps, ctxOf(req), { enrollmentId: q.enrollmentId, status: q.status }));
    });
    scope.post("/series-transfers", { preHandler: [...core, ...orientationFeature, kit.require(P.orientationManage)] }, async (req, reply) => reply.status(201).send(unwrapOrThrow(await createTransfer(deps, ctxOf(req), await caps(req, reply), parse(C.councilsSeriesTransferInputSchema, req.body)))));
    scope.post("/series-transfers/:id/apply", { preHandler: [...core, ...orientationFeature, kit.require(P.orientationManage)] }, async (req) => unwrapOrThrow(await applyTransfer(deps, ctxOf(req), idOf(req), parse(C.councilsTransferApplySchema, req.body))));
    scope.post("/series-transfers/:id/cancel", { preHandler: [...core, ...orientationFeature, kit.require(P.orientationManage)] }, async (req) => unwrapOrThrow(await cancelTransfer(deps, ctxOf(req), idOf(req), parse(C.councilsTransferCancelSchema, req.body))));

    // ===== Synthèse de classe et portails ====================================================================
    scope.get("/classrooms/:id/council-summary", { preHandler: [...core, staffViewers] }, async (req, reply) => unwrapOrThrow(await getClassroomSummary(deps, ctxOf(req), await caps(req, reply), idOf(req))));
    scope.get("/me/decisions", { preHandler: [...core, kit.require(P.selfRead)] }, async (req, reply) => unwrapOrThrow(await getMyDecisions(deps, ctxOf(req), await caps(req, reply))));
    scope.get("/children/:studentId/decisions", { preHandler: [...core, kit.require(P.childRead)] }, async (req, reply) => unwrapOrThrow(await getChildDecisions(deps, ctxOf(req), await caps(req, reply), idOf(req, "studentId"))));
    // Dossier d'orientation vu par la famille (lien tuteur relu ; 404 hors lien) et par l'élève (son compte, lecture seule) : jamais de notes
    // internes, de décision non visible, d'avis du personnel ni de données d'un autre élève (`application/family-orientation.ts`).
    scope.get("/children/:studentId/orientation", { preHandler: [...core, ...orientationFeature, kit.require(P.childRead)] }, async (req, reply) => unwrapOrThrow(await getChildOrientation(deps, ctxOf(req), await caps(req, reply), idOf(req, "studentId"))));
    scope.get("/me/orientation", { preHandler: [...core, ...orientationFeature, kit.require(P.selfRead)] }, async (req, reply) => unwrapOrThrow(await getMyOrientation(deps, ctxOf(req), await caps(req, reply))));
  });
}

// ---------------------------------------------------------------------------
// Contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

/** Instance RACINE : pose le registre de ports que la plateforme renseigne (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("councilsPorts")) app.decorate("councilsPorts", createCouncilsPortRegistry({ templates: bundledTemplatePort }));
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/councils`). */
export default async function councilsModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("councilsPorts")) app.decorate("councilsPorts", createCouncilsPortRegistry({ templates: bundledTemplatePort }));
  const deps = createCouncilsDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: councilsAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => app.councilsPorts.current,
  });
  await app.register(councilsPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
  });
}
