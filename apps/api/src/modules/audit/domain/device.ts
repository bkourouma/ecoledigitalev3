/**
 * Libellé d'appareil lisible, déduit du User-Agent (heuristique volontairement simple :
 * c'est une aide à l'enquête, pas une preuve ; le User-Agent brut est conservé à part).
 */
export function describeDevice(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;

  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Android/i.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/i.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /CrOS/i.test(ua)
            ? "ChromeOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : null;

  const browser = /Edg(e|A|iOS)?\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/i.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : /curl|wget|python|node|axios|okhttp|postman/i.test(ua)
              ? "Script"
              : null;

  const kind = /Mobile|iPhone|Android.*Mobile/i.test(ua) ? "mobile" : /iPad|Tablet/i.test(ua) ? "tablette" : "poste";

  const parts = [browser, os].filter(Boolean);
  if (parts.length === 0) return null;
  return `${parts.join(" / ")} (${kind})`.slice(0, 200);
}
