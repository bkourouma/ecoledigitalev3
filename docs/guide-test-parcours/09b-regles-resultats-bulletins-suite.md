[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](09a-regles-resultats-bulletins.md) · [Suivant →](10-vie-scolaire.md)

# Phase 9 (suite) — Règles, résultats et bulletins

*Suite de la phase 9 : reprise à l'étape 159.*

---

## Étape 159 — Rouvrir le Trimestre 3 puis le reclôturer (facultatif)
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/results` > `6e A` > `Trimestre 3`

Acte sensible : ne le faire **que** sur le Trimestre 3, jamais sur le Trimestre 1.

1. Cliquer **« Rouvrir la période »** : « Nature de la réouverture » = « Correction (toutes les notes redeviennent modifiables) ». Motif `Test`, valider ; puis `Réouverture d'essai du guide de test`, valider.
2. *(Reconnexion en directeur des études.)* Ouvrir "Devoir commun test guide" (Français), **« Annuler l'évaluation »**, motif `Évaluation de test abandonnée (test guide)`.
3. Toujours en directeur des études, `/v2/results` : **« Verrouiller les notes »** (sans avertissement), puis **« Clôturer la période »**.

✅ Motif `Test` → « Le motif doit faire au moins 10 caractères. » ; puis « La période est rouverte. », état « Ouverte », « Rouverte une fois. Dernier motif : Réouverture d'essai du guide de test ». Après reclôture : « Période clôturée : N résultats figés (version 2), aucune exclusion. » ; « Clôtures » liste « Version 1 » et « Version 2 » ; chiffres du Trimestre 3 inchangés.

🔒 *Test de droit* : le directeur des études n'a **pas** le bouton « Rouvrir la période ».

☐ OK ☐ KO

---

## Étape 160 — Identité de l'établissement
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu "BULLETINS" > "Identité et signataires" (`/v2/reportcards/identity`)

*(« Se déconnecter » du directeur des études, puis connexion en directeur.)*

1. Lire « Identité de l'établissement et réglages » : "Version 1 enregistrée le …", « Nom officiel » Collège Le Baobab, « Couleur principale » `#14532D`.
2. Compléter :

| Champ | Valeur |
| :--- | :--- |
| Téléphone | `+225 27 21 00 00 00` |
| Adresse électronique | `contact@exemple.test` |
| Site internet | `www.exemple.test` |
| Référence d'agrément | `AGR-TG-0001` |
| Pied de page | `Document de démonstration test guide` |
| Logo | fichier `docs/guide-test/jeux-de-donnees/logo-test-guide.png` |

3. Après « Téléversement… » puis « Téléversé », cliquer **« Enregistrer l'identité »**.

✅ « L'identité est enregistrée (version 2). » ; "Version 2 enregistrée le …" ; le détail « 2 versions de l'identité » donne le badge « En vigueur » à la version 2 ; valeurs conservées après F5. Les bulletins déjà émis ne changent pas.

⚠️ *Test d'erreur* : « Nom officiel » vidé → « Ce champ est obligatoire. » ; « Couleur principale » `vert` → "Couleur attendue au format #RRGGBB." ; « Logo » = `docs/guide-test/jeux-de-donnees/format-invalide-test-guide.txt` → « Format non accepté : PNG, JPEG, WebP ou GIF. ».

⚠️ *Écart connu* : l'entrée de menu "Identité et signataires" mène à la page « Identité et réglages » ; les signataires sont une autre rubrique de la barre.

☐ OK ☐ KO

---

## Étape 161 — Créer un signataire
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Rubrique « Signataires » (`/v2/reportcards/signatories`)

1. Lire la liste : "Directeur Fictif", badge « Actif », « aucune signature ».
2. Cliquer **« Nouveau signataire »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom complet | `KONÉ Mamadou test guide` |
| Qualité | `Le Directeur` |
| Fonction | `Chef d'établissement test guide` |
| Valide à partir du | `2026-09-01` |
| Valide jusqu'au | *(vide)* |
| Signature (image) | fichier `docs/guide-test/jeux-de-donnees/signature-test-guide.png` |

3. Cliquer **« Créer le signataire »**.
4. Sur sa ligne : **« Désactiver »**, puis **« Activer »**.

✅ « Le signataire KONÉ Mamadou test guide est enregistré. » ; ligne « Actif », "Le Directeur", « signature enregistrée » ; « Le signataire KONÉ Mamadou test guide est désactivé. » puis « Le signataire KONÉ Mamadou test guide est activé. » (état final **actif**).

⚠️ *Test d'erreur* : « Nom complet » `K` → "Au moins 2 caractères." ; « Valide jusqu'au » `2026-08-01` → "La fin de mandat précède son début." *(à relever)*.

☐ OK ☐ KO

---

## Étape 162 — Configurer le modèle de bulletin
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu "BULLETINS" > "Modèles de documents" (`/v2/reportcards/templates`)

*(Reconnexion en directeur des études.)*

1. Lire « Configuration de l'établissement » : la carte « Bulletin » (badge « Secondaire », `secondary-bulletin`, « modèle v1, configuration v1 ») et la carte « Relevé de notes » (« Aucune configuration. »).
2. Sur « Bulletin », cliquer **« Aperçu »** : bulletin d'exemple, « Aperçu avec des données d'exemple ; rien n'est émis. ». Fermer.
3. Cliquer **« Configurer »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Niveau d'enseignement | `Secondaire` |
| Modèle | `Bulletin du secondaire (modèle générique)` |
| Options du modèle : `showClassAverage` | cochée |
| Signataires par emplacement : Le Directeur | `KONÉ Mamadou test guide — Le Directeur` |

4. Cliquer **« Enregistrer la configuration »**.

✅ « La configuration est enregistrée. » ; carte « Bulletin » : « modèle v1, configuration v2 ». Les bulletins déjà émis gardent leur configuration d'émission.

⚠️ *Écart connu* : les options du modèle générique s'affichent sous leur nom technique (`showRank`, `showClassAverage`…).

🔒 *Test de droit* : en tant que directeur des études, taper `/v2/reportcards/identity` puis `/v2/reportcards/signatories` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 163 — Liste des bulletins et filtres
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu "BULLETINS" > "Bulletins — liste" (`/v2/reportcards`)

1. Dans « Classe et période » : « Classe » = `6e A`, « Période » = `Trimestre 1`.
2. Lire le tableau « Bulletins émis » : colonnes « Élève », « Document », « État », « PDF », « Actions ». Sur chaque ligne : "Version 1", « Publié », « PDF prêt », boutons « Télécharger », « Retirer », « Réémettre » (pas « Révoquer »). La case de sélection est désactivée.
3. Filtres : « État » = « Révoqué » ; puis « État » = « Publié » ; « Nature » = « Relevé de notes » ; « Nature » = « Bulletin » ; case « À réémettre » cochée. Remettre « Tous les états » et décocher « À réémettre ».

✅ 8 à 9 lignes (8 élèves notés, plus ADOU Aïcha d'après les rapports : *à relever*) ; « Révoqué », « Relevé de notes » et « À réémettre » donnent « Aucun bulletin. » et « Émettez les bulletins d'une classe dont la période est clôturée. » ; « Publié » et « Bulletin » donnent toutes les lignes.

☐ OK ☐ KO

---

## Étape 164 — Fiche d'un bulletin et PDF
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/reportcards` > cliquer le nom "DIABATE Nadia" (`/v2/reportcards/<identifiant>`)

1. Lire « Contenu du bulletin » : « Classe » 6e A, « Période » Trimestre 1, « Moyenne » 13,2, « Rang », « Mention » Bien, « Règle appliquée » `CI-SECONDARY-PLACEHOLDER · v1 (résultats v…)`, « Modèle » `secondary-bulletin · v1`, « Signataires : Directeur Fictif (Le Directeur). » (le signataire figé à l'émission, pas KONÉ Mamadou test guide).
2. Section « Vérification d'authenticité » : lire le « Code de vérification » (26 caractères) et l'« Empreinte du document ». **Noter le code de Nadia** (pour la vérification publique).
3. Cliquer **« Télécharger le PDF »** (autoriser les fenêtres contextuelles si rien ne s'ouvre) et **enregistrer le PDF** sur le poste.
4. Contrôler le PDF : nom de l'établissement, "République de Côte d'Ivoire (démonstration)", couleur verte, moyenne et rang identiques à l'écran, signataire "Directeur Fictif", QR code et même code de vérification, **filigrane** "DÉMONSTRATION" et pied de page "Règles de démonstration — document sans valeur officielle".
5. Cliquer **« Afficher la trace »** dans « Trace d'explicabilité ».

✅ Les valeurs de la fiche viennent du bulletin figé (identiques à la matrice du Trimestre 1) ; le lien de téléchargement est "généré à la demande et valable 5 minutes" ; la trace s'affiche (codes de ligne techniques).

⚠️ *Test d'erreur* : `/v2/reportcards/01a11000-0000-7000-8000-000000000000` → erreur du type "Bulletin introuvable (…)" *(à relever)*.

☐ OK ☐ KO

---

## Étape 165 — Contrôle préalable et émission rejouée
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu "BULLETINS" > "Bulletins — émission" (`/v2/reportcards/issue`)

1. Lire « Émettre les bulletins d'une classe » (« Choisissez une classe et une période. »). Choisir `6e A` / `Trimestre 1` : « Tout est prêt : vous pouvez générer les bulletins. ».
2. Cliquer **« Générer les bulletins »**. Section « Avancement du lot » : badge « Terminé ».
3. Cliquer **« Voir la liste des bulletins »**. **Ne pas** cliquer « Publier le lot aux familles ».
4. Revenir à « Émettre », choisir `Trimestre 2`.

✅ Étape 2 : "9 émis sur 9 — 0 exclus, 0 en échec." (chiffres à relever) : l'émission est idempotente. Étape 3 : toujours le même nombre de lignes « Publié » / « PDF prêt » / "Version 1", **aucun doublon**. Étape 4 : « Au moins un point bloquant empêche l'émission. », badge « Bloquant » "La période n'est pas clôturée pour cette classe : les bulletins définitifs s'émettent à partir de résultats clôturés." ; bouton « Générer les bulletins » **grisé**.

⚠️ *Test d'erreur* : cocher « Réémettre les bulletins dont les résultats ont changé », « Motif de la réémission » `abc` → « Le motif doit faire au moins 5 caractères. » (décocher ensuite).

⚠️ *Écart connu* : après un lot rejoué, l'avancement peut afficher « 0 PDF prêts sur 9 bulletins émis. » et le bouton « Relancer les PDF en échec », alors que tous les PDF sont prêts ; ne pas l'utiliser. Ne pas cocher « Bulletin provisoire » puis générer (irréversible).

☐ OK ☐ KO

---

## Étape 166 — Vérifier un bulletin authentique par son code
👤 **visiteur sans connexion** · fenêtre **B** (navigation privée, hors session) · `http://localhost:3000/v2/verify`

*(Si la fenêtre B est encore connectée, « Se déconnecter » d'abord.)*

1. Lire « Vérification d'un document » et « Vérification par code » : aucun menu ni connexion.
2. Saisir le code de Nadia en **minuscules**, avec un tiret et un espace au milieu, puis **« Vérifier »**.
3. Lire « Résultat de la vérification » ; déplier « Détails techniques ».
4. Essayer les formes `/v2/verify/<code>` et `/v2/verify?code=<code>`.

✅ Badge « Authentique », « Document authentique », phrase "Ce document a été calculé avec des règles de démonstration : il n'a aucune valeur officielle." ; « Établissement » Collège Le Baobab, « Nature du document » Bulletin, « Émis le … ». **Aucun** nom d'élève, note, matricule ni date de naissance. Les adresses directes donnent le même résultat.

*Facultatif* : en fenêtre **A**, directeur, cocher « Afficher la mention sur la page publique de vérification » dans `/v2/reportcards/identity` (« Réglage enregistré. »), relancer la vérification (une ligne « Mention » apparaît), puis **décocher**.

☐ OK ☐ KO

---

## Étape 167 — Codes inconnus ou mal formés
👤 **visiteur sans connexion** · fenêtre **B** · `/v2/verify`

1. Saisir successivement, puis **« Vérifier »** : `ABC123` ; `TESTGUIDEAAAAAAAAAAAAAAAAA` ; `<b>x</b>`.
2. Ouvrir directement `/v2/verify/ABC123`.

✅ Toujours le badge « Inconnu » et « Aucun document ne correspond à ce code. Vérifiez la saisie ; si le code est correct, le document n'est pas authentique. » (même réponse pour un code bien formé mais inexistant) ; aucun HTML interprété.

⚠️ *Écart connu* : champ vide puis « Vérifier » : aucun message.

☐ OK ☐ KO

---

## Étape 168 — Comparer un fichier PDF à l'original
👤 **visiteur sans connexion** · fenêtre **B** · `/v2/verify`, section « Comparer un fichier PDF »

1. Choisir le PDF de Nadia enregistré à l'étape *Fiche d'un bulletin et PDF*.
2. Choisir `docs/guide-test/jeux-de-donnees/pdf-etranger-test-guide.pdf`.
3. Choisir `docs/guide-test/jeux-de-donnees/format-invalide-test-guide.txt` ("Tous les fichiers" dans la fenêtre de sélection).

✅ Étape 1 : « Fichier identique », « Statut du document : Authentique. », établissement et intitulé. Étape 2 : « Fichier non reconnu » et "Ce fichier ne correspond à aucun original émis par un établissement." Étape 3 : « Le fichier doit être au format PDF. » (rien n'est envoyé).

☐ OK ☐ KO

---

## Étape 169 — Ce que voient les familles (élève)
👤 **élève** (secondaire-test) · fenêtre **B** · 📂 Rubrique « Mes bulletins » (`/v2/reportcards/family`)

*(Connexion en élève DIABATE Nadia.)*

1. Lire le titre « Bulletins » : **une seule** section "DIABATE Nadia", avec le titre du document, « Publié le … » et **« Télécharger »**.
2. Cliquer **« Télécharger »** : le PDF s'ouvre dans un nouvel onglet.

✅ Jamais d'autre élève ; note « Chaque téléchargement est journalisé ; le lien est valable 5 minutes. ». Un bulletin retiré, remplacé ou révoqué n'apparaît jamais.

🔒 *Test de droit* : en tant qu'élève, taper `/v2/reportcards` puis `/v2/reportcards/signatories` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 170 — ⚠️ Irréversible : réémettre le bulletin de TOURE Jean-Marc
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/reportcards` (`6e A` / `Trimestre 1`)

*(Reconnexion en directeur des études.)* Seul le bulletin de TOURE Jean-Marc est sacrifié ; ne touchez pas à ceux de DIABATE Nadia et DIABATE Salimata.

1. Ouvrir la fiche de TOURE Jean-Marc, noter son **ancien code de vérification** et télécharger son PDF.
2. Dans la liste, sur sa ligne, cliquer **« Réémettre »** : lire « Une nouvelle version est créée ; l'ancienne reste consultable et sa vérification indique qu'elle est remplacée. ».
3. « Motif » = `abc`, valider ; puis « Motif » = `Correction test guide`, valider (une confirmation d'identité peut s'ouvrir).
4. Attendre « PDF prêt », puis cliquer **« Publier »** sur la ligne.
5. Décocher « Dernière version seulement ».
6. Ouvrir la fiche de la version 2 : noter le **nouveau code**. En fenêtre privée, vérifier l'ancien code, puis le nouveau.

✅ Étape 3 : « Le motif doit comporter au moins 5 caractères. » puis « Le bulletin de TOURE Jean-Marc est réémis. » ; ligne "Version 2", état « Émis », « PDF en attente » puis « PDF prêt ». Étape 4 : « Le bulletin de TOURE Jean-Marc est publié. ». Étape 5 : deux lignes ; la version 1 est « Remplacé », sans « Télécharger », « Publier » ni « Réémettre ». Version 2 : « Signataires : KONÉ Mamadou test guide (Le Directeur). », PDF avec le pied de page "Document de démonstration test guide". Vérification publique : ancien code « Remplacé » ("Document remplacé par une version plus récente"), nouveau code « Authentique ».

☐ OK ☐ KO

---

## Étape 171 — ⚠️ Irréversible : retirer la version 2 de TOURE Jean-Marc
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/reportcards` (`6e A` / `Trimestre 1`)

1. Sur la ligne "Version 2" de TOURE Jean-Marc (« Publié »), cliquer **« Retirer »**.
2. Lire la ligne : badge, boutons proposés.
3. Cliquer une seconde fois **« Retirer »**.

✅ Étape 1 : « Le bulletin de TOURE Jean-Marc est retiré de la publication. ». Étape 3 : "Ce bulletin est déjà retiré." *(à relever)*. Aucun compte de famille n'est lié à ce bulletin.

⚠️ *Écart connu* : le serveur garde l'état « Publié » pour un bulletin retiré ; le badge reste « Publié », « Retirer » reste affiché et « Publier » n'apparaît pas. Consigner ce qui s'affiche ; ne **jamais** retirer le bulletin de DIABATE Salimata (sans retour possible).

☐ OK ☐ KO

---

## Étape 172 — ⚠️ Irréversible : révoquer la version 2 de TOURE Jean-Marc
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/reportcards` (`6e A` / `Trimestre 1`)

*(« Se déconnecter » du directeur des études, puis connexion en directeur.)*

1. Sur la version 2 de TOURE Jean-Marc, cliquer **« Révoquer »** : lire « Le document disparaît du portail des familles et sa vérification publique indiquera qu'il est révoqué. Cette action est définitive. ».
2. Valider avec « Motif » vide ou `abc`.
3. Saisir « Motif » = `Révocation test guide`, puis **« Révoquer »**.
4. En fenêtre **B**, vérifier le code de la version 2, puis celui de la version 1.

✅ Étape 2 : « Le motif doit comporter au moins 5 caractères. » Étape 3 : « Le bulletin de TOURE Jean-Marc est révoqué. », badge « Révoqué », fiche "Ce bulletin a été révoqué le …", plus aucun bouton d'action. Vérification : version 2 « Révoqué » ("Document révoqué par l'établissement : il ne doit plus être considéré comme valable.") ; version 1 reste « Remplacé ».

🔒 *Test de droit* : le directeur des études n'a **pas** de bouton « Révoquer ».

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 09, scénarios 9.5 (variante d'établissement et simulation), 9.6 (éditeur d'expressions), 9.17 à 9.19 (supérieur, rattrapage, droits refusés) ; chapitre 10, scénarios 10.11 à 10.13 (primaire et supérieur), 10.17 (droits de chaque rôle), 10.18 (clavier, mobile).

**Ce que la phase laisse dans l'application :**
- Trimestre 3 de la 6e A : **clôturé** (version 1, ou version 2 si la réouverture facultative a été faite) ; "Devoir commun test guide" (Français) **Annulée** si la réouverture a été faite, sinon toujours « Soumise » ; décision de DIABATE Salimata retenue "Renforcement recommande" ; séance « Conseil de classe » **Tenue** ; appréciation de DIABATE Nadia ; surcharge de COULIBALY Moussa révoquée et surcharge de DIABATE Salimata rejetée ; Trimestre 1 et Trimestre 2 intacts.
- Identité du Collège Le Baobab en **version 2** (pied de page "Document de démonstration test guide", logo `logo-test-guide.png`) ; signataire "KONÉ Mamadou test guide" (actif) ; configuration « Bulletin » **v2**.
- Bulletin de TOURE Jean-Marc : version 1 « Remplacé », version 2 « Révoqué » ; les autres bulletins du Trimestre 1 (dont DIABATE Nadia et DIABATE Salimata) restent « Publié ».

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](09a-regles-resultats-bulletins.md) · [Suivant →](10-vie-scolaire.md)
