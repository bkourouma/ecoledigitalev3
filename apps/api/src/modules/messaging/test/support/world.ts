/**
 * Monde de test : un établissement avec deux classes, des élèves, des tuteurs, des enseignants, une direction.
 * L'annuaire est en mémoire (`InMemoryDirectory`) ; les données de messagerie sont dans Postgres (tests d'intégration).
 */
import type { CallerCaps } from "../../domain/types";
import { InMemoryDirectory } from "../../infrastructure/in-memory-ports";

const uuid = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${n.toString(16).padStart(12, "0")}`;

export const IDS = {
  admin: uuid(0x101),
  secretary: uuid(0x102),
  teacher6A: uuid(0x111),
  teacher6B: uuid(0x112),
  teacherBoth: uuid(0x113),
  parent1: uuid(0x121), // père de S1 (6A)
  parent2: uuid(0x122), // mère de S1 (6A) ET de S3 (6B)
  parent3: uuid(0x123), // parent de S4 (6B)
  student1: uuid(0x131), // S1 (6A)
  student3: uuid(0x133), // S3 (6B)
  outsider: uuid(0x141), // personne sans lien
  inactive: uuid(0x142),
  staff1: uuid(0x151),
  C6A: uuid(0x201),
  C6B: uuid(0x202),
  C5A: uuid(0x203),
  S1: uuid(0x301),
  S2: uuid(0x302),
  S3: uuid(0x303),
  S4: uuid(0x304),
  STAFF_T6A: uuid(0x401),
  STAFF_T6B: uuid(0x402),
  STAFF_TB: uuid(0x403),
  STAFF_1: uuid(0x404),
  LEVEL_6: uuid(0x501),
  CAMPUS_1: uuid(0x601),
  INSTITUTION_1: uuid(0x701),
} as const;

export function buildWorld(): InMemoryDirectory {
  const w = new InMemoryDirectory();
  w.classrooms.set(IDS.C6A, { name: "6ème A", levelId: IDS.LEVEL_6, campusId: IDS.CAMPUS_1, institutionId: IDS.INSTITUTION_1 });
  w.classrooms.set(IDS.C6B, { name: "6ème B", levelId: IDS.LEVEL_6, campusId: IDS.CAMPUS_1, institutionId: IDS.INSTITUTION_1 });
  w.classrooms.set(IDS.C5A, { name: "5ème A", levelId: uuid(0x502), campusId: IDS.CAMPUS_1, institutionId: IDS.INSTITUTION_1 });
  w.studentClasses.set(IDS.S1, [IDS.C6A]);
  w.studentClasses.set(IDS.S2, [IDS.C6A]);
  w.studentClasses.set(IDS.S3, [IDS.C6B]);
  w.studentClasses.set(IDS.S4, [IDS.C6B]);
  w.studentNames.set(IDS.S1, "Awa Koné");
  w.studentNames.set(IDS.S2, "Moussa Traoré");
  w.studentNames.set(IDS.S3, "Fanta Koné");
  w.studentNames.set(IDS.S4, "Yao Kouassi");

  w.addUser({ userId: IDS.admin, displayName: "DIRECTION Marie", roles: ["directeur"], staffId: undefined })
    .addUser({ userId: IDS.secretary, displayName: "SECRETARIAT Paul", roles: ["secretariat"], staffId: IDS.STAFF_1 })
    .addUser({ userId: IDS.teacher6A, displayName: "KONAN Enseignant6A", staffId: IDS.STAFF_T6A, teachingClassroomIds: [IDS.C6A] })
    .addUser({ userId: IDS.teacher6B, displayName: "BAMBA Enseignant6B", staffId: IDS.STAFF_T6B, teachingClassroomIds: [IDS.C6B] })
    .addUser({ userId: IDS.teacherBoth, displayName: "DIALLO EnseignantDeux", staffId: IDS.STAFF_TB, teachingClassroomIds: [IDS.C6A, IDS.C6B] })
    .addUser({ userId: IDS.staff1, displayName: "OUATTARA Educateur", staffId: IDS.STAFF_1, teachingClassroomIds: [] })
    .addUser({ userId: IDS.parent1, displayName: "KONE Père", childStudentIds: [IDS.S1] })
    .addUser({ userId: IDS.parent2, displayName: "KONE Mère", childStudentIds: [IDS.S1, IDS.S3] })
    .addUser({ userId: IDS.parent3, displayName: "KOUASSI Parent", childStudentIds: [IDS.S4] })
    .addUser({ userId: IDS.student1, displayName: "KONE Awa", studentId: IDS.S1 })
    .addUser({ userId: IDS.student3, displayName: "KONE Fanta", studentId: IDS.S3 })
    .addUser({ userId: IDS.outsider, displayName: "SANS Lien" })
    .addUser({ userId: IDS.inactive, displayName: "INACTIF Personne", active: false, childStudentIds: [IDS.S1] });
  return w;
}

/** Capacités RBAC simulées des rôles système (voir README : « parent » = `*.child.*`, « eleve » = `*.self.*`). */
export const ROLE_CAPS: Readonly<Record<string, CallerCaps>> = Object.freeze({
  admin: {
    sendAny: true, send: true, announcementPublish: true, announcementManage: true, moderationRead: true, moderationManage: true, moderationSupervise: true, settingsManage: true,
  },
  teacher: { send: true, announcementPublishClass: true },
  staff: { send: true },
  parent: { childSend: true },
  student: { selfSend: true },
  /** Q-13 : enseignant auquel la direction a accordé `messaging.send.any_family` (rôle personnalisé, jamais un rôle système). */
  teacherFamily: { send: true, sendAnyFamily: true },
  none: {},
});

export const ROLE_OF: Readonly<Record<string, keyof typeof ROLE_CAPS>> = Object.freeze({
  [IDS.admin]: "admin",
  [IDS.secretary]: "staff",
  [IDS.teacher6A]: "teacher",
  [IDS.teacher6B]: "teacher",
  [IDS.teacherBoth]: "teacher",
  [IDS.staff1]: "staff",
  [IDS.parent1]: "parent",
  [IDS.parent2]: "parent",
  [IDS.parent3]: "parent",
  [IDS.student1]: "student",
  [IDS.student3]: "student",
  [IDS.outsider]: "parent",
  [IDS.inactive]: "parent",
});

/** Rôles ajoutés par un test à des utilisateurs qu'il crée lui-même (le tableau ROLE_OF est figé). */
const EXTRA_ROLE_OF = new Map<string, keyof typeof ROLE_CAPS>();
export const registerRole = (userId: string, role: keyof typeof ROLE_CAPS): void => void EXTRA_ROLE_OF.set(userId, role);
const roleOf = (userId: string): keyof typeof ROLE_CAPS => ROLE_OF[userId] ?? EXTRA_ROLE_OF.get(userId) ?? "none";

export const capsOf = (userId: string): CallerCaps => ROLE_CAPS[roleOf(userId)]!;

/** Permissions du manifeste correspondant aux capacités d'un utilisateur (pour le garde HTTP simulé). */
export function permissionsOf(userId: string): Set<string> {
  const role = roleOf(userId);
  const read = role === "parent" ? ["messaging.child.read"] : role === "student" ? ["messaging.self.read"] : role === "none" ? [] : ["messaging.read"];
  const c = ROLE_CAPS[role]!;
  const out = new Set<string>(read);
  if (c.sendAny) out.add("messaging.send.any");
  if (c.sendAnyFamily) out.add("messaging.send.any_family");
  if (c.send) out.add("messaging.send");
  if (c.childSend) out.add("messaging.child.send");
  if (c.selfSend) out.add("messaging.self.send");
  if (c.announcementPublish) out.add("messaging.announcement.publish");
  if (c.announcementPublishClass) out.add("messaging.announcement.publish_class");
  if (c.announcementManage) out.add("messaging.announcement.manage");
  if (c.moderationRead) out.add("messaging.moderation.read");
  if (c.moderationManage) out.add("messaging.moderation.manage");
  if (c.moderationSupervise) out.add("messaging.moderation.supervise");
  if (c.settingsManage) out.add("messaging.settings.manage");
  return out;
}
