# Workflow de la paie enseignante — état actuel

**Dernière mise à jour** : 2026-08-18, après la feature
[031-remuneration-professionnelle](../specs/031-remuneration-professionnelle/spec.md)
et son extension comptable (migrations `0103` → `0105`).

Ce document décrit la chaîne **telle qu'elle fonctionne aujourd'hui**, pas telle
qu'elle était conçue à l'origine. Deux changements structurants :

1. le moteur compte **deux origines d'heures** — Académique et Professionnel —
   sur un **bulletin unique** par enseignant et par période ;
2. le comptable peut **corriger un volume horaire** et **ajouter une séance
   oubliée**, sans jamais réécrire l'emploi du temps.

---

## 1. Vue d'ensemble

```
┌─ ORIGINE ACADÉMIQUE ────────────────┐   ┌─ ORIGINE PROFESSIONNELLE ─────────┐
│ L'enseignant saisit sa présence     │   │ Une séance d'ECUE est planifiée   │
│ teacher_attendance_sessions         │   │ professional_ecue_seances         │
│         │ statut = 'completed'      │   │         │ statut = 'realisee'     │
│         ▼                           │   │         │ + validated_at          │
│ AcademicHourCollector               │   │         ▼                         │
└─────────┬───────────────────────────┘   │ ProfessionalHourCollector         │
          │                                └─────────┬─────────────────────────┘
          └───────────────┬──────────────────────────┘
                          ▼
              ┌───────────────────────────┐
              │  PaymentCalculator        │  ← teacher_payment_configs
              │  (une seule exécution)    │  ← course_hourly_rates
              └───────────┬───────────────┘  ← professional_ecue_hourly_rates
                          ▼
              ┌───────────────────────────┐
              │ teacher_payments (1 ligne)│  un bulletin, deux origines
              │ payment_hour_details (N)  │  chaque ligne porte sa `source`
              └───────────┬───────────────┘
                          ▼
          calculated → approved → paid       (+ disputed, cancelled)
                          │
                          ▼
              Rapports · Bulletin PDF · Relevé
```

**Principe directeur** : l'origine d'une heure vit sur la **ligne de détail**,
jamais sur le paiement. C'est ce qui permet d'additionner les deux modules sans
casser le calcul des heures supplémentaires.

---

## 2. Le parcours mensuel du comptable

L'ordre compte : chaque étape suppose la précédente.

| # | Étape | Écran |
|---|---|---|
| 1 | Vérifier que la **période** existe et est ouverte | Périodes de Paiement |
| 2 | Vérifier que chaque enseignant a une **configuration** valide | Configuration Enseignants |
| 3 | Traiter les **séances attendues mais non enregistrées** (rapprochement) | Validation des séances |
| 4 | Marquer les séances **réalisées**, corriger les **volumes horaires** | Validation des séances |
| 5 | **Valider** en lot les séances payables | Validation des séances |
| 6 | Lancer le **calcul** | Calcul des Paiements |
| 7 | Contrôler les **écartés** et la ventilation | Calcul des Paiements |
| 8 | **Approuver**, puis marquer **payé** | Gestion des Paiements |
| 9 | Éditer **bulletins** et **rapports** | Rapports Enseignants |

Une fois l'étape 8 franchie, les séances concernées se verrouillent : plus de
modification de volume, plus de dévalidation, plus de recalcul.

---

## 3. Ce qui alimente le calcul

### 3.1 Périodes de paiement

`payment_periods` — la fenêtre de paie de l'établissement, **commune aux deux
origines**. Il n'existe pas de période propre au professionnel.

| Statut | Effet |
|---|---|
| `draft` | Préparation, calcul possible |
| `active` | En cours, calcul possible |
| `closed` | **Le calcul est refusé** |
| `archived` | **Le calcul est refusé** ; ne bloque plus l'anti-chevauchement |

- Deux périodes non archivées **ne peuvent pas se recouvrir**
  (`payment_periods_no_overlap`). Sans ce garde-fou, une séance tombant dans
  deux périodes serait payée deux fois.
- Le calcul **exige** l'en-tête `x-academic-year-id` et ne voit que les périodes
  de cette année.

### 3.2 Configuration de paie de l'enseignant

`teacher_payment_configs` — une configuration par enseignant, valable sur une
plage de dates. Elle vaut pour **les deux origines**.

| Type | Base du montant | Les heures… |
|---|---|---|
| `salary` | `monthly_salary` au prorata des jours ouvrés | sont listées, **sans effet sur le montant** |
| `hourly` | heures × tarif résolu | déterminent tout le montant |
| `mixed` | salaire prorata **+** heures × tarif | s'ajoutent au salaire |

Heures supplémentaires : `overtime_threshold` (seuil hebdomadaire, 40 h par
défaut) et `overtime_multiplier` (1,5 par défaut).

- Deux configurations d'un même enseignant **ne peuvent pas se chevaucher** —
  c'est ce qui garantit un tarif unique à une date donnée.
- **Les dates ne sont pas bornées par l'année académique** : une rémunération
  suit le contrat, dont la durée ne s'aligne pas sur le calendrier scolaire.
  L'année est enregistrée à titre de traçabilité et **ne filtre pas** la liste.
- **Sans configuration valide, l'enseignant n'est pas payé** — il apparaît au
  compte rendu avec le motif `NO_CONFIG`.

### 3.3 Tarifs horaires

| Table | Porte sur | Écran |
|---|---|---|
| `course_hourly_rates` | un `course` (Académique) | Configuration Enseignants |
| `professional_ecue_hourly_rates` | une `ECUE` (Professionnel) | Rémunération › Tarifs horaires ECUE |

**Résolution d'un tarif professionnel**, dans cet ordre strict :

1. tarif **(ECUE + enseignant)** — nominatif, prioritaire
2. tarif **(ECUE, générique)**
3. `teacher_payment_configs.default_hourly_rate`
4. sinon → **anomalie** `NO_RATE_RESOLVED`, jamais un montant nul silencieux

Deux tarifs chevauchants sur le même couple sont refusés. L'écran propose un
**simulateur** qui affiche le montant retenu et son origine.

---

## 4. La source des heures

### 4.1 Origine académique

`teacher_attendance_sessions` → `teacher_assignments` → `class_courses`.
Compte si `status = 'completed'` et si `session_date` tombe dans la période.
Durée = `duration_hours`.

### 4.2 Origine professionnelle

`professional_ecue_seances` → `professional_ecue` / `professional_ue_sessions`.

Une séance d'ECUE est un objet de **planning** : elle existe avant d'avoir lieu.
Trois notions distinctes s'y appliquent, et les confondre serait faux :

| Notion | Colonnes | Nature | Qui |
|---|---|---|---|
| Réalisation | `statut` | **fait pédagogique** — le cours a eu lieu | scolarité / enseignant |
| Volume payé | `duree_payee` | **correction comptable** — ce qui est dû | comptabilité |
| Validation | `validated_at`, `validated_by` | **acte de gestion** — c'est payable | comptabilité |

`statut` ∈ `planifiee` (défaut) · `realisee` · `annulee`

**Prédicat de payabilité** — les conditions sont cumulatives :

```
statut = 'realisee'
ET validated_at  IS NOT NULL
ET enseignant_id IS NOT NULL
ET ( duree_payee IS NOT NULL
     OU (heure_debut ET heure_fin renseignés) )
```

**Durée retenue** :

```
COALESCE(duree_payee, heure_fin - heure_debut)
```

- L'enseignant payé est celui **de la séance**, remplacement compris — pas le
  titulaire de l'affectation ECUE/cohorte.
- La saisie de présences est un **indice** de réalisation, jamais un
  déclencheur : un enseignant peut faire l'appel puis annuler, ou faire cours
  sans appel. Le compteur de présences et le filtre « avec présences saisies »
  servent à repérer les séances à traiter, pas à les valider automatiquement.

> Le prédicat et l'expression de durée sont définis **une seule fois**
> (`SEANCE_PAYABLE_PREDICATE`, `DUREE_PAYEE_SQL`) et importés par le collecteur
> d'heures et la validation en lot. Une règle recopiée ailleurs ferait payer
> autre chose que ce que l'écran annonce — c'est arrivé une fois, en
> développement, et c'est pour ça qu'elle est centralisée.

---

## 5. Les trois interventions du comptable

> Écran : `Module Professionnel › Rémunération › Validation des séances`

### 5.1 Corriger un volume horaire

Le volume est un **champ éditable**, pré-rempli avec la durée déduite des
horaires. Le modifier pose une **dérogation** (`duree_payee`) et **ne touche
jamais aux horaires** : l'emploi du temps reste le registre pédagogique.

- Vider le champ retire la dérogation et redonne la main aux horaires.
- Saisir exactement la durée planifiée **retire** la dérogation plutôt que d'en
  poser une identique — sinon le repère « modifié » perdrait son sens.
- Retirer la dérogation d'une séance **sans horaires** est refusé : elle
  deviendrait impayable.
- Une séance corrigée affiche « modifié · prévu 2h », avec l'auteur en
  info-bulle.

**Effet voulu** : une séance sans horaires devient payable dès qu'un volume est
saisi. C'était le cas bloqué jusqu'ici.

### 5.2 Ajouter une séance oubliée

Deux chemins, dans cet ordre de préférence :

**Le rapprochement** — un bandeau liste les créneaux d'emploi du temps
(`professional_emploi_temps`) attendus sur la période **sans séance
correspondante**. Un bouton « Ajouter » crée la séance depuis le créneau, tout
pré-rempli. Sans ce rapprochement, « ajouter une séance oubliée » supposerait
que le comptable sache déjà laquelle manque.

**La saisie libre** — pour une séance qui n'était pas à l'emploi du temps.
Cohorte → ECUE → enseignant (pré-rempli depuis l'affectation), puis horaires
**ou** volume horaire. L'ECUE doit appartenir à l'UE de la cohorte, sinon la
création est refusée.

Dans les deux cas, la séance est créée **`realisee` mais non validée** :
engager la dépense reste un acte distinct, même quand c'est la même personne qui
l'accomplit ensuite.

### 5.3 Valider

Validation et dévalidation **en lot**, appliquées **partiellement** : les
séances éligibles passent, les autres sont rejetées avec leur motif
(`STATUT_NON_REALISEE`, `SANS_ENSEIGNANT`, `HORAIRES_INCOMPLETS`, `DEJA_PAYEE`).
Faire échouer tout le lot sur une anomalie bloquerait 200 séances pour une seule.

L'écran signale aussi les **chevauchements d'horaires** d'un même enseignant
avant validation : deux séances qui se recoupent paieraient deux fois le même
créneau.

### 5.4 Ce qui est tracé

| Colonne | Trace |
|---|---|
| `duree_payee_par`, `duree_payee_le` | qui a corrigé le volume, et quand |
| `saisie_comptable` | séance ajoutée depuis l'écran de paie |
| `cree_par` | qui l'a ajoutée |
| `statut_modifie_par`, `statut_modifie_le` | qui a changé le statut |
| `validated_by`, `validated_at` | qui a validé |

La personne qui saisit est aussi celle qui valide : ce cumul doit rester visible
en contrôle. L'écran affiche « ajoutée en comptabilité » et « modifié ».

---

## 6. Le calcul

> Écran : `Rémunération Enseignants › Calcul des Paiements`
> API : `POST /api/v1/teacher-payments/calculate`

| Paramètre | Défaut | Effet |
|---|---|---|
| `periodId` | — | obligatoire |
| `teacherIds` | tous | restreint le périmètre |
| `recalculate` | `false` | écrase un paiement existant non verrouillé |
| `scope` | `all` | `all` · `academique` · `professionnel` |

> **Changement de comportement** : un appel sans `scope` inclut les heures
> professionnelles. `scope: "academique"` restaure l'ancien périmètre.

**Déroulé** : vérification de la période → collecte (une requête par origine,
pour toute la période) → résolution des tarifs → groupement **par semaine
calendaire**, toutes origines confondues → seuil d'heures supplémentaires **sur
le cumul** → écriture du paiement et de son détail.

### Les heures supplémentaires portent sur le cumul

C'est la décision qui justifie de ne pas dupliquer le module. Un seuil
hebdomadaire porte sur le temps de travail **réel d'une personne** : le scinder
par origine laisserait faire 30 h en académique et 30 h en professionnel sans
jamais le déclencher. Une séance à cheval sur le seuil est **coupée en deux
lignes** de détail.

### Compte rendu

| `skipReason` | Signification |
|---|---|
| `NO_CONFIG` | Aucune configuration de paie valide sur la période |
| `NO_HOURS` | Aucune heure validée (configuration horaire) |
| `NO_RATE_RESOLVED` | Aucun tarif ni repli applicable |
| `PAYMENT_LOCKED` | Paiement `approved` / `paid` / `cancelled` : non recalculé |
| `OUT_OF_SCOPE` | Hors du périmètre demandé |

Chaque ligne calculée porte `hoursBySource` — la ventilation par origine.

---

## 7. Ce que le calcul écrit

### `teacher_payments` — un par (enseignant, période, type)

Contrainte `unique_teacher_payment_per_period`. Montants : `base_amount`,
`overtime_amount`, `bonus_amount`, `deductions`, `total_amount`. `currency`
vient de la devise de l'établissement (défaut `XOF`). Primes et retenues restent
**saisies manuellement**.

### `payment_hour_details` — la justification, ligne à ligne

| Colonne | Rôle |
|---|---|
| `source` | `academique` \| `professionnel` |
| `attendance_session_id` | référence académique |
| `seance_id` | référence professionnelle |
| `teaching_hours_id` | **toujours NULL** — vestige de schéma |
| `hours_count`, `hourly_rate` | **figés au calcul** |

Un `CHECK` impose **exactement une** référence d'origine, cohérente avec
`source`. Les deux clés étrangères sont en **`ON DELETE RESTRICT`** : une séance
qui justifie un montant ne peut pas être supprimée tant que ce montant existe.
Un recalcul purge le détail d'un paiement non verrouillé et libère la séance.

> **Historisation** : `hours_count` et `hourly_rate` ne sont jamais recalculés à
> la lecture. Modifier ou supprimer un tarif **n'altère aucun paiement
> existant**.

Un **recalcul** purge intégralement le détail avant de le reconstruire.

---

## 8. Le workflow d'approbation

```
      ┌──────────────┐
      │  calculated  │ ← sortie du calcul (recalculable)
      └──────┬───────┘
             │ approuver
             ▼
      ┌──────────────┐
      │   approved   │ ← VERROUILLÉ
      └──────┬───────┘
             │ marquer payé
             ▼
      ┌──────────────┐
      │     paid     │ ← VERROUILLÉ
      └──────────────┘

      cancelled · disputed
```

### Les quatre verrous

1. **Un paiement `approved` / `paid` / `cancelled` n'est jamais écrasé** par un
   recalcul — il remonte en `PAYMENT_LOCKED`.
2. **Une séance rattachée à un paiement `approved` / `paid`** ne peut plus être
   dévalidée, annulée, ni voir son volume horaire modifié.
3. **Les tarifs sont figés dans le détail** — voir §7.
4. **Une séance qui justifie un montant ne peut pas être supprimée** — la clé
   étrangère est en `RESTRICT`.

Toute transition de statut est tracée dans `payment_audit_log` par un trigger.

---

## 9. Restitution

### Rapports

Le filtre d'**origine** (`all` / `academique` / `professionnel`) s'applique au
**détail**, jamais au paiement : un bulletin mixte apparaît dans les deux
filtres, avec des montants partiels.

**Ventilation à trois postes** :

```
Académique + Professionnel + Hors-heures = Total
```

Le poste « hors-heures » recueille ce qu'aucune ligne d'heures ne justifie — les
**salaires**. Sans lui, la somme des deux origines serait inférieure au total et
l'écart passerait pour une erreur de calcul.

L'export CSV porte les colonnes `Montant Academique` et `Montant Professionnel`.

### Bulletin et relevé

`GET /api/teacher-payments/:id/pdf` et `/statement` portent le **même** tableau :
date, origine, intitulé, cohorte, durée, tarif, montant, plus le récapitulatif
des heures par origine.

### Côté enseignant

> `Mes Rémunérations › Séances Professionnelles`

L'enseignant voit ses séances et ses paiements, et **uniquement les siens** : le
`teacher_id` est dérivé du jeton. Un paiement `calculated` est marqué
**provisoire**.

---

## 10. Points de vigilance

| Sujet | À savoir |
|---|---|
| **Séance à cheval sur deux périodes** | Rattachée à la période contenant sa **date**. Aucun prorata. |
| **Séance validée après clôture** | N'entre pas dans un paiement de cette période close. |
| **Enseignant devenu inactif** | Le calcul ne retient que les enseignants `active` — vérifier avant de désactiver. |
| **Chevauchement d'horaires** | Signalé avant validation. |
| **Devise** | Une seule par établissement. |
| **Reprise d'historique** | Aucune séance passée n'est payée sans validation explicite. |
| **Volume corrigé** | Le prévu reste lisible à côté du payé. Un contrôle regarde d'abord les lignes « modifié » et « ajoutée en comptabilité ». |

---

## 11. Où ça vit dans le code

| Élément | Fichier |
|---|---|
| Moteur de calcul | `apps/api/src/services/payment-calculator.ts` |
| Collecteurs d'heures | `apps/api/src/services/hour-collectors/` |
| Validation, dérogation, rapprochement | `apps/api/src/services/professional-seance-validation.service.ts` |
| Tarifs ECUE | `apps/api/src/services/professional-ecue-rates.service.ts` |
| Routes paie | `apps/api/src/routes/teacher-payments.ts`, `payment-periods.ts`, `teacher-payment-configs.ts`, `payment-reports.ts` |
| Routes professionnel | `apps/api/src/routes/professional-remuneration.ts` |
| Écrans | `apps/web/src/app/professionnel/admin/remuneration/`, `apps/web/src/app/payments/` |
| Schéma | migrations `0011_teacher_remuneration*`, `0103`, `0104`, `0105` |

### API propre au professionnel

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/seances` | liste filtrable, avec payabilité et motifs |
| PATCH | `/seances/:id/statut` | réalisation |
| PATCH | `/seances/:id/duree` | dérogation de volume (`null` = retirer) |
| POST | `/seances/validate` | validation / dévalidation en lot |
| POST | `/seances` | ajout d'une séance (saisie comptable) |
| GET | `/seances/manquantes` | rapprochement emploi du temps |
| GET | `/seances/overlaps` | chevauchements d'horaires |
| GET/POST/PUT/DELETE | `/ecue-rates[/:id]` | tarifs ECUE |
| GET | `/ecue-rates/resolve` | simulateur de résolution |
| GET | `/my/seances`, `/my/payments` | espace enseignant |

Base : `/api/v1/professional/remuneration`

### Vérifier que la chaîne fonctionne

```bash
node scripts/seed-remuneration-professionnelle.js   # jeu de démonstration
node scripts/verify-remuneration-031.js             # 25 invariants, API démarrée
```

Le script **recalcule l'attendu en SQL indépendamment du code** et le compare au
résultat de l'API — il ne relit pas ce que le calcul a produit.

---

## 12. Dérives de schéma connues

Le schéma versionné ne décrit pas exactement l'état des bases. À constater avant
toute migration sur ces tables :

```bash
node scripts/check-payment-hour-details-fk.js
```

- Deux fichiers `0011_*` divergents, dont **aucun** ne correspond à la base.
- `payment_periods.academic_year_id` était lue par le code sans être créée par
  aucune migration (régularisée par `0103`).
- `unique_teacher_payment_per_period` et `payment_periods_no_overlap` étaient
  déclarées mais **absentes** en base (recréées par `0103`).
- `payment_hour_details.teaching_hours_id` portait une FK qui rendait toute
  insertion de détail impossible — le chemin horaire académique n'avait **jamais
  abouti** avant `0103`.
- `PaymentTypeSchema` ignorait `mixed`, présent dans l'énum PostgreSQL et produit
  par le calcul depuis toujours.

Détail complet : `specs/031-remuneration-professionnelle/_constat.txt`.
