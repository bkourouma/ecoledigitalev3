/**
 * Monde de test : deps du module avec ports EN MÉMOIRE, horloge figée, audit enregistré, et une « école » prête à l'emploi
 * (cycle Licence, programme, UE avec crédits, étudiants inscrits, signataires).
 *
 * Les règles sont SCÉNARISÉES : `scriptRules` branche, dans le TEST, la sémantique de la règle `diplome_eligible` pour les
 * scénarios unitaires ; la règle réelle (RuleSet du module rules) est exercée par `rules.integration.test.ts`.
 */
import { ManualClock, createRequestContext, newId, type RequestContext } from "@ecoledigitale/kernel";
import { createHigherDeps, type CallerCaps, type HigherDeps } from "../../application/deps";
import { RecordingAudit, type UeResultLine } from "../../application/ports";
import { inMemoryPorts, type InMemoryWorld } from "../../infrastructure/in-memory-ports";
import type { HigherTestDb } from "./db";

export interface TestWorld {
  readonly deps: HigherDeps;
  readonly clock: ManualClock;
  readonly audit: RecordingAudit;
  readonly ports: InMemoryWorld;
}

/** Compteur global : le code de vérification est unique pour toute la base (vérification publique). */
let verificationSeq = 0;

export function makeWorld(db: HigherTestDb, startsAt = "2026-10-01T12:00:00.000Z"): TestWorld {
  const clock = new ManualClock(startsAt);
  const audit = new RecordingAudit();
  const ports = inMemoryPorts();
  const deps = createHigherDeps({
    db: db.tenantDb,
    clock,
    audit,
    ports,
    // Code de vérification déterministe, unique.
    newVerificationCode: () => `VERIFCODE${String(++verificationSeq).padStart(10, "0")}`,
  });
  return { deps, clock, audit, ports };
}

/** Sémantique de test de `diplome_eligible` : obligatoires validées ET Σ uv des exigences validées >= uv_requises. */
export function scriptRules(world: TestWorld, mention: (average: string | null) => string = (a) => (a === null ? "PENDING" : "GOOD")): void {
  world.ports.rules.onEligibility = ({ exigences, uvRequises }) => {
    const mandatoryOk = exigences.filter((e) => e.obligatoire).every((e) => e.valide);
    const uv = exigences.filter((e) => e.valide).reduce((s, e) => s + Math.round(e.uv * 100), 0) / 100;
    return mandatoryOk && uv >= uvRequises;
  };
  world.ports.rules.onCycle = ({ semestres }) => {
    const rated = semestres.filter((s) => s.moyenne !== null);
    const total = rated.reduce((s, x) => s + x.credits, 0);
    const average = total === 0 ? null : (rated.reduce((s, x) => s + Number(x.moyenne) * x.credits, 0) / total).toFixed(3);
    return { average, mentionCode: mention(average) };
  };
}

export interface TestUe {
  readonly nodeId: string;
  readonly code: string;
  readonly label: string;
  readonly credits: number;
}

export interface TestStudent {
  readonly studentId: string;
  readonly enrollmentId: string;
  readonly userId: string;
  readonly fullName: string;
}

export interface School {
  readonly tenantId: string;
  readonly institutionId: string;
  readonly yearId: string;
  readonly classroomId: string;
  readonly cycleNodeId: string;
  readonly programNodeId: string;
  readonly periodId: string;
  readonly period2Id: string;
  readonly ues: TestUe[];
  readonly students: TestStudent[];
  readonly admin: { userId: string; ctx: RequestContext };
  readonly guardian: { userId: string; ctx: RequestContext; studentId: string };
  readonly pupil: { userId: string; ctx: RequestContext; studentId: string };
  readonly signatories: { left: string; right: string; attestation: string; authenticity: string };
}

export const CAPS = {
  admin: { forceAward: true, manage: true } as CallerCaps,
  none: {} as CallerCaps,
};

export async function seedSchool(
  db: HigherTestDb,
  world: TestWorld,
  options: { students?: number; ues?: ReadonlyArray<{ code: string; credits: number }> } = {},
): Promise<School> {
  const tenantId = await db.createTenant();
  const institutionId = newId();
  const yearId = newId();
  const classroomId = newId();
  const cycleNodeId = newId();
  const programNodeId = newId();
  const periodId = newId();
  const period2Id = newId();
  const { curriculum, enrollments, students: studentDir, signatories, actors, institution } = world.ports;

  curriculum.addCycle(cycleNodeId, "LIC-GL", "Licence Génie logiciel");
  curriculum.addProgram(programNodeId, "GL", "Génie logiciel");
  const ues: TestUe[] = [];
  for (const u of options.ues ?? [{ code: "UE101", credits: 6 }, { code: "UE102", credits: 6 }, { code: "UE103", credits: 6 }]) {
    const nodeId = newId();
    const ue: TestUe = { nodeId, code: u.code, label: `Unité ${u.code}`, credits: u.credits };
    ues.push(ue);
    curriculum.addUe({ nodeId, code: ue.code, label: ue.label, credits: ue.credits, programNodeId }, cycleNodeId);
  }

  const students: TestStudent[] = [];
  for (let i = 1; i <= (options.students ?? 3); i += 1) {
    const s: TestStudent = { studentId: newId(), enrollmentId: newId(), userId: newId(), fullName: `Étudiant ${String(i).padStart(2, "0")}` };
    students.push(s);
    studentDir.add({ studentId: s.studentId, fullName: s.fullName, matricule: `MAT-${String(i).padStart(4, "0")}`, birthDate: "2003-04-12", birthPlace: "Abidjan" }, s.userId);
    for (const nodeId of [cycleNodeId, programNodeId]) {
      enrollments.setLastEnrollment(s.studentId, nodeId, { enrollmentId: s.enrollmentId, academicYearId: yearId, academicYearLabel: "2026-2027" });
    }
    enrollments.addCycleEnrollment(cycleNodeId, { enrollmentId: s.enrollmentId, studentId: s.studentId, classroomId, academicYearId: yearId }, "2026-2027");
    enrollments.addCycleEnrollment(programNodeId, { enrollmentId: s.enrollmentId, studentId: s.studentId, classroomId, academicYearId: yearId }, "2026-2027");
  }

  const adminUserId = newId();
  const adminCtx = createRequestContext({ tenantId, userId: adminUserId, roles: ["directeur"], mfa: true });
  actors.set(adminUserId, "Directrice des études");
  const guardianUser = newId();
  const first = students[0];
  if (first) studentDir.addGuardian(guardianUser, first.studentId);
  const sig = { left: newId(), right: newId(), attestation: newId(), authenticity: newId() };
  const names: Array<[string, string, string]> = [
    [sig.left, "Signataire Gauche", "Le Directeur général"],
    [sig.right, "Signataire Droite", "Le Directeur des études"],
    [sig.attestation, "Signataire Attestation", "Le Responsable de la scolarité"],
    [sig.authenticity, "Signataire Authenticité", "Le Secrétaire général"],
  ];
  for (const [id, name, fn] of names) signatories.add({ signatoryId: id, fullName: name, title: "Pr", function: fn, active: true });
  institution.set({ name: "Établissement de test", shortName: "EDT", address: "Abidjan", country: "CI" });

  return {
    tenantId, institutionId, yearId, classroomId, cycleNodeId, programNodeId, periodId, period2Id, ues, students,
    admin: { userId: adminUserId, ctx: adminCtx },
    guardian: { userId: guardianUser, ctx: createRequestContext({ tenantId, userId: guardianUser, roles: ["parent"] }), studentId: first?.studentId ?? newId() },
    pupil: { userId: first?.userId ?? newId(), ctx: createRequestContext({ tenantId, userId: first?.userId ?? newId(), roles: ["eleve"] }), studentId: first?.studentId ?? newId() },
    signatories: sig,
  };
}

/** Ligne FINAL d'UE d'un résultat publié. */
export function ueLine(school: School, student: TestStudent, ue: TestUe, over: Partial<UeResultLine> = {}): UeResultLine {
  return {
    studentId: student.studentId,
    enrollmentId: student.enrollmentId,
    ueNodeId: ue.nodeId,
    academicYearId: school.yearId,
    academicPeriodId: school.periodId,
    credits: ue.credits,
    averageExact: "12.5",
    validated: true,
    ueState: "VALIDATED",
    sessionObtained: 1,
    via: "DIRECT",
    overrideId: null,
    compensatedEcueCount: 0,
    sourceResultId: newId(),
    resultsVersion: 1,
    ...over,
  };
}

/** Affecte les quatre emplacements de signature (valables depuis `from`). */
export async function assignAllSlots(world: TestWorld, school: School, from = "2026-01-01"): Promise<void> {
  const { assignSlot } = await import("../../application/documents");
  const pairs: Array<["DIPLOMA_LEFT" | "DIPLOMA_RIGHT" | "ATTESTATION_SUCCESS" | "AUTHENTICITY", string]> = [
    ["DIPLOMA_LEFT", school.signatories.left],
    ["DIPLOMA_RIGHT", school.signatories.right],
    ["ATTESTATION_SUCCESS", school.signatories.attestation],
    ["AUTHENTICITY", school.signatories.authenticity],
  ];
  for (const [slotKey, signatoryId] of pairs) {
    const r = await assignSlot(world.deps, school.admin.ctx, { slotKey, signatoryId, validFrom: from });
    if (!r.ok) throw r.error;
  }
}
