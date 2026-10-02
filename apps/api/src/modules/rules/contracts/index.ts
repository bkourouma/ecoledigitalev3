/**
 * Catalogue des contrats de règles (en CODE, versionnés). Un nouveau contrat `@2` coexiste avec `@1` : les
 * RuleVersions déclarent le contrat qu'elles satisfont et ne sont jamais invalidées par l'arrivée d'une nouvelle version.
 */
import { coefPeriodContract } from "./coef-period";
import { coefSemesterContract } from "./coef-semester";
import { competencyPeriodContract } from "./competency-period";
import { creditSemesterContract } from "./credit-semester";
import { examNationalContract } from "./exam-national";
import { secondaryAnnualContract } from "./secondary-annual";
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

export {
  COEF_PERIOD_ID,
  COEF_PERIOD_RULES,
  coefPeriodContract,
  COUNCIL_REASON_CODES,
  PERIOD_YEAR_DECISION_CODES,
} from "./coef-period";
export { COMPETENCY_PERIOD_ID, COMPETENCY_PERIOD_RULES, COMPETENCY_YEAR_DECISION_CODES, competencyPeriodContract } from "./competency-period";
export {
  CANDIDATE_RESULT_CODES,
  ELIGIBILITY_CODES,
  ELIGIBILITY_REASON_CODES,
  EXAM_MENTION_CODES,
  EXAM_NATIONAL_ID,
  EXAM_NATIONAL_RULES,
  examNationalContract,
} from "./exam-national";
export { SECONDARY_ANNUAL_ID, SECONDARY_ANNUAL_RULES, secondaryAnnualContract } from "./secondary-annual";

const CONTRACTS: ReadonlyMap<string, RuleContract> = new Map(
  [creditSemesterContract, coefSemesterContract, coefPeriodContract, competencyPeriodContract, examNationalContract, secondaryAnnualContract].map((c) => [c.id, c]),
);

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
