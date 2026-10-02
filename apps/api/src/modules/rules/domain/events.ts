/**
 * Événements publiés par le module `rules` (outbox, ADR-004). Nommage `rules.<entité>.<verbe-passé>` ;
 * payload JSON versionné `{ v: 1, … }` (on ajoute des champs, on n'en retire jamais sans nouvelle version).
 *
 * PUBLIER OU APPROUVER UNE VERSION NE DÉCLENCHE JAMAIS DE RECALCUL (A-13) : ces événements servent à
 * l'invalidation de caches, aux notifications et à l'alerte « périodes ouvertes en retard de version ».
 */
export const RulesEvents = {
  VERSION_PROPOSED: "rules.version.proposed",
  VERSION_APPROVED: "rules.version.approved",
  VERSION_PUBLISHED: "rules.version.published",
  VERSION_RETIRED: "rules.version.retired",
  VERSION_REJECTED: "rules.version.rejected",
  SIMULATION_REQUESTED: "rules.simulation.requested",
  SIMULATION_COMPLETED: "rules.simulation.completed",
  REPLAY_MISMATCH: "rules.replay.mismatch",
  BINDING_CHANGED: "rules.binding.changed",
} as const;

export type RulesEventType = (typeof RulesEvents)[keyof typeof RulesEvents];

export const ALL_RULES_EVENT_TYPES: readonly RulesEventType[] = Object.values(RulesEvents);

export interface VersionEventPayload {
  v: 1;
  ruleVersionId: string;
  ruleSetCode: string;
  versionNo: number;
  origin: "national" | "tenant";
  contractId: string;
  effectiveFrom: string;
  definitionHash: string | null;
  comment?: string | null;
  simulationId?: string | null;
}

export interface SimulationRequestedPayload {
  v: 1;
  simulationId: string;
  versionId: string;
  baseVersionId: string;
  contractId: string;
  dataset: unknown;
}

export interface SimulationCompletedPayload {
  v: 1;
  simulationId: string;
  versionId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  summary?: unknown;
}

export interface ReplayMismatchPayload {
  v: 1;
  /** `definition` : la définition d'une version ne correspond plus à son hash ; `result` : un résultat rejoué diffère. */
  kind: "definition" | "result";
  /** Identifiant du résultat rejoué (consommateur) ou de la version dont la définition a dérivé. */
  resultId: string;
  ruleVersionId: string;
  ruleKey?: string;
  expectedHash: string;
  actualHash: string;
}

export interface BindingChangedPayload {
  v: 1;
  bindingId: string;
  contractId: string;
  ruleSetCode: string;
  scope: { institutionId: string | null; curriculumNodeId: string | null; levelCode: string | null };
  effectiveFrom: string;
  effectiveTo: string | null;
  change: "created" | "updated" | "deleted";
  /** La liaison vise un jeu FICTIF dont l'usage a été accusé explicitement (production). */
  placeholderAcknowledged?: boolean;
}
