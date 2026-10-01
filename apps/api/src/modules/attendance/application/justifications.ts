/**
 * Justificatifs d'absence : dépôt (tuteur, élève, personnel habilité), pièces contrôlées par octets magiques, décision
 * tracée, application de l'excuse sur une FENÊTRE de dates, révocation motivée.
 *
 * Droits : la route porte la permission (`attendance.justification.*`, `attendance.child.justify`,
 * `attendance.self.justify`) ; le cas d'usage vérifie la RELATION (tuteur lié, élève lui-même, déposant) — jamais un
 * en-tête client. Le personnel enseignant ne voit ni motif ni pièce sans `attendance.justification.read`.
 */
import { createHash } from "node:crypto";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { AttendanceCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { AttendanceEvents } from "../domain/events";
import { assertJustificationTransition, validateWindow } from "../domain/justification";
import { detectMimeType, extensionFor, sanitizeFileName } from "../domain/magic-bytes";
import { checkEditable } from "../domain/session";
import { isExcusable } from "../domain/status";
import type { IsoDate, Justification, JustificationStatus, StudentRecord, SubmitterKind, Uuid } from "../domain/types";
import { getReason, getSettings } from "../infrastructure/reference-repository";
import {
  applyExcuse,
  countCoveredRecords,
  decideJustification,
  findPendingDuplicate,
  getAttachment,
  getJustification as repoGetJustification,
  insertAttachment,
  insertJustification,
  listAttachments,
  listJustifications as repoListJustifications,
  listOtherAcceptedOverlapping,
  markAttachmentRemoved,
  markJustificationRevoked,
  revokeExcuse,
  type CoveredRecord,
} from "../infrastructure/justifications-repository";
import { getRecordsByEnrollments, getSession, setExcuseApplyAllowed } from "../infrastructure/sessions-repository";
import type { Attachment } from "../infrastructure/rows";
import { EventBuffer, actorOf, inTx, todayOf, type AttendanceDeps, type CallerCaps } from "./deps";
import { applyMarks, assertCanTakeCall, humanSourceOf, loadSessionContext } from "./session-support";
import { recomputeAffected } from "./summaries";

export interface JustificationView {
  readonly justification: Justification;
  readonly attachments: readonly Attachment[];
  readonly coveredRecordCount: number;
}

// ---------------------------------------------------------------------------
// Accès
// ---------------------------------------------------------------------------

/** Lecture autorisée : rôle habilité, déposant, tuteur lié ou élève concerné. */
async function canRead(deps: AttendanceDeps, ctx: RequestContext, caps: CallerCaps, j: Justification): Promise<boolean> {
  if (caps.justificationRead || caps.justificationDecide) return true;
  const user = ctx.userId;
  if (!user) return false;
  if (j.submittedByUser === user) return true;
  if (await deps.ports.people.isGuardianOfStudent(ctx, user, j.studentId).catch(() => false)) return true;
  return (await deps.ports.people.getStudentIdForUser(ctx, user).catch(() => null)) === j.studentId;
}

async function view(tx: Tx, j: Justification): Promise<JustificationView> {
  const [attachments, covered] = await Promise.all([listAttachments(tx, [j.id]), countCoveredRecords(tx, [j.id])]);
  return { justification: j, attachments: attachments.get(j.id) ?? [], coveredRecordCount: covered.get(j.id) ?? 0 };
}

// ---------------------------------------------------------------------------
// Dépôt
// ---------------------------------------------------------------------------

export interface SubmitJustificationInput {
  readonly studentId: Uuid;
  readonly fromDate: IsoDate;
  readonly toDate: IsoDate;
  readonly reasonCode: string;
  readonly comment?: string | undefined;
  readonly caps?: CallerCaps;
}

/**
 * Qui dépose : le personnel habilité (`justification.submit`), le tuteur LIÉ (`child.justify` + `isGuardianOfStudent`)
 * ou l'élève lui-même (`self.justify`). La fenêtre ne dépasse ni l'année de l'inscription ni le jour courant (sauf
 * absence prévue déposée par le personnel quand la politique l'autorise). Un double envoi identique renvoie la demande
 * en attente existante (tolérant au rejeu depuis un téléphone).
 */
async function submitInTx(
  deps: AttendanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  input: SubmitJustificationInput & { enrollmentId?: Uuid | undefined },
): Promise<Result<Justification, AppError>> {
  const caps = input.caps ?? {};
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Un justificatif est déposé par un utilisateur identifié."));

  let kind: SubmitterKind;
  if (caps.justificationSubmit) kind = "STAFF";
  else if (caps.childJustify && (await deps.ports.people.isGuardianOfStudent(ctx, actor, input.studentId))) kind = "GUARDIAN";
  else if (caps.selfJustify && (await deps.ports.people.getStudentIdForUser(ctx, actor)) === input.studentId) kind = "STUDENT";
  else if (caps.childJustify) return err(forbidden(AttendanceCode.NOT_GUARDIAN, "Vous n'êtes pas le tuteur de cet élève."));
  else return err(forbidden(AttendanceCode.FORBIDDEN, "Vous ne pouvez pas déposer de justificatif pour cet élève."));

  const enrollments = await deps.ports.roster.findEnrollmentsOfStudent(ctx, input.studentId, { from: input.fromDate, to: input.toDate });
  const enrollment = input.enrollmentId ? enrollments.find((e) => e.enrollmentId === input.enrollmentId) : enrollments.find((e) => e.active) ?? enrollments[0];
  if (!enrollment) return err(notFound(AttendanceCode.ENROLLMENT_NOT_FOUND, "Inscription de l'élève sur cette période", input.studentId));

  const settings = await getSettings(tx);
  const window = validateWindow({
    fromDate: input.fromDate, toDate: input.toDate, today: todayOf(deps),
    yearStart: enrollment.academicYearStart, yearEnd: enrollment.academicYearEnd, allowFuture: settings.allowFutureJustifications, kind,
  });
  if (!window.ok) return window;

  const reason = await getReason(tx, input.reasonCode);
  if (!reason || !reason.active) return err(validation(AttendanceCode.REASON_UNKNOWN, `Motif de justification inconnu ou désactivé : ${input.reasonCode}.`, "reasonCode"));

  const duplicate = await findPendingDuplicate(tx, input.studentId, input.fromDate, input.toDate, input.reasonCode, actor);
  if (duplicate) return ok(duplicate);

  const created = await insertJustification(tx, {
    id: deps.newId(), tenantId: ctx.tenantId, studentId: input.studentId, enrollmentId: enrollment.enrollmentId, fromDate: input.fromDate, toDate: input.toDate,
    reasonCode: input.reasonCode, comment: input.comment?.trim() || null, submittedByKind: kind, submittedByUser: actor, submittedAt: deps.clock.now(),
  });
  events.add(
    AttendanceEvents.JUSTIFICATION_SUBMITTED,
    { v: 1, justificationId: created.id, studentId: created.studentId, fromDate: created.fromDate, toDate: created.toDate, submittedByKind: kind },
    { type: "justification", id: created.id },
  );
  events.audit({ action: "attendance.justification.submitted", resourceType: "justification", resourceId: created.id, metadata: { studentId: created.studentId, kind } });
  return ok(created);
}

export async function submitJustification(deps: AttendanceDeps, ctx: RequestContext, input: SubmitJustificationInput): Promise<Result<JustificationView, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const created = await submitInTx(deps, ctx, tx, events, input);
    if (!created.ok) return created;
    await events.flush(tx);
    return ok(await view(tx, created.value));
  });
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function getJustification(deps: AttendanceDeps, ctx: RequestContext, input: { justificationId: Uuid; caps?: CallerCaps }): Promise<Result<JustificationView, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const j = await repoGetJustification(tx, input.justificationId);
      if (!j) return err(notFound(AttendanceCode.JUSTIFICATION_NOT_FOUND, "Justificatif", input.justificationId));
      // 404 plutôt que 403 : on ne révèle pas l'existence d'un justificatif à qui n'y a pas droit.
      if (!(await canRead(deps, ctx, input.caps ?? {}, j))) return err(notFound(AttendanceCode.JUSTIFICATION_NOT_FOUND, "Justificatif", input.justificationId));
      return ok(await view(tx, j));
    },
    { readOnly: true },
  );
}

export interface ListJustificationsInput {
  readonly studentId?: Uuid | undefined;
  readonly studentIds?: readonly Uuid[] | undefined;
  readonly status?: JustificationStatus | undefined;
  readonly from?: IsoDate | undefined;
  readonly to?: IsoDate | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly caps?: CallerCaps;
}

/** Sans `justification.read`, la liste se limite aux demandes déposées par l'appelant. */
export async function listJustifications(deps: AttendanceDeps, ctx: RequestContext, input: ListJustificationsInput): Promise<Result<{ items: JustificationView[]; nextCursor: string | null }, AppError>> {
  const caps = input.caps ?? {};
  const broad = caps.justificationRead === true || caps.justificationDecide === true;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const page = await repoListJustifications(tx, { ...input, ...(broad ? {} : { submittedByUser: ctx.userId ?? undefined }) });
      const ids = page.items.map((j) => j.id);
      const [attachments, covered] = await Promise.all([listAttachments(tx, ids), countCoveredRecords(tx, ids)]);
      return ok({
        items: page.items.map((j) => ({ justification: j, attachments: attachments.get(j.id) ?? [], coveredRecordCount: covered.get(j.id) ?? 0 })),
        nextCursor: page.nextCursor,
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Pièces jointes
// ---------------------------------------------------------------------------

export interface AttachDocumentInput {
  readonly justificationId: Uuid;
  readonly fileName: string;
  readonly content: Uint8Array;
  readonly caps?: CallerCaps;
}

/**
 * Dépose une pièce : type RÉEL contrôlé par octets magiques (jamais le type déclaré), taille et types selon les
 * paramètres d'établissement, empreinte SHA-256 conservée, stockage objet (jamais le disque local).
 */
export async function attachJustificationDocument(deps: AttendanceDeps, ctx: RequestContext, input: AttachDocumentInput): Promise<Result<Attachment, AppError>> {
  const caps = input.caps ?? {};
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Une pièce est déposée par un utilisateur identifié."));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const j = await repoGetJustification(tx, input.justificationId, true);
    if (!j) return err(notFound(AttendanceCode.JUSTIFICATION_NOT_FOUND, "Justificatif", input.justificationId));
    const allowed = caps.justificationSubmit === true || caps.justificationDecide === true || j.submittedByUser === actor;
    if (!allowed) return err(notFound(AttendanceCode.JUSTIFICATION_NOT_FOUND, "Justificatif", input.justificationId));
    if (j.status !== "PENDING") {
      return err(conflict(AttendanceCode.JUSTIFICATION_NOT_PENDING, "Une pièce ne peut être ajoutée qu'à une demande en attente.", { status: j.status }));
    }

    const settings = await getSettings(tx);
    if (settings.attachmentMaxBytes === null || settings.allowedAttachmentTypes === null || settings.allowedAttachmentTypes.length === 0) {
      return err(conflict(AttendanceCode.ATTACHMENTS_DISABLED, "Le dépôt de pièces n'est pas activé pour cet établissement."));
    }
    if (input.content.byteLength === 0) return err(validation(AttendanceCode.INVALID_INPUT, "Le fichier est vide.", "contentBase64"));
    if (input.content.byteLength > settings.attachmentMaxBytes) {
      return err(
        validation(AttendanceCode.ATTACHMENT_TOO_LARGE, `Le fichier dépasse la taille maximale autorisée (${settings.attachmentMaxBytes} octets).`, "contentBase64", {
          maxBytes: settings.attachmentMaxBytes,
        }),
      );
    }
    const mime = detectMimeType(input.content);
    if (!mime || !settings.allowedAttachmentTypes.includes(mime)) {
      return err(validation(AttendanceCode.ATTACHMENT_TYPE_REJECTED, "Type de fichier non accepté (contrôlé sur le contenu réel du fichier).", "contentBase64", { allowed: [...settings.allowedAttachmentTypes] }));
    }

    const id = deps.newId();
    const key = `attendance/${ctx.tenantId}/justifications/${j.id}/${id}.${extensionFor(mime)}`;
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    await deps.ports.storage.put(key, input.content, { contentType: mime });
    try {
      const attachment = await insertAttachment(tx, {
        id, tenantId: ctx.tenantId, justificationId: j.id, storageKey: key, fileName: sanitizeFileName(input.fileName), detectedMime: mime,
        sizeBytes: input.content.byteLength, sha256, uploadedBy: actor, uploadedAt: deps.clock.now(),
      });
      events.audit({ action: "attendance.justification_attachment.added", resourceType: "justification", resourceId: j.id, metadata: { attachmentId: id, detectedMime: mime, sizeBytes: input.content.byteLength } });
      await events.flush(tx);
      return ok(attachment);
    } catch (e) {
      await deps.ports.storage.delete(key).catch(() => undefined);
      throw e;
    }
  });
}

export interface AttachmentRef {
  readonly justificationId: Uuid;
  readonly attachmentId: Uuid;
  readonly caps?: CallerCaps;
}

/** URL signée COURTE vers une pièce. Lecture réservée (rôle habilité, déposant, tuteur lié, élève) et AUDITÉE. */
export async function getJustificationAttachmentUrl(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: AttachmentRef,
): Promise<Result<{ url: string; expiresAt: Date; fileName: string; detectedMime: string }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const j = await repoGetJustification(tx, input.justificationId);
    if (!j || !(await canRead(deps, ctx, input.caps ?? {}, j))) return err(notFound(AttendanceCode.ATTACHMENT_NOT_FOUND, "Pièce jointe", input.attachmentId));
    const attachment = await getAttachment(tx, j.id, input.attachmentId);
    if (!attachment) return err(notFound(AttendanceCode.ATTACHMENT_NOT_FOUND, "Pièce jointe", input.attachmentId));
    const signed = await deps.ports.storage.signedUrl(attachment.storageKey, deps.config.signedUrlTtlSeconds);
    events.audit({
      action: "attendance.justification_attachment.read",
      resourceType: "justification",
      resourceId: j.id,
      sensitive: true,
      metadata: { attachmentId: attachment.id, ttlSeconds: deps.config.signedUrlTtlSeconds },
    });
    await events.flush(tx);
    return ok({ url: signed.url, expiresAt: signed.expiresAt, fileName: attachment.fileName, detectedMime: attachment.detectedMime });
  });
}

/** Retire une pièce (déposant ou décideur) tant que la demande est en attente. L'objet est supprimé du stockage. */
export async function removeJustificationAttachment(deps: AttendanceDeps, ctx: RequestContext, input: AttachmentRef): Promise<Result<true, AppError>> {
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const j = await repoGetJustification(tx, input.justificationId, true);
    const caps = input.caps ?? {};
    if (!j || !(caps.justificationDecide || caps.justificationSubmit || j.submittedByUser === actor)) {
      return err(notFound(AttendanceCode.ATTACHMENT_NOT_FOUND, "Pièce jointe", input.attachmentId));
    }
    if (j.status !== "PENDING") return err(conflict(AttendanceCode.JUSTIFICATION_NOT_PENDING, "Une pièce ne peut être retirée que d'une demande en attente.", { status: j.status }));
    const attachment = await getAttachment(tx, j.id, input.attachmentId);
    if (!attachment) return err(notFound(AttendanceCode.ATTACHMENT_NOT_FOUND, "Pièce jointe", input.attachmentId));
    await markAttachmentRemoved(tx, attachment.id, deps.clock.now());
    events.audit({ action: "attendance.justification_attachment.removed", resourceType: "justification", resourceId: j.id, metadata: { attachmentId: attachment.id } });
    await events.flush(tx);
    await deps.ports.storage.delete(attachment.storageKey).catch((e: unknown) => deps.logger.warn({ err: e instanceof Error ? e.message : String(e), key: attachment.storageKey }, "attendance : suppression d'objet échouée"));
    return ok(true as const);
  });
}

// ---------------------------------------------------------------------------
// Décisions
// ---------------------------------------------------------------------------

async function recomputeCovered(deps: AttendanceDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, covered: readonly CoveredRecord[], cause: string): Promise<void> {
  const byYear = new Map<Uuid, { enrollments: Set<Uuid>; dates: Set<IsoDate> }>();
  for (const c of covered) {
    const entry = byYear.get(c.academicYearId) ?? { enrollments: new Set<Uuid>(), dates: new Set<IsoDate>() };
    entry.enrollments.add(c.enrollmentId);
    entry.dates.add(c.sessionDate);
    byYear.set(c.academicYearId, entry);
  }
  for (const [academicYearId, e] of byYear) {
    await recomputeAffected(deps, ctx, tx, events, { enrollmentIds: [...e.enrollments], academicYearId, dates: [...e.dates], cause });
  }
}

/** Décision d'acceptation dans une transaction existante : exigence de pièce, excuse sur la fenêtre, événements, audit. */
async function acceptInTx(
  deps: AttendanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  j: Justification,
  note: string | null,
): Promise<Result<{ justification: Justification; covered: CoveredRecord[] }, AppError>> {
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Une décision est prise par un utilisateur identifié."));
  const transition = assertJustificationTransition(j.status, "ACCEPTED");
  if (!transition.ok) return transition;

  const reason = await getReason(tx, j.reasonCode);
  if (reason?.requiresAttachment) {
    const attachments = (await listAttachments(tx, [j.id])).get(j.id) ?? [];
    if (attachments.length === 0) {
      return err(validation(AttendanceCode.ATTACHMENT_REQUIRED, "Ce motif exige une pièce justificative avant la décision.", "attachments", { reasonCode: j.reasonCode }));
    }
  }

  // L'appel peut être VALIDÉ : seule exception du verrou, strictement limitée à ABSENT <-> EXCUSED par la base.
  await setExcuseApplyAllowed(tx, true);
  const decided = await decideJustification(tx, j.id, { status: "ACCEPTED", decidedBy: actor, decidedAt: deps.clock.now(), decisionNote: note });
  const covered = await applyExcuse(tx, ctx.tenantId, j.id, j.studentId, j.fromDate, j.toDate);
  await setExcuseApplyAllowed(tx, false);

  events.add(
    AttendanceEvents.JUSTIFICATION_ACCEPTED,
    { v: 1, justificationId: j.id, studentId: j.studentId, fromDate: j.fromDate, toDate: j.toDate, coveredRecordCount: covered.length },
    { type: "justification", id: j.id },
  );
  events.audit({
    action: "attendance.justification.accepted",
    resourceType: "justification",
    resourceId: j.id,
    sensitive: true,
    reason: note,
    after: { studentId: j.studentId, fromDate: j.fromDate, toDate: j.toDate, coveredRecordCount: covered.length },
  });
  await recomputeCovered(deps, ctx, tx, events, covered, "JUSTIFICATION_ACCEPTED");
  return ok({ justification: decided, covered });
}

/**
 * `acceptJustification` (`attendance.justification.decide`) : applique l'excuse à tous les pointages ABSENT / LATE /
 * EARLY_LEAVE de l'élève dans la fenêtre (`ABSENT -> EXCUSED`, statut d'origine conservé ; retard et départ anticipé
 * gardent leur statut avec `excused = true`), conserve la liste des pointages couverts et recalcule les récapitulatifs.
 */
export async function acceptJustification(deps: AttendanceDeps, ctx: RequestContext, input: { justificationId: Uuid; note?: string | undefined; caps?: CallerCaps }): Promise<Result<JustificationView, AppError>> {
  if (!input.caps?.justificationDecide) return err(forbidden(AttendanceCode.FORBIDDEN, "Décider d'un justificatif exige la permission de décision."));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const j = await repoGetJustification(tx, input.justificationId, true);
    if (!j) return err(notFound(AttendanceCode.JUSTIFICATION_NOT_FOUND, "Justificatif", input.justificationId));
    const accepted = await acceptInTx(deps, ctx, tx, events, j, input.note?.trim() || null);
    if (!accepted.ok) return accepted;
    await events.flush(tx);
    return ok(await view(tx, accepted.value.justification));
  });
}

/** `rejectJustification` : note OBLIGATOIRE ; la décision est tracée (auteur, date, note) et ne s'efface pas. */
export async function rejectJustification(deps: AttendanceDeps, ctx: RequestContext, input: { justificationId: Uuid; note: string; caps?: CallerCaps }): Promise<Result<JustificationView, AppError>> {
  if (!input.caps?.justificationDecide) return err(forbidden(AttendanceCode.FORBIDDEN, "Décider d'un justificatif exige la permission de décision."));
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Une décision est prise par un utilisateur identifié."));
  const note = input.note.trim();
  if (note.length < 3) return err(validation(AttendanceCode.REASON_REQUIRED, "Une note de refus est obligatoire.", "note"));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const j = await repoGetJustification(tx, input.justificationId, true);
    if (!j) return err(notFound(AttendanceCode.JUSTIFICATION_NOT_FOUND, "Justificatif", input.justificationId));
    const transition = assertJustificationTransition(j.status, "REJECTED");
    if (!transition.ok) return transition;
    const decided = await decideJustification(tx, j.id, { status: "REJECTED", decidedBy: actor, decidedAt: deps.clock.now(), decisionNote: note });
    events.add(
      AttendanceEvents.JUSTIFICATION_REJECTED,
      { v: 1, justificationId: j.id, studentId: j.studentId, fromDate: j.fromDate, toDate: j.toDate },
      { type: "justification", id: j.id },
    );
    events.audit({ action: "attendance.justification.rejected", resourceType: "justification", resourceId: j.id, sensitive: true, reason: note });
    await events.flush(tx);
    return ok(await view(tx, decided));
  });
}

/** `withdrawJustification` : retrait par le DÉPOSANT, tant que la demande est en attente. */
export async function withdrawJustification(deps: AttendanceDeps, ctx: RequestContext, input: { justificationId: Uuid }): Promise<Result<JustificationView, AppError>> {
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const j = await repoGetJustification(tx, input.justificationId, true);
    if (!j || j.submittedByUser !== actor) return err(notFound(AttendanceCode.JUSTIFICATION_NOT_FOUND, "Justificatif", input.justificationId));
    const transition = assertJustificationTransition(j.status, "WITHDRAWN");
    if (!transition.ok) return transition;
    const withdrawn = await decideJustification(tx, j.id, { status: "WITHDRAWN", decidedBy: null, decidedAt: null, decisionNote: null });
    events.audit({ action: "attendance.justification.withdrawn", resourceType: "justification", resourceId: j.id });
    await events.flush(tx);
    return ok(await view(tx, withdrawn));
  });
}

/**
 * `revokeJustification` : révocation MOTIVÉE d'un justificatif accepté. Les pointages couverts retrouvent leur statut
 * d'origine ; si un autre justificatif accepté couvre toujours une date, il s'applique à nouveau. La décision
 * d'acceptation d'origine est conservée (la révocation est tracée à part).
 */
export async function revokeJustification(deps: AttendanceDeps, ctx: RequestContext, input: { justificationId: Uuid; reason: string; caps?: CallerCaps }): Promise<Result<JustificationView, AppError>> {
  if (!input.caps?.justificationDecide) return err(forbidden(AttendanceCode.FORBIDDEN, "Révoquer un justificatif exige la permission de décision."));
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Une décision est prise par un utilisateur identifié."));
  const reason = input.reason.trim();
  if (reason.length < 5) return err(validation(AttendanceCode.REASON_REQUIRED, "Un motif de révocation d'au moins 5 caractères est obligatoire.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const j = await repoGetJustification(tx, input.justificationId, true);
    if (!j) return err(notFound(AttendanceCode.JUSTIFICATION_NOT_FOUND, "Justificatif", input.justificationId));
    const transition = assertJustificationTransition(j.status, "REVOKED");
    if (!transition.ok) return transition;

    await setExcuseApplyAllowed(tx, true);
    const revoked = await markJustificationRevoked(tx, j.id, actor, deps.clock.now(), reason);
    const restored = await revokeExcuse(tx, j.id);
    // Un autre justificatif accepté peut couvrir les mêmes dates : il reprend la main.
    const reapplied: CoveredRecord[] = [];
    for (const other of await listOtherAcceptedOverlapping(tx, j.studentId, j.fromDate, j.toDate, j.id)) {
      reapplied.push(...(await applyExcuse(tx, ctx.tenantId, other.id, other.studentId, other.fromDate, other.toDate)));
    }
    await setExcuseApplyAllowed(tx, false);

    events.add(
      AttendanceEvents.JUSTIFICATION_REVOKED,
      { v: 1, justificationId: j.id, studentId: j.studentId, fromDate: j.fromDate, toDate: j.toDate, restoredRecordCount: restored.length },
      { type: "justification", id: j.id },
    );
    events.audit({
      action: "attendance.justification.revoked",
      resourceType: "justification",
      resourceId: j.id,
      sensitive: true,
      reason,
      before: { status: "ACCEPTED", decidedBy: j.decidedBy, decidedAt: j.decidedAt },
      after: { status: "REVOKED", restoredRecordCount: restored.length },
    });
    await recomputeCovered(deps, ctx, tx, events, [...restored, ...reapplied], "JUSTIFICATION_REVOKED");
    await events.flush(tx);
    return ok(await view(tx, revoked));
  });
}

// ---------------------------------------------------------------------------
// Pointage avec justification immédiate (guichet de la vie scolaire)
// ---------------------------------------------------------------------------

export interface MarkWithJustificationInput {
  readonly sessionId: Uuid;
  readonly studentId: Uuid;
  readonly reasonCode: string;
  readonly comment?: string | undefined;
  /** `ABSENT` par défaut ; `LATE` / `EARLY_LEAVE` gardent leur statut avec `excused = true`. */
  readonly statusCode?: string | undefined;
  readonly minutesLate?: number | undefined;
  readonly minutesMissed?: number | undefined;
  readonly caps?: CallerCaps;
}

/**
 * `markWithJustification` (`attendance.justification.decide`) : pointage + création + acceptation du justificatif sur le
 * jour de la séance, dans UNE transaction (tout ou rien). Les motifs qui exigent une pièce passent par le dépôt normal.
 */
export async function markWithJustification(deps: AttendanceDeps, ctx: RequestContext, input: MarkWithJustificationInput): Promise<Result<{ record: StudentRecord; justification: JustificationView }, AppError>> {
  const caps = input.caps ?? {};
  if (!caps.justificationDecide) return err(forbidden(AttendanceCode.FORBIDDEN, "Pointer avec justification exige la permission de décision."));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const session = await getSession(tx, input.sessionId, "SHARE");
    if (!session) return err(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", input.sessionId));
    const auth = await assertCanTakeCall(deps, ctx, caps, { classroomId: session.classroomId, takenByStaffId: session.takenByStaffId });
    if (!auth.ok) return auth;
    const context = await loadSessionContext(deps, ctx, tx, session);
    const editable = checkEditable(session, context.policy, { now: deps.clock.now(), canManage: caps.manage === true });
    if (!editable.ok) return editable;

    const statusCode = input.statusCode ?? "ABSENT";
    if (!isExcusable(context.defs.get(statusCode))) {
      return err(validation(AttendanceCode.INVALID_INPUT, `Le statut ${statusCode} ne peut pas être justifié (absence, retard ou départ anticipé).`, "statusCode"));
    }
    const reason = await getReason(tx, input.reasonCode);
    if (!reason || !reason.active) return err(validation(AttendanceCode.REASON_UNKNOWN, `Motif de justification inconnu ou désactivé : ${input.reasonCode}.`, "reasonCode"));
    if (reason.requiresAttachment) {
      return err(validation(AttendanceCode.ATTACHMENT_REQUIRED, "Ce motif exige une pièce : déposez un justificatif, joignez la pièce puis acceptez-le.", "reasonCode"));
    }

    const marked = await applyMarks(deps, ctx, tx, events, {
      session, context, source: humanSourceOf(caps),
      entries: [{ studentId: input.studentId, statusCode, minutesLate: input.minutesLate, minutesMissed: input.minutesMissed }],
    });
    if (!marked.ok) return marked;
    const rosterEntry = context.roster.find((r) => r.studentId === input.studentId);

    const created = await submitInTx(deps, ctx, tx, events, {
      studentId: input.studentId, fromDate: session.sessionDate, toDate: session.sessionDate, reasonCode: input.reasonCode, comment: input.comment, caps: { ...caps, justificationSubmit: true },
      enrollmentId: rosterEntry?.enrollmentId,
    });
    if (!created.ok) return created;
    const accepted = await acceptInTx(deps, ctx, tx, events, created.value, null);
    if (!accepted.ok) return accepted;
    await events.flush(tx);
    const record = (await getRecordsByEnrollments(tx, session.id, [rosterEntry?.enrollmentId as Uuid]))[0] as StudentRecord;
    return ok({ record, justification: await view(tx, accepted.value.justification) });
  });
}
