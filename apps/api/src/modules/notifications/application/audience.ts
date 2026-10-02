/**
 * Résolution des destinataires d'une règle : traduit une audience (`STUDENT_GUARDIANS`, `ROLES`, `CLASSROOM`…) en liste de
 * personnes joignables, par les ports d'annuaire. Les appels sont SÉQUENTIELS (connexion partagée) et mis en cache le temps
 * d'un traitement (un événement qui déclenche plusieurs règles ne relit pas deux fois les tuteurs).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { NotifAudience } from "@ecoledigitale/contracts/src/v2/notifications";
import type { Recipient } from "../domain/types";
import type { NotificationsDeps } from "./deps";
import type { StudentContacts } from "./ports";

export interface EntityRefs {
  readonly studentId?: string | undefined;
  readonly staffId?: string | undefined;
  readonly classroomId?: string | undefined;
  readonly announcementId?: string | undefined;
  readonly userId?: string | undefined;
  readonly applicationId?: string | undefined;
}

export class AudienceResolver {
  private readonly students = new Map<string, StudentContacts | null>();
  private readonly rooms = new Map<string, { classroomName: string | null; recipients: readonly Recipient[] }>();
  private readonly roles = new Map<string, readonly Recipient[]>();
  private readonly announcements = new Map<string, Awaited<ReturnType<NotificationsDeps["ports"]["announcements"]["read"]>>>();

  constructor(
    readonly deps: NotificationsDeps,
    readonly ctx: RequestContext,
  ) {}

  async student(studentId: string): Promise<StudentContacts | null> {
    if (!this.students.has(studentId)) {
      const found = await this.deps.ports.directory.studentContacts(this.ctx, [studentId]);
      this.students.set(studentId, found.find((s) => s.studentId === studentId) ?? null);
    }
    return this.students.get(studentId) ?? null;
  }

  /** Préchargement par lot (envoi manuel à plusieurs élèves). */
  async preloadStudents(studentIds: readonly string[]): Promise<void> {
    const missing = [...new Set(studentIds)].filter((id) => !this.students.has(id));
    for (let i = 0; i < missing.length; i += 200) {
      const chunk = missing.slice(i, i + 200);
      const found = await this.deps.ports.directory.studentContacts(this.ctx, chunk);
      for (const id of chunk) this.students.set(id, found.find((s) => s.studentId === id) ?? null);
    }
  }

  async classroom(classroomId: string, include: readonly ("GUARDIANS" | "STUDENTS" | "TEACHERS")[]): Promise<{ classroomName: string | null; recipients: readonly Recipient[] }> {
    const key = `${classroomId}|${[...include].sort().join(",")}`;
    if (!this.rooms.has(key)) this.rooms.set(key, await this.deps.ports.directory.classroomContacts(this.ctx, classroomId, include));
    return this.rooms.get(key)!;
  }

  async rolesHolders(roleKeys: readonly string[]): Promise<readonly Recipient[]> {
    const key = [...roleKeys].sort().join(",");
    if (!this.roles.has(key)) this.roles.set(key, await this.deps.ports.directory.usersWithRoles(this.ctx, roleKeys));
    return this.roles.get(key)!;
  }

  async announcement(announcementId: string) {
    if (!this.announcements.has(announcementId)) this.announcements.set(announcementId, await this.deps.ports.announcements.read(this.ctx, announcementId));
    return this.announcements.get(announcementId) ?? null;
  }

  /** Destinataires d'une audience pour les entités visées ; liste vide si l'audience ne s'applique pas à ces entités. */
  async resolve(audience: NotifAudience, refs: EntityRefs): Promise<readonly Recipient[]> {
    switch (audience.kind) {
      case "STUDENT_GUARDIANS": {
        if (!refs.studentId) return [];
        const s = await this.student(refs.studentId);
        if (!s) return [];
        let guardians = s.guardians;
        if (audience.financialFirst) {
          const financial = guardians.filter((g) => g.flags?.financial);
          if (financial.length > 0) guardians = financial;
        }
        if (guardians.length === 0 && audience.fallbackToStudent && s.student) return [s.student];
        return guardians;
      }
      case "STUDENT": {
        if (!refs.studentId) return [];
        const s = await this.student(refs.studentId);
        return s?.student ? [s.student] : [];
      }
      case "STAFF_SUBJECT": {
        if (!refs.staffId) return [];
        const s = await this.deps.ports.directory.staffContact(this.ctx, refs.staffId);
        return s?.recipient ? [s.recipient] : [];
      }
      case "ROLES":
        return this.rolesHolders(audience.roleKeys);
      case "CLASSROOM": {
        if (!refs.classroomId) return [];
        return (await this.classroom(refs.classroomId, audience.include)).recipients;
      }
      case "ANNOUNCEMENT_RECIPIENTS": {
        if (!refs.announcementId) return [];
        const a = await this.announcement(refs.announcementId);
        if (!a || a.recipientUserIds.length === 0) return [];
        const out: Recipient[] = [];
        for (let i = 0; i < a.recipientUserIds.length; i += 500) out.push(...(await this.deps.ports.directory.contactsOfUsers(this.ctx, a.recipientUserIds.slice(i, i + 500))));
        return out;
      }
      case "PAYSLIP_HOLDER": {
        if (!refs.userId) return [];
        return this.deps.ports.directory.contactsOfUsers(this.ctx, [refs.userId]);
      }
      case "APPLICANT_GUARDIANS": {
        if (!refs.applicationId) return [];
        return this.deps.ports.applicants.applicantContacts(this.ctx, refs.applicationId);
      }
    }
  }
}
