# Rapport de session 10 : Responsable des examens / Collège Le Baobab (secondaire-test)

- Compte : examens@secondaire-test.test (Responsable des examens, sans MFA)
- Établissement : Collège Le Baobab (secondaire-test)
- Date : 7 octobre 2026, session longue (écrans d'examen ~20 s au premier chargement en mode développement)
- Navigateur : Chrome (pilotage par extension) ; application locale http://localhost:3000

## Synthèse
La bannière « Règles de démonstration » est présente sur tous les écrans d'examen vus, aucun document officiel n'est proposé pour l'examen blanc, et les chiffres recomptés à la main sont justes. Trois blocages empêchent de dérouler le parcours complet : le centre créé n'est jamais proposé dans « Répartition » (C-10-01), la saisie de notes est fermée tant que la session est en « Inscriptions ouvertes » (C-10-03), et aucun format d'export ou d'import n'est publié (C-10-05). Aucune action irréversible (pas d'émission de documents, de publication ni de changement d'état de session).

## Parcours exécutés
| Parcours | Statut | Remarque |
|---|---|---|
| P1 Session officielle et blanche | Fait | OFF-DEMO : bannière, 9 candidats / 0 inscrit / 9 éligibles au départ ; BLANC-DEMO : bannière, calcul par la règle, « Un examen blanc ne donne lieu à aucun document officiel » |
| P2 Candidats, centres, salles | En partie | Candidat issu d'une classe ajouté, éligibilité évaluée, candidat libre créé, centre et 3 salles créés ; répartition en salles impossible (C-10-01) |
| P3 Notes, résultats, stats, exports, corrections | En partie | Résultats et statistiques lus et recomptés ; saisie refusée (C-10-03) ; exports/imports sans format (C-10-05) ; corrections lues, aucune demande créée |
| P4 Droits refusés | Fait | 5 URL redirigées vers l'ancien « Accès refusé » |

## Constats
### C-10-01 : Le centre actif créé n'est pas proposé dans « Répartition » — Majeur
`/v2/examinations/assignments` : après création de « Centre Cocody-Test » (COCODY-TEST, actif) avec 3 salles de 30 places, « Aucun centre actif : créez-en dans « Centres et salles » », « Aucune salle disponible », capacité 0, « Enregistrer les centres » désactivé ; sur BLANC-DEMO « Capacité insuffisante : il manque 9 place(s) ». Réseau : `GET /sessions/<id>/centers` 200 ; aucun appel `GET /examinations/centers` sur cet écran. Pas de rattachement possible. Centre `01a11747-7de8-7106-9d85-ee4797f1d371`.

### C-10-02 : Codes techniques dans les messages de refus d'inscription — Mineur (cf. C-02-03)
« l'éligibilité doit être établie avant l'inscription (statut INELIGIBLE)(examinations.not_eligible) » pour TRAORE Aminata (candidat libre, Non éligible). Point positif : la règle bloque l'inscription d'un non éligible et aucune dérogation n'est offerte à ce rôle.

### C-10-03 : Saisie de notes refusée en session « Inscriptions ouvertes », avec code technique et HTTP 200 — Moyen
ASSI Brice (n° EXAM_DEMO2027-00001), EP1 = 12 : « 0 note(s) enregistrée(s), 0 inchangée(s). la saisie des notes n'est ouverte que session en cours ou résultats saisis (session REGISTRATION_OPEN)(examinations.scores_closed) ». `PUT …/sessions/<id>/scores/bulk` → 200 alors que rien n'est enregistré. Attendu : message clair et champ désactivé hors état « Épreuves en cours ».

### C-10-04 : Une seule épreuve (EP1), impossible de saisir Français / Mathématiques / Anglais — Moyen (fonction non trouvée)
Seule la colonne « EP1 /20 » existe ; aucune action d'ajout d'épreuve trouvée.

### C-10-05 : « Aucun format publié » : exports et imports inutilisables — Moyen
`/v2/examinations/exports` : « Aucun format publié. » ; `/imports` : « Aucun format publié pour ce contenu. »

### C-10-06 : Identifiants et codes techniques sur l'écran des examens blancs — Mineur (cf. C-02-05)
`/v2/examinations/mock` : « Épreuve 1 (démonstration) ← évaluation 01a110ef », « Règle CI-EXAM-PLACEHOLDER, version 01a110dc-2d58-7458-b301-3c071cc76d62 » ; résumé « 0 note(s) reprise(s), 8 inchangée(s), 0 sans candidat. 9 résultat(s) calculé(s) » ; bandeau « Le calcul a utilisé des règles de démonstration » présent.

### C-10-07 : Bandeau de démonstration en double et « Chargement… » répété — Mineur
Bandeau deux fois sur « Statistiques d'examen » ; « Chargement… » écrit deux fois pendant 10 à 20 s sur Imports, Corrections, Répartition.

### C-10-08 : Titre d'onglet « Administration » sur tous les écrans d'examen — Mineur (cf. C-07-14)

### C-10-09 : Accès refusés : ancien écran et 403 secondaires — Mineur (cf. C-03-09)
`/v2/finance`, `/v2/students/new`, `/v2/admissions/settings`, `/v2/schoollife`, `/v2/assessments/new` → `/unauthorized`, aucun contenu visible ; sur chaque refus : `GET /admin/access/me/menus` 403, `GET /notifications-inbox/unread-count` 403, `GET /notifications-inbox?limit=20` 403, `GET /tenancy/branding` 200.

## Contrôles réussis
- Bannière « Règles de démonstration » sur Sessions, Candidats, Répartition, Examens blancs, Résultats, Statistiques, Exports, Corrections, Imports.
- Examen blanc : « n'est jamais un résultat officiel » ; aucun document officiel proposé.
- Publication de résultats, dérogation d'éligibilité et approbation de correction : aucun bouton offert à ce rôle ; liste des demandes de correction vide.
- Recomptage : BLANC-DEMO, 9 candidats ; Admis 4 (BAMBA Aya 11, BAMBA Fatou 14, COULIBALY Moussa 17, TOURE Jean-Marc 12), Refusé 4, Absent 1 ; présents 8 ; taux 4/8 = 50 % identique aux statistiques ; rangs 1 à 8 cohérents (17, 14, 12, 11, 9, 8, 6, 5). OFF-DEMO : 9 candidats au départ, 11 après ajouts.
- Inscription : « 1 candidat(s) inscrit(s) » et n° EXAM_DEMO2027-00001 pour ASSI Brice.

## Données créées
Candidat issu d'une classe ASSI Brice (6e A, OFF-DEMO, inscrit, n° EXAM_DEMO2027-00001, éligible) ; candidat libre TRAORE Aminata (fille, née le 02/09/2012, Abobo ; Brouillon, Non éligible) ; centre Centre Cocody-Test (`01a11747-7de8-7106-9d85-ee4797f1d371`) avec salles S1, S2, S3 de 30 places ; évaluations d'éligibilité lancées deux fois sur OFF-DEMO ; calcul de l'examen blanc sur BLANC-DEMO (9 résultats non publiés). Rien supprimé.

## Identifiants pour l'isolation croisée
Sessions OFF-DEMO `01a110ef-7376-731a-ab00-e4e46d6ebfed`, BLANC-DEMO `01a110ef-747f-7404-9517-bdad7165f6e1` ; classe 6e A `01a110ee-5d00-7304-9b29-a5f03afd3088` ; centre `01a11747-7de8-7106-9d85-ee4797f1d371` ; candidat n° EXAM_DEMO2027-00001 (ASSI Brice).

## Points non testés
Répartition automatique (bloquée par C-10-01) ; notes Français 12 / Mathématiques 9 / Anglais 14 (C-10-03, C-10-04) ; export et import de fichier d'autorité (C-10-05) ; émission de documents (convocation, attestation, relevé) volontairement non faite ; passage à « Inscriptions closes » / « Épreuves en cours » ; demande de correction ; frais d'examen (Q-E13) et facturation du candidat libre (Q-E15) : aucun écran trouvé, rien ne semble facturé ; refus côté API (appels directs : 401 sans jeton) ; clavier ; écrans « Types d'examens », détail d'une session.

## Décisions attendues
1. Faire avancer OFF-DEMO à « Inscriptions closes » puis « Épreuves en cours » pour tester la saisie de notes ? 2. Publier un format d'export et d'import de démonstration ? 3. Où se paramètrent les épreuves d'un type d'examen ? 4. Comment rattacher un centre à une session (C-10-01) ? 5. Autoriser un test d'émission de documents sur OFF-DEMO pour vérifier le filigrane de démonstration ?

## Traitement par le développeur (2026-10-07)
| Constat | Verdict | Action |
|---|---|---|
| C-10-01 | **Défaut réel corrigé** : la vue d'ensemble de la répartition ne renvoyait que les centres déjà rattachés à la session, donc aucun centre ne pouvait jamais être rattaché. | `examinations/application/assignments.ts` : renvoie les centres rattachés ET tous les centres actifs. Tests examinations verts (116). À re-tester : cocher le centre, « Enregistrer les centres », puis la répartition. |
| C-10-03 | **Conforme à la conception** (la saisie en lot renvoie un résultat par ligne), mais message technique et saisie proposée hors état ouvert. | À faire : champ de saisie désactivé hors état « Épreuves en cours », message traduit. |
| C-10-04 | La graine ne configure qu'une épreuve (EP1) pour ce type d'examen ; les épreuves se paramètrent dans le type d'examen. | À vérifier dans « Types d'examens » ; à enrichir dans la graine. |
| C-10-05 | **Donnée de démonstration manquante** : aucun format d'export ou d'import publié dans la graine. | À faire : un format de démonstration marqué non officiel. |
| Frais d'examen (Q-E13) / candidat libre (Q-E15) | L'API existe ; aucun écran de frais dans le module Examens. | À faire : écran de lecture des frais de l'inscription d'examen. |
| Décision 1 | Oui : faire avancer OFF-DEMO (c'est une session de démonstration) ; l'action est irréversible, à faire avec le compte autorisé (directeur des examens) lors de la reprise. | — |
| Décision 5 | Oui pour OFF-DEMO : vérifier le filigrane « démonstration » sur un document émis. | — |
| Autres | Confirmés (Mineur). | À planifier. |
