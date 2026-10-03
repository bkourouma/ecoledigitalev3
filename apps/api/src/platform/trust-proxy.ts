/**
 * `TRUST_PROXY` -> option `trustProxy` de Fastify.
 *
 * Pourquoi : le limiteur de débit et le verrouillage d'`iam`, l'audit et la liste des sessions s'appuient sur
 * `request.ip`. Derrière nginx ET le serveur web Next (qui appelle l'API pour NextAuth), sans `trustProxy` toutes
 * les requêtes portent l'adresse du proxy : un seul utilisateur peut épuiser le plafond « par IP » de tout le monde.
 *
 *   TRUST_PROXY non défini / "" / "false"  -> false (comportement historique : on ne croit aucun en-tête)
 *   TRUST_PROXY=2                           -> 2 sauts de proxy de confiance (nginx + Next)
 *   TRUST_PROXY=10.0.0.0/8,172.16.0.0/12    -> uniquement ces proxys
 *   TRUST_PROXY=true                        -> tout le monde (DÉCONSEILLÉ : en-tête X-Forwarded-For falsifiable)
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  const value = raw?.trim();
  if (!value || value.toLowerCase() === "false") return false;
  if (value.toLowerCase() === "true") return true;
  if (/^\d{1,2}$/.test(value)) return Number(value);
  const list = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0 || !list.every((s) => /^(?=[0-9a-fA-F]*[.:])[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(s))) {
    throw new Error("TRUST_PROXY doit être false, true, un nombre de sauts ou une liste d'adresses/CIDR séparées par des virgules.");
  }
  return list;
}

/** Valeur acceptée par l'option `trustProxy` de Fastify 5 (son type n'admet plus un nombre de sauts). */
export type FastifyTrustProxy = boolean | string[] | ((address: string, hop: number) => boolean);

/**
 * Fastify 5.12 traite un `trustProxy` numérique comme « ne croire personne » (fail-closed) : `TRUST_PROXY=1` ne
 * rendrait plus l'adresse du client. On exprime donc le nombre de sauts en fonction, avec la sémantique exacte de
 * `proxy-addr` (celle de fastify 4) : le saut `hop` est de confiance tant que `hop < sauts`.
 */
export function toFastifyTrustProxy(parsed: boolean | number | string[]): FastifyTrustProxy {
  if (typeof parsed === "number") return (_address: string, hop: number) => hop < parsed;
  return parsed;
}

/** `TRUST_PROXY` brut -> option `trustProxy` de Fastify 5 (échoue sur une valeur invalide, comme `parseTrustProxy`). */
export function resolveTrustProxy(raw: string | undefined): FastifyTrustProxy {
  return toFastifyTrustProxy(parseTrustProxy(raw));
}
