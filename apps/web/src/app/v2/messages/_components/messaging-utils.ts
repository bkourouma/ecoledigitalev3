/** Fonctions pures de l'interface de messagerie (aucune règle d'autorisation : l'API décide). */
import type { Tone } from "@/platform/ui/PageHeader";

export const READ_PERMISSIONS = ["messaging.read", "messaging.child.read", "messaging.self.read"] as const;
export const ANNOUNCE_PERMISSIONS = ["messaging.announcement.publish", "messaging.announcement.publish_class", "messaging.announcement.manage"] as const;

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export function priorityTone(priority: string): Tone {
  return priority === "URGENT" ? "danger" : priority === "HIGH" ? "warning" : priority === "LOW" ? "neutral" : "info";
}

/** Noms des autres participants d'un fil, pour la liste (le fil lui-même peut en compter plus). */
export function participantsLabel(participants: ReadonlyArray<{ displayName: string }>, count: number): string {
  const names = participants.map((p) => p.displayName);
  if (names.length === 0) return "";
  const extra = count - 1 - names.length;
  return extra > 0 ? `${names.slice(0, 3).join(", ")} +${extra}` : names.slice(0, 3).join(", ");
}

/** Taille lisible d'une pièce (« 1,2 Mo »). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

/** Identifiant d'idempotence d'un envoi (un réessai du client ne double pas le message). */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

/** Convertit une valeur `datetime-local` (heure locale du navigateur) en instant ISO ; `undefined` si vide ou invalide. */
export function localToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Instant ISO -> valeur `datetime-local` (heure locale). */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
