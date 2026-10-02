/**
 * Événements du module messaging : noms `<module>.<entité>.<verbe-passé>`, payload JSON versionné `{ v: 1, … }`.
 * Les payloads ne contiennent JAMAIS de texte de message ni d'annonce : identifiants, comptes et catégories
 * (schémas Zod : `packages/contracts/src/v2/messaging.ts`). Domaine pur : aucun import d'infrastructure.
 */
export const MessagingEvents = {
  CONVERSATION_CREATED: "messaging.conversation.created",
  MESSAGE_SENT: "messaging.message.sent",
  MESSAGE_REMOVED: "messaging.message.removed",
  MESSAGE_REPORTED: "messaging.message.reported",
  REPORT_DECIDED: "messaging.report.decided",
  USER_RESTRICTED: "messaging.user.restricted",
  USER_UNRESTRICTED: "messaging.user.unrestricted",
  ANNOUNCEMENT_PUBLISHED: "messaging.announcement.published",
  ANNOUNCEMENT_WITHDRAWN: "messaging.announcement.withdrawn",
  ANNOUNCEMENT_ACKNOWLEDGED: "messaging.announcement.acknowledged",
} as const;

export type MessagingEventType = (typeof MessagingEvents)[keyof typeof MessagingEvents];
export const ALL_MESSAGING_EVENT_TYPES: ReadonlyArray<MessagingEventType> = Object.values(MessagingEvents);
/** Compatibilité avec le squelette généré (`manifest.ts`). */
export const ALL_EVENT_TYPES = ALL_MESSAGING_EVENT_TYPES;

/** Événements d'AUTRES modules consommés (messages système). Les formes de payload sont celles de leurs producteurs. */
export const ConsumedEvents = {
  ABSENCE_RECORDED: "attendance.absence.recorded",
  LATE_RECORDED: "attendance.late.recorded",
} as const;
