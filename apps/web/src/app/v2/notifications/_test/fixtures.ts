/** Fabriques de données de test des notifications : conformes aux contrats `strict()` (les réponses sont validées par Zod). */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const NOW = "2026-10-02T09:00:00.000Z";

export function delivery(over: Record<string, unknown> = {}) {
  return {
    id: uuid(1),
    createdAt: NOW,
    channel: "EMAIL",
    category: "FINANCE",
    templateCode: "payment_reminder",
    templateVersion: 0,
    sourceKind: "DUNNING",
    ruleKey: "dunning.default",
    status: "SENT",
    skipReason: null,
    urgent: false,
    recipient: "k***@gmail.com",
    recipientUserId: null,
    attempts: 1,
    maxAttempts: 5,
    availableAt: NOW,
    sentAt: NOW,
    errorCode: null,
    errorMessage: null,
    providerId: "smtp-123",
    cost: null,
    eventId: null,
    ...over,
  };
}

export const variable = (name: string, label: string, type = "string", required = true, sample = "exemple") => ({ name, label, type, required, sample });

export function catalogEntry(over: Record<string, unknown> = {}) {
  return {
    code: "convocation",
    label: "Convocation",
    description: "Convoque un parent ou un élève.",
    category: "ANNOUNCEMENT",
    variables: [variable("subject", "Objet de la convocation"), variable("date", "Date", "date", true, "2026-10-09"), variable("note", "Précision", "text", false)],
    channels: ["EMAIL", "SMS"],
    manual: true,
    ...over,
  };
}

export function templateView(over: Record<string, unknown> = {}) {
  return {
    code: "convocation",
    channel: "EMAIL",
    locale: "fr-CI",
    source: "SHIPPED",
    version: 0,
    enabled: true,
    subject: "Convocation : {{subject}}",
    body: "Bonjour, vous êtes convoqué le {{date}}.",
    variables: ["subject", "date"],
    updatedAt: null,
    ...over,
  };
}

export function ruleView(over: Record<string, unknown> = {}) {
  return {
    key: "dunning.default",
    label: "Relance des impayés",
    kind: "DUNNING",
    trigger: "dunning",
    source: "SHIPPED",
    custom: false,
    enabled: true,
    templateCode: "payment_reminder",
    audience: { kind: "STUDENT_GUARDIANS", financialFirst: true, fallbackToStudent: false },
    channels: ["EMAIL", "SMS"],
    strategy: "FIRST_REACHABLE",
    urgent: false,
    conditions: { stages: [7, 21, 45] },
    updatedAt: null,
    ...over,
  };
}

export function channelHealth(over: Record<string, unknown> = {}) {
  return {
    channel: "EMAIL",
    provider: "smtp",
    configured: true,
    enabled: true,
    state: "OK",
    missing: [],
    last24h: { sent: 12, failed: 1, bounced: 0, skipped: 2 },
    pending: 0,
    oldestPendingAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    dailyCap: 500,
    sentToday: 12,
    ...over,
  };
}

export function settings(over: Record<string, unknown> = {}) {
  return {
    enabledChannels: ["IN_APP", "EMAIL"],
    senderName: "Lycée Moderne",
    replyTo: null,
    timezone: "Africa/Abidjan",
    defaultDialCode: "225",
    quietHoursEnabled: true,
    quietStart: "21:00",
    quietEnd: "06:00",
    dailyCaps: { EMAIL: 500 },
    perRecipientDailyCap: 5,
    consentModels: { EMAIL: "IMPLIED", SMS: "EXPLICIT" },
    urgentBypassesRevocations: false,
    maxAttempts: 5,
    journalRetentionDays: 180,
    legalFooter: null,
    updatedAt: null,
    ...over,
  };
}

export function preferences(over: Record<string, unknown> = {}) {
  return {
    channels: [
      { channel: "EMAIL", available: true, enabled: true, consentModel: "IMPLIED", categories: { FINANCE: false } },
      { channel: "SMS", available: true, enabled: false, consentModel: "EXPLICIT", categories: {} },
      { channel: "WHATSAPP", available: false, enabled: false, consentModel: "EXPLICIT", categories: {} },
    ],
    quietHours: { enabled: true, start: "21:00", end: "06:00", inherited: true },
    urgentBypassesQuietHours: true,
    pushDevices: 0,
    ...over,
  };
}
