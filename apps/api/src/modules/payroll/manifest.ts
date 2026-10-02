import { defineModule } from "@ecoledigitale/kernel";
import { ALL_PAYROLL_EVENT_TYPES, CONSUMED_EVENT_TYPES } from "./domain/events";

/**
 * Module `payroll` — rémunération des enseignants (spec v2/032) : périodes de paie (collectives ou ciblées, qui
 * peuvent se chevaucher), configurations datées (salaire / horaire / mixte), tarifs horaires par nœud de
 * curriculum, collecte des heures par PORTS (séances réalisées de `scheduling`, présences enseignants de
 * `attendance`), bulletins de paie à lignes cohérentes avec le total PAR CONSTRUCTION, heures supplémentaires
 * hebdomadaires sur le cumul des origines, états calculé → arrêté (approuvé) → versé (payé) imposés par la base,
 * primes et retenues préservées au recalcul, validation par le propriétaire, accès au bulletin réservé à son
 * titulaire ou à la gestion, journal à auteur figé, export, notifications par événements.
 *
 * UNE HEURE (et un jour de salaire) NE SE PAIE QU'UNE FOIS : `hour_claims` / `salary_day_claims` en portent la
 * clé primaire. Aucun seuil ni taux dans le code : seuils et majorations viennent des réglages et des
 * configurations (données), les tarifs de la table des tarifs.
 *
 * `dependsOn: ["rbac"]` : routes protégées par `requirePermission`. Les séances, présences, nœuds de curriculum et
 * enseignants ne sont connus que par UUID, via les ports `HoursSourcePort`, `StaffDirectoryPort`,
 * `CurriculumLabelPort` (aucune dépendance de code envers scheduling, attendance, people ou academic).
 * La validation des séances pour la paie est un acte de `scheduling` (`schedule.occurrence.validate`).
 */
export default defineModule({
  key: "payroll",
  title: "Rémunération des enseignants",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: ["rbac"],
  permissions: [
    { key: "payroll.settings.manage", label: "Régler les paramètres de paie", description: "Seuil d'heures supplémentaires par défaut, majoration, séparation des tâches, seuil propriétaire.", sensitive: true },
    { key: "payroll.config.read", label: "Consulter les configurations de paie" },
    { key: "payroll.config.manage", label: "Gérer les configurations de paie des enseignants", description: "Salaires et tarifs par défaut : données sensibles, auditées.", sensitive: true },
    { key: "payroll.rate.read", label: "Consulter les tarifs horaires" },
    { key: "payroll.rate.manage", label: "Gérer les tarifs horaires", sensitive: true },
    { key: "payroll.period.manage", label: "Gérer les périodes de paie" },
    { key: "payroll.run.calculate", label: "Lancer un calcul de paie ou un aperçu", description: "Un calcul réclame des heures : acte sensible, audité.", sensitive: true },
    { key: "payroll.payslip.read", label: "Consulter tous les bulletins de paie", description: "Les salaires sont des données sensibles : lecture et export audités.", sensitive: true },
    { key: "payroll.payslip.read_own", label: "Consulter ses propres bulletins de paie (personnel)" },
    { key: "payroll.my.dispute", label: "Contester son propre bulletin de paie (personnel)", description: "Le titulaire conteste SON bulletin arrêté et non payé, avec un motif ; n'arrête ni ne verse rien." },
    { key: "payroll.payslip.adjust", label: "Saisir des primes et retenues sur un bulletin calculé", sensitive: true },
    { key: "payroll.payslip.approve", label: "Arrêter le montant d'un bulletin et le contester", description: "Arrêter n'est pas verser. Authentification forte requise.", sensitive: true },
    { key: "payroll.payslip.approve_owner", label: "Arrêter un bulletin au-delà du seuil propriétaire", description: "Réservée au propriétaire quand un seuil de validation est réglé.", sensitive: true },
    { key: "payroll.payslip.pay", label: "Constater le versement d'un bulletin", sensitive: true },
    { key: "payroll.payslip.cancel", label: "Annuler un bulletin de paie", description: "Relâche ses heures ; un bulletin payé ne s'annule pas.", sensitive: true },
    { key: "payroll.payslip.notify", label: "Envoyer un bulletin à son titulaire" },
    { key: "payroll.report.read", label: "Consulter les rapports de paie et la masse salariale" },
  ],
  features: [
    { key: "payroll.core", label: "Rémunération des enseignants (périodes, configurations, bulletins)", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "payroll.owner-validation", label: "Masse salariale et validation par le propriétaire", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "payroll.session-source", label: "Heures issues des séances réalisées et validées (emploi du temps)", packs: ["HIGHER", "VIRTUAL"] },
    { key: "payroll.attendance-source", label: "Heures issues des présences enseignants", packs: ["PRIMARY", "SECONDARY"] },
  ],
  menus: [
    { key: "payroll.payslips", label: "Bulletins de paie", href: "/admin/paie", permission: "payroll.payslip.read", feature: "payroll.core", portal: "admin", icon: "banknote", order: 500 },
    { key: "payroll.configs", label: "Configuration de la paie", href: "/admin/paie/configuration", permission: "payroll.config.read", feature: "payroll.core", portal: "admin", icon: "settings-2", order: 510 },
    { key: "payroll.history", label: "Historique des paiements", href: "/admin/paie/historique", permission: "payroll.payslip.read", feature: "payroll.core", portal: "admin", icon: "history", order: 520 },
    { key: "payroll.reports", label: "Rapports de paie", href: "/admin/paie/rapports", permission: "payroll.report.read", feature: "payroll.core", portal: "admin", icon: "bar-chart-3", order: 530 },
    { key: "payroll.mass", label: "Masse salariale", href: "/owner/masse-salariale", permission: "payroll.report.read", feature: "payroll.owner-validation", portal: "owner", icon: "wallet", order: 200 },
    { key: "payroll.my-payslips", label: "Mes rémunérations", href: "/enseignant/remuneration", permission: "payroll.payslip.read_own", feature: "payroll.core", portal: "teacher", icon: "receipt", order: 200 },
  ],
  events: {
    publishes: [...ALL_PAYROLL_EVENT_TYPES],
    consumes: [...CONSUMED_EVENT_TYPES],
  },
});
