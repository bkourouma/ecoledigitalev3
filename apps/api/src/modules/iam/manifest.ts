import { defineModule } from "@ecoledigitale/kernel";

/**
 * Manifeste du module `iam` (identité, sessions, MFA). Socle : toujours actif.
 * Les migrations (schéma `iam`) supposent la baseline `packages/database/migrations`
 * (0001–0003 : rôles, kernel.tenants, outbox) déjà appliquée ; la numérotation des
 * migrations étant globale, la plage 0400–0499 (décision du lead, docs/architecture/module-conventions.md) est réservée à ce module.
 */
export default defineModule({
  key: "iam",
  title: "Identité et accès",
  packs: ["CORE"],
  dependsOn: [],
  permissions: [
    { key: "iam.user.read", label: "Consulter les utilisateurs", description: "Liste des membres de l'établissement, statut, rôles, MFA activée ou non." },
    { key: "iam.user.manage", label: "Gérer les utilisateurs", description: "Suspendre, révoquer, modifier les rôles d'un membre." },
    { key: "iam.user.invite", label: "Inviter des utilisateurs", description: "Créer un accès (et envoyer l'invitation) pour une adresse e-mail." },
    { key: "iam.session.revoke", label: "Révoquer des sessions", description: "Déconnecter un membre de tous ses appareils dans l'établissement." },
    {
      key: "iam.mfa.reset",
      label: "Réinitialiser la vérification en deux étapes",
      description: "Supprime le second facteur d'un membre (perte du téléphone). Exige une session MFA.",
      sensitive: true,
    },
  ],
  features: [],
  menus: [{ key: "iam.users", label: "Utilisateurs", href: "/admin/utilisateurs", permission: "iam.user.read", portal: "admin", icon: "users", order: 90 }],
  events: {
    publishes: [
      "iam.user.logged_in",
      "iam.login.failed",
      "iam.session.revoked",
      "iam.mfa.enabled",
      "iam.mfa.disabled",
      "iam.mfa.reset",
      "iam.mfa.elevated",
      "iam.password.changed",
      "iam.impersonation.started",
      "iam.membership.created",
      "iam.membership.changed",
    ],
    consumes: [],
  },
});
