/**
 * `requireFeature('finance.online-payment')` : fabrique de preHandler Fastify.
 *
 *   app.post("/pay", { preHandler: [requirePermission("finance.payment.create"), requireFeature("finance.online-payment")] }, handler);
 *
 * Le garde lit les droits via le port `EntitlementsReader` (cache court invalidé
 * par événement) exposé par le plugin `entitlements` (`app.entitlements`). Sans ce
 * plugin enregistré, le garde REFUSE (erreur interne explicite) : une route
 * payante ne s'ouvre jamais par défaut.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError, InternalError, toErrorBody } from "@ecoledigitale/kernel";
import { FeatureKeySchema } from "@ecoledigitale/contracts/src/v2/entitlements";
import type { EntitlementsReader } from "../application/reader";
import type { ContextResolver } from "./common";

export type FeatureGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
export type RequireFeature = (featureKey: string) => FeatureGuard;

/** Ce que le plugin pose sur l'instance Fastify (`app.entitlements`). */
export interface EntitlementsService {
  reader: EntitlementsReader;
  resolveContext: ContextResolver;
  requireFeature: RequireFeature;
}

function assertValidKey(featureKey: string): void {
  if (!FeatureKeySchema.safeParse(featureKey).success) {
    // Erreur de programmation détectée au démarrage (à l'appel de la fabrique), pas à la première requête.
    throw new TypeError(`requireFeature : clé de feature invalide « ${featureKey} ».`);
  }
}

/**
 * Refus métier (feature non accordée) : la réponse 403 est ENVOYÉE par le garde lui-même, pour ne pas
 * dépendre du gestionnaire d'erreurs de l'application hôte (un AppError sans gestionnaire donnerait 500).
 * Les erreurs inattendues (base indisponible, tenant inconnu…) sont, elles, levées : jamais de passage en force.
 */
async function check(
  reader: EntitlementsReader,
  request: FastifyRequest,
  reply: FastifyReply,
  tenantId: string,
  featureKey: string,
): Promise<FastifyReply | void> {
  const ent = await reader.getEntitlements(tenantId);
  if (ent.features.includes(featureKey)) return;
  const denial = new ForbiddenError("Cette fonctionnalité n'est pas incluse dans l'abonnement de votre établissement.", {
    code: "entitlements.feature_not_available",
    details: { feature: featureKey, reason: ent.reason },
  });
  return reply.status(denial.httpStatus).send(toErrorBody(denial, request.id));
}

/** Fabrique liée explicitement à un lecteur (tests, usages hors plugin). */
export function createRequireFeature(reader: EntitlementsReader, resolveContext: ContextResolver): RequireFeature {
  return (featureKey) => {
    assertValidKey(featureKey);
    return async (request, reply) => check(reader, request, reply, resolveContext(request).tenantId, featureKey);
  };
}

/** Fabrique utilisable partout : résout le lecteur au moment de la requête via `request.server.entitlements`. */
export function requireFeature(featureKey: string): FeatureGuard {
  assertValidKey(featureKey);
  return async (request, reply) => {
    const service = (request.server as unknown as { entitlements?: EntitlementsService }).entitlements;
    if (!service) {
      throw new InternalError("Le plugin entitlements n'est pas enregistré : contrôle de feature impossible.", {
        code: "entitlements.not_registered",
      });
    }
    return check(service.reader, request, reply, service.resolveContext(request).tenantId, featureKey);
  };
}
