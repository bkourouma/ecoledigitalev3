/**
 * Environnement d'exécution : la liaison d'un jeu de règles FICTIF (`placeholder`) n'est libre qu'en développement, en test
 * et en démonstration ; en production elle exige un accusé explicite (`rules.placeholder_requires_ack`).
 *
 * `RULES_ENV`, sinon `NODE_ENV`. Défaut SÛR : production (une variable absente ou inconnue n'ouvre jamais la porte).
 * Fonction PURE : l'environnement est passé en paramètre.
 */
export function isProductionEnvironment(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = (env.RULES_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  return !["development", "dev", "test", "demo", "demonstration", "staging"].includes(raw);
}
