/** Use cases « onboarding » : la logique est dans `domain/onboarding.ts` (pure), ici la persistance. */
import {
  NotFoundError,
  ValidationError,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import type { OnboardingState, OnboardingStepKey } from "@ecoledigitale/contracts/src/v2/tenancy";
import { computeOnboardingState, isOnboardingStepKey, transition, type OnboardingAction } from "../domain/onboarding";
import { hasSteps, loadSteps, saveSteps } from "../infrastructure/onboarding-repository";
import { resolveDeps, runResult, type TenancyDeps } from "./support";

export async function getOnboarding(
  deps: TenancyDeps,
  ctx: RequestContext,
): Promise<Result<OnboardingState, AppError>> {
  const d = resolveDeps(deps);
  return runResult(
    d.db,
    ctx,
    async (tx) => {
      if (!(await hasSteps(tx))) {
        throw NotFoundError.of("Onboarding", ctx.tenantId, { code: "tenancy.onboarding_not_found" });
      }
      return computeOnboardingState(await loadSteps(tx));
    },
    { readOnly: true },
  );
}

async function advance(
  deps: TenancyDeps,
  ctx: RequestContext,
  step: string,
  action: OnboardingAction,
): Promise<Result<OnboardingState, AppError>> {
  const d = resolveDeps(deps);
  return runResult(d.db, ctx, async (tx) => {
    if (!isOnboardingStepKey(step)) {
      throw ValidationError.field("step", `Étape d'onboarding inconnue : « ${step} ».`, "tenancy.onboarding.unknown_step");
    }
    if (!(await hasSteps(tx))) {
      throw NotFoundError.of("Onboarding", ctx.tenantId, { code: "tenancy.onboarding_not_found" });
    }
    const now = d.clock.now();
    const before = await loadSteps(tx);
    const next = transition(before, step as OnboardingStepKey, action, now);
    if (!next.ok) throw next.error;

    await saveSteps(tx, ctx.tenantId, next.value, ctx.userId, now);
    await d.audit?.record(tx, {
      action: `tenancy.onboarding.${action}`,
      resource: "onboarding_step",
      resourceId: step,
      ctx,
    });
    return computeOnboardingState(next.value);
  });
}

export const completeOnboardingStep = (deps: TenancyDeps, ctx: RequestContext, step: string) =>
  advance(deps, ctx, step, "complete");

export const skipOnboardingStep = (deps: TenancyDeps, ctx: RequestContext, step: string) =>
  advance(deps, ctx, step, "skip");
