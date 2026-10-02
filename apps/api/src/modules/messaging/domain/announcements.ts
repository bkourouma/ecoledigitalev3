/**
 * Règles pures des annonces : normalisation des cibles, états, expiration dérivée, droits de publication.
 */
import type { CallerCaps, MessagingAudience, MessagingTarget, Uuid } from "./types";

export type AnnouncementStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "WITHDRAWN";

/** Cible normalisée telle que stockée : `ref` vaut « » pour `TENANT`. */
export interface StoredTarget {
  readonly kind: MessagingTarget["kind"];
  readonly ref: string;
}

/** Normalise, dédoublonne et trie les cibles (la même sélection donne la même liste). `TENANT` couvre tout : elle écarte les autres. */
export function normalizeTargets(targets: readonly MessagingTarget[]): StoredTarget[] {
  const map = new Map<string, StoredTarget>();
  for (const t of targets) {
    const ref = t.kind === "TENANT" ? "" : (t.ref ?? "").toLowerCase();
    map.set(`${t.kind}:${ref}`, { kind: t.kind, ref });
  }
  const list = [...map.values()];
  if (list.some((t) => t.kind === "TENANT")) return list.filter((t) => t.kind === "TENANT" || t.kind === "ROLE");
  return list.sort((a, b) => (a.kind === b.kind ? a.ref.localeCompare(b.ref) : a.kind.localeCompare(b.kind)));
}

export function normalizeAudiences(audiences: readonly MessagingAudience[]): MessagingAudience[] {
  const order: MessagingAudience[] = ["STUDENTS", "GUARDIANS", "STAFF"];
  return order.filter((a) => audiences.includes(a));
}

/** Une annonce est expirée quand `expires_at ≤ maintenant` (dérivé : aucun job ne la modifie). */
export const isExpired = (expiresAt: Date | null, now: Date): boolean => expiresAt !== null && expiresAt.getTime() <= now.getTime();

/** Visible d'un destinataire : publiée, et non expirée sauf demande explicite d'historique. */
export const visibleToRecipient = (a: { status: AnnouncementStatus; expiresAt: Date | null }, now: Date, includeExpired: boolean): boolean =>
  a.status === "PUBLISHED" && (includeExpired || !isExpired(a.expiresAt, now));

/** Contenu modifiable librement tant que l'annonce n'est pas publiée. */
export const isContentEditable = (status: AnnouncementStatus): boolean => status === "DRAFT" || status === "SCHEDULED";

/** Droit de publier vers ces cibles (spec §6) : `publish` toute cible ; `publish_class` classes affectées, élèves / tuteurs. */
export type PublishDecision = { ok: true } | { ok: false; reason: "NO_PERMISSION" | "TARGET_NOT_ALLOWED" | "AUDIENCE_NOT_ALLOWED" };

export function canPublishTo(
  caps: CallerCaps,
  teachingClassroomIds: readonly Uuid[],
  targets: readonly StoredTarget[],
  audiences: readonly MessagingAudience[],
): PublishDecision {
  if (caps.announcementPublish || caps.announcementManage) return { ok: true };
  if (!caps.announcementPublishClass) return { ok: false, reason: "NO_PERMISSION" };
  if (targets.length === 0 || targets.some((t) => t.kind !== "CLASSROOM" || !teachingClassroomIds.includes(t.ref))) return { ok: false, reason: "TARGET_NOT_ALLOWED" };
  if (audiences.includes("STAFF")) return { ok: false, reason: "AUDIENCE_NOT_ALLOWED" };
  return { ok: true };
}

/** L'état cible d'une publication : programmée si `publishAt` est dans le futur. */
export function publicationOutcome(publishAt: Date | null, now: Date): "PUBLISHED" | "SCHEDULED" {
  return publishAt !== null && publishAt.getTime() > now.getTime() ? "SCHEDULED" : "PUBLISHED";
}
