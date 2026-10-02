/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre UNE
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni événement
 * d'outbox, ni audit), une exception inattendue remonte telle quelle.
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Le cas d'usage reçoit en plus les capacités (`CallerCaps`)
 * pour des décisions CONTEXTUELLES (toutes les classes ou seulement les siennes). Sans capacité : droit le plus restreint.
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
import { ABIDJAN_TZ, abidjanDate } from "@ecoledigitale/kernel";
import { PgOutboxWriter, type TenantDb, type Tx } from "@ecoledigitale/database";
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import { noopAudit, type AuditEntry, type AuditPort, type PrimarySchoolPorts } from "./ports";

export interface PrimarySchoolConfig {
  /** Fuseau de l'établissement pour « aujourd'hui » (défaut : fuseau du produit). */
  readonly timeZone: string;
  /** Délai au-delà duquel un bilan resté BROUILLON est purgé par le job de nettoyage. */
  readonly draftReviewRetentionDays: number;
}

export const DEFAULT_PRIMARY_SCHOOL_CONFIG: PrimarySchoolConfig = Object.freeze({ timeZone: ABIDJAN_TZ, draftReviewRetentionDays: 90 });

export interface PrimarySchoolDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: PrimarySchoolPorts;
  readonly config: PrimarySchoolConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface PrimarySchoolDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<PrimarySchoolPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par les adaptateurs). Prime sur `ports`. */
  portsProvider?: () => Partial<PrimarySchoolPorts>;
  config?: Partial<PrimarySchoolConfig>;
  newId?: () => string;
  logger?: Logger;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé), audit no-op par défaut. */
export function createPrimarySchoolDeps(input: PrimarySchoolDepsInput): PrimarySchoolDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<PrimarySchoolPorts> => input.ports ?? {});
  const ports: PrimarySchoolPorts = {
    get classrooms() { return resolve().classrooms ?? fallback.classrooms; },
    get periods() { return resolve().periods ?? fallback.periods; },
    get outcomes() { return resolve().outcomes ?? fallback.outcomes; },
    get teaching() { return resolve().teaching ?? fallback.teaching; },
    get guardianship() { return resolve().guardianship ?? fallback.guardianship; },
    get results() { return resolve().results ?? fallback.results; },
    get rules() { return resolve().rules ?? fallback.rules; },
    get attendance() { return resolve().attendance ?? fallback.attendance; },
    get documents() { return resolve().documents ?? fallback.documents; },
    get templates() { return resolve().templates ?? fallback.templates; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_PRIMARY_SCHOOL_CONFIG, ...input.config },
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
  deps: PrimarySchoolDeps,
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
 * Événements d'outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données (pas
 * d'événement fantôme, pas de donnée sans trace). L'audit est écrit en dernier : il verrouille la tête de chaîne du tenant.
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: PrimarySchoolDeps,
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

/** Utilisateur agissant (le contexte `system` n'en a pas). */
export const actorOf = (ctx: RequestContext): string | null => ctx.userId;

/** Jour courant de l'établissement (`AAAA-MM-JJ`). */
export const todayOf = (deps: PrimarySchoolDeps): string => abidjanDate(deps.clock.now(), deps.config.timeZone);

export { ok };
