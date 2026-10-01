/**
 * Tables GLOBALES du module `scheduling` (hors RLS « tenant »), jointes à la liste blanche du test
 * d'isolation (`pnpm test:isolation`) avec la justification de chacune (ADR-002 §5).
 *
 * AUCUNE : les 19 tables du schéma `scheduling` portent `tenant_id uuid NOT NULL` et la policy
 * `tenant_isolation` — référentiels de pack (`room_types`, `calendar_event_kinds`) compris, car un
 * établissement les adapte (libellés, types d'événement) ; la table dérivée `resource_claims` aussi.
 *
 * `fixtures` : valeurs imposées pour que le test fabrique une ligne dans les tables dont les contraintes
 * (CHECK de format, bornes de dates, clés étrangères composites vers un référentiel) empêchent la
 * génération automatique. Les tables à clé étrangère composite vers un parent (patrons, occurrences,
 * intervenants…) restent contrôlées en structure (RLS forcée, policy unique, index) et sont couvertes
 * en comportement par `test/integration/sql-guards.integration.test.ts` et `isolation.integration.test.ts`.
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly reason: string;
}

const entries: readonly IsolationAllowlistEntry[] = Object.freeze([]);
export default entries;

/** Tables du schéma `scheduling` attendues (le test du module vérifie qu'aucune n'est oubliée). */
export const schedulingTenantTables: readonly string[] = Object.freeze([
  "scheduling.room_types",
  "scheduling.calendar_event_kinds",
  "scheduling.settings",
  "scheduling.conflict_policies",
  "scheduling.rooms",
  "scheduling.equipment_items",
  "scheduling.time_slots",
  "scheduling.calendar_events",
  "scheduling.timetables",
  "scheduling.timetable_entries",
  "scheduling.timetable_entry_staff",
  "scheduling.timetable_entry_equipment",
  "scheduling.generation_runs",
  "scheduling.session_occurrences",
  "scheduling.occurrence_staff",
  "scheduling.occurrence_equipment",
  "scheduling.resource_claims",
  "scheduling.occurrence_changes",
  "scheduling.ics_tokens",
]);

export const fixtures: Record<string, Record<string, unknown>> = {
  "scheduling.room_types": { code: "TEST" },
  "scheduling.calendar_event_kinds": { code: "TEST" },
  "scheduling.conflict_policies": { resource_kind: "STAFF", mode: "BLOCK" },
  "scheduling.equipment_items": { code: "TEST", quantity: 1 },
  "scheduling.time_slots": { code: "TEST", starts_time: "08:00", ends_time: "09:00" },
  "scheduling.timetables": { valid_from: "2026-09-01", valid_to: "2027-06-30" },
  "scheduling.ics_tokens": { scope: "ROOM", token_hash: "a".repeat(64) },
};
