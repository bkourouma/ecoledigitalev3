import { defineModule } from "@ecoledigitale/kernel";
import { ALL_IMPORT_EVENT_TYPES } from "./domain/events";

/**
 * Module `imports` — imports Excel / CSV en sept étapes (spec v2/031-imports) : Upload, Mapping, Validation, Erreurs,
 * Preview, Import (worker, par lots transactionnels, idempotent, reprenable), Rapport.
 *
 * Le module n'écrit JAMAIS dans un autre module : chaque importeur délègue l'écriture à un PORT (`ImportTargetPort`) que
 * la plateforme branche, dans `apps/api/src/platform/adapters/`, sur l'API publique (`index.ts`) de `people`, `academic`,
 * `assess` et `finance` — avec leurs règles, leur audit, leurs événements. Aucune FK inter-schémas, aucun import direct :
 * d'où `dependsOn: []`.
 *
 * Permissions : `imports.read` / `imports.create` (téléverser, mapper, valider, prévisualiser : aucune écriture dans les
 * modules cibles), `imports.import.<importeur>` (LANCER l'import ; exigée EN PLUS des permissions du module cible),
 * `imports.cancel`, `imports.template.manage`, `imports.manage` (voir et annuler les imports des autres, paramètres). Les
 * soldes financiers exigent la MFA (permission sensible). `owner` et `directeur` ont `*` ; l'attribution aux autres
 * rôles système (secrétariat, directeur des études, économe en préparation) est portée par `rbac/templates/system-roles.ts`.
 */
export default defineModule({
  key: "imports",
  title: "Imports Excel / CSV",
  packs: ["CORE"],
  dependsOn: [],
  permissions: [
    { key: "imports.read", label: "Consulter l'historique des imports, les rapports et les modèles de fichier" },
    { key: "imports.create", label: "Téléverser un fichier, associer les colonnes, valider et prévisualiser un import" },
    { key: "imports.import.students", label: "Lancer l'import des élèves" },
    { key: "imports.import.guardians", label: "Lancer l'import des parents et tuteurs" },
    { key: "imports.import.staff", label: "Lancer l'import des enseignants et du personnel" },
    { key: "imports.import.classrooms", label: "Lancer l'import des classes" },
    { key: "imports.import.curriculum", label: "Lancer l'import des matières et du curriculum" },
    { key: "imports.import.grades", label: "Lancer l'import des notes" },
    {
      key: "imports.import.grades_own",
      label: "Lancer l'import des notes de SES évaluations (enseignant)",
      description: "Périmètre vérifié côté serveur par l'affectation d'enseignement : jamais une classe ni une matière où l'on n'enseigne pas. Exige aussi grade.enter.",
    },
    { key: "imports.import.enrollments", label: "Lancer l'import des inscriptions (élèves vers les classes de l'année)" },
    {
      key: "imports.import.opening_balances",
      label: "Lancer l'import des soldes financiers d'ouverture",
      description: "Crée des factures et des avoirs de reprise : acte sensible, audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "imports.cancel", label: "Annuler un import en cours" },
    { key: "imports.template.manage", label: "Gérer les modèles de mapping de colonnes de l'établissement" },
    { key: "imports.manage", label: "Voir et annuler les imports des autres utilisateurs, régler les plafonds du module" },
  ],
  features: [],
  menus: [{ key: "imports.home", label: "Imports Excel / CSV", href: "/v2/imports", permission: "imports.read", portal: "admin", icon: "upload", order: 800 }],
  events: {
    publishes: [...ALL_IMPORT_EVENT_TYPES],
    consumes: ["imports.job.validation_requested", "imports.run.requested"],
  },
});
