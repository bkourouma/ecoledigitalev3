/**
 * Onboarding piloté par événements : un import terminé (`imports.run.completed`, spec 031) complète l'étape d'onboarding
 * qu'il réalise — « Importer les élèves » (`STUDENT_IMPORT`) ou « Importer les enseignants » (`TEACHERS`).
 *
 * Règles (pures, sans dépendance au module `imports` : seul le nom d'événement et la forme du payload sont partagés) :
 *  - seuls les importeurs `students` et `staff` correspondent à une étape ; les autres imports sont ignorés ;
 *  - l'étape est complétée si l'import a produit des données (créées, mises à jour ou déjà présentes) ; un import
 *    entièrement refusé ne marque rien ;
 *  - idempotent : une étape déjà résolue, un établissement déjà en production ou un onboarding absent ne sont pas des erreurs.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { createSystemContext } from "@ecoledigitale/kernel";
import type { OnboardingStepKey } from "@ecoledigitale/contracts/src/v2/tenancy";
import { completeOnboardingStep } from "./onboarding";
import type { TenancyDeps } from "./support";

export const IMPORT_RUN_COMPLETED = "imports.run.completed";

/** Importeur -> étape d'onboarding qu'il réalise. */
export const ONBOARDING_STEP_BY_IMPORTER: Readonly<Record<string, OnboardingStepKey>> = Object.freeze({
  students: "STUDENT_IMPORT",
  staff: "TEACHERS",
});

export interface ImportCompletedPayload {
  importerKey?: unknown;
  created?: unknown;
  updated?: unknown;
  skipped?: unknown;
}

/** Étape à compléter pour ce payload, ou `null` (importeur sans étape, ou import sans donnée). */
export function onboardingStepForImport(payload: ImportCompletedPayload): OnboardingStepKey | null {
  if (typeof payload.importerKey !== "string") return null;
  const step = ONBOARDING_STEP_BY_IMPORTER[payload.importerKey];
  if (!step) return null;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return n(payload.created) + n(payload.updated) + n(payload.skipped) > 0 ? step : null;
}

/** Codes d'erreur d'onboarding qui signifient « rien à faire » (idempotence). */
const BENIGN = new Set(["tenancy.onboarding.step_already_resolved", "tenancy.onboarding.already_live", "tenancy.onboarding_not_found"]);

export type OnboardingEventOutcome = { marked: OnboardingStepKey } | { ignored: "no_step" | "already_resolved" | "onboarding_unavailable" };

export async function completeOnboardingOnImport(deps: TenancyDeps, tenantId: string, payload: ImportCompletedPayload, ctx: RequestContext = createSystemContext(tenantId)): Promise<OnboardingEventOutcome> {
  const step = onboardingStepForImport(payload);
  if (!step) return { ignored: "no_step" };
  const r = await completeOnboardingStep(deps, ctx, step);
  if (r.ok) return { marked: step };
  if (BENIGN.has(r.error.code)) return { ignored: r.error.code === "tenancy.onboarding.step_already_resolved" ? "already_resolved" : "onboarding_unavailable" };
  throw r.error;
}
