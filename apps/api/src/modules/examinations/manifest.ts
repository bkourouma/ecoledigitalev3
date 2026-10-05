import { defineModule } from "@ecoledigitale/kernel";
import { ALL_EXAMINATIONS_EVENT_TYPES, ConsumedEvents } from "./domain/events";

/**
 * Module `examinations` — examens nationaux, GÉNÉRIQUES (spec v2/018-examinations, PRD §14 et §21).
 *
 * Un TYPE d'examen (CEPE, BEPC, BAC, BTS…) est une ligne de données : séries, épreuves, coefficients, pièces exigées et formats
 * d'export/import sont des données ; l'éligibilité, la moyenne et l'issue d'un examen BLANC, le taux de réussite sont des RÈGLES
 * (`rules`, contrat `exam-national@1`). Aucune constante réglementaire dans le code. L'admission d'un examen OFFICIEL est celle que
 * l'autorité prononce : le module l'enregistre (saisie ou import), il ne la calcule jamais.
 *
 * Les voisins (élèves et inscriptions, règles, évaluations, documents, scellement des documents officiels, stockage) sont des
 * PORTS branchés par les adaptateurs de la plateforme : aucun import d'un autre module, donc `dependsOn: []`.
 *
 * Conventions de portée : `exam.document.child.read` (parent), `exam.document.self.read` (élève).
 */
export default defineModule({
  key: "examinations",
  title: "Examens nationaux",
  packs: ["PRIMARY", "SECONDARY", "HIGHER"],
  dependsOn: [],
  permissions: [
    { key: "exam.type.read", label: "Consulter les types d'examens, séries, épreuves et pièces exigées" },
    { key: "exam.type.manage", label: "Gérer les types d'examens, séries, épreuves et pièces exigées (données)" },
    { key: "exam.center.manage", label: "Gérer les centres, les salles et la répartition des candidats" },
    { key: "exam.session.read", label: "Consulter les sessions d'examen" },
    { key: "exam.session.manage", label: "Préparer et conduire une session (figer la définition, ouvrir, clore, démarrer, archiver)" },
    { key: "exam.candidate.read", label: "Consulter les candidats d'une session" },
    { key: "exam.candidate.manage", label: "Gérer les candidats : sélection, pièces, inscription, retrait, identifiants officiels" },
    { key: "exam.external.manage", label: "Saisir, importer et modifier les candidats libres (sans dossier élève)" },
    { key: "exam.external.read", label: "Consulter les données personnelles restreintes d'un candidat libre (contact, pièce d'identité, tuteur) ; lecture auditée" },
    {
      key: "exam.external.anonymize",
      label: "Anonymiser un candidat libre (droit à l'effacement)",
      description: "Irréversible : motif obligatoire, audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "exam.fee.read", label: "Consulter les frais d'examen (barème d'un type, obligation et statut de paiement d'un candidat)" },
    { key: "exam.fee.manage", label: "Gérer le barème des frais d'examen, relancer la facturation, confirmer un remboursement manuel" },
    { key: "exam.eligibility.evaluate", label: "Évaluer l'éligibilité d'un candidat (règle) ou la saisir manuellement en l'absence de règle" },
    {
      key: "exam.eligibility.override",
      label: "Accorder une dérogation d'éligibilité motivée",
      description: "Acte sensible : motif obligatoire, audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "exam.score.enter", label: "Saisir les notes d'épreuves (lot)" },
    { key: "exam.mock.manage", label: "Gérer les examens blancs : liens avec les évaluations, import des notes, calcul par la règle" },
    { key: "exam.import.manage", label: "Déposer, valider et gérer les formats des fichiers d'import de l'autorité" },
    { key: "exam.result.read", label: "Consulter les résultats, les demandes de révision et leur historique" },
    { key: "exam.result.enter", label: "Saisir les résultats officiels et demander une correction" },
    {
      key: "exam.result.publish",
      label: "Publier les résultats d'une session",
      description: "Acte sensible : un résultat publié ne se dépublie pas (révision seulement) ; authentification forte requise.",
      sensitive: true,
    },
    {
      key: "exam.result.release",
      label: "Appliquer un lot d'import de résultats officiels",
      description: "Acte sensible : un lot appliqué est immuable ; authentification forte requise.",
      sensitive: true,
    },
    {
      key: "exam.result.revise",
      label: "Approuver une révision d'une note ou d'un résultat publié (par une autre personne que le demandeur)",
      description: "Acte sensible : séparation des tâches, audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "exam.statistics.read", label: "Consulter les statistiques d'examen (par établissement, série, sexe)" },
    { key: "exam.export.manage", label: "Gérer les formats d'export (brouillon, publication, nouvelle version)" },
    { key: "exam.export.run", label: "Exécuter et télécharger les exports officiels" },
    { key: "exam.document.issue", label: "Émettre, révoquer et consulter les convocations, attestations et relevés" },
    { key: "exam.document.child.read", label: "Consulter l'examen et les documents de ses enfants (parent)" },
    { key: "exam.document.self.read", label: "Consulter son examen et ses documents (élève)" },
  ],
  features: [
    { key: "examinations.core", label: "Examens nationaux : sessions, candidats, éligibilité, inscriptions, centres, résultats, documents", packs: ["PRIMARY", "SECONDARY", "HIGHER"] },
    { key: "examinations.mock", label: "Examens blancs liés aux évaluations, calculés par la règle", packs: ["PRIMARY", "SECONDARY", "HIGHER"] },
    { key: "examinations.exports", label: "Exports officiels paramétrables et statistiques exportées", packs: ["PRIMARY", "SECONDARY", "HIGHER"] },
  ],
  menus: [
    { key: "examinations.sessions", label: "Examens", href: "/v2/examinations", permission: "exam.session.read", feature: "examinations.core", portal: "admin", icon: "graduation-cap", order: 600 },
    { key: "examinations.candidates", label: "Candidats aux examens", href: "/v2/examinations/candidates", permission: "exam.candidate.read", feature: "examinations.core", portal: "admin", icon: "users", order: 610 },
    { key: "examinations.centers", label: "Centres et salles", href: "/v2/examinations/centers", permission: "exam.center.manage", feature: "examinations.core", portal: "admin", icon: "building", order: 620 },
    { key: "examinations.mock", label: "Examens blancs", href: "/v2/examinations/mock", permission: "exam.mock.manage", feature: "examinations.mock", portal: "admin", icon: "file-pen", order: 630 },
    { key: "examinations.results", label: "Résultats d'examen", href: "/v2/examinations/results", permission: "exam.result.read", feature: "examinations.core", portal: "admin", icon: "award", order: 640 },
    { key: "examinations.statistics", label: "Statistiques d'examen", href: "/v2/examinations/statistics", permission: "exam.statistics.read", feature: "examinations.core", portal: "admin", icon: "bar-chart", order: 650 },
    { key: "examinations.exports", label: "Exports d'examen", href: "/v2/examinations/exports", permission: "exam.export.run", feature: "examinations.exports", portal: "admin", icon: "download", order: 660 },
    { key: "examinations.corrections", label: "Corrections d'examen", href: "/v2/examinations/corrections", permission: "exam.result.read", feature: "examinations.core", portal: "admin", icon: "shield-check", order: 670 },
    { key: "examinations.family", label: "Examens de mes enfants", href: "/v2/examinations/family", permission: "exam.document.child.read", feature: "examinations.core", portal: "parent", icon: "graduation-cap", order: 600 },
    { key: "examinations.self", label: "Mon examen", href: "/v2/examinations/family", permission: "exam.document.self.read", feature: "examinations.core", portal: "student", icon: "graduation-cap", order: 600 },
  ],
  events: {
    publishes: [...ALL_EXAMINATIONS_EVENT_TYPES],
    consumes: [ConsumedEvents.ENROLLMENT_WITHDRAWN],
  },
});
