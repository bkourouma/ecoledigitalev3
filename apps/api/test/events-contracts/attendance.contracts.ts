/** Définition des contrats d'événements consommés par `attendance` (abonnés : `modules/attendance/subscribers.ts`). */
import {
  readCancelledOccurrenceId,
  readChangedEnrollmentId,
  readChangedPeriodId,
  readProvisionedInstitutionIds,
} from "../../src/modules/attendance/application/consumers";
import type { EventContract } from "./support";

const enrollment = (event: string): EventContract => ({
  consumer: "attendance",
  event,
  reads: [{ field: "enrollmentId", kind: "uuid" }],
  reader: readChangedEnrollmentId,
});

const period = (event: string): EventContract => ({
  consumer: "attendance",
  event,
  reads: [{ field: "periodId", kind: "uuid" }],
  reader: readChangedPeriodId,
});

export const contracts: EventContract[] = [
  { consumer: "attendance", event: "scheduling.occurrence.cancelled", reads: [{ field: "occurrenceId", kind: "uuid" }], reader: readCancelledOccurrenceId },
  enrollment("academic.enrollment.withdrawn"),
  enrollment("academic.enrollment.cancelled"),
  enrollment("academic.enrollment.transferred"),
  period("academic.period.closed"),
  period("academic.period.reopened"),
  {
    consumer: "attendance",
    event: "tenancy.tenant.provisioned",
    reads: [{ field: "institutionIds", kind: "array" }],
    reader: readProvisionedInstitutionIds,
    readerOk: (ids, payload) => Array.isArray(ids) && ids.length === (payload as { institutionIds: string[] }).institutionIds.length,
  },
];
