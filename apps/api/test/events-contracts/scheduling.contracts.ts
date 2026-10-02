/** Définition des contrats d'événements consommés par `scheduling` (abonnés : `modules/scheduling/subscribers.ts`). */
import {
  readApprovedLeave,
  readCancelledClassroomId,
  readCancelledOfferingId,
  readClosedYearId,
  readEndedAssignment,
  readStaffStatusChange,
  readSubmittedOccurrenceId,
} from "../../src/modules/scheduling/application/consumers";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  {
    consumer: "scheduling",
    event: "attendance.session.submitted",
    // `occurrenceId` est NULLABLE chez le producteur (appel libre, sans séance planifiée) : sans lui, rien n'est constaté.
    reads: [{ field: "occurrenceId", kind: "uuid", nullable: true }],
    reader: readSubmittedOccurrenceId,
    readerOk: (r, payload) => r === ((payload as { occurrenceId: string | null }).occurrenceId ?? null),
  },
  {
    consumer: "scheduling",
    event: "attendance.staff_leave.approved",
    reads: [
      { field: "staffId", kind: "uuid" },
      { field: "startsOn", kind: "string" },
      { field: "endsOn", kind: "string" },
    ],
    reader: readApprovedLeave,
  },
  {
    consumer: "scheduling",
    event: "people.staff.status_changed",
    // Le NOUVEAU statut est `toStatus` (jamais `status`) : LEFT / SUSPENDED signalent les séances à remplacer.
    reads: [
      { field: "staffId", kind: "uuid" },
      { field: "toStatus", kind: "string" },
    ],
    reader: readStaffStatusChange,
    readerOk: (r, payload) => (r as { status: string } | null)?.status === (payload as { toStatus: string }).toStatus.toUpperCase(),
  },
  {
    consumer: "scheduling",
    event: "people.teaching_assignment.ended",
    reads: [
      { field: "staffId", kind: "uuid" },
      { field: "classroomId", kind: "uuid" },
    ],
    reader: readEndedAssignment,
  },
  { consumer: "scheduling", event: "academic.offering.cancelled", reads: [{ field: "offeringId", kind: "uuid" }], reader: readCancelledOfferingId },
  { consumer: "scheduling", event: "academic.classroom.cancelled", reads: [{ field: "classroomId", kind: "uuid" }], reader: readCancelledClassroomId },
  { consumer: "scheduling", event: "academic.year.closed", reads: [{ field: "academicYearId", kind: "uuid" }], reader: readClosedYearId },
  // Types de salle et d'événement du pack : seul le type compte.
  { consumer: "scheduling", event: "tenancy.tenant.provisioned", reads: [] },
];
