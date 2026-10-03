"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, LoadingBlock } from "@/platform/ui/states";
import { useShellBranding } from "./branding";
import { useShellMenu } from "./context";
import { moduleLabel } from "./labels";
import { groupByModule } from "./modules";

/**
 * Accueil de gestion (`/v2/home`) : une carte par module avec les écrans auxquels le rôle donne accès. Les raccourcis viennent
 * du menu de la coque (déjà filtré par permissions et fonctionnalités de l'offre) : aucun lien vers un écran refusé. Atterrissage
 * des rôles sans tableau de bord propre ; dans un portail famille ou enseignant, la liste plate du portail.
 */
export function HomeScreen() {
  const t = useTranslations("v2Shell.homePage");
  const tModules = useTranslations("v2Shell.modules");
  const menu = useShellMenu();
  const branding = useShellBranding();

  const title = branding.name ? `${t("title")} · ${branding.name}` : t("title");
  if (!menu || menu.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} description={t("description")} />
        <LoadingBlock label={t("loading")} />
      </div>
    );
  }
  const modules = menu.kind === "management" ? groupByModule(menu.items) : [{ key: "portal", items: [...menu.items], href: menu.items[0]?.href ?? "/" }];
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={t("description")} />
      {modules.length === 0 ? (
        <EmptyBlock title={t("empty")} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("title")}>
          {modules.map((m) => {
            const label = menu.kind === "management" ? moduleLabel(tModules, m.key) : t("title");
            return (
              <li key={m.key} className="rounded-lg border p-4">
                <h2 className="text-base font-semibold">
                  <Link href={m.href} className="underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2">
                    {label}
                  </Link>
                </h2>
                <ul aria-label={t("moduleLinks", { module: label })} className="mt-3 flex flex-col gap-1">
                  {m.items.slice(0, 8).map((item) => (
                    <li key={item.key}>
                      <Link href={item.href} className={`${buttonClass.ghost} w-full justify-start`}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
