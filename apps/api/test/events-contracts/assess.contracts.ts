/** Définition des contrats d'événements consommés par `assess` (abonné : `modules/assess/subscribers.ts`). */
import { packOfTenantProvisioned } from "../../src/modules/assess/application/consumers";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  {
    consumer: "assess",
    event: "tenancy.tenant.provisioned",
    // `packs[]` : le pack dont le modèle d'évaluation est instancié (HIGHER s'il en fait partie).
    reads: [{ field: "packs", kind: "array", required: false }],
    reader: (p) => packOfTenantProvisioned(p),
    readerOk: (result, payload) => {
      const packs = (payload as { packs: string[] }).packs;
      return packs.length === 0 ? result === null : typeof result === "string" && packs.includes(result);
    },
  },
];
