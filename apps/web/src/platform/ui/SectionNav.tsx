"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePermission } from "@/platform/access";
import { useShellMenu } from "@/platform/shell/context";

export interface SectionNavItem {
  href: string;
  label: string;
  /** Permission requise pour voir l'entrée (aucune : toujours visible). */
  permission?: string;
  /** Faire correspondre seulement le chemin exact (entrée « racine » de la section). */
  exact?: boolean;
  /** Au moins une de ces permissions suffit (liste constante de l'écran : nombre de hooks fixe). */
  anyPermission?: ReadonlyArray<string>;
}

function AnyOf({ permissions, children }: { permissions: ReadonlyArray<string>; children: ReactNode }) {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- la liste est une constante de l'écran
  const allowed = permissions.map((p) => usePermission(p).allowed).some(Boolean);
  return allowed ? <>{children}</> : null;
}

function Item({ item, pathname }: { item: SectionNavItem; pathname: string }) {
  const { allowed } = usePermission(item.permission ?? "__none__");
  if (item.permission && !allowed) return null;
  if (item.anyPermission && item.anyPermission.length > 0) {
    return (
      <AnyOf permissions={item.anyPermission}>
        <ItemLink item={item} pathname={pathname} />
      </AnyOf>
    );
  }
  return <ItemLink item={item} pathname={pathname} />;
}

function ItemLink({ item, pathname }: { item: SectionNavItem; pathname: string }) {
  const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "inline-flex h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10",
          active ? "bg-primary/20 text-violet-200 ring-1 ring-primary/40" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
        )}
      >
        {item.label}
      </Link>
    </li>
  );
}

/**
 * Navigation secondaire d'une section (onglets défilants sur mobile).
 *
 * Dans la coque de GESTION, le menu latéral porte déjà toutes les destinations : ces onglets n'y sont pas rendus. Ils restent dans
 * les portails (parent, élève, enseignant), dont le menu est court, et pour les vrais sous-onglets d'un écran (`persistent`).
 */
export function SectionNav({ label, items, persistent = false }: { label: string; items: ReadonlyArray<SectionNavItem>; persistent?: boolean }) {
  const pathname = usePathname() ?? "";
  const shell = useShellMenu();
  if (!persistent && shell?.kind === "management") return null;
  return (
    <nav aria-label={label} className="mb-6 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex min-w-max gap-1.5 rounded-full border border-white/10 bg-card/40 p-1">
        {items.map((item) => (
          <Item key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}
