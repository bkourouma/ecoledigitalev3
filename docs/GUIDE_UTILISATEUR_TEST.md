
# Guide utilisateur de test : EcoleDigitale v2

**Public :** direction d'école, secrétaires, testeurs métier (aucune compétence technique n'est nécessaire).
**Objet :** tester **toute** la nouvelle structure de l'application (plateforme multi-établissements v2) avec la démonstration locale.
**Version du guide :** 2026-10-05, établie à partir du code de la branche `feat/v2-phase-0`.

> **Avant de commencer.** Cette démonstration est un environnement d'essai : les données sont fictives, aucun message ni paiement réel n'est émis, et les règles de calcul des packs Primaire et Secondaire sont des **règles de démonstration** (jamais des règles officielles). Les comptes et mots de passe ne sont pas dans ce guide : ils sont dans le fichier local `.demo/credentials.md`.

## Table des matières


**[Partie 1. Bien démarrer](#partie-1-bien-démarrer)**

- [1. Introduction](#1-introduction)

**[Partie 2. Les rôles de démonstration](#partie-2-les-rôles-de-démonstration)**

- [Rôles et comptes de démonstration](#rôles-et-comptes-de-démonstration)
- [Rôles : tableau récapitulatif](#rôles--tableau-récapitulatif)
- [Rôles : fiches par rôle](#rôles--fiches-par-rôle)
- [Rôles : matrice module par rôle](#rôles--matrice-module-par-rôle)
- [Rôles : cumul de rôles et changement de compte](#rôles--cumul-de-rôles-et-changement-de-compte)
- [Rôles : problèmes connus et limites](#rôles--problèmes-connus-et-limites)
- [Rôles : écarts spec / application (pour l'équipe)](#rôles--écarts-spec--application-pour-léquipe)

**[Partie 3. Les chapitres par domaine](#partie-3-les-chapitres-par-domaine)**

- [Chapitre 1. Plateforme et administration de l'établissement](#chapitre-1-plateforme-et-administration-de-létablissement)
- [Chapitre 2. Connexion, double authentification et comptes](#chapitre-2-connexion-double-authentification-et-comptes)
- [Chapitre 3. Structure académique](#chapitre-3-structure-académique)
- [Chapitre 4. Élèves, tuteurs et personnel](#chapitre-4-élèves-tuteurs-et-personnel)
- [Chapitre 5. Imports de masse (CSV / Excel)](#chapitre-5-imports-de-masse-csv--excel)
- [Chapitre 6. Présences et appel](#chapitre-6-présences-et-appel)
- [Chapitre 7. Emploi du temps](#chapitre-7-emploi-du-temps)
- [Chapitre 8. Évaluations et notes](#chapitre-8-évaluations-et-notes)
- [Chapitre 9. Moteur de règles et résultats](#chapitre-9-moteur-de-règles-et-résultats)
- [Chapitre 10. Bulletins et documents officiels](#chapitre-10-bulletins-et-documents-officiels)
- [Chapitre 11. Enseignement supérieur : UE, ECUE, crédits, relevés](#chapitre-11-enseignement-supérieur--ue-ecue-crédits-relevés)
- [Chapitre 12. Finance et paiements](#chapitre-12-finance-et-paiements)
- [Chapitre 13. Paie du personnel](#chapitre-13-paie-du-personnel)
- [Chapitre 14. Documents (GED)](#chapitre-14-documents-ged)
- [Chapitre 15. Messagerie, annonces et notifications](#chapitre-15-messagerie-annonces-et-notifications)
- [Chapitre 16. Tableaux de bord de direction et alertes](#chapitre-16-tableaux-de-bord-de-direction-et-alertes)
- [Chapitre 17. Admissions](#chapitre-17-admissions)
- [Chapitre 18. Pack Primaire : maternelle, primaire, compétences, conseil des maîtres, bilan annuel, examens type CEPE](#chapitre-18-pack-primaire--maternelle-primaire-compétences-conseil-des-maîtres-bilan-annuel-examens-type-cepe)
- [Chapitre 19. Pack Secondaire : vie scolaire, élèves affectés par l'État, conseil de classe, examens blancs](#chapitre-19-pack-secondaire--vie-scolaire-élèves-affectés-par-létat-conseil-de-classe-examens-blancs)
- [Chapitre 20. Portails parent, élève et enseignant](#chapitre-20-portails-parent-élève-et-enseignant)
- [Chapitre 21. Accessibilité et mobile](#chapitre-21-accessibilité-et-mobile)
- [Chapitre 22. Hors ligne et application installable (PWA)](#chapitre-22-hors-ligne-et-application-installable-pwa)

**[Partie 4. Parcours de bout en bout](#partie-4-parcours-de-bout-en-bout)**

- [Parcours A. Admission, inscription, appel, notes, résultats, bulletin, famille (Collège Le Baobab)](#parcours-a-admission-inscription-appel-notes-résultats-bulletin-famille-collège-le-baobab)
- [Parcours B. Incident de vie scolaire, validation de la direction, information de la famille (Collège Le Baobab)](#parcours-b-incident-de-vie-scolaire-validation-de-la-direction-information-de-la-famille-collège-le-baobab)
- [Parcours C. Conseil de classe, décision, procès-verbal (Collège Le Baobab)](#parcours-c-conseil-de-classe-décision-procès-verbal-collège-le-baobab)
- [Parcours D. Primaire : admission, inscription, appel, compétences, conseil des maîtres, bilan annuel (École Les Palmiers)](#parcours-d-primaire--admission-inscription-appel-compétences-conseil-des-maîtres-bilan-annuel-école-les-palmiers)
- [Parcours E. Supérieur : notes, semestre validé, relevé, rattrapage, diplôme (Université Horizon)](#parcours-e-supérieur--notes-semestre-validé-relevé-rattrapage-diplôme-université-horizon)
- [Parcours F. Facturation, paiement, reçu, remboursement (tous établissements)](#parcours-f-facturation-paiement-reçu-remboursement-tous-établissements)
- [Parcours G. Élève affecté par l'État (Collège Le Baobab)](#parcours-g-élève-affecté-par-létat-collège-le-baobab)
- [Parcours H. Paie d'un enseignant (Collège Le Baobab)](#parcours-h-paie-dun-enseignant-collège-le-baobab)

**[Partie 5. Tests d'isolation et de sécurité](#partie-5-tests-disolation-et-de-sécurité)**

- [5.1 Isolation entre établissements](#51-isolation-entre-établissements)
- [5.2 Un parent ne voit que ses enfants](#52-un-parent-ne-voit-que-ses-enfants)
- [5.3 Permissions par rôle : adresses à essayer](#53-permissions-par-rôle--adresses-à-essayer)
- [5.4 Séparation des tâches (quatre yeux)](#54-séparation-des-tâches-quatre-yeux)
- [5.5 Sessions : révocation et déconnexion](#55-sessions--révocation-et-déconnexion)
- [5.6 MFA (double authentification)](#56-mfa-double-authentification)
- [5.7 Traçabilité : le journal d'audit](#57-traçabilité--le-journal-daudit)
- [5.8 Bilan de sécurité](#58-bilan-de-sécurité)

**[Partie 6. Fiche de recueil des anomalies](#partie-6-fiche-de-recueil-des-anomalies)**

- [6.1 Modèle de tableau](#61-modèle-de-tableau)
- [6.2 Conseils pour décrire une anomalie](#62-conseils-pour-décrire-une-anomalie)
- [6.3 Échelle de gravité](#63-échelle-de-gravité)
- [6.4 Synthèse de fin de recette](#64-synthèse-de-fin-de-recette)

**[Partie 7. Limites, dépannage, glossaire et annexes](#partie-7-limites-dépannage-glossaire-et-annexes)**

- [7.1 Limites connues de la démonstration](#71-limites-connues-de-la-démonstration)
- [7.2 Ce qui n'est pas testable avec la démonstration](#72-ce-qui-nest-pas-testable-avec-la-démonstration)
- [7.3 Dépannage](#73-dépannage)
- [7.4 Glossaire](#74-glossaire)

**[Annexe. Récapitulatif des adresses (URL)](#annexe-récapitulatif-des-adresses-url)**

- [A. Adresses de base par établissement](#a-adresses-de-base-par-établissement)
- [B. Pages d'atterrissage par rôle](#b-pages-datterrissage-par-rôle)
- [C. Adresses par domaine (à ajouter après l'adresse de l'établissement)](#c-adresses-par-domaine-à-ajouter-après-ladresse-de-létablissement)
- [D. Fichiers et commandes utiles](#d-fichiers-et-commandes-utiles)


# Partie 1. Bien démarrer

## 1. Introduction

### 1.1 Ce qu'est EcoleDigitale v2

EcoleDigitale v2 est une plateforme de gestion scolaire pour **plusieurs établissements** sur un même système. Chaque établissement (collège, école, université) a ses propres données, ses propres comptes et ses propres règles. Un utilisateur d'un établissement ne voit **rien** des autres. Dans ce guide, on dit « établissement » là où les équipes techniques disent « tenant ».

La plateforme couvre :

- la vie de l'établissement : années, périodes, classes, programmes, élèves, tuteurs, personnel ;
- le travail pédagogique : présences et appel, emplois du temps, évaluations et notes, résultats, bulletins et documents officiels ;
- la gestion : admissions, finance et paiements, paie, documents, messagerie, tableaux de bord de direction ;
- les **packs métier** : Primaire (maternelle, compétences, conseil des maîtres, bilan annuel), Secondaire (vie scolaire, élèves affectés par l'État, conseil de classe), Supérieur (UE, ECUE, crédits, relevés) ;
- les portails des familles, des élèves et des enseignants.

Ce guide vous aide à tester **toute** cette structure avec la démonstration locale, pas à pas, avec ce que vous devez voir à chaque étape.

### 1.2 Les trois établissements de démonstration

| Établissement | Type | Adresse de connexion | Classe(s) principale(s) | Particularités |
|---|---|---|---|---|
| **Collège Le Baobab** (`demo-secondaire`) | Secondaire (collège et lycée) | `http://demo-secondaire.localhost:3100/v2/login` | 6e A | Trois trimestres. Vie scolaire, élèves affectés par l'État, conseil de classe, examens (session officielle et examen blanc), bulletins PDF, admissions. |
| **École Les Palmiers** (`demo-primaire`) | Primaire avec maternelle | `http://demo-primaire.localhost:3100/v2/login` | CP1 A, Grande Section A (maternelle) | Deux semestres. Compétences sans note en maternelle, conseil des maîtres, bilans annuels (certains scellés), bulletins du primaire. |
| **Université Horizon** (`demo-superieur`) | Supérieur (LMD) | `http://demo-superieur.localhost:3100/v2/login` | Licence 1 A (L1-A) | Deux semestres. Unités d'enseignement (UE) et éléments constitutifs (ECUE), crédits, relevés de notes. |

Autre porte d'entrée : la **console de la plateforme** (opérateur) : `http://localhost:3100/v2/platform/login`.

> Les noms de personnes (élèves, tuteurs, enseignants) sont fictifs et identiques dans les trois établissements. Exemple : le compte « Parent » est Séka DIABATE, tuteur de Nadia DIABATE et de Salimata DIABATE. Les adresses e-mail se terminent par `.test` : elles n'existent pas sur Internet.

### 1.3 Les règles de démonstration (très important)

- Les packs **Primaire** et **Secondaire** utilisent des **jeux de règles de démonstration** (fictifs). Aucune règle officielle ivoirienne (moyennes, passage de classe, CEPE, BEPC, BAC, MGA...) n'est livrée ni inventée.
- Les écrans du pack Primaire, des examens et du pilotage affichent un bandeau **« Règles de démonstration »** (texte du type : ces moyennes, taux de validation et décisions ne sont pas officiels). Les documents officiels (bulletins, procès-verbaux, bilans) portent le **filigrane « démonstration »**. Les écrans de résultats, de règles et de bulletins n'ont pas ce bandeau : la mention figure dans le PDF et dans la vérification publique (voir les chapitres 9 et 10).
- **Ne tirez jamais une conclusion réglementaire** d'un résultat de la démonstration. Un document officiel sans filigrane « démonstration » alors qu'il a été calculé avec un jeu de démonstration est une anomalie à signaler (voir la partie 6).
- Le Supérieur utilise le jeu de règles de la plateforme `CI-HIGHER-LMD` (reprise du calcul historique des crédits).

### 1.4 Ce qui est simulé

| Sujet | Ce qui se passe dans la démonstration |
|---|---|
| E-mail, SMS, WhatsApp | **Aucun envoi réel.** Les messages sont enregistrés dans le journal des notifications avec le statut « Simulé » (SIMULATED dans les journaux techniques). |
| Invitations et « mot de passe oublié » | Aucun e-mail n'est envoyé : le lien est écrit dans la boîte aux lettres locale (fichier `.demo/mailbox.jsonl`, champ `link`). |
| Paiements en ligne | Fournisseur **SANDBOX** (bac à sable) : aucun argent réel, aucun appel réseau. Le résultat dépend du montant (voir le chapitre 12). |
| Orange Money, MTN MoMo, Wave, CinetPay, TresorPay | Non configurés. |
| Passerelle de l'État (élèves affectés) | Absente : tout est saisi à la main. |
| Alertes de direction, relances | Calculées par des tâches planifiées (toutes les 15 minutes pour les alertes) : elles n'apparaissent pas instantanément. |

### 1.5 Prérequis

| Élément | Détail |
|---|---|
| Ordinateur | Windows, macOS ou Linux, environ 2 Go de mémoire libre pour toute la démonstration. |
| Docker Desktop | Installé et **démarré** (la base de données et le cache tournent dans deux conteneurs `ed-demo-*`). |
| Node.js et pnpm | Node 20 ou plus (18 minimum), pnpm 9 ou plus ; `pnpm install` une fois à la racine du projet. |
| Navigateur | Chrome, Edge ou Firefox récents. Chrome ou Edge sert aussi au rendu des bulletins PDF (côté machine). |
| Application d'authentification | Facultative : les codes de connexion (MFA) des comptes de démonstration s'obtiennent par une commande, voir 1.7. |

Ces opérations sont en général faites par une personne de l'équipe technique. Si la démonstration tourne déjà sur votre poste, passez directement à 1.7.

### 1.6 Démarrer, arrêter, réinitialiser

À taper dans un terminal, à la racine du projet.

| Commande | Effet |
|---|---|
| `pnpm demo:up` | Démarre tout (base, données de démonstration, serveur, application web) et affiche les adresses. Reste au premier plan : **Ctrl+C** arrête proprement (les données sont conservées). Premier démarrage : environ 3 minutes ; démarrages suivants : environ 40 secondes. |
| `pnpm demo:up -- --detach` | Idem, mais rend la main : la démonstration tourne en arrière-plan. |
| `pnpm demo:status` | Affiche l'état, les ports et les adresses. |
| `pnpm demo:down` | Arrête la démonstration. Les données et les comptes sont **conservés**. |
| `pnpm demo:reset` | Supprime **toutes** les données de démonstration et les comptes ; le `demo:up` suivant repart de zéro avec de nouveaux mots de passe. À utiliser quand vous avez fait des actions irréversibles et voulez recommencer. |
| `pnpm demo:totp <e-mail>` | Affiche le **code à 6 chiffres** (MFA) courant d'un compte. Variante : `pnpm demo:totp demo-secondaire proprietaire`. |
| `pnpm demo:smoke` | Contrôle automatique rapide (connexions, pages clés, isolation entre établissements). Environ 20 secondes. |

Adresses par défaut : application web `http://localhost:3100`, serveur `127.0.0.1:4100`. Si un port est occupé, le suivant est choisi : `pnpm demo:status` donne les adresses réelles.

> Dans ce guide, les adresses sont écrites sous la forme `/v2/...`. Ajoutez devant l'adresse de **l'établissement** concerné, par exemple `http://demo-secondaire.localhost:3100/v2/finance`.

### 1.7 Où trouver les comptes, et se connecter

**Les comptes et les mots de passe ne figurent pas dans ce guide.** Ils sont générés au démarrage et écrits dans le fichier local **`.demo/credentials.md`** (à la racine du projet, jamais partagé). Ouvrez-le : il liste, pour chaque établissement, l'adresse e-mail et le mot de passe de chaque rôle. Les adresses ont toujours la même forme :

| Rôle | Adresse e-mail |
|---|---|
| Propriétaire | `direction.generale@<établissement>.test` |
| Directeur | `directeur@<établissement>.test` |
| Directeur des études | `etudes@<établissement>.test` |
| Responsable pédagogique | `pedagogie@<établissement>.test` |
| Secrétariat | `secretariat@<établissement>.test` |
| Économe | `econome@<établissement>.test` |
| Enseignant (instituteur au primaire) | `enseignant@<établissement>.test` |
| Éducateur | `educateur@<établissement>.test` |
| Responsable des examens | `examens@<établissement>.test` |
| Chargé d'admissions | `admissions@<établissement>.test` |
| Instituteur de la maternelle (primaire seulement) | `instituteur.maternelle@demo-primaire.test` |
| Parent | `parent@<établissement>.test` |
| Élève | `eleve@<établissement>.test` |
| Opérateur de la plateforme | `plateforme@demo.test` |

où `<établissement>` vaut `demo-secondaire`, `demo-primaire` ou `demo-superieur`.

**Connexion pas à pas (compte sans MFA : enseignant, éducateur, examens, admissions, parent, élève, opérateur)**

1. Ouvrez l'adresse de connexion de l'établissement (voir 1.2), par exemple `http://demo-secondaire.localhost:3100/v2/login`. L'établissement visé est celui du sous-domaine (`demo-secondaire.localhost`).
2. Saisissez l'**Adresse e-mail** et le **Mot de passe**, puis cliquez sur **Se connecter**.
3. Vous arrivez sur l'écran d'accueil de votre rôle (voir la partie 2).

**Connexion pas à pas (compte avec MFA : propriétaire, directeur, directeur des études, responsable pédagogique, secrétariat, économe)**

1. Faites les étapes 1 et 2 ci-dessus. L'écran **« Vérification en deux étapes »** apparaît : « Saisissez le code à 6 chiffres de votre application d'authentification ».
2. Dans un terminal, tapez `pnpm demo:totp <e-mail du compte>` (par exemple `pnpm demo:totp direction.generale@demo-secondaire.test`). Le terminal affiche le code courant et le temps restant.
3. Saisissez le code dans **« Code à 6 chiffres »** et cliquez sur **Valider**.
4. Si le code est refusé : un code **ne sert qu'une fois** et change toutes les 30 secondes. Attendez le suivant et réessayez. L'horloge de l'ordinateur doit être exacte.
5. Les boutons **« Utiliser un code de secours »** et **« Recommencer »** permettent d'utiliser un code de secours ou de revenir à la saisie de l'adresse.

> Pour tester plusieurs comptes en même temps (par exemple un parent et un directeur), utilisez des **fenêtres de navigation privée** ou des navigateurs différents : une seule session par fenêtre.

### 1.8 Temps de chargement lent

La démonstration utilise l'application web en **mode développement**. Conséquences normales :

- la **première visite de chaque page** peut prendre de quelques secondes à plus d'une minute (la page est préparée à la demande) ; les visites suivantes sont rapides ;
- ne cliquez pas plusieurs fois : attendez que la page s'affiche ;
- si une page reste blanche ou affiche une erreur technique au premier chargement, rechargez-la une fois avant de signaler une anomalie.

### 1.9 Comment lire ce guide

**Ordre de lecture recommandé**

1. Lisez cette introduction (partie 1) et l'index des rôles (partie 2).
2. Faites le chapitre 2 (connexion et double authentification) avec deux comptes.
3. Faites les chapitres de votre domaine. Parcours conseillés :
   - **Direction d'école** : chapitres 1, 3, 8, 9, 10, 12, 16, puis les parcours de la partie 4.
   - **Secrétaire / scolarité** : chapitres 3, 4, 5, 6, 17, puis le parcours A.
   - **Économe** : chapitres 12, 13, 20 (portail parent).
   - **Enseignants / instituteurs** : chapitres 6, 7, 8, 18, 20, 22.
   - **Testeur sécurité** : chapitres 1, 2, puis la partie 5.
4. Terminez par les parcours de bout en bout (partie 4) et les tests d'isolation (partie 5).
5. Notez chaque anomalie avec la fiche de la partie 6.

**Conventions**

- `- [ ]` : case à cocher à remplir au fur et à mesure.
- **Résultat attendu** : ce que vous devez voir. Si vous voyez autre chose, c'est une anomalie à noter.
- Les textes entre guillemets français « ... » sont les libellés exacts de l'écran.
- « Menu » désigne le menu latéral ou supérieur de l'application ; le chemin s'écrit « Menu A » > « Sous-menu B ».
- **Action irréversible** : action qui ne peut pas être annulée (scellement, publication, clôture de période...). Faites-la en dernier, sur un seul compte, et utilisez `pnpm demo:reset` si vous voulez recommencer.
- **(à confirmer)** : information que l'auteur n'a pas pu vérifier dans le code ; confirmez-la en testant et signalez l'écart.
- **Page introuvable** : un élément hors de votre périmètre (autre établissement, enfant d'un autre parent...) doit répondre exactement comme s'il n'existait pas. Il ne doit pas dire « accès refusé » ni révéler son existence. C'est voulu : cela évite de découvrir des informations par déduction.

### 1.10 Les chapitres et leur durée estimée

Les durées sont indicatives (lecture et saisie comprises). Comptez environ 35 à 45 heures pour tout faire ; les chapitres sont indépendants, sauf mention contraire.

| Chapitre | Sujet | Durée | Comptes principaux |
|---|---|---|---|
| 1 | Plateforme et administration | 1 h à 1 h 30 | Propriétaire, directeur, opérateur |
| 2 | Connexion, double authentification et comptes | 1 h à 1 h 30 | Tous les rôles |
| 3 | Structure académique | 1 h à 1 h 30 | Directeur des études, secrétariat |
| 4 | Élèves, tuteurs et personnel | 1 h à 1 h 30 | Secrétariat, direction |
| 5 | Imports de masse (CSV / Excel) | 45 min à 1 h | Secrétariat |
| 6 | Présences et appel | 1 h à 1 h 30 | Enseignant, éducateur, direction |
| 7 | Emploi du temps | 45 min à 1 h | Directeur des études, enseignant |
| 8 | Évaluations et notes | 1 h à 1 h 30 | Enseignant, pédagogique, direction |
| 9 | Moteur de règles et résultats | 1 h à 1 h 30 | Directeur des études, direction |
| 10 | Bulletins et documents officiels | 1 h à 1 h 30 | Directeur des études, direction |
| 11 | Enseignement supérieur | 1 h à 1 h 30 | Directeur des études (Université Horizon) |
| 12 | Finance et paiements | 2 h 30 à 3 h 30 | Économe, parent, direction |
| 13 | Paie du personnel | 1 h 30 à 2 h 15 | Économe, direction, enseignant |
| 14 | Documents (GED) | 1 h 15 à 1 h 40 | Secrétariat, direction |
| 15 | Messagerie, annonces et notifications | 1 h 30 à 2 h | Direction, parent, enseignant |
| 16 | Tableaux de bord de direction et alertes | 1 h 30 à 2 h | Propriétaire, directeur |
| 17 | Admissions | 2 h 30 à 3 h 30 | Chargé d'admissions, direction |
| 18 | Pack Primaire et examens type CEPE | 3 h à 4 h | Instituteur, direction, examens |
| 19 | Pack Secondaire : vie scolaire, affectés, conseil de classe, examens blancs | 2 h 30 à 3 h 30 | Éducateur, direction, secrétariat |
| 20 | Portails parent, élève et enseignant | 1 h 30 à 2 h 15 | Parent, élève, enseignant |
| 21 | Accessibilité et mobile | 2 h à 3 h | Tous |
| 22 | Hors ligne et application installable | 1 h 15 à 1 h 45 | Enseignant, instituteur |

Parties 4 à 7 : parcours de bout en bout (3 à 4 h), tests d'isolation et de sécurité (2 à 3 h), fiche d'anomalies, limites, dépannage, glossaire et annexe.


# Partie 2. Les rôles de démonstration


## Rôles et comptes de démonstration

> **À quoi sert cette partie.** Savoir, pour chaque compte de démonstration, ce qu'il doit voir dans le menu, ce qu'il peut faire et surtout ce qu'il ne doit PAS pouvoir faire. Les tests négatifs (section « Tests négatifs » de chaque fiche) sont aussi importants que les tests positifs : un rôle qui voit trop est une faille.
>
> **Comment lire les libellés.** Les noms de menu sont recopiés des écrans (entre guillemets français). Le menu est construit à partir de trois choses : les droits du rôle, les fonctionnalités de l'abonnement de l'établissement et, pour les portails parent, élève et enseignant, une liste fixe d'écrans. Une entrée absente du menu n'est donc pas un défaut si le rôle n'a pas le droit ou si le pack de l'établissement ne la contient pas.
>
> **Ce que veut dire « page Accès refusé ».** Quand un rôle ouvre à la main (en tapant l'adresse) une page qui ne lui est pas permise, l'application le renvoie vers l'adresse `/unauthorized`, qui affiche le titre « Accès refusé » et le texte « Vous n'avez pas les droits nécessaires pour afficher cette page. », avec un lien « Retour à l'accueil ». C'est le comportement attendu dans tous les tests négatifs de cette partie, sauf indication contraire. Quelques écrans affichent à la place, dans la page, le message « Vous n'avez pas les droits nécessaires pour cette action. ».
>
> **Mots de passe et codes MFA.** Aucun mot de passe n'est écrit ici. Ils sont dans le fichier des comptes de démonstration (`.demo/credentials.md`). Pour un compte avec MFA, le code à 6 chiffres s'obtient avec `pnpm demo:totp <e-mail>` (voir l'introduction).

### Les trois établissements et leur contenu

| Établissement | Adresse de connexion | Pack | Modules propres à ce pack |
|---|---|---|---|
| Collège Le Baobab (démonstration) | `http://demo-secondaire.localhost:3100/v2/login` | Secondaire | Conseils de classe, Vie scolaire, Affectés de l'État (et leur facturation) |
| École Les Palmiers (démonstration) | `http://demo-primaire.localhost:3100/v2/login` | Primaire | Pack Primaire (compétences, conseil des maîtres, bilans annuels, archives, états) |
| Université Horizon (démonstration) | `http://demo-superieur.localhost:3100/v2/login` | Supérieur (LMD) | Diplômes, documents officiels, rattrapages, prérequis, signataires, offres de cours (inscription à la carte) |

Les entrées de menu d'un module propre à un pack n'apparaissent que dans l'établissement qui a ce pack. Les autres modules (admissions, finance, paie, présences, examens, documents, etc.) existent dans les trois.

---

## Rôles : tableau récapitulatif

Tous les comptes ont la forme `<début>@<établissement>.test`, avec l'établissement `demo-secondaire`, `demo-primaire` ou `demo-superieur`. Exemple : `secretariat@demo-secondaire.test`.

| Rôle (libellé du modèle) | E-mail type | Établissement(s) où le compte existe | MFA | Page d'arrivée après la connexion |
|---|---|---|---|---|
| Propriétaire | `direction.generale@<établissement>.test` | les trois | oui | `/v2/direction` (« Tableau de bord de la direction ») |
| Directeur | `directeur@<établissement>.test` | les trois | oui | `/v2/direction` |
| Directeur des études | `etudes@<établissement>.test` | les trois | oui | `/v2/academic`, qui ouvre aussitôt `/v2/academic/years` (« Années et périodes ») |
| Responsable pédagogique | `pedagogie@<établissement>.test` | les trois | oui | `/v2/assessments` (liste des évaluations) |
| Secrétariat | `secretariat@<établissement>.test` | les trois | oui | `/v2/students` (liste des élèves) |
| Économe | `econome@<établissement>.test` | les trois | oui | `/v2/finance` (vue d'ensemble de la finance) |
| Enseignant | `enseignant@<établissement>.test` | secondaire et supérieur (3 enseignants de la graine : `enseignant@`, `enseignant2@`, `enseignant3@`) | non | `/v2/teacher` (« Aujourd'hui ») |
| Instituteur (titulaire du CP1 A) | `enseignant@demo-primaire.test` | primaire seulement (c'est le compte « enseignant@ » du primaire, qui porte le rôle Instituteur) | non | `/v2/primary`, qui ouvre aussitôt `/v2/primary/classe` (« Ma classe (primaire) ») |
| Instituteur de la maternelle (Grande Section A) | `instituteur.maternelle@demo-primaire.test` | primaire seulement | non | `/v2/primary` puis `/v2/primary/classe` |
| Éducateur | `educateur@<établissement>.test` | les trois (utile surtout au secondaire, où la vie scolaire est remplie) | non | `/v2/attendance` (suivi des appels) |
| Responsable des examens | `examens@<établissement>.test` | les trois (la session d'examen et l'examen blanc de démonstration ne sont créés qu'au secondaire) | non | `/v2/examinations` (« Examens ») |
| Chargé d'admissions | `admissions@<établissement>.test` | les trois (la campagne `RENTREE-6E` est au secondaire, `RENTREE-L1` au supérieur ; le primaire a ses candidatures de maternelle) | non | `/v2/admissions` (« Admissions ») |
| Parent | `parent@<établissement>.test` (Séka DIABATE, enfants Nadia et Salimata DIABATE) | les trois | non | `/v2/parent` (« Mes enfants ») |
| Élève | `eleve@<établissement>.test` (Nadia DIABATE) | les trois | non | `/v2/student` (« Mon dossier ») |
| Opérateur de la plateforme | `plateforme@demo.test` | aucun établissement : console `http://localhost:3100/v2/platform/login` | non | `/v2/platform/tenants` (« Organisations ») |

Remarques utiles pour le testeur :

- Le rôle « Personnel » (fiche, présence, congés, bulletins de paie propres) existe dans le modèle de rôles mais **aucun compte de démonstration ne le porte seul** : il sert à être cumulé avec un autre rôle (voir la section « Rôles : cumul de rôles et changement de compte »).
- Dans l'en-tête, le menu « Mon compte » affiche « Rôle actif ». Le libellé affiché pour le chargé d'admissions y est « Chargé des admissions » (le modèle de rôle dit « Chargé d'admissions »). Le compte de la maternelle y est affiché « Instituteur » (le rôle réel est Instituteur ; « Institutrice de maternelle » est seulement le nom du compte dans le fichier des comptes). (à confirmer à l'écran)
- Les comptes MFA (propriétaire, directeur, directeur des études, responsable pédagogique, secrétariat, économe) demandent le code à 6 chiffres après le mot de passe. Un code ne sert qu'une fois : en cas d'échec, attendre 30 secondes.
- Le propriétaire et le directeur arrivent sur le même écran. L'ancienne adresse `/v2/owner` redirige vers `/v2/direction` ; l'écran « Fraîcheur des données » est `/v2/owner/fraicheur`.

---

## Rôles : fiches par rôle

Convention pour les menus : le menu de gestion est regroupé par module (« Pilotage », « Académique », « Personnes », etc.). Les entrées marquées (secondaire), (primaire) ou (supérieur) n'existent que dans l'établissement qui a ce pack. Quatre entrées de l'application n'ont pas d'écran et sont **toujours masquées** pour tous les rôles : « Paramètres de présence », « Paramètres des personnes », « Calendrier de l'établissement », « Validation des séances ». Ce n'est pas un défaut à signaler. Les entrées « Périodes : verrouillage et clôture » et « Résultats de classe » ouvrent le même écran : une seule apparaît.

### Propriétaire

**Ce qu'il voit dans le menu.** Tout ce que l'abonnement de l'établissement permet (le propriétaire détient tous les droits, sauf la console de la plateforme). Menu de gestion par module :

- **Pilotage** : « Tableau de bord de la direction », « Effectifs et présences », « Pédagogie », « Scolarité », « Trésorerie », « Masse salariale », « Indicateurs de direction », « Admissions », « Vie scolaire (agrégée) », « Comparaisons », « Alertes de direction », « Règles d'alerte », « Charges et résultat ».
- **Admissions** : « Admissions », « Candidatures », « Prospects », « Listes d'attente », « Campagnes d'admission », « Parcours d'admission », « Recrutement : tableaux de bord », « Paramètres des admissions ».
- **Académique** : « Années et périodes », « Programmes et niveaux », « Curriculum », « Classes », « Offres de cours » (supérieur), « Inscriptions », « Reconduction annuelle », « Paramètres académiques ».
- **Personnes** : « Élèves », « Parents et tuteurs », « Personnel », « Affectations ».
- **Emploi du temps** : « Emplois du temps », « Salles et équipements », « Remplacements ».
- **Présences** : « Suivi des appels », « Justificatifs d'absence », « Présence du personnel ».
- **Évaluations** : « Feuilles à relire », « Corrections de notes », « Types d'évaluation ».
- **Résultats** : « Résultats de classe », « Délibérations ».
- **Bulletins** : « Bulletins — émission », « Bulletins — liste », « Identité et signataires », « Modèles de documents ».
- **Conseils de classe** (secondaire) : « Conseils de classe », « Effets des décisions », « Orientation », « Paramètres des conseils ».
- **Vie scolaire** (secondaire) : « Vie scolaire », « Mesures à valider », « Convocations », « Paramètres de vie scolaire ».
- **Examens** : « Examens », « Candidats aux examens », « Centres et salles », « Examens blancs », « Résultats d'examen », « Statistiques d'examen », « Exports d'examen », « Corrections d'examen ».
- **Pack Primaire** (primaire) : « Pack Primaire », « Conseil des maîtres », « Bilans annuels », « Archives d'année », « États du primaire ».
- **Enseignement supérieur** (supérieur) : « Diplômes », « Documents officiels », « Rattrapages », « Prérequis », « Signataires ».
- **Affectés de l'État** (secondaire) : « Élèves affectés », « Vérification des affectations », « Rapprochement des affectations », « Créances sur l'État », « États des affectations », « Paramètres des affectations ».
- **Finance** : « Facturation », « Encaissements », « Caisse », « Frais et barèmes », « Tableau de bord financier », « Paiements en ligne », « Fournisseurs de paiement », « Paiements à rapprocher », « Webhooks en échec », « Élèves affectés par l'État » (secondaire).
- **Paie** : « Bulletins de paie », « Configuration de la paie », « Historique des paiements », « Rapports de paie », « Masse salariale ».
- **Documents** : « Documents », « Documents à échéance », « Catégories de documents », « Quarantaine des documents », « Paramètres des documents ».
- **Communication** : « Messages », « Annonces », « Modération des messages », « Paramètres de la messagerie ».
- **Notifications** : « Journal des notifications », « Gabarits de notification », « Règles et alertes », « Canaux d'envoi », « Mes notifications ».
- **Imports** : « Imports Excel / CSV ». **Règles de calcul** : « Règles de calcul ».
- **Utilisateurs** : « Utilisateurs ». **Accès et rôles** : « Rôles et permissions », « Attributions de rôles ».
- **Établissement** : « Établissement ». **Journal d'audit** : « Journal d'audit ».

Entrées conditionnées par l'abonnement : celles marquées par pack ci-dessus ; « Offres de cours » (inscription à la carte, supérieur) ; « Paiements en ligne », « Fournisseurs de paiement », « Paiements à rapprocher » et « Webhooks en échec » (paiement en ligne) ; « Journal d'audit » (fonctionnalité « Journal d'audit »).

**Ce qu'il peut faire de plus important.**

- Piloter l'établissement depuis le tableau de bord de la direction (effectifs, pédagogie, scolarité, trésorerie, masse salariale, charges, alertes).
- Gérer l'abonnement et l'usage (écran « Établissement », rubrique abonnement) : seul rôle qui peut le modifier avec le directeur en lecture.
- Définir les rôles (« Rôles et permissions ») et les attribuer (« Attributions de rôles »), gérer les membres (« Utilisateurs »).
- Valider la paie au-delà du seuil propriétaire et régler les paramètres de paie (seuil, séparation des tâches).
- Consulter et exporter le journal d'audit (action sensible : MFA exigée).
- Faire tous les actes de direction : clôturer une période, publier des notes, émettre et révoquer des bulletins, décider d'une admission, appliquer une sanction, sceller un bilan annuel, forcer ou révoquer un diplôme.

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Ouvrir la console de la plateforme : `http://localhost:3100/v2/platform/tenants` avec son compte d'établissement. Attendu : redirection vers `/v2/platform/login` (la console demande une connexion d'opérateur distincte).
- Voir les données d'un autre établissement : connecté sur `demo-secondaire`, ouvrir `http://demo-primaire.localhost:3100/v2/direction`. Attendu : la session n'est pas reconnue, retour à la page de connexion. (à confirmer)
- Voir un module d'un pack qu'il n'a pas : dans `demo-primaire`, ouvrir `/v2/schoollife`. Attendu : aucune entrée « Vie scolaire » dans le menu, et l'écran direct n'affiche pas de données (message du type « Cette fonctionnalité n'est pas incluse dans votre offre »). (à confirmer)
- Modifier le catalogue national des règles : il n'existe aucun écran pour cela dans l'établissement (réservé à la plateforme).

### Directeur

**Ce qu'il voit dans le menu.** Le même menu que le propriétaire (mêmes modules, mêmes entrées), y compris « Rôles et permissions », « Attributions de rôles », « Utilisateurs », « Établissement » et « Journal d'audit ». Ce qui change est ce qu'il peut modifier à l'intérieur de ces écrans (voir ci-dessous).

**Ce qu'il peut faire de plus important.**

- Tous les actes de direction du propriétaire, sauf quatre : modifier l'abonnement, définir les rôles, valider la paie au-delà du seuil propriétaire, régler les paramètres de paie.
- Attribuer et retirer des rôles au personnel (écran « Attributions de rôles »), réinitialiser la double authentification d'un membre.
- Valider les appels, publier et corriger les notes, clôturer, verrouiller et rouvrir les périodes, décider en délibération.
- Valider les mesures de vie scolaire (sanctions, exclusions) et appliquer leur effet ; trancher un recours.
- Vérifier, activer, suspendre un dossier d'élève affecté par l'État ; décider d'une admission ; sceller un bilan annuel (primaire).
- Arrêter, verser et annuler les bulletins de paie ; consulter la masse salariale ; rejouer un paiement en ligne en échec.

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Ouvrir `/v2/payroll/configuration/settings` (réglages de paie : seuil propriétaire, séparation des tâches). Attendu : page « Accès refusé ».
- Définir ou modifier un rôle : sur `/v2/access/roles`, il voit la liste des rôles mais les actions de création, de clonage ou de modification doivent être absentes ou refusées. (à confirmer à l'écran)
- Modifier l'abonnement : sur `/v2/settings/subscription` (« Abonnement et usage »), il peut consulter mais pas changer le plan ni les fonctionnalités. (à confirmer à l'écran)
- Ouvrir la console de la plateforme `/v2/platform/plans` : redirection vers `/v2/platform/login`.
- Même en étant directeur, ne pas pouvoir valider lui-même ce qu'il a lui-même demandé ou saisi : la séparation par personne est appliquée (ex. une mesure de vie scolaire proposée par lui ne peut être validée par lui). (à confirmer selon la donnée)

### Directeur des études

**Ce qu'il voit dans le menu.**

- **Pilotage** : « Pédagogie », « Admissions », « Vie scolaire (agrégée) », « Alertes de direction », « Règles d'alerte ». Pas de « Tableau de bord de la direction », ni de scolarité, trésorerie, masse salariale ou charges.
- **Académique** : « Années et périodes », « Programmes et niveaux », « Curriculum », « Classes », « Offres de cours » (supérieur), « Inscriptions », « Paramètres académiques ». Pas de « Reconduction annuelle ».
- **Personnes** : « Élèves », « Parents et tuteurs », « Personnel », « Affectations ».
- **Emploi du temps** : « Emplois du temps », « Salles et équipements », « Remplacements ».
- **Présences** : « Suivi des appels », « Justificatifs d'absence », « Présence du personnel ».
- **Évaluations** : « Feuilles à relire », « Corrections de notes », « Types d'évaluation ».
- **Résultats** : « Résultats de classe », « Délibérations ».
- **Bulletins** : « Bulletins — émission », « Bulletins — liste », « Modèles de documents ». Pas de « Identité et signataires ».
- **Conseils de classe** (secondaire) : « Conseils de classe », « Effets des décisions », « Orientation », « Paramètres des conseils ». **Vie scolaire** (secondaire) : « Vie scolaire » seulement (pas « Mesures à valider », « Convocations », « Paramètres de vie scolaire »).
- **Examens** : « Examens », « Candidats aux examens », « Résultats d'examen », « Statistiques d'examen », « Corrections d'examen » (pas « Centres et salles », « Examens blancs », « Exports d'examen »).
- **Pack Primaire** (primaire) : « Pack Primaire », « Conseil des maîtres », « Bilans annuels », « Archives d'année », « États du primaire ».
- **Enseignement supérieur** (supérieur) : « Diplômes », « Documents officiels », « Rattrapages », « Prérequis » (pas « Signataires »).
- **Affectés de l'État** (secondaire) : « Élèves affectés », « Créances sur l'État », « États des affectations » (lecture seule).
- **Documents** : « Documents », « Documents à échéance ». **Communication** : « Messages », « Annonces ». **Notifications** : « Journal des notifications », « Canaux d'envoi ». **Imports** : « Imports Excel / CSV ». **Règles de calcul** : « Règles de calcul ».
- Pas de Finance, ni de Paie, ni d'Accès et rôles, ni d'Établissement, ni de Journal d'audit.

**Ce qu'il peut faire de plus important.**

- Construire la structure académique : années, périodes (les clôturer), programmes, classes, curriculum (le publier), paramètres.
- Superviser les évaluations : relire, valider et publier les notes, approuver une correction de note publiée (l'enseignant la demande).
- Calculer et délibérer les résultats, verrouiller et clôturer une période (la réouverture reste à la direction).
- Émettre et publier les bulletins, gérer les modèles de documents.
- Tenir les conseils de classe : ouvrir la séance, enregistrer les décisions humaines, générer et signer le procès-verbal (secondaire).
- Concevoir et publier les emplois du temps, valider les séances pour la paie, superviser les appels et décider des justificatifs d'absence et des congés du personnel.
- Préparer les bilans et l'archive d'année (primaire), octroyer et émettre diplômes et attestations (supérieur), préparer les imports de classes et de curriculum.

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Ouvrir `/v2/finance` (ou `/v2/finance/invoices`). Attendu : page « Accès refusé ».
- Ouvrir `/v2/payroll/history`. Attendu : page « Accès refusé ».
- Ouvrir `/v2/schoollife/validations` (validation des mesures). Attendu : page « Accès refusé » (il peut seulement lire la vie scolaire).
- Ouvrir `/v2/reportcards/identity` (identité et signataires des bulletins). Attendu : page « Accès refusé ».
- Ouvrir `/v2/access/roles` ou `/v2/audit`. Attendu : page « Accès refusé ».
- Saisir une note : sur une feuille de notes, aucun bouton de saisie ne doit lui être proposé (il valide, il ne saisit pas). (à confirmer à l'écran)
- Rouvrir une période close ou approuver une surcharge de résultat : ces actions doivent être absentes (réservées à la direction). (à confirmer à l'écran)

### Responsable pédagogique

**Ce qu'il voit dans le menu.** Un menu court, centré sur le contrôle des notes.

- **Académique** : « Années et périodes », « Programmes et niveaux », « Curriculum », « Classes », « Inscriptions » (lecture ; il peut éditer le curriculum).
- **Personnes** : « Élèves », « Personnel », « Affectations ».
- **Emploi du temps** : « Emplois du temps ». **Présences** : « Suivi des appels ».
- **Évaluations** : « Feuilles à relire », « Types d'évaluation » (pas « Corrections de notes »).
- **Résultats** : « Résultats de classe » (pas « Délibérations »). **Bulletins** : « Bulletins — liste » (lecture).
- **Règles de calcul** : « Règles de calcul ». **Documents** : « Documents », « Documents à échéance ». **Communication** : « Messages », « Annonces ».
- Pas de Finance, Paie, Examens, Admissions, Notifications, Imports, Accès et rôles, Établissement, Audit.

Note sur le défaut connu : le balayage de qualité a relevé, sur les écrans d'évaluation ouverts par ce rôle, un appel refusé « fonctionnalité non incluse » (offres de cours, qui ne concerne que le pack supérieur). Cela peut laisser une liste de cours vide sur la feuille de notes dans les établissements autres que le supérieur. (à confirmer)

**Ce qu'il peut faire de plus important.**

- Relire les feuilles de notes soumises par les enseignants (« Feuilles à relire », adresse `/v2/assessments?status=SUBMITTED`).
- Valider une feuille relue (étape entre la saisie de l'enseignant et la publication par la direction des études).
- Consulter les résultats, leur explication et les bulletins.
- Éditer le curriculum (la publication revient à la direction des études).
- Consulter les emplois du temps, les affectations d'enseignement, les présences et les élèves pour contrôler la cohérence.

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Créer une évaluation : ouvrir `/v2/assessments/new`. Attendu : page « Accès refusé ».
- Publier les notes : aucun bouton de publication ne doit apparaître sur une feuille validée (réservé à la direction des études et à la direction). (à confirmer à l'écran)
- Ouvrir `/v2/reportcards/issue` (émission de bulletins). Attendu : page « Accès refusé ».
- Ouvrir `/v2/finance` ou `/v2/payroll/history`. Attendu : page « Accès refusé ».
- Créer un élève ou un membre du personnel : `/v2/students/new` et `/v2/staff/new`. Attendu : page « Accès refusé ».

### Secrétariat

**Ce qu'il voit dans le menu.**

- **Admissions** : « Admissions », « Candidatures », « Prospects », « Listes d'attente », « Recrutement : tableaux de bord » (pas « Campagnes d'admission », « Parcours d'admission », « Paramètres des admissions »).
- **Académique** : « Années et périodes », « Programmes et niveaux », « Curriculum », « Classes », « Inscriptions ».
- **Personnes** : « Élèves », « Parents et tuteurs » (pas « Personnel »).
- **Emploi du temps** : « Emplois du temps ». **Présences** : « Suivi des appels », « Justificatifs d'absence ».
- **Bulletins** : « Bulletins — émission », « Bulletins — liste ».
- **Conseils de classe** (secondaire) : « Conseils de classe ». **Affectés de l'État** (secondaire) : « Élèves affectés », « Créances sur l'État », « États des affectations ».
- **Pack Primaire** (primaire) : « Pack Primaire », « Bilans annuels », « États du primaire » (lecture). **Enseignement supérieur** (supérieur) : « Documents officiels ».
- **Finance** (lecture) : « Facturation », « Encaissements », « Paiements en ligne », « Paiements à rapprocher ». Pas de « Caisse », « Frais et barèmes », « Tableau de bord financier ».
- **Documents** : « Documents », « Documents à échéance ». **Communication** : « Messages », « Annonces ». **Notifications** : « Journal des notifications », « Canaux d'envoi ». **Imports** : « Imports Excel / CSV ».

**Ce qu'il peut faire de plus important.**

- Créer et modifier les dossiers d'élèves et de tuteurs, changer le statut d'un dossier (retrait, transfert), exporter des listes (action sensible, audité).
- Créer et annuler des inscriptions (un secrétariat n'accorde pas de dérogation d'éligibilité).
- Traiter une candidature de bout en bout (pièces, entretiens, offres, doublons, liste d'attente) et la passer à l'inscription, sans jamais décider.
- Émettre les bulletins et relevés (sans les publier ni les révoquer).
- Faire l'appel, déposer les justificatifs d'absence (sans décider), consulter les rapports.
- Enregistrer les dossiers d'élèves affectés par l'État (sans vérifier ni activer) ; importer des élèves et des tuteurs (`/v2/imports`) ; planifier les conseils et signer les procès-verbaux (secondaire).

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Encaisser un paiement : ouvrir `/v2/finance/payments/new`. Attendu : page « Accès refusé » (il consulte la finance, il n'encaisse pas).
- Ouvrir la caisse : `/v2/finance/cash`. Attendu : page « Accès refusé ».
- Créer un membre du personnel : `/v2/staff/new`. Attendu : page « Accès refusé ».
- Décider d'une admission ou ouvrir les réglages : `/v2/admissions/settings` et `/v2/admissions/settings/workflow`. Attendu : page « Accès refusé ».
- Ouvrir `/v2/payroll/history`, `/v2/examinations` ou (dans `demo-secondaire`) `/v2/schoollife`. Attendu : page « Accès refusé ».
- Publier un bulletin ou décider d'un justificatif d'absence : ces boutons doivent être absents. (à confirmer à l'écran)

### Économe

**Ce qu'il voit dans le menu.**

- **Pilotage** : « Scolarité », « Trésorerie », « Alertes de direction », « Règles d'alerte » (jamais « Masse salariale » de Pilotage ni « Charges et résultat »).
- **Académique** : « Années et périodes », « Programmes et niveaux », « Classes », « Inscriptions » (lecture). **Personnes** : « Élèves », « Parents et tuteurs », « Personnel ».
- **Finance** : « Facturation », « Encaissements », « Caisse », « Frais et barèmes », « Tableau de bord financier », « Paiements en ligne », « Paiements à rapprocher », « Webhooks en échec », « Élèves affectés par l'État » (secondaire). Pas de « Fournisseurs de paiement ».
- **Paie** : « Bulletins de paie », « Configuration de la paie », « Historique des paiements », « Rapports de paie », « Masse salariale ».
- **Affectés de l'État** (secondaire) : « Élèves affectés », « Rapprochement des affectations », « Créances sur l'État », « États des affectations » (pas « Vérification des affectations »).
- **Documents** : « Documents », « Documents à échéance ». **Communication** : « Messages », « Annonces ». **Notifications** : « Journal des notifications », « Canaux d'envoi ». **Imports** : « Imports Excel / CSV » (préparation seulement).

**Ce qu'il peut faire de plus important.**

- Définir les frais et barèmes, créer les factures, les annuler.
- Enregistrer les encaissements, ouvrir et fermer la caisse, produire les reçus.
- Demander et exécuter un remboursement (l'approbation exige une seconde personne : règle des quatre yeux).
- Changer le financement d'une inscription (bourse, affectation par l'État).
- Préparer la paie : configurations, tarifs, périodes, calcul, primes et retenues, notification, constat du versement.
- Rapprocher les paiements en ligne, consulter les paiements en échec (sans les rejouer), suivre les créances sur l'État (secondaire).

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Créer un élève : `/v2/students/new`. Attendu : page « Accès refusé ». Créer une inscription : `/v2/enrollments/new`. Attendu : page « Accès refusé ».
- Ouvrir `/v2/assessments` (notes) ou `/v2/examinations`. Attendu : page « Accès refusé ».
- Ouvrir `/v2/payroll/configuration/settings` (réglages de paie). Attendu : page « Accès refusé ».
- Arrêter (approuver) un bulletin de paie qu'il a lui-même calculé : cette action est séparée et réservée à la direction ; elle doit être absente de son écran « Bulletins de paie ». (à confirmer à l'écran)
- Rejouer un paiement en échec : l'écran « Webhooks en échec » est en lecture seule pour lui (le rejeu est réservé à la direction). (à confirmer à l'écran)
- Ouvrir `/v2/finance/providers` (fournisseurs de paiement). Attendu : page « Accès refusé ».

### Enseignant

Compte `enseignant@demo-secondaire.test` ou `enseignant@demo-superieur.test` (aussi `enseignant2@` et `enseignant3@`). Au primaire, le compte `enseignant@demo-primaire.test` n'est pas un enseignant mais un instituteur (voir plus bas).

**Ce qu'il voit dans le menu.** Le portail enseignant (menu fixe, libellé « Espace enseignant ») :

« Aujourd'hui », « Mes classes », « Mes évaluations », « Mes appels », « Mon emploi du temps », « Mes bulletins de paie », « Mes congés et ma présence », « Messages », « Annonces », « Mon profil », et, selon le pack : « Saisie vie scolaire » et « Conseils de classe » (secondaire seulement).

Entrées conditionnées par l'abonnement : « Saisie vie scolaire » (fonctionnalité vie scolaire, secondaire), « Conseils de classe » (conseils de classe, secondaire), « Mes congés et ma présence » (présence du personnel). Il n'a jamais « Ma classe (primaire) » ni « Conseil des maîtres ».

Défaut connu à signaler comme tel : le balayage de qualité a observé le menu enseignant réduit à 10 entrées, parce que la liste des fonctionnalités de l'abonnement n'était pas lue pour ce rôle (appel refusé) et que les entrées conditionnées étaient alors masquées par prudence. Le code actuel lit une liste de fonctionnalités accessible à tout membre ; si « Saisie vie scolaire », « Conseils de classe » ou « Mes congés et ma présence » manquent dans `demo-secondaire`, le noter comme défaut connu et non comme erreur du testeur. (à confirmer)

**Ce qu'il peut faire de plus important.**

- Faire l'appel de ses classes (écran « Mes appels »).
- Créer des évaluations pour ses classes, saisir les notes, soumettre la feuille ; demander la correction d'une note publiée (sans l'approuver).
- Rédiger les appréciations de matière.
- Voir l'emploi du temps personnel et déclarer une séance ponctuelle.
- Consulter la fiche des élèves de ses classes seulement (fiche réduite).
- Lire les conseils de classe de ses classes et y proposer appréciations et décisions (sans décider) ; signaler un incident et noter la vie scolaire de ses classes (secondaire).
- Gérer ses propres données : profil, présence, demandes de congé, bulletins de paie (et les contester).

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Ouvrir `/v2/finance` ou `/v2/payroll/history` (paie de tout le personnel). Attendu : page « Accès refusé ».
- Ouvrir `/v2/academic/years` (structure académique) ou `/v2/results/matrix` (résultats de toutes les classes). Attendu : page « Accès refusé ».
- Ouvrir `/v2/students/new`. Attendu : page « Accès refusé ». Dans `/v2/students`, il ne voit que les élèves de SES classes.
- Ouvrir la fiche d'un élève d'une autre classe : `/v2/students/<identifiant>`. Attendu : la page répond comme si l'élément n'existait pas (page introuvable ou message « Ressource introuvable »). (à confirmer)
- Valider ou publier des notes : aucun bouton « Valider » ni « Publier » sur ses feuilles ; il ne peut que soumettre et demander une correction.
- Valider une sanction : ouvrir `/v2/schoollife/validations`. Attendu : page « Accès refusé ».

### Instituteur (titulaire du CP1 A, primaire)

Compte `enseignant@demo-primaire.test` (rôle Instituteur, titulaire unique de la classe CP1 A, avec ses élèves Nadia et Salimata DIABATE, etc.).

**Ce qu'il voit dans le menu.** Le portail enseignant, avec les entrées du primaire :

« Aujourd'hui », « Mes classes », « Mes évaluations », « Mes appels », « Mon emploi du temps », « Ma classe (primaire) », « Conseil des maîtres », « Mes bulletins de paie », « Mes congés et ma présence », « Messages », « Annonces », « Mon profil ». Il n'a ni « Saisie vie scolaire » ni « Conseils de classe » (ni droit, ni pack).

Entrées conditionnées par l'abonnement : « Ma classe (primaire) » (évaluation par compétences), « Conseil des maîtres » (conseil des maîtres), « Mes congés et ma présence » (présence du personnel). Même défaut connu que pour l'enseignant (menu réduit si la liste des fonctionnalités n'est pas lue). (à confirmer)

**Ce qu'il peut faire de plus important.**

- Faire l'appel journalier de sa classe.
- Saisir les compétences de ses élèves en grille, puis les valider ; une compétence « non évaluée » reste non évaluée (jamais zéro).
- Saisir des évaluations chiffrées et les notes de sa classe ; rédiger les appréciations, utiliser la banque d'appréciations.
- Préparer le conseil des maîtres (il propose, il ne décide pas) et lire le bilan annuel de sa classe.
- Lire les bulletins de sa classe ; gérer ses données de personnel et ses bulletins de paie.

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Ouvrir `/v2/primary/direction` (vue de direction du pack). Attendu : page « Accès refusé ».
- Ouvrir `/v2/primary/parametres` (réglages du pack). Attendu : page « Accès refusé ».
- Ouvrir `/v2/schoollife/saisie` ou `/v2/councils`. Attendu : page « Accès refusé ».
- Sceller ou réémettre un bilan annuel, réviser une compétence déjà validée, clôturer une période : ces actions sont réservées à la direction ; aucun bouton correspondant ne doit lui être proposé sur « Bilans annuels » (lecture seule pour lui). (à confirmer à l'écran)
- Ouvrir `/v2/finance`. Attendu : page « Accès refusé ».

### Instituteur de la maternelle (Grande Section A, primaire)

Compte `instituteur.maternelle@demo-primaire.test`. Il a le même rôle Instituteur et donc les mêmes menus, droits et interdits que le titulaire du CP1 A (fiche précédente), mais sur la classe **Grande Section A** (maternelle) : appel journalier, compétences sans note, conseil des maîtres, bilans annuels de ses 5 enfants (dont 3 scellés par la direction).

**Tests négatifs supplémentaires.**

- Ouvrir, par adresse, la classe du CP1 A dans « Mes classes » : seule la Grande Section A doit apparaître. Les élèves du CP1 A ne sont pas dans ses listes. (à confirmer)
- Modifier un bilan annuel déjà scellé : l'écran ne doit proposer aucune modification (le sceau est irréversible et réservé à la direction).

### Éducateur

**Ce qu'il voit dans le menu.**

- **Personnes** : « Élèves », « Parents et tuteurs ». **Académique** : « Classes », « Inscriptions » (lecture).
- **Emploi du temps** : « Emplois du temps » (lecture). **Présences** : « Suivi des appels », « Justificatifs d'absence ».
- **Vie scolaire** (secondaire) : « Vie scolaire », « Convocations ». Pas de « Mesures à valider » ni de « Paramètres de vie scolaire ».
- **Documents** : « Documents », « Documents à échéance ». **Communication** : « Messages », « Annonces ». **Notifications** : « Mes notifications ».

Dans `demo-primaire` et `demo-superieur`, le module Vie scolaire n'existe pas : son menu est plus court.

**Ce qu'il peut faire de plus important.**

- Faire l'appel, valider les appels, suivre les absences et retards, déposer et lire les justificatifs d'absence, voir les rapports de présence.
- Constater qu'une séance a bien eu lieu (la direction des études la valide ensuite pour la paie).
- Déclarer et instruire des incidents, noter des observations, **proposer** une mesure, convoquer les tuteurs (secondaire).
- Consulter les élèves, les tuteurs, les classes et les inscriptions.
- Gérer ses propres données de personnel (fiche, présence, congés).

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Valider une sanction ou une exclusion : ouvrir `/v2/schoollife/validations`. Attendu : page « Accès refusé ». L'éducateur propose, il ne valide pas.
- Décider d'un justificatif d'absence (l'accepter ou le refuser) : le bouton de décision doit être absent. (à confirmer à l'écran)
- Ouvrir `/v2/assessments` (notes). Attendu : page « Accès refusé ».
- Ouvrir `/v2/finance` ou `/v2/payroll/history`. Attendu : page « Accès refusé ».
- Rouvrir un appel déjà validé : ce droit est réservé à la direction. (à confirmer à l'écran)

### Responsable des examens

**Ce qu'il voit dans le menu.**

- **Examens** : « Examens », « Candidats aux examens », « Centres et salles », « Examens blancs », « Résultats d'examen », « Statistiques d'examen », « Exports d'examen », « Corrections d'examen ».
- **Académique** : « Années et périodes », « Programmes et niveaux », « Classes », « Inscriptions » (lecture). **Personnes** : « Élèves ».
- **Documents** : « Documents », « Documents à échéance ». **Communication** : « Messages », « Annonces ». **Notifications** : « Journal des notifications ».

Entrées conditionnées par l'abonnement : « Examens blancs » (examens blancs), « Exports d'examen » (exports d'examen) ; le reste du module relève de la fonctionnalité « Examens nationaux ».

**Ce qu'il peut faire de plus important.**

- Paramétrer les types d'examen et les centres, créer et gérer les sessions.
- Gérer les candidats (y compris ceux issus d'une classe), évaluer leur éligibilité par la règle.
- Saisir les notes d'épreuves et les résultats d'examen ; conduire les examens blancs (calculés par la règle de démonstration, aucun document officiel pour un blanc).
- Importer et exporter les fichiers de l'autorité, émettre les convocations et attestations.
- Consulter les statistiques d'examen.

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Publier les résultats d'une session, accorder une dérogation d'éligibilité ou approuver la révision d'une note publiée : ces actes sont réservés à la direction ; les boutons correspondants doivent être absents. (à confirmer à l'écran)
- Ouvrir `/v2/finance`. Attendu : page « Accès refusé ».
- Créer un élève : `/v2/students/new`. Attendu : page « Accès refusé ».
- Ouvrir `/v2/admissions/settings` ou `/v2/schoollife` (dans `demo-secondaire`). Attendu : page « Accès refusé ».
- Saisir des notes de classe : ouvrir `/v2/assessments/new`. Attendu : page « Accès refusé ».

### Chargé d'admissions

**Ce qu'il voit dans le menu.**

- **Pilotage** : « Admissions » (entonnoir d'admission en chiffres agrégés).
- **Admissions** : « Admissions », « Candidatures », « Prospects », « Listes d'attente », « Recrutement : tableaux de bord ». Pas de « Campagnes d'admission », « Parcours d'admission », « Paramètres des admissions ».
- **Communication** : « Messages », « Annonces ».

Entrées conditionnées par l'abonnement : « Listes d'attente » (fonctionnalité liste d'attente). Le formulaire public de candidature (`/v2/apply/<établissement>`) n'est pas dans son menu.

**Ce qu'il peut faire de plus important.**

- Saisir ou modifier une candidature (`/v2/admissions/applications/new`).
- Téléverser et contrôler les pièces d'un dossier ; planifier les entretiens ; émettre des offres.
- Résoudre les doublons, gérer la liste d'attente et les prospects.
- Passer un dossier accepté à l'inscription.
- Consulter les rapports et l'entonnoir de recrutement.

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Décider d'une candidature (accepter, refuser) ou dépasser une capacité : ces boutons doivent être absents (décision réservée à la direction). (à confirmer à l'écran)
- Ouvrir `/v2/admissions/settings` ou `/v2/admissions/settings/workflow`. Attendu : page « Accès refusé ».
- Ouvrir `/v2/students` (liste des élèves). Attendu : page « Accès refusé » (le dossier de l'élève naît à l'acceptation de l'offre).
- Ouvrir `/v2/finance`. Attendu : page « Accès refusé ».
- Exporter ou anonymiser un dossier d'admission : actions absentes (direction seulement). (à confirmer à l'écran)

### Parent

Compte `parent@<établissement>.test` : Séka DIABATE, tuteur de Nadia et Salimata DIABATE.

**Ce qu'il voit dans le menu.** Le portail parent (« Espace parent ») :

« Mes enfants », « Messages », « Annonces », « Paramètres du compte », et, selon le pack : « Bulletin et compétences (primaire) » (primaire), « Vie scolaire » (secondaire), « Décisions du conseil » (secondaire), « Affectation de mon enfant » (secondaire), « Examens de mes enfants » (examens).

En ouvrant un enfant (`/v2/parent/children/<identifiant>`), des onglets : « Tableau de bord », « Résultats », « Bulletins », « Absences », « Emploi du temps », « Évaluations à venir », « Scolarité », « Documents », « Dossier et contacts ».

Entrées conditionnées par l'abonnement : celles marquées par pack ci-dessus. **Défaut connu (balayage de qualité)** : le menu parent n'avait que 5 liens, parce que la liste des fonctionnalités n'était pas lue pour ce rôle (appel refusé) et que les entrées conditionnées étaient masquées par prudence ; les entrées « Vie scolaire », « Décisions du conseil », « Affectation de mon enfant », « Bulletin et compétences (primaire) » et « Examens de mes enfants » peuvent donc manquer. Le nom de l'établissement peut aussi s'afficher « EcoleDigitale » au lieu du nom de l'école. Le code actuel lit une liste de fonctionnalités ouverte à tout membre ; à reconfirmer après redémarrage. (à confirmer)

**Ce qu'il peut faire de plus important.**

- Suivre ses enfants : résultats, bulletins, absences, emploi du temps, évaluations à venir.
- Justifier une absence de son enfant.
- Consulter la situation financière (« Scolarité ») et payer en ligne (paiement de démonstration SANDBOX).
- Mettre à jour les coordonnées de contact de son enfant (« Dossier et contacts »).
- Lire les décisions du conseil, la vie scolaire partageable, faire un recours et accuser réception d'une convocation (secondaire) ; lire le bilan annuel et les compétences (primaire).
- Échanger par messages et lire les annonces.

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Ouvrir la fiche d'un enfant qui n'est pas le sien : `/v2/parent/children/<identifiant d'un élève d'une autre famille>`. Attendu : le message « Cet enfant n'est pas rattaché à votre compte (ou le lien a pris fin). Aucune information ne peut être affichée. », sans aucune donnée.
- Ouvrir `/v2/students` (liste des élèves de l'école). Attendu : page « Accès refusé ».
- Ouvrir `/v2/finance` (finance de gestion). Attendu : page « Accès refusé » (il n'a accès qu'à `/v2/finance/me` pour ses enfants).
- Ouvrir `/v2/assessments`, `/v2/teacher` ou `/v2/student`. Attendu : page « Accès refusé ».
- Saisir une note, modifier un bulletin, voir les notes d'autres élèves : aucune de ces actions n'existe dans son portail.

### Élève

Compte `eleve@<établissement>.test` : Nadia DIABATE.

**Ce qu'il voit dans le menu.** Le portail élève (« Espace élève ») :

« Mon dossier », « Mes résultats », « Mes bulletins », « Mon emploi du temps », « Évaluations à venir », « Mes absences », « Ma scolarité », « Mes documents », « Messages », « Annonces », « Mon profil », et, selon le pack : « Mon parcours (primaire) » (primaire), « Ma vie scolaire » (secondaire), « Décisions du conseil » (secondaire), « Mon examen » (examens).

Même défaut connu que pour le parent : les entrées conditionnées par l'abonnement peuvent manquer si la liste des fonctionnalités n'est pas lue. (à confirmer)

**Ce qu'il peut faire de plus important.**

- Consulter son dossier, ses résultats, ses bulletins, son emploi du temps, ses évaluations à venir, ses absences.
- Justifier une de ses absences.
- Consulter sa scolarité et payer en ligne (paiement de démonstration SANDBOX).
- Consulter ses documents ; modifier certaines informations de son profil.
- S'inscrire à des cours : seulement dans le supérieur (inscription à la carte).
- Faire un recours sur une mesure de vie scolaire (secondaire).

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Ouvrir `/v2/parent` (portail des parents). Attendu : page « Accès refusé ».
- Ouvrir `/v2/students` ou `/v2/finance`. Attendu : page « Accès refusé ».
- Ouvrir `/v2/assessments` ou `/v2/teacher`. Attendu : page « Accès refusé ».
- Ouvrir le reçu d'un autre élève : `/v2/student/finance/receipts/<identifiant d'un reçu d'un autre élève>`. Attendu : page introuvable (la page répond comme si le reçu n'existait pas).
- Modifier une note ou voir les notes des camarades : aucune de ces actions n'existe dans son portail.

### Opérateur de la plateforme

Console séparée : `http://localhost:3100/v2/platform/login`, avec le compte `plateforme@demo.test` (mot de passe dans le fichier des comptes de démonstration). Le menu de la console a trois entrées : « Organisations », « Plans et catalogue », « Journal de plateforme ».

**Ce qu'il peut faire de plus important.**

- Lister les organisations (établissements), en créer une (`/v2/platform/tenants/new`), ouvrir sa fiche (`/v2/platform/tenants/<identifiant>`).
- Gérer l'abonnement d'une organisation (plan, packs, statut) et activer ou désactiver des fonctionnalités par organisation.
- Consulter le catalogue des plans et des fonctionnalités (« Plans et catalogue »).
- Consulter le journal de la plateforme.
- Se faire passer, de façon tracée, pour un établissement (fonction d'« impersonation », présente dans la console selon le guide de démonstration). (à confirmer à l'écran)

**Tests négatifs : ce qu'il NE doit PAS pouvoir faire.**

- Voir les données internes d'un établissement (élèves, notes, factures) sans passer par la fonction prévue : la console n'a aucune entrée de gestion d'établissement (pas de « Élèves », « Finance », etc.).
- Se connecter à la console avec un compte d'établissement (par exemple `direction.generale@demo-secondaire.test`). Attendu : refus de connexion à la console.
- Ouvrir une page d'établissement (ex. `http://localhost:3100/v2/students`) sans être connecté à cet établissement. Attendu : renvoi vers la page de connexion. (à confirmer)

---

## Rôles : matrice module par rôle

Légende : **oui** = peut agir (créer, modifier, valider selon son rôle) ; **lecture** = consulte sans modifier ; **non** = aucun accès (le module n'apparaît pas dans son menu, la page directe donne « Accès refusé ») ; **propre** = ne voit que ses données (parent : ses enfants ; élève : lui-même ; enseignant et éducateur : ses données de personnel ou ses classes). Entre parenthèses : la limite principale. Cette matrice vient des droits des modèles de rôles. Les cellules « oui » du propriétaire et du directeur incluent les actes sensibles (MFA exigée).

Colonnes : Prop. = Propriétaire ; Dir. = Directeur ; Études = Directeur des études ; Péda. = Responsable pédagogique ; Secr. = Secrétariat ; Écon. = Économe ; Ens. = Enseignant ; Inst. = Instituteur ; Éduc. = Éducateur ; Exam. = Responsable des examens ; Adm. = Chargé d'admissions.

| Module | Prop. | Dir. | Études | Péda. | Secr. | Écon. | Ens. | Inst. | Éduc. | Exam. | Adm. | Parent | Élève |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pilotage (tableaux de bord) | oui | oui | lecture (pédagogie, présences, alertes) | non | non | lecture (scolarité, trésorerie, alertes) | non | non | non | non | lecture (admissions) | non | non |
| Admissions | oui | oui (décide) | non | non | oui (traite, ne décide pas) | non | non | non | non | non | oui (traite, ne décide pas) | non | non |
| Académique (années, classes, curriculum, inscriptions) | oui | oui | oui (sans reconduction) | lecture (édite le curriculum) | oui inscriptions, lecture du reste | lecture (change le financement d'une inscription) | non | non | lecture | lecture | non | propre (inscriptions de ses enfants) | propre (ses inscriptions) |
| Personnes (élèves, tuteurs, personnel) | oui | oui | lecture (affecte les enseignements) | lecture | oui élèves et tuteurs, pas le personnel | lecture | lecture (élèves de ses classes) | lecture (élèves de sa classe) | lecture | lecture (élèves) | non | propre (met à jour les contacts) | propre |
| Emploi du temps | oui | oui | oui | lecture | lecture | non | propre (déclare une séance) | propre | lecture (constate une séance) | non | non | propre | propre |
| Présences | oui | oui | oui (sans réouverture) | lecture | oui saisie et justificatifs (ne décide pas) | non | oui (appel de ses classes) | oui (appel de sa classe) | oui (ne décide pas des justificatifs) | non | non | propre (justifie) | propre (justifie) |
| Évaluations et notes | oui | oui | oui (supervise, valide, publie ; ne saisit pas) | oui relecture et validation (ne saisit pas, ne publie pas) | non | non | oui (saisit, demande une correction) | oui | non | lecture (évaluations) | non | propre | propre |
| Résultats et périodes | oui | oui | oui (calcule, verrouille, clôture) | lecture | non | non | non | non | non | non | non | propre | propre |
| Bulletins | oui | oui (révoque) | oui (émet, publie ; ne révoque pas) | lecture | oui émission (ni publication ni révocation) | non | non | lecture (sa classe) | non | non | non | propre | propre |
| Conseils de classe (secondaire) | oui | oui | oui (tient la séance) | non | oui (planifie, signe le procès-verbal) | non | lecture et propositions (ses classes) | non | non | non | non | propre | propre |
| Vie scolaire (secondaire) | oui | oui (valide les sanctions) | lecture | non | non | non | oui signale et note (ses classes) | non | oui propose, ne valide pas | non | non | propre (recours, accusé de convocation) | propre (recours) |
| Examens | oui | oui (publie, déroge) | lecture | non | non | non | non | non | non | oui (prépare, ne publie pas) | non | propre (documents d'examen) | propre |
| Pack Primaire (primaire) | oui | oui (scelle les bilans) | oui (référentiels, préparation, sans scellé) | non | lecture | non | non | oui (saisit et valide les compétences, sans scellé) | non | non | non | propre | propre |
| Enseignement supérieur (supérieur) | oui | oui (force, révoque) | oui (sans forcer ni révoquer) | non | oui attestations | non | non | non | non | non | non | propre | propre |
| Affectés de l'État (secondaire) | oui | oui (vérifie, active) | lecture | non | oui enregistre (ne vérifie pas) | oui rapprochement, créances, contrôles | non | non | non | non | non | propre | non |
| Finance | oui | oui | non | non | lecture | oui | non | non | non | non | non | propre (consulte et paie) | propre (consulte et paie) |
| Paie | oui (seuil propriétaire) | oui (arrête, verse, annule) | non | non | non | oui (prépare, calcule, verse ; n'arrête pas) | propre (ses bulletins) | propre | non | non | non | non | non |
| Documents | oui | oui (confidentiels) | oui | lecture | oui | oui (sans archivage ni partage) | lecture et propres | non | lecture et propres | lecture | non | propre | propre |
| Communication (messages, annonces) | oui (modère) | oui (modère) | oui | oui | oui | messages | oui (annonces de classe) | oui (annonces de classe) | oui (annonces de classe) | messages | messages | propre | propre |
| Notifications | oui | oui | oui | non | oui | lecture | propres | non | propres | lecture | non | propres | propres |
| Imports Excel / CSV | oui | oui | oui (classes, curriculum) | non | oui (élèves, tuteurs) | préparation seulement | non | non | non | non | non | non | non |
| Règles de calcul | oui | oui | lecture et simulation | lecture | non | non | non | non | non | non | non | non | non |
| Utilisateurs, accès et rôles | oui (définit les rôles) | oui (attribue, ne définit pas) | non | non | non | non | non | non | non | non | non | non | non |
| Établissement et abonnement | oui (modifie l'abonnement) | lecture (pas l'abonnement) | non | non | non | non | non | non | non | non | non | non | non |
| Journal d'audit | oui | oui | non | non | non | non | non | non | non | non | non | non | non |

Points de séparation des tâches à vérifier (aucun rôle autre que propriétaire et directeur ne cumule les deux côtés) : saisie de note (enseignant, instituteur) et validation (responsable pédagogique, directeur des études) et publication (directeur des études) ; proposition d'une mesure (éducateur) et validation (direction) ; calcul de la paie (économe) et arrêt du bulletin (direction) ; enregistrement d'un dossier d'affectation (secrétariat) et vérification (direction) ; préparation des examens (responsable des examens) et publication (direction) ; traitement d'une candidature (secrétariat, chargé d'admissions) et décision (direction).

---

## Rôles : cumul de rôles et changement de compte

**Cumuler des rôles.** Une personne peut porter plusieurs rôles. Ses droits sont alors la somme de ceux de ses rôles. Le modèle prévoit le rôle « Personnel » pour cela : un secrétaire, un économe ou un éducateur y ajoute sa propre fiche, sa présence, ses congés et ses bulletins de paie. Dans la démonstration, **chaque compte porte un seul rôle** ; le cumul se teste donc en l'ajoutant à la main.

Comment tester un cumul (en dernier dans la session de test, et sur un seul compte, car une réinitialisation de la démonstration remet tout à zéro) :

1. Se connecter en propriétaire (`direction.generale@demo-secondaire.test`, MFA oui).
2. Ouvrir « Attributions de rôles » (`/v2/access/assignments`) ou « Utilisateurs » (`/v2/admin/members`).
3. Ajouter au compte `secretariat@demo-secondaire.test` le rôle « Personnel ».
4. Se déconnecter, puis se reconnecter avec `secretariat@demo-secondaire.test`.

**Résultat attendu :** deux rôles sont disponibles pour ce compte. Si la connexion propose le choix du rôle, la page « Choisir un rôle » (`/select-role`) s'affiche. (à confirmer à l'écran)

- [ ] Le compte propose bien les deux rôles.
- [ ] Les droits du rôle « Personnel » s'ajoutent à ceux du secrétariat (par exemple « Mes bulletins de paie » devient accessible) sans retirer ceux du secrétariat.

**Changer de rôle.** Dans l'en-tête, le menu « Mon compte » affiche l'identité, le « Rôle actif » et, quand le compte a plusieurs rôles, une rubrique « Changer de rôle » avec un bouton par autre rôle. Un clic ouvre une nouvelle session avec ce rôle, l'application recharge les écrans et atterrit sur la page d'arrivée du nouveau rôle. Le **rôle actif** décide de la coque d'écran : les rôles de gestion (propriétaire, directeur, études, pédagogique, secrétariat, économe, éducateur, examens, admissions) ont le menu de gestion ; parent, élève et enseignant/instituteur ont leur portail ; ce n'est jamais l'adresse tapée qui choisit. Le bouton de changement n'apparaît pas si le compte n'a qu'un rôle.

**Changer d'établissement.** Le même menu propose « Changer d'établissement » seulement si le compte appartient à plusieurs établissements, et la page « Mes établissements » (`/v2/account/tenants`) les liste. Dans la démonstration, un même compte n'existe que dans un établissement (`secretariat@demo-secondaire.test` et `secretariat@demo-primaire.test` sont deux comptes distincts) : la rubrique n'apparaît donc pas. On teste le changement d'établissement en se connectant séparément à chaque adresse `http://<établissement>.localhost:3100/v2/login`.

**Tests négatifs :**

- Un compte à un seul rôle ne doit pas voir la rubrique « Changer de rôle ».
- Après un changement de rôle vers un rôle plus restreint (ex. de « Secrétariat » à « Personnel »), les écrans de gestion (`/v2/students`, `/v2/finance/invoices`) doivent donner « Accès refusé » : les droits des deux rôles ne se cumulent pas dans la session une fois le rôle actif changé. (à confirmer : selon que la session conserve ou non les droits du rôle précédent)

---

## Rôles : problèmes connus et limites

- Quatre entrées de menu n'ont pas d'écran et sont masquées (« Paramètres de présence », « Paramètres des personnes », « Calendrier de l'établissement », « Validation des séances »). La validation des séances pour la paie reste donc sans entrée de menu.
- Le menu des portails parent et enseignant (et, dans une moindre mesure, élève) peut être réduit : la lecture de la liste des fonctionnalités de l'abonnement était refusée à ces rôles lors du dernier balayage, et les entrées conditionnées étaient masquées. Le code actuel prévoit une lecture ouverte à tout membre ; le balayage de qualité attendait une reconfirmation après redémarrage de la démonstration.
- Le nom de l'établissement dans l'en-tête peut s'afficher « EcoleDigitale » pour les rôles qui ne peuvent pas lire le profil de l'établissement (même cause).
- La page « Accès refusé » (`/unauthorized`) s'affiche encore dans l'habillage de l'ancienne application (menu vide, mentions « Settings / Logout » en anglais). C'est un défaut connu, pas une erreur de test.
- Plusieurs écrans appellent des informations que le rôle n'a pas le droit de lire (liste des années pour l'éducateur et l'enseignant, liste des classes pour l'enseignant sur `/v2/assessments`, etc.) : des listes de filtre peuvent apparaître vides ou une erreur discrète peut s'afficher, sans bloquer la page.
- Appel journalier : l'enseignant du secondaire se voit refuser l'appel « journalier » (la politique du collège impose l'appel par séance). Le bouton ne doit plus être proposé ; si une erreur « La politique d'appel de ce cycle n'autorise pas l'appel journalier » apparaît, c'est le défaut connu.
- Les jeux de règles des packs Primaire et Secondaire sont des règles de DÉMONSTRATION (bandeau « règles de démonstration », filigrane « démonstration » sur les documents officiels).
- Le propriétaire n'a pas de profil élève ni de profil personnel : ses écrans « Mon dossier », « Ma présence » ou « Mes bulletins de paie » (s'il les ouvre à la main) restent vides.

## Rôles : écarts spec / application (pour l'équipe)

- Le rôle « Personnel » est décrit dans le modèle de rôles mais n'a aucun compte de démonstration : le cumul se teste à la main.
- Les menus des portails parent, élève et enseignant sont des listes fixes dans le code ; les entrées conditionnées par une fonctionnalité dépendent d'un appel qui échouait pour la plupart des rôles lors du balayage (priorité P1 du rapport). À reconfirmer.
- Libellés de rôle non alignés entre le modèle (« Chargé d'admissions ») et l'écran (« Chargé des admissions ») ; l'instituteur de la maternelle est affiché « Instituteur » alors que la table d'affichage connaît « Institutrice de maternelle ».
- « Validation des séances » (paie) : droit prévu pour le directeur des études, sans écran ni entrée de menu.
- Console plateforme : l'impersonation est annoncée par le guide de démonstration ; son écran exact n'a pas été vérifié dans cette partie. (à confirmer)


# Partie 3. Les chapitres par domaine


## Chapitre 1. Plateforme et administration de l'établissement
> **Durée estimée :** 60 à 90 minutes · **Établissement(s) :** Secondaire (`demo-secondaire`) pour l'essentiel ; Supérieur (`demo-superieur`) pour la comparaison d'abonnement · **Comptes :** propriétaire (MFA oui), directeur (MFA oui), enseignant (MFA non), opérateur de la plateforme

### 1.1 Objectif
Vérifier que la direction peut régler son établissement (nom, marque, établissements et campus, mise en service), consulter son abonnement, gérer les accès (rôles, attributions, membres) et contrôler le journal d'audit. Vérifier aussi que chaque action sensible laisse une trace, qu'une fonctionnalité absente de l'abonnement est refusée avec un message clair, et que la console de la plateforme (réservée aux opérateurs) gère les organisations, les abonnements et les fonctionnalités.
Le tableau des 14 rôles système et de leurs droits est dans la partie 2 de ce guide (« Rôles et comptes de démonstration ») : ce chapitre ne le répète pas.

### 1.2 Avant de commencer
- **Comptes**
  - Propriétaire : `direction.generale@demo-secondaire.test` (MFA oui). C'est le seul rôle qui peut tout faire dans ce chapitre.
  - Directeur : `directeur@demo-secondaire.test` (MFA oui). Il peut presque tout, sauf définir des rôles et modifier l'abonnement (voir les cas négatifs).
  - Enseignant : `enseignant@demo-secondaire.test` (MFA non). Il sert aux tests d'accès refusé.
  - Opérateur de la plateforme : `plateforme@demo.test`, console `http://localhost:3100/v2/platform/login` (pas de double authentification pour l'opérateur).
- **Connexion des établissements :** `http://demo-secondaire.localhost:3100/v2/login` (mot de passe : fichier des comptes de démonstration `.demo/credentials.md` ; code de double authentification : `pnpm demo:totp <e-mail>`, voir l'introduction et le chapitre 2).
- **Menu (coque de gestion, propriétaire et directeur) :** module « Établissement » > « Établissement » (`/v2/settings`) ; module « Accès et rôles » > « Rôles et permissions » (`/v2/access/roles`) et « Attributions de rôles » (`/v2/access/assignments`) ; module « Utilisateurs » > « Utilisateurs » (`/v2/admin/members`) ; module « Journal d'audit » > « Journal d'audit » (`/v2/audit`). La sous-navigation de « Établissement » propose : « Profil et marque », « Établissements et campus », « Mise en service », « Abonnement et usage ».
- **Données de démonstration**
  - Secondaire : « Collège Le Baobab (démonstration) » ; Primaire : « École primaire Les Palmiers (démonstration) » ; Supérieur : « Université Horizon (démonstration) ».
  - Chaque établissement a un abonnement « Professionnel » (statut « Actif ») avec le seul pack de son niveau (Primaire, Secondaire ou Supérieur).
  - Les 14 rôles système existent dans chaque établissement. Aucun rôle personnalisé n'est livré : on en crée un par clonage (scénario C01.6).
  - Le journal d'audit contient déjà les actions de mise en place (rôles attribués, invitations, abonnement).
- **Ordre conseillé :** C01.1 à C01.6 (lecture et petites créations réversibles), puis C01.7 à C01.10, puis la console (C01.12 à C01.14). Les actions de la console qui suspendent ou archivent une organisation ne sont PAS à faire sur les établissements de démonstration (voir C01.13).
- **Délai du journal :** une action n'apparaît dans le journal qu'après un court délai (quelques secondes, parfois jusqu'à une minute) car elle est transmise par une file de traitement. Actualisez la page avant de conclure à une absence.

### 1.3 Scénarios

#### C01.1 Consulter le profil et la marque de l'établissement
**Compte :** propriétaire · **Où :** « Établissement » > « Profil et marque » (`/v2/settings`)
1. Connectez-vous avec le compte propriétaire du Secondaire.
2. Ouvrez le module « Établissement ».
3. Repérez les blocs « Identité » (Raison sociale, Nom commercial, Pays), « Contact » (Personne à contacter, E-mail, Téléphone, Adresse) et « Marque » (Adresse du logo, Couleur principale, Couleur secondaire, Domaine personnalisé), puis l'« Aperçu » avec « Exemple de bouton ».
**Résultat attendu :** la page affiche le profil de « Collège Le Baobab » ; la raison sociale est renseignée ; les boutons « Enregistrer le profil » et « Annuler les modifications » sont présents ; l'en-tête de l'application affiche le nom de l'établissement.
- [ ] Résultat attendu constaté
- [ ] Le nom de l'établissement apparaît dans l'en-tête de l'application
- [ ] Le message « Aucune modification à enregistrer. » s'affiche tant que rien n'est modifié

#### C01.2 Modifier le nom commercial et la couleur (réversible)
**Compte :** propriétaire · **Où :** `/v2/settings`
1. Dans « Nom commercial », saisissez « Collège Le Baobab - Test ».
2. Dans « Couleur principale », saisissez `#1A73E8` (format `#RRGGBB`) ou utilisez le sélecteur de couleur.
3. Observez l'« Aperçu » : l'« Exemple de bouton » prend la couleur choisie.
4. Cliquez sur « Enregistrer le profil ».
5. Rechargez la page, puis rétablissez le nom d'origine (vide : la raison sociale est alors utilisée) et enregistrez à nouveau.
**Résultat attendu :** le message « Profil enregistré. » s'affiche ; après rechargement, les valeurs sont conservées ; l'en-tête de l'application affiche le nom commercial (« Affiché dans l'application ; la raison sociale est utilisée sinon. »).
- [ ] Résultat attendu constaté
- [ ] Le bouton « Annuler les modifications » remet les champs à leur valeur d'origine avant l'enregistrement
- [ ] Après rétablissement, l'ancien nom revient dans l'en-tête
- [ ] Une trace de la modification apparaît dans le journal d'audit, sous une action de type « tenant.* » ou « institution.* » (à confirmer : libellé exact, voir C01.9)

> Ne renseignez pas « Domaine personnalisé » dans la démonstration : ce champ est prévu pour une adresse réelle de l'établissement. Le téléversement d'un logo n'existe pas encore : on saisit seulement un lien https vers une image.

#### C01.3 Établissements et campus
**Compte :** propriétaire · **Où :** « Établissement » > « Établissements et campus » (`/v2/settings/institutions`)
1. Ouvrez la page : la liste « Établissements » montre l'établissement du Secondaire avec son code, son pays, son système éducatif et son pack « Secondaire ».
2. Cliquez sur « Voir les campus de <nom> » : le tableau « Campus de <nom> » apparaît, avec un campus « Par défaut ».
3. Cliquez sur « Nouveau campus », saisissez « Campus test » dans « Nom du campus », puis « Enregistrer ».
4. Cliquez sur « Définir Campus test comme campus par défaut » puis rétablissez l'ancien campus par défaut.
5. Supprimez « Campus test » (« Supprimer le campus Campus test ») et confirmez.
**Résultat attendu :** messages « Campus « Campus test » créé. », « Campus par défaut modifié. », « Campus supprimé. ». Le campus par défaut ne peut pas être supprimé : il faut d'abord en désigner un autre.
- [ ] Résultat attendu constaté
- [ ] Tentative de suppression du campus par défaut : refus avec un message explicite

#### C01.4 Mise en service (lecture seule recommandée)
**Compte :** propriétaire · **Où :** « Établissement » > « Mise en service » (`/v2/settings/onboarding`)
1. Ouvrez la page : barre de « Progression », liste « Étapes de la mise en service » (Compte propriétaire, Établissement, Pays et devise, Type d'établissement, Pack, Année académique, Import des élèves, Classes, Enseignants, Finance, Mise en production).
2. Lisez le statut de chaque étape (« À faire », « Terminée », « Ignorée ») et la « Prochaine étape ».
**Résultat attendu :** la progression et les statuts sont cohérents avec l'état de la démonstration (année, classes et élèves déjà créés).
- [ ] Résultat attendu constaté
- [ ] Les étapes déjà réalisées par le jeu de démonstration sont marquées « Terminée » (à constater : l'état exact dépend de la graine)

> **Attention : action irréversible.** Le bouton « Passer en production » ouvre la confirmation « Passer en production ? » : « Cette action est définitive ». Ne confirmez pas sur la démonstration, sauf en fin de session sur un seul établissement (`pnpm demo:reset` remet tout à zéro).

#### C01.5 Abonnement et usage
**Compte :** propriétaire · **Où :** « Établissement » > « Abonnement et usage » (`/v2/settings/subscription`)
1. Ouvrez la page. Lisez « Offre », « Statut de l'abonnement », « Packs », « Tranche d'apprenants ».
2. Parcourez « Fonctionnalités actives » : chaque fonctionnalité porte une origine (« Socle », « Offre », « Pack », « Dérogation »).
3. Parcourez « Usage mesuré » (« Apprenants actifs », « Stockage », « SMS envoyés »).
4. Répétez avec le propriétaire du Supérieur (`direction.generale@demo-superieur.test`, `http://demo-superieur.localhost:3100/v2/login`) et comparez la liste des fonctionnalités.
**Résultat attendu :** offre « Professionnel », statut « Actif », un seul pack (« Secondaire » ici, « Supérieur » pour l'autre établissement). La page précise que « les changements d'offre sont gérés par l'équipe EcoleDigitale » : aucun bouton de modification n'existe pour l'établissement. Le Supérieur affiche des fonctionnalités que le Secondaire n'a pas (par exemple l'inscription à la carte, voir C01.11).
- [ ] Résultat attendu constaté
- [ ] Aucun bouton « modifier l'abonnement » n'est proposé côté établissement
- [ ] L'« Usage mesuré » peut être vide : le message « Aucun usage mesuré pour le moment. » est alors affiché (comportement connu)

#### C01.6 Rôles : consulter, cloner, modifier un rôle personnalisé
**Compte :** propriétaire · **Où :** « Accès et rôles » > « Rôles et permissions » (`/v2/access/roles`)
1. Ouvrez la liste « Rôles de l'établissement » : 14 rôles de type « Système (verrouillé) » avec le nombre de permissions et d'attributions.
2. Ouvrez un rôle système (par exemple « Secrétariat ») : le bandeau « Rôle système verrouillé » indique qu'il ne peut être ni modifié ni supprimé.
3. Revenez à la liste et cliquez sur « Cloner » à la ligne « Secrétariat ».
4. Dans « Cloner le rôle », saisissez « Secrétariat - test » dans « Libellé du nouveau rôle » (la « Clé technique » est facultative), puis « Créer le clone ».
5. Ouvrez le nouveau rôle (type « Personnalisé »). Dans la grille « Permissions du rôle », utilisez « Rechercher une permission », décochez une permission (par exemple une permission d'export) et repérez les permissions marquées « Sensible · MFA ».
6. Cliquez sur « Enregistrer les modifications ».
7. Créez aussi un rôle de zéro avec « Nouveau rôle » (`/v2/access/roles/new`) : libellé « Lecteur test », cochez deux permissions de lecture, « Créer le rôle ».
**Résultat attendu :** messages « Rôle « Secrétariat - test » créé. » puis « Rôle enregistré. » ; le résumé des modifications indique le nombre de permissions ajoutées ou retirées ; le rôle apparaît dans la liste avec le type « Personnalisé ».
- [ ] Résultat attendu constaté
- [ ] Les rôles système n'ont aucun bouton de modification ni de suppression
- [ ] Les permissions sensibles portent l'étiquette « Sensible · MFA »
- [ ] Une entrée « role.changed » apparaît dans le journal (C01.9)

> Les écrans de rôles exigent une session avec double authentification : le propriétaire et le directeur de démonstration l'ont. Sinon un bandeau avertit que la gestion des rôles sera refusée.

#### C01.7 Attribuer puis révoquer un rôle
**Compte :** propriétaire · **Où :** « Accès et rôles » > « Attributions de rôles » (`/v2/access/assignments`)
1. Ouvrez la page : le tableau liste les attributions (Utilisateur, Rôle, Périmètre, Validité, Statut).
2. Utilisez « Filtrer par utilisateur » et « Filtrer par rôle » pour retrouver l'attribution du propriétaire : périmètre « Tout l'établissement », statut « Active », validité « Sans limite ».
3. Dans « Nouvelle attribution », choisissez l'utilisateur `educateur@demo-secondaire.test` (liste « Choisir un utilisateur ») et le rôle « Secrétariat - test » (créé en C01.6), périmètre « Tout l'établissement ».
4. Renseignez « Valide jusqu'au » à une date proche, puis « Attribuer le rôle ».
5. Modifiez la validité (« Modifier la validité de l'attribution… ») pour retirer la limite, puis révoquez l'attribution (« Révoquer l'attribution… », confirmation « Révoquer »).
**Résultat attendu :** messages « Rôle attribué. », « Validité mise à jour. », « Attribution révoquée. » ; l'attribution apparaît d'abord avec le statut « Active » (ou « À venir » si la date de début est future) ; une validité dépassée donne le statut « Expirée ». Si la liste des utilisateurs n'est pas proposée, l'écran demande l'identifiant de l'utilisateur (« Identifiant de l'utilisateur », UUID).
- [ ] Résultat attendu constaté
- [ ] Une entrée « assignment.changed » existe pour l'attribution et pour la révocation
- [ ] Se connecter en éducateur pendant l'attribution montre des menus supplémentaires, qui disparaissent après la révocation (à constater)

#### C01.8 Membres : inviter, suspendre, rétablir
**Compte :** propriétaire · **Où :** module « Utilisateurs » > « Utilisateurs » (`/v2/admin/members`, titre « Membres de l'établissement »)
1. Dans « Adresse e-mail à inviter », saisissez `invite.test@demo-secondaire.test`, choisissez le rôle « Enseignant » (les choix proposés : « Enseignant », « Élève / étudiant », « Parent », « Administrateur »), puis « Inviter ».
2. Lisez le message : « Invitation envoyée. La personne définit son mot de passe depuis le lien reçu par e-mail. » (ou, si les droits n'ont pu être attribués automatiquement, « Invitation envoyée, mais les droits n'ont pas pu être attribués automatiquement… »).
3. Le nouveau membre apparaît avec le statut « Invité ». Le lien d'activation se trouve dans la boîte aux lettres locale (voir le chapitre 2, scénario C02.12).
4. Une fois le compte activé : cliquez sur « Suspendre » (statut « Suspendu »), puis « Rétablir » (statut « Actif »).
5. Cliquez sur « Révoquer les sessions » : le message indique le nombre de sessions révoquées.
**Résultat attendu :** la liste montre chaque membre avec son e-mail, son statut (« Invité », « Actif », « Suspendu », « Révoqué »), ses rôles et la mention « 2 étapes » s'il a la double authentification. Les boutons « Suspendre », « Rétablir », « Révoquer les sessions » et « Réinitialiser la MFA » (seulement si la double authentification est active) répondent par un message de confirmation.
- [ ] Résultat attendu constaté
- [ ] Une entrée « membership.created » (invitation) puis « membership.changed » (suspension) existe dans le journal
- [ ] Les comptes de démonstration à double authentification affichent « 2 étapes »

#### C01.9 Journal d'audit : lire, filtrer, ouvrir le détail
**Compte :** propriétaire (ou directeur) · **Où :** « Journal d'audit » > « Journal d'audit » (`/v2/audit`)
1. Ouvrez la page : « Historique infalsifiable des actions réalisées dans votre établissement. Lecture seule ».
2. Le tableau « Entrées du journal d'audit » indique Date, Gravité, Action, Entité, Acteur, Changements.
3. Dans « Filtrer le journal », saisissez « Action » = `role.*` puis « Appliquer les filtres » : vous retrouvez le clonage et la modification de C01.6.
4. Filtrez avec « Action » = `assignment.*`, puis `membership.*`, puis `session.*`, puis `login.*`.
5. Choisissez une « Gravité » (« Information », « Notable », « Avertissement », « Critique »), puis « Réinitialiser ».
6. Cliquez sur « Voir le détail » d'une entrée de rôle : « Informations générales » (survenue le, enregistrée le, numéro de séquence, action, entité, acteur, motif), « Requête » (adresse IP, navigateur), « Empreinte » et le tableau « Changements champ par champ » (« Avant » / « Après »).
**Résultat attendu :** chaque action faite dans ce chapitre est retrouvée avec le bon acteur (le compte utilisé), la bonne date et, pour les modifications, le champ avant/après. Les rôles et attributions sont de gravité « Avertissement ». Aucune entrée n'est modifiable ni supprimable (aucun bouton prévu).
- [ ] Résultat attendu constaté
- [ ] `role.changed`, `assignment.changed`, `membership.created`, `membership.changed` retrouvés après C01.6 à C01.8
- [ ] Le bouton « Charger plus d'entrées » charge la suite de la liste
- [ ] Les valeurs sensibles sont affichées « Valeur masquée » dans le détail

#### C01.10 Preuve d'intégrité et export du journal
**Compte :** propriétaire ou directeur (MFA oui) · **Où :** `/v2/audit`
1. Dans le bloc « Intégrité de la chaîne », « Portée de la vérification » = « Toute la chaîne », puis « Vérifier la chaîne ».
2. Lisez le résultat : « Chaîne intègre » avec le nombre d'entrées vérifiées et les numéros de séquence (« Aucune anomalie. »).
3. Renseignez « Du » et « Au » sur une période de quelques jours, cliquez sur « Exporter en CSV » (en haut de la page).
4. Notez le message « Export terminé : N lignes dans <nom du fichier>. » et ouvrez le fichier téléchargé.
5. Relancez ensuite « Vérifier à nouveau », puis ouvrez de nouveau le journal : l'export lui-même est tracé (action d'export).
**Résultat attendu :** « Chaîne intègre ». L'export respecte la période choisie (31 jours maximum, 10 000 lignes au plus) et son indication « Export borné : période obligatoire de 31 jours maximum, 10000 lignes au plus ». L'export est une action sensible : elle exige une session avec double authentification et laisse elle-même une trace.
- [ ] Résultat attendu constaté
- [ ] Le fichier CSV contient les entrées de la période
- [ ] Une entrée d'export apparaît dans le journal après l'opération
- [ ] « Chaîne intègre » est toujours affichée après l'export

#### C01.11 Fonctionnalité non incluse dans l'abonnement
**Compte :** propriétaire du Secondaire, puis propriétaire du Supérieur · **Où :** « Académique » > « Offres de cours » (`/v2/academic/offerings`)
1. Dans le Secondaire (`demo-secondaire`), ouvrez `/v2/academic/offerings` (titre « Offres de cours »).
2. Lisez l'avis affiché en haut de l'écran.
3. Dans le Supérieur (`demo-superieur`), ouvrez la même adresse avec le propriétaire du Supérieur.
**Résultat attendu :** au Secondaire, un avis indique que l'inscription à la carte « n'est pas incluse dans l'offre de l'établissement » (texte exact : « L'inscription à la carte n'est pas incluse dans l'offre de l'établissement. », ou le message général « Cette fonctionnalité n'est pas incluse dans l'offre de votre établissement. » (à confirmer selon l'écran)). Les actions de l'écran ne fonctionnent pas. Au Supérieur, la fonctionnalité fait partie du pack : l'écran fonctionne normalement.
- [ ] Résultat attendu constaté
- [ ] Au Secondaire, aucune offre de cours ne peut être ouverte
- [ ] Au Supérieur, l'écran des offres est utilisable
- [ ] Le même avis (« non incluse dans l'offre ») apparaît pour d'autres fonctions hors pack, par exemple `/v2/stateassign` selon le pack (à constater)

> Les écrans concernés affichent soit un avis dans la page, soit une réponse d'accès refusé de l'API avec le message « Cette fonctionnalité n'est pas incluse dans l'abonnement de votre établissement. ». Les menus dépendant d'une fonctionnalité absente sont masqués.

#### C01.12 Console de la plateforme : se connecter et parcourir les organisations
**Compte :** opérateur `plateforme@demo.test` · **Où :** `http://localhost:3100/v2/platform/login`
1. Ouvrez la page « Console plateforme » (« Connexion réservée aux opérateurs EcoleDigitale, distincte de la connexion des établissements »).
2. Saisissez « Adresse e-mail » et « Mot de passe » de l'opérateur (fichier des comptes de démonstration), puis « Se connecter ».
3. Vous arrivez sur « Organisations » (`/v2/platform/tenants`). Le menu propose « Organisations », « Plans et catalogue », « Journal de plateforme ». L'en-tête indique « Connecté en tant que plateforme@demo.test ».
4. Utilisez « Rechercher » (par nom ou identifiant) et le filtre « Statut » : trois organisations (Collège Le Baobab, École primaire Les Palmiers, Université Horizon) au statut « Active ».
5. Cliquez sur « Ouvrir l'organisation Collège Le Baobab (démonstration) » (`/v2/platform/tenants/<identifiant>`) : « Vue d'ensemble » (raison sociale, pays, contact, établissements), « Statut », « Abonnement », « Dérogations de fonctionnalités », « Droits effectifs et usage », « Réconcilier ».
**Résultat attendu :** la console affiche les trois organisations de démonstration ; la fiche détaille l'abonnement « Professionnel » et ses droits effectifs. La connexion de la console est distincte de celle des établissements (aucune double authentification).
- [ ] Résultat attendu constaté
- [ ] La fiche d'une organisation affiche statut, abonnement, dérogations et droits effectifs
- [ ] « Se déconnecter » ramène à la page de connexion de la console

#### C01.13 Console : dérogation de fonctionnalité et effet sur l'établissement
**Compte :** opérateur, puis propriétaire du Secondaire · **Où :** fiche de l'organisation > « Dérogations de fonctionnalités »
1. Dans la fiche de « Collège Le Baobab (démonstration) », section « Ajouter une dérogation » : « Fonctionnalité » = « Masse salariale et validation par le propriétaire », « Effet » = « Retirer », « Motif » = « Test de recette » (5 caractères minimum), « Enregistrer la dérogation ».
2. Message attendu : « Dérogation enregistrée. » ; la ligne apparaît dans le tableau « Dérogations » avec l'effet « Retirer ».
3. Dans « Droits effectifs et usage », vérifiez que la fonctionnalité n'est plus accordée.
4. Connectez-vous (ou actualisez) en propriétaire du Secondaire : l'entrée de menu « Masse salariale » a disparu et `/v2/payroll/owner` affiche « La masse salariale et la validation par le propriétaire ne sont pas incluses dans l'offre de l'établissement. » (la prise en compte peut demander jusqu'à 30 secondes).
5. Retournez dans la console et supprimez la dérogation (« Supprimer la dérogation de Masse salariale et validation par le propriétaire », confirmation « Supprimer cette dérogation ? ») : message « Dérogation supprimée. ».
6. Vérifiez côté établissement que la masse salariale est de nouveau disponible.
**Résultat attendu :** la dérogation se répercute sur l'établissement puis disparaît à sa suppression. Une dérogation exige un motif ; elle peut avoir une date d'expiration (champ « Expire le », facultatif).
- [ ] Résultat attendu constaté
- [ ] L'écran de l'établissement affiche le message « non incluse dans l'offre »
- [ ] Après suppression, la fonction revient
- [ ] La pose et la suppression de la dérogation figurent dans le journal d'audit de l'établissement (action « override.* », entité « override ») et dans le « Journal de plateforme »

#### C01.14 Console : plans, journal de plateforme, création d'organisation
**Compte :** opérateur · **Où :** « Plans et catalogue » (`/v2/platform/plans`), « Journal de plateforme » (`/v2/platform/audit`), « Nouvelle organisation » (`/v2/platform/tenants/new`)
1. Ouvrez « Plans et catalogue » : trois blocs « Plans » (Starter, Professionnel, Entreprise), « Packs » et « Fonctionnalités » (catalogue avec module, packs inclus, badge « Retirée » le cas échéant). Ne modifiez pas les plans de démonstration : une modification s'applique à toutes les organisations concernées.
2. Ouvrez « Journal de plateforme » : tableau « Entrées du journal de plateforme » des actions d'opérateur (provisionnement, statuts, plans, abonnements, dérogations). Retrouvez les actions de C01.13.
3. Facultatif : « Nouvelle organisation » : nom « Test Recette », identifiant (slug) `test-recette`, pays `CI`, un pack, propriétaire (nom, e-mail `proprio.test@demo-test.test`), essai (offre, durée en jours), « Provisionner l'organisation ». Message : « Organisation créée » avec le nombre d'établissements créés et « Une invitation a été envoyée à… » (le lien est dans la boîte aux lettres locale).
**Résultat attendu :** le catalogue reflète le plan « Professionnel » de la démonstration ; le journal de plateforme liste les actions de l'opérateur ; la création produit une quatrième organisation (identifiant non modifiable ensuite).
- [ ] Résultat attendu constaté
- [ ] Le journal de plateforme est lisible (sinon un avis « Le journal de plateforme n'est pas disponible sur ce serveur » s'affiche)
- [ ] La nouvelle organisation apparaît dans « Organisations » avec le statut « Active »

> Une organisation créée ne peut pas être supprimée depuis la console : seul `pnpm demo:reset` la retire. L'impersonation par un opérateur (prise de contrôle d'un compte d'établissement, action auditée de gravité « Critique ») n'a pas d'écran dans la console : voir « Écarts ».

### 1.4 Cas limites et tests négatifs

#### C01.N1 Le directeur ne définit ni rôle ni abonnement
**Compte :** directeur · **Où :** `/v2/access/roles`, `/v2/settings/subscription`
1. Connectez-vous en directeur du Secondaire (MFA oui).
2. Ouvrez « Rôles et permissions ».
3. Ouvrez « Abonnement et usage ».
**Résultat attendu :** la liste des rôles est lisible, mais le bouton « Nouveau rôle » et les boutons « Cloner » n'existent pas (la définition des rôles est réservée au propriétaire). L'abonnement est lisible sans aucune possibilité de modification. Le directeur a bien accès à « Attributions de rôles » et au « Journal d'audit ».
- [ ] Résultat attendu constaté
- [ ] Aucun bouton « Nouveau rôle » ni « Cloner »

#### C01.N2 Anti-escalade : le directeur ne peut pas attribuer le rôle « Propriétaire »
**Compte :** directeur · **Où :** `/v2/access/assignments`
1. Dans « Nouvelle attribution », choisissez un utilisateur quelconque et le rôle « Propriétaire ».
2. Cliquez sur « Attribuer le rôle ».
**Résultat attendu :** refus avec le message « Action refusée : vous ne pouvez accorder que des permissions que vous détenez vous-même sur ce périmètre. Permissions qui vous manquent : … ». L'écran rappelle d'avance cette règle (« Anti-escalade »).
- [ ] Résultat attendu constaté
- [ ] Aucune attribution n'a été créée (vérifier la liste)

#### C01.N3 Le dernier propriétaire ne peut pas être retiré
**Compte :** propriétaire · **Où :** `/v2/access/assignments`
1. Trouvez l'attribution « Propriétaire » du compte `direction.generale@demo-secondaire.test`.
2. Cliquez sur « Révoquer l'attribution… » et confirmez « Révoquer ».
**Résultat attendu :** refus avec « Action refusée : l'établissement doit toujours conserver au moins un propriétaire. ». Si, contre toute attente, la révocation est acceptée, le compte perd ses droits : faites alors `pnpm demo:reset`.
- [ ] Résultat attendu constaté

#### C01.N4 Rôle système verrouillé et rôle introuvable
**Compte :** propriétaire · **Où :** `/v2/access/roles`
1. Ouvrez un rôle système : aucune modification ni suppression n'est possible (« Ce rôle système est verrouillé. Clonez-le pour créer une variante modifiable. »).
2. Attribuez le rôle personnalisé « Secrétariat - test » à un utilisateur, puis tentez de le supprimer (« Supprimer le rôle »).
3. Ouvrez `/v2/access/roles/11111111-1111-4111-8111-111111111111`.
**Résultat attendu :** étape 2 : refus « Ce rôle est encore attribué à des utilisateurs. Retirez d'abord ses attributions. » ; une fois les attributions retirées, la suppression réussit (« Rôle supprimé. »). Étape 3 : « Ce rôle n'existe pas dans votre établissement. ».
- [ ] Résultat attendu constaté

#### C01.N5 L'enseignant n'accède à aucune page d'administration
**Compte :** enseignant (MFA non) · **Où :** `/v2/settings`, `/v2/access/roles`, `/v2/audit`, `/v2/admin/members`
1. Connectez-vous en enseignant du Secondaire.
2. Tapez successivement les quatre adresses dans la barre d'adresse.
3. Regardez le menu : aucune entrée « Établissement », « Rôles et permissions », « Journal d'audit », « Utilisateurs ».
**Résultat attendu :** les pages `/v2/settings`, `/v2/access/roles` et `/v2/audit` redirigent vers la page « Accès refusé » (« Vous n'avez pas les droits nécessaires pour afficher cette page. », lien « Retour à l'accueil »). La page des membres n'affiche aucune liste, mais un message d'erreur d'action non autorisée (à confirmer). Même résultat pour le parent et l'élève.
- [ ] Résultat attendu constaté
- [ ] Aucun menu d'administration visible pour l'enseignant

#### C01.N6 Entrée d'audit introuvable
**Compte :** propriétaire · **Où :** `/v2/audit/11111111-1111-4111-8111-111111111111`
1. Ouvrez l'adresse.
**Résultat attendu :** « Cette entrée n'existe pas ou n'appartient pas à votre établissement. » (la page répond comme si l'élément n'existait pas : même réponse pour une entrée d'un autre établissement).
- [ ] Résultat attendu constaté

#### C01.N7 Filtres et export invalides
**Compte :** propriétaire ou directeur · **Où :** `/v2/audit`
1. « Acteur (identifiant) » = `abc` puis « Appliquer les filtres » : « Saisissez un identifiant UUID valide. »
2. « Action » = `Role Changed` : « Format attendu : entité.verbe ou entité.* (minuscules). »
3. « Du » postérieur à « Au » : « La fin de période doit suivre le début. »
4. Sans dates, « Exporter en CSV » : « L'export exige une période : renseignez les deux dates. »
5. Période de 40 jours : « La période d'export est limitée à 31 jours. »
**Résultat attendu :** chaque saisie invalide est refusée avec le message indiqué, sans appel au serveur ni export.
- [ ] Résultat attendu constaté

#### C01.N8 Export du journal réservé aux profils autorisés
**Compte :** profil sans permission d'export (par exemple un rôle personnalisé de lecture seule) · **Où :** `/v2/audit`
1. Attribuez un rôle personnalisé disposant de « Consulter le journal d'audit » mais pas de « Exporter le journal d'audit » à un compte de test, puis connectez-vous avec lui.
**Résultat attendu :** le bouton « Exporter en CSV » est désactivé, avec le message « L'export est réservé aux profils disposant de la permission « Exporter le journal d'audit » (action sensible : MFA exigée). ».
- [ ] Résultat attendu constaté (scénario facultatif, nécessite la création d'un rôle de test)

#### C01.N9 Dérogation sans motif et connexion opérateur refusée
**Compte :** opérateur · **Où :** fiche d'une organisation, `/v2/platform/login`
1. « Ajouter une dérogation » sans fonctionnalité choisie : « Choisissez une fonctionnalité. » Avec un motif de 3 caractères : refus (5 caractères minimum).
2. Déconnectez-vous, puis ouvrez `/v2/platform/tenants` sans être connecté.
3. Sur `/v2/platform/login`, saisissez un mauvais mot de passe.
4. Suspendre une organisation sans motif (« Indiquez un motif de 3 caractères au moins. ») : cliquez sur « Annuler » sans confirmer.
**Résultat attendu :** étape 2 : redirection vers la connexion de la console. Étape 3 : « Identifiants d'opérateur invalides. » (même message que l'e-mail soit juste ou non). Les compteurs de la démonstration limitent les échecs de la console (8 échecs par minute et par adresse : un message « Trop de tentatives » peut apparaître ensuite).
- [ ] Résultat attendu constaté
- [ ] Un compte d'établissement (par exemple `direction.generale@demo-secondaire.test`) ne permet pas d'entrer dans la console

### 1.5 Problèmes connus et limites
- Les entrées de menu « Présences : paramètres », « Personnes : paramètres », « Emploi du temps : calendrier » et « Emploi du temps : validation » n'ont pas encore d'écran : elles sont masquées du menu (rapport QA).
- Le rapport QA signalait que, pour les rôles autres que propriétaire et directeur, deux appels (profil de l'organisation, droits de l'abonnement) étaient refusés à chaque page ; un correctif de lecture de la marque est livré mais « à reconfirmer » après redémarrage. Conséquence possible : le nom de l'établissement peut manquer dans l'en-tête de certains rôles et certaines entrées de menu liées à une fonctionnalité peuvent être masquées (comportement « échec fermé »).
- La page « Accès refusé » (`/unauthorized`) garde l'ancienne présentation (sans menu).
- Le téléversement de logo n'est pas disponible (lien https seulement).
- Aucun envoi réel d'e-mail : invitations et liens passent par la boîte aux lettres locale.
- Le journal d'audit est alimenté avec un léger délai ; l'« Usage mesuré » de l'abonnement peut rester vide.
- L'impersonation (prise de contrôle auditée d'un compte par l'opérateur) n'a pas d'écran dans la console.
- L'ensemble des règles de calcul des packs Primaire et Secondaire est de démonstration (bandeau « règles de démonstration »).

### 1.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Les specs 001 (saas-core), 002 (auth-rbac) et 003 (organization-campus) sont encore « À écrire » dans l'index `specs/v2/README.md` : aucun critère d'acceptation à confronter ; ce chapitre s'appuie sur le code et les README de modules.
- Impersonation : l'API existe (module `iam`, action d'audit `impersonation.started`, gravité « Critique », badge « Assistance » dans la liste des sessions) mais aucun écran de la console plateforme ne la déclenche ; le guide de démonstration la cite pourtant parmi les fonctions de la console.
- Le journal d'audit ne couvre pas la connexion réussie (`iam.user.logged_in` n'est pas dans les abonnements) : seules les connexions échouées, les sessions révoquées, les changements de rôles, d'attributions, de membres, de mot de passe et de MFA, et les événements des modules sont tracés.
- Rôles invitables dans « Utilisateurs » : seuls « Enseignant », « Élève / étudiant », « Parent » et « Administrateur » (vocabulaire historique) ; les autres rôles système s'attribuent ensuite par « Attributions de rôles ».

---

## Chapitre 2. Connexion, double authentification et comptes
> **Durée estimée :** 60 à 90 minutes · **Établissement(s) :** Secondaire (`demo-secondaire`), Primaire (`demo-primaire`), Supérieur (`demo-superieur`) · **Comptes :** enseignant (MFA non), directeur (MFA oui), propriétaire (MFA oui), comptes de test créés par vous

### 2.1 Objectif
Vérifier tout le parcours d'accès : connexion à l'établissement choisi par son adresse, double authentification (premier enrôlement, code à chaque connexion), sessions (liste, révocation, déconnexion), changement de mot de passe, mot de passe oublié et invitation d'un nouveau membre. Vérifier aussi les refus : mauvais mot de passe, mauvais code, session révoquée, page sans connexion, compte d'un autre établissement.

### 2.2 Avant de commencer
- **Adresse de connexion :** `http://<slug>.localhost:3100/v2/login` avec `<slug>` = `demo-secondaire`, `demo-primaire` ou `demo-superieur`. L'adresse sans sous-domaine (`http://localhost:3100/v2/login`) ouvre l'établissement par défaut (`demo-secondaire`).
- **Comptes et double authentification (MFA)**

| Compte | Établissement | MFA |
|---|---|---|
| `direction.generale@<slug>.test` (propriétaire) | chaque établissement | oui |
| `directeur@<slug>.test`, `etudes@<slug>.test`, `pedagogie@<slug>.test`, `secretariat@<slug>.test`, `econome@<slug>.test` | chaque établissement | oui |
| `enseignant@<slug>.test`, `educateur@<slug>.test`, `examens@<slug>.test`, `admissions@<slug>.test`, `parent@<slug>.test`, `eleve@<slug>.test` | chaque établissement | non |

- **Mots de passe :** dans le fichier des comptes de démonstration (`.demo/credentials.md`). Ils ne sont écrits nulle part dans ce guide.
- **Code de double authentification :** exécutez `pnpm demo:totp <e-mail>` (exemple : `pnpm demo:totp directeur@demo-secondaire.test`). Un code ne sert qu'une fois : si une connexion vient de l'utiliser, attendez 30 secondes pour le suivant.
- **Boîte aux lettres locale :** aucun e-mail réel n'est envoyé. Les invitations et les liens « mot de passe oublié » sont écrits dans le fichier `.demo/mailbox.jsonl` : une ligne par message, avec les champs `kind` (`invitation` ou `password_reset`), `email` et `link`. Copiez le champ `link` dans le navigateur de la ligne qui vous concerne (la plus récente pour votre e-mail).
- **Politique de mot de passe réelle :** 12 caractères minimum et 128 au plus ; aucune obligation de majuscule, chiffre ou symbole (la longueur prime : une phrase de passe convient). Sont refusés : un mot de passe courant (liste intégrée en français et en anglais, y compris avec chiffres à la place de lettres, par exemple « azertyazerty », « motdepasse123 »), l'adresse e-mail elle-même ou son identifiant (partie avant `@`, 4 caractères ou plus), un mot de passe répétitif (« aaaaaaaaaaaa »), une suite de caractères (« abcdefghijkl ») et, au changement de mot de passe, le nom ou l'identifiant de l'établissement ou l'ancien mot de passe.
- **Verrouillage :** après 5 échecs pour une même adresse e-mail depuis un même poste dans une fenêtre de 15 minutes, la connexion est bloquée 1 minute (la durée augmente en cas de récidive, jusqu'à 1 heure) ; au-delà de 25 échecs sur la même adresse (tous postes confondus), blocage de 5 minutes. Pendant le blocage, même le bon mot de passe est refusé. Pour la double authentification : 5 codes faux en 10 minutes bloquent aussi 1 minute.
- **Durées :** la session reste ouverte tant qu'elle est utilisée (jeton renouvelé automatiquement toutes les 15 minutes ; session inactive coupée après 14 jours, durée maximale de 30 jours). Le défi du second facteur expire au bout de 5 minutes ; l'enrôlement au bout de 10 minutes. Le lien « mot de passe oublié » vaut 30 minutes, l'invitation 7 jours.
- **Page d'arrivée après connexion (selon le rôle actif) :**

| Rôle | Page |
|---|---|
| Propriétaire, directeur | `/v2/direction` |
| Directeur des études | `/v2/academic` |
| Responsable pédagogique | `/v2/assessments` |
| Secrétariat | `/v2/students` |
| Économe | `/v2/finance` |
| Enseignant | `/v2/teacher` |
| Instituteur (primaire) | `/v2/primary` |
| Éducateur | `/v2/attendance` |
| Responsable des examens | `/v2/examinations` |
| Chargé d'admissions | `/v2/admissions` |
| Parent | `/v2/parent` |
| Élève | `/v2/student` |
| Autre rôle (par exemple personnel) | `/v2/home` (« Accueil », raccourcis par module) |

- **Menu du compte :** bouton « Mon compte » en haut à droite : « Sécurité du compte » (`/v2/account/security`), « Mes sessions » (`/v2/account/sessions`), « Mes notifications » (`/v2/account/notifications`), « Mes établissements » (`/v2/account/tenants`, seulement si le compte a plusieurs établissements), « Se déconnecter ».
- **Premier affichage lent :** le serveur de démonstration compile chaque page à sa première visite (quelques secondes à une minute).

### 2.3 Scénarios

#### C02.1 Connexion simple (sans double authentification)
**Compte :** enseignant (`enseignant@demo-secondaire.test`) · **Où :** `http://demo-secondaire.localhost:3100/v2/login`
1. Ouvrez la page : titre « Connexion », texte « Accédez à votre espace éducatif. », champs « Adresse e-mail » et « Mot de passe », bouton « Se connecter » (désactivé tant que les deux champs sont vides), liens « Mot de passe oublié ? » et « S'inscrire en ligne ».
2. Saisissez l'e-mail et le mot de passe du compte, puis « Se connecter ».
**Résultat attendu :** vous arrivez sur `/v2/teacher` (portail enseignant). L'en-tête affiche le nom de l'établissement, le bouton « Mon compte » indique le rôle actif « Enseignant ». Aucun code n'est demandé.
- [ ] Résultat attendu constaté
- [ ] Le bouton « Se connecter » affiche « Connexion… » pendant le traitement
- [ ] La page d'arrivée correspond au tableau « Page d'arrivée après connexion »

> Le lien « S'inscrire en ligne » mène à une page de l'ancienne application, non prévue dans la démonstration ; pour déposer une candidature, utilisez le chapitre Admissions (`/v2/apply`).

#### C02.2 Connexion avec double authentification (code à chaque connexion)
**Compte :** directeur (`directeur@demo-secondaire.test`, MFA oui) · **Où :** `/v2/login`
1. Ouvrez la page de connexion du Secondaire, saisissez l'e-mail et le mot de passe, « Se connecter ».
2. L'écran « Vérification en deux étapes » apparaît (« Saisissez le code à 6 chiffres de votre application d'authentification. »).
3. Dans un terminal, exécutez `pnpm demo:totp directeur@demo-secondaire.test` et recopiez le code.
4. Saisissez le code dans « Code à 6 chiffres » puis « Valider » (désactivé tant que moins de 6 caractères).
5. Déconnectez-vous (« Mon compte » > « Se déconnecter ») et recommencez : le code est redemandé à chaque connexion.
**Résultat attendu :** après le bon code, arrivée sur `/v2/direction`. Les liens « Utiliser un code de secours » et « Recommencer » sont proposés sous le formulaire ; « Recommencer » ramène à l'écran e-mail et mot de passe.
- [ ] Résultat attendu constaté
- [ ] Le code est redemandé à la connexion suivante
- [ ] « Recommencer » ramène à la saisie de l'e-mail
- [ ] Dans « Mes sessions » (C02.8), la session affiche la mention « 2 étapes »

#### C02.3 Choisir son établissement par l'adresse
**Compte :** propriétaires des trois établissements · **Où :** les trois adresses de connexion
1. Ouvrez `http://demo-secondaire.localhost:3100/v2/login` et connectez-vous avec `direction.generale@demo-secondaire.test` (MFA : voir C02.2). Notez le nom de l'établissement dans l'en-tête (« Collège Le Baobab »).
2. Déconnectez-vous. Ouvrez `http://demo-primaire.localhost:3100/v2/login` et connectez-vous avec `direction.generale@demo-primaire.test`.
3. Répétez avec `http://demo-superieur.localhost:3100/v2/login` et `direction.generale@demo-superieur.test`.
**Résultat attendu :** chaque adresse ouvre le bon établissement (« École primaire Les Palmiers », « Université Horizon »). Chaque établissement a ses propres comptes, avec le même nom d'utilisateur mais un suffixe différent. La session d'un établissement n'est pas partagée avec les autres adresses (chaque adresse demande sa propre connexion).
- [ ] Résultat attendu constaté
- [ ] Les trois établissements affichent des données différentes (niveaux, classes, élèves)

#### C02.4 Premier enrôlement de la double authentification (nouveau compte « Administrateur »)
**Compte :** propriétaire (pour inviter), puis le nouveau compte · **Où :** `/v2/admin/members` puis la page de connexion
Il faut une application d'authentification (Google Authenticator, Microsoft Authenticator, Aegis…) ou un outil de code TOTP sur votre poste ou téléphone. Les comptes de démonstration sont déjà enrôlés : on teste donc l'enrôlement avec un compte neuf.
1. En propriétaire, ouvrez « Utilisateurs » (`/v2/admin/members`), invitez `admin.test@demo-secondaire.test` avec le rôle « Administrateur », « Inviter ».
2. Ouvrez la boîte aux lettres locale, trouvez la ligne `kind: invitation` de cette adresse et ouvrez son `link` (voir C02.12 pour la saisie du mot de passe). Définissez un mot de passe respectant la politique.
3. Sur la page de connexion, saisissez l'e-mail et ce mot de passe, « Se connecter ».
4. L'écran « Activer la vérification en deux étapes » s'affiche : « Votre rôle l'exige. Scannez le QR code… ». Scannez le QR code, ou ouvrez « Saisie manuelle de la clé » et recopiez la clé dans votre application.
5. Saisissez le code à 6 chiffres affiché par l'application, « Activer et continuer ».
6. L'écran « Codes de secours » liste des codes à usage unique (« Ils ne seront plus affichés. »). Notez-les, cochez « J'ai noté mes codes de secours dans un endroit sûr. », puis « Continuer ».
**Résultat attendu :** vous arrivez dans l'application. Les connexions suivantes de ce compte demandent le code. Pour ce compte créé par vous, `pnpm demo:totp` ne peut pas fournir de code (il ne connaît que les comptes de démonstration) : utilisez votre application.
- [ ] Résultat attendu constaté
- [ ] Le bouton « Continuer » reste inactif tant que la case n'est pas cochée
- [ ] À la connexion suivante, l'écran « Vérification en deux étapes » demande le code
- [ ] Dans « Utilisateurs », le compte porte la mention « 2 étapes »

> L'enrôlement forcé à la première connexion s'applique aux rôles où la double authentification est obligatoire (par exemple « Administrateur », propriétaire). Les rôles « Enseignant », « Élève / étudiant » et « Parent » ne la rendent pas obligatoire : voir C02.5.

#### C02.5 Activer la double authentification depuis « Sécurité du compte »
**Compte :** compte de test « Enseignant » invité en C01.8 (`invite.test@demo-secondaire.test`, après activation) · **Où :** « Mon compte » > « Sécurité du compte » (`/v2/account/security`)
1. Connectez-vous avec le compte de test. Ouvrez `/v2/account/security` : la section « Vérification en deux étapes » indique « Désactivée. Elle est obligatoire pour certains rôles (propriétaire, administrateur…). ».
2. Saisissez « Votre mot de passe (pour confirmer) », puis « Activer ».
3. Scannez le QR code (ou « Saisie manuelle de la clé »), saisissez le « Code à 6 chiffres », « Confirmer l'activation ».
4. Lisez le message « Vérification en deux étapes activée. Conservez vos codes de secours : ils ne seront plus affichés. » et notez les codes, puis « J'ai noté mes codes ».
5. Déconnectez-vous et reconnectez-vous : le code est maintenant demandé.
**Résultat attendu :** le statut passe à « Activée : un code de votre application d'authentification est demandé à chaque connexion. ».
- [ ] Résultat attendu constaté
- [ ] Un mauvais mot de passe à l'étape 2 est refusé
- [ ] La reconnexion demande le code

#### C02.6 Se connecter avec un code de secours
**Compte :** le compte de C02.4 ou C02.5 · **Où :** `/v2/login`
1. Connectez-vous ; à l'écran « Vérification en deux étapes », cliquez sur « Utiliser un code de secours ».
2. Le champ devient « Code de secours » : saisissez l'un des codes notés, « Valider ».
3. Reconnectez-vous et réessayez avec le même code.
**Résultat attendu :** le premier essai ouvre la session ; le même code, réutilisé, est refusé (« Code de secours invalide. »). Le lien « Utiliser mon application » revient au code à 6 chiffres.
- [ ] Résultat attendu constaté
- [ ] Un code de secours ne marche qu'une fois

#### C02.7 Ré-authentification pour une action sensible (« Confirmez votre identité »)
**Compte :** propriétaire ou directeur · **Où :** toute action sensible (par exemple créer un rôle, attribuer un rôle, exporter le journal d'audit, publier ou émettre des bulletins, lancer un import de soldes, rejouer un webhook de paiement)
Le principe : une action sensible exige une session ayant satisfait la double authentification. Pour les comptes de démonstration à MFA, la session est déjà « à deux étapes » (mention « 2 étapes » dans « Mes sessions ») : l'action passe directement. Si l'API refuse une action sensible faute de double authentification, une fenêtre « Confirmez votre identité » s'ouvre.
1. Connectez-vous en propriétaire (code demandé, C02.2).
2. Exécutez une action sensible, par exemple « Exporter en CSV » dans le journal d'audit (C01.10) ou « Créer le clone » d'un rôle (C01.6).
3. Vérifiez que l'action s'exécute sans fenêtre supplémentaire.
4. Si la fenêtre « Confirmez votre identité » apparaît (« Cette action est sensible. Saisissez le code à 6 chiffres affiché par votre application d'authentification pour continuer. »), obtenez un nouveau code (`pnpm demo:totp <e-mail>`), saisissez-le dans « Code à 6 chiffres », puis « Confirmer et continuer » : l'action refusée est rejouée une fois.
**Résultat attendu :** en démonstration, les actions sensibles aboutissent sans fenêtre pour un compte à MFA. Quand la fenêtre apparaît, la confirmation est valable environ 5 minutes pour cette session seulement.
- [ ] Résultat attendu constaté (action sensible acceptée sans fenêtre)
- [ ] Si la fenêtre apparaît : le bon code ferme la fenêtre et l'action aboutit
- [ ] Un code déjà utilisé est refusé (indication « Un code déjà utilisé n'est pas accepté : attendez le suivant. »)

> La fenêtre est difficile à déclencher avec les comptes de démonstration (leurs sessions sont ouvertes avec le second facteur). Elle apparaît lorsqu'une action sensible est refusée faute de MFA, par exemple après une session ouverte sans second facteur. Ne la cherchez pas avec un compte sans MFA (enseignant, éducateur, examens, admissions, parent, élève) : ces rôles n'ont aucune permission sensible.

#### C02.8 Mes sessions : liste et révocation
**Compte :** enseignant (deux navigateurs ou une fenêtre privée) · **Où :** « Mon compte » > « Mes sessions » (`/v2/account/sessions`)
1. Navigateur A : connectez-vous en enseignant du Secondaire. Navigateur B (fenêtre privée) : connectez-vous avec le même compte.
2. En A, ouvrez `/v2/account/sessions` (« Mes sessions actives ») : deux lignes. La ligne de A porte l'étiquette « Cet appareil ». Chaque ligne donne l'appareil (par exemple « Chrome sur Windows »), l'adresse, le rôle, « Connecté le » et « actif le ».
3. Cliquez sur « Révoquer » sur l'autre ligne.
4. En B, cliquez sur un menu ou rechargez une page.
**Résultat attendu :** en A, message « Session révoquée. » et la liste ne contient plus que la session de A. En B, au prochain clic, retour à la page de connexion avec « Votre session a pris fin. Reconnectez-vous. ».
- [ ] Résultat attendu constaté
- [ ] La session de B est effectivement fermée (retour à la connexion)
- [ ] La révocation figure dans le journal d'audit du propriétaire (action « session.revoked »)

#### C02.9 Déconnexion et « Déconnecter tous mes appareils »
**Compte :** enseignant · **Où :** « Mon compte » > « Se déconnecter » ; `/v2/account/sessions`
1. Cliquez sur « Se déconnecter » : retour à la page de connexion.
2. Revenez en arrière avec le bouton « Précédent » du navigateur : la page protégée ne doit plus donner accès aux données, vous êtes renvoyé à la connexion (à confirmer).
3. Reconnectez-vous en A et B, puis en A cliquez sur « Déconnecter tous mes appareils ».
**Résultat attendu :** étape 3 : la session de A et celle de B sont fermées ; A revient à la connexion et B sera renvoyé à la connexion à son prochain clic. Sur la ligne de la session courante, le bouton s'appelle « Me déconnecter ».
- [ ] Résultat attendu constaté
- [ ] Après déconnexion, la touche « Précédent » ne redonne pas accès aux pages

#### C02.10 Changer son mot de passe
**Compte :** compte de test « Enseignant » (`invite.test@demo-secondaire.test`) · **Où :** `/v2/account/security`, section « Mot de passe »
N'utilisez pas un compte de démonstration : son mot de passe ne correspondrait plus au fichier des comptes.
1. Ouvrez « Sécurité du compte ». Saisissez « Mot de passe actuel », « Nouveau mot de passe » (indication « 12 caractères minimum, différent de l'ancien. ») et « Confirmer le nouveau mot de passe ».
2. Cliquez sur « Changer le mot de passe ».
3. Ouvrez le même compte dans un second navigateur avant l'opération pour vérifier l'effet sur l'autre appareil.
**Résultat attendu :** message « Mot de passe modifié. Vos autres appareils ont été déconnectés. ». Les autres sessions sont fermées ; la session courante reste ouverte. Le nouveau mot de passe sert à la prochaine connexion. Le bouton reste inactif tant que les deux saisies du nouveau mot de passe diffèrent (« Les mots de passe ne correspondent pas. »).
- [ ] Résultat attendu constaté
- [ ] L'ancien mot de passe ne fonctionne plus
- [ ] Une entrée « password.changed » apparaît dans le journal du propriétaire

#### C02.11 Mot de passe oublié
**Compte :** compte de test · **Où :** `/v2/forgot-password` (lien « Mot de passe oublié ? » de la connexion)
1. Saisissez l'e-mail du compte de test, « Envoyer le lien ». Le message « Si un compte existe pour cette adresse, un e-mail vient d'être envoyé. Pensez à vérifier vos courriers indésirables. » s'affiche.
2. Ouvrez `.demo/mailbox.jsonl`, repérez la dernière ligne `kind: password_reset` pour cet e-mail et ouvrez son `link` (il pointe vers `/auth/reset-password?token=…`).
3. Écran « Nouveau mot de passe » (« Choisissez un nouveau mot de passe. Vos autres appareils seront déconnectés. ») : saisissez un mot de passe valide deux fois, « Enregistrer ».
4. Message « Mot de passe enregistré. Vous pouvez vous connecter. », bouton « Se connecter ».
5. Connectez-vous avec le nouveau mot de passe.
**Résultat attendu :** réinitialisation réussie ; le lien est à usage unique et valable 30 minutes ; les appareils déjà connectés sont déconnectés.
- [ ] Résultat attendu constaté
- [ ] Le même lien rouvert ensuite est refusé (voir C02.N6)
- [ ] La page affiche la même réponse que l'e-mail existe ou non (voir C02.N5)

#### C02.12 Invitation d'un nouveau membre
**Compte :** propriétaire, puis la personne invitée · **Où :** `/v2/admin/members`, lien de la boîte aux lettres
1. Le propriétaire invite `invite.test@demo-secondaire.test` avec le rôle « Enseignant » (C01.8).
2. Dans `.demo/mailbox.jsonl`, trouvez la ligne `kind: invitation` de cette adresse, ouvrez son `link` (`/auth/invitation?token=…`).
3. Écran « Activer votre compte » : « Choisissez le mot de passe de votre compte. » Saisissez et confirmez un mot de passe valide, « Enregistrer ».
4. Message « Mot de passe enregistré. Vous pouvez vous connecter. » puis connexion avec la nouvelle adresse.
5. Rechargez la page du lien avant de saisir le mot de passe : le jeton est retiré de la barre d'adresse dès l'ouverture.
**Résultat attendu :** le compte est activé (statut « Actif » dans « Utilisateurs »), la connexion arrive sur la page de son rôle. L'invitation vaut 7 jours.
- [ ] Résultat attendu constaté
- [ ] Après rechargement de la page du lien, le message « Ce lien est incomplet ou n'est plus valable. » s'affiche, avec le lien « Demander un nouveau lien »

#### C02.13 Mes établissements
**Compte :** n'importe quel compte de démonstration · **Où :** `/v2/account/tenants`
1. Ouvrez la page (elle n'est pas dans le menu quand le compte n'a qu'un seul établissement).
**Résultat attendu :** « Mes établissements » liste l'établissement courant (« Actuel ») et indique « Votre compte n'a accès qu'à un seul établissement. ». Chaque compte de démonstration n'appartient qu'à un établissement.
- [ ] Résultat attendu constaté

### 2.4 Cas limites et tests négatifs

#### C02.N1 Mauvais mot de passe : message non révélateur
**Compte :** enseignant · **Où :** `/v2/login`
1. Saisissez `enseignant@demo-secondaire.test` avec un mauvais mot de passe, « Se connecter ».
2. Recommencez avec une adresse inexistante (`inconnu@demo-secondaire.test`) et un mot de passe quelconque.
**Résultat attendu :** dans les deux cas le même message : « Identifiants invalides. Vérifiez votre e-mail et votre mot de passe. ». Rien n'indique si le compte existe. Le refus prend toujours au moins une demi-seconde.
- [ ] Résultat attendu constaté
- [ ] Même message pour compte inconnu et mauvais mot de passe
- [ ] Les échecs apparaissent dans le journal d'audit du propriétaire (action « login.failed », gravité « Notable »)

#### C02.N2 Verrouillage après plusieurs échecs
**Compte :** élève (`eleve@demo-secondaire.test`) : compte de peu d'importance · **Où :** `/v2/login`
1. Saisissez 5 fois de suite un mauvais mot de passe.
2. À la 6e tentative, saisissez le BON mot de passe.
3. Attendez environ 1 minute puis réessayez avec le bon mot de passe.
**Résultat attendu :** la connexion est bloquée (« Trop de tentatives. Réessayez dans 1 minute. »), même avec le bon mot de passe ; après l'attente, la connexion réussit. Ne refaites pas le test plusieurs fois de suite : la durée de blocage augmente en cas de récidive (jusqu'à 1 heure).
- [ ] Résultat attendu constaté
- [ ] Le blocage s'applique à cette adresse e-mail depuis ce poste, pas aux autres comptes
- [ ] Une entrée « login.failed » de gravité « Avertissement » (verrouillage) apparaît dans le journal

#### C02.N3 Code de double authentification faux ou déjà utilisé
**Compte :** directeur · **Où :** écran « Vérification en deux étapes »
1. Connectez-vous (e-mail et mot de passe), puis saisissez `000000`, « Valider ».
2. Saisissez ensuite le bon code (`pnpm demo:totp directeur@demo-secondaire.test`).
3. Déconnectez-vous, reconnectez-vous immédiatement et saisissez LE MÊME code.
4. Attendez 30 secondes, obtenez le nouveau code et saisissez-le.
**Résultat attendu :** étape 1 : « Code invalide. Vérifiez l'heure de votre téléphone. » (l'écran reste ouvert). Étape 3 : même message, car un code déjà utilisé est refusé. Étape 4 : connexion réussie. Après 5 codes faux, un blocage d'1 minute s'applique ; après 5 minutes d'attente, le défi expire (« Recommencer » ramène à la saisie du mot de passe).
- [ ] Résultat attendu constaté
- [ ] Un code déjà utilisé n'est pas accepté une deuxième fois
- [ ] Le code de secours faux affiche « Code de secours invalide. »

#### C02.N4 Session révoquée : déconnexion
**Compte :** enseignant, et propriétaire · **Où :** `/v2/admin/members`
1. Connectez-vous en enseignant (navigateur B).
2. En propriétaire (navigateur A), ouvrez « Utilisateurs », trouvez `enseignant@demo-secondaire.test` et cliquez sur « Révoquer les sessions ».
3. En B, cliquez sur un menu.
**Résultat attendu :** A affiche le nombre de sessions révoquées. B est renvoyé à la connexion avec « Votre session a pris fin. Reconnectez-vous. ». Le compte n'est pas suspendu : une nouvelle connexion réussit. Variante : « Suspendre » au lieu de « Révoquer » empêche aussi la reconnexion (« Aucun accès actif pour cet établissement. ») jusqu'à « Rétablir ».
- [ ] Résultat attendu constaté
- [ ] Après suspension, la connexion est refusée avec « Aucun accès actif pour cet établissement. »
- [ ] Après « Rétablir », la connexion refonctionne

#### C02.N5 Mot de passe oublié sur une adresse inconnue
**Compte :** aucun · **Où :** `/v2/forgot-password`
1. Saisissez `fantome@demo-secondaire.test`, « Envoyer le lien ».
2. Ouvrez `.demo/mailbox.jsonl`.
**Résultat attendu :** le même message de confirmation que pour une adresse existante ; aucune ligne n'est écrite pour cette adresse. Au-delà de 3 demandes par heure pour une même adresse, les demandes supplémentaires sont ignorées sans message différent.
- [ ] Résultat attendu constaté

#### C02.N6 Lien de réinitialisation ou d'invitation invalide
**Compte :** compte de test · **Où :** `/v2/reset-password`, lien de la boîte aux lettres
1. Ouvrez `/v2/reset-password` sans jeton : « Ce lien est incomplet ou n'est plus valable. » avec « Demander un nouveau lien ».
2. Utilisez un lien une première fois (C02.11), puis rouvrez le même lien.
3. Faites une demande, puis une seconde ; ouvrez le premier lien.
**Résultat attendu :** étape 2 : l'enregistrement est refusé avec « Ce lien n'est plus valable. Demandez-en un nouveau. ». Un lien expiré (30 minutes pour un mot de passe oublié, 7 jours pour une invitation) donne le même message.
- [ ] Résultat attendu constaté

#### C02.N7 Mot de passe refusé par la politique
**Compte :** compte de test · **Où :** `/v2/account/security` ou page de nouveau mot de passe
Essayez successivement (chaque essai doit être refusé) :
1. `azerty` : trop court et trop courant (« Le mot de passe doit contenir au moins 12 caractères. », « Ce mot de passe est trop courant. Choisissez une phrase de passe plus originale. »).
2. `azertyazerty` : « Ce mot de passe est trop courant… ».
3. `aaaaaaaaaaaa` : « Le mot de passe est trop répétitif. ».
4. `abcdefghijkl` : « Le mot de passe ne doit pas être une suite de caractères consécutifs. ».
5. Votre e-mail ou son identifiant (par exemple `invite.test` suivi de chiffres) : « Le mot de passe ne doit pas être votre adresse e-mail. » ou « …ne doit pas contenir votre identifiant e-mail. ».
6. Au changement de mot de passe : le même mot de passe que l'ancien : « Le nouveau mot de passe doit être différent de l'ancien. ».
7. Deux saisies différentes : « Les mots de passe ne correspondent pas. » (le bouton reste inactif).
**Résultat attendu :** tous ces mots de passe sont refusés avec le message correspondant ; une phrase de passe de 12 caractères ou plus, originale, est acceptée.
- [ ] Résultat attendu constaté
- [ ] Une phrase de passe valable est acceptée

#### C02.N8 Page sans connexion : redirection vers la connexion
**Compte :** aucun (fenêtre privée) · **Où :** barre d'adresse
1. Sans être connecté, ouvrez `/v2/direction`, puis `/v2/settings`, `/v2/account/sessions`, `/v2/students` et `/v2/parent`.
**Résultat attendu :** chaque adresse renvoie vers la page de connexion (`/login`, même formulaire « Connexion »). Après la connexion, vous arrivez sur la page d'arrivée de votre rôle et non sur la page demandée au départ.
- [ ] Résultat attendu constaté
- [ ] Aucune donnée de l'établissement n'est visible avant la connexion

#### C02.N9 Compte d'un autre établissement refusé sur le mauvais sous-domaine
**Compte :** propriétaire du Primaire · **Où :** `http://demo-secondaire.localhost:3100/v2/login`
1. Sur l'adresse du Secondaire, saisissez `direction.generale@demo-primaire.test` avec son BON mot de passe.
2. Inversement, sur l'adresse du Primaire, saisissez `direction.generale@demo-secondaire.test`.
3. Ouvrez, dans une session connectée au Secondaire, `http://demo-primaire.localhost:3100/v2/direction`.
**Résultat attendu :** étapes 1 et 2 : « Aucun accès actif pour cet établissement. » (aucune session n'est ouverte). Étape 3 : l'autre adresse ne partage pas la session : retour à la connexion.
- [ ] Résultat attendu constaté
- [ ] Aucune donnée de l'autre établissement n'est accessible

#### C02.N10 Désactiver la double authentification : refus pour un rôle qui l'impose
**Compte :** propriétaire · **Où :** `/v2/account/security`
Attention : si la désactivation est acceptée, le compte perd sa MFA (et donc l'accès aux actions sensibles) ; il faudra faire `pnpm demo:reset`. Ce test ne s'effectue qu'en fin de recette.
1. Cliquez sur « Désactiver… », saisissez le mot de passe du compte et un code à 6 chiffres, puis « Désactiver la vérification ».
**Résultat attendu :** refus avec « Votre rôle exige la vérification en deux étapes : elle ne peut pas être désactivée. ». Pour un compte dont le rôle ne l'impose pas, la désactivation réussit (« Vérification en deux étapes désactivée. Vos autres appareils ont été déconnectés. »).
- [ ] Résultat attendu constaté (propriétaire : refus)

#### C02.N11 « Réinitialiser la MFA » d'un membre
**Compte :** propriétaire · **Où :** `/v2/admin/members`
1. Trouvez le compte créé en C02.4 (mention « 2 étapes »), cliquez sur « Réinitialiser la MFA ».
2. Reconnectez-vous avec ce compte.
**Résultat attendu :** message « Vérification en deux étapes de <e-mail> réinitialisée. » ; ses sessions sont fermées et, comme son rôle l'impose, l'enrôlement est redemandé à la prochaine connexion (écran « Activer la vérification en deux étapes »).
- [ ] Résultat attendu constaté

### 2.5 Problèmes connus et limites
- La connexion Google n'est pas activée dans la démonstration (le bouton « Continuer avec Google » n'apparaît pas).
- Le lien « S'inscrire en ligne » de la page de connexion ouvre une page de l'ancienne application, non utilisable dans la démonstration.
- Après connexion, l'arrivée se fait toujours sur la page du rôle, jamais sur la page demandée avant la connexion.
- Pas de courrier réel : tout passe par `.demo/mailbox.jsonl`. Le serveur de démonstration compile chaque page à sa première visite.
- Un accès à une page de gestion sans la permission renvoie vers la page « Accès refusé », sans le menu de l'application.
- Après révocation d'une session depuis un autre appareil, la déconnexion de l'appareil visé a lieu au prochain clic ou, au plus tard, au renouvellement automatique du jeton (15 minutes).
- Les comptes de démonstration ont tous les mots de passe générés au lancement : changer le mot de passe d'un compte de démonstration le désynchronise du fichier des comptes (utilisez un compte de test créé par invitation).
- L'obligation de double authentification à la connexion est liée au rôle d'accès du compte : « Propriétaire » et « Administrateur » l'imposent ; les autres comptes de démonstration à MFA (directeur, études, pédagogie, secrétariat, économe) ont été enrôlés lors de la mise en place et peuvent donc, d'après le code, désactiver leur propre MFA (à confirmer).

### 2.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 002 (auth-rbac) « À écrire » : pas de critères d'acceptation à confronter ; le comportement décrit vient du module `iam` (README, `config.ts`, `password-policy.ts`) et des écrans `apps/web/src/platform/auth/ui/*`.
- Ré-authentification (« step-up ») : implémentée côté API (`POST /api/v1/iam/mfa/step-up`, fenêtre de 300 s) et côté web (`useStepUp`, `StepUpDialog`) sur les rôles, attributions, webhooks de paiement, imports, bulletins et documents d'élèves, mais, avec les comptes de démonstration, elle n'est pas déclenchable : sessions de MFA déjà « à deux étapes », rôles sans MFA dépourvus de permission sensible. À vérifier par un test d'intégration plutôt que par recette manuelle.
- Les « codes de secours » ne sont pas acceptés pour la ré-authentification (TOTP seulement).
- Aucune page de gestion des codes de secours après l'enrôlement (régénération) n'a été trouvée dans l'écran « Sécurité du compte ».
- Les messages d'erreur du formulaire de connexion (`describeSignInError`) ne distinguent pas « compte suspendu » de « aucun accès » : les deux affichent « Aucun accès actif pour cet établissement. ».


## Chapitre 3. Structure académique
> **Durée estimée :** 60 à 90 minutes · **Établissement(s) :** `demo-secondaire` (parcours complet) ; `demo-primaire` et `demo-superieur` pour les différences signalées · **Comptes :** directeur des études (`etudes@`), secrétariat (`secretariat@`), propriétaire (`direction.generale@`) et directeur (`directeur@`), enseignant (`enseignant@`) pour les refus. MFA : oui pour les quatre premiers, non pour l'enseignant.

### 3.1 Objectif
Vérifier que la direction peut préparer la structure de l'école : années scolaires et périodes (trimestres ou semestres), programmes, curriculum (matières et coefficients), classes, inscriptions, réglages académiques, puis préparer l'année suivante (reconduction). Vérifier aussi que chaque rôle ne voit et ne fait que ce que son métier autorise, et repérer les actions que l'on ne peut pas annuler (clôture d'une période, d'une année, reconduction).

### 3.2 Avant de commencer
- **Comptes** (adresse de connexion `http://<slug>.localhost:3100/v2/login`, `<slug>` = `demo-secondaire`, `demo-primaire` ou `demo-superieur`) :
  - Directeur des études : `etudes@demo-secondaire.test` (MFA oui). Il gère années, périodes, programmes, curriculum, classes et réglages. Il ne peut **pas** clôturer une année, rouvrir une période close, reconduire une année, amender un curriculum publié, changer le financement d'une inscription, ni créer ou annuler une inscription.
  - Secrétariat : `secretariat@demo-secondaire.test` (MFA oui). Il crée et suit les inscriptions ; il consulte la structure académique en lecture seule.
  - Propriétaire `direction.generale@demo-secondaire.test` et directeur `directeur@demo-secondaire.test` (MFA oui) : tous les droits de ce chapitre, y compris clôture, réouverture, reconduction, financement.
  - Enseignant `enseignant@demo-secondaire.test` (MFA non) : aucun droit sur la structure académique (cas négatifs).
  - Le fichier des comptes de démonstration est `.demo/credentials.md` ; le code MFA s'obtient avec `pnpm demo:totp <e-mail>` (voir l'introduction).
- **Chemins de menu.** Dans le menu latéral, le module « Académique » propose : « Années et périodes », « Programmes et niveaux », « Curriculum », « Classes », « Offres de cours » (selon l'offre de l'établissement), « Inscriptions » (aussi sous `/v2/enrollments`), « Reconduction annuelle », « Paramètres académiques ». En haut de chaque écran, une barre d'onglets « Cœur académique » reprend : « Années et périodes », « Programmes », « Curriculum », « Classes », « Offres de cours », « Reconduction », « Paramètres ». Un onglet n'apparaît que si vous avez le droit correspondant.
- **URL** : `/v2/academic/years`, `/v2/academic/programs`, `/v2/academic/curriculum`, `/v2/academic/classrooms` (et `/v2/academic/classrooms/<identifiant>`), `/v2/academic/offerings`, `/v2/academic/rollover` (historique : `/v2/academic/rollover/runs`), `/v2/academic/settings`, `/v2/enrollments`, `/v2/enrollments/new`, `/v2/enrollments/<identifiant>`.
- **Données de démonstration** (identiques dans les trois établissements, sauf le niveau) :
  - Année « Année scolaire 2026-2027 », code `2026-2027`, du 1er septembre 2026 au 31 août 2027, ouverte et courante. Secondaire et primaire : 3 trimestres ; supérieur : 2 semestres. Au départ, la première période est ouverte ; au secondaire la deuxième l'est aussi (l'état exact de chaque période dépend de l'avancement de la démonstration : **notez ce que vous constatez**).
  - Programme : « Collège » (secondaire, niveau 6E), « Primaire » (primaire, niveau CP1), « Informatique » (supérieur, niveau L1). Un curriculum publié par programme et par année : secondaire, matières Français (coef. 3), Mathématiques (coef. 3), Anglais (coef. 2), Histoire-Géographie (coef. 2) ; primaire, Français (3), Mathématiques (3), Éveil (1), Éducation physique (1) ; supérieur, UE/ECUE avec crédits (Algorithmique 3, Programmation 3, Mathématiques 4, Statistiques 2).
  - Classe : « 6e A » (code `6E-A`, secondaire), « CP1 A » (code `CP1-A`, primaire), « Licence 1 A » (code `L1-A`, supérieur), capacité 40, active ; le primaire a en plus une classe de maternelle (à confirmer : nom exact).
  - 12 élèves inscrits dans la classe (Nadia DIABATE, Salimata DIABATE, Aya BAMBA, Fatou BAMBA, Moussa COULIBALY, Salimata COULIBALY, Yao TOURE, Jean-Marc TOURE, Elie SORO, Aya SORO, Koffi N'GUESSAN, Aya N'GUESSAN). À la création de la démonstration, les 8 premiers ont payé leur frais d'inscription et sont « Active » ; les 4 derniers sont « En attente ». La politique de confirmation est « Après paiement des frais d'inscription ». L'activité financière de la démonstration peut avoir confirmé d'autres élèves : constatez l'état réel.
  - Frais d'inscription : 25 000 XOF (secondaire), 15 000 XOF (primaire), 50 000 XOF (supérieur).
- **Ordre conseillé.** Faites les scénarios de lecture d'abord, puis les créations, et gardez pour la fin, avec un seul compte, tout ce qui est marqué « Attention : action irréversible ». `pnpm demo:reset` remet tout à zéro.

### 3.3 Scénarios

#### C03.1 Consulter l'année courante et ses périodes
**Compte :** Directeur des études (`etudes@`) · **Où :** « Académique » > « Années et périodes » (`/v2/academic/years`)
1. Ouvrez l'écran. Repérez la ligne « Année scolaire 2026-2027 » avec les badges « Ouverte » et « Courante ».
2. Cliquez sur « Périodes » en bout de ligne. Le panneau « Périodes de Année scolaire 2026-2027 » s'affiche, avec la frise de l'année (les périodes placées selon leurs dates) et un tableau : Période, Type, Dates, État.
3. Relevez le nombre de périodes et leur état (« Planifiée », « Ouverte », « Notes closes », « Close »).
**Résultat attendu :** 3 périodes au secondaire et au primaire, 2 au supérieur ; au moins la première est « Ouverte » ou plus avancée ; les dates couvrent l'année sans trou.
- [ ] L'année 2026-2027 est « Ouverte » et « Courante »
- [ ] Nombre de périodes conforme à l'établissement (3 ou 2)
- [ ] La frise reflète les dates du tableau
- [ ] État de chaque période noté : P1 ____ P2 ____ P3 ____

#### C03.2 Créer l'année suivante
**Compte :** Directeur des études · **Où :** « Années et périodes »
1. Cliquez sur « Nouvelle année ». Dans « Créer une année académique », saisissez Code `2027-2028`, Libellé `Année scolaire 2027-2028`, Début `01/09/2027`. Laissez « Fin » vide (par défaut : douze mois pleins après le début).
2. Validez avec « Nouvelle année ».
**Résultat attendu :** message « L'année Année scolaire 2027-2028 a été créée. » ; la ligne apparaît à l'état « Brouillon », sans badge « Courante », fin au 31/08/2028. Il n'existe aucun bouton pour supprimer une année : seulement « Ouvrir », « Modifier », puis « Archiver ».
- [ ] Année créée à l'état « Brouillon »
- [ ] Date de fin proposée : 31/08/2028
- [ ] Pas de bouton de suppression d'année

Cette année sert à C03.9, C03.10 et C03.14.

#### C03.3 Générer les périodes depuis un plan, puis en supprimer une
**Compte :** Directeur des études · **Où :** « Années et périodes » > « Périodes » de l'année 2027-2028
1. Sélectionnez l'année 2027-2028 (bouton « Périodes »). Le message « Aucune période pour cette année. » s'affiche.
2. Cliquez sur « Générer depuis un plan ». Choisissez un plan de périodes (trimestres ou semestres selon l'établissement). L'écran annonce « N périodes seront créées » avec la liste. Validez.
3. Message « N périodes ont été générées ». Toutes sont « Planifiée ».
4. Sur la dernière période, cliquez sur « Supprimer » (disponible seulement tant qu'elle est « Planifiée »). Puis recréez-la avec « Ajouter une période » si vous voulez retrouver le plan complet (type, numéro d'ordre, code, libellé, début, fin).
**Résultat attendu :** les périodes couvrent exactement l'année, sans chevauchement ; une période « Planifiée » se modifie (« Modifier ») et se supprime.
- [ ] Plan appliqué, périodes « Planifiée »
- [ ] Suppression d'une période planifiée possible
- [ ] Pas de bouton « Supprimer » sur une période ouverte ou close

#### C03.4 Programmes et niveaux
**Compte :** Directeur des études · **Où :** « Académique » > « Programmes et niveaux » (`/v2/academic/programs`)
1. Dans l'arborescence « Programmes », choisissez « Collège » (ou « Primaire », « Informatique »). Le détail et les « Niveaux couverts » s'affichent (6E, CP1 ou L1 cochés).
2. Cliquez sur « Nouveau programme » : Code `TEST-A`, Libellé `Programme de test`, choisissez le « Niveau d'enseignement ». Créez.
3. Sur le nouveau programme, cochez un niveau puis « Enregistrer les niveaux » ; ensuite « Archiver », puis « Réactiver ».
**Résultat attendu :** « Le programme Programme de test a été créé. » ; « Les niveaux couverts ont été enregistrés. » ; « Le programme est archivé. » puis « Le programme est réactivé. ».
- [ ] Programme de démonstration lisible avec son niveau
- [ ] Création, niveaux, archivage et réactivation fonctionnent
- [ ] Le code est en majuscules (le champ le rappelle)

#### C03.5 Lire un curriculum publié et son rapport de validation
**Compte :** Directeur des études · **Où :** « Académique » > « Curriculum » (`/v2/academic/curriculum`)
1. Choisissez le programme (« Collège », etc.) et l'année « 2026-2027 ».
2. Observez « Version 1 », la mention « Publiée le … » et l'arbre : un nœud de niveau puis les matières (secondaire et primaire) ou semestre, UE, ECUE (supérieur), avec coefficients (« coef. 3 ») ou crédits (« 3 crédits »).
3. Lisez le message « Cette version est publiée : elle ne se modifie plus directement. Un amendement motivé et journalisé est possible. »
4. Cliquez sur « Rapport de validation » : « Le curriculum est valide (sans avertissement) » attendu.
5. Cliquez sur « Cloner vers une autre année », choisissez « 2027-2028 » : l'aperçu annonce « N nœuds seront copiés ». Cliquez sur « Annuler » (ou « Cloner » si vous voulez créer un brouillon pour 2027-2028).
**Résultat attendu :** version publiée en lecture seule ; aucun bouton « Ajouter à la racine » ni « Supprimer » sur une version publiée ; clonage possible vers l'année suivante (brouillon).
- [ ] Coefficients (ou crédits) conformes aux données de démonstration
- [ ] Rapport de validation sans erreur
- [ ] Aperçu du clonage affiché
- [ ] Aucune modification directe possible sur la version publiée

Attention : « Publier » (sur un brouillon cloné) rend la version non modifiable directement ; seul un amendement motivé est ensuite possible. À faire en dernier.

#### C03.6 Classes : lire la classe de démonstration, créer une classe
**Compte :** Directeur des études · **Où :** « Académique » > « Classes » (`/v2/academic/classrooms`)
1. Dans la liste « Classes et promotions », filtrez par Année (2026-2027) ; repérez « 6e A » (ou « CP1 A », « Licence 1 A »), état « Active », effectif « x / 40 ».
2. Ouvrez la classe. Vérifiez : État, Année, Effectif, Capacité (« Bloquante » ou « Indicative »), Dates ; la section « Élèves » (colonnes Nom, Matricule, N° d'inscription, Inscription) ; la section « Enseignants » : Kouadio TRAORE (« Responsable » au secondaire et supérieur, « Titulaire de classe » au primaire), Fatou YAO et Adjoua KOUAME (« Co-enseignant »), portée « Toutes les matières ».
3. Revenez à la liste, cliquez sur « Nouvelle classe » : Année 2026-2027, Programme (« Collège »), Niveau (6E), Curriculum (la version publiée), Code `6E-B`, Nom `6e B`, Nature « Classe », Capacité `30`. Créez.
**Résultat attendu :** « La classe 6e B a été créée. » ; elle apparaît à l'état « Brouillon », effectif 0. (Au primaire, l'activation d'une classe exige un titulaire de classe affecté : ne l'activez pas.)
- [ ] Effectif et élèves de la classe cohérents avec la liste des inscriptions
- [ ] Enseignants et rôles conformes
- [ ] Nouvelle classe créée à l'état « Brouillon »

Les boutons « Activer », « Terminer » et « Annuler la classe » existent sur la fiche d'une classe (réservés à qui gère les classes) ; « Annuler la classe » exige un motif. N'y touchez pas sur la classe de démonstration.

#### C03.7 Inscriptions : liste, filtres et fiche d'une inscription
**Compte :** Secrétariat (`secretariat@`) · **Où :** « Académique » > « Inscriptions » (`/v2/enrollments`)
1. Ouvrez « Liste des inscriptions ». Filtrez par Classe, Statut (« En attente », « Active »…), Financement, Mode, ou tapez un N° d'inscription (forme `DEMO-<programme>-<niveau>-0001`).
2. Ouvrez une inscription « En attente » (par exemple Elie SORO au secondaire). Sections : Résumé, « Confirmation et frais d'inscription » (politique affichée : « confirmée au paiement des frais d'inscription »), Financement (« Privé »), « Historique des classes », « Historique de l'inscription ».
3. Notez les boutons proposés : « Confirmer » et « Annuler ». Sur une inscription « Active » : « Suspendre », « Terminer », « Retirer l'élève », « Annuler », « Transférer ».
**Résultat attendu :** 12 inscriptions de démonstration (plus celles issues de l'admission ou de la maternelle) ; le message « L'inscription attend sa confirmation, selon la politique ci-dessus. » sur les inscriptions en attente ; le détail des frais n'est pas ici (« géré par le module Finance »).
- [ ] Filtres fonctionnels
- [ ] Statuts conformes à la graine (8 actives, 4 en attente au départ, à vérifier)
- [ ] Pas de bouton « Changer le financement » pour le secrétariat

#### C03.8 Inscrire un nouvel élève (assistant)
**Compte :** Secrétariat · **Où :** « Inscriptions » > « Nouvelle inscription » (`/v2/enrollments/new`)
1. Étape « Élève » : choisissez « Nouvel élève », saisissez Nom `ESSAI`, Prénoms `Marie`, Sexe « Féminin », Date de naissance `05/05/2014` (primaire : `2019`, supérieur : `2005`).
2. Étape « Classe » : Année (2026-2027, proposée), Classe `6e A`, Mode « Par classe (cursus complet) », Date d'inscription par défaut. Lisez « Effectif : x sur 40. La capacité est … ».
3. Étape « Financement » : « Privé ».
4. Étape « Récapitulatif » : lisez « Le dossier de l'élève sera créé, puis son inscription. » puis « Inscrire ».
**Résultat attendu :** écran « Inscription enregistrée » avec « N° d'inscription : DEMO-… Statut : en attente de confirmation » (aucun frais payé). Les boutons « Ouvrir l'inscription », « Inscrire un autre élève », « Retour à la liste » sont proposés.
- [ ] Élève et inscription créés ensemble
- [ ] Statut « en attente de confirmation » (politique de paiement)
- [ ] N° d'inscription au motif attendu

Cet élève de test sert aux scénarios suivants et au chapitre 4.

#### C03.9 Faire vivre une inscription : suspendre, reprendre, transférer, annuler
**Compte :** Secrétariat · **Où :** fiche de l'inscription de ESSAI Marie
1. Cliquez sur « Confirmer ». Selon la politique de paiement, le serveur peut refuser ou accepter la confirmation manuelle (à confirmer) ; notez le message.
2. Si l'inscription est « Active » : « Suspendre » (saisissez un motif) puis « Reprendre ». Le message « L'inscription est suspendue. » puis « L'inscription est reprise. » s'affiche.
3. « Transférer » vers la classe `6e B` (Date d'effet par défaut, Motif d'au moins 5 caractères). L'élève apparaît dans « Historique des classes » avec les deux placements. (À confirmer : une classe encore en « Brouillon » peut être refusée comme destination.)
4. Pour finir : « Annuler » avec un motif. Message « L'inscription est annulée. » (« L'annulation est définitive : le motif est conservé »).
**Résultat attendu :** chaque action écrit une ligne dans « Historique de l'inscription » avec son motif ; une annulation ne se défait pas.
- [ ] Suspension et reprise tracées
- [ ] Transfert conserve le même élève et ajoute un placement
- [ ] Annulation exige un motif et est définitive

#### C03.10 Changer le financement d'une inscription (direction)
**Compte :** Propriétaire ou directeur · **Où :** `/v2/enrollments`, une inscription active ou en attente
1. Ouvrez une inscription de démonstration, section « Financement », cliquez sur « Changer le financement ».
2. Choisissez « Bourse », ajoutez un Motif, « Enregistrer ». (Au secondaire, « Affecté par l'État » exige une Référence d'affectation et une Date de décision.)
**Résultat attendu :** « Le financement est modifié. » ; la ligne « Changement de financement » apparaît dans l'historique.
- [ ] Changement tracé avec motif
- [ ] Référence d'affectation exigée pour « Affecté par l'État » (message « La référence d'affectation est obligatoire pour ce financement. »)

#### C03.11 Paramètres académiques
**Compte :** Directeur des études · **Où :** « Paramètres académiques » (`/v2/academic/settings`)
1. Parcourez les rubriques : « Périodes » (types et plans de périodes), « Niveaux » (cycles et niveaux, niveau suivant), « Statuts et financements » (types de financement, issues de fin d'année), « Inscriptions » (politiques de confirmation), « Numérotation » (numéro d'inscription, matricules), « Calendrier ».
2. « Inscriptions » : la politique de confirmation des inscriptions est « Après paiement des frais d'inscription ».
3. « Numérotation » : modifiez le motif ou le préfixe et lisez l'aperçu de forme (le message précise que les numéros réels sont attribués par le serveur) ; ne l'enregistrez pas.
4. « Calendrier » : choisissez l'année 2026-2027, « Ajouter une date » (libellé `Fête de l'école`, Nature « Jour férié », un jour, cochez « Les cours sont suspendus ce jour-là »), enregistrez, puis « Supprimer » (confirmation « Supprimer cette date »).
**Résultat attendu :** les référentiels s'activent et se désactivent (jamais supprimés : « on les désactive ») ; le calendrier accepte et retire une date ; « Aucune date n'est fournie par défaut ».
- [ ] Six rubriques présentes
- [ ] Politique de confirmation conforme à la graine
- [ ] Ajout puis suppression d'une date du calendrier

#### C03.12 Offres de cours à la carte (enseignement supérieur)
**Compte :** Directeur des études sur `demo-superieur` (`etudes@demo-superieur.test`) · **Où :** « Offres de cours » (`/v2/academic/offerings`)
1. Sur `demo-secondaire` et `demo-primaire`, l'écran affiche « L'inscription à la carte n'est pas incluse dans l'offre de l'établissement. » : constatez-le.
2. Sur `demo-superieur`, choisissez la classe « Licence 1 A ». Aucune offre ne figure au départ (à confirmer) : « Aucune offre dans cette classe. »
3. « Ouvrir un semestre » : étapes « Période » (le semestre du curriculum), « Dates et inscriptions » (début, fin, ouverture et clôture des inscriptions, capacité), « Récapitulatif » (cochez ou non « Ouvrir immédiatement les offres »), puis « Ouvrir ».
**Résultat attendu :** message du type « N offres créées ; aucune déjà existante » ; les offres s'affichent avec fenêtre d'inscription et « Places prises » ; chaque offre propose « Ouvrir », « Démarrer », « Terminer », « Annuler » selon son état. Le serveur vérifie qu'un enseignant responsable est affecté et que le curriculum est publié.
- [ ] Message « non incluse » constaté au secondaire et au primaire
- [ ] Création des offres au supérieur (ou refus clairement expliqué)

#### C03.13 Reconduction annuelle : aperçu sans écriture
**Compte :** Propriétaire ou directeur · **Où :** « Reconduction annuelle » (`/v2/academic/rollover`)
1. Avant d'avoir créé l'année 2027-2028 (C03.2), l'écran affiche « Aucune année cible possible : créez d'abord l'année suivante (brouillon) dans « Années et périodes ». » : constatez-le si vous le pouvez.
2. Une fois l'année 2027-2028 créée : « Année source » = 2026-2027, « Année cible » = 2027-2028.
3. Étape « Éléments à reconduire » : cochez tout (Calendrier et périodes, Jours fériés et vacances, Curriculum des programmes, Classes, Offres de cours à la carte, Réinscriptions des élèves) ; l'option « Créer les classes de destination qui manquent » concerne les réinscriptions.
4. Étape « Aperçu » : « Ce que la reconduction ferait, calculé par le serveur sans rien écrire » : périodes, classes et curriculum « Sera cloné », réinscriptions par issue (Passage, Redoublement, Réorientation, Sortie), anomalies.
5. N'allez pas plus loin (ne cochez pas « J'ai vérifié l'aperçu »). Ouvrez « Historique des reconductions » (`/v2/academic/rollover/runs`).
**Résultat attendu :** aucune donnée créée ; des avertissements sont probables (par exemple « Décisions de passage manquantes », « Décision de fin d'année manquante » sur des réinscriptions : aucune décision de fin d'année n'est saisie dans la graine de base, à confirmer).
- [ ] Aperçu en lecture seule (« aucune donnée n'a été modifiée »)
- [ ] Anomalies et avertissements lisibles, avec lien « Ouvrir l'inscription » ou « Ouvrir la classe »
- [ ] Historique vide avant lancement

#### C03.14 Lancer la reconduction (Attention : action irréversible)
**Compte :** Propriétaire ou directeur, **un seul compte, en dernier** · **Où :** « Reconduction annuelle »
1. Reprenez l'assistant jusqu'à l'étape « Confirmation » : relisez Année source, Année cible, Étapes retenues.
2. Cochez « J'ai vérifié l'aperçu » (la reconduction crée des données dans l'année cible), puis « Lancer la reconduction ».
3. L'écran « Suivi de la reconduction » s'ouvre : état « En attente du worker » puis « En cours » puis « Terminée », progression par étape, rafraîchie toutes les 2 secondes.
4. Lisez le « Rapport de reconduction » : éléments créés, « Réinscriptions déjà présentes », anomalies à traiter.
5. Relancez l'assistant sur les mêmes années : l'aperçu indique « Déjà présents » pour ce qui existe et ne crée rien en double.
**Résultat attendu :** les périodes, curriculum (brouillon), classes de 2027-2028 sont créés ; aucune opération n'est annulable depuis l'écran ; en cas d'échec, « Relancer » reprend sans rien dupliquer.
- [ ] Exécution terminée, rapport affiché
- [ ] Rejeu sans doublon
- [ ] Le bouton « Lancer la reconduction » est inactif tant que la case n'est pas cochée

#### C03.15 Clore une période puis la rouvrir (Attention : action irréversible pour le directeur des études)
**Comptes :** Directeur des études puis directeur · **Où :** « Années et périodes » > périodes de l'année 2027-2028 (jamais celles de 2026-2027 de la démonstration)
1. Sur une période « Planifiée » de 2027-2028, cliquez sur « Ouvrir » (si l'écran refuse tant que l'année est « Brouillon », ouvrez d'abord l'année avec « Ouvrir »).
2. Cliquez sur « Clore les notes » (état « Notes closes »), puis « Clore » (état « Close »). **Aucune confirmation n'est demandée avant ces deux clics.**
3. Le directeur des études n'a plus de bouton pour revenir en arrière. Connectez-vous en `directeur@` (MFA) : sur la période close, « Rouvrir », saisissez un motif, validez.
**Résultat attendu :** « Les notes de la période … sont closes. », « La période … est close. », puis « La période … est rouverte. » ; le motif est conservé dans l'historique. Si les notes de la période ne sont pas toutes publiées, le serveur peut refuser la clôture avec un message.
- [ ] Deux temps (notes, puis période) respectés
- [ ] Seul le directeur (ou le propriétaire) voit « Rouvrir »
- [ ] Motif exigé à la réouverture

### 3.4 Cas limites et tests négatifs

#### C03.N1 Le directeur des études n'a pas les actes de direction
**Compte :** `etudes@` · **Où :** `/v2/academic/years`, `/v2/academic/rollover`
1. Sur l'année 2026-2027 « Ouverte » : vérifiez l'absence du bouton « Clôturer ».
2. Sur une période close : absence de « Rouvrir ».
3. Barre d'onglets : l'onglet « Reconduction » est absent. Saisissez l'adresse `/v2/academic/rollover`.
**Résultat attendu :** la page d'accès refusé s'affiche pour la reconduction ; aucun bouton « Clôturer » ni « Rouvrir ».
- [ ] « Clôturer » absent
- [ ] « Rouvrir » absent
- [ ] `/v2/academic/rollover` refusé

#### C03.N2 Année qui laisse un trou ou chevauche une autre
**Compte :** `etudes@` · **Où :** « Nouvelle année »
1. Créez une année `2029-2030` commençant le `01/09/2029` (il manque 2028-2029).
2. Créez une année `TEST` commençant le `01/12/2026` (chevauche 2026-2027).
**Résultat attendu :** dans les deux cas un message de refus s'affiche dans la boîte de dialogue ; aucune année n'est créée.
- [ ] Refus pour le trou
- [ ] Refus pour le chevauchement

#### C03.N3 Clôturer l'année alors que tout n'est pas clos
**Compte :** Propriétaire ou directeur · **Où :** « Années et périodes », année 2026-2027
1. Cliquez sur « Clôturer » (la boîte « Clôturer l'année Année scolaire 2026-2027 » rappelle que l'opération est sensible, journalisée et non annulable depuis cet écran). Saisissez un motif facultatif et confirmez.
**Résultat attendu :** le serveur refuse tant que toutes les périodes ne sont pas closes, qu'un curriculum reste à verrouiller ou qu'une offre est ouverte. L'année reste « Ouverte ». **Attention : action irréversible si elle réussissait ; ne tentez pas de forcer les conditions sur la démonstration.** Notez le message exact.
- [ ] Refus avec message explicite
- [ ] L'année reste « Ouverte » et « Courante »

#### C03.N4 Secrétariat : structure en lecture seule
**Compte :** `secretariat@` · **Où :** `/v2/academic/years`, `/v2/academic/settings`, `/v2/academic/programs`
1. Ouvrez chaque écran : aucun bouton « Nouvelle année », « Ajouter une période », « Nouveau programme ».
2. Dans « Paramètres académiques », lisez « Lecture seule : vous pouvez consulter ces paramètres mais pas les modifier. »
3. Saisissez `/v2/academic/rollover`.
**Résultat attendu :** consultation possible, aucune écriture proposée ; reconduction refusée.
- [ ] Aucun bouton d'écriture
- [ ] Bandeau « Lecture seule » dans les paramètres
- [ ] Reconduction refusée

#### C03.N5 Enseignant : aucun accès à la structure
**Compte :** `enseignant@` · **Où :** `/v2/academic/years`, `/v2/enrollments`, `/v2/enrollments/new`
1. Saisissez chacune de ces adresses.
**Résultat attendu :** page d'accès refusé pour les trois ; aucun menu « Académique ».
- [ ] Trois accès refusés

#### C03.N6 Inscrire deux fois le même élève dans la même classe
**Compte :** Secrétariat · **Où :** `/v2/enrollments/new`
1. Choisissez « Élève existant » : « Nadia DIABATE » (recherche par nom ou matricule), classe de l'année courante.
2. Un message annonce « Cet élève a déjà une inscription en cours cette année. … Le serveur refusera un doublon dans la même classe. » Tentez quand même d'inscrire.
**Résultat attendu :** refus affiché à l'étape finale ; aucune seconde inscription n'est créée.
- [ ] Avertissement affiché
- [ ] Refus du doublon

#### C03.N7 Saisies invalides dans l'assistant d'inscription
**Compte :** Secrétariat · **Où :** `/v2/enrollments/new`
1. Sans choisir de classe, cliquez sur « Continuer » : « Choisissez une classe. »
2. Cochez « Élève venant d'un autre établissement » sans remplir l'établissement d'origine : « Indiquez l'établissement d'origine. »
3. Au secondaire, choisissez le financement « Affecté par l'État » sans référence : « La référence d'affectation est obligatoire pour ce financement. »
4. Sur le transfert d'une inscription, saisissez un motif de 2 caractères : « Le motif doit comporter au moins 5 caractères. »
**Résultat attendu :** chaque erreur apparaît sous le champ concerné, sans perte des autres saisies.
- [ ] Les quatre messages sont affichés
- [ ] Rien n'est créé

#### C03.N8 Isolation entre établissements
**Compte :** Propriétaire des deux établissements, sur deux sous-domaines · **Où :** `/v2/enrollments/<identifiant>`
1. Connecté à `demo-secondaire`, ouvrez une inscription et copiez son identifiant dans l'adresse.
2. Connecté à `demo-primaire` (autre session), collez la même adresse.
**Résultat attendu :** la page répond comme si l'inscription n'existait pas (page introuvable ou message d'inscription inconnue) ; aucune donnée de l'autre établissement n'apparaît.
- [ ] Inscription de l'autre établissement introuvable

### 3.5 Problèmes connus et limites
- L'entrée de menu « Offres de cours » n'est proposée que si l'offre de l'établissement inclut l'inscription à la carte (supérieur) ; ailleurs l'écran affiche un message d'information (rapport QA M10 : appel refusé « fonctionnalité non incluse »).
- Les boutons « Clore les notes » et « Clore » d'une période n'ont pas de boîte de confirmation ; seule la clôture d'année en a une.
- La reconduction s'exécute en tâche de fond (état « En attente du worker » tant que le worker n'a pas pris la tâche).
- Les décisions de fin d'année ne sont pas saisies dans la graine de base : l'aperçu de reconduction signale des anomalies (comportement attendu en démonstration).
- Rapport QA (P1) : le nom de l'établissement et des entrées de menu conditionnées par une fonctionnalité peuvent manquer pour les rôles autres que propriétaire et directeur.
- Les packs Primaire et Secondaire utilisent des jeux de règles de DÉMONSTRATION (bandeau « règles de démonstration », filigrane « démonstration » sur les documents officiels) ; aucune règle officielle n'est inventée ici.
- Pas de création d'inscriptions en lot dans l'écran des inscriptions : voir l'import d'élèves (chapitre 5, colonne « Classe (code) »).

### 3.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 004 §9 : « clôture par classe » (état explicite d'une classe pour une période) : aucun écran dans la fiche de classe (seules les actions Activer, Terminer, Annuler la classe sont présentes) ; la clôture ne s'opère que par période d'année.
- Spec 004 §9 : « création d'inscriptions en lot » : pas d'écran dédié (passe par l'import 031).
- Spec 004 §9 : catalogue à la carte et « Mes inscriptions » côté étudiant : hors de ce chapitre (portail élève).
- Menu de l'API : l'entrée « Reconduction annuelle » et « Offres de cours » dépendent d'une fonctionnalité d'offre ; leur apparition selon le plan d'abonnement n'a pas été vérifiée dans le code d'abonnement (à confirmer).

---

## Chapitre 4. Élèves, tuteurs et personnel
> **Durée estimée :** 60 à 90 minutes · **Établissement(s) :** `demo-secondaire` (les noms sont identiques dans les trois établissements) · **Comptes :** secrétariat (`secretariat@`), directeur (`directeur@`) ou propriétaire (`direction.generale@`), directeur des études (`etudes@`), enseignant (`enseignant@`), parent (`parent@`), éducateur (`educateur@`). MFA : oui pour secrétariat, directeur, propriétaire, études ; non pour enseignant, parent, éducateur.

### 4.1 Objectif
Vérifier la gestion des dossiers permanents : élèves (identité, tuteurs, contacts d'urgence, parcours scolaire, statut, pièces), tuteurs et fratries, détection de doublons, personnel (fiche, qualifications, disponibilités, charge), affectations d'enseignement, invitations au portail. Vérifier que chaque rôle ne voit que son périmètre (le parent ne voit que ses enfants, l'enseignant que les élèves de ses classes).

### 4.2 Avant de commencer
- **Comptes** (connexion `http://demo-secondaire.localhost:3100/v2/login`) :
  - Secrétariat `secretariat@demo-secondaire.test` (MFA oui) : crée et modifie élèves et tuteurs, change le statut d'un élève, lit les champs sensibles, exporte la liste. Il n'a **pas** accès au personnel, ni à l'anonymisation.
  - Directeur `directeur@` / propriétaire `direction.generale@` (MFA oui) : tout, y compris personnel, contrats, statuts du personnel.
  - Directeur des études `etudes@` (MFA oui) : lit élèves, tuteurs et personnel ; gère les affectations et les disponibilités ; ne crée ni élève ni fiche de personnel, ne voit pas les contrats.
  - Enseignant `enseignant@` (Kouadio TRAORE, MFA non) : élèves de ses classes seulement (fiche réduite) ; sa propre fiche personnel.
  - Parent `parent@` (Séka DIABATE, MFA non) : « Mes enfants » (Nadia et Salimata DIABATE).
  - Éducateur `educateur@` (MFA non) : lecture des élèves, tuteurs et inscriptions.
  - Fichier des comptes : `.demo/credentials.md` ; code MFA : `pnpm demo:totp <e-mail>` (voir l'introduction).
- **Chemins de menu.** Module « Personnes » : « Élèves » (`/v2/students`), « Parents et tuteurs » (`/v2/guardians`), « Personnel » (`/v2/staff`), « Affectations » (`/v2/staff/assignments`). Barre d'onglets « Élèves et tuteurs » : « Élèves », « Nouvel élève » (`/v2/students/new`), « Tuteurs » ; pour le parent, « Mes enfants » (`/v2/students/children`). Barre « Personnel et affectations » : « Personnel », « Nouveau membre » (`/v2/staff/new`), « Affectations », « Mon espace » (`/v2/staff/me`). Fiches : `/v2/students/<id>`, `/v2/guardians/<id>`, `/v2/staff/<id>`.
- **Données de démonstration.**
  - 12 élèves (liste des noms au chapitre 3) ; fratries : Nadia et Salimata DIABATE (tuteur Séka DIABATE, `parent@`), Aya et Fatou BAMBA (Elie BAMBA), Moussa et Salimata COULIBALY (Mariam COULIBALY), Yao et Jean-Marc TOURE (Elie TOURE), Elie et Aya SORO (Ibrahim SORO), Koffi et Aya N'GUESSAN (Salimata N'GUESSAN). Naissance de Nadia DIABATE : 19/01/2014 (secondaire), 19/01/2019 (primaire), 19/01/2005 (supérieur).
  - Seul le tuteur Séka DIABATE a un compte du portail (« Compte actif ») ; les autres tuteurs sont « Sans compte ». Nadia DIABATE a aussi un compte élève (`eleve@`).
  - Personnel enseignant : Kouadio TRAORE (`enseignant@`, a un compte), Fatou YAO, Adjoua KOUAME. Les trois sont affectés à la classe de démonstration pour toutes les matières (Kouadio TRAORE comme « Responsable », « Titulaire de classe » au primaire ; les deux autres « Co-enseignant »).
- Tous les e-mails d'invitation sont locaux (aucun envoi réel) ; voir l'introduction pour retrouver le lien d'une invitation.
- **Élève de test** : ESSAI Marie, créée au scénario C04.4 ; les actions qui changent un statut se font sur elle, jamais sur les élèves de démonstration.

### 4.3 Scénarios

#### C04.1 Liste des élèves, recherche, filtres
**Compte :** Secrétariat · **Où :** « Personnes » > « Élèves » (`/v2/students`)
1. Lisez la liste : colonnes Élève, Matricule, Classe, Inscription, Statut.
2. Dans « Rechercher un élève », saisissez `DIABATE` : Nadia et Salimata DIABATE. Saisissez un matricule : la fiche correspondante. Saisissez `diabate` en minuscules et sans accent : même résultat.
3. Filtrez par Statut, Année, Classe ; cochez « Inclure les dossiers archivés ».
**Résultat attendu :** 12 élèves au moins ; aucun message « Aucun élève ne correspond » sur une recherche valide ; les élèves non inscrits affichent « Non inscrit ».
- [ ] Recherche insensible à la casse et aux accents
- [ ] Filtres fonctionnels
- [ ] Matricules uniques et inchangés d'un affichage à l'autre

#### C04.2 Fiche élève : identité, informations sensibles
**Compte :** Secrétariat · **Où :** fiche de Nadia DIABATE
1. Ouvrez la fiche. En-tête : « Matricule … », statut « Actif », « Classe actuelle : 6e A ».
2. Onglet « Identité » : « État civil » (Nom, Prénoms, Sexe, Date de naissance, Lieu de naissance) et « Coordonnées ». Les valeurs absentes affichent « Non renseigné ».
3. Dans « Informations sensibles », cliquez sur « Afficher les informations sensibles » (« Chaque consultation est journalisée ») : identifiant national, N° de l'acte de naissance, centre d'état civil. Cliquez sur « Masquer ».
4. « Modifier » : changez la Ville, « Enregistrer ».
**Résultat attendu :** « La fiche a été mise à jour. » ; les champs sensibles sont masqués par défaut.
- [ ] Champs sensibles masqués puis affichés à la demande
- [ ] Modification enregistrée
- [ ] Compte du portail de l'élève lisible (« Compte du portail »)

#### C04.3 Tuteurs et fratries
**Compte :** Secrétariat · **Où :** « Parents et tuteurs » (`/v2/guardians`)
1. Colonnes : Tuteur, Téléphone, E-mail, Enfants, Portail. Cherchez `DIABATE` : Séka DIABATE avec 2 enfants et « Compte actif ».
2. Ouvrez la fiche : « Coordonnées », « Compte du portail » ; section « Enfants liés » (Élève, Matricule, Classe) : Nadia et Salimata DIABATE.
3. Ouvrez la fiche d'un autre tuteur (Elie BAMBA) : « Aucun compte ».
4. Dans la fiche de Nadia DIABATE, onglet « Tuteurs » : le lien porte « Principal », « Urgence », « Financier », « Autorité » et « Portail ».
**Résultat attendu :** une personne tuteur de plusieurs élèves n'apparaît qu'une fois, avec tous ses enfants.
- [ ] Séka DIABATE : 2 enfants liés
- [ ] Les autres tuteurs sont « Sans compte »
- [ ] Les rôles du lien sont lisibles dans l'onglet « Tuteurs »

#### C04.4 Créer un élève avec son tuteur (assistant)
**Compte :** Secrétariat · **Où :** « Nouvel élève » (`/v2/students/new`)
1. Étape « Identité » : Nom `ESSAI`, Prénoms `Marie`, Sexe « Féminin » (obligatoire, aucune valeur par défaut), Date de naissance `05/05/2014` (primaire `2019`, supérieur `2005`). Continuez.
2. Étape « Tuteurs » : « Ajouter un tuteur existant », cherchez `Séka DIABATE`, choisissez un « Lien de parenté », laissez « Contact principal » et « Contact d'urgence » cochés. Continuez.
3. Étape « Récapitulatif » (« Le matricule est attribué automatiquement à la création. ») puis « Créer le dossier ».
4. Écran « Dossier créé » : « ESSAI Marie — matricule … ». Boutons « Ouvrir la fiche », « Inscrire maintenant ».
5. Allez sur la fiche de Séka DIABATE : 3 enfants.
**Résultat attendu :** dossier créé, tuteur lié, la fratrie compte 3 enfants. Connecté en parent (`parent@`), « Mes enfants » peut afficher ESSAI Marie si l'accès au portail du lien est coché (à confirmer).
- [ ] Matricule attribué
- [ ] Tuteur lié
- [ ] Fratrie à 3 enfants sur la fiche du tuteur

#### C04.5 Doublon probable
**Compte :** Secrétariat · **Où :** « Nouvel élève »
1. Saisissez Nom `DIABATE`, Prénoms `Nadia`, Sexe « Féminin », date de naissance `19/01/2014` (primaire `19/01/2019`, supérieur `19/01/2005`). Continuez.
2. Le message « 1 dossier ressemble à cette personne » apparaît avec la mention « Même nom et même date » ; boutons « Ouvrir la fiche » et « Ce n'est pas un doublon : créer quand même » (avec « Motif de la création »).
3. Changez le prénom en `Nadya` : le dossier est proposé comme « Nom proche ».
4. Cliquez sur « Ouvrir la fiche » : vous arrivez sur la fiche de Nadia DIABATE. **Ne créez pas le doublon.**
5. Dans l'étape « Tuteurs », « Ajouter un nouveau tuteur » `Séka DIABATE` : à la création, « Un tuteur similaire existe déjà (Séka DIABATE) : liez-le depuis la fiche de l'élève. »
**Résultat attendu :** la création est bloquée tant que l'avertissement n'est pas confirmé avec un motif ; le doublon est un avertissement humain (jumeaux possibles), pas une interdiction.
- [ ] Même nom et même date signalés (« Même nom et même date »)
- [ ] Nom proche signalé (« Nom proche »)
- [ ] Création bloquée sans confirmation et motif
- [ ] Doublon de tuteur signalé

#### C04.6 Statut d'un élève et historique
**Compte :** Secrétariat · **Où :** fiche de ESSAI Marie (élève de test uniquement)
1. Cliquez sur « Changer le statut » : choisissez « Suspendu », Date d'effet par défaut, « Changer le statut ». Message « Le statut a été modifié. »
2. Onglet « Statut » : « Historique des statuts » (Date d'effet, Changement, Motif).
3. Changez en « Actif » (retour).
4. Attention : action à effet durable. « Retiré », « Exclu » ou « Transféré » demandent un motif, retirent les inscriptions en cours et suspendent le compte du portail de l'élève ; un retour à « Actif » ne rétablit pas l'accès automatiquement. Faites-le sur ESSAI Marie seulement, à la fin.
**Résultat attendu :** chaque changement est inscrit dans l'historique avec auteur et motif ; aucun dossier n'est supprimé (statut « Archivé » possible).
- [ ] Changement tracé dans l'historique des statuts
- [ ] Statuts proposés : tous sauf le statut actuel
- [ ] Pas de bouton de suppression d'un dossier

#### C04.7 Contacts d'urgence : ajout par le secrétariat, correction par le parent
**Comptes :** Secrétariat puis parent · **Où :** onglet « Urgences » de Nadia DIABATE ; puis `/v2/students/children`
1. Secrétariat : « Ajouter un contact » : Nom du contact `Oncle ESSAI`, Lien avec l'élève `Oncle`, Téléphone `07 00 00 00 01`, Priorité `0` (appelé en premier). Message « Le contact a été ajouté. »
2. Parent (`parent@`) : « Mes enfants » > « Ouvrir la fiche » (Nadia DIABATE). La section « Contacts d'urgence » dit « Vous pouvez corriger les coordonnées des contacts d'urgence de votre enfant. » Cliquez sur « Corriger », changez le téléphone, « Enregistrer » : « Les coordonnées ont été mises à jour. »
3. Secrétariat : rechargez l'onglet « Urgences » : nouveau téléphone. Retirez le contact (« Retirer ») pour nettoyer.
**Résultat attendu :** les contacts d'urgence appartiennent à l'élève ; le parent ne peut corriger que les coordonnées, pas le lien ni la priorité (champs absents du formulaire de correction).
- [ ] Ajout visible dans les deux comptes
- [ ] Correction par le parent enregistrée
- [ ] Retrait possible par le secrétariat seulement

#### C04.8 Lier, modifier, clôturer un lien de tuteur ; inviter au portail
**Compte :** Secrétariat · **Où :** onglet « Tuteurs » de ESSAI Marie
1. « Lier un tuteur » : « Tuteur existant » `Elie BAMBA`, lien de parenté, droits (Contact principal, Contact d'urgence, Responsable financier, Autorité légale, Autorisé à récupérer l'enfant, Accès au portail parents). Note : « Autorité légale » et « Autorisé à récupérer l'enfant » sont faux par défaut. Message « Le tuteur est lié. »
2. « Modifier » le lien (message « Le lien est mis à jour. »).
3. « Inviter au portail » sur Elie BAMBA : « Invitation envoyée à Elie BAMBA. » (aucun e-mail réel : voir l'introduction).
4. « Clôturer le lien » : « Le lien est clos, jamais supprimé : il reste dans l'historique. » Le lien affiche « Clos le … ».
**Résultat attendu :** un seul contact principal par élève ; la clôture conserve l'historique.
- [ ] Lien créé avec les droits choisis
- [ ] Invitation enregistrée
- [ ] Lien clôturé, toujours visible dans l'historique

#### C04.9 Antécédents scolaires et pièces du dossier
**Compte :** Secrétariat · **Où :** onglets « Parcours scolaire » et « Pièces » de ESSAI Marie
1. « Parcours scolaire » : « Inscriptions » (liste), « Antécédents scolaires » ; « Ajouter un antécédent » (Nature « Scolarité », Intitulé `École primaire test`, Établissement, Année scolaire). Message « L'antécédent a été ajouté. » puis « Retirer ».
2. « Pièces » : « Déposer une pièce » (type « Acte de naissance », un PDF, JPEG, PNG ou WebP de 8 Mo au plus, échéance facultative). Redéposez le même type : « Remplacer la pièce existante » crée « Version 2 » ; « Retirer » demande un motif.
**Résultat attendu :** « La pièce « … » est déposée. » ; chaque consultation de pièce est journalisée (« Chaque consultation de ces pièces est enregistrée dans le journal d'audit »). Si le stockage de fichiers n'est pas disponible, un message l'indique (à confirmer).
- [ ] Antécédent ajouté puis retiré
- [ ] Pièce déposée, remplacée (Version 2), retirée avec motif
- [ ] Format non accepté refusé (essayez un fichier `.txt`)

#### C04.10 Exporter la liste des élèves
**Compte :** Secrétariat · **Où :** `/v2/students`
1. Cliquez sur « Exporter (CSV) ».
**Résultat attendu :** un fichier CSV est téléchargé (liste limitée à 5 000 lignes) ; l'export est journalisé. Le bouton n'existe pas pour l'éducateur ni l'enseignant.
- [ ] Fichier CSV téléchargé et ouvrable
- [ ] Bouton absent pour les rôles sans droit d'export

#### C04.11 Parent : « Mes enfants »
**Compte :** `parent@` · **Où :** « Mes enfants » (`/v2/students/children`)
1. La liste « Mes enfants » affiche Nadia et Salimata DIABATE (et ESSAI Marie si liée avec accès au portail).
2. « Ouvrir la fiche » : résumé (Classe, Date de naissance, N° d'inscription), Tuteurs, Contact principal, Contacts d'urgence, Inscriptions.
**Résultat attendu :** « Vous ne voyez que vos propres enfants ».
- [ ] Exactement les enfants liés
- [ ] Aucun accès aux fiches d'autres élèves

#### C04.12 Liste et fiche du personnel
**Compte :** Directeur (`directeur@`) · **Où :** « Personnes » > « Personnel » (`/v2/staff`)
1. Lisez la liste : Nom, Matricule, Catégorie, Fonction, Charge prévue, Statut (« En poste »). Cherchez `TRAORE`.
2. Filtres : Catégorie, Statut, « Enseigne » (« Peut enseigner »), Année (charge).
3. Ouvrez Kouadio TRAORE. Onglets : « Identité » (compte du portail lié), « Contrats », « Qualifications », « Compétences », « Disponibilités », « Charge horaire », « Historique ».
4. « Charge horaire » : année 2026-2027, affectations (Classe, Rôle, Portée, Heures prévues, Période).
**Résultat attendu :** trois enseignants ; les contrats « ne portent ni tarif ni salaire : la rémunération relève du module Paie ».
- [ ] Trois enseignants listés (Kouadio TRAORE, Fatou YAO, Adjoua KOUAME)
- [ ] Onglets conformes
- [ ] Charge et affectations lisibles

#### C04.13 Créer un membre du personnel, contrat, qualification, disponibilités, statut
**Compte :** Directeur · **Où :** « Nouveau membre » (`/v2/staff/new`)
1. Saisissez l'identité (Nom `ESSAI`, Prénoms `Paul`, Sexe, naissance), « Catégorie » (une catégorie enseignante ; libellés à confirmer), « Intitulé du poste » `Professeur de test`, « Date d'embauche ». « Créer la fiche ».
2. « Fiche créée : ESSAI Paul — matricule … » puis « Ouvrir la fiche ».
3. « Inviter au portail » (« L'invitation a été envoyée. »).
4. Onglet « Contrats » > « Ajouter un contrat » ; « Qualifications » > « Ajouter une qualification » avec une échéance proche (une alerte « arrive à échéance » apparaît dans la liste) ; « Disponibilités » > « Ajouter un créneau » (« Indisponible », lundi) puis « Retirer ».
5. « Changer le statut » > « En congé », puis « En poste ». Attention : « Parti » met fin aux affectations en cours ; à faire sur ESSAI Paul seulement.
**Résultat attendu :** chaque ajout est confirmé par un message ; l'historique des statuts se remplit.
- [ ] Fiche et matricule créés
- [ ] Contrat, qualification, disponibilité ajoutés
- [ ] Changement de statut tracé

#### C04.14 Affectations d'enseignement
**Compte :** Directeur des études · **Où :** « Personnes » > « Affectations » (`/v2/staff/assignments`)
1. Onglet « Par classe » : choisissez la classe de démonstration. La matrice (« matière par rôle d'enseignement ») s'affiche ; le bandeau indique « Toutes les matières ont un responsable » (enseignants généralistes affectés) ou le nombre de matières sans responsable.
2. Onglet « Par enseignant » : choisissez Kouadio TRAORE : charge et affectations.
3. Si vous avez créé la classe `6e B` (chapitre 3) : « Affecter » ESSAI Paul comme « Responsable » sur une matière (ou « Désigner » un titulaire), puis « Terminer » l'affectation (« L'affectation reste dans l'historique »).
**Résultat attendu :** un seul responsable actif par matière et par période ; une matière sans responsable bloque l'ouverture de l'offre correspondante.
- [ ] Matrice lisible
- [ ] Affectation créée puis terminée, conservée dans l'historique

#### C04.15 L'enseignant : « Mon espace » et élèves de ses classes
**Compte :** `enseignant@` · **Où :** « Mon espace » (`/v2/staff/me`) et `/v2/students`
1. « Mon espace » : Matricule, Fonction, Embauché le, « Mes classes ».
2. Ouvrez `/v2/students` : seuls les élèves de sa classe sont listés. Ouvrez une fiche : « Fiche réduite : vous voyez les informations nécessaires à votre classe, sans coordonnées ni historique complet. » Les onglets « Tuteurs », « Parcours scolaire », « Statut », « Pièces » sont absents.
**Résultat attendu :** périmètre limité à ses classes ; aucun bouton « Modifier », « Changer le statut », « Inscrire ».
- [ ] Mes classes affichées
- [ ] Fiche réduite constatée

### 4.4 Cas limites et tests négatifs

#### C04.N1 Création sans sexe, date de naissance incohérente
**Compte :** Secrétariat · **Où :** « Nouvel élève »
1. Laissez « Sexe » sur « Choisir… » et continuez.
2. Saisissez une date de naissance dans le futur.
**Résultat attendu :** message d'erreur sous le champ ; aucun dossier créé. Le sexe n'a aucune valeur par défaut.
- [ ] Sexe obligatoire
- [ ] Date de naissance implausible refusée

#### C04.N2 Sortie sans motif
**Compte :** Secrétariat · **Où :** « Changer le statut » de ESSAI Marie
1. Choisissez « Retiré » sans motif et validez.
**Résultat attendu :** refus (« Obligatoire pour une sortie ») ; le statut ne change pas.
- [ ] Refus sans motif

#### C04.N3 Rôles sans droits
**Comptes :** `secretariat@`, `etudes@`, `enseignant@`, `educateur@`
1. Secrétariat : saisissez `/v2/staff` : page d'accès refusé.
2. Études : `/v2/students/new` refusé ; sur `/v2/staff`, pas de « Nouveau membre » ni d'onglet « Contrats ».
3. Enseignant : `/v2/guardians` refusé ; pas de « Nouvel élève ».
4. Éducateur : liste et fiche des élèves lisibles ; aucun bouton « Modifier », « Changer le statut », « Exporter (CSV) ».
**Résultat attendu :** chaque refus affiche la page d'accès refusé ; les boutons d'écriture n'apparaissent pas.
- [ ] Secrétariat sans personnel
- [ ] Études sans création ni contrats
- [ ] Enseignant sans tuteurs
- [ ] Éducateur en lecture seule

#### C04.N4 Le parent ne voit pas les enfants des autres
**Comptes :** Secrétariat puis `parent@`
1. Secrétariat : ouvrez la fiche de Aya BAMBA et copiez son identifiant dans l'adresse.
2. Parent : saisissez `/v2/students/children/<identifiant copié>`.
**Résultat attendu :** la page répond comme si l'élève n'existait pas ; aucune information n'apparaît.
- [ ] Élève d'une autre famille introuvable

#### C04.N5 Isolation entre établissements
**Compte :** Secrétariat des deux établissements
1. Dans `demo-secondaire`, copiez l'identifiant d'un élève. Dans `demo-primaire` (autre sous-domaine), ouvrez `/v2/students/<identifiant>`.
**Résultat attendu :** la page répond comme si l'élève n'existait pas.
- [ ] Élève de l'autre établissement introuvable

#### C04.N6 Enseignant et élèves hors de ses classes
**Compte :** `enseignant@demo-primaire.test` (instituteur) · **Où :** `/v2/students/<identifiant>`
1. Avec le secrétariat du primaire, copiez l'identifiant d'un élève de la maternelle. Avec l'instituteur, ouvrez cette adresse.
**Résultat attendu :** la page répond comme si l'élève n'existait pas (périmètre : ses classes seulement).
- [ ] Élève hors de ses classes introuvable

### 4.5 Problèmes connus et limites
- **Anonymisation d'un dossier archivé (droit à l'effacement)** : la permission existe et l'action est prévue par la spec 008, mais **aucun écran ne la propose** dans l'application (seule l'anonymisation des dossiers d'admission a un écran). Ne la testez pas.
- **Paramètres des personnes** (motifs de matricule, conservation, contrôle des doublons) : l'entrée de menu « Paramètres des personnes » n'a pas d'écran et est masquée. Les motifs de matricule et la détection de doublons se règlent dans « Paramètres académiques » > « Numérotation » (pour les rôles qui ont ce droit).
- Fusion de dossiers en doublon : hors périmètre de cette version.
- Rapport QA : `GET /people/me/student` répond une erreur quand le compte n'a pas de profil élève (propriétaire, etc.) ; sans conséquence visible sur les écrans de ce chapitre.
- Rapport QA : des appels web dépassent les droits du rôle (liste d'années pour l'éducateur et l'enseignant sur `/v2/students`) ; des filtres peuvent rester vides pour ces rôles.
- Les comptes liés (portail) des élèves et du personnel sont pour la plupart absents dans la démonstration (« Aucun compte ») : seul Séka DIABATE, Nadia DIABATE et Kouadio TRAORE en ont un.
- Les invitations ne partent pas par e-mail : voir l'introduction.

### 4.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 008 AC3.6 / §9 : anonymisation d'un élève (`student.anonymize`) sans écran ; spec 008 §9 « Paramètres des personnes » sans écran (4 entrées de menu sans écran v2 signalées par le rapport QA).
- Spec 008 §9 « Mon dossier (élève) » : hors de ce chapitre (`/v2/student/me`).
- Spec 009 : « portail enseignant » présent sous la forme « Mon espace » ; le détail de la charge annuelle (« Le volume hebdomadaire n'est pas converti en année » si le nombre de semaines n'est pas configuré) dépend d'un réglage non vérifié ici.
- Libellés des catégories de personnel (liste de référence) non relevés dans le code : à confirmer lors du test.

---

## Chapitre 5. Imports de masse (CSV / Excel)
> **Durée estimée :** 45 à 60 minutes · **Établissement(s) :** `demo-secondaire` (parcours complet) ; `demo-primaire` et `demo-superieur` pour comparer · **Comptes :** secrétariat (`secretariat@`), directeur des études (`etudes@`), directeur (`directeur@`) ou propriétaire (`direction.generale@`), économe (`econome@`), enseignant (`enseignant@`). MFA : oui pour secrétariat, études, directeur, propriétaire, économe ; non pour l'enseignant.

### 5.1 Objectif
Vérifier l'assistant d'import : téléchargement des modèles de fichier, envoi d'un fichier, association des colonnes, validation, aperçu sans écriture, exécution après confirmation, rapport d'erreurs, annulation. Vérifier que chaque rôle ne peut lancer que les imports de son métier.

### 5.2 Avant de commencer
- **Comptes** (connexion `http://demo-secondaire.localhost:3100/v2/login`) :
  - Secrétariat `secretariat@demo-secondaire.test` : peut lancer les imports « Élèves » et « Parents et tuteurs ». C'est lui qui a préparé l'import de démonstration.
  - Directeur des études `etudes@demo-secondaire.test` : peut lancer « Classes » et « Matières et curriculum ».
  - Directeur / propriétaire : tous les imports, voir et annuler ceux des autres, régler les plafonds, modèles de colonnes. Le lancement des « Soldes financiers d'ouverture » exige une authentification renforcée (MFA).
  - Économe `econome@demo-secondaire.test` : peut préparer un import (envoyer, associer, valider, prévisualiser) mais pas le lancer (à confirmer : ce que l'écran propose).
  - Enseignant : aucun accès aux imports.
  - Fichier des comptes : `.demo/credentials.md` ; code MFA : `pnpm demo:totp <e-mail>`.
- **Chemin de menu.** Module « Imports » > « Imports Excel / CSV » (`/v2/imports`). Barre d'onglets « Imports Excel et CSV » : « Historique », « Nouvel import » (`/v2/imports/new`), « Modèles » (`/v2/imports/templates`), « Paramètres » (`/v2/imports/settings`, réservé à qui administre les imports). Un import précis s'ouvre sous `/v2/imports/<identifiant>`.
- **Fichiers modèles.** Ils sont aussi écrits sur la machine de démonstration dans le dossier `.demo/import-templates/`, un sous-dossier par établissement (`demo-secondaire`, `demo-primaire`, `demo-superieur`), sous les noms `modele-students.csv`, `modele-students.xlsx`, `modele-guardians.csv`, `modele-staff.csv`, `modele-classrooms.csv`, `modele-curriculum.csv`, `modele-grades.csv`, `modele-opening_balances.csv` (et leurs versions `.xlsx`). Ne lisez que ces modèles ; ils contiennent des lignes d'exemple fictives. Le CSV utilise le point-virgule et s'ouvre dans Excel ou LibreOffice ; le modèle Excel a une feuille d'aide.
- **Import de démonstration prêt à exécuter.** Dans l'historique, vous trouvez « eleves-demonstration.csv » (type « Élèves »), état « Prêt à importer », 15 lignes fictives : élèves BEUGRE Aurélie, DJEDJE Boris, GOULI Clarisse, KACOU Dimitri, LAGO Edwige, MOBIO Franck, NIAMKE Gisèle, OBOU Hamed, PAPI Irène, SAHI Josué, TAGRO Laure, UBA Marcel, VEI Nadège, WOGNIN Olivier, ZEBIE Prisca ; matricules d'origine `IMP-0001` à `IMP-0015` ; chacun est rattaché à la classe de démonstration (code `6E-A`, `CP1-A` ou `L1-A`) avec le financement « PRIVATE ». Le fichier a été envoyé par le compte secrétariat : seul ce compte (ou la direction) le voit.
- **Ordre conseillé.** Les scénarios C05.1 à C05.5 ne créent rien. C05.6 exécute l'import de démonstration et crée 15 élèves et 15 inscriptions : à faire en dernier et avec un seul compte (`pnpm demo:reset` remet tout à zéro).

### 5.3 Scénarios

#### C05.1 Historique et import prêt à exécuter
**Compte :** Secrétariat · **Où :** « Imports Excel / CSV » > « Historique » (`/v2/imports`)
1. Lisez le tableau : Fichier, Données, État, Lignes, Durée, Date.
2. Repérez « eleves-demonstration.csv », Données « Élèves », État « Prêt à importer », « 15 ligne(s) ».
3. Utilisez les filtres « Type de données » et « État ».
**Résultat attendu :** un import « Prêt à importer » est présent ; le bouton « Nouvel import » est proposé.
- [ ] Import de démonstration présent, 15 lignes
- [ ] Filtres fonctionnels

#### C05.2 Aperçu de l'import prêt (aucune écriture)
**Compte :** Secrétariat · **Où :** clic sur « eleves-demonstration.csv »
1. L'assistant s'ouvre à l'étape « 4. Erreurs et aperçu avant import ». La liste des étapes en tête : Fichier, Colonnes, Validation, Aperçu, Import, Rapport.
2. Lisez les compteurs « À créer », « À mettre à jour », « À ignorer », « En erreur », « Avertissements ». Attendu : 15 à créer, 0 en erreur (les avertissements, s'il y en a, sont listés dans « Problèmes les plus fréquents »).
3. Dépliez « Lignes qui seront créées » : numéros de ligne et premières valeurs.
4. Lisez « Aucune erreur : toutes les lignes sont valides. » et « Cet aperçu n'écrit rien : les données ne seront créées qu'après votre confirmation ci-dessous. »
5. Ne lancez rien. Dans « Mode d'import », constatez « Importer les lignes valides seulement » (choisi) et « Tout ou rien ».
**Résultat attendu :** aucune donnée n'est créée par la consultation (vérifiez : la liste des élèves ne compte pas encore les 15 nouveaux).
- [ ] 15 lignes à créer, 0 en erreur
- [ ] Mention « n'écrit rien » visible
- [ ] Aucun nouvel élève dans `/v2/students`

#### C05.3 Télécharger les modèles
**Compte :** Secrétariat · **Où :** « Modèles » (`/v2/imports/templates`)
1. Section « Modèles de fichier » : boutons « Modèle Excel : Élèves » et « Modèle CSV : Élèves » (idem pour les autres importeurs disponibles pour votre compte).
2. Téléchargez les deux et ouvrez-les : colonnes attendues (« Matricule d'origine », « Nom », « Prénoms », « Sexe », « Date de naissance », « Lieu de naissance », « Nationalité (code pays) », « N° national », « N° acte de naissance », « E-mail », « Téléphone », « Téléphone secondaire », « Adresse », « Ville », « Résidence », « Classe (code) », « Financement (code) », « Référence d'affectation »), deux lignes d'exemple fictives, feuille d'aide dans le modèle Excel.
3. Section « Modèles de mapping enregistrés » : « Aucun modèle enregistré. » au départ.
**Résultat attendu :** les fichiers téléchargés correspondent aux colonnes affichées à l'étape « Fichier » ; les lignes d'exemple sont fictives (KONE Aminata, TRAORE Ibrahim).
- [ ] Modèles Excel et CSV téléchargés
- [ ] Colonnes obligatoires : Nom, Prénoms, Sexe

#### C05.4 Importer un fichier avec erreurs : aperçu et rapport d'erreurs
**Compte :** Secrétariat · **Où :** « Nouvel import » (`/v2/imports/new`)
1. Créez un fichier `essai-eleves.csv` (séparateur point-virgule, par exemple avec le Bloc-notes, encodage UTF-8) :
   ```
   Matricule d'origine;Nom;Prénoms;Sexe;Date de naissance;Classe (code)
   TEST-001;ALPHA;Anne;F;12/03/2014;6E-A
   TEST-002;BETA;Boris;M;2014-07-21;6E-A
   TEST-003;GAMMA;Carine;;05/05/2014;6E-A
   ```
   (Primaire : classe `CP1-A` et années 2019 ; supérieur : `L1-A` et années 2005.) La troisième ligne n'a pas de sexe.
2. Étape « 1. Choisir l'importeur et envoyer le fichier » : choisissez « Élèves » (la carte montre le texte « Identité, matricule d'origine, naissance, contacts ; inscription et financement en option. »). La liste « Colonnes attendues pour « Élèves » » indique les colonnes « (obligatoire) ». Choisissez le fichier, laissez « Feuille (facultatif) » vide, « Envoyer et continuer ».
3. Étape « 2. Associer les colonnes du fichier » : la proposition automatique associe chaque colonne ; vérifiez, puis dans « Options de l'import » gardez « Ignorer les lignes déjà présentes » et, pour « Doublons probables », « Refuser (recommandé) ». Cliquez sur « Enregistrer et valider le fichier ».
4. Étape « 3. Validation du fichier en cours » (barre de progression), puis l'étape « 4. Erreurs et aperçu avant import ».
5. Lisez : À créer 2, En erreur 1. Dans « Erreurs du fichier », la ligne 3 est signalée (colonne « Sexe »). Téléchargez « Télécharger les erreurs (CSV) » et « Télécharger les erreurs (Excel) ».
6. Constatez que le mode « Tout ou rien » est grisé avec « Indisponible tant que le fichier contient des erreurs. »
7. Ne lancez pas cet import : quittez la page. Il reste « Prêt à importer » dans l'historique ; vous pouvez le rouvrir via le lien proposé en bas (« Vous pouvez quitter cette page : l'import est conservé. »).
**Résultat attendu :** les lignes valides sont acceptées, la ligne sans sexe est refusée avec un message par colonne ; aucune écriture.
- [ ] Étapes et titres conformes
- [ ] 2 lignes valides, 1 en erreur (ligne 3, colonne « Sexe »)
- [ ] Erreurs téléchargeables en CSV et Excel
- [ ] « Tout ou rien » indisponible

#### C05.5 Modèle du fichier non adapté : erreurs de classe
**Compte :** Secrétariat · **Où :** « Nouvel import »
1. Envoyez le modèle CSV « Élèves » téléchargé tel quel (ses deux lignes d'exemple utilisent la classe `6EME_A`, qui n'existe pas dans la démonstration).
2. Suivez l'assistant jusqu'à l'aperçu.
**Résultat attendu :** les lignes d'exemple sont signalées en erreur sur la colonne « Classe (code) » (à confirmer : texte exact du message) ; remplacez `6EME_A` par le code réel de votre classe et renvoyez le fichier : les lignes passent en « À créer ».
- [ ] Classe inconnue signalée par ligne
- [ ] Après correction du code, plus d'erreur

#### C05.6 Exécuter l'import de démonstration (Attention : action irréversible)
**Compte :** Secrétariat, **un seul compte, en dernier** · **Où :** « eleves-demonstration.csv » > étape « Erreurs et aperçu avant import »
1. Dans « Lancer l'import », constatez que « Lancer l'import » est inactif tant que la case « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. » n'est pas cochée.
2. Mode « Importer les lignes valides seulement » (choisi). Cochez la case, cliquez sur « Lancer l'import ».
3. L'écran « Import en cours » montre « Lignes traitées » et les décomptes en direct (Créées, Mises à jour, Ignorées, En erreur) ; état « En attente de traitement » puis « Import en cours ». Vous pouvez quitter la page : l'import continue.
4. À la fin, le rapport : « Import terminé », « Décomptes de l'import » (Créées 15), « Détails de l'import » (Fichier, Données « Élèves », Auteur, Début, Durée, Mode « Lignes valides seulement »).
5. Ouvrez `/v2/students` : recherchez `BEUGRE`. Ouvrez la fiche : inscrit dans la classe, inscription « En attente » (la politique de confirmation attend le paiement des frais). Le N° d'inscription suit le motif de l'établissement.
6. Téléchargez « Télécharger le rapport (Excel) » et « (CSV) ».
**Résultat attendu :** 15 élèves et 15 inscriptions créés ; l'effectif de la classe augmente de 15 ; l'opération est inscrite dans l'historique. Un import terminé ne s'annule pas.
- [ ] Case de confirmation obligatoire
- [ ] 15 créées, 0 en erreur
- [ ] Élèves visibles dans la liste, inscrits dans la classe
- [ ] Rapport téléchargeable

#### C05.7 Rejouer un fichier : aucun doublon
**Compte :** Secrétariat · **Où :** « Nouvel import » (après C05.6)
1. Créez un fichier d'une ligne reprenant un élève déjà importé :
   ```
   Matricule d'origine;Nom;Prénoms;Sexe;Date de naissance;Classe (code)
   IMP-0001;BEUGRE;Aurélie;F;03/01/2012;6E-A
   ```
2. Suivez l'assistant avec « Ignorer les lignes déjà présentes ».
**Résultat attendu :** aperçu « À ignorer » : 1, « À créer » : 0 ; rejouer un fichier ne change rien. Avec « Mettre à jour les lignes déjà présentes », la ligne serait « À mettre à jour » (les champs absents du fichier ne sont jamais effacés).
- [ ] Ligne reconnue comme déjà présente (À ignorer 1)
- [ ] Aucun élève en double dans la liste

#### C05.8 Les importeurs disponibles selon le rôle
**Comptes :** Études, secrétariat, directeur · **Où :** « Nouvel import » > « Quelles données importer ? »
1. Études : les cartes « Classes » et « Matières et curriculum » sont utilisables ; les autres sont grisées avec le texte « Droits manquants : … ».
2. Secrétariat : « Élèves » et « Parents et tuteurs » utilisables.
3. Directeur : toutes les cartes ; « Soldes financiers d'ouverture » porte le badge « Authentification renforcée » ; le lancement demande une confirmation d'identité par code MFA.
4. Cliquez sur une carte : la liste des colonnes attendues s'affiche (colonnes marquées « (obligatoire) » : Élèves = Nom, Prénoms, Sexe ; Parents et tuteurs = Nom du tuteur, Prénoms du tuteur, Lien de parenté, plus la colonne « Matricule de l'élève » qui rattache le tuteur à son élève ; Enseignants et personnel = Nom, Prénoms, Catégorie ; Classes = Code de la classe, Nom de la classe, Programme (code), Niveau (code) ; Matières et curriculum = Code du noeud, Libellé, Type de noeud (code) ; Soldes d'ouverture = Référence, Matricule de l'élève, Montant (FCFA)). Comparez avec ce que l'écran affiche, qui fait foi.
**Résultat attendu :** sept importeurs au total ; chaque rôle ne peut choisir que ceux dont il a le droit (droit d'importer **et** droit de créer la donnée dans le module visé).
- [ ] Cartes grisées pour les droits manquants
- [ ] Sept importeurs côté direction
- [ ] Badge « Authentification renforcée » sur les soldes

#### C05.9 Annuler un import en cours
**Compte :** Secrétariat ou direction · **Où :** écran « Import en cours »
1. Pendant l'exécution, cliquez sur « Annuler l'import », puis « Oui, annuler l'import ».
**Résultat attendu :** « Annulation demandée : l'import s'arrête entre deux lignes. » ; état final « Annulé » ; « Les lignes déjà écrites sont conservées » en mode lignes valides.
Limite : avec les fichiers de test (quelques lignes) l'import se termine en une seconde et le bouton n'est pas visible assez longtemps. Pour tester l'annulation, il faudrait un fichier de plusieurs milliers de lignes (plafond « Lignes par fichier » de « Paramètres ») : ce test est facultatif.
- [ ] Bouton d'annulation proposé pendant l'exécution (ou test non réalisé, à noter)

#### C05.10 Enregistrer un modèle de mapping, l'utiliser, le supprimer
**Compte :** Directeur · **Où :** étape « 2. Associer les colonnes du fichier », puis « Modèles »
1. Dans un nouvel import, cochez « Enregistrer ce mapping comme modèle », nommez-le `Modèle élèves essai`, validez.
2. Ouvrez « Modèles » : le modèle figure sous « Modèles de mapping enregistrés » (Nom, Données, Champs associés, Modifié le).
3. Lors d'un nouvel import avec des en-têtes semblables, le modèle est proposé automatiquement (« Appliquer un modèle enregistré »).
4. « Supprimer » puis « Confirmer la suppression ».
**Résultat attendu :** « Un modèle est proposé automatiquement quand les en-têtes d'un nouveau fichier lui ressemblent. »
- [ ] Modèle enregistré et listé
- [ ] Proposé à l'import suivant
- [ ] Supprimé après confirmation

#### C05.11 Paramètres des imports
**Compte :** Directeur · **Où :** « Paramètres » (`/v2/imports/settings`)
1. Lisez les plafonds : Lignes par fichier, Colonnes par fichier, Taille du fichier (Mo), Lignes par lot d'écriture, Lignes en mode « tout ou rien », Imports actifs en même temps, Imports par 24 heures, Conservation des valeurs du fichier (jours). Chaque champ indique son maximum.
2. Saisissez une valeur hors limites : « Entrez un nombre entier entre … et … ». Ne modifiez pas les valeurs.
**Résultat attendu :** les limites du produit ne sont pas modifiables ; le plafond « tout ou rien » ne peut pas dépasser le nombre maximal de lignes.
- [ ] Champs et maxima visibles
- [ ] Valeur hors limites refusée

### 5.4 Cas limites et tests négatifs

#### C05.N1 Études : l'import d'élèves lui est fermé
**Compte :** `etudes@` · **Où :** « Nouvel import »
1. Constatez que la carte « Élèves » est grisée (« Droits manquants : … »).
2. Ouvrez l'historique : l'import « eleves-demonstration.csv » du secrétariat n'y figure pas.
**Résultat attendu :** on ne voit pas les imports des autres utilisateurs sans le droit d'administration des imports ; connecté en directeur, ils apparaissent tous.
- [ ] Carte « Élèves » grisée
- [ ] Import d'un autre utilisateur absent de l'historique
- [ ] Visible pour le directeur

#### C05.N2 Enseignant : aucun import
**Compte :** `enseignant@` · **Où :** `/v2/imports`, `/v2/imports/new`
**Résultat attendu :** page d'accès refusé ; aucun menu « Imports ».
- [ ] Deux accès refusés

#### C05.N3 Secrétariat : pas de paramètres, pas d'import d'un autre
**Compte :** `secretariat@` · **Où :** `/v2/imports/settings`
1. Saisissez l'adresse : accès refusé ; l'onglet « Paramètres » est absent.
2. Copiez l'adresse d'un import vu par le directeur (identifiant) et ouvrez-la avec `etudes@` : l'import répond comme s'il n'existait pas.
**Résultat attendu :** refus d'accès pour les réglages ; import d'un autre introuvable.
- [ ] Paramètres refusés
- [ ] Import d'un autre introuvable

#### C05.N4 Fichier invalide ou colonne obligatoire non associée
**Compte :** Secrétariat · **Où :** « Nouvel import »
1. Envoyez un fichier sans importeur choisi : « Choisissez le type de données à importer. »
2. Sans fichier : « Choisissez un fichier .xlsx ou .csv. »
3. Envoyez un fichier d'un autre format (`.txt` ou `.pdf`, en choisissant « Tous les fichiers » dans la fenêtre) : un message d'erreur s'affiche (texte à noter).
4. À l'étape des colonnes, mettez « Nom » sur « — Ne pas importer ce champ — » : « Associez une colonne à ce champ obligatoire. »
**Résultat attendu :** aucun import créé pour les cas 1 à 3 ; l'enchaînement est bloqué pour le cas 4.
- [ ] Messages 1, 2 et 4 constatés
- [ ] Format invalide refusé (message : ______)

#### C05.N5 Lancer sans confirmer, ou sans ligne valide
**Compte :** Secrétariat · **Où :** aperçu d'un import
1. Sans cocher la case, essayez « Lancer l'import » : bouton inactif.
2. Sur un fichier dont toutes les lignes sont en erreur : le bouton reste inactif (aucune ligne à traiter).
**Résultat attendu :** aucune écriture sans confirmation explicite.
- [ ] Lancement impossible sans case cochée
- [ ] Lancement impossible sans ligne valide

#### C05.N6 Économe : préparer seulement
**Compte :** `econome@` · **Où :** « Nouvel import »
1. Constatez quelles cartes sont utilisables. Si une carte est utilisable, envoyez un fichier jusqu'à l'aperçu et essayez de lancer : un refus est attendu (le lancement relève de la direction).
**Résultat attendu :** aucun import ne s'exécute ; le message de refus est lisible (à confirmer : comportement exact de l'écran).
- [ ] Aucun lancement possible pour l'économe

#### C05.N7 Enregistrer un modèle de mapping sans le droit
**Compte :** Secrétariat · **Où :** étape « 2. Associer les colonnes du fichier »
1. Cochez « Enregistrer ce mapping comme modèle », nommez-le, validez.
**Résultat attendu :** refus attendu (le droit de gérer les modèles est réservé à la direction) ; le message s'affiche en haut de l'étape, le mapping n'est pas enregistré (à confirmer).
- [ ] Refus constaté (ou comportement différent noté)

#### C05.N8 Isolation entre établissements
**Compte :** Secrétariat de `demo-primaire` · **Où :** `/v2/imports`
1. Ouvrez l'historique : les imports de `demo-secondaire` n'apparaissent pas ; l'import prêt de `demo-primaire` utilise ses propres élèves (même liste de noms, classe `CP1-A`).
**Résultat attendu :** chaque établissement ne voit que ses propres imports.
- [ ] Historique propre à l'établissement

### 5.5 Problèmes connus et limites
- Le fichier de l'import de démonstration n'est pas conservé sur disque : pour rejouer ses lignes, créez un fichier à la main (voir C05.7).
- L'annulation d'un import ne peut pratiquement pas être observée avec de petits fichiers (voir C05.9).
- Les importeurs « Notes » et « Soldes financiers d'ouverture » n'ont pas de scénario dans ce guide : leur exécution crée des notes ou des factures de reprise ; le second exige la MFA.
- Les lignes d'exemple du modèle d'élèves utilisent une classe d'exemple (`6EME_A`) qui n'existe pas dans la démonstration (voir C05.5).
- Le texte « Droits manquants : » liste des codes techniques de droits ; c'est normal dans cette version.
- Rapport QA (P1) : sur certaines pages, des appels de lecture refusés peuvent s'afficher dans la console du navigateur pour les rôles autres que propriétaire et directeur ; sans effet sur les imports.
- L'entrée « Imports Excel / CSV » se règle par le droit de consulter l'historique ; les imports de la plateforme ne s'appliquent qu'à l'établissement connecté.

### 5.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 031 prévoit sept étapes (Upload, Mapping, Validation, Erreurs, Preview, Import, Rapport) ; l'écran regroupe Erreurs et Aperçu dans une seule étape (« 4. Erreurs et aperçu avant import »), l'assistant affiche six étapes.
- L'attribution des droits d'import (économe : préparation seule ; secrétariat : élèves et tuteurs ; études : classes et curriculum) est portée par les modèles de rôles ; le comportement des cartes pour l'économe n'a pas été vérifié dans l'écran (à confirmer).
- Droit « Gérer les modèles de mapping » : le formulaire n'en conditionne pas l'affichage ; le refus se produit côté serveur (à confirmer).


## Chapitre 6. Présences et appel
> **Durée estimée :** 60 à 90 minutes · **Établissement(s) :** Collège Le Baobab (`demo-secondaire`), École Les Palmiers (`demo-primaire`), Université Horizon (`demo-superieur`, mêmes gestes que le secondaire) · **Comptes :** enseignant, instituteur (CP1), institutrice de maternelle, éducateur, directeur, directeur des études, parent

### 6.1 Objectif
Vérifier que l'on peut faire l'appel (par séance au secondaire, une fois par jour au primaire et en maternelle), que la direction valide puis peut rouvrir un appel avec un motif, que les justificatifs d'absence suivent leur circuit (dépôt, décision), que les récapitulatifs et les alertes se lisent, et que la présence et les congés du personnel fonctionnent. Le travail hors ligne est abordé ici de façon simple ; le détail technique de l'application installable est au chapitre 22.

Principe à retenir : **celui qui fait l'appel (l'enseignant) n'est pas celui qui le valide (la direction)**. La séparation se fait par les droits du rôle : l'enseignant n'a pas le droit de valider, et seule la direction peut rouvrir un appel validé.

### 6.2 Avant de commencer
- **Comptes** (adresse de connexion : `http://<slug>.localhost:3100/v2/login`, mots de passe dans le fichier des comptes de démonstration `.demo/credentials.md` ; le code MFA s'obtient avec `pnpm demo:totp <e-mail>`) :

| Rôle | E-mail type | MFA | Sert à |
|---|---|---|---|
| Enseignant (secondaire) | `enseignant@demo-secondaire.test` | non | faire l'appel d'une séance |
| Instituteur (CP1) | `enseignant@demo-primaire.test` | non | appel journalier du CP1 A |
| Institutrice de maternelle | `instituteur.maternelle@demo-primaire.test` | non | appel journalier de la Grande Section A |
| Éducateur | `educateur@demo-secondaire.test` | non | suivre, valider, déposer un justificatif |
| Directeur | `directeur@demo-secondaire.test` | oui | valider, rouvrir, décider des congés |
| Directeur des études | `etudes@demo-secondaire.test` | oui | valider, décider des justificatifs ; ne peut PAS rouvrir |
| Parent | `parent@demo-secondaire.test` (Séka DIABATE) | non | absences de ses enfants |

- **Menus et adresses** :
  - Enseignant ou instituteur : menu du portail « Mes appels » (`/v2/teacher/attendance`) ; « Mes congés et ma présence » (`/v2/teacher/leaves`).
  - Direction, éducateur, directeur des études : module « Présences » ; entrées « Suivi des appels » (`/v2/attendance/sessions`), « Justificatifs d'absence » (`/v2/attendance/justifications`), « Présence du personnel » (`/v2/attendance/staff`). La barre de l'écran propose aussi « Faire l'appel », « Tableau de bord », « Absences », « Appels non faits », « Alertes », « Conflits de synchronisation » (`/v2/attendance/call`, `/v2/attendance`, `/v2/attendance/absences`, `/v2/attendance/compliance`, `/v2/attendance/alerts`, `/v2/attendance/conflicts`).
  - Parent : « Mes enfants » puis la section absences (`/v2/parent/children/<identifiant de l'enfant>/attendance`, ou `/v2/attendance/children`).
- **Politique d'appel (visible dans les écrans)** :
  - Secondaire et supérieur : **appel par séance**. Sur « Mes appels », la rubrique « Aujourd'hui » liste les séances du jour avec un bouton « Faire l'appel ». Les séances sont lundi à jeudi de 8 h à 10 h pour la classe 6E A (une matière par jour, voir chapitre 7).
  - Primaire (CP1 A) et maternelle (Grande Section A) : **appel journalier**. La rubrique « Appel de la journée » (« Pour les classes à appel journalier (une seule fois par jour) ») propose « Appel du jour ». Quand le jour compte des séances mais que le cycle refuse l'appel par séance, l'écran affiche : « Dans votre cycle, l'appel se fait une fois par jour pour la classe, et non séance par séance. »
  - Le délai de correction d'un appel soumis est de 120 minutes dans le modèle de démonstration du secondaire ; au-delà, seule une personne qui gère les présences (direction, éducateur) peut corriger.
- **Données de démonstration** :
  - Secondaire, classe 6E A : deux appels sont **déjà validés** (les deux premières séances passées après le début de l'année scolaire, pointées par Kouadio TRAORE, validées par la direction). Dans chacun : une absence (Aya BAMBA dans le premier, Fatou BAMBA dans le second), et un retard de 10 minutes pour Salimata COULIBALY dans les deux ; les autres sont présents. Les dates dépendent du jour où la démonstration a été générée : élargissez le filtre « Du » dans « Suivi des appels » (par défaut, les 7 derniers jours seulement).
  - Primaire, CP1 A : aucun appel journalier n'est créé par la graine (le CP1 est à appel journalier).
  - Primaire, Grande Section A (institutrice Sylvie ZOKORA) : un appel journalier **du jour de génération** est déjà validé : Brice ASSI absent, Chantal DAGO en retard de 10 minutes, Aïcha ADOU, Désiré EKRA et Estelle FOFANA présents.
  - Aucun justificatif, aucun congé, aucune présence du personnel ni aucun conflit de synchronisation n'existent dans la graine.

### 6.3 Scénarios
#### C06.1 Lire « Mes appels » et la politique du cycle
**Compte :** `enseignant@demo-secondaire.test`, puis `enseignant@demo-primaire.test` · **Où :** « Mes appels » (`/v2/teacher/attendance`)
1. Connectez-vous au secondaire avec l'enseignant et ouvrez « Mes appels ».
2. Lisez la rubrique « Aujourd'hui ». Si le jour est un lundi, mardi, mercredi ou jeudi, une séance de 8 h à 10 h apparaît, avec l'état « Appel à faire ».
3. Notez qu'aucune rubrique « Appel de la journée » n'est proposée pour la classe du secondaire.
4. Descendez : la rubrique « Mes appels des 30 derniers jours » liste l'historique (les appels de la graine y figurent s'ils datent de moins de 30 jours).
5. Déconnectez-vous, connectez-vous au primaire (`enseignant@demo-primaire.test`) et rouvrez « Mes appels ».
**Résultat attendu :** au secondaire, seules des séances sont proposées ; au primaire, la rubrique « Appel de la journée » est proposée pour la classe CP1 A, et aucune séance n'offre « Faire l'appel » (message sur l'appel une fois par jour, ou « Aucune séance prévue aujourd'hui. » du vendredi au dimanche).
- [ ] Secondaire : séances du jour proposées, pas d'appel journalier
- [ ] Primaire : « Appel du jour » proposé, appel par séance non proposé
- [ ] Les libellés sont en français, sans texte brut ni code

#### C06.2 Faire l'appel d'une séance (secondaire) et le soumettre
**Compte :** `enseignant@demo-secondaire.test` · **Où :** « Mes appels » > « Aujourd'hui » > « Faire l'appel » (`/v2/teacher/attendance/call/occurrence/<identifiant de la séance>`)
1. Un jour de cours (lundi à jeudi), cliquez « Faire l'appel » sur la séance du jour. L'écran « Faire l'appel » s'ouvre : l'ouverture de l'appel est automatique (elle crée l'appel en base).
2. Constatez que tous les élèves sont « Présent » par défaut et que l'aide dit : « Tout le monde est présent par défaut : touchez uniquement les exceptions. »
3. Touchez la ligne d'un élève (par exemple Aya BAMBA) : elle bascule en « Absent ». Touchez de nouveau : retour à « Présent ».
4. Touchez le bouton à trois points d'un autre élève (par exemple Salimata COULIBALY), choisissez « En retard », saisissez des « Minutes de retard » (nombre entier de 1 à 1440) puis « Appliquer ».
5. Touchez « Soumettre l'appel ».
**Résultat attendu :** message du type « Appel soumis : 1 absent, 1 retard. », l'état de l'appel passe à « Appel soumis », les lignes ne sont plus modifiables que dans le délai de correction. Dans « Mes appels », la séance est marquée « Appel soumis ». Sur l'emploi du temps (chapitre 7), la séance devient « Constatée » (à confirmer à l'écran).
- [ ] Tous présents par défaut, bascule présent/absent en un geste
- [ ] Retard avec minutes enregistré (affiché « En retard 10 min » par exemple)
- [ ] Résumé affiché (nombre d'absents, de retards) après soumission
- [ ] Le statut « Absent justifié » n'est PAS proposé dans la liste des statuts de l'enseignant (il résulte d'un justificatif)

#### C06.3 Appel journalier du CP1 (primaire)
**Compte :** `enseignant@demo-primaire.test` (instituteur) · **Où :** « Mes appels » > « Appel de la journée » > « Appel du jour »
1. Ouvrez « Mes appels » et cliquez « Appel du jour » en face de la classe CP1 A.
2. Faites l'appel comme au scénario C06.2 (exceptions seulement) puis « Soumettre l'appel ».
3. Revenez à « Mes appels » : la classe CP1 A porte l'état « Appel soumis ».
**Résultat attendu :** un seul appel pour la journée et la classe ; aucune notion de séance ni d'heures. Un second clic sur « Appel du jour » rouvre le même appel (pas de doublon).
- [ ] Appel journalier créé et soumis
- [ ] Un deuxième accès ouvre le même appel, sans doublon

#### C06.4 Maternelle : appel du jour déjà validé (lecture seule)
**Compte :** `instituteur.maternelle@demo-primaire.test` · **Où :** « Mes appels » > « Appel de la journée » (Grande Section A)
1. Connectez-vous à `demo-primaire` avec l'institutrice de maternelle.
2. Ouvrez « Mes appels » puis « Appel du jour » pour la Grande Section A.
3. Lisez le bandeau d'avertissement et les statuts.
**Résultat attendu :** si l'appel date du jour de génération de la démonstration, il est « Appel validé », avec Brice ASSI « Absent » et Chantal DAGO « En retard 10 min », et le bandeau : « Cet appel est validé : il ne peut plus être modifié ici. La direction peut le rouvrir avec un motif. » Le bouton de soumission est inactif. Un autre jour, l'écran ouvre un nouvel appel (état « Appel ouvert ») : faites-le alors comme au C06.3.
- [ ] Appel validé non modifiable par l'institutrice
- [ ] Les absents et retards de la graine sont corrects (si la date est celle du jour de génération)

#### C06.5 Suivre et valider les appels (séparation des tâches)
**Compte :** `directeur@demo-secondaire.test` (MFA oui) · **Où :** « Présences » > « Suivi des appels » (`/v2/attendance/sessions`)
1. Connectez-vous (code MFA demandé) et ouvrez « Suivi des appels ».
2. Réglez « Du » sur une date antérieure au début de l'année scolaire, laissez « Au » à aujourd'hui, état « Tous ».
3. Repérez les deux appels de la graine (colonne « État » : « Validé »). Repérez l'appel soumis au C06.2 (état « Soumis »).
4. Sur l'appel « Soumis », cliquez « Valider » (ou cochez-le et cliquez « Valider la séance sélectionnée »).
**Résultat attendu :** message « Appel validé. » (ou « 1 appel validé. » en lot) ; l'appel passe à « Validé » et n'offre plus « Valider ». Valider un appel déjà validé ne change rien.
- [ ] Les deux appels de la graine apparaissent « Validé »
- [ ] L'appel soumis par l'enseignant se valide en un clic
- [ ] Le filtre « État » et le filtre « Classe » fonctionnent

#### C06.6 Récapitulatif d'assiduité et liste des absences
**Compte :** `etudes@demo-secondaire.test` (MFA oui) ou `directeur@demo-secondaire.test` · **Où :** « Tableau de bord » (`/v2/attendance`, titre « Assiduité par classe »), puis « Absences » (`/v2/attendance/absences`)
1. Ouvrez « Tableau de bord ». Choisissez l'année scolaire, la période (Trimestre 1) et la classe 6E A.
2. Lisez le tableau : colonnes « Élève », « Séances », « Absences », « Retards », « Départs anticipés », « Non pointés », « Absence », « Valeur » (« Calculé » ou « Surchargé »).
3. Ouvrez « Absences » : choisissez la classe 6E A et élargissez les dates. Le filtre « Justification » propose « À justifier » et « Justifiée ».
4. Cliquez « Exporter en CSV » : un fichier est téléchargé (limité à 5 000 lignes, l'export est journalisé).
**Résultat attendu :** d'après la graine : Aya BAMBA et Fatou BAMBA ont chacune 1 absence (« À justifier »), Salimata COULIBALY 2 retards ; les valeurs sont « Calculé ». Le bouton « Recalculer la période » affiche « Recalcul demandé : les récapitulatifs sont à jour. » sans changer les chiffres. Le bouton « Surcharger » (réservé aux personnes autorisées) demande un motif d'au moins 5 caractères et marque la ligne « Surchargé » ; « Retirer la surcharge » rétablit la valeur calculée.
- [ ] Comptages conformes à la graine
- [ ] Export CSV téléchargé
- [ ] Surcharge avec motif puis retrait de la surcharge (action sensible, MFA demandée si besoin)

#### C06.7 Rouvrir un appel validé avec un motif, corriger, revalider
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Suivi des appels »
Attention : action sensible et auditée (code MFA demandé). Elle est réversible : on revalide ensuite.
1. Sur un appel « Validé » (par exemple celui de Aya BAMBA), cliquez « Rouvrir ».
2. La fenêtre « Rouvrir l'appel » rappelle : « Acte sensible : l'appel validé repasse en correction. Le motif est conservé et l'action est auditée. » Saisissez un motif d'au moins 5 caractères (par exemple « Erreur de saisie, élève présent ») et confirmez ; saisissez le code MFA si demandé (fenêtre « Confirmez votre identité »).
3. L'appel passe à « Soumis ». Cliquez « Ouvrir » et corrigez le pointage de l'élève (Aya BAMBA redevient « Présent »), puis « Enregistrer les corrections ».
4. Revenez à « Suivi des appels » et cliquez « Valider ».
**Résultat attendu :** « Appel rouvert. » puis « Corrections enregistrées. » puis « Appel validé. ». Le récapitulatif de la classe est recalculé. Pour remettre la graine dans l'état d'origine, remettez Aya BAMBA « Absent » avant de revalider.
- [ ] Motif obligatoire pour rouvrir
- [ ] L'appel rouvert est corrigeable puis revalidable
- [ ] Le récapitulatif de la classe change après correction

#### C06.8 Justificatif d'absence : dépôt, décision, effet
**Compte :** `educateur@demo-secondaire.test` (dépôt), puis `etudes@demo-secondaire.test` ou `directeur@demo-secondaire.test` (décision) · **Où :** « Justificatifs d'absence » (`/v2/attendance/justifications`)
1. Avec l'éducateur : ouvrez « Justificatifs d'absence », cliquez « Déposer un justificatif ».
2. Choisissez l'élève Fatou BAMBA, le « Premier jour d'absence » et le « Dernier jour d'absence » (couvrant la date de son absence), un « Motif » (par exemple « Maladie »), un commentaire, et éventuellement une pièce (PDF ou image). Cliquez « Déposer ».
3. Le justificatif est « En attente ». Avec la direction (ou le directeur des études), ouvrez-le : section « Pièces jointes » (l'ouverture d'une pièce est journalisée), puis « Accepter » (note facultative).
4. Retournez à « Absences » : l'absence de Fatou BAMBA est « Justifiée ». Le tableau de bord (C06.6) compte « 1 dont 1 justifiée(s) ».
5. Variante : déposez un second justificatif et « Rejeter » avec un motif ; puis « Révoquer » un justificatif accepté avec un motif : les pointages redeviennent « À justifier ».
**Résultat attendu :** messages « Justificatif déposé. », « Justificatif accepté. », « Justificatif rejeté. » ou « Justificatif révoqué. ». Un rejet ou une révocation exige un motif (3 caractères au moins).
- [ ] Dépôt réussi, état « En attente »
- [ ] Acceptation : l'absence passe « Justifiée » et les récapitulatifs sont recalculés
- [ ] Rejet et révocation exigent un motif
- [ ] L'éducateur peut déposer mais pas décider (pas de boutons « Accepter », « Rejeter », « Révoquer »)

#### C06.9 « Appels non faits » et « Alertes »
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Appels non faits » (`/v2/attendance/compliance`), « Alertes » (`/v2/attendance/alerts`)
1. Ouvrez « Appels non faits », choisissez une période couvrant le début de l'année.
2. Lisez les colonnes « Attendus », « Faits », « Non faits », « Taux d'appel », par enseignant et par classe. La liste « Séances sans appel » propose « Faire l'appel » pour chaque séance manquante.
3. Ouvrez « Alertes » : sans règle, l'écran dit « Aucune règle d'alerte. » (« Sans règle, aucune alerte n'est émise. »). La direction peut « Ajouter la règle » (code en majuscules, indicateur, seuil) ; aucun seuil n'est imposé par défaut.
**Résultat attendu :** les chiffres reflètent les séances passées de l'emploi du temps (la graine n'en a pointé que deux) ; aucun seuil officiel n'apparaît nulle part.
- [ ] Les séances passées sans appel sont listées
- [ ] « Faire l'appel » depuis cette liste ouvre l'appel de la séance
- [ ] Aucune règle d'alerte par défaut

#### C06.10 Présence du personnel et congés
**Compte :** `enseignant@demo-secondaire.test` (demande), `directeur@demo-secondaire.test` (décision) · **Où :** « Mes congés et ma présence » (`/v2/teacher/leaves`) et « Présence du personnel » (`/v2/attendance/staff`)
1. Enseignant : ouvrez « Mes congés et ma présence ». Cliquez « Arrivée » (message « Arrivée enregistrée. »), puis « Départ » (« Départ enregistré. »).
2. Cliquez « Demander un congé » : choisissez le « Type de congé » (par exemple « Congé annuel »), le « Premier jour » et le « Dernier jour » (un jour de cours à venir, par exemple un lundi), un « Motif » ; cochez au besoin les demi-journées. Envoyez : « Demande de congé envoyée. », état « Demandé ».
3. Directeur : ouvrez « Présence du personnel » (filtre « État des congés » sur « Demandé »). Pour la demande, cliquez « Approuver » (« Congé approuvé. »). Variante : « Refuser » exige un motif (« Congé refusé. »), « Annuler » annule (« Congé annulé. »).
4. Cliquez « Enregistrer une présence » pour noter la présence d'un membre du personnel un jour donné (une ligne par personne et par jour ; contredire un congé approuvé exige de cocher « Corriger un jour de congé approuvé »).
5. Consultez le « Récapitulatif » de la période (jours, statuts, minutes de retard, jours de congé).
**Résultat attendu :** la demande suit le circuit Demandé > Approuvé (ou Refusé / Annulé). Un congé approuvé sur un jour de cours rend la séance « À remplacer » dans l'emploi du temps (chapitre 7, C07.7). Si l'écran affiche « La présence du personnel n'est pas incluse dans votre offre. », la fonction n'est pas activée pour l'établissement.
- [ ] Pointage Arrivée et Départ enregistrés
- [ ] Demande de congé créée puis approuvée par la direction
- [ ] Refus avec motif obligatoire
- [ ] L'enseignant n'a pas de boutons « Approuver » / « Refuser »

#### C06.11 Le parent consulte les absences de ses enfants
**Compte :** `parent@demo-secondaire.test` (Séka DIABATE) · **Où :** « Mes enfants » > un enfant > absences (`/v2/parent/children/<identifiant>/attendance`) ; liste : `/v2/attendance/children`
1. Connectez-vous en tant que parent. Ouvrez Nadia DIABATE puis la section absences.
2. Lisez le « Récapitulatif » (séances, absences, dont justifiées, retards, départs anticipés).
3. Faites de même pour Salimata DIABATE.
**Résultat attendu :** aucune absence ni retard dans la graine pour ces deux enfants : « Aucune absence ni retard. » et « Tout est en règle. ». Le bouton « Déposer un justificatif » (période et motif) est proposé au parent pour son enfant et crée un justificatif « En attente » qui apparaît dans la liste de la direction.
- [ ] Récapitulatif vide mais lisible
- [ ] Dépôt d'un justificatif par le parent visible côté direction (état « En attente », « Déposé par » : Parent)

#### C06.12 Appel hors ligne (aperçu ; détail au chapitre 22)
**Compte :** `enseignant@demo-secondaire.test` · **Où :** écran d'appel d'une séance
1. Ouvrez l'écran d'appel d'une séance (en ligne : la liste nominative doit être chargée).
2. Coupez le réseau (outils du navigateur, mode « Hors connexion »).
3. Marquez un élève « Absent » et touchez « Soumettre l'appel ».
4. Lisez le message et l'indicateur en haut de l'écran, puis rétablissez le réseau.
**Résultat attendu :** hors ligne : « Appel enregistré sur cet appareil. Il sera envoyé automatiquement dès que le réseau reviendra. » avec l'indicateur « Hors ligne : … pointages gardés sur cet appareil, envoi à la reconnexion. ». Au retour du réseau : « Synchronisation en cours… » puis « En ligne : synchronisé à <heure>. ». La rubrique « Sur cet appareil » de « Mes appels » liste les appels en attente (« En attente d'envoi », « Envoyé », « À vérifier ») ; seuls des identifiants, jamais des noms d'élèves, sont gardés sur l'appareil. Impossible d'ouvrir un NOUVEL appel hors ligne : « Vous êtes hors ligne : la liste de la classe ne peut pas être chargée. »
- [ ] Appel gardé sur l'appareil puis envoyé à la reconnexion
- [ ] Message clair quand la liste ne peut pas se charger hors ligne

#### C06.13 Conflits de synchronisation
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Conflits de synchronisation » (`/v2/attendance/conflicts`)
1. Ouvrez l'écran : l'affichage « Afficher » propose « À arbitrer » et « Arbitrés ».
2. Sur la démonstration neuve, constatez « Aucun conflit à arbitrer. ».
3. Pour provoquer un conflit (facultatif, à confirmer) : l'enseignant ouvre l'appel d'une séance en ligne, passe hors ligne, marque un absent et touche « Soumettre l'appel » ; pendant ce temps la direction annule cet appel dans « Suivi des appels » (avec motif) ; l'enseignant revient en ligne.
4. L'enseignant voit « 1 pointage n'a pas été appliqué » avec le lien « Ouvrir les conflits à arbitrer » ; la direction voit la ligne avec « Saisie de l'appareil » et « Pointage actuel », le type (« Appel verrouillé », « Délai de correction dépassé » ou « Saisie plus ancienne ») et deux choix : « Conserver le pointage actuel » ou « Appliquer la saisie de l'appareil ».
**Résultat attendu :** rien n'est écrasé en silence ; la direction tranche. « Appliquer la saisie de l'appareil » est impossible tant que l'appel est validé ou annulé (il faut le rouvrir d'abord). Une fois arbitré, le conflit passe dans « Arbitrés » (« Conflit arbitré. »). Si la fonction n'est pas incluse dans l'offre : « La synchronisation hors ligne n'est pas incluse dans votre offre. »
- [ ] Écran vide sans conflit
- [ ] Conflit visible avec les deux valeurs et choix de la direction (si reproduit)

### 6.4 Cas limites et tests négatifs
#### C06.N1 L'enseignant ne valide ni ne rouvre
**Compte :** `enseignant@demo-secondaire.test` · **Où :** `/v2/attendance/sessions`
1. L'enseignant peut ouvrir « Suivi des appels » (il a le droit de lecture).
2. Cherchez les boutons « Valider » et « Rouvrir » sur les lignes.
**Résultat attendu :** aucun bouton « Valider » ni « Rouvrir ». Les entrées « Justificatifs d'absence », « Conflits de synchronisation » et « Présence du personnel » ne sont pas dans sa navigation ; ouvrir leur adresse directement mène à une page d'accès refusé.
- [ ] Pas de « Valider »
- [ ] Pas de « Rouvrir »
- [ ] Adresse `/v2/attendance/conflicts` refusée

#### C06.N2 Le directeur des études et l'éducateur ne rouvrent pas un appel validé
**Compte :** `etudes@demo-secondaire.test`, puis `educateur@demo-secondaire.test` · **Où :** « Suivi des appels »
1. Sur un appel « Validé », cherchez « Rouvrir ».
**Résultat attendu :** absent pour ces deux rôles (seule la direction détient le droit de rouvrir). Ils peuvent « Valider » un appel « Soumis ». Remarque : pour les présences, l'éducateur valide (c'est son rôle) ; la règle « l'éducateur propose, il ne valide pas » concerne la vie scolaire, pas l'appel.
- [ ] « Rouvrir » absent pour le directeur des études
- [ ] « Rouvrir » absent pour l'éducateur

#### C06.N3 Motif trop court ou absent
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Rouvrir » ou « Annuler » (appel soumis)
1. Ouvrez « Rouvrir » (ou « Annuler » sur un appel « Soumis ») et laissez le motif vide ou à 2 caractères.
**Résultat attendu :** le bouton de confirmation est refusé avec l'indication du minimum de caractères (5). Annuler un appel validé exige d'abord de le rouvrir.
- [ ] Motif vide refusé
- [ ] Motif trop court refusé

#### C06.N4 Appel non pointé ou séance annulée
**Compte :** `enseignant@demo-secondaire.test` · **Où :** écran d'appel
1. Faites l'appel d'une séance qui a été annulée dans l'emploi du temps (chapitre 7, C07.6).
**Résultat attendu :** message « Cette séance a été annulée : l'appel ne peut plus être enregistré. ».
- [ ] Appel d'une séance annulée refusé avec un message clair

#### C06.N5 Élément hors périmètre et isolation entre établissements
**Compte :** `parent@demo-secondaire.test`, puis `directeur@demo-primaire.test` · **Où :** adresses saisies à la main
1. Parent : ouvrez `/v2/parent/children/00000000-0000-4000-8000-000000000000/attendance` (identifiant inventé).
2. Direction du primaire : copiez l'adresse d'un appel du secondaire (`/v2/attendance/call/occurrence/<identifiant>` relevée à l'écran) et ouvrez-la sur `http://demo-primaire.localhost:3100`.
**Résultat attendu :** la page répond comme si l'élément n'existait pas (page introuvable ou message « Ressource introuvable ») ; aucune donnée de l'autre enfant ni de l'autre établissement n'apparaît.
- [ ] Enfant inconnu : comme s'il n'existait pas
- [ ] Appel d'un autre établissement : comme s'il n'existait pas

#### C06.N6 Politique d'appel du cycle respectée
**Compte :** `enseignant@demo-secondaire.test` puis `enseignant@demo-primaire.test`
1. Au secondaire, vérifiez que « Appel du jour » n'est pas proposé.
2. Au primaire, vérifiez qu'aucun bouton « Faire l'appel » n'est proposé sur une séance.
**Résultat attendu :** les types d'appel refusés par la politique du cycle sont masqués. Si l'on force l'adresse d'un appel journalier au secondaire, l'application répond : « La politique d'appel de ce cycle n'autorise pas l'appel journalier. »
- [ ] Types d'appel masqués selon le cycle

#### C06.N7 Double validation et double soumission
**Compte :** `directeur@demo-secondaire.test`
1. Validez un appel déjà validé (deux onglets ouverts sur « Suivi des appels »).
2. Soumettez un appel déjà soumis (deux onglets enseignant).
**Résultat attendu :** aucun doublon ni erreur grave ; message « Appel déjà soumis. » ou état inchangé.
- [ ] Les actions répétées sont sans effet néfaste

#### C06.N8 Justificatif invalide
**Compte :** `educateur@demo-secondaire.test` · **Où :** « Déposer un justificatif »
1. Laissez le « Motif » vide, ou mettez un « Dernier jour d'absence » antérieur au premier, ou joignez un fichier d'un format non accepté ou trop lourd.
**Résultat attendu :** le formulaire signale les champs (« Choisissez un motif. », « Le fichier dépasse la taille autorisée … », formats acceptés indiqués) ; rien n'est créé. Si seule la pièce échoue, le justificatif est tout de même déposé et l'écran le précise.
- [ ] Champs invalides signalés, aucun justificatif créé

### 6.5 Problèmes connus et limites
- Écrans d'appel : la simple ouverture de l'écran d'appel crée l'appel (écriture). Le balayage QA ne les a donc pas ouverts (rapport du 2026-10-03).
- Qualité (rapport QA M22) : avant correction, l'enseignant du secondaire pouvait se voir proposer l'appel journalier (refus 409). Le masquage selon la politique du cycle est corrigé (point 8 du rapport) ; à reconfirmer.
- Qualité (rapport QA m13) : « Mes absences » (`/v2/attendance/me`) réclame un profil élève ; avec un compte sans profil, l'API répond par un refus de session au lieu d'un message clair. Ne pas utiliser ce compte pour ce test.
- Qualité (rapport QA P3, M8) : l'éducateur et l'enseignant déclenchent en arrière-plan des appels refusés (liste des années scolaires) ; sans effet visible attendu, mais une liste déroulante d'années peut rester vide.
- L'entrée de menu « Paramètres de présence » (statuts, motifs, types de congé, politiques d'appel) n'a pas d'écran v2 (rapport QA : entrée sans écran, masquée du menu). Les règles d'alerte se gèrent dans « Alertes ».
- Les fonctions « Présence du personnel », « Appel hors ligne » et « Pont de présence des classes virtuelles » dépendent de l'offre de l'établissement.
- L'attestation d'assiduité d'un élève (`/v2/attendance/student/<identifiant>`) affiche les données ; le document officiel est produit par le module documents.
- Le justificatif peut porter une pièce médicale : son ouverture est tracée ; ne pas utiliser de vraies pièces.

### 6.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 010 §9 : écran « Paramètres » (statuts, motifs, types de congé, politique d'appel, pièces acceptées) prévu mais sans écran v2.
- Spec 010 §9 : « Faire l'appel » prévu avec photos des élèves et « calendrier des absences » du personnel : non constatés dans l'écran.
- Spec 010 US8 (pont de présence des classes virtuelles) : fonction d'API sans écran dédié (non vérifié).
- Rôles de la spec 010 : le parent « dépose » un justificatif, la file de décision est tenue par le secrétariat ou la direction ; en pratique `attendance.justification.decide` n'est détenu que par la direction et le directeur des études (le secrétariat peut seulement déposer et lire).

---

## Chapitre 7. Emploi du temps
> **Durée estimée :** 45 à 60 minutes · **Établissement(s) :** Collège Le Baobab (`demo-secondaire`) en priorité ; mêmes gestes à `demo-primaire` et `demo-superieur` · **Comptes :** directeur, directeur des études, secrétariat, éducateur, enseignant, parent, élève

### 7.1 Objectif
Vérifier que l'emploi du temps publié et ses séances datées se consultent par semaine ou par jour (par classe, enseignant, salle, élève), que la direction peut créer une séance, détecter un conflit, déplacer, annuler, remplacer ou constater une séance, gérer les salles et exporter le calendrier. Ce chapitre signale aussi les deux fonctions prévues mais sans écran : le calendrier de l'établissement et la validation des séances pour la paie.

### 7.2 Avant de commencer
- **Comptes** (`http://<slug>.localhost:3100/v2/login`, mots de passe dans `.demo/credentials.md`, code MFA par `pnpm demo:totp <e-mail>`) :

| Rôle | E-mail type | MFA | Droits utiles |
|---|---|---|---|
| Directeur | `directeur@demo-secondaire.test` | oui | tout (créer, publier, dépasser un conflit, valider pour la paie en API) |
| Directeur des études | `etudes@demo-secondaire.test` | oui | créer, publier, salles, calendrier, dépasser un conflit |
| Secrétariat | `secretariat@demo-secondaire.test` | oui | lecture seule de l'emploi du temps |
| Éducateur | `educateur@demo-secondaire.test` | non | lecture et « Constater » une séance |
| Enseignant | `enseignant@demo-secondaire.test` | non | ses séances, séances ponctuelles de ses classes |
| Parent / Élève | `parent@demo-secondaire.test`, `eleve@demo-secondaire.test` | non | lecture de l'emploi du temps de ses enfants / de lui-même |

- **Chemins** :
  - Direction : module « Emploi du temps » ; entrées de menu « Emplois du temps » (`/v2/schedule/timetables`), « Salles et équipements » (`/v2/schedule/rooms`), « Remplacements » (`/v2/schedule/replacements`). La barre de l'écran propose « Emploi du temps » (`/v2/schedule`), « Aujourd'hui », « Séances » (`/v2/schedule/occurrences`), « Patrons récurrents » (`/v2/schedule/timetables`), « Remplacements », « Salles et équipements », « Export calendrier » (`/v2/schedule/export`).
  - Enseignant : portail, « Aujourd'hui » (`/v2/teacher`) et « Mon emploi du temps » (`/v2/teacher/schedule`).
  - Élève : « Mon emploi du temps » (`/v2/student/schedule`). Parent : section « emploi du temps » d'un enfant (`/v2/parent/children/<identifiant>/schedule`).
- **Données de démonstration** : un emploi du temps publié nommé « Emploi du temps 6E-A » (primaire : « Emploi du temps CP1-A », supérieur : « Emploi du temps L1-A »), valable toute l'année, avec un cours par matière du lundi au jeudi de 8 h à 10 h, responsable Kouadio TRAORE. Les séances datées sont générées du début de l'année jusqu'à 14 jours après la génération de la démonstration. Aucune salle n'est affectée aux séances.
- **À savoir** : une séance de la semaine en cours est consultable tout de suite. Au-delà de 14 jours après la génération, il n'existe pas de séance tant qu'on n'a pas relancé « Générer les séances » (C07.4).

### 7.3 Scénarios
#### C07.1 Consulter la semaine d'une classe
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Emploi du temps » (`/v2/schedule`)
1. Ouvrez « Emploi du temps ». Dans « Afficher », choisissez « Classe » puis la classe 6E A (« Choisir une classe »).
2. Lisez la semaine (« Semaine du … au … ») : en grande largeur une grille par jour ; sur téléphone une liste par jour (« Séances par jour »).
3. Utilisez « Semaine précédente », « Semaine suivante », « Aujourd'hui ».
4. Changez « Vue » pour « Jour » puis utilisez « Jour précédent » et « Jour suivant ».
5. Changez « Afficher » pour « Enseignant » (Kouadio TRAORE) puis « Salle » : la salle est vide (aucune salle n'est affectée).
**Résultat attendu :** quatre cours de 8 h à 10 h, un par jour du lundi au jeudi (Français, Mathématiques, Anglais, Histoire-Géographie au secondaire), chacun avec son intitulé (matière) et son intervenant. Une semaine sans séance affiche « Aucune séance cette semaine. ».
- [ ] Grille de la semaine correcte (quatre cours)
- [ ] Navigation semaine / jour correcte
- [ ] Vues par classe et par enseignant cohérentes

#### C07.2 Enseignant : « Aujourd'hui » et « Mon emploi du temps »
**Compte :** `enseignant@demo-secondaire.test` · **Où :** `/v2/teacher` puis « Mon emploi du temps » (`/v2/teacher/schedule`)
1. Ouvrez « Aujourd'hui » : « Vos séances du <date>. ». Chaque séance propose « Faire l'appel » ou « Voir l'appel » et « Saisir les notes ».
2. Ouvrez « Mon emploi du temps » : la semaine, avec bascule « Jour ».
3. Cliquez « Exporter le calendrier » (voir C07.9).
**Résultat attendu :** seules les séances de l'enseignant apparaissent. Un jour sans cours : « Aucune séance aujourd'hui. » avec le renvoi vers « Mon emploi du temps ».
- [ ] Séances de l'enseignant seulement
- [ ] Raccourcis « Faire l'appel » et « Saisir les notes » fonctionnels

#### C07.3 Lire l'emploi du temps publié et ses créneaux
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Emplois du temps » (`/v2/schedule/timetables`)
1. Ouvrez la liste : colonnes « Nom », « Validité », « Semaine A (lundi) », « Publié le », « État ».
2. Ouvrez « Emploi du temps 6E-A » (état « Publié »).
3. Lisez « Créneaux récurrents » : un créneau par jour, « Chaque semaine », avec classe, heures et intervenants (rôle « Responsable »).
4. Regardez la zone « Conflits du brouillon » ou « Aucun conflit dans ce brouillon. ».
**Résultat attendu :** un emploi du temps publié n'est pas modifiable (« Seul un brouillon est modifiable. »). Les boutons « Archiver » et « Générer les séances » sont proposés selon les droits.
- [ ] Emploi du temps publié lisible, créneaux corrects
- [ ] Message de lecture seule affiché pour un emploi du temps publié

#### C07.4 Créer un brouillon, ajouter un créneau, générer les séances
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Patrons récurrents » > « Nouvel emploi du temps »
Attention : « Publier » rend l'emploi du temps visible de tous et « Générer les séances » crée des séances datées. Les deux se rejouent sans doublon, mais faites-les en fin de test : `pnpm demo:reset` remet tout à zéro.
1. Cliquez « Nouvel emploi du temps » : « Année scolaire », « Nom » (par exemple « Test 6E-A vendredi »), « Valable du », « Valable jusqu'au ». Cliquez « Créer » : « Emploi du temps créé en brouillon. ».
2. Dans le brouillon, cliquez « Ajouter un créneau » : type, intitulé, classe (6E A), cours (programme), jour (vendredi), début 08:00, fin 10:00, intervenant, alternance (« Chaque semaine »). Enregistrez : « Créneau ajouté. ». Les conflits éventuels sont expliqués.
3. Cliquez « Publier » (« Emploi du temps publié. ») puis « Générer les séances » : choisissez « Du » et « Au », cochez ou non « Plafonner au volume horaire des cours », cliquez « Générer ».
4. Lisez le rapport : « Créées », « Déjà existantes », « Jours bloqués », « En conflit », « Plafonnées ».
**Résultat attendu :** les séances du vendredi apparaissent dans « Séances » ; relancer la génération sur la même période affiche « Déjà existantes » sans doublon. Les jours bloqués du calendrier sont sautés. Si un créneau entre en conflit avec un existant (même enseignant ou même classe au même horaire), il est signalé et, sans dépassement motivé, refusé (à confirmer pour un brouillon).
- [ ] Brouillon créé et créneau ajouté
- [ ] Publication puis génération : rapport lisible
- [ ] Génération rejouée sans doublon

#### C07.5 Séance ponctuelle et détection de conflit
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Séances » (`/v2/schedule/occurrences`) > « Nouvelle séance »
1. Cliquez « Nouvelle séance » : type « Cours » ou « Réunion », intitulé, classe 6E A, date d'un lundi des deux prochaines semaines, début 08:30, fin 09:30, intervenant Kouadio TRAORE.
2. Observez l'aperçu : « Vérification des conflits… » puis « 1 conflit bloquant » (ressource « Intervenant » ou « Classe »), car le cours du lundi occupe déjà ce créneau.
3. Modifiez l'heure (par exemple 11:00 à 12:00) : « Aucun conflit détecté sur ce créneau. ».
4. Option « Aide au placement » : « Chercher des créneaux » propose les premiers créneaux libres (durée en minutes de 5 à 1440).
5. Créez la séance : « Séance créée. ».
**Résultat attendu :** le conflit bloquant empêche la création ; le message dit « Ce créneau est en conflit : choisissez-en un autre ou demandez un dépassement motivé à une personne habilitée. » Le directeur et le directeur des études ont l'option « Dépasser les conflits bloquants » avec un motif d'au moins 5 caractères (acte journalisé et audité) ; le secrétariat et l'enseignant ne l'ont pas.
- [ ] Conflit signalé en direct avant l'enregistrement
- [ ] Créneau libre : création réussie
- [ ] Dépassement possible seulement pour les personnes habilitées, avec motif

#### C07.6 Constater, déplacer, annuler, rétablir une séance
**Compte :** `etudes@demo-secondaire.test` (ou `directeur@`), `educateur@demo-secondaire.test` pour « Constater » · **Où :** « Séances »
1. Sur la séance créée au C07.5, cliquez « Déplacer » : nouvelle date, début, fin, motif. « Séance déplacée. ».
2. Cliquez « Salle » (changer de salle) : « Aucune salle » ou une salle créée au C07.8. « Salle modifiée. ».
3. Cliquez « Annuler » : motif obligatoire (« Le créneau est libéré. Le motif est conservé et communiqué. »). « Séance annulée. », état « Annulée ».
4. Cliquez « Rétablir » : « Séance rétablie. » (sous réserve de l'absence de conflit).
5. Avec l'éducateur, sur une séance « Prévue », cliquez « Constater » : « Séance constatée. », état « Constatée ». Le filtre « État » propose « Prévue », « Constatée », « Annulée ».
**Résultat attendu :** chaque action est tracée avec son motif ; une séance annulée ne permet plus l'appel (chapitre 6, C06.N4) ; une séance « Validée » (pour la paie) porte un badge « Validée ».
- [ ] Déplacement et changement de salle enregistrés
- [ ] Annulation avec motif puis rétablissement
- [ ] L'éducateur peut « Constater » mais pas « Déplacer » ni « Annuler »

#### C07.7 Remplacements
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Remplacements » (`/v2/schedule/replacements`)
Prérequis : un congé approuvé pour Kouadio TRAORE sur un jour de cours à venir (chapitre 6, C06.10).
1. Ouvrez « Remplacements » et choisissez la période (« Du », « Au »).
2. Repérez la séance marquée « À remplacer » avec sa cause (« Cause : … »).
3. Cliquez « Remplacer » : « Proposer des remplaçants » liste les enseignants avec « Disponible » ou « Non recommandé », « Compétent » et « Charge de la semaine : N h ».
4. Choisissez un remplaçant (par exemple Fatou YAO), saisissez le motif (3 caractères au moins), cliquez « Remplacer ».
**Résultat attendu :** « Remplacement enregistré. » ; le remplaçant devient le bénéficiaire de la séance (rôle « Remplaçant »). Sans congé approuvé : « Aucune séance à remplacer. ».
- [ ] La séance du congé approuvé est signalée « À remplacer »
- [ ] Remplacement enregistré, remplaçant visible sur la séance

#### C07.8 Salles et équipements
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Salles et équipements » (`/v2/schedule/rooms`)
1. Choisissez l'établissement et le campus (« Établissement et campus »).
2. Cliquez « Ajouter une salle » : « Code », « Nom », « Type de salle », « Capacité », « Bâtiment ». « Salle enregistrée. ».
3. Sur la salle, cliquez « Mettre hors service » puis confirmez : « La salle n'est plus réservable. Les séances futures concernées sont signalées « à remplacer », sans annulation automatique. » Puis « Remettre en service ».
4. Lisez « Occupation de la semaine » (heures occupées, taux).
5. Si proposé, « Ajouter un équipement » (stock par campus) ; sinon : « La réservation d'équipements n'est pas incluse dans votre offre. »
**Résultat attendu :** la salle apparaît dans la liste ; son état se change avec confirmation. Si aucun campus n'existe dans la démonstration, le bouton d'ajout reste inactif (à confirmer).
- [ ] Salle ajoutée et visible
- [ ] Hors service puis remise en service

#### C07.9 Exporter le calendrier
**Compte :** `enseignant@demo-secondaire.test` ou `parent@demo-secondaire.test` · **Où :** « Export calendrier » (`/v2/schedule/export`, ou `/v2/teacher/schedule/export`)
1. Choisissez le « Sujet de l'export » (« Mon emploi du temps », ou un enfant pour le parent).
2. Cliquez « Télécharger le fichier .ics » : un fichier des 4 prochains mois est téléchargé (à importer une fois, il ne se met pas à jour).
3. Dans « S'abonner (mise à jour automatique) », donnez un « Nom du lien » (par exemple « Téléphone »), une validité en jours, cliquez « Créer un lien d'abonnement ». Copiez le lien (« Copier le lien »).
4. Dans le tableau « Liens d'abonnement », cliquez « Révoquer » et confirmez.
**Résultat attendu :** le lien n'est affiché qu'une fois (« Ce lien ne sera plus affiché »), il est secret, en lecture seule et limité à ce seul emploi du temps ; après « Révoquer », l'état passe à « Révoqué » et l'agenda cesse de se mettre à jour. Attention : ne partagez pas ce lien.
- [ ] Fichier .ics téléchargé
- [ ] Lien d'abonnement créé puis révoqué

#### C07.10 Emploi du temps vu par l'élève et le parent
**Compte :** `eleve@demo-secondaire.test`, `parent@demo-secondaire.test` · **Où :** `/v2/student/schedule`, `/v2/parent/children/<identifiant>/schedule`
1. L'élève ouvre « Mon emploi du temps ».
2. Le parent ouvre « Mes enfants », choisit Nadia DIABATE puis la section emploi du temps ; il change d'enfant (Salimata DIABATE).
**Résultat attendu :** la semaine de la classe 6E A en lecture seule ; chaque famille ne voit que ses propres enfants.
- [ ] Emploi du temps de la classe visible, lecture seule
- [ ] Le parent ne voit que ses enfants

#### C07.11 Calendrier de l'établissement et validation des séances pour la paie (écrans manquants)
**Compte :** `directeur@demo-secondaire.test`
1. Cherchez dans le menu du module « Emploi du temps » les entrées « Calendrier de l'établissement » et « Validation des séances ».
2. Pour les jours fériés, vacances et fermetures, ouvrez à la place `/v2/academic/settings`, onglet « Calendrier » (à confirmer : ce sont les jours bloquants que la génération des séances saute, d'après la boîte « Générer les séances »).
3. Dans « Séances », repérez la mention « Validée » sur une séance (aucun bouton ne permet de valider).
**Résultat attendu :** ces deux entrées sont masquées du menu car il n'existe pas d'écran ; vérification dans le code : il n'y a toujours ni page ni action pour elles (le lien `/admin/emploi-du-temps/calendrier` et `/admin/emploi-du-temps/validation` n'ont pas de page v2). L'API sait valider une séance (droit sensible, MFA) mais l'application ne le propose pas encore ; les heures payables dépendent donc de séances validées par un autre moyen.
- [ ] Constat : aucun écran de validation des séances
- [ ] Constat : aucun écran « Calendrier de l'établissement » dans l'emploi du temps (l'onglet « Calendrier » des paramètres académiques existe)

### 7.4 Cas limites et tests négatifs
#### C07.N1 L'enseignant n'administre pas l'emploi du temps
**Compte :** `enseignant@demo-secondaire.test`
1. Ouvrez `/v2/schedule/timetables`, `/v2/schedule/rooms` et `/v2/schedule/replacements`.
**Résultat attendu :** page d'accès refusé pour chacune (l'enseignant n'a pas le droit de lire tous les emplois du temps). Il garde `/v2/schedule` (son propre emploi du temps) et « Export calendrier ».
- [ ] Les trois adresses sont refusées

#### C07.N2 Lecture seule : secrétariat et éducateur
**Compte :** `secretariat@demo-secondaire.test`, `educateur@demo-secondaire.test`
1. Ouvrez « Patrons récurrents » et « Séances ».
**Résultat attendu :** consultation possible ; aucun bouton « Nouvel emploi du temps », « Publier », « Déplacer », « Annuler », « Remplacer » (l'éducateur garde « Constater »). Les remplacements (`/v2/schedule/replacements`) sont refusés.
- [ ] Pas de boutons de modification
- [ ] « Remplacements » refusé

#### C07.N3 Publication réservée
**Compte :** `educateur@demo-secondaire.test` puis `directeur@demo-secondaire.test`
1. Ouvrez un brouillon d'emploi du temps.
**Résultat attendu :** « Publier » et « Archiver » n'apparaissent que pour les personnes qui détiennent le droit de publier (direction, directeur des études).
- [ ] « Publier » absent sans le droit

#### C07.N4 Isolation entre établissements
**Compte :** `directeur@demo-primaire.test`
1. Copiez l'adresse d'un emploi du temps du secondaire (`/v2/schedule/timetables/<identifiant>`) et ouvrez-la sur `http://demo-primaire.localhost:3100`.
**Résultat attendu :** la page répond comme si l'emploi du temps n'existait pas.
- [ ] Emploi du temps d'un autre établissement introuvable

#### C07.N5 Saisie invalide
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Nouvelle séance »
1. Laissez date et heures vides ; mettez une fin avant le début ; pour un type « Cours », omettez la classe ; saisissez un dépassement de conflit de moins de 5 caractères.
**Résultat attendu :** messages « Renseignez la date et les heures pour vérifier les conflits. », « Une classe est obligatoire pour un cours. », « Le motif du dépassement doit faire au moins 5 caractères. » ; rien n'est créé.
- [ ] Champs obligatoires et motif signalés

### 7.5 Problèmes connus et limites
- Deux entrées de menu sans écran (rapport QA du 2026-10-03, avec les entrées « Paramètres de présence » et « Paramètres des personnes ») : « Calendrier de l'établissement » (clé `scheduling.calendar`) et « Validation des séances » (clé `scheduling.validation`). Vérification dans le code : aucune page ne les sert ; elles sont masquées du menu. Le lecteur d'événements de calendrier existe côté application (accès aux données) sans écran.
- Le défaut QA m2 / m3 : un compte sans rôle d'enseignant (propriétaire) voit des refus attendus sur « Aujourd'hui » et « Mon emploi du temps » ; utiliser les comptes du tableau.
- Aucune séance n'est générée au-delà de 14 jours après la génération de la démonstration ; une tâche automatique de nuit est prévue pour une génération glissante (non vérifiable en test manuel).
- Hors ligne, « Mon emploi du temps » se lit depuis une copie en lecture seule (détail au chapitre 22).
- L'export d'abonnement crée un lien secret : le révoquer après le test.

### 7.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 017 §9 : « Calendrier de l'établissement » (fériés, vacances, fermetures, examens, réunions) : pas d'écran dans l'emploi du temps ; les jours fériés se saisissent dans les paramètres académiques (onglet « Calendrier »).
- Spec 017 US5 et §9 « Validation des séances » (lot, dérogation de durée, séances comptables) : pas d'écran ; conséquence : pas de chemin d'interface pour rendre des heures payables.
- Spec 017 §9 : glisser-déposer du constructeur, « Génération et rapprochement » (séances non constatées), « Paramètres » (fuseau, politique de conflit, quatre yeux) : non constatés.
- Menu `scheduling.timetables`, `scheduling.rooms`, `scheduling.replacements` sont réécrits vers `/v2/schedule/*` ; les entrées portail enseignant utilisent les libellés « Mes appels », « Mon emploi du temps » du portail et non ceux du manifeste (« Aujourd'hui », « Mon emploi du temps »).

---

## Chapitre 8. Évaluations et notes
> **Durée estimée :** 60 à 90 minutes · **Établissement(s) :** Collège Le Baobab (`demo-secondaire`) en priorité ; mêmes gestes à `demo-primaire` (CP1 A) et, avec « Examen » à la place de « Composition », à `demo-superieur` · **Comptes :** enseignant, responsable pédagogique, directeur, directeur des études, parent, élève

### 8.1 Objectif
Vérifier le circuit complet d'une feuille de notes : création de l'évaluation, saisie, soumission, relecture, approbation, publication, puis demande de correction d'une note publiée et son approbation. Contrôler la séparation des tâches (celui qui saisit ne relit pas, n'approuve pas et ne publie pas), l'immuabilité d'une note publiée, et le traitement d'une absence, d'une dispense ou d'un « non évalué » (jamais un zéro).

### 8.2 Avant de commencer
- **Qui fait quoi** :

| Étape | Rôle qui la fait | Droit |
|---|---|---|
| Créer l'évaluation, saisir les notes, soumettre | Enseignant (ou instituteur) | saisir |
| « Marquer comme relue » | Responsable pédagogique, directeur des études, directeur | relire |
| « Approuver » | Responsable pédagogique, directeur des études, directeur | approuver (sensible : code MFA) |
| « Publier les notes » | Directeur des études, directeur (PAS le responsable pédagogique) | publier (sensible : code MFA) |
| Demander une correction après publication | Enseignant | demander une correction |
| Approuver ou rejeter la correction | Directeur des études, directeur | approuver une correction (sensible : code MFA) |

La graine fait relire et approuver par le responsable pédagogique et publier par le directeur.

- **Comptes** (`http://<slug>.localhost:3100/v2/login`, mots de passe dans `.demo/credentials.md`, MFA par `pnpm demo:totp <e-mail>`) : enseignant `enseignant@demo-secondaire.test` (non), responsable pédagogique `pedagogie@demo-secondaire.test` (MFA oui), directeur `directeur@demo-secondaire.test` (oui), directeur des études `etudes@demo-secondaire.test` (oui), parent `parent@demo-secondaire.test`, élève `eleve@demo-secondaire.test`. Au primaire : `enseignant@demo-primaire.test` (instituteur).
- **Chemins** :
  - Enseignant : portail, « Mes évaluations » (`/v2/teacher/assessments`), « Nouvelle évaluation » (`/v2/teacher/assessments/new`), feuille de notes (`/v2/teacher/assessments/<identifiant>/grades`).
  - Direction : module « Évaluations » ; entrées « Feuilles à relire » (`/v2/assessments?status=SUBMITTED`), « Corrections de notes » (`/v2/assessments/revisions`), « Types d'évaluation » (`/v2/assessments/types`). La barre de l'écran propose « Évaluations » (`/v2/assessments`), « Nouvelle évaluation » (`/v2/assessments/new`), « Corrections de notes », « Types d'évaluation ». Détail d'une évaluation : `/v2/assessments/<identifiant>` ; notes : `/v2/assessments/<identifiant>/grades`.
  - Famille : « Mes résultats » (`/v2/student/results`), section résultats d'un enfant (`/v2/parent/children/<identifiant>/results`).
- **Données de démonstration (secondaire, classe 6E A, enseignant Kouadio TRAORE)** : toutes déjà **publiées**, période « Trimestre 1 » : « Premier contrôle » en Français et en Mathématiques, « Premier contrôle (suite) » en Anglais et en Histoire-Géographie (type « Devoir »), « Composition » dans les quatre matières ; huit élèves notés sur 20. En plus, un « Devoir de la période 2 » par matière (« Trimestre 2 ») publié. Les périodes 1 et 2 sont **verrouillées** ; la période 1 est clôturée avec ses résultats. Au primaire, mêmes notes pour le CP1 A en période 1 seulement ; au supérieur, « Examen » remplace « Composition ».
- **Pour créer vos propres évaluations**, choisissez une période non verrouillée (la dernière de l'année, « Trimestre 3 »). Types disponibles (secondaire et primaire) : « Interrogation », « Devoir », « Composition », « Examen blanc » (masqué aux élèves), « Projet », « Oral », « Travaux pratiques », « Autre », « Moyenne saisie » ; barème par défaut 20, coefficient 1.
- **Règle d'or** : une absence, une dispense ou un « non évalué » n'est jamais un zéro. Saisissez 0 uniquement pour une vraie note de zéro.

### 8.3 Scénarios
#### C08.1 Lire les évaluations de la graine
**Compte :** `pedagogie@demo-secondaire.test` (MFA oui) · **Où :** « Évaluations » (`/v2/assessments`)
1. Ouvrez « Évaluations ». Choisissez la classe 6E A.
2. Filtrez « État » sur « Publiée ». Lisez les colonnes « Évaluation », « Classe », « Type », « Date », « Barème », « État ».
3. Ouvrez « Composition » (Français) puis « Voir les notes ».
**Résultat attendu :** les évaluations de la graine sont « Publiée » ; la feuille montre huit notes sur 20, aucune case vide, et l'historique du circuit (« Historique du circuit de validation ») : saisie et soumission par Kouadio TRAORE, relecture et approbation par le responsable pédagogique, publication par le directeur, chacune avec son auteur et sa date.
- [ ] Évaluations de la graine toutes « Publiée »
- [ ] Historique du circuit lisible (qui, quand)
- [ ] Notes en lecture seule

#### C08.2 Note publiée : immuabilité
**Compte :** `enseignant@demo-secondaire.test` · **Où :** « Mes évaluations » > une évaluation publiée > « Voir les notes »
1. Ouvrez « Mes évaluations », choisissez la classe 6E A, ouvrez « Composition ».
2. Essayez de cliquer dans une note.
**Résultat attendu :** la feuille est en lecture seule avec le message « Notes publiées : elles ne se modifient plus. Utilisez « Corriger » pour demander une correction motivée. » Chaque ligne propose « Corriger » et « Historique » (selon les droits).
- [ ] Impossible de modifier une note publiée
- [ ] Le bouton « Corriger » est proposé

#### C08.3 Créer une évaluation
**Compte :** `enseignant@demo-secondaire.test` · **Où :** « Mes évaluations » > « Nouvelle évaluation » (`/v2/teacher/assessments/new`)
1. Choisissez le « Type d'évaluation » « Devoir » ; l'indication « Par défaut : 20 » apparaît pour le barème.
2. Saisissez l'« Intitulé » (« Devoir test C08 »), la « Date de l'évaluation », laissez « Barème (sur) » et « Coefficient » vides pour reprendre ceux du type.
3. Choisissez la « Classe » 6E A, le « Cours » (par exemple Français) et la « Période » (« Trimestre 3 »).
4. Cliquez « Créer l'évaluation ».
5. Variante : cochez « Créer pour plusieurs classes à la fois », ajoutez des lignes « Classe » + « Cours » (même type, intitulé, date et période pour chacune).
**Résultat attendu :** « Évaluation créée » (ou « 2 évaluations créées. ») avec le bouton « Saisir les notes » ; l'évaluation est à l'état « Brouillon ». Un champ « Session » (Session 1 ou « Session 2 (rattrapage) ») n'apparaît qu'au supérieur pour un type qui l'autorise.
- [ ] Évaluation créée en « Brouillon »
- [ ] Barème et coefficient repris du type
- [ ] Création multiple possible (variante)

#### C08.4 Saisir les notes, absences et dispenses
**Compte :** `enseignant@demo-secondaire.test` · **Où :** « Saisir les notes » sur l'évaluation créée
1. Saisissez des notes pour quelques élèves (par exemple 12,5 ; 15 ; 0). Utilisez Entrée ou la flèche bas pour passer à l'élève suivant, Ctrl + S pour enregistrer.
2. Pour un élève absent non justifié saisissez le code ABS ; pour un absent justifié ABJ ; pour un dispensé DISP ; pour un élève non évalué NN. Laissez un élève vide : « pas encore noté ».
3. Lisez le compteur « N sur M élèves notés » et le détail des absents et dispensés.
4. Observez l'enregistrement automatique (« Enregistrement automatique », puis « Enregistré à <heure> — N créée(s) »).
5. Option : collez une colonne de notes depuis un tableur.
**Résultat attendu :** la colonne « État » affiche « Noté », « Absent non justifié », « Absent justifié », « Dispensé » ou « Non évalué ». Une absence ou une dispense n'est jamais comptée comme un zéro (aide : « Une absence ou une dispense n'est pas un zéro : saisissez 0 seulement pour une note de zéro. »). Le 0 saisi reste une note.
- [ ] Notes enregistrées automatiquement
- [ ] Codes ABS, ABJ, DISP, NN reconnus et affichés en toutes lettres
- [ ] Un zéro et une absence restent distincts
- [ ] Le compteur de progression est juste

#### C08.5 Soumettre la feuille
**Compte :** `enseignant@demo-secondaire.test` · **Où :** barre « Circuit de validation » de l'évaluation
1. Dans la barre « Circuit de validation » (« Brouillon › Soumise › Relue › Approuvée › Publiée »), cliquez « Soumettre la feuille ».
2. Revenez à la feuille.
**Résultat attendu :** « La feuille de notes est soumise. » ; l'état devient « Soumise », la feuille n'est plus modifiable (« La feuille est soumise au circuit de validation : elle n'est plus modifiable. »). Les élèves laissés vides reçoivent automatiquement « Non évalué » (aucun trou). Soumettre sans aucune note est refusé : voir C08.N3.
- [ ] État « Soumise », feuille figée
- [ ] Les cases vides deviennent « Non évalué »

#### C08.6 Relire la feuille
**Compte :** `pedagogie@demo-secondaire.test` (MFA oui) · **Où :** « Évaluations » > « Feuilles à relire » (`/v2/assessments?status=SUBMITTED`)
1. Ouvrez « Feuilles à relire » : la liste est filtrée sur « Soumise ».
2. Ouvrez « Devoir test C08 ».
3. Cliquez « Marquer comme relue ».
**Résultat attendu :** « La feuille de notes est relue. » ; l'état devient « Relue ». La même fenêtre propose « Renvoyer en brouillon » (voir C08.N5).
- [ ] La feuille soumise apparaît dans « Feuilles à relire »
- [ ] État « Relue » après l'action

#### C08.7 Approuver la feuille (action sensible)
**Compte :** `pedagogie@demo-secondaire.test` · **Où :** détail de l'évaluation
1. Cliquez « Approuver ». La fenêtre « Confirmez votre identité » demande le code à 6 chiffres de l'application d'authentification (`pnpm demo:totp pedagogie@demo-secondaire.test`).
2. Saisissez le code, cliquez « Confirmer et continuer ».
**Résultat attendu :** « La feuille de notes est approuvée. », état « Approuvée ». Le bouton « Publier les notes » n'est PAS proposé au responsable pédagogique.
- [ ] Code MFA demandé
- [ ] État « Approuvée »
- [ ] Pas de bouton « Publier les notes » pour ce compte

#### C08.8 Publier les notes (irréversible)
**Compte :** `directeur@demo-secondaire.test` (MFA oui) ou `etudes@demo-secondaire.test` · **Où :** détail de l'évaluation
Attention : action irréversible. Une note publiée ne se modifie plus que par une correction approuvée. À faire en dernier et sur un seul compte ; `pnpm demo:reset` remet tout à zéro.
1. Ouvrez « Devoir test C08 » (état « Approuvée »).
2. Cliquez « Publier les notes », saisissez le code MFA.
**Résultat attendu :** « Les notes sont publiées. » ; état « Publiée » ; message d'aide « Les notes publiées ne se modifient plus : demandez une correction motivée, à faire approuver. » La feuille est en lecture seule.
- [ ] Publication confirmée, état « Publiée »
- [ ] Feuille en lecture seule après publication

#### C08.9 La famille voit les notes publiées, pas les autres
**Compte :** `parent@demo-secondaire.test`, `eleve@demo-secondaire.test` · **Où :** `/v2/parent/children/<identifiant>/results`, `/v2/student/results`
1. Parent : ouvrez Nadia DIABATE puis la section résultats.
2. Élève : ouvrez « Mes résultats ».
3. Avant la publication du C08.8, vérifiez que « Devoir test C08 » n'apparaît pas ; après, vérifiez qu'il apparaît.
**Résultat attendu :** seules les notes publiées sont visibles (notes de la graine, puis « Devoir test C08 » si la classe de l'enfant y est notée). Les évaluations d'un type masqué (« Examen blanc ») restent invisibles des familles.
- [ ] Une note non publiée n'est pas visible de la famille
- [ ] Une note publiée devient visible

#### C08.10 Demander une correction après publication, puis l'approuver
**Compte :** `enseignant@demo-secondaire.test` (demande), `etudes@demo-secondaire.test` ou `directeur@demo-secondaire.test` (décision) · **Où :** feuille d'une évaluation publiée, puis « Corrections de notes » (`/v2/assessments/revisions`)
Attention : l'approbation modifie une note publiée (acte sensible, tracé, code MFA).
1. Enseignant : sur « Devoir test C08 » (publiée), cliquez « Corriger » en face d'un élève. Saisissez la « Nouvelle valeur » (une note sur 20 ou un code ABS, ABJ, DISP, NN) et le « Motif de la correction » (10 caractères au moins). Cliquez « Envoyer la demande ».
2. Message : « La demande de correction est envoyée pour approbation. »
3. Direction des études : ouvrez « Corrections de notes ». La demande est « Demandée ». Cliquez « Approuver » (commentaire facultatif), saisissez le code MFA.
4. Variante : refusez une autre demande avec « Rejeter » et un motif.
5. Retournez à la feuille : « Historique » de la note montre l'ancienne et la nouvelle valeur, les auteurs et les dates.
**Résultat attendu :** sur une période non verrouillée (« Trimestre 3 ») : « Correction approuvée et appliquée. » et la nouvelle valeur apparaît. Sur une note de la graine (période 1 ou 2 verrouillée) : « Correction approuvée ; elle sera appliquée à la levée du verrou de période. » ; la demande reste « Approuvée » tant que la période est verrouillée. La note publiée n'est jamais réécrite en silence.
- [ ] Demande de correction créée avec motif
- [ ] Approbation avec code MFA, application immédiate hors période verrouillée
- [ ] Période verrouillée : correction approuvée mais appliquée plus tard
- [ ] Rejet avec motif
- [ ] Historique de la note complet

#### C08.11 Types d'évaluation et réglages de saisie
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Types d'évaluation » (`/v2/assessments/types`)
1. Lisez la liste : « Type », « Code », « Groupe », « Barème », « Coef. », « Publication » (« Publication manuelle » ou « Publication automatique à l'approbation »), « État ».
2. Repérez « Devoir » (groupe CONTINUOUS) et « Composition » (groupe EXAM).
3. Lisez la rubrique « Réglages de la saisie » : « Le relecteur doit être une autre personne que le saisissant », « L'approbateur doit être une autre personne que le relecteur », « Décimales autorisées ».
**Résultat attendu :** les types sont des données de l'établissement ; le groupe est la donnée lue par les règles de calcul. Les deux séparations des tâches sont cochées par défaut (recommandé). Ne pas décocher pendant les tests des cas limites.
- [ ] Types de démonstration présents
- [ ] Réglages de séparation des tâches visibles

#### C08.12 Saisie des notes hors ligne et conflit (aperçu ; détail au chapitre 22)
**Compte :** `enseignant@demo-secondaire.test`
1. Ouvrez la feuille d'une évaluation en brouillon, coupez le réseau (mode « Hors connexion »), saisissez deux notes.
2. Lisez le bandeau : « Hors ligne : 2 notes gardées sur cet appareil. Envoi à la reconnexion. »
3. Rétablissez le réseau : « Synchronisation des notes en cours… » puis « Notes synchronisées à <heure>. »
4. Pour un conflit : modifiez la même note depuis un autre onglet (en ligne) pendant que le premier est hors ligne, puis reconnectez le premier.
**Résultat attendu :** les notes saisies hors ligne sont gardées puis envoyées. En cas de modification entre-temps : « Notes modifiées par quelqu'un d'autre » avec, pour chaque élève, « Ma saisie » et « Valeur du serveur », et les choix « Garder la mienne » ou « Prendre celle du serveur » ; rien n'est écrasé sans votre choix. Si l'évaluation est figée entre-temps : « Évaluation figée ou période verrouillée : … ne peuvent plus être envoyées. »
- [ ] Notes hors ligne gardées puis envoyées
- [ ] Conflit présenté avec deux valeurs, sans écrasement automatique

### 8.4 Cas limites et tests négatifs
#### C08.N1 Séparation des tâches : celui qui saisit ne valide pas sa propre feuille
**Compte :** `directeur@demo-secondaire.test` (MFA oui)
1. Créez une évaluation de test, saisissez deux notes et soumettez-la (le directeur détient tous les droits).
2. Cliquez « Marquer comme relue » sur sa propre feuille.
**Résultat attendu :** refus avec le message : « La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier. » (affiché tel quel). Même refus pour « Approuver » et « Publier les notes ». Un autre compte (responsable pédagogique) doit prendre le relais.
- [ ] Relecture refusée à celui qui a soumis
- [ ] Approbation et publication refusées au même compte

#### C08.N2 Chaque rôle ne voit que ses boutons
**Compte :** `enseignant@demo-secondaire.test`, `pedagogie@demo-secondaire.test`
1. Enseignant : sur une feuille « Soumise », cherchez « Marquer comme relue », « Approuver », « Publier les notes ».
2. Responsable pédagogique : ouvrez `/v2/assessments/revisions` et, sur une feuille « Approuvée », cherchez « Publier les notes ».
**Résultat attendu :** l'enseignant n'a aucun de ces boutons ; le responsable pédagogique n'a pas « Publier les notes » et l'adresse « Corrections de notes » mène à une page d'accès refusé (il ne demande ni n'approuve de correction).
- [ ] Enseignant : pas de relecture, d'approbation ni de publication
- [ ] Responsable pédagogique : pas de publication ni de corrections

#### C08.N3 Feuille vide ou note invalide
**Compte :** `enseignant@demo-secondaire.test`
1. Créez une évaluation et soumettez sans rien saisir.
2. Saisissez « 25 » sur un barème de 20, « douze », ou une note à trop de décimales.
**Résultat attendu :** « Une évaluation sans aucune note ne peut pas être soumise. » ; « La note dépasse le barème (20). » ; « Saisissez un nombre (par exemple 12,5) ou un code : ABS, ABJ, DISP, NN. » ; « Au plus 1 décimale(s). » (selon le réglage). Les lignes invalides sont signalées (« N lignes invalides à corriger ») et l'enregistrement est refusé.
- [ ] Soumission d'une feuille vide refusée
- [ ] Note hors barème refusée
- [ ] Format invalide signalé

#### C08.N4 Période verrouillée
**Compte :** `enseignant@demo-secondaire.test`
1. Créez une évaluation dans la période « Trimestre 1 » (verrouillée) ou ouvrez une feuille de cette période.
2. Tentez de saisir ou soumettre.
**Résultat attendu :** « Les notes de cette période sont verrouillées : la période est clôturée ou en cours de clôture. Les saisies seront refusées. » ; la soumission est refusée (« La période de cette classe est verrouillée pour cette session. »).
- [ ] Saisie refusée sur période verrouillée

#### C08.N5 Retour en brouillon avec commentaire
**Compte :** `pedagogie@demo-secondaire.test`
1. Sur une feuille « Soumise », cliquez « Renvoyer en brouillon » et laissez le commentaire vide ou à 2 caractères.
2. Recommencez avec un commentaire d'au moins 5 caractères.
**Résultat attendu :** commentaire trop court refusé ; avec un bon commentaire : « La feuille est renvoyée en brouillon. », l'enseignant voit « Renvoyée en brouillon : <commentaire> » et peut corriger.
- [ ] Commentaire obligatoire (5 caractères)
- [ ] Retour en brouillon tracé dans l'historique

#### C08.N6 Correction mal motivée ou sans droit
**Compte :** `enseignant@demo-secondaire.test`
1. Sur une note publiée, « Corriger » avec un motif de moins de 10 caractères ou sans nouvelle valeur.
**Résultat attendu :** « Indiquez la nouvelle valeur. », « Valeur invalide : une note entre 0 et 20, ou un code d'état. », motif de 10 caractères au moins exigé ; rien n'est envoyé. Le demandeur ne peut pas approuver sa propre correction (l'enseignant n'a pas le droit d'approuver).
- [ ] Valeur et motif contrôlés
- [ ] L'enseignant ne peut pas approuver

#### C08.N7 Élément hors périmètre et isolation
**Compte :** `enseignant@demo-secondaire.test`, `directeur@demo-primaire.test`
1. Enseignant : ouvrez `/v2/assessments/00000000-0000-4000-8000-000000000000`.
2. Direction du primaire : ouvrez l'adresse d'une évaluation du secondaire (`/v2/assessments/<identifiant>`) sur `http://demo-primaire.localhost:3100`.
**Résultat attendu :** la page répond comme si l'évaluation n'existait pas ; aucune note d'un autre établissement n'apparaît.
- [ ] Évaluation inconnue ou d'un autre établissement : introuvable

#### C08.N8 Double action
**Compte :** `pedagogie@demo-secondaire.test`
1. Ouvrez la même feuille « Soumise » dans deux onglets ; relisez-la dans le premier, puis tentez de la relire dans le second.
**Résultat attendu :** « L'évaluation a été modifiée entre-temps : rechargez-la. » ; pas de double étape.
- [ ] Action répétée refusée proprement

### 8.5 Problèmes connus et limites
- Rapport QA M10 : sur la feuille de notes, le responsable pédagogique déclenche en arrière-plan un appel refusé (liste des cours de la classe) ; l'écran reste utilisable, des noms de cours peuvent s'afficher moins bien.
- Rapport QA M20 / P3 : l'enseignant déclenche un appel refusé pour la liste de toutes les classes sur `/v2/assessments` ; utiliser plutôt « Mes évaluations » du portail.
- Rapport QA : le responsable pédagogique n'a que 2 liens de menu dans la coque de gestion ; l'accès à « Feuilles à relire » passe par `/v2/assessments?status=SUBMITTED`.
- Les périodes 1 et 2 du secondaire étant verrouillées dans la démonstration, toute correction sur les notes de la graine est « approuvée mais appliquée plus tard » : pour voir l'application immédiate, créez votre propre évaluation en « Trimestre 3 ».
- La note chiffrée ne sert qu'à la saisie : moyennes, rangs et mentions sont calculés ailleurs (module « Résultats », chapitre dédié) avec des règles de DÉMONSTRATION (bandeau « règles de démonstration »). Aucun barème officiel n'est présenté.
- Fonction « Session 2 (rattrapage) » : supérieur seulement, selon l'offre.
- Pas de publication en lot ni d'écarts à la moyenne de la classe dans « Feuilles à relire » (la liste est filtrée par état).

### 8.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 011 §9 « Feuilles à relire » : écarts à la moyenne de la classe, valeurs aberrantes, publication en lot : non constatés (liste filtrée par état seulement).
- Spec 011 §9 « Corrections » : comparaison ancienne/nouvelle valeur : partielle (valeurs dans la carte de demande et l'historique de la note).
- Spec 011 §9 : « Période : tableau de bord » et « Résultats de classe » relèvent du module « Résultats » (chapitre suivant) ; « Mes notes » (élève) et « Notes de mes enfants » (parent) du manifeste sont servies par « Mes résultats » du portail famille.
- Le manifeste du module nomme le circuit « relecture > validation > publication » ; dans l'application, « Approuver » correspond au droit de validation (`grade.validate`) tenu par le responsable pédagogique, la publication par la direction des études ou le directeur.
- Les entrées de menu du manifeste « Feuilles à relire », « Corrections de notes », « Types d'évaluation » sont réécrites vers `/v2/assessments?status=SUBMITTED`, `/v2/assessments/revisions` et `/v2/assessments/types` : conformes.


## Chapitre 9. Moteur de règles et résultats
> **Durée estimée :** 60 à 90 minutes · **Établissement(s) :** Collège Le Baobab (`demo-secondaire`), en complément École Les Palmiers (`demo-primaire`) et Université Horizon (`demo-superieur`) · **Comptes :** directeur, directeur des études, propriétaire

### 9.1 Objectif
Vérifier que les moyennes, rangs, mentions et décisions ne sont jamais saisis à la main : ils sont calculés par des « règles de calcul » choisies pour l'établissement. Vous parcourez le cycle d'une période (ouverte, notes verrouillées, délibérée, clôturée), vous demandez puis faites approuver une correction exceptionnelle par une autre personne, et vous contrôlez qu'un résultat clôturé ne peut plus être modifié sans réouverture motivée.

Important : les écoles primaire et secondaire de démonstration utilisent des jeux de règles de DÉMONSTRATION (fictifs). Aucune règle officielle ivoirienne (passage, redoublement, mentions, examens) n'est livrée ni inventée. Les valeurs que vous verrez n'ont aucune valeur officielle. Le supérieur utilise le jeu `CI-HIGHER-LMD` de la plateforme (reprise du calcul historique à crédits).

### 9.2 Avant de commencer
- **Comptes** (adresse de connexion `http://demo-secondaire.localhost:3100/v2/login`, MFA obligatoire pour les trois) :
  - Directeur : `directeur@demo-secondaire.test` (tous les droits sur les résultats, y compris approuver une surcharge et rouvrir une période).
  - Directeur des études : `etudes@demo-secondaire.test` (verrouille, délibère, clôture, demande une surcharge ; ne la valide pas, ne rouvre pas).
  - Propriétaire : `direction.generale@demo-secondaire.test` (tous les droits).
  - Les mots de passe sont dans le fichier des comptes de démonstration (`.demo/credentials.md`). Le code MFA s'obtient avec `pnpm demo:totp <e-mail>` (voir l'introduction).
- **Menus** : « Résultats de classe » (`/v2/results/matrix`), « Périodes : verrouillage et clôture » (`/v2/results`), « Délibérations » (`/v2/results/decisions`), « Règles de calcul » (`/v2/rules`). Dans les écrans de résultats, une barre de rubriques propose : « Périodes », « Résultats de classe », « Décisions et délibérations », « Surcharges », « Rattrapage ».
- **Adresses utiles** : `/v2/results`, `/v2/results/matrix`, `/v2/results/decisions`, `/v2/results/overrides`, `/v2/rules`, `/v2/rules/bindings`, `/v2/rules/versions/<identifiant>`, `/v2/results/<identifiant>/explain`, `/v2/results/year/<inscription>/<année>`.
- **Données de démonstration** :
  - Secondaire, classe « 6e A », année 2026-2027, trois trimestres. Le « Trimestre 1 » est clôturé (résultats définitifs, calculés par le jeu fictif `CI-SECONDARY-PLACEHOLDER`). Le « Trimestre 2 » a ses notes publiées puis verrouillées ; le conseil de classe de cette période est ouvert. Quatre matières : Français (coefficient 3), Mathématiques (3), Anglais (2), Histoire-Géographie (2).
  - Élèves ayant des notes : les huit premiers de la liste (Nadia DIABATE, Salimata DIABATE, Aya BAMBA, Fatou BAMBA, Moussa COULIBALY, Salimata COULIBALY, Yao TOURE, Jean-Marc TOURE) ; un neuvième élève, inscrit par le circuit d'admission, n'a pas de notes.
  - Primaire, classe « CP1 A » : « Trimestre 1 » clôturé, jeu fictif `CI-PRIMARY-PLACEHOLDER`. Supérieur, classe « Licence 1 A » : « Semestre 1 » clôturé, jeu `CI-HIGHER-LMD` (voir le chapitre 11).
  - Le réglage « délibération obligatoire » est désactivé dans la démonstration : la clôture confirme elle-même les décisions proposées.
- Les actions de clôture et de réouverture sont difficiles à défaire : faites-les en dernier et sur un seul compte (voir « Attention » dans les scénarios). `pnpm demo:reset` remet tout à zéro.

### 9.3 Scénarios

#### C09.1 Consulter le catalogue des règles
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Règles de calcul » (`/v2/rules`)
1. Ouvrez le menu « Règles de calcul ». Le titre est « Règles de calcul ».
2. Dans « Rechercher un jeu de règles », tapez `PLACEHOLDER`. Filtrez « Origine » sur « National ».
3. Repérez « Secondaire — jeu de démonstration (fictif) » (code `CI-SECONDARY-PLACEHOLDER`) et « Primaire — jeu de démonstration (fictif) » (code `CI-PRIMARY-PLACEHOLDER`). Sans le filtre, repérez aussi « Supérieur à crédits (LMD) — UE / ECUE » (code `CI-HIGHER-LMD`).
4. Pour une ligne de version, lisez la colonne « État » (« Publiée »), « Période d'effet » (« Du … au sans fin ») et « Contrat ».
5. Cliquez sur « Ouvrir » pour une version. Une page « Retour au catalogue » s'affiche avec les rubriques « Règles », « Simulation » et « Journal ».
**Résultat attendu :** les jeux nationaux sont en lecture seule (badge « Lecture seule » ; la page de version indique « Version nationale : en lecture seule. Créez une variante de l'établissement… »). Les jeux fictifs portent « démonstration (fictif) » dans leur nom. La rubrique « Journal » liste les événements de la version.
- [ ] Les trois jeux sont visibles et marqués « National » / « Lecture seule »
- [ ] Les jeux de démonstration sont reconnaissables par leur nom
- [ ] La page de version affiche les règles du jeu (ou « Cette version ne contient aucune règle. ») et un journal

#### C09.2 Voir quel jeu de règles s'applique à l'établissement
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Règles de calcul » puis la rubrique « Liaisons aux programmes » (`/v2/rules/bindings`)
1. Ouvrez « Liaisons aux programmes » (titre « Liaisons des règles »).
2. Pour chaque « Contrat de calcul » affiché, lisez le tableau : « Jeu de règles », « Périmètre », « Dates d'effet », et l'état (« En vigueur », « À venir », « Échue »).
3. Dans le secondaire, cherchez le contrat annuel du secondaire (`secondary-annual@1`) lié à `CI-SECONDARY-PLACEHOLDER` pour les niveaux `LOWER_SECONDARY` et `UPPER_SECONDARY` (périmètre « Niveau : … »).
4. Répétez avec `direction.generale@demo-superieur.test` sur `http://demo-superieur.localhost:3100/v2/rules/bindings` : le contrat `credit-semester@1` est lié à `CI-HIGHER-LMD` pour « Tout l'établissement (par défaut) » depuis le 1er septembre 2024.
5. Répétez dans l'école primaire (`direction.generale@demo-primaire.test`) : `coef-period@1` pour le niveau `PRIMARY` et `competency-period@1` pour le niveau `PRESCHOOL`, tous deux liés à `CI-PRIMARY-PLACEHOLDER`.
**Résultat attendu :** chaque pack a son jeu de règles ; aucun jeu officiel ivoirien n'est présent pour le primaire et le secondaire. Un indicateur « programme sans règle active » apparaît seulement si un programme n'est couvert par aucune liaison.
- [ ] Secondaire : jeu `CI-SECONDARY-PLACEHOLDER` lié
- [ ] Primaire : jeu `CI-PRIMARY-PLACEHOLDER` lié
- [ ] Supérieur : jeu `CI-HIGHER-LMD` lié, effet depuis 2024-09-01
- [ ] Les boutons « Ajouter une liaison », « Modifier », « Supprimer » ne servent qu'à ceux qui ont le droit de gérer les liaisons (ne les utilisez pas pour ce test)

#### C09.3 Créer une variante et la simuler (sans toucher aux résultats)
**Compte :** `directeur@demo-secondaire.test` · **Où :** `/v2/rules`
1. Sur une version nationale « Publiée » d'un jeu (par exemple `CI-SECONDARY-PLACEHOLDER`), cliquez sur « Créer une variante ». Le bouton n'apparaît que si votre offre inclut les variantes et que vous avez le droit de les créer.
2. Dans la fenêtre « Variante de … », renseignez le « Nom de la variante » (facultatif), la « Date d'effet » et éventuellement « Notes », puis « Créer la variante ».
3. Un message « La variante est créée en brouillon. » apparaît avec le lien « Ouvrir la variante ». Ouvrez-le.
4. Ouvrez la rubrique « Simulation ». Dans « Données à rejouer », choisissez la classe « 6e A » et la période « Trimestre 1 », cliquez sur « Ajouter », puis « Lancer la simulation ».
5. Attendez la fin (« Simulation en cours : … % »), puis lisez le « Rapport de simulation » : « Cas rejoués », « Modifiées », « Inchangées », « Nouvelles erreurs », « Décisions modifiées ».
**Résultat attendu :** la variante est un brouillon modifiable ; la simulation se termine et, une variante identique à son jeu de base, annonce « Aucune différence : la version produit les mêmes résultats. » Aucun résultat existant n'est modifié (le catalogue le rappelle : « Publier une règle ne recalcule aucun résultat existant »). L'approbation et la publication d'une variante sont réservées à l'opérateur de la plateforme (note de la page : « L'établissement propose ; l'approbation et la publication sont réservées à l'opérateur de la plateforme. »).
- [ ] Variante créée en brouillon
- [ ] Simulation terminée avec un rapport lisible
- [ ] Le « Trimestre 1 » de la classe reste « Clôturée » avec les mêmes résultats (vérifiez en C09.4)

#### C09.4 Lire l'état d'une période clôturée
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Périodes : verrouillage et clôture » (`/v2/results`)
1. Choisissez la classe « 6e A » et la période « Trimestre 1 » (les listes « Classe » et « Période » se trouvent en haut de l'écran).
2. Lisez la section « État de la période » : étiquette « Clôturée », étapes « Ouverte › Notes verrouillées › Délibérée › Clôturée », « Règle appliquée » (jeu et version, par exemple `CI-SECONDARY-PLACEHOLDER · v2`, à confirmer), « Empreinte de la règle », « Version des résultats », dates « Notes verrouillées le », « Clôturée le ».
3. Lisez « Résultats de la classe » : « Inscriptions », « Provisoires », « Définitifs », « En erreur ».
4. Lisez la section « Clôtures » : une ligne « Version 1 — N résultats figés le … » avec l'« Empreinte de clôture ».
**Résultat attendu :** état « Clôturée », « Définitifs » égal au nombre d'inscriptions de la classe (neuf, à confirmer), « Provisoires » à 0, « En erreur » à 0. Aucun bouton « Verrouiller les notes », « Relancer le calcul » ni « Clôturer la période » n'est proposé ; seul « Rouvrir la période » existerait, mais il est réservé au directeur et au propriétaire (donc absent pour `etudes@`).
- [ ] État « Clôturée » et jeu de règles affiché
- [ ] Compteurs cohérents (définitifs = effectif, 0 en erreur)
- [ ] Une clôture « Version 1 » avec son empreinte
- [ ] Pas de bouton « Rouvrir la période » pour le directeur des études

#### C09.5 Lire les résultats de la classe
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Résultats de classe » (`/v2/results/matrix`)
1. Choisissez « 6e A » et « Trimestre 1 ».
2. Lisez la ligne « Règle … — version des résultats 1 » et l'étiquette de l'état de la période.
3. Passez « Ordre d'affichage » de « Par nom » à « Par rang ».
4. Cochez « Afficher le détail par cours » : une colonne par matière apparaît.
5. Survolez une moyenne : l'infobulle donne « Valeur exacte : … ».
**Résultat attendu :** tableau « Résultats des élèves de la classe » avec les colonnes « Élève », « Moyenne », « Rang » (au format « 1 sur 9 »), « Mention », « Décision », « État » (badge « Définitif »). Les moyennes ne sont pas saisissables : elles viennent des règles. Le neuvième élève (sans notes) ne doit pas masquer les autres résultats (à confirmer : valeur vide ou état particulier). Aucun avertissement « résultats provisoires » (« Des résultats sont provisoires… ») sur ce trimestre.
- [ ] Moyennes, rangs, mentions et décisions affichés pour les élèves notés
- [ ] Tri par rang cohérent (le rang 1 est en tête)
- [ ] Le détail par cours affiche une note par matière

#### C09.6 « Pourquoi cette moyenne ? » (explication d'un résultat)
**Compte :** `directeur@demo-secondaire.test` (ou `etudes@`) · **Où :** « Résultats de classe » puis le lien « Pourquoi ? » d'un élève
1. Dans le tableau, cliquez sur « Pourquoi ? » sur la ligne de Nadia DIABATE.
2. Lisez la page « Pourquoi ce résultat ? » : message « Résultat définitif : trace enregistrée lors de la clôture. », bloc « Résultat » (« Règle appliquée », « Contrat », « Moteur de règles », « Version du résultat », « Calculé le », « Figé le », empreintes des règles, des entrées et des sorties).
3. Lisez « … lignes de résultat » : une ligne par matière et pour la période (niveaux « Matière », « Période »). Dépliez le contexte de l'appel (« Contexte de l'appel ») et les « Pas de calcul ».
4. Cliquez sur « Retour aux résultats ».
**Résultat attendu :** la chaîne de calcul est lisible (variables d'entrée, expression, valeur). La page n'affiche les données d'aucun autre élève. Le directeur des études, le directeur et le propriétaire ont ce droit ; l'enseignant non.
- [ ] Trace affichée, empreintes présentes
- [ ] Une valeur de matière se retrouve dans la trace (notes entrées puis moyenne pondérée)
- [ ] « Retour aux résultats » revient à la classe

#### C09.7 Résultat annuel incomplet
**Compte :** `directeur@demo-secondaire.test` · **Où :** « Résultats de classe » puis le lien « Année » d'un élève
1. Sur la ligne d'un élève, cliquez sur « Année ».
2. Lisez « Résultat annuel » : « Résultat incomplet : une ou plusieurs périodes ne sont pas clôturées. » et « Périodes manquantes : … ».
3. Dans « Périodes », lisez le tableau « Résultats par période » (« Période », « Moyenne », « Décision », « État » : « Définitif » ou « Provisoire »).
**Résultat attendu :** une seule période est définitive ; l'année est signalée incomplète.
- [ ] Message d'incomplétude présent
- [ ] Le Trimestre 1 apparaît « Définitif »

#### C09.8 Demander puis faire approuver une surcharge (deux personnes)
**Comptes :** `etudes@demo-secondaire.test` pour la demande, puis `directeur@demo-secondaire.test` pour l'approbation · **Où :** « Surcharges » (`/v2/results/overrides`)
1. Avec `etudes@`, ouvrez la rubrique « Surcharges ». Choisissez « 6e A » et « Trimestre 2 » (période verrouillée : une surcharge est possible tant que la période n'est pas clôturée).
2. Cliquez sur « Demander une surcharge ». Dans « Demander une surcharge » : « Élève » (par exemple Aya BAMBA), « Niveau » = « Période », « Règle ciblée » = `moyenne_ponderee`, « Nature » = « Valeur imposée », « Valeur imposée » = `12`, « Justification » (20 caractères au moins, par exemple « Erreur de saisie constatée sur la copie de composition »).
3. Cliquez sur « Envoyer la demande ». Message : « La demande de surcharge est enregistrée ; elle doit être approuvée par une autre personne. »
4. La liste « Surcharges » montre la demande à l'état « Demandée », avec « Demandée par … le … ». Notez que `etudes@` n'a pas de bouton « Approuver ».
5. Déconnectez-vous, connectez-vous avec `directeur@demo-secondaire.test`, rouvrez « Surcharges » (même classe et période). Cliquez sur « Approuver » à côté de la demande, ajoutez éventuellement un commentaire, confirmez.
6. Message « La surcharge est approuvée. » État « Approuvée ».
7. Ouvrez « Résultats de classe » sur « Trimestre 2 » : la moyenne d'Aya BAMBA est soulignée en pointillés (infobulle « Valeur surchargée (approuvée) ») dans le détail, et la page « Pourquoi ce résultat ? » indique « Valeur imposée par une surcharge approuvée (valeur calculée : … ). »
**Résultat attendu :** la note de départ n'est jamais modifiée ; seule la moyenne affichée change, de façon tracée. Une surcharge refusée peut être « Rejetée » (avec motif) ; une approuvée peut être « Révoquée » (avec motif), le résultat redevient alors celui calculé par les règles.
- [ ] Demande créée et visible à l'état « Demandée »
- [ ] Seul le second compte voit « Approuver », « Rejeter », « Révoquer »
- [ ] Après approbation, la valeur imposée apparaît et est signalée comme surchargée
- [ ] (Facultatif) « Révoquer » avec un motif : la valeur calculée revient

#### C09.9 Décisions, délibérations et appréciations
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Délibérations » (`/v2/results/decisions`)
1. Choisissez « 6e A » et « Trimestre 1 » : onglet « Décisions ». Lisez le tableau « Décisions des élèves » : « Élève », « Nature », « Proposée par la règle », « Décision retenue », « État » (« Confirmée »).
2. Choisissez « Trimestre 2 ». Les décisions peuvent être vides (« Aucune décision. Les décisions sont proposées à la clôture du calcul de la période. ») ; sinon des décisions « Proposée » portent un bouton « Confirmer ».
3. Ouvrez l'onglet « Délibérations » : cliquez sur « Planifier une délibération », choisissez la nature (« Conseil de classe » ou « Jury »), éventuellement la « Date de la séance » et des participants, puis « Planifier ». Message : « La délibération est planifiée. » Marquez-la « Marquer comme tenue ».
4. Ouvrez l'onglet « Appréciations » : « Rédiger une appréciation » pour un élève (jusqu'à 1 000 caractères), « Enregistrer l'appréciation ».
5. Si une décision est « Proposée » : cliquez sur « Confirmer ». Dans la fenêtre, vous pouvez « Retenir une autre décision » : le motif doit faire 20 caractères au moins et la proposition de la règle est conservée.
**Résultat attendu :** la règle propose, l'humain confirme ou modifie avec un motif écrit, et les deux sont conservées. Les décisions du Trimestre 1 sont déjà « Confirmée » (clôture sans délibération).
- [ ] Décisions du Trimestre 1 confirmées
- [ ] Délibération planifiée puis marquée « Tenue »
- [ ] Appréciation enregistrée
- [ ] Changer une décision sans motif suffisant est refusé (« Le motif doit faire au moins 20 caractères. »)

#### C09.10 Délibérer puis clôturer le Trimestre 2
**Attention : action irréversible sans réouverture motivée.** À faire en dernier, avec un seul compte (`directeur@` ou `etudes@`).
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Périodes : verrouillage et clôture » (`/v2/results`)
1. Choisissez « 6e A » et « Trimestre 2 » : état « Notes verrouillées ». Vérifiez qu'il n'y a pas de bandeau « évaluations non publiées ».
2. Cliquez sur « Enregistrer la délibération ». Dans la fenêtre, cochez éventuellement « Confirmer d'un coup les décisions proposées par les règles », puis « Enregistrer la délibération ». Message « La délibération est enregistrée. », état « Délibérée ».
3. Cliquez sur « Clôturer la période ». La fenêtre « Clôturer la période » avertit : « Les résultats deviennent définitifs. Pour les corriger plus tard, il faudra rouvrir la période avec un motif (nouvelle version des résultats). » Confirmez avec « Clôturer ».
4. Message « Période clôturée : N résultats figés (version 1), aucune exclusion. »
**Résultat attendu :** état « Clôturée », « Définitifs » = effectif, section « Clôtures » avec « Version 1 ». Si des inscriptions sont « En erreur », la clôture est refusée tant qu'on ne coche pas « Clôturer en excluant les inscriptions en erreur » avec un motif de 10 caractères au moins.
- [ ] Étapes franchies dans l'ordre (verrouillée, délibérée, clôturée)
- [ ] Résultats devenus « Définitif »
- [ ] Pas de bouton « Clôturer la période » après la clôture

#### C09.11 Rouvrir une période avec un motif
**Attention : action sensible, tracée ; elle libère les notes.** À faire en dernier.
**Compte :** `directeur@demo-secondaire.test` · **Où :** `/v2/results`
1. Choisissez « 6e A » et la période clôturée (par exemple « Trimestre 2 » après C09.10, ou « Trimestre 1 »).
2. Cliquez sur « Rouvrir la période ». Choisissez la « Nature de la réouverture » : « Correction (toutes les notes redeviennent modifiables) » ou « Session de rattrapage (session 2 seulement) ».
3. Saisissez un « Motif de la réouverture » de 10 caractères au moins, puis « Rouvrir ». Message « La période est rouverte. »
4. Relisez « État de la période » : « Ouverte », ainsi que « Rouverte une fois. Dernier motif : … ».
5. Les bulletins de cette période apparaîtront « À réémettre » après une nouvelle clôture (voir le chapitre 10).
**Résultat attendu :** la période repasse à l'état « Ouverte » ; la version précédente des résultats reste consultable et la prochaine clôture crée la version 2. Les décisions confirmées sont retirées et devront être reconfirmées.
- [ ] Réouverture refusée tant que le motif a moins de 10 caractères
- [ ] État « Ouverte » avec le dernier motif affiché
- [ ] (Facultatif) nouvelle clôture : une « Version 2 » apparaît dans « Clôtures »

### 9.4 Cas limites et tests négatifs

#### C09.N1 Le directeur des études ne peut pas approuver ni rouvrir
**Compte :** `etudes@demo-secondaire.test`
1. Ouvrez « Surcharges » sur une demande « Demandée » : aucun bouton « Approuver », « Rejeter » ni « Révoquer ».
2. Ouvrez une période clôturée : aucun bouton « Rouvrir la période ».
3. Ouvrez « Règles de calcul » : aucun bouton « Créer une variante ». Dans « Liaisons aux programmes » : aucun bouton « Ajouter une liaison ».
**Résultat attendu :** les actions sensibles sont absentes ; si vous forcez l'adresse d'une page sans droit, un message d'accès refusé s'affiche.
- [ ] Aucun de ces boutons n'est visible

#### C09.N2 Pas d'approbation par le demandeur lui-même
**Compte :** `directeur@demo-secondaire.test`
1. Demandez une surcharge (même procédure que C09.8, avec une autre élève, par exemple Fatou BAMBA) avec le directeur.
2. Essayez de l'approuver avec le même compte.
**Résultat attendu :** refus avec un message du type « Le demandeur d'une surcharge ne peut pas l'approuver lui-même. » (libellé exact à confirmer). Par défaut la séparation des tâches est active.
- [ ] L'approbation par la même personne est refusée

#### C09.N3 Justification trop courte
**Compte :** `etudes@demo-secondaire.test`
1. Demandez une surcharge avec une justification de moins de 20 caractères.
**Résultat attendu :** l'envoi est refusé, avec une erreur sur le champ « Justification » (« 20 caractères au moins. »).
- [ ] La demande n'est pas créée

#### C09.N4 Surcharge impossible sur une période clôturée
**Compte :** `etudes@demo-secondaire.test`
1. Choisissez « Trimestre 1 » (clôturé) dans « Surcharges » et tentez « Demander une surcharge ».
**Résultat attendu :** refus du type « La période est clôturée : rouvrez-la pour surcharger un résultat. »
- [ ] La demande est refusée

#### C09.N5 Résultat définitif immuable
**Compte :** `directeur@demo-secondaire.test`
1. Sur « Trimestre 1 » (clôturé), cherchez un bouton « Relancer le calcul » : il n'y en a pas.
2. Dans « Résultats de classe », aucune moyenne n'est modifiable.
3. Tentez de confirmer ou de modifier une décision sur le Trimestre 1 (onglet « Décisions »).
**Résultat attendu :** aucune modification possible (message du type « La période est clôturée : les décisions sont figées. »). La seule voie est la réouverture motivée (C09.11).
- [ ] Aucune modification n'est possible sans réouverture

#### C09.N6 Motifs obligatoires
**Compte :** `directeur@demo-secondaire.test`
1. Tentez « Rouvrir la période » avec un motif de moins de 10 caractères.
2. Tentez une décision différente de la proposition avec un motif de moins de 20 caractères.
**Résultat attendu :** « Le motif doit faire au moins 10 caractères. » puis « Le motif doit faire au moins 20 caractères. »
- [ ] Les deux motifs sont exigés

#### C09.N7 Accès refusé aux comptes sans droit
**Comptes :** `enseignant@demo-secondaire.test` (sans MFA), `parent@demo-secondaire.test`
1. Avec l'enseignant, saisissez `/v2/results` dans la barre d'adresse.
2. Avec le parent, saisissez `/v2/results/matrix`.
**Résultat attendu :** message d'accès refusé (ou redirection), jamais la liste des résultats de la classe. L'enseignant peut seulement rédiger des appréciations (droit « Rédiger les appréciations »).
- [ ] Accès refusé pour l'enseignant
- [ ] Accès refusé pour le parent

#### C09.N8 Isolation entre établissements
**Compte :** `directeur@demo-secondaire.test`
1. Ouvrez `http://demo-primaire.localhost:3100/v2/login` et tentez de vous y connecter avec l'adresse `directeur@demo-secondaire.test`.
2. Dans le secondaire, saisissez `/v2/results/00000000-0000-0000-0000-000000000000/explain`.
**Résultat attendu :** la connexion échoue (compte inconnu dans cet établissement). L'adresse inventée répond comme si l'élément n'existait pas (page introuvable ou message « Cet élément est introuvable ou hors de votre périmètre »).
- [ ] Aucune donnée d'un autre établissement n'apparaît

### 9.5 Problèmes connus et limites
- Les écrans de résultats et de règles n'affichent PAS le bandeau « Règles de démonstration » (il apparaît sur les écrans du module primaire, des examens et de la direction). La mention figure en revanche sur les documents (filigrane « DÉMONSTRATION », pied de page) : voir le chapitre 10.
- Verrouiller une période n'est testable que si une période ouverte existe (la démonstration n'en fournit pas après le Trimestre 2 verrouillé). Le forçage du verrouillage avec évaluations non publiées (« Verrouiller malgré les évaluations non publiées », motif de 10 caractères) ne peut donc pas être déroulé sans créer d'abord une évaluation non publiée sur une période ouverte.
- Le recalcul des brouillons est différé de quelques secondes après la publication d'une note : un « Provisoire » peut mettre un instant à apparaître.
- Les listes de choix d'élèves de l'écran « Surcharges » affichent « Inscription … » si le nom n'a pas pu être lu.
- Le calcul des « règles de démonstration » est un jeu fictif : ne comparez jamais ses moyennes ou décisions à un barème officiel.
- Constat QA ayant touché ce périmètre : erreur d'hydratation signalée sur `/v2/reportcards/issue` et `/v2/higher/credits` (corrigée, à reconfirmer après redémarrage du web).

### 9.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 012 : l'approbation et la publication d'une variante par l'opérateur de la plateforme ne sont pas parcourables depuis l'application d'établissement ; l'écran « Règles » ne montre pas de marqueur « démonstration » sur les jeux fictifs (seul le nom l'indique).
- Spec 011 : le forçage du verrouillage et la clôture forcée (exclusion d'inscriptions en erreur) ne sont pas exerçables avec les données de démonstration.
- Spec 011 US7 (lecture famille des résultats) : traitée au chapitre 20 (portails) (`/v2/parent/children/<id>/results`, `/v2/student/results`).

---

## Chapitre 10. Bulletins et documents officiels
> **Durée estimée :** 60 à 90 minutes · **Établissement(s) :** Collège Le Baobab (`demo-secondaire`), École Les Palmiers (`demo-primaire`), Université Horizon (`demo-superieur`) · **Comptes :** propriétaire, directeur, directeur des études, secrétariat, parent, élève (et visiteur sans connexion)

### 10.1 Objectif
Vérifier la chaîne complète d'un bulletin : identité imprimée, signataires, modèle, émission d'un lot pour une classe, génération des PDF, publication aux familles, téléchargement, remplacement (réémission), révocation, et vérification publique d'authenticité par le code ou le QR code, sans connexion. Un bulletin est un instantané figé des résultats clôturés : il ne bouge plus ensuite.

Les bulletins de démonstration reposent sur des règles de démonstration : chaque PDF porte le filigrane « DÉMONSTRATION » et la mention « Règles de démonstration — document sans valeur officielle ».

### 10.2 Avant de commencer
- **Comptes** (adresse de connexion `http://<slug>.localhost:3100/v2/login`, avec le slug `demo-secondaire`, `demo-primaire` ou `demo-superieur`) :
  - Propriétaire `direction.generale@<slug>.test` et directeur `directeur@<slug>.test` : tous les droits sur les bulletins (MFA oui).
  - Directeur des études `etudes@<slug>.test` : émet, publie, configure les modèles ; ne révoque pas, ne gère ni l'identité ni les signataires (MFA oui).
  - Secrétariat `secretariat@<slug>.test` : consulte et émet ; ne publie pas, ne révoque pas (MFA oui).
  - Parent `parent@<slug>.test` (Séka DIABATE, enfants Nadia et Salimata DIABATE) et élève `eleve@<slug>.test` (compte de Nadia DIABATE) : sans MFA.
  - Mots de passe : fichier des comptes de démonstration (`.demo/credentials.md`) ; code MFA : `pnpm demo:totp <e-mail>`.
- **Prérequis technique :** le worker (tâche de fond) a besoin de Chrome, Chromium ou Edge pour fabriquer les PDF. Si les PDF restent « PDF en attente » ou « PDF en échec », voir le dépannage de l'introduction.
- **Menus** (barre de rubriques « Bulletins et documents ») : « Bulletins émis » (`/v2/reportcards`), « Émettre » (`/v2/reportcards/issue`), « Mes bulletins » (`/v2/reportcards/family`), « Modèles de documents » (`/v2/reportcards/templates`), « Identité et réglages » (`/v2/reportcards/identity`), « Signataires » (`/v2/reportcards/signatories`). Entrées du menu principal : « Bulletins — émission », « Bulletins — liste », « Identité et signataires », « Modèles de documents ». Vérification publique : `/v2/verify` (sans connexion).
- **Données de démonstration :**
  - Secondaire : 9 bulletins du « Trimestre 1 » de la classe « 6e A » (gabarit `secondary-bulletin`), PDF prêts, signés et PUBLIÉS aux familles.
  - Primaire : 8 bulletins de « CP1 A » (gabarit `primary-bulletin`). Supérieur : relevés du « Semestre 1 » de « Licence 1 A » (gabarit `higher-bulletin-credits`, avec crédits), publiés.
  - Identité imprimée : nom officiel de l'établissement sans « (démonstration) », en-tête gauche « République de Côte d'Ivoire (démonstration) », adresse « Abidjan, Côte d'Ivoire », couleur principale `#14532D`. Signataire : « Directeur Fictif » (qualité « Chef d'établissement », fonction « Direction »).
- Les actions de réémission et de révocation ne se défont pas : faites-les en dernier, sur un seul compte et sur un seul bulletin (dans nos exemples : Jean-Marc TOURE).

### 10.3 Scénarios

#### C10.1 Identité imprimée et réglages
**Compte :** `direction.generale@demo-secondaire.test` · **Où :** « Identité et réglages » (`/v2/reportcards/identity`)
1. Ouvrez la page « Identité de l'établissement et réglages ».
2. Lisez la section « Identité visuelle » : « Version N enregistrée le … », champs « Nom officiel », « En-tête gauche », « Adresse », « Couleur principale ».
3. Modifiez le champ « Pied de page » (par exemple « Document de démonstration »), cliquez sur « Enregistrer l'identité ». Message « L'identité est enregistrée (version N+1). ».
4. Lisez « N versions de l'identité » : la version précédente reste listée, la nouvelle porte le badge « En vigueur ».
5. Lisez « Réglages des documents » : « Exiger une délibération avant l'émission », « Afficher la mention sur la page publique de vérification » (désactivé par défaut), « Bloquer l'accès aux bulletins en cas d'impayé ». Ne les modifiez pas pour ce test.
**Résultat attendu :** chaque modification crée une nouvelle version ; les documents déjà émis ne changent pas.
- [ ] Nouvelle version d'identité enregistrée
- [ ] Les bulletins déjà émis sont inchangés (ouvrez-en un et comparez avec C10.4)
- [ ] Les trois réglages sont lisibles

#### C10.2 Signataires
**Compte :** `direction.generale@demo-secondaire.test` · **Où :** « Signataires » (`/v2/reportcards/signatories`)
1. Lisez la liste « Signataires » : « Directeur Fictif », badge « Actif », mention de signature (« signature enregistrée » ou « aucune signature »).
2. Cliquez sur « Nouveau signataire », saisissez « Nom complet », « Qualité » (par exemple « Le Directeur »), « Fonction », laissez « Signataire actif » coché, puis « Créer le signataire ».
3. Sur ce nouveau signataire, cliquez sur « Désactiver » puis « Activer ».
**Résultat attendu :** « Le signataire … est enregistré. », puis « … est désactivé. » et « … est activé. ». Aucun nom par défaut n'existe : sans signataire, les documents officiels ne s'émettent pas.
- [ ] Signataire créé
- [ ] Désactivation et réactivation fonctionnent

#### C10.3 Modèles de documents et aperçu
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Modèles de documents » (`/v2/reportcards/templates`)
1. Lisez « Configuration de l'établissement » : pour « Bulletin » et « Relevé de notes », le modèle choisi et la mention « modèle vX, configuration vY » (ou « Aucune configuration. »).
2. Pour « Bulletin », cliquez sur « Aperçu » : l'aperçu est fabriqué avec des données d'exemple (« Aperçu avec des données d'exemple ; rien n'est émis. »).
3. Cliquez sur « Configurer », observez « Niveau d'enseignement », « Modèle », « Options du modèle », « Signataires par emplacement » ; ne validez pas si vous ne voulez pas créer une nouvelle version.
**Résultat attendu :** les modèles sont des données de la plateforme (génériques) ; vous choisissez celui de chaque document. L'aperçu ne contient aucun vrai élève.
- [ ] Aperçu affiché avec des données d'exemple
- [ ] Emplacements de signature listés

#### C10.4 Bulletins émis : liste, détail, téléchargement du PDF
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Bulletins émis » (`/v2/reportcards`)
1. Choisissez « 6e A » et « Trimestre 1 ». Lisez le tableau « Bulletins émis » : « Élève », « Document », « État » (badge « Publié »), « PDF » (badge « PDF prêt »). Neuf bulletins attendus (à confirmer : huit élèves notés plus un).
2. Le filtre « Dernière version seulement » est coché : décochez-le pour voir aussi les versions remplacées (aucune pour l'instant).
3. Cliquez sur le nom de Nadia DIABATE : page de détail (`/v2/reportcards/<identifiant>`). Lisez « Contenu du bulletin » (classe, période, moyenne, rang, mention, décision, « Règle appliquée »), « Signataires », « Vérification d'authenticité » (« Code de vérification », « Empreinte du document », QR code, bouton « Ouvrir la page de vérification »), « Générations du PDF ».
4. Cliquez sur « Télécharger le PDF ». Note : « Le lien de téléchargement est généré à la demande et valable 5 minutes. »
5. Ouvrez le PDF : vérifiez le filigrane « DÉMONSTRATION », le pied de page « Règles de démonstration — document sans valeur officielle », l'en-tête de l'établissement, le QR code et le code imprimé.
6. (Facultatif) « Afficher la trace » : la trace d'explicabilité s'ouvre ; la page précise que la consultation est enregistrée dans le journal d'audit.
**Résultat attendu :** le PDF reprend les valeurs figées des résultats ; le filigrane de démonstration est présent partout. Le directeur et le propriétaire voient les mêmes écrans.
- [ ] Liste complète, tous « Publié » et « PDF prêt »
- [ ] PDF téléchargé avec filigrane et mention de démonstration
- [ ] Code de vérification et QR code visibles sur la page et sur le PDF

#### C10.5 Vérification publique par le code (sans connexion)
**Compte :** aucun (fenêtre de navigation privée) · **Où :** `/v2/verify`
1. Dans l'écran de détail d'un bulletin (C10.4), copiez le « Code de vérification » (26 caractères).
2. Ouvrez une fenêtre de navigation privée et allez sur `http://localhost:3100/v2/verify` (adresse de base de l'introduction). Il n'y a ni connexion ni menu.
3. Saisissez le code dans « Code de vérification » (les espaces et tirets sont ignorés, minuscules acceptées), puis « Vérifier ».
4. Lisez le résultat : badge « Authentique », titre « Document authentique », « Établissement », « Nature du document » (« Bulletin »), « Intitulé », « Émis le ».
5. Dépliez « Détails techniques » : « Clé de signature », « Empreinte de la clé publique », « Empreinte du document ».
6. Ouvrez aussi `/v2/verify/<code>` (forme du QR code) : le code est vérifié dès l'ouverture.
**Résultat attendu :** le message indique que le document « a été calculé avec des règles de démonstration : il n'a aucune valeur officielle ». La page n'affiche ni note, ni nom d'élève, ni matricule, ni date de naissance (rappel : « Cette page n'affiche ni note, ni nom, ni matricule, ni date de naissance : elle confirme seulement l'existence et le statut du document. »). La mention scolaire n'est pas affichée (réglage désactivé par défaut).
- [ ] Statut « Authentique » et mention de démonstration
- [ ] Aucune donnée personnelle sur la page
- [ ] La forme `/v2/verify/<code>` fonctionne

#### C10.6 Comparer un fichier PDF
**Compte :** aucun · **Où :** `/v2/verify`, section « Comparer un fichier PDF »
1. Utilisez le PDF téléchargé en C10.4. Dans « Fichier PDF » (10 Mo au plus), choisissez-le.
2. Lisez le résultat : « Fichier identique », « Statut du document : Authentique », établissement, intitulé, date d'émission.
3. Recommencez avec un autre PDF quelconque.
**Résultat attendu :** le premier est reconnu, le second donne « Fichier non reconnu ». Un fichier qui n'est pas un PDF donne « Le fichier doit être au format PDF. » ; au-delà de 10 Mo : « Le fichier dépasse 10 Mo. ».
- [ ] Fichier identique reconnu
- [ ] Fichier étranger non reconnu

#### C10.7 Contrôle préalable et lot d'émission
**Compte :** `etudes@demo-secondaire.test` · **Où :** « Émettre » (`/v2/reportcards/issue`)
1. Choisissez « 6e A » et « Trimestre 1 ». Lisez « Contrôle préalable » : « Tout est prêt : vous pouvez générer les bulletins. » et « N inscriptions : N éligibles, 0 exclues. », « Version des résultats utilisée : 1. ».
2. Cliquez sur « Générer les bulletins ». Le lot est idempotent (« Relancer la génération ne recrée rien : seuls les bulletins manquants sont traités. »).
3. Lisez « Avancement du lot » : barres « Bulletins émis » et « PDF générés », message « N émis sur N — 0 exclus, 0 en échec. » puis « N PDF prêts sur N bulletins émis. ». Une inscription sans résultat définitif (le neuvième élève, à confirmer) peut apparaître dans « Inscriptions non émises » avec le motif.
4. Cliquez sur « Voir la liste des bulletins ».
5. Choisissez maintenant « Trimestre 2 » (notes verrouillées, non clôturé) : le contrôle préalable signale un point « Bloquant » et le bouton « Générer les bulletins » reste grisé. Cochez « Bulletin provisoire » (« Filigrane obligatoire ; jamais publié aux familles ni vérifiable publiquement. ») : l'émission devient possible si plus rien ne bloque (à confirmer).
**Résultat attendu :** aucun doublon n'est créé pour le Trimestre 1 ; le nombre de bulletins reste le même qu'en C10.4. Un bulletin « Provisoire » ne peut pas être publié.
- [ ] Contrôle préalable lisible, lot rejoué sans doublon
- [ ] Trimestre 2 : émission définitive bloquée
- [ ] (Facultatif) bulletin provisoire marqué « Provisoire » (Attention : il ne peut pas être supprimé)

#### C10.8 Retirer puis publier un bulletin
**Compte :** `etudes@demo-secondaire.test` (MFA : une confirmation d'identité par code peut être demandée) · **Où :** `/v2/reportcards`
1. Sur la ligne de Yao TOURE, cliquez sur « Retirer ». Message « Le bulletin de … est retiré de la publication. » : l'état passe à « Émis ».
2. (Le parent de démonstration n'est pas le tuteur de Yao TOURE : pour voir l'effet côté famille, faites plutôt ce retrait/publication sur le bulletin de Nadia DIABATE et contrôlez avec `parent@demo-secondaire.test`, voir C10.9.)
3. Sur la même ligne, cliquez sur « Publier ». Message « Le bulletin de … est publié. »
4. (Lot) cochez deux bulletins « Émis » puis « Publier la sélection » : « N publiés, N déjà publiés, N non publiés. »
**Résultat attendu :** le retrait est réversible. « Publier » est refusé tant que le PDF n'est pas prêt (infobulle « Le PDF n'est pas encore prêt. »).
- [ ] « Retirer » puis « Publier » changent l'état « Publié » / « Émis »
- [ ] Les familles ne voient que les bulletins publiés (C10.9)

#### C10.9 Vue des familles
**Comptes :** `parent@demo-secondaire.test`, puis `eleve@demo-secondaire.test` · **Où :** `/v2/parent` puis l'enfant, onglet « Bulletins » (`/v2/parent/children/<identifiant>/reportcards`) ; ou `/v2/reportcards/family` (« Mes bulletins »)
1. Connectez-vous en parent. Ouvrez l'enfant Nadia DIABATE puis l'onglet « Bulletins ».
2. Lisez « Publié le … » et cliquez sur « Télécharger ». Notes : « Chaque téléchargement est journalisé ; le lien est valable 5 minutes. »
3. Répétez avec Salimata DIABATE.
4. Connectez-vous en élève : « Mes bulletins ». Seul le bulletin de Nadia DIABATE est visible.
**Résultat attendu :** le parent ne voit que les bulletins publiés de ses enfants ; l'élève, seulement les siens. Un bulletin retiré ou révoqué disparaît.
- [ ] Parent : deux enfants, bulletins téléchargeables
- [ ] Élève : un seul bulletin (le sien)
- [ ] Aucun bulletin d'un autre élève n'est visible

#### C10.10 Réémettre un bulletin (version remplacée)
**Attention : irréversible (une nouvelle version est créée, l'ancienne n'est jamais effacée).**
**Compte :** `etudes@demo-secondaire.test` · **Où :** `/v2/reportcards`
1. Sur la ligne de Jean-Marc TOURE, cliquez sur « Réémettre ». La fenêtre « Réémettre le bulletin de … » rappelle : « Une nouvelle version est créée ; l'ancienne reste consultable et sa vérification indique qu'elle est remplacée. »
2. Saisissez un « Motif » (5 caractères au moins), confirmez. Message « Le bulletin de … est réémis. »
3. Décochez « Dernière version seulement » : deux lignes pour cet élève, la plus ancienne « Remplacé ».
4. Dans `/v2/verify`, vérifiez l'ancien code : badge « Remplacé », titre « Document remplacé par une version plus récente », phrase « Une version plus récente de ce document a été émise le … ».
5. Après une réouverture puis une nouvelle clôture de la période (chapitre 9), les bulletins portent le badge « À réémettre » et le filtre « À réémettre » les liste.
**Résultat attendu :** l'ancien code est « Remplacé » ; le nouveau est « Authentique ». Les familles ne voient que la dernière version publiée.
- [ ] Nouvelle version créée avec motif
- [ ] Ancien code : « Remplacé »
- [ ] Nouveau code : « Authentique » (le nouveau bulletin doit être publié pour les familles)

#### C10.11 Révoquer un bulletin
**Attention : action définitive.** À faire en tout dernier, sur un seul bulletin.
**Compte :** `directeur@demo-secondaire.test` (MFA) · **Où :** `/v2/reportcards`
1. Sur la ligne de Jean-Marc TOURE (dernière version), cliquez sur « Révoquer ». La fenêtre avertit : « Le document disparaît du portail des familles et sa vérification publique indiquera qu'il est révoqué. Cette action est définitive. »
2. Saisissez un motif, confirmez (une confirmation d'identité par code peut être demandée). Message « Le bulletin de … est révoqué. »
3. Dans `/v2/verify`, vérifiez le code : badge « Révoqué », « Document révoqué », « Ce document a été révoqué le … ».
**Résultat attendu :** état « Révoqué », plus de téléchargement famille, vérification publique « Révoqué ». Le document reste conservé en interne.
- [ ] État « Révoqué » visible côté direction
- [ ] Vérification publique « Révoqué »
- [ ] Le bulletin n'apparaît plus côté famille

#### C10.12 Bulletins du primaire
**Compte :** `directeur@demo-primaire.test` (MFA) · **Où :** `http://demo-primaire.localhost:3100/v2/reportcards`
1. Choisissez « CP1 A » et « Trimestre 1 ». Huit bulletins « Publié » (gabarit du primaire).
2. Ouvrez un bulletin, téléchargez le PDF : filigrane « DÉMONSTRATION » et mention de démonstration.
3. Vérifiez le code dans `/v2/verify`.
**Résultat attendu :** mêmes comportements que dans le secondaire, jeu fictif `CI-PRIMARY-PLACEHOLDER`.
- [ ] 8 bulletins, PDF prêts
- [ ] Mention de démonstration à la vérification publique

#### C10.13 Relevés du supérieur
**Compte :** `directeur@demo-superieur.test` (MFA) · **Où :** `http://demo-superieur.localhost:3100/v2/reportcards`
1. Choisissez « Licence 1 A » et « Semestre 1 ». Lisez la liste (huit ou neuf documents, à confirmer).
2. Ouvrez un document : la ligne « Crédits » du bloc « Contenu du bulletin » indique les crédits validés sur les crédits du semestre.
3. Téléchargez le PDF : relevé à crédits (UE et ECUE) signé, avec QR code.
**Résultat attendu :** le jeu `CI-HIGHER-LMD` est un jeu de la plateforme : ces relevés ne portent pas le filigrane de démonstration ; vérifiez-le sur le PDF et à la vérification publique (à confirmer).
- [ ] Relevés présents, PDF téléchargeable
- [ ] Crédits affichés dans le détail

### 10.4 Cas limites et tests négatifs

#### C10.N1 Le secrétariat ne publie pas et ne révoque pas
**Compte :** `secretariat@demo-secondaire.test` (MFA)
1. Ouvrez « Bulletins émis » : pas de case de sélection, pas de bouton « Publier », « Retirer » ni « Révoquer » ; le bouton « Réémettre » est présent.
2. Le menu n'offre ni « Identité et réglages » ni « Signataires » ni « Modèles de documents ».
**Résultat attendu :** actions sensibles absentes ; adresse forcée = accès refusé.
- [ ] Aucune action de publication ou révocation
- [ ] Pages d'identité et de signataires inaccessibles

#### C10.N2 Le directeur des études ne révoque pas
**Compte :** `etudes@demo-secondaire.test`
1. Dans `/v2/reportcards`, vérifiez l'absence du bouton « Révoquer ».
2. Saisissez `/v2/reportcards/identity` puis `/v2/reportcards/signatories` : accès refusé.
**Résultat attendu :** il émet et publie, mais ne révoque pas et ne gère pas l'identité.
- [ ] « Révoquer » absent, deux pages refusées

#### C10.N3 Les familles n'accèdent pas aux écrans de gestion
**Compte :** `parent@demo-secondaire.test`
1. Saisissez `/v2/reportcards` (liste de gestion) puis `/v2/reportcards/issue`.
2. Dans l'espace parent, essayez d'ouvrir le bulletin d'un enfant qui n'est pas le vôtre (adresse `/v2/reportcards/<identifiant>` copiée depuis la direction).
**Résultat attendu :** accès refusé pour la liste ; l'identifiant d'un autre élève répond comme si le bulletin n'existait pas (page introuvable).
- [ ] Gestion refusée
- [ ] Bulletin d'autrui introuvable

#### C10.N4 Code de vérification inconnu ou mal formé
**Compte :** aucun · **Où :** `/v2/verify`
1. Saisissez `ABC123` puis un code de 26 caractères inventé.
**Résultat attendu :** badge « Inconnu » et message « Aucun document ne correspond à ce code. Vérifiez la saisie ; si le code est correct, le document n'est pas authentique. » (même réponse pour un code inexistant, trop court ou trop long).
- [ ] Même réponse « Inconnu » dans les deux cas

#### C10.N5 Lien de téléchargement de courte durée
**Compte :** `etudes@demo-secondaire.test`
1. Cliquez sur « Télécharger » pour un bulletin, copiez l'adresse du fichier ouvert, puis attendez plus de 5 minutes.
2. Rouvrez l'adresse copiée.
**Résultat attendu :** le lien ne fonctionne plus ; un nouveau clic sur « Télécharger » en fabrique un autre (à confirmer sur l'aspect exact du refus).
- [ ] Lien expiré refusé

#### C10.N6 PDF en échec (worker sans navigateur)
**Compte :** `etudes@demo-secondaire.test`
1. Si un PDF est « PDF en échec » : cliquez sur « Relancer le PDF » sur la ligne, ou « Relancer les PDF en échec » dans l'avancement du lot.
**Résultat attendu :** nouvelle tentative (trois tentatives automatiques avant échec). Si Chrome/Edge est absent du poste, le rendu ne réussit pas : voir le dépannage de l'introduction.
- [ ] Le bouton de relance existe et déclenche une nouvelle génération

#### C10.N7 Motifs trop courts
**Compte :** `etudes@demo-secondaire.test`
1. Dans « Émettre », cochez « Réémettre les bulletins dont les résultats ont changé » et laissez le motif à 4 caractères.
**Résultat attendu :** « Le motif doit faire au moins 5 caractères. »
- [ ] Refus du motif trop court

#### C10.N8 Isolation entre établissements
**Compte :** `directeur@demo-secondaire.test`
1. Copiez l'adresse d'un bulletin de l'école primaire (`/v2/reportcards/<identifiant>` vue depuis `demo-primaire`) et ouvrez-la dans le secondaire.
**Résultat attendu :** page introuvable (comme si l'élément n'existait pas). La vérification publique, elle, répond pour tout code valide quel que soit l'établissement, mais sans aucune donnée personnelle.
- [ ] Bulletin d'un autre établissement introuvable

### 10.5 Problèmes connus et limites
- Le bandeau « Règles de démonstration » n'apparaît pas sur les écrans de bulletins ; la mention est portée par le PDF (filigrane et pied de page) et par la vérification publique.
- Aucun écran ne permet d'émettre un relevé cumulé de plusieurs périodes (nature « Relevé de notes »), bien que le filtre et les modèles le prévoient.
- Les modèles de bulletin sont génériques : les modèles officiels (primaire, secondaire) ne sont pas fournis.
- Le rendu des PDF dépend d'un navigateur installé sur le poste du worker ; sinon les documents restent « PDF en attente » ou passent en échec.
- Le lien du QR code dépend de l'adresse de vérification configurée pour l'environnement ; en démonstration, utilisez la page `/v2/verify` et le code imprimé.
- Un bulletin provisoire émis ne peut être ni supprimé ni publié.
- Constat QA : erreur d'hydratation sur `/v2/reportcards/issue` (corrigée, à reconfirmer).

### 10.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 013 US7 : l'émission d'un relevé cumulé n'a pas d'écran (seul le service existe).
- Spec 013 AC1.5 (100 bulletins en moins de 120 s) : mesure sur un worker de référence non vérifiée ici.
- Le filigrane « démonstration » n'est pas annoncé sur les écrans de gestion (liste, détail) ; seulement sur les PDF et la vérification publique.
- Le comportement du contrôle préalable sur une période verrouillée avec « Bulletin provisoire » est à confirmer.

---

## Chapitre 11. Enseignement supérieur : UE, ECUE, crédits, relevés
> **Durée estimée :** 60 à 90 minutes · **Établissement(s) :** Université Horizon (`demo-superieur`) · **Comptes :** propriétaire, directeur, directeur des études, secrétariat, enseignant, parent, élève

### 11.1 Objectif
Vérifier le fonctionnement de l'enseignement supérieur à crédits : un cours est une UE (unité d'enseignement) composée d'ECUE (éléments constitutifs), chaque ECUE porte des crédits et un coefficient, un semestre est validé seulement si TOUTES les UE sont validées, les crédits d'une UE validée sont capitalisés, une note de rattrapage REMPLACE la note de la première session, des prérequis peuvent lier les UE, et les diplômes et attestations sont des documents officiels signés et vérifiables.

Règle métier confirmée (décisions du 2026-10-01) : la note de session 2 (rattrapage) remplace toujours celle de la session 1, même si elle est plus faible.

### 11.2 Avant de commencer
- **Établissement :** `http://demo-superieur.localhost:3100/v2/login` (Université Horizon, pack supérieur, plan « Professional »).
- **Comptes :**
  - Propriétaire `direction.generale@demo-superieur.test` et directeur `directeur@demo-superieur.test` (MFA oui) : tous les droits supérieurs, y compris octroi forcé, révocation et affectation des signataires.
  - Directeur des études `etudes@demo-superieur.test` (MFA oui) : diplômes, octroi normal, émission des documents, prérequis, rattrapages, réglages ; ni octroi forcé, ni révocation, ni signataires.
  - Secrétariat `secretariat@demo-superieur.test` (MFA oui) : consulte et émet les documents officiels seulement.
  - Enseignant `enseignant@demo-superieur.test` : aucun accès aux écrans du supérieur.
  - Parent `parent@demo-superieur.test` (Séka DIABATE) et élève `eleve@demo-superieur.test` (Nadia DIABATE) : sans MFA ; accès à leurs propres documents.
  - Mots de passe : `.demo/credentials.md` ; code MFA : `pnpm demo:totp <e-mail>`.
- **Menus** (rubriques « Enseignement supérieur ») : « Diplômes » (`/v2/higher/diplomas`, `/v2/higher` y redirige), « Attestations » (`/v2/higher/attestations`), « Documents émis » (`/v2/higher/documents`), « Crédits et dettes » (`/v2/higher/credits`), « Mes documents » (`/v2/higher/me/documents`), « Prérequis » (`/v2/higher/prerequisites`), « Rattrapages » (`/v2/higher/resit`), « Signataires datés » (`/v2/higher/signatories`). Entrées du menu principal : « Diplômes », « Documents officiels », « Rattrapages », « Prérequis », « Signataires ». Résultats : « Résultats de classe » et « Périodes : verrouillage et clôture ».
- **Données de démonstration :**
  - Programme « Informatique », année « Année scolaire 2026-2027 », classe « Licence 1 A », période « Semestre 1 » clôturée avec le jeu `CI-HIGHER-LMD`.
  - UE 1 (6 crédits) : ECUE Algorithmique (3 crédits, coefficient 2) et Programmation (3 crédits, coefficient 1,5). UE 2 (6 crédits) : ECUE Mathématiques (4 crédits, coefficient 2) et Statistiques (2 crédits, coefficient 1). Total du semestre : 12 crédits. Le rattrapage est autorisé sur chaque ECUE.
  - Étudiants notés : Nadia DIABATE, Salimata DIABATE, Aya BAMBA, Fatou BAMBA, Moussa COULIBALY, Salimata COULIBALY, Yao TOURE, Jean-Marc TOURE (huit étudiants notés, d'autres sans notes).
  - Relevés de notes PDF du Semestre 1 émis et publiés (voir le chapitre 10).
  - La démonstration ne contient PAS de diplôme, de document officiel ni de signataire de documents du supérieur : « Aucun diplôme », « Aucun document », « Aucun signataire affecté » sont normaux au départ. Seul le signataire « Directeur Fictif » existe côté bulletins ; vous l'affectez en C11.7.
  - Quels étudiants valident leurs UE dépend des notes de la graine : repérez-le en C11.2.
- Les octrois, émissions de documents, révocations et ouvertures de fenêtres de rattrapage sont durables : faites-les en dernier, sur un seul compte. `pnpm demo:reset` remet tout à zéro.

### 11.3 Scénarios

#### C11.1 Lire la structure UE / ECUE du curriculum
**Compte :** `directeur@demo-superieur.test` · **Où :** `/v2/academic/curriculum` (menu académique, libellés à confirmer)
1. Ouvrez le curriculum du programme « Informatique », année « Année scolaire 2026-2027 ».
2. Dépliez le niveau « Licence 1 A », le « Semestre 1 », puis « UE 1 » et « UE 2 ».
3. Lisez les crédits de chaque UE et de chaque ECUE (Algorithmique, Programmation, Mathématiques, Statistiques).
**Résultat attendu :** deux UE de 6 crédits chacune, quatre ECUE avec leurs crédits (3, 3, 4, 2) et leurs coefficients.
- [ ] Deux UE, quatre ECUE
- [ ] Crédits de chaque ECUE conformes (somme 12)

#### C11.2 Résultats du semestre : crédits et « semestre validé »
**Compte :** `etudes@demo-superieur.test` · **Où :** « Résultats de classe » (`/v2/results/matrix`)
1. Choisissez la classe « Licence 1 A » et la période « Semestre 1 ». Lisez la ligne « Règle `CI-HIGHER-LMD` v1 — version des résultats 1 ».
2. Lisez les colonnes « Moyenne », « Rang », « Mention », « Décision » et « Crédits » (« x / 12 »). Les badges « Validé » ou « Non validé » indiquent la validation du semestre.
3. Cochez « Afficher le détail par cours » : colonnes « UE 1 » et « UE 2 » avec l'état de chaque UE.
4. Repérez un étudiant « Validé » (12 / 12) et, s'il existe, un étudiant « Non validé » (crédits partiels).
5. Cliquez sur « Pourquoi ? » pour cet étudiant et lisez les lignes « Unité d'enseignement » et « Période » (validation de l'UE, validation du semestre).
**Résultat attendu :** le semestre n'est « Validé » que si les deux UE le sont. Un étudiant dont une seule UE est validée est « Non validé » ; seuls les crédits de l'UE validée comptent (à confirmer sur la ligne concernée). Une UE sans aucun résultat est « en attente » (jamais « ajourné » faute de note).
- [ ] Crédits affichés sur 12
- [ ] Un étudiant validé : toutes les UE validées
- [ ] (Si présent) un étudiant non validé : au moins une UE non validée
- [ ] La trace explique la validation de l'UE puis du semestre

#### C11.3 Crédits capitalisés et dettes d'UE
**Compte :** `etudes@demo-superieur.test` · **Où :** « Crédits et dettes » (`/v2/higher/credits`)
1. Dans « Étudiant », recherchez « Nadia DIABATE » et sélectionnez-la.
2. Lisez la « Synthèse » : « Crédits acquis », « UE acquises », « Dettes d'UE ouvertes ».
3. Lisez le « Registre des crédits » : colonnes « UE », « Crédits », « Acquisition » (« Validation directe »), « Moyenne », « État » (« Acquise »), « Valide jusqu'au » (« sans limite » par défaut).
4. Répétez avec un étudiant dont une UE n'est pas validée (C11.2) : la section « Dettes d'UE » affiche une dette « Ouverte » (« Détectée le … ») ; la section « Rattrapages » est vide tant qu'aucune fenêtre n'est ouverte.
**Résultat attendu :** les crédits d'une UE validée sont figés au moment de l'acquisition ; une UE non validée devient une dette d'UE ouverte, levée plus tard par l'acquisition.
- [ ] Synthèse cohérente avec les résultats du semestre
- [ ] Registre : une ligne par UE acquise
- [ ] Dette ouverte pour une UE non validée

#### C11.4 Prérequis entre UE
**Compte :** `etudes@demo-superieur.test` · **Où :** « Prérequis » (`/v2/higher/prerequisites`, titre « Prérequis entre UE »)
1. Dans « Choix du curriculum », sélectionnez « Programme » = « Informatique » et « Année » = « Année scolaire 2026-2027 ».
2. Dans « UE du programme », choisissez « UE 2 » (les UE sont les éléments qui portent des crédits).
3. Dans « Prérequis de UE 2 », cliquez sur « Ajouter un prérequis » : « UE prérequise » = « UE 1 », « Condition » = « UE validée ». Cliquez sur « Enregistrer les prérequis ». Message « Les prérequis de … sont enregistrés. »
4. Dans « Un étudiant satisfait-il les prérequis ? », recherchez un étudiant (par exemple Nadia DIABATE) : résultat « Prérequis satisfaits » ou « Prérequis non satisfaits » avec « Prérequis manquants ».
5. Essayez la condition « Moyenne minimale » (par exemple 10) puis rétablissez.
6. Retirez le prérequis (« Retirer ce prérequis ») et enregistrez, pour revenir à l'état initial.
**Résultat attendu :** la logique est « ET » : tous les prérequis listés doivent être satisfaits. Les inscriptions déjà prises ne changent pas, un avertissement « N étudiants inscrits ne satisferaient plus ces prérequis » peut s'afficher.
- [ ] Prérequis enregistré puis retiré
- [ ] Le contrôle d'un étudiant donne un résultat clair
- [ ] Un cycle (UE 1 requiert UE 2 alors que UE 2 requiert UE 1) est refusé (voir C11.N5)

#### C11.5 Rattrapage (session 2) : fenêtre et règle « remplace »
**Attention : l'ouverture d'une fenêtre rouvre la période pour la seule session 2 ; à faire en dernier.**
**Compte :** `etudes@demo-superieur.test` · **Où :** « Rattrapages » (`/v2/higher/resit`, ou `/v2/results/resit`)
1. Choisissez « Licence 1 A » et « Semestre 1 ». Lisez « Candidats au rattrapage » (colonnes « Étudiant », « Cours à repasser », « Moyenne session 1 ») ; si personne n'a d'UE non validée : « Aucun candidat. Les candidats sont désignés par les résultats clôturés de la période. »
2. S'il y a des candidats, cliquez sur « Ouvrir une fenêtre », renseignez « Ouverture » et « Fermeture », puis « Ouvrir la fenêtre ». Message « Fenêtre ouverte : N inscriptions créées, N déjà inscrits. »
3. Lisez « Fenêtres de rattrapage » : dates, « Ouverte », nombre de cours concernés, et « Inscrits » (statuts « Inscrit », « Présent », « Absent », « Dispensé », « Noté »).
4. (Facultatif, long) Avec `enseignant@demo-superieur.test`, saisissez les notes de session 2 comme au chapitre 8 (évaluations) (à confirmer), faites-les valider, puis reclôturez la période.
5. Cliquez sur « Clôturer la fenêtre » puis « Confirmer la clôture » : « Les notes de session 2 sont reverrouillées ; la période pourra être reclôturée. »
**Résultat attendu :** « La session 2 remplace la session 1 : ouvrir la fenêtre ne déverrouille que les notes de session 2. » Après reclôture, la note de session 2 est retenue même si elle est inférieure à celle de session 1 ; l'UE validée par rattrapage apparaît « Rattrapage » dans « Acquisition » du registre de crédits.
- [ ] Candidats cohérents avec les UE non validées
- [ ] Fenêtre ouverte puis clôturée
- [ ] (Si note saisie) la note de session 2 remplace celle de session 1

#### C11.6 Diplôme : création, candidats, octroi
**Compte :** `directeur@demo-superieur.test` (MFA) · **Où :** « Diplômes » (`/v2/higher/diplomas`)
1. Lisez « Diplômes » : au départ « Aucun diplôme. Créez un diplôme à partir d'un cycle du curriculum. »
2. Cliquez sur « Nouveau diplôme ». Dans « Cycle du curriculum », choisissez « Programme » = « Informatique », « Année » = « Année scolaire 2026-2027 », puis le « Nœud du curriculum » représentant le cycle (par exemple le niveau « L1 »).
3. Saisissez « Code du grade » = `LICENCE`, « Intitulé » (facultatif), laissez « Octroi automatique » décoché, puis « Créer le diplôme ». Message « Le diplôme … est créé. »
4. Ouvrez le diplôme : rubriques « Exigences » (UE 1 et UE 2, « Obligatoire »), « Candidats », « Octrois ». « N UV requises (N listées) » : par défaut 12.
5. Dans « Candidats », cliquez sur « Réévaluer les candidats » : message « Recalcul terminé : N évalués, N octroyés, N en échec. » Lisez « UV validées », « UE obligatoires manquantes », « Éligibilité ».
6. Pour un candidat « Éligible », cliquez sur « Octroyer », puis confirmez : « Diplôme octroyé à … (référence). » La rubrique « Octrois » le montre « Obtenu », « Octroi manuel », avec « Règle appliquée ».
**Résultat attendu :** l'éligibilité est décidée par les règles (jamais à la main) ; chaque octroi est numéroté sans trou et fige la version de règle utilisée. Si le sélecteur de cycle ne propose pas de choix valable ou si la création est refusée avec un message sur le cycle ou le programme, notez le texte exact : c'est un écart connu possible (voir 11.6).
- [ ] Diplôme créé avec ses exigences (UE 1 et UE 2)
- [ ] Candidats évalués avec une éligibilité claire
- [ ] Octroi enregistré pour un candidat éligible

#### C11.7 Signataires datés et émission du diplôme
**Compte :** `directeur@demo-superieur.test` (MFA) · **Où :** « Signataires datés » (`/v2/higher/signatories`), puis le diplôme (`/v2/higher/diplomas/<identifiant>`), rubrique « Octrois »
1. Dans « Signataires datés des documents officiels », cliquez sur « Affecter un signataire » pour l'emplacement « Diplôme — signature de gauche » : « Signataire » = « Directeur Fictif », « Valide à partir du » (date), « Affecter ». Répétez pour « Diplôme — signature de droite », « Attestation de réussite » et « Attestation d'authenticité ». Message « Le signataire est affecté. »
2. Lisez la période de chaque affectation (« Du … au sans fin », badge « En vigueur ») : l'historique est conservé, deux affectations d'un même emplacement ne se chevauchent pas.
3. Dans la rubrique « Octrois » du diplôme (C11.6), cliquez sur « Émettre le diplôme ». Message « Document émis : référence. »
4. Dépliez « Documents émis » : le PDF passe de « PDF en préparation » à « PDF prêt » (la page se met à jour seule) ; cliquez sur « Télécharger le PDF ».
5. Cliquez sur « Attestation d'authenticité » : un second document est émis.
**Résultat attendu :** diplôme et attestation signés, scellés et numérotés (références du type `AUTH/AAAA/NNN` pour l'authenticité). Sans signataire affecté, l'émission est refusée (message du type « aucun signataire »). Un « Duplicata » peut être émis : il remplace l'original, qui passe « Remplacé ».
- [ ] Quatre emplacements affectés
- [ ] Diplôme et attestation d'authenticité émis, PDF téléchargé
- [ ] Le PDF porte le code de vérification et le QR code

#### C11.8 Documents officiels : liste, publication, vérification publique
**Compte :** `directeur@demo-superieur.test` · **Où :** « Documents émis » (`/v2/higher/documents`)
1. Lisez « Documents officiels émis » : colonnes « Document », « Étudiant », « État » (« Émis »), « Émission » ; badges « Scellé » / « Non scellé », « Publié » / « Non publié ».
2. Filtrez par « Nature » (« Diplôme », « Attestation de réussite », « Attestation d'authenticité ») et « État ».
3. Cliquez sur « Détail » : « Référence », « Code de vérification », « Empreinte », « Page de vérification », « Contenu figé ».
4. Cliquez sur « Publier » : message « Le document … est publié. »
5. Copiez le code et vérifiez-le sur `/v2/verify` (sans connexion) : badge « Authentique », nature du document « Diplôme » ou « Attestation … ».
**Résultat attendu :** seuls les documents publiés sont visibles de l'étudiant et du parent ; la vérification publique ne révèle aucune donnée personnelle.
- [ ] Document scellé, puis publié
- [ ] Vérification publique « Authentique » avec la bonne nature de document

#### C11.9 Attestations de réussite
**Compte :** `etudes@demo-superieur.test` · **Où :** « Attestations » (`/v2/higher/attestations`)
1. Choisissez « Programme concerné » (nœud du curriculum du programme), éventuellement « Classe (facultatif) ».
2. Lisez le tableau « Étudiants et éligibilité aux attestations » : colonnes « UE » (« x / y »), « Crédits », « État » (« Éligible », « Non éligible », « N UE manquantes »).
3. Pour un étudiant « Éligible », cliquez sur « Émettre ». Message « Attestation émise pour … (référence). » Rejouer l'émission donne « L'attestation de … existe déjà (référence). »
**Résultat attendu :** l'émission est unitaire, tracée et sans doublon. Nécessite l'emplacement « Attestation de réussite » affecté (C11.7).
- [ ] Attestation émise pour un étudiant éligible
- [ ] Une seconde émission ne crée pas de doublon

#### C11.10 Espace de l'étudiant et du parent
**Comptes :** `eleve@demo-superieur.test` puis `parent@demo-superieur.test` · **Où :** « Mes documents » (`/v2/higher/me/documents`)
1. En étudiant (Nadia DIABATE) : lisez « Mes documents officiels » : seuls les documents PUBLIÉS apparaissent, avec « Émis le … », « Scellé », le lien « Page de vérification publique » et « Télécharger le PDF ».
2. En parent : « Documents de Nadia DIABATE » et « Documents de Salimata DIABATE » ; les enfants sont choisis dans la liste.
3. Si rien n'est publié : « Aucun document publié. Les documents apparaissent ici dès que l'établissement les publie. »
**Résultat attendu :** chacun ne voit que ses propres documents publiés ; un document révoqué indique « Document révoqué : … » et le PDF n'est plus fourni.
- [ ] Étudiant : uniquement ses documents publiés
- [ ] Parent : ses deux enfants, pas d'autres étudiants

#### C11.11 Révoquer un diplôme (ré-octroi exceptionnel)
**Attention : action terminale et sensible.** À faire en tout dernier.
**Compte :** `directeur@demo-superieur.test` (MFA) · **Où :** diplôme > « Octrois »
1. Sur un octroi « Obtenu », cliquez sur « Révoquer ». La fenêtre précise : « La révocation est terminale ; les documents de cet octroi sont révoqués. Un ré-octroi exigera une décision écrite. »
2. Saisissez un « Motif de la révocation » (10 caractères au moins), confirmez. Message « Le diplôme est révoqué. »
3. Contrôlez : l'octroi est « Révoqué par … le … », les documents sont « Révoqué » dans « Documents émis », la vérification publique du code répond « Révoqué ».
4. Dans « Candidats », le bouton devient « Ré-octroyer » ; il exige une « Décision écrite du directeur général » d'au moins 20 caractères.
**Résultat attendu :** le diplôme et ses documents passent « Révoqué » ; l'étudiant ne les voit plus.
- [ ] Octroi et documents « Révoqué »
- [ ] Vérification publique « Révoqué »
- [ ] Ré-octroi exige une décision écrite

### 11.4 Cas limites et tests négatifs

#### C11.N1 Le directeur des études ne force pas, ne révoque pas, n'affecte pas les signataires
**Compte :** `etudes@demo-superieur.test`
1. Le menu n'offre pas « Signataires datés ».
2. Sur un candidat « Non éligible », les boutons « Octroi forcé » ne sont pas proposés (ou sont refusés).
3. Dans « Octrois », aucun bouton « Révoquer ».
**Résultat attendu :** ces actes sont réservés à la direction (directeur, propriétaire).
- [ ] Aucune de ces actions n'est possible

#### C11.N2 Octroi forcé : motif et droit
**Compte :** `directeur@demo-superieur.test` (MFA)
1. Sur un candidat « Non éligible », cliquez sur « Octroi forcé », cochez « Forcer l'octroi malgré l'éligibilité refusée ».
2. Saisissez un motif de moins de 20 caractères, puis validez.
**Résultat attendu :** « Le motif doit faire au moins 20 caractères. » ; avec un motif valable, l'octroi est tracé comme « Octroi forcé » avec son motif.
- [ ] Motif court refusé
- [ ] Octroi forcé tracé avec motif

#### C11.N3 L'enseignant et le secrétariat n'ont pas accès aux diplômes
**Comptes :** `enseignant@demo-superieur.test`, `secretariat@demo-superieur.test`
1. Enseignant : saisissez `/v2/higher/diplomas`, `/v2/higher/credits`, `/v2/higher/documents`.
2. Secrétariat : saisissez `/v2/higher/diplomas` et `/v2/higher/credits` ; seul « Documents officiels » (lecture et émission) est accessible.
**Résultat attendu :** message d'accès refusé pour les pages sans droit. L'enseignant n'a aucun droit « supérieur ».
- [ ] Enseignant : tout refusé
- [ ] Secrétariat : diplômes et crédits refusés

#### C11.N4 Établissement sans le pack supérieur
**Compte :** `direction.generale@demo-secondaire.test` (MFA)
1. Saisissez `/v2/higher/diplomas`.
**Résultat attendu :** accès refusé ou message « Cette fonctionnalité n'est pas incluse dans l'offre de votre établissement. » Les écrans du supérieur ne sont pas disponibles hors du pack supérieur.
- [ ] Écran du supérieur inaccessible dans le secondaire

#### C11.N5 Prérequis circulaire refusé
**Compte :** `etudes@demo-superieur.test`
1. Enregistrez « UE 2 » avec le prérequis « UE 1 » (C11.4).
2. Ouvrez « UE 1 » et ajoutez « UE 2 » comme prérequis, puis « Enregistrer les prérequis ».
**Résultat attendu :** refus avec un message d'erreur (« le serveur refuse les cycles ») ; rien n'est enregistré. Retirez ensuite le prérequis de « UE 2 ».
- [ ] Le cycle est refusé

#### C11.N6 Un étudiant ne voit pas les documents des autres
**Compte :** `eleve@demo-superieur.test`
1. Saisissez `/v2/higher/diplomas` (écran de gestion).
2. Saisissez l'adresse `/v2/higher/documents`.
**Résultat attendu :** accès refusé ; seuls ses documents publiés apparaissent dans « Mes documents ». Un document d'autrui répond par un refus sans révéler son existence.
- [ ] Écrans de gestion refusés à l'étudiant

#### C11.N7 Motifs de révocation
**Compte :** `directeur@demo-superieur.test`
1. Tentez « Révoquer » un diplôme ou un document avec un motif vide ou de quelques caractères.
**Résultat attendu :** refus (le motif est obligatoire ; 10 caractères au moins pour un diplôme).
- [ ] Motif obligatoire

### 11.5 Problèmes connus et limites
- Aucun diplôme, document officiel ni emplacement de signature n'est préparé par la démonstration : les scénarios C11.6 à C11.11 créent leurs données.
- Le sélecteur « Cycle du curriculum » du formulaire « Nouveau diplôme » propose un nœud de curriculum ; il peut être refusé par le serveur qui attend un programme ou un cycle (à confirmer par le test C11.6). Si c'est le cas, consignez le message d'erreur.
- Constat QA : un compte sans fiche étudiant (propriétaire) ouvrant `/v2/higher/me/documents` provoque un appel refusé (401 constaté, 403 attendu) ; les écrans de gestion du supérieur répondent « accès refusé » dans les écoles primaire et secondaire (attendu, pack absent) ; erreur d'hydratation sur `/v2/higher/credits` (corrigée, à reconfirmer).
- Le relevé de notes du semestre est un bulletin à crédits (voir le chapitre 10) ; il n'existe pas d'écran d'émission d'un relevé cumulé de plusieurs semestres.
- La durée de validité des crédits (jamais expirés par défaut) ne se règle pas depuis un écran du menu (à confirmer).
- Le nombre d'étudiants notés, et donc d'UE validées, dépend de la graine de démonstration ; il n'est pas garanti qu'un étudiant « Non validé » ou une dette d'UE existe.
- Le rattrapage n'est vérifiable de bout en bout (note de session 2 saisie, reclôture) qu'en enchaînant plusieurs comptes ; scénario long.

### 11.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 019 US6 (mention du diplôme) : la mention est exposée en « code » dans les octrois ; pas d'écran de réglage dédié.
- Spec 019 US8 (suivi du parcours) : l'écran « Mon parcours » du portail étudiant (`/student/higher`) n'a pas de page v2 ; seul « Mes documents » existe.
- Spec 019 : le menu manifeste utilise encore « Mon parcours » (`/student/higher`) et « Parcours de mon enfant » (`/parent/higher`), sans page correspondante dans `apps/web/src/app/v2/higher`.
- L'adaptateur d'académique attend un identifiant de programme (`programs.id`) pour le « nœud de cycle » alors que l'écran envoie un identifiant de nœud de curriculum : à confirmer.
- Le relevé cumulé (spec 013 US7) n'a pas d'écran.


## Chapitre 12. Finance et paiements
> **Durée estimée :** 2 h 30 à 3 h 30 (en plusieurs séances) · **Établissement(s) :** Collège Le Baobab (`demo-secondaire`) en priorité ; mêmes écrans à l'École Les Palmiers (`demo-primaire`) et à l'Université Horizon (`demo-superieur`) · **Comptes :** économe (double authentification), directeur (double authentification), propriétaire (double authentification), secrétariat (lecture seule, double authentification), parent, enseignant (aucun accès)

### 12.1 Objectif
Vérifier tout le cycle financier d'une école : définir ce qui est facturé (frais, barèmes, plans d'échéancier, remises), émettre des factures, encaisser des règlements (virement, espèces, mobile money saisis à la main, paiement en ligne de démonstration), délivrer les reçus, rapprocher les paiements restés en attente, rembourser avec la règle des quatre yeux, suivre les caisses et lire les rapports.
Vérifier aussi que le paiement des frais d'inscription confirme automatiquement l'inscription de l'élève, et que chaque rôle ne voit et ne fait que ce que ses droits permettent.
Le cas des élèves affectés par l'État (facture partagée entre la famille et l'État) est traité au chapitre 19 ; ici, on ne fait que lire la page « Remises et bourses ».

### 12.2 Avant de commencer
- **Comptes (e-mails, sans mot de passe)** : voir le fichier des comptes de démonstration (`.demo/credentials.md`). Le code de double authentification s'obtient avec `pnpm demo:totp <e-mail>`.

| Rôle | E-mail type | Double authentification | Ce qu'il fait dans ce chapitre |
|---|---|---|---|
| Économe | `econome@demo-secondaire.test` | oui | tout le quotidien : frais, factures, encaissements, caisse, demande de remboursement, lecture des rapports |
| Directeur | `directeur@demo-secondaire.test` | oui | approuve les remboursements, résout les paiements à la main, voit les fournisseurs de paiement |
| Propriétaire | `direction.generale@demo-secondaire.test` | oui | deuxième personne pour les « quatre yeux » |
| Secrétariat | `secretariat@demo-secondaire.test` | oui | lecture seule des factures, paiements et reçus |
| Parent | `parent@demo-secondaire.test` (Séka DIABATE) | non | situation de ses deux enfants, paiement en ligne |
| Enseignant | `enseignant@demo-secondaire.test` (Kouadio TRAORE) | non | doit être refusé partout |

- **Adresse de connexion** : `http://demo-secondaire.localhost:3100/v2/login` (remplacer `demo-secondaire` par `demo-primaire` ou `demo-superieur` pour les autres établissements).
- **Menus (compte économe ou direction)** : « Facturation », « Encaissements », « Caisse », « Frais et barèmes », « Tableau de bord financier », « Paiements en ligne », « Fournisseurs de paiement » (direction seulement), « Paiements à rapprocher », « Webhooks en échec ». À l'intérieur du module Finance, une barre de sections propose : « Vue d'ensemble », « Factures », « Encaissements », « À rapprocher », « Reçus », « Remboursements », « Caisse », « Frais et barèmes », « Remises et bourses », « Rapports », « Webhooks en échec », « Fournisseurs de paiement », et « Mes finances » pour parent et élève.
- **Adresses utiles** : `/v2/finance` (vue d'ensemble), `/v2/finance/invoices`, `/v2/finance/invoices/new`, `/v2/finance/payments`, `/v2/finance/payments/new`, `/v2/finance/payments/online`, `/v2/finance/payments/pending`, `/v2/finance/receipts`, `/v2/finance/refunds`, `/v2/finance/cash`, `/v2/finance/fees` (puis `/fees/schedules`, `/fees/plans`, `/fees/discounts`), `/v2/finance/funding`, `/v2/finance/reports`, `/v2/finance/webhooks`, `/v2/finance/providers`, `/v2/finance/me` (parent).
- **Données de démonstration (Collège Le Baobab, année 2026-2027, classe 6e A)** : frais d'inscription 25 000 F, scolarité 200 000 F (primaire : 15 000 F et 120 000 F ; supérieur : 50 000 F et 600 000 F). Les frais « Frais d'inscription » (code `REGISTRATION`) et « Scolarité » (code `TUITION`) existent déjà avec leur barème (au supérieur, ils s'appellent « Frais d'inscription » et « Scolarité annuelle », codes `INSC` et `SCOL`).
  Situation de départ des élèves de la 6e A (les 8 premiers élèves ont payé leurs frais d'inscription par virement, références `VIR-DEMO-001` à `VIR-DEMO-008`) :

| Élève | Situation financière au départ |
|---|---|
| Nadia DIABATE | inscription payée ; scolarité soldée par virement (référence `VIR-DEMO-demo-secondaire-1`) |
| Salimata DIABATE | inscription payée ; scolarité payée à moitié par mobile money (référence `MM-DEMO-demo-secondaire-1`), il reste 100 000 F |
| Aya BAMBA | inscription payée ; 50 000 F payés en ligne (fournisseur de démonstration), reste 150 000 F |
| Fatou BAMBA | inscription payée ; un paiement en ligne de 20 013 F a échoué, la scolarité reste entièrement due |
| Moussa COULIBALY, Salimata COULIBALY, Yao TOURE, Jean-Marc TOURE | inscription payée ; scolarité émise et impayée (200 000 F) |
| Elie SORO, Aya SORO, Koffi N'GUESSAN, Aya N'GUESSAN | facture d'inscription émise et impayée ; inscription « En attente » |

  Au primaire et au supérieur, les montants de scolarité et d'inscription changent (voir ci-dessus), les noms restent identiques. Les listes « Plans d'échéancier », « Remises » et « Sessions de caisse » sont vides au départ (constaté par le rapport QA : ce n'est pas une erreur) ; il n'existe aucune caisse.
- **Règle du paiement en ligne de démonstration** (vérifiée dans le code du fournisseur de démonstration) : le système regarde les trois derniers chiffres du montant. Un montant se terminant par **013** (13 F, 1 013 F, 20 013 F…) **échoue** ; un montant se terminant par **001** (1 F, 1 001 F, 50 001 F…) **reste en attente** ; tout autre montant (50 000 F, 25 000 F…) **réussit**. Aucun appel réseau n'est fait : c'est une simulation, et le paiement est marqué « simulé ».
- **À savoir sur le choix de l'opérateur** : l'écran du parent et celui de l'économe proposent « Orange Money », « MTN MoMo », « Wave », « CinetPay » et « TrésorPay » ; ces opérateurs ne sont pas configurés dans la démonstration. Le fournisseur de démonstration n'est pas dans la liste : sur l'écran de l'économe (`/v2/finance/payments/online`), choisir « Autre fournisseur » et saisir le code `sandbox` (en minuscules). Voir les scénarios C12.12 et C12.13 et la section « Problèmes connus ».
- **Ordre conseillé** : faire les scénarios dans l'ordre. Les remboursements, clôtures de caisse et résolutions manuelles sont définitifs : les faire en dernier et, si possible, sur un seul établissement (`pnpm demo:reset` remet tout à zéro, voir l'introduction).

### 12.3 Scénarios

#### C12.1 Lire la vue d'ensemble de la finance
**Compte :** économe · **Où :** `/v2/finance` (« Finance » > « Vue d'ensemble »)
1. Connectez-vous en économe (avec le code de double authentification).
2. Ouvrez « Facturation » ou allez à `/v2/finance`.
3. Lisez les indicateurs (facturé, encaissé, restant dû, en retard, taux de recouvrement) puis la zone « Accès rapides ».
4. Cliquez sur « Factures en retard » : la liste des factures s'ouvre filtrée sur le statut « En retard ».
**Résultat attendu :** les chiffres sont cohérents avec le tableau de départ (au moins 8 inscriptions payées). Six raccourcis sont proposés : « Encaisser un paiement », « Émettre une facture », « Caisse », « Rapports », « Factures en retard », « Remboursements ».
- [ ] Résultat attendu constaté
- [ ] Les indicateurs s'affichent sans message d'erreur
- [ ] Le raccourci « Factures en retard » ouvre la liste filtrée (elle peut être vide : aucune facture n'est en retard tant que les dates limites ne sont pas passées)

#### C12.2 Lire les frais et les barèmes
**Compte :** économe · **Où :** « Frais et barèmes » (`/v2/finance/fees`)
1. Dans l'onglet « Frais », repérez « Frais d'inscription » (catégorie « Inscription ») et « Scolarité » (catégorie « Scolarité »), statut « Actif ».
2. Ouvrez « Barèmes » : une ligne par frais pour l'année 2026-2027, avec le montant (25 000 F et 200 000 F au collège) et « Depuis le 01/01/2020 ».
3. Dans la zone « Quel montant s'applique ? », choisissez « Scolarité », l'année 2026-2027 puis « Résoudre ».
**Résultat attendu :** le message « Montant applicable : … (année 2026-2027) » reprend le montant du barème.
- [ ] Résultat attendu constaté
- [ ] Les deux barèmes sont « En vigueur »

#### C12.3 Créer un frais et son barème
**Compte :** économe · **Où :** « Frais et barèmes » > « Frais » puis « Barèmes »
1. Onglet « Frais » : « Nouveau frais ». Code `CANT-T1`, Libellé « Cantine trimestre 1 », Catégorie « Cantine ». « Créer ».
2. Onglet « Barèmes » : « Nouveau barème ». Frais « Cantine trimestre 1 », Année scolaire 2026-2027, Montant `15000`, « En vigueur à partir du » une date passée (par exemple le 01/09/2026). Laissez le périmètre vide (tous). « Créer le barème ».
**Résultat attendu :** messages « Le frais « Cantine trimestre 1 » a été créé. » puis « Le barème a été créé. » ; le barème apparaît « En vigueur », périmètre « Tous les apprenants ».
- [ ] Résultat attendu constaté
- [ ] Le nouveau frais peut être choisi dans « Nouvelle facture » (scénario C12.5)

#### C12.4 Créer un plan d'échéancier et une remise
**Compte :** économe · **Où :** « Frais et barèmes » > « Plans d'échéancier » et « Remises »
1. « Plans d'échéancier » > « Nouveau plan » : Code `3-TRANCHES`, Libellé « Trois tranches ». Première échéance : type de part « Pondérée », poids 1, échéance « Nombre de jours après la facture » = 0. Ajoutez deux échéances (« Ajouter une échéance ») de poids 1 chacune, à 30 puis 60 jours. « Créer le plan ».
2. « Remises » > « Nouvelle remise » : Code `FRATRIE10`, Libellé « Fratrie 10 % », Type « Pourcentage », `10`. Catégories : aucune case cochée (toutes). « Créer ».
**Résultat attendu :** « Le plan « Trois tranches » a été créé. » et « La remise « Fratrie 10 % » a été créée. » ; la remise est « Active », cumulable « Non » (case non cochée), catégories « Toutes ».
- [ ] Résultat attendu constaté
- [ ] Si l'écran de plans affiche « Les échéanciers ne sont pas inclus dans l'offre de l'établissement », le noter (fonction de l'abonnement)

#### C12.5 Créer, aperçu puis émettre une facture
**Compte :** économe · **Où :** « Factures » > « Nouvelle facture » (`/v2/finance/invoices/new`)
1. Mode « Depuis le catalogue ». Apprenant : Yao TOURE (recherche par nom). Inscription : celle de la 6e A.
2. « Ajouter un frais » : « Cantine trimestre 1 », quantité 1.
3. Dans « Remises et échéancier » : cochez « Fratrie 10 % », plan « Trois tranches ».
4. Cliquez « Calculer l'aperçu ». Lisez les lignes, le sous-total (15 000), la remise (1 500), le total (13 500) et les trois échéances.
5. Cliquez « Émettre la facture ».
**Résultat attendu :** écran « Facture enregistrée » avec le message « 1 facture a été enregistrée. ». La facture porte un numéro de la forme `FAC-2026-nnnnnn` et le statut « Émise ». Rien n'est enregistré avant l'émission : tant que l'aperçu n'est pas calculé, les boutons d'émission et de brouillon sont bloqués.
- [ ] Résultat attendu constaté
- [ ] L'aperçu affiche 13 500 F après remise et trois échéances
- [ ] Modifier le formulaire après l'aperçu affiche « Le formulaire a changé depuis l'aperçu : recalculez-le avant d'émettre. »

#### C12.6 Lire une facture, générer ou lire l'échéancier
**Compte :** économe · **Où :** « Factures » (`/v2/finance/invoices`) puis la facture
1. Filtrez par apprenant « Nadia DIABATE » : deux factures (inscription, scolarité), toutes deux « Payée ».
2. Ouvrez la facture de scolarité : lisez « Montants » (total, payé, reste dû à 0), « Lignes », « Échéancier ».
3. Retournez à la liste, filtrez « Moussa COULIBALY », ouvrez sa facture de scolarité (« Émise », reste dû 200 000 F). Cliquez « Générer un échéancier », choisissez « Trois tranches », laissez la date de départ, « Générer ». (Ce bouton n'existe que si la facture n'a pas d'échéancier.)
**Résultat attendu :** facture de Nadia : reste dû 0. Facture de Moussa : message « L'échéancier a été généré. » et trois échéances dont la somme est exactement 200 000 F (par exemple 66 667, 66 667, 66 666 : la répartition se fait au franc près, sans perte).
- [ ] Résultat attendu constaté
- [ ] La somme des échéances est égale au total de la facture
- [ ] Le bouton « Imprimer » ouvre l'impression du navigateur

#### C12.7 Encaisser un virement partiel et obtenir le reçu
**Compte :** économe · **Où :** « Encaissements » > « Encaisser un paiement » (`/v2/finance/payments/new`)
1. Apprenant : Moussa COULIBALY. La zone « Factures ouvertes » affiche son reste dû.
2. Montant encaissé `50000`, Mode de paiement « Virement », Référence `VIR-TEST-001`, Nom du payeur « Mariam COULIBALY ». Imputation : « Automatique ».
3. « Vérifier et encaisser », relisez, puis « Confirmer l'encaissement ».
4. Sur l'écran « Paiement enregistré », cliquez « Voir et imprimer le reçu ».
**Résultat attendu :** message « Le paiement de 50 000 F a été enregistré. » ; reçu de la forme `REC-2026-nnnnnn` ; « Reste dû après paiement » = 150 000 F ; la facture de Moussa passe à « Partiellement payée ». Le reçu porte la mention « Reçu émis automatiquement ; il ne peut pas être modifié. » et un bouton « Imprimer ou enregistrer en PDF ».
- [ ] Résultat attendu constaté
- [ ] Le paiement apparaît dans « Encaissements » avec le statut « Confirmé » et la référence `VIR-TEST-001`
- [ ] Le reçu apparaît dans « Reçus »

#### C12.8 Encaisser par mobile money saisi à la main
**Compte :** économe · **Où :** `/v2/finance/payments/new`
1. Apprenant : Salimata COULIBALY. Montant `30000`, Mode « Mobile money », Référence `MM-TEST-001` (numéro de transaction de l'opérateur). Imputation « Automatique ».
2. Confirmez comme au scénario précédent.
**Résultat attendu :** paiement « Confirmé », mode « Mobile money », reçu émis. Ce mode est une saisie manuelle : aucun opérateur n'est contacté.
- [ ] Résultat attendu constaté
- [ ] Un acompte sans imputation est possible : refaire un encaissement de 5 000 F avec l'imputation « Aucune (acompte) » ; la fiche du paiement affiche « Non imputé » 5 000 F et le bouton « Imputer le solde » le répartit ensuite

#### C12.9 Caisse : ouvrir, encaisser des espèces, clôturer
**Compte :** économe · **Où :** « Caisse » (`/v2/finance/cash`)
1. La page indique « Aucune session ouverte… » et « Aucune caisse ». Cliquez « Nouvelle caisse » : Code `CAISSE-1`, Libellé « Caisse principale », Campus « Tous les campus », « Créer ».
2. Cliquez « Ouvrir une session », Fonds de caisse `10000`, « Ouvrir la session ».
3. Cliquez « Encaisser un paiement » (ou allez à `/v2/finance/payments/new`) : apprenant Jean-Marc TOURE, montant `20000`, Mode « Espèces », « Confirmer l'encaissement ». La fiche du paiement affiche la « Session de caisse ».
4. Revenez à « Caisse » : « Ma session » affiche encaissé 20 000 F, nombre d'encaissements 1.
5. Cliquez « Clôturer la session », Montant compté `30000` (fonds de caisse compris), « Clôturer ». (Attention : la clôture est définitive.)
**Résultat attendu :** « Résultat de la clôture » : montant attendu 30 000 F, compté 30 000 F, « Aucun écart : la caisse est juste. ». Refaire un cycle en comptant `29000` donne « Écart : il manque 1 000 F en caisse. ». La session apparaît dans « Historique des sessions » avec le statut « Clôturée ».
- [ ] Résultat attendu constaté
- [ ] Un encaissement en espèces sans session ouverte est refusé (voir C12.N7)
- [ ] Le comptage est « à l'aveugle » : l'attendu n'est affiché qu'après la clôture

#### C12.10 Paiement en ligne de démonstration, côté économe : réussite, attente, échec
**Compte :** économe · **Où :** « Paiements en ligne » (`/v2/finance/payments/online`)
1. Apprenant : Yao TOURE. Fournisseur « Autre fournisseur », Code du fournisseur `sandbox`. Facture visée : celle de scolarité. Montant `50000`. « Lancer le paiement ».
2. Observez « Suivi du paiement » : « Paiement confirmé par le fournisseur. » et la mention de simulation.
3. Cliquez « Nouveau paiement en ligne » et recommencez avec le montant `50001` : le suivi affiche « En attente de la confirmation du fournisseur. Cet écran vérifie régulièrement. » ; cliquez « Vérifier maintenant » : il reste en attente.
4. Recommencez avec le montant `20013` : « Paiement échoué : … ».
5. Ouvrez « Encaissements » : trois paiements en ligne de Yao TOURE.
**Résultat attendu :** `50000` = « Confirmé » avec reçu ; `50001` = « En attente », sans reçu ; `20013` = « Échoué », sans reçu, et la facture n'est pas diminuée. Chaque paiement porte la mention « Paiement simulé (environnement de test). »
- [ ] Résultat attendu constaté (réussite)
- [ ] Résultat attendu constaté (attente) : le paiement à 50 001 F est conservé pour C12.13
- [ ] Résultat attendu constaté (échec)
- [ ] Les montants 1 001 F et 13 F suivent la même règle (facultatif)

#### C12.11 Lire les paiements en ligne de départ
**Compte :** économe · **Où :** « Encaissements » (`/v2/finance/payments`)
1. Filtrez par apprenant « Aya BAMBA » : un paiement en ligne de 50 000 F, « Confirmé ».
2. Filtrez par « Fatou BAMBA » : un paiement de 20 013 F « Échoué ». Ouvrez-le : « Paiement échoué : … », mention de simulation.
3. Utilisez le filtre « Statut » = « Échoué » puis « Exporter en CSV ».
**Résultat attendu :** les paiements de départ correspondent au tableau du paragraphe 12.2 ; le fichier CSV contient les colonnes Date, Apprenant, Mode, Statut, Montant, Imputé, Non imputé, Remboursé, Référence.
- [ ] Résultat attendu constaté
- [ ] Le fichier CSV s'ouvre dans un tableur sans caractères abîmés

#### C12.12 Situation financière côté parent
**Compte :** parent · **Où :** `/v2/finance/me` (ou le portail parent, fiche de l'enfant, onglet scolarité)
1. Connectez-vous en parent. Ouvrez « Mes finances » : deux cartes, Nadia et Salimata DIABATE, avec « Facturé », « Payé », « Reste à payer ».
2. Cliquez « Voir le détail » sur Salimata : sections « Situation », « Prochaines échéances », « Factures », « Paiements », « Reçus ».
3. Ouvrez un reçu : « Reçu de paiement », « Reste à payer après ce paiement », bouton « Télécharger le PDF ».
**Résultat attendu :** Nadia : reste à payer 0. Salimata : reste à payer 100 000 F (collège), une facture de scolarité « Partiellement payée », un reçu de mobile money. Le parent ne voit que les factures émises à la charge de la famille, jamais un brouillon.
- [ ] Résultat attendu constaté
- [ ] Le bouton « Payer en ligne » est présent sur la fiche de Salimata (il n'apparaît que s'il reste une facture à payer et si le paiement en ligne fait partie de l'abonnement)

#### C12.13 Payer en ligne côté parent (à confirmer)
**Compte :** parent · **Où :** fiche de Salimata DIABATE, bouton « Payer en ligne »
1. Cliquez « Payer en ligne ». Dans « Facture à payer », la facture de scolarité est présélectionnée ; le montant est prérempli à 100 000 F.
2. Remplacez le montant par `10000`, choisissez un « Moyen de paiement » de la liste (« Orange Money » par défaut), saisissez un numéro de téléphone fictif, cliquez « Payer ».
3. Notez le résultat exact.
**Résultat attendu (à confirmer) :** la liste ne contient pas le fournisseur de démonstration. Si l'opérateur choisi n'est pas configuré dans la démonstration, le paiement est refusé avec un message du type « fournisseur non configuré » (aucun argent n'est engagé). Si le paiement démarre, le suivi (« Suivi du paiement ») applique la règle du paragraphe 12.2 (10 000 F : réussite ; pour tester l'attente ou l'échec, saisir 10 001 F ou 10 013 F, sans dépasser le reste dû). **Consigner ce comportement dans le rapport de test** : il est contradictoire avec la consigne du guide de démonstration (« payez en ligne avec le fournisseur `sandbox` »). Pour valider la règle des montants quand le parent est refusé, utiliser C12.10 côté économe.
- [ ] Comportement constaté et consigné : démarre / refusé (barrer la mention inutile)
- [ ] Dans les deux cas, aucune facture n'est modifiée par une tentative refusée
- [ ] Un montant supérieur au reste dû est refusé (voir C12.N6)

#### C12.14 Paiements à rapprocher
**Comptes :** économe (lecture et vérification), directeur puis propriétaire (résolution à la main) · **Où :** « Paiements à rapprocher » (`/v2/finance/payments/pending`)
1. En économe, ouvrez la page. Le paiement de 50 001 F créé en C12.10 est listé : fournisseur `sandbox`, rapprochement « Pas encore contrôlé » ou « Vérification en cours » (le système interroge le fournisseur automatiquement toutes les quelques minutes). Cliquez « Vérifier maintenant » : « Le fournisseur répond toujours « en attente ». » L'économe n'a pas le bouton « Résoudre à la main ».
2. En directeur : même page. Cliquez « Résoudre à la main » sur ce paiement. Ce qui s'est réellement passé : « L'argent n'est pas arrivé : marquer le paiement échoué ». Motif : « Test de résolution manuelle, aucun argent reçu » (10 caractères au moins). Preuve : `RELEVE-TEST-001`. « Demander la résolution ».
3. Le message « La demande est enregistrée : elle attend l'approbation d'une autre personne. » apparaît ; la ligne porte « Résolution à approuver » et une ligne apparaît dans « Demandes à approuver ».
4. Déconnectez-vous, connectez-vous en propriétaire, ouvrez la même page, « Demandes à approuver » : cliquez « Approuver » puis confirmez.
**Résultat attendu :** « La résolution est approuvée et appliquée. » Le paiement quitte la liste « Paiements à rapprocher » et passe au statut « Échoué » dans « Encaissements ». Seule l'approbation modifie le paiement.
- [ ] Résultat attendu constaté
- [ ] Le demandeur ne peut pas approuver sa propre demande (voir C12.N4)
- [ ] Un paiement dont l'issue déclarée est « L'argent est arrivé » créerait le reçu et l'imputation : ne pas le tester sans nécessité (action définitive)

#### C12.15 Demander un remboursement (économe) puis l'approuver (direction)
**Comptes :** économe (demande), directeur (approbation) · **Où :** fiche d'un paiement puis « Remboursements » (`/v2/finance/refunds`)
1. En économe, ouvrez dans « Encaissements » le paiement `VIR-TEST-001` de 50 000 F (C12.7). Cliquez « Demander un remboursement » : Montant `10000`, Motif « Erreur de saisie lors du test » (5 caractères au moins). « Envoyer la demande ».
2. Message « La demande de remboursement a été enregistrée ; une autre personne doit l'approuver. ». Ouvrez « Remboursements » : la demande est « Demandé ».
3. En directeur, ouvrez « Remboursements ». Cliquez « Approuver », laissez « Exécuter immédiatement » cochée, « Approuver ». (Attention : action définitive.)
**Résultat attendu :** « Le remboursement est approuvé et exécuté. » Statut « Exécuté ». Sur la fiche du paiement, « Remboursé » = 10 000 F et la facture de Moussa COULIBALY remonte à un reste dû de 160 000 F. Un paiement saisi à la main est remboursé par écriture comptable ; la somme n'est pas rendue par un opérateur.
- [ ] Résultat attendu constaté
- [ ] Le motif du refus peut aussi être testé : refaire une demande de 5 000 F, la refuser (« Refuser », motif obligatoire) ; statut « Refusé », définitif

#### C12.16 Lire les webhooks en échec
**Comptes :** économe et directeur · **Où :** « Webhooks en échec » (`/v2/finance/webhooks`)
Un « webhook » est une notification automatique que l'opérateur de paiement envoie au système pour annoncer un paiement. L'écran liste celles que le système n'a pas pu appliquer.
1. Ouvrez la page : par défaut le filtre « Statut » est « En échec ».
2. Lisez le texte d'avertissement : le contenu brut des notifications, les en-têtes et les signatures ne sont jamais affichés.
3. Changez le statut (« Reçu », « Traité », « Ignoré ») et le fournisseur.
**Résultat attendu :** « Aucun webhook en échec » (puis « Aucun événement pour ce filtre ») : la démonstration n'envoie aucune notification d'opérateur. L'écran existe bien (l'état d'implémentation du 2026-10-03 le donne encore comme manquant). Pour l'économe, il n'y a jamais de bouton « Rejouer » ; pour la direction, ce bouton n'apparaît que sur une ligne « En échec » et demande une double authentification, le motif facultatif et une case de confirmation.
- [ ] Résultat attendu constaté
- [ ] Le « Rejeu » ne peut pas être exercé avec les données de démonstration (aucun événement en échec) : à noter, non bloquant

#### C12.17 Financement, bourses et prises en charge
**Compte :** économe · **Où :** « Remises et bourses » (`/v2/finance/funding`)
1. Choisissez l'apprenant Aya SORO. Lisez « Type de financement » (par défaut « Privé (famille) ») et « Bourses et prises en charge » (vide : « Aucune bourse »).
2. « Nouvelle bourse » : Type de financeur « Fondation », Nom « Fondation Test », Année scolaire 2026-2027, Couverture « Pourcentage » `20`. « Créer la bourse ».
3. Dans la ligne de la bourse, cliquez « Suspendre » puis « Réactiver ».
**Résultat attendu :** messages « La bourse a été créée. », « La bourse est suspendue. », « La bourse est de nouveau active. ». La bourse s'applique aux factures émises ensuite pour cet apprenant (la part du financeur devient une facture liée, payable séparément) ; les factures déjà émises ne changent pas. La section « Répartition des factures » liste les factures de l'élève par payeur. Pour le cas de l'État, voir le chapitre 19.
- [ ] Résultat attendu constaté
- [ ] Ne pas cliquer sur « Terminer » (une bourse terminée ne se reprend pas) sauf pour clore le test

#### C12.18 Rapports financiers et suivi des retards
**Compte :** économe ou directeur · **Où :** « Rapports » (`/v2/finance/reports`)
1. Lisez la « Synthèse » : Facturé, Avoirs, Facturé net, Encaissé, Restant dû, En retard, Paiements non imputés, Taux de recouvrement.
2. Parcourez les sections « Créances par classe » (la 6e A y figure), « Créances par apprenant » (case « Apprenants avec un restant dû seulement »), « Balance âgée » (de « Non échu » à « Plus de 90 jours ») et « Évolution » (jour, semaine ou mois).
3. Cliquez « Exporter en CSV ».
**Résultat attendu :** les totaux « Encaissé » incluent les paiements des scénarios précédents ; « Restant dû » diminue des remboursements éventuels. Il n'existe pas d'écran d'envoi de relances à la famille dans le module Finance : le suivi des impayés se fait par la liste « Factures en retard » et les créances par apprenant (« Aucun apprenant à relancer » si rien n'est dû). Les alertes et notifications d'impayés relèvent du module de communication (autre chapitre).
- [ ] Résultat attendu constaté
- [ ] Le filtre « Situation au » (date passée) change la synthèse

#### C12.19 Fournisseurs de paiement (lecture)
**Compte :** directeur · **Où :** « Fournisseurs de paiement » (`/v2/finance/providers`)
1. Ouvrez la page. Elle liste les opérateurs (Orange Money, MTN MoMo, Wave, CinetPay, TrésorPay) avec leur état (« Désactivé », « Actif » ou « Configuration incomplète »).
2. Ne saisissez aucun identifiant et n'activez rien. Lisez l'avertissement : les identifiants sont chiffrés et jamais réaffichés.
**Résultat attendu :** page lisible, aucun opérateur « Actif » dans la démonstration. L'économe n'a pas accès à cette page (voir C12.N4).
- [ ] Résultat attendu constaté

#### C12.20 Confirmation d'une inscription par le paiement des frais d'inscription
**Comptes :** économe (paiement), secrétariat ou direction (lecture de l'inscription) · **Où :** `/v2/enrollments` puis `/v2/finance/payments/new`
1. En secrétariat, ouvrez « Inscriptions » > « Liste des inscriptions » : l'inscription d'Elie SORO (6e A) est « En attente », comme celles d'Aya SORO, Koffi N'GUESSAN et Aya N'GUESSAN. À l'inverse, Nadia DIABATE est « Active ».
2. En économe, dans « Factures », vérifiez que la facture d'inscription d'Elie SORO est « Émise », 25 000 F.
3. Encaissez un paiement partiel : `/v2/finance/payments/new`, apprenant Elie SORO, montant `10000`, mode « Virement », référence `VIR-TEST-INSC-1`, imputation « Automatique ». La facture devient « Partiellement payée ».
4. Revenez à la liste des inscriptions : l'inscription d'Elie est toujours « En attente ».
5. Encaissez le solde : `15000` (au primaire, `5000` ; au supérieur, `40000`), même mode, référence `VIR-TEST-INSC-2`.
6. Attendez environ une minute (la confirmation est faite en tâche de fond), rechargez la liste des inscriptions.
**Résultat attendu :** après le paiement du solde, la facture d'inscription est « Payée » et l'inscription d'Elie SORO passe à « Active ». Le paiement partiel ne confirme rien. Une facture de scolarité payée ne confirme pas une inscription non payée : seule la facture d'inscription la confirme.
- [ ] Résultat attendu constaté
- [ ] Après 5 minutes sans changement, le noter comme anomalie (tâche de fond non exécutée ; voir le dépannage de l'introduction)
- [ ] Les 8 premiers élèves (Nadia DIABATE à Jean-Marc TOURE) sont bien « Active » dès le départ

### 12.4 Cas limites et tests négatifs

#### C12.N1 Le secrétariat lit mais ne modifie pas
**Compte :** secrétariat (`secretariat@demo-secondaire.test`) · **Où :** `/v2/finance/invoices`, `/v2/finance/payments`, `/v2/finance/receipts`
1. Ouvrez les trois listes : elles s'affichent. Ouvrez une facture et un reçu.
2. Cherchez les boutons « Nouvelle facture », « Encaisser », « Annuler la facture », « Émettre un avoir », « Demander un remboursement » : ils sont absents.
3. Tapez l'adresse `/v2/finance/payments/new`, puis `/v2/finance/invoices/new`, `/v2/finance/reports`, `/v2/finance/fees`, `/v2/finance/cash`.
**Résultat attendu :** pour les adresses de l'étape 3, la page « Accès refusé » (« Vous n'avez pas les droits nécessaires pour afficher cette page. »). Sur « Remboursements » et « À rapprocher », les lignes sont lisibles mais sans bouton d'action. « Webhooks en échec » et « Fournisseurs de paiement » ne sont pas dans la barre de sections.
- [ ] Résultat attendu constaté

#### C12.N2 L'enseignant n'a aucun accès à la finance
**Compte :** enseignant · **Où :** `/v2/finance`, `/v2/finance/invoices`, `/v2/finance/payments`
1. Connectez-vous en enseignant. Aucune entrée « Finance » n'est dans son menu.
2. Tapez les trois adresses ci-dessus.
**Résultat attendu :** « Accès refusé » à chaque fois.
- [ ] Résultat attendu constaté

#### C12.N3 Le parent est limité à ses enfants et au portail famille
**Compte :** parent · **Où :** `/v2/finance/invoices`, `/v2/finance/me/<identifiant inconnu>`
1. En parent, tapez `/v2/finance/invoices` : « Accès refusé ».
2. Ouvrez la fiche de Nadia, copiez son adresse, remplacez l'identifiant final par une suite de chiffres et de lettres quelconque au bon format (par exemple en modifiant un caractère), puis validez.
3. Tapez `/v2/finance/me/abc` (identifiant mal formé).
**Résultat attendu :** étape 2 : titre « Accès refusé » et message « Cet apprenant n'est pas rattaché à votre compte : ses informations financières ne peuvent pas être affichées. » avec un lien « Retour à mes finances ». Étape 3 : page introuvable. Aucune information d'un autre enfant n'est jamais affichée.
- [ ] Résultat attendu constaté

#### C12.N4 Les quatre yeux et les droits sensibles
**Comptes :** économe, directeur · **Où :** « Remboursements », « À rapprocher », « Webhooks en échec », « Fournisseurs de paiement »
1. Faites une nouvelle demande de remboursement en économe (5 000 F sur un paiement de test). Toujours en économe, cliquez « Approuver » sur cette ligne.
2. Directeur : sur C12.14, faites une demande de résolution manuelle sur un autre paiement en attente (créez-en un en 50001) puis, avec le même compte, cliquez « Approuver » dans « Demandes à approuver ».
3. Économe : cherchez « Résoudre à la main » sur « À rapprocher », « Rejouer » sur « Webhooks en échec », et tapez `/v2/finance/providers`.
**Résultat attendu :** étapes 1 et 2 : le système refuse (la personne qui demande ne peut pas approuver) et la ligne reste « Demandé » ou « Résolution à approuver ». Étape 3 : pas de bouton « Résoudre à la main », pas de bouton « Rejouer », et « Accès refusé » sur la page des fournisseurs (droits réservés à la direction).
- [ ] Résultat attendu constaté (remboursement)
- [ ] Résultat attendu constaté (résolution manuelle)
- [ ] Résultat attendu constaté (droits de l'économe)

#### C12.N5 Isolation entre établissements
**Compte :** économe de `demo-primaire` · **Où :** adresse copiée depuis `demo-secondaire`
1. En économe de `demo-secondaire`, ouvrez une facture et copiez son adresse (`/v2/finance/invoices/<identifiant>`).
2. Connectez-vous en économe de `demo-primaire` (adresse `http://demo-primaire.localhost:3100/v2/login`) et collez la même adresse après `http://demo-primaire.localhost:3100`.
**Résultat attendu :** la page répond comme si la facture n'existait pas (message d'élément introuvable) ; aucune donnée du collège n'apparaît (à confirmer sur le texte exact de l'écran).
- [ ] Résultat attendu constaté

#### C12.N6 Montants invalides et paiement trop élevé
**Compte :** économe, puis parent · **Où :** `/v2/finance/payments/new`, dialogue « Payer en ligne »
1. Économe : dans « Encaisser un paiement », saisissez `150,5` puis `-5` puis `0` puis laissez vide, et cliquez « Vérifier et encaisser ».
2. Économe : en imputation « Manuelle », saisissez un montant supérieur au reste dû de l'échéance.
3. Parent (si le paiement démarre, voir C12.13) : saisissez un montant supérieur au reste dû de la facture.
**Résultat attendu :** « Le montant est un entier en francs : pas de virgule ni de point. », « Le montant ne peut pas être négatif. », « Montant invalide : chiffres uniquement, strictement positif. », « Saisissez un montant. ». Un montant supérieur au reste dû est refusé par le système. Aucun paiement n'est créé.
- [ ] Résultat attendu constaté

#### C12.N7 Espèces sans session de caisse
**Compte :** économe, sans session de caisse ouverte · **Où :** `/v2/finance/payments/new`
1. Vérifiez que la session de C12.9 est clôturée.
2. Encaissez 1 000 F en « Espèces ».
**Résultat attendu :** l'écran signale « Aucune session de caisse ouverte : un paiement en espèces doit être rattaché à votre session. » avec le lien « Ouvrir une session de caisse » ; le paiement est refusé tant qu'aucune session n'est ouverte.
- [ ] Résultat attendu constaté

#### C12.N8 Annulation d'une facture et remboursement trop élevé
**Compte :** économe · **Où :** fiche d'une facture, fiche d'un paiement
1. Sur une facture sans paiement (par exemple celle créée en C12.5, avant tout encaissement), cliquez « Annuler la facture », laissez le motif vide puis confirmez.
2. Saisissez un motif et confirmez. (Attention : l'annulation est définitive.)
3. Sur le paiement `VIR-TEST-001` (reste remboursable 40 000 F après C12.15), demandez un remboursement de `45000`.
**Résultat attendu :** étape 1 : motif obligatoire, la facture n'est pas annulée. Étape 2 : « La facture a été annulée. » (statut « Annulée », numéro conservé). Étape 3 : refus, le montant remboursé ne peut pas dépasser ce qui reste du paiement. La note « Pour annuler une somme déjà encaissée, remboursez d'abord le paiement. » est affichée sur la facture.
- [ ] Résultat attendu constaté

#### C12.N9 Double clic et reçus immuables
**Compte :** économe · **Où :** `/v2/finance/payments/new`
1. Lors d'un encaissement, cliquez deux fois rapidement sur « Confirmer l'encaissement ».
2. Ouvrez un reçu : cherchez un bouton de modification.
**Résultat attendu :** un seul paiement est créé (si le message « Ce paiement avait déjà été enregistré : aucun doublon n'a été créé. » apparaît, c'est le comportement prévu). Aucun reçu n'est modifiable ; une erreur se corrige par un avoir ou un remboursement.
- [ ] Résultat attendu constaté

### 12.5 Problèmes connus et limites
- **Paiement en ligne parent** : la liste « Moyen de paiement » ne contient pas le fournisseur de démonstration. Selon la configuration, le paiement du parent peut être refusé (fournisseur non configuré). La règle des montants (001, 013) se teste sans risque côté économe (« Autre fournisseur » + code `sandbox`).
- **Paiements simulés** : le fournisseur de démonstration garde son état en mémoire. Un paiement « En attente » n'est jamais « réglé » tout seul : il reste en attente, puis est signalé comme « À rapprocher » après plusieurs vérifications automatiques (jusqu'à 12 tentatives espacées de 10 minutes à 4 heures). Redémarrer le service de démonstration efface cette mémoire : le paiement reste alors en attente sans réponse possible du fournisseur, d'où la résolution manuelle à quatre yeux.
- **Aucun paiement en attente au départ** : la graine ne crée volontairement aucun paiement en attente ; la liste « Paiements à rapprocher » est vide jusqu'à C12.10.
- **Listes vides au départ (rapport QA)** : plans d'échéancier, remises, sessions de caisse, remboursements : « Aucun plan d'échéancier », « Aucune remise », « Aucune session ouverte… », « Aucun remboursement ». C'est normal.
- **Défaut QA M7** : sur « Frais et barèmes » > « Barèmes », le compte économe peut déclencher un appel refusé en arrière-plan (liste des établissements) ; l'écran reste utilisable (filtre « Établissement » éventuellement vide).
- **Défaut QA M12** : une erreur d'affichage (hydratation) a été relevée dans la console sur `/v2/finance/cash` ; sans effet visible attendu.
- **Webhooks** : l'écran de lecture existe ; aucune donnée n'est présente en démonstration et le rejeu (double authentification) ne peut pas être exercé.
- **Relances** : pas d'écran ni d'envoi de relances dans le module Finance (voir C12.18).
- **Opérateurs réels** : Orange Money, MTN MoMo, Wave, CinetPay, TrésorPay ne sont pas configurés ; aucun vrai paiement n'est possible.
- **Exports et PDF** : l'export CSV et le PDF des reçus passent par le service de documents ; si le PDF d'un reçu tarde, utiliser « Imprimer » (à confirmer selon l'installation).
- **Primaire et supérieur** : mêmes écrans, montants différents ; au supérieur, les codes de frais sont `INSC` et `SCOL`.

### 12.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- `docs/ETAT_IMPLEMENTATION.md` (2026-10-03) indique l'écran des webhooks en échec comme manquant : `/v2/finance/webhooks` existe (lecture, filtres, détail, rejeu avec élévation d'authentification, menu « Webhooks en échec ») ; seule la mise à jour du document manque. Les permissions `finance.webhook.read` (économe, direction) et `finance.webhook.replay` (direction/propriétaire seulement) sont portées par les rôles.
- `docs/DEMO_TEST_GUIDE.md` dit que le parent paie « avec le fournisseur `sandbox` » : l'écran du parent n'offre que les cinq opérateurs réels (aucune saisie de code libre) ; seul l'écran économe accepte un code libre. Le comportement en démonstration est à confirmer (C12.13).
- `docs/DEMO_TEST_GUIDE.md` cite le secrétariat parmi les saisisseurs du paiement d'inscription : le rôle secrétariat n'a que la lecture des finances (`finance.payment.create` absent) ; c'est l'économe ou la direction qui encaisse.
- La spec 014 §6 range hors périmètre la saisie des charges, les tableaux de bord propriétaire (trésorerie), les commissions de prospection et la lecture des commandes/lots du parcours professionnel : aucun écran dans `/v2/finance/**`.
- Aucun envoi automatique de relance d'impayé n'est visible depuis le module Finance (flux de lecture des échéances en retard prévu pour le module de notifications, voir spec 016).
- La résolution manuelle (`finance.payment.reconcile`) n'est portée par aucun rôle autre que direction et propriétaire (l'économe en est exclu), ce qui impose aux « quatre yeux » d'avoir deux comptes de direction.

---

## Chapitre 13. Paie du personnel
> **Durée estimée :** 1 h 30 à 2 h 15 · **Établissement(s) :** Collège Le Baobab (`demo-secondaire`) ; mêmes écrans à `demo-primaire` et `demo-superieur` · **Comptes :** économe (double authentification), directeur (double authentification), propriétaire (double authentification), enseignant (Kouadio TRAORE), secrétariat et parent (aucun accès)

### 13.1 Objectif
Vérifier la chaîne de paie des enseignants : configuration des salaires, période de paie, calcul des bulletins, arrêt du montant par une autre personne que celle qui l'a calculé, validation par le propriétaire au-delà d'un seuil, versement, annulation, et consultation du bulletin par l'enseignant (avec contestation possible).
Les montants sont des francs entiers, sans centimes.
**Important : la paie est vide dans la démonstration.** Aucune configuration, période ni bulletin n'est créé par la graine (constaté sur la graine `scripts/seed-v2/` et dans le rapport QA : « Aucune période de paie », « Aucune configuration », « Aucun bulletin »). Le scénario C13.2 crée le minimum nécessaire ; sans lui, l'enseignant n'a rien à consulter.

### 13.2 Avant de commencer
- **Comptes (e-mails, sans mot de passe)** : voir le fichier des comptes de démonstration (`.demo/credentials.md`) ; code de double authentification : `pnpm demo:totp <e-mail>`.

| Rôle | E-mail type | Double authentification | Droits de paie réels |
|---|---|---|---|
| Économe | `econome@demo-secondaire.test` | oui | configurations, tarifs, périodes, calcul, primes et retenues, envoi du bulletin, versement, rapports ; **pas** d'arrêt du montant, pas d'annulation, pas de réglages |
| Directeur | `directeur@demo-secondaire.test` | oui | tout, **sauf** les réglages de paie et la validation au-delà du seuil (propriétaire) |
| Propriétaire | `direction.generale@demo-secondaire.test` | oui | tout, dont les réglages (séparation des tâches, seuil) et la validation au-delà du seuil |
| Enseignant | `enseignant@demo-secondaire.test` (Kouadio TRAORE) | non | uniquement ses propres bulletins arrêtés, avec contestation |
| Secrétariat, parent | `secretariat@…`, `parent@…` | – | aucun |

- **Adresse de connexion** : `http://demo-secondaire.localhost:3100/v2/login` (`demo-primaire`, `demo-superieur` pour les autres établissements).
- **Menus de gestion** : « Bulletins de paie » (ouvre l'écran des périodes), « Configuration de la paie », « Historique des paiements », « Rapports de paie », « Masse salariale » (portail propriétaire). Barre de sections du module : « Périodes », « Bulletins », « Configuration », « Historique », « Rapports », « Masse salariale », « Mes bulletins ». Sous « Configuration » : « Configurations », « Tarifs horaires », « Réglages ». **Menus de l'enseignant** : « Mes rémunérations » (`/v2/payroll/my`) et, dans le portail enseignant, « Mes bulletins de paie » (`/v2/teacher/payslips`).
- **Adresses** : `/v2/payroll` (périodes), `/v2/payroll/periods/<identifiant>`, `/v2/payroll/payslips`, `/v2/payroll/payslips/<identifiant>`, `/v2/payroll/configuration`, `/v2/payroll/configuration/rates`, `/v2/payroll/configuration/settings`, `/v2/payroll/history`, `/v2/payroll/reports`, `/v2/payroll/owner`, `/v2/payroll/my`, `/v2/payroll/my/<identifiant>`, `/v2/teacher/payslips`, `/v2/teacher/payslips/<identifiant>`.
- **Données utilisées** : enseignant Kouadio TRAORE (compte `enseignant@`), année scolaire 2026-2027. Date du jour de référence : début octobre 2026 ; la période de test couvre septembre 2026.
- **Principe des trois actes** : « calculer » (économe ou direction), « arrêter » le montant (direction : statut « Arrêté (impayé) » = arrêté mais pas encore versé), « verser » (économe ou direction : statut « Versé »). Arrêter n'est pas verser. L'enseignant ne voit un bulletin qu'à partir de l'arrêt du montant.
- **Réglages de départ** : par défaut, la séparation des tâches est désactivée et il n'y a pas de seuil propriétaire (à vérifier en C13.9). Seuil d'heures supplémentaires par défaut 2 400 minutes par semaine (40 h), majoration ×1,5.
- **Heures** : le plus simple pour la démonstration est une configuration de type « Salaire » : elle verse le salaire du mois au prorata des jours ouvrés de la période, sans aucune heure à collecter. Une configuration « Horaire » ou « Mixte » réclame des heures validées (présences du personnel au collège et à l'école primaire, séances réalisées au supérieur) : sans heures, l'enseignant est écarté du calcul (« Aucune heure validée sur la période. »).
- **Actions définitives** : arrêt de montant (réversible seulement par contestation puis annulation), versement et clôture/archivage d'une période. À faire en dernier, sur un seul établissement.

### 13.3 Scénarios

#### C13.1 Constater l'état initial vide
**Compte :** économe · **Où :** « Bulletins de paie » (`/v2/payroll`), « Configuration de la paie », « Historique des paiements »
1. Ouvrez `/v2/payroll` : message « Aucune période de paie » et « Créez la première période pour calculer les bulletins. ».
2. Ouvrez « Bulletins » (`/v2/payroll/payslips`) : « Aucun bulletin ». « Historique » : « Aucun bulletin arrêté ». « Configuration » : « Aucune configuration ».
3. En enseignant, ouvrez `/v2/teacher/payslips` : « Aucun bulletin ».
**Résultat attendu :** tous les écrans sont vides mais s'affichent sans erreur.
- [ ] Résultat attendu constaté

#### C13.2 Créer la configuration de paie de l'enseignant (jeu de données minimal)
**Compte :** économe · **Où :** « Configuration de la paie » > « Configurations » (`/v2/payroll/configuration`)
1. Cliquez « Nouvelle configuration ».
2. Enseignant : Kouadio TRAORE. Type de rémunération : « Salaire ». Salaire mensuel : `150000`. En vigueur à partir du : `01/08/2026`. Laissez « Jusqu'au » vide.
3. « Enregistrer ».
4. Dans la zone « Situation d'un enseignant », choisissez Kouadio TRAORE.
**Résultat attendu :** « La configuration a été enregistrée. » La ligne affiche le type « Salaire », salaire mensuel 150 000 F, « Depuis le 01/08/2026 ». La « Situation » indique une configuration en cours (« Configuration en cours »). Les montants sont des entiers : `150000,5` est refusé.
- [ ] Résultat attendu constaté
- [ ] Un second enseignant (Fatou YAO) peut recevoir une configuration « Horaire » avec un tarif par défaut (ex. `5000`) ; elle sera écartée du calcul faute d'heures (voir C13.5)

#### C13.3 Tarifs horaires et simulateur (lecture)
**Compte :** économe · **Où :** « Configuration » > « Tarifs horaires » (`/v2/payroll/configuration/rates`)
1. Constatez « Aucun tarif » (normal : aucun tarif n'est semé).
2. Dans « Simulateur de tarif », choisissez Kouadio TRAORE et laissez le cours vide, date du jour, « Simuler ».
**Résultat attendu :** « Aucun tarif applicable. » avec l'état de la configuration (pour une configuration « Salaire » sans tarif par défaut, c'est attendu). Ne pas créer de tarif sans besoin : cet écran sert aux enseignants payés à l'heure.
- [ ] Résultat attendu constaté

#### C13.4 Créer une période de paie
**Compte :** économe · **Où :** « Périodes » (`/v2/payroll`) > « Nouvelle période »
1. Nom : « Septembre 2026 ». Du : `01/09/2026`. Au : `30/09/2026`. Année scolaire : 2026-2027. Laissez « Enseignants ciblés » vide (période collective).
2. « Créer la période ».
3. Ouvrez la période (ligne de la liste).
**Résultat attendu :** « La période « Septembre 2026 » a été créée. » La période apparaît avec le statut « Brouillon » et la mention « En attente de calcul ». Tant qu'une période est « En attente de calcul », le bouton « Nouvelle période » est bloqué : « La période « Septembre 2026 » est en attente de calcul : calculez-la ou clôturez-la avant d'en créer une autre. »
- [ ] Résultat attendu constaté
- [ ] Le blocage de la création d'une seconde période est constaté

#### C13.5 Aperçu puis calcul des bulletins
**Compte :** économe · **Où :** fiche de la période (`/v2/payroll/periods/<identifiant>`), zone « Calcul de la paie »
1. Laissez l'origine des heures par défaut (« Toutes les origines »). Cliquez « Aperçu (sans enregistrer) ».
2. Lisez « Aperçu du calcul » : « Aperçu : aucun bulletin n'a été créé ni modifié. » ; Kouadio TRAORE : Salaire 150 000 F (mois complet). Si une configuration horaire a été créée pour un autre enseignant, il apparaît « Écarté » avec le motif « Aucune heure validée sur la période. ».
3. Cliquez « Lancer le calcul ».
**Résultat attendu :** « Compte rendu du calcul » : 1 calculé (plus les écartés éventuels). Dans « Bulletins de la période », le bulletin de Kouadio TRAORE est « Calculé », montant 150 000 F. La période passe « Active ». Un enseignant sans configuration est écarté (« Aucune configuration de paie valide sur la période. »). « Historique des calculs » liste l'aperçu et le calcul.
- [ ] Résultat attendu constaté
- [ ] Après le calcul, relancer « Lancer le calcul » sans cocher « Recalculer… » n'ajoute pas de doublon (« Déjà calculé » si la case n'est pas cochée)
- [ ] Un même jour de salaire n'est jamais payé deux fois (voir C13.N6)

#### C13.6 Ajouter une prime et une retenue
**Compte :** économe · **Où :** fiche du bulletin (`/v2/payroll/payslips/<identifiant>`), zone « Primes et retenues »
1. Ouvrez le bulletin « Calculé » de Kouadio TRAORE depuis la liste « Bulletins ».
2. « Ajouter une prime ou une retenue » : Nature « Prime », Montant `10000`, Libellé « Prime de test », Motif « Test de la démonstration ». « Ajouter ».
3. Ajoutez une « Retenue » de `2000`.
**Résultat attendu :** « L'ajustement a été ajouté. » ; total = 150 000 + 10 000 − 2 000 = 158 000 F. Primes et retenues sont conservées si le bulletin est recalculé. Seul un bulletin « Calculé » les accepte (« Seul un bulletin « calculé » accepte des primes ou retenues. »).
- [ ] Résultat attendu constaté
- [ ] « Retirer » enlève bien une retenue (message « L'ajustement a été retiré. »)

#### C13.7 Arrêter le montant (direction)
**Compte :** directeur · **Où :** fiche du bulletin ou fiche de la période, « Bulletins de la période »
1. En directeur, ouvrez le bulletin de Kouadio TRAORE.
2. Cliquez « Arrêter le montant ».
**Résultat attendu :** message « Le montant du bulletin est arrêté. » ; statut « Arrêté (impayé) » ; les lignes de l'historique du bulletin indiquent qui a calculé et qui a arrêté. Le bouton « Constater le versement » apparaît. Alternative sur la fiche de la période : cocher le bulletin puis « Arrêter la sélection (1) » ou « Tout arrêter » (confirmer par « Arrêter »).
- [ ] Résultat attendu constaté
- [ ] Un bulletin arrêté n'accepte plus de prime ni de retenue

#### C13.8 Consulter son bulletin (enseignant)
**Compte :** enseignant · **Où :** `/v2/teacher/payslips` (menu « Mes bulletins de paie ») ou `/v2/payroll/my` (« Mes rémunérations »)
1. Connectez-vous en enseignant (Kouadio TRAORE) et ouvrez « Mes bulletins de paie ».
2. Lisez la liste : une ligne, statut « Arrêté (impayé) », colonne « Versé le » : « Pas encore versé ». Lisez l'encart « Vous voyez vos bulletins à partir de l'arrêt du montant… ».
3. Ouvrez le bulletin.
**Résultat attendu :** le bulletin arrêté est visible avec ses montants (158 000 F si C13.6 a été fait), le bouton « Contester ce bulletin » est proposé (tant qu'il n'est pas versé). Avant l'arrêt (C13.5 et C13.6), l'enseignant ne voyait rien. Le PDF officiel n'est disponible qu'une fois le bulletin versé.
- [ ] Résultat attendu constaté
- [ ] Avant l'arrêt du montant, le bulletin était invisible pour l'enseignant (à vérifier en refaisant le scénario avec un second bulletin)

#### C13.9 Lire les réglages et activer les garde-fous (propriétaire)
**Compte :** propriétaire · **Où :** « Configuration » > « Réglages » (`/v2/payroll/configuration/settings`)
1. Ouvrez la page : « Seuil d'heures supplémentaires par défaut (minutes par semaine) » = 2400, « Majoration par défaut » = 1,5, « Séparation des tâches » (décochée par défaut), « Seuil de validation par le propriétaire » (vide : aucun seuil).
2. Cochez « Séparation des tâches » et saisissez un seuil de validation `10000`. « Enregistrer les réglages ».
**Résultat attendu :** « Les réglages ont été enregistrés. » Ces réglages servent à C13.12. Ils ne concernent que les prochains arrêts de bulletins.
- [ ] Résultat attendu constaté
- [ ] Le directeur et l'économe n'ont pas accès à cette page (voir C13.N2)

#### C13.10 Verser le bulletin
**Compte :** économe · **Où :** fiche du bulletin « Arrêté (impayé) »
1. En économe, ouvrez le bulletin de Kouadio TRAORE. (Attention : le versement est définitif.)
2. Cliquez « Constater le versement ». Mode de versement « Virement bancaire », Référence `PAIE-TEST-001`. « Constater le versement ».
3. Optionnel : « Envoyer au titulaire ».
**Résultat attendu :** message « Le versement est constaté. », statut « Versé ». Le bulletin ne peut plus être annulé (le bouton « Annuler le bulletin » n'existe pas pour un bulletin versé). En enseignant, la colonne « Versé le » affiche la date et le bouton « Télécharger le PDF » fournit un bulletin scellé et vérifiable (le PDF dépend du service de documents ; à confirmer).
- [ ] Résultat attendu constaté
- [ ] Le bulletin apparaît dans « Historique » avec « par <nom> (Virement bancaire) »
- [ ] Le bouton « Contester ce bulletin » n'est plus proposé à l'enseignant

#### C13.11 Historique, rapports et masse salariale
**Comptes :** économe (historique, rapports), propriétaire (masse salariale) · **Où :** « Historique » (`/v2/payroll/history`), « Rapports » (`/v2/payroll/reports`), « Masse salariale » (`/v2/payroll/owner`)
1. « Historique » : une ligne « Versé ». Cliquez « Exporter en CSV ».
2. « Rapports » : tableau « Bulletins par statut » et « Heures par origine » (présences, séances, hors heures ; ici seul le salaire est « hors heures »). Filtrez par année scolaire ou période.
3. En propriétaire : « Masse salariale » : total compté, périodes, liste « Bulletins à valider ». Les bulletins annulés et contestés sont exclus du total et montrés à part.
**Résultat attendu :** les montants correspondent au bulletin versé. Si l'écran « Masse salariale » affiche « La masse salariale et la validation par le propriétaire ne sont pas incluses dans l'offre de l'établissement. », le noter (fonction de l'abonnement).
- [ ] Résultat attendu constaté
- [ ] Le fichier CSV s'ouvre dans un tableur

#### C13.12 Séparation des tâches et seuil propriétaire
**Comptes :** directeur, propriétaire · **Prérequis :** C13.9 fait (séparation des tâches cochée, seuil 10 000 F), C13.10 fait (le premier bulletin est versé)
1. En directeur : « Nouvelle période » : Nom « Début octobre 2026 », du `01/10/2026` au `04/10/2026`. Ouvrez-la et « Lancer le calcul ». Le bulletin de Kouadio TRAORE est « Calculé » pour un montant proportionnel aux jours ouvrés restants non encore payés (inférieur au salaire mensuel).
2. Toujours en directeur, cliquez « Arrêter le montant ».
3. Connectez-vous en propriétaire. Ouvrez « Masse salariale » > « Bulletins à valider ». Cliquez « Valider » en face du bulletin.
4. Pour tester le seuil séparément : rendez-vous en économe, créez et calculez une nouvelle période, puis, en directeur, essayez « Arrêter le montant ». Si le montant calculé est inférieur au seuil, le propriétaire abaisse d'abord le seuil à `1000` dans « Réglages ».
**Résultat attendu :** étape 2 : le directeur est refusé avec « Séparation des tâches : faites arrêter ce bulletin par une autre personne que celle qui l'a calculé. » (il a calculé lui-même). Étape 3 : le propriétaire valide, « Le bulletin est validé. » (même action que l'arrêt du montant) et le bulletin passe à « Arrêté (impayé) ». Étape 4 : le directeur est refusé avec « Montant au-dessus du seuil : seul le propriétaire peut l'arrêter, depuis « Masse salariale ». » ; seul le propriétaire peut valider.
- [ ] Résultat attendu constaté (séparation des tâches)
- [ ] Résultat attendu constaté (seuil propriétaire)
- [ ] Une fois la séparation des tâches décochée dans « Réglages », la personne qui a calculé un bulletin peut l'arrêter (facultatif)

#### C13.13 Contestation par l'enseignant puis décision de la direction
**Comptes :** enseignant, directeur · **Prérequis :** un bulletin « Arrêté (impayé) » (celui de C13.12)
1. En enseignant, ouvrez le bulletin dans `/v2/teacher/payslips`. Cliquez « Contester ce bulletin ». Motif : « Test : heures à vérifier » (3 à 500 caractères). « Envoyer la contestation ».
2. Message « Votre contestation a été transmise à la gestion de la paie. » ; statut « Contesté », message « Ce bulletin est contesté : la gestion de la paie l'examine. »
3. En directeur, ouvrez le même bulletin : « Ce bulletin est contesté. Motif : … ». Cliquez « Annuler le bulletin », saisissez le motif « Test de contestation », « Annuler le bulletin ». (Attention : un bulletin annulé ne ressuscite pas.)
**Résultat attendu :** le bulletin devient « Annulé » (« Ce bulletin est annulé. Motif : … ») ; ses jours sont libérés et un nouveau calcul peut le recréer. La contestation par la direction (bouton « Contester » sur un bulletin arrêté) donne le même statut. Retour du bulletin contesté à l'état « Arrêté » : possible dans les règles (arrêter de nouveau, depuis la sélection de la période) ; à confirmer sur l'écran.
- [ ] Résultat attendu constaté
- [ ] Le bulletin annulé est exclu de la masse salariale et montré « à part »

### 13.4 Cas limites et tests négatifs

#### C13.N1 L'économe ne peut ni arrêter ni annuler
**Compte :** économe · **Où :** fiche d'un bulletin « Calculé »
1. Ouvrez un bulletin « Calculé » (créer une période de test si besoin).
2. Cherchez « Arrêter le montant », « Contester » et « Annuler le bulletin ».
**Résultat attendu :** ces trois boutons sont absents pour l'économe ; seuls « Primes et retenues » et, plus tard, « Constater le versement » et « Envoyer au titulaire » lui sont proposés. Sur la fiche de la période, les boutons « Arrêter la sélection » et « Tout arrêter » sont également absents.
- [ ] Résultat attendu constaté

#### C13.N2 Réglages réservés au propriétaire
**Comptes :** directeur, économe · **Où :** `/v2/payroll/configuration/settings`
1. Tapez l'adresse directement.
**Résultat attendu :** « Accès refusé » (« Vous n'avez pas les droits nécessaires pour afficher cette page. »). Le directeur n'a pas non plus le droit d'arrêter un bulletin au-delà du seuil.
- [ ] Résultat attendu constaté (directeur)
- [ ] Résultat attendu constaté (économe)

#### C13.N3 L'enseignant ne voit que ses bulletins arrêtés
**Compte :** enseignant · **Où :** `/v2/payroll`, `/v2/payroll/payslips`, `/v2/payroll/configuration`, `/v2/payroll/payslips/<identifiant d'un autre bulletin>`
1. Tapez `/v2/payroll` puis `/v2/payroll/payslips` puis `/v2/payroll/configuration`.
2. Récupérez l'identifiant d'un bulletin d'un autre enseignant (en direction, adresse d'un bulletin de Fatou YAO s'il existe) et tapez `/v2/payroll/payslips/<identifiant>` en enseignant.
**Résultat attendu :** « Accès refusé » aux étapes 1. Étape 2 : le bulletin d'autrui, un bulletin inconnu ou un brouillon « Calculé » répondent de la même façon, comme s'il n'existait pas (message d'élément introuvable) ; aucune donnée n'apparaît.
- [ ] Résultat attendu constaté

#### C13.N4 Secrétariat et parent n'ont aucun accès à la paie
**Comptes :** secrétariat, parent · **Où :** `/v2/payroll`, `/v2/payroll/my`
1. Tapez les adresses.
**Résultat attendu :** « Accès refusé » ; aucune entrée de paie dans leurs menus.
- [ ] Résultat attendu constaté

#### C13.N5 Montants invalides et chevauchement de configuration
**Compte :** économe · **Où :** « Configurations »
1. « Nouvelle configuration » : Salaire mensuel `150000,5` ou `-1` ou vide pour le type « Salaire ».
2. Créez une seconde configuration pour Kouadio TRAORE dont les dates chevauchent la première (début `01/09/2026`).
**Résultat attendu :** étape 1 : « Le montant est un entier en francs : pas de virgule ni de point. » / « Le montant ne peut pas être négatif. » / « Saisissez un montant. ». Étape 2 : refus pour chevauchement de configurations d'un même enseignant (message de refus du système).
- [ ] Résultat attendu constaté

#### C13.N6 Une période en cours et le non-doublement des jours
**Compte :** économe · **Où :** « Périodes »
1. Avec une période « En attente de calcul », essayez « Nouvelle période ».
2. Après C13.5, créez une période qui chevauche septembre (par exemple du `15/09/2026` au `15/10/2026`) et calculez-la.
3. Sur la fiche de la première période, cochez « Recalculer les bulletins déjà calculés » et relancez le calcul.
**Résultat attendu :** étape 1 : bouton bloqué avec l'explication. Étape 2 : les jours déjà payés (15 au 30 septembre) ne sont pas payés une seconde fois ; seule la partie d'octobre est comptée (« Rien à verser : les jours ont déjà été payés par une autre période. » si tout est déjà payé). Étape 3 : le bulletin déjà arrêté, versé ou annulé n'est jamais réécrit (« Bulletin déjà arrêté, versé ou annulé : un recalcul ne le réécrit jamais. »).
- [ ] Résultat attendu constaté

#### C13.N7 Un bulletin versé ne s'annule pas ; un bulletin annulé ne revient pas
**Compte :** directeur · **Où :** fiche d'un bulletin
1. Ouvrez le bulletin « Versé » de C13.10 et cherchez « Annuler le bulletin ».
2. Ouvrez le bulletin « Annulé » de C13.13 et cherchez les boutons d'action.
**Résultat attendu :** aucun bouton d'annulation sur un bulletin versé ; aucun bouton d'action sur un bulletin annulé (le calcul d'une période peut le recréer s'il est encore calculable).
- [ ] Résultat attendu constaté

#### C13.N8 Isolation entre établissements
**Compte :** directeur de `demo-primaire` · **Où :** adresse d'un bulletin du collège
1. En directeur de `demo-secondaire`, copiez l'adresse d'un bulletin (`/v2/payroll/payslips/<identifiant>`).
2. Dans `http://demo-primaire.localhost:3100`, connectez-vous en directeur et ouvrez la même adresse.
**Résultat attendu :** la page répond comme si le bulletin n'existait pas ; aucune donnée du collège n'est affichée (à confirmer sur le texte de l'écran).
- [ ] Résultat attendu constaté

### 13.5 Problèmes connus et limites
- **Paie vide par défaut** : aucune donnée de paie n'est semée (périodes, configurations, bulletins, tarifs, réglages saisis). Le jeu minimal est créé en C13.2, C13.4 et C13.5. Une relance de la démonstration à zéro efface ces données.
- **Heures** : le calcul « Horaire » ou « Mixte » nécessite des heures validées (présences du personnel pour le collège et le primaire, séances validées pour le supérieur). Les données d'appel de la démonstration concernent les élèves ; aucune présence de personnel n'est créée par la graine. Ne pas attendre de bulletin horaire sans préparer ces heures (« Aucune heure validée sur la période. »).
- **Rapport QA m8** : pour le propriétaire, ouvrir « Mes bulletins » (`/v2/payroll/my`) déclenche un refus en arrière-plan (« Mes bulletins » concerne les personnes qui ont une fiche de personnel : le propriétaire de démonstration n'en a pas). Comportement attendu hors menu.
- **Pages vides au départ (rapport QA)** : périodes, bulletins, configurations, historique, rapports (« Aucune donnée pour ces filtres »), masse salariale (« Aucune période »).
- **PDF du bulletin** : le PDF officiel n'existe qu'une fois le bulletin versé ; pour un bulletin arrêté non versé, l'aperçu « Bulletin arrêté » (intégrité vérifiée par empreinte) tient lieu de document. Le rendu dépend du service de documents (à confirmer).
- **Notifications** : « Envoyer au titulaire » enregistre une demande de notification ; aucun envoi réel (e-mail, SMS) n'est fait en démonstration.
- **Francs entiers** : tous les montants de paie sont des francs entiers (décision du 2026-10-02) ; les arrondis se font au franc supérieur à partir de la demi-unité, ligne par ligne.

### 13.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- La spec 032 (module `payroll`) est portée par les écrans `/v2/payroll/**` (périodes, bulletins, configurations, tarifs, réglages, historique, rapports, masse salariale, mes bulletins) et `/v2/teacher/payslips` : aucun écran manquant constaté pour les routes de la spec.
- La contestation par le titulaire (`payroll.my.dispute`) n'existe que sur `/v2/teacher/payslips/<id>` ; sur `/v2/payroll/my/<id>` le texte renvoie vers la gestion (« la contestation est enregistrée par un gestionnaire ») : deux écrans « mes bulletins » au comportement différent.
- Aucun bouton explicite « Arrêter de nouveau » sur la fiche d'un bulletin contesté (la machine d'états autorise « Contesté » vers « Arrêté ») : la reprise n'est possible, si elle l'est, que par la sélection de la période (à confirmer).
- La graine de démonstration (`scripts/seed-v2/demo/*.ts`) ne comporte aucun jeu de paie ni présence de personnel : le rapport QA note les pages vides ; aucun scénario de démonstration n'est prévu par `docs/DEMO_TEST_GUIDE.md` pour la paie.
- Les entrées de menu « Mes rémunérations » (enseignant) et « Masse salariale » (propriétaire) dépendent des fonctions d'offre `payroll.core` et `payroll.owner-validation` ; leur disponibilité dans l'abonnement de démonstration est à confirmer.


## Chapitre 14. Documents (GED)
> **Durée estimée :** 75 à 100 minutes · **Établissement(s) :** `demo-secondaire` (parcours complet) ; `demo-primaire` et `demo-superieur` pour un contrôle rapide (C14.1) · **Comptes :** direction générale (propriétaire), secrétariat, directeur des études, économe, enseignant, parent

### 14.1 Objectif
Vérifier la gestion électronique des documents : dépôt d'un fichier, classement par catégorie, niveaux de confidentialité, partage avec une personne, versions successives, historique des consultations, archivage et restauration. Vérifier aussi que chaque rôle ne voit que les documents que son niveau d'accès lui permet de voir, et que la lecture d'un document confidentiel laisse une trace.

### 14.2 Avant de commencer
- **Comptes** (adresse de connexion `http://demo-secondaire.localhost:3100/v2/login`). Les mots de passe et le détail des comptes sont dans le fichier des comptes de démonstration (`.demo/credentials.md`). Le code MFA s'obtient avec `pnpm demo:totp <e-mail>`.

| Rôle | E-mail | MFA | Ce qu'il fait dans ce chapitre |
|---|---|---|---|
| Propriétaire | `direction.generale@demo-secondaire.test` | oui | Lit les documents confidentiels, gère les catégories, la quarantaine et les paramètres, restaure |
| Secrétariat | `secretariat@demo-secondaire.test` | oui | Dépose, partage, consulte l'historique (niveau « Restreint ») |
| Directeur des études | `etudes@demo-secondaire.test` | oui | Archive (le secrétariat ne le peut pas) |
| Économe | `econome@demo-secondaire.test` | oui | Dépose et lit (niveau « Restreint »), ne partage pas |
| Enseignant (Kouadio TRAORE) | `enseignant@demo-secondaire.test` | non | Lit le niveau « Interne », ses documents de personnel, ce qu'on partage avec lui |
| Parent (Séka DIABATE) | `parent@demo-secondaire.test` | non | Dépose et lit les pièces de ses enfants Nadia et Salimata DIABATE |

- **Chemin de menu** : par le sélecteur « Modules » de l'en-tête, choisir « Documents », ou saisir directement l'adresse `/v2/documents`. Entrées de menu du personnel : « Documents », « Documents à échéance », « Catégories de documents », « Quarantaine des documents », « Paramètres des documents ». Pour l'enseignant, l'entrée s'appelle « Mes documents » ; pour le parent, « Documents de mes enfants ».
- **Adresses** : `/v2/documents` (explorateur), `/v2/documents/expirations`, `/v2/documents/categories`, `/v2/documents/quarantine`, `/v2/documents/settings`. Le détail d'un document est `/v2/documents/<identifiant>` : on y arrive en cliquant sur le document dans la liste.
- **Données de démonstration** : la graine ne dépose **aucun document**. L'explorateur est donc vide au départ (message « Aucun document ne correspond. »). Les 17 catégories de départ sont créées automatiquement à la première ouverture de l'établissement. Vous devez fournir **quelques petits fichiers de test** (quelques Ko) : deux PDF différents, une image PNG, un document Word (.docx) et un fichier texte renommé en `.exe` ou `.pdf` pour les tests négatifs. N'utilisez aucun vrai document personnel.
- **Antivirus** : dans la démonstration, aucun antivirus n'est branché. Les fichiers déposés portent le badge « Non analysé » (et non « Analysé »). C'est normal.
- **Ordre conseillé** : exécutez les scénarios dans l'ordre. C14.6 à C14.8 réutilisent les documents créés en C14.2 à C14.4. Les actions d'archivage (C14.10) sont à faire en dernier ; `pnpm demo:reset` remet tout à zéro.

Catégories de départ utiles pour les tests (libellés réels) :

| Libellé | Niveau | Remarque |
|---|---|---|
| « Règlement intérieur et chartes » | Interne | Formats : PDF, Office, images, texte |
| « Assurances » | Restreint | Date d'expiration obligatoire |
| « Pièces d'identité de l'élève » | Restreint | Lisible par l'élève et ses tuteurs ; dépôt possible par le parent |
| « Dossier médical » | Confidentiel | Lisible par les tuteurs de l'élève |
| « Pièces comptables » | Confidentiel | Réservé à la direction |
| « Diplômes et attestations » | Restreint | Dépôt possible par le membre du personnel concerné |

### 14.3 Scénarios

#### C14.1 Découvrir l'explorateur et les catégories de départ
**Compte :** propriétaire · **Où :** `/v2/documents` puis `/v2/documents/categories`
1. Connectez-vous (code MFA demandé) et ouvrez « Documents ».
2. Lisez le titre « Documents » et le texte d'introduction : vous ne voyez que les documents que votre rôle, la catégorie et les partages autorisent.
3. Repérez les filtres : « Rechercher », « Catégorie », « Type de document », « Portée », « Échéance », « Concerne », « État ». Repérez le bouton « Déposer un document ».
4. Ouvrez « Catégories de documents ». Comptez les catégories listées.
5. Ouvrez une catégorie avec « Modifier » (sans enregistrer) et lisez : niveau de confidentialité, extensions acceptées, taille maximale, « Lisible par la personne concernée », « Lisible par les tuteurs », « Échéance obligatoire ».
6. Répétez l'étape 1 à 2 sur `demo-primaire` et `demo-superieur` (même compte : `direction.generale@<slug>.test`) : l'explorateur y est vide aussi.
**Résultat attendu :** l'explorateur est vide ; 17 catégories existent (5 types : dossier d'élève, dossier du personnel, établissement, académique, financier) ; un bandeau explique que changer le niveau d'une catégorie change aussitôt qui voit ses documents.
- [ ] Explorateur vide avec le message d'aide « Déposez un premier document… »
- [ ] 17 catégories listées, avec leur niveau (Interne, Restreint, Confidentiel)
- [ ] Même constat dans les trois établissements

#### C14.2 Déposer un document de niveau « Interne »
**Compte :** secrétariat · **Où :** `/v2/documents`
1. Connectez-vous avec `secretariat@demo-secondaire.test` (code MFA).
2. Cliquez sur « Déposer un document ».
3. Catégorie : « Règlement intérieur et chartes ». « Document concernant » : « Aucune personne (établissement) ».
4. Titre : `Règlement intérieur test`. Étiquettes : `test, règlement`. Laissez « Visibilité » sur « Selon la catégorie ».
5. Glissez ou choisissez votre premier PDF de test, puis « Déposer ».
6. Ouvrez le document créé dans la liste.
**Résultat attendu :** le document apparaît dans l'explorateur avec « 1 version ». Dans le détail : badges « Établissement » et « Interne » ; « Version 1 · version actuelle » ; badge « Non analysé » ; l'empreinte « SHA-256 » est affichée ; le déposant est le secrétariat.
- [ ] Document visible dans la liste après le dépôt
- [ ] Détail : « Version 1 », niveau « Interne », empreinte affichée
- [ ] Boutons « Télécharger », « Nouvelle version », « Modifier » présents ; pas de bouton « Archiver » (le secrétariat ne peut pas archiver)

#### C14.3 Déposer une pièce à échéance obligatoire
**Compte :** secrétariat · **Où :** « Déposer un document »
1. Catégorie : « Assurances ». Notez le texte « Cette catégorie exige une date d'expiration. »
2. Titre : `Attestation d'assurance test`. Choisissez un fichier. Cliquez sur « Déposer » **sans** date d'expiration.
3. Lisez l'erreur, puis saisissez une « Date d'expiration » dans 20 jours et déposez.
4. Ouvrez « Documents à échéance » (ou le bouton « Échéances » de l'explorateur). Parcourez l'onglet « À échoir ».
**Résultat attendu :** sans date, le dépôt est refusé avec « La date d'expiration est obligatoire pour cette catégorie. ». Avec une date, le document porte le badge « Expire dans 20 jours » et figure dans l'onglet « À échoir » (selon l'« Horizon » choisi ; élargissez-le si besoin).
- [ ] Refus sans date d'expiration
- [ ] Badge « Expire dans … jours » après dépôt
- [ ] Document listé dans « Documents à échéance » > « À échoir »

#### C14.4 Déposer une nouvelle version
**Compte :** secrétariat · **Où :** détail du document « Règlement intérieur test »
1. Cliquez sur « Nouvelle version ». Lisez : « La version 2 remplacera la version actuelle ; les versions précédentes restent consultables. »
2. Choisissez votre **second** PDF (différent du premier). « Note de version » : `Mise à jour test`. Cliquez sur « Déposer la version ».
3. Dans la section des versions, repérez « Version 2 · version actuelle » et « Version 1 ».
4. Cliquez sur « Télécharger la version 1 ».
**Résultat attendu :** deux versions sont listées, la 2 est la version actuelle avec sa note ; la version 1 reste téléchargeable. Le titre du document ne change pas.
- [ ] Deux versions listées, la plus récente marquée « version actuelle »
- [ ] Note de version affichée
- [ ] La version 1 se télécharge toujours

#### C14.5 Prévisualiser et télécharger, puis lire l'historique
**Compte :** secrétariat · **Où :** détail du document « Règlement intérieur test »
1. Cliquez sur « Prévisualiser la version 2 » : l'aperçu s'affiche sous la liste (titre « Aperçu de la version 2 »).
2. Cliquez sur « Télécharger ».
3. Descendez jusqu'à la section « Historique ».
4. Variante : déposez un document Word (.docx) dans « Règlement intérieur et chartes » et tentez de le prévisualiser.
**Résultat attendu :** l'historique liste, avec date et auteur, « Document déposé », « Nouvelle version déposée », « Prévisualisé » et « Téléchargé ». Pour le .docx, le message « Aucune prévisualisation pour ce type de fichier : téléchargez-le. » s'affiche (la prévisualisation des fichiers Office n'est pas activée dans la démonstration).
- [ ] Les aperçus et téléchargements apparaissent dans l'historique avec le nom du secrétariat
- [ ] Aperçu PDF ou image affiché
- [ ] Message « Aucune prévisualisation… » pour le .docx

#### C14.6 Partager un document avec une personne
**Compte :** secrétariat puis enseignant · **Où :** détail du document « Attestation d'assurance test »
1. Secrétariat : dans la section « Partages », champ « Partager avec », recherchez `Kouadio TRAORE` (l'enseignant). « Droit accordé » : « Lecture ». Laissez « Fin du partage » vide. Cliquez sur « Partager ».
2. Vérifiez le message « Document partagé avec … » et la ligne du partage (« Lecture · sans date de fin »).
3. Déconnectez-vous. Connectez-vous avec `enseignant@demo-secondaire.test` (sans MFA) et ouvrez « Mes documents ». Choisissez la portée « Partagés avec moi ».
4. Ouvrez le document : l'enseignant peut le lire et le télécharger, mais pas déposer de version (droit « Lecture » seulement).
5. Reconnectez-vous en secrétariat, cliquez sur « Retirer » en face de Kouadio TRAORE.
6. Reconnectez-vous en enseignant, rechargez l'explorateur.
**Résultat attendu :** tant que le partage existe, le document « Restreint » est visible de l'enseignant malgré son niveau d'accès ; après « Retirer », il disparaît de ses listes et son adresse directe répond comme si le document n'existait pas.
- [ ] Partage créé et visible côté secrétariat
- [ ] Document visible dans « Partagés avec moi » pour l'enseignant
- [ ] Après retrait du partage, le document n'est plus visible pour l'enseignant

#### C14.7 Niveaux de confidentialité selon le rôle
**Compte :** propriétaire, secrétariat, enseignant · **Où :** `/v2/documents`
1. Propriétaire : déposez un document dans « Pièces comptables » (niveau Confidentiel), titre `Pièce comptable test` (PDF).
2. Vous disposez maintenant de trois documents : « Règlement intérieur test » (Interne), « Attestation d'assurance test » (Restreint, partage retiré), « Pièce comptable test » (Confidentiel).
3. Notez ce que voit chaque compte dans l'explorateur (portée « Tout ce que je peux voir ») : propriétaire, secrétariat, économe, enseignant.
4. Avec le secrétariat, ouvrez « Déposer un document » et regardez la liste des catégories proposées.
**Résultat attendu :**

| Compte | Interne | Restreint | Confidentiel |
|---|---|---|---|
| Propriétaire | oui | oui | oui |
| Secrétariat, économe | oui | oui | non |
| Enseignant | oui | non (sauf partage) | non |

Le secrétariat ne se voit proposer ni « Dossier médical », ni « Pièces comptables », ni « Contrats de travail » (catégories confidentielles) au dépôt.
- [ ] Le propriétaire voit les trois documents
- [ ] Le secrétariat et l'économe ne voient pas « Pièce comptable test »
- [ ] L'enseignant ne voit que « Règlement intérieur test »
- [ ] Les catégories confidentielles ne sont pas proposées au dépôt du secrétariat

#### C14.8 Lecture auditée d'un document confidentiel
**Compte :** propriétaire · **Où :** détail du document « Pièce comptable test »
1. Ouvrez le document. Si une fenêtre « Confirmez votre identité » apparaît, saisissez le code MFA courant (`pnpm demo:totp direction.generale@demo-secondaire.test`) ; un code déjà utilisé est refusé, attendez le suivant.
2. Cliquez sur « Prévisualiser la version 1 » puis sur « Télécharger ».
3. Consultez la section « Historique ».
4. Ouvrez le journal d'audit de l'établissement (module « Journal d'audit ») et recherchez les événements de lecture de documents.
**Résultat attendu :** l'historique montre « Consulté », « Prévisualisé » et « Téléchargé » avec l'auteur et l'heure ; le journal d'audit contient les lectures correspondantes (celles d'un document confidentiel sont signalées avec une gravité supérieure). Le titre et le nom du fichier n'apparaissent pas dans les événements d'audit.
- [ ] Trois entrées de lecture dans l'historique du document
- [ ] Entrées de lecture dans le journal d'audit
- [ ] Aucun titre de document ni nom de fichier dans l'audit

#### C14.9 Dépôt d'une pièce par un parent et par un membre du personnel
**Compte :** parent, enseignant, secrétariat · **Où :** `/v2/documents`
1. Parent (`parent@demo-secondaire.test`) : ouvrez « Documents de mes enfants », puis « Déposer un document ».
2. Catégorie « Pièces d'identité de l'élève », « Enfant concerné » : `Nadia DIABATE`. Titre `Extrait de naissance test`, fichier PNG ou PDF. Déposez.
3. Vérifiez que le document figure dans la portée « Mes enfants ».
4. Enseignant : ouvrez « Mes documents » et déposez un document dans « Diplômes et attestations » (il est automatiquement « concernant » lui-même). Titre `Diplôme test`.
5. Secrétariat : retrouvez les deux documents dans l'explorateur (filtre « Concerne »).
**Résultat attendu :** le parent ne peut déposer que pour ses propres enfants (Nadia, Salimata), l'enseignant que pour lui-même ; le secrétariat voit les deux pièces (niveau « Restreint »). Le parent voit aussi, plus tard, ce que le secrétariat dépose pour son enfant dans une catégorie « lisible par les tuteurs ».
- [ ] Le parent ne peut choisir que Nadia ou Salimata DIABATE
- [ ] Documents visibles dans « Mes enfants » (parent) et « Mon dossier de personnel » (enseignant)
- [ ] Le secrétariat voit les deux documents

#### C14.10 Archiver et restaurer (action à faire en dernier)
**Compte :** directeur des études puis propriétaire · **Où :** détail d'un document de test
**Attention :** l'archivage masque le document ; la restauration est réservée à la direction. Une purge automatique intervient après la durée de conservation de l'établissement.
1. Directeur des études (`etudes@demo-secondaire.test`, MFA) : ouvrez « Diplôme test » (ou tout autre document de test) et cliquez sur « Archiver ». Saisissez un motif d'au moins 3 caractères, confirmez.
2. Vérifiez le message « Document archivé : il n'apparaît plus dans les listes. » puis rechargez l'explorateur.
3. Propriétaire : dans l'explorateur, filtre « État » : « Archivés ». Ouvrez le document : le bandeau « Ce document est archivé. Motif : … » s'affiche.
4. Cliquez sur « Restaurer ».
**Résultat attendu :** le document disparaît des listes ordinaires après l'archivage, reste lisible par le propriétaire, puis réapparaît après « Restaurer » (message « Document restauré. »). L'historique conserve « Archivé » et « Restauré ».
- [ ] Archivage avec motif obligatoire
- [ ] Document absent de la liste « Actifs » après archivage
- [ ] Restauration par le propriétaire uniquement

#### C14.11 Gérer une catégorie et un droit par personne
**Compte :** propriétaire · **Où :** `/v2/documents/categories`
1. Cliquez sur « Nouvelle catégorie ». Code `TEST_CONFIDENTIEL`, type « Établissement », libellé `Pièces de test confidentielles`, niveau « Confidentiel (direction) », au moins une extension.
2. Enregistrez. Sur la ligne de la catégorie, cliquez sur « Droits par personne ».
3. Personne : `Kouadio TRAORE`, droit « Lecture », puis « Accorder le droit ».
4. Déposez un document dans cette catégorie (propriétaire). Reconnectez-vous en enseignant et ouvrez l'explorateur.
5. Propriétaire : retirez le droit (« Retirer »), puis archivez la catégorie (« Archiver »).
**Résultat attendu :** l'enseignant, qui ne lit normalement pas le niveau confidentiel, voit tout le contenu de cette catégorie tant que le droit existe. Après retrait, il ne voit plus rien. La catégorie archivée affiche « Catégorie « Pièces de test confidentielles » archivée. » et n'accepte plus de dépôt.
- [ ] Catégorie créée avec le niveau « Confidentiel »
- [ ] L'enseignant lit le document grâce au droit par personne
- [ ] Accès coupé après « Retirer »

#### C14.12 Paramètres, quota et quarantaine (lecture)
**Compte :** propriétaire · **Où :** `/v2/documents/settings`, `/v2/documents/quarantine`
1. Ouvrez « Paramètres des documents ». Lisez « Stockage utilisé » (documents, versions, archivés, en quarantaine) et le quota de l'abonnement.
2. Modifiez « Seuils d'alerte d'expiration (jours) » en `30, 7, 1` (valeur inchangée) puis « Enregistrer ».
3. Ouvrez « Quarantaine des documents ». Parcourez les onglets « En quarantaine », « Libérés », « Détruits », « Tous ».
**Résultat attendu :** « Paramètres enregistrés. » ; le stockage utilisé tient compte des fichiers déposés dans ce chapitre ; la quarantaine affiche « Aucun fichier. » dans tous les onglets (voir limites en 14.5).
- [ ] Jauge de stockage cohérente avec les dépôts effectués
- [ ] Paramètres enregistrés
- [ ] Quarantaine vide, avec l'avertissement sur la libération motivée et l'authentification forte

### 14.4 Cas limites et tests négatifs

#### C14.N1 Fichier refusé (format, taille, contenu)
**Compte :** secrétariat · **Où :** « Déposer un document »
1. Catégorie « Règlement intérieur et chartes ». Choisissez un fichier `.exe` (ou tout format non listé).
2. Choisissez un fichier vide (0 octet).
3. Choisissez un fichier texte renommé en `.pdf`.
4. Catégorie « Assurances » : essayez un fichier `.docx` (format non listé pour cette catégorie).
**Résultat attendu :** « Le fichier « … » n'a pas un format accepté (…). » ; « Le fichier « … » est vide. » ; pour le faux PDF, le dépôt est refusé par l'enregistrement (le type réel du fichier est contrôlé ; libellé exact du message à confirmer). Rien n'est ajouté à la liste.
- [ ] Format non listé refusé
- [ ] Fichier vide refusé
- [ ] Faux PDF refusé par l'enregistrement
- [ ] Aucun document créé

#### C14.N2 Même fichier déposé deux fois
**Compte :** secrétariat
1. Dans le détail de « Règlement intérieur test », « Nouvelle version » avec **exactement le même fichier** que la version actuelle.
2. Déposez le même fichier une seconde fois en tant que **nouveau** document dans la même catégorie, avec la même personne concernée.
**Résultat attendu :** les deux dépôts sont refusés (fichier identique à la version actuelle ; doublon). Libellés exacts à confirmer.
- [ ] Version identique refusée
- [ ] Doublon refusé

#### C14.N3 Rôle sans droit
**Compte :** enseignant, économe, secrétariat
1. Enseignant : tapez `/v2/documents/quarantine`, puis `/v2/documents/categories`, puis `/v2/documents/settings`.
2. Économe : ouvrez un document du secrétariat et cherchez la section « Partages ».
3. Secrétariat : tapez `/v2/documents/quarantine`.
4. Enseignant : essayez de déposer dans une catégorie « Restreint » (« Assurances »).
**Résultat attendu :** les trois adresses de gestion répondent par un message d'accès refusé pour l'enseignant et pour le secrétariat ; ces entrées n'apparaissent pas dans leur menu. L'économe ne peut pas partager (pas de section de partage proposée, ou refus à l'action). L'enseignant ne peut pas déposer dans une catégorie de niveau supérieur au sien (catégorie non proposée).
- [ ] Quarantaine, catégories et paramètres inaccessibles à l'enseignant
- [ ] Quarantaine inaccessible au secrétariat
- [ ] Pas de dépôt possible dans « Assurances » pour l'enseignant

#### C14.N4 Document hors périmètre : page introuvable
**Compte :** parent, enseignant
1. Secrétariat : déposez `Pièce élève Aya BAMBA` dans « Pièces d'identité de l'élève » pour l'élève `Aya BAMBA`. Copiez l'adresse du détail du document.
2. Parent (Séka DIABATE, enfants Nadia et Salimata) : collez l'adresse dans la barre d'adresse.
3. Enseignant : collez la même adresse.
4. Essayez aussi une adresse inventée : `/v2/documents/00000000-0000-0000-0000-000000000000`.
**Résultat attendu :** le parent, l'enseignant et l'adresse inventée donnent la **même réponse** : le document est introuvable, comme s'il n'existait pas (rien ne révèle son existence).
- [ ] Parent : document d'un autre élève introuvable
- [ ] Enseignant : document restreint introuvable
- [ ] Réponse identique pour l'adresse inventée

#### C14.N5 Document « Privé » ou « Personnel seulement » et isolation entre établissements
**Compte :** secrétariat, parent
1. Secrétariat : déposez un document pour `Nadia DIABATE` dans « Pièces d'identité de l'élève », puis « Modifier » > « Visibilité » : « Privé ». Enregistrez.
2. Parent : ouvrez « Mes enfants ».
3. Ouvrez `http://demo-primaire.localhost:3100/v2/login` et tentez de vous connecter avec le compte `secretariat@demo-secondaire.test`.
**Résultat attendu :** le parent ne voit plus le document dès que la visibilité passe à « Privé » (elle l'avait vu en « Selon la catégorie »). La connexion du secrétariat de `demo-secondaire` sur `demo-primaire` est refusée : chaque établissement est isolé.
- [ ] Le document « Privé » disparaît de la vue du parent
- [ ] Le compte d'un établissement ne se connecte pas à un autre

#### C14.N6 Archivage sans motif
**Compte :** directeur des études
1. Sur un document de test, « Archiver » puis confirmer avec un motif vide ou de 1 à 2 caractères.
**Résultat attendu :** la confirmation est refusée tant que le motif n'a pas 3 caractères au moins.
- [ ] Archivage impossible sans motif

#### C14.N7 Réglages invalides
**Compte :** propriétaire · **Où :** `/v2/documents/settings`
1. « Taille maximale d'un fichier » : `200`. « Seuils d'alerte » : `30, abc`. « Versions maximales » : `0`.
**Résultat attendu :** « Taille invalide (100 Mo au plus). », « Seuils invalides : nombres entiers de 0 à 365 séparés par des virgules. », « Nombre invalide (1 à 500). » ; rien n'est enregistré.
- [ ] Les trois erreurs s'affichent
- [ ] Aucun réglage modifié

### 14.5 Problèmes connus et limites
- **Pas d'antivirus dans la démonstration** : les fichiers sont marqués « Non analysé » et la quarantaine ne peut pas être alimentée (aucun fichier suspect n'est détecté). Le scénario « fichier infecté » n'est pas réalisable en démonstration ; seuls l'écran vide et l'accès restreint sont vérifiables.
- La prévisualisation des documents Word, Excel et PowerPoint n'est pas activée : téléchargez le fichier.
- Aucune donnée documentaire dans la graine : tout est à déposer par le testeur.
- Les pièces déjà stockées ailleurs (photos des élèves, justificatifs d'absence, pièces jointes de messagerie, pièces d'un dossier d'admission) ne sont pas reprises dans la GED.
- Pas de recherche dans le contenu des fichiers, pas de partage avec une personne extérieure à l'établissement, pas de circuit de validation d'un dépôt de parent (le dépôt est immédiat).
- Les alertes d'expiration (30, 7 et 1 jours avant) sont émises par une tâche quotidienne : elles ne sont pas visibles immédiatement.
- Le menu « Documents » n'est pas toujours présent dans le menu de gauche pour tous les rôles ; utilisez le sélecteur « Modules » ou l'adresse directe.
- La page « Mes documents » du portail élève (`/v2/student/documents`) est un autre écran (bulletins, factures) : elle n'affiche pas les documents de la GED.

### 14.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- AC-8 (EICAR, mise en quarantaine, antivirus indisponible en mode « échec fermé ») non vérifiable en démonstration : `DOCUMENTS_SCANNER` n'est pas positionné par `scripts/demo/lib/env.mjs`.
- Le raccordement du sélecteur de documents aux fiches élèves, personnel et appels n'est pas fait (spec 024 §10).
- Libellés d'erreur de doublon, de version identique et de faux PDF non retrouvés dans `fr-CI.json` (côté serveur) : à confirmer à l'écran.
- La graine ne contient aucun document ; aucune échéance n'existe tant que le testeur n'en crée pas.

---

## Chapitre 15. Messagerie, annonces et notifications
> **Durée estimée :** 90 à 120 minutes (plus une attente de 1 à 2 minutes pour le journal) · **Établissement(s) :** `demo-secondaire` (parcours complet) ; `demo-primaire` pour un contrôle des annonces · **Comptes :** directeur, direction générale (propriétaire), secrétariat, enseignant, parent, élève

### 15.1 Objectif
Vérifier la communication interne : conversations entre parents, enseignants et administration, annonces ciblées avec accusé de réception, notifications dans l'application, journal des envois (tous simulés), préférences de notification de chaque personne, heures calmes, avis urgent, signalement et modération des messages. Vérifier qu'**aucun message réel** (SMS, e-mail, WhatsApp) ne part.

### 15.2 Avant de commencer
- **Comptes** (`http://demo-secondaire.localhost:3100/v2/login` ; mots de passe dans `.demo/credentials.md` ; code MFA : `pnpm demo:totp <e-mail>`) :

| Rôle | E-mail | MFA | Rôle dans le chapitre |
|---|---|---|---|
| Directeur | `directeur@demo-secondaire.test` | oui | Auteur de l'annonce de la graine ; publie, modère, envoie un avis |
| Propriétaire | `direction.generale@demo-secondaire.test` | oui | Avis urgent, canaux, règles, paramètres |
| Secrétariat | `secretariat@demo-secondaire.test` | oui | Publie une annonce, envoie une convocation, lit le journal |
| Enseignant (Kouadio TRAORE) | `enseignant@demo-secondaire.test` | non | Reçoit et répond, signale un message |
| Parent (Séka DIABATE) | `parent@demo-secondaire.test` | non | Reçoit, accuse réception, règle ses préférences |
| Élève | `eleve@demo-secondaire.test` | non | Lit les annonces |

- **Chemins de menu** : sélecteur « Modules » > « Communication » (entrées « Messages », « Annonces », « Modération des messages », « Paramètres de la messagerie ») et « Notifications » (« Journal des notifications », « Gabarits de notification », « Règles et alertes », « Canaux d'envoi »). Pour le parent, l'enseignant et l'élève, les entrées « Messages » et « Annonces » sont dans le menu de leur portail. « Mes notifications » est dans le menu « Mon compte » (en-tête), adresse `/v2/account/notifications`.
- **Adresses** : `/v2/messages`, `/v2/messages/new`, `/v2/messages/notifications`, `/v2/messages/moderation`, `/v2/messages/settings`, `/v2/announcements`, `/v2/announcements/new`, `/v2/notifications`, `/v2/notifications/send`, `/v2/notifications/templates`, `/v2/notifications/rules`, `/v2/notifications/channels`, `/v2/account/notifications`.
- **Données de démonstration** (créées par la graine, par le directeur) : deux annonces dans chaque établissement.
  - « Rentrée : réunion d'information des parents (démonstration) » : **publiée**, **épinglée**, **avec accusé de réception demandé**, destinée à tout l'établissement (parents et tuteurs, élèves, personnel).
  - « Brouillon : calendrier des compositions (démonstration) » : **brouillon**, destiné aux parents et tuteurs.
  - Aucune conversation n'est créée par la graine. Le journal des notifications peut contenir des envois issus des événements de la démonstration (candidatures reçues, offres, factures...) : leur contenu exact n'est pas garanti.
- **Aucun envoi réel** : e-mail et WhatsApp ne sont pas configurés ; le canal SMS est en mode d'essai sans appel réseau ; les notifications sont enregistrées avec le statut « Simulé ». Les notifications « dans l'application » (cloche) sont, elles, réellement délivrées.
- **Ordre conseillé** : C15.1 d'abord (accusé de réception, non annulable), puis C15.2 et suivants. Faites C15.7 (modération) et C15.12 (avis urgent) en dernier.

### 15.3 Scénarios

#### C15.1 Lire une annonce épinglée et accuser réception
**Compte :** parent · **Où :** menu du portail « Annonces » (`/v2/announcements`)
**Attention :** un accusé de réception ne peut pas être retiré. Faites-le sur un seul compte parent.
1. Connectez-vous avec `parent@demo-secondaire.test` et ouvrez « Annonces ».
2. Repérez « Rentrée : réunion d'information des parents (démonstration) » en tête de liste, avec les badges « Épinglée » et « Accusé à donner ».
3. Ouvrez l'annonce. Lisez le bloc « Accusé de réception demandé ».
4. Cliquez sur « J'ai pris connaissance ».
5. Rechargez la page.
**Résultat attendu :** après le clic, le message « Merci : votre accusé de réception est enregistré. » s'affiche ; après rechargement, « Vous avez pris connaissance de cette annonce le … » remplace le bouton. L'annonce n'est plus « Accusé à donner » dans la liste.
- [ ] Annonce épinglée en tête de liste
- [ ] Bouton « J'ai pris connaissance » puis confirmation
- [ ] État conservé après rechargement
- [ ] Le brouillon « Brouillon : calendrier des compositions (démonstration) » n'est **pas** visible du parent

#### C15.2 Suivre les accusés de réception côté direction
**Compte :** directeur · **Où :** `/v2/announcements`
1. Connectez-vous avec `directeur@demo-secondaire.test` (code MFA).
2. Choisissez la portée « Publiées par moi ». Repérez la ligne de statistiques « n destinataire(s), n lu(s), n accusé(s) ».
3. Ouvrez l'annonce de la rentrée. Dans « Gestion de l'annonce », lisez « Destinataires », « Lus », « Accusés ».
4. Dans « Accusés de lecture », filtrez : « Accusé en attente », « Accusés », « Non lus ».
**Résultat attendu :** si C15.1 a été fait, « Accusés » vaut au moins 1 et la personne figure dans le filtre « Accusés » (avec la date « Accusé le ») ; les autres destinataires sont « Accusé en attente » ou « Non lus ». Le statut de l'annonce est « Publiée ».
- [ ] Compteurs cohérents avec C15.1
- [ ] Filtres de réception fonctionnels
- [ ] Statut « Publiée » et épinglage visibles

#### C15.3 Publier un brouillon d'annonce
**Compte :** directeur · **Où :** annonce « Brouillon : calendrier des compositions (démonstration) »
**Attention :** à la publication, les destinataires sont figés et sont prévenus ; l'annonce peut ensuite être retirée mais pas « dépubliée en silence ».
1. Dans « Publiées par moi », ouvrez le brouillon (statut « Brouillon »).
2. Cliquez sur « Modifier » ; vérifiez que le bouton de ciblage permet de « Compter les destinataires » (affiche « n destinataire(s) »). Sans rien changer, quittez.
3. Cliquez sur « Publier maintenant ».
**Résultat attendu :** le message « L'annonce est publiée. » s'affiche et le statut devient « Publiée ». Le parent la voit désormais dans « Annonces » ; le brouillon n'avait aucun accusé de réception demandé.
- [ ] Statut « Publiée » après publication
- [ ] L'annonce apparaît côté parent
- [ ] Nombre de destinataires affiché avant publication

#### C15.4 Créer une annonce épinglée avec accusé, pour une classe
**Compte :** secrétariat · **Où :** `/v2/announcements/new`
1. Connectez-vous avec `secretariat@demo-secondaire.test` (code MFA).
2. Ouvrez « Annonces » > « Nouvelle annonce ».
3. Titre : `Test : réunion de classe 6e A`. Contenu : un court texte.
4. Destinataires : type de cible « Classe », choisissez `6E-A`, « Ajouter la cible ». Personnes visées : « Parents et tuteurs ».
5. Cliquez sur « Compter les destinataires ». Cochez « Demander un accusé de réception » et « Épingler en tête de liste ». Priorité : « Élevée ».
6. Cliquez sur « Enregistrer le brouillon », puis ouvrez le brouillon et « Publier maintenant ».
7. Connectez-vous en parent (Séka DIABATE : enfants de la classe 6e A).
**Résultat attendu :** le nombre de destinataires est affiché avant publication ; l'annonce publiée apparaît chez le parent avec « Épinglée » et « Accusé à donner ». L'élève et l'enseignant ne la reçoivent pas (audience « Parents et tuteurs » seulement).
- [ ] Brouillon puis publication
- [ ] Annonce visible du parent, épinglée, accusé demandé
- [ ] Annonce absente du compte élève

#### C15.5 Retirer une annonce avec motif
**Compte :** secrétariat · **Où :** annonce `Test : réunion de classe 6e A`
1. Dans « Gestion de l'annonce », cliquez sur « Retirer l'annonce ». Saisissez un « Motif du retrait ».
2. Confirmez, puis consultez la liste côté parent.
**Résultat attendu :** « L'annonce est retirée. » ; statut « Retirée » ; l'annonce disparaît de la boîte du parent. Le retrait est tracé avec son motif.
- [ ] Statut « Retirée »
- [ ] Annonce disparue côté parent

#### C15.6 Conversation entre un parent et un enseignant
**Compte :** parent puis enseignant · **Où :** `/v2/messages`
1. Parent : ouvrez « Messages » > « Nouveau message ». Type : « Message direct ». Dans « Rechercher une personne », saisissez `Kouadio` et choisissez l'enseignant. « À propos de l'enfant » : `Nadia DIABATE`. Objet : `Question sur le devoir`. Message : un court texte. « Envoyer ».
2. Vérifiez l'apparition de la conversation dans « Envoyés ».
3. Enseignant : ouvrez « Messages ». Repérez la conversation non lue dans « Boîte de réception ». Ouvrez-la, répondez (« Votre réponse », « Envoyer »).
4. Parent : ouvrez de nouveau « Messages » et lisez la réponse.
5. Parent : dans la conversation, essayez « Favori », « Sourdine », puis « Archiver » ; retrouvez-la dans « Favoris » puis « Archivés ». Utilisez la recherche « Objet et personnes ».
**Résultat attendu :** le message arrive chez l'enseignant avec la mention non lu et passe à lu à l'ouverture ; la réponse revient chez le parent ; les dossiers « Favoris » et « Archivés » reflètent les actions. Le parent ne se voit proposer que des personnes liées à ses enfants ou à l'administration.
- [ ] Message reçu, indicateur « non lu » puis lu
- [ ] Réponse reçue par le parent
- [ ] Favori, sourdine et archivage fonctionnent
- [ ] La liste de destinataires du parent est restreinte (pas tout l'établissement)

#### C15.7 Diffusion à une classe et réponse privée
**Compte :** directeur · **Où :** `/v2/messages/new`
1. Directeur : « Nouveau message », type « Diffusion ». Lisez : « Le même message envoyé en privé à chaque destinataire : ils ne se voient pas. »
2. Dans « Classes », choisissez `6E-A`, « Personnes visées dans la classe » : « Parents et tuteurs ». Objet `Test diffusion`, message court. « Envoyer ».
3. Parent : ouvrez « Messages » : repérez la diffusion, répondez.
4. Directeur : relisez sa « Boîte de réception ».
**Résultat attendu :** chaque parent reçoit un fil privé ; la réponse du parent revient chez le directeur sans être visible des autres parents.
- [ ] Diffusion reçue par le parent
- [ ] Réponse revenue chez le directeur
- [ ] Le parent ne voit pas les autres destinataires

#### C15.8 Cloche et notifications dans l'application
**Compte :** parent · **Où :** cloche de l'en-tête, `/v2/messages/notifications`
1. Après C15.6 et C15.7, le parent ouvre la cloche « Notifications » : repérez le nombre « notification(s) non lue(s) ».
2. Cliquez sur « Tout voir », puis lisez la page « Notifications » (catégories « Messages », « Annonces », « Alertes automatiques »).
3. Marquez une notification avec « Marquer comme lue », puis « Tout marquer comme lu ».
4. Dans « Préférences de notification » (même page), modifiez « Autres canaux autorisés » puis « Enregistrer mes préférences ».
**Résultat attendu :** le compteur diminue au fil des actions ; « Aucune notification non lue. » en fin de parcours ; « Vos préférences sont enregistrées. » après enregistrement.
- [ ] Compteur de la cloche cohérent
- [ ] « Tout marquer comme lu » vide le compteur
- [ ] Préférences enregistrées

#### C15.9 Envoyer une convocation et lire le journal (statut « Simulé »)
**Compte :** secrétariat · **Où :** `/v2/notifications/send` puis `/v2/notifications`
1. Ouvrez « Notifications » > « Envoyer ». « Type de message » : « Convocation ». « Choisir par » : « Élèves (leurs parents et tuteurs) » ; ajoutez `Nadia DIABATE`.
2. Cochez les canaux disponibles (ceux marqués « indisponible » ne se cochent pas ; dans la démonstration, l'application et le SMS d'essai sont en principe disponibles ; à confirmer à l'écran). Renseignez Objet, Date, Heure, Lieu.
3. Cliquez sur « Vérifier avant l'envoi » puis « Envoyer maintenant ».
4. Lisez « Message mis en file : n destinataire(s)… ».
5. Ouvrez « Journal des notifications » (« Journal des envois »). Patientez jusqu'à 1 à 2 minutes et rechargez.
6. Pour la ligne créée, lisez : Canal, Statut, « Gabarit : convocation », « Origine : Envoi manuel », destinataire masqué.
7. Ouvrez « Canaux d'envoi » (`/v2/notifications/channels`) et lisez le bandeau « Mode simulation actif : aucun message n'est réellement envoyé… ».
**Résultat attendu :** les envois externes ont le statut « Simulé » (jamais « Envoyé » par un fournisseur réel) ; l'envoi dans l'application est remis réellement (le parent voit la notification à la cloche). Les adresses et numéros sont masqués dans le journal. Une personne sans coordonnée apparaît « Non envoyé : aucune coordonnée ».
- [ ] Message mis en file
- [ ] Statut « Simulé » pour les canaux externes
- [ ] Destinataire masqué, gabarit et origine renseignés
- [ ] Bandeau de simulation sur « Canaux d'envoi »
- [ ] Aucun e-mail, SMS ou WhatsApp réel reçu

#### C15.10 Préférences de notification et heures calmes d'un parent
**Compte :** parent puis secrétariat · **Où :** « Mon compte » > « Mes notifications » (`/v2/account/notifications`)
1. Parent : lisez « Canaux et catégories ». Pour le canal SMS, passez la case « Recevoir des messages par SMS » sur « Désactivé » (chaque case est enregistrée immédiatement : « Préférence enregistrée. »).
2. Dans « Heures calmes », décochez « Utiliser les heures calmes de l'établissement », cochez « Activer mes heures calmes », saisissez `21:00` et `06:00`, puis « Enregistrer les heures calmes ».
3. Lisez la phrase « Heures calmes de l'établissement : de … à … » et la mention sur les messages urgents.
4. Secrétariat : renvoyez la convocation de C15.9 pour `Nadia DIABATE` par SMS, puis ouvrez le journal.
**Résultat attendu :** « Heures calmes enregistrées. » ; la ligne du parent pour le SMS n'est pas « Simulé » : elle porte « Non envoyé : » suivie d'un motif tel que « catégorie refusée par la personne », « consentement retiré » ou « aucune coordonnée » (le motif exact dépend des coordonnées de la graine). Les messages différés par les heures calmes ne concernent que SMS, WhatsApp et notification sur le téléphone.
- [ ] Préférence enregistrée à chaque case modifiée
- [ ] Heures calmes enregistrées
- [ ] Le journal n'affiche pas d'envoi simulé par SMS pour ce parent, mais une raison de non-envoi
- [ ] La section « Appareils pour les notifications push » indique que le push n'est pas activé

#### C15.11 Signaler un message et traiter le signalement
**Compte :** enseignant puis directeur · **Où :** conversation de C15.6, puis `/v2/messages/moderation`
1. Enseignant : ouvrez la conversation de C15.6 ; sur le message du parent, cliquez sur « Signaler ». Motif : « Autre motif », précisions : `Test de signalement`. « Signaler ».
2. Lisez « Merci : votre signalement a été transmis à la modération. »
3. Directeur : ouvrez « Modération des messages ». Onglet « Signalements » : repérez la ligne « À traiter ». Cliquez sur « Examiner ».
4. Lisez « Le message signalé et ses voisins sont affichés avec leur contenu réel. Cette lecture est tracée. » Saisissez un « Motif de la décision » et cliquez sur « Rejeter le signalement » puis « Confirmer la décision ». (Si « Confirmez votre identité » s'affiche, saisissez le code MFA.)
5. Ouvrez l'onglet « Supervision » : cherchez la conversation, « Lire avec un motif », saisissez le motif, « Lire la conversation ».
**Résultat attendu :** la ligne passe de « À traiter » à « Rejeté » avec « Décision enregistrée. » ; la supervision n'ouvre le fil qu'après un motif, en lecture seule. L'auteur du message n'est pas informé du signalement.
- [ ] Signalement transmis, ligne « À traiter » côté direction
- [ ] Décision impossible sans motif ; avec motif, statut « Rejeté »
- [ ] Supervision exigeant un motif avant lecture

#### C15.12 Avis urgent (action sensible, à faire en dernier)
**Compte :** propriétaire · **Où :** `/v2/notifications/send`
**Attention :** un avis urgent ignore les heures calmes et les préférences de catégorie des destinataires. Dans la démonstration il reste simulé, mais l'alerte dans l'application est réelle pour les destinataires.
1. Propriétaire : « Envoyer ». « Type de message » : « Avis urgent ». Audience : « Classes » > `6E-A`, parents et tuteurs. Objet et message : `Test avis urgent`.
2. Cochez « Message urgent : ignore les heures calmes… ». Cliquez sur « Vérifier avant l'envoi ». Lisez « Envoi urgent » en rouge, puis « Envoyer maintenant ». (Code MFA si demandé.)
3. Ouvrez le journal et repérez le badge « Urgent ».
4. Parent : vérifiez la cloche.
**Résultat attendu :** les lignes portent le badge « Urgent » ; le parent reçoit l'alerte dans l'application même avec ses heures calmes actives.
- [ ] Case « urgent » proposée au propriétaire
- [ ] Confirmation d'envoi urgent en rouge
- [ ] Badge « Urgent » dans le journal
- [ ] Alerte reçue par le parent

#### C15.13 Consulter les gabarits, les règles et les canaux (lecture)
**Compte :** propriétaire · **Où :** `/v2/notifications/templates`, `/rules`, `/channels`
1. « Gabarits de notification » : ouvrez « Convocation », lisez l'éditeur par canal, cliquez sur « Aperçu » (valeurs d'exemple), sans publier.
2. « Règles et alertes » : repérez les familles « Événements », « Alertes », « Relances d'impayés » ; repérez une règle « Livrée » (par exemple celle des alertes de direction).
3. « Canaux d'envoi » : lisez l'état de chaque canal (« Opérationnel », « Non configuré »...).
**Résultat attendu :** aucun changement enregistré ; chaque canal non configuré est signalé ; le texte « Mode simulation actif » est présent.
- [ ] Aperçu du gabarit fonctionnel
- [ ] Trois familles de règles listées
- [ ] États des canaux lisibles

#### C15.14 Invitation et boîte aux lettres locale
**Compte :** propriétaire · **Où :** `/v2/guardians`
1. « Nouveau tuteur » : créez un tuteur fictif avec une adresse e-mail de test (par exemple `invite.test@demo-secondaire.test`).
2. Ouvrez la fiche et cliquez sur « Inviter au portail ». Lisez « L'invitation a été envoyée. »
3. Ouvrez le fichier de boîte aux lettres locale (`.demo/mailbox.jsonl`, voir l'introduction) : repérez la ligne avec cette adresse et son champ `link`.
**Résultat attendu :** aucun e-mail n'est réellement émis ; l'invitation est écrite dans la boîte aux lettres locale, avec son lien d'activation.
- [ ] Message « L'invitation a été envoyée. »
- [ ] Ligne d'invitation dans `.demo/mailbox.jsonl`
- [ ] Aucun e-mail reçu dans une vraie boîte

### 15.4 Cas limites et tests négatifs

#### C15.N1 Un parent n'écrit pas à n'importe qui
**Compte :** parent
1. « Nouveau message » : dans « Rechercher une personne », cherchez un nom d'un parent d'un autre élève (par exemple `Elie BAMBA`) puis un membre du personnel sans lien avec Nadia et Salimata (par exemple le compte éducateur ou économe).
2. Lisez le texte « Vous ne pouvez écrire qu'aux personnes proposées : celles qui sont liées à vos enfants, à vos classes ou à l'administration. »
**Résultat attendu :** « Aucune personne autorisée ne correspond à cette recherche. » pour les autres parents ; seuls les enseignants de ses enfants et l'administration sont proposés.
- [ ] Autres parents introuvables dans la recherche
- [ ] Seuls le personnel lié et l'administration sont proposés

#### C15.N2 Publication d'annonce : droits et ciblage
**Compte :** parent, élève, enseignant
1. Parent et élève : tapez `/v2/announcements/new`.
2. Enseignant : ouvrez « Nouvelle annonce » et regardez les cibles proposées.
**Résultat attendu :** parent et élève reçoivent un message d'accès refusé. L'enseignant peut publier vers **ses propres classes** seulement ; il ne peut pas cibler tout l'établissement (cible non proposée ou refus à l'enregistrement).
- [ ] Parent et élève : accès refusé à « Nouvelle annonce »
- [ ] Enseignant limité à ses classes

#### C15.N3 Rôle sans accès à la modération, au journal et aux paramètres
**Compte :** enseignant, parent, secrétariat
1. Enseignant et parent : tapez `/v2/messages/moderation`, `/v2/messages/settings`, `/v2/notifications`, `/v2/notifications/send`.
2. Secrétariat : tapez `/v2/messages/moderation` et `/v2/notifications/channels`.
3. Secrétariat : ouvrez `/v2/notifications/send` et cherchez la case « urgent ».
**Résultat attendu :** message d'accès refusé pour l'enseignant et le parent sur ces adresses. Le secrétariat n'a pas la modération et ne voit pas la case d'avis urgent (réservée à la direction). Il peut lire le journal et envoyer une convocation ou une annonce.
- [ ] Accès refusé pour les adresses de gestion (enseignant, parent)
- [ ] Pas de modération pour le secrétariat
- [ ] Pas de case « urgent » pour le secrétariat

#### C15.N4 Saisies invalides
**Compte :** secrétariat, propriétaire
1. Secrétariat, « Envoyer » : cliquez sur « Vérifier avant l'envoi » sans canal, puis sans élève.
2. Modération (directeur) : « Confirmer la décision » sans motif.
3. Propriétaire, « Paramètres de la messagerie » : « Taille maximale (Mo) » = `100` ; puis « Participants d'un message de groupe » supérieur à « Destinataires d'une diffusion ou d'une annonce ».
**Résultat attendu :** « Choisissez au moins un canal. », « Choisissez au moins un élève. », « Le motif de la décision est obligatoire (3 caractères au moins). », « La taille maximale doit être comprise entre 0,001 et 25 Mo. », « Le plafond d'un groupe ne peut pas dépasser celui d'une diffusion. » ; rien n'est enregistré.
- [ ] Messages d'erreur attendus affichés
- [ ] Aucun envoi ni réglage enregistré

#### C15.N5 Lien de désinscription invalide
**Compte :** aucun (page publique) · **Où :** `/v2/notifications/unsubscribe`
1. Ouvrez `http://demo-secondaire.localhost:3100/v2/notifications/unsubscribe` sans paramètre.
**Résultat attendu :** « Ce lien n'est pas valide. Utilisez le lien reçu dans le message. » ; aucune désinscription n'est possible sans lien signé.
- [ ] Message de lien invalide

#### C15.N6 Double accusé et isolation entre établissements
**Compte :** parent
1. Parent : dans l'annonce déjà accusée (C15.1), cherchez à accuser de nouveau.
2. Ouvrez la même annonce sur `http://demo-primaire.localhost:3100/v2/login` avec le compte `parent@demo-primaire.test` : l'annonce de `demo-primaire` est une autre annonce, avec son propre état d'accusé.
**Résultat attendu :** le bouton n'est plus proposé après accusé (seule la date s'affiche). Les accusés d'un établissement n'apparaissent jamais dans l'autre.
- [ ] Pas de second accusé possible
- [ ] Annonces et accusés propres à chaque établissement

### 15.5 Problèmes connus et limites
- **Tout envoi externe est simulé** (statut « Simulé ») : e-mail et WhatsApp non configurés, SMS en mode d'essai, notifications sur le téléphone (push) non activées. Seules les notifications dans l'application sont réellement remises.
- Les invitations et les liens de réinitialisation de mot de passe ne sont pas envoyés par e-mail : ils sont écrits dans `.demo/mailbox.jsonl`.
- Le journal des notifications est rempli par des tâches de fond : une ligne peut rester « En attente » une minute ou deux. Les alertes et relances sont évaluées par des tâches planifiées (quotidiennes) : elles n'apparaissent pas tout de suite.
- Défaut M7 du rapport QA (à reconfirmer) : sur « Nouvelle annonce », certains rôles (dont l'enseignant) peuvent voir une erreur d'accès refusé lors du chargement de la liste des établissements ; le reste du formulaire reste utilisable.
- Les messages de vie scolaire et d'admission ne déclenchent pas de notification automatique par défaut : les règles correspondantes sont désactivées (visibles dans « Règles et alertes »).
- La conservation des messages et des notifications est réglée par l'établissement ; aucune purge n'est visible pendant les tests.
- Les fichiers joints à un message sont limités aux formats PDF, JPEG, PNG et WebP.
- Libellés « (à confirmer) » : la disponibilité des canaux SMS et application dans le formulaire d'envoi et le motif exact de non-envoi (C15.10) dépendent de la configuration de la démonstration.

### 15.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 016 §13 : le menu du portail administrateur n'affiche pas toujours « Messages » et « Annonces » à l'économe ou au chargé d'admissions (rapport QA, section « Menus de navigation par rôle ») alors que l'API les autorise ; l'adresse directe fonctionne.
- Les règles livrées de vie scolaire et d'admission sont désactivées par défaut (choix documenté dans le README `notifications`), donc aucun scénario de notification de famille n'en découle.
- Aucune donnée de conversation dans la graine : tous les scénarios de messagerie partent de zéro.

---

## Chapitre 16. Tableaux de bord de direction et alertes
> **Durée estimée :** 90 à 120 minutes (plus 15 à 30 minutes d'attente pour les alertes) · **Établissement(s) :** `demo-secondaire` (parcours complet) ; `demo-primaire` et `demo-superieur` pour comparer · **Comptes :** direction générale (propriétaire), directeur, directeur des études, économe, enseignant

### 16.1 Objectif
Vérifier les tableaux de bord de la direction : effectifs, présence, résultats, scolarité, trésorerie, admissions, vie scolaire et masse salariale ; la fraîcheur des données ; les règles d'alerte (consultation, création, accusé de réception) ; les exports. Vérifier ce que chaque rôle voit ou ne voit pas, notamment que la **direction des études ne voit aucune donnée financière**.

### 16.2 Avant de commencer
- **Comptes** (`http://demo-secondaire.localhost:3100/v2/login` ; mots de passe dans `.demo/credentials.md` ; code MFA : `pnpm demo:totp <e-mail>`) :

| Rôle | E-mail | MFA | Voit | Ne voit pas |
|---|---|---|---|---|
| Propriétaire | `direction.generale@demo-secondaire.test` | oui | Tout le pilotage, y compris masse salariale, exports, réglages, reconstruction | Rien du pilotage n'est masqué |
| Directeur | `directeur@demo-secondaire.test` | oui | Idem propriétaire (masse salariale en MFA) | Rien du pilotage n'est masqué |
| Directeur des études | `etudes@demo-secondaire.test` | oui | « Pédagogie », « Admissions », « Vie scolaire (agrégée) », « Alertes de direction » et leurs règles (en lecture) | Tableau de bord, effectifs, comparaisons, scolarité, trésorerie, paie, charges, exports, création de règles |
| Économe | `econome@demo-secondaire.test` | oui | « Scolarité », « Trésorerie », alertes financières | Tableau de bord, pédagogie, paie, exports |
| Enseignant | `enseignant@demo-secondaire.test` | non | Rien du pilotage | Tout |

- **Chemin de menu** : sélecteur « Modules » > « Pilotage ». Entrées : « Tableau de bord de la direction » (`/v2/direction`), « Indicateurs de direction » (`/v2/analytics`), « Effectifs et présences » (`/v2/direction/effectifs`), « Admissions » (`/v2/analytics/admissions`), « Vie scolaire (agrégée) » (`/v2/analytics/vie-scolaire`), « Pédagogie » (`/v2/owner/pedagogie`), « Scolarité » (`/v2/owner/scolarite`), « Trésorerie » (`/v2/owner/tresorerie`), « Masse salariale » (`/v2/owner/paie`), « Comparaisons » (`/v2/analytics/comparaisons`), « Alertes de direction » (`/v2/analytics/alertes`), « Règles d'alerte » (`/v2/analytics/alertes/regles`), « Charges et résultat » (`/v2/owner/charges`). La page technique « Fraîcheur des données » est à `/v2/owner/fraicheur` (l'adresse `/v2/owner` renvoie vers le tableau de bord).
- **Données de démonstration** (secondaire) : 12 élèves de la classe 6e A (6E-A) et les élèves inscrits par la campagne `RENTREE-6E` ; période 1 clôturée, avec le jeu de règles de DÉMONSTRATION (bandeau « Règles de démonstration » : les moyennes, taux de validation et décisions ne sont pas officiels) ; 13 dossiers d'admission à tous les statuts ; incidents et mesures de vie scolaire (dont une exclusion proposée en attente de validation) ; factures et règlements variés ; pas de paie préparée (la page paie peut être vide). Les tableaux sont reconstruits à la fin de la graine ; les chiffres exacts ne sont pas figés : recoupez-les avec les modules sources plutôt que de les comparer à un nombre.
- **Règles d'alerte de la graine** (3, chacune évaluée toutes les 15 minutes par une tâche de fond) :

| Nom | Indicateur | Attention | Critique | Destinataires | Rappels |
|---|---|---|---|---|---|
| « Créances en retard élevées » | Montant des impayés échus | au-dessus de 100 000 | au-dessus de 500 000 | Directeur, Économe | au plus un par jour |
| « Taux de recouvrement bas » | Taux de recouvrement de la scolarité | sous 60 % | sous 30 % | Directeur, Économe | au plus un par jour |
| « Taux de présence bas » | Taux de présence des élèves (30 jours) | sous 90 % | sous 80 % | Directeur, Directeur des études | au plus un par jour |

  Les **premières alertes n'apparaissent qu'après un passage** de la tâche d'évaluation (jusqu'à 15 minutes après le démarrage). Si aucun seuil n'est franchi par les données, il n'y a simplement aucune alerte : la règle affiche alors « Dans les seuils » ou « Pas encore évaluée ». Le propriétaire n'est pas destinataire des règles de la graine (les rôles « Directeur », « Économe » et « Directeur des études » le sont).
- **Ordre conseillé** : C16.1 à C16.8, puis C16.9 (qui demande une attente), C16.10 à C16.12 pendant l'attente.

### 16.3 Scénarios

#### C16.1 Tableau de bord de la direction
**Compte :** propriétaire, puis directeur · **Où :** `/v2/direction`
1. Connectez-vous avec `direction.generale@demo-secondaire.test` (code MFA). Vous arrivez sur le tableau de bord (ou ouvrez « Tableau de bord de la direction »).
2. Lisez la barre de fraîcheur (« Données au … ») et, s'il s'affiche, le bandeau « Règles de démonstration ».
3. Lisez les cartes : « Élèves en scolarité », « Présence aujourd'hui », « Moyenne générale », « Taux de validation », « Enseignants et personnel présents ». Relevez leur valeur et leur détail.
4. Descendez à « Scolarité et créances » : « Scolarité recouvrée », « Encaissé », « Créances (restant dû) ».
5. Changez les filtres « Établissement », « Campus », « Année scolaire » (laissez « Année en cours »).
6. Descendez à « Aller plus loin » et ouvrez un lien.
7. Recoupez l'effectif avec la liste des élèves du module « Personnes » et le recouvrement avec les factures du module « Finance ».
8. Reprenez avec `directeur@demo-secondaire.test` : mêmes chiffres.
**Résultat attendu :** les cartes sont renseignées ; une valeur non calculable affiche « Non mesuré » (jamais un zéro inventé) ; l'effectif et le recouvrement sont cohérents avec les modules sources (un écart doit s'expliquer par le statut des inscriptions ou des factures) ; les liens mènent aux écrans détaillés. Le directeur voit les mêmes données que le propriétaire.
- [ ] Cartes d'effectifs, présence, moyenne, validation et personnel renseignées
- [ ] Bloc « Scolarité et créances » présent pour le propriétaire et le directeur
- [ ] Barre de fraîcheur « Données au … » et bandeau de règles de démonstration
- [ ] Chiffres cohérents avec les modules « Personnes » et « Finance »

#### C16.2 Effectifs, présence et export
**Compte :** propriétaire · **Où :** `/v2/direction/effectifs`
1. Ouvrez « Effectifs et présences ». Lisez les répartitions « Par sexe », « Par niveau », « Par type de financement », « Par statut d'inscription », « Par campus », puis le tableau « Effectifs par classe » (colonnes En scolarité, Filles, Garçons).
2. Dans « Présences et assiduité », changez la « Fenêtre d'observation » (« Du », « Au ») puis lisez le « Taux de présence » et le tableau « Présence par classe ».
3. Cliquez sur « Exporter (CSV) » dans « Répartition des inscriptions » : un fichier `analytics-enrollment-by-classroom.csv` est téléchargé. Ouvrez-le dans un tableur.
4. Relancez l'export de la présence (fichier `analytics-attendance-by-classroom.csv`).
**Résultat attendu :** la somme des effectifs par classe est cohérente avec « Élèves en scolarité ». Les fichiers CSV sont séparés par des points-virgules, les accents sont lisibles, et ils ne contiennent ni nom d'élève ni donnée nominative. Chaque export est enregistré dans le journal d'audit.
- [ ] Répartitions et tableau par classe affichés
- [ ] Taux de présence recalculé après changement de fenêtre
- [ ] Deux fichiers CSV téléchargés, accents lisibles, aucun nom d'élève
- [ ] Exports retrouvés dans le journal d'audit

#### C16.3 Hub des indicateurs de direction
**Compte :** propriétaire · **Où :** `/v2/analytics`
1. Ouvrez « Indicateurs de direction ».
2. Parcourez les blocs : « Effectifs et inscriptions », « Assiduité », « Résultats par période », « Recouvrement et impayés », « Admissions », « Vie scolaire (agrégée) », « Alertes de direction », « Charge de paie ».
3. Dans « Charge de paie », lisez « Donnée sensible : la lecture exige l'authentification forte… » puis cliquez sur « Afficher la masse salariale ».
4. Dans « Résultats par période », lisez la colonne « Règles » (« Démonstration »).
**Résultat attendu :** chaque bloc propose un lien « Voir … » vers son écran détaillé ; la masse salariale n'est lue **qu'après** le clic ; la colonne « Règles » indique « Démonstration » pour la période clôturée. Aucun nom de personne n'apparaît nulle part.
- [ ] Huit blocs visibles pour le propriétaire
- [ ] Masse salariale lue seulement après le clic
- [ ] Période clôturée marquée « Démonstration »

#### C16.4 Admissions et vie scolaire agrégées
**Compte :** propriétaire · **Où :** `/v2/analytics/admissions`, `/v2/analytics/vie-scolaire`
1. Ouvrez « Admissions ». Lisez « Répartition à ce jour… Aucun candidat n'est affiché ici. », la campagne `RENTREE-6E` et ses étapes, « Dossiers déposés », « Acceptés (dont inscrits) », « Inscrits », « Places offertes ».
2. Comparez avec la liste des candidatures du module « Admissions » (13 dossiers à tous les statuts, dont 5 inscrits, selon la graine).
3. Ouvrez « Vie scolaire (agrégée) ». Lisez les quatre comptages : « Incidents ouverts », « Mesures à valider », « Exclusions en cours », « Convocations à tenir ».
4. Comparez avec le module « Vie scolaire » : au moins une mesure (une exclusion proposée) attend la validation.
**Résultat attendu :** les comptages recoupent les modules sources ; aucun élève, aucun motif n'est nommé ; un élément restreint ou confidentiel n'est jamais compté. Sur `demo-superieur`, la campagne est `RENTREE-L1`. Sur `demo-primaire`, la vie scolaire n'est pas alimentée : les comptages sont à zéro ou « Non mesuré ».
- [ ] Entonnoir par statut et par étape affiché, sans nom de candidat
- [ ] « Mesures à valider » au moins égal à 1 (secondaire)
- [ ] Aucun nom d'élève ni motif

#### C16.5 Pédagogie, scolarité, trésorerie
**Compte :** propriétaire · **Où :** `/v2/owner/pedagogie`, `/v2/owner/scolarite`, `/v2/owner/tresorerie`, `/v2/owner/charges`
1. « Pédagogie » : lisez « Moyenne générale », « Taux de validation », le tableau « Résultats par classe » et « Résultats par matière et unité » ; lisez le bandeau « Règles de démonstration » ; exportez « Résultats par classe ».
2. « Scolarité » : lisez « Taux de recouvrement », « Facturé », « Encaissé », « Restant dû », « En retard » ; dans « Créances », regroupez par « Classe » puis « Apprenant ».
3. « Trésorerie » : « Encaissements » (période, regroupement « Par mois »), « Créances âgées », « Écarts de caisse ».
4. « Charges et résultat » : lisez le message du module absent.
**Résultat attendu :** la période 1 est la dernière période clôturée par défaut ; le taux de validation est étiqueté « règles de démonstration ». Les montants recoupent le module « Finance » (facturé, encaissé, restant dû). « Charges et résultat » affiche « Module de charges absent » et la liste de ce qui n'est pas mesuré (charges d'exploitation, compte de résultat, marges, rétention).
- [ ] Résultats clôturés par classe et par matière, bandeau de démonstration
- [ ] Montants cohérents avec le module « Finance »
- [ ] Message « Module de charges absent » plutôt que des zéros

#### C16.6 Masse salariale (MFA, lecture auditée)
**Compte :** propriétaire ou directeur · **Où :** `/v2/owner/paie`
1. Ouvrez « Masse salariale ». Si la fenêtre « Confirmez votre identité » apparaît, saisissez le code MFA (`pnpm demo:totp <e-mail>`) ; un code déjà utilisé est refusé, attendez le suivant.
2. Lisez le bandeau « Données sensibles : l'authentification forte est exigée et chaque consultation est enregistrée. » et la définition des bulletins comptés (calculés, arrêtés, payés ; annulés et contestés à part).
3. Si des périodes existent, lisez « Masse comptée », « Bulletins », « Par statut ».
4. Ouvrez le journal d'audit et cherchez la lecture de la masse salariale.
**Résultat attendu :** la page s'affiche pour le propriétaire et le directeur ; sans période de paie préparée, elle affiche « Aucune période de paie. ». La lecture est enregistrée dans le journal d'audit.
- [ ] Page lisible avec authentification forte
- [ ] « Aucune période de paie. » ou liste de périodes cohérente avec le module « Paie »
- [ ] Lecture retrouvée dans le journal d'audit

#### C16.7 Fraîcheur des données et reconstruction
**Compte :** propriétaire · **Où :** `/v2/owner/fraicheur`
1. Ouvrez « Fraîcheur des données de pilotage ». Lisez la file « En file : … · en échec : … · source indisponible : … ».
2. Lisez le tableau : Source (Inscriptions, Résultats, Présences des élèves, Facturation et créances, Encaissements, Admissions (entonnoir), Vie scolaire (comptages)...), « Dernière lecture réussie », État (« À jour », « Échec », « Source indisponible »).
3. Cliquez sur « Reconstruire depuis les sources » : lisez « La reconstruction est en file : elle sera exécutée par le worker. » Cliquez une seconde fois tout de suite.
4. Dans « Seuils de lecture et fraîcheur » : changez « Donnée « ancienne » au-delà de (heures) » (par exemple 48), « Enregistrer les réglages », puis remettez la valeur d'origine.
**Résultat attendu :** les sources sont « À jour » ; le second clic donne « Une reconstruction est déjà en file. » ; « Les réglages sont enregistrés. » Ces réglages ne changent aucun chiffre : ils changent seulement l'état affiché (« Bon », « À surveiller », « Critique ») et le délai à partir duquel une donnée est dite ancienne.
- [ ] Toutes les sources « À jour » (sinon noter lesquelles)
- [ ] Reconstruction mise en file, second clic signalé
- [ ] Réglages enregistrés puis rétablis

#### C16.8 Comparaisons
**Compte :** propriétaire · **Où :** `/v2/analytics/comparaisons`
1. Ouvrez « Comparaisons ». Indicateur : « Assiduité ».
2. Choisissez les fenêtres « Référence : du / au » et « Comparée : du / au » (deux périodes de dates différentes).
3. Lisez le tableau « Comparaison » (Référence, Comparée, Écart, Variation) et la note sur l'interprétation.
4. Répétez avec « Effectifs » (si l'établissement n'a qu'une année, comparez la même année : l'écart doit être nul) et « Recouvrement » (choisissez un campus si demandé).
**Résultat attendu :** l'écart est « comparée moins référence » ; un côté non mesuré affiche « Non mesuré », jamais zéro ; la variation n'est pas calculée quand la référence est nulle.
- [ ] Tableau de comparaison affiché une fois les deux côtés choisis
- [ ] « Non mesuré » plutôt que zéro quand il n'y a pas de données
- [ ] Écart nul pour une comparaison d'une année avec elle-même

#### C16.9 Règles d'alerte de la graine et premières alertes
**Compte :** propriétaire · **Où :** `/v2/analytics/alertes/regles` puis `/v2/analytics/alertes`
1. Ouvrez « Règles d'alerte ». Vérifiez les trois règles (voir le tableau en 16.2), les seuils « Attention : … » et « Critique : … », les destinataires, la fréquence et la colonne « Dernière évaluation ».
2. Si une règle affiche « Pas encore évaluée », attendez jusqu'à 15 minutes puis rechargez.
3. Ouvrez « Alertes de direction ». Lisez la synthèse (« Ouvertes », « Accusées de réception », « Résolues ») et la liste.
4. Filtrez par « État », « Gravité » et « Indicateur ».
**Résultat attendu :** les trois règles sont « Active ». Après un passage de la tâche (15 minutes), « Dernière évaluation » est renseignée (le résultat « Dans les seuils », « Attention », « Critique » ou « Non mesuré » dépend des données). Une alerte n'apparaît que si un seuil est franchi : une liste vide « Aucune alerte pour ces filtres. » est un résultat correct si tous les indicateurs sont dans les seuils. Un indicateur dont les données sont périmées ou jamais lues est signalé « Source indisponible ou périmée », jamais évalué.
- [ ] Trois règles listées avec les bons seuils et destinataires
- [ ] « Dernière évaluation » renseignée après un passage de 15 minutes
- [ ] Synthèse et filtres de la page d'alertes fonctionnels

#### C16.10 Créer une règle d'alerte, voir l'alerte et accuser réception
**Compte :** propriétaire · **Où :** `/v2/analytics/alertes/regles`
1. Cliquez sur « Nouvelle règle ». Nom : `Test effectif minimal`. Indicateur : « Effectif en scolarité ». Seuil d'attention : `1000` (nombre entier : l'effectif réel est bien inférieur). Fréquence : « Au plus un rappel par jour ». Rôles prévenus : « Directeur ».
2. Cliquez sur « Enregistrer la règle » : « Règle enregistrée. »
3. Attendez jusqu'à 15 minutes (passage de la tâche), puis ouvrez « Alertes de direction ».
4. Repérez l'alerte « Effectif en scolarité », gravité « Attention », état « Ouverte », « sous le seuil de 1000 ». Cliquez sur « Détails » : valeur constatée, seuil franchi, « Notifications émises pour cette alerte » (motif « Ouverture »).
5. Cliquez sur « Accuser réception », saisissez une note sans donnée d'élève, puis « Confirmer l'accusé de réception ».
6. Retournez à « Règles d'alerte », « Modifier » la règle de test, décochez « Règle active », enregistrez. Rechargez « Alertes de direction ».
7. Directeur (`directeur@demo-secondaire.test`, MFA) : ouvrez la cloche : une notification de l'alerte est arrivée (rôle « Directeur »).
**Résultat attendu :** l'alerte s'ouvre au passage suivant ; l'accusé de réception affiche « Accusé de réception enregistré. » et l'état « Accusée de réception » (il arrête les rappels tant que la gravité reste la même) ; une règle désactivée **résout** son alerte en cours (état « Résolue », avec la valeur au retour à la normale, ce qui peut demander un passage de plus). Le directeur reçoit la notification dans l'application ; le propriétaire, non destinataire, n'en reçoit pas. Le journal des notifications (`/v2/notifications`, catégorie « Alertes ») contient l'envoi.
- [ ] Règle créée avec les rôles choisis
- [ ] Alerte « Ouverte » visible après un passage, avec valeur et seuil
- [ ] Accusé de réception enregistré, avec note
- [ ] Alerte « Résolue » après désactivation de la règle
- [ ] Notification reçue par le directeur dans l'application

#### C16.11 Direction des études : ce qu'elle voit et ne voit pas
**Compte :** directeur des études · **Où :** menu « Pilotage », adresses citées
1. Connectez-vous avec `etudes@demo-secondaire.test` (code MFA). Ouvrez le sélecteur « Modules » > « Pilotage ».
2. Ouvrez « Pédagogie » (`/v2/owner/pedagogie`) : résultats, charge d'enseignement. Vérifiez qu'aucun bouton « Exporter (CSV) » n'est proposé.
3. Ouvrez « Admissions » (`/v2/analytics/admissions`) et « Vie scolaire (agrégée) » (`/v2/analytics/vie-scolaire`) : comptages seulement.
4. Ouvrez « Alertes de direction » : seule l'alerte de présence peut être listée (les indicateurs financiers ne sont pas dans ses droits). Si l'alerte « Taux de présence bas » existe, accusez réception (note facultative).
5. Ouvrez « Règles d'alerte » : consultez sans pouvoir créer ni modifier (pas de bouton « Nouvelle règle » ni « Modifier »).
6. Tapez `/v2/direction`, `/v2/analytics`, `/v2/owner/scolarite`, `/v2/owner/tresorerie`, `/v2/owner/paie`, `/v2/owner/charges`.
**Résultat attendu :** aucune donnée financière n'est visible (scolarité, trésorerie, masse salariale, créances) ; les adresses de l'étape 6 répondent par un message d'accès refusé. La direction des études lit la pédagogie, la présence (via les alertes), les comptages d'admission et de vie scolaire, et peut accuser réception d'une alerte de son domaine. Elle ne configure ni seuils ni destinataires.
- [ ] Pédagogie, admissions et vie scolaire accessibles
- [ ] Aucun accès aux pages financières, à la paie et au tableau de bord
- [ ] Pas de bouton d'export, pas de création de règle
- [ ] Accusé de réception possible sur une alerte de présence

### 16.4 Cas limites et tests négatifs

#### C16.N1 Économe : finances oui, reste non
**Compte :** économe
1. Connectez-vous avec `econome@demo-secondaire.test` (code MFA).
2. Ouvrez `/v2/owner/scolarite` et `/v2/owner/tresorerie`.
3. Tapez `/v2/direction`, `/v2/owner/pedagogie`, `/v2/owner/paie`, `/v2/analytics/comparaisons`.
4. Ouvrez `/v2/analytics/alertes` : examinez les alertes financières ; accusez réception d'une alerte « Créances en retard élevées » ou « Taux de recouvrement bas » si elle existe.
**Résultat attendu :** « Scolarité » et « Trésorerie » s'affichent (sans bouton d'export) ; les quatre autres adresses répondent par un message d'accès refusé ; l'économe ne voit pas l'alerte de présence.
- [ ] Pages financières lisibles
- [ ] Quatre pages refusées
- [ ] Alertes limitées aux indicateurs financiers

#### C16.N2 Enseignant et parent : aucun pilotage
**Compte :** enseignant, parent
1. Enseignant puis parent : tapez `/v2/direction`, `/v2/analytics`, `/v2/analytics/alertes`, `/v2/owner/fraicheur`.
**Résultat attendu :** message d'accès refusé sur chacune des adresses ; le sélecteur « Modules » ne propose normalement pas « Pilotage » (à confirmer).
- [ ] Quatre adresses refusées pour l'enseignant
- [ ] Idem pour le parent

#### C16.N3 Saisies invalides d'une règle d'alerte
**Compte :** propriétaire · **Où :** « Nouvelle règle »
1. Nom de 2 caractères seulement.
2. Indicateur « Taux de présence des élèves », seuil d'attention `120`.
3. Même indicateur : attention `85`, critique `90` (critique moins grave que l'attention).
4. Aucun seuil renseigné.
5. Fenêtre `0` jours (pour un indicateur à fenêtre).
**Résultat attendu :** « Le nom doit comporter de 3 à 120 caractères. », « Un taux est compris entre 0 et 100 %. », « Le seuil critique doit être inférieur ou égal au seuil d'attention. », « Renseignez au moins un seuil (attention ou critique). », « La fenêtre est un nombre de jours entre 1 et 365. » ; aucune règle n'est créée.
- [ ] Cinq erreurs de saisie distinctes
- [ ] Aucune règle créée

#### C16.N4 Réglages de lecture invalides
**Compte :** propriétaire · **Où :** `/v2/owner/fraicheur`, panneau « Seuils de lecture et fraîcheur »
1. « Recouvrement : « Bon » à partir de (%) » = `50`, « À surveiller » = `70`.
2. « Présence : « Bon » à partir de (%) » = `150`.
3. « Donnée « ancienne » au-delà de (heures) » = `500`.
**Résultat attendu :** « Le seuil « À surveiller » ne peut pas dépasser le seuil « Bon ». », « Saisissez un pourcentage entre 0 et 100 (deux décimales au plus). », « Saisissez un nombre entier d'heures entre 1 et 168. » ; rien n'est enregistré.
- [ ] Trois erreurs affichées
- [ ] Réglages inchangés

#### C16.N5 Donnée périmée et isolation entre établissements
**Compte :** propriétaire
1. Sur `demo-secondaire`, repérez la barre « Données au … » et le texte éventuel « Ces données datent de plus longtemps que le délai de fraîcheur… » (si la démonstration tourne depuis plus de 24 heures sans activité).
2. Relevez l'effectif de `demo-secondaire`, puis connectez-vous sur `http://demo-primaire.localhost:3100/v2/login` (compte `direction.generale@demo-primaire.test`) : relevez l'effectif de `demo-primaire`.
3. Essayez d'ouvrir `http://demo-primaire.localhost:3100/v2/direction` avec la session de `demo-secondaire`.
**Résultat attendu :** les chiffres des deux établissements sont distincts ; la session d'un établissement n'ouvre pas l'autre. Un avertissement de donnée ancienne est facultatif mais, s'il s'affiche, il est lisible.
- [ ] Chiffres propres à chaque établissement
- [ ] Pas d'accès croisé entre établissements

#### C16.N6 Export sans droit
**Compte :** directeur des études, économe
1. Sur « Pédagogie » (directeur des études) et « Scolarité » (économe), cherchez « Exporter (CSV) ».
2. Comparez avec le propriétaire sur les mêmes écrans.
**Résultat attendu :** aucun bouton « Exporter (CSV) » pour le directeur des études et l'économe ; le bouton existe pour le propriétaire et le directeur.
- [ ] Aucun bouton d'export pour les deux rôles
- [ ] Bouton présent pour le propriétaire

### 16.5 Problèmes connus et limites
- **Premières alertes différées** : les règles de la graine sont évaluées toutes les 15 minutes ; juste après le démarrage de la démonstration, aucune alerte n'existe. Si aucun seuil n'est franchi par les données, il n'y en aura pas : utilisez la règle de test de C16.10 pour provoquer une alerte.
- **Règles de démonstration** : les résultats clôturés reposent sur un jeu de règles de démonstration ; les moyennes, taux de validation et décisions ne sont pas officiels. Le taux de validation issu de règles de démonstration n'est pas évalué par les alertes (« Non mesuré »).
- **Écran « Charges et résultat »** : aucun module de charges n'existe ; l'écran le dit au lieu d'afficher des zéros.
- **Masse salariale** : peut être vide si aucune paie n'est préparée ; l'authentification forte est demandée.
- **Direction des études et économe** : pas de droit `analytics.read`, donc ni tableau de bord (`/v2/direction`), ni hub (`/v2/analytics`), ni comparaisons ; ils n'accèdent qu'aux écrans de leur domaine. C'est volontaire (décision de la spec) mais peut surprendre un testeur.
- La page « Fraîcheur des données » est technique ; elle n'est pas dans le menu « Pilotage » (adresse directe seulement).
- Les dossiers de vie scolaire ne sont alimentés qu'en secondaire ; le primaire affiche des comptages vides.
- Une règle d'alerte de la graine n'est pas visible d'un rôle qui n'a pas la permission de données de son indicateur (les alertes d'un autre domaine sont filtrées).
- Les notifications d'alerte sont remises par le module de notifications : elles respectent les préférences, consentements et heures calmes de chaque destinataire, et restent « Simulées » pour les canaux externes.

### 16.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 025 §3 et §9 point 4 : seuls `owner` et `directeur` reçoivent `analytics.read` ; le README du module propose d'accorder aux autres rôles les permissions de données et d'alertes (`analytics.alerts.read`, `.acknowledge`, `.admissions.read`, `.schoollife.read`), ce qui est fait dans `system-roles.ts` pour le directeur des études et l'économe ; `analytics.read` reste absent, donc le menu du portail « Pilotage » est partiel pour eux. À arbitrer.
- Le seuil de la règle de test C16.10 (1000 pour un effectif) est un choix de test : la spec ne fixe aucun seuil par défaut.
- Valeurs de la graine : le nombre exact de dossiers d'admission (13) et de mesures à valider vient du guide de démonstration, non d'un compte à l'écran ; à reconfirmer.
- Le journal d'audit (module « Journal d'audit ») est cité sans adresse dans ce chapitre : voir le chapitre qui lui est consacré.


## Chapitre 17. Admissions
> **Durée estimée :** 2 h 30 à 3 h 30 (pages publiques comprises) · **Établissement(s) :** `demo-secondaire` (campagne RENTREE-6E, principal), `demo-superieur` (campagne RENTREE-L1), `demo-primaire` (campagne RENTREE-MATERNELLE) · **Comptes :** chargé d'admissions `admissions@`, direction `directeur@` (décisions, paramètres), secrétariat `secretariat@`, économat `econome@`

### 17.1 Objectif
Vérifier tout le parcours d'un dossier d'admission : de la première prise de contact (prospect) jusqu'à l'inscription confirmée, en passant par les pièces justificatives, les entretiens, la décision de la direction, l'offre de place et la liste d'attente. Vérifier aussi les trois pages publiques : le dépôt d'une candidature par une famille sans compte, le suivi du dossier avec un code, et la vérification publique d'un document officiel.

### 17.2 Avant de commencer
- **Comptes** (adresse de connexion `http://demo-secondaire.localhost:3100/v2/login`, voir le fichier des comptes de démonstration `.demo/credentials.md` pour les mots de passe) :

| Rôle | E-mail type | MFA | Ce que le rôle fait dans ce chapitre |
|---|---|---|---|
| Chargé d'admissions | `admissions@demo-secondaire.test` | non | Saisit, instruit, planifie les entretiens, émet les offres. Ne décide pas. |
| Directeur | `directeur@demo-secondaire.test` | oui | Décide (Admis, Refusé, Liste d'attente), règle les paramètres, anonymise. |
| Secrétariat | `secretariat@demo-secondaire.test` | oui | Même traitement de dossier que le chargé d'admissions, plus le rattachement des pièces au dossier de l'élève. Ne décide pas. |
| Économe | `econome@demo-secondaire.test` | oui | Enregistre le paiement des frais d'inscription. |

  Pour les comptes avec MFA, le code à 6 chiffres s'obtient avec `pnpm demo:totp <e-mail>` (voir l'introduction).
- **Menus** (coque de gestion, selon le rôle) : « Admissions » (le pipeline), « Candidatures », « Prospects », « Listes d'attente », « Campagnes d'admission », « Parcours d'admission » (le workflow), « Recrutement : tableaux de bord », « Paramètres des admissions ». Dans les écrans, une barre d'onglets « Admissions » reprend : « Pipeline », « Candidatures », « Listes d'attente », « Prospects », « Campagnes », « Rapports », « Paramètres », « Workflow ». Un onglet n'apparaît que si le rôle a le droit correspondant.
- **URL des écrans du personnel** : `/v2/admissions` (pipeline), `/v2/admissions/applications`, `/v2/admissions/applications/new`, `/v2/admissions/applications/<identifiant>` (dossier), `/v2/admissions/waitlist`, `/v2/admissions/prospects`, `/v2/admissions/campaigns`, `/v2/admissions/reports`, `/v2/admissions/settings`, `/v2/admissions/settings/workflow`.
- **URL publiques** (sans compte, sans menu) : `/v2/apply/<lien-de-l-établissement>` (formulaire), `/v2/apply/<lien>/track` (suivi), `/v2/apply/<lien>/offer#t=...` (réponse à une offre), `/v2/verify` et `/v2/verify/<code>` (vérification d'un document).
- **Données de démonstration** : chaque établissement a une campagne ouverte et une dizaine de dossiers à tous les statuts. Les noms viennent de la graine (parents et enfants fictifs). Pour la 6e du Collège Le Baobab (campagne `RENTREE-6E`, 9 dossiers) :

| Candidat | Étape du dossier (colonne du pipeline) | Particularité |
|---|---|---|
| Aïcha ADOU | « Inscrit » | Frais d'inscription payés, inscription confirmée. |
| Brice ASSI | « Inscription en attente de paiement » | Élève et facture des frais créés, non réglée. |
| Chantal DAGO | « Admis » | Offre de place émise, réponse de la famille attendue. |
| Désiré EKRA | « En étude » | Prêt pour une décision de la direction. |
| Estelle FOFANA | « Candidature reçue » | Statut « Déposée ». |
| Fabrice GUEI | « Pièces manquantes » | |
| Grâce HIEN | « Liste d'attente » | |
| Hervé KRA | « Refusé » | Motif « Dossier incomplet » ; dossier clos, candidat pour l'anonymisation. |
| Inès LOBA | « Brouillon » | |

  À `demo-superieur` (campagne `RENTREE-L1`) ce sont les mêmes 9 noms. À `demo-primaire` (campagne `RENTREE-MATERNELLE`, niveau « GS », 13 dossiers) 5 enfants sont inscrits (Aïcha ADOU, Brice ASSI, Chantal DAGO, Désiré EKRA, Estelle FOFANA), puis : en attente de paiement Fabrice GUEI, offre émise Grâce HIEN, en étude Hervé KRA, reçue Inès LOBA, pièces manquantes Jonas MEL, liste d'attente Karine NAMA, refusée Lazare OKOU, brouillon Martine PEHE.
- **Ce que la démonstration ne contient pas** : le lien public de l'établissement n'est pas créé, aucun texte de consentement n'est « en vigueur » et aucune pièce justificative n'est exigée. Les scénarios C17.5 et C17.8 les créent. Les messages aux familles (candidature reçue, offre...) sont seulement mis en file : aucun e-mail ni SMS n'est réellement envoyé.
- **Défaut n°2 du rapport QA (corrigé dans la branche, à reconfirmer).** Sur l'ancienne API de démonstration, toutes les pages d'admission répondaient « Établissement introuvable » (réponse 404, code `institution_unknown`) : listes vides ou en erreur. La correction est dans la branche ; elle ne vaut qu'après redémarrage de l'API depuis la branche. **Première vérification à faire** : ouvrir `/v2/admissions/applications` avec `admissions@` ; si la liste est vide ou affiche « Établissement introuvable », l'API n'a pas été redémarrée (voir le dépannage de l'introduction).
- **Ordre conseillé** : scénarios de lecture d'abord, puis création et décisions, puis l'inscription, l'anonymisation en tout dernier (action irréversible). `pnpm demo:reset` remet tout à zéro.

### 17.3 Scénarios

#### C17.1 Lire le pipeline
**Compte :** `admissions@demo-secondaire.test` · **Où :** « Admissions » > « Pipeline » (`/v2/admissions`)
1. Connectez-vous. Ouvrez « Admissions ».
2. Vérifiez le titre « Pipeline des candidatures » et la présence des listes « Campagne d'admission » et « Niveau ».
3. Choisissez la campagne `RENTREE-6E` (libellé « Campagne RENTREE-6E »).
4. Parcourez les colonnes : une colonne par étape, avec une pastille de statut (« Brouillon », « Déposée », « À l'étude », « Pièce manquante », « Liste d'attente », « Acceptée », « Inscrit », « Refusée ») et le nombre de dossiers.
5. Dans la liste « Niveau », choisissez « Tous les niveaux » puis un niveau : les colonnes se filtrent.
**Résultat attendu :** les 9 dossiers du tableau de la section précédente sont répartis une par colonne ; les colonnes vides indiquent « Aucun dossier ».
- [ ] Un dossier dans chacune des colonnes : « Brouillon », « Candidature reçue », « En étude », « Pièces manquantes », « Liste d'attente », « Admis », « Inscription en attente de paiement », « Inscrit », « Refusé »
- [ ] Les colonnes « Retiré par la famille », « Offre expirée » et « Dossier en double » existent et sont vides
- [ ] Le bouton « Nouvelle candidature » est visible pour ce compte

#### C17.2 Liste des candidatures et filtres
**Compte :** `admissions@` · **Où :** « Candidatures » (`/v2/admissions/applications`)
1. Ouvrez « Candidatures » : titre « Candidatures », tableau « Liste des candidatures » (colonnes « Numéro », « Candidat », « Niveau », « Étape », « Déposée le »).
2. Filtrez par « Statut » : « Inscrit » doit donner un seul dossier (Aïcha ADOU).
3. Tapez « EKRA » dans « Recherche » (placeholder « Nom ou numéro ») : un seul dossier.
4. Cochez « Délai dépassé seulement », puis décochez.
5. Combinez le statut « Inscrit » et la recherche « KRA » : aucun dossier ne correspond (Hervé KRA est « Refusé »).
**Résultat attendu :** les filtres réduisent la liste ; le message « Aucune candidature ne correspond à ces filtres. » s'affiche quand rien ne correspond.
- [ ] Le filtre par statut fonctionne
- [ ] La recherche par nom fonctionne
- [ ] Le message d'absence de résultat est affiché

#### C17.3 Lire un dossier de candidature
**Compte :** `admissions@` · **Où :** « Candidatures » > cliquer sur le nom du candidat
1. Ouvrez le dossier de Brice ASSI (« Inscription en attente de paiement »).
2. Lisez l'en-tête : nom, « Dossier <numéro> · niveau 6E », pastilles d'étape et de statut.
3. Repérez la section « Inscription » : « Inscription en attente : elle sera confirmée au règlement des frais d'inscription. »
4. Parcourez les sections : « Informations », « Tuteurs et consentement » (consentement « Traitement des données » valide), « Pièces du dossier », « Tests et entretiens », « Offres de place » (une offre « Acceptée »), « Doublons possibles », « Historique », « Données personnelles ».
5. Ouvrez ensuite le dossier d'Aïcha ADOU (« Inscrit »).
**Résultat attendu :** pour Aïcha ADOU, la section « Inscription » indique « Inscription confirmée le <date>. » ; les liens « Dossier de l'élève » et « Fiche d'inscription » n'apparaissent que si le rôle a le droit de les ouvrir (sinon simple texte). Dans « Historique », les changements d'étape sont listés.
- [ ] Les sections attendues sont présentes
- [ ] Le texte d'inscription en attente / confirmée correspond au dossier
- [ ] Aucune action de décision n'est proposée au chargé d'admissions (voir C17.N1)

#### C17.4 Créer une candidature (secrétariat) et la soumettre
**Compte :** `admissions@` (ou `secretariat@`) · **Où :** « Candidatures » > « Nouvelle candidature » (`/v2/admissions/applications/new`)
1. Remplissez « Candidat » : « Prénoms » `Test`, « Nom » `TESTEUR`, « Date de naissance » (un enfant d'environ 11-12 ans), « Lieu de naissance » `Abidjan`, « Sexe ».
2. Choisissez le niveau et la campagne si la liste est proposée.
3. Remplissez « Tuteur 1 » : « Lien de parenté », « Prénoms », « Nom », « Téléphone » ou « Adresse e-mail » (au moins un moyen de contact), cochez « Tuteur principal » et « Responsable financier ».
4. Cliquez sur « Créer la candidature ». Le dossier s'ouvre.
5. Dans « Étape et décisions », cliquez sur « Candidature reçue » : l'étape exige un consentement parental valide. Un refus est attendu tant que le consentement manque.
6. Dans « Tuteurs et consentement », cliquez « Consigner un consentement » : choisissez le tuteur, la « Version du texte accepté » (`v1`), le « Mode de recueil » (« Document papier »), la « Référence de la pièce justificative » (par exemple `REG-2026-001`), puis « Enregistrer le consentement ».
7. Recommencez l'étape 5.
**Résultat attendu :** le dossier est créé en « Brouillon » ; le passage à « Candidature reçue » est refusé sans consentement, puis accepté avec ; le message « Dossier passé à l'étape « Candidature reçue ». » s'affiche. Le consentement apparaît « Consentement valide ».
- [ ] Création réussie, dossier en « Brouillon »
- [ ] Passage refusé sans consentement (message lisible, pas d'écran blanc)
- [ ] Consentement consigné, passage à « Candidature reçue » réussi
- [ ] Le bouton « Modifier la candidature » permet de corriger un champ (message « Candidature mise à jour. »)

#### C17.5 Pièces justificatives
**Compte :** `directeur@` pour exiger une pièce, puis `admissions@` pour le dossier · **Où :** « Paramètres des admissions » > « Pièces à fournir », puis dossier de Fabrice GUEI
1. Avec `directeur@`, ouvrez `/v2/admissions/settings`, section « Pièces à fournir » : « Ajouter une pièce » avec « Code » `ACTE_NAISSANCE`, « Libellé » `Acte de naissance`, « Pièce obligatoire » cochée, « Niveau concerné » « Tous les niveaux » ; « Ajouter ». Message « Pièce enregistrée. »
2. Avec `admissions@`, ouvrez le dossier de Fabrice GUEI (« Pièces manquantes »). La section « Pièces du dossier » liste l'acte de naissance « obligatoire » à l'état « Manquante » ; un bandeau « Pièces manquantes : ... » apparaît en haut.
3. Cliquez « Déposer » (au nom de la famille) et choisissez un petit fichier PDF ou une image. L'état passe à « À contrôler ».
4. Cliquez « Consulter » puis « Accepter ». L'état passe à « Acceptée ».
5. Sur un autre dossier, déposez un fichier puis « Rejeter » avec un motif (« Motif du rejet ») : l'état passe à « Rejetée » et le motif est conservé.
**Résultat attendu :** l'état de chaque pièce suit « Manquante », « À contrôler », « Acceptée » ou « Rejetée ». Le motif de rejet est visible de la famille sur la page de suivi (C17.17).
- [ ] Pièce exigée créée par la direction
- [ ] Dépôt, consultation, acceptation fonctionnent
- [ ] Rejet avec motif obligatoire
- [ ] Attention : une pièce obligatoire exigée après coup peut empêcher d'admettre un dossier tant que les pièces ne sont pas complètes (étape « Admis » : « Exige les pièces complètes »)

#### C17.6 Planifier un test ou un entretien
**Compte :** `admissions@` · **Où :** dossier de Désiré EKRA (« En étude ») > section « Tests et entretiens »
1. Cliquez « Planifier » : « Nature » (« Entretien » ou « Test »), « Date et heure » (obligatoire), « Lieu ». « Planifier ».
2. L'entretien apparaît « Planifié ». Cliquez « Renseigner » : « Déroulement » « Réalisé », « Note » et « Barème » (par exemple 14 sur 20), « Résultat » « Admis », « Observations » ; « Enregistrer ».
3. Essayez une note supérieure au barème (25 sur 20).
**Résultat attendu :** l'entretien affiche « Note : 14 / 20 » et le résultat « Admis ». La note invalide est refusée (« Note ou barème invalide. »). Si la section n'apparaît pas, la fonctionnalité « tests et entretiens » n'est pas incluse dans l'offre de l'établissement.
- [ ] Entretien planifié, puis résultat saisi
- [ ] Note hors barème refusée

#### C17.7 Décision de la direction : Admis, Refusé, Liste d'attente
**Compte :** `directeur@demo-secondaire.test` (MFA) · **Où :** dossier de Désiré EKRA, section « Étape et décisions »
1. Ouvrez le dossier de Désiré EKRA (« En étude »). Les boutons proposés portent le nom de l'étape visée : « Admis », « Liste d'attente », « Refusé », « Retiré par la famille », « Dossier en double », « Pièces manquantes ».
2. Cliquez « Admis ». La fenêtre « Acceptation » indique l'étape visée et rappelle que la décision est journalisée et ne peut plus être modifiée. Choisissez un « Motif » (la liste propose des motifs neutres comme « Candidature retenue »), éventuellement « Précisions » et « Conditions de l'acceptation », puis « Enregistrer : Acceptation ».
3. Message « Acceptation enregistrée : dossier à l'étape « Admis ». » ; l'historique « Décisions formelles » montre la décision avec le nom du directeur.
4. Sur le dossier d'Inès LOBA (« Brouillon ») ou un dossier nouvellement soumis, essayez « Refusé » : un motif est obligatoire.
**Résultat attendu :** chaque décision demande un motif, est enregistrée avec son auteur et ne se modifie plus. Si la capacité du niveau est atteinte, l'écran signale « Aucune place n'est disponible à ce niveau » ; dépasser la capacité demande une permission sensible et un motif d'au moins 10 caractères.
- [ ] Décision « Admis » enregistrée avec motif
- [ ] Décision de refus impossible sans motif
- [ ] La décision apparaît dans « Historique » > « Décisions formelles » (« Par <nom> »)

#### C17.8 Préparer le lien public (formulaire des familles)
**Compte :** `directeur@` · **Où :** « Paramètres des admissions » (`/v2/admissions/settings`)
1. Section « Textes de consentement parental » : le message « Aucun texte de traitement des données n'est désigné : le formulaire public est fermé. » doit s'afficher (état de la démonstration).
2. Sous « Publier un nouveau texte », choisissez « Nature » « Traitement des données », « Version » `v2`, un « Texte » d'au moins 20 caractères, laissez coché « Désigner comme texte en vigueur », puis « Publier ». Message « Texte publié. » ; la pastille « Texte en vigueur » apparaît sur la version `v2`.
3. Section « Formulaire public » : cliquez « Créer le lien public ». Message « Lien public créé. » ; le lien est « actif ». Deux liens apparaissent : « Lien du formulaire » et « Lien de suivi des familles ». Utilisez « Copier ».
4. Notez que ces liens ressemblent à `http://demo-secondaire.localhost:3100/v2/apply/<code long et opaque>`.
**Résultat attendu :** lien actif, texte `v2` en vigueur. Sans texte en vigueur, la famille voit « Ce formulaire n'est pas disponible. » (voir C17.N7).
- [ ] Texte publié et désigné
- [ ] Lien public créé, copié
- [ ] « Désactiver le lien » puis « Activer le lien » fonctionne (message « Lien mis à jour. »)
- [ ] Attention : « Régénérer le lien » rend l'ancien lien inutilisable immédiatement ; ne l'utilisez qu'à la fin

#### C17.9 Émettre une offre et obtenir le lien de réponse
**Compte :** `admissions@` · **Où :** dossier de Désiré EKRA (devenu « Admis » en C17.7), section « Offres de place »
1. Le bouton « Émettre une offre » n'apparaît que pour un dossier « Acceptée » sans offre en attente. Cliquez-le.
2. Choisissez la « Classe » (facultatif : « Classe unique du niveau » ou « À préciser plus tard »), « Conditions », « Validité en jours » (14 par défaut), puis validez.
3. La fenêtre « Offre émise » indique l'état des notifications (par exemple « La notification est en file d'envoi. » : aucun message réel) et le « Lien de réponse de la famille ».
4. Copiez le lien (affiché **une seule fois** : « Ce lien n'est affiché qu'une seule fois »). Gardez-le pour C17.18.
5. Sur le dossier de Chantal DAGO (offre déjà émise « En attente de réponse »), repérez les boutons « Désigner la classe », « Accepter au nom de la famille » (réservé aux personnes ayant le droit d'inscrire) et « Retirer l'offre ».
**Résultat attendu :** l'offre est « En attente de réponse » avec son échéance. Sans lien public créé (C17.8), l'écran indique « Le lien public de l'établissement n'est pas encore créé ».
- [ ] Offre émise, lien affiché une fois
- [ ] L'échéance affichée correspond à la validité
- [ ] « Retirer l'offre » exige un motif (« Motif du retrait ») et libère la place

#### C17.10 Liste d'attente et promotion
**Compte :** `admissions@` · **Où :** « Listes d'attente » (`/v2/admissions/waitlist`)
1. Choisissez le niveau « 6E » (le message « Choisissez un niveau pour afficher sa liste d'attente. » précède le choix).
2. Vérifiez : « Rang », « Candidat » (Grâce HIEN), « Priorité », « En attente depuis », et le nombre de places libres.
3. Cliquez « Promouvoir Grâce HIEN » (ou « Promouvoir le premier de la liste »).
4. Message « Une offre a été émise. » avec le « Lien de réponse de la famille » (une seule fois).
**Résultat attendu :** le dossier de Grâce HIEN passe à « Admis » avec une offre en attente. Si aucune place n'est libre, le message « Aucune promotion : <raison> » s'affiche.
- [ ] La liste est ordonnée par priorité puis ancienneté
- [ ] La promotion émet une offre et affiche le lien de réponse

#### C17.11 Prospects
**Compte :** `admissions@` · **Où :** « Prospects » (`/v2/admissions/prospects`)
1. Cliquez « Nouveau prospect » : « Prénoms », « Nom », « Téléphone » ou « Adresse e-mail », « Niveau visé », « Origine » (« Visite », « Téléphone », « Recommandation », « Réseaux sociaux », « Site web », « Événement », « Autre »), « Notes » ; « Enregistrer ».
2. Le prospect est « Nouveau ». Cliquez « Marquer contacté » : « Contacté ».
3. Cliquez « Convertir » : donnez « Prénoms de l'enfant », « Date de naissance de l'enfant », « Lien de parenté du prospect » ; validez. Le statut devient « Converti » et un lien « Ouvrir le dossier » apparaît.
4. Créez un second prospect et cliquez « Perdu » avec un « Motif ».
**Résultat attendu :** un dossier est créé à la conversion, avec le prospect comme tuteur. Un prospect perdu garde son motif.
- [ ] Prospect créé, contacté, converti en dossier
- [ ] Prospect marqué perdu avec motif
- [ ] Les filtres « Statut » et « Recherche » fonctionnent

#### C17.12 Campagnes et capacités
**Compte :** `directeur@` (lecture seule pour `admissions@`) · **Où :** « Campagnes d'admission » (`/v2/admissions/campaigns`)
1. Repérez la campagne `RENTREE-6E` (période « Du ... au ... », état « Ouverte »).
2. Cliquez « Capacités » : tableau « Capacités de la campagne » avec « Niveau », « Places » (13 pour 6E : 1 + 12), « Places libres », « Liste d'attente ».
3. Cliquez « Nouvelle campagne » : choisissez l'année scolaire, le « Workflow publié », un « Code » (`TEST-2027`), un « Libellé », « Ouverture » et « Clôture » (la clôture doit suivre l'ouverture), « Créer ».
4. Sur la nouvelle campagne : « Capacités » (ajoutez un niveau et un nombre de places), puis « Ouvrir ».
**Résultat attendu :** la nouvelle campagne apparaît d'abord en « Brouillon » puis « Ouverte ». Avec `admissions@`, la page se consulte mais les boutons de création, d'ouverture, de clôture et de capacités sont absents.
- [ ] Capacités lues
- [ ] Campagne créée, capacités saisies, campagne ouverte
- [ ] Attention : « Clôturer » ferme les dépôts de la campagne ; ne le faites que sur la campagne de test `TEST-2027`

#### C17.13 Passage à l'inscription : paiement des frais
**Compte :** `econome@demo-secondaire.test` (paiement) puis `admissions@` (contrôle) · **Où :** `/v2/finance/payments` (écran des encaissements, voir le chapitre Finances), puis dossier de Brice ASSI
1. Avec `admissions@`, notez que le dossier de Brice ASSI est en « Inscription en attente de paiement ».
2. Avec `econome@`, ouvrez les factures de Brice ASSI, repérez la facture des frais d'inscription (25 000 XOF au collège) non réglée, et enregistrez un paiement du montant total (virement, référence libre).
3. Attendez quelques secondes puis rouvrez le dossier avec `admissions@` : l'étape devient « Inscrit » et le texte « Inscription confirmée le <date>. ».
**Résultat attendu :** l'inscription se confirme automatiquement après le paiement des frais ; personne ne peut poser « Inscrit » à la main (aucun bouton ne le propose).
- [ ] Facture des frais d'inscription trouvée
- [ ] Après paiement, dossier « Inscrit » sans action manuelle
- [ ] Le lien « Fiche d'inscription » s'ouvre pour un rôle qui en a le droit

#### C17.14 Rapports de recrutement
**Compte :** `admissions@` ou `directeur@` · **Où :** « Rapports » (`/v2/admissions/reports`, menu « Recrutement : tableaux de bord »)
1. Choisissez la campagne `RENTREE-6E`.
2. Lisez : « Entonnoir » (« Reçues », « Traitées », « Délai moyen (h) », « Statut », « Dossiers »), « Capacités » (« Places », « Libres », « Retenues », « En attente »), « Délais par étape », « Sources », « Motifs de refus ».
**Résultat attendu :** le nombre de dossiers par statut correspond au pipeline ; le refus de Hervé KRA apparaît avec son motif ; les candidats saisis au secrétariat ont la source « WALK_IN » (visite).
- [ ] Les cinq blocs sont affichés sans erreur
- [ ] Les nombres sont cohérents avec le pipeline

#### C17.15 Paramètres et workflow (lecture)
**Compte :** `directeur@` · **Où :** « Paramètres des admissions » puis « Parcours d'admission » (`/v2/admissions/settings/workflow`)
1. Dans « Paramètres d'admission », lisez « Politiques générales » : « Capacité » (stricte, souple, aucune limite), « Doublons » (bloquer, signaler, ne pas détecter), « Promotion de la liste d'attente » (manuelle ou automatique), « Validité d'une offre (jours) », « Délai de paiement des frais (jours) », « Conservation des dossiers refusés (mois) », « Modèle de numéro de dossier », « Protection du formulaire public ».
2. Sections « Motifs de décision » et « Classes de priorité » : lisez les listes.
3. Ouvrez « Parcours d'admission » : liste des workflows (« Workflow publié »), étapes avec statut canonique et règles (« Exige le consentement », « Exige les pièces complètes », « Exige une décision formelle », « Crée l'inscription »...), transitions avec la permission requise.
4. Constatez le texte « Ce workflow est gelé. Créez une nouvelle version pour le faire évoluer. »
**Résultat attendu :** un workflow publié n'est pas modifiable ; « Nouvelle version » en crée un brouillon éditable. N'éditez pas ni ne publiez en démonstration, sauf besoin précis (publier est un acte sensible avec MFA).
- [ ] Paramètres lisibles
- [ ] Workflow publié gelé
- [ ] Étapes et transitions listées

#### C17.16 Page publique : dépôt d'une candidature par une famille (sans compte)
**Compte :** aucun · **Où :** le « Lien du formulaire » copié en C17.8, ouvert dans une **fenêtre de navigation privée** (aucune session ouverte)
1. Collez le lien dans la fenêtre privée. Titre « Candidature à <nom de l'établissement> » et phrase « Aucun compte n'est créé ; un code de suivi vous sera remis. »
2. Section « L'enfant » : « Prénoms » `Famille`, « Nom » `PUBLICTEST`, « Date de naissance », « Lieu de naissance », « Sexe », « Établissement précédent », « Niveau demandé » (liste des niveaux de la campagne), « Prise en charge » (« Par la famille » ou « Élève affecté par l'État », qui exige une « Référence d'affectation »).
3. Section « Parent ou tuteur 1 » : « Lien de parenté », « Prénoms », « Nom », « Téléphone » ou « Adresse e-mail ». « Ajouter un second parent ou tuteur » est facultatif.
4. Section « Consentement parental » : lisez le texte et sa « Version du texte : v2 », choisissez « Consentement donné par », cochez « J'ai lu le texte ci-dessus et j'y consens en tant que parent ou tuteur légal. »
5. Attendez quelques secondes après l'ouverture du formulaire (un délai minimal de saisie existe : un envoi trop rapide est traité comme un robot), puis « Envoyer ma candidature ».
6. Page « Candidature reçue » : un « Code de suivi » en gros caractères et l'avertissement de le conserver (« il ne sera plus affiché »). **Notez le code.**
7. Avec `admissions@`, vérifiez dans « Candidatures » que le dossier `PUBLICTEST` est arrivé (source site web).
**Résultat attendu :** la famille ne voit que le code de suivi ; aucune information sur les places restantes, les doublons ou le fonctionnement interne n'est révélée. Le formulaire ne demande aucune donnée de santé, religion ou situation financière (l'avertissement est affiché).
- [ ] Formulaire affiché sans connexion
- [ ] Envoi réussi avec code de suivi
- [ ] Le dossier est visible côté établissement
- [ ] Aucun mot de passe ni compte n'est demandé

#### C17.17 Page publique : suivi de dossier
**Compte :** aucun · **Où :** « Suivre mon dossier » ou `/v2/apply/<lien>/track` en navigation privée
1. Saisissez le code de suivi noté en C17.16 (les espaces et tirets sont ignorés) puis « Suivre ».
2. Lisez « État de votre dossier » avec la phase et « Mis à jour le <date> ».
3. Côté établissement, avec `admissions@`, faites passer le dossier PUBLICTEST à « Pièces manquantes » (via « En étude ») : actualisez la page de suivi : la liste « Pièces à fournir » apparaît (si une pièce est exigée, voir C17.5), avec un bouton « Déposer » (formats PDF, JPEG, PNG ou WebP) ; déposez un fichier : « Pièce reçue, merci. »
4. Si une pièce a été rejetée, le motif s'affiche (« Pièce refusée : ... »).
5. Pour un dossier avec offre en attente, la page affiche « L'établissement vous a proposé une place. Utilisez le lien reçu pour répondre avant le <date>. »
**Résultat attendu :** la famille suit l'avancement sans compte, dépose les pièces demandées et voit les motifs de rejet.
- [ ] Le code de suivi donne l'état du dossier
- [ ] Le dépôt d'une pièce depuis la page publique fonctionne et est visible côté établissement (état « À contrôler »)
- [ ] La page de suivi n'affiche ni note interne ni motif de refus de décision

#### C17.18 Page publique : répondre à une offre
**Compte :** aucun · **Où :** le « Lien de réponse de la famille » copié en C17.9 ou C17.10 (se termine par `/offer#t=...`), en navigation privée
1. Ouvrez le lien. Titre « Proposition de place à <établissement> », avec « Niveau », « Classe » (ou « Précisée par l'établissement »), « À accepter avant le » et « Conditions ».
2. Cliquez « Décliner la place » : message de confirmation « Confirmez-vous que vous déclinez cette place ? Elle sera proposée à une autre famille. » ; annulez avec « Retour ».
3. Cliquez « Accepter la place », puis confirmez : « Confirmez-vous l'acceptation de cette place ? L'établissement vous indiquera les frais d'inscription à régler. » Page « Place acceptée ».
4. Côté établissement, rouvrez le dossier : l'offre est « Acceptée », l'élève et l'inscription en attente de paiement existent, et la facture des frais d'inscription est créée ; le dossier est à « Inscription en attente de paiement ».
5. Rouvrez le même lien : « Cette proposition a déjà été acceptée. »
**Résultat attendu :** l'acceptation crée l'élève, l'inscription en attente et la facture ensemble ; le lien est à usage unique. Attention : cette action crée de vraies données de démonstration ; utilisez un dossier de test.
- [ ] La famille accepte sans compte
- [ ] Élève, inscription en attente et facture créés
- [ ] Le lien rejoué indique que la proposition est déjà acceptée

#### C17.19 Page publique : vérification d'un document
**Compte :** aucun pour la vérification ; `directeur@` ou le parent pour trouver un code · **Où :** `/v2/verify`
1. Pour obtenir un code : connectez-vous (par exemple avec `directeur@demo-secondaire.test`), ouvrez `/v2/reportcards` (« Bulletins émis »), ouvrez un bulletin : la section « Vérification d'authenticité » donne le « Code de vérification » (26 caractères) et « Ouvrir la page de vérification ». Copiez le code.
2. En navigation privée, ouvrez `/v2/verify`. Titre « Vérification d'un document ». Saisissez le code (les espaces et tirets sont ignorés) et « Vérifier ».
3. Le résultat « Document authentique » affiche : « Établissement », « Nature du document » (par exemple « Bulletin »), « Intitulé », « Émis le », et une section « Détails techniques » (clé de signature, empreinte).
4. Ouvrez aussi `/v2/verify/<code>` : le code est vérifié dès l'ouverture. L'adresse `/v2/verify/v/<code>` (forme du QR code imprimé) donne le même résultat.
5. Section « Comparer un fichier PDF » : téléversez le PDF téléchargé du bulletin : « Fichier identique ». Téléversez un autre PDF : « Fichier non reconnu ».
**Résultat attendu :** la page confirme l'existence et le statut du document, sans afficher note, nom, matricule ni date de naissance (c'est écrit sur la page). Le fichier téléversé n'est pas conservé.
- [ ] Code valide : « Document authentique »
- [ ] La page ne montre aucune donnée personnelle
- [ ] Le PDF identique est reconnu, un autre PDF non
- [ ] Les trois formes d'adresse (`/v2/verify`, `/v2/verify/<code>`, `/v2/verify/v/<code>`) fonctionnent

#### C17.20 Exporter puis anonymiser un dossier clos (en dernier)
**Compte :** `directeur@` (MFA) · **Où :** dossier de Hervé KRA (« Refusé »), section « Données personnelles »
1. Cliquez « Exporter le dossier » : un fichier `dossier-<numéro>.json` est téléchargé (droit d'accès). Rien n'est modifié.
2. **Attention : action irréversible.** Cliquez « Anonymiser », saisissez un « Motif de l'anonymisation » et confirmez.
3. Le dossier affiche « Ce dossier est anonymisé. » ; le nom est remplacé par « Dossier anonymisé » dans la liste et le pipeline.
**Résultat attendu :** l'identité, les contacts et les pièces sont effacés ; les décisions et les statistiques restent sans donnée personnelle. Aucun bouton d'action n'est plus proposé sur le dossier.
- [ ] Export téléchargé
- [ ] Anonymisation avec motif obligatoire
- [ ] Le dossier ne montre plus le nom du candidat et les rapports restent cohérents

### 17.4 Cas limites et tests négatifs

#### C17.N1 Le chargé d'admissions ne décide pas
**Compte :** `admissions@` · **Où :** dossier de Désiré EKRA (« En étude »)
1. Regardez « Étape et décisions ».
**Résultat attendu :** seules les actions de traitement sont proposées (par exemple « Pièces manquantes ») ; ni « Admis », ni « Refusé », ni « Liste d'attente » ; pas de bouton « Exporter le dossier » ni « Anonymiser ». Le secrétariat se comporte de même.
- [ ] Aucune décision proposée à `admissions@`
- [ ] Aucun bouton d'export ni d'anonymisation

#### C17.N2 Pages réservées à la direction
**Compte :** `admissions@` · **Où :** `/v2/admissions/settings` puis `/v2/admissions/settings/workflow`
1. Tapez ces adresses dans le navigateur.
**Résultat attendu :** message d'accès refusé (pas de page blanche). Les onglets « Paramètres » et « Workflow » ne sont pas dans la barre « Admissions ». La page « Campagnes » reste lisible mais sans bouton « Nouvelle campagne ».
- [ ] Accès refusé aux paramètres et au workflow
- [ ] Campagnes en lecture seule

#### C17.N3 Un rôle sans lien avec les admissions
**Compte :** `enseignant@demo-secondaire.test` · **Où :** `/v2/admissions`
**Résultat attendu :** message d'accès refusé ; aucun élément de menu « Admissions ».
- [ ] Accès refusé pour l'enseignant

#### C17.N4 Isolation entre établissements
**Compte :** `admissions@demo-secondaire.test` puis `admissions@demo-superieur.test` · **Où :** adresse d'un dossier
1. Copiez l'adresse complète d'un dossier du collège (`/v2/admissions/applications/<identifiant>`).
2. Connectez-vous à `http://demo-superieur.localhost:3100/v2/login` avec `admissions@demo-superieur.test` et ouvrez cette même adresse.
**Résultat attendu :** la page répond comme si le dossier n'existait pas (élément introuvable) ; aucune donnée de l'autre établissement n'apparaît.
- [ ] Dossier d'un autre établissement : introuvable

#### C17.N5 Consentement et saisie invalide
**Compte :** `admissions@` et public · **Où :** formulaire public (C17.16) et dossier
1. Sur le formulaire public, ne cochez pas le consentement, ou laissez « Prénoms » vide, ou aucun moyen de contact, puis envoyez.
2. Choisissez « Élève affecté par l'État » sans « Référence d'affectation ».
**Résultat attendu :** messages « Le consentement parental est obligatoire pour envoyer la candidature. » et « La référence d'affectation est obligatoire pour un élève affecté par l'État. » ; champs en erreur signalés ; aucun envoi.
- [ ] Envoi bloqué sans consentement
- [ ] Référence d'affectation exigée

#### C17.N6 Double action sur une offre
**Compte :** public · **Où :** lien de réponse déjà utilisé (C17.18)
1. Rouvrez le lien après l'acceptation, puis essayez d'accepter ou de décliner.
**Résultat attendu :** « Cette proposition a déjà été acceptée. » ; aucun deuxième élève ni deuxième facture. Un lien tronqué (sans `#t=...`) affiche « Ce lien est incomplet. Utilisez le lien exact reçu de l'établissement. » ; un lien inventé affiche « Ce lien n'est pas ou plus valide. »
- [ ] Acceptation non rejouable
- [ ] Lien incomplet et lien inventé gérés par un message neutre

#### C17.N7 Lien public fermé, désactivé ou inconnu
**Compte :** `directeur@` puis public · **Où :** « Paramètres » > « Formulaire public »
1. Cliquez « Désactiver le lien » ; en navigation privée, rouvrez le lien du formulaire.
2. Modifiez quelques caractères du code dans l'adresse.
3. Réactivez le lien (« Activer le lien »).
**Résultat attendu :** « Ce formulaire n'est pas disponible. » dans les deux cas, sans distinguer « inconnu » de « fermé » (réponse neutre volontaire). Même message si aucun texte de consentement n'est en vigueur. Après réactivation, le formulaire revient.
- [ ] Lien désactivé : formulaire indisponible
- [ ] Lien inventé : même message
- [ ] Réactivation : formulaire de nouveau accessible

#### C17.N8 Suivi avec un mauvais code et trop de tentatives
**Compte :** public · **Où :** `/v2/apply/<lien>/track`
1. Saisissez `ABCDEFGH1234` puis un code de moins de 8 caractères.
2. Recommencez de nombreuses fois de suite (plusieurs dizaines).
**Résultat attendu :** « Aucun dossier ne correspond à ce code. » pour un code faux ou court ; après de nombreuses tentatives, « Trop de demandes depuis votre connexion. Réessayez dans quelques minutes. » (limitation volontaire).
- [ ] Code faux : message neutre
- [ ] Limitation de débit visible à l'excès

#### C17.N9 Vérification d'un code ou d'un fichier invalide
**Compte :** public · **Où :** `/v2/verify`
1. Saisissez un code inventé de 26 caractères, puis un code trop court.
2. Téléversez un fichier qui n'est pas un PDF (image), puis un PDF de plus de 10 Mo si possible.
**Résultat attendu :** « Aucun document ne correspond à ce code. Vérifiez la saisie ; si le code est correct, le document n'est pas authentique. » ; « Le fichier doit être au format PDF. » ; « Le fichier dépasse 10 Mo. »
- [ ] Code faux : message d'absence de document
- [ ] Fichier non PDF refusé, fichier trop gros refusé

#### C17.N10 Modification simultanée d'un dossier
**Compte :** `admissions@` (deux fenêtres) · **Où :** dossier de Estelle FOFANA
1. Ouvrez le même dossier dans deux fenêtres. Dans la première, « Modifier la candidature » et enregistrez un changement (« Lieu de naissance »).
2. Dans la seconde (sans recharger), modifiez un autre champ et enregistrez.
**Résultat attendu :** message « Le dossier a été modifié par une autre personne depuis son affichage. Rechargez la dernière version avant de ressaisir vos modifications. » avec le bouton « Recharger la dernière version » ; rien n'est écrasé silencieusement.
- [ ] Conflit signalé
- [ ] Recharger affiche la version enregistrée

#### C17.N11 Anonymiser un dossier inscrit
**Compte :** `directeur@` · **Où :** dossier d'Aïcha ADOU (« Inscrit »), « Données personnelles »
1. Tentez « Anonymiser » avec un motif.
**Résultat attendu :** l'anonymisation est prévue pour un dossier clos sans inscription : un refus lisible est attendu (texte exact à confirmer). Aucun effacement ne doit avoir lieu.
- [ ] Refus de l'anonymisation d'un dossier inscrit (à confirmer)

### 17.5 Problèmes connus et limites
- **Défaut n°2 du rapport QA (admissions en 404 « Établissement introuvable »)** : corrigé dans la branche (filtre de statut de l'établissement, `apps/api/src/platform/adapters/admissions-academic.ts`), mais **à reconfirmer après redémarrage de l'API de démonstration**. Tant que l'ancienne API tourne, les écrans Candidatures, Campagnes, Prospects, Rapports, Listes d'attente et Paramètres sont vides ou en erreur.
- Le lien public, le texte de consentement en vigueur et les pièces exigées ne sont **pas préparés** par la démonstration : à créer (C17.5, C17.8). Sans eux, le formulaire public affiche « Ce formulaire n'est pas disponible. ».
- Les notifications aux familles (candidature reçue, offre, pièces manquantes) sont mises en file ; **aucun envoi réel** (e-mail, SMS, WhatsApp). Le lien de réponse à une offre se copie à l'écran et se transmet à la main. Aucune convocation d'entretien n'est envoyée.
- Le test anti-robot (CAPTCHA) n'est pas branché : l'option « Exiger un test anti-robot » ne doit pas être activée (le formulaire resterait fermé).
- Les capacités d'une campagne ne se suppriment pas, elles se modifient. Un workflow publié est gelé.
- Les libellés des motifs de décision et la liste exacte des pièces dépendent de ce que l'établissement a configuré.
- Le rattachement des pièces acceptées au dossier de l'élève (section « Dossier permanent de l'élève », bouton « Rattacher les pièces acceptées au dossier de l'élève ») n'existe que pour un dossier « Inscrit » et exige aussi le droit de dépôt de la gestion documentaire ; non couvert en détail ici (secrétariat uniquement).
- Les écrans de la page d'accueil de la direction (tableau de bord) peuvent afficher l'entonnoir d'admission en chiffres agrégés ; ils sont traités avec la direction.

### 17.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- La spec 007 prévoit une confirmation automatique de l'inscription après paiement ; vérifié dans le code (statut « Inscrit » dérivé de la confirmation d'inscription), le délai entre paiement et changement d'étape dépend du traitement en arrière-plan (quelques secondes).
- Le rattachement des pièces à la gestion documentaire est volontairement différé et confirmé par une personne (arbitrage du 2026-10-02).
- La spec prévoit des convocations d'entretien aux familles : non branchées (aucune règle de notification livrée).
- La graine ne publie pas de texte de consentement en vigueur ni de lien public ; ce n'est pas un défaut de l'application mais une limite de la démonstration.
- L'anonymisation automatique des dossiers refusés (durée de conservation) est inactive tant que « Conservation des dossiers refusés (mois) » est vide (cas de la démonstration).
- Le journal des notifications mises en file n'a pas d'écran vérifié à l'adresse `/v2/notifications` (non trouvé dans l'arborescence des pages ; à confirmer).

---

## Chapitre 18. Pack Primaire : maternelle, primaire, compétences, conseil des maîtres, bilan annuel, examens type CEPE
> **Durée estimée :** 3 à 4 heures · **Établissement(s) :** `demo-primaire` (École primaire Les Palmiers) ; les écrans communs d'examens sont décrits ici une seule fois (la démonstration d'examens BEPC, BAC et examens blancs est au chapitre 19) · **Comptes :** instituteur `enseignant@demo-primaire.test` (classe CP1 A), instituteur de la maternelle `instituteur.maternelle@demo-primaire.test` (classe Grande Section A), `directeur@` (MFA), `secretariat@` (MFA), responsable des examens `examens@` (sans MFA), parent `parent@`

### 18.1 Objectif
Vérifier le pack Primaire : l'évaluation par compétences sans note (maternelle et primaire), la banque d'appréciations, le conseil des maîtres (l'instituteur propose, la direction décide), le bilan annuel scellé avec son PDF signé, l'archive d'année, puis les écrans d'examens avec un type CEPE fictif. Tout le chapitre repose sur des règles de DÉMONSTRATION : un bandeau « Règles de démonstration » est affiché et les documents portent le filigrane « démonstration ». Aucune règle officielle ivoirienne n'est utilisée.

### 18.2 Avant de commencer
- **Adresse de connexion** : `http://demo-primaire.localhost:3100/v2/login`. Mots de passe : fichier des comptes de démonstration (`.demo/credentials.md`).

| Rôle | E-mail | MFA | Rôle dans ce chapitre |
|---|---|---|---|
| Instituteur (CP1 A) | `enseignant@demo-primaire.test` | non | Saisit et valide les compétences, prépare le conseil, lit les bilans de sa classe. |
| Instituteur de la maternelle (Grande Section A) | `instituteur.maternelle@demo-primaire.test` (Sylvie ZOKORA) | non | Mêmes gestes pour la maternelle. |
| Directeur | `directeur@demo-primaire.test` | oui | Décide au conseil, scelle les bilans, gèle l'archive, règle le pack. |
| Secrétariat | `secretariat@demo-primaire.test` | oui | Lit l'avancement, les états et les bilans ; n'écrit rien de pédagogique. |
| Responsable des examens | `examens@demo-primaire.test` | non | Types, centres, sessions, candidats, notes ; ne publie pas. |
| Parent | `parent@demo-primaire.test` (Séka DIABATE) | non | Voit « Bulletin et compétences de mon enfant ». |

  Code MFA : `pnpm demo:totp <e-mail>`.
- **Chemins** : menu enseignant : « Ma classe », « Compétences », « Appréciations », « Conseil des maîtres ». Menu direction : « Pack Primaire » (`/v2/primary/direction`), « Conseil des maîtres », « Bilans annuels », « Archives d'année », « États du primaire ». Famille : « Bulletin et compétences de mon enfant ». Barre d'onglets « Pack Primaire » (affiche seulement ce que le rôle peut ouvrir) : « Ma classe », « Compétences », « Appréciations », « Conseil des maîtres », « Avancement », « Bilans annuels », « Archives », « États », « Paramètres », « Bulletin et compétences ».
- **URL** : `/v2/primary` (redirige selon le profil : direction vers `/v2/primary/direction`, famille vers `/v2/primary/mon-enfant`, instituteur vers `/v2/primary/classe`), `/v2/primary/classe`, `/v2/primary/competences`, `/v2/primary/appreciations`, `/v2/primary/conseil`, `/v2/primary/direction`, `/v2/primary/bilans`, `/v2/primary/archives`, `/v2/primary/etats`, `/v2/primary/parametres`, `/v2/primary/mon-enfant`. Examens : `/v2/examinations` (sessions), `/v2/examinations/sessions/<id>`, `/candidates`, `/candidates/<id>`, `/assignments`, `/centers`, `/mock`, `/results`, `/imports`, `/corrections`, `/statistics`, `/exports`, `/types`, `/family`.
- **Données de démonstration du primaire** :
  - Classe **CP1 A** (12 élèves du scénario de base : Nadia DIABATE, Salimata DIABATE, Aya BAMBA, Fatou BAMBA, Moussa COULIBALY, Salimata COULIBALY, Yao TOURE, Jean-Marc TOURE, Elie SORO, Aya SORO, Koffi N'GUESSAN, Aya N'GUESSAN) : notes et résultats de la période 1 clôturée, 8 bulletins PDF du primaire. Aucune compétence n'y est saisie.
  - Classe **Grande Section A** (code `GS-A`, maternelle) avec 5 enfants inscrits par le circuit d'admission : Aïcha ADOU, Brice ASSI, Chantal DAGO, Désiré EKRA, Estelle FOFANA. Pour cette classe, la graine a créé : un appel journalier validé (Brice ASSI absent, Chantal DAGO en retard de 10 minutes), la grille de compétences saisie et validée (échelle de démonstration : « Non acquis », « En cours d'acquisition », « Acquis », « Acquis avec aisance »), Estelle FOFANA **non évaluée** sur la compétence 2.1, des résultats par compteurs de compétences, un **conseil des maîtres tenu** (5 dossiers décidés, feuille de présence, procès-verbal PDF), et **5 bilans annuels** dont **3 scellés** (PDF signé avec filigrane « démonstration ») et **2 prêts à sceller**.
  - Décisions du conseil de la graine : Aïcha ADOU et Brice ASSI « Passage en classe supérieure » ; Estelle FOFANA « Redoublement » (justification : une compétence jamais évaluée de l'année) ; Chantal DAGO et Désiré EKRA « Passage en classe supérieure ».
  - Le référentiel de maternelle de démonstration contient « Compétence 1.1 », « Compétence 1.2 » (domaine 1) et « Compétence 2.1 » (domaine 2) ; celui du primaire « Compétence 1.1 » seule. La banque d'appréciations contient 3 phrases de démonstration (« Des difficultés persistent ; un soutien est conseillé. (phrase de démonstration) », « Le travail est satisfaisant. (phrase de démonstration) », « Appréciation de fin d'année à compléter par l'instituteur. (phrase de démonstration) »).
  - Les parents de la Grande Section n'ont pas de compte ; le parent de démonstration (Séka DIABATE) a ses enfants au CP1 : son espace « Bulletin et compétences » est vide (pas de bilan publié).
- **Examens** : la graine des examens ne crée une session que pour le **collège** (`demo-secondaire` : type EXAM_DEMO, sessions OFF-DEMO et BLANC-DEMO). **`demo-primaire` n'a ni type, ni centre, ni session d'examen** : les écrans d'examens y sont volontairement vides (ce n'est pas un défaut, voir 18.5). Le scénario C18.19 crée un CEPE fictif.
- **Période** : seule la période 1 du CP1 a été ouverte puis clôturée par la graine ; pour la Grande Section, toutes les périodes sont closes. Pour tester une **saisie** de compétences, il faut une période ouverte (voir C18.4).
- **Actions irréversibles** : valider une grille, sceller un bilan, geler l'archive, publier des résultats d'examen. À faire en dernier ; `pnpm demo:reset` remet tout à zéro.

### 18.3 Scénarios

#### C18.1 Avancement des classes (vue de la direction)
**Compte :** `directeur@demo-primaire.test` · **Où :** « Pack Primaire » (`/v2/primary/direction`)
1. Ouvrez le menu « Pack Primaire » : titre « Avancement des classes ».
2. Sélectionnez l'année (« Année en cours »). Lisez le tableau « Avancement par classe et par période » : « Classe », « Période », « État », « Élèves », « Saisies », « Validées », « Bilans scellés ».
3. Lisez la règle d'affichage (rouge : rien n'est saisi ; vert : tout est saisi et validé et les bilans existants sont scellés ; orange : le reste) et les « Accès rapides » (« Conseil des maîtres », « Bilans annuels », « Archives », « États », « Paramètres »).
**Résultat attendu :** la Grande Section A montre des saisies et des validations complètes et 3 bilans scellés sur 5 ; le CP1 A montre « Rien de saisi » pour les compétences. Le bandeau « Règles de démonstration » est visible.
- [ ] Les deux classes sont listées
- [ ] Grande Section A : validations complètes, bilans scellés « 3 sur 5 » (à lire dans la colonne)
- [ ] Bandeau « Règles de démonstration » présent

#### C18.2 Ma classe et l'appel du jour
**Compte :** `instituteur.maternelle@demo-primaire.test` · **Où :** « Ma classe » (`/v2/primary/classe`)
1. Ouvrez « Ma classe » : « Vos classes, leurs périodes et les gestes du quotidien ». La carte « Grande Section A » indique « 5 élèves » et « Titulaire ».
2. Lisez les périodes (« verrouillée » / « ouverte ») et les boutons « Appel du jour », « Compétences », « Conseil ».
3. Cliquez « Appel du jour » : « Appel du <date> ». Tout le monde est présent par défaut ; touchez un enfant pour le marquer absent (« Marquer <nom> absent »), puis « Transmettre l'appel ». Message « Appel transmis : 1 absent. ».
4. Recommencez avec le compte `enseignant@demo-primaire.test` sur la classe CP1 A.
**Résultat attendu :** l'appel du jour ne propose que les gestes permis ; après transmission, « L'appel du jour est déjà transmis : vous pouvez encore corriger un élève. » Attention : ouvrir l'appel du jour crée une séance d'appel (écriture). Si la politique d'appel de l'établissement n'autorise pas l'appel journalier pour la classe, le bouton est masqué (voir 18.5).
- [ ] Classe et effectif corrects
- [ ] Appel transmis avec compteur d'absents
- [ ] Après transmission, correction possible d'un élève (« Enregistrer les corrections »)

#### C18.3 Lire la grille de compétences (Grande Section A)
**Compte :** `instituteur.maternelle@` · **Où :** « Compétences » (`/v2/primary/competences`)
1. Choisissez la classe « Grande Section A », la période 1, le référentiel « Compétences de la maternelle (démonstration) ».
2. Lisez la grille (affichage « Fiche élève » ou « Tableau ») : niveau de maîtrise de chaque enfant par compétence.
3. Repérez Estelle FOFANA, compétence « Compétence 2.1 (démonstration) » : la case indique **« Non évaluée »** (jamais zéro ni un niveau par défaut).
4. Lisez le compteur : « Grille validée : ... compétences validées, 1 restée non évaluée. » et « 1 compétence reste « non évaluée » (ni zéro, ni niveau par défaut). »
**Résultat attendu :** la grille est en lecture seule (« La saisie est arrêtée pour cette classe et cette période : la grille est en lecture seule. »). Les compétences non saisies restent « Non évaluée ».
- [ ] La grille de Grande Section A est lisible
- [ ] Estelle FOFANA est « Non évaluée » sur la compétence 2.1 (pas de zéro)
- [ ] Les cellules validées sont marquées « Validée »

#### C18.4 Évaluer sans note, valider la grille (CP1 A)
**Compte :** `directeur@` pour ouvrir la période, puis `enseignant@demo-primaire.test` · **Où :** « Compétences »
1. Pour pouvoir saisir, la période 2 du CP1 doit être ouverte (la graine n'ouvre que la période 1, déjà close). Demandez à la direction (compte `directeur@`) de l'ouvrir dans l'écran des périodes académiques (voir le chapitre Académique). Si la période reste fermée, la grille s'affiche en lecture seule : notez-le comme limite (à confirmer).
2. Avec l'instituteur, choisissez la classe « CP1 A », la période 2, le référentiel « Compétences du primaire (démonstration) ».
3. Cliquez le niveau voulu pour quelques élèves (« Acquis », « En cours d'acquisition »...). Laissez volontairement un élève sans saisie.
4. L'enregistrement est automatique (« Enregistrement automatique ») ou via « Enregistrer » ; vérifiez le compteur « X sur Y compétences renseignées ».
5. Essayez « Tous au niveau... sauf » : choisissez un niveau et la portée « Toute la classe », « Appliquer aux compétences non saisies ».
6. **Attention : action à effet durable.** Cliquez « Valider la grille » : la fenêtre précise « Les compétences saisies seront figées » et « <n> compétence(s) reste(nt) non évaluée(s) : elle(s) le resteront. » Confirmez avec « Valider la grille ».
**Résultat attendu :** une compétence non saisie reste « Non évaluée » après validation ; elle n'est jamais convertie en zéro. Après validation, seule une révision motivée peut corriger une cellule.
- [ ] Saisie enregistrée sans note chiffrée
- [ ] L'élève non saisi reste « Non évaluée » après validation
- [ ] Le message de validation annonce combien de compétences resteront non évaluées

#### C18.5 Synthèse par compteurs
**Compte :** `instituteur.maternelle@` · **Où :** « Compétences » > « Synthèse par compteurs »
1. Sous « Élève à synthétiser », choisissez Estelle FOFANA.
2. Lisez le tableau : nombre de compétences validées par domaine et par niveau de maîtrise.
**Résultat attendu :** « Nombre de compétences validées par domaine et par niveau. Aucune moyenne ni pourcentage n'est calculé. » Estelle FOFANA a une compétence de moins comptée que ses camarades (la compétence non évaluée n'est comptée nulle part).
- [ ] Des compteurs, jamais de moyenne
- [ ] La compétence non évaluée n'est pas comptée

#### C18.6 Réviser une compétence validée (direction)
**Compte :** `directeur@` (MFA) · **Où :** « Compétences » > Grande Section A > case validée
1. Ouvrez la grille de Grande Section A (le directeur a accès à toutes les classes). Cliquez « Réviser » sur une cellule validée.
2. Dans « Réviser une compétence validée », choisissez un « Nouveau niveau », saisissez un « Motif de la révision » d'au moins 10 caractères, « Réviser ».
3. Ouvrez « Historique des révisions » de la cellule.
**Résultat attendu :** la correction est tracée (« <ancien> vers <nouveau> le <date> : <motif> »). L'instituteur ne voit pas le bouton « Réviser » (voir C18.N1).
- [ ] Révision enregistrée avec motif
- [ ] Historique des révisions visible

#### C18.7 Banque d'appréciations
**Compte :** `enseignant@demo-primaire.test` · **Où :** « Appréciations » (`/v2/primary/appreciations`)
1. Lisez la liste « Phrases de la banque » (3 phrases de démonstration, pastille « Démonstration »).
2. Filtrez par « Niveau de maîtrise » ou « Portée » (« Période », « Année », « Compétence »).
3. Cliquez « Ajouter à ma rédaction » sur une phrase : elle apparaît dans « Ma rédaction ». Modifiez, cochez « J'ai relu et je valide ce texte », « Copier le texte validé ».
**Résultat attendu :** le texte n'est enregistré nulle part ici (message « Ce texte n'est enregistré nulle part ici. L'appréciation générale s'écrit dans le module Résultats »). Pour l'instituteur, la gestion de la banque est réservée à la direction (« Vous pouvez consulter la banque ; sa gestion est réservée à la direction. »).
- [ ] Phrases affichées avec la mention « Démonstration »
- [ ] Une phrase n'est jamais appliquée seule
- [ ] Pas de bouton « Nouvelle phrase » pour l'instituteur

#### C18.8 Consulter le conseil des maîtres tenu (Grande Section A)
**Compte :** `directeur@` (puis `instituteur.maternelle@` en lecture) · **Où :** « Conseil des maîtres » (`/v2/primary/conseil`)
1. Dans « Mes conseils », repérez le conseil de la Grande Section A : « 5 dossiers · 0 à examiner · 5 décidés ».
2. Cliquez « Ouvrir » : « Feuille de présence » (titulaire Sylvie ZOKORA présente et signée ; président DIRECTEUR et secrétaire SECRETAIRE présents, non signés), message sur le quorum (« Aucun quorum bloquant : ... » ou « Quorum atteint... »).
3. Dans « Dossiers, un par un », parcourez les 5 élèves : « Proposition de la règle », « Décision du conseil » et la « Justification ».
4. Vérifiez Estelle FOFANA : décision « Redoublement » avec la justification « Une compétence jamais évaluée de l'année : maintien décidé par le conseil (démonstration). » Vérifiez Aïcha ADOU : « Passage en classe supérieure ».
5. Sous « Procès-verbal » (visible de la direction) : le message « Un procès-verbal a déjà été demandé pour ce conseil. »
**Résultat attendu :** la règle propose, le conseil confirme ; une décision qui diffère de la proposition de la règle porte une justification. Une présence signée est figée. L'instituteur voit les dossiers mais pas les boutons de décision.
- [ ] 5 dossiers, tous « Décidé »
- [ ] Feuille de présence avec une seule signature (la titulaire)
- [ ] Justification d'Estelle FOFANA affichée
- [ ] Message « procès-verbal déjà demandé » affiché

#### C18.9 Préparer un conseil : l'instituteur propose, la direction décide
**Compte :** `enseignant@demo-primaire.test` puis `directeur@` · **Où :** « Conseil des maîtres » > « Préparer un conseil »
1. Prérequis : une classe et une période sur laquelle le conseil peut se tenir. Un conseil se tient **avant la clôture** de la période : la période 2 du CP1 doit être ouverte (voir C18.4) ; sur une période déjà close (période 1 du CP1, toutes les périodes de la Grande Section), la préparation est refusée.
2. Avec l'instituteur : « Préparer un conseil », choisissez la classe CP1 A et la période 2, éventuellement « Date de la séance (facultative) », puis « Préparer le conseil ». Message « Conseil préparé : un dossier par élève a été créé. »
3. Ouvrez le conseil. Sur un dossier, sous « Ma proposition », choisissez un code, ajoutez des « Notes et observations », « Enregistrer ma proposition » ; essayez « Reporter ce dossier » puis « Remettre à l'examen ».
4. Avec `directeur@` : ouvrez le même conseil. Complétez la « Feuille de présence » (au moins un président et un secrétaire présents) et « Enregistrer la feuille de présence ».
5. Sur un dossier, section « Décision du conseil » : choisissez « Confirmer la proposition de la règle » (si la règle en propose une) ou « Retenir un autre code », puis une « Décision retenue ». Si le code diffère de la proposition de la règle, la « Justification » est **obligatoire** (longueur minimale indiquée à l'écran).
6. « Confirmer la décision » : message « Décision enregistrée : <code>. » et « Elle diffère de la proposition de la règle ; la justification est conservée. »
**Résultat attendu :** la proposition de l'instituteur ne vaut pas décision ; seule la direction confirme. Une justification trop courte est refusée (« La justification compte au moins <n> caractères. »). Si la préparation est refusée par le système, notez le message : il doit être lisible.
- [ ] Conseil préparé par l'instituteur (ou refus lisible si la période est close)
- [ ] L'instituteur enregistre une proposition, pas une décision
- [ ] La direction décide ; justification exigée en cas d'écart avec la règle
- [ ] Décision visible dans le dossier : « Décision du conseil »

#### C18.10 Procès-verbal du conseil (PDF)
**Compte :** `directeur@` · **Où :** conseil ouvert > « Procès-verbal »
1. Sur le conseil préparé en C18.9 : indiquez la « Date réelle de la séance » (obligatoire) puis « Demander le procès-verbal ». Condition : feuille de présence complète, date de séance et au moins une décision (sinon message « Complétez la feuille de présence, la date de séance et au moins une décision avant de demander le procès-verbal »).
2. Message « Procès-verbal demandé : il sera disponible dans les documents officiels. » ou « ... le document est en cours de préparation. »
3. Pour le conseil de la graine (déjà tenu) : le document existe ; cherchez-le dans « Bulletins et documents » (`/v2/reportcards`, « Bulletins émis ») : l'entrée de nature « Procès-verbal de conseil » (emplacement exact à confirmer). Ouvrez-le : le PDF porte le filigrane « démonstration ».
**Résultat attendu :** le procès-verbal est généré à partir du contenu figé de la séance (date réelle, participants, décisions, justifications) ; il est demandé une seule fois.
- [ ] Demande refusée tant que les conditions manquent
- [ ] Demande acceptée une fois complète
- [ ] PDF de démonstration avec filigrane (à confirmer à l'emplacement des documents)

#### C18.11 Bilans annuels : lecture
**Compte :** `directeur@` (puis `enseignant@` en lecture) · **Où :** « Bilans annuels » (`/v2/primary/bilans`)
1. Choisissez l'année et la classe « Grande Section A ».
2. Lisez le tableau « Bilans annuels de la classe » : « Élève », « Version », « Statut », « Décision », « Empreinte », « Règles », « Actions ».
3. Comptez : 5 bilans, **3 « Scellé »** (avec « Scellé le <date> » et une empreinte courte) et **2 « Prêt à sceller »**. Les bilans de démonstration portent la mention « Règles de démonstration ».
**Résultat attendu :** les 3 bilans scellés n'ont plus de bouton « Sceller » ; les 2 autres proposent « Sceller » (direction). Le bouton « Préparer les brouillons » et « Réémettre » dépendent du rôle.
- [ ] 5 bilans, 3 scellés, 2 prêts à sceller
- [ ] Chaque bilan a une version et une décision (issue d'inscription)
- [ ] Mention « Règles de démonstration » présente

#### C18.12 Sceller un bilan (irréversible)
**Compte :** `directeur@` (MFA) · **Où :** « Bilans annuels » > Grande Section A
1. **Attention : action irréversible.** Cliquez « Sceller » sur un bilan « Prêt à sceller » (le libellé exact du bouton est « Sceller le bilan de <nom> »).
2. Lisez la fenêtre « Sceller ce bilan » : « Le bilan devient immuable : contenu, décision et empreinte ne pourront plus changer. Une correction créera une nouvelle version. » Confirmez avec « Sceller le bilan ».
3. Message « Bilan de <nom> scellé. » ; le statut passe à « Scellé ». Le PDF signé est produit en arrière-plan (quelques secondes).
**Résultat attendu :** un seul bilan « vivant » par élève ; le bilan scellé ne change plus. Si le conseil n'a pas confirmé sa décision ou si une période n'est pas close, un message d'erreur explicite s'affiche (« La décision du conseil des maîtres doit être confirmée avant de sceller. » / « Toutes les périodes de l'année doivent être closes avec un résultat d'année définitif. »).
- [ ] Bilan scellé, statut « Scellé »
- [ ] Plus de bouton « Sceller » sur ce bilan
- [ ] Blocage lisible si les conditions manquent

#### C18.13 Réémettre un bilan scellé
**Compte :** `directeur@` · **Où :** « Bilans annuels » > bilan « Scellé » > « Réémettre »
1. Cliquez « Réémettre le bilan de <nom> », saisissez le « Motif de la réémission », « Réémettre ».
2. Message « Nouvelle version du bilan de <nom> créée : elle doit être scellée à son tour. » Le bilan passe en version 2, brouillon ; l'ancienne version est « Remplacé par une version plus récente ».
**Résultat attendu :** tant que la version 2 n'est pas scellée, la famille ne voit pas le bilan.
- [ ] Version 2 créée en brouillon, version 1 remplacée
- [ ] Un bilan scellé n'est jamais modifié sur place

#### C18.14 Vérification publique du PDF d'un bilan
**Compte :** direction pour trouver le code, puis aucun compte · **Où :** `/v2/verify`
1. Trouvez le code de vérification du document du bilan annuel d'un élève dont le bilan est scellé : documents officiels de l'établissement (`/v2/reportcards`, ouvrir le document : « Code de vérification »). L'emplacement du bilan dans cette liste est à confirmer.
2. En navigation privée, saisissez le code sur `/v2/verify`.
3. Lisez : « Nature du document » « Bilan annuel » (ou « Procès-verbal de conseil » pour un PV), « Établissement », « Émis le ».
**Résultat attendu :** « Document authentique » ; la page n'affiche ni note, ni nom, ni matricule. Les documents dérivés de règles de démonstration le signalent (document sans valeur officielle).
- [ ] Le code est trouvé et vérifié
- [ ] « Document authentique » sans donnée personnelle

#### C18.15 Archive d'année
**Compte :** `directeur@` · **Où :** « Archives d'année » (`/v2/primary/archives`)
1. Choisissez l'année. Cliquez « Préparer l'archive » : message « Archive préparée. »
2. Lisez : « Archive : En préparation » (ou « Prête à geler »), « 3 bilans scellés sur 5 », « Empreinte du manifeste » et la liste « Ce qui empêche le gel : » (bilans non scellés, PDF manquants).
3. Scellez les 2 bilans restants (C18.12), puis rouvrez l'archive : l'état passe à « Prête à geler ».
4. **Attention : action irréversible, à faire tout à la fin.** « Geler l'archive » : cochez « Je comprends que le gel est irréversible », « Geler définitivement ». Message « Archive gelée. »
**Résultat attendu :** après le gel, « Cette année est gelée : plus aucun bilan ne peut être écrit » : plus de préparation, de scellement ni de réémission pour l'année. Rien n'est déplacé ni supprimé (gel logique).
- [ ] Blocages listés tant que tous les bilans ne sont pas scellés
- [ ] Archive « Prête à geler » après scellement
- [ ] Après le gel, écritures de bilans refusées

#### C18.16 États du primaire et export
**Compte :** `directeur@` ou `secretariat@` · **Où :** « États du primaire » (`/v2/primary/etats`)
1. Choisissez un « Rapport » parmi : « Liste de classe », « Effectifs par niveau et par classe », « Registre d'appel mensuel », « Redoublants », « Couverture des compétences », « Dossier du conseil des maîtres », « Avancement des classes ».
2. Renseignez les paramètres demandés (classe, période, année, mois au format AAAA-MM, conseil) puis « Afficher l'aperçu ».
3. Cliquez « Exporter en CSV ».
**Résultat attendu :** un tableau avec les paramètres rappelés et la date de production ; un fichier CSV est téléchargé. Un rapport sans ligne indique « Ce rapport ne contient aucune ligne. »
- [ ] Aperçu affiché pour au moins deux rapports
- [ ] Export CSV téléchargé
- [ ] Message « Renseignez les paramètres obligatoires... » si un paramètre manque

#### C18.17 Paramètres du pack, échelles et référentiels
**Compte :** `directeur@` · **Où :** « Paramètres » (`/v2/primary/parametres`)
1. Titre « Paramètres du pack Primaire ». Section « Réglages de l'établissement » : « Exiger un titulaire pour activer une classe », « Exiger la décision du conseil pour sceller un bilan », « Activer la banque d'appréciations », « Durée de conservation des archives (années) » (vide : aucune purge).
2. « Échelles d'appréciation » : l'échelle de démonstration (4 niveaux, « (attendu atteint) » sur « Acquis » et « Acquis avec aisance »).
3. « Référentiels de compétences » : « Compétences de la maternelle (démonstration) » et « Compétences du primaire (démonstration) », statut « Publié », ouvrez le détail (« Afficher le détail »).
4. « Modèle de pack » : le bouton « Appliquer le modèle de pack » est sensible ; ne l'utilisez pas (la démonstration l'a déjà appliqué : message « Le modèle était déjà appliqué »).
**Résultat attendu :** un référentiel publié est immuable (« Créez une nouvelle version pour le modifier »). Une échelle utilisée par un référentiel publié est verrouillée.
- [ ] Réglages lisibles
- [ ] Référentiels publiés immuables
- [ ] Échelle de démonstration verrouillée

#### C18.18 Espace famille : bulletin et compétences
**Compte :** `parent@demo-primaire.test` · **Où :** « Bulletin et compétences de mon enfant » (`/v2/primary/mon-enfant`)
1. Ouvrez la page (si l'entrée n'est pas dans le menu, tapez l'adresse : l'entrée peut être masquée tant que le défaut P1 du rapport QA n'est pas corrigé, à reconfirmer).
2. « Choisir un enfant » : Nadia DIABATE, puis Salimata DIABATE.
**Résultat attendu :** pour ces enfants du CP1, « Aucun bilan annuel publié pour le moment. » (le bilan apparaît dès que l'établissement l'a scellé et que le PDF est émis) ; les compétences ne s'affichent que pour les périodes dont le bulletin est publié. La famille ne voit jamais les bilans de la Grande Section (dont les parents n'ont pas de compte).
- [ ] Les deux enfants du parent sont proposés
- [ ] Message d'absence de bilan lisible
- [ ] Aucune donnée d'un autre enfant

#### C18.19 Examens type CEPE : charger le type et créer un centre
**Compte :** `examens@demo-primaire.test` · **Où :** « Examens » (`/v2/examinations`) > « Types d'examens » (`/v2/examinations/types`), puis « Centres et salles »
1. Ouvrez « Examens » : la liste « Sessions d'examen » est vide (« Aucune session d'examen » ; état normal pour le primaire). Un bandeau « Règles de démonstration » apparaît sur les écrans d'examens concernés.
2. Ouvrez « Types d'examens » : « Aucun type d'examen ». Cliquez « Charger le pack du primaire (fictif) » : message « Pack chargé : 1 type(s) créé(s), 0 déjà présent(s). »
3. Ouvrez le type « CEPE (données fictives de démonstration) » (« Afficher le détail ») : 3 épreuves fictives (EP1 coefficient 1 sur 20, EP2 coefficient 2 sur 20, EP3 coefficient 1 sur 10) et une pièce à fournir « Acte de naissance (pièce fictive) ». Cliquez de nouveau sur « Charger le pack » : le type n'est pas dupliqué (« 0 type(s) créé(s), 1 déjà présent(s) »).
4. « Centres et salles » > « Nouveau centre » : « Code » `CTR1`, « Nom » `Centre de démonstration`, « Nature » « Centre propre », « Créer le centre » ; puis « Ajouter une salle » (`S1`, « Libellé » `Salle 1`, « Capacité (places) » 30).
**Résultat attendu :** type CEPE fictif présent avec ses épreuves ; un centre actif avec une salle.
- [ ] Liste de sessions vide au départ
- [ ] Pack CEPE chargé, idempotent
- [ ] Centre et salle créés

#### C18.20 Créer une session CEPE et inscrire des candidats
**Compte :** `examens@` · **Où :** « Examens » > « Nouvelle session »
1. « Nouvelle session » : « Type d'examen » CEPE, « Établissement », « Nature » « Officiel », « Code » `CEPE-2027`, « Libellé » `CEPE 2027 (démonstration)`, « Année de la session », « Créer la session ».
2. Ouvrez la session : « Parcours de la session », « Effectifs ». Message « La définition (séries et épreuves) n'est pas encore copiée depuis le type d'examen. » Cliquez « Copier et figer la définition » : « Définition copiée : 3 épreuve(s). »
3. Cliquez « Passer à : Inscriptions ouvertes ».
4. « Candidats » (`/v2/examinations/candidates`) : choisissez la session, puis « Ajouter les élèves d'une classe » (classe au choix : CP1 A pour le test) : « <n> candidat(s) ajouté(s), 0 déjà présent(s). » Cliquez de nouveau : les candidats sont « déjà présents ».
5. Sélectionnez des candidats et « Inscrire la sélection » : ils passent « Inscrit » avec un numéro de candidat.
6. Ouvrez un candidat (`/v2/examinations/candidates/<id>`) : « État civil », « Éligibilité », « Pièces du dossier », « Place attribuée », « Notes et résultat », « Historique ».
**Résultat attendu :** les candidats viennent des élèves de l'établissement. Le numéro est attribué à l'inscription et n'est jamais réutilisé après un retrait. Le niveau visé du type est CM2 et le primaire de démonstration n'a ni CM2 ni autre classe de cette sorte : le test s'effectue sur une classe existante, à titre d'essai (comportement exact à confirmer).
- [ ] Session créée, définition figée (3 épreuves)
- [ ] Passage à « Inscriptions ouvertes » réussi
- [ ] Candidats ajoutés puis inscrits avec numéro
- [ ] Ajouter deux fois la même classe n'ajoute pas de doublon

#### C18.21 Éligibilité, pièces, répartition en salle
**Compte :** `examens@` · **Où :** candidat et « Répartition » (`/v2/examinations/assignments`)
1. « Candidats » > « Évaluer l'éligibilité de tous » (ou sur un candidat « Évaluer par la règle »). Constat attendu : **aucune règle d'éligibilité n'est liée à l'examen du primaire** dans la démonstration (la liaison de règles des examens n'est posée que pour le collège) : le résultat peut être un refus lisible ou un message « aucune règle » (à confirmer). Sur un candidat, utilisez alors « Saisir à la main » (« Saisie manuelle de l'éligibilité », possible seulement sans règle liée) avec un résultat « Éligible ».
2. Sur un candidat, section « Pièces du dossier » : « acte de naissance » obligatoire ; « Joindre un document » (choisi parmi les documents de l'établissement), « Accepter » ou « Refuser » avec motif.
3. « Répartition » : choisissez la session ; « Centres de la session » : cochez `CTR1`, « Enregistrer les centres » ; « Répartir automatiquement ». Message « <n> candidat(s) placé(s), 0 déjà placé(s). »
4. « Changer » la place d'un candidat (choix d'une salle et d'un numéro de place) ; « Retirer la place ».
**Résultat attendu :** la répartition tient compte de la capacité des salles (« Capacité insuffisante : il manque <n> place(s). » si besoin). Le candidat voit « <centre>, salle <salle>, place <n> ».
- [ ] Éligibilité traitée (manuelle ou refus lisible)
- [ ] Pièce acceptée ou refusée avec motif
- [ ] Répartition automatique et changement de place

#### C18.22 Notes, résultats, corrections, statistiques, exports
**Compte :** `examens@` puis `directeur@` (MFA) · **Où :** « Notes et résultats », « Corrections », « Statistiques », « Exports et documents »
1. Avec `examens@`, faites avancer la session jusqu'à « Épreuves en cours » (bouton « Passer à : ... », en suivant les points bloquants affichés). « Notes et résultats » > onglet « Notes par épreuve » : saisissez des notes (sur 20, sur 10 pour EP3) puis « Enregistrer les notes modifiées ». Onglet « Résultats » > « Saisir un résultat » : le résultat est « communiqué par l'autorité, saisi tel quel » (aucun calcul pour un examen officiel).
2. Le bouton « Publier » d'un résultat **n'est pas visible** pour `examens@` (permission réservée à la direction).
3. Avec `directeur@` : « Publier » un résultat ; confirmez. **Attention : action irréversible** (un résultat publié ne se dépublie pas ; toute correction passe ensuite par une demande approuvée par une autre personne).
4. « Corrections » : avec `examens@`, « Nouvelle demande de correction » (note ou résultat, valeur proposée, motif d'au moins 10 caractères). Avec `directeur@`, « Approuver » ou « Rejeter ». Le demandeur ne peut pas approuver sa propre demande (« Vous ne pouvez pas approuver votre propre demande. »).
5. « Statistiques » : regroupement et comparaison ; sans règle liée : « Le taux n'est pas disponible : aucune règle n'est épinglée à la session. »
6. « Exports et documents » : format fictif de liste de candidats ou de résultats (CSV, 2 formats fictifs livrés) puis « Lancer l'export » ; « Documents » : « Émettre pour tous les candidats concernés » (convocation, attestation de réussite, relevé de notes) ; chaque document peut être « Révoqué » avec motif.
**Résultat attendu :** saisie par le responsable, publication par la direction, correction à quatre yeux ; documents scellés avec filigrane de démonstration quand les données sont fictives. Un examen blanc ne donne lieu à aucun document officiel (voir chapitre 19).
- [ ] Notes enregistrées
- [ ] « Publier » absent pour `examens@`, présent pour `directeur@`
- [ ] Correction : l'auteur ne peut pas l'approuver
- [ ] Export CSV et document émis (ou blocage lisible si la session n'est pas à la bonne étape)

#### C18.23 Espace famille : examen de l'élève
**Compte :** `parent@demo-primaire.test` · **Où :** « Examens de mes enfants » (`/v2/examinations/family`)
1. Ouvrez la page. Les enfants du parent (CP1) ne sont candidats que si vous les avez inscrits en C18.20.
**Résultat attendu :** « Aucun examen » (« Aucune inscription à un examen n'est enregistrée. ») sinon : numéro de candidat, début des épreuves, place, et « Le résultat n'est pas encore publié. » tant que la direction n'a pas publié ; jamais de note ni de moyenne ; les documents émis sont téléchargeables.
- [ ] Message d'absence d'examen ou fiche candidat cohérente
- [ ] Aucune note affichée à la famille

### 18.4 Cas limites et tests négatifs

#### C18.N1 L'instituteur ne scelle ni ne révise
**Compte :** `enseignant@demo-primaire.test` · **Où :** « Bilans annuels », « Compétences », « Archives »
1. Ouvrez « Bilans annuels » (`/v2/primary/bilans`) et « Archives » (`/v2/primary/archives`) : lecture seule.
2. Sur une grille validée, cherchez « Réviser ».
**Résultat attendu :** aucun bouton « Sceller », « Réémettre », « Préparer les brouillons », « Préparer l'archive », « Geler l'archive » ni « Réviser ». L'instituteur ne voit que sa classe.
- [ ] Aucun bouton de scellement ou de révision
- [ ] Aucune action d'archive

#### C18.N2 Pages réservées à la direction
**Compte :** `enseignant@demo-primaire.test` · **Où :** `/v2/primary/parametres`, `/v2/primary/etats`, `/v2/primary/direction`, `/v2/examinations`
**Résultat attendu :** message d'accès refusé ; les onglets correspondants sont absents de la barre « Pack Primaire ». Le secrétariat ouvre « Avancement » et « États » mais pas « Paramètres ».
- [ ] Paramètres, États, Avancement, Examens refusés à l'instituteur
- [ ] Paramètres refusés au secrétariat

#### C18.N3 Hors périmètre : classe d'un autre instituteur
**Compte :** `enseignant@demo-primaire.test` · **Où :** « Compétences » > liste des classes
**Résultat attendu :** seule la classe CP1 A est proposée (pas la Grande Section A). Une adresse d'une grille d'une autre classe répond comme si l'élément n'existait pas (« Cet élément est introuvable ou hors de votre périmètre. »).
- [ ] Une seule classe visible
- [ ] Hors périmètre : élément introuvable

#### C18.N4 Un autre établissement
**Compte :** `directeur@demo-secondaire.test` (collège) · **Où :** `/v2/primary/classe`, `/v2/primary/parametres`
**Résultat attendu :** le pack Primaire n'est pas celui du collège : accès refusé ou écran vide. En particulier, l'écran « Paramètres » du pack Primaire ouvert avec le compte propriétaire du collège ou de l'université a déclenché une erreur « Précisez l'établissement (institutionId) » dans le balayage QA : à ne pas tester hors du primaire (défaut connu).
- [ ] Aucune donnée du primaire visible depuis le collège

#### C18.N5 Justification obligatoire et saisie invalide au conseil
**Compte :** `directeur@` · **Où :** conseil préparé (C18.9)
1. Choisissez « Retenir un autre code » sans justification, puis avec une justification de 3 caractères.
**Résultat attendu :** « Choisissez la décision retenue. » puis « La justification compte au moins <n> caractères. » ; rien n'est enregistré.
- [ ] Décision refusée sans justification suffisante

#### C18.N6 Feuille de présence : signature d'un absent
**Compte :** `directeur@` · **Où :** conseil > « Feuille de présence »
1. Marquez une personne « Absent » puis essayez de cocher sa signature.
**Résultat attendu :** « Une signature exige que la personne soit marquée présente. » Une présence déjà signée est figée (« Une présence signée est figée : elle ne peut plus être modifiée. »).
- [ ] Signature d'un absent refusée
- [ ] Présence signée figée

#### C18.N7 Sceller sans conditions, rejouer un scellement
**Compte :** `directeur@` · **Où :** « Bilans annuels »
1. Essayez de sceller un bilan alors que le conseil de la classe n'a pas confirmé ses décisions ou qu'une période est ouverte (par exemple sur le CP1 A après « Préparer les brouillons »).
2. Sur un bilan déjà scellé, cherchez à le sceller à nouveau.
**Résultat attendu :** message « La décision du conseil des maîtres doit être confirmée avant de sceller. » ou « Toutes les périodes de l'année doivent être closes avec un résultat d'année définitif. » ; un bilan scellé ne propose plus « Sceller » (« Un bilan scellé ne change plus : réémettez une nouvelle version. »).
- [ ] Blocage lisible avant scellement
- [ ] Pas de double scellement

#### C18.N8 Année gelée
**Compte :** `directeur@` · **Où :** après le gel de l'archive (C18.15)
1. Essayez de préparer ou de réémettre un bilan de l'année gelée.
**Résultat attendu :** « L'année est gelée : plus aucun bilan ne peut être écrit. » (à tester en tout dernier).
- [ ] Écriture refusée sur une année gelée

#### C18.N9 Compétence non évaluée jamais convertie en zéro
**Compte :** `directeur@` · **Où :** « Compétences » > Grande Section A > Estelle FOFANA, puis « États » > « Couverture des compétences »
1. Relisez la grille et le rapport de couverture.
**Résultat attendu :** la compétence 2.1 reste « Non évaluée » partout ; ni la grille, ni la synthèse, ni le bilan ne la comptent comme zéro ou comme un niveau.
- [ ] « Non évaluée » dans la grille
- [ ] Non comptée dans la synthèse et la couverture

#### C18.N10 Examens : permissions et saisies invalides
**Compte :** `examens@` puis `enseignant@` · **Où :** « Examens »
1. Avec `examens@`, essayez d'accorder une dérogation d'éligibilité (« Accorder une dérogation ») : le bouton ne doit pas apparaître (direction seulement).
2. Importez dans « Imports » un fichier vide ou illisible : message « Le fichier est vide. » ou équivalent.
3. Avec `enseignant@`, ouvrez `/v2/examinations`.
**Résultat attendu :** pas de dérogation pour le responsable ; fichier invalide rejeté avec la nature de l'erreur ; accès refusé pour l'enseignant.
- [ ] Dérogation absente pour `examens@`
- [ ] Fichier invalide refusé
- [ ] Examens refusés à l'enseignant

### 18.5 Problèmes connus et limites
- **Sessions d'examen vides au primaire (balayage QA, « Aucune session d'examen ») : comportement attendu, pas un défaut.** La graine `scripts/seed-v2/demo/exams.ts` n'est appelée que pour le collège (`demo-secondaire`, niveau « 6E ») : type EXAM_DEMO, session officielle OFF-DEMO et examen blanc BLANC-DEMO. `demo-primaire` et `demo-superieur` n'ont aucune session ; les centres et types sont vides partout. Au primaire, le type CEPE fictif se charge par « Charger le pack du primaire (fictif) » (C18.19).
- **Aucune règle d'examen liée au primaire** : à la création d'un établissement, la liaison de la règle des examens n'est posée que pour le pack secondaire. Au primaire, l'éligibilité se saisit à la main, le taux de réussite des statistiques est indisponible, et le calcul d'un examen blanc n'est pas proposé. À confirmer.
- **Aucune session de conseil ou de saisie ouverte** : la graine clôture toutes les périodes de la Grande Section et la période 1 du CP1. Pour tester la saisie de compétences ou la préparation d'un conseil, il faut qu'une période soit ouverte (le conseil se tient avant la clôture de la période). L'ouverture des périodes se fait côté académique.
- **Menus conditionnés par une fonctionnalité** (défaut P1 du rapport QA, non corrigé) : pour les rôles autres que propriétaire et directeur, des entrées de menu (dont « Bulletin et compétences de mon enfant » et les examens de la famille) peuvent être masquées ; utilisez alors l'adresse directe. Un appel de la page Paramètres du pack Primaire sur un établissement non primaire échoue (défaut M18).
- Les référentiels, échelle et phrases sont des **données de démonstration** (bandeau « Règles de démonstration » ; filigrane « démonstration » sur les PV et bilans). Aucune règle officielle ivoirienne (barème, passage, CEPE réel) n'est livrée.
- Les bilans scellés produisent leur PDF en arrière-plan (quelques secondes). L'emplacement des PDF de bilans et de procès-verbaux dans l'interface (documents officiels, « Bulletins émis ») est à confirmer.
- Les parents de la Grande Section n'ont pas de compte : le parcours famille de la maternelle n'est pas testable sans créer un compte.

### 18.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 005 : états pour l'administration (rapport R8, colonnes configurables) non livrés ; le rapport « Effectifs » ne détaille pas sexe, âge ni financement.
- Spec 005 : la famille ne voit un bilan que « scellé ET PDF émis » (plus strict que la spec initiale).
- Spec 005 : le conseil se tient avant la clôture de la période et le bilan se scelle après la clôture de toutes les périodes ; la graine tient le conseil de la Grande Section puis clôt les périodes accélérées.
- Spec 018 : le type CEPE n'existe qu'en données fictives (3 épreuves, 1 pièce, 2 formats d'export, 1 format d'import) ; la liaison de la règle `exam-national` n'est pas posée pour le pack primaire.
- Spec 018 : une session `OFFICIAL` doit viser un niveau CM2 pour le CEPE ; la démonstration primaire n'a pas de classe CM2 (candidats de test pris dans une autre classe).
- Aucun écran dédié ne publie les PV et bilans à la famille de la maternelle sans compte parent lié.


## Chapitre 19. Pack Secondaire : vie scolaire, élèves affectés par l'État, conseil de classe, examens blancs
> **Durée estimée :** 2 h 30 à 3 h 30 (à répartir en deux séances) · **Établissement(s) :** Collège Le Baobab (démonstration), `demo-secondaire` · **Comptes :** éducateur, enseignant, directeur, directeur des études, secrétariat, économe, responsable des examens, parent

### 19.1 Objectif
Vérifier les quatre modules propres au collège : la vie scolaire (incidents, observations, mesures validées « à quatre yeux », convocations, éléments confidentiels), le suivi des élèves affectés par l'État (dossier, facture scindée, créance), le conseil de classe (propositions, décisions humaines, procès-verbal, déverrouillage) et le parcours des examens (session officielle, examen blanc).
Le fil rouge à contrôler partout est le même : **la machine propose, une personne décide**. Aucun statut d'élève, aucune décision de conseil et aucun résultat officiel ne change sans l'acte d'un humain habilité, et celui qui propose n'est jamais celui qui valide.
Les règles de calcul et les listes (types de fautes, décisions, examens) sont des **données de démonstration** : aucun texte officiel ivoirien n'est livré. Les écrans communs des examens (`/v2/examinations`) sont décrits au chapitre 18 ; ce chapitre ne couvre que le parcours secondaire.

### 19.2 Avant de commencer
- **Établissement :** `http://demo-secondaire.localhost:3100/v2/login`. Les mots de passe sont dans le fichier des comptes de démonstration (`.demo/credentials.md`). Le code MFA s'obtient avec `pnpm demo:totp <e-mail>`.
- **Comptes (tous en `@demo-secondaire.test`) :**

| Rôle | E-mail | MFA | Ce que le rôle fait dans ce chapitre |
|---|---|---|---|
| Éducateur | `educateur@` | non | Déclare des incidents, rédige des notes, **propose** des mesures, convoque les tuteurs. Ne valide rien. |
| Enseignant | `enseignant@` (Kouadio TRAORE) | non | Signale un incident, écrit une observation, **propose** au conseil de classe. Ne décide pas. |
| Directeur | `directeur@` | oui | Valide les mesures, applique l'effet sur le statut de l'élève, lit les éléments confidentiels, vérifie les dossiers d'affectation, approuve un déverrouillage. |
| Directeur des études | `etudes@` | oui | Tient la séance du conseil, enregistre les décisions, demande un déverrouillage. |
| Secrétariat | `secretariat@` | oui | Enregistre un dossier d'affectation (sans le vérifier), planifie et signe le procès-verbal. |
| Économe | `econome@` | oui | Rapproche le dossier d'affectation avec la facturation, gère les créances sur l'État. |
| Responsable des examens | `examens@` | non | Prépare sessions et examens blancs. Ne publie ni n'approuve. |
| Parent | `parent@` (Séka DIABATE) | non | Voit uniquement ses enfants Nadia et Salimata DIABATE. |

- **Chemins de menu (menu latéral du compte de gestion) :**
  - « Vie scolaire » (`/v2/schoollife`), « Mesures à valider » (`/v2/schoollife/validations`), « Convocations » (`/v2/schoollife/convocations`), « Paramètres de vie scolaire » (`/v2/schoollife/parametres`) ; « Saisie rapide » (`/v2/schoollife/saisie`), aussi accessible par le bouton « Saisie rapide » du tableau de bord ;
  - « Élèves affectés » (`/v2/stateassign`), « Vérification des affectations », « Rapprochement des affectations », « Créances sur l'État », « États des affectations », « Paramètres des affectations » ;
  - « Conseils de classe » (`/v2/councils`), « Effets des décisions », « Orientation », « Paramètres des conseils » ;
  - « Examens » (`/v2/examinations`), « Examens blancs » (`/v2/examinations/mock`), « Résultats d'examen », « Statistiques d'examen », « Exports d'examen ».
  Si une entrée manque dans le menu (voir « Problèmes connus »), tapez directement l'adresse.
- **Données de démonstration à utiliser :**
  - Élèves de la classe 6e A : Nadia et Salimata DIABATE, Aya et Fatou BAMBA, Moussa et Salimata COULIBALY, Yao et Jean-Marc TOURE, Elie et Aya SORO, Koffi et Aya N'GUESSAN.
  - Vie scolaire (types « de démonstration » : « Incident en classe », « Avertissement », « Exclusion temporaire », « Encouragement », « Observation » ; niveaux « Niveau 1 » et « Niveau 2 ») :
    - incident « Bavardage répété pendant le cours » (déclaré par l'enseignant) concernant **Salimata DIABATE** ;
    - incident « Retard à la reprise après la récréation » (déclaré par l'éducateur) concernant **Fatou BAMBA** ;
    - encouragement « Très bonne participation cette semaine » pour **Nadia DIABATE** (réservé au personnel) et observation « Besoin d'un accompagnement en lecture » pour **Aya BAMBA** ;
    - avertissement de Fatou BAMBA : proposé par l'éducateur, **validé** par la direction ;
    - exclusion temporaire de **Yao TOURE** : **proposée**, en attente de validation ;
    - exclusion temporaire de Salimata DIABATE : **validée** ; son effet sur le statut de l'élève attend un acte humain.
  - Élève affecté par l'État : **Aïcha ADOU** (première candidate inscrite par la campagne `RENTREE-6E`), dossier **`AFF-DEMO-0001`** : part de l'État 120 000 F, part de la famille 80 000 F (60 % / 40 % de 200 000 F) ; dossier **vérifié** par la direction (pas encore « activé ») ; facture scindée ; créance « Versement unique de l'État (démonstration) » de 120 000 F à 45 jours, **sans versement reçu**. Aucune passerelle réelle vers une plateforme de l'État : tout est saisi à la main.
  - Conseil de classe : « Conseil de classe de la période 2 (démonstration) » (trimestre 2), classe 6e A, **séance ouverte** (« En séance »), participants convoqués et présents (« PRESIDENT Conseil » président, « SECRETAIRE Conseil » secrétaire, enseignants de la classe), ordre du jour de la classe préparé, une proposition d'appréciation de l'enseignant sur le premier élève de la liste : « Élève sérieux et appliqué (proposition de démonstration). »
  - Examens : type « Examen de démonstration (6E) », session officielle **`OFF-DEMO`** (« Session OFF-DEMO », inscriptions ouvertes, candidats pris dans la classe, éligibilité évaluée) et session d'examen blanc **`BLANC-DEMO`** (« Session BLANC-DEMO », épreuves en cours, résultats déjà calculés par la règle de démonstration à partir de l'évaluation « Examen blanc (démonstration) »).
- **Ordre conseillé :** faites d'abord les lectures et les propositions, puis les validations, et gardez en dernier les actions marquées « Attention » (application d'un effet sur le statut d'un élève, clôture de séance). Elles ne se défont pas toutes ; `pnpm demo:reset` remet tout à zéro.

### 19.3 Scénarios

#### C19.1 Tableau de bord de la vie scolaire
**Compte :** `directeur@` (puis `educateur@`) · **Où :** « Vie scolaire » > `/v2/schoollife`
1. Connectez-vous avec le directeur et ouvrez « Vie scolaire ».
2. Lisez les cinq indicateurs : « Incidents ouverts », « Mesures à valider », « Exclusions en cours », « Convocations à tenir », « Effets en attente d'une décision ».
3. Parcourez les listes « Incidents ouverts », « Mesures proposées » et « Convocations à venir ».
4. Cliquez sur « Ouvrir le dossier » à côté d'un incident.
**Résultat attendu :** les deux incidents de démonstration sont listés ; la mesure d'exclusion de Yao TOURE apparaît dans « Mesures proposées » ; au moins un effet attend une décision humaine (celui de Salimata DIABATE). Un élément confidentiel n'apparaît qu'en « Élément confidentiel (masqué) ». Le dossier de l'élève s'ouvre sur `/v2/schoollife/eleves/<identifiant>`.
- [ ] Les indicateurs et les listes sont cohérents avec les données de démonstration ci-dessus
- [ ] Le dossier de l'élève montre une « Chronologie » (incidents, mesures, notes, convocations) et un « Historique »
- [ ] Même écran avec l'éducateur : il voit le tableau de bord mais pas d'entrée « Mesures à valider »

#### C19.2 Saisie rapide d'un incident par l'enseignant
**Compte :** `enseignant@` · **Où :** `/v2/schoollife/saisie` (menu « Saisie vie scolaire » du portail enseignant)
1. Ouvrez « Saisie rapide » : trois choix « Déclarer un incident », « Encourager un élève », « Noter une observation ».
2. Choisissez « Déclarer un incident », sélectionnez la classe « 6E-A » puis l'élève Moussa COULIBALY.
3. Renseignez le type « Incident en classe (démonstration) », la date et l'heure des faits, une description (par exemple « Test de saisie »), le rôle de l'élève « Auteur ».
4. Cliquez sur « Déclarer l'incident ».
**Résultat attendu :** le message « Incident enregistré. » s'affiche. Le déclarant est l'utilisateur connecté (pas de champ pour le choisir). Un lien « Ouvrir l'appel » rappelle que retards et absences se saisissent dans l'appel.
- [ ] « Incident enregistré. » est affiché
- [ ] Avec `directeur@`, le nouvel incident apparaît dans « Incidents ouverts »
- [ ] Les retards et absences ne se saisissent pas ici (renvoi vers l'appel)

#### C19.3 Encouragement et observation, avec choix de visibilité
**Compte :** `educateur@` · **Où :** `/v2/schoollife/saisie`
1. Choisissez « Encourager un élève », classe « 6E-A », élève Elie SORO.
2. Écrivez un texte, laissez la date du jour, ouvrez la liste « Visibilité » : « Personnel seulement », « Visible des parents », « Visible de l'élève et des parents ».
3. Choisissez « Visible des parents » (si le type le permet) puis « Enregistrer ».
4. Recommencez avec « Noter une observation » (visibilité par défaut : personnel seulement).
**Résultat attendu :** « Encouragement enregistré. » puis « Observation enregistrée. ». Si le type n'est pas partageable, l'écran l'indique (« Ce type n'est pas partageable avec les familles. »). Une note n'est jamais supprimée : elle est « retirée » avec un motif (bouton « Retirer la note » dans la chronologie du dossier).
- [ ] Les deux notes figurent dans la chronologie du dossier d'Elie SORO
- [ ] « Retirer la note » demande un motif et conserve la note dans l'historique

#### C19.4 L'éducateur propose une exclusion, il ne la valide pas
**Compte :** `educateur@` · **Où :** dossier de l'élève (`/v2/schoollife/eleves/<identifiant>`) > « Proposer une mesure »
1. Depuis le tableau de bord, ouvrez le dossier de Koffi N'GUESSAN (ou saisissez son nom via la saisie rapide pour arriver à son dossier).
2. Cliquez sur « Proposer une mesure », choisissez le type « Exclusion temporaire (démonstration) ».
3. Lisez le cadre « Circuit de ce type » : validation exigée, « Le validateur doit être une autre personne que vous. », recours possible, famille notifiée.
4. Renseignez le motif, le « Premier jour » et le « Dernier jour » (dates obligatoires pour ce type), puis « Proposer la mesure ».
**Résultat attendu :** « Mesure enregistrée. » ; la mesure est « Proposée » et n'a aucun effet. L'éducateur n'a pas de bouton pour la valider.
- [ ] La mesure apparaît « Proposée » dans la chronologie
- [ ] Sans dates, l'écran affiche « Ce type de mesure exige des dates de début et de fin. »
- [ ] L'éducateur ne voit aucune action « Valider » ni « Rejeter »

#### C19.5 La direction valide une mesure (quatre yeux)
**Compte :** `directeur@` · **Où :** « Mesures à valider » > `/v2/schoollife/validations`
1. Ouvrez « Mesures à valider ». Repérez la section « À valider » : la mesure de Yao TOURE (et celle de Koffi N'GUESSAN si vous avez fait C19.4), avec la mention « validation par une autre personne exigée ».
2. Sur la mesure de Yao TOURE, cliquez sur « Valider », ajoutez une note facultative, confirmez.
3. Sur celle de Koffi N'GUESSAN, cliquez sur « Rejeter » et saisissez un motif d'au moins 5 caractères.
**Résultat attendu :** « Mesure validée. » puis « Mesure rejetée. ». La mesure validée passe dans « Validées : à notifier ou à exécuter ». Une exclusion validée **n'applique jamais d'elle-même** la suspension : un effet apparaît dans « Effets d'exclusion en attente ».
- [ ] La mesure de Yao TOURE est « Validée » et un nouvel effet attend une décision
- [ ] La mesure rejetée porte son motif dans l'historique
- [ ] L'identité du proposant (éducateur) et celle du validateur (directeur) sont toutes deux visibles

#### C19.6 Notifier la famille, vue du parent, accusé et recours
**Compte :** `directeur@` puis `parent@` · **Où :** « Mesures à valider » ; côté parent « Vie scolaire » (`/v2/schoollife/famille`)
1. Avec le directeur, dans « Validées : à notifier ou à exécuter », cliquez sur « Notifier la famille » pour l'exclusion de **Salimata DIABATE**.
2. Déconnectez-vous, connectez-vous avec `parent@` et ouvrez « Vie scolaire » (menu du portail parent) ou `/v2/schoollife/famille`.
3. Choisissez l'enfant « Salimata DIABATE » : la décision apparaît dans le groupe « Décisions ». Cliquez sur « Déposer un recours », saisissez un motif, confirmez (« Recours déposé. »).
4. Reconnectez-vous en directeur : le recours figure dans « Recours déposés ». Cliquez sur « Maintenir la mesure » (ou « Annuler la mesure ») avec une motivation.
5. Choisissez l'enfant « Nadia DIABATE » côté parent.
**Résultat attendu :** avant la notification, la famille ne voit rien de la décision. Après, elle voit la décision, jamais l'incident brut ni un élément confidentiel. Le recours place la mesure « En recours » ; la décision de la direction est tracée (« Recours tranché. »). L'encouragement de Nadia (« Personnel seulement ») n'est **pas** visible du parent.
- [ ] La famille ne voit la décision qu'après « Notifier la famille »
- [ ] « Recours déposé. » puis « Recours tranché. » sont affichés aux bons comptes
- [ ] L'encouragement réservé au personnel n'apparaît pas côté parent
- [ ] « Aucun enfant n'est rattaché à votre compte. » n'apparaît pas (le parent a deux enfants)

#### C19.7 L'effet sur le statut de l'élève est appliqué par un humain
**Compte :** `directeur@` · **Où :** « Mesures à valider » > « Effets d'exclusion en attente »
**Attention : l'application d'un nouveau statut modifie le dossier de l'élève ; une suspension se lève ensuite par un autre acte humain. Faites ce scénario en dernier et de préférence sur l'élève Yao TOURE (pas sur les enfants du compte parent).**
1. Dans « Effets d'exclusion en attente », repérez la « Demande de changement de statut de l'élève » de Yao TOURE (issue de C19.5).
2. Cliquez sur « Appliquer ». Lisez : « Le statut de l'élève sera modifié dans son dossier, sous votre responsabilité. »
3. Choisissez « Nouveau statut de l'élève » : « Suspendu » ou « Exclu » ; confirmez.
4. Sur l'effet de Salimata DIABATE, essayez plutôt « Écarter » avec un motif : l'élève conserve son statut.
**Résultat attendu :** « Statut de l'élève modifié. » (ou « Effet écarté. »). Avant cet acte l'élève reste actif ; aucune tâche automatique ne change son statut.
- [ ] Avant l'acte humain, le statut de l'élève n'avait pas changé
- [ ] Après « Appliquer », le dossier élève (menu « Personnes ») affiche le nouveau statut
- [ ] « Écarter » conserve le statut de l'élève et l'effet disparaît de la liste

#### C19.8 Convocation des tuteurs
**Compte :** `educateur@` (puis `parent@`) · **Où :** « Convocations » > `/v2/schoollife/convocations`
1. Cliquez sur « Nouvelle convocation » (titre « Convoquer les tuteurs ») : choisissez l'élève Salimata DIABATE, la nature (« Discipline », « Absences », « Résultats scolaires », « Santé », « Autre motif »), un motif, la date et l'heure de l'entretien, le lieu. Validez par « Créer la convocation » (« Convocation créée. »).
2. Dans la liste, cliquez sur « Envoyer », choisissez les canaux (Application, E-mail, SMS, WhatsApp, Notification push) puis « Envoyer ».
3. Connectez-vous avec `parent@` : la convocation figure dans « Vie scolaire » (groupe « Convocations »). Cliquez sur « Accuser réception ».
4. Revenez à l'éducateur : cliquez sur « Entretien tenu » (compte rendu facultatif), ou testez « Absent », « Reporter » (un nouveau brouillon est créé), « Annuler » (motif obligatoire).
**Résultat attendu :** « Convocation envoyée. », puis côté parent « Accusé de réception enregistré. », puis « Entretien enregistré comme tenu. ». Le message envoyé par e-mail ou SMS **ne contient jamais le motif** ; en démonstration aucun envoi réel n'a lieu (notifications simulées).
- [ ] La convocation passe de brouillon à « Envoyée », puis « Accusée », puis « Tenue »
- [ ] Le motif n'est visible dans le portail qu'une fois la convocation envoyée
- [ ] « Reporter » crée un nouveau brouillon qui référence l'ancienne convocation

#### C19.9 Éléments confidentiels
**Compte :** `educateur@` (déclare), `directeur@` (lit), `etudes@` (ne lit pas) · **Où :** dossier de l'élève
1. Avec l'éducateur, déclarez un incident pour Jean-Marc TOURE avec la « Confidentialité » réglée sur « Confidentiel » (le champ est dans le formulaire, avec l'aide « Jamais inférieure à celle du type ; elle ne s'abaisse plus ensuite. »).
2. Avec le directeur, ouvrez le dossier de l'élève : l'élément porte le badge « Confidentiel » et le texte « Élément confidentiel : le contenu est masqué. ». Cliquez sur « Lire (motif exigé) » et saisissez un motif.
3. Fermez la fenêtre « Contenu confidentiel » (le contenu n'est pas conservé sur l'appareil).
4. Avec le directeur des études, ouvrez le même dossier.
**Résultat attendu :** la lecture est journalisée au nom du directeur avec son motif. Le directeur des études et l'éducateur ne voient pas le contenu : leur niveau d'accès affiché est « Standard » (« Les éléments restreints et confidentiels ne vous sont pas montrés. »). Les familles ne voient jamais un élément confidentiel.
- [ ] Le contenu n'est lisible qu'après saisie d'un motif
- [ ] Le directeur des études ne voit ni le contenu ni le bouton « Lire (motif exigé) »
- [ ] Le bandeau « Votre niveau d'accès » reflète bien le rôle connecté

#### C19.10 Paramètres, barèmes et note de conduite
**Compte :** `directeur@` · **Où :** « Paramètres de vie scolaire » > `/v2/schoollife/parametres`
1. Lisez le message « Aucune valeur n'est fournie par défaut » : types d'événements, gravités et barèmes sont des données de l'établissement.
2. Dans « Types d'événements », repérez les cinq types marqués « Démonstration » et leurs mentions (validation exigée, quatre yeux, recours possible, famille notifiée, dates exigées).
3. Dans « Barèmes de points de conduite », constatez « Aucun barème. » Ne créez rien si vous ne souhaitez pas modifier la démonstration.
4. Ouvrez le dossier de Nadia DIABATE : section « Points de conduite ».
**Résultat attendu :** « Aucun barème actif ne s'applique à cet élève. » Les points de conduite sont désactivés par défaut. Le solde, quand il existe, n'est qu'une **aide** : la note de conduite du bulletin reste une saisie humaine, jamais calculée. Décision du 2026-10-02 : tant que la conduite n'est pas notée, le résultat du semestre reste « en attente ».
- [ ] Les types « Démonstration » sont signalés comme tels
- [ ] Aucun barème n'existe à l'arrivée
- [ ] L'écran de conduite ne propose aucune note automatique

#### C19.11 Dossier d'élève affecté par l'État (lecture)
**Compte :** `secretariat@` (puis `directeur@`) · **Où :** « Élèves affectés » > `/v2/stateassign`
1. Ouvrez la liste « Dossiers d'affectation » et cherchez la référence « AFF-DEMO-0001 ».
2. Lisez la ligne : élève Aïcha ADOU, statut « Vérifié », « Part de l'État (acte) » 120 000 F, « Part de la famille (acte) » 80 000 F, rapprochement.
3. Ouvrez le dossier : « Dossier AFF-DEMO-0001 (version 1) ». Lisez l'encadré « Parts de l'État et de la famille » (colonnes Déclaré, Facturé, Écart) et le message sur l'inscription.
4. Dépliez « Versions et historique ».
**Résultat attendu :** l'inscription porte la référence d'affectation (« L'inscription porte la référence d'affectation de ce dossier »). La source est « Saisie ». Le dossier n'est pas « Actif » : il attend l'activation. L'historique montre la création et la vérification.
- [ ] Le dossier est « Vérifié » et la référence figure sur l'inscription
- [ ] Les montants déclarés sont 120 000 F (État) et 80 000 F (famille)
- [ ] L'historique des événements est lisible

#### C19.12 Séparation des tâches : enregistrer, vérifier, activer
**Compte :** `secretariat@` puis `directeur@` · **Où :** « Vérification des affectations » > `/v2/stateassign/verification`
1. Avec le secrétariat, « Enregistrer un dossier » : choisissez un autre élève (par exemple Moussa COULIBALY) et son inscription, saisissez une référence fictive (ex. « AFF-TEST-0002 »), la date de l'acte (AAAA-MM-JJ), des montants entiers de francs. Cliquez sur « Enregistrer le dossier ».
2. Ouvrez ce dossier avec le secrétariat : vous ne pouvez pas le vérifier vous-même.
3. Avec le directeur, ouvrez « Vérification des affectations » : le dossier est dans « À vérifier ». Cliquez sur « Examiner » puis « Vérifier le dossier ».
4. Dans « Vérifiés, à activer », ouvrez le dossier de Aïcha ADOU et cliquez sur « Activer ».
**Résultat attendu :** le nouveau dossier reste « Enregistré » jusqu'à la vérification par une autre personne ; après « Vérifier », la référence est portée sur l'inscription (« Dossier vérifié : la référence d'affectation est portée sur l'inscription. »). « Dossier activé. » pour AFF-DEMO-0001.
- [ ] Le secrétariat ne peut pas vérifier son propre dossier
- [ ] Le directeur peut vérifier et activer
- [ ] Une référence déjà utilisée est refusée

#### C19.13 Facture scindée famille / État
**Compte :** `econome@` · **Où :** `/v2/finance/invoices` (chapitre Finance), recherche « Aïcha ADOU »
1. Filtrez les factures sur l'apprenant « Aïcha ADOU ».
2. Ouvrez la facture de scolarité de la famille, puis la facture liée de l'État.
3. Lisez les messages « Part de la famille : une facture liée existe pour la part du financeur. » et « Part prise en charge par le financeur « État (démonstration) » : payable séparément de la part de la famille. ».
**Résultat attendu :** deux factures de scolarité : 80 000 F à la charge de la famille, 120 000 F à la charge de l'État ; la somme fait 200 000 F, sans perte.
- [ ] Les deux parts sont séparées et leur total est 200 000 F
- [ ] La facture de l'État est payable séparément

#### C19.14 Créance sur l'État, versement et rapprochement
**Compte :** `econome@` · **Où :** « Créances sur l'État » > `/v2/stateassign/receivables`, puis `/v2/finance/payments/new`, puis « Rapprochement des affectations » > `/v2/stateassign/reconciliation`
1. Ouvrez « Créances sur l'État » : l'échéance « Versement unique de l'État (démonstration) » (120 000 F attendus, 0 reçu) est « À recevoir ».
2. Allez dans `/v2/finance/payments/new` (« Encaisser un paiement ») : choisissez l'apprenant Aïcha ADOU, montant 120 000, mode « Virement » (évitez les espèces : elles exigent une session de caisse), dans « Qui paie ? » choisissez l'État (à confirmer pour le libellé exact) et saisissez « AFF-DEMO-0001 » comme référence du financeur. « Vérifier et encaisser », puis « Confirmer l'encaissement ».
3. Revenez à « Créances sur l'État » : l'échéance doit passer à « Reçu » (le montant reçu est rapproché des paiements enregistrés).
4. Ouvrez « Rapprochement des affectations » : le dossier est « Conforme » ou « Écart » (calculé avec la tolérance de l'établissement, zéro par défaut). Cliquez sur « Rapprocher » (« Dossier AFF-DEMO-0001 rapproché. »).
**Résultat attendu :** le statut de la créance et du rapprochement est **calculé**, jamais saisi. Le versement de l'État est un paiement ordinaire de financeur ; aucun échange avec une plateforme de l'État n'existe.
- [ ] L'échéance passe à « Reçu » après l'enregistrement du versement
- [ ] Le rapprochement affiche « Conforme » une fois les parts facturées conformes à l'acte
- [ ] Aucun appel externe (aucune passerelle) n'est déclenché

#### C19.15 États et export pour l'administration
**Compte :** `econome@` (ou `secretariat@`) · **Où :** « États des affectations » > `/v2/stateassign/reports`
1. Lisez le tableau de bord : dossiers par statut, total déclaré État et familles, créances (Attendu, Reçu, Reste à recevoir, En retard).
2. Dans « Exports », choisissez le « Jeu de données » (Dossiers d'affectation, Créances sur l'État, Contrôles) et le « Format » (« Format neutre (toutes les colonnes) »), puis « Télécharger le CSV ».
3. Lisez le message « Passerelle vers la plateforme publique » : « Aucune passerelle n'est configurée ».
**Résultat attendu :** un fichier CSV est téléchargé (« Fichier téléchargé : N ligne(s). »). Les montants sont des entiers de francs. La mention d'absence de passerelle est affichée.
- [ ] Le CSV s'ouvre correctement dans un tableur
- [ ] La mention « Aucune passerelle n'est configurée » est présente

#### C19.16 Conseil de classe : calendrier et séance ouverte
**Compte :** `etudes@` · **Où :** « Conseils de classe » > `/v2/councils`
1. Ouvrez « Calendrier des conseils de classe » : repérez « Conseil de classe de la période 2 (démonstration) », statut « En séance », classe 6e A. Lisez la « Synthèse de la classe ».
2. Ouvrez la séance (« Dossier de classe ») : bandeau « Règles de démonstration — non réglementaires », « État de la séance » (« Quorum atteint » ou « aucun minimum défini »), tableau « Participants et présence », tableau « Ordre du jour par élève ».
3. Lisez les sous-onglets « Dossier de classe », « Délibération », « Procès-verbal », « Historique ».
**Résultat attendu :** les participants sont présents (Président, Secrétaire, enseignants) ; l'ordre du jour contient les élèves de la classe avec leurs « Faits » figés (version et empreinte). Si l'écran signale « Résultats manquants » pour la période 2, c'est normal : seules les notes de la période ont été publiées, pas les résultats.
- [ ] La séance est « En séance » avec la présence saisie
- [ ] Le bandeau « Règles de démonstration » est visible
- [ ] Chaque élève de l'ordre du jour a une ligne avec le statut « À examiner »

#### C19.17 L'enseignant propose, il ne décide pas
**Compte :** `enseignant@` puis `etudes@` · **Où :** `/v2/councils` > séance > fiche de l'élève
1. Avec l'enseignant (menu « Conseils de classe »), ouvrez la séance de sa classe puis la fiche d'un élève de l'ordre du jour.
2. Cliquez sur « Ajouter une proposition » : nature « Appréciation » (ou « Remarque »), texte libre, « Ajouter » (« Proposition ajoutée. »).
3. Vérifiez qu'il n'existe aucun formulaire « Enregistrer une décision » pour ce compte.
4. Avec le directeur des études, sur la même fiche, trouvez la proposition (« Proposée par Kouadio TRAORE ») et cliquez sur « Accepter » (« Proposition acceptée. »). Testez « Refuser » avec une note sur une autre proposition.
**Résultat attendu :** l'enseignant ajoute des propositions mais ne voit ni « Accepter » ni « Enregistrer la décision ». Le directeur des études tranche.
- [ ] La proposition de démonstration « Élève sérieux et appliqué » est visible sur le premier élève
- [ ] L'enseignant ne peut ni accepter ni décider
- [ ] Le directeur des études peut accepter et refuser

#### C19.18 Décision humaine du conseil
**Compte :** `etudes@` · **Où :** séance > « Passer en mode séance » (« Délibération », un élève à la fois)
1. Cliquez sur « Passer en mode séance » ; naviguez avec « Élève suivant » / « Élève précédent » ou « Aller à un élève ».
2. Sur un élève, lisez « Suggestions des règles » (s'il y en a) : « Ces suggestions viennent du jeu de règles : ce ne sont pas des décisions. Seul le conseil décide. »
3. Dans « Enregistrer une décision » : choisissez un « Type de décision » (par exemple « Avis requis du conseil »), le « Décideur présent » (« PRESIDENT Conseil »), le « Mode de décision » (Consensus, Vote, Voix prépondérante du président), puis « Enregistrer la décision ».
4. Choisissez une décision qui exige une justification (ex. « Autre décision ») : laissez la justification vide et validez.
**Résultat attendu :** « Décision enregistrée. » pour la première. La seconde est refusée avec « La justification est obligatoire pour cette décision. ». Les types « Passage », « Redoublement » et « Orientation » portent sur l'année entière : ils ne se prennent pas dans un conseil de période (à confirmer pour leur présence dans la liste).
- [ ] La décision est enregistrée au nom du décideur présent choisi
- [ ] Une justification manquante bloque l'enregistrement quand elle est exigée
- [ ] Les suggestions sont clairement distinguées des décisions

#### C19.19 Clôture, procès-verbal PDF et signature
**Compte :** `etudes@`, `secretariat@` · **Où :** séance > « Clore la séance », puis sous-onglet « Procès-verbal » (`/v2/councils/<identifiant>/pv`)
**Attention : après la clôture, les décisions ne se modifient plus sans déverrouillage motivé (C19.20).**
1. Avec le directeur des études, cliquez sur « Clore la séance » puis « Clore » (« Séance close. »).
2. Avec le secrétariat ou le directeur des études, ouvrez « Procès-verbal » et cliquez sur « Générer le procès-verbal » (« Procès-verbal généré (version 1). »).
3. Attendez l'état « PDF prêt » (« Le rendu du PDF est en cours. » peut rester quelques instants), puis « Préparer le téléchargement » et « Télécharger le PDF ».
4. Dans « Signatures », lisez « Signataires manquants » (Président, Secrétaire) puis cliquez sur « Signer électroniquement ».
**Résultat attendu :** le PDF porte la mention de démonstration. En démonstration, les signataires attendus sont les fiches fictives « PRESIDENT Conseil » et « SECRETAIRE Conseil », qui ne sont liées à aucun compte : la signature électronique est attendue **refusée** avec un message du type « Votre compte n'est lié à aucune fiche du personnel… » ou « Vous n'êtes pas un signataire exigé… » (à confirmer). Le procès-verbal reste « Généré » et la séance « Clos ». La signature papier exige la référence d'une pièce déjà déposée dans le stockage : non réalisable sans préparation.
- [ ] « Séance close. » et statut « Clos » dans le calendrier
- [ ] Le PDF du procès-verbal se télécharge et mentionne « démonstration »
- [ ] Le refus de signature est compréhensible et ne casse pas l'écran
- [ ] Les effets des décisions ne démarrent qu'à la signature (réglage par défaut) : « Effets des décisions » reste vide

#### C19.20 Déverrouillage demandé puis approuvé par une autre personne
**Compte :** `etudes@` (demande), `directeur@` (approuve) · **Où :** séance close > sous-onglet « Procès-verbal » ou « Historique » > « Déverrouillage motivé »
1. Avec le directeur des études, cliquez sur « Demander le déverrouillage », saisissez un motif d'**au moins 20 caractères**, puis « Envoyer la demande » (« Demande de déverrouillage envoyée. »).
2. Essayez d'« Approuver » avec ce même compte : l'approbation doit être refusée (séparation des tâches).
3. Connectez-vous avec `directeur@` : la demande est « Demandée » ; cliquez sur « Approuver » (« Demande approuvée. »).
4. Cliquez sur « Rouvrir la séance » puis confirmez (« Séance rouverte. »).
**Résultat attendu :** la séance repasse « En séance » ; le compteur « Rouvert 1 fois » apparaît ; le procès-verbal précédent sera remplacé par la version suivante à la prochaine clôture. Le journal de séance contient « Déverrouillage demandé », « Déverrouillage approuvé », « Séance rouverte ».
- [ ] L'approbation par le demandeur est refusée
- [ ] L'approbation par la direction fonctionne et la séance se rouvre
- [ ] Le journal de séance trace les trois étapes

#### C19.21 Effets des décisions, orientation et paramètres (lecture)
**Compte :** `directeur@` · **Où :** « Effets des décisions » (`/v2/councils/effets`), « Orientation » (`/v2/councils/orientation`), « Paramètres des conseils » (`/v2/councils/parametres`)
1. « Effets des décisions » : lisez la file (statuts « En attente », « À appliquer par un humain », « Appliqué », « En échec », filtres Statut et Nature).
2. « Orientation » : lisez « Parcours autorisés » (« Aucun parcours défini » : le modèle livre un jeu vide), « Dossiers d'orientation », « Transferts de série ».
3. « Paramètres des conseils » : lisez les sept rôles de participants (Président du conseil, Secrétaire de séance, Professeur principal, Enseignant de la classe, Éducateur / vie scolaire, Délégué des élèves, Délégué des parents), les deux types de conseil (« Conseil de classe de période », « Conseil de classe de fin d'année »), les sept types de décision et les réglages (déverrouillage par une autre personne : oui ; effets : « À la signature du procès-verbal » ; visibilité famille : « Après notification » ; ouverture sans quorum avec motif : autorisée).
**Résultat attendu :** aucune valeur réglementaire n'est imposée ; le quorum minimal est vide (aucun contrôle). Une décision d'exclusion crée un effet « Demande de changement de statut de l'élève » qui reste « À appliquer par un humain ». Variante : dans « Paramètres des conseils », le réglage « Déclenchement des effets » sur « À la clôture de la séance » fait naître les effets dès la clôture (modifie la démonstration : à remettre en état ensuite).
- [ ] Les réglages affichent les valeurs de démonstration listées
- [ ] L'orientation ne propose aucun parcours livré
- [ ] Aucun effet d'exclusion ne s'applique sans un clic humain

#### C19.22 Vue famille et élève du conseil
**Compte :** `parent@` (puis `eleve@`) · **Où :** « Décisions du conseil » > `/v2/councils/famille` (élève : `/v2/councils/moi`)
1. Ouvrez la page et choisissez l'enfant Nadia DIABATE.
**Résultat attendu :** « Aucune décision à afficher » : la visibilité est « Après notification », et rien n'a été notifié. Le parent ne voit jamais les suggestions des règles, les justifications internes ni les votes.
- [ ] Aucune décision n'est visible tant que rien n'est notifié
- [ ] La page ne montre aucun autre élève que Nadia et Salimata

#### C19.23 Examens : sessions officielle et blanche
**Compte :** `examens@` · **Où :** « Examens » > `/v2/examinations`
1. Dans « Sessions d'examen », repérez « Session OFF-DEMO » (nature « Officiel », « Inscriptions ouvertes », badge « Démonstration ») et « Session BLANC-DEMO » (nature « Examen blanc », « Épreuves en cours »).
2. Ouvrez « Session OFF-DEMO » : lisez « Effectifs » (Candidats, Inscrits, Éligibles…), « Épreuves » (« EP1 », « Épreuve 1 (démonstration) », coefficient 1, barème 20), « Définition figée le … ».
3. Ouvrez « Types d'examens » (`/v2/examinations/types`).
**Résultat attendu :** le seul type est « Examen de démonstration (6E) » (badge « Démonstration »). **Aucun BEPC ni BAC n'est livré** : le mécanisme existe, les paramètres sont vides ; le bandeau « Règles de démonstration » rappelle qu'aucune valeur n'est officielle.
- [ ] Les deux sessions sont présentes avec les bonnes natures et états
- [ ] Aucun type BEPC ou BAC n'existe
- [ ] Le bandeau « Règles de démonstration » est affiché

#### C19.24 Examen blanc calculé par la règle de démonstration
**Compte :** `examens@` · **Où :** « Examens blancs » > `/v2/examinations/mock`
1. Choisissez la session « Session BLANC-DEMO ». Lisez le message « Un examen blanc n'est jamais un résultat officiel… ».
2. Dans « Évaluations liées », lisez la ligne « EP1 ← évaluation … » (l'évaluation « Examen blanc (démonstration) »).
3. Cliquez sur « Reprendre les notes des évaluations » (« N note(s) reprise(s), N inchangée(s)… »), puis « Calculer par la règle » (« N résultat(s) calculé(s)… »).
4. Lisez « Règle …, version … » et « Le calcul a utilisé des règles de démonstration. »
5. Ouvrez « Notes et résultats » (`/v2/examinations/results`) pour cette session.
**Résultat attendu :** les résultats sont marqués « Calculé par règle (examen blanc) » avec la version de règle tracée. Les notes importées sont uniquement des notes **publiées**. Relancer le calcul ne change rien (même résultat, aucun doublon).
- [ ] Les notes sont reprises depuis l'évaluation publiée (aucune saisie manuelle)
- [ ] Le calcul affiche la règle, sa version et la mention de démonstration
- [ ] Un deuxième calcul donne le même résultat

#### C19.25 Aucun document officiel pour un examen blanc
**Compte :** `examens@` · **Où :** « Exports d'examen » > `/v2/examinations/exports`
1. Choisissez la session « Session BLANC-DEMO » dans la liste « Session d'examen ».
2. Lisez la section « Documents ».
3. Choisissez ensuite « Session OFF-DEMO ». **N'émettez aucun document et ne publiez aucun résultat** (la publication relève de la direction et ne se défait pas).
**Résultat attendu :** pour l'examen blanc : « Un examen blanc ne donne lieu à aucun document officiel. » Aucune convocation ni attestation ne peut être émise.
- [ ] Le message d'absence de document officiel est affiché pour le blanc
- [ ] Aucun bouton d'émission n'est utilisable pour l'examen blanc

#### C19.26 Examen vu par la famille
**Compte :** `parent@` · **Où :** « Examens de mes enfants » > `/v2/examinations/family`
1. Ouvrez la page et choisissez l'enfant.
**Résultat attendu :** l'inscription éventuelle, la place et les documents publiés sont lus en lecture seule ; « Le résultat n'est pas encore publié. » tant que rien n'est publié. Un examen blanc ne produit aucun document. Si aucune inscription n'est affichée pour Nadia ou Salimata, l'écran affiche « Aucun examen » (à confirmer selon les inscriptions de la graine).
- [ ] Aucune donnée d'un autre enfant n'apparaît

### 19.4 Cas limites et tests négatifs

#### C19.N1 L'éducateur n'accède pas aux validations
**Compte :** `educateur@`
1. Tapez `/v2/schoollife/validations` dans la barre d'adresse.
**Résultat attendu :** page « Accès refusé » (« Vous n'avez pas les droits nécessaires pour afficher cette page. »). Même résultat pour `/v2/schoollife/parametres`.
- [ ] « Accès refusé » s'affiche pour les validations et les paramètres

#### C19.N2 Le validateur ne peut pas être le proposant
**Compte :** `directeur@`
1. Dans le dossier de Jean-Marc TOURE, cliquez sur « Proposer une mesure » (type « Exclusion temporaire », motif, dates), puis « Proposer la mesure ».
2. Dans « Mesures à valider », tentez de la valider avec le même compte.
**Résultat attendu :** la validation est refusée par un message d'erreur : le validateur doit être une autre personne (quatre yeux). Faites valider par un autre compte de direction si besoin ; sinon rejetez la mesure.
- [ ] La validation par le proposant est refusée

#### C19.N3 Le secrétariat ne vérifie pas son propre dossier ; l'économe n'enregistre pas
**Compte :** `secretariat@`, `econome@`
1. Avec le secrétariat, ouvrez un dossier que vous venez d'enregistrer : aucune action « Vérifier le dossier » (message « Vous ne pouvez pas vérifier un dossier que vous avez vous-même enregistré »).
2. Avec l'économe, ouvrez `/v2/stateassign` : aucun bouton « Enregistrer un dossier ». Ouvrez `/v2/stateassign/verification`.
**Résultat attendu :** le secrétariat enregistre sans vérifier ; l'économe rapproche et gère les créances sans enregistrer ni vérifier. L'accès à « Vérification des affectations » est refusé (« Accès refusé »).
- [ ] Aucun compte ne peut vérifier son propre dossier
- [ ] L'économe n'a pas les droits de vérification

#### C19.N4 L'enseignant ne décide pas en conseil et ne voit pas les finances
**Compte :** `enseignant@`
1. Ouvrez `/v2/councils/parametres`, `/v2/councils/effets`, `/v2/stateassign` et `/v2/finance`.
**Résultat attendu :** « Accès refusé » pour chacun. Dans une séance de sa classe, aucun bouton « Enregistrer la décision », « Clore la séance » ni « Générer le procès-verbal ».
- [ ] Les quatre pages sont refusées
- [ ] Aucune action de décision ni de clôture n'est visible

#### C19.N5 Le parent ne voit que ses enfants et pas le détail de l'affectation
**Compte :** `parent@`
1. Ouvrez « Affectation de mon enfant » (`/v2/stateassign/family`).
2. Ouvrez `/v2/schoollife` et `/v2/stateassign` (pages de gestion).
**Résultat attendu :** « Aucun dossier d'affectation pour cet enfant. » pour Nadia et Salimata (le dossier de démonstration concerne Aïcha ADOU, sans compte parent). Quand un dossier existe, la famille voit **seulement le statut** (« Le dossier a été vérifié par l'établissement. »), jamais les montants de l'État ni les contrôles. Les pages de gestion sont refusées.
- [ ] Aucun montant de l'État n'est visible côté parent
- [ ] Les pages de gestion sont refusées

#### C19.N6 Saisies invalides
**Compte :** `secretariat@`, `etudes@`
1. Dossier d'affectation : saisissez un montant « 12,5 » ou négatif, une date « 02/10/2026 ».
2. Conseil : « Demander le déverrouillage » avec un motif de 5 caractères.
3. Convocation : date de report vide.
**Résultat attendu :** messages de champ clairs (« Saisissez un nombre entier de francs (sans décimale ni signe). », « Date invalide (AAAA-MM-JJ). », motif trop court, « Choisissez une date. »). Rien n'est enregistré.
- [ ] Chaque saisie invalide affiche un message en français, sans perte de la saisie

#### C19.N7 Double action
**Compte :** `directeur@`
1. Validez une mesure, puis rouvrez l'écran dans un second onglet et essayez de la valider à nouveau.
2. Rapprochez deux fois le même dossier d'affectation.
**Résultat attendu :** la seconde validation est refusée (la mesure n'est plus « Proposée ») ; deux rapprochements successifs donnent le même état sans doublon.
- [ ] Aucune action ne s'applique deux fois

#### C19.N8 Isolation entre établissements
**Compte :** `directeur@demo-secondaire.test`
1. Dans la barre d'adresse, remplacez `demo-secondaire` par `demo-primaire` puis ouvrez `/v2/schoollife`.
**Résultat attendu :** la session du collège n'ouvre pas l'école primaire (reconnexion demandée, à confirmer) ; les modules « Vie scolaire », « Conseils de classe », « Élèves affectés » ne font pas partie du pack Primaire : ces entrées n'apparaissent pas au primaire.
- [ ] Aucune donnée du collège n'est visible depuis l'école primaire

### 19.5 Problèmes connus et limites
- **Signature du procès-verbal** : les signataires de la démonstration sont deux fiches fictives sans compte lié. La signature électronique est donc refusée pour les comptes de démonstration, et la signature papier exige une pièce déjà déposée. Conséquence : les effets des décisions (déclenchés « à la signature ») ne démarrent pas sans modifier le réglage « Déclenchement des effets ». À confirmer par un essai.
- **Menus réduits (défaut QA, rapport du 2026-10-03)** : pour les rôles autres que propriétaire et directeur, deux lectures échouaient avec un message d'accès refusé sur chaque page, ce qui masquait les entrées de menu conditionnées par une fonctionnalité. Le code a été corrigé (nouvel accès à la liste des fonctionnalités) ; à reconfirmer après redémarrage de la démonstration. En cas de menu incomplet, utilisez les adresses directes.
- **Entrée de menu enseignant/éducateur** : « Saisie rapide » est rattachée au portail enseignant ; l'éducateur y accède par le bouton du tableau de bord ou par l'adresse.
- **Examens :** la publication des résultats et l'émission de documents officiels sont à la direction ; ne les lancez pas sur la session `OFF-DEMO` si vous voulez garder la démonstration intacte. Les écrans communs des examens sont au chapitre 18.
- **Aucun envoi réel** : convocations et notifications sont simulées. **Aucune passerelle de l'État.**
- **Règles de démonstration** : bandeau « règles de démonstration » sur les conseils, filigrane « démonstration » sur les documents. BEPC, BAC, règles de passage et barèmes de conduite ne sont pas livrés (mécanisme + paramètres vides).
- **Conduite non notée** : décision du 2026-10-02, le semestre reste « en attente » tant que la conduite manque ; la note n'est jamais calculée automatiquement. Dans la démonstration, le jeu de règles lié n'exige pas de conduite (à confirmer à l'écran des résultats).
- **Vue élève/parent** : la vie scolaire n'est pas disponible hors ligne (voir chapitre 22).

### 19.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 006 AC12.5 : la saisie d'une observation ou d'un incident « conçue pour le hors-ligne » n'a pas d'implémentation côté web (aucune file hors ligne dans `apps/web/src/app/v2/schoollife`).
- Spec 006 AC8.8 : le rappel de convocation avant l'échéance est un job éteint par défaut (`remind-convocations`) ; la consommation par `attendance` de `schoollife.measure.validated` attend la question Q6-19.
- Spec 006 AC10.8 : passerelle de l'État non disponible (adaptateur « non configuré ») : attendu, spécification officielle inconnue.
- Les signataires du procès-verbal de démonstration ne sont rattachés à aucun compte : la signature n'est pas démontrable sans préparation supplémentaire.
- Orientation : aucun parcours livré (`orientationPaths` vide) ; la création d'un dossier d'orientation et d'un transfert de série n'a pas été éprouvée dans ces scénarios.

---

## Chapitre 20. Portails parent, élève et enseignant
> **Durée estimée :** 1 h 30 à 2 h 15 · **Établissement(s) :** Collège Le Baobab (`demo-secondaire`) ; instituteur : École Les Palmiers (`demo-primaire`) · **Comptes :** parent, élève, enseignant, instituteur

### 20.1 Objectif
Vérifier que chaque famille et chaque professeur dispose d'un espace simple, et surtout que **chacun ne voit que ses propres données** : le parent ne voit que ses enfants, l'élève que lui-même, l'enseignant que ses classes. Contrôler aussi la coque commune des portails (barre du haut, menu, fil d'Ariane) et les écrans de lecture : résultats, bulletins, emploi du temps, absences, scolarité avec paiement en mode SANDBOX (fictif).

### 20.2 Avant de commencer
- **Comptes :**

| Portail | E-mail | Établissement | MFA | Atterrissage |
|---|---|---|---|---|
| Parent (Séka DIABATE, enfants Nadia et Salimata DIABATE) | `parent@demo-secondaire.test` | `http://demo-secondaire.localhost:3100/v2/login` | non | `/v2/parent` |
| Élève (Nadia DIABATE) | `eleve@demo-secondaire.test` | idem | non | `/v2/student` |
| Enseignant (Kouadio TRAORE) | `enseignant@demo-secondaire.test` | idem | non | `/v2/teacher` |
| Instituteur du CP1 | `enseignant@demo-primaire.test` | `http://demo-primaire.localhost:3100/v2/login` | non | `/v2/primary` |
| Institutrice de maternelle | `instituteur.maternelle@demo-primaire.test` | idem | non | `/v2/primary` |

  Mots de passe : fichier des comptes de démonstration (`.demo/credentials.md`).
- **La coque du portail** est la même pour les trois espaces : la barre du haut affiche le nom de l'établissement et « Espace parent », « Espace élève » ou « Espace enseignant » ; le menu latéral (tiroir sur téléphone, bouton « Ouvrir le menu ») liste uniquement les entrées autorisées ; un fil d'Ariane (« Espace parent > … ») ; le bouton « Mon compte » (identité, « Rôle actif », « Sécurité du compte », « Mes sessions », « Mes notifications ») et le bouton « Se déconnecter ». Il n'existe **aucun sélecteur de langue ni de thème** dans cette coque (français uniquement ; le thème sombre est le thème par défaut).
- **Menu du portail parent :** « Mes enfants », puis (selon les droits de l'offre) « Vie scolaire », « Décisions du conseil », « Affectation de mon enfant », « Examens de mes enfants », « Messages », « Annonces », « Paramètres du compte ».
- **Menu du portail élève :** « Mon dossier », « Mes résultats », « Mes bulletins », « Mon emploi du temps », « Évaluations à venir », « Mes absences », « Ma scolarité », « Mes documents », « Ma vie scolaire », « Décisions du conseil », « Mon examen », « Messages », « Annonces », « Mon profil ».
- **Menu du portail enseignant :** « Aujourd'hui », « Mes classes », « Mes évaluations », « Mes appels », « Mon emploi du temps », « Saisie vie scolaire », « Conseils de classe », « Mes bulletins de paie », « Mes congés et ma présence », « Messages », « Annonces », « Mon profil ».
- **Données de démonstration :** notes de la période 1 publiées et résultats de la période 1 calculés avec le jeu de règles de démonstration ; 9 bulletins PDF signés et publiés (dont ceux de Nadia et Salimata) ; scolarité de Nadia soldée par virement, celle de Salimata réglée en partie par mobile money ; une classe 6e A.
- **Pour les tests négatifs**, il vous faut l'identifiant (le long code dans l'adresse) d'un élève d'une autre famille, par exemple Aya BAMBA : connectez-vous avec `secretariat@demo-secondaire.test`, ouvrez « Élèves » (`/v2/students`), cliquez sur Aya BAMBA et copiez le code qui suit `/v2/students/` dans la barre d'adresse.

### 20.3 Scénarios

#### C20.1 Parent : accueil et sélecteur d'enfant
**Compte :** `parent@` · **Où :** `/v2/parent` (« Mes enfants »)
1. Connectez-vous : vous arrivez sur « Mes enfants ».
2. Lisez les deux cartes (Nadia DIABATE, Salimata DIABATE, classe, aperçu) puis cliquez sur « Ouvrir » pour Nadia.
3. Sur la page de l'enfant, lisez la rangée d'onglets « Sections de l'enfant » : « Tableau de bord », « Résultats », « Bulletins », « Absences », « Emploi du temps », « Évaluations à venir », « Scolarité », « Documents », « Dossier et contacts ».
4. Utilisez la liste « Enfant » pour passer à Salimata (la section reste la même).
**Résultat attendu :** deux enfants, jamais un troisième. Le tableau de bord montre « Dernière moyenne publiée », « Absences », « Scolarité restante », « Prochaines séances » et « Annonces » ; une zone indisponible affiche « Information indisponible pour le moment. » sans casser la page.
- [ ] Seuls Nadia et Salimata DIABATE sont listés
- [ ] Le sélecteur « Enfant » change d'enfant en gardant la section
- [ ] Le tableau de bord se charge sans page d'erreur

#### C20.2 Parent : résultats et bulletins
**Compte :** `parent@` · **Où :** `/v2/parent/children/<identifiant>/results` et `/reportcards`
1. Ouvrez « Résultats de Nadia DIABATE » : « Résultats officiels » de la période 1 (Moyenne, Rang « N sur M », Mention, « Validé »), puis « Détail par matière » (Matière, Note, Coef.).
2. Dans « Notes des évaluations », filtrez par « Période » ou « Toutes les périodes ».
3. Ouvrez « Bulletins » : bulletin de la période 1, avec « Télécharger le PDF » et « Vérifier l'authenticité » (code de vérification et QR).
4. Téléchargez le PDF et ouvrez le lien « Ouvrir la page de vérification » (`/v2/verify`).
**Résultat attendu :** seules les notes publiées sont visibles (« Une absence ou une dispense n'est jamais comptée comme un zéro. »). Le PDF porte le filigrane « démonstration » ; la page de vérification confirme l'authenticité sans afficher de donnée personnelle.
- [ ] Les résultats officiels de la période 1 s'affichent avec leur rang
- [ ] Le PDF se télécharge, mention « démonstration » visible
- [ ] La page de vérification confirme le bulletin

#### C20.3 Parent : emploi du temps, évaluations à venir, absences
**Compte :** `parent@` · **Où :** onglets « Emploi du temps », « Évaluations à venir », « Absences »
1. Dans « Emploi du temps » : « Vue semaine » / « Vue jour », « Semaine précédente » / « Semaine suivante », « Afficher les séances annulées ».
2. « Évaluations à venir » : lisez la liste (ou « Aucune évaluation planifiée. »).
3. « Absences » : lisez le récapitulatif (absences, retards, à justifier).
**Résultat attendu :** des séances dans la semaine (ou « Aucune séance cette semaine. » selon la date) ; la page signale que « les devoirs à rendre ne sont pas encore disponibles dans cet espace ».
- [ ] La navigation de semaine fonctionne
- [ ] La page des absences s'affiche sans erreur, même sans absence

#### C20.4 Parent : scolarité et paiement en ligne SANDBOX
**Compte :** `parent@` · **Où :** onglet « Scolarité » (`/v2/parent/children/<identifiant>/finance`)
1. Pour Nadia, lisez « Situation » (Facturé, Avoirs, Payé, Reste à payer), « Factures », « Paiements », « Reçus » ; ouvrez un reçu (« Reçu de paiement », « Télécharger le PDF », « Imprimer »).
2. Pour Salimata (solde restant d'après la graine), cliquez sur « Payer en ligne » : choisissez la « Facture à payer », saisissez un « Montant (F CFA) » entier (par exemple 20 000), choisissez le « Moyen de paiement » (fournisseur de démonstration « sandbox » : libellé à confirmer), saisissez un numéro fictif dans « Numéro de téléphone du payeur » (par exemple +225 07 00 00 00 00), cliquez sur « Payer ».
3. Observez « Suivi du paiement » : « Paiement confirmé. Votre reçu est disponible ci-dessous. »
4. Refaites avec un montant se terminant par **001** (ex. 5 001) : le suivi reste « En attente de confirmation par l'opérateur » (bouton « Vérifier maintenant »). Refaites avec **013** (ex. 5 013) : « Le paiement a échoué ».
**Résultat attendu :** aucun argent réel n'est engagé ; les règles du fournisseur de démonstration sont déterministes (001 reste en attente, 013 échoue, le reste réussit). Le montant ne peut pas dépasser le reste dû de la facture.
- [ ] Un paiement réussi produit un reçu
- [ ] Le montant en « 001 » reste en attente et celui en « 013 » échoue
- [ ] Un montant supérieur au reste dû est refusé

#### C20.5 Parent : documents, dossier et contact d'urgence, compte
**Compte :** `parent@` · **Où :** onglets « Documents », « Dossier et contacts » ; `/v2/parent/account`
1. « Documents » : bulletins publiés, reçus de paiement, éventuels diplômes (supérieur seulement).
2. « Dossier et contacts » : lisez « Dossier » (classe, date de naissance, numéro d'inscription, responsables), puis « Contacts d'urgence » ; si un contact existe, « Modifier » son téléphone et « Enregistrer » (« Contact mis à jour. »).
3. « Paramètres du compte » (menu) : identité (en lecture seule), « Mes coordonnées » (laissez un champ vide pour ne rien modifier), liens « Mot de passe et double authentification », « Mes sessions ».
**Résultat attendu :** l'identité n'est pas modifiable (« contactez le secrétariat ») ; seules les coordonnées le sont. « Coordonnées enregistrées. » après enregistrement, ou « Aucune modification à enregistrer. ».
- [ ] L'identité est en lecture seule
- [ ] La modification d'un contact est confirmée par un message

#### C20.6 Élève : « Mon dossier », résultats et emploi du temps
**Compte :** `eleve@` · **Où :** `/v2/student` et sous-pages
1. « Mon dossier » : matricule, classe, numéro d'inscription, date de naissance, « Mes inscriptions ».
2. « Mes résultats », « Mes bulletins » (téléchargement PDF), « Mon emploi du temps », « Évaluations à venir », « Mes absences ».
3. « Ma scolarité » (`/v2/student/finance`) et « Mes documents ».
4. « Mon profil » (`/v2/student/profile`) : identité en lecture seule, « Mes coordonnées » modifiables. L'écran `/v2/student/me` (« Mon dossier » détaillé, avec « Mettre à jour mes coordonnées ») est atteignable par adresse.
**Résultat attendu :** uniquement les données de Nadia DIABATE. Aucune mention d'un autre élève, aucun rang ou note de camarade.
- [ ] Toutes les pages ne montrent que Nadia DIABATE
- [ ] Les bulletins se téléchargent
- [ ] Les coordonnées se modifient, l'identité non

#### C20.7 Élève : vie scolaire, conseil et examen
**Compte :** `eleve@` · **Où :** « Ma vie scolaire » (`/v2/schoollife/moi`), « Décisions du conseil » (`/v2/councils/moi`), « Mon examen » (`/v2/examinations/family`)
1. Ouvrez chaque page.
**Résultat attendu :** rien n'est affiché qui n'ait été notifié ou partagé (« Rien à afficher pour le moment. », « Aucune décision à afficher »). L'élève peut déposer un recours contre une mesure qui le concerne si elle a été notifiée.
- [ ] Aucun élément réservé au personnel n'est visible
- [ ] Aucune page ne montre d'autres élèves

#### C20.8 Enseignant : « Aujourd'hui » et « Mes classes »
**Compte :** `enseignant@` · **Où :** `/v2/teacher`, `/v2/teacher/classes`
1. « Aujourd'hui » : séances du jour avec « Appel à faire », « Faire l'appel », « Saisir les notes » (ou « Aucune séance aujourd'hui. »).
2. « Mes classes » : carte de la classe 6e A avec ses matières, « Élèves », « Évaluations », « Faire l'appel ».
3. Ouvrez « Élèves » : tableau « Élèves de 6E-A » (Élève, Matricule, Statut).
**Résultat attendu :** seule la classe affectée à l'enseignant est visible. Le menu « Mes appels » propose uniquement le type d'appel autorisé pour le cycle (en secondaire : appel par séance).
- [ ] Une seule classe est listée, avec ses élèves
- [ ] Le compte n'a aucun menu de finance ni de paramètres

#### C20.9 Enseignant : évaluations, appel, emploi du temps
**Compte :** `enseignant@` · **Où :** « Mes évaluations » (`/v2/teacher/assessments`), « Mes appels » (`/v2/teacher/attendance`), « Mon emploi du temps » (`/v2/teacher/schedule`)
1. « Mes évaluations » : filtrez par classe ; ouvrez une évaluation publiée : feuille de notes en lecture seule (« Notes publiées : elles ne se modifient plus. »).
2. Cliquez sur « Nouvelle évaluation » : choisissez un type, un intitulé, une date, un barème ; vérifiez que la période demandée est acceptée ou refusée avec un message clair.
3. « Mes appels » : « Mes séances à faire » ; ouvrez une séance (« Faire l'appel »), laissez « Tout le monde est présent par défaut », touchez un élève pour le marquer absent, « Soumettre l'appel ».
4. « Mon emploi du temps » : « Vue semaine » et bouton « Exporter le calendrier » (`/v2/teacher/schedule/export`).
**Résultat attendu :** « Appel soumis : 1 absent, aucun retard. » L'enseignant ne voit ni « Valider » ni « Publier » sur une évaluation : la validation est à la direction.
- [ ] L'appel est soumis avec le décompte des absents
- [ ] L'enseignant ne peut pas publier des notes
- [ ] L'export du calendrier se télécharge

#### C20.10 Enseignant : bulletins de paie, congés et profil
**Compte :** `enseignant@` · **Où :** « Mes bulletins de paie », « Mes congés et ma présence », « Mon profil »
1. « Mes bulletins de paie » : liste (la graine ne crée pas de paie : liste vide attendue, à confirmer).
2. « Mes congés et ma présence » : « Demander un congé » (type, premier et dernier jour, motif) puis « Envoyer la demande » (« Demande de congé envoyée. »).
3. « Mon profil » : fonction, date d'embauche, « Mes affectations », « Mes coordonnées ».
**Résultat attendu :** le congé est « Demandé » (décision par la direction des études). Si un bulletin existait, un bouton « Contester ce bulletin » demanderait un motif.
- [ ] La demande de congé est envoyée
- [ ] Le profil affiche les affectations de l'enseignant

#### C20.11 Instituteur du primaire
**Compte :** `enseignant@demo-primaire.test` (CP1 A) et `instituteur.maternelle@demo-primaire.test` (Grande Section A) · **Où :** `http://demo-primaire.localhost:3100/v2/login`
1. Connectez-vous : l'atterrissage est `/v2/primary` ; le menu ajoute « Ma classe (primaire) » et « Conseil des maîtres ».
2. Ouvrez « Mes appels » : l'appel est **journalier** (« Appel du jour »), non par séance.
**Résultat attendu :** le parcours pédagogique du primaire est traité au chapitre 18 (pack Primaire) ; ici on contrôle seulement la coque de portail et l'appel journalier.
- [ ] Le menu comporte « Ma classe (primaire) » et « Conseil des maîtres »
- [ ] L'appel est proposé une seule fois par jour pour la classe

### 20.4 Cas limites et tests négatifs

#### C20.N1 Un parent ne voit pas les enfants des autres tuteurs
**Compte :** `parent@`
1. Remplacez dans l'adresse l'identifiant de l'enfant par celui d'Aya BAMBA : `/v2/parent/children/<identifiant d'Aya BAMBA>`.
2. Essayez aussi `/v2/parent/children/<identifiant d'Aya BAMBA>/results` et `/finance`.
3. Essayez enfin une adresse mal formée : `/v2/parent/children/abc`.
**Résultat attendu :** pour l'identifiant bien formé d'un autre enfant : message d'avertissement « Cet enfant n'est pas rattaché à votre compte (ou le lien a pris fin). Aucune information ne peut être affichée. » et bouton « Retour à mes enfants » ; **aucune donnée** de l'enfant ne s'affiche et aucune lecture n'est lancée. Pour l'adresse mal formée : « page introuvable ». Les modules répondent de plus par un refus uniforme côté serveur (la page se comporte comme si l'élément n'existait pas).
- [ ] Aucune note, aucun nom, aucune facture d'un autre enfant n'apparaît
- [ ] Le message « Cet enfant n'est pas rattaché à votre compte… » est affiché
- [ ] L'adresse mal formée donne « page introuvable »
- [ ] Le sélecteur « Enfant » ne propose que Nadia et Salimata

#### C20.N2 Un parent ne lit pas le reçu d'un autre
**Compte :** `parent@`
1. Ouvrez `/v2/parent/children/<identifiant de Nadia>/finance/receipts/<identifiant d'un autre reçu>` (reçu copié depuis le compte économe, `/v2/finance/receipts`).
**Résultat attendu :** aucun reçu étranger ne s'affiche (message « introuvable » ou refus). Une adresse mal formée donne « page introuvable ».
- [ ] Aucun reçu d'une autre famille n'est lisible

#### C20.N3 L'élève ne voit pas les notes des autres
**Compte :** `eleve@`
1. Ouvrez « Mes résultats » puis cherchez un classement ou la note d'un camarade.
2. Essayez `/v2/parent`, `/v2/teacher`, `/v2/finance`, `/v2/attendance` dans la barre d'adresse.
3. Essayez `/v2/student/finance/receipts/<identifiant d'un reçu d'un autre élève>`.
**Résultat attendu :** seuls le rang et la moyenne propres à Nadia sont visibles. Les pages parent, enseignant, finance et présence répondent « Accès refusé ». Le reçu d'un autre élève n'est pas lisible (à confirmer : message exact).
- [ ] Aucune note de camarade n'est visible
- [ ] Les quatre adresses de gestion sont refusées

#### C20.N4 L'enseignant ne voit pas une classe qui n'est pas la sienne
**Compte :** `enseignant@demo-primaire.test`
1. Avec `directeur@demo-primaire.test`, ouvrez `/v2/academic/classrooms`, cliquez sur « Grande Section A » et copiez l'identifiant dans l'adresse.
2. Avec l'instituteur du CP1, ouvrez `/v2/teacher/classes/<identifiant de Grande Section A>`.
**Résultat attendu :** « Cette classe ne fait pas partie de vos classes. Aucune information ne peut être affichée. » avec le lien « Retour à mes classes » ; aucun nom d'élève.
- [ ] Aucun élève de l'autre classe n'est affiché
- [ ] Le message d'avertissement est affiché

#### C20.N5 Les portails ne se croisent pas
**Compte :** `parent@`, `enseignant@`
1. Avec le parent, ouvrez `/v2/teacher` ; avec l'enseignant, ouvrez `/v2/parent`.
**Résultat attendu :** « Accès refusé » (« Vous n'avez pas les droits nécessaires pour afficher cette page. »).
- [ ] Chaque portail refuse l'autre

#### C20.N6 Isolation entre établissements et session
**Compte :** `parent@demo-secondaire.test`
1. Remplacez `demo-secondaire` par `demo-primaire` dans l'adresse et ouvrez `/v2/parent`.
2. Cliquez sur « Se déconnecter », puis utilisez le bouton « Précédent » du navigateur.
**Résultat attendu :** le parent du collège ne voit pas l'école primaire (reconnexion demandée, à confirmer) ; après déconnexion, le bouton « Précédent » ne ré-affiche aucune donnée privée (retour à la connexion).
- [ ] Aucune donnée n'est visible après déconnexion

### 20.5 Problèmes connus et limites
- **Menus réduits (rapport QA du 2026-10-03)** : sur la démonstration lancée avant la correction, le menu rendu du parent n'avait que 5 liens et celui de l'enseignant 10 : deux lectures de l'offre et du profil de l'établissement échouaient (message d'accès refusé) pour tout rôle autre que propriétaire et directeur. Effets visibles : nom de l'établissement remplacé par « EcoleDigitale » dans la barre du haut et entrées « Vie scolaire », « Décisions du conseil », « Affectation de mon enfant », « Examens… » (parent) ou « Saisie vie scolaire », « Conseils de classe », « Mes congés… » (enseignant) absentes. Le code lit désormais la liste des fonctionnalités par un accès ouvert à tous les membres ; **à reconfirmer après redémarrage**. En cas d'absence, tapez l'adresse.
- **Compte sans profil lié** : l'accès à `/v2/student` ou `/v2/attendance/me` avec un compte (par exemple propriétaire) sans fiche élève ou personnel peut provoquer une réponse « non authentifié » au lieu d'un refus (défaut QA, à corriger côté serveur) ; ne testez pas ces écrans avec le propriétaire.
- **Écran d'appel** : non parcouru par le balayage automatique (il ouvre une séance) ; l'appel journalier est refusé pour le secondaire (message sur la politique d'appel) : utilisez l'appel par séance.
- **Bulletins de paie** : aucune paie n'est créée par la démonstration.
- **Devoirs à rendre** : non disponibles (seules les évaluations planifiées sont annoncées).
- **Langue et thème** : aucun sélecteur ; thème sombre par défaut.
- **Paiement** : fournisseur SANDBOX uniquement.

### 20.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 006 AC12.4 demande « 404 jamais 403 » hors lien pour les lectures du tuteur : le serveur répond de façon uniforme, mais l'écran parent affiche un message d'avertissement (« Cet enfant n'est pas rattaché… ») pour un identifiant bien formé, et la page introuvable seulement pour un identifiant mal formé.
- Les entrées de menu « harmonisation des href » des portails figurent encore dans le reste à faire (docs/ETAT_IMPLEMENTATION.md).
- Pas d'écran de choix de langue ni de thème dans les portails (non prévu à ce stade).

---

## Chapitre 21. Accessibilité et mobile
> **Durée estimée :** 2 h à 3 h (par écran prioritaire : 15 à 20 minutes) · **Établissement(s) :** n'importe lequel (`demo-secondaire` recommandé) · **Comptes :** direction, enseignant, parent, élève (selon l'écran testé)

### 21.1 Objectif
Contrôler à la main ce que les outils automatiques ne savent pas vérifier : parcours au clavier seul, annonces d'un lecteur d'écran, lisibilité à 200 % et à 320 pixels de large, contraste réel et thème sombre, taille des zones tactiles, tableaux sur téléphone. Les contrôles automatiques (0 violation grave sur 1 127 écrans testés au 2026-10-02) ne couvrent qu'environ un tiers des critères d'accessibilité : **le passage lecteur d'écran et le reflow à 320 px restent à valider par une personne** (docs/ETAT_IMPLEMENTATION.md, rubrique « Validations visuelles et manuelles »).

### 21.2 Avant de commencer
- **Matériel :** un ordinateur avec navigateur Chrome ou Edge (outils de développement F12), idéalement un second navigateur (Firefox) ; pour le lecteur d'écran : **NVDA** (Windows, gratuit) ou **VoiceOver** (Mac, iPhone) ; un smartphone réel si possible.
- **Écrans prioritaires** (liste du document `apps/web/docs/accessibility.md`) : connexion (`/v2/login`), coque et menu, liste avec filtres et pagination, formulaire avec erreurs, boîte de confirmation, saisie de notes, appel (aussi hors ligne), bulletins, portails parent / élève / enseignant, pages publiques `/v2/apply/<établissement>` (par exemple `/v2/apply/demo-secondaire`) et `/v2/verify`.
- **Composants réels à connaître** (`apps/web/src/platform/ui/`) :
  - la coque (`Shell`) : lien d'évitement « Aller au contenu », zone de contenu `main` qui reçoit le focus à chaque changement de page, menu latéral devenant tiroir sous la largeur d'un ordinateur (bouton « Ouvrir le menu », fermeture par Échap qui rend le focus au bouton) ;
  - les tableaux (`DataTable`) : légende, en-têtes de colonne, tri annoncé, région défilante atteignable au clavier, pagination ;
  - les champs (`FormField`) : libellé, aide, mention « obligatoire », message d'erreur annoncé ;
  - les boîtes de dialogue (`ModalDialog`) : focus piégé à l'intérieur, Échap ferme, le focus revient au déclencheur ;
  - la liste de recherche (`SelectAsync`), l'assistant par étapes (`Wizard`), les états de chargement et d'erreur (`states`).
- **Thème :** le thème par défaut est **sombre**. Il n'y a pas de bouton de thème dans la coque ; pour tester le thème clair, utilisez la préférence du système ou les outils de développement (émulation « prefers-color-scheme ») (à confirmer).
- **Préparez** une copie de la table de contrôle (§ 21.7) pour chaque écran testé.

### 21.3 Scénarios

#### C21.1 Clavier seul : ordre du focus, lien d'évitement, dialogues
**Compte :** `directeur@demo-secondaire.test` (puis `enseignant@`) · **Où :** `/v2/direction`, `/v2/students`, `/v2/schoollife/validations`
1. Débranchez la souris ou ne l'utilisez plus. Rechargez la page.
2. Appuyez une fois sur **Tab** : un lien « Aller au contenu » doit apparaître en haut à gauche. Appuyez sur **Entrée** : le focus saute dans le contenu principal.
3. Continuez avec **Tab** et **Maj + Tab** : l'ordre suit la lecture (barre du haut, menu, contenu), sans piège ; le focus est toujours visible (contour ou anneau), y compris en thème sombre.
4. Ouvrez une boîte de dialogue (par exemple « Valider » une mesure dans « Mesures à valider ») : le focus entre dans la boîte, **Tab** reste à l'intérieur, **Échap** ferme, le focus revient sur le bouton d'origine.
5. Changez de page par le menu : le focus doit arriver sur le contenu de la nouvelle page (le lecteur d'écran annonce la page).
6. Sur un tableau : atteignez la zone défilante au clavier, triez une colonne avec **Entrée**, changez de page avec « Suivant ».
**Résultat attendu :** tout est faisable au clavier ; aucun piège ; aucun élément cliquable inaccessible.
- [ ] Le lien « Aller au contenu » apparaît au premier Tab et déplace le focus
- [ ] L'ordre du focus est logique et le focus toujours visible
- [ ] Les dialogues piègent, ferment (Échap) et rendent le focus
- [ ] Le tri et la pagination des tableaux fonctionnent au clavier

#### C21.2 Menu sur mobile et au clavier
**Compte :** `parent@demo-secondaire.test` · **Où :** n'importe quelle page du portail
1. Réduisez la fenêtre sous la largeur d'une tablette (ou activez le mode appareil dans F12).
2. Atteignez au clavier le bouton « Ouvrir le menu » (il annonce son état ouvert/fermé), ouvrez-le avec **Entrée**.
3. Le premier lien du menu reçoit le focus ; naviguez, puis **Échap** : le menu se ferme et le focus revient au bouton.
4. Fermé, le menu ne doit plus être atteignable par **Tab**.
**Résultat attendu :** le tiroir se comporte comme un dialogue : ouverture, fermeture et retour de focus corrects.
- [ ] Le bouton « Ouvrir le menu » annonce son état (ouvert/fermé)
- [ ] Échap ferme le menu et rend le focus au bouton
- [ ] Menu fermé = non atteignable au clavier

#### C21.3 Lecteur d'écran : titres, champs, erreurs, annonces
**Compte :** `directeur@` · **Où :** « Paramètres de vie scolaire », formulaire « Nouveau niveau de gravité », « Mesures à valider »
1. Lancez NVDA (ou VoiceOver). Ouvrez la page : le titre de la page est lu et le titre de niveau 1 est unique ; la hiérarchie des titres ne saute pas de niveau.
2. Dans un formulaire, parcourez les champs : chaque champ est lu avec son libellé, son aide, « obligatoire » si besoin.
3. Soumettez le formulaire vide : le message d'erreur est annoncé **une seule fois**, rattaché au champ concerné, et le champ est signalé comme invalide.
4. Déclenchez une action (« Valider », « Enregistrer ») : le succès (« Mesure validée. ») est annoncé sans déplacer le focus de façon surprenante.
5. Dans un tableau : les en-têtes de colonne sont lus avec chaque cellule ; le tri est annoncé (« croissant » / « décroissant »). Les badges d'état (« Validée », « En recours ») sont lus en texte.
6. Dans l'appel (rôle enseignant) : le changement d'un élève « présent / absent » et l'indicateur réseau sont annoncés poliment, sans répétition.
**Résultat attendu :** aucune information n'est transmise par la couleur seule ; les annonces sont compréhensibles et non répétées.
- [ ] Un seul titre principal par page, hiérarchie correcte
- [ ] Libellés, aides et erreurs de champ lus correctement
- [ ] Succès et erreurs de l'application annoncés
- [ ] Tableaux : en-têtes et tri annoncés
- [ ] Pages publiques (`/v2/apply/...`, `/v2/verify`) : consentement lu, résultat de vérification annoncé

#### C21.4 Zoom à 200 % et reflow à 320 px
**Compte :** `parent@`, `enseignant@` · **Où :** `/v2/parent`, `/v2/teacher/assessments`, page de connexion
1. Réglez le zoom du navigateur sur **200 %** (Ctrl et +) : le contenu reste lisible et utilisable, sans zone coupée.
2. Ouvrez F12 > mode appareil, largeur **320 px** : aucune barre de défilement horizontale pour la **page** (seuls les tableaux peuvent défiler à l'intérieur de leur cadre).
3. Augmentez l'espacement du texte (extension ou réglage du navigateur) : aucun texte tronqué qui bloque l'usage.
4. Testez portrait puis paysage.
**Résultat attendu :** aucun contenu perdu ni caché ; pas de défilement horizontal de la page.
- [ ] 200 % : rien n'est coupé ni superposé
- [ ] 320 px : aucun défilement horizontal de la page
- [ ] Espacement du texte augmenté : lecture possible
- [ ] Portrait et paysage utilisables

#### C21.5 Contraste et thème sombre / clair
**Compte :** `directeur@`, `parent@` · **Où :** tableau de bord, formulaires, boutons « Supprimer »/« Rejeter », messages d'erreur
1. Parcourez trois écrans en thème sombre (par défaut) : texte, bordures, boutons, badges d'état.
2. Passez au thème clair (préférence du système) et recommencez.
3. Vérifiez avec une extension de contrôle de contraste (WebAIM ou axe DevTools) les textes d'erreur, les badges et les boutons désactivés ; le rapport minimal est **4,5 : 1** pour le texte courant.
4. Vérifiez le nom et la couleur de marque de l'établissement (barre du haut) : le texte reste lisible.
**Résultat attendu :** textes lisibles dans les deux thèmes ; la page « Accès refusé » est lisible en thème sombre (défaut corrigé). Les jetons globaux sont contrôlés automatiquement, pas les couleurs en dur ni les états survol, focus, désactivé : c'est ce que vous vérifiez ici.
- [ ] Thème sombre lisible (texte, bordures, badges)
- [ ] Thème clair lisible
- [ ] Textes d'erreur et boutons désactivés à 4,5 : 1 au moins
- [ ] Aucune information portée par la couleur seule

#### C21.6 Cibles tactiles sur téléphone
**Compte :** `enseignant@` · **Où :** « Mes appels », « Mes évaluations »
1. Sur un vrai téléphone (ou le mode appareil), ouvrez l'appel d'une séance.
2. Touchez les lignes d'élèves, les boutons « Soumettre l'appel », « Synchroniser », la fermeture des boîtes de dialogue, l'efface-sélection des listes.
3. Vérifiez que chaque cible fait environ **44 pixels** au moins et que deux cibles voisines ne se confondent pas.
**Résultat attendu :** les boutons d'action et de fermeture sont aisément touchables ; pas d'appui accidentel sur la ligne voisine.
- [ ] Boutons principaux d'au moins 44 px
- [ ] Fermeture des dialogues et boutons « Réessayer » touchables
- [ ] Espacement suffisant entre cibles

#### C21.7 Tableaux sur mobile
**Compte :** `directeur@` · **Où :** `/v2/stateassign` (« Dossiers d'affectation »), « Mesures à valider », `/v2/councils`
1. Passez en 360 px de large.
2. Vérifiez qu'un tableau large défile **dans son cadre** (région atteignable au clavier, nommée par sa légende) et que la page ne défile pas horizontalement.
3. Sur les écrans dont le tableau bascule en cartes sous la largeur d'un ordinateur (composant de tableau adaptatif, là où il est utilisé), vérifiez que chaque carte reprend toutes les colonnes utiles.
**Résultat attendu :** aucune colonne essentielle ne disparaît ; les actions restent accessibles.
- [ ] Le tableau défile dans son cadre
- [ ] Les actions de ligne (Ouvrir, Examiner) restent atteignables
- [ ] Aucune information perdue en passant aux cartes

#### C21.8 Mouvement réduit et impression
**Compte :** n'importe lequel · **Où :** n'importe quel écran avec chargement, tiroir ou transition
1. Activez dans le système « Réduire les animations ».
2. Rechargez, ouvrez le menu mobile, déclenchez un chargement.
3. Lancez l'impression d'un reçu ou d'un bulletin (Ctrl + P).
**Résultat attendu :** plus d'animation parasite ; à l'impression, barre, menu et fil d'Ariane sont masqués et le contenu occupe la page.
- [ ] Les animations sont réduites ou supprimées
- [ ] L'impression ne montre que le contenu du document

### 21.4 Cas limites et tests négatifs

#### C21.N1 Aucun piège au clavier dans les listes de recherche
1. Dans un champ « Rechercher un élève… », utilisez les flèches, **Entrée** pour choisir, **Échap** pour fermer.
2. Faites une recherche sans résultat.
**Résultat attendu :** « Aucun résultat. » est annoncé ; le focus n'est jamais prisonnier de la liste.
- [ ] Flèches, Entrée et Échap fonctionnent
- [ ] « Aucun résultat. » est lu et ne piège pas le focus

#### C21.N2 Erreur de chargement lisible
1. Coupez le réseau (outils de développement, onglet « Réseau », « Hors connexion ») et rechargez une liste.
**Résultat attendu :** un message d'erreur compréhensible avec un bouton « Réessayer » apparaît, annoncé par le lecteur d'écran, et reste utilisable au clavier.
- [ ] Message d'erreur annoncé et bouton « Réessayer » au clavier

#### C21.N3 Champ leurre des pages publiques
1. Sur `/v2/apply/demo-secondaire`, parcourez le formulaire au lecteur d'écran.
**Résultat attendu :** aucun champ « fantôme » n'est lu ; le consentement est lu avant l'envoi.
- [ ] Aucun champ invisible n'est annoncé
- [ ] Le consentement est annoncé

#### C21.N4 Documents PDF
1. Téléchargez un bulletin ou un reçu et ouvrez-le avec le lecteur d'écran.
**Résultat attendu :** ordre de lecture cohérent (balisage à contrôler : non couvert par l'audit automatique). Noter tout défaut dans la table de contrôle.
- [ ] Ordre de lecture du PDF cohérent

### 21.5 Problèmes connus et limites
- L'audit automatique (axe) ne vérifie pas la qualité des libellés, l'ordre de focus réel, les annonces vocalisées, le contraste réel, le reflow, le zoom, les animations, les PDF ni les composants tiers : tout cela relève de ce chapitre.
- **À valider par une personne** : passage lecteur d'écran (NVDA / VoiceOver) et reflow à 320 px (docs/ETAT_IMPLEMENTATION.md) ; couleur « destructive » éclaircie pour le contraste (changement visuel global à valider).
- Les couleurs en dur (par exemple vert ou orange des indicateurs de réseau), le thème de marque d'un établissement et les états survol / désactivé ne sont contrôlés que manuellement.
- Un écran sans test automatique n'est pas audité : couverture à compléter au fil de l'eau.
- Les écrans d'appel et de saisie de notes hors ligne n'ont pas été balayés par le test automatique de bout en bout.

### 21.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Pas de sélecteur de thème dans la coque v2 (thème sombre par défaut) : la vérification du thème clair passe par le système.
- Reflow 320 px et lecteur d'écran : contrôles manuels non encore réalisés (journal de `apps/web/docs/accessibility.md`).

### 21.7 Table de contrôle réutilisable par écran
Copiez ce tableau pour chaque écran testé (une ligne par contrôle ; notez O = conforme, N = défaut, S = sans objet, et la remarque).

| Écran / adresse : ____________ | Compte : ______ | Navigateur + lecteur : ______ | Date : ______ | Testeur : ______ |
|---|---|---|---|---|
| **Contrôle** | **O / N / S** | **Remarque (capture, gravité)** | | |
| Lien d'évitement « Aller au contenu » au premier Tab | | | | |
| Ordre du focus logique, focus toujours visible | | | | |
| Aucun piège au clavier, tout est faisable sans souris | | | | |
| Dialogues : focus piégé, Échap ferme, retour du focus | | | | |
| Menu mobile : ouverture, Échap, retour du focus | | | | |
| Titre de page unique, hiérarchie des titres | | | | |
| Champs : libellé, aide, « obligatoire » lus | | | | |
| Erreurs : annoncées une fois, liées au champ | | | | |
| Succès / chargement / erreur serveur annoncés | | | | |
| Tableaux : légende, en-têtes, tri annoncés, défilement interne | | | | |
| Badges et états lus en texte (pas la couleur seule) | | | | |
| Zoom 200 % : rien de coupé | | | | |
| Reflow 320 px : aucun défilement horizontal de la page | | | | |
| Espacement du texte augmenté : pas de troncature bloquante | | | | |
| Contraste 4,5 : 1 (thème sombre) | | | | |
| Contraste 4,5 : 1 (thème clair) | | | | |
| Cibles tactiles d'au moins 44 px | | | | |
| Mouvement réduit respecté | | | | |
| Portrait et paysage utilisables | | | | |
| Documents PDF : ordre de lecture | | | | |

---

## Chapitre 22. Hors ligne et application installable (PWA)
> **Durée estimée :** 1 h 15 à 1 h 45 · **Établissement(s) :** `demo-secondaire` (emploi du temps, appel par séance, conflits) et `demo-primaire` (appel journalier) · **Comptes :** enseignant, instituteur, éducateur ou directeur des études (pour les conflits)

### 22.1 Objectif
Vérifier que l'enseignant peut continuer à travailler quand le réseau est mauvais ou coupé : consulter son emploi du temps, faire l'appel et saisir des notes. Ces saisies sont gardées **sur l'appareil**, signalées par un indicateur d'état, puis rejouées sans doublon au retour du réseau ; les cas de désaccord (conflits) sont soumis à une personne. Vérifier aussi l'installation de l'application sur l'écran d'accueil et la remise à zéro en cas de cache obsolète.

### 22.2 Avant de commencer
- **Démarrage particulier de la démonstration.** Le fonctionnement hors ligne (service worker) est **éteint par défaut** dans la démonstration et même désinscrit s'il existait. Pour l'activer, lancez la démonstration avec la variable `ED_DEMO_PWA` à 1 (voir l'introduction pour les commandes habituelles et les prérequis de la démonstration) :
  - Git Bash, macOS, Linux : `ED_DEMO_PWA=1 pnpm demo:up`
  - PowerShell : `$env:ED_DEMO_PWA = "1"; pnpm demo:up`

  Si la démonstration tourne déjà sans cette variable, arrêtez-la d'abord (`pnpm demo:down`, qui conserve les données) puis relancez avec la variable. N'utilisez pas `pnpm demo:reset` : il effacerait les données.
- **Navigateur :** Chrome ou Edge avec les outils de développement (F12). Pour couper le réseau : onglet « Réseau », liste de limitation, « Hors connexion » (ou case « Hors connexion » de l'onglet « Application » > « Service Workers »). Un second navigateur ou une fenêtre privée sert de deuxième appareil.
- **Adresse :** `http://demo-secondaire.localhost:3100/v2/login` (les adresses en `localhost` sont acceptées comme sécurisées).
- **Comptes :** `enseignant@demo-secondaire.test` (Kouadio TRAORE), `enseignant@demo-primaire.test` (instituteur du CP1, appel journalier), `educateur@demo-secondaire.test` ou `etudes@demo-secondaire.test` (écran des conflits ; l'écran exige le droit de gérer les présences).
- **Ce que le hors ligne couvre, et ce qu'il ne couvre pas :**

| Besoin | Hors ligne ? | Comment |
|---|---|---|
| Emploi du temps de l'enseignant | lecture seule | copie des semaines déjà ouvertes en ligne (la semaine suivante est préchargée) |
| Appel | oui | pointages gardés sur l'appareil, envoyés au retour du réseau |
| Saisie des notes | oui | brouillons gardés sur l'appareil, envoi par lot sans doublon |
| Toute autre page privée | non | jamais gardée ; hors ligne, la page « Vous êtes hors ligne » s'affiche |

- **Prérequis pour les notes :** une évaluation en **brouillon** dans une période **ouverte**. Dans la démonstration, la période 1 est close et, au collège, la période 2 est verrouillée : demandez à la direction des études d'ouvrir une période si le formulaire « Nouvelle évaluation » refuse les périodes proposées (écran des périodes du chapitre Académique, à confirmer). Sans cela, testez seulement le cas « période verrouillée » (C22.N3).
- **Aucune donnée d'élève nominative** n'est gardée sur l'appareil : seuls des identifiants sont mémorisés.

### 22.3 Scénarios

#### C22.1 Démarrage avec le hors ligne activé et vérification du service worker
**Compte :** `enseignant@demo-secondaire.test` · **Où :** F12 > « Application » > « Service Workers »
1. Après `ED_DEMO_PWA=1 pnpm demo:up` (voir 22.2), ouvrez `http://demo-secondaire.localhost:3100/v2/login` et connectez-vous.
2. Ouvrez F12 > « Application » > « Service Workers » : un service worker pour l'adresse du site doit être « activated and is running » (fichier `/sw.js`).
3. Dans « Cache Storage », repérez deux caches nommés `ed-shell-v2` et `ed-static-v2`.
4. Ouvrez `/offline` (adresse directe) : la page « Vous êtes hors ligne » s'affiche.
**Résultat attendu :** le service worker est actif ; il ne garde que la page `/offline`, le manifeste, les icônes et les fichiers statiques versionnés. **Aucune page privée** ni aucune réponse de l'application n'est dans le cache.
- [ ] Service worker actif sur le site
- [ ] Caches `ed-shell-v2` et `ed-static-v2` présents, sans page privée
- [ ] La page `/offline` s'affiche et propose « Réessayer la connexion »

#### C22.2 Installation de l'application
**Compte :** `enseignant@` · **Où :** barre d'adresse du navigateur ou menu « … »
1. Sur une page de l'application (après C22.1), cherchez l'icône d'installation dans la barre d'adresse, ou le menu du navigateur « Installer EcoleDigitale… » (le libellé exact dépend du navigateur).
2. Installez l'application et ouvrez-la : elle s'ouvre dans sa propre fenêtre, sans barre d'adresse.
3. Dans F12 > « Application » > « Manifest » : nom « EcoleDigitale », affichage « standalone », icônes 192 et 512 px.
**Résultat attendu :** l'application s'installe ; il n'existe pas de bouton « Installer » propre à EcoleDigitale dans l'écran (c'est le navigateur qui propose l'installation). Une nouvelle version peut afficher « Une nouvelle version est disponible. » (à confirmer).
- [ ] L'application s'installe et s'ouvre en fenêtre autonome
- [ ] Le manifeste affiche nom, icônes et mode « standalone »

#### C22.3 Consultation hors ligne de l'emploi du temps
**Compte :** `enseignant@demo-secondaire.test` · **Où :** « Mon emploi du temps » > `/v2/teacher/schedule`
1. En ligne, ouvrez « Mon emploi du temps » (semaine en cours), puis cliquez sur « Semaine suivante » (cette semaine est ainsi aussi mémorisée).
2. Coupez le réseau (« Hors connexion »).
3. Changez de semaine entre ces deux semaines : une bannière « Hors ligne : vous consultez la copie de votre emploi du temps enregistrée il y a … Lecture seule. » apparaît.
4. Allez sur une semaine jamais ouverte : « Hors ligne, et aucune copie de cette période n'est enregistrée sur cet appareil. »
5. Fermez l'onglet, gardez le réseau coupé, rouvrez l'adresse d'une page privée (par exemple `/v2/teacher`).
**Résultat attendu :** l'étape 3 affiche la copie en lecture seule ; l'étape 4 affiche le message sans copie ; à l'étape 5 vous arrivez sur « Vous êtes hors ligne » **avec** la copie de l'emploi du temps (période enregistrée, heure de la copie), sans aucune donnée d'élève. Au-delà de 24 h, un avertissement indique que l'emploi du temps a pu changer.
- [ ] La copie hors ligne s'affiche avec l'heure d'enregistrement
- [ ] Une période jamais ouverte donne un message clair
- [ ] Le démarrage « à froid » hors ligne montre la page hors ligne avec la copie
- [ ] Aucune donnée d'élève n'apparaît dans cette copie

#### C22.4 Appel hors ligne et rejeu au retour du réseau
**Compte :** `enseignant@demo-primaire.test` (appel journalier) ou `enseignant@demo-secondaire.test` (appel par séance) · **Où :** « Mes appels » > `/v2/teacher/attendance`
1. **En ligne**, ouvrez « Mes appels », puis la séance à faire (« Faire l'appel »), ou en primaire « Appel du jour » > « Ouvrir » (si l'appel du jour est déjà validé, choisissez une autre date proposée par l'écran : à confirmer). La liste de la classe se charge.
2. Lisez l'indicateur d'état : « En ligne : tout est à jour. »
3. Coupez le réseau (« Hors connexion ») : l'indicateur passe à « Hors ligne : vous pouvez continuer, les pointages seront envoyés à la reconnexion. »
4. Touchez un élève pour le marquer « Absent », puis cliquez sur « Soumettre l'appel ».
5. Lisez le message : « Appel enregistré sur cet appareil. Il sera envoyé automatiquement dès que le réseau reviendra. » ; l'indicateur affiche « Hors ligne : 1 pointage gardé sur cet appareil, envoi à la reconnexion. » ; la section « Sur cet appareil » de « Mes appels » montre l'appel « En attente d'envoi ».
6. Rétablissez le réseau : l'indicateur passe par « Synchronisation en cours… » puis « En ligne : synchronisé à HH:MM. » ; l'appel sort de « Sur cet appareil » (état « Envoyé »).
7. Avec `directeur@` ou `educateur@`, vérifiez dans « Suivi des appels » que l'appel est bien « Soumis » **une seule fois**.
**Résultat attendu :** aucun doublon ; le même appel rejoué ne crée pas deux soumissions. Si l'envoi échoue, le bouton « Réessayer maintenant » et un nouvel essai automatique sont proposés.
- [ ] L'indicateur d'état réseau reflète en ligne, hors ligne et synchronisation
- [ ] L'appel hors ligne est gardé et affiché « En attente d'envoi »
- [ ] Au retour du réseau, l'appel est envoyé sans doublon
- [ ] Hors ligne, la liste de la classe ne se charge pas (« la liste de la classe ne peut pas être chargée ») : il faut avoir ouvert l'appel en ligne avant la coupure

#### C22.5 Saisie de notes hors ligne
**Compte :** `enseignant@` · **Où :** « Mes évaluations » > une évaluation en brouillon > « Saisir les notes » (`/v2/teacher/assessments/<identifiant>/grades`)
1. En ligne, ouvrez la feuille d'une évaluation en brouillon (voir les prérequis en 22.2).
2. Coupez le réseau. Saisissez trois notes (dont une avec virgule, par exemple 12,5).
3. Lisez l'indicateur « Synchronisation des notes » : « Hors ligne : 3 notes gardées sur cet appareil. Envoi à la reconnexion. »
4. Fermez l'onglet, rouvrez-le **avec le réseau**, et rouvrez la feuille : « 3 saisies hors ligne restaurées depuis cet appareil. Vérifiez-les puis enregistrez. » Cliquez sur « Enregistrer ».
5. Variante : refaites l'étape 2, quittez la feuille pour la liste des évaluations, puis rétablissez le réseau : l'envoi part seul depuis n'importe quelle page du portail enseignant.
**Résultat attendu :** « Notes synchronisées à HH:MM. » ; aucune note n'est perdue ni dupliquée. Un brouillon hors ligne se rattache à votre compte : un autre compte sur le même appareil ne le voit pas.
- [ ] Les saisies hors ligne sont conservées et signalées
- [ ] Elles sont restaurées à la réouverture et envoyées sans doublon
- [ ] L'envoi automatique fonctionne depuis une autre page du portail

#### C22.6 Conflits de notes
**Compte :** `enseignant@` (appareil A, hors ligne) et un second compte autorisé à saisir sur la même évaluation (appareil B, en ligne)
1. Sur A, hors ligne, saisissez 15 pour un élève de la feuille.
2. Sur B, en ligne, saisissez 5 pour **le même élève** dans la même évaluation et enregistrez.
3. Rétablissez le réseau sur A : le tableau « Notes modifiées par quelqu'un d'autre » apparaît avec « Ma saisie » (15) et « Valeur du serveur » (5) ; **rien n'a été écrasé**.
4. Testez « Voir les deux », « Garder la mienne » (15 est enregistré) puis, en refaisant le test, « Prendre celle du serveur » (5 est conservé).
**Résultat attendu :** aucune valeur n'est remplacée sans choix explicite ; « Garder la mienne remplace la valeur du serveur par votre saisie. » Si l'évaluation est entre-temps soumise ou la période verrouillée : « Évaluation figée ou période verrouillée », saisies conservées, feuille en lecture seule.
- [ ] Les deux valeurs sont comparables et rien n'est écrasé
- [ ] « Garder la mienne » et « Prendre celle du serveur » fonctionnent
- [ ] Une évaluation figée verrouille les saisies hors ligne sans les perdre

#### C22.7 Conflits de synchronisation de l'appel (écran de la direction)
**Compte :** `educateur@demo-secondaire.test`, `etudes@demo-secondaire.test` ou `directeur@` · **Où :** « Conflits de synchronisation » > `/v2/attendance/conflicts`
1. Ouvrez l'écran : « Conflits de synchronisation » (« Pointages saisis hors ligne que le serveur n'a pas appliqués : à arbitrer par la direction. »), onglets « À arbitrer » et « Arbitrés ».
2. Sans conflit : « Aucun conflit à arbitrer. »
3. Pour en provoquer un (essai optionnel, à confirmer) : sur A (enseignant), faites l'appel hors ligne et marquez un élève absent, soumettez (en attente) ; sur B (éducateur), avant le retour du réseau de A, marquez le même élève présent dans le même appel ; rétablissez A.
4. Le conflit apparaît avec sa nature : « Appel verrouillé », « Délai de correction dépassé » ou « Saisie plus ancienne » ; comparez « Saisie de l'appareil » et « Pointage actuel ».
5. Choisissez « Conserver le pointage actuel » ou « Appliquer la saisie de l'appareil » (impossible tant que l'appel est validé ou annulé : rouvrez-le d'abord), avec une note facultative.
**Résultat attendu :** « Conflit arbitré. » ; le conflit passe dans « Arbitrés » avec sa résolution (« Saisie appliquée » ou « Pointage conservé »). Si la fonction n'est pas incluse dans l'offre : « La synchronisation hors ligne n'est pas incluse dans votre offre. »
- [ ] L'écran est accessible à la direction ou à l'éducateur et vide sans conflit
- [ ] Un conflit montre les deux valeurs et sa nature
- [ ] L'arbitrage est tracé et le conflit quitte « À arbitrer »

#### C22.8 Désinscription du service worker et cache obsolète
**Compte :** `enseignant@` · **Où :** F12 > « Application »
1. Si une page paraît ne pas refléter une modification (cache obsolète) ou si l'application se comporte de façon étrange : F12 > « Application » > « Service Workers » > « Unregister ».
2. Dans « Cache Storage », supprimez les caches `ed-*` ; dans « Storage », « Clear site data » si nécessaire.
3. Rechargez la page avec Ctrl + Maj + R.
4. Vérifiez la déconnexion volontaire : « Se déconnecter » efface la copie de l'emploi du temps et vide les caches `ed-*` ; les brouillons non envoyés restent sur l'appareil (invisibles pour un autre compte).
5. Pour arrêter proprement le mode hors ligne : relancez la démonstration **sans** la variable (`pnpm demo:down`, puis `pnpm demo:up`) : le service worker est alors désinscrit au prochain chargement.
**Résultat attendu :** après désinscription et rechargement, l'application se charge normalement ; aucune page privée n'était en cache. Un service worker n'intercepte jamais les appels de l'application, les requêtes authentifiées ni les envois.
- [ ] La désinscription et la suppression des caches remettent l'application à neuf
- [ ] Après « Se déconnecter », la page `/offline` n'affiche plus de copie d'emploi du temps
- [ ] Relancée sans la variable, la démonstration n'enregistre plus de service worker

### 22.4 Cas limites et tests négatifs

#### C22.N1 Page privée hors ligne
**Compte :** `enseignant@`
1. Hors connexion, ouvrez `/v2/teacher/classes` (jamais consultée dans cette session) ou rechargez une page privée.
**Résultat attendu :** redirection vers « Vous êtes hors ligne » (« Cette page n'est pas disponible sans connexion : les pages privées ne sont jamais gardées hors ligne ») ; aucune donnée de la page n'est affichée.
- [ ] Aucune page privée n'est servie sans réseau

#### C22.N2 Session expirée avant l'envoi
**Compte :** `enseignant@`
1. Faites un appel ou des notes hors ligne, attendez l'expiration de la session (durée d'accès), puis rétablissez le réseau.
**Résultat attendu :** rien n'est envoyé ; message « Session expirée : reconnectez-vous… » ; saisies conservées. Avec le **même** compte, l'envoi reprend sans perte ; avec un **autre** compte sur le même appareil, les brouillons de notes restent invisibles (l'appel hors ligne, lui, se rattache à la séance : évitez de croiser deux comptes sur la même séance).
- [ ] Rien n'est envoyé sans session valide
- [ ] Reconnexion avec le même compte : envoi sans perte

#### C22.N3 Période verrouillée ou évaluation figée
**Compte :** `enseignant@demo-secondaire.test`
1. Sur une évaluation dont la période est verrouillée, saisissez des notes hors ligne puis rétablissez le réseau.
**Résultat attendu :** message « Évaluation figée ou période verrouillée » ; les saisies restent gardées mais ne sont pas envoyées ; bouton « Abandonner mes saisies hors ligne » (confirmation demandée).
- [ ] Le refus est expliqué et rien n'est supprimé sans confirmation

#### C22.N4 Stockage indisponible (navigation privée)
**Compte :** `enseignant@`
1. Dans une fenêtre de navigation privée, faites un appel ou des notes hors ligne.
**Résultat attendu :** avertissement « Le stockage de cet appareil est indisponible (navigation privée ?)… Les pointages seront perdus si vous fermez cette page avant l'envoi. »
- [ ] L'avertissement s'affiche

#### C22.N5 Liste de classe non chargée hors ligne
**Compte :** `enseignant@`
1. Coupez le réseau **avant** d'ouvrir une séance jamais consultée.
**Résultat attendu :** « Vous êtes hors ligne : la liste de la classe ne peut pas être chargée. Rouvrez cet appel dès que le réseau revient… » ; les pointages déjà saisis sur l'appareil sont conservés.
- [ ] Le message est clair et aucune saisie n'est perdue

#### C22.N6 Isolation entre comptes sur un même appareil
**Compte :** `enseignant@demo-secondaire.test`, puis `enseignant2@demo-secondaire.test` (Fatou YAO, s'il a un accès enseignant : à confirmer)
1. Faites des notes hors ligne avec le premier compte, déconnectez-vous (sans envoyer), connectez-vous avec le second.
**Résultat attendu :** le second compte ne voit ni n'envoie les brouillons du premier ; le premier les retrouve à sa reconnexion.
- [ ] Un brouillon n'est visible que de son auteur

### 22.5 Problèmes connus et limites
- **Les saisies doivent avoir été ouvertes en ligne** : la liste nominative d'une classe n'est jamais stockée ; hors ligne, un rechargement de la page n'affiche que « Vous êtes hors ligne » (avec la copie de l'emploi du temps) ; les saisies déjà faites sont en sécurité.
- **Pas d'envoi en arrière-plan** application fermée : l'envoi reprend à la prochaine ouverture du portail.
- **Jeton non renouvelable hors ligne** : la reprise attend une session valide du même compte.
- Les notes **publiées** ou en circuit de validation ne s'éditent pas hors ligne (corrections = demandes en ligne).
- Limites de la file : 25 évaluations en attente, 1 000 lignes par évaluation, 200 par envoi ; au-delà, la saisie n'est pas gardée et une alerte le dit.
- **Emploi du temps hors ligne** : seulement « mon » emploi du temps (jamais celui d'une classe, d'un collègue ou d'un enfant), copie en lecture seule, huit fenêtres au plus.
- **Cache obsolète en développement** : le service worker peut masquer des modifications ; désinscrivez-le (C22.8).
- **Conflits de l'appel** : l'écran est réservé aux comptes autorisés à gérer les présences (menu « Présences > Conflits de synchronisation » ou adresse directe).
- **Appel journalier refusé en secondaire** (défaut QA M22) : utilisez l'appel par séance au collège et l'appel du jour au primaire.
- La vie scolaire (saisie d'incident) n'est pas disponible hors ligne (voir chapitre 19).
- Aucun bouton « Installer » propre à l'application : l'installation passe par le navigateur.

### 22.6 Écarts spec / application (pour l'équipe, pas pour le testeur)
- Spec 006 AC12.5 : saisie d'observation et d'incident « conçue pour le hors-ligne » : non implémentée.
- Le message « Une nouvelle version est disponible » et le bouton « Installer l'application » existent comme textes (`pwa.updateAvailable`, `pwa.installApp`) mais aucun composant ne les affiche (à confirmer).
- La file d'appel (`AttendanceOutbox`) construit sa clé sans propriétaire : deux comptes touchant la même séance sur un même appareil se remplaceraient (limite assumée dans `apps/web/docs/offline-advanced.md`).
- La checklist manuelle sur appareil réel (Android Chrome, iOS Safari, application installée) de `apps/web/docs/offline-advanced.md` § 8 reste à dérouler par une personne.


# Partie 4. Parcours de bout en bout

Ces parcours enchaînent plusieurs chapitres et **changent de compte** entre les étapes, comme dans la vie réelle d'un établissement. Chaque étape renvoie au scénario détaillé du chapitre indiqué (par exemple C17.4 = scénario 4 du chapitre 17). Faites d'abord les chapitres concernés : les parcours ne répètent pas le détail des gestes.

**Conseils**

- Utilisez une fenêtre de navigation privée par compte, ou déconnectez-vous entre deux étapes.
- Notez à chaque étape le nom exact de l'élève ou de la candidature créée, pour la retrouver sous le compte suivant.
- Les actions marquées **irréversible** sont à faire en dernier ; après elles, prévoyez un `pnpm demo:reset` si vous voulez recommencer.
- Certaines tâches s'exécutent en arrière-plan (confirmation d'inscription après paiement, alertes) : attendez environ une à deux minutes avant de conclure à un échec.
- La démonstration a déjà clos le trimestre 1 (et verrouillé le trimestre 2 du collège) : les nouvelles saisies se font sur la période encore ouverte (voir les chapitres 3 et 8). Quand une étape ne peut pas concerner l'élève que vous venez de créer, le parcours indique de poursuivre avec un élève de la graine (par exemple Nadia DIABATE).

## Parcours A. Admission, inscription, appel, notes, résultats, bulletin, famille (Collège Le Baobab)

> **Durée estimée :** 3 à 4 heures · **Établissement :** `demo-secondaire` · **Comptes :** chargé d'admissions, directeur, économe, enseignant, responsable pédagogique, directeur des études, parent, élève

| Étape | Compte | Action (scénario) | Résultat attendu | Fait |
|---|---|---|---|---|
| A1 | Chargé d'admissions (`admissions@`) | Créer une candidature pour la campagne `RENTREE-6E` et la soumettre (C17.4) ; ajouter une pièce (C17.5) ; planifier un entretien (C17.6). | Dossier au statut « Soumise », puis entretien planifié. | - [ ] |
| A2 | Directeur (`directeur@`, MFA) | Décider « Admis » sur ce dossier (C17.7). | Décision enregistrée avec un motif ; le chargé d'admissions ne pouvait pas la prendre (C17.N1). | - [ ] |
| A3 | Chargé d'admissions | Émettre l'offre et ouvrir le lien de réponse (C17.9, C17.18). | Offre émise ; la famille peut l'accepter sur la page publique. | - [ ] |
| A4 | Économe (`econome@`, MFA) | Encaisser les frais d'inscription de 25 000 XOF pour ce candidat (C17.13, C12.7). | Reçu émis ; l'inscription passe à « Active » après la tâche d'arrière-plan (1 à 2 minutes). | - [ ] |
| A5 | Secrétariat (`secretariat@`, MFA) | Retrouver l'élève dans « Élèves » et son inscription dans « Inscriptions » (C04.1, C03.7). | Fiche élève créée, inscription « Active » dans 6e A. | - [ ] |
| A6 | Enseignant (`enseignant@`) | Faire l'appel d'une séance (C06.2) et le soumettre. | Séance « soumise ». | - [ ] |
| A7 | Directeur ou directeur des études | Valider l'appel (C06.5). | Appel « Validé » ; l'enseignant ne peut pas le valider lui-même (C06.N1). | - [ ] |
| A8 | Enseignant | Créer une évaluation (C08.3), saisir et soumettre (C08.4, C08.5). | Feuille « Soumise ». | - [ ] |
| A9 | Responsable pédagogique (`pedagogie@`, MFA) | Relire et approuver (C08.6, C08.7). | Feuille « Approuvée » ; l'enseignant ne peut pas approuver sa propre feuille (C08.N1). | - [ ] |
| A10 | Directeur des études (`etudes@`, MFA) ou directeur | Valider et publier les notes (C08.8). **Irréversible.** | Notes publiées, immuables. | - [ ] |
| A11 | Parent (`parent@`) | Voir les notes publiées de Nadia (C08.9, C20.2). | Seules les notes publiées de ses enfants sont visibles. | - [ ] |
| A12 | Directeur des études | Lire les résultats du trimestre 1 clos et expliquer une moyenne (C09.5, C09.6). | « Pourquoi cette moyenne ? » détaille le calcul ; les règles sont des règles de démonstration. | - [ ] |
| A13 | Directeur des études | Ouvrir les bulletins émis du trimestre 1, télécharger le PDF de Nadia (C10.4). | PDF signé avec le filigrane « démonstration ». | - [ ] |
| A14 | Sans compte | Vérifier le document par son code sur `/v2/verify` (C10.5). | Message « document authentique » et rappel des règles de démonstration. | - [ ] |
| A15 | Parent | Ouvrir les bulletins de Nadia (C10.9), voir la scolarité (C12.12), tenter le paiement en ligne (C12.13, C20.4). | Le bulletin publié est téléchargeable ; le solde correspond aux factures ; le paiement en ligne se comporte comme décrit au chapitre 12 (à confirmer). | - [ ] |

> Le nouvel élève créé en A1 à A5 entre dans une classe dont le trimestre 1 est déjà clos : c'est normal que ses notes n'apparaissent pas dans les bulletins du trimestre 1. A12 à A15 se font sur les données de la graine.

## Parcours B. Incident de vie scolaire, validation de la direction, information de la famille (Collège Le Baobab)

> **Durée estimée :** 1 h 30 · **Établissement :** `demo-secondaire` · **Comptes :** enseignant, éducateur, directeur, parent

| Étape | Compte | Action (scénario) | Résultat attendu | Fait |
|---|---|---|---|---|
| B1 | Enseignant | Saisie rapide d'un incident (C19.2). | Incident enregistré. | - [ ] |
| B2 | Éducateur (`educateur@`) | Proposer une exclusion pour un élève (C19.4). | Mesure « proposée » ; l'éducateur n'a pas de bouton de validation (C19.N1). | - [ ] |
| B3 | Directeur (`directeur@`, MFA) | Valider la mesure dans « Mesures à valider » (C19.5). | Validation possible seulement si le directeur n'est pas le proposant (C19.N2). | - [ ] |
| B4 | Directeur | Appliquer l'effet sur le statut de l'élève (C19.7). | Le statut change seulement par cette action humaine. | - [ ] |
| B5 | Parent | Voir la notification, accuser réception, déposer un recours (C19.6). | La famille voit la mesure ; le journal des notifications montre un envoi « Simulé » (chapitre 15). | - [ ] |
| B6 | Directeur | Trancher le recours (C19.6). | Décision tracée dans le journal d'audit (chapitre 1). | - [ ] |

## Parcours C. Conseil de classe, décision, procès-verbal (Collège Le Baobab)

> **Durée estimée :** 1 h 30 · **Établissement :** `demo-secondaire` · **Comptes :** directeur des études, enseignant, directeur, secrétariat, parent

| Étape | Compte | Action (scénario) | Résultat attendu | Fait |
|---|---|---|---|---|
| C1 | Directeur des études (`etudes@`, MFA) | Ouvrir la séance du conseil du trimestre 2 (C19.16). | Séance « ouverte » avec la liste des élèves. | - [ ] |
| C2 | Enseignant | Proposer une décision pour un élève (C19.17). | Proposition enregistrée ; l'enseignant ne décide pas (C19.N4). | - [ ] |
| C3 | Directeur des études | Enregistrer la décision HUMAINE du conseil (C19.18). | Décision enregistrée ; aucune suggestion automatique d'orientation. | - [ ] |
| C4 | Directeur des études | Clore la séance, générer le procès-verbal PDF, signer (C19.19). | PV PDF avec le filigrane « démonstration » ; la signature est peut-être refusée avec les comptes de la graine (à confirmer, voir le chapitre 19). | - [ ] |
| C5 | Directeur | Approuver une demande de déverrouillage faite par un autre (C19.20). | La demande et l'approbation sont deux personnes distinctes. | - [ ] |
| C6 | Parent ou élève | Consulter la décision (C19.22). | Vue famille limitée à son enfant. | - [ ] |

## Parcours D. Primaire : admission, inscription, appel, compétences, conseil des maîtres, bilan annuel (École Les Palmiers)

> **Durée estimée :** 3 heures · **Établissement :** `demo-primaire` · **Comptes :** chargé d'admissions, économe, secrétariat, instituteur de la maternelle, directeur, parent

| Étape | Compte | Action (scénario) | Résultat attendu | Fait |
|---|---|---|---|---|
| D1 | Chargé d'admissions | Parcourir le pipeline et un dossier de maternelle (C17.1 à C17.3). | Dossiers à tous les statuts ; 5 enfants déjà inscrits. | - [ ] |
| D2 | Économe | Passage à l'inscription par le paiement des frais (C17.13). | Inscription confirmée par le paiement. | - [ ] |
| D3 | Instituteur de la maternelle (`instituteur.maternelle@demo-primaire.test`) | Lire l'appel du jour de la Grande Section A (C06.4, C18.2). | Appel déjà validé, en lecture seule. | - [ ] |
| D4 | Instituteur du CP1 (`enseignant@demo-primaire.test`) | Évaluer sans note et valider la grille (C18.4). | « Non évalué » n'est jamais converti en zéro (C18.N9). | - [ ] |
| D5 | Directeur | Préparer un conseil des maîtres : l'instituteur propose, la direction décide (C18.9) ; consulter le PV (C18.10). | Justification obligatoire en cas d'écart (C18.N5). | - [ ] |
| D6 | Directeur | Lire les bilans annuels (C18.11) puis sceller un bilan prêt (C18.12). **Irréversible.** | Bilan scellé, PDF signé avec filigrane. | - [ ] |
| D7 | Sans compte | Vérifier le PDF scellé (C18.14). | Vérification publique réussie. | - [ ] |

## Parcours E. Supérieur : notes, semestre validé, relevé, rattrapage, diplôme (Université Horizon)

> **Durée estimée :** 2 h 30 · **Établissement :** `demo-superieur` · **Comptes :** enseignant, directeur des études, directeur, étudiant, parent

| Étape | Compte | Action (scénario) | Résultat attendu | Fait |
|---|---|---|---|---|
| E1 | Directeur des études | Lire la structure UE / ECUE (C11.1). | Deux UE de deux ECUE chacune. | - [ ] |
| E2 | Directeur des études | Lire le résultat du semestre 1 : crédits et « semestre validé » (C11.2, C11.3). | Semestre validé = toutes les UE validées. | - [ ] |
| E3 | Directeur des études | Télécharger un relevé de notes PDF (C10.13). | PDF signé. | - [ ] |
| E4 | Directeur des études | Consulter la fenêtre de rattrapage (C11.5). | La note de rattrapage REMPLACE la note initiale. | - [ ] |
| E5 | Directeur | Créer un diplôme, octroyer, affecter les signataires (C11.6, C11.7). | Diplôme octroyé ; seul le directeur peut forcer ou révoquer (C11.N1). | - [ ] |
| E6 | Étudiant (`eleve@demo-superieur.test`) | Consulter ses documents (C11.10). | Seulement les siens (C11.N6). | - [ ] |

## Parcours F. Facturation, paiement, reçu, remboursement (tous établissements)

> **Durée estimée :** 2 heures · **Établissement :** `demo-secondaire` · **Comptes :** économe, parent, directeur

| Étape | Compte | Action (scénario) | Résultat attendu | Fait |
|---|---|---|---|---|
| F1 | Économe | Créer puis émettre une facture (C12.5). | Facture émise avec échéancier. | - [ ] |
| F2 | Économe | Encaisser un virement partiel et obtenir le reçu (C12.7). | Reçu immuable ; la facture reste partiellement payée. | - [ ] |
| F3 | Économe | Tester les trois résultats de paiement en ligne de démonstration (C12.10). | Réussite, attente ou échec selon le montant. | - [ ] |
| F4 | Parent | Voir la situation financière et le reçu (C12.12). | Seulement ses enfants (C12.N3). | - [ ] |
| F5 | Économe | Demander un remboursement (C12.15). | Demande « en attente » ; l'économe ne l'approuve pas. | - [ ] |
| F6 | Directeur (MFA) | Approuver le remboursement (C12.15). | Deuxième personne obligatoire (quatre yeux). | - [ ] |

## Parcours G. Élève affecté par l'État (Collège Le Baobab)

> **Durée estimée :** 1 h 30 · **Établissement :** `demo-secondaire` · **Comptes :** secrétariat, directeur, économe, parent

| Étape | Compte | Action (scénario) | Résultat attendu | Fait |
|---|---|---|---|---|
| G1 | Secrétariat | Lire le dossier `AFF-DEMO-0001` (C19.11). | Dossier enregistré. | - [ ] |
| G2 | Directeur | Vérifier puis activer le dossier (C19.12). | Le secrétariat n'a pas pu se vérifier lui-même (C19.N3). | - [ ] |
| G3 | Économe | Lire la facture scindée famille / État (C19.13). | Part de l'État et part de la famille (à confirmer : 120 000 et 80 000 XOF). | - [ ] |
| G4 | Économe ou direction | Enregistrer le versement de l'État et rapprocher (C19.14). | Créance sur l'État soldée ou réduite. | - [ ] |
| G5 | Parent | Constater qu'il ne voit pas le détail de l'affectation (C19.N5). | Vue limitée à la part de la famille. | - [ ] |

## Parcours H. Paie d'un enseignant (Collège Le Baobab)

> **Durée estimée :** 2 heures · **Comptes :** propriétaire, économe, directeur, enseignant

La démonstration ne contient aucune donnée de paie : ce parcours crée le jeu minimal décrit au chapitre 13.

| Étape | Compte | Action (scénario) | Résultat attendu | Fait |
|---|---|---|---|---|
| H1 | Économe | Configuration, période, calcul (C13.2, C13.4, C13.5). | Bulletin calculé. | - [ ] |
| H2 | Directeur | Arrêter le montant (C13.7). | Bulletin « Arrêté ». | - [ ] |
| H3 | Enseignant | Consulter son bulletin (C13.8). | Il ne voit que le sien. | - [ ] |
| H4 | Propriétaire | Activer la séparation des tâches et le seuil propriétaire (C13.9, C13.12). | Au-delà du seuil, seul le propriétaire valide. | - [ ] |
| H5 | Économe | Verser le bulletin (C13.10). | Bulletin « Versé » ; il ne peut plus être annulé (C13.N7). | - [ ] |


# Partie 5. Tests d'isolation et de sécurité

Ces tests sont à la portée d'un testeur sans compétence technique : ils consistent à **essayer d'ouvrir ce qu'on ne doit pas voir**. Un seul échec (vous voyez ce que vous ne devriez pas voir) est une anomalie **Bloquant** (voir la partie 6) : prévenez l'équipe tout de suite.

> **Durée estimée :** 2 à 3 heures · **Comptes :** voir chaque test · **Principe :** un test négatif réussi, c'est un refus. Le comportement attendu est soit un retour à la page de connexion, soit la page « Accès refusé » (`/unauthorized`, texte « Vous n'avez pas les droits nécessaires pour afficher cette page. »), soit une page qui répond comme si l'élément n'existait pas (« page introuvable »).

**Comment lire la réponse « page introuvable »** : pour un élément qui existe mais que vous n'avez pas le droit de voir (un enfant d'un autre parent, un élève d'un autre établissement), l'application répond exactement comme pour un élément qui n'existe pas. Elle ne dit ni « interdit » ni « existe ». Si vous voyez un message du type « vous n'avez pas accès à cet élève », l'existence est révélée : notez-le comme anomalie mineure ou majeure selon la donnée affichée (le chapitre 19 signale déjà un cas de ce genre dans l'écran parent de la vie scolaire).

## 5.1 Isolation entre établissements

Les trois établissements sont totalement séparés. Les comptes d'un établissement n'existent pas dans les autres (sauf l'opérateur de la plateforme).

### S5.1.1 Les listes ne mélangent pas les établissements

1. Connectez-vous à `demo-secondaire` avec `secretariat@demo-secondaire.test` (MFA). Ouvrez `/v2/students`. Notez le nombre d'élèves.
2. Dans une autre fenêtre privée, connectez-vous à `demo-primaire` avec `secretariat@demo-primaire.test`. Ouvrez `/v2/students`.
3. Comparez : les noms de la graine sont identiques dans les trois établissements (Nadia DIABATE, etc.), mais ce sont des **personnes distinctes** de chaque établissement. Les classes diffèrent : 6e A au collège, CP1 A et Grande Section A à l'école.

**Résultat attendu :** chaque liste ne montre que les élèves de son établissement ; aucune classe d'un autre établissement n'apparaît.

- [ ] Les deux listes sont distinctes
- [ ] Aucune classe d'un autre établissement n'apparaît dans les filtres

### S5.1.2 Une adresse copiée d'un établissement à l'autre

1. Sous `demo-secondaire` (secrétariat), ouvrez la fiche d'un élève : l'adresse ressemble à `http://demo-secondaire.localhost:3100/v2/students/<identifiant>`. Copiez-la.
2. Remplacez `demo-secondaire` par `demo-primaire` dans l'adresse et ouvrez-la dans la fenêtre connectée à `demo-primaire` (secrétariat du primaire).

**Résultat attendu :** page introuvable (l'identifiant n'existe pas dans cet établissement). Aucune donnée de l'élève du collège n'apparaît.

3. Ouvrez la même adresse `demo-primaire` dans une fenêtre où vous n'êtes **pas** connecté : retour à la connexion.

- [ ] Page introuvable, sans donnée
- [ ] Sans connexion : redirection vers la connexion

Répétez avec une facture (`/v2/finance/invoices/<id>`), une candidature (`/v2/admissions/applications/<id>`), un bulletin (`/v2/reportcards/<id>`), un document (`/v2/documents/<id>`).

- [ ] Facture, candidature, bulletin et document : introuvables d'un établissement à l'autre

### S5.1.3 Le mauvais établissement pour un compte

1. Ouvrez `http://demo-primaire.localhost:3100/v2/login`.
2. Saisissez l'adresse e-mail d'un compte du **collège** (`parent@demo-secondaire.test`) et son mot de passe (fichier `.demo/credentials.md`).

**Résultat attendu :** la connexion est refusée avec un message neutre (« Aucun accès actif pour cet établissement. » d'après le code) ; aucun renseignement sur l'existence du compte dans l'autre établissement. (Chapitre 2, C02.N9.)

- [ ] Connexion refusée, message neutre

### S5.1.4 La session ne passe pas d'un sous-domaine à l'autre

1. Connecté au collège, changez seulement le début de l'adresse (`demo-primaire.localhost:3100/v2/direction`).

**Résultat attendu :** vous n'êtes pas reconnu ; retour à la page de connexion (à confirmer).

- [ ] Retour à la connexion

### S5.1.5 Le contrôle automatique d'isolation

Une personne de l'équipe technique peut lancer `pnpm demo:smoke` : ce test automatique contrôle notamment l'isolation entre établissements. Demandez-lui le résultat à joindre à votre rapport.

- [ ] Résultat du test automatique obtenu

## 5.2 Un parent ne voit que ses enfants

Compte : `parent@demo-secondaire.test` (Séka DIABATE, enfants Nadia et Salimata DIABATE). Chapitre 20.

1. Ouvrez `/v2/parent` : seuls Nadia et Salimata apparaissent.
2. Ouvrez les résultats, le bulletin, l'emploi du temps, les absences, la scolarité et les documents de chacun des deux enfants.
3. Depuis `secretariat@demo-secondaire.test`, ouvrez la fiche d'un enfant d'un autre tuteur (par exemple Aya BAMBA) et copiez son identifiant. Sous le compte parent, ouvrez `/v2/parent/children/<identifiant d'Aya BAMBA>`.

**Résultat attendu :** pour un enfant qui n'est pas le sien, la page ne montre rien de l'enfant (page introuvable, ou message neutre sans donnée). Même test sur `/v2/parent/children/<id>/results`, `/finance`, `/reportcards`, `/attendance`.

4. Essayez des pages de gestion : `/v2/students`, `/v2/finance/invoices`, `/v2/admissions/applications`, `/v2/direction`.

**Résultat attendu :** « Accès refusé » ou retour à l'accueil de son portail ; jamais une liste.

- [ ] Seuls les deux enfants du parent apparaissent
- [ ] L'enfant d'un autre tuteur : aucune donnée
- [ ] Pages de gestion refusées
- [ ] Le parent ne lit pas le reçu d'un autre parent (C20.N2)

L'élève (`eleve@demo-secondaire.test`, Nadia DIABATE) est testé de la même façon : il ne voit que ses notes, ses bulletins et sa scolarité (C20.N3).

## 5.3 Permissions par rôle : adresses à essayer

Pour chaque ligne, connectez-vous avec le compte, tapez l'adresse **à la main** dans la barre d'adresse (même si le menu ne la propose pas). Résultat attendu pour toutes les lignes : « Accès refusé » (`/unauthorized`) ou retour à l'accueil, sans donnée affichée. Les fiches de rôle de la partie 2 donnent d'autres tests par rôle.

| Compte (collège) | Adresses à essayer | Pourquoi c'est refusé |
|---|---|---|
| Enseignant (`enseignant@`) | `/v2/finance`, `/v2/payroll`, `/v2/admissions`, `/v2/access/roles`, `/v2/audit`, `/v2/settings` | Aucun droit de finance, de paie, d'admission, d'administration ni d'audit. |
| Éducateur (`educateur@`) | `/v2/schoollife/validations`, `/v2/finance`, `/v2/results` | Il propose les mesures mais ne les valide pas ; pas de finance ni de résultats de période. |
| Responsable pédagogique (`pedagogie@`) | `/v2/finance`, `/v2/reportcards/issue`, `/v2/payroll` | Il relit et approuve les évaluations et lit les résultats ; il n'émet pas de bulletins et n'a ni finance ni paie. |
| Secrétariat (`secretariat@`) | `/v2/finance/payments/new`, `/v2/finance/refunds`, `/v2/payroll`, `/v2/access/roles` | Lecture seule des finances ; pas de paie ni de rôles. |
| Économe (`econome@`) | `/v2/students/new`, `/v2/assessments`, `/v2/payroll/configuration/settings`, `/v2/access/roles` | Pas de dossiers élèves ni de notes ; les réglages de paie sont au propriétaire. |
| Directeur des études (`etudes@`) | `/v2/finance`, `/v2/direction`, `/v2/payroll/configuration/settings` | Pas de finance ni de pilotage global ; (la page `/v2/direction` est réservée au propriétaire et au directeur, d'après le chapitre 16). |
| Responsable des examens (`examens@`) | `/v2/finance`, `/v2/students/new`, `/v2/results/overrides` | Il gère les sessions d'examen, pas la scolarité ni les résultats de période. |
| Chargé d'admissions (`admissions@`) | `/v2/finance`, `/v2/assessments`, `/v2/admissions/settings/workflow` | Il traite les dossiers ; la décision et les réglages sont à la direction. |
| Directeur (`directeur@`) | `/v2/payroll/configuration/settings`, `/v2/platform/tenants` | Les réglages de paie sont au propriétaire ; la console est pour l'opérateur. |
| Propriétaire | `/v2/platform/tenants` | Console réservée à l'opérateur (redirection vers `/v2/platform/login`). |
| Opérateur (`plateforme@demo.test`) | `/v2/students`, `/v2/finance` | Pas de session d'établissement : l'opérateur ne lit pas les données internes d'un établissement (à confirmer). |

- [ ] Chaque adresse ci-dessus est refusée sans afficher de donnée

> Si une adresse **est** autorisée alors que la fiche du rôle (partie 2) dit le contraire, notez-le : soit l'application est trop permissive (anomalie), soit le guide est inexact (à signaler aussi).

## 5.4 Séparation des tâches (quatre yeux)

Principe : la personne qui demande ou saisit n'est pas celle qui valide. Chacun de ces points est testé dans le chapitre indiqué.

| Contrôle | Chapitre et scénario | Attendu |
|---|---|---|
| L'enseignant fait l'appel, la direction le valide | Ch. 6, C06.N1 | L'enseignant n'a pas de bouton « Valider ». |
| Celui qui saisit les notes n'approuve pas sa feuille | Ch. 8, C08.N1 | Refus. |
| Le demandeur d'une surcharge de résultat ne l'approuve pas | Ch. 9, C09.N2 | Refus. |
| Le demandeur d'un remboursement ne l'approuve pas | Ch. 12, C12.N4 | Refus. |
| L'éducateur propose, la direction valide la mesure | Ch. 19, C19.N1 et C19.N2 | Le proposant ne valide pas. |
| Le secrétariat enregistre, la direction vérifie un dossier d'affectation | Ch. 19, C19.N3 | Refus. |
| Calcul de paie et arrêt par deux personnes ; seuil propriétaire | Ch. 13, C13.N1 et C13.12 | Refus de l'économe pour arrêter ; au-delà du seuil, validation par le propriétaire. |
| L'instituteur propose, la direction décide au conseil des maîtres | Ch. 18, C18.N1 | L'instituteur ne scelle ni ne révise. |

- [ ] Les huit contrôles sont confirmés

## 5.5 Sessions : révocation et déconnexion

Chapitre 2 (C02.8, C02.9, C02.N4).

1. Connectez-vous avec le même compte dans deux navigateurs différents (A et B).
2. Dans A, ouvrez « Mes sessions » (`/v2/account/sessions`) : deux sessions sont listées, la courante marquée.
3. Révoquez la session de B.
4. Dans B, cliquez sur un lien ou rechargez une page.

**Résultat attendu :** B est renvoyé à la connexion (avec le message « Votre session a pris fin. Reconnectez-vous. » si l'écran l'affiche). A reste connecté.

5. Dans A, utilisez « Déconnecter tous mes appareils » : A est lui aussi déconnecté. Le bouton « Précédent » du navigateur ne doit pas réafficher une page privée (à confirmer).

- [ ] Session révoquée : accès refusé au prochain clic
- [ ] Déconnexion générale effective

## 5.6 MFA (double authentification)

Chapitre 2 (C02.2, C02.6, C02.7, C02.N3, C02.N10, C02.N11).

1. Compte avec MFA (par exemple `econome@demo-secondaire.test`) : après le mot de passe, l'écran « Vérification en deux étapes » est obligatoire. Saisissez un faux code : « Code invalide. Vérifiez l'heure de votre téléphone. »
2. Saisissez le bon code (`pnpm demo:totp <e-mail>`), puis réutilisez **le même code** pour une nouvelle connexion : il doit être refusé (usage unique).
3. Comptes **sans** MFA (enseignant, parent, élève...) : aucun code demandé ; ils n'ont d'ailleurs aucun droit « sensible ».
4. Actions sensibles (rôles, remboursements, bulletins, journal d'audit...) : un compte sans MFA ne peut pas les exécuter ; les comptes MFA de la démonstration sont déjà à deux étapes, donc la fenêtre « Confirmez votre identité » ne se déclenche pas toujours (voir C02.7).
5. Un compte ne doit pas pouvoir désactiver lui-même une MFA imposée (C02.N10).

- [ ] Faux code refusé ; code réutilisé refusé
- [ ] Comptes sans MFA : pas de code demandé, pas d'acte sensible
- [ ] Désactivation de la MFA refusée là où elle est imposée

## 5.7 Traçabilité : le journal d'audit

Compte : propriétaire ou directeur (MFA), `/v2/audit` (chapitre 1).

1. Après avoir réalisé quelques actes sensibles des chapitres précédents (publier des notes, approuver un remboursement, attribuer un rôle), ouvrez le journal.
2. Filtrez par date ou par action et ouvrez une ligne (`/v2/audit/<id>`).

**Résultat attendu :** chaque acte sensible apparaît avec qui, quoi, quand ; les lignes ne sont pas modifiables. La connexion réussie n'est pas tracée (limite constatée).

- [ ] Les actes sensibles réalisés figurent dans le journal
- [ ] Aucune ligne ne peut être modifiée ou supprimée

## 5.8 Bilan de sécurité

| Test | Réussi | Échoué | Fiche d'anomalie |
|---|---|---|---|
| 5.1 Isolation entre établissements | - [ ] | - [ ] | |
| 5.2 Parent et élève limités à leurs données | - [ ] | - [ ] | |
| 5.3 Adresses interdites par rôle | - [ ] | - [ ] | |
| 5.4 Séparation des tâches | - [ ] | - [ ] | |
| 5.5 Sessions révoquées | - [ ] | - [ ] | |
| 5.6 MFA | - [ ] | - [ ] | |
| 5.7 Journal d'audit | - [ ] | - [ ] | |


# Partie 6. Fiche de recueil des anomalies

Une bonne fiche permet à l'équipe technique de **reproduire** le problème sans vous poser de question. Une fiche par anomalie. Recopiez le tableau ci-dessous dans un tableur ou dans un document partagé.

## 6.1 Modèle de tableau

| Id | Date | Rôle (compte) | Établissement | Page / adresse (URL) | Étapes pour reproduire | Résultat attendu | Résultat obtenu | Gravité | Capture |
|---|---|---|---|---|---|---|---|---|---|
| A-001 | 2026-10-05 | Secrétariat (`secretariat@demo-secondaire.test`) | `demo-secondaire` | `/v2/students` | 1. Ouvrir « Élèves ». 2. Chercher « DIABATE ». 3. Cliquer sur la première ligne. | La fiche de l'élève s'ouvre. | Message « Action non autorisée » sans explication. | Majeur | `A-001.png` |
| A-002 | | | | | | | | | |
| A-003 | | | | | | | | | |

Colonnes :

- **Id** : numéro unique (A-001, A-002...). Reprenez aussi le numéro du scénario du guide (par exemple C08.3) dans les étapes.
- **Rôle (compte)** : le rôle et l'adresse e-mail utilisés. Jamais le mot de passe.
- **Établissement** : `demo-secondaire`, `demo-primaire` ou `demo-superieur` (ou « plateforme »).
- **Page / adresse** : l'adresse complète de la barre du navigateur (sans les identifiants d'élèves si vous préférez : le nom de l'élève suffit).
- **Étapes** : numérotées, depuis la page de connexion si nécessaire, avec les valeurs saisies.
- **Résultat attendu / obtenu** : recopiez le texte exact des messages d'erreur.
- **Gravité** : voir 6.3.
- **Capture** : une image de la page entière, avec la barre d'adresse visible.

## 6.2 Conseils pour décrire une anomalie

1. **Une anomalie = une fiche.** Si deux écrans posent problème, faites deux fiches.
2. **Notez le compte et l'établissement.** Le même écran peut se comporter différemment selon le rôle (c'est justement ce que l'on teste).
3. **Écrivez ce que vous avez fait, pas ce que vous pensez.** « J'ai cliqué sur Publier, la page est restée blanche » vaut mieux que « la publication est cassée ».
4. **Recopiez les messages d'erreur mot pour mot** (y compris le code ou l'identifiant de demande s'il est affiché).
5. **Dites si c'est reproductible** : « à chaque fois », « une fois sur trois », « une seule fois ».
6. **Vérifiez avant de signaler** : rechargez la page une fois (la première visite est lente en mode développement) ; vérifiez que vous utilisez le bon compte ; vérifiez que le chapitre ne signale pas déjà ce point dans « Problèmes connus ».
7. **Ne partagez jamais** un mot de passe ou un secret de connexion dans une fiche ou une capture : masquez-les.
8. Si une **action irréversible** a été faite (clôture, scellement...), notez-la : l'équipe devra réinitialiser la démonstration.
9. Si ce qui est affiché semble **officiel** alors que ce sont des règles de démonstration (pas de bandeau, pas de filigrane), c'est une anomalie à part entière.
10. Pour une anomalie de **sécurité** (vous voyez des données d'un autre établissement ou d'un autre parent), classez-la **Bloquant** et prévenez l'équipe sans attendre la fin des tests.

## 6.3 Échelle de gravité

| Gravité | Définition | Exemples | Délai de traitement souhaité |
|---|---|---|---|
| **Bloquant** | Page ou parcours inutilisable, perte ou fuite de données, faille de sécurité ou d'isolation. | Page blanche ou erreur technique ; on voit les élèves d'un autre établissement ; un parent voit l'enfant d'un autre ; une action sensible passe sans MFA. | Avant toute suite des tests. |
| **Majeur** | Une fonction ne marche pas ou donne une donnée fausse, mais on peut contourner ou continuer ailleurs. | Un bouton ne fait rien ; un total faux ; un texte technique brut (clé de traduction) ; un lien qui mène à un refus. | Avant la fin de la recette. |
| **Mineur** | Gêne sans conséquence sur le résultat. | Libellé incohérent, faute, alignement, message peu clair, lenteur ponctuelle. | À planifier. |
| **Suggestion** | Idée d'amélioration, pas un défaut. | « Il manquerait un filtre par classe. » | À examiner. |

## 6.4 Synthèse de fin de recette

À remplir à la fin de vos tests.

| Chapitre ou parcours | Scénarios réussis | Scénarios en échec | Non testés | Fiches d'anomalies liées |
|---|---|---|---|---|
| | | | | |

- [ ] Toutes les anomalies Bloquant et Majeur sont rapportées avec capture.
- [ ] Les actions irréversibles réalisées sont listées.
- [ ] Aucun mot de passe ni secret n'a été copié dans les fiches.


# Partie 7. Limites, dépannage, glossaire et annexes

## 7.1 Limites connues de la démonstration

### Règles officielles absentes

- **Aucune règle officielle ivoirienne n'est livrée** : moyenne générale annuelle (MGA), seuils de passage, redoublement, composition et quorum des conseils, coefficients officiels, barèmes du CEPE, du BEPC et du BAC, modèles officiels de bulletin et de procès-verbal. Les packs Primaire et Secondaire fonctionnent avec des jeux de règles **de démonstration**. Ce qui est testé, c'est le **mécanisme** (calcul, explication, décision humaine, document), pas la conformité réglementaire.
- Les textes officiels à obtenir et les questions encore ouvertes sont suivis par l'équipe produit (`specs/v2/QUESTIONS-A-VALIDER.md`). Des valeurs par défaut sont appliquées en attendant.

### Envois et fournisseurs réels

- Aucun e-mail, SMS ou message WhatsApp n'est réellement envoyé (statut « Simulé »). L'adaptateur SMS Orange existe mais est en mode bac à sable : ses chemins d'API restent à confirmer avec la documentation du fournisseur.
- Aucun paiement réel : seul le fournisseur **SANDBOX** est actif. Orange Money, MTN MoMo, Wave, CinetPay et TresorPay ne sont pas configurés. Un test de ces fournisseurs n'est pas possible dans la démonstration.
- Aucune passerelle réelle vers la plateforme de l'État pour les élèves affectés.

### Mise en production

La démonstration n'est **pas** une mise en production. Ne sont pas testables ici : bascule des utilisateurs de l'ancienne application, sauvegarde et restauration sur serveur réel, comptes de production, fournisseurs de paiement et de SMS réels, performances à pleine échelle, noms de domaine personnalisés des établissements.

### Comportements connus du mode démonstration

- Première visite de chaque page lente (mode développement).
- Les anciennes pages de l'application précédente (par exemple `/parent/children`, `/tableau-de-bord`, `/register`) **ne fonctionnent pas** : utilisez uniquement les écrans commençant par `/v2/`. Le lien « S'inscrire en ligne » de l'écran de connexion mène à une page de l'ancienne application (à confirmer).
- Les alertes de direction (toutes les 15 minutes) et les relances (quotidiennes) n'apparaissent pas instantanément.
- Cache hors ligne (PWA) : désactivé par défaut. Il peut masquer des changements quand il est activé (voir le chapitre 22).
- Dates : l'année scolaire de démonstration commence le 1er septembre ; les périodes de l'établissement sont clôturées de façon accélérée par la graine.

### Défauts connus du rapport de qualité (état du 2026-10-03)

Ce rapport (`docs/qa/demo-sweep-report.md`) a balayé 38 comptes et 1 236 pages. Points qui concernent un testeur :

1. **Menus de portail parfois réduits** : pour certains rôles (parent, enseignant, élève...), le nom de l'établissement et certaines entrées de menu conditionnées par une fonctionnalité d'abonnement peuvent manquer (le rapport mesurait 5 liens pour le parent, 10 pour l'enseignant). Si une entrée de menu manque, essayez l'adresse directe `/v2/...` indiquée dans le chapitre, puis notez-le comme anomalie mineure.
2. **Refus attendus mais bruyants** : quelques écrans appellent des données non autorisées pour le rôle et affichent un état vide ou un message d'accès refusé partiel. Notez-les sans bloquer vos tests.
3. **Compte sans fiche liée** : un compte connecté sans fiche élève ou personnel (par exemple le propriétaire ouvrant le portail élève) peut afficher une erreur au lieu d'un message « aucun profil lié ».
4. **Page « Accès refusé » (`/unauthorized`)** : peut s'afficher dans l'ancienne coque (menu vide, anglais) selon la version. À signaler comme mineur.
5. Plusieurs corrections ont été faites après ce rapport (coque de navigation sur tous les écrans, routes d'admissions, liens vers des pages interdites). Elles sont **à reconfirmer** sur votre démonstration : si l'équipe technique n'a pas redémarré la démonstration depuis la dernière version, ces défauts peuvent encore apparaître.
6. **États vides** : certaines pages peuvent être vides sans que ce soit un défaut (salles, remises, sessions de caisse, périodes de paie, comptes liés aux fiches). Le chapitre concerné dit quand une page vide est normale.

## 7.2 Ce qui n'est pas testable avec la démonstration

| Sujet | Pourquoi | Que faire |
|---|---|---|
| Conformité aux règles officielles ivoiriennes | Jeux de règles de démonstration | Faire valider les textes officiels par la direction avant la production. |
| Réception réelle d'un SMS, d'un e-mail, d'un WhatsApp | Envois simulés | Vérifier le journal des notifications (statut « Simulé ») et le contenu du message. |
| Paiement Mobile Money réel | Fournisseur SANDBOX uniquement | Tester les trois comportements du bac à sable (réussi, en attente, échec). |
| Échange avec la plateforme de l'État | Spécification officielle inconnue | Tester la saisie manuelle et le rapprochement. |
| Mise en production, reprise des données de l'ancienne application | Hors périmètre | Voir `docs/ETAT_IMPLEMENTATION.md`. |
| Montée en charge (nombreux utilisateurs simultanés) | Poste unique, mode développement | Tests de charge menés séparément par l'équipe technique. |

## 7.3 Dépannage

| Symptôme | Cause probable et remède |
|---|---|
| « Docker est introuvable ou son démon n'est pas démarré » | Lancez Docker Desktop, attendez qu'il soit prêt, puis relancez `pnpm demo:up`. |
| Le port 3100 (ou 4100) est occupé | Le script choisit automatiquement le port libre suivant : lisez les adresses affichées ou tapez `pnpm demo:status`. Pour imposer un port : `pnpm demo:up -- --web-port=3200`. |
| « Une démonstration est déjà en cours » | `pnpm demo:down`, puis `pnpm demo:up`. |
| La page est très lente ou tourne sans fin | Normal à la première visite (mode développement) : attendez jusqu'à une minute, puis rechargez une fois. Si cela dure plus de 2 minutes, consultez le journal `.demo/logs/web.log`. |
| Page blanche ou erreur de compilation | Rechargez ; sinon `pnpm demo:down` puis `pnpm demo:up` (ou `pnpm demo:restart-web`). |
| La connexion avec MFA est refusée | Le code ne sert qu'une fois : attendez le code suivant (30 secondes) et retapez `pnpm demo:totp <e-mail>`. L'horloge de l'ordinateur doit être à l'heure. Vérifiez aussi que vous utilisez l'e-mail du bon établissement. |
| La connexion est refusée avec un message neutre (identifiants incorrects) | Rouvrez `.demo/credentials.md` : les mots de passe changent après chaque `pnpm demo:reset`. |
| Le compte demandé n'existe pas dans cet établissement | Vérifiez l'établissement dans l'adresse (`demo-secondaire.localhost`...) : certains comptes n'existent que dans un établissement (par exemple l'instituteur de la maternelle au primaire). |
| Après connexion, la page tourne sans fin | Vous êtes sur une page de l'ancienne application : ouvrez une adresse commençant par `/v2/`. |
| Le PDF d'un bulletin reste « en cours » ou échoue | Le worker n'a trouvé ni Chrome, ni Chromium, ni Edge sur la machine. Installez-en un (Edge suffit sous Windows) ou renseignez la variable `REPORTCARDS_CHROME_PATH`, puis relancez. Journal : `.demo/logs/worker.log`. |
| Le lien d'invitation ou de réinitialisation n'arrive pas | Normal : rien n'est envoyé. Ouvrez `.demo/mailbox.jsonl` et copiez le champ `link` de la dernière ligne du bon destinataire. |
| Le seed échoue (« le tenant existe déjà ») | `pnpm demo:reset` puis `pnpm demo:up` (seules les ressources `ed-demo-*` et le dossier `.demo/` sont supprimés). |
| « Des ressources Docker de démonstration existent mais .demo/secrets.json est absent » | Une autre copie du projet a laissé des conteneurs : `pnpm demo:reset` puis `pnpm demo:up`. |
| `*.localhost` ne s'ouvre pas | Utilisez un navigateur récent (Chrome, Edge, Firefox). Sinon, utilisez `http://localhost:3100/v2/login` (établissement par défaut : `demo-secondaire`). |
| Les modifications du guide ne se voient pas hors ligne | Désinscrivez le service worker dans les outils du navigateur (voir le chapitre 22). |
| Je veux recommencer proprement | `pnpm demo:reset` puis `pnpm demo:up` : tous les mots de passe changent. |

## 7.4 Glossaire

| Terme | Explication simple |
|---|---|
| **Établissement** (« tenant ») | Une école, un collège ou une université avec ses propres données, comptes et règles. Les établissements sont totalement séparés. |
| **Isolation (RLS)** | Mécanisme de protection de la base de données qui garantit que chaque requête ne « voit » que les lignes de son propre établissement. Même en cas d'erreur d'un écran, les données d'un autre établissement restent invisibles. RLS = « sécurité au niveau des lignes ». |
| **Rôle** | Un ensemble de droits (propriétaire, directeur, enseignant...). Un compte peut avoir plusieurs rôles. |
| **Permission** | Un droit précis (lire les notes, valider un appel...). Le menu est construit à partir des permissions. |
| **MFA** (double authentification) | Deuxième étape de connexion : un code à 6 chiffres qui change toutes les 30 secondes. |
| **Séparation des tâches** (« quatre yeux ») | Une action sensible doit être faite par une personne et validée par une autre. |
| **Sandbox** | Environnement d'essai : aucun argent ni message réel. |
| **Pack** | Ensemble de fonctions propres à un niveau d'enseignement : Primaire, Secondaire, Supérieur. |
| **Jeu de règles** (RuleSet) | Ensemble de règles de calcul (moyennes, décisions). Ceux de la démonstration sont fictifs (« placeholder »). |
| **MGA** | Moyenne générale annuelle. |
| **CEPE** | Certificat d'études primaires élémentaires (examen de fin de primaire). |
| **BEPC** | Brevet d'études du premier cycle (examen de fin de collège). |
| **BAC** | Baccalauréat (examen de fin de lycée). |
| **LMD** | Licence - Master - Doctorat : organisation des études supérieures en semestres et crédits. |
| **UE** | Unité d'enseignement : un bloc de cours qui rapporte des crédits. |
| **ECUE** | Élément constitutif d'une unité d'enseignement : une matière à l'intérieur d'une UE. |
| **Crédits** | Points capitalisés quand une UE est validée. |
| **Semestre validé** | Dans la démonstration : toutes les UE du semestre sont validées. |
| **Rattrapage** | Seconde chance après un échec : la note de rattrapage **remplace** la note initiale (décision métier). |
| **Bulletin** | Document de résultats d'une période, en PDF signé. |
| **Scellement** | Verrouillage définitif d'un document (par exemple un bilan annuel) : version unique, non modifiable. |
| **Publication** | Rendre visible aux familles ou aux élèves. |
| **Appel journalier / par séance** | Appel fait une fois par jour (maternelle, primaire) ou à chaque cours (secondaire). |
| **Élève affecté par l'État** | Élève placé dans l'établissement par l'État : sa facture est partagée entre la famille et l'État. |
| **Conseil de classe / conseil des maîtres** | Réunion qui examine les résultats et enregistre des décisions **humaines** (passage, redoublement...). |
| **Examen blanc** | Examen d'entraînement : aucun document officiel n'en découle. |
| **Hors ligne (PWA)** | L'application continue de fonctionner sans réseau et rejoue vos saisies au retour de la connexion. |
| **Journal d'audit** | Registre non modifiable des actions importantes (qui, quoi, quand). |
| **Impersonation** | L'opérateur de la plateforme agit « en tant que » un établissement, avec trace dans l'audit. |
| **GED** | Gestion électronique des documents. |
| **Page introuvable (uniforme)** | Réponse identique pour un élément qui n'existe pas et pour un élément qu'on n'a pas le droit de voir. |
| **Outbox / worker** | Mécanismes internes qui envoient les messages et calculent en arrière-plan ; invisibles pour vous, sauf par leur effet différé. |


# Annexe. Récapitulatif des adresses (URL)

## A. Adresses de base par établissement

| Établissement | Connexion | Accueil de gestion | Remarque |
|---|---|---|---|
| Collège Le Baobab (`demo-secondaire`) | `http://demo-secondaire.localhost:3100/v2/login` | `http://demo-secondaire.localhost:3100/v2/home` | Établissement par défaut : `http://localhost:3100/v2/login` y mène aussi. |
| École Les Palmiers (`demo-primaire`) | `http://demo-primaire.localhost:3100/v2/login` | `http://demo-primaire.localhost:3100/v2/home` | Pack Primaire. |
| Université Horizon (`demo-superieur`) | `http://demo-superieur.localhost:3100/v2/login` | `http://demo-superieur.localhost:3100/v2/home` | Pack Supérieur. |
| Console de la plateforme | `http://localhost:3100/v2/platform/login` | `http://localhost:3100/v2/platform/tenants` | Opérateur `plateforme@demo.test`. |

Pages sans connexion (publiques) : `/v2/verify` (vérification d'un document par son code), `/v2/apply/<lien de l'établissement>` (dépôt de candidature, fermé tant que la direction n'a pas créé le lien : chapitre 17), `/v2/forgot-password`, `/v2/reset-password`.

Si le port 3100 est occupé, remplacez-le par le port affiché par `pnpm demo:status`.

## B. Pages d'atterrissage par rôle

| Rôle | Adresse d'arrivée |
|---|---|
| Propriétaire, directeur | `/v2/direction` |
| Directeur des études | `/v2/academic` (ouvre « Années et périodes ») |
| Responsable pédagogique | `/v2/assessments` |
| Secrétariat | `/v2/students` |
| Économe | `/v2/finance` |
| Enseignant | `/v2/teacher` |
| Instituteur | `/v2/primary` (ouvre « Ma classe (primaire) ») |
| Éducateur | `/v2/attendance` |
| Responsable des examens | `/v2/examinations` |
| Chargé d'admissions | `/v2/admissions` |
| Parent | `/v2/parent` |
| Élève | `/v2/student` |
| Opérateur | `/v2/platform/tenants` |

## C. Adresses par domaine (à ajouter après l'adresse de l'établissement)

Colonne « Où » : S = secondaire, P = primaire, U = supérieur, T = les trois.

| Domaine (chapitre) | Adresses principales | Où |
|---|---|---|
| Établissement, abonnement (1) | `/v2/settings`, `/v2/settings/subscription`, `/v2/settings/institutions`, `/v2/settings/onboarding` | T |
| Rôles et accès (1) | `/v2/access`, `/v2/access/roles`, `/v2/access/roles/new`, `/v2/access/assignments`, `/v2/admin/members` | T |
| Journal d'audit (1) | `/v2/audit` | T |
| Console plateforme (1) | `/v2/platform/tenants`, `/v2/platform/tenants/new`, `/v2/platform/plans`, `/v2/platform/audit` | console |
| Compte et sécurité (2) | `/v2/account/security`, `/v2/account/sessions`, `/v2/account/tenants`, `/v2/account/notifications` | T |
| Structure académique (3) | `/v2/academic/years`, `/v2/academic/programs`, `/v2/academic/curriculum`, `/v2/academic/classrooms`, `/v2/academic/offerings`, `/v2/academic/rollover`, `/v2/academic/settings`, `/v2/enrollments`, `/v2/enrollments/new` | T (offres de cours : U) |
| Élèves, tuteurs, personnel (4) | `/v2/students`, `/v2/students/new`, `/v2/guardians`, `/v2/staff`, `/v2/staff/new`, `/v2/staff/assignments`, `/v2/staff/me` | T |
| Imports (5) | `/v2/imports`, `/v2/imports/new`, `/v2/imports/templates`, `/v2/imports/settings` | T |
| Présences (6) | `/v2/attendance`, `/v2/attendance/call`, `/v2/attendance/sessions`, `/v2/attendance/absences`, `/v2/attendance/justifications`, `/v2/attendance/alerts`, `/v2/attendance/conflicts`, `/v2/attendance/staff` | T |
| Emploi du temps (7) | `/v2/schedule`, `/v2/schedule/today`, `/v2/schedule/timetables`, `/v2/schedule/occurrences`, `/v2/schedule/replacements`, `/v2/schedule/rooms`, `/v2/schedule/export` | T |
| Évaluations et notes (8) | `/v2/assessments`, `/v2/assessments/new`, `/v2/assessments/revisions`, `/v2/assessments/types` | T |
| Règles et résultats (9) | `/v2/rules`, `/v2/rules/bindings`, `/v2/results`, `/v2/results/matrix`, `/v2/results/decisions`, `/v2/results/overrides`, `/v2/results/resit` | T |
| Bulletins (10) | `/v2/reportcards`, `/v2/reportcards/issue`, `/v2/reportcards/templates`, `/v2/reportcards/identity`, `/v2/reportcards/signatories`, `/v2/reportcards/family`, `/v2/verify` | T |
| Supérieur (11) | `/v2/higher`, `/v2/higher/credits`, `/v2/higher/diplomas`, `/v2/higher/documents`, `/v2/higher/attestations`, `/v2/higher/prerequisites`, `/v2/higher/resit`, `/v2/higher/signatories`, `/v2/higher/me/documents` | U |
| Finance (12) | `/v2/finance`, `/v2/finance/fees`, `/v2/finance/fees/plans`, `/v2/finance/fees/discounts`, `/v2/finance/fees/schedules`, `/v2/finance/invoices`, `/v2/finance/invoices/new`, `/v2/finance/payments`, `/v2/finance/payments/new`, `/v2/finance/payments/online`, `/v2/finance/payments/pending`, `/v2/finance/receipts`, `/v2/finance/refunds`, `/v2/finance/cash`, `/v2/finance/funding`, `/v2/finance/providers`, `/v2/finance/webhooks`, `/v2/finance/reports`, `/v2/finance/me` | T |
| Paie (13) | `/v2/payroll`, `/v2/payroll/configuration`, `/v2/payroll/configuration/rates`, `/v2/payroll/configuration/settings`, `/v2/payroll/payslips`, `/v2/payroll/history`, `/v2/payroll/reports`, `/v2/payroll/owner`, `/v2/payroll/my` | T |
| Documents (14) | `/v2/documents`, `/v2/documents/categories`, `/v2/documents/expirations`, `/v2/documents/quarantine`, `/v2/documents/settings` | T |
| Messagerie (15) | `/v2/messages`, `/v2/messages/new`, `/v2/messages/moderation`, `/v2/messages/settings`, `/v2/announcements`, `/v2/announcements/new`, `/v2/notifications`, `/v2/notifications/channels`, `/v2/notifications/rules`, `/v2/notifications/send`, `/v2/notifications/templates` | T |
| Pilotage (16) | `/v2/direction`, `/v2/direction/effectifs`, `/v2/analytics`, `/v2/analytics/admissions`, `/v2/analytics/vie-scolaire`, `/v2/analytics/comparaisons`, `/v2/analytics/alertes`, `/v2/analytics/alertes/regles`, `/v2/owner/pedagogie`, `/v2/owner/scolarite`, `/v2/owner/tresorerie`, `/v2/owner/paie`, `/v2/owner/charges`, `/v2/owner/fraicheur` | T |
| Admissions (17) | `/v2/admissions`, `/v2/admissions/applications`, `/v2/admissions/applications/new`, `/v2/admissions/campaigns`, `/v2/admissions/prospects`, `/v2/admissions/waitlist`, `/v2/admissions/reports`, `/v2/admissions/settings`, `/v2/admissions/settings/workflow` | T |
| Pack Primaire (18) | `/v2/primary/classe`, `/v2/primary/competences`, `/v2/primary/appreciations`, `/v2/primary/conseil`, `/v2/primary/bilans`, `/v2/primary/archives`, `/v2/primary/etats`, `/v2/primary/direction`, `/v2/primary/parametres`, `/v2/primary/mon-enfant` | P |
| Examens (18, 19) | `/v2/examinations`, `/v2/examinations/types`, `/v2/examinations/centers`, `/v2/examinations/candidates`, `/v2/examinations/mock`, `/v2/examinations/results`, `/v2/examinations/statistics`, `/v2/examinations/exports`, `/v2/examinations/corrections`, `/v2/examinations/family` | T (données de démonstration : S) |
| Vie scolaire (19) | `/v2/schoollife`, `/v2/schoollife/saisie`, `/v2/schoollife/validations`, `/v2/schoollife/convocations`, `/v2/schoollife/parametres`, `/v2/schoollife/famille`, `/v2/schoollife/moi` | S |
| Affectés par l'État (19) | `/v2/stateassign`, `/v2/stateassign/verification`, `/v2/stateassign/reconciliation`, `/v2/stateassign/receivables`, `/v2/stateassign/reports`, `/v2/stateassign/settings`, `/v2/stateassign/family` | S |
| Conseils de classe (19) | `/v2/councils`, `/v2/councils/effets`, `/v2/councils/orientation`, `/v2/councils/parametres`, `/v2/councils/famille`, `/v2/councils/moi` | S |
| Portail parent (20) | `/v2/parent`, `/v2/parent/account`, `/v2/students/children`, `/v2/attendance/children`, `/v2/finance/me` | T |
| Portail élève (20) | `/v2/student`, `/v2/student/results`, `/v2/student/reportcards`, `/v2/student/schedule`, `/v2/student/attendance`, `/v2/student/finance`, `/v2/student/documents`, `/v2/student/upcoming`, `/v2/student/profile` | T |
| Portail enseignant (20) | `/v2/teacher`, `/v2/teacher/classes`, `/v2/teacher/assessments`, `/v2/teacher/attendance`, `/v2/teacher/schedule`, `/v2/teacher/payslips`, `/v2/teacher/leaves`, `/v2/teacher/profile` | T |

Les adresses contenant un identifiant (par exemple `/v2/students/<identifiant>`) s'ouvrent depuis les listes : cliquez sur une ligne plutôt que de les taper.

## D. Fichiers et commandes utiles

| Élément | Emplacement ou commande |
|---|---|
| Comptes, mots de passe, secrets MFA | `.demo/credentials.md` (local, ne jamais partager) |
| Code MFA d'un compte | `pnpm demo:totp <e-mail>` |
| Liens d'invitation et de réinitialisation | `.demo/mailbox.jsonl` (champ `link`) |
| Modèles d'import CSV / Excel | `.demo/import-templates/` |
| Journaux | `.demo/logs/` (`web.log`, `api.log`, `worker.log`, `seed.log`) |
| État de la démonstration | `pnpm demo:status` |
| Contrôle automatique | `pnpm demo:smoke` |
| Guide technique de la démonstration | `docs/DEMO_TEST_GUIDE.md` |
| Rapport de qualité (défauts connus) | `docs/qa/demo-sweep-report.md` |
| État d'implémentation | `docs/ETAT_IMPLEMENTATION.md` |

