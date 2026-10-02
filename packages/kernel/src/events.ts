/**
 * Événements de domaine, bus en mémoire et port d'écriture d'outbox.
 *
 * - `DomainEvent` est une enveloppe SÉRIALISABLE (JSON) : elle peut être écrite
 *   telle quelle dans l'outbox transactionnelle (`kernel.domain_events`).
 * - `InMemoryEventBus` sert aux réactions in-process, APRÈS commit. Il n'est PAS
 *   durable : tout effet qui doit survivre à un crash passe par l'outbox
 *   (`OutboxWriter`), écrite dans la même transaction que la donnée.
 */
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import type { RequestContext } from "./context";
import { InternalError } from "./errors";
import { newId } from "./id";

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly id: string;
  readonly type: TType;
  /** Version du schéma du payload (incrémentée à chaque changement incompatible). */
  readonly version: number;
  readonly tenantId: string;
  /** Instant d'occurrence, ISO-8601 UTC. */
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly actorId?: string | null;
  readonly requestId?: string;
  /**
   * Contexte de trace W3C (`00-<trace>-<span>-<flags>`) de la requête qui a émis l'événement. Renseigné par
   * l'outbox quand le traçage est actif (ADR-009) ; jamais de donnée personnelle. Absent sinon.
   */
  readonly traceparent?: string;
}

export interface CreateEventInput<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
  /** Contexte d'où sont tirés tenantId, acteur et requestId. */
  ctx: RequestContext;
  version?: number;
  aggregateType?: string;
  aggregateId?: string;
  clock?: Clock;
  id?: string;
}

const TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** Les types sont `domaine.evenement` en minuscules, ex. `student.enrolled`. */
export function isValidEventType(type: string): boolean {
  return TYPE_RE.test(type);
}

export function createDomainEvent<TType extends string, TPayload>(
  input: CreateEventInput<TType, TPayload>,
): DomainEvent<TType, TPayload> {
  if (!isValidEventType(input.type)) {
    throw new InternalError(`Type d'événement invalide : "${input.type}".`, { code: "EVENT_TYPE_INVALID" });
  }
  const version = input.version ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new InternalError("La version d'un événement est un entier ≥ 1.", { code: "EVENT_VERSION_INVALID" });
  }
  return Object.freeze({
    id: input.id ?? newId(),
    type: input.type,
    version,
    tenantId: input.ctx.tenantId,
    occurredAt: (input.clock ?? systemClock).now().toISOString(),
    payload: input.payload,
    actorId: input.ctx.userId,
    requestId: input.ctx.requestId,
    ...(input.aggregateType ? { aggregateType: input.aggregateType } : {}),
    ...(input.aggregateId ? { aggregateId: input.aggregateId } : {}),
  });
}

/** Table `type d'événement → type de payload`. */
export type EventMap = { [type: string]: unknown };

export type EventHandler<TType extends string, TPayload> = (
  event: DomainEvent<TType, TPayload>,
) => void | Promise<void>;

export type Unsubscribe = () => void;

export interface EventBus<M extends EventMap = EventMap> {
  publish<K extends keyof M & string>(event: DomainEvent<K, M[K]>): Promise<void>;
  subscribe<K extends keyof M & string>(type: K, handler: EventHandler<K, M[K]>): Unsubscribe;
  /** Reçoit TOUS les événements (journalisation, tests). */
  subscribeAll(handler: EventHandler<string, unknown>): Unsubscribe;
}

/** Levée par `publish` quand un ou plusieurs handlers ont échoué (mode `throw`). */
export class EventPublishError extends InternalError {
  readonly errors: readonly unknown[];
  readonly eventId: string;
  readonly eventType: string;
  constructor(event: DomainEvent, errors: readonly unknown[]) {
    super(`${errors.length} handler(s) en échec pour l'événement ${event.type}.`, {
      code: "EVENT_HANDLER_FAILED",
      cause: errors[0],
    });
    this.errors = errors;
    this.eventId = event.id;
    this.eventType = event.type;
  }
}

export interface InMemoryEventBusOptions {
  /**
   * `throw`   (défaut) : tous les handlers s'exécutent, puis `publish` rejette
   *            avec `EventPublishError` s'il y a eu des échecs ;
   * `isolate` : les échecs sont transmis à `onError`, `publish` résout toujours.
   */
  errorMode?: "throw" | "isolate";
  onError?: (error: unknown, event: DomainEvent) => void;
}

/**
 * Bus en mémoire. Les handlers d'un même événement s'exécutent SÉQUENTIELLEMENT,
 * dans l'ordre d'abonnement (déterministe) ; un handler en échec n'empêche pas
 * les suivants. Un abonnement ajouté ou retiré pendant un `publish` n'affecte pas
 * ce `publish` (instantané des handlers).
 */
export class InMemoryEventBus<M extends EventMap = EventMap> implements EventBus<M> {
  private readonly byType = new Map<string, Set<EventHandler<string, unknown>>>();
  private readonly all = new Set<EventHandler<string, unknown>>();
  private readonly options: Required<Pick<InMemoryEventBusOptions, "errorMode">> &
    Pick<InMemoryEventBusOptions, "onError">;

  constructor(options: InMemoryEventBusOptions = {}) {
    this.options = { errorMode: options.errorMode ?? "throw", onError: options.onError };
  }

  subscribe<K extends keyof M & string>(type: K, handler: EventHandler<K, M[K]>): Unsubscribe {
    let set = this.byType.get(type);
    if (!set) {
      set = new Set();
      this.byType.set(type, set);
    }
    const h = handler as unknown as EventHandler<string, unknown>;
    set.add(h);
    return () => {
      set?.delete(h);
    };
  }

  subscribeAll(handler: EventHandler<string, unknown>): Unsubscribe {
    this.all.add(handler);
    return () => {
      this.all.delete(handler);
    };
  }

  async publish<K extends keyof M & string>(event: DomainEvent<K, M[K]>): Promise<void> {
    const handlers = [...(this.byType.get(event.type) ?? []), ...this.all];
    const errors: unknown[] = [];
    for (const handler of handlers) {
      try {
        await handler(event as DomainEvent);
      } catch (e) {
        errors.push(e);
        if (this.options.errorMode === "isolate") this.options.onError?.(e, event as DomainEvent);
      }
    }
    if (errors.length > 0 && this.options.errorMode === "throw") {
      throw new EventPublishError(event as DomainEvent, errors);
    }
  }

  /** Nombre d'abonnements (tests). */
  get size(): number {
    let n = this.all.size;
    for (const s of this.byType.values()) n += s.size;
    return n;
  }
}

/**
 * Port d'écriture de l'outbox transactionnelle. L'implémentation (package
 * database) écrit dans la TRANSACTION COURANTE : les événements sont donc
 * validés ou annulés avec la donnée métier, jamais l'un sans l'autre.
 */
export interface OutboxWriter {
  append(events: readonly DomainEvent[]): Promise<void>;
}
