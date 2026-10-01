/**
 * Plugin Fastify du module reportcards — routes SANS préfixe (le registre applique `/api/v1/reportcards`, voir
 * `docs/architecture/platform-assembly.md`). Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la
 * RACINE avec le registre de ports (`app.reportcardsPorts`, renseigné par results, people, attendance, finance) et publie
 * les routes PUBLIQUES de vérification (`/api/v1/public/verify/*`, `/.well-known/ecoledigitale-keys.json`).
 *
 *  - Authentification : `request.ctx` posé en amont (iam v2 / legacy dérivé). L'identité vient du contexte, jamais d'un
 *    en-tête client ; la RELATION (élève, tuteur lié) est vérifiée par les cas d'usage via les ports, à chaque requête.
 *  - Autorisation : `requirePermission('reportcard.…')` du module rbac, jamais un rôle codé en dur ; les permissions
 *    sensibles (émission, publication, révocation, identité, signataires) exigent la MFA (garde rbac).
 *  - Entitlements : `requireFeature('reportcard.transcript')` ; la vérification publique contrôle la feature du tenant propriétaire.
 *  - Routes publiques : `config: { public: true }`, limitées à 30 requêtes/minute/IP, réponses uniformes, `no-store`.
 *  - Plateforme : `/platform/*` exige le JWT super-admin (`runtime.superAdminAuthorizer`), séparé du JWT tenant.
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `reportcards.*` ; jamais de message interne.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  reportcardsAssetUploadBodySchema,
  reportcardsChildParamsSchema,
  reportcardsClassPeriodParamsSchema,
  reportcardsCreateBatchBodySchema,
  reportcardsCreateSignatoryBodySchema,
  reportcardsCreateTranscriptBodySchema,
  reportcardsFamilyListQuerySchema,
  reportcardsIdParamsSchema,
  reportcardsKeyParamsSchema,
  reportcardsListQuerySchema,
  reportcardsPatchSignatoryBodySchema,
  reportcardsPreflightQuerySchema,
  reportcardsPreviewBodySchema,
  reportcardsPublicVerifyParamsSchema,
  reportcardsPublishBatchBodySchema,
  reportcardsPublishPlatformTemplateBodySchema,
  reportcardsPutBrandingBodySchema,
  reportcardsPutTemplateConfigBodySchema,
  reportcardsReasonBodySchema,
  reportcardsReissueBodySchema,
  reportcardsSettingsBodySchema,
  reportcardsTemplateConfigQuerySchema,
} from "@ecoledigitale/contracts/src/v2/reportcards";
import type { ModuleRuntime, RuntimeAuditPort } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { createReportcardsDeps, type ReportcardsDeps } from "../application/deps";
import { createTranscript, createBatch, getBatchView, preflight, reissueReportCard } from "../application/issue";
import { publishMany, publishReportCard, revokeReportCard, withdrawReportCard } from "../application/lifecycle";
import { ensureBuiltinTemplates, listAllPlatformTemplates, listPublicKeys, publishPlatformTemplate, retireSigningKey } from "../application/platform";
import type { ReportcardsPorts } from "../application/ports";
import { getCombinedPdfUrl, getDownloadUrl, getExplain, getReportCard, listForFamily, listReportCards } from "../application/queries";
import {
  createSignatory,
  getBranding,
  getReportcardsSettings,
  listAvailableTemplates,
  listSignatories,
  listTemplateConfigs,
  previewTemplate,
  putBranding,
  putTemplateConfig,
  updateReportcardsSettings,
  updateSignatory,
} from "../application/reference";
import { requestRender, retryBatchRenders } from "../application/render";
import { UNKNOWN_VERIFICATION, truncateIp, verifyByCode, verifyByFile } from "../application/verify";
import { MAX_UPLOAD_BYTES } from "../domain/constants";
import { ReportcardsCode } from "../domain/errors";
import { reportcardsAuditAdapter } from "../infrastructure/audit-adapter";
import { keyProviderFromEnv } from "../infrastructure/key-provider";
import { s3StorageFromEnv } from "../infrastructure/storage-s3";
import { PERMISSIONS as P, createPermissionKit, type PermissionKit } from "./guards";
import * as present from "./presenters";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par results, people, attendance, finance…)
// ---------------------------------------------------------------------------

export interface ReportcardsPortRegistry {
  register(ports: Partial<ReportcardsPorts>): void;
  readonly current: Partial<ReportcardsPorts>;
}

export function createPortRegistry(initial: Partial<ReportcardsPorts> = {}): ReportcardsPortRegistry {
  let current: Partial<ReportcardsPorts> = { ...initial };
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
    /** Registre des ports du module reportcards (posé par `setup`). */
    reportcardsPorts: ReportcardsPortRegistry;
  }
}

/** À appeler par les modules voisins (`results`, `people`, `attendance`, `finance`) dans leur `setup(app, runtime)`. */
export function registerReportcardsPorts(app: FastifyInstance, ports: Partial<ReportcardsPorts>): void {
  if (!app.hasDecorator("reportcardsPorts")) app.decorate("reportcardsPorts", createPortRegistry());
  app.reportcardsPorts.register(ports);
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
    const e = error as { statusCode?: number; code?: string };
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "reportcards.bad_request" });
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: ReportcardsCode.FILE_TOO_LARGE });
    if (e.statusCode === 415) return new ValidationError("Type de contenu non supporté.", [], { code: "reportcards.unsupported_media_type" });
  }
  return error;
}

const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
  // Corps trop volumineux / type non supporté : le statut HTTP d'origine est conservé (413, 415) avec le format d'erreur du kernel.
  const raw = error as { statusCode?: number } | null;
  if (raw && (raw.statusCode === 413 || raw.statusCode === 415)) {
    const code = raw.statusCode === 413 ? ReportcardsCode.FILE_TOO_LARGE : "reportcards.unsupported_media_type";
    void reply.status(raw.statusCode).send({
      status: raw.statusCode,
      code,
      kind: "validation",
      message: raw.statusCode === 413 ? "Corps de requête trop volumineux (10 Mo maximum)." : "Type de contenu non supporté : envoyez le PDF en corps brut.",
      requestId: String(request.id),
    });
    return;
  }
  const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
  if (appError.httpStatus >= 500) request.log.error({ err: error }, "reportcards : erreur inattendue");
  void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
};

export interface PublicRouteOptions {
  deps: ReportcardsDeps;
  /** Limiteur de débit (`runtime.rateLimiter`) ; absent = aucune limite (tests). */
  rateLimiter?: { hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterMs: number }> };
}

export const VERIFY_RATE_RULE = Object.freeze({ limit: 30, windowMs: 60_000 });

/**
 * Routes PUBLIQUES de vérification (sans authentification, sans donnée personnelle). Enregistrées dans un contexte encapsulé :
 * gestionnaire d'erreurs, en-têtes `no-store` et analyseur de corps binaire (PDF) propres à ces routes.
 */
export async function registerPublicRoutes(app: FastifyInstance, options: PublicRouteOptions & { prefix: string; wellKnown?: boolean }): Promise<void> {
  const { deps } = options;
  await app.register(
    async (scope) => {
      scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
      scope.addHook("onSend", async (_req, reply, payload) => {
        void reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex").header("Referrer-Policy", "no-referrer");
        return payload;
      });
      scope.addContentTypeParser(["application/pdf", "application/octet-stream"], { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));
      // Uniformité : une URL sous ce préfixe qui ne correspond à aucune route (code trop long pour le routeur, chemin inconnu)
      // reçoit la MÊME réponse qu'un code inexistant — rien ne distingue un code mal formé d'un code inconnu (AC4.5).
      scope.setNotFoundHandler((_req, reply) => {
        void reply.status(404).send(present.verificationDto(UNKNOWN_VERIFICATION));
      });

      const limited = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
        if (!options.rateLimiter) return false;
        const decision = await options.rateLimiter.hit(`reportcards:verify:${request.ip}`, VERIFY_RATE_RULE);
        if (decision.allowed) return false;
        void reply
          .status(429)
          .header("Retry-After", String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))))
          .send({ status: 429, code: ReportcardsCode.RATE_LIMITED, kind: "rate_limited", message: "Trop de vérifications. Réessayez dans une minute.", requestId: String(request.id) });
        return true;
      };

      scope.get("/verify/:code", { config: { public: true } }, async (req, reply) => {
        if (await limited(req, reply)) return reply;
        // Aucun message ne distingue un code inexistant d'un code mal formé : le paramètre n'est jamais rejeté par le schéma.
        const { code } = parse(reportcardsPublicVerifyParamsSchema, req.params);
        const result = unwrapOrThrow(await verifyByCode(deps, { code, ipPrefix: truncateIp(req.ip) }));
        return reply.status(result.status === "UNKNOWN" ? 404 : 200).send(present.verificationDto(result));
      });

      scope.post("/verify/upload", { config: { public: true }, bodyLimit: MAX_UPLOAD_BYTES }, async (req, reply) => {
        if (await limited(req, reply)) return reply;
        const body = req.body;
        if (!Buffer.isBuffer(body)) throw new ValidationError("Envoyez le fichier PDF en corps brut (Content-Type: application/pdf).", [], { code: "reportcards.unsupported_media_type" });
        return present.fileVerificationDto(unwrapOrThrow(await verifyByFile(deps, { bytes: new Uint8Array(body), ipPrefix: truncateIp(req.ip) })));
      });

      const keys = async (): Promise<{ keys: ReturnType<typeof present.keyDto>[]; signedMessage: string }> => ({
        keys: unwrapOrThrow(await listPublicKeys(deps)).map(present.keyDto),
        signedMessage: "ed-rc/v1 NUL snapshot_hash NUL verification_code NUL issued_at(ISO UTC)",
      });
      scope.get("/keys", { config: { public: true } }, async (req, reply) => {
        if (await limited(req, reply)) return reply;
        return keys();
      });
    },
    { prefix: options.prefix },
  );
  if (options.wellKnown) {
    await app.register(async (scope) => {
      scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
      scope.get("/.well-known/ecoledigitale-keys.json", { config: { public: true } }, async (_req, reply) => {
        const keys = unwrapOrThrow(await listPublicKeys(deps)).map(present.keyDto);
        return reply.header("Cache-Control", "public, max-age=300").send({ keys, signedMessage: "ed-rc/v1 NUL snapshot_hash NUL verification_code NUL issued_at(ISO UTC)" });
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Routes du module
// ---------------------------------------------------------------------------

export interface ReportcardsPluginOptions {
  deps: ReportcardsDeps;
  /** Garde `requirePermission` du module rbac (`runtime.requirePermission`). */
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde `requireFeature` du module entitlements ; absente = toutes les features actives (tests autonomes). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  /** Contrôle programmatique d'une feature (activer « bloquer si impayé »). */
  isFeatureEnabled?: (ctx: RequestContext, featureKey: string) => Promise<boolean>;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  rateLimiter?: PublicRouteOptions["rateLimiter"];
  /** Authentifie un opérateur de plateforme (JWT super-admin) : renvoie son identifiant ou lève. */
  authorizeSuperAdmin?: (request: FastifyRequest) => Promise<{ actorId: string }>;
}

export async function reportcardsPlugin(app: FastifyInstance, options: ReportcardsPluginOptions): Promise<void> {
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
  const superAdmin = async (request: FastifyRequest): Promise<{ actorId: string }> => {
    if (!options.authorizeSuperAdmin) throw new UnauthorizedError("Authentification opérateur requise.");
    return options.authorizeSuperAdmin(request);
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));

    // ===== Contrôle préalable et lots ==========================================================================
    scope.get("/preflight", { preHandler: kit.require(P.generate) }, async (req) => {
      const q = parse(reportcardsPreflightQuerySchema, req.query);
      return unwrapOrThrow(await preflight(deps, ctxOf(req), { classroomId: q.classroomId, academicPeriodId: q.academicPeriodId, kind: q.kind, provisional: q.provisional }));
    });

    scope.post("/batches", { preHandler: kit.require(P.generate) }, async (req, reply) => {
      const b = parse(reportcardsCreateBatchBodySchema, req.body);
      const view = unwrapOrThrow(
        await createBatch(deps, ctxOf(req), {
          classroomId: b.classroomId,
          academicPeriodId: b.academicPeriodId,
          kind: b.kind,
          provisional: b.provisional,
          ...(b.enrollmentIds ? { enrollmentIds: b.enrollmentIds } : {}),
          ...(b.reissueReason ? { reissueReason: b.reissueReason } : {}),
          ...(b.idempotencyKey ? { idempotencyKey: b.idempotencyKey } : {}),
        }),
      );
      return reply.status(view.replayed ? 200 : 202).send(present.batchViewDto(view));
    });

    scope.get("/batches/:id", { preHandler: kit.require(P.generate) }, async (req) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      return present.batchViewDto(unwrapOrThrow(await getBatchView(deps, ctxOf(req), id)));
    });

    scope.post("/batches/:id/retry", { preHandler: kit.require(P.generate) }, async (req, reply) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      return reply.status(202).send(unwrapOrThrow(await retryBatchRenders(deps, ctxOf(req), { batchId: id })));
    });

    // ===== Bulletins (gestion) =================================================================================
    scope.get("/report-cards", { preHandler: kit.require(P.read) }, async (req) => {
      const q = parse(reportcardsListQuerySchema, req.query);
      const page = unwrapOrThrow(
        await listReportCards(deps, ctxOf(req), {
          ...(q.classroomId ? { classroomId: q.classroomId } : {}),
          ...(q.academicPeriodId ? { academicPeriodId: q.academicPeriodId } : {}),
          ...(q.studentId ? { studentId: q.studentId } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.live !== undefined ? { live: q.live } : {}),
          ...(q.needsReissue !== undefined ? { needsReissue: q.needsReissue } : {}),
          ...(q.cursor ? { cursor: q.cursor } : {}),
          limit: q.limit,
        }),
      );
      return { items: page.items.map(present.cardViewDto), nextCursor: page.nextCursor };
    });

    scope.get("/report-cards/:id", { preHandler: kit.require(P.read) }, async (req) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      return present.detailDto(unwrapOrThrow(await getReportCard(deps, ctxOf(req), id)));
    });

    scope.get("/report-cards/:id/explain", { preHandler: kit.require(P.explain) }, async (req) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      const r = unwrapOrThrow(await getExplain(deps, ctxOf(req), id));
      return { reportCardId: r.card.id, snapshotHash: r.card.snapshotHash, explain: r.explain };
    });

    scope.get("/report-cards/:id/pdf", { preHandler: kit.anyOf(P.read, P.selfRead, P.childRead) }, async (req, reply) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      const [manage, self, child] = await Promise.all([kit.has(scope, req, reply, P.read), kit.has(scope, req, reply, P.selfRead), kit.has(scope, req, reply, P.childRead)]);
      const d = unwrapOrThrow(await getDownloadUrl(deps, ctxOf(req), { reportCardId: id, manage, family: { self, child } }));
      return { url: d.url, expiresAt: d.expiresAt.toISOString(), fileName: d.fileName, contentType: "application/pdf", sizeBytes: d.sizeBytes, pdfHash: d.pdfHash };
    });

    scope.get("/classrooms/:id/periods/:pid/pdf", { preHandler: kit.require(P.read) }, async (req) => {
      const { id, pid } = parse(reportcardsClassPeriodParamsSchema, req.params);
      const d = unwrapOrThrow(await getCombinedPdfUrl(deps, ctxOf(req), { classroomId: id, academicPeriodId: pid }));
      return { url: d.url, expiresAt: d.expiresAt.toISOString(), fileName: d.fileName, contentType: "application/pdf", sizeBytes: d.sizeBytes, pdfHash: d.pdfHash };
    });

    scope.post("/report-cards/:id/publish", { preHandler: kit.require(P.publish) }, async (req) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      return present.cardDto(unwrapOrThrow(await publishReportCard(deps, ctxOf(req), { reportCardId: id })));
    });

    scope.post("/report-cards/:id/withdraw", { preHandler: kit.require(P.publish) }, async (req) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      return present.cardDto(unwrapOrThrow(await withdrawReportCard(deps, ctxOf(req), { reportCardId: id })));
    });

    scope.post("/publish", { preHandler: kit.require(P.publish) }, async (req) => {
      const b = parse(reportcardsPublishBatchBodySchema, req.body);
      return unwrapOrThrow(await publishMany(deps, ctxOf(req), { ...(b.reportCardIds ? { reportCardIds: b.reportCardIds } : {}), ...(b.batchId ? { batchId: b.batchId } : {}) }));
    });

    scope.post("/report-cards/:id/reissue", { preHandler: kit.require(P.generate) }, async (req, reply) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      const b = parse(reportcardsReissueBodySchema, req.body);
      return reply.status(201).send(present.cardDto(unwrapOrThrow(await reissueReportCard(deps, ctxOf(req), { reportCardId: id, reason: b.reason }))));
    });

    scope.post("/report-cards/:id/revoke", { preHandler: kit.require(P.revoke) }, async (req) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      const b = parse(reportcardsReasonBodySchema, req.body);
      return present.cardDto(unwrapOrThrow(await revokeReportCard(deps, ctxOf(req), { reportCardId: id, reason: b.reason })));
    });

    scope.post("/report-cards/:id/render", { preHandler: kit.require(P.generate) }, async (req, reply) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      return reply.status(202).send(present.cardDto(unwrapOrThrow(await requestRender(deps, ctxOf(req), { reportCardId: id }))));
    });

    scope.post("/transcripts", { preHandler: [...feature("reportcard.transcript"), kit.require(P.generate)] }, async (req, reply) => {
      const b = parse(reportcardsCreateTranscriptBodySchema, req.body);
      const card = unwrapOrThrow(await createTranscript(deps, ctxOf(req), { studentId: b.studentId, ...(b.academicYearIds ? { academicYearIds: b.academicYearIds } : {}) }));
      return reply.status(201).send(present.cardDto(card));
    });

    // ===== Familles ============================================================================================
    scope.get("/me/report-cards", { preHandler: kit.anyOf(P.selfRead, P.childRead) }, async (req, reply) => {
      const q = parse(reportcardsFamilyListQuerySchema, req.query);
      const [self, child] = await Promise.all([kit.has(scope, req, reply, P.selfRead), kit.has(scope, req, reply, P.childRead)]);
      const page = unwrapOrThrow(await listForFamily(deps, ctxOf(req), { caps: { self, child }, ...(q.cursor ? { cursor: q.cursor } : {}), limit: q.limit }));
      return { items: page.items.map((c) => present.cardDto(c)), nextCursor: page.nextCursor };
    });

    scope.get("/children/:studentId/report-cards", { preHandler: kit.require(P.childRead) }, async (req) => {
      const { studentId } = parse(reportcardsChildParamsSchema, req.params);
      const q = parse(reportcardsFamilyListQuerySchema, req.query);
      const page = unwrapOrThrow(await listForFamily(deps, ctxOf(req), { caps: { child: true }, studentId, ...(q.cursor ? { cursor: q.cursor } : {}), limit: q.limit }));
      return { items: page.items.map((c) => present.cardDto(c)), nextCursor: page.nextCursor };
    });

    // ===== Identité, signataires, modèles, réglages ============================================================
    scope.get("/branding", { preHandler: kit.require(P.brandingManage) }, async (req) => {
      const q = parse(reportcardsTemplateConfigQuerySchema, req.query);
      const items = unwrapOrThrow(await getBranding(deps, ctxOf(req), { institutionId: q.institutionId ?? null, history: q.history === true }));
      return { items: items.map(present.brandingDto) };
    });

    scope.put("/branding", { preHandler: kit.require(P.brandingManage) }, async (req) => {
      const b = parse(reportcardsPutBrandingBodySchema, req.body);
      return present.brandingDto(unwrapOrThrow(await putBranding(deps, ctxOf(req), b)));
    });

    scope.post("/branding/assets", { preHandler: kit.anyOf(P.brandingManage, P.signatoryManage) }, async (req, reply) => {
      const b = parse(reportcardsAssetUploadBodySchema, req.body);
      const storage = deps.ports.storage;
      const ctx = ctxOf(req);
      const ext = b.contentType === "image/png" ? "png" : b.contentType === "image/jpeg" ? "jpg" : b.contentType === "image/webp" ? "webp" : "gif";
      const objectKey = `reportcards/${ctx.tenantId}/assets/${b.kind}/${deps.newId()}.${ext}`;
      const signed = await storage.signedUploadUrl?.(objectKey, { ttlSeconds: 300, contentType: b.contentType, maxBytes: 2 * 1024 * 1024 });
      if (!signed) throw new ValidationError("Le dépôt par URL signée n'est pas disponible avec ce stockage.", [], { code: ReportcardsCode.PORT_UNAVAILABLE });
      return reply.status(201).send({ objectKey, uploadUrl: signed.url, method: "PUT", headers: signed.headers, expiresAt: signed.expiresAt.toISOString(), maxBytes: 2 * 1024 * 1024 });
    });

    scope.get("/signatories", { preHandler: kit.require(P.signatoryManage) }, async (req) =>
      ({ items: unwrapOrThrow(await listSignatories(deps, ctxOf(req))).map(present.signatoryDto) }),
    );
    scope.post("/signatories", { preHandler: kit.require(P.signatoryManage) }, async (req, reply) => {
      const b = parse(reportcardsCreateSignatoryBodySchema, req.body);
      return reply.status(201).send(present.signatoryDto(unwrapOrThrow(await createSignatory(deps, ctxOf(req), b))));
    });
    scope.patch("/signatories/:id", { preHandler: kit.require(P.signatoryManage) }, async (req) => {
      const { id } = parse(reportcardsIdParamsSchema, req.params);
      const b = parse(reportcardsPatchSignatoryBodySchema, req.body);
      return present.signatoryDto(unwrapOrThrow(await updateSignatory(deps, ctxOf(req), { signatoryId: id, patch: b })));
    });

    scope.get("/templates", { preHandler: kit.require(P.templateManage) }, async (req) =>
      ({ items: unwrapOrThrow(await listAvailableTemplates(deps, ctxOf(req))).map(present.templateDto) }),
    );
    scope.get("/template-configs", { preHandler: kit.require(P.templateManage) }, async (req) => {
      const q = parse(reportcardsTemplateConfigQuerySchema, req.query);
      const items = unwrapOrThrow(await listTemplateConfigs(deps, ctxOf(req), { ...(q.institutionId ? { institutionId: q.institutionId } : {}), ...(q.documentKind ? { documentKind: q.documentKind } : {}), history: q.history === true }));
      return { items: items.map(present.configDto) };
    });
    scope.put("/template-configs", { preHandler: kit.require(P.templateManage) }, async (req) => {
      const b = parse(reportcardsPutTemplateConfigBodySchema, req.body);
      return present.configDto(unwrapOrThrow(await putTemplateConfig(deps, ctxOf(req), b)));
    });
    scope.post("/template-configs/preview", { preHandler: kit.require(P.templateManage) }, async (req) => {
      const b = parse(reportcardsPreviewBodySchema, req.body);
      const r = unwrapOrThrow(await previewTemplate(deps, ctxOf(req), b));
      return { html: r.html, pdfBase64: r.pdf ? Buffer.from(r.pdf).toString("base64") : null, templateKey: r.templateKey, templateVersion: r.templateVersion };
    });

    scope.get("/settings", { preHandler: kit.anyOf(P.read, P.templateManage) }, async (req) => present.settingsDto(unwrapOrThrow(await getReportcardsSettings(deps, ctxOf(req)))));
    scope.put("/settings", { preHandler: kit.require(P.brandingManage) }, async (req) => {
      const b = parse(reportcardsSettingsBodySchema, req.body);
      const ctx = ctxOf(req);
      if (b.blockIfUnpaid === true && options.isFeatureEnabled && !(await options.isFeatureEnabled(ctx, "reportcard.block-unpaid"))) {
        throw new ValidationError("Le blocage en cas d'impayé n'est pas inclus dans l'abonnement de l'établissement.", [], { code: "entitlements.feature_not_available" });
      }
      return present.settingsDto(unwrapOrThrow(await updateReportcardsSettings(deps, ctx, b)));
    });

    // ===== Console plateforme (JWT super-admin) =================================================================
    scope.get("/platform/keys", { config: { public: true } }, async (req) => {
      await superAdmin(req);
      return { items: unwrapOrThrow(await listPublicKeys(deps)).map(present.keyDto) };
    });
    scope.post("/platform/keys/:keyId/retire", { config: { public: true } }, async (req) => {
      const admin = await superAdmin(req);
      const { keyId } = parse(reportcardsKeyParamsSchema, req.params);
      return unwrapOrThrow(await retireSigningKey(deps, { keyId, actorId: admin.actorId }));
    });
    scope.get("/platform/templates", { config: { public: true } }, async (req) => {
      await superAdmin(req);
      return { items: unwrapOrThrow(await listAllPlatformTemplates(deps)).map(present.templateDto) };
    });
    scope.post("/platform/templates", { config: { public: true } }, async (req, reply) => {
      const admin = await superAdmin(req);
      const b = parse(reportcardsPublishPlatformTemplateBodySchema, req.body);
      const t = unwrapOrThrow(await publishPlatformTemplate(deps, { ...b, actorId: admin.actorId }));
      return reply.status(201).send(present.templateDto(t));
    });
    scope.post("/platform/templates/seed", { config: { public: true } }, async (req) => {
      await superAdmin(req);
      return unwrapOrThrow(await ensureBuiltinTemplates(deps));
    });

  });

  // Routes publiques de vérification, aussi exposées sous le préfixe du module.
  await registerPublicRoutes(app, { deps, ...(options.rateLimiter ? { rateLimiter: options.rateLimiter } : {}), prefix: "/public" });
}

// ---------------------------------------------------------------------------
// Contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

function depsFromRuntime(app: FastifyInstance, runtime: ModuleRuntime): ReportcardsDeps {
  const env = runtime.env;
  let keys: ReturnType<typeof keyProviderFromEnv> = null;
  try {
    keys = keyProviderFromEnv(env);
  } catch (e) {
    runtime.logger.error({ err: e instanceof Error ? e.message : String(e) }, "reportcards : clé de signature invalide (aucune émission possible)");
  }
  let s3: ReturnType<typeof s3StorageFromEnv> = null;
  try {
    s3 = s3StorageFromEnv(env);
  } catch (e) {
    runtime.logger.error({ err: e instanceof Error ? e.message : String(e) }, "reportcards : stockage S3 invalide");
  }
  const verificationBaseUrl = (env.REPORTCARDS_VERIFICATION_BASE_URL ?? env.V2_APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return createReportcardsDeps({
    db: runtime.tenantDb,
    systemDb: runtime.systemDb,
    clock: runtime.clock,
    audit: reportcardsAuditAdapter(runtime.auditPort as RuntimeAuditPort),
    logger: runtime.logger,
    keys,
    verificationEnabled: (tenantId) => runtime.entitlements.reader.hasFeature(tenantId, "reportcard.public-verification"),
    portsProvider: () => ({ ...(s3 ? { storage: s3 } : {}), ...app.reportcardsPorts.current }),
    config: { verificationBaseUrl: verificationBaseUrl || null },
  });
}

/** Instance RACINE : registre de ports et routes publiques de vérification (`/api/v1/public/verify/*`, `.well-known`). */
export async function setup(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("reportcardsPorts")) app.decorate("reportcardsPorts", createPortRegistry());
  const deps = depsFromRuntime(app, runtime);
  await registerPublicRoutes(app, { deps, rateLimiter: runtime.rateLimiter, prefix: "/api/v1/public", wellKnown: true });
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/reportcards`). */
export default async function reportcardsModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("reportcardsPorts")) app.decorate("reportcardsPorts", createPortRegistry());
  const deps = depsFromRuntime(app, runtime);
  await app.register(reportcardsPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    isFeatureEnabled: (ctx, featureKey) => runtime.entitlements.isFeatureEnabled(ctx, featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: runtime.rateLimiter,
    authorizeSuperAdmin: async (request) => {
      const identity = await runtime.superAdminAuthorizer.authorize({ headers: request.headers });
      return { actorId: identity.actorId };
    },
  });
}
