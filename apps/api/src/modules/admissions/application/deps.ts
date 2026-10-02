/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre une
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni événement
 * d'outbox, ni audit), une exception inattendue remonte telle quelle (les erreurs Postgres prévisibles sont traduites par
 * `mapDbError`). Les effets EXTERNES (envoi d'un message à une famille) sont enregistrés par `scope.after(...)` et exécutés
 * APRÈS le commit : un échec d'envoi n'annule jamais une décision.
 */
import { randomBytes } from "node:crypto";
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
import { PgOutboxWriter, type SystemDb, type TenantDb, type Tx } from "@ecoledigitale/database";
import { mapDbError } from "../infrastructure/db-errors";
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import { noopAudit, type AdmissionsPorts, type AuditEntry, type AuditPort } from "./ports";

export interface AdmissionsConfig {
  /** Durée de validité d'un jeton de formulaire (minutes) ; il n'est utilisable qu'après le délai minimal de l'établissement. */
  readonly formTokenTtlMinutes: number;
  /** Fenêtre (minutes) des tentatives de dépôt comptées par empreinte d'IP. */
  readonly attemptsWindowMinutes: number;
  /** Conservation du journal des tentatives et des jetons expirés (jours). */
  readonly attemptsRetentionDays: number;
  /** Limite de requêtes du formulaire public par IP et par minute (limiteur Redis). */
  readonly publicRequestsPerMinute: number;
  /** Secret des empreintes d'IP et d'agent (HMAC). Absent : secret aléatoire PAR PROCESSUS (jamais d'IP en clair). */
  readonly fingerprintSecret: string | null;
  /** Base publique du lien de réponse à une offre (`<base>/v2/apply/offer#t=<jeton>`). */
  readonly publicBaseUrl: string | null;
  /** Taille maximale absolue d'une pièce déposée par la famille. */
  readonly hardMaxFileBytes: number;
  /** Lot de traitement des jobs. */
  readonly jobBatchSize: number;
  readonly pageSizeDefault: number;
  /** Une confirmation par contact et par jour (anti-relais de spam) : fenêtre de la clé de dédoublonnage, en heures. */
  readonly confirmationDedupeHours: number;
}

export const DEFAULT_ADMISSIONS_CONFIG: AdmissionsConfig = Object.freeze({
  formTokenTtlMinutes: 120,
  attemptsWindowMinutes: 10,
  attemptsRetentionDays: 30,
  publicRequestsPerMinute: 30,
  fingerprintSecret: null,
  publicBaseUrl: null,
  hardMaxFileBytes: 15 * 1024 * 1024,
  jobBatchSize: 200,
  pageSizeDefault: 30,
  confirmationDedupeHours: 24,
});

export interface AdmissionsDeps {
  readonly db: TenantDb;
  /** Accès système explicite : résolution du lien public (table globale) et jobs. */
  readonly systemDb: SystemDb | null;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: AdmissionsPorts;
  readonly config: AdmissionsConfig;
  readonly newId: () => string;
  readonly logger: Logger;
  /** Fonctions du tenant (entitlements) ; `null` = toutes actives (tests autonomes). */
  readonly features: { isEnabled(ctx: RequestContext, featureKey: string): Promise<boolean> } | null;
  /** Secret effectif des empreintes (celui de la configuration, sinon aléatoire par processus). */
  readonly fingerprintSecret: string;
}

export interface AdmissionsDepsInput {
  db: TenantDb;
  systemDb?: SystemDb | null;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<AdmissionsPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par les adaptateurs). Prime sur `ports`. */
  portsProvider?: () => Partial<AdmissionsPorts>;
  config?: Partial<AdmissionsConfig>;
  features?: AdmissionsDeps["features"];
  newId?: () => string;
  logger?: Logger;
}

const PROCESS_SECRET = randomBytes(32).toString("hex");

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé) ; audit no-op par défaut. */
export function createAdmissionsDeps(input: AdmissionsDepsInput): AdmissionsDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<AdmissionsPorts> => input.ports ?? {});
  const ports: AdmissionsPorts = {
    get students() { return resolve().students ?? fallback.students; },
    get enrollments() { return resolve().enrollments ?? fallback.enrollments; },
    get fees() { return resolve().fees ?? fallback.fees; },
    get catalog() { return resolve().catalog ?? fallback.catalog; },
    get documents() { return resolve().documents ?? fallback.documents; },
    get notifier() { return resolve().notifier ?? fallback.notifier; },
    get captcha() { return resolve().captcha ?? null; },
    get actors() { return resolve().actors ?? fallback.actors; },
  };
  const config = { ...DEFAULT_ADMISSIONS_CONFIG, ...input.config };
  return {
    db: input.db,
    systemDb: input.systemDb ?? null,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config,
    newId: input.newId ?? newId,
    logger: input.logger ?? noopLogger,
    features: input.features ?? null,
    fingerprintSecret: config.fingerprintSecret ?? PROCESS_SECRET,
  };
}

/** Signal interne : annule la transaction en portant l'erreur métier. */
class AbortTransaction extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = "AbortTransaction";
  }
}

export interface TxScope {
  /** Effet exécuté APRÈS le commit (jamais si la transaction est annulée). Un échec est journalisé, jamais propagé. */
  after(effect: () => Promise<void>): void;
}

/** Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé ; une `AppError` levée vaut `Err`. */
export async function inTx<T>(
  deps: AdmissionsDeps,
  ctx: RequestContext,
  fn: (tx: Tx, scope: TxScope) => Promise<Result<T, AppError>>,
  options?: { readOnly?: boolean },
): Promise<Result<T, AppError>> {
  const effects: Array<() => Promise<void>> = [];
  const scope: TxScope = { after: (effect) => void effects.push(effect) };
  let result: Result<T, AppError>;
  try {
    result = await deps.db.run(
      ctx,
      async (tx) => {
        const r = await fn(tx, scope);
        if (!r.ok) throw new AbortTransaction(r.error);
        return r;
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
  for (const effect of effects) {
    try {
      await effect();
    } catch (e) {
      deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "admissions : effet post-commit en échec");
    }
  }
  return result;
}

/**
 * Événements d'outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données (pas
 * d'événement fantôme, pas de donnée sans trace). L'audit est écrit en dernier : il verrouille la tête de chaîne.
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: AdmissionsDeps,
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

/** Identité du SYSTÈME dans une décision (jobs, événements) : aucun utilisateur ne porte cet identifiant. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
export const SYSTEM_ACTOR_NAME = "Système";

export { ok, err };
export type { RequestContext };
