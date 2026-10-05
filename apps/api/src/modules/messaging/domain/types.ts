/**
 * Types du domaine de la messagerie : profil d'acteur (résolu par les ports), paramètres, capacités RBAC.
 * Domaine pur : aucun import pg / fastify / infrastructure.
 */
import type {
  MessagingAudience,
  MessagingClassInclude,
  MessagingPriority,
  MessagingRecipientKind,
  MessagingStudentPolicy,
  MessagingTarget,
} from "@ecoledigitale/contracts/src/v2/messaging";

export type Uuid = string;
export type { MessagingAudience, MessagingClassInclude, MessagingPriority, MessagingRecipientKind, MessagingStudentPolicy, MessagingTarget };

/**
 * Qui est cet utilisateur pour l'école : élève (classes où il est inscrit), tuteur (enfants et leurs classes), membre du
 * personnel (classes où il est affecté AUJOURD'HUI). Un utilisateur peut cumuler plusieurs profils. Résolu par le port
 * `PeopleDirectory` (people + academic), jamais déduit d'un en-tête client.
 */
export interface ActorProfile {
  readonly userId: Uuid;
  readonly displayName: string | null;
  readonly studentId: Uuid | null;
  readonly studentClassroomIds: readonly Uuid[];
  readonly childStudentIds: readonly Uuid[];
  readonly childClassroomIds: readonly Uuid[];
  readonly staffId: Uuid | null;
  readonly teachingClassroomIds: readonly Uuid[];
  /**
   * Q-05 : classes des enfants (tuteur) durant l'ANNÉE PRÉCÉDENTE (inscriptions suivies, y compris terminées). Absent = aucune.
   * Ne sert qu'à la règle R3, tant que la fenêtre de l'établissement est ouverte (`previousYearOpen`).
   */
  readonly childPreviousYearClassroomIds?: readonly Uuid[];
  /** Q-05 : classes où le membre du personnel enseignait durant l'ANNÉE PRÉCÉDENTE (affectations terminées comprises). */
  readonly pastTeachingClassroomIds?: readonly Uuid[];
  /**
   * Q-05 : date (AAAA-MM-JJ) à partir de laquelle court la fenêtre — début de l'année qui suit l'année précédente, sinon fin de
   * l'année précédente. `null`/absent : pas d'année précédente connue. Posé par l'annuaire (academic), jamais par le client.
   */
  readonly previousYearWindowAnchorOn?: string | null;
}

/** Une personne joignable, telle que la présente un annuaire. */
export interface DirectoryContact {
  readonly userId: Uuid;
  readonly displayName: string;
  readonly kind: MessagingRecipientKind;
  /** Pour un tuteur : l'élève (enfant) par lequel il est joignable. */
  readonly studentId?: Uuid | null;
  readonly studentName?: string | null;
  readonly classroomId?: Uuid | null;
}

/** Paramètres d'établissement (table `settings`, défauts du code quand aucune ligne). */
export interface MessagingSettings {
  readonly studentPolicy: MessagingStudentPolicy;
  readonly adminContactRoles: readonly string[];
  readonly attachmentsEnabled: boolean;
  readonly attachmentMaxBytes: number;
  readonly attachmentMaxPerItem: number;
  readonly allowedAttachmentTypes: readonly string[];
  readonly maxMessagesPerHour: number;
  readonly maxNewConversationsPerDay: number;
  readonly maxGroupParticipants: number;
  readonly maxBroadcastParticipants: number;
  readonly messageMaxLength: number;
  readonly notificationRetentionDays: number;
  /** Q-05 : jours pendant lesquels un parent peut écrire aux enseignants de l'année précédente (0 = fermé). */
  readonly previousYearWindowDays: number;
}

/**
 * Valeurs par défaut d'un établissement qui n'a rien configuré (identiques aux défauts de la table `settings`).
 * `TEACHERS_AND_ADMIN` : parité avec le legacy, où l'élève écrivait à ses enseignants et à l'établissement.
 */
export const DEFAULT_MESSAGING_SETTINGS: MessagingSettings = Object.freeze({
  studentPolicy: "TEACHERS_AND_ADMIN",
  adminContactRoles: Object.freeze(["directeur", "secretariat"]),
  attachmentsEnabled: true,
  attachmentMaxBytes: 5 * 1024 * 1024,
  attachmentMaxPerItem: 5,
  allowedAttachmentTypes: Object.freeze(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  maxMessagesPerHour: 120,
  maxNewConversationsPerDay: 30,
  maxGroupParticipants: 200,
  maxBroadcastParticipants: 5000,
  messageMaxLength: 5000,
  notificationRetentionDays: 90,
  previousYearWindowDays: 90,
});

/** Capacités RBAC de l'appelant (permissions du manifeste). Sans capacité fournie : le droit le plus restreint. */
export interface CallerCaps {
  readonly sendAny?: boolean;
  readonly send?: boolean;
  readonly childSend?: boolean;
  readonly selfSend?: boolean;
  readonly announcementPublish?: boolean;
  readonly announcementPublishClass?: boolean;
  readonly announcementManage?: boolean;
  readonly moderationRead?: boolean;
  readonly moderationManage?: boolean;
  readonly moderationSupervise?: boolean;
  readonly settingsManage?: boolean;
}

export const hasAnySendCap = (caps: CallerCaps): boolean => caps.sendAny === true || caps.send === true || caps.childSend === true || caps.selfSend === true;
