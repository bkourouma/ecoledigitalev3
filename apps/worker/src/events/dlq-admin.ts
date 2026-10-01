/**
 * Exploitation de la DLQ `domain-events-dead` : lister, rejouer, supprimer.
 *
 * Rejouer selon l'origine de l'échec :
 *  - relay   : l'événement est encore dans `kernel.domain_events` (non publié, available_at = infinity).
 *              On remet `attempts = 0`, `available_at = now()` : le relais le reprend.
 *  - router  : on relance le job `domain-events` correspondant (ou on le recrée).
 *  - handler : on relance le job de la file de l'abonné (ou on le recrée). L'idempotence
 *              (`processed_events`) garantit qu'un effet déjà appliqué ne l'est pas deux fois.
 * Après un rejeu réussi, l'entrée de la DLQ est supprimée.
 */
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { SystemDb } from "@ecoledigitale/database";
import { eventJobOptions, DEAD_LETTER_QUEUE, DOMAIN_EVENTS_QUEUE, type DeadLetterRecord } from "./publisher";
import { subscriberQueueName } from "./registry";

export interface DeadLetterEntry {
  id: string;
  record: DeadLetterRecord;
}

export class DeadLetterAdmin {
  private readonly dead: Queue;
  private readonly opened = new Map<string, Queue>();

  constructor(
    private readonly connection: Redis,
    private readonly prefix: string,
    private readonly systemDb?: SystemDb,
  ) {
    this.dead = new Queue(DEAD_LETTER_QUEUE, { connection, prefix });
  }

  private queue(name: string): Queue {
    let q = this.opened.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, prefix: this.prefix });
      this.opened.set(name, q);
    }
    return q;
  }

  async count(): Promise<number> {
    return this.dead.count();
  }

  async list(limit = 100, kind?: DeadLetterRecord["kind"]): Promise<DeadLetterEntry[]> {
    const jobs = await this.dead.getJobs(["waiting", "delayed", "paused", "prioritized"], 0, Math.max(limit, 1) * 3, true);
    return jobs
      .filter((j) => j && j.id)
      .map((j) => ({ id: String(j.id), record: j.data as DeadLetterRecord }))
      .filter((e) => !kind || e.record.kind === kind)
      .slice(0, limit);
  }

  /** Rejoue une entrée. Renvoie `true` si elle a été remise en circulation. */
  async replay(id: string): Promise<boolean> {
    const job = await this.dead.getJob(id);
    if (!job) return false;
    const record = job.data as DeadLetterRecord;
    const { event } = record;

    if (record.kind === "relay") {
      if (!this.systemDb) throw new Error("Rejeu d'un échec du relais : accès PostgreSQL requis (WORKER_DATABASE_URL).");
      const reset = await this.systemDb.runForTenant("dlq-replay-relay", event.tenantId, async (tx) =>
        tx.query(
          `UPDATE kernel.domain_events
              SET attempts = 0, available_at = now(), last_error = NULL
            WHERE id = $1 AND published_at IS NULL`,
          [event.id],
        ),
      );
      if (reset.rowCount === 0) {
        // Déjà publié ou purgé : rien à rejouer côté outbox, l'entrée est obsolète.
        await job.remove();
        return false;
      }
    } else {
      const queueName = record.kind === "router" ? DOMAIN_EVENTS_QUEUE : subscriberQueueName(record.subscriber as string);
      const target = this.queue(queueName);
      const previous = await target.getJob(event.id);
      if (!previous || (await previous.isFailed())) {
        // Un job échoué garde son compteur de tentatives (`retry` ne le remet pas à zéro) : on le
        // recrée à neuf, avec le même jobId et les mêmes tentatives, pour que le rejeu bénéficie
        // du retry complet.
        const attempts = previous?.opts.attempts ?? 5;
        await previous?.remove();
        await target.add(event.type, { event }, eventJobOptions(event, attempts));
      } else {
        // Le job existe dans un autre état (en attente, en cours, terminé) : il sera/a été traité.
        await job.remove();
        return false;
      }
    }
    await job.remove();
    return true;
  }

  async replayAll(kind?: DeadLetterRecord["kind"]): Promise<{ replayed: number; skipped: number }> {
    let replayed = 0;
    let skipped = 0;
    for (const entry of await this.list(10_000, kind)) {
      if (await this.replay(entry.id)) replayed += 1;
      else skipped += 1;
    }
    return { replayed, skipped };
  }

  async remove(id: string): Promise<boolean> {
    const job = await this.dead.getJob(id);
    if (!job) return false;
    await job.remove();
    return true;
  }

  async close(): Promise<void> {
    await Promise.all([this.dead.close(), ...[...this.opened.values()].map((q) => q.close())]);
  }
}
