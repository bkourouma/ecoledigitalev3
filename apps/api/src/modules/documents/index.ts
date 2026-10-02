/**
 * API publique du module "documents" : SEUL point d'import autorisé pour les autres modules
 * (règle dependency-cruiser, pnpm check:boundaries). N'exportez que ce qui est destiné aux autres.
 */
export type { Item } from "./domain/item";
export { ITEM_CREATED, ALL_EVENT_TYPES, type ItemCreatedPayload } from "./domain/events";
export { createItem, listItems } from "./application/items";
export type { AuditEntry, AuditPort, ItemsDeps } from "./application/ports";
