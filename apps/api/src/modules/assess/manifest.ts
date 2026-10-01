import { defineModule } from "@ecoledigitale/kernel";
import { ALL_ASSESS_EVENT_TYPES, ConsumedEvents } from "./domain/events";

/**
 * Module `assess` — évaluations et notes (spec v2/011) : types d'évaluation configurables, évaluations, saisie en lot
 * idempotente (smartphone), circuit DRAFT -> SUBMITTED -> REVIEWED -> APPROVED -> PUBLISHED, immuabilité après
 * publication (application ET déclencheurs SQL), révisions de notes (GradeRevision), verrous de période distinguant les
 * sessions, absences et dispenses (une absence n'est pas un zéro).
 *
 * AUCUNE formule, AUCUN seuil : les moyennes, rangs et mentions sont calculés par le module `results` à travers `rules`.
 * Les références vers classes, inscriptions, nœuds de curriculum, périodes, élèves et personnel sont des UUID sans clé
 * étrangère, vérifiées par des PORTS (`RosterPort`, `PeriodPort`, `CurriculumPort`, `TeachingAssignmentPort`,
 * `GuardianshipPort`) que fournissent academic, people et scheduling — d'où aucune dépendance de manifeste (pas de
 * cycle ; `results` dépend d'`assess`, jamais l'inverse, décision A-21).
 */
export default defineModule({
  key: "assess",
  title: "Évaluations et notes",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: [],
  permissions: [
    { key: "assessment.type.read", label: "Consulter les types d'évaluation" },
    {
      key: "assessment.type.manage",
      label: "Gérer les types d'évaluation et les réglages de saisie",
      description: "Configure ce que les règles de calcul lisent (groupes d'agrégation) et la séparation des tâches.",
      sensitive: true,
    },
    { key: "assessment.read", label: "Consulter les évaluations" },
    { key: "assessment.create", label: "Créer ses évaluations" },
    { key: "assessment.update", label: "Modifier ses évaluations en brouillon" },
    { key: "assessment.manage", label: "Gérer toutes les évaluations (autres enseignants, toutes classes)" },
    { key: "grade.read", label: "Consulter les feuilles de notes de toutes les évaluations" },
    { key: "grade.enter", label: "Saisir et soumettre les notes de ses évaluations" },
    { key: "grade.review", label: "Relire une feuille de notes soumise" },
    { key: "grade.validate", label: "Approuver une feuille de notes", description: "Acte sensible : authentification forte requise.", sensitive: true },
    { key: "grade.publish", label: "Publier une feuille de notes", description: "Les notes publiées deviennent immuables : acte sensible.", sensitive: true },
    { key: "grade.revise.request", label: "Demander la correction d'une note publiée" },
    { key: "grade.revise.approve", label: "Approuver ou rejeter la correction d'une note publiée", description: "Modifie une note publiée : acte sensible, audité.", sensitive: true },
    { key: "grade.self.read", label: "Consulter ses propres notes publiées (élève)" },
    { key: "grade.child.read", label: "Consulter les notes publiées de ses enfants (parent)" },
  ],
  features: [{ key: "assess.session2", label: "Session de rattrapage (session 2)", packs: ["HIGHER"] }],
  menus: [
    { key: "assess.mine", label: "Mes évaluations", href: "/teacher/evaluations", permission: "assessment.read", portal: "teacher", icon: "clipboard-list", order: 400 },
    { key: "assess.review", label: "Feuilles à relire", href: "/admin/notes/relecture", permission: "grade.review", portal: "admin", icon: "file-check", order: 410 },
    { key: "assess.corrections", label: "Corrections de notes", href: "/admin/notes/corrections", permission: "grade.revise.approve", portal: "admin", icon: "edit", order: 420 },
    { key: "assess.types", label: "Types d'évaluation", href: "/admin/notes/types", permission: "assessment.type.read", portal: "admin", icon: "settings", order: 430 },
    { key: "assess.child", label: "Notes de mes enfants", href: "/parent/notes", permission: "grade.child.read", portal: "parent", icon: "award", order: 400 },
    { key: "assess.self", label: "Mes notes", href: "/student/notes", permission: "grade.self.read", portal: "student", icon: "award", order: 400 },
  ],
  events: {
    publishes: [...ALL_ASSESS_EVENT_TYPES],
    consumes: [ConsumedEvents.TENANT_PROVISIONED],
  },
});
