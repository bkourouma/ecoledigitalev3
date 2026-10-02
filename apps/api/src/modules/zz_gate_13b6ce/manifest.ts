import { defineModule } from "@ecoledigitale/kernel";
import { ALL_EVENT_TYPES } from "./domain/events";

/**
 * Manifeste du module "zz_gate_13b6ce" : source de vérité de ses permissions, features, menus et événements
 * (le RBAC, les entitlements et la navigation se génèrent à partir de là). Le nom du dossier, la clé
 * et le schéma Postgres sont identiques. Voir docs/architecture/new-module-guide.md.
 */
export default defineModule({
  key: "zz_gate_13b6ce",
  title: "Zz gate 13b6ce",
  // Packs qui incluent le module par défaut (CORE = toujours actif). Les features ci-dessous affinent par pack.
  packs: ["CORE"],
  // Ordre de chargement/migration uniquement (jamais nécessaire pour utiliser runtime.requirePermission,
  // runtime.auditPort, runtime.entitlements : le runtime les fournit). Exemple : dependsOn: ["rbac"] si vous
  // importez rbac/index.ts.
  dependsOn: [],
  permissions: [
    { key: "zz_gate_13b6ce.item.read", label: "Consulter les éléments (zz gate 13b6ce)" },
    { key: "zz_gate_13b6ce.item.create", label: "Créer un élément (zz gate 13b6ce)" },
    // Permission sensible (MFA exigée, toujours auditée) :
    // { key: "zz_gate_13b6ce.item.delete", label: "Supprimer un élément (zz gate 13b6ce)", sensitive: true },
  ],
  // Features contrôlées par les entitlements (plan / pack / surcharge). Une route les exige par
  // runtime.entitlements.requireFeature("zz_gate_13b6ce.premium") ; un menu les référence par "feature".
  features: [
    // { key: "zz_gate_13b6ce.premium", label: "Option premium (zz gate 13b6ce)", packs: ["HIGHER"] },
  ],
  // Entrées de navigation (le menu doit référencer une permission DE CE MODULE).
  menus: [
    // { key: "zz_gate_13b6ce.items", label: "Zz gate 13b6ce", href: "/admin/zz_gate_13b6ce", permission: "zz_gate_13b6ce.item.read", portal: "admin", icon: "list", order: 900 },
  ],
  events: {
    publishes: [...ALL_EVENT_TYPES],
    // Événements d'AUTRES modules consommés (documentation ; l'abonnement réel est dans subscribers.ts).
    consumes: [],
  },
});
