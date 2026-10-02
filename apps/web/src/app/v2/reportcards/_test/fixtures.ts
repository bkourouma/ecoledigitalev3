/** Jeux de données de test conformes aux contrats `packages/contracts/src/v2/reportcards.ts` (réponses validées par Zod). */
import { uuid } from "../../_test/fixtures";

export { uuid };
export const NOW = "2026-10-01T08:00:00.000Z";
export const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, 26).replace(/[018-9]/g, "A");

export function card(n: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(7000 + n),
    documentKind: "REPORT_CARD",
    scope: "PERIOD",
    studentId: uuid(3000 + n),
    enrollmentId: uuid(2000 + n),
    classroomId: uuid(500),
    academicYearId: uuid(100),
    academicPeriodId: uuid(200),
    version: 1,
    status: "ISSUED",
    provisional: false,
    title: "Bulletin du semestre 1",
    studentName: ["", "Aka Marie", "Bamba Yao", "Coulibaly Awa"][n] ?? `Élève ${n}`,
    snapshotHash: "a".repeat(64),
    verificationCode: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".replace(/[^A-Z2-7]/g, "A").slice(0, 26),
    signingKeyId: "ed-0123456789abcdef",
    issuedAt: NOW,
    publishedAt: null,
    withdrawnAt: null,
    supersededAt: null,
    supersedesId: null,
    revokedAt: null,
    renderStatus: "RENDERED",
    resultsVersion: 1,
    templateKey: "bulletin-lmd",
    templateVersion: 1,
    needsReissue: false,
    ...over,
  };
}

export function snapshot() {
  return {
    meta: { schema: "reportcard/1", kind: "REPORT_CARD", scope: "PERIOD", version: 1, provisional: false, issuedAt: NOW, issuedBy: { id: null, name: "Secrétariat" }, locale: "fr", title: "Bulletin du semestre 1" },
    student: { id: uuid(3001), lastName: "Aka", firstNames: "Marie", matricule: "ELV-001", birthDate: null, birthPlace: null, gender: null, nationality: null, repeating: null },
    enrollment: { id: uuid(2001), classroomId: uuid(500), classroomLabel: "Licence 1 A", levelLabel: null, programLabel: null, academicYearId: uuid(100), academicYearLabel: "2026-2027", periodId: uuid(200), periodLabel: "Semestre 1", classSize: 30 },
    institution: { legalName: "Université test", shortName: null, headerLeft: [], headerRight: [], address: null, phone: null, email: null, website: null, registrationRef: null, logoKey: null, emblemKey: null, primaryColor: null, secondaryColor: null, footerText: null, brandingVersion: 1 },
    results: {
      lines: [],
      summary: { averageExact: "13.4999", averageDisplay: "13.50", rank: 2, classSize: 30, classAverageDisplay: null, mention: "ASSEZ_BIEN", decisionCode: "ADMITTED", decisionOutcome: "ADMITTED", creditsAcquired: "30", creditsRequired: "30", totalCoefficient: null, weightedTotal: null, distinctions: [] },
      annual: null,
    },
    attendance: null,
    deliberation: { heldOn: "2026-09-30", nature: "COUNCIL" },
    appreciations: { general: null },
    signatories: [{ slot: "director", slotLabel: "Direction", name: "M. Konan", title: "Le Directeur", jobFunction: null, signatureKey: null }],
    rules: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 1, ruleVersionId: uuid(6100), definitionHash: "a".repeat(64), contractId: "credit-semester@1", engineVersion: "1.4.0", resultsStateId: uuid(6000), resultsVersion: 1, closureHash: "b".repeat(64) },
    template: { key: "bulletin-lmd", version: 1, configVersion: 1, options: {} },
    labels: { ASSEZ_BIEN: "Assez bien", ADMITTED: "Admis" },
  };
}

export function detail(over: Partial<Record<string, unknown>> = {}) {
  return {
    ...card(1, over),
    snapshot: snapshot(),
    renders: [{ id: uuid(7100), status: "RENDERED", pdfHash: "c".repeat(64), sizeBytes: 12345, pages: 2, attempts: 1, error: null, requestedAt: NOW, finishedAt: NOW }],
  };
}

export function batch(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(7200),
    documentKind: "REPORT_CARD",
    classroomId: uuid(500),
    academicPeriodId: uuid(200),
    resultsVersion: 1,
    provisional: false,
    status: "COMPLETED",
    total: 3,
    issued: 3,
    excluded: 0,
    failed: 0,
    rendered: 3,
    combinedPdfReady: true,
    requestedAt: NOW,
    finishedAt: NOW,
    items: [],
    ...over,
  };
}

export function preflight(over: Partial<Record<string, unknown>> = {}) {
  return { ok: true, issues: [], resultsVersion: 1, enrollments: { total: 3, eligible: 3, excluded: 0 }, ...over };
}

export function template(over: Partial<Record<string, unknown>> = {}) {
  return {
    key: "bulletin-lmd",
    version: 1,
    documentKind: "REPORT_CARD",
    pack: "HIGHER",
    snapshotSchema: "reportcard/1",
    title: "Bulletin LMD",
    optionsSchema: { type: "object", properties: { showRank: { type: "boolean", title: "Afficher le rang" }, density: { type: "string", title: "Densité", enum: ["compact", "aéré"] } } },
    signatureSlots: [{ slot: "director", label: "Direction", required: true }],
    status: "PUBLISHED",
    contentHash: "d".repeat(64),
    publishedAt: NOW,
    ...over,
  };
}

export function signatory(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(7300),
    institutionId: null,
    fullName: "M. Konan",
    title: "Le Directeur",
    jobFunction: null,
    signatureObjectKey: null,
    staffId: null,
    active: true,
    validFrom: null,
    validTo: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function branding(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(7400),
    institutionId: null,
    version: 1,
    isCurrent: true,
    legalName: "Université test",
    shortName: null,
    headerLeft: ["République"],
    headerRight: [],
    address: null,
    phone: null,
    email: null,
    website: null,
    registrationRef: null,
    logoObjectKey: null,
    emblemObjectKey: null,
    primaryColor: "#112233",
    secondaryColor: null,
    footerText: null,
    createdAt: NOW,
    ...over,
  };
}

export function config(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(7500),
    institutionId: null,
    documentKind: "REPORT_CARD",
    pack: "HIGHER",
    templateKey: "bulletin-lmd",
    templateVersion: 1,
    configVersion: 1,
    isCurrent: true,
    options: {},
    signatureAssignments: [],
    createdAt: NOW,
    ...over,
  };
}

export function verification(over: Partial<Record<string, unknown>> = {}) {
  return {
    status: "AUTHENTIC",
    documentKind: "REPORT_CARD",
    institutionName: "Université test",
    title: "Bulletin du semestre 1",
    issuedAt: NOW,
    mention: null,
    supersededByIssuedAt: null,
    revokedAt: null,
    keyId: "ed-0123456789abcdef",
    keyFingerprint: "e".repeat(64),
    snapshotHash: "a".repeat(64),
    signature: "c2lnbmF0dXJl",
    message: "Ce document a bien été émis par l'établissement.",
    ...over,
  };
}
