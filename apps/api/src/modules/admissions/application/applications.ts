/**
 * Candidatures : création (personnel, prospect, formulaire public), lecture (dossier, liste, tableau), mise à jour, changement
 * d'étape hors décision, consentements, historique. Les règles de passage sont imposées par les déclencheurs SQL ; ce fichier
 * orchestre, valide les entrées et publie les événements (sans donnée personnelle).
 */
import type { Tx } from "@ecoledigitale/database";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  AdmissionsAllowedTransitionDto,
  AdmissionsApplicationDetailDto,
  AdmissionsApplicationSummaryDto,
  AdmissionsBoardDto,
  AdmissionsGuardianInput,
  AdmissionsHistoryDto,
  AdmissionsListApplicationsQuery,
  AdmissionsUpdateApplicationBody,
  AdmissionStatus,
} from "@ecoledigitale/contracts/src/v2/admissions";
import { ADMISSION_LIMITS } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound, validation } from "../domain/errors";
import { identityKey, isPlausibleBirthDate } from "../domain/identity";
import { formatApplicationNumber } from "../domain/number";
import { decisionKindFor } from "../domain/workflow";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import * as ref from "../infrastructure/reference-repository";
import * as wf from "../infrastructure/workflow-repository";
import { EventBuffer, inTx, type AdmissionsDeps, type TxScope } from "./deps";
import { detectDuplicates } from "./duplicates";
import { moveStage, type MoveOptions, type SeatFreedHandler } from "./transitions";
import { nowIso, requireUser, todayIso, type Page } from "./support";

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export interface NewApplicationInput {
  readonly campaignId: string;
  readonly prospectId?: string | null | undefined;
  readonly applicantFirstName: string;
  readonly applicantLastName: string;
  readonly applicantBirthDate: string;
  readonly applicantBirthPlace?: string | null | undefined;
  readonly applicantGender?: "FEMALE" | "MALE" | null | undefined;
  readonly applicantNationality?: string | null | undefined;
  readonly previousSchool?: string | null | undefined;
  readonly previousGradeLevelCode?: string | null | undefined;
  readonly isRepeating?: boolean | undefined;
  readonly desiredGradeLevelCode: string;
  readonly desiredProgramId?: string | null | undefined;
  readonly fundingTypeRequested?: string | undefined;
  readonly assignmentReference?: string | null | undefined;
  readonly priorityClassCode?: string | null | undefined;
  readonly sourceChannel?: string | undefined;
  readonly referrerLabel?: string | null | undefined;
  readonly guardians: readonly AdmissionsGuardianInput[];
  readonly extra?: Record<string, unknown> | undefined;
}

export interface CreateOptions {
  readonly via: "PUBLIC_FORM" | "STAFF" | "IMPORT" | "PROSPECT";
  /** La campagne doit être OUVERTE et dans sa fenêtre (formulaire public) ; sinon un brouillon est admis (personnel). */
  readonly requireOpenCampaign: boolean;
  readonly trackingCodeHash?: string | null;
  readonly createdBy?: string | null;
}

export interface CreatedApplication {
  readonly id: string;
  readonly applicationNumber: string;
  readonly guardianIds: string[];
  readonly workflowId: string;
  readonly institutionId: string;
}

/** Écrit candidature et tuteurs dans la transaction de l'appelant ; ne change pas d'étape. */
export async function createApplicationInTx(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, input: NewApplicationInput, options: CreateOptions): Promise<Result<CreatedApplication, AppError>> {
  const campaign = await wf.getCampaignRow(tx, input.campaignId);
  if (!campaign) return err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", input.campaignId));
  if (options.requireOpenCampaign) {
    const t = deps.clock.now().getTime();
    if (campaign.status !== "OPEN" || t < Date.parse(campaign.opensAt) || t > Date.parse(campaign.closesAt)) {
      return err(conflict(AdmissionsCode.CAMPAIGN_CLOSED, "Les candidatures ne sont pas ouvertes pour cette campagne."));
    }
  }
  if (!isPlausibleBirthDate(input.applicantBirthDate, todayIso(deps))) {
    return err(validation(AdmissionsCode.INVALID_INPUT, "La date de naissance n'est pas plausible.", "applicantBirthDate"));
  }
  const stages = await wf.listStages(tx, campaign.workflowId);
  const initial = stages.find((s) => s.isInitial);
  if (!initial) return err(conflict(AdmissionsCode.WORKFLOW_CONFLICT, "Le workflow de la campagne n'a pas d'étape initiale."));
  if (input.priorityClassCode) {
    const classes = await ref.listPriorityClasses(tx, campaign.institutionId);
    if (!classes.some((c) => c.code === input.priorityClassCode && c.active)) return err(validation(AdmissionsCode.INVALID_INPUT, "Classe de priorité inconnue.", "priorityClassCode"));
  }
  if (input.fundingTypeRequested === "STATE_ASSIGNED" && deps.features && !(await deps.features.isEnabled(ctx, "academic.state-assigned"))) {
    return err(validation(AdmissionsCode.INVALID_INPUT, "Les élèves affectés par l'État ne sont pas pris en charge par cet établissement.", "fundingTypeRequested"));
  }
  const key = identityKey({ lastName: input.applicantLastName, firstName: input.applicantFirstName, birthDate: input.applicantBirthDate });
  if (await apps.findLiveApplicationByIdentity(tx, campaign.id, key)) {
    return err(conflict(AdmissionsCode.DUPLICATE_APPLICATION, "Une candidature vivante existe déjà pour cet enfant dans cette campagne."));
  }

  const settings = await ref.ensureSettingsRow(tx, ctx.tenantId, campaign.institutionId);
  const seq = await apps.nextApplicationSequence(tx, campaign.id);
  const applicationNumber = formatApplicationNumber(settings.applicationNumberPattern, { year: new Date(campaign.opensAt).getUTCFullYear(), seq });
  const id = deps.newId();
  await apps.insertApplication(tx, {
    id,
    tenantId: ctx.tenantId,
    institutionId: campaign.institutionId,
    campaignId: campaign.id,
    workflowId: campaign.workflowId,
    stageId: initial.id,
    applicationNumber,
    createdVia: options.via,
    prospectId: input.prospectId ?? null,
    applicantFirstName: input.applicantFirstName,
    applicantLastName: input.applicantLastName,
    applicantBirthDate: input.applicantBirthDate,
    applicantBirthPlace: input.applicantBirthPlace ?? null,
    applicantGender: input.applicantGender ?? null,
    applicantNationality: input.applicantNationality ?? null,
    previousSchool: input.previousSchool ?? null,
    previousGradeLevelCode: input.previousGradeLevelCode ?? null,
    isRepeating: input.isRepeating ?? false,
    desiredGradeLevelCode: input.desiredGradeLevelCode,
    desiredProgramId: input.desiredProgramId ?? null,
    fundingTypeRequested: input.fundingTypeRequested ?? "PRIVATE",
    assignmentReference: input.assignmentReference ?? null,
    priorityClassCode: input.priorityClassCode ?? null,
    sourceChannel: input.sourceChannel ?? "WALK_IN",
    referrerLabel: input.referrerLabel ?? null,
    trackingCodeHash: options.trackingCodeHash ?? null,
    extra: input.extra ?? {},
    createdBy: options.createdBy ?? ctx.userId,
  });
  const guardianIds: string[] = [];
  const hasPrimary = input.guardians.some((g) => g.isPrimary);
  for (const [i, g] of input.guardians.entries()) {
    const gid = deps.newId();
    guardianIds.push(gid);
    await apps.insertGuardian(tx, {
      id: gid,
      tenantId: ctx.tenantId,
      applicationId: id,
      relationshipCode: g.relationshipCode,
      firstName: g.firstName,
      lastName: g.lastName,
      phone: g.phone ?? null,
      email: g.email ?? null,
      profession: g.profession ?? null,
      isPrimary: hasPrimary ? g.isPrimary : i === 0,
      isFinancialResponsible: g.isFinancialResponsible,
      canConsent: g.canConsent,
    });
  }
  return ok({ id, applicationNumber, guardianIds, workflowId: campaign.workflowId, institutionId: campaign.institutionId });
}

/**
 * Passe du brouillon à l'étape « candidature reçue » (premier statut SUBMITTED atteignable depuis l'étape initiale). La permission
 * de la transition est contrôlée par l'appelant HTTP ; le formulaire public s'exécute au nom du système.
 */
export async function submitInTx(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, scope: TxScope, events: EventBuffer, applicationId: string, options: MoveOptions = {}): Promise<Result<apps.ApplicationRow, AppError>> {
  const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
  if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
  const out = await apps.listTransitionsFrom(tx, app.workflowId, app.stageId);
  const target = out.find((t) => t.toStatus === "SUBMITTED");
  if (!target) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Le workflow ne permet pas de soumettre ce dossier depuis son étape courante."));
  const moved = await moveStage(deps, ctx, tx, scope, events, app, target.toStageId, options);
  return ok(moved.after);
}

export async function createApplication(
  deps: AdmissionsDeps,
  ctx: RequestContext,
  input: NewApplicationInput,
): Promise<Result<{ id: string; applicationNumber: string; duplicates: number }, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  return inTx(deps, ctx, async (tx) => {
    const created = await createApplicationInTx(deps, ctx, tx, input, { via: input.prospectId ? "PROSPECT" : "STAFF", requireOpenCampaign: false });
    if (!created.ok) return created;
    const app = (await apps.getApplicationRow(tx, created.value.id)) as apps.ApplicationRow;
    const report = await detectDuplicates(deps, ctx, tx, app);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.application.create", resourceType: "application", resourceId: app.id, metadata: { campaignId: app.campaignId, via: app.createdVia, duplicates: report.open } });
    await buffer.flush(tx);
    return ok({ id: app.id, applicationNumber: app.applicationNumber, duplicates: report.open });
  });
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function allowedTransitions(tx: Tx, app: Pick<apps.ApplicationRow, "workflowId" | "stageId" | "anonymizedAt">): Promise<AdmissionsAllowedTransitionDto[]> {
  if (app.anonymizedAt) return [];
  const out = await apps.listTransitionsFrom(tx, app.workflowId, app.stageId);
  return out.map((t) => ({
    transitionId: t.transitionId,
    toStageId: t.toStageId,
    toStageCode: t.toStageCode,
    toStageLabel: t.toStageLabel,
    toStatus: t.toStatus as AdmissionStatus,
    permissionKey: t.permissionKey,
    requiresReason: t.requiresReason,
    requiresDecision: t.requiresDecision,
    createsEnrollment: t.createsEnrollment,
    isAutomatic: t.isAutomatic,
    decisionKind: t.requiresDecision ? decisionKindFor({ canonicalStatus: t.toStatus as AdmissionStatus, closureKind: t.toClosureKind as never }) : null,
  }));
}

export async function buildDetail(deps: AdmissionsDeps, tx: Tx, app: apps.ApplicationRow): Promise<AdmissionsApplicationDetailDto> {
  const summary = (await apps.getApplicationSummary(tx, app.id, nowIso(deps))) as AdmissionsApplicationSummaryDto;
  const seats = await wf.seatsLeft(tx, app.campaignId, app.desiredGradeLevelCode, app.desiredProgramId);
  return {
    ...summary,
    institutionId: app.institutionId,
    workflowId: app.workflowId,
    applicantBirthDate: app.applicantBirthDate,
    applicantBirthPlace: app.applicantBirthPlace,
    applicantGender: app.applicantGender,
    applicantNationality: app.applicantNationality,
    previousSchool: app.previousSchool,
    previousGradeLevelCode: app.previousGradeLevelCode,
    isRepeating: app.isRepeating,
    desiredProgramId: app.desiredProgramId,
    assignmentReference: app.assignmentReference,
    referrerLabel: app.referrerLabel,
    prospectId: app.prospectId,
    capacityOverrideReason: app.capacityOverrideReason,
    waitlistEnteredAt: app.waitlistEnteredAt,
    decidedAt: app.decidedAt,
    closedAt: app.closedAt,
    closureKind: app.stageClosureKind as AdmissionsApplicationDetailDto["closureKind"],
    studentId: app.studentId,
    enrollmentId: app.enrollmentId,
    invoiceId: app.invoiceId,
    enrollmentConfirmedAt: app.enrollmentConfirmedAt,
    enrolledAt: app.enrolledAt,
    rowVersion: app.rowVersion,
    guardians: await apps.listGuardians(tx, app.id),
    consents: await apps.listConsents(tx, app.id),
    documents: await cases.listApplicationDocuments(tx, app.id),
    missingDocuments: await apps.missingRequiredDocuments(tx, app.id),
    interviews: await cases.listInterviews(tx, app.id),
    offers: await cases.listOffers(tx, app.id),
    duplicates: await cases.listDuplicates(tx, app.id),
    seatsLeft: seats,
    hasValidConsent: await apps.hasValidConsent(tx, app.id),
    allowedTransitions: await allowedTransitions(tx, app),
    extra: app.extra,
  };
}

export async function getApplication(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string): Promise<Result<AdmissionsApplicationDetailDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const app = await apps.getApplicationRow(tx, applicationId);
      if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
      return ok(await buildDetail(deps, tx, app));
    },
    { readOnly: true },
  );
}

export async function listApplications(deps: AdmissionsDeps, ctx: RequestContext, query: AdmissionsListApplicationsQuery, institutionId?: string): Promise<Result<Page<AdmissionsApplicationSummaryDto>, AppError>> {
  const pageSize = Math.min(query.pageSize, ADMISSION_LIMITS.pageSizeMax);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const r = await apps.listApplicationSummaries(tx, {
        now: nowIso(deps),
        filter: { institutionId, campaignId: query.campaignId, status: query.status, stage: query.stage, grade: query.grade, q: query.q, overdue: query.overdue },
        limit: pageSize,
        offset: (query.page - 1) * pageSize,
      });
      return ok({ items: r.items, total: r.total, page: query.page, pageSize });
    },
    { readOnly: true },
  );
}

/** Tableau (kanban) : une colonne par étape du workflow de la campagne, avec effectif total et premières cartes. */
export async function getBoard(deps: AdmissionsDeps, ctx: RequestContext, query: { campaignId: string; grade?: string | undefined }): Promise<Result<AdmissionsBoardDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const campaign = await wf.getCampaignRow(tx, query.campaignId);
      if (!campaign) return err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", query.campaignId));
      const stages = await apps.listBoardStages(tx, campaign.workflowId);
      const counts = await apps.boardCounts(tx, campaign.id, query.grade);
      const cards = await apps.boardCards(tx, { now: nowIso(deps), campaignId: campaign.id, grade: query.grade, perStage: ADMISSION_LIMITS.boardCardsPerStage });
      const byStage = new Map<string, AdmissionsApplicationSummaryDto[]>();
      for (const raw of cards) {
        const { rn: _rn, ...card } = raw as AdmissionsApplicationSummaryDto & { rn?: unknown };
        void _rn;
        byStage.set(card.stageId, [...(byStage.get(card.stageId) ?? []), card]);
      }
      return ok({
        campaignId: campaign.id,
        workflowId: campaign.workflowId,
        columns: stages.map((stage) => ({ stage, total: counts.get(stage.id) ?? 0, cards: byStage.get(stage.id) ?? [] })),
        transitions: await wf.listTransitions(tx, campaign.workflowId),
      });
    },
    { readOnly: true },
  );
}

export async function getHistory(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string): Promise<Result<AdmissionsHistoryDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await apps.getApplicationRow(tx, applicationId))) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
      return ok(await apps.getHistory(tx, applicationId));
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Mise à jour
// ---------------------------------------------------------------------------

export async function updateApplication(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, body: AdmissionsUpdateApplicationBody): Promise<Result<AdmissionsApplicationDetailDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé : il ne change plus."));
    if (body.rowVersion !== undefined && body.rowVersion !== app.rowVersion) {
      return err(conflict(AdmissionsCode.VERSION_CONFLICT, "Le dossier a été modifié par une autre personne : rechargez-le.", { rowVersion: app.rowVersion }));
    }
    if (body.applicantBirthDate && !isPlausibleBirthDate(body.applicantBirthDate, todayIso(deps))) {
      return err(validation(AdmissionsCode.INVALID_INPUT, "La date de naissance n'est pas plausible.", "applicantBirthDate"));
    }
    if (body.priorityClassCode) {
      const classes = await ref.listPriorityClasses(tx, app.institutionId);
      if (!classes.some((c) => c.code === body.priorityClassCode && c.active)) return err(validation(AdmissionsCode.INVALID_INPUT, "Classe de priorité inconnue.", "priorityClassCode"));
    }
    const { rowVersion: _rv, ...patch } = body;
    void _rv;
    await apps.updateApplicationFields(tx, applicationId, patch);
    const after = (await apps.getApplicationRow(tx, applicationId)) as apps.ApplicationRow;
    const identityChanged = after.identityKey !== app.identityKey;
    if (identityChanged) await detectDuplicates(deps, ctx, tx, after);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({
      action: "admissions.application.update",
      resourceType: "application",
      resourceId: applicationId,
      metadata: { fields: Object.keys(patch), priorityChanged: patch.priorityClassCode !== undefined && patch.priorityClassCode !== app.priorityClassCode, identityChanged },
    });
    await buffer.flush(tx);
    return ok(await buildDetail(deps, tx, after));
  });
}

// ---------------------------------------------------------------------------
// Changement d'étape (hors décision formelle)
// ---------------------------------------------------------------------------

/** Transition visée par une demande : permet à la couche HTTP de contrôler la permission PORTÉE PAR LA TRANSITION. */
export async function peekTransition(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, toStageId: string): Promise<Result<{ permissionKey: string; requiresDecision: boolean; requiresReason: boolean; toStatus: string }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const app = await apps.getApplicationRow(tx, applicationId);
      if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
      const t = await apps.getTransitionBetween(tx, app.workflowId, app.stageId, toStageId);
      if (!t) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Cette transition n'est pas déclarée dans le workflow depuis l'étape courante du dossier."));
      return ok({ permissionKey: t.permissionKey, requiresDecision: t.requiresDecision, requiresReason: t.requiresReason, toStatus: t.toStatus });
    },
    { readOnly: true },
  );
}

export async function transitionApplication(
  deps: AdmissionsDeps,
  ctx: RequestContext,
  applicationId: string,
  body: { toStageId: string; reason?: string | undefined; rowVersion?: number | undefined },
  options: { onSeatFreed?: SeatFreedHandler | undefined } = {},
): Promise<Result<AdmissionsApplicationDetailDto, AppError>> {
  return inTx(deps, ctx, async (tx, scope) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé : il ne change plus."));
    if (body.rowVersion !== undefined && body.rowVersion !== app.rowVersion) {
      return err(conflict(AdmissionsCode.VERSION_CONFLICT, "Le dossier a été modifié par une autre personne : rechargez-le.", { rowVersion: app.rowVersion }));
    }
    const t = await apps.getTransitionBetween(tx, app.workflowId, app.stageId, body.toStageId);
    if (!t) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Cette transition n'est pas déclarée dans le workflow depuis l'étape courante du dossier."));
    if (t.requiresDecision) return err(conflict(AdmissionsCode.DECISION_MISSING, "L'étape visée exige une décision formelle : utilisez l'enregistrement d'une décision."));
    if (t.createsEnrollment) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "L'étape qui crée l'inscription n'est franchie que par l'acceptation de l'offre."));
    if (t.toStatus === "ENROLLED") return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "ENROLLED est dérivé de la confirmation de l'inscription : il ne se pose pas à la main."));
    if (t.requiresReason && !(body.reason && body.reason.trim().length >= 3)) return err(validation(AdmissionsCode.REASON_REQUIRED, "Cette transition exige un motif.", "reason"));
    const events = new EventBuffer(deps, ctx);
    const moved = await moveStage(deps, ctx, tx, scope, events, app, body.toStageId, { onSeatFreed: options.onSeatFreed });
    await events.flush(tx);
    return ok(await buildDetail(deps, tx, moved.after));
  });
}

// ---------------------------------------------------------------------------
// Consentements enregistrés par le personnel
// ---------------------------------------------------------------------------

export async function recordConsent(
  deps: AdmissionsDeps,
  ctx: RequestContext,
  applicationId: string,
  body: { guardianId: string; kind: string; textVersion: string; givenVia: "STAFF_ON_BEHALF" | "PAPER"; evidenceRef: string },
): Promise<Result<AdmissionsApplicationDetailDto, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé."));
    const guardian = await apps.getGuardian(tx, applicationId, body.guardianId);
    if (!guardian) return err(notFound(AdmissionsCode.NOT_FOUND, "Tuteur", body.guardianId));
    if (!guardian.canConsent) return err(conflict(AdmissionsCode.GUARDIAN_NOT_ENTITLED, "Ce tuteur n'est pas habilité à consentir."));
    const text = await ref.getConsentText(tx, app.institutionId, body.kind, body.textVersion);
    if (!text || text.retiredAt) return err(validation(AdmissionsCode.CONSENT_TEXT_MISSING, "Version du texte de consentement inconnue ou retirée.", "textVersion"));
    await apps.insertConsent(tx, { id: deps.newId(), tenantId: ctx.tenantId, applicationId, guardianId: body.guardianId, kind: body.kind, textVersion: body.textVersion, givenVia: body.givenVia, evidenceRef: body.evidenceRef, ipHash: null, uaHash: null });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.consent.record", resourceType: "application", resourceId: applicationId, metadata: { kind: body.kind, textVersion: body.textVersion, via: body.givenVia } });
    await buffer.flush(tx);
    return ok(await buildDetail(deps, tx, app));
  });
}

export async function withdrawConsent(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, body: { consentId: string; reason: string }): Promise<Result<AdmissionsApplicationDetailDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    const done = await apps.withdrawConsent(tx, applicationId, body.consentId, body.reason);
    if (!done) return err(notFound(AdmissionsCode.NOT_FOUND, "Consentement actif", body.consentId));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.consent.withdraw", resourceType: "application", resourceId: applicationId, metadata: { consentId: body.consentId } });
    await buffer.flush(tx);
    return ok(await buildDetail(deps, tx, app));
  });
}
