/**
 * Menus des portails famille et enseignant (`/v2/parent|student|teacher`) : fonctions PURES.
 *
 * Le menu est statique (les portails ont un nombre d'écrans fixe) mais jamais affiché sans droit : une entrée n'apparaît que
 * si l'utilisateur détient AU MOINS UNE de ses permissions et, le cas échéant, si la fonctionnalité de l'offre est active
 * (fail-closed : permissions inconnues = aucune entrée « métier »). Ces filtres servent à AFFICHER ; l'API reste la barrière.
 */

import { hasPermission } from "@/platform/auth/policies";
import type { MenuItem, MenuPortal } from "@/platform/navigation/types";

export type PortalKey = Extract<MenuPortal, "parent" | "student" | "teacher">;

export interface PortalEntry {
  key: string;
  /** Clé i18n sous `v2Portal.menu.<portail>`. */
  labelKey: string;
  href: string;
  /** Au moins une de ces permissions suffit ; vide = visible pour tout titulaire du portail. */
  anyPermission: readonly string[];
  feature?: string;
  icon?: string;
}

/** Racines des trois portails. */
export const PORTAL_ROOT: Readonly<Record<PortalKey, string>> = Object.freeze({ parent: "/v2/parent", student: "/v2/student", teacher: "/v2/teacher" });

/** Permission qui ouvre chaque portail (garde de layout) : le compte doit être tuteur / élève / membre du personnel. */
export const PORTAL_GUARD: Readonly<Record<PortalKey, readonly string[]>> = Object.freeze({
  parent: ["student.child.read"],
  student: ["student.self.read"],
  teacher: ["staff.own.read", "schedule.own.read"],
});

/** Points d'entrée de la messagerie : `/v2/messages` et `/v2/announcements`. */
export const MESSAGING_ENTRIES = {
  messages: "/v2/messages",
  announcements: "/v2/announcements",
} as const;

/**
 * Permission de lecture de la messagerie propre à chaque portail (module `messaging`) : l'entrée n'apparaît que si le
 * compte la détient, comme toute autre entrée du portail (plus de drapeau d'environnement). L'API reste la barrière.
 */
export const MESSAGING_READ_PERMISSION: Readonly<Record<PortalKey, string>> = Object.freeze({
  parent: "messaging.child.read",
  student: "messaging.self.read",
  teacher: "messaging.read",
});

const messaging = (portal: PortalKey, key: string, href: string, labelKey: string): PortalEntry => ({ key, href, labelKey, anyPermission: [MESSAGING_READ_PERMISSION[portal]], icon: "message" });

export const PARENT_ENTRIES: readonly PortalEntry[] = [
  { key: "parent.children", labelKey: "children", href: "/v2/parent", anyPermission: [], icon: "users" },
  messaging("parent", "parent.messages", MESSAGING_ENTRIES.messages, "messages"),
  messaging("parent", "parent.announcements", MESSAGING_ENTRIES.announcements, "announcements"),
  { key: "parent.account", labelKey: "account", href: "/v2/parent/account", anyPermission: [], icon: "settings" },
];

export const STUDENT_ENTRIES: readonly PortalEntry[] = [
  { key: "student.home", labelKey: "home", href: "/v2/student", anyPermission: ["student.self.read"], icon: "home" },
  { key: "student.results", labelKey: "results", href: "/v2/student/results", anyPermission: ["grade.self.read", "result.self.read"], icon: "bar-chart" },
  { key: "student.reportcards", labelKey: "reportcards", href: "/v2/student/reportcards", anyPermission: ["reportcard.self.read"], icon: "file" },
  { key: "student.schedule", labelKey: "schedule", href: "/v2/student/schedule", anyPermission: ["schedule.self.read"], icon: "calendar" },
  { key: "student.upcoming", labelKey: "upcoming", href: "/v2/student/upcoming", anyPermission: ["schedule.self.read"], icon: "clipboard" },
  { key: "student.attendance", labelKey: "attendance", href: "/v2/student/attendance", anyPermission: ["attendance.self.read"], icon: "clipboard" },
  { key: "student.finance", labelKey: "finance", href: "/v2/student/finance", anyPermission: ["finance.self.read"], icon: "wallet" },
  { key: "student.documents", labelKey: "documents", href: "/v2/student/documents", anyPermission: ["reportcard.self.read", "finance.self.read", "higher.self.read"], icon: "library" },
  messaging("student", "student.messages", MESSAGING_ENTRIES.messages, "messages"),
  messaging("student", "student.announcements", MESSAGING_ENTRIES.announcements, "announcements"),
  { key: "student.profile", labelKey: "profile", href: "/v2/student/profile", anyPermission: ["student.self.read"], icon: "settings" },
];

export const TEACHER_ENTRIES: readonly PortalEntry[] = [
  { key: "teacher.today", labelKey: "today", href: "/v2/teacher", anyPermission: ["schedule.own.read"], icon: "home" },
  { key: "teacher.classes", labelKey: "classes", href: "/v2/teacher/classes", anyPermission: ["staff.own.read"], icon: "school" },
  { key: "teacher.assessments", labelKey: "assessments", href: "/v2/teacher/assessments", anyPermission: ["assessment.read", "grade.read", "grade.enter"], icon: "book" },
  { key: "teacher.attendance", labelKey: "attendance", href: "/v2/teacher/attendance", anyPermission: ["attendance.take", "attendance.manage"], icon: "clipboard" },
  { key: "teacher.schedule", labelKey: "schedule", href: "/v2/teacher/schedule", anyPermission: ["schedule.own.read"], icon: "calendar" },
  { key: "teacher.payslips", labelKey: "payslips", href: "/v2/teacher/payslips", anyPermission: ["payroll.payslip.read_own"], icon: "wallet" },
  { key: "teacher.leaves", labelKey: "leaves", href: "/v2/teacher/leaves", anyPermission: ["attendance.own.read"], feature: "attendance.staff", icon: "user-cog" },
  messaging("teacher", "teacher.messages", MESSAGING_ENTRIES.messages, "messages"),
  messaging("teacher", "teacher.announcements", MESSAGING_ENTRIES.announcements, "announcements"),
  { key: "teacher.profile", labelKey: "profile", href: "/v2/teacher/profile", anyPermission: ["staff.own.read"], icon: "settings" },
];

export const PORTAL_ENTRIES: Readonly<Record<PortalKey, readonly PortalEntry[]>> = Object.freeze({
  parent: PARENT_ENTRIES,
  student: STUDENT_ENTRIES,
  teacher: TEACHER_ENTRIES,
});

export interface BuildPortalMenuInput {
  portal: PortalKey;
  /** Permissions détenues ; `null` tant qu'elles ne sont pas connues (aucune entrée soumise à permission n'est alors montrée). */
  permissions: readonly string[] | null;
  /** Fonctionnalités actives de l'offre ; `null` si inconnues. */
  features: readonly string[] | null;
  labelOf: (labelKey: string) => string;
}

export function buildPortalMenu({ portal, permissions, features, labelOf }: BuildPortalMenuInput): MenuItem[] {
  const out: MenuItem[] = [];
  PORTAL_ENTRIES[portal].forEach((entry, index) => {
    if (entry.anyPermission.length > 0) {
      if (!permissions || !entry.anyPermission.some((p) => hasPermission(permissions, p))) return;
    }
    if (entry.feature && !(features ?? []).includes(entry.feature)) return;
    out.push({ key: entry.key, label: labelOf(entry.labelKey), href: entry.href, permission: entry.anyPermission[0] ?? "", portal, ...(entry.icon ? { icon: entry.icon } : {}), order: index });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Sections d'un enfant (parent) : onglets de `/v2/parent/children/[childId]/*`
// ---------------------------------------------------------------------------

export interface ChildSection {
  key: string;
  /** Clé i18n sous `v2Portal.child.sections`. */
  labelKey: string;
  /** Segment de chemin après l'identifiant de l'enfant ("" = tableau de bord). */
  segment: string;
  anyPermission: readonly string[];
  feature?: string;
}

export const CHILD_SECTIONS: readonly ChildSection[] = [
  { key: "dashboard", labelKey: "dashboard", segment: "", anyPermission: ["student.child.read"] },
  { key: "results", labelKey: "results", segment: "results", anyPermission: ["grade.child.read", "result.child.read"] },
  { key: "reportcards", labelKey: "reportcards", segment: "reportcards", anyPermission: ["reportcard.child.read"] },
  { key: "attendance", labelKey: "attendance", segment: "attendance", anyPermission: ["attendance.child.read"] },
  { key: "schedule", labelKey: "schedule", segment: "schedule", anyPermission: ["schedule.child.read"] },
  { key: "upcoming", labelKey: "upcoming", segment: "upcoming", anyPermission: ["schedule.child.read"] },
  { key: "finance", labelKey: "finance", segment: "finance", anyPermission: ["finance.child.read"] },
  { key: "documents", labelKey: "documents", segment: "documents", anyPermission: ["reportcard.child.read", "finance.child.read", "higher.child.read"] },
  { key: "emergency", labelKey: "emergency", segment: "emergency", anyPermission: ["student.child.read"] },
];

export function childSectionHref(childId: string, segment: string): string {
  return segment ? `/v2/parent/children/${childId}/${segment}` : `/v2/parent/children/${childId}`;
}

/** Identifiant de l'enfant désigné par un chemin `/v2/parent/children/<id>[/…]`, sinon `null`. */
export function childIdFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/v2\/parent\/children\/([^/?#]+)/.exec(pathname ?? "");
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Même page pour un autre enfant : remplace l'identifiant dans le chemin, conserve la section. */
export function switchChildPath(pathname: string, nextChildId: string): string {
  const m = /^\/v2\/parent\/children\/[^/?#]+(\/.*)?$/.exec(pathname);
  if (!m) return childSectionHref(nextChildId, "");
  // Les sous-pages de détail (reçu d'une facture…) n'ont de sens que pour l'enfant d'origine : on revient à la section.
  const rest = (m[1] ?? "").split("/").filter(Boolean);
  return rest.length > 0 ? childSectionHref(nextChildId, rest[0]!) : childSectionHref(nextChildId, "");
}

export function visibleChildSections(permissions: readonly string[] | null, features: readonly string[] | null): ChildSection[] {
  return CHILD_SECTIONS.filter((s) => {
    if (!permissions || !s.anyPermission.some((p) => hasPermission(permissions, p))) return false;
    if (s.feature && !(features ?? []).includes(s.feature)) return false;
    return true;
  });
}
