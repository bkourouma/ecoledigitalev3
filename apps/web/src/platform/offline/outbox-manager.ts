/**
 * Moteur de synchronisation de la file d'appel : état observable (React `useSyncExternalStore`), envoi par lot via
 * l'API de sync, reprise après coupure avec attente croissante, un seul envoi à la fois.
 *
 * Indépendant de React et du navigateur (tout est injecté) : testé avec un faux IndexedDB et un faux `post`.
 * La seule route appelée est `POST /api/v1/attendance/sync` (par `deps.post`, voir `OutboxProvider`) : le service worker
 * n'intervient pas (il ignore `/api/` et toute requête authentifiée) et rien de la réponse n'est mis en cache.
 */

import type { AttendanceSyncBatch, AttendanceSyncResultDto } from "@ecoledigitale/contracts/v2/attendance";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { AttendanceOutbox, pendingTotals, type CallTarget, type OutboxCall } from "./attendance-outbox";
import type { OfflineDb } from "./idb";

export type SyncFailure = "network" | "auth" | "server" | null;

export interface OutboxStatus {
  /** Base locale ouverte et file lue. */
  ready: boolean;
  /** Faux : repli en mémoire, la file ne survivra pas à un rechargement. */
  persistent: boolean;
  /** Un utilisateur est connecté (propriétaire de la file). */
  available: boolean;
  online: boolean;
  syncing: boolean;
  calls: ReadonlyArray<OutboxCall>;
  pending: { calls: number; records: number };
  lastSyncAt: string | null;
  failure: SyncFailure;
  /** Instant (ms epoch) du prochain essai automatique, ou null. */
  nextRetryAt: number | null;
}

export interface SyncSummary {
  batches: number;
  applied: number;
  unchanged: number;
  conflicts: number;
  rejected: number;
  failure: SyncFailure;
}

export interface ManagerDeps {
  openDb: () => Promise<OfflineDb>;
  /** `tenant:utilisateur`, ou null. */
  owner: () => string | null;
  /** `POST /api/v1/attendance/sync` : renvoie la réponse VALIDÉE par le contrat, ou lève une `ApiError`. */
  post: (batch: AttendanceSyncBatch) => Promise<AttendanceSyncResultDto>;
  isOnline?: () => boolean;
  now?: () => Date;
  uuid?: () => string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Base du délai de reprise (défaut 5 s, doublé à chaque échec, plafonné à 5 min). */
  retryBaseMs?: number;
  /** Les appels terminés plus vieux que ceci sont effacés à l'ouverture (défaut 24 h). */
  keepDoneMs?: number;
}

const MAX_RETRY_MS = 5 * 60_000;

/** Empreinte de ce qui reste à envoyer (clés d'idempotence + soumission) : détecte un envoi sans aucun progrès. */
function pendingSignature(calls: ReadonlyArray<OutboxCall>): string {
  return calls
    .map((c) => `${c.key}|${Object.values(c.records).map((r) => r.clientId).sort().join(",")}|${c.submit?.requestedAt ?? ""}`)
    .sort()
    .join(";");
}

export function classify(error: unknown): { failure: Exclude<SyncFailure, null>; retry: boolean; code: string } {
  if (error instanceof ApiError) {
    if (error.code === ClientErrorCode.NETWORK || error.code === ClientErrorCode.TIMEOUT || error.status === 0) return { failure: "network", retry: true, code: error.code };
    if (error.status === 401) return { failure: "auth", retry: false, code: error.code };
    if (error.status === 429 || error.status >= 500) return { failure: "server", retry: true, code: error.code };
    return { failure: "server", retry: false, code: error.code };
  }
  return { failure: "network", retry: true, code: "unknown" };
}

export class OutboxManager {
  private outbox: AttendanceOutbox | null = null;
  private db: OfflineDb | null = null;
  private status: OutboxStatus;
  private listeners = new Set<() => void>();
  private running: Promise<SyncSummary> | null = null;
  private timer: unknown = null;
  private failures = 0;
  private initPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly deps: ManagerDeps) {
    this.status = {
      ready: false,
      persistent: false,
      available: deps.owner() !== null,
      online: deps.isOnline ? deps.isOnline() : true,
      syncing: false,
      calls: [],
      pending: { calls: 0, records: 0 },
      lastSyncAt: null,
      failure: null,
      nextRetryAt: null,
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Observable
  // -------------------------------------------------------------------------------------------------------------

  getSnapshot = (): OutboxStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(next: Partial<OutboxStatus>): void {
    if (this.disposed) return;
    this.status = { ...this.status, ...next };
    for (const l of [...this.listeners]) l();
  }

  private async refresh(): Promise<void> {
    if (!this.outbox) return;
    const calls = await this.outbox.list();
    this.patch({ calls, pending: pendingTotals(calls), available: this.deps.owner() !== null });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Cycle de vie
  // -------------------------------------------------------------------------------------------------------------

  /** Ouvre la base locale et lit la file (idempotent). */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.db = await this.deps.openDb();
        this.outbox = new AttendanceOutbox({ db: this.db, owner: this.deps.owner, now: this.deps.now, uuid: this.deps.uuid });
        await this.outbox.recoverInterrupted();
        await this.outbox.purgeDone(this.deps.keepDoneMs ?? 24 * 3_600_000);
        this.patch({ ready: true, persistent: this.db.persistent });
        await this.refresh();
        if (this.status.pending.calls > 0 && this.status.online) void this.syncNow();
      })();
    }
    return this.initPromise;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.listeners.clear();
  }

  /** Appelé par les écouteurs `online` / `offline` du navigateur. */
  setOnline(online: boolean): void {
    if (online === this.status.online) return;
    this.patch({ online, ...(online ? {} : { nextRetryAt: null }) });
    if (online) {
      this.failures = 0;
      void this.syncNow();
    } else {
      this.cancelTimer();
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private scheduleRetry(): void {
    this.cancelTimer();
    const base = this.deps.retryBaseMs ?? 5000;
    const delay = Math.min(MAX_RETRY_MS, base * 2 ** Math.max(0, this.failures - 1));
    const nextRetryAt = (this.deps.now ?? (() => new Date()))().getTime() + delay;
    this.patch({ nextRetryAt });
    this.timer = (this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
      this.timer = null;
      this.patch({ nextRetryAt: null });
      void this.syncNow();
    }, delay);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Actions locales (toujours possibles, réseau ou non)
  // -------------------------------------------------------------------------------------------------------------

  private async ensure(): Promise<AttendanceOutbox> {
    await this.init();
    if (!this.outbox) throw new Error("File hors ligne indisponible.");
    return this.outbox;
  }

  async mark(input: { target: CallTarget; label?: string | null; date: string; studentId: string; statusCode: string; minutesLate?: number | null }): Promise<void> {
    const outbox = await this.ensure();
    await outbox.recordMark(input);
    await this.refresh();
  }

  async clearMark(target: CallTarget, studentId: string): Promise<void> {
    const outbox = await this.ensure();
    await outbox.clearMark(target, studentId);
    await this.refresh();
  }

  /** Demande la soumission puis tente l'envoi tout de suite si le réseau est là. */
  async submit(input: { target: CallTarget; label?: string | null; date: string; defaultStatus: string }): Promise<SyncSummary | null> {
    const outbox = await this.ensure();
    await outbox.requestSubmit(input);
    await this.refresh();
    return this.status.online ? this.syncNow() : null;
  }

  async retry(target: CallTarget): Promise<void> {
    const outbox = await this.ensure();
    await outbox.retry(target);
    await this.refresh();
    if (this.status.online) void this.syncNow();
  }

  async discard(target: CallTarget): Promise<void> {
    const outbox = await this.ensure();
    await outbox.discard(target);
    await this.refresh();
  }

  async dismiss(target: CallTarget): Promise<void> {
    const outbox = await this.ensure();
    await outbox.dismiss(target);
    await this.refresh();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Synchronisation
  // -------------------------------------------------------------------------------------------------------------

  /** Envoie tout ce qui est en attente. Un seul envoi à la fois : les appels concurrents partagent le même résultat. */
  syncNow(): Promise<SyncSummary> {
    if (this.running) return this.running;
    const run = this.runSync().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async runSync(): Promise<SyncSummary> {
    const summary: SyncSummary = { batches: 0, applied: 0, unchanged: 0, conflicts: 0, rejected: 0, failure: null };
    await this.init();
    const outbox = this.outbox;
    if (!outbox || !this.status.online || this.deps.owner() === null) return summary;
    this.cancelTimer();
    this.patch({ syncing: true, nextRetryAt: null });
    try {
      for (let round = 0; round < 20; round++) {
        const prepared = await outbox.prepareBatch();
        if (!prepared) break;
        const before = pendingSignature(this.status.calls);
        try {
          const result = await this.deps.post(prepared.batch);
          await outbox.applyResult(prepared.snapshot, result);
          await outbox.setClockOffsetFromResult(prepared.batch.clientSentAt, result.receivedAt);
          summary.batches += 1;
          summary.applied += result.totals.applied;
          summary.unchanged += result.totals.unchanged + result.totals.replayed;
          summary.conflicts += result.totals.conflicts;
          summary.rejected += result.totals.rejected;
          this.failures = 0;
          this.patch({ lastSyncAt: (this.deps.now ?? (() => new Date()))().toISOString(), failure: null });
          await this.refresh();
          // Aucun progrès (réponse sans les séances envoyées) : on s'arrête plutôt que de boucler.
          if (pendingSignature(this.status.calls) === before && this.status.pending.calls > 0) {
            summary.failure = "server";
            this.patch({ failure: "server" });
            break;
          }
        } catch (error) {
          const c = classify(error);
          if (c.retry || c.failure === "auth") await outbox.releaseAfterFailure(prepared.snapshot);
          else await outbox.failBatch(prepared.snapshot, c.code);
          summary.failure = c.failure;
          this.failures += 1;
          this.patch({ failure: c.failure });
          await this.refresh();
          if (c.retry) this.scheduleRetry();
          break;
        }
      }
    } finally {
      this.patch({ syncing: false });
      await this.refresh();
    }
    return summary;
  }
}
