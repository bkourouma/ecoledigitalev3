import type { WorkerConfig } from "../config";
import type { ScheduledJobDefinition } from "../sdk";
import { ensurePartitionsJob } from "./ensure-partitions.job";
import { outboxCleanupJob } from "./outbox-cleanup.job";

/** Jobs du socle (hors modules). Les jobs des modules viennent de `modules/<key>/jobs.ts`. */
export function builtinJobs(config: WorkerConfig): ScheduledJobDefinition[] {
  return [
    outboxCleanupJob({ retentionDays: config.OUTBOX_RETENTION_DAYS, batchSize: config.OUTBOX_CLEANUP_BATCH_SIZE }),
    ensurePartitionsJob({ functionName: config.AUDIT_ENSURE_PARTITIONS_FN, monthsAhead: config.AUDIT_PARTITIONS_MONTHS_AHEAD }),
  ];
}
