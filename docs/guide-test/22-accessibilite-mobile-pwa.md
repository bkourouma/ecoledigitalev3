# Chapitre 22 : Accessibilité, mobile, application installable (PWA) et qualité transversale

> Adresses : `/v2/...` est l'adresse réelle du navigateur (l'arborescence `apps/web/src/app/v2/` n'ajoute aucun préfixe). Quelques pages sont à la racine, hors `/v2` : `/login`, `/unauthorized` (« Accès refusé »), `/offline` (page hors ligne). Base de test : `http://localhost:3000`.

Ce chapitre contrôle à la main ce que les outils automatiques ne savent pas vérifier : parcours au clavier, annonces d'un lecteur d'écran, contrastes et thème, zoom et reflow, mobile (375 px), application installable et saisie hors ligne de l'enseignant ou de l'instituteur, états vides / chargement / erreur, français sans code technique, formats de date, de nombre et de montant. Chaque scénario cite un écran précis.

## Ce que les contrôles automatiques couvrent déjà (pour mémoire, aucun geste de testeur)

| Contrôle | Où | Ce qu'il prouve | Limite |
|---|---|---|---|
| Balayage `axe-core` strict | `apps/web/vitest.a11y.config.ts` (variable `A11Y_AUDIT=strict`), commande `pnpm --filter @ecoledigitale/web test:a11y` | 0 violation `serious` / `critical` sur 1 127 états d'écran rejoués par les tests existants (dernier journal : 2 oct. 2026), dont les écrans parent, élève, enseignant | ne juge ni la qualité des libellés, ni l'ordre réel du focus, ni les annonces vocalisées, ni le contraste réel, ni le reflow |
| Écrans représentatifs, composants partagés | `src/app/v2/screens.a11y.test.tsx`, `src/platform/ui/shared.a11y.test.tsx` | tableaux, champs, dialogues, assistant, états, coque et menu | jsdom : pas de mise en page |
| Contraste des jetons | `src/platform/test/contrast.test.ts` | rapport >= 4,5 : 1 sur les jetons de `globals.css` (clair et sombre) | pas les couleurs en dur, ni survol / désactivé / marque d'établissement |
| Mouvement réduit, reflow, `lang` | `src/platform/test/motion-reflow.test.ts` | règle `prefers-reduced-motion`, aucune largeur minimale > 320 px hors tableau défilant, `lang="fr"`, zoom non bloqué | contrôles statiques |
| Fumée PWA | `apps/web/playwright.pwa.config.ts` + `e2e/pwa.spec.ts` | manifeste valide, `sw.js` servi, `/offline` précachée, aucun cache d'API ni de page privée, redirection vers `/offline` réseau coupé | ne teste ni IndexedDB, ni la saisie hors ligne |
| Fumée des portails | `apps/web/playwright.portals.config.ts` + `e2e/portals-v2.spec.ts` | chaque route parent / élève / enseignant renvoie vers `/login` sans session et n'émet aucun appel de données, à 375 px et sur bureau, sans défilement horizontal de la page de connexion | pas de parcours connecté |

Ces commandes se lancent dans le terminal du développeur ; elles ne remplacent pas les scénarios ci-dessous.

## Prérequis

- Navigateur Chrome ou Edge avec les outils de développement (**F12**). Panneaux utilisés : « Éléments » (arbre d'accessibilité), "Réseau" (limitation, "Hors connexion", "Bloquer l'URL de la requête"), « Application » (Manifest, Service Workers, Cache Storage, IndexedDB), "Rendering" (émulation de `prefers-color-scheme`, `prefers-reduced-motion`, déficiences visuelles), mode appareil (**Ctrl+Maj+M**, largeur 375 puis 320). Facultatif : lecteur d'écran NVDA (Windows) ou VoiceOver (macOS, iOS), extension axe DevTools ou audit Lighthouse (catégorie "Accessibilité").
- Pour les scénarios 22.25 à 22.27 (service worker) : voir "Deux modes de démarrage". Pour 22.28 à 22.32 : un appareil ou une fenêtre de navigateur par "appareil".
- Données de départ : annexe de départ ; élèves et classes du chapitre 21.
- Identifiants à relever comme au chapitre 21 : `<id Nadia>`, `<id Salimata>`.

### Deux modes de démarrage (service worker)

Source : `apps/web/src/platform/pwa/register.ts`, `RegisterServiceWorker.tsx`, `apps/web/public/sw.js`.

| Mode | Comment | Effet |
|---|---|---|
| **A : par défaut** (`pnpm dev:v2`) | aucune variable `NEXT_PUBLIC_PWA` | en développement le service worker n'est **pas** enregistré ; manifeste, icônes, page `/offline`, IndexedDB (files d'appel et de notes, copie de l'emploi du temps) fonctionnent, mais une navigation réseau coupée affiche la page d'erreur du navigateur |
| **B : service worker activé** | arrêter l'application puis la relancer avec la variable : PowerShell `$env:NEXT_PUBLIC_PWA = "1"; pnpm dev:v2` ; Git Bash `NEXT_PUBLIC_PWA=1 pnpm dev:v2` (ce qui est exporté dans le shell l'emporte sur `.dev-v2/env.local`) | `/sw.js` est enregistré ; caches `ed-shell-v2` et `ed-static-v2` ; redirection vers `/offline` réseau coupé. Pour revenir au mode A après usage, relancer avec `NEXT_PUBLIC_PWA=0` une fois (interrupteur d'arrêt : désinscrit les service workers), puis sans la variable |

Ne pas utiliser `pnpm dev:v2:seed` pour cela : il écrit en base.

## Comptes (e-mails seulement)

| Rôle | Établissement | E-mail | MFA |
|---|---|---|---|
| Parent | Collège Le Baobab | `parent@secondaire-test.test` | non |
| Élève | Collège Le Baobab | `eleve@secondaire-test.test` | non |
| Enseignant (TRAORE Kouadio) | Collège Le Baobab | `enseignant@secondaire-test.test` | non |
| Instituteur (CP1 A) | École Les Palmiers | `enseignant@primaire-test.test` | non |
| Secrétariat | Collège Le Baobab | `secretariat@secondaire-test.test` | oui |
| Économe | Collège Le Baobab | `econome@secondaire-test.test` | oui |
| Éducateur ou directeur des études (vérifier un appel soumis) | Collège Le Baobab | `educateur@secondaire-test.test`, `etudes@secondaire-test.test` | non / oui |

## Droits

Ce chapitre est transversal : tous les rôles sont concernés par les contrôles d'accessibilité, de mobile et de formats. Points d'accès particuliers :

| Page | Qui y accède |
|---|---|
| `/offline`, `/v2/verify`, `/v2/apply/secondaire-test` | tout le monde, sans session |
| Copie hors ligne de l'emploi du temps, brouillons de notes, file d'appel | l'enseignant ou l'instituteur qui les a créés ; invisibles pour une autre identité sur le même appareil |

**Adresses à taper à la main qui doivent être refusées :**

| Situation | Adresses | Résultat attendu |
|---|---|---|
| Sans session | `/v2/teacher/attendance`, `/v2/student/results`, `/v2/parent/children/00000000-0000-4000-8000-000000000001` | redirection vers `/login`, aucune donnée, aucun appel de données |
| Parent connecté | `/v2/teacher/attendance`, `/v2/students`, `/v2/finance` | page « Accès refusé » (`/unauthorized`) |
| Élève connecté | `/v2/teacher/assessments`, `/v2/parent`, `/v2/attendance` | page « Accès refusé » |
| Service worker actif, réseau coupé | n'importe quelle page privée, par exemple `/v2/teacher/classes` | page `/offline`, jamais le contenu de la page privée |

## Données de départ

Source : annexe de départ, `scripts/seed-v2/scenario.ts` (emploi du temps du lundi au jeudi de 08:00 à 10:00, deux appels passés, notes publiées en période 1). Pour les scénarios hors ligne : une séance du jour sans appel (jour de cours) pour l'enseignant du collège ; au primaire l'« Appel du jour » est possible tous les jours ; une évaluation en brouillon dans une période ouverte, créée au chapitre 08 (nom conseillé `Contrôle test guide`).

---

## A. Clavier

#### 22.1 Lien d'évitement et focus à chaque changement de page
Compte : Parent (Collège Le Baobab) · Où : `/v2/parent` · Prérequis : navigateur à ~1280 px de large, souris non utilisée pour les étapes 1 à 4
1. Recharger la page.
2. Appuyer une fois sur **Tab**.
3. Appuyer sur **Entrée**.
4. Appuyer à nouveau sur **Tab**.
5. À la souris, cliquer sur « Paramètres du compte » dans le menu, puis, sans toucher la souris, ouvrir la console (F12) et lancer `document.activeElement.id`.
Résultat attendu : (2) un lien « Aller au contenu » apparaît en haut à gauche, bien visible (contour) ; (3) le focus passe dans la zone principale (l'adresse reçoit `#v2-main`) ; (4) le focus va sur le premier élément du contenu, par exemple « Ouvrir » du premier enfant ; (5) la console répond `"v2-main"` : à chaque nouvelle page le focus est placé sur le contenu, pas laissé dans le menu, et un lecteur d'écran annonce la nouvelle page. Le focus n'est pas volé au premier chargement.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Focus sur le contenu après navigation  - [ ] Droit refusé : sans objet (page protégée par session, voir "Droits")

#### 22.2 Ordre du focus et focus visible dans le portail
Compte : Parent · Où : `/v2/parent/children/<id Nadia>` · Prérequis : 22.1
1. Appuyer sur **Tab** une quinzaine de fois depuis le haut de la page, en notant à chaque fois l'élément actif.
2. Faire de même avec **Maj+Tab** depuis le milieu de la page.
3. Répéter l'étape 1 en émulant le thème clair, puis le thème sombre (22.14).
Résultat attendu : ordre = lien d'évitement, liens du menu latéral, « Mon compte », « Se déconnecter », liens du fil d'Ariane, liste « Enfant », onglets de « Sections de l'enfant » (l'onglet courant est annoncé comme page courante), liens des cartes, « Ouvrir les annonces ». Aucun piège : on sort de chaque zone. **Chaque** élément focalisé porte un contour ou un anneau visible (liens du menu : contour blanc sur fond gris foncé ; boutons et onglets : anneau). Tout élément cliquable est atteignable au clavier. Les éléments masqués (menu mobile fermé, voir 22.8) ne reçoivent jamais le focus.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Focus toujours visible dans les deux thèmes  - [ ] Pas de piège

#### 22.3 Fenêtre de dialogue : focus piégé, Échap, retour du focus
Compte : Parent · Où : `/v2/parent/children/<id Nadia>/attendance` > « Déposer un justificatif » · Prérequis : 22.1
1. Atteindre le bouton « Déposer un justificatif » avec **Tab** et l'activer avec **Entrée**.
2. Dans la fenêtre, appuyer plusieurs fois sur **Tab** (au moins 10 fois), puis sur **Maj+Tab**.
3. Appuyer sur **Échap**.
4. Rouvrir la fenêtre, cliquer sur « Annuler ».
5. Rouvrir, cliquer sur « Fermer » (croix en haut à droite).
Résultat attendu : à l'ouverture le focus entre dans la fenêtre ; **Tab** boucle entre les champs, « Annuler », « Déposer » et « Fermer » sans sortir ; le contenu de fond est inerte (le menu ne reçoit pas le focus) ; **Échap**, « Annuler » et « Fermer » ferment la fenêtre et **rendent le focus au bouton « Déposer un justificatif »**. La fenêtre a un titre (« Déposer un justificatif ») et une description reliés (`aria-labelledby`, `aria-describedby`) : visible dans l'arbre d'accessibilité.
Cas invalides : soumettre la fenêtre vide : les erreurs de champ s'affichent dans la fenêtre sans la fermer (22.4).
- [ ] Cas nominal  - [ ] Focus rendu au déclencheur  - [ ] Droit refusé : sans objet

#### 22.4 Erreurs de formulaire : annoncées, reliées au champ
Compte : Parent · Où : `/v2/parent/account` (menu « Paramètres du compte ») · Prérequis : 22.1
1. Saisir `123` dans « Téléphone » et valider avec « Enregistrer ».
2. Dans la console : `document.getElementById('f-telephone').getAttribute('aria-invalid')` et `document.getElementById('f-telephone').getAttribute('aria-describedby')`.
3. Corriger en `+225 07 10 20 30 40` et « Enregistrer ».
4. Valider le formulaire sans rien saisir.
Résultat attendu : (1) le message "Téléphone trop court." apparaît sous le champ, dans un élément `role="alert"` (annoncé une fois) ; (2) `aria-invalid` vaut `true` et `aria-describedby` désigne l'identifiant du message (suffixe `-error`) ; (3) « Coordonnées enregistrées. » s'affiche dans un élément `role="status"` ; (4) « Aucune modification à enregistrer. » est annoncé comme alerte. Le focus n'est pas déplacé automatiquement vers le champ en erreur (à noter : constat de comportement, non bloquant). Chaque champ a un libellé lié (clic sur le libellé = focus dans le champ) ; les champs obligatoires portent « obligatoire » dans le texte pour lecteur d'écran, pas seulement un astérisque.
Cas invalides : champ e-mail `pas-un-email` : "Adresse e-mail invalide.".
- [ ] Cas nominal  - [ ] Cas invalide annoncé  - [ ] Droit refusé : sans objet

#### 22.5 Tableaux et lignes dépliables au clavier
Compte : Parent · Où : `/v2/parent/children/<id Salimata>/finance` · Prérequis : 21.8 du chapitre 21
1. Atteindre avec **Tab** une ligne de « Factures » (zone dépliable) ; la déplier avec **Entrée** ou **Espace**.
2. Atteindre le tableau « Paiements effectués » avec **Tab** (la région défilante reçoit le focus) ; faire défiler avec les flèches.
3. Dans la console : `[...document.querySelectorAll('table caption')].map(c => c.textContent)` et `[...document.querySelectorAll('th')].map(h => h.getAttribute('scope'))`.
4. Sur `/v2/students` (compte Secrétariat) : filtrer avec « Rechercher un élève », puis utiliser la pagination (« Suivant » / « Précédent ») et les colonnes triables s'il y en a, uniquement au clavier.
Résultat attendu : la ligne s'ouvre et se ferme au clavier et montre son échéancier ; chaque tableau a une légende (dont « Paiements effectués », « Échéances à payer », « Paiements effectués ») et des en-têtes de colonne avec `scope="col"` ; le tri annonce son état ; la région défilante est nommée par sa légende et atteignable. La pagination est annoncée « Pagination » avec « Page {page} sur {pageCount} » quand il y a plusieurs pages.
Cas invalides : recherche sans résultat sur `/v2/students` : « Aucun élève ne correspond à votre recherche. ».
- [ ] Cas nominal  - [ ] Cas invalide (aucun résultat)  - [ ] Droit refusé : sans objet

#### 22.6 Liste de recherche (choix d'un élève) au clavier
Compte : Économe (Collège Le Baobab, MFA) · Où : `/v2/finance/payments/new`, champ « Apprenant » · Prérequis : aucun
1. Cliquer dans « Apprenant » (indication « Rechercher un élève… ») et taper `DIA`.
2. Utiliser les flèches haut et bas, puis **Entrée** pour choisir "DIABATE Nadia".
3. Utiliser « Effacer la sélection ».
4. Retaper `ZZZ`.
5. Appuyer sur **Échap**.
Résultat attendu : la liste propose DIABATE Nadia et DIABATE Salimata ; les flèches déplacent la sélection, **Entrée** choisit, « Effacer la sélection » vide le champ ; pour `ZZZ` le message « Aucun résultat. » est annoncé ; **Échap** ferme la liste. Le focus n'est jamais prisonnier de la liste. Aucun paiement n'est créé : quitter l'écran sans valider.
Cas invalides : coupure réseau pendant la recherche : « Impossible de charger les choix. ».
- [ ] Cas nominal  - [ ] Aucun résultat annoncé  - [ ] Droit refusé : un parent ouvrant `/v2/finance/payments/new` → « Accès refusé »

#### 22.7 Grille de notes et appel au clavier
Compte : Enseignant · Où : `/v2/teacher/assessments/<id>/grades` (évaluation en brouillon du chapitre 08) ; `/v2/teacher/attendance/call/occurrence/<id>` (chapitre 06) · Prérequis : une évaluation en brouillon dans une période ouverte
1. Dans la grille, cliquer dans la première cellule de « Note (sur 20) » ; taper `12,5` puis **Entrée**, `ABS` puis **flèche bas**, `15` puis **Maj+Entrée**, puis **Ctrl+S**.
2. Ouvrir « Aide à la saisie ».
3. Dans l'appel, atteindre une ligne d'élève avec **Tab** et appuyer sur **Espace** ou **Entrée**.
Résultat attendu : **Entrée** ou **flèche bas** passe à l'élève suivant ; **Maj+Entrée** ou **flèche haut** revient à l'élève précédent ; **Ctrl+S** enregistre. L'aide dit : « Entrée ou flèche bas : élève suivant. Maj + Entrée ou flèche haut : élève précédent. Ctrl + S : enregistrer. » et « Une absence ou une dispense n'est pas un zéro : saisissez 0 seulement pour une note de zéro. ». Chaque champ de note a un nom accessible propre à l'élève ("Note de DIABATE Nadia"). Dans l'appel, chaque ligne est un bouton dont le nom dit le statut ("… : … Toucher pour basculer entre présent et absent.") et bascule au clavier.
Cas invalides : note `abc` : « Saisissez un nombre (par exemple 12,5) ou un code : ABS, ABJ, DISP, NN. » ; note `25` sur 20 : « La note dépasse le barème (20). ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : élève ouvrant `/v2/teacher/assessments/<id>/grades` → « Accès refusé »

#### 22.8 Menu mobile (tiroir) au clavier et au tactile
Compte : Parent · Où : `/v2/parent` en mode appareil 375 × 812 · Prérequis : 22.1
1. Atteindre « Ouvrir le menu » avec **Tab** ; lire son état (`aria-expanded`) dans l'arbre d'accessibilité.
2. L'activer avec **Entrée**.
3. Appuyer sur **Tab** plusieurs fois, puis sur **Échap**.
4. Rouvrir le menu, cliquer sur « Paramètres du compte ».
5. Rouvrir le menu, toucher la zone sombre à droite du tiroir.
6. Menu fermé, appuyer sur **Tab** depuis le haut de la page.
Résultat attendu : (1) `aria-expanded` vaut `false`, le bouton référence le menu (`aria-controls`) ; (2) il passe à `true`, le focus entre dans le tiroir (premier élément : « Fermer le menu ») ; (3) **Échap** ferme le tiroir et rend le focus à « Ouvrir le menu » ; (4) le tiroir se ferme et la page se charge avec le focus sur le contenu ; (5) la zone sombre ferme le tiroir ; (6) menu fermé, ses liens ne reçoivent **pas** le focus (tiroir masqué). Le tiroir n'est pas un dialogue modal : le fond reste atteignable (comportement de conception, à noter).
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Échap rend le focus  - [ ] Menu fermé non atteignable au clavier

## B. Lecteur d'écran et arbre d'accessibilité

> Sans lecteur d'écran, lire l'arbre d'accessibilité (F12 > « Éléments » > volet "Accessibilité") ou lancer les extraits de console fournis.

#### 22.9 Repères et titres des portails
Compte : Parent, puis Élève, puis Enseignant · Où : `/v2/parent/children/<id Nadia>/results`, `/v2/student`, `/v2/teacher/classes` · Prérequis : aucun
1. Sur chaque page, lancer dans la console : `[...document.querySelectorAll('main,nav,header,aside,[role=region],[role=search]')].map(e => e.tagName + ' ' + (e.getAttribute('aria-label') || ''))`.
2. Puis : `[...document.querySelectorAll('h1,h2,h3,h4')].map(h => h.tagName + ' ' + h.textContent.trim())`.
3. Puis : `document.documentElement.lang`.
Résultat attendu : un seul `main` (identifiant `v2-main`), des `nav` nommées (« Navigation de l'espace parent », « Navigation de l'espace élève » ou « Navigation de l'espace enseignant », « Fil d'Ariane », « Sections de l'enfant » pour le parent), un seul `h1` par page (le titre de l'écran), puis des `h2` par section, sans saut de niveau ; la langue vaut `fr`. Cas à vérifier : sur `/v2/parent/children/<id Nadia>` (tableau de bord) les cartes sont des `h3` directement sous le `h1` (saut de niveau, voir Écarts).
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Un seul h1 par page  - [ ] Droit refusé : sans objet

#### 22.10 Noms accessibles des boutons et liens répétés
Compte : Parent, puis Enseignant · Où : `/v2/parent`, `/v2/parent/children/<id Salimata>/finance`, `/v2/teacher/classes` · Prérequis : 21.8
1. Lancer dans la console : `(() => { const n = {}; document.querySelectorAll('a,button').forEach(e => { const t = (e.getAttribute('aria-label') || e.textContent).trim().replace(/\s+/g, ' '); if (t) n[t] = (n[t] || 0) + 1; }); return Object.entries(n).filter(([, c]) => c > 1); })()`.
2. Lire dans l'arbre d'accessibilité le nom des boutons « Ouvrir », « PDF » et « Élèves ».
Résultat attendu : sur `/v2/parent`, les deux liens « Ouvrir » ont des noms distincts ("Ouvrir — DIABATE Nadia", "Ouvrir — DIABATE Salimata") ; sur la scolarité, chaque bouton « PDF » est nommé "Télécharger le reçu {numéro} en PDF" ; sur `/v2/teacher/classes`, « Élèves » est suffixé du nom de la classe. Aucun doublon de nom (la liste de la console doit être vide, hors liens de menu volontairement identiques). Les boutons à icône seule (« Semaine précédente », « Semaine suivante », « Fermer ») ont un nom.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Aucun nom en doublon  - [ ] Droit refusé : sans objet

#### 22.11 Annonces dynamiques : chargement, succès, erreur, suivi de paiement
Compte : Parent · Où : `/v2/parent/children/<id Salimata>/finance` ; `/v2/parent/account` ; `/v2/parent/children/<id Nadia>/schedule` · Prérequis : 21.9 du chapitre 21 (paiement simulé)
1. Recharger `/v2/parent` en limitation "Slow 3G" et lancer pendant le chargement : `[...document.querySelectorAll('[role=status],[role=alert],[aria-live]')].map(e => (e.getAttribute('role') || 'live:' + e.getAttribute('aria-live')) + ' = ' + e.textContent.trim())`.
2. Sur `/v2/parent/account`, enregistrer une coordonnée valide, relancer la même ligne.
3. Sur la scolarité, lancer un paiement simulé de `5001` (en attente) et relancer la ligne.
4. Sur l'emploi du temps, changer de semaine et relancer la ligne.
Résultat attendu : (1) « Chargement… » dans un `role="status"` ; (2) « Coordonnées enregistrées. » dans un `role="status"` ; (3) le bloc « Suivi du paiement » est une région `aria-live="polite"` qui annonce l'état (« En attente de confirmation par l'opérateur. Cette page se met à jour toute seule. ») ; (4) l'intitulé de la semaine ("Du … au …") est `aria-live="polite"`. Les erreurs sont en `role="alert"`. Un lecteur d'écran n'annonce chaque message qu'une fois.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Succès / chargement / erreur annoncés  - [ ] Droit refusé : sans objet

#### 22.12 Tableaux et badges d'état : information jamais portée par la couleur seule
Compte : Parent · Où : `/v2/parent/children/<id Salimata>/finance` · Prérequis : 21.9 du chapitre 21
1. Dans "Rendering", activer "Emulate vision deficiencies" > "Achromatopsia" (niveaux de gris).
2. Lire les badges des factures, échéances et paiements (« Payée », « À payer », « En attente », « Confirmé », « Échoué »).
3. Repérer le « Reste à payer ».
Résultat attendu : chaque badge est un texte (pas une pastille de couleur nue) ; on distingue tous les états en niveaux de gris. Les tableaux ont légende, en-têtes et cellules d'en-tête de ligne (`scope="row"` pour la première colonne).
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] États lisibles en niveaux de gris  - [ ] Droit refusé : sans objet

#### 22.13 Pages publiques : vérification de document et candidature
Compte : aucun (fenêtre privée) · Où : `/v2/verify`, `/v2/verify/<code>`, `/v2/apply/secondaire-test` · Prérequis : un code de vérification de bulletin (chapitre 21, scénario 21.5)
1. Ouvrir `/v2/verify` : lire le titre « Vérification d'un document », le champ « Code de vérification » avec son aide, le bouton « Vérifier ».
2. Saisir le code, « Vérifier » ; lire le résultat.
3. Saisir `CODEFAUX1234` et « Vérifier ».
4. Ouvrir `/v2/apply/secondaire-test` : parcourir le formulaire au clavier / lecteur d'écran.
Résultat attendu : le champ a un libellé et une aide reliés ; le résultat est dans une région nommée « Résultat de la vérification » et annonce « Document authentique » ; pour un code faux : « Aucun document ne correspond à ce code. Vérifiez la saisie ; si le code est correct, le document n'est pas authentique. » La page rappelle « Cette page n'affiche ni note, ni nom, ni matricule, ni date de naissance : elle confirme seulement l'existence et le statut du document. ». Sur la candidature (chapitre « Admissions »), aucun champ "fantôme" n'est annoncé (champ leurre invisible) et le consentement est lu avant l'envoi (à vérifier).
Cas invalides : code faux (étape 3).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet (pages publiques)

## C. Contraste, thème, zoom, mouvement, impression

#### 22.14 Thème clair / sombre et contraste
Compte : Parent · Où : `/v2/parent`, `/v2/parent/children/<id Salimata>/finance`, `/unauthorized`, `/offline` · Prérequis : aucun ; si un thème a déjà été mémorisé, le supprimer : console `localStorage.removeItem('ecoledigitale-ui-store')` puis recharger
1. Dans "Rendering" > "Emulate CSS media feature prefers-color-scheme", choisir `light`, recharger ; lire `document.documentElement.className`.
2. Choisir `dark`, recharger ; relire la classe.
3. Dans chaque thème, parcourir les écrans listés : texte, bordures, badges, boutons désactivés, messages (succès, information, avertissement, erreur), menu latéral.
4. Mesurer le contraste de quelques éléments (outil de sélection de couleur : rapport affiché) : texte courant, texte secondaire, badge « En attente », message d'erreur, texte "{n} à justifier" de la carte « Absences ».
Résultat attendu : le thème suit le système (valeur mémorisée `system` par défaut dans `ecoledigitale-ui-store`) : la classe de `<html>` est `light` ou `dark` selon l'émulation ; **aucun** sélecteur de thème dans la coque. Tous les textes atteignent au moins 4,5 : 1 (3 : 1 pour les grands textes et les contours de composants). Les jetons globaux sont déjà contrôlés automatiquement ; sont à contrôler ici les couleurs écrites en dur : menu latéral (gris clair sur gris foncé, identique dans les deux thèmes), pastilles d'état, messages colorés, indicateur de réseau, texte orange de la carte « Absences » en thème sombre (à vérifier). La page « Accès refusé » est lisible dans les deux thèmes.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Thème clair lisible  - [ ] Thème sombre lisible  - [ ] Droit refusé : sans objet

#### 22.15 Zoom 200 % et reflow à 320 px
Compte : Parent, puis Enseignant · Où : `/v2/parent/children/<id Salimata>/finance`, `/v2/teacher/classes/<id 6e A>` · Prérequis : aucun
1. Régler le zoom du navigateur à **200 %** (Ctrl et +, jusqu'à 200 %) : parcourir la page, ouvrir « Payer en ligne » (parent).
2. Remettre 100 %, passer en mode appareil avec une largeur de **320 px** (hauteur 640).
3. Lancer dans la console : `(() => { const m = document.getElementById('v2-main'); return m.scrollWidth - m.clientWidth; })()`.
4. Ouvrir la fenêtre « Payer en ligne », parcourir ses champs.
Résultat attendu : à 200 %, rien n'est coupé ni superposé ; à 320 px, la valeur de la console est inférieure ou égale à 1 (la zone de contenu ne défile pas horizontalement) ; seuls les tableaux défilent **dans leur cadre** (région nommée, atteignable au clavier). La fenêtre se présente en feuille depuis le bas de l'écran, défile verticalement et ses boutons « Annuler » et « Payer » restent atteignables. Attention : la page entière est en `overflow: hidden`, un contenu qui déborderait serait donc coupé et non défilable : relever tout texte coupé à droite.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] 200 % lisible  - [ ] 320 px sans débordement  - [ ] Droit refusé : sans objet

#### 22.16 Espacement du texte augmenté
Compte : Parent · Où : `/v2/parent`, `/v2/parent/children/<id Nadia>/emergency` · Prérequis : aucun
1. Coller dans la console : `const s = document.createElement('style'); s.textContent = '*{line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important}p{margin-bottom:2em!important}'; document.head.append(s)`.
2. Parcourir la page ; ouvrir « Modifier » d'un contact (21.12 du chapitre 21).
Résultat attendu : aucun texte tronqué qui empêche de comprendre (les noms longs dans la barre du haut peuvent être abrégés par des points de suspension, tant que le nom complet reste accessible), aucun chevauchement de blocs, boutons toujours lisibles.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Pas de texte bloqué  - [ ] Droit refusé : sans objet

#### 22.17 Mouvement réduit
Compte : Parent · Où : `/v2/parent` en limitation "Slow 3G" · Prérequis : aucun
1. Dans "Rendering", choisir `prefers-reduced-motion: reduce`.
2. Recharger la page avec limitation "Slow 3G" pour voir l'indicateur de chargement ; passer en 375 px et ouvrir / fermer le menu.
3. Lancer dans la console : `getComputedStyle(document.querySelector('.animate-spin') || document.body).animationDuration`.
Résultat attendu : plus d'animation perceptible (rotation, glissement du tiroir) ; la durée calculée est quasi nulle (`1e-05s`) ; le texte « Chargement… » reste présent.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Animations supprimées  - [ ] Droit refusé : sans objet

#### 22.18 Impression d'un reçu
Compte : Parent · Où : `/v2/parent/children/<id Salimata>/finance/receipts/<id reçu>` · Prérequis : un reçu (21.10 du chapitre 21)
1. Appuyer sur **Ctrl+P** (ou « Imprimer »).
Résultat attendu : l'aperçu ne montre que le document « Reçu de paiement » : barre du haut, menu, fil d'Ariane, boutons « Retour à la scolarité », « Télécharger le PDF » et « Imprimer » sont masqués ; le contenu occupe la page.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Seul le document s'imprime  - [ ] Droit refusé : sans objet

## D. Mobile (375 px)

#### 22.19 Portail parent à 375 px
Compte : Parent · Où : `/v2/parent`, `/v2/parent/children/<id Nadia>` · Prérequis : mode appareil 375 × 812, rechargé
1. Ouvrir `/v2/parent`.
2. Lire la barre du haut.
3. Ouvrir la fiche de Nadia ; faire défiler la rangée « Sections de l'enfant ».
4. Lancer la mesure du débordement (console de 22.15).
Résultat attendu : le menu latéral est remplacé par « Ouvrir le menu » ; dans la barre du haut, « Mon compte » et « Se déconnecter » sont réduits à leur icône mais gardent leur nom pour le lecteur d'écran ; les quatre cartes sont empilées sur une colonne ; la rangée d'onglets défile horizontalement **dans son cadre** (la page ne défile pas) ; la liste « Enfant » est pleine largeur ; aucun débordement (valeur <= 1). Les boutons principaux font 44 px de haut.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Aucun débordement  - [ ] Droit refusé : sans objet

#### 22.20 Tableaux sur mobile : colonnes masquées et information essentielle
Compte : Parent · Où : `/v2/parent/children/<id Salimata>/finance`, `/v2/parent/children/<id Nadia>/results`, `/v2/parent/children/<id Nadia>/emergency` · Prérequis : 21.8 du chapitre 21
1. Pour chaque page, comparer l'affichage à 375 px, 768 px et 1280 px.
2. Noter, pour chaque tableau, les colonnes présentes à chaque largeur.
Résultat attendu : sous 640 px, certaines colonnes secondaires sont masquées (la page ne bascule pas en cartes) : échéances (colonne « Échéance » masquée), factures dépliées (« Montant » masqué), notes publiées (« Matière » masquée sous 640 px, « Type » et « Poids » sous 768 px), contacts d'urgence (« Lien » masqué), détail par matière (« Coef. » et « Crédits » masqués). L'information essentielle (date limite, reste dû, statut, note) reste visible ; **la matière d'une note est absente à 375 px** (Suggestion, voir Écarts). Aucun tableau ne déborde de la page : il défile dans son cadre.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Information essentielle visible  - [ ] Droit refusé : sans objet

#### 22.21 Formulaires et fenêtres sur mobile
Compte : Parent · Où : `/v2/parent/children/<id Salimata>/finance` > « Payer en ligne » ; `/v2/parent/account` · Prérequis : mode appareil 375 × 812, idéalement un vrai téléphone
1. Ouvrir « Payer en ligne » ; lire la forme de la fenêtre.
2. Lancer dans la console : `[...document.querySelectorAll('input')].map(i => i.id + ' ' + i.type + ' ' + i.inputMode)`.
3. Ouvrir `/v2/parent/account` et relancer la ligne.
4. Sur un vrai téléphone : toucher chaque champ et lire le clavier proposé.
Résultat attendu : la fenêtre est une **feuille ancrée en bas** (pleine largeur, hauteur maximale de 90 % de l'écran, défilable), son bouton « Fermer » fait 44 px ; « Montant (F CFA) » a `inputmode` = `numeric` ; « Numéro de téléphone du payeur » et « Téléphone » sont de type `tel` ; « Adresse e-mail » de type `email` ; les listes sont des listes natives du système. Le clavier proposé correspond (numérique, téléphone, e-mail). Les champs mesurent 40 px de haut (voir 22.23).
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Bons types de saisie  - [ ] Droit refusé : sans objet

#### 22.22 Emploi du temps sur mobile et en paysage
Compte : Élève · Où : `/v2/student/schedule` · Prérequis : mode appareil
1. À 1024 px, lire la grille de 7 colonnes.
2. À 375 px, lire la page : une liste par jour.
3. Tourner l'appareil en paysage (812 × 375).
4. Utiliser « Vue jour » / « Vue semaine ».
Résultat attendu : de 768 px et plus, la semaine s'affiche en grille (une colonne par jour, aujourd'hui surligné) ; en dessous, une liste de jours avec un titre par jour, seuls les jours qui ont des séances étant listés ; en paysage la page reste utilisable ; la navigation (« Semaine précédente », « Aujourd'hui », « Semaine suivante ») reste atteignable. Les séances annulées ne sont visibles qu'avec « Afficher les séances annulées ».
Cas invalides : semaine sans séance : « Aucune séance cette semaine. ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 22.23 Cibles tactiles
Compte : Enseignant · Où : `/v2/teacher`, `/v2/teacher/classes` · Prérequis : mode appareil 375 × 812
1. Lancer dans la console : `[...document.querySelectorAll('a,button,input,select,textarea')].filter(e => e.offsetParent !== null).map(e => ({ t: (e.getAttribute('aria-label') || e.textContent || e.name || '').trim().slice(0, 30), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) })).filter(x => x.h < 44 || x.w < 44)`.
2. Toucher (ou cliquer précisément) les boutons voisins : « Élèves » et « Évaluations » d'une classe.
Résultat attendu : sur mobile les boutons d'action, le bouton du menu, « Mon compte » et « Se déconnecter » font 44 px de haut ; les champs de saisie font 40 px (écart par rapport à la bonne pratique de 44 px, Suggestion) ; la fermeture des fenêtres fait 44 px ; deux cibles voisines ne se confondent pas.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Boutons de 44 px  - [ ] Droit refusé : sans objet

## E. Application installable (PWA) et saisie hors ligne

#### 22.24 Manifeste et icônes
Compte : aucun · Où : `/manifest.webmanifest`, F12 > « Application » > "Manifest" · Prérequis : mode A ou B
1. Ouvrir `/manifest.webmanifest`.
2. Ouvrir le panneau « Application » > "Manifest".
3. Ouvrir chacune des quatre icônes : `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png`, `/icons/icon.svg`.
4. Lancer dans la console : `document.querySelector('link[rel=manifest]').href` et `document.querySelector('meta[name=theme-color]').content`.
Résultat attendu : le manifeste dit nom et nom court "EcoleDigitale", `display` = `standalone`, `start_url` = `/`, `scope` = `/`, langue `fr`, couleur de thème `#2563eb`, couleur de fond `#111827`, catégorie `education`, quatre icônes (192, 512, 512 "maskable", SVG) qui se chargent toutes ; la page déclare le manifeste (`/manifest.webmanifest`) et la couleur `#2563eb` ; une icône d'écran d'accueil iOS existe (`/icons/apple-touch-icon.png`).
Cas invalides : une icône absente (404) fait échouer le test.
- [ ] Cas nominal  - [ ] Icônes chargées  - [ ] Droit refusé : sans objet (fichiers publics)

#### 22.25 Service worker : activation, caches, contenu
Compte : Enseignant · Où : F12 > « Application » > "Service Workers" et "Cache Storage" · Prérequis : mode A **puis** mode B (voir "Deux modes de démarrage")
1. **Mode A** : se connecter, ouvrir "Service Workers". Lancer dans la console : `(await navigator.serviceWorker.getRegistrations()).length`.
2. **Mode B** : relancer l'application avec `NEXT_PUBLIC_PWA=1`, se connecter, recharger. Lancer : `(await navigator.serviceWorker.getRegistrations()).map(r => r.active && r.active.scriptURL)`.
3. Lancer : `for (const n of await caches.keys()) console.log(n, (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname))`.
4. Naviguer dans le portail (`/v2/teacher`, `/v2/teacher/classes`, `/v2/teacher/schedule`), puis relancer la ligne de l'étape 3.
Résultat attendu : mode A : zéro enregistrement (le service worker n'est actif qu'en production ou avec `NEXT_PUBLIC_PWA=1`) ; mode B : un service worker "activated and is running" pour `/sw.js`, deux caches `ed-shell-v2` et `ed-static-v2`. Contenu des caches : `/offline`, `/manifest.webmanifest`, les icônes (192, 512 et SVG) et les fichiers statiques versionnés de Next ; **aucune** adresse commençant par `/api/` et **aucune page privée** (`/v2/...`, `/login`) ; le contenu ne change pas après l'étape 4 (hors fichiers statiques). Le service worker n'intercepte jamais les appels de l'application ni les requêtes avec en-tête d'autorisation.
Cas invalides : en développement, les fichiers de la page hors ligne n'ont pas de nom versionné : ils ne sont pas tous précachés (voir 22.26).
- [ ] Cas nominal  - [ ] Aucun cache d'API ni de page privée  - [ ] Droit refusé : sans objet

#### 22.26 Page « Vous êtes hors ligne » (`/offline`)
Compte : aucun · Où : `/offline` · Prérequis : mode A ou B
1. Ouvrir `/offline` réseau actif.
2. Lire le titre de l'onglet, le titre de la page, le texte et le lien.
3. Ouvrir `/offline?from=/v2/parent`, relire l'adresse du lien.
4. Ouvrir `/offline?from=//exemple.test`, puis `/offline?from=https://exemple.test`, puis `/offline?from=/offline`, relire l'adresse du lien.
5. (Mode B, réseau coupé) Ouvrir `/offline` : la page se charge-t-elle entièrement (texte, lien) ?
Résultat attendu : onglet "Hors ligne - EcoleDigitale" ; titre « Vous êtes hors ligne » ; texte « Cette page n'est pas disponible sans connexion : les pages privées ne sont jamais gardées hors ligne. Vos saisies en attente (appel, notes) et la copie de votre emploi du temps restent sur cet appareil, rattachées à votre compte seul. » ; lien « Réessayer la connexion ». Le lien pointe vers `/v2/parent` à l'étape 3, et vers `/` aux trois cas de l'étape 4 (seul un chemin interne est accepté : pas de redirection ouverte). Sans copie d'emploi du temps sur l'appareil, la section « Mon emploi du temps (copie hors ligne) » n'apparaît pas. Réseau coupé en développement (mode B), le texte s'affiche mais le lien « Réessayer la connexion » peut rester sur `/` faute de JavaScript chargé (fichiers non versionnés, à vérifier) ; en production tout est précaché.
Cas invalides : étape 4.
- [ ] Cas nominal  - [ ] Cas invalide (redirection ouverte refusée)  - [ ] Droit refusé : sans objet (page publique)

#### 22.27 Page privée hors ligne jamais servie ; installation de l'application
Compte : Enseignant · Où : `/v2/teacher/classes`, barre d'adresse du navigateur · Prérequis : mode B ; avoir ouvert `/v2/teacher` en ligne au moins une fois
1. Dans "Réseau", choisir "Hors connexion".
2. Saisir `/v2/teacher/classes` dans la barre d'adresse (nouvelle navigation, pas de clic dans l'application).
3. Cliquer sur « Réessayer la connexion », puis rétablir le réseau et recommencer le clic.
4. **Installation** : réseau actif, chercher l'icône d'installation dans la barre d'adresse (ou le menu du navigateur "Installer EcoleDigitale…"), installer, ouvrir l'application installée.
5. Dans l'application installée, chercher un bouton « Installer l'application » ou un message « Une nouvelle version est disponible. ».
Résultat attendu : (2) redirection vers `/offline?from=%2Fv2%2Fteacher%2Fclasses` : la page « Vous êtes hors ligne » s'affiche ; **aucune donnée** de la page privée n'est affichée ; (3) hors connexion le clic ne mène nulle part de privé ; réseau actif le lien ramène à `/v2/teacher/classes` ; (4) l'application s'installe et s'ouvre dans sa propre fenêtre, sans barre d'adresse (`standalone`) ; (5) ces deux textes existent dans les messages mais **aucun composant ne les affiche** (le navigateur propose lui-même l'installation). En mode A, la coupure du réseau produit la page d'erreur du navigateur, pas celle de l'application.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Aucune page privée servie hors ligne  - [ ] Installation possible  - [ ] Droit refusé : sans objet

#### 22.28 Emploi du temps de l'enseignant hors ligne
Compte : Enseignant (Collège Le Baobab) · Où : `/v2/teacher/schedule` (chapitre 07) · Prérequis : mode A pour les étapes 1 à 4 ; mode B pour l'étape 5
1. En ligne, ouvrir « Mon emploi du temps » (semaine en cours), cliquer sur « Semaine suivante », puis sur « Aujourd'hui ». Attendre quelques secondes (la semaine suivante est aussi préchargée).
2. Dans "Réseau", choisir "Hors connexion".
3. Revenir à la semaine courante et à la suivante avec les boutons « Semaine précédente » et « Semaine suivante ».
4. Avancer de trois semaines (semaine jamais ouverte).
5. (Mode B) Réseau toujours coupé, saisir `/v2/teacher` dans la barre d'adresse.
6. Contrôler dans F12 > « Application » > "IndexedDB" > `ed-offline` > `schedule_cache` le contenu d'une copie.
7. Rétablir le réseau, cliquer sur « Se déconnecter », ouvrir `/offline`.
Résultat attendu : (3) un bandeau "Hors ligne : vous consultez la copie de votre emploi du temps enregistrée il y a … Lecture seule." ; (4) « Hors ligne, et aucune copie de cette période n'est enregistrée sur cet appareil. Ouvrez-la une fois en ligne pour la retrouver ici. » ; (5) la page `/offline` avec la section « Mon emploi du temps (copie hors ligne) » : "Copie en lecture seule enregistrée le …", les séances par jour, **sans aucun nom d'élève** ; au-delà de 24 h : « Cette copie date de plus de 24 h : l'emploi du temps a pu changer. Reconnectez-vous pour le vérifier. » (non testable sans modifier l'heure de la copie dans IndexedDB ; à vérifier) ; (6) la clé commence par `sched:` et contient l'identité tenant:utilisateur ; ni notes de séance, ni intervenants, ni noms d'élèves ou de collègues ; (7) après déconnexion volontaire, plus de copie sur `/offline`. Huit fenêtres au plus sont gardées par personne.
Cas invalides : copie tronquée (plus de 500 séances) : « La copie est incomplète : seules les premières séances de la période ont été gardées. » (non atteint avec la graine).
- [ ] Cas nominal  - [ ] Cas invalide (période jamais ouverte)  - [ ] Droit refusé : un autre compte sur le même appareil ne voit pas la copie

#### 22.29 Appel hors ligne et rejeu au retour du réseau (enseignant et instituteur)
Comptes : Enseignant (secondaire, appel par séance) puis Instituteur du CP1 A (primaire, appel du jour) · Où : `/v2/teacher/attendance` puis l'appel (chapitre 06) · Prérequis : mode A suffit ; une séance du jour sans appel au collège (jour de cours), sinon « Appel du jour » au primaire
1. **Collège** : ouvrir « Mes appels » (titre « Mes séances à faire »), puis « Faire l'appel » sur la séance du jour. **Primaire** : « Appel du jour » > « Ouvrir ».
2. Attendre le chargement de la liste de la classe. Lire l'indicateur de réseau.
3. Dans "Réseau", choisir "Hors connexion". Relire l'indicateur.
4. Marquer l'élève COULIBALY Moussa absent (toucher sa ligne), puis cliquer sur « Soumettre l'appel ».
5. Lire le message et l'indicateur.
6. Rétablir le réseau ; attendre ; lire l'indicateur.
7. Revenir à « Mes appels » : section « Sur cet appareil » et historique des 30 jours.
8. Avec le compte Éducateur ou Directeur des études, vérifier dans le suivi des appels (chapitre 06) que l'appel est « Soumis » **une seule fois**.
Résultat attendu : (2) « En ligne : tout est à jour. » ; (3) « Hors ligne : vous pouvez continuer, les pointages seront envoyés à la reconnexion. » ; (5) « Appel enregistré sur cet appareil. Il sera envoyé automatiquement dès que le réseau reviendra. » et « Hors ligne : 1 pointage gardé sur cet appareil, envoi à la reconnexion. » ; (6) « Synchronisation en cours… » puis "En ligne : synchronisé à …" ; (7) l'appel de la section « Sur cet appareil » passe à « Envoyé » (puis « Retirer » possible) et l'historique le liste une fois ; (8) aucun doublon. Les pointages gardés sur l'appareil ne contiennent que des identifiants, aucun nom d'élève (F12 > "IndexedDB" > `ed-offline` > `attendance_calls`). Données créées : un appel soumis pour la classe (à rouvrir ou annuler par la direction).
Cas invalides :
| Situation | Message attendu |
|---|---|
| Ouvrir une séance **jamais consultée** réseau coupé | « Vous êtes hors ligne : la liste de la classe ne peut pas être chargée. Rouvrez cet appel dès que le réseau revient ; les pointages déjà saisis sur cet appareil sont conservés. » |
| Envoi qui échoue après retour du réseau | "Envoi impossible pour le moment (…)" avec le bouton « Réessayer maintenant » et un nouvel essai automatique |
| Appel du jour déjà validé | « Cet appel est validé : il ne peut plus être modifié ici. La direction peut le rouvrir avec un motif. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : parent ouvrant `/v2/teacher/attendance` → « Accès refusé »

#### 22.30 Saisie de notes hors ligne
Compte : Enseignant · Où : `/v2/teacher/assessments/<id>/grades` (évaluation en brouillon, période ouverte : chapitre 08) · Prérequis : mode A ; si la feuille affiche « Les notes de cette période sont verrouillées : la période est clôturée ou en cours de clôture. Les saisies seront refusées. », choisir une autre évaluation ou faire ouvrir une période
1. En ligne, ouvrir la feuille. Lire la zone « Synchronisation des notes ».
2. Dans "Réseau", choisir "Hors connexion".
3. Saisir trois notes : `12,5`, `ABS`, `15` (pour trois élèves différents).
4. Lire la zone « Synchronisation des notes ».
5. Fermer l'onglet, rétablir le réseau, rouvrir la feuille.
6. Cliquer sur « Enregistrer ».
7. Variante : refaire les étapes 2 et 3, quitter la feuille pour `/v2/teacher/classes` (réseau coupé : navigation par le menu), rétablir le réseau et attendre ; rouvrir la feuille.
Résultat attendu : (1) « Aucune saisie en attente sur cet appareil. » ; (4) « Hors ligne : 3 notes gardées sur cet appareil. Envoi à la reconnexion. » (et sur la feuille « Hors connexion : vos saisies sont conservées et seront envoyées dès le retour du réseau. ») ; (5) « 3 saisies hors ligne restaurées depuis cet appareil. Vérifiez-les puis enregistrez. » ; (6) "Notes synchronisées à …" et, si un lot est rejoué, la mention "(lot déjà enregistré, rien n'a été doublé)" ; aucune note perdue ni dupliquée ; (7) l'envoi part seul depuis une autre page du portail enseignant. Un autre compte sur le même appareil ne voit pas les brouillons.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Note `abc` | « Saisissez un nombre (par exemple 12,5) ou un code : ABS, ABJ, DISP, NN. » |
| Note supérieure au barème (`25` sur 20) | « La note dépasse le barème (20). » |
| Évaluation soumise ou période verrouillée entre-temps | "Évaluation figée ou période verrouillée : …" et saisies conservées ; bouton « Abandonner mes saisies hors ligne » avec confirmation « Abandonner définitivement les saisies hors ligne de cette évaluation ? Elles ne seront jamais envoyées. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : une évaluation d'une classe étrangère est refusée par l'API (chapitre 08)

#### 22.31 Conflit de notes entre deux appareils
Compte : Enseignant sur deux appareils (deux navigateurs ou un navigateur et une fenêtre privée) · Où : `/v2/teacher/assessments/<id>/grades` · Prérequis : 22.30 ; évaluation en brouillon
1. Appareil A : ouvrir la feuille en ligne, couper le réseau, saisir `15` pour un élève.
2. Appareil B (même compte, en ligne) : saisir `5` pour **le même** élève et enregistrer.
3. Appareil A : rétablir le réseau.
4. Lire le tableau, tester « Voir les deux », puis « Garder la mienne ». Refaire le test et choisir « Prendre celle du serveur ».
Résultat attendu : (3) le tableau « Notes modifiées par quelqu'un d'autre » apparaît avec les colonnes « Élève », « Ma saisie » (15) et « Valeur du serveur » (5) ; la grille montre 5 ; **rien n'a été écrasé** ; l'avertissement « Garder la mienne remplace la valeur du serveur par votre saisie. » est visible ; (4) « Garder la mienne » enregistre 15 ; « Prendre celle du serveur » conserve 5 ; messages "Conflit résolu pour …". Hors connexion et sans valeur serveur connue : « Impossible de garder votre saisie sans connaître la valeur du serveur : rétablissez la connexion. ».
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Rien d'écrasé silencieusement  - [ ] Droit refusé : sans objet

#### 22.32 Déconnexion, session expirée et stockage indisponible
Compte : Enseignant · Où : portail enseignant · Prérequis : 22.28 et 22.30 faits (copie d'emploi du temps et brouillon non envoyé présents)
1. Avec un brouillon de notes non envoyé, cliquer sur « Se déconnecter », puis se reconnecter avec le même compte.
2. Se connecter avec un **autre** compte du même établissement sur le même appareil (par exemple le directeur des études) et ouvrir les écrans de saisie.
3. Dans une fenêtre de navigation privée, refaire l'étape 3 de 22.30.
4. (Si la durée de la session est connue) laisser expirer la session avec des saisies en attente, rétablir le réseau.
Résultat attendu : (1) la copie de l'emploi du temps est effacée (`/offline` n'en affiche plus) ; les brouillons non envoyés sont **conservés** et retrouvés à la reconnexion du même compte ; (2) l'autre compte ne voit ni n'envoie les brouillons du premier ; (3) selon le navigateur, l'avertissement « Le stockage de cet appareil est indisponible (navigation privée ?). Vos saisies seront perdues si vous fermez cette page avant l'envoi. » (Chrome autorise IndexedDB en navigation privée : message possible surtout sous Safari, à vérifier) ; (4) rien n'est envoyé sans session valide : "Session expirée : reconnectez-vous avec le même compte pour envoyer …" ; l'envoi reprend avec le même compte sans perte (durée d'expiration : chapitre « Connexion », à vérifier).
Cas invalides : file pleine (plus de 25 évaluations en attente ou 1 000 lignes) : « La file hors ligne de cet appareil est pleine : cette saisie n'est PAS gardée sur l'appareil. Enregistrez dès que le réseau revient, sans fermer la page. » (non atteint ici).
- [ ] Cas nominal  - [ ] Isolation entre comptes  - [ ] Droit refusé : un autre compte ne voit pas les brouillons

## F. Contenu : états, français, formats

#### 22.33 États vides lisibles
Compte : Parent, Élève, Enseignant, Secrétariat · Où : voir tableau · Prérequis : graine de départ
1. Ouvrir chaque écran du tableau.
| Écran | Compte | Message vide attendu |
|---|---|---|
| `/v2/parent/children/<id Nadia>/emergency` (avant 21.12) | Parent | « Aucun contact d'urgence. » |
| `/v2/parent/children/<id Nadia>/finance` | Parent | « Aucune échéance à payer. » |
| `/v2/parent/children/<id Nadia>/upcoming` | Parent | « Aucune évaluation planifiée. » avec « Les évaluations apparaissent ici dès qu'elles sont inscrites à l'emploi du temps. » |
| `/v2/student/attendance` | Élève | « Aucune absence ni retard. » avec « Tout est en règle. » (si aucune absence) |
| `/v2/teacher/leaves` | Enseignant | « Aucun congé. » |
| `/v2/students` avec la recherche `ZZZ` | Secrétariat | « Aucun élève ne correspond à votre recherche. » |
Résultat attendu : chaque état vide est un message en français, explicite, avec une indication utile ; jamais une page blanche, un tableau sans explication ni "undefined" / "null" ; l'icône est décorative (masquée aux lecteurs d'écran).
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Aucun écran blanc  - [ ] Droit refusé : sans objet

#### 22.34 États de chargement
Compte : Parent · Où : `/v2/parent`, `/v2/parent/children/<id Nadia>/results` · Prérequis : aucun
1. Dans "Réseau", choisir la limitation "Slow 3G" et recharger `/v2/parent`.
2. Observer l'écran entre la requête et l'affichage.
3. Faire de même sur la page des résultats.
Résultat attendu : un indicateur « Chargement… » (rotation + texte, annoncé comme statut) apparaît à la place du contenu, jamais une page vide ni un saut brutal ; les cartes se chargent indépendamment (chacune a son propre chargement) ; les tableaux montrent « Chargement des données… » (lecteur d'écran) pendant la lecture.
Cas invalides : établissement inconnu (aucun établissement dans l'adresse ni la session) : « Établissement inconnu. Ouvrez l'adresse de votre établissement ou contactez l'assistance. » (non testable avec la graine).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 22.35 États d'erreur : réseau, refus d'une carte, nouvelle tentative
Compte : Parent · Où : `/v2/parent` · Prérequis : F12 > "Réseau"
1. Dans "Réseau", clic droit sur la requête vers `people/children` (liste des enfants) > "Bloquer l'URL de la requête". Recharger.
2. Lire l'erreur ; retirer le blocage ; cliquer sur « Réessayer ».
3. Bloquer cette fois une requête de la finance (motif `finance/me`), recharger.
4. Lire les quatre cartes d'un enfant.
5. Retirer le blocage, recharger.
Résultat attendu : (2) un bloc d'erreur (alerte) avec un message en français du type « Connexion au serveur impossible. Vérifiez votre connexion internet. » et le bouton « Réessayer » ; après le déblocage, « Réessayer » charge la liste sans recharger la page ; (4) les cartes sans problème s'affichent normalement ; la carte « Scolarité restante » dit « Information indisponible pour le moment. » sans casser la page. Une erreur du serveur (5xx) affiche « Une erreur est survenue. Veuillez réessayer. » ; une erreur métier affiche le message du serveur, en français. Aucun message ne montre de trace technique, de code HTTP ou de JSON.
Cas invalides : session expirée en cours d'usage : « Votre session a expiré. Veuillez vous reconnecter. » (non testé ici, voir chapitre « Connexion »).
- [ ] Cas nominal  - [ ] Carte indisponible isolée  - [ ] Droit refusé : sans objet

#### 22.36 Français sans code technique brut
Compte : Parent, Élève, Enseignant · Où : voir tableau · Prérequis : 21.6, 21.12, 21.27 du chapitre 21 faits (données présentes)
1. Sur chaque écran du tableau, lancer dans la console : `[...document.body.innerText.matchAll(/\b[A-Z][A-Z_]{3,}\b/g)].map(m => m[0])` puis `document.body.innerText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/g)`.
2. Lire à l'œil le texte de l'écran.
| Écran | À regarder | Constat connu |
|---|---|---|
| `/v2/parent/children/<id Nadia>/attendance` (justificatif déposé) | ligne "Motif : …" ; ligne "Élève : …" de la fenêtre | "Motif : ILLNESS" ; identifiant à la place du nom |
| `/v2/parent/children/<id Nadia>/emergency` | liste « Responsables » | code de la relation affiché brut |
| `/v2/parent/children/<id Nadia>/results` | "Décision : …", colonne « État » | code de décision / d'état si le libellé est inconnu |
| `/v2/teacher/leaves` (une demande envoyée) | colonne « Type » | code du type de congé |
| `/v2/student/results` | mentions et décisions | libellé traduit pour les codes connus (Insuffisant… Excellent) ; code inconnu affiché tel quel |
Résultat attendu : aucune valeur de code interne (MAJUSCULES_SOULIGNÉES, identifiant, UUID, `null`, `undefined`, `[object Object]`) ne doit apparaître. Les acronymes légitimes (CEPE, BEPC, REC-… numéro de reçu, matricule) sont acceptables. Les constats de la dernière colonne sont les **défauts connus** (voir Écarts) : noter tout autre cas.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Défauts connus relevés  - [ ] Droit refusé : sans objet

#### 22.37 Formats de date, de nombre, de montant et fuseau (`fr-CI`)
Compte : Parent, Enseignant · Où : `/v2/parent/children/<id Salimata>/finance`, `/v2/parent/children/<id Nadia>/results`, `/v2/teacher` · Prérequis : aucun
1. Sur la scolarité de Salimata, relever un montant, une date limite, la date d'un paiement.
2. Sur les résultats de Nadia, relever la moyenne, le rang, une note.
3. Sur `/v2/teacher`, relever la date de la description et les horaires des séances.
4. Dans F12 > "Sensors" > "Location" > "Timezone ID", choisir `Pacific/Auckland`, recharger `/v2/teacher` et `/v2/parent/children/<id Nadia>/schedule`, relire date et horaires. Remettre le réglage par défaut.
Résultat attendu : montants entiers en franc CFA avec espace (insécable) comme séparateur de milliers et le sigle "F CFA" ("100 000 F CFA", jamais de décimale) ; dates courtes en toutes lettres abrégées ("7 oct. 2026") ; heures sur 24 h ("08:00") ; décimales avec virgule ("13,20", jamais "13.20") ; rangs "2 sur 8". Le fuseau de l'établissement est `Africa/Abidjan` (UTC) : à l'étape 4, la date du jour de `/v2/teacher` et les horaires des séances **ne changent pas**, même si le fuseau de l'ordinateur est décalé de 13 heures. (Les champs de type date du navigateur — par exemple « Premier jour d'absence » — s'affichent selon la langue du navigateur : réglage hors application.)
Cas invalides : un montant saisi avec virgule est refusé (chapitre 21, 21.9).
- [ ] Cas nominal  - [ ] Aucun format anglo-saxon  - [ ] Droit refusé : sans objet

#### 22.38 Pages d'erreur 404 et « Accès refusé »
Compte : Parent · Où : `/v2/parent/children/abc`, `/page-inexistante`, `/unauthorized` · Prérequis : aucun
1. Ouvrir `/v2/parent/children/abc`.
2. Ouvrir `/page-inexistante`.
3. Ouvrir `/v2/teacher` (refusé) puis lire la page.
Résultat attendu : (3) la page « Accès refusé » est en français, centrée, lisible dans les deux thèmes, avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page." et un lien "Retour à l'accueil" ; (1) et (2) la page 404 par défaut de Next, **sans habillage de l'application** et vraisemblablement en anglais ("404" / "This page could not be found.") : voir Écarts ; elle ne doit pas laisser fuiter de donnée.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] 404 sans fuite de donnée  - [ ] Droit refusé : (3)

#### 22.39 Titres d'onglet et d'historique
Compte : Parent, Élève, Enseignant · Où : cinq pages de chaque portail · Prérequis : aucun
1. Sur cinq pages différentes de chaque portail, lancer `document.title`.
2. Ouvrir l'historique du navigateur (Ctrl+H) et lire les libellés.
Résultat attendu : chaque portail a un titre de la forme "Espace parent · EcoleDigitale", "Espace élève · EcoleDigitale", "Espace enseignant · EcoleDigitale" ; le titre est **le même** sur toutes les pages du portail (la page n'est donc pas identifiable par son titre seul : Mineur, voir Écarts). La page hors ligne a son propre titre ("Hors ligne - EcoleDigitale").
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Titres cohérents  - [ ] Droit refusé : sans objet

---

## Données créées

| Enregistrement | Scénario | Remarque |
|---|---|---|
| Appel soumis hors ligne (séance du jour, 6e A ; ou « Appel du jour », CP1 A) avec COULIBALY Moussa absent | 22.29 | à rouvrir ou annuler par la direction (chapitre 06) |
| Notes `12,5`, `ABS`, `15` sur l'évaluation `Contrôle test guide` (brouillon) | 22.30, 22.31 | évaluation du chapitre 08, à supprimer ou à annuler avec elle |
| Copie hors ligne de l'emploi du temps, brouillons, file d'appel (navigateur : IndexedDB `ed-offline`) | 22.28 à 22.32 | effacés par « Se déconnecter » (copie) ou à la main (F12 > « Application » > "Clear site data") |
| Service worker, caches `ed-shell-v2` et `ed-static-v2`, application installée | 22.25, 22.27 | "Unregister", suppression des caches, désinstallation de l'application, retour au mode A |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| `/v2/parent/children/abc` et toute adresse inconnue | aucune page `not-found` personnalisée : la page 404 par défaut de Next s'affiche, vraisemblablement en anglais et hors habillage (à vérifier) | Mineur |
| Tous les écrans des portails | titre d'onglet identique à toutes les pages d'un portail ("Espace parent · EcoleDigitale") ; l'écran de messages affichait "Administration" (QA C-12-07) | Mineur |
| `/v2/parent/children/<id>` (tableau de bord) | les cartes sont des `h3` directement sous le `h1` (saut de niveau de titre) | Mineur |
| `/v2/parent/children/<id>/results` à 375 px | la colonne « Matière » des notes publiées est masquée sous 640 px : une note sans sa matière | Suggestion |
| Pages à champs (`FormField`) | les champs de saisie font 40 px de haut, y compris sur mobile (boutons : 44 px) | Suggestion |
| `/v2/parent` carte « Absences » | le texte "{n} à justifier" est en orange fixe (`text-amber-700`) : contraste à mesurer en thème sombre | Suggestion |
| Thème | le thème par défaut est « système » (`useUIStore`), alors que l'ancien guide et `ThemeProvider` disent « sombre par défaut » ; aucun sélecteur dans la coque | Suggestion |
| Écrans de justificatifs et de congés | codes bruts affichés (voir 22.36 et chapitre 21, Écarts) | Mineur |
| Formulaires | le focus n'est pas déplacé vers le premier champ en erreur après un envoi refusé | Suggestion |
| Messages `pwa.installApp` et `pwa.updateAvailable` | existent dans `fr-CI.json` mais aucun composant ne les affiche | Suggestion |
| `/offline` en développement avec le mode B | les fichiers de page ne sont pas versionnés, donc pas tous précachés : la page peut s'afficher sans son script réseau coupé | Suggestion |
| Saisie hors ligne de la vie scolaire | non disponible hors ligne (spec 006 AC12.5 "conçue pour le hors-ligne" non implémentée) | Majeur (limite connue) |

## À vérifier en test

- Rendu en anglais de la page 404 par défaut et comportement sur `/page-inexistante`.
- Contraste réel du texte orange de la carte « Absences » en thème sombre, des pastilles d'état et de l'indicateur de réseau.
- Ouverture réelle du tiroir mobile au clavier (premier focus sur « Fermer le menu ») et absence de piège.
- Sortie du mode B (dé-enregistrement) et état du service worker après `NEXT_PUBLIC_PWA=0`.
- Message de stockage indisponible en navigation privée (Safari) et durée d'expiration de session pour 22.32.
- Rendu hors ligne complet de `/offline` en mode B en développement (JavaScript non versionné).
- Lecture d'écran réelle (NVDA, VoiceOver) : le balayage automatique ne prouve que la présence des rôles, pas la vocalisation (`apps/web/docs/accessibility.md`, "Limites").
- Checklist sur appareil réel (Android Chrome, iOS Safari, application installée) de `apps/web/docs/offline-advanced.md`, § 8, à dérouler par une personne.

## Non couvert / limites connues

- Les contrôles d'accessibilité des PDF (balisage, ordre de lecture) : non couverts par l'audit automatique, à faire à la main sur un bulletin et un reçu téléchargés.
- Écrans d'administration (tableaux de bord, formulaires de gestion) : leur accessibilité détaillée relève de chacun des chapitres de module ; ce chapitre n'en prend que quelques exemples (secrétariat, économe).
- Envoi en arrière-plan application fermée : non prévu ; l'envoi reprend à la prochaine ouverture du portail enseignant.
- Fonctionnement hors ligne limité à l'appel, aux notes en brouillon et à "mon" emploi du temps en lecture seule ; les notes publiées ou soumises ne s'éditent pas hors ligne.
- Aucun sélecteur de langue : français uniquement (`fr-CI`).
- Les images (logo de l'établissement) sont décoratives (`alt=""`) ; aucune alternative textuelle propre n'est testée.
