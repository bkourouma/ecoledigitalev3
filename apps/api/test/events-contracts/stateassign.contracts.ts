/**
 * Contrats des événements consommés par `stateassign` (abonnés : `modules/stateassign/subscribers.ts`).
 *
 * Les deux événements de `finance` (paiement terminé, facture émise) n'ont pas encore de schéma Zod publié par le producteur
 * (`financeEventPayloadSchemas` ne contient que `finance.invoice.paid`) : le contrat de forme ne peut pas être vérifié par
 * échantillon. L'abonné ne lit que `learnerId` (et `payerKind` pour les paiements) avec un schéma Zod local tolérant, et ignore
 * explicitement une charge illisible ; sa lecture est éprouvée par `modules/stateassign/test` sur la forme TypeScript du producteur.
 */
import type { EventContract } from "./support";

export const contracts: EventContract[] = [];

export const exemptions: Array<{ event: string; reason: string }> = [
  {
    event: "finance.payment.completed",
    reason: "finance type ses charges en interfaces TypeScript sans schéma Zod publié ; stateassign lit `learnerId` et `payerKind` (schéma local tolérant, charge illisible ignorée)",
  },
  {
    event: "finance.invoice.issued",
    reason: "finance type ses charges en interfaces TypeScript sans schéma Zod publié ; stateassign lit seulement `learnerId` (schéma local tolérant, charge illisible ignorée)",
  },
];
