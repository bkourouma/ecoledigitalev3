/**
 * Moteur de synchronisation des brouillons de notes : état observable (React `useSyncExternalStore`), envoi par lot avec
 * `Idempotency-Key`, détection de conflit (409 `assess.stale_grade`), reprise après coupure avec attente croissante,
 * un seul envoi à la fois (y compris entre onglets quand les « Web Locks » existent).
 *
 * Indépendant de React et du navigateur (tout est injecté) : testé avec un faux IndexedDB et de faux `put` / `fetchSheet`.
 * Le service worker n'intervient pas (il ignore `/api/` et toute requête authentifiée) et aucune réponse n'est mise en cache.
 *
 * Garanties :
 *  - jamais d'écrasement silencieux : une ligne périmée devient un conflit, renvoyée seulement après choix explicite ;
 *  - jamais de perte : toute erreur d'acheminement, d'authentification ou de serveur laisse les brouillons (et le lot en vol,
 *    avec sa clé) intacts ; une session expirée n'envoie rien, la reconnexion de la MÊME identité reprend l'envoi ;
 *  - jamais de mélange d'identités : tout est filtré par propriétaire `tenant:utilisateur` (voir `grade-drafts.ts`).
 */

import { ApiError } from "@/platform/api/errors";
import { classify, type SyncFailure } from "./outbox-manager";
import {
  DraftLimitError,
  DraftUnavailableError,
  GradeDrafts,
  pendingCount,
  statusOf,
  type DraftConflict,
  type DraftEntry,
  type DraftStatus,
  type GradeDraft,
  type ReconcileResult,
  type ServerGrade,
} from "./grade-drafts";
import type { OfflineDb } from "./idb";

export interface SaveGradesOutcome {
  created: number;
  updated: number;
  unchanged: number;
  replayed: boolean;
  grades: ServerGrade[];
}

/** Ligne envoyée à l'API (contrat `PUT /assess/assessments/:id/grades`). */
export interface ApiGradeEntry {
  enrollmentId: string;
  entryStatus: string;
  score?: string;
  comment?: string | null;
  rowVersion?: number;
}

export interface GradeSyncDeps {
  openDb: () => Promise<OfflineDb>;
  /** `tenant:utilisateur`, ou null. Les brouillons restent attribués à cette identité même si le jeton a expiré. */
  owner: () => string | null;
  /** Vrai si un jeton valide permet d'appeler l'API (faux : session expirée -> aucun envoi, brouillons conservés). */
  canSync?: () => boolean;
  put: (assessmentId: string, entries: ApiGradeEntry[], idempotencyKey: string) => Promise<SaveGradesOutcome>;
  /** Relit la feuille (valeurs courantes du serveur) pour documenter un conflit. */
  fetchSheet: (assessmentId: string) => Promise<{ status: string; grades: ServerGrade[] }>;
  /** Exclusion entre onglets (Web Locks) ; défaut : aucune. */
  exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  isOnline?: () => boolean;
  now?: () => Date;
  uuid?: () => string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  retryBaseMs?: number;
}

export interface DraftView {
  assessmentId: string;
  label: string | null;
  status: DraftStatus;
  syncing: boolean;
  pending: number;
  conflicts: DraftConflict[];
  blockedCode: string | null;
  /** Lot en vol : les lignes envoyées dont la réponse n'est pas connue. */
  inflight: boolean;
}

export interface GradeSyncStatus {
  ready: boolean;
  persistent: boolean;
  /** Un utilisateur est identifié (propriétaire des brouillons). */
  available: boolean;
  online: boolean;
  syncing: boolean;
  drafts: ReadonlyArray<DraftView>;
  totals: { pending: number; conflicts: number; failed: number; locked: number };
  failure: SyncFailure;
  nextRetryAt: number | null;
  lastSyncAt: string | null;
  /** Dernier envoi réussi par évaluation. */
  syncedAt: Readonly<Record<string, string>>;
  /** La file locale est pleine : la dernière saisie n'a PAS pu être gardée sur l'appareil. */
  limitReached: boolean;
  /** Le stockage local a refusé l'écriture (quota, navigation privée) : la dernière saisie n'est que dans la page. */
  storageFailed: boolean;
}

export type SyncOutcome = "synced" | "nothing" | "offline" | "retry" | "auth" | "conflict" | "blocked" | "unavailable";

export interface AssessmentSyncResult {
  outcome: SyncOutcome;
  created: number;
  updated: number;
  unchanged: number;
  replayed: boolean;
  batches: number;
  blockedCode: string | null;
}

export interface AppliedEvent {
  assessmentId: string;
  /** Notes telles que le serveur les connaît maintenant. */
  grades: ServerGrade[];
  /** Lignes à REMETTRE à la valeur du serveur dans la grille (leur saisie est passée en conflit). */
  resetEnrollmentIds: string[];
}

const MAX_RETRY_MS = 5 * 60_000;
const MAX_ROUNDS = 40;

const emptyResult = (outcome: SyncOutcome): AssessmentSyncResult => ({ outcome, created: 0, updated: 0, unchanged: 0, replayed: false, batches: 0, blockedCode: null });

function viewOf(d: GradeDraft, syncing: boolean): DraftView {
  return {
    assessmentId: d.assessmentId,
    label: d.label,
    status: statusOf(d),
    syncing,
    pending: pendingCount(d),
    conflicts: Object.values(d.conflicts),
    blockedCode: d.blocked?.code ?? null,
    inflight: d.inflight !== null,
  };
}

function toApiEntry(e: { enrollmentId: string; entryStatus: string; score: string | null; comment: string | null; baseVersion: number | null }): ApiGradeEntry {
  return {
    enrollmentId: e.enrollmentId,
    entryStatus: e.entryStatus,
    ...(e.entryStatus === "ENTERED" && e.score !== null ? { score: e.score } : {}),
    // Ligne existante : le brouillon porte l'état complet voulu, un commentaire vidé est donc envoyé (`null`).
    ...(e.comment !== null || e.baseVersion !== null ? { comment: e.comment } : {}),
    ...(e.baseVersion !== null ? { rowVersion: e.baseVersion } : {}),
  };
}

function staleIdsOf(error: ApiError, fallback: ReadonlyArray<string>): string[] {
  const details = error.details as { enrollmentIds?: unknown } | null | undefined;
  const ids = details && Array.isArray(details.enrollmentIds) ? details.enrollmentIds.filter((x): x is string => typeof x === "string") : [];
  return ids.length > 0 ? ids : [...fallback];
}

export class GradeSyncManager {
  private drafts: GradeDrafts | null = null;
  private db: OfflineDb | null = null;
  private status: GradeSyncStatus;
  private listeners = new Set<() => void>();
  private applied = new Set<(e: AppliedEvent) => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private globalQueued: Promise<AssessmentSyncResult> | null = null;
  private syncingIds = new Set<string>();
  private timer: unknown = null;
  private failures = 0;
  private initPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly deps: GradeSyncDeps) {
    this.status = {
      ready: false,
      persistent: false,
      available: deps.owner() !== null,
      online: deps.isOnline ? deps.isOnline() : true,
      syncing: false,
      drafts: [],
      totals: { pending: 0, conflicts: 0, failed: 0, locked: 0 },
      failure: null,
      nextRetryAt: null,
      lastSyncAt: null,
      syncedAt: {},
      limitReached: false,
      storageFailed: false,
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Observable
  // -------------------------------------------------------------------------------------------------------------

  getSnapshot = (): GradeSyncStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Abonnement aux notes appliquées ou remises à l'état du serveur (la grille y fusionne ses lignes). */
  onApplied(listener: (e: AppliedEvent) => void): () => void {
    this.applied.add(listener);
    return () => this.applied.delete(listener);
  }

  private emit(e: AppliedEvent): void {
    if (this.disposed) return;
    for (const l of [...this.applied]) l(e);
  }

  private patch(next: Partial<GradeSyncStatus>): void {
    if (this.disposed) return;
    this.status = { ...this.status, ...next };
    for (const l of [...this.listeners]) l();
  }

  private async refresh(): Promise<void> {
    if (!this.drafts || this.disposed) return;
    const list = await this.drafts.list();
    const views = list.map((d) => viewOf(d, this.syncingIds.has(d.assessmentId)));
    const totals = { pending: 0, conflicts: 0, failed: 0, locked: 0 };
    for (const v of views) {
      totals.pending += v.pending;
      totals.conflicts += v.conflicts.length;
      if (v.status === "FAILED") totals.failed += 1;
      if (v.status === "LOCKED") totals.locked += 1;
    }
    this.patch({ drafts: views, totals, available: this.deps.owner() !== null });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Cycle de vie
  // -------------------------------------------------------------------------------------------------------------

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.db = await this.deps.openDb();
        this.drafts = new GradeDrafts({ db: this.db, owner: this.deps.owner, now: this.deps.now, uuid: this.deps.uuid });
        this.patch({ ready: true, persistent: this.db.persistent });
        await this.refresh();
        if (this.hasWork() && this.status.online) void this.syncNow();
      })();
    }
    return this.initPromise;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.listeners.clear();
    this.applied.clear();
  }

  private hasWork(): boolean {
    return this.status.drafts.some((d) => (d.pending > 0 || d.inflight) && d.status !== "LOCKED" && d.status !== "FAILED");
  }

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

  /** La session a été renouvelée ou rouverte (jeton valide) : reprend l'envoi des brouillons de cette identité. */
  notifySessionRenewed(): void {
    this.failures = 0;
    if (this.status.failure === "auth") this.patch({ failure: null });
    void this.refresh().then(() => this.syncNow());
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

  private async ensure(): Promise<GradeDrafts> {
    await this.init();
    if (!this.drafts) throw new Error("Brouillons de notes indisponibles.");
    return this.drafts;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Actions locales (toujours possibles, réseau ou non)
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Garde sur l'appareil l'ensemble des saisies en attente de l'évaluation. Ne lève jamais : renvoie `ok: false` avec la raison
   * quand la saisie n'a pas pu être gardée (limite atteinte, aucun utilisateur, stockage refusé) — la page l'affiche.
   */
  async recordEntries(assessmentId: string, label: string | null, entries: ReadonlyArray<Omit<DraftEntry, "editedAt">>): Promise<{ ok: true } | { ok: false; reason: "limit" | "unavailable" | "storage" }> {
    const drafts = await this.ensure();
    try {
      await drafts.replaceEntries(assessmentId, label, entries);
      if (this.status.limitReached || this.status.storageFailed) this.patch({ limitReached: false, storageFailed: false });
      await this.refresh();
      return { ok: true };
    } catch (e) {
      if (e instanceof DraftLimitError) {
        this.patch({ limitReached: true });
        return { ok: false, reason: "limit" };
      }
      if (e instanceof DraftUnavailableError) return { ok: false, reason: "unavailable" };
      this.patch({ storageFailed: true });
      return { ok: false, reason: "storage" };
    }
  }

  async reconcile(assessmentId: string, sheet: { status: string; grades: ReadonlyArray<ServerGrade>; enrollmentIds: ReadonlyArray<string> }): Promise<ReconcileResult> {
    const drafts = await this.ensure();
    const result = await drafts.reconcile(assessmentId, sheet);
    await this.refresh();
    return result;
  }

  async resolveConflict(assessmentId: string, enrollmentId: string, choice: "mine" | "server"): Promise<{ entry: DraftEntry | null; serverRowVersion: number | null } | null> {
    const drafts = await this.ensure();
    const r = await drafts.resolveConflict(assessmentId, enrollmentId, choice);
    await this.refresh();
    if (r && choice === "mine" && this.status.online) void this.syncAssessment(assessmentId);
    return r;
  }

  async retry(assessmentId: string): Promise<void> {
    const drafts = await this.ensure();
    await drafts.retry(assessmentId);
    await this.refresh();
    if (this.status.online) void this.syncAssessment(assessmentId);
  }

  async discard(assessmentId: string): Promise<void> {
    const drafts = await this.ensure();
    await drafts.discard(assessmentId);
    await this.refresh();
  }

  /** Efface les brouillons (déconnexion). `keepUnsynced` : garde ce qui reste à envoyer ou à arbitrer. */
  async purge(options: { all?: boolean; keepUnsynced?: boolean } = {}): Promise<number> {
    const drafts = await this.ensure();
    const n = await drafts.purge(options);
    await this.refresh();
    return n;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Synchronisation
  // -------------------------------------------------------------------------------------------------------------

  /** Envoie tout ce qui est en attente. Les appels concurrents partagent le même passage. */
  syncNow(): Promise<AssessmentSyncResult> {
    if (this.globalQueued) return this.globalQueued;
    const run = this.enqueue(null).finally(() => {
      if (this.globalQueued === run) this.globalQueued = null;
    });
    this.globalQueued = run;
    return run;
  }

  /** Envoie les saisies d'UNE évaluation (après les envois déjà en cours) et renvoie ce qui s'est passé. */
  syncAssessment(assessmentId: string): Promise<AssessmentSyncResult> {
    return this.enqueue(assessmentId);
  }

  private enqueue(only: string | null): Promise<AssessmentSyncResult> {
    const next = this.chain.then(() => (this.deps.exclusive ?? ((f) => f()))(() => this.runSync(only)));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async runSync(only: string | null): Promise<AssessmentSyncResult> {
    await this.init();
    const store = this.drafts;
    const result = emptyResult("nothing");
    if (!store || this.disposed) return result;
    if (this.deps.owner() === null) return emptyResult("unavailable");
    if (!this.status.online) return emptyResult("offline");
    if (this.deps.canSync && !this.deps.canSync()) {
      // Session expirée : rien n'est envoyé, rien n'est perdu ; la reconnexion de la même identité reprend l'envoi.
      this.patch({ failure: "auth" });
      return emptyResult("auth");
    }
    this.cancelTimer();
    this.patch({ syncing: true, nextRetryAt: null });
    let stop = false;
    try {
      const candidates = (await store.list()).filter((d) => (only === null || d.assessmentId === only) && !d.blocked && (pendingCount(d) > 0 || d.inflight !== null));
      for (const draft of candidates) {
        if (stop) break;
        const one = await this.syncDraft(store, draft.assessmentId);
        result.created += one.created;
        result.updated += one.updated;
        result.unchanged += one.unchanged;
        result.replayed = result.replayed || one.replayed;
        result.batches += one.batches;
        if (one.outcome !== "synced") result.outcome = one.outcome;
        else if (result.outcome === "nothing") result.outcome = "synced";
        if (one.blockedCode) result.blockedCode = one.blockedCode;
        if (one.outcome === "retry" || one.outcome === "auth") stop = true;
      }
    } finally {
      this.syncingIds.clear();
      this.patch({ syncing: false });
      await this.refresh();
    }
    return result;
  }

  private async syncDraft(store: GradeDrafts, assessmentId: string): Promise<AssessmentSyncResult> {
    const out = emptyResult("nothing");
    this.syncingIds.add(assessmentId);
    await this.refresh();
    let idempotencyConflicts = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const prepared = await store.prepareBatch(assessmentId);
      if (!prepared) break;
      const { batch } = prepared;
      try {
        const res = await this.deps.put(assessmentId, batch.entries.map(toApiEntry), batch.batchKey);
        const { conflicts } = await store.applySuccess(assessmentId, batch.batchKey, res.grades);
        this.emit({ assessmentId, grades: res.grades, resetEnrollmentIds: conflicts.map((c) => c.enrollmentId) });
        out.created += res.created;
        out.updated += res.updated;
        out.unchanged += res.unchanged;
        out.replayed = out.replayed || res.replayed;
        out.batches += 1;
        out.outcome = conflicts.length > 0 ? "conflict" : out.outcome === "conflict" ? "conflict" : "synced";
        this.failures = 0;
        const at = (this.deps.now ?? (() => new Date()))().toISOString();
        this.patch({ lastSyncAt: at, failure: null, syncedAt: { ...this.status.syncedAt, [assessmentId]: at } });
        await this.refresh();
        continue;
      } catch (error) {
        const c = classify(error);
        if (error instanceof ApiError && error.status === 409) {
          if (error.code === "assess.stale_grade") {
            const stale = staleIdsOf(error, batch.entries.map((e) => e.enrollmentId));
            let server: ServerGrade[] | null = null;
            try {
              server = (await this.deps.fetchSheet(assessmentId)).grades;
            } catch {
              server = null; // les valeurs du serveur seront relues plus tard
            }
            const { conflicts } = await store.applyStale(assessmentId, batch.batchKey, stale, server);
            const reset = new Set(conflicts.map((x) => x.enrollmentId));
            // On ne communique à la grille que les lignes en conflit : les autres gardent leur version (sinon écrasement silencieux).
            this.emit({ assessmentId, grades: (server ?? []).filter((g) => reset.has(g.enrollmentId)), resetEnrollmentIds: [...reset] });
            if (conflicts.length > 0) out.outcome = "conflict";
            await this.refresh();
            continue;
          }
          if (error.code === "assess.idempotency_conflict" && idempotencyConflicts < 2) {
            idempotencyConflicts += 1;
            await store.dropInflight(assessmentId, batch.batchKey);
            continue;
          }
          const locked = error.code === "assess.grade_frozen" || error.code === "assess.period_locked";
          await store.block(assessmentId, batch.batchKey, locked ? "locked" : "error", error.code);
          out.outcome = "blocked";
          out.blockedCode = error.code;
          break;
        }
        if (c.failure === "auth") {
          this.failures += 1;
          this.patch({ failure: "auth" });
          out.outcome = "auth";
          break;
        }
        if (c.retry) {
          this.failures += 1;
          this.patch({ failure: c.failure });
          this.scheduleRetry();
          out.outcome = "retry";
          break;
        }
        // Refus définitif (400, 403, 404, 422…) : les saisies sont gardées, le brouillon est bloqué jusqu'à action de l'utilisateur.
        await store.block(assessmentId, batch.batchKey, "error", c.code);
        out.outcome = "blocked";
        out.blockedCode = c.code;
        this.patch({ failure: c.failure });
        break;
      }
    }
    this.syncingIds.delete(assessmentId);
    return out;
  }
}
