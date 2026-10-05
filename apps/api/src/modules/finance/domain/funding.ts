/**
 * Compte de l'apprenant : type de financement (PRD §20) et cohérence avec les
 * prises en charge enregistrées.
 *
 * Cumul (O-04) : `fundingType` reste le type PRINCIPAL (lu tel quel par les consommateurs) ; `additionalFundingTypes` liste les
 * autres types qui s'y ajoutent (ex. principal `STATE_ASSIGNED` + `SCHOLARSHIP`). Chacun doit être soutenu par une prise en
 * charge active pour l'année facturée.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, validation } from "./errors";
import { hasActiveStateAssignment, type Scholarship } from "./scholarship";
import { isFundingType, type FundingType, type Uuid } from "./types";

export interface LearnerAccount {
  readonly learnerId: Uuid;
  readonly fundingType: FundingType;
  /** Référence d'affectation (élèves `STATE_ASSIGNED`). */
  readonly assignmentRef: string | null;
  /** Types de financement CUMULÉS avec le type principal (absent / vide : financement unique, comportement historique). */
  readonly additionalFundingTypes?: ReadonlyArray<FundingType>;
}

export function validateFundingType(value: unknown): Result<FundingType, AppError> {
  return isFundingType(value) ? ok(value) : err(validation(FinanceCode.INVALID_INPUT, "Type de financement inconnu.", "fundingType"));
}

/** Types cumulés : valides, distincts du principal et entre eux, jamais « privé » (le reste de la famille est implicite). */
export function validateAdditionalFundingTypes(principal: FundingType, values: unknown): Result<FundingType[], AppError> {
  if (values === undefined || values === null) return ok([]);
  if (!Array.isArray(values)) return err(validation(FinanceCode.INVALID_INPUT, "Les financements cumulés forment une liste.", "additionalFundingTypes"));
  const out: FundingType[] = [];
  for (const v of values) {
    if (!isFundingType(v)) return err(validation(FinanceCode.INVALID_INPUT, "Type de financement cumulé inconnu.", "additionalFundingTypes"));
    if (v === "PRIVATE") return err(validation(FinanceCode.INVALID_INPUT, "« Privé » n'est pas un financement cumulable : le reste est à la charge de la famille.", "additionalFundingTypes"));
    if (v === principal || out.includes(v)) return err(validation(FinanceCode.INVALID_INPUT, "Un type de financement ne figure qu'une fois.", "additionalFundingTypes"));
    out.push(v);
  }
  return ok(out);
}

/** Tous les types de financement du compte : le principal puis les cumulés. */
export const fundingTypesOf = (account: Pick<LearnerAccount, "fundingType" | "additionalFundingTypes">): FundingType[] => [
  account.fundingType,
  ...(account.additionalFundingTypes ?? []).filter((t) => t !== account.fundingType),
];

function checkOne(fundingType: FundingType, scholarships: ReadonlyArray<Scholarship>, academicYear: string, cumulated = false): Result<true, AppError> {
  const active = scholarships.filter((s) => s.status === "ACTIVE" && s.academicYear === academicYear);
  switch (fundingType) {
    case "STATE_ASSIGNED":
      if (!hasActiveStateAssignment(scholarships, academicYear)) {
        return err(
          conflict(
            FinanceCode.FUNDING_ASSIGNMENT_MISSING,
            "Élève affecté par l'État sans prise en charge de l'État enregistrée pour cette année.",
            { fundingType, academicYear },
          ),
        );
      }
      return ok(true);
    case "SCHOLARSHIP":
      // Historique : toute bourse active suffit. En cumul avec un autre type, la bourse est une AUTRE prise en charge que celle de l'État.
      if (cumulated ? !active.some((s) => s.funderKind !== "STATE") : active.length === 0) {
        return err(
          conflict(FinanceCode.FUNDING_ASSIGNMENT_MISSING, "Apprenant boursier sans bourse active pour cette année.", {
            fundingType,
            academicYear,
          }),
        );
      }
      return ok(true);
    case "COMPANY":
      if (!active.some((s) => s.funderKind === "COMPANY")) {
        return err(
          conflict(FinanceCode.FUNDING_ASSIGNMENT_MISSING, "Apprenant financé par une entreprise sans prise en charge entreprise active.", {
            fundingType,
            academicYear,
          }),
        );
      }
      return ok(true);
    default:
      return ok(true);
  }
}

/**
 * Chaque type de financement du compte (principal et cumulés) doit être soutenu par des prises en charge actives, pour l'année
 * facturée — sinon on facturerait la famille pour la part de l'État.
 */
export function checkFundingConsistency(
  account: Pick<LearnerAccount, "fundingType"> & Partial<Pick<LearnerAccount, "additionalFundingTypes">>,
  scholarships: ReadonlyArray<Scholarship>,
  academicYear: string,
): Result<true, AppError> {
  const [principal, ...cumulated] = fundingTypesOf(account);
  for (const t of [principal!, ...cumulated]) {
    const r = checkOne(t, scholarships, academicYear, t !== principal);
    if (!r.ok) return r;
  }
  return ok(true);
}
