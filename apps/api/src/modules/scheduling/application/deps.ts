/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (conventions
 * n° 4). Il ouvre UNE transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE
 * (aucune donnée ni événement à moitié écrit). Les exceptions de la base du module sont traduites en
 * erreurs métier (`infrastructure/db-errors.ts`) ; les autres remontent telles quelles.
 *
 * Concurrence (spec 017 AC1.2). Trois niveaux, du plus fort au plus fin :
 *   1. la BASE : contrainte d'exclusion de `resource_claims`, verrou de ligne des équipements,
 *      déclencheurs de gel — c'est elle qui garantit l'invariant, quoi que fasse l'application ;
 *   2. les verrous consultatifs ci-dessous : un écrivain pose, en ordre trié, un verrou par ressource
 *      qu'il va réserver, ce qui sérialise deux écritures concurrentes sur la même ressource (la
 *      seconde attend, puis voit la première validée et reçoit un conflit explicite plutôt qu'un
 *      interblocage). La génération en lot prend à la place le verrou EXCLUSIF du tenant ;
 *   3. l'aperçu des conflits, qui explique AVANT d'écrire.
 */
import {
  createDomainEvent,
  isAppError,
  newId,
  err,
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
import type { ClaimResourceKind } from "../domain/types";
import { mapDbError } from "../infrastructure/db-errors";
import type { AcademicQuery } from "./ports/academic";
import type { AttendanceQuery } from "./ports/attendance";
import { noopAudit, type AuditEntry, type AuditPort } from "./ports/audit";
import type { PeopleQuery } from "./ports/people";

export interface SchedulingPorts {
  /** `null` : échec fermé pour toute écriture liée à une classe. */
  readonly academic: AcademicQuery | null;
  /** `null` : planification sans avertissements de disponibilité ni contrôle d'affectation. */
  readonly people: PeopleQuery | null;
  readonly attendance: AttendanceQuery | null;
}

export interface SchedulingDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: SchedulingPorts;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface SchedulingDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<SchedulingPorts>;
  newId?: () => string;
  logger?: Logger;
}

/**
 * Les ports sont lus À L'APPEL (getters) : un objet de ports « vivant » (registre du module) est donc pris en
 * compte même s'il est complété après la création des dépendances.
 */
function normalizePorts(p: Partial<SchedulingPorts> | undefined): SchedulingPorts {
  return {
    get academic() {
      return p?.academic ?? null;
    },
    get people() {
      return p?.people ?? null;
    },
    get attendance() {
      return p?.attendance ?? null;
    },
  };
}

export function createSchedulingDeps(input: SchedulingDepsInput): SchedulingDeps {
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
  /** Ne pas passer la contrainte d'exclusion en IMMEDIATE (échanges dans une même transaction). */
  deferredClaims?: boolean;
}

/**
 * Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé. En écriture, la
 * contrainte d'exclusion des réservations passe en IMMEDIATE : l'instruction fautive échoue sur
 * place (on peut alors l'attraper dans un SAVEPOINT) au lieu de n'échouer qu'au COMMIT.
 */
export async function inTx<T>(
  deps: SchedulingDeps,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<Result<T, AppError>>,
  options: TxOptions = {},
): Promise<Result<T, AppError>> {
  try {
    return await deps.db.run(
      ctx,
      async (tx) => {
        if (!options.readOnly && !options.deferredClaims) await tx.query("SET CONSTRAINTS scheduling.resource_claims_no_overlap IMMEDIATE");
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
 * Événements outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction
 * que les données (pas de donnée sans trace, pas d'événement fantôme).
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: SchedulingDeps,
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

// ---------------------------------------------------------------------------
// Verrous consultatifs
// ---------------------------------------------------------------------------

export interface ResourceRef {
  readonly kind: ClaimResourceKind;
  readonly id: string;
}

/**
 * Verrou PARTAGÉ du tenant (exclu par la génération en lot) + verrous EXCLUSIFS par ressource, pris en
 * ordre trié (aucun interblocage entre écrivains). Libérés à la fin de la transaction.
 */
export async function lockResources(tx: Tx, ctx: RequestContext, resources: readonly ResourceRef[]): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))", [`scheduling:tenant:${ctx.tenantId}`]);
  const keys = [...new Set(resources.map((r) => `scheduling:res:${ctx.tenantId}:${r.kind}:${r.id}`))].sort();
  for (const key of keys) await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

/** Verrou EXCLUSIF du tenant : à prendre par une écriture en lot (génération d'occurrences). */
export async function lockTenantExclusive(tx: Tx, ctx: RequestContext): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`scheduling:tenant:${ctx.tenantId}`]);
}

/** Motif lu par les déclencheurs de journal (`scheduling.change_reason`), portée transaction. */
export async function setChangeReason(tx: Tx, reason: string | null): Promise<void> {
  await tx.query("SELECT set_config('scheduling.change_reason', $1, true)", [reason ?? ""]);
}

export const actorId = (ctx: RequestContext): string | null => ctx.userId;
