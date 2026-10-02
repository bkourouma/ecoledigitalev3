/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre UNE
 * transaction `TenantDb.run(ctx, …)` ; les échecs métier attendus (`Err`) l'ANNULENT (rollback complet : ni donnée, ni
 * événement outbox, ni entrée d'audit à moitié écrits), les exceptions inattendues remontent telles quelles.
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
import { isoDate } from "../domain/normalize";
import { createProjectionEnrollmentDirectory } from "../infrastructure/projection-enrollment-directory";
import {
  noopAudit,
  type AccountProvisioner,
  type AcademicQuery,
  type AuditEntry,
  type AuditPort,
  type CountryProfileProvider,
  type EnrollmentDirectory,
  type StoragePort,
} from "./ports";

export interface PeopleConfig {
  /** Taille maximale d'une photo (octets) — R13 : 2 Mo par défaut, configurable. */
  photoMaxBytes: number;
  /** Plafond de l'export CSV (AC7.4). */
  exportMaxRows: number;
  /** Plafond de pagination des listes (AC4.3). */
  maxPageSize: number;
  /** Durée de validité d'une URL signée de pièce. */
  signedUrlTtlSec: number;
  /** Plafond de `getStudentsByIds` / `getStaffByIds`. */
  maxBatchSize: number;
}

export const DEFAULT_PEOPLE_CONFIG: PeopleConfig = Object.freeze({
  photoMaxBytes: 2 * 1024 * 1024,
  exportMaxRows: 5_000,
  maxPageSize: 200,
  signedUrlTtlSec: 120,
  maxBatchSize: 500,
});

export interface PeopleDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly logger: Logger;
  readonly newId: () => string;
  readonly config: PeopleConfig;
  readonly accounts: AccountProvisioner | null;
  readonly storage: StoragePort | null;
  readonly academic: AcademicQuery | null;
  readonly enrollments: EnrollmentDirectory;
  readonly country: CountryProfileProvider | null;
}

export interface PeopleDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  logger?: Logger;
  newId?: () => string;
  config?: Partial<PeopleConfig>;
  accounts?: AccountProvisioner;
  storage?: StoragePort;
  academic?: AcademicQuery;
  /** Défaut : la projection des inscriptions du module (voir `infrastructure/projection-enrollment-directory`). */
  enrollments?: EnrollmentDirectory;
  country?: CountryProfileProvider;
  /** Ports branchés après la construction (adaptateurs de plateforme) : lus à chaque accès, prioritaires sur les ports injectés. */
  portsProvider?: () => Partial<{
    accounts: AccountProvisioner;
    storage: StoragePort;
    academic: AcademicQuery;
    enrollments: EnrollmentDirectory;
    country: CountryProfileProvider;
  }>;
}

/**
 * Assemble les dépendances avec des valeurs par défaut SÛRES : audit no-op, aucun port externe (chaque cas d'usage qui
 * en a besoin répond par une erreur explicite) ; l'annuaire d'inscriptions est la projection du module.
 */
export function createPeopleDeps(input: PeopleDepsInput): PeopleDeps {
  const projection = input.enrollments ?? createProjectionEnrollmentDirectory(input.db);
  const provided = (): NonNullable<ReturnType<NonNullable<PeopleDepsInput["portsProvider"]>>> => input.portsProvider?.() ?? {};
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    logger: input.logger ?? noopLogger,
    newId: input.newId ?? newId,
    config: { ...DEFAULT_PEOPLE_CONFIG, ...input.config },
    get accounts() {
      return provided().accounts ?? input.accounts ?? null;
    },
    get storage() {
      return provided().storage ?? input.storage ?? null;
    },
    get academic() {
      return provided().academic ?? input.academic ?? null;
    },
    get enrollments() {
      return provided().enrollments ?? projection;
    },
    get country() {
      return provided().country ?? input.country ?? null;
    },
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
 * Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé. Une `AppError` levée (ex. `ValidationError`)
 * est traitée comme un `Err`.
 */
export async function inTx<T>(
  deps: PeopleDeps,
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
 * Événements outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données.
 * L'audit est écrit en dernier : il verrouille la tête de chaîne du tenant (module audit), tandis que les compteurs de
 * numérotation sont pris pendant le traitement — ordre constant « compteurs puis chaîne », donc pas d'interblocage.
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: PeopleDeps,
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

  async flush(tx: Tx): Promise<void> {
    if (this.events.length > 0) {
      await new PgOutboxWriter(tx).append(this.events);
      this.events.length = 0;
    }
    for (const entry of this.auditEntries.splice(0)) {
      await this.deps.audit.record(tx, entry);
    }
  }
}

/** Date du jour (UTC) selon l'horloge injectée. */
export const todayOf = (deps: Pick<PeopleDeps, "clock">): string => isoDate(deps.clock.now());

/** Utilisateur agissant (le contexte `system` n'en a pas). */
export const actorId = (ctx: RequestContext): string | null => ctx.userId;

/** Borne une pagination (AC4.3 : plafond de 200 lignes). */
export function clampPage(deps: Pick<PeopleDeps, "config">, page: { limit?: number | undefined; offset?: number | undefined }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(page.limit ?? 50), 1), deps.config.maxPageSize);
  const offset = Math.max(Math.trunc(page.offset ?? 0), 0);
  return { limit, offset };
}
