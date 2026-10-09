[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](13a-examens.md) · [Suivant →](14-paie.md)

# Phase 13 (suite) — Examens : session, candidats, centres, notes, résultats

*Suite de la phase 13 : reprise à l'étape 241.*

---

## Étape 241 — Clore les inscriptions
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 détail de `Session BEPC test guide`

1. Cliquer **« Passer à : Inscriptions closes »**. (Ne pas encore passer en cours.)
2. Ouvrir la fiche de `DIABATE Ibrahim test guide`, cliquer **« Évaluer par la règle »**, puis **« Inscrire le candidat »**.
3. Ouvrir **« Notes et résultats »** > **« Notes par épreuve »**, saisir `12` pour DIABATE Nadia en `TG_EP1`, cliquer **« Enregistrer les notes modifiées (1) »**, puis **« Annuler les modifications »**.

✅ Étape 1 : « La session est maintenant : Inscriptions closes. » (33 %) ; les deux étapes proposées sont « Passer à : Inscriptions ouvertes » (retour) et « Passer à : Épreuves en cours ». Étape 2 : "les inscriptions ne sont pas ouvertes (session REGISTRATION_CLOSED)". Étape 3 : rapport "0 note(s) enregistrée(s), 0 inchangée(s)." avec la ligne refusée "la saisie des notes n'est ouverte que session en cours ou résultats saisis (session REGISTRATION_CLOSED)" suivie d'un code technique.

⚠️ *Écart connu* : le refus de saisie de notes répond comme un succès (rapport) et affiche un code technique à la suite du message.

☐ OK ☐ KO

---

## Étape 242 — Émettre les convocations (lot, échec, révocation)
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Exports et documents »** (`/v2/examinations/exports`), session `Session BEPC test guide`

1. Lire la section « Exports » : « Aucun format publié. » (aucun format n'est livré au collège ; le bouton « Lancer l'export » reste inactif).
2. Dans « Documents », « Document » = « Convocation », cliquer **« Émettre pour tous les candidats concernés »**.
3. Cliquer **« Télécharger »** sur une convocation.
4. Aller dans « Répartition », cliquer **« Répartir automatiquement »** (le candidat 00005 sans place est placé), puis revenir ici et recliquer **« Émettre pour tous les candidats concernés »**.
5. Sur la convocation du candidat 00006, cliquer **« Révoquer »**, saisir le « Motif de la révocation » `Erreur de salle sur la convocation de démonstration.`, cliquer **« Révoquer »**, puis recliquer **« Émettre pour tous les candidats concernés »**.

✅ Étape 2 : "5 document(s) émis, 0 ignoré(s)." avec, sous « Lignes refusées », "La convocation exige une place attribuée au candidat. (examinations.convocation_requires_assignment)" (candidat 00005) ; cinq lignes `Convocation v1 — TG_BEPC2027-0000N` à l'état « Émis ». Étape 3 : PDF `CONVOCATION-<numéro>.pdf` avec nom, centre, salle, place, date des épreuves (14 juin 2027) et filigrane "Données et règles de démonstration (fictives) : aucune valeur officielle." *(à vérifier visuellement)*. Étape 4 : "1 candidat(s) placé(s), 5 déjà placé(s)." puis "1 document(s) émis, 5 ignoré(s)." (cinq lignes « Un document valide existe déjà. »). Étape 5 : la ligne passe à « Révoqué » avec son motif ; le lot suivant émet "1 document(s) émis, 5 ignoré(s)." et la nouvelle ligne est `Convocation v2`.

⚠️ *Test d'erreur* : sur la fiche de DIABATE Nadia, **« Émettre : Attestation de réussite »** → "Ce document exige un résultat officiel publié.".

☐ OK ☐ KO

---

## Étape 243 — Vue famille avant les résultats (parent et élève)
👤 **parent** (secondaire-test, `parent@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 Menu **« Examens de mes enfants »** (`/v2/examinations/family`)

1. Se connecter en parent. Lire les deux cartes `DIABATE Nadia — BEPC test guide (démonstration) 2027` et `DIABATE Salimata — …`.
2. Se déconnecter, se connecter en **élève** (`eleve@secondaire-test.test`, sans MFA, correspond à DIABATE Nadia) : menu **« Mon examen »**.
3. Cliquer **« Télécharger »** sur la convocation.

✅ Parent : titre « Examen de mon enfant » ; chaque carte montre la pastille « Inscrit », le « Numéro de candidat » (`TG_BEPC2027-00001`, `…-00002`), le « Début des épreuves » (14 juin 2027), la « Place » (`Centre Cocody test guide, salle S1, place 1`, `… place 2`), « Le résultat n'est pas encore publié. » et la convocation avec « Télécharger ». Aucune note, moyenne ni rang ; pas d'inscription à l'examen blanc `BLANC-DEMO` ; aucun autre élève. Élève : titre « Mon examen », une seule carte, celle de Nadia ; le PDF s'ouvre.

🔒 *Test de droit* : en tant que parent, taper `/v2/examinations/results` → page « Accès refusé » ("Vous n'avez pas les droits nécessaires pour afficher cette page.").

☐ OK ☐ KO

---

## Étape 244 — Passer en « Épreuves en cours » et saisir les notes par épreuve
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 détail de session, puis **« Notes et résultats »** (`/v2/examinations/results`) > onglet **« Notes par épreuve »**

1. Sur le détail de session, cliquer **« Passer à : Épreuves en cours »** : la répartition est figée (message « La répartition est figée à ce stade de la session. » dans « Répartition »).
2. Dans « Notes par épreuve », saisir (champs « Note de `<nom>` en `<épreuve>` » ; liste « État de la note de `<nom>` en `<épreuve>` » pour Absent/Excusé) :

| Candidat | `TG_EP1` | `TG_EP2` |
| :--- | :--- | :--- |
| DIABATE Nadia | `13` | `11` |
| DIABATE Salimata | `9` | `8` |
| COULIBALY Moussa | `15` | `12` |
| KOUASSI Yves test guide | `10` | `11` |
| KONE Mariam test guide | état « Absent » | état « Absent » |
| BAMBA Fanta test guide | état « Excusé » | état « Excusé » |

3. Cliquer **« Enregistrer les notes modifiées (12) »**, puis recharger la page.

✅ Étape 1 : « La session est maintenant : Épreuves en cours. » (50 %). Étape 3 : « 12 note(s) enregistrée(s), 0 inchangée(s). » ; les valeurs persistent ; la colonne `TG_EP3 /10` affiche « — » pour tous (aucune filière affectée). La fiche de DIABATE Nadia montre "13 / 20" et "11 / 20", origine « Saisie à la main ».

⚠️ *Test d'erreur* : note `21` pour Nadia en `TG_EP1` → rapport "0 note(s) enregistrée(s)…" avec la ligne refusée "la note 21.000 dépasse le barème 20.000 de l'épreuve (examinations.score_above_scale)" ; puis **« Annuler les modifications »**.

☐ OK ☐ KO

---

## Étape 245 — Saisir les résultats de l'autorité et passer à « Résultats saisis »
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Notes et résultats »** > onglet **« Résultats »**

La plateforme n'invente pas l'admission d'un examen officiel : elle enregistre le résultat communiqué par l'autorité, tel quel (non recalculé à partir des notes).

1. Dans « Saisir un résultat », enregistrer un par un (**« Enregistrer le résultat »**) :

| Candidat | Résultat | Moyenne | Rang | Mention |
| :--- | :--- | :--- | :--- | :--- |
| DIABATE Nadia | Admis | `12,5` | `2` | `AB` |
| DIABATE Salimata | Refusé | `8,75` | `5` | (vide) |
| COULIBALY Moussa | Admis | `14` | `1` | `BIEN` |
| KOUASSI Yves test guide | Admis | `10,25` | `3` | (vide) |
| KONE Mariam test guide | Absent | (vide) | (vide) | (vide) |

2. Sur le détail de session, cliquer **« Passer à : Résultats saisis »**.
3. Constater que « Passer à : Résultats publiés » est désactivé.
4. Revenir dans « Résultats » et saisir : `BAMBA Fanta test guide`, « Différé », sans moyenne. Recharger le détail de session.

✅ Étape 1 : « 1 résultat(s) enregistré(s). » à chaque fois ; cinq lignes, origine « Saisi à la main », publication « Non publié ». Étape 2 : « La session est maintenant : Résultats saisis. » (67 %). Étape 3 : point bloquant "1 candidat(s) inscrit(s) sans résultat : saisir ou importer leur résultat (absent, différé…) avant la publication." Étape 4 : « Avec résultat » 6, plus de point bloquant, « Passer à : Résultats publiés » actif (ne pas encore cliquer). Colonne « Issue » de « Candidats » : « Admis », « Refusé », « Absent », « Différé ».

⚠️ *Test d'erreur* : « Absent » avec Moyenne `10` → "Un absent, exclu ou ajourné n'a ni moyenne, ni rang, ni mention.".

☐ OK ☐ KO

---

## Étape 246 — Corriger une note après la clôture des notes (quatre yeux)
👤 **responsable des examens** (secondaire-test), puis **directeur** (secondaire-test, MFA) · fenêtre **A** · 📂 Menu **« Examens »** > **« Corrections »** (`/v2/examinations/corrections`), session `Session BEPC test guide`

1. Examens : dans « Nouvelle demande de correction », saisir :

| Champ | Valeur |
| :--- | :--- |
| Objet de la correction | « Une note » |
| Candidat | `DIABATE Salimata` |
| Épreuve | `TG_EP1 — Mathématiques test guide` |
| État proposé | « Saisie » |
| Note proposée | `10` |
| Motif | `Erreur de report de la note constatée à la relecture des copies.` |

2. Cliquer **« Envoyer la demande »**. Constater l'absence de « Approuver » / « Rejeter » pour ce compte.
3. Directeur : ouvrir la même page et la même session, cliquer **« Approuver »** sur la carte.
4. Examens : dans « Notes par épreuve », changer la note de DIABATE Nadia en `TG_EP1` de `13` à `14`, cliquer **« Enregistrer les notes modifiées (1) »**, puis **« Annuler les modifications »**.

✅ Étape 2 : « Demande envoyée : une autre personne doit l'approuver. » ; carte "Note — TG_BEPC2027-00002" (« En attente », valeur actuelle 9). Étape 3 : la carte passe à « Approuvée » (filtre « Approuvées ») et « Notes par épreuve » affiche `10` pour Salimata en `TG_EP1`. Étape 4 : "0 note(s) enregistrée(s), 0 inchangée(s)." avec la ligne refusée "une note saisie après clôture ne se corrige que par une révision approuvée (examinations.score_revision_required)".

⚠️ *Test d'erreur* : motif de 5 caractères → "Au moins 10 caractères." ; seconde demande sur la même note tant que la première est en attente → "Une demande de révision est déjà en attente pour cette cible.".

⚠️ *Écart connu* : la valeur proposée peut s'afficher avec des clés techniques (`toStatus`, `toScore`).

☐ OK ☐ KO

---

## Étape 247 — Le demandeur n'approuve pas sa propre demande
👤 **directeur** (secondaire-test, MFA) puis **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Corrections »**, session `Session BEPC test guide`

1. Directeur : « Nouvelle demande de correction » > « Une note » > Candidat `KOUASSI Yves test guide`, Épreuve `TG_EP2 — Français test guide`, État « Saisie », Note `12`, Motif `Erreur de report relevée lors du contrôle interne.` > **« Envoyer la demande »**.
2. Directeur : sur la carte, cliquer **« Approuver »**.
3. Directeur : cliquer **« Rejeter »**, saisir un motif d'au moins 5 caractères, cliquer **« Rejeter »**.
4. Propriétaire : se connecter, ouvrir « Corrections », cliquer **« Approuver »** sur cette carte.

✅ Étape 2 : "Une révision est approuvée par une autre personne que celle qui l'a demandée." (la note reste `11`). Étape 3 : "Une demande est décidée par une autre personne que celle qui l'a faite.". Étape 4 : carte « Approuvée » ; « Notes par épreuve » affiche `12` pour Yves en `TG_EP2`.

☐ OK ☐ KO

---

## Étape 248 — Lire les statistiques de la session
👤 **directeur des études** (secondaire-test, `etudes@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Examens »** > **« Statistiques »** (`/v2/examinations/statistics`), session `Session BEPC test guide`

1. Avec « Regrouper » = « Ensemble », lire le tableau « Statistiques d'examen ».
2. Choisir « Regrouper » = « Par sexe ».
3. Dans « Comparer avec », choisir « L'examen blanc ».

✅ Ensemble : Inscrits 6, Présents 5, Admis 3, Refusés 1, Absents 1, Exclus 0, Différés 1, Taux 60 % *(forme exacte du pourcentage à relever)*. Par sexe : « Filles » (4 inscrits, 3 présents, 1 admis, 1 refusé, 1 absent, 1 différé, taux voisin de 33,3 %) et « Garçons » (2 inscrits, 2 présents, 2 admis, 100 %), puis « Total ». Comparaison : second tableau "Comparaison : Examen blanc … BEPC blanc test guide" avec compteurs à zéro (tant que l'examen blanc n'est pas inscrit) et taux « — ». Le directeur des études est en lecture seule : pas de bouton d'action.

🔒 *Test de droit* : en tant que directeur des études, taper `/v2/examinations/centers` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 249 — Examen blanc : figer, ouvrir, inscrire, refus de liaison
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 détail de `BEPC blanc test guide`, puis **« Candidats »** et **« Examens blancs »** (`/v2/examinations/mock`)

1. Dans le détail de `BEPC blanc test guide`, cliquer **« Copier et figer la définition »** puis **« Passer à : Inscriptions ouvertes »**.
2. Dans « Candidats », session `BEPC blanc test guide` : ajouter les élèves de `6e A` (**« Ajouter les élèves »**), cliquer **« Sélectionner la page »** puis **« Inscrire la sélection (9) »**.
3. Dans « Examens blancs », session `BEPC blanc test guide`, bloc « Lier une évaluation » : Épreuve `TG_EP1 — Mathématiques test guide`, Classe `6e A`, Évaluation `Examen blanc (démonstration)`, puis **« Lier l'évaluation »**.

✅ Étape 1 : « Définition copiée : 3 épreuve(s). ». Étape 2 : un avis remplace le bloc des candidats libres ("Les candidats libres ne concernent que les sessions officielles.") ; « 9 candidat(s) ajouté(s), 0 déjà présent(s). » puis « 9 candidat(s) inscrit(s). » (les numéros repartent de `TG_BEPC2027-00001` : compteur propre à la session ; un examen blanc n'exige ni éligibilité évaluée ni pièces). Étape 3 : refus "Cette évaluation alimente déjà une épreuve." (elle alimente `BLANC-DEMO`).

*(Lecture seule sur `Session BLANC-DEMO` : voir le chapitre pour son recalcul ; ne pas la publier.)*

☐ OK ☐ KO

---

## Étape 250 — Publier les résultats de la session (⚠️ Irréversible)
👤 **responsable des examens** (secondaire-test), puis **directeur** (secondaire-test, MFA) · fenêtre **A** · 📂 détail de `Session BEPC test guide`

1. Examens : cliquer **« Passer à : Résultats publiés »**. Dans la fenêtre « Publier les résultats », cliquer **« Publier »**, puis **« Annuler »**.
2. Directeur : même chemin, cliquer **« Passer à : Résultats publiés »**, puis **« Publier »** (valider la seconde vérification si elle s'ouvre).
3. Ouvrir **« Notes et résultats »** > **« Résultats »**.

✅ Étape 1 : texte "Les résultats de 6 candidat(s) deviennent visibles des familles. Après publication, toute modification passe par une correction approuvée par une autre personne." ; le responsable est refusé : "La publication des résultats exige la permission ‹ exam.result.publish ›." (nom technique affiché tel quel) ; la session reste « Résultats saisis ». Étape 2 : « La session est maintenant : Résultats publiés. » (83 %), « Publiés » 6 ; seule l'étape « Passer à : Archivée » reste. Étape 3 : six lignes « Publié », plus de bouton « Publier ».

☐ OK ☐ KO

---

## Étape 251 — Attestations et relevés, puis correction d'un résultat publié
👤 **responsable des examens** (secondaire-test), puis **directeur** (secondaire-test, MFA) · fenêtre **A** · 📂 **« Exports et documents »** puis **« Corrections »**, session `Session BEPC test guide`

1. Examens : « Document » = « Attestation de réussite » > **« Émettre pour tous les candidats concernés »**.
2. « Document » = « Relevé de notes » > **« Émettre pour tous les candidats concernés »** ; télécharger le relevé de `DIABATE Nadia`.
3. « Corrections » > « Nouvelle demande de correction » : Objet « Un résultat », « Résultat concerné » `DIABATE Nadia — Admis`, « Résultat proposé » « Admis », « Moyenne proposée » `13`, Motif `Moyenne mise à jour après relecture du procès-verbal fictif.` > **« Envoyer la demande »**.
4. Directeur : cliquer **« Approuver »** sur cette demande.
5. Retour à « Exports et documents » : relire la liste « Documents émis », puis réémettre l'attestation et le relevé (**« Émettre pour tous les candidats concernés »**).

✅ Étape 1 : "3 document(s) émis, 0 ignoré(s)." (Nadia, Moussa, Yves) et trois lignes refusées "L'attestation de réussite exige un résultat ADMIS publié. (examinations.attestation_requires_admission)" (Salimata, Mariam, Fanta). Étape 2 : "6 document(s) émis, 0 ignoré(s)." ; le PDF du relevé mentionne les notes 13 et 11 et le filigrane de démonstration *(à vérifier visuellement)*. Étape 5 : "Attestation de réussite v1" et "Relevé de notes v1" de Nadia sont « Révoqué » avec le motif "Résultat corrigé par révision approuvée (demande xxxxxxxx)." ; la convocation de Nadia reste « Émis » ; la réémission donne des documents en version 2 ("1 document(s) émis, 2 ignoré(s)." pour l'attestation, "1 document(s) émis, 5 ignoré(s)." pour le relevé).

⚠️ *Test d'erreur* : fiche de DIABATE Salimata > **« Émettre : Attestation de réussite »** → "L'attestation de réussite exige un résultat ADMIS publié.".

☐ OK ☐ KO

---

## Étape 252 — Vue famille après publication
👤 **parent** (secondaire-test) puis **élève** · fenêtre **B** · 📂 Menu **« Examens de mes enfants »** / **« Mon examen »** (`/v2/examinations/family`)

1. Parent : lire les cartes de Nadia et de Salimata.
2. Élève : lire la carte de Nadia, cliquer **« Télécharger »** sur l'attestation.

✅ Parent : Nadia « Résultat : » pastille « Admis » avec les documents « Convocation », « Attestation de réussite », « Relevé de notes » (versions valides seulement, v1 révoquées absentes) ; Salimata « Résultat : » pastille « Refusé » avec « Convocation » et « Relevé de notes ». Aucune note, moyenne ni rang. Élève : carte de Nadia seule, mêmes informations ; le PDF s'ouvre.

☐ OK ☐ KO

---

## Étape 253 — Archiver la session (⚠️ Irréversible)
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 détail de `Session BEPC test guide`

1. Cliquer **« Passer à : Archivée »** (aucune confirmation demandée).

✅ « La session est maintenant : Archivée. », avancement 100 %, « Aucune étape suivante possible. ». Les écrans restent consultables ; notes et répartition ne sont plus modifiables.

🔒 *Test de droit* : en tant que responsable des examens, taper `/v2/examinations/family` → page « Accès refusé ».

☐ OK ☐ KO

---

> **Variante primaire (CEPE de démonstration).** À l'École Les Palmiers (`primaire-test`, `examens@primaire-test.test`), aucune donnée d'examen n'est semée. Le bouton **« Charger le pack du primaire (fictif) »** (écran « Types d'examens ») crée le type `CEPE` ; on y crée ensuite un centre `TG-CTRP`, la session `TG-CEPE-2027` "CEPE 2027 test guide", des candidats libres (sans règle liée : éligibilité saisie à la main, pièce « vue sur place »), puis on **importe les résultats communiqués par l'autorité** avec trois fichiers (`20-examens-resultats-cepe-entete-invalide.csv`, `20-examens-resultats-cepe-erreurs.csv`, `20-examens-resultats-cepe.csv`) que la direction applique, avant publication. Toute la variante se déroule dans le chapitre 20, scénarios 20.35 à 20.41 (partie B). Les jeux de règles restent des données de démonstration.

📚 *Pour aller plus loin* : chapitre 20, scénarios 20.30 à 20.33 (examens blancs de démonstration, imports et exports sans format publié), 20.35 à 20.41 (primaire), 20.42 (supérieur : aucun parcours) et 20.43 (adresses interdites, isolation entre établissements, clavier).

**Ce que la phase laisse dans l'application :**
- Type `TG_BEPC` "BEPC test guide (démonstration)", filière `TGA` "Série A test guide", épreuves `TG_EP1` "Mathématiques test guide", `TG_EP2` "Français test guide", `TG_EP3` "Épreuve de série A test guide".
- Centre `TG-CTR1` "Centre Cocody test guide" avec les salles `S1` (3 places), `S2` (2 places), `S3` (2 places).
- Session officielle `TG-BEPC-2027` "Session BEPC test guide" (état « Archivée »), numéros `TG_BEPC2027-00001` à `00006` (Nadia, Salimata, Moussa, Yves, Mariam, Fanta), identifiant officiel `TG-OFF-0001` (Nadia), résultats publiés, convocations, attestations et relevés (dont des v1 révoqués).
- Session `TG-BLANC-2027` "BEPC blanc test guide" (« Inscriptions ouvertes », 9 candidats inscrits).
- Candidats libres "KOUASSI Yves test guide", "SORO Aya test guide", "KONE Mariam test guide", "TRAORE Seydou test guide" (retiré), "YAO Adjoua test guide", "DIABATE Ibrahim test guide", "BAMBA Fanta test guide", "COULIBALY Karim test guide" (anonymisé).
- Demandes de correction : 2 notes (Salimata `TG_EP1` = 10, Yves `TG_EP2` = 12) et 1 résultat (Nadia, moyenne 13) approuvées.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](13a-examens.md) · [Suivant →](14-paie.md)
