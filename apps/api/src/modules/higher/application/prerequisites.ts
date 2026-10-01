/**
 * Prérequis entre UE (US2). Vérifiés côté SERVEUR à chaque inscription (`checkPrerequisites`, API publique pour 004) ;
 * l'interface ne fait que les afficher. Refus : prérequis sur soi-même, vers un autre programme, cycle.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isCurrentlyValid } from "../domain/credits";
import { HigherCode, notFound, validation } from "../domain/errors";
import { buildGraph, evaluatePrerequisites, wouldCreateCycle } from "../domain/prerequisites";
import type { DecimalString, MissingPrerequisite, Prerequisite, PrerequisiteCheck, PrerequisiteMode, Uuid } from "../domain/types";
import * as ledger from "../infrastructure/ledger-repository";
import * as repo from "../infrastructure/prerequisites-repository";
import { EventBuffer, inTx, todayOf, type HigherDeps } from "./deps";

export interface PrerequisiteInput {
  readonly prerequisiteNodeId: Uuid;
  readonly mode?: PrerequisiteMode | undefined;
  readonly minAverage?: DecimalString | undefined;
}

export interface SetPrerequisitesInput {
  readonly ueNodeId: Uuid;
  readonly prerequisites: readonly PrerequisiteInput[];
}

export interface PrerequisiteWarning {
  readonly studentId: Uuid;
  readonly missing: readonly MissingPrerequisite[];
}

export interface SetPrerequisitesResult {
  readonly prerequisites: readonly Prerequisite[];
  /** Inscrits à l'UE qui ne satisferaient plus les nouveaux prérequis (AC2.4) : les inscriptions existantes ne changent pas. */
  readonly warnings: readonly PrerequisiteWarning[];
}

const normalize = (p: PrerequisiteInput): { prerequisiteNodeId: Uuid; mode: PrerequisiteMode; minAverage: DecimalString | null } => ({
  prerequisiteNodeId: p.prerequisiteNodeId,
  mode: p.mode ?? "VALIDATED",
  minAverage: p.mode === "MIN_AVERAGE" ? (p.minAverage ?? null) : null,
});

/** Remplace la liste des prérequis d'une UE. */
export async function setPrerequisites(deps: HigherDeps, ctx: RequestContext, input: SetPrerequisitesInput): Promise<Result<SetPrerequisitesResult, AppError>> {
  const items = input.prerequisites.map(normalize);
  const seen = new Set<Uuid>();
  for (const it of items) {
    if (seen.has(it.prerequisiteNodeId)) return err(validation(HigherCode.INVALID_INPUT, "Un même prérequis ne peut figurer qu'une fois.", "prerequisites"));
    seen.add(it.prerequisiteNodeId);
    if (it.mode === "MIN_AVERAGE" && it.minAverage === null) return err(validation(HigherCode.INVALID_INPUT, "Le mode « moyenne minimale » exige une moyenne.", "minAverage"));
  }

  const ue = await deps.ports.curriculum.getUe(ctx, input.ueNodeId);
  if (!ue) return err(notFound(HigherCode.PREREQUISITE_UNKNOWN_UE, "UE", input.ueNodeId));
  for (const it of items) {
    if (it.prerequisiteNodeId === input.ueNodeId) return err(validation(HigherCode.PREREQUISITE_SELF, "Une UE ne peut pas être son propre prérequis.", "prerequisites"));
    const pu = await deps.ports.curriculum.getUe(ctx, it.prerequisiteNodeId);
    if (!pu) return err(notFound(HigherCode.PREREQUISITE_UNKNOWN_UE, "UE prérequise", it.prerequisiteNodeId));
    if (!ue.programNodeId || ue.programNodeId !== pu.programNodeId) {
      return err(validation(HigherCode.PREREQUISITE_CROSS_PROGRAM, "Un prérequis doit appartenir au même programme que l'UE.", "prerequisites", { prerequisiteNodeId: it.prerequisiteNodeId }));
    }
  }
  // Inscrits actuels, lus avant la transaction (autre module).
  const registrants = items.length > 0 ? await deps.ports.enrollments.listUeRegistrants(ctx, input.ueNodeId) : [];

  return inTx(deps, ctx, async (tx) => {
    const graph = buildGraph(await repo.listAllEdges(tx));
    const cycle = wouldCreateCycle(graph, input.ueNodeId, items.map((i) => i.prerequisiteNodeId));
    if (cycle) return err(validation(HigherCode.PREREQUISITE_CYCLE, "Ces prérequis créeraient un cycle entre UE.", "prerequisites", { cycle }));

    const before = await repo.listPrerequisites(tx, input.ueNodeId);
    const saved = await repo.replacePrerequisites(tx, ctx.tenantId, input.ueNodeId, items.map((i) => ({ id: deps.newId(), ...i })), ctx.userId);

    const warnings: PrerequisiteWarning[] = [];
    if (saved.length > 0) {
      const today = todayOf(deps);
      const ueIds = saved.map((p) => p.prerequisiteNodeId);
      const attendedMode = saved.some((p) => p.mode === "ATTENDED");
      for (const studentId of [...new Set(registrants)]) {
        const entries = (await ledger.listAcquiredForUes(tx, studentId, ueIds)).filter((e) => isCurrentlyValid(e, today));
        const attended = new Set<Uuid>();
        if (attendedMode) for (const p of saved) if (p.mode === "ATTENDED" && (await deps.ports.enrollments.hasAttendedUe(ctx, { studentId, ueNodeId: p.prerequisiteNodeId }))) attended.add(p.prerequisiteNodeId);
        const check = evaluatePrerequisites(saved, entries, attended);
        if (!check.satisfied) warnings.push({ studentId, missing: check.missing });
      }
    }

    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "higher.prerequisite.set",
      resourceType: "ue_prerequisites",
      resourceId: input.ueNodeId,
      before: before.map((p) => ({ prerequisiteNodeId: p.prerequisiteNodeId, mode: p.mode, minAverage: p.minAverage })),
      after: saved.map((p) => ({ prerequisiteNodeId: p.prerequisiteNodeId, mode: p.mode, minAverage: p.minAverage })),
      metadata: { warnings: warnings.length },
    });
    await events.flush(tx);
    return ok({ prerequisites: saved, warnings });
  });
}

export async function getPrerequisites(deps: HigherDeps, ctx: RequestContext, ueNodeId: Uuid): Promise<Result<Prerequisite[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listPrerequisites(tx, ueNodeId)), { readOnly: true });
}

export interface CheckPrerequisitesInput {
  readonly studentId: Uuid;
  readonly ueNodeId: Uuid;
}

/**
 * API publique (004 : inscription, parcours à la carte) : `{ satisfied, missing[] }`. Une acquisition compte si elle est
 * ACQUIRED et dans sa durée de validité (mode `VALIDATED`, Q-26 ; `ATTENDED` et `MIN_AVERAGE` sont des modes configurables).
 */
export async function checkPrerequisites(deps: HigherDeps, ctx: RequestContext, input: CheckPrerequisitesInput): Promise<Result<PrerequisiteCheck, AppError>> {
  const prereqs = await deps.db.run(ctx, (tx) => repo.listPrerequisites(tx, input.ueNodeId), { readOnly: true });
  if (prereqs.length === 0) return ok({ satisfied: true, missing: [] });
  const attended = new Set<Uuid>();
  for (const p of prereqs) {
    if (p.mode === "ATTENDED" && (await deps.ports.enrollments.hasAttendedUe(ctx, { studentId: input.studentId, ueNodeId: p.prerequisiteNodeId }))) attended.add(p.prerequisiteNodeId);
  }
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const today = todayOf(deps);
      const entries = (await ledger.listAcquiredForUes(tx, input.studentId, prereqs.map((p) => p.prerequisiteNodeId))).filter((e) => isCurrentlyValid(e, today));
      return ok(evaluatePrerequisites(prereqs, entries, attended));
    },
    { readOnly: true },
  );
}
