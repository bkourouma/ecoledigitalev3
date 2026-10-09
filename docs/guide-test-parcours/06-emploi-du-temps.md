[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](05-finance.md) · [Suivant →](07-appel-presences.md)

# Phase 6 — Emploi du temps

Objectif : lire l'emploi du temps de la 6e A, créer les salles et les séances "test guide" dont la phase suivante a besoin (les séances d'appel du jour), tester conflits, déplacements, annulation, remplacement, génération, export, puis le générateur. La publication finale (irréversible) est la dernière étape.

Précondition : Collège Le Baobab (`secondaire-test`) ; **J = jeudi 8 octobre 2026**, **H** = mercredi 7 octobre, **W1** = mercredi 14 octobre, **V1** = vendredi 16 octobre 2026. Dates à saisir au format du navigateur (ici `08/10/2026`). Les séances de démonstration générées par la graine (un cours de 08:00 à 10:00 du lundi au jeudi, intervenant TRAORE Kouadio, sans salle) couvrent jusqu'à environ 14 jours après la création de la base.

## Étape 90 — Lire la semaine de la 6e A
👤 **directeur des études** (secondaire-test, `etudes@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Emploi du temps »** (`/v2/schedule`)

Attendu au départ : titre « Emploi du temps », pas de sujet choisi : « Choisissez ce que vous voulez consulter ».

1. Dans **« Afficher »**, choisir **« Classe »**, puis la classe `6e A`.
2. Lire « Semaine du … au … » : utiliser **« Semaine précédente »**, **« Semaine suivante »**, **« Aujourd'hui »**, puis passer **« Vue »** à **« Jour »**.
3. Changer **« Afficher »** pour **« Enseignant »** (`TRAORE Kouadio`), puis **« Salle »** (liste vide : aucune salle n'existe encore), puis **« Élève »** (`DIABATE Nadia`).

✅ Pour la semaine courante : quatre cours de 08:00 à 10:00, un par jour du lundi au jeudi (Français, Mathématiques, Anglais, Histoire-Géographie), intervenant TRAORE Kouadio. Une semaine sans séance : « Aucune séance cette semaine. »

⚠️ *Test d'erreur* : choisir « Salle » ou « Élève » sans sujet → rien ne s'affiche tant que le sujet n'est pas choisi.

☐ OK ☐ KO

---

## Étape 91 — Créer les trois salles "test guide"
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Salles et équipements »** (`/v2/schedule/rooms`)

1. Choisir le **« Campus »** (le premier est présélectionné ; s'il n'y en a aucun, le noter : écart).
2. Cliquer **« Ajouter une salle »**, saisir, puis **« Ajouter »** (trois fois) :

| Champ | Salle 1 | Laboratoire | Petite salle |
| :--- | :--- | :--- | :--- |
| Code | `TG-S1` | `TG-LAB` | `TG-MINI` |
| Nom | `Salle 1 test guide` | `Laboratoire test guide` | `Petite salle test guide` |
| Type de salle | Salle de classe | Laboratoire | Autre |
| Capacité | `40` | `30` | `5` |
| Bâtiment | `Bloc A test guide` | `Bloc B test guide` | `Bloc A test guide` |
| Équipements fixes | `tableau, vidéoprojecteur` | `paillasses, évier` | (vide) |

✅ "Salle enregistrée." ; les trois salles apparaissent sous « Salles du campus » (colonnes « Nom », « Code », « Type », « Capacité », « Bâtiment », « État » = « Disponible ») et persistent après rechargement.

⚠️ *Test d'erreur* : Code `TG S1` (espace) → "Code invalide (lettres, chiffres, . _ -)." ; Capacité `0` → "La valeur doit être supérieure ou égale à 1." ; Code vide → "Ce champ est obligatoire."

🔒 *Test de droit* : avec `educateur@secondaire-test.test` (fenêtre **B**), le bouton « Ajouter une salle » est absent.

☐ OK ☐ KO

---

## Étape 92 — Mettre une salle hors service et ajouter un équipement
👤 **directeur des études** · fenêtre **A** · 📂 **« Salles et équipements »** (`/v2/schedule/rooms`)

1. Sur la ligne `Petite salle test guide`, cliquer **« Mettre hors service »**, saisir « Motif (facultatif) » = `Travaux test guide`, cliquer **« Confirmer »**.
2. Ouvrir la page **« Séances »** > **« Nouvelle séance »** (sans enregistrer) : la liste « Salle » ne propose plus `Petite salle test guide`. Fermer.
3. Revenir, cliquer **« Remettre en service »** puis **« Confirmer »**.
4. Sous « Équipements » (si l'offre l'inclut), **« Ajouter un équipement »** :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-VP` |
| Libellé | `Vidéoprojecteur test guide` |
| Quantité en stock | `1` |

   Cliquer **« Ajouter »**.

✅ "État de la salle modifié." (deux fois) ; la salle repasse « Disponible » ; "Équipement enregistré." Sinon : "La réservation d'équipements n'est pas incluse dans votre offre." *(à vérifier)*.

⚠️ *Test d'erreur* : Quantité en stock `0` → "La valeur doit être supérieure ou égale à 1."

☐ OK ☐ KO

---

## Étape 93 — Lire le publié et créer deux brouillons
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Patrons récurrents »** (`/v2/schedule/timetables`)

1. Lire la liste (colonnes « Nom », « Validité », « Semaine A (lundi) », « Publié le », « État »). Ouvrir `Emploi du temps 6E-A` : badge « Publié », un créneau par jour (Lundi à Jeudi) "08:00 – 10:00", message "Seul un brouillon est modifiable.", boutons **« Archiver »** et **« Générer les séances »**, aucun bouton « Ajouter un créneau ». Cliquer **« Retour »**.
2. Cliquer **« Nouvel emploi du temps »** :

| Champ | Valeur |
| :--- | :--- |
| Année scolaire | année en cours (`2026-2027`, présélectionnée) |
| Nom | `Emploi du temps test guide 6e A` |
| Valable du / Valable jusqu'au | valeurs par défaut (début et fin d'année) |
| Premier lundi de la semaine A | `07/09/2026` |

3. Cliquer **« Créer »**. Recommencer avec le nom `Emploi du temps test guide B` et **sans** date de semaine A.

✅ "Emploi du temps créé en brouillon." (deux fois) ; deux lignes à l'état « Brouillon ». La fiche d'un brouillon vide affiche "Ajoutez des créneaux : classe, jour, heures, salle et intervenants."

⚠️ *Test d'erreur* : Nom vide → "Ce champ est obligatoire." ; « Valable jusqu'au » antérieur → "La fin de validité précède son début." ; Premier lundi = `08/09/2026` (un mardi) → "L'ancre de l'alternance A/B est un lundi."

🔒 *Test de droit* : `secretariat@secondaire-test.test` (MFA, fenêtre **B**) : le bouton « Nouvel emploi du temps » est absent.

☐ OK ☐ KO

---

## Étape 94 — Ajouter les créneaux du vendredi
👤 **directeur des études** · fenêtre **A** · 📂 fiche `Emploi du temps test guide 6e A` (`/v2/schedule/timetables`)

1. Cliquer **« Ajouter un créneau »**, saisir, puis **« Enregistrer »** (trois fois) :

| Champ | P1 | P2 | P3 |
| :--- | :--- | :--- | :--- |
| Type | Cours | Cours | Cours |
| Intitulé | `Mathématiques vendredi test guide` | `Anglais vendredi test guide` | `Histoire-Géographie semaine A test guide` |
| Classe | `6e A` | `6e A` | `6e A` |
| Cours (programme) | Mathématiques | Anglais | Histoire-Géographie |
| Jour | Vendredi | Vendredi | Vendredi |
| Début / Fin | `08:00` / `10:00` | `10:00` / `11:00` | `11:00` / `12:00` |
| Salle | `Salle 1 test guide (TG-S1)` | `Laboratoire test guide (TG-LAB)` | Aucune salle |
| Alternance | Chaque semaine | Chaque semaine | Semaine A seulement |
| Intervenant 1 / Rôle | `TRAORE Kouadio` / Responsable | `YAO Fatou` / Responsable | `KOUAME Adjoua` / Responsable |

2. Sur P3, cliquer **« Modifier »** : le champ « Séances déjà générées » apparaît ; changer l'Intitulé en `Histoire-Géographie semaine A test guide (modifié)` et enregistrer.

✅ "Créneau ajouté." (trois fois), "Créneau modifié." ; les trois créneaux sont sous « Vendredi » ; P3 porte le badge « Semaine A » ; P1 (fin 10:00) et P2 (début 10:00) ne sont **pas** en conflit ; « Conflits du brouillon » : "Aucun conflit dans ce brouillon."

⚠️ *Test d'erreur* : Type « Cours » sans classe → "Une classe est obligatoire pour un cours." ; « Fin » = « Début » → "L'heure de fin doit être postérieure à l'heure de début (pas de patron à cheval sur minuit)."

⚠️ *Écart connu* : une « Alternance » « Semaine A seulement » dans le brouillon `Emploi du temps test guide B` (sans date de semaine A) peut échouer sans aucun message ; ne pas le faire ici.

☐ OK ☐ KO

---

## Étape 95 — Provoquer un conflit entre créneaux, publication refusée
👤 **directeur des études** · fenêtre **A** · 📂 fiche `Emploi du temps test guide 6e A`

1. **« Ajouter un créneau »** : Type « Réunion », Intitulé `Réunion test guide`, Jour Vendredi, `09:00` à `10:00`, sans classe, Intervenant 1 = `TRAORE Kouadio`. Cliquer **« Enregistrer »**.
2. Constater le refus (message de l'API, texte exact à relever, du type "… est placé(e) sur deux créneaux qui se chevauchent le vendredi de 09:00 à 10:00.") et la liste « Conflits de planification » (nature « Intervenant »).
3. Saisir « Motif du dépassement » = `Réunion exceptionnelle test guide`, puis **« Enregistrer »** : le créneau est créé malgré le conflit.
4. Cliquer **« Actualiser »** dans « Conflits du brouillon » : le conflit P1 / réunion est listé.
5. Cliquer **« Publier »**.
6. Supprimer la réunion (icône poubelle « Supprimer le créneau de 09:00 »), **« Actualiser »**, puis cliquer **« Publier »** de nouveau.

✅ Étape 5 : "1 conflit(s) entre patrons : corrigez-les avant de publier." ; étape 6 : "Créneau supprimé." puis "Aucun conflit dans ce brouillon." puis refus "Un emploi du temps est déjà publié pour cet établissement, cette année et cette période." Le brouillon reste « Brouillon ».

⚠️ *Test d'erreur* : motif de dépassement `abc` → "Le motif du dépassement doit faire au moins 5 caractères." ; publier `Emploi du temps test guide B` (vide) → "Un emploi du temps vide ne peut pas être publié."

🔒 *Test de droit* : éducateur et secrétariat n'ont pas le bouton « Publier ».

☐ OK ☐ KO

---

## Étape 96 — Créer les séances "test guide"
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Séances »** (`/v2/schedule/occurrences`)

1. Cliquer **« Nouvelle séance »** et créer, avec **« Créer la séance »** à chaque fois, les sept séances :

| Intitulé | Type | Classe / Cours | Date | Début–Fin | Salle | Intervenant (Responsable) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Séance d'appel test guide` | Cours | 6e A / Mathématiques | `08/10/2026` | `11:00`–`12:00` | `Salle 1 test guide` | `TRAORE Kouadio` |
| `Séance d'appel 2 test guide` | Cours | 6e A / Anglais | `08/10/2026` | `12:30`–`13:30` | Aucune salle | `TRAORE Kouadio` |
| `Séance d'appel 3 test guide` | Cours | 6e A / Français | `08/10/2026` | `14:00`–`15:00` | Aucune salle | `TRAORE Kouadio` |
| `Séance d'appel 4 test guide` | Cours | 6e A / Histoire-Géographie | `08/10/2026` | `15:30`–`16:30` | Aucune salle | `TRAORE Kouadio` |
| `Séance de remplacement test guide` | Cours | 6e A / Mathématiques | `16/10/2026` | `14:00`–`15:00` | `Laboratoire test guide` | `TRAORE Kouadio` |
| `Réunion de parents test guide` | Réunion | (aucune) | `14/10/2026` | `15:00`–`16:30` | `Salle 1 test guide` | `KOUAME Adjoua` |
| `Réunion passée test guide` | Réunion | (aucune) | `07/10/2026` | `16:00`–`17:00` | Aucune salle | `KOUAME Adjoua` |

2. Dans le formulaire, l'aperçu passe de "Renseignez la date et les heures pour vérifier les conflits." à "Aucun conflit détecté sur ce créneau."
3. Élargir « Du » et « Au » de la liste pour voir `16/10/2026` et `07/10/2026`.

✅ "Séance créée." sept fois ; sept lignes à l'état « Prévue » (colonnes « Date », « Horaire », « Intitulé », « Classe », « Salle », « Intervenants », « État »).

⚠️ *Test d'erreur* : Type « Cours » sans classe → "Une classe est obligatoire pour un cours." ; Fin antérieure au début → "L'heure de fin doit être postérieure à l'heure de début (une séance ne passe pas minuit : créez-en deux)."

☐ OK ☐ KO

---

## Étape 97 — Conflits de séances et dépassement motivé
👤 **directeur des études** · fenêtre **A** · 📂 **« Séances »** > **« Nouvelle séance »**

1. Essai A (intervenant et classe) : Cours, 6e A / Anglais, `08/10/2026`, `11:30`–`12:30`, Intervenant `TRAORE Kouadio` : ne pas enregistrer (ou enregistrer pour constater le refus).
2. Essai B (adjacence) : Réunion, `08/10/2026`, `12:00`–`12:30`, `Salle 1 test guide`, `KOUAME Adjoua`.
3. Essai C (dépassement) :

| Champ | Valeur |
| :--- | :--- |
| Type | Réservation de salle |
| Intitulé | `Réservation test guide` |
| Date / Début–Fin | `08/10/2026` / `11:30`–`12:00` |
| Salle | `Salle 1 test guide` |
| Dépasser les conflits bloquants | coché |
| Motif du dépassement | `Réunion urgente validée` |

   Cliquer **« Créer la séance »**.

✅ Essai A : "2 conflits bloquants" (« Intervenant » et « Classe ») ; essai B : "Aucun conflit détecté sur ce créneau." (12:00 est la fin de l'autre séance) ; essai C : l'aperçu annonce un conflit « Salle », puis "Séance créée." avec le badge « Dérogation » et la zone « Avertissements de planification ».

⚠️ *Test d'erreur* : Réservation de salle sans salle → "Une réservation de salle précise la salle." ; motif `abc` → "Le motif du dépassement doit faire au moins 5 caractères."

☐ OK ☐ KO

---

## Étape 98 — Déplacer une séance et changer sa salle
👤 **directeur des études** · fenêtre **A** · 📂 **« Séances »**

1. Sur `Réunion de parents test guide`, cliquer **« Déplacer »**. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nouvelle date | `15/10/2026` (jeudi) |
| Début / Fin | `15:00` / `16:30` |
| Motif | `Jeudi plus pratique test guide` |

   Cliquer **« Déplacer »**.
2. Sur la même ligne, cliquer **« Salle »**, choisir `Laboratoire test guide`, Motif `Plus de places test guide`, **« Changer la salle »**.

✅ "Séance déplacée." puis "Salle modifiée." ; la liste affiche le jeudi 15 octobre 2026 et `Laboratoire test guide`.

⚠️ *Test d'erreur* : déplacer `Séance d'appel test guide` vers `08/10/2026` `12:30`–`13:30` (créneau de la séance 2) → conflit bloquant « Intervenant » et « Classe ». Annuler sans enregistrer.

🔒 *Test de droit* : avec l'éducateur, les boutons « Déplacer » et « Salle » sont absents.

☐ OK ☐ KO

---

## Étape 99 — Annuler puis rétablir une séance
👤 **directeur des études** · fenêtre **A** · 📂 **« Séances »**

1. Sur `Réservation test guide`, cliquer **« Annuler »**, saisir « Motif » = `Réservation inutile test guide`, confirmer.
2. Filtrer « État » sur « Annulée » : la séance y figure. Cliquer **« Rétablir »** puis confirmer ("Séance rétablie."), puis l'annuler de nouveau avec le même motif.

✅ "Séance annulée." ; état « Annulée » ; dans `/v2/schedule`, en cochant **« Afficher les séances annulées »**, la séance apparaît avec "Motif : …".

⚠️ *Test d'erreur* : motif `ab` → "Le motif doit comporter au moins 3 caractères."

⚠️ *Écart connu* : la fenêtre porte deux boutons « Annuler » (fermer et confirmer). **Ne pas annuler** `Séance d'appel 4 test guide` ici : la phase suivante en a besoin.

☐ OK ☐ KO

---

## Étape 100 — Remplacer un intervenant
👤 **directeur des études** · fenêtre **A** · 📂 **« Séances »**

1. Sur `Réunion de parents test guide`, cliquer **« Remplacer »**.
2. Cliquer **« Proposer des remplaçants »** (chaque ligne indique « Disponible » ou « Non recommandé », « Compétent » et la charge de la semaine) puis **« Choisir »** sur `YAO Fatou`.
3. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Intervenant remplacé | `KOUAME Adjoua` |
| Remplaçant | `YAO Fatou` |
| Motif du remplacement | `Absence de Mme KOUAME test guide` |

4. Cliquer **« Remplacer »**.

✅ "Remplacement enregistré." ; la séance porte `YAO Fatou` avec le rôle « Remplaçant ».

⚠️ *Test d'erreur* : Remplaçant = intervenant remplacé → "Le remplaçant doit être une autre personne." ; motif `ab` → "Le motif doit faire au moins 3 caractères."

📌 La séance `Séance de remplacement test guide` sera remplacée dans la phase *Appel et présences* (après approbation d'un congé de TRAORE Kouadio).

☐ OK ☐ KO

---

## Étape 101 — Constater une séance passée
👤 **éducateur** (secondaire-test, `educateur@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 **« Séances »** (`/v2/schedule/occurrences`)

1. Régler **« Du »** sur `07/10/2026`. Repérer `Réunion passée test guide` (« Prévue ») : seul le bouton **« Constater »** est proposé.
2. Cliquer **« Constater »**.

✅ Conforme à la conception : "Séance constatée." et état « Constatée ».

⚠️ *Écart connu* : l'écran envoie la demande sans motif alors que l'API en exige un ; le résultat probable est "Un motif est requis." et la séance reste « Prévue » *(à vérifier, écart Majeur)*. Noter le résultat obtenu.

⚠️ *Test d'erreur* : « Constater » sur `Réunion de parents test guide` (future) → "Une séance qui n'a pas encore commencé ne peut pas être constatée."

☐ OK ☐ KO

---

## Étape 102 — Générer les séances d'un emploi du temps publié
👤 **directeur des études** · fenêtre **A** · 📂 fiche `Emploi du temps 6E-A` (`/v2/schedule/timetables`)

1. Cliquer **« Générer les séances »**. Choisir « Du » = lundi 5 octobre 2026, « Au » = dimanche 11 octobre 2026 (case « Plafonner au volume horaire des cours » décochée), cliquer **« Générer »**.
2. Lire le rapport (« Créées », « Déjà existantes », « Jours bloqués », « En conflit », « Plafonnées »).
3. Relancer la **même période**.
4. Étendre « Au » de 14 jours et relancer.

✅ Étape 3 : « Créées » = 0, « Déjà existantes » = total précédent (aucun doublon) ; étape 4 : « Créées » > 0 pour les semaines au-delà de la graine ; « En conflit » = 0 (les séances "test guide" commencent à 11:00 ou plus tard).

⚠️ *Test d'erreur* : « Au » antérieur à « Du » → "La fin de la fenêtre précède son début."

☐ OK ☐ KO

---

## Étape 103 — L'enseignant voit « Aujourd'hui » et son emploi du temps
👤 **enseignant** (secondaire-test, `enseignant@secondaire-test.test`, TRAORE Kouadio, sans MFA) · fenêtre **B** · 📂 Menu **« Aujourd'hui »** (`/v2/teacher`) puis **« Mon emploi du temps »** (`/v2/teacher/schedule`)

1. Ouvrir **« Aujourd'hui »** (ou `/v2/schedule/today`).
2. Ouvrir **« Mon emploi du temps »** : seul le mode « Mon emploi du temps » est proposé dans « Afficher ». Cocher **« Afficher les séances annulées »**.

✅ Étape 1 : titre « Aujourd'hui », les quatre `Séance d'appel … test guide` (et le cours de démonstration de 08:00 à 10:00 du jeudi) avec « Appel à faire » et le bouton « Faire l'appel ». Étape 2 : uniquement les séances de TRAORE Kouadio. Un jour sans cours : « Aucune séance aujourd'hui. »

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/schedule/rooms` → page « Accès refusé » ; taper `/v2/schedule/occurrences` → « Accès refusé ». En tant que directeur des études, taper `/v2/schedule/today` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 104 — Exporter le calendrier (.ics) et créer un lien d'abonnement
👤 **enseignant** · fenêtre **B** · 📂 **« Mon emploi du temps »** > **« Exporter le calendrier »** (`/v2/teacher/schedule/export`)

1. Choisir le **« Sujet de l'export »** : « Mon emploi du temps ».
2. Cliquer **« Télécharger le fichier .ics »** *(demander l'accord de l'utilisateur avant tout téléchargement)* : fichier `emploi-du-temps.ics`.
3. Sous « S'abonner (mise à jour automatique) », saisir « Nom du lien » = `Téléphone test guide`, « Validité (jours) » = `7`, cliquer **« Créer un lien d'abonnement »**, puis **« Copier le lien »**.
4. Dans « Liens d'abonnement », cliquer **« Révoquer »** puis confirmer.

✅ Étape 3 : "Lien créé : copiez-le maintenant." puis "Lien copié." et l'avertissement "Ce lien ne sera plus affiché…" (**ne pas partager le lien**) ; étape 4 : "Lien révoqué." et état « Révoqué ».

⚠️ *Test d'erreur* : sans sujet choisi → "Choisissez le sujet à exporter."

☐ OK ☐ KO

---

## Étape 105 — Les familles et l'élève lisent l'emploi du temps
👤 **parent** (secondaire-test, `parent@secondaire-test.test`, DIABATE Séka, sans MFA) · fenêtre **B** · 📂 `/v2/schedule`

1. Dans « Afficher », choisir **« Mes enfants »**, puis **« Choisir un enfant »** = `DIABATE Nadia`, ensuite `DIABATE Salimata`.
2. Ouvrir **« Export calendrier »** (`/v2/schedule/export`), sujet « Mes enfants » > `DIABATE Nadia` : le fichier `.ics` est proposé (même geste qu'à l'étape précédente, sans le refaire).

✅ La semaine de la 6e A en lecture seule, aucun bouton de modification.

🔒 *Test de droit* : en tant que parent, taper `/v2/schedule/timetables`, `/v2/schedule/rooms`, `/v2/schedule/occurrences`, `/v2/schedule/generator` → page « Accès refusé » pour chacune. Taper `/v2/parent/children/00000000-0000-4000-8000-000000000000/schedule` → introuvable, sans donnée.

☐ OK ☐ KO

---

## Étape 106 — Lancer le générateur d'emploi du temps
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Générateur »** (`/v2/schedule/generator`) > **« Nouvelle génération »** (`/v2/schedule/generator/new`)

Attendu au départ : "Aucune génération pour le moment." (la fonction `scheduling.generation` doit être incluse dans l'offre *(à vérifier)*).

1. Section « Cadre » :

| Champ | Valeur |
| :--- | :--- |
| Nom de la proposition | `Génération test guide 6e A` |
| Début de la journée / Fin de la journée | `08:00` / `12:00` |
| Durée d'une période (minutes) | `60` |

2. Section « Besoins à placer » : classe `6e A`, cliquer **« Ajouter toutes ses matières »**, puis régler :

| Matière | Séances par semaine | Périodes par séance | Enseignant |
| :--- | :-: | :-: | :--- |
| Français | `2` | `1` | `TRAORE Kouadio` |
| Mathématiques | `2` | `1` | `TRAORE Kouadio` |
| Anglais | `1` | `2` | `YAO Fatou` |
| Histoire-Géographie | `1` | `1` | `KOUAME Adjoua` |

3. Section « Paramètres » : « Jours à planifier » Lun à Ven, « Graine » `graine-test-guide`, « Limite de temps (secondes) » `20`, « Itérations d'amélioration » `5000`.
4. Cliquer **« Lancer le calcul »**.

⚠️ *Écart connu* : une cinquième ligne portant le nom de la classe (`6e A`) peut apparaître dans les besoins : la retirer par **« Retirer »**.

✅ Total annoncé : "4 besoin(s), 6 séance(s) par semaine à placer." Redirection vers `/v2/schedule/generator/<id>` ; état « Proposition prête » ; « Séances demandées » 6, « Séances placées » 6, « Non placées » 0 ; onglet « Aperçu » : « Aperçu de la semaine type » (« Par classe », « Par enseignant », « Par salle ») ; "Aucun conflit enseignant, classe ou salle…".

⚠️ *Test d'erreur* : « Nom de la proposition » vide → "Le nom est requis." (ou "Ce champ est obligatoire.") ; « Durée d'une période (minutes) » `10` → "La valeur doit être supérieure ou égale à 20."

🔒 *Test de droit* : avec l'éducateur, taper `/v2/schedule/generator/new` → page « Accès refusé ».

☐ OK ☐ KO

---

## Étape 107 — Les limites du générateur
👤 **directeur des études** · fenêtre **A** · 📂 `/v2/schedule/generator/new`

1. Lancer une seconde génération : nom `Génération surchargée test guide`, même grille (`08:00`–`12:00`, `60`), Lun à Ven, un seul besoin : Mathématiques, `25` séances par semaine, `1` période, `TRAORE Kouadio`.
2. Ouvrir l'onglet **"Conflits et points d'attention (N)"** de la fiche obtenue.
3. Relancer la génération de l'étape précédente avec exactement les mêmes champs et la graine `graine-test-guide`. Puis, sur la fiche de la première proposition, cliquer **« Relancer avec une autre graine »**.

✅ Étape 2 : au moins 5 séances sous "Séances non placées (N)", cause "La classe demande plus d'heures que la semaine n'en offre" (par exemple "5 sur 25") ; la liste affiche au plus "20 sur 25". Étape 3 : mêmes « Séances placées » et même « Coût des préférences » pour la même graine ; une proposition `Génération test guide 6e A (bis)` avec une autre graine. Dans « Aperçu » : l'Anglais occupe deux périodes consécutives, aucun enseignant ni aucune salle sur deux séances au même créneau. Le message "Un emploi du temps publié existe déjà pour cette année ("Emploi du temps 6E-A"). Il ne sera pas modifié…" apparaît : un publié n'est jamais écrasé.

⚠️ *Limite assumée* : le générateur ne produit qu'une **semaine type** (jamais d'alternance A/B, un seul intervenant par créneau) et ignore les séances ponctuelles déjà réservées (par exemple `Réunion de parents test guide` en salle) ; ce n'est pas un défaut.

☐ OK ☐ KO

---

## Étape 108 — Appliquer et abandonner des propositions
👤 **directeur des études** · fenêtre **A** · 📂 `/v2/schedule/generator/<id>`

1. Sur `Génération test guide 6e A`, cliquer **« Examiner et appliquer »**, destination « Créer un nouveau brouillon », « Nom du brouillon » = `Emploi du temps généré test guide`, dates par défaut, cliquer **« Appliquer »**.
2. Sur le brouillon obtenu, cliquer **« Publier »**.
3. Sur `Génération surchargée test guide`, **« Examiner et appliquer »** : cliquer **« Appliquer »** sans cocher "J'accepte d'appliquer une proposition incomplète…". Puis choisir « Remplacer le contenu d'un brouillon existant », « Brouillon à remplacer » = `Emploi du temps test guide B`, cocher les deux confirmations, **« Appliquer »**.
4. Sur `Génération test guide 6e A (bis)`, cliquer **« Abandonner »**, confirmer.

✅ Étape 1 : redirection vers le nouveau brouillon avec 6 créneaux (Lundi à Vendredi) ; la proposition passe à « Appliquée » avec un lien « Ouvrir l'emploi du temps créé ». Étape 2 : refus "Un emploi du temps est déjà publié pour cet établissement, cette année et cette période." Étape 3 : `Emploi du temps test guide B` contient désormais les créneaux de la proposition surchargée. Étape 4 : "Proposition abandonnée." et état « Abandonnée ».

⚠️ *Test d'erreur* : étape 3 sans la case → "Confirmez que vous acceptez 5 séance(s) non placée(s) pour continuer." ; remplacement sans brouillon choisi → "Choisissez le brouillon à remplacer."

☐ OK ☐ KO

📚 *Pour aller plus loin* : chapitre 07, scénarios 7.1 à 7.21 (vues salle et élève, aide au placement, salle hors service sur des séances, remplacement depuis la page « Remplacements », droits par rôle, qualité transversale).

**Ce que la phase laisse dans l'application :**
- Salles `TG-S1` (Salle 1 test guide, 40), `TG-LAB` (Laboratoire test guide, 30), `TG-MINI` (Petite salle test guide, 5) ; équipement `TG-VP` (Vidéoprojecteur test guide).
- Séances du 8 octobre 2026 (6e A, intervenant TRAORE Kouadio) : `Séance d'appel test guide` (11:00, Salle 1), `Séance d'appel 2 test guide` (12:30), `Séance d'appel 3 test guide` (14:00), `Séance d'appel 4 test guide` (15:30) ; `Séance de remplacement test guide` (16/10/2026, 14:00, Laboratoire) ; `Réunion de parents test guide` (déplacée au 15/10, Laboratoire, YAO Fatou remplaçante) ; `Réunion passée test guide` (07/10, constatée si possible) ; `Réservation test guide` (annulée).
- Brouillons `Emploi du temps test guide B` (contenu généré), `Emploi du temps généré test guide` ; (la publication de `Emploi du temps test guide 6e A` et l'archivage de `Emploi du temps 6E-A` sont reportés à la **dernière phase** du guide).
- Propositions du générateur : `Génération test guide 6e A` (appliquée), `Génération surchargée test guide` (appliquée), `Génération test guide 6e A (bis)` (abandonnée).

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](05-finance.md) · [Suivant →](07-appel-presences.md)
