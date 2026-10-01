import { defineModule } from "@ecoledigitale/kernel";
import { TENANCY_EVENTS } from "./domain/events";

/**
 * Module `tenancy` : organisation (tenant), profil et branding, établissements,
 * campus, référentiel des pays, provisioning par modèles de pack, onboarding.
 * Socle (CORE) : toujours actif, sans feature commerciale à activer.
 */
export default defineModule({
  key: "tenancy",
  title: "Organisation, établissements et campus",
  packs: ["CORE"],
  dependsOn: [],
  permissions: [
    {
      key: "tenancy.institution.read",
      label: "Consulter l'organisation et les établissements",
      description: "Profil de l'organisation, établissements, campus, pays et progression de l'onboarding.",
    },
    {
      key: "tenancy.institution.manage",
      label: "Gérer l'organisation et les établissements",
      description: "Modifier le profil et le branding, créer ou modifier un établissement, avancer l'onboarding.",
    },
    {
      key: "tenancy.campus.manage",
      label: "Gérer les campus",
      description: "Créer, modifier ou supprimer les campus d'un établissement.",
    },
  ],
  features: [],
  menus: [],
  events: {
    publishes: [
      TENANCY_EVENTS.institutionCreated,
      TENANCY_EVENTS.tenantProvisioned,
      TENANCY_EVENTS.tenantStatusChanged,
    ],
    consumes: [],
  },
});
