/**
 * Fee : un frais du catalogue (inscription, scolarité, cantine…). Le MONTANT n'est
 * pas porté par le frais mais par ses barèmes (`FeeSchedule`), qui varient selon
 * l'établissement, le campus, le niveau, la filière, l'année et le type d'apprenant.
 */
import { err, ok, type CurrencyCode, type Result, type AppError, CURRENCIES } from "@ecoledigitale/kernel";
import { FinanceCode, validation } from "./errors";
import { isFeeCategory, type FeeCategory, type Uuid } from "./types";

export interface Fee {
  readonly id: Uuid;
  readonly code: string;
  readonly name: string;
  readonly category: FeeCategory;
  readonly description: string | null;
  readonly currency: CurrencyCode;
  readonly active: boolean;
}

export interface FeeDraft {
  code: string;
  name: string;
  category: string;
  description?: string | null;
  currency?: string;
}

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;

export function validateFeeDraft(draft: FeeDraft): Result<Omit<Fee, "id" | "active">, AppError> {
  const code = (draft.code ?? "").trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    return err(validation(FinanceCode.INVALID_INPUT, "Code de frais invalide (A-Z, 0-9, _ ou -, 40 caractères max).", "code"));
  }
  const name = (draft.name ?? "").trim();
  if (name.length === 0 || name.length > 200) {
    return err(validation(FinanceCode.INVALID_INPUT, "Le libellé du frais est requis (200 caractères max).", "name"));
  }
  if (!isFeeCategory(draft.category)) {
    return err(validation(FinanceCode.INVALID_INPUT, `Catégorie de frais inconnue : "${String(draft.category)}".`, "category"));
  }
  const currency = (draft.currency ?? "XOF") as CurrencyCode;
  if (!(currency in CURRENCIES)) {
    return err(validation(FinanceCode.INVALID_INPUT, `Devise inconnue : "${String(draft.currency)}".`, "currency"));
  }
  return ok({
    code,
    name,
    category: draft.category,
    description: draft.description?.trim() || null,
    currency,
  });
}
