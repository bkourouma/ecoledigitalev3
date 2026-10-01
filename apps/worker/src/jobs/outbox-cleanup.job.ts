/**
 * Purge de l'outbox : supprime, tenant par tenant et par lots, les événements PUBLIÉS depuis
 * plus de `retentionDays` jours, ainsi que les marques d'idempotence `processed_events`
 * du même âge. Les événements non publiés (en attente, en retry ou en échec définitif)
 * ne sont JAMAIS supprimés : ils attendent une décision d'exploitation.
 *
 * Chaque lot est sa propre transaction courte (pas de gros DELETE qui verrouille la table).
 * Le verrou d'unicité du job planifié empêche deux purges simultanées ; `SKIP LOCKED` protège en plus
 * des lignes d'événements verrouillées par un relais.
 */
import { defineScheduledJob, type ScopedTenantDb } from "../sdk";

export interface OutboxCleanupOptions {
  retentionDays: number;
  batchSize: number;
  cron?: string;
}

export async function purgePublishedEvents(db: ScopedTenantDb, retentionDays: number, batchSize: number): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.run(async (tx) => {
      const res = await tx.query(
        `DELETE FROM kernel.domain_events
          WHERE id IN (
            SELECT id FROM kernel.domain_events
             WHERE published_at IS NOT NULL
               AND published_at < now() - ($1::int * interval '1 day')
             ORDER BY published_at
             LIMIT $2
               FOR UPDATE SKIP LOCKED)`,
        [retentionDays, batchSize],
      );
      return res.rowCount;
    });
    total += deleted;
    if (deleted < batchSize) return total;
  }
}

export async function purgeProcessedMarks(db: ScopedTenantDb, retentionDays: number, batchSize: number): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.run(async (tx) => {
      const res = await tx.query(
        `DELETE FROM kernel.processed_events
          WHERE (subscriber, event_id) IN (
            SELECT subscriber, event_id FROM kernel.processed_events
             WHERE processed_at < now() - ($1::int * interval '1 day')
             LIMIT $2)`,
        [retentionDays, batchSize],
      );
      return res.rowCount;
    });
    total += deleted;
    if (deleted < batchSize) return total;
  }
}

export function outboxCleanupJob(options: OutboxCleanupOptions) {
  return defineScheduledJob({
    name: "outbox-cleanup",
    // Chaque nuit à 03:17 (heure creuse, hors pile ronde pour ne pas coïncider avec d'autres tâches).
    cron: options.cron ?? "17 3 * * *",
    perTenant: true,
    handler: async ({ db, logger }) => {
      const events = await purgePublishedEvents(db, options.retentionDays, options.batchSize);
      const marks = await purgeProcessedMarks(db, options.retentionDays, options.batchSize);
      logger.info(
        { retentionDays: options.retentionDays, eventsDeleted: events, processedMarksDeleted: marks },
        "outbox purgée",
      );
    },
  });
}
