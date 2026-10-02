/**
 * Événements du module imports : noms `<module>.<entité>.<verbe-passé>`, payload JSON versionné `{ v: 1, … }`.
 * Les payloads ne contiennent JAMAIS de ligne de fichier : identifiants, clé d'importeur et décomptes
 * (schémas Zod : `packages/contracts/src/v2/imports.ts`). Domaine pur : aucun import d'infrastructure.
 */
import { IMPORT_EVENTS } from "@ecoledigitale/contracts/src/v2/imports";

/** Noms littéraux (lus par l analyse statique du catalogue) ; `satisfies` garantit la parité avec les contrats. */
export const ImportEvents = {
  jobCreated: "imports.job.created",
  validationRequested: "imports.job.validation_requested",
  jobValidated: "imports.job.validated",
  runRequested: "imports.run.requested",
  runStarted: "imports.run.started",
  runCompleted: "imports.run.completed",
  runFailed: "imports.run.failed",
  runCancelled: "imports.run.cancelled",
} as const satisfies typeof IMPORT_EVENTS;
export const ALL_IMPORT_EVENT_TYPES: ReadonlyArray<string> = Object.values(ImportEvents);
/** Compatibilité avec le squelette généré (`manifest.ts`). */
export const ALL_EVENT_TYPES = ALL_IMPORT_EVENT_TYPES;

/** Événements d'AUTRES modules consommés : aucun (le module est piloté par ses propres événements et par ses jobs). */
export const ConsumedEvents = {} as const;
