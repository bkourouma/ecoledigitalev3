/**
 * Suivi PUBLIC d'une candidature : statut GROSSIER et libellés neutres. Rien d'interne n'en sort (étape personnalisée, détail
 * d'un motif, rang en liste d'attente, effectifs, notes). Pur.
 */
import type { AdmissionClosureKind, AdmissionStatus } from "@ecoledigitale/contracts/src/v2/admissions";

export type PublicPhase = "RECEIVED" | "UNDER_REVIEW" | "DOCUMENTS_NEEDED" | "OFFER_PENDING" | "WAITLISTED" | "ENROLLMENT_IN_PROGRESS" | "ENROLLED" | "CLOSED";

export const PUBLIC_PHASE_LABELS: Readonly<Record<PublicPhase, string>> = Object.freeze({
  RECEIVED: "Candidature reçue",
  UNDER_REVIEW: "Candidature en cours d'étude",
  DOCUMENTS_NEEDED: "Des pièces sont à fournir",
  OFFER_PENDING: "Une proposition d'admission vous concerne",
  WAITLISTED: "Candidature en liste d'attente",
  ENROLLMENT_IN_PROGRESS: "Inscription en cours : règlement des frais d'inscription attendu",
  ENROLLED: "Inscription confirmée",
  CLOSED: "Dossier clos",
});

export function publicPhaseOf(input: { status: AdmissionStatus; createsEnrollment: boolean }): PublicPhase {
  switch (input.status) {
    case "DRAFT":
    case "SUBMITTED":
      return "RECEIVED";
    case "UNDER_REVIEW":
      return "UNDER_REVIEW";
    case "MISSING_DOCUMENT":
      return "DOCUMENTS_NEEDED";
    case "ACCEPTED":
      return input.createsEnrollment ? "ENROLLMENT_IN_PROGRESS" : "OFFER_PENDING";
    case "WAITLISTED":
      return "WAITLISTED";
    case "ENROLLED":
      return "ENROLLED";
    case "REJECTED":
      return "CLOSED";
  }
}

/** Libellé neutre d'une clôture lorsque aucun motif codé n'est disponible (jamais de texte libre). */
export const CLOSURE_LABELS: Readonly<Record<AdmissionClosureKind, string>> = Object.freeze({
  REJECTED_BY_SCHOOL: "L'établissement n'a pas pu donner suite à cette candidature.",
  WITHDRAWN_BY_FAMILY: "Candidature retirée à la demande de la famille.",
  OFFER_EXPIRED: "La proposition d'admission est arrivée à échéance.",
  NO_SHOW: "Candidature clôturée.",
  DUPLICATE: "Candidature clôturée.",
});

export const PUBLIC_SUBMIT_MESSAGE =
  "Votre candidature a été enregistrée. Conservez précieusement ce code de suivi : il vous permettra de consulter l'avancement du dossier. L'établissement vous contactera.";
