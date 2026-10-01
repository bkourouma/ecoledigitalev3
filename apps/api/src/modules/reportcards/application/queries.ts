/**
 * Lecture et téléchargement contrôlés (spec 013 US6, R-RC-06) :
 *  - la GESTION (`reportcard.read`) lit tout, y compris remplacés, révoqués et provisoires ;
 *  - un ÉLÈVE ne voit que SES bulletins publiés ; un TUTEUR que ceux des enfants auxquels il est LIÉ, le lien étant
 *    revérifié à CHAQUE lecture (AC6.3, aucun jeton long) ;
 *  - jamais un bulletin non publié, retiré, remplacé, révoqué ou provisoire côté famille ;
 *  - le téléchargement renvoie une URL SIGNÉE à durée courte (≤ 5 min) ; un tiers non-gestion est journalisé (qui, quand, quoi).
 * Un bulletin qui n'est pas à l'appelant répond comme un bulletin inexistant (404) : aucune fuite d'existence.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { MAX_SIGNED_URL_TTL_SECONDS } from "../domain/constants";
import { ReportcardsCode, conflict, forbidden, notFound } from "../domain/errors";
import { downloadFileName, familyMayRead, isVisibleToFamilies, needsReissue, type FamilyActor } from "../domain/lifecycle";
import type { ReportCardRecord, RenderRecord, ReportcardExplain, ReportcardSnapshot, Uuid } from "../domain/types";
import * as cardsRepo from "../infrastructure/cards-repository";
import { getSettings } from "../infrastructure/reference-repository";
import { EventBuffer, inTx, type ReportcardsDeps } from "./deps";

export interface ListInput {
  classroomId?: Uuid;
  academicPeriodId?: Uuid;
  studentId?: Uuid;
  status?: ReportCardRecord["status"];
  kind?: ReportCardRecord["documentKind"];
  live?: boolean;
  needsReissue?: boolean;
  cursor?: string;
  limit: number;
}

export interface CardView {
  card: ReportCardRecord;
  /** `true` si les résultats ont changé depuis l'émission (null si inconnu ou sans objet). */
  needsReissue: boolean | null;
}

export interface CardPageView {
  items: CardView[];
  nextCursor: string | null;
}

/** Liste de gestion. `needsReissue` compare à la version COURANTE des résultats (port) ; le filtre s'applique à la page lue. */
export async function listReportCards(deps: ReportcardsDeps, ctx: RequestContext, input: ListInput): Promise<Result<CardPageView, AppError>> {
  const page = await inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await cardsRepo.listCards(
          tx,
          {
            ...(input.classroomId ? { classroomId: input.classroomId } : {}),
            ...(input.academicPeriodId ? { academicPeriodId: input.academicPeriodId } : {}),
            ...(input.studentId ? { studentId: input.studentId } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.kind ? { kind: input.kind } : {}),
            ...(input.live || input.needsReissue ? { live: true } : {}),
          },
          { limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) },
        ),
      ),
    { readOnly: true },
  );
  if (!page.ok) return page;
  const versions = new Map<string, number | null>();
  const views: CardView[] = [];
  for (const card of page.value.items) {
    let flag: boolean | null = null;
    if (card.classroomId && card.academicPeriodId && (card.status === "ISSUED" || card.status === "PUBLISHED")) {
      const key = `${card.classroomId}:${card.academicPeriodId}`;
      if (!versions.has(key)) {
        try {
          versions.set(key, (await deps.ports.results.getPeriodState(ctx, { classroomId: card.classroomId, academicPeriodId: card.academicPeriodId }))?.resultsVersion ?? null);
        } catch {
          versions.set(key, null);
        }
      }
      const current = versions.get(key) ?? null;
      flag = current === null ? null : needsReissue(card, current);
    }
    views.push({ card, needsReissue: flag });
  }
  const items = input.needsReissue ? views.filter((v) => v.needsReissue === true) : views;
  return ok({ items, nextCursor: page.value.nextCursor });
}

export interface CardDetail {
  card: ReportCardRecord;
  snapshot: ReportcardSnapshot;
  renders: RenderRecord[];
}

export async function getReportCard(deps: ReportcardsDeps, ctx: RequestContext, reportCardId: Uuid): Promise<Result<CardDetail, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const content = await cardsRepo.getCardContent(tx, reportCardId);
      if (!content) return err(notFound("Bulletin", reportCardId));
      return ok({ card: content.record, snapshot: content.snapshot, renders: await cardsRepo.listRenders(tx, reportCardId) });
    },
    { readOnly: true },
  );
}

/** Trace d'explicabilité (permission `reportcard.explain`) ; la consultation est auditée. */
export async function getExplain(deps: ReportcardsDeps, ctx: RequestContext, reportCardId: Uuid): Promise<Result<{ card: ReportCardRecord; explain: ReportcardExplain }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const content = await cardsRepo.getCardContent(tx, reportCardId);
    if (!content) return err(notFound("Bulletin", reportCardId));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "reportcards.report_card.explain_read", resourceType: "report_card", resourceId: reportCardId, metadata: { studentId: content.record.studentId } });
    await events.flush(tx);
    return ok({ card: content.record, explain: content.explain });
  });
}

// ---------------------------------------------------------------------------
// Familles
// ---------------------------------------------------------------------------

export interface FamilyCaps {
  /** `reportcard.self.read` : portail élève. */
  self?: boolean;
  /** `reportcard.child.read` : portail parent. */
  child?: boolean;
}

/** Détermine l'acteur famille vis-à-vis d'un élève, lien de tutelle vérifié MAINTENANT. `null` = aucun droit. */
async function familyActorFor(deps: ReportcardsDeps, ctx: RequestContext, caps: FamilyCaps, studentId: Uuid): Promise<FamilyActor | null> {
  if (!ctx.userId) return null;
  if (caps.self) {
    const own = await deps.ports.guardianship.studentIdOfUser(ctx, ctx.userId);
    if (own && own === studentId) return { kind: "STUDENT", studentId };
  }
  if (caps.child && (await deps.ports.guardianship.isGuardianOf(ctx, ctx.userId, studentId))) return { kind: "GUARDIAN", studentId };
  return null;
}

/** « Mes bulletins » (élève) ou ceux d'un enfant (tuteur lié). Uniquement les bulletins publiés, non retirés, non remplacés. */
export async function listForFamily(
  deps: ReportcardsDeps,
  ctx: RequestContext,
  input: { caps: FamilyCaps; studentId?: Uuid; cursor?: string; limit: number },
): Promise<Result<{ items: ReportCardRecord[]; nextCursor: string | null }, AppError>> {
  if (!ctx.userId) return err(forbidden("Authentification requise."));
  let studentIds: Uuid[] = [];
  if (input.studentId) {
    const actor = await familyActorFor(deps, ctx, input.caps, input.studentId);
    if (!actor) return err(notFound("Élève", input.studentId));
    studentIds = [input.studentId];
  } else {
    if (input.caps.self) {
      const own = await deps.ports.guardianship.studentIdOfUser(ctx, ctx.userId);
      if (own) studentIds.push(own);
    }
    if (input.caps.child) studentIds.push(...(await deps.ports.guardianship.listChildren(ctx, ctx.userId)));
  }
  studentIds = [...new Set(studentIds)];
  if (studentIds.length === 0) return ok({ items: [], nextCursor: null });
  return inTx(
    deps,
    ctx,
    async (tx) => ok(await cardsRepo.listCards(tx, { studentIds, familyVisible: true, live: true }, { limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) })),
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Téléchargement
// ---------------------------------------------------------------------------

export interface DownloadInput {
  reportCardId: Uuid;
  /** `reportcard.read` : la gestion lit tout. */
  manage: boolean;
  family?: FamilyCaps;
}

export interface DownloadView {
  url: string;
  expiresAt: Date;
  fileName: string;
  sizeBytes: number | null;
  pdfHash: string | null;
}

export async function getDownloadUrl(deps: ReportcardsDeps, ctx: RequestContext, input: DownloadInput): Promise<Result<DownloadView, AppError>> {
  const ttl = Math.min(deps.config.signedUrlTtlSeconds, MAX_SIGNED_URL_TTL_SECONDS);
  // 1) lecture de la fiche et des réglages (aucun appel à un autre module pendant qu'une transaction est ouverte)
  const pre = await inTx(
    deps,
    ctx,
    async (tx) => {
      const card = await cardsRepo.getCard(tx, input.reportCardId);
      if (!card) return err(notFound("Bulletin", input.reportCardId));
      return ok({ card, settings: await getSettings(tx) });
    },
    { readOnly: true },
  );
  if (!pre.ok) return pre;
  const { card, settings } = pre.value;

  // 2) droits : gestion, ou famille avec lien de tutelle revérifié MAINTENANT
  let actor: FamilyActor | null = null;
  if (!input.manage) {
    actor = await familyActorFor(deps, ctx, input.family ?? {}, card.studentId);
    if (!actor) return err(notFound("Bulletin", input.reportCardId)); // pas le sien : même réponse qu'un bulletin inexistant
    if (!familyMayRead(card, actor)) return err(forbidden("Ce bulletin n'est pas disponible.", ReportcardsCode.NOT_PUBLISHED));
    if (settings.blockIfUnpaid) {
      const standing = deps.ports.standing;
      if (!standing) return err(conflict("La vérification de la situation financière est indisponible.", ReportcardsCode.PORT_UNAVAILABLE));
      if (await standing.hasOutstandingBalance(ctx, card.studentId)) {
        return err(forbidden("Ce bulletin n'est pas disponible pour le moment. Veuillez contacter l'économat de l'établissement.", ReportcardsCode.PAYMENT_REQUIRED));
      }
    }
  }

  // 3) rendu courant, URL signée, journal d'accès et audit dans la même transaction
  return inTx(deps, ctx, async (tx) => {
    const fresh = await cardsRepo.getCard(tx, card.id);
    if (!fresh || (actor && !familyMayRead(fresh, actor))) return err(forbidden("Ce bulletin n'est pas disponible.", ReportcardsCode.NOT_PUBLISHED));
    const render = await cardsRepo.getCurrentRender(tx, fresh);
    if (!render?.objectKey) return err(conflict("Le PDF de ce bulletin n'est pas encore prêt.", ReportcardsCode.NOT_RENDERED, { renderStatus: fresh.renderStatus }));
    const fileName = downloadFileName(fresh);
    const signed = await deps.ports.storage.signedUrl(render.objectKey, { ttlSeconds: ttl, fileName, contentType: "application/pdf" });
    const events = new EventBuffer(deps, ctx);
    if (actor && ctx.userId) await cardsRepo.logAccess(tx, { id: deps.newId(), tenantId: ctx.tenantId, reportCardId: fresh.id, userId: ctx.userId, actorKind: actor.kind });
    events.audit({
      action: "reportcards.report_card.downloaded",
      resourceType: "report_card",
      resourceId: fresh.id,
      sensitive: Boolean(actor),
      metadata: { studentId: fresh.studentId, version: fresh.version, by: actor ? actor.kind : "MANAGEMENT", renderId: render.id },
    });
    await events.flush(tx);
    return ok({ url: signed.url, expiresAt: signed.expiresAt, fileName, sizeBytes: render.sizeBytes, pdfHash: render.pdfHash });
  });
}

/** URL signée du PDF combiné d'une classe pour une période (dernier lot terminé qui en a un). */
export async function getCombinedPdfUrl(deps: ReportcardsDeps, ctx: RequestContext, input: { classroomId: Uuid; academicPeriodId: Uuid }): Promise<Result<DownloadView, AppError>> {
  const ttl = Math.min(deps.config.signedUrlTtlSeconds, MAX_SIGNED_URL_TTL_SECONDS);
  return inTx(deps, ctx, async (tx) => {
    const row = await tx.queryOne<{ id: string; combined_pdf_key: string }>(
      `SELECT id, combined_pdf_key FROM reportcards.batches
        WHERE classroom_id = $1 AND academic_period_id = $2 AND combined_pdf_key IS NOT NULL
        ORDER BY requested_at DESC, id DESC LIMIT 1`,
      [input.classroomId, input.academicPeriodId],
    );
    if (!row) return err(conflict("Le PDF combiné de cette classe n'est pas encore prêt.", ReportcardsCode.NOT_RENDERED));
    const fileName = `bulletins-classe-${input.classroomId.slice(0, 8)}.pdf`;
    const signed = await deps.ports.storage.signedUrl(row.combined_pdf_key, { ttlSeconds: ttl, fileName, contentType: "application/pdf" });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "reportcards.batch.combined_downloaded", resourceType: "batch", resourceId: row.id, metadata: { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId } });
    await events.flush(tx);
    return ok({ url: signed.url, expiresAt: signed.expiresAt, fileName, sizeBytes: null, pdfHash: null });
  });
}
