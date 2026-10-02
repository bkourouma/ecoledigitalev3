/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>`
 * (convention n° 4). Il ouvre UNE transaction `TenantDb.run(ctx, …)` ; les échecs métier
 * attendus (`Err`) l'ANNULENT (rollback complet : ni donnée, ni événement outbox à moitié
 * écrits), les exceptions inattendues remontent telles quelles.
 */
import {
  createDomainEvent,
  isAppError,
  newId,
  err,
  ok,
  noopLogger,
  systemClock,
  type AppError,
  type Clock,
  type CurrencyCode,
  type DomainEvent,
  type Logger,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { PgOutboxWriter, isUniqueViolation, type TenantDb, type Tx } from "@ecoledigitale/database";
import { DEFAULT_ALLOCATION_ORDER, type AllocationOrder } from "../domain/types";
import { noopAudit, type AuditEntry, type AuditPort } from "./ports/audit";
import { noEnrollments, passThroughLearners, type EnrollmentDirectory, type LearnerDirectory } from "./ports/directories";
import { unavailableReceiptDocuments, type ReceiptDocumentPort } from "./ports/documents";
import { denyAllGuardianship, type GuardianshipPort } from "./ports/guardianship";
import { createProviderRegistry, type AppEnvironment, type ProviderRegistry } from "../infrastructure/providers/registry";
import { unavailableSecretStore } from "../infrastructure/secrets/aes-gcm-secret-store";
import type { SecretStorePort } from "./ports/secret-store";

export interface FinanceConfig {
  /** Environnement d'exécution : détermine la politique des fournisseurs de paiement. */
  environment: AppEnvironment;
  defaultCurrency: CurrencyCode;
  allocationOrder: AllocationOrder;
  /** Plafond du cumul des remises sur une facture, en points de base du brut. */
  maxDiscountBps: number;
  /** Autorise le demandeur d'un remboursement à l'approuver lui-même (déconseillé). */
  refundSelfApproval: boolean;
  /** Écart de caisse toléré sans justification (unités mineures). */
  cashVarianceTolerance: number;
  /** URL publique de base des webhooks (communiquée aux fournisseurs). */
  webhookBaseUrl: string | null;
  /** Plafond de lignes d'un export CSV serveur (au-delà : fichier tronqué ET signalé `X-Export-Truncated`). */
  exportMaxRows: number;
}

export const DEFAULT_FINANCE_CONFIG: FinanceConfig = Object.freeze({
  environment: "production",
  defaultCurrency: "XOF",
  allocationOrder: DEFAULT_ALLOCATION_ORDER,
  maxDiscountBps: 10_000,
  refundSelfApproval: false,
  cashVarianceTolerance: 0,
  webhookBaseUrl: null,
  exportMaxRows: 50_000,
});

export interface FinanceDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly providers: ProviderRegistry;
  readonly learners: LearnerDirectory;
  readonly enrollments: EnrollmentDirectory;
  /** Lien de tutelle / identité de l'élève (routes famille `/me/*`) : refuse tout tant qu'il n'est pas branché. */
  readonly guardianship: GuardianshipPort;
  /** Rendu PDF des reçus (module reportcards) : indisponible tant qu'il n'est pas branché. */
  readonly documents: ReceiptDocumentPort;
  /** Coffre des secrets marchands (identifiants des fournisseurs) : indisponible tant qu'aucune clé maître n'est configurée. */
  readonly secrets: SecretStorePort;
  /** Appelé après une écriture de configuration d'un fournisseur : invalide le cache de la source de configuration. */
  readonly providerConfigChanged: (tenantId: string, provider: string) => void;
  readonly config: FinanceConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface FinanceDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  providers?: ProviderRegistry;
  learners?: LearnerDirectory;
  enrollments?: EnrollmentDirectory;
  guardianship?: GuardianshipPort;
  documents?: ReceiptDocumentPort;
  secrets?: SecretStorePort;
  providerConfigChanged?: (tenantId: string, provider: string) => void;
  config?: Partial<FinanceConfig>;
  newId?: () => string;
  logger?: Logger;
  /** Annuaires branchés après la construction (adaptateurs de plateforme) : lus à chaque accès, prioritaires sur `learners` / `enrollments`. */
  portsProvider?: () => Partial<{ learners: LearnerDirectory; enrollments: EnrollmentDirectory; guardianship: GuardianshipPort; documents: ReceiptDocumentPort }>;
}

/**
 * Assemble les dépendances avec des valeurs par défaut SÛRES : environnement
 * `production` (donc aucune simulation de paiement), audit no-op, annuaires
 * passe-plat tant que le cœur académique n'existe pas.
 */
export function createFinanceDeps(input: FinanceDepsInput): FinanceDeps {
  const config: FinanceConfig = { ...DEFAULT_FINANCE_CONFIG, ...input.config };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    providers: input.providers ?? createProviderRegistry({ environment: config.environment }),
    get learners() {
      return input.portsProvider?.().learners ?? input.learners ?? passThroughLearners;
    },
    get enrollments() {
      return input.portsProvider?.().enrollments ?? input.enrollments ?? noEnrollments;
    },
    get guardianship() {
      return input.portsProvider?.().guardianship ?? input.guardianship ?? denyAllGuardianship;
    },
    get documents() {
      return input.portsProvider?.().documents ?? input.documents ?? unavailableReceiptDocuments;
    },
    secrets: input.secrets ?? unavailableSecretStore,
    providerConfigChanged: input.providerConfigChanged ?? (() => undefined),
    config,
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
 * Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé.
 * Une `AppError` levée (ex. `ValidationError` du kernel) est traitée comme un `Err`.
 */
export async function inTx<T>(
  deps: FinanceDeps,
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
 * Événements outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même
 * transaction que les données. L'audit est écrit en dernier : il verrouille la tête de
 * chaîne du tenant (module audit), tandis que les compteurs de numérotation sont pris
 * pendant le traitement — ordre constant « compteurs puis chaîne », donc pas d'interblocage.
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: FinanceDeps,
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

  /** Met une entrée d'audit en file ; elle est écrite par `flush`, après les événements. */
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

export async function audit(deps: FinanceDeps, tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
  await deps.audit.record(tx, ctx, entry);
}

export const moneyPayload = (m: { amount: number; currency: string }): { amount: number; currency: string } => ({
  amount: m.amount,
  currency: m.currency,
});

/** Utilisateur agissant (le contexte `system` n'en a pas). */
export const actorId = (ctx: RequestContext): string | null => ctx.userId;

/**
 * Insertion « unique par construction » : une violation d'unicité (course entre deux requêtes,
 * code déjà pris) devient un conflit métier explicite (409) au lieu d'une erreur 500. L'insertion
 * s'exécute dans un SAVEPOINT pour ne pas empoisonner la transaction englobante.
 */
export async function insertOrConflict<T>(
  tx: Tx,
  insert: (tx: Tx) => Promise<T>,
  conflictError: () => AppError,
): Promise<Result<T, AppError>> {
  try {
    return ok(await tx.transaction(insert));
  } catch (e) {
    if (isUniqueViolation(e)) return err(conflictError());
    throw e;
  }
}

/**
 * Sérialise les requêtes concurrentes portant la MÊME clé d'idempotence (verrou consultatif de
 * transaction) : la seconde attend la fin de la première puis relit son résultat committé au lieu
 * d'échouer sur la contrainte d'unicité.
 */
export async function lockIdempotencyKey(tx: Tx, ctx: RequestContext, scope: string, key: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`finance:${scope}:${ctx.tenantId}:${key}`]);
}
