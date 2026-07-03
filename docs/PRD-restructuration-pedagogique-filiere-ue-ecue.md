# PRD — Restructuration de l'architecture pédagogique : Filière → UE → ECUE

| | |
|---|---|
| **Statut** | Proposition (à valider) |
| **Périmètre** | Module Professionnel uniquement (features 028 / 029) |
| **Date** | 2026-06-18 |
| **Auteur** | Équipe EcoleDigitale |
| **Référence modèle actuel** | [docs/modele-donnees-pedagogique-matiere.md](modele-donnees-pedagogique-matiere.md) |
| **Migrations concernées** | `0061`–`0068` (existantes) → nouvelle `0069_pedagogie_ue_ecue.sql` |

---

## 1. Contexte & objectif

Aujourd'hui, le **Module Professionnel** est « plat » : une **Matière**
(`professional_subjects`) est rattachée **directement** à un **Programme**
(`programmes`) et porte à la fois le **pédagogique** (supports, devoirs,
évaluations, présences) **et** l'**administratif** (prix, UV, sessions,
inscription, diplôme).

On introduit un niveau intermédiaire et on sépare clairement les
responsabilités :

```
AVANT :  Programme ───< Matière ───< Sessions / Évaluations / Frais / Diplôme

APRÈS :  Filière ───< UE ───< ECUE
                       │         └── (pédagogique : supports, devoirs, évaluations, notes, présence)
                       └────────────  (administratif : sessions/cohortes, frais, UV, inscription, paiement, diplôme)
```

**Objectif** : aligner le modèle de données sur la réalité académique
(Unité d'Enseignement → Éléments Constitutifs d'UE) et faire porter
l'administratif par l'**UE** tout en gardant le pédagogique sur l'**ECUE**.

---

## 2. Décisions validées (cadrage)

Ces décisions ont été arrêtées avec le métier et structurent tout le PRD :

| # | Sujet | Décision |
|---|---|---|
| D1 | **Périmètre** | **Module Professionnel uniquement**. L'Académique (`cycles → programmes → teaching_units → courses`) n'est **pas** modifié. |
| D2 | **Renommage** | **Renommage technique complet** des objets professionnels (tables, colonnes, endpoints API, contrats Zod). |
| D3 | **Programme → Filière** | Simple renommage. La table `programmes` étant **partagée** avec l'Académique, elle n'est **pas** renommée : « Filière » est le libellé métier et la colonne FK devient `filiere_id` (→ `programmes.id`) dans les tables pro. |
| D4 | **Inscription & paiement** | À l'**UE entière** : l'étudiant achète une UE (pack de ses ECUE). Plus de vente d'ECUE à l'unité. |
| D5 | **Frais / Prix & UV** | **Remontent à l'UE**. `prix` et `nb_uv` quittent l'ECUE et sont portés par l'UE. |
| D6 | **Sessions / administratif** | **Tout l'administratif est porté par l'UE** : sessions/cohortes, fenêtre d'inscription, capacité, frais, UV, inscription, commande, paiement, composition de la filière et du diplôme. |
| D7 | **Pédagogie** | **Tout le pédagogique reste sur l'ECUE** : supports, devoirs, évaluations, questions, copies, notes, fiche de présence. |
| D8 | **Diplôme & UV** | Le **diplôme est composé d'UE** ; les UV sont capitalisées au niveau **UE**. |
| D9 | **Validation d'une UE** | Une UE est acquise (UV octroyées) quand **toutes ses ECUE obligatoires sont validées**. |
| D10 | **Prérequis** | Gérés **au niveau UE** (une UE peut exiger d'autres UE validées avant inscription). |
| D11 | **Cardinalité UE ↔ ECUE** | Une ECUE est **mutualisable** : elle peut appartenir à **plusieurs UE** (table de liaison). |
| D12 | **Présence** | Introduction de **séances de cours au niveau ECUE** ; la fiche de présence pointe sur la séance. La cohorte UE encadre la période globale. |
| D13 | **Reprise de données** | **Aucune** : seules des données de dev/seed existent. On **repart propre** (pas de script de migration de données). |

---

## 3. Principe directeur

> **UE = pôle ADMINISTRATIF · ECUE = pôle PÉDAGOGIQUE.**

| Relève de l'**UE** (administratif) | Relève de l'**ECUE** (pédagogique) |
|---|---|
| Rattachement à la Filière | Contenu / supports de cours |
| **Prix / frais**, devise | Devoirs & évaluations (en ligne / PDF / IA) |
| **UV** (nombre d'unités de valeur) | Questions, copies, notes, appréciations |
| **Sessions / cohortes** (dates, capacité, fenêtre d'inscription) | **Séances** de cours (créneaux datés) |
| **Inscription**, panier, commande, **paiement** | **Fiche de présence** (par séance) |
| **Prérequis** (entre UE) | Visioconférences (séances visio) |
| **Composition du diplôme** & capitalisation des UV | — |

---

## 4. Modèle conceptuel cible

```text
        programmes  (table partagée — libellé métier « Filière », colonne pro : filiere_id)
            │
            ▼
   professional_ue  (Unité d'Enseignement — ADMIN : prix, nb_uv, statut)
       │  ▲   │
       │  │   └──< professional_ue_prerequisites   (prérequis entre UE, acyclique)
       │  │
       │  └──< professional_ue_sessions  (cohortes datées : inscription, capacité, dates)
       │              │
       │              ├──< professional_enrollments >── professional_orders ──< professional_payments
       │              └──< professional_ecue_seances  (séances pédagogiques d'une ECUE dans la cohorte)
       │                          │
       │                          └──< professional_ecue_attendance  (présence par séance)
       │
       └──< professional_ue_ecue  (LIAISON mutualisable : coefficient, obligatoire, ordre)
                     │
                     ▼
            professional_ecue  (ex-Matière — PÉDAGOGIE)
                     │
        ┌────────────┼───────────────────────────┐
        ▼            ▼                            ▼
professional_   professional_assignments   professional_ecue_results
ecue_materials       │                      (moyenne & validation par étudiant/cohorte)
   │                 ├──< professional_assignment_questions
   ▼                 ├──< professional_assignment_submissions
professional_        │         └──< professional_assignment_question_answers
ecue_material_views  └── (notes / appréciations)

   Diplôme (ADMIN) :
   professional_diplomas ──< professional_diploma_requirements (→ UE)
            │
            ▼
   student_professional_diplomas ──< student_professional_ue_results (capitalisation UV par UE)
```

**Parcours étudiant** : Catalogue **Filière → UE** (UE inscriptibles) → achat de
l'**UE** (cohorte) → accès à **toutes les ECUE** de l'UE → contenu, devoirs,
évaluations, présence par ECUE → validation des ECUE → validation de l'UE →
octroi des **UV** → progression vers le **diplôme**.

---

## 5. Glossaire & table de renommage

| Ancien (métier) | Nouveau (métier) | Ancien (technique) | Nouveau (technique) | Changement |
|---|---|---|---|---|
| Programme | **Filière** | `programmes` / `programme_id` | `programmes` (inchangé) / **`filiere_id`** | Libellé + renommage de la colonne FK dans les tables pro |
| — | **UE** (Unité d'Enseignement) | — | **`professional_ue`** | **Nouvelle** table (hub administratif) |
| Matière | **ECUE** (Élément Constitutif d'UE) | `professional_subjects` | **`professional_ecue`** | Renommée + `prix`/`nb_uv` retirés |
| — | Liaison UE↔ECUE | — | **`professional_ue_ecue`** | **Nouvelle** (mutualisation) |
| Prérequis entre matières | Prérequis entre UE | `professional_subject_prerequisites` | **`professional_ue_prerequisites`** | Déplacé au niveau UE |
| Session de matière | Session / cohorte d'UE | `professional_subject_sessions` | **`professional_ue_sessions`** | Déplacé au niveau UE |
| — | Séance d'ECUE | — | **`professional_ecue_seances`** | **Nouvelle** (créneaux pédagogiques) |
| Présence (par session) | Présence (par séance) | `professional_session_attendance` | **`professional_ecue_attendance`** | Repointée sur la séance ECUE |
| Supports de matière | Supports d'ECUE | `professional_subject_materials` | **`professional_ecue_materials`** | Renommée |
| Traces de lecture | Traces de lecture | `professional_subject_material_views` | **`professional_ecue_material_views`** | Renommée |
| Supports de session | (consolidés) | `professional_session_materials` | → rattachés à `professional_ecue_seances` ou aux supports ECUE | Consolidé/supprimé |
| Évaluation | Évaluation (ECUE) | `professional_assignments.professional_subject_id` / `.session_id` | `…ecue_id` / `…ue_session_id` | Repointage des FK |
| — | Résultat ECUE | — | **`professional_ecue_results`** | **Nouvelle** (alimente la validation UE) |
| Exigence de diplôme (matière) | Exigence de diplôme (UE) | `professional_diploma_requirements.subject_id` | **`…ue_id`** | Exigences = UE |
| Capitalisation UV | Capitalisation UV (par UE) | — | **`student_professional_ue_results`** | **Nouvelle** (registre UV par étudiant) |

> Inchangés (hors renommage de FK) : `professional_orders`, `professional_payments`,
> `professional_assignment_questions`, `professional_assignment_submissions`,
> `professional_assignment_question_answers`, `professional_diplomas`,
> `student_professional_diplomas`.

---

## 6. Exigences fonctionnelles

### 6.1 Référentiel pédagogique (administration)

- **FR-001** — Un administrateur crée/édite une **UE** rattachée à une **Filière**, avec : `code` (unique par tenant), `libellé`, `description`, **`prix`**, **`nb_uv`**, `statut` (`actif`/`inactif`).
- **FR-002** — Un administrateur crée/édite une **ECUE** (objet pédagogique réutilisable), avec : `code`, `libellé`, `description`, `bilan_type_id`, `statut`. L'ECUE **ne porte ni prix ni UV**.
- **FR-003** — Un administrateur **compose une UE** en y rattachant une ou plusieurs **ECUE** via la liaison `professional_ue_ecue` ; chaque rattachement porte `est_obligatoire`, `coefficient` (poids dans la moyenne UE) et `ordre`.
- **FR-004** — Une même **ECUE peut être rattachée à plusieurs UE** (mutualisation). Le coefficient et le caractère obligatoire sont définis **par rattachement** (donc par UE).
- **FR-005** — Un administrateur définit des **prérequis entre UE** : graphe **acyclique**, UE de la **même filière**, pas d'auto-référence. Logique **ET** (tous les prérequis requis).
- **FR-006** — Le **catalogue** présente **Filière → UE → ECUE** ; ne remontent que les filières ayant **≥ 1 UE inscriptible** (UE `actif` avec une cohorte dont la fenêtre d'inscription est ouverte).
- **FR-007** — Une UE `inactif` n'accepte plus de **nouvelle cohorte** ni de nouvelle inscription.

### 6.2 Sessions / cohortes (administratif — UE)

- **FR-010** — Un administrateur crée des **cohortes d'UE** (`professional_ue_sessions`) avec : `libellé`, `date_debut`/`date_fin`, fenêtre `inscription_ouverte_le`/`inscription_fermee_le`, `capacite_max` (NULL = illimité), `enseignant_id?`, `classroom_id?`, `statut` (machine à états `brouillon → ouvert ⇄ complet → en_cours → termine`, `annule`).
- **FR-011** — Au sein d'une cohorte, on planifie des **séances pédagogiques par ECUE** (`professional_ecue_seances`) : `date`, `heure_debut?`/`heure_fin?`, `enseignant_id?`, `classroom_id?`. Ces séances supportent la **présence** et les **visios**.

### 6.3 Inscription & commerce (administratif — UE)

- **FR-020** — L'étudiant **s'inscrit à une UE** (sa cohorte) ; l'objet d'inscription (`professional_enrollments`) pointe sur **`ue_session_id`**.
- **FR-021** — Le **prix figé** à l'ajout au panier est le **prix de l'UE** (`prix_unitaire`). Le `montant_total` de la commande = Σ des prix UE.
- **FR-022** — À l'inscription, le système **contrôle les prérequis UE** : l'étudiant doit avoir **validé** les UE prérequises.
- **FR-023** — Une inscription **confirmée** (commande payée) **débloque l'accès à toutes les ECUE** de l'UE.
- **FR-024** — Une seule inscription **active** (non annulée) par couple (étudiant, cohorte UE).
- **FR-025** — Panier / commande / paiement inchangés dans leur logique (`professional_orders`, `professional_payments`), mais raccrochés à l'UE.

### 6.4 Pédagogie (ECUE)

- **FR-030** — Les **supports de cours** sont rattachés à l'**ECUE** (`professional_ecue_materials`), pérennes d'une cohorte à l'autre ; consultation tracée (`…material_views`).
- **FR-031** — Les **devoirs / évaluations** (`professional_assignments`) sont rattachés à l'**ECUE** (`ecue_id`), avec rattachement **optionnel** à une cohorte (`ue_session_id`) pour le contexte. Les 3 types (`online`, `pdf`, `ai_generated`), questions, copies et corrections sont **inchangés**.
- **FR-032** — La **fiche de présence** (`professional_ecue_attendance`) est saisie **par séance ECUE** (statuts `present`/`absent`/`retard`/`excuse`).
- **FR-033** — Les **notes** et appréciations restent au niveau ECUE (via les copies/`professional_assignment_submissions`).
- **FR-034** — Les **visioconférences** (`live_sessions`) sont rattachées à une **séance ECUE** (remplace le rattachement actuel à la session de matière).

### 6.5 Validation, UV & diplôme (administratif — UE)

- **FR-040** — Une **ECUE est validée** pour un étudiant, dans une cohorte, quand sa **moyenne ≥ seuil** (défaut 10/20, paramétrable — *point ouvert §10*). Stocké/agrégé dans `professional_ecue_results`.
- **FR-041** — Une **UE est validée** quand **toutes ses ECUE obligatoires** (`est_obligatoire = true`) sont validées. La validation **octroie les UV de l'UE** à l'étudiant (`student_professional_ue_results`).
- **FR-042** — Un **diplôme est composé d'UE** : `professional_diploma_requirements.ue_id`. Validation applicative : l'UE doit être de la **même filière** que le diplôme.
- **FR-043** — Un **diplôme est obtenu** quand l'étudiant a capitalisé `uv_total_validees ≥ uv_required` **et** validé toutes les **UE obligatoires** du diplôme. Octroi/révocation inchangés dans leur principe (`student_professional_diplomas`).

---

## 7. Modèle de données cible (détail)

> Conventions communes : `id UUID PK`, `tenant_id NOT NULL → tenants(id)` avec
> **RLS** (GUC `app.tenant_id`), `created_at`/`updated_at TIMESTAMPTZ`.

### 7.1 `professional_ue` — Unité d'Enseignement *(nouvelle — administratif)*
`filiere_id → programmes(id)`, `code` (UNIQUE par tenant), `libelle`, `description`,
**`prix` numeric(14,2) ≥ 0**, `devise` (défaut `XOF`), **`nb_uv` int ≥ 0**,
`statut` (`actif`/`inactif`), `created_by → users`.

### 7.2 `professional_ecue` — Élément Constitutif d'UE *(ex-`professional_subjects`)*
`code` (UNIQUE par tenant), `libelle`, `description`, `bilan_type_id → bilan_types`,
`statut`. **Sans `prix` ni `nb_uv`** (remontés à l'UE). Pas de `filiere_id` direct
(le contexte filière vient de l'UE, mutualisation possible).

### 7.3 `professional_ue_ecue` — Liaison UE ↔ ECUE *(nouvelle)*
`ue_id → professional_ue(id)` CASCADE, `ecue_id → professional_ecue(id)`,
`est_obligatoire bool` (défaut `true`), `coefficient numeric(5,2) > 0` (défaut 1),
`ordre int ≥ 0`. **UNIQUE (`ue_id`, `ecue_id`)**. Supporte la **mutualisation**.

### 7.4 `professional_ue_prerequisites` — Prérequis entre UE *(ex-`…subject_prerequisites`)*
`ue_id`, `prerequisite_ue_id` (→ `professional_ue`), `CHECK distinct`,
`UNIQUE (tenant_id, ue_id, prerequisite_ue_id)`. Validation appli : même filière + acyclique.

### 7.5 `professional_ue_sessions` — Cohorte d'UE *(ex-`…subject_sessions`)*
`ue_id → professional_ue(id)`, `libelle`, `date_debut`/`date_fin`,
`inscription_ouverte_le`/`inscription_fermee_le`, `capacite_max?`,
`enseignant_id? → teachers`, `classroom_id? → classrooms`, `statut` (machine à états).

### 7.6 `professional_ecue_seances` — Séance pédagogique *(nouvelle)*
`ecue_id → professional_ecue(id)`, `ue_session_id → professional_ue_sessions(id)`
(contexte cohorte), `date`, `heure_debut?`/`heure_fin?`, `enseignant_id?`,
`classroom_id?`, `libelle?`.

### 7.7 `professional_ecue_attendance` — Présence *(ex-`…session_attendance`)*
`seance_id → professional_ecue_seances(id)` CASCADE, `student_id → student_profiles`,
`statut` (`present`/`absent`/`retard`/`excuse`), `marked_by → users`.
**UNIQUE (`tenant_id`, `seance_id`, `student_id`)**.

### 7.8 `professional_ecue_materials` / `…_material_views` *(ex-`…subject_materials`)*
Renommage simple, FK `ecue_id → professional_ecue(id)`. Structure inchangée
(`kind`, `storage_path`, `mime_type`, `file_size`, traces de lecture).

### 7.9 Évaluations — `professional_assignments` *(repointage FK)*
`professional_subject_id` → **`ecue_id`** (→ `professional_ecue`) ;
`session_id` → **`ue_session_id`** (→ `professional_ue_sessions`, nullable, contexte).
Le reste (`evaluation_type`, `ai_config`, barème, planning) **inchangé**.
Tables filles `…_questions`, `…_submissions`, `…_question_answers` **inchangées**.

### 7.10 `professional_ecue_results` — Résultat ECUE par étudiant *(nouvelle)*
`ecue_id`, `student_id → student_profiles`, `ue_session_id → professional_ue_sessions`,
`moyenne numeric(6,2)?`, `validee bool` (défaut false), `date_validation?`.
**UNIQUE (`tenant_id`, `ecue_id`, `student_id`, `ue_session_id`)**. Alimente FR-041.

### 7.11 `professional_enrollments` *(repointage FK)*
`session_id` → **`ue_session_id`** (→ `professional_ue_sessions`). `prix_unitaire`
= prix de l'**UE**. Index unique d'inscription active sur (`tenant_id`, `student_id`, `ue_session_id`).

### 7.12 Diplôme — `professional_diplomas` / `…_requirements` / `student_…`
- `professional_diplomas` : `programme_id` → **`filiere_id`**.
- `professional_diploma_requirements` : `subject_id` → **`ue_id`** (→ `professional_ue`). `UNIQUE (diploma_id, ue_id)`.
- `student_professional_diplomas` : inchangée ; `uv_total_validees` agrégé depuis les UE validées.
- **`student_professional_ue_results`** *(nouvelle)* : `ue_id`, `student_id`, `ue_session_id?`, `statut` (`en_cours`/`validee`/`echec`), `uv_acquises int`, `date_validation?`. Registre de capitalisation des UV (FR-041 → FR-043).

---

## 8. Impacts techniques

| Couche | Impact |
|---|---|
| **Base de données** | Nouvelle migration **`0069_pedagogie_ue_ecue.sql`** : crée `professional_ue`, `professional_ue_ecue`, `professional_ue_prerequisites`, `professional_ue_sessions`, `professional_ecue` (ex-subjects), `professional_ecue_seances`, `professional_ecue_attendance`, `professional_ecue_materials(+views)`, `professional_ecue_results`, `student_professional_ue_results` ; repointe `professional_assignments`, `professional_enrollments`, `professional_diploma_requirements`, `professional_diplomas` ; RLS + index sur toutes. **Aucune reprise de données (D13)** → les tables `professional_subject*` / `professional_session*` obsolètes sont **supprimées** (DROP) ou remplacées. |
| **Contrats (`packages/contracts`)** | Renommer/ajouter les schémas Zod : `ProfessionalSubject*` → `ProfessionalEcue*` ; nouveaux `ProfessionalUe*`, `ProfessionalUeSession*`, `ProfessionalUeEcue*`, `ProfessionalEcueSeance*`, `ProfessionalEcueResult*`, `StudentProfessionalUeResult*`. Mise à jour de `professional.ts` et `professional-diplomas.ts`. |
| **API (`apps/api`)** | Renommer `professional-catalog.service.ts` (subject→ecue) + **nouveau service UE** (CRUD UE, composition UE↔ECUE, prérequis UE, cohortes). Déplacer la logique de sessions/inscription vers l'UE. Mettre à jour `professional-enrollment.service.ts`, `professional-diplomas` (exigences = UE, capitalisation UV par UE). Endpoints REST renommés (`/professional/subjects` → `/professional/ecue`, ajout `/professional/ue`). |
| **Web (`apps/web`)** | Écrans admin : gestion **UE** (avec prix/UV), **composition UE↔ECUE**, **ECUE** (pédagogique), **cohortes**, **séances**, **prérequis UE**, **diplôme = UE**. Parcours étudiant : catalogue par **UE**, **achat d'UE**, accès à toutes les ECUE. Saisie de présence par **séance**. |
| **Visio (`live_sessions`)** | Remplacer la colonne `professional_subject_session_id` par **`professional_ecue_seance_id`** (→ `professional_ecue_seances`) et ajuster la contrainte « exactement un parent ». |
| **Seeds (`scripts/`)** | Réécrire `seed-professional-module-029.js` et `seed-professional-session-evaluations.js` sur le nouveau modèle (UE → ECUE, cohortes, séances). Voir mémoire [[professional-module-seeds]]. |
| **Tests** | Mettre à jour les tests `professional-catalog-*`, enrollment, diplomas. |
| **Specs Kit** | Créer une nouvelle feature `030-pedagogie-ue-ecue` (spec/plan/data-model/contracts) à partir de ce PRD. |

---

## 9. Règles de gestion (synthèse)

- **Hiérarchie** : Filière (`programmes`) → UE (`professional_ue`) → ECUE (`professional_ecue`), avec **mutualisation** ECUE multi-UE (D11).
- **Frais & UV** : portés exclusivement par l'**UE** (D5). L'ECUE n'a ni prix ni UV.
- **Inscription** : à l'**UE/cohorte** (D4) ; prix figé = prix UE à l'ajout au panier.
- **Prérequis** : entre **UE**, acyclique, même filière (D10).
- **Validation ECUE** : moyenne ≥ seuil (défaut 10/20, *à confirmer*).
- **Validation UE** : **toutes** les ECUE **obligatoires** validées → octroi des UV de l'UE (D9).
- **Diplôme** : composé d'**UE** ; obtenu si `uv_total_validees ≥ uv_required` + UE obligatoires validées (D8).
- **Pédagogie** : supports, devoirs, évaluations, notes, **présence (par séance)** sur l'**ECUE** (D7, D12).

---

## 10. Hors-périmètre & points ouverts

**Hors-périmètre (non-objectifs)**
- Le **module Académique** n'est pas modifié (D1).
- **Aucune** reprise de données de production (D13).
- Plus de **vente d'ECUE à l'unité** (D4/D5).
- Remboursements / paiements partiels : restent en Phase 2 (inchangé vs 028).

**Points ouverts (à trancher avant implémentation)**
1. **Seuil de validation d'une ECUE** : 10/20 par défaut ? Paramétrable par ECUE / `bilan_type` / cohorte ?
2. **Mutualisation inter-filières** : une ECUE partagée peut-elle être rattachée à des UE de **filières différentes** ? (Impacte la validation « même filière ».)
3. **Compensation** : la validation d'UE est-elle strictement « toutes ECUE validées » (D9) ou faut-il aussi une moyenne d'UE ≥ seuil avec compensation ? (D9 dit *toutes validées* — confirmer qu'il n'y a pas de compensation.)
4. **Supports par séance** vs **supports pérennes ECUE** : conserve-t-on un attachement de supports au niveau **séance** (ex-`professional_session_materials`) ou tout au niveau ECUE ?
5. **Stratégie de renommage des endpoints API** : rupture directe (dev only) ou période de compatibilité ?
6. **Capacité** : la `capacite_max` est-elle au niveau **cohorte UE** uniquement, ou faut-il aussi des capacités par séance/salle ?

---

## 11. Critères d'acceptation

- [ ] Un admin peut créer une **Filière → UE → ECUE** et composer une UE avec des ECUE **mutualisées** (coefficient, obligatoire, ordre).
- [ ] Le **prix** et les **UV** sont saisis et affichés **au niveau UE** ; l'ECUE n'en porte plus.
- [ ] Un étudiant **achète une UE** (cohorte) ; la commande/paiement se fait au niveau UE et débloque **toutes les ECUE**.
- [ ] Les **prérequis entre UE** bloquent l'inscription tant que les UE requises ne sont pas validées (graphe acyclique garanti).
- [ ] Les **devoirs, évaluations, supports, notes** restent rattachés à l'**ECUE** et fonctionnent comme avant.
- [ ] La **présence** se saisit **par séance ECUE**.
- [ ] La **validation de toutes les ECUE obligatoires** d'une UE octroie les **UV** de l'UE à l'étudiant.
- [ ] Un **diplôme composé d'UE** est obtenu quand l'étudiant atteint `uv_required` et valide les UE obligatoires.
- [ ] La migration `0069` crée le schéma propre (RLS + index) **sans reprise de données** ; les tables obsolètes sont supprimées.
- [ ] Contrats Zod, services API, écrans web et seeds sont alignés sur la nouvelle terminologie (Filière/UE/ECUE).

---

*Ce PRD est prêt à être converti en feature Spec Kit `030-pedagogie-ue-ecue`
(`/speckit-specify`) puis décliné en `plan.md` / `data-model.md` / `contracts/`.*
