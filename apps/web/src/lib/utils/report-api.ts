/**
 * Petit client HTTP des modules d'export : mêmes en-têtes (tenant, session) que
 * les hooks React Query, mais utilisable hors composant — un export compose son
 * document à la demande et va parfois chercher un détail que la liste affichée
 * ne porte pas (les ECUE d'une UE, les inscrits d'une session…).
 */
import { createApiHeaders } from "@/lib/api-utils";

/** GET qui déballe l'enveloppe `{ success, data }` de l'API. */
export async function apiGet<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { headers: createApiHeaders() });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok || (json && json.success === false)) {
    throw new Error(json?.message || json?.error || `Erreur HTTP ${res.status}`);
  }
  return (json?.data ?? json) as T;
}

/**
 * Exécute `tache` sur chaque élément, `limite` en parallèle au plus.
 *
 * Un export « toutes les UE avec leurs ECUE » déclenche autant d'appels que
 * d'UE : sans bride, une centaine de requêtes partent d'un coup et l'API
 * répond en 429 ou s'effondre. L'ordre des résultats suit celui des entrées.
 */
export async function enParallele<T, R>(
  items: T[],
  tache: (item: T, index: number) => Promise<R>,
  limite = 6
): Promise<R[]> {
  const resultats = new Array<R>(items.length);
  let curseur = 0;
  const ouvriers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (curseur < items.length) {
      const i = curseur;
      curseur += 1;
      resultats[i] = await tache(items[i], i);
    }
  });
  await Promise.all(ouvriers);
  return resultats;
}
