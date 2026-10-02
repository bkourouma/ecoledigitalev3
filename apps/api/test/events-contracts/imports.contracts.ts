/** Contrats des événements consommés par `imports` (ses propres demandes, traitées par les abonnés du worker : `modules/imports/subscribers.ts`). */
import type { EventContract } from "./support";

const readJobId = (payload: unknown): unknown => (payload && typeof payload === "object" ? (payload as { jobId?: unknown }).jobId : undefined);

const own = (event: string): EventContract => ({
  consumer: "imports",
  event,
  reads: [{ field: "jobId", kind: "uuid" }],
  reader: readJobId,
});

export const contracts: EventContract[] = [own("imports.job.validation_requested"), own("imports.run.requested")];
