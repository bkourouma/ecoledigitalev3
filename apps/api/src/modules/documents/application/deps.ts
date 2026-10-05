/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre une
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni événement
 * d'outbox, ni audit, ni historique à moitié écrits), une exception inattendue remonte telle quelle.
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Le cas d'usage reçoit en plus les capacités (`ActorCaps`)
 * pour la décision CONTEXTUELLE (sur quel document). Sans capacité fournie : droit le plus restreint.
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
import { PgOutboxWriter, type TenantDb, type Tx } from "@ecoledigitale/database";
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import { noopAudit, type AuditEntry, type AuditPort, type DocumentsPorts } from "./ports";

export interface DocumentsConfig {
  /** Durée de validité d'une URL signée de téléchargement (le stockage la plafonne à 5 minutes). */
  readonly signedUrlTtlSeconds: number;
  /** Plafond ABSOLU de la taille d'un fichier, quelle que soit la configuration de l'établissement. */
  readonly hardMaxBytes: number;
  /** Taille maximale servie par la prévisualisation d'un texte (le reste est tronqué). */
  readonly previewTextMaxBytes: number;
  readonly pageSizeDefault: number;
  /** Lot de traitement des jobs (alertes, purge). */
  readonly jobBatchSize: number;
}

export const DEFAULT_DOCUMENTS_CONFIG: DocumentsConfig = Object.freeze({
  signedUrlTtlSeconds: 60,
  hardMaxBytes: 50 * 1024 * 1024,
  previewTextMaxBytes: 200_000,
  pageSizeDefault: 30,
  jobBatchSize: 200,
});

export interface DocumentsDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: DocumentsPorts;
  readonly config: DocumentsConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface DocumentsDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<DocumentsPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par les adaptateurs). Prime sur `ports`. */
  portsProvider?: () => Partial<DocumentsPorts>;
  config?: Partial<DocumentsConfig>;
  newId?: () => string;
  logger?: Logger;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé) ; sans antivirus ni conversion ; audit no-op par défaut. */
export function createDocumentsDeps(input: DocumentsDepsInput): DocumentsDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<DocumentsPorts> => input.ports ?? {});
  const ports: DocumentsPorts = {
    get storage() { return resolve().storage ?? fallback.storage; },
    get owners() { return resolve().owners ?? fallback.owners; },
    get scan() { return resolve().scan ?? fallback.scan; },
    get converter() { return resolve().converter ?? fallback.converter; },
    get usage() { return resolve().usage ?? fallback.usage; },
    get planQuota() { return resolve().planQuota ?? fallback.planQuota; },
    get textExtractor() { return resolve().textExtractor ?? fallback.textExtractor; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_DOCUMENTS_CONFIG, ...input.config },
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
  deps: DocumentsDeps,
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
    private readonly deps: DocumentsDeps,
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

/** Utilisateur agissant : un contexte sans utilisateur (système) ne dépose ni ne partage. */
export const actorIdOf = (ctx: RequestContext): string | null => ctx.userId;

export { ok };
