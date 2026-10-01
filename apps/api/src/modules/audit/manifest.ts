import { defineModule } from "@ecoledigitale/kernel";
import { AUDIT_CONSUMED_EVENTS } from "./domain/events";

/**
 * Module `audit` — journal d'audit append-only, partitionné, chaîné (SHA-256/HMAC).
 * Socle (CORE) : toujours actif. Schéma Postgres : `audit`. Migrations 0300-0399.
 */
export default defineModule({
  key: "audit",
  title: "Journal d'audit",
  packs: ["CORE"],
  // Dépend du schéma `kernel` (baseline) mais d'aucun module : les événements consommés
  // sont reçus par leur nom, jamais par import.
  dependsOn: [],
  permissions: [
    {
      key: "audit.read",
      label: "Consulter le journal d'audit",
      description: "Lister et consulter les entrées du journal d'audit du tenant, et vérifier l'intégrité de la chaîne.",
    },
    {
      key: "audit.export",
      label: "Exporter le journal d'audit",
      description: "Exporter une période du journal d'audit au format CSV (opération elle-même journalisée).",
      sensitive: true,
    },
  ],
  features: [{ key: "audit.log", label: "Journal d'audit", packs: ["CORE"] }],
  menus: [
    {
      key: "audit.logs",
      label: "Journal d'audit",
      href: "/admin/audit",
      permission: "audit.read",
      feature: "audit.log",
      portal: "admin",
      icon: "shield-check",
      order: 900,
    },
  ],
  events: {
    publishes: [],
    consumes: [...AUDIT_CONSUMED_EVENTS],
  },
});
