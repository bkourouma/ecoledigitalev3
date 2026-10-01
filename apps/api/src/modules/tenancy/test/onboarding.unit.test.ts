import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEP_DEFS,
  PROVISIONING_STEPS,
  computeOnboardingState,
  initialSteps,
  isLive,
  normalizeSteps,
  transition,
  type StepRecord,
} from "../domain/onboarding";
import type { OnboardingStepKey } from "@ecoledigitale/contracts/src/v2/tenancy";

const T0 = new Date("2026-10-01T08:00:00.000Z");
const T1 = new Date("2026-10-02T08:00:00.000Z");

/** État juste après provisioning. */
function provisioned(): StepRecord[] {
  return initialSteps().map((s) =>
    PROVISIONING_STEPS.includes(s.key) ? { key: s.key, status: "COMPLETED", completedAt: T0 } : s,
  );
}

function apply(steps: StepRecord[], key: OnboardingStepKey, action: "complete" | "skip" = "complete"): StepRecord[] {
  const r = transition(steps, key, action, T1);
  if (!r.ok) throw r.error;
  return r.value;
}

const statusOf = (steps: readonly StepRecord[], key: OnboardingStepKey) => steps.find((s) => s.key === key)?.status;

describe("onboarding — définition des étapes (PRD §56)", () => {
  it("11 étapes dans l'ordre du PRD, GO_LIVE en dernier", () => {
    expect(ONBOARDING_STEP_DEFS.map((d) => d.key)).toEqual([
      "ACCOUNT",
      "INSTITUTION",
      "COUNTRY",
      "INSTITUTION_TYPE",
      "PACK",
      "ACADEMIC_YEAR",
      "STUDENT_IMPORT",
      "CLASSES",
      "TEACHERS",
      "FINANCE",
      "GO_LIVE",
    ]);
  });

  it("import élèves, enseignants et finance sont facultatifs ; le reste est obligatoire", () => {
    const optional = ONBOARDING_STEP_DEFS.filter((d) => d.optional).map((d) => d.key);
    expect(optional).toEqual(["STUDENT_IMPORT", "TEACHERS", "FINANCE"]);
  });

  it("le provisioning accomplit les 5 premières étapes", () => {
    expect(PROVISIONING_STEPS).toEqual(["ACCOUNT", "INSTITUTION", "COUNTRY", "INSTITUTION_TYPE", "PACK"]);
  });
});

describe("onboarding — état calculé", () => {
  it("tenant neuf : en cours, première étape ACCOUNT, 0 %", () => {
    const state = computeOnboardingState(initialSteps());
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.currentStep).toBe("ACCOUNT");
    expect(state.progress).toEqual({ done: 0, total: 11, percent: 0 });
    // Seule ACCOUNT est disponible parmi les obligatoires ; les facultatives le sont toujours.
    const available = state.steps.filter((s) => s.available).map((s) => s.key);
    expect(available).toEqual(["ACCOUNT", "STUDENT_IMPORT", "TEACHERS", "FINANCE"]);
  });

  it("après provisioning : étape courante ACADEMIC_YEAR, 5/11", () => {
    const state = computeOnboardingState(provisioned());
    expect(state.currentStep).toBe("ACADEMIC_YEAR");
    expect(state.progress).toEqual({ done: 5, total: 11, percent: 45 });
    expect(state.steps.find((s) => s.key === "ACADEMIC_YEAR")?.available).toBe(true);
    expect(state.steps.find((s) => s.key === "CLASSES")?.available).toBe(false);
    expect(state.steps.find((s) => s.key === "GO_LIVE")?.available).toBe(false);
  });

  it("une liste partielle est complétée par « en attente » dans l'ordre canonique", () => {
    const steps = normalizeSteps([{ key: "PACK", status: "COMPLETED", completedAt: T0 }]);
    expect(steps).toHaveLength(11);
    expect(steps[0]?.key).toBe("ACCOUNT");
    expect(statusOf(steps, "PACK")).toBe("COMPLETED");
    expect(statusOf(steps, "ACCOUNT")).toBe("PENDING");
  });

  it("les dates sont exposées en ISO UTC", () => {
    const state = computeOnboardingState(provisioned());
    expect(state.steps[0]?.completedAt).toBe("2026-10-01T08:00:00.000Z");
    expect(state.steps[10]?.completedAt).toBeNull();
  });
});

describe("onboarding — transitions", () => {
  it("parcours nominal jusqu'à la mise en production", () => {
    let steps = provisioned();
    steps = apply(steps, "ACADEMIC_YEAR");
    steps = apply(steps, "CLASSES");
    // Facultatives : une terminée, deux ignorées.
    steps = apply(steps, "STUDENT_IMPORT");
    steps = apply(steps, "TEACHERS", "skip");
    steps = apply(steps, "FINANCE", "skip");
    expect(computeOnboardingState(steps).currentStep).toBe("GO_LIVE");
    steps = apply(steps, "GO_LIVE");

    const state = computeOnboardingState(steps);
    expect(state.status).toBe("LIVE");
    expect(state.currentStep).toBeNull();
    expect(state.progress.percent).toBe(100);
    expect(isLive(steps)).toBe(true);
  });

  it("refuse une étape obligatoire dont un prérequis obligatoire manque", () => {
    const r = transition(provisioned(), "CLASSES", "complete", T1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("tenancy.onboarding.prerequisites_unmet");
      expect(r.error.details).toMatchObject({ step: "CLASSES", blockedBy: ["ACADEMIC_YEAR"] });
    }
  });

  it("une étape facultative n'est jamais bloquante (import des élèves avant les classes)", () => {
    const steps = apply(provisioned(), "STUDENT_IMPORT");
    expect(statusOf(steps, "STUDENT_IMPORT")).toBe("COMPLETED");
    expect(statusOf(steps, "ACADEMIC_YEAR")).toBe("PENDING");
  });

  it("une étape facultative n'empêche pas l'étape obligatoire suivante", () => {
    let steps = apply(provisioned(), "ACADEMIC_YEAR");
    // CLASSES (obligatoire) ne dépend pas de STUDENT_IMPORT (facultative) qui la précède.
    steps = apply(steps, "CLASSES");
    expect(statusOf(steps, "CLASSES")).toBe("COMPLETED");
  });

  it("une étape obligatoire ne s'ignore pas", () => {
    const r = transition(provisioned(), "ACADEMIC_YEAR", "skip", T1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("tenancy.onboarding.step_not_skippable");
  });

  it("GO_LIVE n'est pas ignorable", () => {
    const r = transition(provisioned(), "GO_LIVE", "skip", T1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("tenancy.onboarding.step_not_skippable");
  });

  it("GO_LIVE exige TOUTES les autres étapes résolues, facultatives comprises", () => {
    let steps = apply(provisioned(), "ACADEMIC_YEAR");
    steps = apply(steps, "CLASSES");
    const r = transition(steps, "GO_LIVE", "complete", T1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("tenancy.onboarding.prerequisites_unmet");
      expect(r.error.details?.blockedBy).toEqual(["STUDENT_IMPORT", "TEACHERS", "FINANCE"]);
    }
  });

  it("une étape déjà terminée ne se re-termine pas", () => {
    const r = transition(provisioned(), "ACCOUNT", "complete", T1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("tenancy.onboarding.step_already_resolved");
  });

  it("on ne peut pas ignorer une étape facultative déjà terminée ou déjà ignorée", () => {
    let steps = apply(provisioned(), "FINANCE", "skip");
    const again = transition(steps, "FINANCE", "skip", T1);
    expect(again.ok).toBe(false);
    steps = apply(steps, "TEACHERS");
    const done = transition(steps, "TEACHERS", "skip", T1);
    expect(done.ok).toBe(false);
  });

  it("une étape ignorée peut être reprise puis terminée", () => {
    let steps = apply(provisioned(), "FINANCE", "skip");
    expect(statusOf(steps, "FINANCE")).toBe("SKIPPED");
    expect(computeOnboardingState(steps).steps.find((s) => s.key === "FINANCE")?.available).toBe(true);
    steps = apply(steps, "FINANCE", "complete");
    expect(statusOf(steps, "FINANCE")).toBe("COMPLETED");
  });

  it("étape inconnue : erreur de validation", () => {
    const r = transition(provisioned(), "NOPE" as OnboardingStepKey, "complete", T1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("après la mise en production, plus aucune transition", () => {
    let steps = provisioned();
    for (const k of ["ACADEMIC_YEAR", "CLASSES"] as const) steps = apply(steps, k);
    for (const k of ["STUDENT_IMPORT", "TEACHERS", "FINANCE"] as const) steps = apply(steps, k, "skip");
    steps = apply(steps, "GO_LIVE");
    const r = transition(steps, "FINANCE", "complete", T1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("tenancy.onboarding.already_live");
  });

  it("la transition ne modifie pas son entrée (immutabilité)", () => {
    const before = provisioned();
    const snapshot = JSON.stringify(before);
    apply(before, "ACADEMIC_YEAR");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("enregistre l'instant de la transition", () => {
    const steps = apply(provisioned(), "ACADEMIC_YEAR");
    expect(steps.find((s) => s.key === "ACADEMIC_YEAR")?.completedAt).toEqual(T1);
  });
});
