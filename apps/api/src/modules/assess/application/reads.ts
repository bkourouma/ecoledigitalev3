/**
 * Lectures de notes PUBLIÉES.
 *
 *  - `listPublishedGrades` : API publique pour `results` (et `higher`) — uniquement des notes `PUBLISHED`, y compris
 *    celles des types masqués aux élèves (publiés pour le calcul), tri déterministe. Aucun nom d'élève.
 *  - `listMyGrades` / `listChildGrades` : lecture de l'élève et du tuteur — notes publiées ET visibles, jamais celles des
 *    autres (le lien tuteur ↔ élève est vérifié par le port à CHAQUE lecture, AC7.1).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { AssessCode, forbidden } from "../domain/errors";
import type { PublishedGrade, SessionNo } from "../domain/types";
import { listPublished } from "../infrastructure/grades-repository";
import { inTx, type AssessDeps } from "./deps";

export interface ListPublishedInput {
  classroomId: string;
  academicPeriodId?: string | undefined;
  nodeIds?: readonly string[] | undefined;
  sessionNo?: SessionNo | undefined;
  enrollmentIds?: readonly string[] | undefined;
  tx?: Tx | undefined;
}

export async function listPublishedGrades(deps: AssessDeps, ctx: RequestContext, input: ListPublishedInput): Promise<Result<PublishedGrade[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await listPublished(tx, {
          classroomId: input.classroomId,
          academicPeriodId: input.academicPeriodId,
          nodeIds: input.nodeIds,
          sessionNo: input.sessionNo,
          enrollmentIds: input.enrollmentIds,
          includeHidden: true,
        }),
      ),
    { readOnly: true, tx: input.tx },
  );
}

export interface FamilyReadInput {
  academicPeriodId?: string | undefined;
  curriculumNodeId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface FamilyPage {
  items: PublishedGrade[];
  nextCursor: string | null;
}

async function pageOf(tx: Tx, studentId: string, input: FamilyReadInput): Promise<FamilyPage> {
  const limit = Math.min(input.limit ?? 50, 200);
  const rows = await listPublished(tx, {
    studentId,
    academicPeriodId: input.academicPeriodId,
    nodeIds: input.curriculumNodeId ? [input.curriculumNodeId] : undefined,
    includeHidden: false,
    limit,
    cursor: input.cursor,
  });
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? `${last.assessedOn}|${last.gradeId}` : null };
}

/** Notes publiées et visibles de l'élève connecté. */
export async function listMyGrades(deps: AssessDeps, ctx: RequestContext, input: FamilyReadInput = {}): Promise<Result<FamilyPage, AppError>> {
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  const studentId = await deps.ports.guardianship.studentIdForUser(ctx, ctx.userId);
  if (!studentId) return err(forbidden(AssessCode.NOT_VISIBLE, "Aucun profil d'élève n'est lié à votre compte."));
  return inTx(deps, ctx, async (tx) => ok(await pageOf(tx, studentId, input)), { readOnly: true });
}

/** Notes publiées et visibles d'un enfant : le lien de tutelle est revérifié à chaque lecture. */
export async function listChildGrades(deps: AssessDeps, ctx: RequestContext, input: FamilyReadInput & { studentId: string }): Promise<Result<FamilyPage, AppError>> {
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (!(await deps.ports.guardianship.isGuardianOf(ctx, ctx.userId, input.studentId))) {
    return err(forbidden(AssessCode.NOT_VISIBLE, "Vous n'êtes pas le tuteur de cet élève.", { studentId: input.studentId }));
  }
  return inTx(deps, ctx, async (tx) => ok(await pageOf(tx, input.studentId, input)), { readOnly: true });
}
