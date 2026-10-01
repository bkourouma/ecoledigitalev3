/**
 * Helpers de test d'architecture : prouver qu'une opération sensible AUDITE (plan §7 :
 * « test échouant si une opération sensible n'écrit pas dans audit_log »).
 *
 *   await expectAudited(pool, tenantId, "grade.published", () => publishGrade(deps, ctx, input));
 *
 * `pool` : un pool pg (ou tout objet `{ connect() }`) pointant sur la base de test. Le
 * helper lit le journal avec une identité `system` du tenant (donc sous RLS si le rôle du
 * pool est `app_user`). Il ne dépend d'aucun framework de test : il lève `AssertionError`.
 */
import { AssertionError } from "node:assert";
import { createSystemContext } from "@ecoledigitale/kernel";
import { TenantDb, type PgPoolLike } from "@ecoledigitale/database";
import { ROW_COLUMNS_TENANT, mapRow } from "../infrastructure/chain-repository";
import type { StoredAuditEntry } from "../domain/types";
import { verifyChainOn } from "../application/verify-chain";

export interface ExpectAuditedOptions {
  /** Nombre exact d'entrées attendues (défaut : au moins 1). */
  times?: number;
  /** Filtre supplémentaire sur les entrées nouvelles portant `action`. */
  match?: (entry: StoredAuditEntry) => boolean;
  entity?: string;
  entityId?: string;
  actorId?: string;
  /** Vérifie aussi que la chaîne du tenant reste valide après l'opération (défaut : true). */
  verifyChain?: boolean;
}

export interface ExpectAuditedResult<T> {
  result: T;
  /** Entrées `action` apparues pendant `fn`. */
  entries: StoredAuditEntry[];
}

async function tenantRead<R>(pool: PgPoolLike, tenantId: string, fn: (tx: import("@ecoledigitale/database").Tx) => Promise<R>): Promise<R> {
  const db = new TenantDb(pool);
  return db.run(createSystemContext(tenantId), fn, { readOnly: true });
}

const maxSeq = (pool: PgPoolLike, tenantId: string): Promise<number> =>
  tenantRead(pool, tenantId, async (tx) => {
    const row = await tx.queryOne<{ s: string }>("SELECT coalesce(max(seq), 0)::text AS s FROM audit.audit_log WHERE tenant_id = $1", [tenantId]);
    return Number(row?.s ?? 0);
  });

const entriesSince = (pool: PgPoolLike, tenantId: string, seq: number): Promise<StoredAuditEntry[]> =>
  tenantRead(pool, tenantId, async (tx) =>
    (
      await tx.many(`SELECT ${ROW_COLUMNS_TENANT} FROM audit.audit_log WHERE tenant_id = $1 AND seq > $2 ORDER BY seq`, [tenantId, seq])
    ).map((r) => mapRow(r as never)),
  );

/**
 * Exécute `fn` puis vérifie qu'au moins une (ou exactement `times`) entrée d'audit `action`
 * du tenant est apparue pendant son exécution.
 */
export async function expectAudited<T>(
  pool: PgPoolLike,
  tenantId: string,
  action: string,
  fn: () => Promise<T>,
  options: ExpectAuditedOptions = {},
): Promise<ExpectAuditedResult<T>> {
  const before = await maxSeq(pool, tenantId);
  const result = await fn();
  const added = await entriesSince(pool, tenantId, before);

  const matching = added.filter(
    (e) =>
      e.action === action &&
      (options.entity === undefined || e.entity === options.entity) &&
      (options.entityId === undefined || e.entityId === options.entityId) &&
      (options.actorId === undefined || e.actorId === options.actorId) &&
      (options.match === undefined || options.match(e)),
  );

  const ok = options.times === undefined ? matching.length >= 1 : matching.length === options.times;
  if (!ok) {
    const seen = added.map((e) => e.action);
    throw new AssertionError({
      message:
        `Opération non auditée : ${options.times === undefined ? "au moins 1" : options.times} entrée(s) « ${action} » attendue(s) ` +
        `pour le tenant ${tenantId}, ${matching.length} trouvée(s). ` +
        `Actions journalisées pendant l'opération : ${seen.length > 0 ? seen.join(", ") : "(aucune)"}.`,
    });
  }

  if (options.verifyChain !== false) {
    const verification = await tenantRead(pool, tenantId, (tx) =>
      verifyChainOn(tx, { kind: "tenant", tenantId }, { fromSeq: Math.max(before, 1) }, new Map()),
    );
    // Les lignes HMAC ne se vérifient pas sans clé : on ne retient que les ruptures de chaînage.
    const broken = verification.issues.filter((i) => i.kind !== "key_unavailable");
    if (broken.length > 0) {
      throw new AssertionError({ message: `Chaîne d'audit invalide après l'opération : ${broken.map((i) => `${i.kind}@${i.seq}`).join(", ")}.` });
    }
  }
  return { result, entries: matching };
}

/**
 * Atomicité : si l'opération ÉCHOUE (et annule sa transaction), AUCUNE entrée d'audit ne doit
 * subsister — une trace d'un acte qui n'a pas eu lieu fausserait l'enquête. `fn` doit rejeter.
 */
export async function expectAuditRolledBack(
  pool: PgPoolLike,
  tenantId: string,
  action: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const before = await maxSeq(pool, tenantId);
  let failed = false;
  try {
    await fn();
  } catch {
    failed = true;
  }
  if (!failed) throw new AssertionError({ message: "expectAuditRolledBack : l'opération devait échouer." });
  const leaked = (await entriesSince(pool, tenantId, before)).filter((e) => e.action === action);
  if (leaked.length > 0) {
    throw new AssertionError({
      message: `Audit non atomique : ${leaked.length} entrée(s) « ${action} » subsistent alors que l'opération a échoué.`,
    });
  }
}
