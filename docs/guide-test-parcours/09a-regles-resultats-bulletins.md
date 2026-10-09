[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](08-evaluations-notes.md) · [Suivant →](09b-regles-resultats-bulletins-suite.md)

# Phase 9 — Règles, résultats et bulletins

Le directeur lit les règles de démonstration, on contrôle les résultats de la 6e A (valeurs de référence du Trimestre 1, puis Trimestre 3 provisoire), on utilise une dérogation à deux personnes, puis le Trimestre 3 est délibéré et clôturé. La seconde moitié configure l'identité des documents, contrôle les bulletins, les vérifie publiquement par code, et se termine par la réémission, le retrait et la révocation du seul bulletin de TOURE Jean-Marc.

Précondition : la phase précédente est faite, **sans** avoir touché au Trimestre 1 ni au Trimestre 2 de la 6e A. Les règles de ce guide sont des **règles de démonstration** (fictives), sans valeur officielle. Les PDF exigent le worker de fond (Chrome) : si tous restent « PDF en attente » ou « PDF en échec », arrêter les étapes de bulletins et prévenir l'équipe technique.

---

## Étape 146 — Parcourir le catalogue des règles
👤 **directeur** (secondaire-test) · fenêtre **A** · `directeur@secondaire-test.test` (MFA) · 📂 Menu "RÈGLES DE CALCUL" > "Règles de calcul" (`/v2/rules`)

1. Lire le titre « Règles de calcul ». Taper `PLACEHOLDER` dans « Rechercher un jeu de règles » : restent le primaire, le secondaire et "Examens nationaux" ; vider le champ.
2. Choisir « Origine » = « National », puis « Établissement », puis « Toutes les origines ».
3. Dans la carte "Secondaire — jeu de démonstration (fictif)", lire le code `CI-SECONDARY-PLACEHOLDER`, les badges « National » et « Lecture seule » et le tableau des versions.

✅ 6 jeux nationaux ; le secondaire a « Version 1 » (contrat `coef-semester@1`) et « Version 2 » (contrat `secondary-annual@1`), toutes « Publiée » ; avec « Établissement » : « Aucun jeu de règles. » et « Modifiez la recherche ou le filtre. ».

⚠️ *Test d'erreur* : recherche `zzz` → « Aucun jeu de règles. ».

⚠️ *Écart connu* : aucun bandeau « Règles de démonstration » sur cet écran ; seul le nom "(fictif)" prévient.

☐ OK ☐ KO

---

## Étape 147 — Lire une version et tester une règle
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/rules` > carte du jeu secondaire > **« Ouvrir »** sur la « Version 2 »

1. Lire `CI-SECONDARY-PLACEHOLDER · version 2` et « Version nationale : en lecture seule. Créez une variante de l'établissement pour adapter des paramètres ou des expressions. ».
2. Onglet « Règles » : 11 règles (`moyenne_matiere`, `moyenne_ponderee`, … `rang`). Ouvrir `mention` : paramètres `excellent` 16, `tres_bien` 14, `bien` 12, `assez_bien` 10, `passable` 8.
3. Cliquer **« Valider la version »**.
4. Sur `moyenne_ponderee`, cliquer **« Tester »** ; dans « Variables (JSON) » saisir :
   ```
   {"matieres":[{"score":"12","coef":"3"},{"score":"14","coef":"2"}]}
   ```
   puis **« Évaluer »**. Refaire avec `{"matieres":[{"score":null,"coef":"3"},{"score":"14","coef":"2"}]}`.
5. Sur `mention`, « Tester » avec `{"moyenne":"14"}`, puis `{"moyenne":null}`.

✅ Étape 3 : « La version est valide : toutes les expressions compilent et respectent le contrat. ». Étape 4 : "Valeur : 12.8" (car (12×3 + 14×2) ÷ 5), puis `14` (la matière sans note est **ignorée**, jamais comptée zéro), avec la « Trace d'évaluation ». Étape 5 : `VERY_GOOD` pour 14, `PENDING` sans moyenne.

⚠️ *Test d'erreur* : Variables `abc` ou `[]` → « Saisissez un objet JSON valide. ».

☐ OK ☐ KO

---

## Étape 148 — Liaisons : lire, ajouter, supprimer
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Onglet « Liaisons aux programmes » (`/v2/rules/bindings`)

1. Lire la section du contrat `secondary-annual@1` : `CI-SECONDARY-PLACEHOLDER` pour « Niveau : LOWER_SECONDARY » et « Niveau : UPPER_SECONDARY », badge « En vigueur ». Les autres contrats : « Aucune liaison pour ce contrat. ».
2. Cliquer **« Ajouter une liaison »** et saisir (niveau fictif, sans effet sur la 6e A) :

| Champ | Valeur |
| :--- | :--- |
| Contrat de calcul | `Matières à coefficients (coef-semester@1)` |
| Jeu de règles | `Pile classique — moyennes pondérées, mentions, décisions (CI-CLASSIC-SEMESTRE)` |
| Périmètre | « Un niveau » |
| Code du niveau | `TG-NIVEAU` |
| En vigueur à partir du | `2030-09-01` |
| Jusqu'au (inclus) | *(vide)* |

3. **« Enregistrer »**. Sur la ligne (badge « À venir »), **« Modifier »** : « Jusqu'au (inclus) » = `2030-12-31`, **« Enregistrer »**.
4. **« Supprimer »** puis, dans « Supprimer cette liaison ? », **« Supprimer la liaison »**.

✅ « La liaison est créée. » ; « La liaison est enregistrée. » ; « La liaison est supprimée. » ; les résultats existants ne changent pas.

⚠️ *Test d'erreur* : « Un niveau » sans code → « Saisissez le code du niveau. » ; « En vigueur à partir du » vide → « Date attendue au format AAAA-MM-JJ. ».

⚠️ *Écart connu* : le niveau s'affiche en code brut (`LOWER_SECONDARY`).

☐ OK ☐ KO

---

## Étape 149 — État d'une période clôturée (Trimestre 1)
👤 **directeur des études** (secondaire-test) · fenêtre **A** · `etudes@secondaire-test.test` (MFA) · 📂 Menu "RÉSULTATS" > "Périodes : verrouillage et clôture" (`/v2/results`)

*(« Se déconnecter » du directeur, puis connexion.)*

1. Dans « Classe et période » : « Classe » = `6e A`, « Période » = `Trimestre 1`.
2. Lire « État de la période » : badge « Clôturée », « Règle appliquée » `CI-SECONDARY-PLACEHOLDER · v2`, dates « Notes verrouillées le » et « Clôturée le » (« Délibérée le » vide), puis « Résultats de la classe » et la section « Clôtures ».

✅ « Définitifs » = nombre de résultats figés (9 ou 10), « Provisoires » 0, « En erreur » 0 ; ligne « Version 1 — N résultats figés le `<date>` ». **Aucun** bouton « Verrouiller les notes », « Clôturer la période », « Relancer le calcul » ni « Rouvrir la période ».

⚠️ *Test d'erreur* : sans classe ni période → « Choisissez une classe et une période pour voir son état. ».

⚠️ *Écart connu* : dans « Années et périodes » le Trimestre 1 peut apparaître « Ouverte » (état calendaire), ce qui n'est pas contradictoire.

☐ OK ☐ KO

---

## Étape 150 — Lire la matrice des résultats de la 6e A (Trimestre 1)
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Barre « Résultats » > « Résultats de classe » (`/v2/results/matrix`)

1. Choisir `6e A` et `Trimestre 1` ; lire le badge « Clôturée » et « Règle CI-SECONDARY-PLACEHOLDER v2 — version des résultats 1 ».
2. Comparer le tableau « Résultats des élèves de la classe » (colonnes « Élève », « Moyenne », « Rang », « Mention », « Décision », « État ») aux valeurs de référence :

| Élève | Moyenne | Rang | Mention | Décision |
| :--- | :-: | :-: | :--- | :--- |
| TOURE Yao | 13,5 | 1 | Bien | Periode validee |
| DIABATE Nadia | 13,2 | 2 | Bien | Periode validee |
| COULIBALY Moussa | 12,95 | 3 | Bien | Periode validee |
| BAMBA Fatou | 12,7 | 4 | Bien | Periode validee |
| BAMBA Aya | 12,1 | 5 | Bien | Periode validee |
| DIABATE Salimata | 11,85 | 6 | Assez bien | Periode validee |
| COULIBALY Salimata | 11,6 | 7 | Assez bien | Periode validee |
| TOURE Jean-Marc | 10,5 | 8 | Assez bien | Periode validee |
| ADOU Aïcha, ASSI Brice | — | — | En attente | Notes incompletes |

3. Survoler la moyenne de TOURE Yao : « Valeur exacte : 13,5 ». Passer « Ordre d'affichage » à « Par rang » (TOURE Yao en tête, « 1 sur 8 »).
4. Cocher **« Afficher le détail par cours »** : pour BAMBA Aya, Français 11,25, Mathématiques 11,75, Anglais 12,75, Histoire-Géographie 13,25.
5. Choisir `Trimestre 2` : badge « Notes verrouillées », résultats « Provisoire » avec « Des résultats sont provisoires : ils deviennent officiels à la clôture de la période. ». Moyennes : TOURE Yao 13,9 (rang 1), BAMBA Aya 13,4, COULIBALY Salimata 13,3, TOURE Jean-Marc 12,9, DIABATE Salimata 12,8, BAMBA Fatou 12,4, COULIBALY Moussa 10,4, DIABATE Nadia 9,9. Ne rien modifier sur le Trimestre 2.

✅ Toutes les valeurs correspondent (au zéro final près : `13,2` ou `13,20`) ; badge d'état « Définitif » au Trimestre 1 ; **les moyennes ne sont pas modifiables**. Rang présenté « `<rang>` sur 8 ».

⚠️ *Test d'erreur* : sans sélection → « Choisissez une classe et une période. ».

⚠️ *Écart connu* : libellés de décision sans accents ("Periode validee") ; le menu « Résultats de classe » peut mener à l'écran des périodes et non à la matrice.

☐ OK ☐ KO

---

## Étape 151 — "Pourquoi cette moyenne ?" et résultat annuel
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Matrice du Trimestre 1 > **« Pourquoi ? »** sur la ligne de BAMBA Aya (`/v2/results/<identifiant>/explain`)

1. Lire « Pourquoi ce résultat ? » : « Résultat définitif : trace enregistrée lors de la clôture. », bloc « Résultat » (« Règle appliquée », « Contrat » `secondary-annual@1`, « Empreinte de la règle », « Moyenne »).
2. Déplier la ligne « Période » : étape `moyenne_ponderee` valeur 12.1 ; ouvrir "Contexte de l'appel" (liste `matieres` avec `score` et `coef`) et "Pas de calcul" (`wavg(matieres.score, matieres.coef)`). Cliquer **« Retour aux résultats »**.
3. Sur la même ligne, cliquer **« Année »** (`/v2/results/year/<inscription>/<année>`).

✅ (11,25×3 + 11,75×3 + 12,75×2 + 13,25×2) ÷ 10 = 12,1, identique à la matrice. Résultat annuel : « Résultat incomplet : une ou plusieurs périodes ne sont pas clôturées. » et « Périodes manquantes : Trimestre 2, Trimestre 3. » ; Trimestre 1 « Définitif » (12,1), les autres « Provisoire ».

☐ OK ☐ KO

---

## Étape 152 — Résultats provisoires du Trimestre 3 et relance du calcul
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/results` puis `/v2/results/matrix` (`6e A` / `Trimestre 3`)

Attendre au moins 30 secondes après la publication de la phase précédente.

1. `/v2/results` > `6e A` > `Trimestre 3` : état « Ouverte », « Provisoires » = nombre d'élèves, « Définitifs » 0 ; section « Évaluations non publiées » : "1 évaluation n'est pas encore publiée" (lien "Devoir commun test guide").
2. Cliquer **« Relancer le calcul »** ; « Le calcul est relancé. » ; attendre quelques secondes.
3. Ouvrir la matrice du Trimestre 3 et comparer :

| Élève | Calcul | Moyenne | Rang | Mention | Décision |
| :--- | :--- | :-: | :-: | :--- | :--- |
| DIABATE Nadia | (18×1 + 16×2) ÷ 3 | 16,67 | 1 sur 6 | Excellent | Periode validee |
| COULIBALY Salimata | (16×1 + 15×2) ÷ 3 | 15,33 | 2 | Très bien | Periode validee |
| ADOU Aïcha | 14 | 14 | 3 | Très bien | Periode validee |
| COULIBALY Moussa | (12,5×1 + 12×2) ÷ 3 | 12,17 | 4 | Bien | Periode validee |
| ASSI Brice | 10,5 (après correction) | 10,5 | 5 | Assez bien | Periode validee |
| DIABATE Salimata | (0×1 + 6×2) ÷ 3 | 4 | 6 | Insuffisant | Periode non validee |
| BAMBA Aya, BAMBA Fatou, TOURE Jean-Marc, TOURE Yao | absent / dispensé / non évalué | — | — | En attente | Notes incompletes |

✅ Résultats « Provisoire », badge de période « Ouverte ». Une absence, une dispense, un "non évalué" **ne comptent pas comme zéro** ; seule DIABATE Salimata (vrai `0`) est pénalisée.

⚠️ *Écart connu* : avant la première publication, la page de période peut afficher « État de la période introuvable (…) » ; l'état "SUBMITTED" et les demandes de recalcul s'affichent en code brut ("DONE").

☐ OK ☐ KO

---

## Étape 153 — Demander une surcharge (dérogation)
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Barre « Résultats » > « Surcharges » (`/v2/results/overrides`)

La surcharge est la seule voie manuelle sur un résultat calculé : justifiée, approuvée par **une autre personne**. Les notes ne sont jamais modifiées.

1. Choisir `6e A` et `Trimestre 3`, cliquer **« Demander une surcharge »**.
2. Saisir (attention : « Niveau » vaut par défaut « Unité d'enseignement ») :

| Champ | Valeur |
| :--- | :--- |
| Élève | `COULIBALY Moussa` |
| Niveau | « Période » |
| Cours | *(vide)* |
| Règle ciblée | `moyenne_ponderee` |
| Nature | « Valeur imposée » |
| Valeur imposée | `14,5` |
| Justification | `Erreur de report constatée sur la copie de l'interrogation, valeur corrigée par la direction (test guide)` |

3. Cliquer **« Envoyer la demande »**. Chercher un bouton « Approuver ».
4. Refaire une demande pour DIABATE Salimata : « Niveau » « Période », règle `moyenne_ponderee`, « Valeur imposée » `5`, justification `Essai de rejet par la direction (test guide, valeur de 5)`.

✅ « La demande de surcharge est enregistrée ; elle doit être approuvée par une autre personne. » ; carte « Surcharge pour COULIBALY Moussa » : `moyenne_ponderee`, « Période », « Demandée », `12,17 → 14,5`. Ce compte n'a **pas** de bouton « Approuver », « Rejeter » ni « Révoquer ».

⚠️ *Test d'erreur* : justification de 10 caractères → « Le motif doit faire au moins 20 caractères. » ; valeur imposée vide → "Une surcharge de valeur exige la valeur imposée." ; « Niveau » « Unité d'enseignement » avec `moyenne_ponderee` → refus du serveur *(message à relever)*.

☐ OK ☐ KO

---

## Étape 154 — Approuver, constater, révoquer, rejeter
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Barre « Résultats » > « Surcharges » (`6e A` / `Trimestre 3`)

*(« Se déconnecter » du directeur des études, puis connexion en directeur.)*

1. Sur la carte de COULIBALY Moussa, cliquer **« Approuver »**, commentaire `Vérifié (test guide)`, **« Approuver »**.
2. Attendre 30 secondes, ouvrir la matrice du Trimestre 3 puis **« Pourquoi ? »** sur COULIBALY Moussa.
3. Revenir à « Surcharges », **« Révoquer »** : « Motif de la révocation » = `Retour à la valeur calculée (test guide)`, **« Révoquer »**. Attendre 30 secondes et relire la matrice.
4. Sur la carte de DIABATE Salimata, cliquer **« Rejeter »** : « Motif du rejet » = `Pas de justification suffisante (test guide)`, **« Rejeter »**.

✅ « La surcharge est approuvée. » ; matrice : COULIBALY Moussa 14,5, rang 3 (devant ADOU Aïcha, devenue 4), mention « Très bien » ; « Pourquoi ce résultat ? » indique « Surchargée » et « Valeur imposée par une surcharge approuvée (valeur calculée : 12.16666… ). ». Après révocation (« La surcharge est révoquée. ») : retour à 12,17, Bien, rang 4. « La surcharge est rejetée. » pour Salimata (sa moyenne reste 4).

⚠️ *Test d'erreur* : rejet avec 2 caractères → « Le motif doit comporter au moins 5 caractères. ».

☐ OK ☐ KO

---

## Étape 155 — Décisions : retenir une autre décision avec motif
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Barre « Résultats » > « Décisions et délibérations » (`/v2/results/decisions`)

*(Reconnexion en directeur des études.)*

1. Choisir `6e A`, `Trimestre 1` : onglet « Décisions », tableau « Décisions des élèves » : décisions déjà « Confirmée », sans bouton « Confirmer » (clôture sans délibération).
2. Choisir `Trimestre 3`. Sur DIABATE Salimata, cliquer **« Confirmer »** : « Proposition de la règle : Periode non validee ».
3. Cocher **« Retenir une autre décision »** ; « Décision retenue » = `Renforcement recommande`, « Motif de la décision » = `Élève en progrès constaté sur le dernier devoir (test guide)` ; **« Confirmer la décision »**.

✅ « La décision est confirmée. » ; « Décision retenue » montre le nouveau libellé avec le motif, « Proposée par la règle » **conserve** "Periode non validee".

⚠️ *Test d'erreur* : motif de 10 caractères → « Le motif doit faire au moins 20 caractères. » ; « Retenir une autre décision » sans choix → « Choisissez la décision retenue. ».

⚠️ *Écart connu* : la colonne « Nature » affiche des codes bruts (`COUNCIL`, `YEAR_END`). Si aucune décision n'est « Proposée » : « Aucune décision. » *(à vérifier : les décisions du Trimestre 3 sont proposées dès le calcul)*.

☐ OK ☐ KO

---

## Étape 156 — Délibération tenue et appréciation
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/results/decisions` > onglets « Délibérations » puis « Appréciations » (`6e A` / `Trimestre 3`)

1. Onglet « Délibérations » > **« Planifier une délibération »** : « Nature » = « Conseil de classe », « Date de la séance » = `2026-10-08`, « Participant 1 » = rechercher `TRAORE` (TRAORE Kouadio), « Rôle 1 » = `Président` ; **« Planifier »**.
2. Sur la séance, cliquer **« Marquer comme tenue »**.
3. Onglet « Appréciations » > **« Rédiger une appréciation »** : « Élève » = `DIABATE Nadia`, « Auteur » = « Conseil de classe », « Appréciation » = `Excellent travail, à poursuivre (test guide)` ; **« Enregistrer l'appréciation »**.

✅ « La délibération est planifiée. » (badge « Planifiée ») ; « La séance est marquée comme tenue. » (badge « Tenue ») ; « L'appréciation est enregistrée. » et ligne "DIABATE Nadia · Conseil de classe".

⚠️ *Test d'erreur* : appréciation vide → « Ce champ est obligatoire. ».

☐ OK ☐ KO

---

## Étape 157 — Verrouiller les notes du Trimestre 3 : refus, puis forçage motivé
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/results` > `6e A` > `Trimestre 3`

Le "Devoir commun test guide" (Français) est toujours « Soumise ». Le verrouillage fige les saisies de la période.

1. Cliquer **« Verrouiller les notes »** : la fenêtre signale « 1 évaluation n'est pas publiée : leurs notes ne seront pas prises en compte. ». Sans cocher la case, cliquer **« Verrouiller »**.
2. Cocher **« Verrouiller malgré les évaluations non publiées »**, « Motif du verrouillage forcé » = `Court`, **« Verrouiller »**.
3. Saisir `Évaluation de test non finalisée (test guide)` et **« Verrouiller »**.

✅ Étape 1 : "Des évaluations de cette classe et de cette période ne sont pas publiées : publiez-les ou forcez le verrouillage avec un motif." Étape 2 : « Le motif doit faire au moins 10 caractères. ». Étape 3 : « Les notes de la période sont verrouillées. », état « Notes verrouillées » ; les actions proposées sont « Enregistrer la délibération », « Clôturer la période » et « Relancer le calcul ».

☐ OK ☐ KO

---

## Étape 158 — ⚠️ Irréversible : délibérer et clôturer le Trimestre 3
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/results` > `6e A` > `Trimestre 3`

Les résultats deviennent définitifs ; seule la réouverture motivée (étape suivante) les change.

1. Cliquer **« Enregistrer la délibération »**, cocher « Confirmer d'un coup les décisions proposées par les règles », cliquer **« Enregistrer la délibération »**.
2. Cliquer **« Clôturer la période »** : lire « Les résultats deviennent définitifs. Pour les corriger plus tard, il faudra rouvrir la période avec un motif (nouvelle version des résultats). », cliquer **« Clôturer »**.
3. Ouvrir la matrice du Trimestre 3.

✅ « La délibération est enregistrée. », état « Délibérée » ; « Période clôturée : N résultats figés (version 1), aucune exclusion. » ; état « Clôturée », section « Clôtures » « Version 1 — N résultats figés le `<date>` » ; matrice « Définitif », mêmes valeurs que le tableau du Trimestre 3. Plus de bouton « Relancer le calcul ». « Année » de BAMBA Aya : « Périodes manquantes : Trimestre 2. ».

⚠️ *Test d'erreur* : toute nouvelle surcharge sur ce trimestre → "La période est clôturée : rouvrez-la pour surcharger un résultat."

☐ OK ☐ KO

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](08-evaluations-notes.md) · [Suivant →](09b-regles-resultats-bulletins-suite.md)
