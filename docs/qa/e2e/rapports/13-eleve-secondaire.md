# Rapport de session 13 : Élève / Collège Le Baobab (secondaire-test)

- Compte : eleve@secondaire-test.test, « Rôle actif : Élève » (Nadia DIABATE, matricule 00001, 6e A), sans MFA
- Date : 8 octobre 2026, environ 06:15 à 06:50 UTC ; Chrome (extension), http://localhost:3000

## Parcours
| Parcours | Résultat | Constats |
|---|---|---|
| P1 Dossier, résultats, bulletins | ⚠️ | C-13-02, C-13-03 (Maths n°2 = 16/20 visible, aucune note de camarade) |
| P2 EDT, évaluations, absences | ⚠️ | C-13-03, C-13-05 (justificatif déposé, « En attente ») |
| P3 Scolarité / paiement sandbox | ⚠️ | C-13-01 (reste dû 0, aucun paiement possible) |
| P4 Documents et profil | ✅ | téléphone modifié puis rétabli ; identité en lecture seule ; aucun bouton de dépôt |
| P5 Messages et annonces | ⚠️ | C-13-04, C-13-06 |
| P6 Négatifs de droits | ✅ | C-13-07 (une ligne) |
| P7 Secondaire | ⚠️ | C-13-08 (états vides, recours non testable) |

## Constats
- **C-13-01** (Suggestion) : scolarité soldée (225 000 payés, reste 0) : paiement simulé non testable côté élève.
- **C-13-02** (Mineur) : « Mes résultats » (Admis, moyenne 13,20, rang 2 sur 8, mention « Bien ») sans bandeau « Règles de démonstration ». Aucun nom ni moyenne de camarade.
- **C-13-03** (Mineur, cf. C-02-03/05) : « PERIOD_VALIDATED », « ILLNESS », « OTHER », identifiant au lieu du nom dans le dialogue Justifier.
- **C-13-04** (Mineur) : l'élève voit deux annonces rédigées pour les parents, avec accusé demandé.
- **C-13-05** (Suggestion, cf. C-12-05) : absence toujours « À justifier » après dépôt.
- **C-13-06** (Mineur) : textes de la messagerie écrits pour un parent (« vos enfants ») ; l'élève peut écrire à « directeur » et « secretariat » (logins) et créer un message de groupe.
- **C-13-07** (Mineur, C-03-09) : refus en ancienne mise en page.
- **C-13-08** (Suggestion) : tutoiement / vouvoiement mêlés (`/v2/councils/moi`) ; « Mon examen » mène à `/v2/examinations/family`.

## Contrôles réussis
Accueil `/v2/student` et menu complet ; seules mes notes publiées ; un bulletin (T1) ; documents propres sans bouton de dépôt ; profil (identité en lecture seule, « Coordonnées enregistrées. », rétabli) ; messagerie sans camarade ni autre famille. Isolation : reçus de Salimata (REC-2026-000011, REC-2026-000002) → « Ressource introuvable » (API 403/404/401) ; fiche de Salimata → « Accès refusé » (API 403) ; évaluation et candidature → 404 / 403 ; `/v2/parent`, `/v2/students`, `/v2/finance`, `/v2/assessments`, `/v2/teacher` refusés. Échap et focus clavier corrects.

## Actions irréversibles
Aucune (accusés de lecture volontairement non donnés).

## Données créées
Justificatif « Malaise passager (test QA) » (7 oct., Maladie, En attente) ; message « Rattrapage de devoir (test QA) » à TRAORE Kouadio (conversation `01a11a3c-9a9e-712e-a221-c3c37b1f2dc8`) ; téléphone ajouté puis supprimé.

## Identifiants
Nadia `01a110ee-5f94-76d2-8b44-10e474bd1ae9` ; reçus propres REC-2026-000010 `01a110ef-8bc2-7787-95e4-9e8d50272d3f`, REC-2026-000001 `01a110ee-7c6f-77ff-b051-8e223051ee4b`.

## Non testé
Paiement simulé (10 000 / 001 / 013) ; recours de vie scolaire ; décisions du conseil, orientation, examen (vides) ; téléchargement PDF ; isolation inter-établissements dédiée.

## Décisions demandées
1. Facture ouverte pour Nadia afin de tester le paiement. 2. L'élève doit-il voir les annonces destinées aux parents ? 3. Bandeau « Règles de démonstration » sur les résultats.

## Traitement par le développeur (2026-10-08)
| Constat | Verdict | Action |
|---|---|---|
| C-13-04 | **Défaut de donnée de démonstration** : l'annonce de rentrée de la graine vise « parents, élèves, personnel » mais son texte s'adresse aux parents. Le mécanisme de ciblage est correct. | `scripts/seed-v2/demo/comms.ts` : cible désormais parents et personnel (effet sur les nouvelles graines). L'annonce « Réunion des parents (test QA) » créée en session de test vise sans doute aussi les élèves : à vérifier à la reprise. |
| C-13-02 | Confirmé : les DTO de résultats des familles n'indiquent pas si les règles sont de démonstration. | À faire : indicateur dans l'API des résultats, puis bandeau (travail API + écran). |
| C-13-01 | Normal pour une scolarité soldée. | Facture ouverte à créer par l'économe lors de la reprise 05 partie B (ex. frais divers de 10 000 pour Nadia), puis rejouer 10 000 / …001 / …013 côté élève. |
| C-13-06 | Confirmé : textes de la messagerie pour parents ; droits d'écriture de l'élève à clarifier avec le métier (écrire à l'administration est-il voulu ?). | Décision métier. |
| C-13-03, 05, 07, 08 | Confirmés (Mineur / Suggestion). | À planifier. |
| Isolation | **Conforme** : reçus et fiche de la sœur, évaluations, candidatures refusés ou introuvables. | — |
