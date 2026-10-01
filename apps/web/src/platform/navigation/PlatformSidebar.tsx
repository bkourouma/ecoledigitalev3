"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Building2,
  Calendar,
  ClipboardList,
  CreditCard,
  FileText,
  GraduationCap,
  Home,
  LayoutDashboard,
  Library,
  MessageSquare,
  School,
  Settings,
  Shield,
  UserCog,
  Users,
  Wallet,
  X,
  Circle,
  type LucideIcon,
} from "lucide-react";
import { findActiveMenuKey, sortMenuItems, type MenuItem } from "./types";

/** Noms d'icônes acceptés dans `MenuDef.icon` (kebab-case). Inconnu -> pastille neutre. */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  "bar-chart": BarChart3,
  book: BookOpen,
  building: Building2,
  calendar: Calendar,
  clipboard: ClipboardList,
  "credit-card": CreditCard,
  file: FileText,
  "graduation-cap": GraduationCap,
  home: Home,
  dashboard: LayoutDashboard,
  library: Library,
  message: MessageSquare,
  school: School,
  settings: Settings,
  shield: Shield,
  "user-cog": UserCog,
  users: Users,
  wallet: Wallet,
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name && ICONS[name]) || Circle;
}

export interface PlatformSidebarProps {
  items: readonly MenuItem[];
  /** Libellé accessible de la navigation. */
  label?: string;
  /** Appelé après un clic sur un lien (fermeture du tiroir mobile). */
  onNavigate?: () => void;
  /** Bouton de fermeture mobile (affiché sous `md`). */
  onClose?: () => void;
  /** Surcharge du chemin courant (tests) ; défaut : `usePathname()`. */
  activePath?: string | null;
  isLoading?: boolean;
}

/**
 * Sidebar générée depuis le menu de l'API. Petite, sans état, accessible (landmark `nav`, `aria-current`,
 * focus visible, cibles tactiles >= 44px) et pensée mobile-first : elle remplit son conteneur, le tiroir
 * mobile reste géré par `components/layout/Layout.tsx`.
 */
export function PlatformSidebar({ items, label = "Navigation principale", onNavigate, onClose, activePath, isLoading }: PlatformSidebarProps) {
  const currentPath = usePathname();
  const sorted = sortMenuItems(items);
  const activeKey = findActiveMenuKey(sorted, activePath ?? currentPath);

  return (
    <div className="h-full bg-gray-900 flex flex-col" data-testid="platform-sidebar">
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-blue-600 to-emerald-600 flex items-center justify-center" aria-hidden="true">
            <span className="text-white text-xs">ED</span>
          </div>
          <span className="text-white text-xs tracking-wide">EcoleDigitale</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-400 hover:bg-gray-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav aria-label={label} aria-busy={isLoading || undefined} className="flex-1 overflow-y-auto px-2 py-4">
        {isLoading && sorted.length === 0 ? (
          <ul className="space-y-1" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="h-11 animate-pulse rounded-md bg-gray-800" />
            ))}
          </ul>
        ) : (
          <ul className="space-y-1">
            {sorted.map((item) => {
              const Icon = iconFor(item.icon);
              const active = item.key === activeKey;
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                      active ? "bg-gray-800 text-white" : "text-gray-300 hover:bg-gray-800 hover:text-white"
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
