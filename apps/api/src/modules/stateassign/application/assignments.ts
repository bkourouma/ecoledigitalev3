/**
 * Dossier d'affectation : enregistrer, corriger, vérifier, activer, rejeter, suspendre, reprendre, terminer, amender, lire.
 *
 * L'HUMAIN décide : chaque acte du cycle de vie exige un utilisateur identifié (contrôlé ici et IMPOSÉ par la base). Un import
 * ou la future passerelle peuvent ENREGISTRER (`source` IMPORT / GATEWAY), jamais vérifier. Le dossier est VERSIONNÉ : un avenant
 * REMPLACE la version courante puis crée la version n+1 (qui repart à RECEIVED et doit être vérifiée à son tour). La référence
 * d'affectation de l'inscription (`academic`) n'a qu'UNE source : le dossier vérifié, transmise par le port `funding` dans la
 * transaction de la vérification (un refus d'`academic` annule la vérification).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  AmendAssignmentBody,
  AssignmentDetailDto,
  AssignmentDto,
  AssignmentListQuery,
  AssignmentListResponse,
  AssignmentSource,
  ChildAssignmentDto,
  RecordAssignmentBody,
  UpdateAssignmentBody,
} from "@ecoledigitale/contracts/src/v2/stateassign";
import {
  ASSIGNMENT_ACTS,
  actAllowedFrom,
  declaredAmount,
  hasContentChange,
  isOperationalAssignment,
  normalizeReference,
  normalizeText,
  type AssignmentAct,
} from "../domain/assignment";
import { StateassignCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { StateassignEvents } from "../domain/events";
import { sumMoney, viewReceivable } from "../domain/reconciliation";
import type { AssignmentRecord, Uuid } from "../domain/types";
import * as repo from "../infrastructure/repository";
import * as recRepo from "../infrastructure/receivables-repository";
import { inTx, requireHuman, todayOf, EventBuffer, type StateassignDeps } from "./deps";
import { assignmentDto, assignmentEventDto, controlDto, documentDto, moneyDto, moneyDtoOrNull, receivableDto } from "./presenters";
import { assignmentPayload, inScope, loadAssignmentInScope, namesOf, reasonOf, reasonRequired, versionConflict } from "./support";

const HASH = /^[0-9a-f]{64}$/;

export interface RecordAssignmentInput extends RecordAssignmentBody {
  /** MANUAL par défaut. IMPORT (module imports) et GATEWAY (future passerelle) ne passent PAS par HTTP. */
  readonly source?: AssignmentSource | undefined;
  readonly externalRef?: string | null | undefined;
  readonly externalPayloadHash?: string | null | undefined;
}

export async function recordAssignment(deps: StateassignDeps, ctx: RequestContext, input: RecordAssignmentInput): Promise<Result<AssignmentDto, AppError>> {
  const source = input.source ?? "MANUAL";
  if (source === "MANUAL") {
    const h = requireHuman(ctx);
    if (!h.ok) return h;
  }
  const reference = normalizeReference(input.reference);
  if (!reference) return err(validation(StateassignCode.INVALID_INPUT, "La référence d'affectation est requise (120 caractères au plus).", "reference"));
  if (source === "GATEWAY" && !(input.externalPayloadHash && HASH.test(input.externalPayloadHash))) {
    return err(validation(StateassignCode.INVALID_INPUT, "Une affectation reçue de la passerelle porte l'empreinte (SHA-256) de l'échange.", "externalPayloadHash"));
  }
  let declaredState;
  let declaredParent;
  try {
    declaredState = declaredAmount(input.declaredStateAmount, deps.config.defaultCurrency);
    declaredParent = declaredAmount(input.declaredParentAmount, deps.config.defaultCurrency);
  } catch (e) {
    return err(validation(StateassignCode.INVALID_INPUT, e instanceof Error ? e.message : "Montant invalide.", "amount"));
  }

  return inTx(deps, ctx, async (tx) => {
    const enrollment = await deps.ports.enrollments.getEnrollment(ctx, input.enrollmentId);
    if (!enrollment || !inScope(ctx, enrollment.institutionId)) return err(notFound(StateassignCode.ENROLLMENT_NOT_FOUND, "Inscription", input.enrollmentId));
    if (["CANCELLED", "WITHDRAWN", "TRANSFERRED_OUT"].includes(enrollment.status)) {
      return err(conflict(StateassignCode.ENROLLMENT_NOT_ELIGIBLE, `L'inscription est ${enrollment.status} : aucun dossier d'affectation ne peut y être enregistré.`));
    }
    const record = await repo.insertAssignment(tx, ctx.tenantId, {
      id: deps.newId(),
      institutionId: enrollment.institutionId,
      academicYearId: enrollment.academicYearId,
      enrollmentId: enrollment.enrollmentId,
      studentId: enrollment.studentId,
      version: 1,
      supersedesId: null,
      reference,
      issuedOn: input.issuedOn ?? null,
      issuingAuthority: normalizeText(input.issuingAuthority, 200),
      source,
      externalRef: normalizeText(input.externalRef, 200),
      externalPayloadHash: input.externalPayloadHash ?? null,
      declaredState,
      declaredParent,
      currency: deps.config.defaultCurrency,
      receivedBy: source === "MANUAL" ? ctx.userId : null,
      notes: normalizeText(input.notes, 2000),
    });
    const events = new EventBuffer(deps, ctx);
    events.add(StateassignEvents.ASSIGNMENT_RECEIVED, assignmentPayload(record, null), { type: "stateassign.assignment", id: record.id });
    events.audit({
      action: "stateassign.assignment.received",
      resourceType: "assignment",
      resourceId: record.id,
      after: { version: 1, source, status: record.status, declaredState: record.declaredState?.amount ?? null, declaredParent: record.declaredParent?.amount ?? null },
      metadata: { enrollmentId: record.enrollmentId, studentId: record.studentId },
    });
    await events.flush(tx);
    return ok(assignmentDto(record, null));
  });
}

export async function updateAssignment(deps: StateassignDeps, ctx: RequestContext, id: Uuid, body: UpdateAssignmentBody): Promise<Result<AssignmentDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  let declaredState;
  let declaredParent;
  try {
    declaredState = body.declaredStateAmount === undefined ? undefined : declaredAmount(body.declaredStateAmount, deps.config.defaultCurrency);
    declaredParent = body.declaredParentAmount === undefined ? undefined : declaredAmount(body.declaredParentAmount, deps.config.defaultCurrency);
  } catch (e) {
    return err(validation(StateassignCode.INVALID_INPUT, e instanceof Error ? e.message : "Montant invalide.", "amount"));
  }
  let reference: string | undefined;
  if (body.reference !== undefined) {
    const r = normalizeReference(body.reference);
    if (!r) return err(validation(StateassignCode.INVALID_INPUT, "La référence d'affectation est requise.", "reference"));
    reference = r;
  }
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadAssignmentInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const current = loaded.value;
    const content = {
      ...(reference !== undefined ? { reference } : {}),
      ...(body.issuedOn !== undefined ? { issuedOn: body.issuedOn } : {}),
      ...(body.issuingAuthority !== undefined ? { issuingAuthority: normalizeText(body.issuingAuthority, 200) } : {}),
      ...(declaredState !== undefined ? { declaredState } : {}),
      ...(declaredParent !== undefined ? { declaredParent } : {}),
    };
    if (current.status !== "RECEIVED" && hasContentChange(current, content)) {
      return err(conflict(StateassignCode.CONTENT_FROZEN, "Référence, autorité et montants déclarés sont figés après vérification : créer un avenant."));
    }
    if (current.status === "REJECTED" || current.status === "SUPERSEDED") {
      return err(conflict(StateassignCode.TRANSITION_INVALID, `Le dossier est ${current.status} : il ne se modifie plus.`));
    }
    const updated = await repo.patchAssignment(tx, id, { ...content, ...(body.notes !== undefined ? { notes: normalizeText(body.notes, 2000) } : {}) }, body.rowVersion);
    if (!updated) return err(versionConflict());
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "stateassign.assignment.updated",
      resourceType: "assignment",
      resourceId: id,
      before: { reference: current.reference, declaredState: current.declaredState?.amount ?? null, declaredParent: current.declaredParent?.amount ?? null },
      after: { reference: updated.reference, declaredState: updated.declaredState?.amount ?? null, declaredParent: updated.declaredParent?.amount ?? null },
    });
    await events.flush(tx);
    return ok(assignmentDto(updated, null));
  });
}

export interface ActInput {
  readonly rowVersion?: number | null | undefined;
  readonly note?: string | null | undefined;
  readonly reason?: string | null | undefined;
  readonly endedOn?: string | undefined;
}

/** Actes du cycle de vie : vérifier, rejeter, activer, suspendre, reprendre, terminer, transférer. Tous HUMAINS. */
export async function actOnAssignment(deps: StateassignDeps, ctx: RequestContext, id: Uuid, act: AssignmentAct, input: ActInput): Promise<Result<AssignmentDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const spec = ASSIGNMENT_ACTS[act];
  const reason = reasonOf(input.reason);
  const needsReason = act === "reject" || act === "suspend" || act === "end" || act === "transfer-out";
  if (needsReason && !reason) return err(reasonRequired());
  if ((act === "end" || act === "transfer-out") && !input.endedOn) return err(validation(StateassignCode.INVALID_INPUT, "La date de fin est requise.", "endedOn"));

  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadAssignmentInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const current = loaded.value;
    if (!actAllowedFrom(act, current.status)) {
      return err(conflict(StateassignCode.TRANSITION_INVALID, `Cet acte est impossible depuis l'état ${current.status}.`, { from: current.status, act }));
    }
    if (act === "verify") {
      const settings = await repo.getSettings(tx, current.institutionId);
      if (settings.requireSeparateVerifier && current.receivedBy !== null && current.receivedBy === ctx.userId) {
        return err(forbidden(StateassignCode.FOUR_EYES_REQUIRED, "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier."));
      }
    }
    const patch =
      act === "verify" ? ({ to: "VERIFIED", note: input.note?.trim() || null } as const)
      : act === "reject" ? ({ to: "REJECTED", reason: reason! } as const)
      : act === "suspend" ? ({ to: "SUSPENDED", reason: reason! } as const)
      : act === "end" || act === "transfer-out" ? ({ to: spec.to as "ENDED" | "TRANSFERRED", endedOn: input.endedOn!, reason: reason! } as const)
      : ({ to: "ACTIVE" } as const);
    const updated = await repo.transitionAssignment(tx, id, patch, input.rowVersion ?? null);
    if (!updated) return err(versionConflict());

    if (act === "verify") {
      // Une seule source de la référence d'affectation de l'inscription : le dossier vérifié.
      const funded = await deps.ports.funding.setStateAssignedFunding(ctx, {
        enrollmentId: updated.enrollmentId,
        reference: updated.reference,
        issuedOn: updated.issuedOn,
        funderLabel: updated.issuingAuthority,
        // Cumul de financements (O-04) : la part de l'État déclarée par l'acte.
        stateAmount: updated.declaredState,
        reason: `Dossier d'affectation vérifié (version ${updated.version})`,
      });
      if (!funded.ok) return err(conflict(StateassignCode.ENROLLMENT_FUNDING_REFUSED, `L'inscription n'a pas pu être rattachée à l'affectation : ${funded.error.message}`, { code: funded.error.code }));
    }

    const events = new EventBuffer(deps, ctx);
    events.add(spec.event, assignmentPayload(updated, current.status), { type: "stateassign.assignment", id });
    events.audit({
      action: `stateassign.assignment.${act === "transfer-out" ? "transferred" : spec.to.toLowerCase()}`,
      resourceType: "assignment",
      resourceId: id,
      sensitive: spec.sensitive,
      reason: reason ?? input.note ?? null,
      before: { status: current.status },
      after: { status: updated.status },
      metadata: {
        enrollmentId: updated.enrollmentId,
        version: updated.version,
        ...(act === "reject" && current.status === "VERIFIED" ? { enrollmentFundingUnchanged: true } : {}),
      },
    });
    await events.flush(tx);
    return ok(assignmentDto(updated, null));
  });
}

/** Avenant : remplace le dossier courant (SUPERSEDED, date et motif) puis crée la version n+1 (RECEIVED, à vérifier). */
export async function amendAssignment(
  deps: StateassignDeps,
  ctx: RequestContext,
  id: Uuid,
  body: AmendAssignmentBody,
): Promise<Result<{ superseded: AssignmentDto; current: AssignmentDto }, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const reason = reasonOf(body.reason);
  if (!reason) return err(reasonRequired());
  let declaredState;
  let declaredParent;
  try {
    declaredState = body.declaredStateAmount === undefined ? undefined : declaredAmount(body.declaredStateAmount, deps.config.defaultCurrency);
    declaredParent = body.declaredParentAmount === undefined ? undefined : declaredAmount(body.declaredParentAmount, deps.config.defaultCurrency);
  } catch (e) {
    return err(validation(StateassignCode.INVALID_INPUT, e instanceof Error ? e.message : "Montant invalide.", "amount"));
  }
  let reference: string | undefined;
  if (body.reference !== undefined) {
    const r = normalizeReference(body.reference);
    if (!r) return err(validation(StateassignCode.INVALID_INPUT, "La référence d'affectation est requise.", "reference"));
    reference = r;
  }
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadAssignmentInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const current = loaded.value;
    if (!isOperationalAssignment(current.status)) {
      return err(conflict(StateassignCode.TRANSITION_INVALID, `Un avenant s'applique à un dossier vérifié, actif ou suspendu (dossier ${current.status}) ; un dossier RECEIVED se corrige directement.`));
    }
    const change = {
      ...(reference !== undefined ? { reference } : {}),
      ...(body.issuedOn !== undefined ? { issuedOn: body.issuedOn } : {}),
      ...(body.issuingAuthority !== undefined ? { issuingAuthority: normalizeText(body.issuingAuthority, 200) } : {}),
      ...(declaredState !== undefined ? { declaredState } : {}),
      ...(declaredParent !== undefined ? { declaredParent } : {}),
    };
    if (!hasContentChange(current, change)) return err(conflict(StateassignCode.AMENDMENT_EMPTY, "L'avenant ne change ni la référence, ni l'autorité, ni la date, ni les montants."));

    const superseded = await repo.transitionAssignment(tx, id, { to: "SUPERSEDED", endedOn: body.effectiveOn, reason }, body.rowVersion);
    if (!superseded) return err(versionConflict());
    const next = await repo.insertAssignment(tx, ctx.tenantId, {
      id: deps.newId(),
      institutionId: current.institutionId,
      academicYearId: current.academicYearId,
      enrollmentId: current.enrollmentId,
      studentId: current.studentId,
      version: current.version + 1,
      supersedesId: current.id,
      reference: change.reference ?? current.reference,
      issuedOn: "issuedOn" in change ? (change.issuedOn ?? null) : current.issuedOn,
      issuingAuthority: "issuingAuthority" in change ? (change.issuingAuthority ?? null) : current.issuingAuthority,
      source: "MANUAL",
      externalRef: null,
      externalPayloadHash: null,
      declaredState: "declaredState" in change ? (change.declaredState ?? null) : current.declaredState,
      declaredParent: "declaredParent" in change ? (change.declaredParent ?? null) : current.declaredParent,
      currency: current.currency,
      receivedBy: ctx.userId,
      notes: current.notes,
    });
    const events = new EventBuffer(deps, ctx);
    events.add(StateassignEvents.ASSIGNMENT_SUPERSEDED, assignmentPayload(superseded, current.status), { type: "stateassign.assignment", id: superseded.id });
    events.add(StateassignEvents.ASSIGNMENT_RECEIVED, assignmentPayload(next, null), { type: "stateassign.assignment", id: next.id });
    events.audit({
      action: "stateassign.assignment.amended",
      resourceType: "assignment",
      resourceId: next.id,
      sensitive: true,
      reason,
      before: { version: current.version, reference: current.reference, declaredState: current.declaredState?.amount ?? null, declaredParent: current.declaredParent?.amount ?? null },
      after: { version: next.version, reference: next.reference, declaredState: next.declaredState?.amount ?? null, declaredParent: next.declaredParent?.amount ?? null },
      metadata: { supersededId: superseded.id, effectiveOn: body.effectiveOn },
    });
    await events.flush(tx);
    return ok({ superseded: assignmentDto(superseded, null), current: assignmentDto(next, null) });
  });
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function listAssignmentPage(deps: StateassignDeps, ctx: RequestContext, query: AssignmentListQuery): Promise<Result<AssignmentListResponse, AppError>> {
  const institutionId = ctx.institutionId ?? query.institutionId;
  if (ctx.institutionId && query.institutionId && query.institutionId !== ctx.institutionId) return ok({ items: [], total: 0, page: query.page, pageSize: query.pageSize });
  const result = await inTx(
    deps,
    ctx,
    async (tx) => {
      const page = await repo.listAssignments(tx, {
        institutionId,
        academicYearId: query.academicYearId,
        studentId: query.studentId,
        enrollmentId: query.enrollmentId,
        status: query.status,
        reconciliationStatus: query.reconciliationStatus,
        q: query.q,
        includeHistory: query.includeHistory === "true",
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      return ok(page);
    },
    { readOnly: true },
  );
  if (!result.ok) return result;
  const names = await namesOf(deps, ctx, result.value.items.map((a) => a.studentId));
  return ok({ items: result.value.items.map((a) => assignmentDto(a, names.get(a.studentId) ?? null)), total: result.value.total, page: query.page, pageSize: query.pageSize });
}

export async function getAssignmentDetail(deps: StateassignDeps, ctx: RequestContext, id: Uuid): Promise<Result<AssignmentDetailDto, AppError>> {
  const today = todayOf(deps);
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const found = await loadAssignmentInScope(tx, ctx, id);
      if (!found.ok) return found;
      const a = found.value;
      const versions = await repo.listVersionsOfEnrollment(tx, a.enrollmentId);
      const ids = versions.map((v) => v.id);
      const settings = await repo.getSettings(tx, a.institutionId);
      const [controls, documents, events, receivables] = [
        await repo.listControlsOfAssignments(tx, ids),
        await repo.listDocumentsOfAssignments(tx, ids),
        await repo.listAssignmentEvents(tx, ids),
        await recRepo.listReceivablesOfEnrollment(tx, a.enrollmentId),
      ];
      return ok({ a, versions, controls, documents, events, receivables, settings });
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const { a, versions, controls, documents, events, receivables, settings } = loaded.value;
  const names = await namesOf(deps, ctx, [a.studentId]);
  const name = names.get(a.studentId) ?? null;

  let enrollment: AssignmentDetailDto["enrollment"] = null;
  try {
    const facts = await deps.ports.enrollments.getEnrollment(ctx, a.enrollmentId);
    if (facts) {
      const verifiedOrBeyond = ["VERIFIED", "ACTIVE", "SUSPENDED", "ENDED", "TRANSFERRED"].includes(a.status);
      enrollment = {
        fundingType: facts.fundingType,
        assignmentReference: facts.assignmentReference,
        status: facts.status,
        referenceMatchesAssignment: verifiedOrBeyond && facts.fundingType === "STATE_ASSIGNED" && facts.assignmentReference === a.reference,
      };
    }
  } catch (e) {
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "stateassign : inscription illisible pour le détail du dossier");
  }

  const live = receivables.filter((r) => r.receivable.status !== "CANCELLED");
  const cur = a.currency;
  const expected = sumMoney(live.map((r) => r.receivable.expected), cur);
  const received = sumMoney(live.map((r) => r.receivable.received), cur);
  const overdue = sumMoney(live.map((r) => viewReceivable(r.receivable, today, settings.receivableGraceDays)).filter((v) => v.overdue).map((v) => v.outstanding), cur);
  return ok({
    assignment: assignmentDto(a, name),
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      reference: v.reference,
      declaredState: moneyDtoOrNull(v.declaredState),
      declaredParent: moneyDtoOrNull(v.declaredParent),
      issuedOn: v.issuedOn,
      endedOn: v.endedOn,
      endReason: v.endReason,
      receivedAt: v.receivedAt.toISOString(),
      verifiedAt: v.verifiedAt ? v.verifiedAt.toISOString() : null,
    })),
    controls: controls.map((c) => controlDto(c, today)),
    documents: documents.map(documentDto),
    events: events.map(assignmentEventDto),
    receivables: receivables.map((r) => receivableDto(r.receivable, { asOf: today, graceDays: r.graceDays, studentName: name, assignmentReference: r.assignmentReference })),
    receivablesSummary: {
      expected: moneyDto(expected),
      received: moneyDto(received),
      outstanding: moneyDto(expected.subtract(received)),
      overdue: moneyDto(overdue),
      unscheduled: a.declaredState ? moneyDto(a.declaredState.subtract(expected)) : null,
    },
    enrollment,
  });
}

/** Vue FAMILLE : statut du dossier de l'enfant, jamais les montants de l'État, les échéances, les écarts ni les contrôles. */
export async function getChildAssignment(deps: StateassignDeps, ctx: RequestContext, studentId: Uuid): Promise<Result<ChildAssignmentDto, AppError>> {
  return inTx<ChildAssignmentDto>(
    deps,
    ctx,
    async (tx) => {
      const page = await repo.listAssignments(tx, { studentId, includeHistory: false, limit: 1, offset: 0 });
      const a: AssignmentRecord | undefined = page.items[0];
      if (!a) return ok({ studentId, hasAssignment: false, status: null, verified: false, reference: null, issuedOn: null, academicYearId: null });
      return ok({
        studentId,
        hasAssignment: true,
        status: a.status,
        verified: a.verifiedAt !== null,
        reference: a.reference,
        issuedOn: a.issuedOn,
        academicYearId: a.academicYearId,
      });
    },
    { readOnly: true },
  );
}

