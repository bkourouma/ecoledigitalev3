/**
 * Abonnés du module `higher` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `higher.capitalize-on-period-closed`   `results.period.closed` -> registre de crédits (acquisitions, révocation d'une
 *    écriture remplacée par une reclôture, dettes d'UE, issue des rattrapages). Aucune évaluation de diplôme ici.
 *  - `higher.evaluate-diplomas-on-capitalized`  `higher.credits.capitalized` -> éligibilité aux diplômes ACTIFS qui exigent
 *    l'UE, octroi automatique. ABONNÉ DISTINCT, transaction PROPRE : sa défaillance (règle indisponible…) ne bloque ni
 *    n'annule jamais la capitalisation (R-HIG-10) ; le worker le rejoue (reprises puis dead-letter).
 *
 * Le nom et le payload de `results.period.closed` sont ceux de `specs/v2/011-assessments-grades/interfaces-publiees.md`
 * (`classroomId`, `academicPeriodId`, `stateId`, `resultsVersion`) ; les identifiants sont lus avec tolérance.
 * Ports : le worker n'a pas d'application Fastify. Les modules voisins (results, academic, people, reportcards)
 * enregistrent les leurs par `registerHigherWorkerPorts` (`worker-ports.ts`) depuis leur propre `subscribers.ts` ; le port des
 * règles est fourni ici (API du module rules sur le `TenantDb` du worker). À défaut d'un port, les abonnés ÉCHOUENT FERMÉ
 * (`higher.port_unavailable`) et l'événement est rejoué.
 * Tous les abonnés sont idempotents (`idempotent()` : marque « traité » dans la transaction de l'effet).
 */
import { defineSubscriber, idempotent, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import type { AppError } from "@ecoledigitale/kernel";
import { audit, configureAuditFromEnv } from "../audit";
import { createRulesApi, createRulesDeps, type RulesApi } from "../rules";
import { createHigherDeps, type HigherDeps } from "./application/deps";
import { isBenignConsumerError, onCreditsCapitalized, onResultsPeriodClosed } from "./application/consumers";
import { ConsumedEvents } from "./domain/events";
import { higherAuditAdapter } from "./infrastructure/audit-adapter";
import { createRulesAdapter } from "./infrastructure/rules-adapter";
import { workerPorts } from "./worker-ports";

let auditConfigured = false;
let rulesApi: RulesApi | undefined;

/** Dépendances d'un abonné : audit branché (même clé HMAC que l'API) ; ports résolus par le worker (`workerPorts`). */
function defaultDepsOf(ctx: EventHandlerContext): HigherDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger: ctx.logger });
    auditConfigured = true;
  }
  // Port des règles par défaut : l'API du module rules construite sur le TenantDb du worker (cache de versions compilées partagé).
  rulesApi ??= createRulesApi(createRulesDeps({ db: ctx.tenantDb, systemDb: ctx.systemDb, logger: ctx.logger }));
  const rules = createRulesAdapter(() => rulesApi);
  return createHigherDeps({
    db: ctx.tenantDb,
    logger: ctx.logger,
    portsProvider: () => ({ rules, ...workerPorts() }),
    audit: higherAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
  });
}

function settle(result: { ok: true } | { ok: false; error: AppError }, ctx: EventHandlerContext): void {
  if (result.ok) return;
  if (isBenignConsumerError(result.error)) {
    ctx.logger.warn({ code: result.error.code }, "higher : événement ignoré");
    return;
  }
  throw result.error; // transitoire ou inattendu : le worker rejoue (reprises puis dead-letter)
}

export function buildSubscribers(depsOf: (ctx: EventHandlerContext) => HigherDeps): SubscriberDefinition[] {
  return [
    defineSubscriber({
      name: "higher.capitalize-on-period-closed",
      pattern: ConsumedEvents.RESULTS_PERIOD_CLOSED,
      retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
      handler: idempotent("higher.capitalize-on-period-closed", async (event, ctx) => {
        settle(await onResultsPeriodClosed(depsOf(ctx), ctx.db.ctx, event.payload), ctx);
      }),
    }),
    defineSubscriber({
      name: "higher.evaluate-diplomas-on-capitalized",
      pattern: ConsumedEvents.CREDITS_CAPITALIZED,
      retry: { attempts: 8, backoffMs: 2_000, maxBackoffMs: 300_000 },
      handler: idempotent("higher.evaluate-diplomas-on-capitalized", async (event, ctx) => {
        settle(await onCreditsCapitalized(depsOf(ctx), ctx.db.ctx, event.payload), ctx);
      }),
    }),
  ];
}

export default buildSubscribers(defaultDepsOf);
