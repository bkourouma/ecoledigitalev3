[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](22a-primaire.md) · [Suivant →](23-superieur.md)

# Phase 22 (suite) — École Les Palmiers (primaire) : compétences, conseil des maîtres, bilan annuel

*Suite de la phase 22 : reprise à l'étape 408.*

---

## Étape 408 — Banque d'appréciations : lire et rédiger
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Appréciations »** (`/v2/primary/appreciations`)

1. Lire « Banque de phrases pour rédiger vos appréciations. Une phrase propose du texte : elle n'est jamais appliquée seule. » et la liste « Phrases de la banque » : 3 phrases de démonstration. Pas de bouton « Nouvelle phrase » ni « Désactiver » (« Vous pouvez consulter la banque ; sa gestion est réservée à la direction. »).
2. Filtre « Portée » = « Année » : une seule phrase. Revenir à « Tous ».
3. Sur la phrase `PERIOD_N3`, cliquer **« Ajouter à ma rédaction »**, cocher **« J'ai relu et je valide ce texte »**, cliquer **« Copier le texte validé »**.

✅ « Texte copié : collez-le dans l'appréciation du bulletin. » ; note « Ce texte n'est enregistré nulle part ici. L'appréciation générale s'écrit dans le module Résultats (appréciations de la période). »

☐ OK ☐ KO

---

## Étape 409 — Créer une phrase de la banque (direction des études)
👤 **directeur des études** (primaire-test) `etudes@primaire-test.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Appréciations »** (`/v2/primary/appreciations`)

1. Cliquer **« Nouvelle phrase »**. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_PHRASE_LECTURE` |
| Portée | `Période` |
| Texte de la phrase | `Lecture fluide en progrès constant (test guide).` |
| Niveau de maîtrise | `N3` |
| Niveau de classe | `CP1` |

2. Cliquer **« Créer la phrase »**.
3. Cliquer **« Désactiver »** sur cette phrase, cocher « Afficher aussi les phrases désactivées », puis **« Activer »** et de nouveau **« Désactiver »**.

✅ « Phrase créée. » (sans pastille « Démonstration ») ; une fois désactivée : pastille « Désactivée » et « Ajouter à ma rédaction » inactif.

⚠️ *Test d'erreur* : code `tg-phrase` (tiret, minuscules) → "Code attendu : majuscules, chiffres et _ (2 à 60)."

🔒 *Test de droit* : le secrétariat tape `/v2/primary/appreciations` → "Accès refusé".

☐ OK ☐ KO

---

## Étape 410 — Lire le conseil des maîtres tenu (Grande Section A)
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Conseil des maîtres »** (`/v2/primary/conseil`)

1. Lire « Préparation, présence, dossiers élève par élève, décisions et procès-verbal. La règle propose, le conseil confirme. ». Dans « Mes conseils », la ligne **Grande Section A** : « 5 dossiers · 0 à examiner · 5 décidés ». Cliquer **« Ouvrir »**.
2. « Feuille de présence » : ZOKORA Sylvie « Titulaire de la classe » (présente, « Signée le … »), `DIRECTEUR Conseil` (président, présent, non signé), `SECRETAIRE Conseil` (secrétaire, présente, non signée) ; quorum "Aucun quorum bloquant : 3 convoqués, 3 présents.".
3. « Dossiers, un par un » : parcourir les 5 dossiers.
4. Section « Procès-verbal » : « Un procès-verbal a déjà été demandé pour ce conseil. »

✅ ADOU Aïcha, ASSI Brice, DAGO Chantal, EKRA Désiré : « Passage en classe supérieure » ; **FOFANA Estelle : « Redoublement »**, justification "Une compétence jamais évaluée de l'année : maintien décidé par le conseil (démonstration).". Les 5 dossiers sont « Décidé ».

🔒 *Test de droit* : l'instituteur de maternelle ouvre ce même conseil en lecture : « La feuille de présence est tenue par la présidence du conseil. », ni « Confirmer la décision » ni « Demander le procès-verbal ».

☐ OK ☐ KO

---

## Étape 411 — Conseil du CP1 A : préparer et proposer (instituteur)
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Conseil des maîtres »** (`/v2/primary/conseil`) > « Préparer un conseil »

1. Choisir la classe **CP1 A** et la période 1 (close, avec résultats), laisser la date vide, cliquer **« Préparer le conseil »**.
2. Si le conseil est préparé : ouvrir-le, section « Ma proposition » sur un dossier : choisir `Redoublement`, saisir « Notes et observations » = `Lecture non acquise (test guide)`, cliquer **« Enregistrer ma proposition »**. Cliquer ensuite « Reporter ce dossier » puis « Remettre à l'examen ».

✅ « Conseil préparé : un dossier par élève a été créé. » puis « Proposition enregistrée. ». La proposition de l'instituteur ne vaut pas décision.

⚠️ *Écart connu* : la préparation peut être refusée faute d'état de résultats pour la classe et la période ; relever le message exact, marquer l'étape "bloquée" et passer à la suivante (le conseil de la Grande Section A suffit pour la suite).

☐ OK ☐ KO

---

## Étape 412 — Conseil du CP1 A : présence, décision et procès-verbal (direction)
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Conseil des maîtres »** (`/v2/primary/conseil`) > conseil du CP1 A

Précondition : étape précédente réussie (sinon passer à *Bilans annuels*).

1. Dans « Feuille de présence » : au moins un « Président » et un « Secrétaire » « Présent », puis **« Enregistrer la feuille de présence »** (sans cocher de signature).
2. Sur un dossier, section « Décision du conseil » : « Confirmer la proposition de la règle » si elle existe, sinon « Retenir un autre code » avec « Décision retenue » = `Passage en classe supérieure` et « Justification » = `Décision de test guide prise en séance pour un cas limite`. Cliquer **« Confirmer la décision »**.
3. Saisir « Date réelle de la séance » = `2026-10-08` et cliquer **« Demander le procès-verbal »**.

✅ « Feuille de présence enregistrée. » ; « Décision enregistrée : Passage en classe supérieure. » (avec « Elle diffère de la proposition de la règle ; la justification est conservée. » en cas d'écart) ; « Procès-verbal demandé : il sera disponible dans les documents officiels. » (si au moins une décision existe).

⚠️ *Test d'erreur* : justification de 5 caractères pour un écart → « La justification compte au moins 20 caractères. »

⚠️ *Écart connu* : sans résultats calculés, la décision est refusée : `La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés.` (à relever).

☐ OK ☐ KO

---

## Étape 413 — Bilans annuels : lire et préparer les brouillons
👤 **directeur des études** (primaire-test) · fenêtre **A** · 📂 Menu **« Bilans annuels »** (`/v2/primary/bilans`)

1. Lire « Préparez, scellez et réémettez les bilans annuels d'une classe. Un bilan scellé est immuable. ». Choisir « Année » = 2026-2027 et « Classe » = Grande Section A.
2. Lire le tableau « Bilans annuels de la classe » (colonnes « Élève », « Version », « Statut », « Décision », « Empreinte », « Règles »).
3. Cliquer **« Préparer les brouillons »**.
4. Choisir la classe CP1 A, cliquer de nouveau « Préparer les brouillons ».

✅ 5 lignes « Version 1 » : **3 « Scellé »** (avec « Scellé le … » et une empreinte tronquée à 12 caractères) et **2 « Prêt à sceller »** (bouton « Sceller » visible à droite de ces deux seules lignes) ; décision « Passage en classe supérieure » sauf FOFANA Estelle « Redoublement » ; colonne « Règles » : « Règles de démonstration ». Étape 3 : message du type « Brouillons préparés : 0 créés, 2 actualisés, 3 scellés laissés intacts. » (valeurs à relever ; **noter lesquels sont « Prêt à sceller »**). Étape 4 : « Aucun bilan pour cette classe et cette année. » puis refus de préparation (pas de résultat d'année final ni de conseil) : relever le message.

🔒 *Test de droit* : ce compte prépare mais n'a ni « Sceller » ni « Réémettre » (réservés au directeur de l'école).

☐ OK ☐ KO

---

## Étape 414 — États du primaire
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« États du primaire »** (`/v2/primary/etats`)

1. Lire le bandeau « Règles de démonstration » et la liste « Rapport » (sept rapports).
2. Choisir **« Liste de classe »**, « Classe » = Grande Section A, cliquer **« Afficher l'aperçu »**.
3. Choisir **« Couverture des compétences »**, « Classe » = Grande Section A, « Période » = semestre 1, **« Afficher l'aperçu »**.
4. Choisir **« Dossier du conseil des maîtres »**, « Conseil » = celui de la Grande Section A, **« Afficher l'aperçu »**.
5. Cliquer **« Exporter en CSV »** (le fichier est téléchargé ; séparateur point-virgule).

✅ Liste de classe : colonnes `N°`, `Élève`, `Redoublant`, 5 lignes, titre "Liste de classe — Grande Section A". Couverture : FOFANA Estelle `3, 2, 2, 1` (attendues, saisies, validées, non évaluées), les quatre autres `3, 3, 3, 0`. Dossier du conseil : 5 lignes toutes décidées. L'export reproduit l'aperçu.

⚠️ *Test d'erreur* : « Liste de classe » sans classe → « Renseignez les paramètres obligatoires pour produire ce rapport. » (boutons inactifs).

🔒 *Test de droit* : en tant que directeur des études, taper `/v2/primary/parametres` → "Accès refusé" (seule page refusée).

☐ OK ☐ KO

---

## Étape 415 — Archive d'année (préparation, jamais de gel)
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Archives d'année »** (`/v2/primary/archives`)

1. Choisir l'année 2026-2027 (« Choisir une année »). Cliquer **« Préparer l'archive »**.
2. Lire la carte « Archive : En préparation » et la liste « Ce qui empêche le gel : ».

✅ « Archive préparée. » ; "3 bilans scellés sur 5" ; empêchements attendus : `L'année académique n'est pas clôturée.`, `2 bilan(s) non scellé(s).`, `8 inscription(s) sans bilan annuel.` *(chiffres à relever)*. Aucun bouton « Geler l'archive ».

⚠️ *Écart connu* : l'archive ne peut pas devenir « Prête à geler » dans la démonstration (année non close, élèves du CP1 A sans bilan). **Ne pas chercher à geler** : le gel est irréversible pour toute l'école.

☐ OK ☐ KO

---

## Étape 416 — Espace famille : le parent et l'élève
👤 **parent** puis **élève** (`eleve@primaire-test.test`, pas de MFA) · fenêtre **B** · 📂 Menu **« Bulletin et compétences »** (`/v2/primary/mon-enfant`)

1. Parent : la liste « Enfant » propose **DIABATE Nadia — CP1 A** et **DIABATE Salimata — CP1 A** (aucun enfant de la Grande Section). Choisir Nadia : section « Compétences des périodes prêtes ou validées » avec le compteur du semestre 2 ("Acquis avec aisance" : 1 après la révision) ; « Bilans annuels » : « Aucun bilan annuel publié pour le moment. ».
2. Choisir Salimata : compteurs propres ("En cours d'acquisition" : 1), aucune donnée de Nadia.
3. Élève : titre « Mon bilan et mes compétences », mêmes sections pour Nadia seulement, sans liste d'enfants.

✅ Le parent ne voit que ses enfants ; compteurs seulement, jamais de moyenne ni de saisie brouillon.

🔒 *Test de droit* : parent puis élève tapent `/v2/primary/classe`, `/v2/primary/bilans` → "Accès refusé".

☐ OK ☐ KO

---

## Étape 417 — ⚠️ Irréversible : signer la feuille de présence du conseil
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Conseil des maîtres »** (`/v2/primary/conseil`) > conseil de la Grande Section A

⚠️ Irréversible : une présence signée est figée.

1. Sur `SECRETAIRE Conseil`, régler « Présence de SECRETAIRE Conseil » sur « Absent » : la case « Signature de SECRETAIRE Conseil » devient inactive. Remettre « Présent ».
2. Cocher la signature, cliquer **« Enregistrer la feuille de présence »**.
3. Essayer de modifier cette ligne.

✅ « Feuille de présence enregistrée. » ; « Signée le … » ; la ligne est verrouillée (« Une présence signée est figée : elle ne peut plus être modifiée. »). La ligne de ZOKORA Sylvie (déjà signée) n'a jamais été modifiable.

⚠️ *Test d'erreur* : signature cochée alors que la personne est « Absent » → « Une signature exige que la personne soit marquée présente. »

☐ OK ☐ KO

---

## Étape 418 — ⚠️ Irréversible : sceller un bilan annuel
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Bilans annuels »** (`/v2/primary/bilans`, Grande Section A)

⚠️ Irréversible : un bilan scellé devient immuable (contenu, décision, empreinte). **Une seule fois**, sur un seul bilan.

1. Sur un bilan « Prêt à sceller » (noté à l'étape *Bilans annuels : lire et préparer les brouillons*), cliquer **« Sceller »**.
2. Lire la fenêtre « Sceller ce bilan » et confirmer **« Sceller le bilan »**.
3. Retourner dans « Archives d'année » et cliquer « Préparer l'archive ».

✅ « Bilan de … scellé. » ; statut « Scellé », empreinte et « Scellé le … » visibles, le bouton « Sceller » disparaît (PDF produit en arrière-plan). L'archive affiche "4 bilans scellés sur 5" ; les deux autres empêchements demeurent.

⚠️ *Test d'erreur* : sceller sans décision du conseil confirmée → « La décision du conseil des maîtres doit être confirmée avant de sceller. » (non atteignable sur la Grande Section : toutes les décisions sont prises).

🔒 *Test de droit* : le directeur des études n'a pas « Sceller » (étape déjà constatée) ; l'instituteur ouvre `/v2/primary/bilans` en lecture seule, sans bouton.

☐ OK ☐ KO

---

## Étape 419 — ⚠️ Irréversible : réémettre un bilan scellé
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Bilans annuels »** (`/v2/primary/bilans`, Grande Section A)

1. Sur un bilan « Scellé » (de préférence celui scellé à l'étape précédente), cliquer **« Réémettre »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Motif de la réémission | `Correction de la décision de passage (test guide)` |

3. Cliquer **« Réémettre »**.

✅ « Nouvelle version du bilan de … créée : elle doit être scellée à son tour. » ; la version 2 est en brouillon, la version 1 « Remplacé par une version plus récente ». Resceller la version 2 si on veut rétablir la visibilité familiale (nouvelle empreinte).

⚠️ *Test d'erreur* : motif de moins de 10 caractères → « Le motif doit comporter au moins 10 caractères. »

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 18, scénarios 18.5 à 18.8 (cas fins de la grille, conflit, hors ligne), 18.9 (filtres de la banque), 18.11 (rôles et doublons de la feuille de présence), 18.17 (Paramètres : réglages, modèle de pack, échelles, référentiels), 18.19 (vérification publique d'un bilan scellé sur `/v2/verify`), 18.20 à 18.22 (droits, autres établissements, qualité). Appels : chapitre 06, scénarios 6.9 à 6.11. Admissions de la maternelle : chapitre 17, scénario 17.28.

**Ce que la phase laisse dans l'application :**
- Appels du jour : CP1 A (matin avec BAMBA Fatou absente, après-midi) et Grande Section A (éventuellement EKRA Désiré absent), validés par le directeur.
- CP1 A, semestre 2 : compétences de DIABATE Nadia (N4 après révision `Correction après relecture du cahier de classe (test guide)`), DIABATE Salimata (N2), BAMBA Aya (N4), **grille validée** ; 5 élèves « Non évaluée ». Marquage "prête" posé puis retiré (`Erreur de marquage constatée (test guide)`).
- Phrase `TG_PHRASE_LECTURE` (`Lecture fluide en progrès constant (test guide).`), désactivée.
- Conseil du CP1 A (si préparé) : proposition `Lecture non acquise (test guide)`, décision et justification de test, procès-verbal éventuel.
- Grande Section A : `SECRETAIRE Conseil` présente et **signée** ; **4 bilans scellés sur 5** (dont un réémis en version 2 en brouillon) ; archive d'année « En préparation » (non gelée).

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](22a-primaire.md) · [Suivant →](23-superieur.md)
