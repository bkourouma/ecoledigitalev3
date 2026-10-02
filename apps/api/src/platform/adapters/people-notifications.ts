/**
 * people + academic + rbac + iam -> notifications : `RecipientDirectory` (destinataires et COORDONNÉES de remise).
 *
 * Identité d'un destinataire : clé de personne `user:<identité IAM>` quand la personne a un compte ACTIF, sinon
 * `person:<fiche>` ; l'autre clé reste en alias (un refus exprimé avant la création du compte continue de valoir). Un tuteur
 * SANS compte est joint par ses coordonnées de fiche ; un compte d'administration sans fiche est joint par l'e-mail du compte
 * (iam). Un accès suspendu ou révoqué (projection IAM de people) n'est pas joignable par l'application.
 *
 * Les coordonnées ne sortent d'ici que pour une remise : `notifications` n'en conserve l'adresse que le temps de l'envoi et ne
 * la journalise jamais en clair. Appels SÉQUENTIELS (une connexion partagée par la transaction du module appelant).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { getClassroom, getRoster } from "../../modules/academic";
import { getMemberEmails } from "../../modules/iam";
import type { RecipientDirectory, Recipient, StudentContacts } from "../../modules/notifications";
import {
  getDisplayNamesOfIdentities,
  getMembershipStatus,
  getStaffByIds,
  listAssignmentsForClassroom,
  listNotificationContactsOfIdentities,
  listNotificationContactsOfStaff,
  listNotificationContactsOfStudents,
  type ContactPoint,
  type GuardianContactPoint,
} from "../../modules/people";
import { listRoleHolders, type MessagingDirectoryInput } from "./people-messaging";
import { emailLocalPart } from "./people-lookups";

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export type NotificationsDirectoryInput = Pick<MessagingDirectoryInput, "people" | "academic" | "lookups" | "tenantDb" | "clock">;

/** Point de contact -> destinataire (clé de personne, alias, coordonnées). */
export function recipientOf(point: ContactPoint, kind: Recipient["kind"], flags?: Recipient["flags"]): Recipient {
  const personKey = `person:${point.personId}`;
  return {
    subjectKey: point.identityId ? `user:${point.identityId}` : personKey,
    aliasKeys: point.identityId ? [personKey] : [],
    userId: point.identityId,
    displayName: point.displayName,
    email: point.email,
    phone: point.phone,
    kind,
    ...(flags ? { flags } : {}),
  };
}

const guardianRecipient = (g: GuardianContactPoint): Recipient => recipientOf(g, "GUARDIAN", { primary: g.isPrimary, financial: g.isFinancial, emergency: g.isEmergency });

export function createNotificationsDirectory(input: NotificationsDirectoryInput): RecipientDirectory {
  const { people, academic, tenantDb, clock } = input;

  async function studentSets(ctx: RequestContext, studentIds: readonly string[]): Promise<StudentContacts[]> {
    const r = await listNotificationContactsOfStudents(people, ctx, studentIds);
    if (!r.ok) throw r.error;
    return r.value.map((s) => ({ studentId: s.studentId, studentName: s.studentName, student: s.student ? recipientOf(s.student, "STUDENT") : null, guardians: s.guardians.map(guardianRecipient) }));
  }

  /** Complète l'e-mail manquant par celui du COMPTE (iam) et écarte un accès suspendu. */
  async function withAccountEmails(ctx: RequestContext, recipients: Recipient[]): Promise<Recipient[]> {
    const missing = recipients.filter((r) => r.userId && !r.email).map((r) => r.userId!);
    const emails = missing.length > 0 ? await getMemberEmails(tenantDb, ctx, missing) : new Map<string, string>();
    return recipients.map((r) => (r.userId && !r.email && emails.get(r.userId) ? { ...r, email: emails.get(r.userId)! } : r));
  }

  async function contactsOfUsers(ctx: RequestContext, userIds: readonly string[]): Promise<Recipient[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    const live: string[] = [];
    for (const id of ids) {
      const status = await getMembershipStatus(people, ctx, id);
      if (status === null || status === "active") live.push(id);
    }
    const persons = await listNotificationContactsOfIdentities(people, ctx, live);
    const byIdentity = new Map((persons.ok ? persons.value : []).filter((p) => p.identityId).map((p) => [p.identityId!, p]));
    const names = await getDisplayNamesOfIdentities(people, ctx, live);
    const emails = await getMemberEmails(tenantDb, ctx, live);
    return live.map((id) => {
      const p = byIdentity.get(id);
      const email = p?.email ?? emails.get(id) ?? null;
      return {
        subjectKey: `user:${id}`,
        aliasKeys: p ? [`person:${p.personId}`] : [],
        userId: id,
        displayName: p?.displayName ?? names.get(id) ?? (email ? emailLocalPart(email) : "Utilisateur"),
        email,
        phone: p?.phone ?? null,
        kind: "USER" as const,
      };
    });
  }

  return {
    studentContacts: (ctx, studentIds) => studentSets(ctx, studentIds),

    async classroomContacts(ctx, classroomId, include) {
      const room = await getClassroom(academic, ctx, classroomId);
      if (!room.ok) return { classroomName: null, recipients: [] };
      const recipients: Recipient[] = [];
      if (include.includes("STUDENTS") || include.includes("GUARDIANS")) {
        const roster = await getRoster(academic, ctx, classroomId, { onDate: isoDay(clock.now()) });
        const ids = roster.ok ? [...new Set(roster.value.items.map((i) => i.studentId))] : [];
        for (const s of ids.length > 0 ? await studentSets(ctx, ids) : []) {
          if (include.includes("STUDENTS") && s.student) recipients.push(s.student);
          if (include.includes("GUARDIANS")) recipients.push(...s.guardians);
        }
      }
      if (include.includes("TEACHERS")) {
        const assignments = await listAssignmentsForClassroom(people, ctx, classroomId, { onDate: isoDay(clock.now()), status: "ACTIVE" });
        const staffIds = assignments.ok ? [...new Set(assignments.value.map((a) => a.staffId))] : [];
        const staff = staffIds.length > 0 ? await listNotificationContactsOfStaff(people, ctx, staffIds) : null;
        for (const s of staff && staff.ok ? staff.value : []) recipients.push(recipientOf(s, "STAFF"));
      }
      return { classroomName: room.value.name, recipients: await withAccountEmails(ctx, recipients) };
    },

    async staffContact(ctx, staffId) {
      const r = await listNotificationContactsOfStaff(people, ctx, [staffId]);
      const s = r.ok ? r.value[0] : undefined;
      if (!s) {
        const known = await getStaffByIds(people, ctx, [staffId]);
        const k = known.ok ? known.value[0] : undefined;
        return k ? { displayName: k.displayName, recipient: null } : null;
      }
      const [recipient] = await withAccountEmails(ctx, [recipientOf(s, "STAFF")]);
      return { displayName: s.displayName, recipient: recipient ?? null };
    },

    async usersWithRoles(ctx, roleKeys) {
      const holders = await listRoleHolders(input, ctx, roleKeys);
      return contactsOfUsers(ctx, [...holders.keys()]);
    },

    contactsOfUsers,
  };
}
