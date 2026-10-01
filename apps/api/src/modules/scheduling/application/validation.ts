/**
 * Validation pour la paie et heures payables (spec 017 US5).
 *
 * - `validateOccurrence(s)` : acte de gestion DISTINCT du constat ; lot PARTIEL (les éligibles passent,
 *   les autres reviennent avec leur motif) ; « quatre yeux » pour les séances comptables.
 * - `setPaidMinutes` : dérogation de durée, uniquement AVANT validation.
 * - `listPayableHours` : prédicat unique (la fonction SQL `scheduling.payable_hours`).
 * - `lockHours` / `releaseHoursLock` : verrous posés par la paie, EXCLUSIFS et ATOMIQUES — une heure
 *   ne se paie qu'une fois, y compris entre deux bulletins de périodes qui se chevauchent.
 */
import { ConflictError, NotFoundError, ValidationError, err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { SchedulingCodes, hoursLocked, occurrenceCancelled, occurrenceValidated, reasonRequired, selfValidationForbidden } from "../domain/errors";
import { SchedulingEvents } from "../domain/events";
import { VALIDATION_BLOCKER_MESSAGES, editability, isValidPaidMinutes, validationBlocker, type ValidationBlocker } from "../domain/occurrence-rules";
import type { OccurrenceStaff, PayableHourLine, SchedulingSettings } from "../domain/types";
import { mapDbError } from "../infrastructure/db-errors";
import * as occRepo from "../infrastructure/occurrence-repo";
import * as q from "../infrastructure/read-queries";
import { EventBuffer, inTx, setChangeReason, type SchedulingDeps } from "./deps";
import { editBlocked, notFoundOccurrence } from "./occurrences";
import { MIN_REASON_LENGTH, OCCURRENCE_AGGREGATE, loadSettings, occurrenceEventPayload, trimReason, validation } from "./support";

export const MAX_VALIDATION_BATCH = 500;
export const MAX_LOCK_LINES = 5000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidateOutcome {
  occurrenceId: string;
  /** `true` si la séance était déjà validée (second validateur : idempotent). */
  alreadyValidated: boolean;
}

type RejectReason = ValidationBlocker | "LOCKED" | "NOT_FOUND";

class Rejected extends Error {
  constructor(
    readonly reason: RejectReason,
    readonly error: AppError,
  ) {
    super(reason);
  }
}

async function validateInTx(tx: Tx, deps: SchedulingDeps, ctx: RequestContext, buf: EventBuffer, id: string, settingsCache: Map<string, SchedulingSettings>): Promise<ValidateOutcome> {
  const occ = await occRepo.getOccurrence(tx, id, { forUpdate: true });
  if (!occ) throw new Rejected("NOT_FOUND", NotFoundError.of("Séance", id, { code: SchedulingCodes.notFound }));
  const staff = (await occRepo.listStaffByOccurrence(tx, [id])).get(id) ?? [];
  if (occ.validatedAt !== null) return { occurrenceId: id, alreadyValidated: true };
  let settings = settingsCache.get(occ.institutionId);
  if (!settings) {
    settings = await loadSettings(tx, occ.institutionId);
    settingsCache.set(occ.institutionId, settings);
  }
  const blocker = validationBlocker(occ, staff, { actorId: ctx.userId, allowSelfValidation: settings.allowSelfValidation });
  if (blocker) {
    const error =
      blocker === "SELF_VALIDATION"
        ? selfValidationForbidden()
        : new ConflictError(VALIDATION_BLOCKER_MESSAGES[blocker], { code: SchedulingCodes.notValidatable, details: { blocker } });
    throw new Rejected(blocker, error);
  }
  const now = deps.clock.now();
  await setChangeReason(tx, "Validation pour la paie");
  const done = await occRepo.setValidated(tx, id, ctx.userId as string, now);
  await setChangeReason(tx, null);
  if (!done) return { occurrenceId: id, alreadyValidated: true };
  const detail = { ...occ, validatedAt: now, validatedBy: ctx.userId };
  buf.add(SchedulingEvents.occurrenceValidated, occurrenceEventPayload(detail, staff.map((s) => s.staffId), { validatedBy: ctx.userId }), { type: OCCURRENCE_AGGREGATE, id });
  buf.audit({
    action: "scheduling.occurrence.validated",
    resourceType: "occurrence",
    resourceId: id,
    sensitive: true,
    metadata: { staffIds: staff.filter((s) => s.isPaidRole).map((s) => s.staffId), occursOn: occ.occursOn },
  });
  return { occurrenceId: id, alreadyValidated: false };
}

function requireUser(ctx: RequestContext): Result<string, AppError> {
  return ctx.userId ? ok(ctx.userId) : err(validation("userId", "La validation exige un utilisateur identifié.", "user_required"));
}

export async function validateOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceId: string }): Promise<Result<ValidateOutcome, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    try {
      const outcome = await validateInTx(tx, deps, ctx, buf, input.occurrenceId, new Map());
      await buf.flush(tx);
      return ok(outcome);
    } catch (e) {
      if (e instanceof Rejected) return err(e.error);
      throw e;
    }
  });
}

export interface ValidateBatchResult {
  validated: string[];
  alreadyValidated: string[];
  rejected: Array<{ id: string; reason: RejectReason | "ERROR"; message: string }>;
}

/** Lot PARTIEL (≤ 500) : parité AT-064. Chaque séance dans son SAVEPOINT. */
export async function validateOccurrencesBatch(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceIds: string[] }): Promise<Result<ValidateBatchResult, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const ids = [...new Set(input.occurrenceIds)];
  if (ids.length === 0) return err(validation("occurrenceIds", "Aucune séance à valider.", "empty_batch"));
  if (ids.length > MAX_VALIDATION_BATCH) return err(validation("occurrenceIds", `Un lot compte au plus ${MAX_VALIDATION_BATCH} séances.`, "batch_too_large"));
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const settingsCache = new Map<string, SchedulingSettings>();
    const result: ValidateBatchResult = { validated: [], alreadyValidated: [], rejected: [] };
    // Ordre stable : deux lots concurrents verrouillent les lignes dans le même ordre.
    for (const id of [...ids].sort()) {
      try {
        const sub = new EventBuffer(deps, ctx);
        const outcome = await tx.transaction(async (inner) => {
          const o = await validateInTx(inner, deps, ctx, sub, id, settingsCache);
          return o;
        });
        // Les événements/audits de cette séance ne sont gardés que si son SAVEPOINT a réussi.
        await sub.flush(tx);
        (outcome.alreadyValidated ? result.alreadyValidated : result.validated).push(id);
      } catch (e) {
        if (e instanceof Rejected) result.rejected.push({ id, reason: e.reason, message: e.error.message });
        else {
          const mapped = isAppError(e) ? e : mapDbError(e);
          if (!mapped) throw e;
          result.rejected.push({ id, reason: "ERROR", message: mapped.message });
        }
      }
    }
    void buf;
    return ok(result);
  });
}

export async function unvalidateOccurrence(deps: SchedulingDeps, ctx: RequestContext, input: { occurrenceId: string; reason: string }): Promise<Result<{ occurrenceId: string; wasValidated: boolean }, AppError>> {
  const reason = trimReason(input.reason);
  if (reason.length < MIN_REASON_LENGTH) return err(reasonRequired("dévalider une séance"));
  return inTx<{ occurrenceId: string; wasValidated: boolean }>(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const occ = await occRepo.getOccurrence(tx, input.occurrenceId, { forUpdate: true });
    if (!occ) return err(notFoundOccurrence(input.occurrenceId));
    const staff = (await occRepo.listStaffByOccurrence(tx, [occ.id])).get(occ.id) ?? [];
    const locked = staff.find((s) => s.lockedAt !== null);
    if (locked) return err(hoursLocked(locked.lockRef));
    if (occ.validatedAt === null) return ok({ occurrenceId: occ.id, wasValidated: false });
    await setChangeReason(tx, reason);
    await occRepo.clearValidated(tx, occ.id, deps.clock.now());
    await setChangeReason(tx, null);
    buf.add(SchedulingEvents.occurrenceUnvalidated, occurrenceEventPayload(occ, staff.map((s) => s.staffId), { reason }), { type: OCCURRENCE_AGGREGATE, id: occ.id });
    buf.audit({ action: "scheduling.occurrence.unvalidated", resourceType: "occurrence", resourceId: occ.id, sensitive: true, reason });
    await buf.flush(tx);
    return ok({ occurrenceId: occ.id, wasValidated: true });
  });
}

export async function setPaidMinutes(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { occurrenceId: string; staffId: string; minutes: number | null; reason?: string | undefined },
): Promise<Result<OccurrenceStaff, AppError>> {
  if (input.minutes !== null && !isValidPaidMinutes(input.minutes)) {
    return err(validation("minutes", "La durée payée est un nombre entier de minutes entre 1 et 1440.", "invalid_minutes"));
  }
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const occ = await occRepo.getOccurrence(tx, input.occurrenceId, { forUpdate: true });
    if (!occ) return err(notFoundOccurrence(input.occurrenceId));
    const staff = (await occRepo.listStaffByOccurrence(tx, [occ.id])).get(occ.id) ?? [];
    // Dérogation AVANT validation seulement (le legacy l'autorisait après : AC5.3).
    const edit = editability(occ, staff);
    if (!edit.ok) return err(edit.reason === "VALIDATED" ? occurrenceValidated() : edit.reason === "LOCKED" ? hoursLocked(edit.lockRef ?? null) : occurrenceCancelled());
    const row = staff.find((s) => s.staffId === input.staffId);
    if (!row) return err(NotFoundError.of("Intervenant de la séance", input.staffId, { code: SchedulingCodes.notFound }));
    if (row.paidMinutes === input.minutes) return ok(row);
    await setChangeReason(tx, trimReason(input.reason) || null);
    await occRepo.setPaidMinutes(tx, occ.id, input.staffId, input.minutes, ctx.userId, deps.clock.now());
    await setChangeReason(tx, null);
    const updated = ((await occRepo.listStaffByOccurrence(tx, [occ.id])).get(occ.id) ?? []).find((s) => s.staffId === input.staffId) as OccurrenceStaff;
    buf.add(SchedulingEvents.occurrencePaidMinutesChanged, { v: 1, occurrenceId: occ.id, staffId: input.staffId, minutes: input.minutes }, { type: OCCURRENCE_AGGREGATE, id: occ.id });
    buf.audit({
      action: "scheduling.occurrence.paid_minutes_set",
      resourceType: "occurrence",
      resourceId: occ.id,
      sensitive: true,
      ...(trimReason(input.reason) ? { reason: trimReason(input.reason) } : {}),
      before: { staffId: input.staffId, minutes: row.paidMinutes },
      after: { staffId: input.staffId, minutes: input.minutes },
    });
    await buf.flush(tx);
    return ok(updated);
  });
}

// ---------------------------------------------------------------------------
// Heures payables et verrous de paie
// ---------------------------------------------------------------------------

export interface PayableHoursInput {
  from: string;
  to: string;
  staffIds?: string[] | undefined;
}

/** Prédicat UNIQUE des heures payables (consommé par la paie, spec 032) : HELD ∧ validée ∧ rôle rémunéré. */
export async function listPayableHours(deps: SchedulingDeps, ctx: RequestContext, input: PayableHoursInput): Promise<Result<PayableHourLine[], AppError>> {
  if (input.to < input.from) return err(validation("to", "La fin de période précède son début.", "invalid_range"));
  return inTx(deps, ctx, async (tx) => ok(await q.payableLines(tx, { from: input.from, to: input.to }, input.staffIds ?? null)), { readOnly: true });
}

export interface LockLine {
  occurrenceId: string;
  staffId: string;
}

export interface LockHoursInput {
  lines: LockLine[];
  /** Identifiant du bulletin / de la ligne de paie qui réclame ces heures. */
  lockRef: string;
}

export interface LockHoursResult {
  locked: number;
  /** Lignes déjà verrouillées sous le MÊME `lockRef` (rejeu idempotent). */
  alreadyLockedSameRef: number;
}

/**
 * Verrouille des heures pour un bulletin (`lockRef`). ATOMIQUE : une ligne déjà verrouillée sous un AUTRE
 * `lockRef` fait échouer TOUT le lot (`scheduling.hours_already_locked`) ; EXCLUSIF : les lignes sont
 * verrouillées en base (`FOR UPDATE`, ordre stable) avant le contrôle, donc deux bulletins concurrents
 * qui réclament la même heure sont sérialisés et le second échoue. Réservé à la paie (`schedule.hours.lock`).
 */
export async function lockHours(deps: SchedulingDeps, ctx: RequestContext, input: LockHoursInput): Promise<Result<LockHoursResult, AppError>> {
  const lines = dedupeLines(input.lines);
  if (lines.length === 0) return err(validation("lines", "Aucune ligne à verrouiller.", "empty_lines"));
  if (lines.length > MAX_LOCK_LINES) return err(validation("lines", `Un verrouillage compte au plus ${MAX_LOCK_LINES} lignes.`, "too_many_lines"));
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const rows = await q.lockStaffRowsForUpdate(tx, lines);
    const byKey = new Map(rows.map((r) => [key(r), r]));
    const missing = lines.filter((l) => !byKey.has(key(l)));
    if (missing.length > 0) {
      return err(new NotFoundError("Des lignes d'intervenant à verrouiller sont introuvables.", { code: SchedulingCodes.notFound, details: { lines: missing } }));
    }
    const lockedElsewhere = rows.filter((r) => r.lockedAt !== null && r.lockRef !== input.lockRef);
    if (lockedElsewhere.length > 0) {
      return err(
        new ConflictError("Des heures sont déjà réclamées par un autre bulletin : une heure ne se paie qu'une fois.", {
          code: SchedulingCodes.hoursAlreadyLocked,
          details: { lines: lockedElsewhere.map((r) => ({ occurrenceId: r.occurrenceId, staffId: r.staffId, lockRef: r.lockRef })) },
        }),
      );
    }
    // Payabilité : le prédicat unique (fonction SQL), sur la plage de dates des séances demandées.
    const occs = await occRepo.getOccurrencesByIds(tx, [...new Set(lines.map((l) => l.occurrenceId))]);
    const from = occs.map((o) => o.occursOn).sort()[0] as string;
    const to = occs.map((o) => o.occursOn).sort().at(-1) as string;
    const payable = new Set((await q.payableLines(tx, { from, to }, [...new Set(lines.map((l) => l.staffId))])).map((p) => `${p.occurrenceId}|${p.staffId}`));
    const notPayable = lines.filter((l) => !payable.has(key(l)));
    if (notPayable.length > 0) {
      return err(
        new ConflictError("Des lignes ne sont pas payables : seules les heures rémunérées d'une séance réalisée et validée se verrouillent.", {
          code: SchedulingCodes.hoursNotPayable,
          details: { lines: notPayable },
        }),
      );
    }
    const toLock = rows.filter((r) => r.lockedAt === null).map((r) => ({ occurrenceId: r.occurrenceId, staffId: r.staffId }));
    const locked = toLock.length > 0 ? await q.applyLock(tx, toLock, input.lockRef, deps.clock.now()) : 0;
    if (locked !== toLock.length) {
      return err(new ConflictError("Verrouillage incomplet (concurrence) : réessayez.", { code: SchedulingCodes.concurrentUpdate }));
    }
    if (locked > 0) {
      buf.add(SchedulingEvents.hoursLocked, { v: 1, lockRef: input.lockRef, lines: locked }, { type: "hours_lock", id: input.lockRef });
      buf.audit({ action: "scheduling.hours.locked", resourceType: "hours_lock", resourceId: input.lockRef, sensitive: true, metadata: { lines: locked } });
    }
    await buf.flush(tx);
    return ok({ locked, alreadyLockedSameRef: rows.length - toLock.length });
  });
}

/** Libère toutes les lignes verrouillées sous `lockRef` (annulation ou recalcul du bulletin). Idempotent. */
export async function releaseHoursLock(deps: SchedulingDeps, ctx: RequestContext, input: { lockRef: string }): Promise<Result<{ released: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const rows = await q.listLockedByRef(tx, input.lockRef);
    if (rows.length === 0) return ok({ released: 0 });
    const released = await q.releaseLock(tx, input.lockRef, deps.clock.now());
    buf.add(SchedulingEvents.hoursReleased, { v: 1, lockRef: input.lockRef, lines: released }, { type: "hours_lock", id: input.lockRef });
    buf.audit({ action: "scheduling.hours.released", resourceType: "hours_lock", resourceId: input.lockRef, sensitive: true, metadata: { lines: released } });
    await buf.flush(tx);
    return ok({ released });
  });
}

const key = (l: { occurrenceId: string; staffId: string }): string => `${l.occurrenceId}|${l.staffId}`;

function dedupeLines(lines: readonly LockLine[]): LockLine[] {
  const seen = new Map<string, LockLine>();
  for (const l of lines) seen.set(key(l), { occurrenceId: l.occurrenceId, staffId: l.staffId });
  return [...seen.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

// ---------------------------------------------------------------------------
// Rapprochements pour la paie (AC5.8)
// ---------------------------------------------------------------------------

export async function findValidatedOverlaps(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { from: string; to: string; staffIds?: string[] | undefined },
): Promise<Result<q.ValidatedOverlap[], AppError>> {
  if (input.to < input.from) return err(validation("to", "La fin de période précède son début.", "invalid_range"));
  return inTx(deps, ctx, async (tx) => ok(await q.validatedOverlaps(tx, { from: input.from, to: input.to }, input.staffIds ?? null)), { readOnly: true });
}

void ValidationError;
