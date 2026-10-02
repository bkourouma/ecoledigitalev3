"use client";

import { usePermission } from "@/platform/access";
import { MESSAGING_ENTRIES, MESSAGING_READ_PERMISSION } from "@/platform/portal/menus";

/**
 * Lien vers la messagerie pour un portail famille : `null` tant que le compte ne détient pas la permission de lecture de
 * la messagerie (parent : `messaging.child.read`, élève : `messaging.self.read`). Plus de drapeau d'environnement :
 * l'accès suit le même contrôle que le reste du portail (l'API reste la barrière).
 */
export function useMessagingEntry(kind: keyof typeof MESSAGING_ENTRIES, portal: "parent" | "student"): string | null {
  const { allowed } = usePermission(MESSAGING_READ_PERMISSION[portal]);
  return allowed ? MESSAGING_ENTRIES[kind] : null;
}
