# Feature Specification: Restructuration pédagogique — Filière → UE → ECUE (Module Professionnel)

**Feature Branch**: `030-pedagogie-ue-ecue`

**Created**: 2026-06-18

**Status**: Draft

**Input**: PRD `docs/PRD-restructuration-pedagogique-filiere-ue-ecue.md` (décisions D1–D13) + arbitrages des points ouverts §10.

## Contexte

Aujourd'hui, le **Module Professionnel** est « plat » : une **Matière**
(`professional_subjects`) est rattachée directement à un **Programme** et porte
à la fois le **pédagogique** (supports, devoirs, évaluations, présences) et
l'**administratif** (prix, UV, sessions, inscription, diplôme).

Cette feature introduit un niveau intermédiaire et sépare les responsabilités :

```
AVANT :  Programme ──< Matière ──< Sessions / Évaluations / Frais / Diplôme
APRÈS :  Filière ──< UE (administratif) ──< ECUE (pédagogique)
```

> **Principe directeur : UE = pôle ADMINISTRATIF · ECUE = pôle PÉDAGOGIQUE.**

Périmètre : **Module Professionnel uniquement**. L'Académique
(`cycles → programmes → teaching_units → courses`) n'est **pas** modifié.
Aucune reprise de données (dev/seed uniquement) : le schéma repart propre.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Construire le référentiel Filière → UE → ECUE (Priority: P1)

Un administrateur pédagogique modélise l'offre : il crée des **UE** (Unités
d'Enseignement) rattachées à une **Filière**, crée des **ECUE** (Éléments
Constitutifs réutilisables), puis **compose** chaque UE en y rattachant une ou
plusieurs ECUE (coefficient, caractère obligatoire, ordre). Une même ECUE peut
être mutualisée dans plusieurs UE, y compris de filières différentes.

**Why this priority**: Sans le référentiel UE/ECUE, rien d'autre n'existe — c'est
le socle du catalogue, de l'inscription, de la pédagogie et du diplôme.

**Independent Test**: Créer une Filière, une UE (avec prix/UV), deux ECUE, les
rattacher à l'UE avec coefficients/obligatoire/ordre, et vérifier que l'UE
expose bien ses ECUE et que l'ECUE ne porte ni prix ni UV.

**Acceptance Scenarios**:

1. **Given** une filière existante, **When** l'admin crée une UE avec `code`, `libellé`, `prix`, `nb_uv`, `statut=actif`, **Then** l'UE est créée et rattachée à la filière, et porte le prix et les UV.
2. **Given** une UE et une ECUE, **When** l'admin rattache l'ECUE à l'UE avec `est_obligatoire`, `coefficient`, `ordre`, **Then** la liaison est créée (unique par couple UE/ECUE).
3. **Given** une ECUE déjà rattachée à l'UE A, **When** l'admin la rattache à l'UE B d'une autre filière, **Then** le rattachement est accepté (mutualisation inter-filières) avec ses propres coefficient/obligatoire.
4. **Given** une ECUE, **When** l'admin tente d'y saisir un prix ou des UV, **Then** ces champs n'existent pas sur l'ECUE (portés uniquement par l'UE).

---

### User Story 2 - Inscrire un étudiant à une UE et débloquer ses ECUE (Priority: P1)

Un étudiant parcourt le **catalogue Filière → UE**, ajoute une **UE** (sa
cohorte) au panier au **prix de l'UE**, paie la commande, et accède alors à
**toutes les ECUE** de l'UE (supports, devoirs, évaluations).

**Why this priority**: C'est le parcours de valeur central (commerce + accès
pédagogique). Sans lui, le module ne génère ni inscription ni revenu.

**Independent Test**: Depuis un compte étudiant, inscrire à une UE via une
cohorte ouverte, confirmer le paiement, et vérifier l'accès aux ECUE de l'UE.

**Acceptance Scenarios**:

1. **Given** une UE active avec une cohorte dont la fenêtre d'inscription est ouverte, **When** l'étudiant ajoute l'UE au panier, **Then** le prix figé est le prix de l'UE.
2. **Given** une commande d'UE payée, **When** l'étudiant ouvre l'UE, **Then** il accède à toutes les ECUE rattachées à l'UE.
3. **Given** une UE avec prérequis non validés, **When** l'étudiant tente de s'inscrire, **Then** l'inscription est refusée tant que les UE prérequises ne sont pas validées.
4. **Given** une inscription active sur une cohorte UE, **When** l'étudiant tente une seconde inscription active sur la même cohorte, **Then** elle est refusée (une seule inscription active par couple étudiant/cohorte).

---

### User Story 3 - Animer la pédagogie au niveau ECUE (Priority: P2)

Un enseignant gère, **par ECUE**, les supports de cours, les devoirs/évaluations
(en ligne / PDF / IA), les notes et appréciations. Au sein d'une cohorte UE, il
planifie des **séances** par ECUE et saisit la **présence par séance**.

**Why this priority**: Apporte la valeur pédagogique récurrente une fois
l'inscription posée ; dépend du socle (US1) et de l'accès (US2).

**Independent Test**: Sur une ECUE, déposer un support, créer un devoir,
planifier une séance dans une cohorte et marquer la présence d'un étudiant.

**Acceptance Scenarios**:

1. **Given** une ECUE, **When** l'enseignant dépose un support, **Then** le support est pérenne (réutilisable d'une cohorte à l'autre) et sa consultation est tracée.
2. **Given** une ECUE et une cohorte UE, **When** l'enseignant crée une séance datée, **Then** la séance permet la saisie de présence et l'attachement de visios.
3. **Given** une séance, **When** l'enseignant marque un étudiant `present/absent/retard/excuse`, **Then** la présence est enregistrée (unique par séance/étudiant).
4. **Given** un devoir rattaché à une ECUE, **When** l'étudiant soumet sa copie, **Then** la correction (auto QCM / manuelle libre) et la note fonctionnent comme avant, au niveau ECUE.

---

### User Story 4 - Valider les ECUE, capitaliser les UV de l'UE et obtenir le diplôme (Priority: P2)

Le système calcule la **moyenne par ECUE** d'un étudiant dans une cohorte ;
une ECUE est validée si sa moyenne ≥ seuil (10/20) **ou** par validation
manuelle d'un responsable. Une **UE est validée** quand **toutes ses ECUE
obligatoires** sont validées, ce qui **octroie les UV** de l'UE à l'étudiant.
Un **diplôme composé d'UE** est obtenu quand l'étudiant a capitalisé assez d'UV
et validé les UE obligatoires du diplôme.

**Why this priority**: Boucle la promesse académique (UV → diplôme) ; s'appuie
sur la pédagogie (US3) et le référentiel (US1).

**Independent Test**: Pour un étudiant, marquer toutes les ECUE obligatoires
d'une UE comme validées et vérifier l'octroi des UV de l'UE puis la progression
vers le diplôme.

**Acceptance Scenarios**:

1. **Given** un étudiant avec une moyenne ECUE ≥ 10/20, **When** le résultat est consolidé, **Then** l'ECUE est marquée validée automatiquement.
2. **Given** une ECUE en échec (moyenne < 10), **When** un responsable la valide manuellement, **Then** l'ECUE est marquée validée (override tracé).
3. **Given** une UE dont toutes les ECUE obligatoires sont validées, **When** la validation de l'UE est évaluée, **Then** l'UE est validée et ses UV sont capitalisées pour l'étudiant.
4. **Given** un diplôme composé d'UE, **When** l'étudiant atteint `uv_required` et valide les UE obligatoires, **Then** le diplôme est obtenable.

---

### Edge Cases

- **UE inactive** : n'accepte plus de nouvelle cohorte ni de nouvelle inscription (les cohortes en cours continuent).
- **Cohorte complète** : passe à `complet` quand inscriptions actives = `capacite_max` ; revient à `ouvert` si une place se libère dans la fenêtre.
- **Prérequis cyclique** : l'ajout d'une arête de prérequis UE qui créerait un cycle est refusé.
- **Prérequis hors filière** : un prérequis entre UE de filières différentes est refusé (même filière exigée).
- **ECUE mutualisée** : la suppression d'une ECUE rattachée à plusieurs UE doit être bloquée ou détacher proprement les liaisons (pas de suppression silencieuse de contenu pédagogique partagé).
- **Diplôme hors filière** : exiger dans un diplôme une UE d'une autre filière que le diplôme est refusé.
- **ECUE non obligatoire en échec** : n'empêche pas la validation de l'UE (seules les obligatoires comptent, sans compensation).
- **Suppression d'une cohorte** : les évaluations qui la référençaient en contexte conservent leur rattachement ECUE (contexte cohorte mis à NULL).

## Requirements *(mandatory)*

### Functional Requirements

**Référentiel pédagogique (administration)**

- **FR-001**: Le système MUST permettre de créer/éditer une **UE** rattachée à une **Filière**, avec `code` (unique par tenant), `libellé`, `description`, `prix`, `devise`, `nb_uv`, `statut` (`actif`/`inactif`).
- **FR-002**: Le système MUST permettre de créer/éditer une **ECUE** (objet pédagogique réutilisable) avec `code`, `libellé`, `description`, `bilan_type`, `statut` ; l'ECUE NE porte NI prix NI UV.
- **FR-003**: Le système MUST permettre de **composer une UE** en y rattachant des ECUE via une liaison portant `est_obligatoire`, `coefficient` (poids dans la moyenne UE) et `ordre`, unique par couple (UE, ECUE).
- **FR-004**: Le système MUST autoriser la **mutualisation** d'une ECUE dans plusieurs UE, y compris de **filières différentes** ; le coefficient et le caractère obligatoire sont définis par rattachement.
- **FR-005**: Le système MUST permettre de définir des **prérequis entre UE** : graphe acyclique, UE de la **même filière**, sans auto-référence, logique ET (tous requis).
- **FR-006**: Le **catalogue** MUST présenter Filière → UE → ECUE ; ne remontent que les filières ayant ≥ 1 UE inscriptible (UE `actif` avec une cohorte dont la fenêtre d'inscription est ouverte).
- **FR-007**: Une UE `inactif` MUST refuser toute nouvelle cohorte et toute nouvelle inscription.

**Sessions / cohortes (administratif — UE)**

- **FR-010**: Le système MUST permettre de créer des **cohortes d'UE** avec `libellé`, `date_debut`/`date_fin`, fenêtre `inscription_ouverte_le`/`inscription_fermee_le`, `capacite_max` (NULL = illimité), `enseignant?`, `salle?`, `statut` (machine à états `brouillon → ouvert ⇄ complet → en_cours → termine`, `annule`).
- **FR-011**: Au sein d'une cohorte, le système MUST permettre de planifier des **séances par ECUE** (`date`, `heure_debut?`/`heure_fin?`, `enseignant?`, `salle?`) supportant présence et visios.
- **FR-012**: La `capacite_max` MUST être gérée au niveau **cohorte UE** uniquement (pas de capacité par séance).

**Inscription & commerce (administratif — UE)**

- **FR-020**: L'étudiant MUST s'inscrire à une **UE** (sa cohorte) ; l'inscription pointe sur la cohorte UE.
- **FR-021**: Le **prix figé** à l'ajout au panier MUST être le prix de l'UE ; le montant total de la commande = Σ des prix UE.
- **FR-022**: À l'inscription, le système MUST contrôler les **prérequis UE** (les UE prérequises doivent être validées).
- **FR-023**: Une inscription **confirmée** (commande payée) MUST débloquer l'accès à **toutes les ECUE** de l'UE.
- **FR-024**: Le système MUST garantir **une seule inscription active** (non annulée) par couple (étudiant, cohorte UE).
- **FR-025**: Panier / commande / paiement MUST conserver leur logique existante, raccrochés à l'UE.

**Pédagogie (ECUE)**

- **FR-030**: Les **supports de cours** MUST être rattachés à l'ECUE (pérennes d'une cohorte à l'autre) ; la consultation est tracée. Il n'y a plus de supports rattachés à une session.
- **FR-031**: Les **devoirs/évaluations** MUST être rattachés à l'ECUE, avec rattachement **optionnel** à une cohorte (contexte) ; les 3 types (`online`, `pdf`, `ai_generated`), questions, copies et corrections restent inchangés.
- **FR-032**: La **fiche de présence** MUST être saisie **par séance ECUE** (`present`/`absent`/`retard`/`excuse`), unique par (séance, étudiant).
- **FR-033**: Les **notes** et appréciations MUST rester au niveau ECUE (via les copies).
- **FR-034**: Les **visioconférences** MUST être rattachées à une **séance ECUE** (et non plus à une session de matière).

**Validation, UV & diplôme (administratif — UE)**

- **FR-040**: Une **ECUE est validée** pour un étudiant dans une cohorte quand sa **moyenne ≥ 10/20** (seuil figé), OU par **validation manuelle** d'un responsable (override tracé). Le résultat ECUE est consolidé par (ECUE, étudiant, cohorte).
- **FR-041**: Une **UE est validée** quand **toutes ses ECUE obligatoires** sont validées (sans compensation) ; la validation **octroie les UV de l'UE** à l'étudiant.
- **FR-042**: Un **diplôme est composé d'UE** ; chaque UE exigée doit être de la **même filière** que le diplôme.
- **FR-043**: Un **diplôme est obtenu** quand l'étudiant a capitalisé `uv_total_validees ≥ uv_required` ET validé toutes les UE obligatoires du diplôme ; octroi/révocation conservent leur principe.

**Migration & terminologie**

- **FR-050**: Le système MUST repartir sur un schéma propre (aucune reprise de données) : les tables `professional_subject*` / `professional_session*` obsolètes sont supprimées et remplacées par le nouveau modèle UE/ECUE, avec isolation multi-tenant (RLS) et index sur toutes les nouvelles tables.
- **FR-051**: Contrats de données, services applicatifs, écrans et seeds MUST être alignés sur la terminologie Filière/UE/ECUE (renommage technique complet, rupture directe assumée en dev).

### Key Entities *(include if feature involves data)*

- **Filière** : libellé métier de la table `programmes` (partagée avec l'Académique) ; référencée par les objets pro via `filiere_id`. Non renommée.
- **UE (Unité d'Enseignement)** : hub administratif rattaché à une filière ; porte `prix`, `devise`, `nb_uv`, `statut`. Possède cohortes, prérequis, et compose le diplôme.
- **ECUE (Élément Constitutif d'UE)** : ex-Matière ; objet pédagogique réutilisable (mutualisable multi-UE) ; porte supports, devoirs, séances, résultats ; SANS prix ni UV.
- **Liaison UE↔ECUE** : rattachement mutualisable portant `est_obligatoire`, `coefficient`, `ordre` ; unique par (UE, ECUE).
- **Prérequis UE** : arête orientée entre deux UE de la même filière ; graphe acyclique.
- **Cohorte d'UE (session)** : occurrence datée et inscriptible d'une UE ; capacité, fenêtre d'inscription, machine à états.
- **Séance d'ECUE** : créneau pédagogique daté d'une ECUE au sein d'une cohorte ; support de présence et de visio.
- **Présence** : statut d'un étudiant pour une séance ECUE.
- **Support d'ECUE** (+ traces de lecture) : contenu pédagogique pérenne d'une ECUE.
- **Évaluation** : devoir rattaché à une ECUE (contexte cohorte optionnel) ; questions, copies, réponses inchangées.
- **Résultat ECUE** : moyenne et validation d'un étudiant pour une ECUE dans une cohorte (auto ou manuelle).
- **Inscription / Commande / Paiement** : à l'UE/cohorte ; prix figé = prix UE.
- **Diplôme** : composé d'UE (exigences), capitalise les UV par UE.
- **Résultat UE étudiant** : registre de capitalisation des UV par (étudiant, UE).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un administrateur peut créer une chaîne complète Filière → UE → ECUE et composer une UE avec des ECUE mutualisées (coefficient, obligatoire, ordre) sans aucune saisie de prix/UV au niveau ECUE.
- **SC-002**: 100 % des prix et UV affichés au parcours étudiant proviennent de l'UE (aucune valeur de prix/UV portée par une ECUE).
- **SC-003**: Un étudiant peut acheter une UE et accède immédiatement à 100 % des ECUE de cette UE après confirmation du paiement.
- **SC-004**: Une inscription est bloquée tant qu'au moins une UE prérequise n'est pas validée ; aucun cycle de prérequis ne peut être créé.
- **SC-005**: La présence est saisissable par séance ECUE pour 100 % des séances planifiées d'une cohorte.
- **SC-006**: La validation de toutes les ECUE obligatoires d'une UE octroie automatiquement les UV de l'UE à l'étudiant, et un diplôme devient obtenable dès que `uv_required` et les UE obligatoires sont atteints.
- **SC-007**: Le schéma cible se déploie sans reprise de données ; aucune table `professional_subject*` / `professional_session*` ne subsiste après migration.
- **SC-008**: Les suites de tests du module professionnel (catalogue, prérequis, inscription, capacité, diplômes) passent sur le nouveau modèle.

## Assumptions

- **Reprise de données** : aucune (D13). Seules des données de dev/seed existent ; rupture directe assumée (endpoints renommés, pas de période de compatibilité).
- **Seuil de validation ECUE** : 10/20 figé pour l'auto-validation, complété par une **validation manuelle** (override) au niveau du résultat ECUE.
- **Mutualisation** : une ECUE peut être rattachée à des UE de **filières différentes** ; la contrainte « même filière » s'applique aux **prérequis UE** et à la **composition du diplôme**, pas à la liaison UE↔ECUE.
- **Compensation** : aucune — la validation d'UE exige que **toutes** les ECUE obligatoires soient validées (D9).
- **Supports** : consolidés au niveau ECUE ; les supports par session (`professional_session_materials`) sont supprimés.
- **Capacité** : au niveau cohorte UE uniquement.
- **Académique inchangé** : `cycles → programmes → teaching_units → courses` n'est pas touché ; seule la sémantique « Filière » s'ajoute sur `programmes` via `filiere_id` dans les tables pro.
- **Paiements partiels / remboursements** : restent hors périmètre (inchangé vs 028).
