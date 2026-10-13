# Pack Primaire : le parcours complet, dans l'ordre

Ce document décrit **le workflow** : qui fait quoi, dans quel ordre, dans quel menu, et pourquoi. Aucune donnée à saisir ici : pour les valeurs, voir [GUIDE_DONNEES_PRIMARY.md](GUIDE_DONNEES_PRIMARY.md).
Pour savoir quel rôle voit quel menu : [MENUS_PAR_ROLE_PRIMARY.md](MENUS_PAR_ROLE_PRIMARY.md).

Adresse de base : `http://localhost:3000`. Connexion : `/v2/login`.

---

## Le principe en une phrase

> La **direction** prépare l'école (année, classes, personnel, élèves, règles), puis l'**instituteur** évalue les élèves au fil de l'année, puis la **direction** clôt la période, tient le conseil des maîtres, scelle les bilans et archive l'année. La **famille** consulte le résultat.

## Vue d'ensemble

```
 PRÉPARER L'ÉCOLE (direction)            VIVRE L'ANNÉE (instituteur)         CLÔTURER (direction)           CONSULTER
┌───────────────────────────┐          ┌──────────────────────────┐        ┌─────────────────────────┐   ┌──────────────┐
│ 1 Établissement, année    │          │ 6 Faire l'appel          │        │ 8 Marquer la période    │   │ 10 Parent et │
│ 2 Matières et classes     │   ───►   │ 7 Évaluer les compétences│  ───►  │   prête, clore, conseil │──►│    élève     │
│ 3 Pack : échelle, référen-│          │   (et saisir les notes)  │        │ 9 Bilans, archives,     │   │ voient le    │
│   tiel, appréciations     │          │   puis valider la grille │        │   états                 │   │ résultat     │
│ 4 Personnel, élèves,      │          └──────────────────────────┘        └─────────────────────────┘   └──────────────┘
│   inscriptions, titulaires│
│ 5 Comptes de connexion    │
└───────────────────────────┘
```

**Règle d'or** : on ne peut pas sauter une étape, car chacune alimente la suivante (pas de classe sans niveau, pas d'activation sans titulaire, pas d'évaluation sans référentiel publié…).

---

## Phase 1. Préparer l'école

**Qui** : propriétaire ou directeur (MFA). **Quand** : une seule fois, avant la rentrée.

| # | Menu | Lien | À quoi il sert | Pourquoi à ce moment |
| :-: | :--- | :--- | :--- | :--- |
| 1.1 | **Établissement** | `/v2/settings` | Identité de l'école (nom, couleur, campus), abonnement, étapes de mise en service. | Les documents officiels reprennent ces informations. |
| 1.2 | **Paramètres académiques** | `/v2/academic/settings` | Réglages de base : types de périodes, niveaux, politique d'inscription, format des numéros d'inscription, jours fériés. | Ils s'appliquent aux années, aux classes et aux inscriptions créées ensuite. |
| 1.3 | **Années et périodes** | `/v2/academic/years` | Créer l'année scolaire, générer ses trimestres, puis **ouvrir** l'année, la **définir comme courante**, puis ouvrir le Trimestre 1. | Sans année ouverte, on ne peut ni créer de classes ni évaluer. |
| 1.4 | **Programmes et niveaux** | `/v2/academic/programs` | L'arbre des programmes : préscolaire, primaire, et les niveaux (GS, CP1…CM2). | Une classe est toujours rattachée à un programme et à un niveau. |
| 1.5 | **Curriculum** | `/v2/academic/curriculum` | Les matières et leurs coefficients par niveau. On **valide puis publie**. | Une classe exige un curriculum publié. |
| 1.5b | **Imports Excel / CSV** | `/v2/imports` | Charger les matières depuis un fichier. | Il n'y a pas d'écran « Matières » : l'import est le seul moyen de les créer. |
| 1.6 | **Classes** | `/v2/academic/classrooms` | Créer les classes de l'année (code, nom, capacité). Elles naissent en **brouillon**. | Elles ne seront **activées** qu'à la phase 4, quand un titulaire sera affecté. |

---

## Phase 2. Régler le pack Primaire

**Qui** : propriétaire ou directeur (MFA pour les publications).

| # | Menu | Lien | À quoi il sert | Pourquoi à ce moment |
| :-: | :--- | :--- | :--- | :--- |
| 2.1 | **Paramètres** (Pack Primaire) | `/v2/primary/parametres` | Quatre blocs : **réglages** de l'école (titulaire exigé, décision du conseil exigée, banque de phrases, conservation des archives) ; **modèle de pack** (déjà appliqué) ; **échelles** d'appréciation (NA, EA, AC) ; **référentiels** de compétences. | Sans référentiel publié, l'instituteur n'a rien à évaluer. |
| 2.2 | → Créer l'**échelle** | idem | Les niveaux de maîtrise, du plus faible au plus élevé, avec « Attendu atteint » sur le niveau qui valide. | Le référentiel en a besoin. |
| 2.3 | → Créer le **référentiel** | idem | Brouillon : code, libellé, échelle, **niveau de classe**. Puis « Modifier la structure » : domaines et compétences. Puis **Publier**. | Le niveau de classe relie le référentiel aux classes : un référentiel CE1 ne servira qu'aux classes de CE1. |
| 2.4 | **Appréciations** | `/v2/primary/appreciations` | La banque de phrases pour rédiger les appréciations du bulletin. La direction crée les phrases. | À préparer avant la fin de la première période. Menu absent de la barre latérale : ouvrir l'adresse. |

> Un référentiel **publié** est figé. Pour le modifier : « Créer une nouvelle version » (brouillon), modifier, publier. L'ancienne version passe à « Retiré ».

---

## Phase 3. Créer les personnes

**Qui** : propriétaire ou directeur. L'ordre compte : on crée d'abord ceux dont les autres dépendent.

| # | Menu | Lien | À quoi il sert | Pourquoi dans cet ordre |
| :-: | :--- | :--- | :--- | :--- |
| 3.1 | **Personnel** | `/v2/staff` | Fiches des enseignants (identité, poste, contrat). | Il faut les instituteurs avant de les affecter aux classes. |
| 3.2 | **Parents et tuteurs** | `/v2/guardians` | Fiches des parents ou responsables. | Créés **avant** les élèves pour être liés dès la création. |
| 3.3 | **Élèves** | `/v2/students` | Dossier de chaque élève (identité, tuteurs, pièces). L'élève est « Actif » et « Non inscrit ». | Une inscription part d'un élève existant. |
| 3.4 | **Inscriptions** | `/v2/enrollments` | Placer l'élève dans une classe de l'année. Donne un numéro d'inscription. | L'élève n'apparaît dans les listes d'une classe qu'une fois inscrit. |
| 3.4b | **Imports Excel / CSV** | `/v2/imports` | Alternative à 3.2–3.4 : charger élèves, tuteurs et inscriptions en masse. | Plus rapide pour de gros effectifs. |
| 3.5 | **Affectations** | `/v2/staff/assignments` | Désigner le **titulaire** de chaque classe. À ce moment, la classe peut passer à **Active**. | Une classe du primaire ne s'active qu'avec un titulaire. |

Résultat de la phase 3 : des classes actives, avec leurs élèves et leur instituteur.

---

## Phase 4. Donner un accès de connexion à chacun

**Qui** : propriétaire ou directeur.

| # | Menu | Lien | À quoi il sert |
| :-: | :--- | :--- | :--- |
| 4.1 | **Utilisateurs** | `/v2/admin/members` | Voir les membres de l'école, inviter une personne, suspendre un compte. |
| 4.2 | **Attributions de rôles** | `/v2/access/assignments` | Donner à une personne un rôle (Instituteur, Parent, Élève, Directeur des études…). |
| 4.3 | **Rôles et permissions** | `/v2/access/roles` | Consulter ce que chaque rôle peut faire (lecture). |

Il faut le rôle **Instituteur** (et non Enseignant) pour voir les menus du pack. Un compte relié à une fiche du personnel est indispensable pour saisir des compétences.

---

## Phase 5. Organiser la vie de la classe (selon besoin)

| Menu | Lien | À quoi il sert |
| :--- | :--- | :--- |
| **Salles et équipements** | `/v2/schedule/rooms` | Déclarer les salles. |
| **Emplois du temps** | `/v2/schedule/timetables` | Construire la semaine type, la publier, générer les séances datées. |
| **Types d'évaluation** | `/v2/assessments/types` | Choisir les natures de contrôle (interrogation, devoir, composition) et leurs coefficients. |
| **Règles de calcul** | `/v2/rules` | Relier les règles de calcul des moyennes aux programmes. **À faire avant la première publication de notes.** |

---

## Phase 6. Le quotidien de l'instituteur

**Qui** : instituteur, connecté avec son propre compte. Il ne voit que **sa** classe.

| # | Menu | Lien | À quoi il sert | Fréquence |
| :-: | :--- | :--- | :--- | :--- |
| 6.1 | **Faire l'appel** | `/v2/attendance/call` (portail : `/v2/teacher/attendance`) | Noter les absents : matin et après-midi au primaire. | Chaque jour |
| 6.2 | **Ma classe** | `/v2/primary/classe` | Tableau de bord : effectif, périodes, accès rapides. C'est là qu'on marque une période « prête ». | À volonté |
| 6.3 | **Compétences** | `/v2/primary/competences` | Choisir classe et période, puis mettre un niveau (NA, EA, AC) par élève et par compétence. **Enregistrer**, puis **Valider la grille**. Une case vide reste « non évaluée ». | Pendant la période |
| 6.4 | **Mes évaluations** | `/v2/teacher/assessments` | Créer les évaluations (devoirs, interrogations), saisir les notes, **soumettre** la feuille. | Selon les contrôles |
| 6.5 | **Appréciations** | `/v2/primary/appreciations` | Composer le texte du commentaire avec les phrases de la banque. | Fin de période |

Une grille **validée** est figée : seule la direction peut la corriger, avec un motif.

---

## Phase 7. Le suivi par la direction pendant la période

**Qui** : directeur, propriétaire, directeur des études.

| Menu | Lien | À quoi il sert |
| :--- | :--- | :--- |
| **Avancement** | `/v2/primary/direction` | Feu tricolore par classe et par période : compétences saisies, validées, bilans scellés. Rouge = rien saisi, vert = tout validé. |
| **Feuilles à relire** | `/v2/assessments?status=SUBMITTED` | Relire, approuver puis publier les feuilles de notes soumises. La direction ne relit pas ce qu'elle a soumis elle-même. |
| **Corrections de notes** | `/v2/assessments/revisions` | Traiter une demande de correction d'une note déjà publiée. |
| **Suivi des appels** | `/v2/attendance/sessions` | Valider les appels des classes. |
| **Justificatifs d'absence** | `/v2/attendance/justifications` | Accepter ou rejeter les justificatifs des familles. |

---

## Phase 8. Clôturer une période (chaque trimestre)

**Qui** : instituteur, puis direction. L'ordre est important.

| # | Qui | Menu | Lien | Action |
| :-: | :--- | :--- | :--- | :--- |
| 8.1 | Instituteur | **Compétences** | `/v2/primary/competences` | Valider la grille de la période. |
| 8.2 | Instituteur | **Ma classe** | `/v2/primary/classe` | **Marquer la période « prête »** : les familles voient alors les compétences, la saisie est gelée. Réversible avec un motif. |
| 8.3 | Direction | **Résultats de classe** | `/v2/results` | Lire les moyennes, rangs et mentions calculés par les règles. Rien ne se saisit à la main. |
| 8.4 | Direction | **Délibérations** | `/v2/results/decisions` | Planifier la séance, enregistrer les appréciations de la période. |
| 8.5 | Instituteur | **Conseil des maîtres** | `/v2/primary/conseil` | **Proposer** une décision par élève (passage, redoublement…). |
| 8.6 | Direction | **Conseil des maîtres** | `/v2/primary/conseil` | **Préparer le conseil** (un dossier par élève), remplir la feuille de présence, **décider**, demander le procès-verbal. Une décision confirmée est définitive. |
| 8.7 | Direction | **Années et périodes** | `/v2/academic/years` | **Clore les notes** puis **Clore** la période : les résultats deviennent officiels. Irréversible. |
| 8.8 | Direction | **Identité et signataires**, **Modèles de documents** | `/v2/reportcards/identity`, `/v2/reportcards/templates` | Régler ce qui s'imprime sur les bulletins et qui signe. |
| 8.9 | Direction | **Bulletins — émission** puis **liste** | `/v2/reportcards/issue`, `/v2/reportcards` | Générer les bulletins de la classe, puis les **publier** aux familles. |

---

## Phase 9. Clôturer l'année

**Qui** : direction (la préparation par le directeur des études, le scellement et le gel par le directeur ou le propriétaire). **Quand** : une fois les trois périodes closes.

| # | Menu | Lien | Action | Irréversible |
| :-: | :--- | :--- | :--- | :-: |
| 9.1 | **Bilans annuels** | `/v2/primary/bilans` | **Préparer les brouillons** du bilan de chaque élève. | non |
| 9.2 | **Bilans annuels** | idem | **Sceller** : le bilan devient immuable. Exige les périodes closes, le résultat d'année et la décision du conseil confirmée. | **oui** |
| 9.3 | **Bilans annuels** | idem | **Réémettre** en cas d'erreur (motif obligatoire) : nouvelle version à sceller. | **oui** |
| 9.4 | **Archives** | `/v2/primary/archives` | **Préparer** l'archive de l'année, contrôler la liste de ce qui bloque, puis **Geler**. | **oui** (gel) |
| 9.5 | **États** | `/v2/primary/etats` | Sept rapports (liste de classe, effectifs, registre d'appel, redoublants, couverture des compétences, dossier du conseil, avancement), en tableau ou en CSV. | non |
| 9.6 | **Années et périodes** | `/v2/academic/years` | Clore l'année, puis **Reconduction annuelle** (`/v2/academic/rollover`) pour préparer la suivante. | **oui** |

---

## Phase 10. La famille consulte

| Qui | Menu | Lien | Ce qu'il voit |
| :--- | :--- | :--- | :--- |
| Parent | **Bulletin et compétences de mon enfant** | `/v2/primary/mon-enfant` | Pour chaque enfant : compteurs de compétences des périodes « prêtes » ou validées, et bilans annuels publiés. Jamais de moyenne ni le détail des autres élèves. |
| Parent | **Mes enfants** | `/v2/parent` | La liste de ses enfants, avec accès à l'emploi du temps, aux absences et aux bulletins. |
| Élève | **Mon bilan et mes compétences** | `/v2/primary/mon-enfant` | Ses propres compétences et son bilan. |

---

## Résumé : l'ordre en une page

| Ordre | Qui | Action | Menu principal |
| :-: | :--- | :--- | :--- |
| 1 | Direction | Identité, réglages, année, trimestres | Établissement, Paramètres académiques, Années et périodes |
| 2 | Direction | Programmes, matières, classes (brouillon) | Programmes, Curriculum, Imports, Classes |
| 3 | Direction | Échelle, référentiel publié, phrases | Pack Primaire > Paramètres, Appréciations |
| 4 | Direction | Fiches enseignants, parents, élèves, inscriptions | Personnel, Parents et tuteurs, Élèves, Inscriptions |
| 5 | Direction | Titulaires → classes **actives** | Affectations |
| 6 | Direction | Comptes et rôles de connexion | Utilisateurs, Attributions de rôles |
| 7 | Direction | Types d'évaluation, règles de calcul, emplois du temps | Types d'évaluation, Règles de calcul, Emplois du temps |
| 8 | **Instituteur** | Appel, compétences, notes | Faire l'appel, Compétences, Mes évaluations |
| 9 | **Instituteur** | Valider la grille, marquer la période « prête » | Compétences, Ma classe |
| 10 | Direction | Relire les feuilles, résultats, délibérations | Feuilles à relire, Résultats de classe, Délibérations |
| 11 | Instituteur puis direction | Propositions puis décisions du conseil | Conseil des maîtres |
| 12 | Direction | Clore la période, émettre et publier les bulletins | Années et périodes, Bulletins |
| 13 | **Parent / élève** | Lire compétences et bulletin | Bulletin et compétences |
| 14 | Direction | Bilans scellés, archive gelée, états | Bilans annuels, Archives, États |

---

## Ce qui ne fait pas partie du parcours de base

Ces modules existent mais ne sont pas nécessaires au cycle pédagogique du primaire : **Finance** (frais, factures, encaissements), **Paie**, **Admissions**, **Communication** (messages, annonces, notifications), **Documents** et **Examens** (CEPE). Ils se branchent sur le parcours ci-dessus quand l'école en a besoin.

## À savoir pour tester

- **Seuls le propriétaire et le directeur ont un compte** dans l'école de test. Les comptes instituteur, parent, élève et directeur des études ne se créent pas encore facilement : la commande `pnpm dev:v2:add-account` ne gère que le directeur et le responsable pédagogique, et les invitations par l'interface n'envoient pas d'e-mail en développement. Détail : [LIMITES_A_TRAITER.md](LIMITES_A_TRAITER.md) (L-01 à L-04).
- **Le propriétaire ne peut pas saisir de compétences** : il n'a pas de fiche de personnel liée. La saisie est réservée à l'instituteur titulaire.
- **Menus absents de la barre latérale** du propriétaire : Ma classe, Compétences et Appréciations. Ils s'ouvrent par leur adresse.
- **En début d'année, certaines étapes sont refusées par le système** (sceller un bilan, geler l'archive) : les périodes ne sont pas encore closes. C'est normal.
- **Actes irréversibles** : clore une période, signer une présence au conseil, sceller, réémettre, geler l'archive, passer en production. À faire une seule fois et en dernier.
