import { NOTIF_CATEGORIES, NOTIF_CHANNELS, NOTIF_DELIVERY_STATUSES, type NotifChannel, type NotifDeliveryStatus } from "@ecoledigitale/contracts/v2/notifications";
import type { Tone } from "@/platform/ui/PageHeader";

/** Permissions d'accès aux écrans d'administration (la barrière réelle reste l'API). */
export const READ = "notifications.read";
export const TEMPLATES = "notifications.templates.manage";
export const RULES = "notifications.rules.manage";
export const SETTINGS = "notifications.settings.manage";
export const SEND = "notifications.send";
export const SEND_URGENT = "notifications.send.urgent";
/** Envoi manuel : l'une ou l'autre (l'urgence est une permission sensible distincte). */
export const SEND_PERMISSIONS = [SEND, SEND_URGENT] as const;
/** Journal, règles et canaux : lecture suffit pour VOIR ; modifier exige la permission de gestion. */
export const VIEW_PERMISSIONS = [READ, TEMPLATES, RULES, SETTINGS] as const;
/** Gérer SES préférences : personnel, parent ou élève. */
export const SELF_PERMISSIONS = ["notifications.own.manage", "notifications.child.manage", "notifications.self.manage"] as const;

export const CHANNELS = NOTIF_CHANNELS;
export const CATEGORIES = NOTIF_CATEGORIES;
export const STATUSES = NOTIF_DELIVERY_STATUSES;

export const STATUS_TONE: Readonly<Record<NotifDeliveryStatus, Tone>> = {
  PENDING: "info",
  SENDING: "info",
  SENT: "success",
  DELIVERED: "success",
  FAILED: "danger",
  BOUNCED: "danger",
  SKIPPED: "neutral",
  CANCELLED: "neutral",
  SIMULATED: "warning",
};

/** Canaux dont l'objet (titre) est exigé par le gabarit. */
export const CHANNELS_WITH_SUBJECT: readonly NotifChannel[] = ["EMAIL", "PUSH", "IN_APP"];

/** `YYYY-MM-DD` -> début de journée UTC (filtre de période du journal). */
export const startOfDay = (day: string): string => `${day}T00:00:00.000Z`;
/** `YYYY-MM-DD` -> début du lendemain UTC (borne exclusive). */
export const endOfDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString();

/** Une liste de nombres saisie « 3, 10, 30 » -> `[3, 10, 30]` ; `null` si une valeur n'est pas un entier positif. */
export function parseStages(raw: string): number[] | null {
  const parts = raw.split(/[,\s;]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const out = parts.map(Number);
  return out.every((n) => Number.isInteger(n) && n >= 1) ? out : null;
}
