/**
 * Préchargement, en arrière-plan, de la semaine SUIVANTE de l'emploi du temps personnel pour la consulter sans réseau.
 *
 * Garde-fous : une seule tentative par appel (l'appelant ne l'invoque qu'une fois par ouverture de l'écran), uniquement en ligne
 * et hors économie de données (`navigator.connection.saveData`), même route et même projection minimale que l'affichage,
 * échec silencieux (aucun toast, aucune exception), et enregistrement dans le cache existant (isolé par `tenant:utilisateur`,
 * plafonds et élagage de `ScheduleCache.save`).
 */

import type { CachedOccurrence, ScheduleCache } from "./schedule-cache";

export interface PrefetchWindow {
  from: string;
  to: string;
  includeCancelled: boolean;
}

export interface PrefetchedPage {
  items: ReadonlyArray<CachedOccurrence>;
  hasMore: boolean;
}

export interface PrefetchEnv {
  onLine?: boolean;
  connection?: { saveData?: boolean } | null;
}

/** Vrai si le navigateur est en ligne et que l'utilisateur n'a pas demandé d'économiser les données. */
export function canPrefetch(env?: PrefetchEnv): boolean {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: { saveData?: boolean } });
  const onLine = env?.onLine ?? nav?.onLine ?? false;
  const connection = env && "connection" in env ? env.connection : nav?.connection;
  return onLine && connection?.saveData !== true;
}

/**
 * Récupère et enregistre `next`. Retourne `true` si la fenêtre a été enregistrée ; `false` dans tous les autres cas
 * (hors ligne, économie de données, échec réseau ou de validation, pas de propriétaire) — sans jamais lever d'erreur.
 */
export async function prefetchWindow(opts: {
  next: PrefetchWindow;
  cache: Promise<ScheduleCache> | ScheduleCache;
  fetchPage: (w: PrefetchWindow) => Promise<PrefetchedPage>;
  /** Libellés connus des classes et salles (annuaires déjà chargés) ; seuls ceux utilisés par la fenêtre sont gardés. */
  labels: { classrooms: Readonly<Record<string, string>>; rooms: Readonly<Record<string, string>> };
  env?: PrefetchEnv;
}): Promise<boolean> {
  try {
    if (!canPrefetch(opts.env)) return false;
    const page = await opts.fetchPage(opts.next);
    const cache = await opts.cache;
    return await cache.save({ ...opts.next, hasMore: page.hasMore, items: page.items, classrooms: opts.labels.classrooms, rooms: opts.labels.rooms });
  } catch {
    return false;
  }
}
