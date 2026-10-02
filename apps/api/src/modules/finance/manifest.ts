import { defineModule } from "@ecoledigitale/kernel";
import { ALL_FINANCE_EVENT_TYPES } from "./domain/events";

/**
 * Module `finance` — frais, barèmes, factures, échéanciers, paiements (manuels et en
 * ligne), reçus, remboursements, avoirs, remises, bourses, caisses, reporting.
 * Socle CORE : toujours actif. Les apprenants et inscriptions ne sont connus que par
 * UUID, via les ports `LearnerDirectory` / `EnrollmentDirectory` (aucune dépendance au
 * cœur académique).
 *
 * `dependsOn: ["rbac"]` : les routes sont protégées par `requirePermission` du module rbac.
 * L'audit est un port optionnel (no-op tant que le module `audit` n'est pas branché).
 */
export default defineModule({
  key: "finance",
  title: "Finance et paiements",
  packs: ["CORE"],
  dependsOn: ["rbac"],
  permissions: [
    { key: "finance.fee.read", label: "Consulter le catalogue de frais, les barèmes et les remises" },
    {
      key: "finance.fee.manage",
      label: "Gérer le catalogue de frais, les barèmes, les plans d'échéancier, les remises et les bourses",
      description: "Définit ce qui sera facturé aux familles.",
    },
    { key: "finance.invoice.read", label: "Consulter les factures, les échéanciers et les relevés d'apprenants" },
    { key: "finance.invoice.create", label: "Créer et émettre des factures, générer des échéanciers" },
    {
      key: "finance.invoice.cancel",
      label: "Annuler une facture ou émettre un avoir",
      description: "Un avoir réduit définitivement le reste dû d'une facture.",
    },
    { key: "finance.payment.read", label: "Consulter les paiements et les remboursements" },
    { key: "finance.payment.create", label: "Enregistrer un paiement, initier un paiement en ligne, imputer un paiement" },
    {
      key: "finance.payment.refund",
      label: "Demander, approuver et exécuter un remboursement",
      description: "Mouvement de fonds sortant : exige l'authentification forte et reste toujours audité.",
      sensitive: true,
    },
    {
      key: "finance.payment.reconcile",
      label: "Rapprocher les paiements en attente : résoudre à la main un paiement ou un remboursement que le fournisseur n'a pas pu confirmer",
      description:
        "Déclare qu'un paiement est arrivé ou non (avec preuve) : crée ou annule un encaissement. Quatre yeux (une autre personne approuve), authentification forte, toujours audité.",
      sensitive: true,
    },
    {
      key: "finance.provider.manage",
      label: "Configurer les fournisseurs de paiement en ligne (identifiants marchands, activation, test de connexion)",
      description: "Les identifiants marchands déterminent où arrive l'argent des familles : exige l'authentification forte, chaque accès aux secrets est audité.",
      sensitive: true,
    },
    { key: "finance.cashregister.open", label: "Ouvrir une session de caisse et encaisser des espèces" },
    { key: "finance.cashregister.close", label: "Clôturer une session de caisse (comptage et écart)" },
    { key: "finance.report.read", label: "Consulter les tableaux de bord et rapports financiers" },
    { key: "finance.receipt.read", label: "Consulter et réimprimer les reçus" },
    // Portails famille : accès filtré par lien de tutelle / identité de l'élève (relu côté serveur à chaque requête).
    { key: "finance.child.read", label: "Consulter la situation financière de ses enfants (factures, échéances, paiements, reçus)" },
    {
      key: "finance.child.pay",
      label: "Payer en ligne la scolarité de ses enfants",
      description: "Initier un paiement en ligne sur une facture d'un enfant lié ; sans effet si la fonctionnalité de paiement en ligne n'est pas souscrite.",
    },
    { key: "finance.self.read", label: "Consulter sa propre situation financière (élève : factures, échéances, paiements, reçus)" },
    { key: "finance.self.pay", label: "Payer en ligne sa propre scolarité (élève)" },
  ],
  features: [
    { key: "finance.installments", label: "Échéanciers de paiement", packs: ["CORE"] },
    { key: "finance.online-payment", label: "Paiement en ligne (Mobile Money, carte)", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "finance.state-assigned", label: "Élèves affectés par l'État (part État / part parent)", packs: ["SECONDARY"] },
  ],
  menus: [
    { key: "finance.invoices", label: "Facturation", href: "/admin/finance/factures", permission: "finance.invoice.read", portal: "admin", icon: "file-text", order: 400 },
    { key: "finance.payments", label: "Encaissements", href: "/admin/finance/paiements", permission: "finance.payment.read", portal: "admin", icon: "wallet", order: 410 },
    { key: "finance.cash", label: "Caisse", href: "/admin/finance/caisse", permission: "finance.cashregister.open", portal: "admin", icon: "banknote", order: 420 },
    { key: "finance.fees", label: "Frais et barèmes", href: "/admin/finance/frais", permission: "finance.fee.read", portal: "admin", icon: "tags", order: 430 },
    { key: "finance.reports", label: "Tableau de bord financier", href: "/admin/finance/rapports", permission: "finance.report.read", portal: "admin", icon: "bar-chart", order: 440 },
    // Entrées conditionnées par une feature du plan/pack : la navigation (`GET /rbac/me/navigation`) les masque
    // tant que l'établissement n'a pas souscrit la feature (le test de sortie de phase 1 s'appuie dessus).
    { key: "finance.online-payments", label: "Paiements en ligne", href: "/admin/finance/paiements-en-ligne", permission: "finance.payment.read", feature: "finance.online-payment", portal: "admin", icon: "smartphone", order: 415 },
    { key: "finance.providers", label: "Fournisseurs de paiement", href: "/admin/finance/fournisseurs", permission: "finance.provider.manage", feature: "finance.online-payment", portal: "admin", icon: "credit-card", order: 416 },
    { key: "finance.state-assigned", label: "Élèves affectés par l'État", href: "/admin/finance/affectes-etat", permission: "finance.fee.read", feature: "finance.state-assigned", portal: "admin", icon: "landmark", order: 435 },
    { key: "finance.child", label: "Scolarité de mes enfants", href: "/parent/finance", permission: "finance.child.read", portal: "parent", icon: "wallet", order: 500 },
    { key: "finance.self", label: "Ma scolarité", href: "/student/finance", permission: "finance.self.read", portal: "student", icon: "wallet", order: 500 },
  ],
  events: {
    publishes: [...ALL_FINANCE_EVENT_TYPES],
    consumes: ["tenancy.institution.created"],
  },
});
