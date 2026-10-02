/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (conventions n° 4). Il
 * ouvre UNE transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (aucune donnée ni
 * événement à moitié écrit). Les exceptions de la base du module sont traduites en erreurs métier
 * (`infrastructure/db-errors.ts`) ; les autres remontent telles quelles.
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
import { mapDbError } from "../infrastructure/db-errors";
import { noopAudit, type AuditEntry, type AuditPort } from "./audit";
import type { PayrollPorts } from "./ports";

export interface PayrollDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Ports lus À L'APPEL (getters) : un registre « vivant » complété après coup est pris en compte. */
  readonly ports: PayrollPorts;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface PayrollDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<PayrollPorts>;
  newId?: () => string;
  logger?: Logger;
}

function normalizePorts(p: Partial<PayrollPorts> | undefined): PayrollPorts {
  return {
    get sessionHours() {
      return p?.sessionHours ?? null;
    },
    get attendanceHours() {
      return p?.attendanceHours ?? null;
    },
    get staff() {
      return p?.staff ?? null;
    },
    get curriculum() {
      return p?.curriculum ?? null;
    },
    get documents() {
      return p?.documents ?? null;
    },
  };
}

export function createPayrollDeps(input: PayrollDepsInput): PayrollDeps {
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports: normalizePorts(input.ports),
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

export interface TxOptions {
  readOnly?: boolean;
}

/** Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé. */
export async function inTx<T>(deps: PayrollDeps, ctx: RequestContext, fn: (tx: Tx) => Promise<Result<T, AppError>>, options: TxOptions = {}): Promise<Result<T, AppError>> {
  try {
    return await deps.db.run(
      ctx,
      async (tx) => {
        const result = await fn(tx);
        if (!result.ok) throw new AbortTransaction(result.error);
        return result;
      },
      options.readOnly ? { readOnly: true } : undefined,
    );
  } catch (e) {
    if (e instanceof AbortTransaction) return err(e.error);
    if (isAppError(e)) return err(e);
    const mapped = mapDbError(e);
    if (mapped) return err(mapped);
    throw e;
  }
}

/**
 * Événements outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les
 * données (pas de donnée sans trace, pas d'événement fantôme).
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: PayrollDeps,
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

  get size(): number {
    return this.events.length;
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

/** Verrou consultatif par enseignant : sérialise deux calculs concurrents d'un même enseignant (période différente). */
export async function lockStaff(tx: Tx, tenantId: string, staffId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`payroll:staff:${tenantId}:${staffId}`]);
}

/** Verrou consultatif du tenant pour la création de période (une seule « en attente de calcul »). */
export async function lockPeriodCreation(tx: Tx, tenantId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`payroll:periods:${tenantId}`]);
}

/** Pose, pour la transaction, la capacité « arrêt propriétaire » lue par le déclencheur `payslips_guard`. */
export async function setOwnerApproval(tx: Tx, enabled: boolean): Promise<void> {
  await tx.query("SELECT set_config('payroll.actor_owner', $1, true)", [enabled ? "true" : "false"]);
}

export const actorOf = (ctx: RequestContext): string | null => ctx.userId;
