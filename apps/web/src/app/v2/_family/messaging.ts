import { isMessagingEnabled, MESSAGING_ENTRIES } from "@/platform/portal/menus";

/** Lien vers la messagerie (module livré à part) : `null` tant que son point d'entrée n'est pas activé (`NEXT_PUBLIC_V2_MESSAGING=1`). */
export function messagingEntry(kind: keyof typeof MESSAGING_ENTRIES, raw?: string): string | null {
  return isMessagingEnabled(raw ?? process.env.NEXT_PUBLIC_V2_MESSAGING) ? MESSAGING_ENTRIES[kind] : null;
}
