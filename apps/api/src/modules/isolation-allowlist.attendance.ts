/**
 * Tables GLOBALES du module `attendance` (hors RLS « tenant »), à joindre à la liste blanche du test d'isolation avec la
 * justification de chaque entrée (ADR-002 §5).
 *
 * AUCUNE : les 19 tables du schéma `attendance` portent `tenant_id uuid NOT NULL` et la policy `tenant_isolation`
 * (référentiels de pack comme données : status_definitions, justification_reasons, leave_types, call_policies, settings ;
 * séances et pointages : sessions, student_records, record_history ; justificatifs : justifications,
 * justification_attachments, justification_records ; récapitulatifs : period_summaries, summary_overrides, alert_states ;
 * personnel : staff_records, staff_leaves ; synchronisation hors-ligne : sync_ops, sync_conflicts). Même les référentiels
 * de statuts sont PAR TENANT : un établissement ajoute ses statuts sans toucher à ceux des autres.
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly reason: string;
}

const entries: readonly IsolationAllowlistEntry[] = Object.freeze([]);

/** Tables du schéma `attendance` attendues (le test d'isolation vérifie qu'aucune n'est oubliée ni ajoutée sans RLS). */
export const attendanceTenantTables: readonly string[] = Object.freeze([
  "attendance.status_definitions",
  "attendance.justification_reasons",
  "attendance.leave_types",
  "attendance.call_policies",
  "attendance.settings",
  "attendance.sessions",
  "attendance.justifications",
  "attendance.justification_attachments",
  "attendance.student_records",
  "attendance.record_history",
  "attendance.justification_records",
  "attendance.period_summaries",
  "attendance.summary_overrides",
  "attendance.staff_leaves",
  "attendance.staff_records",
  "attendance.sync_ops",
  "attendance.sync_conflicts",
  "attendance.alert_states",
]);

export const attendanceIsolationAllowlistTables: readonly string[] = Object.freeze(entries.map((e) => e.table));

/**
 * Valeurs imposées pour fabriquer une ligne de test dans les tables à CHECK de format (codes, empreintes) : sans elles
 * la table ne serait contrôlée qu'en structure par le test d'isolation générique.
 */
export const attendanceIsolationFixtures: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  "attendance.status_definitions": { subject_kind: "STUDENT", code: () => `ISO_${Math.random().toString(36).slice(2, 10).toUpperCase()}`, label: "Isolation" },
  "attendance.justification_reasons": { code: () => `ISO_${Math.random().toString(36).slice(2, 10).toUpperCase()}`, label: "Isolation" },
  "attendance.sessions": { scope: "DAILY" },
  "attendance.sync_ops": { kind: "SESSION", payload_hash: "0".repeat(64), outcome: "OPENED" },
  "attendance.leave_types": { code: () => `ISO_${Math.random().toString(36).slice(2, 10).toUpperCase()}`, label: "Isolation" },
});

export default entries;
