[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](21-accessibilite-mobile.md) · [Suivant →](22b-primaire-suite.md)

# Phase 22 — École Les Palmiers (primaire) : compétences, conseil des maîtres, bilan annuel

Objectif : suivre une classe de primaire (CP1 A) et une classe de maternelle (Grande Section A) de l'appel du jour jusqu'au bilan annuel scellé, sans note chiffrée pour les compétences. Précondition : base de départ de `pnpm dev:v2:seed` ; cette phase est indépendante du collège (établissement **École Les Palmiers**, `primaire-test`) et peut se jouer seule. Les règles du pack sont des **règles de démonstration** (bandeau « Règles de démonstration » sur chaque écran) : n'en tirer aucune conclusion réglementaire. Les gestes irréversibles (signature, scellement, réémission) sont en fin de phase.

Rappel des classes de départ : **CP1 A** (8 élèves : DIABATE Nadia, DIABATE Salimata, BAMBA Aya, BAMBA Fatou, COULIBALY Moussa, COULIBALY Salimata, TOURE Yao, TOURE Jean-Marc ; titulaire TRAORE Kouadio ; semestre 1 clôturé, **aucune compétence saisie**) et **Grande Section A** (5 enfants : ADOU Aïcha, ASSI Brice, DAGO Chantal, EKRA Désiré, FOFANA Estelle ; titulaire ZOKORA Sylvie ; deux semestres clos, conseil tenu, 5 bilans dont 3 scellés).

## Étape 396 — Lire les 5 inscrits de la maternelle dans les admissions
👤 **chargé d'admissions** (primaire-test) `admissions@primaire-test.test` (pas de MFA) · fenêtre **A** · 📂 Menu **« Admissions »** (`/v2/admissions`)

1. Lire le titre « Pipeline des candidatures » et choisir la campagne `RENTREE-MATERNELLE` dans « Campagne d'admission ».
2. Regarder la colonne « Inscrit ».

✅ 13 dossiers au total, dont **5 inscrits** : ADOU Aïcha, ASSI Brice, DAGO Chantal, EKRA Désiré, FOFANA Estelle (ce sont les 5 enfants de la Grande Section A). Autres colonnes : Fabrice GUEI « Inscription en attente de paiement », Grâce HIEN « Admis », Lazare OKOU « Refusé »… *(détail à relever en test)*.

☐ OK ☐ KO

---

## Étape 397 — Avancement des classes (direction)
👤 **directeur** (primaire-test) `directeur@primaire-test.test` (**MFA** : le code du moment est proposé sur la page de connexion) · fenêtre **A** · 📂 Menu **« Pack Primaire »** (`/v2/primary/direction`)

1. Lire le titre « Avancement des classes » et le bandeau « Règles de démonstration ».
2. Barre « Accès rapides » : « Conseil des maîtres », « Bilans annuels », « Archives », « États », « Paramètres » (les cinq).
3. Lire le tableau « Avancement par classe et par période ».

✅ Quatre lignes (N = effectif du CP1 A = 8) :

| Classe | Période | État | Saisies / Validées | Bilans scellés | Période |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CP1 A | semestre 1 | « Rien de saisi » (rouge) | `0 sur 8` / `0 sur 8` | `0 sur 0` | « Verrouillée » |
| CP1 A | semestre 2 | « Rien de saisi » | `0 sur 8` / `0 sur 8` | `0 sur 0` | « Ouverte » *(à vérifier)* |
| Grande Section A | semestre 1 | « En cours » (orange) | `14 sur 15` / `14 sur 15` | `3 sur 5` | « Verrouillée » |
| Grande Section A | semestre 2 | « En cours » (orange) | `14 sur 15` / `14 sur 15` | `3 sur 5` | « Verrouillée » |

La règle d'affichage est lue au bas : « Rouge : rien n'est saisi. Vert : tout est saisi et validé, et les bilans existants sont scellés. Orange : le reste. Règle d'affichage, sans valeur réglementaire. »

⚠️ *Écart connu* : la Grande Section reste orange (« En cours ») parce qu'une compétence de FOFANA Estelle n'a jamais été évaluée.

🔒 *Test de droit* : connecté plus tard en instituteur, taper `/v2/primary/direction` → "Accès refusé".

☐ OK ☐ KO

---

## Étape 398 — Ma classe de la maternelle et appel du jour (Grande Section A)
👤 **instituteur de maternelle** (primaire-test) `instituteur.maternelle@primaire-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Ma classe »** (`/v2/primary/classe`)

1. Lire la phrase « Vos classes, leurs périodes et les gestes du quotidien : appel du jour, compétences, conseil. » : une seule carte **Grande Section A**, "5 élèves", pastille « Titulaire », les deux semestres « verrouillée ». **Ne pas utiliser « Marquer … prête » sur cette classe.**
2. Cliquer **« Appel du jour »** sur la carte. Deux cas selon l'âge de la base :
   - **Base créée aujourd'hui (jeudi 8 octobre 2026)** : l'appel de la graine existe (ASSI Brice absent, DAGO Chantal en retard de 10 minutes) et il est validé : lecture seule.
   - **Base plus ancienne** : un nouvel appel s'ouvre. Toucher la ligne **« Marquer EKRA Désiré absent »** (compteur « 4 présents · 1 absents »), puis cliquer **« Transmettre l'appel »**.
3. Cliquer **« Fermer l'appel »**.

✅ Nouvel appel : « Appel transmis : 1 absent. » ; en rouvrant : « L'appel du jour est déjà transmis : vous pouvez encore corriger un élève. » (« Marquer EKRA Désiré présent » puis « Enregistrer les corrections » → « Corrections enregistrées. »). Appel de la graine : aucune modification possible.

⚠️ *Test d'erreur* : sur l'appel déjà validé, tenter de corriger un élève → « L'appel de ce jour ne peut plus être modifié (validé, annulé ou délai de correction dépassé). »

📚 Variante maternelle : un seul appel par jour ; l'appel du matin est refusé ("La politique d'appel de ce cycle prévoit un seul appel par jour…") : chapitre 06, scénarios 6.10 et 6.11.

☐ OK ☐ KO

---

## Étape 399 — Ma classe du CP1 A et appels du matin et de l'après-midi
👤 **instituteur CP1 A** (primaire-test) `enseignant@primaire-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Ma classe »** (`/v2/primary/classe`) puis **« Mes appels »** (`/v2/teacher/attendance`)

1. Sur « Ma classe » : une seule carte **CP1 A**, code `CP1`, pastille d'effectif (8 élèves), pastille « Titulaire ». Sous « Périodes » : le semestre 1 avec « verrouillée », le semestre 2 avec « ouverte » *(à vérifier)* ; chaque période a son bouton « Marquer … prête ». Boutons de la carte : « Appel du jour », « Compétences », « Conseil ».
2. Ouvrir **« Mes appels »** : rubrique « Appel de la journée », deux lignes pour le CP1 A : « Matin » avec **« Appel du matin »** et « Après-midi » avec **« Appel de l'après-midi »**.
3. Cliquer « Appel du matin », marquer **BAMBA Fatou** « Absent », soumettre. Revenir à « Mes appels » : la ligne « Matin » porte « Appel soumis ».
4. Cliquer « Appel de l'après-midi », tout le monde présent, soumettre. Rouvrir « Appel du matin » : c'est le **même** appel (pas de doublon).

✅ Deux appels distincts par jour et par classe (type "Journalier · Matin" et "Journalier · Après-midi"), aucune notion de séance.

⚠️ *Écart connu* : si la base est antérieure à la décision Q-P17, « Mes appels » propose un seul « Appel du jour » au lieu des deux demi-journées : le noter. Le bouton « Appel du jour » de la carte « Ma classe » du CP1 A peut être refusé par la politique d'appel (deux appels par jour) *(à vérifier)*.

🔒 *Test de droit* : en instituteur, taper `/v2/primary/etats` → "Accès refusé".

☐ OK ☐ KO

---

## Étape 400 — Valider les appels du jour
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Présences »** > **« Suivi des appels »** (`/v2/attendance/sessions`)

1. Régler le filtre « Du » sur le 1er septembre si besoin. Repérer les appels « Soumis » (CP1 A matin et après-midi, éventuellement Grande Section A).
2. Cliquer **« Valider »** sur chacun (aucune fenêtre de confirmation).

✅ « Appel validé. » ; l'état passe à « Validé ». L'instituteur ne valide jamais ses propres appels.

📚 Détail : chapitre 06, scénarios 6.5, 6.9 à 6.11.

☐ OK ☐ KO

---

## Étape 401 — Lire la grille de compétences de la maternelle (aucune note)
👤 **instituteur de maternelle** · fenêtre **B** · 📂 Menu **« Compétences »** (`/v2/primary/competences`)

1. Lire la phrase « Évaluez le niveau de maîtrise de chaque compétence, par élève et par période. Une compétence non saisie reste « non évaluée ». ». La classe Grande Section A est présélectionnée ; choisir la période du **semestre 1** (libellé "Semestre 1 (verrouillée)").
2. Bandeau : « La saisie est arrêtée pour cette classe et cette période : la grille est en lecture seule. » ; référentiel « Compétences de la maternelle (démonstration) ».
3. Vue « Fiche élève », élève **ADOU Aïcha** : boutons désactivés ; `Compétence 1.1 (démonstration)` au niveau N4 avec la pastille « Validée ».
4. Élève **FOFANA Estelle** : « 2 sur 3 compétences renseignées · élève 5 sur 5 » ; pour `Compétence 2.1 (démonstration)` aucun niveau n'est sélectionné, pastille « Non évaluée » (jamais zéro).
5. Lire « Complétude de la saisie » puis cliquer **« Tableau »**.

✅ « 14 sur 15 compétences renseignées · aucune saisie en attente · 14 validées » ; dans le tableau, la cellule de FOFANA Estelle pour `D2.1` indique « Non évaluée ». Aucun chiffre, aucune moyenne, aucun pourcentage. Les boutons « Valider la grille » et « Enregistrer » sont inactifs ou absents.

☐ OK ☐ KO

---

## Étape 402 — Saisir les compétences du CP1 A (brouillon, sans note)
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Compétences »** (`/v2/primary/competences`)

Précondition : période du semestre 2 saisissable. Si elle s'affiche "(verrouillée)" ou si l'enregistrement est refusé, demander à la direction de l'ouvrir (`/v2/academic/years`) et noter le constat.

1. Classe **CP1 A** présélectionnée, choisir la période du **semestre 2**. Référentiel « Compétences du primaire (démonstration) » ; compteur "0 sur 8 compétences renseignées".
2. Vue « Fiche élève », élève **DIABATE Nadia** : pour `Compétence 1.1 (démonstration)` cliquer **"N3 Acquis"** (pastille « À enregistrer », "1 saisie en attente").
3. Élève suivant **DIABATE Salimata** : "N2 En cours d'acquisition" ; puis **BAMBA Aya** : "N4 Acquis avec aisance". Laisser les 5 autres élèves **sans saisie**.
4. Cliquer **« Enregistrer »**.

✅ « Enregistré le … » ; pastilles « Enregistrée » ; compteur "3 sur 8 compétences renseignées". Les 5 autres restent « Non évaluée ».

⚠️ *Test d'erreur* : choisir la période du semestre 1 → « La saisie est arrêtée pour cette classe et cette période : la grille est en lecture seule. »

🔒 *Test de droit* : le secrétariat (`secretariat@primaire-test.test`, MFA) ouvre la grille en lecture seule : « Vous pouvez consulter la grille, mais pas la modifier. »

📚 Cas fins (annuler une saisie, « Tous au niveau… sauf », conflit de deux onglets, hors ligne) : chapitre 18, scénario 18.6.

☐ OK ☐ KO

---

## Étape 403 — Marquer la période "prête" (gel de la saisie)
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Ma classe »** (`/v2/primary/classe`)

1. Cliquer **« Marquer … prête »** à côté du semestre 2. Dans la fenêtre « Marquer … prête ? » ("Les parents et les élèves verront les compétences saisies et le rang provisoire de cette période. La saisie sera gelée tant que le marquage n'est pas retiré. …"), cliquer **« Marquer prête »**.
2. Retourner dans « Compétences » (semestre 2), changer le niveau d'un élève en brouillon et cliquer « Enregistrer ». Recharger ensuite la page pour abandonner cette saisie refusée.

✅ Message « … : marquée prête, les familles voient désormais les compétences et le rang provisoire. » ; badge « Prête pour les familles ». Étape 2 : refus "La classe et la période sont marquées prêtes : retirer le marquage avant de modifier la saisie." (la saisie reste affichée).

☐ OK ☐ KO

---

## Étape 404 — Ce que voit le parent d'une période "prête"
👤 **parent** (primaire-test) `parent@primaire-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Bulletin et compétences »** (`/v2/primary/mon-enfant`)

1. Dans « Enfant », choisir **DIABATE Nadia — CP1 A**.
2. Lire la section « Compétences des périodes prêtes ou validées ».

✅ Un compteur par domaine et par niveau ("Acquis" : 1 pour Nadia) ; aucune moyenne. Section « Bilans annuels » : « Aucun bilan annuel publié pour le moment. »

☐ OK ☐ KO

---

## Étape 405 — Retirer le marquage "prête" (avec motif)
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Ma classe »** (`/v2/primary/classe`)

1. Cliquer **« Retirer le marquage de … »** (semestre 2).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Motif du retrait | `court` |

3. Cliquer « Retirer le marquage » : refus. Remplacer par `Erreur de marquage constatée (test guide)` et cliquer **« Retirer le marquage »**.

✅ « … : marquage retiré, les familles ne voient plus que les périodes validées ou publiées. » ; le badge disparaît ; côté parent le bloc de compétences est de nouveau vide.

⚠️ *Test d'erreur* : motif `court` → « Au moins 10 caractères. »

☐ OK ☐ KO

---

## Étape 406 — Valider la grille du CP1 A
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Compétences »** (`/v2/primary/competences`, CP1 A, semestre 2)

1. Cliquer **« Valider la grille »** (actif seulement sans saisie en attente).
2. Lire la fenêtre « Valider la grille de compétences » : « Les compétences saisies seront figées : seule une révision motivée pourra ensuite les corriger. » et "5 compétences restent non évaluées : elles le resteront." Confirmer **« Valider la grille »**.

✅ « Grille validée : 3 compétences validées, 5 restées non évaluées. » ; les trois cases passent à « Validée » ; les 5 autres élèves restent « Non évaluée ». Aucun bouton « Réviser » pour l'instituteur.

☐ OK ☐ KO

---

## Étape 407 — Réviser une compétence validée (direction)
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Compétences »** (`/v2/primary/competences`, CP1 A, semestre 2)

1. Sur la case validée de **DIABATE Nadia**, cliquer **« Réviser »** (fenêtre « Réviser une compétence validée »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nouveau niveau | `N4 — Acquis avec aisance` |
| Motif de la révision | `Correction après relecture du cahier de classe (test guide)` |

3. Cliquer **« Réviser »**, puis rouvrir « Réviser » pour lire l'historique.

✅ La case affiche N4 ; « Historique des révisions » : "N3 vers N4 le … : Correction après relecture du cahier de classe (test guide)". Acte sensible tracé, réservé à la direction.

⚠️ *Test d'erreur* : motif de moins de 10 caractères → "Le motif compte au moins 10 caractères."

⚠️ *Écart connu* : sur la Grande Section A (périodes closes) le bouton « Réviser » n'est pas proposé : c'est normal.

☐ OK ☐ KO

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](21-accessibilite-mobile.md) · [Suivant →](22b-primaire-suite.md)
