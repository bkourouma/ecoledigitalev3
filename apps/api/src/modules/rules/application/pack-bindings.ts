/**
 * Liaisons par défaut des packs vers les jeux de règles FICTIFS (spec 005 `pack-template.md` §4, spec 006 §6.4, spec 018 §4).
 *
 * Données, pas règles : chaque entrée associe un pack (et un niveau d'éducation d'`academic`) à un contrat et au jeu de démonstration
 * qui l'exerce. `applyPackPlaceholderBindings` les pose pour un établissement ; en PRODUCTION la liaison d'un jeu fictif est refusée
 * sans accusé explicite (`rules.placeholder_requires_ack`), comme pour une liaison manuelle. Quand le jeu officiel est publié, la
 * liaison est REMPLACÉE par une nouvelle liaison datée : aucun résultat antérieur n'est recalculé (versions épinglées).
 *
 * Aucun abonné n'appelle cette fonction d'office : c'est le module du pack (primary_school, councils, examinations…) ou l'assistant
 * de mise en route qui la déclenche, avec la date d'effet voulue.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { COEF_PERIOD_ID } from "../contracts/coef-period";
import { COMPETENCY_PERIOD_ID } from "../contracts/competency-period";
import { EXAM_NATIONAL_ID } from "../contracts/exam-national";
import { SECONDARY_ANNUAL_ID } from "../contracts/secondary-annual";
import type { BindingRecord } from "../domain/types";
import type { RulesDeps } from "./deps";
import { putBinding } from "./bindings";

export type PackBindingKey = "PRIMARY" | "SECONDARY" | "EXAMINATIONS";

export interface PackDefaultBinding {
  readonly contractId: string;
  readonly ruleSetCode: string;
  /** Code du niveau d'éducation d'`academic` visé (`null` : tout l'établissement). */
  readonly levelCode: string | null;
}

export const PACK_PLACEHOLDER_BINDINGS: Readonly<Record<PackBindingKey, readonly PackDefaultBinding[]>> = Object.freeze({
  PRIMARY: Object.freeze([
    { contractId: COEF_PERIOD_ID, ruleSetCode: "CI-PRIMARY-PLACEHOLDER", levelCode: "PRIMARY" },
    { contractId: COMPETENCY_PERIOD_ID, ruleSetCode: "CI-PRIMARY-PLACEHOLDER", levelCode: "PRESCHOOL" },
  ]),
  SECONDARY: Object.freeze([
    { contractId: SECONDARY_ANNUAL_ID, ruleSetCode: "CI-SECONDARY-PLACEHOLDER", levelCode: "LOWER_SECONDARY" },
    { contractId: SECONDARY_ANNUAL_ID, ruleSetCode: "CI-SECONDARY-PLACEHOLDER", levelCode: "UPPER_SECONDARY" },
  ]),
  EXAMINATIONS: Object.freeze([{ contractId: EXAM_NATIONAL_ID, ruleSetCode: "CI-EXAM-PLACEHOLDER", levelCode: null }]),
});

export interface ApplyPackBindingsInput {
  readonly pack: PackBindingKey;
  readonly institutionId?: string | undefined;
  /** « AAAA-MM-JJ » : début de l'année courante (jamais l'horloge). */
  readonly effectiveFrom: string;
  /** Accusé explicite, exigé en production (porté par un utilisateur ayant la permission sensible dédiée). */
  readonly placeholderAck?: { readonly reason: string } | undefined;
}

/** Pose les liaisons par défaut du pack (idempotent : même identité ⇒ mise à jour). S'arrête à la première erreur (rien d'autre n'est annulé : une liaison est une donnée datée). */
export async function applyPackPlaceholderBindings(deps: RulesDeps, ctx: RequestContext, input: ApplyPackBindingsInput): Promise<Result<BindingRecord[], AppError>> {
  const out: BindingRecord[] = [];
  for (const b of PACK_PLACEHOLDER_BINDINGS[input.pack]) {
    const r = await putBinding(deps, ctx, {
      contractId: b.contractId,
      ruleSetCode: b.ruleSetCode,
      ...(b.levelCode ? { levelCode: b.levelCode } : {}),
      ...(input.institutionId ? { institutionId: input.institutionId } : {}),
      effectiveFrom: input.effectiveFrom,
      ...(input.placeholderAck ? { placeholderAck: input.placeholderAck } : {}),
    });
    if (!r.ok) return err(r.error);
    out.push(r.value);
  }
  return ok(out);
}
