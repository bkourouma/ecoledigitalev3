[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](18-portails-paiement.md) · [Suivant →](20-console-plateforme.md)

# Phase 19 — Sécurité, droits et isolation

Objectif : essayer d'ouvrir ou de faire ce qu'on ne doit pas pouvoir faire, et constater un refus propre (aucune donnée d'autrui, aucun détail technique, aucune page blanche). Un seul cas où l'on voit ce qu'on ne devrait pas voir est un défaut **Bloquant** : prévenir l'équipe tout de suite.

Précondition : les phases précédentes ont été jouées (le journal d'audit en contient les actes, et les « quatre yeux » ont leurs objets : remboursement, feuille de notes, mesure de vie scolaire…). Trois navigateurs distincts sont nécessaires pour l'isolation (voir l'étape *Ouvrir les trois contextes*).

**Refus standard** (utilisé dans toutes les étapes de droits) : l'adresse tapée redirige vers `/unauthorized`, page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page." et le lien "Retour à l'accueil" ; aucune donnée de l'établissement n'apparaît. Toujours **taper l'adresse complète dans la barre d'adresse puis Entrée** (pas de clic dans le menu).

⚠️ *Écart connu* : la page « Accès refusé » garde l'ancienne mise en page et peut être précédée d'un instant de « Chargement… » ; le critère de réussite est le refus sans donnée, pas l'habillage.

---

## Étape 352 — Propriétaire : la console de la plateforme lui est fermée
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Atterrissage `/v2/direction`

Compte : `direction.generale@secondaire-test.test` (MFA : le code du moment est proposé dans le panneau de connexion).

1. Se connecter ; vérifier l'arrivée sur `/v2/direction` et que le menu contient « Journal d'audit ».
2. Taper dans la barre d'adresse, une par une :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/platform/tenants` | retour à `/v2/platform/login` ; aucune organisation affichée |
| `/v2/platform/plans` | retour à `/v2/platform/login` |
| `/v2/platform/audit` | retour à `/v2/platform/login` |

✅ Les trois adresses ramènent à la connexion de la console : un propriétaire d'établissement n'est pas un opérateur de la plateforme.

☐ OK ☐ KO

---

## Étape 353 — Directeur : paie du propriétaire et console fermées
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Atterrissage `/v2/direction`

Compte : `directeur@secondaire-test.test` (MFA).

1. Se connecter (« Se déconnecter » du propriétaire puis connexion par le panneau).
2. Taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/payroll/configuration/settings` | Refus standard (« Accès refusé ») : les réglages de paie sont au propriétaire seul |
| `/v2/platform/tenants` | retour à `/v2/platform/login` |
| `/v2/platform/audit` | retour à `/v2/platform/login` |

3. Taper `/v2/settings/subscription` : l'écran s'ouvre en lecture, sans bouton de modification de l'abonnement.

✅ Les trois adresses sont refusées comme indiqué ; l'abonnement n'est que lisible.

⚠️ *Écart connu* : `/v2/access/roles/new` s'ouvre pour le directeur (la garde ne vérifie que la lecture) ; l'enregistrement d'un rôle est refusé par le serveur ("Action non autorisée." ou demande de confirmation d'identité).

☐ OK ☐ KO

---

## Étape 354 — Directeur des études et responsable pédagogique : trois adresses chacun
👤 **directeur des études** (secondaire-test) · fenêtre **A** · puis 👤 **responsable pédagogique** (secondaire-test) · fenêtre **A**

Comptes : `etudes@secondaire-test.test` (MFA) arrive sur `/v2/academic/years` ; `pedagogie@secondaire-test.test` (MFA) arrive sur `/v2/assessments`.

1. Directeur des études, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/finance` | Refus standard |
| `/v2/audit` | Refus standard |
| `/v2/reportcards/identity` | Refus standard |

2. « Se déconnecter », connexion en responsable pédagogique, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/assessments/new` | Refus standard (il relit les feuilles, il n'en crée pas) |
| `/v2/reportcards/issue` | Refus standard |
| `/v2/finance` | Refus standard |

✅ Six refus standard ; aucune donnée financière ni de journal n'apparaît.

☐ OK ☐ KO

---

## Étape 355 — Secrétariat : trois adresses interdites et une page qui s'ouvre
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Atterrissage `/v2/students`

Compte : `secretariat@secondaire-test.test` (MFA).

1. Se connecter, puis taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/admissions/settings` | Refus standard |
| `/v2/finance/payments/new` | Refus standard |
| `/v2/schoollife` | Refus standard |

2. Taper `/v2/finance/refunds` : **la page s'ouvre** (le secrétariat a la lecture des paiements), mais aucune demande ni approbation n'est proposée.

✅ Trois refus standard ; sur les remboursements, liste lisible et aucun bouton d'action.

⚠️ *Écart connu* : l'ancien guide donnait `/v2/finance/refunds` comme refusée : l'attendu correct est "s'ouvre, sans action".

☐ OK ☐ KO

---

## Étape 356 — Économe : trois adresses interdites
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 Atterrissage `/v2/finance`

Compte : `econome@secondaire-test.test` (MFA).

1. Se connecter, puis taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/students/new` | Refus standard |
| `/v2/assessments` | Refus standard |
| `/v2/finance/providers` | Refus standard (fournisseurs de paiement réservés à la direction) |

✅ Trois refus standard ; l'économe garde l'accès à `/v2/finance`.

☐ OK ☐ KO

---

## Étape 357 — Enseignant : trois adresses interdites et un écran sans garde
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Atterrissage `/v2/teacher`

Compte : `enseignant@secondaire-test.test` (sans MFA).

1. Se connecter en fenêtre privée, puis taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/finance` | Refus standard |
| `/v2/audit` | Refus standard |
| `/v2/settings` | Refus standard |

2. Taper `/v2/admin/members` (écran sans garde de page).

✅ Trois refus standard. Étape 2 : le cadre de l'écran s'ouvre mais la liste ne se charge pas ; message "Action non autorisée." ; aucune ligne de membre. Sur sa feuille de notes, l'enseignant ne voit aucun bouton « Marquer comme relue », « Approuver » ni « Publier les notes ».

⚠️ *Écart connu* : `/v2/admin/members` ouvre l'écran puis affiche une erreur au lieu de rediriger vers « Accès refusé » (Mineur).

☐ OK ☐ KO

---

## Étape 358 — Éducateur : il propose, la direction valide
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 Atterrissage `/v2/attendance`

Compte : `educateur@secondaire-test.test` (sans MFA).

1. « Se déconnecter » de l'enseignant, connexion en éducateur, puis taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/schoollife/validations` | Refus standard (il propose les mesures, il ne les valide pas) |
| `/v2/finance` | Refus standard |
| `/v2/audit` | Refus standard |

✅ Trois refus standard ; `/v2/settings` s'ouvre en lecture seule (bandeau « Vous pouvez consulter ces informations mais pas les modifier. »).

☐ OK ☐ KO

---

## Étape 359 — Responsable des examens et chargé d'admissions : trois adresses chacun
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · puis 👤 **chargé d'admissions** (secondaire-test) · fenêtre **A**

Comptes : `examens@secondaire-test.test` (arrive sur `/v2/examinations`) et `admissions@secondaire-test.test` (arrive sur `/v2/admissions`), tous deux sans MFA.

1. Responsable des examens, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/finance` | Refus standard |
| `/v2/students/new` | Refus standard |
| `/v2/results/overrides` | Refus standard |

2. Chargé d'admissions, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/finance` | Refus standard |
| `/v2/students` | Refus standard (le dossier élève naît à l'acceptation de l'offre) |
| `/v2/documents` | Refus standard |

✅ Six refus standard.

☐ OK ☐ KO

---

## Étape 360 — Parent et élève : le portail ne s'ouvre pas sur la gestion
👤 **parent** (secondaire-test) · fenêtre **B** · puis 👤 **élève** (secondaire-test) · fenêtre **B**

Comptes : `parent@secondaire-test.test` (DIABATE Séka, arrive sur `/v2/parent`) et `eleve@secondaire-test.test` (DIABATE Nadia, arrive sur `/v2/student`), sans MFA.

1. Parent, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/students` | Refus standard |
| `/v2/finance/invoices` | Refus standard (le parent lit la scolarité de ses enfants, pas les factures de gestion) |
| `/v2/direction` | Refus standard |

2. « Se déconnecter », connexion en élève, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/parent` | Refus standard |
| `/v2/finance` | Refus standard |
| `/v2/attendance` | Refus standard |

✅ Six refus standard.

☐ OK ☐ KO

---

## Étape 361 — Visiteur non connecté : retour à la connexion, pages publiques
👤 **aucun compte** · fenêtre **B** (« Se déconnecter » puis fenêtre privée neuve, aucune session ouverte)

1. Taper `/v2/finance`, `/v2/students`, `/v2/direction`, `/v2/parent`, `/v2/audit`.
2. Taper les pages publiques `/v2/login`, `/v2/forgot-password`, `/v2/verify`.

✅ Étape 1 : chaque adresse ramène à `/login`, sans aucun contenu entrevu. Étape 2 : les trois pages s'ouvrent sans connexion et ne montrent aucune donnée d'établissement.

⚠️ *Écart connu* : une adresse qui n'existe pas (par exemple `/page-inexistante`) ou un identifiant mal formé (`/v2/parent/children/abc`) affiche la page 404 par défaut de Next, vraisemblablement en anglais ("This page could not be found.") et sans habillage (Mineur). Elle ne doit révéler aucune donnée.

☐ OK ☐ KO

---

## Étape 362 — Ouvrir les trois contextes d'établissement
👤 **secrétariat** de chaque établissement · trois navigateurs séparés

Deux fenêtres privées d'un même navigateur partagent la même session : utiliser une fenêtre normale, une fenêtre privée et un second navigateur (ou un autre profil).

| Contexte | Compte | Établissement |
| :--- | :--- | :--- |
| Fenêtre **A** (normale) | `secretariat@secondaire-test.test` | Collège Le Baobab |
| Fenêtre **B** (privée) | `secretariat@primaire-test.test` | École Les Palmiers |
| Troisième navigateur **C** | `secretariat@superieur-test.test` | Université Horizon |

1. Se connecter dans chaque contexte (panneau de `/login`, code MFA proposé).
2. Dans chacun, ouvrir « Mon compte » > « Sécurité du compte » et lire l'établissement affiché.

✅ Trois sessions indépendantes, chacune sur son établissement. Ne jamais se reconnecter dans un contexte avec le compte d'un autre établissement (cela remplace la session).

☐ OK ☐ KO

---

## Étape 363 — Les listes ne mélangent pas les établissements
👤 **secrétariat** · fenêtres **A**, **B** et navigateur **C** · 📂 Menu **« Élèves »** (`/v2/students`), puis **« Classes »** (`/v2/academic/classrooms`)

1. Dans A, relever le nombre d'élèves et le code de classe `6E-A`. Dans B : `CP1-A` et `GS-A`. Dans C : `L1-A`.
2. Dans chaque contexte, ouvrir "Facturation" (`/v2/finance/invoices`) si le menu la propose (lecture) et relever le montant de scolarité d'une facture.

✅ Les noms des élèves de la graine sont **identiques** dans les trois établissements (DIABATE Nadia, BAMBA Aya…) mais ce sont des personnes distinctes ; scolarité 200 000 F CFA au Collège, 120 000 F CFA à l'École, 600 000 F CFA à l'Université ; aucune classe ni aucun montant d'un autre établissement dans les listes ni dans les filtres.

☐ OK ☐ KO

---

## Étape 364 — Un identifiant copié d'un établissement et collé dans l'autre
👤 **secrétariat** · fenêtres **A**, **B** et navigateur **C** · 📂 Fiches de détail

1. Dans A, ouvrir la fiche d'un élève (`/v2/students/<id>`) et **copier l'identifiant** (la suite après le dernier `/`). Faire de même pour une classe (`/v2/academic/classrooms/<id>`) et une inscription (`/v2/enrollments/<id>`).
2. Dans B, puis dans C, taper la **même adresse** avec l'identifiant copié, pour chacun des trois objets.
3. Répéter dans le sens inverse (B vers A, C vers A).
4. Dans une fenêtre sans connexion, coller la même adresse.

✅ Étapes 2 et 3 : la page s'ouvre **sans donnée** et affiche un message de type "introuvable" propre à l'écran (par exemple "Ressource introuvable." ou "Élève introuvable"). Jamais « Accès refusé », jamais le nom de l'élève, jamais "cet élève appartient à un autre établissement". Étape 4 : retour à `/login`.

⚠️ *Test d'erreur* : taper `/v2/students/11111111-1111-4111-8111-111111111111` (identifiant bien formé mais inexistant) : réponse **indiscernable** de celle d'un objet d'un autre établissement (c'est le critère d'isolation). Un identifiant tronqué (`/v2/students/abc`) donne la page 404.

☐ OK ☐ KO

---

## Étape 365 — Même test directement sur l'API
👤 **secrétariat** · fenêtre **B** (École) · 📂 Outils de développement (F12) > Console, sur `http://localhost:3000`, onglet connecté

Ne jamais afficher ni recopier le jeton.

1. Dans A (Collège), copier l'identifiant d'un élève (`<id-A>`).
2. Dans B (École), exécuter, en remplaçant `<id-A>` :

```js
const r = await fetch('/api/v1/people/students/<id-A>');
console.log(r.status, await r.text());
```

3. Toujours dans B, exécuter la même requête **sans jeton** vers l'API directe :

```js
const r = await fetch('http://localhost:4000/api/v1/people/students/<id-A>', { headers: { 'X-Tenant': 'secondaire-test' } });
console.log(r.status);
```

✅ Étape 2 : statut **404**, corps JSON du type `people.student_not_found` avec le message "Élève introuvable (`<id-A>`)." (l'identifiant reflété est celui que vous avez saisi), jamais 403 ni 200. Étape 3 : statut **401** (un en-tête `X-Tenant` ne remplace jamais une session).

⚠️ *Test d'erreur* : `.../students/xyz` (non valide) : 400 ou 404, jamais 500 ni trace technique.

☐ OK ☐ KO

---

## Étape 366 — À l'intérieur du Collège : parent, élève et enseignant cloisonnés
👤 **secrétariat** (copie des identifiants) · fenêtre **A** ; 👤 **parent**, **élève** · fenêtre **B**

1. Secrétariat (A) : sur `/v2/students`, ouvrir la fiche de **BAMBA Aya** (autre tuteur) et copier son identifiant.
2. Parent (`parent@secondaire-test.test`, B) : taper `/v2/parent/children/<id d'Aya>`, puis la même adresse suivie de `/results`, `/finance`, `/reportcards`, `/attendance`.
3. Élève (`eleve@secondaire-test.test`, B) : taper `/v2/students/<id d'Aya>`. Puis, si un reçu de DIABATE Salimata existe (phase des encaissements), copier son identifiant côté économe et taper `/v2/student/finance/receipts/<id du reçu>`.

✅ Étape 2 : aucune donnée d'Aya, message neutre de type introuvable ; jamais "vous n'avez pas accès à cet enfant" (révèlerait l'existence : défaut Majeur). Étape 3 : `/v2/students/<id>` donne « Accès refusé » ; le reçu de la sœur donne "Ressource introuvable.".

☐ OK ☐ KO

---

## Étape 367 — Quatre yeux : remboursement, notes, corrections et surcharges
👤 **économe**, **directeur**, **propriétaire**, **directeur des études**, **enseignant** · fenêtres **A** et **B**

Principe : la même personne ne peut pas faire les deux gestes d'un circuit ; le serveur compare l'utilisateur au demandeur. Pour chaque circuit, l'objet a été créé dans une phase précédente : rejouer seulement le geste interdit. Si l'objet n'existe pas, jouer d'abord l'étape qui le crée.

1. **Remboursement** (phase finance : l'économe a demandé un remboursement). Économe (A) : `/v2/finance/refunds`, cliquer **« Approuver »** sur **sa propre** demande, confirmer.
2. Rejouer le même geste dans chaque ligne du tableau :

| Circuit (étape déjà jouée) | Qui tente | Geste | Message exact attendu |
| :--- | :--- | :--- | :--- |
| Remboursement | économe | « Approuver » sa demande | "Le demandeur ne peut pas approuver son propre remboursement." |
| Feuille de notes soumise (phase notes) | directeur qui a soumis | « Marquer comme relue », puis « Approuver », puis « Publier les notes » | "La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier." |
| Correction d'une note publiée | directeur des études | demander puis « Approuver » sa propre demande | "Le demandeur d'une correction ne peut pas l'approuver lui-même." |
| Surcharge de résultat | directeur | demander puis « Approuver » sa propre demande | "Le demandeur d'une surcharge ne peut pas l'approuver lui-même." |

3. Contrôle de rôle : l'enseignant n'a, sur sa feuille de notes, aucun bouton de relecture, d'approbation ni de publication.

✅ Chaque refus affiche le message exact ci-dessus ; l'objet reste dans son état ("en attente", « Soumise »…). L'approbation par une **autre** personne (propriétaire pour le remboursement et la surcharge, directeur des études pour la correction) réussit.

⚠️ *Écart connu* : le circuit de paie (le directeur calcule puis tente d'arrêter le bulletin : "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter.") n'est actif que si le propriétaire a **coché** « Séparation des tâches » dans les réglages de paie (décoché par défaut) ; à rétablir ensuite.

☐ OK ☐ KO

---

## Étape 368 — Quatre yeux : vie scolaire, conseil, affectation d'État
👤 **éducateur**, **directeur**, **propriétaire**, **directeur des études**, **secrétariat** · fenêtres **A** et **B**

| Circuit (étape déjà jouée) | Qui tente | Geste | Message exact attendu |
| :--- | :--- | :--- | :--- |
| Mesure « Exclusion temporaire (démonstration) » proposée (phase vie scolaire) | directeur qui l'a proposée | valider sa propre proposition | "La validation doit venir d'une autre personne que le proposant (séparation des tâches)." |
| Déverrouillage d'un conseil de classe (phase conseils) | directeur des études qui a demandé | approuver sa propre demande | "L'approbation doit venir d'une autre personne que le demandeur (séparation des tâches)." |
| Dossier d'élève affecté par l'État (phase affectés) | enregistreur du dossier | « Vérifier » son propre dossier | "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." |
| Séance comptable (phase emploi du temps) | directeur qui l'a créée | la valider pour la paie | "Validation "à quatre yeux" : celui qui a saisi une séance comptable ne peut pas la valider." |

1. Rejouer chaque ligne avec le compte indiqué ; une **autre** personne de la direction réussit ensuite le même geste.
2. L'éducateur n'a ni `/v2/schoollife/validations` ni bouton « Valider » (étape *Éducateur*) ; le secrétariat n'ouvre pas `/v2/stateassign/verification` (« Accès refusé »).

✅ Messages exacts ci-dessus ; la mesure reste « Proposée » ; le dossier reste « Enregistré ».

⚠️ *Test d'erreur* : un avertissement sans case « quatre yeux » (« Avertissement (démonstration) ») peut être validé par son proposant : la séparation dépend du **type** de mesure, ce n'est pas un défaut.

☐ OK ☐ KO

---

## Étape 369 — Anti-escalade : le directeur ne s'octroie pas le rôle de propriétaire
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Attributions de rôles »** (`/v2/access/assignments`)

1. Dans **« Nouvelle attribution »**, choisir l'utilisateur `educateur@secondaire-test.test` et le rôle **« Propriétaire »**, périmètre **« Tout l'établissement »**.
2. Cliquer **« Attribuer le rôle »**.

✅ Refus : « Action refusée : vous ne pouvez accorder que des permissions que vous détenez vous-même sur ce périmètre. Permissions qui vous manquent : » suivi de la liste ; **aucune attribution** n'est créée (la liste est inchangée). Si l'attribution réussit, c'est un défaut **Bloquant** : prévenir l'équipe.

⚠️ *Test d'erreur* : tenter de modifier un rôle système (ouvrir « Secrétariat ») : "Ce rôle système est verrouillé. Clonez-le pour créer une variante modifiable." Ne jamais tenter de révoquer le dernier propriétaire d'un établissement de départ (ce test se fait dans une organisation jetable).

☐ OK ☐ KO

---

## Étape 370 — MFA : faux code, puis rejeu d'un code déjà utilisé
👤 **économe** puis **directeur** (secondaire-test) · fenêtre **A** · 📂 Page `/login`

1. « Se déconnecter » ; sur `/login`, cliquer le compte `econome@secondaire-test.test` dans le panneau. L'écran de vérification en deux étapes demande le code à 6 chiffres.
2. Effacer le code proposé et saisir `000000`.
3. Saisir ensuite le code du moment proposé : connexion réussie.
4. « Se déconnecter », se connecter en `directeur@secondaire-test.test` avec le code du moment, puis « Se déconnecter » aussitôt.
5. Se reconnecter en directeur en saisissant **le même code** que celui de l'étape 4.
6. Attendre le code suivant (30 secondes) : connexion réussie.

✅ Étape 2 : "Code invalide. Vérifiez l'heure de votre téléphone et réessayez." ; on reste sur l'écran du code. Étape 5 : le même message (un code ne sert qu'une fois, même dans sa fenêtre de 30 secondes). Étapes 3 et 6 : connexion réussie.

⚠️ *Test d'erreur* : un code de 5 chiffres laisse le bouton inactif. Ne pas saisir cinq faux codes de suite (verrou).

☐ OK ☐ KO

---

## Étape 371 — Sessions : révocation immédiate depuis un autre appareil
👤 **enseignant** (secondaire-test) · fenêtre **B** et troisième navigateur **C** · 📂 Menu **« Mon compte »** > **« Mes sessions »** (`/v2/account/sessions`)

1. Se connecter avec `enseignant@secondaire-test.test` dans B **et** dans C (navigateur différent).
2. Dans B, ouvrir « Mes sessions » : deux lignes, la courante porte « Cet appareil ».
3. Dans B, cliquer **« Révoquer »** sur l'autre session.
4. Dans C, recharger la page ou cliquer sur un lien.
5. Dans B, cliquer **"Déconnecter tous mes appareils"**.

✅ Étape 3 : "Session révoquée." ; B reste connecté. Étape 4 : C est renvoyé à `/login` immédiatement (message "Votre session a pris fin. Reconnectez-vous." ou « Votre session a expiré. Veuillez vous reconnecter. »). Étape 5 : B revient aussi à `/login`.

⚠️ *Test d'erreur* : après la déconnexion de B, le bouton « Précédent » du navigateur ne doit réafficher aucune donnée privée *(à vérifier)*.

☐ OK ☐ KO

---

## Étape 372 — Verrouillage après des échecs, et réponse neutre au mot de passe oublié
👤 **élève de l'École** (primaire-test) · fenêtre **B** · 📂 Page `/login`

Compte peu sensible : `eleve@primaire-test.test` (sans MFA). Aucune autre session de ce compte à préserver.

1. Saisir l'e-mail à la main et le mot de passe volontairement faux `Mauvais-mot-de-passe-test-guide`, cinq fois de suite.
2. Au 6e essai, cliquer le compte dans le panneau (**bon** mot de passe).
3. Attendre 1 minute, puis se reconnecter par le panneau.
4. Ouvrir `/v2/forgot-password`, saisir `eleve@primaire-test.test`, valider ; recommencer avec `inconnu@exemple.test`.

✅ Étape 1 : à chaque fois "Identifiants invalides. Vérifiez votre e-mail et votre mot de passe." (même message pour un e-mail inexistant : pas d'énumération). Étape 2 : "Trop de tentatives. Réessayez dans 1 minute." même avec le bon mot de passe. Étape 3 : connexion réussie. Étape 4 : **même** message dans les deux cas, "Si un compte existe pour cette adresse, un e-mail vient d'être envoyé. Pensez à vérifier vos courriers indésirables." (aucun e-mail n'est réellement envoyé).

⚠️ Ces échecs laissent des entrées `login.failed` dans le journal d'audit (non supprimables) : elles servent à l'étape suivante.

☐ OK ☐ KO

---

## Étape 373 — Journal d'audit : retrouver les actes des phases précédentes
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Journal d'audit »** (`/v2/audit`)

Attendre une minute après les étapes précédentes (les événements d'identité arrivent avec quelques secondes de délai).

1. Dans le formulaire **« Filtrer le journal »**, champ **« Action »**, saisir `login.failed`, cliquer **« Appliquer les filtres »**.
2. Remplacer par `session.revoked`, puis `role.*`, puis `assignment.*`, puis `finance.*`.
3. Filtrer ensuite sur les actes des phases précédentes qui ont été jouées : `grade.published`, `reportcard.*`, `payroll.*`, `assess.revision.*`.
4. Cliquer **« Réinitialiser »**, ouvrir le lien d'une entrée (par exemple une entrée `session.revoked`).

✅ Étape 1 : les cinq échecs de l'étape *Verrouillage* (acteur « Système », gravité « Notable », « Avertissement » pour le verrouillage). Étape 2 : la révocation de l'étape *Sessions* avec son acteur ; `finance.refund.requested` et `finance.refund.approved` portent des acteurs **distincts**. Étape 3 : une ligne par acte joué (publication de notes, émission de bulletins…). Étape 4 : page « Entrée du journal » avec « Informations générales » (« Numéro de séquence », « Empreinte », « Empreinte précédente », « Algorithme »). Une connexion réussie n'est **pas** tracée (normal).

⚠️ *Test d'erreur* : saisir « Du » postérieur à « Au » : « La fin de période doit suivre le début. » ; « Action » = `Role Changed` : « Format attendu : entité.verbe ou entité.* (minuscules). » ; filtre `role.zzz` : « Aucune entrée ne correspond à ces filtres. »

☐ OK ☐ KO

---

## Étape 374 — Journal d'audit : vérifier la chaîne, lecture réservée
👤 **propriétaire** (secondaire-test) · fenêtre **A** ; 👤 **directeur des études** · fenêtre **A** · 📂 `/v2/audit`

1. Propriétaire : dans le bloc **« Intégrité de la chaîne »**, portée « Toute la chaîne », cliquer **« Vérifier la chaîne »**.
2. Constater qu'aucune commande « Modifier » ni « Supprimer » n'existe sur la liste ni sur une entrée.
3. « Se déconnecter », connexion en directeur des études, taper `/v2/audit`, puis ouvrir la Console (F12) et exécuter `await fetch('/api/v1/audit/logs')`.

✅ Étape 1 : « Chaîne intègre » avec "N entrées vérifiées (séquences X à Y). Aucune anomalie." ; le bouton devient « Vérifier à nouveau ». Une « Chaîne altérée » (liste « Empreinte incohérente », « Chaînage rompu », « Trou dans la séquence ») est un défaut **Bloquant**. Étape 3 : « Accès refusé » et, en console, statut 403 avec "Action non autorisée.".

☐ OK ☐ KO

---

## Étape 375 — ⚠️ Irréversible : exporter le journal d'audit
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/audit`, bouton **« Exporter en CSV »**

Le navigateur télécharge un fichier `audit-AAAA-MM-JJ.csv` : à faire par une personne, ou avec l'accord de la personne qui supervise.

1. Sans date, cliquer **« Exporter en CSV »**.
2. Saisir « Du » = il y a 40 jours et « Au » = aujourd'hui, **« Exporter en CSV »**.
3. Saisir « Du » = hier et « Au » = maintenant, **« Exporter en CSV »** (code MFA demandé si la session n'est plus récente).
4. Rechercher ensuite l'action `audit_log.exported` dans le filtre.

✅ Étape 1 : « L'export exige une période : renseignez les deux dates. » Étape 2 : « La période d'export est limitée à 31 jours. » Étape 3 : "Export terminé : N lignes dans audit-….csv." Étape 4 : l'export est lui-même journalisé (nouvelle entrée, non supprimable). Les comptes sans la permission d'export (directeur des études, économe…) ne voient pas le bouton actif.

📚 *Pour aller plus loin* : chapitre 24, scénarios 24.1 à 24.17 (droits des 15 rôles), 24.19 à 24.24 (isolation, API, base), 24.25 à 24.34 (dix circuits « quatre yeux »), 24.36 à 24.47 (MFA, codes de secours, jetons à usage unique, mot de passe), 24.48 à 24.54 (audit, en-têtes, fichiers protégés).

☐ OK ☐ KO

**Ce que la phase laisse dans l'application :** aucun enregistrement métier. Effets de bord : des entrées de journal non supprimables (`login.failed`, `session.revoked`, `audit_log.exported`) ; le compte `eleve@primaire-test.test` a été verrouillé 1 minute ; des sessions ouvertes dans les trois établissements (à fermer par « Se déconnecter ») ; si le réglage « Séparation des tâches » de la paie a été coché, le remettre à son état d'origine.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](18-portails-paiement.md) · [Suivant →](20-console-plateforme.md)
