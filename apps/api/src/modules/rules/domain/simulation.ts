/**
 * Simulation : part des DÉCISIONS modifiées (AC2.5) et fusion de rapports par groupe de cas. Pure ; chaque rapport
 * est produit par `simulate()` du moteur.
 */
import { Decimal, type RuleType, type SimulationReport } from "../engine";
import { isDecisionRule } from "./governance";

/**
 * Fusionne les rapports du moteur de plusieurs GROUPES de cas (un par étape du pipeline). Les groupes évaluent des
 * jeux de règles DISJOINTS ; les compteurs s'additionnent, les cas sont comptés une fois (par identifiant), les
 * différences détaillées sont plafonnées à `maxDifferences` (les compteurs restent exacts, AC2.4).
 */
export function mergeSimulationReports(
  reports: readonly SimulationReport[],
  caseIds: ReadonlySet<string>,
  maxDifferences: number,
): SimulationReport {
  const first = reports[0];
  if (!first) throw new Error("mergeSimulationReports : au moins un rapport est requis.");
  const sum = (pick: (r: SimulationReport) => number): number => reports.reduce((n, r) => n + pick(r), 0);
  const evaluations = sum((r) => r.summary.evaluations);
  const changed = sum((r) => r.summary.changed);
  const differences = reports.flatMap((r) => r.differences);
  const truncated = reports.some((r) => r.truncated) || differences.length > maxDifferences;
  return {
    oldVersion: first.oldVersion,
    newVersion: first.newVersion,
    summary: {
      cases: caseIds.size,
      rules: sum((r) => r.summary.rules),
      evaluations,
      changed,
      unchanged: sum((r) => r.summary.unchanged),
      newErrors: sum((r) => r.summary.newErrors),
      resolvedErrors: sum((r) => r.summary.resolvedErrors),
      changedErrors: sum((r) => r.summary.changedErrors),
      changedPercent: evaluations === 0 ? "0" : new Decimal(changed).times(100).div(evaluations).toDecimalPlaces(2).toString(),
    },
    rules: reports.flatMap((r) => r.rules).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    differences: differences.slice(0, maxDifferences),
    truncated,
    identical: reports.every((r) => r.identical),
  };
}

/**
 * Part (en %, 2 décimales) des évaluations de règles de DÉCISION (passage, validation, redoublement…) dont le
 * résultat a changé. `"0"` quand aucune évaluation de décision n'a eu lieu.
 */
export function decisionChangedPercent(report: Pick<SimulationReport, "rules">, ruleTypes: ReadonlyMap<string, RuleType>): string {
  let evaluated = 0;
  let changed = 0;
  for (const r of report.rules) {
    const type = ruleTypes.get(r.key);
    if (!type || !isDecisionRule(type)) continue;
    evaluated += r.evaluated;
    changed += r.changed;
  }
  if (evaluated === 0) return "0";
  return new Decimal(changed).times(100).div(evaluated).toDecimalPlaces(2).toString();
}
