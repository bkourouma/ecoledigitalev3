import { defineModule } from "@ecoledigitale/kernel";

/**
 * Module `platform` — console des opérateurs de la plateforme (`/api/v1/platform/*`).
 *
 * POURQUOI un module (et non du code dans `apps/api/src/platform/`) : la console ORCHESTRE des use cases de
 * plusieurs modules (tenancy, rbac, entitlements, iam, audit) — provisionner un tenant, changer son statut,
 * gérer plans, abonnements et surcharges — avec ses propres routes, son audit de plateforme et ses tests. C'est
 * du métier, il suit donc les règles des modules (import des autres modules par leur seul `index.ts`, manifeste,
 * découverte automatique, `http/plugin.ts` sous `/api/v1/platform`). `apps/api/src/platform/` reste la couche
 * TECHNIQUE d'assemblage (runtime, bootstrap, authentification) : c'est elle, et non ce module, qui parle au
 * code legacy (JWT super-admin) et fournit le port `SuperAdminAuthorizer`.
 *
 * Aucun schéma Postgres : le module ne possède aucune table (il compose des modules qui en ont).
 * Aucune permission RBAC : un opérateur de la plateforme n'a pas de rôle de tenant (cf. README entitlements) ;
 * l'accès est réservé au `SuperAdminAuthorizer` et chaque action est tracée dans le journal d'audit de
 * PLATEFORME (`audit.recordPlatform`), en plus de l'audit du tenant visé fait par les use cases appelés.
 */
export default defineModule({
  key: "platform",
  title: "Console plateforme",
  packs: ["CORE"],
  dependsOn: ["tenancy", "rbac", "entitlements", "audit", "iam"],
  permissions: [],
  features: [],
  menus: [],
  events: { publishes: [], consumes: [] },
});
