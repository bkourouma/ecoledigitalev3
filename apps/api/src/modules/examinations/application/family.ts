/**
 * VUE FAMILLE : « l'examen de mon enfant » — convocation (place), attestation, issue publiée. L'élève lui-même voit les siens.
 *
 *  - Le lien de tutelle est relu à CHAQUE requête auprès du port (`FamilyLinks`) : jamais mis en cache, jamais déduit d'un jeton.
 *  - Hors périmètre (enfant non lié) : 404, indiscernable d'une ressource inexistante.
 *  - Seules les sessions OFFICIELLES apparaissent (un examen blanc n'est pas officiel) ; l'issue n'est visible qu'une fois le résultat
 *    PUBLIÉ, et jamais accompagnée d'une note, d'une moyenne ni d'un rang.
 *  - Un document révoqué ne se montre plus ; un document émis se télécharge (lecture journalisée, `issued-documents.ts`).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamFamilyExamDto, ExamIssuedDocumentDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExamCode, notFound } from "../domain/errors";
import type { CandidateRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as ref from "../infrastructure/reference-repo";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import * as out from "../infrastructure/outputs-repo";
import { displayNameOf, isPlaceholder, toDocumentDto } from "./dto";
import { inTx, type ExaminationsDeps } from "./deps";

async function examsOfStudent(deps: ExaminationsDeps, ctx: RequestContext, studentId: string): Promise<Result<ExamFamilyExamDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const candidates = (await cand.listCandidatesOfStudent(tx, studentId)).filter((c) => c.registrationStatus === "REGISTERED");
      const types = new Map((await ref.listTypes(tx)).map((t) => [t.id, t]));
      const docs = await out.listDocumentsOfCandidates(tx, candidates.map((c) => c.id));
      const items: ExamFamilyExamDto[] = [];
      for (const c of candidates) {
        const s = await sess.getSession(tx, c.sessionId);
        if (!s || s.sessionKind !== "OFFICIAL") continue;
        const type = types.get(s.examTypeId);
        const assignment = (await sess.listAssignmentViews(tx, s.id)).find((a) => a.candidateId === c.id) ?? null;
        const result = await res.getResultOfCandidate(tx, c.id);
        items.push({
          candidateId: c.id,
          studentId,
          displayName: displayNameOf(c),
          sessionId: s.id,
          sessionLabel: s.label,
          examTypeCode: type?.code ?? "",
          examTypeLabel: type?.label ?? "",
          sessionYear: s.sessionYear,
          sessionKind: s.sessionKind,
          registrationStatus: c.registrationStatus,
          candidateNumber: c.candidateNumber,
          startsOn: s.startsOn,
          assignment: assignment ? { centerName: assignment.centerName, roomCode: assignment.roomCode, seatNumber: assignment.seatNumber } : null,
          outcome: result && result.status === "PUBLISHED" ? result.resultCode : null,
          documents: docs.filter((d) => d.candidateId === c.id && d.status === "ISSUED").map((d) => toDocumentDto(d, c.candidateNumber)),
          demoRules: isPlaceholder(type?.sourceKind, s.sourceKind),
        });
      }
      return ok(items);
    },
    { readOnly: true },
  );
}

/** Examens de l'élève rattaché au compte de l'appelant (portail élève). */
export async function listMyExams(deps: ExaminationsDeps, ctx: RequestContext): Promise<Result<ExamFamilyExamDto[], AppError>> {
  if (!ctx.userId) return ok([]);
  const studentId = await deps.ports.family.studentIdForUser(ctx, ctx.userId);
  if (!studentId) return ok([]);
  return examsOfStudent(deps, ctx, studentId);
}

/** Examens d'un enfant lié à l'appelant (portail parent) ; hors périmètre : 404. */
export async function listChildExams(deps: ExaminationsDeps, ctx: RequestContext, studentId: string): Promise<Result<ExamFamilyExamDto[], AppError>> {
  if (!ctx.userId || !(await deps.ports.family.isGuardianOf(ctx, ctx.userId, studentId))) return err(notFound(ExamCode.NOT_FOUND, "Élève", studentId));
  return examsOfStudent(deps, ctx, studentId);
}

/** Examens de tous les enfants liés (écran « examens de mes enfants »). */
export async function listAllChildrenExams(deps: ExaminationsDeps, ctx: RequestContext): Promise<Result<ExamFamilyExamDto[], AppError>> {
  if (!ctx.userId) return ok([]);
  const children = await deps.ports.family.childrenOf(ctx, ctx.userId);
  const items: ExamFamilyExamDto[] = [];
  for (const studentId of children) {
    const r = await examsOfStudent(deps, ctx, studentId);
    if (!r.ok) return r;
    items.push(...r.value);
  }
  return ok(items);
}

export async function listMyExamDocuments(deps: ExaminationsDeps, ctx: RequestContext): Promise<Result<ExamIssuedDocumentDto[], AppError>> {
  const r = await listMyExams(deps, ctx);
  return r.ok ? ok(r.value.flatMap((e) => e.documents)) : r;
}

export async function listChildExamDocuments(deps: ExaminationsDeps, ctx: RequestContext, studentId: string): Promise<Result<ExamIssuedDocumentDto[], AppError>> {
  const r = await listChildExams(deps, ctx, studentId);
  return r.ok ? ok(r.value.flatMap((e) => e.documents)) : r;
}

/** Autorisation d'un document : l'élève lui-même, ou un tuteur lié (relu à chaque requête). */
export function familyAccess(deps: ExaminationsDeps, ctx: RequestContext): (c: CandidateRow) => Promise<boolean> {
  return async (c) => {
    // Un candidat LIBRE n'a ni dossier élève ni tuteur lié : aucun accès famille (Q-E15).
    if (!ctx.userId || !c.studentId) return false;
    const mine = await deps.ports.family.studentIdForUser(ctx, ctx.userId);
    if (mine && mine === c.studentId) return true;
    return deps.ports.family.isGuardianOf(ctx, ctx.userId, c.studentId);
  };
}
