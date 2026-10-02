/**
 * Extensions Phase 4-5 du module `people` (specs 005 §14.2, 006 §7.4, 007 §16, 018 §16) : âge à une date de référence,
 * score et raisons des doublons, statuts sanctionnants, titulaire généraliste (HOMEROOM + covers_all_subjects).
 */
import { describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { ageInYearsOn, isValidIsoDate } from "../../domain/age";
import { duplicateReasons, duplicateScore, matchPerson } from "../../domain/duplicates";
import { canTransitionStudent, requiresHumanActor, studentReasonRequired } from "../../domain/status";
import { assignmentShapeProblems, isGeneralistHomeroom, isStaffAssigned, listUnstaffedNodes, resolveResponsible, type AssignmentFact, type NodeFact } from "../../domain/assignments";
import { PeopleErrors } from "../../domain/errors";
import { PEOPLE_ERROR_CODES, PEOPLE_DUPLICATE_REASONS } from "@ecoledigitale/contracts/src/v2/people";

describe("âge à une date de référence (ageInYearsOn)", () => {
  it("années révolues : la veille de l'anniversaire, le jour même, le lendemain", () => {
    expect(ageInYearsOn("2015-06-15", "2025-06-14")).toBe(9);
    expect(ageInYearsOn("2015-06-15", "2025-06-15")).toBe(10);
    expect(ageInYearsOn("2015-06-15", "2025-06-16")).toBe(10);
    expect(ageInYearsOn("2015-12-31", "2025-12-30")).toBe(9);
    expect(ageInYearsOn("2015-12-31", "2025-12-31")).toBe(10);
    expect(ageInYearsOn("2015-01-01", "2025-01-01")).toBe(10);
  });
  it("naissance un 29 février : 1er mars hors année bissextile par défaut, 28 février sur demande, 29 février les années bissextiles", () => {
    expect(ageInYearsOn("2016-02-29", "2025-02-28")).toBe(8);
    expect(ageInYearsOn("2016-02-29", "2025-03-01")).toBe(9);
    expect(ageInYearsOn("2016-02-29", "2025-02-28", { leapBirthday: "FEB_28" })).toBe(9);
    expect(ageInYearsOn("2016-02-29", "2027-02-27", { leapBirthday: "FEB_28" })).toBe(10);
    expect(ageInYearsOn("2016-02-29", "2028-02-28")).toBe(11);
    expect(ageInYearsOn("2016-02-29", "2028-02-29")).toBe(12);
    expect(ageInYearsOn("2000-02-29", "2100-03-01")).toBe(100); // 2100 n'est pas bissextile
  });
  it("le jour de la naissance : 0 an ; une date de référence antérieure à la naissance : null (jamais un âge négatif ou 0)", () => {
    expect(ageInYearsOn("2020-05-05", "2020-05-05")).toBe(0);
    expect(ageInYearsOn("2020-05-05", "2021-05-04")).toBe(0);
    expect(ageInYearsOn("2020-05-05", "2020-05-04")).toBeNull();
    expect(ageInYearsOn("2020-05-05", "2019-01-01")).toBeNull();
  });
  it("date non calendaire : RangeError (erreur de l'appelant) ; isValidIsoDate refuse 30 février et formats approximatifs", () => {
    expect(() => ageInYearsOn("2020-02-30", "2025-01-01")).toThrow(RangeError);
    expect(() => ageInYearsOn("2020-01-01", "31/12/2025")).toThrow(RangeError);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2023-02-29")).toBe(false);
    expect(isValidIsoDate("2025-13-01")).toBe(false);
    expect(isValidIsoDate("2025-1-1")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
  it("ne dépend jamais de l'horloge : même résultat quelle que soit la date courante", () => {
    const a = ageInYearsOn("2014-09-01", "2025-12-31");
    expect(a).toBe(11);
    expect(ageInYearsOn("2014-09-01", "2025-12-31")).toBe(a);
  });
});

describe("doublons : score et raisons (codes, sans donnée personnelle)", () => {
  const draft = { lastName: "Kouassi", firstName: "Awa", birthDate: "2015-03-02" };
  it("EXACT : même nom (permutation admise) et même date -> 100, SAME_NAME + SAME_BIRTHDATE", () => {
    const existing = { lastName: "Awa", firstName: "KOUASSI", birthDate: "2015-03-02" };
    const match = matchPerson(draft, existing)!;
    const reasons = duplicateReasons(draft, existing);
    expect(match).toBe("EXACT");
    expect(reasons).toEqual(["SAME_NAME", "SAME_BIRTHDATE"]);
    expect(duplicateScore(match, reasons)).toBe(100);
  });
  it("NEAR : une faute de frappe, même date -> SIMILAR_NAME + SAME_BIRTHDATE, score inférieur à EXACT", () => {
    const existing = { lastName: "Kouasi", firstName: "Awa", birthDate: "2015-03-02" };
    const match = matchPerson(draft, existing)!;
    const reasons = duplicateReasons(draft, existing);
    expect(match).toBe("NEAR");
    expect(reasons).toEqual(["SIMILAR_NAME", "SAME_BIRTHDATE"]);
    expect(duplicateScore(match, reasons)).toBeLessThan(100);
    expect(duplicateScore(match, reasons)).toBeGreaterThan(duplicateScore("NAME_ONLY", ["SAME_NAME", "BIRTHDATE_UNKNOWN"]));
  });
  it("NAME_ONLY : une date inconnue -> SAME_NAME + BIRTHDATE_UNKNOWN", () => {
    const existing = { lastName: "Kouassi", firstName: "Awa", birthDate: null };
    const match = matchPerson(draft, existing)!;
    expect(match).toBe("NAME_ONLY");
    expect(duplicateReasons(draft, existing)).toEqual(["SAME_NAME", "BIRTHDATE_UNKNOWN"]);
  });
  it("signaux de contact (personnel, tuteurs) : e-mail / téléphone, bonus plafonné à 100", () => {
    const d = { lastName: "Traoré", firstName: "Ali", birthDate: "1985-01-01", email: "ali@example.test", phone: "+2250101010101" };
    const same = { ...d };
    const reasons = duplicateReasons(d, same, { contactSignals: true });
    expect(reasons).toEqual(["SAME_NAME", "SAME_BIRTHDATE", "SAME_EMAIL", "SAME_PHONE"]);
    expect(duplicateScore("EXACT", reasons)).toBe(100);
    const mailOnly = { lastName: "Autre", firstName: "Nom", birthDate: "1990-01-01", email: "ali@example.test", phone: null };
    expect(matchPerson(d, mailOnly, { contactSignals: true })).toBe("EMAIL");
    expect(duplicateReasons(d, mailOnly, { contactSignals: true })).toEqual(["SAME_EMAIL"]);
    expect(duplicateScore("EMAIL", ["SAME_EMAIL"])).toBeLessThan(100);
    // sans `contactSignals` (élèves), aucun signal de contact
    expect(duplicateReasons(d, same)).toEqual(["SAME_NAME", "SAME_BIRTHDATE"]);
  });
  it("ordre cohérent : EXACT > EMAIL > PHONE > NEAR > NAME_ONLY ; codes alignés sur le contrat", () => {
    const s = (m: Parameters<typeof duplicateScore>[0]) => duplicateScore(m, []);
    expect([s("EXACT"), s("EMAIL"), s("PHONE"), s("NEAR"), s("NAME_ONLY")]).toEqual([...[s("EXACT"), s("EMAIL"), s("PHONE"), s("NEAR"), s("NAME_ONLY")]].sort((a, b) => b - a));
    const all = new Set(PEOPLE_DUPLICATE_REASONS);
    for (const r of duplicateReasons(draft, { ...draft, email: "a@b.test", phone: "1" }, { contactSignals: true })) expect(all.has(r)).toBe(true);
  });
});

describe("statuts sanctionnants (spec 006 §7.4)", () => {
  it("INACTIVE -> ACTIVE est légal sans motif (confirmation d'inscription) ; SUSPENDED et EXCLUDED exigent un motif", () => {
    expect(canTransitionStudent("INACTIVE", "ACTIVE")).toBe(true);
    expect(studentReasonRequired("INACTIVE", "ACTIVE")).toBe(false);
    expect(studentReasonRequired("ACTIVE", "SUSPENDED")).toBe(true);
    expect(studentReasonRequired("ACTIVE", "EXCLUDED")).toBe(true);
    expect(studentReasonRequired("SUSPENDED", "ACTIVE")).toBe(false); // levée de suspension : inchangé
  });
  it("suspension et exclusion sont des actes humains ; les autres statuts non", () => {
    expect(requiresHumanActor("SUSPENDED")).toBe(true);
    expect(requiresHumanActor("EXCLUDED")).toBe(true);
    expect(requiresHumanActor("ACTIVE")).toBe(false);
    expect(requiresHumanActor("WITHDRAWN")).toBe(false);
  });
  it("nouveaux codes d'erreur déclarés au contrat", () => {
    for (const e of [PeopleErrors.humanActorRequired("x"), PeopleErrors.studentIdConflict(), PeopleErrors.invalidReferenceDate()]) {
      expect(PEOPLE_ERROR_CODES).toContain((e as unknown as { code: string }).code);
    }
  });
});

describe("titulaire généraliste : HOMEROOM + covers_all_subjects (spec 005 T-P10, AC2.3)", () => {
  const classroomId = newId();
  const [nodeA, nodeB, conduite] = [newId(), newId(), newId()];
  const [teacher, other, sub] = [newId(), newId(), newId()];
  const mk = (over: Partial<AssignmentFact>): AssignmentFact => ({
    id: newId(), staffId: teacher, classroomId, curriculumNodeId: null, periodId: null, roleCode: "HOMEROOM", replacesAssignmentId: null,
    coversAllSubjects: true, status: "ACTIVE", startsOn: "2025-09-01", endsOn: null, ...over,
  });
  const resolve = (list: AssignmentFact[], nodeId: string, extra: { transversal?: boolean; onDate?: string } = {}) =>
    resolveResponsible(list, { classroomId, nodeId, nodeIsTransversal: extra.transversal ?? false, onDate: extra.onDate ?? "2025-10-01" });

  it("forme valide ; reconnu comme généraliste", () => {
    expect(assignmentShapeProblems({ roleCode: "HOMEROOM", coversAllSubjects: true })).toEqual([]);
    expect(isGeneralistHomeroom(mk({}))).toBe(true);
    expect(isGeneralistHomeroom(mk({ coversAllSubjects: false }))).toBe(false);
    expect(isGeneralistHomeroom(mk({ roleCode: "LEAD" }))).toBe(false);
  });
  it("renvoie le titulaire pour N'IMPORTE QUEL nœud non transversal, avec coversAllSubjects", () => {
    const homeroom = mk({});
    for (const node of [nodeA, nodeB, newId()]) expect(resolve([homeroom], node)).toMatchObject({ staffId: teacher, assignmentId: homeroom.id, via: "HOMEROOM", coversAllSubjects: true });
    expect(resolve([homeroom], conduite, { transversal: true })).toBeNull();
  });
  it("un LEAD explicite (spécialiste : anglais, EPS) prime sur le titulaire généraliste", () => {
    const homeroom = mk({});
    const english = mk({ roleCode: "LEAD", coversAllSubjects: false, curriculumNodeId: nodeA, staffId: other });
    expect(resolve([homeroom, english], nodeA)).toMatchObject({ staffId: other, via: "LEAD", coversAllSubjects: false });
    expect(resolve([homeroom, english], nodeB)).toMatchObject({ staffId: teacher, via: "HOMEROOM" });
  });
  it("un titulaire SANS covers_all_subjects reste le repli historique (inchangé) mais n'est pas habilité à noter", () => {
    const plain = mk({ coversAllSubjects: false });
    expect(resolve([plain], nodeA)).toMatchObject({ staffId: teacher, via: "HOMEROOM", coversAllSubjects: false });
    expect(isStaffAssigned([plain], { staffId: teacher, classroomId, nodeId: nodeA, onDate: "2025-10-01" })).toBe(false);
    expect(isStaffAssigned([plain], { staffId: teacher, classroomId, onDate: "2025-10-01" })).toBe(true);
  });
  it("le généraliste est habilité sur tout nœud de SA classe, pas ailleurs, pas hors dates", () => {
    const homeroom = mk({});
    const q = { staffId: teacher, classroomId, onDate: "2025-10-01" };
    expect(isStaffAssigned([homeroom], { ...q, nodeId: nodeA })).toBe(true);
    expect(isStaffAssigned([homeroom], { ...q, nodeId: newId() })).toBe(true);
    expect(isStaffAssigned([homeroom], { ...q, classroomId: newId(), nodeId: nodeA })).toBe(false);
    expect(isStaffAssigned([homeroom], { ...q, staffId: other, nodeId: nodeA })).toBe(false);
    expect(isStaffAssigned([homeroom], { ...q, onDate: "2025-08-31", nodeId: nodeA })).toBe(false);
  });
  it("bascule du remplaçant : droits hérités à la date d'effet, l'ancien titulaire les perd (affectation terminée la veille)", () => {
    const old = mk({ status: "ENDED", endsOn: "2025-10-14" });
    const next = mk({ staffId: sub, startsOn: "2025-10-15" });
    expect(resolve([old, next], nodeA, { onDate: "2025-10-14" })).toBeNull();
    expect(resolve([old, next], nodeA, { onDate: "2025-10-15" })).toMatchObject({ staffId: sub });
    expect(isStaffAssigned([old, next], { staffId: teacher, classroomId, nodeId: nodeA, onDate: "2025-10-15" })).toBe(false);
    expect(isStaffAssigned([old, next], { staffId: sub, classroomId, nodeId: nodeA, onDate: "2025-10-15" })).toBe(true);
    // suppléance de longue durée : SUBSTITUTE généraliste qui remplace le titulaire encore actif
    const homeroom = mk({});
    const leave = mk({ staffId: sub, roleCode: "SUBSTITUTE", replacesAssignmentId: homeroom.id, startsOn: "2025-11-01" });
    expect(assignmentShapeProblems({ roleCode: "SUBSTITUTE", coversAllSubjects: true, replacesAssignmentId: homeroom.id })).toEqual([]);
    expect(resolve([homeroom, leave], nodeA, { onDate: "2025-10-31" })).toMatchObject({ staffId: teacher, via: "HOMEROOM" });
    expect(resolve([homeroom, leave], nodeA, { onDate: "2025-11-02" })).toMatchObject({ staffId: sub, via: "SUBSTITUTE", coversAllSubjects: true });
    expect(isStaffAssigned([homeroom, leave], { staffId: sub, classroomId, nodeId: nodeB, onDate: "2025-11-02" })).toBe(true);
  });
  it("listUnstaffedNodes : un titulaire généraliste pourvoit toutes les matières de la classe (pas un simple titulaire)", () => {
    const nodes: NodeFact[] = [
      { id: nodeA, isMandatory: true, isTransversal: false },
      { id: nodeB, isMandatory: true, isTransversal: false },
      { id: conduite, isMandatory: true, isTransversal: true },
    ];
    const q = { classroomId, onDate: "2025-10-01" };
    expect(listUnstaffedNodes(nodes, [mk({})], q)).toEqual([]);
    expect(listUnstaffedNodes(nodes, [mk({ coversAllSubjects: false })], q)).toHaveLength(2);
    expect(listUnstaffedNodes(nodes, [mk({ status: "ENDED" })], q)).toHaveLength(2);
    expect(listUnstaffedNodes(nodes, [mk({ classroomId: newId() })], q)).toHaveLength(2);
  });
});
