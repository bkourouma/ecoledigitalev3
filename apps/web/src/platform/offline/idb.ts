/**
 * Stockage local hors-ligne : une couche MINCE au-dessus d'IndexedDB (aucune dépendance), avec repli en mémoire quand
 * IndexedDB est indisponible (navigation privée de certains navigateurs, politique d'entreprise, SSR).
 *
 * Ce module ne sait RIEN du métier : il stocke des objets sérialisables par clé. Ce qui y est écrit (et ce qui ne doit
 * jamais y être écrit) est décidé par l'appelant — voir `attendance-outbox.ts` (identifiants non nominatifs seulement).
 *
 * IMPORTANT : ce n'est PAS un cache de réponses d'API. Le service worker (`public/sw.js`) ne met jamais en cache de
 * réponse authentifiée ; ici l'application écrit elle-même, explicitement, ce qu'elle a produit localement et n'a pas
 * encore pu envoyer.
 */

export interface ObjectStore<T> {
  get(key: string): Promise<T | undefined>;
  put(value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getAll(): Promise<T[]>;
  clear(): Promise<void>;
}

export interface OfflineDb {
  store<T>(name: string): ObjectStore<T>;
  /** Faux quand le repli en mémoire est actif : la file ne survivrait pas à un rechargement de la page. */
  readonly persistent: boolean;
}

export const OFFLINE_DB_NAME = "ed-offline";
export const OFFLINE_DB_VERSION = 1;
/** Magasins (clé = champ `key`). */
export const OFFLINE_STORES = ["attendance_calls", "meta"] as const;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB : requête échouée."));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB : transaction échouée."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB : transaction annulée."));
  });
}

class IdbStore<T> implements ObjectStore<T> {
  constructor(
    private readonly db: IDBDatabase,
    private readonly name: string,
  ) {}

  async get(key: string): Promise<T | undefined> {
    const tx = this.db.transaction(this.name, "readonly");
    const value = await request(tx.objectStore(this.name).get(key));
    return value as T | undefined;
  }

  async put(value: T): Promise<void> {
    const tx = this.db.transaction(this.name, "readwrite");
    tx.objectStore(this.name).put(value);
    await done(tx);
  }

  async delete(key: string): Promise<void> {
    const tx = this.db.transaction(this.name, "readwrite");
    tx.objectStore(this.name).delete(key);
    await done(tx);
  }

  async getAll(): Promise<T[]> {
    const tx = this.db.transaction(this.name, "readonly");
    return (await request(tx.objectStore(this.name).getAll())) as T[];
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(this.name, "readwrite");
    tx.objectStore(this.name).clear();
    await done(tx);
  }
}

class MemoryStore<T extends { key: string }> implements ObjectStore<T> {
  private readonly rows = new Map<string, T>();
  async get(key: string): Promise<T | undefined> {
    const row = this.rows.get(key);
    return row === undefined ? undefined : structuredClone(row);
  }
  async put(value: T): Promise<void> {
    this.rows.set(value.key, structuredClone(value));
  }
  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }
  async getAll(): Promise<T[]> {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  async clear(): Promise<void> {
    this.rows.clear();
  }
}

/** Base entièrement en mémoire (repli, et tests de logique pure). */
export function createMemoryDb(): OfflineDb {
  const stores = new Map<string, MemoryStore<{ key: string }>>();
  return {
    persistent: false,
    store<T>(name: string): ObjectStore<T> {
      let s = stores.get(name);
      if (!s) {
        s = new MemoryStore();
        stores.set(name, s);
      }
      return s as unknown as ObjectStore<T>;
    },
  };
}

function openIdb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let opening: IDBOpenDBRequest;
    try {
      opening = factory.open(name, OFFLINE_DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    opening.onupgradeneeded = () => {
      const db = opening.result;
      for (const store of OFFLINE_STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "key" });
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("IndexedDB : ouverture impossible."));
    opening.onblocked = () => reject(new Error("IndexedDB : ouverture bloquée."));
  });
}

/**
 * Ouvre la base locale. `factory` est injectable (tests : faux IndexedDB) ; par défaut `globalThis.indexedDB`.
 * Toute erreur d'ouverture bascule sur le repli en mémoire (`persistent: false`) au lieu de casser l'écran.
 */
export async function openOfflineDb(options: { factory?: IDBFactory | null; name?: string } = {}): Promise<OfflineDb> {
  const factory = options.factory === undefined ? (globalThis as { indexedDB?: IDBFactory }).indexedDB : options.factory;
  if (!factory) return createMemoryDb();
  try {
    const db = await openIdb(factory, options.name ?? OFFLINE_DB_NAME);
    return {
      persistent: true,
      store: <T>(name: string): ObjectStore<T> => new IdbStore<T>(db, name),
    };
  } catch {
    return createMemoryDb();
  }
}
