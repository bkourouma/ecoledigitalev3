/**
 * Fabriques de scénarios pour les tests d'intégration : élèves, tuteurs, personnel, affectations. Les noms sont aléatoires
 * (8 lettres) et les dates de naissance variées pour ne JAMAIS déclencher la détection de doublons par accident.
 */
import { randomBytes } from "node:crypto";
import { newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createGuardian, linkGuardian } from "../../application/guardians";
import { createStaff } from "../../application/staff";
import { createStudent } from "../../application/students";
import type { PeopleDeps } from "../../application/deps";
import type { PeopleCreateStaffBody, PeopleCreateStudentBody, PeoplePersonInput } from "@ecoledigitale/contracts/src/v2/people";
import { adminRows, type PeopleTestDb } from "./db";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export function word(len = 8): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i += 1) out += LETTERS[(bytes[i] as number) % 26];
  return out.charAt(0).toUpperCase() + out.slice(1);
}

let birthSeq = 0;
export function uniqueBirthDate(): string {
  birthSeq += 1;
  const d = new Date(Date.UTC(2005, 0, 1) + birthSeq * 86_400_000 * 3);
  return d.toISOString().slice(0, 10);
}

export function person(over: Partial<PeoplePersonInput> = {}): PeoplePersonInput {
  return { lastName: word(), firstName: word(6), sex: "F", birthDate: uniqueBirthDate(), ...over };
}

export async function mkStudent(deps: PeopleDeps, ctx: RequestContext, over: Partial<PeopleCreateStudentBody> = {}, personOver: Partial<PeoplePersonInput> = {}) {
  const out = unwrap(await createStudent(deps, ctx, { person: person(personOver), ...over } as PeopleCreateStudentBody));
  if (out.kind !== "created") throw new Error("création attendue");
  return out.student;
}

export async function mkGuardian(deps: PeopleDeps, ctx: RequestContext, personOver: Partial<PeoplePersonInput> = {}) {
  return unwrap(await createGuardian(deps, ctx, { person: person({ sex: "M", birthDate: "1980-05-05", email: `${word()}@example.test`, ...personOver }) })).guardian;
}

export async function mkStaff(deps: PeopleDeps, ctx: RequestContext, over: Partial<PeopleCreateStaffBody> = {}, personOver: Partial<PeoplePersonInput> = {}) {
  const out = unwrap(await createStaff(deps, ctx, { person: person({ email: `${word()}@example.test`, ...personOver }), categoryCode: "TEACHER", ...over } as PeopleCreateStaffBody));
  if (out.kind !== "created") throw new Error("création attendue");
  return out.staff;
}

export async function link(deps: PeopleDeps, ctx: RequestContext, studentId: string, guardianId: string, over: Record<string, unknown> = {}) {
  return unwrap(await linkGuardian(deps, ctx, studentId, { guardianId, relationshipCode: "FATHER", ...over }));
}

/** Donne une identité (UUID) à une personne en contournant l'invitation (le test d'iam n'est pas l'objet ici). */
export async function giveIdentity(db: PeopleTestDb, personId: string, identityId: string = newId()): Promise<string> {
  await db.admin.query("UPDATE people.persons SET identity_id = $2 WHERE id = $1", [personId, identityId]);
  return identityId;
}

/** Insère directement une inscription dans la projection (ce que ferait l'abonné `academic.enrollment.*`). */
export async function giveEnrollment(
  db: PeopleTestDb,
  tenantId: string,
  studentId: string,
  o: { classroomId: string; institutionId?: string; yearId?: string; status?: string; classroomName?: string },
): Promise<string> {
  const id = newId();
  await db.admin.query(
    `INSERT INTO people.student_enrollment_summaries
       (tenant_id, enrollment_id, student_id, academic_year_id, institution_id, classroom_id, classroom_name, status, enrolled_on, source_event_id, source_occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2025-09-01',$9, now())`,
    [tenantId, id, studentId, o.yearId ?? newId(), o.institutionId ?? newId(), o.classroomId, o.classroomName ?? "6e A", o.status ?? "ACTIVE", newId()],
  );
  return id;
}

export const count = async (db: PeopleTestDb, sql: string, params: unknown[] = []): Promise<number> => Number((await adminRows<{ n: string }>(db, sql, params))[0]?.n ?? 0);
