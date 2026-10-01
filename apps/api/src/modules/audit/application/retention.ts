/**
 * Rétention du journal (voir migration 0301 et README).
 *
 *  - défaut 60 mois (5 ans), JAMAIS moins de 12 mois ;
 *  - l'expiration détache des PARTITIONS MENSUELLES entières (jamais de DELETE ligne à
 *    ligne : le journal est append-only) et les déplace dans le schéma `audit_archive` ;
 *  - une partition est commune à tous les tenants : elle n'est détachée que lorsque la
 *    rétention la plus LONGUE parmi les tenants est échue. Un tenant à rétention courte
 *    voit donc ses données conservées jusqu'à cette échéance (limite documentée).
 */
import { ValidationError } from "@ecoledigitale/kernel";
import type { SystemDb, Tx } from "@ecoledigitale/database";
import type { AuditService } from "./audit-service";

export const DEFAULT_RETENTION_MONTHS = 60;
export const MIN_RETENTION_MONTHS = 12;
export const MAX_RETENTION_MONTHS = 600;

export function assertValidRetention(months: unknown): asserts months is number {
  if (!Number.isInteger(months) || (months as number) < MIN_RETENTION_MONTHS || (months as number) > MAX_RETENTION_MONTHS) {
    throw ValidationError.field(
      "retentionMonths",
      `La rétention du journal d'audit doit être de ${MIN_RETENTION_MONTHS} à ${MAX_RETENTION_MONTHS} mois.`,
      "retention_out_of_range",
    );
  }
}

/** Rétention du tenant de la transaction (défaut si aucune politique). */
export async function getRetentionMonths(tx: Tx): Promise<number> {
  const row = await tx.queryOne<{ retention_months: number }>("SELECT retention_months FROM audit.retention_policies");
  return row?.retention_months ?? DEFAULT_RETENTION_MONTHS;
}

/**
 * Fixe la rétention du tenant de la transaction. Changement sensible : journalisé (critique)
 * dans la même transaction, avec l'ancienne et la nouvelle valeur.
 */
export async function setRetentionMonths(
  tx: Tx,
  audit: AuditService,
  months: number,
  options: { updatedBy: string | null; reason?: string },
): Promise<void> {
  assertValidRetention(months);
  const previous = await getRetentionMonths(tx);
  await tx.query(
    `INSERT INTO audit.retention_policies (tenant_id, retention_months, updated_by)
     VALUES (kernel.current_tenant_id(), $1, $2)
     ON CONFLICT (tenant_id) DO UPDATE
       SET retention_months = EXCLUDED.retention_months, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [months, options.updatedBy],
  );
  await audit.record(tx, {
    action: "retention.changed",
    entity: "retention_policy",
    before: { retentionMonths: previous },
    after: { retentionMonths: months },
    severity: "critical",
    reason: options.reason ?? null,
  });
}

export interface DetachReport {
  /** Rétention (mois) utilisée = max des politiques de tous les tenants actifs. */
  retentionMonths: number;
  dryRun: boolean;
  partitions: Array<{ name: string; rangeEnd: string; detached: boolean }>;
}

/** Plus longue rétention parmi les tenants actifs (un tenant sans politique compte pour 60 mois ; 60 si aucun tenant). */
export async function computeGlobalRetentionMonths(systemDb: SystemDb): Promise<number> {
  const report = await systemDb.forEachTenant("audit-retention-scan", (tx) => getRetentionMonths(tx));
  if (report.failed.length > 0) {
    // Ne jamais détacher sur une vue partielle : un tenant illisible pourrait avoir une rétention plus longue.
    throw new Error(`audit-retention : lecture impossible pour ${report.failed.length} tenant(s), détachement annulé.`);
  }
  if (report.succeeded.length === 0) return DEFAULT_RETENTION_MONTHS;
  return Math.max(...report.succeeded.map((s) => s.result));
}

/**
 * Détache (et déplace vers `audit_archive`) les partitions échues. `dryRun` (défaut) ne fait
 * que lister. Un détachement réel est tracé dans le journal de plateforme.
 * Le DROP définitif d'une partition archivée reste une opération d'exploitation, à faire
 * après export vérifié (voir README).
 */
export async function detachExpiredAuditPartitions(
  systemDb: SystemDb,
  audit: AuditService,
  options: { dryRun?: boolean } = {},
): Promise<DetachReport> {
  const dryRun = options.dryRun ?? true;
  const retentionMonths = await computeGlobalRetentionMonths(systemDb);
  return systemDb.run("audit-detach-partitions", async (tx) => {
    const rows = await tx.many<{ partition_name: string; range_end: Date; detached: boolean }>(
      "SELECT partition_name, range_end, detached FROM audit.detach_expired_partitions($1::int, $2::boolean)",
      [retentionMonths, dryRun],
    );
    const partitions = rows.map((r) => ({ name: r.partition_name, rangeEnd: r.range_end.toISOString(), detached: r.detached }));
    if (!dryRun && partitions.length > 0) {
      await audit.recordPlatform(tx, {
        action: "retention.partitions_detached",
        entity: "audit_partition",
        actor: { type: "system", id: null },
        severity: "critical",
        metadata: { retentionMonths, partitions: partitions.map((p) => p.name) },
      });
    }
    return { retentionMonths, dryRun, partitions };
  });
}
