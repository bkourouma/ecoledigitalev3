# Feature Specification: Phase 2 - Gestion des Installations RSO-PFSO

**Feature Branch**: `022-phase`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "Phase 2 - Gestion des Installations"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Administrateur gère les installations portuaires (Priority: P1)

Un administrateur doit pouvoir créer, consulter, modifier et supprimer les installations portuaires, avec la possibilité de rechercher, filtrer, et exporter les données. Les 19 installations prédéfinies doivent être pré-chargées dans le système.

**Why this priority**: La gestion des installations est la base de toute la plateforme RSO-PFSO. Sans installations, les agents PFSO ne peuvent pas être assignés, et les activités de sûreté ne peuvent pas être enregistrées. C'est un prérequis critique pour les phases suivantes.

**Independent Test**: Un administrateur peut accéder à la liste des installations, voir les 19 installations prédéfinies, créer une nouvelle installation avec toutes les informations requises, modifier une installation existante, et supprimer une installation (avec restauration possible depuis les archives). Cela démontre le CRUD complet et la gestion de base des installations.

**Acceptance Scenarios**:

1. **Given** un administrateur est connecté, **When** il accède à la page de gestion des installations, **Then** il voit la liste complète des 19 installations prédéfinies avec leurs informations principales (code, nom, ville, type, statut)
2. **Given** un administrateur consulte la liste des installations, **When** il applique des filtres (ville, type, statut) et effectue une recherche par nom ou code, **Then** la liste est filtrée et affiche uniquement les installations correspondantes
3. **Given** un administrateur crée une nouvelle installation, **When** il remplit tous les champs obligatoires (nom, code, type, ville, statut) et soumet le formulaire, **Then** l'installation est créée avec succès, le code est unique, et l'installation apparaît dans la liste
4. **Given** un administrateur crée une installation, **When** il saisit un code d'installation déjà existant, **Then** le système affiche une erreur en temps réel indiquant que le code existe déjà
5. **Given** un administrateur modifie une installation existante, **When** il change des informations et sauvegarde, **Then** les modifications sont enregistrées et l'historique des modifications est tracé
6. **Given** un administrateur supprime une installation, **When** il confirme la suppression, **Then** l'installation est archivée (soft delete) et peut être restaurée depuis la page des archives
7. **Given** un administrateur consulte les détails d'une installation, **When** il ouvre la modal de détails, **Then** il voit toutes les informations (coordonnées, responsables, statistiques, informations système)
8. **Given** un administrateur exporte la liste des installations, **When** il choisit le format Excel ou PDF, **Then** un fichier est généré avec toutes les installations et leurs informations principales

---

### User Story 2 - Formateur RSO crée et gère ses installations (Priority: P1)

Un formateur RSO doit pouvoir créer des installations, modifier celles qu'il a créées, et consulter toutes les installations. Il ne peut pas supprimer les installations (seul l'administrateur peut le faire).

**Why this priority**: Les formateurs RSO sont les utilisateurs opérationnels principaux qui doivent pouvoir gérer les installations portuaires. Cette délégation améliore l'efficacité opérationnelle sans compromettre la sécurité (pas de suppression).

**Independent Test**: Un formateur RSO peut créer une nouvelle installation, voir toutes les installations dans une interface adaptée (cartes ou tableau), modifier une installation qu'il a créée, et consulter les détails de n'importe quelle installation. Il ne voit pas d'option de suppression. Cela valide la délégation et les restrictions appropriées.

**Acceptance Scenarios**:

1. **Given** un formateur RSO est connecté, **When** il accède à la page "Mes installations", **Then** il voit toutes les installations avec une indication visuelle de celles qu'il a créées
2. **Given** un formateur RSO crée une installation, **When** il remplit le formulaire et soumet, **Then** l'installation est créée avec succès et il est enregistré comme créateur
3. **Given** un formateur RSO consulte une installation qu'il a créée, **When** il modifie les informations, **Then** les modifications sont sauvegardées avec succès
4. **Given** un formateur RSO consulte une installation créée par un autre utilisateur, **When** il tente de la modifier, **Then** le système refuse l'accès avec un message indiquant qu'il ne peut modifier que ses propres installations
5. **Given** un formateur RSO consulte la liste des installations, **When** il utilise les filtres et la recherche, **Then** les résultats sont filtrés correctement selon les critères

---

### User Story 3 - Système gère les années (2004 à aujourd'hui) (Priority: P1)

Le système doit pré-charger automatiquement toutes les années de 2004 à l'année courante, permettre la sélection d'une année active, et ajouter automatiquement la nouvelle année chaque 1er janvier.

**Why this priority**: Le sélecteur d'années est essentiel pour toute la suite de la plateforme (Phase 3 et suivantes). Les activités, statistiques, et rapports sont tous organisés par année. Sans cette fonctionnalité, les phases suivantes ne peuvent pas fonctionner.

**Independent Test**: Un utilisateur peut sélectionner une année dans le sélecteur global, voir toutes les années de 2004 à l'année courante, et l'année sélectionnée est persistée entre les pages. Le système ajoute automatiquement la nouvelle année le 1er janvier. Cela valide le système de gestion des années complet.

**Acceptance Scenarios**:

1. **Given** le système est initialisé, **When** la base de données est configurée, **Then** toutes les années de 2004 à l'année courante sont pré-chargées avec le statut approprié (année courante = active, autres = archivées)
2. **Given** un utilisateur accède à la plateforme, **When** il ouvre le sélecteur d'années, **Then** il voit toutes les années disponibles de 2004 à l'année courante, avec l'année active mise en évidence
3. **Given** un utilisateur sélectionne une année, **When** il change d'année dans le sélecteur, **Then** l'année sélectionnée est sauvegardée en session, toutes les données affichées sont filtrées par cette année, et l'année reste sélectionnée lors de la navigation entre les pages
4. **Given** le système fonctionne le 1er janvier, **When** la tâche automatique s'exécute, **Then** l'année précédente est archivée, la nouvelle année est ajoutée avec le statut "active", et un log est enregistré
5. **Given** un administrateur consulte la gestion des années, **When** il accède à cette section, **Then** il voit toutes les années avec leur statut et peut modifier manuellement le statut si nécessaire

---

### User Story 4 - Administrateur associe les agents PFSO aux installations (Priority: P2)

Un administrateur doit pouvoir assigner un agent PFSO à une installation lors de la création du compte, et modifier cette assignation si nécessaire. Un agent PFSO ne peut être assigné qu'à une seule installation à la fois.

**Why this priority**: L'association installation-agent PFSO est nécessaire pour restreindre l'accès des agents aux activités de leur installation uniquement. Cette fonctionnalité est préparée dans Phase 1 mais doit être complétée avec la gestion des installations.

**Independent Test**: Un administrateur peut créer un agent PFSO et lui assigner une installation depuis une liste déroulante. L'agent peut ensuite se connecter et voir uniquement les données de son installation. Si l'administrateur modifie l'assignation, l'agent perd l'accès à l'ancienne installation. Cela valide l'association et les restrictions d'accès.

**Acceptance Scenarios**:

1. **Given** un administrateur crée un agent PFSO, **When** il remplit le formulaire de création, **Then** il doit sélectionner une installation depuis une liste déroulante des installations actives, et l'assignation est obligatoire
2. **Given** un agent PFSO est assigné à une installation, **When** il se connecte et consulte les données, **Then** il voit uniquement les informations liées à son installation assignée
3. **Given** un administrateur modifie l'assignation d'un agent PFSO, **When** il change l'installation assignée, **Then** l'agent perd l'accès aux données de l'ancienne installation et gagne l'accès à la nouvelle
4. **Given** un administrateur consulte la liste des agents PFSO, **When** il filtre par installation, **Then** il voit uniquement les agents assignés à l'installation sélectionnée

---

### User Story 5 - Administrateur gère les responsables d'installation (Priority: P2)

Un administrateur doit pouvoir assigner des responsables (PFSO Principal, PFSO Adjoint, RSO Référent) à une installation, avec des dates de début et de fin, et consulter l'historique des responsables.

**Why this priority**: La gestion des responsables permet de tracer qui est responsable de chaque installation à chaque période. C'est important pour la conformité ISPS et la traçabilité des responsabilités.

**Independent Test**: Un administrateur peut accéder à la page de gestion des responsables d'une installation, voir les responsables actuels, ajouter un nouveau responsable avec type et dates, et modifier ou retirer un responsable existant. L'historique complet est conservé. Cela valide la gestion complète des responsables.

**Acceptance Scenarios**:

1. **Given** un administrateur consulte une installation, **When** il accède à la section "Responsables", **Then** il voit tous les responsables actuels avec leur type, nom, et date de début
2. **Given** un administrateur ajoute un responsable, **When** il sélectionne le type (PFSO Principal, PFSO Adjoint, RSO Référent), choisit un utilisateur, et définit la date de début, **Then** le responsable est assigné avec succès et apparaît dans la liste
3. **Given** un administrateur modifie un responsable, **When** il change la date de fin ou le type, **Then** les modifications sont sauvegardées et l'historique est mis à jour
4. **Given** un administrateur retire un responsable, **When** il définit une date de fin, **Then** le responsable devient inactif mais reste dans l'historique
5. **Given** un administrateur consulte l'historique des responsables, **When** il accède à cette section, **Then** il voit tous les responsables passés et actuels avec leurs périodes d'activité

---

### User Story 6 - Utilisateurs consultent les statistiques par installation (Priority: P2)

Les administrateurs et formateurs RSO doivent pouvoir consulter des statistiques globales et par installation (nombre d'activités, incidents, répartition par type, évolution temporelle).

**Why this priority**: Les statistiques permettent de suivre l'activité de sûreté portuaire et d'identifier les tendances. Cependant, cette fonctionnalité dépend partiellement de la Phase 3 (activités), donc certaines statistiques peuvent être préparées mais pas complètement fonctionnelles sans les données d'activités.

**Independent Test**: Un administrateur peut accéder au dashboard des installations, voir les statistiques globales (nombre total d'installations, répartition par ville et type), et consulter les statistiques détaillées d'une installation spécifique. Les données sont filtrées par année sélectionnée. Cela valide l'affichage des statistiques de base.

**Acceptance Scenarios**:

1. **Given** un administrateur accède au dashboard des installations, **When** il consulte la vue d'ensemble, **Then** il voit les métriques principales : nombre total d'installations, installations actives, répartition par ville, répartition par type
2. **Given** un administrateur consulte les statistiques d'une installation, **When** il sélectionne une installation et une année, **Then** il voit les statistiques de cette installation pour l'année sélectionnée (nombre d'activités, incidents, dernière activité)
3. **Given** un formateur RSO consulte les statistiques, **When** il accède au dashboard, **Then** il voit les mêmes statistiques que l'administrateur mais uniquement pour les installations qu'il peut gérer
4. **Given** les statistiques sont affichées, **When** l'année sélectionnée change, **Then** toutes les statistiques sont recalculées et mises à jour pour la nouvelle année

---

### Edge Cases

- Que se passe-t-il si un administrateur tente de supprimer une installation qui a des agents PFSO assignés ? Le système doit empêcher la suppression ou demander de réassigner les agents d'abord
- Comment le système gère-t-il la génération automatique du code d'installation si le code suggéré existe déjà ? Le système doit proposer un code alternatif ou incrémenter un suffixe
- Que se passe-t-il si un formateur RSO tente de modifier une installation créée par un autre formateur ? Le système doit refuser l'accès avec un message clair
- Comment le système gère-t-il l'ajout automatique de la nouvelle année si la tâche automatique échoue ? Un mécanisme de récupération doit être prévu avec notification à l'administrateur
- Que se passe-t-il si un agent PFSO est assigné à une installation qui est ensuite supprimée (archivée) ? L'agent doit être notifié et réassigné, ou l'installation doit être restaurée
- Comment le système gère-t-il les caractères spéciaux dans les noms d'installations et codes ? La validation doit accepter les caractères appropriés tout en empêchant les caractères dangereux
- Que se passe-t-il si deux utilisateurs tentent de créer une installation avec le même code simultanément ? Le système doit détecter le conflit et refuser la deuxième création
- Comment le système gère-t-il l'export de très grandes listes d'installations (100+ installations) ? L'export doit être asynchrone avec notification de completion
- Que se passe-t-il si une installation est modifiée pendant qu'un autre utilisateur la consulte ? Le système doit afficher les données les plus récentes sans conflit de version
- Comment le système gère-t-il la restauration d'une installation archivée si le code existe toujours mais avec un autre ID ? Le système doit vérifier l'unicité du code avant restauration

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST pre-load 19 predefined port facility installations with their complete information (name, code, type, city, status)
- **FR-002**: System MUST allow administrators to create new port facility installations with required fields (name, code, type, city, status) and optional fields (address, contact information, comments)
- **FR-003**: System MUST enforce uniqueness of installation codes across all installations
- **FR-004**: System MUST validate installation codes according to format rules (3-20 characters, uppercase letters and underscores only)
- **FR-005**: System MUST allow administrators to view, modify, and delete (soft delete) any installation
- **FR-006**: System MUST allow RSO Formateurs to create installations and modify only installations they created
- **FR-007**: System MUST prevent RSO Formateurs from deleting installations (only administrators can delete)
- **FR-008**: System MUST provide search functionality for installations by name or code with real-time filtering
- **FR-009**: System MUST provide filtering capabilities for installations by city (Abidjan, San-Pedro), type (port commerce, container terminal, oil terminal, mineral terminal, other), and status (active, inactive, maintenance)
- **FR-010**: System MUST display installations in a table or card view with pagination (configurable items per page)
- **FR-011**: System MUST allow administrators to export installation lists in Excel and PDF formats
- **FR-012**: System MUST implement soft delete for installations (archiving instead of permanent deletion)
- **FR-013**: System MUST provide a page for archived installations where administrators can restore or permanently delete installations
- **FR-014**: System MUST display installation details in a modal or dedicated page showing all information (general info, coordinates, assigned responsible persons, statistics, system information)
- **FR-015**: System MUST track creation and modification history for each installation (who created, when, who modified, when)
- **FR-016**: System MUST pre-load all years from 2004 to the current year in the system with appropriate status (current year = active, others = archived)
- **FR-017**: System MUST automatically add the new year on January 1st of each year, archiving the previous year
- **FR-018**: System MUST provide a global year selector component accessible from all pages
- **FR-019**: System MUST persist the selected year in user session across page navigation
- **FR-020**: System MUST filter all year-dependent data (statistics, activities, reports) based on the selected year
- **FR-021**: System MUST allow administrators to manually add years if needed (for historical data or corrections)
- **FR-022**: System MUST allow administrators to modify year status (active/archived) manually
- **FR-023**: System MUST allow administrators to assign an installation to an Agent PFSO during account creation (modification of Phase 1 user creation form)
- **FR-024**: System MUST require that Agent PFSO accounts be assigned to exactly one installation
- **FR-025**: System MUST allow administrators to modify the installation assignment of an Agent PFSO after account creation
- **FR-026**: System MUST restrict Agent PFSO access to data from their assigned installation only
- **FR-027**: System MUST allow administrators to assign responsible persons (PFSO Principal, PFSO Adjoint, RSO Référent) to installations
- **FR-028**: System MUST track responsible person assignments with start dates and optional end dates
- **FR-029**: System MUST allow administrators to modify or remove responsible person assignments
- **FR-030**: System MUST maintain complete history of responsible person assignments for each installation
- **FR-031**: System MUST display current responsible persons for each installation in the installation details
- **FR-032**: System MUST provide statistics dashboard showing global metrics (total installations, active installations, distribution by city, distribution by type)
- **FR-033**: System MUST provide per-installation statistics (number of activities, incidents, last activity date) filtered by selected year
- **FR-034**: System MUST calculate and display activity statistics per installation when activity data is available (Phase 3 dependency)
- **FR-035**: System MUST validate installation names (3-150 characters, no dangerous special characters)
- **FR-036**: System MUST validate optional contact phone numbers according to format (+225 followed by 10 digits)
- **FR-037**: System MUST validate optional contact email addresses according to standard email format
- **FR-038**: System MUST provide real-time validation feedback during installation creation (checking code uniqueness)
- **FR-039**: System MUST sanitize all user inputs to prevent injection attacks (XSS, SQL injection)
- **FR-040**: System MUST log all installation management actions (create, update, delete, restore) in activity logs with user, action, timestamp, and details
- **FR-041**: System MUST prevent deletion of installations that have assigned Agent PFSO users (or require reassignment first)
- **FR-042**: System MUST generate installation codes automatically based on port name and city if not manually provided
- **FR-043**: System MUST ensure generated installation codes are unique by checking existing codes and incrementing if necessary
- **FR-044**: System MUST display installation status with visual indicators (active = green, inactive = gray, maintenance = yellow)
- **FR-045**: System MUST allow filtering and sorting of installation lists by multiple criteria simultaneously
- **FR-046**: System MUST provide reset filters functionality to clear all applied filters and return to default view
- **FR-047**: System MUST support export of filtered installation lists (only exported installations matching current filters)
- **FR-048**: System MUST display installation type in user-friendly format (e.g., "Port de commerce" instead of "port_commerce")
- **FR-049**: System MUST allow administrators to change installation status (active, inactive, maintenance) from the list view
- **FR-050**: System MUST provide confirmation dialog before deleting installations to prevent accidental deletion

### Key Entities *(include if feature involves data)*

- **Port Facility Installation**: Represents a port facility location where security activities are conducted. Key attributes: unique code, name, type (port commerce, container terminal, oil terminal, mineral terminal, other), city (Abidjan or San-Pedro), status (active, inactive, maintenance), contact information (address, contact person name, phone, email), optional comments, creation and modification metadata (created by, created at, updated at), soft delete timestamp. Relationships: has many assigned Agent PFSO users, has many responsible person assignments, will have many activities (Phase 3), will have many incidents (Phase 4)

- **Year**: Represents a calendar year used for organizing and filtering data. Key attributes: year number (2004 to current), status (active or archived), creation timestamp. Used for filtering activities, statistics, and reports. Only one year can be active at a time (the current year).

- **Installation Responsible Assignment**: Represents the assignment of a responsible person to an installation. Key attributes: installation reference, user reference (Agent PFSO or RSO Formateur), type of responsibility (PFSO Principal, PFSO Adjoint, RSO Référent), start date, optional end date, status (active or inactive), creation timestamp. Relationships: belongs to one installation, belongs to one user. Maintains complete history even after assignment ends.

- **User-Installation Association**: Represents the assignment of an Agent PFSO user to an installation. This extends the User entity from Phase 1. Key attribute: installation_id (foreign key to installation). A user can be assigned to only one installation at a time. This association restricts the user's access to data from their assigned installation only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can view the complete list of 19 predefined installations in under 2 seconds
- **SC-002**: Administrators can create a new installation with all required fields in under 30 seconds from form access to confirmation
- **SC-003**: Installation code uniqueness validation completes in under 500 milliseconds and provides real-time feedback
- **SC-004**: Search and filter operations on installation lists return results in under 1 second for up to 50 installations
- **SC-005**: Installation list page loads and displays with pagination in under 2 seconds for up to 100 installations
- **SC-006**: Excel export of installation list generates and downloads in under 10 seconds for up to 50 installations
- **SC-007**: PDF export of installation list generates and downloads in under 15 seconds for up to 50 installations
- **SC-008**: Year selector component loads all available years (2004 to current) in under 500 milliseconds
- **SC-009**: Year selection persists across page navigation for 100% of user sessions
- **SC-010**: Automatic year addition on January 1st completes successfully within 1 hour of scheduled time
- **SC-011**: RSO Formateurs can create installations and see them appear in their list in under 5 seconds after submission
- **SC-012**: RSO Formateurs attempting to modify installations they didn't create receive clear error messages within 1 second
- **SC-013**: Agent PFSO assignment to installation completes successfully in under 3 seconds during user account creation
- **SC-014**: Installation statistics dashboard loads all metrics and visualizations in under 3 seconds for any selected year
- **SC-015**: Responsible person assignment to installation completes successfully in under 5 seconds
- **SC-016**: Installation detail modal/page displays complete information in under 1 second
- **SC-017**: Soft delete of installation archives the record in under 2 seconds
- **SC-018**: Restoration of archived installation completes successfully in under 3 seconds
- **SC-019**: 95% of installation creation operations complete successfully without validation errors
- **SC-020**: 100% of installation code uniqueness checks prevent duplicate codes from being saved
- **SC-021**: All installation management actions (create, update, delete) are logged in activity logs with complete context
- **SC-022**: System prevents deletion of installations with assigned Agent PFSO users with clear error messages
- **SC-023**: Filtered installation lists accurately reflect all applied filters in 100% of cases
- **SC-024**: Export files (Excel, PDF) are correctly formatted and openable in standard applications without data corruption

## Assumptions

- The 19 predefined installations list is final and will not change frequently
- Only two cities are supported: Abidjan and San-Pedro (no other cities need to be added in the near future)
- Installation codes follow a consistent pattern (PAD_XXX for Abidjan, PSP_XXX for San-Pedro) but the system should be flexible enough to accept other formats
- Year management starts from 2004 as the earliest historical data point needed
- Automatic year addition uses a scheduled task mechanism that runs reliably on January 1st
- Installation types are fixed (port commerce, container terminal, oil terminal, mineral terminal, other) and will not change frequently
- Soft delete is sufficient for installations (no need for permanent deletion in normal operations)
- Agent PFSO users are assigned to exactly one installation (no multi-installation assignments needed)
- Responsible person assignments can overlap (multiple PFSO Adjoints can be active simultaneously)
- Statistics for activities and incidents will be available after Phase 3 and Phase 4 implementation
- Export functionality uses standard file formats (Excel .xlsx, PDF) that are compatible with common office software
- Installation contact information is optional and may not be available for all installations
- The system will handle up to 50 installations initially, with potential growth to 100+ installations
- Installation codes are case-sensitive and must be unique across the entire system (not just per tenant if multi-tenant)
- Year selection affects all year-dependent data consistently across the entire application

## Dependencies

- **Phase 1 (Infrastructure et Authentification)**: Required for user management, role-based access control, authentication, and activity logging infrastructure. The `rso_users` table must exist and be modifiable to add `installation_id` field.
- **Database Schema**: Requires creation of new tables (`rso_installations`, `rso_annees`, `rso_installation_responsables`) and modification of existing `rso_users` table.
- **Scheduled Task System**: Required for automatic year addition on January 1st (cron job or equivalent task scheduler).
- **File Export Libraries**: Required for Excel and PDF export functionality (libraries must support the required formats).
- **Email Service** (optional): May be needed for notifications when installations are assigned or modified, but not critical for Phase 2.

## Out of Scope

- Multi-installation assignment for Agent PFSO users (one user = one installation only)
- Permanent deletion of installations (only soft delete/archiving is supported)
- Custom installation type creation (types are predefined)
- Installation location mapping or geographic visualization
- Integration with external port management systems
- Real-time collaboration on installation editing (single-user editing model)
- Installation versioning or change history beyond basic audit logs
- Bulk import of installations from external files (manual creation only)
- Installation templates or cloning functionality
- Multi-language support for installation names and descriptions (French only)
- Installation-specific custom fields beyond the defined schema
- Advanced analytics or predictive statistics for installations
- Integration with Phase 3 activities management (statistics will be prepared but not fully functional until Phase 3)
