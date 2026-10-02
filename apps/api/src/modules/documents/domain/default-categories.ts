/**
 * Jeu de catégories de départ d'un tenant (créé à la première lecture, idempotent). Les établissements les modifient (libellés,
 * extensions, niveaux) ou en créent d'autres ; elles ne sont jamais supprimées (`is_system`).
 *
 * Aucune constante réglementaire : durées de conservation et seuils sont des PARAMÈTRES d'établissement (`settings`) ou de
 * catégorie, jamais codés ici (hormis les alertes d'expiration, héritées des paramètres).
 */
import type { DocumentConfidentiality, DocumentExtension, DocumentKind } from "@ecoledigitale/contracts/src/v2/documents";

export interface DefaultCategory {
  readonly code: string;
  readonly kind: DocumentKind;
  readonly label: string;
  readonly description: string;
  readonly confidentiality: DocumentConfidentiality;
  readonly allowedExtensions: readonly DocumentExtension[];
  readonly audienceOwner: boolean;
  readonly audienceGuardians: boolean;
  readonly ownerUpload: boolean;
  readonly requiresExpiry: boolean;
  readonly sortOrder: number;
}

const SCANS: readonly DocumentExtension[] = ["pdf", "jpg", "jpeg", "png", "webp"];
const OFFICE: readonly DocumentExtension[] = ["pdf", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "odt", "ods", "odp", "txt", "csv", "jpg", "jpeg", "png"];

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = Object.freeze([
  // --- Élèves (StudentDocument)
  { code: "STUDENT_IDENTITY", kind: "STUDENT", label: "Pièces d'identité de l'élève", description: "Extrait de naissance, carte d'identité, passeport.", confidentiality: "RESTRICTED", allowedExtensions: SCANS, audienceOwner: true, audienceGuardians: true, ownerUpload: true, requiresExpiry: false, sortOrder: 100 },
  { code: "STUDENT_ENROLLMENT", kind: "STUDENT", label: "Dossier d'inscription", description: "Fiche, autorisations parentales, engagements.", confidentiality: "RESTRICTED", allowedExtensions: SCANS, audienceOwner: true, audienceGuardians: true, ownerUpload: true, requiresExpiry: false, sortOrder: 110 },
  { code: "STUDENT_MEDICAL", kind: "STUDENT", label: "Dossier médical", description: "Certificats médicaux, carnet de vaccination.", confidentiality: "CONFIDENTIAL", allowedExtensions: SCANS, audienceOwner: false, audienceGuardians: true, ownerUpload: true, requiresExpiry: false, sortOrder: 120 },
  { code: "STUDENT_PRIOR_SCHOOLING", kind: "STUDENT", label: "Scolarité antérieure", description: "Bulletins, diplômes et attestations d'établissements précédents.", confidentiality: "RESTRICTED", allowedExtensions: SCANS, audienceOwner: true, audienceGuardians: true, ownerUpload: true, requiresExpiry: false, sortOrder: 130 },
  // --- Personnel (TeacherDocument)
  { code: "STAFF_IDENTITY", kind: "TEACHER", label: "Pièces d'identité du personnel", description: "Carte d'identité, passeport.", confidentiality: "RESTRICTED", allowedExtensions: SCANS, audienceOwner: true, audienceGuardians: false, ownerUpload: true, requiresExpiry: false, sortOrder: 200 },
  { code: "STAFF_CONTRACT", kind: "TEACHER", label: "Contrats de travail", description: "Contrats, avenants, attestations d'emploi.", confidentiality: "CONFIDENTIAL", allowedExtensions: ["pdf", "docx", "odt"], audienceOwner: true, audienceGuardians: false, ownerUpload: false, requiresExpiry: false, sortOrder: 210 },
  { code: "STAFF_DIPLOMA", kind: "TEACHER", label: "Diplômes et attestations", description: "Diplômes, certificats, attestations de formation.", confidentiality: "RESTRICTED", allowedExtensions: SCANS, audienceOwner: true, audienceGuardians: false, ownerUpload: true, requiresExpiry: false, sortOrder: 220 },
  { code: "STAFF_AUTHORIZATION", kind: "TEACHER", label: "Habilitations et autorisations", description: "Autorisations d'enseigner, habilitations avec échéance.", confidentiality: "RESTRICTED", allowedExtensions: SCANS, audienceOwner: true, audienceGuardians: false, ownerUpload: true, requiresExpiry: true, sortOrder: 230 },
  // --- Établissement (InstitutionDocument)
  { code: "INSTITUTION_REGULATION", kind: "INSTITUTION", label: "Règlement intérieur et chartes", description: "Règlement intérieur, chartes, notes de service.", confidentiality: "INTERNAL", allowedExtensions: OFFICE, audienceOwner: false, audienceGuardians: false, ownerUpload: false, requiresExpiry: false, sortOrder: 300 },
  { code: "INSTITUTION_LEGAL", kind: "INSTITUTION", label: "Agréments et pièces légales", description: "Agréments, autorisations d'ouverture, statuts.", confidentiality: "RESTRICTED", allowedExtensions: SCANS, audienceOwner: false, audienceGuardians: false, ownerUpload: false, requiresExpiry: true, sortOrder: 310 },
  { code: "INSTITUTION_INSURANCE", kind: "INSTITUTION", label: "Assurances", description: "Contrats et attestations d'assurance.", confidentiality: "RESTRICTED", allowedExtensions: SCANS, audienceOwner: false, audienceGuardians: false, ownerUpload: false, requiresExpiry: true, sortOrder: 320 },
  // --- Académique (AcademicDocument)
  { code: "ACADEMIC_PROGRAM", kind: "ACADEMIC", label: "Programmes et référentiels", description: "Programmes officiels, référentiels de compétences.", confidentiality: "INTERNAL", allowedExtensions: OFFICE, audienceOwner: false, audienceGuardians: false, ownerUpload: false, requiresExpiry: false, sortOrder: 400 },
  { code: "ACADEMIC_CIRCULAR", kind: "ACADEMIC", label: "Calendriers et circulaires", description: "Calendriers scolaires, circulaires, convocations.", confidentiality: "INTERNAL", allowedExtensions: OFFICE, audienceOwner: false, audienceGuardians: false, ownerUpload: false, requiresExpiry: false, sortOrder: 410 },
  { code: "ACADEMIC_OFFICIAL", kind: "ACADEMIC", label: "Pièces académiques d'élèves", description: "Attestations, procès-verbaux et pièces académiques déposées (les documents officiels générés restent dans bulletins et diplômes).", confidentiality: "RESTRICTED", allowedExtensions: ["pdf", "jpg", "jpeg", "png"], audienceOwner: true, audienceGuardians: true, ownerUpload: false, requiresExpiry: false, sortOrder: 420 },
  // --- Financier (FinancialDocument)
  { code: "FINANCIAL_INVOICE", kind: "FINANCIAL", label: "Factures et justificatifs", description: "Factures, avis d'échéance, justificatifs.", confidentiality: "RESTRICTED", allowedExtensions: ["pdf", "jpg", "jpeg", "png", "xlsx", "csv"], audienceOwner: true, audienceGuardians: true, ownerUpload: false, requiresExpiry: false, sortOrder: 500 },
  { code: "FINANCIAL_PAYMENT_PROOF", kind: "FINANCIAL", label: "Preuves de paiement", description: "Reçus bancaires, captures de paiement mobile.", confidentiality: "RESTRICTED", allowedExtensions: SCANS, audienceOwner: true, audienceGuardians: true, ownerUpload: true, requiresExpiry: false, sortOrder: 510 },
  { code: "FINANCIAL_ACCOUNTING", kind: "FINANCIAL", label: "Pièces comptables", description: "Pièces justificatives, relevés, états comptables.", confidentiality: "CONFIDENTIAL", allowedExtensions: ["pdf", "xlsx", "xls", "csv", "jpg", "jpeg", "png"], audienceOwner: false, audienceGuardians: false, ownerUpload: false, requiresExpiry: false, sortOrder: 520 },
]);
