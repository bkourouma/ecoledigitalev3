/**
 * Recherche dans le TEXTE des PDF (réponse métier Q-14) : cas d'usage de recherche, de réindexation et d'état, et job
 * d'indexation du worker.
 *
 *  - Dépôt : `enqueueForVersion` met en file la version courante (même transaction que la version) ; un fichier qui n'est pas un
 *    PDF supprime l'éventuelle ligne d'index d'une version précédente.
 *  - Job (`indexPendingTexts`, un tenant à la fois) : réserve un lot (bail), lit l'objet, appelle le port `PdfTextExtractor`
 *    (processus fils isolé) HORS transaction, puis écrit le résultat dans une transaction qui trace aussi l'audit. Un PDF sans texte
 *    est marqué `NO_TEXT` (pas d'OCR). Un échec réessayable est repris avec attente croissante (3 essais) ; un échec définitif
 *    (chiffré, corrompu, trop gros) marque `FAILED` avec un code, jamais un extrait.
 *  - Recherche (`searchDocumentText`) : mêmes règles de visibilité que la liste (SQL), vérifiées une seconde fois par la politique
 *    d'accès du domaine ; aucun total, aucune différence entre « invisible » et « sans résultat » ; la lecture d'un extrait d'un
 *    document CONFIDENTIEL est tracée (historique du document + audit sensible).
 */
import { createHash } from "node:crypto";
import { createSystemContext, err, ok, unwrap, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb, Tx } from "@ecoledigitale/database";
import type {
  DocumentTextIndexDto,
  DocumentTextIndexStatusDto,
  DocumentTextReindexResultDto,
  DocumentTextSearchPageDto,
  DocumentTextSearchQuery,
  DocumentTextSnippetSegment,
} from "@ecoledigitale/contracts/src/v2/documents";
import { DocumentsCode, forbidden, validation } from "../domain/errors";
import { resolveAccess } from "../domain/policy";
import type { ActorCaps, Uuid } from "../domain/types";
import * as docs from "../infrastructure/documents-repository";
import * as sharesRepo from "../infrastructure/shares-repository";
import * as textRepo from "../infrastructure/text-index-repository";
import { EventBuffer, inTx, type DocumentsDeps } from "./deps";
import { actorOf, decodeCursor, encodeCursor, ensureDefaults, factsOf, iso, nameBook, summaryDto, todayOf } from "./support";

export const PDF_MIME = "application/pdf";

/** Essais avant échec définitif d'une cause réessayable (délai, plantage de l'extracteur). */
export const MAX_TEXT_INDEX_ATTEMPTS = 3;
/** Texte considéré comme absent : moins de 12 caractères alphanumériques sur tout le document (pages blanches, filigranes). */
export const MIN_ALNUM_CHARS = 12;
/** Bail d'une réservation : au-delà, une autre exécution du job reprend la ligne. */
const LEASE_MS = 15 * 60_000;
/** Lignes réservées par lot, et lots par exécution du job (chaque exécution est bornée dans le temps). */
const CLAIM_BATCH = 10;
const MAX_BATCHES_PER_RUN = 12;

// ---------------------------------------------------------------------------
// Mise en file au dépôt
// ---------------------------------------------------------------------------

/** À appeler dans la transaction qui écrit une version : PDF -> à indexer ; autre type -> aucun index. */
export async function enqueueForVersion(tx: Tx, tenantId: Uuid, documentId: Uuid, versionNo: number, mime: string, now: Date): Promise<void> {
  if (mime === PDF_MIME) await textRepo.enqueueTextIndex(tx, tenantId, documentId, versionNo, now);
  else await textRepo.clearTextIndex(tx, tenantId, documentId);
}

export function textIndexDto(row: textRepo.TextIndexRow | null): DocumentTextIndexDto | null {
  if (!row) return null;
  return {
    status: row.status,
    versionNo: row.versionNo,
    pageCount: row.pageCount,
    pagesIndexed: row.pagesIndexed,
    truncated: row.truncated,
    indexedAt: row.indexedAt ? iso(row.indexedAt) : null,
    errorCode: row.errorCode,
  };
}

// ---------------------------------------------------------------------------
// Extrait : marques de surlignage -> segments de texte brut
// ---------------------------------------------------------------------------

/** Transforme l'extrait de `ts_headline` (marques de contrôle) en segments. Le texte reste du texte : jamais interprété comme du HTML. */
export function snippetSegments(headline: string): DocumentTextSnippetSegment[] {
  const out: DocumentTextSnippetSegment[] = [];
  const push = (text: string, match: boolean): void => {
    const cleaned = text.replace(/\s+/g, " ");
    if (cleaned.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.match === match) last.text += cleaned;
    else out.push({ text: cleaned, match });
  };
  const fragments = headline.split(textRepo.FRAGMENT_SEPARATOR);
  fragments.forEach((fragment, index) => {
    if (index > 0) push(" … ", false);
    let rest = fragment;
    while (rest.length > 0) {
      const start = rest.indexOf(textRepo.MARK_START);
      if (start < 0) {
        push(rest, false);
        break;
      }
      push(rest.slice(0, start), false);
      const end = rest.indexOf(textRepo.MARK_END, start + 1);
      if (end < 0) {
        push(rest.slice(start + 1), false);
        break;
      }
      push(rest.slice(start + 1, end), true);
      rest = rest.slice(end + 1);
    }
  });
  for (const s of out) if (!s.match) s.text = s.text.replace(/\s{2,}/g, " ");
  const first = out[0];
  if (first && !first.match) first.text = first.text.trimStart();
  const last = out[out.length - 1];
  if (last && !last.match) last.text = last.text.trimEnd();
  return out.filter((s) => s.text.length > 0);
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function searchDocumentText(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; query: DocumentTextSearchQuery }): Promise<Result<DocumentTextSearchPageDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  const q = input.query;
  const text = q.q.trim();
  const limit = Math.min(q.limit ?? DEFAULT_LIMIT, 50);
  const decoded = decodeCursor<{ r?: unknown; id?: unknown }>(q.cursor);
  const validCursor = decoded && typeof decoded.r === "string" && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(decoded.r) && typeof decoded.id === "string" && UUID_RE.test(decoded.id);
  if (q.cursor && !validCursor) return err(validation(DocumentsCode.INVALID_INPUT, "Curseur de pagination invalide.", "cursor"));
  const cursor = validCursor ? { r: decoded.r as string, id: decoded.id as string } : null;
  const today = todayOf(deps);

  const loaded = await inTx(deps, ctx, async (tx) => {
    const settings = await ensureDefaults(deps, tx, ctx);
    const now = deps.clock.now();
    const rows = await textRepo.searchTextIndex(tx, ctx.tenantId, actor, now, {
      query: text,
      categoryId: q.categoryId,
      kind: q.kind,
      cursor: cursor ? { rank: cursor.r, id: cursor.id } : undefined,
      limit,
    });
    const page = rows.slice(0, limit);
    // Seconde barrière : la politique d'accès du domaine doit elle aussi autoriser la lecture ; sinon la ligne est écartée.
    const readable = page.filter((r) => resolveAccess(actor, factsOf(r)).view);
    if (readable.length !== page.length) deps.logger.warn({ dropped: page.length - readable.length }, "documents : résultat de recherche écarté par la politique d'accès");
    const confidential = readable.filter((r) => r.confidentiality === "CONFIDENTIAL");
    const events = new EventBuffer(deps, ctx);
    for (const r of confidential) await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: r.id, action: "VIEWED", actorId: actor.userId, detail: { via: "text_search" } }, now);
    events.audit({
      action: "documents.search.executed",
      resourceType: "document_search",
      resourceId: deps.newId(),
      sensitive: confidential.length > 0,
      // Jamais le texte de la requête (il peut contenir une donnée personnelle) : longueur et empreinte courte seulement.
      metadata: {
        queryLength: text.length,
        queryDigest: createHash("sha256").update(text.toLowerCase()).digest("hex").slice(0, 16),
        resultCount: readable.length,
        confidentialDocumentIds: confidential.map((r) => r.id),
        categoryId: q.categoryId ?? null,
        kind: q.kind ?? null,
        paged: Boolean(cursor),
      },
    });
    await events.flush(tx);
    return ok({ rows, readable, settings });
  });
  if (!loaded.ok) return loaded;
  const { rows, readable, settings } = loaded.value;
  const names = await nameBook(deps, ctx, readable);
  const items = readable.map((r) => ({
    document: summaryDto(r, resolveAccess(actor, factsOf(r)), names, settings, today),
    snippet: snippetSegments(r.headline),
    versionNo: r.versionNo,
    pageCount: r.pageCount,
    pagesIndexed: r.pagesIndexed,
    truncated: r.truncated,
    score: Number(r.rank),
  }));
  const lastRow = rows.length > limit ? rows[limit - 1] : undefined;
  return ok({ items, nextCursor: lastRow ? encodeCursor({ r: lastRow.rank, id: lastRow.id }) : null });
}

// ---------------------------------------------------------------------------
// Administration de l'index (gestion)
// ---------------------------------------------------------------------------

export async function textIndexStatus(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps }): Promise<Result<DocumentTextIndexStatusDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  if (actorR.value.caps.manage !== true) return err(forbidden(DocumentsCode.FORBIDDEN, "L'état de l'index de texte est réservé à la gestion."));
  return inTx(deps, ctx, async (tx) => ok(await textRepo.textIndexStats(tx, ctx.tenantId)), { readOnly: true });
}

/** Remet des PDF en file d'indexation (réservé à la gestion ; audité). */
export async function reindexTexts(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; scope: "FAILED" | "ALL" }): Promise<Result<DocumentTextReindexResultDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  if (actor.caps.manage !== true) return err(forbidden(DocumentsCode.FORBIDDEN, "La réindexation est réservée à la gestion."));
  return inTx(deps, ctx, async (tx) => {
    const queued = await textRepo.requeueTextIndex(tx, ctx.tenantId, input.scope, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "documents.text_index.reindex_requested", resourceType: "document_text_index", resourceId: ctx.tenantId, sensitive: true, metadata: { scope: input.scope, queued } });
    await events.flush(tx);
    return ok({ queued });
  });
}

// ---------------------------------------------------------------------------
// Job d'indexation (worker)
// ---------------------------------------------------------------------------

export interface TextIndexingReport {
  claimed: number;
  indexed: number;
  noText: number;
  failed: number;
  retried: number;
  skipped: number;
  /** Vrai si l'extracteur n'est pas installé : les lignes restent en file. */
  extractorUnavailable: boolean;
}

const backoffMs = (attempts: number): number => 5 * 60_000 * 2 ** Math.max(0, attempts - 1);

const hasEnoughText = (text: string): boolean => (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= MIN_ALNUM_CHARS;

/** Traite la file d'un tenant. Idempotent et rejouable ; ne lève pas pour un PDF défectueux. */
export async function indexPendingTexts(deps: DocumentsDeps, ctx: RequestContext): Promise<TextIndexingReport> {
  const report: TextIndexingReport = { claimed: 0, indexed: 0, noText: 0, failed: 0, retried: 0, skipped: 0, extractorUnavailable: false };
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const now = deps.clock.now();
    const claims = unwrap(await inTx(deps, ctx, async (tx) => ok(await textRepo.claimDueTextIndex(tx, ctx.tenantId, now, new Date(now.getTime() + LEASE_MS), CLAIM_BATCH))));
    if (claims.length === 0) break;
    report.claimed += claims.length;
    for (const claim of claims) {
      if (report.extractorUnavailable) {
        await finish(deps, ctx, claim, { kind: "RELEASE", retryAt: new Date(deps.clock.now().getTime() + 5 * 60_000) }, report);
        continue;
      }
      await processClaim(deps, ctx, claim, report);
    }
    if (report.extractorUnavailable) break;
    if (claims.length < CLAIM_BATCH) break;
  }
  return report;
}

async function processClaim(deps: DocumentsDeps, ctx: RequestContext, claim: textRepo.TextIndexClaim, report: TextIndexingReport): Promise<void> {
  // 1. La version existe-t-elle encore, est-ce toujours la version courante d'un PDF non purgé ?
  const target = unwrap(
    await inTx(
      deps,
      ctx,
      async (tx) => {
        const version = await docs.getVersion(tx, ctx.tenantId, claim.documentId, claim.versionNo);
        const doc = await tx.queryOne<{ current: number; purgedAt: Date | null }>(
          `SELECT current_version_no AS current, purged_at AS "purgedAt" FROM documents.documents WHERE tenant_id = $1 AND id = $2`,
          [ctx.tenantId, claim.documentId],
        );
        return ok({ version, doc });
      },
      { readOnly: true },
    ),
  );
  if (target.doc && !target.doc.purgedAt && target.doc.current !== claim.versionNo) {
    // Une version plus récente a été déposée : le dépôt a déjà remis la ligne en file pour elle, rien à écrire ici.
    report.skipped += 1;
    return;
  }
  if (!target.doc || target.doc.purgedAt || !target.version || target.version.state !== "ACTIVE" || target.version.mime !== PDF_MIME) {
    // Plus rien à indexer pour cette ligne (document purgé, version purgée, autre type) : l'index est supprimé.
    unwrap(
      await inTx(deps, ctx, async (tx) => {
        await textRepo.clearTextIndex(tx, ctx.tenantId, claim.documentId);
        return ok(true as const);
      }),
    );
    report.skipped += 1;
    return;
  }

  // 2. Lecture de l'objet puis extraction (hors transaction : processus fils, durée bornée).
  let bytes: Uint8Array | null;
  try {
    const object = await deps.ports.storage.get(target.version.storageKey);
    bytes = object ? object.bytes : null;
  } catch (e) {
    deps.logger.warn({ documentId: claim.documentId, err: e instanceof Error ? e.message : String(e) }, "documents : lecture de l'objet impossible pour l'indexation");
    await finish(deps, ctx, claim, { kind: "RELEASE", retryAt: new Date(deps.clock.now().getTime() + 5 * 60_000) }, report);
    return;
  }
  if (bytes === null) {
    await finish(deps, ctx, claim, { kind: "FAILED", errorCode: "object_missing" }, report);
    return;
  }
  const result = await deps.ports.textExtractor.extract(bytes);

  // 3. Résultat.
  if (result.ok) {
    if (!hasEnoughText(result.text)) await finish(deps, ctx, claim, { kind: "NO_TEXT", pageCount: result.pageCount, pagesIndexed: result.pagesRead }, report);
    else await finish(deps, ctx, claim, { kind: "INDEXED", text: result.text, pageCount: result.pageCount, pagesIndexed: result.pagesRead, truncated: result.truncated }, report);
    return;
  }
  if (result.code === "unavailable") {
    report.extractorUnavailable = true;
    await finish(deps, ctx, claim, { kind: "RELEASE", retryAt: new Date(deps.clock.now().getTime() + 5 * 60_000) }, report);
    return;
  }
  if (result.retryable && claim.attempts < MAX_TEXT_INDEX_ATTEMPTS) {
    await finish(deps, ctx, claim, { kind: "RETRY", errorCode: result.code, retryAt: new Date(deps.clock.now().getTime() + backoffMs(claim.attempts)) }, report);
    return;
  }
  await finish(deps, ctx, claim, { kind: "FAILED", errorCode: result.code }, report);
}

/** Écrit le résultat et l'audit dans UNE transaction ; un texte que Postgres refuse d'indexer devient un échec définitif. */
async function finish(deps: DocumentsDeps, ctx: RequestContext, claim: textRepo.TextIndexClaim, outcome: textRepo.TextIndexOutcome, report: TextIndexingReport): Promise<void> {
  const write = (o: textRepo.TextIndexOutcome) =>
    inTx(deps, ctx, async (tx) => {
      const now = deps.clock.now();
      const changed = await textRepo.completeTextIndex(tx, ctx.tenantId, claim.documentId, claim.versionNo, o, now);
      if (changed === 0) return ok("superseded" as const);
      if (o.kind === "RELEASE" || o.kind === "RETRY") return ok("pending" as const);
      const events = new EventBuffer(deps, ctx);
      events.audit({
        action: o.kind === "FAILED" ? "documents.text_index.failed" : "documents.text_index.indexed",
        resourceType: "document",
        resourceId: claim.documentId,
        metadata: {
          versionNo: claim.versionNo,
          status: o.kind,
          ...(o.kind === "INDEXED" ? { pageCount: o.pageCount, pagesIndexed: o.pagesIndexed, characters: o.text.length, truncated: o.truncated } : {}),
          ...(o.kind === "NO_TEXT" ? { pageCount: o.pageCount, pagesIndexed: o.pagesIndexed } : {}),
          ...(o.kind === "FAILED" ? { errorCode: o.errorCode } : {}),
        },
      });
      await events.flush(tx);
      return ok("done" as const);
    });
  let written: Result<"superseded" | "pending" | "done", AppError>;
  try {
    written = await write(outcome);
  } catch (e) {
    // Texte refusé par l'index (ex. tsvector trop gros) : échec définitif, sans bloquer le reste de la file.
    deps.logger.warn({ documentId: claim.documentId, err: e instanceof Error ? e.message : String(e) }, "documents : texte refusé par l'index");
    written = await write({ kind: "FAILED", errorCode: "index_error" });
    outcome = { kind: "FAILED", errorCode: "index_error" };
  }
  if (!written.ok) throw written.error;
  if (written.value === "superseded") {
    report.skipped += 1;
    return;
  }
  switch (outcome.kind) {
    case "INDEXED":
      report.indexed += 1;
      break;
    case "NO_TEXT":
      report.noText += 1;
      break;
    case "FAILED":
      report.failed += 1;
      break;
    case "RETRY":
      report.retried += 1;
      break;
    default:
      break;
  }
}

export function indexPendingTextsAllTenants(deps: DocumentsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<TextIndexingReport>> {
  return systemDb.forEachTenant("documents-text-index", async (_tx, tenant) => indexPendingTexts(deps, createSystemContext(tenant.id)));
}
