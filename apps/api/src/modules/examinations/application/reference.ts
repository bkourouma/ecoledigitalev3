/**
 * Cas d'usage des DONNÉES DE RÉFÉRENCE : types d'examens, séries, épreuves, pièces exigées, centres, salles, instanciation du
 * modèle de pack (CEPE fictif). Aucune épreuve, aucun coefficient, aucun format n'est dans le code : ce sont des lignes.
 *
 * Modifier le modèle d'un type n'a JAMAIS d'effet sur une session existante : sa définition est copiée puis figée.
 */
import { err, newId, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  ExamCreateTypeBody,
  ExamTypeDetailDto,
  ExamTypeDto,
  ExamTrackDto,
  ExamPaperDto,
  ExamRequirementDto,
  ExamCenterDto,
  ExamRoomDto,
} from "@ecoledigitale/contracts/src/v2/examinations";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { validateNumberPattern } from "../domain/number-pattern";
import { PACK_TEMPLATES, PACK_PLACEHOLDER_NOTICE } from "../domain/pack-template";
import { validateExportColumns, validateImportColumns, validateImportValueMap } from "../domain/export-spec";
import * as ref from "../infrastructure/reference-repo";
import { toCenterDto, toPaperDto, toRequirementDto, toRoomDto, toTrackDto, toTypeDto } from "./dto";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";

const actor = (ctx: RequestContext): string | null => ctx.userId;

// ------------------------------------------------------------------ types

export async function listExamTypes(deps: ExaminationsDeps, ctx: RequestContext, input: { status?: "ACTIVE" | "ARCHIVED" } = {}): Promise<Result<ExamTypeDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok((await ref.listTypes(tx, input)).map(toTypeDto)), { readOnly: true });
}

export async function getExamType(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<ExamTypeDetailDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const t = await ref.getType(tx, id);
      if (!t) return err(notFound(ExamCode.TYPE_NOT_FOUND, "Type d'examen", id));
      return ok({
        ...toTypeDto(t),
        tracks: (await ref.listTracks(tx, id)).map(toTrackDto),
        papers: (await ref.listPapers(tx, id)).map(toPaperDto),
        requirements: (await ref.listRequirements(tx, id)).map(toRequirementDto),
      });
    },
    { readOnly: true },
  );
}

export async function createExamType(deps: ExaminationsDeps, ctx: RequestContext, body: ExamCreateTypeBody): Promise<Result<ExamTypeDto, AppError>> {
  const pattern = body.candidateNumberPattern ?? "{TYPE}{YEAR}-{SEQ:5}";
  const bad = validateNumberPattern(pattern);
  if (bad) return err(validation(ExamCode.INVALID_INPUT, bad, "candidateNumberPattern"));
  if (body.sourceKind === "regulation" && !body.sourceReference) return err(validation(ExamCode.INVALID_INPUT, "Un type « réglementaire » cite son texte (référence obligatoire).", "sourceReference"));
  return inTx(deps, ctx, async (tx) => {
    const t = await ref.insertType(tx, ctx.tenantId, {
      id: deps.newId(), code: body.code, label: body.label, educationLevelCode: body.educationLevelCode, gradeLevelCode: body.gradeLevelCode ?? null,
      resultContractId: body.resultContractId ?? "exam-national@1", candidateNumberPattern: pattern, sourceKind: body.sourceKind, sourceReference: body.sourceReference ?? null,
      transmitsToAdmission: body.transmitsToAdmission ?? false,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.type.create", resourceType: "exam_type", resourceId: t.id, after: { code: t.code, sourceKind: t.sourceKind } });
    await events.flush(tx);
    return ok(toTypeDto(t));
  });
}

export async function updateExamType(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  id: string,
  patch: { label?: string; gradeLevelCode?: string | null; candidateNumberPattern?: string; sourceReference?: string | null; status?: "ACTIVE" | "ARCHIVED"; transmitsToAdmission?: boolean },
): Promise<Result<ExamTypeDto, AppError>> {
  if (patch.candidateNumberPattern !== undefined) {
    const bad = validateNumberPattern(patch.candidateNumberPattern);
    if (bad) return err(validation(ExamCode.INVALID_INPUT, bad, "candidateNumberPattern"));
  }
  return inTx(deps, ctx, async (tx) => {
    const t = await ref.updateType(tx, id, patch);
    if (!t) return err(notFound(ExamCode.TYPE_NOT_FOUND, "Type d'examen", id));
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "examinations.type.update",
      resourceType: "exam_type",
      resourceId: id,
      // Décider d'envoyer (ou non) la moyenne aux admissions est un acte tracé avec sa valeur (Q-E18) : ce n'est pas une donnée d'élève.
      sensitive: patch.transmitsToAdmission !== undefined,
      after: { fields: Object.keys(patch), ...(patch.transmitsToAdmission !== undefined ? { transmitsToAdmission: patch.transmitsToAdmission } : {}) },
    });
    await events.flush(tx);
    return ok(toTypeDto(t));
  });
}

// ------------------------------------------------------------------ séries, épreuves, pièces

export async function createTrack(deps: ExaminationsDeps, ctx: RequestContext, typeId: string, body: { code: string; label: string; sourceKind: "regulation" | "institution" | "platform" | "placeholder" }): Promise<Result<ExamTrackDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await ref.getType(tx, typeId))) return err(notFound(ExamCode.TYPE_NOT_FOUND, "Type d'examen", typeId));
    const t = await ref.insertTrack(tx, ctx.tenantId, { id: deps.newId(), examTypeId: typeId, code: body.code, label: body.label, sourceKind: body.sourceKind });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.track.create", resourceType: "exam_track", resourceId: t.id, after: { typeId, code: t.code } });
    await events.flush(tx);
    return ok(toTrackDto(t));
  });
}

export async function updateTrack(deps: ExaminationsDeps, ctx: RequestContext, typeId: string, id: string, patch: { label?: string; active?: boolean }): Promise<Result<ExamTrackDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const t = await ref.updateTrack(tx, typeId, id, patch);
    if (!t) return err(notFound(ExamCode.TRACK_NOT_FOUND, "Série", id));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.track.update", resourceType: "exam_track", resourceId: id, after: { fields: Object.keys(patch) } });
    await events.flush(tx);
    return ok(toTrackDto(t));
  });
}

export async function createPaper(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  typeId: string,
  body: { trackCode?: string | null | undefined; code: string; label: string; coefficient: string; scaleMax: string; isOptional: boolean; ordinal: number; sourceKind: "regulation" | "institution" | "platform" | "placeholder" },
): Promise<Result<ExamPaperDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await ref.getType(tx, typeId))) return err(notFound(ExamCode.TYPE_NOT_FOUND, "Type d'examen", typeId));
    if (body.trackCode) {
      const tracks = await ref.listTracks(tx, typeId);
      if (!tracks.some((t) => t.code === body.trackCode)) return err(validation(ExamCode.TRACK_UNKNOWN, `La série « ${body.trackCode} » n'existe pas pour ce type d'examen.`, "trackCode"));
    }
    const p = await ref.insertPaper(tx, ctx.tenantId, {
      id: deps.newId(), examTypeId: typeId, trackCode: body.trackCode ?? null, code: body.code, label: body.label, coefficient: body.coefficient, scaleMax: body.scaleMax,
      isOptional: body.isOptional, ordinal: body.ordinal, sourceKind: body.sourceKind,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.paper.create", resourceType: "exam_paper", resourceId: p.id, after: { typeId, code: p.code, sourceKind: p.sourceKind } });
    await events.flush(tx);
    return ok(toPaperDto(p));
  });
}

export async function updatePaper(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  typeId: string,
  id: string,
  patch: { label?: string; coefficient?: string; scaleMax?: string; isOptional?: boolean; ordinal?: number; active?: boolean },
): Promise<Result<ExamPaperDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const p = await ref.updatePaper(tx, typeId, id, patch);
    if (!p) return err(notFound(ExamCode.PAPER_NOT_FOUND, "Épreuve", id));
    const events = new EventBuffer(deps, ctx);
    // Aucun effet sur les sessions existantes : leur définition est figée (copie à la préparation).
    events.audit({ action: "examinations.paper.update", resourceType: "exam_paper", resourceId: id, after: { fields: Object.keys(patch) } });
    await events.flush(tx);
    return ok(toPaperDto(p));
  });
}

export async function createRequirement(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  typeId: string,
  body: { code: string; label: string; required: boolean; sortOrder: number; sourceKind: "regulation" | "institution" | "platform" | "placeholder" },
): Promise<Result<ExamRequirementDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await ref.getType(tx, typeId))) return err(notFound(ExamCode.TYPE_NOT_FOUND, "Type d'examen", typeId));
    const q = await ref.insertRequirement(tx, ctx.tenantId, { id: deps.newId(), examTypeId: typeId, code: body.code, label: body.label, required: body.required, sortOrder: body.sortOrder, sourceKind: body.sourceKind });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.requirement.create", resourceType: "document_requirement", resourceId: q.id, after: { typeId, code: q.code } });
    await events.flush(tx);
    return ok(toRequirementDto(q));
  });
}

export async function updateRequirement(deps: ExaminationsDeps, ctx: RequestContext, typeId: string, id: string, patch: { label?: string; required?: boolean; sortOrder?: number; active?: boolean }): Promise<Result<ExamRequirementDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const q = await ref.updateRequirement(tx, typeId, id, patch);
    if (!q) return err(notFound(ExamCode.REQUIREMENT_NOT_FOUND, "Pièce exigée", id));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.requirement.update", resourceType: "document_requirement", resourceId: id, after: { fields: Object.keys(patch) } });
    await events.flush(tx);
    return ok(toRequirementDto(q));
  });
}

// ------------------------------------------------------------------ centres et salles

export async function listCenters(deps: ExaminationsDeps, ctx: RequestContext): Promise<Result<ExamCenterDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const [centers, rooms] = [await ref.listCenters(tx), await ref.listRooms(tx)];
      return ok(centers.map((c) => toCenterDto(c, rooms.filter((r) => r.centerId === c.id))));
    },
    { readOnly: true },
  );
}

export async function createCenter(deps: ExaminationsDeps, ctx: RequestContext, body: { code: string; name: string; kind: "OWN" | "HOST"; authorityCode?: string | null | undefined; locality?: string | null | undefined }): Promise<Result<ExamCenterDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const c = await ref.insertCenter(tx, ctx.tenantId, { id: deps.newId(), code: body.code, name: body.name, kind: body.kind, authorityCode: body.authorityCode ?? null, locality: body.locality ?? null });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.center.create", resourceType: "center", resourceId: c.id, after: { code: c.code, kind: c.kind } });
    await events.flush(tx);
    return ok(toCenterDto(c, []));
  });
}

export async function updateCenter(deps: ExaminationsDeps, ctx: RequestContext, id: string, patch: { name?: string; authorityCode?: string | null; locality?: string | null; status?: "ACTIVE" | "INACTIVE" }): Promise<Result<ExamCenterDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const c = await ref.updateCenter(tx, id, patch);
    if (!c) return err(notFound(ExamCode.CENTER_NOT_FOUND, "Centre", id));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.center.update", resourceType: "center", resourceId: id, after: { fields: Object.keys(patch) } });
    await events.flush(tx);
    return ok(toCenterDto(c, await ref.listRooms(tx, id)));
  });
}

export async function createRoom(deps: ExaminationsDeps, ctx: RequestContext, centerId: string, body: { code: string; label?: string | null | undefined; capacity: number }): Promise<Result<ExamRoomDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await ref.getCenter(tx, centerId))) return err(notFound(ExamCode.CENTER_NOT_FOUND, "Centre", centerId));
    const r = await ref.insertRoom(tx, ctx.tenantId, { id: deps.newId(), centerId, code: body.code, label: body.label ?? null, capacity: body.capacity });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.room.create", resourceType: "room", resourceId: r.id, after: { centerId, code: r.code, capacity: r.capacity } });
    await events.flush(tx);
    return ok(toRoomDto(r));
  });
}

export async function updateRoom(deps: ExaminationsDeps, ctx: RequestContext, centerId: string, id: string, patch: { label?: string | null; capacity?: number; active?: boolean }): Promise<Result<ExamRoomDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await ref.getRoom(tx, id);
    if (!current || current.centerId !== centerId) return err(notFound(ExamCode.ROOM_NOT_FOUND, "Salle", id));
    const r = await ref.updateRoom(tx, id, patch);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.room.update", resourceType: "room", resourceId: id, after: { fields: Object.keys(patch) } });
    await events.flush(tx);
    return ok(toRoomDto(r as NonNullable<typeof r>));
  });
}

// ------------------------------------------------------------------ modèle de pack

export interface PackReport {
  pack: string;
  notice: string;
  createdTypes: string[];
  existingTypes: string[];
  createdExportFormats: string[];
  createdImportFormats: string[];
}

/**
 * Instancie le modèle d'un pack (types, séries, épreuves, pièces, formats fictifs) dans le tenant. IDEMPOTENT : un type, un
 * format déjà présent sous le même code n'est jamais recréé ni modifié (les données de l'établissement priment).
 */
export async function instantiatePack(deps: ExaminationsDeps, ctx: RequestContext, packKey: string): Promise<Result<PackReport, AppError>> {
  const template = PACK_TEMPLATES[packKey];
  if (!template) return err(validation(ExamCode.INVALID_INPUT, `Modèle de pack inconnu : ${packKey}.`, "pack"));
  return inTx(deps, ctx, async (tx) => {
    const report: PackReport = { pack: packKey, notice: PACK_PLACEHOLDER_NOTICE, createdTypes: [], existingTypes: [], createdExportFormats: [], createdImportFormats: [] };
    const typeIds = new Map<string, string>();
    for (const t of template.examTypes) {
      const existing = await ref.getTypeByCode(tx, t.code);
      if (existing) {
        typeIds.set(t.code, existing.id);
        report.existingTypes.push(t.code);
        continue;
      }
      const row = await ref.insertType(tx, ctx.tenantId, {
        id: newId(), code: t.code, label: t.label, educationLevelCode: t.educationLevelCode, gradeLevelCode: t.gradeLevelCode, resultContractId: t.resultContractId,
        candidateNumberPattern: t.candidateNumberPattern, sourceKind: t.sourceKind, sourceReference: null, transmitsToAdmission: t.transmitsToAdmission,
      });
      typeIds.set(t.code, row.id);
      report.createdTypes.push(t.code);
      for (const tr of t.tracks) await ref.insertTrack(tx, ctx.tenantId, { id: newId(), examTypeId: row.id, code: tr.code, label: tr.label, sourceKind: tr.sourceKind });
      for (const p of t.papers) await ref.insertPaper(tx, ctx.tenantId, { id: newId(), examTypeId: row.id, trackCode: p.trackCode, code: p.code, label: p.label, coefficient: p.coefficient, scaleMax: p.scaleMax, isOptional: p.isOptional, ordinal: p.ordinal, sourceKind: p.sourceKind });
      for (const q of t.requirements) await ref.insertRequirement(tx, ctx.tenantId, { id: newId(), examTypeId: row.id, code: q.code, label: q.label, required: q.required, sortOrder: q.sortOrder, sourceKind: q.sourceKind });
    }
    const existingExport = new Set((await ref.listExportFormats(tx)).map((f) => f.code));
    for (const f of template.exportFormats) {
      if (existingExport.has(f.code)) continue;
      const issues = validateExportColumns(f.columns, f.kind, f.fileFormat);
      if (issues.length > 0) return err(validation(ExamCode.FORMAT_INVALID, `Le format du modèle « ${f.code} » est invalide : ${issues[0]?.message}`, "exportFormats"));
      const row = await ref.insertExportFormat(tx, ctx.tenantId, {
        id: newId(), code: f.code, version: 1, label: f.label, examTypeId: typeIds.get(f.examTypeCode) ?? null, kind: f.kind, fileFormat: f.fileFormat, encoding: "UTF-8", delimiter: f.delimiter,
        columns: f.columns, sourceKind: f.sourceKind, sourceReference: null,
      });
      await ref.retirePublishedExportFormat(tx, f.code);
      await ref.setExportFormatStatus(tx, row.id, "PUBLISHED");
      report.createdExportFormats.push(f.code);
    }
    const existingImport = new Set((await ref.listImportFormats(tx)).map((f) => f.code));
    for (const f of template.importFormats) {
      if (existingImport.has(f.code)) continue;
      const issues = [...validateImportColumns(f.columns, f.kind), ...validateImportValueMap(f.valueMap)];
      if (issues.length > 0) return err(validation(ExamCode.FORMAT_INVALID, `Le format d'import du modèle « ${f.code} » est invalide : ${issues[0]?.message}`, "importFormats"));
      const row = await ref.insertImportFormat(tx, ctx.tenantId, {
        id: newId(), code: f.code, version: 1, label: f.label, examTypeId: typeIds.get(f.examTypeCode) ?? null, kind: f.kind, encoding: "UTF-8", delimiter: f.delimiter, decimalSeparator: f.decimalSeparator,
        hasHeader: true, columns: f.columns, valueMap: f.valueMap, sourceKind: f.sourceKind, sourceReference: null,
      });
      await ref.setImportFormatStatus(tx, row.id, "PUBLISHED");
      report.createdImportFormats.push(f.code);
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.pack.instantiate", resourceType: "pack", resourceId: ctx.tenantId, metadata: { pack: packKey, createdTypes: report.createdTypes, created: report.createdExportFormats.length + report.createdImportFormats.length } });
    await events.flush(tx);
    return ok(report);
  });
}

export { actor as actorOf, conflict };
