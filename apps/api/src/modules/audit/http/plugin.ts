/**
 * Plugin Fastify du module `audit` — LECTURE SEULE.
 *
 *   GET /logs            liste filtrée, pagination par curseur        audit.read
 *   GET /logs/export     export CSV borné (période <= 31 j, 10 000 l) audit.export (sensible)
 *   GET /logs/:id        détail d'une entrée                            audit.read
 *   GET /verify          contrôle d'intégrité de la chaîne             audit.read
 *
 * Aucune route POST/PUT/PATCH/DELETE : le journal ne s'écrit que par `audit.record`.
 * À enregistrer avec le préfixe `/api/v1/audit` :
 *
 *   app.register(auditPlugin, { prefix: "/api/v1/audit", tenantDb, contextOf, requirePermission });
 *
 * Les dépendances d'authentification sont INJECTÉES (le module n'importe ni `iam` ni `rbac`,
 * ADR-001) ; sans elles le plugin refuse de démarrer (échec fermé).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler, preHandlerHookHandler } from "fastify";
import { InternalError, ValidationError, toAppError, toErrorBody, type RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import type { ZodType, ZodTypeDef } from "zod";
import {
  auditLogExportQuerySchema,
  auditLogIdParamsSchema,
  auditLogListQuerySchema,
  auditVerifyQuerySchema,
  type AuditChainVerificationDto,
  type AuditLogEntryDto,
  type AuditLogSummaryDto,
} from "@ecoledigitale/contracts/src/v2";
import { AuditService } from "../application/audit-service";
import { exportLogsCsv, getAuditLog, listAuditLogs } from "../application/queries";
import type { StoredAuditEntry } from "../domain/types";
import type { LogFilter } from "../infrastructure/log-repository";
import { audit as defaultAudit } from "../service";

export interface AuditHttpOptions {
  tenantDb: TenantDb;
  /** Construit le RequestContext (tenant, utilisateur, rôles…) depuis la requête authentifiée. */
  contextOf: (request: FastifyRequest) => RequestContext;
  /** Garde de permission fournie par le module `rbac` (`requirePermission('audit.read')`). */
  requirePermission: (permission: string) => preHandlerHookHandler | preHandlerAsyncHookHandler;
  /** Service d'audit (défaut : singleton du module). */
  audit?: AuditService;
}

export function toSummaryDto(e: StoredAuditEntry): AuditLogSummaryDto {
  return {
    id: e.id,
    tenantId: e.tenantId as string,
    seq: e.seq,
    occurredAt: e.occurredAt,
    recordedAt: e.recordedAt,
    actorType: e.actorType,
    actorId: e.actorId,
    impersonatedBy: e.impersonatedBy,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    diff: (e.diff ?? null) as AuditLogSummaryDto["diff"],
    ip: e.ip,
    device: e.device,
    requestId: e.requestId,
    reason: e.reason,
    severity: e.severity,
    hash: e.hash,
  };
}

export function toDetailDto(e: StoredAuditEntry): AuditLogEntryDto {
  return {
    ...toSummaryDto(e),
    before: e.before,
    after: e.after,
    metadata: (e.metadata ?? null) as AuditLogEntryDto["metadata"],
    userAgent: e.userAgent,
    hashAlg: e.hashAlg,
    prevHash: e.prevHash,
  };
}

function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      "Paramètres invalides.",
      result.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
    );
  }
  return result.data;
}

export default async function auditPlugin(app: FastifyInstance, options: AuditHttpOptions): Promise<void> {
  if (!options?.tenantDb || typeof options.contextOf !== "function" || typeof options.requirePermission !== "function") {
    throw new InternalError("Plugin audit : tenantDb, contextOf et requirePermission sont obligatoires.", {
      code: "AUDIT_HTTP_MISCONFIGURED",
    });
  }
  const { tenantDb, contextOf, requirePermission } = options;
  const audit = options.audit ?? defaultAudit;

  /** Exécute `fn` et traduit toute erreur en corps d'erreur normalisé. */
  const guarded =
    (fn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      try {
        return await fn(request, reply);
      } catch (error) {
        const appError = toAppError(error);
        if (appError.kind === "internal") request.log.error({ err: error }, "audit: erreur interne");
        return reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
      }
    };

  app.get(
    "/logs",
    { preHandler: requirePermission("audit.read") },
    guarded(async (request) => {
      const query = parse(auditLogListQuerySchema, request.query);
      const ctx = contextOf(request);
      const filter: LogFilter = {
        actorId: query.actorId,
        entity: query.entity,
        entityId: query.entityId,
        action: query.action,
        severity: query.severity,
        from: query.from,
        to: query.to,
      };
      const page = await tenantDb.run(ctx, (tx) => listAuditLogs(tx, ctx.tenantId, filter, { cursor: query.cursor, limit: query.limit }), {
        readOnly: true,
      });
      return { items: page.items.map(toSummaryDto), nextCursor: page.nextCursor };
    }),
  );

  // Déclaré avant `/logs/:id` par lisibilité (find-my-way donne de toute façon priorité au statique).
  app.get(
    "/logs/export",
    { preHandler: requirePermission("audit.export") },
    guarded(async (request, reply) => {
      const query = parse(auditLogExportQuerySchema, request.query);
      const ctx = contextOf(request);
      const filter = {
        actorId: query.actorId,
        entity: query.entity,
        entityId: query.entityId,
        action: query.action,
        severity: query.severity,
        from: query.from,
        to: query.to,
      };
      // Pas en lecture seule : l'export journalise sa propre exécution.
      const result = await tenantDb.run(ctx, (tx) => exportLogsCsv(tx, audit, ctx.tenantId, filter, query.limit));
      const day = new Date().toISOString().slice(0, 10);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="audit-${day}.csv"`)
        .header("Cache-Control", "no-store")
        .header("X-Audit-Export-Rows", String(result.rows))
        .header("X-Audit-Export-Truncated", String(result.truncated))
        .send(result.csv);
    }),
  );

  app.get(
    "/logs/:id",
    { preHandler: requirePermission("audit.read") },
    guarded(async (request) => {
      const { id } = parse(auditLogIdParamsSchema, request.params);
      const ctx = contextOf(request);
      const entry = await tenantDb.run(ctx, (tx) => getAuditLog(tx, ctx.tenantId, id), { readOnly: true });
      return toDetailDto(entry);
    }),
  );

  app.get(
    "/verify",
    { preHandler: requirePermission("audit.read") },
    guarded(async (request): Promise<AuditChainVerificationDto> => {
      const query = parse(auditVerifyQuerySchema, request.query);
      const ctx = contextOf(request);
      return tenantDb.run(
        ctx,
        (tx) =>
          audit.verifyChain(tx, ctx.tenantId, {
            fromSeq: query.fromSeq,
            toSeq: query.toSeq,
            from: query.from,
            to: query.to,
          }),
        { readOnly: true },
      ) as Promise<AuditChainVerificationDto>;
    }),
  );
}
