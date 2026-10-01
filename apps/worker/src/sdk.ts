/**
 * SDK à l'usage des modules (`modules/<key>/subscribers.ts` et `jobs.ts`).
 *
 * Ce fichier est VOLONTAIREMENT sans dépendance d'exécution (types seulement) :
 * un module peut l'importer sans embarquer BullMQ, Redis ni pg. Tout est
 * structurellement typé, un module peut donc aussi exporter de simples objets
 * `{ name, pattern, handler }` sans rien importer.
 *
 *   // modules/finance/subscribers.ts
 *   import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
 *   export default [
 *     defineSubscriber({
 *       name: "finance.send-receipt",
 *       pattern: "finance.payment.completed",
 *       retry: { attempts: 5 },
 *       handler: idempotent("finance.send-receipt", async (event, ctx, tx) => { ... }),
 *     }),
 *   ];
 */
import type { DomainEvent, Logger, RequestContext } from "@ecoledigitale/kernel";
import type { RunOptions, SystemDb, TenantRef, Tx } from "@ecoledigitale/database";

/** `TenantDb` déjà lié au tenant de l'événement : impossible d'agir sur un autre tenant. */
export interface ScopedTenantDb {
  readonly ctx: RequestContext;
  run<T>(fn: (tx: Tx) => Promise<T>, options?: RunOptions): Promise<T>;
}

export interface EventHandlerContext {
  readonly tenantId: string;
  readonly db: ScopedTenantDb;
  /**
   * Accès système explicite et audité (raison obligatoire), pour les RARES traitements transverses
   * (ADR-004 §5). Par défaut, utilisez `db` : lié au tenant de l'événement.
   */
  readonly systemDb: SystemDb;
  /** Logger enfant : porte déjà jobId, tenantId, eventId, eventType, subscriber. */
  readonly logger: Logger;
  readonly subscriber: string;
  /** Numéro de la tentative en cours (1 = première). */
  readonly attempt: number;
  readonly jobId: string;
}

export type SubscriberHandler<P = unknown> = (
  event: DomainEvent<string, P>,
  ctx: EventHandlerContext,
) => Promise<void> | void;

export interface RetryOptions {
  /** Nombre total de tentatives (défaut 5). Au-delà : dead-letter queue. */
  attempts?: number;
  /** Délai initial du backoff exponentiel (défaut 1000 ms). */
  backoffMs?: number;
  /** Plafond du délai (défaut 300 000 ms). */
  maxBackoffMs?: number;
}

export interface SubscriberOptions {
  /**
   * Nom STABLE et unique : nom de la file, clé d'idempotence (`processed_events.subscriber`).
   * Le renommer revient à créer un nouvel abonné (il retraitera les événements en attente).
   */
  name: string;
  retry?: RetryOptions;
  /** Handlers exécutés en parallèle dans CE processus (défaut 5). */
  concurrency?: number;
  /** Délai maximal d'une tentative (défaut 120 000 ms). */
  timeoutMs?: number;
}

export interface SubscriberDefinition<P = any> extends SubscriberOptions {
  /** Type exact (`finance.payment.completed`), motif (`finance.*`, `finance.**`, `**`) ou RegExp. */
  pattern: string | RegExp;
  handler: SubscriberHandler<P>;
}

export const SUBSCRIBER_NAME_RE = /^[a-z][a-z0-9_.-]{0,62}$/;

export function defineSubscriber<P = any>(def: SubscriberDefinition<P>): SubscriberDefinition<P> {
  if (!def || typeof def !== "object") throw new Error("defineSubscriber : définition manquante.");
  if (!SUBSCRIBER_NAME_RE.test(def.name ?? "")) {
    throw new Error(`Abonné "${String(def.name)}" : nom invalide (minuscules, chiffres, ".", "_", "-", 63 max).`);
  }
  if (typeof def.handler !== "function") throw new Error(`Abonné "${def.name}" : handler manquant.`);
  if (typeof def.pattern !== "string" && !(def.pattern instanceof RegExp)) {
    throw new Error(`Abonné "${def.name}" : pattern attendu (chaîne ou RegExp).`);
  }
  return def;
}

/**
 * Rend un handler IDEMPOTENT. Dans UNE transaction du tenant de l'événement :
 *   1. réserve `(subscriber, event_id)` dans `kernel.processed_events` ;
 *   2. si la ligne existait déjà -> l'événement est ignoré (déjà traité) ;
 *   3. sinon exécute `handler(event, ctx, tx)` dans la même transaction.
 * Les effets en base du handler et la marque « traité » sont donc validés ou
 * annulés ENSEMBLE : un échec laisse l'événement rejouable, un doublon ne
 * produit aucun second effet. Deux livraisons simultanées s'excluent (la seconde
 * attend la fin de la première).
 *
 * Limite : un effet externe (e-mail, HTTP) n'est pas annulable. Donnez-lui sa
 * propre clé d'idempotence (`event.id`) ou faites-le APRÈS le commit.
 */
export function idempotent<P = any>(
  subscriber: string,
  handler: (event: DomainEvent<string, P>, ctx: EventHandlerContext, tx: Tx) => Promise<void> | void,
): SubscriberHandler<P> {
  return async (event, ctx) => {
    await ctx.db.run(async (tx) => {
      const claim = await tx.query(
        `INSERT INTO kernel.processed_events (tenant_id, subscriber, event_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (subscriber, event_id) DO NOTHING`,
        [ctx.tenantId, subscriber, event.id],
      );
      if (claim.rowCount === 0) {
        ctx.logger.info({ eventId: event.id, subscriber }, "événement déjà traité par cet abonné : ignoré");
        return;
      }
      await handler(event, ctx, tx);
    });
  };
}

// ---------------------------------------------------------------------------
// Jobs planifiés
// ---------------------------------------------------------------------------

interface ScheduledJobBase {
  /** Nom stable et unique (identifiant de la planification dans Redis). */
  name: string;
  /** Expression cron à 5 champs (ou 6 avec les secondes), dans le fuseau `WORKER_TZ`. */
  cron: string;
  /** Durée de vie du verrou d'unicité, renouvelé tant que le job tourne (défaut 5 min). */
  lockTtlMs?: number;
}

export interface GlobalJobContext {
  readonly name: string;
  readonly logger: Logger;
  /** Accès explicite et audité (tables globales ; `forEachTenant` / `runForTenant` pour les tenants). */
  readonly systemDb: SystemDb;
}

export interface TenantJobContext extends GlobalJobContext {
  readonly tenant: TenantRef;
  /** Lié au tenant : plusieurs `run` courts (traitement par lots) plutôt qu'une longue transaction. */
  readonly db: ScopedTenantDb;
}

export interface GlobalScheduledJob extends ScheduledJobBase {
  perTenant?: false;
  handler: (ctx: GlobalJobContext) => Promise<void> | void;
}

export interface TenantScheduledJob extends ScheduledJobBase {
  /** Le handler est appelé une fois par tenant actif ; l'échec d'un tenant n'arrête pas les autres. */
  perTenant: true;
  handler: (ctx: TenantJobContext) => Promise<void> | void;
}

export type ScheduledJobDefinition = GlobalScheduledJob | TenantScheduledJob;

export const JOB_NAME_RE = /^[a-z][a-z0-9_.-]{0,62}$/;
const CRON_RE = /^\s*\S+(\s+\S+){4,5}\s*$/;

export function defineScheduledJob(def: ScheduledJobDefinition): ScheduledJobDefinition {
  if (!def || typeof def !== "object") throw new Error("defineScheduledJob : définition manquante.");
  if (!JOB_NAME_RE.test(def.name ?? "")) {
    throw new Error(`Job "${String(def.name)}" : nom invalide (minuscules, chiffres, ".", "_", "-", 63 max).`);
  }
  if (typeof def.cron !== "string" || !CRON_RE.test(def.cron)) {
    throw new Error(`Job "${def.name}" : expression cron invalide (5 ou 6 champs attendus).`);
  }
  if (typeof def.handler !== "function") throw new Error(`Job "${def.name}" : handler manquant.`);
  if (def.lockTtlMs !== undefined && !(def.lockTtlMs >= 1000)) {
    throw new Error(`Job "${def.name}" : lockTtlMs doit être ≥ 1000.`);
  }
  return def;
}
