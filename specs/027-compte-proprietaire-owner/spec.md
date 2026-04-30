# Feature Specification: Espace Propriétaire (rôle Owner)

**Feature Branch**: `027-compte-proprietaire-owner`  
**Created**: 2026-04-17  
**Status**: Draft  
**Input**: User description: « Implémentation du compte Propriétaire (EcoleDigitale) : nouveau rôle réservé au fondateur, pilotage stratégique en lecture majoritaire, finances et RH en lecture + actions de validation limitées, gestion des rôles utilisateurs, alertes acquittables, exports financiers avec minimisation des données personnelles, isolation par établissement (tenant). »

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Le Propriétaire accède à son espace et consulte le pilotage stratégique (Priority: P1)

Un utilisateur désigné comme Propriétaire de l’établissement se connecte à la plateforme et accède à un espace dédié. Il consulte un tableau de bord consolidé présentant des indicateurs clés sur les finances, la scolarité (synthèse), les ressources humaines, les formations professionnelles et les alertes prioritaires, sans pouvoir modifier les contenus pédagogiques.

**Why this priority**: C’est la valeur centrale du rôle : visibilité stratégique immédiate et sécurisée pour le fondateur, distincte de l’administration opérationnelle.

**Independent Test**: À partir d’un compte disposant uniquement du rôle Propriétaire sur un établissement, ouvrir l’espace Propriétaire, afficher le tableau de bord, vérifier la présence des familles d’indicateurs convenues et l’absence d’actions de modification sur les domaines académiques listés comme lecture seule.

**Acceptance Scenarios**:

1. **Given** un utilisateur authentifié avec le rôle Propriétaire sur l’établissement actif, **When** il ouvre l’espace Propriétaire, **Then** il accède au tableau de bord sans erreur et voit des indicateurs regroupés par domaines (finances, synthèse académique, personnel, formations, alertes).
2. **Given** un utilisateur authentifié sans le rôle Propriétaire, **When** il tente d’ouvrir l’espace Propriétaire, **Then** l’accès est refusé et une expérience claire d’« non autorisé » est proposée (sans exposer de données sensibles).
3. **Given** un Propriétaire sur le tableau de bord, **When** il parcourt les sections pilotage, **Then** il peut comparer certaines valeurs à la période précédente lorsque les données existent (sinon affichage explicite d’indisponibilité).

---

### User Story 2 - Le Propriétaire analyse les finances et exporte un rapport (Priority: P1)

Le Propriétaire consulte les agrégats financiers (revenus, recouvrement par cycle, impayés au-delà d’un seuil, rémunérations enseignants avec statuts). Il filtre par période et, le cas échéant, par cycle ou classe pour le recouvrement. Il télécharge un rapport financier consolidé au format choisi parmi les formats proposés par le produit.

**Why this priority**: La visibilité financière et le recouvrement sont au cœur de la gouvernance de l’établissement.

**Independent Test**: Parcourir la vue finances, appliquer les filtres de période, vérifier la cohérence des totaux avec les sources visibles côté métier (paiements, échéanciers), lancer un export et contrôler que les colonnes respectent la règle de minimisation des données personnelles pour les exports globaux.

**Acceptance Scenarios**:

1. **Given** un Propriétaire authentifié, **When** il ouvre la vue finances et sélectionne une période (mois, trimestre ou année scolaire selon ce que le produit expose), **Then** les agrégats et listes associées se mettent à jour pour cette période.
2. **Given** un Propriétaire sur le recouvrement par cycle, **When** il ouvre le détail par classe, **Then** il obtient une ventilation cohérente sans pouvoir modifier les montants ou les inscriptions sous-jacentes.
3. **Given** un Propriétaire sur la liste des impayés, **When** la liste est affichée, **Then** les dossiers sont triés par ancienneté de l’impayé et le seuil par défaut des impayés longue durée est d’au moins 60 jours calendaires sauf configuration métier différente documentée côté produit.
4. **Given** un Propriétaire demande un export de rapport financier, **When** le fichier est généré, **Then** les identifiants d’élèves dans les vues globales respectent la politique de minimisation (initiales ou identifiant non nominatif) et les champs nécessaires à la compréhension financière restent présents.

---

### User Story 3 - Le Propriétaire valide une rémunération enseignante en attente (Priority: P2)

Le Propriétaire consulte la liste des rémunérations enseignants avec statuts (payé, en attente, non validé). Pour les éléments éligibles, il déclenche une action de validation qui fait passer l’élément dans un état « validé par le propriétaire » traçable.

**Why this priority**: C’est l’une des rares actions de modification explicitement attendue côté RH / finances, distincte du pilotage académique en lecture seule.

**Independent Test**: Identifier un paiement enseignant en attente de validation, lancer la validation, vérifier le nouvel état, l’horodatage ou équivalent métier de traçabilité, et l’impossibilité de valider hors périmètre ou sans droit.

**Acceptance Scenarios**:

1. **Given** un Propriétaire sur la section rémunérations, **When** il valide un paiement enseignant éligible, **Then** le statut reflète la validation et l’action est enregistrée de manière auditable.
2. **Given** un Propriétaire, **When** il tente de valider un paiement déjà validé ou non éligible, **Then** le système refuse l’action avec un message compréhensible sans altérer les données existantes.

---

### User Story 4 - Le Propriétaire consulte les synthèses académiques et d’assiduité (Priority: P2)

Le Propriétaire consulte des moyennes par classe, des indicateurs de réussite par programme, des statistiques d’assiduité agrégées et le taux de correction des devoirs, sous forme de tableaux et graphiques de synthèse. Aucune saisie ou modification de notes, devoirs ou feuilles d’émargement n’est proposée.

**Why this priority**: Complète la vision stratégique sans confondre avec les rôles pédagogiques ou administratifs de gestion courante.

**Independent Test**: Parcourir la vue académique, trier un tableau de moyennes par classe, vérifier l’affichage des classes « à risque » lorsque l’assiduité agrégée est sous un seuil configurable avec valeur par défaut métier, confirmer l’absence totale de formulaires de modification.

**Acceptance Scenarios**:

1. **Given** un Propriétaire sur la vue académique, **When** il consulte le tableau des moyennes par classe, **Then** il peut trier les colonnes pertinentes sans modifier les valeurs sources.
2. **Given** des données sur deux semestres, **When** le Propriétaire affiche la comparaison d’évolution, **Then** le graphique ou la synthèse proposée distingue clairement les périodes comparées.
3. **Given** une classe dont le taux d’assiduité agrégé est sous le seuil d’alerte paramétrable, **When** le Propriétaire consulte l’indicateur de risque, **Then** la classe apparaît dans la liste ou le visuel des classes à risque.

---

### User Story 5 - Le Propriétaire gère les rôles des utilisateurs et traite les alertes (Priority: P3)

Le Propriétaire consulte la liste des utilisateurs de l’établissement dans le périmètre autorisé et peut modifier l’attribution des rôles conformément aux règles métier (sans étendre son propre périmètre de sécurité). Il consulte les alertes en attente et peut les acquitter lorsque l’action est pertinente.

**Why this priority**: Gouvernance des accès et réduction du bruit des alertes, après les vues de pilotage principales.

**Independent Test**: Modifier le rôle d’un utilisateur test dans un bac à sable, vérifier les contraintes (impossibilité d’actions interdites, journalisation si prévue par le produit), acquitter une alerte et constater qu’elle quitte la liste des alertes actives ou change d’état de manière cohérente.

**Acceptance Scenarios**:

1. **Given** un Propriétaire sur la gestion des rôles, **When** il attribue ou retire un rôle autorisé à un utilisateur du périmètre, **Then** la modification est reflétée immédiatement dans l’interface et les accès futurs de cet utilisateur sont cohérents avec le nouveau rôle.
2. **Given** un Propriétaire sur le centre d’alertes, **When** il acquitte une alerte, **Then** l’alerte est marquée comme traitée ou archivée selon la logique métier et n’apparaît plus comme « en attente » pour ce Propriétaire.

---

### User Story 6 - Le Propriétaire consulte le personnel, les formations et le RSO en synthèse (Priority: P3)

Le Propriétaire consulte une synthèse du personnel (enseignants actifs, heures enseignées, cours sans titulaire, validations de paie en attente), ainsi que les formations professionnelles (sessions, inscriptions, revenus, entreprises clientes) et le volet RSO en lecture seule conformément au tableau des droits.

**Why this priority**: Complète le tableau de bord pour une vision transverse des ressources et de l’offre de formation.

**Independent Test**: Vérifier les compteurs et listes affichés contre un jeu de données de référence pour un établissement, et l’alignement avec les règles lecture seule vs export pour les formations.

**Acceptance Scenarios**:

1. **Given** un Propriétaire sur la vue personnel, **When** il consulte la liste des enseignants actifs et des cours sans titulaire, **Then** les lignes affichées correspondent aux enregistrements existants pour l’établissement sans actions de modification pédagogique.
2. **Given** un Propriétaire sur la vue formations, **When** il consulte les sessions actives et les inscriptions, **Then** il peut exporter lorsque le domaine le permet, sans modifier le contenu pédagogique des formations.

---

### Edge Cases

- Aucune donnée pour la période ou l’année scolaire sélectionnée : affichage d’états vides explicites, sans erreurs techniques visibles pour l’utilisateur.
- Utilisateur révoqué ou session expirée pendant la consultation : redirection vers la connexion, sans fuite d’informations sur l’écran d’erreur.
- Propriétaire rattaché à plusieurs établissements (tenants) : le périmètre visible correspond uniquement aux établissements auxquels il est autorisé ; le changement d’établissement actif recharge les indicateurs pour cet établissement.
- Conflit de rôles (même personne Propriétaire et autre rôle) : les règles les plus restrictives s’appliquent dans l’espace Propriétaire pour les domaines en lecture seule (aucune modification académique depuis cet espace).
- Export volumineux ou limite de taille : message clair et proposition de réduire la période ou le périmètre, sans corruption de fichier.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La plateforme MUST proposer un rôle distinct « Propriétaire » (Owner), séparé des rôles administrateur, enseignant, élève, parent et formateur, et réservé par intention métier au fondateur ou à la gouvernance équivalente de l’établissement.
- **FR-002**: Seuls les utilisateurs disposant du rôle Propriétaire sur l’établissement actif MUST pouvoir accéder aux écrans et aux données agrégées de l’espace Propriétaire ; tout autre rôle MUST être refusé pour ces accès.
- **FR-003**: Pour les domaines notes, devoirs, bulletins, assiduité détaillée, inscriptions, classes, cycles et contenu pédagogique des formations, le Propriétaire MUST disposer uniquement de capacités de lecture et d’export lorsque le domaine prévoit l’export ; aucune création, mise à jour ou suppression MUST être offerte via l’espace Propriétaire pour ces contenus.
- **FR-004**: Pour les finances (paiements, échéanciers, rapports financiers), le Propriétaire MUST pouvoir consulter, filtrer par période et cycle, et exporter des rapports consolidés ; les listes d’impayés MUST mettre en avant les dossiers au-delà du seuil de longue durée avec tri par ancienneté.
- **FR-005**: Pour les rémunérations enseignants, le Propriétaire MUST voir les statuts (payé, en attente, non validé) et MUST pouvoir valider les éléments explicitement en attente de validation propriétaire, avec traçabilité de l’action.
- **FR-006**: Pour les formations professionnelles, le Propriétaire MUST disposer au minimum de la lecture et, lorsque applicable, de l’export autorisé par les règles métier ; le volet RSO MUST rester en lecture seule.
- **FR-007**: Pour les utilisateurs et rôles, le Propriétaire MUST pouvoir consulter les utilisateurs de son périmètre et modifier l’attribution des rôles dans les limites définies par la politique de sécurité du produit (sans accorder à un utilisateur des privilèges que le Propriétaire ne peut pas légitimement déléguer).
- **FR-008**: Pour les alertes et notifications destinées au pilotage, le Propriétaire MUST pouvoir les consulter et les acquitter lorsque l’acquittement est prévu ; l’acquittement MUST être l’une des seules actions d’écriture autorisées en dehors des finances et RH couverts par les exigences ci-dessus.
- **FR-009**: Le tableau de bord Propriétaire MUST présenter des indicateurs consolidés couvrant au minimum : finances (revenus période en cours, taux de recouvrement global et par cycle, taux de paiement des enseignants sur la période, nombre d’élèves en impayé longue durée), synthèse académique (effectifs, classes, moyenne générale indicative, taux de réussite synthétique, assiduité sur fenêtre glissante définie par le produit, taux de devoirs corrigés), personnel (enseignants actifs, volume d’heures enseignées, cours sans titulaire, validations de paie en attente), formations (sessions actives, inscriptions, revenus formations, entreprises clientes), et une liste d’alertes avec niveau de criticité.
- **FR-010**: Les exports financiers globaux MUST limiter les données personnelles des élèves aux initiales ou identifiants non nominatifs lorsque l’export n’est pas individuel et nominatif par conception métier ; les montants et agrégats nécessaires à la compréhension financière MUST rester disponibles.
- **FR-011**: Toutes les données présentées dans l’espace Propriétaire MUST respecter l’isolation par établissement : un Propriétaire ne voit que les données des établissements auxquels il est rattaché, jamais celles d’un autre client de la plateforme.
- **FR-012**: Les accès Propriétaire MUST respecter les mêmes exigences d’authentification et de révocation de session que le reste du produit, sans affaiblissement spécifique à cet espace.

### Assumptions

- Le rôle Propriétaire est créé et assignable dans le référentiel des rôles par établissement ; chaque établissement peut disposer d’au plus un petit nombre de comptes Propriétaire (souvent un), sans formaliser ici la procédure d’onboarding légale.
- Les seuils paramétrables (assiduité « à risque », autres alertes) possèdent des valeurs par défaut livrées avec le produit et modifiables ultérieurement par des profils d’administration autorisés, hors périmètre détaillé de cette spécification.
- Les indicateurs « moyenne générale » et « taux de réussite » sont calculés selon les définitions déjà utilisées dans le produit pour les rapports académiques existants, afin d’assurer la cohérence perçue par les utilisateurs.

### Key Entities *(include if feature involves data)*

- **Rôle Propriétaire**: Rôle applicatif rattaché à un ou plusieurs établissements ; définit le périmètre d’accès à l’espace Propriétaire.
- **Établissement (tenant)**: Unité d’isolation des données ; toutes les vues Propriétaire sont bornées par l’établissement actif et les établissements liés au compte.
- **Indicateur de pilotage**: Valeur agrégée ou série temporelle affichée sur le tableau de bord ou les vues thématiques (finances, académique, personnel, formations).
- **Alerte**: Message priorisé avec criticité, domaine source, date de création, état (en attente, acquittée).
- **Ligne de rémunération enseignant**: Enregistrement représentant une rémunération ou un lot à valider, avec statuts et historique de validation.
- **Export de rapport**: Fichier ou téléchargement généré à la demande, soumis aux règles de minimisation des données personnelles.
- **Attribution de rôle utilisateur**: Lien entre un compte utilisateur et un rôle au sein d’un établissement, modifiable par le Propriétaire dans les limites de politique.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un Propriétaire authentifié affiche un tableau de bord exploitable (toutes les familles d’indicateurs présentes ou explicitement marquées comme sans donnée) en moins de trois minutes après la sélection de l’établissement et de l’année scolaire lorsque ces choix sont nécessaires.
- **SC-002**: Dans des tests de permissions couvrant au moins les rôles administrateur, enseignant, élève, parent et formateur, 100 % des tentatives d’accès aux fonctions réservées au Propriétaire depuis ces rôles sont refusées sans exposition de données métier.
- **SC-003**: Pour un jeu de données de référence sur un établissement, les totaux financiers affichés (revenus de période, montants d’impayés listés) correspondent aux sommes attendues avec un écart nul par rapport à la définition métier de ces totaux.
- **SC-004**: Après validation d’une rémunération enseignant éligible, 100 % des cas testés montrent un statut à jour et une trace d’action consultable ou vérifiable par un profil d’audit autorisé dans le produit.
- **SC-005**: Sur un échantillon d’exports financiers globaux, au moins 95 % des lignes élèves utilisent uniquement des identifiants minimisés (initiales ou identifiant non nominatif) tout en conservant les champs financiers requis pour l’analyse.
- **SC-006**: Au moins 90 % des utilisateurs testeurs représentant le Propriétaire jugent qu’ils peuvent prendre une décision informée sur la santé financière et la charge pédagogique globale sans recourir à un autre outil, d’après un questionnaire court post-démonstration (échelle de satisfaction simple).
