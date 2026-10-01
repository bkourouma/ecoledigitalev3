import { describe, expect, it } from "vitest";
import {
  allowedStudentTransitions,
  canTransitionStaff,
  canTransitionStudent,
  deactivatesStaff,
  isFinalStudentStatus,
  setsLeftOn,
  staffCanReceiveAssignments,
  STUDENT_STATUSES,
  studentReasonRequired,
  suspendsPortalAccess,
} from "../../domain/status";
import { forbiddenFlagsForKind, isGuardianOfStudentRule, resolveLinkFlags, type GuardianshipFacts } from "../../domain/guardianship";
import {
  assignmentShapeProblems,
  isActiveOn,
  isStaffAssigned,
  listUnstaffedNodes,
  resolveResponsible,
  type AssignmentFact,
  type NodeFact,
} from "../../domain/assignments";
import { contractualHours, summarizePlannedHours } from "../../domain/teaching-load";
import { isEnrollmentEvent, parseEnrollmentPayload, statusForEvent } from "../../domain/enrollment-projection";
import { newId } from "@ecoledigitale/kernel";

describe("machine d'états du statut d'un élève", () => {
  it("transitions légales (miroir du déclencheur students_guard)", () => {
    expect(canTransitionStudent("ACTIVE", "INACTIVE")).toBe(true);
    expect(canTransitionStudent("ACTIVE", "ARCHIVED")).toBe(false);
    expect(canTransitionStudent("SUSPENDED", "INACTIVE")).toBe(true);
    expect(canTransitionStudent("INACTIVE", "SUSPENDED")).toBe(false);
    expect(canTransitionStudent("EXCLUDED", "ARCHIVED")).toBe(true);
    expect(canTransitionStudent("ARCHIVED", "ACTIVE")).toBe(true);
    expect(canTransitionStudent("ARCHIVED", "WITHDRAWN")).toBe(false);
    expect(allowedStudentTransitions("GRADUATED")).toEqual(["ARCHIVED", "ACTIVE"]);
    expect(STUDENT_STATUSES).toHaveLength(8);
  });
  it("motif exigé pour les sorties et pour tout retour vers ACTIVE depuis un statut final ou ARCHIVED", () => {
    expect(studentReasonRequired("ACTIVE", "EXCLUDED")).toBe(true);
    expect(studentReasonRequired("ACTIVE", "WITHDRAWN")).toBe(true);
    expect(studentReasonRequired("INACTIVE", "TRANSFERRED_OUT")).toBe(true);
    expect(studentReasonRequired("ACTIVE", "INACTIVE")).toBe(false);
    expect(studentReasonRequired("ACTIVE", "GRADUATED")).toBe(false);
    expect(studentReasonRequired("GRADUATED", "ACTIVE")).toBe(true);
    expect(studentReasonRequired("ARCHIVED", "ACTIVE")).toBe(true);
    expect(studentReasonRequired("SUSPENDED", "ACTIVE")).toBe(false);
  });
  it("sorties définitives, left_on et suspension du portail", () => {
    expect(isFinalStudentStatus("WITHDRAWN")).toBe(true);
    expect(isFinalStudentStatus("ARCHIVED")).toBe(false);
    expect(setsLeftOn("GRADUATED")).toBe(true);
    expect(setsLeftOn("INACTIVE")).toBe(false);
    expect(suspendsPortalAccess("EXCLUDED")).toBe(true);
    expect(suspendsPortalAccess("GRADUATED")).toBe(false);
  });
  it("personnel : tout statut vers tout statut sauf LEFT qui ne revient qu'à ACTIVE", () => {
    expect(canTransitionStaff("ACTIVE", "ON_LEAVE")).toBe(true);
    expect(canTransitionStaff("ON_LEAVE", "LEFT")).toBe(true);
    expect(canTransitionStaff("LEFT", "ACTIVE")).toBe(true);
    expect(canTransitionStaff("LEFT", "SUSPENDED")).toBe(false);
    expect(staffCanReceiveAssignments("ON_LEAVE")).toBe(true);
    expect(staffCanReceiveAssignments("SUSPENDED")).toBe(false);
    expect(deactivatesStaff("LEFT")).toBe(true);
    expect(deactivatesStaff("ON_LEAVE")).toBe(false);
  });
});

describe("isGuardianOfStudentRule : matrice complète (AC2.3)", () => {
  const ok: GuardianshipFacts = { personHasIdentity: true, personStatus: "ACTIVE", guardianStatus: "ACTIVE", linkAlive: true, portalAccess: true, relationshipKind: "GUARDIAN" };
  it("seule la combinaison saine donne l'accès", () => {
    expect(isGuardianOfStudentRule(ok)).toBe(true);
  });
  it.each([
    ["aucune identité", { personHasIdentity: false }],
    ["personne archivée", { personStatus: "ARCHIVED" }],
    ["tuteur archivé", { guardianStatus: "ARCHIVED" }],
    ["lien clos", { linkAlive: false }],
    ["sans accès au portail", { portalAccess: false }],
    ["contact d'urgence", { relationshipKind: "EMERGENCY" }],
    ["lien « autre »", { relationshipKind: "OTHER" }],
  ] as const)("refuse : %s", (_name, patch) => {
    expect(isGuardianOfStudentRule({ ...ok, ...patch })).toBe(false);
  });
  it("drapeaux par défaut PRUDENTS (retrait et autorité à faux) ; accès fermé pour un type qui n'est pas une tutelle", () => {
    const f = resolveLinkFlags({});
    expect(f).toMatchObject({ canPickup: false, hasLegalCustody: false, isPrimaryContact: false, portalAccess: true, priority: 100 });
    expect(resolveLinkFlags({}, "EMERGENCY").portalAccess).toBe(false);
    expect(resolveLinkFlags({ canPickup: true, priority: 5 }).canPickup).toBe(true);
    expect(forbiddenFlagsForKind("EMERGENCY", { hasLegalCustody: true, portalAccess: true })).toEqual(["hasLegalCustody", "portalAccess"]);
    expect(forbiddenFlagsForKind("GUARDIAN", { hasLegalCustody: true, portalAccess: true })).toEqual([]);
  });
});

describe("affectations : résolution du responsable (AC2.3)", () => {
  const classroomId = newId();
  const nodeA = newId();
  const nodeB = newId();
  const conduite = newId();
  const t1 = newId();
  const t2 = newId();
  const t3 = newId();
  const mk = (over: Partial<AssignmentFact>): AssignmentFact => ({
    id: newId(),
    staffId: t1,
    classroomId,
    curriculumNodeId: null,
    periodId: null,
    roleCode: "LEAD",
    replacesAssignmentId: null,
    coversAllSubjects: false,
    status: "ACTIVE",
    startsOn: "2025-09-01",
    endsOn: null,
    ...over,
  });
  const resolve = (list: AssignmentFact[], nodeId: string, extra: { transversal?: boolean; periodId?: string; onDate?: string } = {}) =>
    resolveResponsible(list, { classroomId, nodeId, nodeIsTransversal: extra.transversal ?? false, periodId: extra.periodId, onDate: extra.onDate ?? "2025-10-01" });

  it("LEAD explicite > généraliste > titulaire", () => {
    const homeroom = mk({ staffId: t3, roleCode: "HOMEROOM" });
    const generalist = mk({ staffId: t2, coversAllSubjects: true });
    const lead = mk({ staffId: t1, curriculumNodeId: nodeA });
    expect(resolve([homeroom, generalist, lead], nodeA)?.via).toBe("LEAD");
    expect(resolve([homeroom, generalist, lead], nodeA)?.staffId).toBe(t1);
    expect(resolve([homeroom, generalist, lead], nodeB)).toMatchObject({ via: "GENERALIST", staffId: t2 });
    expect(resolve([homeroom], nodeB)).toMatchObject({ via: "HOMEROOM", staffId: t3 });
    expect(resolve([], nodeB)).toBeNull();
  });
  it("un nœud transversal (conduite) n'a JAMAIS de responsable, même avec un généraliste ou un titulaire", () => {
    const list = [mk({ coversAllSubjects: true }), mk({ roleCode: "HOMEROOM", staffId: t3 })];
    expect(resolve(list, conduite, { transversal: true })).toBeNull();
  });
  it("une affectation terminée ou hors dates ne compte pas", () => {
    expect(resolve([mk({ curriculumNodeId: nodeA, status: "ENDED" })], nodeA)).toBeNull();
    expect(resolve([mk({ curriculumNodeId: nodeA, startsOn: "2025-11-01" })], nodeA)).toBeNull();
    expect(resolve([mk({ curriculumNodeId: nodeA, endsOn: "2025-09-30" })], nodeA)).toBeNull();
    expect(resolve([mk({ curriculumNodeId: nodeA, endsOn: "2025-10-01" })], nodeA)?.staffId).toBe(t1); // bornes incluses
    expect(isActiveOn({ status: "ACTIVE", startsOn: "2025-09-01", endsOn: null }, "2025-09-01")).toBe(true);
  });
  it("période : l'affectation de la période précise prime sur celle de toutes les périodes", () => {
    const p1 = newId();
    const all = mk({ curriculumNodeId: nodeA, staffId: t1 });
    const onlyP1 = mk({ curriculumNodeId: nodeA, staffId: t2, periodId: p1 });
    expect(resolve([all, onlyP1], nodeA, { periodId: p1 })?.staffId).toBe(t2);
    expect(resolve([all, onlyP1], nodeA, { periodId: newId() })?.staffId).toBe(t1);
  });
  it("un SUBSTITUTE actif prend la place de l'affectation qu'il remplace pendant ses dates", () => {
    const lead = mk({ curriculumNodeId: nodeA, staffId: t1 });
    const sub = mk({ curriculumNodeId: nodeA, staffId: t2, roleCode: "SUBSTITUTE", replacesAssignmentId: lead.id, startsOn: "2025-10-15" });
    expect(resolve([lead, sub], nodeA, { onDate: "2025-10-01" })).toMatchObject({ staffId: t1, via: "LEAD" });
    expect(resolve([lead, sub], nodeA, { onDate: "2025-10-20" })).toMatchObject({ staffId: t2, via: "SUBSTITUTE" });
  });

  it("isStaffAssigned : classe entière (tous rôles) ou nœud précis (LEAD/CO_TEACHER/SUBSTITUTE/généraliste)", () => {
    const lead = mk({ curriculumNodeId: nodeA, staffId: t1 });
    const co = mk({ curriculumNodeId: nodeB, staffId: t2, roleCode: "CO_TEACHER" });
    const homeroom = mk({ staffId: t3, roleCode: "HOMEROOM" });
    const generalist = mk({ staffId: newId(), coversAllSubjects: true });
    const list = [lead, co, homeroom, generalist];
    const q = { classroomId, onDate: "2025-10-01" };
    expect(isStaffAssigned(list, { ...q, staffId: t1 })).toBe(true);
    expect(isStaffAssigned(list, { ...q, staffId: t3 })).toBe(true); // visible : titulaire de la classe
    expect(isStaffAssigned(list, { ...q, staffId: t3, nodeId: nodeA })).toBe(false); // …mais pas habilité à noter une matière
    expect(isStaffAssigned(list, { ...q, staffId: t1, nodeId: nodeA })).toBe(true);
    expect(isStaffAssigned(list, { ...q, staffId: t1, nodeId: nodeB })).toBe(false);
    expect(isStaffAssigned(list, { ...q, staffId: t2, nodeId: nodeB })).toBe(true);
    expect(isStaffAssigned(list, { ...q, staffId: generalist.staffId, nodeId: newId() })).toBe(true);
    expect(isStaffAssigned(list, { ...q, staffId: newId() })).toBe(false);
    expect(isStaffAssigned(list, { classroomId: newId(), staffId: t1, onDate: "2025-10-01" })).toBe(false);
  });

  it("listUnstaffedNodes : obligatoires non transversaux sans LEAD (explicite ou généraliste)", () => {
    const nodes: NodeFact[] = [
      { id: nodeA, isMandatory: true, isTransversal: false },
      { id: nodeB, isMandatory: true, isTransversal: false },
      { id: conduite, isMandatory: true, isTransversal: true },
      { id: newId(), isMandatory: false, isTransversal: false },
    ];
    const lead = mk({ curriculumNodeId: nodeA });
    expect(listUnstaffedNodes(nodes, [lead], { classroomId, onDate: "2025-10-01" }).map((n) => n.id)).toEqual([nodeB]);
    expect(listUnstaffedNodes(nodes, [lead, mk({ coversAllSubjects: true })], { classroomId, onDate: "2025-10-01" })).toEqual([]);
    // un co-enseignant ou un titulaire seul ne rend pas la matière « pourvue »
    expect(listUnstaffedNodes(nodes, [mk({ curriculumNodeId: nodeA, roleCode: "CO_TEACHER" }), mk({ roleCode: "HOMEROOM" })], { classroomId, onDate: "2025-10-01" })).toHaveLength(2);
  });

  it("forme d'une affectation (miroir des CHECK de la base)", () => {
    expect(assignmentShapeProblems({ roleCode: "LEAD", curriculumNodeId: nodeA })).toEqual([]);
    expect(assignmentShapeProblems({ roleCode: "LEAD", coversAllSubjects: true })).toEqual([]);
    expect(assignmentShapeProblems({ roleCode: "HOMEROOM" })).toEqual([]);
    expect(assignmentShapeProblems({ roleCode: "HOMEROOM", curriculumNodeId: nodeA })).toHaveLength(1);
    expect(assignmentShapeProblems({ roleCode: "LEAD" })).toHaveLength(1);
    expect(assignmentShapeProblems({ roleCode: "LEAD", coversAllSubjects: true, curriculumNodeId: nodeA })).toHaveLength(1);
    expect(assignmentShapeProblems({ roleCode: "SUBSTITUTE", curriculumNodeId: nodeA })).toHaveLength(1);
    expect(assignmentShapeProblems({ roleCode: "SUBSTITUTE", curriculumNodeId: nodeA, replacesAssignmentId: newId() })).toEqual([]);
    expect(assignmentShapeProblems({ roleCode: "CO_TEACHER", curriculumNodeId: nodeA, replacesAssignmentId: newId() })).toHaveLength(1);
  });
});

describe("charge d'enseignement (prévu et contractuel)", () => {
  it("somme les heures prévues par classe et par période", () => {
    const c1 = newId();
    const c2 = newId();
    const p = newId();
    const s = summarizePlannedHours([
      { classroomId: c1, periodId: p, plannedHours: 30.5 },
      { classroomId: c1, periodId: null, plannedHours: 10 },
      { classroomId: c2, periodId: p, plannedHours: null },
    ]);
    expect(s.total).toBe(40.5);
    expect(s.byClassroom.find((x) => x.classroomId === c1)?.plannedHours).toBe(40.5);
    expect(s.byClassroom.find((x) => x.classroomId === c2)?.plannedHours).toBe(0);
    expect(s.byPeriod.find((x) => x.periodId === p)?.plannedHours).toBe(30.5);
  });
  it("le volume contractuel PER_WEEK n'est converti en année que si l'appelant fournit les semaines (aucune constante codée)", () => {
    const contracts = [
      { startsOn: "2025-09-01", endsOn: null, committedHours: 18, committedHoursUnit: "PER_WEEK" as const, status: "ACTIVE" as const },
      { startsOn: "2025-09-01", endsOn: null, committedHours: 100, committedHoursUnit: "PER_YEAR" as const, status: "ACTIVE" as const },
      { startsOn: "2024-09-01", endsOn: "2025-08-31", committedHours: 999, committedHoursUnit: "PER_YEAR" as const, status: "ACTIVE" as const },
      { startsOn: "2025-09-01", endsOn: null, committedHours: 7, committedHoursUnit: "PER_WEEK" as const, status: "DRAFT" as const },
    ];
    expect(contractualHours(contracts, "2025-10-01")).toEqual({ perWeek: 18, perYear: 100, weeksPerYearUsed: null });
    expect(contractualHours(contracts, "2025-10-01", 30)).toEqual({ perWeek: 18, perYear: 640, weeksPerYearUsed: 30 });
    expect(contractualHours([], "2025-10-01")).toEqual({ perWeek: null, perYear: null, weeksPerYearUsed: null });
  });
});

describe("projection des inscriptions : lecture tolérante des événements academic", () => {
  const enrollmentId = newId();
  const studentId = newId();
  it("reconnaît les verbes connus et en déduit le statut", () => {
    expect(isEnrollmentEvent("academic.enrollment.created")).toBe(true);
    expect(isEnrollmentEvent("academic.enrollment.payment_orphan")).toBe(false);
    expect(isEnrollmentEvent("academic.enrollment_course.created")).toBe(false);
    expect(statusForEvent("academic.enrollment.created", undefined)).toBe("PENDING");
    expect(statusForEvent("academic.enrollment.confirmed", undefined)).toBe("ACTIVE");
    expect(statusForEvent("academic.enrollment.withdrawn", undefined)).toBe("WITHDRAWN");
    expect(statusForEvent("academic.enrollment.transferred", undefined)).toBeNull();
    expect(statusForEvent("academic.enrollment.transferred", "ACTIVE")).toBe("ACTIVE");
  });
  it("exige enrollmentId et studentId (UUID) ; ignore les champs mal formés", () => {
    expect(parseEnrollmentPayload(null)).toBeNull();
    expect(parseEnrollmentPayload({ enrollmentId, studentId: "pas-un-uuid" })).toBeNull();
    const facts = parseEnrollmentPayload({ enrollmentId, studentId, classroomId: "x", classroomName: "6e A", enrolledOn: "2025-09-01T00:00:00Z", extra: 1 });
    expect(facts).toEqual({ enrollmentId, studentId, classroomName: "6e A", enrolledOn: "2025-09-01" });
  });
});
