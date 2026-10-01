/**
 * Abonnés du module `audit` pour `apps/worker` (découverts automatiquement : `modules/<key>/subscribers.ts`).
 *
 * UN abonné par entrée de `AUDIT_EVENT_SUBSCRIPTIONS` (routage précis : le worker ne livre au module audit
 * que les événements qu'il journalise). Le motif « préfixe » du module (`tenancy.*` = tout ce qui commence par
 * `tenancy.`) devient le motif du worker `tenancy.**` (`*` y vaut EXACTEMENT un segment).
 *
 * Pas de `idempotent()` ici : la clé primaire du journal (tenant, occurred_at, id = id de l'événement) fait
 * déjà le dédoublonnage (`idempotent: true` dans l'entrée) et `consumeAuditEvent` ouvre ses propres
 * transactions (`SystemDb.runForTenant` / `run` pour le journal de plateforme) : imbriquer une transaction
 * `ctx.db` serait refusé par TenantDb (changement d'identité).
 *
 * Le worker écrit la chaîne avec la même clé HMAC que l'API (`AUDIT_HMAC_KEY`, cf. `config.ts`).
 */
import { defineSubscriber } from "@ecoledigitale/worker/sdk";
import { consumeAuditEvent } from "./application/event-consumer";
import { AUDIT_EVENT_SUBSCRIPTIONS } from "./domain/events";
import { configureAuditFromEnv } from "./config";
import { audit } from "./service";

let configured = false;
function ensureConfigured(logger: { warn(o: object, m: string): void; info(o: object, m: string): void }): void {
  if (configured) return;
  configureAuditFromEnv(audit, process.env, { logger });
  configured = true;
}

/** `tenancy.*` -> `tenancy.**` ; un type exact reste inchangé. */
export function workerPatternOf(auditPattern: string): string {
  return auditPattern.endsWith(".*") ? `${auditPattern.slice(0, -2)}.**` : auditPattern;
}

/** Nom d'abonné stable : `audit.iam-login-failed`, `audit.tenancy`. */
export function subscriberNameOf(auditPattern: string): string {
  return `audit.${auditPattern.replace(/\.\*$/, "").replace(/[^a-z0-9]+/g, "-")}`;
}

export default AUDIT_EVENT_SUBSCRIPTIONS.map((subscription) =>
  defineSubscriber({
    name: subscriberNameOf(subscription.pattern),
    pattern: workerPatternOf(subscription.pattern),
    retry: { attempts: 8, backoffMs: 1_000, maxBackoffMs: 300_000 },
    concurrency: 4,
    handler: async (event, ctx) => {
      ensureConfigured(ctx.logger);
      const outcome = await consumeAuditEvent({ systemDb: ctx.systemDb, audit }, event);
      if (outcome.status === "ignored") {
        ctx.logger.info({ eventType: event.type, reason: outcome.reason }, "audit : événement non journalisé");
      }
    },
  }),
);
