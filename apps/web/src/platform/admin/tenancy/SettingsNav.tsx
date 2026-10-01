"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const SECTIONS = [
  { key: "profile", href: "/v2/settings" },
  { key: "institutions", href: "/v2/settings/institutions" },
  { key: "onboarding", href: "/v2/settings/onboarding" },
  { key: "subscription", href: "/v2/settings/subscription" },
] as const;

/** Sous-navigation de `/v2/settings/*` : liens (pas d'onglets ARIA : chaque section est une page), défilement horizontal en mobile. */
export function SettingsNav({ activePath }: { activePath?: string | null }) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const current = activePath ?? pathname ?? "";
  // La section la plus spécifique gagne (`/v2/settings` est préfixe des autres).
  const active = [...SECTIONS].sort((a, b) => b.href.length - a.href.length).find((s) => current === s.href || current.startsWith(`${s.href}/`));

  return (
    <nav aria-label={t("navLabel")} className="mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b">
        {SECTIONS.map((section) => {
          const isActive = active?.key === section.key;
          return (
            <li key={section.key}>
              <Link
                href={section.href}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  isActive ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`nav.${section.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
