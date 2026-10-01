# Bascule de l'authentification : legacy vers `iam`

> Décision : ADR-008 (+ addendum « coexistence »). Objectif : `iam` (identité globale + accès par tenant, sessions à
> refresh rotatif, MFA TOTP, limitation de débit, impersonation auditée) devient la **seule** source d'authentification,
> **sans casser le legacy** pendant la transition. Rien ici ne touche aux données de production : tout est pilotable par
> drapeaux et réversible jusqu'à l'extinction.

## 1. Ce qui existe

| Brique | Où | Rôle |
|---|---|---|
| Passerelle IAM -> legacy | `apps/api/src/platform/legacy-iam-bridge.ts`, `platform/v2-auth.ts`, `plugins/auth-middleware.ts` | Les routes **legacy** acceptent un jeton d'accès IAM v2 et reçoivent le `request.user` qu'elles attendent. |
| Tenant vérifié | `plugins/tenant-context.ts` | Le tenant d'un jeton n'est lu **qu'après vérification** (signature + session). Un JWT forgé, `alg:none`, expiré ou éteint ne désigne plus aucun tenant, même sur une route publique. |
| Extinction des jetons legacy | `LEGACY_TOKEN_SUNSET` | À partir de la date : jeton legacy de tenant refusé (401 `LEGACY_TOKEN_SUNSET`), `/auth/login`, `/auth/refresh`, `/auth/switch-role`, `/auth/social-login`, `/auth/register` fermés (410). |
| Import des utilisateurs | `pnpm iam:import-legacy` | Identités + accès + assignations RBAC, idempotent, **lecture seule** côté legacy. |
| Web V2 | `NEXT_PUBLIC_AUTH_V2=1` | NextAuth (identifiants + Google) sur `/api/v1/iam/*`, pages MFA / sessions / mot de passe / membres. |
| `switch-role`, `federated-login` | module `iam` | Changement de rôle actif (nouvelle session) ; connexion Google par le serveur web (secret de service). |

### Correspondance des rôles (inverse strict de `legacyRoleToTemplate`)

Fichier unique partagé API / web : `packages/contracts/src/v2/iam-legacy-roles.ts`.

| Rôle(s) de l'accès IAM | Rôle legacy vu par les routes legacy |
|---|---|
| `owner`, `admin`, `administrateur`, `teacher`, `formateur`, `student`, `parent` (clés legacy, écrites par l'import) | identique |
| `owner` (modèle RBAC) | `owner` |
| `directeur` **+** `secretariat` **+** `econome` (les trois) | `admin` |
| `enseignant` | `teacher` |
| `eleve` | `student` |
| `parent` | `parent` |
| un modèle **partiel** (`directeur` seul, `econome` seul, `educateur`, `directeur_etudes`…), `super_admin`, clé inconnue | **aucun** : 403 `LEGACY_ROLE_UNMAPPED` (moindre privilège, jamais d'élévation) |

Le compte legacy est retrouvé par **e-mail dans le tenant du jeton** (les tables legacy référencent `users.id`, pas l'identité
IAM). Pas de compte legacy : 403 `LEGACY_ACCOUNT_MISSING`. L'en-tête `X-User-Id` est toujours réécrit avec l'identifiant du
compte legacy du jeton vérifié (jamais une valeur du client).

## 2. Drapeaux et variables

| Variable | Où | Défaut | Effet |
|---|---|---|---|
| `V2_DATABASE_URL`, `IAM_JWT_SECRET`, `IAM_MFA_ENCRYPTION_KEY` | API | — | Active la plateforme v2 (prérequis de tout le reste). |
| `V2_LEGACY_IAM_BRIDGE` | API | actif | `0`/`false`/`off` : les routes legacy refusent à nouveau les jetons IAM (retour au comportement antérieur). Lu à chaque requête. |
| `LEGACY_TOKEN_SUNSET` | API | absente (jamais) | Date ISO 8601 (`2026-11-16` = minuit UTC). Mal formée : **démarrage refusé**. Lue à chaque requête : la repousser ou la retirer rouvre le legacy. |
| `TRUST_PROXY` | API | `false` | Sauts de proxy de confiance (ou CIDR). **Requis** derrière nginx + serveur web : sinon toutes les connexions partagent l'IP du proxy (limiteur de débit, verrouillage, audit, liste « mes sessions »). Le serveur web relaie `X-Forwarded-For` / `User-Agent` du navigateur. |
| `IAM_REFRESH_REUSE_GRACE_MS` | API | `0` | Tolérance (0–30000 ms) des doubles soumissions d'un refresh token. Recommandé web : `0` (la rotation est sérialisée par Web Locks) ; mobile : `3000`. |
| `IAM_SERVICE_SECRET` | API + web | absent | Active `POST /iam/federated-login` (Google). Même valeur des deux côtés. Absent : la route n'existe pas. |
| `AUTH_SOCIAL_SHARED_SECRET` | API + web | absent | `/auth/social-login` legacy exige le secret (en-tête `x-social-login-secret`). **Refusé en production s'il est absent** : la route délivrait un jeton pour n'importe quel e-mail. |
| `NEXT_PUBLIC_AUTH_V2` | web (build) | absent | `1` : connexion V2. Inliné au build -> un déploiement par valeur. |
| `NEXT_PUBLIC_GOOGLE_AUTH` | web (build) | absent | `1` : bouton « Continuer avec Google » sur la page de connexion V2. |
| `LEGACY_DATABASE_URL`, `IAM_IMPORT_TECHNICAL_PASSWORD` | poste d'import | `DATABASE_URL` / absent | Voir §4. |

## 3. Plan de bascule recommandé (dates proposées, à confirmer par le propriétaire du produit)

| Étape | Quand (proposition) | Actions | Critère de passage |
|---|---|---|---|
| 0. Préparer | J-21 (2026-10-12) | Secrets IAM, `V2_DATABASE_URL`, migrations, démarrer l'API une fois (synchronisation des tenants + rattrapage + rôles système), `TRUST_PROXY`, SMTP (`SMTP_*`, `V2_APP_BASE_URL`), worker, `AUTH_SOCIAL_SHARED_SECRET` (**correctif de sécurité, à faire immédiatement**, indépendamment de la bascule). | `pnpm test:phase1` vert ; `GET /api/v1/iam/me` répond 401 sans jeton. |
| 1. Import à blanc | J-14 | `pnpm iam:import-legacy -- --dry-run --report ./rapport.json`, revue des cas ambigus (§5), correction à la source (e-mails invalides, doublons de casse, comptes sans rôle). | Rapport sans `rbac_failed` ni `import_error`. |
| 2. Import réel | J-10 | `pnpm iam:import-legacy -- --report ./rapport.json` (idempotent). **Prévenir les administrateurs et propriétaires** : leur première connexion exige l'enrôlement MFA (rôles `owner`, `admin` par défaut ; `IAM_MFA_REQUIRED_ROLES` pour ajuster). | Identités = comptes actifs du legacy ; assignations RBAC présentes. |
| 3. Pilote | J-7 | Déployer le web avec `NEXT_PUBLIC_AUTH_V2=1` pour **un** établissement (sous-domaine dédié ou environnement de recette). Les jetons legacy restent acceptés. | E2E (`pnpm test:e2e:auth`) vert ; connexion, MFA, déconnexion, mes sessions validés par le pilote. |
| 4. Bascule générale | J (2026-11-02) | Relancer l'import (nouveaux comptes créés depuis), `NEXT_PUBLIC_AUTH_V2=1` partout, redéployer. Geler la création de comptes côté legacy pendant la fenêtre (ou relancer l'import toutes les 5 min). | Aucune 401/403 `LEGACY_ACCOUNT_MISSING` inattendue dans les journaux. |
| 5. Coexistence | J à J+14 | Les sessions legacy en cours (24 h max) continuent ; le login legacy reste possible (retour arrière). Surveiller `LEGACY_ROLE_UNMAPPED`, `LEGACY_ACCOUNT_MISSING`, 429. | Plus de jeton legacy émis depuis J+1. |
| 6. Extinction | **J+14 (2026-11-16, minuit UTC)** | `LEGACY_TOKEN_SUNSET=2026-11-16`. Login / refresh legacy fermés (410), jetons legacy refusés. Le super-admin legacy (JWT séparé) n'est pas concerné. | Taux de `LEGACY_TOKEN_SUNSET` -> 0. Étape suivante (hors périmètre) : retirer le code de login legacy. |

### Retour arrière (à chaque étape)

1. **Web** : retirer `NEXT_PUBLIC_AUTH_V2`, redéployer -> connexion legacy rétablie (les jetons IAM déjà émis restent valides jusqu'à 15 min).
2. **Passerelle** : `V2_LEGACY_IAM_BRIDGE=0` -> les routes legacy ne lisent plus les jetons IAM (401 comme avant).
3. **Extinction** : retirer `LEGACY_TOKEN_SUNSET` ou la repousser -> le login / le refresh legacy rouvrent immédiatement (lue à chaque requête).
4. **Sessions IAM** : déconnexion globale d'une personne (`POST /iam/logout-all`) ou d'un membre (`/iam/admin/members/:id/sessions/revoke`) ; les données IAM (identités, accès) sont conservées.
5. Rien n'est supprimé dans le legacy : l'import est en lecture seule.

## 4. Import des utilisateurs : `pnpm iam:import-legacy`

```bash
pnpm iam:import-legacy -- --dry-run --report ./rapport.json     # simulation complète (rien n'est écrit)
pnpm iam:import-legacy -- --report ./rapport.json               # import réel, idempotent
pnpm iam:import-legacy -- --tenant mon-ecole                    # un seul établissement
```

- Entrées : `LEGACY_DATABASE_URL` (défaut `DATABASE_URL`) ouverte en `default_transaction_read_only=on` ; `V2_DATABASE_URL` (rôle `app_user`, superuser refusé, comme l'API).
- Rôles = **exactement ce que le login legacy donnerait** (`user_roles` + rôles déduits des profils enseignant / élève / parent), conservés tels quels (`admin`, `teacher`…) dans l'accès IAM, puis assignations RBAC par `legacyRoleToTemplate` (`admin` -> directeur + secretariat + econome).
- Mots de passe : le hash bcrypt est conservé (`provisionMember({ passwordHash })`) et **re-haché en scrypt au premier login réussi**. Aucun mot de passe n'est lu, écrit ou journalisé ; aucune invitation n'est envoyée.
- Comptes techniques (`users.is_technical_account`) : importés **seulement** si `IAM_IMPORT_TECHNICAL_PASSWORD` est défini (jamais de défaut ; leur hash legacy, potentiellement connu, n'est pas repris).
- Super-admin : hors périmètre (table `super_admin_users` jamais lue ; rôle `super_admin` ignoré et signalé).
- L'import **crée** ce qui manque ; il ne modifie pas un accès existant (iam fait foi) : un écart est signalé (`role_drift`).
- Préalable : l'API a démarré au moins une fois (tenant dans `kernel.tenants`, rôles système instanciés).
- Preuve : `pnpm --filter @ecoledigitale/api test:auth-import` (base legacy issue des seeds de `tests/characterization`, schéma réel).

## 5. Cas ambigus rapportés (jamais devinés)

| Type | Décision de l'import | À faire |
|---|---|---|
| `shared_email` | Une identité, plusieurs accès ; mot de passe du compte **le plus ancien** retenu. (L'index legacy `users_email_global_key` est sensible à la casse : seuls des e-mails ne différant que par la casse peuvent se partager entre établissements.) | Les autres personnes réinitialisent leur mot de passe. |
| `duplicate_in_tenant` | Le plus ancien est importé, les autres ignorés. | Fusionner / supprimer côté legacy. |
| `unknown_role` | Rôle conservé dans l'accès, aucune assignation RBAC ; refus 403 `LEGACY_ROLE_UNMAPPED` sur les routes legacy tant que le rôle n'a pas d'équivalent. | Décider : rôle personnalisé RBAC ou rôle standard. |
| `role_ignored` | `super_admin` et clés de rôle non représentables ignorés. | — |
| `no_roles`, `inactive_user`, `invalid_email` | Ignorés (le login legacy échoue déjà pour les deux premiers). | Corriger la source puis relancer. |
| `no_password_hash`, `unusable_password_hash` | Accès créé sans mot de passe, **aucune invitation** (pas d'envoi massif). | « Mot de passe oublié » ou connexion Google. |
| `technical_account_skipped` / `_imported` | Voir §4. | Définir `IAM_IMPORT_TECHNICAL_PASSWORD` ou s'en passer (l'impersonation IAM remplace ces comptes). |
| `tenant_not_in_v2`, `tenant_inactive` | Établissement ignoré. | Démarrer l'API (synchronisation) puis relancer. |
| `role_drift` | Accès IAM existant non modifié (ou non actif). | Corriger dans iam (administration des membres). |
| `rbac_failed`, `import_error` | Compte laissé en l'état. | Lire le détail (code d'erreur), relancer. |

## 6. Points à arbitrer par le propriétaire du produit

1. **MFA des administrateurs et propriétaires** : la politique par défaut (`owner`, `admin`, `director`, `bursar`, `accountant`, `super_admin`) impose l'enrôlement à la première connexion V2 de **tous** les comptes `admin`/`owner` importés. Confirmer, communiquer, ou restreindre `IAM_MFA_REQUIRED_ROLES` pour la phase pilote.
2. **Dates** : pilote 2026-10-12, bascule 2026-11-02, extinction 2026-11-16 sont des propositions.
3. **Création de comptes legacy après la bascule** : les inscriptions approuvées, imports d'élèves, créations d'enseignants écrivent encore dans `users`. Tant qu'elles ne passent pas par `iam.provisionMember`, il faut relancer l'import (planifié toutes les 5 min pendant la coexistence). À porter par tranche (Phase 2).
4. **Rôles IAM des nouveaux comptes** : l'administration des membres (`/v2/admin/members`) attribue des clés legacy (`teacher`, `student`…) et les rôles RBAC équivalents ; les modèles v2 purs (`enseignant`…) fonctionnent aussi mais un modèle partiel ne donne aucun accès aux routes legacy.
5. **Google** : désormais fédéré par iam (`IAM_SERVICE_SECRET`) ; plus de création de compte « étudiant » à la volée (l'ancien comportement). Sans secret, repli transitoire sur le legacy (jeton de 24 h).
6. **Invitation par `/v2/admin/members`** : crée l'accès IAM + les assignations RBAC, **pas** de compte legacy. Tant que les écrans sont legacy, la personne invitée obtient 403 `LEGACY_ACCOUNT_MISSING` sur ces écrans : continuer à créer enseignants / élèves / parents par les écrans legacy (puis import), et réserver l'invitation IAM aux modules portés (`people`…).
7. **Google et adresse du client** : le callback `signIn` d'OAuth n'a pas accès aux en-têtes de la requête ; l'appel fédéré présente donc l'adresse du serveur web (le plafond de débit par IP de `login` est partagé pour les connexions Google). Acceptable en pilote ; à revoir si Google devient majoritaire.
8. **Sondes / outils** : tout appelant qui poussait un `X-User-Id` arbitraire est désormais ignoré (réécrit) pour les jetons IAM.

## 7. Vérifier

```bash
pnpm check:boundaries && pnpm check:secrets && pnpm test:isolation
pnpm --filter @ecoledigitale/api type-check:v2
pnpm --filter @ecoledigitale/api test:auth-bridge      # passerelle, jetons forgés, révocation, extinction, MFA, Origin/CSRF, impersonation (Postgres éphémère)
pnpm --filter @ecoledigitale/api test:auth-import      # import sur base legacy issue des seeds de caractérisation
pnpm test:phase1                                       # assemblage complet (Postgres + Redis + worker)
pnpm --filter @ecoledigitale/web test                  # Vitest (NextAuth V2, client iam, rôles)
pnpm test:e2e:auth                                     # Playwright : connexion -> MFA -> navigation -> rotation -> déconnexion (faux iam, sans base)
```

Limites connues : le test e2e utilise un **faux** module iam (contrat figé) ; l'e2e contre la vraie pile (API + Postgres + Redis +
Next) reste manuel : démarrer la pile (`docs/architecture/platform-assembly.md` §9), puis `NEXT_PUBLIC_AUTH_V2=1 pnpm dev:web`.
