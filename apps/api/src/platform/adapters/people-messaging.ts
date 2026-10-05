/**
 * people + academic + rbac + iam -> messaging : `PeopleDirectory` (profils d'acteurs, personnes joignables d'une classe,
 * recherche par nom, titulaires d'un rôle, tuteurs d'un élève, noms d'affichage).
 *
 * Règles d'identité (échec fermé) : un utilisateur est un identifiant d'identité IAM ; il est ÉLÈVE, TUTEUR ou PERSONNEL
 * seulement par une liaison EXPLICITE `persons.identity_id` (jamais par e-mail). Les classes viennent d'academic :
 * inscriptions ACTIVES (élève, enfants) et affectations d'enseignement EN COURS aujourd'hui (personnel). Un compte inconnu de
 * l'établissement, ou dont l'accès est suspendu, est ABSENT du résultat de `getProfiles`.
 *
 * Appels SÉQUENTIELS (une seule connexion partagée par la transaction du module appelant : jamais `Promise.all`).
 */
import type { Clock, RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { getClassroom, getRoster, listAcademicYears, listEnrollmentsByStudent, type AcademicDeps } from "../../modules/academic";
import { getMemberEmails } from "../../modules/iam";
import type { ActorProfile, ClassroomContacts, DirectoryContact, PeopleDirectory } from "../../modules/messaging";
import {
  getDisplayNamesOfIdentities,
  getMembershipStatus,
  getStaffByIds,
  listAssignmentsForClassroom,
  listAssignmentsForStaff,
  listAudienceOfStudents,
  searchAudienceIdentities,
  type PeopleDeps,
} from "../../modules/people";
import { listAssignmentsUseCase, listRolesUseCase, noopAudit as noopRbacAudit } from "../../modules/rbac";
import { emailLocalPart, type PeopleLookups } from "./people-lookups";

const MAX_PROFILES = 200;
/** Cache court de l'année précédente (une lecture par tenant et par minute, pas une par profil). */
const PREVIOUS_YEAR_TTL_MS = 60_000;
const NAME_CHUNK = 500;

export interface MessagingDirectoryInput {
  readonly people: PeopleDeps;
  readonly academic: AcademicDeps;
  readonly lookups: PeopleLookups;
  readonly tenantDb: TenantDb;
  readonly clock: Clock;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Titulaires (affectations non expirées) des rôles demandés, avec leur nom d'affichage. */
export async function listRoleHolders(input: Pick<MessagingDirectoryInput, "tenantDb" | "clock" | "lookups" | "people">, ctx: RequestContext, roleKeys: readonly string[]): Promise<Map<string, string>> {
  if (roleKeys.length === 0) return new Map();
  const now = input.clock.now();
  const userIds = await input.tenantDb.run(
    ctx,
    async (tx) => {
      const deps = { tx, clock: input.clock, outbox: { append: async () => undefined }, audit: noopRbacAudit, logger: { debug() {}, info() {}, warn() {}, error() {} } } as unknown as Parameters<typeof listRolesUseCase>[0];
      const roles = await listRolesUseCase(deps, ctx);
      if (!roles.ok) return [] as string[];
      const wanted = roles.value.filter((r) => roleKeys.includes(r.key));
      const holders = new Set<string>();
      for (const role of wanted) {
        const assignments = await listAssignmentsUseCase(deps, ctx, { roleId: role.id, limit: 500 });
        if (!assignments.ok) continue;
        for (const a of assignments.value) {
          const started = !a.validFrom || a.validFrom.getTime() <= now.getTime();
          const live = !a.validUntil || a.validUntil.getTime() > now.getTime();
          if (started && live) holders.add(a.userId);
        }
      }
      return [...holders];
    },
    { readOnly: true },
  );
  // Un titulaire sans fiche ni e-mail connu reste un contact (le rôle prouve son existence) : nom générique.
  const names = await namesOf(input, ctx, userIds);
  return new Map(userIds.map((id) => [id, names.get(id) ?? "Administration"] as [string, string]));
}

/** Noms d'affichage en lot : fiche de personne liée, sinon partie locale de l'e-mail du compte (jamais le domaine). */
async function namesOf(input: Pick<MessagingDirectoryInput, "tenantDb" | "people">, ctx: RequestContext, userIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += NAME_CHUNK) {
    const chunk = userIds.slice(i, i + NAME_CHUNK);
    const people = await getDisplayNamesOfIdentities(input.people, ctx, chunk);
    for (const [id, name] of people) out.set(id, name);
    const missing = chunk.filter((id) => !out.has(id));
    if (missing.length > 0) {
      const emails = await getMemberEmails(input.tenantDb, ctx, missing);
      for (const [id, email] of emails) out.set(id, emailLocalPart(email));
    }
  }
  return out;
}

/** Q-05 : l'année PRÉCÉDENTE (dernière année terminée de chaque établissement) et l'ancrage de la fenêtre d'écriture des parents. */
interface PreviousYears {
  readonly yearIds: ReadonlySet<string>;
  readonly anchorOn: string | null;
}
const NO_PREVIOUS_YEAR: PreviousYears = Object.freeze({ yearIds: new Set<string>(), anchorOn: null });

export function createMessagingPeopleDirectory(input: MessagingDirectoryInput): PeopleDirectory {
  const { people, academic, lookups, clock } = input;
  const today = (): string => isoDay(clock.now());
  const previousYearCache = new Map<string, { at: number; value: PreviousYears }>();

  /**
   * Par établissement : l'année précédente = la plus récente année TERMINÉE (fin avant aujourd'hui) ; l'ancrage = début de l'année
   * qui la suit, sinon sa fin (tant que l'année suivante n'est pas créée). Ancrage global = le plus tardif. Échec de lecture : aucune
   * année précédente (fenêtre fermée).
   */
  async function previousYears(ctx: RequestContext): Promise<PreviousYears> {
    const cached = previousYearCache.get(ctx.tenantId);
    const nowMs = clock.now().getTime();
    if (cached && nowMs - cached.at < PREVIOUS_YEAR_TTL_MS) return cached.value;
    const years = await listAcademicYears(academic, ctx, {});
    let value: PreviousYears = NO_PREVIOUS_YEAR;
    if (years.ok) {
      const day = today();
      const byInstitution = new Map<string, typeof years.value>();
      for (const y of years.value) byInstitution.set(y.institutionId, [...(byInstitution.get(y.institutionId) ?? []), y]);
      const ids = new Set<string>();
      let anchor: string | null = null;
      for (const list of byInstitution.values()) {
        const sorted = [...list].sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0));
        const prev = [...sorted].reverse().find((y) => y.endsOn < day);
        if (!prev) continue;
        const next = sorted.find((y) => y.startsOn > prev.startsOn);
        const a = next?.startsOn ?? prev.endsOn;
        ids.add(prev.id);
        if (anchor === null || a > anchor) anchor = a;
      }
      value = ids.size > 0 ? { yearIds: ids, anchorOn: anchor } : NO_PREVIOUS_YEAR;
    }
    previousYearCache.set(ctx.tenantId, { at: nowMs, value });
    return value;
  }

  async function classroomsOfStudents(ctx: RequestContext, studentIds: readonly string[]): Promise<string[]> {
    const rooms = new Set<string>();
    for (const studentId of studentIds) {
      const r = await listEnrollmentsByStudent(academic, ctx, studentId);
      if (r.ok) for (const e of r.value) if (e.status === "ACTIVE") rooms.add(e.classroomId);
    }
    return [...rooms];
  }

  async function profileOf(ctx: RequestContext, userId: string): Promise<ActorProfile | null> {
    // Accès suspendu / révoqué (projection IAM de people) : le compte n'est pas joignable.
    const membership = await getMembershipStatus(people, ctx, userId);
    if (membership !== null && membership !== "active") return null;
    const studentId = await lookups.studentIdForUser(ctx, userId);
    const children = await lookups.childrenOf(ctx, userId);
    const staffId = await lookups.staffIdForUser(ctx, userId);
    // Un compte d'administration peut n'avoir aucune fiche : ses rôles RBAC prouvent qu'il existe dans l'établissement.
    let hasRole = false;
    if (!studentId && children.length === 0 && !staffId) {
      hasRole = await input.tenantDb.run(
        ctx,
        async (tx) => {
          const deps = { tx, clock: input.clock, outbox: { append: async () => undefined }, audit: noopRbacAudit, logger: { debug() {}, info() {}, warn() {}, error() {} } } as unknown as Parameters<typeof listAssignmentsUseCase>[0];
          const r = await listAssignmentsUseCase(deps, ctx, { userId, limit: 1 });
          return r.ok && r.value.length > 0;
        },
        { readOnly: true },
      );
      if (!hasRole) return null;
    }
    const teaching = new Set<string>();
    if (staffId) {
      const a = await listAssignmentsForStaff(people, ctx, staffId, { onDate: today(), status: "ACTIVE" });
      if (a.ok) for (const x of a.value) teaching.add(x.classroomId);
    }
    // Q-05 : classes de l'année précédente (enfants du tuteur, affectations du personnel), pour la fenêtre d'écriture des parents.
    const previous = children.length > 0 || staffId ? await previousYears(ctx) : NO_PREVIOUS_YEAR;
    const childPrevious = new Set<string>();
    for (const childId of previous.yearIds.size > 0 ? children : []) {
      const r = await listEnrollmentsByStudent(academic, ctx, childId);
      if (r.ok) for (const e of r.value) if (previous.yearIds.has(e.academicYearId) && (e.status === "ACTIVE" || e.status === "COMPLETED")) childPrevious.add(e.classroomId);
    }
    const pastTeaching = new Set<string>();
    if (staffId) {
      for (const yearId of previous.yearIds) {
        const a = await listAssignmentsForStaff(people, ctx, staffId, { yearId });
        if (a.ok) for (const x of a.value) if (x.status !== "CANCELLED") pastTeaching.add(x.classroomId);
      }
    }
    return {
      userId,
      displayName: (await lookups.displayNameOfUser(ctx, userId)) ?? null,
      studentId,
      studentClassroomIds: studentId ? await classroomsOfStudents(ctx, [studentId]) : [],
      childStudentIds: children,
      childClassroomIds: await classroomsOfStudents(ctx, children),
      staffId,
      teachingClassroomIds: [...teaching],
      childPreviousYearClassroomIds: [...childPrevious],
      pastTeachingClassroomIds: [...pastTeaching],
      previousYearWindowAnchorOn: previous.anchorOn,
    };
  }

  return {
    async getProfiles(ctx, userIds) {
      const out = new Map<string, ActorProfile>();
      for (const id of [...new Set(userIds)].slice(0, MAX_PROFILES)) {
        const p = await profileOf(ctx, id);
        if (p) out.set(id, p);
      }
      return out;
    },

    async listClassroomContacts(ctx, classroomId, include, options): Promise<ClassroomContacts> {
      const room = await getClassroom(academic, ctx, classroomId);
      if (!room.ok) return { classroom: null, contacts: [] };
      const contacts: DirectoryContact[] = [];
      if (options?.previousYear) {
        // Q-05 : enseignants de la classe d'une année précédente = toutes ses affectations (terminées comprises), jamais les élèves ni les tuteurs.
        const past = await listAssignmentsForClassroom(people, ctx, classroomId, {});
        const staffIds = past.ok ? [...new Set(past.value.filter((a) => a.status !== "CANCELLED").map((a) => a.staffId))] : [];
        const staff = staffIds.length > 0 ? await getStaffByIds(people, ctx, staffIds) : null;
        for (const s of staff && staff.ok ? staff.value : []) {
          if (s.identityId && (s.status === "ACTIVE" || s.status === "ON_LEAVE")) contacts.push({ userId: s.identityId, displayName: s.displayName, kind: "STAFF", classroomId });
        }
        return { classroom: { id: classroomId, name: room.value.name }, contacts };
      }
      const wantsStudents = include.includes("STUDENTS");
      const wantsGuardians = include.includes("GUARDIANS");
      if (wantsStudents || wantsGuardians) {
        const roster = await getRoster(academic, ctx, classroomId, { onDate: today() });
        const studentIds = roster.ok ? [...new Set(roster.value.items.map((i) => i.studentId))] : [];
        const audience = studentIds.length > 0 ? await listAudienceOfStudents(people, ctx, studentIds) : null;
        for (const s of audience && audience.ok ? audience.value : []) {
          if (wantsStudents && s.student) contacts.push({ userId: s.student.identityId, displayName: s.student.displayName, kind: "STUDENT", studentId: s.studentId, studentName: s.studentName, classroomId });
          if (wantsGuardians) for (const g of s.guardians) contacts.push({ userId: g.identityId, displayName: g.displayName, kind: "GUARDIAN", studentId: s.studentId, studentName: s.studentName, classroomId });
        }
      }
      if (include.includes("TEACHERS")) {
        const assignments = await listAssignmentsForClassroom(people, ctx, classroomId, { onDate: today(), status: "ACTIVE" });
        const staffIds = assignments.ok ? [...new Set(assignments.value.map((a) => a.staffId))] : [];
        const staff = staffIds.length > 0 ? await getStaffByIds(people, ctx, staffIds) : null;
        for (const s of staff && staff.ok ? staff.value : []) {
          if (s.identityId && (s.status === "ACTIVE" || s.status === "ON_LEAVE")) contacts.push({ userId: s.identityId, displayName: s.displayName, kind: "STAFF", classroomId });
        }
      }
      return { classroom: { id: classroomId, name: room.value.name }, contacts };
    },

    async searchUsers(ctx, query, limit) {
      const r = await searchAudienceIdentities(people, ctx, query, limit);
      if (!r.ok) return [];
      return r.value.map((m) => ({ userId: m.identityId, displayName: m.displayName, kind: m.kinds.includes("STAFF") ? ("STAFF" as const) : m.kinds.includes("GUARDIAN") ? ("GUARDIAN" as const) : ("STUDENT" as const) }));
    },

    async listUsersWithRoles(ctx, roleKeys) {
      const holders = await listRoleHolders(input, ctx, roleKeys);
      return [...holders].map(([userId, displayName]) => ({ userId, displayName, kind: "STAFF" as const }));
    },

    async getGuardianContactsOfStudent(ctx, studentId) {
      const r = await listAudienceOfStudents(people, ctx, [studentId]);
      const s = r.ok ? r.value[0] : undefined;
      if (!s) return null;
      return { studentName: s.studentName, contacts: s.guardians.map((g) => ({ userId: g.identityId, displayName: g.displayName, kind: "GUARDIAN" as const, studentId: s.studentId, studentName: s.studentName })) };
    },

    async getDisplayNames(ctx, userIds) {
      return namesOf(input, ctx, [...new Set(userIds)]);
    },

    async getClassroomNames(ctx, classroomIds) {
      const out = new Map<string, string>();
      for (const id of new Set(classroomIds)) {
        const r = await getClassroom(academic, ctx, id);
        if (r.ok) out.set(id, r.value.name);
      }
      return out;
    },
  };
}
