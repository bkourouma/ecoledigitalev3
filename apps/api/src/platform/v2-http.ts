/**
 * Aides HTTP communes aux modules v2 : traduction des erreurs du kernel en réponses
 * JSON stables, et garde « contexte présent ». Appliquées par le registre à chaque
 * module (contexte Fastify encapsulé) : elles ne touchent JAMAIS aux routes legacy.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { InternalError, UnauthorizedError, isAppError, toErrorBody, type AppError } from "@ecoledigitale/kernel";

/** Option de route : `{ config: { public: true } }` dispense de la garde de contexte. */
export interface V2RouteConfig {
  public?: boolean;
}

/**
 * Erreur Fastify de validation (schéma JSON) ou erreur HTTP native (4xx) : on les
 * conserve en 400/4xx avec un corps au format kernel. Toute autre erreur inconnue
 * devient `INTERNAL` SANS exposer son message (SQL, chemins, secrets).
 */
export function v2ErrorHandler(error: FastifyError | AppError | Error, request: FastifyRequest, reply: FastifyReply): void {
  const requestId = request.ctx?.requestId ?? String(request.id);

  if (isAppError(error)) {
    if (error.kind === "internal") request.log.error({ err: error }, "v2 : erreur interne");
    void reply.status(error.httpStatus).send(toErrorBody(error, requestId));
    return;
  }

  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    void reply.status(400).send({
      status: 400,
      code: "VALIDATION_FAILED",
      kind: "validation",
      message: "Données invalides.",
      issues: fastifyError.validation.map((v) => ({
        path: String(v.instancePath ?? "").split("/").filter(Boolean),
        message: v.message ?? "invalide",
      })),
      requestId,
    });
    return;
  }

  const status = fastifyError.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    void reply.status(status).send({
      status,
      code: fastifyError.code ?? "BAD_REQUEST",
      kind: "validation",
      message: fastifyError.message,
      requestId,
    });
    return;
  }

  request.log.error({ err: error }, "v2 : erreur non gérée");
  void reply.status(500).send(toErrorBody(new InternalError("Erreur interne.", { cause: error }), requestId));
}

/**
 * Garde « requête authentifiée dans un tenant » pour les routes de module. Le contexte est
 * posé par `v2-context` à partir de l'authentification legacy ; absent ⇒ 401, sauf route
 * déclarée publique (`config: { public: true }`).
 */
export async function requireContextHook(request: FastifyRequest): Promise<void> {
  const config = (request.routeOptions?.config ?? {}) as V2RouteConfig;
  if (config.public === true) return;
  if (!request.ctx) {
    throw new UnauthorizedError("Authentification requise.", { code: "UNAUTHORIZED" });
  }
}
