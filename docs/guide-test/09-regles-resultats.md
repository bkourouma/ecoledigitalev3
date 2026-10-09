# Chapitre 9. Règles de calcul et résultats

> Établissements : **Collège Le Baobab (démonstration)** (secondaire, 6e A) pour l'essentiel ; **Université Horizon (démonstration)** (supérieur, Licence 1 A) aux scénarios 9.17 et 9.18 ; contrôle de lecture à l'**École primaire Les Palmiers** au scénario 9.3.
> Durée estimée : 3 h. **Ce chapitre suppose le chapitre 8 terminé** : il réutilise les évaluations "test guide" publiées (Trimestre 3, 6e A). Il **clôture le Trimestre 3** de la 6e A (scénario 9.15) ; le chapitre 10 (bulletins) s'appuie sur ce résultat définitif.

Principe : une moyenne, un rang, une mention ou une décision n'est **jamais saisi** ; il est calculé par un jeu de règles (le "catalogue des règles") choisi pour l'établissement. Ces règles sont ici des **règles de démonstration** (fictives) : **aucune règle officielle ivoirienne** (passage, redoublement, mentions, BEPC, BAC, CEPE) n'est livrée. N'en tirez aucune conclusion réglementaire.

## Prérequis

- Chapitre 8 exécuté sur le Collège Le Baobab : "Devoir n°1 Mathématiques test guide" et "Interrogation Mathématiques test guide" publiées, correction ASSI Brice 9,5 → 10,5 appliquée, correction DIABATE Salimata rejetée, "Devoir commun test guide" (Français) **Soumise**.
- Le calcul des résultats se fait en arrière-plan : compter **10 à 30 secondes** après chaque publication, correction ou approbation de surcharge avant de relire une moyenne. Avant la première publication, la page de la période pour le Trimestre 3 peut afficher « État de la période introuvable (…) » : l'état naît au premier calcul.
- Si le chapitre 8 n'a pas été fait, les scénarios 9.1 à 9.10 (lecture des règles, Trimestre 1 et Trimestre 2 de la graine) restent exécutables ; 9.11 à 9.16 ne le sont pas.

## Comptes à utiliser

| Rôle | Établissement | E-mail | MFA |
|---|---|---|---|
| Directeur des études | Collège Le Baobab | `etudes@secondaire-test.test` | oui |
| Directeur | Collège Le Baobab | `directeur@secondaire-test.test` | oui |
| Responsable pédagogique | Collège Le Baobab | `pedagogie@secondaire-test.test` | oui |
| Enseignant | Collège Le Baobab | `enseignant@secondaire-test.test` | non |
| Parent | Collège Le Baobab | `parent@secondaire-test.test` | non |
| Élève | Collège Le Baobab | `eleve@secondaire-test.test` | non |
| Secrétariat | Collège Le Baobab | `secretariat@secondaire-test.test` | oui |
| Directeur | École Les Palmiers | `directeur@primaire-test.test` | oui |
| Directeur des études | Université Horizon | `etudes@superieur-test.test` | oui |
| Directeur | Université Horizon | `directeur@superieur-test.test` | oui |
| Enseignant | Université Horizon | `enseignant@superieur-test.test` | non |

Connexion par la page `/login` (clic sur le compte, code MFA proposé ; jamais écrit ici).

## Droits

| Écran | Adresse | Accès (permission de page) |
|---|---|---|
| Catalogue des règles | `/v2/rules` | `rules.ruleset.read` : responsable pédagogique, directeur des études, directeur, propriétaire |
| Liaisons aux programmes | `/v2/rules/bindings` | idem (lecture) ; **écriture : directeur, propriétaire** (`rules.binding.manage`, sensible) |
| Version d'un jeu de règles | `/v2/rules/versions/<identifiant>` | lecture idem ; créer une variante, modifier paramètres : directeur, propriétaire ; simuler : + directeur des études ; **approbation et publication : opérateur de la plateforme seulement** |
| Périodes (état, verrou, clôture) | `/v2/results` | `result.read` ou `period.lock` ou `period.close` : responsable pédagogique (lecture), directeur des études (verrouille, délibère, clôture, relance le calcul), directeur et propriétaire (+ **rouvrir**) |
| Résultats de classe | `/v2/results/matrix` | `result.read` : responsable pédagogique, directeur des études, directeur, propriétaire |
| Décisions et délibérations | `/v2/results/decisions` | `decision.record` ou `decision.approve` ou `appreciation.write` : directeur des études, directeur, propriétaire, enseignant (appréciations) |
| Surcharges | `/v2/results/overrides` | demander : directeur des études, directeur, propriétaire (`result.override.request`) ; **approuver, rejeter, révoquer : directeur, propriétaire** (`result.override.approve`) |
| Rattrapage | `/v2/results/resit` | `higher.resit.manage` : directeur des études, directeur, propriétaire ; écran réservé au pack Supérieur |
| Explication d'un résultat | `/v2/results/<identifiant>/explain` | `result.explain` : responsable pédagogique, directeur des études, directeur, propriétaire |
| Résultat annuel | `/v2/results/year/<inscription>/<année>` | `result.read` |

**Adresses à taper à la main qui doivent être refusées** (page « Accès refusé », `/unauthorized`, aucune donnée) :

| Compte | Adresse |
|---|---|
| Enseignant | `/v2/results`, `/v2/results/matrix`, `/v2/results/overrides`, `/v2/results/resit` |
| Enseignant | `/v2/rules`, `/v2/rules/bindings` |
| Responsable pédagogique | `/v2/results/overrides`, `/v2/results/decisions`, `/v2/results/resit` |
| Parent | `/v2/results`, `/v2/results/matrix`, `/v2/rules` |
| Élève | `/v2/results/matrix`, `/v2/rules/bindings` |
| Secrétariat | `/v2/results/matrix`, `/v2/rules` |

Les familles lisent leurs résultats **officiels** (période clôturée) par `/v2/student/results` (élève) et le portail parent, jamais par ces écrans.

## Données de départ (seed)

Fichiers sources : `scripts/seed-v2/demo/results.ts`, `scripts/seed-v2/demo/index.ts`, `apps/api/src/modules/rules/seed/*`.

- **Catalogue national** (6 jeux, lecture seule, tous « Publiée ») : "Supérieur à crédits (LMD) — UE / ECUE" (`CI-HIGHER-LMD`, contrat `credit-semester@1`), "BTS — matières à coefficients" (`CI-HIGHER-BTS`), "Pile classique — moyennes pondérées, mentions, décisions" (`CI-CLASSIC-SEMESTRE`), "Primaire — jeu de démonstration (fictif)" (`CI-PRIMARY-PLACEHOLDER`, versions 1, 2, 3), "Secondaire — jeu de démonstration (fictif)" (`CI-SECONDARY-PLACEHOLDER`, versions 1 `coef-semester@1` et 2 `secondary-annual@1`), "Examens nationaux — jeu de démonstration (fictif)" (`CI-EXAM-PLACEHOLDER`).
- **Liaisons** : secondaire : `secondary-annual@1` → `CI-SECONDARY-PLACEHOLDER` pour les niveaux `LOWER_SECONDARY` et `UPPER_SECONDARY` ; primaire : `coef-period@1` → `CI-PRIMARY-PLACEHOLDER` (niveau `PRIMARY`) et `competency-period@1` (niveau `PRESCHOOL`) ; supérieur : `credit-semester@1` → `CI-HIGHER-LMD` depuis le 2024-09-01.
- **6e A, Trimestre 1** : clôturé, calculé par `CI-SECONDARY-PLACEHOLDER` version 2, sans délibération (réglage "délibération obligatoire" désactivé). **Trimestre 2** : notes publiées puis verrouillées, conseil de classe ouvert (chapitre conseils) : **ne pas le modifier**. **Trimestre 3** : aucune note de la graine.
- **Notes de la graine** (8 élèves, deux notes par matière au Trimestre 1) et, par conséquent, résultats **prouvés** ci-dessous (calcul refait avec les formules de `scripts/seed-v2` et des règles ; la valeur de la moyenne de BAMBA Aya, 12,10, coïncide avec le constat QA C-09-06).
- **Université Horizon, Licence 1 A, Semestre 1** : clôturé par `CI-HIGHER-LMD` ; deux UE de deux ECUE (Algorithmique et Programmation ; Mathématiques et Statistiques) ; type "Devoir" (continu) et « Examen ».

### Règles de démonstration du secondaire (à connaître pour vérifier les chiffres)

Pour chaque élève, par période : (1) **moyenne de la matière** = moyenne des notes **ramenées sur 20** (note ÷ barème × 20) **pondérée par le coefficient de l'évaluation** ; (2) **moyenne de la période** = moyenne des matières notées **pondérée par le coefficient de la matière** (Français 3, Mathématiques 3, Anglais 2, Histoire-Géographie 2) ; une matière sans note est ignorée (jamais comptée zéro) ; une absence, une dispense ou un "non évalué" est ignoré ; (3) **mention** : Excellent à partir de 16, Très bien 14, Bien 12, Assez bien 10, Passable 8, sinon Insuffisant (bornes incluses) ; (4) **décision de période** (suggestion) : validée à partir de 10, "renforcement recommandé" de 8 à moins de 10, non validée en dessous ; sans moyenne : "Notes incompletes" ; (5) **rang** : classement de compétition (ex æquo partagés), égalité jugée à 4 décimales ; (6) affichage arrondi à 2 décimales (demi supérieur), la valeur exacte est dans l'infobulle. Les libellés de décision du jeu sont écrits sans accents ("Periode validee", "Renforcement recommande", "Periode non validee", "Notes incompletes") : voir Écarts.

### Résultats attendus du Trimestre 1 (6e A, graine)

| Élève | Moy. Français / Math. / Anglais / H-G | Moyenne | Rang | Mention | Décision |
|---|---|---|---|---|---|
| TOURE Yao | 12,75 / 14,25 / 13,25 / 13,75 | 13,5 | 1 | Bien | Periode validee |
| DIABATE Nadia | 13,25 / 13,75 / 15,75 / 9,75 | 13,2 | 2 | Bien | Periode validee |
| COULIBALY Moussa | 9,25 / 16,25 / 9,75 / 16,75 | 12,95 | 3 | Bien | Periode validee |
| BAMBA Fatou | 16 / 11 / 11,25 / 11,75 | 12,7 | 4 | Bien | Periode validee |
| BAMBA Aya | 11,25 / 11,75 / 12,75 / 13,25 | 12,1 | 5 | Bien | Periode validee |
| DIABATE Salimata | 11,5 / 13 / 7,75 / 14,75 | 11,85 | 6 | Assez bien | Periode validee |
| COULIBALY Salimata | 14 / 9 / 14,75 / 8,75 | 11,6 | 7 | Assez bien | Periode validee |
| TOURE Jean-Marc | 12 / 7 / 11,75 / 12,25 | 10,5 | 8 | Assez bien | Periode validee |
| ADOU Aïcha, ASSI Brice (sans note) | — | — | — | En attente | Notes incompletes |

Rang présenté « `<rang>` sur 8 » (8 élèves classés). Les zéros finaux peuvent être affichés ou non ("13,2" ou "13,20").

### Résultats attendus du Trimestre 2 (lecture, provisoires)

Une seule note par matière. Moyennes : TOURE Yao 13,9 (rang 1), BAMBA Aya 13,4 (2), COULIBALY Salimata 13,3 (3), TOURE Jean-Marc 12,9 (4), DIABATE Salimata 12,8 (5), BAMBA Fatou 12,4 (6), COULIBALY Moussa 10,4 (7), DIABATE Nadia 9,9 (8). Nadia : mention Passable, décision "Renforcement recommande" ; Moussa : mention Assez bien ; les autres : mention Bien, "Periode validee".

### Résultats attendus du Trimestre 3 après le chapitre 8 (provisoires)

Seule la Mathématiques a des notes publiées : Devoir n°1 (coef. 1, sur 20) et Interrogation (coef. 2, sur 10, soit 8 sur 10 = 16 sur 20). Moyenne de période = moyenne de Mathématiques.

| Élève | Calcul | Moyenne | Rang | Mention | Décision |
|---|---|---|---|---|---|
| DIABATE Nadia | (18×1 + 16×2) ÷ 3 | 16,67 | 1 sur 6 | Excellent | Periode validee |
| COULIBALY Salimata | (16×1 + 15×2) ÷ 3 | 15,33 | 2 | Très bien | Periode validee |
| ADOU Aïcha | 14 | 14 | 3 | Très bien | Periode validee |
| COULIBALY Moussa | (12,5×1 + 12×2) ÷ 3 | 12,17 | 4 | Bien | Periode validee |
| ASSI Brice | 10,5 (après correction) | 10,5 | 5 | Assez bien | Periode validee |
| DIABATE Salimata | (0×1 + 6×2) ÷ 3 | 4 | 6 | Insuffisant | Periode non validee |
| BAMBA Aya, BAMBA Fatou, TOURE Jean-Marc, TOURE Yao | absents / dispensé / non évalué | — | — | En attente | Notes incompletes |

---

## Scénarios : règles

#### 9.1 Parcourir le catalogue des règles
Compte : Directeur (`directeur@secondaire-test.test`) · Où : menu RÈGLES DE CALCUL > "Règles de calcul" (`/v2/rules`) · Prérequis : seed seul.
1. Ouvrir « Règles de calcul » : titre « Règles de calcul », description « Jeux de règles nationaux (lecture seule) et variantes de votre établissement. Publier une règle ne recalcule aucun résultat existant. ».
2. Dans « Rechercher un jeu de règles », taper `PLACEHOLDER` : les jeux « Primaire », « Secondaire » et "Examens nationaux" restent. Vider le champ.
3. Choisir « Origine » = « National », puis « Établissement » (vide), puis « Toutes les origines ».
4. Dans la carte "Secondaire — jeu de démonstration (fictif)" lire le code `CI-SECONDARY-PLACEHOLDER`, les badges « National » et « Lecture seule », et le tableau « Versions de Secondaire — jeu de démonstration (fictif) » : colonnes « Version », « État », « Période d'effet », « Contrat ».
Résultat attendu : 6 jeux nationaux ; versions « Version 1 » (contrat `coef-semester@1`) et « Version 2 » (contrat `secondary-annual@1`) du secondaire, toutes « Publiée », « Période d'effet » « Du `<date>` au sans fin » ; avec le filtre « Établissement » : « Aucun jeu de règles. » et « Modifiez la recherche ou le filtre. ». Les noms des jeux de démonstration contiennent "(fictif)". **Aucun bandeau « Règles de démonstration » n'est affiché sur cet écran** (voir Écarts).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Recherche `zzz` | « Aucun jeu de règles. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (enseignant, 9.19)

#### 9.2 Lire une version, ses règles, ses paramètres ; valider ; tester une règle
Compte : Directeur · Où : carte du jeu secondaire > « Ouvrir » (version 2) (`/v2/rules/versions/<identifiant>`) · Prérequis : 9.1.
1. Cliquer « Ouvrir » sur la « Version 2 ». Lire le titre `CI-SECONDARY-PLACEHOLDER · version 2`, la description « Contrat de calcul secondary-annual@1 », les champs « Effet à partir du », « Fin d'effet » (« sans fin »), « Empreinte », « Source » et le message « Version nationale : en lecture seule. Créez une variante de l'établissement pour adapter des paramètres ou des expressions. ».
2. Lire la barre « Gouvernance de la version » (Brouillon › Simulée › Proposée › Approuvée › Publiée) et la phrase « L'établissement propose ; l'approbation et la publication sont réservées à l'opérateur de la plateforme. ».
3. Onglet « Règles » : 11 règles (`moyenne_matiere`, `moyenne_ponderee`, `moyenne_section`, `moyenne_annuelle`, `mention`, `decision_conseil`, `decision_fin_annee`, `distinction`, `appreciation_conseil`, `arrondi_affichage`, `rang`). Ouvrir `moyenne_ponderee` : l'expression `wavg(matieres.score, matieres.coef)` est en lecture seule ; ouvrir `mention` : tableau « Paramètres » `excellent` 16, `tres_bien` 14, `bien` 12, `assez_bien` 10, `passable` 8 ; ouvrir « Aide du contrat » (« Entrées disponibles », « Codes de sortie autorisés »).
4. Cliquer « Valider la version ».
5. Sur `moyenne_ponderee`, cliquer « Tester » : la fenêtre « Tester la règle moyenne_ponderee » s'ouvre (« Évalue la règle sur un contexte que vous saisissez ; rien n'est enregistré. »). Dans « Variables (JSON) » saisir :
   ```
   {"matieres":[{"score":"12","coef":"3"},{"score":"14","coef":"2"}]}
   ```
   puis cliquer « Évaluer ».
6. Refaire avec `{"matieres":[{"score":null,"coef":"3"},{"score":"14","coef":"2"}]}`.
7. Sur la règle `mention`, « Tester » avec `{"moyenne":"14"}`, puis `{"moyenne":null}`.
8. Onglet « Journal ».
Résultat attendu : étape 4 : « La version est valide : toutes les expressions compilent et respectent le contrat. ». Étape 5 : "Valeur : 12.8" (type `number`), car (12×3 + 14×2) ÷ 5 = 12,8, avec la rubrique « Trace d'évaluation » (étapes, expressions, valeurs) et « 15 nœuds évalués ». Étape 6 : valeur `14` (la matière sans note est **ignorée**, pas comptée zéro). Étape 7 : `VERY_GOOD` pour 14, `PENDING` pour une moyenne absente. Journal : liste des événements de la version (ou « Aucun événement enregistré. »).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Variables `abc` | « Saisissez un objet JSON valide. » |
| Variables `[]` | « Saisissez un objet JSON valide. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un responsable pédagogique voit la version mais n'a ni « Valider la version » ni « Tester »

#### 9.3 Liaisons : quel jeu de règles s'applique à quel périmètre
Comptes : Directeur (secondaire), Directeur (primaire, supérieur) · Où : `/v2/rules/bindings` (onglet « Liaisons aux programmes ») · Prérequis : seed seul.
1. Compte secondaire : ouvrir « Liaisons aux programmes » : titre « Liaisons des règles ». Repérer la section du contrat `secondary-annual@1`.
2. Lire dans le tableau « Jeu de règles », « Périmètre », « Dates d'effet » : `CI-SECONDARY-PLACEHOLDER`, « Niveau : LOWER_SECONDARY » puis « Niveau : UPPER_SECONDARY », « Depuis le `<date>`, sans fin », badge « En vigueur ».
3. Repérer les autres contrats : « Aucune liaison pour ce contrat. » et « Sans liaison, aucun jeu de règles n'est appliqué à ce contrat. ».
4. Répéter avec `directeur@primaire-test.test` (contrats `coef-period@1` et `competency-period@1`, lié à `CI-PRIMARY-PLACEHOLDER`) et `directeur@superieur-test.test` (`credit-semester@1` lié à `CI-HIGHER-LMD`, « Tout l'établissement (par défaut) », depuis 2024-09-01).
Résultat attendu : chaque pack a son jeu ; aucun jeu officiel ivoirien n'est lié au primaire ni au secondaire. Un encadré "programme sans règle active" n'apparaît que si un programme n'est couvert par aucune liaison. Le nom de l'établissement peut s'afficher « établissement inconnu » (voir Écarts).
- [ ] Cas nominal  - [ ] Droit refusé (enseignant, 9.19)

#### 9.4 Liaisons : ajouter, modifier, supprimer (sans effet sur les calculs)
Compte : Directeur (`directeur@secondaire-test.test`, MFA) · Où : `/v2/rules/bindings` · Prérequis : 9.3.
1. Cliquer « Ajouter une liaison » : fenêtre « Ajouter une liaison » (« Une liaison associe un jeu de règles à un contrat de calcul, pour un périmètre et à partir d'une date. »).
2. Remplir (liaison **future et sur un niveau fictif**, donc sans effet sur la 6e A) :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Contrat de calcul | `Matières à coefficients (coef-semester@1)` | oui |
   | Jeu de règles | `Pile classique — moyennes pondérées, mentions, décisions (CI-CLASSIC-SEMESTRE)` | oui |
   | Périmètre | « Un niveau » | oui |
   | Code du niveau | `TG-NIVEAU` | oui pour « Un niveau » |
   | En vigueur à partir du | `2030-09-01` | oui |
   | Jusqu'au (inclus) | (vide) | non |
3. Cliquer « Enregistrer ».
4. Sur la nouvelle ligne (badge « À venir »), cliquer « Modifier » : seuls le jeu de règles et la date de fin sont modifiables (« Seuls le jeu de règles et la date de fin se modifient. Pour changer le périmètre ou la date de début, créez une nouvelle liaison puis supprimez l'ancienne. »). Saisir « Jusqu'au (inclus) » = `2030-12-31`, « Enregistrer ».
5. Cliquer « Supprimer » sur cette ligne : fenêtre « Supprimer cette liaison ? » ("Les résultats déjà calculés ne sont pas modifiés."), cliquer « Supprimer la liaison ».
Résultat attendu : « La liaison est créée. » ; ligne « Niveau : TG-NIVEAU », « Depuis le … » puis « Du … au … » ; « La liaison est enregistrée. » ; « La liaison est supprimée. ». Aucun résultat existant ne change. Valeurs persistées après rechargement.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Un niveau » sans code | « Saisissez le code du niveau. » |
| « Un programme » sans programme | « Choisissez le programme. » |
| « En vigueur à partir du » vide | « Date attendue au format AAAA-MM-JJ. » |
| « Jeu de règles » non choisi | "Code de jeu de règles invalide (ex. CI-HIGHER-LMD)." |
| Deux fois la même liaison (même niveau, même contrat, dates qui se recoupent) | "Une liaison du même périmètre couvre déjà tout ou partie de cette période." |
| « Jusqu'au » antérieur au début | "La fin d'effet doit être postérieure ou égale au début." |
| Directeur des études ou responsable pédagogique | aucun bouton « Ajouter une liaison », « Modifier », « Supprimer » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (directeur des études : boutons absents)

#### 9.5 Variante d'établissement : copie, paramètres, simulation, proposition
Compte : Directeur (secondaire) · Où : `/v2/rules` > carte du jeu secondaire · Prérequis : 9.2. Le bouton dépend de l'offre (fonction « Variantes de règles par établissement ») : s'il n'apparaît pas, noter "variantes non incluses" et passer.
1. Sur la « Version 2 » (publiée), cliquer « Créer une variante ». Fenêtre « Variante de Secondaire — jeu de démonstration (fictif) » : « Nom de la variante » = `Variante test guide`, « Date d'effet » = `2031-09-01`, « Notes » = `Essai guide de test`, cliquer « Créer la variante ».
2. Cliquer « Ouvrir la variante ». Lire le badge « Établissement » et l'état « Brouillon ».
3. Onglet « Règles » > `decision_conseil` > tableau « Paramètres » : `validation` (défaut 10), `renforcement` (défaut 8). Saisir `12` dans « Valeur de validation », cliquer « Enregistrer les paramètres ».
4. Essayer des valeurs invalides (tableau ci-dessous), puis remettre `12`.
5. Remarquer la note « Les paramètres sont modifiables ; la modification des expressions exige un droit et une option de l'offre supplémentaires. » (le secondaire ne modifie pas les expressions).
6. Onglet « Simulation » : « Données à rejouer » : « Classe » = `6e A`, « Période » = `Trimestre 1`, « Ajouter », puis « Lancer la simulation ». Attendre la fin (« Simulation en cours : N % »).
7. Lire le « Rapport de simulation » : « Cas rejoués », « Modifiées », « Inchangées », « Nouvelles erreurs », « Décisions modifiées », tableau « Effet par règle ».
8. Barre de gouvernance : « Marquer comme simulée », puis « Proposer à l'approbation » (case « Je confirme avoir pris connaissance de l'impact sur les décisions » si l'impact est positif, commentaire facultatif), puis « Retirer la proposition » pour revenir à « Brouillon ».
Résultat attendu : « La variante est créée en brouillon. » ; « Modification enregistrée. » ; la simulation compare à la version nationale 2 : la règle `decision_conseil` apparaît dans « Effet par règle » avec **3 modifications attendues** (calcul à la main, "à vérifier en test") : TOURE Jean-Marc (10,5), COULIBALY Salimata (11,6) et DIABATE Salimata (11,85) passent de "Periode validee" à "Renforcement recommande" car 12 devient le seuil ; ni la mention ni les moyennes ne changent. Message "La version est passée à l'état Simulée", puis « Proposée », puis « Brouillon ». **Aucun résultat existant n'est modifié** : une variante non approuvée n'est jamais appliquée.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Variante sans « Date d'effet » | « Date attendue au format AAAA-MM-JJ. » |
| `validation` = `25` | « Au plus 20. » |
| `validation` = `-1` | « Au moins 0. » |
| `validation` = `abc` | « Saisissez un nombre. » |
| Simuler la **version nationale 2** elle-même | "Aucune version de référence à comparer : une simulation compare TOUJOURS à une version précédente active, jamais à une version vide." |
| « Lancer la simulation » sans cible | « Ajoutez au moins une classe et une période à simuler. » |
| « Ajouter » sans classe ou période | « Choisissez une classe et une période. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (directeur des études : pas de « Créer une variante » ; aucune approbation possible pour l'établissement)

#### 9.6 Éditeur d'expressions : la syntaxe des règles (supérieur)
Compte : Directeur (`directeur@superieur-test.test`, MFA) · Où : `/v2/rules` > "Supérieur à crédits (LMD) — UE / ECUE" · Prérequis : fonction "Éditeur d'expressions de calcul" incluse (pack Supérieur) ; sinon noter l'absence.
Rappel du langage (aucune boucle ni récursion possible) : nombres décimaux exacts (`0.4`), textes `"Bien"`, `true`, `false`, `null`, listes `[1, 2]` ; opérateurs `+ - * / % == != < <= > >= && || !` ; commentaires `// …` ; fonctions `avg, wavg, sum, min, max, count, clamp, abs, round_half_up, round_half_even, floor, ceil, if, coalesce, is_null, rank, len` et `map, filter, any, all` avec `x => …` ; paramètres `params.seuil` bornés ; une valeur "pouvant être absente" doit passer par `is_null` ou `coalesce` avant un calcul.
1. Créer une variante (comme 9.5, nom `Variante LMD test guide`, date d'effet `2031-09-01`) et l'ouvrir.
2. Onglet « Règles » > `arrondi_affichage` : champ « Expression » modifiable. Ajouter une première ligne de commentaire `// test guide`, cliquer « Enregistrer l'expression ».
3. Remplacer `valeur` par `valeure` dans l'expression, « Enregistrer l'expression ».
4. Cliquer « Annuler les modifications ». Taper une expression à parenthèse ouverte `round_half_up(valeur, 2` et enregistrer.
5. Sur `mention_releve`, retirer `is_null(moyenne)` en tête (expression `if(moyenne >= params.passable, "PASSABLE", "INSUFFICIENT")`) et enregistrer.
6. Revenir à l'expression d'origine (« Annuler les modifications »).
Résultat attendu : étape 2 : « Modification enregistrée. ». Étape 3 : l'enregistrement est **refusé** avec un diagnostic français, position et conseil : "Nom inconnu" suivi du mot valeure, avec l'aide "Vouliez-vous dire" suivi du mot valeur et le repère `^` sous le mot fautif (ligne 1, colonne indiquée) ; rien n'est enregistré. Étape 4 : message de syntaxe du type "( ouverte (ligne 1, colonne 5) sans ) correspondante.". Étape 5 : "Le côté gauche de l'opérateur >= peut être absent." avec l'aide "Utilisez coalesce(valeur, défaut), ou testez is_null(valeur) avant…" (les formulations exactes sont à relever en test).
Cas invalides : voir ci-dessus (étapes 3 à 5).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (directeur des études : expression en lecture seule)

---

## Scénarios : résultats

#### 9.7 État d'une période clôturée (Trimestre 1)
Compte : Directeur des études (`etudes@secondaire-test.test`) · Où : menu RÉSULTATS > "Périodes : verrouillage et clôture" (`/v2/results`) · Prérequis : seed seul.
1. Choisir « Classe » = `6e A` et « Période » = `Trimestre 1` (formulaire « Classe et période »).
2. Lire « État de la période » : badge « Clôturée », étapes "Ouverte › Notes verrouillées › Délibérée › Clôturée", « Règle appliquée » `CI-SECONDARY-PLACEHOLDER · v2`, « Empreinte de la règle », « Version des résultats », dates « Notes verrouillées le » et « Clôturée le » (« Délibérée le » vide : clôture sans délibération).
3. Lire « Résultats de la classe » : « Inscriptions », « Provisoires », « Définitifs », « En erreur ».
4. Lire la section « Clôtures » et la liste « Aller à » (« Résultats de la classe », « Décisions et délibérations », « Surcharges », « Émettre les bulletins »).
Résultat attendu : « Définitifs » = nombre de résultats figés (9 ou 10 selon les inscrits), « Provisoires » 0, « En erreur » 0 ; une ligne « Version 1 — N résultats figés le `<date>` » avec « Empreinte de clôture ». **Aucun** bouton « Verrouiller les notes », « Clôturer la période » ni « Relancer le calcul » ; le bouton « Rouvrir la période » n'apparaît pas non plus pour ce compte (réservé au directeur). Note : dans « Années et périodes » (chapitre structure), T1 peut apparaître « Ouverte » : état calendaire distinct de l'état de clôture des résultats (voir Écarts).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Aucune classe ni période choisie | « Choisissez une classe et une période pour voir son état. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (pas de « Rouvrir la période » pour le directeur des études)

#### 9.8 Lire les résultats de la classe (matrice) et vérifier les chiffres
Compte : Responsable pédagogique (`pedagogie@secondaire-test.test`) puis Directeur des études · Où : barre « Résultats » > « Résultats de classe » (`/v2/results/matrix`) · Prérequis : seed seul.
1. Choisir `6e A` et `Trimestre 1`.
2. Lire l'en-tête : badge « Clôturée » et « Règle CI-SECONDARY-PLACEHOLDER v2 — version des résultats 1 ».
3. Lire le tableau « Résultats des élèves de la classe » : colonnes « Élève », « Moyenne », « Rang », « Mention », « Décision », « État ».
4. Comparer chaque ligne au tableau "Résultats attendus du Trimestre 1".
5. Survoler la moyenne de TOURE Yao : infobulle « Valeur exacte : 13,5 ».
6. Passer « Ordre d'affichage » de « Par nom » à « Par rang ».
7. Cocher « Afficher le détail par cours » : une colonne par matière apparaît.
8. Sélectionner `Trimestre 2` puis `Trimestre 3`.
Résultat attendu : étape 4 : toutes les valeurs du tableau de référence (par exemple BAMBA Aya : 12,1, rang 5 sur 8, Bien, "Periode validee"), badge d'état « Définitif » ; ADOU Aïcha et ASSI Brice : « — », « — », mention « En attente », décision "Notes incompletes". Étape 6 : TOURE Yao en tête (rang 1 sur 8). Étape 7 : pour BAMBA Aya, Français 11,25, Mathématiques 11,75, Anglais 12,75, Histoire-Géographie 13,25. Étape 8 : au Trimestre 2 badge « Notes verrouillées », résultats « Provisoire » (message « Des résultats sont provisoires : ils deviennent officiels à la clôture de la période. ») avec les valeurs du tableau "Trimestre 2" ; au Trimestre 3 (si le chapitre 8 est fait) les valeurs du tableau "Trimestre 3", état « Provisoire », badge de période « Ouverte ». **Les moyennes ne sont pas modifiables.**
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Aucune sélection | « Choisissez une classe et une période. » |
| Période sans résultat calculé | « Aucun résultat pour cette période : les notes doivent être publiées puis le calcul exécuté. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (enseignant, parent : 9.19)

#### 9.9 "Pourquoi cette moyenne ?" : explication d'un résultat
Compte : Directeur des études · Où : matrice > « Pourquoi ? » sur la ligne de BAMBA Aya (`/v2/results/<identifiant>/explain`) · Prérequis : 9.8.
1. Cliquer « Pourquoi ? » (libellé accessible « Pourquoi ce résultat pour BAMBA Aya »).
2. Lire la page « Pourquoi ce résultat ? » : message « Résultat définitif : trace enregistrée lors de la clôture. », bloc « Résultat » (« Règle appliquée », « Contrat » `secondary-annual@1`, « Moteur de règles », « Version du résultat », « Calculé le », « Figé le », « Empreinte de la règle », « Empreinte des entrées », « Empreinte des sorties », « Moyenne »).
3. Lire « N lignes de résultat » : une ligne "Matière · Français" etc. et une ligne « Période ». Déplier la ligne « Période ».
4. Dans les étapes, repérer `moyenne_ponderee` (valeur 12.1), ouvrir "Contexte de l'appel" (la liste `matieres` avec `score` et `coef`) et "Pas de calcul" (expression `wavg(matieres.score, matieres.coef)`).
5. Cliquer « Retour aux résultats ».
Résultat attendu : la chaîne est lisible : (11,25×3 + 11,75×3 + 12,75×2 + 13,25×2) ÷ 10 = 12,1, identique à la matrice. La page ne montre que cet élève. Pour un résultat **provisoire** (Trimestre 3), le message est « Résultat provisoire : la trace est rejouée avec les données actuelles ; rien n'est enregistré. ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| `/v2/results/00000000-0000-4000-8000-000000000000/explain` | erreur "Résultat introuvable (…)" ou équivalent (à relever en test), aucune donnée |
| Enseignant | page « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé

#### 9.10 Résultat annuel incomplet
Compte : Directeur des études · Où : matrice > « Année » sur la ligne de BAMBA Aya (`/v2/results/year/<inscription>/<année>`) · Prérequis : 9.8.
1. Cliquer « Année » (libellé accessible « Résultat annuel de BAMBA Aya »).
2. Lire « Résultat annuel », l'avertissement et le tableau « Résultats par période ».
Résultat attendu : « Résultat incomplet : une ou plusieurs périodes ne sont pas clôturées. » et « Périodes manquantes : Trimestre 2, Trimestre 3. » (seulement "Trimestre 2" après le scénario 9.15) ; le tableau montre Trimestre 1 « Définitif » (moyenne 12,1, décision "Periode validee") et les autres « Provisoire ». Aucune moyenne annuelle partielle n'est calculée.
- [ ] Cas nominal

#### 9.11 Résultats provisoires du Trimestre 3 et relance du calcul
Compte : Directeur des études · Où : `/v2/results` puis `/v2/results/matrix` · Prérequis : chapitre 8 (publication des deux évaluations de Mathématiques) ; attendre 30 secondes.
1. `/v2/results` > `6e A` > `Trimestre 3` : lire l'état « Ouverte », « Provisoires » = nombre d'élèves, « Définitifs » 0.
2. Lire la section « Évaluations non publiées » : "1 évaluation n'est pas encore publiée" avec le lien "Devoir commun test guide" et son état brut (SUBMITTED, voir Écarts).
3. Cliquer « Relancer le calcul » ; relire après quelques secondes.
4. Ouvrir la matrice du Trimestre 3 et comparer au tableau "Résultats attendus du Trimestre 3".
Résultat attendu : étape 3 : message « Le calcul est relancé. » ; une ligne apparaît dans « Demandes de recalcul » (statut brut possible, par exemple "DONE", voir Écarts). Étape 4 : valeurs du tableau de référence (Nadia 16,67 rang 1 sur 6, etc.). La note d'absence (BAMBA Aya), la dispense (TOURE Jean-Marc) et le "non évalué" (TOURE Yao) **ne comptent pas comme zéro** : leur moyenne reste « — » ; seule DIABATE Salimata, qui a réellement `0`, est pénalisée (4).
- [ ] Cas nominal

#### 9.12 Surcharge d'un résultat (dérogation) : demande, refus, approbation par une autre personne, révocation
Comptes : Directeur des études (demande), Directeur (décision) · Où : barre « Résultats » > « Surcharges » (`/v2/results/overrides`) · Prérequis : 9.11 (Trimestre 3 non verrouillé).
Principe : seule voie manuelle sur un résultat calculé ; justifiée (20 caractères au moins), approuvée par **une autre personne**, tracée. **Les notes ne sont jamais modifiées.**
1. Compte `etudes@secondaire-test.test` : ouvrir « Surcharges », choisir `6e A` et `Trimestre 3`. Cliquer « Demander une surcharge ».
2. Remplir (attention : « Niveau » est par défaut « Unité d'enseignement », à changer) :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Élève | `COULIBALY Moussa` | oui |
   | Niveau | « Période » | oui |
   | Cours | (vide : pour une règle de période) | non |
   | Règle ciblée | `moyenne_ponderee` | oui |
   | Nature | « Valeur imposée » | oui |
   | Valeur imposée | `14,5` | oui |
   | Justification | `Erreur de report constatée sur la copie de l'interrogation, valeur corrigée par la direction (test guide)` | oui |
3. Cliquer « Envoyer la demande ».
4. Constater que ce compte n'a pas de bouton « Approuver ».
5. Se connecter avec `directeur@secondaire-test.test`, rouvrir « Surcharges » (même classe et période), sur la carte de COULIBALY Moussa cliquer « Approuver », commentaire facultatif `Vérifié (test guide)`, bouton « Approuver ».
6. Attendre 30 secondes, ouvrir la matrice du Trimestre 3, puis « Pourquoi ? » sur COULIBALY Moussa.
7. Revenir à « Surcharges », cliquer « Révoquer » : « Motif de la révocation » = `Retour à la valeur calculée (test guide)`, bouton « Révoquer ». Attendre 30 secondes et relire la matrice.
8. Deuxième essai : demander (comme en étapes 1 à 3) une surcharge pour DIABATE Salimata, niveau « Période », règle `moyenne_ponderee`, valeur `5`, puis, avec le directeur, la **rejeter** avec « Motif du rejet » = `Pas de justification suffisante (test guide)`.
Résultat attendu : étape 3 : « La demande de surcharge est enregistrée ; elle doit être approuvée par une autre personne. » ; carte « Surcharge pour COULIBALY Moussa » avec `moyenne_ponderee`, « Période », « Demandée », `12,17 → 14,5`, la justification, « Demandée par `<nom>` le `<date>` ». Étape 5 : « La surcharge est approuvée. », état « Approuvée ». Étape 6 : moyenne 14,5, rang 3 (devant ADOU Aïcha 14, devenue 4), mention « Très bien » ; la page « Pourquoi ce résultat ? » indique « Surchargée » et « Valeur imposée par une surcharge approuvée (valeur calculée : 12.16666… ). ». Étape 7 : « La surcharge est révoquée. » ; la moyenne revient à 12,17 (Bien, rang 4). Étape 8 : « La surcharge est rejetée. ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Justification de 10 caractères | « Le motif doit faire au moins 20 caractères. » |
| Valeur imposée vide | "Une surcharge de valeur exige la valeur imposée." |
| Valeur imposée `abc` | message de format du champ (à relever en test) |
| Niveau « Unité d'enseignement » avec la règle `moyenne_ponderee` | « Aucune surcharge VALUE n'est permise sur l'étape « moyenne_ponderee » au niveau UE. » (message du serveur, à relever en test) |
| Niveau « Matière » sans « Cours » | « Indiquez le nœud du curriculum visé par la surcharge. » |
| Niveau « Période » avec un « Cours » | "Une surcharge de niveau période / année ne vise aucun nœud." |
| Seconde demande sur la même cible tant que la première est en cours | "Une surcharge est déjà en cours pour cette cible : traitez-la ou révoquez-la d'abord." |
| Le directeur approuve **sa propre** demande (réglage de séparation actif) | "Le demandeur d'une surcharge ne peut pas l'approuver lui-même." |
| Rejet avec 2 caractères | « Le motif doit comporter au moins 5 caractères. » |
| Période clôturée (Trimestre 1) | "La période est clôturée : rouvrez-la pour surcharger un résultat." |
| Directeur des études | pas de bouton « Approuver », « Rejeter », « Révoquer » |
Variante : une surcharge de niveau « Matière » (règle `moyenne_matiere`, « Cours » = `Mathématiques`) souligne en pointillés la valeur dans la matrice avec « Afficher le détail par cours » (infobulle « Valeur surchargée (approuvée) »).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (directeur des études sans « Approuver »)

#### 9.13 Décisions, délibération, appréciations
Compte : Directeur des études · Où : barre « Résultats » > « Décisions et délibérations » (`/v2/results/decisions`) · Prérequis : 9.12 (surcharge révoquée).
1. Choisir `6e A` et `Trimestre 1` : onglet « Décisions » : tableau « Décisions des élèves » (« Élève », « Nature », « Proposée par la règle », « Décision retenue », « État »).
2. Choisir `Trimestre 3`. Si des décisions sont « Proposée », cliquer « Confirmer » sur DIABATE Salimata : fenêtre « Confirmer la décision de DIABATE Salimata » avec « Proposition de la règle : Periode non validee ».
3. Cocher « Retenir une autre décision » ; essayer d'abord le motif court, puis choisir « Décision retenue » = `Renforcement recommande` et « Motif de la décision » = `Élève en progrès constaté sur le dernier devoir (test guide)` ; « Confirmer la décision ».
4. Onglet « Délibérations » : « Planifier une délibération » : « Nature » = « Conseil de classe », « Date de la séance » = date du jour, « Participant 1 » = rechercher `TRAORE` (TRAORE Kouadio), « Rôle 1 » = `Président` ; « Planifier ».
5. Sur la séance, cliquer « Marquer comme tenue ».
6. Onglet « Appréciations » : « Rédiger une appréciation » : « Élève » = `DIABATE Nadia`, « Auteur » = « Conseil de classe », « Appréciation » = `Excellent travail, à poursuivre (test guide)` ; « Enregistrer l'appréciation ».
Résultat attendu : étape 1 : décisions du Trimestre 1 déjà « Confirmée » (clôture sans délibération). Étape 3 : « La décision est confirmée. » ; la colonne « Décision retenue » montre le nouveau libellé avec le motif, la colonne « Proposée par la règle » **conserve** la proposition. Étape 4 : « La délibération est planifiée. » ; badge « Planifiée ». Étape 5 : « La séance est marquée comme tenue. », badge « Tenue ». Étape 6 : « L'appréciation est enregistrée. » et la ligne "DIABATE Nadia · Conseil de classe". La colonne « Nature » affiche le code brut (COUNCIL, YEAR_END…) : voir Écarts. Si aucune décision n'est encore proposée : « Aucune décision. » et « Les décisions sont proposées à la clôture du calcul de la période. ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Autre décision sans choix | « Choisissez la décision retenue. » |
| Autre décision identique à la proposition | « Cette décision est identique à la proposition : confirmez sans la modifier. » |
| Motif de 10 caractères | « Le motif doit faire au moins 20 caractères. » |
| Décision d'un Trimestre 1 déjà confirmée | aucun bouton « Confirmer » |
| Appréciation vide | « Ce champ est obligatoire. » |
| Enseignant | accès à la page possible (permission d'appréciation) mais la matrice lui est refusée : comportement à relever (voir Écarts) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (responsable pédagogique : page refusée)

#### 9.14 Verrouiller les notes du Trimestre 3 : refus, puis forçage motivé
Compte : Directeur des études · Où : `/v2/results` > `6e A` > `Trimestre 3` · Prérequis : 9.13. Évaluation "Devoir commun test guide" (Français) toujours « Soumise ».
**Attention : action qui fige les saisies de la période.**
1. Cliquer « Verrouiller les notes » : la fenêtre « Verrouiller les notes » (« Plus aucune note ne pourra être saisie ni publiée pour cette classe et cette période. ») signale « 1 évaluation n'est pas publiée : leurs notes ne seront pas prises en compte. ».
2. Sans cocher la case, cliquer « Verrouiller ».
3. Cocher « Verrouiller malgré les évaluations non publiées » (aide « Action tracée : un motif est obligatoire. »). Saisir « Motif du verrouillage forcé » = `Court`, cliquer « Verrouiller ».
4. Saisir `Évaluation de test non finalisée (test guide)` et cliquer « Verrouiller ».
Résultat attendu : étape 2 : "Des évaluations de cette classe et de cette période ne sont pas publiées : publiez-les ou forcez le verrouillage avec un motif.". Étape 3 : « Le motif doit faire au moins 10 caractères. ». Étape 4 : « Les notes de la période sont verrouillées. » ; état « Notes verrouillées » ; désormais toute création ou saisie sur cette période est refusée ("La période de cette classe est verrouillée pour cette session."). Les actions proposées sont « Enregistrer la délibération » et « Clôturer la période », plus « Relancer le calcul ».
- [ ] Cas nominal  - [ ] Cas invalide

#### 9.15 Délibérer et clôturer le Trimestre 3
Compte : Directeur des études · Où : `/v2/results` · Prérequis : 9.13 (séance tenue) et 9.14.
**Attention : les résultats deviennent définitifs ; seule la réouverture motivée (9.16) les change.**
1. Cliquer « Enregistrer la délibération » : cocher « Confirmer d'un coup les décisions proposées par les règles » (aide : « Vous pourrez encore modifier une décision avec un motif écrit avant la clôture. »), puis « Enregistrer la délibération ».
2. Cliquer « Clôturer la période » : lire « Les résultats deviennent définitifs. Pour les corriger plus tard, il faudra rouvrir la période avec un motif (nouvelle version des résultats). », cliquer « Clôturer ».
3. Tenter une surcharge sur ce trimestre (cas invalide de 9.12) et chercher « Relancer le calcul ».
Résultat attendu : étape 1 : « La délibération est enregistrée. », état « Délibérée » (sans séance tenue préalable : refus "Une séance de délibération tenue (conseil ou jury) est requise."). Étape 2 : « Période clôturée : N résultats figés (version 1), aucune exclusion. » ; état « Clôturée » ; section « Clôtures » : « Version 1 — N résultats figés le `<date>` » ; résultats « Définitif » dans la matrice, valeurs identiques au tableau de référence du Trimestre 3. Étape 3 : refus "La période est clôturée : rouvrez-la pour surcharger un résultat." ; plus de bouton « Relancer le calcul ». « Résultat annuel » (9.10) : « Périodes manquantes : Trimestre 2. ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Clôturer avec des inscriptions « En erreur » | "Des inscriptions ont un calcul en erreur : corrigez-les ou forcez la clôture avec exclusion explicite et motif." ; case « Clôturer en excluant les inscriptions en erreur » + motif de 10 caractères au moins (« Le motif doit faire au moins 10 caractères. ») |
| Réglage "délibération obligatoire" actif, clôture sans délibération | bouton « Clôturer la période » grisé et texte « L'établissement exige une délibération avant la clôture. » |
| Compte sans droit de clôture (responsable pédagogique) | aucune action proposée |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé

#### 9.16 Rouvrir une période clôturée avec un motif, puis la reclôturer
Compte : Directeur (`directeur@secondaire-test.test`, MFA) · Où : `/v2/results` > `6e A` > `Trimestre 3` · Prérequis : 9.15.
**Action sensible, tracée.** Ne l'exécutez **que** sur le Trimestre 3 (jamais sur le Trimestre 1 de la graine).
1. Cliquer « Rouvrir la période » : « Nature de la réouverture » = « Correction (toutes les notes redeviennent modifiables) » (aide « Acte sensible : les notes de la session 1 sont aussi déverrouillées. »).
2. Saisir « Motif de la réouverture » = `Test` et valider, puis `Réouverture d'essai du guide de test` et valider.
3. Relire « État de la période ».
4. Compte directeur des études : ouvrir "Devoir commun test guide" (Français) et cliquer « Annuler l'évaluation » (motif `Évaluation de test abandonnée (test guide)`).
5. Revenir à `/v2/results` : « Verrouiller les notes » (cette fois sans avertissement), puis « Clôturer la période ».
Résultat attendu : étape 2 : « Le motif doit faire au moins 10 caractères. » puis « La période est rouverte. » ; étape 3 : état « Ouverte », texte « Rouverte une fois. Dernier motif : Réouverture d'essai du guide de test », les décisions confirmées sont retirées. Étape 5 : le verrouillage ne signale plus d'évaluation non publiée ; message « Période clôturée : N résultats figés (version 2), aucune exclusion. » ; la section « Clôtures » contient « Version 1 » et « Version 2 » ; l'ancienne version reste consultable. Les chiffres du Trimestre 3 sont inchangés. **Cet état clôturé (version 2) est la base du chapitre 10.**
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Directeur des études | pas de bouton « Rouvrir la période » |
| Réouverture d'une période non clôturée | « Étape interdite pour la période : … » (code brut possible) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé

#### 9.17 Supérieur : un semestre est validé si TOUTES les UE le sont
Compte : Directeur des études (`etudes@superieur-test.test`, MFA) · Où : `/v2/results/matrix` > `Licence 1 A` > `Semestre 1` · Prérequis : seed seul. Règle (décision métier du 2026-10-01 dans `specs/v2/DECISIONS-METIER.md`) : **semestre validé = toutes les UE validées, sans compensation entre UE** ; une UE est validée si sa moyenne (pondérée par les crédits des ECUE) atteint 10, sans ECUE inférieure à 5 ; note d'ECUE = moyenne des devoirs × 0,4 + examen × 0,6.
1. Lire l'en-tête (règle `CI-HIGHER-LMD`, version 1) et le tableau (colonnes « Moyenne », « Rang », « Mention », « Décision », « Crédits », « État »).
2. Comparer au tableau ci-dessous.
3. Cocher « Afficher le détail par cours » : colonnes d'UE.
4. Pour TOURE Jean-Marc cliquer « Pourquoi ? » et déplier les lignes d'UE et d'ECUE.
| Élève | Notes d'ECUE (Algo / Prog / Math / Stat) | Moyenne UE 1 / UE 2 | Moyenne du semestre | Rang | Décision | Crédits |
|---|---|---|---|---|---|---|
| DIABATE Nadia | 13,9 / 13,1 / 16,1 / 10,1 | 13,5 / 14,1 | 13,8 | 1 | Admis | 12 / 12 |
| TOURE Yao | 11,7 / 14,3 / 12,3 / 14,1 | 13 / 12,9 | 12,95 | 2 | Admis | 12 / 12 |
| COULIBALY Moussa | 9,5 / 16,5 / 10,1 / 17,1 | 13 / 12,43 | 12,72 | 3 | Admis | 12 / 12 |
| BAMBA Fatou | 16,4 / 11,2 / 10,2 / 12 | 13,8 / 10,8 | 12,3 | 4 (ex æquo) | Admis | 12 / 12 |
| COULIBALY Salimata | 14,2 / 9 / 15 / 9 | 11,6 / 13 | 12,3 | 4 (ex æquo) | Admis | 12 / 12 |
| BAMBA Aya | 11,7 / 10,9 / 13,1 / 12,3 | 11,3 / 12,83 | 12,07 | 6 | Admis | 12 / 12 |
| DIABATE Salimata | 10,8 / 13,4 / 8 / 15 | 12,1 / 10,33 | 11,22 | 7 | Admis | 12 / 12 |
| TOURE Jean-Marc | 12 / 6,8 / 12 / 11,2 | **9,4** / 11,73 | 10,57 | 8 | **Rattrapage** | 6 / 12 |
Résultat attendu : mentions du jeu LMD (10, 12, 14, 16, 18) : "Assez Bien" de 12 à moins de 14 (tous sauf deux), « Passable » pour DIABATE Salimata et TOURE Jean-Marc. **TOURE Jean-Marc a une moyenne de semestre supérieure à 10 mais le semestre n'est pas validé** (badge « Non validé », décision « Rattrapage ») parce que l'UE 1 est à 9,4 : la bonne UE 2 **ne compense pas** l'UE 1. Les autres : badge « Validé ». DIABATE Salimata a une ECUE à 8 (Mathématiques) mais son UE 2 est validée à 10,33 : l'ECUE est "compensée" à l'intérieur de l'UE. La trace de TOURE Jean-Marc montre la règle `semestre_valide` à faux et `decision_semestre` "RESIT". Valeurs calculées à la main d'après le seed : écart d'arrondi d'affichage possible ("à vérifier en test").
- [ ] Cas nominal  - [ ] Cas invalide (même contrôles qu'en 9.8)  - [ ] Droit refusé (enseignant : refusé)

#### 9.18 Rattrapage (session 2) : candidats, fenêtre, la note de session 2 REMPLACE celle de session 1
Comptes : Directeur des études (supérieur), Enseignant, Responsable pédagogique, Directeur · Où : barre « Résultats » > « Rattrapage » (`/v2/results/resit`, même écran que `/v2/higher/resit`) · Prérequis : 9.17.
**Décision métier du 2026-10-01 : la note de session 2 remplace toujours celle de session 1, même si elle est plus faible.** Cette séquence **rouvre le Semestre 1** et produit une version 2 des résultats : à exécuter **en dernier**, après les chapitres qui utilisent les relevés du semestre (ou laisser au chapitre 11 si déjà fait).
1. Contrôle de fonction : avec `directeur@secondaire-test.test`, ouvrir `/v2/results/resit` : message de fonction non incluse (écran réservé au Supérieur).
2. Compte `etudes@superieur-test.test` : « Rattrapage », `Licence 1 A`, `Semestre 1`. Lire « Candidats au rattrapage » (colonnes « Étudiant », « Cours à repasser », « Moyenne session 1 »).
3. Cliquer « Ouvrir une fenêtre » : « Ouverture » = date du jour, « Fermeture » = date du jour + 14 jours, « Ouvrir la fenêtre ».
4. Compte `enseignant@superieur-test.test` : créer (8.5) `Examen Programmation session 2 test guide` : « Type d'évaluation » = « Examen », « Session » = « Session 2 (rattrapage) », « Classe » `Licence 1 A`, « Cours » `Programmation`, « Période » `Semestre 1`. Dans la grille (badge « Session 2 ») saisir `14` pour TOURE Jean-Marc et `4` pour COULIBALY Salimata ; les autres restent vides ; « Soumettre la feuille ».
5. Faire relire et approuver (responsable pédagogique), puis publier (directeur des études) comme au chapitre 8.
6. Directeur des études : sur « Rattrapage », « Clôturer la fenêtre », puis `/v2/results` : « Verrouiller les notes » et « Clôturer la période » (séquence exacte à vérifier en test).
7. Relire la matrice du Semestre 1 et « Pourquoi ? » pour TOURE Jean-Marc, ECUE Programmation.
Résultat attendu : étape 2 : 5 lignes (calcul à la main, à vérifier) : COULIBALY Moussa (Algorithmique 9,5), COULIBALY Salimata (Programmation 9 et Statistiques 9), DIABATE Salimata (Mathématiques 8), TOURE Jean-Marc (Programmation 6,8). Étape 3 : « Fenêtre ouverte : 5 inscriptions créées, 0 déjà inscrits. » ; la fenêtre s'affiche « Du `<date>` au `<date>` », « Ouverte ». Étape 4 : la création en Semestre 1 n'est possible **qu'avec** la fenêtre ouverte. Après reclôture : ECUE Programmation de TOURE Jean-Marc = 8×0,4 + 14×0,6 = **11,6** (au lieu de 6,8) ; UE 1 = 11,8, validée ; le semestre devient « Admis » ; pour COULIBALY Salimata la Programmation passe de 9 à 3,6 + 2,4 = **6,0** (la session 2, plus faible, **remplace** quand même la session 1) ; son UE 1 = (14,2 + 6,0) ÷ 2 = 10,1 reste validée. La trace de l'ECUE montre `note_examen_retenue` avec la session 2 retenue.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Fermeture » avant « Ouverture » | "La fin de la fenêtre précède son début." |
| Ouvrir une seconde fenêtre sur la même classe et période | "Une fenêtre de rattrapage est déjà ouverte pour cette classe et cette période." |
| Classe sans candidat | "Aucune ECUE à repasser pour cette classe et cette période." |
| Dates vides | « Date attendue au format AAAA-MM-JJ. » |
| Créer l'examen de session 2 sans fenêtre ouverte | "La période de cette classe est verrouillée pour cette session." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (responsable pédagogique : `/v2/results/resit` refusé)

#### 9.19 Droits refusés et qualité transversale
Comptes : voir le tableau "Droits".
1. Enseignant : `/v2/results`, `/v2/results/matrix`, `/v2/results/overrides`, `/v2/results/resit`, `/v2/rules`, `/v2/rules/bindings`.
2. Responsable pédagogique : `/v2/results/overrides`, `/v2/results/decisions`, `/v2/results/resit` ; vérifier qu'il lit `/v2/results/matrix` et `/v2/rules`.
3. Parent, élève, secrétariat : adresses du tableau.
4. Directeur des études : `/v2/rules/bindings` sans boutons d'écriture ; `/v2/results/overrides` sans « Approuver ».
5. États vides : `/v2/results/overrides` sans sélection : « Choisissez une classe et une période pour demander une surcharge ou filtrer la liste. » ; avec filtre « État » = « Révoquée » et aucune surcharge : « Aucune surcharge. » et « Les demandes de surcharge apparaissent ici. ».
6. Isolation : avec `directeur@primaire-test.test`, ouvrir `/v2/results/<identifiant>/explain (identifiant relevé dans le secondaire)`.
Résultat attendu : étapes 1 à 3 : page « Accès refusé » sans donnée ; étape 4 : lecture seule ; étape 6 : résultat introuvable, aucune donnée d'un autre établissement.
- [ ] Enseignant refusé  - [ ] Responsable pédagogique refusé  - [ ] Parent / élève / secrétariat refusés  - [ ] Isolation

---

## Données créées

| Enregistrement | Type | Scénario | Établissement |
|---|---|---|---|
| Liaison `TG-NIVEAU` (créée puis supprimée) | Liaison de règles | 9.4 | Collège Le Baobab |
| Variante test guide (brouillon, 2031-09-01) | Version de règles d'établissement | 9.5 | Collège Le Baobab |
| Simulation sur 6e A / Trimestre 1 | Simulation (lecture) | 9.5 | Collège Le Baobab |
| Variante LMD test guide (brouillon) | Version de règles d'établissement | 9.6 | Université Horizon |
| Surcharge COULIBALY Moussa 12,17 → 14,5 (révoquée) | Surcharge | 9.12 | Collège Le Baobab |
| Surcharge DIABATE Salimata → 5 (rejetée) | Surcharge | 9.12 | Collège Le Baobab |
| Décision DIABATE Salimata modifiée (Renforcement recommande) | Décision | 9.13 | Collège Le Baobab |
| Délibération « Conseil de classe » (Tenue) | Délibération | 9.13 | Collège Le Baobab |
| Appréciation DIABATE Nadia | Appréciation | 9.13 | Collège Le Baobab |
| Trimestre 3 de la 6e A : verrouillé, clôturé version 1 puis réouvert, clôturé version 2 | État de période et résultats définitifs | 9.14 à 9.16 | Collège Le Baobab |
| Fenêtre de rattrapage Licence 1 A / Semestre 1 ; Examen Programmation session 2 test guide ; Semestre 1 reclôturé (version 2) | Rattrapage | 9.18 | Université Horizon |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Résultats et règles | Aucun bandeau ni filigrane « Règles de démonstration » sur les écrans de résultats et de règles ; seule la désignation "(fictif)" du jeu de règles prévient (les bandeaux existent sur le tableau de bord de direction, les examens et les documents) | Mineur |
| Libellés des décisions de période | "Periode validee", "Renforcement recommande", "Periode non validee", "Notes incompletes" sans accents (libellés du jeu de règles, QA C-03-07, C-09-07) | Mineur |
| Colonne « Nature » (décisions), « Demandes de recalcul », liste « Évaluations non publiées » | Codes bruts affichés (COUNCIL, YEAR_END, DONE, BLOCKED, SUBMITTED, `results.state_closed`) | Mineur |
| Menu | Les entrées "Résultats de classe" et "Périodes : verrouillage et clôture" mènent toutes deux à `/v2/results` (écran des périodes), pas à la matrice | Mineur |
| Pourquoi ce résultat ? | Matière affichée par code court quand le nom n'est pas lu, « Version du résultat » parfois différente de « version des résultats » de la matrice (QA C-09-06) | Mineur |
| Décisions et délibérations | Page ouverte à l'enseignant (appréciations) alors que la matrice lui est refusée : écran probablement en erreur (à vérifier) | Mineur |
| Liaisons | « Niveau : LOWER_SECONDARY » (code brut) ; « Établissement : établissement inconnu » possible (QA C-03-06) | Mineur |
| Périodes | Trimestre 1 « Ouverte » au calendrier mais « Clôturée » dans les résultats (QA C-03-04, état de calendrier distinct) | Mineur |
| Période jamais calculée (Trimestre 3 avant publication) | Message technique « État de la période introuvable (identifiants) » au lieu d'un état vide explicite | Mineur |
| Simulation | Classe et période affichées par fragments d'identifiants ("01a110 · 01a110") | Mineur |
| Surcharge | Niveau par défaut « Unité d'enseignement » qui est impropre au secondaire (la règle de période exige « Période ») | Suggestion |
| Rattrapage | La séquence complète fenêtre → session 2 → reclôture n'est pas décrite à l'écran | Suggestion |

## À vérifier en test

- Chiffres des tableaux de référence (T1, T2, T3, supérieur) : calculés à la main d'après le seed et les formules ; signaler tout écart supérieur à l'arrondi.
- Rang "sur 8" (T1) et "sur 6" (T3), nombre de "résultats figés" (9 ou 10).
- Présence des boutons « Créer une variante » (fonction variantes), de l'éditeur d'expressions (pack Supérieur) et de « Enregistrer la délibération » (fonction délibérations).
- Formulation exacte des diagnostics de l'éditeur (9.6) et des erreurs de surcharge (valeur non numérique).
- Séquence exacte après « Clôturer la fenêtre » au rattrapage (9.18), et candidats attendus (5 lignes).
- Décisions de fin d'année proposées dès le Trimestre 3 alors que le Trimestre 2 n'est pas clôturé.
- Comportement de la page « Décisions et délibérations » pour un enseignant.

## Non couvert / limites connues

- Approbation et publication d'une variante de règles : réservées à l'opérateur de la plateforme (chapitre console).
- Changement de version de règle d'une période (« Passer à la version active », rapport d'impact) : exige une règle plus récente active ; non reproductible avec la graine.
- Résultats par compétences de la maternelle (`competency-period`) et conseil des maîtres : chapitre primaire.
- Examens nationaux (`CI-EXAM-PLACEHOLDER`) : chapitre examens.
- Consultation familiale des résultats officiels : chapitres élève et parent.
- Aucune règle officielle ivoirienne (passage, redoublement, BEPC, BAC, CEPE) n'est livrée ni testée.

## Notes d'audit de l'ancien guide (chapitre 9)

- « Résultats de classe » du menu ne mène pas à la matrice ; la matrice est dans la barre « Résultats ».
- « Enregistrer la délibération » exige d'abord une **séance tenue** (planifier puis marquer comme tenue) ; l'ancien guide l'omettait.
- Le niveau de surcharge par défaut est « Unité d'enseignement » ; pour la moyenne de période il faut « Période ». La mise en pointillés d'une moyenne ne concerne que les surcharges de niveau matière ou UE visibles en mode détail.
- Le rang était annoncé "sur 9" ; seuls les élèves ayant une moyenne sont classés (8 au Trimestre 1).
- Le bandeau « Règles de démonstration » n'existe pas sur ces écrans (confirmé).
