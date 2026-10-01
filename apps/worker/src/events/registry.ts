/**
 * Registre des abonnés. Un abonné = (nom stable, motif de types, handler, retry, concurrence).
 * Alimenté par la découverte automatique de `modules/<key>/subscribers.ts` ou, de façon
 * impérative, par `registerSubscriber(...)`.
 */
import { SUBSCRIBER_NAME_RE, defineSubscriber, type SubscriberDefinition, type SubscriberHandler, type SubscriberOptions } from "../sdk";
import { compilePattern, type TypeMatcher } from "./pattern";

export interface ResolvedSubscriber extends SubscriberDefinition {
  readonly attempts: number;
  readonly backoffMs: number;
  readonly maxBackoffMs: number;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly matches: TypeMatcher;
  /** Nom de la file BullMQ de cet abonné. */
  readonly queueName: string;
}

export const DEFAULT_RETRY_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_MS = 1_000;
export const DEFAULT_MAX_BACKOFF_MS = 300_000;
export const DEFAULT_SUBSCRIBER_CONCURRENCY = 5;
export const DEFAULT_HANDLER_TIMEOUT_MS = 120_000;

export const subscriberQueueName = (name: string): string => `domain-events-sub-${name}`;

function positiveInt(value: unknown, fallback: number, label: string, subscriber: string, min = 1): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min) {
    throw new Error(`Abonné "${subscriber}" : ${label} doit être un entier ≥ ${min}.`);
  }
  return value as number;
}

export class SubscriberRegistry {
  private readonly byName = new Map<string, ResolvedSubscriber>();

  add(definition: SubscriberDefinition, source = "code"): ResolvedSubscriber {
    const def = defineSubscriber(definition);
    if (this.byName.has(def.name)) {
      throw new Error(`Abonné "${def.name}" déclaré deux fois (dernière source : ${source}). Les noms doivent être uniques.`);
    }
    const attempts = positiveInt(def.retry?.attempts, DEFAULT_RETRY_ATTEMPTS, "retry.attempts", def.name);
    const backoffMs = positiveInt(def.retry?.backoffMs, DEFAULT_BACKOFF_MS, "retry.backoffMs", def.name, 1);
    const maxBackoffMs = positiveInt(def.retry?.maxBackoffMs, DEFAULT_MAX_BACKOFF_MS, "retry.maxBackoffMs", def.name, 1);
    if (maxBackoffMs < backoffMs) throw new Error(`Abonné "${def.name}" : retry.maxBackoffMs < retry.backoffMs.`);
    const resolved: ResolvedSubscriber = {
      ...def,
      attempts,
      backoffMs,
      maxBackoffMs,
      concurrency: positiveInt(def.concurrency, DEFAULT_SUBSCRIBER_CONCURRENCY, "concurrency", def.name),
      timeoutMs: positiveInt(def.timeoutMs, DEFAULT_HANDLER_TIMEOUT_MS, "timeoutMs", def.name, 100),
      matches: compilePattern(def.pattern),
      queueName: subscriberQueueName(def.name),
    };
    this.byName.set(def.name, resolved);
    return resolved;
  }

  /** Abonnés intéressés par ce type d'événement, dans l'ordre d'enregistrement. */
  match(eventType: string): ResolvedSubscriber[] {
    return [...this.byName.values()].filter((s) => s.matches(eventType));
  }

  get(name: string): ResolvedSubscriber | undefined {
    return this.byName.get(name);
  }

  all(): ResolvedSubscriber[] {
    return [...this.byName.values()];
  }

  get size(): number {
    return this.byName.size;
  }
}

/** Registre par défaut du processus (pour `registerSubscriber`). */
export const defaultRegistry = new SubscriberRegistry();

/**
 * Enregistre un abonné de façon impérative.
 *
 *   registerSubscriber("finance.payment.completed", handler, { name: "finance.send-receipt", retry: { attempts: 5 }, concurrency: 3 });
 */
export function registerSubscriber(
  pattern: string | RegExp,
  handler: SubscriberHandler,
  options: SubscriberOptions,
  registry: SubscriberRegistry = defaultRegistry,
): ResolvedSubscriber {
  return registry.add({ ...options, pattern, handler }, "registerSubscriber");
}

export { SUBSCRIBER_NAME_RE };
