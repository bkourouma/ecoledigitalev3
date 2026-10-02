/**
 * Statistiques des files BullMQ (profondeur par état, âge du plus ancien job en attente), lues À LA DEMANDE avec un cache
 * court : un scrape Prometheus toutes les 15 s ne doit pas coûter ≈ 2 commandes Redis par file et par scrape (≈ 60 files).
 */
import type { Queue } from "bullmq";
import type { QueueSnapshot } from "./metrics";

const STATES = ["waiting", "active", "delayed", "failed", "paused"] as const;

export async function snapshotQueue(name: string, queue: Queue, now: () => number = Date.now): Promise<QueueSnapshot> {
  const counts = await queue.getJobCounts(...STATES);
  let oldestWaitingSeconds = 0;
  if ((counts.waiting ?? 0) > 0) {
    // asc = true : du plus ancien au plus récent (BullMQ renvoie sinon le plus récent d'abord).
    const [oldest] = await queue.getJobs(["waiting"], 0, 0, true);
    if (oldest?.timestamp) oldestWaitingSeconds = Math.max(0, (now() - oldest.timestamp) / 1000);
  }
  return { queue: name, counts: Object.fromEntries(STATES.map((s) => [s, counts[s] ?? 0])), oldestWaitingSeconds };
}

/** Valeur recalculée au plus toutes les `ttlMs` ; les lecteurs simultanés partagent le même calcul ; une erreur garde la dernière valeur. */
export class CachedValue<T> {
  private value: T;
  private loadedAt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
    initial: T,
    private readonly onError?: (err: unknown) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.value = initial;
  }

  async get(): Promise<T> {
    if (this.now() - this.loadedAt >= this.ttlMs) {
      this.inflight ??= this.load().then(
        (v) => {
          this.value = v;
          this.loadedAt = this.now();
        },
        (err) => {
          this.loadedAt = this.now(); // ne pas marteler une dépendance en panne
          this.onError?.(err);
        },
      ).finally(() => {
        this.inflight = null;
      });
      await this.inflight;
    }
    return this.value;
  }
}
