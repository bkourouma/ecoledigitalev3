/** Fabriques de données de test de la messagerie : conformes aux contrats courants (vérifié par le test de conformité). */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  me: uuid(1),
  teacher: uuid(2),
  parent: uuid(3),
  conv: uuid(100),
  conv2: uuid(101),
  msg: uuid(200),
  ann: uuid(300),
  class6A: uuid(400),
  student: uuid(500),
  report: uuid(600),
};

export const NOW = "2026-10-02T09:00:00.000Z";

export function myAudience(over: Record<string, unknown> = {}) {
  return {
    userId: IDS.me,
    canSend: true,
    canSendAny: false,
    canPublishAnnouncements: false,
    canManageAnnouncements: false,
    canModerate: false,
    classrooms: [],
    studentPolicy: "TEACHERS_AND_ADMIN",
    isStudent: false,
    isGuardian: false,
    isStaff: false,
    restrictedUntil: null,
    restricted: false,
    ...over,
  };
}

export function participant(userId: string, displayName: string, over: Record<string, unknown> = {}) {
  return { userId, displayName, role: "MEMBER", left: false, ...over };
}

export function conversation(over: Record<string, unknown> = {}) {
  return {
    id: IDS.conv,
    kind: "DIRECT",
    subject: "Devoirs de maths",
    priority: "NORMAL",
    aboutStudentId: null,
    classroomId: null,
    broadcastCount: null,
    participantCount: 2,
    participants: [participant(IDS.teacher, "KONAN Enseignant")],
    lastMessageAt: NOW,
    lastPreview: "Voir la page 12",
    unreadCount: 0,
    archived: false,
    muted: false,
    starred: false,
    allowReplies: true,
    closed: false,
    ...over,
  };
}

export function message(over: Record<string, unknown> = {}) {
  return {
    id: IDS.msg,
    conversationId: IDS.conv,
    seq: 1,
    kind: "USER",
    senderId: IDS.teacher,
    senderName: "KONAN Enseignant",
    body: "Bonjour, voici les devoirs.",
    removed: false,
    removalKind: null,
    mine: false,
    systemCode: null,
    attachments: [],
    createdAt: NOW,
    ...over,
  };
}

export function conversationDetail(over: Record<string, unknown> = {}, conv: Record<string, unknown> = {}) {
  return {
    conversation: conversation(conv),
    participants: [participant(IDS.me, "Moi", { role: "OWNER" }), participant(IDS.teacher, "KONAN Enseignant")],
    canReply: true,
    replyBlockedReason: null,
    ...over,
  };
}

export function announcement(over: Record<string, unknown> = {}) {
  return {
    id: IDS.ann,
    title: "Réunion des parents",
    body: "La réunion aura lieu mardi à 17 h.",
    priority: "NORMAL",
    status: "PUBLISHED",
    authorId: uuid(9),
    authorName: "DIRECTION Marie",
    audiences: ["GUARDIANS"],
    targets: [{ kind: "CLASSROOM", ref: IDS.class6A }],
    requireAck: false,
    pinned: false,
    publishAt: null,
    expiresAt: null,
    publishedAt: NOW,
    withdrawnAt: null,
    expired: false,
    attachments: [],
    isRecipient: true,
    myReadAt: null,
    myAcknowledgedAt: null,
    stats: null,
    ...over,
  };
}

export function notification(over: Record<string, unknown> = {}) {
  return {
    id: uuid(700),
    category: "MESSAGE",
    title: "Nouveau message de KONAN Enseignant",
    body: "Devoirs de maths",
    link: `/v2/messages/${IDS.conv}`,
    occurrences: 1,
    createdAt: NOW,
    updatedAt: NOW,
    readAt: null,
    ...over,
  };
}

export const page = <T>(items: T[], nextCursor: string | null = null, extra: Record<string, unknown> = {}) => ({ items, nextCursor, ...extra });
