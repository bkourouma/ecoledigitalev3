/**
 * Domaine : entités et règles PURES. Aucun import de pg, fastify ou d'infrastructure
 * (imposé par pnpm check:boundaries).
 */
import { ValidationError, err, ok, type Result } from "@ecoledigitale/kernel";

export interface Item {
  id: string;
  tenantId: string;
  label: string;
  createdAt: Date;
}

/** Longueur maximale du libellé (contrainte de saisie, pas une règle réglementaire). */
export const ITEM_LABEL_MAX = 200;

/** Normalise (espaces) et valide le libellé d'un élément. */
export function normalizeLabel(raw: unknown): Result<string, ValidationError> {
  const label = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (label.length === 0) return err(ValidationError.field("label", "Le libellé est obligatoire.", "label_required"));
  if (label.length > ITEM_LABEL_MAX) {
    return err(ValidationError.field("label", "Le libellé est trop long.", "label_too_long"));
  }
  return ok(label);
}
