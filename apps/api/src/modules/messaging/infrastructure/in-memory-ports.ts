/**
 * Implémentations des ports : « indisponible » (échec fermé, défaut) et « en mémoire » (tests, modules consommateurs).
 * L'annuaire en mémoire applique des règles proches des adaptateurs réels : il sert de MONDE minimal aux tests unitaires.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { portUnavailable } from "../domain/errors";
import type { ActorProfile, DirectoryContact, MessagingAudience, MessagingClassInclude, MessagingTarget, Uuid } from "../domain/types";
import type { AudienceDirectory, AudienceResolution, ClassroomContacts, MessagingPorts, PeopleDirectory, StoragePort } from "../application/ports";

export function unavailablePorts(): MessagingPorts {
  const fail = (port: string) => async (): Promise<never> => {
    throw portUnavailable(port);
  };
  return {
    directory: {
      getProfiles: fail("annuaire des personnes"),
      listClassroomContacts: fail("annuaire des personnes"),
      searchUsers: fail("annuaire des personnes"),
      listUsersWithRoles: fail("annuaire des personnes"),
      getGuardianContactsOfStudent: fail("annuaire des personnes"),
      getDisplayNames: fail("annuaire des personnes"),
      getClassroomNames: fail("annuaire des personnes"),
    },
    audience: { firstUnknownTarget: fail("annuaire des audiences"), resolveAudience: fail("annuaire des audiences") },
    storage: { put: fail("stockage d'objets"), delete: fail("stockage d'objets"), signedUrl: fail("stockage d'objets") },
  };
}

// ---------------------------------------------------------------------------
// Monde en mémoire
// ---------------------------------------------------------------------------

export interface WorldUser {
  readonly userId: Uuid;
  readonly displayName: string;
  readonly studentId?: Uuid;
  readonly studentClassroomIds?: readonly Uuid[];
  readonly childStudentIds?: readonly Uuid[];
  readonly staffId?: Uuid;
  readonly teachingClassroomIds?: readonly Uuid[];
  readonly roles?: readonly string[];
  readonly active?: boolean;
}

export class InMemoryDirectory implements PeopleDirectory, AudienceDirectory {
  readonly users = new Map<Uuid, WorldUser>();
  readonly classrooms = new Map<Uuid, { name: string; levelId?: string; campusId?: string; institutionId?: string }>();
  /** studentId -> classes de l'élève (inscriptions actives). */
  readonly studentClasses = new Map<Uuid, Uuid[]>();
  /** studentId -> nom d'affichage de l'élève. */
  readonly studentNames = new Map<Uuid, string>();

  addUser(u: WorldUser): this {
    this.users.set(u.userId, u);
    return this;
  }

  private classroomsOfStudent(studentId: Uuid): Uuid[] {
    return this.studentClasses.get(studentId) ?? [];
  }

  private profile(u: WorldUser): ActorProfile {
    const children = u.childStudentIds ?? [];
    return {
      userId: u.userId,
      displayName: u.displayName,
      studentId: u.studentId ?? null,
      studentClassroomIds: u.studentClassroomIds ?? (u.studentId ? this.classroomsOfStudent(u.studentId) : []),
      childStudentIds: children,
      childClassroomIds: [...new Set(children.flatMap((c) => this.classroomsOfStudent(c)))],
      staffId: u.staffId ?? null,
      teachingClassroomIds: u.teachingClassroomIds ?? [],
    };
  }

  async getProfiles(_ctx: RequestContext, userIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, ActorProfile>> {
    const out = new Map<Uuid, ActorProfile>();
    for (const id of userIds) {
      const u = this.users.get(id);
      if (u && u.active !== false) out.set(id, this.profile(u));
    }
    return out;
  }

  async listClassroomContacts(_ctx: RequestContext, classroomId: Uuid, include: readonly MessagingClassInclude[]): Promise<ClassroomContacts> {
    const room = this.classrooms.get(classroomId);
    if (!room) return { classroom: null, contacts: [] };
    const contacts: DirectoryContact[] = [];
    for (const u of this.users.values()) {
      if (u.active === false) continue;
      if (include.includes("STUDENTS") && u.studentId && this.classroomsOfStudent(u.studentId).includes(classroomId)) {
        contacts.push({ userId: u.userId, displayName: u.displayName, kind: "STUDENT", studentId: u.studentId, studentName: u.displayName, classroomId });
      }
      if (include.includes("GUARDIANS")) {
        for (const child of u.childStudentIds ?? []) {
          if (this.classroomsOfStudent(child).includes(classroomId)) {
            contacts.push({ userId: u.userId, displayName: u.displayName, kind: "GUARDIAN", studentId: child, studentName: this.studentNames.get(child) ?? null, classroomId });
          }
        }
      }
      if (include.includes("TEACHERS") && u.staffId && (u.teachingClassroomIds ?? []).includes(classroomId)) {
        contacts.push({ userId: u.userId, displayName: u.displayName, kind: "STAFF", classroomId });
      }
    }
    return { classroom: { id: classroomId, name: room.name }, contacts };
  }

  async searchUsers(_ctx: RequestContext, query: string, limit: number): Promise<readonly DirectoryContact[]> {
    const q = query.toLowerCase();
    return [...this.users.values()]
      .filter((u) => u.active !== false && u.displayName.toLowerCase().includes(q))
      .slice(0, limit)
      .map((u) => ({ userId: u.userId, displayName: u.displayName, kind: u.staffId ? ("STAFF" as const) : u.studentId ? ("STUDENT" as const) : ("GUARDIAN" as const) }));
  }

  async listUsersWithRoles(_ctx: RequestContext, roleKeys: readonly string[]): Promise<readonly DirectoryContact[]> {
    return [...this.users.values()]
      .filter((u) => u.active !== false && (u.roles ?? []).some((r) => roleKeys.includes(r)))
      .map((u) => ({ userId: u.userId, displayName: u.displayName, kind: "STAFF" as const }));
  }

  async getGuardianContactsOfStudent(_ctx: RequestContext, studentId: Uuid): Promise<{ studentName: string; contacts: readonly DirectoryContact[] } | null> {
    const studentName = this.studentNames.get(studentId);
    if (!studentName) return null;
    const contacts = [...this.users.values()]
      .filter((u) => u.active !== false && (u.childStudentIds ?? []).includes(studentId))
      .map((u) => ({ userId: u.userId, displayName: u.displayName, kind: "GUARDIAN" as const, studentId, studentName }));
    return { studentName, contacts };
  }

  async getDisplayNames(_ctx: RequestContext, userIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>> {
    return new Map(userIds.flatMap((id) => (this.users.has(id) ? [[id, this.users.get(id)!.displayName] as [string, string]] : [])));
  }

  async getClassroomNames(_ctx: RequestContext, classroomIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>> {
    return new Map(classroomIds.flatMap((id) => (this.classrooms.has(id) ? [[id, this.classrooms.get(id)!.name] as [string, string]] : [])));
  }

  // --- AudienceDirectory -------------------------------------------------

  async firstUnknownTarget(_ctx: RequestContext, targets: readonly MessagingTarget[]): Promise<MessagingTarget | null> {
    for (const t of targets) {
      if (t.kind === "CLASSROOM" && !this.classrooms.has(t.ref ?? "")) return t;
    }
    return null;
  }

  async resolveAudience(_ctx: RequestContext, input: { targets: readonly MessagingTarget[]; audiences: readonly MessagingAudience[]; limit: number }): Promise<AudienceResolution> {
    const ids = new Set<Uuid>();
    const wants = (a: MessagingAudience) => input.audiences.includes(a);
    for (const t of input.targets) {
      for (const u of this.users.values()) {
        if (u.active === false) continue;
        if (t.kind === "ROLE") {
          if ((u.roles ?? []).includes(t.ref ?? "")) ids.add(u.userId);
          continue;
        }
        const roomIds = t.kind === "CLASSROOM" ? [t.ref ?? ""] : t.kind === "TENANT" ? [...this.classrooms.keys()] : [...this.classrooms.entries()].filter(([, c]) => (t.kind === "LEVEL" ? c.levelId : t.kind === "CAMPUS" ? c.campusId : c.institutionId) === t.ref).map(([id]) => id);
        if (wants("STUDENTS") && u.studentId && this.classroomsOfStudent(u.studentId).some((r) => roomIds.includes(r))) ids.add(u.userId);
        if (wants("GUARDIANS") && (u.childStudentIds ?? []).some((c) => this.classroomsOfStudent(c).some((r) => roomIds.includes(r)))) ids.add(u.userId);
        if (wants("STAFF") && u.staffId && (t.kind === "TENANT" || (u.teachingClassroomIds ?? []).some((r) => roomIds.includes(r)))) ids.add(u.userId);
      }
    }
    const all = [...ids].sort();
    return { userIds: all.slice(0, input.limit), truncated: all.length > input.limit };
  }
}

export class InMemoryStorage implements StoragePort {
  readonly objects = new Map<string, { data: Uint8Array; contentType: string }>();
  async put(key: string, data: Uint8Array, options: { contentType: string }): Promise<void> {
    this.objects.set(key, { data, contentType: options.contentType });
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async signedUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }> {
    return { url: `https://storage.test/${key}?ttl=${ttlSeconds}`, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }
}

export function inMemoryPorts(world: InMemoryDirectory = new InMemoryDirectory(), storage: StoragePort = new InMemoryStorage()): MessagingPorts {
  return { directory: world, audience: world, storage };
}
