/**
 * Effets d'une exclusion temporaire sur le statut de l'élève (`people`) : toujours `AWAITING_HUMAN`. Le module ne suspend
 * ni n'exclut JAMAIS un élève de lui-même : un utilisateur habilité APPLIQUE l'effet (acte sensible, audité), l'ÉCARTE (motif)
 * ou, une fois appliqué, le LÈVE (motif). La base pose `applied_by` et refuse un job ou le système. Un échec du port `people`
 * annule tout (l'effet reste en attente : le statut suit la réalité).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { SchoolLifeEffectDto } from "@ecoledigitale/contracts/src/v2/schoollife";
import { SchoolLifeEvents } from "../domain/events";
import { forbidden, invalid, notFound, SchoolLifeCode } from "../domain/errors";
import { canTransition, EFFECT_TRANSITIONS } from "../domain/machines";
import * as measuresRepo from "../infrastructure/measures-repository";
import type { EffectRow } from "../infrastructure/rows";
import { EventBuffer, inTx, requireHuman, type CallerCaps, type SchoolLifeDeps } from "./deps";
import { clampPage } from "./support";
import { effectDto } from "./views";

function requireApply(caps: CallerCaps): Result<void, AppError> {
  return caps.exclusionApply ? ok(undefined) : err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Appliquer l'effet d'une exclusion sur le statut de l'élève exige une autorisation spécifique."));
}

const payload = (e: EffectRow, appliedStatus: string | null): { v: 1 } & Record<string, unknown> => ({ v: 1, effectId: e.id, measureId: e.measureId, studentId: e.studentId, appliedStatus });

export async function listEffectsView(deps: SchoolLifeDeps, ctx: RequestContext, input: { status?: string | undefined; measureId?: string | undefined; page: number; pageSize: number }): Promise<Result<SchoolLifeEffectDto[], AppError>> {
  const { limit, offset } = clampPage(input.page, input.pageSize);
  return inTx(deps, ctx, async (tx) => ok((await measuresRepo.listEffects(tx, { status: input.status, measureId: input.measureId, limit, offset })).map(effectDto)), { readOnly: true });
}

export async function applyEffect(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, effectId: string, input: { status: "SUSPENDED" | "EXCLUDED" }): Promise<Result<SchoolLifeEffectDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const may = requireApply(caps);
  if (!may.ok) return may;
  return inTx(deps, ctx, async (tx) => {
    const effect = await measuresRepo.getEffect(tx, effectId, { lock: true });
    if (!effect) return err(notFound(SchoolLifeCode.NOT_FOUND, "Effet", effectId));
    if (!canTransition(EFFECT_TRANSITIONS, effect.status, "APPLIED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Un effet ${effect.status} ne peut pas être appliqué.`));
    const measure = await measuresRepo.getMeasure(tx, effect.measureId, { lock: true });
    if (!measure || !["VALIDATED", "NOTIFIED", "EXECUTED", "APPEALED"].includes(measure.status)) return err(invalid(SchoolLifeCode.INVALID_STATE, "La mesure n'est plus en vigueur : l'effet ne peut pas être appliqué."));
    try {
      await deps.ports.studentStatus.changeStudentStatus(ctx, { studentId: effect.studentId, status: input.status, reasonText: `Exclusion temporaire du ${measure.startsOn} au ${measure.endsOn} (vie scolaire)` });
    } catch (e) {
      if (typeof e === "object" && e !== null && "kind" in e && "httpStatus" in e) throw e;
      return err(invalid(SchoolLifeCode.STUDENT_STATUS_FAILED, `Le changement de statut de l'élève a échoué : ${(e as Error).message}`));
    }
    await measuresRepo.updateEffect(tx, effectId, { status: "APPLIED", appliedStatus: input.status });
    const updated = (await measuresRepo.getEffect(tx, effectId)) as EffectRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.EXCLUSION_EFFECT_APPLIED, payload(updated, input.status), { type: "schoollife.measure_effect", id: effectId });
    events.audit({ action: "schoollife.exclusion_effect.applied", resourceType: "measure_effect", resourceId: effectId, sensitive: true, after: { studentId: effect.studentId, status: input.status } });
    await events.flush(tx);
    return ok(effectDto(updated));
  });
}

export async function skipEffect(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, effectId: string, input: { reason: string }): Promise<Result<SchoolLifeEffectDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const may = requireApply(caps);
  if (!may.ok) return may;
  return inTx(deps, ctx, async (tx) => {
    const effect = await measuresRepo.getEffect(tx, effectId, { lock: true });
    if (!effect) return err(notFound(SchoolLifeCode.NOT_FOUND, "Effet", effectId));
    if (!canTransition(EFFECT_TRANSITIONS, effect.status, "SKIPPED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Un effet ${effect.status} ne peut pas être écarté.`));
    await measuresRepo.updateEffect(tx, effectId, { status: "SKIPPED", skippedReason: input.reason });
    const updated = (await measuresRepo.getEffect(tx, effectId)) as EffectRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.EXCLUSION_EFFECT_SKIPPED, payload(updated, null), { type: "schoollife.measure_effect", id: effectId });
    events.audit({ action: "schoollife.exclusion_effect.skipped", resourceType: "measure_effect", resourceId: effectId, sensitive: true, reason: input.reason });
    await events.flush(tx);
    return ok(effectDto(updated));
  });
}

/** Lève la suspension / exclusion appliquée (retour au statut actif), par un acte humain motivé. */
export async function revertEffect(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, effectId: string, input: { reason: string }): Promise<Result<SchoolLifeEffectDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const may = requireApply(caps);
  if (!may.ok) return may;
  return inTx(deps, ctx, async (tx) => {
    const effect = await measuresRepo.getEffect(tx, effectId, { lock: true });
    if (!effect) return err(notFound(SchoolLifeCode.NOT_FOUND, "Effet", effectId));
    if (!canTransition(EFFECT_TRANSITIONS, effect.status, "REVERTED")) return err(invalid(SchoolLifeCode.INVALID_STATE, `Un effet ${effect.status} ne peut pas être levé.`));
    try {
      await deps.ports.studentStatus.changeStudentStatus(ctx, { studentId: effect.studentId, status: "ACTIVE", reasonText: input.reason });
    } catch (e) {
      if (typeof e === "object" && e !== null && "kind" in e && "httpStatus" in e) throw e;
      return err(invalid(SchoolLifeCode.STUDENT_STATUS_FAILED, `Le retour au statut actif a échoué : ${(e as Error).message}`));
    }
    await measuresRepo.updateEffect(tx, effectId, { status: "REVERTED", revertReason: input.reason });
    const updated = (await measuresRepo.getEffect(tx, effectId)) as EffectRow;
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.EXCLUSION_EFFECT_REVERTED, payload(updated, effect.appliedStatus), { type: "schoollife.measure_effect", id: effectId });
    events.audit({ action: "schoollife.exclusion_effect.reverted", resourceType: "measure_effect", resourceId: effectId, sensitive: true, reason: input.reason });
    await events.flush(tx);
    return ok(effectDto(updated));
  });
}
