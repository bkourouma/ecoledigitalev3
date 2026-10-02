import { defineModule } from "@ecoledigitale/kernel";
import { ALL_EVENT_TYPES } from "./domain/events";

/**
 * Manifeste du module "schoollife" — vie scolaire (spec v2/006 §5.2) : incidents, avertissements, sanctions, exclusions
 * temporaires, encouragements, observations, convocations des tuteurs, recours, points de conduite paramétrés.
 * Source de vérité de ses permissions, features, menus et événements. Le nom du dossier, la clé et le schéma Postgres sont
 * identiques. Aucune règle réglementaire ni catalogue de fautes : types, gravités et barèmes sont des DONNÉES d'établissement.
 */
export default defineModule({
  key: "schoollife",
  title: "Vie scolaire",
  // Agnostique du pack (types en données) : ouvert au pack SECONDARY ; pourra l'être à PRIMARY sans changement de schéma.
  packs: ["SECONDARY"],
  // Aucune dépendance de chargement : les autres modules arrivent par des PORTS (platform/adapters).
  dependsOn: [],
  permissions: [
    { key: "schoollife.read", label: "Lire la vie scolaire (niveau standard ; élèves de ses classes)" },
    { key: "schoollife.read.all", label: "Lire la vie scolaire de tous les élèves (niveau standard)" },
    { key: "schoollife.restricted.read", label: "Lire les éléments de niveau restreint", sensitive: true },
    { key: "schoollife.confidential.read", label: "Lire un élément confidentiel (motif exigé, lecture journalisée)", sensitive: true },
    { key: "schoollife.confidential.audit", label: "Consulter le journal des lectures confidentielles", sensitive: true },
    { key: "schoollife.incident.write", label: "Déclarer un incident" },
    { key: "schoollife.incident.review", label: "Instruire un incident (examen, confirmation, clôture)" },
    { key: "schoollife.measure.propose", label: "Proposer une mesure (sanction, avertissement, exclusion)" },
    { key: "schoollife.measure.validate", label: "Valider, rejeter ou notifier une sanction ou un avertissement", sensitive: true },
    { key: "schoollife.exclusion.validate", label: "Valider, rejeter ou notifier une exclusion temporaire", sensitive: true },
    { key: "schoollife.exclusion.apply", label: "Appliquer l'effet d'une exclusion sur le statut de l'élève", sensitive: true },
    { key: "schoollife.measure.revoke", label: "Révoquer une mesure", sensitive: true },
    { key: "schoollife.appeal.file", label: "Déposer un recours pour le compte d'une famille (direction)" },
    { key: "schoollife.appeal.decide", label: "Trancher un recours", sensitive: true },
    { key: "schoollife.note.write", label: "Rédiger un encouragement ou une observation" },
    { key: "schoollife.convocation.manage", label: "Convoquer les tuteurs et suivre les convocations" },
    { key: "schoollife.conduct.manage", label: "Gérer les barèmes de points de conduite", sensitive: true },
    { key: "schoollife.conduct.adjust", label: "Ajuster manuellement des points de conduite", sensitive: true },
    { key: "schoollife.settings.manage", label: "Paramétrer types d'événements, gravités et réglages", sensitive: true },
    { key: "schoollife.self.read", label: "Lire sa propre vie scolaire partageable (élève)" },
    { key: "schoollife.child.read", label: "Lire la vie scolaire partageable de ses enfants (parent)" },
    { key: "schoollife.self.appeal", label: "Déposer un recours contre une mesure qui le concerne (élève)" },
    { key: "schoollife.child.appeal", label: "Déposer un recours contre une mesure concernant son enfant (parent)" },
    { key: "schoollife.child.acknowledge", label: "Accuser réception d'une convocation (parent)" },
  ],
  features: [
    { key: "schoollife.core", label: "Vie scolaire : incidents, mesures, observations", packs: ["SECONDARY"] },
    { key: "schoollife.conduct-points", label: "Points de conduite paramétrés", packs: ["SECONDARY"] },
    { key: "schoollife.convocations", label: "Convocations des tuteurs", packs: ["SECONDARY"] },
  ],
  menus: [
    { key: "schoollife.dashboard", label: "Vie scolaire", href: "/v2/schoollife", permission: "schoollife.read.all", feature: "schoollife.core", portal: "admin", icon: "shield", order: 600 },
    { key: "schoollife.quick-entry", label: "Saisie rapide", href: "/v2/schoollife/saisie", permission: "schoollife.incident.write", feature: "schoollife.core", portal: "teacher", icon: "edit", order: 620 },
    { key: "schoollife.validations", label: "Mesures à valider", href: "/v2/schoollife/validations", permission: "schoollife.measure.validate", feature: "schoollife.core", portal: "admin", icon: "check", order: 610 },
    { key: "schoollife.convocations", label: "Convocations", href: "/v2/schoollife/convocations", permission: "schoollife.convocation.manage", feature: "schoollife.convocations", portal: "admin", icon: "calendar", order: 630 },
    { key: "schoollife.settings", label: "Paramètres de vie scolaire", href: "/v2/schoollife/parametres", permission: "schoollife.settings.manage", feature: "schoollife.core", portal: "admin", icon: "settings", order: 640 },
    { key: "schoollife.family", label: "Vie scolaire", href: "/v2/schoollife/famille", permission: "schoollife.child.read", feature: "schoollife.core", portal: "parent", icon: "shield", order: 600 },
    { key: "schoollife.me", label: "Ma vie scolaire", href: "/v2/schoollife/moi", permission: "schoollife.self.read", feature: "schoollife.core", portal: "student", icon: "shield", order: 600 },
  ],
  events: {
    publishes: [...ALL_EVENT_TYPES],
    // Aucun événement d'un autre module n'est consommé : `attendance` et les autres arrivent par des ports de lecture.
    consumes: [],
  },
});
