/** Contrats d'événements consommés par `admissions` (abonnés : `modules/admissions/subscribers.ts`). */
import { admissionsConsumedEnrollmentEventSchema, admissionsConsumedInstitutionCreatedSchema } from "@ecoledigitale/contracts/v2";
import type { EventContract } from "./support";

const enrollmentReads: EventContract["reads"] = [
  { field: "enrollmentId", kind: "uuid" },
  // Additifs lus avec tolérance : l'élève et le statut de l'inscription.
  { field: "studentId", kind: "uuid", required: false },
  { field: "status", kind: "string", required: false },
];

export const contracts: EventContract[] = [
  {
    consumer: "admissions",
    event: "academic.enrollment.confirmed",
    note: "ENROLLED est DÉRIVÉ de la confirmation (décision métier 2026-10-01)",
    reads: enrollmentReads,
    reader: (p) => admissionsConsumedEnrollmentEventSchema.safeParse(p).success,
  },
  {
    consumer: "admissions",
    event: "academic.enrollment.cancelled",
    reads: enrollmentReads,
    reader: (p) => admissionsConsumedEnrollmentEventSchema.safeParse(p).success,
  },
  {
    consumer: "admissions",
    event: "academic.enrollment.withdrawn",
    reads: enrollmentReads,
    reader: (p) => admissionsConsumedEnrollmentEventSchema.safeParse(p).success,
  },
  {
    consumer: "admissions",
    event: "tenancy.institution.created",
    reads: [{ field: "institutionId", kind: "uuid" }],
    reader: (p) => admissionsConsumedInstitutionCreatedSchema.safeParse(p).success,
  },
];

export const exemptions: Array<{ event: string; reason: string }> = [];
