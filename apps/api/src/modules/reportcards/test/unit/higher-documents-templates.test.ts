/** Gabarits de plateforme des documents officiels du supérieur : validation de sécurité, rendu déterministe, échappement. */
import { describe, expect, it } from "vitest";
import { renderContextHtml } from "../../domain/document-html";
import { PARTIAL_NAMES } from "../../domain/document-html";
import { validateOptionsSchema } from "../../domain/options-schema";
import { validateTemplate } from "../../domain/template-validation";
import { validatePlatformTemplate } from "../../application/platform";
import { ALL_PLATFORM_TEMPLATES, BUILTIN_TEMPLATES, PACK_PLATFORM_DOCUMENT_TEMPLATES, PLATFORM_DOCUMENT_TEMPLATES } from "../../templates/builtin";

const CONTEXT = {
  title: "Diplôme",
  meta: { versionText: "Duplicata n° 1", code: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", verifyUrl: "https://verif.example.test/v/ABC", hasQr: false, issuedAt: "2026-11-20T09:00:00.000Z" },
  institution: { legalName: "Établissement de démonstration", headerLeft: [], headerRight: [], contactLine: "Abidjan", registrationRef: "", footerText: "" },
  student: { fullName: "ÉTUDIANT <b>Alice</b>", birthLine: "Né(e) le 1er avril 2003 à Abidjan" },
  text: { conferred: "Le présent diplôme est délivré à", gradeLine: "Grade : LICENCE", certified: "Nous soussignés certifions que", succeeded: "a satisfait", validity: "Valable.", authentic: "est titulaire" },
  diploma: { label: "Licence <script>alert(1)</script>", gradeCode: "LICENCE", awardReference: "DIP-1" },
  program: { label: "Génie logiciel", code: "GL" },
  ues: [{ code: "UE1", label: "Unité 1", credits: "6" }],
  creditsTotal: "6",
  mention: { label: "Assez bien", average: "13.400" },
  academicYear: { label: "2026-2027" },
  acquiredDate: "2026-09-15",
  issueDate: "2026-11-20",
  reference: "DIP-2026-000001",
  duplicateOf: "DIP-2026-000001",
  signatories: [{ slot: "diploma-left", slotLabel: "Le Directeur général", name: "Personne Fictive Une", title: "Pr", jobFunction: null }],
};

describe("gabarits de plateforme du supérieur (diplôme, attestations)", () => {
  it("trois gabarits, une nature de document chacun, hors de la liste des bulletins ; tous passent la validation de sécurité", () => {
    expect(PLATFORM_DOCUMENT_TEMPLATES.map((t) => [t.key, t.documentKind])).toEqual([
      ["higher-diploma", "DIPLOMA"],
      ["higher-attestation-success", "ATTESTATION_SUCCESS"],
      ["higher-attestation-authenticity", "ATTESTATION_AUTHENTICITY"],
    ]);
    expect(BUILTIN_TEMPLATES.map((t) => t.key)).not.toContain("higher-diploma");
    expect(ALL_PLATFORM_TEMPLATES).toHaveLength(BUILTIN_TEMPLATES.length + 3 + PACK_PLATFORM_DOCUMENT_TEMPLATES.length);
    for (const t of PLATFORM_DOCUMENT_TEMPLATES) {
      const r = validateTemplate({ body: t.body, css: t.css, partialNames: PARTIAL_NAMES });
      expect(r.problems, t.key).toEqual([]);
      expect(validateOptionsSchema(t.optionsSchema), t.key).toEqual([]);
      expect(validatePlatformTemplate(t), t.key).toEqual([]);
      expect(t.body).not.toMatch(/IPAM|IMHOTEP|EXASP/i);
    }
  });

  for (const t of PLATFORM_DOCUMENT_TEMPLATES) {
    it(`${t.key} : rendu déterministe, contexte échappé, aucun script, aucune URL externe`, () => {
      const render = () => renderContextHtml({ template: { body: t.body, css: t.css }, context: CONTEXT, title: "Document", colors: { primary: "#14532D", secondary: "#5b7aa3" }, qrSvg: null, provisional: false });
      const html = render();
      expect(html).toBe(render());
      expect(html).toContain("ÉTABLISSEMENT DE DÉMONSTRATION");
      expect(html).toContain("DIP-2026-000001");
      expect(html).toContain("Personne Fictive Une");
      expect(html).toContain("#14532D");
      expect(html).not.toMatch(/<script|<iframe|<link|<object|onerror|javascript:/i);
      expect(html).not.toContain("<b>Alice</b>");
      expect(html).toContain("&lt;b&gt;Alice&lt;/b&gt;");
      expect(html).not.toMatch(/https?:\/\/(?!verif\.example\.test)/);
    });
  }
});
