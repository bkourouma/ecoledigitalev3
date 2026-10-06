# Rapport de session 03 : Directeur des études / Collège Le Baobab
- Compte (rôle affiché, JAMAIS le mot de passe) : Directeur des études (compte `etudes@secondaire-test.test`, MFA)
- Établissement : Collège Le Baobab (démonstration), pack Secondaire
- Date et heure de début / durée : 6 oct. 2026, environ 12:20 / environ 1 h 30 (passe 1 seulement)
- Version de l'application : non affichée
- Navigateur : Chrome (Windows, piloté par Claude dans Chrome), mode développement Next.js

Remarques d'environnement :
- Les données de la session 02 n'ont pas été touchées.
- Les chiffres ont été lus dans les cellules des tableaux. Le constat C-02-01 (« 149 ») de la session 02 est un artefact de lecture du texte brut (vérifié par le développeur : l'API renvoie 14 inscriptions).
- Cause commune probable de plusieurs blocages (C-03-01) : `GET /api/v1/tenancy/institutions` répond 403 pour ce rôle.

## Parcours exécutés
| Parcours | Résultat | Constats liés | Remarque |
|---|---|---|---|
| P1. Années et périodes | ❌ | C-03-01, C-03-04 | Liste lue (année 2026-2027, T1 et T2 « Ouverte », T3 « Planifiée »). Création de l'année 2027-2028 impossible : « Action non autorisée. » dès l'ouverture du modal, aucun POST envoyé. Génération de périodes, suppression, chevauchement/trou : non testés. |
| P2. Programmes, niveaux, curriculum | ⚠️ | C-03-05, C-03-06 | Deux programmes. Curriculum 2026-2027 publié, 5 nœuds. Rapport de validation : « valide (3 avertissements) », niveaux sans nœud affichés par identifiant. |
| P3. Classes et inscriptions | ⚠️ | C-03-01, C-03-06, C-03-07 | Classe 6e A (14 / 40, Active) lue. Création de « 6e B » impossible (même blocage). Inscriptions : 14 lignes lues, filtres fonctionnels, fiche ouverte. |
| P4. Paramètres académiques | ⚠️ | C-03-01, C-03-07 | Lecture OK ; bandeau « Action non autorisée. » à l'ouverture. Aucune modification tentée. |
| P5. Emploi du temps | ⚠️ | C-03-02, C-03-08, C-03-09, C-03-10 | Brouillon créé, créneau Mathématiques lundi 08:00-09:00 sans salle. Conflit détecté et refusé ✅. Annulation puis rétablissement d'une séance ✅. « Constater » : fonction non trouvée. |
| P6. Générateur | ❌ | C-03-03, C-03-05 | « Lancer le calcul » ne part pas : « Aucune grille horaire ni heures d'ouverture ne sont renseignées ». |
| P7. Règles de calcul et Résultats de classe | ⚠️ | C-03-04, C-03-06, C-03-07, C-03-11 | 5 jeux nationaux en lecture seule. Variante d'établissement : fonction non trouvée. Simulation impossible (« Aucune version de référence à comparer »). Résultats T1 : « Clôturée », 9 élèves, 8 classés. |
| P8. Imports Excel / CSV | ✅ | C-03-07 | Seuls « Classes » et « Matières et curriculum » proposés ; les autres « Droits manquants ». Import réel non exécuté. |
| URL interdites et menu | ⚠️ | C-03-08, C-03-09 | 6 URL interdites redirigées vers `/unauthorized` sans donnée ✅. |
| Recherche PDF | ✅ | | Page chargée, état vide explicite. |
| Reprise P9 à P13 | ⏭️ | | Non exécutée (prérequis sessions 07, 09, 11 ; actions irréversibles). |

## Constats
### C-03-01 : Création d'année, de classe et de salle impossible : « Action non autorisée. » alors que le rôle porte les droits de gestion
- Sévérité : Majeur
- Écran / URL : `/v2/academic/years`, `/v2/academic/classrooms`, `/v2/academic/settings`, `/v2/schedule/rooms`
- Résultat obtenu : bandeau « Action non autorisée. » dès l'ouverture du modal, aucun POST envoyé ; mêmes symptômes en tête de « Paramètres académiques » ; sur « Salles et équipements », liste des campus vide et bouton « Ajouter une salle » désactivé sans explication. Les permissions du rôle (`/api/v1/rbac/me/permissions`) incluent `academic.year.manage`, `academic.classroom.manage`, `academic.period.manage`, `academic.settings.manage`.
- Console / réseau : `GET /api/v1/tenancy/institutions` répond 403 à chaque ouverture ; requêtes `_rsc` en 503 par intermittence (mode développement).
- Suggestion : ces formulaires n'ont pas besoin de la liste des établissements ; utiliser l'établissement courant de la session ou un point d'accès autorisé pour ce rôle.

### C-03-02 : Salles et équipements : aucune salle de la graine, aucun campus, bouton désactivé sans message
- Sévérité : Mineur
- Résultat obtenu : « Aucune salle. », « Aucun équipement. » ; la salle S1 demandée n'existe pas et ne peut pas être créée (C-03-01).
- Suggestion : afficher la raison du blocage ; prévoir une salle dans la graine.

### C-03-03 : Générateur d'emploi du temps : calcul impossible, aucune grille horaire ni heures d'ouverture
- Sévérité : Majeur (à confirmer : l'onglet Calendrier des paramètres n'a pas été examiné)
- Écran / URL : `/v2/schedule/generator/new`
- Résultat obtenu : bandeau « Aucune grille horaire ni heures d'ouverture ne sont renseignées : définissez-les dans les paramètres de l'emploi du temps avant de lancer un calcul. » ; le clic sur « Lancer le calcul » n'envoie aucune requête. Les « paramètres de l'emploi du temps » ne sont pas dans le menu Emploi du temps.
- Suggestion : grille horaire et jours ouvrés dans la graine, lien direct vers le bon écran, bouton inactif avec raison.

### C-03-04 : États de période contradictoires : T1 « Ouverte » dans Années et périodes, « Clôturée » dans Résultats ; clôture sans délibération
- Sévérité : Majeur
- Écran / URL : `/v2/academic/years` et `/v2/results`
- Résultat obtenu : T1 et T2 « Ouverte » dans Années et périodes ; T1 « Clôturée » (notes verrouillées, clôture le 6 oct. 2026 à 11:17, 9 résultats figés) dans Résultats avec « Délibérée le : — ».
- Suggestion : unifier la source de l'état de période ou documenter la différence (état calendaire et état de résultat) avec deux libellés ; vérifier qu'une clôture sans délibération est voulue pour la graine.

### C-03-05 : Le niveau est nommé « 6e A » et le générateur le traite comme une matière
- Sévérité : Mineur
- Résultat obtenu : le nœud « NIVEAU » du curriculum s'appelle « 6e A » (code 6E) ; le générateur ajoute une ligne parasite « 6e A — 6e A » (« 5 besoin(s) » au lieu de 4). Le rapport de validation signale 3 niveaux sans nœud.
- Suggestion : corriger le libellé dans la graine et filtrer les nœuds de type niveau dans « Ajouter toutes ses matières ».

### C-03-06 : Identifiants affichés à la place des noms sur de nouveaux écrans (renvoi C-02-05 et C-02-08)
- Sévérité : Mineur
- Écran / URL : rapport de validation du curriculum, `/v2/results/<id>/explain`, `/v2/rules/versions/<id>` (Simulation), `/v2/rules/bindings`
- Résultat obtenu : identifiants complets dans les avertissements ; « Matière · 01a110ee » dans la trace ; « 01a110 · 01a110 » pour la classe et la période en simulation ; « Établissement : établissement inconnu » dans les liaisons.

### C-03-07 : Codes techniques et libellés anglais ou sans accents sur de nouveaux écrans (renvoi C-02-05)
- Sévérité : Mineur
- Résultat obtenu : tuteur « FATHER » ; recalculs « DONE », « BLOCKED … results.state_closed » ; trace « PERIOD_VALIDATED » ; matrice : « Notes incompletes », « Periode validee » (sans accents) ; « Niveau : LOWER_SECONDARY » ; codes `MAKEUP_SESSION`, `NORMAL_SESSION` sous les libellés.

### C-03-08 : Menu : groupes supplémentaires par rapport au menu attendu
- Sévérité : Mineur (à confirmer avec le guide du rôle)
- Résultat obtenu : PILOTAGE, ACADÉMIQUE, PERSONNES, EMPLOI DU TEMPS, PRÉSENCES, BULLETINS, ÉVALUATIONS, RÉSULTATS, CONSEILS DE CLASSE, EXAMENS, VIE SCOLAIRE, AFFECTÉS DE L'ÉTAT, COMMUNICATION, RÈGLES DE CALCUL, NOTIFICATIONS, DOCUMENTS, IMPORTS. Ni Finance, ni Paie, ni Accès et rôles, ni Établissement, ni Audit (conforme). « Affectés de l'État » (avec « Créances sur l'État ») n'est pas dans la liste attendue.

### C-03-09 : Pages d'erreur : « Accès refusé » à l'ancienne mise en page et 404 en anglais
- Sévérité : Mineur
- Résultat obtenu : `/unauthorized` garde l'ancienne mise en page avec libellés anglais (« Explore », « User », « Settings », « Logout ») ; deux adresses ont d'abord affiché « Chargement… » plus de 6 s ; une adresse inexistante affiche « This page could not be found. ».
- Suggestion : page « Accès refusé » en mise en page v2 et en français ; 404 localisée.

### C-03-10 : Annulation d'une séance : deux boutons « Annuler » dans le même modal
- Sévérité : Mineur
- Résultat obtenu : un « Annuler » pour fermer et un « Annuler » pour confirmer l'annulation ; « Le motif est conservé et communiqué » sans préciser à qui.
- Suggestion : « Retour » et « Annuler la séance », portée de la communication précisée.

### C-03-11 : Créneau récurrent : le cours est affiché « Cours » et non « Mathématiques »
- Sévérité : Mineur
- Résultat obtenu : « Lundi 08:00 – 09:00 — Cours — 6e A — TRAORE Kouadio » : la matière ne figure pas dans la ligne.

### C-03-12 : Messages transitoires sur nouveaux écrans (renvoi C-02-03)
- Sévérité : Mineur
- Écran / URL : `/v2/rules`
- Résultat obtenu : « Établissement inconnu. Ouvrez l'adresse de votre établissement… » pendant plusieurs secondes, puis le catalogue apparaît.

## Données créées (fictives)
| Donnée | Où | Statut |
|---|---|---|
| Emploi du temps « Brouillon QA 6E-A » (brouillon, 01/09/2026 → 31/08/2027) | Patrons récurrents | Créé, non publié |
| Créneau Mathématiques, lundi 08:00-09:00, 6e A, TRAORE Kouadio (P0001), sans salle | « Brouillon QA 6E-A » | Créé (enseignant choisi par hypothèse) |
| Annulation puis rétablissement de la séance Français du 19 oct. 2026 | Séances | Séance de nouveau « Prévue », deux entrées d'historique ajoutées |
| Année 2027-2028, classe 6e B, salle S1, variante « Variante test QA », proposition de générateur | | Non créées (blocages) |

## Points non testés et pourquoi
- P1 : création d'année, génération de périodes, suppression, chevauchement/trou : bloqués par C-03-01.
- P3 : création de 6e B : bloquée par C-03-01. P4 : modification d'un réglage : non tentée ; onglet Calendrier non examiné en détail.
- P5 : salle S1 ; génération des séances (publication non exécutée) ; « constater » (fonction non trouvée) ; déplacement ; export du calendrier (téléchargement).
- P6 : aperçu, séances non placées, application en brouillon : bloqués par C-03-03.
- P7 : variante d'établissement (fonction non trouvée), simulation (pas de version de référence), filigrane de démonstration non vérifié.
- P8 : import réel d'un fichier non exécuté.
- Reprise P9 à P13 : prérequis non joués et actions irréversibles.
- Isolation entre établissements ; recherche PDF (état vide seulement).
- Décisions demandées au développeur : publier le brouillon pour tester la génération des séances ? autoriser le téléchargement de l'export du calendrier ? lancer la reprise P9 à P13 ?

## Traitement par le développeur (2026-10-06)
| Constat | Verdict | Action |
|---|---|---|
| C-03-01 | **Défaut réel corrigé.** Les formulaires de création (année, classe, salle) lisent la liste des établissements (`GET /tenancy/institutions`, permission `tenancy.institution.read`), que le rôle Directeur des études ne portait pas alors qu'il a les droits `academic.*.manage`. | `rbac/templates/system-roles.ts` : `tenancy.institution.read` ajoutée à `directeur_etudes` (lecture seule) ; oracle de test mis à jour (rbac : 309 tests verts) ; l'API a réaligné les rôles des 4 établissements au redémarrage. À re-tester : création d'année, classe, salle. |
| C-03-03 | **Défaut réel corrigé.** Sans grille enregistrée pour l'établissement, aucun écran ne permettait d'en saisir une (l'avertissement renvoyait à des « paramètres » inexistants) et l'erreur de l'API n'était pas affichée. | `GeneratorLaunchScreen.tsx` : début de journée, fin de journée et durée de période saisissables dans le formulaire (08:00, 17:00, 60 min par défaut), transmis en `grid` ; message mis à jour ; test web adapté (39 verts). À re-tester : lancer un calcul. |
| C-03-04 | **Par construction, mais mal libellé.** L'état du calendrier (module académique) et l'état de clôture des résultats sont deux états distincts ; la graine clôture les résultats de T1 sans clore la période du calendrier. | À faire : libellés distincts (« Période ouverte » / « Résultats clôturés ») et, pour la graine, clore aussi T1 côté calendrier. Reclassé Mineur. |
| C-03-05 | Confirmé (libellé du niveau « 6e A » dans la graine et besoin parasite du générateur). | À corriger. |
| C-03-02, C-03-06 à C-03-12 | Confirmés (Mineur). | À planifier. |
