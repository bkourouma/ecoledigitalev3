# Rapport de session 11 : Directeur / Collège Le Baobab (secondaire-test)

- Compte : directeur@secondaire-test.test, rôle « Directeur » (MFA validée avec le code pré-rempli)
- Date : 7 octobre 2026 (22:16 UTC) au 8 octobre 2026 (02:01 UTC) ; heures relevées à l'horloge du navigateur
- Navigateur : Chrome (extension) ; application locale http://localhost:3000

## Synthèse
Les six actions en attente étaient dans l'état annoncé. Avec accord pour chaque action : publication de la feuille de Maths n°2, approbation de la correction BAMBA Aya, validation puis exécution de l'exclusion TOURE Yao, admission de KOUASSI Yao Jean-Marc (puis offre), refus et mise en attente de deux autres candidatures, arrêt du bulletin de paie, vérification et activation du dossier d'affectation, dérogation d'examen, passage de la session OFF-DEMO à « Inscriptions closes ». Point principal : aucune action irréversible ne demandait de confirmation (C-11-01). P4, P6 et P11 à P13 non testés faute de données (reprises à faire).

## Parcours
| Parcours | Résultat | Constats |
|---|---|---|
| P1 Connexion MFA, tableau de bord | ✅ | recomptes justes (41,27 %, 1 430 000, 90 %) |
| P2 Décisions sur candidatures | ⚠️ | C-11-02, C-11-11 |
| P3 Appels : valider, rouvrir | ✅ | motif ≥ 5 caractères vérifié |
| P4 Remboursement | non testé | liste vide |
| P5 Paie : arrêter | ⚠️ | C-11-01, C-11-08, C-11-10 |
| P6 Rejouer un paiement | non testé | aucun webhook en échec |
| P7 Rôles, abonnement | ⚠️ | C-11-08, C-11-09 |
| P8 Journal d'audit | ⚠️ | C-11-06 |
| P9 Vie scolaire | ⚠️ | C-11-05 |
| P10 Affectés de l'État | ⚠️ | C-11-04 |
| P11 à P13 (reprise) | non testé | reprises préalables non faites |
| P14 Examens | ⚠️ | C-11-12 |

## Constats
- **C-11-01** (Majeur ; Bloquant selon la grille) : publication de feuille, arrêt de paie, activation d'un dossier d'affectation, « Marquer exécutée », avancement de session d'examen s'exécutent en un clic, sans fenêtre de confirmation ni MFA récente.
- **C-11-02** (Mineur) : la décision « Admis » ne crée pas d'offre ; « Émettre une offre » est un bouton distinct (échéance 14 jours). Candidature 2026-00011.
- **C-11-03** (Mineur) : l'approbation d'une correction (BAMBA Aya 10 → 11) n'est pas appliquée ; « Appliquer maintenant » → 409 « période verrouillée ». Le filtre d'état s'ouvre sur « Demandée » alors que le libellé dit « Tous les états ».
- **C-11-04** (Mineur) : l'activation du dossier AFF-TEST-QA-0001 ne génère ni facture scindée ni échéance (rapprochement et planification à part).
- **C-11-05** (Mineur, à confirmer) : le statut de TOURE Yao reste « Actif » après « Marquer exécutée » ; aucune date d'effet affichée. Contrôle à refaire le 12 oct.
- **C-11-06** (Mineur, cf. C-02-05) : journal d'audit : acteur par identifiant, motif absent de la liste, actions en notation technique.
- **C-11-07** (Mineur) : `/v2/assessments/corrections` → « Données invalides » (400 sur des GET d'évaluation).
- **C-11-08** (Mineur, cf. C-02-03) : libellés techniques (abonnement, rôles, fiche candidat d'examen).
- **C-11-09** (Suggestion) : page Rôles invite à cloner alors que le directeur est en lecture seule.
- **C-11-10** (Mineur, cf. C-03-09) : `/v2/payroll/configuration/settings` → ancien « Accès refusé ».
- **C-11-11** (Mineur) : « Refus enregistrée » (accord).
- **C-11-12** (Suggestion) : ajout de candidats toujours proposé après « Inscriptions closes ».

## Actions irréversibles effectuées (UTC)
| Heure | Action | Avant → après |
|---|---|---|
| 22:16:36 | Validation de la mesure d'exclusion TOURE Yao (12–13 oct.) | Proposée → Validée |
| 22:17–22:18:20 | Candidature 2026-00011 : En étude puis Admis | Déposée → Admis (places 10 → 9) |
| 22:33:58 | Publication de la feuille « Devoir de Mathématiques n°2 (test QA) » | Approuvée → Publiée |
| 22:34:52 | Approbation de la correction BAMBA Aya 10 → 11 | Demandée → Approuvée (non appliquée, 409) |
| 22:36:14 | Arrêt du bulletin YAO Fatou (123 000 F CFA) | Calculé → Arrêté |
| 22:37:13 | « Marquer exécutée » sur l'exclusion | Validée → exécutée |
| 22:46:16 / 22:46:26 | Dossier AFF-TEST-QA-0001 vérifié puis activé | Enregistré → Actif |
| 22:48:22 / 22:48:33 | Appel du 7 oct., 6e A : réouvert puis revalidé | Validé → Soumis → Validé |
| 22:49:11 | Offre de place pour 2026-00011 | échéance 21 oct. |
| 00:04:07 (8 oct.) | Candidature 2026-00010 refusée | Déposée → Refusé |
| 00:04–00:05:09 | Candidature 2026-00005 en liste d'attente | Déposée → Liste d'attente |
| 00:05:54 | Session OFF-DEMO : « Inscriptions closes » (réversible) | Ouvertes → Closes |
| 02:01:09 | Dérogation d'éligibilité TRAORE Aminata | Non éligible → Éligible |

## Identifiants (isolation croisée)
Candidatures 2026-00011 `01a11675-8202-77c5-bf94-1cdc5ce6a461`, 2026-00010 `01a111c3-e26d-767d-aa02-09523c4c8311`, 2026-00005 `01a110ee-e9f2-7266-b47a-1ffa050391cc` ; évaluation Maths n°2 `01a116de-71f0-766b-b94b-ce6d52c72921` ; correction `01a116e0-4f6b-756c-a581-f5bd423b049f` ; mesure `01a11707-6705-761f-8320-b3cc4fe20de6` ; session OFF-DEMO `01a110ef-7376-731a-ab00-e4e46d6ebfed`. Aucune donnée d'un autre établissement rencontrée.

## Non testé
P4, P6, P11 à P13, publication de résultats d'examen, dépassement de capacité, recours d'une mesure, rôle Propriétaire, séparation des tâches inversée, clavier (hors Échap).

## Décisions demandées
1. Gravité de C-11-01. 2. C-11-02, C-11-03, C-11-04 voulus ? 3. Reprises (directeur des études, chargé d'admissions, économe). 4. Contrôle du 12 oct. 5. Remettre OFF-DEMO à « Inscriptions ouvertes » ?

## Traitement par le développeur (2026-10-08)
| Constat | Verdict | Action |
|---|---|---|
| C-11-01 | **Corrigé en partie** : fenêtre de confirmation avec rappel de l'effet pour approuver / publier une feuille, arrêter un bulletin, activer un dossier d'affectation. MFA récente (step-up) : décision métier en attente. | `ConfirmDialog` (`platform/ui/ModalDialog.tsx`), `WorkflowBar.tsx`, `Payslips.tsx`, `AssignmentActions.tsx`, clés `v2Ui.confirm.*` ; tests mis à jour. Reste : « Marquer exécutée », avancement de session d'examen. |
| C-11-02 | Conforme à la conception (l'offre est une étape séparée) mais non expliqué. | À faire : texte explicatif ou émission automatique (décision). |
| C-11-03 | Conforme (application à la levée du verrou de période). Défaut réel : filtre « Tous les états » qui filtre sur « Demandée ». | Filtre à corriger ; reprise avec le directeur des études pour rouvrir la période. |
| C-11-04 | Conforme : la facture scindée vient du rapprochement. | Texte à ajouter sur l'écran. |
| C-11-05 | Conforme à la règle (mesure active à sa date de début). | Afficher la date d'effet ; contrôle le 12 oct. |
| C-11-07 | **Corrigé** : identifiant non UUID → page introuvable. | `assessments/[id]/page.tsx`. |
| C-11-11 | **Corrigé** : « Décision « Refus » enregistrée : … ». | `fr-CI.json` (`decision.done`). |
| C-11-06, 08, 09, 10, 12 | Confirmés (Mineur / Suggestion). | À planifier. |
