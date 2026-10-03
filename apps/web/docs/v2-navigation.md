# Navigation des écrans `/v2` : coque commune par rôle

Tous les écrans `/v2` d'un établissement (sauf les écrans publics, voir plus bas) s'affichent dans une **coque de navigation** : en-tête
avec le nom de l'établissement, menu global, changement de module, compte et déconnexion, fil d'Ariane. Code : `src/platform/shell/**`
(+ `platform/admin/shell/Shell.tsx`, `TenantAdminShell.tsx`, `platform/portal/PortalShell.tsx`).

## Qui pose la coque

Le `layout.tsx` de **premier niveau** de chaque module (`app/v2/<module>/layout.tsx`, `(admin)`, `(auth)/account`, `(auth)/admin`, `home`)
enveloppe son contenu dans `<AppShell>` (composant serveur, `platform/shell/AppShell.tsx`). Un seul `AppShell` par chemin ; les layouts
de sections plus profondes ne le reposent pas. `PortalShell` et `TenantAdminShell` ne sont jamais posés directement par une page.

`AppShell` exige une session (sinon `/login`) puis choisit la coque d'après le **rôle actif de la session**, jamais d'après l'URL :

| Rôle actif | Coque |
|---|---|
| propriétaire, administrateur, directeur, directeur des études, responsable pédagogique, secrétariat, économe, éducateur, responsable des examens, chargé des admissions | gestion : `TenantAdminShell` |
| parent | `PortalShell portal="parent"` |
| élève, étudiant | `PortalShell portal="student"` |
| enseignant, instituteur, instituteur de maternelle, formateur | `PortalShell portal="teacher"` |
| rôle inconnu | permissions : `student.child.read` -> parent, `student.self.read` -> élève, `staff.own.read` sans droit de gestion -> enseignant ; sinon gestion (dont le menu n'affiche que le permis) |

Table : `platform/shell/resolve-shell.ts` (`resolveShellKind`, pure, testée). Changer de rôle (menu du compte) ouvre une nouvelle session,
l'atterrissage du nouveau rôle et recharge les composants serveur : la coque suit.

**Écrans partagés** : un même écran de module sert plusieurs publics (`/v2/finance/me/*`, `/v2/examinations/family`,
`/v2/councils/famille`, `/v2/primary/mon-enfant`, `/v2/schoollife/famille|moi|saisie`, `/v2/stateassign/family`, `/v2/messages`...). Il reçoit
la coque de celui qui le consulte. Les gardes de page (`requirePermission`) et l'API restent les barrières.

## Ce que contient la coque de gestion

- **Marque** : nom (et logo https ou interne) de l'établissement, lus par `useShellBranding` (`platform/shell/branding.ts`) :
  `GET /api/v1/tenancy/branding` (tout membre), repli sur `GET /api/v1/tenancy/profile` **seulement si** le compte détient
  `tenancy.institution.read`, sinon libellé générique « Administration ». Aucun 403 attendu n'est provoqué ; aucune erreur affichée.
- **Fonctionnalités de l'offre** : `useMyEntitlements` lit `GET /api/v1/entitlements/me/features` (tout membre) puis, en repli, `GET /api/v1/entitlements/me`
  (direction). Elles filtrent les entrées de menu soumises à une fonctionnalité (échec fermé : inconnue = non active).
- **Menu global** : `GET /api/v1/rbac/me/navigation`, portails `admin` + `owner` (filtré côté API par permissions et fonctionnalités), complété par les
  entrées locales v2 permises (`buildV2Menu`), puis `buildManagementEntries` (`platform/shell/modules.ts`) : routes historiques `/admin/...` réécrites
  vers `/v2/...`, **entrées sans écran v2 masquées** (`attendance.settings`, `people.settings`, `scheduling.calendar`, `scheduling.validation`,
  tant que leur écran n'existe pas), destinations dédoublonnées. Regroupé par module (préfixe de la clé : `finance.*`, `people.*`...), un groupe
  repliable par module, celui de la page courante ouvert ; liste plate sous 12 entrées.
- **Changement de module** : bouton « Modules » (panneau de liens, `aria-current`, Échap) listant les modules accessibles.
- **Compte** : identité, rôle actif, changement de rôle et d'établissement (authentification V2 seulement, `useSessionSwitch` : actions
  `switch-role` / `switch-tenant` de `useSession().update`), liens sécurité, sessions, notifications, établissements. **Déconnexion** : bouton
  toujours visible (purge des données hors ligne puis `signOut`).
- **Fil d'Ariane** : Accueil > Module > Entrée de menu > Détail, déduit du menu autorisé (aucune étape inventée ; masqué hors menu).
- **Accueil de gestion** `/v2/home` : une carte par module avec les écrans accessibles (atterrissage des rôles sans écran propre).
  Atterrissages : `lib/role-landing.ts` (`v2RouteForRole` ; propriétaire et directeur -> `/v2/direction`, `/v2/owner` y redirige,
  fraîcheur des données : `/v2/owner/fraicheur`).

Le portail (`PortalShell`) a les mêmes éléments (marque, compte, déconnexion, fil d'Ariane) avec son menu statique filtré par permissions et
fonctionnalités (`portal/menus.ts`).

## Accessibilité et mobile

Lien d'évitement vers `#v2-main`, `nav` nommée, `aside` + tiroir mobile (`aria-expanded`, `aria-controls`, Échap, focus rendu au bouton),
panneaux d'en-tête en motif disclosure (pas de `role="menu"`), un seul `main` par page (les anciens `<main>` de module sont des `div`).
À chaque changement de **page** (chemin) le focus passe au `main` et le contenu revient en haut. Cibles tactiles >= 44 px, aucun défilement
horizontal. Impression : barre, menu et fil d'Ariane masqués, contenu pleine page.

## Écrans sans coque (publics ou coque propre)

`(auth)/login`, `forgot-password`, `reset-password`, `apply/[school]` (candidature publique), `verify` (vérification de document),
`notifications/unsubscribe` (lien signé), `platform` (console opérateur, `OperatorShell`). La liste est dans
`app/v2/shell-coverage.test.ts` (`PUBLIC_ROUTES`, avec la raison).

## Garde-fous

- `app/v2/shell-coverage.test.ts` : chaque `page.tsx` de `app/v2` est sous un `AppShell` (ou publique listée), jamais deux coques imbriquées,
  `PortalShell`/`TenantAdminShell` absents des pages, menu de gestion construit avec TOUTES les entrées des manifestes sans destination sans page.
- `platform/shell/*.test.ts(x)` : choix de coque par rôle, menus par permissions, écran partagé famille/gestion, marque et fonctionnalités avec
  repli, compte, changement de rôle, focus, axe (0 serious/critical).
- Ajouter un module : poser `<AppShell>` dans son `layout.tsx` de premier niveau (le test le réclame) et, si le module a un menu dans l'API, rien
  d'autre : l'entrée apparaît dans le groupe de son préfixe de clé ; ajouter son libellé sous `v2Shell.modules.<préfixe>` (sinon libellé de repli lisible).
- Balayage QA : `scripts/qa/analyze.mjs` signale `no-shell` sur tout écran `/v2` sans déconnexion ni navigation globale.
