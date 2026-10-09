[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](22b-primaire-suite.md) · [Suivant →](24-actes-de-fin.md)

# Phase 23 — Université Horizon (supérieur) : UE/ECUE, relevé, rattrapage, diplôme

Objectif : lire la structure UE/ECUE et la règle "un semestre n'est validé que si toutes les UE le sont", gérer prérequis, dispense et rattrapage (la note de session 2 **remplace** celle de session 1), puis créer, octroyer, émettre, publier, vérifier et révoquer un diplôme. Précondition : base de départ de `pnpm dev:v2:seed` ; établissement **Université Horizon** (`superieur-test`), classe **Licence 1 A** (8 étudiants notés : DIABATE Nadia et Salimata, BAMBA Aya et Fatou, COULIBALY Moussa et Salimata, TOURE Yao et Jean-Marc), programme Informatique, semestre 1 clôturé avec le jeu `CI-HIGHER-LMD`. Aucun diplôme, document, dispense ni fenêtre de rattrapage n'existe au départ. Les notes se saisissent ici une seule fois (examen de session 2) ; le détail de la saisie est au chapitre 08.

## Étape 420 — Lire la structure UE / ECUE du curriculum
👤 **directeur des études** (superieur-test) `etudes@superieur-test.test` (**MFA** : le code du moment est proposé sur la page de connexion) · fenêtre **A** · 📂 Menu **« Académique »** > **« Curriculum »** (`/v2/academic/curriculum`)

1. Choisir le programme Informatique et l'année en cours ; lire la version publiée.
2. Déplier "Licence 1 A" > "Semestre 1" > "UE 1" et "UE 2".

✅ 2 UE de 6 crédits (total **12**) : `UE1` = ECUE `E11` Algorithmique (3 crédits, coef. 2) + `E12` Programmation (3 ; 1,5) ; `UE2` = `E21` Mathématiques (4 ; 2) + `E22` Statistiques (2 ; 1). Le rattrapage est autorisé sur chaque ECUE.

☐ OK ☐ KO

---

## Étape 421 — Semestre validé seulement si TOUTES les UE le sont
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Résultats »** > **« Résultats de classe »** (`/v2/results/matrix`)

Règle (décision métier du 2026-10-01) : pas de compensation entre UE ; une UE est validée si sa moyenne atteint 10 sans ECUE inférieure à 5.

1. Choisir "Licence 1 A" et "Semestre 1" ; lire l'en-tête (règle `CI-HIGHER-LMD`, version 1).
2. Cocher « Afficher le détail par cours ».
3. Pour TOURE Jean-Marc, cliquer **« Pourquoi ? »** et déplier les lignes d'UE et d'ECUE.

✅ Valeurs calculées d'après la graine *(écart d'arrondi possible, à vérifier)* :

| Étudiant | Moyenne UE 1 / UE 2 | Moyenne semestre | Rang | Décision | Crédits |
| :--- | :--- | :--- | :-: | :--- | :--- |
| DIABATE Nadia | 13,5 / 14,1 | 13,8 | 1 | Admis | 12 / 12 |
| TOURE Yao | 13 / 12,9 | 12,95 | 2 | Admis | 12 / 12 |
| COULIBALY Moussa | 13 / 12,43 | 12,72 | 3 | Admis | 12 / 12 |
| BAMBA Fatou | 13,8 / 10,8 | 12,3 | 4 (ex æquo) | Admis | 12 / 12 |
| COULIBALY Salimata | 11,6 / 13 | 12,3 | 4 (ex æquo) | Admis | 12 / 12 |
| BAMBA Aya | 11,3 / 12,83 | 12,07 | 6 | Admis | 12 / 12 |
| DIABATE Salimata | 12,1 / 10,33 | 11,22 | 7 | Admis | 12 / 12 |
| **TOURE Jean-Marc** | **9,4** / 11,73 | 10,57 | 8 | **Rattrapage** | **6 / 12** |

**TOURE Jean-Marc a plus de 10 de moyenne de semestre mais le semestre est « Non validé »** : sa bonne UE 2 ne compense pas l'UE 1 à 9,4. DIABATE Salimata a une ECUE à 8 (Mathématiques) mais son UE 2 est validée à 10,33.

☐ OK ☐ KO

---

## Étape 422 — Relevé de notes à crédits
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Bulletins »** (`/v2/reportcards`)

1. Choisir "Licence 1 A" et "Semestre 1" ; ouvrir la fiche de DIABATE Nadia puis celle de TOURE Jean-Marc.

✅ Lignes « Publié », « PDF prêt » ; la ligne « Crédits » affiche `12 / 12` (Nadia) et `6 / 12` (Jean-Marc), identiques à la matrice ; règle appliquée `CI-HIGHER-LMD · v1`, modèle `higher-bulletin-credits · v1`. Pas de filigrane de démonstration attendu *(à vérifier)*.

📚 Détail : chapitre 10, scénario 10.13.

☐ OK ☐ KO

---

## Étape 423 — Crédits et dettes d'UE (avant rattrapage)
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Crédits et dettes »** (`/v2/higher/credits`)

1. Dans « Étudiant » (« Rechercher un étudiant… »), choisir **DIABATE Nadia**.
2. Lire la « Synthèse » et le « Registre des crédits ».
3. Choisir **TOURE Jean-Marc**, puis **SORO Elie** (étudiant sans note).
4. Section « Durée de validité des crédits » : saisir `60` dans « Validité des crédits (mois) », cliquer **« Enregistrer »**, puis vider le champ et « Enregistrer » à nouveau.

✅ Nadia : 12 crédits acquis, 2 UE acquises, « Aucune dette d'UE. » ; chaque UE est désignée par un identifiant court "UE xxxxxxxx". Jean-Marc : 6 crédits et **une dette d'UE « Ouverte »**. SORO Elie : « Aucun crédit enregistré. ». Réglage : « Le réglage est enregistré. » (deux fois).

⚠️ *Test d'erreur* : `abc`, `0` ou `12,5` dans « Validité des crédits (mois) » → « Saisissez un nombre de mois entier (1 à 1200), ou laissez vide. »

⚠️ *Écart connu* : UE et cours sont affichés par identifiant court, pas par code (défaut d'affichage, mineur).

🔒 *Test de droit* : le secrétariat (`secretariat@superieur-test.test`, MFA) tape `/v2/higher/credits` → "Accès refusé".

☐ OK ☐ KO

---

## Étape 424 — Prérequis entre UE
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Prérequis »** (`/v2/higher/prerequisites`)

1. Titre « Prérequis entre UE ». « Programme » = Informatique, « Année » = année en cours ; dans « UE du programme » choisir la ligne `UE2` ("UE 2").
2. Lire « Cette UE n'a aucun prérequis. » puis cliquer **« Ajouter un prérequis »**. Saisir :

| Champ | Valeur |
| :--- | :--- |
| UE prérequise | `UE1 — UE 1` |
| Condition | `UE validée — l'étudiant a acquis l'UE` |

3. Cliquer **« Enregistrer les prérequis »**.
4. Section « Un étudiant satisfait-il les prérequis ? » : choisir DIABATE Nadia, puis TOURE Jean-Marc.
5. Cliquer « Retirer ce prérequis » puis « Enregistrer les prérequis ».

✅ « Les prérequis de UE 2 sont enregistrés. » ; Nadia : « Prérequis satisfaits » ; Jean-Marc : « Prérequis non satisfaits » avec « Prérequis manquants » (« UE non acquise »). Étape 5 : retour à « Cette UE n'a aucun prérequis. »

⚠️ *Écart connu (probable, majeur)* : l'écran envoie l'identifiant du nœud de l'UE alors que l'API attend sa lignée ; l'enregistrement peut être refusé avec un message du type "UE introuvable (…)". Si c'est le cas : consigner le texte exact, marquer l'étape "bloquée par l'écart" et passer à la suivante.

⚠️ *Test d'erreur* : condition « Moyenne minimale » = `25` → "La valeur doit être inférieure ou égale à 20."

☐ OK ☐ KO

---

## Étape 425 — Accorder une dispense d'UE (direction)
👤 **directeur** (superieur-test) `directeur@superieur-test.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Dispenses d'UE »** (`/v2/higher/exemptions`)

1. Lire « Effet d'une dispense sur les crédits » : politique « Enregistrer seulement » (la dispense est tracée mais ne change ni crédits ni validation). Cliquer **« Accorder une dispense »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Étudiant | `COULIBALY Moussa` |
| Inscription | la seule inscription active proposée |
| UE dispensée | `UE2 — UE 2` |
| Semestre de rattachement | `Semestre 1` |
| Motif de la dispense | `Dispense accordée pour test guide (équivalence)` |

3. Cliquer **« Accorder la dispense »**.

✅ « La dispense est accordée. » ; ligne avec "Aucun effet sur les crédits", badge « Accordée » ; le registre de crédits de COULIBALY Moussa n'a **pas** de ligne « Dispense ».

⚠️ *Test d'erreur* : motif `court` → "Au moins 10 caractères." ; même étudiant et même UE une seconde fois → "Cet étudiant est déjà dispensé de cette UE."

🔒 *Test de droit* : le directeur des études voit la liste mais **aucun** bouton « Accorder une dispense » ; le secrétariat est en lecture seule.

☐ OK ☐ KO

---

## Étape 426 — Révoquer la dispense
👤 **directeur** (superieur-test) · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Dispenses d'UE »** (`/v2/higher/exemptions`)

1. Sur la ligne de la dispense, cliquer **« Révoquer »** (fenêtre « Révoquer la dispense »).
2. Saisir `abc` dans « Motif » : refus. Remplacer par `Révocation de la dispense test guide` et valider.

✅ « La dispense est révoquée. » ; badge « Révoquée ».

⚠️ *Test d'erreur* : `abc` → « Le motif doit comporter au moins 10 caractères. »

📚 Variante « Inscrire les crédits de l'UE » : chapitre 11, scénario 11.5, étape 4.

☐ OK ☐ KO

---

## Étape 427 — Rattrapage : lire les candidats et ouvrir la fenêtre
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Rattrapages »** (`/v2/higher/resit`)

Règle (2026-10-01) : la note de session 2 **remplace toujours** celle de session 1, même si elle est plus faible. Ouvrir une fenêtre rouvre la période pour la seule session 2.

1. Lire « Rattrapages (session 2) » ; choisir « Classe » = Licence 1 A et « Période » = Semestre 1.
2. Lire « Candidats au rattrapage » (« Étudiant », « Cours à repasser », « Moyenne session 1 »).
3. Cliquer **« Ouvrir une fenêtre »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Ouverture | `2026-10-08` |
| Fermeture | `2026-10-22` |

4. Cliquer **« Ouvrir la fenêtre »** puis le bouton **« Inscrits »**.

✅ Candidats attendus (calcul à la main, *à vérifier*) : COULIBALY Moussa (Algorithmique 9,5), COULIBALY Salimata (Programmation 9 et Statistiques 9), DIABATE Salimata (Mathématiques 8), TOURE Jean-Marc (Programmation 6,8), soit 5 lignes. « Fenêtre ouverte : 5 inscriptions créées, 0 déjà inscrits. » ; la fenêtre apparaît "Du … au …" avec le badge « Ouverte ».

⚠️ *Test d'erreur* : « Fermeture » = `2026-10-05` (avant l'ouverture) → "La fin de la fenêtre précède son début." ; ouvrir une seconde fenêtre sur la même classe et période → "Une fenêtre de rattrapage est déjà ouverte pour cette classe et cette période."

🔒 *Test de droit* : l'enseignant (`enseignant@superieur-test.test`) et le secrétariat tapent `/v2/higher/resit` → "Accès refusé".

☐ OK ☐ KO

---

## Étape 428 — Saisir les notes de session 2 (enseignant)
👤 **enseignant** (superieur-test) `enseignant@superieur-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Mes évaluations »** > **« Nouvelle évaluation »** (`/v2/teacher/assessments/new`)

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type d'évaluation | `Examen` |
| Session | `Session 2 (rattrapage)` |
| Intitulé | `Examen Programmation session 2 test guide` |
| Date de l'évaluation | `2026-10-08` |
| Classe | `Licence 1 A` |
| Cours | `Programmation` |
| Période | `Semestre 1` |

2. Cliquer **« Créer l'évaluation »**, puis **« Saisir les notes »** (badge « Session 2 »).
3. Saisir `14` pour TOURE Jean-Marc et `4` pour COULIBALY Salimata ; laisser les autres vides.
4. Cliquer **« Enregistrer »**, puis **« Soumettre la feuille »**.

✅ « La feuille de notes est soumise. » ; état « Soumise » ; les cellules vides passent à « Non évalué ».

⚠️ *Test d'erreur* : sans fenêtre de rattrapage ouverte, la création est refusée → "La période de cette classe est verrouillée pour cette session."

📚 Chapitre 08, scénario 8.17 (création d'un examen de session 2).

☐ OK ☐ KO

---

## Étape 429 — Relire et approuver la feuille de session 2
👤 **responsable pédagogique** (superieur-test) `pedagogie@superieur-test.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Évaluations »** > feuilles à relire (`/v2/assessments`, filtre « Soumise »)

1. Ouvrir "Examen Programmation session 2 test guide" ; cliquer **« Marquer comme relue »**.
2. Cliquer **« Approuver »**, lire « Approuver cette feuille de notes ? » et confirmer **« Approuver la feuille »**.

✅ « La feuille de notes est relue. » puis « La feuille de notes est approuvée. » ; état « Approuvée » ; ce compte n'a **pas** de bouton « Publier les notes ».

☐ OK ☐ KO

---

## Étape 430 — Publier, clôturer la fenêtre et reclôturer le semestre
👤 **directeur des études** · fenêtre **A** · 📂 Fiche de l'évaluation puis **« Rattrapages »** (`/v2/higher/resit`) puis **« Résultats »** (`/v2/results`)

⚠️ Séquence exacte de clôture *(à vérifier en test)*. Cette étape produit une **version 2** des résultats du semestre 1.

1. Fiche de l'examen : cliquer **« Publier les notes »**, confirmer dans « Publier les notes ? » ("Les notes publiées deviennent immuables…").
2. Dans « Rattrapages », cliquer **« Clôturer la fenêtre »**, cocher « Confirmer la clôture » puis **« Clôturer la fenêtre »**.
3. Dans `/v2/results` (Licence 1 A, Semestre 1) : **« Verrouiller les notes »** puis **« Clôturer la période »** si ces actions sont proposées.
4. Relire la matrice (`/v2/results/matrix`) et **« Pourquoi ? »** de TOURE Jean-Marc, ECUE Programmation.

✅ « Les notes sont publiées. » ; « La fenêtre de rattrapage est clôturée. » (badge « Clôturée ») ; « Période clôturée : N résultats figés (version 2)… ». Attendu : **TOURE Jean-Marc** Programmation = 8×0,4 + 14×0,6 = **11,6** (au lieu de 6,8), UE 1 = 11,8 validée, semestre **Admis**, 12 / 12 crédits. **COULIBALY Salimata** : Programmation passe de 9 à **6,0** (la session 2, plus faible, **remplace** quand même la session 1) ; UE 1 = 10,1 reste validée. La trace de l'ECUE montre `note_examen_retenue` avec la session 2.

☐ OK ☐ KO

---

## Étape 431 — Contrôler les crédits après rattrapage
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Crédits et dettes »** (`/v2/higher/credits`)

1. Choisir **TOURE Jean-Marc**.

✅ 12 crédits acquis ; l'UE 1 porte « Rattrapage » dans la colonne « Acquisition » ; la dette d'UE n'est plus « Ouverte ». **À partir de là, tous les étudiants notés sont éligibles au diplôme** (voir étape *Octroyer le diplôme à deux étudiants*).

☐ OK ☐ KO

---

## Étape 432 — Affecter les signataires datés des documents officiels
👤 **directeur** (superieur-test) · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Signataires datés »** (`/v2/higher/signatories`)

1. Lire les quatre sections : « Diplôme — signature de gauche », « Diplôme — signature de droite », « Attestation de réussite », « Attestation d'authenticité » (« Aucun signataire affecté. »).
2. Pour chacune, cliquer **« Affecter un signataire »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Signataire | `Directeur Fictif — Chef d'établissement` |
| Valide à partir du | `2026-09-01` |
| Valide jusqu'au | *(vide)* |

3. Cliquer **« Affecter »** (quatre fois).

✅ « Le signataire est affecté. » ; ligne "Du 1 septembre 2026 au sans fin" avec le badge « En vigueur » sur les quatre emplacements. Sans ces affectations, toute émission est refusée ("Aucun signataire n'est en vigueur pour l'emplacement …").

⚠️ *Test d'erreur* : « Valide jusqu'au » = `2026-08-01` avec début `2026-09-01` → "La fin de validité précède son début."

🔒 *Test de droit* : le directeur des études tape `/v2/higher/signatories` → "Accès refusé" (réservé à la direction).

☐ OK ☐ KO

---

## Étape 433 — Créer le diplôme TG-LIC-INFO
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Diplômes »** (`/v2/higher/diplomas`)

1. Lire « Aucun diplôme. » puis cliquer **« Nouveau diplôme »**. Dans l'encadré « Cycle du curriculum » : « Programme » = Informatique, « Année académique » = année en cours, « Nœud du curriculum » = "L1 — Licence 1 A".
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code du grade | `LICENCE` |
| Code du diplôme | `TG-LIC-INFO` |
| Intitulé | `Licence Informatique test guide` |
| UV requises | `12` |
| Description | `Diplôme de test guide` |
| Octroi automatique | décochée |

3. Cliquer **« Créer le diplôme »**, puis ouvrir le diplôme (clic sur son intitulé).

✅ « Le diplôme Licence Informatique test guide est créé. » ; ligne `TG-LIC-INFO`, LICENCE, 12, « Manuel », badge « Actif ». Fiche : "TG-LIC-INFO · LICENCE · 12 UV requises (12 listées)", « Exigences » = UE 1 et UE 2 (« Obligatoire », "6 crédits"), « 0 octrois, dont 0 en vigueur. »

⚠️ *Écart connu (probable, **bloquant**)* : le sélecteur « Nœud du curriculum » envoie un identifiant de nœud alors que l'API attend celui du programme ; la création peut être refusée avec "Nœud du curriculum introuvable (…)". Dans ce cas : consigner le message exact, cocher "Bloqué" et **sauter les étapes dépendantes** (octroi, émission, publication, vérification, « Mes documents », révocation) ; ne pas contourner par une requête directe.

⚠️ *Test d'erreur* : « Code du grade » vide → "Code de grade attendu : majuscules, chiffres et _ (2 à 32)." ; recréer le code `TG-LIC-INFO` → "Le code "TG-LIC-INFO" est déjà utilisé."

📚 Modifier, synchroniser, supprimer un diplôme : chapitre 11, scénario 11.8.

☐ OK ☐ KO

---

## Étape 434 — Octroyer le diplôme à deux étudiants
👤 **directeur des études** · fenêtre **A** · 📂 Fiche du diplôme `TG-LIC-INFO` > rubrique « Candidats »

1. Cliquer **« Réévaluer les candidats »**.
2. Lire le tableau « Candidats au diplôme » ; pour DIABATE Nadia, cliquer **« Progression »**.
3. Sur la ligne **DIABATE Nadia** (étudiant A), cliquer **« Octroyer »** puis, dans la fenêtre, **« Octroyer »**.
4. Sur la ligne **TOURE Jean-Marc** (étudiant B), faire de même.
5. Ouvrir la rubrique « Octrois ».

✅ « Recalcul terminé : 8 évalués, 0 octroyés, 0 en échec. » *(nombre à relever)* ; Nadia "12 UV validées sur 12 (100 %)", « Éligible », "Règle CI-HIGHER-LMD, version 1". Message « Diplôme octroyé à DIABATE Nadia (DIP-AAAA-NNNNNN). » (puis "Diplôme octroyé à TOURE Jean-Marc (DIP-AAAA-NNNNNN).") ; badges « Obtenu » et « Octroi manuel », « Crédits » = 12, « Règle appliquée » = `CI-HIGHER-LMD · v1` ; « 2 octrois, dont 2 en vigueur. » Le bouton « Octroyer » disparaît pour ces deux étudiants. La mention reste `PENDING` tant qu'un semestre du cycle manque.

⚠️ *Écart au chapitre 11* : le rattrapage rend TOURE Jean-Marc éligible ; **l'octroi forcé n'est donc plus testable sur lui**. Si le rattrapage n'a pas abouti (Jean-Marc « Non éligible »), le **directeur** (MFA) utilise **« Octroi forcé »** : motif `court` → « Le motif doit faire au moins 20 caractères. », puis `Octroi forcé pour test guide (décision de la direction)` → badge « Octroi forcé ».

🔒 *Test de droit* : sur un candidat « Non éligible », le directeur des études n'a pas « Octroi forcé ».

☐ OK ☐ KO

---

## Étape 435 — Émettre le diplôme, l'attestation d'authenticité et le duplicata
👤 **directeur des études** · fenêtre **A** · 📂 Fiche du diplôme `TG-LIC-INFO` > rubrique « Octrois »

1. Sur la carte de l'octroi de **DIABATE Nadia**, cliquer **« Émettre le diplôme »** ; cliquer de nouveau (idempotent).
2. Cliquer **« Documents émis »** (dépliage), attendre « PDF prêt », puis **« Télécharger le PDF »**.
3. Cliquer **« Attestation d'authenticité »**.
4. Cliquer **« Duplicata »**.
5. Sur la carte de l'octroi de **TOURE Jean-Marc**, cliquer **« Émettre le diplôme »** (document qui sera révoqué à la fin).

✅ « Document émis : DIP-AAAA-NNNNNN. » ; second clic : "Le document existe déjà : …". PDF : nom, référence, deux signatures datées, QR code, **code de vérification (le noter)**. « Document émis : AUTH/AAAA/NNN. » ; duplicata « Document émis : DIP-AAAA-NNNNNN/D1. » (version 2) et l'original passe « Remplacé ».

⚠️ *Écart connu* : le refus faute de signataire cite le nom technique de l'emplacement (`DIPLOMA_LEFT`) ; pendant la préparation le texte « Le PDF est en préparation (scellement puis mise en page). Cette page se met à jour toute seule. » s'affiche.

☐ OK ☐ KO

---

## Étape 436 — Attestation de réussite (facultatif)
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Attestations »** (`/v2/higher/attestations`)

1. Choisir Informatique, l'année en cours et le nœud "L1 — Licence 1 A" ; « Classe (facultatif) » = Licence 1 A.
2. Lire « Étudiants et éligibilité aux attestations » (colonnes « UE » `2 / 2`, « Crédits », « État »).
3. Pour DIABATE Nadia, cliquer **« Émettre »**.

✅ « Attestation émise pour DIABATE Nadia (ATT-AAAA-NNNNNN). » ; la ligne affiche ensuite la référence.

⚠️ *Écart connu (probable)* : même défaut de sélecteur que pour le diplôme ("Programme introuvable (…)") : noter le message et passer.

☐ OK ☐ KO

---

## Étape 437 — Publier les documents (secrétariat)
👤 **secrétariat** (superieur-test) `secretariat@superieur-test.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Documents émis »** (`/v2/higher/documents`)

1. Lire « Documents officiels émis » (filtres « Nature », « État »). Cliquer **« Détail »** sur le diplôme de Nadia : « Référence », « Code de vérification », « Empreinte ».
2. Cliquer **« Publier »** sur le **diplôme** et sur l'**attestation d'authenticité** de DIABATE Nadia (pas sur le duplicata, ni sur les documents de TOURE Jean-Marc).

✅ « Le document DIP-AAAA-NNNNNN est publié. » ; badge « Publié ». Pas de bouton « Révoquer » pour ce compte.

🔒 *Test de droit* : le secrétariat tape `/v2/higher/diplomas` → "Accès refusé" (il n'a pas la permission de lecture des diplômes).

☐ OK ☐ KO

---

## Étape 438 — Vérification publique d'un diplôme
👤 **aucun compte** (page publique) · fenêtre **B** (navigation privée, non connectée) · 📂 `/v2/verify`

1. Saisir le code de vérification du diplôme de DIABATE Nadia dans « Code de vérification » et cliquer **« Vérifier »**.
2. Cliquer « Comparer un fichier PDF » et choisir le PDF téléchargé.

✅ Badge « Authentique », « Document authentique », « Nature du document » = « Diplôme », établissement Université Horizon, « Émis le … ». Aucun nom d'étudiant, aucune note. PDF : « Fichier identique », « Statut du document : Authentique. ».

☐ OK ☐ KO

---

## Étape 439 — « Mes documents » : l'étudiant et le parent
👤 **élève** (étudiant DIABATE Nadia) `eleve@superieur-test.test` puis **parent** (DIABATE Séka) `parent@superieur-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Mes documents »** (`/v2/higher/me/documents`)

1. Étudiant : titre « Mes documents officiels » ; une carte par document **publié** (diplôme et attestation d'authenticité), lien « Page de vérification publique », bouton **« Télécharger le PDF »**.
2. Parent : sections « Documents de DIABATE Nadia » et « Documents de DIABATE Salimata ».

✅ Étudiant : uniquement les 2 documents publiés (ni le duplicata, ni rien de TOURE Jean-Marc). Parent : les mêmes documents pour Nadia ; pour Salimata « Aucun document publié. »

🔒 *Test de droit* : étudiant puis parent tapent `/v2/higher/diplomas`, `/v2/higher/documents`, `/v2/higher/credits` → "Accès refusé".

☐ OK ☐ KO

---

## Étape 440 — ⚠️ Irréversible : révoquer le diplôme de TOURE Jean-Marc
👤 **directeur** (superieur-test) · fenêtre **A** · 📂 Fiche du diplôme `TG-LIC-INFO` > rubrique « Octrois »

⚠️ Irréversible : la révocation est un acte terminal. **Ne jamais révoquer l'octroi de DIABATE Nadia** (les portails famille en dépendent).

1. Sur l'octroi « Obtenu » de **TOURE Jean-Marc**, cliquer **« Révoquer »** (fenêtre « Révoquer le diplôme de TOURE Jean-Marc »).
2. Saisir `court` dans « Motif de la révocation » : refus. Remplacer par `Révocation de test guide (octroi normal)` et valider.
3. Ouvrir `/v2/higher/documents` : le diplôme de TOURE Jean-Marc. Puis, en fenêtre privée, saisir son code sur `/v2/verify`.

✅ « Le diplôme est révoqué. » ; carte "Révoqué par … le … : …" avec le badge « Révoqué » ; le document passe « Révoqué » (« Document révoqué : le PDF n'est plus fourni. ») ; la vérification publique répond « Révoqué » ("Ce document a été révoqué le …"). Dans « Candidats », le bouton devient « Ré-octroyer ». Un second « Révoquer » n'est plus proposé.

⚠️ *Test d'erreur* : motif `court` → « Le motif doit comporter au moins 10 caractères. »

🔒 *Test de droit* : le directeur des études n'a pas le bouton « Révoquer ».

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 11, scénarios 11.3 (cas invalides), 11.4 (cycle de prérequis), 11.5 (politique « Inscrire les crédits de l'UE »), 11.6 (UE annuelles, **à faire après le rattrapage et à retirer aussitôt**), 11.8 (modifier, synchroniser, supprimer un diplôme), 11.10 (octroi forcé et ré-octroi), 11.11 (historique des signataires), 11.13 (révocation d'un document), 11.18 et 11.19 (droits, qualité). Résultats et session 2 : chapitre 09, scénarios 9.17 et 9.18. Admissions de l'université : chapitre 17, scénario 17.29.

**Ce que la phase laisse dans l'application :**
- Semestre 1 de Licence 1 A **reclôturé en version 2** : TOURE Jean-Marc admis (12 / 12, UE 1 acquise par « Rattrapage »), COULIBALY Salimata Programmation à 6,0 ; examen `Examen Programmation session 2 test guide` publié ; fenêtre de rattrapage `2026-10-08` au `2026-10-22` clôturée.
- Dispense de COULIBALY Moussa (UE 2) accordée puis révoquée (motifs `… test guide`) ; durée de validité des crédits remise à vide.
- Quatre emplacements de signature affectés à "Directeur Fictif" dès le `2026-09-01` (non supprimables).
- Diplôme `TG-LIC-INFO` (grade `LICENCE`, "Licence Informatique test guide"), si la création n'a pas été bloquée.
- Octroi manuel à **DIABATE Nadia** (à conserver) : diplôme, attestation d'authenticité (publiés), duplicata `/D1` (non publié), attestation de réussite éventuelle ; octroi à TOURE Jean-Marc **révoqué** avec son document « Révoqué ».

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](22b-primaire-suite.md) · [Suivant →](24-actes-de-fin.md)
