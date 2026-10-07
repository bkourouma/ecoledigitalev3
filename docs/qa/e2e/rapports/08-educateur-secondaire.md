# Rapport de session 08 : Éducateur (vie scolaire) / Collège Le Baobab (secondaire-test)

- Compte : educateur@secondaire-test.test (sans MFA) ; compte Parent de secondaire-test utilisé uniquement pour la vue famille
- Établissement : Collège Le Baobab (démonstration)
- Date : 7 oct. 2026, début vers 14 h 50 (appels de l'application entre 15 h 03 et 15 h 44)
- Navigateur : Chrome (Claude in Chrome), ~894 px de large, mode développement
- Aucun mot de passe dans ce rapport ; données fictives uniquement ; rien n'a été supprimé.

## Synthèse
La séparation des tâches fonctionne côté droits : l'éducateur propose une mesure, n'a aucun bouton Valider/Lever/Exclure, `/v2/schoollife/validations` est refusé, la réouverture d'un appel validé est refusée par l'API (403). Points faibles : tableau de bord d'assiduité inutilisable (403 sur `/academic/years`, C-08-01), aucune mention « Simulée » sur les convocations (C-08-03), incident absent de l'historique (C-08-06), validation d'appel sans confirmation (C-08-07).

## Parcours exécutés
| Parcours | Résultat | Constats | Remarque |
|---|---|---|---|
| P1 Appel, absences, appels non faits, alertes | ⚠️ | C-08-01, 02, 07, 10, 12 | Appel du 7 oct. validé après accord ; « Appels non faits » : 4 attendus / 1 fait / 3 non faits = 25 %, recompté |
| P2 Justificatifs | ✅ | C-08-13, 14 | Dépôt PDF accepté (201), .exe refusé (400), aucun bouton de décision |
| P3 Incident et observation | ⚠️ | C-08-05, 06, 08 | Incident et observation créés ; élève « en attente » refusé (403) |
| P4 Exclusion proposée | ✅ | C-08-08, 09 | Proposée (201), aucun bouton de validation, `/v2/schoollife/validations` refusé |
| P5 Convocation | ⚠️ | C-08-03, 04 | Créée puis envoyée (200) ; aucune mention « Simulée » |
| P6 Appel validé non rouvrable | ✅ | C-08-07 | Pas de bouton Rouvrir ; API reopen 403 |
| P7 Droits négatifs | ✅ | C-08-09, 10 | 4 routes refusées par redirection `/unauthorized` ; éducateurs primaire et supérieur non testés |

## Constats
### C-08-01 — Tableau de bord d'assiduité inutilisable pour l'éducateur — Majeur
`/v2/attendance` et filtre « Année scolaire » de `/v2/attendance/absences` : listes « Année scolaire » et « Période » vides, impossible d'afficher le récapitulatif. Réseau : `GET /api/v1/academic/years` → 403, aucun message d'erreur. Attendu : lecture des années/périodes, ou écran expliquant le refus.

### C-08-02 — « Aucune absence correspondante » alors que des absences existent — Mineur
`/v2/attendance/absences` sans classe choisie : faux état vide. Avec la 6e A (`GET …/reports/absences?classroomId=…&excused=false` → 200) : 6 lignes (3 absents de 120 min, 3 retards de 10 min, tous « À justifier »). Attendu : « Choisissez une classe ».

### C-08-03 — Aucune mention « Simulée » sur les convocations — Majeur
Création d'une convocation puis « Envoyer » (Application + E-mail) : `POST …/convocations/<id>/send` → 200, « Convocation envoyée. », statut « Envoyée ». Aucune occurrence du mot « Simulée » dans la page ni dans le dialogue. Attendu : indication claire que l'envoi est simulé dans cet environnement (aucune conclusion sur une livraison réelle).

### C-08-04 — Envoi refusé avec un seul canal, message peu actionnable — Mineur
Application seule : `POST …/send` → 400 « Aucune remise n'a pu être mise en file (consentements, canaux ou coordonnées). » sans nommer le tuteur ni le canal ; Application + E-mail : 200. Le brouillon reste en brouillon.

### C-08-05 — Élève à inscription « en attente » proposé, refus avec message inexact — Mineur
`/v2/schoollife/saisie` : la liste propose les 15 élèves dont les 5 en attente ; KOUASSI Yao Jean-Marc → `POST /schoollife/incidents` 403 « Cette inscription n'est plus active : aucun enregistrement de vie scolaire n'y est accepté. » Attendu : « n'est pas encore active » et élève grisé.

### C-08-06 — La création d'un incident n'apparaît pas dans l'historique — Majeur
Fiche TOURE Yao : après l'incident (15 h 38) l'historique liste « Note créé », « Mesure créé », « Convocation créé », « Brouillon → Envoyée » mais aucune entrée « Incident créé » ; l'API `…/students/<id>/life` renvoie 5 entrées sans incident.

### C-08-07 — Validation d'un appel sans confirmation — Mineur
`/v2/attendance/sessions` : « Valider » envoie aussitôt `POST …/sessions/<id>/validate` → 200 « Appel validé. », sans boîte de confirmation, action non rouvrable par l'éducateur.

### C-08-08 — Auteur affiché en identifiant technique — Mineur (cf. C-02-05)
« Déclaré par educateur », « Proposée par educateur », « Convoquée par educateur » ; « Appels non faits » : enseignant « …112c ».

### C-08-09 — Routes refusées : ancienne mise en page et blocage « Chargement… » — Mineur (cf. C-03-09)
`/v2/schoollife/validations`, `/v2/assessments`, `/v2/finance`, `/v2/payroll/history`, `/v2/results` → `/unauthorized`. `/v2/assessments` et `/v2/results` restent sur « Chargement… » plus de 4 s. API : `GET /assess/assessments` 403, `GET /finance/invoices` 403, `GET /payroll/runs` 401, `POST …/sessions/<id>/reopen` 403. Juste après des sondages directs, la session s'est fermée (retour à la connexion) ; pas de lien de cause établi.

### C-08-10 — 403 permanents sur les notifications alors que le menu les propose — Mineur
Chaque page émet `GET /notifications-inbox/unread-count` et `GET /notifications-inbox?limit=20` → 403 ; « Mes notifications » (`/v2/account/notifications`) reste sur « Chargement… ».

### C-08-11 — Faux message « Établissement inconnu » au chargement — Mineur (cf. C-03-06)
`/v2/schoollife`, pendant ~1 s.

### C-08-12 — Alertes : chargement lent et texte trompeur — Mineur
`/v2/attendance/alerts` : « Chargement… » plus de 10 s, puis « Aucune règle d'alerte… Ajoutez-en une ci-dessous. » alors qu'aucun formulaire n'est affiché à l'éducateur.

### C-08-13 — Dépôt de justificatif : succès partiel avec pièce invalide — Mineur
Fichier .exe : justificatif créé (201), pièce refusée (`POST …/attachments` 400, « Type de fichier non accepté (contrôlé sur le contenu réel du fichier). »), aucun moyen d'ajouter la pièce après coup ; second justificatif déposé avec un PDF.

### C-08-14 — Code technique et libellé vague dans la liste des justificatifs — Mineur
Motif « ILLNESS » ; « Déposé : Personnel » ; badge « 1 Issue » du mode développement sans erreur console relevée.

### C-08-15 — Boutons de « Saisie rapide » qui se chevauchent — Suggestion
`/v2/schoollife/saisie` à ~894 px.

## Contrôles transverses
- Séparation des tâches : aucun bouton Valider, Lever ou Exclure ; « Le validateur doit être une autre personne que vous. » ; `/v2/schoollife/validations` refusé.
- Exclusion : mesure « Proposée », jamais « Active ».
- Chiffres : 4 incidents ouverts = 4 lignes ; 1 mesure à valider ; 1 exclusion en cours ; appels non faits 4 / 1 / 3 → 25 % ; absences 6e A : 6 lignes ; récapitulatif d'assiduité non recomptable (C-08-01).
- Vue famille : compte Parent lié à DIABATE Nadia et DIABATE Salimata : « Rien à afficher pour le moment » ; l'observation visible des parents concerne TOURE Yao, non lié : non vérifiable.
- Éléments confidentiels : niveau « Standard » → « Les éléments restreints et confidentiels ne vous sont pas montrés » ; aucun incident confidentiel créé.
- Clavier : Échap ferme les boîtes de dialogue ; parcours Tab complet non testé.

## Données créées (fictives)
Justificatif DIABATE Nadia 7 oct. maladie sans pièce (`01a11700-9be9-72a4-bfac-1d0ef31d141b`) ; justificatif DIABATE Nadia 6 oct. avec PDF (`01a11702-cebf-73c5-9040-9839216750f6`) ; incident « Bagarre dans la cour (test QA) » TOURE Yao niveau 2 (`01a11705-99cc-740e-8b6d-bf36f0b58029`) ; observation « Aide spontanément ses camarades (test QA) » (`01a11706-17cf-779f-9216-0fc487496b02`) ; mesure exclusion temporaire 12–13 oct. « Récidive de violence (test QA) » (`01a11707-6705-761f-8320-b3cc4fe20de6`, Proposée) ; convocation TOURE Yao 14 oct. 09:00 (`01a11708-af3d-75e3-88b2-5a66e47c0d9e`, Envoyée) ; appel 6e A du 7 oct. (`01a11699-d7ce-7421-b2de-8ec48a15c84b`) Soumis → Validé. Tentative refusée : incident pour KOUASSI (403). TRAORE Aminata n'existe pas en 6e A : TOURE Yao utilisée.

## Identifiants pour l'isolation croisée
Incident `01a11705-99cc-740e-8b6d-bf36f0b58029` ; mesures `01a11707-6705-761f-8320-b3cc4fe20de6` et `01a110ef-6bb6-73f2-a92c-b0d82da69342` (démonstration) ; observation `01a11706-17cf-779f-9216-0fc487496b02` ; convocation `01a11708-af3d-75e3-88b2-5a66e47c0d9e` ; élève TOURE Yao `01a110ee-635a-7600-b5f1-91106d224f03` ; classe 6e A `01a110ee-5d00-7304-9b29-a5f03afd3088`.

## Points non testés
Récapitulatif d'assiduité (C-08-01) ; vue famille de l'observation et de la convocation de TOURE Yao ; incident confidentiel ; éducateurs de primaire-test et du supérieur ; référence du menu éducateur (« Inscriptions » et « Documents à échéance » attendus ?) ; fiche de l'appel validé ; heure d'audit de la validation ; Tab complet.

## Décisions attendues du développeur
1. Lecture de `/academic/years` pour l'éducateur, ou retrait de l'écran ? 2. Où afficher « Simulée » ? 3. « Inscriptions » et « Documents à échéance » attendus dans le menu éducateur ? 4. Lier le compte Parent de test à TOURE Yao ?

## Traitement par le développeur (2026-10-07)
| Constat | Verdict | Action |
|---|---|---|
| C-08-01 | **Défaut réel corrigé** : l'éducateur n'avait pas la lecture des années ni des périodes. | `academic.year.read` et `academic.period.read` ajoutées au rôle éducateur ; oracle RBAC mis à jour (309 tests verts) ; l'API réaligne les rôles au redémarrage. À re-tester : déconnexion/reconnexion. |
| C-08-06 | **Défaut réel corrigé** : l'événement d'un incident est journalisé sans élève (les élèves sont dans les implications) et la requête de l'historique filtrait sur l'élève. | `schoollife/infrastructure/history-repository.ts` et `application/dossier.ts` : les événements des incidents visibles sont rattachés. Tests schoollife verts (117). À re-tester sur la fiche de TOURE Yao. |
| C-08-03 | Confirmé : aucun indicateur de simulation dans l'écran. | À faire : indicateur « Simulée » alimenté par l'API (statut de remise). |
| C-08-05 | Refus conforme ; texte à corriger. | À planifier. |
| C-08-07 | Confirmé. | À faire : confirmation avant validation. |
| C-08-09, C-08-10 | Défaut connu de l'ancienne mise en page (403 de la boîte de notifications de l'ancien habillage). | À planifier (C-03-09). |
| Menu éducateur | « Inscriptions » (lecture) et « Documents à échéance » sont acceptables pour ce rôle. | — |
| Vue famille | Le compte Parent de test est lié à DIABATE Nadia et Salimata ; pour vérifier la vue famille, déclarer une observation « visible des parents » pour l'un d'eux (session 12 parent). | — |
| Autres | Confirmés (Mineur / Suggestion). | À planifier. |
