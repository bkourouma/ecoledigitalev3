import { defineModule } from "@ecoledigitale/kernel";
import { ALL_EVENT_TYPES } from "./domain/events";

/**
 * Manifeste du module "documents" : source de vérité de ses permissions, features, menus et événements
 * (le RBAC, les entitlements et la navigation se génèrent à partir de là). Le nom du dossier, la clé
 * et le schéma Postgres sont identiques. Voir docs/architecture/new-module-guide.md.
 */
export default defineModule({
  key: "documents",
  title: "Documents",
  // Packs qui incluent le module par défaut (CORE = toujours actif). Les features ci-dessous affinent par pack.
  packs: ["CORE"],
  // Ordre de chargement/migration uniquement (jamais nécessaire pour utiliser runtime.requirePermission,
  // runtime.auditPort, runtime.entitlements : le runtime les fournit). Exemple : dependsOn: ["rbac"] si vous
  // importez rbac/index.ts.
  dependsOn: [],
  permissions: [
    { key: "documents.item.read", label: "Consulter les éléments (documents)" },
    { key: "documents.item.create", label: "Créer un élément (documents)" },
    // Permission sensible (MFA exigée, toujours auditée) :
    // { key: "documents.item.delete", label: "Supprimer un élément (documents)", sensitive: true },
  ],
  // Features contrôlées par les entitlements (plan / pack / surcharge). Une route les exige par
  // runtime.entitlements.requireFeature("documents.premium") ; un menu les référence par "feature".
  features: [
    // { key: "documents.premium", label: "Option premium (documents)", packs: ["HIGHER"] },
  ],
  // Entrées de navigation (le menu doit référencer une permission DE CE MODULE).
  menus: [
    // { key: "documents.items", label: "Documents", href: "/admin/documents", permission: "documents.item.read", portal: "admin", icon: "list", order: 900 },
  ],
  events: {
    publishes: [...ALL_EVENT_TYPES],
    // Événements d'AUTRES modules consommés (documentation ; l'abonnement réel est dans subscribers.ts).
    consumes: [],
  },
});
