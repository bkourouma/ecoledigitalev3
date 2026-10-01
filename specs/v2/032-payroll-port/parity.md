# Parité legacy — 032-payroll-port

**Périmètre** : toute la rémunération des enseignants décrite par la spec 031 et la portabilité (`docs/module-remuneration-portage-nouvelle-stack.md`). Les numéros T1-T20 renvoient à §15 de ce document ; les « dix erreurs à ne pas refaire » (§17) sont reprises en §7 ci-dessous.

Statuts : **Conservé** (même comportement), **Amélioré** (comportement identique, défaut corrigé, détaillé), **Abandonné** (non reproduit), **Reporté** (autre spec). Lignes : état au 2026-10-01 (`feat/v2-phase-0`).

Tables legacy remplacées (tranche 2.7 / Phase 3) : `payment_periods`, `payment_period_teachers`, `teacher_payment_configs`, `teacher_payments`, `payment_hour_details`, `course_hourly_rates`, `professional_ecue_hourly_rates`, `teaching_hours`, `course_assignments`, `payment_audit_log` (remplacé, le filet de triggers est reconduit sur `payslips`). Fichiers supprimés : `payment-calculator.ts`, `hour-collectors/*`, `professional-seance-validation.service.ts`, `professional-ecue-rates.service.ts`, `teacher-payroll-overview.service.ts`, `teacher-payslip*.service.ts`, `owner-payroll*.service.ts`, `routes/{teacher-payments,payment-periods,teacher-payment-configs,payment-reports,professional-remuneration,course-hourly-rates,course-assignments,teaching-hours*,simple-payment-periods}.ts`.

## 1. Moteur de calcul — `payment-calculator.ts`

| ID | Fonction (ligne) | Comportement | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-PAY-01 | `computePayment` (`:104`) — aiguillage `salary/hourly/mixed` | Moteur **pur** | **Conservé** | `payroll/domain/calculation` (pur, sans E/S) | Première chose à porter (portabilité §13). |
| P-PAY-02 | `calculateSalaryPayment` (`:118`) : `mensuel \|\| annuel/12`, `prorata = jours ouvrés période / jours ouvrés standard du MOIS DE DÉBUT`, aucune ligne de détail | Salaire au prorata | **Amélioré** | Prorata **mois par mois**, entiers, arrondi demi-supérieur ; formule identique sur un mois civil | Défaut : une période de plusieurs mois est ramenée au mois de début (`:360-371`) ; `getDay()` en fuseau local (Q-27). |
| P-PAY-03 | `calculateHourlyPayment` (`:158`) : semaine par semaine, `cumul`, `overtime = max(0, min(durée, cumul − seuil))`, ligne normale + ligne majorée, `taux × multiplicateur` | Heures supplémentaires hebdomadaires sur le cumul **des deux origines** | **Conservé** | Même algorithme en entiers/minutes ; ordre total déterministe | Séance à cheval ⇒ deux lignes (AC3.2). |
| P-PAY-04 | Montants en flottants JS (`amount = hours × rate`), colonnes `numeric(10,2)` | Arrondis implicites | **Amélioré** | `bigint` XOF + minutes + `floor((m×t×mult+30000)/60000)` | ADR-007. Écart ≤ 0,5 F par ligne par rapport à des durées décimales à 2 chiffres ; nul pour des durées multiples de 0,25 h. |
| P-PAY-05 | `calculateMixedPayment` (`:285`) : salaire + horaire | Mixte | **Conservé** | Mixte | |
| P-PAY-06 | `toDetailLine` (`:314`), `sumBySource` (`:338`) | Lignes avec origine, `hoursBySource` | **Conservé** | `payslip_lines` + `minutes_by_source` du compte rendu | |
| P-PAY-07 | `calculateWorkingDays` (`:348`), `getStandardWorkingDaysInMonth` (`:360`) : lundi-vendredi, fuseau du serveur | Jours ouvrés | **Amélioré** | Calcul sur des **dates** UTC, lundi-vendredi ; jours fériés non gérés (Q-27) | |
| P-PAY-08 | `groupHoursByWeek` (`:373`), `getWeekStart` (`:388`) : lundi, tri par date seulement | Regroupement hebdomadaire | **Conservé** (+ tri total) | Même semaine lundi ; ordre `(date, heure de début, origine, id)` | Le tri par date seule laissait l'ordre des séances d'un même jour au hasard : la coupure au seuil n'était pas déterministe. |
| P-PAY-09 | `calculateBatchPayments` (`:408-613`) : période, enseignants **actifs**, **une requête par origine**, tarifs préchargés, regroupement, configuration, `NO_CONFIG / NO_HOURS / NO_RATE_RESOLVED`, calcul | Orchestration | **Conservé** (flux) / **Amélioré** (détails) | Cas d'usage `calculate` + collecteurs derrière ports | Voir lignes suivantes. |
| P-PAY-10 | Filtre `t.status = 'active'` (`:466-468`) | Enseignants inactifs ignorés | **Amélioré** | Inactifs inclus **s'ils ont des heures validées non payées** (Q-40) | Écart code ↔ spec 031 (cas limites) ; le workflow doc le décrit comme « vérifier avant de désactiver ». |
| P-PAY-11 | Sélection de la configuration `effective_from ≤ fin ∧ (effective_to nulle ∨ ≥ début) ORDER BY effective_from DESC LIMIT 1` (`:520-532`) | Configuration retenue | **Conservé** | Idem ; limite documentée | |
| P-PAY-12 | `config.configType === "hourly" && teacherHours.length === 0` ⇒ `NO_HOURS` (`:556-565`), commentaire « sans heure validée pas de bulletin » | Pas de bulletin à zéro | **Conservé** | R-PAY-11 | |
| P-PAY-13 | `resolveRate` (`:615`) : ECUE → tarif ECUE ; académique → tarif **par cours** ; sinon `defaultHourlyRate` ; salarié ⇒ 0 ; sinon `null` (anomalie) | Résolution du tarif | **Amélioré** | Ordre figé unique pour toutes les origines (nœud+enseignant → nœud générique → défaut → 0/anomalie), **à la date de la séance** | `loadCourseRates` (`:637`) ignorait la date de la séance et le tarif nominatif académique (map par cours avec les bornes de la période). |
| P-PAY-14 | `mapConfigFromDb` (`:660`) : `row.default_hourly_rate ? parseFloat : undefined`, `parseInt(...) \|\| 40`, `parseFloat(...) \|\| 1.5` | Valeurs par défaut du code (40 h, 1,5) et **0 traité comme absent** | **Amélioré** | Défauts en `payroll.settings`, `0` est une valeur valide | Constantes de code supprimées. |
| P-PAY-15 | Erreur de calcul d'un enseignant ⇒ rangé en `NO_CONFIG` avec le message d'erreur (`:603-608`) | Mauvais motif | **Amélioré** | Issue `FAILED` distincte | |

## 2. Collecteurs d'heures — `hour-collectors/*`

| ID | Fonction (fichier:ligne) | Comportement | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-PAY-20 | `HourCollector` / `HourRecord` / `HourCollectionScope` (`types.ts:1-80`) | Abstraction : une 3ᵉ origine s'ajoute sans toucher au calcul | **Conservé** | Interface `HourCollector` identique (origines `SESSION`, `ATTENDANCE`) | |
| P-PAY-21 | `AcademicHourCollector` (`academic-hour-collector.ts:44-62`) : `teacher_attendance_sessions → teacher_assignments → class_courses → courses`, `status = 'completed'`, `duration_hours` | Origine académique | **Amélioré** | `AttendanceHourCollector` lit **010** via `TeacherAttendancePort` (minutes entières) | Plus de jointure SQL inter-modules. |
| P-PAY-22 | `ProfessionalHourCollector` (`professional-hour-collector.ts:48-59`) : `professional_ecue_seances` + `SEANCE_PAYABLE_PREDICATE` + `DUREE_PAYEE_SQL` + `heureDejaPayeeSQL` | Origine professionnelle | **Amélioré** | `SessionHourCollector` lit **017** via `SessionHoursPort` + `session_validations` (payabilité TS unique) | |
| P-PAY-23 | `SEANCE_PAYABLE_PREDICATE`, `SEANCE_PRETE_A_VALIDER_PREDICATE`, `DUREE_PAYEE_SQL` (`professional-seance-validation.service.ts:46-92`) | Prédicats exportés « une seule fois » en SQL | **Conservé** (principe) | `payroll/domain/payability.ts` (TypeScript pur, importé partout) | AC1.2 + test d'architecture. |
| P-PAY-24 | `heureDejaPayeeSQL` (`heures-consommees.ts`) : `NOT EXISTS` sur `payment_hour_details` ∧ `teacher_payments.status <> 'cancelled'` ∧ période différente | Heures consommées par **prédicat** (fragile avec périodes qui se chevauchent) | **Amélioré** | Table `hour_claims` à clé primaire `(origine, source, enseignant)` | Constraint-based : deux calculs concurrents ne peuvent plus payer deux fois. |
| P-PAY-25 | Les deux FK de `payment_hour_details` en `RESTRICT` ; `teaching_hours_id` « toujours NULL — vestige de schéma » ; FK `teaching_hours` qui rendait le chemin académique inopérant avant `0103` | Dérives de schéma (`_constat.txt`) | **Abandonné** (le vestige) | Schéma propre ; `RESTRICT` conservé via `hour_claims` | |
| P-PAY-26 | `teaching_hours` « EST VIDE sur cette base » ; `POST /teaching-hours/from-assignments` | Second chemin d'heures jamais lu par le calcul | **Abandonné** | — | Confirmer en base avant suppression (inventaire 2.7). |

## 3. Validation des séances — `professional-seance-validation.service.ts`, `routes/professional-remuneration.ts`

| ID | Fonction (ligne) | Comportement | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-PAY-30 | `listSeances` (`:235`) : filtres enseignant/cohorte/matière/filière/dates/année/statut/validées/payables/présences ; agrégats serveur ; tri « passé d'abord » | Liste paginée + compteurs sur tout le périmètre | **Conservé** | `GET /sessions` (agrégats serveur) | AC1.9-1.10 (T19). |
| P-PAY-31 | `computeBlockers` (`:181`), motifs `STATUT_NON_REALISEE`, `SANS_ENSEIGNANT`, `HORAIRES_INCOMPLETS`, `DEJA_PAYEE` | Motifs de blocage | **Conservé** | Mêmes codes | |
| P-PAY-32 | `getSeance` (`:375`), `listAnneesScolaires` (`:411`), `listEnseignantsATraiter` (`:435`) | Fiche, options de filtres venant du serveur | **Conservé** | `GET /sessions/:id`, `/sessions/filters` | Année = `academic_year_id`, plus un calcul « pivot septembre » en SQL (`ANNEE_SCOLAIRE_SQL`). |
| P-PAY-33 | `setStatut` (`:462`) : `planifiee → realisee/annulee`, traçabilité | Constat de réalisation | **Conservé** (via 017) | `PATCH /sessions/:id/status` → API de 017 | Le statut est un fait pédagogique de 017. |
| P-PAY-34 | `validateBatch` (`:510`) : lot ≤ 500, application partielle, `{ nb_mises_a_jour, rejets[] }` | Validation en lot | **Conservé** | `POST /sessions/validate` | T13. |
| P-PAY-35 | `setDureePayee` (`:588`) : dérogation ; égale au prévu ⇒ retirée ; `null` retire ; refus si sans horaires | Dérogation de durée | **Conservé** | `PATCH /sessions/:id/duration` | |
| P-PAY-36 | `createSeanceComptable` (`:646`) : ECUE doit appartenir à l'UE de la cohorte ; créée `realisee`, non validée | Séance oubliée | **Conservé** | `POST /sessions` → création via 017 (`source = ACCOUNTING`) | |
| P-PAY-37 | `findSeancesManquantes` (`:726`) | Rapprochement emploi du temps ↔ séances | **Conservé** | `GET /sessions/missing` (port 017) | |
| P-PAY-38 | `findOverlaps` (`:797`) | Chevauchements d'horaires | **Conservé** | `GET /sessions/overlaps` | |
| P-PAY-39 | `isLocked` (`:857`) : verrou si bulletin `approved`/`paid` | Verrou de dévalidation/suppression | **Conservé** | Déclencheur `session_validations_guard` + `hour_claims` `RESTRICT` | |

## 4. Tarifs, configuration, périodes

| ID | Fonction (fichier:ligne) | Comportement | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-PAY-40 | `professional-ecue-rates.service.ts` (`list` `:55`, `create` `:100`, `update` `:147`, `remove` `:200`, `resolve` `:214`, `preloadForPeriod` `:236`, `EcueRateIndex` `:265`) | Tarifs ECUE, résolution, préchargement en index mémoire, simulateur | **Conservé** | `hourly_rates`, `GET /rates/resolve`, index mémoire pour le calcul | Un seul référentiel (nœud). |
| P-PAY-41 | `routes/course-hourly-rates.ts` (801 l.) | Tarifs académiques par cours | **Amélioré** | Fusionnés dans `hourly_rates` | |
| P-PAY-42 | `routes/teacher-payment-configs.ts` (`GET /` `:11`, `/:id` `:192`, `/teacher/:teacherId/current` `:303`, `POST` `:460`, `PUT` `:658`, `DELETE` `:853`) | CRUD des configurations, configuration courante | **Conservé** | `/configs` | Suppression refusée si un bulletin la cite. |
| P-PAY-43 | État de configuration `active/expiree/future/absente` (`teacher-payroll-overview.service.ts:38`) | Calculé | **Conservé** | Lecture de la vue d'ensemble | Piège de production n°8 (portabilité). |
| P-PAY-44 | `routes/payment-periods.ts` (`GET` `:18`, `POST` `:245`, `PUT` `:577`, `PATCH status` `:737`, `DELETE` `:933`) ; `payment_periods_no_overlap` | Périodes ; anti-chevauchement déclaré mais absent en base puis **autorisé** (0112) | **Conservé** (chevauchement autorisé) | `pay_periods` + `hour_claims` | |
| P-PAY-45 | `POST /payment-periods/purge-dev` (`:840`) | Purge de données de développement | **Abandonné** | — | R-PAY-17 : aucune route de purge en production. |
| P-PAY-46 | Période en attente de calcul (`periodeEnAttente`, `teacher-payroll-overview.service.ts:686`) | Une seule à la fois | **Conservé** | `GET /periods/pending` + garde en base | |
| P-PAY-47 | `payment_period_teachers` (`0106`/`0107`) : périodes ciblées multi-enseignants | Ciblage | **Conservé** | `pay_period_targets` | Suppression interdite d'un enseignant ciblé. |
| P-PAY-48 | Calcul : en-tête obligatoire `x-academic-year-id`, ne voit que les périodes de cette année | Contexte d'année | **Amélioré** | `academic_year_id` obligatoire sur la période | `payment_periods.academic_year_id` était nul partout (`owner-payroll-mass.service.ts`). |

## 5. Bulletins, états, versement — `teacher-payments.ts`, `teacher-payroll-overview.service.ts`

| ID | Fonction (fichier:ligne) | Comportement | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-PAY-50 | `POST /calculate` (`teacher-payments.ts:428`) : `periodId`, `teacherIds`, `recalculate`, `scope`, `dryRun` ; un bulletin par (enseignant, période, type) ; recalcul = `DELETE` + `INSERT` du détail | Calcul, recalcul idempotent | **Conservé** | `POST /periods/:id/calculate` | T5, T6, T17. |
| P-PAY-51 | Compte rendu (`skipReason`, `hoursBySource`) | Écartés nommés | **Conservé** (+ persistance) | `calculation_runs/items` | Le détail disparaissait après « Générer » (S17-T constat 4). |
| P-PAY-52 | `POST /approve` (`:946`), `POST /bulk-action` (`:1051`) : `approve / reject / mark_paid / cancel` | Actions de masse | **Conservé** (+ garde) | `/payslips/approve`, `/pay`, `/cancel` ; `{ all: true }` explicite | T20, liste vide ≠ tout. |
| P-PAY-53 | `PATCH /:id/status` (`:1427`) : **tout statut accepté**, `userId = "634a57fe-…" // TODO: Get from auth` codé en dur | Transition libre, auteur factice | **Abandonné** | Transitions imposées par trigger ; auteur = utilisateur authentifié | Défaut grave : `paid → calculated` possible, journal faux. |
| P-PAY-54 | `GET /` (`:18`), `GET /:id` (`:224`), `POST /` (`:411`), `GET /summary` (`:1200`), `PATCH /:id/adjustments` (`:1329`) | Liste, détail, création manuelle, synthèse, primes/retenues | **Conservé** (+ lignes d'ajustement) | `/payslips`, `/payslips/:id/adjustments` | La création manuelle d'un bulletin sans calcul est **abandonnée** (un bulletin sort toujours d'un calcul). |
| P-PAY-55 | `archiverBulletins` (`teacher-payroll-overview.service.ts:497`) : `archive_le/par`, statut `approuve`, `approuve_par` conservé s'il existe ; idempotent | Arrêt du montant | **Conservé** | `approve` | T14. |
| P-PAY-56 | `marquerVerses` (`:555`) : seulement `approuve` ; `paye_le/par` | Versement distinct | **Conservé** | `pay` | T15. Constat 35 bulletins « payés » à tort par l'archivage (portabilité §2). |
| P-PAY-57 | `historiqueBulletins` (`:594`) : archivés, auteur figé | Historique | **Conservé** | `/history`, `/history/export` | |
| P-PAY-58 | `listEnseignants` (`:374`) : tous les enseignants, état de configuration, heures de la période courante, séances à valider, bulletin courant, archivés | Vue d'ensemble | **Conservé** | `GET /staff` | |
| P-PAY-59 | Statuts `calculated, approved, paid, disputed, cancelled, unpaid` (enum à 6 valeurs ; « unpaid » ≈ approuvé affiché « Impayé », `0113`) | Statuts hétérogènes | **Amélioré** | 5 statuts ; « Impayé » = libellé de `APPROVED` | |
| P-PAY-60 | `payment_audit_log` + triggers (`0109`→`0111`) : auteur figé, survie à la suppression du bulletin | Journal | **Conservé** | `payslip_events` + `audit.audit_log` | Piège n°5. |
| P-PAY-61 | Statut `disputed` | Contestation | **Conservé** | `DISPUTED` avec motif | |

## 6. Bulletin PDF, accès, owner — `teacher-payslip*.service.ts`, `owner-payroll*.service.ts`

| ID | Fonction (fichier:ligne) | Comportement | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-PAY-70 | `getPayslipData` (`teacher-payslip.service.ts:124`), `generatePdf` (`:230`), `teacher-payslip-template.service.ts` (670 l.) | Données et PDF du bulletin ; **aucun calcul** dans le générateur | **Conservé** | Snapshot figé à l'arrêt du montant + rendu 013 (`PAYSLIP`) | « Séparer la collecte de la mise en page ». |
| P-PAY-71 | PDF : base de calcul sans tableau de détail (S17-02 « voulu ») ; portabilité §9 prévoit le détail par séance | Contradiction de documents | **Amélioré** | Option de gabarit `show_detail_lines` (défaut non) | Un vacataire peut cumuler 300 séances. |
| P-PAY-72 | Repli « IMHOTEP ACADEMY (EXASP CI) » + contact (`teacher-payslip.service.ts:91-92`) et charte/pied de page IPAM (`teacher-payslip-template.service.ts:38-60`) imprimés sur le PDF d'un autre tenant (S17-03) | Branding en dur | **Abandonné** | Branding par tenant (013) | |
| P-PAY-73 | `peutLireBulletin` / `appartientA` (`teacher-payments.ts:1502+`, `teacher-payslip.service.ts:108`), commit `1dbb34f` : gestion (admin, super_admin, administrateur, owner) lit tout ; autre rôle ne lit que ses bulletins ; `notify` réservé à la gestion | Restriction d'accès au bulletin | **Conservé** | Permissions `payroll.payslip.read` / `.read_own` / `.notify` + vérification de propriété dans le cas d'usage | Liste de rôles en dur remplacée par RBAC. |
| P-PAY-74 | `POST /:id/notify` (`:1577`) | E-mail du bulletin | **Conservé** (événement) | 016 consomme `payroll.payslip.approved|paid` ; envoi gestion | |
| P-PAY-75 | `validateTeacherPaymentAsOwner` (`owner-payroll.service.ts`) : `calculated → approved` réservé à l'owner, `409` si autre statut, audit par trigger | Validation owner | **Conservé** | `approvePayslips` (même cas d'usage) + `/owner/payslips/:id/validate` | AC7.1. |
| P-PAY-76 | `owner-payroll-mass.service.ts` : masse salariale par **période** (pas par mois), statuts comptés `calculated/approved/paid/unpaid` ; `cancelled`/`disputed` hors total mais **montrés à part** ; année par repli sur le milieu de l'intervalle ; pas de taux horaire publié | Vue owner | **Conservé** (+ année explicite) | `GET /owner/mass` | AC7.2-7.3. |
| P-PAY-77 | `routes/payment-reports.ts` (`/summary` `:11`, `/teacher/:teacherId` `:347`, `/period/:periodId` `:587`, `/export/:format` `:824`, `/list` `:998`, `PATCH /:paymentId/status` `:1137`) | Rapports, filtre d'origine, export CSV (`Montant Academique`, `Montant Professionnel`) | **Conservé** (sauf `PATCH status`) | `/reports/*` | Ventilation à trois postes T18 ; le second `PATCH /:paymentId/status` est abandonné (même défaut que P-PAY-53). |
| P-PAY-78 | Espace enseignant `GET /remuneration/my/seances`, `/my/payments` ; `teacherId` dérivé du jeton | Espace personnel | **Conservé** | `/my/*` | T16. |

## 7. Les dix erreurs à ne pas refaire (portabilité §17) — où elles sont évitées

| # | Erreur | Évitée par |
|---|---|---|
| 1 | Recopier un prédicat métier | `payability.ts` unique + test d'architecture |
| 2 | Confondre archiver et verser | Trois actes, trois dates, `CHECK paid_at ⇒ approved_at`, trigger |
| 3 | Agrégats sur la page affichée | Compteurs serveur sur tout le périmètre (AC1.9) |
| 4 | Laisser l'écran énumérer les identifiants d'une action de masse | `{ all: true, periodId }` ; liste vide ≠ tout |
| 5 | Jointure vers les utilisateurs pour l'audit | `actor_name` figé |
| 6 | Écarter un enseignant sans dire pourquoi | `calculation_run_items` conservés |
| 7 | Ne montrer que les enseignants configurés | `GET /staff` sur tout le personnel payable |
| 8 | Traiter « configuration expirée » comme « configuration » | État calculé à quatre valeurs |
| 9 | Trier par date décroissante seule | Passé d'abord, futur ensuite |
| 10 | Déclarer les routes paramétrées avant les statiques | Chemins statiques d'abord (revue de plugin) |

## 8. Défauts du legacy volontairement NON reproduits

1. `PATCH /:id/status` à statut libre avec utilisateur codé en dur ; création manuelle de bulletin sans calcul.
2. Route de purge de données de développement.
3. Montants flottants, durées décimales à 2 chiffres, défauts de code (40 h, 1,5), `0` assimilé à « absent ».
4. Unicité d'une heure payée par simple prédicat de requête.
5. Tarifs académiques sans date de séance ni nominatif.
6. Prorata de salaire borné au mois de début ; `getDay()` en fuseau local.
7. Tri des heures par date seule (coupure au seuil non déterministe).
8. Enseignants inactifs ignorés alors que la spec les paie.
9. Compte rendu de calcul perdu après l'écran.
10. Identité d'établissement et charte graphique d'un tenant codées en dur sur le bulletin ; `academic_year_id` nul ; liste de rôles « comptables » codée en dur.
