[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](20-console-plateforme.md) · [Suivant →](22a-primaire.md)

# Phase 21 — Accessibilité, mobile et hors ligne

Objectif : contrôler à la main ce que les outils automatiques ne savent pas vérifier : clavier, petit écran, états vides, formats français de Côte d'Ivoire, application installable et saisie hors ligne.

Précondition : navigateur Chrome ou Edge avec les outils de développement (**F12**) ; mode appareil (**Ctrl+Maj+M**) pour les largeurs 375 px et 320 px. Les identifiants d'enfants se prennent en cliquant **« Ouvrir »** sur la carte de l'enfant (ne pas les taper à la main).

---

## Étape 388 — Lien d'évitement et focus au clavier
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 `/v2/parent`

Compte : `parent@secondaire-test.test` (sans MFA). Largeur d'environ 1280 px ; ne pas toucher la souris pour les points 1 à 3.

1. Recharger la page, puis appuyer une fois sur **Tab**.
2. Appuyer sur **Entrée**.
3. Appuyer à nouveau sur **Tab**.
4. À la souris, cliquer sur « Paramètres du compte » dans le menu, puis, sans toucher la souris, lancer dans la console (F12) `document.activeElement.id`.

✅ Point 1 : un lien « Aller au contenu » apparaît en haut à gauche, bien visible. Point 2 : le focus passe dans la zone principale (`#v2-main`). Point 3 : le focus va sur le premier élément du contenu (par exemple « Ouvrir » du premier enfant). Point 4 : la console répond `"v2-main"` : à chaque nouvelle page le focus est placé sur le contenu. Chaque élément focalisé a un contour ou un anneau visible.

☐ OK ☐ KO

---

## Étape 389 — Fenêtre de dialogue au clavier : focus piégé, Échap
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Fiche de DIABATE Nadia > section **« Absences »** (`/v2/parent/children/<id>/attendance`)

1. Atteindre **« Déposer un justificatif »** avec **Tab** et l'activer avec **Entrée**.
2. Dans la fenêtre, appuyer au moins dix fois sur **Tab**, puis sur **Maj+Tab**.
3. Appuyer sur **Échap**.
4. Rouvrir la fenêtre, cliquer **« Annuler »**.

✅ À l'ouverture le focus entre dans la fenêtre ; **Tab** boucle entre les champs et les boutons sans en sortir ; le menu en arrière-plan ne reçoit pas le focus. **Échap** et « Annuler » ferment la fenêtre et rendent le focus au bouton « Déposer un justificatif ». Ne rien déposer.

☐ OK ☐ KO

---

## Étape 390 — Menu mobile à 375 px
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 `/v2/parent` en mode appareil 375 × 812, page rechargée

1. Atteindre **« Ouvrir le menu »** avec **Tab** et l'activer avec **Entrée**.
2. Appuyer sur **Tab** plusieurs fois, puis sur **Échap**.
3. Rouvrir le menu, cliquer sur « Paramètres du compte ».
4. Ouvrir la fiche de DIABATE Nadia et faire défiler la rangée « Sections de l'enfant ».
5. Dans la console, lancer `(() => { const m = document.getElementById('v2-main'); return m.scrollWidth - m.clientWidth; })()`.

✅ Le menu latéral est remplacé par « Ouvrir le menu » ; le tiroir reçoit le focus à l'ouverture ; **Échap** le ferme et rend le focus au bouton ; menu fermé, ses liens ne reçoivent pas le focus. Les quatre cartes sont empilées ; la rangée d'onglets défile **dans son cadre** ; la valeur de la console est inférieure ou égale à 1 (aucun défilement horizontal de la page). Les boutons principaux font 44 px de haut.

☐ OK ☐ KO

---

## Étape 391 — Tableaux et formulaires à 320 px
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Fiche de DIABATE Salimata > **« Scolarité »** (`/v2/parent/children/<id>/finance`) ; fiche de Nadia > résultats (`/v2/parent/children/<id>/results`)

1. Mode appareil, largeur **320 px** (hauteur 640), relancer la mesure de l'étape précédente.
2. Comparer l'affichage des tableaux à 375 px, 768 px et 1280 px.
3. Régler le zoom du navigateur à 200 % (Ctrl et +) à 1280 px et parcourir la page.

✅ Valeur de la mesure inférieure ou égale à 1 ; seuls les tableaux défilent dans leur cadre ; sous 640 px certaines colonnes secondaires sont masquées (l'échéance, le montant d'une facture dépliée), mais le statut et le reste dû restent visibles. À 200 %, rien n'est coupé ni superposé.

⚠️ *Écart connu* : à 375 px la colonne « Matière » des notes publiées est masquée : une note apparaît sans sa matière (Suggestion).

☐ OK ☐ KO

---

## Étape 392 — États vides lisibles
👤 **parent** (secondaire-test) puis **secrétariat** · fenêtres **B** et **A**

1. Parent : fiche de Nadia > contacts d'urgence (`/v2/parent/children/<id>/emergency`, avant tout ajout) ; scolarité de Nadia ; évaluations à venir (`/v2/parent/children/<id>/upcoming`).
2. Secrétariat : `/v2/students`, saisir `ZZZ` dans la recherche.

✅ Chaque état vide est un message français explicite, jamais une page blanche, un tableau sans explication ni "undefined" / "null" : « Aucun contact d'urgence. » ; « Aucune échéance à payer. » ; « Aucune évaluation planifiée. » ; « Aucun élève ne correspond à votre recherche. »

☐ OK ☐ KO

---

## Étape 393 — Formats de date, de nombre et de montant (fr-CI)
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Scolarité de DIABATE Salimata et résultats de DIABATE Nadia

1. Sur la scolarité de Salimata, relever un montant, une date limite, la date d'un paiement.
2. Sur les résultats de Nadia, relever une moyenne, un rang, une note.
3. Dans F12 > "Sensors" > "Location" > "Timezone ID", choisir `Pacific/Auckland`, recharger `/v2/parent`, relire la date et les horaires, puis remettre le réglage par défaut.

✅ Montants entiers avec espace de milliers et "F CFA" ("100 000 F CFA", jamais de décimale) ; dates courtes du type "7 oct. 2026" ; heures sur 24 h ("08:00") ; décimales avec virgule ("13,20", jamais "13.20") ; rangs du type "2 sur 8". Étape 3 : les dates et horaires **ne changent pas** (le fuseau de l'établissement est `Africa/Abidjan`).

☐ OK ☐ KO

---

## Étape 394 — Application installable et page hors ligne
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 `/manifest.webmanifest` puis `/offline`

Le service worker n'est actif qu'avec la variable d'environnement. Arrêter l'application puis la relancer (par la personne qui exploite l'environnement) avec `$env:NEXT_PUBLIC_PWA = "1"; pnpm dev:v2` (PowerShell) ; ne pas utiliser `pnpm dev:v2:seed`.

1. Ouvrir `/manifest.webmanifest` : lire nom, `display`, `start_url`, couleurs et quatre icônes.
2. Se connecter en enseignant (`enseignant@secondaire-test.test`), ouvrir `/v2/teacher` puis recharger.
3. F12 > « Application » > Service Workers, puis dans la console `for (const n of await caches.keys()) console.log(n, (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname))`.
4. Dans "Réseau", choisir "Hors connexion" et taper `/v2/teacher/classes` dans la barre d'adresse.
5. Ouvrir `/offline?from=//exemple.test` réseau actif et lire l'adresse du lien.

✅ Étape 1 : nom "EcoleDigitale", `standalone`, `start_url` `/`, couleur `#2563eb`, quatre icônes qui se chargent. Étape 3 : un service worker actif sur `/sw.js`, deux caches `ed-shell-v2` et `ed-static-v2` ; **aucune** adresse `/api/` ni page privée (`/v2/...`) dans les caches. Étape 4 : redirection vers `/offline` (« Vous êtes hors ligne »), **aucune donnée** de la page privée. Étape 5 : le lien « Réessayer la connexion » pointe vers `/` (seul un chemin interne est accepté).

⚠️ *Écart connu* : sans la variable (mode par défaut), aucun service worker n'est enregistré et la coupure réseau affiche la page d'erreur du navigateur. Les textes d'installation (« Installer l'application ») n'ont pas de composant d'affichage ; c'est le navigateur qui propose l'installation. Pour revenir au mode normal, relancer une fois avec `NEXT_PUBLIC_PWA=0`.

☐ OK ☐ KO

---

## Étape 395 — Appel hors ligne et rejeu au retour du réseau
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu **« Mes appels »** (`/v2/teacher/attendance`)

Attendu au départ : une séance du jour (jeudi 8 octobre, jour de cours) sans appel.

1. Ouvrir « Mes appels » (titre « Mes séances à faire »), cliquer **« Faire l'appel »** sur la séance du jour et attendre le chargement de la liste de la classe.
2. Dans "Réseau", choisir "Hors connexion".
3. Marquer **COULIBALY Moussa** absent (toucher sa ligne), puis cliquer **« Soumettre l'appel »**.
4. Rétablir le réseau et attendre.
5. Revenir à « Mes appels », section « Sur cet appareil » et historique.
6. Avec l'éducateur (`educateur@secondaire-test.test`, fenêtre privée), vérifier dans le suivi des appels que l'appel est « Soumis » **une seule fois**.

✅ Avant la coupure : « En ligne : tout est à jour. » Hors ligne : « Hors ligne : vous pouvez continuer, les pointages seront envoyés à la reconnexion. » Après la soumission : « Appel enregistré sur cet appareil. Il sera envoyé automatiquement dès que le réseau reviendra. » Au retour du réseau : « Synchronisation en cours… » puis "En ligne : synchronisé à …" ; l'appel passe à « Envoyé » ; aucun doublon côté éducateur.

⚠️ *Test d'erreur* : ouvrir hors ligne une séance **jamais consultée** : « Vous êtes hors ligne : la liste de la classe ne peut pas être chargée. Rouvrez cet appel dès que le réseau revient ; les pointages déjà saisis sur cet appareil sont conservés. »

📚 *Pour aller plus loin* : chapitre 22, scénarios 22.2 à 22.7 (clavier détaillé), 22.9 à 22.13 (lecteur d'écran, pages publiques), 22.14 à 22.18 (thème, espacement, impression), 22.28, 22.30 et 22.31 (emploi du temps, notes et conflit de notes hors ligne), 22.32 à 22.39 (déconnexion, chargement, erreurs, français sans code technique).

☐ OK ☐ KO

**Ce que la phase laisse dans l'application :** un appel soumis hors ligne pour la séance du jeudi 8 octobre de la classe 6e A, avec COULIBALY Moussa absent (à rouvrir ou annuler par la direction) ; dans le navigateur, un service worker, deux caches et la base locale `ed-offline` ("Clear site data" et désinscription du service worker pour revenir au mode normal).

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](20-console-plateforme.md) · [Suivant →](22a-primaire.md)
