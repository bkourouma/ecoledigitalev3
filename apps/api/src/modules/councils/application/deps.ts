/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre UNE
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni événement
 * d'outbox, ni audit à moitié écrits) ; un refus de la BASE (acteur non humain, quorum, séance verrouillée…) est traduit en erreur
 * applicative stable `councils.*` (jamais un 500).
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Le cas d'usage reçoit en plus les capacités (`CallerCaps`) pour
 * les décisions CONTEXTUELLES (périmètre d'un enseignant, permissions propres à un acte). Sans capacité fournie, il applique le droit
 * le plus restreint (échec fermé).
 */
import { abidjanDate, createDomainEvent, err, isAppError, newId, noopLogger, ok, systemClock, type AppError, type Clock, type DomainEvent, type Logger, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PgOutboxWriter, type TenantDb, type Tx } from "@ecoledigitale/database";
import { humanRequired, translateViolation } from "../domain/errors";
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import { violationOf } from "../infrastructure/pg-violations";
import { noopAudit, type AuditEntry, type AuditPort, type CouncilsPorts } from "./ports";

export interface CouncilsConfig {
  /** Durée de vie d'une demande de déverrouillage ouverte avant expiration (jours). */
  readonly unlockExpiryDays: number;
  /** Tentatives maximales d'un effet avant abandon par le job (une relance manuelle reste possible). */
  readonly effectMaxAttempts: number;
  /** Validité de l'URL signée d'un PV (secondes, ≤ 300). */
  readonly pdfUrlTtlSeconds: number;
}

export const DEFAULT_COUNCILS_CONFIG: CouncilsConfig = Object.freeze({ unlockExpiryDays: 14, effectMaxAttempts: 12, pdfUrlTtlSeconds: 300 });

export interface CouncilsDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: CouncilsPorts;
  readonly config: CouncilsConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface CouncilsDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<CouncilsPorts>;
  /** Fournisseur résolu À CHAQUE ACCÈS (enregistrement tardif par la plateforme). Prime sur `ports`. */
  portsProvider?: () => Partial<CouncilsPorts>;
  config?: Partial<CouncilsConfig>;
  newId?: () => string;
  logger?: Logger;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé), audit no-op par défaut. */
export function createCouncilsDeps(input: CouncilsDepsInput): CouncilsDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<CouncilsPorts> => input.ports ?? {});
  const ports: CouncilsPorts = {
    get academic() { return resolve().academic ?? fallback.academic; },
    get outcomes() { return resolve().outcomes ?? fallback.outcomes; },
    get resultsRead() { return resolve().resultsRead ?? fallback.resultsRead; },
    get resultsWrite() { return resolve().resultsWrite ?? fallback.resultsWrite; },
    get ruleCodes() { return resolve().ruleCodes ?? fallback.ruleCodes; },
    get attendance() { return resolve().attendance ?? fallback.attendance; },
    get schoollife() { return resolve().schoollife ?? fallback.schoollife; },
    get staff() { return resolve().staff ?? fallback.staff; },
    get family() { return resolve().family ?? fallback.family; },
    get studentStatus() { return resolve().studentStatus ?? fallback.studentStatus; },
    get notifications() { return resolve().notifications ?? fallback.notifications; },
    get documents() { return resolve().documents ?? fallback.documents; },
    get storage() { return resolve().storage ?? fallback.storage; },
    get templates() { return resolve().templates ?? fallback.templates; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_COUNCILS_CONFIG, ...(input.config ?? {}) },
    newId: input.newId ?? newId,
    logger: input.logger ?? noopLogger,
  };
}

/** Capacités RBAC du demandeur (décisions CONTEXTUELLES). Sans capacité : le droit le plus restreint. */
export interface CallerCaps {
  readonly read?: boolean;
  readonly manage?: boolean;
  readonly prepare?: boolean;
  readonly sessionRun?: boolean;
  readonly proposalWrite?: boolean;
  readonly decisionRecord?: boolean;
  readonly minutesGenerate?: boolean;
  readonly minutesRead?: boolean;
  readonly minutesSign?: boolean;
  readonly minutesRevoke?: boolean;
  readonly unlockRequest?: boolean;
  readonly unlockApprove?: boolean;
  readonly effectManage?: boolean;
  readonly exclusionApply?: boolean;
  readonly settingsManage?: boolean;
  readonly orientationRead?: boolean;
  readonly orientationManage?: boolean;
  readonly orientationOverride?: boolean;
  readonly selfRead?: boolean;
  readonly childRead?: boolean;
}

/** Signal interne : annule la transaction en portant l'erreur métier. */
class AbortTransaction extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = "AbortTransaction";
  }
}

/** Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé ; une violation de la base devient une `AppError`. */
export async function inTx<T>(deps: CouncilsDeps, ctx: RequestContext, fn: (tx: Tx) => Promise<Result<T, AppError>>, options?: { readOnly?: boolean }): Promise<Result<T, AppError>> {
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
    const violation = violationOf(e);
    const translated = violation ? translateViolation(violation) : null;
    if (translated) return err(translated);
    throw e;
  }
}

/**
 * Appels de ports HORS transaction : une `AppError` levée par un port (ex. `councils.port_unavailable`) devient un `Err`, jamais
 * une exception qui remonterait en 500.
 */
export async function safely<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
  try {
    return await fn();
  } catch (e) {
    if (isAppError(e)) return err(e);
    throw e;
  }
}

/** Refuse tout acte (décision, signature, ouverture, clôture, déverrouillage) qui ne vient pas d'un UTILISATEUR identifié ; la base le revérifie. */
export function requireHuman(ctx: RequestContext): Result<string, AppError> {
  if (ctx.actor !== "user" || !ctx.userId) return err(humanRequired());
  return ok(ctx.userId);
}

/**
 * Événements d'outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données (pas
 * d'événement fantôme, pas de donnée sans trace). L'audit est écrit en dernier (il verrouille la tête de chaîne du tenant).
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: CouncilsDeps,
    private readonly ctx: RequestContext,
  ) {}

  add(type: string, payload: { v: 1 } & Record<string, unknown>, aggregate: { type: string; id: string }): void {
    this.events.push(createDomainEvent({ type, payload, ctx: this.ctx, version: payload.v, aggregateType: aggregate.type, aggregateId: aggregate.id, clock: this.deps.clock, id: this.deps.newId() }));
  }

  audit(entry: AuditEntry): void {
    this.auditEntries.push(entry);
  }

  /** Reprend les événements et entrées d'audit d'un tampon secondaire (sous-transaction réussie). */
  absorb(other: EventBuffer): void {
    this.events.push(...other.events.splice(0));
    this.auditEntries.push(...other.auditEntries.splice(0));
  }

  get pendingTypes(): string[] {
    return this.events.map((e) => e.type);
  }

  async flush(tx: Tx): Promise<void> {
    if (this.events.length > 0) {
      await new PgOutboxWriter(tx).append(this.events);
      this.events.length = 0;
    }
    for (const entry of this.auditEntries.splice(0)) await this.deps.audit.record(tx, this.ctx, entry);
  }
}

/** Jour courant de l'établissement (`AAAA-MM-JJ`). */
export const todayOf = (deps: CouncilsDeps): string => abidjanDate(deps.clock.now());
