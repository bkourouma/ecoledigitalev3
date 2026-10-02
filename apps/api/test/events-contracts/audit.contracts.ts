/**
 * Définition des contrats d'événements consommés par `audit` (abonnés : `modules/audit/subscribers.ts`, un par entrée de
 * `AUDIT_EVENT_SUBSCRIPTIONS`). Le journal lit les charges de façon DÉFENSIVE : aucune lecture n'est obligatoire, mais
 * chaque champ qu'il exploite pour qualifier l'entrée doit rester DÉCLARÉ par le producteur (sinon le journal perd la
 * cible, l'auteur ou le motif sans que rien ne casse).
 */
import { randomUUID } from "node:crypto";
import type { DomainEvent } from "@ecoledigitale/kernel";
import { resolveAuditHandler } from "../../src/modules/audit/domain/events";
import { consumedEdges, loadEventsCatalog } from "../helpers/events-catalog";
import type { EventContract, FieldRead } from "./support";

const catalog = await loadEventsCatalog();

const optional = (field: string | string[], kind: FieldRead["kind"], extra: Partial<FieldRead> = {}): FieldRead => ({ field, kind, required: false, ...extra });

/** Champs que le journal exploite, par événement (tous facultatifs côté lecteur). */
const READS: Record<string, FieldRead[]> = {
  "iam.impersonation.started": [optional("superAdminId", "uuid"), optional("targetUserId", "uuid"), optional("reason", "string"), optional("ip", "string"), optional("userAgent", "string")],
  "iam.login.failed": [optional("identifier", "string"), optional("reason", "string"), optional("locked", "boolean")],
  "iam.session.revoked": [optional("sessionId", "uuid"), optional("reason", "string")],
  "rbac.role.changed": [optional("roleId", "uuid"), optional("change", "string")],
  "rbac.assignment.changed": [optional("assignmentId", "uuid"), optional("userId", "uuid"), optional("roleId", "uuid"), optional("change", "string")],
  // Traitement générique : l'identifiant de l'entité est `<entité>Id` (sinon l'agrégat de l'événement).
  "tenancy.institution.created": [optional("institutionId", "uuid")],
  "tenancy.tenant.provisioned": [optional("tenantId", "uuid")],
  "tenancy.tenant.status_changed": [optional("tenantId", "uuid"), optional("reason", "string", { nullable: true })],
  "entitlements.subscription.changed": [optional("subscriptionId", "uuid")],
  "iam.membership.created": [optional("membershipId", "uuid")],
  "iam.membership.changed": [optional("membershipId", "uuid"), optional("before", "object"), optional("after", "object")],
};

const eventOf = (type: string, payload: unknown): DomainEvent => ({
  id: randomUUID(),
  type,
  version: 1,
  tenantId: randomUUID(),
  occurredAt: new Date("2026-09-15T08:30:00.000Z").toISOString(),
  payload,
}) as DomainEvent;

const events = [...new Set(consumedEdges(catalog).filter((e) => e.consumer === "audit").flatMap((e) => e.events))].sort();

export const contracts: EventContract[] = events.map((event) => ({
  consumer: "audit",
  event,
  reads: READS[event] ?? [],
  // Le journal doit produire une entrée (jamais `null`) pour la charge réelle du producteur.
  reader: (payload) => resolveAuditHandler(event)?.(eventOf(event, payload)) ?? null,
  readerOk: (entry) => entry !== null && typeof entry === "object" && typeof (entry as { action?: unknown }).action === "string",
}));
