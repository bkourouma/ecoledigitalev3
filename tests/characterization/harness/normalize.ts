import { IdRegistry, UUID_RE } from "./ids";

/**
 * Normalisation des sorties legacy en JSON STABLE :
 *   - UUID du scénario -> alias (`student:amina`) ; UUID générés par la base (résultats, notes...) -> `<id:N>`
 *     numérotés par ordre d'apparition (le parcours est déterministe) ;
 *   - horodatages (Date ou ISO) -> `<timestamp>` : le legacy les pose avec `now()` ;
 *   - clés d'objet triées ; `undefined` supprimé ;
 *   - nombres inchangés (la précision flottante EST l'objet de la caractérisation).
 *
 * Les tableaux gardent leur ordre : c'est à l'observateur de les trier (ordre métier) ou de les indexer par clé.
 */
export function createNormalizer(ids: IdRegistry) {
  const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  // Les identifiants générés par la base (uuid_generate_v4) changent à chaque exécution et ne portent aucun
  // sens métier : ils sont tous remplacés par la même constante. Les identifiants du scénario gardent leur alias.
  const aliasOf = (uuid: string): string => ids.alias(uuid) ?? "<id>";

  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return v === undefined ? undefined : null;
    if (v instanceof Date) return "<timestamp>";
    if (typeof v === "string") {
      if (ISO_TS.test(v)) return "<timestamp>";
      return v.replace(UUID_RE, (m) => aliasOf(m));
    }
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "bigint") return v.toString();
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object") {
      // Les clés peuvent elles-mêmes être des UUID (cartes indexées par identifiant) : on les traduit aussi, puis on trie.
      const entries = Object.keys(v as object).map((k) => [k.replace(UUID_RE, (m) => aliasOf(m)), (v as Record<string, unknown>)[k]] as const);
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const out: Record<string, unknown> = {};
      for (const [k, raw] of entries) {
        const nv = walk(raw);
        if (nv !== undefined) out[k] = nv;
      }
      return out;
    }
    return String(v);
  };

  return { normalize: walk, aliasOf };
}

/** Trie un tableau d'objets par une clé texte (ordre métier explicite et stable). */
export function sortedBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
