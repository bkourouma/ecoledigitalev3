/** Réglages de paie du tenant (seuil et majoration par défaut, séparation des tâches, seuil propriétaire). */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PayrollCodes, conflict, invalid } from "../domain/errors";
import type { PayrollSettings } from "../domain/records";
import * as repo from "../infrastructure/setup-repo";
import { EventBuffer, inTx, type PayrollDeps } from "./deps";
import { isCurrency, requireUser } from "./support";

export async function getPayrollSettings(deps: PayrollDeps, ctx: RequestContext): Promise<Result<PayrollSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.ensureSettings(tx, ctx.tenantId)));
}

export interface SettingsInput {
  currency?: string | undefined;
  defaultOvertimeThresholdMinutes?: number | undefined;
  defaultOvertimeMultiplierPermille?: number | undefined;
  requireSeparateApprover?: boolean | undefined;
  ownerApprovalThreshold?: number | null | undefined;
}

export async function updatePayrollSettings(deps: PayrollDeps, ctx: RequestContext, input: SettingsInput): Promise<Result<PayrollSettings, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const patch: repo.SettingsPatch = {};
  if (input.currency !== undefined) {
    if (!isCurrency(input.currency)) return err(invalid("currency", `Devise inconnue : « ${input.currency} ».`));
    patch.currency = input.currency;
  }
  if (input.defaultOvertimeThresholdMinutes !== undefined) {
    if (!Number.isInteger(input.defaultOvertimeThresholdMinutes) || input.defaultOvertimeThresholdMinutes <= 0) return err(invalid("defaultOvertimeThresholdMinutes", "Le seuil est un nombre entier de minutes strictement positif."));
    patch.defaultOvertimeThresholdMinutes = input.defaultOvertimeThresholdMinutes;
  }
  if (input.defaultOvertimeMultiplierPermille !== undefined) {
    const m = input.defaultOvertimeMultiplierPermille;
    if (!Number.isInteger(m) || m < 1000 || m > 5000) return err(invalid("defaultOvertimeMultiplierPermille", "La majoration est comprise entre 1 000 ‰ (×1) et 5 000 ‰ (×5)."));
    patch.defaultOvertimeMultiplierPermille = m;
  }
  if (input.requireSeparateApprover !== undefined) patch.requireSeparateApprover = input.requireSeparateApprover;
  if (input.ownerApprovalThreshold !== undefined) {
    if (input.ownerApprovalThreshold !== null && (!Number.isSafeInteger(input.ownerApprovalThreshold) || input.ownerApprovalThreshold <= 0)) {
      return err(invalid("ownerApprovalThreshold", "Le seuil propriétaire est un montant entier strictement positif (ou nul pour le supprimer)."));
    }
    patch.ownerApprovalThreshold = input.ownerApprovalThreshold;
  }
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const before = await repo.ensureSettings(tx, ctx.tenantId);
    if (patch.currency !== undefined && patch.currency !== before.currency && (await repo.hasAnyPayslip(tx))) {
      return err(conflict(PayrollCodes.currencyLocked, "La devise de paie est figée dès qu'un bulletin existe."));
    }
    const after = await repo.updateSettings(tx, ctx.tenantId, patch, user.value, deps.clock.now());
    buf.audit({
      action: "payroll.settings.updated",
      resourceType: "payroll_settings",
      resourceId: ctx.tenantId,
      sensitive: true,
      before: settingsAudit(before),
      after: settingsAudit(after),
    });
    await buf.flush(tx);
    return ok(after);
  });
}

const settingsAudit = (s: PayrollSettings) => ({
  currency: s.currency,
  defaultOvertimeThresholdMinutes: s.defaultOvertimeThresholdMinutes,
  defaultOvertimeMultiplierPermille: s.defaultOvertimeMultiplierPermille,
  requireSeparateApprover: s.requireSeparateApprover,
  ownerApprovalThreshold: s.ownerApprovalThreshold?.amount ?? null,
});
