/** Constantes de structure du module (aucun seuil académique ni réglementaire : voir `packages/rules-engine`). */
import type { Pack } from "./types";

export const REPORTCARDS_PACK_LIST: readonly Pack[] = Object.freeze(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL", "CORE"]);

/**
 * Natures PROPRES aux packs (Phase 4-5), rendues par le service générique des documents officiels : PV de conseil (006 conseil de
 * classe, 005 conseil des maîtres), bilan annuel du primaire (005), convocation, attestation de réussite et relevé de notes d'examen (018).
 */
export const PACK_DOCUMENT_KINDS = Object.freeze(["COUNCIL_MINUTES", "ANNUAL_REVIEW", "EXAM_CONVOCATION", "EXAM_SUCCESS_CERTIFICATE", "EXAM_TRANSCRIPT"] as const);
export type PackDocumentKind = (typeof PACK_DOCUMENT_KINDS)[number];

/** Registre des natures de documents rendables (019 : diplômes, attestations ; 032 : bulletin de paie ; 014 : reçu de paiement ; packs : `PACK_DOCUMENT_KINDS`). Les autres sont refusées. */
export const KNOWN_DOCUMENT_KINDS = Object.freeze(["REPORT_CARD", "TRANSCRIPT", "DIPLOMA", "ATTESTATION_SUCCESS", "ATTESTATION_AUTHENTICITY", "PAYSLIP", "RECEIPT", ...PACK_DOCUMENT_KINDS] as const);
export type KnownDocumentKind = (typeof KNOWN_DOCUMENT_KINDS)[number];
export const isKnownDocumentKind = (value: unknown): value is KnownDocumentKind => typeof value === "string" && (KNOWN_DOCUMENT_KINDS as readonly string[]).includes(value);

/** Natures rendues par le service générique des documents officiels d'autres modules (`application/official-documents.ts`). */
export const OFFICIAL_DOCUMENT_KINDS = Object.freeze(["RECEIPT", "PAYSLIP", ...PACK_DOCUMENT_KINDS] as const);
export type OfficialDocumentKind = (typeof OFFICIAL_DOCUMENT_KINDS)[number];
export const isOfficialDocumentKind = (value: unknown): value is OfficialDocumentKind => typeof value === "string" && (OFFICIAL_DOCUMENT_KINDS as readonly string[]).includes(value);
/** Gabarit de plateforme par défaut de chaque nature. */
export const DEFAULT_OFFICIAL_TEMPLATE: Readonly<Record<OfficialDocumentKind, string>> = Object.freeze({
  RECEIPT: "receipt-standard",
  PAYSLIP: "payslip-standard",
  COUNCIL_MINUTES: "council-minutes",
  ANNUAL_REVIEW: "annual-review-primary",
  EXAM_CONVOCATION: "exam-convocation",
  EXAM_SUCCESS_CERTIFICATE: "exam-success-certificate",
  EXAM_TRANSCRIPT: "exam-transcript",
});

/** Texte imprimé et filigrane d'un document dont les résultats viennent d'un jeu de règles de DÉMONSTRATION (`source.kind = placeholder`). */
export const DEMONSTRATION_NOTICE = "Règles de démonstration — document sans valeur officielle";
export const DEMONSTRATION_WATERMARK = "DÉMONSTRATION";
export const isDemonstrationSource = (sourceKind: unknown): boolean => sourceKind === "placeholder";

/** Durée maximale d'une URL signée de téléchargement (AC6.1). */
export const MAX_SIGNED_URL_TTL_SECONDS = 300;

/** Taille maximale d'un PDF téléversé pour comparaison (AC4.4). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
