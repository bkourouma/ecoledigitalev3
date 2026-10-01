/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre
 * UNE transaction `TenantDb.run(ctx, …)` (ou rejoint celle de l'appelant s'il reçoit `tx`) ; un échec métier attendu
 * (`Err`) l'ANNULE (rollback complet : ni donnée, ni événement d'outbox, ni audit à moitié écrits).
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Le cas d'usage reçoit en plus les capacités
 * (`AssessCaps`) pour les décisions CONTEXTUELLES (agir sur l'évaluation d'un autre enseignant…). Sans capacité
 * fournie, il applique le droit le plus restreint (échec fermé).
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
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import { noopAudit, type AssessPorts, type AuditEntry, type AuditPort } from "./ports";

export interface AssessConfig {
  /** Plafond de lignes d'un lot de saisie (garde-fou ; le contrat HTTP en impose 500). */
  readonly maxBatchSize: number;
}

export const DEFAULT_ASSESS_CONFIG: AssessConfig = Object.freeze({ maxBatchSize: 500 });

export interface AssessDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: AssessPorts;
  readonly config: AssessConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface AssessDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<AssessPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par `academic`, `people`…). Prime sur `ports`. */
  portsProvider?: () => Partial<AssessPorts>;
  config?: Partial<AssessConfig>;
  newId?: () => string;
  logger?: Logger;
}

export function createAssessDeps(input: AssessDepsInput): AssessDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<AssessPorts> => input.ports ?? {});
  const ports: AssessPorts = {
    get roster() { return resolve().roster ?? fallback.roster; },
    get periods() { return resolve().periods ?? fallback.periods; },
    get curriculum() { return resolve().curriculum ?? fallback.curriculum; },
    get teaching() { return resolve().teaching ?? fallback.teaching; },
    get guardianship() { return resolve().guardianship ?? fallback.guardianship; },
    get names() { return resolve().names ?? fallback.names; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_ASSESS_CONFIG, ...input.config },
    newId: input.newId ?? newId,
    logger: input.logger ?? noopLogger,
  };
}

/** Capacités RBAC du demandeur pour les décisions contextuelles des cas d'usage. */
export interface AssessCaps {
  /** `assessment.manage` : agir sur toute évaluation (autre enseignant, toute classe). */
  readonly manage?: boolean;
  readonly review?: boolean;
  readonly validate?: boolean;
  readonly publish?: boolean;
  readonly reviseRequest?: boolean;
  readonly reviseApprove?: boolean;
  readonly typeManage?: boolean;
}

/** Signal interne : annule la transaction en portant l'erreur métier. */
class AbortTransaction extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = "AbortTransaction";
  }
}

/**
 * Exécute `fn` dans une transaction tenant — ou dans celle de l'appelant si `existing` est fourni (appel inter-modules
 * depuis `results` : même transaction). `Err` ⇒ ROLLBACK + `Err` renvoyé ; une `AppError` levée vaut un `Err`.
 */
export async function inTx<T>(
  deps: Pick<AssessDeps, "db">,
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

/**
 * Événements d'outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données
 * (pas d'événement fantôme, pas de donnée sans trace). L'audit est écrit en dernier.
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: Pick<AssessDeps, "clock" | "newId" | "audit">,
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

  get pendingTypes(): string[] {
    return this.events.map((e) => e.type);
  }

  async flush(tx: Tx): Promise<void> {
    if (this.events.length > 0) {
      await new PgOutboxWriter(tx).append(this.events);
      this.events.length = 0;
    }
    for (const entry of this.auditEntries.splice(0)) await this.deps.audit.record(tx, entry);
  }
}

export const actorOf = (ctx: RequestContext): string | null => ctx.userId;
