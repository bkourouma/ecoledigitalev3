# Research — Rémunération des enseignants, Module Professionnel (031)

Phase 0 du plan. Établit l'état des lieux réel du module de rémunération, fige
les décisions d'adaptation et lève les inconnues. Aucune `NEEDS CLARIFICATION`
ne subsiste.

## 1. État des lieux — le module « Rémunération Enseignants » existant

Les 6 entrées de menu (`Sidebar.tsx:260-265`) correspondent chacune à un maillon
d'une chaîne unique :

| Menu | Écran web | Route API | Table pivot |
|---|---|---|---|
| Périodes de Paiement | `app/payments/periods` | `routes/payment-periods.ts` | `payment_periods` |
| Configuration Enseignants | `app/payments/teacher-configs` | `routes/teacher-payment-configs.ts` | `teacher_payment_configs`, `course_hourly_rates` |
| Validation des Heures | `app/payments/teaching-hours` | `/api/teacher/attendance` | `teacher_attendance_sessions` |
| Calcul des Paiements | `app/payments/calculate` | `POST /teacher-payments/calculate` | `teacher_payments`, `payment_hour_details` |
| Gestion des Paiements | `app/payments/manage` | `routes/teacher-payments.ts` | `teacher_payments` (workflow) |
| Rapports Enseignants | `app/payments/reports` | `routes/payment-reports.ts` | agrégations + PDF/relevé |

Schéma de référence : `infra/scripts/migrations/0011_teacher_remuneration.sql`
(6 tables, RLS par `app.tenant_id`, contraintes `EXCLUDE USING gist`
anti-chevauchement sur les périodes/configs/tarifs, trigger d'audit sur
`teacher_payments`).

### Le moteur

`apps/api/src/services/payment-calculator.ts` — `calculateBatchPayments()` :

1. charge la période (`payment_periods`) ;
2. itère sur les enseignants `active` du tenant ;
3. charge la **configuration de paie** valide sur la période
   (`teacher_payment_configs`, types `salary` / `hourly` / `mixed`) ;
4. **charge les heures** — `payment-calculator.ts:472` :

   ```sql
   FROM teacher_attendance_sessions s
   JOIN teacher_assignments ta ON s.assignment_id = ta.id
   JOIN class_courses cc      ON ta.class_course_id = cc.id
   WHERE s.status = 'completed' AND s.session_date BETWEEN … AND …
   ```

5. charge les tarifs (`course_hourly_rates`) dans une map `courseId → tarif` ;
6. applique le calcul (heures sup au-delà de `overtime_threshold`, groupées **par
   semaine calendaire**, multipliées par `overtime_multiplier`) ;
7. la route écrit un `teacher_payments` + N `payment_hour_details`.

Workflow aval inchangé : `calculated → approved → paid` (+ `disputed`,
`cancelled`), audit automatique par trigger, unicité
`(tenant_id, teacher_id, payment_period_id, payment_type)`.

## 2. État des lieux — le Module Professionnel (030)

Chaîne pédagogique : `programmes (Filière) → professional_ue → professional_ue_ecue → professional_ecue`.

Objets porteurs d'heures :

| Table | Rôle | Colonnes utiles à la paie |
|---|---|---|
| `professional_ue_sessions` | cohorte datée d'une UE | `date_debut`, `date_fin`, `enseignant_id` (titulaire de la cohorte) |
| `professional_session_ecue_teachers` (0070) | **affectation** d'un enseignant à un ECUE d'une cohorte | `ue_session_id`, `ecue_id`, `enseignant_id` |
| `professional_ecue_seances` | **séance** pédagogique datée | `date`, `heure_debut`, `heure_fin`, `enseignant_id`, `ecue_id`, `ue_session_id` |
| `professional_ecue_attendance` | présence étudiante par séance | `seance_id`, `statut` |

**Fait déterminant** : `professional_ue_sessions.enseignant_id`,
`professional_session_ecue_teachers.enseignant_id` et
`professional_ecue_seances.enseignant_id` référencent **tous** `teachers(id)` —
la même table que `teacher_payment_configs.teacher_id`. Les deux modules
partagent l'identité enseignante.

## 3. Écarts constatés

| # | Écart | Conséquence |
|---|---|---|
| E1 | Le collecteur d'heures ne connaît que la chaîne académique | Un enseignant 100 % professionnel est payé 0 |
| E2 | `professional_ecue_seances` n'a **ni statut de réalisation ni validation** | Rien ne distingue une séance planifiée d'une séance faite : payer sur cette table reviendrait à payer le planning |
| E3 | `course_hourly_rates.course_id → courses(id)` | Impossible de tarifer une ECUE (ce n'est pas un `course`) |
| E4 | `payment_hour_details.teaching_hours_id` est **NOT NULL → `teaching_hours(id)`** (`0011:116`) alors que le calculateur y insère des `teacher_attendance_sessions.id` | Toute insertion de détail horaire viole la FK ; l'erreur est absorbée par le `try/catch` par paiement (`ROLLBACK`, `errors++`) — le chemin `hourly` académique est donc **déjà cassé** |
| E5 | `payment_periods.academic_year_id` est lu et écrit par le code (`payment-periods.ts:101,402`) mais **aucune migration ne le crée** | Dérive de schéma : la base de dev diverge du versionné, une réinstallation propre casse |
| E6 | `teacher_payments.currency DEFAULT 'EUR'` dans `0011_teacher_remuneration.sql` alors que `professional_ue.devise DEFAULT 'XOF'` | Bulletins libellés dans la mauvaise devise — **non avéré sur la base de dev**, qui suit la variante `_fixed` (déjà `'XOF'`), cf. `_constat.txt` |
| E7 | `unique_teacher_payment_per_period` **absente** de la base | Rien n'empêche deux paiements pour le même (enseignant, période, type) : D-R2 n'est garantie qu'applicativement |
| E8 | `payment_periods_no_overlap` (EXCLUDE) **absente** de la base | Deux périodes peuvent se recouvrir — une séance validée serait payée **deux fois** |
| E9 | **Deux fichiers `0011_*` divergents** en migrations, et la base ne correspond exactement à aucun des deux | Le schéma versionné ne décrit pas l'état réel ; toute reconstruction diverge |

> **E4 à E9 ont été vérifiés en base** (tâche T002) — le rapport détaillé est dans
> [`_constat.txt`](./_constat.txt). E7, E8 et E9 sont des **découvertes du
> constat**, absentes de l'analyse statique initiale.

## 4. Décisions

### D-R1 — Étendre le moteur existant plutôt que dupliquer le module

- **Décision** : ne créer **aucun** second jeu de tables `payment_periods` /
  `teacher_payment_configs` / `teacher_payments` pour le professionnel. Le
  moteur est étendu par une **source d'heures supplémentaire**.
- **Rationale** : l'identité enseignante est commune (§2). Dupliquer produirait
  deux configurations de paie contradictoires pour un même enseignant, deux
  bulletins pour une même période et un calcul d'heures supplémentaires faux des
  deux côtés.
- **Alternative rejetée** : module `professional_payments_*` autonome, avec
  agrégation a posteriori pour les rapports — coût de maintenance doublé pour
  une valeur nulle, puisque tout l'aval (workflow, audit, PDF) serait à écrire
  deux fois.

### D-R2 — Un seul paiement par enseignant et par période, quelles que soient les origines

- **Décision** : le calcul additionne heures académiques et heures
  professionnelles dans **un seul** enregistrement `teacher_payments` ; l'origine
  vit au niveau de la **ligne de détail** (`payment_hour_details`).
- **Rationale** : `overtime_threshold` est un seuil hebdomadaire sur le temps de
  travail **réel** d'une personne. Le scinder par origine permettrait à un
  enseignant de faire 30 h en académique et 30 h en professionnel sans jamais
  déclencher d'heure supplémentaire.
- **Correction post-constat (E7)** : cette décision devait s'appuyer sur la
  contrainte `unique_teacher_payment_per_period (tenant_id, teacher_id,
  payment_period_id, payment_type)` déclarée par `0011`. Le constat T002 montre
  qu'elle **n'existe pas en base** : « un seul paiement » n'est aujourd'hui
  garanti que par le `SELECT … WHERE` du calculateur, donc sujet à une course
  entre deux calculs concurrents. `0103` doit **recréer** cette contrainte pour
  que D-R2 tienne au niveau base.
- **Conséquence** : le filtre « origine » des rapports est un filtre **sur le
  détail**, jamais sur le paiement.

### D-R3 — Collecteurs d'heures pluggables

- **Décision** : extraire la requête d'heures du calculateur derrière une
  interface `HourCollector` et fournir deux implémentations —
  `AcademicHourCollector` (requête actuelle, inchangée sémantiquement) et
  `ProfessionalHourCollector` (séances ECUE). Le calculateur consomme la
  **concaténation** des deux, triée par date.
- **Rationale** : le cœur du calcul (semaines, heures sup, salaire, mixte) est
  correct et testé ; seule son alimentation est incomplète. Isoler la collecte
  rend chaque source testable seule et rend une 3ᵉ origine (formateurs, encadrement)
  ajoutable sans toucher au calcul.
- **Alternative rejetée** : une `UNION ALL` SQL unique entre les deux chaînes —
  requête illisible, jointures incompatibles (`class_courses` vs `professional_ecue`),
  et impossible à tester origine par origine.

### D-R4 — Statut de réalisation + validation explicite sur la séance ECUE

- **Décision** : ajouter à `professional_ecue_seances` un `statut`
  (`planifiee` | `realisee` | `annulee`, défaut `planifiee`) **et** un couple
  `validated_by` / `validated_at`. Une séance est payable si et seulement si
  `statut = 'realisee'` **ET** `validated_at IS NOT NULL` **ET**
  `enseignant_id IS NOT NULL` **ET** horaires complets.
- **Rationale** : deux notions distinctes qu'il serait faux de confondre. Le
  statut est un **fait pédagogique** (le cours a eu lieu), constaté par
  l'enseignant ou la scolarité. La validation est un **acte de gestion** (cette
  séance est payable), posé par l'administration. Les fusionner ferait de tout
  constat pédagogique un engagement financier.
- **Précision** : la saisie de présences est retenue comme **indice** de
  réalisation (proposition automatique dans l'écran), jamais comme déclencheur
  automatique du paiement.
- **Alternative rejetée** : déduire la réalisation de l'existence de lignes dans
  `professional_ecue_attendance` — un enseignant peut faire l'appel puis annuler,
  ou faire cours sans appel ; l'indice n'est pas la preuve.

### D-R5 — Durée déduite des horaires, jamais saisie

- **Décision** : `duree_heures = (heure_fin - heure_debut)` en heures décimales,
  calculée à la lecture. Aucune colonne de durée stockée. Une séance sans
  `heure_debut` **ou** sans `heure_fin` n'est pas validable (message explicite).
- **Rationale** : une durée stockée en plus des horaires crée deux vérités qui
  divergent au premier décalage d'horaire. Le coût est nul : les deux colonnes
  existent déjà.
- **Conséquence** : la contrainte `CHECK (heure_fin >= heure_debut)` existante
  suffit à garantir une durée non négative.

### D-R6 — Tarification : table dédiée `professional_ecue_hourly_rates`

- **Décision** : nouvelle table calquée sur `course_hourly_rates`
  (ECUE + enseignant optionnel + période de validité + `EXCLUDE USING gist`
  anti-chevauchement), plutôt que d'élargir `course_hourly_rates`.
- **Rationale** : `course_hourly_rates.course_id` référence `courses(id)`.
  L'élargir imposerait soit une colonne `ecue_id` supplémentaire avec un `CHECK`
  d'exclusivité, soit une FK polymorphe — dans les deux cas, la contrainte
  `EXCLUDE` existante (qui porte sur `COALESCE(course_id, …)`) devrait être
  reconstruite pour rester correcte. Une table sœur est plus simple et laisse le
  chemin académique strictement intact.
- **Résolution du tarif** (ordre figé) : `(ecue_id, enseignant_id)` →
  `(ecue_id, NULL)` → `teacher_payment_configs.default_hourly_rate`.
- **Alternative rejetée** : tarif porté par `professional_session_ecue_teachers`
  (affectation) — il faudrait le ressaisir à chaque cohorte, et un tarif n'est pas
  une propriété de l'affectation mais du couple matière/intervenant.

### D-R7 — Régularisation de `payment_hour_details` (écart E4)

- **Décision** : dans la migration de cette feature —
  `teaching_hours_id` devient **NULLABLE** ; ajout de `source`
  (`academique` | `professionnel`, NOT NULL), `attendance_session_id`
  (→ `teacher_attendance_sessions`, nullable) et `seance_id`
  (→ `professional_ecue_seances`, nullable) ; un `CHECK` impose **exactement une**
  référence d'origine renseignée, cohérente avec `source`.
- **Rationale** : la FK actuelle rend le chemin `hourly` académique inopérant
  (E4). Corriger en même temps qu'on ajoute l'origine professionnelle évite de
  livrer une feature qui « marche » sur une base déjà fausse — et évite surtout
  de reproduire l'erreur côté professionnel.
- **Précaution** : la contrainte d'unicité
  `unique_teaching_hour_per_payment (payment_id, teaching_hours_id)` devient
  inopérante avec des NULL ; elle est remplacée par deux index uniques partiels,
  un par origine.
- **Vérification préalable obligatoire** : constater en base de dev **et** de
  production si la FK `payment_hour_details_teaching_hours_id_fkey` existe encore
  ou a été retirée à la main. Le résultat conditionne la forme exacte de la
  migration (`DROP CONSTRAINT IF EXISTS`).

### D-R8 — Régularisation de `payment_periods.academic_year_id` (écart E5)

- **Décision** : ajouter la colonne au schéma versionné
  (`ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id)`),
  **nullable**, avec index, dans la même migration.
- **Rationale** : le code la considère déjà comme acquise. Sans cette
  régularisation, une base reconstruite depuis les migrations plante au premier
  appel de `/payment-periods`. La rendre `NOT NULL` immédiatement casserait les
  lignes existantes dépourvues de valeur : le durcissement est reporté à une
  migration ultérieure, une fois le rattrapage constaté.
- **Alternative rejetée** : ne rien faire au motif que « ça marche en dev » —
  c'est précisément la définition d'une dérive de schéma.

### D-R9 — Devise depuis l'établissement (écart E6)

- **Décision** : `teacher_payments.currency` est renseignée à l'insertion depuis
  la devise du tenant (repli : `professional_ue.devise` dominante, puis `'XOF'`),
  et le défaut de colonne passe de `'EUR'` à `'XOF'`. Les paiements déjà
  enregistrés ne sont **pas** réécrits.
- **Rationale** : un défaut `'EUR'` sur une plateforme opérée en zone franc
  produit des bulletins faux. Ne pas réécrire l'historique : un montant passé a
  été approuvé tel quel.

### D-R9bis — Rétablir les deux garde-fous manquants (écarts E7, E8)

- **Décision** : `0103` **recrée** `unique_teacher_payment_per_period` sur
  `teacher_payments` et `payment_periods_no_overlap` (EXCLUDE) sur
  `payment_periods`, après contrôle des données existantes.
- **Rationale** : les deux sont directement sur le chemin de la feature. Sans
  E8, deux périodes qui se recouvrent font tomber une même séance validée dans
  les deux et la font payer **deux fois** — le risque existait déjà en
  académique, mais on ajoute une source d'heures, donc on l'aggrave. Sans E7,
  D-R2 (« un seul paiement ») n'est qu'une convention applicative.
- **Précaution** : la contrainte `EXCLUDE` échoue à la création si des périodes
  chevauchantes existent déjà. La migration doit donc **détecter et signaler**
  avant d'ajouter, plutôt que d'échouer sèchement en cours de déploiement.
- **Alternative rejetée** : s'en remettre au contrôle applicatif existant dans
  `payment-periods.ts` — il ne protège pas des insertions par script, ni des
  lignes déjà en base, ni de deux requêtes concurrentes.

### D-R10 — Surface d'écrans minimale : 2 nouveaux, 4 partagés

- **Décision** : le module professionnel gagne **deux** écrans propres —
  « Validation des séances » et « Tarifs horaires ECUE » — sous un sous-menu
  `Rémunération` du Module Professionnel. Périodes, Calcul, Gestion et Rapports
  restent les écrans existants, enrichis d'un **filtre d'origine**.
- **Rationale** : dupliquer les 6 écrans donnerait deux vérités sur le même
  enseignant et deux endroits où approuver le même paiement. Les deux écrans
  ajoutés sont exactement ceux qui n'ont pas d'équivalent (la validation
  académique lit une autre table ; les tarifs académiques portent sur `courses`).

### D-R11 — Rattachement d'une séance à une période par sa date

- **Décision** : une séance appartient à la période dont l'intervalle
  `[period_start, period_end]` contient sa **date**. Aucun prorata pour une
  séance à cheval (cas impossible en pratique : une séance ne dure pas plus d'une
  journée).
- **Rationale** : cohérent avec le traitement académique
  (`s.session_date BETWEEN …`), et lisible sur un bulletin.

### D-R12 — Pas de reprise rétroactive

- **Décision** : la migration initialise toutes les séances existantes en
  `statut = 'planifiee'`, `validated_at = NULL`. Aucun backfill en `realisee`,
  même pour les séances passées disposant de présences saisies.
- **Rationale** : un backfill produirait, au premier calcul, des paiements
  massifs sur des séances que personne n'a validées. La régularisation d'un
  historique est une décision de gestion, pas un effet de bord de migration.
- **Contrepartie** : l'écran de validation propose un filtre « séances passées
  avec présences saisies » pour rendre le rattrapage manuel rapide.

## 5. Inconnues levées

| Question | Réponse |
|---|---|
| Les enseignants du professionnel sont-ils dans `teachers` ? | Oui — FK directe depuis les 3 tables porteuses d'heures (§2). |
| Faut-il des périodes de paiement propres au professionnel ? | Non — les périodes sont des fenêtres de paie d'établissement (D-R1). |
| Où vit l'origine d'une heure ? | Sur `payment_hour_details`, pas sur `teacher_payments` (D-R2). |
| Le cumul d'heures sup mélange-t-il les origines ? | Oui, délibérément (D-R2). |
| Que fait-on des séances déjà en base ? | Rien : `planifiee`, non validées (D-R12). |
| L'affectation ECUE (`professional_session_ecue_teachers`) sert-elle au paiement ? | Non : c'est `professional_ecue_seances.enseignant_id` qui fait foi (l'intervenant réel, remplacement compris). L'affectation sert au **repli** quand la séance ne porte pas d'enseignant, et à proposer un défaut à la saisie. |

## 6. Risques

| Risque | Portée | Mitigation |
|---|---|---|
| La FK E4 a peut-être été retirée manuellement en prod | Migration | Constat en base avant écriture (D-R7) ; `DROP CONSTRAINT IF EXISTS`. **Sur dev : FK présente, 0 ligne de détail → rien à requalifier** |
| Une base de prod avec `academic_year_id` déjà présente | Migration | `ADD COLUMN IF NOT EXISTS`. **Sur dev : déjà présente** |
| Des périodes déjà chevauchantes empêchent de créer l'EXCLUDE (E8) | Migration | Détection préalable et message explicite ; ne pas échouer en cours de déploiement (D-R9bis) |
| Des paiements en double empêchent de créer l'unique (E7) | Migration | Idem ; sur dev la table est vide, le risque est en prod |
| **Prod non encore constatée** | Migration | T002 reste ouvert : exécuter le script sur la prod avant d'écrire `0103` |
| Double comptage si deux séances se chevauchent | Calcul | Détection et signalement avant validation (FR-007) |
| Recalcul sur paiement déjà approuvé | Calcul | Refus explicite + compte rendu (FR-025) |
| Volume : 500 séances × 100 enseignants | Performance | Collecte des heures en **une** requête par période (et non par enseignant), index `(tenant_id, date)` sur les séances (SC-006) |
