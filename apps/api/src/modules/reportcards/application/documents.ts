/**
 * Port GÉNÉRIQUE de scellement et de rendu pour les autres documents officiels (spec 013 US8) : diplômes et attestations
 * (019), bulletin de paie (032) réutilisent les gabarits de plateforme, le branding, la signature Ed25519, le QR, le
 * stockage et la vérification de ce module.
 *
 *   sealDocument        hash canonique + code de vérification + signature (pur, sans écriture) ;
 *   renderDocumentPdf   gabarit de plateforme + contexte fourni par l'appelant -> HTML -> PDF (moteur du processus).
 *
 * Les natures inconnues du registre sont REFUSÉES (AC8.2). L'inscription du code dans l'index public reste faite par
 * l'appelant dans SA transaction (`registerVerificationFor`), pour que document et index naissent ensemble.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { snapshotHash } from "../domain/canonical";
import { isKnownDocumentKind } from "../domain/constants";
import { renderContextHtml, type RenderAssets } from "../domain/document-html";
import { ReportcardsCode, conflict, internal, invalid, notFound } from "../domain/errors";
import { generateVerificationCode } from "../domain/signing";
import * as cardsRepo from "../infrastructure/cards-repository";
import { getPlatformTemplate } from "../infrastructure/reference-repository";
import { inTx, type ReportcardsDeps } from "./deps";
import { buildVerificationInfo } from "./render-support";

export interface SealedDocument {
  readonly snapshotHash: string;
  readonly verificationCode: string;
  readonly signature: string;
  readonly keyId: string;
  readonly issuedAt: Date;
}

/**
 * Scelle un document : SHA-256 du JSON canonique `{ snapshot, explain }`, code opaque de 128 bits, signature Ed25519 de
 * `(hash, code, issuedAt)`. Le snapshot ne contient que chaînes, entiers, booléens et null (aucun flottant).
 */
export function sealDocument(deps: ReportcardsDeps, input: { kind: string; snapshot: unknown; explain?: unknown; issuedAt: Date }): Result<SealedDocument, AppError> {
  if (!isKnownDocumentKind(input.kind)) return err(invalid(`Nature de document inconnue (${input.kind}).`, ReportcardsCode.UNKNOWN_DOCUMENT_KIND));
  const keys = deps.keys;
  if (!keys) return err(conflict("Aucune clé de signature n'est configurée.", ReportcardsCode.SIGNING_KEY_MISSING));
  let hash: string;
  try {
    hash = snapshotHash(input.snapshot, input.explain ?? []);
  } catch (e) {
    return err(invalid(`Snapshot non canonisable : ${e instanceof Error ? e.message : "erreur"}`, ReportcardsCode.INVALID_SNAPSHOT));
  }
  const code = generateVerificationCode();
  return ok({ snapshotHash: hash, verificationCode: code, signature: keys.sign({ snapshotHash: hash, verificationCode: code, issuedAt: input.issuedAt }), keyId: keys.keyId, issuedAt: input.issuedAt });
}

/** Inscrit le code dans l'index public, dans la transaction de l'appelant (le tenant courant est imposé par la RLS). */
export async function registerVerificationFor(tx: Tx, ctx: RequestContext, input: { code: string; documentKind: string; documentId: string }): Promise<void> {
  await cardsRepo.registerVerification(tx, { code: input.code, tenantId: ctx.tenantId, documentKind: input.documentKind, documentId: input.documentId });
}

export interface RenderDocumentInput {
  kind: string;
  templateKey: string;
  templateVersion?: number;
  /** Contexte du gabarit fourni par l'appelant (chaînes, nombres, booléens, listes) : jamais interprété comme du gabarit. */
  context: Record<string, unknown>;
  title: string;
  issuedAt: Date;
  /** Code de vérification du document scellé ; absent = document non vérifiable (provisoire). */
  verificationCode?: string;
  colors?: { primary?: string | null; secondary?: string | null };
  assets?: RenderAssets;
  watermarkText?: string | null;
}

/** Rend un document de plateforme en HTML puis en PDF avec le moteur de rendu du processus (worker). */
export async function renderDocumentPdf(deps: ReportcardsDeps, ctx: RequestContext, input: RenderDocumentInput): Promise<Result<{ pdf: Uint8Array; html: string; pages: number; templateKey: string; templateVersion: number }, AppError>> {
  if (!isKnownDocumentKind(input.kind)) return err(invalid(`Nature de document inconnue (${input.kind}).`, ReportcardsCode.UNKNOWN_DOCUMENT_KIND));
  const renderer = deps.ports.renderer;
  if (!renderer) return err(internal("Le moteur de rendu PDF n'est pas disponible dans ce processus.", ReportcardsCode.PORT_UNAVAILABLE));
  const template = await inTx(deps, ctx, async (tx) => {
    const t = await getPlatformTemplate(tx, input.templateKey, input.templateVersion);
    if (!t) return err(notFound("Modèle de document", input.templateKey));
    if (t.documentKind !== input.kind) return err(invalid(`Ce modèle est prévu pour « ${t.documentKind} », pas « ${input.kind} ».`, ReportcardsCode.INVALID_TEMPLATE));
    return ok(t);
  }, { readOnly: true });
  if (!template.ok) return template;
  const verification = input.verificationCode ? buildVerificationInfo(deps, input.verificationCode, false) : null;
  const html = renderContextHtml({
    template: { body: template.value.body, css: template.value.css },
    context: { ...input.context, meta: { ...(input.context.meta as object | undefined), code: verification?.code ?? "", verifyUrl: verification?.url ?? "", hasQr: Boolean(verification?.qrSvg), issuedAt: input.issuedAt.toISOString() } },
    title: input.title,
    colors: { primary: input.colors?.primary ?? "#1f3a5f", secondary: input.colors?.secondary ?? "#5b7aa3" },
    qrSvg: verification?.qrSvg ?? null,
    provisional: !input.verificationCode,
    watermarkText: input.watermarkText ?? null,
    ...(input.assets ? { assets: input.assets } : {}),
  });
  const rendered = await renderer.render({ html, title: input.title, issuedAt: input.issuedAt });
  return ok({ pdf: rendered.pdf, html, pages: rendered.pages, templateKey: template.value.key, templateVersion: template.value.version });
}
