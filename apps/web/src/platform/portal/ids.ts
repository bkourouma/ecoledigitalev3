/** Identifiants d'URL des portails : un identifiant mal formé est un 404 immédiat (aucune requête, aucune donnée). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);
