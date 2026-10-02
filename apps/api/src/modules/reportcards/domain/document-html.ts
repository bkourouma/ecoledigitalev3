/**
 * Rendu HTML DÉTERMINISTE d'un document depuis son snapshot (R-RC-08, AC2.4). Aucune E/S : les images (logo, emblème,
 * signatures) arrivent déjà en data URI (lues depuis `StoragePort` par l'appelant), le QR en SVG (encodeur du module).
 * Le même snapshot + le même gabarit + les mêmes actifs donnent EXACTEMENT le même HTML.
 *
 * Défense en profondeur : le gabarit est revalidé ici (liste blanche de balises, CSS sans URL), le document porte une
 * Content-Security-Policy `default-src 'none'` (images en `data:` seulement), et le moteur de rendu PDF s'exécute JavaScript
 * désactivé et réseau coupé (`infrastructure/puppeteer-renderer.ts`).
 */
import { PARTIAL_SOURCES } from "../templates/partials";
import { DEMONSTRATION_WATERMARK } from "./constants";
import { buildRenderContext, type VerificationInfo } from "./render-context";
import { escapeHtml, parseTemplate, readPath, renderTemplate, TemplateError, type ParsedTemplate, type RenderEnvironment } from "./template-engine";
import { validateTemplate } from "./template-validation";
import type { ReportcardSnapshot } from "./types";

export interface RenderAssets {
  /** Data URI d'image (png, jpeg, gif, webp) — jamais d'URL. */
  readonly logo?: string | null;
  readonly emblem?: string | null;
  /** Signature par emplacement. */
  readonly signatures?: Readonly<Record<string, string>>;
}

export interface TemplateSource {
  readonly body: string;
  readonly css: string;
}

const IMAGE_DATA_URI = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]{16,}={0,2}$/;
export const isSafeImageDataUri = (value: unknown): value is string => typeof value === "string" && IMAGE_DATA_URI.test(value);

export const PARTIAL_NAMES: readonly string[] = Object.freeze(Object.keys(PARTIAL_SOURCES));

let partialsCache: Record<string, ParsedTemplate> | null = null;
function partials(): Record<string, ParsedTemplate> {
  if (!partialsCache) partialsCache = Object.fromEntries(Object.entries(PARTIAL_SOURCES).map(([name, src]) => [name, parseTemplate(src)]));
  return partialsCache;
}

const BASE_CSS =
  "@page { size: A4; margin: 10mm; } * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: #ffffff; } " +
  "img { max-width: 100%; } table { page-break-inside: auto; } tr { page-break-inside: avoid; }";

const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";
const HEX = /^#[0-9A-Fa-f]{6}$/;

export interface ContextRenderInput {
  readonly template: TemplateSource;
  /** Contexte du gabarit : chaînes, nombres, booléens, listes, objets (jamais de fonction). */
  readonly context: Record<string, unknown>;
  readonly title: string;
  readonly colors: { primary: string; secondary: string };
  /** QR + URL de vérification ; `null` : document non vérifiable (provisoire). */
  readonly qrSvg: string | null;
  readonly provisional: boolean;
  /** Filigrane d'option (texte), sinon aucun. */
  readonly watermarkText?: string | null;
  readonly assets?: RenderAssets;
}

/**
 * Rendu d'un gabarit de plateforme avec un contexte quelconque. Utilisé par les bulletins et, via le port générique
 * (`renderDocumentPdf`), par les diplômes / attestations (019) et le bulletin de paie (032) qui fournissent leur propre contexte.
 */
export function renderContextHtml(input: ContextRenderInput): string {
  const check = validateTemplate({ body: input.template.body, css: input.template.css, partialNames: PARTIAL_NAMES });
  if (!check.ok || !check.parsed) {
    throw new TemplateError(`Gabarit refusé au rendu : ${check.problems.map((p) => p.message).join(" ; ")}`);
  }
  const assets = input.assets ?? {};
  const primary = HEX.test(input.colors.primary) ? input.colors.primary : "#1f3a5f";
  const secondary = HEX.test(input.colors.secondary) ? input.colors.secondary : "#5b7aa3";
  const env: RenderEnvironment = {
    partials: partials(),
    components: {
      qr: () => (!input.provisional && input.qrSvg ? input.qrSvg : ""),
      image: (arg, scope) => {
        let uri: string | null | undefined;
        let cls: string;
        if (arg === "logo") (uri = assets.logo), (cls = "img-logo");
        else if (arg === "emblem") (uri = assets.emblem), (cls = "img-emblem");
        else if (arg === "signature") {
          const slot = readPath(scope, "this.slot");
          uri = typeof slot === "string" ? assets.signatures?.[slot] : undefined;
          cls = "img-signature";
        } else return "";
        return isSafeImageDataUri(uri) ? `<img class="${cls}" alt="" src="${uri}">` : "";
      },
      watermark: () => {
        if (input.provisional) return '<div class="watermark">PROVISOIRE</div>';
        const text = input.watermarkText;
        return typeof text === "string" && text.trim() ? `<div class="watermark">${escapeHtml(text.trim())}</div>` : "";
      },
    },
  };
  const body = renderTemplate(check.parsed, input.context, env);
  const vars = `:root { --primary: ${primary}; --secondary: ${secondary}; }`;
  return (
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<title>${escapeHtml(input.title)}</title><style>${BASE_CSS} ${vars} ${input.template.css}</style></head><body>${body}</body></html>`
  );
}

export function renderDocumentHtml(input: {
  snapshot: ReportcardSnapshot;
  template: TemplateSource;
  verification: VerificationInfo | null;
  assets?: RenderAssets;
}): string {
  const ctx = buildRenderContext(input.snapshot, input.verification);
  const watermark = ctx.options.watermark;
  return renderContextHtml({
    template: input.template,
    context: ctx as unknown as Record<string, unknown>,
    title: ctx.title,
    colors: ctx.colors,
    qrSvg: input.verification?.qrSvg ?? null,
    provisional: ctx.provisional,
    // Règles de DÉMONSTRATION : le filigrane s'impose (une option de gabarit ne peut pas le retirer).
    watermarkText: ctx.demonstration ? DEMONSTRATION_WATERMARK : typeof watermark === "string" ? watermark : null,
    ...(input.assets ? { assets: input.assets } : {}),
  });
}
