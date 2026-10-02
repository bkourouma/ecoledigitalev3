/**
 * Bilan annuel : instantané SCELLÉ et versionné d'une inscription pour une année.
 *
 * Le bilan RASSEMBLE des résultats déjà calculés (résultat d'année FINAL de `results`, décision confirmée du conseil, synthèse de
 * compétences en compteurs, assiduité dérivée d'`attendance`) ; il ne calcule rien. Scellé (permission sensible), il est immuable
 * (déclencheurs SQL) ; corriger = version n+1 avec motif (l'ancienne passe `SUPERSEDED` dans la même transaction). Les familles ne voient
 * que les bilans SCELLÉS dont le PDF est ÉMIS (`reportcard_id` renseigné par l'événement de rendu).
 * Le PDF est demandé à `reportcards` par un abonné du worker à `primary_school.annual_review.sealed` (le scellement ne dépend pas du rendu).
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { PrimaryPrepareReviewsBody } from "@ecoledigitale/contracts/src/v2/primary_school";
import type { Tx } from "@ecoledigitale/database";
import { sealBlockers, reviewHash, snapshotOf } from "../domain/review";
import { PrimaryCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { PrimaryEvents } from "../domain/events";
import type { AnnualReview, CallerCaps, SourceKind, Uuid } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import { summarizeInSql } from "../infrastructure/assessments-repository";
import {
  deleteStaleDraftReviews,
  getLiveReview,
  getReviewRow,
  insertReviewRow,
  listReviewRows,
  refreshDraftReview,
  sealReviewRow,
  setReviewDraftOrReady,
  setReviewReportcard,
  supersedeReviewRow,
} from "../infrastructure/reviews-repository";
import { requireClassAccess, requireFamilyStudent } from "./access";
import { outcomeCodeOfDecision } from "./council";
import { actorOf, EventBuffer, inTx, type PrimarySchoolDeps } from "./deps";
import { settingsOf } from "./settings";
import type { ClassroomInfo, RosterEntryInfo } from "./ports";

export interface ReviewView extends AnnualReview {
  studentName: string | null;
  /** Origine du jeu de règles épinglé (`placeholder` : « Règles de démonstration — document sans valeur officielle »). */
  ruleSourceKind: SourceKind | null;
}

interface Gathered {
  yearResultRef: Uuid | null;
  decisionRef: Uuid | null;
  outcomeCode: string | null;
  ruleVersionRef: Uuid | null;
  attendanceSummary: Record<string, unknown>;
  competencySummary: Record<string, Record<string, number>>;
}

/** Rassemble ce que le bilan fige (lectures de ports PUIS compteurs SQL), pour une inscription. */
async function gather(deps: PrimarySchoolDeps, ctx: RequestContext, tx: Tx, scope: { enrollmentId: Uuid; classroomId: Uuid; yearId: Uuid; lastPeriodId: Uuid | null }): Promise<Gathered> {
  const { enrollmentId, yearId } = scope;
  const year = await deps.ports.results.getYearResult(ctx, { enrollmentId, academicYearId: yearId, lastPeriodId: scope.lastPeriodId });
  const decision = scope.lastPeriodId ? await deps.ports.results.getConfirmedYearDecision(ctx, { enrollmentId, classroomId: scope.classroomId, periodId: scope.lastPeriodId }) : null;
  const attendance = await deps.ports.attendance.summarize(ctx, { enrollmentId, academicYearId: yearId });
  const competencySummary = await summarizeInSql(tx, enrollmentId, null);
  return {
    yearResultRef: year.complete ? year.yearResultRef : null,
    decisionRef: decision?.decisionId ?? null,
    outcomeCode: decision ? outcomeCodeOfDecision(decision.finalCode) : null,
    ruleVersionRef: year.ruleVersionRef,
    attendanceSummary: { openDays: attendance.openDays, absentDays: attendance.absentDays, justifiedAbsentDays: attendance.justifiedAbsentDays, lateCount: attendance.lateCount },
    competencySummary,
  };
}

/** Dernière période de l'année (celle qui porte la décision de fin d'année). */
async function lastPeriodOf(deps: PrimarySchoolDeps, ctx: RequestContext, yearId: Uuid): Promise<Uuid | null> {
  const periods = [...(await deps.ports.classrooms.listPeriods(ctx, yearId))].sort((a, b) => b.ordinal - a.ordinal);
  return periods[0]?.id ?? null;
}

/** Origine du jeu de règles : lue UNE fois par classe, sur la dernière période de l'année. */
export async function ruleSourceOfClass(deps: PrimarySchoolDeps, ctx: RequestContext, classroom: ClassroomInfo): Promise<SourceKind | null> {
  try {
    const periods = [...(await deps.ports.classrooms.listPeriods(ctx, classroom.academicYearId))].sort((a, b) => b.ordinal - a.ordinal);
    const last = periods[0];
    if (!last) return null;
    return await deps.ports.results.getRuleSourceKind(ctx, { classroomId: classroom.id, periodId: last.id });
  } catch (e) {
    if ((e as { code?: string }).code === PrimaryCode.PORT_UNAVAILABLE) return null;
    throw e;
  }
}

async function decorate(deps: PrimarySchoolDeps, ctx: RequestContext, reviews: readonly AnnualReview[]): Promise<ReviewView[]> {
  const sourceByClass = new Map<Uuid, SourceKind | null>();
  const namesByClass = new Map<Uuid, Map<Uuid, string | null>>();
  const out: ReviewView[] = [];
  for (const r of reviews) {
    if (!sourceByClass.has(r.classroomId)) {
      const classroom = await deps.ports.classrooms.getClassroom(ctx, r.classroomId);
      sourceByClass.set(r.classroomId, classroom ? await ruleSourceOfClass(deps, ctx, classroom) : null);
      const roster = await deps.ports.classrooms.listRoster(ctx, r.classroomId).catch(() => [] as readonly RosterEntryInfo[]);
      namesByClass.set(r.classroomId, new Map(roster.map((x) => [x.enrollmentId, x.displayName])));
    }
    out.push({ ...r, studentName: namesByClass.get(r.classroomId)?.get(r.enrollmentId) ?? null, ruleSourceKind: sourceByClass.get(r.classroomId) ?? null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Préparation
// ---------------------------------------------------------------------------

export interface PrepareReviewsResult {
  created: number;
  refreshed: number;
  skippedSealed: number;
  reviews: ReviewView[];
}

export async function prepareAnnualReviews(deps: PrimarySchoolDeps, ctx: RequestContext, input: PrimaryPrepareReviewsBody, caps: CallerCaps): Promise<Result<PrepareReviewsResult, AppError>> {
  const access = await requireClassAccess(deps, ctx, input.classroomId, caps);
  if (!access.ok) return access;
  const { classroom } = access.value;
  if (classroom.academicYearId !== input.academicYearId) return err(validation(PrimaryCode.INVALID_INPUT, "Cette année n'est pas celle de la classe.", "academicYearId"));
  const roster = await deps.ports.classrooms.listRoster(ctx, classroom.id);
  const closed = await deps.ports.periods.allPeriodsClosed(ctx, { classroomId: classroom.id, academicYearId: input.academicYearId });
  const lastPeriodId = await lastPeriodOf(deps, ctx, input.academicYearId);

  const result = await inTx(deps, ctx, async (tx) => {
    const settings = await settingsOf(tx, classroom.institutionId);
    let created = 0;
    let refreshed = 0;
    let skippedSealed = 0;
    const ids: Uuid[] = [];
    for (const r of roster) {
      const g = await gather(deps, ctx, tx, { enrollmentId: r.enrollmentId, classroomId: classroom.id, yearId: input.academicYearId, lastPeriodId });
      const live = await getLiveReview(tx, r.enrollmentId, input.academicYearId, true);
      const base = { classroomId: classroom.id, gradeLevelCode: classroom.gradeLevelCode ?? "", yearResultRef: g.yearResultRef, decisionRef: g.decisionRef, outcomeCode: g.outcomeCode, competencySummary: g.competencySummary, attendanceSummary: g.attendanceSummary, ruleVersionRef: g.ruleVersionRef };
      if (!live) {
        const row = await guarded(() => insertReviewRow(tx, { id: deps.newId(), tenantId: ctx.tenantId, institutionId: classroom.institutionId, yearId: input.academicYearId, enrollmentId: r.enrollmentId, studentId: r.studentId, version: 1, ...base }));
        created += 1;
        ids.push(row.id);
        if (sealBlockers(row, { councilRequired: settings.councilRequiredForBilan, allPeriodsClosed: closed }).length === 0) await setReviewDraftOrReady(tx, row.id, "READY");
      } else if (live.status === "SEALED") {
        skippedSealed += 1;
        ids.push(live.id);
      } else {
        const row = await guarded(() => refreshDraftReview(tx, live.id, base));
        refreshed += 1;
        ids.push(row.id);
        if (sealBlockers(row, { councilRequired: settings.councilRequiredForBilan, allPeriodsClosed: closed }).length === 0) await setReviewDraftOrReady(tx, row.id, "READY");
      }
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.annual_review.prepared", resourceType: "classroom_year", resourceId: `${classroom.id}:${input.academicYearId}`, metadata: { classroomId: classroom.id, academicYearId: input.academicYearId, created, refreshed, skippedSealed } });
    await events.flush(tx);
    const rows = await listReviewRows(tx, { classroomId: classroom.id, yearId: input.academicYearId, liveOnly: true });
    return ok({ created, refreshed, skippedSealed, rows });
  });
  if (!result.ok) return result;
  return ok({ created: result.value.created, refreshed: result.value.refreshed, skippedSealed: result.value.skippedSealed, reviews: await decorate(deps, ctx, result.value.rows) });
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function listAnnualReviews(deps: PrimarySchoolDeps, ctx: RequestContext, filter: { classroomId?: Uuid | undefined; yearId?: Uuid | undefined; status?: AnnualReview["status"] | undefined }, caps: CallerCaps): Promise<Result<ReviewView[], AppError>> {
  if (filter.classroomId) {
    const access = await requireClassAccess(deps, ctx, filter.classroomId, caps);
    if (!access.ok) return access;
  } else if (!caps.allClasses) {
    return err(validation(PrimaryCode.INVALID_INPUT, "Précisez la classe (classroomId).", "classroomId"));
  }
  const rows = await inTx(deps, ctx, async (tx) => ok(await listReviewRows(tx, { classroomId: filter.classroomId, yearId: filter.yearId, status: filter.status, liveOnly: true })), { readOnly: true });
  if (!rows.ok) return rows;
  return ok(await decorate(deps, ctx, rows.value));
}

export async function getAnnualReview(deps: PrimarySchoolDeps, ctx: RequestContext, id: Uuid, caps: CallerCaps): Promise<Result<ReviewView, AppError>> {
  const row = await inTx(deps, ctx, async (tx) => ok(await getReviewRow(tx, id)), { readOnly: true });
  if (!row.ok) return row;
  if (!row.value) return err(notFound(PrimaryCode.REVIEW_NOT_FOUND, "Bilan annuel", id));
  const access = await requireClassAccess(deps, ctx, row.value.classroomId, caps);
  if (!access.ok) return access;
  return ok((await decorate(deps, ctx, [row.value]))[0] as ReviewView);
}

/** Famille : bilans SCELLÉS et ÉMIS (PDF) des élèves liés ; `studentId = null` : l'élève connecté. */
export async function listFamilyAnnualReviews(deps: PrimarySchoolDeps, ctx: RequestContext, studentId: Uuid | null): Promise<Result<ReviewView[], AppError>> {
  const student = await requireFamilyStudent(deps, ctx, studentId);
  if (!student.ok) return student;
  const rows = await inTx(deps, ctx, async (tx) => ok(await listReviewRows(tx, { studentId: student.value, liveOnly: true, sealedOnly: true })), { readOnly: true });
  if (!rows.ok) return rows;
  return ok(await decorate(deps, ctx, rows.value.filter((r) => r.reportcardId !== null)));
}

// ---------------------------------------------------------------------------
// Scellement
// ---------------------------------------------------------------------------

export async function sealAnnualReview(deps: PrimarySchoolDeps, ctx: RequestContext, id: Uuid, caps: CallerCaps): Promise<Result<ReviewView, AppError>> {
  if (!ctx.userId) return err(forbidden("Un utilisateur authentifié est requis."));
  const userId = ctx.userId;
  const probe = await inTx(deps, ctx, async (tx) => ok(await getReviewRow(tx, id)), { readOnly: true });
  if (!probe.ok) return probe;
  if (!probe.value) return err(notFound(PrimaryCode.REVIEW_NOT_FOUND, "Bilan annuel", id));
  const access = await requireClassAccess(deps, ctx, probe.value.classroomId, caps);
  if (!access.ok) return access;
  const closed = await deps.ports.periods.allPeriodsClosed(ctx, { classroomId: probe.value.classroomId, academicYearId: probe.value.academicYearId });
  const lastPeriodId = await lastPeriodOf(deps, ctx, probe.value.academicYearId);

  const sealed = await inTx(deps, ctx, async (tx) => {
    const current = await getReviewRow(tx, id, true);
    if (!current) return err(notFound(PrimaryCode.REVIEW_NOT_FOUND, "Bilan annuel", id));
    if (current.status === "SEALED" || current.status === "SUPERSEDED") return err(conflict(PrimaryCode.REVIEW_SEALED, "Ce bilan est déjà scellé.", { status: current.status }));
    const settings = await settingsOf(tx, current.institutionId);
    // Données FRAÎCHES : le scellement fige l'état courant des résultats, de la décision et des compteurs.
    const g = await gather(deps, ctx, tx, { enrollmentId: current.enrollmentId, classroomId: current.classroomId, yearId: current.academicYearId, lastPeriodId });
    const next = { ...current, ...g };
    const blockers = sealBlockers(next, { councilRequired: settings.councilRequiredForBilan, allPeriodsClosed: closed });
    if (blockers.length > 0) {
      const first = blockers[0] as (typeof blockers)[number];
      return err(conflict(first.code, first.message, { blockers }));
    }
    const contentHash = reviewHash(next);
    const row = await guarded(() =>
      sealReviewRow(tx, id, { contentHash, by: userId, at: deps.clock.now(), yearResultRef: g.yearResultRef, decisionRef: g.decisionRef, outcomeCode: g.outcomeCode, competencySummary: g.competencySummary, attendanceSummary: g.attendanceSummary, ruleVersionRef: g.ruleVersionRef }),
    );
    const events = new EventBuffer(deps, ctx);
    events.add(
      PrimaryEvents.ANNUAL_REVIEW_SEALED,
      { v: 1, reviewId: row.id, enrollmentId: row.enrollmentId, classroomId: row.classroomId, academicYearId: row.academicYearId, version: row.version, contentHash },
      { type: "primary_school.annual_review", id: row.id },
    );
    events.audit({ action: "primary_school.annual_review.sealed", resourceType: "annual_review", resourceId: row.id, after: { version: row.version, contentHash }, metadata: { classroomId: row.classroomId, academicYearId: row.academicYearId }, sensitive: true });
    await events.flush(tx);
    return ok(row);
  });
  if (!sealed.ok) return sealed;
  return ok((await decorate(deps, ctx, [sealed.value]))[0] as ReviewView);
}

// ---------------------------------------------------------------------------
// Réémission (version n+1)
// ---------------------------------------------------------------------------

export async function reissueAnnualReview(deps: PrimarySchoolDeps, ctx: RequestContext, id: Uuid, input: { reason: string }, caps: CallerCaps): Promise<Result<ReviewView, AppError>> {
  if (!ctx.userId) return err(forbidden("Un utilisateur authentifié est requis."));
  const probe = await inTx(deps, ctx, async (tx) => ok(await getReviewRow(tx, id)), { readOnly: true });
  if (!probe.ok) return probe;
  if (!probe.value) return err(notFound(PrimaryCode.REVIEW_NOT_FOUND, "Bilan annuel", id));
  const access = await requireClassAccess(deps, ctx, probe.value.classroomId, caps);
  if (!access.ok) return access;
  const reason = input.reason.trim();
  if (reason.length < 10) return err(validation(PrimaryCode.INVALID_INPUT, "Le motif compte au moins 10 caractères.", "reason"));
  const lastPeriodId = await lastPeriodOf(deps, ctx, probe.value.academicYearId);

  const created = await inTx(deps, ctx, async (tx) => {
    const old = await getReviewRow(tx, id, true);
    if (!old) return err(notFound(PrimaryCode.REVIEW_NOT_FOUND, "Bilan annuel", id));
    if (old.status !== "SEALED") return err(conflict(PrimaryCode.REVIEW_NOT_SEALED, "Seul un bilan scellé se réémet : un brouillon se prépare à nouveau.", { status: old.status }));
    const g = await gather(deps, ctx, tx, { enrollmentId: old.enrollmentId, classroomId: old.classroomId, yearId: old.academicYearId, lastPeriodId });
    // Une seule version vivante : l'ancienne passe SUPERSEDED AVANT l'insertion de la suivante, dans la même transaction.
    const superseded = await guarded(() => supersedeReviewRow(tx, old.id));
    const next = await guarded(() =>
      insertReviewRow(tx, {
        id: deps.newId(), tenantId: ctx.tenantId, institutionId: old.institutionId, yearId: old.academicYearId, enrollmentId: old.enrollmentId, studentId: old.studentId, classroomId: old.classroomId,
        gradeLevelCode: old.gradeLevelCode, version: old.version + 1, yearResultRef: g.yearResultRef, decisionRef: g.decisionRef, outcomeCode: g.outcomeCode,
        competencySummary: g.competencySummary, attendanceSummary: g.attendanceSummary, ruleVersionRef: g.ruleVersionRef, supersedesId: old.id, supersedeReason: reason,
      }),
    );
    const events = new EventBuffer(deps, ctx);
    events.add(PrimaryEvents.ANNUAL_REVIEW_SUPERSEDED, { v: 1, reviewId: superseded.id, replacedByReviewId: next.id, enrollmentId: old.enrollmentId, academicYearId: old.academicYearId, version: superseded.version }, { type: "primary_school.annual_review", id: superseded.id });
    events.audit({ action: "primary_school.annual_review.reissued", resourceType: "annual_review", resourceId: next.id, reason, metadata: { supersedes: old.id, version: next.version, classroomId: old.classroomId }, sensitive: true });
    await events.flush(tx);
    return ok(next);
  });
  if (!created.ok) return created;
  return ok((await decorate(deps, ctx, [created.value]))[0] as ReviewView);
}

// ---------------------------------------------------------------------------
// Rendu du PDF (abonné du worker) et renseignement de l'identifiant émis
// ---------------------------------------------------------------------------

/** Demande à `reportcards` le PDF d'un bilan SCELLÉ, depuis l'instantané figé. Idempotent (par bilan) ; échec fermé si la nature n'est pas livrée. */
export async function requestReviewDocument(deps: PrimarySchoolDeps, ctx: RequestContext, reviewId: Uuid): Promise<Result<{ requested: boolean; documentId: Uuid | null }, AppError>> {
  const row = await inTx(deps, ctx, async (tx) => ok(await getReviewRow(tx, reviewId)), { readOnly: true });
  if (!row.ok) return row;
  const review = row.value;
  if (!review || review.status !== "SEALED" || !review.contentHash) return ok({ requested: false, documentId: null });
  if (review.reportcardId) return ok({ requested: false, documentId: review.reportcardId });
  const classroom = await deps.ports.classrooms.getClassroom(ctx, review.classroomId);
  const ruleSourceKind = classroom ? await ruleSourceOfClass(deps, ctx, classroom) : null;
  try {
    const doc = await deps.ports.documents.requestAnnualReview(ctx, {
      reviewId: review.id,
      title: "Bilan annuel",
      issuedAt: review.sealedAt ?? deps.clock.now(),
      content: snapshotOf(review) as unknown as Record<string, unknown>,
      contentHash: review.contentHash,
      ruleSourceKind,
    });
    return ok({ requested: true, documentId: doc.documentId });
  } catch (e) {
    // Nature de document non livrée / reportcards indisponible : échec FERMÉ (le worker rejoue), jamais un PDF sans instantané.
    if (isAppError(e)) return err(e);
    throw e;
  }
}

/** `reportcards.official_document.rendered` (nature ANNUAL_REVIEW, source = bilan) : renseigne UNE fois l'identifiant du document émis. */
export async function onReviewDocumentRendered(deps: PrimarySchoolDeps, ctx: RequestContext, input: { reviewId: Uuid; documentId: Uuid }): Promise<Result<{ updated: boolean }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const updated = await guarded(() => setReviewReportcard(tx, input.reviewId, input.documentId));
    return ok({ updated });
  });
}

/** Purge des brouillons de bilan restés intacts au-delà du délai (jamais un bilan prêt, scellé ou remplacé). Idempotent. */
export async function purgeStaleDraftReviews(deps: PrimarySchoolDeps, ctx: RequestContext): Promise<Result<{ purged: number }, AppError>> {
  const cutoff = new Date(deps.clock.now().getTime() - deps.config.draftReviewRetentionDays * 86_400_000);
  return inTx(deps, ctx, async (tx) => ok({ purged: await deleteStaleDraftReviews(tx, cutoff) }));
}

export { actorOf };
