/**
 * Catégories configurables, droits de catégorie par personne, paramètres d'établissement, usage et contexte de l'appelant.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  DOCUMENT_SUPPORTED_EXTENSIONS,
  type DocumentCategoryDto,
  type DocumentCategoryGrantDto,
  type DocumentCreateCategoryBody,
  type DocumentGrantBody,
  type DocumentMyContextDto,
  type DocumentSettingsDto,
  type DocumentUpdateCategoryBody,
  type DocumentUpdateSettingsBody,
  type DocumentUsageDto,
} from "@ecoledigitale/contracts/src/v2/documents";
import { normalizeAlertDays } from "../domain/descriptors";
import { conflict, DocumentsCode, forbidden, notFound, validation } from "../domain/errors";
import type { ActorCaps, DocumentKind, Uuid } from "../domain/types";
import * as docs from "../infrastructure/documents-repository";
import * as repo from "../infrastructure/settings-repository";
import * as sharesRepo from "../infrastructure/shares-repository";
import { EventBuffer, inTx, type DocumentsDeps } from "./deps";
import { actorOf, categoryDto, effectiveQuota, ensureDefaults, iso, settingsDto } from "./support";

const supported = new Set<string>(DOCUMENT_SUPPORTED_EXTENSIONS);

function checkCategoryRules(input: { kind: DocumentKind; audienceOwner: boolean; audienceGuardians: boolean; ownerUpload: boolean; allowedExtensions: readonly string[] }): AppError | null {
  const unknown = input.allowedExtensions.filter((e) => !supported.has(e));
  if (unknown.length > 0) return validation(DocumentsCode.INVALID_INPUT, `Extensions non prises en charge : ${unknown.join(", ")}.`, "allowedExtensions");
  if (input.kind === "INSTITUTION" && (input.audienceOwner || input.audienceGuardians || input.ownerUpload)) {
    return validation(DocumentsCode.INVALID_INPUT, "Un document d'établissement n'a ni propriétaire ni tuteur : aucune audience propriétaire.", "audienceOwner");
  }
  if (input.kind === "TEACHER" && input.audienceGuardians) {
    return validation(DocumentsCode.INVALID_INPUT, "Les tuteurs d'élèves n'accèdent pas aux documents du personnel.", "audienceGuardians");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

export async function listCategories(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; kind?: DocumentKind | undefined; includeArchived?: boolean }): Promise<Result<DocumentCategoryDto[], AppError>> {
  const actor = await actorOf(deps, ctx, input.caps);
  if (!actor.ok) return actor;
  return inTx(deps, ctx, async (tx) => {
    await ensureDefaults(deps, tx, ctx);
    const includeArchived = input.includeArchived === true && (actor.value.caps.categoryManage === true || actor.value.caps.manage === true);
    const rows = await repo.listCategories(tx, ctx.tenantId, { kind: input.kind, includeArchived });
    const grants = await repo.activeGrantLevels(tx, ctx.tenantId, actor.value.userId, deps.clock.now());
    const manager = actor.value.caps.categoryManage === true || actor.value.caps.manage === true;
    const counts = manager ? await repo.countDocumentsByCategory(tx, ctx.tenantId) : null;
    return ok(rows.map((c) => categoryDto(c, actor.value, grants.get(c.id) ?? null, counts ? (counts.get(c.id) ?? 0) : null)));
  });
}

export async function createCategory(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; body: DocumentCreateCategoryBody }): Promise<Result<DocumentCategoryDto, AppError>> {
  const actor = await actorOf(deps, ctx, input.caps);
  if (!actor.ok) return actor;
  const b = input.body;
  const invalid = checkCategoryRules({ kind: b.kind, audienceOwner: b.audienceOwner, audienceGuardians: b.audienceGuardians, ownerUpload: b.ownerUpload, allowedExtensions: b.allowedExtensions });
  if (invalid) return err(invalid);
  return inTx(deps, ctx, async (tx) => {
    await ensureDefaults(deps, tx, ctx);
    const id = deps.newId();
    const inserted = await repo.insertCategory(
      tx,
      ctx.tenantId,
      {
        id, code: b.code, label: b.label, description: b.description ?? null, kind: b.kind, confidentiality: b.confidentiality, allowedExtensions: [...new Set(b.allowedExtensions)],
        maxBytes: b.maxBytes ?? null, audienceOwner: b.audienceOwner, audienceGuardians: b.audienceGuardians, ownerUpload: b.ownerUpload, requiresExpiry: b.requiresExpiry,
        alertDays: normalizeAlertDays(b.alertDays), retentionDays: b.retentionDays ?? null, sortOrder: b.sortOrder,
      },
      deps.clock.now(),
    );
    if (!inserted) return err(conflict(DocumentsCode.CATEGORY_CODE_TAKEN, `Le code « ${b.code} » est déjà utilisé par une catégorie.`));
    const row = await repo.getCategory(tx, ctx.tenantId, id);
    if (!row) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", id));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "documents.category.created", resourceType: "document_category", resourceId: id, after: { code: b.code, kind: b.kind, confidentiality: b.confidentiality } });
    await events.flush(tx);
    return ok(categoryDto(row, actor.value, null, 0));
  });
}

export async function updateCategory(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; id: Uuid; body: DocumentUpdateCategoryBody }): Promise<Result<DocumentCategoryDto, AppError>> {
  const actor = await actorOf(deps, ctx, input.caps);
  if (!actor.ok) return actor;
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.getCategory(tx, ctx.tenantId, input.id, { forUpdate: true });
    if (!row) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", input.id));
    const b = input.body;
    const merged = {
      kind: row.kind,
      audienceOwner: b.audienceOwner ?? row.audienceOwner,
      audienceGuardians: b.audienceGuardians ?? row.audienceGuardians,
      ownerUpload: b.ownerUpload ?? row.ownerUpload,
      allowedExtensions: b.allowedExtensions ?? row.allowedExtensions,
    };
    const invalid = checkCategoryRules(merged);
    if (invalid) return err(invalid);
    await repo.updateCategory(
      tx,
      ctx.tenantId,
      input.id,
      {
        ...(b.label !== undefined ? { label: b.label } : {}),
        ...(b.description !== undefined ? { description: b.description } : {}),
        ...(b.confidentiality !== undefined ? { confidentiality: b.confidentiality } : {}),
        ...(b.allowedExtensions !== undefined ? { allowedExtensions: [...new Set(b.allowedExtensions)] } : {}),
        ...(b.maxBytes !== undefined ? { maxBytes: b.maxBytes } : {}),
        ...(b.audienceOwner !== undefined ? { audienceOwner: b.audienceOwner } : {}),
        ...(b.audienceGuardians !== undefined ? { audienceGuardians: b.audienceGuardians } : {}),
        ...(b.ownerUpload !== undefined ? { ownerUpload: b.ownerUpload } : {}),
        ...(b.requiresExpiry !== undefined ? { requiresExpiry: b.requiresExpiry } : {}),
        ...(b.alertDays !== undefined ? { alertDays: normalizeAlertDays(b.alertDays) } : {}),
        ...(b.retentionDays !== undefined ? { retentionDays: b.retentionDays } : {}),
        ...(b.sortOrder !== undefined ? { sortOrder: b.sortOrder } : {}),
      },
      deps.clock.now(),
    );
    const after = await repo.getCategory(tx, ctx.tenantId, input.id);
    if (!after) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", input.id));
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "documents.category.updated",
      resourceType: "document_category",
      resourceId: input.id,
      // Changer le niveau d'une catégorie change aussitôt qui voit ses documents : acte sensible.
      sensitive: b.confidentiality !== undefined && b.confidentiality !== row.confidentiality,
      before: { confidentiality: row.confidentiality, audienceOwner: row.audienceOwner, audienceGuardians: row.audienceGuardians, allowedExtensions: row.allowedExtensions },
      after: { confidentiality: after.confidentiality, audienceOwner: after.audienceOwner, audienceGuardians: after.audienceGuardians, allowedExtensions: after.allowedExtensions },
    });
    await events.flush(tx);
    const grant = await repo.activeGrantLevels(tx, ctx.tenantId, actor.value.userId, deps.clock.now());
    return ok(categoryDto(after, actor.value, grant.get(after.id) ?? null, await repo.countDocumentsInCategory(tx, ctx.tenantId, after.id)));
  });
}

export async function setCategoryArchived(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; id: Uuid; archived: boolean }): Promise<Result<DocumentCategoryDto, AppError>> {
  const actor = await actorOf(deps, ctx, input.caps);
  if (!actor.ok) return actor;
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.getCategory(tx, ctx.tenantId, input.id, { forUpdate: true });
    if (!row) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", input.id));
    await repo.setCategoryStatus(tx, ctx.tenantId, input.id, input.archived ? "ARCHIVED" : "ACTIVE", deps.clock.now());
    const after = await repo.getCategory(tx, ctx.tenantId, input.id);
    if (!after) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", input.id));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: input.archived ? "documents.category.archived" : "documents.category.restored", resourceType: "document_category", resourceId: input.id });
    await events.flush(tx);
    return ok(categoryDto(after, actor.value, null, await repo.countDocumentsInCategory(tx, ctx.tenantId, after.id)));
  });
}

// ---------------------------------------------------------------------------
// Droits de catégorie par personne
// ---------------------------------------------------------------------------

function grantDto(g: repo.GrantRow, names: ReadonlyMap<Uuid, string>, now: Date): DocumentCategoryGrantDto {
  return {
    id: g.id,
    categoryId: g.categoryId,
    userId: g.userId,
    userName: names.get(g.userId) ?? null,
    level: g.level,
    expiresAt: g.expiresAt ? iso(g.expiresAt) : null,
    note: g.note,
    createdBy: g.createdBy,
    createdAt: iso(g.createdAt),
    revokedAt: g.revokedAt ? iso(g.revokedAt) : null,
    active: g.revokedAt === null && (g.expiresAt === null || g.expiresAt.getTime() > now.getTime()),
  };
}

export async function listCategoryGrants(deps: DocumentsDeps, ctx: RequestContext, input: { categoryId: Uuid }): Promise<Result<DocumentCategoryGrantDto[], AppError>> {
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const category = await repo.getCategory(tx, ctx.tenantId, input.categoryId);
      if (!category) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", input.categoryId));
      return ok(await repo.listGrants(tx, ctx.tenantId, input.categoryId));
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const names = loaded.value.length > 0 ? await deps.ports.owners.userNames(ctx, [...new Set(loaded.value.map((g) => g.userId))]) : new Map<Uuid, string>();
  const now = deps.clock.now();
  return ok(loaded.value.map((g) => grantDto(g, names, now)));
}

export async function grantCategory(deps: DocumentsDeps, ctx: RequestContext, input: { categoryId: Uuid; body: DocumentGrantBody }): Promise<Result<DocumentCategoryGrantDto, AppError>> {
  const by = ctx.userId;
  if (!by) return err(forbidden(DocumentsCode.FORBIDDEN, "Utilisateur identifié requis."));
  const now = deps.clock.now();
  const expiresAt = input.body.expiresAt ? new Date(input.body.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return err(validation(DocumentsCode.SHARE_INVALID, "La date de fin doit être dans le futur.", "expiresAt"));
  const known = await deps.ports.owners.userNames(ctx, [input.body.userId]);
  if (!known.has(input.body.userId)) return err(validation(DocumentsCode.SHARE_INVALID, "Personne inconnue de l'établissement.", "userId"));
  return inTx(deps, ctx, async (tx) => {
    const category = await repo.getCategory(tx, ctx.tenantId, input.categoryId, { forUpdate: true });
    if (!category) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", input.categoryId));
    // Un droit expiré mais non marqué laisse la place ; un droit actif est REMPLACÉ (niveau / durée mis à jour).
    const active = await repo.getActiveGrantOfUser(tx, ctx.tenantId, input.categoryId, input.body.userId, now);
    if (active) await repo.revokeGrant(tx, ctx.tenantId, active.id, by, now);
    await tx.query(`UPDATE documents.category_grants SET revoked_at = $4, revoked_by = $5 WHERE tenant_id = $1 AND category_id = $2 AND user_id = $3 AND revoked_at IS NULL AND expires_at <= $4`, [ctx.tenantId, input.categoryId, input.body.userId, now, by]);
    const id = deps.newId();
    await repo.insertGrant(tx, ctx.tenantId, { id, categoryId: input.categoryId, userId: input.body.userId, level: input.body.level, expiresAt, note: input.body.note ?? null, createdBy: by }, now);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "documents.category.granted", resourceType: "document_category", resourceId: input.categoryId, sensitive: true, after: { userId: input.body.userId, level: input.body.level, expiresAt: expiresAt?.toISOString() ?? null } });
    await events.flush(tx);
    const created = (await repo.listGrants(tx, ctx.tenantId, input.categoryId)).find((g) => g.id === id);
    if (!created) return err(notFound(DocumentsCode.GRANT_NOT_FOUND, "Droit de catégorie", id));
    return ok(grantDto(created, known, now));
  });
}

export async function revokeCategoryGrant(deps: DocumentsDeps, ctx: RequestContext, input: { categoryId: Uuid; grantId: Uuid }): Promise<Result<true, AppError>> {
  const by = ctx.userId;
  if (!by) return err(forbidden(DocumentsCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const grant = await repo.getGrant(tx, ctx.tenantId, input.categoryId, input.grantId);
    if (!grant) return err(notFound(DocumentsCode.GRANT_NOT_FOUND, "Droit de catégorie", input.grantId));
    if (grant.revokedAt === null) {
      await repo.revokeGrant(tx, ctx.tenantId, grant.id, by, deps.clock.now());
      const events = new EventBuffer(deps, ctx);
      events.audit({ action: "documents.category.grant_revoked", resourceType: "document_category", resourceId: input.categoryId, sensitive: true, before: { userId: grant.userId, level: grant.level } });
      await events.flush(tx);
    }
    return ok(true as const);
  });
}

// ---------------------------------------------------------------------------
// Paramètres, usage, contexte
// ---------------------------------------------------------------------------

export async function getSettings(deps: DocumentsDeps, ctx: RequestContext): Promise<Result<DocumentSettingsDto, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(settingsDto(await ensureDefaults(deps, tx, ctx))));
}

export async function updateSettings(deps: DocumentsDeps, ctx: RequestContext, input: { body: DocumentUpdateSettingsBody }): Promise<Result<DocumentSettingsDto, AppError>> {
  const by = ctx.userId;
  if (!by) return err(forbidden(DocumentsCode.FORBIDDEN, "Utilisateur identifié requis."));
  const plan = await deps.ports.planQuota(ctx);
  const b = input.body;
  if (b.storageQuotaBytes !== undefined && b.storageQuotaBytes !== null && b.storageQuotaBytes > plan) {
    return err(validation(DocumentsCode.INVALID_INPUT, "Le quota de l'établissement ne peut pas dépasser celui de l'abonnement.", "storageQuotaBytes", { planQuotaBytes: plan }));
  }
  return inTx(deps, ctx, async (tx) => {
    const current = await ensureDefaults(deps, tx, ctx);
    const next: repo.SettingsRow = {
      ...current,
      ...(b.maxBytes !== undefined ? { maxBytes: b.maxBytes } : {}),
      ...(b.storageQuotaBytes !== undefined ? { storageQuotaBytes: b.storageQuotaBytes } : {}),
      ...(b.defaultAlertDays !== undefined ? { defaultAlertDays: normalizeAlertDays(b.defaultAlertDays) ?? current.defaultAlertDays } : {}),
      ...(b.archiveRetentionDays !== undefined ? { archiveRetentionDays: b.archiveRetentionDays } : {}),
      ...(b.quarantineRetentionDays !== undefined ? { quarantineRetentionDays: b.quarantineRetentionDays } : {}),
      ...(b.maxVersions !== undefined ? { maxVersions: b.maxVersions } : {}),
    };
    const now = deps.clock.now();
    await repo.updateSettingsRow(tx, ctx.tenantId, next, by, now);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "documents.settings.updated", resourceType: "document_settings", resourceId: ctx.tenantId, before: settingsDto(current), after: settingsDto({ ...next, updatedAt: now }) });
    await events.flush(tx);
    return ok(settingsDto({ ...next, updatedAt: now }));
  });
}

export async function getUsage(deps: DocumentsDeps, ctx: RequestContext): Promise<Result<DocumentUsageDto, AppError>> {
  const plan = await deps.ports.planQuota(ctx);
  return inTx(deps, ctx, async (tx) => {
    const settings = await ensureDefaults(deps, tx, ctx);
    const usage = await docs.usageCounts(tx, ctx.tenantId);
    const held = await sharesRepo.countHeldQuarantine(tx, ctx.tenantId);
    return ok({ usedBytes: usage.usedBytes, quotaBytes: effectiveQuota(plan, settings), planQuotaBytes: plan, documentCount: usage.documentCount, versionCount: usage.versionCount, quarantineHeldCount: held, archivedCount: usage.archivedCount });
  });
}

export async function getMyContext(
  deps: DocumentsDeps,
  ctx: RequestContext,
  input: { caps?: ActorCaps; officePreview: boolean },
): Promise<Result<DocumentMyContextDto, AppError>> {
  const actor = await actorOf(deps, ctx, input.caps);
  if (!actor.ok) return actor;
  const c = actor.value.caps;
  const settings = await inTx(deps, ctx, async (tx) => ok(await ensureDefaults(deps, tx, ctx)));
  if (!settings.ok) return settings;
  const scan = deps.ports.scan;
  const links = actor.value.links;
  const studentIds = [...(links.studentId ? [links.studentId] : []), ...links.childStudentIds];
  const studentNames = studentIds.length > 0 ? await deps.ports.owners.ownerNames(ctx, "STUDENT", studentIds) : new Map<Uuid, string>();
  const staffNames = links.staffId ? await deps.ports.owners.ownerNames(ctx, "STAFF", [links.staffId]) : new Map<Uuid, string>();
  const childNames = studentNames;
  const studentName = links.studentId ? (studentNames.get(links.studentId) ?? null) : null;
  const staffName = links.staffId ? (staffNames.get(links.staffId) ?? null) : null;
  return ok({
    caps: {
      read: c.read === true,
      readRestricted: c.readRestricted === true,
      readConfidential: c.readConfidential === true,
      upload: c.upload === true,
      share: c.share === true,
      archive: c.archive === true,
      manage: c.manage === true,
      historyRead: c.historyRead === true,
      categoryManage: c.categoryManage === true,
      settingsManage: c.settingsManage === true,
      quarantineManage: c.quarantineManage === true,
      childRead: c.childRead === true,
      childUpload: c.childUpload === true,
      selfRead: c.selfRead === true,
      selfUpload: c.selfUpload === true,
      ownRead: c.ownRead === true,
      ownUpload: c.ownUpload === true,
    },
    links: {
      studentId: actor.value.links.studentId,
      studentName: studentName,
      childStudentIds: [...actor.value.links.childStudentIds],
      children: actor.value.links.childStudentIds.map((id) => ({ id, displayName: childNames.get(id) ?? "Élève" })),
      staffId: actor.value.links.staffId,
      staffName: staffName,
    },
    upload: {
      defaultMaxBytes: Math.min(settings.value.maxBytes, deps.config.hardMaxBytes),
      hardMaxBytes: deps.config.hardMaxBytes,
      supportedExtensions: [...DOCUMENT_SUPPORTED_EXTENSIONS],
    },
    scanner: { enabled: scan.scanner !== null, failClosed: scan.scanner !== null && scan.failClosed },
    officePreview: input.officePreview && deps.ports.converter.enabled,
  });
}
