/** Définition des contrats d'événements consommés par `rbac` (abonnés : `modules/rbac/subscribers.ts`, cache de permissions). */
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  // Le cache n'invalide que l'utilisateur concerné quand la charge porte `userId`, sinon tout le tenant.
  { consumer: "rbac", event: "rbac.assignment.changed", reads: [{ field: "userId", kind: "uuid" }] },
  { consumer: "rbac", event: "rbac.role.changed", reads: [] },
  // Rôles système du tenant à l'activation (seul le type compte) ; rattrapage à la réactivation (`status === "active"`).
  { consumer: "rbac", event: "tenancy.tenant.provisioned", reads: [] },
  {
    consumer: "rbac",
    event: "tenancy.tenant.status_changed",
    reads: [{ field: "status", kind: "string" }],
    reader: (p) => (p as { status?: unknown }).status,
    readerOk: (status) => status === "active" || status === "suspended" || status === "archived",
  },
];
