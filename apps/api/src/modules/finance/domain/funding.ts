/**
 * Compte de l'apprenant : type de financement (PRD §20) et cohérence avec les
 * prises en charge enregistrées.
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
}

export function validateFundingType(value: unknown): Result<FundingType, AppError> {
  return isFundingType(value) ? ok(value) : err(validation(FinanceCode.INVALID_INPUT, "Type de financement inconnu.", "fundingType"));
}

/**
 * Le type de financement doit être soutenu par des prises en charge actives, pour
 * l'année facturée — sinon on facturerait la famille pour la part de l'État.
 */
export function checkFundingConsistency(
  account: Pick<LearnerAccount, "fundingType">,
  scholarships: ReadonlyArray<Scholarship>,
  academicYear: string,
): Result<true, AppError> {
  const active = scholarships.filter((s) => s.status === "ACTIVE" && s.academicYear === academicYear);
  switch (account.fundingType) {
    case "STATE_ASSIGNED":
      if (!hasActiveStateAssignment(scholarships, academicYear)) {
        return err(
          conflict(
            FinanceCode.FUNDING_ASSIGNMENT_MISSING,
            "Élève affecté par l'État sans prise en charge de l'État enregistrée pour cette année.",
            { fundingType: account.fundingType, academicYear },
          ),
        );
      }
      return ok(true);
    case "SCHOLARSHIP":
      if (active.length === 0) {
        return err(
          conflict(FinanceCode.FUNDING_ASSIGNMENT_MISSING, "Apprenant boursier sans bourse active pour cette année.", {
            fundingType: account.fundingType,
            academicYear,
          }),
        );
      }
      return ok(true);
    case "COMPANY":
      if (!active.some((s) => s.funderKind === "COMPANY")) {
        return err(
          conflict(FinanceCode.FUNDING_ASSIGNMENT_MISSING, "Apprenant financé par une entreprise sans prise en charge entreprise active.", {
            fundingType: account.fundingType,
            academicYear,
          }),
        );
      }
      return ok(true);
    default:
      return ok(true);
  }
}
