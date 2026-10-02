/** Définition des contrats d'événements consommés par `higher` (abonnés : `modules/higher/subscribers.ts`). */
import { parseCreditsCapitalized, parsePeriodClosed } from "../../src/modules/higher/application/consumers";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  {
    consumer: "higher",
    event: "results.period.closed",
    reads: [
      { field: "classroomId", kind: "uuid" },
      { field: ["academicPeriodId", "periodId"], kind: "uuid" },
      { field: "stateId", kind: "uuid", required: false },
      { field: "resultsVersion", kind: "number", required: false },
    ],
    reader: parsePeriodClosed,
    readerOk: (r, payload) => {
      const p = payload as { classroomId: string; academicPeriodId: string; stateId: string; resultsVersion: number };
      const got = r as { classroomId: string; academicPeriodId: string; stateId?: string; resultsVersion?: number } | null;
      return got !== null && got.classroomId === p.classroomId && got.academicPeriodId === p.academicPeriodId && got.stateId === p.stateId && got.resultsVersion === p.resultsVersion;
    },
  },
  {
    // Événement du module lui-même : `evaluate-diplomas-on-capitalized` (abonné distinct, transaction propre, R-HIG-10).
    consumer: "higher",
    event: "higher.credits.capitalized",
    reads: [
      { field: "studentId", kind: "uuid" },
      { field: "ueNodeId", kind: "uuid" },
    ],
    reader: parseCreditsCapitalized,
  },
];
