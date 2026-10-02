/**
 * Règles d'autorisation (spec 016 §4) : matrice parent / enseignant / élève / administration, sans base de données.
 */
import { describe, expect, it } from "vitest";
import {
  applicableRules,
  canBroadcast,
  canInitiate,
  canTargetClassroom,
  canUseAboutStudent,
  canUseAudience,
  evaluateRecipient,
  participantLimit,
  replyBlock,
} from "../../domain/policy";
import { DEFAULT_MESSAGING_SETTINGS, type ActorProfile, type CallerCaps, type MessagingSettings } from "../../domain/types";
import { buildWorld, capsOf, IDS } from "../support/world";

const world = buildWorld();
const profile = (userId: string): ActorProfile => {
  const u = world.users.get(userId)!;
  const children = u.childStudentIds ?? [];
  return {
    userId,
    displayName: u.displayName,
    studentId: u.studentId ?? null,
    studentClassroomIds: u.studentId ? (world.studentClasses.get(u.studentId) ?? []) : [],
    childStudentIds: children,
    childClassroomIds: [...new Set(children.flatMap((c) => world.studentClasses.get(c) ?? []))],
    staffId: u.staffId ?? null,
    teachingClassroomIds: u.teachingClassroomIds ?? [],
  };
};
const admins = new Set([IDS.admin, IDS.secretary]);
const settings = (patch: Partial<MessagingSettings> = {}): MessagingSettings => ({ ...DEFAULT_MESSAGING_SETTINGS, ...patch });
const can = (from: string, to: string, patch: Partial<MessagingSettings> = {}): boolean =>
  evaluateRecipient({ caps: capsOf(from), actor: profile(from), target: profile(to), settings: settings(patch), adminContacts: admins }).allowed;

describe("règles d'envoi : parent", () => {
  it("écrit aux enseignants des classes de SES enfants et à l'administration", () => {
    expect(can(IDS.parent1, IDS.teacher6A)).toBe(true);
    expect(can(IDS.parent1, IDS.teacherBoth)).toBe(true);
    expect(can(IDS.parent1, IDS.admin)).toBe(true);
    expect(can(IDS.parent1, IDS.secretary)).toBe(true);
  });
  it("n'écrit pas à un enseignant d'une autre classe", () => {
    expect(can(IDS.parent1, IDS.teacher6B)).toBe(false);
  });
  it("un parent de deux enfants atteint les enseignants des deux classes", () => {
    expect(can(IDS.parent2, IDS.teacher6A)).toBe(true);
    expect(can(IDS.parent2, IDS.teacher6B)).toBe(true);
  });
  it("n'écrit ni à un autre parent ni à un élève ni à un personnel sans lien", () => {
    expect(can(IDS.parent1, IDS.parent2)).toBe(false);
    expect(can(IDS.parent1, IDS.student1)).toBe(false);
    expect(can(IDS.parent1, IDS.staff1)).toBe(false);
  });
  it("un parent sans enfant lié n'ouvre aucune règle", () => {
    expect(applicableRules(capsOf(IDS.outsider), profile(IDS.outsider), settings())).toEqual([]);
    expect(canInitiate(capsOf(IDS.outsider), profile(IDS.outsider), settings())).toBe("NOT_LINKED");
    expect(can(IDS.outsider, IDS.teacher6A)).toBe(false);
  });
  it("ne peut invoquer comme contexte que l'un de SES enfants", () => {
    expect(canUseAboutStudent(capsOf(IDS.parent1), profile(IDS.parent1), IDS.S1)).toBe(true);
    expect(canUseAboutStudent(capsOf(IDS.parent1), profile(IDS.parent1), IDS.S3)).toBe(false);
  });
  it("ne diffuse pas, n'écrit pas à une classe, n'utilise pas d'audience", () => {
    expect(canBroadcast(capsOf(IDS.parent1), profile(IDS.parent1))).toBe(false);
    expect(canTargetClassroom(capsOf(IDS.parent1), profile(IDS.parent1), IDS.C6A, ["GUARDIANS"]).allowed).toBe(false);
    expect(canUseAudience(capsOf(IDS.parent1))).toBe(false);
  });
});

describe("règles d'envoi : enseignant", () => {
  it("écrit aux élèves et aux tuteurs de SES classes", () => {
    expect(can(IDS.teacher6A, IDS.student1)).toBe(true);
    expect(can(IDS.teacher6A, IDS.parent1)).toBe(true);
    expect(can(IDS.teacher6A, IDS.parent2)).toBe(true); // mère de S1 (6A) et S3 (6B)
  });
  it("n'écrit pas aux élèves ni aux tuteurs d'une autre classe", () => {
    expect(can(IDS.teacher6A, IDS.student3)).toBe(false);
    expect(can(IDS.teacher6A, IDS.parent3)).toBe(false);
    expect(can(IDS.teacher6B, IDS.parent1)).toBe(false);
  });
  it("écrit à tout le personnel", () => {
    expect(can(IDS.teacher6A, IDS.teacher6B)).toBe(true);
    expect(can(IDS.teacher6A, IDS.admin)).toBe(true);
    expect(can(IDS.teacher6A, IDS.staff1)).toBe(true);
  });
  it("n'écrit pas à un compte sans lien", () => {
    expect(can(IDS.teacher6A, IDS.outsider)).toBe(false);
  });
  it("écrit en bloc à SES classes seulement ; diffuse ; pas d'audience", () => {
    expect(canTargetClassroom(capsOf(IDS.teacher6A), profile(IDS.teacher6A), IDS.C6A, ["STUDENTS"]).allowed).toBe(true);
    expect(canTargetClassroom(capsOf(IDS.teacher6A), profile(IDS.teacher6A), IDS.C6B, ["STUDENTS"])).toEqual({ allowed: false, reason: "NOT_YOUR_CLASS" });
    expect(canBroadcast(capsOf(IDS.teacher6A), profile(IDS.teacher6A))).toBe(true);
    expect(canUseAudience(capsOf(IDS.teacher6A))).toBe(false);
  });
  it("le droit d'envoi sans fiche de personnel n'ouvre rien (échec fermé)", () => {
    expect(applicableRules({ send: true }, profile(IDS.outsider), settings())).toEqual([]);
  });
});

describe("règles d'envoi : élève (politique de l'établissement)", () => {
  it("DISABLED et REPLY_ONLY : aucune initiative", () => {
    for (const studentPolicy of ["DISABLED", "REPLY_ONLY"] as const) {
      expect(canInitiate(capsOf(IDS.student1), profile(IDS.student1), settings({ studentPolicy }))).toBe("STUDENT_POLICY");
      expect(can(IDS.student1, IDS.teacher6A, { studentPolicy })).toBe(false);
    }
  });
  it("TEACHERS : ses enseignants seulement", () => {
    expect(can(IDS.student1, IDS.teacher6A, { studentPolicy: "TEACHERS" })).toBe(true);
    expect(can(IDS.student1, IDS.teacher6B, { studentPolicy: "TEACHERS" })).toBe(false);
    expect(can(IDS.student1, IDS.admin, { studentPolicy: "TEACHERS" })).toBe(false);
  });
  it("TEACHERS_AND_ADMIN : + l'administration ; jamais un autre élève ni un parent", () => {
    expect(can(IDS.student1, IDS.admin, { studentPolicy: "TEACHERS_AND_ADMIN" })).toBe(true);
    expect(can(IDS.student1, IDS.student3, { studentPolicy: "TEACHERS_AND_ADMIN" })).toBe(false);
    expect(can(IDS.student1, IDS.parent1, { studentPolicy: "TEACHERS_AND_ADMIN" })).toBe(false);
  });
  it("la réponse d'un élève dépend de la politique : bloquée seulement par DISABLED", () => {
    const conv = { kind: "DIRECT" as const, closed: false, allowReplies: true };
    const part = { role: "MEMBER" as const, left: false };
    const base = { caps: capsOf(IDS.student1), conversation: conv, participant: part, restricted: false };
    expect(replyBlock({ ...base, settings: settings({ studentPolicy: "DISABLED" }) })).toBe("STUDENT_POLICY");
    expect(replyBlock({ ...base, settings: settings({ studentPolicy: "REPLY_ONLY" }) })).toBeNull();
  });
});

describe("règles d'envoi : administration", () => {
  it("écrit à tout utilisateur, toute classe, toute audience", () => {
    for (const to of [IDS.parent1, IDS.student1, IDS.teacher6B, IDS.outsider]) expect(can(IDS.admin, to)).toBe(true);
    expect(canTargetClassroom(capsOf(IDS.admin), profile(IDS.admin), IDS.C5A, ["STUDENTS", "GUARDIANS"]).allowed).toBe(true);
    expect(canUseAudience(capsOf(IDS.admin))).toBe(true);
    expect(canBroadcast(capsOf(IDS.admin), profile(IDS.admin))).toBe(true);
  });
  it("ne s'écrit pas à soi-même", () => {
    expect(evaluateRecipient({ caps: capsOf(IDS.admin), actor: profile(IDS.admin), target: profile(IDS.admin), settings: settings(), adminContacts: admins })).toEqual({ allowed: false, reason: "SELF" });
  });
  it("un utilisateur sans aucun droit d'envoi est refusé", () => {
    const none: CallerCaps = {};
    expect(canInitiate(none, profile(IDS.outsider), settings())).toBe("NO_PERMISSION");
  });
});

describe("règles cumulées", () => {
  it("un enseignant qui est aussi parent cumule les droits (R2 + R3)", () => {
    const both: ActorProfile = { ...profile(IDS.teacher6A), childStudentIds: [IDS.S3], childClassroomIds: [IDS.C6B] };
    const caps: CallerCaps = { send: true, childSend: true };
    const to = profile(IDS.teacher6B);
    expect(applicableRules(caps, both, settings())).toEqual(["R2", "R3"]);
    expect(evaluateRecipient({ caps, actor: both, target: to, settings: settings(), adminContacts: admins }).allowed).toBe(true);
    // Tuteur d'un élève de 6B : un parent d'élève de 6B est joignable via R2 seulement s'il a un enfant dans SES classes (6A) : non.
    expect(evaluateRecipient({ caps, actor: both, target: profile(IDS.parent3), settings: settings(), adminContacts: admins }).allowed).toBe(false);
  });
});

describe("réponse dans un fil", () => {
  const base = { caps: capsOf(IDS.parent1), settings: settings(), conversation: { kind: "DIRECT" as const, closed: false, allowReplies: true }, participant: { role: "MEMBER" as const, left: false }, restricted: false };
  it("autorise un participant sans exiger de lien", () => {
    expect(replyBlock(base)).toBeNull();
  });
  it("refuse hors participation, fil fermé, réponses désactivées, restriction, sans droit", () => {
    expect(replyBlock({ ...base, participant: null })).toBe("NOT_PARTICIPANT");
    expect(replyBlock({ ...base, participant: { role: "MEMBER", left: true } })).toBe("NOT_PARTICIPANT");
    expect(replyBlock({ ...base, conversation: { ...base.conversation, closed: true } })).toBe("CLOSED");
    expect(replyBlock({ ...base, conversation: { ...base.conversation, allowReplies: false } })).toBe("REPLIES_DISABLED");
    expect(replyBlock({ ...base, conversation: { ...base.conversation, allowReplies: false }, participant: { role: "OWNER", left: false } })).toBeNull();
    expect(replyBlock({ ...base, restricted: true })).toBe("RESTRICTED");
    expect(replyBlock({ ...base, caps: {} })).toBe("NO_PERMISSION");
    expect(replyBlock({ ...base, conversation: { ...base.conversation, kind: "SYSTEM" } })).toBe("REPLIES_DISABLED");
  });
});

describe("plafonds", () => {
  it("un groupe est plafonné plus bas qu'une diffusion, sauf pour l'administration", () => {
    const s = settings();
    expect(participantLimit("GROUP", capsOf(IDS.teacher6A), s)).toBe(s.maxGroupParticipants);
    expect(participantLimit("GROUP", capsOf(IDS.admin), s)).toBe(s.maxBroadcastParticipants);
    expect(participantLimit("BROADCAST", capsOf(IDS.teacher6A), s)).toBe(s.maxBroadcastParticipants);
  });
});
