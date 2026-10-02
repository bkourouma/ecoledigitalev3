/** Contrats des événements consommés par `tenancy` (abonné : `modules/tenancy/subscribers.ts`, règle : `application/onboarding-events.ts`). */
import { onboardingStepForImport, type ImportCompletedPayload } from "../../src/modules/tenancy/application/onboarding-events";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  {
    consumer: "tenancy",
    event: "imports.run.completed",
    reads: [
      { field: "importerKey", kind: "string" },
      { field: "created", kind: "number" },
      { field: "updated", kind: "number" },
      { field: "skipped", kind: "number" },
    ],
    // `null` = importeur sans étape d'onboarding ou import sans donnée : lecture réussie, rien à faire.
    reader: (payload: unknown) => ({ step: onboardingStepForImport(payload as ImportCompletedPayload) }),
    readerOk: (result) => typeof result === "object" && result !== null,
  },
];
