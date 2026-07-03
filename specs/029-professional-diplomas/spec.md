# Feature Specification: Diplômes Professionnels

**Feature Branch**: `029-professional-diplomas`

**Created**: 2026-05-22

**Status**: Draft

**Input**: User description: "Feature 029-professional-diplomas — permettre à un administrateur de définir des diplômes professionnels rattachés à un programme, exigeant qu'un étudiant valide un certain nombre d'UV sur un ensemble de matières précises, avec détection automatique de l'éligibilité et octroi du diplôme."

## Résumé

Le **Module Professionnel** (feature `028`) permet aux étudiants de s'inscrire à la carte à des matières professionnelles et de mener leurs inscriptions jusqu'au statut final « terminée ». Aujourd'hui, rien ne capitalise ces achèvements : un étudiant accumule des matières terminées sans qu'une qualification globale ne soit reconnue.

La feature **Diplômes Professionnels** comble ce manque. Un administrateur définit des **diplômes** rattachés à un **programme**. Chaque diplôme exige qu'un étudiant valide un certain nombre d'**UV** (unités de valeur) réparties sur un **ensemble de matières précises** du programme, certaines de ces matières pouvant être déclarées **obligatoires**. Le système surveille en continu la progression de chaque étudiant et, dès qu'il constate l'éligibilité, **octroie automatiquement** le diplôme. L'administrateur conserve un contrôle manuel : il peut octroyer un diplôme (y compris en forçant), le révoquer avec motif, et recalculer l'éligibilité de toute une population.

L'étudiant visualise sa progression précise vers chaque diplôme disponible dans ses programmes (UV cumulées, pourcentage d'avancement, matières manquantes). Le parent consulte les diplômes de son enfant en lecture seule.

Le module se greffe **sans casser** la feature `028`, le module académique classique, ni les autres modules. Le rendu PDF des attestations est hors périmètre MVP : seules les données structurées de l'attestation sont exposées.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Définition d'un diplôme et de ses exigences (Priority: P1)

Un administrateur crée un diplôme rattaché à un programme, lui donne un libellé et un nombre d'UV à valider, puis compose la liste des matières exigées en marquant certaines comme obligatoires et en définissant leur ordre d'affichage.

**Why this priority**: Sans diplôme défini, aucune capitalisation ni octroi n'est possible. C'est le socle de la feature ; il délivre déjà de la valeur en permettant à l'établissement de publier son référentiel de diplômes.

**Independent Test**: Créer un diplôme sur un programme, lui attacher une liste de matières exigées (dont au moins une obligatoire), puis vérifier que le diplôme et ses exigences sont enregistrés et consultables dans l'administration.

**Acceptance Scenarios**:

1. **Given** un programme existant, **When** l'admin crée un diplôme rattaché à ce programme avec un code, un libellé et un nombre d'UV à valider strictement positif, **Then** le diplôme est enregistré au statut « actif » et visible dans l'administration.
2. **Given** un diplôme existant, **When** l'admin compose sa liste d'exigences en sélectionnant des matières du programme et en marquant certaines comme obligatoires, **Then** les exigences sont enregistrées et le total d'UV atteignable est affiché.
3. **Given** un code de diplôme déjà utilisé dans l'établissement, **When** l'admin tente de créer un autre diplôme avec ce code, **Then** la création est refusée.
4. **Given** un diplôme rattaché au programme A, **When** l'admin tente d'ajouter aux exigences une matière appartenant au programme B, **Then** l'opération est refusée.
5. **Given** un nombre d'UV à valider égal à zéro ou négatif, **When** l'admin tente d'enregistrer le diplôme, **Then** la création est refusée.
6. **Given** un diplôme dont les exigences sont incohérentes (la somme des UV des matières exigées est inférieure au nombre d'UV à valider), **When** l'admin compose les exigences, **Then** le système l'avertit que la cible est inatteignable, sans pour autant bloquer l'enregistrement.

---

### User Story 2 - Octroi automatique à la détection d'éligibilité (Priority: P1)

Lorsqu'un étudiant termine une inscription professionnelle, le système réévalue automatiquement tous les diplômes actifs concernés par cette matière et, si l'étudiant satisfait les exigences, lui octroie le diplôme sans intervention humaine.

**Why this priority**: C'est la proposition de valeur centrale de la feature — reconnaître automatiquement une qualification dès qu'elle est acquise, sans charge administrative.

**Independent Test**: Construire un étudiant qui, après une dernière inscription terminée, satisfait toutes les exigences d'un diplôme ; déclencher l'achèvement de cette inscription et vérifier qu'un diplôme « obtenu » est créé, daté, avec un instantané des exigences.

**Acceptance Scenarios**:

1. **Given** un étudiant dont toutes les matières obligatoires d'un diplôme actif sont terminées et dont le cumul d'UV atteint la cible, **When** sa dernière inscription requise passe « terminée », **Then** le diplôme lui est octroyé automatiquement au statut « obtenu », avec une date d'obtention et une référence unique.
2. **Given** un étudiant déjà titulaire d'un diplôme donné, **When** une nouvelle inscription terminée déclenche une réévaluation de ce même diplôme, **Then** aucun second octroi n'est créé (pas de doublon).
3. **Given** un étudiant à qui un diplôme est octroyé automatiquement, **When** l'octroi est créé, **Then** un instantané des exigences au moment de l'octroi est conservé et l'octroi est marqué comme automatique (sans auteur).
4. **Given** un diplôme passé au statut « inactif », **When** un étudiant termine une inscription qui le rendrait éligible, **Then** aucun octroi automatique n'a lieu.
5. **Given** un étudiant à qui il manque une matière obligatoire terminée, **When** il termine une autre matière exigée, **Then** aucun diplôme n'est octroyé même si le cumul d'UV atteint la cible.

---

### User Story 3 - Suivi de progression par l'étudiant (Priority: P2)

Un étudiant consulte les diplômes disponibles dans ses programmes et visualise, pour chacun, sa progression précise : UV cumulées sur la cible, pourcentage d'avancement, matières déjà validées, matières restantes et matières obligatoires encore manquantes.

**Why this priority**: Apporte de la lisibilité et de la motivation à l'étudiant, mais la capitalisation fonctionne (US1, US2) même sans cet écran de suivi détaillé.

**Independent Test**: Pour un étudiant ayant terminé une partie des matières d'un diplôme, ouvrir l'écran de progression et vérifier que les UV cumulées, le pourcentage et les listes de matières validées/restantes correspondent exactement à l'état réel de ses inscriptions.

**Acceptance Scenarios**:

1. **Given** un étudiant inscrit dans un programme proposant des diplômes, **When** il ouvre la liste de ses diplômes, **Then** il voit les diplômes disponibles dans ses programmes, son pourcentage d'avancement pour chacun, et les diplômes déjà obtenus.
2. **Given** un diplôme partiellement validé, **When** l'étudiant ouvre son détail de progression, **Then** il voit le cumul d'UV validées sur la cible, le pourcentage d'avancement, la liste des matières validées et la liste des matières restantes.
3. **Given** un diplôme dont une matière obligatoire n'est pas terminée, **When** l'étudiant consulte sa progression, **Then** cette matière obligatoire manquante est explicitement signalée.
4. **Given** un diplôme obtenu, **When** l'étudiant consulte ce diplôme, **Then** il peut accéder aux données de l'attestation correspondante.
5. **Given** un diplôme non encore obtenu, **When** l'étudiant tente d'en consulter l'attestation, **Then** l'accès est refusé.

---

### User Story 4 - Octroi et révocation manuels par l'administrateur (Priority: P2)

Un administrateur octroie manuellement un diplôme à un étudiant — éventuellement en forçant malgré une éligibilité incomplète — et peut révoquer un diplôme déjà obtenu en fournissant un motif obligatoire.

**Why this priority**: Donne à l'établissement un contrôle de dernier recours (cas particuliers, équivalences, erreurs), mais l'octroi automatique (US2) couvre déjà le flux nominal.

**Independent Test**: Octroyer manuellement un diplôme à un étudiant éligible, vérifier la création de l'octroi ; tenter un octroi manuel sur un étudiant non éligible sans forçage (refus), puis avec forçage (succès) ; révoquer l'octroi avec un motif et vérifier le passage au statut « révoqué ».

**Acceptance Scenarios**:

1. **Given** un étudiant éligible à un diplôme non encore obtenu, **When** l'admin l'octroie manuellement, **Then** le diplôme est créé au statut « obtenu » avec l'admin comme auteur de l'octroi.
2. **Given** un étudiant non éligible à un diplôme, **When** l'admin tente un octroi manuel sans forçage, **Then** l'opération est refusée avec une indication d'inéligibilité.
3. **Given** un étudiant non éligible à un diplôme, **When** l'admin réalise un octroi manuel en forçant explicitement, **Then** le diplôme est octroyé malgré l'inéligibilité.
4. **Given** un étudiant déjà titulaire d'un diplôme non révoqué, **When** l'admin tente un nouvel octroi du même diplôme, **Then** l'opération est refusée.
5. **Given** un diplôme obtenu par un étudiant, **When** l'admin le révoque en fournissant un motif, **Then** le diplôme passe au statut « révoqué », avec date de révocation, motif et auteur enregistrés.
6. **Given** une demande de révocation sans motif, **When** l'admin tente de la valider, **Then** l'opération est refusée.
7. **Given** un diplôme révoqué pour un étudiant, **When** l'étudiant redevient éligible plus tard, **Then** un nouvel octroi du même diplôme est de nouveau possible.
8. **Given** un étudiant qui ne possède pas un diplôme donné (jamais obtenu), **When** l'admin tente de le révoquer, **Then** l'opération est refusée.

---

### User Story 5 - Consultation parent (Priority: P3)

Un parent consulte, en lecture seule, les diplômes professionnels de son enfant : diplômes obtenus et progression sur les diplômes en cours.

**Why this priority**: Apporte de la transparence aux familles, mais n'est pas nécessaire pour qu'un étudiant ou un administrateur utilise la feature.

**Independent Test**: Pour un enfant ayant au moins un diplôme obtenu et un diplôme en cours, ouvrir l'espace parent, sélectionner l'enfant et vérifier que les deux apparaissent sans aucune action de modification possible.

**Acceptance Scenarios**:

1. **Given** un parent ayant un enfant inscrit au module professionnel, **When** le parent ouvre l'espace diplômes et sélectionne cet enfant, **Then** il voit les diplômes obtenus et la progression des diplômes en cours de l'enfant.
2. **Given** un parent consultant les diplômes de son enfant, **When** il parcourt l'écran, **Then** aucune action de création, octroi, révocation ou modification ne lui est proposée.
3. **Given** un parent, **When** il tente d'accéder aux diplômes d'un enfant qui n'est pas le sien, **Then** l'accès est refusé.

---

### Edge Cases

- **Modification des exigences après octroi** : modifier la liste des exigences ou le nombre d'UV d'un diplôme ne révoque jamais un diplôme déjà octroyé ; l'octroi conserve l'instantané des exigences qui prévalait au moment de sa création.
- **Modification des exigences pour les étudiants en cours** : pour les étudiants non encore titulaires, l'éligibilité est réévaluée à partir des exigences courantes lors de la prochaine inscription terminée.
- **Désactivation d'un diplôme** : un diplôme « inactif » cesse d'être octroyé automatiquement, mais les diplômes déjà obtenus restent valides et consultables.
- **Suppression d'un diplôme** : la suppression est refusée tant qu'au moins un étudiant détient un octroi non révoqué de ce diplôme ; sinon, la suppression entraîne celle de ses exigences.
- **Matière comptée une seule fois** : une matière exigée pour laquelle l'étudiant possède plusieurs inscriptions terminées (sessions différentes) n'est comptabilisée qu'une fois dans le cumul d'UV.
- **Matière non obligatoire** : une matière exigée non obligatoire compte dans le cumul d'UV si elle est terminée, mais son absence n'empêche pas l'obtention du diplôme.
- **Cible inatteignable** : si la somme des UV de toutes les matières exigées est inférieure au nombre d'UV à valider, aucun étudiant ne peut être éligible automatiquement ; le système avertit l'admin lors de la composition des exigences.
- **Recalcul de masse** : relancer un recalcul d'éligibilité sur l'ensemble d'une population est sans effet sur les diplômes déjà octroyés (opération idempotente, ne crée que les octrois manquants).
- **Diplôme sans exigence** : un diplôme dont la liste d'exigences est vide ne rend personne éligible automatiquement.
- **Cloisonnement multi-établissement** : aucune donnée de diplôme, d'exigence ou d'octroi d'un établissement n'est lisible ni modifiable depuis le contexte d'un autre établissement.
- **Non-régression `028`** : la mécanique d'achèvement d'inscription continue de fonctionner même si la réévaluation de diplômes échoue ou n'a rien à octroyer.

## Requirements *(mandatory)*

### Functional Requirements

**Définition des diplômes et exigences**

- **FR-001**: Le système MUST permettre à un administrateur de créer, éditer, activer/désactiver et supprimer des diplômes, chacun obligatoirement rattaché à un programme existant.
- **FR-002**: Chaque diplôme MUST porter un code unique au sein de l'établissement, un libellé, une description optionnelle, un nombre d'UV à valider strictement positif et un statut (actif/inactif).
- **FR-003**: Le système MUST refuser la création d'un diplôme dont le code est déjà utilisé dans l'établissement.
- **FR-004**: Le système MUST refuser un diplôme dont le nombre d'UV à valider n'est pas strictement positif.
- **FR-005**: Le système MUST permettre à un administrateur de composer la liste des exigences d'un diplôme : un ensemble de matières, chacune assortie d'un indicateur « obligatoire » et d'un ordre d'affichage.
- **FR-006**: Le système MUST refuser toute exigence pointant vers une matière qui n'appartient pas au programme du diplôme.
- **FR-007**: Le système MUST permettre de remplacer la liste des exigences d'un diplôme de façon atomique (la nouvelle liste se substitue intégralement à l'ancienne).
- **FR-008**: Le système MUST autoriser la modification des exigences d'un diplôme à tout moment, sans révoquer ni altérer les diplômes déjà octroyés.
- **FR-009**: Le système MUST avertir l'administrateur, lors de la composition des exigences, lorsque la somme des UV des matières exigées est inférieure au nombre d'UV à valider, sans bloquer l'enregistrement.
- **FR-010**: Le système MUST refuser la suppression d'un diplôme tant qu'il existe au moins un octroi non révoqué de ce diplôme ; la suppression d'un diplôme sans octroi entraîne la suppression de ses exigences.

**Éligibilité et octroi automatique**

- **FR-011**: Le système MUST considérer une matière exigée comme validée par un étudiant lorsque celui-ci possède au moins une inscription professionnelle au statut « terminée » sur cette matière.
- **FR-012**: Le système MUST considérer un étudiant éligible à un diplôme lorsque, simultanément : (a) toutes les matières exigées marquées « obligatoires » sont validées, et (b) le cumul des UV des matières exigées validées (comptées une seule fois par matière) est supérieur ou égal au nombre d'UV à valider.
- **FR-013**: Le système MUST réévaluer automatiquement l'éligibilité d'un étudiant aux diplômes actifs concernés dès qu'une de ses inscriptions professionnelles passe au statut « terminée ».
- **FR-014**: Lorsqu'un étudiant devient éligible à un diplôme actif et qu'il n'en détient pas d'octroi non révoqué, le système MUST lui octroyer automatiquement ce diplôme au statut « obtenu », avec une date d'obtention, une référence unique et l'indication d'un octroi automatique (sans auteur).
- **FR-015**: Le système MUST NOT octroyer automatiquement un diplôme au statut « inactif ».
- **FR-016**: Le système MUST NOT créer un second octroi d'un même diplôme pour un étudiant qui en détient déjà un octroi non révoqué.
- **FR-017**: Le système MUST NOT révoquer automatiquement un diplôme déjà octroyé, quelles que soient les modifications ultérieures apportées au diplôme ou à ses exigences.
- **FR-018**: Le système MUST conserver, au moment de chaque octroi, un instantané des exigences du diplôme et du cumul d'UV validées, afin d'assurer la traçabilité de l'octroi.
- **FR-019**: Le système MUST permettre à un administrateur de relancer le recalcul d'éligibilité pour l'ensemble des étudiants ayant des inscriptions terminées sur un diplôme donné ; cette opération MUST être idempotente et ne créer que les octrois manquants.
- **FR-020**: Une défaillance de la réévaluation des diplômes MUST NOT empêcher ni annuler l'achèvement d'une inscription professionnelle.

**Octroi et révocation manuels**

- **FR-021**: Le système MUST permettre à un administrateur d'octroyer manuellement un diplôme à un étudiant éligible.
- **FR-022**: Le système MUST refuser un octroi manuel à un étudiant non éligible, sauf si l'administrateur demande explicitement un octroi forcé.
- **FR-023**: Le système MUST enregistrer, pour un octroi manuel, l'administrateur auteur de l'octroi.
- **FR-024**: Le système MUST refuser un octroi (automatique ou manuel) d'un diplôme dont l'étudiant détient déjà un octroi non révoqué.
- **FR-025**: Le système MUST permettre à un administrateur de révoquer un diplôme obtenu par un étudiant, en exigeant un motif de révocation non vide.
- **FR-026**: Le système MUST refuser une révocation portant sur un diplôme que l'étudiant n'a pas obtenu.
- **FR-027**: Le système MUST enregistrer, pour une révocation, la date, le motif et l'administrateur auteur ; le statut « révoqué » est terminal.
- **FR-028**: Après révocation d'un diplôme pour un étudiant, le système MUST autoriser un nouvel octroi ultérieur du même diplôme à ce même étudiant.

**Suivi et consultation**

- **FR-029**: Le système MUST permettre à un étudiant de consulter les diplômes disponibles dans ses programmes, sa progression vers chacun et la liste de ses diplômes obtenus.
- **FR-030**: Pour un diplôme donné, le système MUST exposer à l'étudiant : le cumul d'UV validées, le nombre d'UV à valider, le pourcentage d'avancement, la liste des matières validées, la liste des matières restantes, la liste des matières obligatoires manquantes, et l'indication d'éligibilité.
- **FR-031**: Le système MUST exposer, pour un diplôme obtenu, les données structurées de l'attestation correspondante ; il MUST refuser cet accès pour un diplôme non obtenu.
- **FR-032**: Le système MUST permettre à un parent de consulter, en lecture seule, les diplômes obtenus et la progression des diplômes en cours de son enfant.
- **FR-033**: Le système MUST refuser à un parent l'accès aux diplômes d'un enfant qui ne lui est pas rattaché.

**Rôles, multi-établissement et non-régression**

- **FR-034**: Toutes les données de diplômes, d'exigences et d'octrois MUST être isolées par établissement ; aucune lecture ni écriture inter-établissement n'est possible.
- **FR-035**: Chaque capacité MUST être restreinte au rôle approprié : l'administration des diplômes et les octrois/révocations sont réservés à l'administrateur, le suivi de progression à l'étudiant, la consultation à lecture seule au parent.
- **FR-036**: Un enseignant MUST NOT avoir accès aux capacités de gestion ou de consultation des diplômes.
- **FR-037**: Toutes les règles d'éligibilité, de cohérence de programme, d'unicité de code et d'octroi MUST être appliquées côté serveur, et pas uniquement dans l'interface.
- **FR-038**: La feature Diplômes Professionnels MUST NOT modifier ni dégrader le fonctionnement du module professionnel `028`, du module académique classique, ni des autres modules existants.
- **FR-039**: Chaque référence de diplôme octroyé MUST être unique au sein de l'établissement et suivre un format lisible incluant l'année.

### Key Entities *(include if feature involves data)*

- **Programme** : regroupement métier des matières, réutilisé tel quel depuis l'existant. Un diplôme appartient à un et un seul programme ; toutes ses exigences portent sur des matières de ce programme.
- **Matière professionnelle** : unité d'enseignement du module `028`, porteuse d'une valeur en UV. Réutilisée telle quelle ; une matière peut figurer dans les exigences de plusieurs diplômes.
- **Inscription professionnelle** : lien étudiant–session du module `028`. Son passage au statut « terminée » est le fait générateur de la validation d'une matière et de la réévaluation des diplômes.
- **Diplôme professionnel** : qualification définie par l'établissement. Attributs : code (unique par établissement), libellé, description, programme de rattachement, nombre d'UV à valider, statut (actif/inactif).
- **Exigence de diplôme** : élément de la liste des matières requises par un diplôme. Attributs : matière visée, indicateur « obligatoire », ordre d'affichage. L'ensemble des exigences d'un diplôme définit le périmètre des matières comptabilisées.
- **Diplôme octroyé à un étudiant** : reconnaissance d'un diplôme pour un étudiant donné. Attributs : référence lisible unique par établissement, statut (obtenu/révoqué), cumul d'UV validées au moment de l'octroi, instantané des exigences, date d'obtention, date et motif de révocation le cas échéant, auteur de l'octroi (vide si automatique), auteur de la révocation. Un étudiant ne peut détenir qu'un seul octroi non révoqué par diplôme.
- **Attestation** : représentation structurée des données d'un diplôme obtenu (diplôme, étudiant, programme, matières validées, date d'obtention, référence). Le rendu en document imprimable est hors périmètre MVP.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % des étudiants devenus éligibles à un diplôme actif se voient octroyer ce diplôme automatiquement, sans aucune intervention administrative, dès l'achèvement de leur dernière inscription requise.
- **SC-002**: Le rejeu d'une réévaluation ou d'un recalcul de masse produit 0 octroi en doublon.
- **SC-003**: 100 % des tentatives d'octroi (automatique ou manuel) sur un étudiant non éligible et non forcé sont bloquées côté serveur.
- **SC-004**: 100 % des tentatives de révocation sans motif sont refusées.
- **SC-005**: 100 % des tentatives d'ajout, aux exigences d'un diplôme, d'une matière d'un autre programme sont refusées côté serveur.
- **SC-006**: 100 % des tentatives de suppression d'un diplôme détenant au moins un octroi non révoqué sont refusées.
- **SC-007**: Pour 100 % des diplômes octroyés, l'instantané des exigences reste inchangé même après modification ultérieure du diplôme.
- **SC-008**: 0 fuite de données de diplômes, d'exigences ou d'octrois entre établissements.
- **SC-009**: Un étudiant peut connaître sa progression exacte vers un diplôme (UV cumulées, pourcentage, matières manquantes) en moins de 1 minute de consultation.
- **SC-010**: 100 % des comportements préexistants du module professionnel `028` restent inchangés (non-régression), y compris en cas d'échec de la réévaluation des diplômes.
- **SC-011**: Un enseignant n'a accès à aucune capacité de gestion ni de consultation des diplômes (0 action accessible).

## Assumptions

- **D1 — Granularité des exigences** : les exigences portent au niveau de la matière, pas de la session. Une matière est considérée validée dès que l'étudiant possède au moins une inscription « terminée » sur cette matière, quelle que soit la session.
- **D2 — Matières obligatoires** : chaque exigence porte un indicateur « obligatoire ». Une matière obligatoire doit être terminée pour obtenir le diplôme ; une matière non obligatoire ne compte que dans le cumul d'UV.
- **D3 — Cumul d'UV** : l'éligibilité s'apprécie sur la somme des UV des matières exigées (comptées une seule fois) que l'étudiant a terminées ; cette somme doit atteindre ou dépasser le nombre d'UV à valider.
- **D4 — Octroi automatique et manuel** : l'octroi est automatique dès la détection d'éligibilité, déclenchée par l'achèvement d'une inscription. L'octroi et la révocation manuels par l'administrateur restent possibles en complément.
- **D5 — Instantané (snapshot)** : un instantané des exigences est conservé au moment de l'octroi ; modifier le diplôme ensuite ne révoque pas les diplômes déjà octroyés.
- **D6 — Référence** : la référence d'un diplôme octroyé suit le format `DIP-{année}-{séquence}`, unique par établissement.
- **D7 — Un diplôme, un programme** : un diplôme appartient à un seul programme ; les diplômes multi-programmes sont hors périmètre MVP.
- **D8 — Lecture parent** : le parent dispose d'un accès strictement en lecture seule aux diplômes de son enfant.
- **D9 — Attestation PDF hors périmètre** : le MVP expose uniquement les données structurées de l'attestation ; le rendu PDF imprimable est reporté en Phase 2.
- **D10 — Multi-établissement** : toutes les nouvelles données suivent exactement le patron d'isolation par établissement déjà en place dans le module `028` ; aucun nouveau mécanisme d'isolation n'est introduit.
- **D11 — Statut « en cours »** : un statut « en cours » est réservé à un futur usage de pré-création pour le suivi de progression ; pour le MVP, aucune ligne d'octroi n'est créée tant que le diplôme n'est pas obtenu, la progression étant calculée à la volée à partir des inscriptions et des exigences.
- **Réutilisation `028`** : les concepts de programme, de matière professionnelle et d'inscription « terminée » sont réutilisés tels quels depuis la feature `028` ; aucun concept équivalent dédié n'est créé.
- **Hors périmètre Phase 2** : rendu PDF de l'attestation, notifications email/SMS lors de l'octroi, validation des prérequis par seuil de note, diplômes multi-programmes, versioning des exigences avec migration des étudiants en cours, tableau de bord analytique des diplômes obtenus.
