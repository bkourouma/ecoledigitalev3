/**
 * Singleton du service d'audit, partagé par `index.ts` (API publique) et `http/plugin.ts`.
 * Isolé dans son propre fichier pour éviter un import circulaire index -> http -> index.
 * Configuration (HMAC, masquage, horloge) : `audit.configure({...})` au démarrage de l'API.
 */
import { createAuditService } from "./application/audit-service";

export const audit = createAuditService();
