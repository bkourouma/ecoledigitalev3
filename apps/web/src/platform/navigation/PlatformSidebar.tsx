"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Award,
  BadgeCheck,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Check,
  CheckSquare,
  ChevronRight,
  Circle,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  Columns,
  CreditCard,
  DoorOpen,
  Download,
  FileBadge,
  FileCheck,
  FileEdit,
  FileSpreadsheet,
  FileText,
  Files,
  Folder,
  Gauge,
  Gavel,
  GitBranch,
  GraduationCap,
  History,
  Home,
  Landmark,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  Library,
  Link as LinkIcon,
  List,
  ListTree,
  Lock,
  Mail,
  Megaphone,
  MessageSquare,
  PenLine,
  Pencil,
  Radio,
  Receipt,
  Repeat,
  Scale,
  School,
  Settings,
  Settings2,
  Shield,
  ShieldCheck,
  Sliders,
  Smartphone,
  Stamp,
  Table,
  Tags,
  Upload,
  UserCheck,
  UserCog,
  UserPlus,
  UserRoundCog,
  Users,
  Wallet,
  Webhook,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { findActiveMenuKey, sortMenuItems, type MenuItem } from "./types";

/**
 * Noms d'icônes acceptés dans `MenuDef.icon` (kebab-case, noms lucide). Tous ceux que déclarent les manifestes de modules et les
 * portails y figurent ; un nom inconnu retombe sur l'icône du module, puis sur une pastille neutre.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  archive: Archive,
  award: Award,
  "badge-check": BadgeCheck,
  banknote: Banknote,
  "bar-chart": BarChart3,
  "bar-chart-3": BarChart3,
  bell: Bell,
  book: BookOpen,
  briefcase: Briefcase,
  building: Building2,
  calendar: Calendar,
  "calendar-clock": CalendarClock,
  "calendar-days": CalendarDays,
  "calendar-range": CalendarRange,
  chart: BarChart3,
  check: Check,
  "check-square": CheckSquare,
  clipboard: ClipboardList,
  "clipboard-check": ClipboardCheck,
  clock: Clock,
  columns: Columns,
  "credit-card": CreditCard,
  dashboard: LayoutDashboard,
  "door-open": DoorOpen,
  download: Download,
  edit: Pencil,
  file: FileText,
  "file-badge": FileBadge,
  "file-check": FileCheck,
  "file-pen": FileEdit,
  "file-spreadsheet": FileSpreadsheet,
  "file-text": FileText,
  files: Files,
  folder: Folder,
  gauge: Gauge,
  gavel: Gavel,
  "git-branch": GitBranch,
  "graduation-cap": GraduationCap,
  "hand-coins": Coins,
  history: History,
  home: Home,
  landmark: Landmark,
  layers: Layers,
  "layout-dashboard": LayoutDashboard,
  "layout-template": LayoutTemplate,
  library: Library,
  link: LinkIcon,
  list: List,
  "list-tree": ListTree,
  lock: Lock,
  mail: Mail,
  megaphone: Megaphone,
  message: MessageSquare,
  "pen-line": PenLine,
  radio: Radio,
  receipt: Receipt,
  repeat: Repeat,
  scale: Scale,
  school: School,
  settings: Settings,
  "settings-2": Settings2,
  shield: Shield,
  "shield-check": ShieldCheck,
  sliders: Sliders,
  smartphone: Smartphone,
  stamp: Stamp,
  table: Table,
  tags: Tags,
  upload: Upload,
  "user-check": UserCheck,
  "user-cog": UserCog,
  "user-plus": UserPlus,
  "user-round-cog": UserRoundCog,
  users: Users,
  wallet: Wallet,
  webhook: Webhook,
  workflow: Workflow,
};

export function iconFor(name: string | undefined, fallback?: string): LucideIcon {
  return (name && ICONS[name]) || (fallback && ICONS[fallback]) || Circle;
}

export interface SidebarGrouping {
  moduleOf: (item: MenuItem) => string;
  labelOf: (moduleKey: string) => string;
  /** En dessous de ce nombre d'entrées la liste reste plate (défaut 12). */
  minItems?: number;
  /** Icône d'un module (en-tête du groupe, et icône de repli des entrées qui n'en déclarent pas). */
  iconOf?: (moduleKey: string) => string | undefined;
  /**
   * Catégorie d'un module : les groupes sont rangés sous des titres de catégorie (non repliables), dans l'ordre de `order`.
   * Sans cette option, les groupes de module se suivent sans titre.
   */
  categoryOf?: (moduleKey: string) => { key: string; label: string };
  /** Ordre des clés de catégorie ; une catégorie absente de la liste passe en dernier. */
  categoryOrder?: readonly string[];
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
  /**
   * Regroupement par module (coque de gestion : une centaine d'entrées) : un groupe repliable par module, celui de la page
   * courante ouvert. Sans cette option, liste plate (portails famille et enseignant).
   */
  grouping?: SidebarGrouping;
}

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

function SidebarLink({ item, active, onNavigate, fallbackIcon, nested }: { item: MenuItem; active: boolean; onNavigate?: () => void; fallbackIcon?: string; nested?: boolean }) {
  const Icon = iconFor(item.icon, fallbackIcon);
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`relative flex min-h-10 items-start gap-3 rounded-lg px-3 py-2 text-[13px] leading-snug transition-colors ${FOCUS} ${
          active
            ? "bg-white/10 font-medium text-white before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--brand-primary,#8b5cf6)]"
            : "text-gray-300 hover:bg-white/5 hover:text-white"
        }`}
      >
        <Icon className={`mt-px shrink-0 ${nested ? "h-4 w-4" : "h-5 w-5"} ${active ? "text-white" : "text-gray-400"}`} aria-hidden="true" />
        {/* Libellé long : jusqu'à deux lignes, puis points de suspension (le titre complet reste en infobulle). */}
        <span className="line-clamp-2 min-w-0 break-words" title={item.label}>
          {item.label}
        </span>
      </Link>
    </li>
  );
}

interface SidebarGroup {
  key: string;
  label: string;
  items: MenuItem[];
}

interface SidebarSection {
  key: string;
  label: string | null;
  groups: SidebarGroup[];
}

/**
 * Sidebar générée depuis le menu de l'API. Petite, accessible (landmark `nav`, `aria-current`, focus visible, cibles
 * tactiles >= 40px) et pensée mobile-first : elle remplit son conteneur, le tiroir mobile est géré par la coque.
 */
export function PlatformSidebar({ items, label = "Navigation principale", onNavigate, onClose, activePath, isLoading, grouping }: PlatformSidebarProps) {
  const currentPath = usePathname();
  const sorted = sortMenuItems(items);
  const activeKey = findActiveMenuKey(sorted, activePath ?? currentPath);

  const grouped = grouping && sorted.length >= (grouping.minItems ?? 12);
  const sections = useMemo<SidebarSection[]>(() => {
    if (!grouping || !grouped) return [];
    const byModule = new Map<string, MenuItem[]>();
    for (const item of sorted) {
      const key = grouping.moduleOf(item);
      byModule.set(key, [...(byModule.get(key) ?? []), item]);
    }
    const groups: (SidebarGroup & { category: { key: string; label: string } | null })[] = [...byModule].map(([key, list]) => ({
      key,
      label: grouping.labelOf(key),
      items: list,
      category: grouping.categoryOf ? grouping.categoryOf(key) : null,
    }));
    if (!grouping.categoryOf) return [{ key: "_", label: null, groups }];
    const order = grouping.categoryOrder ?? [];
    const rank = (key: string) => (order.indexOf(key) === -1 ? order.length : order.indexOf(key));
    const bySection = new Map<string, SidebarSection>();
    for (const g of groups) {
      const cat = g.category!;
      const section = bySection.get(cat.key) ?? { key: cat.key, label: cat.label, groups: [] };
      section.groups.push({ key: g.key, label: g.label, items: g.items });
      bySection.set(cat.key, section);
    }
    return [...bySection.values()].sort((a, b) => rank(a.key) - rank(b.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sorted` est recalculé à chaque rendu ; on dépend des entrées
  }, [items, grouped, grouping?.moduleOf, grouping?.labelOf, grouping?.categoryOf, grouping?.categoryOrder]);
  const activeGroup = sections.flatMap((s) => s.groups).find((g) => g.items.some((i) => i.key === activeKey))?.key ?? null;
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  // Naviguer vers un autre module ouvre son groupe (les groupes ouverts à la main le restent).
  useEffect(() => {
    if (activeGroup) setOpened((prev) => (prev.has(activeGroup) ? prev : new Set([...prev, activeGroup])));
  }, [activeGroup]);
  const toggle = (key: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex h-full flex-col border-r border-white/5 bg-gray-900" data-testid="platform-sidebar">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-emerald-600 shadow-md shadow-black/30" aria-hidden="true">
            <span className="text-xs font-bold text-white">ED</span>
          </div>
          <span className="text-sm font-semibold tracking-tight text-white">EcoleDigitale</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-400 hover:bg-gray-800 hover:text-white md:hidden ${FOCUS}`}
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav aria-label={label} aria-busy={isLoading || undefined} className="custom-scrollbar flex-1 overflow-y-auto px-3 py-3">
        {isLoading && sorted.length === 0 ? (
          <ul className="space-y-1" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="h-10 animate-pulse rounded-lg bg-gray-800" />
            ))}
          </ul>
        ) : grouped ? (
          <div className="space-y-1">
            {sections.map((section) => (
              <div key={section.key} className="pb-1">
                {section.label ? (
                  <p className="flex items-center gap-2 px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-gray-500" role="presentation">
                    {section.label}
                    <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {section.groups.map((group) => {
                    const open = opened.has(group.key);
                    const panelId = `sidebar-group-${group.key}`;
                    const isActive = group.key === activeGroup;
                    const GroupIcon = iconFor(grouping?.iconOf?.(group.key));
                    return (
                      <li key={group.key}>
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={panelId}
                          onClick={() => toggle(group.key)}
                          className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${FOCUS} ${
                            isActive ? "text-white" : "text-gray-300 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          <GroupIcon className={`h-5 w-5 shrink-0 ${isActive ? "text-[var(--brand-primary,#a78bfa)]" : "text-gray-400"}`} aria-hidden="true" />
                          <span className="min-w-0 flex-1 leading-snug">{group.label}</span>
                          <ChevronRight className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
                        </button>
                        {open ? (
                          <ul id={panelId} className="mb-1 ml-5 space-y-0.5 border-l border-white/10 pl-2 pt-0.5">
                            {group.items.map((item) => (
                              <SidebarLink key={item.key} item={item} active={item.key === activeKey} onNavigate={onNavigate} fallbackIcon={grouping?.iconOf?.(group.key)} nested />
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sorted.map((item) => (
              <SidebarLink key={item.key} item={item} active={item.key === activeKey} onNavigate={onNavigate} />
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}
