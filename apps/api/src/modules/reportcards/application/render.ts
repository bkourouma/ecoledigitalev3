/**
 * Rendu PDF d'un snapshot (spec 013 US2, R-RC-04/08) : exécuté dans le WORKER, sur l'événement
 * `reportcards.snapshot.created`, depuis le SNAPSHOT SEUL (aucune lecture de donnée vivante : identité, notes, branding et
 * signataires sont déjà figés). Les images sont lues depuis `StoragePort` et injectées en data URI ; le HTML est déterministe ;
 * Chromium s'exécute JavaScript désactivé et réseau coupé (`infrastructure/puppeteer-renderer.ts`).
 *
 * Chaque tentative est une ligne `renders` (une ligne RENDERED est immuable). Un échec laisse le bulletin `PENDING` tant qu'il
 * reste des tentatives (la file du worker rejoue), puis `FAILED` avec la cause (AC1.5) ; le bouton « reprise » republie une
 * demande de rendu. Le hash du PDF est conservé et indexé pour la comparaison d'un fichier téléversé (AC4.4).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { renderDocumentHtml } from "../domain/document-html";
import { sha256Hex } from "../domain/canonical";
import { ReportcardsCode, conflict, internal, notFound } from "../domain/errors";
import { ReportcardsEvents } from "../domain/events";
import type { PlatformTemplate, ReportCardRecord, ReportcardSnapshot, Uuid } from "../domain/types";
import * as batchRepo from "../infrastructure/batches-repository";
import * as cardsRepo from "../infrastructure/cards-repository";
import { getPlatformTemplate } from "../infrastructure/reference-repository";
import { EventBuffer, inTx, type ReportcardsDeps } from "./deps";
import { buildVerificationInfo, loadRenderAssets } from "./render-support";

export interface RenderInput {
  reportCardId: Uuid;
  /** Numéro de la tentative (1 = première) et nombre maximal : fournis par la file du worker. */
  attempt?: number;
  maxAttempts?: number;
  /** Re-rend même si un rendu RENDERED existe (reprise explicite). */
  force?: boolean;
}

export interface RenderOutcome {
  reportCardId: Uuid;
  renderId: Uuid | null;
  status: "RENDERED" | "ALREADY_RENDERED";
  pdfHash: string | null;
  sizeBytes: number | null;
  batchCompleted: boolean;
}

const truncate = (s: string, n = 500): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const messageOf = (e: unknown): string => truncate(e instanceof Error ? e.message : String(e));

export const objectKeyFor = (tenantId: Uuid, cardId: Uuid, renderId: Uuid): string => `reportcards/${tenantId}/${cardId}/${renderId}.pdf`;
export const combinedKeyFor = (tenantId: Uuid, batchId: Uuid): string => `reportcards/${tenantId}/batches/${batchId}.pdf`;

export async function renderReportCard(deps: ReportcardsDeps, ctx: RequestContext, input: RenderInput): Promise<Result<RenderOutcome, AppError>> {
  const renderer = deps.ports.renderer;
  if (!renderer) return err(internal("Le moteur de rendu PDF n'est pas disponible dans ce processus.", ReportcardsCode.PORT_UNAVAILABLE));
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? deps.config.maxRenderAttempts;
  const startedAt = Date.now();

  // 1) Réserve la tentative (visible : RENDERING) et lit le snapshot + le gabarit figés par sa version.
  type Prepared =
    | { already: true; record: ReportCardRecord }
    | { already: false; record: ReportCardRecord; snapshot: ReportcardSnapshot; template: PlatformTemplate; renderId: Uuid };
  const prepared = await inTx<Prepared>(deps, ctx, async (tx) => {
    const content = await cardsRepo.getCardContent(tx, input.reportCardId);
    if (!content) return err(notFound("Bulletin", input.reportCardId));
    const { record, snapshot } = content;
    if (!input.force && record.renderStatus === "RENDERED" && (await cardsRepo.getCurrentRender(tx, record))) {
      return ok({ already: true, record });
    }
    const template = await getPlatformTemplate(tx, snapshot.template.key, snapshot.template.version);
    if (!template) return err(internal("Le gabarit utilisé par ce bulletin est introuvable.", ReportcardsCode.TEMPLATE_NOT_FOUND));
    const render = await cardsRepo.insertRender(tx, { id: deps.newId(), tenantId: ctx.tenantId, reportCardId: record.id, status: "RENDERING", attempts: attempt, requestedAt: deps.clock.now() });
    await cardsRepo.setCardRenderState(tx, record.id, "RENDERING", null);
    return ok({ already: false, record, snapshot, template, renderId: render.id });
  });
  if (!prepared.ok) return prepared;
  if (prepared.value.already) {
    return ok({ reportCardId: prepared.value.record.id, renderId: prepared.value.record.currentRenderId, status: "ALREADY_RENDERED", pdfHash: null, sizeBytes: null, batchCompleted: false });
  }
  const { record, snapshot, template, renderId } = prepared.value;

  // 2) Rendu hors transaction : actifs -> HTML -> PDF -> stockage.
  let produced: { pdfHash: string; size: number; pages: number; rendererVersion: string; objectKey: string } | null = null;
  let failure: AppError | null = null;
  try {
    const assets = await loadRenderAssets(deps, snapshot);
    if (!assets.ok) throw assets.error;
    const verification = buildVerificationInfo(deps, record.verificationCode, record.provisional);
    if (!record.provisional && !verification) throw internal("Le domaine public de vérification n'est pas configuré : un document définitif ne peut pas être rendu sans QR.", ReportcardsCode.RENDER_FAILED);
    const html = renderDocumentHtml({ snapshot, template: { body: template.body, css: template.css }, verification, assets: assets.value });
    const result = await renderer.render({ html, title: snapshot.meta.title, issuedAt: record.issuedAt });
    const objectKey = objectKeyFor(ctx.tenantId, record.id, renderId);
    const stored = await deps.ports.storage.put(objectKey, result.pdf, { contentType: "application/pdf" });
    produced = { pdfHash: stored.sha256 || sha256Hex(result.pdf), size: stored.size || result.pdf.length, pages: result.pages, rendererVersion: result.rendererVersion, objectKey };
  } catch (e) {
    failure = e instanceof Error && "kind" in e ? (e as AppError) : internal(`Le rendu PDF a échoué : ${messageOf(e)}`, ReportcardsCode.RENDER_FAILED);
    deps.logger.warn({ reportCardId: record.id, attempt, err: messageOf(e) }, "reportcards : rendu PDF en échec");
  }

  // 3) Résultat dans une transaction : rendu terminé (index de fichier, événements) ou échec (reprise ou FAILED définitif).
  const durationMs = Date.now() - startedAt;
  if (produced) {
    const done = produced;
    return inTx(deps, ctx, async (tx) => {
      const events = new EventBuffer(deps, ctx);
      const now = deps.clock.now();
      await cardsRepo.updateRender(tx, renderId, { status: "RENDERED", objectKey: done.objectKey, pdfHash: done.pdfHash, sizeBytes: done.size, pages: done.pages, rendererVersion: done.rendererVersion, durationMs, finishedAt: now });
      await cardsRepo.setCardRenderState(tx, record.id, "RENDERED", renderId);
      if (!record.provisional) await cardsRepo.registerFileHash(tx, { pdfHash: done.pdfHash, code: record.verificationCode, tenantId: ctx.tenantId });
      events.add(ReportcardsEvents.RENDERED, { v: 1, reportCardId: record.id, renderId, pdfHash: done.pdfHash, sizeBytes: done.size, batchId: record.batchId }, { type: "report_card", id: record.id });
      let batchCompleted = false;
      if (record.batchId) {
        const progress = await batchRepo.refreshBatchProgress(tx, record.batchId, now);
        batchCompleted = progress.justCompleted;
        if (progress.justCompleted) {
          events.add(ReportcardsEvents.BATCH_COMPLETED, { v: 1, batchId: record.batchId, issued: progress.batch.issued, excluded: progress.batch.excluded, failed: progress.batch.failed + progress.failedRenders }, { type: "batch", id: record.batchId });
        }
      }
      await events.flush(tx);
      return ok({ reportCardId: record.id, renderId, status: "RENDERED" as const, pdfHash: done.pdfHash, sizeBytes: done.size, batchCompleted });
    });
  }

  const final = attempt >= maxAttempts;
  const reason = failure?.message ?? "Rendu en échec.";
  const marked = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const now = deps.clock.now();
    await cardsRepo.updateRender(tx, renderId, { status: "FAILED", error: truncate(reason), durationMs, finishedAt: now });
    await cardsRepo.setCardRenderState(tx, record.id, final ? "FAILED" : "PENDING", null);
    if (final) {
      events.add(ReportcardsEvents.RENDER_FAILED, { v: 1, reportCardId: record.id, renderId, error: truncate(reason, 300), batchId: record.batchId }, { type: "report_card", id: record.id });
      if (record.batchId) {
        const progress = await batchRepo.refreshBatchProgress(tx, record.batchId, now);
        if (progress.justCompleted) {
          events.add(ReportcardsEvents.BATCH_COMPLETED, { v: 1, batchId: record.batchId, issued: progress.batch.issued, excluded: progress.batch.excluded, failed: progress.batch.failed + progress.failedRenders }, { type: "batch", id: record.batchId });
        }
      }
    }
    await events.flush(tx);
    return ok(undefined);
  });
  if (!marked.ok) return marked;
  return err(
    conflict(`Rendu PDF en échec (tentative ${attempt}/${maxAttempts}) : ${reason}`, ReportcardsCode.RENDER_FAILED, { attempt, maxAttempts, final, reportCardId: record.id }),
  );
}

/**
 * Reprise explicite d'un rendu : remet le bulletin en attente et publie une demande de rendu (événement consommé par le worker).
 * Sans effet sur le contenu du snapshot (déjà figé).
 */
export async function requestRender(deps: ReportcardsDeps, ctx: RequestContext, input: { reportCardId: Uuid }): Promise<Result<ReportCardRecord, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const card = await cardsRepo.getCard(tx, input.reportCardId, { forUpdate: true });
    if (!card) return err(notFound("Bulletin", input.reportCardId));
    const events = new EventBuffer(deps, ctx);
    await cardsRepo.setCardRenderState(tx, card.id, "PENDING", null);
    events.add(ReportcardsEvents.RENDER_REQUESTED, { v: 1, reportCardId: card.id }, { type: "report_card", id: card.id });
    events.audit({ action: "reportcards.report_card.render_requested", resourceType: "report_card", resourceId: card.id, metadata: { studentId: card.studentId } });
    await events.flush(tx);
    return ok({ ...card, renderStatus: "PENDING" as const });
  });
}

/** Reprise d'un lot : tous les rendus en échec (ou en attente depuis trop longtemps) sont redemandés. */
export async function retryBatchRenders(deps: ReportcardsDeps, ctx: RequestContext, input: { batchId: Uuid }): Promise<Result<{ requested: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const batch = await batchRepo.getBatch(tx, input.batchId, { forUpdate: true });
    if (!batch) return err(notFound("Lot de génération", input.batchId));
    const failed = await tx.many<{ id: string }>(`SELECT id FROM reportcards.report_cards WHERE batch_id = $1 AND render_status IN ('FAILED','PENDING') ORDER BY id`, [input.batchId]);
    const events = new EventBuffer(deps, ctx);
    for (const c of failed) {
      await cardsRepo.setCardRenderState(tx, c.id, "PENDING", null);
      events.add(ReportcardsEvents.RENDER_REQUESTED, { v: 1, reportCardId: c.id }, { type: "report_card", id: c.id });
    }
    if (failed.length) {
      await tx.query(`UPDATE reportcards.batches SET status = 'RENDERING', finished_at = NULL WHERE id = $1`, [input.batchId]);
      events.audit({ action: "reportcards.batch.retry", resourceType: "batch", resourceId: input.batchId, metadata: { requested: failed.length } });
    }
    await events.flush(tx);
    return ok({ requested: failed.length });
  });
}

/** PDF combiné de la classe : fusion des rendus courants du lot (par nom d'élève), stocké sous `batches/<id>.pdf`. */
export async function buildCombinedPdf(deps: ReportcardsDeps, ctx: RequestContext, input: { batchId: Uuid }): Promise<Result<{ key: string; pages: number; count: number }, AppError>> {
  const merger = deps.ports.merger;
  if (!merger) return err(internal("La fusion de PDF n'est pas disponible dans ce processus.", ReportcardsCode.PORT_UNAVAILABLE));
  const gathered = await inTx(
    deps,
    ctx,
    async (tx) => {
      const batch = await batchRepo.getBatch(tx, input.batchId);
      if (!batch) return err(notFound("Lot de génération", input.batchId));
      const cards: ReportCardRecord[] = [];
      let cursor: string | undefined;
      do {
        const page = await cardsRepo.listCards(tx, { batchId: input.batchId }, { limit: 200, ...(cursor ? { cursor } : {}) });
        cards.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      const keys: Array<{ name: string; key: string }> = [];
      for (const c of cards) {
        const render = await cardsRepo.getCurrentRender(tx, c);
        if (render?.objectKey) keys.push({ name: c.studentName, key: render.objectKey });
      }
      return ok(keys.sort((a, b) => a.name.localeCompare(b.name, "fr")));
    },
    { readOnly: true },
  );
  if (!gathered.ok) return gathered;
  if (gathered.value.length === 0) return err(conflict("Aucun PDF rendu dans ce lot.", ReportcardsCode.NOT_RENDERED));
  const pdfs: Uint8Array[] = [];
  for (const item of gathered.value) {
    const object = await deps.ports.storage.get(item.key);
    if (!object) return err(internal("Un PDF du lot est introuvable dans le stockage.", ReportcardsCode.ASSET_MISSING));
    pdfs.push(object.bytes);
  }
  const merged = await merger.merge(pdfs);
  const key = combinedKeyFor(ctx.tenantId, input.batchId);
  await deps.ports.storage.put(key, merged.pdf, { contentType: "application/pdf" });
  const saved = await inTx(deps, ctx, async (tx) => {
    await batchRepo.setBatchCombinedPdf(tx, input.batchId, key);
    return ok(undefined);
  });
  if (!saved.ok) return saved;
  return ok({ key, pages: merged.pages, count: pdfs.length });
}

/**
 * Filet de sécurité (job périodique) : redemande le rendu des bulletins restés `PENDING` depuis trop longtemps (événement
 * perdu, worker arrêté). Idempotent : un bulletin déjà rendu n'est jamais re-rendu par ce chemin.
 */
export async function sweepPendingRenders(deps: ReportcardsDeps, ctx: RequestContext, input: { olderThanMs: number; limit: number }): Promise<Result<{ requested: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const cutoff = new Date(deps.clock.now().getTime() - input.olderThanMs);
    const rows = await tx.many<{ id: string }>(
      `SELECT id FROM reportcards.report_cards WHERE render_status = 'PENDING' AND issued_at < $1 ORDER BY issued_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [cutoff, input.limit],
    );
    const events = new EventBuffer(deps, ctx);
    for (const r of rows) events.add(ReportcardsEvents.RENDER_REQUESTED, { v: 1, reportCardId: r.id }, { type: "report_card", id: r.id });
    await events.flush(tx);
    return ok({ requested: rows.length });
  });
}
