/**
 * Monde de test : une famille (deux tuteurs, dont un SANS compte), un élève avec compte, une classe, des enseignants et des
 * titulaires de rôles. Annuaire en mémoire ; canaux SCRIPTÉS (aucun envoi réel).
 */
import type { NotifChannel } from "@ecoledigitale/contracts/src/v2/notifications";
import type { ChannelAdapter, ChannelMessage, ChannelOutcome, ChannelRegistry } from "../../application/ports";
import type { Recipient } from "../../domain/types";
import { InMemoryDirectory } from "../../infrastructure/in-memory-ports";

const uuid = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${n.toString(16).padStart(12, "0")}`;

export const IDS = {
  admin: uuid(0x101),
  teacher: uuid(0x111),
  econome: uuid(0x121),
  academicDirector: uuid(0x122),
  hr: uuid(0x123),
  guardianFinancial: uuid(0x131),
  studentUser: uuid(0x141),
  holder: uuid(0x151),
  S1: uuid(0x301),
  S2: uuid(0x302),
  C1: uuid(0x201),
  STAFF1: uuid(0x401),
  INV1: uuid(0x501),
  INV2: uuid(0x502),
  INV3: uuid(0x503),
  INST1: uuid(0x601),
  INST2: uuid(0x602),
  INST3: uuid(0x603),
  RECORD1: uuid(0x701),
  RECORD2: uuid(0x702),
  RECORD3: uuid(0x703),
  EVT: (n: number) => uuid(0x900 + n),
} as const;

export const recipient = (key: string, patch: Partial<Recipient> & { name: string }): Recipient => ({
  subjectKey: key,
  aliasKeys: [],
  userId: null,
  displayName: patch.name,
  email: null,
  phone: null,
  kind: "GUARDIAN",
  ...patch,
});

/** Responsable financier AVEC compte (e-mail + téléphone). */
export const GUARDIAN_A = recipient(`user:${IDS.guardianFinancial}`, {
  name: "KONE Mariam",
  userId: IDS.guardianFinancial,
  email: "mariam.kone@famille.example.org",
  phone: "07 07 07 07 34",
  aliasKeys: ["person:0192f0a4-7b1e-7c3a-8d2e-00000000a001"],
  flags: { primary: true, financial: true },
});

/** Second tuteur SANS compte : joignable par téléphone seulement. */
export const GUARDIAN_B = recipient("person:0192f0a4-7b1e-7c3a-8d2e-00000000a002", { name: "KONE Seydou", phone: "05 55 55 55 12", flags: {} });

export const STUDENT_R = recipient(`user:${IDS.studentUser}`, { name: "KONE Awa", userId: IDS.studentUser, email: "awa.kone@eleve.example.org", kind: "STUDENT" });
export const TEACHER_R = recipient(`user:${IDS.teacher}`, { name: "DIALLO Ibrahim", userId: IDS.teacher, email: "i.diallo@ecole.example.org", kind: "STAFF" });
export const ECONOME_R = recipient(`user:${IDS.econome}`, { name: "TOURE Econome", userId: IDS.econome, email: "econome@ecole.example.org", kind: "STAFF" });
export const ACADEMIC_R = recipient(`user:${IDS.academicDirector}`, { name: "BAMBA Directeur", userId: IDS.academicDirector, email: "etudes@ecole.example.org", kind: "STAFF" });
export const HR_R = recipient(`user:${IDS.hr}`, { name: "OUATTARA RH", userId: IDS.hr, email: "rh@ecole.example.org", kind: "STAFF" });
export const STAFF_R = recipient(`user:${IDS.admin}`, { name: "ADMIN", userId: IDS.admin, email: "admin@ecole.example.org", kind: "STAFF" });
export const HOLDER_R = recipient(`user:${IDS.holder}`, { name: "SANOGO Titulaire", userId: IDS.holder, email: "titulaire@ecole.example.org", kind: "STAFF" });

export function buildWorld(): InMemoryDirectory {
  const w = new InMemoryDirectory();
  w.students.set(IDS.S1, { studentId: IDS.S1, studentName: "Awa Koné", student: STUDENT_R, guardians: [GUARDIAN_A, GUARDIAN_B] });
  w.students.set(IDS.S2, { studentId: IDS.S2, studentName: "Moussa Koné", student: null, guardians: [GUARDIAN_A] });
  w.classrooms.set(IDS.C1, { name: "6ème A", guardians: [GUARDIAN_A, GUARDIAN_B], students: [STUDENT_R], teachers: [TEACHER_R] });
  w.staff.set(IDS.STAFF1, { displayName: "M. Diallo", recipient: TEACHER_R });
  w.roles.set("econome", [ECONOME_R]);
  w.roles.set("directeur_etudes", [ACADEMIC_R]);
  w.roles.set("secretariat", [HR_R]);
  for (const r of [STUDENT_R, TEACHER_R, ECONOME_R, ACADEMIC_R, HR_R, STAFF_R, HOLDER_R, GUARDIAN_A]) if (r.userId) w.users.set(r.userId, r);
  return w;
}

/** Canal SCRIPTÉ : consigne les messages, rejoue des issues programmées, peut tomber en panne (exception). */
export class ScriptedChannel implements ChannelAdapter {
  readonly sent: ChannelMessage[] = [];
  readonly script: ChannelOutcome[] = [];
  calls = 0;
  down = false;
  constructor(
    readonly channel: NotifChannel,
    readonly provider = "scripted",
  ) {}
  status() {
    return { configured: true, missing: [] as string[] };
  }
  async deliver(m: ChannelMessage): Promise<ChannelOutcome> {
    this.calls += 1;
    if (this.down) throw new Error("connexion refusée par 127.0.0.1 pour awa.kone@famille.example.org");
    this.sent.push(m);
    return this.script.shift() ?? { status: "SENT", providerId: `${this.channel}-${this.calls}`, ...(this.channel === "SMS" ? { cost: { amount: 25, currency: "XOF" } } : {}) };
  }
}

export interface ScriptedChannels {
  readonly EMAIL: ScriptedChannel;
  readonly SMS: ScriptedChannel;
  readonly WHATSAPP: ScriptedChannel;
  readonly PUSH: ScriptedChannel;
}

export const scriptedChannels = (): ScriptedChannels => ({ EMAIL: new ScriptedChannel("EMAIL"), SMS: new ScriptedChannel("SMS"), WHATSAPP: new ScriptedChannel("WHATSAPP"), PUSH: new ScriptedChannel("PUSH") });

export const registryOf = (inApp: ChannelAdapter, c: ScriptedChannels): ChannelRegistry => {
  const all = [inApp, c.EMAIL, c.SMS, c.WHATSAPP, c.PUSH];
  return { get: (channel) => all.find((a) => a.channel === channel)!, all: () => all, simulation: false };
};
