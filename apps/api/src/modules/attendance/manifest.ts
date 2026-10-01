import { defineModule } from "@ecoledigitale/kernel";
import { ALL_ATTENDANCE_EVENT_TYPES, ConsumedEvents } from "./domain/events";

/**
 * Module `attendance` — présences (spec v2/010) : UN SEUL modèle d'appel (statuts PRESENT, ABSENT, LATE, EXCUSED,
 * EARLY_LEAVE) pour l'appel journalier du primaire comme pour l'appel par séance du secondaire et du supérieur,
 * justificatifs structurés, récapitulatifs par période DÉRIVÉS avec surcharge tracée, présence et congés du personnel,
 * synchronisation hors-ligne idempotente, alertes d'assiduité CONFIGURABLES.
 *
 * Aucun seuil ni équivalence (« 3 retards = 1 absence ») : des comptages bruts et des événements. Les références vers
 * élèves, classes, inscriptions, séances et périodes sont des UUID sans clé étrangère, vérifiés par des PORTS
 * (`EnrollmentRosterPort`, `OccurrencePort`, `PeriodPort`, `PeoplePort`, `StoragePort`) que fournissent academic,
 * people et scheduling — d'où `dependsOn: ["rbac"]` seulement (pas de cycle de manifeste).
 */
export default defineModule({
  key: "attendance",
  title: "Présences",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: ["rbac"],
  permissions: [
    { key: "attendance.read", label: "Consulter les appels et les absences" },
    { key: "attendance.take", label: "Faire l'appel de ses séances et de ses classes" },
    { key: "attendance.manage", label: "Corriger tout appel, ouvrir un appel pour un tiers, arbitrer les conflits de synchronisation" },
    { key: "attendance.validate", label: "Valider un appel" },
    {
      key: "attendance.session.reopen",
      label: "Rouvrir un appel validé",
      description: "Acte sensible : motif obligatoire, audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "attendance.justification.submit", label: "Déposer ou retirer un justificatif d'absence (personnel habilité)" },
    { key: "attendance.justification.read", label: "Lire les justificatifs et leurs pièces", description: "Les pièces peuvent être médicales." },
    { key: "attendance.justification.decide", label: "Accepter, rejeter ou révoquer un justificatif" },
    { key: "attendance.child.justify", label: "Déposer un justificatif d'absence pour son enfant" },
    { key: "attendance.self.justify", label: "Déposer un justificatif pour soi-même (élève)" },
    {
      key: "attendance.summary.override",
      label: "Surcharger un récapitulatif d'assiduité",
      description: "Remplace les minutes dérivées des pointages ; motif et auteur tracés.",
      sensitive: true,
    },
    { key: "attendance.staff.read", label: "Consulter la présence du personnel" },
    { key: "attendance.staff.record", label: "Enregistrer la présence du personnel" },
    { key: "attendance.leave.request", label: "Demander un congé" },
    { key: "attendance.leave.decide", label: "Approuver, refuser ou annuler un congé du personnel", sensitive: true },
    { key: "attendance.report.read", label: "Consulter les rapports d'assiduité et exporter les absences" },
    { key: "attendance.settings.manage", label: "Gérer les statuts, motifs, types de congé, politiques d'appel et règles d'alerte" },
    { key: "attendance.self.read", label: "Consulter ses propres absences (élève)" },
    { key: "attendance.child.read", label: "Consulter les absences de ses enfants (parent)" },
    { key: "attendance.own.read", label: "Consulter sa propre présence et ses congés (personnel)" },
    { key: "attendance.own.record", label: "Pointer sa propre présence (personnel)" },
  ],
  features: [
    { key: "attendance.staff", label: "Présence et congés du personnel", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "attendance.offline", label: "Appel hors-ligne et synchronisation", packs: ["PRIMARY", "SECONDARY", "HIGHER"] },
    { key: "attendance.live-bridge", label: "Pont de présence des classes virtuelles", packs: ["HIGHER", "VIRTUAL"] },
  ],
  menus: [
    { key: "attendance.take", label: "Faire l'appel", href: "/teacher/attendance", permission: "attendance.take", portal: "teacher", icon: "check-square", order: 300 },
    { key: "attendance.follow", label: "Suivi des appels", href: "/admin/attendance", permission: "attendance.read", portal: "admin", icon: "clipboard-check", order: 310 },
    { key: "attendance.justifications", label: "Justificatifs d'absence", href: "/admin/attendance/justificatifs", permission: "attendance.justification.read", portal: "admin", icon: "file-check", order: 320 },
    { key: "attendance.staff", label: "Présence du personnel", href: "/admin/attendance/personnel", permission: "attendance.staff.read", feature: "attendance.staff", portal: "admin", icon: "users", order: 330 },
    { key: "attendance.settings", label: "Paramètres de présence", href: "/admin/attendance/parametres", permission: "attendance.settings.manage", portal: "admin", icon: "settings", order: 340 },
    { key: "attendance.child", label: "Absences de mes enfants", href: "/parent/attendance", permission: "attendance.child.read", portal: "parent", icon: "calendar-check", order: 300 },
    { key: "attendance.self", label: "Mes absences", href: "/student/attendance", permission: "attendance.self.read", portal: "student", icon: "calendar-check", order: 300 },
  ],
  events: {
    publishes: [...ALL_ATTENDANCE_EVENT_TYPES],
    consumes: [
      ConsumedEvents.OCCURRENCE_CANCELLED,
      ConsumedEvents.ENROLLMENT_WITHDRAWN,
      ConsumedEvents.ENROLLMENT_CANCELLED,
      ConsumedEvents.ENROLLMENT_TRANSFERRED,
      ConsumedEvents.PERIOD_CLOSED,
      ConsumedEvents.PERIOD_REOPENED,
      ConsumedEvents.TENANT_PROVISIONED,
    ],
  },
});
