/**
 * Cycle de vie d'une période (classe × période) : machine à états PURE (miroir du déclencheur SQL).
 *
 *   OPEN ──lock──► GRADING_LOCKED ──deliberate──► DELIBERATED ──close──► CLOSED
 *     ▲                                                                      │
 *     └─────────────────────────────── reopen (motif + approbation) ◄────────┘
 *
 * La délibération peut être sautée si le tenant a désactivé `require_deliberation` (le bulletin porte alors « sans
 * délibération » plutôt qu'une date fausse). Deux natures de réouverture : CORRECTION (sensible, libère tout) et
 * RESIT_SESSION (planifiée, ne libère que la session 2 ; les notes de session 1 restent verrouillées).
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { ResultsCode, conflict, validation } from "./errors";
import type { PeriodStatus, ReopenKind } from "./types";

const NEXT: Readonly<Record<PeriodStatus, readonly PeriodStatus[]>> = Object.freeze({
  OPEN: ["GRADING_LOCKED"],
  GRADING_LOCKED: ["DELIBERATED", "CLOSED", "OPEN"],
  DELIBERATED: ["CLOSED", "GRADING_LOCKED", "OPEN"],
  CLOSED: ["OPEN"],
});

export const isLegalStateTransition = (from: PeriodStatus, to: PeriodStatus): boolean => NEXT[from].includes(to);

const illegal = (from: PeriodStatus, to: PeriodStatus): Result<never, AppError> =>
  err(conflict(ResultsCode.INVALID_STATE_TRANSITION, `Étape interdite pour la période : ${from} → ${to}.`, { from, to }));

export function planLock(status: PeriodStatus): Result<{ to: "GRADING_LOCKED"; alreadyLocked: boolean }, AppError> {
  if (status === "OPEN") return ok({ to: "GRADING_LOCKED", alreadyLocked: false });
  if (status === "GRADING_LOCKED") return ok({ to: "GRADING_LOCKED", alreadyLocked: true });
  return illegal(status, "GRADING_LOCKED");
}

export function planDeliberate(status: PeriodStatus, input: { heldDeliberation: boolean }): Result<{ to: "DELIBERATED" }, AppError> {
  if (status !== "GRADING_LOCKED") return illegal(status, "DELIBERATED");
  if (!input.heldDeliberation) {
    return err(conflict(ResultsCode.DELIBERATION_REQUIRED, "Une séance de délibération tenue (conseil ou jury) est requise.", {}));
  }
  return ok({ to: "DELIBERATED" });
}

export function planClose(status: PeriodStatus, input: { requireDeliberation: boolean }): Result<{ to: "CLOSED"; withoutDeliberation: boolean }, AppError> {
  if (status === "DELIBERATED") return ok({ to: "CLOSED", withoutDeliberation: false });
  if (status === "GRADING_LOCKED" && !input.requireDeliberation) return ok({ to: "CLOSED", withoutDeliberation: true });
  if (status === "GRADING_LOCKED") {
    return err(conflict(ResultsCode.DELIBERATION_REQUIRED, "Le bulletin définitif exige une délibération tenue avant la clôture.", { status }));
  }
  return illegal(status, "CLOSED");
}

export function planReopen(status: PeriodStatus, input: { kind: ReopenKind; reason: string }): Result<{ to: "OPEN" }, AppError> {
  if (status !== "CLOSED") return illegal(status, "OPEN");
  if (input.reason.trim().length < 10) {
    return err(validation(ResultsCode.REOPEN_REQUIRES_REASON, "Une réouverture exige un motif d'au moins 10 caractères.", "reason"));
  }
  return ok({ to: "OPEN" });
}

/** Sessions que garde verrouillées la réouverture : `RESIT_SESSION` ne libère que la session 2. */
export function sessionsKeptLocked(kind: ReopenKind): readonly (1 | 2)[] {
  return kind === "RESIT_SESSION" ? [1] : [];
}
