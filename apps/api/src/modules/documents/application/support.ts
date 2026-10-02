/**
 * Aides communes des cas d'usage : acteur (liens résolus à chaque appel), paramètres et catégories de départ, quotas,
 * présentation (DTO) des documents, noms d'affichage en lot.
 */
import type { AppError, RequestContext } from "@ecoledigitale/kernel";
import { err, ok, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  DocumentCategoryDto,
  DocumentDetailDto,
  DocumentSettingsDto,
  DocumentSummaryDto,
  DocumentVersionDto,
  DocumentShareDto,
} from "@ecoledigitale/contracts/src/v2/documents";
import { effectiveAlertDays, expiryStatus, isoDay } from "../domain/expiry";
import { previewKindOf } from "../domain/file-policy";
import { canUploadSomewhere, resolveAccess, type Access } from "../domain/policy";
import type { Actor, ActorCaps, CategoryFacts, DocumentFacts, Uuid } from "../domain/types";
import * as docs from "../infrastructure/documents-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import * as sharesRepo from "../infrastructure/shares-repository";
import type { DocumentsDeps } from "./deps";
import { forbidden, DocumentsCode, notFound } from "../domain/errors";

/** Acteur : capacités RBAC transmises par la couche HTTP + liens relus à CHAQUE appel (jamais d'un jeton). */
export async function actorOf(deps: DocumentsDeps, ctx: RequestContext, caps: ActorCaps | undefined): Promise<Result<Actor, AppError>> {
  if (!ctx.userId) return err(forbidden(DocumentsCode.FORBIDDEN, "Une action documentaire est effectuée par un utilisateur identifié."));
  const links = await deps.ports.owners.resolveActorLinks(ctx);
  return ok({ userId: ctx.userId, caps: caps ?? {}, links });
}

export const todayOf = (deps: DocumentsDeps): string => isoDay(deps.clock.now());

/**
 * Paramètres du tenant ; à la PREMIÈRE lecture, crée la ligne et le jeu de catégories de départ (idempotent). Seule écriture
 * d'une lecture : documentée (spec 024 §2) et sans effet métier.
 */
export async function ensureDefaults(deps: DocumentsDeps, tx: Tx, ctx: RequestContext): Promise<settingsRepo.SettingsRow> {
  const now = deps.clock.now();
  const created = await settingsRepo.ensureSettingsRow(tx, ctx.tenantId, now);
  if (created) await settingsRepo.seedDefaultCategories(tx, ctx.tenantId, deps.newId, now);
  return settingsRepo.getSettings(tx, ctx.tenantId);
}

export const categoryFactsOf = (c: Pick<settingsRepo.CategoryRow, "id" | "kind" | "confidentiality" | "audienceOwner" | "audienceGuardians" | "ownerUpload" | "status">): CategoryFacts => ({
  id: c.id,
  kind: c.kind,
  confidentiality: c.confidentiality,
  audienceOwner: c.audienceOwner,
  audienceGuardians: c.audienceGuardians,
  ownerUpload: c.ownerUpload,
  status: c.status,
});

export const factsOf = (r: docs.DocumentRow): DocumentFacts => ({
  id: r.id,
  status: r.status,
  visibility: r.visibility,
  createdBy: r.createdBy,
  ownerType: r.ownerType,
  ownerId: r.ownerId,
  category: {
    id: r.categoryId,
    kind: r.kind,
    confidentiality: r.confidentiality,
    audienceOwner: r.audienceOwner,
    audienceGuardians: r.audienceGuardians,
    ownerUpload: r.ownerUpload,
    status: r.categoryStatus,
  },
  shareLevel: r.shareLevel,
  grantLevel: r.grantLevel,
});

/** Document visible de l'appelant ou 404 (un document invisible est INDISCERNABLE d'un document inexistant). */
export async function loadVisible(
  deps: DocumentsDeps,
  tx: Tx,
  ctx: RequestContext,
  actor: Actor,
  documentId: Uuid,
  options: { forUpdate?: boolean } = {},
): Promise<Result<{ row: docs.DocumentRow; access: Access }, AppError>> {
  const row = await docs.getDocument(tx, ctx.tenantId, documentId, actor.userId, deps.clock.now(), options);
  const missing = notFound(DocumentsCode.DOCUMENT_NOT_FOUND, "Document", documentId);
  if (!row) return err(missing);
  const access = resolveAccess(actor, factsOf(row));
  if (!access.view) return err(missing);
  return ok({ row, access });
}

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

/** Quota effectif = min(quota du plan, réglage de l'établissement). */
export const effectiveQuota = (planQuotaBytes: number, settings: settingsRepo.SettingsRow): number =>
  Math.min(planQuotaBytes, settings.storageQuotaBytes ?? planQuotaBytes);

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export const iso = (d: Date): string => d.toISOString();

export function settingsDto(s: settingsRepo.SettingsRow): DocumentSettingsDto {
  return {
    maxBytes: s.maxBytes,
    storageQuotaBytes: s.storageQuotaBytes,
    defaultAlertDays: s.defaultAlertDays,
    archiveRetentionDays: s.archiveRetentionDays,
    quarantineRetentionDays: s.quarantineRetentionDays,
    maxVersions: s.maxVersions,
    updatedAt: s.updatedAt ? iso(s.updatedAt) : null,
  };
}

export function categoryDto(c: settingsRepo.CategoryRow, actor: Actor, grantLevel: "READ" | "WRITE" | null, documentCount: number | null): DocumentCategoryDto {
  return {
    id: c.id,
    code: c.code,
    label: c.label,
    description: c.description,
    kind: c.kind,
    confidentiality: c.confidentiality,
    allowedExtensions: c.allowedExtensions as DocumentCategoryDto["allowedExtensions"],
    maxBytes: c.maxBytes,
    audienceOwner: c.audienceOwner,
    audienceGuardians: c.audienceGuardians,
    ownerUpload: c.ownerUpload,
    requiresExpiry: c.requiresExpiry,
    alertDays: c.alertDays,
    retentionDays: c.retentionDays,
    status: c.status,
    isSystem: c.isSystem,
    sortOrder: c.sortOrder,
    canUpload: canUploadSomewhere(actor, categoryFactsOf(c), grantLevel),
    documentCount,
  };
}

export function versionDto(v: docs.VersionRow, currentNo: number, names: ReadonlyMap<Uuid, string>): DocumentVersionDto {
  return {
    versionNo: v.versionNo,
    current: v.versionNo === currentNo,
    fileName: v.fileName,
    extension: v.extension,
    mime: v.mime,
    sizeBytes: v.sizeBytes,
    sha256: v.sha256,
    scanStatus: v.scanStatus,
    note: v.note,
    uploadedBy: v.uploadedBy,
    uploadedByName: names.get(v.uploadedBy) ?? null,
    createdAt: iso(v.createdAt),
    state: v.state,
    previewKind: v.state === "PURGED" ? "NONE" : previewKindOf(v.mime),
  };
}

export function shareDto(s: sharesRepo.ShareRow, names: ReadonlyMap<Uuid, string>, now: Date): DocumentShareDto {
  return {
    id: s.id,
    userId: s.userId,
    userName: names.get(s.userId) ?? null,
    level: s.level,
    expiresAt: s.expiresAt ? iso(s.expiresAt) : null,
    note: s.note,
    createdBy: s.createdBy,
    createdAt: iso(s.createdAt),
    revokedAt: s.revokedAt ? iso(s.revokedAt) : null,
    active: s.revokedAt === null && (s.expiresAt === null || s.expiresAt.getTime() > now.getTime()),
  };
}

export interface NameBook {
  readonly owners: ReadonlyMap<Uuid, string>;
  readonly users: ReadonlyMap<Uuid, string>;
}

/** Noms d'affichage en LOT et SÉQUENTIELS (un appel de port par type). */
export async function nameBook(
  deps: DocumentsDeps,
  ctx: RequestContext,
  rows: ReadonlyArray<{ ownerType: string; ownerId: Uuid | null; createdBy?: Uuid }>,
  extraUsers: readonly Uuid[] = [],
): Promise<NameBook> {
  const students = [...new Set(rows.filter((r) => r.ownerType === "STUDENT" && r.ownerId).map((r) => r.ownerId as Uuid))];
  const staff = [...new Set(rows.filter((r) => r.ownerType === "STAFF" && r.ownerId).map((r) => r.ownerId as Uuid))];
  const userIds = [...new Set([...rows.map((r) => r.createdBy).filter((u): u is Uuid => Boolean(u)), ...extraUsers])];
  const owners = new Map<Uuid, string>();
  if (students.length > 0) for (const [k, v] of await deps.ports.owners.ownerNames(ctx, "STUDENT", students)) owners.set(k, v);
  if (staff.length > 0) for (const [k, v] of await deps.ports.owners.ownerNames(ctx, "STAFF", staff)) owners.set(k, v);
  const users = userIds.length > 0 ? await deps.ports.owners.userNames(ctx, userIds) : new Map<Uuid, string>();
  return { owners, users };
}

export function summaryDto(
  r: docs.DocumentRow,
  access: Access,
  names: NameBook,
  settings: settingsRepo.SettingsRow,
  today: string,
): DocumentSummaryDto {
  const thresholds = effectiveAlertDays(r.alertDays, r.categoryAlertDays, settings.defaultAlertDays);
  const expiry = expiryStatus(r.expiresOn, today, thresholds);
  return {
    id: r.id,
    kind: r.kind,
    categoryId: r.categoryId,
    categoryCode: r.categoryCode,
    categoryLabel: r.categoryLabel,
    confidentiality: r.confidentiality,
    title: r.title,
    description: r.description,
    tags: r.tags,
    ownerType: r.ownerType,
    ownerId: r.ownerId,
    ownerName: r.ownerId ? (names.owners.get(r.ownerId) ?? null) : null,
    visibility: r.visibility,
    status: r.status,
    currentVersionNo: r.currentVersionNo,
    versionCount: r.versionCount,
    fileName: r.fileName,
    extension: r.extension,
    mime: r.mime,
    sizeBytes: r.sizeBytes,
    previewKind: r.purgedAt ? "NONE" : previewKindOf(r.mime),
    expiresOn: r.expiresOn,
    expiryState: expiry.state,
    daysToExpiry: expiry.daysToExpiry,
    createdBy: r.createdBy,
    createdByName: names.users.get(r.createdBy) ?? null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    access: { write: access.write, share: access.share, archive: access.archive, history: access.history, via: [...access.via] },
  };
}

export function detailDto(
  r: docs.DocumentRow,
  access: Access,
  names: NameBook,
  settings: settingsRepo.SettingsRow,
  today: string,
  versions: docs.VersionRow[],
  shares: sharesRepo.ShareRow[] | null,
  now: Date,
): DocumentDetailDto {
  return {
    ...summaryDto(r, access, names, settings, today),
    metadata: r.metadata,
    alertDays: r.alertDays,
    versions: versions.map((v) => versionDto(v, r.currentVersionNo, names.users)),
    shares: shares ? shares.map((s) => shareDto(s, names.users, now)) : null,
    archivedAt: r.archivedAt ? iso(r.archivedAt) : null,
    archiveReason: r.archiveReason,
    purgeAfter: r.purgeAfter ? iso(r.purgeAfter) : null,
  };
}

/** Curseur opaque (base64url JSON). */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
