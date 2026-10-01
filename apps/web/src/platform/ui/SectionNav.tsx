"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePermission } from "@/platform/access";

export interface SectionNavItem {
  href: string;
  label: string;
  /** Permission requise pour voir l'entrée (aucune : toujours visible). */
  permission?: string;
  /** Faire correspondre seulement le chemin exact (entrée « racine » de la section). */
  exact?: boolean;
}

function Item({ item, pathname }: { item: SectionNavItem; pathname: string }) {
  const { allowed } = usePermission(item.permission ?? "__none__");
  if (item.permission && !allowed) return null;
  const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10",
          active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
        )}
      >
        {item.label}
      </Link>
    </li>
  );
}

/** Navigation secondaire d'une section (onglets défilants sur mobile). */
export function SectionNav({ label, items }: { label: string; items: ReadonlyArray<SectionNavItem> }) {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label={label} className="mb-6 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1">
        {items.map((item) => (
          <Item key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}
