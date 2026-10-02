/**
 * Cycle de vie d'une session d'examen (copie de la garde `examinations.sessions_guard` : la base reste l'autorité, ce
 * module permet à l'écran de proposer les seules actions possibles et d'expliquer ce qui manque).
 *
 *   PLANNED > REGISTRATION_OPEN > REGISTRATION_CLOSED > IN_PROGRESS > RESULTS_ENTERED > PUBLISHED > ARCHIVED
 *   retours : REGISTRATION_CLOSED -> REGISTRATION_OPEN ; RESULTS_ENTERED -> IN_PROGRESS
 */
import type { SessionStatus } from "./types";

export const SESSION_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = Object.freeze({
  PLANNED: ["REGISTRATION_OPEN"],
  REGISTRATION_OPEN: ["REGISTRATION_CLOSED"],
  REGISTRATION_CLOSED: ["REGISTRATION_OPEN", "IN_PROGRESS"],
  IN_PROGRESS: ["RESULTS_ENTERED"],
  RESULTS_ENTERED: ["IN_PROGRESS", "PUBLISHED"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: [],
});

export const canTransitionSession = (from: SessionStatus, to: SessionStatus): boolean => SESSION_TRANSITIONS[from].includes(to);

/** Étapes du parcours, dans l'ordre : sert d'avancement affiché (phases) et d'indicateur « session figée » pour chaque module de l'écran. */
export const SESSION_PHASES = ["PLANNED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "IN_PROGRESS", "RESULTS_ENTERED", "PUBLISHED", "ARCHIVED"] as const;

export interface SessionProgress {
  /** Rang (0..6) de l'étape courante. */
  index: number;
  total: number;
  /** Part de l'avancement en pourcentage entier (0..100). */
  percent: number;
  next: SessionStatus | null;
  allowedNext: readonly SessionStatus[];
}

export function sessionProgress(status: SessionStatus): SessionProgress {
  const index = SESSION_PHASES.indexOf(status);
  const total = SESSION_PHASES.length;
  const forward = SESSION_TRANSITIONS[status];
  return {
    index,
    total,
    percent: Math.round((index / (total - 1)) * 100),
    next: SESSION_PHASES[index + 1] ?? null,
    allowedNext: forward,
  };
}

/** Sessions où l'on crée encore des candidats. */
export const ACCEPTS_NEW_CANDIDATES: readonly SessionStatus[] = ["PLANNED", "REGISTRATION_OPEN"];
/** Sessions où l'on saisit des notes. */
export const ACCEPTS_SCORES: readonly SessionStatus[] = ["IN_PROGRESS", "RESULTS_ENTERED"];
/** Sessions où la répartition est modifiable. */
export const ASSIGNMENT_OPEN: readonly SessionStatus[] = ["PLANNED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"];

/** Faits d'une session utiles pour dire POURQUOI une transition est refusée (messages qui listent les manques). */
export interface TransitionFacts {
  definitionLocked: boolean;
  registeredCount: number;
  withoutResultCount: number;
  unassignedCount: number;
}

/** Manques bloquant une transition (vide = aucun manque connu ; la base reste juge). */
export function transitionBlockers(to: SessionStatus, facts: TransitionFacts): string[] {
  const out: string[] = [];
  if (to === "REGISTRATION_OPEN" && !facts.definitionLocked) out.push("La définition (séries, épreuves) n'est pas encore figée : la figer avant d'ouvrir les inscriptions.");
  if (to === "PUBLISHED" && facts.withoutResultCount > 0) out.push(`${facts.withoutResultCount} candidat(s) inscrit(s) sans résultat : saisir ou importer leur résultat (absent, différé…) avant la publication.`);
  return out;
}
