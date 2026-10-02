/**
 * Faux IndexedDB MINIMAL pour les tests (jsdom n'en fournit pas) : juste ce qu'utilise `platform/offline/idb.ts` —
 * `open` + `onupgradeneeded`, `createObjectStore({ keyPath })`, `transaction`, `get / put / delete / getAll / clear`,
 * `oncomplete`. Les valeurs sont clonées (comme le fait le clone structuré réel), les données survivent à
 * la fermeture d'une « connexion » tant que la même instance de fabrique est réutilisée (rechargement de page simulé).
 */

interface FakeRequest<T> {
  result: T;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface StoreData {
  keyPath: string;
  rows: Map<string, unknown>;
}

interface DatabaseData {
  version: number;
  stores: Map<string, StoreData>;
}

export interface FakeIndexedDb {
  factory: IDBFactory;
  /** Fait échouer la prochaine ouverture (vérifie le repli en mémoire). */
  failNextOpen(): void;
  /** Fait échouer les N prochaines écritures (quota dépassé…). */
  failWrites(count: number): void;
  /** Contenu brut d'un magasin (assertions sur ce qui est RÉELLEMENT stocké). */
  dump(dbName: string, storeName: string): unknown[];
}

export function createFakeIndexedDb(): FakeIndexedDb {
  const databases = new Map<string, DatabaseData>();
  let failOpen = false;
  let writeFailures = 0;

  function makeRequest<T>(run: () => T, afterDone?: () => void): FakeRequest<T> {
    const req: FakeRequest<T> = { result: undefined as T, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        req.result = run();
        req.onsuccess?.();
      } catch (e) {
        req.error = e instanceof Error ? e : new Error(String(e));
        req.onerror?.();
      } finally {
        afterDone?.();
      }
    });
    return req;
  }

  function makeDb(name: string, data: DatabaseData) {
    return {
      name,
      objectStoreNames: { contains: (n: string) => data.stores.has(n) },
      createObjectStore(storeName: string, options: { keyPath: string }) {
        data.stores.set(storeName, { keyPath: options.keyPath, rows: new Map() });
      },
      close() {},
      transaction(storeName: string, mode: "readonly" | "readwrite") {
        const store = data.stores.get(storeName);
        if (!store) throw new Error(`Magasin inconnu : ${storeName}`);
        let pending = 0;
        let failed: Error | null = null;
        const tx: {
          error: Error | null;
          oncomplete: (() => void) | null;
          onerror: (() => void) | null;
          onabort: (() => void) | null;
          objectStore: (n: string) => unknown;
        } = {
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore: () => api,
        };
        const track = <T>(run: () => T): FakeRequest<T> => {
          pending += 1;
          return makeRequest(
            () => {
              try {
                return run();
              } catch (e) {
                failed = e instanceof Error ? e : new Error(String(e));
                throw e;
              }
            },
            () => {
              pending -= 1;
              if (pending === 0) {
                queueMicrotask(() => {
                  if (failed) {
                    tx.error = failed;
                    tx.onerror?.();
                    tx.onabort?.();
                  } else tx.oncomplete?.();
                });
              }
            },
          );
        };
        const write = (fn: () => void) => () => {
          if (mode !== "readwrite") throw new Error("Transaction en lecture seule.");
          if (writeFailures > 0) {
            writeFailures -= 1;
            throw new Error("QuotaExceededError");
          }
          fn();
        };
        const api = {
          get: (key: string) => track(() => (store.rows.has(key) ? structuredClone(store.rows.get(key)) : undefined)),
          getAll: () => track(() => [...store.rows.values()].map((v) => structuredClone(v))),
          put: (value: Record<string, unknown>) =>
            track(() => {
              write(() => store.rows.set(String(value[store.keyPath]), structuredClone(value)))();
              return value[store.keyPath];
            }),
          delete: (key: string) => track(write(() => void store.rows.delete(key))),
          clear: () => track(write(() => store.rows.clear())),
        };
        return tx;
      },
    };
  }

  const factory = {
    open(name: string, version: number) {
      const req: {
        result: unknown;
        error: Error | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onupgradeneeded: (() => void) | null;
        onblocked: (() => void) | null;
      } = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => {
        if (failOpen) {
          failOpen = false;
          req.error = new Error("Ouverture impossible (simulée).");
          req.onerror?.();
          return;
        }
        let data = databases.get(name);
        const isNew = !data || data.version < version;
        if (!data) {
          data = { version, stores: new Map() };
          databases.set(name, data);
        }
        req.result = makeDb(name, data);
        if (isNew) {
          data.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      }, 0);
      return req;
    },
  } as unknown as IDBFactory;

  return {
    factory,
    failNextOpen: () => {
      failOpen = true;
    },
    failWrites: (count) => {
      writeFailures = count;
    },
    dump: (dbName, storeName) => [...(databases.get(dbName)?.stores.get(storeName)?.rows.values() ?? [])],
  };
}
