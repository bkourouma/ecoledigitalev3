/** Définition des contrats d'événements consommés par `academic` (abonnés : `modules/academic/subscribers.ts`). */
import { academicConsumedInstitutionCreatedSchema, academicConsumedStudentStatusChangedSchema } from "@ecoledigitale/contracts/v2";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
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
];

/** Paires validées ailleurs (le test de couverture les accepte sans contrat complet). */
export const exemptions: Array<{ event: string; reason: string }> = [
  { event: "finance.invoice.paid", reason: "traitée par l'assemblage (branche platform/adapters) : enrichissement additif de la charge + adaptateur InvoiceFactsReader" },
];
