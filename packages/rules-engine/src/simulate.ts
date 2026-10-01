import { Decimal } from './decimal';
import { evaluate } from './compile';
import type { CompiledRule } from './compile';
import { RuleError } from './errors';
import { compileRule, contextWithParameters, type RuleDefinition, type RuleType, type RuleVersion } from './model';
import type { Budget, EvalContext } from './runtime';
import type { RuleSchemaSpec } from './schema';

/**
 * Simulation « avant / après » d'une nouvelle version de règles sur un jeu de
 * données (par exemple les élèves réels d'un établissement). Fonction PURE :
 * mêmes entrées => même rapport.
 *
 * Limite connue : chaque règle est évaluée indépendamment sur le contexte du
 * cas ; le chaînage (la sortie d'une règle alimentant une autre) est du ressort
 * de l'appelant, qui fournit dans le contexte les valeurs d'entrée voulues.
 */

export interface SimulationCase {
  id: string;
  label?: string;
  context: EvalContext;
}

export interface SimulationOptions {
  /** Schéma d'entrée par type de règle (pour les règles sans `inputSchema`). */
  schemas?: Partial<Record<RuleType, RuleSchemaSpec>>;
  /** Schéma de repli si ni la règle ni `schemas` ne fournissent le schéma. */
  defaultSchema?: RuleSchemaSpec;
  budget?: Partial<Budget>;
  /** Nombre maximal de différences détaillées conservées (défaut 1000). Les compteurs restent exacts. */
  maxDifferences?: number;
  /** Restreint la simulation à ces clés de règles. */
  ruleKeys?: readonly string[];
}

export type Outcome =
  | { status: 'ok'; type: 'number' | 'string' | 'boolean' | 'null'; value: string | boolean | null }
  | { status: 'error'; code: string; message: string }
  | { status: 'absent' };

export type DifferenceKind =
  | 'value_changed'
  | 'error_introduced'
  | 'error_resolved'
  | 'error_changed';

export interface Difference {
  caseId: string;
  caseLabel?: string;
  ruleKey: string;
  kind: DifferenceKind;
  old: Outcome;
  new: Outcome;
  /** Écart (nouveau - ancien) pour deux nombres. */
  delta?: string;
}

export interface Transition {
  from: string;
  to: string;
  count: number;
}

export interface RuleSimulationStats {
  key: string;
  /** Présence de la règle dans l'ancienne / la nouvelle version. */
  presence: 'both' | 'added' | 'removed';
  /** Erreur de compilation (la règle n'a pas pu être simulée de ce côté). */
  compileErrors: { old?: string; new?: string };
  evaluated: number;
  changed: number;
  unchanged: number;
  newErrors: number;
  resolvedErrors: number;
  changedErrors: number;
  /** Pour les résultats numériques : plus grand écart absolu et écart moyen (chaînes décimales exactes). */
  maxAbsDelta?: string;
  meanDelta?: string;
  /** Pour les résultats non numériques (mentions, décisions) : transitions avant -> après. */
  transitions: Transition[];
}

export interface SimulationReport {
  oldVersion: { id: string; version: number };
  newVersion: { id: string; version: number };
  summary: {
    cases: number;
    rules: number;
    evaluations: number;
    changed: number;
    unchanged: number;
    newErrors: number;
    resolvedErrors: number;
    changedErrors: number;
    /** Part de résultats modifiés, en pourcentage arrondi à 2 décimales (chaîne décimale). */
    changedPercent: string;
  };
  rules: RuleSimulationStats[];
  differences: Difference[];
  truncated: boolean;
  /** Aucune différence de résultat, aucune règle ajoutée/retirée, aucune erreur de compilation. */
  identical: boolean;
}

type Compiled = { ok: true; rule: RuleDefinition; compiled: CompiledRule } | { ok: false; rule: RuleDefinition; message: string };

function compileAll(version: RuleVersion, opts: SimulationOptions, keys: ReadonlySet<string> | undefined): Map<string, Compiled> {
  const out = new Map<string, Compiled>();
  for (const rule of version.rules) {
    if (keys && !keys.has(rule.key)) continue;
    try {
      const fallback = opts.schemas?.[rule.type] ?? opts.defaultSchema;
      out.set(rule.key, { ok: true, rule, compiled: compileRule(rule, fallback) });
    } catch (e) {
      out.set(rule.key, { ok: false, rule, message: e instanceof RuleError ? e.message : String(e) });
    }
  }
  return out;
}

function run(c: Compiled, ctx: EvalContext, opts: SimulationOptions): Outcome {
  if (!c.ok) return { status: 'error', code: 'COMPILATION', message: c.message };
  try {
    const res = evaluate(c.compiled, contextWithParameters(c.rule, ctx), { trace: false, ...(opts.budget ? { budget: opts.budget } : {}) });
    return { status: 'ok', type: res.type, value: res.json };
  } catch (e) {
    if (e instanceof RuleError) return { status: 'error', code: e.code, message: e.message };
    throw e;
  }
}

const same = (a: Outcome, b: Outcome): boolean => {
  if (a.status === 'ok' && b.status === 'ok') {
    if (a.type !== b.type) return false;
    if (a.type === 'number') return new Decimal(a.value as string).eq(new Decimal(b.value as string));
    return a.value === b.value;
  }
  if (a.status === 'error' && b.status === 'error') return a.code === b.code && a.message === b.message;
  return a.status === b.status;
};

const display = (o: Outcome): string => {
  if (o.status === 'ok') return o.value === null ? '(absent)' : String(o.value);
  if (o.status === 'error') return `erreur ${o.code}`;
  return '(règle absente)';
};

interface Acc {
  stats: RuleSimulationStats;
  absSum: Decimal;
  sum: Decimal;
  max: Decimal;
  numericCount: number;
  trans: Map<string, Transition>;
}

/**
 * Compare deux versions de règles sur `dataset` et renvoie le rapport de
 * différences (par règle et détaillé par cas).
 */
export function simulate(
  oldVersion: RuleVersion,
  newVersion: RuleVersion,
  dataset: readonly SimulationCase[],
  options: SimulationOptions = {},
): SimulationReport {
  const keyFilter = options.ruleKeys ? new Set(options.ruleKeys) : undefined;
  const maxDiff = options.maxDifferences ?? 1000;
  const oldRules = compileAll(oldVersion, options, keyFilter);
  const newRules = compileAll(newVersion, options, keyFilter);
  const keys = [...new Set([...oldRules.keys(), ...newRules.keys()])].sort();

  const accs = new Map<string, Acc>();
  for (const key of keys) {
    const o = oldRules.get(key);
    const n = newRules.get(key);
    const stats: RuleSimulationStats = {
      key,
      presence: o && n ? 'both' : n ? 'added' : 'removed',
      compileErrors: {},
      evaluated: 0,
      changed: 0,
      unchanged: 0,
      newErrors: 0,
      resolvedErrors: 0,
      changedErrors: 0,
      transitions: [],
    };
    if (o && !o.ok) stats.compileErrors.old = o.message;
    if (n && !n.ok) stats.compileErrors.new = n.message;
    accs.set(key, { stats, absSum: new Decimal(0), sum: new Decimal(0), max: new Decimal(0), numericCount: 0, trans: new Map() });
  }

  const differences: Difference[] = [];
  let truncated = false;
  const total = { evaluations: 0, changed: 0, unchanged: 0, newErrors: 0, resolvedErrors: 0, changedErrors: 0 };

  for (const item of dataset) {
    for (const key of keys) {
      const o = oldRules.get(key);
      const n = newRules.get(key);
      if (!o || !n) continue; // règle ajoutée ou retirée : pas de comparaison par cas
      const acc = accs.get(key) as Acc;
      const oldOut = run(o, item.context, options);
      const newOut = run(n, item.context, options);
      acc.stats.evaluated++;
      total.evaluations++;

      if (same(oldOut, newOut)) {
        acc.stats.unchanged++;
        total.unchanged++;
        continue;
      }
      let kind: DifferenceKind;
      if (oldOut.status === 'ok' && newOut.status === 'ok') kind = 'value_changed';
      else if (oldOut.status === 'ok') kind = 'error_introduced';
      else if (newOut.status === 'ok') kind = 'error_resolved';
      else kind = 'error_changed';

      acc.stats.changed++;
      total.changed++;
      if (kind === 'error_introduced') (acc.stats.newErrors++, total.newErrors++);
      if (kind === 'error_resolved') (acc.stats.resolvedErrors++, total.resolvedErrors++);
      if (kind === 'error_changed') (acc.stats.changedErrors++, total.changedErrors++);

      let delta: string | undefined;
      if (oldOut.status === 'ok' && newOut.status === 'ok' && oldOut.type === 'number' && newOut.type === 'number') {
        const d = new Decimal(newOut.value as string).minus(new Decimal(oldOut.value as string));
        delta = d.toString();
        acc.sum = acc.sum.plus(d);
        acc.absSum = acc.absSum.plus(d.abs());
        if (d.abs().gt(acc.max)) acc.max = d.abs();
        acc.numericCount++;
      } else {
        const t = `${display(oldOut)}\u0000${display(newOut)}`;
        const cur = acc.trans.get(t);
        if (cur) cur.count++;
        else acc.trans.set(t, { from: display(oldOut), to: display(newOut), count: 1 });
      }

      if (differences.length < maxDiff) {
        differences.push({
          caseId: item.id,
          ...(item.label !== undefined ? { caseLabel: item.label } : {}),
          ruleKey: key,
          kind,
          old: oldOut,
          new: newOut,
          ...(delta !== undefined ? { delta } : {}),
        });
      } else {
        truncated = true;
      }
    }
  }

  const rules: RuleSimulationStats[] = keys.map((key) => {
    const acc = accs.get(key) as Acc;
    if (acc.numericCount > 0) {
      acc.stats.maxAbsDelta = acc.max.toString();
      acc.stats.meanDelta = acc.sum.div(acc.numericCount).toDecimalPlaces(12).toString();
    }
    acc.stats.transitions = [...acc.trans.values()].sort((a, b) => b.count - a.count || (a.from + a.to).localeCompare(b.from + b.to));
    return acc.stats;
  });

  const structural = rules.some((r) => r.presence !== 'both' || r.compileErrors.old !== undefined || r.compileErrors.new !== undefined);
  return {
    oldVersion: { id: oldVersion.id, version: oldVersion.version },
    newVersion: { id: newVersion.id, version: newVersion.version },
    summary: {
      cases: dataset.length,
      rules: keys.length,
      evaluations: total.evaluations,
      changed: total.changed,
      unchanged: total.unchanged,
      newErrors: total.newErrors,
      resolvedErrors: total.resolvedErrors,
      changedErrors: total.changedErrors,
      changedPercent:
        total.evaluations === 0 ? '0' : new Decimal(total.changed).times(100).div(total.evaluations).toDecimalPlaces(2).toString(),
    },
    rules,
    differences,
    truncated,
    identical: total.changed === 0 && !structural,
  };
}
