import type { Tx } from "@ecoledigitale/database";
import type { OnboardingStepKey, OnboardingStepStatus } from "@ecoledigitale/contracts/src/v2/tenancy";
import { normalizeSteps, type StepRecord } from "../domain/onboarding";

interface StepRow {
  step_key: OnboardingStepKey;
  status: OnboardingStepStatus;
  completed_at: Date | null;
}

/** Étapes du tenant courant (la RLS filtre), complétées par « en attente » pour les lignes absentes. */
export async function loadSteps(tx: Tx): Promise<StepRecord[]> {
  const rows = await tx.many<StepRow>("SELECT step_key, status, completed_at FROM tenancy.onboarding_steps");
  return normalizeSteps(rows.map((r) => ({ key: r.step_key, status: r.status, completedAt: r.completed_at })));
}

export async function hasSteps(tx: Tx): Promise<boolean> {
  const row = await tx.queryOne<{ n: string }>("SELECT count(*)::text AS n FROM tenancy.onboarding_steps");
  return Number(row?.n ?? 0) > 0;
}

/** Écrit (insère ou met à jour) l'état de chaque étape fournie. */
export async function saveSteps(
  tx: Tx,
  tenantId: string,
  steps: readonly StepRecord[],
  actorId: string | null,
  now: Date,
): Promise<void> {
  for (const s of steps) {
    await tx.query(
      `INSERT INTO tenancy.onboarding_steps
         (tenant_id, step_key, status, completed_at, completed_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (tenant_id, step_key) DO UPDATE
          SET status = EXCLUDED.status,
              completed_at = EXCLUDED.completed_at,
              completed_by = EXCLUDED.completed_by,
              updated_at = EXCLUDED.updated_at
        WHERE tenancy.onboarding_steps.status IS DISTINCT FROM EXCLUDED.status`,
      [tenantId, s.key, s.status, s.completedAt, s.status === "PENDING" ? null : actorId, now],
    );
  }
}
