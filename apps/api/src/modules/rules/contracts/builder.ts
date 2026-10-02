/**
 * Constructeur partagé des contrats de la Phase 4-5 (`coef-period@1`, `competency-period@1`, `exam-national@1`,
 * `secondary-annual@1`). Même forme que les contrats historiques ; ce fichier ne contient AUCUNE règle.
 */
import type { ResultTypeSpec, RuleSchemaSpec, RuleType } from "../engine";
import type { ContractParameter, ContractRule } from "./types";

export const NO_PARAMETERS: Readonly<Record<string, ContractParameter>> = Object.freeze({});

export interface RuleOptions {
  readonly outputCodes?: readonly string[];
  readonly optional?: boolean;
  readonly parameters?: Readonly<Record<string, ContractParameter>>;
}

export function contractRule(key: string, type: RuleType, inputs: RuleSchemaSpec, result: ResultTypeSpec, description: string, options: RuleOptions = {}): ContractRule {
  return Object.freeze({
    key,
    type,
    optional: options.optional ?? false,
    inputs,
    result,
    outputCodes: Object.freeze([...(options.outputCodes ?? [])]),
    parameters: options.parameters ?? NO_PARAMETERS,
    description,
  });
}
