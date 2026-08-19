# Quickstart — Rémunération professionnelle (031)

## Pré-requis

- Monorepo pnpm installé.
- PostgreSQL 14+ accessible, extension `btree_gist` disponible.
- Module Professionnel opérationnel (feature 030 appliquée : UE, ECUE, cohortes, séances).
- Au moins une **année académique active** et une **période de paiement** ouverte.
- Branche `031-remuneration-professionnelle`.

## 0. Constat préalable — **à faire avant d'écrire la migration**

La migration dépend de l'état réel de deux objets qui divergent entre le schéma
versionné et les bases existantes (research.md, écarts E4 et E5) :

```bash
node scripts/check-payment-hour-details-fk.js
```

Le script rapporte, pour la base ciblée :

- la présence de la FK `payment_hour_details_teaching_hours_id_fkey` ;
- la nullabilité de `payment_hour_details.teaching_hours_id` ;
- la présence de `payment_periods.academic_year_id` ;
- le défaut de `teacher_payments.currency` ;
- les contraintes `EXCLUDE`/`UNIQUE` réellement présentes sur les tables de paie ;
- les prérequis de `0103` (`btree_gist`, tables du module professionnel) ;
- un **verdict** listant ce que `0103` doit prévoir sur cette base précise.

> À exécuter sur **dev et prod**. Si les deux bases divergent, la migration doit
> rester strictement idempotente (`IF EXISTS` / `IF NOT EXISTS`) — ne jamais
> supposer l'état de la prod à partir du dev.

Le résultat sur la base de dev est consigné dans
[`_constat.txt`](./_constat.txt). Il a **élargi le périmètre de la feature** :
deux contraintes déclarées par `0011` se sont révélées absentes de la base
(E7, E8).

## 1. Appliquer la migration

```bash
node scripts/apply-migration-0103-remuneration-pro.js
```

`0103` est **additive et idempotente** : elle ne supprime aucune table et peut
être rejouée. Elle :

- crée `professional_ecue_hourly_rates` (+ RLS, index, contrainte `EXCLUDE`) ;
- ajoute `statut`, `statut_modifie_par/_le`, `validated_by/_at` à `professional_ecue_seances` ;
- ouvre `payment_hour_details` aux deux origines (`source`, `attendance_session_id`, `seance_id`, `teaching_hours_id` nullable, index uniques partiels) ;
- ajoute `payment_periods.academic_year_id` ;
- bascule le défaut de `teacher_payments.currency` sur `'XOF'` ;
- **recrée deux garde-fous absents de la base** (E7/E8) :
  `unique_teacher_payment_per_period` et `payment_periods_no_overlap` ;
- crée la vue `v_payment_hour_details_enriched`.

> Les deux garde-fous s'arrêtent avec un message explicite si des données non
> conformes existent (paiements en double, périodes qui se recouvrent). C'est
> volontaire : résoudre les données d'abord, appliquer ensuite.

> **Aucun backfill** : toutes les séances existantes restent `planifiee` et non
> validées (D-R12). C'est voulu — aucun paiement rétroactif n'est déclenché par
> la migration.

## 2. Construire les contrats puis l'API

```bash
pnpm --filter @ecoledigitale/contracts build
pnpm --filter @ecoledigitale/api build
```

## 3. Ensemencer un jeu de démonstration

```bash
node scripts/seed-remuneration-professionnelle.js
```

Le seed pose : un enseignant en configuration `hourly`, un second en `salary`,
un troisième intervenant **dans les deux modules** ; une cohorte d'UE avec
6 séances ECUE (dont une annulée, une sans horaires, deux non validées) ; un
tarif ECUE générique et un tarif nominatif ; une période de paiement couvrant
les séances.

## 4. Lancer

```bash
pnpm --filter @ecoledigitale/api dev
```

```bash
pnpm --filter @ecoledigitale/web dev
```

## Parcours de validation manuelle

1. **Validation des séances** — `Module Professionnel → Rémunération → Validation des séances`.
   Vérifier que les 6 séances apparaissent, que la séance annulée et celle sans
   horaires affichent un motif de non-payabilité (`blockers`), et que la
   validation en lot n'applique que les séances éligibles.
2. **Tarifs ECUE** — `Module Professionnel → Rémunération → Tarifs horaires ECUE`.
   Créer un tarif chevauchant un tarif existant sur le même couple → **refus**
   (`RATE_OVERLAP`). Utiliser « simuler la résolution » pour vérifier que le tarif
   nominatif l'emporte sur le générique.
3. **Calcul** — `Rémunération Enseignants → Calcul des Paiements`. Lancer sur la
   période avec le périmètre « Tous ».
   - L'enseignant 100 % professionnel obtient un montant **non nul** (SC-001).
   - L'enseignant mixte obtient **un seul** paiement, total = académique + professionnel (SC-002).
   - L'enseignant sans configuration apparaît en `skipped` avec le motif `NO_CONFIG` (FR-026).
4. **Idempotence** — relancer le calcul en mode recalcul. Le montant doit être
   **identique** et le nombre de lignes de détail inchangé (SC-005).
5. **Verrou** — approuver un paiement, puis relancer un recalcul : le paiement
   n'est pas modifié et remonte en `PAYMENT_LOCKED` (FR-025).
6. **Historisation** — modifier le tarif ECUE, rouvrir le paiement approuvé :
   le montant et le tarif du détail sont **inchangés** (SC-008).
7. **Rapports** — `Rapports Enseignants`, basculer le filtre d'origine.
   Vérifier `Académique + Professionnel = Tous` (SC-007), puis exporter et
   vérifier que la colonne Origine figure dans le fichier.
8. **Bulletin** — éditer le PDF de l'enseignant mixte : les deux origines
   apparaissent, chaque ligne portant date, libellé, cohorte, durée, tarif.
9. **Espace enseignant** — se connecter comme enseignant professionnel, ouvrir
   « Mes Rémunérations » : ses séances et son paiement s'affichent, et aucune
   donnée d'un autre enseignant n'est accessible (FR-032).

## 5. Tests

```bash
pnpm --filter @ecoledigitale/api test -- payment
```

Suites attendues :

| Suite | Couvre |
|---|---|
| `payment-calculator-academic` | non-régression du chemin académique (SC-009) |
| `payment-calculator-professional` | collecte des séances validées, payabilité (SC-004) |
| `payment-calculator-mixed` | agrégation, heures sup sur le cumul (SC-002, FR-021) |
| `payment-calculator-idempotence` | double recalcul, absence de doublon (SC-005) |
| `professional-seance-validation` | statut, validation en lot, verrous, chevauchements |
| `professional-ecue-rates` | chevauchement, ordre de résolution, repli, anomalie |

## Points d'attention

- **Changement de comportement assumé** : après cette feature, un appel existant
  à `/teacher-payments/calculate` **sans** paramètre `scope` inclut les heures
  professionnelles. Pour retrouver l'ancien comportement, passer
  `scope: "academique"`.
- **La migration corrige un défaut préexistant** : le chemin horaire académique
  échouait sur une violation de clé étrangère absorbée par le `try/catch` du
  calculateur (comptée en `errors`). Après `0103`, ces calculs aboutissent — les
  montants académiques peuvent donc **changer** par rapport à avant la migration.

  **Mesure sur dev (2026-08-18)** : aucun écart possible, il n'y avait rien à
  comparer. `payment_hour_details` et `teacher_payments` étaient **vides** — la
  preuve la plus directe que le chemin horaire n'avait jamais abouti. Le premier
  calcul après `0103` a produit 3 paiements et 10 lignes de détail.

  **Sur prod, la mesure reste à faire AVANT d'appliquer** :

  ```sql
  SELECT count(*) AS paiements,
         count(*) FILTER (WHERE payment_type IN ('hourly','mixed')) AS horaires,
         COALESCE(SUM(total_amount), 0) AS total
  FROM teacher_payments;

  SELECT count(*) AS lignes_detail FROM payment_hour_details;
  ```

  Si `lignes_detail = 0` alors que des paiements horaires existent, le même
  défaut est confirmé : les montants académiques de prod augmenteront après
  migration. Conserver ces chiffres pour la comparaison.
- **Devise** : le défaut passe à `'XOF'`. Les paiements déjà enregistrés en
  `'EUR'` ne sont pas réécrits.
- **Séances passées** : rien n'est payé rétroactivement sans validation
  explicite. Utiliser le filtre `hasAttendance=true` de l'écran de validation
  pour traiter l'historique en lot.
