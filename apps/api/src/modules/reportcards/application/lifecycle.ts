/**
 * Cycle de vie d'un document émis : publication / retrait aux familles, publication par lot, révocation (spec 013 US3).
 * Rien n'est jamais effacé : une révocation ou un remplacement change le STATUT (déclencheurs SQL), le contenu reste.
 * Opérations sensibles (MFA par le garde RBAC) : événement d'outbox + audit dans la même transaction.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { ReportcardsCode, conflict, invalid, notFound } from "../domain/errors";
import { ReportcardsEvents } from "../domain/events";
import { canPublish, canRevoke, canWithdraw, type Decision } from "../domain/lifecycle";
import type { ReportCardRecord, Uuid } from "../domain/types";
import * as batchRepo from "../infrastructure/batches-repository";
import * as cardsRepo from "../infrastructure/cards-repository";
import { EventBuffer, actorLabel, inTx, type ReportcardsDeps } from "./deps";

const stateError = (d: Extract<Decision, { ok: false }>): AppError =>
  conflict(d.message, d.code === "provisional" ? ReportcardsCode.PROVISIONAL : ReportcardsCode.INVALID_STATE, { reason: d.code });

export async function publishReportCard(deps: ReportcardsDeps, ctx: RequestContext, input: { reportCardId: Uuid }): Promise<Result<ReportCardRecord, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const card = await cardsRepo.getCard(tx, input.reportCardId, { forUpdate: true });
    if (!card) return err(notFound("Bulletin", input.reportCardId));
    const decision = canPublish(card);
    if (!decision.ok) return err(stateError(decision));
    if (card.renderStatus !== "RENDERED") return err(conflict("Le PDF de ce bulletin n'est pas encore prêt : publication impossible.", ReportcardsCode.NOT_RENDERED, { renderStatus: card.renderStatus }));
    const events = new EventBuffer(deps, ctx);
    const published = card.status === "PUBLISHED" ? await cardsRepo.clearWithdrawn(tx, card.id) : await cardsRepo.markPublished(tx, card.id, ctx.userId ?? ctx.tenantId, deps.clock.now());
    events.add(ReportcardsEvents.PUBLISHED, { v: 1, reportCardId: card.id, studentId: card.studentId, version: card.version }, { type: "report_card", id: card.id });
    events.audit({
      action: "reportcards.report_card.published",
      resourceType: "report_card",
      resourceId: card.id,
      sensitive: true,
      before: { status: card.status, withdrawnAt: card.withdrawnAt },
      after: { status: published.status },
      metadata: { studentId: card.studentId, version: card.version },
    });
    await events.flush(tx);
    return ok(published);
  });
}

export async function withdrawReportCard(deps: ReportcardsDeps, ctx: RequestContext, input: { reportCardId: Uuid }): Promise<Result<ReportCardRecord, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const card = await cardsRepo.getCard(tx, input.reportCardId, { forUpdate: true });
    if (!card) return err(notFound("Bulletin", input.reportCardId));
    const decision = canWithdraw(card);
    if (!decision.ok) return err(stateError(decision));
    const events = new EventBuffer(deps, ctx);
    const updated = await cardsRepo.markWithdrawn(tx, card.id, deps.clock.now());
    events.add(ReportcardsEvents.WITHDRAWN, { v: 1, reportCardId: card.id, studentId: card.studentId, version: card.version }, { type: "report_card", id: card.id });
    events.audit({ action: "reportcards.report_card.withdrawn", resourceType: "report_card", resourceId: card.id, sensitive: true, metadata: { studentId: card.studentId, version: card.version } });
    await events.flush(tx);
    return ok(updated);
  });
}

export interface PublishManyResult {
  published: number;
  alreadyPublished: number;
  skipped: Array<{ reportCardId: Uuid; reason: string }>;
}

/** Publication par lot (identifiants explicites ou tout un lot de génération). Un bulletin non éligible est ignoré et listé. */
export async function publishMany(deps: ReportcardsDeps, ctx: RequestContext, input: { reportCardIds?: readonly Uuid[]; batchId?: Uuid }): Promise<Result<PublishManyResult, AppError>> {
  if (!input.reportCardIds && !input.batchId) return err(invalid("Fournissez reportCardIds ou batchId.", ReportcardsCode.NOT_FOUND));
  return inTx(deps, ctx, async (tx) => {
    if (input.batchId && !(await batchRepo.getBatch(tx, input.batchId))) return err(notFound("Lot de génération", input.batchId));
    const targets: ReportCardRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await cardsRepo.listCards(tx, { ...(input.batchId ? { batchId: input.batchId } : {}), ...(input.reportCardIds ? { ids: input.reportCardIds } : {}) }, { limit: 200, ...(cursor ? { cursor } : {}) });
      targets.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const events = new EventBuffer(deps, ctx);
    const result: PublishManyResult = { published: 0, alreadyPublished: 0, skipped: [] };
    const missing = (input.reportCardIds ?? []).filter((id) => !targets.some((t) => t.id === id));
    for (const id of missing) result.skipped.push({ reportCardId: id, reason: "NOT_FOUND" });
    const now = deps.clock.now();
    const publishedIds: string[] = [];
    for (const card of targets) {
      const decision = canPublish(card);
      if (!decision.ok) {
        if (decision.code === "already") result.alreadyPublished += 1;
        else result.skipped.push({ reportCardId: card.id, reason: decision.code.toUpperCase() });
        continue;
      }
      if (card.renderStatus !== "RENDERED") {
        result.skipped.push({ reportCardId: card.id, reason: "NOT_RENDERED" });
        continue;
      }
      if (card.status === "PUBLISHED") await cardsRepo.clearWithdrawn(tx, card.id);
      else await cardsRepo.markPublished(tx, card.id, ctx.userId ?? ctx.tenantId, now);
      events.add(ReportcardsEvents.PUBLISHED, { v: 1, reportCardId: card.id, studentId: card.studentId, version: card.version }, { type: "report_card", id: card.id });
      publishedIds.push(card.id);
      result.published += 1;
    }
    if (result.published > 0) {
      events.audit({
        action: "reportcards.report_cards.published",
        resourceType: "report_card",
        resourceId: input.batchId ?? publishedIds[0]!,
        sensitive: true,
        metadata: { count: result.published, batchId: input.batchId ?? null, reportCardIds: publishedIds.slice(0, 100), skipped: result.skipped.length },
      });
    }
    await events.flush(tx);
    return ok(result);
  });
}

export async function revokeReportCard(deps: ReportcardsDeps, ctx: RequestContext, input: { reportCardId: Uuid; reason: string }): Promise<Result<ReportCardRecord, AppError>> {
  const name = await actorLabel(deps, ctx);
  return inTx(deps, ctx, async (tx) => {
    const card = await cardsRepo.getCard(tx, input.reportCardId, { forUpdate: true });
    if (!card) return err(notFound("Bulletin", input.reportCardId));
    const decision = canRevoke(card);
    if (!decision.ok) return err(stateError(decision));
    const events = new EventBuffer(deps, ctx);
    const revoked = await cardsRepo.markRevoked(tx, card.id, ctx.userId, name, input.reason, deps.clock.now());
    events.add(ReportcardsEvents.REVOKED, { v: 1, reportCardId: card.id, studentId: card.studentId, reason: input.reason }, { type: "report_card", id: card.id });
    events.audit({
      action: "reportcards.report_card.revoked",
      resourceType: "report_card",
      resourceId: card.id,
      sensitive: true,
      reason: input.reason,
      before: { status: card.status },
      after: { status: revoked.status },
      metadata: { studentId: card.studentId, version: card.version, verificationCode: card.verificationCode },
    });
    await events.flush(tx);
    return ok(revoked);
  });
}
