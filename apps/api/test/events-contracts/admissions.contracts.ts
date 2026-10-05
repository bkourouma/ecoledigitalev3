/** Contrats d'événements consommés par `admissions` (abonnés : `modules/admissions/subscribers.ts`). */
import { admissionsConsumedEnrollmentEventSchema, admissionsConsumedExamResultSchema, admissionsConsumedInstitutionCreatedSchema } from "@ecoledigitale/contracts/v2";
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
    event: "examinations.result.transmitted",
    note: "Q-E18 : résultat (admis / non admis) ET moyenne ; abonné SEUL, aucun nom ni date de naissance",
    reads: [
      { field: "resultId", kind: "uuid" },
      { field: "candidateId", kind: "uuid" },
      { field: "studentId", kind: "uuid" },
      { field: "institutionId", kind: "uuid" },
      { field: "examTypeCode", kind: "string" },
      { field: "sessionYear", kind: "number" },
      { field: "outcome", kind: "string" },
      { field: "admitted", kind: "boolean" },
      // la moyenne est absente d'un absent, d'un exclu, d'un ajourné : le consommateur accepte `null`
      { field: "average", kind: "string", nullable: true },
      { field: "revision", kind: "number" },
    ],
    reader: (p) => admissionsConsumedExamResultSchema.safeParse(p).success,
  },
  {
    consumer: "admissions",
    event: "tenancy.institution.created",
    reads: [{ field: "institutionId", kind: "uuid" }],
    reader: (p) => admissionsConsumedInstitutionCreatedSchema.safeParse(p).success,
  },
];

export const exemptions: Array<{ event: string; reason: string }> = [];
