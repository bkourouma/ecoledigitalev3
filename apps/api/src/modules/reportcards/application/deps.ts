/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle (même patron que les modules attendance et finance).
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>`. Il ouvre UNE transaction
 * `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni événement d'outbox, ni
 * audit à moitié écrits). Les événements d'outbox et l'audit sont écrits à la FIN, dans la même transaction que les données.
 */
import {
  ABIDJAN_TZ,
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
import { portUnavailable } from "../domain/errors";
import type { PdfRenderer, PdfMerger, AttendanceSummaryPort, AuditEntry, AuditPort, GuardianshipPort, KeyProvider, LearnerStandingPort, ReportcardsPorts, ResultsReadPort, StoragePort } from "./ports";
import { noopAudit } from "./ports";

export interface ReportcardsConfig {
  /** Base publique de la page de vérification (`https://<domaine>`), sans barre finale ; le QR encode `<base>/v/<code>`. */
  readonly verificationBaseUrl: string | null;
  /** Durée de validité d'une URL signée de téléchargement (≤ 300 s, AC6.1). */
  readonly signedUrlTtlSeconds: number;
  readonly timeZone: string;
  /** Tentatives de rendu avant `FAILED` (AC1.5). */
  readonly maxRenderAttempts: number;
}

export const DEFAULT_REPORTCARDS_CONFIG: ReportcardsConfig = Object.freeze({
  verificationBaseUrl: null,
  signedUrlTtlSeconds: 300,
  timeZone: ABIDJAN_TZ,
  maxRenderAttempts: 3,
});

export interface ReportcardsDeps {
  readonly db: TenantDb;
  /** Accès système (tables globales, vérification publique) ; absent = fonctions concernées indisponibles. */
  readonly systemDb: SystemDb | null;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: ReportcardsPorts;
  readonly keys: KeyProvider | null;
  readonly config: ReportcardsConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface ReportcardsDepsInput {
  db: TenantDb;
  systemDb?: SystemDb | null;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<ReportcardsPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS : `results`, `people`… s'enregistrent dans un ordre quelconque. Prime sur `ports`. */
  portsProvider?: () => Partial<ReportcardsPorts>;
  /** Fournisseur de la clé de signature (lue à chaque émission : rotation sans redémarrage). */
  keysProvider?: () => KeyProvider | null;
  keys?: KeyProvider | null;
  config?: Partial<ReportcardsConfig>;
  newId?: () => string;
  logger?: Logger;
}

function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === "then") return undefined;
      return () => Promise.reject(portUnavailable(`${name}.${String(prop)}`));
    },
  });
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé), audit no-op par défaut. */
export function createReportcardsDeps(input: ReportcardsDepsInput): ReportcardsDeps {
  const resolve = input.portsProvider ?? ((): Partial<ReportcardsPorts> => input.ports ?? {});
  const ports: ReportcardsPorts = {
    get results() { return resolve().results ?? unavailable<ResultsReadPort>("ResultsReadPort"); },
    get guardianship() { return resolve().guardianship ?? unavailable<GuardianshipPort>("GuardianshipPort"); },
    get attendance() { return resolve().attendance ?? null; },
    get standing() { return resolve().standing ?? null; },
    get directory() { return resolve().directory ?? null; },
    get storage() { return resolve().storage ?? unavailable<StoragePort>("StoragePort"); },
    get renderer() { return resolve().renderer ?? null; },
    get merger() { return resolve().merger ?? null; },
  };
  const deps: ReportcardsDeps = {
    db: input.db,
    systemDb: input.systemDb ?? null,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    get keys() { return input.keysProvider ? input.keysProvider() : (input.keys ?? null); },
    config: { ...DEFAULT_REPORTCARDS_CONFIG, ...input.config },
    newId: input.newId ?? newId,
    logger: input.logger ?? noopLogger,
  };
  return deps;
}

export type { AttendanceSummaryPort, LearnerStandingPort, PdfMerger, PdfRenderer };

/** Signal interne : annule la transaction en portant l'erreur métier. */
class AbortTransaction extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = "AbortTransaction";
  }
}

/** Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé ; une `AppError` levée vaut `Err`. */
export async function inTx<T>(
  deps: ReportcardsDeps,
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

/** Événements d'outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données. */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: ReportcardsDeps,
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
    // L'audit en dernier : il verrouille la tête de chaîne du tenant (module audit).
    for (const entry of this.auditEntries.splice(0)) await this.deps.audit.record(tx, this.ctx, entry);
  }
}

/** Jour courant dans le fuseau de l'établissement (`AAAA-MM-JJ`). */
export function todayOf(deps: ReportcardsDeps): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: deps.config.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(deps.clock.now());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Nom affiché de l'acteur dans le snapshot (figé à l'émission) : annuaire si branché, sinon un libellé neutre sans donnée personnelle. */
export async function actorLabel(deps: ReportcardsDeps, ctx: RequestContext): Promise<string> {
  if (!ctx.userId) return "Système";
  try {
    const name = await deps.ports.directory?.displayName(ctx, ctx.userId);
    if (name && name.trim()) return name.trim().slice(0, 160);
  } catch {
    /* annuaire indisponible : libellé neutre */
  }
  return `Utilisateur ${ctx.userId.slice(0, 8)}`;
}
