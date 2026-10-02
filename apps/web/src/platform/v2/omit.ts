/** Copie d'un objet sans certaines clés (corps de requête sans l'identifiant porté par le chemin). */
export function omit<T extends object, K extends keyof T>(source: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
}
