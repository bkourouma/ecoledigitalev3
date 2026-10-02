/** Contrats d'événements consommés par `primary_school` (abonnés : `modules/primary_school/subscribers.ts`). */
import { classroomPeriodReader, decisionConfirmedReader, documentRenderedReader, institutionCreatedReader, reviewSealedReader } from "../../src/modules/primary_school/application/consumers";
import type { EventContract } from "./support";

const classroomPeriod = (event: string): EventContract => ({
  consumer: "primary_school",
  event,
  note: "miroir local du verrou de saisie",
  reads: [
    { field: "classroomId", kind: "uuid" },
    { field: "periodId", kind: "uuid" },
  ],
  reader: (p) => classroomPeriodReader.safeParse(p).success,
});

export const contracts: EventContract[] = [
  {
    consumer: "primary_school",
    event: "tenancy.institution.created",
    reads: [
      { field: "institutionId", kind: "uuid" },
      { field: "pack", kind: "string" },
      { field: "educationSystem", kind: "string", required: false },
    ],
    reader: (p) => institutionCreatedReader.safeParse(p).success,
  },
  classroomPeriod("academic.classroom_period.grading_closed"),
  classroomPeriod("academic.classroom_period.closed"),
  classroomPeriod("academic.classroom_period.reopened"),
  {
    consumer: "primary_school",
    event: "results.decision.confirmed",
    reads: [
      { field: "enrollmentId", kind: "uuid" },
      { field: "finalCode", kind: "string", required: false, nullable: true },
      { field: "academicPeriodId", kind: "uuid", required: false, nullable: true },
    ],
    reader: (p) => decisionConfirmedReader.safeParse(p).success,
  },
  {
    consumer: "primary_school",
    event: "reportcards.official_document.rendered",
    reads: [
      { field: "documentId", kind: "uuid" },
      { field: "documentKind", kind: "string" },
      { field: "sourceId", kind: "uuid" },
    ],
    reader: (p) => documentRenderedReader.safeParse(p).success,
  },
  {
    consumer: "primary_school",
    event: "primary_school.annual_review.sealed",
    note: "abonné du module à son propre événement (PDF du bilan hors de la transaction de scellement)",
    reads: [{ field: "reviewId", kind: "uuid" }],
    reader: (p) => reviewSealedReader.safeParse(p).success,
  },
];

export const exemptions: Array<{ event: string; reason: string }> = [];
