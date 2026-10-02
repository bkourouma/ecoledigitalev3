/**
 * Faits publiés pour les autres modules (analytics, bulletins, examens) — lectures seules, sans montant ni nom :
 * l'état du dossier d'une inscription (statut, référence présente, vérifiée par un humain).
 *
 * « Affecté(e) » sur un bulletin = le TYPE DE FINANCEMENT de l'inscription (`academic`), jamais la décision de fin d'année
 * (correction du legacy, parité P-S-05). Ces faits n'en décident pas : ils disent si un dossier vérifié existe.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AssignmentStatus, Uuid } from "../domain/types";
import * as repo from "../infrastructure/repository";
import { inTx, type StateassignDeps } from "./deps";

export interface AssignmentFacts {
  readonly enrollmentId: Uuid;
  readonly hasAssignment: boolean;
  readonly status: AssignmentStatus | null;
  readonly version: number | null;
  readonly referencePresent: boolean;
  /** Un humain a vérifié le dossier (la référence d'`academic` en provient). */
  readonly verified: boolean;
}

export async function getAssignmentFacts(deps: StateassignDeps, ctx: RequestContext, input: { enrollmentId: Uuid }): Promise<Result<AssignmentFacts, AppError>> {
  return inTx<AssignmentFacts>(
    deps,
    ctx,
    async (tx) => {
      const a = (await repo.getLiveAssignmentOfEnrollment(tx, input.enrollmentId)) ?? (await repo.getCurrentAssignmentOfEnrollment(tx, input.enrollmentId));
      if (!a) return ok({ enrollmentId: input.enrollmentId, hasAssignment: false, status: null, version: null, referencePresent: false, verified: false });
      return ok({ enrollmentId: input.enrollmentId, hasAssignment: true, status: a.status, version: a.version, referencePresent: a.reference.length > 0, verified: a.verifiedAt !== null });
    },
    { readOnly: true },
  );
}

export async function listAssignmentsByStatus(
  deps: StateassignDeps,
  ctx: RequestContext,
  input: { status: AssignmentStatus; institutionId?: Uuid | undefined; academicYearId?: Uuid | undefined; limit?: number | undefined },
): Promise<Result<Array<{ assignmentId: Uuid; enrollmentId: Uuid; studentId: Uuid; version: number }>, AppError>> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 200), 1), 500);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const page = await repo.listAssignments(tx, { institutionId: ctx.institutionId ?? input.institutionId, academicYearId: input.academicYearId, status: input.status, includeHistory: true, limit, offset: 0 });
      return ok(page.items.map((a) => ({ assignmentId: a.id, enrollmentId: a.enrollmentId, studentId: a.studentId, version: a.version })));
    },
    { readOnly: true },
  );
}
