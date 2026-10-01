import { describe, expect, it } from "vitest";
import { ASSESS_STATUSES } from "@ecoledigitale/contracts/src/v2/assess";
import { canonical, compareDecimal, equalDecimal, fromMilli, isDecimalString, significantDecimals, toMilli } from "../../domain/decimal";
import { normalizeEntry, payloadHash, planSave, type NormalizedEntry } from "../../domain/grades";
import { PACK_TYPE_TEMPLATES, templateKeyForPack } from "../../domain/pack";
import type { Grade } from "../../domain/types";
import { isLegalTransition, nextStatuses, planRevisionDecision, planTransition } from "../../domain/workflow";

const settings = { requireSeparateReviewer: true, requireSeparateApprover: true };
const loose = { requireSeparateReviewer: false, requireSeparateApprover: false };

describe("décimaux exacts", () => {
  it("convertit en millièmes sans flottant", () => {
    expect(toMilli("12.5")).toBe(12500);
    expect(toMilli("0.125")).toBe(125);
    expect(toMilli("20")).toBe(20000);
    expect(fromMilli(12500)).toBe("12.500");
    expect(canonical("9.5")).toBe("9.500");
    expect(equalDecimal("12.5", "12.500")).toBe(true);
    expect(equalDecimal(null, null)).toBe(true);
    expect(equalDecimal("1", null)).toBe(false);
    expect(compareDecimal("10", "9.999")).toBeGreaterThan(0);
  });
  it("0.1 + 0.2 n'existe pas ici : 0.3 est 0.3", () => {
    expect(toMilli("0.1") + toMilli("0.2")).toBe(toMilli("0.3"));
  });
  it("valide le format et compte les décimales significatives", () => {
    for (const bad of ["", "-1", "1,5", "1e3", "1.2345", "abc", "123456"]) expect(isDecimalString(bad), bad).toBe(false);
    expect(significantDecimals("12.50")).toBe(1);
    expect(significantDecimals("12")).toBe(0);
    expect(significantDecimals("0.125")).toBe(3);
    expect(() => toMilli("1.2345")).toThrow(RangeError);
  });
});

describe("normalisation d'une ligne de saisie", () => {
  const n = (e: Parameters<typeof normalizeEntry>[0], scale = "20", dec = 2) => normalizeEntry(e, scale, dec);

  it("une note saisie est ENTERED, bornée par le barème (0 inclus, barème inclus)", () => {
    expect(n({ enrollmentId: "e", score: "0" })).toMatchObject({ ok: true, value: { entryStatus: "ENTERED", score: "0.000" } });
    expect(n({ enrollmentId: "e", score: "20" })).toMatchObject({ ok: true, value: { score: "20.000" } });
    expect(n({ enrollmentId: "e", score: "20.01" })).toMatchObject({ ok: false, error: { code: "assess.score_out_of_scale" } });
    expect(n({ enrollmentId: "e", score: "10" }, "10")).toMatchObject({ ok: true });
    expect(n({ enrollmentId: "e", score: "10.5" }, "10")).toMatchObject({ ok: false, error: { code: "assess.score_out_of_scale" } });
  });

  it("une absence n'est PAS un zéro : aucun score pour ABSENT_*, EXEMPT, NOT_GRADED", () => {
    for (const entryStatus of ["ABSENT_EXCUSED", "ABSENT_UNEXCUSED", "EXEMPT", "NOT_GRADED"] as const) {
      expect(n({ enrollmentId: "e", entryStatus })).toMatchObject({ ok: true, value: { entryStatus, score: null } });
      expect(n({ enrollmentId: "e", entryStatus, score: "0" })).toMatchObject({ ok: false, error: { code: "assess.invalid_entry" } });
    }
    expect(n({ enrollmentId: "e", entryStatus: "ENTERED" })).toMatchObject({ ok: false, error: { code: "assess.invalid_entry" } });
    expect(n({ enrollmentId: "e" })).toMatchObject({ ok: true, value: { entryStatus: "NOT_GRADED", score: null } });
  });

  it("respecte le nombre de décimales du tenant, sans jamais arrondir", () => {
    expect(n({ enrollmentId: "e", score: "12.345" }, "20", 3)).toMatchObject({ ok: true, value: { score: "12.345" } });
    expect(n({ enrollmentId: "e", score: "12.345" }, "20", 2)).toMatchObject({ ok: false, error: { code: "assess.score_precision" } });
    expect(n({ enrollmentId: "e", score: "12.50" }, "20", 1)).toMatchObject({ ok: true, value: { score: "12.500" } });
    expect(n({ enrollmentId: "e", score: "12.5" }, "20", 0)).toMatchObject({ ok: false });
  });

  it("nettoie le commentaire", () => {
    expect(n({ enrollmentId: "e", score: "5", comment: "  bien  " })).toMatchObject({ value: { comment: "bien" } });
    expect(n({ enrollmentId: "e", score: "5", comment: "   " })).toMatchObject({ value: { comment: null } });
  });
});

describe("plan d'écriture d'un lot (idempotence, version de ligne)", () => {
  const grade = (over: Partial<Grade> = {}): Grade => ({
    id: "g1",
    assessmentId: "a",
    enrollmentId: "e1",
    studentId: "s1",
    score: "12.000",
    entryStatus: "ENTERED",
    comment: null,
    status: "DRAFT",
    rowVersion: 3,
    enteredBy: null,
    enteredAt: null,
    correctedAt: null,
    ...over,
  });
  const entry = (over: Partial<NormalizedEntry> = {}): NormalizedEntry => ({ enrollmentId: "e1", entryStatus: "ENTERED", score: "12.000", comment: null, rowVersion: undefined, ...over });

  it("une ligne inconnue est créée", () => {
    expect(planSave([entry()], new Map())[0]?.action).toBe("create");
  });
  it("rejouer la même valeur n'écrit rien, avec ou sans rowVersion (idempotence)", () => {
    const existing = new Map([["e1", grade()]]);
    expect(planSave([entry()], existing)[0]?.action).toBe("unchanged");
    expect(planSave([entry({ rowVersion: 1 })], existing)[0]?.action).toBe("unchanged");
  });
  it("modifier exige la rowVersion lue ; absente ou périmée = écrasement refusé", () => {
    const existing = new Map([["e1", grade()]]);
    expect(planSave([entry({ score: "14.000", rowVersion: 3 })], existing)[0]?.action).toBe("update");
    expect(planSave([entry({ score: "14.000", rowVersion: 2 })], existing)[0]?.action).toBe("stale");
    expect(planSave([entry({ score: "14.000" })], existing)[0]?.action).toBe("stale");
  });
  it("passer de noté à absent est une modification", () => {
    const existing = new Map([["e1", grade()]]);
    expect(planSave([entry({ entryStatus: "ABSENT_EXCUSED", score: null, rowVersion: 3 })], existing)[0]?.action).toBe("update");
  });
  it("l'empreinte du lot est stable (ordre des lignes indifférent) et sensible au contenu", () => {
    const a = entry({ enrollmentId: "a" });
    const b = entry({ enrollmentId: "b", score: "3.000" });
    expect(payloadHash([a, b])).toBe(payloadHash([b, a]));
    expect(payloadHash([a, b])).not.toBe(payloadHash([a, entry({ enrollmentId: "b", score: "4.000" })]));
    expect(payloadHash([a])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("circuit de validation : table de vérité des transitions", () => {
  const legal: Record<string, string[]> = {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["REVIEWED", "DRAFT", "CANCELLED"],
    REVIEWED: ["APPROVED", "DRAFT", "CANCELLED"],
    APPROVED: ["PUBLISHED", "DRAFT", "CANCELLED"],
    PUBLISHED: ["CANCELLED"],
    CANCELLED: [],
  };
  for (const from of ASSESS_STATUSES) {
    for (const to of ASSESS_STATUSES) {
      it(`${from} -> ${to} : ${legal[from]?.includes(to) ? "permise" : "interdite"}`, () => {
        expect(isLegalTransition(from, to)).toBe(legal[from]?.includes(to) === true);
      });
    }
  }
  it("PUBLISHED ne revient jamais en brouillon ; CANCELLED est terminal", () => {
    expect(nextStatuses("PUBLISHED")).toEqual(["CANCELLED"]);
    expect(nextStatuses("CANCELLED")).toEqual([]);
  });
});

describe("séparation des tâches", () => {
  const base = { from: "SUBMITTED" as const, actorId: "u1", submittedBy: "u1", settings, gradeCount: 3 };

  it("le soumetteur ne relit pas, n'approuve pas, ne publie pas sa propre feuille", () => {
    expect(planTransition({ ...base, to: "REVIEWED" })).toMatchObject({ ok: false, error: { code: "assess.four_eyes" } });
    expect(planTransition({ ...base, from: "REVIEWED", to: "APPROVED" })).toMatchObject({ ok: false, error: { code: "assess.four_eyes" } });
    expect(planTransition({ ...base, from: "APPROVED", to: "PUBLISHED" })).toMatchObject({ ok: false, error: { code: "assess.four_eyes" } });
  });
  it("une autre personne peut relire, approuver, publier, sans dérogation", () => {
    for (const [from, to] of [["SUBMITTED", "REVIEWED"], ["REVIEWED", "APPROVED"], ["APPROVED", "PUBLISHED"]] as const) {
      expect(planTransition({ ...base, from, to, actorId: "u2" })).toEqual({ ok: true, value: { to, fourEyesWaiver: false } });
    }
  });
  it("si le réglage est désactivé, la dérogation est INSCRITE", () => {
    expect(planTransition({ ...base, to: "REVIEWED", settings: loose })).toEqual({ ok: true, value: { to: "REVIEWED", fourEyesWaiver: true } });
    // le réglage « relecteur » ne couvre pas l'approbation
    expect(planTransition({ ...base, from: "REVIEWED", to: "APPROVED", settings: { requireSeparateReviewer: false, requireSeparateApprover: true } })).toMatchObject({ ok: false });
  });
  it("soumettre et retourner en brouillon ne sont pas des actes de validation", () => {
    expect(planTransition({ ...base, from: "DRAFT", to: "SUBMITTED" })).toMatchObject({ ok: true, value: { fourEyesWaiver: false } });
    expect(planTransition({ ...base, to: "DRAFT", comment: "Notes à revoir" })).toMatchObject({ ok: true, value: { fourEyesWaiver: false } });
  });
  it("retour en brouillon : commentaire obligatoire ; évaluation vide : pas de soumission ; saut d'étape interdit", () => {
    expect(planTransition({ ...base, actorId: "u2", to: "DRAFT" })).toMatchObject({ ok: false, error: { code: "assess.comment_required" } });
    expect(planTransition({ ...base, actorId: "u2", to: "DRAFT", comment: "ok" })).toMatchObject({ ok: false });
    expect(planTransition({ ...base, from: "DRAFT", to: "SUBMITTED", gradeCount: 0 })).toMatchObject({ ok: false, error: { code: "assess.empty_assessment" } });
    expect(planTransition({ ...base, from: "DRAFT", to: "PUBLISHED", actorId: "u2" })).toMatchObject({ ok: false, error: { code: "assess.invalid_transition" } });
    expect(planTransition({ ...base, from: "PUBLISHED", to: "DRAFT", actorId: "u2", comment: "retour" })).toMatchObject({ ok: false, error: { code: "assess.invalid_transition" } });
  });
  it("le demandeur d'une correction ne l'approuve pas lui-même (sauf dérogation inscrite)", () => {
    expect(planRevisionDecision({ requestedBy: "u1", actorId: "u1", settings })).toMatchObject({ ok: false, error: { code: "assess.four_eyes" } });
    expect(planRevisionDecision({ requestedBy: "u1", actorId: "u2", settings })).toEqual({ ok: true, value: { fourEyesWaiver: false } });
    expect(planRevisionDecision({ requestedBy: "u1", actorId: "u1", settings: { requireSeparateApprover: false } })).toEqual({ ok: true, value: { fourEyesWaiver: true } });
  });
});

describe("modèles de pack des types d'évaluation", () => {
  it("le pack classique couvre les types du PRD §17 et la moyenne saisie (Q-35)", () => {
    const codes = PACK_TYPE_TEMPLATES.classic.map((t) => t.code);
    for (const c of ["INTERROGATION", "DEVOIR", "COMPOSITION", "EXAMEN_BLANC", "PROJET", "ORAL", "TP", "AUTRE", "MOYENNE_SAISIE"]) expect(codes).toContain(c);
    expect(PACK_TYPE_TEMPLATES.classic.find((t) => t.code === "EXAMEN_BLANC")?.visibleToStudents).toBe(false);
    expect(PACK_TYPE_TEMPLATES.classic.find((t) => t.code === "MOYENNE_SAISIE")?.aggregationGroup).toBe("ENTERED_AVERAGE");
  });
  it("le supérieur : devoir et examen avec session 2", () => {
    const exam = PACK_TYPE_TEMPLATES.higher.find((t) => t.aggregationGroup === "EXAM");
    expect(exam?.allowsSession2).toBe(true);
    expect(PACK_TYPE_TEMPLATES.higher.some((t) => t.aggregationGroup === "CONTINUOUS")).toBe(true);
  });
  it("les codes sont uniques et bien formés ; le pack se déduit du pack produit", () => {
    for (const pack of Object.values(PACK_TYPE_TEMPLATES)) {
      const codes = pack.map((t) => t.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const t of pack) {
        expect(t.code).toMatch(/^[A-Z][A-Z0-9_]{1,31}$/);
        expect(t.aggregationGroup).toMatch(/^[A-Z][A-Z0-9_]{1,31}$/);
      }
    }
    expect(templateKeyForPack("HIGHER")).toBe("higher");
    expect(templateKeyForPack("SECONDARY")).toBe("classic");
    expect(templateKeyForPack(null)).toBe("classic");
  });
});
