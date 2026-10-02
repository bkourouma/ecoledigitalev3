# Feature Specification: Pilotage de la direction et du propriétaire (025-analytics)

**Feature Branch**: `025-analytics`

**Created**: 2026-10-02

**Status**: Implémentée (module `apps/api/src/modules/analytics`, migrations `1600` et `1601`, écrans `/v2/owner/*`, `/v2/direction/*` et `/v2/analytics/*`) — points à arbitrer : §9 et §15

**Périmètre de cette spec** : partie A « direction / propriétaire » (read-models et tableaux de bord, §1 à §9) et partie B « indicateurs transverses et alertes de direction » (§10 à §15). Les alertes pédagogiques nominatives (`attendance.alert.*`) et les exports réglementaires restent à leurs modules.

**Sources** : `docs/guide-utilisateur-espace-proprietaire-owner.md`, `docs/statistiques-owner-requirements.md`, `docs/refonte-owner-menus-et-statistiques.md`, `docs/guide-tests-espace-proprietaire-owner.md` ; legacy à égaler fonctionnellement : `apps/api/src/routes/owner/index.ts`, `apps/api/src/services/owner-{pulse,pedagogie,scolarite,tresorerie,charges,finances,economie,resultat,caisse,assiduite,personnes,payroll-mass,…}.service.ts`, `apps/web/src/app/owner/*` ; modules fournisseurs `finance`, `results`, `academic`, `people`, `attendance`, `payroll`, `tenancy` ; `docs/architecture/module-conventions.md`, `platform-assembly.md` ; décisions : `specs/v2/DECISIONS-METIER.md`. Parité écran par écran : `parity.md`.

## 1. Objectifs

1. **Une seule vérité pour la direction** : les chiffres du propriétaire (effectifs, présence, résultats, scolarité, trésorerie, paie, charge d'enseignement) viennent de **read-models** dérivés des modules sources, jamais d'un calcul parallèle ni d'un SQL vers leurs schémas.
2. **Aucune formule métier dans `analytics`** : moyennes, rangs, crédits, mentions, décisions et validation viennent des résultats **FINAL** de `results` (eux-mêmes calculés par `rules`) ; recouvrement, retards et balance âgée viennent des requêtes de `finance` ; classification des présences et des inscriptions en scolarité vient d'`attendance` et d'`academic`. `analytics` **compte, regroupe, présente**.
3. **Fraîcheur explicite** : toute réponse porte `meta.asOf` (dernière vérification de la source), `stale` et `gaps`. Une source absente, en panne ou jamais lue est **déclarée**, jamais remplacée par un zéro (règle de non-invention héritée du legacy : « non mesuré » ≠ 0).
4. **Reconstruction idempotente** : tout read-model se reconstruit à l'identique depuis les sources (job nocturne, `POST /rebuild`), de sorte qu'un événement perdu ou un historique antérieur à `analytics` ne laisse aucun trou durable.
5. **Isolation et moindre privilège** : tenant-isolé par RLS ; périmètre établissement / campus de l'utilisateur appliqué à la lecture ; permissions granulaires ; MFA et audit pour la paie ; exports audités.
6. **Écrans accessibles et mobile-first** : chaque graphique a une alternative tableau ; l'état est dit en toutes lettres (jamais la couleur seule).

## 2. Périmètre

### Inclus

- Module `analytics` (schéma `analytics`) : file de rafraîchissement coalescée, état de fraîcheur, dimensions (périmètres, années, périodes, classes), faits d'inscriptions, de résultats FINAL (par inscription × période et par matière/UE), de présences (élèves par jour × classe, personnel par jour), de finance (synthèse, créances par classe et par apprenant, balance âgée, encaissements journaliers, sessions de caisse), de paie (masse par période et statut), de charge d'enseignement ; réglages d'affichage (seuils des feux, délai de fraîcheur).
- API `/api/v1/analytics/*` : `scopes`, `overview`, `enrollment`, `attendance`, `pedagogy/results`, `pedagogy/teaching-load`, `finance/summary`, `finance/receivables`, `treasury/{collections,aged,cash}`, `payroll/mass`, `charges`, `freshness`, `settings`, `rebuild`, `export/<jeu>.csv`.
- Abonnés (6, un par source) et jobs (`analytics.process-refreshes`, `analytics.nightly-rebuild`) du worker.
- Ports sources + adaptateurs de plateforme (`platform/adapters/analytics-sources.ts`).
- Écrans `/v2/direction` (tableau de bord), `/v2/direction/effectifs`, `/v2/owner/{pedagogie,scolarite,tresorerie,paie,charges}`.

### Exclu (renvoyé ou consigné comme manque)

| Sujet | Où / pourquoi |
|---|---|
| Charges, comptes de résultat, marges, saisie des dépenses | Aucun module de charges/comptabilité en v2 (specs 014/015) : endpoint `charges` qui **déclare** le manque ; voir `parity.md` |
| Valider une paie, gérer les rôles, acquitter des alertes | Actions : restent dans `payroll`, `rbac`/`iam`, `attendance` (écrans d'administration) |
| Classement nominatif d'élèves, élèves « à risque », absences nominatives | Données personnelles : non agrégées ici (liste nominative = créances seulement, sous `analytics.finance.read`) |
| Demandes d'inscription en ligne, prospection (CRM) | Pas de source v2 branchée ; l'entonnoir d'admission est lu sur les inscriptions (`sourceKind`) |
| Occupation des salles, conflits d'emploi du temps | `scheduling` : pas de port de lecture agrégé branché |
| PDF du rapport financier | CSV seulement (le rendu PDF est celui de `reportcards`/worker) |

## 3. Acteurs

| Acteur | Droits |
|---|---|
| Propriétaire (`owner`) | tout (`*`), MFA exigée pour la paie |
| Directeur (`directeur`) | tout sauf les exclusions de son modèle de rôle ; la paie exige la MFA |
| Autres rôles | aucun droit `analytics.*` par défaut (modèles de rôles inchangés) ; à accorder par rôle personnalisé |

## 4. Parcours et critères d'acceptation

### US1 — Tableau de bord de la direction
Voir d'un coup d'œil : effectifs, présence aujourd'hui, moyenne générale de la dernière période clôturée, enseignants présents, scolarité recouvrée, créances.
- AC1.1 Les cartes d'effectifs, de présence, de moyenne et d'enseignants viennent de `overview` ; scolarité et créances de `finance/summary` (appelé seulement si l'utilisateur détient `analytics.finance.read`).
- AC1.2 Chaque carte indique son état en toutes lettres (« Bon », « À surveiller », « Critique », « Non évalué ») d'après les seuils d'affichage de l'établissement (`settings`) ; sans seuil ou sans mesure : « Non évalué ».
- AC1.3 Une carte dont la source est absente affiche « Non mesuré » et la raison (`gaps`), jamais 0.
- AC1.4 L'en-tête affiche « Données au JJ/MM à HH:MM » (`asOf`) et signale `stale`.

### US2 — Effectifs et admissions
- AC2.1 Effectif en scolarité (classification d'`academic`) et total d'inscriptions, par statut, sexe, niveau, financement, campus et classe ; redoublants et taux.
- AC2.2 Entonnoir : inscriptions créées → confirmées → annulées, par source (`ADMISSION`, `MANUAL`…), et courbe mensuelle.
- AC2.3 Filtres établissement / campus / année / classe ; un utilisateur limité à un campus ne voit et ne peut demander que ce campus (403 sinon).

### US3 — Présence et assiduité
- AC3.1 Présence du jour et sur une fenêtre (30 jours par défaut) : pointages, présents, absents (dont justifiés), retards, minutes d'absence, taux ; par jour et par classe.
- AC3.2 Présence du personnel par jour (présents, absents, en congé approuvé).
- AC3.3 Seules les séances **soumises ou validées** comptent (même règle que le récapitulatif d'`attendance`).

### US4 — Pédagogie (résultats FINAL)
- AC4.1 Pour une période (par défaut la dernière période de l'année ayant des FINAL) : effectif classé, moyenne, minimum, maximum, validés, taux de validation — par classe, par matière/UE, et par période de l'année.
- AC4.2 Distribution des moyennes (histogramme d'**affichage** : échelle et largeur de classe en paramètres, jamais un seuil de réussite).
- AC4.3 Décisions de période et de fin d'année (passage, redoublement) telles que confirmées dans `results`.
- AC4.4 Matières les plus en difficulté (taux de validation) et poids de la session 2 (obtenus en session 2, éligibles au rattrapage).
- AC4.5 Un FINAL non encore clôturé n'apparaît pas (`classPeriodsNotFinal` le dit) ; une réouverture ne retire pas le FINAL officiel tant qu'une nouvelle clôture ne le remplace pas.
- AC4.6 Charge d'enseignement : heures prévues, classes, volume contractuel par enseignant (`people`).

### US5 — Scolarité
- AC5.1 Facturé, avoirs, encaissé, restant dû, en retard, taux de recouvrement, paiements non imputés — par année et campus.
- AC5.2 Créances par classe et par apprenant (nominatif, trié par reste dû, avec la plus ancienne échéance en retard).
- AC5.3 Les montants sont des entiers (FCFA) ; un taux non mesurable (rien à recouvrer) est `null`, pas 0 %.

### US6 — Trésorerie
- AC6.1 Courbe d'encaissements (jour / semaine / mois) sur une fenêtre, nets des remboursements, sans trou de seaux.
- AC6.2 Créances âgées (non échu, 1-30, 31-60, 61-90, > 90 jours) et principaux débiteurs.
- AC6.3 Écarts de caisse : sessions closes, nombre avec écart, écart net et écart absolu.

### US7 — Masse salariale (sensible)
- AC7.1 Par période de paie et par statut : bulletins comptés (calculés + arrêtés + payés), annulés et contestés **à part** ; total compté.
- AC7.2 Permission sensible : MFA exigée, chaque lecture et chaque export audités ; feature dédiée `analytics.payroll-insights`.

### US8 — Charges et résultat
- AC8.1 Tant qu'aucun module de charges n'existe, l'écran **le dit** (« module absent ») et ne montre aucun chiffre.

### US9 — Export, fraîcheur, reconstruction
- AC9.1 Export CSV de chaque jeu de données (BOM UTF-8, `;`, anti-injection de formule) : permission du jeu **et** `analytics.export` ; chaque export est audité avant livraison.
- AC9.2 `GET /freshness` : état de chaque genre de rafraîchissement (dernier succès, dernier échec, file).
- AC9.3 `POST /rebuild` met une reconstruction en file ; `analytics.nightly-rebuild` reconstruit chaque tenant ; rejouer donne le **même** contenu.

## 5. Dictionnaire des indicateurs

| Indicateur | Définition | Source (module, API publique) |
|---|---|---|
| Effectif en scolarité | inscriptions dont le statut ouvre la scolarité | `academic.listEnrollments`, `opensSchooling` |
| Répartition par sexe | sexe de la fiche élève | `people.getStudentsByIds` |
| Redoublants | `isRepeating` des inscriptions en scolarité | `academic` |
| Taux de présence | présents / pointages des séances soumises ou validées (points de base) | `attendance` (statuts : `countsAsPresent`…) |
| Moyenne, rang, validation, décision | valeur FINAL de l'inscription pour la période | `results.getClassMatrix` / `getFinalResult` (décisions confirmées) |
| Taux de validation | validés / (validés + non validés), `validated` du FINAL | `results` |
| Facturé, encaissé, restant dû, en retard, taux | requêtes de reporting de finance | `finance.getFinanceSummary`, `getReceivablesBy*`, `getAgedBalance`, `getCollectionsTrend` |
| Écart de caisse | compté − attendu | `finance.listSessionPage` |
| Masse salariale | totaux par période et statut | `payroll.ownerMass` |
| Charge d'enseignement | heures prévues, classes, volume contractuel | `people.getTeachingLoad` |

## 6. Fraîcheur

- `asOf` d'une réponse = plus ancienne des **dernières vérifications** (par genre : la passe réussie la plus récente) des sources qu'elle utilise ; une passe sans changement avance `asOf` sans réécrire (la donnée a été vérifiée).
- `stale` si `asOf` dépasse `settings.staleAfterSeconds` (24 h par défaut) ou si une source n'a jamais été lue.
- `gaps` : `NEVER_COMPUTED`, `NOT_WIRED` (port absent), `FAILED` (dernière lecture en échec : les chiffres sont ceux de la dernière réussite), `MODULE_MISSING`.
- Cache HTTP : `Cache-Control: private, max-age=15, must-revalidate`, `ETag`, 304 sur `If-None-Match` ; le web utilise TanStack Query avec la même durée.

## 7. Permissions, features, menus

| Permission | Donne accès à |
|---|---|
| `analytics.read` | `scopes`, `overview`, `enrollment`, `freshness`, `settings` (lecture) |
| `analytics.pedagogy.read` | `pedagogy/*` |
| `analytics.attendance.read` | `attendance` |
| `analytics.finance.read` | `finance/*` |
| `analytics.treasury.read` | `treasury/*` |
| `analytics.payroll.read` (**sensible**) | `payroll/mass` |
| `analytics.charges.read` | `charges` |
| `analytics.export` | export CSV (+ permission du jeu) |
| `analytics.settings.manage` | `PUT settings` |
| `analytics.rebuild` | `POST rebuild` |

Features : `analytics.direction` (toutes les routes), `analytics.payroll-insights` (paie). Menus (portail `owner`) : tableau de bord, effectifs et présences, pédagogie, scolarité, trésorerie, masse salariale, charges.

## 8. Exigences non fonctionnelles

- Lecture : agrégation SQL sur tables indexées du seul schéma `analytics`, transaction en lecture seule ; aucune requête n'attend une source.
- Écriture : une passe = lecture de la source hors transaction, puis remplacement du périmètre en **une** transaction avec l'état de fraîcheur et l'événement `analytics.snapshot.refreshed` (si le contenu a changé).
- Reprise : demande en échec rejouée avec délai exponentiel (15 s → 5 min), 5 tentatives, puis `FAILED` ; demande `RUNNING` abandonnée remise en file après 10 minutes.
- Sécurité : RLS forcée sur les 22 tables ; aucun SQL vers un autre schéma ; aucune clé étrangère hors `kernel.tenants` ; exports et paie audités.
- Accessibilité (web) : graphiques avec alternative tableau, état en texte, navigation clavier, contrastes en thèmes clair et sombre, libellés `fr-CI` sous `v2Owner*` / `v2Direction*`.

## 9. Décisions et points à arbitrer

1. **Seuils des feux** (présence 85/70 %, recouvrement 80/60 %) : repris du legacy comme **valeurs d'affichage par défaut** réglables par établissement (`PUT /settings`), pas comme règles. À valider avec le propriétaire du produit.
2. **Finance par campus** : les factures portent le campus de l'inscription ; une facture sans campus n'apparaît que dans la vue « tout l'établissement ». Un utilisateur limité à un établissement à plusieurs campus doit choisir un campus pour la finance (`422 campus_required`).
3. **FINAL officiel** : une période rouverte garde son FINAL tant que la nouvelle clôture ne le remplace pas (cohérent avec la lecture des familles) ; à confirmer.
4. **Rôles** : seuls `owner` et `directeur` reçoivent `analytics.*` (`*`) ; l'économe (finance/trésorerie) et le directeur des études (pédagogie, présence) n'y sont pas ajoutés (modèles de rôles = module `rbac`, PR dédiée).
5. **Mode de règlement, âge, nationalité, occupation des salles, état des bulletins** : indicateurs legacy sans port de lecture agrégé dans les modules v2 ; consignés dans `parity.md`.

---

# Partie B — indicateurs transverses et alertes de direction

## 10. Objectifs de la partie B

1. **Un seul écran de synthèse** (`/v2/analytics`) : effectifs et inscriptions, assiduité, résultats par période, recouvrement et impayés, admissions en entonnoir, vie scolaire agrégée, alertes ouvertes, charge de paie. Chaque bloc ne se lit que si l'utilisateur détient la permission de SES données.
2. **Aucun chiffre non officiel présenté comme tel** : tant qu'une période repose sur un jeu de règles de démonstration (`placeholder`), l'écran affiche le bandeau « règles de démonstration » ; une provenance illisible est dite aussi ; aucune alerte n'en dérive.
3. **Alertes configurables par établissement** : indicateur du catalogue, deux seuils (attention, critique), périmètre, **rôles destinataires**, fréquence maximale de rappel, accusé de réception, historique, anti-doublon.
4. **Livraison par `notifications`**, jamais directe : `analytics` publie `analytics.alert.raised` ; les préférences, consentements, heures calmes et plafonds restent ceux de `notifications`.
5. **Comparaisons** entre deux années, deux périodes ou deux fenêtres de dates, avec écart absolu et variation relative ; un côté non mesuré donne « Non mesuré », jamais zéro.
6. **Aucune donnée individuelle** : entonnoir et vie scolaire sont des comptages (aucune candidature, aucun élève, aucun motif, confidentialité STANDARD seulement) ; les alertes ne portent que des taux, montants et comptages agrégés.

## 11. Parcours et critères d'acceptation

### US10 — Indicateurs transverses (`/v2/analytics`)
- AC10.1 Les blocs effectifs, assiduité, résultats par période, recouvrement, admissions, vie scolaire, alertes et paie sont gardés par `analytics.read`, `.attendance.read`, `.pedagogy.read`, `.finance.read`, `.admissions.read`, `.schoollife.read`, `.alerts.read`, `.payroll.read` ; un bloc non permis n'est ni affiché ni demandé.
- AC10.2 Chaque bloc porte `asOf`, `stale` et `gaps` ; un indicateur sans mesure affiche « Non mesuré ».
- AC10.3 La masse salariale (sensible : MFA, lecture auditée) n'est lue qu'après une action explicite.
- AC10.4 Résultats : `rulesSource.demonstration` (au moins une classe-période FINAL lue repose sur un jeu `placeholder`) déclenche le bandeau ; chaque période de `byPeriod` porte son drapeau `demonstration`.

### US11 — Entonnoir d'admission (`GET /admissions/funnel`)
- AC11.1 Répartition **à ce jour** des dossiers par statut canonique (`DRAFT`…`ENROLLED`) et par étape de chaque campagne ; places offertes et restantes.
- AC11.2 `submitted` = dossiers hors brouillons ; `accepted` = acceptés + inscrits ; taux d'acceptation = accepté / déposé ; taux d'inscription = inscrit / accepté ; `null` si le dénominateur est nul.
- AC11.3 Lecture par comptage de colonnes (`admissions.getBoard`) ; les cartes de candidats ne sont ni conservées ni transmises. Un accès limité à un campus est refusé (403 : l'admission est suivie par établissement).

### US12 — Vie scolaire agrégée (`GET /schoollife/summary`)
- AC12.1 Quatre comptages : incidents ouverts, mesures à valider, exclusions en cours, convocations à tenir ; **confidentialité STANDARD uniquement** (fonction publique additive `schoollife.getAggregateCounts`, audience `STAFF_STANDARD`).
- AC12.2 Aucun identifiant d'élève, aucun texte libre, aucun élément restreint ou confidentiel ; la table `schoollife_facts` n'a aucune colonne personnelle.

### US13 — Comparaisons (`GET /compare/{enrollment,attendance,results,finance}`)
- AC13.1 `enrollment`, `finance` : deux années ; `results` : deux périodes (années éventuellement différentes) ; `attendance` : deux fenêtres de dates (≤ 800 jours chacune).
- AC13.2 Chaque indicateur renvoie `baseline`, `target`, `delta` (cible − référence) et `changeBps` ; `null` si un côté n'est pas mesuré ou si la référence est nulle.
- AC13.3 `results` : le drapeau `demonstration` de chaque côté est transmis (bandeau).

### US14 — Alertes de direction
- AC14.1 **Configuration** (`analytics.alerts.manage`) : indicateur du catalogue (§12), seuils d'attention et critique dans l'unité de l'indicateur (aucune valeur par défaut), fenêtre pour les indicateurs fenêtrés, périmètre établissement / campus, 1 à 8 rôles destinataires, fréquence `HOURLY`/`DAILY`/`WEEKLY`/`MONTHLY`, activation. Contrôle de version optimiste (409 sur conflit) ; création et modification auditées.
- AC14.2 **Évaluation** par le job `analytics.evaluate-alerts` (toutes les 15 min), sur les read-models. Franchissement **strict** (une valeur égale au seuil n'alerte pas). Aucune évaluation ni résolution sur une donnée jamais lue, périmée, non branchée ou en échec (`SOURCE_UNAVAILABLE`), ni sur une valeur non mesurée (`NOT_MEASURED`) ; un taux de validation issu de règles de démonstration n'est pas mesuré.
- AC14.3 **Alerte** = épisode de dépassement ; une seule alerte active par règle. Montée en gravité : notification ; baisse : silencieuse. Retour dans les seuils : alerte `RESOLVED` (événement `analytics.alert.resolved`), historique conservé ; une rechute ouvre une nouvelle alerte.
- AC14.4 **Livraison** : `analytics.alert.raised` (outbox, même transaction) ; `notifications` résout les destinataires **par les rôles de l'alerte**, applique préférences, consentements, heures calmes et plafonds. Le message ne dit que l'indicateur, la valeur, le seuil et pointe `/v2/analytics/alertes`.
- AC14.5 **Anti-doublon** : clé UNIQUE `règle:gravité:créneau` (créneau = heure, jour, semaine ISO ou mois) ; deux évaluations simultanées ou rejouées n'émettent qu'une notification par créneau ; `notifications` déduplique à son tour sur cette clé.
- AC14.6 **Accusé de réception** (`analytics.alerts.acknowledge`) : qui, quand, note (≤ 500 caractères), audité, événement `analytics.alert.acknowledged` ; les rappels s'arrêtent tant que la gravité ne monte pas ; accuser une alerte résolue : 409.
- AC14.7 **Visibilité** : une alerte n'existe pour l'appelant que si la permission de données de son indicateur lui est accordée et si son périmètre est dans le sien (un utilisateur limité à un campus ne voit ni ne crée de règle sur l'établissement entier) ; sinon **404 uniforme** (inexistante, hors périmètre, non permise, identifiant mal formé : indiscernables).

### US15 — Exports et rafraîchissement
- AC15.1 Jeux CSV `admissions-funnel`, `schoollife-summary`, `alerts-history` (permission du jeu **et** `analytics.export`, audité, BOM, `;`, neutralisation des formules : tout texte débutant par `=`, `+`, `-`, `@`, tabulation ou retour chariot est préfixé d'une apostrophe, y compris les libellés de règles et les notes d'accusé de réception saisis par les utilisateurs).
- AC15.2 Deux nouveaux genres de rafraîchissement, `ADMISSIONS` et `SCHOOLLIFE`, alimentés par les événements `admissions.*` et `schoollife.*` (abonnés `analytics.refresh-on-admissions`, `analytics.refresh-on-schoollife`), le job `analytics.process-refreshes` et la reconstruction nocturne.

## 12. Catalogue des indicateurs d'alerte

| Indicateur | Unité | Sens | Fenêtre | Permission de données | Genres lus |
|---|---|---|---|---|---|
| `ATTENDANCE_RATE` | points de base | sous le seuil | 30 j par défaut | `analytics.attendance.read` | ATTENDANCE, CALENDAR |
| `COLLECTION_RATE` | points de base | sous le seuil | — | `analytics.finance.read` | FINANCE, CALENDAR |
| `OVERDUE_AMOUNT` | unités mineures | au-dessus | — | `analytics.finance.read` | FINANCE, CALENDAR |
| `VALIDATION_RATE` (dernière période clôturée, règles officielles seulement) | points de base | sous le seuil | — | `analytics.pedagogy.read` | RESULTS, CALENDAR |
| `ENROLLMENT_IN_SCHOOLING` | nombre | sous le seuil | — | `analytics.read` | ENROLLMENT, CALENDAR |
| `CASH_VARIANCE` (somme des écarts absolus des sessions closes) | unités mineures | au-dessus | 30 j par défaut | `analytics.treasury.read` | CASH |
| `SCHOOLLIFE_OPEN_INCIDENTS` | nombre | au-dessus | — | `analytics.schoollife.read` | SCHOOLLIFE |
| `SCHOOLLIFE_MEASURES_TO_VALIDATE` | nombre | au-dessus | — | `analytics.schoollife.read` | SCHOOLLIFE |

La masse salariale n'est **pas** surveillable par une alerte (donnée sensible : MFA et audit de chaque lecture).

## 13. Permissions, menus et événements de la partie B

| Permission | Donne accès à |
|---|---|
| `analytics.admissions.read` | `admissions/funnel`, export `admissions-funnel` |
| `analytics.schoollife.read` | `schoollife/summary`, export `schoollife-summary`, alertes de vie scolaire |
| `analytics.alerts.read` | `alerts`, `alerts/:id`, `alerts/rules`, `alerts/metrics`, export `alerts-history` |
| `analytics.alerts.acknowledge` | `POST alerts/:id/acknowledge` |
| `analytics.alerts.manage` | `POST/PUT alerts/rules` |

Les comparaisons exigent la permission de données de leur domaine (`analytics.read`, `.attendance.read`, `.pedagogy.read`, `.finance.read`). Fonctionnalité : `analytics.direction` pour toutes les routes. Menus (portail `owner`) : indicateurs, admissions, vie scolaire, comparaisons, alertes, règles d'alerte.

Événements publiés : `analytics.alert.raised`, `analytics.alert.acknowledged`, `analytics.alert.resolved` (charges versionnées, schémas `analyticsEventPayloadSchemas`). Consommés en plus : `admissions.application.{submitted,status_changed,enrolled,anonymized}`, `admissions.decision.recorded`, `admissions.offer.{accepted,declined,expired,withdrawn}`, `admissions.waitlist.promoted`, `admissions.prospect.converted`, `schoollife.incident.{declared,status_changed}`, `schoollife.measure.*`, `schoollife.appeal.decided`, `schoollife.convocation.{sent,held,missed,cancelled}`.

## 14. Exigences non fonctionnelles de la partie B

- Les alertes lisent **uniquement** les read-models d'`analytics` (aucun SQL vers un autre schéma) ; seuls les ports sources lisent les modules fournisseurs, par leurs API publiques (`admissions.listCampaigns/getBoard`, `schoollife.getAggregateCounts`, `results.getPeriodView` pour la provenance des règles).
- Une évaluation = une transaction par règle, verrou `FOR UPDATE` sur la règle : deux évaluations simultanées se sérialisent.
- RLS forcée sur les 6 nouvelles tables (28 au total) ; test A/B (lecture, acquittement, modification et écriture croisée refusés).
- Accessibilité : états et gravités en texte, tableaux légendés, formulaires reliés, strict axe-core sans violation ; libellés `fr-CI` sous `v2Analytics`.

## 15. Points à arbitrer (partie B)

1. **Seuils** : aucun seuil par défaut n'est livré (ce sont ceux de l'établissement). À confirmer avec le propriétaire du produit si des modèles de règles (« présence < 85 % ») doivent être proposés en un clic.
2. **Rôles destinataires** : les rôles sont saisis par clés (propositions : rôles du système + clés personnalisées). Aucune vérification d'existence du rôle n'est faite par `analytics` (pas de port `rbac`) : une clé inconnue ne notifie personne. À arbitrer : exposer un port de lecture des rôles.
3. **Attribution des permissions aux rôles** : voir le README du module (§ « Permissions à attribuer »).
4. **Évaluation à la demande** : l'évaluation n'a lieu que par le job (15 min). Un bouton « évaluer maintenant » est possible mais enverrait de vraies notifications ; non livré.
5. **Alertes de paie** : exclues (donnée sensible).
6. **Dépassement strict** et **créneaux en UTC** (Abidjan = UTC+0) : à confirmer si un établissement est un jour hébergé hors de ce fuseau.
