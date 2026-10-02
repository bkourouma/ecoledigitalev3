/** Contrats d'événements consommés par `councils` (abonnés : `modules/councils/subscribers.ts`). */
import { documentRenderedReader, institutionCreatedReader, minutesGeneratedReader, periodReopenedReader } from "../../src/modules/councils/application/consumers";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  {
    consumer: "councils",
    event: "tenancy.institution.created",
    reads: [
      { field: "institutionId", kind: "uuid" },
      { field: "pack", kind: "string" },
      { field: "educationSystem", kind: "string", required: false },
    ],
    reader: (p) => institutionCreatedReader.safeParse(p).success,
  },
  {
    consumer: "councils",
    event: "results.period.reopened",
    reads: [{ field: "stateId", kind: "uuid" }],
    reader: (p) => periodReopenedReader.safeParse(p).success,
  },
  {
    consumer: "councils",
    event: "reportcards.official_document.rendered",
    reads: [
      { field: "documentId", kind: "uuid" },
      { field: "documentKind", kind: "string" },
      { field: "sourceId", kind: "uuid" },
    ],
    reader: (p) => documentRenderedReader.safeParse(p).success,
  },
  {
    consumer: "councils",
    event: "councils.minutes.generated",
    note: "abonné du module à son propre événement (PDF du procès-verbal hors de la transaction de génération)",
    reads: [{ field: "minutesId", kind: "uuid" }],
    reader: (p) => minutesGeneratedReader.safeParse(p).success,
  },
];

export const exemptions: Array<{ event: string; reason: string }> = [];
