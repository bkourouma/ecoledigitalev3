/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle (même convention que les autres modules).
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>`. Il ouvre UNE transaction
 * `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni événement
 * d'outbox, ni audit à moitié écrits). La clôture d'une période (verrou des notes, résultats FINAL, hash de clôture,
 * état, événements, audit) tient dans UNE transaction : une règle indisponible annule tout (période inchangée).
 */
import {
  createDomainEvent,
  err,
  isAppError,
  newId,
  noopLogger,
  systemClock,
  type AppError,
  type Clock,
  type DomainEvent,
  type Logger,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { PgOutboxWriter, type TenantDb, type Tx } from "@ecoledigitale/database";
import { unavailableResultsPorts } from "../infrastructure/in-memory-ports";
import { noopAudit, type AuditEntry, type AuditPort, type ResultsPorts } from "./ports";

export interface ResultsConfig {
  /** Plafond d'inscriptions calculées en une passe (au-delà : découpage, spec §13). */
  readonly maxCohort: number;
  /** Nombre maximal de causes conservées par demande de recalcul. */
  readonly maxCauses: number;
  /** Reprises d'une demande de recalcul avant `FAILED`. */
  readonly maxRecomputeAttempts: number;
}

export const DEFAULT_RESULTS_CONFIG: ResultsConfig = Object.freeze({ maxCohort: 5000, maxCauses: 50, maxRecomputeAttempts: 5 });

export interface ResultsDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: ResultsPorts;
  readonly config: ResultsConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface ResultsDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<ResultsPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par `academic` / `people`). Prime sur `ports`. */
  portsProvider?: () => Partial<ResultsPorts>;
  config?: Partial<ResultsConfig>;
  newId?: () => string;
  logger?: Logger;
}

export function createResultsDeps(input: ResultsDepsInput): ResultsDeps {
  const fallback = unavailableResultsPorts();
  const resolve = input.portsProvider ?? ((): Partial<ResultsPorts> => input.ports ?? {});
  const ports: ResultsPorts = {
    get curriculum() { return resolve().curriculum ?? fallback.curriculum; },
    get roster() { return resolve().roster ?? fallback.roster; },
    get assess() { return resolve().assess ?? fallback.assess; },
    get rules() { return resolve().rules ?? fallback.rules; },
    get guardianship() { return resolve().guardianship ?? fallback.guardianship; },
    get names() { return resolve().names ?? fallback.names; },
    get yearFacts() { return resolve().yearFacts; },
    get competencyCounters() { return resolve().competencyCounters; },
    get familyRelease() { return resolve().familyRelease; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_RESULTS_CONFIG, ...input.config },
    newId: input.newId ?? newId,
    logger: input.logger ?? noopLogger,
  };
}

/** Capacités RBAC du demandeur pour les décisions contextuelles des cas d'usage (échec fermé sans capacité). */
export interface ResultsCaps {
  readonly recompute?: boolean;
  readonly overrideRequest?: boolean;
  readonly overrideApprove?: boolean;
  readonly lock?: boolean;
  readonly close?: boolean;
  readonly repin?: boolean;
  readonly reopen?: boolean;
  readonly decisionRecord?: boolean;
  readonly decisionApprove?: boolean;
  readonly appreciationWrite?: boolean;
  readonly explain?: boolean;
  readonly read?: boolean;
}

class AbortTransaction extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = "AbortTransaction";
  }
}

/** Exécute `fn` dans une transaction tenant — ou dans celle de l'appelant. `Err` ⇒ ROLLBACK + `Err` renvoyé. */
export async function inTx<T>(
  deps: Pick<ResultsDeps, "db">,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<Result<T, AppError>>,
  options?: { readOnly?: boolean; tx?: Tx | undefined },
): Promise<Result<T, AppError>> {
  if (options?.tx) {
    try {
      return await fn(options.tx);
    } catch (e) {
      if (isAppError(e)) return err(e);
      throw e;
    }
  }
  try {
    return await deps.db.run(
      ctx,
      async (tx) => {
        const result = await fn(tx);
        if (!result.ok) throw new AbortTransaction(result.error);
        return result;
      },
      options?.readOnly ? { readOnly: true } : undefined,
    );
  } catch (e) {
    if (e instanceof AbortTransaction) return err(e.error);
    if (isAppError(e)) return err(e);
    throw e;
  }
}

/** Événements d'outbox et entrées d'audit, écrits à la FIN dans la même transaction que les données. */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: Pick<ResultsDeps, "clock" | "newId" | "audit">,
    private readonly ctx: RequestContext,
  ) {}

  add(type: string, payload: { v: 1 } & Record<string, unknown>, aggregate: { type: string; id: string }): void {
    this.events.push(
      createDomainEvent({ type, payload, ctx: this.ctx, version: payload.v, aggregateType: aggregate.type, aggregateId: aggregate.id, clock: this.deps.clock, id: this.deps.newId() }),
    );
  }

  audit(entry: AuditEntry): void {
    this.auditEntries.push(entry);
  }

  get size(): number {
    return this.events.length;
  }

  async flush(tx: Tx): Promise<void> {
    if (this.events.length > 0) {
      await new PgOutboxWriter(tx).append(this.events);
      this.events.length = 0;
    }
    for (const entry of this.auditEntries.splice(0)) await this.deps.audit.record(tx, entry);
  }
}

/** Verrou consultatif de transaction sur une classe × période (sérialise calculs, clôture, réouverture). */
export async function lockKey(tx: Tx, ctx: RequestContext, classroomId: string, periodId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`results:${ctx.tenantId}:${classroomId}:${periodId}`]);
}
