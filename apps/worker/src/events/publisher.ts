/**
 * Publication des événements vers BullMQ et file des échecs définitifs (DLQ).
 *
 * DÉDOUBLONNAGE : le `jobId` d'un job `domain-events` EST l'identifiant de
 * l'événement. BullMQ ignore un `add` dont le jobId existe déjà (quel que soit
 * son état) : republier un événement après un crash entre « add » et « commit »
 * ne crée donc pas de doublon tant que le job n'a pas été purgé
 * (`removeOnComplete.age`, 24 h par défaut). Au-delà, ou pour les effets de bord,
 * les handlers restent idempotents (`kernel.processed_events`).
 */
import type { DomainEvent } from "@ecoledigitale/kernel";
import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";

export const DOMAIN_EVENTS_QUEUE = "domain-events";
export const DEAD_LETTER_QUEUE = "domain-events-dead";

/** Conservation des jobs terminés : fenêtre de dédoublonnage de BullMQ. */
export const COMPLETED_RETENTION = { age: 24 * 3600, count: 100_000 } as const;
export const FAILED_RETENTION = { age: 7 * 24 * 3600, count: 50_000 } as const;

/** Tentatives du routage (jobs `domain-events` -> files des abonnés). */
export const ROUTER_ATTEMPTS = 10;

export function eventJobOptions(event: Pick<DomainEvent, "id">, attempts = ROUTER_ATTEMPTS): JobsOptions {
  return {
    jobId: event.id,
    attempts,
    backoff: { type: "custom" },
    removeOnComplete: COMPLETED_RETENTION,
    removeOnFail: FAILED_RETENTION,
  };
}

export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
  publishMany(events: readonly DomainEvent[]): Promise<void>;
  /** `true` si Redis répond (distingue une panne d'infrastructure d'un événement « empoisonné »). */
  isHealthy(): Promise<boolean>;
}

export class BullEventPublisher implements EventPublisher {
  constructor(private readonly queue: Queue) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.queue.add(event.type, { event }, eventJobOptions(event));
  }

  async publishMany(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.queue.addBulk(events.map((event) => ({ name: event.type, data: { event }, opts: eventJobOptions(event) })));
  }

  async isHealthy(): Promise<boolean> {
    try {
      const client = await this.queue.client;
      return (await client.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}

export function createDomainEventsQueue(connection: Redis, prefix: string): Queue {
  return new Queue(DOMAIN_EVENTS_QUEUE, { connection: connection as ConnectionOptions, prefix });
}

// ---------------------------------------------------------------------------
// Dead-letter queue
// ---------------------------------------------------------------------------

export type DeadLetterKind = "relay" | "router" | "handler";

export interface DeadLetterRecord {
  kind: DeadLetterKind;
  event: DomainEvent;
  /** Pour `handler` : l'abonné qui a échoué. */
  subscriber?: string;
  error: string;
  attempts: number;
  failedAt: string;
}

export interface DeadLetter {
  push(record: DeadLetterRecord): Promise<void>;
}

export function deadLetterJobId(record: Pick<DeadLetterRecord, "kind" | "event" | "subscriber">): string {
  // « : » est interdit dans un jobId BullMQ.
  return record.kind === "handler"
    ? `handler__${record.subscriber}__${record.event.id}`
    : `${record.kind}__${record.event.id}`;
}

/**
 * Les jobs de la DLQ n'ont pas de consommateur : ils restent à l'état `waiting`
 * jusqu'à ce qu'un opérateur les rejoue ou les supprime (`pnpm --filter @ecoledigitale/worker dlq`).
 */
export class BullDeadLetter implements DeadLetter {
  constructor(private readonly queue: Queue) {}

  async push(record: DeadLetterRecord): Promise<void> {
    await this.queue.add(record.kind, record, {
      jobId: deadLetterJobId(record),
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}

export function createDeadLetterQueue(connection: Redis, prefix: string): Queue {
  return new Queue(DEAD_LETTER_QUEUE, { connection: connection as ConnectionOptions, prefix });
}
