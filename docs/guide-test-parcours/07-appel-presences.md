[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](06-emploi-du-temps.md) · [Suivant →](08-evaluations-notes.md)

# Phase 7 — Appel et présences

Objectif : l'enseignant fait l'appel des séances du jour et le soumet, l'éducateur et la direction valident (puis rouvrent), le parent justifie l'absence de DIABATE Nadia, puis on suit l'assiduité (absences, tableau de bord, appels non faits, alertes) et le pointage du personnel. **Règle : au secondaire l'appel se fait par séance ; l'enseignant n'a aucun appel journalier.**

Précondition : les quatre `Séance d'appel … test guide` de la phase *Emploi du temps* existent pour **J = 8 octobre 2026**. Liste d'appel de la 6e A : dix élèves à inscription active (DIABATE Nadia, DIABATE Salimata, BAMBA Aya, BAMBA Fatou, COULIBALY Moussa, COULIBALY Salimata, TOURE Yao, TOURE Jean-Marc, ADOU Aïcha, ASSI Brice) *(à vérifier : dix)*.

## Étape 109 — Lire « Mes appels » (appel par séance)
👤 **enseignant** (secondaire-test, `enseignant@secondaire-test.test`, TRAORE Kouadio, sans MFA) · fenêtre **B** · 📂 Menu **« Mes appels »** (`/v2/teacher/attendance`)

1. Lire le titre « Mes séances à faire » et la rubrique « Aujourd'hui ».
2. Descendre jusqu'à « Mes appels des 30 derniers jours » (attendre la fin du chargement : un faux "Aucun appel sur la période." peut s'afficher quelques secondes).

✅ `Séance d'appel test guide` (et les trois autres) avec « Appel à faire » et le bouton « Faire l'appel ». **Aucune rubrique « Appel de la journée »** : le cycle secondaire ne fait pas d'appel journalier. Les deux appels de démonstration validés figurent dans les 30 derniers jours (BAMBA Aya puis BAMBA Fatou absentes).

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/attendance/absences` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 110 — Faire l'appel d'une séance et le soumettre
👤 **enseignant** · fenêtre **B** · 📂 **« Mes appels »** > **« Faire l'appel »** sur `Séance d'appel test guide`

Attendu au départ : l'ouverture crée l'appel (badge « Appel ouvert ») ; aide "Tout le monde est présent par défaut : touchez uniquement les exceptions." ; « Résumé de l'appel » : "Présent : 10".

1. Toucher la ligne `DIABATE Nadia` : elle passe à « Absent ». Toucher deux fois : retour à « Présent » ; la remettre à « Absent ».
2. Sur `DIABATE Salimata`, toucher le bouton « Autre statut pour DIABATE Salimata » : dans « Statut de DIABATE Salimata », cocher **« En retard »**, « Minutes de retard » = `10`, cliquer **« Appliquer »**.
3. Constater que « Absent justifié » n'est pas proposé à l'enseignant.
4. Cliquer **« Soumettre l'appel »**.

✅ "Appel soumis : 1 absent, 1 retard." (ou "Appel soumis." selon l'offre) ; badge « Appel soumis » ; résumé environ "Présent : 8", "Absent : 1", "En retard : 1" ; ligne de Salimata "En retard 10 min" ; le bouton devient « Enregistrer les corrections ». Dans « Mes appels », la séance porte « Appel soumis » et « Voir l'appel ».

⚠️ *Test d'erreur* : « Minutes de retard » `1500` → "Entrez un nombre entier de minutes entre 1 et 1440."

☐ OK ☐ KO

---

## Étape 111 — Corriger après soumission
👤 **enseignant** · fenêtre **B** · 📂 **« Mes appels »** > **« Voir l'appel »** sur `Séance d'appel test guide`

1. Passer `COULIBALY Moussa` en « Absent » : le pied indique "1 modification à envoyer". Cliquer **« Enregistrer les corrections »**.
2. Le remettre en « Présent » et enregistrer de nouveau (pour garder les chiffres du guide).

✅ "Corrections enregistrées." (deux fois) ; aucun second appel n'est créé pour la même séance.

☐ OK ☐ KO

---

## Étape 112 — Absence justifiée immédiate par la direction
👤 **directeur des études** (secondaire-test, `etudes@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Présences »** > **« Suivi des appels »** (`/v2/attendance/sessions`)

Attendu au départ : régler « Du » sur le `01/09/2026` pour voir aussi les deux appels de démonstration (« Validé »). L'appel de `Séance d'appel test guide` est « Soumis ».

1. Sur la ligne de `Séance d'appel test guide`, cliquer **« Ouvrir »**.
2. Sur `TOURE Yao` (présent), toucher « Autre statut pour TOURE Yao » puis **« Enregistrer une absence justifiée… »**.
3. Dans « Absence justifiée : TOURE Yao » :

| Champ | Valeur |
| :--- | :--- |
| Motif | Difficulté de transport |
| Commentaire | `Bus en retard, test guide` |

4. Cliquer **« Enregistrer »**.

✅ "Absence justifiée enregistrée." ; la ligne de `TOURE Yao` passe à « Absent » avec la mention « Justifié ».

⚠️ *Test d'erreur* : valider sans motif → "Choisissez un motif."

🔒 *Test de droit* : le lien « Enregistrer une absence justifiée… » n'existe pas pour l'enseignant.

☐ OK ☐ KO

---

## Étape 113 — Valider l'appel (éducateur)
👤 **éducateur** (secondaire-test, `educateur@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 Menu **« Présences »** > **« Suivi des appels »** (`/v2/attendance/sessions`)

1. Régler « Du » sur le `01/09/2026`. Repérer, dans la colonne « État », « Validé » (démonstration) et « Soumis » (`Séance d'appel test guide`). Essayer les filtres « État » et « Classe » (6e A).
2. Sur l'appel « Soumis », cliquer **« Valider »** (aucune fenêtre de confirmation).

✅ "Appel validé." ; l'état passe à « Validé » ; les boutons « Valider » et « Annuler » disparaissent de la ligne ; **« Rouvrir » est absent pour l'éducateur**.

☐ OK ☐ KO

---

## Étape 114 — Préparer trois autres appels
👤 **enseignant** · fenêtre **B** · 📂 **« Mes appels »** > **« Faire l'appel »**

1. `Séance d'appel 2 test guide` : `DIABATE Nadia` « Absent », les autres présents, **« Soumettre l'appel »**.
2. `Séance d'appel 3 test guide` : tout le monde présent, **« Soumettre l'appel »**.
3. `Séance d'appel 4 test guide` : cliquer **« Faire l'appel »** pour l'ouvrir, **sans** le soumettre (revenir à « Mes appels »).

✅ Deux appels « Appel soumis », un « Appel ouvert ». Dans `/v2/schedule`, les séances soumises passent à « Constatée » (effet de la soumission).

☐ OK ☐ KO

---

## Étape 115 — Valider par lot et annuler un appel
👤 **directeur des études** · fenêtre **A** · 📂 **« Suivi des appels »**

1. Cocher les appels « Soumis » de `Séance d'appel 2 test guide` et `Séance d'appel 3 test guide` (« Sélectionner l'appel de 6e A du … »), cliquer **"Valider les 2 séances sélectionnées"**.
2. Sur la ligne de `Séance d'appel 4 test guide` (appel « Ouvert »), cliquer **« Annuler »** ; dans « Annuler l'appel », « Motif » = `Appel ouvert par erreur test guide`, confirmer.

✅ "2 appels validés." ; "Appel annulé." ; état « Annulé », plus de bouton « Valider » ni « Annuler » sur cette ligne.

⚠️ *Test d'erreur* : motif de 2 caractères → "Le motif doit comporter au moins 5 caractères."

☐ OK ☐ KO

---

## Étape 116 — Rouvrir un appel validé avec motif
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Suivi des appels »**

1. Sur l'appel validé de `Séance d'appel test guide`, cliquer **« Rouvrir »**.
2. Dans « Rouvrir l'appel » ("Acte sensible : l'appel validé repasse en correction…"), saisir « Motif » = `Erreur de saisie test guide`, confirmer (renseigner le code MFA du moment si « Confirmez votre identité » s'affiche).
3. Cliquer **« Ouvrir »**, passer `TOURE Jean-Marc` de « Présent » à « Absent », **« Enregistrer les corrections »**.
4. Revenir à « Suivi des appels » et cliquer **« Valider »**.

✅ "Appel rouvert." puis "Corrections enregistrées." puis "Appel validé." ; l'appel compte maintenant : `DIABATE Nadia` absente, `TOURE Yao` absent justifié, `TOURE Jean-Marc` absent, `DIABATE Salimata` en retard.

⚠️ *Test d'erreur* : motif `abc` → "Le motif doit comporter au moins 5 caractères."

🔒 *Test de droit* : « Rouvrir » est absent pour le directeur des études et pour l'éducateur.

☐ OK ☐ KO

---

## Étape 117 — Le parent dépose un justificatif pour DIABATE Nadia
👤 **parent** (secondaire-test, `parent@secondaire-test.test`, DIABATE Séka, sans MFA) · fenêtre **B** · 📂 `/v2/attendance/children` (titre « Absences de mes enfants »)

1. Cliquer **« Voir les absences »** pour `DIABATE Nadia` : lire le « Récapitulatif » et la ligne d'absence « À justifier ».
2. Cliquer **« Déposer un justificatif »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Premier jour d'absence | `08/10/2026` |
| Dernier jour d'absence | `08/10/2026` |
| Motif | Maladie |
| Commentaire | `Paludisme, consultation du jour, test guide` |
| Pièce jointe (facultative) | `docs/guide-test/jeux-de-donnees/justificatif-maladie-test-guide.pdf` |

3. Cliquer **« Déposer »**.

✅ "Justificatif déposé." ; sous « Justificatifs déposés », état « En attente » et bouton « Retirer ce justificatif » ; l'absence reste « À justifier ». Pour `DIABATE Salimata` : un retard.

⚠️ *Test d'erreur* : « Dernier jour d'absence » antérieur au premier → "La fin de la fenêtre précède son début." ; pièce `justificatif-faux-test-guide.pdf` (texte renommé .pdf) → justificatif déposé mais "Le justificatif est déposé mais la pièce n'a pas pu être jointe : Type de fichier non accepté (contrôlé sur le contenu réel du fichier)."

⚠️ *Écart connu* : « Motif » non choisi affiche le message technique "Code attendu : majuscules, chiffres et _ (40 max)."

🔒 *Test de droit* : en tant que parent, taper `/v2/attendance/justifications` puis `/v2/attendance/call` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 118 — Décider sur le justificatif
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Présences »** > **« Justificatifs »** (`/v2/attendance/justifications`)

1. Filtre « État » sur « En attente » : ligne `DIABATE Nadia`, « Déposé par » = « Parent ». Cliquer le nom, puis **« Ouvrir »** sur la pièce jointe (lien temporaire, journalisé).
2. Cliquer **« Accepter »**, « Note (facultative) » = `Pièce reçue test guide`, confirmer.
3. Vérifier dans **« Absences »** (filtre « Justification » = « Justifiée ») que `DIABATE Nadia` est « Absent justifié ».
4. Revenir sur le justificatif, cliquer **« Révoquer »**, « Motif de la révocation » = `Pièce non conforme test guide`, confirmer.

✅ "Justificatif accepté." (état « Accepté », pointage(s) couvert(s) : un ou deux selon que la séance 2 compte *(à vérifier)*) ; "Justificatif révoqué." (état « Révoqué ») : l'absence de Nadia redevient « À justifier ».

⚠️ *Test d'erreur* : révocation avec motif `abc` → "Le motif doit comporter au moins 5 caractères."

⚠️ *Écart connu* : le motif s'affiche en code brut (`ILLNESS`).

☐ OK ☐ KO

---

## Étape 119 — Dépôt par l'éducateur et rejet
👤 **éducateur** · fenêtre **B** · 📂 **« Justificatifs »** (`/v2/attendance/justifications`)

1. Cliquer **« Déposer un justificatif »** pour `DIABATE Salimata` : jours `08/10/2026`, Motif « Autre », pièce `docs/guide-test/jeux-de-donnees/justificatif-photo-test-guide.png`, **« Déposer »**.
2. Constater que l'éducateur n'a **aucun** bouton « Accepter », « Rejeter », « Révoquer ».
3. 👤 **directeur des études** · fenêtre **A** : sur ce justificatif, **« Rejeter »**, « Motif du rejet » = `Motif insuffisant test guide`, confirmer.

✅ "Justificatif déposé." puis "Justificatif rejeté." ; état « Rejeté » ; aucun bouton « Révoquer » sur un justificatif rejeté.

⚠️ *Test d'erreur* : rejet avec motif `ab` → "Le motif doit comporter au moins 3 caractères."

☐ OK ☐ KO

---

## Étape 120 — Absences et export CSV
👤 **éducateur** · fenêtre **B** · 📂 Menu **« Présences »** > **« Absences »** (`/v2/attendance/absences`)

1. Choisir « Classe » = `6e A`, « Du » = `01/09/2026`, « Justification » = « Tous ».
2. Lire la liste (par défaut « À justifier »), puis essayer « Justification » = « Justifiée ».
3. Cliquer **« Exporter en CSV »** *(demander l'accord de l'utilisateur avant le téléchargement)*.

✅ `DIABATE Nadia` « Absent » « À justifier », `DIABATE Salimata` « En retard » 10 minutes, `TOURE Jean-Marc` « Absent », `TOURE Yao` « Absent » justifié, plus les absences de démonstration (BAMBA Aya, BAMBA Fatou). "Export téléchargé." ; fichier `absences.csv` (séparateur point-virgule, colonnes `date;eleve_id;eleve;classe_id;statut;justifie;minutes;justificatif_id`).

⚠️ *Test d'erreur* : « Du » postérieur à « Au » → « Aucune absence correspondante. »

🔒 *Test de droit* : en tant que parent ou élève, taper `/v2/attendance/absences` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 121 — Tableau de bord d'assiduité, recalcul et surcharge
👤 **directeur des études** puis **directeur** · fenêtre **A** · 📂 Menu **« Présences »** > **« Tableau de bord »** (`/v2/attendance`)

1. Choisir « Année scolaire », « Période » = Trimestre 1, « Classe » = `6e A`. Lire les colonnes « Élève », « Séances », « Absences », « Retards », « Départs anticipés », « Non pointés », « Valeur » (« Calculé »).
2. Avec le directeur des études : **« Recalculer la période »**.
3. Avec le directeur : sur la ligne `DIABATE Nadia`, cliquer **« Surcharger »** :

| Champ | Valeur |
| :--- | :--- |
| Minutes d'absence (total) | `120` |
| dont minutes justifiées | `60` |
| Motif de la surcharge | `Correction test guide` |

   Cliquer **« Enregistrer la surcharge »**, puis **« Retirer la surcharge »**.
4. Cliquer le nom `DIABATE Nadia` : fiche « Assiduité de DIABATE Nadia », choisir la période, **« Afficher l'attestation »**.

✅ "Recalcul demandé : les récapitulatifs sont à jour." ; "Surcharge enregistrée (motif et auteur conservés)." (valeur « Surchargé ») puis "Surcharge retirée : la valeur calculée à partir des appels s'applique de nouveau." ; attestation d'assiduité affichée. Sans classe choisie : « Choisissez une classe ».

⚠️ *Test d'erreur* : minutes justifiées `200` pour 120 → "Les minutes justifiées ne peuvent pas dépasser les minutes d'absence." ; motif `abc` → "Le motif doit faire au moins 5 caractères."

🔒 *Test de droit* : le bouton « Surcharger » est absent pour le directeur des études et l'éducateur.

☐ OK ☐ KO

---

## Étape 122 — Appels non faits
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Présences »** > **« Appels non faits »** (`/v2/attendance/compliance`)

1. Régler « Du » sur le `01/09/2026`. Lire « Attendus », « Faits », « Non faits », « Taux d'appel », « Par enseignant », « Par classe ».
2. Dans « Séances sans appel », cliquer **« Faire l'appel »** sur une séance manquante.

✅ Compteurs cohérents avec les appels faits (seules les séances planifiées passées comptent) ; l'écran d'appel de la séance choisie s'ouvre. Quand rien ne manque : "Tous les appels attendus ont été faits."

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/attendance/compliance` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 123 — Créer la règle d'alerte `TG_ABSENCES_2`
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Présences »** > **« Alertes »** (`/v2/attendance/alerts`)

Attendu au départ : "Aucune règle d'alerte." et "Sans règle, aucune alerte n'est émise. Ajoutez-en une ci-dessous."

1. Sous « Ajouter une règle » :

| Champ | Valeur |
| :--- | :--- |
| Code de la règle | `TG_ABSENCES_2` |
| Indicateur | Nombre d'absences |
| Seuil | `2` |
| Activer la règle dès sa création | coché |

2. Cliquer **« Ajouter la règle »**, puis **« Désactiver »** et **« Activer »**.
3. Depuis **« Tableau de bord »**, cliquer **« Recalculer la période »** (`DIABATE Nadia` a deux absences : séances 1 et 2).

✅ "Règle ajoutée.", "Règle désactivée.", "Règle activée." ; au franchissement du seuil une notification (simulée) est émise pour le tuteur *(à vérifier)*.

⚠️ *Test d'erreur* : Code `abs 1` → "Code attendu : majuscules, chiffres et _ (40 max)." ; même code une seconde fois → "Une règle porte déjà ce code." ; Seuil `0` → "La valeur doit être supérieure ou égale à 1."

🔒 *Test de droit* : avec l'éducateur, la liste est lisible mais le formulaire et les boutons « Activer », « Désactiver », « Supprimer » sont absents.

☐ OK ☐ KO

---

## Étape 124 — Pointage du personnel et demande de congé
👤 **enseignant** · fenêtre **B** · 📂 Menu **« Mes congés et ma présence »** (`/v2/teacher/leaves`)

1. Cliquer **« Départ »** avant **« Arrivée »**.
2. Cliquer **« Arrivée »**, puis **« Départ »**.
3. Cliquer **« Demander un congé »** :

| Champ | Valeur |
| :--- | :--- |
| Type de congé | Congé annuel |
| Premier jour | `16/10/2026` |
| Dernier jour | `16/10/2026` |
| Motif | `Congé annuel test guide` |

4. Cliquer **« Envoyer la demande »**.

✅ Étape 1 : "Aucune arrivée n'est enregistrée pour ce jour." ; étape 2 : "Arrivée enregistrée." puis "Départ enregistré." (ligne du jour sous « Présences ») ; étape 4 : "Demande de congé envoyée." et état « Demandé ». Aucun bouton « Approuver » ni « Refuser » pour l'enseignant. Si l'offre n'inclut pas la présence du personnel : "La présence du personnel n'est pas incluse dans votre offre." *(à vérifier)*.

⚠️ *Test d'erreur* : « Dernier jour » antérieur → "La fin du congé précède son début."

⚠️ *Écart connu* : le type s'affiche en code brut (`ANNUAL`).

☐ OK ☐ KO

---

## Étape 125 — Décider sur les congés et enregistrer une présence
👤 **directeur des études** (fenêtre **A**), avec le **directeur** pour créer des demandes · 📂 Menu **« Présences »** > **« Personnel »** (`/v2/attendance/staff`)

1. Avec le directeur des études, filtre « État des congés » = « Demandé » : cliquer **« Approuver »** sur la demande de `TRAORE Kouadio`.
2. Avec le **directeur** : **« Demander un congé »** pour `TRAORE Kouadio`, type « Absence autorisée », jour `12/10/2026` ; puis une seconde demande le `13/10/2026`.
3. Avec le directeur des études : **« Refuser »** la première (« Motif du refus » = `Besoin de service test guide`), **« Annuler »** la seconde.
4. Cliquer **« Enregistrer une présence »** :

| Champ | Valeur |
| :--- | :--- |
| Membre du personnel | `YAO Fatou` |
| Jour | `08/10/2026` |
| Statut | En retard |
| Note | `Retard test guide` |

   Cliquer **« Enregistrer »**. Lire le « Récapitulatif ».

✅ "Congé approuvé." ; "Congé refusé." ; "Congé annulé." ; "Présence enregistrée." ; récapitulatif (« Jours », « Par statut », « Minutes de retard », « Jours de congé »).

⚠️ *Test d'erreur* : refus avec motif `ab` → "Le motif doit comporter au moins 3 caractères." ; statut « En congé » pour `YAO Fatou` → "Le statut "en congé" exige un congé approuvé couvrant ce jour."

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/attendance/staff` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 126 — Remplacer l'enseignant en congé
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Remplacements »** (`/v2/schedule/replacements`)

Attendu au départ : après l'approbation du congé et quelques secondes de traitement, la page affiche `Séance de remplacement test guide` (16/10/2026) avec le badge « À remplacer » (période « Du » / « Au » à élargir jusqu'au 16/10).

1. Cliquer **« Remplacer »**, choisir `YAO Fatou` (ou **« Proposer des remplaçants »** puis **« Choisir »**).
2. « Motif du remplacement » = `Congé de TRAORE test guide`, cliquer **« Remplacer »**.

✅ "Remplacement enregistré." ; la séance perd le badge « À remplacer » et porte `YAO Fatou`.

⚠️ *Écart connu* : la cause s'affiche en code brut (`STAFF_LEAVE`). Si rien n'apparaît après une minute, noter le délai (« Aucune séance à remplacer. »).

🔒 *Test de droit* : en tant qu'éducateur, taper `/v2/schedule/replacements` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 127 — La politique d'appel par séance est respectée
👤 **directeur** · fenêtre **A** · 📂 Menu **« Présences »** > **« Faire l'appel »** (`/v2/attendance/call`)

1. Sous « Appel de la journée » (bloc de direction), choisir « Autre classe » = `6e A`, « Date » = `08/10/2026`, « Demi-journée » = « Journée entière », cliquer **« Ouvrir »**.

✅ Refus : "La politique d'appel de ce cycle n'autorise pas l'appel journalier." (rien n'est créé).

🔒 *Test de droit* : en tant que parent, taper `/v2/attendance/call` → page « Accès refusé ».

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 06, scénarios 6.1 à 6.25 (appel journalier du primaire et de la maternelle, 6.9 à 6.11 ; justificatif de l'élève, 6.16 et 6.22 ; fichiers refusés ; conflits de synchronisation, 6.19 ; isolation entre établissements, 6.23 ; droits par rôle, 6.24).

**Ce que la phase laisse dans l'application :**
- Appels de la 6e A du 8 octobre 2026 : `Séance d'appel test guide` (validée ; `DIABATE Nadia` absente, `DIABATE Salimata` en retard 10 min, `TOURE Yao` absent justifié, `TOURE Jean-Marc` absent), `Séance d'appel 2 test guide` (validée ; Nadia absente), `Séance d'appel 3 test guide` (validée ; tous présents), `Séance d'appel 4 test guide` (appel annulé).
- Justificatifs : `DIABATE Nadia` (Maladie, pièce PDF, accepté puis révoqué), `DIABATE Salimata` (Autre, pièce PNG, rejeté) ; absence justifiée de `TOURE Yao` (Difficulté de transport).
- Règle d'alerte `TG_ABSENCES_2` (active) ; aucune surcharge d'assiduité restante.
- Congé annuel de `TRAORE Kouadio` le 16/10/2026 (approuvé) ; deux « Absence autorisée » (refusée, annulée) ; pointage du jour de TRAORE Kouadio ; présence « En retard » de `YAO Fatou` ; `Séance de remplacement test guide` remplacée par `YAO Fatou`.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](06-emploi-du-temps.md) · [Suivant →](08-evaluations-notes.md)
