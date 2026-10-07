# Rapport de session 09 : Responsable pédagogique / Collège Le Baobab (secondaire-test)

- Compte : pedagogie@secondaire-test.test, rôle « Responsable pédagogique » (MFA : code pré-rempli, validé)
- Établissement : Collège Le Baobab (démonstration)
- Date : 7 oct. 2026, de ~16 h 00 à ~16 h 50 (environ 50 min)
- Navigateur : Chrome (Claude in Chrome), ~894 px de large

Rappel : règles de démonstration (règle appliquée : CI-SECONDARY-PLACEHOLDER v2) ; aucune conclusion réglementaire.

## Synthèse
Le circuit Soumise → Relue → Approuvée fonctionne et l'historique des transitions est tracé avec commentaire. L'approbation a été acceptée par la même personne que le relecteur alors que les réglages « séparés » sont actifs (C-09-01), et sans demande de MFA (C-09-02). Aucun bouton de publication n'est offert (conforme). Plusieurs écrans de résultats affichent des identifiants ou codes bruts. La demande de correction BAMBA Aya n'a pas été retrouvée.

## Parcours exécutés
| Parcours | Résultat | Constats | Remarque |
|---|---|---|---|
| P1 Feuilles à relire | ✅ | C-09-04, 05, 11 | Feuille retrouvée (Soumise), renvoyée en brouillon avec commentaire (200), commentaire vu par l'enseignant, resoumise, puis marquée Relue (200) |
| P2 Approuver la feuille | ❌ | C-09-01, 02 | Approbation acceptée (200) malgré le réglage quatre-yeux ; pas de bouton Publier |
| P3 Résultats, explication, bulletins | ⚠️ | C-09-06, 07, 08, 12 | Lecture seule respectée ; moyenne pondérée recalculée (BAMBA Aya) |
| P4 Curriculum, structure, personnes | ⚠️ | C-09-09, 10 | Lecture OK ; édition du curriculum : fonction non trouvée |
| P5 Types d'évaluation | ✅ | C-09-07 | 9 types listés ; réglages en lecture seule |
| P6 Négatifs de droits | ✅ | C-09-03 | 6 adresses refusées (ancienne mise en page = défaut connu) |

## Constats
### C-09-01 : Approbation acceptée par la personne qui a relu, malgré le réglage quatre-yeux — Majeur
`/v2/assessments/01a116de-71f0-766b-b94b-ce6d52c72921/grades` : (1) l'enseignant soumet ; (2) le responsable pédagogique « Marque comme relue » ; (3) le même compte « Approuve ». `POST …/transitions` → 200, « Approuvée ». Historique : SUBMITTED → REVIEWED par pedagogie (16:11:18), REVIEWED → APPROVED par pedagogie (16:24:28), `fourEyesWaived = false`. Réglages (`GET /assess/settings` 200) : `requireSeparateReviewer = true`, `requireSeparateApprover = true`. Attendu : refus ou bouton non proposé.

### C-09-02 : Aucune demande de MFA pour l'approbation — Majeur
« Approuver » passe directement, sans dialogue ni étape de vérification. Attendu (selon le prompt) : action sensible, MFA.

### C-09-03 : Écrans refusés : ancienne mise en page et « Chargement… » prolongé — Mineur (connu : C-03-09)
`/v2/assessments/new`, `/v2/reportcards/issue`, `/v2/finance`, `/v2/payroll/history`, `/v2/students/new`, `/v2/staff/new` → `/unauthorized` ; « Chargement… » plus de 6 s sur les deux premières ; appels 403 répétés (`admin/access/me/menus`, `notifications-inbox/unread-count`, `notifications-inbox?limit=20`).

### C-09-04 : Bouton « Saisir les notes » proposé au responsable pédagogique — Mineur
Feuille en Brouillon : bouton « Saisir les notes » visible alors que la feuille dit « Vous pouvez consulter cette feuille mais pas saisir de notes ». Non cliqué.

### C-09-05 : Auteur de transition affiché par son identifiant — Mineur (cf. C-02-05)
« Par pedagogie » alors que l'enseignant apparaît par nom.

### C-09-06 : Explication d'un résultat : identifiants, code brut, coefficients absents — Mineur
`/v2/results/01a110ee-ff13-73a4-b52e-25a003311791/explain` (BAMBA Aya) : « Matière · 01a110ee », « PERIOD_VALIDATED », aucun coefficient, « Version du résultat 3 » contre « version des résultats 1 » dans la matrice. Contrôle : (3×11,25 + 3×11,75 + 2×12,75 + 2×13,25)/10 = 12,10 = valeur à l'écran (association matières/lignes supposée).

### C-09-07 : Libellés techniques ou sans accents — Mineur
« DONE », « BLOCKED », « results.state_closed » ; « Notes incompletes », « Periode validee » ; groupes « CONTINUOUS », « EXAM », « PROJECT », « ORAL », « PRACTICAL », « OTHER », « ENTERED_AVERAGE » ; « CI-SECONDARY-PLACEHOLDER ».

### C-09-08 : Un bulletin publié existe pour un élève sans moyenne — Mineur (à vérifier)
ADOU Aïcha : bulletin « Publié » (Trimestre 1) alors que ses résultats T1 affichent « — / En attente / Notes incompletes ». Les 9 bulletins sont « Publié, PDF prêt ».

### C-09-09 : Détail d'une évaluation bloqué sur « Établissement inconnu » — Mineur (cf. C-03-06)
Plus de 26 s sur le détail d'une évaluation publiée ; `/grades` après ~10 s.

### C-09-10 : Curriculum publié : aucune possibilité d'édition pour ce rôle — Mineur
`/v2/academic/curriculum` : seuls « Rapport de validation », « Historique des amendements », « Cloner vers une autre année » ; le texte annonce un amendement motivé possible mais aucun bouton. Ajout puis retrait de « Éducation civique (test QA) » non testé. `GET …/classrooms/<id>/offerings` 403 sur plusieurs écrans.

### C-09-11 : Liste des évaluations : « Choisissez d'abord une classe » et doublons — Suggestion
14 évaluations listées avec le message « Choisissez d'abord une classe » ; libellés identiques (« Devoir de la période 2 » ×4, « Composition » ×4, « Premier contrôle » ×2).

### C-09-12 : Effectif de classe incluant les inscriptions en attente — Suggestion
6e A « 15 / 40 » dont 5 en attente (10 actives) ; résultats T1 : 9 élèves ; la page des inscriptions émet un appel `people/students/<id>` par ligne (15).

Autres : menu plus large que prévu (Emploi du temps, Présences, Personnel, Affectations, Établissement, Documents à échéance) ; `GET /academic/years` répond maintenant 200 ; T3 : « État de la période introuvable (identifiants bruts) ».

## Données créées (fictives)
Transitions sur l'évaluation `01a116de-71f0-766b-b94b-ce6d52c72921` : Soumise → Brouillon (« Barème de l'exercice 3 à vérifier (test QA) », 16:08:59), Brouillon → Soumise (enseignant, 16:10:10), Soumise → Relue (16:11:18), Relue → **Approuvée** (16:24:28, accord du développeur). Curriculum non modifié.

## Identifiants pour l'isolation croisée
Évaluation `01a116de-71f0-766b-b94b-ce6d52c72921` (Devoir de Mathématiques n°2, 6e A, Trimestre 3, **Approuvée**) ; transitions `01a11720-0e33-77ec-9a75-b7d3219eb871`, `01a11721-257b-7513-b568-53950f512173` ; évaluation `01a110ef-7f37-75c4-a001-3341b4bd52d5` (« Devoir de la période 2 », Publiée) ; classe 6e A `01a110ee-5d00-7304-9b29-a5f03afd3088` ; période T1 `01a110ee-5b21-7134-9bf9-b62bf7f918cb`.

## Points non testés
Demande de correction BAMBA Aya (non retrouvée : aucune liste de demandes dans le menu du rôle) ; refus « relire sa propre feuille » et « valider sans relecture » ; refus de publication par l'API (appels directs sans jeton : 401) ; édition du curriculum ; téléchargement des PDF ; Tab complet.

## Décisions attendues du développeur
1. Le quatre-yeux : l'approbateur doit-il être refusé quand il est aussi le relecteur ? La MFA est-elle exigée à l'approbation ? 2. Renvoyer la feuille « Approuvée » en brouillon pour les sessions suivantes, ou la laisser pour le test de publication ? 3. Où trouver la demande de correction BAMBA Aya ? 4. Le menu élargi du responsable pédagogique est-il voulu ?

## Traitement par le développeur (2026-10-07)
| Constat | Verdict | Action |
|---|---|---|
| C-09-01 | **Conforme à la spécification** (AC2.3 de la spec 011) : la règle de séparation porte sur la personne qui SOUMET (l'enseignant) : elle ne peut ni relire, ni approuver, ni publier. Un même relecteur peut approuver. Les réglages `requireSeparateReviewer` / `requireSeparateApprover` s'appliquent au soumetteur, pas au relecteur. Le nom du réglage prête à confusion. | Décision métier : exiger en plus relecteur ≠ approbateur ? (proposition : oui pour la publication de notes). Si oui : nouveau réglage et test. |
| C-09-02 | **Conforme à la définition actuelle** : `grade.validate` est « sensible » (authentification forte), c'est-à-dire session ouverte avec MFA, ce qui était le cas. Une MFA récente (step-up) n'est exigée que pour les résolutions de paiement (Q-PAY-38). | Décision : exiger une MFA récente aussi pour l'approbation et la publication des notes ? |
| C-09-04 | **Corrigé** : le lien vers la feuille s'appelle « Voir la feuille » pour qui n'a pas le droit de saisir. | `AssessmentDetail.tsx`, `AssessmentsScreen.tsx` ; tests assessments web verts (59). |
| Demande de correction BAMBA Aya | **Normal** : l'approbation d'une correction relève du droit `grade.revise.approve`, détenu par le directeur des études et le directeur, pas par le responsable pédagogique. | À tester en reprise de la session 03 (directeur des études). |
| C-09-08 | À instruire : bulletin publié pour un élève sans moyenne (ADOU Aïcha). | À instruire. |
| C-09-10 | À confirmer : le texte annonce un amendement possible mais aucun bouton n'existe pour ce rôle. | À instruire. |
| Autres | Confirmés (Mineur / Suggestion). | À planifier. |
