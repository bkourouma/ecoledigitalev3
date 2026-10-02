/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre UNE
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni
 * événement d'outbox, ni audit, ni notification à moitié écrits), une exception inattendue remonte telle quelle.
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Le cas d'usage reçoit en plus les capacités
 * (`CallerCaps`) pour des décisions CONTEXTUELLES (vis-à-vis de qui). Sans capacité fournie : droit le plus restreint.
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
import { noopAudit, type AuditEntry, type AuditPort, type MessagingPorts } from "./ports";

export interface MessagingConfig {
  /** Durée de validité d'une URL signée de pièce jointe. */
  readonly signedUrlTtlSeconds: number;
  /** Pièces déposées mais jamais liées : purgées après ce délai. */
  readonly orphanAttachmentTtlHours: number;
}

export const DEFAULT_MESSAGING_CONFIG: MessagingConfig = Object.freeze({ signedUrlTtlSeconds: 120, orphanAttachmentTtlHours: 24 });

export interface MessagingDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: MessagingPorts;
  readonly config: MessagingConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface MessagingDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<MessagingPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par les adaptateurs). Prime sur `ports`. */
  portsProvider?: () => Partial<MessagingPorts>;
  config?: Partial<MessagingConfig>;
  newId?: () => string;
  logger?: Logger;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé), audit no-op par défaut. */
export function createMessagingDeps(input: MessagingDepsInput): MessagingDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<MessagingPorts> => input.ports ?? {});
  const ports: MessagingPorts = {
    get directory() { return resolve().directory ?? fallback.directory; },
    get audience() { return resolve().audience ?? fallback.audience; },
    get storage() { return resolve().storage ?? fallback.storage; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_MESSAGING_CONFIG, ...input.config },
    newId: input.newId ?? newId,
    logger: input.logger ?? noopLogger,
  };
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
  deps: MessagingDeps,
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
 * Événements d'outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données
 * (pas d'événement fantôme, pas de donnée sans trace). L'audit est écrit en dernier : il verrouille la tête de chaîne.
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: MessagingDeps,
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
      await this.deps.audit.record(tx, this.ctx, entry);
    }
  }
}

/** Utilisateur agissant : un contexte sans utilisateur (système) ne peut pas envoyer de message. */
export const actorOf = (ctx: RequestContext): string | null => ctx.userId;

export { ok };
