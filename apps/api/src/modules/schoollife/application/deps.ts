/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre UNE
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni événement
 * d'outbox, ni audit à moitié écrits) ; un refus de la BASE (acteur non humain, quatre yeux, chevauchement…) est traduit en
 * erreur applicative stable `schoollife.*` (jamais un 500).
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Le cas d'usage reçoit en plus les capacités
 * (`CallerCaps`) pour les décisions CONTEXTUELLES (niveau d'habilitation, périmètre, permission d'approbation propre à un
 * type). Sans capacité fournie, il applique le droit le plus restreint (échec fermé).
 */
import { abidjanDate, createDomainEvent, err, isAppError, newId, noopLogger, ok, systemClock, type AppError, type Clock, type DomainEvent, type Logger, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PgOutboxWriter, type TenantDb, type Tx } from "@ecoledigitale/database";
import { humanRequired, translateViolation } from "../domain/errors";
import { clearanceOf } from "../domain/confidentiality";
import { violationOf } from "../infrastructure/pg-violations";
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import { noopAudit, type AuditEntry, type AuditPort, type SchoolLifePorts } from "./ports";
import type { SchoolLifeConfidentiality } from "@ecoledigitale/contracts/src/v2/schoollife";

export interface SchoolLifeDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: SchoolLifePorts;
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface SchoolLifeDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<SchoolLifePorts>;
  /** Fournisseur résolu À CHAQUE ACCÈS (enregistrement tardif par la plateforme). Prime sur `ports`. */
  portsProvider?: () => Partial<SchoolLifePorts>;
  newId?: () => string;
  logger?: Logger;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé), audit no-op par défaut. */
export function createSchoolLifeDeps(input: SchoolLifeDepsInput): SchoolLifeDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<SchoolLifePorts> => input.ports ?? {});
  const ports: SchoolLifePorts = {
    get enrollments() { return resolve().enrollments ?? fallback.enrollments; },
    get periods() { return resolve().periods ?? fallback.periods; },
    get people() { return resolve().people ?? fallback.people; },
    get attendance() { return resolve().attendance ?? fallback.attendance; },
    get notifications() { return resolve().notifications ?? fallback.notifications; },
    get studentStatus() { return resolve().studentStatus ?? fallback.studentStatus; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    newId: input.newId ?? newId,
    logger: input.logger ?? noopLogger,
  };
}

/**
 * Capacités RBAC du demandeur. `can` interroge une permission arbitraire (celle qu'un TYPE d'événement exige du validateur) ;
 * absente, l'exigence ne peut pas être satisfaite (échec fermé).
 */
export interface CallerCaps {
  /** Lecture de tous les élèves (sinon : ses classes, ou ses propres saisies). */
  readonly readAll?: boolean;
  readonly read?: boolean;
  readonly restrictedRead?: boolean;
  readonly confidentialRead?: boolean;
  readonly incidentWrite?: boolean;
  readonly incidentReview?: boolean;
  readonly measurePropose?: boolean;
  readonly measureValidate?: boolean;
  readonly exclusionValidate?: boolean;
  readonly measureRevoke?: boolean;
  readonly appealFile?: boolean;
  readonly appealDecide?: boolean;
  readonly noteWrite?: boolean;
  readonly convocationManage?: boolean;
  readonly conductManage?: boolean;
  readonly conductAdjust?: boolean;
  readonly settingsManage?: boolean;
  readonly exclusionApply?: boolean;
  /** Portails : lire la vie scolaire partageable de ses enfants / de soi-même, déposer un recours, accuser réception. */
  readonly selfRead?: boolean;
  readonly childRead?: boolean;
  readonly selfAppeal?: boolean;
  readonly childAppeal?: boolean;
  readonly childAcknowledge?: boolean;
  readonly can?: (permission: string) => Promise<boolean>;
}

export const clearanceOfCaps = (caps: CallerCaps): SchoolLifeConfidentiality => clearanceOf({ restricted: caps.restrictedRead === true, confidential: caps.confidentialRead === true });

/** Signal interne : annule la transaction en portant l'erreur métier. */
class AbortTransaction extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = "AbortTransaction";
  }
}

/** Exécute `fn` dans une transaction tenant. `Err` ⇒ ROLLBACK + `Err` renvoyé ; une violation de la base devient une `AppError`. */
export async function inTx<T>(deps: SchoolLifeDeps, ctx: RequestContext, fn: (tx: Tx) => Promise<Result<T, AppError>>, options?: { readOnly?: boolean }): Promise<Result<T, AppError>> {
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
    const violation = violationOf(e);
    const translated = violation ? translateViolation(violation) : null;
    if (translated) return err(translated);
    throw e;
  }
}

/** Refuse tout acte (décision, validation, mesure, saisie) qui ne vient pas d'un UTILISATEUR identifié ; la base le revérifie. */
export function requireHuman(ctx: RequestContext): Result<string, AppError> {
  if (ctx.actor !== "user" || !ctx.userId) return err(humanRequired());
  return ok(ctx.userId);
}

/**
 * Événements d'outbox et entrées d'audit d'un cas d'usage, écrits à la FIN, dans la même transaction que les données (pas
 * d'événement fantôme, pas de donnée sans trace). L'audit est écrit en dernier (il verrouille la tête de chaîne du tenant).
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: SchoolLifeDeps,
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

  get pendingTypes(): string[] {
    return this.events.map((e) => e.type);
  }

  async flush(tx: Tx): Promise<void> {
    if (this.events.length > 0) {
      await new PgOutboxWriter(tx).append(this.events);
      this.events.length = 0;
    }
    for (const entry of this.auditEntries.splice(0)) await this.deps.audit.record(tx, this.ctx, entry);
  }
}

/** Jour courant de l'établissement (`AAAA-MM-JJ`). */
export const todayOf = (deps: SchoolLifeDeps): string => abidjanDate(deps.clock.now());
