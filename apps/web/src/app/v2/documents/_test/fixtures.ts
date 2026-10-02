/**
 * Fabriques de test conformes aux contrats du module `documents` (validées par les schémas dans les tests : aucune dérive).
 */
import type {
  DocumentCategoryDto,
  DocumentDetailDto,
  DocumentMyContextDto,
  DocumentQuarantineDto,
  DocumentSettingsDto,
  DocumentShareDto,
  DocumentSummaryDto,
  DocumentUsageDto,
  DocumentVersionDto,
} from "@ecoledigitale/contracts/v2/documents";

export const NOW = "2026-10-02T09:00:00.000Z";
export const uuid = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${String(n).padStart(12, "0")}`;

export const IDS = {
  doc: uuid(1),
  doc2: uuid(2),
  doc3: uuid(3),
  catIdentity: uuid(10),
  catMedical: uuid(11),
  catRegulation: uuid(12),
  student: uuid(20),
  child: uuid(21),
  staff: uuid(22),
  user: uuid(30),
  guardian: uuid(31),
  quarantine: uuid(40),
  share: uuid(50),
};

export const SHA = "a".repeat(64);

export function category(over: Partial<DocumentCategoryDto> = {}): DocumentCategoryDto {
  return {
    id: IDS.catIdentity,
    code: "STUDENT_IDENTITY",
    label: "Pièces d'identité de l'élève",
    description: null,
    kind: "STUDENT",
    confidentiality: "RESTRICTED",
    allowedExtensions: ["pdf", "jpg", "jpeg", "png"],
    maxBytes: null,
    audienceOwner: true,
    audienceGuardians: true,
    ownerUpload: true,
    requiresExpiry: false,
    alertDays: null,
    retentionDays: null,
    status: "ACTIVE",
    isSystem: true,
    sortOrder: 100,
    canUpload: true,
    documentCount: null,
    ...over,
  };
}

export function version(over: Partial<DocumentVersionDto> = {}): DocumentVersionDto {
  return {
    versionNo: 1,
    current: true,
    fileName: "cni.pdf",
    extension: "pdf",
    mime: "application/pdf",
    sizeBytes: 123_456,
    sha256: SHA,
    scanStatus: "CLEAN",
    note: null,
    uploadedBy: IDS.user,
    uploadedByName: "Secrétariat",
    createdAt: NOW,
    state: "ACTIVE",
    previewKind: "PDF",
    ...over,
  };
}

export function summary(over: Partial<DocumentSummaryDto> = {}): DocumentSummaryDto {
  return {
    id: IDS.doc,
    kind: "STUDENT",
    categoryId: IDS.catIdentity,
    categoryCode: "STUDENT_IDENTITY",
    categoryLabel: "Pièces d'identité de l'élève",
    confidentiality: "RESTRICTED",
    title: "CNI de Awa",
    description: null,
    tags: [],
    ownerType: "STUDENT",
    ownerId: IDS.child,
    ownerName: "KONÉ Awa",
    visibility: "INHERIT",
    status: "ACTIVE",
    currentVersionNo: 1,
    versionCount: 1,
    fileName: "cni.pdf",
    extension: "pdf",
    mime: "application/pdf",
    sizeBytes: 123_456,
    previewKind: "PDF",
    expiresOn: null,
    expiryState: "NONE",
    daysToExpiry: null,
    createdBy: IDS.user,
    createdByName: "Secrétariat",
    createdAt: NOW,
    updatedAt: NOW,
    access: { write: true, share: true, archive: false, history: true, via: ["LEVEL"] },
    ...over,
  };
}

export function share(over: Partial<DocumentShareDto> = {}): DocumentShareDto {
  return { id: IDS.share, userId: IDS.guardian, userName: "Mme Koné", level: "READ", expiresAt: null, note: null, createdBy: IDS.user, createdAt: NOW, revokedAt: null, active: true, ...over };
}

export function detail(over: Partial<DocumentDetailDto> = {}): DocumentDetailDto {
  return {
    ...summary(),
    metadata: { numero: "CI-123" },
    alertDays: null,
    versions: [version()],
    shares: [],
    archivedAt: null,
    archiveReason: null,
    purgeAfter: null,
    ...over,
  };
}

export function context(over: Partial<DocumentMyContextDto> = {}, caps: Partial<DocumentMyContextDto["caps"]> = {}): DocumentMyContextDto {
  return {
    caps: {
      read: true,
      readRestricted: true,
      readConfidential: false,
      upload: true,
      share: true,
      archive: false,
      manage: false,
      historyRead: true,
      categoryManage: false,
      settingsManage: false,
      quarantineManage: false,
      childRead: false,
      childUpload: false,
      selfRead: false,
      selfUpload: false,
      ownRead: false,
      ownUpload: false,
      ...caps,
    },
    links: { studentId: null, studentName: null, childStudentIds: [], children: [], staffId: null, staffName: null },
    upload: { defaultMaxBytes: 15 * 1024 * 1024, hardMaxBytes: 50 * 1024 * 1024, supportedExtensions: ["pdf", "jpg", "jpeg", "png", "docx", "txt"] },
    scanner: { enabled: true, failClosed: true },
    officePreview: false,
    ...over,
  };
}

export function settings(over: Partial<DocumentSettingsDto> = {}): DocumentSettingsDto {
  return { maxBytes: 15 * 1024 * 1024, storageQuotaBytes: null, defaultAlertDays: [30, 7, 1], archiveRetentionDays: 365, quarantineRetentionDays: 30, maxVersions: 50, updatedAt: null, ...over };
}

export function usage(over: Partial<DocumentUsageDto> = {}): DocumentUsageDto {
  return { usedBytes: 512 * 1024 * 1024, quotaBytes: 2 * 1024 * 1024 * 1024, planQuotaBytes: 2 * 1024 * 1024 * 1024, documentCount: 12, versionCount: 20, quarantineHeldCount: 1, archivedCount: 2, ...over };
}

export function quarantineItem(over: Partial<DocumentQuarantineDto> = {}): DocumentQuarantineDto {
  return {
    id: IDS.quarantine,
    status: "HELD",
    fileName: "facture.pdf",
    extension: "pdf",
    mime: "application/pdf",
    sizeBytes: 2048,
    sha256: SHA,
    signature: "Eicar-Test-Signature",
    engine: "clamav-tcp",
    uploadedBy: IDS.user,
    uploadedByName: "Secrétariat",
    createdAt: NOW,
    intentKind: "CREATE",
    categoryId: IDS.catIdentity,
    documentId: null,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    releasedDocumentId: null,
    ...over,
  };
}

export const page = <T,>(items: T[], nextCursor: string | null = null) => ({ items, nextCursor });
