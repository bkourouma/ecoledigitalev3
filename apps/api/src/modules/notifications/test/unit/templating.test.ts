import { describe, expect, it } from "vitest";
import { NOTIF_CHANNELS, NOTIF_TEMPLATE_CODES } from "@ecoledigitale/contracts/src/v2/notifications";
import { CATALOG_COMPLETE, TEMPLATE_CATALOG, allVariables, catalogEntry } from "../../domain/catalog";
import { SHIPPED_TEXTS, findShippedTemplate, shippedTemplates } from "../../domain/default-templates";
import {
  buildEmailHtml,
  escapeHtml,
  formatMoneyFr,
  formatValue,
  parseTemplate,
  referencedVariables,
  renderSource,
  sampleValues,
  smsSegments,
  textToHtml,
  validateTemplateSource,
} from "../../domain/templating";

const absence = catalogEntry("absence")!;

describe("catalogue et gabarits livrés", () => {
  it("couvre exactement les codes du contrat, chacun avec un gabarit livré pour chaque canal", () => {
    expect(CATALOG_COMPLETE).toBe(true);
    expect(Object.keys(SHIPPED_TEXTS).sort()).toEqual([...NOTIF_TEMPLATE_CODES].sort());
    expect(shippedTemplates()).toHaveLength(NOTIF_TEMPLATE_CODES.length * NOTIF_CHANNELS.length);
  });

  it("couvre absence, retard, paiement reçu, facture, relance, bulletin, convocation, annonce, urgence", () => {
    for (const code of ["absence", "late", "payment_received", "invoice_issued", "payment_reminder", "report_card_published", "convocation", "announcement", "urgent_notice"]) {
      expect(catalogEntry(code), code).toBeDefined();
    }
  });

  it("chaque gabarit livré est valide : syntaxe, variables du catalogue, objet selon le canal", () => {
    for (const t of shippedTemplates()) {
      const entry = catalogEntry(t.code)!;
      const { issues } = validateTemplateSource({ entry, channel: t.channel, subject: t.subject, body: t.body });
      expect(issues, `${t.code}/${t.channel}`).toEqual([]);
    }
  });

  it("chaque gabarit livré se rend avec les valeurs d'exemple, sans variable résiduelle ni message vide", () => {
    for (const t of shippedTemplates()) {
      const entry = catalogEntry(t.code)!;
      const values = { ...sampleValues(entry), appUrl: "https://ecole.example.org" };
      const body = renderSource(t.body, entry, values, { appUrl: "https://ecole.example.org" });
      expect(body.errors, `${t.code}/${t.channel}`).toEqual([]);
      expect(body.text).not.toMatch(/\{\{|\}\}/);
      expect(body.text.length).toBeGreaterThan(5);
    }
  });

  it("le repli de langue retombe sur fr-CI", () => {
    expect(findShippedTemplate("absence", "SMS", "en-GB")?.locale).toBe("fr-CI");
    expect(findShippedTemplate("inconnu", "SMS")).toBeUndefined();
  });

  it("aucun gabarit livré n'exige une variable absente du catalogue", () => {
    for (const entry of TEMPLATE_CATALOG) {
      const known = new Set(allVariables(entry).map((v) => v.name));
      const text = SHIPPED_TEXTS[entry.code];
      for (const source of [text.title, text.short, text.long]) {
        const parsed = parseTemplate(source);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) for (const name of referencedVariables(parsed.tokens)) expect(known.has(name), `${entry.code}:${name}`).toBe(true);
      }
    }
  });
});

describe("analyse et validation", () => {
  it("refuse une variable inconnue, une balise orpheline, un bloc non refermé", () => {
    expect(validateTemplateSource({ entry: absence, channel: "SMS", subject: null, body: "Bonjour {{inconnue}}" }).issues[0]?.code).toBe("unknown_variable");
    expect(parseTemplate("Texte {{#studentName}}sans fin").ok).toBe(false);
    expect(parseTemplate("Texte {{/studentName}}").ok).toBe(false);
    expect(parseTemplate("Texte {{ ouverte").ok).toBe(false);
  });

  it("exige un objet pour l'e-mail, le push et l'in-app, et l'interdit pour le SMS et WhatsApp", () => {
    expect(validateTemplateSource({ entry: absence, channel: "EMAIL", subject: "", body: "x {{studentName}}" }).issues[0]?.code).toBe("missing_subject");
    expect(validateTemplateSource({ entry: absence, channel: "SMS", subject: "objet", body: "x" }).issues[0]?.code).toBe("unexpected_subject");
    expect(validateTemplateSource({ entry: absence, channel: "SMS", subject: null, body: "{{studentName}} absent le {{date}}" }).issues).toEqual([]);
  });

  it("accepte les variables intégrées schoolName et appUrl", () => {
    expect(validateTemplateSource({ entry: absence, channel: "SMS", subject: null, body: "{{schoolName}} {{appUrl}} {{studentName}}" }).issues).toEqual([]);
  });
});

describe("variables TYPÉES", () => {
  const def = (type: Parameters<typeof formatValue>[0]["type"]) => ({ name: "v", label: "v", type, required: true, sample: "" });

  it("date : AAAA-MM-JJ valide uniquement, rendue jj/mm/aaaa", () => {
    expect(formatValue(def("date"), "2026-10-02")).toBe("02/10/2026");
    expect(() => formatValue(def("date"), "2026-02-30")).toThrow(/date/);
    expect(() => formatValue(def("date"), "02/10/2026")).toThrow();
    expect(() => formatValue(def("date"), 20261002)).toThrow();
  });

  it("montant : entier en unités mineures + devise connue, espaces normaux (SMS)", () => {
    expect(formatValue(def("money"), { amount: 25000, currency: "XOF" })).toBe("25 000 F CFA");
    expect(formatMoneyFr(1999, "EUR")).toBe("19,99 €");
    expect(() => formatValue(def("money"), { amount: 12.5, currency: "XOF" })).toThrow();
    expect(() => formatValue(def("money"), { amount: 100, currency: "ZZZ" })).toThrow();
    expect(() => formatValue(def("money"), "25000")).toThrow();
    expect(formatValue(def("money"), { amount: 25000, currency: "XOF" })).not.toMatch(/[  ]/);
  });

  it("nombre : fini uniquement, format français", () => {
    expect(formatValue(def("number"), 1234.5)).toBe("1 234,5");
    expect(() => formatValue(def("number"), Number.NaN)).toThrow();
    expect(() => formatValue(def("number"), "12")).toThrow();
  });

  it("texte court : une seule ligne (pas d'injection d'en-tête), plafonné ; texte long : sauts de ligne conservés", () => {
    expect(formatValue(def("string"), "Awa\r\nBcc: x@y.z")).toBe("Awa Bcc: x@y.z");
    expect(() => formatValue(def("string"), "a".repeat(501))).toThrow();
    expect(formatValue(def("text"), "ligne 1\r\nligne 2")).toBe("ligne 1\nligne 2");
  });

  it("adresse : chemin interne résolu sur la base de l'application, https accepté, javascript: refusé", () => {
    expect(formatValue(def("url"), "/v2/parent", { appUrl: "https://ecole.example.org/" })).toBe("https://ecole.example.org/v2/parent");
    expect(formatValue(def("url"), "https://exemple.org/x")).toBe("https://exemple.org/x");
    expect(() => formatValue(def("url"), "javascript:alert(1)")).toThrow();
    expect(() => formatValue(def("url"), "//evil.example")).toThrow();
  });
});

describe("rendu", () => {
  it("une variable obligatoire manquante est une ERREUR, jamais un trou silencieux", () => {
    const r = renderSource("Absence de {{studentName}} le {{date}}", absence, { studentName: "Awa" });
    expect(r.errors.map((e) => e.variable)).toEqual(["date"]);
  });

  it("une variable mal typée est signalée", () => {
    const r = renderSource("{{date}}", absence, { studentName: "Awa", date: "hier" });
    expect(r.errors[0]?.message).toMatch(/date/);
  });

  it("les blocs conditionnels n'apparaissent que si la variable est renseignée", () => {
    const late = catalogEntry("late")!;
    const withMinutes = renderSource("{{studentName}}{{#minutesLate}} ({{minutesLate}} min){{/minutesLate}}", late, { studentName: "Awa", date: "2026-10-02", minutesLate: 15 });
    const without = renderSource("{{studentName}}{{#minutesLate}} ({{minutesLate}} min){{/minutesLate}}", late, { studentName: "Awa", date: "2026-10-02" });
    expect(withMinutes.text).toBe("Awa (15 min)");
    expect(without.text).toBe("Awa");
  });

  it("une valeur contenant des balises n'est jamais ré-interprétée", () => {
    const r = renderSource("{{studentName}}", absence, { studentName: "{{date}}", date: "2026-10-02" });
    expect(r.text).toBe("{{date}}");
  });
});

describe("HTML d'e-mail (jamais d'injection)", () => {
  it("échappe le contenu, les valeurs et le nom d'établissement", () => {
    const html = buildEmailHtml({ bodyText: '<script>alert(1)</script> & "x"', schoolName: "<b>École</b>", legalFooter: "<i>mention</i>", unsubscribeUrl: "https://e.example/u?t=a&b=c", category: "ATTENDANCE" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>École</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;i&gt;mention&lt;/i&gt;");
    expect(html).toContain("Se désinscrire");
    expect(html).toContain("t=a&amp;b=c");
  });

  it("les adresses https deviennent des liens, les autres schémas non", () => {
    expect(textToHtml("Voir https://ecole.example.org/x.")).toContain('<a href="https://ecole.example.org/x"');
    expect(textToHtml("javascript:alert(1)")).not.toContain("<a ");
    expect(escapeHtml("a<b")).toBe("a&lt;b");
  });
});

describe("SMS", () => {
  it("estime les segments GSM-7 et UCS-2", () => {
    expect(smsSegments("Bonjour")).toMatchObject({ segments: 1, encoding: "GSM-7" });
    expect(smsSegments("a".repeat(161))).toMatchObject({ segments: 2, encoding: "GSM-7" });
    expect(smsSegments("Élève absent ✓")).toMatchObject({ encoding: "UCS-2", segments: 1 });
    expect(smsSegments("é".repeat(71)).segments).toBe(1); // é est GSM-7 : 71 caractères = 1 segment
    expect(smsSegments("✓".repeat(71)).segments).toBe(2); // hors GSM : UCS-2, 70 caractères par segment
  });
});
