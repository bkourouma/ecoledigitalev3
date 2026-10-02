/**
 * Modèle de workflow LIVRÉ EN DONNÉE (spec AC1.4, `tenancy.institution.created`) : l'établissement le modifie par copie, jamais en
 * place (un workflow publié est figé). Aucune règle d'établissement n'y est inscrite autrement que comme point de départ : un
 * établissement qui exige un test d'entrée ajoute une étape, sans toucher au code.
 *
 *   DRAFT → SUBMITTED → UNDER_REVIEW ⇄ MISSING_DOCUMENT → ACCEPTED | WAITLISTED | REJECTED
 *   ACCEPTED → AWAITING_PAYMENT (crée l'élève INACTIVE, l'inscription PENDING, la facture) → ENROLLED
 *   clôtures : WITHDRAWN (famille), OFFER_EXPIRED (offre ou délai de paiement dépassé), DUPLICATE (dossier en double)
 *
 * Les permissions de transition sont celles du manifeste (aucun rôle en dur).
 */
import type { AdmissionClosureKind, AdmissionStatus } from "@ecoledigitale/contracts/src/v2/admissions";

export interface TemplateStage {
  readonly code: string;
  readonly label: string;
  readonly canonicalStatus: AdmissionStatus;
  readonly ordinal: number;
  readonly isInitial?: boolean;
  readonly isTerminal?: boolean;
  readonly holdsSeat?: boolean;
  readonly requiresConsent?: boolean;
  readonly requiresDocumentsComplete?: boolean;
  readonly requiresInterviewDone?: boolean;
  readonly requiresDecision?: boolean;
  readonly createsEnrollment?: boolean;
  readonly closureKind?: AdmissionClosureKind;
  readonly slaHours?: number;
  readonly notifyTemplateCode?: string;
}

export interface TemplateTransition {
  readonly fromStage: string;
  readonly toStage: string;
  readonly permissionKey: string;
  readonly requiresReason?: boolean;
  readonly isAutomatic?: boolean;
}

export const DEFAULT_WORKFLOW_CODE = "STANDARD";
export const DEFAULT_WORKFLOW_LABEL = "Parcours d'admission standard";

export const DEFAULT_STAGES: readonly TemplateStage[] = Object.freeze([
  { code: "DRAFT", label: "Brouillon", canonicalStatus: "DRAFT", ordinal: 1, isInitial: true },
  { code: "SUBMITTED", label: "Candidature reçue", canonicalStatus: "SUBMITTED", ordinal: 2, requiresConsent: true, notifyTemplateCode: "APPLICATION_RECEIVED" },
  { code: "UNDER_REVIEW", label: "En étude", canonicalStatus: "UNDER_REVIEW", ordinal: 3 },
  { code: "MISSING_DOCUMENT", label: "Pièces manquantes", canonicalStatus: "MISSING_DOCUMENT", ordinal: 4, notifyTemplateCode: "DOCUMENTS_MISSING" },
  { code: "WAITLISTED", label: "Liste d'attente", canonicalStatus: "WAITLISTED", ordinal: 5, requiresDecision: true, notifyTemplateCode: "APPLICATION_WAITLISTED" },
  { code: "ACCEPTED", label: "Admis", canonicalStatus: "ACCEPTED", ordinal: 6, requiresDecision: true, requiresDocumentsComplete: true, holdsSeat: true },
  { code: "AWAITING_PAYMENT", label: "Inscription en attente de paiement", canonicalStatus: "ACCEPTED", ordinal: 7, holdsSeat: true, createsEnrollment: true },
  { code: "ENROLLED", label: "Inscrit", canonicalStatus: "ENROLLED", ordinal: 8, isTerminal: true, holdsSeat: true, notifyTemplateCode: "ENROLLMENT_CONFIRMED" },
  { code: "REJECTED", label: "Refusé", canonicalStatus: "REJECTED", ordinal: 9, isTerminal: true, requiresDecision: true, closureKind: "REJECTED_BY_SCHOOL", notifyTemplateCode: "APPLICATION_REJECTED" },
  { code: "WITHDRAWN", label: "Retiré par la famille", canonicalStatus: "REJECTED", ordinal: 10, isTerminal: true, requiresDecision: true, closureKind: "WITHDRAWN_BY_FAMILY" },
  { code: "OFFER_EXPIRED", label: "Offre expirée", canonicalStatus: "REJECTED", ordinal: 11, isTerminal: true, requiresDecision: true, closureKind: "OFFER_EXPIRED" },
  { code: "DUPLICATE", label: "Dossier en double", canonicalStatus: "REJECTED", ordinal: 12, isTerminal: true, requiresDecision: true, closureKind: "DUPLICATE" },
]);

const UPDATE = "admission.update";
const DECIDE = "admission.decide";
const ENROLL = "admission.enroll";

const tr = (fromStage: string, toStage: string, permissionKey: string, extra: Partial<TemplateTransition> = {}): TemplateTransition => ({ fromStage, toStage, permissionKey, ...extra });

export const DEFAULT_TRANSITIONS: readonly TemplateTransition[] = Object.freeze([
  tr("DRAFT", "SUBMITTED", "admission.create"),
  tr("SUBMITTED", "UNDER_REVIEW", UPDATE),
  tr("SUBMITTED", "REJECTED", DECIDE, { requiresReason: true }),
  tr("SUBMITTED", "WITHDRAWN", DECIDE),
  tr("SUBMITTED", "DUPLICATE", DECIDE),
  tr("UNDER_REVIEW", "MISSING_DOCUMENT", UPDATE),
  tr("UNDER_REVIEW", "ACCEPTED", DECIDE),
  tr("UNDER_REVIEW", "WAITLISTED", DECIDE),
  tr("UNDER_REVIEW", "REJECTED", DECIDE, { requiresReason: true }),
  tr("UNDER_REVIEW", "WITHDRAWN", DECIDE),
  tr("UNDER_REVIEW", "DUPLICATE", DECIDE),
  tr("MISSING_DOCUMENT", "UNDER_REVIEW", UPDATE),
  tr("MISSING_DOCUMENT", "REJECTED", DECIDE, { requiresReason: true }),
  tr("MISSING_DOCUMENT", "WITHDRAWN", DECIDE),
  tr("WAITLISTED", "ACCEPTED", DECIDE),
  tr("WAITLISTED", "REJECTED", DECIDE, { requiresReason: true }),
  tr("WAITLISTED", "WITHDRAWN", DECIDE),
  tr("ACCEPTED", "AWAITING_PAYMENT", ENROLL, { isAutomatic: true }),
  tr("ACCEPTED", "WITHDRAWN", DECIDE),
  tr("ACCEPTED", "OFFER_EXPIRED", DECIDE, { isAutomatic: true }),
  tr("AWAITING_PAYMENT", "ENROLLED", ENROLL, { isAutomatic: true }),
  tr("AWAITING_PAYMENT", "WITHDRAWN", DECIDE),
  tr("AWAITING_PAYMENT", "OFFER_EXPIRED", DECIDE, { isAutomatic: true }),
]);

/** Motifs codés livrés par défaut (données modifiables) : libellés NEUTRES, communicables à la famille. */
export const DEFAULT_DECISION_REASONS: readonly { code: string; kind: "ACCEPT" | "REJECT" | "WAITLIST" | "WITHDRAW"; label: string }[] = Object.freeze([
  { code: "ADMITTED", kind: "ACCEPT", label: "Candidature retenue" },
  { code: "NO_SEAT_YET", kind: "WAITLIST", label: "Capacité d'accueil atteinte : candidature placée en liste d'attente" },
  { code: "FILE_INCOMPLETE", kind: "REJECT", label: "Dossier incomplet" },
  { code: "NO_SEAT", kind: "REJECT", label: "Capacité d'accueil atteinte" },
  { code: "NOT_ELIGIBLE", kind: "REJECT", label: "Conditions d'admission non remplies" },
  { code: "OTHER_REJECT", kind: "REJECT", label: "Candidature non retenue" },
  { code: "WITHDRAWN_BY_FAMILY", kind: "WITHDRAW", label: "Candidature retirée par la famille" },
  { code: "OFFER_EXPIRED", kind: "WITHDRAW", label: "Offre expirée" },
  { code: "PAYMENT_DEADLINE", kind: "WITHDRAW", label: "Délai de paiement des frais d'inscription dépassé" },
  { code: "DUPLICATE", kind: "WITHDRAW", label: "Dossier en double" },
]);

/** Gabarits de notification (codes) : le texte est fourni par le canal ; ici seulement leur existence (`notify_template_code`). */
export const NOTIFICATION_TEMPLATES = Object.freeze({
  APPLICATION_RECEIVED: "APPLICATION_RECEIVED",
  DOCUMENTS_MISSING: "DOCUMENTS_MISSING",
  APPLICATION_WAITLISTED: "APPLICATION_WAITLISTED",
  APPLICATION_REJECTED: "APPLICATION_REJECTED",
  OFFER_ISSUED: "OFFER_ISSUED",
  OFFER_ACCEPTED: "OFFER_ACCEPTED",
  ENROLLMENT_CONFIRMED: "ENROLLMENT_CONFIRMED",
});
