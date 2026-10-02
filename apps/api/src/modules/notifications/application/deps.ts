/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre UNE
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni
 * événement d'outbox, ni audit). Les EFFETS EXTERNES (envoi réel) ne sont jamais faits dans une transaction de donnée :
 * le journal `deliveries` est la file ; l'envoi se fait après le commit, par `dispatch.ts`.
 */
import {
  createDomainEvent,
  err,
  isAppError,
  newId,
  noopLogger,
  ok,
  systemClock,
  type AppError,
  type Clock,
  type DomainEvent,
  type Logger,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { PgOutboxWriter, type TenantDb, type Tx } from "@ecoledigitale/database";
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import { noopAudit, type AuditEntry, type AuditPort, type ChannelRegistry, type NotificationsPorts } from "./ports";

export interface NotificationsConfig {
  readonly production: boolean;
  /** Simulation EXPLICITE des canaux non configurés (jamais en production). */
  readonly simulate: boolean;
  /** Base absolue de l'application (`V2_APP_BASE_URL`) : liens des messages et de désinscription. */
  readonly appBaseUrl: string | null;
  readonly unsubscribeSecret: string | null;
  readonly webhookSecret: string | null;
  /** Clé publique VAPID (abonnement Web Push côté navigateur) ; la clé privée n'est lue que par le canal push. */
  readonly vapidPublicKey: string | null;
  readonly defaultSenderName: string;
  /** Remises traitées par passe et par établissement. */
  readonly batchSize: number;
  /** Durée du bail d'une remise en cours d'envoi (reprise si le worker a été tué). */
  readonly leaseMs: number;
  readonly maxPendingPerTenant: number;
}

export const DEFAULT_NOTIFICATIONS_CONFIG: NotificationsConfig = Object.freeze({
  production: false,
  simulate: false,
  appBaseUrl: null,
  unsubscribeSecret: null,
  webhookSecret: null,
  vapidPublicKey: null,
  defaultSenderName: "EcoleDigitale",
  batchSize: 50,
  leaseMs: 120_000,
  maxPendingPerTenant: 20_000,
});

const trimmed = (v: string | undefined): string | null => (v && v.trim() !== "" ? v.trim() : null);

/** Configuration d'exécution depuis l'environnement (aucun secret affiché, aucune valeur par défaut pour un secret). */
export function configFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): NotificationsConfig {
  const production = env.NODE_ENV === "production";
  const simulate = !production && ["1", "true", "yes", "on"].includes((env.NOTIFICATIONS_SIMULATE ?? "").toLowerCase());
  const positive = (raw: string | undefined, fallback: number): number => {
    const n = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    production,
    simulate,
    appBaseUrl: trimmed(env.V2_APP_BASE_URL)?.replace(/\/+$/, "") ?? null,
    unsubscribeSecret: trimmed(env.NOTIFICATIONS_UNSUBSCRIBE_SECRET),
    webhookSecret: trimmed(env.NOTIFICATIONS_WEBHOOK_SECRET),
    vapidPublicKey: trimmed(env.NOTIFICATIONS_VAPID_PUBLIC_KEY),
    defaultSenderName: trimmed(env.NOTIFICATIONS_DEFAULT_SENDER_NAME) ?? DEFAULT_NOTIFICATIONS_CONFIG.defaultSenderName,
    batchSize: positive(env.NOTIFICATIONS_DISPATCH_BATCH, DEFAULT_NOTIFICATIONS_CONFIG.batchSize),
    leaseMs: positive(env.NOTIFICATIONS_LEASE_MS, DEFAULT_NOTIFICATIONS_CONFIG.leaseMs),
    maxPendingPerTenant: positive(env.NOTIFICATIONS_MAX_PENDING, DEFAULT_NOTIFICATIONS_CONFIG.maxPendingPerTenant),
  };
}

export interface NotificationsDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: NotificationsPorts;
  readonly channels: ChannelRegistry;
  readonly config: NotificationsConfig;
  readonly newId: () => string;
  readonly logger: Logger;
  /** Source d'aléa (gigue du backoff) ; injectable pour des tests déterministes. */
  readonly random: () => number;
}

export interface NotificationsDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<NotificationsPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par les adaptateurs). Prime sur `ports`. */
  portsProvider?: () => Partial<NotificationsPorts>;
  /** Registre de canaux, ou fabrique recevant les dépendances (le canal push lit les abonnements en base). */
  channels?: ChannelRegistry | ((deps: NotificationsDeps) => ChannelRegistry);
  config?: Partial<NotificationsConfig>;
  newId?: () => string;
  logger?: Logger;
  random?: () => number;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé), audit no-op par défaut. */
export function createNotificationsDeps(input: NotificationsDepsInput): NotificationsDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<NotificationsPorts> => input.ports ?? {});
  const ports: NotificationsPorts = {
    get directory() { return resolve().directory ?? fallback.directory; },
    get applicants() { return resolve().applicants ?? fallback.applicants; },
    get overdue() { return resolve().overdue ?? fallback.overdue; },
    get grades() { return resolve().grades ?? fallback.grades; },
    get teachingLoad() { return resolve().teachingLoad ?? fallback.teachingLoad; },
    get announcements() { return resolve().announcements ?? fallback.announcements; },
  };
  let channelsCache: ChannelRegistry | null = typeof input.channels === "function" || input.channels === undefined ? null : input.channels;
  const deps: NotificationsDeps = {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    get channels(): ChannelRegistry {
      if (!channelsCache) {
        if (typeof input.channels !== "function") throw new Error("notifications : aucun registre de canaux fourni.");
        channelsCache = input.channels(deps);
      }
      return channelsCache;
    },
    config: { ...DEFAULT_NOTIFICATIONS_CONFIG, ...input.config },
    newId: input.newId ?? newId,
    logger: input.logger ?? noopLogger,
    random: input.random ?? Math.random,
  };
  return deps;
}

/** Signal interne : annule la transaction en portant l'erreur métier. */
class AbortTransaction extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = "AbortTransaction";
  }
}

/** Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé ; une `AppError` levée vaut `Err`. */
export async function inTx<T>(
  deps: NotificationsDeps,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<Result<T, AppError>>,
  options?: { readOnly?: boolean },
): Promise<Result<T, AppError>> {
  try {
    return await deps.db.run(
      ctx,
      async (tx) => {
        const result = await fn(tx);
        if (!result.ok) throw new AbortTransaction(result.error);
        return result;
      },
      options,
    );
  } catch (e) {
    if (e instanceof AbortTransaction) return err(e.error);
    if (isAppError(e)) return err(e);
    throw e;
  }
}

/**
 * Événements d'outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données.
 * L'audit est écrit en dernier : il verrouille la tête de chaîne.
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: NotificationsDeps,
    private readonly ctx: RequestContext,
  ) {}

  add(type: string, payload: { v: 1 } & Record<string, unknown>, aggregate: { type: string; id: string }): void {
    this.events.push(
      createDomainEvent({
        type,
        payload,
        ctx: this.ctx,
        version: payload.v,
        aggregateType: aggregate.type,
        aggregateId: aggregate.id,
        clock: this.deps.clock,
        id: this.deps.newId(),
      }),
    );
  }

  audit(entry: AuditEntry): void {
    this.auditEntries.push(entry);
  }

  get pendingTypes(): string[] {
    return this.events.map((e) => e.type);
  }

  async flush(tx: Tx): Promise<void> {
    if (this.events.length > 0) {
      await new PgOutboxWriter(tx).append(this.events);
      this.events.length = 0;
    }
    for (const entry of this.auditEntries.splice(0)) {
      await this.deps.audit.record(tx, entry);
    }
  }
}

export { ok };
