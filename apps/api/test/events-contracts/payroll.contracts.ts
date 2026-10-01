/** Définition des contrats d'événements consommés par `payroll` (abonnés : `modules/payroll/subscribers.ts`). */
import { readClosedYearId, readSourceOccurrenceId } from "../../src/modules/payroll/application/consumers";
import type { EventContract } from "./support";

const occurrence = (event: string): EventContract => ({
  consumer: "payroll",
  event,
  reads: [{ field: "occurrenceId", kind: "uuid" }],
  reader: readSourceOccurrenceId,
});

export const contracts: EventContract[] = [
  occurrence("scheduling.occurrence.cancelled"),
  occurrence("scheduling.occurrence.unvalidated"),
  occurrence("scheduling.occurrence.rescheduled"),
  occurrence("scheduling.occurrence.paid_minutes_changed"),
  // Les réglages de paie viennent des valeurs par défaut de la migration : seul le type compte.
  { consumer: "payroll", event: "tenancy.tenant.provisioned", reads: [] },
  { consumer: "payroll", event: "academic.year.closed", reads: [{ field: "academicYearId", kind: "uuid" }], reader: readClosedYearId },
];
