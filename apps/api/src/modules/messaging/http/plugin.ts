/**
 * Plugin Fastify du module messaging — routes SANS préfixe (le registre applique `/api/v1/messaging`, voir
 * `docs/architecture/platform-assembly.md`). Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la
 * RACINE avec le registre de ports (`app.messagingPorts`) que les adaptateurs de plateforme renseignent.
 *
 *  - Authentification : `request.ctx` posé en amont (iam v2 / legacy dérivé). Aucune identité lue d'un en-tête client.
 *  - Autorisation : `requirePermission('messaging.…')` du module rbac, jamais un rôle codé en dur ; les permissions
 *    sensibles (modération) exigent la MFA (garde rbac). Le LIEN (tutelle, affectation) est vérifié par les cas d'usage.
 *  - Limiteur de débit : `runtime.rateLimiter` par utilisateur sur les écritures (en plus des quotas en base) : 429 + Retry-After.
 *  - Aucun `GET` n'écrit (sauf l'audit d'une lecture de modération / de supervision / de pièce par la modération).
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `messaging.*` ; jamais de message interne.
 *  - Réponses `Cache-Control: no-store` (contenu privé).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, z, type ZodTypeAny } from "zod";
import { UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  messagingAnnouncementListQuerySchema,
  messagingAudiencePreviewBodySchema,
  messagingConversationListQuerySchema,
  messagingCreateAnnouncementBodySchema,
  messagingCreateConversationBodySchema,
  messagingDecideReportBodySchema,
  messagingMarkReadBodySchema,
  messagingMessagesQuerySchema,
  messagingNotificationListQuerySchema,
  messagingParticipantStateBodySchema,
  messagingPostMessageBodySchema,
  messagingPublishAnnouncementBodySchema,
  messagingReceiptsQuerySchema,
  messagingRecipientsQuerySchema,
  messagingReportBodySchema,
  messagingReportQuerySchema,
  messagingSearchQuerySchema,
  messagingSetRestrictionBodySchema,
  messagingSuperviseListQuerySchema,
  messagingSuperviseMessagesQuerySchema,
  messagingUpdateAnnouncementBodySchema,
  messagingUpdatePreferencesBodySchema,
  messagingUpdateSettingsBodySchema,
  messagingUpdateTemplateBodySchema,
  messagingUploadAttachmentBodySchema,
  messagingWithdrawAnnouncementBodySchema,
  messagingUuidSchema,
} from "@ecoledigitale/contracts/src/v2/messaging";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import {
  acknowledgeAnnouncement,
  createAnnouncement,
  deleteAnnouncementDraft,
  getAnnouncementDetail,
  listAnnouncementReceipts,
  listAnnouncements,
  markAnnouncementRead,
  previewAudience,
  publishAnnouncement,
  updateAnnouncement,
  withdrawAnnouncement,
} from "../application/announcements";
import { getAttachmentUrl, uploadAttachment } from "../application/attachments";
import {
  createConversation,
  getConversationDetail,
  leaveConversation,
  listConversationMessages,
  listConversations,
  markConversationRead,
  postMessage,
  removeOwnMessage,
  searchMyMessages,
  setParticipantState,
} from "../application/conversations";
import { createMessagingDeps, type MessagingDeps } from "../application/deps";
import {
  decideReport,
  getReportContext,
  liftRestriction,
  listActiveRestrictions,
  listReports,
  reportMessage,
  restrictUser,
  superviseListConversations,
  superviseReadMessages,
} from "../application/moderation";
import {
  getMyPreferences,
  getUnreadSummary,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateMyPreferences,
} from "../application/notifications";
import { createMessagingPortRegistry, type MessagingPortRegistry } from "../application/port-registry";
import type { MessagingPorts } from "../application/ports";
import { getMyAudience, listAllowedRecipients } from "../application/recipients";
import { getMessagingSettings, listSystemTemplates, updateMessagingSettings, updateSystemTemplate } from "../application/settings";
import { RateLimitedError } from "../domain/errors";
import type { CallerCaps } from "../domain/types";
import { messagingAuditAdapter } from "../infrastructure/audit-adapter";
import { ALL_CAPS, createPermissionKit, PERMISSIONS as P, READERS, SENDERS, type PermissionKit } from "./guards";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par les adaptateurs de plateforme)
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module messaging (posé par `setup`). */
    messagingPorts: MessagingPortRegistry;
  }
}

/** À appeler par `platform/adapters` (`wireApiPorts`) : enregistre (ou remplace) des ports ; relus à chaque appel. */
export function registerMessagingPorts(app: FastifyInstance, ports: Partial<MessagingPorts>): void {
  if (!app.hasDecorator("messagingPorts")) app.decorate("messagingPorts", createMessagingPortRegistry());
  app.messagingPorts.register(ports);
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

/** Code d'un gabarit de message système (`attendance.absence`). */
const templateCodeSchema = z.string().regex(/^[a-z][a-z0-9_.]{1,59}$/, "Code de gabarit invalide.");

const idParams = (params: unknown): { id: string } => ({ id: parse(messagingUuidSchema, (params as { id?: unknown } | undefined)?.id) });

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function maybeFastifyValidation(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const e = error as { statusCode?: number };
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "messaging.invalid_input" });
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: "messaging.invalid_input" });
  }
  return error;
}

/** Fenêtres du limiteur HTTP (par utilisateur) : protège la base avant même le calcul des quotas. */
const HTTP_RATE = Object.freeze({
  send: { limit: 30, windowMs: 60_000 },
  upload: { limit: 20, windowMs: 60_000 },
  report: { limit: 10, windowMs: 60_000 },
});

export interface RateLimiterLike {
  hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; count: number; retryAfterMs: number }>;
}

export interface MessagingPluginOptions {
  deps: MessagingDeps;
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  rateLimiter?: RateLimiterLike;
}

/** Plafond de transport d'une pièce encodée en base64 (35 Mio) ; la taille métier vient des paramètres d'établissement. */
const ATTACHMENT_BODY_LIMIT = 35 * 1024 * 1024;

const noStore = (reply: FastifyReply): void => {
  void reply.header("Cache-Control", "no-store");
};

export async function messagingPlugin(app: FastifyInstance, options: MessagingPluginOptions): Promise<void> {
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
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "messaging : erreur inattendue");
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

    /** Limiteur de débit HTTP par utilisateur (Redis si configuré). */
    const throttle = (kind: keyof typeof HTTP_RATE): preHandlerAsyncHookHandler =>
      async function throttleGuard(this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
        if (!options.rateLimiter) return;
        const userId = ctxOf(request).userId ?? request.ip;
        const d = await options.rateLimiter.hit(`messaging:${kind}:${ctxOf(request).tenantId}:${userId}`, HTTP_RATE[kind]);
        if (!d.allowed) {
          void reply.header("Retry-After", String(Math.max(1, Math.ceil(d.retryAfterMs / 1000))));
          throw new RateLimitedError("Trop de requêtes : réessayez dans un instant.", Math.max(1, Math.ceil(d.retryAfterMs / 1000)), { window: "minute" });
        }
      };

    // ===== Moi ===============================================================================================
    scope.get("/me/audience", { preHandler: kit.anyOf(...READERS) }, async (req, reply) => unwrapOrThrow(await getMyAudience(deps, ctxOf(req), { caps: await caps(req, reply) })));
    scope.get("/me/unread", { preHandler: kit.anyOf(...READERS) }, async (req) => unwrapOrThrow(await getUnreadSummary(deps, ctxOf(req))));
    scope.get("/me/preferences", { preHandler: kit.anyOf(...READERS) }, async (req) => unwrapOrThrow(await getMyPreferences(deps, ctxOf(req))));
    scope.put("/me/preferences", { preHandler: kit.anyOf(...READERS) }, async (req) =>
      unwrapOrThrow(await updateMyPreferences(deps, ctxOf(req), parse(messagingUpdatePreferencesBodySchema, req.body))),
    );

    // ===== Conversations =====================================================================================
    scope.get("/conversations", { preHandler: kit.anyOf(...READERS) }, async (req) => {
      const q = parse(messagingConversationListQuerySchema, req.query);
      return unwrapOrThrow(await listConversations(deps, ctxOf(req), { folder: q.folder, q: q.q, unreadOnly: q.unread === "true" ? true : undefined, cursor: q.cursor, limit: q.limit }));
    });

    scope.post("/conversations", { preHandler: [kit.anyOf(...SENDERS), throttle("send")] }, async (req, reply) => {
      const b = parse(messagingCreateConversationBodySchema, req.body);
      const r = unwrapOrThrow(await createConversation(deps, ctxOf(req), { ...b, caps: await caps(req, reply) }));
      return reply.status(r.reused ? 200 : 201).send(r);
    });

    scope.get("/conversations/:id", { preHandler: kit.anyOf(...READERS) }, async (req, reply) => {
      const { id } = idParams(req.params);
      return unwrapOrThrow(await getConversationDetail(deps, ctxOf(req), { conversationId: id, caps: await caps(req, reply) }));
    });

    scope.get("/conversations/:id/messages", { preHandler: kit.anyOf(...READERS) }, async (req) => {
      const { id } = idParams(req.params);
      const q = parse(messagingMessagesQuerySchema, req.query);
      return unwrapOrThrow(await listConversationMessages(deps, ctxOf(req), { conversationId: id, before: q.before, limit: q.limit }));
    });

    scope.post("/conversations/:id/messages", { preHandler: [kit.anyOf(...SENDERS), throttle("send")] }, async (req, reply) => {
      const { id } = idParams(req.params);
      const b = parse(messagingPostMessageBodySchema, req.body);
      const r = unwrapOrThrow(await postMessage(deps, ctxOf(req), { conversationId: id, ...b, caps: await caps(req, reply) }));
      return reply.status(201).send(r);
    });

    scope.post("/conversations/:id/read", { preHandler: kit.anyOf(...READERS) }, async (req) => {
      const { id } = idParams(req.params);
      const b = parse(messagingMarkReadBodySchema, req.body);
      return unwrapOrThrow(await markConversationRead(deps, ctxOf(req), { conversationId: id, upToSeq: b.upToSeq }));
    });

    scope.patch("/conversations/:id/me", { preHandler: kit.anyOf(...READERS) }, async (req) => {
      const { id } = idParams(req.params);
      const b = parse(messagingParticipantStateBodySchema, req.body);
      return unwrapOrThrow(await setParticipantState(deps, ctxOf(req), { conversationId: id, ...b }));
    });

    scope.post("/conversations/:id/leave", { preHandler: kit.anyOf(...READERS) }, async (req, reply) => {
      const { id } = idParams(req.params);
      unwrapOrThrow(await leaveConversation(deps, ctxOf(req), { conversationId: id }));
      return reply.status(204).send();
    });

    scope.get("/search", { preHandler: kit.anyOf(...READERS) }, async (req) => {
      const q = parse(messagingSearchQuerySchema, req.query);
      return unwrapOrThrow(await searchMyMessages(deps, ctxOf(req), q));
    });

    // ===== Messages ==========================================================================================
    scope.delete("/messages/:id", { preHandler: kit.anyOf(...READERS) }, async (req, reply) => {
      const { id } = idParams(req.params);
      unwrapOrThrow(await removeOwnMessage(deps, ctxOf(req), { messageId: id }));
      return reply.status(204).send();
    });

    scope.post("/messages/:id/report", { preHandler: [kit.anyOf(...READERS), throttle("report")] }, async (req, reply) => {
      const { id } = idParams(req.params);
      const b = parse(messagingReportBodySchema, req.body);
      return reply.status(201).send(unwrapOrThrow(await reportMessage(deps, ctxOf(req), { messageId: id, ...b })));
    });

    // ===== Destinataires et pièces jointes ===================================================================
    scope.get("/recipients", { preHandler: kit.anyOf(...SENDERS) }, async (req, reply) => {
      const q = parse(messagingRecipientsQuerySchema, req.query);
      return unwrapOrThrow(await listAllowedRecipients(deps, ctxOf(req), { ...q, caps: await caps(req, reply) }));
    });

    scope.post("/attachments", { bodyLimit: ATTACHMENT_BODY_LIMIT, preHandler: [kit.anyOf(...SENDERS, P.announcementPublish, P.announcementPublishClass), throttle("upload")] }, async (req, reply) => {
      const b = parse(messagingUploadAttachmentBodySchema, req.body);
      const content = new Uint8Array(Buffer.from(b.contentBase64, "base64"));
      return reply.status(201).send(unwrapOrThrow(await uploadAttachment(deps, ctxOf(req), { fileName: b.fileName, content })));
    });

    scope.get("/attachments/:id/url", { preHandler: kit.anyOf(...READERS, P.moderationRead, P.moderationSupervise) }, async (req, reply) => {
      const { id } = idParams(req.params);
      return unwrapOrThrow(await getAttachmentUrl(deps, ctxOf(req), { attachmentId: id, caps: await caps(req, reply, ["moderationRead", "moderationSupervise", "announcementManage"]) }));
    });

    // ===== Annonces ==========================================================================================
    const announcers = [P.announcementPublish, P.announcementPublishClass, P.announcementManage] as const;

    scope.get("/announcements", { preHandler: kit.anyOf(...READERS, ...announcers) }, async (req, reply) => {
      const q = parse(messagingAnnouncementListQuerySchema, req.query);
      return unwrapOrThrow(
        await listAnnouncements(deps, ctxOf(req), {
          scope: q.scope, status: q.status, includeExpired: q.includeExpired === "true", unreadOnly: q.unread === "true", cursor: q.cursor, limit: q.limit,
          caps: await caps(req, reply, ["announcementPublish", "announcementPublishClass", "announcementManage"]),
        }),
      );
    });

    scope.post("/announcements", { preHandler: kit.anyOf(...announcers) }, async (req, reply) => {
      const b = parse(messagingCreateAnnouncementBodySchema, req.body);
      return reply.status(201).send(unwrapOrThrow(await createAnnouncement(deps, ctxOf(req), { ...b, caps: await caps(req, reply, ["announcementPublish", "announcementPublishClass", "announcementManage"]) })));
    });

    scope.post("/announcements/audience-preview", { preHandler: kit.anyOf(...announcers) }, async (req, reply) => {
      const b = parse(messagingAudiencePreviewBodySchema, req.body);
      return unwrapOrThrow(await previewAudience(deps, ctxOf(req), { audience: b, caps: await caps(req, reply, ["announcementPublish", "announcementPublishClass", "announcementManage"]) }));
    });

    scope.get("/announcements/:id", { preHandler: kit.anyOf(...READERS, ...announcers) }, async (req, reply) => {
      const { id } = idParams(req.params);
      return unwrapOrThrow(await getAnnouncementDetail(deps, ctxOf(req), { announcementId: id, caps: await caps(req, reply, ["announcementPublish", "announcementPublishClass", "announcementManage"]) }));
    });

    scope.patch("/announcements/:id", { preHandler: kit.anyOf(...announcers) }, async (req, reply) => {
      const { id } = idParams(req.params);
      const b = parse(messagingUpdateAnnouncementBodySchema, req.body);
      return unwrapOrThrow(await updateAnnouncement(deps, ctxOf(req), { announcementId: id, ...b, caps: await caps(req, reply, ["announcementPublish", "announcementPublishClass", "announcementManage"]) }));
    });

    scope.delete("/announcements/:id", { preHandler: kit.anyOf(...announcers) }, async (req, reply) => {
      const { id } = idParams(req.params);
      unwrapOrThrow(await deleteAnnouncementDraft(deps, ctxOf(req), { announcementId: id, caps: await caps(req, reply, ["announcementPublish", "announcementPublishClass", "announcementManage"]) }));
      return reply.status(204).send();
    });

    scope.post("/announcements/:id/publish", { preHandler: kit.anyOf(...announcers) }, async (req, reply) => {
      const { id } = idParams(req.params);
      const b = parse(messagingPublishAnnouncementBodySchema, req.body);
      return unwrapOrThrow(await publishAnnouncement(deps, ctxOf(req), { announcementId: id, publishAt: b.publishAt, caps: await caps(req, reply, ["announcementPublish", "announcementPublishClass", "announcementManage"]) }));
    });

    scope.post("/announcements/:id/withdraw", { preHandler: kit.anyOf(...announcers) }, async (req, reply) => {
      const { id } = idParams(req.params);
      const b = parse(messagingWithdrawAnnouncementBodySchema, req.body);
      return unwrapOrThrow(await withdrawAnnouncement(deps, ctxOf(req), { announcementId: id, reason: b.reason, caps: await caps(req, reply, ["announcementPublish", "announcementPublishClass", "announcementManage"]) }));
    });

    scope.post("/announcements/:id/read", { preHandler: kit.anyOf(...READERS) }, async (req) => {
      const { id } = idParams(req.params);
      return unwrapOrThrow(await markAnnouncementRead(deps, ctxOf(req), { announcementId: id }));
    });

    scope.post("/announcements/:id/acknowledge", { preHandler: kit.anyOf(...READERS) }, async (req) => {
      const { id } = idParams(req.params);
      return unwrapOrThrow(await acknowledgeAnnouncement(deps, ctxOf(req), { announcementId: id }));
    });

    scope.get("/announcements/:id/receipts", { preHandler: kit.anyOf(...announcers) }, async (req, reply) => {
      const { id } = idParams(req.params);
      const q = parse(messagingReceiptsQuerySchema, req.query);
      return unwrapOrThrow(await listAnnouncementReceipts(deps, ctxOf(req), { announcementId: id, ...q, caps: await caps(req, reply, ["announcementPublish", "announcementPublishClass", "announcementManage"]) }));
    });

    // ===== Notifications =====================================================================================
    scope.get("/notifications", { preHandler: kit.anyOf(...READERS) }, async (req) => {
      const q = parse(messagingNotificationListQuerySchema, req.query);
      return unwrapOrThrow(await listMyNotifications(deps, ctxOf(req), { unreadOnly: q.unread === "true", cursor: q.cursor, limit: q.limit }));
    });
    scope.post("/notifications/read-all", { preHandler: kit.anyOf(...READERS) }, async (req) => unwrapOrThrow(await markAllNotificationsRead(deps, ctxOf(req))));
    scope.post("/notifications/:id/read", { preHandler: kit.anyOf(...READERS) }, async (req) => {
      const { id } = idParams(req.params);
      return unwrapOrThrow(await markNotificationRead(deps, ctxOf(req), { notificationId: id }));
    });

    // ===== Modération ========================================================================================
    scope.get("/moderation/reports", { preHandler: kit.require(P.moderationRead) }, async (req) => unwrapOrThrow(await listReports(deps, ctxOf(req), parse(messagingReportQuerySchema, req.query))));
    scope.get("/moderation/reports/:id", { preHandler: kit.require(P.moderationRead) }, async (req) => {
      const { id } = idParams(req.params);
      return unwrapOrThrow(await getReportContext(deps, ctxOf(req), { reportId: id }));
    });
    scope.post("/moderation/reports/:id/decide", { preHandler: kit.require(P.moderationManage) }, async (req) => {
      const { id } = idParams(req.params);
      return unwrapOrThrow(await decideReport(deps, ctxOf(req), { reportId: id, ...parse(messagingDecideReportBodySchema, req.body) }));
    });
    scope.get("/moderation/restrictions", { preHandler: kit.require(P.moderationRead) }, async (req) => unwrapOrThrow(await listActiveRestrictions(deps, ctxOf(req))));
    scope.post("/moderation/restrictions", { preHandler: kit.require(P.moderationManage) }, async (req, reply) => {
      unwrapOrThrow(await restrictUser(deps, ctxOf(req), parse(messagingSetRestrictionBodySchema, req.body)));
      return reply.status(204).send();
    });
    scope.delete("/moderation/restrictions/:id", { preHandler: kit.require(P.moderationManage) }, async (req, reply) => {
      const { id } = idParams(req.params);
      unwrapOrThrow(await liftRestriction(deps, ctxOf(req), { userId: id }));
      return reply.status(204).send();
    });
    scope.get("/moderation/conversations", { preHandler: kit.require(P.moderationSupervise) }, async (req) =>
      unwrapOrThrow(await superviseListConversations(deps, ctxOf(req), parse(messagingSuperviseListQuerySchema, req.query))),
    );
    scope.get("/moderation/conversations/:id/messages", { preHandler: kit.require(P.moderationSupervise) }, async (req) => {
      const { id } = idParams(req.params);
      return unwrapOrThrow(await superviseReadMessages(deps, ctxOf(req), { conversationId: id, ...parse(messagingSuperviseMessagesQuerySchema, req.query) }));
    });

    // ===== Paramètres et gabarits ============================================================================
    scope.get("/settings", { preHandler: kit.anyOf(P.settingsManage, ...READERS) }, async (req) => unwrapOrThrow(await getMessagingSettings(deps, ctxOf(req))));
    scope.put("/settings", { preHandler: kit.require(P.settingsManage) }, async (req) => unwrapOrThrow(await updateMessagingSettings(deps, ctxOf(req), parse(messagingUpdateSettingsBodySchema, req.body))));
    scope.get("/templates", { preHandler: kit.require(P.settingsManage) }, async (req) => unwrapOrThrow(await listSystemTemplates(deps, ctxOf(req))));
    scope.put("/templates/:code", { preHandler: kit.require(P.settingsManage) }, async (req) => {
      const code = parse(templateCodeSchema, (req.params as { code?: unknown }).code);
      return unwrapOrThrow(await updateSystemTemplate(deps, ctxOf(req), { code, ...parse(messagingUpdateTemplateBodySchema, req.body) }));
    });
  });
}

// ---------------------------------------------------------------------------
// Contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

/** Instance RACINE : pose le registre de ports que les adaptateurs de plateforme renseignent (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("messagingPorts")) app.decorate("messagingPorts", createMessagingPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/messaging`). */
export default async function messagingModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("messagingPorts")) app.decorate("messagingPorts", createMessagingPortRegistry());
  const deps = createMessagingDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: messagingAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => app.messagingPorts.current,
  });
  await app.register(messagingPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: runtime.rateLimiter as unknown as RateLimiterLike,
  });
}
