# Feature Specification: Portage de la rémunération des enseignants (032-payroll-port)

**Feature Branch**: `032-payroll-port`

**Created**: 2026-10-01

**Status**: Rédigée — à relire avec le propriétaire du produit (questions : `../012-rules-engine/open-questions.md` §B, Q-27 à Q-30, Q-36, Q-37, Q-40) avant `/speckit.plan`

**Sources**: `specs/031-remuneration-professionnelle/` (spec, plan, data-model, research, contracts, `_constat.txt`) ; `docs/module-remuneration-portage-nouvelle-stack.md` (spécification portable, **référence fonctionnelle**) ; `docs/workflow-paie-enseignants.md` ; `docs/recette-remuneration-professionnelle.md` ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.4, §3.9, §4 (tranche 2.7 et Phase 3), §5.1 ; `docs/inventory/legacy-dependents-by-slice.md` (tranche 2.7) ; ADR-002/004/006/007 ; commit `1dbb34f` (bulletin de paie réservé à son titulaire ou à la gestion) ; legacy : `apps/api/src/services/payment-calculator.ts`, `hour-collectors/*`, `professional-seance-validation.service.ts`, `professional-ecue-rates.service.ts`, `teacher-payroll-overview.service.ts`, `teacher-payslip*.service.ts`, `owner-payroll*.service.ts`, `routes/{teacher-payments,payment-periods,teacher-payment-configs,payment-reports,professional-remuneration}.ts`, migrations `0011`, `0103`→`0114`. Gabarit : `specs/v2/000-platform-foundation/spec.md`.

> **Parité complète avec la spec 031** sur le nouveau cœur : calcul (salaire / horaire / mixte, heures supplémentaires hebdomadaires sur le cumul des origines, un seul bulletin par enseignant et par période), états `calculé → approuvé → payé`, bulletins de paie, validation par le propriétaire, accès au bulletin réservé à son titulaire ou à la gestion. Les **collecteurs d'heures lisent le nouveau modèle** (séances de 017, présences enseignants de 010) **via des ports**, jamais par jointure SQL.
> Ce n'est **pas** une réécriture du moteur de paie : les formules sont conservées ; ce qui change est l'infrastructure (entiers, minutes, contraintes de base, ports) et la suppression des défauts recensés par le legacy.

## 1. Objectifs

1. **Répondre à une seule question** : combien doit-on à chaque enseignant pour une période, et pourquoi — avec un détail opposable (100 % des heures payées rattachées à une séance ou une présence identifiable).
2. **Trois actes, trois traces** : *calculer*, *arrêter (approuver)*, *verser (payer)* — chacun avec son auteur et sa date ; l'archivage ne marque jamais « payé ».
3. **Une heure ne se paie qu'une fois — garantie par une contrainte de base** (et plus seulement par un prédicat de requête), y compris avec des périodes qui se chevauchent.
4. **Un seul bulletin par enseignant et par période**, toutes origines d'heures confondues, pour que le seuil d'heures supplémentaires porte sur le temps réel de la personne.
5. **Zéro flottant, zéro chiffre magique** : montants en entiers (XOF), durées en minutes, arrondi demi-supérieur défini, paramètres en données.
6. **Sécurité par construction** : un enseignant ne lit que ses bulletins ; la gestion lit tout ; les transitions de statut sont contrôlées (le legacy en acceptait n'importe laquelle).

## 2. Périmètre

### Inclus

- Module backend `payroll` (schéma `payroll`) : réglages, périodes (collectives ou ciblées), configurations de paie, tarifs horaires, validation des séances (couche paie), bulletins de paie et détail, journal, comptes rendus de calcul, rapports, vues owner.
- Moteur de calcul **pur** (domaine) : salaire au prorata des jours ouvrés, horaire avec heures supplémentaires hebdomadaires, mixte ; résolution de tarif ordonnée ; aucun accès base.
- Ports : `SessionHoursPort` (017), `TeacherAttendancePort` (010), `StaffDirectoryPort` (009), `CurriculumLabelPort` (004), `DocumentRenderer` (013) ; collecteurs `SessionHourCollector` et `AttendanceHourCollector` derrière l'interface `HourCollector` conservée.
- Écrans : configuration, validation des séances, bulletin de paiement, historique ; espace enseignant ; rapports ; vue owner « masse salariale » et validation.
- Bulletin de paie PDF (rendu par 013).

### Exclu (renvoyé)

| Sujet | Spec |
|---|---|
| Emploi du temps, séances, conflits | 017-scheduling (source des séances) |
| Présences enseignants | 010-attendance (source des présences) |
| Fiches du personnel, comptes utilisateurs | 009-teachers-staff, 002 |
| Décaissement réel (banque, Mobile Money), écritures comptables, dépenses | 014/015 (événement `payroll.payslip.paid`) |
| Retenues et cotisations légales calculées | hors périmètre legacy (Q-28) |
| Notifications e-mail/SMS du bulletin | 016-communications (événement) |
| Formateurs du module Imhotep (supprimé, D7) | — |
| Pointeuse, biométrie | non couvert |

## 3. Acteurs

| Acteur | Rôle |
|---|---|
| Comptable / gestionnaire de paie | Configure, valide les séances, calcule, ajuste (primes/retenues), arrête et verse |
| Propriétaire (owner) | Consulte la masse salariale ; valide (arrête) un bulletin ; peut verser |
| Directeur / administrateur | Idem gestionnaire selon permissions ; accès lecture à tous les bulletins |
| Enseignant / personnel | Consulte **ses** séances validées et **ses** bulletins uniquement |
| Responsable pédagogique | Constat de réalisation des séances (via 017) |
| Worker | Calculs volumineux, rendu PDF, rapprochement des séances |
| Système (ports) | 017, 010, 009, 004 |

## 4. User Stories et critères d'acceptation

Les 20 scénarios d'acceptation de `docs/module-remuneration-portage-nouvelle-stack.md` §15 (T1-T20) sont repris tels quels comme critères ; ils sont référencés « T-n ».

### US1 — Distinguer le planning du réalisé, puis de ce qui est payable (P1)

En tant que gestionnaire, je transforme un planning en heures payables : constat, puis validation.

- **AC1.1** (T4) Une séance non `HELD` (planifiée, annulée), non validée, sans enseignant ou sans durée déterminable **ne produit aucun montant**.
- **AC1.2** Le prédicat de payabilité `payable := status = HELD ∧ staff ≠ null ∧ (paid_minutes_override ≠ null ∨ (start ∧ end)) ∧ validated_at ≠ null` et la durée retenue `minutes := paid_minutes_override ?? (end − start)` sont définis **une seule fois** (`payroll/domain/payability.ts`) et importés par l'écran de validation, les compteurs de la vue d'ensemble et les collecteurs ; un test d'architecture interdit toute autre définition.
- **AC1.3** La validation en lot (≤ 500 séances) est **partielle** : les éligibles passent, les autres reviennent avec leur motif (`STATUT_NON_REALISEE`, `SANS_ENSEIGNANT`, `HORAIRES_INCOMPLETS`, `DEJA_PAYEE`) ; (T13) 199 validées + 1 rejetée avec motif sur 200.
- **AC1.4** Une séance rattachée à un bulletin `APPROVED` ou `PAID` ne peut plus être dévalidée, annulée ou voir sa durée modifiée ; elle ne peut pas être supprimée (clé étrangère `RESTRICT` sur les réclamations d'heures).
- **AC1.5** La dérogation de durée (`paid_minutes_override`) ne modifie jamais les horaires de la séance ; la saisir égale à la durée planifiée la retire ; la retirer d'une séance sans horaires est refusée.
- **AC1.6** Une séance ajoutée depuis l'écran de paie (« saisie comptable ») est créée via 017 avec le marqueur `ACCOUNTING`, au statut `HELD` mais **non validée**.
- **AC1.7** Les **chevauchements d'horaires** d'un même enseignant le même jour sont détectés et signalés avant validation (liste dédiée) ; la validation reste possible avec confirmation tracée.
- **AC1.8** L'écran **séances manquantes** liste, sur un intervalle, les créneaux attendus (emploi du temps de 017) sans séance correspondante, avec bouton « ajouter ».
- **AC1.9** Les compteurs de l'écran (à traiter, prêtes à valider, heures à valider, déjà rattachées) sont calculés **par le serveur sur tout le périmètre filtré** (T19 : 300 séances paginées à 10 ⇒ « 300 »).
- **AC1.10** Le tri place le passé d'abord (du plus récent au plus ancien) puis le futur.

### US2 — Calculer le bulletin de chaque enseignant (P1)

- **AC2.1** (T1) Un enseignant exclusivement « séances », horaire, 6 h validées : bulletin non nul égal à heures × tarif, à l'unité monétaire près (règle d'arrondi AC2.8).
- **AC2.2** (T2) Un enseignant mixte (4 h de présences + 3 h de séances validées) reçoit **un seul** bulletin de 7 h dont chaque ligne porte son origine (`ATTENDANCE` / `SESSION`).
- **AC2.3** (T3) Un enseignant salarié voit son montant inchangé par ses séances ; elles sont listées à titre informatif sans effet.
- **AC2.4** (T8) Un enseignant sans configuration valide sur la période est **écarté et nommé** dans le compte rendu (`NO_CONFIG`), jamais absent en silence ; idem `NO_HOURS` (horaire sans heure), `NO_RATE_RESOLVED` (heure payable sans tarif résolu, T9), `PAYSLIP_LOCKED`, `OUT_OF_SCOPE`.
- **AC2.5** (T10, T11, T12) Deux périodes couvrant la même date : la séance n'est payée **qu'une fois** ; un bulletin annulé relâche ses heures ; un bulletin approuvé ne les relâche pas.
- **AC2.6** (T5) Recalculer deux fois de suite donne un résultat strictement identique (mêmes montants, mêmes lignes, aucun doublon) ; (T6) un bulletin `APPROVED`, `PAID` ou `CANCELLED` n'est jamais réécrit par un recalcul et est **signalé** dans le compte rendu.
- **AC2.7** (T7) Modifier un tarif après approbation ne change aucun montant approuvé ou versé (les lignes historisent minutes, taux et multiplicateur).
- **AC2.8** Règle d'arrondi : chaque ligne vaut `round_half_up(minutes × taux × multiplicateur_permille / 60 000)` en arithmétique entière ; le total du bulletin est la somme des lignes + base de salaire + primes − retenues ; un `CHECK` en base vérifie la formule de chaque ligne.
- **AC2.9** Un **aperçu (dry-run)** calcule sans rien persister et renvoie le détail ligne à ligne.
- **AC2.10** (T17) 500 séances × 100 enseignants se calculent en **≤ 30 s** (une lecture par origine pour toute la période, tarifs préchargés).
- **AC2.11** Le compte rendu de calcul est **conservé** (`calculation_runs`) et consultable après coup avec le motif de chaque écart (constat 4 de la recette S17-T : le détail des écartés disparaissait après « Générer »).
- **AC2.12** Un enseignant désactivé (`INACTIVE`) dont des séances validées n'ont pas été payées reste payé pour celles-ci (spec 031 « cas limites » ; le code legacy l'excluait à tort — Q-40).

### US3 — Heures supplémentaires sur le cumul réel (P1)

- **AC3.1** Les heures sont regroupées par **semaine calendaire (lundi-dimanche)**, toutes origines confondues, dans l'ordre déterministe `(date, heure de début [nulls en dernier], origine, identifiant)` ; dès que le cumul hebdomadaire dépasse `overtime_threshold_minutes`, la fraction excédentaire est majorée par `overtime_multiplier_permille`.
- **AC3.2** Une séance à cheval sur le seuil est **coupée en deux lignes** (normale + majorée).
- **AC3.3** Seuil et multiplicateur sont des données de la configuration de l'enseignant (défauts du tenant, `payroll.settings`) : aucune constante dans le code.
- **AC3.4** 30 h de présences + 30 h de séances la même semaine déclenchent les heures supplémentaires (seuil 40 h) ; le test des deux origines scindées échouerait.

### US4 — Salaire, mixte, prorata (P1)

- **AC4.1** Salaire : `base = salaire_mensuel × jours_ouvrés(période ∩ mois) / jours_ouvrés(mois)`, calculé **mois par mois** et arrondi par mois, somme des mois ; `salaire_mensuel` = mensuel, sinon `annuel / 12` (calcul exact avant arrondi) ; jours ouvrés = lundi-vendredi (Q-27). Pour une période d'un seul mois, le résultat égale la formule historique.
- **AC4.2** Mixte : `salaire + horaire`.
- **AC4.3** `calc_details` (JSON) produit pour tout mode : minutes normales et majorées, taux, jours de la période et ouvrés, ventilation lisible (« Heures normales », « Heures supplémentaires », « dont Présences », « dont Séances », « Salaire (prorata) »).

### US5 — Résolution du tarif d'une heure (P1)

- **AC5.1** Ordre figé : tarif (nœud + enseignant) valide à la date de la séance → tarif (nœud, générique) → `default_hourly_rate` de la configuration → `0` si configuration salariale (pas une anomalie) → **anomalie `NO_RATE_RESOLVED`** sinon ; à égalité, le nominatif d'abord puis le plus récemment ouvert.
- **AC5.2** Deux tarifs chevauchants pour un même couple (nœud, enseignant ou générique) sont impossibles (`EXCLUDE` en base, `TARIF_CHEVAUCHANT` 409).
- **AC5.3** La **date de la séance** (et non la période) détermine le tarif, pour les deux origines (le legacy ignorait la date pour les tarifs par cours).
- **AC5.4** Le simulateur `GET /rates/resolve` renvoie le montant retenu et son origine (`NODE_STAFF`, `NODE_GENERIC`, `CONFIG_DEFAULT`, `SALARY_ZERO`).

### US6 — Arrêter puis verser (P1)

- **AC6.1** (T14) **Approuver** (arrêter le montant) passe `CALCULATED → APPROVED`, pose `approved_at/by`, **ne renseigne pas `paid_at`**, est idempotent (ne redate pas) ; l'affichage dit « Impayé ».
- **AC6.2** (T15) **Verser** n'agit que sur `APPROVED` ; versement d'un bulletin `CALCULATED` refusé ; idempotent ; pose `paid_at`, `paid_by`, mode et référence de versement.
- **AC6.3** (T20) « Tout approuver / tout verser » = `{ all: true, periodId }` calculé **côté serveur** ; une liste d'identifiants vide ne vaut **jamais** « tout » ; un enseignant avec deux bulletins ouverts voit **les deux** traités.
- **AC6.4** Les transitions autorisées sont exactement : `CALCULATED→APPROVED|CANCELLED`, `APPROVED→PAID|DISPUTED|CANCELLED`, `DISPUTED→APPROVED|CANCELLED` ; `PAID` est terminal ; toute autre est refusée `409 payroll.invalid_transition` (le legacy acceptait n'importe quel statut — `PATCH /:id/status` — et un utilisateur codé en dur).
- **AC6.5** Annuler (motif obligatoire) relâche les heures (suppression des réclamations d'heures dans la même transaction) ; un bulletin `PAID` ne peut pas être annulé.
- **AC6.6** Primes et retenues sont saisies manuellement, uniquement sur un bulletin `CALCULATED`, sous forme de lignes tracées (libellé, motif) ; aucune règle automatique.
- **AC6.7** Chaque transition écrit une entrée de journal avec le **nom de l'auteur figé** et une entrée d'audit générique ; le journal survit à toute modification du compte utilisateur.
- **AC6.8** Option d'établissement (Q-30) : séparation des tâches (la personne qui a calculé ne peut pas arrêter) et seuil au-delà duquel seul le propriétaire arrête.

### US7 — Validation par le propriétaire (P2)

- **AC7.1** Le propriétaire dispose d'un écran « Masse salariale » (par période et statut, annulés et contestés exclus du total mais **montrés à part**) et d'une action « Valider » (`CALCULATED → APPROVED`) via la même action métier `approvePayslips` que l'écran du gestionnaire (une seule implémentation).
- **AC7.2** L'année de la période est **toujours** renseignée (`academic_year_id` obligatoire) : plus de repli sur le milieu de l'intervalle.
- **AC7.3** Aucun taux horaire n'est publié s'il n'est pas calculable (pas de « 0 F/h »).

### US8 — Un bulletin que seul son titulaire ou la gestion lit (P1)

- **AC8.1** `GET /payslips/:id`, `/data`, `/pdf` : la gestion (`payroll.payslip.read`) lit tout ; un enseignant (`payroll.payslip.read_own`) ne lit que les bulletins dont `staff_id` est le sien (résolu depuis son compte via `StaffDirectoryPort`, jamais depuis un paramètre) ; tout autre compte : `403` (T16).
- **AC8.2** L'envoi par courriel est réservé à la gestion (`payroll.payslip.notify`).
- **AC8.3** Le PDF est disponible pour l'enseignant une fois `PAID` ; la gestion y accède dès `APPROVED` (filigrane « NON VERSÉ ») (Q-29) ; le PDF **ne recalcule rien** : il lit le snapshot figé à l'arrêt du montant.
- **AC8.4** La configuration affichée sur le bulletin est celle **en vigueur sur la période**, figée au calcul.
- **AC8.5** `/my/*` dérive l'enseignant du jeton ; aucun paramètre `teacherId` n'est accepté (T16 : l'enseignant A ne voit aucune donnée de B).

### US9 — Vue d'ensemble de tous les enseignants (P1)

- **AC9.1** L'écran « Bulletin de paiement » liste **tous** les membres du personnel payables (pas seulement les configurés) avec : identité + matricule, état de configuration calculé (`ACTIVE | EXPIRED | FUTURE | ABSENT`), heures validées de la **période courante** (heures consommées exclues), **séances réalisées à valider**, bulletin courant, nombre d'archivés.
- **AC9.2** Les heures d'un salarié sont affichées comme « constatées, non valorisées ».
- **AC9.3** Le formulaire de création de période est désactivé s'il existe déjà une période **en attente de calcul** (aucun bulletin produit), l'état étant interrogé avant l'affichage.

### US10 — Rapports et historique (P2)

- **AC10.1** Filtre d'origine (`ATTENDANCE` / `SESSION` / tous) appliqué à l'affichage, aux totaux et aux exports ; (T18) **Σ présences + Σ séances + hors-heures = total**.
- **AC10.2** L'historique liste les bulletins arrêtés (le plus récent d'abord) avec archivé le/par, versé le/par, statut « Impayé » tant que non versé ; l'export porte le périmètre et les colonnes de l'écran ; filtres enseignant, année, période (changer d'année réinitialise la période).

### US11 — Périodes ciblées et chevauchantes (P2)

- **AC11.1** Une période est collective (aucune cible) ou ciblée (liste d'enseignants) ; la suppression d'un enseignant ciblé par une période est interdite (pas de cascade).
- **AC11.2** Les périodes peuvent se chevaucher (décision 0112) ; l'unicité du paiement d'une heure est garantie par `hour_claims` (US2 AC2.5), pas par le calendrier.

## 5. Règles métier

| # | Règle |
|---|---|
| R-PAY-01 | **On ne paie jamais un planning** : constat (017) puis validation de gestion (cette spec) sont deux actes distincts. |
| R-PAY-02 | Un seul bulletin non annulé par `(enseignant, période)` ; l'origine d'une heure vit sur la **ligne**, jamais sur le bulletin. |
| R-PAY-03 | Prédicat de payabilité, durée retenue : **une définition, un endroit** (AC1.2). |
| R-PAY-04 | Une heure (clé `(origine, identifiant de la source, enseignant)`) a **au plus une** réclamation active ; la réclamation est portée par un bulletin non annulé. |
| R-PAY-05 | Un recalcul reconstruit intégralement lignes et réclamations d'un bulletin `CALCULATED` dans une transaction ; il ne touche jamais `APPROVED`, `PAID`, `DISPUTED`. |
| R-PAY-06 | Archiver (= arrêter) n'est pas verser : trois dates, trois auteurs. |
| R-PAY-07 | Les montants sont des entiers (XOF) ; les durées des minutes ; l'arrondi est demi-supérieur, appliqué ligne par ligne (AC2.8) et par mois pour le salaire. |
| R-PAY-08 | Le tarif d'une heure est résolu à la date de la séance, dans l'ordre figé (US5). |
| R-PAY-09 | La configuration retenue est celle dont `effective_from ≤ fin de période` et (`effective_to` nul ou `≥ début de période`), la plus récente d'abord ; si l'enseignant en a deux sur la période, la plus récente s'applique à toute la période (limite connue, voir §13). |
| R-PAY-10 | Deux configurations d'un même enseignant ne se chevauchent pas (`EXCLUDE`). |
| R-PAY-11 | Pas d'heure validée ⇒ pas de bulletin pour un enseignant `HOURLY` (un bulletin est un document de paiement) ; il reste visible dans la vue d'ensemble. Un `MIXED`/`SALARY` produit son bulletin de salaire. |
| R-PAY-12 | Un bulletin ne mélange jamais deux devises ; la devise est celle de l'établissement. |
| R-PAY-13 | Un enseignant remplacé est payé sur la séance **effectivement tenue** (enseignant de la séance), pas le titulaire de l'affectation. |
| R-PAY-14 | Une séance rattachée à une période est celle qui contient sa **date** ; aucun prorata. |
| R-PAY-15 | Le journal ne se supprime pas ; l'auteur est figé ; chaque transition y figure. |
| R-PAY-16 | L'accès à un bulletin est vérifié par la **couche d'accès** (permission + propriété), jamais par l'écran. |
| R-PAY-17 | Aucune route de purge de données de développement en production (la route `POST /payment-periods/purge-dev` du legacy est supprimée). |

## 6. Modèle de données

Voir `data-model.md`. Schéma `payroll` (migrations `1500-1599`, plage proposée).

| Table | Rôle |
|---|---|
| `settings` | Réglages du tenant (seuil et majoration par défaut, sources d'heures par pack, séparation des tâches, seuil propriétaire) |
| `pay_periods`, `pay_period_targets` | Fenêtres de paie, périmètre ciblé |
| `pay_configs` | Configuration de paie par enseignant, datée |
| `hourly_rates` | Tarifs horaires par nœud de curriculum, nominatifs ou génériques, datés |
| `session_validations` | Validation de gestion et dérogation de durée d'une séance (couche paie) |
| `payslips`, `payslip_lines`, `payslip_adjustments` | Bulletin, détail d'heures historisé, primes/retenues |
| `hour_claims` | Réclamations d'heures : **unicité DB** du paiement d'une heure |
| `payslip_events` | Journal append-only (auteur figé) |
| `calculation_runs`, `calculation_run_items` | Comptes rendus de calcul conservés |

## 7. Endpoints

Préfixe `/api/v1/payroll`. Chemins statiques déclarés avant les chemins paramétrés. Contrats Zod avant routes.

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET / PUT | `/settings` | Réglages | `payroll.settings.manage` |
| GET | `/staff` | Vue d'ensemble de tous les enseignants payables | `payroll.payslip.read` |
| GET / POST / PUT | `/configs[/:id]`, GET `/staff/:id/config/current` | Configurations | `payroll.config.read` / `.manage` |
| GET / POST / PUT / DELETE | `/rates[/:id]` ; GET `/rates/resolve` | Tarifs, simulateur | `payroll.rate.read` / `.manage` |
| GET | `/sessions`, `/sessions/filters`, `/sessions/missing`, `/sessions/overlaps`, `/sessions/:id` | Séances, filtres, rapprochement, chevauchements | `payroll.session.read` |
| PATCH | `/sessions/:id/status` | `HELD` / `CANCELLED` (délègue à 017) | `payroll.session.validate` |
| PATCH | `/sessions/:id/duration` | Dérogation (`null` = retirer) | `payroll.session.adjust_duration` |
| POST | `/sessions/validate` | `{ sessionIds[], validated }` → `{ updated, rejects[] }` | `payroll.session.validate` |
| POST | `/sessions` | Séance comptable | `payroll.session.add` |
| GET / POST / PATCH | `/periods[/:id]`, GET `/periods/pending` | Périodes | `payroll.period.manage` |
| POST | `/periods/:id/calculate` | `{ staffIds?, scope, recalculate?, dryRun? }` → compte rendu | `payroll.run.calculate` |
| GET | `/runs/:id` | Compte rendu conservé | `payroll.run.calculate` |
| GET | `/payslips`, `/payslips/:id`, `/payslips/:id/data`, `/payslips/:id/pdf` | Bulletins | `payroll.payslip.read` / `.read_own` |
| POST | `/payslips/approve`, `/payslips/pay` | `{ payslipIds[] } \| { all: true, periodId }` | `payroll.payslip.approve` / `.pay` |
| POST | `/payslips/:id/cancel`, `/payslips/:id/dispute` | Annulation / contestation (motif) | `payroll.payslip.cancel` / `.approve` |
| PATCH | `/payslips/:id/adjustments` | Primes / retenues | `payroll.payslip.adjust` |
| POST | `/payslips/:id/notify` | Envoi au titulaire | `payroll.payslip.notify` |
| GET | `/history`, `/history/export` | Historique des bulletins arrêtés | `payroll.payslip.read` |
| GET | `/reports/summary`, `/reports/staff/:id`, `/reports/period/:id`, `/reports/export` | Rapports (filtre d'origine) | `payroll.report.read` |
| GET | `/my/sessions`, `/my/payslips`, `/my/payslips/:id/pdf` | Espace enseignant (identité dérivée du jeton) | `payroll.payslip.read_own` |
| GET | `/owner/mass` ; POST `/owner/payslips/:id/validate` | Masse salariale ; validation propriétaire | `payroll.report.read` ; `payroll.payslip.approve` |

## 8. Écrans

Les quatre écrans de la portabilité, plus rapports et espace enseignant : **Configuration** (liste, état calculé à 4 valeurs, formulaire adaptatif par type, tarifs, simulateur) ; **Validation des séances** (liste filtrée, compteurs serveur, validation en lot partielle, dérogation, séance comptable, séances manquantes, chevauchements) ; **Bulletin de paiement** (cartes de tous les enseignants, création de période, calcul / recalcul / aperçu, compte rendu avec écartés nommés, « Tout approuver / Tout verser ») ; **Historique des paiements** (archivés, versements, export, PDF) ; **Rapports** (filtre d'origine, ventilation à trois postes) ; **Mes rémunérations** (enseignant) ; **Masse salariale** (owner, avec validation).

## 9. Permissions

| Clé | Libellé | Sensible |
|---|---|---|
| `payroll.settings.manage` | Régler les paramètres de paie | oui |
| `payroll.config.read` / `payroll.config.manage` | Consulter / gérer les configurations de paie | non / oui |
| `payroll.rate.read` / `payroll.rate.manage` | Consulter / gérer les tarifs horaires | non / oui |
| `payroll.session.read` | Consulter les séances à valider | non |
| `payroll.session.validate` | Valider ou dévalider des séances, constater leur réalisation | oui |
| `payroll.session.adjust_duration` | Déroger sur la durée payée d'une séance | oui |
| `payroll.session.add` | Ajouter une séance comptable | oui |
| `payroll.period.manage` | Gérer les périodes de paie | non |
| `payroll.run.calculate` | Lancer un calcul ou un aperçu | oui |
| `payroll.payslip.read` | Consulter tous les bulletins de paie | oui |
| `payroll.payslip.read_own` | Consulter **ses** bulletins et séances | non |
| `payroll.payslip.adjust` | Saisir primes et retenues | oui |
| `payroll.payslip.approve` | Arrêter le montant d'un bulletin ; contester | **oui** (MFA) |
| `payroll.payslip.pay` | Constater le versement | **oui** (MFA) |
| `payroll.payslip.cancel` | Annuler un bulletin | **oui** |
| `payroll.payslip.notify` | Envoyer un bulletin à son titulaire | non |
| `payroll.report.read` | Consulter rapports et masse salariale | non |

Features : `payroll.core`, `payroll.owner-validation`, `payroll.attendance-source`, `payroll.session-source`.

## 10. Événements

Publiés : `payroll.period.created|closed|archived` ; `payroll.run.completed` (`periodId, calculated, skipped[], locked[]`) ; `payroll.payslip.calculated` ; `payroll.payslip.approved` ; `payroll.payslip.paid` (`payslipId, staffId, amount, currency, paidAt, method, reference`) → 014 (décaissement/dépense), 016 (notification), 025 ; `payroll.payslip.disputed` ; `payroll.payslip.cancelled` ; `payroll.session.validated|unvalidated` ; `payroll.claim.source_changed` (une séance réclamée a été modifiée dans sa source).

Consommés : `scheduling.session.cancelled|updated|deleted` (invalider la validation d'une séance non réclamée ; **alerter** si réclamée), `attendance.teacher_session.*` (rafraîchissement), `people.staff.deactivated`, `tenancy.tenant.provisioned` (réglages par pack), `academic.academic_year.closed` (clôture des périodes de l'année).

## 11. Tests

- **Recette T1-T20** (portabilité §15) rejouée telle quelle sur le nouveau cœur ; chaque test cite son identifiant.
- **Moteur pur** (golden, sans base) : salaire (prorata d'un mois entier, d'une demi-période, multi-mois), horaire (seuil exact, séance à cheval, multi-origines), mixte, arrondis (cas à la moitié exacte), ordre déterministe ; **différentiel contre `payment-calculator.ts`** sur des jeux dont les durées sont multiples de 0,25 h (écart nul) et documentation des écarts hors de ce cas (arrondi à la minute).
- **Contraintes de base** : `hour_claims` (deux bulletins ne réclament jamais la même heure, y compris en concurrence), `CHECK` de formule de ligne, `EXCLUDE` des tarifs et configurations, transitions de statut par trigger, journal append-only, `DELETE` refusés.
- **Concurrence** : deux calculs simultanés de deux périodes chevauchantes ; recalcul concurrent d'un même bulletin ; double approbation.
- **Sécurité** : matrice d'accès (gestion, propriétaire, enseignant titulaire, autre enseignant, étudiant, parent, autre tenant) × (liste, détail, données, PDF, notify) ; `/my/*` sans paramètre d'identité ; route de purge absente.
- **Ports** : contract tests des faux fournisseurs de 017/010/009 ; panne d'un port ⇒ calcul refusé avec message clair, jamais résultat partiel silencieux.
- **Performance** : 500 × 100 en ≤ 30 s ; vue d'ensemble de 300 enseignants ≤ 1 s.
- **Isolation et audit** : test générique spec 000 ; `expectAudited` pour chaque transition et chaque dérogation de durée.

## 12. Cas limites

(Reprise de la portabilité §12 + compléments.)

- Séance à cheval sur deux périodes : rattachée à la période contenant sa **date**, sans prorata. Séance hors de toute période : validable, payée quand une période la couvrira. Séance validée après clôture de la période : n'entre pas dans le bulletin clos ; signalée « validée hors période close ».
- Séance sans enseignant : jamais payable. Enseignant remplacé : payé à l'intervenant réel. Enseignant désactivé : ses séances validées restent dues (AC2.12).
- Suppression/annulation d'une séance déjà réclamée : refusée tant que le bulletin est `APPROVED`/`PAID` ; si la source (017) la modifie malgré tout, `payroll.claim.source_changed` alerte la gestion ; le bulletin n'est pas réécrit.
- Heures supplémentaires : seuil apprécié sur le cumul des deux origines.
- Configuration changeant en cours de période : la plus récente s'applique à toute la période (limite héritée ; rappel dans le compte rendu si deux configurations couvrent la période).
- Devise : une seule par établissement.
- Chevauchement d'horaires : signalé avant validation.
- Primes/retenues : saisie manuelle uniquement.
- Période sans aucune séance validée : aucun bulletin horaire ; les salariés sont tout de même calculés.
- Équité du calcul : un bulletin `CANCELLED` n'empêche pas d'en recalculer un nouveau pour la même période (nouvelle ligne, ancienne conservée).
- **Corrections après versement** : un bulletin `PAID` ne se modifie pas ; une erreur se corrige par une retenue/prime dans le bulletin suivant (pas de remboursement géré ici).
- **Fuseaux** : les semaines et jours ouvrés se calculent sur des **dates** (sans heure), indépendamment du fuseau du serveur (le legacy utilisait `getDay()` en fuseau local).
- **Données personnelles** : salaires = données sensibles ; lecture restreinte, export contrôlé et audité, aucune donnée de paie dans les journaux d'application.

## 13. Dépendances

- **En amont** : 000, 001 (features), 002 (RBAC, MFA), 003 (devise du `CountryProfile`), 004 (nœuds de curriculum pour tarifs et libellés), 009 (personnel : identités, statut actif, lien utilisateur), 010 (présences enseignants), 017 (séances, statut de réalisation, créneaux attendus, création d'une séance comptable), 013 (`DocumentRenderer`), 030 (audit), worker.
- **Exigences envers 017** : séance avec `status` (`PLANNED|HELD|CANCELLED`), `staff_id` réel, date, heures de début/fin, nœud, classe, marqueur `source` (`PLANNED|ACCOUNTING`), API de constat (`markHeld`, `markCancelled`), création de séance ad hoc, liste des créneaux attendus sans séance, événements `scheduling.session.*` ; **identifiants stables** (un changement d'identifiant ferait repayer des heures, inventaire tranche 2.7).
- **Exigences envers 010** : présence enseignant `COMPLETED` avec durée en minutes, `staff_id`, date, nœud, classe, lien éventuel vers la séance.
- **Exigences envers 009** : liste des membres payables avec statut, matricule, e-mail, lien compte utilisateur ↔ membre.
- **En aval** : 014/015 (décaissements), 016, 025, tableaux de bord owner (tranche 2.8).

## 14. Critères de sortie (mesurables)

1. Les 20 scénarios T1-T20 passent sur le nouveau cœur ; le script de vérification des 25 invariants du legacy (`verify-remuneration-031.js`) est porté en tests d'intégration et passe.
2. Le test de concurrence démontre qu'une heure ne peut être réclamée qu'une fois, avec deux périodes qui se chevauchent.
3. Le moteur pur donne les mêmes montants que `payment-calculator.ts` sur les jeux dont les durées sont multiples de 0,25 h, et tous les écarts hors de ce périmètre sont documentés.
4. L'accès à un bulletin par un autre compte que son titulaire ou la gestion est refusé dans la matrice complète.
5. `purge-dev`, `PATCH /:id/status` libre, l'utilisateur codé en dur et les flottants monétaires n'existent plus (grep CI).
6. Les tables `payment_periods`, `payment_period_teachers`, `teacher_payment_configs`, `teacher_payments`, `payment_hour_details`, `course_hourly_rates`, `professional_ecue_hourly_rates`, `teaching_hours`, `course_assignments`, les collecteurs `hour-collectors/*`, `payment-calculator.ts` et leurs routes sont supprimés dans la même tranche, **le filet d'audit des paiements restant en base** (plan §5.1).
