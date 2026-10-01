import { defineModule } from "@ecoledigitale/kernel";
import { ALL_REPORTCARDS_EVENT_TYPES, ConsumedEvents, ReportcardsEvents } from "./domain/events";

/**
 * Module `reportcards` — bulletins, relevés et rendu PDF serveur (spec v2/013).
 *
 * Un bulletin est un SNAPSHOT IMMUABLE de résultats déjà calculés et clôturés (module `results`) : valeurs exactes et
 * d'affichage, identifiant de version de règle, hash SHA-256 du JSON canonique, signature Ed25519 (clé de l'environnement,
 * jamais du dépôt), trace d'explicabilité. Le PDF est rendu par le WORKER (Puppeteer, JavaScript désactivé, réseau coupé)
 * depuis le snapshot SEUL, stocké via `StoragePort`, vérifiable publiquement par QR code (page sans donnée personnelle).
 * Les gabarits (par pack) et l'identité de l'établissement (branding, signataires) sont des DONNÉES versionnées par tenant.
 *
 * Les entrées viennent de `results` (011), `people` (008), `attendance` (010) et `finance` (014) par des PORTS que ces modules
 * enregistrent (`registerReportcardsPorts`) — d'où `dependsOn: ["rbac"]` seulement (pas de cycle de manifeste).
 *
 * Les permissions et features gardent le préfixe `reportcard.` de la spec 013 §10 (les modèles de rôles du module rbac
 * accordent déjà `reportcard.*` à la direction des études et les motifs `*.self.*` / `*.child.*` aux élèves et parents).
 */
export default defineModule({
  key: "reportcards",
  title: "Bulletins et relevés",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: ["rbac"],
  permissions: [
    { key: "reportcard.read", label: "Consulter les bulletins et relevés émis et en télécharger le PDF" },
    { key: "reportcard.explain", label: "Consulter la trace d'explicabilité d'un bulletin" },
    {
      key: "reportcard.generate",
      label: "Émettre, réémettre et rendre des bulletins et relevés",
      description: "Fige les résultats dans un document signé ; la réémission remplace la version précédente sans l'effacer.",
      sensitive: true,
    },
    {
      key: "reportcard.publish",
      label: "Rendre un bulletin visible aux familles ou le retirer",
      description: "Une publication déclenche la notification des familles.",
      sensitive: true,
    },
    {
      key: "reportcard.revoke",
      label: "Révoquer un document émis",
      description: "Le document reste conservé mais la vérification publique répondra « révoqué ». Motif obligatoire.",
      sensitive: true,
    },
    { key: "reportcard.template.manage", label: "Configurer les modèles de documents et leurs options" },
    {
      key: "reportcard.branding.manage",
      label: "Gérer l'identité de l'établissement imprimée sur les documents",
      description: "Noms, mentions officielles, logo, emblème, couleurs.",
      sensitive: true,
    },
    {
      key: "reportcard.signatory.manage",
      label: "Gérer les signataires des documents",
      description: "Une signature figure sur les documents officiels : acte sensible.",
      sensitive: true,
    },
    { key: "reportcard.self.read", label: "Consulter et télécharger ses propres bulletins publiés (élève)" },
    { key: "reportcard.child.read", label: "Consulter et télécharger les bulletins publiés de ses enfants (parent)" },
  ],
  features: [
    { key: "reportcard.transcript", label: "Relevé de notes cumulé", packs: ["HIGHER", "VIRTUAL"] },
    { key: "reportcard.public-verification", label: "Vérification publique d'authenticité (QR code)", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "reportcard.block-unpaid", label: "Bloquer l'accès aux bulletins en cas d'impayé", packs: [] },
  ],
  menus: [
    { key: "reportcards.issue", label: "Bulletins — émission", href: "/admin/bulletins/emission", permission: "reportcard.generate", portal: "admin", icon: "file-badge", order: 400 },
    { key: "reportcards.list", label: "Bulletins — liste", href: "/admin/bulletins", permission: "reportcard.read", portal: "admin", icon: "files", order: 410 },
    { key: "reportcards.identity", label: "Identité et signataires", href: "/admin/bulletins/identite", permission: "reportcard.branding.manage", portal: "admin", icon: "stamp", order: 420 },
    { key: "reportcards.templates", label: "Modèles de documents", href: "/admin/bulletins/modeles", permission: "reportcard.template.manage", portal: "admin", icon: "layout-template", order: 430 },
    { key: "reportcards.child", label: "Bulletins de mes enfants", href: "/parent/bulletins", permission: "reportcard.child.read", portal: "parent", icon: "file-text", order: 400 },
    { key: "reportcards.self", label: "Mes bulletins", href: "/student/bulletins", permission: "reportcard.self.read", portal: "student", icon: "file-text", order: 400 },
  ],
  events: {
    publishes: [...ALL_REPORTCARDS_EVENT_TYPES],
    // Ses propres événements déclenchent le rendu des PDF (abonnés du worker) ; les événements `results.*` ci-dessous
    // ne sont pas encore consommés (voir `ConsumedEvents`).
    consumes: [
      ConsumedEvents.TENANT_PROVISIONED,
      ReportcardsEvents.SNAPSHOT_CREATED,
      ReportcardsEvents.RENDER_REQUESTED,
      ReportcardsEvents.BATCH_COMPLETED,
    ],
  },
});
