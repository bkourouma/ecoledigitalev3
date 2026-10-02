/**
 * API PUBLIQUE du module `documents` — seul point d'import autorisé pour les autres modules (règle dependency-cruiser,
 * `pnpm check:boundaries`). Complétée au fil des lots.
 */
export { default as documentsManifest } from "./manifest";
export { DocumentsEvents, ALL_DOCUMENTS_EVENT_TYPES } from "./domain/events";
export { DocumentsCode } from "./domain/errors";
