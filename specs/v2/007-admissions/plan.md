# Plan d'implémentation — 007-admissions

**Statut** : Rédigé. Tâches **parallélisables** par vagues ; tailles du plan §4 (S ≈ 1–2 semaines, M ≈ 3–5, L ≈ 6–10, pour un développeur). **Le calendrier réel dépend de la capacité de l'équipe**, inconnue (plan §8, point 1).

Prérequis : 000–004, 008, 014 (au moins `getRegistrationFeeStatus`, `issueInvoiceFromSchedule`), 016. Le stockage des pièces utilise le `StoragePort` tant que `documents` (024) n'existe pas.

## 1. Principe d'exécution

1. **Demandes de changement d'abord** (T0) : `people` (statut initial, `INACTIVE → ACTIVE`, doublons avec score), `academic` (`cancelEnrollment` d'une inscription `PENDING`), `finance` (frais d'inscription avant facturation, idempotence, annulation), `documents` (rattachement).
2. **Le DDL est livré et testé** : les migrations sont une copie du `data-model.md` ; elles ne se réécrivent pas à l'implémentation (un besoin nouveau = migration `1903+`).
3. **Une saga, des ports** : la logique d'acceptation d'offre se développe d'abord contre des **ports en mémoire**, puis contre les modules réels au câblage.

## 2. Tâches

| ID | Tâche | Détail | Dépend de | Taille | Parallèle avec |
|---|---|---|---|---|---|
| 007-T0 | Demandes de changement (spec §16) | `people`, `academic`, `finance`, `documents`, `tenancy` (modèle de workflow), plage `1900–1999`, allowlist `public_form_index` | — | S | tout |
| 007-T1 | Migrations `1900`–`1902` | Copie exacte de `data-model.md` (`--check-doc`) ; test de conformité colonnes ↔ types de ligne ; allowlist d'isolation (`public_form_index` + justification) ; test d'application de zéro ; rejeu de `ddl/run.mjs` sur les migrations réelles | — | S | T0 |
| 007-T2 | Squelette de module | `pnpm module:new admissions --range 1900` ; `manifest.ts` (permissions §11, features, menus, événements) ; `index.ts` ; schémas Zod `packages/contracts/src/v2/admissions.ts` ; codes `admissions.*` | T1 | S | T3 |
| 007-T3 | Workflow | Domaine (validation miroir de `workflows_guard` pour les messages d'écran), cas d'usage : créer/éditer un brouillon, publier (liste des défauts), nouvelle version, modèle livré en donnée (`tenancy.institution.created`) | T2 | M | T4, T5 |
| 007-T4 | Campagnes et capacités | CRUD, ouverture/clôture, capacités, `getSeatsLeft`, paramètres, classes de priorité, motifs, pièces exigées, textes de consentement | T2 | M | T3, T5 |
| 007-T5 | Candidatures (personnel) | `createApplication` (numéro `next_number`, motif), édition, transitions (permission de la transition), décisions atomiques (`recordDecision` insère puis transitionne), pièces (dépôt, relecture), entretiens, historique | T2 | L | T3, T4 |
| 007-T6 | Doublons | Rapprochement candidatures/élèves/prospects, score et raisons, résolution, politique BLOCK/WARN/OFF | T5 | M | T7 |
| 007-T7 | Liste d'attente | `waitlist_order`, plafond, `promote` manuel et automatique, alerte de place libérée | T5 | M | T6 |
| 007-T8 | **Offre et saga d'inscription** | `issueOffer` (lien à usage unique), `acceptOffer` (§7 : doublons, `people`, `academic`, `finance`, étape), idempotence, rejeu, délégation avec pièce, consommateurs `academic.enrollment.confirmed` / `.cancelled` | T5, T0 | L | T9 |
| 007-T9 | Formulaire public | Routes publiques, `public_form_index`, jeton, limiteur (`runtime.rateLimiter`), CAPTCHA (port), schéma strict, suivi par code (POST), dépôt de pièces (type réel), réponse à l'offre, contrat « aucune donnée sensible » | T5 | L | T8 |
| 007-T10 | Notifications | `notification_log` idempotente, gabarits par étape, port `ApplicantNotifier` (`SKIPPED` sans canal), annonces au personnel via `messaging` | T5 | M | T8, T9 |
| 007-T11 | Travaux planifiés | `expireOffers`, `enforcePaymentDeadline`, `purgeFormSessions`, `purgeAttempts` (30 jours), `anonymizeExpired` (inactif tant que la durée est vide) | T8 | S | T12 |
| 007-T12 | Tableaux de bord | Entonnoir, délais (SLA), canaux, motifs, capacité, parité `owner-recrutement` | T5 | M | T11 |
| 007-T13 | Plugin HTTP personnel | Routes §9.1 ; `requirePermission` (dont `permission_key` d'une transition) ; audit ; 404 hors périmètre ; export du dossier | T3–T8 | M | T14 |
| 007-T14 | Écrans web | Entonnoir (colonnes = étapes), fiche dossier, décision, liste d'attente, éditeur de workflow, campagnes, formulaire public (mobile d'abord), suivi, réponse à l'offre | T13, T9 | L | — |
| 007-T15 | Anonymisation et droit d'accès | Cas d'usage `anonymizeApplication` (purge des fichiers **avant** la fonction SQL), export de dossier, tâche de rétention | T5 | S | T12 |
| 007-T16 | E2E, seeds, charge | Seeds déterministes (40 candidatures, 3 workflows) ; Playwright « de la candidature publique à l'élève inscrit » avec paiement sandbox ; test de charge du formulaire (100 dépôts/min) ; jeu de tests de sécurité public | T9, T14 | M | — |
| 007-T17 | Qualité et nettoyage | Lint R2 (aucune constante), tests « aucune donnée personnelle dans événements/audit/logs », suppression de `registration_requests` et routes associées (tranche 2.2, avec 008), README du module | T1–T16 | S | — |

## 3. Vagues

```
Vague 1 (2 semaines) : T0, T1, T2
Vague 2 (parallèle)  : T3, T4, T5
Vague 3 (parallèle)  : T6, T7, T8, T9, T10
Vague 4 (parallèle)  : T11, T12, T13, T15
Vague 5              : T14, T16, T17
```

Chemin critique : T0 → T5 → T8 → T14 → T16 (la saga dépend des demandes de changement et des modules voisins). T9 (formulaire public) est indépendant de la saga et peut livrer en premier une **candidature publique sans inscription automatique** (utile dès la Phase 4).

## 4. Stratégie de test

| Niveau | Contenu | Bloquant en CI |
|---|---|---|
| DDL | `ddl/run.mjs` (174 tests, dont concurrence réelle) rejoué sur les migrations réelles ; `--check-doc` | Oui |
| Unitaires | Zod strict, normalisation d'identité, classes de priorité, mappage relations ↔ `people`, jetons | Oui |
| Intégration | Saga complète sur modules réels : succès, échec à chaque étape (rollback total), rejeu, confirmation tardive/doublée, classe pleine, doublon BLOCK ; HARD/SOFT/NONE ; liste d'attente ; anonymisation ; isolation A/B ; publication concurrente de workflows | Oui |
| Sécurité (public) | Contrat de réponse (liste blanche de champs) ; pas d'énumération ; jeton rejoué/expiré/trop rapide ; limiteur ; fichier falsifié ; accès au dossier d'un autre ; aucune donnée personnelle dans journaux | Oui |
| E2E | Parcours public → élève inscrit → classe | Sur `main` et avant release |
| Performance | Formulaire p95 < 300 ms, 100 dépôts/min ; liste de 5 000 dossiers p95 < 400 ms ; entonnoir < 1 s | Mesuré, objectif |

## 5. Risques et mitigations

| # | Risque | Impact | Mitigation |
|---|---|---|---|
| R1 | Les modules voisins (people, academic, finance) tardent à livrer les demandes de changement | Saga impossible | Ports en mémoire pour développer ; repli documenté : élève créé `ACTIVE` (liste d'élèves polluée) **non retenu** ; si `INACTIVE` tarde, créer l'élève au paiement avec facture sur un identifiant réservé (revoir T-A03) |
| R2 | Le formulaire public est ciblé par du spam ou du bourrage | Charge, faux dossiers, relais d'e-mails | Six couches (jeton, délai, leurre, débit Redis, CAPTCHA optionnel, schéma strict) + une confirmation par contact et par jour ; alertes sur `submission_attempts` |
| R3 | Fuite de données d'enfants par le suivi public | Atteinte à la vie privée de mineurs | Code de suivi opaque en POST, réponse minimale, pas d'énumération, tests de contrat, hash seul en base |
| R4 | Concurrence sur la dernière place | Sur-réservation | Verrou de ligne, test à plusieurs sessions réelles (livré) |
| R5 | Workflow mal configuré par une école | Dossiers bloqués | Validation à la publication (7 défauts refusés), modèle livré, éditeur avec liste des défauts, nouvelle version sans toucher aux dossiers en cours |
| R6 | Durée de conservation et consentement imposés plus tard par un texte | Rework de formulaires | Durée **vide** (donnée), textes de consentement **versionnés**, anonymisation déjà livrée |
| R7 | Pas de canal de notification | Familles non prévenues | `SKIPPED` visible, « à contacter par téléphone », export des familles à relancer ; le chantier canaux externes est distinct (plan §3.11) |
| R8 | Deux tenants du même groupe scolaire candidatent au même enfant | Doublons inter-établissements | Hors périmètre V1 (une candidature par établissement) ; question à poser au propriétaire si le cas se présente (non numérotée : hors V1) |
| R9 | Reprise du legacy impossible | Perte d'historique de demandes | D8 : aucune donnée de production à préserver ; seeds ; `registration_requests` supprimée (T17) |

## 6. Sortie de phase (Phase 4, volet admissions)

Reprise de `spec.md` §17 : migrations et 174 tests ; parcours E2E public → élève inscrit ; concurrence validée ; aucune donnée personnelle hors des tables ; demandes de changement acquittées ; Q-A01 à Q-A18 transmises. Les valeurs par défaut des questions ouvertes (offre 14 jours, aucune conservation, aucun délai de paiement, formulaire fermé sans texte de consentement) rendent la livraison possible sans réponse du propriétaire.
