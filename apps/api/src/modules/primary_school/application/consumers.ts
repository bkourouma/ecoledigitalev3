/**
 * Réactions aux événements des autres modules (abonnés du worker, `subscribers.ts`). Tolérance de lecture : un charge utile illisible
 * est IGNORÉE (journalisée), jamais une erreur qui rejouerait l'événement indéfiniment ; une défaillance transitoire (port non branché,
 * base) remonte pour que le worker rejoue.
 *
 *  - `tenancy.institution.created`                      -> instanciation du modèle de pack (PRIMARY seulement) ;
 *  - `academic.classroom_period.(grading_closed|closed|reopened)` -> miroir local du verrou de saisie (`period_locks`) ;
 *  - `results.decision.confirmed`                       -> dossier de conseil décidé + issue d'inscription de fin d'année ;
 *  - `reportcards.official_document.rendered` (ANNUAL_REVIEW) -> `reportcard_id` du bilan ;
 *  - `primary_school.annual_review.sealed`              -> demande du PDF à reportcards (ne bloque jamais le scellement).
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { z } from "zod";
import { ConsumedEvents } from "../domain/events";
import { PrimaryCode } from "../domain/errors";
import { upsertPeriodLock } from "../infrastructure/assessments-repository";
import { onDecisionConfirmed } from "./council";
import { inTx, type PrimarySchoolDeps } from "./deps";
import { onReviewDocumentRendered, requestReviewDocument } from "./reviews";
import { instantiatePrimaryReferenceData } from "./template";

const uuid = z.string().uuid();

const institutionCreated = z.object({ institutionId: uuid, pack: z.string(), educationSystem: z.string().optional() }).passthrough();
const classroomPeriod = z.object({ classroomId: uuid, periodId: uuid }).passthrough();
const decisionConfirmed = z.object({ enrollmentId: uuid, finalCode: z.string().nullable().optional(), academicPeriodId: uuid.nullable().optional() }).passthrough();
const documentRendered = z.object({ documentId: uuid, documentKind: z.string(), sourceId: uuid }).passthrough();
const reviewSealed = z.object({ reviewId: uuid }).passthrough();

export interface IncomingEvent {
  id: string;
  type: string;
  aggregateId?: string | undefined;
  payload: unknown;
  occurredAt?: Date | string | undefined;
}

/** Une erreur « bénigne » n'a aucun intérêt à être rejouée : ressource disparue, donnée déjà traitée. */
export function isBenignConsumerError(e: AppError): boolean {
  // `template_unavailable` : aucun modèle de pack pour ce système éducatif (pays non couvert) — attendu, pas une panne à rejouer.
  return e.kind === "not_found" || e.code === PrimaryCode.ARCHIVE_FROZEN || e.code === PrimaryCode.YEAR_FROZEN || e.code === PrimaryCode.TEMPLATE_UNAVAILABLE;
}

export async function onInstitutionCreated(deps: PrimarySchoolDeps, ctx: RequestContext, event: IncomingEvent): Promise<Result<{ applied: boolean }, AppError>> {
  const p = institutionCreated.safeParse(event.payload);
  if (!p.success) return ok({ applied: false });
  if (p.data.pack !== "PRIMARY") return ok({ applied: false });
  const r = await instantiatePrimaryReferenceData(deps, ctx, { institutionId: p.data.institutionId, educationSystem: p.data.educationSystem });
  return r.ok ? ok({ applied: !r.value.alreadyApplied }) : r;
}

export async function onClassroomPeriodEvent(deps: PrimarySchoolDeps, ctx: RequestContext, event: IncomingEvent): Promise<Result<{ updated: boolean }, AppError>> {
  const p = classroomPeriod.safeParse(event.payload);
  if (!p.success) return ok({ updated: false });
  const status = event.type === ConsumedEvents.CLASSROOM_PERIOD_REOPENED ? "OPEN" : event.type === ConsumedEvents.CLASSROOM_PERIOD_GRADING_CLOSED || event.type === ConsumedEvents.CLASSROOM_PERIOD_CLOSED ? "LOCKED" : null;
  if (status === null) return ok({ updated: false });
  const at = event.occurredAt ? new Date(event.occurredAt) : deps.clock.now();
  return inTx(deps, ctx, async (tx) => {
    await upsertPeriodLock(tx, { tenantId: ctx.tenantId, classroomId: p.data.classroomId, periodId: p.data.periodId, status, sourceEventId: event.id, at });
    return ok({ updated: true });
  });
}

export async function onResultsDecisionConfirmed(deps: PrimarySchoolDeps, ctx: RequestContext, event: IncomingEvent): Promise<Result<{ caseUpdated: boolean; outcomeRecorded: string | null }, AppError>> {
  const p = decisionConfirmed.safeParse(event.payload);
  const decisionId = event.aggregateId && uuid.safeParse(event.aggregateId).success ? event.aggregateId : null;
  if (!p.success || !decisionId) return ok({ caseUpdated: false, outcomeRecorded: null });
  return onDecisionConfirmed(deps, ctx, { decisionId, enrollmentId: p.data.enrollmentId, finalCode: p.data.finalCode ?? null, periodId: p.data.academicPeriodId ?? null });
}

export async function onOfficialDocumentRendered(deps: PrimarySchoolDeps, ctx: RequestContext, event: IncomingEvent): Promise<Result<{ updated: boolean }, AppError>> {
  const p = documentRendered.safeParse(event.payload);
  if (!p.success || p.data.documentKind !== "ANNUAL_REVIEW") return ok({ updated: false });
  return onReviewDocumentRendered(deps, ctx, { reviewId: p.data.sourceId, documentId: p.data.documentId });
}

export async function onAnnualReviewSealed(deps: PrimarySchoolDeps, ctx: RequestContext, event: IncomingEvent): Promise<Result<{ requested: boolean }, AppError>> {
  const p = reviewSealed.safeParse(event.payload);
  if (!p.success) return ok({ requested: false });
  const r = await requestReviewDocument(deps, ctx, p.data.reviewId);
  return r.ok ? ok({ requested: r.value.requested }) : r;
}
