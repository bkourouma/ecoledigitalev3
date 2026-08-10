# Interfaces de statistiques — Espace Propriétaire (Owner)

**Statut** : brief de conception, à donner à Claude Code comme point de départ.
**Date** : 2026-07-22
**Périmètre** : menus « Cycles & Programmes », « Personnes », « Module Professionnel ».

---

## 0. Comment utiliser ce document

Ce document est le résultat d'un audit du code existant (pages web, routes API, services,
migrations SQL). Il contient :

- Un **état des lieux** de ce qui existe déjà — notamment un espace Owner **déjà livré**,
  qu'il ne faut ni recréer ni dupliquer (§1).
- Un **audit page par page** des trois menus, avec les données réellement disponibles (§2).
- Le **socle technique** à respecter : rôles, RLS, conventions API, librairies (§3).
- Le **modèle de données de référence** et ses pièges (§4). **À lire avant d'écrire du SQL.**
- Les **interfaces proposées**, spécifiées une par une (§5).
- La **dette technique bloquante** à corriger d'abord (§6).
- Un **plan de livraison** en lots (§7).

Convention de lecture : ✅ existe et fonctionne · ⚠️ existe mais limité/faux · ❌ n'existe pas.

---

## 1. État des lieux — l'espace Owner existe déjà

Un module propriétaire complet a été livré (spec `specs/027-compte-proprietaire-owner/`).
**Toute nouvelle interface doit s'y greffer, pas le remplacer.**

### 1.1 Ce qui est en place

| Couche | Élément |
|---|---|
| Rôle | `roles.key = 'owner'` (libellé « Proprietaire »), seedé par tenant |
| Middleware API | `apps/api/src/middlewares/requireOwner.ts` — `requireOwner`, `requireOwnerOrAdmin` |
| Garde web | `apps/web/src/app/owner/layout.tsx` (redirige vers `/unauthorized`) |
| Menu | `ownerMenuItems` dans `apps/web/src/components/layout/Sidebar.tsx` |
| Routes API | `apps/api/src/routes/owner/index.ts`, préfixe `/api/v1/owner` |
| Services | `apps/api/src/services/owner-*.service.ts` (7 fichiers) |
| Contracts | `packages/contracts/src/owner.schema.ts` |
| Composants | `apps/web/src/components/owner/` (`KpiGrid`, `RecoveryByCycleChart`, `SemesterAveragesChart`, `AttendanceHeatmap`, `AlertsPanel`, `*SummaryCard`) |
| Hooks | `apps/web/src/lib/hooks/use-owner-*.ts` |
| Alertes | table dédiée avec RLS + acquittement |

### 1.2 Pages Owner existantes

| Route | Contenu actuel |
|---|---|
| `/owner/dashboard` | Revenus du mois, taux de recouvrement, élèves inscrits, assiduité 30 j, 3 cartes de synthèse, alertes |
| `/owner/finances` | Attendu/collecté, taux de recouvrement, impayés, total paie, recouvrement par classe, échéances en retard, paie enseignants |
| `/owner/finances/rapport` | Export PDF / CSV |
| `/owner/academique` | Moyennes par classe et par période, réussite par programme, assiduité 8 semaines, classes à risque |
| `/owner/staff` | Heures données/validées par enseignant, cours sans enseignant, paie en attente |
| `/owner/formations` | Sessions actives, inscriptions, CA, entreprises clientes |
| `/owner/alertes` | Liste + acquittement |
| `/owner/acces` | Gestion des rôles utilisateurs |

Endpoints correspondants : `GET /api/v1/owner/{dashboard,finances,academic,staff,formations,alerts}`,
`PATCH /alerts/:id/acknowledge`, `GET /reports/financial?format=pdf|csv`,
`PATCH /payroll/:id/validate`, `GET /roles/assignable`, `GET /users`, `PATCH /users/:userId/roles`.

### 1.3 Le trou dans la raquette

> **L'espace Owner ne couvre absolument pas le Module Professionnel (LMD : filière → semestre → UE → ECUE).**

`/owner/academique` travaille sur `classes` / `courses` / le module scolaire classique.
`/owner/finances` travaille sur `payment_transactions` (académique). `/owner/formations` cible
les formations professionnelles courtes (`formations-pro`), **pas** le module UE/ECUE.

Or c'est le module professionnel qui porte aujourd'hui :
les inscriptions par UE, les paiements `professional_payments`, les bulletins LMD, les crédits,
les présences par séance, l'emploi du temps. **C'est le chantier principal de ce document.**

### 1.4 Incohérence à corriger au passage

Les pages Owner **n'utilisent pas recharts** alors que la librairie est installée et utilisée
partout ailleurs (`/admin/finances`, `/attendance/admin`, `/teacher/reports`). Elles dessinent
des barres en CSS/Tailwind maison. Les nouvelles pages doivent utiliser **recharts**, et les
composants existants (`RecoveryByCycleChart`, `SemesterAveragesChart`, `AttendanceHeatmap`)
devraient être migrés dans un second temps.

---

## 2. Audit des pages existantes

### 2.1 Menu « Cycles & Programmes »

| Page | Route | Données affichées | Filtres | KPI actuels |
|---|---|---|---|---|
| Cycles | `/academic/cycles` | `name`, `code`, `certificationLevel`, `description`, `status`, `type`, `durationMonths` | recherche texte, statut | Total, Actifs, Brouillons, Durée moyenne |
| Filières | `/academic/programmes` | `name`, `code`, `cycle`, `domaine`, `description`, `status` | statut, cycle | Total, Actifs, Brouillons, Cycles liés |
| Matières | `/academic/courses` | `name`, `programme`, `bilanType`, `cm`, `td`, `tp`, `coef`, `vhh` | programme uniquement | Total, Programmes liés |

**Limites constatées**

- ⚠️ **Tous les KPI sont calculés côté client** (`useMemo` sur le tableau chargé). Cycles et
  Matières chargent `limit: 20` par défaut → **« Total cycles » et « Total matières » sont faux
  au-delà de 20 lignes.** Seul `useProgrammes` boucle pour tout charger.
- ❌ Aucune vue transversale cycle → filière → matière/UE.
- ❌ Aucun croisement avec les effectifs, la charge horaire ou le chiffre d'affaires.
- ⚠️ `programmes.ects_credits`, `academic_year`, `objectives` et `courses.semester`, `credits`,
  `objectives` existent en base et sont mappés par l'API mais jamais affichés.
- ⚠️ `GET /courses` fait des `JOIN` (pas `LEFT JOIN`) sur `programmes` et `bilan_types` :
  une matière orpheline est **invisible** dans l'API.
- ⚠️ Boutons « Gérer les étudiants », « Voir le planning », « Exporter les données » sur le
  détail matière : présents mais **sans handler** (inertes).
- ⚠️ Le détail matière affiche « Étudiants inscrits : 0 » et « Taux de présence : - » **en dur**.

### 2.2 Menu « Personnes »

| Page | Route | Données affichées | Filtres | KPI actuels |
|---|---|---|---|---|
| Enseignants | `/academic/teachers` | `firstName/lastName`, `employeeNumber`, `contractType`, `email`, `phone`, `hireDate`, `specialties`, `status`, mot de passe initial | recherche, statut, contrat, spécialité | Total, Actifs, CDI, Vacataires |
| Étudiants | `/academic/students` | nom, matricule, année, classe, filière, sexe, email, téléphone, naissance | recherche, année académique, filière | Total uniquement |
| Parents | `/academic/parents` | `name`, `email`, `childrenCount`, `createdAt`, mot de passe | recherche | Total, Avec enfants, Total enfants, Moyenne enfants |
| Inscriptions en ligne | `/academic/registrations` | `accountType`, identité, `status`, détails JSONB, enfants | recherche, statut, type de compte | ❌ aucun |

**Limites constatées**

- ⚠️ Les KPI parents sont calculés **sur la page courante** (pagination 20) → faux.
- ❌ Aucune répartition par sexe, âge, nationalité, filière, année — alors que
  `student_profiles.gender`, `date_of_birth`, `nationality`, `is_repeating` existent.
- ❌ Aucun entonnoir de conversion sur les inscriptions en ligne. L'API renvoie pourtant
  `pendingCount`, **jamais affiché**.
- ❌ Aucune vue sur la charge d'enseignement par enseignant, ni sur les enseignants non affectés.
- ⚠️ Filtre statut absent de la page Étudiants alors que l'API l'accepte.
- ⚠️ `GET /students` déclenche `enforceSequentialMatricules()` qui **réécrit les matricules de
  tout le tenant à chaque listage**. Ne jamais appeler cet endpoint depuis un job de stats.

### 2.3 Menu « Module Professionnel »

| Page | Route | Données | Filtres | KPI actuels |
|---|---|---|---|---|
| UE | `/professionnel/admin/ue` | `code`, `libelle`, filière, `nb_uv`, `prix`, `devise`, `statut`, `categorie` | filière | Total UE, Filières couvertes |
| ECUE | `/professionnel/admin/matieres` | `code`, `libelle`, `credits`, UE liées, `bilan_type` | filière, UE | Total ECUE, ECUE actives |
| Semestres | `/professionnel/admin/semestres` | `libelle`, filière, `nb_ue`, `nb_uv` | filière (serveur) | Total semestres, UE regroupées |
| Sessions | `/professionnel/admin/sessions` | lots, `libelle`, filière, semestre, période, statut, crédits | filière + onglets actives/historique | Total sessions, Sessions ouvertes |
| Inscriptions | `/professionnel/admin/inscriptions` | écran d'inscription en lot (sessions × étudiants) | filière, recherche | produit cartésien, created/skipped/errors |
| Étudiants inscrits | `/professionnel/admin/inscrits` | groupé étudiant × filière, matricule, statut agrégé | filière, statut, recherche | N étudiants · M inscriptions |
| Paiements | `/professionnel/admin/paiements` | carte par étudiant, dû/payé/reste, historique, reçus PDF | filière, règlement, recherche | Attendu, Encaissé, Reste, Étudiants, Confirmés |
| Salles | `/academic/classrooms` | `name`, `code` (seulement) | recherche, type, statut, bâtiment | Total, Disponibles, Occupées, Capacité totale |
| Planning | `/professionnel/admin/planning` | grille 6 j × 12 créneaux, ECUE, enseignant, salle | filière, semestre | ❌ aucun |
| Présences | `/professionnel/admin/presences` | récap par étudiant + journal des appels | filière, statut session, semestre, recherche | Appels effectués, Heures pointées, Heures d'absence, Taux de présence |
| Notes | `/professionnel/admin/notes` | grille étudiants × ECUE (devoirs / examen / moyenne) | filière, semestre, UE, session 1/2 | ❌ aucun |
| Bulletins | `/professionnel/admin/bulletins` | moyenne, crédits, décision, statut bulletin | filière, semestre | Étudiants, Admis, Rattrapage, Ajournés |
| Historique bulletins | `.../bulletins/historique` | matrice étudiants × semestres + statut filière | filière, statut, année scolaire, recherche | Étudiants, Bulletins générés, Filière validée |

**Limites constatées**

- ❌ **Aucune consolidation multi-filières.** Tous les écrans imposent de choisir une filière ;
  un propriétaire ne peut jamais voir son établissement dans son ensemble.
- ❌ Aucune série temporelle (encaissements par mois, évolution des effectifs, des moyennes).
- ❌ Aucun taux d'occupation des salles, ni charge par enseignant, malgré des données complètes
  dans `professional_emploi_temps` et `professional_ecue_seances`.
- ❌ Aucun indicateur de qualité pédagogique : taux de réussite par ECUE/UE, ECUE les plus
  échouées, poids de la session 2, notes éliminatoires.
- ⚠️ Les pages Notes et Planning n'ont **aucun KPI**.
- ⚠️ Les KPI Paiements excluent silencieusement les UE « Conduite » et les inscriptions annulées
  (voir §4.4) — un chiffre owner devra soit répliquer cette règle, soit l'expliciter.

---

## 3. Socle technique à respecter

### 3.1 Rôles et sécurité

- Rôles en base (`roles.key`) : `admin`, **`owner`**, `student`, `parent`, `teacher`, `formateur`.
- `super_admin` est un **scope séparé** (table `super_admins`, JWT distinct, `/api/v1/super-admin/*`).
- Toute route de stats owner : `preHandler: requireOwner` (ou `requireOwnerOrAdmin` si l'admin
  doit aussi y accéder — à trancher page par page, cf. `/owner/acces` qui est mixte).
- Un owner **ne peut pas créer d'owner** (`OWNER_ASSIGNABLE_ROLE_KEYS`).

### 3.2 Multi-tenant

- Colonne : **`tenant_id` UUID** partout (jamais `school_id`).
- Isolation par **RLS PostgreSQL** : `USING (tenant_id = current_setting('app.tenant_id', true)::UUID)`.
- Chaîne : `plugins/tenant-context.ts` → `plugins/rls-context.ts` → `services/rls-context.service.ts`.
- **Convention en vigueur dans les services owner** : après `pool.connect()`, faire
  `SELECT set_config('app.tenant_id', $1, true)` **et** filtrer explicitement `WHERE tenant_id = $1`
  (double ceinture). À reproduire.

### 3.3 Conventions API

```ts
// apps/api/src/services/owner-<domaine>.service.ts
export async function fetchOwnerX(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters?: XFilters,
): Promise<XResponse>
```

- Fonctions exportées (pas de classe), SQL brut `pg`, `client.release()` en `finally`.
- Route : préfixe déclaré au `register` dans `apps/api/src/index.ts`, chemins relatifs dans le
  fichier de route.
- Réponse **validée en sortie** par Zod : `reply.send(Schema.parse(data))`.
- Erreurs : `{ success: false, error: "<Titre>", message: "<message FR>" }`.
- Contracts Zod dans `packages/contracts/src/`, pattern `XSchema` + `export type X = z.infer<typeof XSchema>`.

### 3.4 Conventions web

```ts
// apps/web/src/lib/hooks/use-owner-<x>.ts
useQuery({
  queryKey: ["owner-<x>", tenantId, filters],
  queryFn: ...,                       // headers via createApiHeaders(session)
  enabled: !!session && tenantId !== "no-tenant",
  staleTime: 60_000,
})
```

- UI : **shadcn/ui** (`apps/web/src/components/ui/`) — c'est ce qu'utilise l'espace owner.
  Ne pas introduire Ant Design dans ces pages.
- Icônes : `lucide-react`. Utilitaire `cn` dans `apps/web/src/lib/utils.ts`.
- Graphiques : **recharts ^2.12.0** (seule librairie installée).
- Langue : UI et messages en français, identifiants de code en anglais.
- Monnaie : **FCFA**, `Intl.NumberFormat("fr-FR")`. En base la devise est `XOF`
  (`professional_orders.devise`, `professional_ue.devise`) — la conversion d'affichage
  `XOF → FCFA` est faite côté front.

### 3.5 Exports disponibles

| Besoin | Outil | Chemin |
|---|---|---|
| PDF serveur | puppeteer (503 si Chrome absent) | `apps/api/src/services/pdf-generation.service.ts` |
| CSV serveur | BOM `﻿` pour Excel FR | `owner-finances.service.ts` (`buildOwnerFinancialReportCsv`) |
| Jobs d'export async | `POST /api/v1/admin/exports/*` puis `GET /jobs/:id/download` | `apps/api/src/routes/exports.ts` |
| PDF client | jsPDF + jspdf-autotable | `apps/web/src/lib/bulletin-pdf.ts`, `receipt-pdf.ts` |
| Excel client | xlsx + file-saver | `apps/web/src/lib/utils/*-export.ts` |
| Word client | docx | `apps/web/src/lib/emploi-temps-docx.ts` |
| Téléchargement authentifié | `downloadFileWithAuth()` | `apps/web/src/lib/file-download-utils.ts` |

---

## 4. Modèle de données de référence

### 4.1 Chaîne pédagogique

```
tenants
 └─ cycles ─────────────────┐
      └─ programmes (= FILIÈRE, pivot des deux branches)
           ├─ [branche académique]  courses ─ class_courses ─ classes ─ student_enrollments
           └─ [branche professionnelle]
                ├─ professional_semestres
                │     ├─ professional_semestre_ue      (semestre → UE, composition ACTUELLE)
                │     └─ professional_semestre_sessions (semestre → session, rattachement)
                └─ professional_ue  (prix, devise, nb_uv, categorie)
                     ├─ professional_ue_ecue (N:N, coefficient, ordre, est_obligatoire)
                     │     └─ professional_ecue (credits, mutualisée, PAS de filiere_id)
                     ├─ professional_ue_prerequisites (DAG, même filière)
                     └─ professional_ue_sessions (date_debut, date_fin, capacite_max, statut)
                          ├─ professional_enrollments ─ professional_orders ─ professional_payments
                          ├─ professional_session_ecue_teachers
                          ├─ professional_ecue_seances ─ professional_ecue_attendance
                          ├─ professional_emploi_temps
                          └─ professional_ecue_notes / professional_ecue_results
                                └─ professional_bulletins (data JSONB)
```

### 4.2 Tables clés et colonnes utiles aux agrégations

| Table | Colonnes pour les stats |
|---|---|
| `cycles` | `name`, `code`, `type`, `duration_months`, `status` |
| `programmes` | `name`, `code`, `cycle_id`, `domaine`, `status`, `ects_credits` |
| `courses` | `programme_id`, `coef` NUMERIC(8,2), `cm`/`td`/`tp`/`vhh` (VARCHAR), `hours_total`, `status` |
| `teachers` | `contract_type`, `status`, `hire_date`, `hourly_rate`, `specialties[]`, `user_id` (nullable) |
| `student_profiles` | `gender`, `date_of_birth`, `nationality`, `is_repeating`, `status`, `student_number`, `establishment_matricule` |
| `student_parents` | `parent_id` → **`users.id`**, `student_id`, `relationship_type` |
| `registration_requests` | `account_type`, `status`, `created_at`, `reviewed_at`, `details` JSONB |
| `professional_ue` | `filiere_id`, `prix`, `devise`, `nb_uv`, `categorie`, `statut` |
| `professional_ecue` | `credits` (INTEGER nullable), `statut` |
| `professional_ue_ecue` | `coefficient`, `ordre`, `est_obligatoire` |
| `professional_ue_sessions` | `date_debut`, `date_fin`, `capacite_max`, `statut`, `enseignant_id`, `classroom_id` |
| `professional_enrollments` | `statut`, `prix_unitaire`, `order_id`, `student_id`, `ue_session_id` |
| `professional_orders` | `reference`, `montant_total`, `devise`, `statut`, `student_id` |
| `professional_payments` | `montant`, `mode`, `statut`, `paid_at`, `receipt_number`, `order_id` |
| `professional_ecue_seances` | `date`, `heure_debut`, `heure_fin`, `enseignant_id`, `classroom_id` |
| `professional_ecue_attendance` | `statut` ∈ present/absent/retard/excuse, `seance_id`, `student_id` |
| `professional_ecue_notes` | `nature` ∈ devoir/examen, `note`, `note_max`, `session` ∈ 1/2 |
| `professional_ecue_results` | `moyenne`, `moyenne_devoirs`, `note_examen`, `eliminee`, `validee`, `session_obtention` |
| `professional_bulletins` | `statut` ∈ provisoire/definitif, `generated_at`, `data` JSONB |
| `professional_emploi_temps` | `jour` 1-7, `heure_debut`, `heure_fin`, `date_debut`, `date_fin`, `classroom_id`, `enseignant_id` |
| `classrooms` | `type`, `capacity`, `building`, `floor`, `status`, `is_active` |

**Clés JSONB de `professional_bulletins.data`** (déjà extraites par `getBulletinHistory`) :
`moyenne_session`, `credits_valides`, `credits_total`, `decision`, `statut_etudiant`,
plus `rang`, `effectif`, `nb_ue_validees`, `nb_ue_total`, `session_globale`, `categories`, `ues`.

### 4.3 Statuts (tous en TEXT + CHECK dans le module pro, pas des ENUM)

| Colonne | Valeurs |
|---|---|
| `professional_enrollments.statut` | `en_attente_paiement`, `confirmee`, `terminee`, `annulee` |
| `professional_orders.statut` | `brouillon`, `en_attente_paiement`, `payee`, `annulee` |
| `professional_payments.statut` | `initie`, **`confirme`**, `echoue`, `rembourse` |
| `professional_payments.mode` | `especes`, `mobile_money`, `virement`, `autre` |
| `professional_ue_sessions.statut` | `brouillon`, `ouvert`, `complet`, `en_cours`, `termine`, `annule` |
| `professional_ue.statut` / `professional_ecue.statut` | `actif`, `inactif` |
| `professional_ecue_attendance.statut` | `present`, `absent`, `retard`, `excuse` |

Vrais ENUM PostgreSQL (module académique) : `cycle_type`, `cycle_status`, `programme_status`,
`course_status`, `delivery_mode`, `contract_type`, `teacher_status`, `student_status`,
`parent_relationship`, `gender_type`, `enrollment_status`, `classroom_type`, `classroom_status`.

### 4.4 ⚠️ Pièges SQL — à lire impérativement

1. **`professional_payments` n'a ni `student_id` ni `enrollment_id`.**
   Passer par `order_id → professional_orders.student_id`, puis `professional_enrollments.order_id`
   pour remonter à l'UE et à la filière.

2. **Toujours filtrer `professional_payments.statut = 'confirme'`.** C'est le seul filtre appliqué
   par toute la couche applicative.

3. **`professional_orders.statut = 'payee'` ne prouve aucun encaissement.**
   `adminUpdateEnrollment` force la commande à `payee` dès qu'une inscription passe à
   `confirmee`/`terminee`, sans ligne de paiement. **Toujours calculer l'encaissé depuis
   `SUM(professional_payments.montant)`.**

4. **Un règlement utilisateur unique produit N lignes `professional_payments`** (une par commande
   touchée), chacune avec son `receipt_number`. Pour compter des *transactions métier*, grouper par
   `(student_id, paid_at)` — pas `COUNT(*)`. La `reference_transaction` n'est portée que par la
   première ligne, les autres sont `NULL`.

5. **Double chemin semestre → sessions.** Les services notes/bulletins/présences utilisent
   systématiquement les deux :
   ```sql
   s.id  IN (SELECT ue_session_id FROM professional_semestre_sessions WHERE semestre_id=$2 AND tenant_id=$1)
   OR s.ue_id IN (SELECT ue_id     FROM professional_semestre_ue       WHERE semestre_id=$2 AND tenant_id=$1)
   ```
   ⚠️ Les services *emploi du temps* ne passent que par `professional_semestre_sessions` — écart connu.

6. **La « Conduite » est détectée par heuristique textuelle**, sans colonne dédiée :
   `e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%'`.
   Elle est exclue des calculs de résultats, **exclue des paiements par l'UI**, mais **réinjectée
   comme pseudo-UE dans le bulletin** (elle compte dans la moyenne et les crédits).

7. **`professional_ue_ecue.coefficient` n'est jamais lu** par le moteur de calcul.
   La pondération réelle utilise `professional_ecue.credits`. De même, `professional_ue.nb_uv` est
   stocké et affiché mais la pondération UE utilise `Σ credits des ECUE`. Les deux totaux peuvent
   diverger (cf. migrations correctives `0083`, `0084`, `0085`).

8. **`GET /api/v1/professional/ue-sessions` a un effet de bord** : il exécute
   `UPDATE professional_ue_sessions SET statut='termine' WHERE date_fin < CURRENT_DATE AND statut NOT IN ('termine','annule')`.
   **Ne jamais l'appeler depuis un job de statistiques.** Requêter la table directement.

9. **`GET /api/v1/students` réécrit tous les matricules du tenant** (`enforceSequentialMatricules`).
   Même consigne.

10. **Il n'existe pas de table `parents`.** Un parent est une ligne `users` avec le rôle `parent` :
    ```sql
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
    JOIN roles r ON r.id = ur.role_id AND r.key = 'parent'
    WHERE COALESCE(u.is_technical_account, false) = false
    ```

11. **`teachers.user_id` est nullable** : un enseignant peut exister sans compte de connexion.

12. **Migration 0069 destructive** : `professional_subjects`, `professional_subject_sessions`,
    `professional_subject_prerequisites` sont **DROP CASCADE**. De 0061 ne survivent que
    `professional_orders` et `professional_payments`. Ne pas s'appuyer sur les tables `*_subject_*`.

13. **Il n'existe aucune « mention » LMD en base.** `appreciation(m)` est un calcul **front
    uniquement** (`apps/web/src/lib/bulletin-format.ts`), jamais persisté :
    `<10 Insuffisant · <12 Passable · <14 Assez Bien · <16 Bien · <18 Très Bien · sinon Excellent`.
    Si l'owner doit voir des mentions, il faudra soit recalculer côté API, soit réutiliser cette
    fonction — **mais alors la partager**, pas la dupliquer.

### 4.5 Règles de calcul LMD (`apps/api/src/services/bulletin-calc.ts`)

```
POIDS_DEVOIRS = 0.4          POIDS_EXAMEN = 0.6
SEUIL_VALIDATION = 10        SEUIL_ELIMINATOIRE = 5
SEMESTRE_CREDITS_REQUIS = 20 ANNEE_SUP_CREDITS = 48 (strictement supérieur)
```

- Normalisation : `(note / note_max) * 20`.
- Moyenne devoirs : **arithmétique simple**, pas pondérée.
- Note ECUE = `moyDevoirs * 0,4 + noteExamen * 0,6`. Sans note d'examen → `null` (ECUE en cours).
  Devoirs absents mais examen présent → devoirs comptés `0`.
- Moyenne UE = `Σ(note_ECUE × credits_ECUE) / Σ credits_ECUE`.
- Moyenne session = `Σ(moyenne_UE × credits_UE) / Σ credits_UE`.
- ECUE validée si `note >= 10` **ou** validation manuelle. Éliminée si `note < 5`.
- UE validée si `moyenne >= 10` **et** aucune ECUE éliminatoire non rattrapée **et** aucune ECUE
  sans note.
- ⚠️ **Divergence connue** : `bulletin-calc.ts` expose `semestreValide(credits) = credits >= 20`,
  mais `professional-bulletin.service.ts` ne l'utilise pas et applique
  `ues.every(u => u.validee)` — pas de compensation inter-UE. **Toute statistique de validation
  de semestre doit suivre la règle du service, pas celle de `bulletin-calc.ts`.**
- Décision : `admis` si semestre validé, sinon `rattrapage` si au moins une UE en rattrapage,
  sinon `ajourne`.
- Sessions : la note manuelle prime sur l'évaluation ; `ORDER BY session DESC LIMIT 1` → S2 écrase S1.
- Rang : `nb d'étudiants strictement au-dessus + 1`, `null` si effectif > 300.

---

## 5. Interfaces proposées

Sept écrans, plus l'enrichissement du dashboard. Chacun est spécifié avec sa route, ses KPI,
ses visualisations, ses filtres, son endpoint et les tables à requêter.

**Principes transverses**

- Toutes les agrégations sont faites **en SQL côté API**, jamais en JS côté client
  (c'est le défaut principal des pages existantes).
- Toutes les pages acceptent au minimum les filtres : **période**, **filière**, **cycle**.
- Filière = « toutes » par défaut : l'owner voit son établissement entier d'abord, puis affine.
- Chaque page expose un **export** (CSV a minima, PDF pour les vues de synthèse).
- Chaque KPI affiche une **variation vs période précédente** quand la donnée le permet.
- Aucun chiffre affiché sans que sa règle de calcul soit documentée dans le code du service.

---

### 5.A — `/owner/pedagogie` — Pilotage pédagogique LMD ⭐ priorité 1

**Objectif** : donner au propriétaire la vue de la performance académique du module professionnel,
toutes filières confondues. C'est le grand manque actuel.

**KPI (ligne de 5)**

| KPI | Calcul |
|---|---|
| Taux de réussite | `count(decision='admis') / count(*)` sur `professional_bulletins` du périmètre |
| Moyenne générale | `avg((data->>'moyenne_session')::float8)` |
| Crédits validés | `Σ credits_valides / Σ credits_total` |
| Taux de rattrapage | `count(decision='rattrapage') / count(*)` |
| Bulletins définitifs | `count(statut='definitif') / count(*)` |

**Visualisations**

1. **Barres empilées — Décisions par filière** : admis / rattrapage / ajourné, en % et en valeur absolue.
2. **Courbe — Évolution de la moyenne par semestre** (axe X = semestres ordonnés, une série par filière,
   filières masquables via la légende).
3. **Barres horizontales — Top 15 des ECUE les plus échouées** :
   `count(*) FILTER (WHERE validee = false) / count(*)` sur `professional_ecue_results`,
   avec le nombre de notes éliminatoires (`eliminee = true`) en second segment.
   → C'est l'indicateur d'action le plus direct pour un propriétaire.
4. **Tableau — Santé par UE** : `code`, `libelle`, filière, `categorie`, effectif, moyenne,
   % validation, % éliminatoires, % obtenus en session 2.
5. **Jauge — Poids de la session 2** : part des validations avec `session_obtention = 2`.
6. **Distribution — Histogramme des moyennes** par tranches (`<5`, `5-8`, `8-10`, `10-12`, `12-14`,
   `14-16`, `>16`) avec les seuils 5 et 10 matérialisés.

**Filtres** : année scolaire (pivot septembre sur `min(session.date_debut)`), filière (multi),
semestre, statut de session (`en_cours` / `terminee` / tous), catégorie d'UE
(`fondamentale` / `specialite` / `culture_generale`).

**Endpoint** : `GET /api/v1/owner/pedagogie`
Query : `annee_scolaire`, `filiere_ids[]`, `semestre_id`, `statut`, `categorie`.

**Tables** : `professional_bulletins`, `professional_ecue_results`, `professional_ecue_notes`,
`professional_ue`, `professional_ecue`, `professional_ue_ecue`, `professional_semestres`,
`professional_ue_sessions`, `professional_enrollments`, `programmes`.

**Pièges applicables** : §4.4 points 5, 6, 7, 13 et §4.5 (règle de validation du semestre).

---

### 5.B — `/owner/finances/professionnel` — Recouvrement UE ⭐ priorité 1

**Objectif** : suivre le chiffre d'affaires et le recouvrement du module professionnel, absent de
`/owner/finances` qui ne couvre que le module académique.

**KPI (ligne de 5)**

| KPI | Calcul |
|---|---|
| Chiffre d'affaires attendu | `Σ professional_orders.montant_total` (hors `annulee`) |
| Encaissé | `Σ professional_payments.montant WHERE statut='confirme'` |
| Taux de recouvrement | encaissé / attendu |
| Reste à recouvrer | `max(0, attendu − encaissé)` |
| Étudiants non soldés | nb d'étudiants avec `reste > 0.5` |

**Visualisations**

1. **Courbe + barres — Encaissements mensuels** sur 12 mois glissants :
   `TO_CHAR(COALESCE(paid_at, created_at), 'YYYY-MM')`, barres = montant, courbe = nb de transactions
   métier (groupées par `(student_id, paid_at)`, cf. §4.4 point 4).
2. **Donut — Répartition par mode de paiement** : `especes`, `mobile_money`, `virement`, `autre`.
3. **Barres horizontales — Taux de recouvrement par filière**, seuils couleur 80 % / 60 %
   (aligné sur `RecoveryByCycleChart` existant).
4. **Tableau — Top 20 des impayés** : étudiant, matricule, filière, dû, payé, reste, ancienneté
   de la première inscription non soldée. Action : lien vers `/professionnel/admin/paiements`.
5. **Barres — Chiffre d'affaires par UE** (`professional_ue.prix × nb inscriptions confirmées`),
   pour identifier les UE porteuses.
6. **Entonnoir — Inscriptions** : créées → confirmées → terminées → annulées.

**Filtres** : période (mois / trimestre / année / année scolaire), filière, semestre,
mode de paiement, état de règlement (`non_regle` / `partiel` / `solde`).

**Endpoint** : `GET /api/v1/owner/finances/professionnel`
Query : `period`, `date_debut`, `date_fin`, `filiere_ids[]`, `semestre_id`, `mode`, `etat`.

**Export** : CSV (BOM `﻿`) + PDF via `PDFGenerationService`, sur le modèle de
`GET /api/v1/owner/reports/financial`.

**Pièges applicables** : §4.4 points 1, 2, 3, 4, 6.

> **Décision à prendre** : l'UI actuelle exclut les UE « Conduite » du calcul des paiements.
> Recommandation : **les inclure** dans la vue owner (c'est du CA réel) et afficher une note de bas
> de tableau signalant l'écart avec l'écran admin. À valider avec le métier.

---

### 5.C — `/owner/assiduite` — Assiduité, salles et charge enseignante ⭐ priorité 2

**Objectif** : mesurer la présence réelle, l'occupation des locaux et la charge des enseignants —
trois données complètes en base et aujourd'hui totalement inexploitées en agrégat.

**KPI (ligne de 5)**

| KPI | Calcul |
|---|---|
| Taux de présence global | `count(*) FILTER (statut='present') / count(*)` sur `professional_ecue_attendance` |
| Heures d'absence cumulées | `Σ EXTRACT(EPOCH FROM (heure_fin − heure_debut))/3600 FILTER (statut='absent')` |
| Taux d'appels effectués | séances avec ≥1 pointage / total séances |
| Taux d'occupation des salles | heures planifiées / heures ouvrables × nb salles actives |
| Heures d'enseignement planifiées | `Σ` durée sur `professional_emploi_temps` |

**Visualisations**

1. **Heatmap — Assiduité par semaine × filière** (réutiliser/migrer `AttendanceHeatmap`).
2. **Barres horizontales — Étudiants les plus absents** : top 20 par heures d'absence,
   avec `heures_excusees` distinguées.
3. **Heatmap — Occupation des salles** : jour (1-6) × créneau (08h-20h), valeur = nb de salles
   occupées / nb de salles actives. Source `professional_emploi_temps`.
4. **Barres — Charge par enseignant** : heures/semaine depuis `professional_emploi_temps`,
   nb d'ECUE, nb de filières. Signaler les enseignants > seuil et les ECUE obligatoires
   **sans enseignant affecté** (`professional_session_ecue_teachers` manquant).
5. **Tableau — Salles sous-utilisées** : salle, capacité, heures occupées/semaine, taux.
   Croiser avec `classrooms.capacity` pour repérer les amphis utilisés en petit effectif.
6. **Courbe — Évolution du taux de présence** sur 12 semaines.

**Filtres** : période, filière, semestre, statut de session, bâtiment, type de salle, enseignant.

**Endpoint** : `GET /api/v1/owner/assiduite`
Query : `date_debut`, `date_fin`, `filiere_ids[]`, `semestre_id`, `building`, `classroom_type`.

**Tables** : `professional_ecue_attendance`, `professional_ecue_seances`,
`professional_emploi_temps`, `classrooms`, `professional_session_ecue_teachers`, `teachers`, `users`.

> **Note** : `professional_course_plannings` existe (migrations 0072/0073) mais **n'est pas utilisée
> par l'UI admin**, qui écrit dans `professional_emploi_temps`. Utiliser `professional_emploi_temps`
> comme source de vérité pour l'emploi du temps, et `professional_ecue_seances` pour les séances
> réellement tenues.

---

### 5.D — `/owner/referentiel` — Santé du catalogue ⭐ priorité 2

**Objectif** : vue transversale cycle → filière → { matières | UE → ECUE }, avec les incohérences
structurelles remontées. Remplace les KPI client faux des pages Cycles/Filières/Matières.

**KPI (ligne de 5)** : Cycles actifs · Filières actives · UE actives · ECUE actives ·
Crédits moyens par semestre.

**Visualisations**

1. **Treemap ou sunburst — Répartition cycle → filière → UE**, taille = nb d'étudiants inscrits.
2. **Tableau — Filières** : cycle, `domaine`, nb semestres, nb UE, nb ECUE, `Σ nb_uv`,
   `Σ credits ECUE`, effectif, CA attendu.
3. **Panneau « Incohérences détectées »** — c'est la vraie valeur de cet écran :
   - UE avec `nb_uv = 0` (jamais renseigné : le formulaire de création force `nb_uv = 0`)
   - UE où `nb_uv ≠ Σ credits des ECUE` (cf. migrations correctives 0083-0085)
   - ECUE avec `credits IS NULL` (elles faussent la moyenne UE, cf. §4.5)
   - ECUE non rattachées à une UE (orphelines)
   - UE sans ECUE
   - UE avec `prix = 0`
   - Semestres sans session
   - Sessions sans enseignant sur une ECUE obligatoire
   - Matières académiques avec `programme_id` ou `bilan_type_id` NULL (invisibles dans l'API)
4. **Barres — Mutualisation des ECUE** : nb d'UE par ECUE, pour visualiser la réutilisation.
5. **Graphe — Prérequis d'UE** par filière (DAG depuis `professional_ue_prerequisites`).

**Filtres** : cycle, filière, statut, catégorie d'UE.

**Endpoint** : `GET /api/v1/owner/referentiel`

**Tables** : `cycles`, `programmes`, `courses`, `professional_ue`, `professional_ecue`,
`professional_ue_ecue`, `professional_ue_prerequisites`, `professional_semestres`,
`professional_semestre_ue`, `professional_ue_sessions`, `bilan_types`.

---

### 5.E — `/owner/personnes` — Démographie et comptes ⭐ priorité 3

**Objectif** : connaître sa population (étudiants, enseignants, parents) et l'état des accès.

**KPI (ligne de 5)** : Étudiants actifs · Enseignants actifs · Parents · Ratio étudiants/enseignant ·
Comptes sans identifiants envoyés.

**Visualisations**

1. **Donut — Répartition par sexe** (`student_profiles.gender`), globale et par filière.
2. **Barres — Pyramide des âges** (calculée depuis `date_of_birth`, tranches de 2 ans).
3. **Barres — Effectifs par filière et par cycle**.
4. **Donut — Enseignants par type de contrat** (`permanent` / `temporary` / `freelance`).
5. **Tableau — Enseignants** : nom, contrat, statut, ancienneté (`hire_date`), nb d'ECUE,
   heures/semaine, nb de filières. Signaler ceux **sans compte utilisateur** (`user_id IS NULL`).
6. **Barres — Top 10 des nationalités** (`student_profiles.nationality`).
7. **Indicateurs de couverture** : étudiants sans parent rattaché, parents sans enfant,
   étudiants redoublants (`is_repeating`), comptes sans `initial_password` envoyé.

**Filtres** : année académique, cycle, filière, statut, sexe.

**Endpoint** : `GET /api/v1/owner/personnes`

**Tables** : `student_profiles`, `users`, `user_roles`, `roles`, `teachers`, `student_parents`,
`student_enrollments`, `classes`, `programmes`, `academic_years`.

**Piège** : parents = `users` + `user_roles` + `roles.key='parent'` avec exclusion
`is_technical_account` (§4.4 point 10).

---

### 5.F — `/owner/recrutement` — Entonnoir des inscriptions en ligne ⭐ priorité 3

**Objectif** : mesurer l'acquisition. La table `registration_requests` est riche et
**aucun indicateur n'en est tiré** aujourd'hui.

**KPI (ligne de 4)** : Demandes reçues · Taux de validation · Délai moyen de traitement
(`reviewed_at − created_at`) · Demandes en attente (`pendingCount`, déjà calculé par l'API et
jamais affiché).

**Visualisations**

1. **Entonnoir** : demandes → validées → comptes créés → identifiants envoyés.
2. **Courbe — Demandes par semaine**, séries `student` / `parent`.
3. **Donut — Répartition par statut** : `pending` / `approved` / `rejected`.
4. **Histogramme — Délai de traitement** par tranches (< 24 h, 1-3 j, 3-7 j, > 7 j).
5. **Tableau — Motifs de rejet** les plus fréquents (`rejection_reason`, groupés).
6. **Barres — Niveaux souhaités** depuis `details->>'currentYear'`.

**Filtres** : période, type de compte, statut.

**Endpoint** : `GET /api/v1/owner/recrutement`

**Table** : `registration_requests` (+ `users` pour l'état d'envoi des identifiants).

---

### 5.G — Enrichissement de `/owner/dashboard`

Ajouter une **4ᵉ carte de synthèse « Module Professionnel »** à côté des trois existantes
(académique / RH / formations), avec :

- Étudiants inscrits (professionnel) et évolution vs mois précédent
- Taux de recouvrement UE
- Taux de réussite du dernier semestre clos
- Taux de présence 30 jours
- Lien « Voir le détail » → `/owner/pedagogie`

Ajouter également des **alertes** au flux existant (table d'alertes déjà en place) :

| Alerte | Condition |
|---|---|
| Recouvrement faible | taux de recouvrement d'une filière < 60 % |
| ECUE en difficulté | taux d'échec d'une ECUE > 50 % avec effectif ≥ 10 |
| Appels non faits | > 30 % de séances passées sans pointage sur 30 j |
| ECUE sans enseignant | session `ouvert` avec ECUE obligatoire non affectée |
| Bulletins non générés | semestre terminé sans bulletin depuis > 15 j |
| Référentiel incohérent | UE où `nb_uv ≠ Σ credits ECUE` |

---

### 5.H — Composants à créer (mutualisés)

À placer dans `apps/web/src/components/owner/charts/` :

| Composant | Rôle |
|---|---|
| `StatCard` | KPI + valeur + variation + icône + tendance (n'existe pas aujourd'hui) |
| `ChartCard` | Conteneur titre + sous-titre + actions + `ResponsiveContainer` recharts |
| `BarChartCard` | Barres verticales / horizontales / empilées |
| `LineChartCard` | Séries temporelles multi-séries |
| `DonutChartCard` | Répartitions |
| `HeatmapGrid` | Généralisation de `AttendanceHeatmap` (jour × créneau, semaine × entité) |
| `FunnelChart` | Entonnoirs (recrutement, inscriptions) |
| `DataTableCard` | Tableau trié/filtrable + export CSV, générique |
| `PeriodFilter` | Sélecteur de période homogène sur toutes les pages owner |
| `FiliereFilter` | Multi-sélection de filières, homogène |

Palette et règles de couleur : **suivre le skill `dataviz`** (cohérence light/dark, palette
catégorielle accessible). Les seuils métier restent ceux déjà en vigueur : vert ≥ 80 %,
ambre ≥ 60 %, rouge < 60 %.

---

## 6. Dette technique à traiter d'abord

Ces points faussent des chiffres ou bloquent la réutilisation. À corriger **avant ou pendant** le lot 1.

| # | Problème | Fichier | Gravité |
|---|---|---|---|
| 1 | Headers `X-Tenant: "imhotepacademy"` et `X-User-Id` **codés en dur** dans les 6 appels fetch | `apps/web/src/lib/hooks/use-classrooms.ts` (l. 58-59, 89-90, 116-117, 165-166, 204-205, 248-249, 275-276) | 🔴 fuite inter-tenant |
| 2 | KPI « Total » calculés côté client sur des listes paginées à 20 → **faux** | `academic/cycles/page.tsx`, `academic/courses/page.tsx`, `academic/parents/page.tsx` | 🟠 chiffres erronés |
| 3 | `GET /students` réécrit tous les matricules du tenant à chaque listage | `apps/api/src/routes/students.ts` (`enforceSequentialMatricules`) | 🟠 effet de bord |
| 4 | `GET /ue-sessions` clôture les sessions échues à la lecture | `apps/api/src/routes/professional.ts` (`adminListSessions`) | 🟠 effet de bord |
| 5 | Page d'édition d'une salle alimentée avec l'enveloppe `{data}` au lieu de la salle | `academic/classrooms/[id]/edit/page.tsx` | 🟡 bug UI |
| 6 | Divergence `semestreValide()` (≥ 20 crédits) vs service (`every(u => u.validee)`) | `bulletin-calc.ts` vs `professional-bulletin.service.ts` | 🟡 règle ambiguë — **trancher et documenter** |
| 7 | `professional_ue_ecue.coefficient` stocké, jamais lu ; `nb_uv` stocké, jamais utilisé en pondération | schéma vs `bulletin-calc.ts` | 🟡 données trompeuses |
| 8 | Détection de la « Conduite » par `ILIKE 'conduite%'` — fragile | services professionnels | 🟡 → colonne `est_conduite` à envisager |
| 9 | Boutons inertes (« Gérer les étudiants », « Exporter les données ») et valeurs en dur (`0`, `-`) | `academic/courses/[id]/page.tsx` | 🟡 dette UI |
| 10 | Code mort dans la liste des inscrits (`editRow`, `Modal`, imports inutilisés) | `professionnel/admin/inscrits/page.tsx` | 🟢 nettoyage |
| 11 | `GET /courses` en `JOIN` au lieu de `LEFT JOIN` → matières orphelines invisibles | `apps/api/src/routes/courses.ts` | 🟡 données masquées |

---

## 7. Plan de livraison

### Lot 0 — Fondations (préalable)

- Corriger les points 1, 2, 3, 4 du §6.
- Créer les composants graphiques mutualisés (§5.H).
- Créer `packages/contracts/src/owner-stats.schema.ts` avec les schémas Zod des nouvelles réponses.
- Trancher les questions ouvertes (§8).

### Lot 1 — Le cœur métier

- `/owner/pedagogie` (§5.A)
- `/owner/finances/professionnel` (§5.B)
- Carte « Module Professionnel » sur `/owner/dashboard` (§5.G)

### Lot 2 — Exploitation

- `/owner/assiduite` (§5.C)
- `/owner/referentiel` (§5.D)
- Nouvelles alertes (§5.G)

### Lot 3 — Population et acquisition

- `/owner/personnes` (§5.E)
- `/owner/recrutement` (§5.F)
- Exports PDF/CSV sur toutes les nouvelles pages

### Lot 4 — Harmonisation

- Migration des composants owner existants vers recharts
- Uniformisation des filtres (`PeriodFilter`, `FiliereFilter`) sur les pages owner historiques

---

## 8. Questions à trancher avant implémentation

1. **UE « Conduite » dans les stats financières** : les inclure (CA réel) ou répliquer l'exclusion
   de l'UI admin ? → recommandation : **inclure**, avec mention explicite de l'écart.
2. **Règle de validation du semestre** : `credits >= 20` ou « toutes les UE validées » ?
   Les deux coexistent dans le code. → recommandation : **aligner sur le service**
   (`every(u => u.validee)`), supprimer ou déprécier `semestreValide()`.
3. **Périmètre d'accès** : ces pages sont-elles `requireOwner` strict, ou `requireOwnerOrAdmin` ?
   → recommandation : `requireOwnerOrAdmin` pour le référentiel et l'assiduité (utile aux admins),
   `requireOwner` strict pour les vues financières consolidées.
4. **Fraîcheur des données** : calcul à la volée (`staleTime: 60_000` comme les hooks owner
   existants) ou vues matérialisées rafraîchies périodiquement ?
   → recommandation : **à la volée** au départ ; introduire des vues matérialisées seulement si
   les temps de réponse dépassent ~1,5 s sur le plus gros tenant.
5. **Multi-année** : les comparaisons année N vs N-1 sont-elles attendues dès le lot 1 ?
   L'année scolaire est dérivée par pivot septembre, elle n'est pas une colonne — à formaliser
   si les comparaisons deviennent centrales.
6. **Mentions LMD** : faut-il les afficher côté owner ? Si oui, remonter `appreciation()` du front
   vers un utilitaire partagé plutôt que le dupliquer.

---

## 9. Definition of done

Pour chaque page livrée :

- [ ] Agrégations **en SQL**, aucune boucle de calcul côté client.
- [ ] `requireOwner` / `requireOwnerOrAdmin` appliqué, `set_config('app.tenant_id')` **et**
      `WHERE tenant_id = $1` dans chaque requête.
- [ ] Réponse validée par un schéma Zod dans `packages/contracts`.
- [ ] Hook TanStack Query avec `queryKey` incluant `tenantId` et les filtres.
- [ ] États `loading` (skeleton), `empty` et `error` traités explicitement.
- [ ] Responsive et lisible en thème clair **et** sombre.
- [ ] Export CSV fonctionnel (BOM `﻿`).
- [ ] Chaque KPI documenté par un commentaire de service rappelant sa règle de calcul et les
      pièges du §4.4 qui s'y appliquent.
- [ ] Aucun chiffre en dur, aucun bouton inerte.
```
