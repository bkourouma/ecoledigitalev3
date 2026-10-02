import { defineModule } from "@ecoledigitale/kernel";
import { ALL_EVENT_TYPES, ConsumedEvents, CouncilsEvents } from "./domain/events";

/**
 * Manifeste du module "councils" — conseil de classe du secondaire (spec v2/006 US1-US7) : séances, ordre du jour figé, propositions et
 * décisions HUMAINES, procès-verbal scellé et signé, déverrouillage motivé, effets idempotents, orientation et transferts de série.
 * Source de vérité de ses permissions, features, menus et événements. Le nom du dossier, la clé et le schéma Postgres sont identiques.
 * Aucune règle réglementaire : quorum, rôles exigés, signataires, types de décision, parcours d'orientation sont des DONNÉES.
 */
export default defineModule({
  key: "councils",
  title: "Conseils de classe",
  // Agnostique du pack (types en données) : ouvert au pack SECONDARY ; pourra l'être à PRIMARY (conseil des maîtres) sans changement de schéma.
  packs: ["SECONDARY"],
  // Aucune dépendance de chargement : les autres modules arrivent par des PORTS (platform/adapters).
  dependsOn: [],
  permissions: [
    { key: "council.read", label: "Consulter conseils, ordres du jour et décisions" },
    { key: "council.manage", label: "Planifier, convoquer, composer et annuler un conseil" },
    { key: "council.prepare", label: "Préparer l'ordre du jour et reconstruire un instantané" },
    { key: "council.session.run", label: "Ouvrir et clore une séance", sensitive: true },
    { key: "council.proposal.write", label: "Proposer appréciations, distinctions et décisions" },
    { key: "council.decision.record", label: "Enregistrer et retirer une décision, résoudre une proposition", sensitive: true },
    { key: "council.minutes.generate", label: "Générer le procès-verbal" },
    { key: "council.minutes.read", label: "Lire les procès-verbaux" },
    { key: "council.minutes.sign", label: "Signer un procès-verbal", sensitive: true },
    { key: "council.minutes.revoke", label: "Révoquer un procès-verbal", sensitive: true },
    { key: "council.unlock.request", label: "Demander le déverrouillage d'une séance" },
    { key: "council.unlock.approve", label: "Approuver un déverrouillage et rouvrir la séance", sensitive: true },
    { key: "council.effect.manage", label: "Suivre et relancer les effets des décisions" },
    { key: "council.exclusion.apply", label: "Appliquer l'effet d'une décision d'exclusion (acte humain)", sensitive: true },
    { key: "council.settings.manage", label: "Paramétrer rôles, types de conseil, types de décision et réglages", sensitive: true },
    { key: "council.orientation.read", label: "Consulter l'orientation (parcours, dossiers, transferts)" },
    { key: "council.orientation.manage", label: "Gérer dossiers d'orientation et transferts de série" },
    { key: "council.orientation.override", label: "Déroger à un parcours d'orientation autorisé", sensitive: true },
    { key: "council.self.read", label: "Lire les décisions du conseil qui le concernent (élève)" },
    { key: "council.child.read", label: "Lire les décisions du conseil concernant ses enfants (parent)" },
  ],
  features: [
    { key: "councils.core", label: "Conseils de classe : séances, décisions, procès-verbal", packs: ["SECONDARY"] },
    { key: "councils.orientation", label: "Orientation et transferts de série", packs: ["SECONDARY"] },
  ],
  menus: [
    { key: "councils.calendar", label: "Conseils de classe", href: "/v2/councils", permission: "council.read", feature: "councils.core", portal: "admin", icon: "gavel", order: 500 },
    { key: "councils.effects", label: "Effets des décisions", href: "/v2/councils/effets", permission: "council.effect.manage", feature: "councils.core", portal: "admin", icon: "check", order: 510 },
    { key: "councils.orientation", label: "Orientation", href: "/v2/councils/orientation", permission: "council.orientation.read", feature: "councils.orientation", portal: "admin", icon: "graduation-cap", order: 520 },
    { key: "councils.settings", label: "Paramètres des conseils", href: "/v2/councils/parametres", permission: "council.settings.manage", feature: "councils.core", portal: "admin", icon: "settings", order: 530 },
    { key: "councils.teacher", label: "Conseils de classe", href: "/v2/councils", permission: "council.proposal.write", feature: "councils.core", portal: "teacher", icon: "gavel", order: 500 },
    { key: "councils.family", label: "Décisions du conseil", href: "/v2/councils/famille", permission: "council.child.read", feature: "councils.core", portal: "parent", icon: "gavel", order: 500 },
    { key: "councils.me", label: "Décisions du conseil", href: "/v2/councils/moi", permission: "council.self.read", feature: "councils.core", portal: "student", icon: "gavel", order: 500 },
  ],
  events: {
    publishes: [...ALL_EVENT_TYPES],
    consumes: [ConsumedEvents.INSTITUTION_CREATED, ConsumedEvents.RESULTS_PERIOD_REOPENED, ConsumedEvents.DOCUMENT_RENDERED, CouncilsEvents.MINUTES_GENERATED], // le dernier : abonné `councils.render-minutes` à son propre événement (PDF hors transaction)
  },
});
