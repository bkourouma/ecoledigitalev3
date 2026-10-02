/**
 * Moteur de gabarits : analyse, validation (variables typées), rendu texte, rendu HTML échappé, estimation SMS.
 *
 * Syntaxe : `{{nom}}` et `{{#nom}}…{{/nom}}` (bloc conditionnel sur une variable renseignée). Pas de HTML ni de code dans un
 * gabarit : le HTML d'un e-mail est PRODUIT à partir du texte, tout échappé (aucune injection par une valeur ou un gabarit).
 * Les valeurs sont validées par TYPE : une valeur mal typée est une erreur, jamais un « undefined » dans un message.
 */
import { CURRENCIES, type CurrencyCode } from "@ecoledigitale/kernel";
import type { NotifVariableDef } from "@ecoledigitale/contracts/src/v2/notifications";
import { allVariables, type CatalogEntry } from "./catalog";

export type Token =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "var"; readonly name: string }
  | { readonly type: "section"; readonly name: string; readonly children: readonly Token[] };

export type ParseResult = { readonly ok: true; readonly tokens: readonly Token[] } | { readonly ok: false; readonly error: string };

const TAG = /\{\{\s*(#|\/)?\s*([A-Za-z][A-Za-z0-9]{0,39})\s*\}\}/g;

/** Analyse un gabarit. Les sections ne s'imbriquent pas sur la même variable ; une balise orpheline est une erreur. */
export function parseTemplate(source: string): ParseResult {
  const root: Token[] = [];
  const stack: Array<{ name: string; children: Token[] }> = [];
  let current: Token[] = root;
  let last = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(source); m; m = TAG.exec(source)) {
    if (m.index > last) current.push({ type: "text", value: source.slice(last, m.index) });
    last = m.index + m[0].length;
    const kind = m[1];
    const name = m[2]!;
    if (kind === "#") {
      if (stack.some((s) => s.name === name)) return { ok: false, error: `Le bloc « ${name} » est imbriqué dans lui-même.` };
      const frame = { name, children: [] as Token[] };
      stack.push(frame);
      current = frame.children;
    } else if (kind === "/") {
      const frame = stack.pop();
      if (!frame || frame.name !== name) return { ok: false, error: `La balise de fin « ${name} » ne correspond à aucun bloc ouvert.` };
      const parent = stack.length > 0 ? stack[stack.length - 1]!.children : root;
      parent.push({ type: "section", name, children: frame.children });
      current = parent;
    } else {
      current.push({ type: "var", name });
    }
  }
  if (last < source.length) current.push({ type: "text", value: source.slice(last) });
  if (stack.length > 0) return { ok: false, error: `Le bloc « ${stack[stack.length - 1]!.name} » n'est pas refermé.` };
  // Les accolades résiduelles ({{ sans fermeture) seraient affichées telles quelles : on les refuse.
  const residue = root.length === 0 ? "" : flattenText(root);
  if (/\{\{|\}\}/.test(residue)) return { ok: false, error: "Balise mal formée : « {{ » ou « }} » orphelin." };
  return { ok: true, tokens: root };
}

function flattenText(tokens: readonly Token[]): string {
  return tokens.map((t) => (t.type === "text" ? t.value : t.type === "section" ? flattenText(t.children) : "")).join("");
}

/** Noms de variables référencés (variables simples et blocs). */
export function referencedVariables(tokens: readonly Token[]): string[] {
  const out = new Set<string>();
  const walk = (ts: readonly Token[]): void => {
    for (const t of ts) {
      if (t.type === "var") out.add(t.name);
      else if (t.type === "section") {
        out.add(t.name);
        walk(t.children);
      }
    }
  };
  walk(tokens);
  return [...out];
}

export interface TemplateIssue {
  readonly code: "parse" | "unknown_variable" | "missing_subject" | "unexpected_subject" | "too_long";
  readonly message: string;
  readonly variable?: string;
}

/** Valide un gabarit à l'enregistrement : syntaxe, variables du catalogue, objet selon le canal. */
export function validateTemplateSource(input: { entry: CatalogEntry; channel: string; subject: string | null | undefined; body: string }): { issues: TemplateIssue[]; variables: string[] } {
  const issues: TemplateIssue[] = [];
  const variables = new Set<string>();
  const known = new Set(allVariables(input.entry).map((d) => d.name));
  for (const [label, source] of [["corps", input.body], ["objet", input.subject ?? ""]] as const) {
    const parsed = parseTemplate(source);
    if (!parsed.ok) {
      issues.push({ code: "parse", message: `Gabarit (${label}) : ${parsed.error}` });
      continue;
    }
    for (const name of referencedVariables(parsed.tokens)) {
      variables.add(name);
      if (!known.has(name)) issues.push({ code: "unknown_variable", variable: name, message: `La variable « ${name} » n'existe pas pour ce gabarit.` });
    }
  }
  const needsSubject = input.channel === "EMAIL" || input.channel === "PUSH" || input.channel === "IN_APP";
  if (needsSubject && !(input.subject && input.subject.trim())) issues.push({ code: "missing_subject", message: "Ce canal exige un objet (titre)." });
  if (!needsSubject && input.subject && input.subject.trim()) issues.push({ code: "unexpected_subject", message: "Ce canal n'a pas d'objet." });
  return { issues, variables: [...variables].sort() };
}

// ---------------------------------------------------------------------------
// Valeurs typées
// ---------------------------------------------------------------------------

export class TemplateValueError extends Error {
  constructor(
    readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = "TemplateValueError";
  }
}

const NBSP = new RegExp("[\u00A0\u202F]", "g");
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]", "g");

function validDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** « 2026-10-02 » -> « 02/10/2026 ». */
export const formatDateFr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function formatNumberFr(n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n).replace(NBSP, " ");
}

/** Montant en unités mineures -> « 25 000 F CFA » (XOF/XAF : exposant 0) ou « 25,00 € ». */
export function formatMoneyFr(amount: number, currency: string): string {
  const cur = CURRENCIES[currency as CurrencyCode];
  if (!cur || !Number.isSafeInteger(amount)) throw new Error("montant invalide");
  const major = amount / 10 ** cur.exponent;
  const nf = new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur.code, minimumFractionDigits: cur.exponent, maximumFractionDigits: cur.exponent });
  return nf.format(major).replace(NBSP, " ");
}

export interface RenderOptions {
  /** Base absolue de l'application pour les liens internes (`/v2/...`). */
  readonly appUrl?: string | null;
}

/** Texte d'une valeur, selon le type déclaré. Lève `TemplateValueError` si la valeur ne convient pas. */
export function formatValue(def: NotifVariableDef, raw: unknown, options: RenderOptions = {}): string {
  const fail = (why: string): never => {
    throw new TemplateValueError(def.name, `La variable « ${def.name} » ${why}.`);
  };
  switch (def.type) {
    case "string": {
      if (typeof raw !== "string") return fail("doit être un texte");
      const s = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
      if (s.length > 500) return fail("est trop longue (500 caractères au plus)");
      return s;
    }
    case "text": {
      if (typeof raw !== "string") return fail("doit être un texte");
      const s = raw.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim();
      if (s.length > 2000) return fail("est trop longue (2000 caractères au plus)");
      return s;
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return fail("doit être un nombre");
      return formatNumberFr(raw);
    }
    case "date": {
      if (typeof raw !== "string" || !validDate(raw)) return fail("doit être une date AAAA-MM-JJ valide");
      return formatDateFr(raw);
    }
    case "money": {
      const m = raw as { amount?: unknown; currency?: unknown } | null;
      if (!m || typeof m !== "object" || typeof m.amount !== "number" || typeof m.currency !== "string") return fail("doit être un montant { amount, currency }");
      try {
        return formatMoneyFr(m.amount, m.currency);
      } catch {
        return fail("n'est pas un montant valide (entier en unités mineures, devise connue)");
      }
    }
    case "url": {
      if (typeof raw !== "string") return fail("doit être une adresse");
      const s = raw.trim();
      if (s.startsWith("/") && !s.startsWith("//")) {
        const base = (options.appUrl ?? "").replace(/\/+$/, "");
        return `${base}${s}`;
      }
      if (/^https:\/\/[^\s<>"']+$/i.test(s)) return s;
      return fail("doit être un chemin interne (/…) ou une adresse https");
    }
  }
}

/** Valeur d'exemple, typée, d'une variable (aperçu). */
export function sampleValue(def: NotifVariableDef): unknown {
  switch (def.type) {
    case "number":
      return Number(def.sample);
    case "money": {
      const [amount, currency] = def.sample.split(" ");
      return { amount: Number(amount), currency: currency ?? "XOF" };
    }
    default:
      return def.sample;
  }
}

export function sampleValues(entry: CatalogEntry): Record<string, unknown> {
  return Object.fromEntries(allVariables(entry).map((d) => [d.name, sampleValue(d)]));
}

export interface RenderResult {
  readonly text: string;
  /** Variables obligatoires absentes ou mal typées (le rendu n'est pas utilisable). */
  readonly errors: readonly TemplateValueError[];
}

function isPresent(raw: unknown): boolean {
  return raw !== undefined && raw !== null && !(typeof raw === "string" && raw.trim() === "");
}

/** Rend un gabarit analysé avec ses valeurs. Une variable obligatoire manquante ou mal typée est signalée dans `errors`. */
export function renderTokens(tokens: readonly Token[], defs: readonly NotifVariableDef[], values: Readonly<Record<string, unknown>>, options: RenderOptions = {}): RenderResult {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const errors: TemplateValueError[] = [];
  const seen = new Set<string>();
  const out = (ts: readonly Token[]): string =>
    ts
      .map((t) => {
        if (t.type === "text") return t.value;
        if (t.type === "section") return isPresent(values[t.name]) ? out(t.children) : "";
        const def = byName.get(t.name);
        if (!def) {
          if (!seen.has(t.name)) errors.push(new TemplateValueError(t.name, `La variable « ${t.name} » est inconnue.`));
          seen.add(t.name);
          return "";
        }
        const raw = values[t.name];
        if (!isPresent(raw)) {
          if (def.required && !seen.has(t.name)) errors.push(new TemplateValueError(t.name, `La variable « ${t.name} » est obligatoire.`));
          seen.add(t.name);
          return "";
        }
        try {
          return formatValue(def, raw, options);
        } catch (e) {
          if (e instanceof TemplateValueError && !seen.has(t.name)) errors.push(e);
          seen.add(t.name);
          return "";
        }
      })
      .join("");
  const text = out(tokens).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, errors };
}

/** Rend une chaîne de gabarit (objet ou corps). */
export function renderSource(source: string, entry: CatalogEntry, values: Readonly<Record<string, unknown>>, options: RenderOptions = {}): RenderResult {
  const parsed = parseTemplate(source);
  if (!parsed.ok) return { text: "", errors: [new TemplateValueError("*", parsed.error)] };
  const r = renderTokens(parsed.tokens, allVariables(entry), values, options);
  // Un objet tient sur une ligne.
  return r;
}

// ---------------------------------------------------------------------------
// HTML (e-mail) et SMS
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Texte brut -> HTML : tout est échappé ; les adresses https deviennent des liens ; lignes vides = paragraphes. */
export function textToHtml(text: string): string {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      const escaped = escapeHtml(p).replace(/(https?:\/\/[^\s<]+)/g, (url) => {
        const clean = url.replace(/[.,;:!?)]+$/, "");
        const tail = url.slice(clean.length);
        return `<a href="${clean}" style="color:#1d4ed8">${clean}</a>${tail}`;
      });
      return `<p style="margin:0 0 14px 0">${escaped.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

export interface EmailLayoutInput {
  readonly bodyText: string;
  readonly schoolName: string;
  readonly legalFooter: string | null;
  readonly unsubscribeUrl: string | null;
  readonly category: string;
}

/** Enveloppe HTML d'un e-mail : en-tête sobre, contenu échappé, pied de page de conformité (désinscription, mentions). */
export function buildEmailHtml(input: EmailLayoutInput): string {
  const footer: string[] = [`Message envoyé par ${escapeHtml(input.schoolName)} via EcoleDigitale.`];
  if (input.legalFooter) footer.push(escapeHtml(input.legalFooter).replace(/\n/g, "<br>"));
  if (input.unsubscribeUrl) {
    footer.push(`Vous ne souhaitez plus recevoir ces messages par e-mail ? <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7280">Se désinscrire</a>.`);
  }
  return [
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`,
    `<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">`,
    `<div style="max-width:600px;margin:0 auto;padding:16px">`,
    `<div style="background:#14532d;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-size:16px;font-weight:bold">${escapeHtml(input.schoolName)}</div>`,
    `<div style="background:#fff;padding:20px 18px;font-size:15px;line-height:1.55;border:1px solid #e5e7eb;border-top:0">${textToHtml(input.bodyText)}</div>`,
    `<div style="padding:12px 18px;font-size:12px;line-height:1.5;color:#6b7280">${footer.join("<br>")}</div>`,
    `</div></body></html>`,
  ].join("");
}

/** Texte brut de l'e-mail : contenu + pied de page de conformité. */
export function buildEmailText(input: Pick<EmailLayoutInput, "bodyText" | "schoolName" | "legalFooter" | "unsubscribeUrl">): string {
  const lines = [input.bodyText, "", "--", `Message envoyé par ${input.schoolName} via EcoleDigitale.`];
  if (input.legalFooter) lines.push(input.legalFooter);
  if (input.unsubscribeUrl) lines.push(`Se désinscrire : ${input.unsubscribeUrl}`);
  return lines.join("\n");
}

const GSM7 = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€".split(""),
);

/** Estimation du nombre de SMS (GSM-7 : 160 / 153 ; sinon UCS-2 : 70 / 67). Les caractères étendus GSM comptent double. */
export function smsSegments(text: string): { segments: number; encoding: "GSM-7" | "UCS-2"; length: number } {
  const chars = [...text];
  const gsm = chars.every((c) => GSM7.has(c));
  if (gsm) {
    const extended = new Set(["^", "{", "}", "\\", "[", "~", "]", "|", "€"]);
    const length = chars.reduce((n, c) => n + (extended.has(c) ? 2 : 1), 0);
    return { segments: length <= 160 ? 1 : Math.ceil(length / 153), encoding: "GSM-7", length };
  }
  const length = text.length;
  return { segments: length <= 70 ? 1 : Math.ceil(length / 67), encoding: "UCS-2", length };
}
