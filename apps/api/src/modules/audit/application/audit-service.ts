/**
 * Service d'audit : `record`, `withAudit`, `verifyChain`.
 *
 * ── CONCURRENCE (choix justifié) ───────────────────────────────────────────────
 * La chaîne est PAR TENANT : deux tenants n'ont aucun lien et s'écrivent en parallèle.
 * Au sein d'un tenant, chaque entrée dépend de la précédente (prev_hash, seq), donc les
 * insertions doivent être sérialisées. On utilise un verrou advisory TRANSACTIONNEL
 * (`pg_advisory_xact_lock`, clé = hash du tenant) plutôt qu'un `SELECT … FOR UPDATE` sur
 * la tête :
 *   - il est relâché automatiquement au COMMIT/ROLLBACK de la transaction métier (pas de
 *     verrou orphelin, pas de nettoyage) ;
 *   - il n'exige aucun droit UPDATE sur la table de tête pour app_user (la tête n'est
 *     avancée que par un trigger SECURITY DEFINER) ;
 *   - il ne bloque QUE les autres écritures d'audit du même tenant, jamais les lectures
 *     ni les autres tables.
 * Coût : il est tenu jusqu'à la fin de la transaction métier. Règle d'usage : appeler
 * `audit.record` EN DERNIER dans la transaction (après les écritures métier), pour que la
 * fenêtre de sérialisation soit minimale. `withAudit` le fait.
 * Risque de deadlock : une transaction qui tient le verrou d'audit puis attend une ligne
 * métier détenue par une autre transaction qui attend elle-même le verrou d'audit. Même
 * remède (audit en dernier) ; Postgres détecte et avorte l'une des deux le cas échéant.
 * Le verrou est pris dans un énoncé SÉPARÉ de la lecture de la tête (READ COMMITTED : une
 * lecture dans le même énoncé utiliserait un instantané antérieur à l'attente).
 * En REPEATABLE READ/SERIALIZABLE la lecture de la tête peut être périmée : le trigger de
 * garde lève alors AU002 plutôt que d'écrire une chaîne incohérente.
 */
import { InternalError, getRequestContext, isUuid, newId, systemClock, type Clock, type RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { byteLength, canonicalize, sha256Hex, toJsonValue } from "../domain/canonical";
import { describeDevice } from "../domain/device";
import { computeDiff } from "../domain/diff";
import { GENESIS_HASH, PLATFORM_SCOPE, computeEntryHash, type HashableEntry, type HmacKey } from "../domain/hash";
import { createMasker, type Masker, type MaskingConfig } from "../domain/masking";
import {
  ACTION_RE,
  AUDIT_ACTOR_TYPES,
  AUDIT_SEVERITIES,
  ENTITY_RE,
  type AuditActor,
  type AuditEntryInput,
  type AuditSeverity,
  type JsonValue,
  type RecordResult,
} from "../domain/types";
import { ensurePartitionFor, insertEntry, lockChain, readHead, type ChainTarget } from "../infrastructure/chain-repository";
import { getAuditRequestMeta } from "./request-meta";
import { verifyChainOn, type ChainRange, type ChainVerification } from "./verify-chain";

export interface AuditServiceOptions {
  clock?: Clock;
  masking?: Partial<MaskingConfig>;
  /**
   * HMAC-SHA-256 au lieu de SHA-256 simple. `keys` contient TOUTES les clés connues (les
   * anciennes servent à vérifier d'anciennes lignes) ; `activeKeyId` signe les nouvelles.
   * Les secrets viennent d'un gestionnaire de secrets, jamais du dépôt.
   */
  hmac?: { activeKeyId: string; keys: Readonly<Record<string, string | Buffer>> } | null;
  /** Taille maximale (octets, JSON canonique) de chaque champ before/after/diff/metadata. */
  maxFieldBytes?: number;
}

export interface WithAuditMeta<T> extends Omit<AuditEntryInput, "before" | "after" | "entityId"> {
  entityId?: AuditEntryInput["entityId"] | ((result: T) => AuditEntryInput["entityId"]);
  /**
   * Lit l'état de l'objet audité (dans la même transaction). Appelé AVANT puis APRÈS `fn`.
   * Doit renvoyer une valeur sérialisable ; le masquage est appliqué ensuite.
   */
  snapshot?: (tx: Tx) => Promise<unknown>;
  /** Alternative à `snapshot` : état « avant » fourni, état « après » dérivé du résultat. */
  before?: unknown;
  after?: (result: T) => unknown;
}

const DEFAULT_MAX_FIELD_BYTES = 64 * 1024;
const VERIFY_LABEL = "audit";

const fail = (message: string, code: string): InternalError => new InternalError(message, { code });

const clip = (v: string | null | undefined, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.replace(/\u0000/g, "").trim();
  return t === "" ? null : t.slice(0, max);
};

export class AuditService {
  private clock: Clock;
  private masker: Masker;
  private hmac: HmacKey | null = null;
  private keys: Map<string, Buffer | string> = new Map();
  private maxFieldBytes: number;

  constructor(options: AuditServiceOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.masker = createMasker(options.masking);
    this.maxFieldBytes = options.maxFieldBytes ?? DEFAULT_MAX_FIELD_BYTES;
    this.applyHmac(options.hmac ?? null);
    // Méthodes liées : `const { record } = audit` reste utilisable.
    this.record = this.record.bind(this);
    this.recordPlatform = this.recordPlatform.bind(this);
    this.withAudit = this.withAudit.bind(this);
    this.verifyChain = this.verifyChain.bind(this);
    this.verifyPlatformChain = this.verifyPlatformChain.bind(this);
  }

  /** Reconfigure le service (câblage au démarrage). Les options absentes reprennent leur défaut. */
  configure(options: AuditServiceOptions): void {
    this.clock = options.clock ?? systemClock;
    this.masker = createMasker(options.masking);
    this.maxFieldBytes = options.maxFieldBytes ?? DEFAULT_MAX_FIELD_BYTES;
    this.applyHmac(options.hmac ?? null);
  }

  private applyHmac(hmac: AuditServiceOptions["hmac"]): void {
    this.keys = new Map(Object.entries(hmac?.keys ?? {}));
    if (!hmac) {
      this.hmac = null;
      return;
    }
    const secret = hmac.keys[hmac.activeKeyId];
    if (secret === undefined || secret.length < 16) {
      throw fail("Clé HMAC d'audit active absente ou trop courte (16 caractères minimum).", "AUDIT_HMAC_KEY_INVALID");
    }
    this.hmac = { id: hmac.activeKeyId, secret };
  }

  /** Masqueur courant (utile aux autres couches, ex. export). */
  get masking(): Masker {
    return this.masker;
  }

  // ------------------------------------------------------------------ écriture

  /**
   * Écrit une entrée dans la transaction COURANTE de `tx` : si la transaction métier est
   * annulée, l'entrée l'est aussi (et inversement : pas d'opération sensible sans trace).
   * Renseigne automatiquement tenant, acteur, requestId (RequestContext) et ip/user-agent
   * (portée HTTP, si présente).
   */
  async record(tx: Tx, input: AuditEntryInput): Promise<RecordResult> {
    const ctx = getRequestContext();
    const tenantId = (input.tenantId ?? ctx?.tenantId)?.toLowerCase();
    if (!tenantId) {
      throw fail("audit.record : aucun tenant (pas de RequestContext actif, tenantId non fourni).", "AUDIT_TENANT_MISSING");
    }
    if (!isUuid(tenantId)) throw fail("audit.record : tenantId invalide.", "AUDIT_TENANT_INVALID");
    if (ctx && ctx.tenantId.toLowerCase() !== tenantId) {
      throw fail("audit.record : le tenant de l'entrée diffère de celui de la transaction.", "AUDIT_TENANT_MISMATCH");
    }
    return this.write(tx, { kind: "tenant", tenantId }, input, ctx);
  }

  /**
   * Journal de PLATEFORME (événement sans tenant). À appeler depuis `SystemDb.run`.
   * Table globale hors RLS : ne jamais y mettre de donnée d'un tenant.
   */
  async recordPlatform(tx: Tx, input: Omit<AuditEntryInput, "tenantId">): Promise<RecordResult> {
    return this.write(tx, { kind: "platform" }, input, getRequestContext());
  }

  /**
   * Exécute `fn` (la mutation) et journalise avant/après dans la même transaction.
   * `record` est appelé APRÈS `fn` : le verrou de chaîne n'est tenu que sur la fin de la
   * transaction. Si `fn` lève, rien n'est journalisé (et la transaction est annulée).
   */
  async withAudit<T>(tx: Tx, meta: WithAuditMeta<T>, fn: () => Promise<T>): Promise<T> {
    const { snapshot, before: beforeInput, after: afterOf, entityId, ...entry } = meta;
    const before = snapshot ? await snapshot(tx) : beforeInput;
    const result = await fn();
    const after = snapshot ? await snapshot(tx) : afterOf ? afterOf(result) : undefined;
    await this.record(tx, {
      ...entry,
      entityId: typeof entityId === "function" ? entityId(result) : entityId,
      before,
      after,
    });
    return result;
  }

  // ------------------------------------------------------------------ vérification

  verifyChain(tx: Tx, tenantId: string, range: ChainRange = {}): Promise<ChainVerification> {
    if (!isUuid(tenantId)) throw fail(`${VERIFY_LABEL}.verifyChain : tenantId invalide.`, "AUDIT_TENANT_INVALID");
    return verifyChainOn(tx, { kind: "tenant", tenantId: tenantId.toLowerCase() }, range, this.keys);
  }

  verifyPlatformChain(tx: Tx, range: ChainRange = {}): Promise<ChainVerification> {
    return verifyChainOn(tx, { kind: "platform" }, range, this.keys);
  }

  // ------------------------------------------------------------------ interne

  private cap(value: JsonValue | null): JsonValue | null {
    if (value === null) return null;
    const bytes = byteLength(value);
    if (bytes <= this.maxFieldBytes) return value;
    // On ne perd pas la preuve : on garde l'empreinte et la taille de ce qui a été écarté.
    return { _truncated: true, _bytes: bytes, _sha256: sha256Hex(canonicalize(value)) };
  }

  private async write(
    tx: Tx,
    target: ChainTarget,
    input: Omit<AuditEntryInput, "tenantId"> & { tenantId?: string },
    ctx: RequestContext | undefined,
  ): Promise<RecordResult> {
    if (!ACTION_RE.test(input.action) || input.action.length > 100) {
      throw fail(`audit : action invalide « ${input.action} » (format entité.verbe, minuscules).`, "AUDIT_ACTION_INVALID");
    }
    if (!ENTITY_RE.test(input.entity) || input.entity.length > 100) {
      throw fail(`audit : entité invalide « ${input.entity} » (snake_case).`, "AUDIT_ENTITY_INVALID");
    }
    const severity: AuditSeverity = input.severity ?? "info";
    if (!AUDIT_SEVERITIES.includes(severity)) throw fail(`audit : sévérité invalide « ${String(severity)} ».`, "AUDIT_SEVERITY_INVALID");

    const actor = this.resolveActor(input.actor, ctx);

    const id = input.id ?? newId();
    if (!isUuid(id)) throw fail("audit : id d'entrée invalide.", "AUDIT_ID_INVALID");
    const occurred = input.occurredAt === undefined ? this.clock.now() : new Date(input.occurredAt);
    if (Number.isNaN(occurred.getTime())) throw fail("audit : occurredAt invalide.", "AUDIT_TIME_INVALID");
    const occurredAt = occurred.toISOString();

    // Diff sur les valeurs BRUTES, puis masquage de tout ce qui est écrit.
    const rawBefore = toJsonValue(input.before) ?? null;
    const rawAfter = toJsonValue(input.after) ?? null;
    const diff = computeDiff(rawBefore, rawAfter, this.masker);
    const rawMeta = input.metadata ? (toJsonValue(input.metadata) ?? null) : null;

    const before = this.cap(rawBefore === null ? null : this.masker.maskValue(rawBefore));
    const after = this.cap(rawAfter === null ? null : this.masker.maskValue(rawAfter));
    const metadata = this.cap(rawMeta === null ? null : this.masker.maskValue(rawMeta));
    const diffJson = this.cap(diff === null ? null : (toJsonValue(diff) ?? null));

    const meta = getAuditRequestMeta();
    const ip = clip(input.request?.ip ?? meta?.ip, 64);
    const userAgent = clip(input.request?.userAgent ?? meta?.userAgent, 512);
    const device = clip(input.request?.device ?? meta?.device ?? describeDevice(userAgent), 200);
    const requestId = clip(input.request?.requestId ?? ctx?.requestId ?? meta?.requestId, 200);
    const reason = clip(input.reason, 1000);
    const entityId = input.entityId === undefined || input.entityId === null ? null : clip(String(input.entityId), 200);

    if (target.kind === "tenant") await this.ensureMonth(tx, occurredAt);

    // 1. Sérialisation de la chaîne. 2. Lecture de la tête (énoncé séparé). 3. Insertion.
    await lockChain(tx, target);
    const head = await readHead(tx, target);
    const seq = (head?.seq ?? 0) + 1;
    const prevHash = head?.hash ?? GENESIS_HASH;

    const hashable: HashableEntry = {
      scope: target.kind === "tenant" ? target.tenantId : PLATFORM_SCOPE,
      seq,
      id,
      occurredAt,
      actorType: actor.type,
      actorId: actor.id,
      impersonatedBy: actor.impersonatedBy ?? null,
      action: input.action,
      entity: input.entity,
      entityId,
      before,
      after,
      diff: diffJson,
      metadata,
      ip,
      userAgent,
      device,
      requestId,
      reason,
      severity,
      prevHash,
    };
    const { hash, alg, keyId } = computeEntryHash(hashable, this.hmac);

    const inserted = await insertEntry(
      tx,
      target,
      {
        id, seq, occurredAt,
        actorType: actor.type, actorId: actor.id, impersonatedBy: actor.impersonatedBy ?? null,
        action: input.action, entity: input.entity, entityId,
        before, after, diff: diffJson, metadata,
        ip, userAgent, device, requestId, reason, severity,
        hashAlg: alg, keyId, prevHash, hash,
      },
      input.idempotent === true,
    );

    if (!inserted) {
      // Rejeu d'un événement déjà journalisé : on renvoie l'existant, rien n'a changé.
      const existing =
        target.kind === "tenant"
          ? await tx.queryOne<{ seq: string; hash: string }>(
              "SELECT seq, hash FROM audit.audit_log WHERE tenant_id = $1 AND occurred_at = $2 AND id = $3",
              [target.tenantId, occurredAt, id],
            )
          : await tx.queryOne<{ seq: string; hash: string }>("SELECT seq, hash FROM audit.platform_audit_log WHERE id = $1", [id]);
      return { id, seq: existing ? Number(existing.seq) : 0, hash: existing?.hash ?? "", duplicate: true };
    }
    return { id, seq, hash, duplicate: false };
  }

  private resolveActor(explicit: AuditActor | undefined, ctx: RequestContext | undefined): AuditActor {
    let actor: AuditActor;
    if (explicit) {
      actor = explicit;
    } else if (ctx) {
      actor = ctx.actor === "system" ? { type: "system", id: null } : { type: ctx.actor, id: ctx.userId };
    } else {
      throw fail("audit : acteur inconnu (pas de RequestContext actif, `actor` non fourni).", "AUDIT_ACTOR_MISSING");
    }
    if (!AUDIT_ACTOR_TYPES.includes(actor.type)) throw fail(`audit : type d'acteur invalide « ${String(actor.type)} ».`, "AUDIT_ACTOR_INVALID");
    if (actor.type !== "system" && !isUuid(actor.id)) throw fail("audit : un acteur non-système exige un identifiant UUID.", "AUDIT_ACTOR_INVALID");
    if (actor.id !== null && !isUuid(actor.id)) throw fail("audit : identifiant d'acteur invalide.", "AUDIT_ACTOR_INVALID");
    if (actor.type === "impersonation" && !isUuid(actor.impersonatedBy ?? null)) {
      throw fail("audit : une action en impersonation exige `impersonatedBy` (le super-admin).", "AUDIT_ACTOR_INVALID");
    }
    return actor.id === null ? { type: actor.type, id: null, impersonatedBy: actor.impersonatedBy ?? null } : { ...actor, id: actor.id.toLowerCase() };
  }

  /**
   * Filet : si la partition du mois n'existe pas (le job `ensureAuditPartitions` n'a pas
   * tourné), on la crée plutôt que de faire échouer l'opération métier. Pas de cache
   * mémoire : la création peut avoir été faite dans une transaction annulée, et une
   * partition ancienne peut avoir été détachée. Côté SQL le cas courant est un simple
   * `to_regclass` sans verrou.
   */
  private async ensureMonth(tx: Tx, iso: string): Promise<void> {
    await ensurePartitionFor(tx, iso);
  }
}

export function createAuditService(options: AuditServiceOptions = {}): AuditService {
  return new AuditService(options);
}
