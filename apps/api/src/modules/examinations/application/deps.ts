/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre une
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni événement
 * d'outbox, ni audit, ni historique à moitié écrits). Une règle refusée par la base (déclencheur `examinations.<code>`,
 * contrainte d'unicité…) est traduite en erreur typée au code stable (`fromDbError`) ; une panne inattendue remonte telle quelle.
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Aucune décision de rôle n'est codée ici.
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
import { fromDbError } from "../domain/errors";
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import {
  DEFAULT_EXAMINATIONS_CONFIG,
  noopAudit,
  type AuditEntry,
  type AuditPort,
  type ExaminationsConfig,
  type ExaminationsPorts,
} from "./ports";

export interface ExaminationsDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: ExaminationsPorts;
  readonly config: ExaminationsConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface ExaminationsDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<ExaminationsPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par les adaptateurs). Prime sur `ports`. */
  portsProvider?: () => Partial<ExaminationsPorts>;
  config?: Partial<ExaminationsConfig>;
  newId?: () => string;
  logger?: Logger;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé) ; audit no-op par défaut. */
export function createExaminationsDeps(input: ExaminationsDepsInput): ExaminationsDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<ExaminationsPorts> => input.ports ?? {});
  const ports: ExaminationsPorts = {
    get students() { return resolve().students ?? fallback.students; },
    get eligibility() { return resolve().eligibility ?? fallback.eligibility; },
    get institutions() { return resolve().institutions ?? fallback.institutions; },
    get family() { return resolve().family ?? fallback.family; },
    get rules() { return resolve().rules ?? fallback.rules; },
    get assess() { return resolve().assess ?? fallback.assess; },
    get pieces() { return resolve().pieces ?? fallback.pieces; },
    get officialDocuments() { return resolve().officialDocuments ?? fallback.officialDocuments; },
    get storage() { return resolve().storage ?? fallback.storage; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_EXAMINATIONS_CONFIG, ...input.config },
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

/** Convertit une exception en `AppError` (métier, ou règle de la base) ; `null` si c'est une panne inattendue. */
export function toDomainError(e: unknown): AppError | null {
  if (e instanceof AbortTransaction) return e.error;
  if (isAppError(e)) return e;
  return fromDbError(e);
}

/** Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé ; une règle de la base refusée vaut `Err`. */
export async function inTx<T>(
  deps: ExaminationsDeps,
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
    const mapped = toDomainError(e);
    if (mapped) return err(mapped);
    throw e;
  }
}

/**
 * Tente `fn` dans un SAVEPOINT : un échec (métier ou règle de la base) annule seulement ce qu'elle a fait et est RENDU, sans
 * abandonner la transaction englobante. Sert aux opérations par élément d'un lot (une inscription refusée n'arrête pas la classe).
 */
export async function attempt<T>(tx: Tx, fn: (tx: Tx) => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
  try {
    return await tx.transaction(async (inner) => {
      const result = await fn(inner);
      if (!result.ok) throw new AbortTransaction(result.error);
      return result;
    });
  } catch (e) {
    const mapped = toDomainError(e);
    if (mapped) return err(mapped);
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
    private readonly deps: ExaminationsDeps,
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
      await new PgOutboxWriter(tx).append(this.events.splice(0));
    }
    for (const entry of this.auditEntries.splice(0)) {
      await this.deps.audit.record(tx, this.ctx, entry);
    }
  }
}

/** Utilisateur agissant : un contexte sans utilisateur (système) ne fait ni demande, ni approbation, ni saisie. */
export const actorIdOf = (ctx: RequestContext): string | null => ctx.userId;

export { ok };
