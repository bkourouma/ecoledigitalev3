import { defineModule } from "@ecoledigitale/kernel";
import { ALL_DOCUMENTS_EVENT_TYPES } from "./domain/events";

/**
 * Module `documents` — GED légère multi-tenant (spec v2/024-documents, PRD §39).
 *
 * Cinq types (élève, personnel, établissement, académique, financier), catégories configurables par tenant, VERSIONS
 * immuables, expiration et alertes (`documents.document.expiring`), permissions fines (niveau de la catégorie, propriétaire,
 * tuteur lié, partage explicite, droit de catégorie par personne), stockage objet par `StoragePort`, téléchargement par URL
 * signée courte, prévisualisation sûre, contrôle des uploads (octets magiques, liste blanche, taille, nom assaini, SHA-256,
 * antivirus pluggable fail-closed, quarantaine), audit de chaque lecture / téléchargement / partage / archivage.
 *
 * Les liens (fiche élève d'un compte, enfants d'un tuteur, fiche du personnel, existence des propriétaires) sont résolus par le
 * port `OwnerDirectory` que fournit la plateforme à partir de people et iam : aucune FK inter-schémas, aucun import direct —
 * d'où `dependsOn: []`. Les documents OFFICIELS immuables (bulletins, relevés, diplômes, reçus, bulletins de paie) restent dans
 * leurs modules : ce module ne les duplique pas.
 *
 * Niveaux de lecture : `documents.read` (INTERNAL) < `documents.read.restricted` < `documents.read.confidential`.
 * Conventions de portée : `documents.child.*` (parent), `documents.self.*` (élève), `documents.own.*` (personnel), accordées
 * automatiquement aux rôles système (voir `rbac/templates/system-roles.ts`).
 */
export default defineModule({
  key: "documents",
  title: "Documents",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: [],
  permissions: [
    { key: "documents.read", label: "Lire les documents de niveau interne (règlement, programmes, circulaires)" },
    { key: "documents.read.restricted", label: "Lire les documents de niveau restreint (dossiers d'élèves, pièces financières)" },
    {
      key: "documents.read.confidential",
      label: "Lire les documents confidentiels (dossiers médicaux, contrats, comptabilité)",
      description: "Chaque lecture est auditée.",
      sensitive: true,
    },
    { key: "documents.upload", label: "Déposer des documents et de nouvelles versions" },
    { key: "documents.share", label: "Partager un document avec une personne ou retirer un partage" },
    { key: "documents.archive", label: "Archiver un document (suppression logique)" },
    {
      key: "documents.manage",
      label: "Administrer tous les documents (tous niveaux, y compris archivés) : corriger, restaurer, partager",
      description: "Accès à l'ensemble des documents de l'établissement : audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "documents.history.read", label: "Consulter l'historique d'accès d'un document (lectures, téléchargements, partages)" },
    { key: "documents.category.manage", label: "Gérer les catégories de documents et les droits de catégorie par personne" },
    { key: "documents.settings.manage", label: "Gérer les paramètres : taille maximale, quota, seuils d'alerte, rétention" },
    {
      key: "documents.quarantine.manage",
      label: "Consulter, libérer ou détruire les fichiers placés en quarantaine",
      description: "Acte sensible : motif obligatoire, audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "documents.child.read", label: "Lire les pièces concernant ses enfants (parent)" },
    { key: "documents.child.upload", label: "Déposer des pièces concernant ses enfants (parent)" },
    { key: "documents.self.read", label: "Lire ses propres pièces (élève)" },
    { key: "documents.self.upload", label: "Déposer ses propres pièces (élève)" },
    { key: "documents.own.read", label: "Lire ses documents de personnel (contrat, diplômes)" },
    { key: "documents.own.upload", label: "Déposer ses documents de personnel (diplômes, habilitations)" },
  ],
  features: [
    { key: "documents.storage.extended", label: "Stockage de documents étendu (palier intermédiaire)", packs: [] },
    { key: "documents.storage.large", label: "Stockage de documents large (palier supérieur)", packs: [] },
    { key: "documents.office-preview", label: "Prévisualisation des documents Office (conversion PDF)", packs: [] },
  ],
  menus: [
    { key: "documents.explorer", label: "Documents", href: "/v2/documents", permission: "documents.read", portal: "admin", icon: "folder", order: 800 },
    { key: "documents.expirations", label: "Documents à échéance", href: "/v2/documents/expirations", permission: "documents.read", portal: "admin", icon: "calendar-clock", order: 810 },
    { key: "documents.categories", label: "Catégories de documents", href: "/v2/documents/categories", permission: "documents.category.manage", portal: "admin", icon: "tags", order: 820 },
    { key: "documents.quarantine", label: "Quarantaine des documents", href: "/v2/documents/quarantine", permission: "documents.quarantine.manage", portal: "admin", icon: "shield", order: 830 },
    { key: "documents.settings", label: "Paramètres des documents", href: "/v2/documents/settings", permission: "documents.settings.manage", portal: "admin", icon: "settings", order: 840 },
    { key: "documents.own.teacher", label: "Mes documents", href: "/v2/documents", permission: "documents.own.read", portal: "teacher", icon: "folder", order: 800 },
    { key: "documents.child.parent", label: "Documents de mes enfants", href: "/v2/documents", permission: "documents.child.read", portal: "parent", icon: "folder", order: 800 },
    { key: "documents.self.student", label: "Mes documents", href: "/v2/documents", permission: "documents.self.read", portal: "student", icon: "folder", order: 800 },
  ],
  events: {
    publishes: [...ALL_DOCUMENTS_EVENT_TYPES],
    consumes: [],
  },
});
