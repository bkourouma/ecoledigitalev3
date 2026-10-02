/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre UNE
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (ni donnée, ni événement, ni audit à
 * moitié écrits), une exception inattendue remonte telle quelle.
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). L'exécution dans le worker n'a pas de requête : elle
 * reçoit le contexte de l'AUTEUR reconstruit depuis l'instantané figé au lancement (`actorContext`).
 */
import {
  createDomainEvent,
  createRequestContext,
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
import { portUnavailable } from "../domain/errors";
import { noopAudit, type AuditEntry, type AuditPort, type ImportActorNamePort, type ImportPorts, type ImportStoragePort, type ImportTargetPort } from "./ports";
import type { ImporterKey } from "@ecoledigitale/contracts/src/v2/imports";

export interface ImportsConfig {
  /** Durée d'un bail d'exécution : un exécutant silencieux plus longtemps est remplacé. */
  readonly leaseSeconds: number;
  /** Cadence du battement de coeur (renouvelle le bail, publie la progression, lit la demande d'annulation). */
  readonly heartbeatMs: number;
  /** Tentatives d'exécution avant échec définitif d'un import. */
  readonly maxRunAttempts: number;
  /** Délai avant qu'un import `QUEUED` / `VALIDATING` sans exécutant soit republié par le job de filet. */
  readonly staleAfterSeconds: number;
  /** Un brouillon (UPLOADED, MAPPED, VALIDATED) sans activité depuis ce délai est annulé (libère le quota). */
  readonly abandonedDraftHours: number;
  /** Plafond absolu du produit (non modifiable par les réglages du tenant). */
  readonly hardMaxRows: number;
  readonly hardMaxColumns: number;
  readonly hardMaxFileBytes: number;
}

export const DEFAULT_IMPORTS_CONFIG: ImportsConfig = Object.freeze({
  leaseSeconds: 45,
  heartbeatMs: 5_000,
  maxRunAttempts: 5,
  staleAfterSeconds: 90,
  abandonedDraftHours: 72,
  hardMaxRows: 20_000,
  hardMaxColumns: 200,
  hardMaxFileBytes: 20 * 1024 * 1024,
});

export interface ImportsDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: {
    target(key: ImporterKey): ImportTargetPort<any>;
    readonly storage: ImportStoragePort;
    readonly names: ImportActorNamePort | null;
  };
  readonly config: ImportsConfig;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface ImportsDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<ImportPorts>;
  /** Fournisseur de ports résolu À CHAQUE ACCÈS (enregistrement tardif par les adaptateurs). Prime sur `ports`. */
  portsProvider?: () => Partial<ImportPorts>;
  config?: Partial<ImportsConfig>;
  newId?: () => string;
  logger?: Logger;
}

const unavailableStorage: ImportStoragePort = {
  async put() {
    throw portUnavailable("stockage");
  },
  async get() {
    throw portUnavailable("stockage");
  },
  async delete() {
    throw portUnavailable("stockage");
  },
};

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé), audit no-op par défaut. */
export function createImportsDeps(input: ImportsDepsInput): ImportsDeps {
  const resolve = input.portsProvider ?? ((): Partial<ImportPorts> => input.ports ?? {});
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? { record: (tx, entry) => (resolve().audit ?? noopAudit).record(tx, entry) },
    ports: {
      target(key) {
        const port = resolve().targets?.[key];
        if (!port) throw portUnavailable(`import ${key}`);
        return port;
      },
      get storage() {
        return resolve().storage ?? unavailableStorage;
      },
      get names() {
        return resolve().names ?? null;
      },
    },
    config: { ...DEFAULT_IMPORTS_CONFIG, ...input.config },
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
export async function inTx<T>(deps: ImportsDeps, ctx: RequestContext, fn: (tx: Tx) => Promise<Result<T, AppError>>, options?: { readOnly?: boolean }): Promise<Result<T, AppError>> {
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
 * Événements d'outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données.
 * L'audit est écrit en dernier : il verrouille la tête de chaîne.
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: ImportsDeps,
    private readonly ctx: RequestContext,
  ) {}

  add(type: string, payload: { v: 1 } & Record<string, unknown>, aggregate: { type: string; id: string }): void {
    this.events.push(
      createDomainEvent({ type, payload, ctx: this.ctx, version: payload.v, aggregateType: aggregate.type, aggregateId: aggregate.id, clock: this.deps.clock, id: this.deps.newId() }),
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
    for (const entry of this.auditEntries.splice(0)) await this.deps.audit.record(tx, entry);
  }
}

/** Instantané de l'acteur figé sur l'import (le worker n'a pas de requête HTTP). */
export interface ActorSnapshot {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly mfa: boolean;
  readonly institutionId: string | null;
  readonly campusId: string | null;
}

export const snapshotOf = (ctx: RequestContext): ActorSnapshot => ({
  userId: ctx.userId as string,
  roles: ctx.roles,
  mfa: ctx.mfa,
  institutionId: ctx.institutionId ?? null,
  campusId: ctx.campusId ?? null,
});

/** Contexte de l'auteur pour une exécution du worker : mêmes rôles, MFA et périmètre qu'au lancement. */
export function actorContext(tenantId: string, jobId: string, actor: ActorSnapshot, purpose: "validation" | "run"): RequestContext {
  return createRequestContext({
    tenantId,
    userId: actor.userId,
    roles: actor.roles,
    mfa: actor.mfa,
    institutionId: actor.institutionId,
    campusId: actor.campusId,
    actor: "user",
    requestId: `imports:${purpose}:${jobId}`,
  });
}
