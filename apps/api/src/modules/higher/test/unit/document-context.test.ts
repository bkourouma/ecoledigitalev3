/** Contexte de rendu PDF : fonction pure du snapshot (aucune lecture, aucune heure d'impression). */
import { describe, expect, it } from "vitest";
import { buildDocumentContext, DOCUMENT_TEMPLATE_KEYS, frenchDate, MENTION_LABELS } from "../../domain/document-context";
import type { DocumentKind, OfficialDocument } from "../../domain/types";

const baseSnapshot = {
  v: 1,
  schema: "diploma/1",
  institution: { name: "Établissement de test", address: "Abidjan" },
  student: { studentId: "s1", fullName: "ÉTUDIANT Alice", matricule: "MAT-1", birthDate: "2003-04-01", birthPlace: "Abidjan" },
  diploma: { definitionId: "d1", code: "LIC", label: "Licence Génie logiciel", gradeCode: "LICENCE", awardReference: "DIP-2026-000001" },
  reference: "DIP-2026-000001",
  version: 1,
  issueDate: "2026-11-20",
  signatories: {
    DIPLOMA_LEFT: { signatoryId: "g", fullName: "Signataire Gauche", title: "Pr", function: "Le Directeur général" },
    DIPLOMA_RIGHT: { signatoryId: "r", fullName: "Signataire Droite", title: null, function: null },
  },
  duplicateOf: null,
  creditsTotal: 18,
  ues: [{ code: "UE1", label: "Unité 1", credits: 6 }, { code: "UE2", label: "Unité 2", credits: 12 }],
  mention: { code: "FAIRLY_GOOD", average: "13.400" },
  acquiredDate: "2026-09-15",
  academicYear: { id: "y", label: "2026-2027" },
};

const doc = (over: Partial<OfficialDocument> & { snapshot?: Record<string, unknown> } = {}): Pick<OfficialDocument, "documentKind" | "snapshot" | "reference" | "version" | "snapshotSchema"> => ({
  documentKind: "DIPLOMA",
  snapshot: baseSnapshot,
  reference: "DIP-2026-000001",
  version: 1,
  snapshotSchema: "diploma/1",
  ...over,
});

describe("dates françaises", () => {
  it("date civile sans fuseau", () => {
    expect(frenchDate("2026-09-01")).toBe("1er septembre 2026");
    expect(frenchDate("2003-04-12")).toBe("12 avril 2003");
    expect(frenchDate("2026-13-01")).toBeNull();
    expect(frenchDate(null)).toBeNull();
    expect(frenchDate("n'importe quoi")).toBeNull();
  });
});

describe("buildDocumentContext", () => {
  it("diplôme : identité, intitulé, mention en clair, UE, signataires avec emplacements du gabarit", () => {
    const c = buildDocumentContext(doc()) as Record<string, any>;
    expect(c.title).toBe("Diplôme");
    expect(c.institution).toMatchObject({ legalName: "Établissement de test", contactLine: "Abidjan" });
    expect(c.student).toEqual({ fullName: "ÉTUDIANT Alice", birthLine: "Né(e) le 1er avril 2003 à Abidjan — Matricule MAT-1" });
    expect(c.diploma).toMatchObject({ label: "Licence Génie logiciel", gradeCode: "LICENCE", awardReference: "DIP-2026-000001" });
    expect(c.mention).toEqual({ label: "Assez bien", average: "13.400" });
    expect(c.creditsTotal).toBe("18");
    expect(c.ues).toEqual([{ code: "UE1", label: "Unité 1", credits: "6" }, { code: "UE2", label: "Unité 2", credits: "12" }]);
    expect(c.signatories).toEqual([
      { slot: "diploma-left", slotLabel: "Le Directeur général", name: "Signataire Gauche", title: "Pr", jobFunction: null },
      { slot: "diploma-right", slotLabel: "Signataire", name: "Signataire Droite", title: null, jobFunction: null },
    ]);
    expect(c.meta).toEqual({ versionText: "" });
    expect(c.reference).toBe("DIP-2026-000001");
  });

  it("duplicata : mention explicite du numéro de duplicata et de l'original", () => {
    const c = buildDocumentContext(doc({ version: 3, snapshot: { ...baseSnapshot, duplicateOf: "DIP-2026-000001" } })) as Record<string, any>;
    expect(c.meta.versionText).toBe("Duplicata n° 2");
    expect(c.duplicateOf).toBe("DIP-2026-000001");
  });

  it("attestation de réussite : programme, mention en attente si le cycle est incomplet", () => {
    const c = buildDocumentContext(
      doc({ documentKind: "ATTESTATION_SUCCESS", snapshotSchema: "attestation-success/1", snapshot: { ...baseSnapshot, schema: "attestation-success/1", diploma: undefined, program: { nodeId: "p", code: "GL", label: "Génie logiciel" }, mention: { code: "PENDING", average: null } } }),
    ) as Record<string, any>;
    expect(c.title).toBe("Attestation de réussite");
    expect(c.program).toEqual({ label: "Génie logiciel", code: "GL" });
    expect(c.mention).toEqual({ label: "En attente", average: "" });
  });

  it("attestation d'authenticité : renvoie au diplôme ; une valeur inconnue ne casse pas le rendu", () => {
    const c = buildDocumentContext(doc({ documentKind: "ATTESTATION_AUTHENTICITY", snapshotSchema: "attestation-authenticity/1", snapshot: { institution: {}, student: {}, diploma: { label: "Licence", awardReference: "DIP-1" }, signatories: {} } })) as Record<string, any>;
    expect(c.title).toBe("Attestation d'authenticité");
    expect(c.student.birthLine).toBe("");
    expect(c.signatories).toEqual([]);
    expect(c.ues).toEqual([]);
    expect(c.mention).toEqual({ label: "", average: "" });
  });

  it("déterministe : même snapshot, même contexte ; aucune date du jour", () => {
    expect(JSON.stringify(buildDocumentContext(doc()))).toBe(JSON.stringify(buildDocumentContext(doc())));
  });

  it("un gabarit de plateforme par nature de document ; toute mention du contrat de règles a son libellé", () => {
    const kinds: DocumentKind[] = ["DIPLOMA", "ATTESTATION_SUCCESS", "ATTESTATION_AUTHENTICITY"];
    expect(kinds.map((k) => DOCUMENT_TEMPLATE_KEYS[k])).toEqual(["higher-diploma", "higher-attestation-success", "higher-attestation-authenticity"]);
    expect(Object.keys(MENTION_LABELS).sort()).toEqual(["EXCELLENT", "FAIRLY_GOOD", "GOOD", "INSUFFICIENT", "PASSABLE", "PENDING", "VERY_GOOD"]);
  });
});
