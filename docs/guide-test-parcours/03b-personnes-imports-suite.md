[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](03a-personnes-imports.md) · [Suivant →](04-admissions.md)

# Phase 3 (suite) — Personnes : tuteurs, élèves, personnel, inscriptions et imports

*Suite de la phase 3 : reprise à l'étape 42.*

---

## Étape 42 — Inscrire KOUASSI Aïcha en 6e B
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **« Inscriptions »** > onglet **« Nouvelle inscription »** (`/v2/enrollments/new`)

1. Étape « Élève » : choisir « Élève existant » ; dans « Élève », chercher `Aïcha test guide` et choisir celle au **matricule N relevé plus haut**.
2. Étape « Classe » : « Année » = année courante (proposée) ; « Classe » = `6e B test guide` ; lire "Effectif : 0 sur 30. La capacité est indicative." ; « Mode d'inscription » = « Par classe (cursus complet) » ; « Date d'inscription » vide ; « Redoublement » décoché.
3. Étape « Financement » : « Type de financement » = « Privé » (laisser).
4. Étape « Récapitulatif » : cliquer **« Inscrire »**.

✅ Écran « Inscription enregistrée » : "N° d'inscription : DEMO-… Statut : en attente de confirmation." **Relever le numéro d'inscription**. Boutons « Ouvrir l'inscription », « Inscrire un autre élève », « Retour à la liste ».

⚠️ *Test d'erreur* : « Suivant » sans élève → « Choisissez un élève. » ; sans classe → « Choisissez une classe. » ; réinscrire Aïcha dans `6e B test guide` → avertissement "Cet élève a déjà une inscription en cours cette année. Le serveur refusera un doublon dans la même classe." puis refus "L'apprenant a déjà une inscription vivante dans cette classe."

🔒 *Test de droit* : en tant que **directeur des études**, taper `/v2/enrollments/new` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 43 — Contrôler l'inscription en attente
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **« Inscriptions »** > onglet **« Liste des inscriptions »** (`/v2/enrollments`)

1. Dans le filtre « Statut », choisir « En attente », puis ouvrir l'inscription de KOUASSI Aïcha test guide (**« Ouvrir »**).
2. Lire la section « Confirmation et frais d'inscription » : "Politique de confirmation : confirmée au paiement des frais d'inscription." puis "L'inscription attend sa confirmation, selon la politique ci-dessus."

✅ Statut « En attente ». Le secrétariat ne voit que le bouton « Annuler » (pas de « Confirmer »). L'effectif de `6e B test guide` est 1 / 30.

3. Se déconnecter, se connecter en **directeur** et ouvrir la même fiche : le bouton **« Confirmer sans paiement »** est proposé. **Ne pas confirmer** (voir le test d'erreur ci-dessous) : l'inscription doit rester « En attente » jusqu'au paiement des frais (facture d'inscription, phase *Finance*).

⚠️ *Test d'erreur* : cliquer **« Confirmer sans paiement »**, laisser « Motif » vide et valider → « Le motif doit comporter au moins 5 caractères. » (vérifier qu'aucune confirmation n'a lieu, puis fermer la fenêtre **sans** saisir de motif valide).

📚 La dérogation, la suspension, le transfert vers `6e C test guide`, l'annulation et le retrait sont des actions à effet durable : voir chapitre 04, scénarios 4.23 à 4.28 (ils utilisent des élèves "2" et "3" qui ne sont pas créés dans ce guide).

☐ OK ☐ KO

---

## Étape 44 — Lire l'historique des imports et l'import de démonstration
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Menu **"Imports"** > **"Imports Excel / CSV"** (`/v2/imports`)

1. Lire la barre d'onglets : « Historique », « Nouvel import », « Modèles » (pas de « Paramètres » pour ce compte).
2. Lire le tableau « Historique des imports » : ligne `eleves-demonstration.csv`, Données "Élèves", « Prêt à importer », "15 ligne(s)".
3. Cliquer sur le nom du fichier : la fiche s'ouvre à l'étape « 4. Erreurs et aperçu avant import ».

✅ Compteurs « À créer » 0, « En erreur » 15, et le message `La colonne "Classe" exige l'option "Année scolaire des inscriptions".` (15 ×). Le bouton « Lancer l'import » est inactif. ⚠️ *Écart connu* : l'état « Prêt à importer » avec 15 erreurs est un défaut connu de la graine. **Ne rien lancer**, cliquer **« Retour à l'historique »**.

🔒 *Test de droit* : en tant que **éducateur** (`educateur@secondaire-test.test`, fenêtre **B**), taper `/v2/imports` → « Accès refusé ». Idem `/v2/imports/settings` pour le secrétariat.

☐ OK ☐ KO

---

## Étape 45 — Télécharger le gabarit des élèves
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

1. Lire le titre "1. Choisir l'importeur et envoyer le fichier". Les cartes utilisables sont "Élèves", "Parents et tuteurs", "Inscriptions" ; les autres sont grisées avec "Droits manquants : ...".
2. Cliquer la carte **"Élèves"** : la section "Colonnes attendues pour "Élèves"" liste les colonnes (« obligatoire » sur Nom, Prénoms, Sexe).
3. Cliquer **« Télécharger le modèle CSV »** (le navigateur peut demander l'autorisation). Faire de même avec **« Télécharger le modèle Excel »**.
4. Ouvrir `modele-import-students.csv` dans le Bloc-notes.

✅ Fichiers `modele-import-students.csv` et `modele-import-students.xlsx` téléchargés. Le CSV est en `;`, 2 lignes d'exemple fictives (KONE Aminata, TRAORE Ibrahim) et les mêmes en-têtes que ceux des fichiers du dossier `jeux-de-donnees`. L'Excel a une feuille "Données" et une feuille "Aide".

⚠️ *Test d'erreur* : cliquer **« Envoyer et continuer »** sans rien choisir → "Choisissez le type de données à importer." puis, une fois la carte choisie, "Choisissez un fichier .xlsx, .xls, .ods ou .csv."

☐ OK ☐ KO

---

## Étape 46 — Importer 10 élèves (fichier valide)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/01-students-valide-secondaire.csv` (10 élèves, classe `6E-A`).

1. Carte **"Élèves"** ; « Fichier à importer » = le fichier ; « Feuille (facultatif) » vide ; **« Envoyer et continuer »**.
2. Étape "2. Associer les colonnes du fichier" : "Le fichier compte 18 colonne(s)." Vérifier que les 18 champs sont associés. Options : "Année scolaire des inscriptions" = **l'année courante** ("Année scolaire 2026-2027 (courante)") ; "Doublons probables (même nom et même naissance)" = "Refuser (recommandé)" ; « Si la donnée existe déjà » = « Ignorer les lignes déjà présentes ».
3. Cliquer **« Enregistrer et valider le fichier »** et attendre la barre « Validation des lignes ».

✅ Aperçu : « À créer » **10**, « À mettre à jour » 0, « À ignorer » 0, « En erreur » **0**, « Avertissements » 0, et "Aucune erreur : toutes les lignes sont valides."

4. Mode « Importer les lignes valides seulement » (par défaut). Cocher « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. » puis cliquer **« Lancer l'import »**.

⚠️ **Irréversible** : les 10 élèves sont créés définitivement.

✅ Écran « Import en cours » (« En attente de traitement » puis « Import en cours »), puis rapport « Import terminé » : « Créées » **10**, « Mises à jour » 0, « Ignorées » 0, « En erreur » 0. Si la barre reste à 0, vérifier que le worker est démarré et recharger la page.

⚠️ *Test d'erreur* (avant le lancement, à l'étape des colonnes) : associer « Nom » à "— Ne pas importer ce champ —" → "Associez une colonne à ce champ obligatoire." et bandeau "Champs obligatoires sans colonne : Nom." Remettre l'association.

☐ OK ☐ KO

---

## Étape 47 — Contrôler les 10 élèves importés
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** (`/v2/students`)

1. Rechercher `test guide`.

✅ On retrouve, outre KOUASSI Aïcha test guide (créée à la main, 6e B, « En attente »), les 10 élèves importés, classe **6e A**, inscription « En attente » : KOUASSI Aïcha test guide, KOUASSI Yves test guide, KONÉ Fanta test guide, TRAORE Mamadou test guide, YAO Adjoua test guide, BAMBA Ismaël test guide, COULIBALY Awa test guide, DIABATE Seydou test guide, BROU Esther test guide, OUATTARA Souleymane test guide.

2. Ouvrir la fiche de l'**Aïcha importée** (classe 6e A) : naissance **12/03/2014**, lieu Abidjan, e-mail `aicha.kouassi.tg@exemple.test`. Ne pas la confondre avec celle du matricule N (12/05/2014, 6e B).
3. Menu **« Académique »** > **"Classes"** (`/v2/academic/classrooms`), fiche de la 6e A : « Effectif » **22 sur 40**.

✅ 10 élèves et 10 inscriptions créés ; la 6e A passe de 12 à **22 / 40** ; `6e B test guide` reste à 1 / 30.

☐ OK ☐ KO

---

## Étape 48 — Importer le fichier avec erreurs (3 lignes valides sur 15)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/01-students-erreurs-secondaire.csv` (15 lignes). Carte **"Élèves"**, options : année courante, "Refuser (recommandé)", « Ignorer les lignes déjà présentes ».

1. Envoyer le fichier, vérifier l'association des colonnes, **« Enregistrer et valider le fichier »**.

✅ Aperçu : « À créer » **3**, « En erreur » **12**, « Avertissements » **1**. Le numéro de ligne est celui du tableur (en-tête = ligne 1). Les erreurs attendues :

| Ligne | Contenu | Message attendu |
| :-: | :--- | :--- |
| 2 | TG-ERR-01 SANGARE Mariam | valide |
| 3 | sexe vide | Le champ "Sexe" est obligatoire. |
| 4 | sexe `X` | "Sexe" : valeur non reconnue (attendu M ou F) |
| 5 | naissance 31/02/2014 | Date de naissance : "31/02/2014" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ). |
| 6 | naissance 01/01/2099 | La date de naissance est dans le futur. |
| 7 | nom vide | Le champ "Nom" est obligatoire. |
| 8 | classe `6E-Z` | Classe "6E-Z" inconnue pour cette année scolaire. |
| 9 | financement `XYZ` | Type de financement "XYZ" inconnu. |
| 10 | e-mail `ange.tiemoko.exemple.test` | E-mail : "ange.tiemoko.exemple.test" n'est pas une adresse e-mail valide. |
| 11 | téléphone `12` | Téléphone : "12" n'est pas un numéro de téléphone valide. |
| 12 | nationalité `CIV` | "Nationalité (code pays)" : code pays à deux lettres attendu (ex. CI) |
| 13 | matricule TG-ERR-01 répété | Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée. |
| 14 | DIABATE Nadia, 19/01/2014 | Doublon probable avec : DIABATE Nadia (00001). Vérifiez, ou choisissez "créer malgré le doublon". |
| 15 | TG-ERR-13 ZOKORA Léonie | valide |
| 16 | sans matricule d'origine, LOROUGNON | avertissement : "Aucun matricule d'origine : les doublons ne seront détectés que par le nom et la date de naissance." (ligne valide) |

2. Constater que le mode « Tout ou rien » est grisé : "Indisponible tant que le fichier contient des erreurs."
3. Cliquer **« Télécharger les erreurs (CSV) »** : fichier `01-students-erreurs-secondaire-erreurs.csv`, une ligne par problème (Ligne, Colonne du fichier, Champ, Gravité, Code, Message).
4. Mode « Importer les lignes valides seulement », cocher la confirmation, **« Lancer l'import »**.

⚠️ **Irréversible** : 3 élèves sont créés (TG-ERR-01 SANGARE Mariam, TG-ERR-13 ZOKORA Léonie, LOROUGNON Dominique, tous "test guide").

✅ Rapport « Import terminé avec des erreurs » : « Créées » **3**, « En erreur » **12**. La 6e A passe à **25 / 40**.

☐ OK ☐ KO

---

## Étape 49 — Rejouer le fichier valide (aucun doublon)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

1. Carte **"Élèves"**, envoyer de nouveau `01-students-valide-secondaire.csv`.

✅ Au titre "2. Associer les colonnes du fichier", l'avertissement : "Ce fichier (même contenu) a déjà été importé : les lignes déjà importées seront ignorées, sans doublon."

2. Choisir l'année courante, garder « Ignorer les lignes déjà présentes », **« Enregistrer et valider le fichier »**.

✅ « À ignorer » **10**, « À créer » 0 ; chaque ligne porte "Déjà importée lors d'un import précédent : ligne ignorée (aucun doublon)." ; le message "Aucune ligne à écrire : toutes les lignes sont invalides ou déjà importées." s'affiche et **« Lancer l'import » reste inactif**. Quitter par « Retour à l'historique » (cet import reste « Prêt à importer » et compte dans le quota des imports actifs, sans conséquence ici).

☐ OK ☐ KO

---

## Étape 50 — Importer 6 élèves sans classe
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/01-students-sans-classe-secondaire.csv` (6 élèves `TG-INS-01` à `TG-INS-06`, sans colonne Classe).

1. Carte **"Élèves"**, envoyer le fichier, valider les colonnes (aucune option d'année nécessaire), **« Enregistrer et valider le fichier »**.

✅ « À créer » **6**.

2. Cocher la confirmation, **« Lancer l'import »**.

⚠️ **Irréversible**.

✅ « Créées » **6**. Dans `/v2/students`, chercher `test guide` : ABLE Rachel, BAH Moussa, CAMARA Hawa, DJÉ Armand, EHUI Sylvie, FOFANA Karim existent avec la mention « Non inscrit ». La 6e A reste à 25 / 40.

☐ OK ☐ KO

---

## Étape 51 — Inscrire ces 6 élèves par fichier
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/06-enrollments-valide-secondaire.csv` (6 lignes vers `6E-A`).

1. Carte **"Inscriptions"** ; option "Année scolaire des inscriptions" = année courante ; envoyer le fichier ; **« Enregistrer et valider le fichier »**.

✅ « À créer » **6**. La ligne 5 saisit la classe en minuscules (`6e-a`) avec la date `15/09/2026` : elle est acceptée.

2. Cocher la confirmation, **« Lancer l'import »**.

⚠️ **Irréversible**.

✅ « Créées » **6** ; les 6 élèves ont une inscription « En attente » en 6e A. La 6e A passe à **31 / 40**.

⚠️ *Test d'erreur* : rejouer ce même fichier, l'aperçu doit annoncer « À ignorer » 6 (l'élève est déjà inscrit dans la classe) et rien à écrire.

☐ OK ☐ KO

---

## Étape 52 — Importer un classeur Excel (.xlsx)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/01-students-formats-secondaire.xlsx` (feuille "Eleves", 5 lignes : 4 valides, 1 avec la date 31/02/2014). **N'importer qu'un seul des quatre formats** (`.csv`, `.xlsx`, `.xls`, `.ods`) : la capacité de la 6e A est comptée avec un seul.

1. Carte **"Élèves"**, « Fichier à importer » = le `.xlsx`, « Feuille (facultatif) » vide, **« Envoyer et continuer »**, année courante, **« Enregistrer et valider le fichier »**.

✅ « À créer » **4**, « En erreur » **1** : ligne 6, Date de naissance : "31/02/2014" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ).

2. Mode « Importer les lignes valides seulement », confirmation, **« Lancer l'import »**.

⚠️ **Irréversible**.

✅ « Import terminé avec des erreurs » : « Créées » **4**, « En erreur » 1 (ABONOUAN Judicaël, BINI Francine, COULIBALY Mamadou, DADIÉ Annick, tous "test guide").

⚠️ *Test d'erreur* : fichier `docs/guide-test/jeux-de-donnees/imports-cas-limites/faux-classeur-texte.xlsx` → le bandeau sous « Envoyer et continuer » dit `Le fichier se nomme ".xlsx" mais son contenu est du texte, pas un classeur Excel.` et aucun import n'est créé.

☐ OK ☐ KO

---

## Étape 53 — Contrôler l'effectif final de la 6e A
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **"Classes"** (`/v2/academic/classrooms`)

1. Filtrer l'« Année » sur 2026-2027 et ouvrir la fiche de la 6e A (`6E-A`).
2. Lire « Effectif » et la section « Élèves ».

✅ « Effectif » **35 sur 40** (12 de la graine + 10 + 3 + 6 + 4), « Capacité » « Bloquante » *(à vérifier)*. Les nouveaux inscrits sont « En attente » (confirmés au paiement des frais d'inscription, phase *Finance*). Liste de la 6e A : colonne « Effectif » `35 / 40`.

📚 *Pour aller plus loin* : chapitre 04, scénarios 4.7 (tuteurs d'un élève), 4.9 (antécédents), 4.11 et 4.18 (invitations), 4.16 (qualifications, compétences, disponibilités), 4.17 (statut du personnel), 4.22 à 4.29 (dérogation, suspension, transfert, classe pleine, financement, annulation, retrait, droits et isolation) ; chapitre 05, scénarios 5.4 à 5.11 (modèles, réglages, plafonds, quota), 5.14 à 5.15 (rejeu, mise à jour), 5.16 à 5.32 (primaire et supérieur, tuteurs, personnel, classes, curriculum, notes, soldes d'ouverture, autres formats, annulation d'un import).

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :**
- Tuteur `KOUASSI Marcel test guide` (`marcel.kouassi.tg@exemple.test`), père, contact principal et responsable financier d'Aïcha, 1 enfant lié.
- Élève `KOUASSI Aïcha test guide` (née le 12/05/2014, matricule N relevé), inscrite en `6e B test guide` (`TG-6EB`) : inscription **En attente** (numéro d'inscription relevé), à confirmer par le paiement des frais d'inscription dans la phase *Finance*. Pièce "Acte de naissance test guide" déposée puis retirée ; aucun contact d'urgence (celui de DIABATE Nadia a été retiré).
- Personnel `OUATTARA Zénon test guide` (matricule `P00NN` relevé), enseignant, responsable de Mathématiques de `6e B test guide` (4 h), contrat à durée déterminée terminé, sans compte de connexion.
- 6e A : **35 / 40** élèves, dont 23 élèves "test guide" importés : `TG-ELV-S01` à `S10` (dont l'autre KOUASSI Aïcha test guide, 12/03/2014), `TG-ERR-01`, `TG-ERR-13`, LOROUGNON Dominique, `TG-INS-01` à `06` (inscriptions en attente), `TG-FC-01` à `04`. Les `TG-ELV-S01` à `S09` serviront aux soldes d'ouverture et aux tuteurs importés (chapitre 05).
- Historique des imports : 1 import de démonstration inchangé (« Prêt à importer »), 1 rejeu du fichier valide laissé « Prêt à importer », 5 imports exécutés ou terminés avec des erreurs.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](03a-personnes-imports.md) · [Suivant →](04-admissions.md)
