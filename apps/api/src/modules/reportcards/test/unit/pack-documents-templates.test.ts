/**
 * Phase 4-5 : gabarits des documents des packs (PV de conseil, bilan annuel du primaire, documents d'examen), bulletin
 * `report-primary` avec compétences, filigrane et mention « règles de démonstration » quand les résultats viennent d'un jeu fictif,
 * « Affecté(e) » dérivé du type de financement, natures de documents. Rendu pur : aucune base, aucun navigateur.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_OFFICIAL_TEMPLATE, DEMONSTRATION_NOTICE, DEMONSTRATION_WATERMARK, KNOWN_DOCUMENT_KINDS, OFFICIAL_DOCUMENT_KINDS, PACK_DOCUMENT_KINDS, isDemonstrationSource, isKnownDocumentKind, isOfficialDocumentKind } from "../../domain/constants";
import { PARTIAL_NAMES, renderContextHtml, renderDocumentHtml } from "../../domain/document-html";
import { validateOptionsSchema } from "../../domain/options-schema";
import { buildSnapshot } from "../../domain/snapshot";
import { validateTemplate } from "../../domain/template-validation";
import { validatePlatformTemplate } from "../../application/platform";
import { ALL_PLATFORM_TEMPLATES, PACK_PLATFORM_DOCUMENT_TEMPLATES, builtinTemplate } from "../../templates/builtin";
import { snapshotFor } from "../support/fixtures";

const INSTITUTION = { legalName: "Établissement de démonstration", headerLeft: [], headerRight: [], contactLine: "Abidjan", registrationRef: "", footerText: "" };
const META = { code: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", verifyUrl: "https://verif.example.test/v/ABC", hasQr: false, issuedAt: "2027-06-30T09:00:00.000Z" };

const CONTEXTS: Record<string, Record<string, unknown>> = {
  "council-minutes": {
    title: "PV du conseil des maîtres",
    council: { kindLabel: "Conseil des maîtres", heldOn: "2027-06-28", place: "Salle des maîtres", classroomLabel: "CM2 A", periodLabel: "Trimestre 3", academicYearLabel: "2026-2027", presidentName: "Personne <b>Fictive</b> Une", secretaryName: "Personne Fictive Deux" },
    quorum: { text: "3 présents sur 5 convoqués" },
    participants: [{ name: "Maître Fictif", roleLabel: "Titulaire", presenceLabel: "Présent(e)", signedText: "Oui" }],
    agenda: [{ title: "Examen des dossiers", summary: "Cas limites" }],
    decisions: [{ number: "1", studentName: "ÉLÈVE Fictif", decisionLabel: "Passage en classe supérieure (fictif)", justification: "" }],
    remarks: "Séance levée à 17 h.",
    signatories: [{ slot: "president", slotLabel: "Le Président", name: "Personne Fictive Une", title: "", jobFunction: "" }],
  },
  "annual-review-primary": {
    title: "Bilan annuel 2026-2027",
    student: { fullName: "ÉLÈVE <script>x</script> Fictif", matricule: "MAT-1", birthDate: "2018-04-01" },
    enrollment: { classroomLabel: "CE1 A", academicYearLabel: "2026-2027", enrolledOnText: "le 5 octobre 2026", stateAssignedText: "Affecté(e)" },
    periods: [{ label: "Trimestre 1", averageDisplay: "12.00", rankText: "3e / 30" }],
    result: { averageDisplay: "12.50", rankText: "4e / 30", decisionLabel: "Passage en classe supérieure (fictif)", distinctionLabel: "" },
    competencies: { scaleLabel: "Échelle de démonstration", domains: [{ label: "Domaine 1", evaluated: "2", expected: "2", levelsText: "Acquis : 1 — En cours : 1" }] },
    attendance: { text: "2 journées d'absence" },
    council: { appreciation: "Bon travail d'ensemble.", heldOn: "2027-06-28" },
  },
  "exam-convocation": {
    title: "Convocation",
    text: { convoked: "Vous êtes convoqué(e) à l'examen suivant." },
    candidate: { fullName: "CANDIDAT Fictif", birthLine: "Né(e) le 1er avril 2012", number: "000123" },
    exam: { label: "Examen de démonstration", sessionLabel: "Session 2027" },
    centre: { name: "Centre fictif", address: "Abidjan", room: "Salle 4" },
    schedule: [{ date: "2027-06-20", time: "08 h 00", label: "Épreuve 1", durationText: "2 h" }],
    instructions: [{ text: "Se munir d'une pièce d'identité." }],
    reference: "CONV-2027-000123",
  },
  "exam-success-certificate": {
    title: "Attestation de réussite",
    text: { certified: "Nous soussignés certifions que", succeeded: "a réussi l'examen", validity: "Délivrée pour servir et valoir ce que de droit." },
    candidate: { fullName: "CANDIDAT Fictif", birthLine: "Né(e) le 1er avril 2012", number: "000123" },
    exam: { label: "Examen de démonstration", sessionLabel: "Session 2027" },
    result: { mentionLabel: "", announcedOn: "2027-07-10" },
    reference: "ATT-2027-000123",
  },
  "exam-transcript": {
    title: "Relevé de notes d'examen",
    candidate: { fullName: "CANDIDAT Fictif", birthLine: "Né(e) le 1er avril 2012", number: "000123" },
    exam: { label: "Examen de démonstration", sessionLabel: "Session 2027" },
    papers: [{ label: "Épreuve 1", coefficient: "2", scoreText: "14,00", remark: "" }],
    summary: { averageText: "14,00", rankText: "", resultLabel: "Admis (fictif)", mentionLabel: "" },
    text: { note: "Examen blanc : résultat calculé avec des règles de démonstration." },
    reference: "REL-2027-000123",
  },
};

const render = (key: string, extra: Record<string, unknown> = {}, watermarkText: string | null = null) => {
  const t = PACK_PLATFORM_DOCUMENT_TEMPLATES.find((x) => x.key === key)!;
  return renderContextHtml({
    template: { body: t.body, css: t.css },
    context: { institution: INSTITUTION, meta: META, ...CONTEXTS[key], ...extra },
    title: String(CONTEXTS[key]?.title ?? key),
    colors: { primary: "#14532D", secondary: "#5b7aa3" },
    qrSvg: null,
    provisional: false,
    watermarkText,
  });
};

describe("natures de documents des packs", () => {
  it("cinq natures, connues du registre et rendues par le service générique des documents officiels", () => {
    expect([...PACK_DOCUMENT_KINDS]).toEqual(["COUNCIL_MINUTES", "ANNUAL_REVIEW", "EXAM_CONVOCATION", "EXAM_SUCCESS_CERTIFICATE", "EXAM_TRANSCRIPT"]);
    for (const k of PACK_DOCUMENT_KINDS) {
      expect(isKnownDocumentKind(k), k).toBe(true);
      expect(isOfficialDocumentKind(k), k).toBe(true);
      expect(DEFAULT_OFFICIAL_TEMPLATE[k], k).toBeTruthy();
    }
    expect(KNOWN_DOCUMENT_KINDS).toEqual(expect.arrayContaining(["REPORT_CARD", "TRANSCRIPT", "RECEIPT", "PAYSLIP", ...PACK_DOCUMENT_KINDS]));
    expect(OFFICIAL_DOCUMENT_KINDS).toHaveLength(2 + PACK_DOCUMENT_KINDS.length);
    expect(isKnownDocumentKind("NOUVELLE_NATURE")).toBe(false);
  });

  it("chaque nature a son gabarit de plateforme par défaut, de la même nature, valide et publié avec la plateforme", () => {
    for (const k of PACK_DOCUMENT_KINDS) {
      const t = ALL_PLATFORM_TEMPLATES.find((x) => x.key === DEFAULT_OFFICIAL_TEMPLATE[k]);
      expect(t, k).toBeDefined();
      expect(t!.documentKind).toBe(k);
      expect(validatePlatformTemplate(t!), t!.key).toEqual([]);
      expect(validateTemplate({ body: t!.body, css: t!.css, partialNames: PARTIAL_NAMES }).problems, t!.key).toEqual([]);
      expect(validateOptionsSchema(t!.optionsSchema), t!.key).toEqual([]);
      expect(t!.body).not.toMatch(/IPAM|IMHOTEP|EXASP/i);
    }
    expect(PACK_PLATFORM_DOCUMENT_TEMPLATES.map((t) => t.key).sort()).toEqual(["annual-review-primary", "council-minutes", "exam-convocation", "exam-success-certificate", "exam-transcript"]);
  });
});

describe("documents des packs : rendu pur", () => {
  for (const t of PACK_PLATFORM_DOCUMENT_TEMPLATES) {
    it(`${t.key} : déterministe, contexte échappé, aucun script, aucune URL externe`, () => {
      const html = render(t.key);
      expect(html).toBe(render(t.key));
      expect(html).toContain("ÉTABLISSEMENT DE DÉMONSTRATION");
      expect(html).not.toMatch(/<script|<iframe|<link|<object|onerror|javascript:/i);
      expect(html).not.toMatch(/https?:\/\/(?!verif\.example\.test)/);
      expect(html).not.toContain("<b>Fictive</b>");
      // rien de fictif imprimé sans le marquage : ni filigrane ni mention de démonstration
      expect(html).not.toContain('class="watermark"');
      expect(html).not.toContain(DEMONSTRATION_NOTICE);
    });

    it(`${t.key} : règles de démonstration ⇒ mention imprimée et filigrane imposé`, () => {
      const html = render(t.key, { demonstration: true, demonstrationNotice: DEMONSTRATION_NOTICE }, DEMONSTRATION_WATERMARK);
      expect(html).toContain(DEMONSTRATION_NOTICE);
      expect(html).toContain(`<div class="watermark">${DEMONSTRATION_WATERMARK}</div>`);
    });
  }

  it("PV de conseil : séance, participants, quorum, décisions ; contexte hostile échappé", () => {
    const html = render("council-minutes");
    for (const text of ["Conseil des maîtres", "Salle des maîtres", "3 présents sur 5 convoqués", "Maître Fictif", "ÉLÈVE Fictif", "Passage en classe supérieure (fictif)", "Séance levée"]) expect(html).toContain(text);
    expect(html).toContain("Personne &lt;b&gt;Fictive&lt;/b&gt; Une");
  });

  it("bilan annuel : résultat, compétences par domaine (compteurs), appréciation du conseil, « Affecté(e) »", () => {
    const html = render("annual-review-primary");
    for (const text of ["CE1 A", "12.50", "Domaine 1", "2 / 2", "Acquis : 1 — En cours : 1", "Bon travail d&#39;ensemble.", "Affecté(e)"]) expect(html, text).toContain(text.replace("&#39;", "&#39;"));
    expect(html).toContain("ÉLÈVE &lt;script&gt;x&lt;/script&gt; Fictif");
  });

  it("documents d'examen : convocation (calendrier, consignes), attestation (référence), relevé (épreuves)", () => {
    expect(render("exam-convocation")).toEqual(expect.stringContaining("Salle 4"));
    expect(render("exam-convocation")).toEqual(expect.stringContaining("Se munir d&#39;une pièce d&#39;identité."));
    expect(render("exam-success-certificate")).toEqual(expect.stringContaining("ATT-2027-000123"));
    expect(render("exam-transcript")).toEqual(expect.stringContaining("14,00"));
  });
});

describe("bulletin `report-primary` : compétences, « Affecté(e) », règles de démonstration", () => {
  const template = builtinTemplate("report-primary")!;
  const base = snapshotFor("report-primary");
  const rebuild = (patch: (b: typeof base.input.bundle) => typeof base.input.bundle) => {
    const built = buildSnapshot({ ...base.input, bundle: patch(base.input.bundle) });
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    return renderDocumentHtml({ snapshot: built.snapshot, template: { body: template.body, css: template.css }, verification: null });
  };
  const competencies = { scaleLabel: "Échelle de démonstration", domains: [{ code: "D1", label: "Domaine 1 (démonstration)", evaluated: 2, expected: 3, levels: [{ code: "N3", label: "Acquis", count: 1 }, { code: "N2", label: "En cours", count: 1 }] }] };

  it("le gabarit est un gabarit du primaire, valide, de nature REPORT_CARD", () => {
    expect(template).toMatchObject({ key: "report-primary", version: 1, documentKind: "REPORT_CARD", pack: "PRIMARY" });
    expect(validateTemplate({ body: template.body, css: template.css, partialNames: PARTIAL_NAMES }).problems).toEqual([]);
  });

  it("bloc compétences : compteurs par domaine, jamais une moyenne ; absent quand le snapshot n'en porte pas", () => {
    const withBlock = rebuild((b) => ({ ...b, competencies }));
    expect(withBlock).toContain("Domaine 1 (démonstration)");
    expect(withBlock).toContain("2 / 3");
    expect(withBlock).toContain("Acquis : 1 — En cours : 1");
    expect(rebuild((b) => b)).not.toContain("COMPÉTENCES");
  });

  it("« Affecté(e) » vient du TYPE DE FINANCEMENT de l'inscription, jamais du texte de la décision", () => {
    const assigned = rebuild((b) => ({ ...b, enrollment: { ...b.enrollment, fundingType: "STATE_ASSIGNED", stateAssigned: true } }));
    expect(assigned).toContain("Affecté(e)");
    const privateFunding = rebuild((b) => ({ ...b, enrollment: { ...b.enrollment, fundingType: "PRIVATE", stateAssigned: false } }));
    expect(privateFunding).not.toContain("Affecté(e)");
    // une décision dont le LIBELLÉ contient « Affecté » n'allume rien : seul le financement compte
    const textual = rebuild((b) => ({ ...b, labels: { ...b.labels, PROMOTED: "Affecté(e) en classe supérieure" }, summary: { ...b.summary, decisionCode: "PROMOTED" }, enrollment: { ...b.enrollment, stateAssigned: false } }));
    expect(textual.match(/Affecté\(e\)/g)?.length).toBe(1); // le libellé de la décision seul, pas la cellule « Statut »
    expect(textual).not.toContain('<span class="lbl">Statut</span>');
    // bulletins émis avant la Phase 4-5 : champ absent, rien d'affiché
    expect(rebuild((b) => b)).not.toContain('<span class="lbl">Statut</span>');
  });

  it("règles de démonstration (`rules.sourceKind = placeholder`) : filigrane imposé (même sans option) et mention imprimée", () => {
    const demo = rebuild((b) => ({ ...b, rules: { ...b.rules, sourceKind: "placeholder" as const } }));
    expect(demo).toContain(`<div class="watermark">${DEMONSTRATION_WATERMARK}</div>`);
    expect(demo).toContain(DEMONSTRATION_NOTICE);
    const official = rebuild((b) => ({ ...b, rules: { ...b.rules, sourceKind: "regulation" as const } }));
    expect(official).not.toContain(DEMONSTRATION_NOTICE);
    expect(official).not.toContain('class="watermark"');
    const legacy = rebuild((b) => b); // snapshot sans provenance (avant la Phase 4-5)
    expect(legacy).not.toContain(DEMONSTRATION_NOTICE);
  });

  it("une option de gabarit ne peut pas retirer le filigrane de démonstration", () => {
    const withOption = snapshotFor("report-primary", { options: { watermark: "COPIE" } });
    const built = buildSnapshot({ ...withOption.input, bundle: { ...withOption.input.bundle, rules: { ...withOption.input.bundle.rules, sourceKind: "placeholder" as const } } });
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const html = renderDocumentHtml({ snapshot: built.snapshot, template: { body: template.body, css: template.css }, verification: null });
    expect(html).toContain(`>${DEMONSTRATION_WATERMARK}<`);
    expect(html).not.toContain(">COPIE<");
  });

  it("la provenance est dans le snapshot signé : elle change l'empreinte (un document de démonstration ne peut pas passer pour officiel)", () => {
    const demo = buildSnapshot({ ...base.input, bundle: { ...base.input.bundle, rules: { ...base.input.bundle.rules, sourceKind: "placeholder" as const } } });
    expect(demo.ok && base.ok && demo.hash !== base.hash).toBe(true);
  });
});

describe("provenance des règles", () => {
  it("seul `placeholder` marque un document de démonstration", () => {
    expect(isDemonstrationSource("placeholder")).toBe(true);
    for (const k of ["regulation", "institution", "platform", null, undefined, ""]) expect(isDemonstrationSource(k)).toBe(false);
  });
});
