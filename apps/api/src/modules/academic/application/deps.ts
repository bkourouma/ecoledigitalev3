/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre
 * UNE transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée,
 * ni événement outbox à moitié écrits) ; une violation de contrainte prévisible est traduite en erreur
 * `academic.*` (jamais un 500) ; les exceptions inattendues remontent telles quelles.
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
import { civilDateOf } from "../domain/dates";
import { DEFAULT_ENROLLABLE_STUDENT_STATUSES } from "../domain/enrollment";
import { AcademicCode, forbidden, notFound, validation } from "../domain/errors";
import { mapDbError } from "../infrastructure/db-errors";
import { DEFAULT_PORTS, noopAudit, type AcademicPorts, type AuditEntry, type AuditPort } from "./ports";

export interface AcademicConfig {
  /** Statuts d'apprenant (module people) qui autorisent une inscription. */
  enrollableStudentStatuses: readonly string[];
  /** Taille des lots de la reconduction annuelle (une transaction par lot). */
  rolloverBatchSize: number;
  /** Au-delà, la reconduction est confiée à un job (le HTTP refuse de la lancer en ligne). */
  rolloverInlineLimit: number;
  /** Taille de page par défaut des listes. */
  defaultPageSize: number;
}

export const DEFAULT_ACADEMIC_CONFIG: AcademicConfig = Object.freeze({
  enrollableStudentStatuses: DEFAULT_ENROLLABLE_STUDENT_STATUSES,
  rolloverBatchSize: 200,
  rolloverInlineLimit: 500,
  defaultPageSize: 50,
});

export interface AcademicDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: AcademicPorts;
  readonly config: AcademicConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface AcademicDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<AcademicPorts>;
  config?: Partial<AcademicConfig>;
  newId?: () => string;
  logger?: Logger;
}

/** Assemble les dépendances avec des valeurs par défaut SÛRES (voir `ports.ts` pour chaque repli). */
export function createAcademicDeps(input: AcademicDepsInput): AcademicDeps {
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports: { ...DEFAULT_PORTS, ...input.ports },
    config: { ...DEFAULT_ACADEMIC_CONFIG, ...input.config },
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

/**
 * Exécute `fn` dans une transaction tenant. `Err` => ROLLBACK + `Err` renvoyé. Une `AppError` levée est un `Err` ;
 * une erreur Postgres prévisible est traduite par `mapDbError`.
 */
export async function inTx<T>(
  deps: AcademicDeps,
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
    const mapped = mapDbError(e);
    if (mapped) return err(mapped);
    throw e;
  }
}

/** Lecture seule (aucun événement, aucun audit). */
export function inReadTx<T>(deps: AcademicDeps, ctx: RequestContext, fn: (tx: Tx) => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
  return inTx(deps, ctx, fn, { readOnly: true });
}

/**
 * Événements outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les
 * données. L'audit est écrit en dernier (il verrouille la tête de chaîne du tenant côté module audit).
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: AcademicDeps,
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
// Périmètre (R26) : un contexte rattaché à un établissement ne voit que lui. Hors périmètre : 404 (pas 403) pour
// ne pas révéler l'existence.
// ---------------------------------------------------------------------------

export interface Scope {
  institutionId: string | null;
  campusId: string | null;
}

export const scopeOf = (ctx: RequestContext): Scope => ({ institutionId: ctx.institutionId ?? null, campusId: ctx.campusId ?? null });

/** `true` si la ressource (établissement, campus éventuel) est dans le périmètre du contexte. */
export function inScope(ctx: RequestContext, resource: { institutionId: string; campusId?: string | null }): boolean {
  if (ctx.institutionId && ctx.institutionId !== resource.institutionId) return false;
  if (ctx.campusId && resource.campusId && ctx.campusId !== resource.campusId) return false;
  return true;
}

export function assertInstitutionScope(ctx: RequestContext, institutionId: string): Result<void, AppError> {
  return ctx.institutionId && ctx.institutionId !== institutionId
    ? err(notFound(AcademicCode.INSTITUTION_NOT_FOUND, "Établissement", institutionId))
    : ok(undefined);
}

// ---------------------------------------------------------------------------
// Aides communes
// ---------------------------------------------------------------------------

/** Utilisateur agissant (le contexte `system` n'en a pas). */
export const actorId = (ctx: RequestContext): string | null => ctx.userId;

/** Date civile du jour dans le fuseau de l'établissement (défaut UTC). */
export async function todayFor(deps: AcademicDeps, ctx: RequestContext, institutionId: string): Promise<string> {
  const info = await deps.ports.institutions.getInstitution(ctx, institutionId);
  return civilDateOf(deps.clock.now(), info?.timezone ?? null);
}

export function requireReason(reason: string | null | undefined, field = "reason"): Result<string, AppError> {
  const r = reason?.trim() ?? "";
  return r.length >= 5 ? ok(r) : err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis.", field));
}

export function requireMfaForSensitive(ctx: RequestContext, what: string): Result<void, AppError> {
  return ctx.mfa || ctx.actor === "system" ? ok(undefined) : err(forbidden("rbac.mfa_required", `L'authentification forte (MFA) est requise : ${what}.`));
}

export function unwrapRows<T>(rows: readonly T[]): T[] {
  return [...rows];
}
