import { ValidationError, isUuid } from "@ecoledigitale/kernel";

/** Paramètre de chemin UUID, sinon 400 (jamais d'identifiant libre jusqu'au SQL). */
export function uuidParam(value: unknown, name = "id"): string {
  if (!isUuid(value)) throw ValidationError.field(name, `${name} doit être un UUID valide.`, "invalid_uuid");
  return value.toLowerCase();
}
