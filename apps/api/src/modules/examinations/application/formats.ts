/**
 * Cas d'usage des FORMATS d'export et d'import (données) : brouillon, validation par liste blanche, publication, retrait,
 * nouvelle version. Un format publié est figé (déclencheur) : une correction = une nouvelle version (copie en brouillon).
 * Un seul format publié par code : publier retire le précédent dans la même transaction.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  ExamCreateExportFormatBody,
  ExamCreateImportFormatBody,
  ExamExportFormatDto,
  ExamImportFormatDto,
} from "@ecoledigitale/contracts/src/v2/examinations";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { validateExportColumns, validateExportFormatShape, validateImportColumns, validateImportValueMap, type SpecIssue } from "../domain/export-spec";
import type { ExportColumn, ExportFormatRow, FormatStatus, ImportFormatRow } from "../domain/types";
import * as ref from "../infrastructure/reference-repo";
import { toExportFormatDto, toImportFormatDto } from "./dto";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";

const firstIssue = (issues: SpecIssue[]): string => {
  const i = issues[0] as SpecIssue;
  return i.index >= 0 ? `Colonne ${i.index + 1} : ${i.message}` : i.message;
};

// ------------------------------------------------------------------ export

export async function listExportFormats(deps: ExaminationsDeps, ctx: RequestContext, f: { status?: FormatStatus; kind?: string } = {}): Promise<Result<ExamExportFormatDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok((await ref.listExportFormats(tx, f)).map(toExportFormatDto)), { readOnly: true });
}

export async function getExportFormat(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<ExamExportFormatDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const f = await ref.getExportFormat(tx, id);
      return f ? ok(toExportFormatDto(f)) : err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'export", id));
    },
    { readOnly: true },
  );
}

export async function createExportFormat(deps: ExaminationsDeps, ctx: RequestContext, body: ExamCreateExportFormatBody): Promise<Result<ExamExportFormatDto, AppError>> {
  const shape = validateExportFormatShape({ kind: body.kind, fileFormat: body.fileFormat, delimiter: body.delimiter ?? (body.fileFormat === "CSV" ? undefined : null) });
  if (shape.length > 0) return err(validation(ExamCode.FORMAT_INVALID, firstIssue(shape), "format"));
  const issues = validateExportColumns(body.columns, body.kind, body.fileFormat);
  if (issues.length > 0) return err(validation(ExamCode.FORMAT_INVALID, firstIssue(issues), "columns", { issues }));
  if (body.sourceKind === "regulation" && !body.sourceReference) return err(validation(ExamCode.INVALID_INPUT, "Un format « réglementaire » cite son texte (référence obligatoire).", "sourceReference"));
  return inTx(deps, ctx, async (tx) => {
    const version = (await ref.maxExportFormatVersion(tx, body.code)) + 1;
    const f = await ref.insertExportFormat(tx, ctx.tenantId, {
      id: deps.newId(), code: body.code, version, label: body.label, examTypeId: body.examTypeId ?? null, kind: body.kind, fileFormat: body.fileFormat, encoding: body.encoding,
      delimiter: body.delimiter ?? null, columns: body.columns as ExportColumn[], sourceKind: body.sourceKind, sourceReference: body.sourceReference ?? null,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.export_format.create", resourceType: "export_format", resourceId: f.id, after: { code: f.code, version: f.version, kind: f.kind } });
    await events.flush(tx);
    return ok(toExportFormatDto(f));
  });
}

export async function updateExportFormat(deps: ExaminationsDeps, ctx: RequestContext, id: string, patch: Partial<Omit<ExamCreateExportFormatBody, "code">>): Promise<Result<ExamExportFormatDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await ref.getExportFormat(tx, id);
    if (!current) return err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'export", id));
    if (current.status !== "DRAFT") return err(conflict(ExamCode.FORMAT_PUBLISHED_IMMUTABLE, "Un format publié ne se modifie pas : créer une nouvelle version."));
    const merged = { kind: patch.kind ?? current.kind, fileFormat: patch.fileFormat ?? current.fileFormat, delimiter: "delimiter" in patch ? (patch.delimiter ?? null) : current.delimiter, columns: patch.columns ?? current.columns };
    const shape = validateExportFormatShape(merged);
    if (shape.length > 0) return err(validation(ExamCode.FORMAT_INVALID, firstIssue(shape), "format"));
    const issues = validateExportColumns(merged.columns, merged.kind, merged.fileFormat);
    if (issues.length > 0) return err(validation(ExamCode.FORMAT_INVALID, firstIssue(issues), "columns", { issues }));
    const f = await ref.updateExportFormatDraft(tx, id, { ...patch, columns: patch.columns as ExportColumn[] | undefined } as Parameters<typeof ref.updateExportFormatDraft>[2]);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.export_format.update", resourceType: "export_format", resourceId: id, after: { fields: Object.keys(patch) } });
    await events.flush(tx);
    return ok(toExportFormatDto(f as ExportFormatRow));
  });
}

export async function publishExportFormat(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<ExamExportFormatDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await ref.getExportFormat(tx, id);
    if (!current) return err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'export", id));
    if (current.status !== "DRAFT") return err(conflict(ExamCode.FORMAT_TRANSITION, "Seul un format en brouillon se publie."));
    const issues = validateExportColumns(current.columns, current.kind, current.fileFormat);
    if (issues.length > 0) return err(validation(ExamCode.FORMAT_INVALID, firstIssue(issues), "columns", { issues }));
    await ref.retirePublishedExportFormat(tx, current.code);
    const f = (await ref.setExportFormatStatus(tx, id, "PUBLISHED")) as ExportFormatRow;
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.export_format.publish", resourceType: "export_format", resourceId: id, sensitive: true, metadata: { code: f.code, version: f.version, sourceKind: f.sourceKind } });
    await events.flush(tx);
    return ok(toExportFormatDto(f));
  });
}

/** Nouvelle version (brouillon) d'un format publié : copie des colonnes, à modifier puis à publier. */
export async function newExportFormatVersion(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<ExamExportFormatDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await ref.getExportFormat(tx, id);
    if (!current) return err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'export", id));
    const version = (await ref.maxExportFormatVersion(tx, current.code)) + 1;
    const f = await ref.insertExportFormat(tx, ctx.tenantId, {
      id: deps.newId(), code: current.code, version, label: current.label, examTypeId: current.examTypeId, kind: current.kind, fileFormat: current.fileFormat, encoding: current.encoding,
      delimiter: current.delimiter, columns: current.columns, sourceKind: current.sourceKind, sourceReference: current.sourceReference,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.export_format.create", resourceType: "export_format", resourceId: f.id, after: { code: f.code, version: f.version, from: id } });
    await events.flush(tx);
    return ok(toExportFormatDto(f));
  });
}

// ------------------------------------------------------------------ import

export async function listImportFormats(deps: ExaminationsDeps, ctx: RequestContext, f: { status?: FormatStatus; kind?: string } = {}): Promise<Result<ExamImportFormatDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok((await ref.listImportFormats(tx, f)).map(toImportFormatDto)), { readOnly: true });
}

export async function getImportFormat(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<ExamImportFormatDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const f = await ref.getImportFormat(tx, id);
      return f ? ok(toImportFormatDto(f)) : err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'import", id));
    },
    { readOnly: true },
  );
}

export async function createImportFormat(deps: ExaminationsDeps, ctx: RequestContext, body: ExamCreateImportFormatBody): Promise<Result<ExamImportFormatDto, AppError>> {
  const issues = [...validateImportColumns(body.columns, body.kind), ...validateImportValueMap(body.valueMap)];
  if (issues.length > 0) return err(validation(ExamCode.FORMAT_INVALID, firstIssue(issues), "columns", { issues }));
  if (body.sourceKind === "regulation" && !body.sourceReference) return err(validation(ExamCode.INVALID_INPUT, "Un format « réglementaire » cite son texte (référence obligatoire).", "sourceReference"));
  return inTx(deps, ctx, async (tx) => {
    const version = (await ref.maxImportFormatVersion(tx, body.code)) + 1;
    const f = await ref.insertImportFormat(tx, ctx.tenantId, {
      id: deps.newId(), code: body.code, version, label: body.label, examTypeId: body.examTypeId ?? null, kind: body.kind, encoding: body.encoding, delimiter: body.delimiter, decimalSeparator: body.decimalSeparator,
      hasHeader: body.hasHeader, columns: body.columns, valueMap: body.valueMap as ImportFormatRow["valueMap"], sourceKind: body.sourceKind, sourceReference: body.sourceReference ?? null,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.import_format.create", resourceType: "import_format", resourceId: f.id, after: { code: f.code, version: f.version, kind: f.kind } });
    await events.flush(tx);
    return ok(toImportFormatDto(f));
  });
}

export async function updateImportFormat(deps: ExaminationsDeps, ctx: RequestContext, id: string, patch: Partial<Omit<ExamCreateImportFormatBody, "code">>): Promise<Result<ExamImportFormatDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await ref.getImportFormat(tx, id);
    if (!current) return err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'import", id));
    if (current.status !== "DRAFT") return err(conflict(ExamCode.FORMAT_PUBLISHED_IMMUTABLE, "Un format publié ne se modifie pas : créer une nouvelle version."));
    const kind = patch.kind ?? current.kind;
    const issues = [...validateImportColumns(patch.columns ?? current.columns, kind), ...validateImportValueMap(patch.valueMap ?? current.valueMap)];
    if (issues.length > 0) return err(validation(ExamCode.FORMAT_INVALID, firstIssue(issues), "columns", { issues }));
    const f = await ref.updateImportFormatDraft(tx, id, patch as Parameters<typeof ref.updateImportFormatDraft>[2]);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.import_format.update", resourceType: "import_format", resourceId: id, after: { fields: Object.keys(patch) } });
    await events.flush(tx);
    return ok(toImportFormatDto(f as ImportFormatRow));
  });
}

export async function publishImportFormat(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<ExamImportFormatDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await ref.getImportFormat(tx, id);
    if (!current) return err(notFound(ExamCode.FORMAT_NOT_FOUND, "Format d'import", id));
    if (current.status !== "DRAFT") return err(conflict(ExamCode.FORMAT_TRANSITION, "Seul un format en brouillon se publie."));
    await ref.retirePublishedImportFormat(tx, current.code);
    const f = (await ref.setImportFormatStatus(tx, id, "PUBLISHED")) as ImportFormatRow;
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.import_format.publish", resourceType: "import_format", resourceId: id, sensitive: true, metadata: { code: f.code, version: f.version, sourceKind: f.sourceKind } });
    await events.flush(tx);
    return ok(toImportFormatDto(f));
  });
}
