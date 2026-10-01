/**
 * Plugin Fastify qui ouvre, pour chaque requête, la portée `ip / user-agent` lue par
 * `audit.record`. À enregistrer UNE fois au niveau racine de l'application (il est en
 * `fastify-plugin`, donc non encapsulé : le hook s'applique à toutes les routes).
 *
 * Fiabilité de `request.ip` : derrière un proxy/load balancer, Fastify doit être créé avec
 * `trustProxy` correctement réglé, sinon l'IP journalisée est celle du proxy.
 */
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { runWithAuditRequestMeta } from "../application/request-meta";

async function auditRequestMetaPlugin(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", (request, _reply, done) => {
    const ua = request.headers["user-agent"];
    runWithAuditRequestMeta(
      {
        ip: request.ip,
        userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
        requestId: typeof request.id === "string" ? request.id : String(request.id),
      },
      done,
    );
  });
}

export default fp(auditRequestMetaPlugin, { name: "audit-request-meta" });
