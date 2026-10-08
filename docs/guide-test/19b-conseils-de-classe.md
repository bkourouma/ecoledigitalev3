# Chapitre 19b. Pack secondaire : conseils de classe

> Établissement : Collège Le Baobab (démonstration), `secondaire-test`, pack Secondaire uniquement. Adresse du navigateur : `http://localhost:3000`. Durée estimée : 3 h 30 à 4 h, en deux séances.
> Deuxième des trois parties du chapitre 19 (19a vie scolaire, 19b conseils de classe, 19c élèves affectés par l'État). Les scénarios sont numérotés 19.25 à 19.53.

## Objectif

Vérifier le cycle d'un conseil de classe : **préparation** (planifier, composer la séance, figer les faits de chaque élève, convoquer) → **délibération** (propositions, décisions humaines, mode séance) → **décisions et orientation** → **procès-verbal** (PDF, signatures, déverrouillage motivé) → **effets** sur le dossier de l'élève. Le module n'invente rien : il ne calcule aucune moyenne, aucun passage, aucun redoublement ; il fige les résultats lus dans le module des résultats, recueille des propositions et des décisions **humaines**. Les règles affichées sont des **règles de démonstration** (bandeau « Règles de démonstration — non réglementaires ») : aucune règle officielle ivoirienne n'est livrée (quorum vide, aucun parcours d'orientation).

## Prérequis

- Base de démonstration fraîche (`pnpm dev:v2:seed`), application, API et, pour le PDF du procès-verbal, le worker démarrés.
- Chapitre 19a lu (conventions : "J" = jour du test, noms "test guide", comptes sur la page `/login`).
- **Deux séances sont utilisées** : (1) une séance **test guide** créée sur le Trimestre 1 pour essayer la planification, la composition, la préparation, la convocation et l'annulation ; (2) la séance **de démonstration** du Trimestre 2 (« Conseil de classe de la période 2 (démonstration) »), déjà ouverte, pour la délibération, la clôture, le procès-verbal, le déverrouillage et les effets. Raison : les résultats du Trimestre 1 sont **clôturés** par la graine, et le module des résultats refuse d'ouvrir une délibération sur une période clôturée ; une séance du Trimestre 1 ne peut donc jamais s'ouvrir (cas à vérifier en 19.31).

## Comptes à utiliser (établissement `secondaire-test`)

| Rôle | E-mail | MFA | Rôle dans ce chapitre |
|---|---|---|---|
| Directeur des études | `etudes@secondaire-test.test` | oui | Planifie, prépare, ouvre, clôt, enregistre les décisions, génère le procès-verbal, demande le déverrouillage, règle les paramètres. |
| Directeur | `directeur@secondaire-test.test` | oui | Tout, dont approuver un déverrouillage, rouvrir, révoquer un procès-verbal. |
| Secrétariat | `secretariat@secondaire-test.test` | oui | Planifie, convoque, génère et signe le procès-verbal ; ne décide pas, n'ouvre pas, ne clôt pas. |
| Enseignant (TRAORE Kouadio) | `enseignant@secondaire-test.test` | non | Consulte, **propose**, ne décide pas. |
| Parent (DIABATE Séka) | `parent@secondaire-test.test` | non | Lit les décisions visibles de Nadia et Salimata, exprime des vœux d'orientation. |
| Élève (DIABATE Nadia) | `eleve@secondaire-test.test` | non | Lit ses décisions et son orientation (lecture seule). |
| Éducateur, économe | `educateur@…`, `econome@secondaire-test.test` | non / oui | Aucun accès aux conseils (contrôle de droit). |

## Droits (qui peut ouvrir quoi)

Source : gardes de page `apps/web/src/app/v2/councils/**/page.tsx`, manifeste `apps/api/src/modules/councils/manifest.ts`, modèles de rôles `rbac/templates/system-roles.ts`.

| Écran | Adresse | Directeur | Dir. études | Secrétariat | Enseignant | Parent | Élève |
|---|---|---|---|---|---|---|---|
| Calendrier des conseils | `/v2/councils` | oui | oui | oui | oui | non | non |
| Dossier de classe d'une séance | `/v2/councils/<identifiant>` | oui | oui | oui | oui | non | non |
| Délibération (mode séance) | `/v2/councils/<identifiant>/deliberation` | oui | oui | oui | oui | non | non |
| Fiche d'un élève dans la séance | `/v2/councils/<identifiant>/eleves/<identifiant-ligne>` | oui | oui | oui | oui | non | non |
| Historique de la séance | `/v2/councils/<identifiant>/historique` | oui | oui | oui | oui | non | non |
| Procès-verbal | `/v2/councils/<identifiant>/pv` | oui | oui | oui | non | non | non |
| Effets des décisions | `/v2/councils/effets` | oui | oui | non | non | non | non |
| Orientation | `/v2/councils/orientation` | oui | oui | non | non | non | non |
| Paramètres | `/v2/councils/parametres` | oui | oui | non | non | non | non |
| Décisions de mes enfants | `/v2/councils/famille` | non | non | non | non | oui | non |
| Mes décisions | `/v2/councils/moi` | non | non | non | non | non | oui |

Actions (boutons visibles selon le droit, l'API refuse de toute façon) :

| Action | Directeur | Dir. études | Secrétariat | Enseignant |
|---|---|---|---|---|
| Planifier, modifier, convoquer, annuler, ajouter/retirer un participant | oui | oui | oui | non |
| Préparer l'ordre du jour, reconstruire les faits | oui | oui | non | non |
| Ouvrir, clore, saisir la présence, marquer un élève examiné | oui | oui | non | non |
| Ajouter une proposition | oui | oui | non | oui |
| Accepter, refuser, retirer une proposition ; enregistrer ou retirer une décision | oui | oui | non | non |
| Générer et signer le procès-verbal | oui | oui | oui | non |
| Révoquer un procès-verbal ; **approuver** un déverrouillage et **rouvrir** | oui | non | non | non |
| Demander un déverrouillage | oui | oui | non | non |

**Adresses à taper à la main, qui doivent être refusées** (page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page.") :

| Compte | Adresses interdites |
|---|---|
| Enseignant | `/v2/councils/parametres`, `/v2/councils/effets`, `/v2/councils/orientation`, `/v2/councils/<identifiant>/pv` |
| Secrétariat | `/v2/councils/parametres`, `/v2/councils/effets`, `/v2/councils/orientation` |
| Parent | `/v2/councils`, `/v2/councils/parametres`, `/v2/councils/moi`, `/v2/councils/<identifiant>` |
| Élève | `/v2/councils`, `/v2/councils/famille`, `/v2/councils/orientation` |
| Éducateur, économe | `/v2/councils`, `/v2/councils/famille`, `/v2/councils/parametres` |

## Données de départ (graine de démonstration)

Source : `scripts/seed-v2/demo/councils.ts` (étape "période 2 : notes publiées et verrouillées, conseil de classe OUVERT"), réglages issus du modèle `apps/api/src/modules/councils/templates/CI/secondary.json`.

| Élément | Contenu |
|---|---|
| Séance de démonstration | « Conseil de classe de la période 2 (démonstration) », classe 6e A, type "Conseil de classe de période", période "Trimestre 2", statut « En séance » (ouverte), date prévue J+1 de la graine |
| Participants | PRESIDENT Conseil (rôle "Président du conseil", fonction « Président », **Présent**) ; SECRETAIRE Conseil ("Secrétaire de séance", fonction « Secrétaire », **Présent**) ; les trois enseignants de la classe (TRAORE Kouadio, YAO Fatou, KOUAME Adjoua, rôle « Enseignant de la classe », **Présents**). Les deux fiches « Conseil » sont des fiches du personnel fictives **sans compte de connexion**. |
| Ordre du jour | un élève par inscription active de la classe (environ 9, dont ADOU Aïcha, inscrite après les notes), statut « À examiner », faits figés (version 1) |
| Proposition | sur l'élève n° 1 : « Appréciation » « Élève sérieux et appliqué (proposition de démonstration). », proposée par l'enseignant, statut « Proposée » |
| Résultats | Trimestre 1 : **clôturé** (résultats FINAL calculés par le jeu de règles de démonstration) ; Trimestre 2 : notes publiées et **verrouillées** (pas de résultats calculés) ; Trimestre 3 : pas encore de résultats |
| Types de conseil | "Conseil de classe de période" (portée Période) et "Conseil de classe de fin d'année" (portée Année) ; **quorum minimal vide** (aucun contrôle), signataires : fonctions Président et Secrétaire |
| Rôles de participants (7) | Président du conseil (peut décider), Secrétaire de séance, Professeur principal, Enseignant de la classe, Éducateur / vie scolaire, Délégué des élèves, Délégué des parents |
| Types de décision (7) | Passage en classe supérieure, Redoublement, Orientation (tous trois de portée Année), Réorientation, Exclusion (recommandation du conseil), Avis requis du conseil, Autre décision (portée Période et Année) |
| Réglages | déverrouillage approuvé par une autre personne : **oui** ; effets des décisions : **À la signature du procès-verbal** ; visibilité pour les familles : **Après notification** ; ouverture sans quorum avec motif : **autorisée** |
| Orientation | aucun parcours autorisé, aucun dossier, aucun transfert |


## Données créées par ce chapitre

Une séance "Conseil de classe T1 test guide" (annulée en fin de parcours), propositions et décisions "test guide" sur la séance de démonstration (retirées ou restées en l'état), un procès-verbal (version 1 puis remplacé), un rôle, un type de décision, un parcours d'orientation, un dossier d'orientation avec vœux, un transfert annulé. **Aucune suppression** : une séance s'annule, une décision se retire, une proposition se retire, un type se désactive. Voir la liste en fin de fichier. Pour repartir de zéro : réinitialiser la base de démonstration.

---

## Partie A. Lecture : calendrier, synthèse, dossier d'une séance

#### 19.25 Calendrier des conseils de classe
Compte : Directeur des études · Où : menu « Conseils de classe » > « Conseils de classe » (`/v2/councils`) · Prérequis : base intacte.
1. Ouvrir la page « Calendrier des conseils de classe ». Lire les onglets de section : « Calendrier des conseils », « Effets des décisions », « Orientation », « Paramètres ».
2. Lire le tableau « Conseils de classe » (colonnes « Conseil », « Classe », « Période », « Date », « Statut », « Avancement », « Résultats »).
3. Utiliser les filtres du formulaire « Filtres du calendrier » : « Classe » = 6e A ; « Année scolaire » = l'année courante puis « Période » = Trimestre 2 ; « Statut » = « En séance » puis « Clos » ; « À partir du » et « Jusqu'au ».
4. Cliquer sur le titre de la séance.

Résultat attendu : une ligne « Conseil de classe de la période 2 (démonstration) », classe 6e A, période Trimestre 2, statut « En séance », avancement du type « 0 décidé(s) sur 9 · 5 présent(s) sur 5 », résultats « Résultats non liés » ou « Résultats liés » (valeur à relever). Avec le filtre « Clos » : « Aucun conseil » et « Aucune séance ne correspond à ces filtres. ». Le titre mène à `/v2/councils/<identifiant>`. Le bouton « Planifier un conseil » est visible (directeur des études, secrétariat, directeur) ; la liste « Période » est désactivée tant qu'aucune année n'est choisie.
- [ ] Cas nominal  - [ ] État vide d'un filtre  - [ ] Droit refusé pour le parent (`/v2/councils`)

#### 19.26 Synthèse de la classe et alerte "conseil à revoir"
Compte : Directeur des études · Où : `/v2/councils`, filtre « Classe » · Prérequis : 19.25.
1. Choisir « Classe » = 6e A.
2. Lire le bloc « Synthèse de la classe ».

Résultat attendu : le bloc affiche les pastilles des effets « 0 en attente », « 0 en échec », « 0 à appliquer par un humain » (aucun effet tant que la séance n'est pas signée), et, sous « Décisions par code », rien tant qu'aucune décision n'est enregistrée. L'avertissement « Conseil à revoir : la période de résultats a été rouverte sous une séance signée. La direction décide de la suite. » n'apparaît que si la période de résultats est rouverte sous une séance signée (non reproductible ici : aucune séance ne peut être signée, voir 19.40).
- [ ] Cas nominal  - [ ] Alerte "à revoir" non testable

#### 19.27 Dossier de classe de la séance de démonstration (lecture)
Compte : Directeur des études (puis Enseignant) · Où : calendrier > titre de la séance (`/v2/councils/<identifiant>`) · Prérequis : base intacte.
1. Ouvrir la séance. Lire le titre, la description « Préparation et déroulement de la séance : quorum, participants, ordre du jour par élève. » et les sous-onglets « Dossier de classe », « Délibération », « Procès-verbal », « Historique ».
2. Lire le bandeau « Règles de démonstration — non réglementaires ».
3. Lire le cadre « État de la séance » : statut, badge de quorum, ligne de présence, date.
4. Lire le tableau « Participants et présence », puis le tableau « Ordre du jour par élève ».
5. Lire les boutons d'action : « Clore la séance », « Modifier », « Annuler la séance », « Passer en mode séance », « Voir les effets ».
6. Se reconnecter en **enseignant** (menu du portail « Conseils de classe ») et ouvrir la même séance.

Résultat attendu : le bandeau de démonstration est visible. Statut « En séance », badge « Quorum atteint », ligne « 5 présent(s) — aucun minimum défini ». Le tableau des participants liste cinq lignes dont "PRESIDENT Conseil" (Président du conseil, fonction « Président », « Présent ») et "SECRETAIRE Conseil" (« Secrétaire »), les participants sans voix délibérative portant la mention « sans voix délibérative ». L'ordre du jour liste un élève par ligne avec « Faits » « Version 1 », statut « À examiner », « Décisions » 0, « Propositions à traiter » (1 pour l'élève n° 1). Pour l'enseignant : tout est lisible, mais ni « Clore la séance », ni « Modifier », ni « Annuler la séance », ni « Préparer la séance » ; le sous-onglet « Procès-verbal » est absent. Écart connu : un lien « Passer en mode séance » et un lien « Voir les effets » restent visibles pour l'enseignant ; ce dernier mène à « Accès refusé » (E-19b-3).
- [ ] Cas nominal  - [ ] Vue enseignant  - [ ] Droit refusé : l'enseignant ne voit pas « Procès-verbal »

---

## Partie B. Planifier, composer, préparer et convoquer une séance (séance "test guide", Trimestre 1)

#### 19.28 Planifier un conseil de classe
Compte : Directeur des études · Où : `/v2/councils` > « Planifier un conseil » · Prérequis : aucun.
1. Cliquer sur « Planifier un conseil » (fenêtre « Planifier un conseil de classe ») et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Classe | 6e A | oui |
   | Type de conseil | Conseil de classe de période | oui |
   | Année scolaire | l'année courante (présélectionnée) | non |
   | Période | Trimestre 1 | oui pour ce type |
   | Intitulé (facultatif) | Conseil de classe T1 test guide | non |
   | Date prévue | J+2 | non |
   | Heure | 14:00 | non |
   | Lieu | Salle des professeurs test guide | non |
2. Cliquer sur « Planifier ».
3. Cliquer sur le lien « Ouvrir la séance » du message.

Résultat attendu : message « Séance créée. » avec le lien « Ouvrir la séance ». La séance apparaît au calendrier avec le statut « Planifié ». Dans le dossier : bandeau de démonstration, statut « Planifié », aucun participant (« Aucun participant pour le moment. »), ordre du jour vide (« Aucun élève à l'ordre du jour »), avertissements "L'ordre du jour n'est pas préparé." et "Aucun président présent : la séance ne peut pas être ouverte.".
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Classe non choisie | « Ce champ est obligatoire. » sous « Classe » |
| Type non choisi | « Ce champ est obligatoire. » sous « Type de conseil » |
| Type « Période » sans période | « Ce type de conseil porte sur une période : choisissez-la. » |
| 6e A + Conseil de classe de période + Trimestre 2 (séance de démonstration existante) | message du serveur "Un conseil de ce type existe déjà pour cette classe et cette période." |
| 6e A + Trimestre 3 | refus du serveur (résultats absents ou non verrouillés), texte à relever en test |
| Type "Conseil de classe de fin d'année" (portée Année) | message à relever en test (état des résultats annuels) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'enseignant ne voit pas « Planifier un conseil »

#### 19.29 Composer la séance : participants et modification
Compte : Directeur des études · Où : dossier de la séance test guide (`/v2/councils/<identifiant>`) · Prérequis : 19.28.
1. Lire « Participants proposés » (« Proposés d'après les affectations d'enseignement de la classe ; aucun nom n'est figé avant l'ajout. ») : les trois enseignants de la classe, avec le code de rôle `TEACHER`.
2. Cliquer sur « Ajouter TRAORE Kouadio ». Fenêtre « Ajouter un participant » : **Membre du personnel** = TRAORE Kouadio ; **Rôle** = Président du conseil ; **Fonction** = Président. Cliquer sur « Ajouter » : « Participant ajouté. ».
3. Même procédure pour YAO Fatou : Rôle = Secrétaire de séance, Fonction = Secrétaire. Pour KOUAME Adjoua : Rôle = Professeur principal, Fonction = Aucune.
4. Essayer : ajouter à nouveau un participant avec le rôle « Enseignant de la classe » et la fonction « Président » (par « Ajouter un participant »).
5. Cliquer sur « Retirer » en face de KOUAME Adjoua (« Retirer KOUAME Adjoua »), puis l'ajouter de nouveau.
6. Cliquer sur « Modifier » (fenêtre « Modifier la séance ») : changer le Lieu en "Salle des professeurs test guide, étage 1" puis « Enregistrer ».

Résultat attendu : chaque ajout affiche « Participant ajouté. » et une ligne dans le tableau « Participants et présence » avec la présence « Convoqué » et la mention « Non convoqué » dans la colonne « Convocation ». À l'étape 5 : « Participant retiré. ». Étape 6 : « Séance mise à jour. ». Le bouton « Ajouter un participant » n'est proposé que tant que la séance est « Planifié ». Les noms sont figés à l'ajout.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Rôle non choisi | « Ce champ est obligatoire. » sous « Rôle » |
| Aucun membre du personnel choisi (rôle rempli) | "Désignez un membre du personnel ou une personne externe." |
| Fonction « Président » avec un rôle qui ne peut pas décider (Enseignant de la classe) | message du serveur "Ce rôle ne peut pas présider la séance." |
| Deuxième personne avec la fonction « Président » | message du serveur "Cet enregistrement existe déjà." (un seul président par séance) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant (aucun bouton « Ajouter un participant »)

#### 19.30 Préparer l'ordre du jour et convoquer les participants
Compte : Directeur des études · Où : dossier de la séance test guide · Prérequis : 19.29.
1. Cliquer sur « Préparer la séance ».
2. Lire le tableau « Ordre du jour par élève ».
3. Cliquer de nouveau sur « Préparer la séance » (rejeu).
4. Cliquer sur « Convoquer ».
5. Se connecter en **secrétariat** : constater que « Convoquer » est visible mais pas « Préparer la séance ».

Résultat attendu : étape 1 : « Préparation terminée : 9 créé(s), 0 reconstruit(s), 0 inchangé(s), 0 ignoré(s). » (le nombre d'élèves créés est celui des inscriptions actives de la classe, à relever). Le tableau liste chaque élève (colonnes « N° », « Élève », « Statut », « Faits », « Décisions », « Propositions à traiter ») avec « Faits » « Version 1 » et le statut « À examiner » ; l'élève sans résultat de période affiche le badge « Résultats manquants » (probablement ADOU Aïcha : à vérifier). Étape 3 : « Préparation terminée : 0 créé(s), 0 reconstruit(s), 9 inchangé(s), 0 ignoré(s). » (la préparation est rejouable : la version d'un instantané n'augmente que si son contenu change). Étape 4 : « Convocation envoyée : 3 convoqué(s), 1 notifié(s). » (le nombre de notifiés dépend des comptes liés aux fiches ; seul TRAORE Kouadio a un compte de connexion : les autres donnent un avertissement du type "Aucune remise n'a pu être mise en file pour …"), la colonne « Convocation » indique alors la date de convocation. Aucun message réel n'est envoyé.
- [ ] Cas nominal  - [ ] Rejeu sans doublon  - [ ] Droit refusé : « Préparer la séance » absent pour le secrétariat

#### 19.31 Ouvrir la séance : refus sans président, puis refus par la période clôturée
Compte : Directeur des études · Où : dossier de la séance test guide · Prérequis : 19.30.
1. Cliquer sur « Ouvrir la séance » sans avoir marqué personne présent. Lire la fenêtre « Ouvrir la séance » (« Le quorum est atteint. ») et cliquer sur « Ouvrir ».
2. Fermer. Dans le tableau, passer la présence de **TRAORE Kouadio** à « Présent », celle de YAO Fatou à « Présent » (liste déroulante « Présence de … »).
3. Cliquer de nouveau sur « Ouvrir la séance », puis « Ouvrir ».

Résultat attendu : étape 1 : le serveur répond "Un président présent est nécessaire pour ouvrir la séance." (le bandeau d'état affiche « Le président n'est pas présent. »). Étape 3 : la présence est acceptée mais l'ouverture est refusée par le module des résultats : "La période est clôturée." (le Trimestre 1 est clôturé par la graine ; code technique `results.state_closed`, message à relever tel quel). La séance reste « Planifié ». **Ceci est le comportement attendu pour une séance du Trimestre 1 ; l'ouverture n'est possible que sur une période dont les résultats ne sont pas clôturés (Trimestre 2).**
- [ ] Cas nominal (refus sans président)  - [ ] Cas nominal (refus période clôturée)  - [ ] Droit refusé : « Ouvrir la séance » absent pour le secrétariat

#### 19.32 Quorum et dérogation (optionnel, réglage à remettre en l'état)
Compte : Directeur des études · Où : `/v2/councils/parametres` puis dossier de la séance test guide · Prérequis : 19.31. **Attention : modifie le type de conseil de l'établissement ; remettre le champ vide à la fin.**
1. Ouvrir « Paramètres des conseils de classe », section « Types de conseil », « Modifier » en face de "Conseil de classe de période". Saisir 0 dans « Quorum minimal » puis « Enregistrer ». Puis saisir 5 et « Enregistrer ».
2. Revenir au dossier de la séance test guide : lire le badge et la ligne de quorum.
3. Cliquer sur « Ouvrir la séance » : la fenêtre « Ouvrir sans quorum » demande « Motif de la dérogation au quorum ». Saisir "Court" (5 caractères) puis valider, puis "Dérogation test guide : essai du motif" et cliquer sur « Ouvrir malgré tout ».
4. Retourner dans les paramètres et vider le champ « Quorum minimal » (« Aucun contrôle »), « Enregistrer ».

Résultat attendu : étape 1 : 0 est refusé avec "La valeur doit être supérieure ou égale à 1." ; 5 donne « Paramètre enregistré. ». Étape 2 : badge « Quorum non atteint » et ligne « 2 présent(s) sur 5 requis » (valeur à relever selon les présences) ; la phrase « Le quorum n'est pas atteint : l'ouverture exige un motif de dérogation. » s'affiche. Étape 3 : motif court refusé avec « Le motif doit comporter au moins 10 caractères. » ; avec un motif valable, l'ouverture est de nouveau refusée par le module des résultats ("La période est clôturée.") : la dérogation ne contourne pas ce contrôle. Étape 4 : retour à « Aucun contrôle ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Réglage remis en l'état

#### 19.33 Annuler la séance test guide
Compte : Directeur des études · Où : dossier de la séance test guide · Prérequis : 19.31.
1. Cliquer sur « Annuler la séance » (fenêtre « Annuler la séance »). Saisir "Non" (3 caractères) et valider, puis "Annulation test guide : essai terminé" et cliquer sur « Annuler la séance ».
2. Revenir au calendrier et filtrer sur « Annulé ».
3. Replanifier la même séance (19.28, mêmes valeurs).

Résultat attendu : motif court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Séance annulée. », badge « Annulé » et la ligne « Motif d'annulation » dans le bandeau d'état. Les boutons d'action disparaissent. À l'étape 3, la replanification est acceptée (une seule séance vivante par classe, type et période : une séance annulée ne compte pas). Remarque : les deux boutons nommés « Annuler » dans la fenêtre (fermer, confirmer) peuvent prêter à confusion (rapport QA 03).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] La séance annulée n'est plus modifiable

---

## Partie C. Délibération (séance de démonstration du Trimestre 2)

#### 19.34 Fiche d'un élève : faits figés, suggestions, examen
Compte : Directeur des études · Où : dossier de la séance de démonstration > nom d'un élève (`/v2/councils/<identifiant>/eleves/<identifiant-ligne>`) · Prérequis : base intacte.
1. Cliquer sur le nom de **DIABATE Nadia** dans « Ordre du jour par élève ». Lire le titre (nom de l'élève), le bouton « Retour au dossier de classe » et le cadre « État de la séance ».
2. Lire la section « Faits du dossier » : « Faits figés, version 1, empreinte » suivie d'une empreinte abrégée ; « État du résultat », « Moyenne », « Rang », « Mention », « Redoublant », « Financement », « Affecté par l'État », « Assiduité », « Vie scolaire ».
3. Lire « Suggestions des règles ».
4. Cliquer sur « Marquer comme examiné ».
5. Cliquer sur « Reconstruire les faits ».

Résultat attendu : étape 2 : si l'élève n'a pas de résultat exploitable (Trimestre 2 verrouillé mais non calculé), le message « Aucun résultat exploitable pour cet élève : une décision de passage ou de redoublement exige une justification. » s'affiche et le badge « Résultats manquants » apparaît (à relever). Étape 3 : « Ces suggestions viennent du jeu de règles : ce ne sont pas des décisions. Seul le conseil décide. » puis soit des suggestions étiquetées « Suggestion », soit « Aucune suggestion des règles pour cet élève. ». Étape 4 : « Élève marqué comme examiné. » et le statut passe à « Examiné » dans l'ordre du jour. Étape 5 : « Faits reconstruits. » (si rien n'a changé, la version reste "1"). Le secrétariat et l'enseignant ne voient ni « Marquer comme examiné » ni « Reconstruire les faits » (le secrétariat voit aucun des deux).
- [ ] Cas nominal  - [ ] Suggestions distinguées des décisions  - [ ] Droit refusé : boutons absents pour l'enseignant

#### 19.35 Propositions : l'enseignant propose, la direction des études tranche
Compte : Enseignant puis Directeur des études · Où : fiche de **DIABATE Nadia** (19.34) · Prérequis : 19.34.
1. Enseignant : ouvrir la même fiche (menu « Conseils de classe » > séance > nom). Dans « Propositions », cliquer sur « Ajouter une proposition » (fenêtre « Ajouter une proposition ») et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nature | Appréciation | oui |
   | Texte | Appréciation test guide : élève sérieuse et régulière | oui |
   Cliquer sur « Ajouter » : « Proposition ajoutée. ».
2. Répéter avec Nature = **Remarque**, texte "Remarque test guide : à encourager en lecture" ; puis avec Nature = **Distinction** : le champ devient « Code de la distinction » (« Code défini par l'établissement (majuscules, chiffres et _). ») : saisir `TG_FELICITATIONS`.
3. Vérifier que l'enseignant n'a ni « Accepter », ni « Refuser », ni « Retirer », ni bouton « Enregistrer la décision ».
4. Directeur des études : ouvrir la même fiche. Sur la remarque, cliquer sur « Accepter » ; sur l'appréciation, cliquer sur « Refuser », saisir la note "Refus test guide" et cliquer sur « Refuser » ; sur la distinction, cliquer sur « Retirer » et valider.

Résultat attendu : étape 1 : chaque proposition apparaît avec le badge « Proposition » (origine humaine), la nature, le statut « Proposée » et « Proposée par … ». Étape 4 : « Proposition acceptée. », « Proposition refusée. » (statut « Refusée », la note est affichée), « Proposition retirée. » (statut « Retirée »). **Ne pas accepter l'appréciation ni la distinction** : accepter ces natures crée plus tard un effet qui écrit dans les résultats de la classe (voir 19.44) ; seule la remarque (sans effet) est acceptée.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Nature Appréciation sans texte | « Ce champ est obligatoire. » sous « Texte » |
| Nature Distinction avec le code `tg felicitations` (espace) | "Code attendu : majuscules, chiffres et _ (40 max)." |
| Nature Distinction sans code | « Ce champ est obligatoire. » sous « Code de la distinction » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'enseignant n'a pas « Accepter » ni « Refuser »

#### 19.36 Mode séance et décisions humaines
Compte : Directeur des études · Où : séance > « Passer en mode séance » (`/v2/councils/<identifiant>/deliberation`) · Prérequis : 19.34.
1. Cliquer sur « Passer en mode séance ». Lire la page « Délibération » (« Mode séance : un élève à la fois. »), le bandeau d'état figé en haut, la barre « Navigation entre les élèves ».
2. Utiliser « Élève suivant », « Élève précédent » et la liste « Aller à un élève ». Lire « Élève 2 sur 9 » (nombre à relever).
3. Se placer sur **DIABATE Nadia**. Dans le formulaire « Enregistrer une décision », remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Type de décision | Avis requis du conseil | oui |
   | Décideur présent | PRESIDENT Conseil | oui |
   | Mode de décision | Consensus | oui |
   | Justification | laisser vide | non pour ce type |
   Cliquer sur « Enregistrer la décision » : « Décision enregistrée. ».
4. Se placer sur **BAMBA Aya** : Type = Autre décision, Décideur = PRESIDENT Conseil, Mode = **Vote**, Voix pour 5, Voix contre 2, Abstentions 1, Justification "Décision test guide : suivi renforcé demandé par le conseil" → « Enregistrer la décision ».
5. Cliquer sur « Ouvrir la fiche complète » : la décision figure dans « Décisions » avec « Mode », « Voix », « Décideur », « Enregistrée le », « Faits de référence ».

Résultat attendu : étape 3 : « Décision enregistrée. » ; le panneau « Décisions » liste "Avis requis du conseil" avec les badges « Enregistrée » et « Avis requis », « Ce que la règle suggérait » (« Aucune suggestion » s'il n'y en a pas), « Décision du conseil », « Décideur » = PRESIDENT Conseil. Étape 4 : « 5 pour, 2 contre, 1 abstention(s) ». Dans l'ordre du jour, la colonne « Décisions » passe à 1 et le statut à « Décidé ». Le formulaire n'a de bouton « Enregistrer la décision » que pour les rôles autorisés.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Type « Autre décision » sans justification | « La justification est obligatoire pour cette décision. » |
| Type « Autre décision » avec la justification "abc" | message du serveur "Ce type de décision exige une justification (10 caractères au moins)." |
| Mode « Vote » sans voix | "Un vote consigne les voix pour, contre et les abstentions." |
| Type « Réorientation » sans cible ni justification | « Ce type exige une cible : choisissez une série, un niveau ou précisez un libellé. » et « La justification est obligatoire pour cette décision. » |
| Type « Réorientation » avec seulement un « Libellé de la cible » | message du serveur "Ce type de décision exige une série ou un niveau visé." |
| Type « Passage en classe supérieure » (portée Année) | message du serveur "Ce type de décision ne s'applique pas à ce type de séance." (le type est pourtant proposé dans la liste : écart E-19b-4) |
| Aucun décideur sélectionné | « Ce champ est obligatoire. » sous « Décideur présent » |
Remarque : n'enregistrer aucune décision « Exclusion » ni « Réorientation » : elles créent des effets sur le statut de l'élève ou sur son orientation (voir 19.44).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : aucun bouton « Enregistrer la décision » pour l'enseignant

#### 19.37 Retirer une décision et verrou du décideur
Compte : Directeur des études · Où : fiche de BAMBA Aya et dossier de la séance · Prérequis : 19.36.
1. Dans le dossier de la séance, passer la présence de **PRESIDENT Conseil** à « Absent ».
2. Revenir à « Présent ».
3. Sur la fiche de BAMBA Aya, cliquer sur « Retirer la décision » (fenêtre « Retirer la décision »), saisir "No" puis valider, puis "Retrait test guide : décision d'essai" et cliquer sur « Retirer ».

Résultat attendu : étape 1 : le serveur refuse : "Ce participant est le décideur de décisions enregistrées : retirez-les d'abord." (la présence reste « Présent »). Étape 3 : motif court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Décision retirée. » ; la décision reste visible dans l'historique avec le statut « Retirée » et « Motif du retrait ». Laisser la décision "Avis requis du conseil" de Nadia en place pour 19.38 à 19.50.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] La décision retirée reste tracée

#### 19.38 Clore la séance
Compte : Directeur des études · Où : dossier de la séance de démonstration · Prérequis : 19.36.
1. Cliquer sur « Clore la séance » (fenêtre « Clore la séance » : « Après la clôture, les décisions ne sont plus modifiables sans déverrouillage motivé. », « Confirmez-vous la clôture de la séance ? »). Cliquer sur « Clore ».
2. Lire le bandeau et les boutons.
3. Essayer de saisir une décision sur la fiche d'un élève, puis de changer une présence.

Résultat attendu : « Séance close. », statut « Clos ». Les boutons « Clore la séance », « Modifier », « Annuler la séance », « Passer en mode séance » disparaissent ; la présence ne se modifie plus ; le formulaire de décision affiche « Les décisions s'enregistrent pendant que la séance est ouverte. ». Le type "Conseil de classe de période" n'exige pas une décision par élève : la clôture n'est pas bloquée par les élèves sans décision. Aucun effet n'apparaît (déclencheur : signature du procès-verbal).
- [ ] Cas nominal  - [ ] La séance close est verrouillée  - [ ] Droit refusé : l'enseignant ne voit pas « Clore la séance »

---

## Partie D. Procès-verbal et déverrouillage motivé

#### 19.39 Générer le procès-verbal et obtenir le PDF
Compte : Directeur des études (puis Secrétariat) · Où : séance > « Procès-verbal » (`/v2/councils/<identifiant>/pv`) · Prérequis : 19.38 ; le worker doit tourner pour le rendu PDF.
1. Ouvrir « Procès-verbal ». Lire « Aucun procès-verbal » et « Générez le procès-verbal une fois les décisions enregistrées. ».
2. Cliquer sur « Générer le procès-verbal ».
3. Lire le tableau « Versions », puis la section « Procès-verbal, version 1 » : « Statut », « Rendu PDF », « Généré le », « Signé le », « Document PDF ». Attendre que « Rendu PDF » passe à « PDF prêt » (recharger la page si besoin).
4. Cliquer sur « Préparer le téléchargement », puis sur le lien « Télécharger le PDF ».
5. Déplier « Contenu du procès-verbal ».
6. Cliquer une seconde fois sur « Générer le procès-verbal ».

Résultat attendu : étape 2 : « Procès-verbal généré (version 1). », statut « Généré ». Pendant le rendu : « Rendu en cours » et « Le rendu du PDF est en cours. » ; si le rendu échoue : « Rendu en échec » et « Le rendu du PDF a échoué. » (à relever si le worker est éteint). Étape 4 : le texte "Lien valable jusqu'au …" donne l'échéance du lien (quelques minutes) et l'empreinte du PDF ; le fichier s'ouvre dans un nouvel onglet et porte la mention "Jeu de règles de démonstration, non réglementaire". Étape 5 : un tableau « Décisions par élève » liste chaque élève, les décisions (ex. `REQUIRED_OPINION` pour Nadia) et l'appréciation. Étape 6 : refus du serveur "Un procès-verbal vivant existe déjà pour cette séance : réouvrez la séance (déverrouillage motivé) pour en produire une nouvelle version." Avant la clôture, générer est refusé avec "Le procès-verbal se génère séance close (état : OPEN)." (non rejouable ici).
- [ ] Cas nominal  - [ ] Cas invalide (double génération)  - [ ] Droit refusé pour l'enseignant (`/v2/councils/<identifiant>/pv`)

#### 19.40 Signatures du procès-verbal (refus attendu avec les comptes de démonstration)
Compte : Secrétariat, Directeur des études, Directeur · Où : `/v2/councils/<identifiant>/pv` · Prérequis : 19.39.
1. Lire « Signatures » (« Aucune signature pour le moment. ») et « Signataires manquants » : PRESIDENT Conseil et SECRETAIRE Conseil, chacun avec le badge « À signer » et un bouton « Signature papier ».
2. Avec le secrétariat, cliquer sur « Signer électroniquement ».
3. Répéter avec le directeur des études, puis avec le directeur.
4. Cliquer sur « Signature papier » en face de PRESIDENT Conseil (fenêtre « Signature papier »), choisir le signataire, saisir « Référence de la pièce numérisée » = `TG-pièce-inexistante` puis « Enregistrer ».

Résultat attendu : étapes 2 et 3 : refus du serveur "Votre compte n'est lié à aucune fiche du personnel : vous ne pouvez pas signer en tant que participant." pour les trois comptes (les fiches « Conseil » de la graine ne sont liées à aucun compte ; seul un compte lié à la fiche d'un signataire présent peut signer) ; aucune signature n'est enregistrée, l'écran reste utilisable. Étape 4 : "La pièce de la signature papier est introuvable dans le stockage." Une référence de moins de 3 caractères donne "La clé de la pièce doit faire au moins 3 caractères.". Conséquence : le procès-verbal reste « Généré » et la séance « Clos » ; **la signature, l'état « Signé », la publication irréversible et le déclenchement des effets "à la signature" ne sont pas démontrables avec les comptes de démonstration** (écart E-19b-1 ; à confirmer par un essai).
- [ ] Cas nominal (refus affiché)  - [ ] Cas invalide  - [ ] Droit refusé : l'enseignant n'a pas la page

#### 19.41 Révoquer le procès-verbal puis le régénérer (direction)
Compte : Directeur · Où : `/v2/councils/<identifiant>/pv` · Prérequis : 19.40. **Option : à faire seulement si l'équipe accepte une version 2.**
1. Avec le directeur des études ou le secrétariat, constater l'absence du bouton « Révoquer le procès-verbal ».
2. Avec le directeur, cliquer sur « Révoquer le procès-verbal » (fenêtre « Révoquer le procès-verbal »), saisir "Court" (5 caractères) puis valider, puis "Révocation test guide : procès-verbal d'essai" et cliquer sur « Révoquer ».
3. Cliquer sur « Générer le procès-verbal ».

Résultat attendu : étape 2 : motif court refusé avec « Le motif doit comporter au moins 10 caractères. » ; ensuite « Procès-verbal révoqué. », statut « Révoqué », ligne « Motif de révocation ». Étape 3 : un nouveau procès-verbal est généré (comportement à relever : version 2) et le tableau « Versions » conserve l'ancienne ligne « Révoqué ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études et le secrétariat

#### 19.42 Déverrouillage motivé : demande, quatre yeux, approbation, réouverture
Compte : Directeur des études puis Directeur · Où : `/v2/councils/<identifiant>/pv`, section « Déverrouillage motivé » · Prérequis : 19.38 (séance « Clos »).
1. Directeur des études : cliquer sur « Demander le déverrouillage » (fenêtre du même nom). Saisir "Trop court" (9 caractères) puis valider, puis le motif "Demande test guide : correction d'une décision saisie par erreur" et cliquer sur « Envoyer la demande ».
2. Lire le tableau « Demandes de déverrouillage ». Constater que le directeur des études n'a ni « Approuver » ni « Refuser ».
3. Directeur : dans la même ligne (statut « Demandé »), cliquer sur « Approuver » (note facultative) puis « Approuver ».
4. Lire « Un déverrouillage est approuvé : la séance peut être rouverte. », cliquer sur « Rouvrir la séance » puis « Rouvrir » (corps : « Confirmez-vous la réouverture de la séance ? »).
5. **Quatre yeux** : relire le procès-verbal (l'ancienne version est « Remplacé »). Clore de nouveau la séance (19.38). Avec le **directeur lui-même**, demander un déverrouillage (motif "Demande test guide : essai du refus de l'auto-approbation") puis cliquer sur « Approuver » sur sa propre demande.
6. Cliquer sur « Refuser » sur cette demande : saisir "No" puis valider, puis "Refus test guide : auto-approbation impossible" et cliquer sur « Refuser ».
7. Avec le directeur des études, demander un nouveau déverrouillage, faire approuver par le directeur, puis rouvrir (comme les étapes 1 à 4).

Résultat attendu : étape 1 : motif court refusé avec « Le motif doit comporter au moins 20 caractères. » ; ensuite « Demande de déverrouillage envoyée. », statut « Demandé ». Étape 3 : « Demande approuvée. », statut « Approuvé ». Étape 4 : « Séance rouverte. » ; le statut repasse « En séance », le badge « Rouvert 1 fois » apparaît, le procès-verbal précédent passe « Remplacé » et la demande « Utilisé ». Étape 5 : refus du serveur "L'approbation doit venir d'une autre personne que le demandeur (séparation des tâches)." ; la demande reste « Demandé ». Étape 6 : motif court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Demande refusée. », statut « Refusé ». Étape 7 : « Rouvert 2 fois ». Une seconde demande ouverte en parallèle est refusée par "Une demande de déverrouillage est déjà ouverte pour cette séance.". Tout le cycle est tracé dans le journal (19.43).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Quatre yeux appliqué  - [ ] Droit refusé : « Approuver » absent pour le directeur des études

#### 19.43 Historique de la séance
Compte : Directeur des études (puis Enseignant) · Où : séance > « Historique » (`/v2/councils/<identifiant>/historique`) · Prérequis : 19.42.
1. Ouvrir « Historique de la séance ». Lire « Réouvertures : 2 », le tableau « Journal de séance » (« Quand », « Événement », « Auteur », « Motif ») et la section « Demandes de déverrouillage ».

Résultat attendu : le journal, du plus récent au plus ancien, contient notamment « Séance rouverte », « Déverrouillage approuvé », « Déverrouillage demandé », « Procès-verbal généré », « PDF du procès-verbal prêt », « Séance close », « Décision enregistrée », « Décision retirée ». La colonne « Auteur » affiche le type d'acteur brut (`user`) et non le nom de la personne (écart E-19b-6). Aucun journal vide n'est attendu ; en cas de séance neuve : « Journal vide » et « Aucun événement enregistré pour cette séance. ». L'enseignant peut lire l'historique.
- [ ] Cas nominal  - [ ] Journal complet  - [ ] Droit refusé : accès hors périmètre par un identifiant inconnu (voir 19.53)

---

## Partie E. Effets des décisions

#### 19.44 File des effets et variante "effets à la clôture"
Compte : Directeur des études (puis Parent) · Où : menu « Conseils de classe » > « Effets des décisions » (`/v2/councils/effets`) · Prérequis : 19.42 (séance de démonstration rouverte, décision "Avis requis du conseil" de Nadia en place). **La variante modifie un réglage d'établissement : à remettre en état à l'étape 8.**
1. Ouvrir « Effets des décisions ». Lire les filtres « Statut » et « Nature ».
2. Ouvrir le dossier de la séance et cliquer sur « Voir les effets » (ouvre `/v2/councils/effets` filtré sur la séance, avec « Effets d'une seule séance. » et le lien « Voir tous les effets »).
3. Ouvrir « Paramètres », section « Réglages de l'établissement », « Modifier » : « Déclenchement des effets » = **À la clôture de la séance**, « Enregistrer ».
4. Clore la séance (19.38).
5. Revenir à « Effets des décisions ».
6. Parent (compte `parent@`) : ouvrir « Décisions du conseil » > enfant Nadia (voir 19.50).
7. Directeur des études : sur la ligne « Information des tuteurs » de Nadia, cliquer sur « Annuler l'effet », saisir "No" puis valider, puis "Annulation test guide : effet d'essai" et cliquer sur « Annuler l'effet ».
8. Remettre « Déclenchement des effets » sur **À la signature du procès-verbal**. Demander, approuver et rouvrir la séance (19.42, étapes 1 à 4).

Résultat attendu : étape 1 : « Aucun effet » et « Aucun effet ne correspond à ces filtres. » (aucun effet tant que le déclencheur n'est pas atteint ; la mention "1 Effets en attente d'une décision" de la vie scolaire concerne un autre module : voir 19a, 19.1). Étape 5 : une ligne « Information des tuteurs » pour DIABATE Nadia au statut « Appliqué » (ou « En échec » si le port de notification n'est pas prêt : bouton « Relancer », message « Relance demandée. »). Aucune ligne n'est créée pour BAMBA Aya (décision retirée) ni pour la remarque acceptée (aucun effet). Étape 6 : la décision "Avis requis du conseil" devient visible (visibilité « Après notification »). Étape 7 : « Effet annulé. », statut « Annulé » ; la décision disparaît de la vue du parent (à relever). Sans l'étape 7, la réouverture de l'étape 8 est refusée : "Des effets appliqués doivent d'abord être annulés avant la réouverture."
Cas invalide : étape 7 avec un motif de 3 caractères refusé avec « Le motif doit comporter au moins 5 caractères. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Réglage remis en l'état  - [ ] Droit refusé pour le secrétariat (`/v2/councils/effets`)

#### 19.45 Appliquer ou abandonner un effet humain (information, sans le déclencher)
Compte : Directeur des études · Où : `/v2/councils/effets` · Prérequis : 19.44.
Cette étape décrit ce qu'il ne faut pas faire sans préparation. Une décision "Exclusion (recommandation du conseil)" crée, au déclencheur, un effet « Demande de changement de statut de l'élève » toujours « À appliquer par un humain » ; une décision « Réorientation » avec cible crée un dossier d'orientation et un transfert de série. Aucun de ces actes n'est automatique.
1. Lire les boutons possibles selon le statut d'une ligne : « Relancer » (en échec), « Appliquer » et « Abandonner » (à appliquer par un humain), « Annuler l'effet » (appliqué et réversible).
2. Si un effet « À appliquer par un humain » existe sur une base de test dédiée, cliquer sur « Appliquer » : lire « Appliquer l'effet » (« Cet effet change la situation d'un élève. Il n'est jamais appliqué automatiquement : il demande l'acte d'un humain habilité. »), cliquer sur « Appliquer l'effet » **sans cocher** la case « Je confirme appliquer cet effet à cet élève ».

Résultat attendu : « Cochez la case pour confirmer l'application. » ; un motif de 3 caractères donne « Le motif doit faire au moins 5 caractères. ». Ne jamais cocher la case sur les élèves du parent ou de l'élève de démonstration. Un effet irréversible porte le badge « Irréversible » et n'a pas de bouton « Annuler l'effet ».
- [ ] Case de confirmation exigée  - [ ] Lecture des boutons par statut

---

## Partie F. Orientation

#### 19.46 Parcours d'orientation autorisés
Compte : Directeur des études · Où : menu « Conseils de classe » > « Orientation » (`/v2/councils/orientation`) · Prérequis : aucun.
1. Ouvrir « Orientation » : sections « Parcours autorisés », « Dossiers d'orientation », « Transferts de série ».
2. Lire « Aucun parcours défini » et « Définissez les parcours autorisés de votre établissement. ».
3. Cliquer sur « Ajouter un parcours » et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nature | Orientation | oui |
   | Source | Démonstration | oui |
   | Série d'origine | Toutes | non |
   | Niveau d'origine | 6e | oui |
   | Série de destination | Collège | oui |
   | Niveau de destination | 5e | oui |
   | Libellé | Parcours test guide : 6e vers 5e | non |
   | Un avis du conseil est requis | cochée | non |
   | Le consentement du tuteur est requis | cochée | non |
   | Actif | cochée | non |
   Cliquer sur « Enregistrer ».

Résultat attendu : « Parcours enregistré. » ; la ligne affiche « Orientation », "Parcours test guide : 6e vers 5e", origine "— · 6e", destination "Collège · 5e", conditions « Avis du conseil » et « Consentement du tuteur », source « Démonstration ». **Aucun parcours officiel n'est livré** : le modèle est vide.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Niveau d'origine non choisi | « Ce champ est obligatoire. » sous « Niveau d'origine » |
| Série d'origine "Collège", niveau 6e, destination Collège, niveau 6e | message du serveur "Un parcours relie deux situations différentes." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (`/v2/councils/orientation`)

#### 19.47 Dossier d'orientation et vœux (personnel)
Compte : Directeur des études · Où : `/v2/councils/orientation`, section « Dossiers d'orientation » · Prérequis : 19.46.
1. Cliquer sur « Ouvrir un dossier » (fenêtre « Ouvrir un dossier d'orientation » : « Le dossier est rattaché à l'inscription de l'élève. ») : Classe = 6e A, Élève = **DIABATE Salimata**, Notes = "Dossier test guide : orientation de fin d'année". Cliquer sur « Ouvrir ».
2. Essayer d'ouvrir un second dossier pour la même élève.
3. Sur la ligne, cliquer sur « Ajouter un vœu » (fenêtre « Vœu d'orientation de … ») et remplir : Rang du vœu 1, Origine du vœu « Tuteur », Série souhaitée "Collège", Niveau souhaité "5e", Commentaire "Vœu test guide : poursuite en 5e". Laisser « Consentement du tuteur » sur « Ne pas modifier ». Cliquer sur « Enregistrer le vœu ».
4. Rouvrir « Ajouter un vœu », Rang 1, autre niveau ("4e"), « Enregistrer le vœu ».

Résultat attendu : étape 1 : « Dossier d'orientation ouvert. » ; ligne "DIABATE Salimata", statut « Ouvert », 0 vœu, consentement « Non requis ». Étape 2 : refus du serveur "Cette inscription a déjà un dossier d'orientation.". Étape 3 : « Vœu enregistré. » ; statut « Vœux recueillis », 1 vœu. Étape 4 : l'aide « Un vœu existe déjà à ce rang : il sera remplacé. » apparaît ; après enregistrement le nombre de vœux reste 1 (le précédent est retiré).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Élève non choisi (ouverture du dossier) | « Choisissez un élève. » |
| Rang 21 | "La valeur doit être inférieure ou égale à 20." |
| Série souhaitée non choisie | « Ce champ est obligatoire. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant

#### 19.48 Consentement du tuteur et transfert de série (planifier puis annuler, jamais appliquer)
Compte : Directeur des études, Parent · Où : `/v2/councils/orientation` ; parent `/v2/councils/famille` · Prérequis : 19.47. **Ne jamais cliquer sur « Appliquer » avec le consentement donné : l'application d'un transfert modifie l'inscription de façon irréversible.**
1. Directeur des études : section « Transferts de série », « Planifier un transfert » (fenêtre « Planifier un transfert de série »). Classe 6e A, Élève DIABATE Salimata, Parcours autorisé = "Parcours test guide : 6e vers 5e" (la destination se remplit), Prise d'effet = « À la prochaine année », Décidé par = « Acte de la direction », Référence de l'acte de la direction = `ACTE-TG-0001`. Cliquer sur « Planifier ».
2. Lire la section « Dossiers d'orientation » : la colonne « Consentement » de Salimata passe à « En attente » avec les boutons « Consentement donné » et « Consentement refusé ».
3. Cliquer sur « Appliquer » sur la ligne du transfert (statut « Planifié »).
4. Parent : ouvrir `/v2/councils/famille`, enfant Salimata (voir 19.51) : bloc « Accord de la famille ».
5. Directeur des études : sur la ligne du transfert, cliquer sur « Annuler » (fenêtre « Annuler le transfert »), saisir "No" puis valider, puis "Annulation test guide : essai terminé" et cliquer sur « Annuler le transfert ».
6. Essayer de planifier un transfert vers une destination hors parcours (sans « Parcours autorisé ») avec le directeur des études, sans motif.

Résultat attendu : étape 1 : « Transfert planifié. », statut « Planifié », prise d'effet « À la prochaine année », décidé par « Acte de la direction » et la référence. Étape 3 : refus du serveur "Le parcours exige l'accord de la famille, qui n'est pas encore donné." (aucun effet). Étape 5 : motif court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Transfert annulé. », statut « Annulé ». Étape 6 : refus de saisie « Ce champ est obligatoire. » ou, si le motif est donné mais trop court, "Le motif de dérogation doit faire au moins 20 caractères." ; une dérogation motivée exige en outre la permission de dérogation (acte de direction, directeur des études compris).
Cas invalide : planifier un second transfert pour la même inscription alors qu'un est prévu : "Un transfert de série est déjà prévu ou appliqué pour cette inscription."
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Refus d'application sans accord  - [ ] Aucun transfert appliqué

---

## Partie G. Paramètres des conseils de classe

#### 19.49 Lire et modifier les paramètres
Compte : Directeur des études · Où : menu « Conseils de classe » > "Paramètres des conseils" (`/v2/councils/parametres`) · Prérequis : MFA (permission sensible).
1. Ouvrir « Paramètres des conseils de classe ». Lire l'encadré de description : « Aucune valeur réglementaire n'est imposée par le logiciel. ».
2. Section « Rôles des participants » : lire les sept rôles (colonnes « Code », « Libellé », « Voix délibérative », « Compte pour le quorum », « Peut signer », « Peut décider », « Actif »). Cliquer sur « Ajouter un rôle » (fenêtre « Ajouter un rôle ») et remplir : Code `TG_OBSERVATEUR`, Libellé "Observateur test guide", cases « Voix délibérative » décochée, « Compte pour le quorum » décochée, « Peut signer » décochée, « Peut décider » décochée, « Actif » cochée. Cliquer sur « Enregistrer ».
3. Section « Types de décision » : cliquer sur « Ajouter un type » (fenêtre « Ajouter un type de décision ») : Code `TG_AVIS`, Libellé "Avis test guide", Famille « Avis requis », S'applique à « Période et année », « Actif » cochée ; « Enregistrer ». Ouvrir un conseil : le type est proposé dans « Type de décision ».
4. Section « Types de conseil » : « Modifier » sur "Conseil de classe de période" ; décocher « Président » et « Secrétaire » dans « Fonctions signataires » et enregistrer ; puis les recocher.
5. Section « Réglages de l'établissement » : lire les cinq valeurs (« Le déverrouillage doit être approuvé par une autre personne », « Déclenchement des effets », « Visibilité pour les familles », « Autoriser l'ouverture sans quorum, avec motif », « Modèle de procès-verbal »). « Modifier » : saisir `Mon Modèle` dans « Modèle de procès-verbal », « Enregistrer ».
6. Désactiver le type `TG_AVIS` et le rôle `TG_OBSERVATEUR` (décocher « Actif ») à la fin.

Résultat attendu : étape 2 : « Paramètre enregistré. » ; le rôle apparaît avec « Non » dans les colonnes. Étape 3 : le type s'ajoute avec la famille « Avis requis ». Étape 4 : sans fonction signataire ni rôle signataire, refus du serveur "Un procès-verbal exige au moins un signataire (fonction ou rôle)." Étape 5 : "Format invalide." sous « Modèle de procès-verbal » (clé en minuscules, chiffres et tirets).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Code de rôle `TG X` (espace) | "Code attendu : majuscules, chiffres et _ (40 max)." |
| Libellé vide | « Ce champ est obligatoire. » |
| Quorum minimal 0 | "La valeur doit être supérieure ou égale à 1." |
| Modèle de procès-verbal `Mon Modèle` | "Format invalide." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat et l'enseignant (`/v2/councils/parametres`)

---

## Partie H. Familles et élève

#### 19.50 Décisions du conseil vues par le parent et par l'élève
Compte : Parent puis Élève · Où : portail parent « Décisions du conseil » (`/v2/councils/famille`) ; portail élève « Décisions du conseil » (`/v2/councils/moi`) · Prérequis : 19.38 ; pour voir la décision, la variante de 19.44 (déclencheur "À la clôture").
1. Parent : ouvrir « Décisions du conseil ». Choisir l'enfant **DIABATE Nadia** (liste « Enfant ») puis **DIABATE Salimata**.
2. Élève : ouvrir `/v2/councils/moi`.
3. Après l'étape 5 de 19.44 (effet « Information des tuteurs » appliqué), rouvrir les deux pages.

Résultat attendu : avant la notification : « Aucune décision à afficher » et « Aucune décision n'est visible pour le moment. » (la visibilité est « Après notification », rien n'a été notifié ; avec la visibilité « Après signature du procès-verbal », la décision n'est visible qu'une fois la séance signée, ce qui n'est pas démontrable). Après notification : pour Nadia, une carte "Avis requis du conseil" avec le badge « Avis requis » et "Conseil de classe de période · Trimestre 2 · <date>". **Jamais** la suggestion de la règle, le vote, la justification interne ni une décision d'un autre élève. Pour Salimata : toujours « Aucune décision à afficher ». Pour l'élève : titre « Mes décisions du conseil de classe », même contenu que son parent pour Nadia.
- [ ] Cas nominal  - [ ] Rien avant notification  - [ ] Droit refusé : le parent n'ouvre pas `/v2/councils/moi`

#### 19.51 Orientation vue par la famille et l'élève
Compte : Parent puis Élève · Où : `/v2/councils/famille` et `/v2/councils/moi` (section « Orientation ») · Prérequis : 19.47 et 19.48 (dossier de DIABATE Salimata, parcours test guide).
1. Parent : choisir l'enfant **DIABATE Nadia**. Lire « Aucun dossier d'orientation » et « Aucun dossier d'orientation n'est ouvert pour le moment. L'établissement vous prévient lorsqu'il l'ouvre. ».
2. Parent : choisir l'enfant **DIABATE Salimata**. Lire « État du dossier » et la phrase d'aide, « Vœux exprimés ». 
3. Dans « Exprimer un vœu » : Rang du vœu 2, Destination souhaitée "Parcours test guide : 6e vers 5e", Commentaire "Vœu famille test guide". Cliquer sur « Enregistrer le vœu ».
4. Essayer sans choisir de destination.
5. Si le transfert de 19.48 est encore planifié (consentement « En attente ») : lire « Accord de la famille », cliquer sur « Refuser », lire « Confirmez-vous refuser le changement d'orientation envisagé ? Aucun changement ne sera appliqué sans nouvel accord. » puis cliquer sur « Annuler ».
6. Élève : ouvrir `/v2/councils/moi` : section « Orientation ».

Résultat attendu : étape 1 : voir le texte ci-dessus. Étape 2 : badge « Vœux recueillis », texte « Les vœux sont recueillis. Aucune décision n'est encore communiquée. », le vœu n° 1 du personnel n'est pas exposé ("Seuls les vœux de la famille et de l'élève sont exposés"). Étape 3 : « Votre vœu n° 2 est enregistré. » ; la liste « Vœux exprimés » affiche « Vœu n° 2 » avec « Exprimé par la famille ». Étape 4 : « Choisissez une destination. ». Étape 5 : le bouton « Annuler » ferme la fenêtre sans enregistrer. Étape 6 : l'élève lit « Lecture seule : les vœux sont exprimés par la famille ou par l'établissement. » et ne voit aucun formulaire. Le dossier n'affiche jamais les notes internes, l'avis du personnel ni les vœux retirés.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'élève n'a pas de formulaire de vœu

---

## Partie I. Droits et qualité

#### 19.52 Droits refusés (vérification par rôle)
Compte : chacun des comptes du tableau "Adresses à taper à la main" · Où : barre d'adresse · Prérequis : aucun.
1. Pour chaque ligne du tableau, se connecter avec le compte puis taper chaque adresse.
2. Avec le secrétariat, ouvrir la séance de démonstration et vérifier : « Générer le procès-verbal » et « Signer électroniquement » sont visibles ; aucun bouton « Ouvrir la séance », « Clore la séance », « Enregistrer la décision », « Préparer la séance ».

Résultat attendu : page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", sans donnée. Le contrôle est aussi fait par l'API : une adresse d'API tapée directement renvoie une erreur de droit (non testée ici).
- [ ] Enseignant  - [ ] Secrétariat  - [ ] Parent  - [ ] Élève  - [ ] Éducateur et économe

#### 19.53 Qualité transversale : introuvable, états vides, clavier, téléphone
Compte : Directeur des études · Où : `/v2/councils/00000000-0000-0000-0000-000000000000` et pages ci-dessus · Prérequis : aucun.
1. Taper l'adresse d'une séance inexistante `/v2/councils/00000000-0000-0000-0000-000000000000`.
2. Taper `/v2/councils/abc` (identifiant mal formé).
3. États vides : filtre « Clos » du calendrier (19.25), « Journal vide », « Aucun effet ».
4. Clavier : ouvrir « Planifier un conseil » avec Tab et Entrée, parcourir les champs avec Tab, fermer avec Échap ; le focus reste dans la fenêtre.
5. Téléphone : réduire la fenêtre à environ 375 pixels ; les tableaux sont dans une région défilante annoncée « Tableau : … ».

Résultat attendu : étape 1 : « Élément introuvable » avec « Ce conseil ou ce dossier n'existe pas, ou il n'est pas dans votre périmètre. » et le bouton « Retour au calendrier ». Étape 2 : erreur générique (à relever). Étape 4 : fenêtre modale correcte. Étape 5 : pas de défilement horizontal de la page entière, tableaux défilables.
- [ ] Introuvable  - [ ] États vides  - [ ] Clavier  - [ ] Largeur téléphone

---

## Données créées (pour l'annexe)

| Enregistrement | Où | Détail |
|---|---|---|
| Séance "Conseil de classe T1 test guide" | 19.28 à 19.33 | 6e A, Trimestre 1, annulée (replanifiée à l'étape 3 de 19.33 : à annuler de nouveau si créée) |
| Participants TRAORE Kouadio (Président), YAO Fatou (Secrétaire), KOUAME Adjoua | 19.29 | séance test guide |
| Propositions "Appréciation test guide : élève sérieuse et régulière" (refusée), "Remarque test guide : à encourager en lecture" (acceptée), distinction `TG_FELICITATIONS` (retirée) | 19.35 | DIABATE Nadia, séance de démonstration |
| Décision "Avis requis du conseil" | 19.36 | DIABATE Nadia, séance de démonstration (conservée) |
| Décision « Autre décision » "Décision test guide : suivi renforcé demandé par le conseil" | 19.36, 19.37 | BAMBA Aya, retirée |
| Procès-verbal version 1 (puis remplacé ou révoqué) | 19.39 à 19.42 | séance de démonstration |
| Demandes de déverrouillage (3 à 4) | 19.42 | approuvées, refusée |
| Réouvertures de la séance de démonstration (2) | 19.42 | |
| Rôle `TG_OBSERVATEUR` (inactif), type de décision `TG_AVIS` (inactif) | 19.49 | établissement |
| Parcours "Parcours test guide : 6e vers 5e" | 19.46 | établissement |
| Dossier d'orientation DIABATE Salimata, vœux n° 1 et n° 2 | 19.47, 19.51 | |
| Transfert de série annulé (`ACTE-TG-0001`) | 19.48 | DIABATE Salimata |
| Effet « Information des tuteurs » (annulé) | 19.44 | DIABATE Nadia |

État de la séance de démonstration après le parcours : « En séance », rouverte 2 fois, décision de Nadia conservée, procès-verbal précédent « Remplacé ».

## Écarts constatés

| Réf. | Écran | Constat | Gravité |
|---|---|---|---|
| E-19b-1 | Procès-verbal | Aucune signature n'est possible avec les comptes de démonstration : les fiches « Conseil » (PRESIDENT, SECRETAIRE) ne sont liées à aucun compte, la signature papier exige une pièce déjà déposée dans le stockage. Le parcours "signature, publication irréversible, effets à la signature" n'est donc pas démontrable sans préparation (rôle ou lien de compte). | Majeur |
| E-19b-2 | Dossier de classe | L'ajout d'un participant ne propose que les enseignants de la classe ; un membre du personnel non enseignant (secrétaire de séance, principal) ne peut pas être ajouté par l'interface. | Mineur |
| E-19b-3 | Dossier de classe (enseignant) | Les liens « Passer en mode séance » et « Voir les effets » restent visibles pour l'enseignant ; le second mène à « Accès refusé » ; le formulaire de décision s'affiche sans bouton d'envoi. | Mineur |
| E-19b-4 | Délibération | Le formulaire de décision propose tous les types actifs, y compris ceux de portée Année (Passage, Redoublement, Orientation) que l'API refuse pour un conseil de période. | Mineur |
| E-19b-5 | Dossier de classe | « Participants proposés » affiche le code de rôle brut (`TEACHER`) ; le procès-verbal liste les signataires manquants avec le code de rôle brut (`PRESIDENT`). | Mineur |
| E-19b-6 | Historique | La colonne « Auteur » affiche le type d'acteur (`user`) et non le nom. | Mineur |
| E-19b-7 | Procès-verbal | Le bouton « Rouvrir la séance » n'est pas masqué aux rôles sans droit d'approbation (le directeur des études le voit après approbation mais l'API le refuse). | Mineur |
| E-19b-8 | Calendrier | Le tableau n'affiche pas l'étiquette « Règles de démonstration » par ligne (seul le dossier porte le bandeau). | Suggestion |
| E-19b-9 | Séance du Trimestre 1 | Une séance planifiée sur une période de résultats clôturée peut être créée, préparée, convoquée, mais jamais ouverte ("La période est clôturée.") ; l'écran de création n'avertit pas. | Mineur |

## À vérifier en test

- 19.28 : messages exacts pour le Trimestre 3 et pour le type "fin d'année".
- 19.30 : nombre d'élèves de l'ordre du jour, élève « Résultats manquants », nombre de notifiés à la convocation.
- 19.31 : message exact et code de l'erreur "La période est clôturée." à l'ouverture.
- 19.34 : présence ou absence de suggestions des règles et du message "Aucun résultat exploitable…" pour le Trimestre 2.
- 19.39 : rendu du PDF (worker), lien de téléchargement dans un navigateur local, version 2 après révocation (19.41).
- 19.44 : statut de l'effet « Information des tuteurs » (« Appliqué » ou « En échec »), disparition de la décision côté parent après « Annuler l'effet ».
- 19.48 : message du serveur pour une dérogation insuffisante.

## Non couvert / limites connues

- **Signature et publication irréversible du procès-verbal** : voir E-19b-1 ; les effets "à la signature du procès-verbal" (décision de passage ou de redoublement publiée dans les résultats, dossier d'orientation « Décidé », exclusion) ne sont pas exercés.
- **Conseil de fin d'année** (portée Année, décision par élève, passage, redoublement) : non exercé, les résultats annuels de la graine n'existent pas.
- **Effets irréversibles** (application d'une exclusion, d'un transfert de série, écriture dans les résultats) : volontairement non déclenchés.
- **Délégués externes** (élèves, parents) comme participants : le choix « Personne externe (tuteur du registre) » exige la permission de lecture des tuteurs ; non testé.
- **Isolation entre établissements** : voir chapitre 01.
