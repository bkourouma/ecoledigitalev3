import { defineModule } from "@ecoledigitale/kernel";
import { ENTITLEMENTS_EVENTS } from "./domain/events";

/**
 * Module `entitlements` : plans, packs, features, abonnements, surcharges et
 * mesure d'usage. Socle (CORE) : toujours actif. Le socle autorise et mesure ;
 * il ne facture pas (spec 027).
 */
export default defineModule({
  key: "entitlements",
  title: "Plans, packs et droits d'accès",
  packs: ["CORE"],
  dependsOn: ["tenancy"],
  permissions: [
    {
      key: "entitlements.read",
      label: "Consulter les droits et l'usage",
      description: "Voir les fonctionnalités incluses dans l'abonnement de l'établissement et l'usage mesuré.",
    },
    {
      key: "entitlements.manage",
      label: "Administrer plans, abonnements et surcharges",
      description: "Modifier le catalogue des plans, l'abonnement d'un tenant et ses surcharges de fonctionnalités.",
      sensitive: true,
    },
  ],
  features: [],
  menus: [],
  events: {
    publishes: [ENTITLEMENTS_EVENTS.subscriptionChanged, ENTITLEMENTS_EVENTS.overrideChanged],
    consumes: ["tenancy.tenant.provisioned", "tenancy.tenant.status_changed"],
  },
});
