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
    { key: "finance.cashregister.open", label: "Ouvrir une session de caisse et encaisser des espèces" },
    { key: "finance.cashregister.close", label: "Clôturer une session de caisse (comptage et écart)" },
    { key: "finance.report.read", label: "Consulter les tableaux de bord et rapports financiers" },
    { key: "finance.receipt.read", label: "Consulter et réimprimer les reçus" },
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
  ],
  events: {
    publishes: [...ALL_FINANCE_EVENT_TYPES],
    consumes: [],
  },
});
