/**
 * DOCUMENTS d'examen : convocation, attestation de réussite, relevé de notes — SCELLÉS par `reportcards` (QR de vérification,
 * signature) : ce module ne génère aucun PDF et ne signe rien.
 *
 *  - Un seul document VIVANT par candidat et nature ; une réémission = version suivante APRÈS révocation motivée (≥ 10 caractères).
 *  - L'attestation exige un résultat ADMIS PUBLIÉ ; la convocation, une place attribuée ; aucun document pour un candidat non inscrit.
 *  - Un document officiel n'est JAMAIS produit pour une session blanche (résultat calculé, R-EXA-11).
 *  - Le contenu scellé est figé (chaînes, entiers, booléens, null) ; le filigrane « Règles de démonstration » est reporté tant que les
 *    données ou la règle sont fictives.
 *  - Si le fournisseur de scellement n'accepte pas la nature demandée, l'émission échoue FERMÉ (`examinations.port_unavailable`).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { ExamIssuedDocumentDto, ExamPage } from "@ecoledigitale/contracts/src/v2/examinations";
import { normalizeDecimal } from "../domain/decimal";
import { ExaminationsEvents } from "../domain/events";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { PACK_PLACEHOLDER_NOTICE } from "../domain/pack-template";
import type { CandidateRow, DocumentKind, IssuedDocumentRow, SessionRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as ref from "../infrastructure/reference-repo";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import * as out from "../infrastructure/outputs-repo";
import { toDocumentDto } from "./dto";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";
import type { ExamOfficialKind, OfficialDocumentRequest } from "./ports";

const OFFICIAL_KIND: Readonly<Record<DocumentKind, ExamOfficialKind>> = { CONVOCATION: "EXAM_CONVOCATION", ATTESTATION_REUSSITE: "EXAM_SUCCESS_CERTIFICATE", RELEVE_NOTES: "EXAM_TRANSCRIPT" };
const TITLE: Readonly<Record<DocumentKind, string>> = { CONVOCATION: "Convocation à l'examen", ATTESTATION_REUSSITE: "Attestation de réussite", RELEVE_NOTES: "Relevé de notes" };
const OUTCOME_LABEL: Readonly<Record<string, string>> = { ADMITTED: "Admis(e)", FAILED: "Non admis(e)", ABSENT: "Absent(e)", EXCLUDED: "Exclu(e)", DEFERRED: "Ajourné(e)" };

const frDate = (iso: string | null): string => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

async function buildRequest(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  tx: Tx,
  input: { documentId: string; kind: DocumentKind; candidate: CandidateRow; session: SessionRow; demoRules: boolean; institutionName: string | null },
): Promise<Result<OfficialDocumentRequest, AppError>> {
  const { candidate: c, session: s } = input;
  const type = await ref.getType(tx, s.examTypeId);
  const base: Record<string, unknown> = {
    documentKind: input.kind,
    examTypeLabel: type?.label ?? "",
    sessionLabel: s.label,
    sessionYear: s.sessionYear,
    institutionName: input.institutionName,
    candidateNumber: c.candidateNumber,
    lastName: c.lastName,
    firstName: c.firstName,
    birthDate: c.birthDate,
    birthPlace: c.birthPlace,
    sex: c.sex,
    watermark: input.demoRules ? PACK_PLACEHOLDER_NOTICE : null,
  };
  const context: Record<string, unknown> = {
    title: TITLE[input.kind],
    candidate: `${(c.lastName ?? "").toLocaleUpperCase("fr-FR")} ${c.firstName ?? ""}`.trim(),
    birth: `${frDate(c.birthDate)}${c.birthPlace ? ` à ${c.birthPlace}` : ""}`,
    number: c.candidateNumber ?? "",
    exam: `${type?.label ?? ""} — session ${s.sessionYear}`,
    watermark: input.demoRules ? PACK_PLACEHOLDER_NOTICE : "",
  };
  const content: Record<string, unknown> = { ...base };

  if (input.kind === "CONVOCATION") {
    const views = (await sess.listAssignmentViews(tx, s.id)).find((v) => v.candidateId === c.id);
    if (!views) return err(conflict(ExamCode.CONVOCATION_REQUIRES_ASSIGNMENT, "La convocation exige une place attribuée au candidat."));
    content.center = { code: views.centerCode, name: views.centerName };
    content.room = views.roomCode;
    content.seat = views.seatNumber;
    content.table = views.tableNumber;
    content.startsOn = s.startsOn;
    context.place = `${views.centerName} — salle ${views.roomCode}, place ${views.seatNumber}`;
    context.date = frDate(s.startsOn);
  } else {
    const result = await res.getResultOfCandidate(tx, c.id);
    if (!result || result.status !== "PUBLISHED") return err(conflict(ExamCode.ATTESTATION_REQUIRES_ADMISSION, "Ce document exige un résultat officiel publié."));
    if (input.kind === "ATTESTATION_REUSSITE" && result.resultCode !== "ADMITTED") return err(conflict(ExamCode.ATTESTATION_REQUIRES_ADMISSION, "L'attestation de réussite exige un résultat ADMIS publié."));
    content.outcome = result.resultCode;
    content.mention = result.mentionCode;
    context.outcome = OUTCOME_LABEL[result.resultCode] ?? result.resultCode;
    if (input.kind === "RELEVE_NOTES") {
      const papers = await sess.listSessionPapers(tx, s.id);
      const scores = new Map((await res.listScoresOfCandidate(tx, c.id)).map((x) => [x.paperId, x]));
      content.papers = papers
        .filter((p) => p.trackCode === null || p.trackCode === c.trackCode)
        .map((p) => {
          const sc = scores.get(p.id);
          return { code: p.code, label: p.label, coefficient: normalizeDecimal(p.coefficient), scaleMax: normalizeDecimal(p.scaleMax), status: sc?.status ?? "ABSENT", score: sc?.score != null ? normalizeDecimal(sc.score) : null };
        });
      content.average = result.average !== null ? normalizeDecimal(result.average) : null;
      content.rank = result.rank;
    }
  }
  return ok({ kind: OFFICIAL_KIND[input.kind], sourceId: input.documentId, title: `${TITLE[input.kind]} — ${(c.lastName ?? "").toLocaleUpperCase("fr-FR")} ${c.firstName ?? ""}`.trim(), issuedAt: deps.clock.now(), institutionId: s.institutionId, content, context });
}

async function issueInTx(deps: ExaminationsDeps, ctx: RequestContext, tx: Tx, actor: string, candidateId: string, kind: DocumentKind, institutionName: string | null): Promise<Result<IssuedDocumentRow, AppError>> {
  const c = await cand.getCandidate(tx, candidateId, { forUpdate: true });
  if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
  const s = (await sess.getSession(tx, c.sessionId)) as SessionRow;
  if (s.sessionKind === "MOCK") return err(conflict(ExamCode.MOCK_NO_OFFICIAL_DOCUMENT, "Un examen blanc ne produit aucun document officiel : ses résultats sont calculés, pas prononcés par l'autorité."));
  if (c.registrationStatus !== "REGISTERED") return err(conflict(ExamCode.CANDIDATE_NOT_REGISTERED, "Aucun document pour un candidat non inscrit."));
  const live = await out.getLiveDocument(tx, candidateId, kind);
  if (live) return err(conflict(ExamCode.DOCUMENT_ALREADY_LIVE, "Ce candidat a déjà un document vivant de cette nature : le révoquer (avec motif) avant d'en émettre un nouveau.", { documentId: live.id }));
  const type = await ref.getType(tx, s.examTypeId);
  let demoRules = type?.sourceKind === "placeholder" || s.sourceKind === "placeholder";
  if (!demoRules && s.ruleVersionRef) {
    const opened = await deps.ports.rules.open(ctx, s.ruleVersionRef).catch(() => null);
    demoRules = Boolean(opened && opened.ok && opened.value.pin.sourceKind === "placeholder");
  }
  const id = deps.newId();
  const request = await buildRequest(deps, ctx, tx, { documentId: id, kind, candidate: c, session: s, demoRules, institutionName });
  if (!request.ok) return request;
  const version = await out.nextDocumentVersion(tx, candidateId, kind);
  // Le DDL vérifie : candidat inscrit, résultat ADMIS publié (attestation), place attribuée (convocation).
  await out.insertIssuedDocument(tx, ctx.tenantId, { id, sessionId: s.id, candidateId, kind, version, requestedBy: actor });
  const sealed = await deps.ports.officialDocuments.request(ctx, request.value);
  if (!sealed.ok) return sealed;
  const issued = await out.markDocumentIssued(tx, id, sealed.value.documentId);
  if (!issued) return err(conflict(ExamCode.DOCUMENT_ISSUED, "Le document n'a pas pu être finalisé."));
  const events = new EventBuffer(deps, ctx);
  events.add(ExaminationsEvents.DOCUMENT_ISSUED, { v: 1, sessionId: s.id, candidateId, studentId: c.studentId, documentId: id, kind, version }, { type: "examinations.document", id });
  events.audit({ action: "examinations.document.issue", resourceType: "issued_document", resourceId: id, sensitive: true, metadata: { sessionId: s.id, candidateId, kind, version, officialDocumentId: sealed.value.documentId } });
  await events.flush(tx);
  return ok(issued);
}

export async function issueDocument(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string, kind: DocumentKind): Promise<Result<ExamIssuedDocumentDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  const probe = await inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId);
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    return ok(c);
  }, { readOnly: true });
  if (!probe.ok) return probe;
  const institutionName = await deps.ports.institutions.nameOf(ctx, probe.value.institutionId).catch(() => null);
  return inTx(deps, ctx, async (tx) => {
    const r = await issueInTx(deps, ctx, tx, actor, candidateId, kind, institutionName);
    if (!r.ok) return r;
    return ok(toDocumentDto(r.value, probe.value.candidateNumber));
  });
}

export interface IssueBatchReport {
  issued: number;
  skipped: Array<{ candidateId: string; reason: "ALREADY_LIVE" }>;
  failed: Array<{ candidateId: string; code: string; message: string }>;
}

/** Émission en lot : une transaction PAR candidat (un refus n'annule pas les autres) ; un document vivant est ignoré. */
export async function issueBatch(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, input: { kind: DocumentKind; candidateIds?: readonly string[] | undefined }): Promise<Result<IssueBatchReport, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  const loaded = await inTx(deps, ctx, async (tx) => {
    const s = await sess.getSession(tx, sessionId);
    if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    const registered = await cand.listRegistered(tx, sessionId);
    return ok({ s, ids: input.candidateIds ? registered.filter((c) => input.candidateIds?.includes(c.id)).map((c) => c.id) : registered.map((c) => c.id) });
  }, { readOnly: true });
  if (!loaded.ok) return loaded;
  const institutionName = await deps.ports.institutions.nameOf(ctx, loaded.value.s.institutionId).catch(() => null);
  const report: IssueBatchReport = { issued: 0, skipped: [], failed: [] };
  for (const id of loaded.value.ids) {
    const r = await inTx(deps, ctx, (tx) => issueInTx(deps, ctx, tx, actor, id, input.kind, institutionName));
    if (r.ok) report.issued += 1;
    else if (r.error.code === ExamCode.DOCUMENT_ALREADY_LIVE) report.skipped.push({ candidateId: id, reason: "ALREADY_LIVE" });
    else report.failed.push({ candidateId: id, code: r.error.code, message: r.error.message });
  }
  return ok(report);
}

export async function revokeIssuedDocument(deps: ExaminationsDeps, ctx: RequestContext, id: string, reason: string): Promise<Result<ExamIssuedDocumentDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const d = await out.getIssuedDocument(tx, id, { forUpdate: true });
    if (!d) return err(notFound(ExamCode.DOCUMENT_NOT_FOUND, "Document d'examen", id));
    if (d.status === "REVOKED") return err(conflict(ExamCode.DOCUMENT_REVOKED, "Ce document est déjà révoqué."));
    const revoked = (await out.revokeDocument(tx, id, reason.trim())) as IssuedDocumentRow;
    const events = new EventBuffer(deps, ctx);
    events.add(ExaminationsEvents.DOCUMENT_REVOKED, { v: 1, sessionId: d.sessionId, candidateId: d.candidateId, documentId: id, kind: d.kind, version: d.version }, { type: "examinations.document", id });
    events.audit({ action: "examinations.document.revoke", resourceType: "issued_document", resourceId: id, sensitive: true, reason: reason.trim(), metadata: { sessionId: d.sessionId, kind: d.kind, version: d.version } });
    await events.flush(tx);
    return ok(toDocumentDto(revoked));
  });
}

export async function listIssuedDocuments(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, filter: { kind?: string | undefined; status?: string | undefined; page: number; pageSize: number }): Promise<Result<ExamPage<ExamIssuedDocumentDto>, AppError>> {
  const pageSize = Math.min(filter.pageSize, deps.config.pageSizeMax);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await sess.getSession(tx, sessionId))) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
      const page = await out.listIssuedDocuments(tx, { sessionId, ...filter, pageSize });
      return ok({ items: page.items.map((d) => toDocumentDto(d, d.candidateNumber)), total: page.total, page: filter.page, pageSize });
    },
    { readOnly: true },
  );
}

export interface DocumentFile {
  fileName: string;
  bytes: Uint8Array;
  verificationCode: string | null;
}

/** Fichier PDF d'un document ÉMIS : lecture auditée ; `null` tant que le rendu n'est pas terminé. */
export async function readIssuedDocumentFile(deps: ExaminationsDeps, ctx: RequestContext, id: string, options: { allow?: (candidate: CandidateRow) => Promise<boolean> } = {}): Promise<Result<DocumentFile | null, AppError>> {
  const found = await inTx(deps, ctx, async (tx) => {
    const d = await out.getIssuedDocument(tx, id);
    if (!d) return err(notFound(ExamCode.DOCUMENT_NOT_FOUND, "Document d'examen", id));
    const c = await cand.getCandidate(tx, d.candidateId);
    if (!c) return err(notFound(ExamCode.DOCUMENT_NOT_FOUND, "Document d'examen", id));
    return ok({ d, c });
  }, { readOnly: true });
  if (!found.ok) return found;
  const { d, c } = found.value;
  // Accès famille : le lien de tutelle est relu à chaque requête ; hors périmètre, le document n'existe pas (404).
  if (options.allow && !(await options.allow(c))) return err(notFound(ExamCode.DOCUMENT_NOT_FOUND, "Document d'examen", id));
  if (d.status !== "ISSUED" || !d.officialDocumentId) return err(conflict(ExamCode.DOCUMENT_REVOKED, d.status === "REVOKED" ? "Ce document est révoqué." : "Ce document n'est pas encore émis."));
  const state = await deps.ports.officialDocuments.read(ctx, { documentId: d.officialDocumentId, kind: OFFICIAL_KIND[d.kind], sourceId: d.id });
  if (!state.ok) return state;
  const audited = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.document.read", resourceType: "issued_document", resourceId: id, sensitive: true, metadata: { sessionId: d.sessionId, kind: d.kind } });
    await events.flush(tx);
    return ok(true);
  });
  if (!audited.ok) return audited;
  if (!state.value || state.value.status !== "RENDERED" || !state.value.bytes) return ok(null);
  return ok({ fileName: state.value.fileName ?? `${d.kind.toLowerCase()}.pdf`, bytes: state.value.bytes, verificationCode: state.value.verificationCode });
}
