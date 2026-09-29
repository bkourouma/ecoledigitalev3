/**
 * Message d'une erreur inattendue, tel qu'il peut être renvoyé au navigateur.
 *
 * Les erreurs métier levées par les services portent un message écrit pour
 * l'utilisateur : on le garde. Une erreur PostgreSQL, elle, expose le schéma
 * (« relation "commerciaux" does not exist », noms de colonnes, contraintes) :
 * en production, on la remplace par un message générique. Le détail reste dans
 * les journaux du serveur, où le handler l'écrit avant de répondre.
 */
const GENERIC_MESSAGE = "Erreur interne du serveur.";

/** Une erreur du pilote `pg` porte un code SQLSTATE de cinq caractères. */
function isDatabaseError(error: any): boolean {
  return typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code);
}

export function publicErrorMessage(error: any): string {
  if (!error?.message) return GENERIC_MESSAGE;
  if (process.env.NODE_ENV === "production" && isDatabaseError(error)) return GENERIC_MESSAGE;
  return error.message;
}
