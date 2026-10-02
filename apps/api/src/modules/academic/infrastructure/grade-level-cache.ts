/**
 * Mémoïsation des lectures de `academic.grade_levels WHERE id = $1` (motif N+1 : un appel de port par élève ou par ligne
 * pendant la clôture d'une période, les bulletins, les règles).
 *
 * Portée STRICTE : le `RequestContext` (objet) sous lequel la transaction s'exécute. Un traitement qui appelle les ports
 * 50 fois avec le même contexte lit chaque niveau UNE fois ; une autre requête, un autre tenant, un autre utilisateur
 * ont un autre objet de contexte, donc un autre cache. Rien n'est partagé entre requêtes, entre tenants ni entre processus.
 *
 * Sûreté :
 *  - clé = (objet de contexte) puis `id` ; le tenant du contexte est revérifié à chaque lecture (la RLS filtre de toute
 *    façon la requête de remplissage) ;
 *  - durée de vie courte et ABSOLUE (`TTL_MS`) : au-delà, le cache du contexte est recréé ;
 *  - une écriture sur `grade_levels` dans un contexte (administration, application d'un modèle) DÉSACTIVE définitivement le
 *    cache de ce contexte et de sa transaction ; une lecture dans la transaction qui a écrit ne remplit jamais le cache
 *    (elle verrait des données non validées qu'un ROLLBACK annulerait) ;
 *  - un niveau absent (`null`) n'est jamais mémorisé ;
 *  - désactivable : `ACADEMIC_REQUEST_CACHE=off`.
 *
 * Limite assumée : une modification faite par UN AUTRE processus pendant la vie (quelques secondes) du contexte lecteur
 * n'est pas vue par ce contexte. Les niveaux sont des référentiels qui changent à l'administration, pas en cours de calcul.
 */
import { getRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { GradeLevel } from "../domain/records";

export const GRADE_LEVEL_CACHE_TTL_MS = 10_000;
const MAX_ENTRIES_PER_CONTEXT = 256;

interface ContextCache {
  readonly tenantId: string;
  readonly createdAt: number;
  disabled: boolean;
  readonly items: Map<string, GradeLevel>;
}

const byContext = new WeakMap<RequestContext, ContextCache>();
/** Transactions ayant écrit sur `grade_levels` : leurs lectures ne passent jamais par le cache. */
const dirtyTx = new WeakSet<Tx>();

export const gradeLevelCacheStats = { hits: 0, misses: 0 };

const enabled = (): boolean => {
  const v = (process.env.ACADEMIC_REQUEST_CACHE ?? "on").trim().toLowerCase();
  return !(v === "off" || v === "false" || v === "0");
};

function cacheOf(ctx: RequestContext, now: number): ContextCache {
  let c = byContext.get(ctx);
  if (!c || now - c.createdAt > GRADE_LEVEL_CACHE_TTL_MS || c.tenantId !== ctx.tenantId) {
    const disabled = c?.disabled === true && c.tenantId === ctx.tenantId;
    c = { tenantId: ctx.tenantId, createdAt: now, disabled, items: new Map() };
    byContext.set(ctx, c);
  }
  return c;
}

/** Lit un niveau via le cache du contexte courant, sinon via `load`. */
export async function readGradeLevelCached(tx: Tx, id: string, load: () => Promise<GradeLevel | null>): Promise<GradeLevel | null> {
  const ctx = getRequestContext();
  if (!ctx || !enabled() || dirtyTx.has(tx)) return load();
  const cache = cacheOf(ctx, Date.now());
  if (cache.disabled) return load();
  const hit = cache.items.get(id);
  if (hit) {
    gradeLevelCacheStats.hits += 1;
    return { ...hit };
  }
  gradeLevelCacheStats.misses += 1;
  const fresh = await load();
  // Le cache a pu être désactivé pendant la lecture (écriture concurrente du même contexte) : on ne mémorise pas.
  if (fresh && !cache.disabled && !dirtyTx.has(tx) && cache.items.size < MAX_ENTRIES_PER_CONTEXT) cache.items.set(id, { ...fresh });
  return fresh;
}

/** À appeler par toute écriture sur `academic.grade_levels` (même transaction). */
export function noteGradeLevelWrite(tx: Tx): void {
  dirtyTx.add(tx);
  const ctx = getRequestContext();
  if (!ctx) return;
  const c = byContext.get(ctx);
  if (c) {
    c.disabled = true;
    c.items.clear();
  } else {
    byContext.set(ctx, { tenantId: ctx.tenantId, createdAt: Date.now(), disabled: true, items: new Map() });
  }
}
