/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre
 * UNE transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (ni donnée, ni événement outbox, ni
 * audit à moitié écrits), les exceptions inattendues remontent telles quelles.
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
import { PgOutboxWriter, type SystemDb, type TenantDb, type Tx } from "@ecoledigitale/database";
import { isProductionEnvironment } from "../domain/environment";
import { CompiledVersionCache } from "./compiled";
import { defaultReplaySources, defaultSimulationSources } from "./registry";
import { noopAudit, type ReplaySource, type RulesAuditPort, type SimulationCaseSource } from "./ports";

export interface RulesConfig {
  /** Budget d'évaluation par défaut (R-RUL-11) ; le moteur applique 100 000 nœuds / 1 000 ms sinon. */
  readonly evaluationBudget?: { maxNodes?: number; maxMillis?: number };
  /** Journalise les échecs d'évaluation dans `rules.evaluation_failures` (défaut : oui). */
  readonly logEvaluationFailures: boolean;
  /** Plafond du nombre de différences détaillées conservées par simulation (AC2.4). */
  readonly maxSimulationDifferences: number;
  /**
   * Environnement de PRODUCTION : la liaison d'un jeu de règles fictif (`placeholder`) exige alors un accusé explicite.
   * Dérivé de `RULES_ENV` / `NODE_ENV` par `createRulesDeps` (défaut sûr : production).
   */
  readonly productionMode: boolean;
}

export const DEFAULT_RULES_CONFIG: RulesConfig = Object.freeze({
  logEvaluationFailures: true,
  maxSimulationDifferences: 1000,
  productionMode: false,
});

export interface RulesDeps {
  readonly db: TenantDb;
  readonly systemDb: SystemDb;
  readonly clock: Clock;
  readonly audit: RulesAuditPort;
  readonly logger: Logger;
  readonly newId: () => string;
  readonly cache: CompiledVersionCache;
  readonly config: RulesConfig;
  /** Sources de cas de simulation, par contrat (ports des modules consommateurs). */
  readonly simulationSources: Map<string, SimulationCaseSource>;
  /** Sources de rejeu (échantillon de résultats FINAL), enregistrées par les consommateurs. */
  readonly replaySources: Map<string, ReplaySource>;
  /** Exécution détachée (simulation asynchrone) ; les promesses en cours sont suivies pour `drain`. */
  readonly background: BackgroundTasks;
}

/** Suivi des tâches de fond (simulations) : `drain()` attend leur fin (arrêt propre, tests). */
export class BackgroundTasks {
  private readonly running = new Set<Promise<unknown>>();

  constructor(private readonly onError: (e: unknown) => void = () => undefined) {}

  run(task: () => Promise<unknown>): void {
    const p: Promise<unknown> = Promise.resolve()
      .then(task)
      .catch((e: unknown) => this.onError(e))
      .finally(() => this.running.delete(p));
    this.running.add(p);
  }

  async drain(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  get pending(): number {
    return this.running.size;
  }
}

export interface RulesDepsInput {
  db: TenantDb;
  systemDb: SystemDb;
  clock?: Clock;
  audit?: RulesAuditPort;
  logger?: Logger;
  newId?: () => string;
  cache?: CompiledVersionCache;
  config?: Partial<RulesConfig>;
  simulationSources?: Map<string, SimulationCaseSource>;
  replaySources?: Map<string, ReplaySource>;
}

export function createRulesDeps(input: RulesDepsInput): RulesDeps {
  const logger = input.logger ?? noopLogger;
  return {
    db: input.db,
    systemDb: input.systemDb,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    logger,
    newId: input.newId ?? newId,
    cache: input.cache ?? new CompiledVersionCache(),
    config: { ...DEFAULT_RULES_CONFIG, productionMode: isProductionEnvironment(process.env), ...input.config },
    simulationSources: input.simulationSources ?? defaultSimulationSources,
    replaySources: input.replaySources ?? defaultReplaySources,
    background: new BackgroundTasks((e) => logger.error({ err: e instanceof Error ? e.message : String(e) }, "rules : tâche de fond en échec")),
  };
}

/** Signal interne : annule la transaction en portant l'erreur métier. */
class AbortTransaction extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = "AbortTransaction";
  }
}

/** Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé ; une `AppError` levée vaut un `Err`. */
export async function inTx<T>(
  deps: Pick<RulesDeps, "db">,
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

/** Idem pour une transaction `SystemDb` (catalogue national : aucun tenant). */
export async function inSystemTx<T>(
  deps: Pick<RulesDeps, "systemDb">,
  reason: string,
  fn: (tx: Tx) => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> {
  try {
    return await deps.systemDb.run(reason, async (tx) => {
      const result = await fn(tx);
      if (!result.ok) throw new AbortTransaction(result.error);
      return result;
    });
  } catch (e) {
    if (e instanceof AbortTransaction) return err(e.error);
    if (isAppError(e)) return err(e);
    throw e;
  }
}

/** Événements outbox d'un cas d'usage, écrits à la FIN, dans la même transaction que les données (ADR-004). */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  constructor(
    private readonly deps: Pick<RulesDeps, "clock" | "newId">,
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

  get size(): number {
    return this.events.length;
  }

  async flush(tx: Tx): Promise<void> {
    if (this.events.length === 0) return;
    await new PgOutboxWriter(tx).append(this.events);
    this.events.length = 0;
  }
}
