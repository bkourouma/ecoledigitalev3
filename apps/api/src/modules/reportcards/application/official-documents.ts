/**
 * Documents officiels d'AUTRES modules — reçu de paiement (finance), bulletin de paie (payroll) : instantané immuable ->
 * scellement (hash, code, signature Ed25519) -> PDF rendu DANS LE WORKER depuis le snapshot seul -> stockage `StoragePort` ->
 * authenticité par la page publique de vérification existante (QR sur le PDF).
 *
 *   requestOfficialDocument   scelle le contenu fourni par le module propriétaire, l'enregistre (unique par nature + source,
 *                             idempotent), l'inscrit dans l'index public et demande le rendu (événement outbox) ;
 *   renderOfficialDocument    abonné du worker : gabarit de plateforme + contexte scellé + images -> HTML -> PDF -> stockage ;
 *                             3 tentatives, puis `FAILED` avec la cause (reprise : `requestOfficialDocumentRender`) ;
 *   readOfficialDocument      état + octets du PDF (le module propriétaire a DÉJÀ contrôlé l'accès : titulaire ou gestion).
 *
 * Ce module ne décide JAMAIS qui a le droit de lire un document : c'est le module propriétaire (finance : titulaire du reçu ou
 * gestion ; payroll : titulaire du bulletin ou gestion) qui contrôle l'accès avant d'appeler ces fonctions, et l'adaptateur de
 * plateforme qui les relie. Le titre scellé est PUBLIÉ par la vérification : aucune donnée personnelle dedans.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import { sha256Hex } from "../domain/canonical";
import { DEFAULT_OFFICIAL_TEMPLATE, isOfficialDocumentKind, type OfficialDocumentKind } from "../domain/constants";
import { renderContextHtml } from "../domain/document-html";
import { ReportcardsCode, conflict, internal, invalid, notFound } from "../domain/errors";
import { ReportcardsEvents } from "../domain/events";
import type { PlatformTemplate, Uuid } from "../domain/types";
import * as cardsRepo from "../infrastructure/cards-repository";
import * as repo from "../infrastructure/official-documents-repository";
import { getCurrentBranding, getPlatformTemplate } from "../infrastructure/reference-repository";
import { sealDocument } from "./documents";
import { EventBuffer, inTx, type ReportcardsDeps } from "./deps";
import { ensureBuiltinTemplates, ensureSigningKeyRegistered } from "./platform";
import { buildVerificationInfo, loadInstitutionAssets } from "./render-support";

export const OFFICIAL_SNAPSHOT_SCHEMA = "official-document/1";
export const OFFICIAL_RENDER_ATTEMPTS = 3;

export type { OfficialDocumentRecord } from "../infrastructure/official-documents-repository";

export interface RequestOfficialDocumentInput {
  kind: OfficialDocumentKind;
  /** Objet source du module propriétaire (identifiant du reçu, du bulletin de paie). */
  sourceId: Uuid;
  /** Intitulé scellé ET publié par la vérification publique : jamais de donnée personnelle. */
  title: string;
  issuedAt: Date;
  /** Contenu figé du module propriétaire (JSON canonique : chaînes, ENTIERS, booléens, null — jamais de flottant). */
  content: Record<string, unknown>;
  /** Contexte d'impression dérivé du contenu (chaînes déjà mises en forme) : scellé avec lui. */
  context: Record<string, unknown>;
  templateKey?: string;
  institutionId?: Uuid | null;
}

export interface OfficialDocumentRequestResult {
  record: repo.OfficialDocumentRecord;
  /** Faux si le document existait déjà (demande idempotente : le contenu scellé n'est jamais réécrit). */
  created: boolean;
}

const truncate = (s: string, n = 500): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const messageOf = (e: unknown): string => truncate(e instanceof Error ? e.message : String(e));

export const officialObjectKeyFor = (tenantId: Uuid, documentId: Uuid): string => `reportcards/${tenantId}/documents/${documentId}.pdf`;

/** Scelle et enregistre un document officiel, puis demande son rendu. Idempotent par (tenant, nature, source). */
export async function requestOfficialDocument(deps: ReportcardsDeps, ctx: RequestContext, input: RequestOfficialDocumentInput): Promise<Result<OfficialDocumentRequestResult, AppError>> {
  if (!isOfficialDocumentKind(input.kind)) return err(invalid(`Nature de document inconnue (${String(input.kind)}).`, ReportcardsCode.UNKNOWN_DOCUMENT_KIND));
  if (!input.title.trim() || input.title.length > 200) return err(invalid("Intitulé de document invalide.", ReportcardsCode.INVALID_SNAPSHOT));
  const templateKey = input.templateKey ?? DEFAULT_OFFICIAL_TEMPLATE[input.kind];

  const existing = await inTx(deps, ctx, async (tx) => ok(await repo.getOfficialDocumentBySource(tx, input.kind, input.sourceId)), { readOnly: true });
  if (!existing.ok) return existing;
  if (existing.value) return ok({ record: existing.value, created: false });

  const key = await ensureSigningKeyRegistered(deps);
  if (!key.ok) return key;
  // Gabarit de plateforme (publié à l'approvisionnement du tenant ; amorçage paresseux pour les tenants plus anciens).
  let template: PlatformTemplate | null = await inTx(deps, ctx, async (tx) => ok(await getPlatformTemplate(tx, templateKey)), { readOnly: true }).then((r) => (r.ok ? r.value : null));
  if (!template) {
    const seeded = await ensureBuiltinTemplates(deps);
    if (!seeded.ok) return seeded;
    template = await inTx(deps, ctx, async (tx) => ok(await getPlatformTemplate(tx, templateKey)), { readOnly: true }).then((r) => (r.ok ? r.value : null));
  }
  if (!template) return err(internal("Le modèle de document est introuvable.", ReportcardsCode.TEMPLATE_NOT_FOUND, { templateKey }));
  if (template.documentKind !== input.kind) return err(invalid(`Ce modèle est prévu pour « ${template.documentKind} », pas « ${input.kind} ».`, ReportcardsCode.INVALID_TEMPLATE));

  try {
    return await inTx<OfficialDocumentRequestResult>(deps, ctx, async (tx) => {
      const again = await repo.getOfficialDocumentBySource(tx, input.kind, input.sourceId, { forUpdate: true });
      if (again) return ok({ record: again, created: false });
      const branding = await getCurrentBranding(tx, input.institutionId ?? null);
      if (!branding) {
        return err(conflict("L'identité de l'établissement (nom, mentions officielles, logo) n'est pas renseignée : le document ne peut pas être émis.", ReportcardsCode.BRANDING_MISSING));
      }
      const snapshot = {
        meta: { schema: OFFICIAL_SNAPSHOT_SCHEMA, kind: input.kind, title: input.title, issuedAt: input.issuedAt.toISOString(), sourceId: input.sourceId, locale: "fr" },
        template: { key: template!.key, version: template!.version },
        institution: {
          legalName: branding.legalName,
          shortName: branding.shortName,
          headerLeft: [...branding.headerLeft],
          headerRight: [...branding.headerRight],
          address: branding.address,
          phone: branding.phone,
          email: branding.email,
          website: branding.website,
          registrationRef: branding.registrationRef,
          logoKey: branding.logoObjectKey,
          emblemKey: branding.emblemObjectKey,
          primaryColor: branding.primaryColor,
          secondaryColor: branding.secondaryColor,
          footerText: branding.footerText,
          brandingVersion: branding.version,
        },
        content: input.content,
      };
      const sealed = sealDocument(deps, { kind: input.kind, snapshot, explain: input.context, issuedAt: input.issuedAt });
      if (!sealed.ok) return sealed;
      const id = deps.newId();
      const record = await repo.insertOfficialDocument(tx, {
        id,
        tenantId: ctx.tenantId,
        documentKind: input.kind,
        sourceId: input.sourceId,
        title: input.title,
        templateKey: template!.key,
        templateVersion: template!.version,
        snapshot,
        explain: input.context,
        snapshotHash: sealed.value.snapshotHash,
        verificationCode: sealed.value.verificationCode,
        signingKeyId: sealed.value.keyId,
        signature: sealed.value.signature,
        issuedAt: input.issuedAt,
        requestedBy: ctx.userId,
      });
      await cardsRepo.registerVerification(tx, { code: sealed.value.verificationCode, tenantId: ctx.tenantId, documentKind: input.kind, documentId: id });
      const events = new EventBuffer(deps, ctx);
      events.add(ReportcardsEvents.OFFICIAL_RENDER_REQUESTED, { v: 1, documentId: id, documentKind: input.kind, sourceId: input.sourceId }, { type: "official_document", id });
      events.audit({ action: "reportcards.official_document.sealed", resourceType: "official_document", resourceId: id, metadata: { kind: input.kind, sourceId: input.sourceId, snapshotHash: sealed.value.snapshotHash } });
      await events.flush(tx);
      return ok({ record, created: true });
    });
  } catch (e) {
    // Course : une autre requête a scellé le même document entre-temps (unicité tenant + nature + source) : on la relit.
    if (isUniqueViolation(e)) {
      const raced = await inTx(deps, ctx, async (tx) => ok(await repo.getOfficialDocumentBySource(tx, input.kind, input.sourceId)), { readOnly: true });
      if (raced.ok && raced.value) return ok({ record: raced.value, created: false });
    }
    throw e;
  }
}

export interface OfficialRenderInput {
  documentId: Uuid;
  /** Numéro de la tentative (1 = première) et maximum : fournis par la file du worker. */
  attempt?: number;
  maxAttempts?: number;
}

export interface OfficialRenderOutcome {
  documentId: Uuid;
  status: "RENDERED" | "ALREADY_RENDERED";
  pdfHash: string | null;
  sizeBytes: number | null;
}

/** Rendu PDF d'un document officiel (WORKER) : depuis le contenu scellé seul. Idempotent : un document déjà rendu est ignoré. */
export async function renderOfficialDocument(deps: ReportcardsDeps, ctx: RequestContext, input: OfficialRenderInput): Promise<Result<OfficialRenderOutcome, AppError>> {
  const renderer = deps.ports.renderer;
  if (!renderer) return err(internal("Le moteur de rendu PDF n'est pas disponible dans ce processus.", ReportcardsCode.PORT_UNAVAILABLE));
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? OFFICIAL_RENDER_ATTEMPTS;

  type Prepared =
    | { already: true; record: repo.OfficialDocumentRecord }
    | { already: false; record: repo.OfficialDocumentRecord; snapshot: any; explain: any; template: PlatformTemplate };
  const prepared = await inTx<Prepared>(deps, ctx, async (tx) => {
    const content = await repo.getOfficialDocumentContent(tx, input.documentId);
    if (!content) return err(notFound("Document", input.documentId));
    if (content.record.renderStatus === "RENDERED" && content.record.objectKey) return ok({ already: true, record: content.record });
    const template = await getPlatformTemplate(tx, content.record.templateKey, content.record.templateVersion);
    if (!template) return err(internal("Le gabarit utilisé par ce document est introuvable.", ReportcardsCode.TEMPLATE_NOT_FOUND));
    await repo.setOfficialRenderState(tx, content.record.id, { status: "RENDERING", attempts: attempt });
    return ok({ already: false, record: content.record, snapshot: content.snapshot, explain: content.explain, template });
  });
  if (!prepared.ok) return prepared;
  if (prepared.value.already) return ok({ documentId: prepared.value.record.id, status: "ALREADY_RENDERED", pdfHash: prepared.value.record.pdfHash, sizeBytes: prepared.value.record.sizeBytes });
  const { record, snapshot, explain, template } = prepared.value;

  let produced: { pdfHash: string; size: number; pages: number; objectKey: string } | null = null;
  let failure: AppError | null = null;
  try {
    const inst = snapshot.institution as Record<string, any>;
    const assets = await loadInstitutionAssets(deps, { logoKey: inst.logoKey ?? null, emblemKey: inst.emblemKey ?? null });
    if (!assets.ok) throw assets.error;
    const verification = buildVerificationInfo(deps, record.verificationCode, false);
    if (!verification) throw internal("Le domaine public de vérification n'est pas configuré : un document officiel ne peut pas être rendu sans QR.", ReportcardsCode.RENDER_FAILED);
    const contact = [inst.address, inst.phone ? `Tél : ${inst.phone}` : null, inst.email, inst.website].filter((x: unknown): x is string => typeof x === "string" && x.length > 0).join(" — ");
    const html = renderContextHtml({
      template: { body: template.body, css: template.css },
      context: {
        ...(explain as Record<string, unknown>),
        title: record.title,
        provisional: false,
        institution: {
          legalName: inst.legalName,
          shortName: inst.shortName ?? "",
          headerLeft: inst.headerLeft ?? [],
          headerRight: inst.headerRight ?? [],
          contactLine: contact,
          address: inst.address ?? "",
          phone: inst.phone ?? "",
          email: inst.email ?? "",
          website: inst.website ?? "",
          registrationRef: inst.registrationRef ?? "",
          footerText: inst.footerText ?? "",
        },
        meta: { code: verification.code, verifyUrl: verification.url, hasQr: true, issuedAt: record.issuedAt.toISOString() },
      },
      title: record.title,
      colors: { primary: inst.primaryColor ?? "#1f3a5f", secondary: inst.secondaryColor ?? "#5b7aa3" },
      qrSvg: verification.qrSvg,
      provisional: false,
      assets: assets.value,
    });
    const result = await renderer.render({ html, title: record.title, issuedAt: record.issuedAt });
    const objectKey = officialObjectKeyFor(ctx.tenantId, record.id);
    const stored = await deps.ports.storage.put(objectKey, result.pdf, { contentType: "application/pdf" });
    produced = { pdfHash: stored.sha256 || sha256Hex(result.pdf), size: stored.size || result.pdf.length, pages: result.pages, objectKey };
  } catch (e) {
    failure = e instanceof Error && "kind" in e ? (e as AppError) : internal(`Le rendu PDF a échoué : ${messageOf(e)}`, ReportcardsCode.RENDER_FAILED);
    deps.logger.warn({ documentId: record.id, attempt, err: messageOf(e) }, "reportcards : rendu d'un document officiel en échec");
  }

  if (produced) {
    const done = produced;
    return inTx(deps, ctx, async (tx) => {
      const events = new EventBuffer(deps, ctx);
      await repo.markOfficialRendered(tx, record.id, { objectKey: done.objectKey, pdfHash: done.pdfHash, sizeBytes: done.size, pages: done.pages, at: deps.clock.now() });
      await cardsRepo.registerFileHash(tx, { pdfHash: done.pdfHash, code: record.verificationCode, tenantId: ctx.tenantId });
      events.add(ReportcardsEvents.OFFICIAL_RENDERED, { v: 1, documentId: record.id, documentKind: record.documentKind, sourceId: record.sourceId, pdfHash: done.pdfHash, sizeBytes: done.size }, { type: "official_document", id: record.id });
      await events.flush(tx);
      return ok({ documentId: record.id, status: "RENDERED" as const, pdfHash: done.pdfHash, sizeBytes: done.size });
    });
  }

  const final = attempt >= maxAttempts;
  const reason = failure?.message ?? "Rendu en échec.";
  const marked = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    await repo.setOfficialRenderState(tx, record.id, { status: final ? "FAILED" : "PENDING", attempts: attempt, error: truncate(reason) });
    if (final) {
      events.add(ReportcardsEvents.OFFICIAL_RENDER_FAILED, { v: 1, documentId: record.id, documentKind: record.documentKind, sourceId: record.sourceId, error: truncate(reason, 300) }, { type: "official_document", id: record.id });
    }
    await events.flush(tx);
    return ok(undefined);
  });
  if (!marked.ok) return marked;
  return err(conflict(`Rendu PDF en échec (tentative ${attempt}/${maxAttempts}) : ${reason}`, ReportcardsCode.RENDER_FAILED, { attempt, maxAttempts, final, documentId: record.id }));
}

/** Reprise explicite (ou filet de sécurité) : remet le document en attente et republie la demande de rendu. */
export async function requestOfficialDocumentRender(deps: ReportcardsDeps, ctx: RequestContext, input: { documentId: Uuid }): Promise<Result<repo.OfficialDocumentRecord, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const doc = await repo.getOfficialDocument(tx, input.documentId, { forUpdate: true });
    if (!doc) return err(notFound("Document", input.documentId));
    if (doc.renderStatus === "RENDERED") return ok(doc);
    await repo.setOfficialRenderState(tx, doc.id, { status: "PENDING", error: null });
    const events = new EventBuffer(deps, ctx);
    events.add(ReportcardsEvents.OFFICIAL_RENDER_REQUESTED, { v: 1, documentId: doc.id, documentKind: doc.documentKind, sourceId: doc.sourceId }, { type: "official_document", id: doc.id });
    await events.flush(tx);
    return ok({ ...doc, renderStatus: "PENDING" as const });
  });
}

/** Filet de sécurité (job périodique) : redemande le rendu des documents restés en attente depuis trop longtemps. */
export async function sweepPendingOfficialDocuments(deps: ReportcardsDeps, ctx: RequestContext, input: { olderThanMs: number; limit: number }): Promise<Result<{ requested: number }, AppError>> {
  const stale = await inTx(deps, ctx, async (tx) => ok(await repo.listStalePendingOfficialDocuments(tx, new Date(deps.clock.now().getTime() - input.olderThanMs), input.limit)), { readOnly: true });
  if (!stale.ok) return stale;
  let requested = 0;
  for (const documentId of stale.value) {
    const r = await requestOfficialDocumentRender(deps, ctx, { documentId });
    if (r.ok) requested += 1;
  }
  return ok({ requested });
}

export async function getOfficialDocumentRecord(deps: ReportcardsDeps, ctx: RequestContext, input: { kind: OfficialDocumentKind; sourceId: Uuid }): Promise<Result<repo.OfficialDocumentRecord | null, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.getOfficialDocumentBySource(tx, input.kind, input.sourceId)), { readOnly: true });
}

export interface OfficialDocumentFile {
  record: repo.OfficialDocumentRecord;
  /** Octets du PDF si `record.renderStatus === 'RENDERED'`, sinon `null` (rendu en cours ou échoué). */
  bytes: Uint8Array | null;
  fileName: string;
}

/**
 * Document officiel d'une source : état et PDF. Le module propriétaire a DÉJÀ contrôlé l'accès. `null` : jamais demandé.
 * Un PDF référencé mais absent du stockage est une erreur d'exploitation explicite (jamais un « introuvable » silencieux).
 */
export async function readOfficialDocument(deps: ReportcardsDeps, ctx: RequestContext, input: { kind: OfficialDocumentKind; sourceId: Uuid }): Promise<Result<OfficialDocumentFile | null, AppError>> {
  const found = await getOfficialDocumentRecord(deps, ctx, input);
  if (!found.ok) return found;
  const record = found.value;
  if (!record) return ok(null);
  const fileName = `${record.title.replace(/[^\p{L}\p{N}._ -]+/gu, "").trim().replace(/\s+/g, "-") || record.documentKind.toLowerCase()}.pdf`;
  if (record.renderStatus !== "RENDERED" || !record.objectKey) return ok({ record, bytes: null, fileName });
  const object = await deps.ports.storage.get(record.objectKey);
  if (!object) return err(internal("Le PDF de ce document est introuvable dans le stockage.", ReportcardsCode.ASSET_MISSING, { documentId: record.id }));
  return ok({ record, bytes: object.bytes, fileName });
}
