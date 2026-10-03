"use client";

import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MenuModule } from "./modules";
import { HeaderPopover } from "./HeaderPopover";
import { moduleLabel } from "./labels";

/**
 * Changement de module : une liste de liens (un par module accessible à l'utilisateur), le module courant marqué
 * `aria-current`. Masqué quand l'utilisateur n'a accès qu'à un seul module.
 */
export function ModuleSwitcher({ modules, activeKey }: { modules: readonly MenuModule[]; activeKey: string | null }) {
  const t = useTranslations("v2Shell");
  const tModules = useTranslations("v2Shell.modules");
  if (modules.length < 2) return null;
  return (
    <HeaderPopover label={t("switchModule")} icon={<LayoutGrid className="h-4 w-4" aria-hidden="true" />} hideLabelOnMobile>
      {({ close }) => (
        <ul className="space-y-0.5">
          {modules.map((m) => (
            <li key={m.key}>
              <Link
                href={m.href}
                onClick={close}
                aria-current={m.key === activeKey ? "true" : undefined}
                className={`flex min-h-11 items-center rounded-md px-3 py-2 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 ${m.key === activeKey ? "bg-accent font-semibold" : ""}`}
              >
                {moduleLabel(tModules, m.key)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HeaderPopover>
  );
}
