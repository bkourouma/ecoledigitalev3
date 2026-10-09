[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](07-appel-presences.md) · [Suivant →](09a-regles-resultats-bulletins.md)

# Phase 8 — Évaluations et notes

Le professeur crée et saisit les notes de Mathématiques de la 6e A au Trimestre 3, puis le circuit à quatre yeux (relecture, approbation, publication) les fait publier ; une note publiée est ensuite corrigée par une demande approuvée, et l'élève ne voit que ce qui est publié. Les moyennes, rangs et mentions ne se calculent pas ici : c'est la phase suivante.

Précondition : les phases de structure sont faites (6e A, ses 8 élèves de la graine, TRAORE Kouadio affecté aux quatre matières, Trimestre 3 « Planifié » mais **non verrouillé**). La date à saisir partout est celle du jour du test : `2026-10-08`. Si des phases précédentes ont ajouté des élèves à la 6e A (par exemple KOUASSI Aïcha test guide), la feuille de notes compte quelques lignes de plus : les laisser **vides**, les totaux "sur N élèves notés" s'adaptent.

---

## Étape 128 — Lire les évaluations de la graine
👤 **directeur des études** (secondaire-test) · fenêtre **A** · `etudes@secondaire-test.test` (MFA) · 📂 Barre « Évaluations et notes » > « Évaluations » (`/v2/assessments`)

Attendu au départ : 12 évaluations, toutes « Publiée » (4 "Composition", 4 "Devoir de la période 2", 2 "Premier contrôle", 2 "Premier contrôle (suite)").

1. Lire le titre « Évaluations » et le formulaire « Filtres » (« Classe », « Période », « État », case « Seulement mes évaluations »).
2. Choisir « Classe » = `6e A`, puis « Période » = `Trimestre 2` : 4 lignes ("Devoir de la période 2").
3. Remettre « Période » sur toutes, choisir « État » = « Soumise ».
4. Rouvrir « État » = « Publiée » et cliquer le titre de la "Composition" de Français ; cliquer **« Voir les notes »**.

✅ Étape 3 : état vide « Aucune évaluation. » et « Créez une évaluation ou modifiez les filtres. ». Étape 4 : la fiche montre le badge « Publiée », la barre « Circuit de validation » et « Historique du circuit de validation » ; la feuille compte **8 notes sur 20**, aucune cellule modifiable, et le message "Notes publiées : elles ne se modifient plus. Utilisez « Corriger » pour demander une correction motivée."

⚠️ *Test d'erreur* : ouvrir `/v2/assessments/00000000-0000-4000-8000-000000000000` → erreur "Évaluation introuvable (00000000-0000-4000-8000-000000000000)." *(message à relever)*.

⚠️ *Écart connu* : le barème peut s'afficher « Sur 20,000 » au lieu de « Sur 20 » ; c'est cosmétique.

☐ OK ☐ KO

---

## Étape 129 — Types d'évaluation : lecture seule
👤 **responsable pédagogique** (secondaire-test) · fenêtre **A** · `pedagogie@secondaire-test.test` (MFA) · 📂 Barre « Évaluations et notes » > « Types d'évaluation » (`/v2/assessments/types`)

*(« Se déconnecter » du directeur des études, puis connexion.)*

1. Lire le tableau « Types d'évaluation » : "Devoir" (code `DEVOIR`, `CONTINUOUS`, "/20", « Publication manuelle »), "Composition" (`COMPOSITION`, `EXAM`), « Examen blanc » avec le badge « Masqué aux élèves ». Chaque type porte le badge « Modèle ».
2. Lire la rubrique « Réglages de la saisie » : « Le relecteur doit être une autre personne que le saisissant » (cochée), « L'approbateur doit être une autre personne que le relecteur » (cochée), « Décimales autorisées » (2).

✅ 9 types ; **aucun** bouton « Nouveau type » ni « Modifier » ; cases et liste grisées, note « Vous pouvez consulter ces réglages mais pas les modifier. ».

⚠️ *Écart connu* : le libellé « L'approbateur doit être une autre personne que le relecteur » est trompeur : le serveur ne compare que la personne qui a **soumis** (voir l'étape *Approuver les feuilles de Mathématiques*).

☐ OK ☐ KO

---

## Étape 130 — Créer, désactiver un type d'évaluation
👤 **directeur** (secondaire-test) · fenêtre **A** · `directeur@secondaire-test.test` (MFA) · 📂 Barre « Évaluations et notes » > « Types d'évaluation » (`/v2/assessments/types`)

1. Cliquer **« Nouveau type »** ; la fenêtre « Créer un type d'évaluation » s'ouvre.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_QUIZ` |
| Libellé | `Quiz test guide` |
| Groupe d'agrégation | `CONTINUOUS` |
| Barème par défaut | `10` |
| Coefficient par défaut | `1` |
| Mode de publication | « Publication manuelle » |
| Visible des élèves et des parents | cochée |

3. Cliquer **« Créer le type »**.
4. Sur la ligne "Quiz test guide" : **« Modifier »** (le code est grisé), « Barème par défaut » = `15`, **« Enregistrer »**.
5. Cliquer **« Désactiver »**, puis **« Activer »**, puis de nouveau **« Désactiver »**.
6. Ne pas toucher aux « Réglages de la saisie » (si vous modifiez « Décimales autorisées », remettre `2`).

✅ « Le type Quiz test guide est enregistré. » ; ligne `TG_QUIZ`, « Barème » "/10" puis "/15" ; messages « Le type Quiz test guide est désactivé. » / « Le type Quiz test guide est activé. » ; état final inactif ; valeurs conservées après F5.

⚠️ *Test d'erreur* : Code `tg quiz` → "Code attendu : majuscules, chiffres et _ (2 à 32 caractères)." ; Libellé vide → « Ce champ est obligatoire. ».

☐ OK ☐ KO

---

## Étape 131 — Créer le Devoir n°1 de Mathématiques
👤 **enseignant** (secondaire-test) · fenêtre **B** · `enseignant@secondaire-test.test` (TRAORE Kouadio, pas de MFA) · 📂 Menu "Mes évaluations" (`/v2/teacher/assessments`) > **« Nouvelle évaluation »** (`/v2/teacher/assessments/new`)

*(Première connexion de la phase : fenêtre privée, page `/v2/login`, clic sur le compte.)*

Attendu au départ : « Mes évaluations » liste les 12 évaluations de la graine, toutes « Publiée » (attendre la fin du chargement).

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type d'évaluation | `Devoir` (l'aide du barème dit « Par défaut : 20 ») |
| Intitulé | `Devoir n°1 Mathématiques test guide` |
| Date de l'évaluation | `2026-10-08` |
| Barème (sur) | *(vide : reprend celui du type)* |
| Coefficient | *(vide)* |
| Classe | `6e A` |
| Cours | `Mathématiques` |
| Période | `Trimestre 3` |

2. Cliquer **« Créer l'évaluation »**.

✅ Page « Évaluation créée », message "1 évaluation créée.", boutons « Saisir les notes » et « Créer une autre évaluation ».

⚠️ *Test d'erreur* : tout vide puis « Créer l'évaluation » → "Choix invalide." sous « Type d'évaluation », « Classe », « Cours », « Période » et « Ce champ est obligatoire. » sous « Intitulé » ; Période `Trimestre 2` → "La période de cette classe est verrouillée pour cette session."

⚠️ *Écart connu* : « Barème (sur) » et « Coefficient » refusent la virgule (`12,5` → "Valeur décimale attendue (3 décimales au plus).") alors que la grille de notes l'accepte ; un faux message "Aucune classe ne vous est affectée…" peut clignoter pendant le chargement.

☐ OK ☐ KO

---

## Étape 132 — Créer l'interrogation de Mathématiques
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Page « Évaluation créée » > **« Créer une autre évaluation »**

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type d'évaluation | `Interrogation` |
| Intitulé | `Interrogation Mathématiques test guide` |
| Date de l'évaluation | `2026-10-08` |
| Barème (sur) | `10` |
| Coefficient | `2` |
| Classe / Cours / Période | `6e A` / `Mathématiques` / `Trimestre 3` |

2. Cliquer **« Créer l'évaluation »**, puis ouvrir « Mes évaluations ».

✅ Les deux évaluations sont « Brouillon » ; sur la fiche de l'interrogation : « Barème » `10` (ou `10,000`), « Coefficient » `2`, « Session » « Session 1 » ; l'historique n'a qu'une ligne « Brouillon ».

☐ OK ☐ KO

---

## Étape 133 — Créer le "Devoir commun" pour deux cours à la fois
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu "Mes évaluations" > **« Nouvelle évaluation »**

1. Saisir « Type d'évaluation » = `Devoir`, « Intitulé » = `Devoir commun test guide`, « Date de l'évaluation » = `2026-10-08`.
2. Cocher **« Créer pour plusieurs classes à la fois »** : le groupe « Classes et cours » remplace les champs simples.
3. Ligne 1 : « Classe 1 » = `6e A`, « Cours 1 » = `Français`. Cliquer **« Ajouter une classe »** : « Classe 2 » = `6e A`, « Cours 2 » = `Anglais`.
4. « Période » = `Trimestre 3`, puis **« Créer l'évaluation »**.

✅ Message "2 évaluations créées." avec deux lignes "Devoir commun test guide" ; dans « Mes évaluations » la colonne « Matière » distingue Français et Anglais, les deux en « Brouillon ».

☐ OK ☐ KO

---

## Étape 134 — Saisir les notes du Devoir n°1 (codes, zéro, virgule, point)
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Devoir n°1 Mathématiques test guide" > **« Saisir les notes »**

Attendu au départ : badge « Brouillon », badge « Sur 20 », progression « 0 sur 10 élèves notés », « Aucune modification en attente. ». Le panneau « Aide à la saisie » rappelle les codes ABS, ABJ, DISP, NN.

1. Saisir dans la colonne « Note (sur 20) », **Entrée** passant à l'élève suivant :

| Élève | À saisir | État obtenu |
| :--- | :--- | :--- |
| ADOU Aïcha | `14` | Noté |
| ASSI Brice | `9,5` | Noté |
| BAMBA Aya | `ABS` | Absent non justifié |
| BAMBA Fatou | `ABJ` | Absent justifié |
| COULIBALY Moussa | `12,5` (essayer aussi `12.5` : accepté) | Noté |
| COULIBALY Salimata | `16` | Noté |
| DIABATE Nadia | `18` | Noté |
| DIABATE Salimata | `0` (vrai zéro) | Noté |
| TOURE Jean-Marc | `DISP` | Dispensé |
| TOURE Yao | *(laisser vide)* | |

2. Pour DIABATE Nadia, saisir le commentaire `Copie rendue en retard` (colonne « Commentaire »).
3. Attendre environ 6 secondes (enregistrement automatique) ou cliquer **« Enregistrer »** (Ctrl + S). Recharger avec F5.

✅ Progression « 6 sur 10 élèves notés · 2 absents · 1 dispensé » ; message « Enregistré à `<heure>` — 9 créée(s), 0 modifiée(s), 0 inchangée(s). » (TOURE Yao, vide, n'est pas écrit) ; chaque ligne « Enregistrée » ; après F5 tout est identique et le `0` de DIABATE Salimata reste un zéro, distinct d'une absence.

⚠️ *Test d'erreur* : `21` → « La note dépasse le barème (20,000). » (ou "(20)") ; `abc` → « Saisissez un nombre (par exemple 12,5) ou un code : ABS, ABJ, DISP, NN. » ; `12,255` → « Au plus 2 décimale(s). ». Tant qu'une ligne est invalide : "1 ligne invalide à corriger" et **rien n'est enregistré**. Effacer la saisie invalide.

☐ OK ☐ KO

---

## Étape 135 — Saisir l'interrogation sur 10 (bornes du barème)
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Interrogation Mathématiques test guide" > **« Saisir les notes »**

1. Vérifier le badge « Sur 10 » et la colonne « Note (sur 10) ».
2. Saisir `11` pour DIABATE Nadia : « La note dépasse le barème (10,000). » ; corriger en `8`.
3. Saisir `7,5` pour COULIBALY Salimata, `3` pour DIABATE Salimata, `6` pour COULIBALY Moussa ; les autres restent vides.
4. Cliquer **« Enregistrer »**.

✅ « 4 sur 10 élèves notés » ; « Enregistré à `<heure>` — 4 créée(s), 0 modifiée(s), 0 inchangée(s). ».

⚠️ *Test d'erreur* : `10,01` → « La note dépasse le barème (10,000). » ; `10` (note maximale) est accepté. Remettre `8` avant d'enregistrer.

☐ OK ☐ KO

---

## Étape 136 — Feuille vide refusée, annuler un doublon
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Devoir commun test guide" de l'**Anglais** > « Saisir les notes »

1. Sans rien saisir, cliquer **« Soumettre la feuille »**.
2. Cliquer **« Annuler l'évaluation »** ; dans la fenêtre du même nom, « Motif de l'annulation » = `Doublon, feuille créée par erreur (test guide)`, puis **« Annuler l'évaluation »**.

✅ Étape 1 : "Une évaluation sans aucune note ne peut pas être soumise." (reste « Brouillon »). Étape 2 : « L'évaluation est annulée. », badge « Annulée », feuille non modifiable.

⚠️ *Test d'erreur* : motif `abc` → « Le motif doit comporter au moins 10 caractères. ».

☐ OK ☐ KO

---

## Étape 137 — Saisir et soumettre les trois feuilles
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations »

1. "Devoir commun test guide" (**Français**) > « Saisir les notes » : `11` pour ADOU Aïcha, `13` pour COULIBALY Moussa, `9,5` pour TOURE Yao ; **« Enregistrer »** ; **« Soumettre la feuille »**.
2. "Devoir n°1 Mathématiques test guide" > **« Soumettre la feuille »**.
3. "Interrogation Mathématiques test guide" > **« Soumettre la feuille »**.
4. Revenir sur la feuille du Devoir n°1.

✅ « La feuille de notes est soumise. » ; état « Soumise » ; message « La feuille est soumise au circuit de validation : elle n'est plus modifiable. » ; cellules en lecture seule. Les élèves restés vides passent à « Non évalué » (TOURE Yao au devoir n°1 ; les 6 autres à l'interrogation). L'historique gagne "Brouillon → Soumise".

⚠️ *Écart connu* : un double-clic sur « Soumettre la feuille » affiche "L'évaluation a été modifiée entre-temps : rechargez-la." alors que la première requête a réussi.

☐ OK ☐ KO

---

## Étape 138 — Relire : renvoyer en brouillon, marquer comme relue
👤 **responsable pédagogique** (secondaire-test) · fenêtre **A** · `pedagogie@secondaire-test.test` (MFA) · 📂 Menu "ÉVALUATIONS" > "Feuilles à relire" (`/v2/assessments?status=SUBMITTED`)

1. Lire la liste (filtrée sur « Soumise ») : 3 lignes, les deux évaluations de Mathématiques et "Devoir commun test guide" (Français).
2. Ouvrir "Devoir commun test guide" (Français) ; le compte voit « Voir les notes », pas « Saisir les notes ». Cliquer **« Renvoyer en brouillon »**.
3. Saisir « Commentaire » = `ok` puis valider.
4. Saisir « Commentaire » = `Barème à revoir pour l'exercice 3 (test guide)` puis valider.
5. Ouvrir "Devoir n°1 Mathématiques test guide", cliquer **« Marquer comme relue »** ; idem pour "Interrogation Mathématiques test guide".

✅ Étape 3 : « Le motif doit comporter au moins 5 caractères. ». Étape 4 : « La feuille est renvoyée en brouillon. » (historique "Soumise → Brouillon" avec le commentaire). Étape 5 : « La feuille de notes est relue. », état « Relue », historique "Soumise → Relue".

🔒 *Test de droit* : en tant que responsable pédagogique, taper `/v2/assessments/new` → page « Accès refusé » (`/unauthorized`).

☐ OK ☐ KO

---

## Étape 139 — L'enseignant reprend la feuille renvoyée
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Devoir commun test guide" (Français)

1. Lire l'avertissement « Renvoyée en brouillon : Barème à revoir pour l'exercice 3 (test guide) ».
2. Ouvrir la feuille, remplacer `13` par `13,5` pour COULIBALY Moussa, **« Enregistrer »** ("… 1 modifiée(s) …"), puis **« Soumettre la feuille »**.
3. Ouvrir "Devoir n°1 Mathématiques test guide" (état « Relue »), cliquer **« Renvoyer en brouillon »**, saisir `Essai de refus (test guide)` et valider.

✅ Étape 2 : « La feuille de notes est soumise. », état « Soumise » (cette feuille reste ainsi jusqu'à la phase suivante). Étape 3 : refus "Vous n'avez pas le droit d'effectuer cette étape du circuit de validation." ; la feuille reste « Relue ».

⚠️ *Écart connu* : le bouton « Renvoyer en brouillon » est proposé à l'enseignant sur une feuille déjà relue alors que le serveur le refuse.

☐ OK ☐ KO

---

## Étape 140 — Approuver les feuilles de Mathématiques
👤 **responsable pédagogique** (secondaire-test) · fenêtre **A** · 📂 Menu "ÉVALUATIONS" > "Feuilles à relire" > "Devoir n°1 Mathématiques test guide"

1. Cliquer **« Approuver »** ; lire la fenêtre « Approuver cette feuille de notes ? » (« Cette action est définitive : elle ne pourra pas être annulée depuis cet écran. »), cliquer **« Approuver la feuille »**.
2. Répéter pour "Interrogation Mathématiques test guide". **Ne pas** toucher à "Devoir commun test guide" (Français), qui doit rester « Soumise ».
3. Chercher le bouton « Publier les notes ».

✅ « La feuille de notes est approuvée. », état « Approuvée », historique "Relue → Approuvée". Le bouton « Publier les notes » **n'existe pas** pour ce compte. Le même compte a relu **puis** approuvé : accepté (la séparation ne vise que la personne qui a soumis).

⚠️ *Écart connu* : aucune fenêtre « Confirmez votre identité » à l'approbation ni à la publication ; seule la MFA de la connexion compte.

🔒 *Test de droit* : en tant que responsable pédagogique, taper `/v2/assessments/revisions` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 141 — Quatre yeux : le soumetteur ne relit pas sa feuille
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Barre « Évaluations et notes » > « Nouvelle évaluation » (`/v2/assessments/new`)

*(« Se déconnecter » du responsable pédagogique, puis connexion.)*

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type d'évaluation | `Devoir` |
| Intitulé | `Contrôle direction test guide` |
| Date de l'évaluation | `2026-10-08` |
| Classe / Cours / Période | `6e A` / `Anglais` / `Trimestre 3` |
| Enseignant | rechercher `TRAORE`, choisir TRAORE Kouadio |

2. **« Créer l'évaluation »**, puis **« Saisir les notes »** : `10` pour ADOU Aïcha, `12` pour DIABATE Nadia ; **« Enregistrer »** ; **« Soumettre la feuille »**.
3. Cliquer **« Marquer comme relue »** sur sa propre feuille.
4. Cliquer **« Annuler l'évaluation »**, motif `Essai quatre yeux terminé (test guide)`, valider.

✅ Étape 3 : refus "La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier." (état reste « Soumise »). Étape 4 : « L'évaluation est annulée. », état « Annulée ».

⚠️ *Test d'erreur* : « Enseignant » laissé vide → "Indiquez l'enseignant de l'évaluation.".

☐ OK ☐ KO

---

## Étape 142 — ⚠️ Irréversible : publier les notes de Mathématiques
👤 **directeur des études** (secondaire-test) · fenêtre **A** · `etudes@secondaire-test.test` (MFA) · 📂 Barre « Évaluations et notes » > « Évaluations » > "Devoir n°1 Mathématiques test guide"

*(« Se déconnecter » du directeur, puis connexion.)* Une note publiée ne se modifie plus que par une correction approuvée.

1. Statut « Approuvée » : cliquer **« Publier les notes »** ; la fenêtre « Publier les notes ? » rappelle que les notes deviennent immuables et déclenchent le recalcul. Cliquer **« Publier les notes »**.
2. Répéter pour "Interrogation Mathématiques test guide".
3. Sur le devoir n°1, **« Voir les notes »** puis **« Historique »** en face de DIABATE Nadia.

✅ « Les notes sont publiées. », état « Publiée ». Feuille en lecture seule ; ce compte voit « Historique » mais **pas** « Corriger ». La fenêtre « Historique de la note de DIABATE Nadia » : « Valeur actuelle : 18 », circuit Brouillon → Publiée daté, « Aucune correction. ». Le calcul des résultats suit **10 à 30 secondes** plus tard.

⚠️ *Écart connu* : l'auteur d'une étape du circuit peut s'afficher par identifiant (« Par pedagogie »).

☐ OK ☐ KO

---

## Étape 143 — Demander la correction de deux notes publiées
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Devoir n°1 Mathématiques test guide" > **« Voir les notes »**

1. Le message « Notes publiées : … » s'affiche ; chaque ligne notée propose **« Corriger »**. Cliquer **« Corriger »** en face de ASSI Brice (« Valeur publiée : 9,5 »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nouvelle valeur | `10,5` |
| Motif de la correction | `Erreur de report de la copie n°4 (test guide)` |

3. Cliquer **« Envoyer la demande »**.
4. Recommencer pour DIABATE Salimata : « Nouvelle valeur » = `20`, « Motif de la correction » = `Demande volontairement discutable (test guide)`.
5. Ouvrir « Corrections de notes » (`/v2/assessments/revisions`) : le compte n'a **aucun** bouton d'approbation.

✅ « La demande de correction est envoyée pour approbation. » ; deux demandes « Demandée ».

⚠️ *Test d'erreur* : « Nouvelle valeur » `abc` ou `25` → « Valeur invalide : une note entre 0 et 20, ou un code d'état. » ; motif de 4 caractères → « Le motif doit faire au moins 10 caractères. » ; une seconde demande sur ASSI Brice → "Une demande de correction est déjà en cours pour cette note."

☐ OK ☐ KO

---

## Étape 144 — Approuver une correction, en rejeter une autre
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Barre « Évaluations et notes » > « Corrections de notes » (`/v2/assessments/revisions`)

*(La décision est prise par une autre personne que le demandeur : c'est le second regard.)*

1. Pour ASSI Brice ("9,5 → 10,5"), cliquer **« Approuver »** ; « Commentaire (facultatif) » = `Copie vérifiée (test guide)`, **« Approuver »**.
2. Pour DIABATE Salimata, cliquer **« Rejeter »** ; « Motif du rejet » = `Copie non retrouvée, correction injustifiée (test guide)`, **« Rejeter »**.
3. Choisir « État » = « Tous les états », puis revenir sur la feuille du devoir n°1 et ouvrir **« Historique »** de ASSI Brice.

✅ « Correction approuvée et appliquée. » (carte « Appliquée », « Décidée par `<nom>` le `<date>` — Copie vérifiée (test guide) ») ; « La demande de correction est rejetée. » (carte « Rejetée »). La feuille montre `10,5` pour ASSI Brice et toujours `0` pour DIABATE Salimata. L'historique de ASSI Brice : « Valeur actuelle : 10,5 », "9,5 → 10,5".

⚠️ *Test d'erreur* : rejet avec un motif de 2 caractères → « Le motif doit comporter au moins 5 caractères. ».

🔒 *Test de droit* : en tant que directeur des études, taper `/v2/teacher/assessments/new` → « Accès refusé » (il crée par `/v2/assessments/new`).

☐ OK ☐ KO

---

## Étape 145 — Ce que voit l'élève
👤 **élève** (secondaire-test) · fenêtre **B** · `eleve@secondaire-test.test` (DIABATE Nadia, pas de MFA) · 📂 Menu "Mes résultats" (`/v2/student/results`)

*(« Se déconnecter » de l'enseignant, puis connexion.)*

1. Descendre à « Notes des évaluations ».
2. Lire les lignes "Devoir n°1 Mathématiques test guide" et "Interrogation Mathématiques test guide".
3. Chercher une ligne "Devoir commun test guide".

✅ Devoir n°1 : `18 / 20` ; Interrogation : `8 / 10` (poids 1 et 2). Aucun "Devoir commun test guide" (feuille seulement « Soumise »). Les types masqués (« Examen blanc ») ne sont jamais visibles.

🔒 *Test de droit* : en tant qu'élève, taper `/v2/teacher/assessments` → « Accès refusé ».

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 08, scénarios 8.3 (cas invalides du type), 8.17 (primaire et supérieur, session de rattrapage), 8.18 (clavier, réseau coupé, période verrouillée), 8.19 (droits refusés et isolation entre établissements).

**Ce que la phase laisse dans l'application :**
- "Devoir n°1 Mathématiques test guide" (6e A, Mathématiques, Trimestre 3, sur 20, coef. 1) : **Publiée** ; 10 lignes (6 notées, 2 absents, 1 dispensé, 1 non évalué) ; ASSI Brice corrigé de `9,5` à `10,5`, DIABATE Salimata toujours `0`.
- "Interrogation Mathématiques test guide" (sur 10, coef. 2) : **Publiée** ; 4 notes (Nadia 8, COULIBALY Salimata 7,5, DIABATE Salimata 3, COULIBALY Moussa 6).
- "Devoir commun test guide" (Français) : **Soumise**, laissée en l'état (la phase suivante en a besoin) ; "Devoir commun test guide" (Anglais) et "Contrôle direction test guide" : **Annulées**.
- Type "Quiz test guide" (`TG_QUIZ`) inactif ; demande de correction ASSI Brice **Appliquée**, demande DIABATE Salimata **Rejetée**.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](07-appel-presences.md) · [Suivant →](09a-regles-resultats-bulletins.md)
