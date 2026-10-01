/**
 * Diplômes : contexte d'éligibilité et progression (fonctions pures).
 *
 * Ce module NE DÉCIDE PAS de l'éligibilité : la règle `diplome_eligible` (RuleSet, module rules, contrat
 * `credit-semester@1`) la rend à partir du contexte construit ici. Ce qui est propre au registre est mécanique :
 *  - dédoublonner les exigences par UE (une UE exigée deux fois n'est comptée qu'une fois ; « obligatoire » l'emporte,
 *    parité `evaluateDiplomaEligibility` du legacy) ;
 *  - marquer « validée » une exigence qui a une acquisition valable dans le registre, avec les crédits FIGÉS de
 *    l'écriture (R-HIG-03) ;
 *  - une exigence RETIRÉE du curriculum n'est plus exigée si l'étudiant ne l'a pas acquise (il ne peut plus l'acquérir),
 *    mais compte pour celui qui l'a acquise (« l'écriture reste », spec §12).
 */
import { sumCredits } from "./credits";
import type { DiplomaRequirement, LedgerEntry, RequirementsSnapshot, SnapshotRequirement, Uuid } from "./types";

/** Entrée de la règle `diplome_eligible` : `exigences[] = { valide, obligatoire, uv }` + `uv_requises`. */
export interface EligibilityExigence {
  readonly valide: boolean;
  readonly obligatoire: boolean;
  readonly uv: number;
}

export interface RequirementState {
  readonly ueNodeId: Uuid;
  readonly code: string | null;
  readonly label: string | null;
  readonly credits: number;
  readonly mandatory: boolean;
  readonly validated: boolean;
  readonly ledgerId: Uuid | null;
  readonly removedFromCurriculum: boolean;
}

/** Dédoublonne par UE (l'obligatoire prime) et résout la validation depuis les écritures valables du registre. */
export function resolveRequirementStates(
  requirements: readonly DiplomaRequirement[],
  validEntries: ReadonlyArray<Pick<LedgerEntry, "id" | "ueNodeId" | "credits">>,
): RequirementState[] {
  const byUe = new Map<Uuid, { req: DiplomaRequirement; mandatory: boolean }>();
  for (const r of requirements) {
    const existing = byUe.get(r.ueNodeId);
    if (!existing) byUe.set(r.ueNodeId, { req: r, mandatory: r.mandatory });
    else if (r.mandatory) byUe.set(r.ueNodeId, { req: existing.req, mandatory: true });
  }
  const acquired = new Map(validEntries.map((e) => [e.ueNodeId, e]));
  const out: RequirementState[] = [];
  for (const { req, mandatory } of byUe.values()) {
    const entry = acquired.get(req.ueNodeId);
    if (req.removedFromCurriculum && !entry) continue; // plus exigée : elle ne peut plus être acquise
    out.push({
      ueNodeId: req.ueNodeId,
      code: req.ueCode,
      label: req.ueLabel,
      credits: entry ? entry.credits : req.credits,
      mandatory,
      validated: Boolean(entry),
      ledgerId: entry?.id ?? null,
      removedFromCurriculum: req.removedFromCurriculum,
    });
  }
  return out.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "") || a.ueNodeId.localeCompare(b.ueNodeId));
}

export function toEligibilityContext(states: readonly RequirementState[]): EligibilityExigence[] {
  return states.map((s) => ({ valide: s.validated, obligatoire: s.mandatory, uv: s.credits }));
}

export interface DiplomaProgress {
  readonly uvValidated: number;
  readonly uvRequired: number;
  /** Pourcentage d'avancement affiché, plafonné à 100 (affichage, parité legacy). */
  readonly percent: number;
  readonly validated: readonly RequirementState[];
  readonly remaining: readonly RequirementState[];
  readonly missingMandatory: readonly RequirementState[];
}

/** Progression à la demande depuis le registre (AC4.4). Aucune ligne d'octroi n'est nécessaire. */
export function computeProgress(states: readonly RequirementState[], uvRequired: number): DiplomaProgress {
  const validated = states.filter((s) => s.validated);
  const remaining = states.filter((s) => !s.validated);
  const uvValidated = sumCredits(validated.map((s) => s.credits));
  return {
    uvValidated,
    uvRequired,
    percent: uvRequired > 0 ? Math.min(100, Math.round((uvValidated / uvRequired) * 100)) : 0,
    validated,
    remaining,
    missingMandatory: remaining.filter((s) => s.mandatory),
  };
}

export function buildRequirementsSnapshot(states: readonly RequirementState[], uvRequired: number, capturedAt: Date): RequirementsSnapshot {
  const requirements: SnapshotRequirement[] = states.map((s) => ({
    ueNodeId: s.ueNodeId,
    code: s.code,
    label: s.label,
    credits: s.credits,
    mandatory: s.mandatory,
    validated: s.validated,
    ledgerId: s.ledgerId,
  }));
  return { v: 1, uvRequired, capturedAt: capturedAt.toISOString(), requirements };
}

/** Mention « en attente » : un semestre du cycle n'a pas encore de résultat FINAL (AC6.2). */
export const MENTION_PENDING = "PENDING";
