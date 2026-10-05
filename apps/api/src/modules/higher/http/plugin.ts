/**
 * Plugin Fastify du module higher — routes SANS préfixe (le registre applique `/api/v1/higher`, voir
 * `docs/architecture/platform-assembly.md`). Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la
 * RACINE avec le registre de ports (`app.higherPorts`) que `academic`, `people`, `results` et `reportcards` renseignent par
 * `registerHigherPorts(app, ports)` (le port des règles est branché sur `app.rules`, module rules, par défaut).
 *
 *  - Authentification : `request.ctx` posé en amont (iam v2 / legacy dérivé). L'identité vient du contexte, jamais d'un en-tête.
 *  - Autorisation : `requirePermission('higher.…')` du module rbac, jamais un rôle codé en dur ; les permissions sensibles
 *    (octroi, forçage, révocation, émission, signataires) exigent la MFA (garde rbac). L'enseignant n'a AUCUNE permission
 *    `higher.*` (parité 029) ; l'étudiant et le tuteur lié n'accèdent qu'à leurs données (`higher.self.read`,
 *    `higher.child.read` + lien de tutelle vérifié par le port `StudentDirectory`).
 *  - Entitlements : `requireFeature('higher.diplomas' | 'higher.session2' | 'higher.prerequisites' | 'higher.attestations')`.
 *  - Aucun `GET` n'écrit (hors évaluation de règles qui peut journaliser un échec côté rules).
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `higher.*` ; jamais de message interne.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { ForbiddenError, UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  higherAdvanceNumberingBodySchema,
  higherNumberingParamsSchema,
  higherUpdateNumberingBodySchema,
  higherAssignSlotBodySchema,
  higherAttestationRosterQuerySchema,
  higherAwardBodySchema,
  higherChildParamsSchema,
  higherCreateDiplomaBodySchema,
  higherCreateFromCurriculumBodySchema,
  higherCreditsQuerySchema,
  higherDiplomaStudentParamsSchema,
  higherIdParamsSchema,
  higherIssueAttestationBodySchema,
  higherIssueDocumentBodySchema,
  higherListAwardedQuerySchema,
  higherListDiplomasQuerySchema,
  higherListDocumentsQuerySchema,
  higherListResitWindowsQuerySchema,
  higherNodeParamsSchema,
  higherOpenResitWindowBodySchema,
  higherPrerequisitesCheckQuerySchema,
  higherReplaceRequirementsBodySchema,
  higherResitCandidatesQuerySchema,
  higherRevokeBodySchema,
  higherSetPrerequisitesBodySchema,
  higherStudentParamsSchema,
  higherUpdateDiplomaBodySchema,
  higherUpdateSettingsBodySchema,
} from "@ecoledigitale/contracts/src/v2/higher";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { awardDiploma, getAward, listAwards, recomputeDiploma, revokeAward } from "../application/awards";
import { createHigherDeps, type CallerCaps, type HigherDeps } from "../application/deps";
import {
  createDiploma,
  createDiplomaFromCurriculum,
  deleteDiploma,
  getDiploma,
  getStudentDiplomaProgress,
  listDiplomaCandidates,
  listDiplomas,
  replaceRequirements,
  syncDiplomaRequirements,
  updateDiploma,
} from "../application/diplomas";
import { assignSlot, getAttestationRoster, getDocument, issueAwardDocument, issueSuccessAttestation, listDocuments, listSlots, listStudentDocuments, publishDocument, revokeDocument } from "../application/documents";
import { getDocumentDownload, requestDocumentRender } from "../application/files";
import { getCreditSummary, getLedgerHistory, listDebts } from "../application/ledger";
import type { HigherPorts } from "../application/ports";
import { checkPrerequisites, getPrerequisites, setPrerequisites } from "../application/prerequisites";
import { closeResitWindow, getResitWindow, listResitCandidates, listResitWindows, listStudentResits, openResitWindow } from "../application/resit";
import { getHigherSettings, updateHigherSettings } from "../application/settings";
import { advanceNumbering, getNumbering, updateNumbering } from "../application/numbering";
import { getStudentDiplomaView, getStudentPathway } from "../application/student-view";
import { HigherCode, conflict, forbidden } from "../domain/errors";
import type { OfficialDocument, Uuid } from "../domain/types";
import { higherAuditAdapter } from "../infrastructure/audit-adapter";
import { createRulesAdapter, type RulesApiLike } from "../infrastructure/rules-adapter";
import { createPermissionKit, PERMISSIONS as P, type PermissionKit } from "./guards";
import * as present from "./presenters";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par academic, people, results, reportcards…)
// ---------------------------------------------------------------------------

export interface HigherPortRegistry {
  /** Enregistre (ou remplace) des ports ; les cas d'usage les relisent à chaque appel. */
  register(ports: Partial<HigherPorts>): void;
  readonly current: Partial<HigherPorts>;
}

export function createPortRegistry(initial: Partial<HigherPorts> = {}): HigherPortRegistry {
  let current: Partial<HigherPorts> = { ...initial };
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
    /** Registre des ports du module higher (posé par `setup`). */
    higherPorts: HigherPortRegistry;
  }
}

/** À appeler par les modules voisins (`academic`, `people`, `results`, `reportcards`) dans leur `setup(app, runtime)`. */
export function registerHigherPorts(app: FastifyInstance, ports: Partial<HigherPorts>): void {
  if (!app.hasDecorator("higherPorts")) app.decorate("higherPorts", createPortRegistry());
  app.higherPorts.register(ports);
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
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "higher.bad_request" });
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: "higher.payload_too_large" });
  }
  return error;
}

export interface HigherPluginOptions {
  deps: HigherDeps;
  /** Garde `requirePermission` du module rbac (`runtime.requirePermission`). */
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde `requireFeature` du module entitlements ; absente = toutes les features actives (tests autonomes). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
}

type Relation = "STAFF" | "SELF" | "CHILD";

export async function higherPlugin(app: FastifyInstance, options: HigherPluginOptions): Promise<void> {
  const { deps } = options;
  const kit: PermissionKit = createPermissionKit(options.requirePermission);
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = getRequestCtx(request);
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

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "higher : erreur inattendue");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    const caps = (req: FastifyRequest, reply: FastifyReply, keys: ReadonlyArray<keyof CallerCaps>): Promise<CallerCaps> => kit.capsFor(scope, req, reply, keys);

    /**
     * Qui est l'appelant par rapport à l'étudiant visé ? Personnel habilité (permission), l'étudiant lui-même
     * (`higher.self.read` + compte lié) ou son tuteur lié (`higher.child.read` + tutelle non révoquée). Sinon 403.
     */
    const relationTo = async (req: FastifyRequest, reply: FastifyReply, studentId: Uuid, staffPermission: string): Promise<Relation> => {
      if (await kit.has(scope, req, reply, staffPermission)) return "STAFF";
      const ctx = ctxOf(req);
      if (ctx.userId && (await kit.has(scope, req, reply, P.selfRead))) {
        const own = await deps.ports.students.getStudentIdForUser(ctx, ctx.userId);
        if (own === studentId) return "SELF";
      }
      if (ctx.userId && (await kit.has(scope, req, reply, P.childRead)) && (await deps.ports.students.isGuardianOf(ctx, { userId: ctx.userId, studentId }))) return "CHILD";
      throw new ForbiddenError("Action non autorisée.");
    };

    // ===== Diplômes (définitions) ==============================================================================
    const diplomas = feature("higher.diplomas");

    scope.get("/diplomas", { preHandler: [...diplomas, kit.require(P.diplomaRead)] }, async (req) => {
      const q = parse(higherListDiplomasQuerySchema, req.query);
      return { items: unwrapOrThrow(await listDiplomas(deps, ctxOf(req), q)).map(present.diplomaDto) };
    });

    scope.post("/diplomas", { preHandler: [...diplomas, kit.require(P.diplomaManage)] }, async (req, reply) => {
      const b = parse(higherCreateDiplomaBodySchema, req.body);
      return reply.status(201).send(present.diplomaDetailDto(unwrapOrThrow(await createDiploma(deps, ctxOf(req), b))));
    });

    scope.post("/diplomas/from-curriculum", { preHandler: [...diplomas, kit.require(P.diplomaManage)] }, async (req, reply) => {
      const b = parse(higherCreateFromCurriculumBodySchema, req.body);
      return reply.status(201).send(present.diplomaDetailDto(unwrapOrThrow(await createDiplomaFromCurriculum(deps, ctxOf(req), b))));
    });

    scope.get("/diplomas/:id", { preHandler: [...diplomas, kit.require(P.diplomaRead)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return present.diplomaDetailDto(unwrapOrThrow(await getDiploma(deps, ctxOf(req), id)));
    });

    scope.patch("/diplomas/:id", { preHandler: [...diplomas, kit.require(P.diplomaManage)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      const b = parse(higherUpdateDiplomaBodySchema, req.body);
      return present.diplomaDto(unwrapOrThrow(await updateDiploma(deps, ctxOf(req), { definitionId: id, ...b })));
    });

    scope.delete("/diplomas/:id", { preHandler: [...diplomas, kit.require(P.diplomaManage)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return unwrapOrThrow(await deleteDiploma(deps, ctxOf(req), id));
    });

    scope.get("/diplomas/:id/requirements", { preHandler: [...diplomas, kit.require(P.diplomaRead)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      const d = unwrapOrThrow(await getDiploma(deps, ctxOf(req), id));
      return { items: d.requirements.map(present.requirementDto), requirementsCredits: d.requirementsCredits };
    });

    scope.put("/diplomas/:id/requirements", { preHandler: [...diplomas, kit.require(P.diplomaManage)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      const b = parse(higherReplaceRequirementsBodySchema, req.body);
      return present.diplomaDetailDto(unwrapOrThrow(await replaceRequirements(deps, ctxOf(req), { definitionId: id, requirements: b.requirements })));
    });

    scope.post("/diplomas/:id/sync", { preHandler: [...diplomas, kit.require(P.diplomaManage)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return present.syncReportDto(unwrapOrThrow(await syncDiplomaRequirements(deps, ctxOf(req), id)));
    });

    scope.get("/diplomas/:id/candidates", { preHandler: [...diplomas, kit.require(P.diplomaRead)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return { items: unwrapOrThrow(await listDiplomaCandidates(deps, ctxOf(req), id)).map(present.candidateDto) };
    });

    scope.get("/diplomas/:id/students/:studentId/progress", { preHandler: [...diplomas, kit.require(P.diplomaRead)] }, async (req) => {
      const { id, studentId } = parse(higherDiplomaStudentParamsSchema, req.params);
      return present.progressViewDto(unwrapOrThrow(await getStudentDiplomaProgress(deps, ctxOf(req), { definitionId: id, studentId })));
    });

    // ===== Octrois =============================================================================================
    scope.get("/diplomas/:id/awarded", { preHandler: [...diplomas, kit.require(P.awardRead)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      const q = parse(higherListAwardedQuerySchema, req.query);
      const page = unwrapOrThrow(await listAwards(deps, ctxOf(req), { definitionId: id, ...q }));
      return { items: page.items.map(present.awardDto), nextCursor: page.nextCursor };
    });

    scope.post("/diplomas/:id/awards", { preHandler: [...diplomas, kit.require(P.awardCreate)] }, async (req, reply) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      const b = parse(higherAwardBodySchema, req.body);
      const c = await caps(req, reply, ["forceAward"]);
      const r = unwrapOrThrow(await awardDiploma(deps, ctxOf(req), { definitionId: id, studentId: b.studentId, via: "MANUAL", force: b.force, reason: b.reason, reawardDecision: b.reawardDecision, caps: c }));
      if (r.status !== "AWARDED") throw conflict(HigherCode.NOT_ELIGIBLE, "Octroi non réalisé.", { reason: r.reason }); // jamais pour MANUAL : chaque condition non remplie est déjà une erreur
      return reply.status(201).send({ award: present.awardDto(r.award) });
    });

    scope.post("/diplomas/:id/recompute", { preHandler: [...diplomas, kit.require(P.awardCreate)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return present.recomputeDto(unwrapOrThrow(await recomputeDiploma(deps, ctxOf(req), id)));
    });

    scope.get("/awards/:id", { preHandler: [...diplomas, kit.require(P.awardRead)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return { award: present.awardDto(unwrapOrThrow(await getAward(deps, ctxOf(req), id))) };
    });

    scope.post("/awards/:id/revoke", { preHandler: [...diplomas, kit.require(P.awardRevoke)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      const b = parse(higherRevokeBodySchema, req.body);
      return { award: present.awardDto(unwrapOrThrow(await revokeAward(deps, ctxOf(req), { awardId: id, reason: b.reason }))) };
    });

    // ===== Documents officiels =================================================================================
    scope.post("/awards/:id/documents", { preHandler: [...diplomas, kit.require(P.documentIssue)] }, async (req, reply) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      const b = parse(higherIssueDocumentBodySchema, req.body);
      const r = unwrapOrThrow(await issueAwardDocument(deps, ctxOf(req), { awardId: id, kind: b.kind, duplicate: b.duplicate }));
      return reply.status(r.created ? 201 : 200).send(present.issuedDocumentDto(r));
    });

    const attestations = feature("higher.attestations");
    scope.get("/attestations/roster", { preHandler: [...attestations, kit.require(P.diplomaRead)] }, async (req) => {
      const q = parse(higherAttestationRosterQuerySchema, req.query);
      return { items: unwrapOrThrow(await getAttestationRoster(deps, ctxOf(req), q)).map(present.rosterRowDto) };
    });

    scope.post("/attestations", { preHandler: [...attestations, kit.require(P.documentIssue)] }, async (req, reply) => {
      const b = parse(higherIssueAttestationBodySchema, req.body);
      const r = unwrapOrThrow(await issueSuccessAttestation(deps, ctxOf(req), b));
      return reply.status(r.created ? 201 : 200).send(present.issuedDocumentDto(r));
    });

    scope.get("/documents", { preHandler: [...diplomas, kit.require(P.documentRead)] }, async (req) => {
      const q = parse(higherListDocumentsQuerySchema, req.query);
      const page = unwrapOrThrow(await listDocuments(deps, ctxOf(req), q));
      return { items: page.items.map(present.documentDto), nextCursor: page.nextCursor };
    });

    /**
     * Document accessible à l'appelant. Personnel habilité : tout document (404 si inconnu). Autre appelant : un document
     * inconnu et un document d'autrui se ressemblent (403) — aucune énumération possible ; étudiant / tuteur : ses documents
     * PUBLIÉS seulement (AC7.5).
     */
    const accessibleDocument = async (req: FastifyRequest, reply: FastifyReply, id: Uuid): Promise<OfficialDocument> => {
      const ctx = ctxOf(req);
      const staff = await kit.has(scope, req, reply, P.documentRead);
      const found = await getDocument(deps, ctx, id);
      if (!found.ok) {
        if (staff) throw found.error;
        throw new ForbiddenError("Action non autorisée.");
      }
      const doc = found.value;
      if (staff) return doc;
      const relation = await relationTo(req, reply, doc.studentId, P.documentRead);
      if (relation !== "STAFF" && !doc.publishedAt) throw new ForbiddenError("Ce document n'est pas encore publié.");
      return doc;
    };

    scope.get("/documents/:id", async (req, reply) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return present.documentDetailDto(await accessibleDocument(req, reply, id));
    });

    // PDF : URL signée à durée courte (PDF prêt) ou état du rendu (`PENDING` / `RENDERING` / `FAILED`) ; même contrôle d'accès
    // que la lecture du document ; l'émission de l'URL est auditée ; un document révoqué n'est plus servi (409).
    scope.get("/documents/:id/pdf", async (req, reply) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      await accessibleDocument(req, reply, id);
      const download = unwrapOrThrow(await getDocumentDownload(deps, ctxOf(req), id));
      if (download.status !== "READY") void reply.status(202);
      return download;
    });

    // Reprise explicite du scellement et du rendu (PDF en échec ou jamais produit).
    scope.post("/documents/:id/render", { preHandler: [...diplomas, kit.require(P.documentIssue)] }, async (req, reply) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return reply.status(202).send(present.documentDto(unwrapOrThrow(await requestDocumentRender(deps, ctxOf(req), id))));
    });

    scope.post("/documents/:id/publish", { preHandler: [...diplomas, kit.require(P.documentIssue)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return present.documentDto(unwrapOrThrow(await publishDocument(deps, ctxOf(req), id)));
    });

    scope.post("/documents/:id/revoke", { preHandler: [...diplomas, kit.require(P.awardRevoke)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      const b = parse(higherRevokeBodySchema, req.body);
      return present.documentDto(unwrapOrThrow(await revokeDocument(deps, ctxOf(req), { documentId: id, reason: b.reason })));
    });

    // ===== Signataires datés ===================================================================================
    scope.get("/document-slots", { preHandler: [...diplomas, kit.anyOf(P.slotManage, P.documentRead)] }, async (req) => ({
      items: unwrapOrThrow(await listSlots(deps, ctxOf(req))).map(present.slotDto),
    }));
    scope.put("/document-slots", { preHandler: [...diplomas, kit.require(P.slotManage)] }, async (req) => {
      const b = parse(higherAssignSlotBodySchema, req.body);
      return present.slotDto(unwrapOrThrow(await assignSlot(deps, ctxOf(req), b)));
    });

    // ===== Crédits et progression d'un étudiant ===============================================================
    const creditsOf = async (req: FastifyRequest, studentId: Uuid) => {
      const q = parse(higherCreditsQuerySchema, req.query);
      const ctx = ctxOf(req);
      const summary = unwrapOrThrow(await getCreditSummary(deps, ctx, studentId));
      const history = unwrapOrThrow(await getLedgerHistory(deps, ctx, studentId, q));
      const debts = unwrapOrThrow(await listDebts(deps, ctx, studentId));
      return {
        summary: present.creditSummaryDto(summary),
        entries: history.items.map(present.ledgerEntryDto),
        debts: debts.map(present.debtDto),
        nextCursor: history.nextCursor,
      };
    };

    scope.get("/students/:id/credits", async (req, reply) => {
      const { id } = parse(higherStudentParamsSchema, req.params);
      await relationTo(req, reply, id, P.creditsRead);
      return creditsOf(req, id);
    });

    scope.get("/students/:id/diplomas", async (req, reply) => {
      const { id } = parse(higherStudentParamsSchema, req.params);
      await relationTo(req, reply, id, P.diplomaRead);
      return present.studentDiplomasDto(unwrapOrThrow(await getStudentDiplomaView(deps, ctxOf(req), id)));
    });

    scope.get("/students/:id/pathway", async (req, reply) => {
      const { id } = parse(higherStudentParamsSchema, req.params);
      await relationTo(req, reply, id, P.creditsRead);
      return present.pathwayDto(unwrapOrThrow(await getStudentPathway(deps, ctxOf(req), id)));
    });

    scope.get("/students/:id/prerequisites-check", { preHandler: [...feature("higher.prerequisites"), kit.require(P.creditsRead)] }, async (req) => {
      const { id } = parse(higherStudentParamsSchema, req.params);
      const q = parse(higherPrerequisitesCheckQuerySchema, req.query);
      return present.prerequisiteCheckDto(unwrapOrThrow(await checkPrerequisites(deps, ctxOf(req), { studentId: id, ueNodeId: q.nodeId })));
    });

    // ===== Prérequis ===========================================================================================
    const prerequisites = feature("higher.prerequisites");
    scope.get("/ue/:nodeId/prerequisites", { preHandler: [...prerequisites, kit.anyOf(P.prerequisiteManage, P.creditsRead)] }, async (req) => {
      const { nodeId } = parse(higherNodeParamsSchema, req.params);
      return { items: unwrapOrThrow(await getPrerequisites(deps, ctxOf(req), nodeId)).map(present.prerequisiteDto) };
    });
    scope.put("/ue/:nodeId/prerequisites", { preHandler: [...prerequisites, kit.require(P.prerequisiteManage)] }, async (req) => {
      const { nodeId } = parse(higherNodeParamsSchema, req.params);
      const b = parse(higherSetPrerequisitesBodySchema, req.body);
      const r = unwrapOrThrow(
        await setPrerequisites(deps, ctxOf(req), {
          ueNodeId: nodeId,
          prerequisites: b.prerequisites.map((p) => ({ prerequisiteNodeId: p.prerequisiteNodeId, mode: p.mode, minAverage: p.minAverage === undefined ? undefined : String(p.minAverage) })),
        }),
      );
      return { prerequisites: r.prerequisites.map(present.prerequisiteDto), warnings: r.warnings.map(present.prerequisiteWarningDto) };
    });

    // ===== Rattrapage (session 2) ==============================================================================
    const session2 = feature("higher.session2");
    scope.get("/resit-windows", { preHandler: [...session2, kit.require(P.resitManage)] }, async (req) => {
      const q = parse(higherListResitWindowsQuerySchema, req.query);
      const page = unwrapOrThrow(await listResitWindows(deps, ctxOf(req), { classroomId: q.classroomId, academicPeriodId: q.periodId, status: q.status, limit: q.limit, cursor: q.cursor }));
      return { items: page.items.map(present.resitWindowDto), nextCursor: page.nextCursor };
    });
    scope.post("/resit-windows", { preHandler: [...session2, kit.require(P.resitManage)] }, async (req, reply) => {
      const b = parse(higherOpenResitWindowBodySchema, req.body);
      const r = unwrapOrThrow(await openResitWindow(deps, ctxOf(req), b));
      return reply.status(201).send({ window: present.resitWindowDto(r.window), registrations: r.registrations.map(present.resitRegistrationDto), alreadyRegistered: r.alreadyRegistered });
    });
    scope.get("/resit-windows/:id", { preHandler: [...session2, kit.require(P.resitManage)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      const r = unwrapOrThrow(await getResitWindow(deps, ctxOf(req), id));
      return { window: present.resitWindowDto(r.window), registrations: r.registrations.map(present.resitRegistrationDto) };
    });
    scope.post("/resit-windows/:id/close", { preHandler: [...session2, kit.require(P.resitManage)] }, async (req) => {
      const { id } = parse(higherIdParamsSchema, req.params);
      return present.resitWindowDto(unwrapOrThrow(await closeResitWindow(deps, ctxOf(req), { windowId: id })));
    });
    scope.get("/resit-candidates", { preHandler: [...session2, kit.require(P.resitManage)] }, async (req) => {
      const q = parse(higherResitCandidatesQuerySchema, req.query);
      const r = unwrapOrThrow(await listResitCandidates(deps, ctxOf(req), { classroomId: q.classroomId, academicPeriodId: q.periodId }));
      return { stateId: r.stateId, candidates: r.candidates.map((c) => ({ ...c })) };
    });

    // ===== Étudiant et tuteur ==================================================================================
    const ownStudentId = async (req: FastifyRequest): Promise<Uuid> => {
      const ctx = ctxOf(req);
      const own = ctx.userId ? await deps.ports.students.getStudentIdForUser(ctx, ctx.userId) : null;
      if (!own) throw new UnauthorizedError("Aucun profil d'étudiant n'est lié à votre compte.");
      return own;
    };
    const guardedChild = async (req: FastifyRequest): Promise<Uuid> => {
      const { studentId } = parse(higherChildParamsSchema, req.params);
      const ctx = ctxOf(req);
      if (!ctx.userId || !(await deps.ports.students.isGuardianOf(ctx, { userId: ctx.userId, studentId }))) throw forbidden(HigherCode.NOT_GUARDIAN, "Cet étudiant n'est pas lié à votre compte.");
      return studentId;
    };

    scope.get("/me/credits", { preHandler: kit.require(P.selfRead) }, async (req) => creditsOf(req, await ownStudentId(req)));
    scope.get("/me/pathway", { preHandler: kit.require(P.selfRead) }, async (req) => present.pathwayDto(unwrapOrThrow(await getStudentPathway(deps, ctxOf(req), await ownStudentId(req)))));
    scope.get("/me/diplomas", { preHandler: kit.require(P.selfRead) }, async (req) => present.studentDiplomasDto(unwrapOrThrow(await getStudentDiplomaView(deps, ctxOf(req), await ownStudentId(req)))));
    scope.get("/me/resits", { preHandler: kit.require(P.selfRead) }, async (req) => ({ items: unwrapOrThrow(await listStudentResits(deps, ctxOf(req), await ownStudentId(req))).map(present.studentResitDto) }));
    scope.get("/me/documents", { preHandler: kit.require(P.selfRead) }, async (req) => ({ items: unwrapOrThrow(await listStudentDocuments(deps, ctxOf(req), await ownStudentId(req), true)).map(present.documentDto) }));

    scope.get("/children/:studentId/credits", { preHandler: kit.require(P.childRead) }, async (req) => creditsOf(req, await guardedChild(req)));
    scope.get("/children/:studentId/pathway", { preHandler: kit.require(P.childRead) }, async (req) => present.pathwayDto(unwrapOrThrow(await getStudentPathway(deps, ctxOf(req), await guardedChild(req)))));
    scope.get("/children/:studentId/diplomas", { preHandler: kit.require(P.childRead) }, async (req) => present.studentDiplomasDto(unwrapOrThrow(await getStudentDiplomaView(deps, ctxOf(req), await guardedChild(req)))));
    scope.get("/children/:studentId/resits", { preHandler: kit.require(P.childRead) }, async (req) => ({ items: unwrapOrThrow(await listStudentResits(deps, ctxOf(req), await guardedChild(req))).map(present.studentResitDto) }));
    scope.get("/children/:studentId/documents", { preHandler: kit.require(P.childRead) }, async (req) => ({ items: unwrapOrThrow(await listStudentDocuments(deps, ctxOf(req), await guardedChild(req), true)).map(present.documentDto) }));

    // ===== Réglages ============================================================================================
    scope.get("/settings", { preHandler: kit.require(P.settingsManage) }, async (req) => unwrapOrThrow(await getHigherSettings(deps, ctxOf(req))));
    scope.put("/settings", { preHandler: kit.require(P.settingsManage) }, async (req) => {
      const b = parse(higherUpdateSettingsBodySchema, req.body);
      return unwrapOrThrow(await updateHigherSettings(deps, ctxOf(req), b));
    });

    // ===== Numérotation libre des diplômes et attestations (Q-24) ==============================================
    scope.get("/numbering", { preHandler: kit.require(P.settingsManage) }, async (req) => ({ items: unwrapOrThrow(await getNumbering(deps, ctxOf(req))).map(present.numberingDto) }));
    scope.put("/numbering/:counterKey", { preHandler: kit.require(P.settingsManage) }, async (req) => {
      const { counterKey } = parse(higherNumberingParamsSchema, req.params);
      const b = parse(higherUpdateNumberingBodySchema, req.body);
      return present.numberingDto(unwrapOrThrow(await updateNumbering(deps, ctxOf(req), counterKey, b)));
    });
    scope.post("/numbering/:counterKey/advance", { preHandler: kit.require(P.settingsManage) }, async (req) => {
      const { counterKey } = parse(higherNumberingParamsSchema, req.params);
      const b = parse(higherAdvanceNumberingBodySchema, req.body);
      return present.numberingDto(unwrapOrThrow(await advanceNumbering(deps, ctxOf(req), counterKey, b)));
    });
  });
}

// ---------------------------------------------------------------------------
// Contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

/** Instance RACINE : pose le registre de ports que les modules voisins renseignent (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("higherPorts")) app.decorate("higherPorts", createPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/higher`). */
export default async function higherModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("higherPorts")) app.decorate("higherPorts", createPortRegistry());
  // Le port des règles est branché par défaut sur l'API publique du module rules (`app.rules`, posée par son `setup`) ;
  // un module peut le remplacer par `registerHigherPorts(app, { rules })`.
  const rulesPort = createRulesAdapter(() => (app as unknown as { rules?: RulesApiLike }).rules);
  const deps = createHigherDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: higherAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => ({ rules: rulesPort, ...app.higherPorts.current }),
  });
  await app.register(higherPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
  });
}
