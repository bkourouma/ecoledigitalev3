/** Définition des contrats d'événements consommés par `people` (abonnés : `modules/people/subscribers.ts`). */
import { readClosedClassroomId, readClosedYearId } from "../../src/modules/people/application/consumers";
import { parseEnrollmentPayload } from "../../src/modules/people/domain/enrollment-projection";
import { readMembershipEvent } from "../../src/modules/people/application/projection";
import type { EventContract } from "./support";

/** Projection `student_enrollment_summaries` : `enrollmentId` et `studentId` sont indispensables, le reste complète la ligne. */
const enrollment = (verb: string, extra: Partial<EventContract> = {}): EventContract => ({
  consumer: "people",
  event: `academic.enrollment.${verb}`,
  reads: [
    { field: "enrollmentId", kind: "uuid" },
    { field: "studentId", kind: "uuid" },
    { field: "academicYearId", kind: "uuid", required: false },
    { field: "institutionId", kind: "uuid", required: false },
    { field: "classroomId", kind: "uuid", required: false },
    { field: "status", kind: "string", required: false, absentOk: true },
    { field: "mode", kind: "string", required: false, absentOk: true },
    { field: "registrationNumber", kind: "string", required: false, absentOk: true, nullable: true },
  ],
  reader: parseEnrollmentPayload,
  ...extra,
});

export const contracts: EventContract[] = [
  enrollment("created"),
  enrollment("confirmed"),
  enrollment("suspended"),
  enrollment("resumed"),
  enrollment("withdrawn"),
  enrollment("cancelled"),
  enrollment("transferred"),
  enrollment("completed"),
  enrollment("reopened"),
  // Le nouveau financement est dans `to.fundingType` : la projection doit le retrouver.
  enrollment("funding_changed", {
    reads: [
      { field: "enrollmentId", kind: "uuid" },
      { field: "studentId", kind: "uuid" },
      { field: "to", kind: "object", required: false },
    ],
    readerOk: (r, payload) => (r as { fundingType?: string } | null)?.fundingType === (payload as { to: { fundingType: string } }).to.fundingType,
  }),
  enrollment("outcome_recorded", { reads: [{ field: "enrollmentId", kind: "uuid" }, { field: "studentId", kind: "uuid" }] }),
  { consumer: "people", event: "academic.classroom.cancelled", reads: [{ field: "classroomId", kind: "uuid" }], reader: readClosedClassroomId },
  { consumer: "people", event: "academic.classroom.completed", reads: [{ field: "classroomId", kind: "uuid" }], reader: readClosedClassroomId },
  { consumer: "people", event: "academic.year.closed", reads: [{ field: "academicYearId", kind: "uuid" }], reader: readClosedYearId },
  {
    consumer: "people",
    event: "iam.membership.created",
    reads: [
      { field: "identityId", kind: "uuid" },
      { field: "membershipId", kind: "uuid", required: false },
      { field: "status", kind: "string", required: false },
      { field: "roles", kind: "array", required: false },
    ],
    reader: (p) => readMembershipEvent("iam.membership.created", p),
    readerOk: (r) => (r as { status?: string } | null)?.status === "active" || (r as { status?: string } | null)?.status === "invited" || (r as { status?: string } | null)?.status === "suspended" || (r as { status?: string } | null)?.status === "revoked",
  },
  {
    consumer: "people",
    event: "iam.membership.changed",
    reads: [
      { field: "identityId", kind: "uuid" },
      { field: "membershipId", kind: "uuid", required: false },
      { field: "after", kind: "object", required: false },
    ],
    reader: (p) => readMembershipEvent("iam.membership.changed", p),
    // Le statut projeté vient de `after.status` : il ne doit jamais retomber sur « unknown ».
    readerOk: (r) => (r as { status?: string } | null)?.status !== undefined && (r as { status?: string }).status !== "unknown",
  },
  // Référentiels par défaut : seul le type compte.
  { consumer: "people", event: "tenancy.tenant.provisioned", reads: [] },
];
