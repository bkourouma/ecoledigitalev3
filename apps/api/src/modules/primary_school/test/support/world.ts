/**
 * Monde de test partagé : établissement du primaire (une année, trois périodes), deux classes, instituteurs, parents, direction, et
 * matrice des permissions par rôle (copie des modèles de rôles attendus du module rbac : `instituteur`, `directeur`, `secretariat`, `parent`).
 * Les gardes HTTP sont SIMULÉES à partir de ces permissions ; le LIEN (classe affectée, tuteur lié) est vérifié par les cas d'usage.
 */
import { createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import { createPrimarySchoolDeps, type PrimarySchoolDeps } from "../../application/deps";
import { RecordingAudit } from "../../application/ports";
import { InMemoryWorld } from "../../infrastructure/in-memory-ports";
import { PRIMARY_PERMISSIONS_LIST } from "./permissions";

export const IDS = {
  admin: "0192f0a4-7b1e-7c3a-8d2e-0000000000a0",
  teacherA: "0192f0a4-7b1e-7c3a-8d2e-0000000000a1",
  teacherB: "0192f0a4-7b1e-7c3a-8d2e-0000000000a2",
  parent1: "0192f0a4-7b1e-7c3a-8d2e-0000000000a3",
  parent2: "0192f0a4-7b1e-7c3a-8d2e-0000000000a4",
  secretary: "0192f0a4-7b1e-7c3a-8d2e-0000000000a5",
  nobody: "0192f0a4-7b1e-7c3a-8d2e-0000000000af",
} as const;

const INSTITUTEUR = [
  "primary.competency.read",
  "primary.competency.record",
  "primary.competency.validate",
  "primary.phrase.read",
  "primary.council.read",
  "primary.council.prepare",
  "primary.framework.read",
  // Lecture des bilans de SA classe (spec §4 : l'instituteur « consulte son bilan de classe ») ; le modèle de rôle est à compléter côté rbac.
  "primary.bilan.read",
];
const PARENT = ["primary.competency.child.read", "primary.bilan.child.read"];
const SECRETARIAT = ["primary.report.read", "primary.class.read_all", "primary.bilan.read", "primary.competency.read"];

/** Direction : tout, y compris les permissions sensibles (la MFA est simulée comme satisfaite). */
const DIRECTEUR = PRIMARY_PERMISSIONS_LIST;

export function permissionsOf(userId: string): ReadonlySet<string> {
  switch (userId) {
    case IDS.admin:
      return new Set(DIRECTEUR);
    case IDS.teacherA:
    case IDS.teacherB:
      return new Set(INSTITUTEUR);
    case IDS.parent1:
    case IDS.parent2:
      return new Set(PARENT);
    case IDS.secretary:
      return new Set(SECRETARIAT);
    default:
      return new Set();
  }
}

export interface World {
  world: InMemoryWorld;
  yearId: string;
  periods: string[];
  classA: string;
  classB: string;
  students: { s1: { enrollmentId: string; studentId: string }; s2: { enrollmentId: string; studentId: string }; s3: { enrollmentId: string; studentId: string }; b1: { enrollmentId: string; studentId: string } };
  staffA: string;
  staffB: string;
}

export function buildWorld(): World {
  const world = new InMemoryWorld();
  const yearId = world.addYear({ periods: 3 });
  const periods = (world.periodsByYear.get(yearId) ?? []).map((p) => p.id);
  const classA = world.addClassroom({ yearId, gradeLevelCode: "CE1", name: "CE1 A" });
  const classB = world.addClassroom({ yearId, gradeLevelCode: "CM2", name: "CM2 A" });
  const s1 = world.addStudent({ classroomId: classA, name: "Awa Koné" });
  const s2 = world.addStudent({ classroomId: classA, name: "Yao Kouadio", isRepeating: true });
  const s3 = world.addStudent({ classroomId: classA, name: "Fanta Traoré" });
  const b1 = world.addStudent({ classroomId: classB, name: "Moussa Diallo" });
  const staffA = world.addTeacher({ userId: IDS.teacherA, classroomId: classA, name: "Mme Bamba" });
  const staffB = world.addTeacher({ userId: IDS.teacherB, classroomId: classB, name: "M. Coulibaly" });
  world.linkGuardian(IDS.parent1, s1.studentId);
  world.linkGuardian(IDS.parent2, s3.studentId);
  return { world, yearId, periods, classA, classB, students: { s1, s2, s3, b1 }, staffA, staffB };
}

export const ctxOf = (tenantId: string, userId: string): RequestContext => createRequestContext({ tenantId, userId });

export function depsOf(db: Parameters<typeof createPrimarySchoolDeps>[0]["db"], world: InMemoryWorld, audit = new RecordingAudit(), clock?: Parameters<typeof createPrimarySchoolDeps>[0]["clock"]): { deps: PrimarySchoolDeps; audit: RecordingAudit } {
  return { deps: createPrimarySchoolDeps({ db, ports: world.ports(), audit, ...(clock ? { clock } : {}) }), audit };
}
