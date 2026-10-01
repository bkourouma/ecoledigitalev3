/**
 * Gestion des partitions mensuelles du journal. Fonctions « job-compatibles » : sans état,
 * idempotentes, rejouables ; le worker les planifie (ex. quotidien) via `SystemDb`.
 */
import type { SystemDb, Tx } from "@ecoledigitale/database";

export interface PartitionInfo {
  name: string;
  /** Borne basse incluse, ISO UTC. */
  from: string | null;
  /** Borne haute exclue, ISO UTC. */
  to: string | null;
}

/**
 * Crée les partitions manquantes de (mois courant - `monthsBack`) à (mois courant + `months`),
 * en UTC. Idempotent. Renvoie les noms effectivement créés par cet appel.
 * Sans verrou exclusif sur le parent (voir migration 0300) : sûr à lancer en production.
 */
export async function ensureAuditPartitionsOn(tx: Tx, months = 3, monthsBack = 0): Promise<string[]> {
  const rows = await tx.many<{ ensure_partitions: string }>("SELECT audit.ensure_partitions($1::int, $2::int)", [months, monthsBack]);
  return rows.map((r) => r.ensure_partitions).filter(Boolean);
}

/**
 * `ensureAuditPartitions(months)` : forme attendue par le planificateur. Utilise SystemDb
 * (opération de plateforme, sans tenant, tracée avec sa raison).
 */
export function ensureAuditPartitions(systemDb: SystemDb, months = 3, monthsBack = 0): Promise<string[]> {
  return systemDb.run("audit-ensure-partitions", (tx) => ensureAuditPartitionsOn(tx, months, monthsBack));
}

/** Partitions actuellement rattachées au journal, avec leurs bornes (lecture du catalogue). */
export async function listAuditPartitions(tx: Tx): Promise<PartitionInfo[]> {
  const rows = await tx.many<{ name: string; bound: string }>(
    `SELECT c.relname::text AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE n.nspname = 'audit' AND p.relname = 'audit_log'
      ORDER BY c.relname`,
  );
  return rows.map((r) => {
    const m = /FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(r.bound);
    return {
      name: r.name,
      from: m ? new Date(m[1] as string).toISOString() : null,
      to: m ? new Date(m[2] as string).toISOString() : null,
    };
  });
}
