# Rapport de session 12 : Parent / Collège Le Baobab (secondaire-test)

- Compte : parent@secondaire-test.test, rôle affiché « Parent » (sans MFA)
- Date : 8 octobre 2026 (nuit UTC), fin 06:14 UTC ; navigateur Chrome (extension), http://localhost:3000

## Synthèse
Isolation correcte : 2 enfants seulement, pages et API de gestion refusées (403, aucune donnée), notes non publiées invisibles, bulletin vérifié publiquement (« règles de démonstration »). Le paiement en ligne était bloqué : aucun fournisseur configuré pour le tenant (HTTP 409), donc les 3 scénarios 25 000 / 5 001 / 5 013 n'ont pas pu être joués. Dépôt de document et ajout de contact d'urgence introuvables (voir verdict : ils n'existent pas pour le parent, l'attendu du prompt était faux).

## Parcours
| Parcours | Statut | Remarque |
|---|---|---|
| P1 Mes enfants | Fait | Nadia et Salimata DIABATE, 9 onglets |
| P2 Résultats et bulletins | Fait | Maths n°2 publié visible ; PDF obtenu ; vérification publique OK |
| P3 EDT, évaluations, absences | Fait | justificatif déposé, « En attente » |
| P4 Scolarité / paiement sandbox | Partiel | lecture OK ; paiement impossible (C-12-01) |
| P5 Documents, dossier, compte | Partiel | C-12-06 |
| P6 Annonces et messages | Fait | message envoyé, accusé de lecture donné en dernier |
| P7 Isolation | Partiel | pages et API refusées ; ids ASSI/TOURE inconnus |
| P8 Secondaire | Fait (états vides) | vie scolaire, décisions, affectation, examens : vides |

## Constats
- **C-12-01** (Majeur) : « Payer en ligne » : « Le fournisseur "…" n'est pas configuré pour ce tenant. » pour Orange Money, CinetPay, TrésorPay, Wave, MTN MoMo ; POST `/api/v1/finance/me/learners/<id>/payments/online` → 409 ×5. Aucun fournisseur simulé proposé.
- **C-12-02** (Mineur) : aucune mention « simulé / démonstration » dans le dialogue de paiement ni sur le reçu REC-2026-000011.
- **C-12-03** (Mineur, cf. C-02-03/05) : « PERIOD_VALIDATED », « ILLNESS », « OTHER », identifiants au lieu des noms, auteur d'annonce par identifiant, destinataire « Personnel ».
- **C-12-04** (Mineur) : tableau de bord « Aucune donnée d'assiduité » alors que la liste des absences en contient une ; identifiant inconnu → « Établissement inconnu » au lieu de « introuvable ».
- **C-12-05** (Suggestion) : l'absence reste « À justifier » après dépôt du justificatif (« En attente » dans une liste séparée) ; GET `justification-reasons` → 403 pour le parent.
- **C-12-06** (annoncé Majeur) : pas de dépôt de document ni d'ajout de contact d'urgence côté parent.
- **C-12-07** (Mineur) : titre d'onglet « Administration » sur Messages.
- **C-12-08** (Mineur, C-03-09) : refus d'accès en ancienne mise en page.
- **C-12-09** (Suggestion, non testé) : mention « démonstration » du PDF non lisible (texte compressé) ; lien de téléchargement à usage unique (2e lecture refusée : correct).

## Contrôles réussis
2 enfants seulement ; Maths n°2 (16/20 Nadia) visible, aucune feuille non publiée ; bulletin T1 téléchargé par lien court, vérification publique « Document authentique » sans donnée personnelle ; messagerie limitée aux destinataires autorisés (recherche « ASSI » vide) ; annonces : brouillon invisible ; pages de gestion refusées (403, aucune donnée) ; finances de Nadia (225 000 payés, reste 0) et Salimata (125 000 payés, reste 100 000) uniquement ; Échap ferme le dialogue.

## Actions irréversibles
| Heure (UTC) | Action |
|---|---|
| 2026-10-08 06:13:56 | Accusé de lecture de l'annonce « Réunion des parents : rentrée (test QA) » (`01a11133-bbb6-7517-8ab1-95ea94db3fa2`) |

## Données créées
Justificatif d'absence (Nadia, 7 oct., « Rendez-vous médical (test QA) », `01a11996-166a-7516-bb72-034fd7814746`, En attente, retirable) ; message à TRAORE Kouadio « Date du prochain devoir (test QA) » (conversation `01a11a21-8d70-75b3-a4c6-36df0bc1eb97`). Aucun paiement, contact ni document.

## Identifiants
Nadia `01a110ee-5f94-76d2-8b44-10e474bd1ae9` ; Salimata `01a110ee-60cf-7059-a64c-d7da15e9a937` ; bulletin T1 de Nadia `01a110ef-05b9-737f-942b-9849874f6bb4` ; reçus de Salimata REC-2026-000011 `01a110ef-8c88-75fe-908f-cd9a760817f6` et REC-2026-000002 `01a110ee-7f81-71b9-92f6-36bbf62f2a20` ; annonce acquittée `01a11133-bbb6-7517-8ab1-95ea94db3fa2`.

## Non testé
Paiements 25 000 / 5 001 / 5 013 (C-12-01) ; reçu après succès ; isolation ASSI Brice / TOURE Yao (ids non accessibles au parent) ; vie scolaire, conseil, affectation, examens (vides) ; notification « Simulée » ; mention « démonstration » dans le PDF.

## Décisions demandées
1. Fournisseur de paiement de démonstration pour secondaire-test. 2. Le parent doit-il pouvoir ajouter un contact / déposer un document ? 3. Ids ASSI/TOURE pour l'isolation. 4. Sort du justificatif de test.

## Traitement par le développeur (2026-10-08)
| Constat | Verdict | Action |
|---|---|---|
| C-12-01 | **Défaut réel corrigé** : l'écran ne proposait que cinq opérateurs réels, aucun configuré en développement ; le fournisseur simulé « sandbox » (succès / 001 en attente / 013 échec, accepté par l'API hors production) n'était pas offert. | « Paiement simulé (démonstration) » proposé en premier et présélectionné dans l'environnement dev v2 (`NEXT_PUBLIC_FINANCE_SANDBOX=1`, fourni par `scripts/dev-v2/cli.mjs`), avec rappel des montants de test. **Le serveur web doit être redémarré** pour prendre la variable. À re-tester. |
| C-12-02 | Corrigé en partie : l'indication « Paiement simulé : aucun argent réel » apparaît dans le dialogue. Le reçu ne porte pas encore la mention (le champ « simulé » est retiré pour les familles). | Reçu : à faire. |
| C-12-06 | **Attendu erroné dans le prompt** : le parent ne dépose pas de document (onglet en lecture seule) et n'ajoute pas de contact d'urgence ; le secrétariat ajoute (guide C04.7), le parent corrige les coordonnées (C20.5). | Prompt de la session 12 corrigé. Texte d'aide de l'état vide à adapter. Pas de contact d'urgence dans la graine : à ajouter par le secrétariat pour tester la correction. |
| C-12-04 | À instruire : le tableau de bord vient d'un indicateur de période, la liste d'un enregistrement d'appel. | À instruire. |
| C-12-05 | Conforme à la conception (justificatif en attente de décision) mais non lié visiblement à l'absence. | À améliorer. |
| C-12-03, 07, 08, 09 | Confirmés (Mineur / Suggestion). | À planifier. |
| Décision 3 | Les élèves hors famille ne sont pas accessibles au parent (comportement voulu). L'isolation parent est jugée vérifiée par les refus 403. | — |
| Décision 4 | Laisser le justificatif en attente : l'éducateur ou le secrétariat peut le traiter lors de la reprise. | — |
