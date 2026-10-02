/**
 * Cohérence d'un type de décision (donnée d'établissement) — domaine pur, miroir des contraintes de table :
 *  - `results_decision_kind` et `results_final_code` vont ensemble et seulement pour les familles PASSAGE / REPEAT ;
 *  - ORIENTATION / REORIENTATION exigent une cible (série, niveau) ;
 *  - EXCLUSION n'est jamais appliquée automatiquement (`needs_human_application`) et nomme le statut visé ;
 *  - un statut d'élève n'a de sens que pour une exclusion.
 * Aucune valeur réglementaire : le code final doit être PERMIS par le contrat de règles (vérifié par le cas d'usage via un port).
 */
export interface DecisionTypeShape {
  readonly family: string;
  readonly requiresTarget: boolean;
  readonly resultsDecisionKind: string | null;
  readonly resultsFinalCode: string | null;
  readonly needsHumanApplication: boolean;
  readonly studentStatus: string | null;
}

export interface TypeIssue {
  readonly field: string;
  readonly message: string;
}

export function validateDecisionTypeShape(t: DecisionTypeShape): TypeIssue[] {
  const issues: TypeIssue[] = [];
  if ((t.resultsDecisionKind === null) !== (t.resultsFinalCode === null)) issues.push({ field: "resultsFinalCode", message: "Le genre et le code final de la décision de résultats vont ensemble." });
  if (t.resultsDecisionKind !== null && t.family !== "PASSAGE" && t.family !== "REPEAT") issues.push({ field: "resultsDecisionKind", message: "Seules les familles passage et redoublement sont propagées aux résultats." });
  if ((t.family === "ORIENTATION" || t.family === "REORIENTATION") && !t.requiresTarget) issues.push({ field: "requiresTarget", message: "Une orientation ou une réorientation exige une série ou un niveau visé." });
  if (t.family === "EXCLUSION" && !t.needsHumanApplication) issues.push({ field: "needsHumanApplication", message: "Une exclusion n'est jamais appliquée automatiquement." });
  if (t.studentStatus !== null && t.family !== "EXCLUSION") issues.push({ field: "studentStatus", message: "Le statut d'élève visé ne concerne que les exclusions." });
  return issues;
}

/** Complète les indicateurs imposés par la famille (cible pour l'orientation, application humaine pour l'exclusion). */
export function normalizeDecisionType<T extends DecisionTypeShape>(t: T): T {
  return { ...t, requiresTarget: t.requiresTarget || t.family === "ORIENTATION" || t.family === "REORIENTATION", needsHumanApplication: t.needsHumanApplication || t.family === "EXCLUSION" };
}
