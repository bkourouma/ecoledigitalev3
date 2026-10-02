/**
 * LOTS D'IMPORT : numéros officiels, notes et RÉSULTATS OFFICIELS fournis par l'autorité (fichier), reproduits fidèlement.
 *
 *  1. création  : le fichier (SHA-256) n'est importé QU'UNE fois par session et nature (unicité) ; stocké hors base ;
 *  2. validation: analyse selon un FORMAT D'IMPORT publié (donnée), ligne à ligne ; chaque ligne est résolue (candidat inscrit,
 *                 épreuve de la session, barème…) ; un lot avec ERREUR est REFUSÉ (rapport ligne à ligne), jamais appliqué ;
 *  3. application: UNE transaction pour tout le lot (aucune application partielle) ; un lot appliqué est immuable. Sensible.
 * Les lignes ne contiennent ni nom ni adresse (clé = numéro de candidat ou identifiant officiel). Aucune admission n'est calculée :
 * le résultat importé est celui de l'autorité (`source = IMPORTED`).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamBatchDto, ExamCreateImportBody, ExamImportRowDto, ExamPage } from "@ecoledigitale/contracts/src/v2/examinations";
import { compareDecimal, normalizeDecimal } from "../domain/decimal";
import { sha256Hex } from "../domain/export-render";
import { ExaminationsEvents } from "../domain/events";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { analyze, FileError, IMPORT_ERROR, IMPORT_LIMITS, payloadOf, type ImportErrorCode, type ParsedRow } from "../domain/import-parse";
import type { BatchRow, CandidateRow, ImportFormatRow, SessionPaperRow, SessionRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as ref from "../infrastructure/reference-repo";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import { toBatchDto } from "./dto";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";
import { ACCEPTS_SCORES } from "../domain/lifecycle";

const storageKey = (tenantId: string, batchId: string): string => `examinations/${tenantId}/imports/${batchId}.dat`;

async function sessionOf(tx: Parameters<typeof sess.getSession>[0], id: string): Promise<Result<SessionRow, AppError>> {
  const s = await sess.getSession(tx, id);
  return s ? ok(s) : err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", id));
}

export async function listBatches(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<ExamBatchDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const s = await sessionOf(tx, sessionId);
      if (!s.ok) return s;
      return ok((await res.listBatches(tx, sessionId)).map(toBatchDto));
    },
    { readOnly: true },
  );
}

export async function getBatch(deps: ExaminationsDeps, ctx: RequestContext, batchId: string, rows: { status?: string | undefined; page: number; pageSize: number }): Promise<Result<{ batch: ExamBatchDto; rows: ExamPage<ExamImportRowDto> }, AppError>> {
  const pageSize = Math.min(rows.pageSize, deps.config.pageSizeMax);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const b = await res.getBatch(tx, batchId);
      if (!b) return err(notFound(ExamCode.BATCH_NOT_FOUND, "Lot d'import", batchId));
      const page = await res.listImportRows(tx, { batchId, status: rows.status, page: rows.page, pageSize });
      const ids = [...new Set(page.items.map((r) => r.candidateId).filter((x): x is string => x !== null))];
      const numbers = new Map((await cand.listCandidatesByIds(tx, ids)).map((c) => [c.id, c.candidateNumber]));
      return ok({
        batch: toBatchDto(b),
        rows: {
          items: page.items.map((r) => ({ id: r.id, lineNo: r.lineNo, status: r.status, errorCode: r.errorCode, candidateNumber: r.candidateId ? numbers.get(r.candidateId) ?? null : null, payload: r.payload })),
          total: page.total,
          page: rows.page,
          pageSize,
        },
      });
    },
    { readOnly: true },
  );
}

/** Étape 1 : enregistre le fichier (empreinte unique par session et nature) sans l'analyser. */
export async function createImport(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, body: ExamCreateImportBody): Promise<Result<ExamBatchDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  const bytes = Buffer.from(body.contentBase64, "base64");
  if (bytes.byteLength === 0) return err(validation(ExamCode.FILE_EMPTY, "Le fichier est vide.", "contentBase64"));
  if (bytes.byteLength > IMPORT_LIMITS.maxBytes) return err(validation(ExamCode.FILE_TOO_LARGE, "Le fichier dépasse la taille maximale de 5 Mio.", "contentBase64"));
  const sha256 = sha256Hex(bytes);
  return inTx(deps, ctx, async (tx) => {
    const s = await sessionOf(tx, sessionId);
    if (!s.ok) return s;
    if (s.value.sessionKind === "MOCK" && body.kind === "RESULTS") return err(conflict(ExamCode.MOCK_NOT_IMPORTED, "Les résultats d'un examen blanc sont calculés, jamais importés."));
    const format = await ref.getImportFormat(tx, body.formatId);
    if (!format) return err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'import", body.formatId));
    if (format.status !== "PUBLISHED") return err(conflict(ExamCode.FORMAT_NOT_PUBLISHED, "Un import exige un format publié."));
    if (format.kind !== body.kind) return err(validation(ExamCode.FORMAT_KIND_MISMATCH, `Ce format décrit un fichier de nature ${format.kind}, pas ${body.kind}.`, "formatId"));
    if (format.examTypeId && format.examTypeId !== s.value.examTypeId) return err(validation(ExamCode.FORMAT_KIND_MISMATCH, "Ce format ne concerne pas le type d'examen de la session.", "formatId"));
    const batch = await res.insertBatch(tx, ctx.tenantId, { id: deps.newId(), sessionId, kind: body.kind, fileName: body.fileName, sha256, formatCode: `${format.code}@${format.version}`, uploadedBy: actor });
    await deps.ports.storage.put(storageKey(ctx.tenantId, batch.id), new Uint8Array(bytes), { contentType: "application/octet-stream" });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.import.create", resourceType: "import_batch", resourceId: batch.id, metadata: { sessionId, kind: body.kind, sha256, bytes: bytes.byteLength, format: batch.formatCode } });
    await events.flush(tx);
    return ok(toBatchDto(batch));
  });
}

/** Résout la clé d'une ligne en candidat de la session (numéro interne, numéro officiel, code CEPE, identifiant national). */
async function resolveKey(tx: Parameters<typeof sess.getSession>[0], sessionId: string, row: ParsedRow): Promise<CandidateRow | null> {
  switch (row.keyTarget) {
    case "key.candidate_number": return cand.getCandidateByNumber(tx, sessionId, row.keyValue);
    case "key.official_number": return cand.getCandidateByIdentifier(tx, sessionId, "OFFICIAL_NUMBER", row.keyValue);
    case "key.cepe_code": return cand.getCandidateByIdentifier(tx, sessionId, "CEPE_CODE", row.keyValue);
    case "key.national_id": return cand.getCandidateByIdentifier(tx, sessionId, "NATIONAL_ID", row.keyValue);
    default: return null;
  }
}

export interface ValidateReport {
  batch: ExamBatchDto;
  /** Erreur de FICHIER (en-tête, encodage, taille) : le lot est refusé sans ligne. */
  fileError: string | null;
  ignoredHeaders: string[];
  errorsByCode: Record<string, number>;
}

/** Étape 2 : analyse le fichier, résout chaque ligne, enregistre le rapport (ajout seul) et fait passer le lot à VALIDATED ou REJECTED. */
export async function validateImport(deps: ExaminationsDeps, ctx: RequestContext, batchId: string): Promise<Result<ValidateReport, AppError>> {
  const loaded = await inTx(deps, ctx, async (tx) => {
    const batch = await res.getBatch(tx, batchId);
    if (!batch) return err(notFound(ExamCode.BATCH_NOT_FOUND, "Lot d'import", batchId));
    if (batch.status !== "UPLOADED") return err(conflict(ExamCode.BATCH_TRANSITION, `Ce lot est déjà ${batch.status} : il ne s'analyse plus.`));
    const [code, versionText] = (batch.formatCode ?? "").split("@");
    const format = code && versionText ? await ref.getImportFormatByRef(tx, code, Number(versionText)) : null;
    if (!format) return err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'import", batch.formatCode ?? ""));
    return ok({ batch, format });
  }, { readOnly: true });
  if (!loaded.ok) return loaded;
  const { batch, format } = loaded.value;
  const object = await deps.ports.storage.get(storageKey(ctx.tenantId, batchId));

  return inTx(deps, ctx, async (tx) => {
    const locked = await res.getBatch(tx, batchId, { forUpdate: true });
    if (!locked || locked.status !== "UPLOADED") return err(conflict(ExamCode.BATCH_TRANSITION, "Ce lot n'est plus en attente d'analyse."));
    const events = new EventBuffer(deps, ctx);
    const finish = async (rowsCount: number, ok_: number, errors: number, fileError: string | null, ignored: string[], byCode: Record<string, number>): Promise<Result<ValidateReport, AppError>> => {
      const status = errors === 0 && !fileError && rowsCount > 0 ? "VALIDATED" : "REJECTED";
      const updated = (await res.setBatchValidated(tx, batchId, { rowCount: rowsCount, okCount: ok_, errorCount: errors, status })) as BatchRow;
      events.audit({ action: "examinations.import.validate", resourceType: "import_batch", resourceId: batchId, metadata: { sessionId: batch.sessionId, rows: rowsCount, ok: ok_, errors, status, fileError: fileError ? true : false } });
      await events.flush(tx);
      return ok({ batch: toBatchDto(updated), fileError, ignoredHeaders: ignored, errorsByCode: byCode });
    };
    if (!object) return finish(0, 0, 0, "Le fichier du lot est introuvable dans le stockage.", [], {});
    let parsed;
    try {
      parsed = analyze(format as ImportFormatRow, object.bytes);
    } catch (e) {
      if (e instanceof FileError) return finish(0, 0, 0, e.message, [], {});
      throw e;
    }
    const session = (await sess.getSession(tx, batch.sessionId)) as SessionRow;
    const papersByCode = new Map<string, SessionPaperRow[]>();
    for (const p of await sess.listSessionPapers(tx, batch.sessionId)) papersByCode.set(p.code, [...(papersByCode.get(p.code) ?? []), p]);
    const out: Array<{ id: string; lineNo: number; status: "OK" | "ERROR"; errorCode: string | null; candidateId: string | null; payload: Record<string, unknown> }> = [];
    const byCode: Record<string, number> = {};
    let okCount = 0;
    let errorCount = 0;
    for (const row of parsed.rows) {
      const errors: ImportErrorCode[] = [...row.errors];
      let candidate: CandidateRow | null = null;
      if (errors.length === 0 || !errors.includes(IMPORT_ERROR.KEY_MISSING)) {
        candidate = row.keyValue ? await resolveKey(tx, batch.sessionId, row) : null;
        if (row.keyValue && !candidate) errors.push(IMPORT_ERROR.CANDIDATE_UNKNOWN);
        else if (candidate && candidate.registrationStatus !== "REGISTERED") errors.push(IMPORT_ERROR.CANDIDATE_NOT_REGISTERED);
      }
      if (candidate && errors.length === 0) {
        if (batch.kind === "RESULTS") {
          const existing = await res.getResultOfCandidate(tx, candidate.id);
          if (existing?.status === "PUBLISHED") errors.push(IMPORT_ERROR.RESULT_ALREADY_PUBLISHED);
        } else if (batch.kind === "SCORES") {
          for (const [paperCode, v] of Object.entries(row.papers)) {
            const options = papersByCode.get(paperCode) ?? [];
            const paper = options.find((p) => p.trackCode === null || p.trackCode === candidate?.trackCode);
            if (options.length === 0) errors.push(IMPORT_ERROR.PAPER_UNKNOWN);
            else if (!paper) errors.push(IMPORT_ERROR.PAPER_NOT_FOR_TRACK);
            else if (v.score !== undefined && compareDecimal(v.score, paper.scaleMax) > 0) errors.push(IMPORT_ERROR.SCORE_ABOVE_SCALE);
          }
        } else if (row.officialNumber) {
          const holder = await cand.getCandidateByIdentifier(tx, batch.sessionId, "OFFICIAL_NUMBER", row.officialNumber);
          if (holder && holder.id !== candidate.id) errors.push(IMPORT_ERROR.OFFICIAL_NUMBER_TAKEN);
        }
      }
      const unique = [...new Set(errors)];
      for (const e of unique) byCode[e] = (byCode[e] ?? 0) + 1;
      const failed = unique.length > 0;
      if (failed) errorCount += 1;
      else okCount += 1;
      out.push({ id: deps.newId(), lineNo: row.lineNo, status: failed ? "ERROR" : "OK", errorCode: failed ? (unique[0] as string) : null, candidateId: candidate?.id ?? null, payload: { ...payloadOf(row, batch.kind), ...(unique.length > 1 ? { errors: unique } : {}) } });
    }
    await res.insertImportRows(tx, ctx.tenantId, batchId, out);
    void session;
    return finish(parsed.rows.length, okCount, errorCount, null, parsed.ignoredHeaders, byCode);
  });
}

/** Étape 3 : applique le lot VALIDÉ en une seule transaction (tout ou rien). Sensible : permission de publication des résultats. */
export async function applyImport(deps: ExaminationsDeps, ctx: RequestContext, batchId: string): Promise<Result<ExamBatchDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const batch = await res.getBatch(tx, batchId, { forUpdate: true });
    if (!batch) return err(notFound(ExamCode.BATCH_NOT_FOUND, "Lot d'import", batchId));
    if (batch.status === "APPLIED") return err(conflict(ExamCode.BATCH_CLOSED, "Ce lot est déjà appliqué."));
    if (batch.status !== "VALIDATED") return err(conflict(ExamCode.BATCH_NOT_VALIDATED, batch.status === "REJECTED" ? "Un lot refusé ne s'applique pas : corriger le fichier et le déposer à nouveau." : "Le lot doit d'abord être validé."));
    if (batch.errorCount > 0) return err(conflict(ExamCode.BATCH_HAS_ERRORS, "Un lot en erreur ne s'applique pas."));
    const session = (await sess.getSession(tx, batch.sessionId)) as SessionRow;
    if (batch.kind !== "OFFICIAL_NUMBERS" && !ACCEPTS_SCORES.includes(session.status)) {
      return err(conflict(ExamCode.RESULTS_CLOSED, `L'application exige une session en cours ou à résultats saisis (session ${session.status}).`));
    }
    const rows = await res.listOkImportRows(tx, batchId);
    const papers = new Map((await sess.listSessionPapers(tx, batch.sessionId)).map((p) => [p.id, p]));
    const papersByCode = new Map<string, SessionPaperRow[]>();
    for (const p of papers.values()) papersByCode.set(p.code, [...(papersByCode.get(p.code) ?? []), p]);
    // Aucun SAVEPOINT : la première erreur fait échouer le lot ENTIER (aucune application partielle).
    for (const row of rows) {
      const candidate = row.candidateId ? await cand.getCandidate(tx, row.candidateId) : null;
      if (!candidate) return err(conflict(ExamCode.BATCH_HAS_ERRORS, `Ligne ${row.lineNo} : le candidat n'existe plus.`, { lineNo: row.lineNo }));
      const payload = row.payload as { result?: { code: string; average: string | null; totalPoints: string | null; rank: number | null; mention: string | null }; papers?: Record<string, { score?: string; status?: string }>; officialNumber?: string };
      if (batch.kind === "RESULTS" && payload.result) {
        const r = payload.result;
        const write = {
          resultCode: r.code as never, average: r.average, totalPoints: r.totalPoints, rank: r.rank, mentionCode: r.mention, source: "IMPORTED" as const, ruleVersionRef: null, inputsHash: null, importBatchId: batchId, enteredBy: null,
        };
        const existing = await res.getResultOfCandidate(tx, candidate.id);
        if (existing) {
          if (existing.status === "PUBLISHED") return err(conflict(ExamCode.RESULT_REVISION_REQUIRED, `Ligne ${row.lineNo} : ce résultat est publié (révision exigée).`, { lineNo: row.lineNo }));
          await res.replaceDraftResult(tx, existing.id, write);
        } else await res.insertResult(tx, ctx.tenantId, { id: deps.newId(), sessionId: batch.sessionId, candidateId: candidate.id, ...write });
      } else if (batch.kind === "SCORES" && payload.papers) {
        for (const [code, v] of Object.entries(payload.papers)) {
          const paper = (papersByCode.get(code) ?? []).find((p) => p.trackCode === null || p.trackCode === candidate.trackCode);
          if (!paper) return err(conflict(ExamCode.PAPER_NOT_FOUND, `Ligne ${row.lineNo} : l'épreuve ${code} est introuvable.`, { lineNo: row.lineNo }));
          const status = (v.status ?? "ENTERED") as "ENTERED" | "ABSENT" | "EXCUSED" | "MALPRACTICE";
          const score = status === "ENTERED" && v.score !== undefined ? normalizeDecimal(v.score) : null;
          const existing = await res.getScoreOf(tx, candidate.id, paper.id);
          if (existing) await res.updateScore(tx, existing.id, { status, score, source: "IMPORT", sourceRef: batchId, enteredBy: null });
          else await res.insertScore(tx, ctx.tenantId, { id: deps.newId(), sessionId: batch.sessionId, candidateId: candidate.id, paperId: paper.id, status, score, source: "IMPORT", sourceRef: batchId, enteredBy: null });
        }
      } else if (batch.kind === "OFFICIAL_NUMBERS" && payload.officialNumber) {
        await cand.upsertIdentifier(tx, ctx.tenantId, { id: deps.newId(), sessionId: batch.sessionId, candidateId: candidate.id, kind: "OFFICIAL_NUMBER", value: payload.officialNumber, source: "IMPORT" });
      }
    }
    const applied = await res.setBatchApplied(tx, batchId, actor);
    if (!applied) return err(conflict(ExamCode.BATCH_CLOSED, "Ce lot n'est plus applicable."));
    const events = new EventBuffer(deps, ctx);
    events.add(ExaminationsEvents.IMPORT_APPLIED, { v: 1, sessionId: batch.sessionId, batchId, kind: batch.kind, rowCount: rows.length, sha256: batch.sha256 }, { type: "examinations.import", id: batchId });
    events.audit({ action: "examinations.import.apply", resourceType: "import_batch", resourceId: batchId, sensitive: true, metadata: { sessionId: batch.sessionId, kind: batch.kind, rows: rows.length, sha256: batch.sha256 } });
    await events.flush(tx);
    return ok(toBatchDto(applied));
  });
}
