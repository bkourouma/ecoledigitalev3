/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre une
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (ni donnée, ni événement d'outbox, ni audit
 * à moitié écrits), une exception inattendue remonte telle quelle.
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Les ACTES HUMAINS (vérifier, rejeter, activer, suspendre,
 * terminer, amender, planifier ou annuler une échéance, réaliser un contrôle…) exigent en plus un contexte `user` : refus 403
 * `stateassign.human_actor_required` avant même d'ouvrir la transaction, et de nouveau par la base (défense en profondeur).
 */
import {
  createDomainEvent,
  err,
  isAppError,
  newId,
  noopLogger,
  ok,
  systemClock,
  abidjanDate,
  type AppError,
  type Clock,
  type DomainEvent,
  type Logger,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { PgOutboxWriter, type TenantDb, type Tx } from "@ecoledigitale/database";
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import { StateassignCode, forbidden } from "../domain/errors";
import type { IsoDate } from "../domain/types";
import { noopAudit, type AuditEntry, type AuditPort, type StateassignPorts } from "./ports";

export interface StateassignConfig {
  /** Devise des montants déclarés (défaut XOF : le franc). */
  readonly defaultCurrency: string;
  readonly pageSizeDefault: number;
  /** Lot de traitement des jobs (rapprochement, alertes, planification). */
  readonly jobBatchSize: number;
  /** Plafond des lignes d'un export (au-delà : tronqué ET signalé). */
  readonly exportMaxRows: number;
}

export const DEFAULT_STATEASSIGN_CONFIG: StateassignConfig = Object.freeze({
  defaultCurrency: "XOF",
  pageSizeDefault: 30,
  jobBatchSize: 200,
  exportMaxRows: 50_000,
});

export interface StateassignDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: StateassignPorts;
  readonly config: StateassignConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface StateassignDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<StateassignPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par les adaptateurs). Prime sur `ports`. */
  portsProvider?: () => Partial<StateassignPorts>;
  config?: Partial<StateassignConfig>;
  newId?: () => string;
  logger?: Logger;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé) ; passerelle `NotConfigured` ; audit no-op par défaut. */
export function createStateassignDeps(input: StateassignDepsInput): StateassignDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<StateassignPorts> => input.ports ?? {});
  const ports: StateassignPorts = {
    get enrollments() { return resolve().enrollments ?? fallback.enrollments; },
    get funding() { return resolve().funding ?? fallback.funding; },
    get finance() { return resolve().finance ?? fallback.finance; },
    get attendance() { return resolve().attendance ?? fallback.attendance; },
    get documents() { return resolve().documents ?? fallback.documents; },
    get students() { return resolve().students ?? fallback.students; },
    get guardianship() { return resolve().guardianship ?? fallback.guardianship; },
    get gateway() { return resolve().gateway ?? fallback.gateway; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_STATEASSIGN_CONFIG, ...input.config },
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
  deps: StateassignDeps,
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
    private readonly deps: StateassignDeps,
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

/** Date civile du jour à Abidjan (`Clock` injecté : jamais `new Date()`). */
export const todayOf = (deps: Pick<StateassignDeps, "clock">): IsoDate => abidjanDate(deps.clock.now());

/** Acte HUMAIN : un utilisateur identifié. Un job, un abonné, un opérateur de plateforme sont refusés. */
export function requireHuman(ctx: RequestContext): Result<string, AppError> {
  if (ctx.actor !== "user" || ctx.userId === null) {
    return err(forbidden(StateassignCode.HUMAN_ACTOR_REQUIRED, "Cet acte exige un utilisateur identifié : il ne peut pas être fait automatiquement."));
  }
  return ok(ctx.userId);
}

export { ok, err };
