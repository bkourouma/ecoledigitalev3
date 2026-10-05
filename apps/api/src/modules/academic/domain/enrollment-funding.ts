/**
 * Cumul de financements d'une inscription (O-04) : plusieurs sources en même temps (bourse + État + famille…), chacune avec sa
 * PART — un pourcentage (points de base) ou un montant entier. Le reste est à la charge de la famille (financement privé implicite).
 *
 * Règles pures (aucun accès base) ; les mêmes contrôles sont imposés par le déclencheur `enrollment_fundings_guard` (0710).
 * Le type PRINCIPAL de l'inscription (`enrollments.funding_type`) reste lu par les modules voisins : il se déduit du cumul.
 */
import type { AppError } from "@ecoledigitale/kernel";
import { AcademicCode, validation } from "./errors";
import { normalizeFunding, validateFunding } from "./enrollment";
import type { FundingType } from "./records";

export const MAX_FUNDING_SHARES = 6;
export const FULL_SHARE_BPS = 10_000;
export const FUNDING_CURRENCIES = ["XOF", "XAF", "EUR", "USD"] as const;

export type FundingShare =
  | { readonly kind: "PERCENT"; readonly bps: number }
  | { readonly kind: "AMOUNT"; readonly amount: number; readonly currency: string };

export interface FundingShareInput {
  readonly fundingType: string;
  readonly share: FundingShare;
  readonly funderLabel?: string | null | undefined;
  readonly assignmentReference?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

export interface EnrollmentFunding {
  readonly id: string;
  readonly enrollmentId: string;
  readonly fundingType: string;
  readonly share: FundingShare;
  readonly funderLabel: string | null;
  readonly assignmentReference: string | null;
  readonly notes: string | null;
  readonly status: "ACTIVE" | "ENDED";
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly endedAt: Date | null;
}

const identityOf = (s: Pick<FundingShareInput, "fundingType" | "funderLabel" | "assignmentReference">): string =>
  `${s.fundingType}|${s.funderLabel?.trim() ?? ""}|${s.assignmentReference?.trim() ?? ""}`;

/** Somme des parts en pourcentage (points de base). */
export const percentTotal = (shares: ReadonlyArray<{ share: FundingShare }>): number =>
  shares.reduce((s, x) => s + (x.share.kind === "PERCENT" ? x.share.bps : 0), 0);

/** Pourcentage laissé à la famille quand toutes les parts sont en pourcentage ; `null` si une part en montant intervient (inconnu sans la facture). */
export function familyRemainderBps(shares: ReadonlyArray<{ share: FundingShare }>): number | null {
  if (shares.some((s) => s.share.kind === "AMOUNT")) return null;
  return FULL_SHARE_BPS - percentTotal(shares);
}

/**
 * Valide un cumul COMPLET (remplacement atomique). `defs` : types de financement du tenant. Retourne la première erreur, ou `null`.
 */
export function validateFundingShares(defs: ReadonlyArray<FundingType>, inputs: ReadonlyArray<FundingShareInput>): AppError | null {
  if (inputs.length > MAX_FUNDING_SHARES) {
    return validation(AcademicCode.FUNDING_SHARES_INVALID, `Un cumul compte au plus ${MAX_FUNDING_SHARES} financements.`, "shares");
  }
  const seen = new Set<string>();
  let bps = 0;
  let currency: string | null = null;
  for (const [i, input] of inputs.entries()) {
    const path = `shares.${i}`;
    if (input.fundingType === "PRIVATE") {
      return validation(AcademicCode.FUNDING_SHARES_INVALID, "Le reste à la charge de la famille est implicite : « privé » n'est pas une part.", `${path}.fundingType`);
    }
    const def = defs.find((d) => d.code === input.fundingType);
    const problem = validateFunding(def, {
      fundingType: input.fundingType,
      assignmentReference: input.assignmentReference ?? null,
      funderLabel: input.funderLabel ?? null,
    });
    if (problem) return problem;
    const share = input.share;
    if (share.kind === "PERCENT") {
      if (!Number.isInteger(share.bps) || share.bps < 1 || share.bps > FULL_SHARE_BPS) {
        return validation(AcademicCode.FUNDING_SHARES_INVALID, "Une part en pourcentage est comprise entre 0,01 % et 100 % (points de base entiers).", `${path}.share`);
      }
      bps += share.bps;
    } else {
      if (!Number.isInteger(share.amount) || share.amount < 1) {
        return validation(AcademicCode.FUNDING_SHARES_INVALID, "Une part en montant est un entier strictement positif.", `${path}.share`);
      }
      if (!(FUNDING_CURRENCIES as readonly string[]).includes(share.currency)) {
        return validation(AcademicCode.FUNDING_SHARES_INVALID, "Devise inconnue pour une part en montant.", `${path}.share.currency`);
      }
      if (currency !== null && currency !== share.currency) {
        return validation(AcademicCode.FUNDING_CURRENCY_MISMATCH, "Les parts en montant d'une inscription partagent la même devise.", `${path}.share.currency`);
      }
      currency = share.currency;
    }
    const norm = normalizeFunding({ fundingType: input.fundingType, assignmentReference: input.assignmentReference ?? null, funderLabel: input.funderLabel ?? null });
    const key = identityOf({ fundingType: input.fundingType, funderLabel: norm.funderLabel, assignmentReference: norm.assignmentReference });
    if (seen.has(key)) {
      return validation(AcademicCode.FUNDING_SHARES_INVALID, "Un même financement (type, financeur, référence) ne peut figurer qu'une fois.", path);
    }
    seen.add(key);
  }
  if (bps > FULL_SHARE_BPS) {
    return validation(AcademicCode.FUNDING_SHARES_EXCEED, `La somme des parts en pourcentage dépasse 100 % (${(bps / 100).toFixed(2)} %).`, "shares", { totalBps: bps });
  }
  return null;
}

/**
 * Type PRINCIPAL déduit du cumul : la plus grande part en pourcentage, sinon le plus grand montant ; à égalité, l'ordre de saisie.
 * `null` : cumul vide (l'inscription redevient financée par la famille seule).
 */
export function principalOf<T extends FundingShareInput>(shares: ReadonlyArray<T>): T | null {
  if (shares.length === 0) return null;
  const rank = (s: FundingShare): number => (s.kind === "PERCENT" ? 1_000_000_000_000 + s.bps : s.amount);
  let best = shares[0]!;
  for (const s of shares.slice(1)) if (rank(s.share) > rank(best.share)) best = s;
  return best;
}
