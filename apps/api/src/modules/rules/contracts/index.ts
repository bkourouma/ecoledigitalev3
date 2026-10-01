/**
 * Catalogue des contrats de règles (en CODE, versionnés). Un nouveau contrat `@2` coexiste avec `@1` : les
 * RuleVersions déclarent le contrat qu'elles satisfont et ne sont jamais invalidées par l'arrivée d'une nouvelle version.
 */
import { coefSemesterContract } from "./coef-semester";
import { creditSemesterContract } from "./credit-semester";
import type { ContractRule, RuleContract } from "./types";

export * from "./types";
export {
  CREDIT_SEMESTER_ID,
  CREDIT_SEMESTER_RULES,
  creditSemesterContract,
  ECUE_STATUS_CODES,
  UE_STATE_CODES,
  SEMESTER_DECISION_CODES,
  MENTION_CODES,
  COUNCIL_APPRECIATION_CODES,
  SEMESTER_DISTINCTION_CODES,
  SESSION2_MODES,
  SEMESTER_VALIDATION_MODES,
  YEAR_VALIDATION_MODES,
} from "./credit-semester";
export {
  COEF_SEMESTER_ID,
  COEF_SEMESTER_RULES,
  coefSemesterContract,
  COUNCIL_DECISION_CODES,
  END_OF_YEAR_DECISION_CODES,
  DISTINCTION_CODES,
} from "./coef-semester";

const CONTRACTS: ReadonlyMap<string, RuleContract> = new Map([creditSemesterContract, coefSemesterContract].map((c) => [c.id, c]));

/** Contrat connu par son identifiant (`credit-semester@1`), sinon `undefined`. */
export function getContract(id: string): RuleContract | undefined {
  return CONTRACTS.get(id);
}

export function listContracts(): readonly RuleContract[] {
  return [...CONTRACTS.values()];
}

export function contractRule(contract: RuleContract, key: string): ContractRule | undefined {
  return contract.rules.find((r) => r.key === key);
}
