"use client";

/**
 * Copie d'emploi du temps du NAVIGATEUR : un seul accès IndexedDB partagé par la page, attribué à l'identité du jeton courant
 * (même expiré : une consultation hors ligne dure plus longtemps qu'un jeton d'accès). Les tests injectent leur propre `ScheduleCache`.
 */

import { openOfflineDb } from "./idb";
import { currentOfflineOwner } from "./owner";
import { ScheduleCache } from "./schedule-cache";

let shared: Promise<ScheduleCache> | null = null;

export function browserScheduleCache(): Promise<ScheduleCache> {
  if (!shared) {
    shared = openOfflineDb().then((db) => new ScheduleCache({ db, owner: () => currentOfflineOwner({ allowExpired: true }) }));
  }
  return shared;
}

/** Pour les tests : oublie l'accès partagé. */
export function resetBrowserScheduleCache(): void {
  shared = null;
}
