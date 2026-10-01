/**
 * Moteur de gabarit SANS LOGIQUE (spec 013 AC5.4, R1 « injection via gabarit »).
 *
 * Un gabarit est du HTML + des étiquettes `{{ … }}`. Le moteur ne sait faire que :
 *   {{ chemin }}                       substitution, TOUJOURS échappée en HTML (& < > " ' `)
 *   {{ chemin | filtre | filtre:arg }} filtres d'une liste fermée (upper, lower, date_fr, default, join, label…)
 *   {{#each chemin limit=N}}…{{/each}} boucle BORNÉE sur une liste du contexte (N ≤ 1500, 200 par défaut)
 *   {{#if chemin}}…{{else}}…{{/if}}    présence / vide seulement (aucune comparaison, aucune expression)
 *   {{#unless chemin}}…{{/unless}}
 *   {{> nom}}                          composant fourni par la PLATEFORME (registre fermé, profondeur ≤ 4)
 *   {{@nom argument}}                  composant à sortie de confiance : qr, image, watermark (registre fermé)
 *
 * Il n'évalue ni JavaScript, ni expression, ni appel de fonction ; il ne lit que des propriétés PROPRES du contexte (jamais
 * `__proto__`, `constructor`, `prototype`) ; il borne le nombre de nœuds visités et la taille de sortie. Le contexte est
 * construit par le code (`render-context.ts`) à partir du snapshot : rien d'un tenant n'est interprété comme du gabarit.
 *
 * Pur : aucune E/S.
 */

export class TemplateError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `${message} (ligne ${line})` : message);
    this.name = "TemplateError";
  }
}

export const MAX_EACH_LIMIT = 1500;
export const DEFAULT_EACH_LIMIT = 200;
const MAX_PARTIAL_DEPTH = 4;
const MAX_NODES_VISITED = 400_000;
const MAX_OUTPUT_BYTES = 6 * 1024 * 1024;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const PATH_RE = /^(?:\$root|this|[A-Za-z_][A-Za-z0-9_]*|\$(?:index|number|first|last))(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const IDENT_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const FILTER_NAMES = ["upper", "lower", "date_fr", "datetime_fr", "default", "join", "label", "number_fr", "initial"] as const;
export const COMPONENT_NAMES = ["qr", "image", "watermark"] as const;

type Node =
  | { t: "text"; v: string }
  | { t: "var"; path: string; filters: Array<{ name: string; arg: string | null }>; line: number }
  | { t: "each"; path: string; limit: number; body: Node[]; line: number }
  | { t: "if"; path: string; negate: boolean; body: Node[]; otherwise: Node[]; line: number }
  | { t: "partial"; name: string; line: number }
  | { t: "component"; name: string; arg: string | null; line: number };

export interface ParsedTemplate {
  readonly nodes: readonly Node[];
  /** Éléments statiques utilisés (pour la validation à la publication). */
  readonly partials: readonly string[];
  readonly components: readonly string[];
  readonly filters: readonly string[];
  /** Fragments de texte littéral (HTML) entre les étiquettes, pour l'analyse de sécurité. */
  readonly literals: readonly string[];
}

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

function parseFilters(parts: string[], line: number): Array<{ name: string; arg: string | null }> {
  return parts.map((raw) => {
    const piece = raw.trim();
    const m = /^([a-z_]+)(?::\s*"([^"{}]*)")?$/.exec(piece);
    if (!m) throw new TemplateError(`Filtre invalide « ${piece} »`, line);
    const name = m[1]!;
    if (!(FILTER_NAMES as readonly string[]).includes(name)) throw new TemplateError(`Filtre inconnu « ${name} »`, line);
    return { name, arg: m[2] ?? null };
  });
}

export function parseTemplate(source: string): ParsedTemplate {
  const partials = new Set<string>();
  const components = new Set<string>();
  const filters = new Set<string>();
  const literals: string[] = [];
  const root: Node[] = [];
  type Frame = { kind: "each" | "if" | "unless"; node: Node; list: Node[]; inElse: boolean };
  const stack: Frame[] = [];
  const current = (): Node[] => (stack.length ? stack[stack.length - 1]!.list : root);

  const tag = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (text: string): void => {
    if (text) {
      current().push({ t: "text", v: text });
      literals.push(text);
    }
  };
  if (source.includes("{{{") || source.includes("}}}")) throw new TemplateError("Les étiquettes « {{{ }}} » (sortie non échappée) sont interdites", lineOf(source, Math.max(source.indexOf("{{{"), 0)));

  while ((m = tag.exec(source)) !== null) {
    pushText(source.slice(last, m.index));
    last = m.index + m[0].length;
    const line = lineOf(source, m.index);
    const inner = m[1]!.trim();
    if (!inner) throw new TemplateError("Étiquette vide", line);
    if (inner.includes("{{")) throw new TemplateError("Étiquettes imbriquées", line);

    if (inner[0] === "#") {
      const mm = /^#(each|if|unless)\s+(\S+)(?:\s+limit=(\d{1,4}))?$/.exec(inner);
      if (!mm) throw new TemplateError(`Bloc invalide « ${inner} »`, line);
      const [, kind, path, limit] = mm;
      if (!PATH_RE.test(path!)) throw new TemplateError(`Chemin invalide « ${path} »`, line);
      if (kind !== "each" && limit) throw new TemplateError("limit n'existe que pour each", line);
      if (kind === "each") {
        const lim = limit ? Number(limit) : DEFAULT_EACH_LIMIT;
        if (lim < 1 || lim > MAX_EACH_LIMIT) throw new TemplateError(`limit hors bornes (1 à ${MAX_EACH_LIMIT})`, line);
        const node: Node = { t: "each", path: path!, limit: lim, body: [], line };
        current().push(node);
        stack.push({ kind: "each", node, list: node.body, inElse: false });
      } else {
        const node: Node = { t: "if", path: path!, negate: kind === "unless", body: [], otherwise: [], line };
        current().push(node);
        stack.push({ kind: kind as "if" | "unless", node, list: node.body, inElse: false });
      }
    } else if (inner[0] === "/") {
      const name = inner.slice(1).trim();
      const top = stack.pop();
      if (!top || top.kind !== name) throw new TemplateError(`Fermeture inattendue « ${inner} »`, line);
    } else if (inner === "else") {
      const top = stack[stack.length - 1];
      if (!top || top.kind === "each" || top.inElse) throw new TemplateError("« else » hors d'un bloc if/unless", line);
      top.inElse = true;
      top.list = (top.node as Extract<Node, { t: "if" }>).otherwise;
    } else if (inner[0] === ">") {
      const name = inner.slice(1).trim();
      if (!IDENT_RE.test(name)) throw new TemplateError(`Composant invalide « ${name} »`, line);
      partials.add(name);
      current().push({ t: "partial", name, line });
    } else if (inner[0] === "@") {
      const mm = /^@([a-z]+)(?:\s+([A-Za-z0-9_.:-]+))?$/.exec(inner);
      if (!mm) throw new TemplateError(`Composant invalide « ${inner} »`, line);
      if (!(COMPONENT_NAMES as readonly string[]).includes(mm[1]!)) throw new TemplateError(`Composant inconnu « ${mm[1]} »`, line);
      components.add(mm[1]!);
      current().push({ t: "component", name: mm[1]!, arg: mm[2] ?? null, line });
    } else {
      const [pathRaw, ...filterParts] = inner.split("|");
      const path = pathRaw!.trim();
      if (!PATH_RE.test(path)) throw new TemplateError(`Chemin invalide « ${path} »`, line);
      const parsed = parseFilters(filterParts, line);
      parsed.forEach((f) => filters.add(f.name));
      current().push({ t: "var", path, filters: parsed, line });
    }
  }
  pushText(source.slice(last));
  if (stack.length) throw new TemplateError(`Bloc « ${stack[stack.length - 1]!.kind} » non fermé`);
  return { nodes: root, partials: [...partials], components: [...components], filters: [...filters], literals };
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 2026-07-04 » -> « 4 juillet 2026 ». Valeur illisible : renvoyée telle quelle (échappée ensuite). */
export function formatDateFr(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  const month = MONTHS_FR[Number(m[2]) - 1];
  if (!month) return String(iso);
  return `${Number(m[3]) === 1 ? "1er" : Number(m[3])} ${month} ${m[1]}`;
}

/** Instant ISO -> « 4 juillet 2026 à 14:05 » (UTC : l'affichage Africa/Abidjan est à UTC+0). */
export function formatDateTimeFr(iso: unknown): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(iso ?? ""));
  return m ? `${formatDateFr(m[1])} à ${m[2]}:${m[3]}` : String(iso ?? "");
}

/** « 12.5 » -> « 12,50 » ; « 12 » -> « 12,00 » (chaîne décimale exacte, virgule française, aucun arrondi). */
export function formatNumberFr(value: unknown): string {
  const s = String(value ?? "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  const [int, frac = ""] = s.split(".");
  return `${int},${frac.padEnd(2, "0")}`;
}

export interface RenderEnvironment {
  /** Composants de plateforme (`{{> nom}}`), sources déjà analysées. */
  partials: Readonly<Record<string, ParsedTemplate>>;
  /** Composants à sortie de confiance (`{{@nom arg}}`) : renvoient du HTML sûr (QR en SVG, `<img>` data URI…). */
  components: Readonly<Record<string, (arg: string | null, scope: Scope) => string>>;
}

export interface Scope {
  readonly root: unknown;
  readonly stack: readonly unknown[];
}

function lookup(scope: Scope, path: string): unknown {
  const segments = path.split(".");
  const head = segments[0]!;
  let value: unknown;
  if (head === "$root") value = scope.root;
  else if (head === "this") value = scope.stack[scope.stack.length - 1];
  else if (head.startsWith("$")) value = (scope.stack[scope.stack.length - 1] as { __meta?: Record<string, unknown> } | undefined)?.__meta?.[head.slice(1)];
  else {
    value = undefined;
    for (let i = scope.stack.length - 1; i >= 0; i -= 1) {
      const frame = scope.stack[i];
      if (frame !== null && typeof frame === "object" && Object.prototype.hasOwnProperty.call(frame, head)) {
        value = (frame as Record<string, unknown>)[head];
        break;
      }
    }
    if (value === undefined && scope.root !== null && typeof scope.root === "object" && Object.prototype.hasOwnProperty.call(scope.root, head)) {
      value = (scope.root as Record<string, unknown>)[head];
    }
  }
  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i]!;
    if (FORBIDDEN_SEGMENTS.has(seg) || value === null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, seg)) return undefined;
    value = (value as Record<string, unknown>)[seg];
  }
  return value;
}

const truthy = (v: unknown): boolean => !(v === undefined || v === null || v === false || v === "" || v === 0 || (Array.isArray(v) && v.length === 0));

function applyFilter(value: unknown, filter: { name: string; arg: string | null }, scope: Scope): unknown {
  switch (filter.name) {
    case "upper": return String(value ?? "").toLocaleUpperCase("fr-FR");
    case "lower": return String(value ?? "").toLocaleLowerCase("fr-FR");
    case "date_fr": return formatDateFr(value);
    case "datetime_fr": return formatDateTimeFr(value);
    case "number_fr": return formatNumberFr(value);
    case "default": return truthy(value) ? value : (filter.arg ?? "");
    case "join": return Array.isArray(value) ? value.map((v) => String(v ?? "")).join(filter.arg ?? ", ") : String(value ?? "");
    case "initial": return String(value ?? "").trim().slice(0, 1).toLocaleUpperCase("fr-FR");
    case "label": {
      const labels = lookup(scope, "$root.labels");
      const code = String(value ?? "");
      return labels && typeof labels === "object" && Object.prototype.hasOwnProperty.call(labels, code) ? (labels as Record<string, unknown>)[code] : code;
    }
    default: return value;
  }
}

export function renderTemplate(template: ParsedTemplate, context: unknown, env: RenderEnvironment): string {
  let visited = 0;
  let bytes = 0;
  const out: string[] = [];
  const emit = (s: string): void => {
    bytes += s.length;
    if (bytes > MAX_OUTPUT_BYTES) throw new TemplateError("Sortie trop volumineuse");
    out.push(s);
  };

  const walk = (nodes: readonly Node[], scope: Scope, depth: number): void => {
    for (const node of nodes) {
      visited += 1;
      if (visited > MAX_NODES_VISITED) throw new TemplateError("Gabarit trop complexe (budget de nœuds dépassé)");
      switch (node.t) {
        case "text":
          emit(node.v);
          break;
        case "var": {
          let v = lookup(scope, node.path);
          for (const f of node.filters) v = applyFilter(v, f, scope);
          emit(escapeHtml(v));
          break;
        }
        case "if": {
          const show = truthy(lookup(scope, node.path)) !== node.negate;
          walk(show ? node.body : node.otherwise, scope, depth);
          break;
        }
        case "each": {
          const list = lookup(scope, node.path);
          if (!Array.isArray(list)) break;
          const items = list.slice(0, node.limit);
          items.forEach((item, index) => {
            const frame =
              item !== null && typeof item === "object" && !Array.isArray(item)
                ? { ...(item as Record<string, unknown>), __meta: { index, number: index + 1, first: index === 0, last: index === items.length - 1 } }
                : { value: item, __meta: { index, number: index + 1, first: index === 0, last: index === items.length - 1 } };
            walk(node.body, { root: scope.root, stack: [...scope.stack, frame] }, depth);
          });
          break;
        }
        case "partial": {
          const partial = env.partials[node.name];
          if (!partial) throw new TemplateError(`Composant de plateforme inconnu « ${node.name} »`, node.line);
          if (depth >= MAX_PARTIAL_DEPTH) throw new TemplateError("Composants imbriqués trop profondément", node.line);
          walk(partial.nodes, scope, depth + 1);
          break;
        }
        case "component": {
          const fn = env.components[node.name];
          if (!fn) throw new TemplateError(`Composant inconnu « ${node.name} »`, node.line);
          emit(fn(node.arg, scope));
          break;
        }
      }
    }
  };
  walk(template.nodes, { root: context, stack: [context] }, 0);
  return out.join("");
}

/** Valeur d'un chemin du contexte (utilisée par les composants, ex. `{{@image signature.0}}`). */
export function readPath(scope: Scope, path: string): unknown {
  return PATH_RE.test(path) ? lookup(scope, path) : undefined;
}
