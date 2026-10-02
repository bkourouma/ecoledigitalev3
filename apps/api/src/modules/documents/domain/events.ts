/**
 * Événements du module "documents" : noms <module>.<entité>.<verbe-passé>, payload JSON versionné { v: 1, ... }.
 * Les schémas de payload sont dans `packages/contracts/src/v2/documents.ts`. Aucun titre ni nom de fichier dans un événement.
 * Domaine pur : aucun import d'infrastructure.
 */
import { DOCUMENTS_EVENTS } from "@ecoledigitale/contracts/src/v2/documents";

export const DocumentsEvents = DOCUMENTS_EVENTS;

/** Tous les événements PUBLIÉS par le module (repris par manifest.ts). */
export const ALL_DOCUMENTS_EVENT_TYPES: readonly string[] = Object.values(DOCUMENTS_EVENTS);
