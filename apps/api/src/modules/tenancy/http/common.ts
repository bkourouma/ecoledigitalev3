/**
 * Éléments HTTP communs du module : contexte de requête, garde de permission,
 * format d'erreur. Aucune logique métier ici.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ForbiddenError,
  UnauthorizedError,
  getRequestContext,
  toAppError,
  toErrorBody,
  type RequestContext,
} from "@ecoledigitale/kernel";

/** Garde `requirePermission('ressource.action')` fournie par le module `rbac`. */
export type PermissionGuardFactory = (
  permission: string,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void;

export type ContextResolver = (request: FastifyRequest) => RequestContext;

/**
 * Contexte par défaut : propriété `requestContext` posée sur la requête par
 * l'authentification, sinon le contexte AsyncLocalStorage du kernel.
 */
export const defaultContextResolver: ContextResolver = (request) => {
  const ctx = (request as FastifyRequest & { requestContext?: RequestContext }).requestContext ?? getRequestContext();
  if (!ctx) throw new UnauthorizedError("Authentification requise.");
  return ctx;
};

/**
 * Garde par défaut quand ni l'option `requirePermission` ni le décorateur
 * `app.requirePermission` ne sont fournis : REFUSE tout (échec fermé). Un module
 * mal câblé ne doit jamais exposer ses routes.
 */
export const denyAllGuard: PermissionGuardFactory = (permission) => () => {
  throw new ForbiddenError(`Permission « ${permission} » non vérifiable : garde de permissions non configurée.`, {
    code: "tenancy.permission_guard_missing",
  });
};

export function resolvePermissionGuard(app: FastifyInstance, explicit?: PermissionGuardFactory): PermissionGuardFactory {
  if (explicit) return explicit;
  const decorated = (app as unknown as { requirePermission?: PermissionGuardFactory }).requirePermission;
  return typeof decorated === "function" ? decorated.bind(app) : denyAllGuard;
}

/** Gestionnaire d'erreurs du plugin : `AppError` -> `{status, code, kind, message, ...}`, jamais de stack. */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const fastifyStatus = (error as FastifyError).statusCode;
    // Erreurs de protocole Fastify (JSON invalide, corps trop gros…) : on garde leur statut 4xx.
    if (typeof fastifyStatus === "number" && fastifyStatus >= 400 && fastifyStatus < 500 && !("kind" in error)) {
      void reply.status(fastifyStatus).send({
        status: fastifyStatus,
        code: (error as FastifyError).code ?? "BAD_REQUEST",
        kind: "validation",
        message: "Requête invalide.",
        requestId: request.id,
      });
      return;
    }
    const appError = toAppError(error);
    if (appError.kind === "internal") request.log.error({ err: error }, "tenancy: erreur interne");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, request.id));
  });
}
