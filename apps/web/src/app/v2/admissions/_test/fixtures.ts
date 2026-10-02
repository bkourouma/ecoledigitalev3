/**
 * Fabriques de test conformes aux contrats du module `admissions` (validées par les schémas dans les tests : aucune dérive).
 */
import type {
  AdmissionsAllowedTransitionDto,
  AdmissionsApplicationDetailDto,
  AdmissionsApplicationDocumentDto,
  AdmissionsApplicationSummaryDto,
  AdmissionsBoardDto,
  AdmissionsCampaignDto,
  AdmissionsOfferDto,
  AdmissionsPublicFormDto,
  AdmissionsPublicTrackDto,
  AdmissionsSettingsDto,
  AdmissionsStageDto,
  AdmissionsTransitionDto,
  AdmissionsWorkflowViewDto,
} from "@ecoledigitale/contracts/v2/admissions";

export const NOW = "2026-10-02T09:00:00.000Z";
export const uuid = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${String(n).padStart(12, "0")}`;

export const IDS = {
  institution: uuid(1),
  year: uuid(2),
  campaign: uuid(3),
  workflow: uuid(4),
  stageSubmitted: uuid(10),
  stageReview: uuid(11),
  stageAccepted: uuid(12),
  stageRejected: uuid(13),
  app1: uuid(20),
  app2: uuid(21),
  guardian: uuid(30),
  requirement: uuid(40),
  requirement2: uuid(41),
  offer: uuid(50),
  classroom: uuid(60),
  transition1: uuid(70),
  transition2: uuid(71),
  transition3: uuid(72),
};

export const SLUG = "abcdefghij0123456789xyz";

export function stage(over: Partial<AdmissionsStageDto> = {}): AdmissionsStageDto {
  return {
    id: IDS.stageSubmitted,
    code: "SUBMITTED",
    label: "Déposée",
    canonicalStatus: "SUBMITTED",
    ordinal: 1,
    isInitial: true,
    isTerminal: false,
    holdsSeat: false,
    requiresConsent: false,
    requiresDocumentsComplete: false,
    requiresInterviewDone: false,
    requiresDecision: false,
    createsEnrollment: false,
    closureKind: null,
    slaHours: 48,
    notifyTemplateCode: null,
    ...over,
  };
}

export const reviewStage = (over: Partial<AdmissionsStageDto> = {}) => stage({ id: IDS.stageReview, code: "UNDER_REVIEW", label: "À l'étude", canonicalStatus: "UNDER_REVIEW", ordinal: 2, isInitial: false, slaHours: null, ...over });
export const acceptedStage = (over: Partial<AdmissionsStageDto> = {}) => stage({ id: IDS.stageAccepted, code: "ACCEPTED", label: "Acceptée", canonicalStatus: "ACCEPTED", ordinal: 3, isInitial: false, holdsSeat: true, requiresDecision: true, slaHours: null, ...over });
export const rejectedStage = (over: Partial<AdmissionsStageDto> = {}) => stage({ id: IDS.stageRejected, code: "REJECTED", label: "Refusée", canonicalStatus: "REJECTED", ordinal: 4, isInitial: false, isTerminal: true, requiresDecision: true, closureKind: "REJECTED_BY_SCHOOL", slaHours: null, ...over });

export function transition(over: Partial<AdmissionsTransitionDto> = {}): AdmissionsTransitionDto {
  return { id: IDS.transition1, fromStageId: IDS.stageSubmitted, toStageId: IDS.stageReview, permissionKey: "admission.update", requiresReason: false, isAutomatic: false, ...over };
}

export function summary(over: Partial<AdmissionsApplicationSummaryDto> = {}): AdmissionsApplicationSummaryDto {
  return {
    id: IDS.app1,
    applicationNumber: "2026-00001",
    campaignId: IDS.campaign,
    stageId: IDS.stageSubmitted,
    stageCode: "SUBMITTED",
    stageLabel: "Déposée",
    status: "SUBMITTED",
    applicantFirstName: "Awa",
    applicantLastName: "KONÉ",
    desiredGradeLevelCode: "CP1",
    fundingTypeRequested: "PRIVATE",
    priorityClassCode: null,
    sourceChannel: "PUBLIC_FORM",
    createdVia: "PUBLIC_FORM",
    submittedAt: NOW,
    updatedAt: NOW,
    stageEnteredAt: NOW,
    slaHours: 48,
    overdue: false,
    anonymized: false,
    ...over,
  };
}

export function allowed(over: Partial<AdmissionsAllowedTransitionDto> = {}): AdmissionsAllowedTransitionDto {
  return {
    transitionId: IDS.transition1,
    toStageId: IDS.stageReview,
    toStageCode: "UNDER_REVIEW",
    toStageLabel: "À l'étude",
    toStatus: "UNDER_REVIEW",
    permissionKey: "admission.update",
    requiresReason: false,
    requiresDecision: false,
    createsEnrollment: false,
    isAutomatic: false,
    decisionKind: null,
    ...over,
  };
}

export function document(over: Partial<AdmissionsApplicationDocumentDto> = {}): AdmissionsApplicationDocumentDto {
  return {
    requirementId: IDS.requirement,
    requirementCode: "BIRTH_CERTIFICATE",
    requirementLabel: "Acte de naissance",
    required: true,
    applicable: true,
    status: "MISSING",
    contentType: null,
    sizeBytes: null,
    attempts: 0,
    rejectionReason: null,
    submittedAt: null,
    reviewedAt: null,
    ...over,
  };
}

export function offer(over: Partial<AdmissionsOfferDto> = {}): AdmissionsOfferDto {
  return { id: IDS.offer, status: "PENDING", gradeLevelCode: "CP1", classroomId: IDS.classroom, issuedAt: NOW, expiresAt: "2026-10-16T09:00:00.000Z", respondedAt: null, respondedByGuardianId: null, conditions: null, ...over };
}

export function detail(over: Partial<AdmissionsApplicationDetailDto> = {}): AdmissionsApplicationDetailDto {
  return {
    ...summary(),
    institutionId: IDS.institution,
    workflowId: IDS.workflow,
    applicantBirthDate: "2020-03-14",
    applicantBirthPlace: "Abidjan",
    applicantGender: "FEMALE",
    applicantNationality: "CI",
    previousSchool: null,
    previousGradeLevelCode: null,
    isRepeating: false,
    desiredProgramId: null,
    assignmentReference: null,
    referrerLabel: null,
    prospectId: null,
    capacityOverrideReason: null,
    waitlistEnteredAt: null,
    decidedAt: null,
    closedAt: null,
    closureKind: null,
    studentId: null,
    enrollmentId: null,
    invoiceId: null,
    enrollmentConfirmedAt: null,
    enrolledAt: null,
    rowVersion: 3,
    guardians: [{ id: IDS.guardian, relationshipCode: "MOTHER", firstName: "Mariam", lastName: "KONÉ", phone: "+2250700000000", email: null, profession: null, isPrimary: true, isFinancialResponsible: true, canConsent: true }],
    consents: [],
    documents: [document()],
    missingDocuments: ["Acte de naissance"],
    interviews: [],
    offers: [],
    duplicates: [],
    seatsLeft: 4,
    hasValidConsent: false,
    allowedTransitions: [allowed()],
    extra: {},
    ...over,
  };
}

export function campaign(over: Partial<AdmissionsCampaignDto> = {}): AdmissionsCampaignDto {
  return {
    id: IDS.campaign,
    institutionId: IDS.institution,
    academicYearId: IDS.year,
    code: "RENTREE-2026",
    label: "Rentrée 2026",
    workflowId: IDS.workflow,
    opensAt: "2026-09-01T00:00:00.000Z",
    closesAt: "2026-12-01T00:00:00.000Z",
    status: "OPEN",
    capacities: [{ id: uuid(80), gradeLevelCode: "CP1", programId: null, seats: 30, waitlistLimit: 10, seatsLeft: 4, waitlistCount: 2 }],
    ...over,
  };
}

export function board(over: Partial<AdmissionsBoardDto> = {}): AdmissionsBoardDto {
  return {
    campaignId: IDS.campaign,
    workflowId: IDS.workflow,
    columns: [
      { stage: stage(), total: 1, cards: [summary()] },
      { stage: reviewStage(), total: 1, cards: [summary({ id: IDS.app2, applicationNumber: "2026-00002", applicantFirstName: "Issa", applicantLastName: "TRAORÉ", stageId: IDS.stageReview, stageCode: "UNDER_REVIEW", stageLabel: "À l'étude", status: "UNDER_REVIEW", overdue: true })] },
      { stage: acceptedStage(), total: 0, cards: [] },
      { stage: rejectedStage(), total: 0, cards: [] },
    ],
    transitions: [
      transition(),
      transition({ id: IDS.transition2, fromStageId: IDS.stageReview, toStageId: IDS.stageAccepted, permissionKey: "admission.decide" }),
      transition({ id: IDS.transition3, fromStageId: IDS.stageSubmitted, toStageId: IDS.stageRejected, permissionKey: "admission.decide", requiresReason: true }),
    ],
    ...over,
  };
}

export function workflow(over: Partial<AdmissionsWorkflowViewDto> = {}): AdmissionsWorkflowViewDto {
  return {
    id: IDS.workflow,
    institutionId: IDS.institution,
    code: "STANDARD",
    version: 1,
    label: "Parcours standard",
    educationLevelCode: null,
    status: "DRAFT",
    publishedAt: null,
    stages: [stage(), reviewStage(), acceptedStage(), rejectedStage()],
    transitions: board().transitions,
    defects: [],
    ...over,
  };
}

export function settings(over: Partial<AdmissionsSettingsDto> = {}): AdmissionsSettingsDto {
  return {
    institutionId: IDS.institution,
    publicFormEnabled: true,
    capacityPolicy: "HARD",
    duplicatePolicy: "WARN",
    waitlistEnabled: true,
    consentRequired: true,
    consentTextVersion: "1.0",
    offerValidityDays: 14,
    paymentDeadlineDays: null,
    waitlistPromotion: "MANUAL",
    minimumFormSeconds: 5,
    captchaRequired: false,
    submissionsPer10Min: 20,
    rejectedRetentionMonths: null,
    applicationNumberPattern: "{YEAR}-{SEQ:5}",
    publicFormSlug: SLUG,
    publicFormLinkEnabled: true,
    ...over,
  };
}

export const lookups = {
  institutions: [{ id: IDS.institution, name: "École Les Palmiers" }],
  gradeLevels: [
    { code: "CP1", label: "CP1" },
    { code: "CE1", label: "CE1" },
  ],
  relationships: [
    { code: "MOTHER", label: "Mère" },
    { code: "FATHER", label: "Père" },
  ],
};

export function publicForm(over: Partial<AdmissionsPublicFormDto> = {}): AdmissionsPublicFormDto {
  return {
    institutionName: "École Les Palmiers",
    grades: [{ code: "CP1", label: "CP1" }],
    documents: [{ code: "BIRTH_CERTIFICATE", label: "Acte de naissance", required: true, acceptsMime: ["application/pdf"], maxSizeKb: 5120 }],
    relationships: [{ code: "MOTHER", label: "Mère" }, { code: "FATHER", label: "Père" }],
    consent: { kind: "DATA_PROCESSING", version: "1.0", language: "fr", body: "Nous traitons les données de votre enfant pour instruire sa candidature." },
    antiSpam: { minimumFormSeconds: 5, captchaRequired: false, honeypotField: "website" },
    formToken: "t".repeat(40),
    ...over,
  };
}

export function track(over: Partial<AdmissionsPublicTrackDto> = {}): AdmissionsPublicTrackDto {
  return { phase: "DOCUMENTS_NEEDED", phaseLabel: "Pièces à fournir", missingDocuments: [{ requirementId: IDS.requirement, label: "Acte de naissance", rejected: false, reason: null }], offer: null, closureLabel: null, updatedAt: NOW, ...over };
}
