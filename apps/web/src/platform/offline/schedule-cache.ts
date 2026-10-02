/**
 * Copie LOCALE, en lecture seule, de l'emploi du temps PERSONNEL de l'enseignant, pour le consulter sans réseau.
 *
 * CE QUI EST STOCKÉ (et pourquoi c'est acceptable en clair, comme la file d'appel — voir `attendance-outbox.ts`) :
 *   uniquement des séances de SON emploi du temps : identifiants techniques (UUID de séance, de classe, de salle), horaires,
 *   intitulé de la séance, statut, et les LIBELLÉS de classe et de salle déjà affichés à l'écran. AUCUN nom d'élève,
 *   AUCUN nom d'autre membre du personnel, AUCUNE note libre ni motif d'annulation (champs qui peuvent contenir des
 *   données personnelles). Pas de chiffrement local : une clé gardée dans le même navigateur n'apporterait pas de
 *   protection réelle contre un script de la page (XSS). Le risque résiduel (appareil volé) est borné par l'isolation
 *   par `tenant:utilisateur`, la durée de vie courte (fenêtres anciennes élaguées), et la PURGE à la déconnexion.
 *
 * ISOLATION : chaque enregistrement est rattaché à `tenant:utilisateur`. Une autre personne (ou un autre tenant) sur le même
 * appareil ne lit jamais cette copie ; au premier usage d'un autre propriétaire, les copies des autres sont effacées
 * (c'est un cache jetable, contrairement aux brouillons de notes).
 *
 * Ce n'est PAS un cache de réponses d'API : le service worker n'en met aucune en cache. L'application écrit ici, explicitement,
 * ce qu'elle vient d'afficher avec succès, et ne le relit que si le réseau est indisponible.
 */

import type { ObjectStore, OfflineDb } from "./idb";

/** Projection minimale d'une séance (aucun champ libre sensible). */
export interface CachedOccurrence {
  id: string;
  kind: string;
  title: string | null;
  classroomId: string | null;
  curriculumNodeId: string | null;
  roomId: string | null;
  startsAt: string;
  endsAt: string;
  occursOn: string;
  durationMinutes: number;
  deliveryMode: string;
  status: string;
  needsReplacement: boolean;
  conflictOverride: boolean;
  locationLabel: string | null;
}

export interface ScheduleSnapshot {
  /** Clé de stockage : `sched:<owner>:<from>:<to>`. */
  key: string;
  owner: string;
  from: string;
  to: string;
  includeCancelled: boolean;
  /** Instant d'enregistrement (ISO) : sert à afficher la fraîcheur. */
  savedAt: string;
  hasMore: boolean;
  items: CachedOccurrence[];
  labels: { classrooms: Record<string, string>; rooms: Record<string, string> };
}

export interface ScheduleCacheDeps {
  db: OfflineDb;
  /** `tenant:utilisateur` courant, ou `null` si personne n'est identifié. */
  owner: () => string | null;
  now?: () => Date;
}

/** Fenêtres conservées par propriétaire (semaines consultées) ; les plus anciennes sont élaguées. */
export const MAX_WINDOWS_PER_OWNER = 8;
/** Séances conservées par fenêtre (le contrat de l'API plafonne à 500). */
export const MAX_ITEMS_PER_WINDOW = 500;
/** Une fenêtre dont la fin date de plus de ceci est effacée. */
export const MAX_WINDOW_AGE_DAYS = 21;
/** Au-delà, la copie est présentée comme « peut avoir changé ». */
export const STALE_AFTER_MS = 24 * 3_600_000;

function pickOccurrence(o: CachedOccurrence): CachedOccurrence {
  return {
    id: o.id,
    kind: o.kind,
    title: o.title,
    classroomId: o.classroomId,
    curriculumNodeId: o.curriculumNodeId,
    roomId: o.roomId,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    occursOn: o.occursOn,
    durationMinutes: o.durationMinutes,
    deliveryMode: o.deliveryMode,
    status: o.status,
    needsReplacement: o.needsReplacement,
    conflictOverride: o.conflictOverride,
    locationLabel: o.locationLabel,
  };
}

const keyOf = (owner: string, from: string, to: string, includeCancelled: boolean) => `sched:${owner}:${from}:${to}:${includeCancelled ? "c" : "n"}`;

export class ScheduleCache {
  private readonly store: ObjectStore<ScheduleSnapshot>;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly deps: ScheduleCacheDeps) {
    this.store = deps.db.store<ScheduleSnapshot>("schedule_cache");
    this.now = deps.now ?? (() => new Date());
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Enregistre la fenêtre qui vient d'être affichée en ligne. Sans propriétaire : ne fait rien. */
  save(input: {
    from: string;
    to: string;
    includeCancelled: boolean;
    hasMore: boolean;
    items: ReadonlyArray<CachedOccurrence>;
    classrooms: Readonly<Record<string, string>>;
    rooms: Readonly<Record<string, string>>;
  }): Promise<boolean> {
    return this.serial(async () => {
      const owner = this.deps.owner();
      if (!owner) return false;
      const items = input.items.slice(0, MAX_ITEMS_PER_WINDOW).map(pickOccurrence);
      const used = (ids: Array<string | null>) => new Set(ids.filter((x): x is string => x !== null));
      const classIds = used(items.map((i) => i.classroomId));
      const roomIds = used(items.map((i) => i.roomId));
      const only = (all: Readonly<Record<string, string>>, ids: Set<string>) => Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id)));
      const snapshot: ScheduleSnapshot = {
        key: keyOf(owner, input.from, input.to, input.includeCancelled),
        owner,
        from: input.from,
        to: input.to,
        includeCancelled: input.includeCancelled,
        savedAt: this.now().toISOString(),
        hasMore: input.hasMore || input.items.length > MAX_ITEMS_PER_WINDOW,
        items,
        labels: { classrooms: only(input.classrooms, classIds), rooms: only(input.rooms, roomIds) },
      };
      await this.store.put(snapshot);
      await this.prune(owner);
      return true;
    });
  }

  /** Copie enregistrée pour cette fenêtre, si elle appartient au propriétaire courant. */
  load(window: { from: string; to: string; includeCancelled: boolean }): Promise<ScheduleSnapshot | null> {
    return this.serial(async () => {
      const owner = this.deps.owner();
      if (!owner) return null;
      const row = await this.store.get(keyOf(owner, window.from, window.to, window.includeCancelled));
      return row && row.owner === owner ? row : null;
    });
  }

  /** Copies du propriétaire courant, de la plus récente à la plus ancienne. */
  list(): Promise<ScheduleSnapshot[]> {
    return this.serial(async () => {
      const owner = this.deps.owner();
      if (!owner) return [];
      return (await this.store.getAll()).filter((r) => r.owner === owner).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    });
  }

  /** Efface les copies des AUTRES propriétaires (autre utilisateur ou autre tenant sur le même appareil). */
  purgeForeign(): Promise<number> {
    return this.serial(async () => {
      const owner = this.deps.owner();
      let n = 0;
      for (const r of await this.store.getAll()) {
        if (r.owner !== owner) {
          await this.store.delete(r.key);
          n += 1;
        }
      }
      return n;
    });
  }

  /** Efface tout (déconnexion). */
  clear(): Promise<void> {
    return this.serial(() => this.store.clear());
  }

  /** Fenêtres trop anciennes, puis les plus anciennes au-delà de la limite. Appelé dans la chaîne sérielle. */
  private async prune(owner: string): Promise<void> {
    const limit = this.now().getTime() - MAX_WINDOW_AGE_DAYS * 86_400_000;
    const mine = (await this.store.getAll()).filter((r) => r.owner === owner);
    const alive: ScheduleSnapshot[] = [];
    for (const r of mine) {
      if (Date.parse(`${r.to}T23:59:59Z`) < limit) await this.store.delete(r.key);
      else alive.push(r);
    }
    alive.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    for (const r of alive.slice(MAX_WINDOWS_PER_OWNER)) await this.store.delete(r.key);
  }
}

/** Copie à montrer hors ligne : celle qui couvre `today` (la plus récente), sinon la plus récemment enregistrée. */
export function pickSnapshot(list: ReadonlyArray<ScheduleSnapshot>, today: string): ScheduleSnapshot | null {
  const byRecent = [...list].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return byRecent.find((s) => s.from <= today && today <= s.to) ?? byRecent[0] ?? null;
}

/** Séances d'une copie groupées par jour civil, triées par heure. */
export function groupByDay(items: ReadonlyArray<CachedOccurrence>): Array<[string, CachedOccurrence[]]> {
  const map = new Map<string, CachedOccurrence[]>();
  for (const o of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const list = map.get(o.occursOn) ?? [];
    list.push(o);
    map.set(o.occursOn, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Fraîcheur d'une copie : âge en minutes et indicateur « ancienne ». */
export function freshnessOf(savedAt: string, now: Date): { ageMinutes: number; stale: boolean } {
  const age = Math.max(0, now.getTime() - Date.parse(savedAt));
  return { ageMinutes: Math.floor(age / 60_000), stale: age > STALE_AFTER_MS };
}
