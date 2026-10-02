/** Contrats d'événements consommés par `finance` (abonné : `modules/finance/subscribers.ts`). */
import { institutionCreatedReader } from "../../src/modules/finance/subscribers";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  {
    consumer: "finance",
    event: "tenancy.institution.created",
    reads: [
      { field: "institutionId", kind: "uuid" },
      { field: "pack", kind: "string" },
    ],
    reader: (p) => institutionCreatedReader.safeParse(p).success,
  },
];

export const exemptions: Array<{ event: string; reason: string }> = [];
