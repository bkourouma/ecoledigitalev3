/** Contrats des événements consommés par `messaging` (abonnés : `modules/messaging/subscribers.ts`). */
import { readRecordedEvent } from "../../src/modules/messaging/application/consumers";
import type { EventContract } from "./support";

const recorded = (event: string): EventContract => ({
  consumer: "messaging",
  event,
  reads: [
    { field: "studentId", kind: "uuid" },
    { field: "date", kind: "string" },
  ],
  reader: (payload: unknown) => readRecordedEvent(payload)?.studentId,
});

export const contracts: EventContract[] = [recorded("attendance.absence.recorded"), recorded("attendance.late.recorded")];
