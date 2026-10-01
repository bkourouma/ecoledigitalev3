/**
 * Machine d'états d'onboarding (PRD §56) — PURE : aucun import pg / fastify.
 *
 * Étapes, dans l'ordre du PRD :
 *   ACCOUNT, INSTITUTION, COUNTRY, INSTITUTION_TYPE, PACK, ACADEMIC_YEAR,
 *   STUDENT_IMPORT*, CLASSES, TEACHERS*, FINANCE*, GO_LIVE        (* = facultative)
 *
 * Règles :
 *  - une étape obligatoire ne peut être terminée que si TOUTES les étapes
 *    obligatoires qui la précèdent le sont (pas d'année scolaire sans pack) ;
 *  - une étape facultative n'est jamais bloquante et peut être ignorée (SKIPPED) ;
 *  - une étape facultative peut être terminée à tout moment, même avant ses
 *    voisines (l'import d'élèves peut précéder la création des classes) ;
 *  - GO_LIVE exige que toutes les autres étapes soient résolues (terminées, ou
 *    ignorées si facultatives) ; GO_LIVE n'est jamais ignorable ;
 *  - une étape terminée ne se « re-termine » pas (idempotence explicite : erreur
 *    `tenancy.onboarding.step_already_resolved`), et une étape ignorée peut
 *    ensuite être terminée.
 *
 * La mise en production (`GO_LIVE` terminée) est l'état terminal : plus aucune
 * transition n'est acceptée.
 */
import { ConflictError, ValidationError, err, ok, type Result } from "@ecoledigitale/kernel";
import {
  ONBOARDING_STEP_KEYS,
  type OnboardingState,
  type OnboardingStepKey,
  type OnboardingStepStatus,
} from "@ecoledigitale/contracts/src/v2/tenancy";

export interface OnboardingStepDef {
  readonly key: OnboardingStepKey;
  readonly order: number;
  readonly optional: boolean;
}

/** Étapes facultatives : elles ne bloquent ni les suivantes ni, une fois ignorées, le GO_LIVE. */
const OPTIONAL_STEPS: ReadonlySet<OnboardingStepKey> = new Set(["STUDENT_IMPORT", "TEACHERS", "FINANCE"]);

/** Étapes accomplies par le provisioning lui-même (compte, établissement, pays, type, pack). */
export const PROVISIONING_STEPS: readonly OnboardingStepKey[] = [
  "ACCOUNT",
  "INSTITUTION",
  "COUNTRY",
  "INSTITUTION_TYPE",
  "PACK",
];

export const ONBOARDING_STEP_DEFS: readonly OnboardingStepDef[] = ONBOARDING_STEP_KEYS.map((key, order) => ({
  key,
  order,
  optional: OPTIONAL_STEPS.has(key),
}));

const DEF_BY_KEY: ReadonlyMap<OnboardingStepKey, OnboardingStepDef> = new Map(
  ONBOARDING_STEP_DEFS.map((d) => [d.key, d]),
);

export interface StepRecord {
  readonly key: OnboardingStepKey;
  readonly status: OnboardingStepStatus;
  readonly completedAt: Date | null;
}

export type OnboardingAction = "complete" | "skip";

export function isOnboardingStepKey(value: string): value is OnboardingStepKey {
  return DEF_BY_KEY.has(value as OnboardingStepKey);
}

/** Toutes les étapes en attente. */
export function initialSteps(): StepRecord[] {
  return ONBOARDING_STEP_DEFS.map((d) => ({ key: d.key, status: "PENDING", completedAt: null }));
}

/** Normalise une liste partielle (lignes manquantes = PENDING) dans l'ordre canonique. */
export function normalizeSteps(records: readonly StepRecord[]): StepRecord[] {
  const byKey = new Map(records.map((r) => [r.key, r]));
  return ONBOARDING_STEP_DEFS.map((d) => byKey.get(d.key) ?? { key: d.key, status: "PENDING", completedAt: null });
}

const isResolved = (s: StepRecord, def: OnboardingStepDef): boolean =>
  s.status === "COMPLETED" || (s.status === "SKIPPED" && def.optional);

/**
 * Raison pour laquelle `step` ne peut pas être traitée maintenant, ou `null`.
 * Ne tient pas compte du statut courant de l'étape elle-même.
 */
function blockedBy(steps: readonly StepRecord[], step: OnboardingStepKey): OnboardingStepKey[] {
  const def = DEF_BY_KEY.get(step) as OnboardingStepDef;
  const blocking: OnboardingStepKey[] = [];
  for (const other of steps) {
    if (other.key === step) continue;
    const otherDef = DEF_BY_KEY.get(other.key) as OnboardingStepDef;
    if (step === "GO_LIVE") {
      if (!isResolved(other, otherDef)) blocking.push(other.key);
    } else if (!def.optional && otherDef.order < def.order && !otherDef.optional && other.status !== "COMPLETED") {
      blocking.push(other.key);
    }
  }
  return blocking;
}

export function isLive(steps: readonly StepRecord[]): boolean {
  return steps.some((s) => s.key === "GO_LIVE" && s.status === "COMPLETED");
}

/**
 * Applique une transition. Renvoie les étapes mises à jour (nouveau tableau,
 * l'entrée n'est pas modifiée) ou l'erreur métier.
 */
export function transition(
  current: readonly StepRecord[],
  step: OnboardingStepKey,
  action: OnboardingAction,
  now: Date,
): Result<StepRecord[], ConflictError | ValidationError> {
  const def = DEF_BY_KEY.get(step);
  if (!def) {
    return err(ValidationError.field("step", `Étape d'onboarding inconnue : « ${String(step)} ».`, "tenancy.onboarding.unknown_step"));
  }
  const steps = normalizeSteps(current);

  if (isLive(steps)) {
    return err(
      new ConflictError("L'établissement est déjà en production : l'onboarding est terminé.", {
        code: "tenancy.onboarding.already_live",
      }),
    );
  }

  const record = steps.find((s) => s.key === step) as StepRecord;

  if (action === "skip") {
    if (!def.optional) {
      return err(
        new ConflictError(`L'étape « ${step} » est obligatoire et ne peut pas être ignorée.`, {
          code: "tenancy.onboarding.step_not_skippable",
          details: { step },
        }),
      );
    }
    if (record.status !== "PENDING") {
      return err(
        new ConflictError(`L'étape « ${step} » est déjà traitée (${record.status}).`, {
          code: "tenancy.onboarding.step_already_resolved",
          details: { step, status: record.status },
        }),
      );
    }
  } else if (record.status === "COMPLETED") {
    return err(
      new ConflictError(`L'étape « ${step} » est déjà terminée.`, {
        code: "tenancy.onboarding.step_already_resolved",
        details: { step, status: record.status },
      }),
    );
  }

  const blocking = blockedBy(steps, step);
  if (blocking.length > 0) {
    return err(
      new ConflictError(
        step === "GO_LIVE"
          ? `Mise en production impossible : étapes à traiter : ${blocking.join(", ")}.`
          : `L'étape « ${step} » n'est pas encore disponible : terminez d'abord ${blocking.join(", ")}.`,
        { code: "tenancy.onboarding.prerequisites_unmet", details: { step, blockedBy: blocking } },
      ),
    );
  }

  return ok(
    steps.map((s) =>
      s.key === step
        ? { key: s.key, status: action === "complete" ? ("COMPLETED" as const) : ("SKIPPED" as const), completedAt: now }
        : s,
    ),
  );
}

/** Vue calculée : statut global, étape courante, progression, disponibilité de chaque étape. */
export function computeOnboardingState(current: readonly StepRecord[]): OnboardingState {
  const steps = normalizeSteps(current);
  const live = isLive(steps);

  const view = steps.map((s) => {
    const def = DEF_BY_KEY.get(s.key) as OnboardingStepDef;
    // Terminable maintenant : en attente (ou ignorée puis reprise) et sans prérequis manquant.
    const open = s.status === "PENDING" || (s.status === "SKIPPED" && def.optional);
    const available = !live && open && blockedBy(steps, s.key).length === 0;
    return {
      key: s.key,
      order: def.order,
      optional: def.optional,
      status: s.status,
      available,
      completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    };
  });

  // Étape courante : première étape obligatoire en attente ; à défaut, première facultative en attente ;
  // GO_LIVE (dernière) tombe naturellement en dernier.
  const pendingRequired = steps.find((s) => s.status === "PENDING" && !(DEF_BY_KEY.get(s.key) as OnboardingStepDef).optional);
  const pendingOptional = steps.find((s) => s.status === "PENDING" && (DEF_BY_KEY.get(s.key) as OnboardingStepDef).optional);
  const currentStep = live ? null : (pendingRequired ?? pendingOptional)?.key ?? null;

  const done = steps.filter((s) => s.status !== "PENDING").length;
  const total = steps.length;
  return {
    status: live ? "LIVE" : "IN_PROGRESS",
    currentStep,
    progress: { done, total, percent: Math.round((done / total) * 100) },
    steps: view,
  };
}
