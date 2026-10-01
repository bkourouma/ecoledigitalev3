/**
 * Saisie des notes : feuille d'une évaluation et saisie EN LOT (smartphone, connexion faible).
 *
 *  - TOUT OU RIEN : un lot est une transaction ; une ligne invalide ou périmée annule tout le lot.
 *  - IDEMPOTENT : une ligne dont la valeur est déjà celle demandée n'écrit rien ; une clé d'idempotence rejouée renvoie
 *    le résultat enregistré (même contenu) ou un conflit (contenu différent).
 *  - SANS ÉCRASEMENT SILENCIEUX : une ligne existante dont la valeur diffère exige la `rowVersion` lue par le client ;
 *    sinon, ou si elle a changé, `409 assess.stale_grade` (le second de deux enseignants concurrents).
 *  - Une feuille n'est modifiable qu'en brouillon ; sur une feuille publiée, la voie est la révision approuvée.
 *  - Aucune note dans l'audit ni dans les journaux : seulement des comptages.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import { AssessCode, conflict, validation } from "../domain/errors";
import { normalizeEntry, payloadHash, planSave, type EntryInput, type NormalizedEntry } from "../domain/grades";
import type { Assessment, Grade } from "../domain/types";
import { getSettingsRow } from "../infrastructure/assessments-repository";
import { getReceipt, insertGrades, insertReceipt, listGradesOf, updateGrades } from "../infrastructure/grades-repository";
import { getActiveLock } from "../infrastructure/revisions-repository";
import { guarded } from "../infrastructure/db-errors";
import { EventBuffer, inTx, type AssessCaps, type AssessDeps } from "./deps";
import type { RosterEntry } from "./ports";
import { ensureReadAccess, ensureTeacherAccess, loadAssessment } from "./support";

export interface GradeSheet {
  assessment: Assessment;
  grades: Grade[];
  /** Inscriptions actives de la classe sans ligne sur la feuille (à saisir ; reçoivent `NOT_GRADED` à la soumission). */
  pending: RosterEntry[];
}

export async function getGradeSheet(deps: AssessDeps, ctx: RequestContext, input: { assessmentId: string; caps?: AssessCaps | undefined }): Promise<Result<GradeSheet, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const a = await loadAssessment(tx, input.assessmentId);
      if (!a.ok) return a;
      const access = await ensureReadAccess(deps, ctx, a.value, input.caps ?? {});
      if (!access.ok) return access;
      const grades = await listGradesOf(tx, a.value.id);
      const have = new Set(grades.map((g) => g.enrollmentId));
      const roster = await deps.ports.roster.listEnrollments(ctx, a.value.classroomId);
      return ok({ assessment: a.value, grades, pending: roster.filter((r) => r.active && !have.has(r.enrollmentId)) });
    },
    { readOnly: true },
  );
}

export interface SaveGradesInput {
  assessmentId: string;
  entries: readonly EntryInput[];
  idempotencyKey?: string | undefined;
  caps?: AssessCaps | undefined;
}

export interface SaveGradesResult {
  assessmentId: string;
  created: number;
  updated: number;
  unchanged: number;
  replayed: boolean;
  grades: Grade[];
}

export async function saveGrades(deps: AssessDeps, ctx: RequestContext, input: SaveGradesInput): Promise<Result<SaveGradesResult, AppError>> {
  if (input.entries.length === 0) return err(validation(AssessCode.INVALID_ENTRY, "Le lot ne contient aucune ligne.", "entries"));
  if (input.entries.length > deps.config.maxBatchSize) {
    return err(validation(AssessCode.INVALID_ENTRY, `Un lot contient ${deps.config.maxBatchSize} lignes au plus.`, "entries"));
  }
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    // FOR SHARE : une transition (UPDATE de l'évaluation) attend la fin du lot ; deux lots se partagent le verrou.
    const loaded = await loadAssessment(tx, input.assessmentId, "share");
    if (!loaded.ok) return loaded;
    const a = loaded.value;
    const access = await ensureTeacherAccess(deps, ctx, a, caps);
    if (!access.ok) return access;
    if (a.status !== "DRAFT") {
      return err(
        conflict(AssessCode.GRADE_FROZEN, "Les notes de cette feuille sont figées : retournez-la en brouillon, ou demandez une révision si elle est publiée.", { status: a.status }),
      );
    }
    const lock = await getActiveLock(tx, a.classroomId, a.academicPeriodId);
    if (lock && lock.lockedSessions.includes(a.sessionNo)) {
      return err(conflict(AssessCode.PERIOD_LOCKED, "La période de cette classe est verrouillée pour cette session.", { classroomId: a.classroomId, academicPeriodId: a.academicPeriodId }));
    }

    const settings = await getSettingsRow(tx);
    const normalized: NormalizedEntry[] = [];
    for (const raw of input.entries) {
      const n = normalizeEntry(raw, a.scaleMax, settings.maxScoreDecimals);
      if (!n.ok) return n;
      normalized.push(n.value);
    }
    if (new Set(normalized.map((n) => n.enrollmentId)).size !== normalized.length) {
      return err(validation(AssessCode.INVALID_ENTRY, "Une inscription ne peut figurer qu'une fois dans le lot.", "entries"));
    }

    const hash = payloadHash(normalized);
    if (input.idempotencyKey) {
      const receipt = await getReceipt(tx, a.id, input.idempotencyKey);
      if (receipt) {
        if (receipt.payloadHash !== hash) {
          return err(conflict(AssessCode.IDEMPOTENCY_CONFLICT, "Cette clé d'idempotence a déjà servi pour un lot différent.", { idempotencyKey: input.idempotencyKey }));
        }
        // Le reçu garde les comptages et les identifiants ; les notes sont relues (valeurs courantes, jamais figées).
        const stored = receipt.result as { created: number; updated: number; unchanged: number; gradeIds: string[] };
        const wanted = new Set(stored.gradeIds);
        const grades = (await listGradesOf(tx, a.id)).filter((g) => wanted.has(g.id));
        return ok({ assessmentId: a.id, created: stored.created, updated: stored.updated, unchanged: stored.unchanged, replayed: true, grades });
      }
    }

    const roster = new Map((await deps.ports.roster.listEnrollments(ctx, a.classroomId)).map((r) => [r.enrollmentId, r]));
    const existing = new Map((await listGradesOf(tx, a.id)).map((g) => [g.enrollmentId, g]));
    const plan = planSave(normalized, existing);

    const stale = plan.filter((p) => p.action === "stale");
    if (stale.length > 0) {
      return err(
        conflict(AssessCode.STALE_GRADE, "Des notes ont été modifiées par quelqu'un d'autre depuis votre lecture : rechargez la feuille.", {
          enrollmentIds: stale.map((s) => s.entry.enrollmentId),
          currentVersions: Object.fromEntries(stale.map((s) => [s.entry.enrollmentId, s.existing?.rowVersion ?? null])),
        }),
      );
    }

    const toCreate = plan.filter((p) => p.action === "create");
    for (const p of toCreate) {
      const member = roster.get(p.entry.enrollmentId);
      if (!member || member.classroomId !== a.classroomId) {
        return err(validation(AssessCode.UNKNOWN_ENROLLMENT, "Cette inscription n'appartient pas à la classe de l'évaluation.", `entries.${p.entry.enrollmentId}`));
      }
      if (!member.active) return err(validation(AssessCode.UNKNOWN_ENROLLMENT, "Cette inscription n'est plus active : aucune nouvelle note.", `entries.${p.entry.enrollmentId}`));
    }
    const toUpdate = plan.filter((p) => p.action === "update");
    const now = deps.clock.now();

    let written: Grade[] = [];
    try {
      written = [
        ...(await guarded(() =>
          tx.transaction((sp) =>
            insertGrades(
              sp,
              ctx.tenantId,
              toCreate.map((p) => ({
                id: deps.newId(),
                assessmentId: a.id,
                enrollmentId: p.entry.enrollmentId,
                studentId: (roster.get(p.entry.enrollmentId) as RosterEntry).studentId,
                score: p.entry.score,
                entryStatus: p.entry.entryStatus,
                comment: p.entry.comment,
              })),
              ctx.userId,
              now,
            ),
          ),
        )),
        ...(await guarded(() =>
          updateGrades(
            tx,
            ctx.tenantId,
            toUpdate.map((p) => ({ id: (p.existing as Grade).id, expectedVersion: (p.existing as Grade).rowVersion, score: p.entry.score, entryStatus: p.entry.entryStatus, comment: p.entry.comment })),
            ctx.userId,
            now,
          ),
        )),
      ];
    } catch (e) {
      // Deux lots créant la même ligne en même temps : le second voit une violation d'unicité (assessment, enrollment).
      if (isUniqueViolation(e)) return err(conflict(AssessCode.STALE_GRADE, "Une note vient d'être créée par quelqu'un d'autre : rechargez la feuille.", {}));
      throw e;
    }
    if (written.length !== toCreate.length + toUpdate.length) {
      return err(conflict(AssessCode.STALE_GRADE, "Des notes ont été modifiées par quelqu'un d'autre pendant l'enregistrement : rechargez la feuille.", {}));
    }

    const byEnrollment = new Map<string, Grade>([...existing, ...written.map((g) => [g.enrollmentId, g] as const)]);
    const result: SaveGradesResult = {
      assessmentId: a.id,
      created: toCreate.length,
      updated: toUpdate.length,
      unchanged: plan.length - toCreate.length - toUpdate.length,
      replayed: false,
      grades: normalized.map((n) => byEnrollment.get(n.enrollmentId) as Grade),
    };

    if (input.idempotencyKey) {
      try {
        await tx.transaction((sp) =>
          insertReceipt(sp, {
            id: deps.newId(),
            tenantId: ctx.tenantId,
            assessmentId: a.id,
            key: input.idempotencyKey as string,
            payloadHash: hash,
            result: { created: result.created, updated: result.updated, unchanged: result.unchanged, gradeIds: result.grades.map((g) => g.id) },
            by: ctx.userId,
            now,
          }),
        );
      } catch (e) {
        if (isUniqueViolation(e)) return err(conflict(AssessCode.IDEMPOTENCY_CONFLICT, "Cette clé d'idempotence est en cours d'utilisation par un autre lot.", {}));
        throw e;
      }
    }

    if (result.created + result.updated > 0) {
      const events = new EventBuffer(deps, ctx);
      events.audit({
        action: "assess.grades.saved",
        entity: "assessment",
        entityId: a.id,
        metadata: { created: result.created, updated: result.updated, unchanged: result.unchanged, classroomId: a.classroomId, academicPeriodId: a.academicPeriodId },
        severity: "info",
      });
      await events.flush(tx);
    }
    return ok(result);
  });
}
