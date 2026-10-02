/** Aides communes des cas d'usage : périmètre, lecture « dans le périmètre », noms d'élèves, charges d'événements. */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { StateassignCode, conflict, notFound, validation } from "../domain/errors";
import type { AssignmentRecord, AssignmentStatus, ReceivableRecord, Uuid } from "../domain/types";
import { moneyDto } from "./presenters";
import * as repo from "../infrastructure/repository";
import type { StateassignDeps } from "./deps";

/** Périmètre : un contexte lié à un établissement ne voit que celui-ci (la RLS isole déjà par tenant). */
export const inScope = (ctx: RequestContext, institutionId: Uuid): boolean => !ctx.institutionId || ctx.institutionId === institutionId;

export async function loadAssignmentInScope(tx: Tx, ctx: RequestContext, id: Uuid, forUpdate = false): Promise<Result<AssignmentRecord, AppError>> {
  const a = await repo.getAssignment(tx, id, { forUpdate });
  if (!a || !inScope(ctx, a.institutionId)) return err(notFound(StateassignCode.ASSIGNMENT_NOT_FOUND, "Dossier d'affectation", id));
  return ok(a);
}

/** « NOM Prénom » par élève : décoration, un échec de l'annuaire ne casse jamais une lecture. */
export async function namesOf(deps: StateassignDeps, ctx: RequestContext, studentIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>> {
  const unique = [...new Set(studentIds)];
  if (unique.length === 0) return new Map();
  try {
    return await deps.ports.students.names(ctx, unique);
  } catch (e) {
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "stateassign : annuaire des élèves indisponible, noms omis");
    return new Map();
  }
}

/** Concurrence optimiste : la ligne a changé depuis la lecture du client (`row_version`). */
export const versionConflict = (): AppError => conflict(StateassignCode.VERSION_CONFLICT, "Cet élément a été modifié entre-temps : rechargez-le puis recommencez.");

export function reasonOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length >= 5 ? v : null;
}

export const reasonRequired = (field = "reason"): AppError => validation(StateassignCode.INVALID_INPUT, "Un motif de 5 caractères minimum est requis.", field);

export function assignmentPayload(a: AssignmentRecord, previous: AssignmentStatus | null): { v: 1 } & Record<string, unknown> {
  return {
    v: 1,
    assignmentId: a.id,
    enrollmentId: a.enrollmentId,
    studentId: a.studentId,
    institutionId: a.institutionId,
    academicYearId: a.academicYearId,
    version: a.version,
    status: a.status,
    previousStatus: previous,
    source: a.source,
  };
}

export function receivablePayload(r: ReceivableRecord, daysOverdue: number): { v: 1 } & Record<string, unknown> {
  return {
    v: 1,
    receivableId: r.id,
    assignmentId: r.assignmentId,
    enrollmentId: r.enrollmentId,
    studentId: r.studentId,
    institutionId: r.institutionId,
    dueOn: r.dueOn,
    expected: moneyDto(r.expected),
    received: moneyDto(r.received),
    status: r.status,
    daysOverdue,
  };
}
