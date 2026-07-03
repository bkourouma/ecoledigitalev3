# Feature Specification: Module Professionnel (inscription à la carte)

**Feature Branch**: `028-professional-module`

**Created**: 2026-05-20

**Status**: Draft

**Input**: User description: "D:\EcoleDigitaleV2-main\docs\module-professionnel-requirements.md"

## Résumé

EcoleDigitale gère aujourd'hui une scolarité académique classique (programme à prix forfaitaire, suivi en cohorte). Le **Module Professionnel** introduit un mode **à la carte** : l'offre est organisée par **programme**, chaque **matière** porte une valeur en UV et un **prix propre**, et est proposée via des **sessions datées**. L'étudiant choisit un programme, sélectionne librement les matières dont les **prérequis** sont satisfaits, les regroupe dans un **panier**, valide une **commande** et **paie** la somme des prix choisis. Il n'y a pas de cohorte : chaque étudiant a son propre parcours et peut s'inscrire à tout moment, dès qu'une session est disponible.

Le module doit s'ajouter **sans casser** le module académique classique existant ni le module « formations professionnelles » existant (qui est un module **distinct**, à ne pas confondre).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Catalogue professionnel administré (Priority: P1)

Un administrateur constitue l'offre professionnelle : il crée des matières professionnelles rattachées à un programme (code, libellé, UV, prix), puis ouvre des sessions datées avec fenêtre d'inscription, capacité et enseignant.

**Why this priority**: Sans catalogue, aucune inscription n'est possible. C'est le socle du module ; il délivre déjà de la valeur en permettant à l'établissement de publier son offre à la carte.

**Independent Test**: Créer une matière puis une session, la passer à « ouvert », et vérifier qu'elle apparaît comme inscriptible côté étudiant dès lors que la date courante est dans la fenêtre d'inscription.

**Acceptance Scenarios**:

1. **Given** un programme existant, **When** l'admin crée une matière professionnelle rattachée à ce programme avec un nombre d'UV et un prix, **Then** la matière est enregistrée et visible dans l'administration.
2. **Given** une matière professionnelle, **When** l'admin crée une session avec dates de début/fin, fenêtre d'inscription et capacité, **Then** la session est créée au statut « brouillon ».
3. **Given** une session « brouillon », **When** l'admin la passe à « ouvert » et que la date courante est comprise dans la fenêtre d'inscription, **Then** la matière apparaît inscriptible dans le catalogue du programme côté étudiant.
4. **Given** un code de matière déjà utilisé dans l'établissement, **When** l'admin tente de créer une autre matière avec ce code, **Then** la création est refusée.
5. **Given** une matière désactivée, **When** l'admin tente d'y ouvrir une nouvelle session, **Then** l'opération est refusée.

---

### User Story 2 - Inscription à la carte de l'étudiant (Priority: P1)

Un étudiant choisit un programme, parcourt les matières, ajoute au panier celles dont les prérequis sont satisfaits, valide sa commande et paie ; ses inscriptions sont alors confirmées et il accède au contenu pédagogique.

**Why this priority**: C'est la proposition de valeur centrale du module — l'achat à la carte de matières par l'étudiant.

**Independent Test**: Avec un catalogue existant, dérouler le parcours programme → matières → panier → commande → paiement, et vérifier l'accès au contenu pédagogique après confirmation du paiement.

**Acceptance Scenarios**:

1. **Given** des programmes dont certains ont une offre inscriptible, **When** l'étudiant ouvre le module, **Then** seuls les programmes ayant au moins une matière inscriptible lui sont proposés.
2. **Given** un programme choisi, **When** l'étudiant consulte le catalogue, **Then** il voit les matières, leurs sessions inscriptibles, leur prix, leurs UV et l'état de leurs prérequis.
3. **Given** 3 matières ajoutées au panier, **When** l'étudiant consulte son panier, **Then** le montant total affiché est la somme exacte des prix figés des 3 matières.
4. **Given** un panier non vide, **When** l'étudiant valide la commande, **Then** une commande « en attente de paiement » est créée après revérification de l'éligibilité et des prérequis.
5. **Given** une commande « en attente de paiement », **When** le paiement est confirmé, **Then** la commande passe « payée » et toutes ses inscriptions passent « confirmée ».
6. **Given** une inscription confirmée, **When** l'étudiant ouvre la matière, **Then** il accède aux supports de cours, aux présences et aux notes de la session.
7. **Given** une commande déjà payée, **When** l'étudiant revient ultérieurement, **Then** il peut créer une nouvelle commande pour d'autres matières ou d'autres programmes.

---

### User Story 3 - Prérequis entre matières (Priority: P2)

L'administrateur définit des prérequis entre matières d'un même programme ; le système empêche l'inscription tant que tous les prérequis ne sont pas validés, et déverrouille les matières dépendantes lorsqu'un prérequis est achevé.

**Why this priority**: Garantit la cohérence pédagogique du parcours à la carte. Fait partie du MVP, mais le catalogue (US1) et l'inscription simple (US2) restent testables indépendamment.

**Independent Test**: Définir une matière B dont le prérequis est la matière A ; vérifier que B reste verrouillée tant que A n'est pas terminée, puis devient inscriptible une fois A marquée « terminée ».

**Acceptance Scenarios**:

1. **Given** une matière B avec un prérequis A non validé, **When** l'étudiant consulte le catalogue, **Then** B apparaît verrouillée avec la liste des prérequis manquants.
2. **Given** une matière B verrouillée, **When** l'étudiant tente de l'ajouter au panier, **Then** l'ajout est refusé côté serveur.
3. **Given** l'inscription de la matière A marquée « terminée », **When** l'étudiant reconsulte le catalogue, **Then** la matière B devient inscriptible.
4. **Given** une matière à plusieurs prérequis, **When** un seul prérequis manque, **Then** la matière reste verrouillée (logique ET sur l'ensemble des prérequis).
5. **Given** une définition de prérequis qui crée un cycle, ou qui pointe vers une matière d'un autre programme, ou vers la matière elle-même, **When** l'admin tente de l'enregistrer, **Then** la définition est rejetée.

---

### User Story 4 - Cycle de vie des sessions et achèvement (Priority: P2)

L'administrateur (ou l'enseignant) pilote le cycle de vie des sessions — transitions de statut, gestion de la capacité — et marque les inscriptions « terminées », ce qui débloque les matières dépendantes.

**Why this priority**: Indispensable pour faire vivre l'offre dans le temps et pour alimenter la mécanique de prérequis (US3), mais l'inscription initiale fonctionne sans ces transitions avancées.

**Independent Test**: Remplir une session jusqu'à sa capacité et vérifier le passage automatique à « complet » ; annuler une inscription et vérifier le retour à « ouvert » si la fenêtre est encore valide.

**Acceptance Scenarios**:

1. **Given** une session dont la capacité est atteinte, **When** une inscription de plus est tentée, **Then** la session est « complet » et l'inscription est refusée.
2. **Given** une session « complet », **When** une place se libère par annulation et que la fenêtre d'inscription est encore valide, **Then** la session repasse « ouvert ».
3. **Given** une inscription confirmée, **When** un admin ou enseignant la marque « terminée », **Then** les matières dont elle est prérequis deviennent éligibles.
4. **Given** une session « brouillon », « annulée », « complète » ou hors fenêtre d'inscription, **When** l'étudiant consulte le catalogue, **Then** cette session n'apparaît pas comme inscriptible.

---

### User Story 5 - Suivi parent (Priority: P3)

Un parent consulte en lecture seule les inscriptions et paiements professionnels de son enfant.

**Why this priority**: Apporte de la transparence aux familles, mais n'est pas nécessaire pour qu'un étudiant utilise le module.

**Independent Test**: Avec un enfant ayant des inscriptions professionnelles, ouvrir l'espace parent et vérifier que les inscriptions et paiements sont visibles sans aucune action de modification possible.

**Acceptance Scenarios**:

1. **Given** un enfant ayant des inscriptions professionnelles, **When** le parent ouvre son espace, **Then** il voit les inscriptions et leur statut.
2. **Given** un enfant ayant des paiements professionnels, **When** le parent consulte les paiements, **Then** il les voit en lecture seule, sans possibilité de modification.

---

### User Story 6 - Accès enseignant aux sessions professionnelles (Priority: P3)

Un enseignant retrouve ses sessions professionnelles parmi ses cours et y fait l'appel, dépose des supports et saisit des notes via les mécanismes existants.

**Why this priority**: Nécessaire à la tenue effective des cours, mais s'appuie sur des mécanismes pédagogiques déjà existants et n'est pas bloquant pour la vente à la carte.

**Independent Test**: Affecter un enseignant à une session professionnelle et vérifier qu'elle apparaît dans la liste de ses cours, avec accès à l'appel, aux supports et aux notes.

**Acceptance Scenarios**:

1. **Given** un enseignant affecté à une session professionnelle, **When** il consulte ses cours, **Then** la session professionnelle y figure.
2. **Given** une session professionnelle, **When** l'enseignant fait l'appel, dépose un support ou saisit une note, **Then** ces données sont rattachées à la session via les mécanismes pédagogiques existants.

---

### Edge Cases

- **Changement de prix après mise au panier** : le prix d'une matière est figé au moment de l'ajout au panier ; une modification ultérieure du prix de la matière n'impacte pas les paniers et commandes existants.
- **Double inscription** : une seconde tentative d'inscription à une session déjà inscrite (inscription non annulée) est refusée.
- **Rejeu de paiement** : rejouer un paiement avec la même référence de transaction ne crée pas de doublon de paiement ni de commande (idempotence).
- **Capacité illimitée** : une session sans capacité définie n'atteint jamais l'état « complet ».
- **Annulation après paiement** : l'annulation n'est possible que tant que le paiement n'est pas confirmé ; le remboursement après paiement est hors périmètre MVP.
- **Panier multi-programmes** : un panier peut contenir des matières de plusieurs programmes ; chaque matière conserve son programme d'origine.
- **Parcours mixte** : un étudiant ayant déjà une inscription académique classique peut créer une commande professionnelle sans conflit entre les deux parcours.
- **Programme sans offre** : un programme n'ayant aucune matière inscriptible n'est pas listé côté étudiant.
- **Revérification à la validation** : une matière éligible lors de la mise au panier mais devenue inéligible avant la validation de la commande (session pleine, fenêtre fermée, prérequis devenu manquant) est rejetée à la validation.
- **Cloisonnement multi-établissement** : aucune donnée d'un établissement n'est lisible ni modifiable depuis le contexte d'un autre établissement.

## Requirements *(mandatory)*

### Functional Requirements

**Catalogue et administration**

- **FR-001**: Le système MUST permettre à un administrateur de créer, éditer et désactiver des matières professionnelles, chacune obligatoirement rattachée à un programme existant.
- **FR-002**: Chaque matière professionnelle MUST porter un code unique au sein de l'établissement, un libellé, un nombre d'UV (information académique) et un prix.
- **FR-003**: Le système MUST permettre à un administrateur de créer des sessions datées pour une matière, avec une date de début, une date de fin (≥ date de début), une fenêtre d'inscription (ouverture/fermeture, fermeture ≥ ouverture), une capacité optionnelle, un enseignant optionnel et une salle optionnelle.
- **FR-004**: Une matière désactivée MUST NOT accepter l'ouverture de nouvelles sessions.
- **FR-005**: Les sessions MUST suivre un cycle de vie à statuts contrôlés (brouillon → ouvert → complet → en cours → terminé / annulé), les transitions étant déclenchées par un administrateur.

**Prérequis entre matières**

- **FR-006**: Le système MUST permettre à un administrateur de définir zéro, un ou plusieurs prérequis pour une matière donnée.
- **FR-007**: Le système MUST rejeter toute définition de prérequis qui pointe vers la matière elle-même, vers une matière d'un autre programme, ou qui introduit un cycle dans le graphe des prérequis.
- **FR-008**: Tous les prérequis d'une matière MUST être satisfaits (logique ET) pour qu'un étudiant puisse s'y inscrire.
- **FR-009**: Un prérequis MUST être considéré satisfait lorsque l'étudiant possède une inscription « terminée » pour la matière prérequise.

**Catalogue côté étudiant**

- **FR-010**: Le système MUST ne proposer à l'étudiant que les programmes ayant au moins une matière professionnelle inscriptible.
- **FR-011**: Après le choix d'un programme, le système MUST présenter ses matières avec leurs sessions inscriptibles, leur prix, leurs UV et l'état de leurs prérequis (satisfait, ou liste des prérequis manquants).
- **FR-012**: Une session MUST être considérée inscriptible seulement si toutes ces conditions sont vraies : statut « ouvert », date courante dans la fenêtre d'inscription, capacité non atteinte (ou illimitée), absence d'inscription non annulée de l'étudiant sur cette session, et tous les prérequis de la matière satisfaits.
- **FR-013**: Une matière dont au moins un prérequis n'est pas satisfait MUST être présentée verrouillée, avec la liste des prérequis manquants, et MUST NOT pouvoir être ajoutée au panier.

**Panier, commande et paiement**

- **FR-014**: Un étudiant MUST pouvoir ajouter au panier et retirer du panier des sessions inscriptibles ; le panier est une commande à l'état « brouillon ».
- **FR-015**: Le système MUST figer le prix de la matière dans la ligne de panier au moment de l'ajout ; un changement ultérieur de prix MUST NOT impacter les paniers ni les commandes existants.
- **FR-016**: Le montant total d'une commande MUST être égal à la somme exacte des prix figés de ses lignes.
- **FR-017**: Un panier MAY contenir des matières issues de plusieurs programmes, chaque ligne conservant son programme d'origine.
- **FR-018**: Le système MUST revérifier l'éligibilité et les prérequis à la fois lors de l'ajout au panier et lors de la validation de la commande.
- **FR-019**: La validation d'un panier MUST créer une commande au statut « en attente de paiement ».
- **FR-020**: À la confirmation du paiement, la commande MUST passer « payée » et toutes ses inscriptions MUST passer de « en attente de paiement » à « confirmée ».
- **FR-021**: Le système MUST gérer un paiement unique par commande (MVP) ; un étudiant MAY créer ultérieurement de nouvelles commandes.
- **FR-022**: Le paiement MUST être idempotent : rejouer la même référence de transaction MUST NOT créer de doublon.
- **FR-023**: Le système MUST permettre l'annulation d'une commande ou d'une inscription tant que le paiement n'est pas confirmé ; le remboursement après paiement est hors périmètre MVP.

**Accès au contenu et achèvement**

- **FR-024**: L'accès au contenu pédagogique d'une matière (supports, présences, notes) MUST être conditionné au statut « confirmée » de l'inscription.
- **FR-025**: Un administrateur ou un enseignant MUST pouvoir marquer une inscription « terminée » ; l'achèvement d'une inscription prérequise MUST déverrouiller les matières dépendantes.
- **FR-026**: Une session MUST passer automatiquement à « complet » lorsque sa capacité est atteinte et cesser d'accepter des inscriptions ; elle MUST revenir à « ouvert » si une place se libère par annulation et que la fenêtre d'inscription est encore valide.
- **FR-027**: Le système MUST garantir l'unicité d'une seule inscription active (non annulée) par couple (étudiant, session).

**Rôles, multi-établissement et non-régression**

- **FR-028**: Toutes les données du module professionnel MUST être isolées par établissement ; aucune lecture ni écriture inter-établissement n'est possible.
- **FR-029**: Chaque capacité MUST être restreinte au rôle approprié (administrateur, étudiant, parent, enseignant).
- **FR-030**: Un parent MUST pouvoir consulter, en lecture seule, les inscriptions et paiements professionnels de son enfant.
- **FR-031**: Un enseignant MUST voir ses sessions professionnelles parmi ses cours et utiliser les mécanismes existants d'appel, de supports et de notation.
- **FR-032**: Toutes les règles d'éligibilité, de prérequis, de capacité et de fenêtre d'inscription MUST être appliquées côté serveur, et pas uniquement dans l'interface.
- **FR-033**: Le module professionnel MUST NOT modifier ni dégrader le fonctionnement du module académique classique existant ni du module « formations professionnelles » existant.
- **FR-034**: Un étudiant MAY détenir simultanément et de façon indépendante des inscriptions académiques classiques et des inscriptions professionnelles.
- **FR-035**: Les reçus et le reporting financier MUST réutiliser les mécanismes existants de reçus et de rapports financiers, en y rattachant le paiement professionnel.

### Key Entities *(include if feature involves data)*

- **Programme** : regroupement métier des matières, réutilisé tel quel depuis l'existant. L'étudiant choisit un programme avant d'accéder aux matières. Le catalogue professionnel ne fait remonter que les programmes ayant au moins une matière professionnelle inscriptible.
- **Matière professionnelle** : unité d'enseignement vendue à la carte, rattachée à un programme. Attributs : code (unique par établissement), libellé, description, nombre d'UV, prix, statut (actif/inactif).
- **Session (cours professionnel)** : instance datée d'une matière. Attributs : libellé, date de début, date de fin, fenêtre d'inscription, capacité maximale optionnelle, enseignant optionnel, salle optionnelle, statut (brouillon/ouvert/complet/en cours/terminé/annulé).
- **Prérequis** : relation orientée « la matière X exige la matière Y », entre deux matières d'un même programme. L'ensemble des prérequis forme un graphe sans cycle.
- **Commande (panier)** : regroupement des sessions sélectionnées par un étudiant en une seule fois, donnant lieu à un paiement unique. Attributs : référence lisible unique par établissement, montant total, devise, statut (brouillon/en attente de paiement/payée/annulée).
- **Inscription professionnelle** : ligne d'une commande, liant un étudiant à une session. Attributs : prix unitaire figé, statut (en attente de paiement/confirmée/terminée/annulée). Débloque l'accès au contenu pédagogique une fois confirmée.
- **Paiement** : règlement d'une commande. Attributs : montant, mode de règlement, référence de transaction (idempotence), statut (initié/confirmé/échoué/remboursé), date de paiement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un étudiant peut dérouler le parcours complet — choix du programme, sélection des matières, panier, commande, paiement — en moins de 5 minutes.
- **SC-002**: 100 % des tentatives d'inscription à une matière dont un prérequis n'est pas satisfait sont bloquées côté serveur.
- **SC-003**: Dans 100 % des commandes, le montant total correspond exactement à la somme des prix figés des matières sélectionnées.
- **SC-004**: 0 fuite de données entre établissements sur l'ensemble des opérations de catalogue, de commande et de paiement.
- **SC-005**: Le rejeu d'une référence de paiement identique produit 0 paiement et 0 commande en doublon.
- **SC-006**: 100 % des comportements préexistants du module académique classique et du module « formations professionnelles » restent inchangés (non-régression).
- **SC-007**: Une matière devient inscriptible dès la première consultation du catalogue suivant l'achèvement de son dernier prérequis.
- **SC-008**: Le contenu pédagogique reste inaccessible pour 100 % des inscriptions non confirmées (non payées).
- **SC-009**: Une session cesse immédiatement d'accepter des inscriptions dès que sa capacité est atteinte (aucune sur-réservation).
- **SC-010**: Les 15 critères d'acceptation du document de spécifications (§11) sont tous vérifiés.

## Assumptions

- **Périmètre MVP** : la spécification couvre la Phase 1 (MVP) du document de référence. Sont hors périmètre MVP et reportés en Phase 2 : relevé/attestation d'UV capitalisées, validation des prérequis par note ou seuil, échéanciers et remboursements, listes d'attente, notifications automatiques, tarification dégressive, panier multi-étudiants.
- **D1 — Espace de noms distinct** : le module professionnel constitue un module dédié, distinct du module « formations professionnelles » existant ; il ne réutilise ni ses données ni ses parcours d'accès.
- **D2 — Prix explicite** : le prix d'une matière est saisi explicitement et porté par la matière ; le nombre d'UV est une information purement académique et n'est pas la base de calcul du prix. Une valeur indicative par UV peut, en option, assister la saisie.
- **D3 — Réutilisation pédagogique et financière** : les présences, supports de cours, notes, reçus et rapports financiers existants sont réutilisés et rattachés à la session ou au paiement professionnel, plutôt que dupliqués.
- **D4 — Modèle de paiement** : panier → 1 commande → 1 paiement ; échéanciers et remboursements relèvent de la Phase 2.
- **D5 — Parcours indépendants** : un même étudiant peut suivre simultanément un parcours académique classique et un parcours professionnel, les deux étant indépendants.
- **D6 — Enseignants** : les sessions professionnelles sont assurées par des enseignants (rôle enseignant), et non par les formateurs du module « formations professionnelles ».
- **D7 — Isolation multi-établissement** : les nouvelles données suivent exactement le patron d'isolation par établissement déjà en place ; aucun nouveau mécanisme d'isolation n'est introduit.
- **D8 — Programme réutilisé** : le concept de « programme » réutilise le regroupement de programmes existant ; aucun concept de programme dédié au professionnel n'est créé.
- **D9 — Définition de « prérequis validé »** : au MVP, un prérequis est satisfait lorsque l'étudiant possède une inscription « terminée » de la matière prérequise ; la validation par note ou seuil est reportée en Phase 2.
- **Devise** : la devise par défaut est celle de l'établissement (FCFA / XOF).
- **Convention de validation des décisions** : les recommandations du journal de décisions (§3 du document de référence) sont appliquées comme base v1. Toute modification d'une décision devra être répercutée sur la présente spécification avant l'implémentation.
