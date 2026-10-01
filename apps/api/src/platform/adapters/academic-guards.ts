/**
 * assess + results + higher + scheduling -> academic : les gardes que le cœur académique consulte.
 *
 *  - `CurriculumUsageGuard` (assess, results) : un amendement STRUCTUREL d'un curriculum publié est refusé tant qu'une
 *    évaluation, une note ou un résultat dépend du nœud. Une lecture impossible compte comme « utilisé » (échec fermé) ;
 *  - `CompletionLookup` (higher, repli academic) : une UE (lignée) est validée si le registre de crédits l'a capitalisée ou
 *    si une sélection de cours terminée la porte — c'est ce que consomment les prérequis d'inscription ;
 *  - `ScheduleConflictChecker` (scheduling) : avertit d'un chevauchement d'horaires à l'inscription à une offre (non bloquant) ;
 *    la fabrique de scheduling est conforme au port, vérifiée à la compilation.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { hasCompletedSelection, type AcademicDeps, type CompletionLookup, type CurriculumUsageGuard, type ScheduleConflictChecker } from "../../modules/academic";
import { isCurriculumNodeInUse, type AssessDeps } from "../../modules/assess";
import { listAcquiredUe, type HigherDeps } from "../../modules/higher";
import { isCurriculumNodeInResults, type ResultsDeps } from "../../modules/results";
import { createAcademicScheduleConflictChecker, type SchedulingDeps } from "../../modules/scheduling";

export function createAcademicUsageGuard(assess: AssessDeps, results: ResultsDeps): CurriculumUsageGuard {
  return {
    async isNodeInUse(ctx: RequestContext, nodeId) {
      const a = await isCurriculumNodeInUse(assess, ctx, nodeId);
      const r = await isCurriculumNodeInResults(results, ctx, nodeId);
      // Échec fermé : si l'une des deux lectures échoue, le nœud est réputé utilisé.
      return !a.ok || !r.ok || a.value || r.value;
    },
  };
}

export function createAcademicCompletionLookup(higher: HigherDeps, academic: AcademicDeps): CompletionLookup {
  return {
    async hasValidated(ctx: RequestContext, input) {
      const acquired = await listAcquiredUe(higher, ctx, input.studentId);
      if (acquired.ok && acquired.value.some((e) => e.ueNodeId === input.lineageId)) return true;
      const selection = await hasCompletedSelection(academic, ctx, input);
      return selection.ok && selection.value;
    },
  };
}

export function createAcademicScheduleChecker(scheduling: SchedulingDeps): ScheduleConflictChecker {
  return createAcademicScheduleConflictChecker(scheduling);
}
