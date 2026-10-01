/**
 * Configuration serveur de next-intl (référencée par `createNextIntlPlugin` dans next.config.js).
 * Permet d'utiliser `getTranslations()` / `getMessages()` dans les server components, toujours sans
 * préfixe d'URL.
 */

import { getRequestConfig } from "next-intl/server";
import { DEFAULT_TIME_ZONE, resolveLocale } from "./config";
import { getMessages } from "./messages";

export default getRequestConfig(async () => {
  const locale = resolveLocale();
  return { locale, messages: getMessages(locale), timeZone: DEFAULT_TIME_ZONE };
});
