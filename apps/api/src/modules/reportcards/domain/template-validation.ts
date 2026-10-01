/**
 * Validation d'un gabarit PLATEFORME à la publication (spec 013 AC5.4, R-RC-07, risque R1).
 *
 * Défense en profondeur : cette liste blanche / liste noire REFUSE à la publication tout ce qui pourrait exécuter du code
 * ou émettre une requête dans Chromium ; le rendu, lui, s'exécute JavaScript désactivé et réseau coupé (test d'injection
 * dans `test/unit/pdf-renderer.test.ts`). Aucun HTML libre n'est accepté d'un tenant en V1 : seuls les gabarits revus et
 * publiés par la plateforme passent ici.
 *
 *  - balises : liste BLANCHE (structure et mise en forme) ; `<img>` n'existe que par le composant `{{@image …}}` ;
 *  - attributs : class, id, colspan, rowspan, scope, lang, dir, style (déclarations CSS validées, sans étiquette de gabarit) ;
 *  - jamais de `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<base>`, `<meta>`, `<form>`, `<svg>`, `<style>` dans le corps,
 *    de commentaire HTML, d'attribut `on*`, `href`, `src`, `srcset`, `action`, d'URL (`http(s):`, `file:`, `ftp:`, `//`,
 *    `javascript:`, `data:` hors `url(data:image/…)` du CSS) ;
 *  - CSS : ni `@import`, ni `expression(`, `behavior`, `-moz-binding`, `\`, `<`, `>`, ni `url()` autre que
 *    `data:image/(png|jpeg|gif|webp)` ;
 *  - composants `{{> x}}`, `{{@x}}` et filtres : listes fermées.
 *
 * L'analyse HTML porte sur une VUE du corps où chaque étiquette `{{ … }}` est remplacée par un jeton neutre : une étiquette
 * placée dans une balise (injection d'attribut ou de nom de balise) donne alors une balise ou un attribut refusés.
 */
import { COMPONENT_NAMES, FILTER_NAMES, TemplateError, parseTemplate, type ParsedTemplate } from "./template-engine";

export interface TemplateProblem {
  readonly code: string;
  readonly message: string;
}

const ALLOWED_TAGS = new Set([
  "div", "span", "p", "section", "header", "footer", "main", "article", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "b", "i", "u", "small", "sub", "sup", "br", "hr", "ul", "ol", "li", "blockquote",
]);
const VOID_TAGS = new Set(["br", "hr", "col"]);
const ALLOWED_ATTRIBUTES = new Set(["class", "id", "colspan", "rowspan", "scope", "lang", "dir", "style"]);

const URL_SCHEME_RE = /(?:^|[^a-z0-9_])[a-z][a-z0-9+.-]{1,20}:\/\/|\bfile:|\bjavascript:|\bvbscript:|\bdata:|\bftp:|\bmailto:|\btel:|(?:^|[\s"'(=])\/\/[a-z0-9]/i;
const DATA_URL_RE = /url\(\s*['"]?data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+['"]?\s*\)/gi;

/** Valide une feuille de style ou une valeur de `style=""`. */
export function validateCss(css: string, where: string): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const add = (code: string, message: string): void => void problems.push({ code, message: `${where} : ${message}` });
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(noComments)) add("css_import", "@import est interdit");
  if (/@charset\b/i.test(noComments)) add("css_charset", "@charset est interdit");
  if (/expression\s*\(/i.test(noComments)) add("css_expression", "expression() est interdit");
  if (/behaviou?r\s*:/i.test(noComments) || /-moz-binding/i.test(noComments)) add("css_binding", "behavior / -moz-binding sont interdits");
  if (/\\/.test(css)) add("css_escape", "les échappements CSS (\\) sont interdits");
  if (/[<>]/.test(css)) add("css_markup", "« < » et « > » sont interdits dans le CSS");
  if (/javascript:|vbscript:/i.test(noComments)) add("css_script", "schéma de script interdit");
  if (/\{\{|\}\}/.test(css)) add("css_template", "aucune étiquette de gabarit dans le CSS");
  const noDataUrls = noComments.replace(DATA_URL_RE, "url()");
  if (/:\/\/|(?:^|[\s(,:'"])\/\//.test(noDataUrls)) add("css_url", "URL externe interdite");
  const urlRe = /url\s*\(\s*([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(noComments)) !== null) {
    const target = m[1]!.trim().replace(/^['"]|['"]$/g, "");
    if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(target)) add("css_url", "url() n'accepte que des images data:image/(png|jpeg|gif|webp);base64");
  }
  if (/@font-face/i.test(noComments) && !/src\s*:\s*url\(\s*['"]?data:/i.test(noComments)) add("css_font", "@font-face n'accepte qu'une police embarquée en data:");
  return problems;
}

function validateHtmlView(view: string, problems: TemplateProblem[]): void {
  const add = (code: string, message: string): void => void problems.push({ code, message });
  if (/<!/.test(view)) add("html_declaration", "commentaires et déclarations HTML interdits (« <! »)");
  if (/<\?/.test(view)) add("html_instruction", "instructions de traitement interdites (« <? »)");
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([^<>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(view)) !== null) {
    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const attrs = m[3]!;
    if (!ALLOWED_TAGS.has(name)) {
      add("html_tag", `balise <${name}> interdite`);
      continue;
    }
    if (closing) {
      if (attrs.trim()) add("html_closing_attrs", `attributs sur </${name}>`);
      continue;
    }
    const cleaned = attrs.replace(/\/\s*$/, "");
    const attrRe = /([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'<>`=]+))?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(cleaned)) !== null) {
      const attr = a[1]!.toLowerCase();
      const value = (a[2] ?? "").replace(/^['"]|['"]$/g, "");
      if (attr.startsWith("on")) add("html_event", `attribut ${attr} interdit`);
      else if (!ALLOWED_ATTRIBUTES.has(attr)) add("html_attribute", `attribut ${attr} interdit sur <${name}>`);
      else if (attr === "style") problems.push(...validateCss(value, `style de <${name}>`));
      else if (URL_SCHEME_RE.test(value)) add("html_url", `URL interdite dans ${attr}`);
    }
    if (/\/\s*$/.test(attrs)) add("html_selfclosing", `<${name}/> auto-fermante non supportée`);
  }
  // Un « < » qui ne forme pas une balise reconnue (« <script » incomplet, « <a<b ») est suspect.
  const stripped = view.replace(tagRe, " ");
  if (/<[a-zA-Z/!?]/.test(stripped)) add("html_malformed", "balise mal formée");
  if (URL_SCHEME_RE.test(stripped)) add("html_url", "URL ou schéma interdit dans le texte du gabarit");
  if (URL_SCHEME_RE.test(view.match(tagRe)?.join(" ") ?? "")) add("html_url", "URL ou schéma interdit dans une balise");
  // `VOID_TAGS` : conservé pour les futurs contrôles d'équilibre.
  void VOID_TAGS;
}

export interface ValidateTemplateInput {
  body: string;
  css: string;
  /** Composants de plateforme disponibles (`{{> nom}}`). */
  partialNames: readonly string[];
}

export interface TemplateValidation {
  readonly ok: boolean;
  readonly problems: readonly TemplateProblem[];
  readonly parsed: ParsedTemplate | null;
}

export function validateTemplate(input: ValidateTemplateInput): TemplateValidation {
  const problems: TemplateProblem[] = [];
  let parsed: ParsedTemplate | null = null;
  try {
    parsed = parseTemplate(input.body);
  } catch (e) {
    if (e instanceof TemplateError) problems.push({ code: "syntax", message: e.message });
    else throw e;
  }
  if (parsed) {
    for (const p of parsed.partials) {
      if (!input.partialNames.includes(p)) problems.push({ code: "partial", message: `composant de plateforme inconnu « ${p} »` });
    }
    for (const c of parsed.components) {
      if (!(COMPONENT_NAMES as readonly string[]).includes(c)) problems.push({ code: "component", message: `composant inconnu « ${c} »` });
    }
    for (const f of parsed.filters) {
      if (!(FILTER_NAMES as readonly string[]).includes(f)) problems.push({ code: "filter", message: `filtre inconnu « ${f} »` });
    }
    validateHtmlView(input.body.replace(/\{\{[\s\S]*?\}\}/g, "x"), problems);
    if (/style\s*=\s*(?:"[^"]*\{\{|'[^']*\{\{)/i.test(input.body)) {
      problems.push({ code: "html_style_template", message: "aucune étiquette de gabarit dans style=" });
    }
  }
  problems.push(...validateCss(input.css, "css du gabarit"));
  return { ok: problems.length === 0, problems, parsed };
}
