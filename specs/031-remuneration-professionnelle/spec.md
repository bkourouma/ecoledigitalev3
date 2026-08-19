# Feature Specification: Rémunération des enseignants — Module Professionnel (UE/ECUE)

**Feature Branch**: `031-remuneration-professionnelle`

**Created**: 2026-08-18

**Status**: Draft

**Input**: Demande utilisateur — « voir comment le module de rémunération fonctionne au niveau des enseignants et l'adapter au module professionnel afin qu'il fonctionne parfaitement » + analyse de l'existant (`apps/web/src/app/payments/*`, `payment-calculator.ts`, migrations `0011`/`0069`/`0070`).

## Contexte

La plateforme dispose d'un module **Rémunération Enseignants** complet
(6 écrans : Périodes de Paiement, Configuration Enseignants, Validation des
Heures, Calcul des Paiements, Gestion des Paiements, Rapports Enseignants).
Ce module ne sait compter que les heures de l'**Académique** : sa source
d'heures est la chaîne `séance de présence enseignant → affectation → cours de
classe`.

Le **Module Professionnel** (feature 030) a sa propre chaîne pédagogique —
`Filière → UE → ECUE`, avec des **séances d'ECUE** planifiées au sein d'une
**cohorte d'UE** et des enseignants affectés **par ECUE et par cohorte**. Ces
séances ne sont jamais vues par le moteur de calcul : **un enseignant qui
n'intervient qu'en professionnel est aujourd'hui rémunéré 0**.

Le point d'ancrage est favorable : les deux modules désignent l'enseignant par
la **même identité** (table `teachers`). La configuration de paie d'un
enseignant, ses périodes, son workflow d'approbation et ses rapports sont donc
déjà valables pour ses heures professionnelles — il ne manque que la **collecte
des heures** et la **tarification** du côté professionnel.

```text
AVANT :  Rémunération ──> heures Académique uniquement
APRÈS :  Rémunération ──> heures Académique  +  heures Professionnel (séances ECUE)
                         ─────────────────────────────────────────────────────────
                                     un seul bulletin par enseignant
```

Périmètre : **collecte et tarification des heures professionnelles**, et
**unification** du bulletin. Le moteur de paie (périodes, configurations,
workflow `calculé → approuvé → payé`, audit, rapports) n'est **pas** réécrit :
il est étendu.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Distinguer une séance planifiée d'une séance réellement faite (Priority: P1)

Un responsable pédagogique ouvre la liste des séances d'ECUE d'une période et
marque celles qui ont **réellement eu lieu**, celles qui ont été **annulées**,
puis **valide** en lot celles qui sont payables. Une séance simplement
planifiée n'est jamais payée.

**Why this priority**: Sans cette distinction, le calcul paierait le planning.
C'est le prérequis absolu de toute rémunération professionnelle : aucune autre
histoire n'a de sens si la source d'heures n'est pas fiable.

**Independent Test**: Créer trois séances d'ECUE (une réalisée, une annulée,
une restée planifiée), les traiter depuis l'écran de validation, et vérifier
que seule la séance réalisée **et** validée apparaît comme payable.

**Acceptance Scenarios**:

1. **Given** une séance d'ECUE nouvellement planifiée, **When** un responsable consulte l'écran de validation, **Then** la séance apparaît au statut « planifiée » et n'est pas payable.
2. **Given** une séance dont l'enseignant a fait l'appel (présences saisies), **When** le responsable la marque « réalisée » puis la valide, **Then** elle devient payable et porte l'identité du valideur et la date de validation.
3. **Given** une séance marquée « annulée », **When** le responsable tente de la valider, **Then** la validation est refusée et la séance reste non payable.
4. **Given** une séance validée, **When** le responsable retire la validation, **Then** la séance redevient non payable, à condition qu'elle ne soit pas déjà rattachée à un paiement approuvé ou payé.
5. **Given** une séance sans heure de début ni de fin, **When** le responsable tente de la valider, **Then** la validation est refusée avec un message explicite (durée indéterminable).

---

### User Story 2 - Rémunérer un enseignant sur ses heures professionnelles (Priority: P1)

Un gestionnaire de paie sélectionne une période de paiement, lance le calcul, et
obtient pour chaque enseignant un montant qui **additionne** ses heures
académiques et ses heures professionnelles validées, avec un détail ligne à
ligne indiquant l'origine de chaque heure.

**Why this priority**: C'est la valeur centrale de la feature. Un enseignant
100 % professionnel passe de « payé 0 » à « payé juste ».

**Independent Test**: Configurer un enseignant en tarif horaire, lui affecter
deux séances d'ECUE validées dans une période, lancer le calcul, et vérifier
que le montant correspond aux heures × tarif et que le détail cite les séances.

**Acceptance Scenarios**:

1. **Given** un enseignant en configuration horaire avec 6 h de séances ECUE validées sur la période, **When** le calcul est lancé, **Then** un paiement est produit dont le détail liste les séances professionnelles et leur durée.
2. **Given** un enseignant intervenant à la fois en académique (4 h) et en professionnel (3 h) sur la même période, **When** le calcul est lancé, **Then** **un seul** paiement de 7 h est produit, le détail distinguant l'origine de chaque ligne.
3. **Given** un enseignant en configuration salariale, **When** le calcul est lancé, **Then** son montant reste inchangé et ses séances professionnelles sont listées à titre informatif, sans effet sur le montant.
4. **Given** un enseignant sans configuration de paie valide sur la période, **When** le calcul est lancé, **Then** il est ignoré et signalé explicitement dans le compte rendu de calcul (et non silencieusement absent).
5. **Given** une séance professionnelle non validée, **When** le calcul est lancé, **Then** elle n'est pas comptée.
6. **Given** un calcul déjà effectué pour la période, **When** le gestionnaire relance le calcul en mode « recalcul », **Then** le paiement est recalculé et son détail entièrement reconstruit, sans doublon de ligne.
7. **Given** un paiement au statut « approuvé » ou « payé », **When** un recalcul est lancé, **Then** ce paiement n'est pas écrasé et le compte rendu l'indique.

---

### User Story 3 - Tarifer l'heure au niveau de l'ECUE (Priority: P2)

Un gestionnaire définit un **tarif horaire par ECUE**, éventuellement spécifique
à un enseignant, avec une période de validité. À défaut de tarif ECUE, le tarif
horaire par défaut de l'enseignant s'applique.

**Why this priority**: Le calcul fonctionne déjà avec le seul tarif par défaut
(US2). La tarification fine est le raffinement qui rend le module utilisable
dans un établissement réel, où toutes les matières ne valent pas le même prix.

**Independent Test**: Poser un tarif sur une ECUE, calculer, vérifier que ce
tarif s'applique ; retirer le tarif, recalculer, vérifier le repli sur le tarif
par défaut de l'enseignant.

**Acceptance Scenarios**:

1. **Given** un tarif horaire défini pour une ECUE et valide sur la période, **When** le calcul est lancé, **Then** les heures de cette ECUE sont valorisées à ce tarif.
2. **Given** un tarif ECUE générique et un tarif ECUE spécifique au même enseignant, **When** le calcul est lancé, **Then** le tarif **spécifique à l'enseignant** l'emporte.
3. **Given** aucune tarification ECUE applicable, **When** le calcul est lancé, **Then** le tarif horaire par défaut de la configuration de l'enseignant s'applique.
4. **Given** un tarif existant sur une ECUE pour une période donnée, **When** le gestionnaire crée un second tarif chevauchant la même période pour la même ECUE et le même enseignant, **Then** la création est refusée.
5. **Given** un tarif ECUE modifié après qu'un paiement a été approuvé, **When** on consulte ce paiement, **Then** il conserve le tarif appliqué au moment du calcul (le détail est historisé).

---

### User Story 4 - Suivre, justifier et éditer les rapports (Priority: P2)

Un gestionnaire consulte les rapports de rémunération avec un filtre
**Académique / Professionnel / Tous**, et édite le bulletin d'un enseignant :
le document détaille chaque séance payée, son origine, sa durée et son tarif.

**Why this priority**: La traçabilité est ce qui rend un paiement opposable en
cas de contestation ; elle vient une fois que le calcul est juste.

**Independent Test**: Après un calcul mixte, filtrer les rapports sur
« Professionnel » et vérifier que les totaux correspondent aux seules heures
professionnelles, puis éditer le bulletin d'un enseignant mixte et vérifier que
les deux origines y figurent.

**Acceptance Scenarios**:

1. **Given** des paiements calculés sur des heures mixtes, **When** le gestionnaire filtre les rapports sur « Professionnel », **Then** les totaux affichés ne comptent que les heures d'origine professionnelle.
2. **Given** un enseignant payé sur les deux origines, **When** son bulletin est édité, **Then** le document présente les deux origines, chaque séance (date, ECUE, cohorte, durée, tarif) et le total.
3. **Given** une séance professionnelle payée, **When** on consulte le détail du paiement, **Then** la séance d'origine est identifiable (ECUE, cohorte, date).
4. **Given** un export des rapports, **When** il est généré, **Then** il porte la même colonne d'origine que l'affichage.

---

### User Story 5 - L'enseignant consulte ce qu'il a fait et ce qu'il perçoit (Priority: P3)

Un enseignant du module professionnel ouvre « Mes Rémunérations » et voit ses
séances validées de la période, leur valorisation et l'état de son paiement.

**Why this priority**: Confort et transparence ; le module est fonctionnel sans
cet écran, mais il coupe court aux réclamations.

**Independent Test**: Depuis un compte enseignant professionnel, ouvrir l'écran
et vérifier qu'il ne voit que ses propres séances et paiements.

**Acceptance Scenarios**:

1. **Given** un enseignant avec des séances validées, **When** il ouvre son espace rémunération, **Then** il voit ses séances de la période, leur durée et leur valorisation.
2. **Given** un paiement au statut « calculé », **When** l'enseignant le consulte, **Then** l'état est affiché comme provisoire tant qu'il n'est pas approuvé.
3. **Given** un enseignant, **When** il consulte l'écran, **Then** il n'accède à aucune donnée d'un autre enseignant.

---

### Edge Cases

- **Séance à cheval sur deux périodes** : une séance est rattachée à la période contenant sa **date**, pas sa durée ; aucune répartition au prorata.
- **Séance hors de toute période** : reste validable, mais n'est payée qu'une fois créée une période la couvrant.
- **Séance validée après clôture de la période** : elle n'entre pas dans un paiement de cette période close ; elle est signalée comme « validée hors période close ».
- **Séance sans enseignant affecté** : n'est jamais payable (aucun bénéficiaire).
- **Enseignant devenu inactif en cours de période** : ses séances validées avant la désactivation restent dues et sont payées.
- **Enseignant remplacé sur une séance** : la séance est payée à l'enseignant **effectivement inscrit sur la séance**, et non au titulaire de l'affectation ECUE/cohorte.
- **Suppression d'une séance déjà payée** : refusée tant que la séance figure dans un paiement approuvé ou payé.
- **Heures supplémentaires** : le seuil hebdomadaire s'apprécie sur le **cumul des deux origines**, pas par origine.
- **Devise** : les montants professionnels sont exprimés dans la devise de l'établissement ; un même paiement ne peut pas mêler deux devises.
- **Chevauchement d'horaires** : deux séances du même enseignant qui se chevauchent sont signalées comme anomalie avant validation (risque de double comptage).

## Requirements *(mandatory)*

### Functional Requirements

**Cycle de vie d'une séance professionnelle (source des heures)**

- **FR-001**: Le système MUST doter chaque séance d'ECUE d'un **statut de réalisation** parmi `planifiee`, `realisee`, `annulee`, avec `planifiee` par défaut.
- **FR-002**: Le système MUST permettre de **valider** une séance pour la paie, en conservant l'identité du valideur et l'horodatage de la validation.
- **FR-003**: Une séance MUST être payable **si et seulement si** elle est `realisee`, validée, dotée d'un enseignant et d'une durée déterminable.
- **FR-004**: Le système MUST calculer la **durée** d'une séance à partir de ses heures de début et de fin ; une séance sans horaires complets NE MUST PAS être validable.
- **FR-005**: Le système MUST permettre la validation et la dévalidation **en lot** sur une sélection de séances filtrée par enseignant, cohorte, ECUE et intervalle de dates.
- **FR-006**: Le système MUST refuser la dévalidation ou la suppression d'une séance déjà rattachée à un paiement **approuvé** ou **payé**.
- **FR-007**: Le système MUST signaler, avant validation, les séances d'un même enseignant dont les horaires se **chevauchent**.

**Tarification professionnelle**

- **FR-010**: Le système MUST permettre de définir un **tarif horaire par ECUE**, optionnellement restreint à un enseignant, avec une période de validité (`valide_du`, `valide_au` optionnel).
- **FR-011**: Le système MUST empêcher deux tarifs **chevauchants** pour un même couple (ECUE, enseignant) — l'absence d'enseignant constituant un couple distinct (tarif générique).
- **FR-012**: La résolution du tarif d'une heure MUST suivre l'ordre : tarif (ECUE + enseignant) → tarif (ECUE, générique) → tarif horaire par défaut de la configuration de l'enseignant.
- **FR-013**: Si aucun tarif n'est résoluble pour une heure payable, le système MUST produire une **anomalie explicite** sur cet enseignant, plutôt qu'un montant nul silencieux.

**Calcul unifié**

- **FR-020**: Le calcul d'un enseignant MUST agréger, sur la période, **ses heures académiques et ses heures professionnelles** validées, en un **seul** paiement.
- **FR-021**: Le seuil d'heures supplémentaires MUST s'apprécier sur le **cumul** hebdomadaire des deux origines.
- **FR-022**: Chaque ligne du détail d'un paiement MUST porter son **origine** (`academique` / `professionnel`) et référencer la séance qui la justifie.
- **FR-023**: Le détail d'un paiement MUST **historiser** la durée et le tarif appliqués au moment du calcul ; une modification ultérieure du tarif NE MUST PAS altérer un paiement existant.
- **FR-024**: Un recalcul MUST reconstruire intégralement le détail du paiement, sans laisser de ligne orpheline ni de doublon.
- **FR-025**: Un recalcul NE MUST PAS modifier un paiement au statut `approuve`, `paye` ou `annule` ; ces cas MUST être remontés dans le compte rendu.
- **FR-026**: Le compte rendu de calcul MUST distinguer, par enseignant : calculé, ignoré (et **pourquoi** : sans configuration, sans heure, hors périmètre), en erreur.
- **FR-027**: Le système MUST rendre le périmètre de calcul **sélectionnable** (Académique seul, Professionnel seul, Tous) sans changer le résultat par défaut, qui est « Tous ».

**Restitution et traçabilité**

- **FR-030**: Les rapports de rémunération MUST offrir un filtre d'**origine** (Académique / Professionnel / Tous) appliqué de façon cohérente à l'affichage, aux totaux et aux exports.
- **FR-030b**: Les rapports MUST exposer une **ventilation à trois postes** — Académique, Professionnel, hors-heures — dont la somme égale le total. Le poste « hors-heures » recueille les montants qu'aucune ligne d'heures ne justifie (salaires) ; sans lui, la différence entre la somme des deux origines et le total serait inexplicable.
- **FR-031**: Le bulletin d'un enseignant MUST détailler chaque séance payée : date, origine, libellé (cours ou ECUE), cohorte le cas échéant, durée, tarif, montant.
- **FR-032**: Un enseignant MUST pouvoir consulter ses propres séances validées et ses propres paiements, et **uniquement** les siens.
- **FR-033**: Toute modification de statut d'un paiement MUST rester tracée dans le journal d'audit existant, sans distinction d'origine.

**Intégrité et régularisation de l'existant**

- **FR-040**: Le détail des heures d'un paiement MUST accepter **les deux origines** sans violer d'intégrité référentielle — la contrainte actuelle, qui n'admet qu'une origine académique historique, MUST être régularisée.
- **FR-041**: Le rattachement d'une période de paiement à une **année académique** MUST être formalisé dans le schéma versionné, le code l'exploitant déjà sans que le schéma ne le déclare.
- **FR-042**: La **devise** des paiements MUST être alignée sur celle de l'établissement, plutôt que sur une valeur par défaut héritée.
- **FR-043**: Toute nouvelle donnée MUST porter l'isolation multi-tenant (cloisonnement par établissement) au même niveau que l'existant.

**Accès**

- **FR-050**: La validation des séances et la gestion des tarifs ECUE MUST être réservées aux profils d'administration ; la consultation de sa propre rémunération est ouverte à l'enseignant concerné.
- **FR-051**: Les entrées de menu correspondantes MUST respecter le filtrage par rôle administratif déjà en place.

### Key Entities *(include if feature involves data)*

- **Séance d'ECUE** (existante, étendue) : créneau daté d'une ECUE dans une cohorte d'UE ; gagne un **statut de réalisation** et une **validation paie** (valideur, date).
- **Tarif horaire d'ECUE** (nouveau) : montant horaire applicable à une ECUE, éventuellement pour un enseignant donné, sur une période de validité, sans chevauchement.
- **Ligne de détail d'heures** (existante, étendue) : justification unitaire d'un montant ; gagne une **origine** et une référence vers la séance professionnelle ; sa référence académique devient optionnelle.
- **Période de paiement** (existante, inchangée) : fenêtre de paie de l'établissement ; sert les deux origines.
- **Configuration de paie d'enseignant** (existante, inchangée) : salaire / horaire / mixte, seuil et coefficient d'heures supplémentaires ; vaut pour les deux origines.
- **Paiement d'enseignant** (existant, structure inchangée) : un enregistrement par enseignant et par période, désormais alimenté par les deux origines.
- **Compte rendu de calcul** (existant, enrichi) : par enseignant, l'issue du calcul et son motif.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un enseignant intervenant exclusivement dans le module professionnel obtient un paiement non nul, cohérent à l'unité monétaire près avec la somme de ses heures validées × tarif applicable.
- **SC-002**: Un enseignant intervenant dans les deux modules reçoit **un seul** paiement pour la période, dont le total égale la somme des deux origines.
- **SC-003**: 100 % des heures payées sont rattachables à une séance identifiable (date, ECUE ou cours, cohorte le cas échéant), vérifiable depuis le détail du paiement et depuis le bulletin.
- **SC-004**: Aucune séance `planifiee`, `annulee`, non validée, sans enseignant ou sans horaires ne produit de montant.
- **SC-005**: Un recalcul exécuté deux fois de suite sur une période produit un résultat strictement identique (idempotence), sans ligne de détail dupliquée.
- **SC-006**: Le calcul d'une période comptant 500 séances professionnelles et 100 enseignants s'exécute en moins de 30 secondes.
- **SC-007**: Le filtre d'origine des rapports donne des totaux dont la somme (Académique + Professionnel + **hors-heures**) égale exactement le total « Tous ».

  > **Correction apportée en implémentation.** La formulation initiale —
  > « Académique + Professionnel = Tous » — ne peut pas tenir : un enseignant
  > **salarié** n'a aucune ligne de détail horaire, son montant ne provient
  > d'aucune origine. Sans un troisième poste, l'écart apparaîtrait comme une
  > erreur de calcul. La ventilation compte donc trois postes, dont
  > « hors-heures » (salaires), et c'est leur somme qui doit retomber sur le
  > total. Vérifié en base : 0 + 244 000 + 900 000 = 1 144 000.
- **SC-008**: Un tarif ECUE modifié après approbation d'un paiement ne modifie aucun montant déjà approuvé ou payé.
- **SC-009**: Les suites de tests de rémunération (existantes et nouvelles) passent, y compris sur le chemin horaire académique, aujourd'hui en défaut d'intégrité.

## Assumptions

- **Identité enseignante unique** : les deux modules désignent l'enseignant par la même entité `teachers` ; aucune table d'enseignants professionnels distincte n'est introduite. Les intervenants gérés comme `formateurs` (module formations courtes) restent **hors périmètre**.
- **Un seul bulletin par enseignant et par période** : le choix d'agréger, plutôt que de produire deux paiements distincts, découle du seuil d'heures supplémentaires, qui n'a de sens que sur le cumul réel.
- **Pas de duplication du module** : périodes, configurations, workflow d'approbation, audit et rapports restent **partagés**. Seuls deux écrans sont propres au professionnel (validation des séances, tarifs ECUE).
- **Rattachement à la période par la date de séance** : pas de prorata pour une séance à cheval ; le cas est marginal et le prorata rendrait le bulletin illisible.
- **Durée issue des horaires** : la durée n'est pas saisie à part ; elle se déduit du créneau, ce qui évite deux vérités contradictoires.
- **Statut de réalisation manuel** : la présence d'un appel (feuille de présence saisie) est un **indice**, pas une preuve de réalisation ; le passage à `realisee` reste une décision humaine, éventuellement assistée par une proposition automatique.
- **Reprise de données** : les séances existantes sont initialisées en `planifiee` et non validées. Aucune séance passée n'est payée rétroactivement sans validation explicite — c'est délibéré : payer rétroactivement sur du planning non vérifié serait une erreur comptable.
- **Devise** : un établissement opère dans une devise unique ; le multi-devises est hors périmètre.
- **Académique inchangé** : la chaîne de collecte des heures académiques n'est pas modifiée dans sa sémantique ; seule l'anomalie d'intégrité qu'elle traîne est corrigée.
- **Primes et retenues** : les montants de prime et de retenue restent saisis manuellement comme aujourd'hui ; aucune règle automatique n'est introduite.
