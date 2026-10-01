/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre UNE
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni
 * événement d'outbox, ni audit à moitié écrits), une exception inattendue remonte telle quelle.
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Le cas d'usage reçoit en plus les capacités
 * (`CallerCaps`) dont il a besoin pour des décisions CONTEXTUELLES (corriger un appel passé le délai, lire la pièce
 * médicale d'un autre…). Sans capacité fournie, il applique le droit le plus restreint (échec fermé).
 */
import {
  ABIDJAN_TZ,
  abidjanDate,
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
import { PgOutboxWriter, isUniqueViolation, type TenantDb, type Tx } from "@ecoledigitale/database";
import type { IsoDate } from "../domain/types";
import { settingsAlertPolicy, unavailablePorts } from "../infrastructure/in-memory-ports";
import { noopAudit, type AttendancePorts, type AuditEntry, type AuditPort } from "./ports";

export interface AttendanceConfig {
  /** Fuseau de l'établissement pour « aujourd'hui » (défaut : fuseau du produit). */
  readonly timeZone: string;
  /** Durée de validité d'une URL signée de pièce jointe. */
  readonly signedUrlTtlSeconds: number;
}

export const DEFAULT_ATTENDANCE_CONFIG: AttendanceConfig = Object.freeze({
  timeZone: ABIDJAN_TZ,
  signedUrlTtlSeconds: 120,
});

export interface AttendanceDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: AttendancePorts;
  readonly config: AttendanceConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface AttendanceDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<AttendancePorts>;
  /**
   * Fournisseur de ports résolu À CHAQUE ACCÈS : les modules `academic`, `people` et `scheduling` s'enregistrent au
   * chargement, dans un ordre quelconque (voir `registerAttendancePorts`). Prime sur `ports`.
   */
  portsProvider?: () => Partial<AttendancePorts>;
  config?: Partial<AttendanceConfig>;
  newId?: () => string;
  logger?: Logger;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé), audit no-op par défaut. */
export function createAttendanceDeps(input: AttendanceDepsInput): AttendanceDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<AttendancePorts> => input.ports ?? {});
  // Getters : chaque accès relit le fournisseur (enregistrement tardif des ports par les autres modules).
  const ports: AttendancePorts = {
    get roster() { return resolve().roster ?? fallback.roster; },
    get periods() { return resolve().periods ?? fallback.periods; },
    get occurrences() { return resolve().occurrences ?? fallback.occurrences; },
    get people() { return resolve().people ?? fallback.people; },
    get storage() { return resolve().storage ?? fallback.storage; },
    get alertPolicy() { return resolve().alertPolicy ?? settingsAlertPolicy; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_ATTENDANCE_CONFIG, ...input.config },
    newId: input.newId ?? newId,
    logger: input.logger ?? noopLogger,
  };
}

/** Capacités RBAC du demandeur nécessaires aux décisions contextuelles des cas d'usage. */
export interface CallerCaps {
  readonly manage?: boolean;
  readonly validate?: boolean;
  readonly reopen?: boolean;
  readonly justificationSubmit?: boolean;
  readonly childJustify?: boolean;
  readonly selfJustify?: boolean;
  readonly justificationRead?: boolean;
  readonly justificationDecide?: boolean;
  readonly staffRecord?: boolean;
  readonly staffRead?: boolean;
  readonly ownRecord?: boolean;
  readonly leaveRequest?: boolean;
  readonly leaveDecide?: boolean;
  readonly settingsManage?: boolean;
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
  deps: AttendanceDeps,
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
 * (pas d'événement fantôme, pas de donnée sans trace). L'audit est écrit en dernier : il verrouille la tête de chaîne
 * du tenant (module audit).
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: AttendanceDeps,
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

  /** Types d'événements en attente (tests, journalisation). */
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

/** Jour courant de l'établissement (`AAAA-MM-JJ`). */
export const todayOf = (deps: AttendanceDeps): IsoDate => abidjanDate(deps.clock.now(), deps.config.timeZone);

/** Utilisateur agissant (le contexte `system` n'en a pas). */
export const actorOf = (ctx: RequestContext): string | null => ctx.userId;

/**
 * Insertion « unique par construction » : une violation d'unicité (course entre deux requêtes) devient un conflit
 * métier explicite au lieu d'une erreur 500. L'insertion s'exécute dans un SAVEPOINT.
 */
export async function insertOrConflict<T>(tx: Tx, insert: (tx: Tx) => Promise<T>, conflictError: () => AppError): Promise<Result<T, AppError>> {
  try {
    return ok(await tx.transaction(insert));
  } catch (e) {
    if (isUniqueViolation(e)) return err(conflictError());
    throw e;
  }
}

/** Verrou consultatif de transaction sur une clé métier (sérialise les traitements concurrents d'une même clé). */
export async function lockKey(tx: Tx, ctx: RequestContext, scope: string, key: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`attendance:${scope}:${ctx.tenantId}:${key}`]);
}
