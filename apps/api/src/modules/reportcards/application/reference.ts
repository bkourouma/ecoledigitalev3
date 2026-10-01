/**
 * Identité, signataires, gabarits, configurations et réglages du tenant (spec 013 US5, AC5.2/5.3/5.5).
 * Toute modification est une NOUVELLE version (identité, configuration) ou une mise à jour datée (signataire) et est auditée.
 * Un bulletin déjà émis conserve la version utilisée : le snapshot a copié l'identité et les signataires.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { buildSnapshot, resolveSignatories, type ResolvedSignatory } from "../domain/snapshot";
import { ReportcardsCode, conflict, invalid, notFound } from "../domain/errors";
import { renderDocumentHtml } from "../domain/document-html";
import { resolveOptions } from "../domain/options-schema";
import { previewBundle } from "../domain/preview-data";
import type { Branding, DocumentKind, Pack, PlatformTemplate, ReportcardsSettings, Signatory, TemplateConfig, Uuid } from "../domain/types";
import { REPORTCARDS_PACK_LIST } from "../domain/constants";
import * as refRepo from "../infrastructure/reference-repository";
import { actorLabel, inTx, EventBuffer, type ReportcardsDeps } from "./deps";
import type { PreflightIssue } from "./context";
import { MAX_ASSET_BYTES, buildVerificationInfo, detectImageMime } from "./render-support";

const userOf = (ctx: RequestContext): string => ctx.userId ?? ctx.tenantId;

// ---------------------------------------------------------------------------
// Identité
// ---------------------------------------------------------------------------

export interface PutBrandingInput {
  institutionId?: Uuid | null;
  legalName: string;
  shortName?: string | null;
  headerLeft?: readonly string[];
  headerRight?: readonly string[];
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  registrationRef?: string | null;
  logoObjectKey?: string | null;
  emblemObjectKey?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  footerText?: string | null;
}

export async function getBranding(deps: ReportcardsDeps, ctx: RequestContext, input: { institutionId?: Uuid | null; history?: boolean }): Promise<Result<Branding[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (input.history) return ok(await refRepo.listBrandingVersions(tx, input.institutionId ?? null));
      const current = await refRepo.getCurrentBranding(tx, input.institutionId ?? null);
      return ok(current ? [current] : []);
    },
    { readOnly: true },
  );
}

async function assertObjectsExist(deps: ReportcardsDeps, keys: ReadonlyArray<[string, string | null | undefined]>): Promise<Result<void, AppError>> {
  for (const [what, key] of keys) {
    if (!key) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,299}$/.test(key) || key.includes("..")) return err(invalid(`Clé d'objet invalide (${what}).`, ReportcardsCode.ASSET_MISSING, { what }));
    // Le contenu est contrôlé par ses premiers octets (PNG, JPEG, GIF, WebP) : jamais de SVG, de HTML ni d'exécutable dans un document.
    const object = await deps.ports.storage.get(key);
    if (!object) return err(invalid(`Le fichier ${what} n'existe pas dans le stockage : déposez-le d'abord.`, ReportcardsCode.ASSET_MISSING, { what }));
    if (object.bytes.length > MAX_ASSET_BYTES) return err(invalid(`Le fichier ${what} dépasse 2 Mo.`, ReportcardsCode.ASSET_MISSING, { what }));
    if (!detectImageMime(object.bytes)) return err(invalid(`Le fichier ${what} doit être une image PNG, JPEG, GIF ou WebP.`, ReportcardsCode.ASSET_MISSING, { what }));
  }
  return ok(undefined);
}

export async function putBranding(deps: ReportcardsDeps, ctx: RequestContext, input: PutBrandingInput): Promise<Result<Branding, AppError>> {
  const assets = await assertObjectsExist(deps, [["logo", input.logoObjectKey], ["emblème", input.emblemObjectKey]]);
  if (!assets.ok) return assets;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const previous = await refRepo.getCurrentBranding(tx, input.institutionId ?? null);
    const created = await refRepo.insertBrandingVersion(tx, {
      id: deps.newId(),
      tenantId: ctx.tenantId,
      institutionId: input.institutionId ?? null,
      legalName: input.legalName.trim(),
      shortName: input.shortName?.trim() || null,
      headerLeft: input.headerLeft ?? [],
      headerRight: input.headerRight ?? [],
      address: input.address?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      website: input.website?.trim() || null,
      registrationRef: input.registrationRef?.trim() || null,
      logoObjectKey: input.logoObjectKey ?? null,
      emblemObjectKey: input.emblemObjectKey ?? null,
      primaryColor: input.primaryColor ?? null,
      secondaryColor: input.secondaryColor ?? null,
      footerText: input.footerText?.trim() || null,
      createdBy: userOf(ctx),
    });
    events.audit({
      action: "reportcards.branding.updated",
      resourceType: "branding",
      resourceId: created.id,
      sensitive: true,
      before: previous ? { version: previous.version, legalName: previous.legalName } : null,
      after: { version: created.version, legalName: created.legalName, institutionId: created.institutionId },
    });
    await events.flush(tx);
    return ok(created);
  });
}

// ---------------------------------------------------------------------------
// Signataires
// ---------------------------------------------------------------------------

export async function listSignatories(deps: ReportcardsDeps, ctx: RequestContext, input: { activeOnly?: boolean } = {}): Promise<Result<Signatory[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await refRepo.listSignatories(tx, input)), { readOnly: true });
}

export interface SignatoryInput {
  institutionId?: Uuid | null;
  fullName: string;
  title?: string | null;
  jobFunction?: string | null;
  signatureObjectKey?: string | null;
  staffId?: Uuid | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export async function createSignatory(deps: ReportcardsDeps, ctx: RequestContext, input: SignatoryInput): Promise<Result<Signatory, AppError>> {
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) return err(invalid("La fin de mandat précède son début.", ReportcardsCode.SIGNATORY_NOT_FOUND));
  const assets = await assertObjectsExist(deps, [["signature", input.signatureObjectKey]]);
  if (!assets.ok) return assets;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const created = await refRepo.insertSignatory(tx, {
      id: deps.newId(),
      tenantId: ctx.tenantId,
      institutionId: input.institutionId ?? null,
      fullName: input.fullName.trim(),
      title: input.title?.trim() || null,
      jobFunction: input.jobFunction?.trim() || null,
      signatureObjectKey: input.signatureObjectKey ?? null,
      staffId: input.staffId ?? null,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      createdBy: userOf(ctx),
    });
    events.audit({ action: "reportcards.signatory.created", resourceType: "signatory", resourceId: created.id, sensitive: true, after: { fullName: created.fullName, title: created.title } });
    await events.flush(tx);
    return ok(created);
  });
}

export async function updateSignatory(
  deps: ReportcardsDeps,
  ctx: RequestContext,
  input: { signatoryId: Uuid; patch: Partial<SignatoryInput> & { active?: boolean } },
): Promise<Result<Signatory, AppError>> {
  const assets = await assertObjectsExist(deps, [["signature", input.patch.signatureObjectKey]]);
  if (!assets.ok) return assets;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const current = await refRepo.getSignatory(tx, input.signatoryId);
    if (!current) return err(notFound("Signataire", input.signatoryId));
    const p = input.patch;
    const next = {
      fullName: p.fullName !== undefined ? p.fullName.trim() : current.fullName,
      title: p.title !== undefined ? p.title?.trim() || null : current.title,
      jobFunction: p.jobFunction !== undefined ? p.jobFunction?.trim() || null : current.jobFunction,
      signatureObjectKey: p.signatureObjectKey !== undefined ? p.signatureObjectKey : current.signatureObjectKey,
      staffId: p.staffId !== undefined ? p.staffId : current.staffId,
      active: p.active !== undefined ? p.active : current.active,
      validFrom: p.validFrom !== undefined ? p.validFrom : current.validFrom,
      validTo: p.validTo !== undefined ? p.validTo : current.validTo,
    };
    if (next.validFrom && next.validTo && next.validTo < next.validFrom) return err(invalid("La fin de mandat précède son début.", ReportcardsCode.SIGNATORY_NOT_FOUND));
    const updated = await refRepo.updateSignatory(tx, current.id, { ...next, updatedAt: deps.clock.now() });
    events.audit({
      action: "reportcards.signatory.updated",
      resourceType: "signatory",
      resourceId: updated.id,
      sensitive: true,
      before: { fullName: current.fullName, title: current.title, active: current.active },
      after: { fullName: updated.fullName, title: updated.title, active: updated.active },
    });
    await events.flush(tx);
    return ok(updated);
  });
}

// ---------------------------------------------------------------------------
// Gabarits et configurations
// ---------------------------------------------------------------------------

export async function listAvailableTemplates(deps: ReportcardsDeps, ctx: RequestContext): Promise<Result<PlatformTemplate[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await refRepo.listPlatformTemplates(tx, { status: "PUBLISHED" })), { readOnly: true });
}

export async function listTemplateConfigs(deps: ReportcardsDeps, ctx: RequestContext, input: { institutionId?: Uuid | null; documentKind?: DocumentKind; history?: boolean }): Promise<Result<TemplateConfig[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await refRepo.listTemplateConfigs(tx, input)), { readOnly: true });
}

export interface PutTemplateConfigInput {
  institutionId?: Uuid | null;
  documentKind: DocumentKind;
  pack: Pack;
  templateKey: string;
  templateVersion?: number;
  options?: Record<string, unknown>;
  signatureAssignments?: ReadonlyArray<{ slot: string; signatoryId: Uuid }>;
}

/**
 * Enregistre une NOUVELLE version de configuration : le gabarit doit exister, être PUBLIÉ (pas retiré) et de la bonne nature ;
 * les options sont validées par son schéma et enregistrées RÉSOLUES (défauts appliqués) ; chaque emplacement de signature
 * pointe un signataire actif existant. Un bulletin déjà émis garde la version qu'il a utilisée.
 */
export async function putTemplateConfig(deps: ReportcardsDeps, ctx: RequestContext, input: PutTemplateConfigInput): Promise<Result<TemplateConfig, AppError>> {
  if (!REPORTCARDS_PACK_LIST.includes(input.pack)) return err(invalid("Pack inconnu.", ReportcardsCode.INVALID_TEMPLATE));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const template = await refRepo.getPlatformTemplate(tx, input.templateKey, input.templateVersion);
    if (!template) return err(notFound("Modèle de document", input.templateKey));
    if (template.status !== "PUBLISHED") return err(conflict("Ce modèle de document est retiré : choisissez une version en vigueur.", ReportcardsCode.TEMPLATE_NOT_FOUND));
    if (template.documentKind !== input.documentKind) return err(invalid(`Ce modèle est prévu pour « ${template.documentKind} », pas « ${input.documentKind} ».`, ReportcardsCode.INVALID_TEMPLATE));
    const resolved = resolveOptions(template.optionsSchema, input.options ?? {});
    if (!resolved.ok) return err(invalid("Options du modèle invalides.", ReportcardsCode.INVALID_OPTIONS, { problems: resolved.problems }));
    const assignments = input.signatureAssignments ?? [];
    const slots = new Set(template.signatureSlots.map((s) => s.slot));
    const seen = new Set<string>();
    for (const a of assignments) {
      if (!slots.has(a.slot)) return err(invalid(`L'emplacement de signature « ${a.slot} » n'existe pas dans ce modèle.`, ReportcardsCode.INVALID_OPTIONS, { slot: a.slot }));
      if (seen.has(a.slot)) return err(invalid(`L'emplacement « ${a.slot} » est affecté deux fois.`, ReportcardsCode.INVALID_OPTIONS, { slot: a.slot }));
      seen.add(a.slot);
      const s = await refRepo.getSignatory(tx, a.signatoryId);
      if (!s) return err(notFound("Signataire", a.signatoryId));
      if (!s.active) return err(conflict(`Le signataire de l'emplacement « ${a.slot} » est désactivé.`, ReportcardsCode.SIGNATORY_MISSING, { slot: a.slot }));
    }
    const previous = await refRepo.getCurrentTemplateConfig(tx, { institutionId: input.institutionId ?? null, documentKind: input.documentKind, pack: input.pack });
    const created = await refRepo.insertTemplateConfig(tx, {
      id: deps.newId(),
      tenantId: ctx.tenantId,
      institutionId: input.institutionId ?? null,
      documentKind: input.documentKind,
      pack: input.pack,
      templateKey: template.key,
      templateVersion: template.version,
      options: resolved.value,
      signatureAssignments: assignments,
      createdBy: userOf(ctx),
    });
    events.audit({
      action: "reportcards.template_config.updated",
      resourceType: "template_config",
      resourceId: created.id,
      before: previous ? { configVersion: previous.configVersion, template: `${previous.templateKey}@${previous.templateVersion}` } : null,
      after: { configVersion: created.configVersion, template: `${created.templateKey}@${created.templateVersion}`, documentKind: created.documentKind, pack: created.pack },
    });
    await events.flush(tx);
    return ok(created);
  });
}

// ---------------------------------------------------------------------------
// Aperçu sur données fictives (AC5.3)
// ---------------------------------------------------------------------------

export interface PreviewInput {
  documentKind: DocumentKind;
  pack: Pack;
  institutionId?: Uuid | null;
  templateKey?: string;
  templateVersion?: number;
  options?: Record<string, unknown>;
  pdf?: boolean;
}

export interface PreviewResult {
  html: string;
  pdf: Uint8Array | null;
  templateKey: string;
  templateVersion: number;
}

/** Aperçu : jamais d'élève réel (données fictives), jamais enregistré, jamais signé ni vérifiable (document provisoire). */
export async function previewTemplate(deps: ReportcardsDeps, ctx: RequestContext, input: PreviewInput): Promise<Result<PreviewResult, AppError>> {
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const config = await refRepo.getCurrentTemplateConfig(tx, { institutionId: input.institutionId ?? null, documentKind: input.documentKind, pack: input.pack });
      const key = input.templateKey ?? config?.templateKey;
      if (!key) return err(conflict("Aucun modèle n'est configuré : choisissez-en un pour l'aperçu.", ReportcardsCode.TEMPLATE_CONFIG_MISSING));
      const version = input.templateVersion ?? (input.templateKey && input.templateKey !== config?.templateKey ? undefined : config?.templateVersion);
      const template = await refRepo.getPlatformTemplate(tx, key, version);
      if (!template) return err(notFound("Modèle de document", key));
      if (template.documentKind !== input.documentKind) return err(invalid("Nature de document incompatible avec ce modèle.", ReportcardsCode.INVALID_TEMPLATE));
      const resolved = resolveOptions(template.optionsSchema, input.options ?? (input.templateKey && input.templateKey !== config?.templateKey ? {} : config?.options ?? {}));
      if (!resolved.ok) return err(invalid("Options du modèle invalides.", ReportcardsCode.INVALID_OPTIONS, { problems: resolved.problems }));
      const branding = await refRepo.getCurrentBranding(tx, input.institutionId ?? null);
      const signatories = await refRepo.listSignatories(tx, { activeOnly: true });
      return ok({ template, options: resolved.value, branding, signatories, assignments: config?.signatureAssignments ?? [], configVersion: config?.configVersion ?? 1 });
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const { template, options, branding, signatories, assignments, configVersion } = loaded.value;

  // Identité : celle du tenant si elle existe, sinon un libellé manifestement fictif (jamais un nom réel).
  const preview: Branding = branding ?? {
    id: ctx.tenantId, institutionId: null, version: 1, isCurrent: true, legalName: "Établissement exemple", shortName: null, headerLeft: ["Texte officiel exemple"], headerRight: ["Texte officiel exemple"],
    address: null, phone: null, email: null, website: null, registrationRef: null, logoObjectKey: null, emblemObjectKey: null, primaryColor: null, secondaryColor: null, footerText: null, createdAt: deps.clock.now(),
  };
  const { resolved } = resolveSignatories({ slots: template.signatureSlots, assignments, signatories, onDate: "9999-12-31" });
  const fake: ResolvedSignatory[] = template.signatureSlots.map(
    (slot) => resolved.find((r) => r.slot === slot.slot) ?? { slot: slot.slot, slotLabel: slot.label, name: "Signataire exemple", title: "Fonction exemple", jobFunction: null, signatureKey: null },
  ).map((s) => ({ ...s, signatureKey: null }));

  const built = buildSnapshot({
    kind: input.documentKind,
    scope: input.documentKind === "TRANSCRIPT" ? "CUMULATIVE" : "PERIOD",
    version: 1,
    provisional: true,
    issuedAt: deps.clock.now(),
    issuedBy: { id: null, name: await actorLabel(deps, ctx) },
    bundle: previewBundle(input.pack, input.documentKind),
    branding: { ...preview, logoObjectKey: null, emblemObjectKey: null },
    signatories: fake,
    template: { key: template.key, version: template.version, configVersion, options },
  });
  if (!built.ok) return err(invalid("Aperçu impossible.", ReportcardsCode.INVALID_SNAPSHOT, { issues: built.issues }));
  const html = renderDocumentHtml({ snapshot: built.snapshot, template: { body: template.body, css: template.css }, verification: buildVerificationInfo(deps, "A".repeat(26), true) });
  let pdf: Uint8Array | null = null;
  if (input.pdf && deps.ports.renderer) {
    pdf = (await deps.ports.renderer.render({ html, title: built.title, issuedAt: deps.clock.now() })).pdf;
  }
  return ok({ html, pdf, templateKey: template.key, templateVersion: template.version });
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export async function getReportcardsSettings(deps: ReportcardsDeps, ctx: RequestContext): Promise<Result<ReportcardsSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await refRepo.getSettings(tx)), { readOnly: true });
}

export async function updateReportcardsSettings(
  deps: ReportcardsDeps,
  ctx: RequestContext,
  patch: Partial<Omit<ReportcardsSettings, "updatedAt">>,
): Promise<Result<ReportcardsSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const before = await refRepo.getSettings(tx);
    const after = await refRepo.upsertSettings(tx, ctx.tenantId, ctx.userId, patch, deps.clock.now());
    events.audit({ action: "reportcards.settings.updated", resourceType: "settings", resourceId: ctx.tenantId, before, after, sensitive: true });
    await events.flush(tx);
    return ok(after);
  });
}

export type { PreflightIssue };
