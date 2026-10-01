import {
  compileRule,
  contextWithParameters,
  evaluate,
  type CompiledRule,
  type EvaluationResult,
  type RuleDefinition,
  type RuleVersion,
} from '../src';

/** Exécute les règles d'une RuleVersion (compilation mise en cache, paramètres par défaut). */
export function runner(version: RuleVersion) {
  const compiled = new Map<string, CompiledRule>();
  const rules = new Map<string, RuleDefinition>(version.rules.map((r) => [r.key, r]));

  const get = (key: string): { rule: RuleDefinition; c: CompiledRule } => {
    const rule = rules.get(key);
    if (!rule) throw new Error(`règle inconnue : ${key}`);
    let c = compiled.get(key);
    if (!c) {
      c = compileRule(rule);
      compiled.set(key, c);
    }
    return { rule, c };
  };

  const run = (key: string, variables: Record<string, unknown>, overrides?: Record<string, number | string | boolean>): EvaluationResult => {
    const { rule, c } = get(key);
    return evaluate(c, contextWithParameters(rule, { variables }, overrides));
  };

  return {
    run,
    /** Valeur JSON de la règle (nombre = chaîne décimale exacte). */
    value: (key: string, variables: Record<string, unknown>, overrides?: Record<string, number | string | boolean>) =>
      run(key, variables, overrides).json,
    compileAll: () => version.rules.map((r) => get(r.key).c),
  };
}

/** Générateur pseudo-aléatoire déterministe (LCG 32 bits) pour les tests différentiels. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
