/** Constantes de structure du module (aucun seuil académique ni réglementaire : voir `packages/rules-engine`). */
import type { Pack } from "./types";

export const REPORTCARDS_PACK_LIST: readonly Pack[] = Object.freeze(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL", "CORE"]);

/** Registre des natures de documents rendables (019 : diplômes, attestations ; 032 : bulletin de paie). Les autres sont refusées. */
export const KNOWN_DOCUMENT_KINDS = Object.freeze(["REPORT_CARD", "TRANSCRIPT", "DIPLOMA", "ATTESTATION_SUCCESS", "ATTESTATION_AUTHENTICITY", "PAYSLIP"] as const);
export type KnownDocumentKind = (typeof KNOWN_DOCUMENT_KINDS)[number];
export const isKnownDocumentKind = (value: unknown): value is KnownDocumentKind => typeof value === "string" && (KNOWN_DOCUMENT_KINDS as readonly string[]).includes(value);

/** Durée maximale d'une URL signée de téléchargement (AC6.1). */
export const MAX_SIGNED_URL_TTL_SECONDS = 300;

/** Taille maximale d'un PDF téléversé pour comparaison (AC4.4). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
