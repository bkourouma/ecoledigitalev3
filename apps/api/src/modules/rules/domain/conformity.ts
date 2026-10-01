/**
 * Conformité d'une version à son contrat (AC5.1) : toutes les clés obligatoires présentes, aucune règle
 * étrangère, type de règle identique, schémas d'entrée COMPATIBLES (mêmes champs, mêmes types, nullité au plus
 * aussi stricte que celle du contrat), type de résultat conforme, paramètres de « mode » dans leurs valeurs
 * permises, libellés ne portant que sur des codes connus, et compilation réussie de chaque expression.
 *
 * Une version qui ne satisfait pas son contrat ne peut pas être proposée ni approuvée. Fonction PURE.
 */
import {
  ParameterSpecSchema,
  effectiveRuleSchema,
  resolveSchema,
  validate,
  type Diagnostic,
  type RuleSchemaSpec,
  type TypeSpec,
} from "../engine";
import type { ContractParameter, ContractRule, RuleContract } from "../contracts";
import type { RuleDefinitionRecord } from "./types";

export interface RuleCheck {
  readonly key: string;
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly resultType: string | null;
}

export interface ContractViolationItem {
  readonly ruleKey: string | null;
  readonly code: string;
  readonly message: string;
}

export interface ConformityReport {
  readonly ok: boolean;
  readonly contractId: string;
  readonly rules: readonly RuleCheck[];
  readonly violations: readonly ContractViolationItem[];
}

/* ------------------------- compatibilité des schémas ------------------------- */

interface Shape {
  readonly kind: "number" | "string" | "boolean" | "list" | "object";
  readonly nullable: boolean;
  readonly item?: Shape;
  readonly fields?: Readonly<Record<string, Shape>>;
}

function shapeOf(spec: TypeSpec): Shape {
  if (typeof spec === "string") {
    const nullable = spec.endsWith("?");
    return { kind: (nullable ? spec.slice(0, -1) : spec) as "number" | "string" | "boolean", nullable };
  }
  if ("list" in spec) return { kind: "list", nullable: spec.nullable === true, item: shapeOf(spec.list) };
  return {
    kind: "object",
    nullable: spec.nullable === true,
    fields: Object.fromEntries(Object.entries(spec.object).map(([k, v]) => [k, shapeOf(v)])),
  };
}

/** Le type attendu par la règle (`rule`) est-il satisfait par la donnée que fournit le contrat (`contract`) ? */
function compatible(contract: Shape, rule: Shape, path: string, problems: string[]): void {
  if (contract.kind !== rule.kind) {
    problems.push(`${path} : type « ${rule.kind} » au lieu de « ${contract.kind} » (contrat)`);
    return;
  }
  // La règle ne peut pas exiger une donnée que le contrat déclare pouvoir être absente.
  if (contract.nullable && !rule.nullable) problems.push(`${path} : la donnée peut être absente dans le contrat, pas dans la règle`);
  if (contract.kind === "list" && contract.item && rule.item) compatible(contract.item, rule.item, `${path}[]`, problems);
  if (contract.kind === "object" && rule.fields) {
    for (const [name, child] of Object.entries(rule.fields)) {
      const base = contract.fields?.[name];
      if (!base) problems.push(`${path}.${name} : champ inconnu du contrat`);
      else compatible(base, child, `${path}.${name}`, problems);
    }
  }
}

export function inputSchemaProblems(contractInputs: RuleSchemaSpec, ruleInputs: RuleSchemaSpec): string[] {
  const problems: string[] = [];
  if (ruleInputs.lookups && Object.keys(ruleInputs.lookups).length > 0 && !(contractInputs.lookups && Object.keys(contractInputs.lookups).length > 0)) {
    problems.push("lookups : le contrat n'en fournit aucune");
  }
  for (const [name, spec] of Object.entries(ruleInputs.variables)) {
    const base = contractInputs.variables[name];
    if (base === undefined) problems.push(`${name} : variable inconnue du contrat`);
    else compatible(shapeOf(base), shapeOf(spec), name, problems);
  }
  return problems;
}

/** Résultat déclaré par la version : au moins aussi strict que celui du contrat (jamais plus permissif). */
function resultProblem(contractResult: string, declared: string): string | null {
  const [cBase, cNullable] = [contractResult.replace("?", ""), contractResult.endsWith("?")];
  const [dBase, dNullable] = [declared.replace("?", ""), declared.endsWith("?")];
  if (cBase !== dBase) return `type de résultat « ${declared} » au lieu de « ${contractResult} »`;
  if (dNullable && !cNullable) return `le résultat « ${declared} » peut être absent alors que le contrat exige « ${contractResult} »`;
  return null;
}

/* ------------------------------ paramètres ------------------------------ */

/** Valeur admise par le contrat pour un paramètre de mode ? */
export function parameterAllowed(constraint: ContractParameter, value: string | number | boolean): boolean {
  if (typeof value !== constraint.type) return false;
  return constraint.allowed === undefined || constraint.allowed.includes(value as string | number);
}

function parameterProblems(rule: RuleDefinitionRecord, contractRule: ContractRule): ContractViolationItem[] {
  const out: ContractViolationItem[] = [];
  for (const [name, spec] of Object.entries(rule.parameters)) {
    const parsed = ParameterSpecSchema.safeParse(spec);
    if (!parsed.success) {
      out.push({ ruleKey: rule.key, code: "parameter_invalid", message: `Paramètre « ${name} » invalide : ${parsed.error.issues[0]?.message ?? "structure inattendue"}` });
      continue;
    }
    const constraint = contractRule.parameters[name];
    if (constraint) {
      if (spec.type !== constraint.type) {
        out.push({ ruleKey: rule.key, code: "parameter_type", message: `Paramètre « ${name} » : type « ${spec.type} » au lieu de « ${constraint.type} » (contrat).` });
      } else if (!parameterAllowed(constraint, spec.default)) {
        out.push({
          ruleKey: rule.key,
          code: "parameter_value",
          message: `Paramètre « ${name} » : la valeur « ${String(spec.default)} » n'est pas permise par le contrat (${(constraint.allowed ?? []).join(", ")}).`,
        });
      }
    }
  }
  return out;
}

/* ------------------------------- rapport ------------------------------- */

export function checkConformity(contract: RuleContract, rules: readonly RuleDefinitionRecord[]): ConformityReport {
  const violations: ContractViolationItem[] = [];
  const checks: RuleCheck[] = [];
  const byKey = new Map(rules.map((r) => [r.key, r]));
  const contractByKey = new Map(contract.rules.map((r) => [r.key, r]));

  for (const cr of contract.rules) {
    if (!cr.optional && !byKey.has(cr.key)) {
      violations.push({ ruleKey: cr.key, code: "missing_rule", message: `La règle obligatoire « ${cr.key} » du contrat ${contract.id} est absente.` });
    }
  }

  for (const rule of rules) {
    const cr = contractByKey.get(rule.key);
    if (!cr) {
      violations.push({ ruleKey: rule.key, code: "unknown_rule", message: `La règle « ${rule.key} » n'existe pas dans le contrat ${contract.id}.` });
      checks.push({ key: rule.key, ok: false, diagnostics: [], resultType: null });
      continue;
    }
    if (rule.type !== cr.type) {
      violations.push({ ruleKey: rule.key, code: "type_mismatch", message: `La règle « ${rule.key} » est de type « ${rule.type} » au lieu de « ${cr.type} » (contrat).` });
    }
    if (rule.inputSchema) {
      for (const p of inputSchemaProblems(cr.inputs, rule.inputSchema)) {
        violations.push({ ruleKey: rule.key, code: "input_schema_incompatible", message: `Schéma d'entrée incompatible — ${p}.` });
      }
    }
    if (rule.resultType) {
      const p = resultProblem(cr.result, rule.resultType);
      if (p) violations.push({ ruleKey: rule.key, code: "result_type_mismatch", message: `Règle « ${rule.key} » : ${p}.` });
    }
    violations.push(...parameterProblems(rule, cr));
    if (cr.outputCodes.length > 0) {
      for (const code of Object.keys(rule.labelMap)) {
        if (!cr.outputCodes.includes(code)) {
          violations.push({ ruleKey: rule.key, code: "unknown_label_code", message: `Règle « ${rule.key} » : le libellé porte sur « ${code} », code inconnu du contrat.` });
        }
      }
    }

    // Compilation (noms, types, nullité, type de résultat attendu).
    let diagnostics: Diagnostic[] = [];
    let resultType: string | null = null;
    try {
      const declaredInputs = rule.inputSchema ?? cr.inputs;
      const schema = effectiveRuleSchema({ key: rule.key, type: rule.type, expression: rule.expression, parameters: rule.parameters, inputSchema: declaredInputs }, cr.inputs);
      resolveSchema(schema);
      const expect = rule.resultType ?? cr.result;
      const report = validate(rule.expression, schema, { expect });
      diagnostics = report.diagnostics;
      resultType = report.resultType ? `${report.resultType.type}${report.resultType.nullable ? "?" : ""}` : null;
    } catch (e) {
      const d = (e as { toDiagnostic?: () => Diagnostic }).toDiagnostic;
      diagnostics = [d ? d.call(e) : { code: "SCHEMA_INVALIDE", phase: "schema", message: e instanceof Error ? e.message : String(e) }];
    }
    checks.push({ key: rule.key, ok: diagnostics.length === 0, diagnostics, resultType });
  }

  const ok = violations.length === 0 && checks.every((c) => c.ok);
  return { ok, contractId: contract.id, rules: checks, violations };
}
