/**
 * Événements du module "zz_gate_13b6ce" : noms <module>.<entité>.<verbe-passé>, payload JSON versionné { v: 1, ... }.
 * Domaine pur : aucun import d'infrastructure.
 */
export const ITEM_CREATED = "zz_gate_13b6ce.item.created" as const;

/** Tous les événements PUBLIÉS par le module (repris par manifest.ts). */
export const ALL_EVENT_TYPES: readonly string[] = [ITEM_CREATED];

export interface ItemCreatedPayload {
  v: 1;
  itemId: string;
}
