/**
 * Ports indisponibles (échec fermé) et implémentations EN MÉMOIRE pour les tests et le développement isolé.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { portUnavailable } from "../domain/errors";
import type { Recipient } from "../domain/types";
import type {
  AnnouncementFeed,
  GradePair,
  GradeSource,
  NotificationsPorts,
  OverdueInstallment,
  OverdueSource,
  RecipientDirectory,
  StudentContacts,
  TeachingLoad,
  TeachingLoadSource,
} from "../application/ports";

function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === "then") return undefined; // jamais « thenable »
      return () => {
        throw portUnavailable(name);
      };
    },
  });
}

/** Tous les ports en échec fermé : tant que la plateforme n'a pas branché ses adaptateurs, rien ne part. */
export function unavailablePorts(): NotificationsPorts {
  return {
    directory: unavailable<RecipientDirectory>("annuaire des destinataires"),
    overdue: unavailable<OverdueSource>("échéances en retard"),
    grades: unavailable<GradeSource>("résultats"),
    teachingLoad: unavailable<TeachingLoadSource>("charge d'enseignement"),
    announcements: unavailable<AnnouncementFeed>("annonces"),
  };
}

export class InMemoryDirectory implements RecipientDirectory {
  readonly students = new Map<string, StudentContacts>();
  readonly classrooms = new Map<string, { name: string; guardians: Recipient[]; students: Recipient[]; teachers: Recipient[] }>();
  readonly staff = new Map<string, { displayName: string; recipient: Recipient | null }>();
  readonly roles = new Map<string, Recipient[]>();
  readonly users = new Map<string, Recipient>();

  async studentContacts(_ctx: RequestContext, studentIds: readonly string[]): Promise<readonly StudentContacts[]> {
    return studentIds.map((id) => this.students.get(id)).filter((s): s is StudentContacts => s !== undefined);
  }
  async classroomContacts(_ctx: RequestContext, classroomId: string, include: readonly ("GUARDIANS" | "STUDENTS" | "TEACHERS")[]) {
    const room = this.classrooms.get(classroomId);
    if (!room) return { classroomName: null, recipients: [] as Recipient[] };
    return {
      classroomName: room.name,
      recipients: [...(include.includes("GUARDIANS") ? room.guardians : []), ...(include.includes("STUDENTS") ? room.students : []), ...(include.includes("TEACHERS") ? room.teachers : [])],
    };
  }
  async staffContact(_ctx: RequestContext, staffId: string) {
    return this.staff.get(staffId) ?? null;
  }
  async usersWithRoles(_ctx: RequestContext, roleKeys: readonly string[]) {
    const seen = new Map<string, Recipient>();
    for (const key of roleKeys) for (const r of this.roles.get(key) ?? []) seen.set(r.subjectKey, r);
    return [...seen.values()];
  }
  async contactsOfUsers(_ctx: RequestContext, userIds: readonly string[]) {
    return userIds.map((id) => this.users.get(id)).filter((r): r is Recipient => r !== undefined);
  }
}

export class InMemoryOverdue implements OverdueSource {
  items: OverdueInstallment[] = [];
  /** Échéances soldées entre-temps (arrêt dès paiement). */
  readonly settled = new Set<string>();
  async listOverdueInstallments(_ctx: RequestContext, input: { asOf: string; minDaysOverdue: number; limit: number; afterInstallmentId?: string | undefined }) {
    return this.items
      .filter((i) => !this.settled.has(i.installmentId) && i.daysOverdue >= input.minDaysOverdue)
      .sort((a, b) => a.installmentId.localeCompare(b.installmentId))
      .filter((i) => !input.afterInstallmentId || i.installmentId > input.afterInstallmentId)
      .slice(0, input.limit);
  }
  async isInstallmentStillOverdue(_ctx: RequestContext, installmentId: string) {
    return this.items.some((i) => i.installmentId === installmentId) && !this.settled.has(installmentId);
  }
}

export class InMemoryGrades implements GradeSource {
  pairs: GradePair[] = [];
  async listConsecutiveFinals() {
    return this.pairs;
  }
}

export class InMemoryTeachingLoad implements TeachingLoadSource {
  loads: TeachingLoad[] = [];
  async listLoads() {
    return this.loads;
  }
}

export class InMemoryAnnouncements implements AnnouncementFeed {
  readonly items = new Map<string, { title: string; summary: string | null; priority: string; recipientUserIds: string[] }>();
  async read(_ctx: RequestContext, announcementId: string) {
    return this.items.get(announcementId) ?? null;
  }
}

export interface InMemoryWorld {
  directory: InMemoryDirectory;
  overdue: InMemoryOverdue;
  grades: InMemoryGrades;
  teachingLoad: InMemoryTeachingLoad;
  announcements: InMemoryAnnouncements;
  ports: NotificationsPorts;
}

export function inMemoryPorts(): InMemoryWorld {
  const directory = new InMemoryDirectory();
  const overdue = new InMemoryOverdue();
  const grades = new InMemoryGrades();
  const teachingLoad = new InMemoryTeachingLoad();
  const announcements = new InMemoryAnnouncements();
  return { directory, overdue, grades, teachingLoad, announcements, ports: { directory, overdue, grades, teachingLoad, announcements } };
}
