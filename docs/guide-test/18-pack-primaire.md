# Chapitre 18. Pack Primaire : maternelle, primaire, compétences, conseil des maîtres, bilan annuel

Ce chapitre couvre les écrans `app/v2/primary/**` : « Ma classe » (appel du jour, périodes, état "prête"), « Compétences » (grille sans note), « Appréciations » (banque de phrases), « Conseil des maîtres », « Avancement » (direction), « Bilans annuels » (scellement irréversible), « Archives », « États », « Paramètres » et « Bulletin et compétences » de la famille. Module API : `apps/api/src/modules/primary_school`.

Il traite : la maternelle (compétences, appréciations sans note), le CP1 (notes chiffrées dans les autres modules, compétences ici), l'état "prête" de la feuille classe × période, le conseil des maîtres (l'instituteur propose, la direction décide), le bilan annuel scellé, l'archive d'année et les états du primaire, avec leurs bandeaux et mentions « démonstration ».

**Adresses.** Les routes citées sont celles du navigateur : `http://localhost:3000/v2/primary/...` (aucun préfixe supplémentaire : `next.config.js` et `middleware.ts` ne réécrivent pas `/v2`). `/v2/primary` n'a pas de contenu propre : il redirige selon le profil (direction vers `/v2/primary/direction`, famille vers `/v2/primary/mon-enfant`, instituteur vers `/v2/primary/classe`).

**Établissement.** École Les Palmiers (`primaire-test`). Le pack Primaire n'existe que dans cet établissement (voir 18.21 pour les deux autres).

**Convention de citation.** Les libellés entre guillemets français « … » sont ceux de l'écran (`fr-CI.json`). Les valeurs à saisir, les messages venant de l'API, les noms de classes, de périodes, d'élèves et les libellés issus du modèle de pack (compétences, niveaux de maîtrise) sont en code ou entre guillemets droits.

## Parcours conseillé

| Ordre | Compte | Scénarios |
|---|---|---|
| A | Directeur (MFA), secrétariat | 18.1, 18.2 (lecture) |
| B | Instituteur de maternelle puis instituteur CP1 | 18.3 à 18.5 (lecture), 18.9 (banque) |
| C | Instituteur CP1 | 18.4, 18.6, 18.7, 18.8 (saisie, "prête", validation) |
| D | Directeur / directeur des études | 18.8 (révision), 18.10 à 18.12 (conseil), 18.9 (création de phrase) |
| E | Parent, élève | 18.18 |
| F | Directeur | 18.13 à 18.17 (bilans, archive, états, paramètres), 18.19 |
| G | Tous | 18.20 à 18.22 (droits, autre établissement, qualité) |

Actions à effet durable (à placer en dernier) : valider une grille (18.8), sceller et réémettre un bilan (18.14), publier un référentiel (18.17). `pnpm demo:reset` remet la démonstration à zéro.

## Prérequis

- Environnement de démonstration créé par `pnpm dev:v2:seed` (scénario de base puis `scripts/seed-v2/demo/primary.ts`, fonction `seedMaternelle`). Aucune écriture préalable n'est nécessaire.
- Connexion en cliquant sur le compte dans le panneau de droite de `/v2/login` (jamais de mot de passe dans ce guide) ; les comptes marqués MFA proposent le code du moment.
- Les jeux de règles du pack sont des **règles de démonstration** (jeu fictif `CI-PRIMARY-PLACEHOLDER`) : aucune règle officielle ivoirienne n'est utilisée ; ne tirer aucune conclusion réglementaire d'un résultat.

## Comptes

| Rôle | E-mail | MFA | Rôle dans ce chapitre |
|---|---|---|---|
| Instituteur (titulaire du CP1 A) | `enseignant@primaire-test.test` | non | saisit et valide les compétences du CP1 A, marque "prête", propose au conseil |
| Instituteur de maternelle (Grande Section A) | `instituteur.maternelle@primaire-test.test` | non | mêmes gestes pour la Grande Section A |
| Directeur | `directeur@primaire-test.test` | oui | révise, décide au conseil, scelle, gèle, règle le pack |
| Propriétaire | `direction.generale@primaire-test.test` | oui | mêmes droits que le directeur pour ce chapitre |
| Directeur des études | `etudes@primaire-test.test` | oui | banque d'appréciations, conseil (présidence), préparation des bilans et de l'archive, états ; ni scellé, ni révision, ni réglages |
| Secrétariat | `secretariat@primaire-test.test` | oui | lecture : avancement, bilans, états |
| Parent (tuteur n° 1) | `parent@primaire-test.test` | non | « Bulletin et compétences » de Nadia et de Salimata DIABATE |
| Élève | `eleve@primaire-test.test` | non | son propre espace (Nadia DIABATE) |
| Responsable pédagogique, économe, chargé d'admissions, responsable des examens | adresses de l'annexe | variable | refus attendus |

## Droits

Gardes des pages (`apps/web/src/app/v2/primary/_components/guards.ts`, un `layout.tsx` par section) et rôles qui ont l'une des permissions (`apps/api/src/modules/rbac/templates/system-roles.ts`). Le refus est une redirection vers `/unauthorized` : page de titre "Accès refusé" avec "Vous n'avez pas les droits nécessaires pour afficher cette page.".

| Section | Permissions (l'une des) | Instituteur | Directeur / propriétaire | Directeur des études | Secrétariat | Parent / élève |
|---|---|---|---|---|---|---|
| Ma classe `/v2/primary/classe` | `primary.competency.read`, `...record`, `primary.council.read`, `...prepare`, `primary.class.read_all` | oui (sa classe) | oui (toutes) | oui | oui | non |
| Compétences `/v2/primary/competences` | `primary.competency.read`, `...record` | oui (saisie, validation) | oui (+ révision) | lecture | lecture | non |
| Appréciations `/v2/primary/appreciations` | `primary.phrase.read`, `...manage` | lecture | gestion | gestion | non | non |
| Conseil `/v2/primary/conseil` | `primary.council.read`, `...prepare`, `...manage` | préparer, proposer | tout | présider, décider | non | non |
| Avancement `/v2/primary/direction` | `primary.report.read` | non | oui | oui | oui | non |
| Bilans `/v2/primary/bilans` | `primary.bilan.read`, `...prepare` | lecture de sa classe | préparer, sceller, réémettre | préparer | lecture | non |
| Archives `/v2/primary/archives` | `primary.archive.prepare`, `...freeze`, `primary.bilan.read` | lecture | préparer, geler | préparer | lecture | non |
| États `/v2/primary/etats` | `primary.report.read` | non | oui | oui | oui | non |
| Paramètres `/v2/primary/parametres` | `primary.settings.manage` | non | oui | non | non | non |
| Bulletin et compétences `/v2/primary/mon-enfant` | `primary.bilan.child.read`, `primary.bilan.self.read`, `primary.competency.child.read`, `primary.competency.self.read` | non | non | non | non | oui |

Actions sensibles (MFA et audit) : réviser une compétence validée, sceller, réémettre, geler, appliquer le modèle de pack.

**Adresses à taper à la main, refus attendu ("Accès refusé", aucune donnée) :**

| Compte | Adresses |
|---|---|
| Instituteur (CP1 ou maternelle) | `/v2/primary/direction`, `/v2/primary/etats`, `/v2/primary/parametres` |
| Secrétariat | `/v2/primary/parametres`, `/v2/primary/appreciations`, `/v2/primary/conseil` |
| Directeur des études | `/v2/primary/parametres` (seule page refusée), `/v2/primary/mon-enfant` |
| Parent, élève | `/v2/primary/classe`, `/v2/primary/competences`, `/v2/primary/bilans`, `/v2/primary/archives`, `/v2/primary/direction` |
| Responsable pédagogique, économe, chargé d'admissions | `/v2/primary`, `/v2/primary/classe`, `/v2/primary/direction` |

Le scénario 18.20 déroule ces contrôles.

## Données de départ

Source : `scripts/seed-v2/demo/primary.ts` (maternelle, `seedMaternelle`), `scripts/seed-v2/demo/index.ts` (CP1 A), `apps/api/src/modules/primary_school/templates/CI/primary.json` (modèle de pack). Les dates de l'année scolaire suivent la date de création de la base.

**Classe CP1 A (`CP1-A`, niveau CP1)** : titulaire TRAORE Kouadio (`enseignant@primaire-test.test`) ; élèves du scénario de base (DIABATE Nadia, DIABATE Salimata, BAMBA Aya, BAMBA Fatou, COULIBALY Moussa, COULIBALY Salimata, TOURE Yao, TOURE Jean-Marc, ... ; l'effectif affiché est celui des inscriptions confirmées, huit d'après l'annexe : à relever) ; notes et résultats de la période 1, clôturée par la graine ; bulletins PDF de la période 1. **Aucune compétence saisie.** La période 2 n'a pas été ouverte par la graine.

**Classe Grande Section A (`GS-A`, maternelle, capacité 25)** : titulaire ZOKORA Sylvie (`instituteur.maternelle@primaire-test.test`) ; 5 enfants inscrits par le circuit d'admission (parents sans compte) :

| Rang | Enfant | Compétence 1.1 | Compétence 1.2 | Compétence 2.1 | Décision du conseil | Bilan annuel |
|---|---|---|---|---|---|---|
| 1 | ADOU Aïcha | Acquis avec aisance (N4) | Acquis (N3) | En cours d'acquisition (N2) | Passage en classe supérieure | lire à l'écran |
| 2 | ASSI Brice | Acquis (N3) | En cours d'acquisition (N2) | Acquis (N3) | Passage en classe supérieure | lire à l'écran |
| 3 | DAGO Chantal | En cours d'acquisition (N2) | Acquis (N3) | En cours d'acquisition (N2) | Passage en classe supérieure | lire à l'écran |
| 4 | EKRA Désiré | Acquis (N3) | En cours d'acquisition (N2) | Acquis avec aisance (N4) | Passage en classe supérieure | lire à l'écran |
| 5 | FOFANA Estelle | En cours d'acquisition (N2) | Acquis avec aisance (N4) | **non évaluée** | **Redoublement** | lire à l'écran |

Les niveaux sont ceux des deux périodes (semestres 1 et 2, identiques et tous validés) ; les trois compétences s'intitulent `Compétence 1.1 (démonstration)`, `Compétence 1.2 (démonstration)` (domaine `Domaine 1 (démonstration)`) et `Compétence 2.1 (démonstration)` (domaine `Domaine 2 (démonstration)`). L'échelle `MASTERY_4` ("Niveaux de maîtrise (échelle de démonstration)") compte quatre niveaux : N1 "Non acquis", N2 "En cours d'acquisition", N3 "Acquis", N4 "Acquis avec aisance" (N3 et N4 : "attendu atteint").

Autres données de la Grande Section A :

- Appel du jour posé le jour de la graine (ASSI Brice absent, DAGO Chantal en retard de 10 minutes), validé par la direction.
- Conseil des maîtres de la **dernière période** de l'année, tenu le jour de la graine : feuille de présence = titulaire ZOKORA Sylvie (présente, **signée**), `DIRECTEUR Conseil` (président, présent, non signé), `SECRETAIRE Conseil` (secrétaire, présente, non signée) ; 5 dossiers tous décidés (justification de Estelle FOFANA : "Une compétence jamais évaluée de l'année : maintien décidé par le conseil (démonstration)."), procès-verbal demandé et émis.
- Périodes **toutes closes** (donc "verrouillées" à l'écran) ; bilans annuels : 5 préparés, **3 scellés** (PDF produit en arrière-plan) et **2 prêts à sceller** (lesquels : à relever).

Autres éléments : banque de 3 phrases de démonstration (`PERIOD_N1` "Des difficultés persistent ; un soutien est conseillé. (phrase de démonstration)", `PERIOD_N3` "Le travail est satisfaisant. (phrase de démonstration)", `YEAR_GENERIC` "Appréciation de fin d'année à compléter par l'instituteur. (phrase de démonstration)") ; deux référentiels publiés : `PRESCHOOL_DEMO` "Compétences de la maternelle (démonstration)" (niveaux PS, MS, GS) et `PRIMARY_DEMO` "Compétences du primaire (démonstration)" (CP1 à CM2, une seule compétence : `Compétence 1.1 (démonstration)`) ; réglages : titulaire exigé oui, décision du conseil exigée pour sceller oui, banque active oui, conservation des archives vide.

Parent DIABATE Séka : enfants Nadia et Salimata (CP1 A). Élève : Nadia. Aucun enfant de la Grande Section n'a de compte famille.

## Écarts constatés avant exécution (lecture du code)

À confirmer à l'écran et à reporter dans la section finale.

1. **L'ancien guide (C18.6) était inexact** : la révision d'une compétence validée est refusée sur une période verrouillée (`La période est verrouillée : rouvrir la période avant de réviser.`) et le bouton « Réviser » n'est même pas affiché sur une grille verrouillée. Toutes les périodes de la Grande Section étant closes, la révision ne se teste que sur le CP1 A (18.8).
2. **L'archive d'année ne peut pas devenir « Prête à geler » dans la démonstration.** Elle compte toutes les classes de l'établissement : les élèves du CP1 A n'ont aucun bilan, et l'année n'est pas close. Le gel (« Geler l'archive ») n'est donc pas atteignable et ne doit pas être forcé (18.15).
3. **Les "feux" de l'avancement ne sont pas verts pour la Grande Section** : 14 compétences saisies et validées sur 15 attendues (Estelle FOFANA non évaluée), donc "En cours" (orange), bilans scellés "3 sur 5" (18.2).
4. **Le conseil du CP1 A est incertain** : préparer un conseil exige un état de résultats pour la classe et la période ; décider exige une proposition de la règle (`La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés.`). Résultat à relever (18.12).
5. **Les familles ne voient ni le PDF ni les notes du bilan dans ce pack** : seulement les compteurs de compétences, la décision et l'empreinte. Le PDF des bilans et procès-verbaux se trouve du côté des documents officiels (chapitre Bulletins), emplacement à confirmer.
6. **Période "ouverte" par défaut** : l'écran « Ma classe » appelle "verrouillée" une période dont la notation est arrêtée ou close ; une période encore *planifiée* s'affiche "ouverte". La période 2 du CP1 A pourrait donc être saisissable sans que la direction l'ait ouverte (18.6, à relever).

---

## Scénarios

#### 18.1 Entrée par profil et barre « Pack Primaire »
Compte : plusieurs · Où : `/v2/primary`.
1. Connecté en directeur, taper `/v2/primary` : redirection vers `/v2/primary/direction` (« Avancement des classes »). Même résultat pour le secrétariat et le directeur des études.
2. Connecté en instituteur (`enseignant@primaire-test.test`) : `/v2/primary` redirige vers `/v2/primary/classe` (« Ma classe »). Idem pour l'instituteur de maternelle.
3. Connecté en parent : `/v2/primary` redirige vers `/v2/primary/mon-enfant`.
4. Lire la barre d'onglets « Pack Primaire » de chaque profil : seules les entrées permises sont affichées. Directeur : « Ma classe », « Compétences », « Appréciations », « Conseil des maîtres », « Avancement », « Bilans annuels », « Archives », « États », « Paramètres ». Instituteur : « Ma classe », « Compétences », « Appréciations », « Conseil des maîtres », « Bilans annuels », « Archives ». Secrétariat : « Ma classe », « Compétences », « Avancement », « Bilans annuels », « Archives », « États ». Parent : « Bulletin et compétences ».
5. Menu latéral (entrées du pack) : instituteur « Ma classe », « Compétences », « Appréciations », « Conseil des maîtres » ; direction « Pack Primaire » (= Avancement), « Conseil des maîtres », « Bilans annuels », « Archives d'année », « États du primaire » ; parent « Bulletin et compétences de mon enfant ».
Résultat attendu : chaque profil arrive sur son écran ; aucune entrée interdite n'est proposée.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un responsable pédagogique qui tape `/v2/primary` obtient "Accès refusé"

#### 18.2 Avancement des classes (direction)
Compte : directeur (MFA) · Où : menu « Pack Primaire » (`/v2/primary/direction`).
1. Ouvrir la page : titre « Avancement des classes ». Bandeau « Règles de démonstration » (texte "Règles de démonstration — document sans valeur officielle" et phrase "Les règles de calcul liées à cet établissement sont un jeu fictif : ne les utilisez pas comme référence officielle.").
2. Barre « Accès rapides » : « Conseil des maîtres », « Bilans annuels », « Archives », « États », « Paramètres » (le directeur voit les cinq).
3. Liste « Année » : « Année en cours » (ou l'année 2026-2027). Lire le tableau « Avancement par classe et par période » (colonnes « Classe », « Période », « État », « Élèves », « Saisies », « Validées », « Bilans scellés », « Période »).
4. Lire la règle d'affichage : « Rouge : rien n'est saisi. Vert : tout est saisi et validé, et les bilans existants sont scellés. Orange : le reste. Règle d'affichage, sans valeur réglementaire. ».
5. Chercher les quatre lignes (deux classes, deux périodes) :
   | Classe | Période | État | Élèves | Saisies | Validées | Bilans scellés | Période |
   |---|---|---|---|---|---|---|---|
   | CP1 A | semestre 1 | « Rien de saisi » (rouge) | effectif de la classe | `0 sur N` | `0 sur N` | `0 sur 0` | « Verrouillée » |
   | CP1 A | semestre 2 | « Rien de saisi » | idem | `0 sur N` | `0 sur N` | `0 sur 0` | « Ouverte » (à relever) |
   | Grande Section A | semestre 1 | « En cours » (orange) | 5 | `14 sur 15` | `14 sur 15` | `3 sur 5` | « Verrouillée » |
   | Grande Section A | semestre 2 | « En cours » (orange) | 5 | `14 sur 15` | `14 sur 15` | `3 sur 5` | « Verrouillée » |
   (N = effectif du CP1 A, une compétence attendue par élève.) Chaque état est porté par un texte et une icône, jamais par la couleur seule.
Résultat attendu : les comptages sont ceux du tableau ci-dessus ; l'orange de la Grande Section vient de la compétence jamais évaluée (écart n°3).
Cas invalides : choisir une année sans classe : état vide « Aucune classe à afficher. » / « Aucune classe n'est ouverte pour cette année. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'instituteur qui tape `/v2/primary/direction` obtient "Accès refusé"

#### 18.3 Ma classe : classes, périodes, titulaire (CP1 A et Grande Section A)
Compte : instituteur CP1 (`enseignant@primaire-test.test`) puis instituteur de maternelle · Où : « Ma classe » (`/v2/primary/classe`).
1. Instituteur CP1 : titre « Ma classe », phrase « Vos classes, leurs périodes et les gestes du quotidien : appel du jour, compétences, conseil. », bandeau « Règles de démonstration ». Une seule carte (liste « Mes classes ») : "CP1 A", code `CP1`, pastille d'effectif ("8 élèves" ou l'effectif lu) et pastille « Titulaire ».
2. Lire « Périodes » : le semestre 1 avec le cadenas et « verrouillée » ; le semestre 2 avec « ouverte ». À côté de chaque période, le bouton « Marquer `<période>` prête » (visible car l'instituteur peut valider).
3. Boutons de la carte : « Appel du jour », « Compétences », « Conseil ».
4. Instituteur de maternelle : une seule carte "Grande Section A", "5 élèves", « Titulaire » ; les deux semestres sont « verrouillée ». **Ne pas utiliser « Marquer ... prête » sur cette classe.**
5. Directeur : la page liste les deux classes (accès à toutes les classes).
Résultat attendu : un instituteur ne voit que sa classe ; l'effectif et les périodes sont ceux de la section "Données de départ".
Cas invalides : un compte sans classe affectée (par exemple le secrétariat qui n'a pas de classe propre voit toutes les classes ; un autre rôle du pack sans affectation) obtient « Aucune classe ne vous est affectée. » avec « Demandez à la direction de vous affecter comme titulaire d'une classe. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le parent qui tape `/v2/primary/classe` obtient "Accès refusé"

#### 18.4 Appel du jour (maternelle et CP1)
Compte : instituteur de maternelle, puis instituteur CP1 · Où : « Ma classe » > « Appel du jour » · Prérequis : le module de présence autorise l'appel journalier pour la classe.
1. Sur la carte "Grande Section A" cliquer « Appel du jour » (cela ouvre la séance d'appel du jour : action d'écriture). Le volet « Appel du `<date du jour>` » apparaît.
2. Si l'appel du jour de la graine existe déjà (même jour) : texte « L'appel du jour est déjà transmis : vous pouvez encore corriger un élève. » ; sinon : « Tout le monde est présent par défaut : touchez un élève pour le marquer absent, puis transmettez l'appel. ».
3. Lire le compteur « 5 présents · 0 absents » (ou celui de la graine : "3 présents · 1 absent" avec un retard).
4. Toucher la ligne « Marquer EKRA Désiré absent » (le nom affiché est "NOM Prénom") : la ligne passe à « Absent », la mention « Non transmis » apparaît, le compteur devient « 4 présents · 1 absents ».
5. Cliquer « Transmettre l'appel » : message « Appel transmis : 1 absent. ». Rouvrir le volet : "L'appel du jour est déjà transmis...". Corriger un élève : « Marquer EKRA Désiré présent », « Enregistrer les corrections » : « Corrections enregistrées. ».
6. Fermer avec « Fermer l'appel ».
7. Refaire avec le compte du CP1 sur la carte "CP1 A".
Résultat attendu : l'appel est transmis une fois ; la direction le valide dans le module Présences (chapitre correspondant) ; l'instituteur ne le valide pas.
Cas invalides :
| Situation | Message attendu |
|---|---|
| appel déjà validé par la direction | « L'appel de ce jour ne peut plus être modifié (validé, annulé ou délai de correction dépassé). » |
| ouverture refusée par la politique d'appel de l'établissement | message de l'API ; bouton « Réessayer » (à relever) |
| coupure réseau pendant l'envoi | « L'appel n'a pas pu être envoyé : vos saisies sont conservées, réessayez. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'économe n'a pas accès à `/v2/primary/classe`

#### 18.5 Compétences : lire la grille de la maternelle (sans note)
Compte : instituteur de maternelle · Où : « Compétences » (`/v2/primary/competences`), ou le bouton « Compétences » de « Ma classe » (adresse avec `?classe=`).
1. Titre « Compétences » et phrase « Évaluez le niveau de maîtrise de chaque compétence, par élève et par période. Une compétence non saisie reste « non évaluée ». ». Dans « Classe, période et référentiel », la classe "Grande Section A" est présélectionnée. Choisir la période : « Semestre 1 (verrouillée) » (libellé exact à relever).
2. Bandeau d'état : « La saisie est arrêtée pour cette classe et cette période : la grille est en lecture seule. ». Étiquette du référentiel : « Compétences de la maternelle (démonstration) » (démonstration en avertissement).
3. Vue « Fiche élève » (par défaut) : choisir l'élève "ADOU Aïcha" : les boutons de niveau sont désactivés ; pour `Compétence 1.1 (démonstration)` le niveau N4 est sélectionné avec la pastille « Validée ». Passer à l'élève suivant avec « Élève suivant » ou la liste « Élève ».
4. Sélectionner "FOFANA Estelle" : texte « 2 sur 3 compétences renseignées · élève 5 sur 5 » ; pour `Compétence 2.1 (démonstration)` aucun niveau n'est sélectionné et la pastille est « Non évaluée » (jamais zéro, jamais un niveau par défaut).
5. Compteur « Complétude de la saisie » : « 14 sur 15 compétences renseignées · aucune saisie en attente · 14 validées » ; sous-texte "1 compétence reste "non évaluée" (ni zéro, ni niveau par défaut)." (guillemets français à l'écran).
6. Cliquer « Tableau » : tableau « Tableau élèves par compétences » (légende des compétences dépliante « Légende des compétences ») ; la cellule de FOFANA Estelle pour `D2.1` indique « Non évaluée » (cellule validée affichée comme texte `N2 · Validée` pour les autres).
7. Bloc « Synthèse par compteurs » : choisir "FOFANA Estelle" dans « Élève à synthétiser » : texte « Nombre de compétences validées par domaine et par niveau. Aucune moyenne ni pourcentage n'est calculé. » ; tableau de compteurs par domaine et niveau (N2 : 1 pour le domaine D1, 0 pour D2 ; N4 : 1 pour D1) sans moyenne ni pourcentage.
8. Les boutons « Valider la grille » et « Enregistrer » sont inactifs ou absents (grille verrouillée).
Résultat attendu : grille entièrement validée sauf une case ; aucun chiffre ni pourcentage.
Cas invalides : choisir une période sans référentiel applicable : « Aucun référentiel publié ne s'applique à cette classe et à cette période. » (à relever) ; classe d'une autre personne dans l'adresse (`?classe=<identifiant d'une classe non affectée>`) : la classe n'est pas retenue (liste vide) ou « Cet élément est introuvable ou hors de votre périmètre. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le parent qui tape `/v2/primary/competences` obtient "Accès refusé"

#### 18.6 Compétences : saisir sans note au CP1 A (brouillon)
Compte : instituteur CP1 (`enseignant@primaire-test.test`) · Où : « Compétences » · Prérequis : période 2 saisissable (voir écart n°6). Si la période 2 s'affiche "(verrouillée)" ou si l'enregistrement est refusé, demander à la direction de l'ouvrir dans le chapitre Académique (`/v2/academic/years`, périodes) et noter le constat.
1. Classe "CP1 A" présélectionnée (une seule classe) ; choisir la période du semestre 2. Référentiel affiché : « Compétences du primaire (démonstration) ». Compteur « 0 sur N compétences renseignées ».
2. Vue « Fiche élève » : l'élève "DIABATE Nadia" est affiché ; pour `Compétence 1.1 (démonstration)` cliquer le bouton "N3 Acquis" (nom accessible : "N3 — Acquis, pour Compétence 1.1 (démonstration)"). La pastille passe à « À enregistrer » ; compteur « 1 saisie en attente ».
3. Élève suivant ("DIABATE Salimata") : choisir "N2 En cours d'acquisition" ; puis "BAMBA Aya" : "N4 Acquis avec aisance". Laisser les autres élèves sans saisie.
4. Cliquer « Enregistrer » (ou attendre 5 secondes avec la case « Enregistrement automatique » cochée) : le texte du bas devient « Enregistré le `<date>` » ; les pastilles passent à « Enregistrée » ; compteur « 3 sur N compétences renseignées ».
5. Retoucher le niveau déjà choisi d'un élève en attente : la saisie en attente est annulée ; une valeur enregistrée ne se "décoche" pas.
6. Cliquer « Tableau » : changer une cellule avec la liste déroulante de l'élève ; puis « Annuler mes 1 saisies non enregistrées » (libellé "Annuler ma saisie non enregistrée") : la saisie disparaît.
7. Bloc « Tous au niveau… sauf » : « Niveau à appliquer » = "N3 — Acquis", « Portée » = « Toute la classe », « Appliquer aux compétences non saisies » : toutes les cases vides passent à N3 en attente ; cliquer « Annuler mes ... saisies non enregistrées » pour ne pas les enregistrer (laisser des élèves "non évalués" pour 18.8).
8. Quitter la page avec des saisies en attente : le navigateur prévient (fermeture d'onglet).
Résultat attendu : saisie sans note chiffrée ; une compétence non saisie reste « Non évaluée » ; le changement de classe ou de période est bloqué tant que des saisies sont en attente (« Enregistrez ou annulez vos saisies avant de changer de classe ou de période. »).
Cas invalides :
| Situation | Message attendu |
|---|---|
| période du semestre 1 (verrouillée) | « La saisie est arrêtée pour cette classe et cette période : la grille est en lecture seule. » |
| enregistrement sur une période devenue verrouillée entre-temps | « La saisie vient d'être arrêtée pour cette période. Vos saisies restent affichées mais ne peuvent plus être enregistrées. » |
| deux onglets sur la même grille, valeur différente enregistrée dans le premier | « Une ligne a été modifiée par quelqu'un d'autre depuis votre lecture : rechargez la grille sans perdre vos saisies. » puis bouton « Recharger sans écraser mes saisies » |
| période marquée prête (18.7) | "Cette période est marquée prête pour les familles : la saisie est gelée. Retirez le marquage dans ' Ma classe" pour la modifier. » |
| compte de lecture seule (secrétariat) | « Vous pouvez consulter la grille, mais pas la modifier. » |
| coupure réseau | « Vous êtes hors ligne : vos saisies sont conservées sur cette page et seront envoyées au retour de la connexion. Ne fermez pas la page. » puis « Réessayer maintenant » |
Les notes chiffrées du CP1 (devoirs, compositions) se saisissent dans les modules Évaluations et Résultats, jamais dans cette grille.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le secrétariat ne peut pas saisir (lecture seule)

#### 18.7 État "prête" de la classe pour une période (Q-P18)
Compte : instituteur CP1, puis parent · Où : « Ma classe » > période du semestre 2, puis `/v2/primary/mon-enfant` · Prérequis : 18.6 (trois niveaux enregistrés en brouillon).
1. Avant tout marquage, noter l'état : pas de badge « Prête pour les familles » sur le semestre 2.
2. Cliquer « Marquer `<période>` prête » : fenêtre « Marquer `<période>` prête ? » (« Les parents et les élèves verront les compétences saisies et le rang provisoire de cette période. La saisie sera gelée tant que le marquage n'est pas retiré. Vous pourrez le retirer tant que le bulletin n'est pas publié. »). Cliquer « Marquer prête ». Message « `<période>` : marquée prête, les familles voient désormais les compétences et le rang provisoire. » ; badge « Prête pour les familles ».
3. Parent (`parent@primaire-test.test`) : `/v2/primary/mon-enfant`, enfant "DIABATE Nadia" : le bloc « Compétences des périodes prêtes ou validées » montre un compteur par domaine et par niveau (Acquis : 1). Le rang provisoire éventuel se lit dans le module Résultats (chapitre correspondant), pas ici.
4. Instituteur : retourner dans « Compétences » (semestre 2), modifier un niveau en brouillon et « Enregistrer » : refus "La classe et la période sont marquées prêtes : retirer le marquage avant de modifier la saisie." avec l'indication "Cette période est marquée prête pour les familles : la saisie est gelée. Retirez le marquage dans ' Ma classe" pour la modifier. » (la saisie reste affichée).
5. Retirer le marquage : « Retirer le marquage de `<période>` » ; fenêtre « Retirer le marquage de `<période>` ? » avec « Motif du retrait » (« 10 caractères au moins ; conservé dans le journal d'audit. »). Saisir `court` : « Au moins 10 caractères. » ; saisir `Erreur de marquage constatée (test guide)` ; cliquer « Retirer le marquage » : message « `<période>` : marquage retiré, les familles ne voient plus que les périodes validées ou publiées. » ; le badge disparaît. Côté parent, le bloc de compétences est vide (aucune période prête ni validée).
Résultat attendu : le marquage est réversible tant qu'aucun bulletin de la période n'est publié, tracé, et gèle la saisie.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| retrait avec motif de moins de 10 caractères | « Au moins 10 caractères. » |
| retrait alors qu'un bulletin de la période est publié | "Un bulletin de cette période est déjà publié aux familles : le marquage ' prêts" ne se retire plus. » |
| retrait d'une période non marquée | `Cette classe n'est pas marquée prête pour cette période.` |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le parent n'a aucun bouton « Marquer prête »

#### 18.8 Valider la grille, puis réviser une compétence validée
Compte : instituteur CP1 (validation), puis directeur (MFA, révision) · Où : « Compétences » · Prérequis : 18.6 et 18.7 (marquage retiré).
1. Instituteur : enregistrer d'abord (le bouton « Valider la grille » est actif seulement sans saisie en attente et avec des lignes enregistrées non validées ; infobulle « Enregistrez d'abord vos saisies. » sinon).
2. Cliquer « Valider la grille » : fenêtre « Valider la grille de compétences » (« Les compétences saisies seront figées : seule une révision motivée pourra ensuite les corriger. »), texte "N-3 compétences restent non évaluées : elles le resteront." ; confirmer « Valider la grille ».
3. Message « Grille validée : 3 compétences validées, N-3 restées non évaluées. » ; les trois cases passent à « Validée » ; les élèves non saisis restent « Non évaluée » (jamais convertis en zéro).
4. L'instituteur n'a aucun bouton « Réviser ».
5. Directeur : ouvrir la même grille (classe "CP1 A", semestre 2) : sur la case validée de DIABATE Nadia cliquer « Réviser » : fenêtre « Réviser une compétence validée » (« DIABATE Nadia — Compétence 1.1 (démonstration) (niveau actuel : N3 — Acquis). La correction est tracée avec son motif. »).
6. « Nouveau niveau » = "N4 — Acquis avec aisance", « Motif de la révision » `Correction après relecture du cahier de classe (test guide)` ; cliquer « Réviser ». La case affiche N4 ; rouvrir « Réviser » : « Historique des révisions » liste "N3 vers N4 le `<date>` : Correction après relecture du cahier de classe (test guide)".
7. Essayer sur la Grande Section A (périodes closes) : le bouton « Réviser » n'est pas proposé (écart n°1).
Résultat attendu : validation irréversible sans révision ; révision tracée avec motif ; réservée à la direction ; impossible sur période verrouillée.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Motif de la révision » de moins de 10 caractères | "Le motif compte au moins 10 caractères." |
| « Nouveau niveau » non choisi | « Choix invalide. » |
| valider une grille sans rien d'enregistré | bouton « Valider la grille » inactif |
| valider sur période verrouillée | `La période est verrouillée : la grille ne peut plus être validée.` |
| réviser sur période verrouillée (API) | `La période est verrouillée : rouvrir la période avant de réviser.` |
| réviser vers le même niveau (API) | `Le nouveau niveau est identique à l'actuel.` |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'instituteur ne voit pas « Réviser »

#### 18.9 Banque d'appréciations
Compte : instituteur CP1 (lecture), directeur des études ou directeur (gestion) · Où : « Appréciations » (`/v2/primary/appreciations`).
1. Instituteur : titre « Appréciations », phrase « Banque de phrases pour rédiger vos appréciations. Une phrase propose du texte : elle n'est jamais appliquée seule. ». Liste « Phrases de la banque » : 3 phrases de démonstration avec les pastilles « Période » ou « Année », « Niveau N1 » ou « Niveau N3 », « Démonstration ». Texte « Vous pouvez consulter la banque ; sa gestion est réservée à la direction. » ; pas de bouton « Nouvelle phrase », pas de « Désactiver ».
2. Filtres (légende « Filtres ») : « Portée » = « Année » > une seule phrase ; « Niveau de maîtrise » = `N1` > la phrase correspondante ; « Niveau de classe » = `CP1` > aucune phrase si aucune n'est liée ; revenir à « Tous ». Message de liste vide : « Aucune phrase ne correspond à ces critères. ».
3. Cliquer « Ajouter à ma rédaction » (nom accessible « Ajouter la phrase PERIOD_N3 à ma rédaction ») : la phrase apparaît dans « Texte de l'appréciation » (bloc « Ma rédaction »). Modifier le texte (la case « J'ai relu et je valide ce texte » se décoche). Cocher « J'ai relu et je valide ce texte », cliquer « Copier le texte validé » : « Texte copié : collez-le dans l'appréciation du bulletin. ». « Effacer » vide le champ.
4. Constater la note : « Ce texte n'est enregistré nulle part ici. L'appréciation générale s'écrit dans le module Résultats (appréciations de la période). ».
5. Directeur (ou `etudes@primaire-test.test`) : cliquer « Nouvelle phrase » (fenêtre « Nouvelle phrase ») :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | `TG_PHRASE_LECTURE` (« Majuscules, chiffres et _ (2 à 60 caractères). ») | oui |
   | Portée | « Période » (autres : « Année », « Compétence ») | oui |
   | Texte de la phrase | `Lecture fluide en progrès constant (test guide).` (300 caractères au plus) | oui |
   | Niveau de maîtrise | `N3` | non |
   | Niveau de classe | `CP1` | non |
   Cliquer « Créer la phrase » : « Phrase créée. » ; la phrase apparaît sans pastille « Démonstration ».
6. Cliquer « Désactiver » sur cette phrase : la pastille « Désactivée » apparaît et « Ajouter à ma rédaction » est inactif ; cocher « Afficher aussi les phrases désactivées » pour la voir ; « Activer » la réactive.
Résultat attendu : une phrase ne s'applique jamais seule ; seule la direction gère la banque.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Code » vide ou `tg-phrase` (tiret) | "Code attendu : majuscules, chiffres et _ (2 à 60)." |
| « Texte de la phrase » vide | « Ce champ est obligatoire. » |
| code déjà utilisé | "Une phrase de code "TG_PHRASE_LECTURE" existe déjà." (guillemets français à l'écran) |
| « Texte de l'appréciation » au-delà de 1000 caractères | saisie bloquée à 1 000 caractères |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le secrétariat qui tape `/v2/primary/appreciations` obtient "Accès refusé"

#### 18.10 Conseil des maîtres tenu (Grande Section A) : lecture
Compte : directeur, puis instituteur de maternelle en lecture · Où : « Conseil des maîtres » (`/v2/primary/conseil`).
1. Titre « Conseil des maîtres », phrase « Préparation, présence, dossiers élève par élève, décisions et procès-verbal. La règle propose, le conseil confirme. ». Section « Préparer un conseil » (directeur et instituteur). Section « Mes conseils » : une ligne "Grande Section A · `<dernière période>`" avec « 5 dossiers · 0 à examiner · 5 décidés » et le bouton « Ouvrir ».
2. Cliquer « Ouvrir » : bouton « Retour à la liste des conseils », titre de séance, « 5 dossiers : 0 à examiner, 5 décidés, 0 reportés. », bandeau « Règles de démonstration ».
3. « Feuille de présence » : trois participants (ZOKORA Sylvie « Titulaire de la classe », présente, « Signée le `<date>` » ; `DIRECTEUR Conseil` « Président », présent, non signé ; `SECRETAIRE Conseil` « Secrétaire », présente, non signée). Ligne de quorum : « Aucun quorum bloquant : 3 convoqués, 3 présents. » (ou "Quorum atteint selon la règle : ..." si une règle est liée).
4. « Dossiers, un par un » : « Dossier 1 sur 5 » avec la liste « Dossier » (chaque élève et son statut « Décidé »). Pour chaque dossier lire « Motifs d'examen » (« Aucun motif signalé. » ou un motif), « Proposition de la règle » (valeur ou « Aucune proposition »), « Décision du conseil ».
5. Contrôler : ADOU Aïcha « Passage en classe supérieure » ; FOFANA Estelle « Redoublement » avec "Justification : Une compétence jamais évaluée de l'année : maintien décidé par le conseil (démonstration)." ; les 5 dossiers sont « Décidé ».
6. Section « Procès-verbal » (directeur seulement) : « Un procès-verbal a déjà été demandé pour ce conseil. ».
7. Instituteur de maternelle : même conseil en lecture : « La feuille de présence est tenue par la présidence du conseil. », aucun bouton de décision ni de procès-verbal.
Résultat attendu : la règle propose, le conseil confirme ; une décision différente de la proposition porte sa justification ; une présence signée est figée.
Cas invalides : aucun (lecture). Conseil inexistant (liste vide) : « Aucun conseil n'a encore été préparé. » avec « Préparez le conseil d'une classe pour une période. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'instituteur n'a ni « Enregistrer la feuille de présence » ni « Confirmer la décision »

#### 18.11 Conseil : feuille de présence et signatures
Compte : directeur (MFA) · Où : « Conseil des maîtres » > conseil de la Grande Section A (ou celui préparé en 18.12).
1. Dans la feuille de présence de la Grande Section A, les lignes de `DIRECTEUR Conseil` et `SECRETAIRE Conseil` sont modifiables (non signées) ; celle de ZOKORA Sylvie ne l'est pas (signée, figée).
2. Sur `SECRETAIRE Conseil`, régler « Présence de SECRETAIRE Conseil » sur « Absent » : la case « Signature de SECRETAIRE Conseil » devient inactive. Régler « Présent », cocher la signature, cliquer « Enregistrer la feuille de présence » : « Feuille de présence enregistrée. » et « Signée le `<date>` » sur la ligne.
3. Régler « Rôle de DIRECTEUR Conseil » sur « Président » (déjà) et essayer de donner le rôle « Président » à une autre personne ajoutée via « Ajouter un participant » (« Choisir un membre du personnel », « Rôle », « Ajouter ») : refus "Un seul président.".
4. Essayer de modifier une ligne signée : la ligne est verrouillée ; texte « Une présence signée est figée : elle ne peut plus être modifiée. ».
Résultat attendu : une seule présidence, un seul secrétariat ; on ne signe pas absent ; la signature fige la ligne. Ces signatures figent la feuille du conseil de démonstration : à faire en connaissance de cause.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| signature cochée alors que la personne n'est pas « Présent » | « Une signature exige que la personne soit marquée présente. » |
| deux présidents | "Un seul président." |
| deux secrétaires | "Un seul secrétaire." |
| même membre ajouté deux fois | « Participant en double. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'instituteur n'a pas le bouton « Enregistrer la feuille de présence »

#### 18.12 Conseil du CP1 A : préparer, proposer, décider, procès-verbal
Compte : instituteur CP1, puis directeur (MFA) · Où : « Conseil des maîtres » > « Préparer un conseil ».
1. Instituteur : dans « Préparer un conseil » choisir la classe "CP1 A" et la période (la période 1, close et dotée de résultats, est la plus probable) ; « Date de la séance (facultative) » vide ; cliquer « Préparer le conseil ». Résultat attendu : « Conseil préparé : un dossier par élève a été créé. » **ou** un refus lisible de l'API (par exemple un état de résultats absent pour la période) : relever le message exact et le reporter dans "Écarts constatés".
2. Si le conseil est préparé : ouvrir le conseil ; sur un dossier, section « Ma proposition » : choisir « Redoublement » dans « Ma proposition », « Notes et observations » `Lecture non acquise (test guide)`, cliquer « Enregistrer ma proposition » : « Proposition enregistrée. ». Cliquer « Reporter ce dossier » (statut « Reporté ») puis « Remettre à l'examen ».
3. Directeur : ouvrir le même conseil. Compléter « Feuille de présence » : au moins un « Président » et un « Secrétaire » « Présent » ; « Enregistrer la feuille de présence ».
4. Sur un dossier, « Décision du conseil » : si la règle propose un code, choisir « Confirmer la proposition de la règle » ; sinon « Retenir un autre code » : « Décision retenue » = « Passage en classe supérieure » et « Justification » `Décision de test guide prise en séance pour un cas limite` ; cliquer « Confirmer la décision ». Message « Décision enregistrée : Passage en classe supérieure. » (avec « Elle diffère de la proposition de la règle ; la justification est conservée. » s'il y a écart). Si la règle n'a produit aucune proposition : refus `La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés.` (écart n°4 : à relever).
5. Procès-verbal : « Date réelle de la séance » (obligatoire) puis « Demander le procès-verbal » : tant que la feuille, la date ou une décision manque : `Complétez la feuille de présence, la date de séance et au moins une décision avant de demander le procès-verbal.` ; une fois complet : « Procès-verbal demandé : il sera disponible dans les documents officiels. » ou « Procès-verbal demandé : le document est en cours de préparation. ». La demande est faite une seule fois.
Résultat attendu : la proposition de l'instituteur ne vaut pas décision ; seule la direction confirme ; une justification de 20 caractères est exigée en cas d'écart avec la règle.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Retenir un autre code » sans « Décision retenue » | « Choisissez la décision retenue. » |
| justification de 5 caractères pour un écart | « La justification compte au moins 20 caractères. » |
| « Confirmer la proposition de la règle » alors que la règle ne tranche pas | le choix est désactivé : « La règle ne tranche pas : choisissez une décision. » |
| décision d'un dossier déjà décidé | `Ce dossier est décidé : il ne change plus.` / `Ce dossier est déjà décidé.` |
| « Date réelle de la séance » vide | « Indiquez la date réelle de la séance. » |
| préparation sur une classe sans élève | `La classe n'a aucun élève inscrit.` |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'instituteur n'a ni « Confirmer la décision » ni « Demander le procès-verbal »

#### 18.13 Bilans annuels : lecture et préparation des brouillons
Compte : directeur (MFA), puis instituteur CP1 en lecture · Où : « Bilans annuels » (`/v2/primary/bilans`).
1. Titre « Bilans annuels », phrase « Préparez, scellez et réémettez les bilans annuels d'une classe. Un bilan scellé est immuable. ». Section « Année et classe » : « Année » (2026-2027), « Classe » = "Grande Section A". Message initial : « Choisissez une année et une classe pour afficher les bilans. ».
2. Tableau « Bilans annuels de la classe » (colonnes « Élève », « Version », « Statut », « Décision », « Empreinte », « Règles », « Actions ») : 5 lignes, « Version 1 », statut « Scellé » pour 3 d'entre elles (avec « Scellé le `<date>` » et une empreinte tronquée de 12 caractères suivie de `…`) et « Prêt à sceller » pour 2. Colonne « Décision » : « Passage en classe supérieure » sauf Estelle FOFANA « Redoublement ». Colonne « Règles » : « Règles de démonstration ». Les lignes scellées n'ont aucun bouton ; les lignes prêtes ont « Sceller ».
3. Cliquer « Préparer les brouillons » : message du type « Brouillons préparés : 0 créés, 2 actualisés, 3 scellés laissés intacts. » (les valeurs exactes sont à relever). Texte d'aide « Crée un brouillon par élève à partir du résultat d'année, des compétences et de la décision du conseil. Un bilan scellé n'est jamais touché. ».
4. Sélectionner "CP1 A" : « Aucun bilan pour cette classe et cette année. » / « Préparez les brouillons pour commencer. ». Cliquer « Préparer les brouillons » : refus attendu (pas de résultat d'année final ni de conseil) ; relever le message (par exemple `Cette année n'est pas celle de la classe.` ou un manque de résultat).
5. Instituteur CP1 : même écran en lecture : aucun bouton « Préparer les brouillons », « Sceller », « Réémettre ».
Résultat attendu : 5 bilans pour la Grande Section A, dont 3 scellés ; aucune action pour l'instituteur.
Cas invalides : année ou classe non choisie : boutons inactifs ; classe d'un autre périmètre : « Cet élément est introuvable ou hors de votre périmètre. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le parent qui tape `/v2/primary/bilans` obtient "Accès refusé"

#### 18.14 Sceller un bilan (irréversible) et réémettre
Compte : directeur (MFA) · Où : « Bilans annuels » > "Grande Section A" · **À faire en dernier, une seule fois.**
1. Choisir un bilan « Prêt à sceller » et cliquer « Sceller » (nom accessible « Sceller le bilan de `<nom>` »).
2. Fenêtre « Sceller ce bilan » (« Le bilan devient immuable : contenu, décision et empreinte ne pourront plus changer. Une correction créera une nouvelle version. ») avec le nom de l'élève ; confirmer « Sceller le bilan ».
3. Message « Bilan de `<nom>` scellé. » ; le statut passe à « Scellé », une empreinte et « Scellé le `<date>` » s'affichent, le bouton « Sceller » disparaît. Le PDF est produit en arrière-plan (quelques secondes).
4. Sur un bilan « Scellé » cliquer « Réémettre » (« Réémettre le bilan de `<nom>` ») : fenêtre « Réémettre le bilan » (« Une version n+1 est créée en brouillon et l'ancienne version est remplacée. La famille ne voit pas le bilan tant que la nouvelle version n'est pas scellée. »), « Motif de la réémission » `Correction de la décision de passage (test guide)` ; « Réémettre ». Message « Nouvelle version du bilan de `<nom>` créée : elle doit être scellée à son tour. » ; la version 2 est en brouillon, la version 1 « Remplacé par une version plus récente ».
5. Sceller de nouveau la version 2 si l'on veut rétablir la visibilité familiale (nouvelle empreinte).
Résultat attendu : un bilan scellé ne se modifie jamais sur place ; un seul bilan vivant par élève.
Cas invalides :
| Situation | Message attendu |
|---|---|
| motif de réémission de moins de 10 caractères | « Le motif doit comporter au moins 10 caractères. » |
| sceller sans décision du conseil confirmée | « La décision du conseil des maîtres doit être confirmée avant de sceller. » (indication) avec la liste "Points à corriger avant de continuer :" |
| sceller alors que les périodes ne sont pas toutes closes | « Toutes les périodes de l'année doivent être closes avec un résultat d'année définitif. » |
| sceller un bilan déjà scellé | « Un bilan scellé ne change plus : réémettez une nouvelle version. » (bouton absent côté écran) |
| réémettre un brouillon (API) | `Seul un bilan scellé se réémet : un brouillon se prépare à nouveau.` |
| année gelée | « L'année est gelée : plus aucun bilan ne peut être écrit. » (non atteignable ici, 18.15) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'instituteur et le directeur des études n'ont ni « Sceller » ni « Réémettre » (seul le directeur de l'école le peut ; le directeur des études prépare seulement)

#### 18.15 Archives d'année
Compte : directeur (MFA) · Où : « Archives » (`/v2/primary/archives`).
1. Titre « Archives d'année » (« Préparez l'archive d'une année, vérifiez son manifeste puis gelez-la. Rien n'est déplacé ni supprimé : c'est un gel logique. »). Choisir l'année (« Choisir une année »).
2. Cliquer « Préparer l'archive » : message « Archive préparée. ». Une carte « Archive : En préparation » apparaît avec le compte « `<n>` bilans scellés sur 5 » (3 sur 5 si aucun scellement n'a été fait, plus selon 18.14), « Empreinte du manifeste » (— tant que l'archive n'est pas prête), "Préparée le `<date>`", "Gelée le —".
3. Lire « Ce qui empêche le gel : » : trois empêchements attendus, d'après le code : `L'année académique n'est pas clôturée.`, `<n> bilan(s) non scellé(s).`, `<n> inscription(s) sans bilan annuel.` (les inscriptions du CP1 A). Aucun bouton « Geler l'archive ».
4. Après avoir scellé les deux bilans restants de la Grande Section A (18.14), relancer « Préparer l'archive » : le nombre de bilans non scellés tombe à zéro ; les deux autres empêchements demeurent.
5. **Ne pas chercher à geler** : le gel est irréversible pour toute l'école (fenêtre « Geler l'archive de l'année » avec la case « Je comprends que le gel est irréversible » puis « Geler définitivement »), et il est inatteignable dans cet état (écart n°2).
6. Instituteur CP1 : même écran en lecture seule (liste sans « Préparer l'archive »).
Résultat attendu : l'archive reste « En préparation » avec des empêchements lisibles.
Cas invalides : année non choisie : « Choisissez une année pour afficher ses archives. » ; année sans archive : « Aucune archive pour cette année. » / « Préparez l'archive une fois l'année close et les bilans scellés. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le parent qui tape `/v2/primary/archives` obtient "Accès refusé"

#### 18.16 États du primaire et export CSV
Compte : directeur ou secrétariat (MFA) · Où : « États » (`/v2/primary/etats`).
1. Titre « États du primaire », bandeau « Règles de démonstration ». Légende « Rapport à produire », liste « Rapport » : « Liste de classe », « Effectifs par niveau et par classe », « Registre d'appel mensuel », « Redoublants », « Couverture des compétences », « Dossier du conseil des maîtres », « Avancement des classes » (les sept pour la direction et le secrétariat).
2. Jouer chaque rapport :
   | Rapport | Paramètres | Résultat attendu |
   |---|---|---|
   | Liste de classe | « Classe » = "Grande Section A" | colonnes `N°`, `Élève`, `Redoublant` ; 5 lignes ; titre "Liste de classe — Grande Section A" |
   | Effectifs par niveau et par classe | « Année » (facultative) | colonnes `Niveau`, `Classe`, `Élèves`, `Redoublants` ; une ligne par classe |
   | Registre d'appel mensuel | « Classe », « Mois » `AAAA-MM` du mois courant | une colonne par jour d'appel, titre "Registre d'appel — AAAA-MM" |
   | Redoublants | « Année » (facultative) | colonnes `Niveau`, `Classe`, `Élève` ; vide ou liste des redoublants |
   | Couverture des compétences | « Classe » = "Grande Section A", « Période » | colonnes `Élève`, `Attendues`, `Saisies`, `Validées`, `Non évaluées` ; FOFANA Estelle : 3, 2, 2, 1 ; les autres 3, 3, 3, 0 |
   | Dossier du conseil des maîtres | « Conseil » = le conseil de la Grande Section A | colonnes `Élève`, `Motifs d'examen`, `Proposition de la règle`, `Proposition de l'instituteur`, `Statut`, `Décision` ; 5 lignes décidées |
   | Avancement des classes | « Année » (facultative) | 8 colonnes (`Classe`, `Période verrouillée`, ... `Bilans`) ; mêmes chiffres qu'en 18.2 |
   Pour chacun, cliquer « Afficher l'aperçu » : le titre du rapport, « Produit le `<date>` », la liste des paramètres rappelés (« Paramètres du rapport » : Classe, Période, Année, Mois, Conseil) et le tableau.
3. Cliquer « Exporter en CSV » : un fichier `<clé du rapport>.csv` (par exemple `class-list.csv`) est téléchargé (demander l'accord avant tout téléchargement) ; séparateur point-virgule, BOM pour Excel.
4. Les rapports vides (par exemple « Redoublants ») affichent « Ce rapport ne contient aucune ligne. ».
Résultat attendu : aperçu et export reproduisent les mêmes lignes.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| rapport choisi sans paramètre obligatoire (par exemple « Liste de classe » sans classe) | boutons inactifs et texte « Renseignez les paramètres obligatoires pour produire ce rapport. » |
| « Mois » `2026-13` ou `10/2026` | message de format de l'API ("Mois attendu au format AAAA-MM." attendu, texte exact à relever) |
| rapport sans choix | « Choisissez un rapport puis affichez l'aperçu. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'instituteur qui tape `/v2/primary/etats` obtient "Accès refusé"

#### 18.17 Paramètres du pack : réglages, modèle de pack, échelles, référentiels
Compte : directeur (MFA) · Où : « Paramètres » (`/v2/primary/parametres`).
1. Titre « Paramètres du pack Primaire ». Section « Réglages de l'établissement » : cases « Exiger un titulaire pour activer une classe » (cochée), « Exiger la décision du conseil pour sceller un bilan » (cochée), « Activer la banque d'appréciations » (cochée), liste « Échelle d'appréciation par défaut » (« Aucune »), « Durée de conservation des archives (années) » (vide, aide « Laissez vide tant que la durée n'est pas fixée : aucune purge n'a alors lieu. »).
2. Saisir `5` dans « Durée de conservation des archives (années) », « Enregistrer les réglages » : « Réglages enregistrés. » ; recharger : `5` est conservé ; remettre vide et enregistrer.
3. Section « Modèle de pack » : cliquer « Appliquer le modèle de pack » > fenêtre « Appliquer le modèle de pack » (« Cette action sensible instancie les données de démonstration du pack Primaire pour votre établissement. »), « Appliquer le modèle » : message « Le modèle était déjà appliqué : rien n'a été modifié. ».
4. Section « Échelles d'appréciation » : l'échelle de démonstration (code `MASTERY_4`, pastilles « Démonstration » et « Verrouillée » car employée par un référentiel publié), niveaux N1 à N4 avec « (attendu atteint) » sur N3 et N4. Cliquer « Nouvelle échelle » (fenêtre « Nouvelle échelle ») :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code de l'échelle | `TG_ECHELLE` | oui |
   | Libellé | `Échelle test guide` | oui |
   | Code du niveau 1 / Libellé du niveau 1 | `T1` / `Débutant test guide` | oui |
   | Code du niveau 2 / Libellé du niveau 2 | `T2` / `Confirmé test guide`, case « Attendu atteint » cochée | oui |
   Cliquer « Créer l'échelle » : « Échelle créée. ». Utiliser « Ajouter un niveau » (jusqu'à 12) et « Retirer le dernier niveau » (minimum 2).
5. Section « Référentiels de compétences » : voir `PRESCHOOL_DEMO` et `PRIMARY_DEMO` (pastilles « Publié », « Démonstration », compte de compétences) ; cliquer « Ouvrir » (nom accessible "Détail du référentiel ...") : domaines, compétences, ligne « Niveaux de l'échelle : N1, N2, N3, N4 » et le texte « Référentiel publié : immuable. Créez une nouvelle version pour le modifier. ». Ne pas créer de nouvelle version d'un référentiel de démonstration.
6. « Nouveau référentiel » (fenêtre « Nouveau référentiel ») : « Code du référentiel » `TG_REFERENTIEL`, « Libellé » `Référentiel test guide`, « Échelle d'appréciation » = "Échelle test guide", « Niveaux de classe concernés » `CE2` (codes séparés par des virgules) ; « Créer le brouillon » : « Référentiel créé en brouillon. ». Dans le détail, le bloc « Ce qui empêche la publication : » liste "Ajoutez au moins une compétence.".
7. « Modifier la structure » : « Ajouter un domaine » ; « Code du domaine 1 » `TGD1`, « Libellé du domaine 1 » `Domaine test guide`, « Code de la compétence 1.1 » `TGD1.1`, « Libellé de la compétence 1.1 » `Compétence test guide` ; « Enregistrer la structure » : « Structure enregistrée. » ; l'empêchement disparaît.
8. « Publier » : fenêtre « Publier le référentiel » (« Une fois publié, le référentiel devient immuable : il ne pourra plus être modifié. »), case « Je comprends que la publication est définitive », « Publier » : « Référentiel publié. ». Le niveau `CE2` n'a pas de classe : aucune grille existante n'est modifiée. L'échelle `TG_ECHELLE` devient « Verrouillée ».
9. Créer un second brouillon `TG_REFERENTIEL_BROUILLON` (même échelle, niveau `CE2`) puis « Supprimer le brouillon » (fenêtre du même titre, « Le brouillon sera supprimé définitivement. », « Supprimer ») : « Brouillon supprimé. ».
Résultat attendu : réglages persistés ; un référentiel publié est immuable ; une échelle employée par un référentiel publié est verrouillée.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| "Durée de conservation..." `0` | message de borne positive (texte à relever, "La valeur doit être supérieure ou égale à 0." d'après le gabarit de l'écran) |
| "Durée de conservation..." `250` | "La valeur doit être inférieure ou égale à 200." |
| « Code de l'échelle » `tg-echelle` (tiret) ou `T` | "Code attendu : majuscules, chiffres et _ (2 à 40)." |
| « Libellé » vide | « Ce champ est obligatoire. » |
| « Code du niveau 1 » vide | "Code attendu : majuscules, chiffres et _ (1 à 40)." |
| deux niveaux avec le même code `T1` | `Code de niveau en double : T1.` |
| « Code de l'échelle » `TG_ECHELLE` déjà créé | "Une échelle de code "TG_ECHELLE" existe déjà." (guillemets français à l'écran) |
| publier un référentiel sans niveau de classe | "Indiquez au moins un niveau d'application." dans « Ce qui empêche la publication : » |
| modifier la structure d'un référentiel publié (API) | `La structure d'un référentiel publié est figée : créer une nouvelle version.` |
| deux domaines avec le même code | `Code de domaine en double : TGD1.` |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le directeur des études qui tape `/v2/primary/parametres` obtient "Accès refusé"

#### 18.18 Espace famille : Bulletin et compétences du parent et de l'élève
Compte : parent (`parent@primaire-test.test`), puis élève (`eleve@primaire-test.test`) · Où : « Bulletin et compétences de mon enfant » (`/v2/primary/mon-enfant`).
1. Parent : titre « Bulletin et compétences de mon enfant », liste « Enfant » (« Choisir un enfant ») : "DIABATE Nadia — CP1 A", "DIABATE Salimata — CP1 A" (deux enfants, pas d'enfant de la Grande Section). Message avant choix : « Choisissez un enfant pour afficher son bilan et ses compétences. ».
2. Choisir "DIABATE Nadia" : section « Bilans annuels » : « Aucun bilan annuel publié pour le moment. » / « Le bilan apparaît ici dès que l'établissement l'a scellé et publié. » ; section « Compétences des périodes prêtes ou validées » : « Aucune compétence validée à afficher pour le moment. » (avant 18.7/18.8) ou les compteurs (après).
3. Choisir "DIABATE Salimata" : même présentation ; aucune donnée de Nadia.
4. Élève : titre « Mon bilan et mes compétences » (« Mes bilans annuels publiés et mes compétences des périodes que l'enseignant a marquées prêtes, validées ou dont le bulletin est publié. ») ; mêmes sections pour Nadia seulement, sans liste d'enfants.
5. Après 18.14, le bilan d'un enfant de la Grande Section n'est visible d'aucun compte de la démonstration (parents sans compte).
Résultat attendu : le parent ne voit que ses enfants ; jamais une saisie brouillon hors période prête ; les bilans n'apparaissent qu'une fois scellés ET leur PDF émis ; compteurs seulement, jamais de moyenne.
Cas invalides : parent sans enfant lié : « Aucun enfant n'est lié à votre compte. » / « Contactez l'établissement pour lier votre compte à celui de votre enfant. » ; profil sans droit : « Votre profil n'a pas accès à cet espace. » ; enfant hors lien de tutelle (appel direct de l'API) : « Cet élément est introuvable ou hors de votre périmètre. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le parent et l'élève ne voient ni « Ma classe » ni « Paramètres »

#### 18.19 Documents officiels de démonstration : bandeau et vérification publique
Compte : directeur, puis sans compte · Où : écrans du pack et `/v2/verify`.
1. Contrôler le bandeau « Règles de démonstration » sur chaque écran du personnel (Ma classe, Compétences, Appréciations, Conseil, Avancement, Bilans, Archives, États, Paramètres) et la pastille « Règles de démonstration » dans la colonne « Règles » des bilans, ainsi que dans l'espace famille.
2. Retrouver un bilan scellé (ou le procès-verbal du conseil de la Grande Section A) parmi les documents officiels : `/v2/reportcards` (chapitre Bulletins, emplacement exact à confirmer) et noter son code de vérification.
3. Ouvrir `/v2/verify` (sans connexion), saisir le code, « Vérifier » : « Document authentique », nature « Bilan annuel » ou « Procès-verbal de conseil », établissement, date d'émission ; mention de document de démonstration, aucune note ni nom d'élève.
Résultat attendu : tout document dérivé des règles fictives est signalé comme sans valeur officielle (mention "Règles de démonstration — document sans valeur officielle" sur le bilan ou le procès-verbal, filigrane « démonstration » dans le PDF).
Cas invalides : code inventé : message d'absence de document (chapitre Bulletins) ; à relever.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit : page publique

#### 18.20 Droits : adresses interdites et séparation instituteur / direction
Compte : plusieurs.
1. Instituteur CP1 : taper `/v2/primary/direction`, `/v2/primary/etats`, `/v2/primary/parametres` : "Accès refusé" pour chacune.
2. Instituteur de maternelle : même contrôle, plus `/v2/primary/mon-enfant`.
3. Secrétariat : taper `/v2/primary/parametres`, `/v2/primary/appreciations`, `/v2/primary/conseil` : "Accès refusé" ; `/v2/primary/direction`, `/v2/primary/bilans`, `/v2/primary/etats` s'ouvrent en lecture.
4. Directeur des études : `/v2/primary/parametres` refusé ; il ouvre tout le reste ; il n'a pas « Sceller », « Réémettre », « Geler l'archive », « Réviser » ni « Appliquer le modèle de pack ».
5. Parent puis élève : `/v2/primary/classe`, `/v2/primary/competences`, `/v2/primary/bilans`, `/v2/primary/archives`, `/v2/primary/direction` : "Accès refusé".
6. Économe, chargé d'admissions : `/v2/primary`, `/v2/primary/classe` : "Accès refusé".
7. Séparation des tâches : l'instituteur saisit et valide ; seule la direction révise, décide au conseil, scelle, réémet, gèle et applique le modèle.
8. Instituteur du CP1 : la carte ne montre pas la Grande Section A, et inversement.
Résultat attendu : refus sans donnée, jamais une page blanche.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour les rôles listés

#### 18.21 Autres établissements : le pack n'est pas inclus
Compte : propriétaire ou directeur du collège (`directeur@secondaire-test.test`), de l'université · Où : `/v2/primary/classe`, `/v2/primary/competences`, `/v2/primary/parametres`.
1. Ouvrir chacune de ces adresses dans le collège : la page se charge (le propriétaire et le directeur ont toutes les permissions) mais les écrans protégés par la fonctionnalité du plan affichent « Cette fonctionnalité n'est pas incluse dans l'offre de votre établissement. » (Compétences, Conseil, Avancement, Bilans, Archives, États).
2. « Ma classe » et « Paramètres » : relever ce qui s'affiche (liste vide « Aucune classe ne vous est affectée. », ou une erreur du type "Précisez l'établissement (institutionId)." déjà observée sur « Paramètres » hors du primaire).
3. Aucune donnée de l'école primaire n'est visible depuis le collège.
Résultat attendu : aucune fuite entre établissements ; l'erreur éventuelle est lisible.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit : refus ou notice pour le collège

#### 18.22 Qualité transversale : états vides, chargement, erreurs, clavier
Compte : instituteur et directeur.
1. États vides : « Aucune classe ne vous est affectée. », « Aucun conseil n'a encore été préparé. », « Aucun bilan pour cette classe et cette année. », « Aucune archive pour cette année. », « Aucune phrase ne correspond à ces critères. », « Aucune échelle. », « Aucun référentiel. ».
2. Chargement : indicateur à l'ouverture de chaque écran ; recharger une fois avant de signaler une lenteur (mode développement).
3. Erreurs : couper l'API ; chaque écran affiche un message lisible (« Ce document ou ce service n'est pas disponible pour le moment : rien n'a été enregistré. Réessayez plus tard ou contactez l'administrateur. » pour un service indisponible), jamais de page blanche.
4. Clavier : au clavier seul, parcourir « Ma classe » (périodes, boutons), la grille (boutons de niveau, `Tab`, `Entrée`), une fenêtre (Échap ferme, le focus revient au déclencheur), le conseil (Dossier précédent / suivant). Zones d'au moins 44 px, focus visible.
5. Français : relever tout mot anglais, code brut (voir "Écarts constatés") ou faute.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit sans objet

---

## Données créées

| Enregistrement | Détail |
|---|---|
| Appel du jour | séance d'appel du jour sur la Grande Section A et le CP1 A (une marque d'absence testée sur EKRA Désiré) |
| Saisies de compétences CP1 A (semestre 2) | DIABATE Nadia N3, DIABATE Salimata N2, BAMBA Aya N4 (puis validées) ; Nadia révisée en N4 |
| État "prête" | semestre 2 du CP1 A marqué puis retiré (`Erreur de marquage constatée (test guide)`) |
| Phrase `TG_PHRASE_LECTURE` | `Lecture fluide en progrès constant (test guide).` (désactivée à la fin) |
| Conseil du CP1 A | conseil préparé (si possible), proposition `Lecture non acquise (test guide)`, décision et justification de test, procès-verbal éventuel |
| Feuille de présence de la Grande Section A | `SECRETAIRE Conseil` présente et signée (18.11) |
| Bilans de la Grande Section A | un bilan scellé en plus (18.14) ; un bilan réémis (version 2) |
| Archive d'année | archive préparée, non gelée |
| Échelle `TG_ECHELLE`, référentiel `TG_REFERENTIEL` | `Échelle test guide`, `Référentiel test guide` (publié, niveau `CE2`) ; brouillon `TG_REFERENTIEL_BROUILLON` supprimé |
| Réglage de conservation des archives | `5` puis remis à vide |

Nettoyage : rien ne se supprime (échelle, référentiel publié, phrase, bilan scellé, validation) ; remettre à zéro avec `pnpm demo:reset`. Désactiver la phrase `TG_PHRASE_LECTURE`, remettre la conservation à vide.

## Écarts constatés

À confirmer à l'écran. Gravités : Bloquant, Majeur, Mineur, Suggestion.

| Écran | Constat | Gravité |
|---|---|---|
| Compétences, révision | Le bouton « Réviser » n'est pas proposé sur une période verrouillée ; l'attendu de l'ancien guide (réviser sur la Grande Section A) est faux. | Mineur (attendu de guide) |
| Archives | L'archive ne peut pas atteindre « Prête à geler » dans la démonstration (année non close, inscriptions du CP1 A sans bilan) : le gel n'est pas testable. | Majeur (limite de la graine) |
| Avancement | La Grande Section A reste "En cours" (orange) à cause de la compétence non évaluée, alors que tout ce qui peut l'être est validé. | Suggestion |
| Conseil du CP1 A | Préparation ou décision possibles refusées faute de résultats calculés ; message à relever. | À confirmer |
| Ma classe | Une période planifiée s'affiche "ouverte" ; la saisie est possible sans ouverture par la direction. | À confirmer (Mineur) |
| Paramètres hors primaire | Erreur "Précisez l'établissement (institutionId)" observée dans un balayage QA antérieur. | Mineur (connu) |
| Espace famille | Le PDF du bilan et du procès-verbal n'est pas téléchargeable depuis le pack ; renvoi vers les documents officiels. | Suggestion |
| Messages | Quelques messages de l'API sont techniques (par exemple "La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés."). | Mineur |

## À vérifier en test

- Rien de ce chapitre n'a pu être exécuté en navigateur ; les attendus viennent du code (`apps/web/src/app/v2/primary`, `apps/api/src/modules/primary_school`), des messages `fr-CI.json` et du seed. Relever en particulier : l'effectif réel du CP1 A, les libellés exacts des périodes, l'ordre des élèves, lesquels des 5 bilans sont scellés.
- État de la période 2 du CP1 A (ouverte ou non), possibilité d'y saisir, de la marquer prête et de la valider.
- Conseil du CP1 A : préparation possible ? proposition de la règle disponible ?
- Appel du jour : politique d'appel journalier, présence d'une séance déjà ouverte le jour du test.
- Libellés des rapports « Registre d'appel mensuel » (colonnes par jour) et message de format du mois.
- Code de vérification d'un bilan : emplacement dans les documents officiels.
- Messages d'erreur exacts de la préparation des bilans du CP1 A.

## Non couvert / limites connues

- **Gel d'une archive** (« Geler l'archive », « Geler définitivement ») : inatteignable sans clore l'année et sceller les bilans de toutes les classes ; volontairement non exécuté (irréversible pour l'école).
- **Parcours famille de la maternelle** : les parents de la Grande Section n'ont pas de compte ; les bilans scellés de ces enfants ne se voient pas côté famille sans créer de compte.
- **Examens type CEPE** (types, sessions, candidats, résultats) : hors de ce chapitre, voir le chapitre Examens.
- **Appel du jour hors ligne** : voir le chapitre Présences ; la grille de compétences conserve les saisies hors ligne mais l'envoi différé n'est pas simulable sans couper le réseau.
- **Rang provisoire et rang de période** : calculés et affichés par le module Résultats, pas par ce pack.
- **Procès-verbal et PDF du bilan** : produits en arrière-plan par le module Bulletins (le téléchargement n'est pas proposé dans ce pack).
- **Règles officielles** : aucune règle ivoirienne (passage, redoublement, quorum, CEPE) n'est livrée ; les jeux sont des placeholders.
