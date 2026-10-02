/**
 * Offres d'admission et SAGA d'inscription (spec §7).
 *
 * `acceptOffer` s'exécute dans UNE transaction `TenantDb` : les appels aux modules voisins (`people`, `academic`, `finance`) se font
 * par leurs API publiques, SÉQUENTIELLEMENT sur la même connexion (même contexte : savepoints de `TenantDb`). Si une étape échoue,
 * RIEN n'est créé (ni élève, ni inscription, ni facture) et l'offre reste en attente : l'appel est rejouable. Idempotent par offre
 * (clé d'idempotence = identifiant de l'offre, y compris côté facture).
 *
 * Aucun compte de portail n'est créé, aucun mot de passe n'existe : `provisionPortalAccount` est une action explicite d'un autre module.
 * `ENROLLED` n'est jamais posé ici : il est DÉRIVÉ de `academic.enrollment.confirmed` (voir `enrollment-events.ts`).
 */
import type { Tx } from "@ecoledigitale/database";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsAcceptOfferResultDto, AdmissionsIssueOfferBody, AdmissionsOfferDto } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { AdmissionsEvents } from "../domain/events";
import { NOTIFICATION_TEMPLATES } from "../domain/default-workflow";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import * as ref from "../infrastructure/reference-repository";
import { EventBuffer, inTx, type AdmissionsDeps, type TxScope } from "./deps";
import { detectDuplicates } from "./duplicates";
import { recordDecisionInTx, promoteOnFreedSeat } from "./decisions";
import { checkClassroom, issueOfferInTx, soleClassroom } from "./offer-core";
import { defaultRecipient, notifyGuardian } from "./notifications";
import { nowIso, requireUser } from "./support";
import { applicationRef, moveStage } from "./transitions";

// ---------------------------------------------------------------------------
// Émission, retrait
// ---------------------------------------------------------------------------

export interface IssueOfferOutput {
  readonly offer: AdmissionsOfferDto;
  readonly responseToken: string;
  readonly guardianId: string | null;
  readonly notified: "SENT" | "QUEUED" | "SKIPPED" | "FAILED";
}

export async function issueOffer(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, body: AdmissionsIssueOfferBody): Promise<Result<IssueOfferOutput, AppError>> {
  let handle: (() => IssueOfferOutput["notified"]) | null = null;
  const result = await inTx(deps, ctx, async (tx, scope) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    const events = new EventBuffer(deps, ctx);
    const issued = await issueOfferInTx(deps, ctx, tx, scope, events, app, { classroomId: body.classroomId, conditions: body.conditions ?? null, ...(body.validityDays !== undefined ? { validityDays: body.validityDays } : {}) });
    if (!issued.ok) return issued;
    await events.flush(tx);
    handle = issued.value.notified;
    return ok({ offer: issued.value.offer, responseToken: issued.value.responseToken, guardianId: issued.value.guardianId });
  });
  if (!result.ok) return result;
  return ok({ ...result.value, notified: (handle as unknown as (() => IssueOfferOutput["notified"]) | null)?.() ?? "SKIPPED" });
}

export async function withdrawOffer(deps: AdmissionsDeps, ctx: RequestContext, offerId: string, reason: string): Promise<Result<AdmissionsOfferDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const offer = await cases.getOffer(tx, offerId, { forUpdate: true });
    if (!offer) return err(notFound(AdmissionsCode.OFFER_NOT_FOUND, "Offre", offerId));
    if (offer.status !== "PENDING") return err(conflict(AdmissionsCode.OFFER_NOT_PENDING, "Seule une offre en attente peut être retirée."));
    const app = (await apps.getApplicationRow(tx, offer.applicationId, { forUpdate: true })) as apps.ApplicationRow;
    await cases.setOfferStatus(tx, offerId, "WITHDRAWN");
    const events = new EventBuffer(deps, ctx);
    events.add(AdmissionsEvents.OFFER_WITHDRAWN, { v: 1, ...applicationRef(app), offerId, classroomId: offer.classroomId }, { type: "offer", id: offerId });
    events.audit({ action: "admissions.offer.withdraw", resourceType: "offer", resourceId: offerId, reason, metadata: { applicationId: app.id } });
    await events.flush(tx);
    return ok((await cases.getOffer(tx, offerId)) as AdmissionsOfferDto);
  });
}

export async function setOfferClassroom(deps: AdmissionsDeps, ctx: RequestContext, offerId: string, classroomId: string): Promise<Result<AdmissionsOfferDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const offer = await cases.getOffer(tx, offerId, { forUpdate: true });
    if (!offer) return err(notFound(AdmissionsCode.OFFER_NOT_FOUND, "Offre", offerId));
    if (offer.status !== "PENDING") return err(conflict(AdmissionsCode.OFFER_NOT_PENDING, "La classe d'une offre ne se change que tant qu'elle est en attente."));
    const app = (await apps.getApplicationRow(tx, offer.applicationId)) as apps.ApplicationRow;
    const room = await checkClassroom(deps, ctx, app, classroomId);
    if (!room.ok) return room;
    await cases.setOfferClassroom(tx, offerId, classroomId);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "admissions.offer.set_classroom", resourceType: "offer", resourceId: offerId, metadata: { applicationId: app.id, classroomId } });
    await events.flush(tx);
    return ok((await cases.getOffer(tx, offerId)) as AdmissionsOfferDto);
  });
}

// ---------------------------------------------------------------------------
// Clôtures liées à une offre (refus de la famille, expiration, délai de paiement)
// ---------------------------------------------------------------------------

export type Closure = "WITHDRAWN_BY_FAMILY" | "OFFER_EXPIRED";

/** Transition de clôture à décision (statut REJECTED) depuis l'étape courante ; préfère le motif de clôture demandé. */
export async function findClosure(tx: Tx, app: apps.ApplicationRow, preferred: readonly Closure[]): Promise<apps.TransitionOut | null> {
  const out = (await apps.listTransitionsFrom(tx, app.workflowId, app.stageId)).filter((t) => t.toStatus === "REJECTED" && t.requiresDecision && t.toClosureKind !== "REJECTED_BY_SCHOOL");
  for (const kind of preferred) {
    const hit = out.find((t) => t.toClosureKind === kind);
    if (hit) return hit;
  }
  return out[0] ?? null;
}

const CLOSURE_REASON: Record<Closure, string> = { WITHDRAWN_BY_FAMILY: "WITHDRAWN_BY_FAMILY", OFFER_EXPIRED: "OFFER_EXPIRED" };

/** Clôt le dossier par une décision WITHDRAW SYSTÈME (la famille a refusé l'offre, l'offre ou le délai de paiement est échu). */
export async function closeApplication(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, scope: TxScope, events: EventBuffer, app: apps.ApplicationRow, closure: Closure, reasonCode?: string): Promise<boolean> {
  const target = await findClosure(tx, app, [closure, "WITHDRAWN_BY_FAMILY", "OFFER_EXPIRED"]);
  if (!target) return false;
  const out = await recordDecisionInTx(deps, ctx, tx, scope, events, app, { toStageId: target.toStageId, kind: "WITHDRAW", reasonCode: reasonCode ?? CLOSURE_REASON[closure], asSystem: true });
  if (!out.ok) throw out.error;
  return true;
}

/** La famille refuse l'offre (lien à usage unique) : offre `DECLINED`, dossier clos « retiré par la famille », place libérée. */
export async function declineOffer(deps: AdmissionsDeps, ctx: RequestContext, input: { offerId: string; guardianId?: string | undefined }): Promise<Result<{ status: "DECLINED" }, AppError>> {
  return inTx(deps, ctx, async (tx, scope) => {
    const offer = await cases.getOffer(tx, input.offerId, { forUpdate: true });
    if (!offer) return err(notFound(AdmissionsCode.OFFER_NOT_FOUND, "Offre", input.offerId));
    if (offer.status === "DECLINED") return ok({ status: "DECLINED" as const });
    if (offer.status !== "PENDING") return err(conflict(AdmissionsCode.OFFER_NOT_PENDING, "Cette offre n'est plus en attente."));
    if (Date.parse(offer.expiresAt) <= deps.clock.now().getTime()) return err(conflict(AdmissionsCode.OFFER_EXPIRED, "Cette offre est arrivée à échéance."));
    const app = (await apps.getApplicationRow(tx, offer.applicationId, { forUpdate: true })) as apps.ApplicationRow;
    const guardians = await apps.listGuardians(tx, app.id);
    const responder = (input.guardianId ? guardians.find((g) => g.id === input.guardianId) : guardians.find((g) => g.isPrimary && g.canConsent) ?? guardians.find((g) => g.canConsent)) ?? null;
    if (!responder || !responder.canConsent) return err(forbidden(AdmissionsCode.GUARDIAN_NOT_ENTITLED, "Ce tuteur n'est pas habilité à répondre à l'offre."));
    await cases.markOfferDeclined(tx, offer.id, { guardianId: responder.id, at: nowIso(deps) });
    const events = new EventBuffer(deps, ctx);
    events.add(AdmissionsEvents.OFFER_DECLINED, { v: 1, ...applicationRef(app), offerId: offer.id, classroomId: offer.classroomId }, { type: "offer", id: offer.id });
    events.audit({ action: "admissions.offer.decline", resourceType: "offer", resourceId: offer.id, metadata: { applicationId: app.id } });
    if (!(await closeApplication(deps, ctx, tx, scope, events, app, "WITHDRAWN_BY_FAMILY"))) {
      deps.logger.warn({ applicationId: app.id, stage: app.stageCode }, "admissions : aucune étape de clôture atteignable depuis cette étape, le dossier reste en place");
    }
    await events.flush(tx);
    return ok({ status: "DECLINED" as const });
  });
}

/** Offre échue (travail planifié) : `EXPIRED`, dossier clos « offre expirée », place libérée (promotion éventuelle). */
export async function expireOffer(deps: AdmissionsDeps, ctx: RequestContext, offerId: string): Promise<Result<{ expired: boolean }, AppError>> {
  return inTx<{ expired: boolean }>(deps, ctx, async (tx, scope) => {
    const offer = await cases.getOffer(tx, offerId, { forUpdate: true });
    if (!offer || offer.status !== "PENDING" || Date.parse(offer.expiresAt) > deps.clock.now().getTime()) return ok({ expired: false });
    const app = (await apps.getApplicationRow(tx, offer.applicationId, { forUpdate: true })) as apps.ApplicationRow;
    await cases.setOfferStatus(tx, offerId, "EXPIRED");
    const events = new EventBuffer(deps, ctx);
    events.add(AdmissionsEvents.OFFER_EXPIRED, { v: 1, ...applicationRef(app), offerId, classroomId: offer.classroomId }, { type: "offer", id: offerId });
    events.audit({ action: "admissions.offer.expire", resourceType: "offer", resourceId: offerId, metadata: { applicationId: app.id } });
    if (!app.anonymizedAt && app.stageCanonicalStatus === "ACCEPTED" && !app.stageCreatesEnrollment) {
      if (!(await closeApplication(deps, ctx, tx, scope, events, app, "OFFER_EXPIRED"))) {
        deps.logger.warn({ applicationId: app.id, stage: app.stageCode }, "admissions : aucune étape de clôture atteignable depuis cette étape, le dossier reste en place");
      }
    }
    await events.flush(tx);
    return ok({ expired: true });
  });
}

// ---------------------------------------------------------------------------
// SAGA : acceptation d'une offre
// ---------------------------------------------------------------------------

export interface AcceptOfferInput {
  readonly offerId: string;
  readonly via: "GUARDIAN_LINK" | "STAFF_DELEGATION";
  readonly guardianId?: string | undefined;
  readonly evidenceRef?: string | undefined;
  readonly classroomId?: string | undefined;
}

const MIN_EVIDENCE = 3;

export async function acceptOffer(deps: AdmissionsDeps, ctx: RequestContext, input: AcceptOfferInput): Promise<Result<AdmissionsAcceptOfferResultDto, AppError>> {
  if (input.via === "STAFF_DELEGATION") {
    const user = requireUser(ctx);
    if (!user.ok) return user;
    if (!input.evidenceRef || input.evidenceRef.trim().length < MIN_EVIDENCE) return err(validation(AdmissionsCode.INVALID_INPUT, "Une acceptation par délégation exige une pièce justificative.", "evidenceRef"));
  }
  return inTx<AdmissionsAcceptOfferResultDto>(deps, ctx, async (tx, scope) => {
    // 1. Verrouiller l'offre et le dossier ; vérifier l'état.
    const offer = await cases.getOffer(tx, input.offerId, { forUpdate: true });
    if (!offer) return err(notFound(AdmissionsCode.OFFER_NOT_FOUND, "Offre", input.offerId));
    const app = (await apps.getApplicationRow(tx, offer.applicationId, { forUpdate: true })) as apps.ApplicationRow;
    if (offer.status === "ACCEPTED") {
      if (app.studentId && app.enrollmentId) {
        return ok({ applicationId: app.id, offerId: offer.id, studentId: app.studentId, enrollmentId: app.enrollmentId, invoiceId: app.invoiceId, stageId: app.stageId, status: app.status as AdmissionsAcceptOfferResultDto["status"], replayed: true });
      }
      return err(conflict(AdmissionsCode.OFFER_NOT_PENDING, "Cette offre est déjà acceptée mais le dossier est incomplet : contactez le support."));
    }
    if (offer.status !== "PENDING") return err(conflict(AdmissionsCode.OFFER_NOT_PENDING, "Cette offre n'est plus en attente."));
    if (Date.parse(offer.expiresAt) <= deps.clock.now().getTime()) return err(conflict(AdmissionsCode.OFFER_EXPIRED, "Cette offre est arrivée à échéance."));
    if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé."));
    if (app.stageCanonicalStatus !== "ACCEPTED" || app.stageCreatesEnrollment) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Le dossier n'est pas à l'étape « admis »."));
    const settings = await ref.ensureSettingsRow(tx, ctx.tenantId, app.institutionId);
    if (settings.consentRequired && !(await apps.hasValidConsent(tx, app.id))) return err(conflict(AdmissionsCode.CONSENT_MISSING, "Le consentement parental est requis avant l'inscription."));
    const missing = await apps.missingRequiredDocuments(tx, app.id);
    if (missing.length > 0) return err(conflict(AdmissionsCode.DOCUMENTS_INCOMPLETE, `Pièces non acceptées : ${missing.join(", ")}.`, { missing }));

    const guardians = await apps.listGuardians(tx, app.id);
    const responder = (input.guardianId ? guardians.find((g) => g.id === input.guardianId) : guardians.find((g) => g.isPrimary && g.canConsent) ?? guardians.find((g) => g.canConsent)) ?? null;
    if (!responder) return err(notFound(AdmissionsCode.NOT_FOUND, "Tuteur", input.guardianId));
    if (!responder.canConsent) return err(forbidden(AdmissionsCode.GUARDIAN_NOT_ENTITLED, "Ce tuteur n'est pas habilité à répondre à l'offre."));

    const classroomId = offer.classroomId ?? input.classroomId ?? (await soleClassroom(deps, ctx, tx, app));
    if (!classroomId) return err(conflict(AdmissionsCode.CLASSROOM_REQUIRED, "La classe visée n'est pas encore précisée : l'établissement doit la désigner."));
    const room = await checkClassroom(deps, ctx, app, classroomId);
    if (!room.ok) return room;

    // 2. Doublons (autres candidatures, élèves existants, prospects).
    const detection = await detectDuplicates(deps, ctx, tx, app);
    if (settings.duplicatePolicy === "BLOCK" && detection.open > 0) {
      return err(conflict(AdmissionsCode.DUPLICATES_PENDING, "Un doublon possible doit être tranché avant l'inscription.", { open: detection.open }));
    }
    const confirmedStudent = (await cases.listDuplicates(tx, app.id)).find((d) => d.matchedKind === "STUDENT" && d.status === "CONFIRMED_DUPLICATE");

    // 3. Élève : réutilisé (candidat déjà élève de l'établissement) ou créé INACTIF avec ses tuteurs.
    let studentId = app.studentId;
    if (!studentId && confirmedStudent && (await deps.ports.students.studentExists(ctx, confirmedStudent.matchedId))) studentId = confirmedStudent.matchedId;
    if (!studentId) {
      if (!app.applicantGender) return err(validation(AdmissionsCode.APPLICANT_GENDER_REQUIRED, "Le sexe du candidat est obligatoire pour créer le dossier de l'élève.", "applicantGender"));
      const created = await deps.ports.students.createStudent(ctx, {
        externalRef: `admissions-offer-${offer.id}`,
        firstName: app.applicantFirstName,
        lastName: app.applicantLastName,
        birthDate: app.applicantBirthDate,
        birthPlace: app.applicantBirthPlace,
        gender: app.applicantGender,
        nationality: app.applicantNationality,
      });
      studentId = created.studentId;
      if (created.status !== "INACTIVE") await deps.ports.students.changeStudentStatus(ctx, studentId, "INACTIVE", "Inscription en attente de confirmation (admissions)");
      for (const g of guardians) {
        const made = await deps.ports.students.createGuardian(ctx, { firstName: g.firstName, lastName: g.lastName, phone: g.phone, email: g.email, profession: g.profession });
        await deps.ports.students.linkGuardian(ctx, { studentId, guardianId: made.guardianId, relationshipCode: g.relationshipCode, isPrimaryContact: g.isPrimary, isFinancialResponsible: g.isFinancialResponsible, hasLegalCustody: g.canConsent });
      }
    }

    // 4. Inscription PENDING (la capacité de CLASSE est vérifiée par academic), puis 5. facture des frais d'inscription.
    const enrollment = await deps.ports.enrollments.enrollStudent(ctx, {
      studentId,
      classroomId,
      fundingType: app.fundingTypeRequested,
      assignmentReference: app.assignmentReference,
      isRepeating: app.isRepeating,
      originSchool: app.previousSchool,
      applicationId: app.id,
    });
    const fee = await deps.ports.fees.issueRegistrationInvoice(ctx, { studentId, enrollmentId: enrollment.enrollmentId, idempotencyKey: `admissions-offer-${offer.id}` });

    // 6. Offre acceptée ; le dossier passe à l'étape qui CRÉE l'inscription.
    const target = (await apps.listTransitionsFrom(tx, app.workflowId, app.stageId)).find((t) => t.createsEnrollment);
    if (!target) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Le workflow n'offre aucune étape de création d'inscription depuis l'étape courante."));
    await cases.markOfferAccepted(tx, offer.id, { guardianId: responder.id, classroomId, at: nowIso(deps) });
    await apps.setEnrollmentRefs(tx, app.id, { studentId, enrollmentId: enrollment.enrollmentId, invoiceId: fee.invoiceId });
    const events = new EventBuffer(deps, ctx);
    const moved = await moveStage(deps, ctx, tx, scope, events, app, target.toStageId, { onSeatFreed: promoteOnFreedSeat });
    events.add(AdmissionsEvents.OFFER_ACCEPTED, { v: 1, ...applicationRef(app), offerId: offer.id, classroomId }, { type: "offer", id: offer.id });
    events.audit({
      action: "admissions.offer.accept",
      resourceType: "offer",
      resourceId: offer.id,
      metadata: { applicationId: app.id, via: input.via, studentId, enrollmentId: enrollment.enrollmentId, invoiceId: fee.invoiceId, classroomId, reusedStudent: studentId !== app.studentId && !!confirmedStudent, ...(input.via === "STAFF_DELEGATION" ? { evidenceRef: input.evidenceRef } : {}) },
    });
    const recipient = defaultRecipient(guardians);
    if (recipient) {
      await notifyGuardian(deps, ctx, tx, scope, { tenantId: ctx.tenantId, applicationId: app.id, recipient, templateCode: NOTIFICATION_TEMPLATES.OFFER_ACCEPTED, dedupeKey: `offer-accepted:${offer.id}`, data: { invoiceIssued: fee.invoiceId ? "true" : "false" } });
    }
    await events.flush(tx);
    return ok({ applicationId: app.id, offerId: offer.id, studentId, enrollmentId: enrollment.enrollmentId, invoiceId: fee.invoiceId, stageId: moved.after.stageId, status: moved.after.status as AdmissionsAcceptOfferResultDto["status"], replayed: false });
  });
}

/** Trace (audit) l'échec d'une acceptation annulée : alerte du secrétariat sans rien créer (la transaction de la saga est annulée). */
export async function recordAcceptFailure(deps: AdmissionsDeps, ctx: RequestContext, input: { offerId: string; code: string; via: string }): Promise<void> {
  try {
    await deps.db.run(ctx, async (tx) => {
      const offer = await cases.getOffer(tx, input.offerId);
      const buffer = new EventBuffer(deps, ctx);
      buffer.audit({ action: "admissions.offer.accept_failed", resourceType: "offer", resourceId: input.offerId, metadata: { applicationId: offer?.applicationId ?? null, code: input.code, via: input.via } });
      await buffer.flush(tx);
    });
  } catch (e) {
    deps.logger.warn({ offerId: input.offerId, err: e instanceof Error ? e.message : String(e) }, "admissions : échec d'acceptation non journalisé");
  }
}
