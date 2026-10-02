/**
 * Dépendances injectées des cas d'usage + plomberie transactionnelle.
 *
 * Un cas d'usage est une fonction `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Il ouvre UNE
 * transaction `TenantDb.run(ctx, …)` ; un échec métier attendu (`Err`) l'ANNULE (rollback complet : ni donnée, ni
 * événement d'outbox, ni audit, ni NUMÉRO de compteur consommé), une exception inattendue remonte telle quelle.
 *
 * Droits : les routes sont gardées par `requirePermission` (rbac). Le cas d'usage reçoit en plus les capacités
 * (`CallerCaps`) dont il a besoin pour des décisions CONTEXTUELLES (octroi forcé, ré-octroi). Sans capacité fournie,
 * il applique le droit le plus restreint (échec fermé).
 */
import { randomBytes } from "node:crypto";
import {
  ABIDJAN_TZ,
  abidjanDate,
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
import { PgOutboxWriter, isUniqueViolation, type TenantDb, type Tx } from "@ecoledigitale/database";
import type { IsoDate } from "../domain/types";
import { unavailablePorts } from "../infrastructure/in-memory-ports";
import { noopAudit, type AuditEntry, type AuditPort, type HigherPorts } from "./ports";

export interface HigherConfig {
  /** Fuseau de l'établissement pour « aujourd'hui » (défaut : fuseau du produit). */
  readonly timeZone: string;
}

export const DEFAULT_HIGHER_CONFIG: HigherConfig = Object.freeze({ timeZone: ABIDJAN_TZ });

export interface HigherDeps {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly ports: HigherPorts;
  readonly config: HigherConfig;
  readonly newId: () => string;
  /** Code de vérification publique d'un document (base32, ≥ 16 caractères, secret non devinable). */
  readonly newVerificationCode: () => string;
  readonly logger: Logger;
}

export interface HigherDepsInput {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditPort;
  ports?: Partial<HigherPorts>;
  /**
   * Fournisseur de ports résolu À CHAQUE ACCÈS : `academic`, `people`, `results`, `rules` et `reportcards` s'enregistrent
   * au chargement, dans un ordre quelconque (voir `registerHigherPorts`). Prime sur `ports`.
   */
  portsProvider?: () => Partial<HigherPorts>;
  config?: Partial<HigherConfig>;
  newId?: () => string;
  newVerificationCode?: () => string;
  logger?: Logger;
}

// Base32 RFC 4648 (A-Z, 2-7) : le format du code de vérification PUBLIQUE de reportcards (`^[A-Z2-7]{26}$`).
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 26 caractères sur un alphabet de 32 : 130 bits d'entropie (≥ 128), le format attendu par la vérification publique. */
export function randomVerificationCode(): string {
  const bytes = randomBytes(26);
  let out = "";
  for (const b of bytes) out += BASE32[b % 32];
  return out;
}

/** Assemble les dépendances. Ports non fournis = indisponibles (échec fermé), audit no-op par défaut. */
export function createHigherDeps(input: HigherDepsInput): HigherDeps {
  const fallback = unavailablePorts();
  const resolve = input.portsProvider ?? ((): Partial<HigherPorts> => input.ports ?? {});
  // Getters : chaque accès relit le fournisseur (enregistrement tardif des ports par les autres modules).
  const ports: HigherPorts = {
    get documents() { return resolve().documents ?? fallback.documents; },
    get credits() { return resolve().credits ?? fallback.credits; },
    get resitSession() { return resolve().resitSession ?? fallback.resitSession; },
    get cycleResults() { return resolve().cycleResults ?? fallback.cycleResults; },
    get curriculum() { return resolve().curriculum ?? fallback.curriculum; },
    get enrollments() { return resolve().enrollments ?? fallback.enrollments; },
    get students() { return resolve().students ?? fallback.students; },
    get actors() { return resolve().actors ?? fallback.actors; },
    get signatories() { return resolve().signatories ?? fallback.signatories; },
    get institution() { return resolve().institution ?? fallback.institution; },
    get rules() { return resolve().rules ?? fallback.rules; },
  };
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    audit: input.audit ?? noopAudit,
    ports,
    config: { ...DEFAULT_HIGHER_CONFIG, ...input.config },
    newId: input.newId ?? newId,
    newVerificationCode: input.newVerificationCode ?? randomVerificationCode,
    logger: input.logger ?? noopLogger,
  };
}

/** Capacités RBAC du demandeur nécessaires aux décisions contextuelles des cas d'usage. */
export interface CallerCaps {
  /** `higher.award.force` : octroi forcé (non éligible) et ré-octroi exceptionnel. */
  readonly forceAward?: boolean;
  /** `higher.diploma.manage`. */
  readonly manage?: boolean;
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
  deps: HigherDeps,
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
 * (pas d'événement fantôme, pas de donnée sans trace). L'audit est écrit en dernier : il verrouille la tête de chaîne
 * du tenant (module audit).
 */
export class EventBuffer {
  private readonly events: DomainEvent[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  constructor(
    private readonly deps: HigherDeps,
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

  /** Types d'événements en attente (tests, journalisation). */
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

/** Jour courant de l'établissement (`AAAA-MM-JJ`). */
export const todayOf = (deps: HigherDeps): IsoDate => abidjanDate(deps.clock.now(), deps.config.timeZone);

/** Année civile courante de l'établissement (année de référence des numéros). */
export const currentYear = (deps: HigherDeps): number => Number(todayOf(deps).slice(0, 4));

/** Utilisateur agissant (le contexte `system` n'en a pas). */
export const actorOf = (ctx: RequestContext): string | null => ctx.userId;

/**
 * Insertion « unique par construction » : une violation d'unicité (course entre deux requêtes) devient un conflit
 * métier explicite au lieu d'une erreur 500. L'insertion s'exécute dans un SAVEPOINT.
 */
export async function insertOrConflict<T>(tx: Tx, insert: (tx: Tx) => Promise<T>, conflictError: () => AppError): Promise<Result<T, AppError>> {
  try {
    return ok(await tx.transaction(insert));
  } catch (e) {
    if (isUniqueViolation(e)) return err(conflictError());
    throw e;
  }
}

/** Verrou consultatif de transaction sur une clé métier (sérialise les traitements concurrents d'une même clé). */
export async function lockKey(tx: Tx, ctx: RequestContext, scope: string, key: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`higher:${scope}:${ctx.tenantId}:${key}`]);
}
