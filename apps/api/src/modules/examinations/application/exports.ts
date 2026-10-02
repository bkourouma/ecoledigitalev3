/**
 * EXPORTS OFFICIELS paramétrables : un format PUBLIÉ (donnée, figée) décrit colonnes, champ source de la liste blanche, transformation
 * de la liste blanche, séparateur, encodage et nature de fichier. Aucune expression libre, aucune interpolation.
 *
 *  - L'exécution enregistre la version du format utilisée (déclencheur : la valeur fournie est ignorée), l'effectif, l'empreinte
 *    SHA-256 du fichier et sa clé de stockage ; elle est IMMUABLE ensuite (déclencheur).
 *  - L'injection de formule est neutralisée dans les cellules texte (CSV, XLSX) ; les nombres du module restent numériques.
 *  - Un téléchargement est journalisé (audit) et passe par une URL signée à durée courte : le fichier d'enfants ne circule pas en clair.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamExportRunDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExaminationsEvents } from "../domain/events";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { buildTable, encodeText, FILE_EXTENSION, FILE_MIME, sha256Hex, toCsv, toFixedWidth, toJson, type ExportFacts } from "../domain/export-render";
import type { ExportFormatRow, SessionRow } from "../domain/types";
import * as ref from "../infrastructure/reference-repo";
import * as sess from "../infrastructure/sessions-repo";
import * as out from "../infrastructure/outputs-repo";
import { buildXlsx } from "../infrastructure/xlsx";
import { toRunDto } from "./dto";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";
import { statisticsRows } from "./statistics";

const storageKey = (tenantId: string, runId: string, ext: string): string => `examinations/${tenantId}/exports/${runId}.${ext}`;
const safeName = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);

export async function listExports(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<ExamExportRunDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await sess.getSession(tx, sessionId))) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
      return ok((await out.listExportRuns(tx, sessionId)).map((r) => toRunDto(r, r.formatCode)));
    },
    { readOnly: true },
  );
}

export async function getExport(deps: ExaminationsDeps, ctx: RequestContext, runId: string): Promise<Result<ExamExportRunDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const r = await out.getExportRun(tx, runId);
      if (!r) return err(notFound(ExamCode.EXPORT_NOT_FOUND, "Export", runId));
      const f = await ref.getExportFormat(tx, r.formatId);
      return ok(toRunDto(r, f?.code ?? null));
    },
    { readOnly: true },
  );
}

async function collectFacts(deps: ExaminationsDeps, ctx: RequestContext, session: SessionRow, format: ExportFormatRow, filters: { trackCode?: string | undefined; registrationStatus?: string | undefined; groupBy?: string | undefined }): Promise<Result<ExportFacts[], AppError>> {
  if (format.kind === "STATISTICS") {
    const groupBy = (filters.groupBy ?? "ALL") as Parameters<typeof statisticsRows>[3];
    const rows = await statisticsRows(deps, ctx, session.id, groupBy);
    if (!rows.ok) return rows;
    return ok(rows.value.map((g) => ({ stat: { group: g.groupKey, registered: g.registered, present: g.present, admitted: g.admitted, failed: g.failed, absent: g.absent, excluded: g.excluded, deferred: g.deferred, rate: g.rate } })));
  }
  const institutionName = await deps.ports.institutions.nameOf(ctx, session.institutionId).catch(() => null);
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => ok(await out.loadExportFacts(tx, { sessionId: session.id, trackCode: filters.trackCode, registrationStatus: filters.registrationStatus, institutionName, limit: deps.config.exportMaxRows + 1 })),
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  if (loaded.value.length > deps.config.exportMaxRows) return err(validation(ExamCode.EXPORT_FAILED, `L'export dépasse ${deps.config.exportMaxRows} lignes : affiner le filtre.`, "filters"));
  let facts = loaded.value.map((l) => l.facts);
  if (format.kind === "CENTER_ASSIGNMENTS") facts = facts.filter((f) => f.assignment?.centerCode);
  if (format.kind === "RESULTS") facts = facts.filter((f) => f.result?.code);
  return ok(facts);
}

/** Produit le fichier selon le format (CSV, largeur fixe, JSON, XLSX) ; l'encodage s'applique aux formats texte. */
export async function renderFile(format: ExportFormatRow, facts: readonly ExportFacts[]): Promise<{ bytes: Uint8Array; rowCount: number }> {
  const table = buildTable(format.columns, facts);
  switch (format.fileFormat) {
    case "XLSX":
      return { bytes: await buildXlsx(table, format.code), rowCount: table.rows.length };
    case "JSON":
      return { bytes: encodeText(toJson(table), format.encoding), rowCount: table.rows.length };
    case "FIXED_WIDTH":
      return { bytes: encodeText(toFixedWidth(table, format.columns), format.encoding), rowCount: table.rows.length };
    default:
      return { bytes: encodeText(toCsv(table, format.delimiter ?? ";"), format.encoding), rowCount: table.rows.length };
  }
}

/** Exécute un export : 1) trace RUNNING (format publié exigé) ; 2) production du fichier ; 3) DONE (empreinte, effectif, stockage) ou FAILED. */
export async function runExport(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  sessionId: string,
  input: { formatId: string; filters: { trackCode?: string | undefined; registrationStatus?: string | undefined; groupBy?: string | undefined } },
): Promise<Result<ExamExportRunDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  const started = await inTx(deps, ctx, async (tx) => {
    const session = await sess.getSession(tx, sessionId);
    if (!session) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    const format = await ref.getExportFormat(tx, input.formatId);
    if (!format) return err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'export", input.formatId));
    if (format.status !== "PUBLISHED") return err(conflict(ExamCode.FORMAT_NOT_PUBLISHED, "Un export exige un format publié."));
    if (format.examTypeId && format.examTypeId !== session.examTypeId) return err(validation(ExamCode.FORMAT_KIND_MISMATCH, "Ce format ne concerne pas le type d'examen de la session.", "formatId"));
    const run = await out.insertExportRun(tx, ctx.tenantId, { id: deps.newId(), sessionId, formatId: format.id, filters: input.filters, requestedBy: actor });
    return ok({ session, format, run });
  });
  if (!started.ok) return started;
  const { session, format, run } = started.value;

  let produced: { bytes: Uint8Array; rowCount: number } | null = null;
  let failure: AppError | null = null;
  try {
    const facts = await collectFacts(deps, ctx, session, format, input.filters);
    if (!facts.ok) failure = facts.error;
    else produced = await renderFile(format, facts.value);
  } catch (e) {
    failure = validation(ExamCode.EXPORT_FAILED, e instanceof Error ? e.message : "La production du fichier a échoué.");
  }

  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    if (failure || !produced) {
      const failed = await out.failExportRun(tx, run.id, (failure?.code ?? ExamCode.EXPORT_FAILED).slice(0, 80));
      events.audit({ action: "examinations.export.failed", resourceType: "export_run", resourceId: run.id, metadata: { sessionId, format: format.code, code: failure?.code ?? ExamCode.EXPORT_FAILED } });
      await events.flush(tx);
      return ok(toRunDto(failed ?? run, format.code));
    }
    const ext = FILE_EXTENSION[format.fileFormat];
    const key = storageKey(ctx.tenantId, run.id, ext);
    const sha256 = sha256Hex(produced.bytes);
    await deps.ports.storage.put(key, produced.bytes, { contentType: FILE_MIME[format.fileFormat] });
    const done = await out.completeExportRun(tx, run.id, { rowCount: produced.rowCount, sha256, storageKey: key });
    events.add(ExaminationsEvents.EXPORT_COMPLETED, { v: 1, sessionId, exportId: run.id, formatCode: format.code, rowCount: produced.rowCount, sha256 }, { type: "examinations.export", id: run.id });
    events.audit({ action: "examinations.export.run", resourceType: "export_run", resourceId: run.id, sensitive: format.kind !== "STATISTICS", metadata: { sessionId, format: format.code, version: format.version, kind: format.kind, rows: produced.rowCount, sha256 } });
    await events.flush(tx);
    return ok(toRunDto(done ?? run, format.code));
  });
}

export interface ExportDownload {
  url: string;
  expiresAt: string;
  fileName: string;
  contentType: string;
  sha256: string;
  rowCount: number;
}

/** URL signée de téléchargement d'un export terminé ; chaque téléchargement est journalisé. */
export async function getExportDownload(deps: ExaminationsDeps, ctx: RequestContext, runId: string): Promise<Result<ExportDownload, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const run = await out.getExportRun(tx, runId);
    if (!run) return err(notFound(ExamCode.EXPORT_NOT_FOUND, "Export", runId));
    if (run.status !== "DONE" || !run.storageKey || !run.fileSha256) return err(conflict(ExamCode.EXPORT_FAILED, "Cet export n'a pas produit de fichier."));
    const format = await ref.getExportFormat(tx, run.formatId);
    const session = await sess.getSession(tx, run.sessionId);
    const ext = format ? FILE_EXTENSION[format.fileFormat] : "dat";
    const contentType = format ? FILE_MIME[format.fileFormat] : "application/octet-stream";
    const fileName = safeName(`${format?.code ?? "export"}_${session?.code ?? run.sessionId}_v${run.formatVersion}.${ext}`);
    const signed = await deps.ports.storage.signedUrl(run.storageKey, { ttlSeconds: deps.config.signedUrlTtlSeconds, fileName, contentType });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.export.download", resourceType: "export_run", resourceId: runId, sensitive: true, metadata: { sessionId: run.sessionId, sha256: run.fileSha256 } });
    await events.flush(tx);
    return ok({ url: signed.url, expiresAt: signed.expiresAt.toISOString(), fileName, contentType, sha256: run.fileSha256, rowCount: run.rowCount ?? 0 });
  });
}
