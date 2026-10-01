/**
 * API PUBLIQUE du module `reportcards` — seul point d'import autorisé pour les autres modules.
 *
 *   import { sealDocument, renderDocumentPdf, registerReportcardsPorts, InMemoryResults } from "../reportcards";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>`. Les entrées viennent des modules
 * voisins par des PORTS (`ResultsReadPort`, `GuardianshipPort`, `AttendanceSummaryPort`, `LearnerStandingPort`) qu'ils
 * enregistrent par `registerReportcardsPorts(app, ports)` ; le `StoragePort` est défini ICI (adaptateurs S3/MinIO et mémoire).
 *
 * Consommateurs : 019 (diplômes, attestations : `sealDocument`, `renderDocumentPdf`, `registerVerification`), 032 (bulletin de
 * paie), 016 (événements `reportcards.report_card.published|superseded|revoked`), 025, audit.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as reportcardsManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export {
  createPortRegistry,
  registerPublicRoutes,
  registerReportcardsPorts,
  reportcardsPlugin,
  setup as reportcardsSetup,
  VERIFY_RATE_RULE,
  type PublicRouteOptions,
  type ReportcardsPluginOptions,
  type ReportcardsPortRegistry,
} from "./http/plugin";
export { createPermissionKit, PERMISSIONS as REPORTCARDS_PERMISSIONS, type PermissionKit } from "./http/guards";

// Dépendances
export {
  createReportcardsDeps,
  DEFAULT_REPORTCARDS_CONFIG,
  inTx as reportcardsInTx,
  type ReportcardsConfig,
  type ReportcardsDeps,
  type ReportcardsDepsInput,
} from "./application/deps";

// Ports
export type {
  AttendanceSummary,
  AttendanceSummaryPort,
  AuditEntry,
  AuditPort,
  GuardianshipPort,
  KeyProvider,
  LearnerStandingPort,
  PdfMerger,
  PdfRenderInput,
  PdfRenderResult,
  PdfRenderer,
  ReportcardsPorts,
  ResultsReadPort,
  StorageObject,
  StoragePort,
  UserDirectoryPort,
} from "./application/ports";
export { noopAudit, RecordingAudit } from "./application/ports";
export { reportcardsAuditAdapter } from "./infrastructure/audit-adapter";
export {
  FakePdfRenderer,
  InMemoryAttendance,
  InMemoryDirectory,
  InMemoryGuardianship,
  InMemoryResults,
  InMemoryStanding,
  makeSampleBundle,
  type SampleBundleOptions,
} from "./infrastructure/in-memory-ports";
export { InMemoryStorage } from "./infrastructure/storage-memory";
export { S3Storage, s3ConfigFromEnv, s3StorageFromEnv, safeFileName } from "./infrastructure/storage-s3";
export { StaticKeyProvider, generateSigningKeyPair, keyProviderFromEnv } from "./infrastructure/key-provider";
export { PuppeteerPdfRenderer, findChromeExecutable, findPuppeteerCachedChrome, puppeteerRendererFromEnv } from "./infrastructure/puppeteer-renderer";
export { PdfLibMerger, stampPdfMetadata } from "./infrastructure/pdf-merger";

// Cas d'usage — émission, cycle de vie, lecture, rendu, vérification
export { createBatch, createTranscript, getBatchView, preflight, reissueReportCard, type BatchView, type CreateBatchInput, type PreflightInput, type PreflightView } from "./application/issue";
export { publishMany, publishReportCard, revokeReportCard, withdrawReportCard, type PublishManyResult } from "./application/lifecycle";
export { getCombinedPdfUrl, getDownloadUrl, getExplain, getReportCard, listForFamily, listReportCards, type CardDetail, type CardPageView, type CardView, type DownloadView, type FamilyCaps } from "./application/queries";
export { buildCombinedPdf, objectKeyFor, renderReportCard, requestRender, retryBatchRenders, sweepPendingRenders, type RenderOutcome } from "./application/render";
export { UNKNOWN_VERIFICATION, truncateIp, verifyByCode, verifyByFile, type FileVerification, type PublicVerification, type VerificationStatus } from "./application/verify";
export { checkIntegrity, type IntegrityReport } from "./application/integrity";
export {
  createSignatory,
  getBranding,
  getReportcardsSettings,
  listAvailableTemplates,
  listSignatories,
  listTemplateConfigs,
  previewTemplate,
  putBranding,
  putTemplateConfig,
  updateReportcardsSettings,
  updateSignatory,
} from "./application/reference";
export {
  ensureBuiltinTemplates,
  ensureSigningKeyRegistered,
  listAllPlatformTemplates,
  listPublicKeys,
  publishPlatformTemplate,
  retirePlatformTemplate,
  retireSigningKey,
  validatePlatformTemplate,
} from "./application/platform";

// Port générique de scellement / rendu pour 019 (diplômes, attestations) et 032 (bulletin de paie)
export { registerVerificationFor, renderDocumentPdf, sealDocument, type RenderDocumentInput, type SealedDocument } from "./application/documents";

// Domaine : événements, codes d'erreur, canonisation, signature, QR, moteur de gabarit
export { ALL_REPORTCARDS_EVENT_TYPES, ConsumedEvents, ReportcardsEvents } from "./domain/events";
export { ReportcardsCode, type ReportcardsCodeValue } from "./domain/errors";
export { canonicalJson, snapshotHash, sha256Hex, CanonicalizationError } from "./domain/canonical";
export { generateVerificationCode, isVerificationCode, publicKeyFingerprint, signDocument, signingMessage, verifyDocumentSignature } from "./domain/signing";
export { encodeQr, qrToSvg } from "./domain/qr";
export { buildSnapshot, resolveSignatories } from "./domain/snapshot";
export { parseTemplate, renderTemplate } from "./domain/template-engine";
export { validateTemplate } from "./domain/template-validation";
export { renderDocumentHtml, type RenderAssets } from "./domain/document-html";
export { BUILTIN_TEMPLATES } from "./templates/builtin";
export type {
  BatchRecord,
  Branding,
  FinalResultBundle,
  PeriodState,
  PlatformTemplate,
  RenderRecord,
  ReportCardRecord,
  ReportcardSnapshot,
  RosterEntry,
  Signatory,
  TemplateConfig,
} from "./domain/types";
