/**
 * Orientation et passage d'une série à l'autre (spec 006 US7).
 *
 *  - AUCUNE série, option ni langue dans le code : ce sont des programmes, nœuds et matières d'`academic` (identifiants). Les parcours
 *    autorisés (`orientation_paths`) sont une DONNÉE, VIDE par défaut : aucun parcours officiel n'est livré.
 *  - Un transfert de série n'existe que par une décision HUMAINE : décision du conseil dont la cible est exactement celle du transfert,
 *    ou acte de la direction (référence + signataire). Hors parcours autorisé : dérogation motivée (20 caractères) par l'utilisateur de la
 *    session, permission sensible `council.orientation.override`.
 *  - Si le parcours exige l'accord de la famille, le dossier ne passe pas `APPLIED` sans accord `GIVEN` (qui, quand) ; un refus bloque.
 *  - L'application passe par `academic` (issue de redirection pour l'année suivante, ou changement de classe en cours d'année) ; un
 *    échec marque le transfert `FAILED` et se reprend.
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  CouncilsOrientationFileDto,
  CouncilsOrientationPathDto,
  CouncilsOrientationPathInput,
  CouncilsSeriesTransferDto,
  CouncilsSeriesTransferInput,
  CouncilsWishInput,
} from "@ecoledigitale/contracts/src/v2/councils";
import { CouncilsCode, conflict, forbidden, invalid, notFound } from "../domain/errors";
import { CouncilsEvents } from "../domain/events";
import * as repo from "../infrastructure/councils-repository";
import * as orientation from "../infrastructure/orientation-repository";
import type { OrientationFileRow, OrientationPathRow, TransferRow } from "../infrastructure/rows";
import { EventBuffer, inTx, requireHuman, type CallerCaps, type CouncilsDeps } from "./deps";
import { clampPage } from "./support";
import { fileDto, pathDto, transferDto } from "./views";

const transferPayload = (t: TransferRow): { v: 1 } & Record<string, unknown> => ({ v: 1, transferId: t.id, enrollmentId: t.enrollmentId, studentId: t.studentId, toProgramId: t.toProgramId, toGradeLevelId: t.toGradeLevelId, effectiveKind: t.effectiveKind });

async function namesOf(deps: CouncilsDeps, ctx: RequestContext, studentIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  try {
    return await deps.ports.family.getStudentNames(ctx, [...new Set(studentIds)]);
  } catch (e) {
    if (isAppError(e)) return new Map();
    throw e;
  }
}

async function filesView(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, rows: readonly OrientationFileRow[]): Promise<CouncilsOrientationFileDto[]> {
  const wishes = await orientation.listWishes(tx, rows.map((r) => r.id));
  const names = await namesOf(deps, ctx, rows.map((r) => r.studentId));
  return rows.map((r) => fileDto(r, wishes, names.get(r.studentId) ?? null));
}

// ---------------------------------------------------------------------------------------------------------------------
// Parcours autorisés
// ---------------------------------------------------------------------------------------------------------------------

export async function listPathsView(deps: CouncilsDeps, ctx: RequestContext): Promise<Result<{ items: CouncilsOrientationPathDto[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok({ items: (await orientation.listPaths(tx)).map(pathDto) }), { readOnly: true });
}

export async function upsertPath(deps: CouncilsDeps, ctx: RequestContext, input: CouncilsOrientationPathInput): Promise<Result<CouncilsOrientationPathDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (input.fromProgramId === input.toProgramId && input.fromGradeLevelId === input.toGradeLevelId) return err(invalid(CouncilsCode.INVALID_INPUT, "Un parcours relie deux situations différentes.", "toProgramId"));
  return inTx(deps, ctx, async (tx) => {
    const row = await orientation.upsertPath(tx, ctx.tenantId, deps.newId(), { ...input } as Omit<OrientationPathRow, "id">);
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.orientation_path.upserted", resourceType: "orientation_path", resourceId: row.id, sensitive: true, after: { kind: row.kind, active: row.active, sourceKind: row.sourceKind } });
    await ev.flush(tx);
    return ok(pathDto(row));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Dossiers et vœux
// ---------------------------------------------------------------------------------------------------------------------

export async function listFilesView(deps: CouncilsDeps, ctx: RequestContext, q: { academicYearId?: string | undefined; status?: string | undefined; studentId?: string | undefined; page: number; pageSize: number }): Promise<Result<{ items: CouncilsOrientationFileDto[]; total: number; page: number; pageSize: number }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const { rows, total } = await orientation.listFiles(tx, q, clampPage(q.page, q.pageSize));
      return ok({ items: await filesView(deps, ctx, tx, rows), total, page: q.page, pageSize: q.pageSize });
    },
    { readOnly: true },
  );
}

export async function createFile(deps: CouncilsDeps, ctx: RequestContext, input: { enrollmentId: string; notes?: string | undefined }): Promise<Result<CouncilsOrientationFileDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const enrollment = await deps.ports.academic.getEnrollment(ctx, input.enrollmentId);
    if (!enrollment) return err(notFound(CouncilsCode.ENROLLMENT_NOT_FOUND, "Inscription", input.enrollmentId));
    if (!enrollment.programId || !enrollment.gradeLevelId) return err(invalid(CouncilsCode.INVALID_REFERENCE, "L'inscription ne porte pas de programme ou de niveau.", "enrollmentId"));
    if (await orientation.getFileByEnrollment(tx, input.enrollmentId)) return err(conflict(CouncilsCode.DUPLICATE, "Cette inscription a déjà un dossier d'orientation."));
    const id = deps.newId();
    await orientation.insertFile(tx, { id, tenantId: ctx.tenantId, institutionId: enrollment.institutionId, academicYearId: enrollment.academicYearId, enrollmentId: enrollment.enrollmentId, studentId: enrollment.studentId, currentProgramId: enrollment.programId, currentGradeLevelId: enrollment.gradeLevelId, notes: input.notes ?? null, createdBy: human.value });
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.orientation_file.created", resourceType: "orientation_file", resourceId: id, after: { enrollmentId: enrollment.enrollmentId } });
    await ev.flush(tx);
    return ok((await filesView(deps, ctx, tx, [(await orientation.getFile(tx, id)) as OrientationFileRow]))[0] as CouncilsOrientationFileDto);
  });
}

/** Le tuteur LIÉ de l'élève (lien relu à chaque appel), ou le personnel habilité. Hors lien : introuvable (jamais 403). */
async function loadFileForActor(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, caps: CallerCaps, fileId: string): Promise<Result<{ file: OrientationFileRow; staff: boolean }, AppError>> {
  const file = await orientation.getFile(tx, fileId, { lock: true });
  if (!file) return err(notFound(CouncilsCode.NOT_FOUND, "Dossier d'orientation", fileId));
  if (caps.orientationManage) return ok({ file, staff: true });
  if (caps.childRead && ctx.userId && (await deps.ports.family.isGuardianOfStudent(ctx, ctx.userId, file.studentId))) return ok({ file, staff: false });
  return err(notFound(CouncilsCode.NOT_FOUND, "Dossier d'orientation", fileId));
}

export async function addWish(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, fileId: string, input: CouncilsWishInput): Promise<Result<CouncilsOrientationFileDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadFileForActor(deps, ctx, tx, caps, fileId);
    if (!loaded.ok) return loaded;
    const { file, staff } = loaded.value;
    if (file.status === "APPLIED" || file.status === "CLOSED" || file.status === "CANCELLED") return err(conflict(CouncilsCode.INVALID_STATE, `Le dossier est ${file.status} : les vœux ne changent plus.`));
    // Une famille exprime SES vœux : la source est imposée par le compte, pas par la requête.
    const source = staff ? input.source : "GUARDIAN";
    await orientation.withdrawWishAtRank(tx, fileId, input.rank, deps.clock.now());
    await orientation.insertWish(tx, { id: deps.newId(), tenantId: ctx.tenantId, fileId, rank: input.rank, toProgramId: input.toProgramId, toGradeLevelId: input.toGradeLevelId, optionIds: input.optionIds, source, expressedBy: human.value, comment: input.comment ?? null });
    if (file.status === "OPEN") await orientation.updateFile(tx, fileId, { status: "WISHES_COLLECTED" });
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.orientation_wish.expressed", resourceType: "orientation_file", resourceId: fileId, after: { rank: input.rank, source } });
    await ev.flush(tx);
    return ok((await filesView(deps, ctx, tx, [(await orientation.getFile(tx, fileId)) as OrientationFileRow]))[0] as CouncilsOrientationFileDto);
  });
}

export async function recordConsent(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, fileId: string, input: { state: "GIVEN" | "REFUSED" }): Promise<Result<CouncilsOrientationFileDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadFileForActor(deps, ctx, tx, caps, fileId);
    if (!loaded.ok) return loaded;
    if (loaded.value.file.status === "APPLIED") return err(conflict(CouncilsCode.INVALID_STATE, "Le dossier est déjà appliqué."));
    await orientation.updateFile(tx, fileId, { guardianConsent: input.state, consentRecordedBy: human.value, consentRecordedAt: deps.clock.now() });
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.orientation_consent.recorded", resourceType: "orientation_file", resourceId: fileId, sensitive: true, after: { state: input.state, byGuardian: !loaded.value.staff } });
    await ev.flush(tx);
    return ok((await filesView(deps, ctx, tx, [(await orientation.getFile(tx, fileId)) as OrientationFileRow]))[0] as CouncilsOrientationFileDto);
  });
}

/** Fait public (`index.ts`) : dossier d'orientation d'une inscription ; `null` s'il n'existe pas. */
export async function getOrientationFile(deps: CouncilsDeps, ctx: RequestContext, enrollmentId: string): Promise<Result<CouncilsOrientationFileDto | null, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const file = await orientation.getFileByEnrollment(tx, enrollmentId);
      return ok(file ? ((await filesView(deps, ctx, tx, [file]))[0] as CouncilsOrientationFileDto) : null);
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Transferts de série
// ---------------------------------------------------------------------------------------------------------------------

export async function listTransfersView(deps: CouncilsDeps, ctx: RequestContext, q: { enrollmentId?: string | undefined; status?: string | undefined } = {}): Promise<Result<{ items: CouncilsSeriesTransferDto[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok({ items: (await orientation.listTransfers(tx, q)).map(transferDto) }), { readOnly: true });
}

export async function createTransfer(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, input: CouncilsSeriesTransferInput): Promise<Result<CouncilsSeriesTransferDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const enrollment = await deps.ports.academic.getEnrollment(ctx, input.enrollmentId);
    if (!enrollment || !enrollment.active) return err(notFound(CouncilsCode.ENROLLMENT_NOT_FOUND, "Inscription active", input.enrollmentId));
    if (!enrollment.programId || !enrollment.gradeLevelId) return err(invalid(CouncilsCode.INVALID_REFERENCE, "L'inscription ne porte pas de programme ou de niveau.", "enrollmentId"));
    let pathId: string | null = null;
    let overrideReason: string | null = null;
    if (input.pathId) {
      const p = await orientation.getPath(tx, input.pathId);
      if (!p || !p.active) return err(notFound(CouncilsCode.INVALID_REFERENCE, "Parcours autorisé", input.pathId));
      pathId = p.id;
    } else {
      const match = await orientation.findMatchingPath(tx, { fromProgramId: enrollment.programId, fromGradeLevelId: enrollment.gradeLevelId, toProgramId: input.toProgramId, toGradeLevelId: input.toGradeLevelId, institutionId: enrollment.institutionId });
      if (match) {
        pathId = match.id;
      } else {
        // Hors parcours autorisé : dérogation motivée de l'utilisateur de la session (permission sensible dédiée).
        if (!caps.orientationOverride) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Ce transfert n'est pas un parcours autorisé : une dérogation motivée exige l'autorisation dédiée."));
        overrideReason = input.overrideReason?.trim() ?? null;
        if (!overrideReason || overrideReason.length < 20) return err(invalid(CouncilsCode.INVALID_INPUT, "Hors parcours autorisé, une dérogation motivée (20 caractères au moins) est exigée.", "overrideReason"));
      }
    }
    const id = deps.newId();
    await orientation.insertTransfer(tx, {
      id,
      tenantId: ctx.tenantId,
      institutionId: enrollment.institutionId,
      enrollmentId: enrollment.enrollmentId,
      studentId: enrollment.studentId,
      fromProgramId: enrollment.programId,
      fromGradeLevelId: enrollment.gradeLevelId,
      toProgramId: input.toProgramId,
      toGradeLevelId: input.toGradeLevelId,
      effectiveKind: input.effectiveKind,
      effectiveOn: input.effectiveOn ?? null,
      decidedVia: input.decidedVia,
      decisionId: input.decidedVia === "COUNCIL" ? (input.decisionId ?? null) : null,
      actReference: input.decidedVia === "DIRECTOR_ACT" ? (input.actReference ?? null) : null,
      actIssuedBy: input.decidedVia === "DIRECTOR_ACT" ? human.value : null,
      pathId,
      pathOverrideReason: overrideReason,
      pathOverrideBy: overrideReason ? human.value : null,
      createdBy: human.value,
    });
    // Si le parcours exige l'accord de la famille, le dossier attend cet accord (jamais appliqué sans).
    if (pathId) {
      const path = await orientation.getPath(tx, pathId);
      if (path?.requiresGuardianConsent) {
        let file = await orientation.getFileByEnrollment(tx, enrollment.enrollmentId);
        if (!file) {
          const fid = deps.newId();
          await orientation.insertFile(tx, { id: fid, tenantId: ctx.tenantId, institutionId: enrollment.institutionId, academicYearId: enrollment.academicYearId, enrollmentId: enrollment.enrollmentId, studentId: enrollment.studentId, currentProgramId: enrollment.programId, currentGradeLevelId: enrollment.gradeLevelId, notes: null, createdBy: human.value });
          file = await orientation.getFile(tx, fid);
        }
        if (file && file.guardianConsent === "NOT_REQUIRED") await orientation.updateFile(tx, file.id, { guardianConsent: "PENDING" });
      }
    }
    const row = (await orientation.getTransfer(tx, id)) as TransferRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.SERIES_TRANSFER_PLANNED, transferPayload(row), { type: "councils.series_transfer", id });
    ev.audit({ action: "councils.series_transfer.planned", resourceType: "series_transfer", resourceId: id, sensitive: overrideReason !== null, reason: overrideReason, after: { decidedVia: input.decidedVia, effectiveKind: input.effectiveKind, overridden: overrideReason !== null } });
    await ev.flush(tx);
    return ok(transferDto(row));
  });
}

export async function applyTransfer(deps: CouncilsDeps, ctx: RequestContext, id: string, input: { toClassroomId?: string | undefined }): Promise<Result<CouncilsSeriesTransferDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const t = await orientation.getTransfer(tx, id, { lock: true });
    if (!t) return err(notFound(CouncilsCode.NOT_FOUND, "Transfert de série", id));
    if (t.status !== "PLANNED" && t.status !== "FAILED") return err(conflict(CouncilsCode.INVALID_STATE, `Un transfert ${t.status} ne s'applique pas.`));
    if (t.effectiveKind === "MID_YEAR" && !input.toClassroomId) return err(invalid(CouncilsCode.TRANSFER_TARGET_REQUIRED, "Un changement en cours d'année désigne la classe de destination.", "toClassroomId"));
    // Accord de la famille : exigé par le parcours retenu ; refus ou attente = application bloquée.
    const path = t.pathId ? await orientation.getPath(tx, t.pathId) : null;
    const file = await orientation.getFileByEnrollment(tx, t.enrollmentId);
    if (path?.requiresGuardianConsent && file?.guardianConsent !== "GIVEN") return err(conflict("councils.consent_required", file?.guardianConsent === "REFUSED" ? "La famille a refusé : le transfert ne peut pas être appliqué." : "Le parcours exige l'accord de la famille, qui n'est pas encore donné."));
    if (t.status === "FAILED") await orientation.requeueTransfer(tx, id);
    const now = deps.clock.now();
    const ev = new EventBuffer(deps, ctx);
    try {
      await tx.transaction(async () => {
        if (t.effectiveKind === "MID_YEAR") await deps.ports.outcomes.transferEnrollment(ctx, { enrollmentId: t.enrollmentId, toClassroomId: input.toClassroomId as string, effectiveOn: t.effectiveOn ?? undefined, reason: `Transfert de série (${t.decidedVia === "COUNCIL" ? "décision du conseil" : "acte de la direction"})` });
        else await deps.ports.outcomes.recordRedirect(ctx, { enrollmentId: t.enrollmentId, targetProgramId: t.toProgramId, targetGradeLevelId: t.toGradeLevelId, decisionRef: `series_transfer:${t.id}` });
      });
    } catch (e) {
      const message = isAppError(e) ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      await orientation.markTransferFailed(tx, id, message);
      return ok(transferDto((await orientation.getTransfer(tx, id)) as TransferRow));
    }
    await orientation.markTransferApplied(tx, id, t.enrollmentId, now);
    if (file && (file.status === "DECIDED" || file.status === "PROPOSED" || file.status === "WISHES_COLLECTED" || file.status === "OPEN") && (file.status === "DECIDED" || file.decisionId)) await orientation.updateFile(tx, file.id, { status: "APPLIED" });
    // Un transfert appliqué à l'inscription ne se défait plus : l'effet qui l'a planifié devient irréversible.
    await tx.query("UPDATE councils.effects SET irreversible = true WHERE effect_kind = 'SERIES_TRANSFER' AND external_ref = $1 AND status = 'APPLIED'", [id]);
    const row = (await orientation.getTransfer(tx, id)) as TransferRow;
    ev.add(CouncilsEvents.SERIES_TRANSFER_APPLIED, transferPayload(row), { type: "councils.series_transfer", id });
    ev.audit({ action: "councils.series_transfer.applied", resourceType: "series_transfer", resourceId: id, sensitive: true, after: { enrollmentId: t.enrollmentId, effectiveKind: t.effectiveKind } });
    await ev.flush(tx);
    return ok(transferDto(row));
  });
}

export async function cancelTransfer(deps: CouncilsDeps, ctx: RequestContext, id: string, input: { reason: string }): Promise<Result<CouncilsSeriesTransferDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const reason = input.reason.trim();
  if (reason.length < 5) return err(invalid(CouncilsCode.INVALID_INPUT, "Le motif d'annulation doit faire 5 caractères au moins.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const t = await orientation.getTransfer(tx, id, { lock: true });
    if (!t) return err(notFound(CouncilsCode.NOT_FOUND, "Transfert de série", id));
    if (t.status !== "PLANNED" && t.status !== "FAILED") return err(conflict(CouncilsCode.INVALID_STATE, `Un transfert ${t.status} ne s'annule pas.`));
    await orientation.cancelTransfer(tx, id, reason);
    const row = (await orientation.getTransfer(tx, id)) as TransferRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.SERIES_TRANSFER_CANCELLED, transferPayload(row), { type: "councils.series_transfer", id });
    ev.audit({ action: "councils.series_transfer.cancelled", resourceType: "series_transfer", resourceId: id, sensitive: true, reason });
    await ev.flush(tx);
    return ok(transferDto(row));
  });
}

void repo;
