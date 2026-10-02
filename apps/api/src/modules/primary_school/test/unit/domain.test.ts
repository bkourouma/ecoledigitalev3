/** Unitaires purs (sans base) : règles du domaine, modèle de pack, empreintes, erreurs SQL, CSV. */
import { describe, expect, it } from "vitest";
import { reportToCsv, type Report } from "../../application/reports";
import { outcomeCodeOfDecision } from "../../application/council";
import { buildMinutes, countAttendance, decisionNeedsJustification, signatureProblems } from "../../domain/council";
import { completenessOf, decideBulkLine, filterPhrases, summarizeCompetencies, validateLevels } from "../../domain/competency";
import { DB_CODE_MESSAGES, PrimaryCode, dbCodeOf } from "../../domain/errors";
import { archiveBlockers, buildManifest, canonicalJson, manifestHash, reviewHash, sealBlockers, sha256Hex } from "../../domain/review";
import { PrimarySchoolPackTemplateSchema } from "../../domain/template";
import type { CouncilAttendanceRow, CouncilCase, Phrase } from "../../domain/types";
import { mapDbError } from "../../infrastructure/db-errors";
import { bundledTemplatePort } from "../../templates";

const U = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${String(n).padStart(12, "0")}`;

describe("compétences : synthèse par compteurs, jamais de moyenne", () => {
  it("ne compte que les lignes VALIDÉES, par domaine et par niveau", () => {
    expect(
      summarizeCompetencies([
        { domainCode: "LANG", levelCode: "N3", status: "VALIDATED" },
        { domainCode: "LANG", levelCode: "N3", status: "VALIDATED" },
        { domainCode: "LANG", levelCode: "N1", status: "VALIDATED" },
        { domainCode: "LANG", levelCode: "N4", status: "DRAFT" },
        { domainCode: "MATH", levelCode: "N2", status: "VALIDATED" },
      ]),
    ).toEqual({ LANG: { N3: 2, N1: 1 }, MATH: { N2: 1 } });
    expect(summarizeCompetencies([])).toEqual({});
  });

  it("valide une échelle : au moins deux niveaux, codes et ordinaux uniques", () => {
    expect(validateLevels([{ code: "A", ordinal: 1 }])).toMatch(/au moins deux/);
    expect(validateLevels([{ code: "A", ordinal: 1 }, { code: "A", ordinal: 2 }])).toMatch(/Code de niveau en double/);
    expect(validateLevels([{ code: "A", ordinal: 1 }, { code: "B", ordinal: 1 }])).toMatch(/Ordinal en double/);
    expect(validateLevels([{ code: "A", ordinal: 1 }, { code: "B", ordinal: 2 }])).toBeNull();
  });

  it("saisie en lot : create / unchanged / update / conflit de version / ligne validée gelée", () => {
    const existing = { ratingLevelId: "L1", note: null, observedOn: "2026-10-01", status: "DRAFT" as const, rowVersion: 2 };
    const same = { ratingLevelId: "L1", note: null, observedOn: null, rowVersion: undefined };
    expect(decideBulkLine(undefined, same)).toBe("create");
    expect(decideBulkLine(existing, same)).toBe("unchanged"); // rejouer un lot ne change rien
    expect(decideBulkLine(existing, { ...same, ratingLevelId: "L2" })).toBe("row_version_conflict");
    expect(decideBulkLine(existing, { ...same, ratingLevelId: "L2", rowVersion: 1 })).toBe("row_version_conflict");
    expect(decideBulkLine(existing, { ...same, ratingLevelId: "L2", rowVersion: 2 })).toBe("update");
    expect(decideBulkLine({ ...existing, status: "VALIDATED" }, { ...same, ratingLevelId: "L2", rowVersion: 2 })).toBe("frozen");
    expect(decideBulkLine({ ...existing, status: "VALIDATED" }, same)).toBe("unchanged");
    expect(decideBulkLine(existing, { ...same, note: "à revoir" })).toBe("row_version_conflict");
  });

  it("complétude : élèves × compétences ; une compétence non saisie reste « non évaluée »", () => {
    const c = completenessOf({
      competencyIds: ["c1", "c2"],
      enrollmentIds: ["e1", "e2"],
      assessments: [
        { enrollmentId: "e1", competencyId: "c1", status: "VALIDATED" },
        { enrollmentId: "e1", competencyId: "c2", status: "DRAFT" },
        { enrollmentId: "e2", competencyId: "c1", status: "DRAFT" },
        { enrollmentId: "e9", competencyId: "c1", status: "DRAFT" }, // hors classe : ignoré
        { enrollmentId: "e1", competencyId: "cX", status: "DRAFT" }, // hors référentiel : ignoré
      ],
    });
    expect(c).toMatchObject({ expected: 4, recorded: 3, validated: 1 });
    expect(c.byEnrollment).toEqual([
      { enrollmentId: "e1", recorded: 2, validated: 1 },
      { enrollmentId: "e2", recorded: 1, validated: 0 },
    ]);
  });

  it("banque d'appréciations : filtre par portée, niveau de maîtrise et niveau de classe ; inactives sur demande", () => {
    const p = (code: string, over: Partial<Phrase>): Phrase => ({ id: code, code, scope: "PERIOD", body: "x", ratingLevelCode: null, gradeLevelCode: null, sourceKind: "placeholder", active: true, ...over });
    const bank = [p("A", { ratingLevelCode: "N1" }), p("B", { ratingLevelCode: "N3" }), p("C", {}), p("D", { scope: "YEAR" }), p("E", { active: false }), p("F", { gradeLevelCode: "CP1" })];
    expect(filterPhrases(bank, { scope: "PERIOD", ratingLevelCode: "N1" }).map((x) => x.code)).toEqual(["A", "C", "F"]);
    expect(filterPhrases(bank, { scope: "PERIOD", gradeLevelCode: "CM2" }).map((x) => x.code)).toEqual(["A", "B", "C"]);
    expect(filterPhrases(bank, { includeInactive: true, scope: "PERIOD" }).map((x) => x.code)).toContain("E");
    expect(filterPhrases(bank, {}).map((x) => x.code)).not.toContain("E");
  });
});

describe("bilan annuel : instantané, empreinte, conditions de scellement", () => {
  const snapshot = {
    institutionId: U(1), academicYearId: U(2), enrollmentId: U(3), studentId: U(4), classroomId: U(5), gradeLevelCode: "CE1", version: 1,
    yearResultRef: U(6), decisionRef: U(7), outcomeCode: "PROMOTED", competencySummary: { LANG: { N3: 2 } }, attendanceSummary: { openDays: 150 }, ruleVersionRef: U(8),
  };

  it("JSON canonique : l'ordre des clés ne change pas l'empreinte ; une donnée modifiée la change", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const reordered = { ...snapshot, competencySummary: { LANG: { N3: 2 } }, attendanceSummary: { openDays: 150 } };
    expect(reviewHash(snapshot)).toBe(reviewHash(reordered));
    expect(reviewHash(snapshot)).toMatch(/^[0-9a-f]{64}$/);
    expect(reviewHash({ ...snapshot, outcomeCode: "REPEATED" })).not.toBe(reviewHash(snapshot));
    expect(reviewHash({ ...snapshot, version: 2 })).not.toBe(reviewHash(snapshot));
    expect(() => canonicalJson({ f: () => 1 })).toThrow(TypeError);
  });

  it("scellement : toutes les périodes closes, résultat d'année FINAL, décision du conseil si l'établissement l'exige", () => {
    const ok = { yearResultRef: U(1), decisionRef: U(2), outcomeCode: "PROMOTED" };
    expect(sealBlockers(ok, { councilRequired: true, allPeriodsClosed: true })).toEqual([]);
    expect(sealBlockers({ ...ok, yearResultRef: null }, { councilRequired: true, allPeriodsClosed: true }).map((b) => b.code)).toEqual(["primary_school.review_needs_results"]);
    expect(sealBlockers({ ...ok, decisionRef: null }, { councilRequired: true, allPeriodsClosed: true }).map((b) => b.code)).toEqual(["primary_school.review_needs_decision"]);
    expect(sealBlockers({ ...ok, outcomeCode: null }, { councilRequired: true, allPeriodsClosed: true }).map((b) => b.code)).toEqual(["primary_school.review_needs_decision"]);
    expect(sealBlockers({ ...ok, decisionRef: null, outcomeCode: null }, { councilRequired: false, allPeriodsClosed: true })).toEqual([]);
    expect(sealBlockers(ok, { councilRequired: true, allPeriodsClosed: false }).map((b) => b.code)).toEqual(["primary_school.review_periods_open"]);
    expect(sealBlockers({ yearResultRef: null, decisionRef: null, outcomeCode: null }, { councilRequired: true, allPeriodsClosed: false }).map((b) => b.code)).toEqual([
      "primary_school.review_periods_open",
      "primary_school.review_needs_results",
      "primary_school.review_needs_decision",
    ]);
  });

  it("manifeste d'archive : ordre déterministe, comptage par classe, READY seulement si tout est scellé", () => {
    const r = (id: string, enrollmentId: string, classroomId: string, hash: string | null) => ({ id, enrollmentId, classroomId, version: 1, contentHash: hash });
    const a = buildManifest({ institutionId: U(1), academicYearId: U(2), sealed: [r("r2", "e2", "cB", "b".repeat(64)), r("r1", "e1", "cA", "a".repeat(64)), r("r3", "e3", "cA", null)] });
    const b = buildManifest({ institutionId: U(1), academicYearId: U(2), sealed: [r("r1", "e1", "cA", "a".repeat(64)), r("r2", "e2", "cB", "b".repeat(64))] });
    expect(a.reviews.map((x) => x.reviewId)).toEqual(["r1", "r2"]);
    expect(a.classrooms).toEqual([{ classroomId: "cA", reviews: 1 }, { classroomId: "cB", reviews: 1 }]);
    expect(manifestHash(a)).toBe(manifestHash(b));
    expect(archiveBlockers({ reviewsTotal: 4, reviewsSealed: 4 }, true)).toEqual([]);
    expect(archiveBlockers({ reviewsTotal: 4, reviewsSealed: 3 }, true)[0]?.message).toMatch(/1 bilan/);
    expect(archiveBlockers({ reviewsTotal: 0, reviewsSealed: 0 }, true)).toHaveLength(1); // aucun bilan à archiver
    expect(archiveBlockers({ reviewsTotal: 1, reviewsSealed: 1 }, false)[0]?.code).toBe("primary_school.archive_year_not_closed");
  });
});

describe("conseil des maîtres : présence, justification, procès-verbal figé", () => {
  const att = (staffId: string, roleCode: CouncilAttendanceRow["roleCode"], present: boolean | null, signed = false): CouncilAttendanceRow & { staffName: string | null } => ({
    deliberationId: U(9), staffId, roleCode, convened: true, present, signedAt: signed ? new Date("2026-10-02T10:00:00Z") : null, note: null, staffName: `Maître ${staffId.slice(-2)}`,
  });
  const caseOf = (enrollmentId: string, over: Partial<CouncilCase & { ruleProposalCode: string | null; finalCode: string | null; justification: string | null }> = {}) => ({
    id: `c-${enrollmentId}`, deliberationId: U(9), classroomId: U(5), enrollmentId, studentId: `s-${enrollmentId}`, reasonCodes: ["B", "A"], proposalCode: null, proposalNote: null, discussionNote: null,
    proposedByStaffId: null, status: "DECIDED" as const, decisionRef: U(7), ruleProposalCode: "PROMOTED", finalCode: "PROMOTED", justification: null, ...over,
  });

  it("compte convoqués et présents (le quorum, lui, est une RÈGLE)", () => {
    expect(countAttendance([{ convened: true, present: true }, { convened: true, present: false }, { convened: true, present: null }, { convened: false, present: true }])).toEqual({ convened: 3, present: 2 });
  });

  it("un écart avec la proposition de la règle exige une justification ; confirmer sans code = pas d'écart", () => {
    expect(decisionNeedsJustification("PROMOTED", undefined)).toBe(false);
    expect(decisionNeedsJustification("PROMOTED", "PROMOTED")).toBe(false);
    expect(decisionNeedsJustification("COUNCIL_REVIEW", "REPEAT")).toBe(true);
    expect(decisionNeedsJustification(null, "REPEAT")).toBe(true);
  });

  it("une signature exige la présence et la présence sur la feuille", () => {
    const parts = [{ staffId: "a", present: true }, { staffId: "b", present: false }, { staffId: "c" }];
    expect(signatureProblems(parts, ["a"])).toEqual([]);
    expect(signatureProblems(parts, ["b", "c", "z"])).toHaveLength(3);
  });

  it("procès-verbal : contenu déterministe (ordre d'entrée indifférent), empreinte stable, signataires indiqués", () => {
    const base = { deliberationId: U(9), classroomId: U(5), periodId: U(6), heldOn: "2026-10-02", ruleSourceKind: "placeholder" };
    const a = buildMinutes({ ...base, attendance: [att(U(20), "CHAIR", true, true), att(U(21), "HOMEROOM", true)], cases: [caseOf("e2"), caseOf("e1")] });
    const b = buildMinutes({ ...base, attendance: [att(U(21), "HOMEROOM", true), att(U(20), "CHAIR", true, true)], cases: [caseOf("e1"), caseOf("e2")] });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.content.decisions.map((d) => d.enrollmentId)).toEqual(["e1", "e2"]);
    expect(a.content.decisions[0]?.reasonCodes).toEqual(["A", "B"]);
    expect(a.content.participants.find((p) => p.roleCode === "CHAIR")).toMatchObject({ present: true, signed: true });
    expect(a.content.ruleSourceKind).toBe("placeholder");
    // une autre date de séance = un autre contenu = une autre empreinte (version suivante du PV)
    expect(buildMinutes({ ...base, heldOn: "2026-10-03", attendance: [att(U(20), "CHAIR", true, true), att(U(21), "HOMEROOM", true)], cases: [caseOf("e1"), caseOf("e2")] }).contentHash).not.toBe(a.contentHash);
    // une personne non convoquée ne figure pas au procès-verbal
    const notConvened = { ...att(U(22), "TEACHER", true), convened: false };
    expect(buildMinutes({ ...base, attendance: [notConvened], cases: [] }).content.participants).toEqual([]);
  });

  it("issue d'inscription : codes de décision de `results` -> codes d'`academic`, jamais PENDING / COUNCIL_REVIEW", () => {
    expect(outcomeCodeOfDecision("PROMOTED")).toBe("PROMOTED");
    expect(outcomeCodeOfDecision("REPEAT")).toBe("REPEATED");
    expect(outcomeCodeOfDecision("REPEATED")).toBe("REPEATED");
    expect(outcomeCodeOfDecision("EXCLUDED")).toBe("EXCLUDED");
    expect(outcomeCodeOfDecision("PENDING")).toBeNull();
    expect(outcomeCodeOfDecision("COUNCIL_REVIEW")).toBeNull();
    expect(outcomeCodeOfDecision(null)).toBeNull();
  });
});

describe("modèle de pack primary_school : données, jamais de règle", () => {
  const raw = bundledTemplatePort.getSection("CI") as Record<string, unknown>;

  it("le modèle livré est valide et ne contient QUE des valeurs fictives ou d'établissement (aucune valeur réglementaire)", () => {
    const t = PrimarySchoolPackTemplateSchema.parse(raw);
    expect(t).toMatchObject({ pack: "PRIMARY", educationSystem: "CI", templateVersion: 1 });
    const kinds = [...t.ratingScales.map((s) => s.sourceKind), ...t.competencyFrameworks.map((f) => f.sourceKind), ...t.appreciationPhrases.map((p) => p.sourceKind)];
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === "placeholder" || k === "institution")).toBe(true);
    // niveaux de classe du PRD §12 ; aucun nombre de seuil, de coefficient, de moyenne dans le modèle
    expect(t.competencyFrameworks.find((f) => f.code === "PRESCHOOL_DEMO")?.gradeLevels).toEqual(["PS", "MS", "GS"]);
    expect(t.competencyFrameworks.find((f) => f.code === "PRIMARY_DEMO")?.gradeLevels).toEqual(["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]);
    expect(JSON.stringify(raw)).not.toMatch(/seuil|coefficient|quorum|moyenne|threshold|passMark/i);
    expect(t.settings.archiveRetentionYears).toBeNull(); // durée de conservation : question métier non tranchée
    // chaque libellé de démonstration est étiqueté comme tel
    for (const f of t.competencyFrameworks) expect(f.label).toMatch(/démonstration/);
  });

  it("un modèle sans origine est refusé (sourceKind obligatoire, sans valeur par défaut)", () => {
    const withoutKind = JSON.parse(JSON.stringify(raw));
    delete withoutKind.ratingScales[0].sourceKind;
    expect(PrimarySchoolPackTemplateSchema.safeParse(withoutKind).success).toBe(false);
  });

  it("`regulation` exige la référence du texte ; échelle inconnue, doublons et sections inconnues refusés", () => {
    const clone = () => JSON.parse(JSON.stringify(raw));
    const reg = clone();
    reg.ratingScales[0].sourceKind = "regulation";
    expect(PrimarySchoolPackTemplateSchema.safeParse(reg).success).toBe(false);
    reg.ratingScales[0].sourceReference = "Arrêté n° 000 (exemple)";
    expect(PrimarySchoolPackTemplateSchema.safeParse(reg).success).toBe(true);
    const unknownScale = clone();
    unknownScale.competencyFrameworks[0].scale = "INCONNUE";
    expect(PrimarySchoolPackTemplateSchema.safeParse(unknownScale).success).toBe(false);
    const dup = clone();
    dup.ratingScales[0].levels[1].ordinal = 1;
    expect(PrimarySchoolPackTemplateSchema.safeParse(dup).success).toBe(false);
    const extra = clone();
    extra.coefficients = { MATH: 4 };
    expect(PrimarySchoolPackTemplateSchema.safeParse(extra).success).toBe(false);
    expect(bundledTemplatePort.getSection("ZZ")).toBeNull();
  });
});

describe("erreurs SQL traduites en erreurs métier (jamais un 500)", () => {
  it("lit le code d'un déclencheur et le traduit en 409 stable", () => {
    expect(dbCodeOf("primary_school.period_locked: la saisie est arrêtée")).toBe("period_locked");
    expect(dbCodeOf("duplicate key value")).toBeNull();
    const e = mapDbError(new Error("primary_school.validated_frozen: une appréciation validée ne se corrige que par une révision motivée"));
    expect(e).toMatchObject({ code: PrimaryCode.VALIDATED_FROZEN, kind: "conflict" });
    expect(mapDbError(new Error("primary_school.review_sealed: …"))).toMatchObject({ code: PrimaryCode.REVIEW_SEALED });
    expect(mapDbError(new Error("primary_school.inconnu: …"))).toMatchObject({ kind: "conflict" });
    expect(mapDbError(new Error("autre erreur"))).toBeNull();
    // chaque message de déclencheur de la migration a sa traduction
    for (const code of ["period_locked", "scale_mismatch", "framework_not_published", "validated_frozen", "review_sealed", "year_frozen", "archive_frozen", "attendance_signed", "review_needs_decision", "review_needs_results", "scale_in_use"]) {
      expect(DB_CODE_MESSAGES[code], code).toBeDefined();
    }
  });
});

describe("rapports : export CSV", () => {
  const report: Report = {
    key: "class-list",
    title: "Liste",
    generatedAt: "2026-10-02T00:00:00.000Z",
    parameters: {},
    columns: [{ key: "n", label: "N°" }, { key: "student", label: "Élève" }],
    rows: [{ n: 1, student: 'Awa "la grande"; Koné' }, { n: 2, student: "=HYPERLINK(\"http://x\")" }, { n: 3, student: null }],
  };
  it("échappe les guillemets et séparateurs, neutralise les formules, ajoute le BOM", () => {
    const csv = reportToCsv(report);
    expect(csv.startsWith("﻿N°;Élève\r\n")).toBe(true);
    expect(csv).toContain('1;"Awa ""la grande""; Koné"');
    expect(csv).toContain("2;\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csv).toContain("3;\r\n");
  });
});
