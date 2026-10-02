/**
 * RÈGLES D'AUTORISATION DE LA MESSAGERIE (spec v2/016 §4) — fonctions pures, testées sans base.
 *
 * Le RBAC dit QUEL TYPE d'action ; ce fichier décide VIS-À-VIS DE QUI. Quatre ensembles de règles, chacun ouvert par une
 * permission de manifeste et un PROFIL (résolu par les ports, jamais par le client) :
 *
 *   R1  `messaging.send.any`            administration : tout utilisateur actif, toute classe, toute audience
 *   R2  `messaging.send` + personnel    le personnel ; les élèves et tuteurs de SES classes ; l'administration
 *   R3  `messaging.child.send` + tuteur le personnel affecté à une classe de SES enfants ; l'administration
 *   R4  `messaging.self.send` + élève   selon la politique de l'établissement
 *
 * Les règles se CUMULENT (un enseignant qui est aussi parent) : un destinataire est autorisé si une règle applicable
 * l'autorise. Refus par défaut. Jamais de rôle codé en dur : le « personnel de l'administration » est un paramètre
 * d'établissement (`adminContactRoles`) résolu par le port d'annuaire.
 */
import { hasAnySendCap, type ActorProfile, type CallerCaps, type DirectoryContact, type MessagingClassInclude, type MessagingSettings, type Uuid } from "./types";

export type SendRule = "R1" | "R2" | "R3" | "R4";

export type DenyReason =
  | "NO_PERMISSION"
  | "SELF"
  | "STUDENT_POLICY"
  | "NOT_LINKED"
  | "FORBIDDEN_KIND"
  | "NOT_YOUR_CHILD"
  | "NOT_YOUR_CLASS";

export type Decision = { readonly allowed: true; readonly via: SendRule } | { readonly allowed: false; readonly reason: DenyReason };

const intersects = (a: readonly Uuid[], b: readonly Uuid[]): boolean => {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(b);
  return a.some((x) => set.has(x));
};

/** Règles ouvertes par les capacités ET le profil de l'acteur (un droit sans profil correspondant n'ouvre rien). */
export function applicableRules(caps: CallerCaps, actor: ActorProfile, settings: Pick<MessagingSettings, "studentPolicy">): SendRule[] {
  const rules: SendRule[] = [];
  if (caps.sendAny) rules.push("R1");
  if (caps.send && actor.staffId) rules.push("R2");
  if (caps.childSend && actor.childStudentIds.length > 0) rules.push("R3");
  if (caps.selfSend && actor.studentId && (settings.studentPolicy === "TEACHERS" || settings.studentPolicy === "TEACHERS_AND_ADMIN")) rules.push("R4");
  return rules;
}

/** Peut-on ouvrir une conversation (au moins une règle applicable) ? Sinon, la raison la plus parlante. */
export function canInitiate(caps: CallerCaps, actor: ActorProfile, settings: Pick<MessagingSettings, "studentPolicy">): DenyReason | null {
  if (!hasAnySendCap(caps)) return "NO_PERMISSION";
  if (applicableRules(caps, actor, settings).length > 0) return null;
  if (caps.selfSend && actor.studentId) return "STUDENT_POLICY";
  return "NOT_LINKED";
}

export interface RecipientCheckInput {
  readonly caps: CallerCaps;
  readonly actor: ActorProfile;
  readonly target: ActorProfile;
  readonly settings: Pick<MessagingSettings, "studentPolicy">;
  /** Utilisateurs « contacts de l'administration » (titulaires des rôles de `adminContactRoles`). */
  readonly adminContacts: ReadonlySet<Uuid>;
}

/** Le destinataire `target` est-il autorisé pour `actor` ? */
export function evaluateRecipient(input: RecipientCheckInput): Decision {
  const { caps, actor, target, settings, adminContacts } = input;
  if (!hasAnySendCap(caps)) return { allowed: false, reason: "NO_PERMISSION" };
  if (target.userId === actor.userId) return { allowed: false, reason: "SELF" };
  const rules = applicableRules(caps, actor, settings);
  if (rules.includes("R1")) return { allowed: true, via: "R1" };

  if (rules.includes("R2")) {
    // Le personnel et les contacts de l'administration (un directeur peut ne pas avoir de fiche de personnel).
    if (target.staffId || adminContacts.has(target.userId)) return { allowed: true, via: "R2" };
    if (target.studentId && intersects(target.studentClassroomIds, actor.teachingClassroomIds)) return { allowed: true, via: "R2" };
    if (target.childStudentIds.length > 0 && intersects(target.childClassroomIds, actor.teachingClassroomIds)) return { allowed: true, via: "R2" };
  }
  if (rules.includes("R3")) {
    if (target.staffId && intersects(target.teachingClassroomIds, actor.childClassroomIds)) return { allowed: true, via: "R3" };
    if (adminContacts.has(target.userId)) return { allowed: true, via: "R3" };
  }
  if (rules.includes("R4")) {
    if (target.staffId && intersects(target.teachingClassroomIds, actor.studentClassroomIds)) return { allowed: true, via: "R4" };
    if (settings.studentPolicy === "TEACHERS_AND_ADMIN" && adminContacts.has(target.userId)) return { allowed: true, via: "R4" };
  }

  if (rules.length === 0) return { allowed: false, reason: canInitiate(caps, actor, settings) ?? "NOT_LINKED" };
  if (actor.studentId && !actor.staffId && actor.childStudentIds.length === 0 && (target.studentId || target.childStudentIds.length > 0)) {
    return { allowed: false, reason: "FORBIDDEN_KIND" };
  }
  if (actor.childStudentIds.length > 0 && !actor.staffId && (target.childStudentIds.length > 0 || target.studentId)) {
    return { allowed: false, reason: "FORBIDDEN_KIND" };
  }
  return { allowed: false, reason: "NOT_LINKED" };
}

/** Le tuteur peut-il invoquer l'élève `aboutStudentId` comme contexte ? (R3 : l'un de SES enfants.) */
export function canUseAboutStudent(caps: CallerCaps, actor: ActorProfile, aboutStudentId: Uuid): boolean {
  if (caps.sendAny) return true;
  if (actor.childStudentIds.includes(aboutStudentId)) return true;
  if (actor.studentId === aboutStudentId) return true;
  // Le personnel peut référencer un élève (la pertinence du lien est vérifiée sur les destinataires).
  return caps.send === true && actor.staffId !== null;
}

/** Écrire à une CLASSE en bloc : administration (toute classe) ou enseignant affecté à cette classe. */
export function canTargetClassroom(caps: CallerCaps, actor: ActorProfile, classroomId: Uuid, include: readonly MessagingClassInclude[]): Decision {
  if (caps.sendAny) return { allowed: true, via: "R1" };
  if (caps.send && actor.staffId) {
    if (!actor.teachingClassroomIds.includes(classroomId)) return { allowed: false, reason: "NOT_YOUR_CLASS" };
    return { allowed: true, via: "R2" };
  }
  void include;
  return { allowed: false, reason: hasAnySendCap(caps) ? "FORBIDDEN_KIND" : "NO_PERMISSION" };
}

/** Audience par cibles (publipostage administratif) : administration seulement. */
export function canUseAudience(caps: CallerCaps): boolean {
  return caps.sendAny === true;
}

/** Plafond de participants d'un fil de groupe ou d'une diffusion pour cet acteur. */
export function participantLimit(kind: "GROUP" | "BROADCAST", caps: CallerCaps, settings: Pick<MessagingSettings, "maxGroupParticipants" | "maxBroadcastParticipants">): number {
  if (kind === "BROADCAST") return settings.maxBroadcastParticipants;
  return caps.sendAny ? settings.maxBroadcastParticipants : settings.maxGroupParticipants;
}

/** Diffuser (publipostage) : administration ou personnel (classes) ; jamais parent ni élève. */
export function canBroadcast(caps: CallerCaps, actor: ActorProfile): boolean {
  return caps.sendAny === true || (caps.send === true && actor.staffId !== null);
}

export interface ReplyCheckInput {
  readonly caps: CallerCaps;
  readonly settings: Pick<MessagingSettings, "studentPolicy">;
  readonly conversation: { readonly kind: "DIRECT" | "GROUP" | "SYSTEM"; readonly closed: boolean; readonly allowReplies: boolean };
  readonly participant: { readonly role: "OWNER" | "MEMBER"; readonly left: boolean } | null;
  readonly restricted: boolean;
}

export type ReplyBlock = "NO_PERMISSION" | "NOT_PARTICIPANT" | "CLOSED" | "REPLIES_DISABLED" | "RESTRICTED" | "STUDENT_POLICY";

/** Peut-on RÉPONDRE dans ce fil ? (Aucun lien n'est exigé : le fil existe déjà.) `null` = oui. */
export function replyBlock(input: ReplyCheckInput): ReplyBlock | null {
  const { caps, settings, conversation, participant, restricted } = input;
  if (!participant || participant.left) return "NOT_PARTICIPANT";
  if (!hasAnySendCap(caps)) return "NO_PERMISSION";
  if (conversation.kind === "SYSTEM") return "REPLIES_DISABLED";
  if (conversation.closed) return "CLOSED";
  if (!conversation.allowReplies && participant.role !== "OWNER") return "REPLIES_DISABLED";
  if (restricted) return "RESTRICTED";
  // `selfSend` n'est accordée que par le rôle élève : sans autre droit d'envoi, l'acteur est un élève.
  const onlyStudent = caps.selfSend === true && !caps.send && !caps.childSend && !caps.sendAny;
  if (onlyStudent && settings.studentPolicy === "DISABLED") return "STUDENT_POLICY";
  return null;
}

/** Messages d'erreur utilisateur (français) associés aux refus. */
export const DENY_MESSAGES: Readonly<Record<DenyReason, string>> = Object.freeze({
  NO_PERMISSION: "Vous n'avez pas le droit d'envoyer des messages.",
  SELF: "Vous ne pouvez pas vous écrire à vous-même.",
  STUDENT_POLICY: "La messagerie des élèves est limitée par l'établissement.",
  NOT_LINKED: "Vous ne pouvez écrire qu'aux personnes liées à vos enfants, à vos classes ou à l'administration.",
  FORBIDDEN_KIND: "Ce type de destinataire n'est pas autorisé.",
  NOT_YOUR_CHILD: "Cet élève n'est pas l'un de vos enfants.",
  NOT_YOUR_CLASS: "Vous n'êtes pas affecté à cette classe.",
});

export const REPLY_BLOCK_MESSAGES: Readonly<Record<ReplyBlock, string>> = Object.freeze({
  NO_PERMISSION: "Vous n'avez pas le droit d'envoyer des messages.",
  NOT_PARTICIPANT: "Vous ne participez pas à cette conversation.",
  CLOSED: "Cette conversation est fermée.",
  REPLIES_DISABLED: "Les réponses sont désactivées dans cette conversation.",
  RESTRICTED: "Votre envoi de messages est temporairement restreint.",
  STUDENT_POLICY: "La messagerie des élèves est désactivée par l'établissement.",
});

/** Contact d'administration ? (utilitaire d'adaptateurs et de tests) */
export const isAdminContact = (contact: Pick<DirectoryContact, "userId">, adminContacts: ReadonlySet<Uuid>): boolean => adminContacts.has(contact.userId);
