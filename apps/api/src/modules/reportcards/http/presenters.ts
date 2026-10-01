/** Présentation : objets du domaine -> DTO des contrats (`packages/contracts/src/v2/reportcards.ts`). Aucune logique métier. */
import type { PublicVerification, FileVerification } from "../application/verify";
import type { BatchView } from "../application/issue";
import type { CardDetail, CardView } from "../application/queries";
import type { PublicKeyView } from "../application/platform";
import type { Branding, BatchRecord, PlatformTemplate, RenderRecord, ReportCardRecord, ReportcardsSettings, Signatory, TemplateConfig } from "../domain/types";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function cardDto(card: ReportCardRecord, needsReissue: boolean | null = null) {
  return {
    id: card.id,
    documentKind: card.documentKind,
    scope: card.scope,
    studentId: card.studentId,
    enrollmentId: card.enrollmentId,
    classroomId: card.classroomId,
    academicYearId: card.academicYearId,
    academicPeriodId: card.academicPeriodId,
    version: card.version,
    status: card.status,
    provisional: card.provisional,
    title: card.title,
    studentName: card.studentName,
    snapshotHash: card.snapshotHash,
    verificationCode: card.verificationCode,
    signingKeyId: card.signingKeyId,
    issuedAt: card.issuedAt.toISOString(),
    publishedAt: iso(card.publishedAt),
    withdrawnAt: iso(card.withdrawnAt),
    supersededAt: iso(card.supersededAt),
    supersedesId: card.supersedesId,
    revokedAt: iso(card.revokedAt),
    renderStatus: card.renderStatus,
    resultsVersion: card.resultsVersion,
    templateKey: card.templateKey,
    templateVersion: card.templateVersion,
    needsReissue,
  };
}

export const cardViewDto = (v: CardView) => cardDto(v.card, v.needsReissue);

export function renderDto(r: RenderRecord) {
  return {
    id: r.id,
    status: r.status,
    pdfHash: r.pdfHash,
    sizeBytes: r.sizeBytes,
    pages: r.pages,
    attempts: r.attempts,
    error: r.error,
    requestedAt: r.requestedAt.toISOString(),
    finishedAt: iso(r.finishedAt),
  };
}

export const detailDto = (d: CardDetail) => ({ ...cardDto(d.card), snapshot: d.snapshot, renders: d.renders.map(renderDto) });

export function batchDto(b: BatchRecord) {
  return {
    id: b.id,
    documentKind: b.documentKind,
    classroomId: b.classroomId,
    academicPeriodId: b.academicPeriodId,
    resultsVersion: b.resultsVersion,
    provisional: b.provisional,
    status: b.status,
    total: b.total,
    issued: b.issued,
    excluded: b.excluded,
    failed: b.failed,
    rendered: b.rendered,
    combinedPdfReady: b.combinedPdfKey !== null,
    requestedAt: b.requestedAt.toISOString(),
    finishedAt: iso(b.finishedAt),
  };
}

export const batchViewDto = (v: BatchView) => ({
  ...batchDto(v.batch),
  items: v.items.map((i) => ({ enrollmentId: i.enrollmentId, outcome: i.outcome, reasonCode: i.reasonCode, message: i.message, reportCardId: i.reportCardId })),
});

export const brandingDto = (b: Branding) => ({
  id: b.id,
  institutionId: b.institutionId,
  version: b.version,
  isCurrent: b.isCurrent,
  legalName: b.legalName,
  shortName: b.shortName,
  headerLeft: [...b.headerLeft],
  headerRight: [...b.headerRight],
  address: b.address,
  phone: b.phone,
  email: b.email,
  website: b.website,
  registrationRef: b.registrationRef,
  logoObjectKey: b.logoObjectKey,
  emblemObjectKey: b.emblemObjectKey,
  primaryColor: b.primaryColor,
  secondaryColor: b.secondaryColor,
  footerText: b.footerText,
  createdAt: b.createdAt.toISOString(),
});

export const signatoryDto = (s: Signatory) => ({
  id: s.id,
  institutionId: s.institutionId,
  fullName: s.fullName,
  title: s.title,
  jobFunction: s.jobFunction,
  signatureObjectKey: s.signatureObjectKey,
  staffId: s.staffId,
  active: s.active,
  validFrom: s.validFrom,
  validTo: s.validTo,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export const templateDto = (t: PlatformTemplate) => ({
  key: t.key,
  version: t.version,
  documentKind: t.documentKind,
  pack: t.pack,
  snapshotSchema: t.snapshotSchema,
  title: t.title,
  optionsSchema: t.optionsSchema,
  signatureSlots: t.signatureSlots.map((s) => ({ slot: s.slot, label: s.label, required: s.required })),
  status: t.status,
  contentHash: t.contentHash,
  publishedAt: iso(t.publishedAt),
});

export const configDto = (c: TemplateConfig) => ({
  id: c.id,
  institutionId: c.institutionId,
  documentKind: c.documentKind,
  pack: c.pack,
  templateKey: c.templateKey,
  templateVersion: c.templateVersion,
  configVersion: c.configVersion,
  isCurrent: c.isCurrent,
  options: c.options,
  signatureAssignments: c.signatureAssignments.map((a) => ({ slot: a.slot, signatoryId: a.signatoryId })),
  createdAt: c.createdAt.toISOString(),
});

export const settingsDto = (s: ReportcardsSettings) => ({
  blockIfUnpaid: s.blockIfUnpaid,
  requireDeliberation: s.requireDeliberation,
  verificationShowsMention: s.verificationShowsMention,
  updatedAt: iso(s.updatedAt),
});

export const verificationDto = (v: PublicVerification) => ({
  status: v.status,
  documentKind: v.documentKind,
  institutionName: v.institutionName,
  title: v.title,
  issuedAt: iso(v.issuedAt),
  mention: v.mention,
  supersededByIssuedAt: iso(v.supersededByIssuedAt),
  revokedAt: iso(v.revokedAt),
  keyId: v.keyId,
  keyFingerprint: v.keyFingerprint,
  snapshotHash: v.snapshotHash,
  signature: v.signature,
  message: v.message,
});

export const fileVerificationDto = (v: FileVerification) => ({
  match: v.match,
  status: v.status,
  institutionName: v.institutionName,
  title: v.title,
  issuedAt: iso(v.issuedAt),
  message: v.message,
});

export const keyDto = (k: PublicKeyView) => ({
  keyId: k.keyId,
  algorithm: k.algorithm,
  publicKey: k.publicKey,
  fingerprint: k.fingerprint,
  status: k.status,
  createdAt: k.createdAt.toISOString(),
  retiredAt: iso(k.retiredAt),
});
