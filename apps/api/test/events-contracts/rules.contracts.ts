/** Contrats d'événements consommés par `rules` (abonné : `modules/rules/subscribers.ts`). */
import { institutionCreatedReader } from "../../src/modules/rules/subscribers";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  {
    consumer: "rules",
    event: "tenancy.institution.created",
    reads: [
      { field: "institutionId", kind: "uuid" },
      { field: "pack", kind: "string" },
    ],
    reader: (p) => institutionCreatedReader.safeParse(p).success,
  },
];

export const exemptions: Array<{ event: string; reason: string }> = [];
