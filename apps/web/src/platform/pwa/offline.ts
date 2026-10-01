/**
 * Page demandée avant la coupure, transmise par le service worker dans `/offline?from=<chemin>`.
 * Seul un chemin INTERNE est accepté (jamais d'URL absolue ni protocole implicite) : pas de redirection ouverte.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return "/";
  if (value === "/offline" || value.startsWith("/offline?") || value.startsWith("/offline/")) return "/";
  return value.slice(0, 512);
}
