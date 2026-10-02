/**
 * Modèle de pack de la section `finance` (spec 005 `pack-template.md` §8, spec 006 §7.4) : des CATÉGORIES de frais, en
 * libellés seulement.
 *
 *  - `REGISTRATION` (frais d'inscription, séparés de la scolarité : décision métier 2026-10-01 — la confirmation d'une
 *    inscription suit leur paiement) et `TUITION` (scolarité) ;
 *  - AUCUN montant, AUCUN barème, AUCUN échéancier : l'établissement les saisit ; `finance` reste le seul propriétaire des
 *    montants (`Money`, entiers). Un frais sans barème n'est jamais « dû » (`isRegistrationFeeDue` reste `false`).
 *
 * Fonctions PURES. Les packs sans entrée (`HIGHER`, `VIRTUAL`) ne reçoivent rien : leurs frais sont ceux de l'établissement.
 */
import type { FeeCategory } from "./types";

export interface PackFeeTemplate {
  readonly code: string;
  readonly name: string;
  readonly category: FeeCategory;
}

export type FinancePackKey = "PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL";

const REGISTRATION_AND_TUITION: readonly PackFeeTemplate[] = Object.freeze([
  { code: "REGISTRATION", name: "Frais d'inscription", category: "REGISTRATION" },
  { code: "TUITION", name: "Scolarité", category: "TUITION" },
]);

/** Catégories de frais par pack : libellés uniquement, aucun montant. */
export const FINANCE_PACK_TEMPLATES: Readonly<Record<FinancePackKey, readonly PackFeeTemplate[]>> = Object.freeze({
  PRIMARY: REGISTRATION_AND_TUITION,
  SECONDARY: REGISTRATION_AND_TUITION,
  HIGHER: Object.freeze([]),
  VIRTUAL: Object.freeze([]),
});

/** Frais du modèle d'un pack (liste vide pour un pack inconnu ou sans modèle). */
export function feeTemplatesForPack(pack: string): readonly PackFeeTemplate[] {
  return (FINANCE_PACK_TEMPLATES as Readonly<Record<string, readonly PackFeeTemplate[]>>)[pack] ?? [];
}
