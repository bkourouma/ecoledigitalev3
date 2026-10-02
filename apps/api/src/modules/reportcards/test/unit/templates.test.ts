import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PARTIAL_NAMES, renderContextHtml, renderDocumentHtml } from "../../domain/document-html";
import { resolveOptions, validateOptionsSchema } from "../../domain/options-schema";
import { escapeHtml, formatDateFr, formatNumberFr, parseTemplate, renderTemplate, TemplateError, type RenderEnvironment } from "../../domain/template-engine";
import { validateCss, validateTemplate } from "../../domain/template-validation";
import { PARTIAL_SOURCES } from "../../templates/partials";
import { BUILTIN_TEMPLATES } from "../../templates/builtin";
import { encodeQr, qrToSvg } from "../../domain/qr";
import { ALL_BUILTIN_KEYS, OFFICIAL_BUILTIN_KEYS, officialContext, snapshotFor } from "../support/fixtures";

const ENV: RenderEnvironment = { partials: {}, components: {} };
const render = (src: string, ctx: unknown, env: RenderEnvironment = ENV): string => renderTemplate(parseTemplate(src), ctx, env);

describe("moteur de gabarit sans logique", () => {
  it("substitue et ÉCHAPPE toujours (prénom contenant <b>, guillemets, esperluette, apostrophe)", () => {
    const out = render("<p>{{ name }}</p>", { name: `<b>"O'Brien" & fils</b><script>alert(1)</script>` });
    expect(out).toBe("<p>&lt;b&gt;&quot;O&#39;Brien&quot; &amp; fils&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(out).not.toContain("<script");
    expect(escapeHtml("`x`")).toBe("&#96;x&#96;");
  });

  it("interdit la sortie non échappée {{{ }}}", () => {
    expect(() => parseTemplate("{{{ name }}}")).toThrow(TemplateError);
  });

  it("boucles bornées : limit respecté, $index/$number, listes de scalaires via this.value", () => {
    const out = render("{{#each items limit=2}}[{{ $number }}:{{ this.value }}]{{/each}}", { items: ["a", "b", "c"] });
    expect(out).toBe("[1:a][2:b]");
    expect(() => parseTemplate("{{#each items limit=9999}}{{/each}}")).toThrow(/limit/);
    expect(render("{{#each missing}}x{{/each}}", {})).toBe("");
  });

  it("if / else / unless : présence seulement (null, vide, 0, liste vide = faux)", () => {
    const t = "{{#if v}}Y{{else}}N{{/if}}{{#unless v}}U{{/unless}}";
    expect(render(t, { v: "x" })).toBe("Y");
    for (const falsy of [null, "", 0, false, [], undefined]) expect(render(t, { v: falsy })).toBe("NU");
  });

  it("filtres de la liste fermée ; filtre inconnu refusé ; default / join / label / dates françaises", () => {
    expect(render('{{ d | date_fr }}', { d: "2026-07-04" })).toBe("4 juillet 2026");
    expect(render('{{ d | date_fr }}', { d: "2026-01-01" })).toBe("1er janvier 2026");
    expect(render('{{ v | default:"--" }}', { v: "" })).toBe("--");
    expect(render('{{ list | join:" / " }}', { list: ["a", "b"] })).toBe("a / b");
    expect(render("{{ c | label }}", { c: "ADM", labels: { ADM: "Admis" } })).toBe("Admis");
    expect(render("{{ n | number_fr }}", { n: "12.5" })).toBe("12,50");
    expect(render("{{ s | upper }}", { s: "élève" })).toBe("ÉLÈVE");
    expect(formatDateFr("n'importe quoi")).toBe("n'importe quoi");
    expect(formatNumberFr("abc")).toBe("abc");
    expect(() => parseTemplate("{{ x | eval }}")).toThrow(/inconnu/);
  });

  it("ne lit que des propriétés PROPRES : pas de __proto__, constructor, prototype ; aucune fonction appelée", () => {
    expect(render("{{ constructor }}|{{ a.constructor }}|{{ a.__proto__ }}|{{ toString }}|{{ a.prototype }}", { a: {} })).toBe("||||");
    expect(render("{{ a.map }}|{{ a.push }}", { a: [1, 2, 3] })).toBe("|");
  });

  it("chemins invalides, blocs non fermés, fermetures inattendues, étiquettes imbriquées : refusés", () => {
    for (const bad of ["{{ a b }}", "{{#if x}}", "{{/if}}", "{{#each x}}{{/if}}", "{{ {{ x }} }}", "{{ a-b }}", "{{#if x limit=3}}{{/if}}", "{{ }}", "{{ eval(1) }}", "{{#while x}}{{/while}}"]) {
      expect(() => parseTemplate(bad), bad).toThrow(TemplateError);
    }
  });

  it("budget de nœuds : un gabarit pathologique (boucles imbriquées) est interrompu", () => {
    const big = Array.from({ length: 1500 }, (_, i) => i);
    const evil = "{{#each a limit=1500}}{{#each a limit=1500}}{{#each a limit=1500}}x{{/each}}{{/each}}{{/each}}";
    expect(() => render(evil, { a: big })).toThrow(/budget|volumineuse/);
  });

  it("composants : registre fermé, profondeur bornée", () => {
    expect(() => parseTemplate("{{@exec cmd}}")).toThrow(/inconnu/);
    const loop = parseTemplate("{{> a}}");
    const env: RenderEnvironment = { partials: { a: parseTemplate("x{{> a}}") }, components: {} };
    expect(() => renderTemplate(loop, {}, env)).toThrow(/profondément/);
    expect(() => render("{{> nope}}", {})).toThrow(/inconnu/);
  });
});

describe("validation d'un gabarit à la publication (liste noire / blanche)", () => {
  const ok = { css: "", partialNames: PARTIAL_NAMES };
  const refused = (body: string, css = ""): string => {
    const r = validateTemplate({ body, css, partialNames: PARTIAL_NAMES });
    expect(r.ok, `devrait être refusé : ${body.slice(0, 60)}`).toBe(false);
    return r.problems.map((p) => p.code).join(",");
  };

  it("accepte du HTML de mise en forme sans lien ni script", () => {
    expect(validateTemplate({ body: '<div class="a"><table><tr><td colspan="2">{{ x }}</td></tr></table></div>', ...ok }).ok).toBe(true);
  });

  it("refuse <script>, <iframe>, <object>, <embed>, <link>, <meta>, <base>, <form>, <svg>, <style>, <img>", () => {
    for (const tag of ["script", "iframe", "object", "embed", "link", "meta", "base", "form", "svg", "style", "img", "video", "input", "a"]) {
      expect(refused(`<div><${tag}>x</${tag}></div>`)).toContain("html_tag");
    }
    expect(refused('<script>alert(1)</script>')).toContain("html_tag");
    expect(refused('<link href="http://evil.example/x.css">')).toMatch(/html_tag|html_url/);
    expect(refused('<img src="http://169.254.169.254/latest/meta-data">')).toMatch(/html_tag|html_url/);
  });

  it("refuse attributs d'événement, href, src, srcset, action, style avec url ou étiquette", () => {
    expect(refused('<div onclick="x()">a</div>')).toContain("html_event");
    expect(refused('<div onload=x>a</div>')).toContain("html_event");
    expect(refused('<td href="x">a</td>')).toContain("html_attribute");
    expect(refused('<div src="x">a</div>')).toContain("html_attribute");
    expect(refused('<div formaction="x">a</div>')).toContain("html_attribute");
    expect(refused('<div style="background:url(http://evil.example/x.png)">a</div>')).toContain("css_url");
    expect(refused('<div style="background:url(file:///etc/passwd)">a</div>')).toContain("css_url");
    expect(refused('<div style="color: {{ x }}">a</div>')).toContain("html_style_template");
    expect(refused('<div data-x="1">a</div>')).toContain("html_attribute");
  });

  it("refuse commentaires, déclarations, instructions, balises mal formées, URL et schémas dans le texte", () => {
    expect(refused("<!-- x -->a")).toContain("html_declaration");
    expect(refused("<!DOCTYPE html>a")).toContain("html_declaration");
    expect(refused("<?xml version='1.0'?>a")).toContain("html_instruction");
    expect(refused("<div>http://evil.example</div>")).toContain("html_url");
    expect(refused("<div>javascript:alert(1)</div>")).toContain("html_url");
    expect(refused("<div>file:///etc/passwd</div>")).toContain("html_url");
    expect(refused("<div>see //evil.example/x</div>")).toContain("html_url");
    expect(refused("<scr<script>ipt>x</script>")).toBeTruthy();
    expect(refused("<div <b>x</div>")).toBeTruthy();
  });

  it("une étiquette placée DANS une balise (injection de balise ou d'attribut) est refusée", () => {
    expect(refused("<{{ tag }}>x</div>")).toBeTruthy();
    expect(refused("<div {{ attrs }}>x</div>")).toContain("html_attribute");
    expect(refused('<div class="a" {{ more }}>x</div>')).toContain("html_attribute");
  });

  it("refuse composants, filtres et syntaxe inconnus", () => {
    expect(refused("{{> pas-un-composant}}")).toContain("partial");
    expect(refused("{{@exec x}}")).toContain("syntax");
    expect(refused("{{ x | system }}")).toContain("syntax");
    expect(refused("{{#each x}}")).toContain("syntax");
  });

  it("CSS : refuse @import, expression(), behavior, -moz-binding, échappements, </style>, url() externe, @font-face externe, //", () => {
    for (const css of [
      "@import url('http://evil.example/x.css');",
      "@import 'x.css';",
      "a { width: expression(alert(1)); }",
      "a { behavior: url(x.htc); }",
      "a { -moz-binding: url(x); }",
      "a { background: u\\72l(http://x); }",
      "a { color: red; } </style><script>x</script>",
      "a { background: url(http://evil.example/p.png); }",
      "a { background: url('//evil.example/p.png'); }",
      "a { background: url(data:text/html;base64,AAAA); }",
      "a { background: url(file:///c:/x.png); }",
      "@font-face { font-family: X; src: url(http://evil.example/f.woff); }",
      "a { content: '//evil.example'; }",
      "@charset 'utf-8';",
      "a { color: {{ x }}; }",
    ]) {
      expect(validateCss(css, "t").length, css).toBeGreaterThan(0);
    }
    expect(validateCss("a { color: #fff; background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==); } /* // ok en commentaire */", "t")).toEqual([]);
    expect(validateCss("@page { size: A4; margin: 10mm; } .a > .b { color: red }", "t").length).toBeGreaterThan(0); // « > » interdit
  });

  it("les 7 gabarits livrés (5 bulletins/relevés + reçu + bulletin de paie) et tous les composants passent la validation de sécurité", () => {
    expect([...ALL_BUILTIN_KEYS].sort()).toEqual(["higher-bulletin-coef", "higher-bulletin-credits", "primary-bulletin", "secondary-bulletin", "transcript-credits"]);
    expect([...OFFICIAL_BUILTIN_KEYS].sort()).toEqual(["payslip-standard", "receipt-standard"]);
    for (const t of BUILTIN_TEMPLATES) {
      const r = validateTemplate({ body: t.body, css: t.css, partialNames: PARTIAL_NAMES });
      expect(r.problems, t.key).toEqual([]);
      expect(validateOptionsSchema(t.optionsSchema), t.key).toEqual([]);
    }
    for (const [name, src] of Object.entries(PARTIAL_SOURCES)) {
      const r = validateTemplate({ body: src, css: "", partialNames: PARTIAL_NAMES });
      expect(r.problems, `partial ${name}`).toEqual([]);
    }
  });

  it("aucune mention d'un établissement ou d'une personne réels dans le code ni les gabarits (critère de sortie 6)", () => {
    const root = resolve(__dirname, "../..");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== "test" && entry !== "node_modules") walk(p);
        } else if (/\.(ts|sql|md)$/.test(entry)) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(20);
    const hits = files.filter((f) => /IPAM|IMHOTEP|EXASP/i.test(readFileSync(f, "utf8").replace(/aucune mention[^\n]*/gi, "")));
    // Seuls le README et ce contrôle citent ces noms pour dire qu'ils sont interdits.
    expect(hits.map((h) => h.replace(root, "")).filter((h) => !/README\.md$/.test(h))).toEqual([]);
  });
});

describe("options de gabarit validées par le schéma", () => {
  const schema = BUILTIN_TEMPLATES[1]!.optionsSchema;
  it("applique les défauts et renvoie des options RÉSOLUES et typées", () => {
    const r = resolveOptions(schema, { showRank: false });
    expect(r.ok && r.value).toMatchObject({ showRank: false, showClassAverage: false, showAttendance: true, watermark: "" });
  });
  it("refuse une option inconnue, un mauvais type, une valeur hors bornes ou avec balises", () => {
    for (const bad of [{ nope: 1 }, { showRank: "oui" }, { watermark: "x".repeat(41) }, { watermark: "<b>x</b>" }]) {
      expect(resolveOptions(schema, bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it("sous-ensemble : entiers bornés, énumérations, listes bornées ; schéma invalide détecté", () => {
    const s = { type: "object", additionalProperties: false, properties: { n: { type: "integer", minimum: 1, maximum: 3, default: 2 }, c: { type: "string", enum: ["a", "b"] }, l: { type: "array", maxItems: 2, items: { type: "string", enum: ["x", "y"] } } } };
    expect(resolveOptions(s, {})).toEqual({ ok: true, value: { n: 2, c: null, l: null } });
    expect(resolveOptions(s, { n: 4 }).ok).toBe(false);
    expect(resolveOptions(s, { c: "z" }).ok).toBe(false);
    expect(resolveOptions(s, { l: ["x", "y", "x"] }).ok).toBe(false);
    expect(resolveOptions(s, { l: ["q"] }).ok).toBe(false);
    expect(validateOptionsSchema({ type: "array" }).length).toBeGreaterThan(0);
    expect(validateOptionsSchema({ type: "object", properties: { x: { type: "object" } } }).length).toBeGreaterThan(0);
  });
});

describe("rendu HTML déterministe des 5 gabarits", () => {
  const verification = (code: string) => ({ code, url: `https://verif.example.test/v/${code}`, qrSvg: qrToSvg(encodeQr(`https://verif.example.test/v/${code}`)) });
  const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, 26);

  for (const key of ALL_BUILTIN_KEYS) {
    it(`${key} : contenu du snapshot, QR, code, CSP, aucun script, déterministe`, () => {
      const s = snapshotFor(key);
      const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification: verification(code) });
      const again = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification: verification(code) });
      expect(html).toBe(again);
      expect(html).toContain("Établissement de Démonstration".toUpperCase());
      expect(html).toContain("TESTEUR Amina");
      expect(html).toContain(`Code : ${code}`);
      expect(html).toContain("<svg xmlns");
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("Personne Fictive Une");
      expect(html).not.toMatch(/<script|<iframe|<link|<object|onerror|javascript:/i);
      expect(html.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:\/\/(?!verif\.example\.test)/);
      expect(html).toContain("#14532D");
    });
  }

  it("date de délibération = date RÉELLE du snapshot (jamais la date du jour d'impression)", () => {
    const s = snapshotFor("higher-bulletin-credits", { deliberationDate: "2025-12-17" });
    const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification: verification(code) });
    expect(html).toContain("17 décembre 2025");
    expect(html).toContain("Le jury, vu le procès-verbal de délibération du jury en date du 17 décembre 2025");
    const today = formatDateFr(new Date().toISOString());
    expect(html).not.toContain(today);
    const none = snapshotFor("higher-bulletin-credits", { deliberationDate: null });
    expect(renderDocumentHtml({ snapshot: none.snapshot, template: { body: none.template.body, css: none.template.css }, verification: verification(code) })).not.toContain("procès-verbal");
  });

  it("injection par les données d'un élève : prénom <b>, guillemets, <script>, <img onerror> sont échappés partout", () => {
    for (const key of ALL_BUILTIN_KEYS) {
      const s = snapshotFor(key, { hostile: true });
      const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification: verification(code) });
      expect(html, key).not.toContain("<script>alert");
      expect(html, key).not.toContain("<img src=x");
      expect(html, key).not.toContain("<b>O'Brien");
      expect(html, key).toContain("&lt;B&gt;"); // le nom de famille est mis en capitales puis échappé
      expect(html, key).toContain("&lt;SCRIPT&gt;");
      expect(html, key).toContain("&quot;ZOÉ&quot;");
      expect(html, key).toContain("&lt;img src=x onerror=alert(1)&gt;");
    }
  });

  it("document PROVISOIRE : filigrane, aucun QR ni code, mention « non vérifiable »", () => {
    const s = snapshotFor("secondary-bulletin", { provisional: true });
    const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification: verification(code) });
    expect(html).toContain("PROVISOIRE");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain(`Code : ${code}`);
    expect(html).toContain("non vérifiable");
  });

  it("options : rang et moyenne de classe pilotés par la configuration ; filigrane d'option échappé", () => {
    const s = snapshotFor("secondary-bulletin", { options: { showRank: false, showClassAverage: true, watermark: "COPIE" } });
    const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification: verification(code) });
    expect(html).not.toContain("<th>Rang</th>");
    expect(html).toContain("Moyenne de la classe");
    expect(html).toContain('<div class="watermark">COPIE</div>');
    const withRank = snapshotFor("secondary-bulletin");
    expect(renderDocumentHtml({ snapshot: withRank.snapshot, template: { body: withRank.template.body, css: withRank.template.css }, verification: verification(code) })).toContain("<th>Rang</th>");
  });

  it("images : seules des data URI d'images valides sont injectées ; une URL ou du SVG est ignoré", () => {
    const s = snapshotFor("secondary-bulletin");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification: verification(code), assets: { logo: png, emblem: "http://evil.example/x.png", signatures: { director: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" } } });
    expect(html).toContain(`<img class="img-logo" alt="" src="${png}">`);
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("image/svg");
  });

  it("refuse au rendu un gabarit altéré en base (revalidation)", () => {
    const s = snapshotFor("secondary-bulletin");
    expect(() => renderDocumentHtml({ snapshot: s.snapshot, template: { body: `${s.template.body}<script>alert(1)</script>`, css: s.template.css }, verification: null })).toThrow(/refusé au rendu/);
    expect(() => renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: `${s.template.css} @import url(http://x);` }, verification: null })).toThrow(/refusé au rendu/);
  });
});

describe("rendu HTML des documents officiels d'autres modules (reçu, bulletin de paie)", () => {
  const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const qr = qrToSvg(encodeQr(`https://verif.example.test/v/${code}`));
  const htmlOf = (key: string, hostile = false): string => {
    const t = BUILTIN_TEMPLATES.find((x) => x.key === key)!;
    const ctx = officialContext(key, { hostile });
    return renderContextHtml({ template: { body: t.body, css: t.css }, context: ctx, title: String(ctx.title), colors: { primary: "#14532D", secondary: "#5b7aa3" }, qrSvg: qr, provisional: false });
  };

  for (const key of OFFICIAL_BUILTIN_KEYS) {
    it(`${key} : identité, contenu, QR, code, CSP, aucun script, déterministe`, () => {
      const html = htmlOf(key);
      expect(html).toBe(htmlOf(key));
      expect(html).toContain("ÉTABLISSEMENT DE DÉMONSTRATION");
      expect(html).toContain("KOUASSI Aya Fictive");
      expect(html).toContain(`Code : ${code}`);
      expect(html).toContain("<svg xmlns");
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("Pied de page de démonstration.");
      expect(html).not.toMatch(/<script|<iframe|<link|<object|onerror|javascript:/i);
      expect(html.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:\/\/(?!verif\.example\.test)/);
    });
    it(`${key} : un nom hostile (balises, guillemets, script) est échappé partout`, () => {
      const html = htmlOf(key, true);
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<b>\"O'Brien");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).toContain("&quot;O&#39;Brien&quot;");
    });
  }

  it("reçu : imputations et reste dû ; bulletin de paie : lignes, ajustements et net à payer", () => {
    const r = htmlOf("receipt-standard");
    for (const s of ["REC-2026-000042", "MAT-0042", "Espèces", "25 000 F CFA", "FAC-2026-000007", "1re tranche", "75 000 F CFA"]) expect(r).toContain(s);
    expect(r).not.toContain("Non imputé"); // champ vide : ligne omise
    const p = htmlOf("payslip-standard");
    for (const s of ["ENS-007", "Septembre 2025", "Mathématiques — 6e A", "Prime — Prime d&#39;assiduité", "280 000 F CFA", "Net à payer"]) expect(p).toContain(s);
  });
});
