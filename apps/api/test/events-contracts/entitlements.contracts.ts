/** Définition des contrats d'événements consommés par `entitlements` (abonnés : `modules/entitlements/subscribers.ts`). */
import { TenancyTenantProvisionedPayloadSchema } from "@ecoledigitale/contracts/v2";
import type { EventContract } from "./support";

/** Événements dont l'abonné ne lit que le type (invalidation du cache de droits, diffusée aux instances de l'API). */
const typeOnly = (event: string): EventContract => ({ consumer: "entitlements", event, reads: [] });

export const contracts: EventContract[] = [
  {
    consumer: "entitlements",
    event: "tenancy.tenant.provisioned",
    // `onTenantProvisioned` valide la charge avec le schéma du producteur et lit `packs` pour l'abonnement d'essai.
    reads: [{ field: "packs", kind: "array" }],
    reader: (p) => TenancyTenantProvisionedPayloadSchema.safeParse(p).success,
  },
  typeOnly("tenancy.tenant.status_changed"),
  typeOnly("entitlements.subscription.changed"),
  typeOnly("entitlements.override.changed"),
];
