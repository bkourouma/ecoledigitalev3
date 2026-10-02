/**
 * Tables GLOBALES du schéma "messaging" (sans tenant_id, hors RLS) pour le test d'isolation
 * (pnpm test:isolation et assertTenantIsolation). Fichier découvert automatiquement.
 *
 * AUCUNE : toutes les tables du module (settings, conversations, conversation_participants, messages, attachments,
 * announcements, announcement_targets, announcement_recipients, notifications, notification_preferences, reports,
 * restrictions, system_templates) portent tenant_id NOT NULL REFERENCES kernel.tenants(id) et la RLS forcée
 * (kernel.enable_tenant_rls). Une table n'a sa place ici QUE si elle est volontairement commune à tous les tenants
 * (référentiel). Chaque entrée porte alors une justification d'au moins 20 caractères, et le schéma de la table est
 * celui du module (aucune table d'un autre module). Une entrée qui ne correspond à aucune table est une erreur.
 *
 * `fixtures` : valeurs imposées pour fabriquer une ligne de test dans une table à CHECK exotique (sinon contrôle de
 * structure seul).
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [];

export default entries;

export const fixtures: Record<string, Record<string, unknown>> = {};
