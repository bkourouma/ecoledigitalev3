/**
 * Tables GLOBALES du module `scheduling` (hors RLS « tenant »), jointes à la liste blanche du test
 * d'isolation (`pnpm test:isolation`) avec la justification de chacune (ADR-002 §5).
 *
 * AUCUNE : les 20 tables du schéma `scheduling` portent `tenant_id uuid NOT NULL` et la policy
 * `tenant_isolation` — référentiels de pack (`room_types`, `calendar_event_kinds`) compris, car un
 * établissement les adapte (libellés, types d'événement) ; la table dérivée `resource_claims` aussi.
 *
 * `fixtures` : valeurs imposées pour que le test fabrique une ligne dans les tables dont les contraintes
 * (CHECK de format, bornes de dates) empêchent la génération automatique — c'est le cas de
 * `session_occurrences` (bornes horaires et date civile cohérentes), désormais testée en COMPORTEMENT.
 * Les tables à clé étrangère composite OBLIGATOIRE vers un parent (patrons, intervenants, réservations,
 * journal, salles → types de salle, événements → natures…) ne sont pas fabricables par le test générique
 * (limite du harnais : une FK composite NOT NULL n'est pas résolue) : elles restent contrôlées en structure
 * (RLS forcée, policy unique, index) et sont couvertes en comportement par
 * `test/integration/sql-guards.integration.test.ts` (« isolation (RLS) ») et `isolation.integration.test.ts`
 * (isolation de bout en bout à travers les cas d'usage).
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
  "scheduling.autogen_runs",
]);

export const fixtures: Record<string, Record<string, unknown>> = {
  "scheduling.room_types": { code: "TEST" },
  "scheduling.calendar_event_kinds": { code: "TEST" },
  "scheduling.conflict_policies": { resource_kind: "STAFF", mode: "BLOCK" },
  "scheduling.equipment_items": { code: "TEST", quantity: 1 },
  "scheduling.time_slots": { code: "TEST", starts_time: "08:00", ends_time: "09:00" },
  "scheduling.timetables": { valid_from: "2026-09-01", valid_to: "2027-06-30" },
  "scheduling.ics_tokens": { scope: "ROOM", token_hash: "a".repeat(64) },
  "scheduling.autogen_runs": { seed: "graine", params: {} },
  // Séance : le générateur donne `starts_at = ends_at` (CHECK ends_at > starts_at) et une `occurs_on` sans rapport avec
  // `starts_at` (CHECK |occurs_on - date UTC de starts_at| <= 1). Les clés étrangères composites (patron, salle) sont
  // facultatives et restent NULL ; `kind`, `status`, `origin`… prennent leur défaut.
  "scheduling.session_occurrences": {
    kind: "MEETING",
    starts_at: "2026-10-05T08:00:00Z",
    ends_at: "2026-10-05T09:00:00Z",
    occurs_on: "2026-10-05",
  },
};
