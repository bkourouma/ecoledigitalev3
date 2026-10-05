/**
 * Séance d'appel : machine d'états, fenêtre de correction, portée d'appel.
 *
 *   OPEN -> SUBMITTED -> VALIDATED ; SUBMITTED -> OPEN (correction) ; VALIDATED -> SUBMITTED (réouverture motivée,
 *   sensible) ; OPEN | SUBMITTED -> CANCELLED ; VALIDATED -> CANCELLED (réouverture motivée) ; CANCELLED terminal.
 *
 * Miroir applicatif du déclencheur `attendance.sessions_guard` : la base reste la dernière garde, ces fonctions
 * produisent une erreur claire AVANT l'écriture.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, conflict, validation } from "./errors";
import type { AttendanceSession, CallPolicy, CallScope, DayPart, SessionScope, SessionStatus } from "./types";

const TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = Object.freeze({
  OPEN: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["VALIDATED", "OPEN", "CANCELLED"],
  VALIDATED: ["SUBMITTED", "CANCELLED"],
  CANCELLED: [],
});

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Les transitions qui sortent de VALIDATED exigent la réouverture motivée (réglage de transaction + permission sensible). */
export function requiresReopen(from: SessionStatus): boolean {
  return from === "VALIDATED";
}

export function assertTransition(from: SessionStatus, to: SessionStatus): Result<true, AppError> {
  if (canTransitionSession(from, to)) return ok(true);
  return err(conflict(AttendanceCode.INVALID_TRANSITION, `Transition d'appel interdite : ${from} → ${to}.`, { from, to }));
}

export interface EditContext {
  readonly now: Date;
  /** `attendance.manage` : corrige tout appel non validé, même passé le délai. */
  readonly canManage: boolean;
}

/**
 * Peut-on modifier les POINTAGES de cette séance ?
 *  - OPEN : oui ;
 *  - SUBMITTED : dans la fenêtre `edit_window_minutes` après la soumission (nulle = jusqu'à la validation), sinon
 *    seulement avec `attendance.manage` ;
 *  - VALIDATED / CANCELLED : jamais (réouverture requise).
 */
export function checkEditable(
  session: Pick<AttendanceSession, "status" | "submittedAt">,
  policy: Pick<CallPolicy, "editWindowMinutes"> | null,
  ctx: EditContext,
): Result<true, AppError> {
  switch (session.status) {
    case "OPEN":
      return ok(true);
    case "SUBMITTED": {
      if (ctx.canManage) return ok(true);
      const window = policy?.editWindowMinutes ?? null;
      if (window === null || session.submittedAt === null) return ok(true);
      const elapsedMs = ctx.now.getTime() - session.submittedAt.getTime();
      if (elapsedMs <= window * 60_000) return ok(true);
      return err(
        conflict(AttendanceCode.EDIT_WINDOW_CLOSED, "Le délai de correction de cet appel est dépassé : adressez-vous à la direction.", {
          editWindowMinutes: window,
        }),
      );
    }
    case "VALIDATED":
      return err(conflict(AttendanceCode.SESSION_LOCKED, "L'appel est validé : aucun pointage n'est modifiable (réouverture requise).", { status: session.status }));
    case "CANCELLED":
      return err(conflict(AttendanceCode.SESSION_LOCKED, "L'appel est annulé : aucun pointage n'est modifiable.", { status: session.status }));
  }
}

export function callScopeAllows(policyScope: CallScope, scope: SessionScope): boolean {
  return policyScope === "BOTH" || policyScope === scope;
}

/** Demi-journées d'un cycle en appel `HALF_DAYS` (ordre de la journée). */
export const HALF_DAY_PARTS: readonly DayPart[] = Object.freeze(["MORNING", "AFTERNOON"] as const);

/**
 * Demi-journée d'un appel JOURNALIER selon la politique du cycle (décision Q-P17) :
 *  - `SINGLE` (ou aucune politique) : un seul appel par jour, `FULL` ; demander le matin ou l'après-midi est refusé ;
 *  - `HALF_DAYS` : deux appels par jour, la demi-journée est OBLIGATOIRE (jamais devinée d'après l'heure) ; un appel `FULL` est refusé.
 * Un appel par séance planifiée n'a pas de demi-journée : l'appelant ne passe pas par ici.
 */
export function resolveDayPart(policy: Pick<CallPolicy, "dailyCallMode"> | null, requested: DayPart | undefined): Result<DayPart, AppError> {
  const mode = policy?.dailyCallMode ?? "SINGLE";
  if (mode === "SINGLE") {
    if (requested === undefined || requested === "FULL") return ok("FULL");
    return err(
      conflict(AttendanceCode.DAY_PART_NOT_ALLOWED, "La politique d'appel de ce cycle prévoit un seul appel par jour : l'appel du matin ou de l'après-midi n'est pas autorisé.", {
        dailyCallMode: mode,
        requested,
      }),
    );
  }
  if (requested === undefined) {
    return err(validation(AttendanceCode.DAY_PART_REQUIRED, "Précisez la demi-journée de l'appel : matin ou après-midi.", "dayPart", { dailyCallMode: mode, allowed: [...HALF_DAY_PARTS] }));
  }
  if (requested === "FULL") {
    return err(
      conflict(AttendanceCode.DAY_PART_NOT_ALLOWED, "La politique d'appel de ce cycle demande deux appels par jour (matin et après-midi) : l'appel de la journée entière n'est pas autorisé.", {
        dailyCallMode: mode,
        requested,
        allowed: [...HALF_DAY_PARTS],
      }),
    );
  }
  return ok(requested);
}

/** Minutes comptées pour une absence à l'appel journalier : la durée de la journée, ou sa moitié pour un appel d'une demi-journée. */
export function dailyMinutesFor(dailyMinutes: number | null, dayPart: DayPart): number | null {
  if (dailyMinutes === null) return null;
  return dayPart === "FULL" ? dailyMinutes : Math.round(dailyMinutes / 2);
}

/**
 * Politique applicable : celle du niveau d'enseignement de la classe, sinon la politique par défaut de
 * l'établissement (`'*'`), sinon aucune (tout est permis, aucune fenêtre).
 */
export function selectPolicy(
  policies: readonly CallPolicy[],
  institutionId: string,
  educationLevelCode: string | null,
): CallPolicy | null {
  const mine = policies.filter((p) => p.institutionId === institutionId);
  return (
    (educationLevelCode ? mine.find((p) => p.educationLevelCode === educationLevelCode) : undefined) ??
    mine.find((p) => p.educationLevelCode === "*") ??
    null
  );
}

/** Durée (minutes) d'une séance d'après ses bornes, ou celle fournie. */
export function durationOf(startsAt: Date | null, endsAt: Date | null, provided: number | null): number | null {
  if (provided !== null) return provided;
  if (startsAt && endsAt && endsAt > startsAt) return Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  return null;
}
