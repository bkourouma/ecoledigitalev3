[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](19-securite-isolation.md) · [Suivant →](21-accessibilite-mobile.md)

# Phase 20 — Console de la plateforme (opérateur) et abonnement

Objectif : jouer le rôle de l'opérateur d'EcoleDigitale dans la console : créer une organisation jetable `tg-jetable`, en changer le statut, l'abonnement et les dérogations, lire le catalogue des plans, retrouver tous ces actes au journal de plateforme, puis voir côté propriétaire l'abonnement du Collège.

Précondition : **l'opérateur n'est pas dans le panneau de `/v2/login`**. Son e-mail et son mot de passe sont communiqués par la personne qui lance l'environnement ; ne jamais les recopier dans un rapport. Sans ces identifiants, noter les étapes de console "non exécutées" et ne pas les chercher ailleurs. La console se joue en fenêtre **B** (privée) : se connecter à un établissement dans un navigateur efface le jeton d'opérateur de ce navigateur.

---

## Étape 376 — Connexion de l'opérateur
👤 **opérateur de la plateforme** · fenêtre **B** · 📂 Page `http://localhost:3000/v2/platform/login` (`/v2/platform/login`)

1. Ouvrir `/v2/platform/login` : titre « Console plateforme » et champs « Adresse e-mail » et « Mot de passe ».
2. Cliquer **« Se connecter »** sans rien saisir.
3. Saisir l'e-mail et le mot de passe de l'opérateur (fournis par la personne qui lance l'environnement), cliquer **« Se connecter »**.

✅ Étape 2 : « Ce champ est obligatoire. » sous chaque champ. Étape 3 : arrivée sur `/v2/platform/tenants`, titre « Organisations » ; le menu de la console ne propose que « Organisations », « Plans et catalogue » et « Journal de plateforme » ; l'en-tête indique "Connecté en tant que" suivi de l'e-mail.

⚠️ *Test d'erreur* : l'e-mail d'un compte d'établissement (`direction.generale@secondaire-test.test`) avec un mot de passe quelconque : « Identifiants d'opérateur invalides. » (même message pour un e-mail inconnu : aucun indice sur l'existence du compte).

☐ OK ☐ KO

---

## Étape 377 — Garde de la console
👤 **opérateur** (fenêtre **B**) puis **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Barre d'adresse

1. Dans une fenêtre privée neuve **sans** connexion, taper `/v2/platform/tenants`, `/v2/platform/plans` et `/v2/platform/audit`.
2. Fenêtre A, connecté en propriétaire du Collège, taper `/v2/platform/tenants`.
3. Fenêtre B, connecté en opérateur seulement, taper `/v2/settings` puis `/v2/students`.

✅ Étapes 1 et 2 : retour à `/v2/platform/login`, aucune organisation affichée. Étape 3 : retour à `/login` (la console ne donne aucune session d'établissement) ; l'opérateur ne voit jamais d'élève, de note ni de facture.

☐ OK ☐ KO

---

## Étape 378 — Lire et filtrer la liste des organisations
👤 **opérateur** · fenêtre **B** · 📂 Menu **« Organisations »** (`/v2/platform/tenants`)

Attendu au départ : trois organisations « Active » : Collège Le Baobab (`secondaire-test`), École primaire Les Palmiers (`primaire-test`), Université Horizon (`superieur-test`).

1. Lire le tableau « Organisations » (colonnes « Nom », « Identifiant », « Statut », « Créée le »).
2. Saisir `Baobab` dans **« Rechercher »**, cliquer **« Filtrer »**.
3. Saisir `zzz-introuvable`, **« Filtrer »**.
4. Vider la recherche, choisir **« Suspendue »** dans « Statut », **« Filtrer »**, puis revenir à « Tous les statuts ».

✅ Étape 2 : une seule ligne. Étape 3 : « Aucune organisation ne correspond. » Étape 4 : même message tant que rien n'est suspendu.

☐ OK ☐ KO

---

## Étape 379 — Créer l'organisation jetable `tg-jetable`
👤 **opérateur** · fenêtre **B** · 📂 **« Organisations »** > **« Nouvelle organisation »** (`/v2/platform/tenants/new`)

1. Cliquer **« Nouvelle organisation »** et saisir (taper d'abord le nom : l'identifiant se remplit seul, puis le remplacer) :

| Champ | Valeur |
| :--- | :--- |
| Nom de l'organisation | `École jetable test guide` |
| Identifiant (slug) | `tg-jetable` |
| Pays (code ISO) | `CI` |
| Packs | cocher « Secondaire » |
| Nom complet (propriétaire) | `KONÉ Mariam test guide` |
| Adresse e-mail (propriétaire) | `proprietaire.tgjetable@exemple.test` |
| Téléphone | `+225 07 08 09 10 11` |
| Durée (jours) | `30` |

2. Cliquer **« Provisionner l'organisation »**.
3. Sur l'écran de réussite, cliquer **« Ouvrir l'organisation »**.

✅ Écran « Organisation créée » avec "1 établissement créé" et les boutons « Ouvrir l'organisation » et « Provisionner une autre organisation ». La fiche s'ouvre : badge « Active », sous-titre « Identifiant : tg-jetable · Créée le … », un établissement de pack « Secondaire », section « Abonnement » au statut « Période d'essai » (fin = aujourd'hui + 30 jours). La liste compte maintenant 4 organisations.

⚠️ *Écart connu* : le texte "Une invitation a été envoyée à …" est affiché alors qu'aucun courrier ne part dans cet environnement : **personne ne pourra jamais se connecter à `tg-jetable`**, c'est voulu (organisation de console seulement).

⚠️ *Test d'erreur* : refaire la saisie avec le pack décoché : « Choisissez au moins un pack. » ; avec l'identifiant `secondaire-test` : message du serveur se terminant par "est déjà utilisé." ; avec `admin` : "est réservé." Rien n'est créé.

☐ OK ☐ KO

---

## Étape 380 — Fiche d'une organisation de départ : lecture seule
👤 **opérateur** · fenêtre **B** · 📂 **« Organisations »** > ouvrir « Collège Le Baobab (démonstration) » (`/v2/platform/tenants/<identifiant>`)

1. Lire « Vue d'ensemble » (raison sociale, pays, établissement de pack « Secondaire »).
2. Lire « Abonnement » : offre "Professionnel", statut « Actif », tranche d'apprenants vide, seul le pack « Secondaire » coché.
3. Lire « Dérogations de fonctionnalités » et « Droits effectifs et usage ».
4. Ouvrir ensuite l'École et l'Université et comparer le nombre de fonctionnalités accordées. **Ne rien modifier** sur ces trois fiches.

✅ « Aucune dérogation. » ; "N fonctionnalités accordées" ; le nombre diffère selon le pack. Aucune donnée interne (élève, note, facture) n'est affichée.

⚠️ *Test d'erreur* : taper `/v2/platform/tenants/11111111-1111-4111-8111-111111111111` : « Cette organisation n'existe pas. »

☐ OK ☐ KO

---

## Étape 381 — Suspendre puis réactiver `tg-jetable`
👤 **opérateur** · fenêtre **B** · 📂 Fiche de `tg-jetable`, section **« Statut »**

1. Cliquer **« Suspendre »** : fenêtre « Suspendre l'organisation ? » avec le champ **« Motif »**.
2. Confirmer sans motif.
3. Saisir le motif `Suspension d'essai test guide` et confirmer (bouton « Suspendre »).
4. Descendre à « Droits effectifs et usage », puis revenir à la liste et filtrer sur « Suspendue ».
5. Rouvrir la fiche, cliquer **« Réactiver »** et confirmer.

✅ Étape 2 : « Indiquez un motif de 3 caractères au moins. » (la fenêtre reste ouverte). Étape 3 : « Statut mis à jour. », badge « Suspendue ». Étape 4 : seules les fonctionnalités de base restent accordées ; l'organisation figure dans le filtre « Suspendue ». Étape 5 : badge « Active ». Ne pas archiver maintenant.

☐ OK ☐ KO

---

## Étape 382 — Abonnement de `tg-jetable`
👤 **opérateur** · fenêtre **B** · 📂 Fiche de `tg-jetable`, section **« Abonnement »**

1. Passer « Statut » à « Actif », saisir `250` dans **« Tranche d'apprenants (plafond) »**, cliquer **« Enregistrer l'abonnement »**.
2. Recharger la page.
3. Choisir l'offre "Starter", enregistrer, relever le nombre de fonctionnalités dans « Droits effectifs et usage », puis remettre l'offre d'origine et enregistrer.

✅ « Abonnement enregistré. » à chaque enregistrement valide ; les valeurs sont conservées au rechargement ; le nombre de fonctionnalités change avec l'offre (valeur de Starter à relever).

⚠️ *Test d'erreur* : « Fin » antérieure à « Début » : « La fin doit suivre le début. » ; plafond `0` : « Entier positif attendu. » ; offre vide : « Choisissez une offre. »

☐ OK ☐ KO

---

## Étape 383 — Dérogation de fonctionnalité et réconciliation
👤 **opérateur** · fenêtre **B** · 📂 Fiche de `tg-jetable`, sections **« Dérogations de fonctionnalités »** et **« Réconcilier »**

1. Relever dans « Droits effectifs et usage » le nombre de fonctionnalités accordées (N).
2. Dans **« Ajouter une dérogation »**, saisir :

| Champ | Valeur |
| :--- | :--- |
| Fonctionnalité | "Vie scolaire : incidents, mesures, observations (schoollife.core)" |
| Effet | « Retirer » |
| Motif | `Essai du menu hors plan (test guide)` |

3. Cliquer **« Enregistrer la dérogation »**.
4. Cliquer l'icône corbeille de la ligne, confirmer par **« Confirmer »**.
5. Dans « Réconcilier », cliquer **« Lancer la réconciliation »**.

✅ « Dérogation enregistrée. » ; la ligne apparaît (effet « Retirer », expiration « Jamais ») et le nombre devient N − 1. « Dérogation supprimée. » : retour à N. Réconciliation : « Réconciliation terminée : 0 rôle(s) créé(s), abonnement inchangé. »

⚠️ *Test d'erreur* : aucune fonctionnalité choisie : « Choisissez une fonctionnalité. »

☐ OK ☐ KO

---

## Étape 384 — Plans et catalogue : lire, puis créer un plan inactif
👤 **opérateur** · fenêtre **B** · 📂 Menu **« Plans et catalogue »** (`/v2/platform/plans`)

Ne modifier aucun des trois plans de départ (une modification s'applique à toutes les organisations concernées).

1. Lire les blocs « Plans » (Starter, Professionnel, Entreprise), « Packs » (PRIMARY, SECONDARY, HIGHER, VIRTUAL) et « Fonctionnalités ».
2. Cliquer **« Nouveau plan »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Clé | `TG_PLAN_TEST` |
| Libellé | `Plan test guide` |
| Description | `Plan de démonstration du guide, ne pas vendre` |
| Ordre d'affichage | `900` |
| Plan actif (proposé à la vente) | décocher |

3. Cliquer **« Enregistrer »**.
4. Cliquer le crayon du plan, changer le libellé en `Plan test guide modifié`, **« Enregistrer »**.

✅ « Plan enregistré. », carte "Plan test guide" avec le badge « Inactif », puis libellé modifié. La clé est en lecture seule. Le plan ne peut pas être supprimé (aucune commande) : il reste, inactif.

⚠️ *Test d'erreur* : clé `1PLAN` : "Clé en majuscules (ex. PROFESSIONAL)."

⚠️ *Écart connu* : saisir une clé **déjà existante** (`STARTER`, `PROFESSIONAL`, `ENTERPRISE`) remplace silencieusement le plan existant (Majeur, à confirmer) : ne jamais le tenter.

☐ OK ☐ KO

---

## Étape 385 — Côté propriétaire : abonnement et usage du Collège
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Établissement »** > **« Abonnement et usage »** (`/v2/settings/subscription`)

1. Lire « Offre », « Statut de l'abonnement » (« Actif »), « Packs » (« Secondaire »), « Tranche d'apprenants » (« Illimitée »).
2. Lire « Fonctionnalités actives » (total, puis un bloc par module avec l'origine « Socle », « Offre », « Pack » ou « Dérogation ») et « Usage mesuré ».
3. Taper `/v2/academic/offerings` (l'entrée de menu n'existe qu'à l'Université).
4. Se connecter en secrétariat (`secretariat@secondaire-test.test`) et taper `/v2/settings/subscription`.

✅ Aucun bouton de modification de l'abonnement n'existe côté établissement (les changements viennent de la console). Étape 3 : l'écran s'ouvre avec l'avis « L'inscription à la carte n'est pas incluse dans l'offre de l'établissement. » et ne permet aucune action. Étape 4 : la page s'ouvre mais les données sont refusées ("Action non autorisée.").

⚠️ *Écart connu* : l'offre s'affiche par sa clé technique (`PROFESSIONAL`) et les fonctionnalités par leurs clés (Mineur).

☐ OK ☐ KO

---

## Étape 386 — Journal de plateforme
👤 **opérateur** · fenêtre **B** · 📂 Menu **« Journal de plateforme »** (`/v2/platform/audit`)

1. Lire le tableau « Entrées du journal de plateforme » (colonnes « Date », « Gravité », « Action », « Entité », « Acteur »), la plus récente en premier.
2. Retrouver les actes des étapes précédentes : `platform.tenant.provisioned` (`tg-jetable`), `platform.tenant.status_changed` (suspension puis réactivation), `platform.subscription.set`, `platform.override.set`, `platform.override.removed`, `platform.tenant.reconciled`, `platform.plan.upserted`.

✅ Chaque acte est présent, acteur « Opérateur plateforme », identifiant de l'organisation sous l'entité. Aucune entrée n'est modifiable ni supprimable (aucun bouton). « Charger plus d'entrées » charge la suite si la page est pleine.

☐ OK ☐ KO

---

## Étape 387 — ⚠️ Irréversible : archiver l'organisation jetable
👤 **opérateur** · fenêtre **B** · 📂 Fiche de `tg-jetable`, section **« Statut »**

1. Cliquer **« Archiver »**, saisir le motif `Fin des essais test guide`, confirmer.
2. Revenir à la liste : l'organisation figure avec le statut archivé.

✅ « Statut mis à jour. » ; l'organisation archivée perd l'accès aux fonctionnalités payantes. Les organisations ne se suppriment pas : `tg-jetable` et le plan `TG_PLAN_TEST` restent dans la console.

📚 *Pour aller plus loin* : chapitre 01, scénarios 1.1 à 1.11 (console), 1.16 (modules selon l'offre), 1.20 à 1.22 (organisation avec propriétaire emprunté, mise en service, suspension vue de l'établissement).

☐ OK ☐ KO

**Ce que la phase laisse dans l'application :** l'organisation "École jetable test guide" (`tg-jetable`, archivée, inutilisable car son propriétaire n'a jamais reçu d'invitation) ; le plan "Plan test guide modifié" (`TG_PLAN_TEST`, inactif, non supprimable) ; les entrées correspondantes du journal de plateforme. Les trois établissements de départ n'ont pas été modifiés.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](19-securite-isolation.md) · [Suivant →](21-accessibilite-mobile.md)
