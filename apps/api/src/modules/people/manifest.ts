import { defineModule } from "@ecoledigitale/kernel";
import { PEOPLE_EVENTS } from "@ecoledigitale/contracts/src/v2/people";

/**
 * Module `people` — personnes : dossier permanent de l'élève / étudiant, tuteurs et liens, personnel et enseignants,
 * affectations d'enseignement (specs 008 et 009). Socle (CORE) : toujours actif. Schéma Postgres `people`, migrations
 * 0800-0899.
 *
 * `dependsOn: ["rbac"]` : les routes sont protégées par `requirePermission`. Les ports `AccountProvisioner` (iam),
 * `StoragePort`, `AcademicQuery` et `CountryProfileProvider` sont INJECTÉS (pas de dépendance de manifeste, pour éviter
 * les cycles avec `academic` et `iam`).
 *
 * Permissions : `*.child.*` (parent) et `*.self.*` (élève) suivent la convention des modèles de rôles RBAC ; la règle « cet
 * élève est bien l'enfant de ce parent » est une règle de DOMAINE de ce module (`isGuardianOfStudent`), pas un périmètre.
 */
export default defineModule({
  key: "people",
  title: "Élèves, tuteurs et personnel",
  packs: ["CORE"],
  dependsOn: ["rbac"],
  permissions: [
    // ---- élèves ----
    { key: "student.list", label: "Lister les élèves", description: "Tous les élèves du tenant (pas seulement ceux de ses classes)." },
    { key: "student.read", label: "Consulter la fiche d'un élève", description: "Tous les élèves du tenant, hors champs sensibles." },
    { key: "student.create", label: "Créer un dossier élève" },
    { key: "student.update", label: "Modifier un dossier élève, ses contacts d'urgence et ses antécédents" },
    { key: "student.status.update", label: "Changer le statut d'un élève", description: "Sorties, exclusions, retours : toujours avec motif et audit.", sensitive: true },
    { key: "student.sensitive.read", label: "Lire et modifier les champs sensibles d'un élève", description: "Identifiant national, pièce d'état civil, attributs : chaque accès est audité.", sensitive: true },
    { key: "student.export", label: "Exporter la liste des élèves", description: "Export CSV limité et journalisé.", sensitive: true },
    { key: "student.class.read", label: "Consulter les élèves de ses classes", description: "Limité aux classes où l'on est affecté aujourd'hui (enseignant)." },
    { key: "student.anonymize", label: "Anonymiser un dossier archivé", description: "Droit à l'effacement : irréversible, après la durée de conservation du tenant.", sensitive: true },
    { key: "student.self.read", label: "Consulter son propre dossier d'élève" },
    { key: "student.self.update", label: "Modifier ses propres coordonnées d'élève" },
    { key: "student.child.read", label: "Consulter le dossier de ses enfants" },
    { key: "student.child.update", label: "Modifier ses coordonnées et les contacts d'urgence de ses enfants" },
    // ---- tuteurs ----
    { key: "guardian.read", label: "Consulter les tuteurs et leurs liens" },
    { key: "guardian.manage", label: "Créer les tuteurs, gérer les liens et inviter au portail", description: "Seul ce droit modifie les drapeaux d'un lien (autorité, retrait, accès au portail)." },
    // ---- personnel ----
    { key: "staff.list", label: "Lister le personnel" },
    { key: "staff.read", label: "Consulter les fiches du personnel" },
    { key: "staff.create", label: "Créer une fiche de personnel" },
    { key: "staff.update", label: "Modifier une fiche de personnel, ses affiliations et ses compétences" },
    { key: "staff.status.update", label: "Changer le statut d'un membre du personnel", description: "Départ, suspension, réembauche : avec motif et audit.", sensitive: true },
    { key: "staff.contract.read", label: "Consulter les contrats du personnel", description: "Chaque lecture est auditée." },
    { key: "staff.contract.manage", label: "Gérer les contrats du personnel", description: "Ni tarif ni salaire (paie) ; chaque modification est auditée.", sensitive: true },
    { key: "staff.qualification.manage", label: "Gérer les qualifications du personnel" },
    { key: "staff.availability.manage", label: "Gérer les disponibilités du personnel" },
    { key: "staff.own.read", label: "Consulter sa propre fiche, ses contrats et ses affectations" },
    { key: "staff.own.update", label: "Modifier ses coordonnées et ses disponibilités", description: "Jamais son statut, ses contrats ni sa rémunération." },
    // ---- affectations ----
    { key: "teaching.read", label: "Consulter les affectations d'enseignement et la charge" },
    { key: "teaching.assign", label: "Affecter, terminer et remplacer les enseignants" },
    // ---- paramètres ----
    { key: "people.settings.manage", label: "Gérer les paramètres et référentiels des personnes", description: "Motifs de numéros, types de liens, catégories de personnel, types de contrat, conservation." },
  ],
  features: [],
  menus: [
    { key: "people.students", label: "Élèves", href: "/admin/eleves", permission: "student.list", portal: "admin", icon: "graduation-cap", order: 100 },
    { key: "people.guardians", label: "Parents et tuteurs", href: "/admin/parents", permission: "guardian.read", portal: "admin", icon: "users", order: 110 },
    { key: "people.staff", label: "Personnel", href: "/admin/personnel", permission: "staff.list", portal: "admin", icon: "briefcase", order: 120 },
    { key: "people.assignments", label: "Affectations", href: "/admin/affectations", permission: "teaching.read", portal: "admin", icon: "link", order: 130 },
    { key: "people.settings", label: "Paramètres des personnes", href: "/admin/personnes/parametres", permission: "people.settings.manage", portal: "admin", icon: "settings", order: 140 },
    { key: "people.my-classes", label: "Mes classes", href: "/enseignant/mes-classes", permission: "staff.own.read", portal: "teacher", icon: "school", order: 100 },
    { key: "people.children", label: "Mes enfants", href: "/parent/enfants", permission: "student.child.read", portal: "parent", icon: "users", order: 100 },
    { key: "people.my-record", label: "Mon dossier", href: "/eleve/mon-dossier", permission: "student.self.read", portal: "student", icon: "id-card", order: 100 },
  ],
  events: {
    publishes: Object.values(PEOPLE_EVENTS),
    consumes: [
      "academic.enrollment.created",
      "academic.enrollment.confirmed",
      "academic.enrollment.suspended",
      "academic.enrollment.resumed",
      "academic.enrollment.withdrawn",
      "academic.enrollment.cancelled",
      "academic.enrollment.transferred",
      "academic.enrollment.completed",
      "academic.enrollment.reopened",
      "academic.enrollment.funding_changed",
      "academic.enrollment.outcome_recorded",
      "academic.classroom.cancelled",
      "academic.classroom.completed",
      "academic.year.closed",
      "iam.membership.created",
      "iam.membership.changed",
      "tenancy.tenant.provisioned",
    ],
  },
});
