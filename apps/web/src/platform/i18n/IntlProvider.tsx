"use client";

import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { DEFAULT_TIME_ZONE, resolveLocale } from "./config";
import { getMessages } from "./messages";

/**
 * Fournit les traductions aux composants clients (`useTranslations`). Branché dans `app/providers.tsx` ;
 * aucune page existante n'est modifiée : tant qu'une page n'appelle pas `useTranslations`, rien ne change.
 */
export function IntlProvider({ children, locale: requested }: { children: ReactNode; locale?: string }) {
  const locale = resolveLocale(requested);
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={getMessages(locale)}
      timeZone={DEFAULT_TIME_ZONE}
      onError={(error) => {
        // Une clé manquante ne doit jamais casser une page : on journalise en développement seulement.
        if (process.env.NODE_ENV !== "production") console.warn("[i18n]", error.message);
      }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
