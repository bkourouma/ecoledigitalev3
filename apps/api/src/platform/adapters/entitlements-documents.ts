/**
 * entitlements -> documents : `UsageReporter` (jauge `STORAGE_BYTES` du mois, mode `SET` : dernière valeur connue).
 *
 * Le socle ne facture pas et ne bloque pas : il compte (plan §3.5). Le quota par plan est appliqué par `documents` (features
 * `documents.storage.*`) ; ici on ne fait que rapporter l'usage. Un échec est remonté à l'appelant, qui le tolère
 * (une mesure manquante ne bloque jamais un dépôt).
 */
import type { TenantDb } from "@ecoledigitale/database";
import { recordUsage } from "../../modules/entitlements";
import type { UsageReporter } from "../../modules/documents";

export function createDocumentsUsageReporter(tenantDb: TenantDb): UsageReporter {
  return {
    async reportStorageBytes(ctx, usedBytes) {
      const result = await recordUsage({ db: tenantDb }, ctx, { metric: "STORAGE_BYTES", amount: Math.max(0, Math.floor(usedBytes)), mode: "SET" });
      if (!result.ok) throw result.error;
    },
  };
}
