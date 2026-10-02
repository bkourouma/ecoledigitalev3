/**
 * Coordonnées de remise pour les NOTIFICATIONS (spec v2/016, canaux externes) — extension ADDITIVE du module, lectures
 * seules, jamais exposées par une route : l'adaptateur de plateforme `people-notifications` les consomme, le module
 * `notifications` n'en conserve l'adresse que le temps d'une remise et ne la journalise jamais en clair.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { displayName } from "../domain/normalize";
import { listContactsOfIdentities, listGuardianContacts, listStaffContacts, listStudentContacts, type PersonContactRow } from "../infrastructure/contacts-repo";
import type { PeopleDeps } from "./deps";

export const CONTACTS_MAX_STUDENTS = 2000;

export interface ContactPoint {
  readonly personId: string;
  /** Compte (identité IAM) actif de la personne, `null` s'il n'en a pas ou s'il est suspendu. */
  readonly identityId: string | null;
  readonly displayName: string;
  readonly email: string | null;
  /** Téléphone principal, sinon téléphone secondaire. */
  readonly phone: string | null;
}

export interface GuardianContactPoint extends ContactPoint {
  readonly guardianId: string;
  readonly isPrimary: boolean;
  readonly isFinancial: boolean;
  readonly isEmergency: boolean;
}

export interface StudentContactSet {
  readonly studentId: string;
  readonly studentName: string;
  readonly student: ContactPoint | null;
  readonly guardians: readonly GuardianContactPoint[];
}

const point = (r: PersonContactRow): ContactPoint => ({ personId: r.personId, identityId: r.identityId, displayName: displayName(r.lastName, r.firstName), email: r.email, phone: r.phone ?? r.phoneAlt });

/** Élèves (nom, coordonnées) et leurs tuteurs vivants, avec ou sans compte. Un élève inconnu est absent du résultat. */
export async function listNotificationContactsOfStudents(deps: Pick<PeopleDeps, "db">, ctx: RequestContext, studentIds: readonly string[]): Promise<Result<StudentContactSet[], AppError>> {
  const ids = [...new Set(studentIds)].slice(0, CONTACTS_MAX_STUDENTS);
  const { students, guardians } = await deps.db.run(
    ctx,
    async (tx) => ({ students: await listStudentContacts(tx, ctx.tenantId, ids), guardians: await listGuardianContacts(tx, ctx.tenantId, ids) }),
    { readOnly: true },
  );
  const byStudent = new Map<string, GuardianContactPoint[]>();
  for (const g of guardians) {
    const list = byStudent.get(g.studentId) ?? [];
    list.push({ ...point(g), guardianId: g.guardianId, isPrimary: g.isPrimary, isFinancial: g.isFinancial, isEmergency: g.isEmergency });
    byStudent.set(g.studentId, list);
  }
  return ok(students.map((s) => ({ studentId: s.studentId, studentName: displayName(s.lastName, s.firstName), student: point(s), guardians: byStudent.get(s.studentId) ?? [] })));
}

/** Membres du personnel actifs (ou en congé) : coordonnées de leur fiche. */
export async function listNotificationContactsOfStaff(deps: Pick<PeopleDeps, "db">, ctx: RequestContext, staffIds: readonly string[]): Promise<Result<Array<ContactPoint & { staffId: string }>, AppError>> {
  const rows = await deps.db.run(ctx, (tx) => listStaffContacts(tx, ctx.tenantId, [...new Set(staffIds)].slice(0, 500)), { readOnly: true });
  return ok(rows.map((r) => ({ ...point(r), staffId: r.staffId })));
}

/** Coordonnées de la fiche liée à chaque compte demandé (un compte sans fiche est absent : administrateur sans dossier). */
export async function listNotificationContactsOfIdentities(deps: Pick<PeopleDeps, "db">, ctx: RequestContext, identityIds: readonly string[]): Promise<Result<ContactPoint[], AppError>> {
  const rows = await deps.db.run(ctx, (tx) => listContactsOfIdentities(tx, ctx.tenantId, [...new Set(identityIds)].slice(0, 1000)), { readOnly: true });
  return ok(rows.map(point));
}
