import { describe, expect, it } from "vitest";
import { isCurrentlyValid, lastAcquisitionDate, parseCredits, roundCredits, sumCredits, validUntilFor } from "../../domain/credits";
import { MENTION_PENDING, buildRequirementsSnapshot, computeProgress, resolveRequirementStates, toEligibilityContext } from "../../domain/diploma";
import { duplicateReference, formatAttestationReference, formatAuthenticityReference, formatDiplomaReference, formatReference } from "../../domain/numbering";
import { buildGraph, decimalGte, evaluatePrerequisites, findPath, wouldCreateCycle } from "../../domain/prerequisites";
import { REQUIRED_SLOTS, isSlotInForce, previousDay, slotInForce } from "../../domain/signatures";
import { canonicalJson, sha256Hex, snapshotHash } from "../../domain/snapshot";
import type { DiplomaRequirement, DocumentSlot, LedgerEntry, Prerequisite } from "../../domain/types";
import { normalizeAcquisition } from "../../application/ledger";
import { parsePeriodClosed, pickUuid } from "../../application/consumers";
import type { UeResultLine } from "../../application/ports";

const id = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

describe("crédits : arithmétique exacte et validité", () => {
  it("sumCredits n'a pas de dérive flottante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumCredits([0.1, 0.2])).toBe(0.3);
    expect(sumCredits([2.5, 3.5, 6])).toBe(12);
    expect(sumCredits([])).toBe(0);
    expect(roundCredits(2.675)).toBe(2.68);
  });

  it("parseCredits lit une colonne numeric et refuse l'invalide", () => {
    expect(parseCredits("6.00")).toBe(6);
    expect(parseCredits("2.50")).toBe(2.5);
    expect(() => parseCredits("-1")).toThrow(RangeError);
    expect(() => parseCredits("abc")).toThrow(RangeError);
  });

  it("validUntilFor : N mois, jour ramené en fin de mois, null = sans limite", () => {
    expect(validUntilFor("2026-09-30", null)).toBeNull();
    expect(validUntilFor("2026-09-30", 12)).toBe("2027-09-30");
    expect(validUntilFor("2026-01-31", 1)).toBe("2026-02-28");
    expect(validUntilFor("2027-12-31", 2)).toBe("2028-02-29"); // année bissextile
    expect(validUntilFor("2026-11-15", 3)).toBe("2027-02-15");
    expect(validUntilFor("2026-11-15", 120)).toBe("2036-11-15");
    expect(() => validUntilFor("2026-01-01", 0)).toThrow(RangeError);
  });

  it("isCurrentlyValid : ACQUIRED et pas périmée (la fin de validité est INCLUSE)", () => {
    expect(isCurrentlyValid({ status: "ACQUIRED", validUntil: null }, "2030-01-01")).toBe(true);
    expect(isCurrentlyValid({ status: "ACQUIRED", validUntil: "2026-10-01" }, "2026-10-01")).toBe(true);
    expect(isCurrentlyValid({ status: "ACQUIRED", validUntil: "2026-10-01" }, "2026-10-02")).toBe(false);
    expect(isCurrentlyValid({ status: "REVOKED", validUntil: null }, "2026-10-01")).toBe(false);
    expect(isCurrentlyValid({ status: "EXPIRED", validUntil: null }, "2026-10-01")).toBe(false);
  });

  it("lastAcquisitionDate : la dernière acquisition, jamais « aujourd'hui »", () => {
    expect(lastAcquisitionDate([])).toBeNull();
    expect(lastAcquisitionDate([{ acquiredAt: new Date("2026-06-10T10:00:00Z") }, { acquiredAt: new Date("2026-08-20T23:30:00Z") }, { acquiredAt: new Date("2026-07-01T00:00:00Z") }])).toBe("2026-08-20");
  });
});

describe("numérotation : formats des références (Q-24)", () => {
  it("DIP-AAAA-NNNNNN, AUTH/AAAA/NNN, ATT-AAAA-NNNNNN", () => {
    expect(formatDiplomaReference(2026, 1)).toBe("DIP-2026-000001");
    expect(formatDiplomaReference(2026, 1234567)).toBe("DIP-2026-1234567");
    expect(formatAuthenticityReference(2026, 7)).toBe("AUTH/2026/007");
    expect(formatAuthenticityReference(2026, 1234)).toBe("AUTH/2026/1234");
    expect(formatAttestationReference(2027, 42)).toBe("ATT-2027-000042");
    expect(formatReference("DIPLOMA", 2026, 3)).toBe("DIP-2026-000003");
    expect(formatReference("AUTHENTICITY", 2026, 3)).toBe("AUTH/2026/003");
    expect(formatReference("ATTESTATION", 2026, 3)).toBe("ATT-2026-000003");
    expect(() => formatDiplomaReference(2026, 0)).toThrow(RangeError);
  });

  it("duplicata : suffixe /Dn, jamais cumulé", () => {
    expect(duplicateReference("DIP-2026-000001", 1)).toBe("DIP-2026-000001");
    expect(duplicateReference("DIP-2026-000001", 2)).toBe("DIP-2026-000001/D1");
    expect(duplicateReference("DIP-2026-000001/D1", 3)).toBe("DIP-2026-000001/D2");
  });
});

describe("prérequis : graphe, cycles, satisfaction", () => {
  const edges = (pairs: Array<[number, number]>) => buildGraph(pairs.map(([ue, p]) => ({ ueNodeId: id(ue), prerequisiteNodeId: id(p) })));

  it("findPath et wouldCreateCycle (auto-référence, cycle direct et transitif, remplacement de liste)", () => {
    const g = edges([[2, 1], [3, 2], [4, 3]]);
    expect(findPath(g, id(4), id(1))).toEqual([id(4), id(3), id(2), id(1)]);
    expect(findPath(g, id(1), id(4))).toBeNull();
    expect(wouldCreateCycle(g, id(1), [id(1)])).toEqual([id(1), id(1)]);
    expect(wouldCreateCycle(g, id(1), [id(4)])).toEqual([id(1), id(4), id(3), id(2), id(1)]);
    expect(wouldCreateCycle(g, id(1), [id(2)])).not.toBeNull();
    expect(wouldCreateCycle(g, id(5), [id(1), id(4)])).toBeNull(); // UE isolée : aucun cycle
    // On REMPLACE la liste de l'UE 3 (qui exigeait 2) : 3 -> 1 est acyclique, et 1 -> 3 le devient ensuite.
    expect(wouldCreateCycle(g, id(3), [id(1)])).toBeNull();
    // Graphe déjà cyclique (donnée corrompue) : le parcours termine.
    const bad = edges([[1, 2], [2, 1]]);
    expect(findPath(bad, id(1), id(9))).toBeNull();
  });

  it("graphe large de 50 UE sur 10 niveaux : détection immédiate", () => {
    const pairs: Array<[number, number]> = [];
    for (let level = 1; level < 10; level += 1) for (let i = 0; i < 5; i += 1) pairs.push([level * 5 + i, (level - 1) * 5 + (i % 2)]);
    const g = edges(pairs);
    expect(wouldCreateCycle(g, 0 * 5 + 0 === 0 ? id(0) : id(0), [id(9 * 5 + 4)])).not.toBeNull();
    expect(wouldCreateCycle(g, id(100), [id(9 * 5 + 4)])).toBeNull();
  });

  it("decimalGte : comparaison EXACTE de décimaux, sans flottant", () => {
    expect(decimalGte("12", "12")).toBe(true);
    expect(decimalGte("12.000", "12")).toBe(true);
    expect(decimalGte("11.999", "12")).toBe(false);
    expect(decimalGte("12.0001", "12.000")).toBe(true);
    expect(decimalGte("9.999999999999999", "10")).toBe(false);
    expect(decimalGte("10", "9.5")).toBe(true);
    expect(decimalGte("9.5", "10")).toBe(false);
    expect(decimalGte("0.30000000000000004", "0.3")).toBe(true);
  });

  it("evaluatePrerequisites : VALIDATED, ATTENDED, MIN_AVERAGE", () => {
    const p = (n: number, mode: Prerequisite["mode"], min: string | null = null): Prerequisite => ({ id: id(900 + n), ueNodeId: id(100), prerequisiteNodeId: id(n), mode, minAverage: min });
    const acquired = [{ ueNodeId: id(1), averageExact: "10.5" }, { ueNodeId: id(2), averageExact: null }];
    expect(evaluatePrerequisites([], acquired)).toEqual({ satisfied: true, missing: [] });
    expect(evaluatePrerequisites([p(1, "VALIDATED")], acquired).satisfied).toBe(true);
    expect(evaluatePrerequisites([p(3, "VALIDATED")], acquired).missing[0]).toMatchObject({ prerequisiteNodeId: id(3), reason: "NOT_ACQUIRED" });
    expect(evaluatePrerequisites([p(3, "ATTENDED")], acquired, new Set([id(3)])).satisfied).toBe(true);
    expect(evaluatePrerequisites([p(3, "ATTENDED")], acquired).missing[0]?.reason).toBe("NOT_ATTENDED");
    expect(evaluatePrerequisites([p(1, "ATTENDED")], acquired).satisfied).toBe(true); // acquise implique suivie
    expect(evaluatePrerequisites([p(1, "MIN_AVERAGE", "10.5")], acquired).satisfied).toBe(true);
    expect(evaluatePrerequisites([p(1, "MIN_AVERAGE", "10.6")], acquired).missing[0]?.reason).toBe("AVERAGE_TOO_LOW");
    expect(evaluatePrerequisites([p(2, "MIN_AVERAGE", "5")], acquired).missing[0]?.reason).toBe("AVERAGE_TOO_LOW"); // moyenne inconnue : non satisfait
    const mixed = evaluatePrerequisites([p(1, "VALIDATED"), p(3, "VALIDATED"), p(4, "VALIDATED")], acquired);
    expect(mixed.missing.map((m) => m.prerequisiteNodeId)).toEqual([id(3), id(4)]);
  });
});

describe("diplôme : contexte d'éligibilité et progression", () => {
  const req = (ue: number, credits: number, mandatory: boolean, removed = false): DiplomaRequirement => ({
    id: id(500 + ue), definitionId: id(1), ueNodeId: id(ue), ueCode: `UE${ue}`, ueLabel: `Unité ${ue}`, credits, mandatory, position: ue, removedFromCurriculum: removed,
  });
  const entry = (ue: number, credits: number) => ({ id: id(800 + ue), ueNodeId: id(ue), credits });

  it("dédoublonne par UE (l'obligatoire prime) et marque validées les UE du registre, avec les crédits FIGÉS de l'écriture", () => {
    const states = resolveRequirementStates([req(1, 6, false), req(1, 6, true), req(2, 4, false)], [entry(1, 5), entry(9, 3)]);
    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({ ueNodeId: id(1), mandatory: true, validated: true, credits: 5, ledgerId: id(801) }); // 5 (figé) et non 6 (curriculum)
    expect(states[1]).toMatchObject({ ueNodeId: id(2), mandatory: false, validated: false, credits: 4, ledgerId: null });
    expect(toEligibilityContext(states)).toEqual([{ valide: true, obligatoire: true, uv: 5 }, { valide: false, obligatoire: false, uv: 4 }]);
  });

  it("une exigence retirée du curriculum n'est plus exigée si non acquise, mais compte pour qui l'a acquise", () => {
    const states = resolveRequirementStates([req(1, 6, true, true), req(2, 6, true, true), req(3, 6, true)], [entry(1, 6)]);
    expect(states.map((s) => [s.ueNodeId, s.validated])).toEqual([[id(1), true], [id(3), false]]);
    expect(states.find((s) => s.ueNodeId === id(1))?.removedFromCurriculum).toBe(true);
  });

  it("progression : UV, pourcentage plafonné à 100, obligatoires manquantes", () => {
    const states = resolveRequirementStates([req(1, 6, true), req(2, 6, true), req(3, 6, false)], [entry(1, 6), entry(3, 6)]);
    const p = computeProgress(states, 12);
    expect(p).toMatchObject({ uvValidated: 12, uvRequired: 12, percent: 100 });
    expect(p.missingMandatory.map((s) => s.ueNodeId)).toEqual([id(2)]);
    expect(computeProgress(states, 8).percent).toBe(100); // plafonné
    expect(computeProgress(states, 24).percent).toBe(50);
    expect(computeProgress([], 12)).toMatchObject({ uvValidated: 0, percent: 0 });
    expect(computeProgress(states, 0).percent).toBe(0);
  });

  it("snapshot d'octroi : copie figée, versionnée", () => {
    const states = resolveRequirementStates([req(1, 6, true)], [entry(1, 6)]);
    const snap = buildRequirementsSnapshot(states, 6, new Date("2026-10-01T10:00:00Z"));
    expect(snap).toEqual({ v: 1, uvRequired: 6, capturedAt: "2026-10-01T10:00:00.000Z", requirements: [{ ueNodeId: id(1), code: "UE1", label: "Unité 1", credits: 6, mandatory: true, validated: true, ledgerId: id(801) }] });
    expect(MENTION_PENDING).toBe("PENDING");
  });
});

describe("snapshots : forme canonique et empreinte", () => {
  it("l'ordre des clés n'influence pas l'empreinte ; undefined écarté ; tout changement la modifie", () => {
    const a = { z: 1, a: { y: [1, 2, { b: 1, a: 2 }], x: undefined }, m: null };
    const b = { m: null, a: { x: undefined, y: [1, 2, { a: 2, b: 1 }] }, z: 1 };
    expect(canonicalJson(a)).toBe('{"a":{"y":[1,2,{"a":2,"b":1}]},"m":null,"z":1}');
    expect(snapshotHash(a)).toBe(snapshotHash(b));
    expect(snapshotHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotHash({ ...a, z: 2 })).not.toBe(snapshotHash(a));
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(RangeError);
    expect(canonicalJson({ d: new Date("2026-01-01T00:00:00Z") })).toBe('{"d":"2026-01-01T00:00:00.000Z"}');
  });
});

describe("signataires datés : aucun défaut", () => {
  const slot = (key: DocumentSlot["slotKey"], from: string, to: string | null, n = 1): DocumentSlot => ({ id: id(n), slotKey: key, signatoryId: id(n), validFrom: from, validTo: to, createdBy: id(99), createdAt: new Date("2026-01-01T00:00:00Z") });

  it("emplacements obligatoires par document", () => {
    expect(REQUIRED_SLOTS.DIPLOMA).toEqual(["DIPLOMA_LEFT", "DIPLOMA_RIGHT"]);
    expect(REQUIRED_SLOTS.ATTESTATION_SUCCESS).toEqual(["ATTESTATION_SUCCESS"]);
    expect(REQUIRED_SLOTS.ATTESTATION_AUTHENTICITY).toEqual(["AUTHENTICITY"]);
  });

  it("en vigueur : bornes incluses, fin ouverte, aucun repli", () => {
    expect(isSlotInForce({ validFrom: "2026-01-01", validTo: "2026-12-31" }, "2026-01-01")).toBe(true);
    expect(isSlotInForce({ validFrom: "2026-01-01", validTo: "2026-12-31" }, "2026-12-31")).toBe(true);
    expect(isSlotInForce({ validFrom: "2026-01-01", validTo: "2026-12-31" }, "2027-01-01")).toBe(false);
    expect(isSlotInForce({ validFrom: "2026-01-01", validTo: null }, "2099-01-01")).toBe(true);
    expect(isSlotInForce({ validFrom: "2026-01-01", validTo: null }, "2025-12-31")).toBe(false);
    const slots = [slot("DIPLOMA_LEFT", "2025-01-01", "2025-12-31", 1), slot("DIPLOMA_LEFT", "2026-01-01", null, 2)];
    expect(slotInForce(slots, "DIPLOMA_LEFT", "2025-06-01")?.signatoryId).toBe(id(1));
    expect(slotInForce(slots, "DIPLOMA_LEFT", "2026-06-01")?.signatoryId).toBe(id(2));
    expect(slotInForce(slots, "DIPLOMA_RIGHT", "2026-06-01")).toBeNull();
    expect(slotInForce([], "DIPLOMA_LEFT", "2026-06-01")).toBeNull();
  });

  it("previousDay franchit les mois et les années", () => {
    expect(previousDay("2026-12-01")).toBe("2026-11-30");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
  });
});

describe("capitalisation : normalisation d'une ligne de résultat et lecture des événements", () => {
  const line = (over: Partial<UeResultLine>): UeResultLine => ({
    studentId: id(1), enrollmentId: id(2), ueNodeId: id(3), academicYearId: id(4), academicPeriodId: id(5), credits: 6, averageExact: "12", validated: true, ueState: "VALIDATED",
    sessionObtained: 1, via: "DIRECT", overrideId: null, compensatedEcueCount: 0, sourceResultId: id(6), resultsVersion: 1, ...over,
  });

  it("origine et session cohérentes (contrainte de la base), jury sans référence rejeté", () => {
    expect(normalizeAcquisition(line({}))).toEqual({ via: "DIRECT", session: 1 });
    expect(normalizeAcquisition(line({ via: "RESIT", sessionObtained: 2 }))).toEqual({ via: "RESIT", session: 2 });
    expect(normalizeAcquisition(line({ via: "DIRECT", sessionObtained: 2 }))).toEqual({ via: "RESIT", session: 2 });
    expect(normalizeAcquisition(line({ via: "RESIT", sessionObtained: null }))).toEqual({ via: "RESIT", session: 2 });
    expect(normalizeAcquisition(line({ via: "JURY_OVERRIDE", overrideId: id(7) }))).toEqual({ via: "JURY_OVERRIDE", session: 1 });
    expect(normalizeAcquisition(line({ via: "JURY_OVERRIDE", overrideId: null }))).toBeNull();
  });

  it("parsePeriodClosed / pickUuid tolèrent les variantes de nom et rejettent l'inexploitable", () => {
    expect(parsePeriodClosed({ classroomId: id(1), academicPeriodId: id(2), stateId: id(3), resultsVersion: 2 })).toEqual({ classroomId: id(1), academicPeriodId: id(2), stateId: id(3), resultsVersion: 2 });
    expect(parsePeriodClosed({ classroomId: id(1), periodId: id(2) })).toMatchObject({ academicPeriodId: id(2) });
    expect(parsePeriodClosed({ classroomId: id(1) })).toBeNull();
    expect(parsePeriodClosed(null)).toBeNull();
    expect(parsePeriodClosed({ classroomId: "x", academicPeriodId: id(2) })).toBeNull();
    expect(pickUuid({ a: "no", b: id(1) }, "a", "b")).toBe(id(1));
    const entry = null as unknown as LedgerEntry;
    expect(entry).toBeNull();
  });
});
