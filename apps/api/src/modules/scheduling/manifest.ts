import { defineModule } from "@ecoledigitale/kernel";
import { ALL_SCHEDULING_EVENT_TYPES, CONSUMED_EVENT_TYPES } from "./domain/events";

/**
 * Module `scheduling` — salles et équipements, grille horaire, calendrier de l'établissement, emplois du
 * temps récurrents (patrons → occurrences datées), séances ponctuelles, examens, réservations, remplacements,
 * annulations, détection de conflits (enseignant, classe/offre, salle, équipement) IMPOSÉE par la base,
 * constat de réalisation, validation et verrous de paie, vues par classe/enseignant/salle/élève/parent.
 *
 * Les classes, offres, nœuds de curriculum, périodes, enseignants et tuteurs ne sont connus que par UUID,
 * via les ports `AcademicQuery`, `PeopleQuery` et `AttendanceQuery` (aucune dépendance de code envers
 * academic, people ou attendance). `dependsOn: ["rbac"]` : les routes sont protégées par `requirePermission`.
 */
export default defineModule({
  key: "scheduling",
  title: "Emploi du temps et planification",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: ["rbac"],
  permissions: [
    { key: "schedule.read", label: "Consulter les emplois du temps et les séances" },
    { key: "schedule.manage", label: "Créer et modifier emplois du temps, séances, remplacements et annulations" },
    { key: "schedule.publish", label: "Publier et archiver un emploi du temps" },
    { key: "schedule.room.manage", label: "Gérer les salles et les équipements" },
    { key: "schedule.room.book", label: "Réserver une salle" },
    { key: "schedule.calendar.manage", label: "Gérer le calendrier de l'établissement (fériés, vacances, fermetures)" },
    { key: "schedule.occurrence.hold", label: "Constater manuellement la réalisation d'une séance" },
    { key: "schedule.occurrence.declare", label: "Déclarer une séance ponctuelle de ses classes" },
    {
      key: "schedule.occurrence.validate",
      label: "Valider, dévalider une séance pour la paie et fixer la durée payée",
      description: "Une séance validée devient payable : exige l'authentification forte et reste auditée.",
      sensitive: true,
    },
    { key: "schedule.accounting.create", label: "Créer une séance comptable (heures déclarées sans plage réelle)" },
    {
      key: "schedule.conflict.override",
      label: "Dépasser un conflit de planification bloquant",
      description: "Autorise une double réservation motivée ; journalisée et auditée.",
      sensitive: true,
    },
    {
      key: "schedule.hours.lock",
      label: "Verrouiller les heures payables (réservée à la paie)",
      description: "Une heure verrouillée ne change plus : exige l'authentification forte.",
      sensitive: true,
    },
    { key: "schedule.self.read", label: "Consulter son propre emploi du temps (élève)" },
    { key: "schedule.child.read", label: "Consulter l'emploi du temps de ses enfants (parent)" },
    { key: "schedule.own.read", label: "Consulter ses séances (personnel)" },
  ],
  features: [
    { key: "scheduling.equipment", label: "Réservation d'équipements (stock par campus)", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "scheduling.generation", label: "Génération des occurrences depuis les patrons récurrents", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "scheduling.payroll-hours", label: "Heures payables et verrous de paie", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
  ],
  menus: [
    { key: "scheduling.timetables", label: "Emplois du temps", href: "/admin/emploi-du-temps", permission: "schedule.read", portal: "admin", icon: "calendar-days", order: 300 },
    { key: "scheduling.rooms", label: "Salles et équipements", href: "/admin/emploi-du-temps/salles", permission: "schedule.room.manage", portal: "admin", icon: "door-open", order: 310 },
    { key: "scheduling.calendar", label: "Calendrier de l'établissement", href: "/admin/emploi-du-temps/calendrier", permission: "schedule.calendar.manage", portal: "admin", icon: "calendar", order: 320 },
    { key: "scheduling.validation", label: "Validation des séances", href: "/admin/emploi-du-temps/validation", permission: "schedule.occurrence.validate", portal: "admin", icon: "check-square", order: 330 },
    { key: "scheduling.replacements", label: "Remplacements", href: "/admin/emploi-du-temps/remplacements", permission: "schedule.manage", portal: "admin", icon: "user-round-cog", order: 340 },
    { key: "scheduling.today", label: "Aujourd'hui", href: "/enseignant/aujourdhui", permission: "schedule.own.read", portal: "teacher", icon: "clock", order: 100 },
    { key: "scheduling.my-timetable", label: "Mon emploi du temps", href: "/enseignant/emploi-du-temps", permission: "schedule.own.read", portal: "teacher", icon: "calendar-days", order: 110 },
    { key: "scheduling.student-timetable", label: "Emploi du temps", href: "/eleve/emploi-du-temps", permission: "schedule.self.read", portal: "student", icon: "calendar-days", order: 100 },
    { key: "scheduling.child-timetable", label: "Emploi du temps de mes enfants", href: "/parent/emploi-du-temps", permission: "schedule.child.read", portal: "parent", icon: "calendar-days", order: 100 },
  ],
  events: {
    publishes: [...ALL_SCHEDULING_EVENT_TYPES],
    consumes: [...CONSUMED_EVENT_TYPES],
  },
});
