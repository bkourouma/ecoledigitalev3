/** Définition des contrats d'événements consommés par `academic` (abonnés : `modules/academic/subscribers.ts`). */
import { academicConsumedInstitutionCreatedSchema, academicConsumedInvoicePaidSchema, academicConsumedStudentStatusChangedSchema, academicRolloverRequestedEventPayloadSchema } from "@ecoledigitale/contracts/v2";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  {
    consumer: "academic",
    event: "academic.rollover.requested",
    reads: [{ field: "runId", kind: "uuid" }],
    reader: (p) => academicRolloverRequestedEventPayloadSchema.safeParse(p).success,
  },
  {
    consumer: "academic",
    event: "tenancy.institution.created",
    reads: [
      { field: "institutionId", kind: "uuid" },
      { field: "pack", kind: "string" },
      { field: "educationSystem", kind: "string" },
    ],
    reader: (p) => academicConsumedInstitutionCreatedSchema.safeParse(p).success,
  },
  {
    consumer: "academic",
    event: "people.student.status_changed",
    reads: [
      { field: "studentId", kind: "uuid" },
      // Le NOUVEAU statut est `toStatus` (jamais `status`) ; l'ancien `fromStatus` ; le motif codé `reasonCode`.
      { field: "toStatus", kind: "string" },
      { field: "fromStatus", kind: "string", required: false, nullable: true },
      { field: "reasonCode", kind: "string", required: false, nullable: true },
    ],
    reader: (p) => academicConsumedStudentStatusChangedSchema.safeParse(p).success,
  },
  {
    consumer: "academic",
    event: "finance.invoice.paid",
    reads: [
      { field: "invoiceId", kind: "uuid" },
      // Additifs (décision métier 2026-10-01) : l'inscription visée, les frais d'inscription, les objets soldés.
      { field: "enrollmentId", kind: "uuid", required: false, nullable: true },
      { field: "containsRegistrationFee", kind: "boolean", required: false },
      { field: "sourceRefs", kind: "array", required: false },
    ],
    reader: (p) => academicConsumedInvoicePaidSchema.safeParse(p).success,
    readerOk: (result, payload) => {
      // La charge réelle porte de quoi CONFIRMER : une inscription visée ou des objets soldés, et l'indicateur de frais.
      const p = payload as { enrollmentId?: string | null; sourceRefs?: unknown[]; containsRegistrationFee?: boolean };
      return result === true && typeof p.containsRegistrationFee === "boolean" && Array.isArray(p.sourceRefs);
    },
  },
];

/** Paires validées ailleurs (le test de couverture les accepte sans contrat complet). */
export const exemptions: Array<{ event: string; reason: string }> = [];
