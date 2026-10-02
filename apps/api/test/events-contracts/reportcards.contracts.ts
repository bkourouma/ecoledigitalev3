/** Définition des contrats d'événements consommés par `reportcards` (abonnés : `modules/reportcards/subscribers.ts`). */
import { pickUuid } from "../../src/modules/reportcards/subscribers";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  // Rendu du PDF : `reportCardId` (événements du module lui-même).
  { consumer: "reportcards", event: "reportcards.snapshot.created", reads: [{ field: "reportCardId", kind: "uuid" }], reader: (p) => pickUuid(p, "reportCardId") },
  { consumer: "reportcards", event: "reportcards.report_card.render_requested", reads: [{ field: "reportCardId", kind: "uuid" }], reader: (p) => pickUuid(p, "reportCardId") },
  // Rendu d'un document officiel d'un autre module (reçu, bulletin de paie) : `documentId`.
  { consumer: "reportcards", event: "reportcards.official_document.render_requested", reads: [{ field: "documentId", kind: "uuid" }], reader: (p) => pickUuid(p, "documentId") },
  // PDF combiné d'un lot : `batchId`.
  { consumer: "reportcards", event: "reportcards.batch.completed", reads: [{ field: "batchId", kind: "uuid" }], reader: (p) => pickUuid(p, "batchId") },
  // Gabarits de plateforme : seul le type compte.
  { consumer: "reportcards", event: "tenancy.tenant.provisioned", reads: [] },
];
