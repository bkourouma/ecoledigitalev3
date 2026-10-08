# Chapitre 13. Paie des enseignants

> **Adresses.** Les écrans de la paie sont servis sous `http://localhost:3000/v2/payroll/...` (l'API répond sur `http://localhost:4000`). Aucune réécriture d'adresse ne retire ni n'ajoute `/v2` (vérifié dans `apps/web/next.config.js` et `apps/web/middleware.ts`) : l'adresse du navigateur est donc celle du dossier `apps/web/src/app/v2/payroll`.
>
> **Convention de citation.** Les libellés entre « … » sont ceux de `apps/web/messages/fr-CI.json`. Quand un message contient lui-même des guillemets français, ils sont notés ‹ … › dans ce guide pour ne pas les confondre avec une citation. Les valeurs à saisir sont données entre guillemets droits ou en `code`. Les champs de date s'écrivent jj/mm/aaaa dans un navigateur en français (ou aaaa-mm-jj pour un pilotage automatique).

## Prérequis

- Établissement : **Collège Le Baobab (démonstration)**, identifiant `secondaire-test` (pack Secondaire, trimestres). Le même module existe aux Palmiers et à l'Université Horizon ; seul le collège est couvert ici.
- Année scolaire en cours démarrant le 1er septembre 2026 (voir l'annexe des données de départ). Les périodes de paie ci-dessous (`01/09/2026` au `30/09/2026`, puis `01/10/2026` au `31/10/2026`) supposent une exécution en **octobre 2026**. Un autre mois : garder la période de septembre telle quelle (elle sera simplement passée) et remplacer la période « octobre » par le **mois en cours** (du 1er au dernier jour), car le scénario 13.13 pointe une présence "aujourd'hui" qui doit tomber dans cette période.
- Aucune donnée de paie n'est semée : `scripts/seed-v2/demo/staff.ts` ne crée que six comptes de personnel et aucun autre fichier de `scripts/seed-v2/demo/` ne touche à la paie (aucune configuration, période, bulletin, tarif, présence du personnel). Si la base a déjà servi à des essais (par exemple les sessions QA 05 et 11), les listes peuvent contenir d'autres lignes et une période "en attente de calcul" peut bloquer la création d'une nouvelle période : la clôturer d'abord (voir 13.5).
- Les trois enseignants de départ du collège (annexe, section 3) : **TRAORE Kouadio** (compte `enseignant@secondaire-test.test`, c'est le seul qui se connecte), **YAO Fatou** et **KOUAME Adjoua** (fiches sans compte). Les noms exacts sont à relire dans la liste du personnel avant de commencer.
- Les scénarios se suivent : 13.1 à 13.4 préparent, 13.5 à 13.12 déroulent le cycle de septembre, 13.13 à 13.17 celui d'octobre (heures de cours, quatre yeux, seuil du propriétaire, contestation, lecture de la masse salariale), 13.18 à 13.21 les chevauchements, la clôture, l'écran « Mes bulletins » et les droits.

## Comptes

| Rôle | E-mail | Ce qu'il fait dans ce chapitre |
|---|---|---|
| Économe | `econome@secondaire-test.test` | configurations, tarifs, périodes, calcul, primes et retenues, versement, historique, rapports |
| Directeur | `directeur@secondaire-test.test` | arrêt du montant, contestation, annulation ; calcule lui-même en 13.14 |
| Propriétaire | `direction.generale@secondaire-test.test` | réglages de la paie, « Masse salariale », validation au-delà du seuil |
| Enseignant | `enseignant@secondaire-test.test` | ses bulletins, contestation, pointage « Arrivée » / « Départ » |
| Secrétariat, parent, élève | `secretariat@…`, `parent@…`, `eleve@secondaire-test.test` | aucun accès (contrôle des droits en 13.21) |

Aucun mot de passe ni code de double authentification n'est écrit ici : on se connecte en cliquant le compte dans le panneau de droite de la page `/v2/login` (l'économe, le directeur et le propriétaire demandent la double authentification).

## Droits

Source : `apps/api/src/modules/rbac/templates/system-roles.ts` et gardes des pages `apps/web/src/app/v2/payroll/**/page.tsx` (une permission refusée redirige vers la page « Accès refusé », adresse `/unauthorized`).

| Écran | Adresse | Permission de la page | Rôles qui l'ont |
|---|---|---|---|
| Périodes | `/v2/payroll` | `payroll.period.manage` ou `payroll.payslip.read` | économe, directeur, propriétaire |
| Fiche d'une période | `/v2/payroll/periods/<identifiant>` | `payroll.period.manage` | idem |
| Bulletins | `/v2/payroll/payslips` | `payroll.payslip.read` | idem |
| Fiche d'un bulletin | `/v2/payroll/payslips/<identifiant>` | `payroll.payslip.read` ou `payroll.payslip.read_own` | idem + enseignant (son bulletin arrêté) |
| Configurations | `/v2/payroll/configuration` | `payroll.config.read` | économe, directeur, propriétaire |
| Tarifs horaires | `/v2/payroll/configuration/rates` | `payroll.rate.read` | idem |
| Réglages | `/v2/payroll/configuration/settings` | `payroll.settings.manage` | **propriétaire seulement** |
| Historique | `/v2/payroll/history` | `payroll.payslip.read` | économe, directeur, propriétaire |
| Rapports | `/v2/payroll/reports` | `payroll.report.read` | idem |
| Masse salariale | `/v2/payroll/owner` | `payroll.report.read` + fonction `payroll.owner-validation` de l'offre | idem (valider : directeur/propriétaire) |
| Mes bulletins (salarié) | `/v2/payroll/my` | `payroll.payslip.read_own` | enseignant, instituteur, rôle « Personnel » |
| Un de mes bulletins | `/v2/payroll/my/<identifiant>` | idem | idem |
| Mes bulletins de paie (portail enseignant) | `/v2/teacher/payslips` et `/v2/teacher/payslips/<identifiant>` | idem | idem |

Actions : **calculer, ajuster, notifier, verser** : économe, directeur, propriétaire. **Arrêter le montant, contester (côté gestion), annuler** : directeur et propriétaire seulement (l'économe n'a pas `payroll.payslip.approve` ni `payroll.payslip.cancel`). **Arrêter au-delà du seuil** : propriétaire seulement (`payroll.payslip.approve_owner`). **Contester son propre bulletin** : titulaire seul (`payroll.my.dispute`).

Adresses à taper à la main, qui doivent être **refusées** (page « Accès refusé ») :

| Compte | Adresse | Résultat attendu |
|---|---|---|
| Enseignant | `/v2/payroll`, `/v2/payroll/payslips`, `/v2/payroll/configuration`, `/v2/payroll/history`, `/v2/payroll/owner` | page « Accès refusé » |
| Économe | `/v2/payroll/configuration/settings` | page « Accès refusé » |
| Directeur | `/v2/payroll/configuration/settings` | page « Accès refusé » (les réglages restent au propriétaire) |
| Secrétariat, parent, élève | `/v2/payroll`, `/v2/payroll/my`, `/v2/teacher/payslips` | page « Accès refusé » |

## Données de départ

Aucune (voir Prérequis). Les enseignants et le compte de l'enseignant viennent de `scripts/seed-v2/scenario.ts` (trois enseignants, invitation au portail du premier). Il n'existe aucune présence de personnel : les heures de cours du scénario 13.13 sont produites en direct par le pointage de l'enseignant.

---

## Scénarios

#### 13.1 Constater l'état initial des écrans de paie
Compte : économe (Collège Le Baobab) · Où : menu « Bulletins de paie » (`/v2/payroll`) · Prérequis : base fraîche (sinon, les listes ne sont pas vides, c'est normal).
1. Ouvrir `/v2/payroll`. Lire le titre « Périodes de paie », la barre de section (« Périodes », « Bulletins », « Configuration », « Historique », « Rapports », et « Masse salariale » si l'offre le permet) et le bouton « Nouvelle période ».
2. Ouvrir « Bulletins » (`/v2/payroll/payslips`), puis « Historique » (`/v2/payroll/history`), puis « Configuration » (`/v2/payroll/configuration`), puis « Rapports » (`/v2/payroll/reports`).
Résultat attendu : `/v2/payroll` affiche « Aucune période de paie » et « Créez la première période pour calculer les bulletins. » ; « Bulletins » affiche « Aucun bulletin » et « Modifiez les filtres ou lancez le calcul d'une période. » ; « Historique » affiche « Aucun bulletin arrêté » ; « Configuration » affiche « Aucune configuration » et « Un enseignant sans configuration est écarté du calcul de la paie. » ; « Rapports » affiche « Aucune donnée pour ces filtres ». Aucune erreur, aucun écran blanc. La barre de section de l'économe ne propose pas « Mes bulletins ».
- [ ] Cas nominal  - [ ] Droit refusé pour l'enseignant (13.21)

#### 13.2 Réglages de la paie : lecture et jeux invalides
Compte : propriétaire · Où : « Configuration » > « Réglages » (`/v2/payroll/configuration/settings`) · Prérequis : aucun.
1. Ouvrir la page « Réglages de la paie ». Relever « Devise : XOF ».
2. Relever les valeurs de départ : « Seuil d'heures supplémentaires par défaut (minutes par semaine) » = `2400` (indication « Soit 40 h par semaine. »), « Majoration par défaut » = `1,5`, « Séparation des tâches » décochée, « Seuil de validation par le propriétaire » vide (aucun seuil). Ces valeurs viennent de la base (`payroll.settings`), jamais du code.
3. Saisir successivement les jeux invalides ci-dessous (ne rien enregistrer d'autre), puis cliquer « Enregistrer les réglages ».
4. Remettre `2400`, `1,5`, case décochée, seuil vide, puis « Enregistrer les réglages ».
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Seuil d'heures supplémentaires = `0` (ou vide) | Saisissez un nombre entier de minutes supérieur à 0. |
| Majoration = vide | Saisissez un coefficient. |
| Majoration = `abc` | Coefficient invalide (par exemple 1,5). |
| Majoration = `0,5` ou `6` | Le coefficient doit être compris entre 1 et 5. |
| Seuil de validation = `0` | Montant invalide : chiffres uniquement, strictement positif. |
| Seuil de validation = `-5000` | Le montant ne peut pas être négatif. |
| Seuil de validation = `1500,5` | Le montant est un entier en francs : pas de virgule ni de point. |

Résultat attendu (étape 4) : message « Les réglages ont été enregistrés. » ; après rechargement de la page, les valeurs restituées sont celles saisies. Aucun message d'erreur sur les cas invalides n'est suivi d'un enregistrement.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur et l'économe (13.21)

#### 13.3 Configurations de paie : créer, modifier, situation d'un enseignant
Compte : économe · Où : « Configuration » > « Configurations » (`/v2/payroll/configuration`) · Prérequis : 13.1.
1. Cliquer « Nouvelle configuration » et remplir le formulaire de **TRAORE Kouadio** :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Enseignant | `TRAORE Kouadio` (taper puis choisir dans la liste) | oui |
   | Type de rémunération | « Mixte » | oui |
   | Salaire mensuel | `150000` | oui pour « Salaire » et « Mixte » (ou le salaire annuel) |
   | Salaire annuel | (vide) | non |
   | Tarif horaire par défaut | `3000` | non (obligatoire en pratique pour payer des heures sans tarif de cours) |
   | Seuil d'heures supplémentaires (minutes par semaine) | `1` | non (vide : valeur de l'établissement). Valeur de test : permet d'obtenir des heures supplémentaires avec deux minutes de pointage |
   | Majoration des heures supplémentaires | `2` | non (vide : valeur de l'établissement) |
   | En vigueur à partir du | `01/08/2026` | oui |
   | Jusqu'au (facultatif) | (vide) | non |
2. Cliquer « Enregistrer ».
3. Créer de même la configuration de **YAO Fatou** : Type « Horaire », « Tarif horaire par défaut » `3000`, « En vigueur à partir du » `01/08/2026` (les champs de salaire disparaissent pour ce type).
4. Ne créer **aucune** configuration pour KOUAME Adjoua.
5. Dans la zone « Situation d'un enseignant », choisir TRAORE Kouadio, puis KOUAME Adjoua.
6. Sur la ligne de YAO Fatou, cliquer « Modifier », changer « Tarif horaire par défaut » en `3500`, « Enregistrer ». Recliquer « Modifier » puis remettre `3000`, « Enregistrer ».
Résultat attendu : message « La configuration a été enregistrée. » à chaque enregistrement ; ligne TRAORE Kouadio : Type « Mixte », « Salaire mensuel » 150 000 F CFA, « Tarif horaire par défaut » 3 000 F CFA, « Heures supplémentaires » lisant « au-delà de 0 h 01/semaine, ×2 », « Validité » « Depuis le 01/08/2026 » ; ligne YAO Fatou : Type « Horaire », salaire « — ». « Situation d'un enseignant » : « Configuration en cours » pour TRAORE (avec « Mixte · 150 000 F CFA · 3 000 F CFA par heure ») ; « Aucune configuration » puis « Aucune configuration applicable aujourd'hui. » pour KOUAME. Les valeurs persistent après rechargement. Le filtre « En vigueur le » avec une date avant le 01/08/2026 ne montre aucune ligne.
Cas invalides (ouvrir « Nouvelle configuration » pour chaque saisie) :

| Saisie | Message attendu |
|---|---|
| Aucun enseignant choisi | Choix invalide. (sous « Enseignant ») |
| Type « Salaire », salaire mensuel `150000,5` | Le montant est un entier en francs : pas de virgule ni de point. |
| Type « Salaire », salaire mensuel `-1` | Le montant ne peut pas être négatif. |
| Type « Salaire », salaire mensuel `0` | Montant invalide : chiffres uniquement, strictement positif. |
| Type « Salaire », aucun salaire (mensuel ni annuel) | Une configuration salariale ou mixte exige un salaire mensuel ou annuel. |
| Type « Horaire », tarif `3000,5` | Le montant est un entier en francs : pas de virgule ni de point. |
| « Jusqu'au (facultatif) » `31/07/2026` avec début `01/08/2026` | La date de fin précède la date de début. |
| Seuil d'heures supplémentaires `0` | Saisissez un nombre entier de minutes supérieur à 0. |
| Majoration `7` | Le coefficient doit être compris entre 1 et 5. |
| Seconde configuration pour TRAORE Kouadio débutant le `01/09/2026` (chevauche la première, qui n'a pas de fin) | Une autre configuration de paie couvre déjà ces dates pour cet enseignant. |

Messages d'après les gardes du formulaire (`Configuration.tsx`, `shared.tsx`) et de l'API (`configs.ts`, `db-errors.ts`) ; le tarif `0` est accepté (taux nul).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (l'enseignant n'ouvre pas la page, 13.21)

#### 13.4 Tarifs horaires et simulateur de tarif
Compte : économe · Où : « Configuration » > « Tarifs horaires » (`/v2/payroll/configuration/rates`) · Prérequis : 13.3.
1. Constater « Aucun tarif » et « Sans tarif applicable, les heures d'un enseignant horaire sont écartées du calcul. ».
2. Cliquer « Nouveau tarif » et créer un **tarif générique** :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Cours | le cours "Mathématiques" de la liste (groupée par "Programme — année") | oui |
   | Enseignant (tarif nominatif) | (vide : tarif générique du cours) | non |
   | Tarif horaire | `4000` | oui (0 est une valeur, taux nul) |
   | Valide à partir du | `01/09/2026` | oui |
   | Jusqu'au (facultatif) | (vide) | non |
   | Notes | `Tarif générique test guide` | non (500 caractères au plus) |
3. « Enregistrer ». Créer ensuite un **tarif nominatif** : même cours, « Enseignant (tarif nominatif) » `TRAORE Kouadio`, « Tarif horaire » `5000`, « Valide à partir du » `01/09/2026`, « Notes » `Tarif nominatif test guide`.
4. Filtrer par « Type de tarif » : « Génériques » (une ligne, badge « Générique »), « Nominatifs » (une ligne), « Tous ».
5. Dans « Simulateur de tarif », cliquer « Simuler » pour chaque cas : (a) TRAORE Kouadio + cours Mathématiques + « À la date du » aujourd'hui ; (b) YAO Fatou + Mathématiques + aujourd'hui ; (c) YAO Fatou, cours vide ; (d) KOUAME Adjoua, cours vide ; (e) TRAORE Kouadio + Mathématiques + `31/08/2026`.
6. Sur le tarif générique, cliquer « Modifier » : le cours et l'enseignant sont figés (texte « Le cours et l'enseignant d'un tarif ne se modifient pas : créez un nouveau tarif pour changer de périmètre. »). Changer « Notes » en `Tarif générique modifié test guide`, « Enregistrer ».
7. Sur la ligne du tarif nominatif, cliquer « Supprimer », lire « Les bulletins déjà calculés ne sont pas modifiés. », confirmer par « Supprimer ». Recréer ensuite le tarif nominatif (étape 3) pour la suite (facultatif).
Résultat attendu : messages « Le tarif a été enregistré. » et « Le tarif a été supprimé. ». Simulateur : (a) « Tarif retenu : 5 000 F CFA par heure — Tarif du cours pour cet enseignant. Configuration en cours. » ; (b) « Tarif retenu : 4 000 F CFA par heure — Tarif générique du cours. Configuration en cours. » ; (c) « Tarif retenu : 3 000 F CFA par heure — Tarif par défaut de la configuration. Configuration en cours. » (3 000 si l'étape 6 de 13.3 a remis le tarif de YAO à 3000) ; (d) « Aucun tarif applicable. Aucune configuration. » ; (e) tarifs de cours non valides à cette date : retombe sur « Tarif par défaut de la configuration » (3 000 F CFA).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Aucun cours choisi | Choix invalide. (sous « Cours ») |
| « Tarif horaire » vide | Saisissez un montant. |
| « Tarif horaire » `4000,5` ou `4.000` | Le montant est un entier en francs : pas de virgule ni de point. |
| « Tarif horaire » `-4000` | Le montant ne peut pas être négatif. |
| Second tarif générique du même cours dont les dates chevauchent le premier | Un tarif chevauchant existe déjà pour ce cours et cet enseignant (TARIF_CHEVAUCHANT). |
| « Jusqu'au (facultatif) » avant « Valide à partir du » | La date de fin précède la date de début. |

Le tarif d'un cours ne s'applique qu'à des heures rattachées à un cours (séances de l'emploi du temps) ; un pointage simple d'arrivée et de départ n'a pas de cours et se paie au « Tarif par défaut de la configuration » (voir 13.13).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (enseignant, 13.21)

#### 13.5 Créer la période de septembre
Compte : économe · Où : « Périodes » (`/v2/payroll`) > « Nouvelle période » · Prérequis : 13.3 ; aucune période « En attente de calcul » (sinon la clôturer ou la calculer d'abord).
1. Cliquer « Nouvelle période » et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom | `Septembre test guide` (100 caractères au plus) | oui |
   | Du | `01/09/2026` | oui |
   | Au | `30/09/2026` | oui |
   | Année scolaire | l'année en cours (liste « Choisir une année… ») | oui |
   | Description | `Période de test du guide` | non (500 caractères au plus) |
   | Enseignants ciblés | (vide : période collective) | non |
2. Cliquer « Créer la période ».
3. Dans la liste, relever la ligne ; essayer à nouveau d'ouvrir « Nouvelle période ».
Résultat attendu : bandeau "La période ‹ Septembre test guide › a été créée." ; la ligne affiche « Du 01/09/2026 au 30/09/2026 », « Collective », les badges « Brouillon » et « En attente de calcul » ; un avertissement "La période ‹ Septembre test guide › est en attente de calcul : calculez-la ou clôturez-la avant d'en créer une autre." avec le lien « Ouvrir la période » apparaît et le bouton « Nouvelle période » est **désactivé**.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Nom » vide | Ce champ est obligatoire. |
| « Du » ou « Au » vide | Ce champ est obligatoire. |
| « Année scolaire » non choisie | Ce champ est obligatoire. |
| « Au » `31/08/2026` avec « Du » `01/09/2026` | La date de fin précède la date de début. (sous « Au ») |
| Seconde période alors que "Septembre test guide" est en attente | bouton désactivé ; si la création passait malgré tout, l'API répond : Une période est déjà en attente de calcul : lancez son calcul ou clôturez-la avant d'en créer une autre. |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (secrétariat, 13.21)

#### 13.6 Aperçu puis calcul de la période de septembre
Compte : économe · Où : fiche de la période (`/v2/payroll/periods/<identifiant>`, lien sur le nom dans la liste) · Prérequis : 13.5.
1. Lire l'en-tête : "Septembre test guide", « Du 01/09/2026 au 30/09/2026 », « Collective » ; boutons « Retour aux périodes » et « Activer la période ».
2. Dans « Calcul de la paie », laisser « Origine des heures » sur « Toutes les origines » et ne cocher rien. Cliquer « Aperçu (sans enregistrer) ».
3. Lire « Aperçu du calcul », puis cliquer « Voir le détail (… ligne…) » si le bouton est proposé.
4. Dans « Limiter à certains membres du personnel », ajouter `YAO Fatou` (pastille retirable), relancer « Aperçu (sans enregistrer) », puis retirer la pastille.
5. Cliquer « Lancer le calcul ».
6. Relancer « Lancer le calcul » une seconde fois (sans cocher « Recalculer les bulletins déjà calculés »).
Résultat attendu : étape 3 : bandeau « Aperçu : aucun bulletin n'a été créé ni modifié. » ; TRAORE Kouadio « Calculé » avec un total de 150 000 F CFA (« Salaire » 150 000 F CFA, aucune ligne d'heures : mois complet, 22 jours ouvrés sur 22) ; YAO Fatou « Écarté » avec « Aucune heure validée sur la période. » ; KOUAME Adjoua « Écarté » avec « Aucune configuration de paie valide sur la période. » (d'autres membres du personnel enseignant sans configuration peuvent aussi apparaître « Écarté »). Étape 4 : seul YAO Fatou est listé. Étape 5 : « Compte rendu du calcul » avec « Calculés » 1 ; la période passe à « Active » (badge) et perd « En attente de calcul » ; le bouton « Nouvelle période » est de nouveau actif dans `/v2/payroll` ; « Bulletins de la période » liste TRAORE Kouadio (type « Mixte », statut « Calculé », 150 000 F CFA). « Historique des calculs » liste l'aperçu et le calcul. Étape 6 : TRAORE Kouadio est « Écarté » avec le motif "Déjà calculé : cochez recalculer pour le reconstruire" (aucun doublon de bulletin).
- [ ] Cas nominal  - [ ] Aperçu sans effet (rien dans « Bulletins de la période » avant l'étape 5)  - [ ] Droit refusé pour le secrétariat

#### 13.7 Primes et retenues sur un bulletin calculé
Compte : économe · Où : fiche du bulletin (`/v2/payroll/payslips/<identifiant>`, lien sur le nom dans « Bulletins de la période ») · Prérequis : 13.6.
1. Ouvrir le bulletin « Bulletin de TRAORE Kouadio » : lire « Rémunération de type Mixte », le badge « Calculé », les montants (« Salaire », « Base (salaire et heures normales) », « Heures supplémentaires », « Primes », « Retenues », « Total ») et « Aucune ligne d'heures (bulletin de salaire). ».
2. Dans « Primes et retenues », cliquer « Ajouter une prime ou une retenue » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nature | « Prime » | oui |
   | Montant | `10000` | oui |
   | Libellé | `Prime d'assiduité test guide` | oui (160 caractères au plus) |
   | Motif | `Assiduité de septembre` | non (500 caractères au plus) |
3. Cliquer « Ajouter ». Ajouter ensuite une retenue : Nature « Retenue », Montant `2000`, Libellé `Avance sur salaire test guide`.
4. Cliquer « Retirer » sur la retenue, vérifier le total, puis la ré-ajouter (même saisie).
Résultat attendu : messages « L'ajustement a été ajouté. » puis « L'ajustement a été retiré. » ; lignes "Prime — Prime d'assiduité test guide" (+ 10 000 F CFA) et "Retenue — Avance sur salaire test guide" (− 2 000 F CFA) ; **Total = 150 000 + 10 000 − 2 000 = 158 000 F CFA**, « Primes » 10 000 F CFA, « Retenues » 2 000 F CFA ; le journal « Historique du bulletin » ajoute les actions (affichées en codes anglais, voir Écarts).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Montant » vide | Saisissez un montant. |
| « Montant » `0` | Montant invalide : chiffres uniquement, strictement positif. |
| « Montant » `-500` | Le montant ne peut pas être négatif. |
| « Montant » `1500,5` | Le montant est un entier en francs : pas de virgule ni de point. |
| « Libellé » vide | Ce champ est obligatoire. |
| Retenue de `999999` (supérieure au montant du bulletin) | Les retenues dépassent le montant du bulletin. |
| Après l'arrêt du montant (13.9) : le bouton disparaît | Seul un bulletin ‹ calculé › accepte des primes ou retenues. |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 13.8 L'économe ne peut ni arrêter, ni contester, ni annuler
Compte : économe · Où : fiche du bulletin de TRAORE Kouadio (« Calculé ») et fiche de la période · Prérequis : 13.7.
1. Sur la fiche du bulletin, chercher les boutons « Arrêter le montant », « Contester », « Annuler le bulletin ».
2. Sur la fiche de la période, dans « Bulletins de la période », chercher « Arrêter la sélection (0) » et « Tout arrêter ».
3. Relever ce qui est proposé : « Verser la sélection (0) », « Tout verser », case de sélection de chaque ligne.
Résultat attendu : les cinq boutons d'arrêt, de contestation et d'annulation sont **absents** pour l'économe (permissions `payroll.payslip.approve` et `payroll.payslip.cancel` non détenues) ; « Verser la sélection (0) » et « Tout verser » sont présents. L'indication « Selon les réglages de l'établissement, la personne qui a calculé un bulletin ne peut pas l'arrêter, et au-delà d'un seuil seul le propriétaire le peut. Les refus sont expliqués ci-dessous. » reste affichée.
- [ ] Cas nominal  - [ ] Droit refusé : boutons absents pour l'économe

#### 13.9 Arrêt du montant par le directeur (quatre yeux)
Compte : directeur · Où : fiche du bulletin de TRAORE Kouadio · Prérequis : 13.7 ; « Séparation des tâches » décochée (état de départ).
1. Ouvrir le bulletin (menu « Bulletins de paie » > « Bulletins » > TRAORE Kouadio). Cliquer « Arrêter le montant ».
2. Dans la fenêtre « Arrêter ce bulletin de paie ? », lire « Le montant arrêté devient le montant à payer ; il ne pourra plus être recalculé. », puis cliquer « Arrêter le montant ».
3. Relever le statut, les mentions « Calculé » / « Arrêté » (« par <nom>, le <date> »), le bloc « Bulletin arrêté », et « Primes et retenues ».
Résultat attendu : message « Le montant du bulletin est arrêté. » ; badge « Arrêté (impayé) » ; « Calculé » par l'économe et « Arrêté » par le directeur (deux personnes différentes) ; bloc « Bulletin arrêté » avec le badge "NON VERSÉ" (filigrane) et « Intégrité vérifiée », montants Salaire 150 000 F CFA, Primes 10 000, Retenues 2 000, Total 158 000 F CFA, une empreinte « Empreinte SHA-256 : » ; sous « Primes et retenues » le texte "Seul un bulletin ‹ calculé › accepte des primes ou retenues." et plus de bouton « Ajouter une prime ou une retenue ». Les boutons « Constater le versement », « Contester », « Annuler le bulletin » et « Envoyer au titulaire » sont proposés au directeur.
Variante (par lot) : sur un autre bulletin « Calculé », cocher la ligne dans la fiche de la période, « Arrêter la sélection (1) » ou « Tout arrêter », confirmer par « Arrêter » : message « Opération d'arrêt terminée. » et « 1 bulletin arrêté · 0 inchangé(s) · 0 refusé(s). ».
- [ ] Cas nominal  - [ ] Droit refusé pour l'économe (13.8)

#### 13.10 L'enseignant voit ses bulletins (avant et après l'arrêt)
Compte : enseignant (TRAORE Kouadio) · Où : menu « Mes bulletins de paie » (`/v2/teacher/payslips`) · Prérequis : 13.6 (avant l'arrêt) puis 13.9 (après).
1. **Avant l'arrêt** (faire cette lecture entre 13.6 et 13.9, ou avec un second bulletin « Calculé ») : ouvrir `/v2/teacher/payslips`.
2. **Après l'arrêt** : recharger. Lire la ligne puis cliquer sur sa date.
3. Sur la fiche, lire le bloc « Bulletin arrêté », puis cliquer « Télécharger le PDF ».
Résultat attendu : avant : encart « Vous voyez vos bulletins à partir de l'arrêt du montant : un brouillon calculé reste réservé à la gestion. », « Aucun bulletin » et « Vos bulletins apparaîtront ici dès que leur montant sera arrêté. » (un bulletin « Calculé » n'est jamais visible du titulaire). Après : une ligne avec la date de l'arrêt, le statut « Arrêté (impayé) », « Primes » 10 000 F CFA, « Retenues » 2 000 F CFA, « Montant » 158 000 F CFA et « Versé le » « Pas encore versé ». Fiche : titre « Bulletin de paie », boutons « Retour à mes bulletins », « Télécharger le PDF », « Contester ce bulletin », texte « Vous pouvez contester un bulletin arrêté tant qu'il n'est pas versé, en indiquant le motif. », badge "NON VERSÉ". Le clic sur « Télécharger le PDF » avant le versement échoue avec le message de l'API : Le PDF officiel n'est disponible qu'une fois le bulletin versé ; utilisez l'aperçu imprimable en attendant. (l'aperçu imprimable est le bouton « Imprimer » du bloc « Bulletin arrêté »).
- [ ] Cas nominal  - [ ] Bulletin « Calculé » invisible  - [ ] Droit refusé : bulletin d'un autre (13.21)

#### 13.11 Versement par l'économe
Compte : économe · Où : fiche du bulletin de TRAORE Kouadio · Prérequis : 13.9.
1. Ouvrir le bulletin « Arrêté (impayé) ». Cliquer « Constater le versement » (le montant « Vous constatez le versement de 158 000 F CFA. » est rappelé).
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Mode de versement | « Virement bancaire » (valeur de départ « Mobile money ») | oui |
   | Référence | `VIR-TG-001` | non (120 caractères au plus) |
3. Cliquer « Constater le versement » dans la fenêtre. Cliquer ensuite « Envoyer au titulaire ».
4. Se reconnecter en enseignant : `/v2/teacher/payslips` puis la fiche, puis « Télécharger le PDF ».
Résultat attendu : message « Le versement est constaté. » ; badge « Versé » ; mention « Versé » « par <nom>, le <date> · Virement bancaire · VIR-TG-001 » ; le bouton « Annuler le bulletin » **disparaît** (un bulletin versé ne s'annule pas) et « Contester » aussi ; « Envoyer au titulaire » donne « L'envoi du bulletin à son titulaire a été demandé. » (demande enregistrée, aucun envoi réel). Côté enseignant : « Versé le » affiche la date, le filigrane "NON VERSÉ" disparaît, le bouton « Contester ce bulletin » n'est plus proposé, et « Télécharger le PDF » fournit un PDF scellé (si le document tarde : « Le document est en cours de préparation. Réessayez dans quelques instants. » ; le rendu dépend du service de documents : à vérifier en test).
- [ ] Cas nominal  - [ ] Annulation impossible après versement  - [ ] Droit refusé pour le secrétariat

#### 13.12 Historique, rapports et exports CSV
Compte : économe · Où : « Historique » (`/v2/payroll/history`) et « Rapports » (`/v2/payroll/reports`) · Prérequis : 13.11.
1. « Historique » : lire la ligne de TRAORE Kouadio (statut « Versé », colonne « Arrêté » « <date>, par <directeur> », colonne « Versé » « <date>, par <économe> (Virement bancaire) », « Montant » 158 000 F CFA). Filtrer par « Année scolaire », « Période », « Enseignant ». Cliquer « Exporter en CSV ».
2. « Rapports » : lire le tableau « Bulletins par statut » (colonnes « Statut », « Bulletins », « Présences », « Séances », « Hors heures », « Total », « Origine filtrée »), la phrase « Total de l'origine filtrée : », et le tableau « Heures par origine » s'il est affiché. Changer « Origine des heures » (« Toutes les origines », « Séances seulement », « Présences seulement »), les dates « Du » / « Au », « Période ». Cliquer « Exporter en CSV ».
Résultat attendu : le montant de la ligne « Versé » est 158 000 F CFA ; pour chaque statut, « Présences » + « Séances » + « Hors heures » = « Total » (le salaire est "hors heures") ; un fichier `historique-paie.csv` et un fichier `rapport-paie.csv` sont téléchargés, s'ouvrent dans un tableur avec les accents lisibles (BOM UTF-8), et leurs montants sont ceux de l'écran (contenu exact des colonnes : à relever en test). L'export est audité côté serveur. Pendant l'export le bouton affiche « Export en cours… ».
- [ ] Cas nominal  - [ ] Droit refusé pour l'enseignant et le secrétariat

#### 13.13 Heures de cours : le pointage de l'enseignant
Compte : enseignant, puis économe · Où : « Mes congés et ma présence » (`/v2/teacher/leaves`) · Prérequis : la fonction "présence du personnel" de l'offre (sinon l'écran affiche « La présence du personnel n'est pas incluse dans votre offre. ») ; le calcul du scénario 13.14 n'a pas encore été lancé ; aucun pointage déjà fait aujourd'hui (un seul pointage « Arrivée » / « Départ » par jour et par personne).
1. En enseignant, ouvrir `/v2/teacher/leaves` (titre « Ma présence »). Dans « Pointer », cliquer « Arrivée » : message « Arrivée enregistrée. ».
2. Attendre **environ deux minutes** (entre 1 min 30 s et 2 min 29 s pour obtenir 2 minutes : la durée est arrondie à la minute).
3. Cliquer « Départ » : message « Départ enregistré. ». Relever dans « Présences » la ligne du jour avec les colonnes « Arrivée » et « Départ ».
4. En économe, ouvrir `/v2/payroll`, créer la période d'octobre **sans la calculer** (voir 13.14 pour le calcul) : `Octobre test guide`, du `01/10/2026` au `31/10/2026` (ou le mois en cours), même année scolaire. Ouvrir la fiche puis cliquer « Aperçu (sans enregistrer) » avec « Origine des heures » « Présences seulement ».
Résultat attendu : la présence est « terminée » (arrivée et départ pointés) ; dans l'aperçu, TRAORE Kouadio est « Calculé » : le détail liste une ligne d'origine « Présences » (« Tarif par défaut de la configuration », 3 000 F CFA l'heure). Pour une durée de pointage D minutes (D = 2) et la configuration de 13.3 (seuil 1 minute par semaine, majoration ×2) : première minute en « Heures normales » = 50 F CFA, minutes suivantes en « Heures sup. » à ×2 = 100 F CFA chacune ; total des heures = 50 + 100 × (D − 1) ; pour D = 2 : **150 F CFA**, soit un bulletin de **150 000 + 150 = 150 150 F CFA** (le salaire du mois civil entier d'octobre s'ajoute car TRAORE est « Mixte »). Sans la configuration de test (seuil 2 400 minutes), 2 minutes donneraient 100 F CFA d'heures normales. La durée n'est pas saisissable à la main (voir Écarts).
- [ ] Cas nominal  - [ ] Une seule arrivée par jour (un second clic « Arrivée » ne crée pas de nouvelle ligne)  - [ ] Cas invalide : propriétaire, `/v2/teacher/leaves`, « Arrivée » : Aucun profil de personnel n'est lié à votre compte.

#### 13.14 Quatre yeux : le directeur ne peut pas arrêter ce qu'il a calculé
Comptes : propriétaire, directeur, économe · Où : `/v2/payroll/configuration/settings`, `/v2/payroll`, « Masse salariale » (`/v2/payroll/owner`) · Prérequis : 13.13 (période "Octobre test guide" créée, **non calculée**).
1. Propriétaire : dans « Réglages », cocher « Séparation des tâches » (aide : « La personne qui a calculé un bulletin ne peut pas l'arrêter. »), laisser « Seuil de validation par le propriétaire » vide, « Enregistrer les réglages » (« Les réglages ont été enregistrés. »).
2. Directeur : ouvrir la fiche de "Octobre test guide", cliquer « Lancer le calcul ». Le bulletin de TRAORE Kouadio est « Calculé » (150 150 F CFA) ; YAO Fatou est « Écarté » (« Aucune heure validée sur la période. ») et KOUAME Adjoua « Écarté » (« Aucune configuration de paie valide sur la période. »).
3. Toujours en directeur : fiche du bulletin, « Arrêter le montant », confirmer « Arrêter le montant ».
4. Économe : ouvrir le même bulletin : lire « Calculé » par le directeur. Chercher « Arrêter le montant » (absent, 13.8).
5. Propriétaire : « Masse salariale » (`/v2/payroll/owner`) : pour la ligne "Octobre test guide", cliquer « Bulletins à valider », lire l'indication « Valider arrête le montant du bulletin, comme sur l'écran du gestionnaire (même action). », puis cliquer « Valider » en face de TRAORE Kouadio.
Résultat attendu : étape 3 : l'arrêt est **refusé** ; un bandeau d'avertissement affiche "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter." suivi de l'explication « Séparation des tâches : faites arrêter ce bulletin par une autre personne que celle qui l'a calculé. » ; le bulletin reste « Calculé ». Étape 5 : message « Le bulletin est validé. » ; le bulletin passe à « Arrêté (impayé) » (même action que l'arrêt du gestionnaire). Dans « Masse salariale », la période affiche, par statut, le montant et le nombre de bulletins, et la ligne « Compté ». Si l'onglet « Masse salariale » est absent ou si l'écran affiche « La masse salariale et la validation par le propriétaire ne sont pas incluses dans l'offre de l'établissement. », la fonction n'est pas dans l'offre : le noter (fait partie de l'abonnement) et passer au seuil en 13.16 par le seul réglage.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Directeur arrête un bulletin qu'il a lui-même calculé (réglage coché) | Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter. |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'économe n'a ni « Arrêter le montant » ni « Valider »

#### 13.15 Contestation par l'enseignant, décision de la direction
Comptes : enseignant, directeur, propriétaire · Où : `/v2/teacher/payslips/<identifiant>` puis fiche du bulletin · Prérequis : 13.14 (bulletin d'octobre « Arrêté (impayé) », non versé).
1. Enseignant : `/v2/teacher/payslips` doit lister deux bulletins (septembre « Versé », octobre « Arrêté (impayé) »). Ouvrir celui d'octobre, cliquer « Contester ce bulletin ».
2. Dans « Contester le bulletin », remplir « Motif de la contestation » : `Heures de pointage à vérifier test guide` (3 à 500 caractères), cliquer « Envoyer la contestation ».
3. Directeur : ouvrir le bulletin d'octobre : lire l'avertissement. Cliquer « Annuler le bulletin », saisir « Motif de l'annulation » `Contestation acceptée test guide`, confirmer « Annuler le bulletin ».
4. Enseignant : recharger `/v2/teacher/payslips`.
5. Propriétaire : « Masse salariale », ligne "Octobre test guide".
Résultat attendu : étape 2 : message « Votre contestation a été transmise à la gestion de la paie. » ; statut « Contesté » ; avertissement « Ce bulletin est contesté : la gestion de la paie l'examine. » ; le bouton « Contester ce bulletin » disparaît ; la liste affiche « Un de vos bulletins est contesté : la gestion vous recontactera. ». Étape 3 : avant l'annulation, la fiche du directeur affiche « Ce bulletin est contesté. Motif : Heures de pointage à vérifier test guide » ; après : message « Le bulletin est annulé. », avertissement « Ce bulletin est annulé. Motif : Contestation acceptée test guide », statut « Annulé », plus aucun bouton d'action. Étape 4 : le bulletin annulé **n'est plus visible** de l'enseignant (seuls les bulletins arrêtés, contestés et versés le sont). Étape 5 : la ligne « À part — annulés : 150 150 F CFA (1) · contestés : 0 F CFA (0). » (les annulés et contestés sont exclus du total compté).
Variante (contestation par la gestion) : sur un bulletin « Arrêté (impayé) », le directeur peut cliquer « Contester » (fenêtre « Contester le bulletin », « Motif de la contestation », bouton « Contester ») : message « Le bulletin est contesté. ». Le retour d'un bulletin contesté à « Arrêté » (nouvel arrêt depuis la sélection de la période) est possible dans les règles : à vérifier en test sur l'écran.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Motif de 1 ou 2 caractères (contestation, annulation ou contestation par la gestion) | Le motif doit comporter au moins 3 caractères. |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : seul le titulaire voit « Contester ce bulletin »

#### 13.16 Nouveau calcul après annulation, seuil du propriétaire et versement par lot
Comptes : économe, propriétaire, directeur · Où : fiche de la période "Octobre test guide" · Prérequis : 13.15.
1. Économe : sur la fiche de la période, cliquer « Lancer le calcul » (sans recalculer). Un nouveau bulletin de TRAORE Kouadio est « Calculé » (150 150 F CFA) : les heures et les jours de salaire relâchés par l'annulation sont repris.
2. Propriétaire : « Réglages » : « Seuil de validation par le propriétaire » = `100000` (la séparation des tâches peut rester cochée : l'économe, et non le directeur, a calculé). « Enregistrer les réglages ».
3. Directeur : bulletin « Calculé » de TRAORE Kouadio > « Arrêter le montant » > confirmer.
4. Propriétaire : « Masse salariale » > "Octobre test guide" > « Bulletins à valider » > « Valider ».
5. Économe : fiche de la période > cocher la ligne de TRAORE Kouadio > « Verser la sélection (1) », « Mode de versement » « Mobile money » (valeur de départ), « Référence » `TG-MM-001`, « Constater le versement ».
6. Propriétaire : « Réglages » : vider « Seuil de validation par le propriétaire », décocher « Séparation des tâches », « Enregistrer les réglages » (retour à l'état de départ).
Résultat attendu : étape 3 : l'arrêt est **refusé** : "Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin.", suivi de l'explication "Montant au-dessus du seuil : seul le propriétaire peut l'arrêter, depuis ‹ Masse salariale ›." ; étape 4 : « Le bulletin est validé. » ; étape 5 : message « Opération de versement terminée. » et « 1 bulletin versé · 0 inchangé(s) · 0 refusé(s). » ; statut « Versé » avec « Mobile money » et la référence. Étape 1 : si le bulletin n'est pas recréé (message d'écart, ligne « Verrouillé » ou « Écarté »), le consigner : le comportement attendu par le code est que seul un bulletin non annulé bloque un nouveau calcul (à vérifier en test).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Directeur arrête un bulletin dont le total dépasse le seuil | Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin. |
| Directeur tape `/v2/payroll/configuration/settings` pour baisser le seuil | page « Accès refusé » |
| Aucune ligne cochée dans la fiche de la période | le bouton « Verser la sélection (0) » est désactivé (un lot vide n'est jamais envoyé) |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur (réglages)

#### 13.17 Masse salariale : lecture après le cycle complet
Compte : propriétaire · Où : « Masse salariale » (`/v2/payroll/owner`) · Prérequis : 13.16.
1. Lire « Masse salariale comptée » et la note « 2 bulletins comptés (hors annulés et contestés). ».
2. Pour "Septembre test guide" et "Octobre test guide", lire les montants par statut et la ligne « Compté ».
3. Lire la ligne "À part — annulés : …" de la période d'octobre.
Résultat attendu (avec D = 2 minutes en 13.13) : **308 150 F CFA** compté (158 000 de septembre + 150 150 d'octobre) ; septembre « Versé » 158 000 F CFA (1), octobre « Versé » 150 150 F CFA (1) ; « À part — annulés : 150 150 F CFA (1) · contestés : 0 F CFA (0). ». Le total compté additionne les statuts « Calculé », « Arrêté (impayé) » et « Versé ».
- [ ] Cas nominal  - [ ] Droit refusé : enseignant, secrétariat (13.21)

#### 13.18 Un jour de salaire et une heure ne se paient qu'une fois ; bulletin versé verrouillé
Compte : économe · Où : `/v2/payroll` puis fiche de période · Prérequis : 13.16 (aucune période « En attente de calcul »). Si l'exécution n'a pas lieu en octobre, choisir pour "Chevauchement test guide" une fenêtre qui couvre la fin de septembre et le début de la période du mois en cours.
1. Créer la période `Chevauchement test guide` du `15/09/2026` au `15/10/2026` (même année scolaire), l'ouvrir, cliquer « Lancer le calcul ».
2. Ouvrir la fiche de "Septembre test guide", cocher « Recalculer les bulletins déjà calculés », cliquer « Recalculer ». Lire la fenêtre « Recalculer les bulletins » et confirmer par « Recalculer ».
Résultat attendu : étape 1 : TRAORE Kouadio est « Écarté » avec « Rien à verser : les jours ont déjà été payés par une autre période. » (tous les jours ouvrés du 15/09 au 15/10 sont déjà portés par les bulletins de septembre et d'octobre, et l'heure pointée aussi) ; aucun bulletin n'est créé. Étape 2 : TRAORE Kouadio est « Verrouillé » avec « Bulletin déjà arrêté, versé ou annulé : un recalcul ne le réécrit jamais. » et le message de l'API « Bulletin PAID : non réécrit par le calcul. ». Aucune ligne n'est modifiée.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : bouton d'arrêt absent pour l'économe

#### 13.19 Clôturer et archiver une période
Compte : économe (ou directeur) · Où : fiche de "Septembre test guide" · Prérequis : 13.18.
1. Cliquer « Clôturer la période ». Lire « Une période clôturée n'accepte plus de nouveau calcul. », confirmer par « Clôturer ». Message « Le statut de la période a été mis à jour. », badge « Clôturée ».
2. Cliquer « Lancer le calcul » sur la période clôturée.
3. Cliquer « Archiver la période ». Lire « L'archivage est définitif. », confirmer par « Archiver ». Badge « Archivée ».
Résultat attendu : étape 2 : refus "La période est clôturée ou archivée : le calcul est refusé." (l'aperçu reste possible sur une période clôturée) ; étape 3 : plus aucun bouton de changement de statut. Les bulletins versés restent consultables dans « Bulletins » et « Historique ». Une période « Brouillon » propose « Activer la période » (statut « Active »).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant

#### 13.20 « Mes bulletins » du salarié (`/v2/payroll/my`)
Compte : enseignant, puis propriétaire · Où : `/v2/payroll/my` et `/v2/payroll/my/<identifiant>` · Prérequis : 13.11.
1. Enseignant : ouvrir `/v2/payroll/my` (titre « Mes bulletins », barre de section avec l'entrée « Mes bulletins »). Cliquer la date d'un bulletin.
2. Sur `/v2/payroll/my/<identifiant>` (titre « Mon bulletin »), lire le bloc « Bulletin arrêté », le lien « Retour à mes bulletins » et le texte « Une erreur ? Contactez la gestion de l'établissement : la contestation est enregistrée par un gestionnaire. ».
3. Propriétaire : taper `/v2/payroll/my`.
Résultat attendu : la liste est la même que celle de `/v2/teacher/payslips` (colonnes « Date », « Statut », « Primes », « Retenues », « Montant », « Versé le ») ; la contestation ne se fait **que** sur `/v2/teacher/payslips/<identifiant>` (ici, seulement un texte renvoyant à la gestion). Propriétaire : la page s'ouvre (il détient la permission) mais l'API répond Votre compte n'est lié à aucun membre du personnel. (il n'a pas de fiche de personnel) : comportement attendu hors menu.
- [ ] Cas nominal  - [ ] Cas invalide (propriétaire)  - [ ] Droit refusé pour l'économe (`/v2/payroll/my` : « Accès refusé »)

#### 13.21 Droits, identifiants inconnus et isolation entre établissements
Comptes : enseignant, économe, directeur, secrétariat, parent, élève ; directeur des Palmiers · Où : adresses ci-dessous · Prérequis : 13.11.
1. Taper les adresses du tableau "Droits" ci-dessus pour chaque compte.
2. Enseignant : taper `/v2/payroll/payslips/<identifiant du bulletin d'un autre enseignant>` (le relever en directeur dans la liste « Bulletins » : un bulletin d'une autre personne ; à défaut, utiliser un identifiant inventé de forme UUID `00000000-0000-0000-0000-000000000000`).
3. Enseignant : taper `/v2/teacher/payslips/abc`.
4. Directeur des Palmiers (`directeur@primaire-test.test`) : taper `/v2/payroll/payslips/<identifiant d'un bulletin du Collège>`.
Résultat attendu : étape 1 : « Accès refusé » (texte "Vous n'avez pas les droits nécessaires pour afficher cette page.") ; aucun menu de paie pour le secrétariat, le parent ni l'élève. Étape 2 : bulletin d'une autre personne : l'API répond Ce bulletin n'est accessible qu'à son titulaire et à la gestion. ; identifiant inventé : Bulletin de paie introuvable (<identifiant>). ; **les deux réponses sont différentes** (voir Écarts). Étape 3 : page "introuvable" du site (identifiant qui n'est pas un UUID). Étape 4 : Bulletin de paie introuvable (<identifiant>). aucune donnée du Collège n'apparaît.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé

---

## Données créées

- Configurations : TRAORE Kouadio (Mixte, 150 000 F CFA mensuel, 3 000 F CFA l'heure, seuil 1 minute, ×2, depuis le 01/08/2026) ; YAO Fatou (Horaire, 3 000 F CFA, depuis le 01/08/2026).
- Tarifs : générique "Mathématiques" 4 000 F CFA (notes `Tarif générique modifié test guide`) ; nominatif TRAORE Kouadio 5 000 F CFA (supprimé puis recréé).
- Périodes : `Septembre test guide` (archivée), `Octobre test guide`, `Chevauchement test guide`.
- Bulletins : septembre TRAORE Kouadio 158 000 F CFA (versé, `VIR-TG-001`) ; octobre TRAORE Kouadio 150 150 F CFA (un annulé, un versé `TG-MM-001`).
- Ajustements : `Prime d'assiduité test guide` 10 000 F CFA, `Avance sur salaire test guide` 2 000 F CFA.
- Présence du personnel : un pointage « Arrivée »/« Départ » de TRAORE Kouadio (aujourd'hui).
- Réglages de la paie : modifiés puis remis à l'état de départ (13.2, 13.16).

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Fiche d'un bulletin, « Historique du bulletin » | Les actions sont affichées en codes anglais (`CALCULATED`, `APPROVED`, `PAID`, `ADJUSTED`, `NOTIFIED`, `CANCELLED`, `DISPUTED`) (`Payslips.tsx`, ligne de l'historique). | Mineur |
| Tarifs horaires, chevauchement | Le message d'erreur contient un code technique : "… (TARIF_CHEVAUCHANT)." (`db-errors.ts`). | Mineur |
| Portail enseignant, fiche d'un bulletin arrêté | Le bouton « Télécharger le PDF » est proposé avant le versement alors que le PDF n'existe qu'une fois le bulletin versé : l'enseignant obtient une erreur (409). | Suggestion |
| Fiche d'un bulletin d'autrui | `GET /payroll/payslips/:id` et `/my/payslips/:id` répondent 403 pour le bulletin d'un tiers et 404 pour un identifiant inconnu (`queries.ts`, `authorizeRead` ; test `http.integration.test.ts`), alors que le README du module annonce une 404 uniforme : l'existence d'un identifiant se devine. Le PDF et la contestation, eux, sont uniformes. | Mineur |
| Compte rendu de calcul | Le motif d'écart s'affiche deux fois (libellé du motif puis message de l'API), par exemple « Aucune heure validée sur la période. » (déjà noté C-05-13 des sessions QA). | Mineur |
| Données de départ | L'annexe (section 4) annonce "personnel et paie" dans le prolongement de démonstration ; or `scripts/seed-v2/demo/staff.ts` ne crée que six comptes : aucune configuration, période, bulletin, ni présence du personnel. Les heures de cours ne peuvent venir que d'un pointage réel. | Suggestion |
| Présence du personnel | « Enregistrer une présence » (direction) n'a ni heure d'arrivée ni heure de départ ; seul le pointage « Arrivée » / « Départ » fabrique des heures payables, donc une durée en minutes passe par une attente réelle. | Suggestion |
| `/v2/payroll/my` pour le propriétaire et le directeur | Ces rôles détiennent `payroll.payslip.read_own` (droit "tout") mais n'ont pas de fiche de personnel : la page s'ouvre puis l'API refuse (déjà noté m8 de l'ancien guide). | Mineur |

## À vérifier en test

- Rendu et téléchargement du PDF scellé d'un bulletin versé (service de documents / worker), y compris le message « Le document est en cours de préparation. Réessayez dans quelques instants. ».
- Nouveau calcul après annulation (13.16, étape 1) : création d'un nouveau bulletin alors que l'ancien est « Annulé ».
- Réarrêt d'un bulletin « Contesté » (sélection de la période) et message affiché quand le propriétaire valide un bulletin déjà arrêté.
- Présence de la fonction « Masse salariale et validation par le propriétaire » et de la "présence du personnel" dans l'offre de démonstration.
- Libellé du cours dans la liste des tarifs (cours "Mathématiques" : code et libellé exacts à relever) ; contenu des colonnes des deux fichiers CSV.
- Fuseau et jour de pointage : la date du pointage "aujourd'hui" doit tomber dans la période d'octobre.
- Texte exact des messages marqués "d'après le code" (formulaire de configuration vide : "Choix invalide.").

## Non couvert / limites connues

- Packs Primaire et Supérieur : l'origine « Séances seulement » (heures issues des séances validées du pack Supérieur) et le tarif par cours lié à une séance ne sont pas déroulés ; le simulateur de tarif est la seule vérification des tarifs de cours.
- Période "ciblée" (liste d'« Enseignants ciblés ») et motif « Hors du périmètre de la période. » ; salaire annuel ; majoration réelle sur 40 heures par semaine.
- Envoi effectif des notifications (« Envoyer au titulaire » enregistre seulement une demande) ; aucun e-mail ni SMS réel.
- Règles de paie officielles ivoiriennes (cotisations, impôt) : le module ne les contient pas et ce guide n'en invente aucune.
- Module hérité (`docs/workflow-paie-enseignants.md`) : ses attendus ne sont pas repris.
