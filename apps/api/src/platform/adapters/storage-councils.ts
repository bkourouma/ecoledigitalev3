/**
 * stockage d'objets -> councils : `StoragePort` — la pièce d'une signature papier numérisée existe-t-elle dans le stockage du TENANT ?
 *
 * Une clé n'est acceptée que si elle contient l'identifiant du tenant de la requête comme segment de chemin (`…/<tenant>/…`) : un conseil ne
 * sonde jamais un objet d'un autre tenant. Sans stockage, rien n'existe (échec fermé : la signature papier est refusée).
 */
import type { CouncilsStoragePort } from "../../modules/councils";
import type { ObjectStorage } from "./storage";

export function createCouncilsStoragePort(storage: ObjectStorage | null): CouncilsStoragePort {
  return {
    async objectExists(ctx, objectKey) {
      if (!storage) return false;
      if (!objectKey.split("/").includes(ctx.tenantId)) return false;
      try {
        return await storage.exists(objectKey);
      } catch {
        return false; // clé invalide ou stockage illisible : jamais « existe »
      }
    },
  };
}
