[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [Suivant →](02-structure-academique.md)

# Phase 1 — Connexion, abonnement et rôles (propriétaire)

On ouvre l'application, on se connecte avec et sans double authentification (MFA), puis le propriétaire du Collège Le Baobab parcourt l'administration de son établissement : accueil, profil, campus, abonnement et modules, rôles et attributions. Cette phase crée le rôle personnalisé `tg_secretariat`.

Précondition : application lancée avec la base de départ (trois établissements de démonstration), J = jeudi 8 octobre 2026. Les codes MFA du panneau changent toutes les 30 secondes et ne servent qu'une fois : si un code est refusé parce qu'il vient d'être utilisé, attendre le code suivant.

## Étape 1 — Ouvrir la page de connexion et lire le panneau des comptes
👤 **personne non connectée** · fenêtre **A** · 📂 Adresse `http://localhost:3000/v2/login` (`/v2/login`)

1. Ouvrir l'adresse. À gauche, le formulaire : titre « Connexion », champs « Adresse e-mail » et « Mot de passe », bouton « Se connecter » (inactif tant que les deux champs sont vides).
2. À droite, le panneau « Comptes par tenant » : texte "Cliquez un compte pour remplir le formulaire de connexion.", comptes groupés par établissement (`secondaire-test`, `primaire-test`, `superieur-test`). Chaque bouton montre le rôle, l'e-mail et un badge "MFA" pour les comptes à double authentification.
3. Dans le sélecteur « Établissement » du panneau, choisir `primaire-test` : seuls les 13 comptes de l'École restent. Revenir sur « Tous les établissements ».

✅ Panneau présent, 37 comptes au total (12 au Collège, 13 à l'École, 12 à l'Université). Cliquer un compte remplit l'e-mail et le mot de passe (masqué) ; pour un compte à MFA, un bloc "Afficher le code MFA" apparaît sous le bouton.

⚠️ *Écart connu* : sur `/login` (sans `/v2`) le panneau peut être absent ; toujours utiliser `/v2/login`.

☐ OK ☐ KO

---

## Étape 2 — Essayer de se connecter avec des identifiants invalides
👤 **personne non connectée** · fenêtre **A** · 📂 `/v2/login`

Saisir à la main (ne pas utiliser le panneau) puis cliquer **« Se connecter »** :

| Essai | E-mail | Mot de passe |
| :--- | :--- | :--- |
| 1 | `enseignant@secondaire-test.test` | `MotDePasseFaux-TG-2026` |
| 2 | `inconnu.tg@exemple.test` | `MotDePasseFaux-TG-2026` |

✅ Dans les deux cas le même message : "Identifiants invalides. Vérifiez votre e-mail et votre mot de passe." (rien n'indique si le compte existe). Le champ « Mot de passe » est vidé après chaque essai.

⚠️ *Test d'erreur* : e-mail rempli, mot de passe vide → « Se connecter » reste inactif.

☐ OK ☐ KO

---

## Étape 3 — Connexion sans MFA : l'enseignant, puis un refus de droit
👤 **enseignant** (secondaire-test, `enseignant@secondaire-test.test`, sans MFA) · fenêtre **B** (navigation privée) · 📂 `/v2/login`

1. Cliquer le compte « Enseignant » du Collège dans le panneau (le formulaire se remplit), puis **« Se connecter »**.
2. Ouvrir « Mon compte » (en-tête) : "Rôle actif : Enseignant".
3. Taper à la main `/v2/settings` dans la barre d'adresse.
4. Cliquer **« Se déconnecter »** (en haut à droite).

✅ Étape 1 : arrivée directe sur `/v2/teacher`, sans écran de code. Étape 3 : redirection vers `/unauthorized`, page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", aucune donnée de l'établissement. Étape 4 : retour à `/login`.

🔒 *Test de droit* : en enseignant, taper `/v2/access/roles` et `/v2/audit` → même page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 4 — Connexion avec MFA : le propriétaire
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 `/v2/login`

1. Cliquer le compte « Propriétaire » du Collège dans le panneau, puis **« Se connecter »**.
2. L'écran "Vérification en deux étapes" s'affiche : le champ « Code à 6 chiffres » est déjà rempli par le panneau. Cliquer **« Valider »**.

✅ Arrivée sur `/v2/direction` (écran de pilotage du propriétaire), nom de l'établissement dans l'en-tête. La session survit à un rechargement (F5). Cette fenêtre **A** reste connectée au Collège pour la suite.

⚠️ *Test d'erreur* : avant de valider, effacer le code prérempli et saisir `000000`, **« Valider »** → "Code invalide. Vérifiez l'heure de votre téléphone." (l'écran reste ouvert). Cliquer "Recommencer", recliquer le compte, **« Se connecter »**, puis **« Valider »** avec le code prérempli. (Si le code du moment vient d'être utilisé, attendre le suivant.)

☐ OK ☐ KO

---

## Étape 5 — Accueil de gestion et page d'arrivée
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Adresse `/v2/home`

1. Ouvrir `/v2/home`.
2. Lire les cartes : une par module accessible, le titre de la carte est un lien et, dessous, jusqu'à 8 liens d'écrans.
3. Taper `/v2` dans la barre d'adresse.

✅ Titre "Accueil · Collège Le Baobab…" et texte « Raccourcis vers les modules auxquels votre rôle donne accès. ». Cartes attendues, entre autres : « Pilotage », « Académique », « Finance », « Utilisateurs », « Accès et rôles », « Établissement », « Journal d'audit ». Les cartes propres au pack Secondaire existent (« Vie scolaire », « Conseils de classe », « Affectés de l'État ») ; il n'y a ni « Pack Primaire » ni « Enseignement supérieur ». `/v2` redirige vers `/v2/direction`.

☐ OK ☐ KO

---

## Étape 6 — Profil et marque de l'établissement
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Établissement »** > **« Profil et marque »** (`/v2/settings`)

Attendu au départ : « Nom commercial », « Couleur principale » et « Couleur secondaire » probablement vides (les relever). Texte « Aucune modification à enregistrer. », les deux boutons inactifs.

1. Repérer les blocs « Identité », « Contact », « Marque » et « Aperçu ».
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom commercial | `Collège Le Baobab test guide` |
| Couleur principale | `#1A73E8` |
| Couleur secondaire | `#059669` |

3. Observer l'« Aperçu » (bandeau à la couleur principale avec le nom commercial ; « Exemple de bouton » à la couleur secondaire).
4. Cliquer **« Enregistrer le profil »**, puis recharger (F5).
5. **Rétablir** : vider les trois champs (ou remettre les valeurs relevées), **« Enregistrer le profil »**.

✅ Message « Profil enregistré. » ; après rechargement les valeurs sont conservées et l'en-tête affiche le nom commercial. Après l'étape 5, l'en-tête reprend le nom d'origine.

⚠️ *Test d'erreur* : « Couleur principale » = `bleu` → "Couleur hexadécimale attendue (ex. #1A73E8)." ; « Raison sociale » vidée → « La raison sociale est obligatoire. ». Cliquer ensuite **« Annuler les modifications »**.

⚠️ *Écart connu* : ne pas renseigner « Domaine personnalisé » ni de contact (adresses réelles). Plusieurs messages de saisie invalide (e-mail, adresse du logo) sont des messages anglais par défaut : sans gravité pour le guide.

☐ OK ☐ KO

---

## Étape 7 — Campus : créer, modifier, supprimer
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Établissement »** > **« Établissements et campus »** (`/v2/settings/institutions`)

Attendu au départ : un établissement (badges « Secondaire », « Actif »). Ne **pas** utiliser « Nouvel établissement » ici (un établissement ne se supprime pas).

1. Cliquer **« Campus »** sur la ligne de l'établissement : le tableau liste un campus avec le badge « Par défaut ».
2. Cliquer **« Nouveau campus »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom du campus | `Campus annexe test guide` |
| Code | `tg-annexe` |
| Adresse | `Rue des Jardins, Cocody, Abidjan` |
| Ville | `Abidjan` |
| Téléphone | `+225 27 22 44 55 66` |

3. Cliquer **« Enregistrer »**.
4. Crayon « Modifier le campus Campus annexe test guide » : « Ville » = `Yopougon`, **« Enregistrer »**.
5. Corbeille du campus **par défaut** : fenêtre « Supprimer ce campus ? », **« Confirmer »**.
6. Corbeille du campus de test (non par défaut), **« Confirmer »**.

✅ Étape 3 : le campus apparaît dans le tableau (message "Campus … créé."). Étape 4 : « Campus mis à jour. ». Étape 5 : refus du serveur (le campus par défaut ne peut pas être supprimé : message à relever), le campus par défaut reste en place. Étape 6 : « Campus supprimé. », il ne reste que le campus d'origine.

⚠️ *Test d'erreur* : « Code » = `TG ANNEXE` → "Code en minuscules, chiffres et tirets (31 caractères max)."

☐ OK ☐ KO

---

## Étape 8 — Abonnement et usage : offre, modules et fonctionnalités
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Établissement »** > **« Abonnement et usage »** (`/v2/settings/subscription`)

1. Lire le texte « Votre offre, les packs actifs et la consommation mesurée. Les changements d'offre sont gérés par l'équipe EcoleDigitale. » et les valeurs : « Offre » (la clé `PROFESSIONAL` est affichée telle quelle), « Statut de l'abonnement » (« Actif »), « Packs » (« Secondaire »), « Tranche d'apprenants » (« Illimitée »).
2. Dans « Fonctionnalités actives », relever le total, puis déplier un module (par exemple `academic`) : chaque clé indique son origine (« Socle », « Offre », « Pack »).
3. Lire « Usage mesuré » (« Apprenants actifs », « Stockage », « SMS envoyés ») ou « Aucun usage mesuré pour le moment. ».
4. Ouvrir le menu « Modules » (en haut) et lire les entrées propres à l'établissement.

✅ Offre `PROFESSIONAL`, statut « Actif », un seul pack « Secondaire », aucune dérogation. Aucun bouton de modification de l'abonnement n'existe côté établissement. Le menu « Modules » montre « Vie scolaire », « Conseils de classe » et « Affectés de l'État » (pas « Pack Primaire » ni « Enseignement supérieur »). Dans le module `academic`, la clé `academic.state-assigned` existe, pas `academic.a-la-carte` (réservée au supérieur).

🔒 *Test de droit* : fenêtre **B**, connecter le **secrétariat** (`secretariat@secondaire-test.test`, MFA) et taper `/v2/settings/subscription` → la page s'ouvre mais les données sont refusées : "Action non autorisée.". Se déconnecter.

☐ OK ☐ KO

---

## Étape 9 — Rôles et permissions : lire un rôle système
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Accès et rôles »** > **« Rôles et permissions »** (`/v2/access/roles`)

Attendu au départ : 14 rôles de type « Système (verrouillé) », aucun rôle personnalisé.

1. Taper `/v2/access` : redirection vers `/v2/access/roles`. Lire le tableau (légende « Rôles de l'établissement ») : colonnes « Rôle », « Type », « Permissions », « Attributions ». Les boutons « Nouveau rôle » et « Cloner » sont visibles.
2. Ouvrir la ligne « Secrétariat ».

✅ Fiche du rôle : « Clé : secretariat », badge « Système (verrouillé) », bandeau « Rôle système verrouillé » / « Ce rôle ne peut pas être modifié ni supprimé. Clonez-le pour créer une variante. », champs en lecture seule, grille « Permissions du rôle » avec « Rechercher une permission ». Aucun bouton « Enregistrer les modifications » ni « Supprimer le rôle ».

☐ OK ☐ KO

---

## Étape 10 — Créer le rôle personnalisé `tg_secretariat` (clone de Secrétariat)
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 **« Rôles et permissions »** (`/v2/access/roles`)

1. Revenir à la liste. Sur la ligne « Secrétariat », cliquer **« Cloner »**. La fenêtre « Cloner le rôle » s'ouvre.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Libellé du nouveau rôle | `Secrétariat test guide` |
| Clé technique | `tg_secretariat` |
| Description | `Copie de test du guide` |

3. Cliquer **« Créer le clone »**.

✅ Message "Rôle … créé." (nom entre guillemets français) ; ouverture automatique du nouveau rôle : type « Personnalisé », « Clé : tg_secretariat », même nombre de permissions que « Secrétariat », texte « Ce rôle est un clone d'un autre rôle. », boutons « Cloner » et « Supprimer le rôle ». Dans la liste : 15 lignes.

⚠️ *Test d'erreur* : refaire un clonage avec la clé `tg_secretariat` → « Un rôle utilise déjà cette clé. Choisissez-en une autre. » ; clé `owner` → refus du serveur (se termine par "réservée à un modèle système.") ; libellé vide → « obligatoire » sous le champ.

☐ OK ☐ KO

---

## Étape 11 — Ajuster les permissions du rôle personnalisé
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 **« Rôles et permissions »** > ligne "Secrétariat test guide" (`/v2/access/roles`)

1. Ouvrir la fiche du rôle `tg_secretariat`.
2. Dans la grille « Permissions du rôle », saisir `journal` dans « Rechercher une permission », cocher "Consulter le journal d'audit". Constater que "Exporter le journal d'audit" porte l'étiquette « Sensible · MFA » : **ne pas la cocher**.
3. Lire le décompte (le texte "1 permission ajoutée" apparaît), puis cliquer **« Enregistrer les modifications »**.

✅ Message « Rôle enregistré. ». Le rôle a une permission de plus que « Secrétariat » dans la liste. Cette permission sera retirée à la fin de la phase.

⚠️ *Test d'erreur* : saisir `zzz` dans « Rechercher une permission » → « Aucune permission ne correspond à cette recherche. ».

☐ OK ☐ KO

---

## Étape 12 — Attribuer le rôle à l'éducateur et vérifier l'effet
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Accès et rôles »** > **« Attributions de rôles »** (`/v2/access/assignments`)

1. Lire le tableau « Attributions de rôles » ; filtrer « Filtrer par rôle » sur « Propriétaire » : la ligne `direction.generale@secondaire-test.test` porte « Tout l'établissement », « Sans limite », « Active ». Remettre « Tous ».
2. Dans « Nouvelle attribution », saisir :

| Champ | Valeur |
| :--- | :--- |
| Utilisateur | `educateur@secondaire-test.test` |
| Rôle | `Secrétariat test guide` |
| Périmètre | « Tout l'établissement » |
| Valide à partir du / jusqu'au | (vides) |

3. Cliquer **« Attribuer le rôle »**.
4. Fenêtre **B** : se connecter en 👤 **éducateur** (secondaire-test, `educateur@secondaire-test.test`, sans MFA) et ouvrir `/v2/audit`.
5. Fenêtre **A** : ouvrir la fiche du rôle `tg_secretariat`, cliquer **« Supprimer le rôle »**, puis confirmer dans la fenêtre « Supprimer ce rôle ? ».

✅ Étape 3 : message « Rôle attribué. », ligne « Active » dans le tableau. Étape 4 : la page du journal s'ouvre (permission "Consulter le journal d'audit") ; le bouton « Exporter en CSV » est inactif. Si la page est encore refusée, se déconnecter puis se reconnecter (cache de droits, *à vérifier*). Étape 5 : refus « Ce rôle est encore attribué à des utilisateurs. Retirez d'abord ses attributions. » : le rôle n'est pas supprimé.

⚠️ *Test d'erreur* : « Attribuer le rôle » sans rien choisir → « Choisissez un utilisateur. » et « Choisissez un rôle. ».

☐ OK ☐ KO

---

## Étape 13 — Révoquer l'attribution et remettre le rôle en l'état
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 **« Attributions de rôles »** puis fiche du rôle `tg_secretariat`

1. Dans « Attributions de rôles », cliquer l'icône « Révoquer l'attribution de Secrétariat test guide » (ligne de l'éducateur). Dans la fenêtre « Révoquer cette attribution ? », cliquer **« Révoquer »**.
2. Ouvrir la fiche du rôle `tg_secretariat`, rechercher `journal`, **décocher** "Consulter le journal d'audit" ("1 permission retirée"), **« Enregistrer les modifications »**.
3. Fenêtre **B** (éducateur) : recharger `/v2/audit`.

✅ Étape 1 : « Attribution révoquée. ». Étape 2 : « Rôle enregistré. », le rôle retrouve le même nombre de permissions que « Secrétariat ». Étape 3 : « Accès refusé » (au besoin se déconnecter puis se reconnecter). Le rôle `tg_secretariat` reste dans l'application, non attribué.

🔒 *Test de droit* : en éducateur, taper `/v2/access/roles`, `/v2/access/assignments` → « Accès refusé ». Se déconnecter de la fenêtre **B**.

☐ OK ☐ KO

---

## Étape 14 — Le directeur : droits de lecture et anti-escalade
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, **MFA**) · fenêtre **A** (après « Se déconnecter » du propriétaire) · 📂 **« Rôles et permissions »** puis **« Attributions de rôles »**

1. Se connecter en directeur (clic sur le compte du panneau, **« Se connecter »**, **« Valider »**).
2. Ouvrir `/v2/access/roles`.
3. Ouvrir `/v2/access/assignments`. Dans « Nouvelle attribution » choisir l'utilisateur `educateur@secondaire-test.test` et le rôle « Propriétaire », périmètre « Tout l'établissement », puis **« Attribuer le rôle »**.

✅ Étape 2 : la liste est lisible (15 lignes) mais **sans** « Nouveau rôle » ni « Cloner » (la définition des rôles est réservée au propriétaire). Étape 3 : refus « Action refusée : vous ne pouvez accorder que des permissions que vous détenez vous-même sur ce périmètre. Permissions qui vous manquent : » suivi de la liste ; **aucune attribution créée** (le tableau est inchangé). Se déconnecter.

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 01, scénarios 1.13 à 1.19 (cas invalides de saisie, mise en service en lecture 1.15, validité d'une attribution, suppression d'un rôle) ; chapitre 02, scénarios 2.3 à 2.6 (MFA, code de secours, verrouillage après échecs), 2.10 à 2.16 (sessions, sécurité du compte, membres). La console opérateur est traitée en fin de guide.

**Ce que la phase laisse dans l'application :**
- Rôle personnalisé `tg_secretariat` ("Secrétariat test guide"), clone de « Secrétariat », non attribué (15 rôles au total).
- Rien d'autre de durable : profil et campus d'essai sont rétablis ou supprimés, l'attribution à l'éducateur est révoquée.
- Entrées dans le journal d'audit du Collège (`role.changed`, `assignment.changed`, `login.failed`), conservées.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [Suivant →](02-structure-academique.md)
