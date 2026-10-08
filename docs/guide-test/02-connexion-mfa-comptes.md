# Chapitre 2. Connexion, double authentification et comptes

Ce chapitre couvre la page de connexion (`/login` et `/v2/login`, avec le panneau des comptes de test), la vérification en deux étapes (MFA par code à 6 chiffres, codes de secours), le verrouillage après échecs, les sessions, le mot de passe oublié et la réinitialisation, la sécurité du compte (`/v2/account/security`), « Mes sessions » (`/v2/account/sessions`), « Mes établissements » (`/v2/account/tenants`) et l'administration des membres (`/v2/admin/members`).

**URL réelle.** `http://localhost:3000/v2/...` (le dossier `app/v2` donne le préfixe `/v2`, groupes `(auth)` retirés). La page de connexion existe à deux adresses qui affichent le même formulaire : `/login` (hors préfixe, celle où redirigent toutes les gardes) et `/v2/login`. Les liens de courrier pointent vers `/auth/invitation` et `/auth/reset-password` (hors préfixe `/v2`) ; `/v2/reset-password` existe aussi.

## Prérequis

- Environnement lancé par `pnpm dev:v2` avec `NEXT_PUBLIC_AUTH_V2=1`, `SHOW_TECHNICAL_ACCOUNTS=true` et `DEV_CREDENTIALS_FILE` (fichier local `.dev-v2/credentials.json`) : c'est ce qui fait apparaître le panneau de comptes et le code MFA automatique.
- **Aucun courrier n'existe** : pas de transport SMTP, donc aucun lien d'invitation ni de réinitialisation ne peut être lu (le notifieur journalise "NON envoyée" sans le jeton). Les scénarios qui exigent un lien sont limités à ce qui se voit avant le lien (message de confirmation) ou avec un lien **invalide** ; le parcours "lien valide" est "Non couvert". Si l'exploitant branche un serveur SMTP local de test (variables `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` de l'API, `V2_APP_BASE_URL` pour les liens), les cas marqués "avec courrier" deviennent exécutables.
- **Mots de passe** : jamais écrits ici. Le panneau de `/v2/login` les remplit au clic. Les scénarios 2.11 à 2.13 exigent de **taper** le mot de passe actuel d'un compte : il se lit dans le fichier local `.dev-v2/credentials.json` (champ `password` du compte), accessible seulement sur la machine qui héberge l'application. Un agent sans accès à ce fichier note ces scénarios "non exécutés" et ne cherche pas le mot de passe ailleurs. Ne jamais copier un mot de passe, un code MFA ou un code de secours dans un rapport.
- **Compte d'essai des scénarios de sécurité** : `educateur@primaire-test.test` (Éducateur, École Les Palmiers, sans MFA au départ). C'est le seul compte dont on change le mot de passe ou la MFA ; son propriétaire `direction.generale@primaire-test.test` sait le remettre à l'état d'origine (scénario 2.13). Les autres comptes de départ ne sont jamais modifiés.
- Ordre conseillé : 2.1 à 2.9, 2.10, 2.14, puis 2.11 à 2.13, 2.15 à 2.18. 2.5 et 2.6 comptent des échecs (blocage d'une minute) : ne pas les répéter à la suite.
- Fenêtres : A normale, B privée, C privée (un compte par fenêtre).

## Comptes à utiliser

| Rôle | Établissement | E-mail | MFA |
|---|---|---|---|
| Propriétaire | Collège Le Baobab | `direction.generale@secondaire-test.test` | oui |
| Propriétaire | École Les Palmiers | `direction.generale@primaire-test.test` | oui |
| Directeur | Collège Le Baobab | `directeur@secondaire-test.test` | oui |
| Secrétariat | Collège Le Baobab | `secretariat@secondaire-test.test` | oui |
| Économe | Université Horizon | `econome@superieur-test.test` | oui |
| Enseignant | Collège Le Baobab | `enseignant@secondaire-test.test` | non |
| Éducateur (compte d'essai) | École Les Palmiers | `educateur@primaire-test.test` | non |
| Parent, Élève | Collège Le Baobab | `parent@secondaire-test.test`, `eleve@secondaire-test.test` | non |
| Chargé d'admissions | Collège Le Baobab | `admissions@secondaire-test.test` | non |

Règles de connexion (code `apps/api/src/modules/iam`) :
- Mot de passe : 12 caractères minimum, 128 au plus, aucune obligation de majuscule, chiffre ou symbole. Refusés : mots de passe courants (liste intégrée, avec chiffres à la place de lettres), l'adresse e-mail ou son identifiant (4 caractères ou plus), les répétitions, les suites de caractères, et, au changement, le nom ou l'identifiant de l'établissement et l'ancien mot de passe.
- Connexion : 5 échecs pour une même adresse saisie depuis un même poste en 15 minutes verrouillent **cette adresse** 1 minute (2, 4… jusqu'à 1 heure en cas de récidive). Le verrou s'applique aussi à une adresse **inexistante** (c'est ce qui permet de le tester sans risque). Au-delà de 25 échecs sur la même adresse, tous postes confondus : 5 minutes.
- MFA : 5 codes faux en 10 minutes verrouillent 1 minute ; un défi MFA vaut 5 minutes et 5 essais ; un code ne sert qu'une fois (anti-rejeu).
- Mot de passe oublié : 3 demandes par heure et par adresse (silencieux). Lien de réinitialisation 30 minutes, invitation 7 jours.
- Session : jeton d'accès renouvelé automatiquement (15 minutes), inactivité 14 jours, durée maximale 30 jours (non testables par attente).

## Droits

| Écran | Qui y accède | Détail |
|---|---|---|
| `/login`, `/v2/login`, `/v2/forgot-password`, `/v2/reset-password` | tout le monde | pages publiques |
| `/v2/account/security`, `/v2/account/sessions`, `/v2/account/tenants` | toute personne connectée | dans la coque de son rôle ; non connecté : retour à `/login` |
| `/v2/admin/members` | la page s'ouvre pour toute personne connectée, mais les données exigent `iam.user.read` (propriétaire, directeur) ; inviter : `iam.user.invite` ; suspendre/rétablir : `iam.user.manage` ; révoquer les sessions : `iam.session.revoke` ; réinitialiser la MFA : `iam.mfa.reset` (sensible) | pas de garde de page : un rôle sans droit voit le formulaire puis "Action non autorisée." |
| `/v2` | toute personne connectée | redirige vers l'écran d'arrivée du rôle |

**Adresses à taper à la main :**

| Compte | Adresse | Résultat attendu |
|---|---|---|
| Personne non connectée | `/v2/account/security`, `/v2/account/sessions`, `/v2/account/tenants`, `/v2/admin/members`, `/v2` | retour à `/login` |
| Enseignant | `/v2/admin/members` | la page s'ouvre, la liste est remplacée par "Action non autorisée." ; "Inviter" est refusé |
| Parent, Élève | `/v2/admin/members` | idem |
| Secrétariat | `/v2/admin/members` | idem |
| Directeur | `/v2/admin/members` | liste visible ; invitation avec le rôle « Administrateur » refusée ("Action non autorisée.") |

## Données de départ

Source : `scripts/dev-v2/seed.ts`, `scripts/seed-v2/actors.ts`. 37 comptes (12 au Collège, 13 à l'École, 12 à l'Université). Les propriétaires sont enrôlés à la MFA par le seed (invités, activés, enrôlés) ; les rôles directeur, études, pédagogie, secrétariat et économe le sont aussi ; les autres rôles n'ont pas de MFA. Chaque compte n'appartient qu'à **un** établissement.

---

#### 2.1 Page de connexion et panneau des comptes de test
Compte : aucun · Où : `http://localhost:3000/login` (`/login`) et `/v2/login` · Prérequis : aucun
1. Ouvrir `/v2/login`. Le formulaire à gauche : titre « Connexion », texte "Accédez à votre espace éducatif.", champs « Adresse e-mail » et « Mot de passe », bouton « Se connecter » (inactif tant que les deux champs sont vides), liens "Mot de passe oublié ?" et "S'inscrire en ligne".
2. À droite, un panneau « Comptes par tenant » (région "Comptes de test") : texte "Cliquez un compte pour remplir le formulaire de connexion.", liste de comptes groupés par établissement (`secondaire-test`, `primaire-test`, `superieur-test`). Chaque bouton montre le rôle, un badge "MFA" pour les comptes à double authentification et l'e-mail.
3. Le sélecteur « Établissement » du panneau propose « Tous les établissements » et chaque établissement ; filtrer sur `primaire-test` ne laisse que ses 13 comptes.
4. Cliquer un compte sans MFA (par exemple Enseignant du Collège) : l'e-mail et le mot de passe se remplissent (champ mot de passe masqué).
5. Cliquer un compte à MFA : sous le bouton, un bloc propose "Afficher le code MFA" ; après clic, le code à 6 chiffres, "expire dans N s" et "Copier le code MFA actuel" (qui devient "Copié"). Le code se renouvelle seul.
6. Ouvrir `/login` : le formulaire s'affiche. **Constat à la vérification du guide (navigateur intégré, 2026-10-08, après 4 secondes d'attente) : le panneau de comptes n'apparaissait pas sur `/login`, alors qu'il apparaissait sur `/v2/login`** (l'API `/api/technical-accounts` répondait bien avec les 37 comptes). À consigner comme écart (Mineur) si le panneau est absent chez vous aussi ; se connecter alors par `/v2/login`.
7. Si Chrome préremplit une adresse ou un mot de passe de son gestionnaire, cliquer un compte du panneau les remplace.
Résultat attendu : étapes conformes ; aucune erreur de console. Si le panneau est absent (`SHOW_TECHNICAL_ACCOUNTS` coupé), le formulaire seul s'affiche : noter et arrêter. Si le mot de passe n'est pas configuré, un avis "Mot de passe non configuré : un clic remplit seulement l'e-mail." s'affiche (cas non attendu ici).
Le lien "S'inscrire en ligne" mène à `/register`, page de l'ancienne application hors périmètre (ne pas l'utiliser).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.2 Connexion sans MFA et page d'arrivée par rôle
Compte : enseignant du Collège (puis chaque rôle du tableau) · Où : `/login` · Prérequis : 2.1
1. Cliquer le compte Enseignant du Collège, puis « Se connecter » (le bouton affiche « Connexion… »).
2. Constater la page d'arrivée, l'en-tête (nom de l'établissement) et « Mon compte » > « Rôle actif : Enseignant ».
3. Se déconnecter (« Se déconnecter », en haut à droite : retour à `/login`).
4. Répéter pour chaque rôle sans MFA et vérifier l'arrivée :

   | Rôle | Arrivée |
   |---|---|
   | Enseignant (Collège, Université) | `/v2/teacher` |
   | Instituteur (École) | `/v2/primary` |
   | Éducateur | `/v2/attendance` |
   | Chargé d'admissions | `/v2/admissions` |
   | Responsable des examens | `/v2/examinations` |
   | Parent | `/v2/parent` |
   | Élève | `/v2/student` |

5. Une fois connecté, ouvrir `/v2` : redirection vers la même page d'arrivée. Ouvrir `/login` en étant connecté : le formulaire s'affiche (aucune redirection n'est prévue ; à vérifier en test).
Résultat attendu : on arrive toujours sur la page du rôle, jamais sur la page demandée avant la connexion (aucun retour à l'adresse précédente). La session survit à un rechargement.
- [ ] Cas nominal  - [ ] Cas invalide (2.4)  - [ ] Droit refusé (non applicable)

#### 2.3 Connexion avec double authentification
Compte : directeur du Collège (puis propriétaire, études, pédagogie, secrétariat, économe) · Où : `/login` · Prérequis : 2.1
1. Cliquer le compte Directeur (badge "MFA"), « Se connecter ».
2. L'écran "Vérification en deux étapes" s'affiche : "Saisissez le code à 6 chiffres de votre application d'authentification.", champ « Code à 6 chiffres » **déjà rempli** par le panneau (comptes de test), bouton « Valider » (inactif sous 6 caractères), liens "Utiliser un code de secours" et "Recommencer".
3. Cliquer « Valider ».
4. Se déconnecter et recommencer **immédiatement** : le code du moment, déjà utilisé, est refusé (voir 2.6) ; attendre le changement de code (30 secondes au plus), cliquer "Recommencer", recliquer le compte, « Se connecter », « Valider ».
5. Cliquer "Utiliser un code de secours" : le champ devient "Code de secours", la description "Saisissez l'un de vos codes de secours.", le lien devient "Utiliser mon application". (Les comptes de test n'ont pas de code de secours connu : ne pas valider.)
6. Cliquer "Recommencer" : retour à l'écran e-mail et mot de passe.
Résultat attendu : arrivée sur `/v2/direction` (propriétaire, directeur), `/v2/academic` (études), `/v2/assessments` (pédagogie), `/v2/students` (secrétariat), `/v2/finance` (économe). Le code est redemandé à chaque connexion. Dans « Mes sessions » (2.10) la session porte "2 étapes". L'écran MFA reçoit le focus (lecteurs d'écran).
- [ ] Cas nominal  - [ ] Cas invalide (2.6)  - [ ] Droit refusé (non applicable)

#### 2.4 Identifiants invalides : messages non révélateurs
Compte : aucun · Où : `/login` · Prérequis : aucun
Saisir à la main (ne pas utiliser le panneau pour ces cas) puis « Se connecter » :

| Saisie | Message attendu |
|---|---|
| `enseignant@secondaire-test.test` + mot de passe faux `MotDePasseFaux-TG-2026` | "Identifiants invalides. Vérifiez votre e-mail et votre mot de passe." |
| `inconnu.tg@exemple.test` + mot de passe quelconque | le **même** message (rien n'indique si le compte existe) |
| `pas-un-email` + mot de passe quelconque | le même message (aucune validation de format côté navigateur) |
| E-mail seul, mot de passe vide | le bouton « Se connecter » reste inactif |
| Compte de l'École (`parent@primaire-test.test`) avec un mauvais mot de passe | le même message |

Résultat attendu : le refus prend au moins une demi-seconde, dans tous les cas ; le champ « Mot de passe » est vidé après chaque essai ; le message est annoncé (rôle `alert`). Un compte **suspendu** (2.14) reçoit "Aucun accès actif pour cet établissement.". Si l'API est arrêtée : "Service d'authentification indisponible. Réessayez dans un instant.". Les échecs sont tracés dans le journal d'audit du propriétaire (`login.failed`, gravité « Notable »), seulement pour une adresse rattachée à un établissement connu (pas pour `inconnu.tg@exemple.test`).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.5 Verrouillage après plusieurs échecs
Compte : adresse inexistante `verrou.tg@exemple.test` · Où : `/login` · Prérequis : aucun (ne pas utiliser de vrai compte : le blocage de 1 minute touche toute personne qui le tenterait depuis ce poste)
1. Saisir cinq fois de suite `verrou.tg@exemple.test` avec un mauvais mot de passe : cinq messages "Identifiants invalides. Vérifiez votre e-mail et votre mot de passe.".
2. Sixième essai.
3. Attendre une minute, réessayer.
Résultat attendu : le sixième essai affiche "Trop de tentatives. Réessayez dans 1 minute." ; après l'attente, le message "Identifiants invalides…" revient. Un autre compte (par exemple Enseignant) reste utilisable pendant le blocage. Ne pas répéter plusieurs fois : la durée double à chaque récidive (jusqu'à 1 heure). Variante à risque, réservée à un compte peu utilisé : cinq échecs sur `eleve@primaire-test.test` puis le **bon** mot de passe au sixième essai est aussi refusé pendant la minute.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.6 Code MFA faux, déjà utilisé, verrouillage
Compte : directeur de l'Université (`directeur@superieur-test.test`) · Où : écran "Vérification en deux étapes" · Prérequis : 2.3
1. Cliquer le compte, « Se connecter », **effacer** le code prérempli et saisir `000000`, « Valider ».
2. Se déconnecter si besoin, recommencer avec le code du panneau, « Valider » (réussite), se déconnecter, recommencer aussitôt : le code prérempli est le même (même fenêtre de 30 secondes), « Valider ».
3. Cliquer "Recommencer", attendre le changement de code, recliquer le compte, « Valider ».
4. Verrouillage : sur un défi, saisir quatre codes faux (`111111`, `222222`, `333333`, `444444`) puis un cinquième `555555`.
5. Recommencer plus tard avec un code de secours inexistant : "Utiliser un code de secours", saisir `AAAA-BBBB-CCCC`, « Valider ».
Résultat attendu : étapes 1 et 2 : "Code invalide. Vérifiez l'heure de votre téléphone." (l'écran reste ouvert, le code d'un défi précédent déjà consommé est refusé) ; étape 3 : connexion réussie ; étape 4 : les quatre premiers codes donnent le message précédent, le cinquième "Trop de tentatives. Réessayez dans 1 minute." ; étape 5 : "Code de secours invalide.". Un code de secours déjà utilisé est refusé de la même façon. Le défi expire après 5 minutes : "Recommencer" ramène à l'e-mail. Les échecs sont tracés (`login.failed`, motif de second facteur).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Code `12345` (5 chiffres) | « Valider » reste inactif |
| Code `abcdef` | "Code invalide. Vérifiez l'heure de votre téléphone." |
| Code de secours d'un format inconnu | "Code de secours invalide." |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.7 Pages protégées sans connexion et session terminée
Compte : aucun, puis propriétaire · Où : barre d'adresse · Prérequis : aucun
1. Sans être connecté, ouvrir `/v2/home`, `/v2/settings`, `/v2/account/security`, `/v2/account/sessions`, `/v2/admin/members`, `/v2/students`, `/v2/parent`.
2. Après connexion (2.2), ouvrir `/login?expired=1`.
3. Se déconnecter puis utiliser le bouton « Précédent » du navigateur.
Résultat attendu : étape 1 : retour à `/login` pour chaque adresse, aucune donnée visible ; après connexion on arrive sur la page du rôle (pas sur l'adresse demandée). Étape 2 : l'écran de connexion affiche l'avis "Votre session a pris fin. Reconnectez-vous.". Étape 3 : les pages protégées ne redonnent pas accès (retour à `/login`).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non connecté)

#### 2.8 Mot de passe oublié
Compte : aucun · Où : `/login` > "Mot de passe oublié ?" (`/v2/forgot-password`) · Prérequis : aucun
1. Cliquer "Mot de passe oublié ?". Titre "Mot de passe oublié", texte "Saisissez votre adresse e-mail : si un compte existe, un lien de réinitialisation valable 30 minutes vous sera envoyé.", champ « Adresse e-mail », bouton "Envoyer le lien" (inactif si vide), lien "Retour à la connexion".
2. Saisir `parent@secondaire-test.test`, "Envoyer le lien" (« Envoi… »).
3. Recommencer avec `fantome.tg@exemple.test`.
4. Recommencer quatre fois de suite avec la même adresse.
Résultat attendu : dans tous les cas la même réponse : "Si un compte existe pour cette adresse, un e-mail vient d'être envoyé. Pensez à vérifier vos courriers indésirables." (aucune différence entre compte existant et inexistant) ; le formulaire est remplacé par ce message. Au-delà de 3 demandes par heure pour une même adresse, les demandes sont ignorées **sans message différent**. **Aucun courrier n'arrive** (ni lien dans une boîte locale) : à noter, ce n'est pas un défaut de l'écran. L'ancien mot de passe continue de fonctionner tant que le lien n'est pas utilisé.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Adresse vide | "Envoyer le lien" inactif |
| `pas-un-email` | "Une erreur est survenue. Réessayez." (l'API refuse le format et la page ne le traduit pas ; texte à relever) |

Le lien "Retour à la connexion" ramène à `/login`.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.9 Lien de réinitialisation ou d'invitation invalide
Compte : aucun · Où : `/v2/reset-password`, `/auth/reset-password`, `/auth/invitation` · Prérequis : aucun
1. Ouvrir `/v2/reset-password` sans paramètre : titre "Nouveau mot de passe", avis "Ce lien est incomplet ou n'est plus valable." et lien "Demander un nouveau lien" (vers `/v2/forgot-password`).
2. Ouvrir `/v2/reset-password?token=jeton-invalide-test-guide-0123456789` (au moins 20 caractères). L'adresse perd aussitôt son paramètre. Le formulaire s'affiche : description "Choisissez un nouveau mot de passe. Vos autres appareils seront déconnectés.", champs "Nouveau mot de passe" (aide "12 caractères minimum. Une phrase de passe est idéale.") et "Confirmer le mot de passe", bouton « Enregistrer ».
3. Saisir `Phrase de test guide numero 2026` dans les deux champs, « Enregistrer ».
4. Recharger la page (le paramètre n'est plus dans l'adresse).
5. Ouvrir `/auth/reset-password?token=jeton-invalide-test-guide-0123456789` et `/auth/invitation?token=jeton-invalide-test-guide-0123456789` : titre « Activer votre compte » pour l'invitation, description "Choisissez le mot de passe de votre compte.".
Résultat attendu : étape 3 : "Ce lien n'est plus valable. Demandez-en un nouveau." (la politique de mot de passe n'est pas évaluée tant que le jeton n'est pas valide) ; étape 4 : "Ce lien est incomplet ou n'est plus valable.". Les champs sont vidés après chaque envoi.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Deux mots de passe différents | "Les mots de passe ne correspondent pas." sous "Confirmer le mot de passe", « Enregistrer » inactif |
| Jeton de moins de 20 caractères (`?token=abc`) | "Une erreur est survenue. Réessayez." (jeton refusé à la validation ; texte à relever) |
| Réinitialisation réussie, activation d'un lien valide | **Non couvert** (aucun lien ne peut être obtenu) ; avec un serveur de courrier de test : un lien utilisé une fois est refusé la seconde fois avec "Ce lien n'est plus valable. Demandez-en un nouveau.", et "Mot de passe enregistré. Vous pouvez vous connecter." avec le bouton « Se connecter » en cas de réussite |

Au-delà de 20 envois par heure depuis le même poste, le serveur répond « Trop de tentatives… » (non testé).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.10 Mes sessions
Compte : éducateur de l'École (compte d'essai), deux fenêtres · Où : « Mon compte » > « Mes sessions » (`/v2/account/sessions`) · Prérequis : 2.2
1. Fenêtre B : se connecter en éducateur de l'École. Fenêtre C : se connecter avec le même compte.
2. Fenêtre B : « Mon compte » > « Mes sessions ». Titre "Mes sessions actives" ("Appareils connectés à votre compte dans cet établissement. Révoquez ceux que vous ne reconnaissez pas."). Chaque ligne : appareil (par exemple "Chrome sur Windows"), adresse, "rôle <rôle>", "· 2 étapes" si la MFA a été passée, "Connecté le … · actif le …". La ligne de la fenêtre B porte « Cet appareil » et le bouton "Me déconnecter". D'autres lignes peuvent exister (sessions du seed ou d'autres testeurs).
3. Révoquer la ligne de la fenêtre C : bouton « Révoquer ».
4. Fenêtre C : cliquer un menu ou recharger.
5. Fenêtre B : se reconnecter en C, puis "Déconnecter tous mes appareils".
6. Fenêtre B : "Me déconnecter" sur sa propre ligne (après une reconnexion).
Résultat attendu : étape 3 : message "Session révoquée." et la liste ne contient plus la ligne de C. Étape 4 : retour à l'écran de connexion avec "Votre session a pris fin. Reconnectez-vous." (au prochain appel au serveur, au plus tard au renouvellement automatique du jeton). Étape 5 : toutes les sessions se ferment, B revient à `/login`. Étape 6 : retour à `/login`. Aucune session n'expire par simple attente dans le temps d'un test (inactivité 14 jours).
Une session d'assistance (impersonation) porterait l'étiquette "Assistance" : non déclenchable.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.11 Sécurité du compte : changer le mot de passe
Compte : éducateur de l'École (compte d'essai) · Où : « Mon compte » > « Sécurité du compte » (`/v2/account/security`) · Prérequis : connaître le mot de passe actuel (fichier local, voir Prérequis) ; sinon faire uniquement les cas invalides
1. Ouvrir la page. Titre « Sécurité du compte » ("Mot de passe et vérification en deux étapes."), section « Mot de passe » : champs "Mot de passe actuel", "Nouveau mot de passe" (aide "12 caractères minimum, différent de l'ancien."), "Confirmer le nouveau mot de passe", bouton "Changer le mot de passe" (inactif tant que les trois champs ne sont pas cohérents).
2. Cas invalides (tableau), puis le changement nominal.
3. **Nominal, aller-retour** : mot de passe actuel = celui du fichier, nouveau = `Phrase d'essai guide Yopougon 2026` deux fois, "Changer le mot de passe". Vérifier le message. Se déconnecter, se connecter avec le **nouveau** mot de passe (à la main, pas par le panneau). Revenir sur la page et **remettre le mot de passe d'origine** (nouveau = l'ancien du fichier) : sinon le panneau de `/v2/login` cesse de fonctionner pour ce compte.
Résultat attendu : "Mot de passe modifié. Vos autres appareils ont été déconnectés." ; la session courante reste ouverte ; l'ancien mot de passe ne fonctionne plus ; une entrée `password.changed` apparaît dans le journal d'audit du propriétaire de l'École (`/v2/audit`). Le champ est vidé après chaque envoi.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Mot de passe actuel faux | "Identifiants invalides." ; après 5 échecs en 10 minutes : "Trop de tentatives. Réessayez dans 1 minute." |
| Nouveau et confirmation différents | "Les mots de passe ne correspondent pas." sous la confirmation ; bouton inactif |
| Nouveau = `court` (trop court) | "Le mot de passe ne respecte pas la politique de sécurité." (la page ne détaille pas les raisons, contrairement au serveur) |
| Nouveau = `azertyazerty`, `aaaaaaaaaaaa`, `abcdefghijkl`, `educateur@primaire-test.test`, `educateurprimaire2026`, ou égal à l'ancien | le même message générique ; le serveur refuse pour : trop courant, trop répétitif, suite de caractères, e-mail, identifiant de l'e-mail, identique à l'ancien |
| Nouveau contenant le nom de l'établissement ou son identifiant (par exemple une phrase avec "primairetest") | le même message générique |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.12 Sécurité du compte : activer la MFA, codes de secours
Compte : éducateur de l'École (compte d'essai) · Où : `/v2/account/security`, section "Vérification en deux étapes" · Prérequis : mot de passe du compte (fichier local) et une application d'authentification (ou un outil de code TOTP) sur le poste du testeur
1. Le texte d'état indique "Désactivée. Elle est obligatoire pour certains rôles (propriétaire, administrateur…)." Saisir le mot de passe dans "Votre mot de passe (pour confirmer)", « Activer ». (Mot de passe faux : "Identifiants invalides.")
2. Le QR code s'affiche (texte alternatif "QR code à scanner avec votre application d'authentification") ; "Saisie manuelle de la clé" déplie la clé. L'ajouter à l'application.
3. Saisir le code à 6 chiffres dans « Code à 6 chiffres », "Confirmer l'activation" (inactif sous 6 chiffres). Code faux : "Code invalide. Vérifiez l'heure de votre téléphone et réessayez."
4. Message de réussite : "Vérification en deux étapes activée. Conservez vos codes de secours : ils ne seront plus affichés." et une liste de codes au format `xxxx-xxxx-xxxx` (10 codes). Les noter hors du guide, puis "J'ai noté mes codes".
5. Se déconnecter. Se connecter par le formulaire (e-mail et mot de passe à la main) : l'écran "Vérification en deux étapes" apparaît ; le code n'est **pas** prérempli (le fichier du panneau ne connaît pas ce secret).
6. Saisir le code de l'application ; réussite. Se déconnecter, recommencer avec "Utiliser un code de secours" et un des codes : réussite. Recommencer avec le **même** code de secours : "Code de secours invalide.".
Résultat attendu : conforme ; dans "Mes membres" du propriétaire de l'École (2.14) le compte porte "· 2 étapes" ; une entrée `mfa.enabled` est dans le journal. L'enrôlement **forcé** à la première connexion (écran « Activer la vérification en deux étapes », avec le QR code puis "Codes de secours" et la case de confirmation) ne s'applique qu'aux rôles qui l'imposent (propriétaire, administrateur) et n'est atteignable qu'avec un compte neuf : non couvert (voir la fin du chapitre).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.13 Désactiver ou réinitialiser la MFA
Compte : éducateur de l'École (compte d'essai), propriétaire de l'École · Où : `/v2/account/security`, `/v2/admin/members` · Prérequis : 2.12
1. Compte d'essai : « Désactiver… » : champs "Votre mot de passe" et « Code à 6 chiffres » (ou "Utiliser un code de secours" avec "Code de secours"), bouton « Désactiver la vérification », « Annuler ».
2. Cas invalides (tableau).
3. **Retour à l'état d'origine par le propriétaire** (si la désactivation n'est pas faite par le compte lui-même) : propriétaire de l'École, `/v2/admin/members`, ligne `educateur@primaire-test.test`, "Réinitialiser la MFA".
4. Test du refus pour un rôle qui impose la MFA : propriétaire du Collège, avec **son** mot de passe (fichier) et le code `123456`, « Désactiver… ».
Résultat attendu : étape 1 réussie : "Vérification en deux étapes désactivée. Vos autres appareils ont été déconnectés." ; étape 3 : message "Vérification en deux étapes de educateur@primaire-test.test réinitialisée." ; ses sessions sont fermées, la mention "· 2 étapes" disparaît, le mot de passe est inchangé ; la réinitialisation n'est possible que pour une personne dont l'unique accès est cet établissement. Étape 4 : "Votre rôle exige la vérification en deux étapes : elle ne peut pas être désactivée.". Un administrateur ne peut pas réinitialiser sa propre MFA.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Mot de passe faux | "Identifiants invalides." |
| Code faux | "Code invalide. Vérifiez l'heure de votre téléphone et réessayez." |
| Réinitialiser la MFA du compte propriétaire connecté | refus ("Action non autorisée.") |

Ne **jamais** désactiver ni réinitialiser la MFA d'un compte de départ à MFA : le code automatique du panneau ne correspondrait plus.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.14 Membres de l'établissement
Compte : propriétaire du Collège (écriture), directeur, enseignant (refus) · Où : menu « Utilisateurs » (`/v2/admin/members`) · Prérequis : aucun
1. Ouvrir la page. Titre "Membres de l'établissement" ("Invitez des personnes, suspendez un accès, révoquez des sessions."), formulaire "Adresse e-mail à inviter", liste déroulante « Rôle » (« Enseignant », « Élève / étudiant », « Parent », « Administrateur ») et bouton "Inviter" ; liste des membres (e-mail, statut, rôles, "· 2 étapes").
2. Cas invalides (tableau ci-dessous), qui ne créent rien.
3. **Suspendre / rétablir** : sur la ligne `educateur@secondaire-test.test`, « Suspendre » : message "Accès de educateur@secondaire-test.test suspendu." et statut « Suspendu » ; dans une autre fenêtre, tenter de se connecter avec ce compte : "Aucun accès actif pour cet établissement." ; puis « Rétablir » : "Accès de educateur@secondaire-test.test rétabli.", statut « Actif », connexion de nouveau possible.
4. **Révoquer les sessions** : une session ouverte de l'éducateur en fenêtre C, puis "Révoquer les sessions" : message "N session(s) révoquée(s)." ; la fenêtre C est ramenée à `/login` ; une nouvelle connexion réussit (le compte n'est pas suspendu).
5. **Réinitialiser la MFA** : voir 2.13 (seulement sur le compte d'essai).
6. **Invitation nominale** : dans l'organisation jetable B du chapitre 1 (scénario 1.20, propriétaire emprunté connecté à B), inviter `invite.tg@exemple.test` avec le rôle « Enseignant », "Inviter". À défaut, la faire au Collège (le membre créé ne se supprime pas ; le suspendre ensuite).
7. Directeur : la liste est visible ; inviter avec le rôle « Administrateur ».
8. Enseignant : ouvrir la page.
Résultat attendu : étape 6 : message "Invitation envoyée. La personne définit son mot de passe depuis le lien reçu par e-mail." ; **aucun lien n'existe** ; le nouveau membre apparaît aussitôt avec le statut « Actif » (le statut "Invité" n'est jamais attribué) et ne pourra pas se connecter (pas de mot de passe). Si le rôle RBAC équivalent ne peut pas être attribué automatiquement : "Invitation envoyée, mais les droits n'ont pas pu être attribués automatiquement : attribuez le rôle depuis la gestion des rôles.". Étape 7 : "Action non autorisée." (seul un propriétaire ou un administrateur accorde « Administrateur »). Étape 8 : la liste est remplacée par "Action non autorisée." et le formulaire d'invitation reste visible ("Inviter" est alors refusé).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Adresse vide | "Inviter" inactif |
| `pas-un-email` | "Une erreur est survenue. Réessayez." (format refusé par l'API, non traduit) |
| Adresse d'un membre déjà présent (`enseignant@secondaire-test.test`) | "Une erreur est survenue. Réessayez." (le serveur répond que la personne a déjà un accès, la page ne le dit pas) |
| Propriétaire : « Suspendre » sur sa propre ligne | refus ("Action non autorisée.") |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant, le parent, l'élève

#### 2.15 Mes établissements
Compte : propriétaire du Collège (un seul accès), puis propriétaire du Primaire connecté à l'organisation B · Où : `/v2/account/tenants` (menu « Mon compte » > « Mes établissements », visible seulement avec plusieurs accès) · Prérequis : 1.20 pour la partie multi-établissements
1. Au Collège : « Mon compte » ne propose pas « Mes établissements ». Ouvrir `/v2/account/tenants` à la main : titre « Mes établissements » ("Choisissez l'établissement dans lequel travailler. Votre session actuelle sera remplacée."), une ligne "Actuel" et le texte "Votre compte n'a accès qu'à un seul établissement.".
2. Multi (après 1.20) : se connecter en propriétaire du Primaire, ouvrir « Mon compte » > « Mes établissements » : deux lignes, l'actuelle porte "Actuel" et est inactive ; l'autre « Choisir ».
3. Cliquer « Choisir » sur l'autre : le formulaire "Ce changement demande votre code de vérification en deux étapes." apparaît avec « Code à 6 chiffres » et « Valider ». Code faux : "Code invalide. Vérifiez l'heure de votre téléphone.". Bon code (autre fenêtre, bloc "Afficher le code MFA" ; attendre le code suivant s'il vient d'être utilisé) : arrivée dans l'autre établissement.
4. Vérifier que l'ancienne session est révoquée (« Mes sessions » de l'autre établissement : une seule session) et que le nom de l'établissement dans l'en-tête a changé.
5. Revenir à l'établissement d'origine par le même chemin.
Résultat attendu : conforme. « Mon compte » > « Changer d'établissement » propose aussi les autres établissements. Pas de sélecteur de rôle ni de « Changer de rôle » : aucun compte de test n'a plusieurs rôles (non couvert). Terminer par le retour à la normale décrit en 1.22.
- [ ] Cas nominal  - [ ] Cas invalide (code faux)  - [ ] Droit refusé (non applicable)

#### 2.16 Menu du compte et déconnexion
Compte : tout rôle · Où : bouton « Mon compte » (en-tête) · Prérequis : 2.2
1. Ouvrir « Mon compte » : nom ou e-mail, "Rôle actif : <rôle>", liens « Sécurité du compte », « Mes sessions », « Mes notifications » (chapitre 15), « Mes établissements » (si plusieurs accès).
2. Cliquer chaque lien et vérifier l'arrivée dans la coque du rôle (menu de l'application toujours présent).
3. « Se déconnecter » : retour à `/login`, `/v2/home` redirige ensuite vers `/login`.
Résultat attendu : conforme ; la déconnexion purge aussi les données hors ligne de l'appareil.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

#### 2.17 Droits : adresses interdites
Compte : voir tableau "Droits" · Où : barre d'adresse · Prérequis : aucun
Exécuter le tableau "Adresses à taper à la main" en tête de chapitre.
Résultat attendu : les pages de compte sont accessibles à toute personne connectée, retour à `/login` sinon ; `/v2/admin/members` ne montre jamais de membres à un rôle sans `iam.user.read` (message "Action non autorisée."), jamais d'e-mail ni de rôle d'autrui.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour chaque rôle du tableau

#### 2.18 Clavier et accessibilité des écrans de connexion
Compte : aucun · Où : `/login`, `/v2/forgot-password`, `/v2/account/security` · Prérequis : aucun
1. Tab seul : e-mail, mot de passe, « Se connecter », "Mot de passe oublié ?", "S'inscrire en ligne", puis le panneau ; Entrée dans un champ envoie le formulaire.
2. À chaque étape de la connexion (MFA, codes), le focus passe sur l'étape (lecteurs d'écran) ; les erreurs sont annoncées.
3. Mobile 375 pixels : le panneau se place sous le formulaire, boutons d'au moins 44 pixels de haut, pas de défilement horizontal.
Résultat attendu : conforme ; écarts dans le rapport.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (non applicable)

---

## Nettoyage

1. Compte d'essai `educateur@primaire-test.test` : mot de passe d'origine rétabli (2.11), MFA réinitialisée par son propriétaire (2.13), vérifier que le panneau le connecte de nouveau.
2. Membres : tout compte suspendu pour un test est rétabli (2.14) ; le membre `invite.tg@exemple.test` est suspendu s'il a été créé au Collège.
3. Sessions de test fermées.

## Données créées

| Enregistrement | Remarque |
|---|---|
| Membre `invite.tg@exemple.test` (rôle Enseignant) | créé dans l'organisation B (ou au Collège) ; ne se supprime pas |
| MFA et codes de secours du compte `educateur@primaire-test.test` | réinitialisés en 2.13 |
| Mot de passe de `educateur@primaire-test.test` | changé puis rétabli en 2.11 |
| Entrées d'audit `login.failed`, `password.changed`, `mfa.*`, `session.revoked`, `membership.*` | conservées (journal infalsifiable) |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Connexion, mot de passe oublié, membres | Aucun courrier n'est envoyé ni stocké : invitation et réinitialisation sont inutilisables ; le message « Invitation envoyée. La personne définit son mot de passe depuis le lien reçu par e-mail. » est inexact ici. | Majeur (environnement) |
| `/v2/admin/members` | Le membre invité est « Actif » immédiatement ; le statut "Invité" n'existe pas dans les faits. | Mineur |
| `/v2/admin/members` | Les rôles sont affichés par leur clé technique (`owner`, `teacher`…). | Mineur |
| `/v2/admin/members` | Pas de garde de page : un rôle sans droit voit le formulaire d'invitation. Doublon, e-mail invalide : message générique "Une erreur est survenue. Réessayez.". | Mineur |
| `/v2/account/security` | Les raisons précises du refus d'un mot de passe ne sont pas affichées au changement (message générique) alors qu'elles le sont à la réinitialisation. | Mineur |
| `/v2/account/sessions` | Le rôle s'affiche par sa clé ("rôle teacher"). | Mineur |
| `/login` | Les textes des écrans d'authentification sont écrits en dur dans le code et ne figurent pas dans `fr-CI.json` (traduction impossible sans modification du code). | Suggestion |
| `/login` | Le code MFA prérempli est le code du moment : il est refusé s'il vient d'être utilisé (anti-rejeu) ; le champ n'est pas rafraîchi après le changement de fenêtre. | Mineur |
| `/login` | Le lien "S'inscrire en ligne" mène à une page de l'ancienne application. | Mineur |
| Accès | Un rôle qui n'a qu'un rôle IAM ne voit pas « Changer de rôle » ; aucune graine ne le permet. | Suggestion |

## À vérifier en test

- `/login` ouvert en étant déjà connecté (aucune redirection prévue dans le code).
- Messages exacts quand le jeton d'un lien fait moins de 20 caractères ou quand l'e-mail est mal formé (message générique attendu).
- Effet d'une suspension sur la liste « Mes établissements » (établissement non actif encore proposé ou non).
- Nombre et âge des sessions déjà présentes dans « Mes sessions » (sessions du seed).
- Délai entre la révocation d'une session depuis un autre appareil et la déconnexion de l'appareil visé.
- Message d'erreur de connexion quand l'API est arrêtée.

## Non couvert / limites connues

- Activation d'un compte par lien d'invitation, réinitialisation par lien valide, expiration des liens (30 minutes, 7 jours) : aucun lien ne peut être obtenu sans serveur de courrier.
- Enrôlement forcé de la MFA à la première connexion (rôles propriétaire, administrateur) : exige un compte neuf avec mot de passe.
- Ré-authentification pour action sensible (fenêtre « Confirmez votre identité », valable 5 minutes) : les sessions des comptes de test à MFA sont déjà à deux facteurs ; les rôles sans MFA n'ont aucune permission sensible.
- Changement de rôle actif : aucun compte de test n'a plusieurs rôles.
- Expiration par inactivité (14 jours) ou durée maximale (30 jours) : non testables.
- Connexion avec Google : désactivée (bouton "Continuer avec Google" absent).
- Impersonation : aucun écran.
