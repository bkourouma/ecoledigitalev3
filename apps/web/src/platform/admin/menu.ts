/**
 * Menu des écrans d'administration v2 (fonctions pures).
 *
 * Source de vérité : `GET /api/v1/rbac/me/navigation` (filtré par permissions et droits du tenant). Les manifestes de
 * modules pointent encore vers les routes de l'ancien back-office (`/admin/roles`…) ; `mapToV2Href` les réécrit vers
 * les routes `/v2/...`. Les entrées v2 que l'API ne renvoie pas (module sans `menus`, ex. tenancy) sont ajoutées
 * localement MAIS seulement si la permission est détenue (jamais d'entrée pour une action refusée).
 */

import { hasPermission } from "@/platform/auth/policies";
import { sortMenuItems, type MenuItem } from "@/platform/navigation/types";

/** Routes historiques des manifestes -> routes v2. */
export const LEGACY_TO_V2_HREF: Readonly<Record<string, string>> = Object.freeze({
  "/admin/roles": "/v2/access/roles",
  "/admin/roles/attributions": "/v2/access/assignments",
  "/admin/audit": "/v2/audit",
  // Finance (écrans `app/v2/finance`) et paie (`app/v2/payroll`).
  "/admin/finance/factures": "/v2/finance/invoices",
  "/admin/finance/paiements": "/v2/finance/payments",
  "/admin/finance/paiements-en-ligne": "/v2/finance/payments/online",
  "/admin/finance/caisse": "/v2/finance/cash",
  "/admin/finance/frais": "/v2/finance/fees",
  "/admin/finance/rapports": "/v2/finance/reports",
  "/admin/finance/affectes-etat": "/v2/finance/funding",
  "/admin/finance/fournisseurs": "/v2/finance/providers",
  "/admin/paie": "/v2/payroll",
  "/admin/paie/configuration": "/v2/payroll/configuration",
  "/admin/paie/historique": "/v2/payroll/history",
  "/admin/paie/rapports": "/v2/payroll/reports",
  "/owner/masse-salariale": "/v2/payroll/owner",
  "/enseignant/remuneration": "/v2/payroll/my",
  // Présences et emploi du temps (manifestes `attendance` et `scheduling`).
  "/admin/attendance": "/v2/attendance/sessions",
  "/admin/attendance/justificatifs": "/v2/attendance/justifications",
  "/admin/attendance/personnel": "/v2/attendance/staff",
  "/admin/emploi-du-temps": "/v2/schedule/timetables",
  "/admin/emploi-du-temps/salles": "/v2/schedule/rooms",
  "/admin/emploi-du-temps/remplacements": "/v2/schedule/replacements",
  // Personnes, académique, évaluations, résultats, bulletins, règles, supérieur, admissions : sans cette réécriture, les entrées
  // du portail admin menaient à des routes sans page (404 constaté au balayage QA).
  // Utilisateurs : l'ancienne page `/admin/utilisateurs` s'affichait blanche (appels `/api/v1/admin/access/*` en 404) ; l'écran v2 est « Membres ».
  "/admin/utilisateurs": "/v2/admin/members",
  "/admin/eleves": "/v2/students",
  "/admin/parents": "/v2/guardians",
  "/admin/personnel": "/v2/staff",
  "/admin/affectations": "/v2/staff/assignments",
  "/admin/academique/annees": "/v2/academic/years",
  "/admin/academique/programmes": "/v2/academic/programs",
  "/admin/academique/curriculum": "/v2/academic/curriculum",
  "/admin/academique/classes": "/v2/academic/classrooms",
  "/admin/academique/offres": "/v2/academic/offerings",
  "/admin/academique/inscriptions": "/v2/enrollments",
  "/admin/academique/reconduction": "/v2/academic/rollover",
  "/admin/academique/parametres": "/v2/academic/settings",
  "/admin/notes/relecture": "/v2/assessments?status=SUBMITTED",
  "/admin/notes/corrections": "/v2/assessments/revisions",
  "/admin/notes/types": "/v2/assessments/types",
  "/admin/resultats": "/v2/results",
  "/admin/periodes": "/v2/results",
  "/admin/deliberations": "/v2/results/decisions",
  "/admin/bulletins": "/v2/reportcards",
  "/admin/bulletins/emission": "/v2/reportcards/issue",
  "/admin/bulletins/identite": "/v2/reportcards/identity",
  "/admin/bulletins/modeles": "/v2/reportcards/templates",
  "/admin/regles": "/v2/rules",
  "/admin/higher/diplomes": "/v2/higher/diplomas",
  "/admin/higher/documents": "/v2/higher/documents",
  "/admin/higher/rattrapages": "/v2/higher/resit",
  "/admin/higher/prerequis": "/v2/higher/prerequisites",
  "/admin/higher/signataires": "/v2/higher/signatories",
  "/admin/higher/dispenses": "/v2/higher/exemptions",
  "/admin/higher/ue-annuelles": "/v2/higher/annual-ues",
  "/v2/admissions/workflow": "/v2/admissions/settings/workflow",
});

export function mapToV2Href(href: string): string {
  return LEGACY_TO_V2_HREF[href] ?? href;
}

/** Entrées v2 « de secours » : portées par l'API quand le module déclare un menu, sinon ajoutées si permises. */
export const V2_ADMIN_ENTRIES: readonly (MenuItem & { labelKey: string; anyPermission?: readonly string[] })[] = [
  { key: "v2.settings", labelKey: "settings", label: "settings", href: "/v2/settings", permission: "tenancy.institution.read", portal: "admin", icon: "settings", order: 800 },
  { key: "v2.access.roles", labelKey: "roles", label: "roles", href: "/v2/access/roles", permission: "rbac.role.read", portal: "admin", icon: "shield", order: 900 },
  { key: "v2.access.assignments", labelKey: "assignments", label: "assignments", href: "/v2/access/assignments", permission: "rbac.assignment.manage", portal: "admin", icon: "user-cog", order: 910 },
  { key: "v2.analytics.freshness", labelKey: "freshness", label: "freshness", href: "/v2/owner/fraicheur", permission: "analytics.read", feature: "analytics.direction", portal: "admin", icon: "clock", order: 90 },
  // Destinations qui n'étaient atteignables que par les onglets des écrans (supprimés dans la coque de gestion) : le menu latéral les porte.
  { key: "v2.attendance.call", labelKey: "attendance_call", label: "attendance_call", href: "/v2/attendance/call", permission: "attendance.take", portal: "admin", icon: "clipboard-check", order: 301 },
  { key: "v2.attendance.dashboard", labelKey: "attendance_dashboard", label: "attendance_dashboard", href: "/v2/attendance", permission: "attendance.read", portal: "admin", icon: "layout-dashboard", order: 302 },
  { key: "v2.attendance.absences", labelKey: "attendance_absences", label: "attendance_absences", href: "/v2/attendance/absences", permission: "attendance.report.read", portal: "admin", icon: "users", order: 342 },
  { key: "v2.attendance.compliance", labelKey: "attendance_compliance", label: "attendance_compliance", href: "/v2/attendance/compliance", permission: "attendance.report.read", portal: "admin", icon: "clipboard", order: 344 },
  { key: "v2.attendance.alerts", labelKey: "attendance_alerts", label: "attendance_alerts", href: "/v2/attendance/alerts", permission: "attendance.read", portal: "admin", icon: "bell", order: 346 },
  { key: "v2.attendance.conflicts", labelKey: "attendance_conflicts", label: "attendance_conflicts", href: "/v2/attendance/conflicts", permission: "attendance.manage", portal: "admin", icon: "git-branch", order: 348 },
  { key: "v2.scheduling.timetable", labelKey: "scheduling_timetable", label: "scheduling_timetable", href: "/v2/schedule", permission: "schedule.read", portal: "admin", icon: "calendar-days", order: 291 },
  { key: "v2.scheduling.occurrences", labelKey: "scheduling_occurrences", label: "scheduling_occurrences", href: "/v2/schedule/occurrences", permission: "schedule.read", portal: "admin", icon: "calendar", order: 342 },
  { key: "v2.scheduling.generator", labelKey: "scheduling_generator", label: "scheduling_generator", href: "/v2/schedule/generator", permission: "schedule.manage", portal: "admin", icon: "workflow", order: 344 },
  { key: "v2.scheduling.export", labelKey: "scheduling_export", label: "scheduling_export", href: "/v2/schedule/export", permission: "schedule.read", portal: "admin", icon: "download", order: 346 },
  { key: "v2.results.matrix", labelKey: "results_matrix", label: "results_matrix", href: "/v2/results/matrix", permission: "result.read", portal: "admin", icon: "table", order: 462 },
  { key: "v2.results.overrides", labelKey: "results_overrides", label: "results_overrides", href: "/v2/results/overrides", permission: "result.override.request", anyPermission: ["result.override.request", "result.override.approve"], portal: "admin", icon: "edit", order: 464 },
  { key: "v2.results.resit", labelKey: "results_resit", label: "results_resit", href: "/v2/results/resit", permission: "higher.resit.manage", feature: "higher.session2", portal: "admin", icon: "repeat", order: 466 },
  { key: "v2.finance.overview", labelKey: "finance_overview", label: "finance_overview", href: "/v2/finance", permission: "finance.report.read", portal: "admin", icon: "layout-dashboard", order: 391 },
  { key: "v2.finance.receipts", labelKey: "finance_receipts", label: "finance_receipts", href: "/v2/finance/receipts", permission: "finance.receipt.read", portal: "admin", icon: "receipt", order: 442 },
  { key: "v2.finance.refunds", labelKey: "finance_refunds", label: "finance_refunds", href: "/v2/finance/refunds", permission: "finance.payment.read", portal: "admin", icon: "repeat", order: 444 },
  { key: "v2.higher.attestations", labelKey: "higher_attestations", label: "higher_attestations", href: "/v2/higher/attestations", permission: "higher.diploma.read", portal: "admin", icon: "file-badge", order: 442 },
  { key: "v2.higher.credits", labelKey: "higher_credits", label: "higher_credits", href: "/v2/higher/credits", permission: "higher.credits.read", portal: "admin", icon: "award", order: 444 },
  { key: "v2.reportcards.signatories", labelKey: "reportcards_signatories", label: "reportcards_signatories", href: "/v2/reportcards/signatories", permission: "reportcard.signatory.manage", portal: "admin", icon: "pen-line", order: 432 },
  { key: "v2.documents.search", labelKey: "documents_search", label: "documents_search", href: "/v2/documents/search", permission: "documents.read", anyPermission: ["documents.read", "documents.read.restricted", "documents.read.confidential", "documents.manage", "documents.child.read", "documents.self.read", "documents.own.read"], portal: "admin", icon: "list", order: 842 },
  { key: "v2.examinations.assignments", labelKey: "examinations_assignments", label: "examinations_assignments", href: "/v2/examinations/assignments", permission: "exam.center.manage", anyPermission: ["exam.center.manage", "exam.session.read"], portal: "admin", icon: "users", order: 672 },
  { key: "v2.examinations.imports", labelKey: "examinations_imports", label: "examinations_imports", href: "/v2/examinations/imports", permission: "exam.import.manage", portal: "admin", icon: "upload", order: 674 },
  { key: "v2.examinations.types", labelKey: "examinations_types", label: "examinations_types", href: "/v2/examinations/types", permission: "exam.type.read", portal: "admin", icon: "settings", order: 676 },
  { key: "v2.imports.templates", labelKey: "imports_templates", label: "imports_templates", href: "/v2/imports/templates", permission: "imports.read", portal: "admin", icon: "file-text", order: 802 },
  { key: "v2.imports.settings", labelKey: "imports_settings", label: "imports_settings", href: "/v2/imports/settings", permission: "imports.manage", portal: "admin", icon: "settings", order: 804 },
  { key: "v2.messaging.notifications", labelKey: "messaging_notifications", label: "messaging_notifications", href: "/v2/messages/notifications", permission: "messaging.read", anyPermission: ["messaging.read", "messaging.child.read", "messaging.self.read"], portal: "admin", icon: "bell", order: 732 },
  { key: "v2.notifications.send", labelKey: "notifications_send", label: "notifications_send", href: "/v2/notifications/send", permission: "notifications.send", anyPermission: ["notifications.send", "notifications.send.urgent"], portal: "admin", icon: "mail", order: 792 },
  { key: "v2.payroll.payslips", labelKey: "payroll_payslips", label: "payroll_payslips", href: "/v2/payroll/payslips", permission: "payroll.payslip.read", portal: "admin", icon: "file-text", order: 532 },
  { key: "v2.primary.classe", labelKey: "primary_classe", label: "primary_classe", href: "/v2/primary/classe", permission: "primary.competency.read", anyPermission: ["primary.competency.read", "primary.competency.record", "primary.council.read", "primary.council.prepare", "primary.class.read_all"], portal: "admin", icon: "school", order: 291 },
  { key: "v2.primary.competences", labelKey: "primary_competences", label: "primary_competences", href: "/v2/primary/competences", permission: "primary.competency.read", anyPermission: ["primary.competency.read", "primary.competency.record"], portal: "admin", icon: "clipboard-check", order: 342 },
  { key: "v2.primary.appreciations", labelKey: "primary_appreciations", label: "primary_appreciations", href: "/v2/primary/appreciations", permission: "primary.phrase.read", anyPermission: ["primary.phrase.read", "primary.phrase.manage"], portal: "admin", icon: "message", order: 344 },
  { key: "v2.primary.parametres", labelKey: "primary_parametres", label: "primary_parametres", href: "/v2/primary/parametres", permission: "primary.settings.manage", portal: "admin", icon: "settings", order: 346 },
  { key: "v2.rules.bindings", labelKey: "rules_bindings", label: "rules_bindings", href: "/v2/rules/bindings", permission: "rules.ruleset.read", portal: "admin", icon: "link", order: 702 },
  { key: "v2.schoollife.saisie", labelKey: "schoollife_saisie", label: "schoollife_saisie", href: "/v2/schoollife/saisie", permission: "schoollife.incident.write", anyPermission: ["schoollife.incident.write", "schoollife.note.write"], portal: "admin", icon: "edit", order: 642 },
  { key: "v2.audit", labelKey: "audit", label: "audit", href: "/v2/audit", permission: "audit.read", feature: "audit.log", portal: "admin", icon: "shield", order: 920 },
];

export interface BuildMenuInput {
  /** Entrées renvoyées par l'API (portail admin). */
  apiItems: readonly MenuItem[];
  /** Permissions détenues (clés) ; `null` tant qu'elles ne sont pas connues. */
  permissions: readonly string[] | null;
  /** Fonctionnalités actives du tenant ; `null` si inconnues. */
  features: readonly string[] | null;
  /** Traduit le libellé d'une entrée locale (`labelKey`). */
  labelOf: (labelKey: string) => string;
}

export function buildV2Menu({ apiItems, permissions, features, labelOf }: BuildMenuInput): MenuItem[] {
  const mapped = apiItems.map((item) => ({ ...item, href: mapToV2Href(item.href) }));
  const known = new Set(mapped.map((item) => item.href));
  const extras: MenuItem[] = [];
  if (permissions) {
    for (const entry of V2_ADMIN_ENTRIES) {
      if (known.has(entry.href)) continue;
      if (!(entry.anyPermission ?? [entry.permission]).some((p) => hasPermission(permissions, p))) continue;
      if (entry.feature && !(features ?? []).includes(entry.feature)) continue;
      const { labelKey, anyPermission: _any, ...item } = entry;
      extras.push({ ...item, label: labelOf(labelKey) });
    }
  }
  return sortMenuItems([...mapped, ...extras]);
}

/** Menu statique de la console plateforme (opérateurs) : l'API RBAC est propre aux tenants. */
export const OPERATOR_ENTRIES: readonly { key: string; labelKey: string; href: string; icon: string }[] = [
  { key: "platform.tenants", labelKey: "tenants", href: "/v2/platform/tenants", icon: "building" },
  { key: "platform.plans", labelKey: "plans", href: "/v2/platform/plans", icon: "credit-card" },
  { key: "platform.audit", labelKey: "audit", href: "/v2/platform/audit", icon: "shield" },
];

export function buildOperatorMenu(labelOf: (labelKey: string) => string): MenuItem[] {
  return OPERATOR_ENTRIES.map((e, index) => ({
    key: e.key,
    label: labelOf(e.labelKey),
    href: e.href,
    permission: "platform.operator",
    portal: "super-admin" as const,
    icon: e.icon,
    order: index,
  }));
}
