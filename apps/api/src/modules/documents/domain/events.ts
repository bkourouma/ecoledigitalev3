/**
 * Événements du module "documents" : noms <module>.<entité>.<verbe-passé>, payload JSON versionné { v: 1, ... }.
 * Les schémas de payload sont dans `packages/contracts/src/v2/documents.ts` (qui répète ces noms : un test vérifie qu'ils sont
 * identiques). Aucun titre ni nom de fichier dans un événement : identifiants, comptes, seuils seulement.
 * Domaine pur : aucun import d'infrastructure.
 */
export const DocumentsEvents = {
  DOCUMENT_CREATED: "documents.document.created",
  DOCUMENT_VERSION_ADDED: "documents.document.version_added",
  DOCUMENT_UPDATED: "documents.document.updated",
  DOCUMENT_SHARED: "documents.document.shared",
  DOCUMENT_UNSHARED: "documents.document.unshared",
  DOCUMENT_ARCHIVED: "documents.document.archived",
  DOCUMENT_RESTORED: "documents.document.restored",
  DOCUMENT_PURGED: "documents.document.purged",
  /** Alerte d'expiration (consommée par le chantier notifications). */
  DOCUMENT_EXPIRING: "documents.document.expiring",
  DOCUMENT_EXPIRED: "documents.document.expired",
  UPLOAD_QUARANTINED: "documents.upload.quarantined",
  QUARANTINE_RELEASED: "documents.quarantine.released",
  INTEGRITY_MISMATCH: "documents.integrity.mismatch",
} as const;

/** Tous les événements PUBLIÉS par le module (repris par manifest.ts). */
export const ALL_DOCUMENTS_EVENT_TYPES: readonly string[] = Object.values(DocumentsEvents);
