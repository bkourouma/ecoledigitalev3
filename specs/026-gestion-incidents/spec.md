# Feature Specification: Phase 6 - Gestion des Incidents

**Feature Branch**: `026-gestion-incidents`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "Phase 6 - Gestion des Incidents: Système complet de gestion des incidents de sûreté avec enregistrement rapide, workflow de traitement, notifications automatiques, dashboard, statistiques et rapports PDF"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent de Sûreté enregistre rapidement un incident (Priority: P1)

Un agent de sûreté doit pouvoir enregistrer un incident de sûreté rapidement depuis son poste de travail ou un terminal mobile, en saisissant les informations essentielles (type, localisation, description, urgence) et en uploadant des preuves (photos, vidéos) si disponibles.

**Why this priority**: L'enregistrement rapide d'incidents est critique pour la sûreté portuaire. En situation d'urgence, chaque seconde compte. Cette fonctionnalité permet de capturer les informations essentielles immédiatement, même depuis le terrain, et de déclencher les notifications automatiques aux responsables.

**Independent Test**: Un agent de sûreté peut accéder au formulaire d'enregistrement rapide, remplir les champs obligatoires (installation, type d'incident, date/heure, zone, description courte, niveau d'urgence), uploader une photo, et enregistrer l'incident. L'incident est créé avec un code unique, le statut "nouveau" est assigné, et une notification est envoyée au RSO. Cela démontre le workflow complet d'enregistrement d'urgence.

**Acceptance Scenarios**:

1. **Given** un agent de sûreté est connecté, **When** il accède à la page d'enregistrement d'incident, **Then** il voit un formulaire optimisé mobile avec les champs essentiels pré-remplis (installation selon son assignation, date/heure actuelle)
2. **Given** un agent de sûreté remplit le formulaire rapide, **When** il saisit toutes les informations obligatoires (type, zone, description courte, urgence) et soumet, **Then** l'incident est créé avec un code unique (format: INC-YYYY-CODE_INSTALLATION-XXX), le statut "nouveau" est assigné, et une notification est envoyée au RSO de l'installation
3. **Given** un agent de sûreté enregistre un incident, **When** il upload des photos ou vidéos (max 100 MB par fichier), **Then** les fichiers sont validés (formats JPG, PNG, MP4), uploadés avec succès, et associés à l'incident comme preuves
4. **Given** un agent de sûreté enregistre un incident critique, **When** il sélectionne le niveau d'urgence "critique", **Then** une notification email est envoyée immédiatement au RSO en plus de la notification dans l'application
5. **Given** un agent de sûreté enregistre un incident, **When** il sauvegarde un brouillon, **Then** l'incident est enregistré avec le statut "brouillon" et peut être complété plus tard
6. **Given** un agent de sûreté consulte un incident qu'il a créé, **When** il accède aux détails, **Then** il peut compléter les informations détaillées (description complète, témoins, suspects, impact) dans un formulaire étendu

---

### User Story 2 - RSO prend en charge et traite un incident (Priority: P1)

Un RSO (Responsable Sûreté de l'Organisation) doit pouvoir consulter les nouveaux incidents, évaluer leur gravité, les assigner à un responsable, définir la priorité, et suivre leur traitement jusqu'à la résolution.

**Why this priority**: Le RSO est le responsable principal de la gestion des incidents. Sans cette capacité de prise en charge et de traitement, les incidents restent en attente et les mesures correctives ne peuvent pas être mises en place. C'est le cœur du workflow de gestion des incidents.

**Independent Test**: Un RSO reçoit une notification pour un nouvel incident, accède aux détails, évalue la gravité, assigne l'incident à un responsable, change le statut à "en investigation", ajoute des mesures immédiates, et suit l'évolution jusqu'à la résolution. Cela valide le workflow complet de traitement.

**Acceptance Scenarios**:

1. **Given** un RSO est connecté, **When** un nouvel incident est créé dans son installation, **Then** il reçoit une notification dans l'application et un email si l'incident est critique, avec un lien direct vers l'incident
2. **Given** un RSO consulte un incident "nouveau", **When** il évalue la situation et assigne l'incident à un responsable, **Then** l'incident passe au statut "en investigation", le responsable assigné reçoit une notification, et l'action est enregistrée dans l'historique
3. **Given** un RSO traite un incident, **When** il définit la priorité (P1 à P4) et la catégorie (mineur, modéré, grave, critique), **Then** ces informations sont sauvegardées et utilisées pour le tri et les alertes
4. **Given** un RSO ajoute des mesures immédiates à un incident, **When** il saisit les mesures prises et sauvegarde, **Then** les mesures sont enregistrées, associées à l'incident, et visibles dans l'historique
5. **Given** un RSO suit un incident en cours, **When** il consulte la page de détails, **Then** il voit l'historique complet, les commentaires, les mesures prises, et peut ajouter des notes d'investigation
6. **Given** un RSO valide un incident résolu, **When** il consulte un incident avec le statut "résolu" et valide, **Then** l'incident passe au statut "clos", la date de clôture est enregistrée, et un rapport final peut être généré

---

### User Story 3 - Responsable assigné traite un incident (Priority: P1)

Un responsable assigné à un incident doit pouvoir consulter les détails, ajouter des informations d'investigation, définir et suivre les mesures correctives et préventives, et mettre à jour le statut de l'incident.

**Why this priority**: Les responsables assignés sont ceux qui effectuent le travail opérationnel de traitement des incidents. Sans cette capacité, les incidents ne peuvent pas progresser dans leur résolution. C'est essentiel pour le workflow de traitement.

**Independent Test**: Un responsable assigné reçoit une notification d'assignation, accède à l'incident, ajoute des commentaires d'investigation, crée des mesures correctives avec échéances et responsables, met à jour le statut des mesures, et change le statut de l'incident à "en traitement" puis "résolu". Cela valide le traitement opérationnel complet.

**Acceptance Scenarios**:

1. **Given** un responsable est assigné à un incident, **When** il reçoit la notification d'assignation, **Then** il peut accéder directement à l'incident depuis la notification et voit toutes les informations disponibles
2. **Given** un responsable traite un incident, **When** il ajoute des commentaires d'investigation, **Then** les commentaires sont enregistrés avec horodatage, associés à son compte, et visibles dans l'historique
3. **Given** un responsable définit des mesures correctives, **When** il crée une mesure avec description, responsable, et date d'échéance, **Then** la mesure est enregistrée, le responsable de la mesure reçoit une notification, et la mesure apparaît dans la liste des mesures de l'incident
4. **Given** un responsable suit les mesures d'un incident, **When** il met à jour le statut d'une mesure (planifiée, en cours, terminée), **Then** le statut est sauvegardé, l'historique est mis à jour, et les notifications appropriées sont envoyées
5. **Given** un responsable complète le traitement d'un incident, **When** il change le statut à "résolu" et ajoute un commentaire de résolution, **Then** l'incident passe au statut "résolu", la date de résolution est enregistrée, et le RSO est notifié pour validation
6. **Given** un responsable consulte un incident, **When** il ajoute des preuves supplémentaires (photos, documents), **Then** les fichiers sont uploadés, associés à l'incident, et marqués comme éléments de preuve si nécessaire

---

### User Story 4 - Administrateur consulte le dashboard des incidents (Priority: P2)

Un administrateur doit pouvoir consulter un tableau de bord complet des incidents avec des statistiques globales, des graphiques d'évolution, des alertes sur les incidents urgents, et des analyses par installation, type, et période.

**Why this priority**: Le dashboard permet une vue d'ensemble de la situation de sûreté et aide à identifier les tendances, les problèmes récurrents, et les installations nécessitant une attention particulière. C'est essentiel pour la prise de décision stratégique.

**Independent Test**: Un administrateur accède au dashboard des incidents, voit les statistiques globales (total, nouveaux, en cours, résolus), consulte les incidents critiques en cours, visualise les graphiques d'évolution mensuelle, et analyse la répartition par type d'incident. Il peut filtrer par installation et période. Cela valide la fonctionnalité complète du dashboard.

**Acceptance Scenarios**:

1. **Given** un administrateur accède au dashboard des incidents, **When** la page se charge, **Then** il voit les statistiques globales (total incidents, nouveaux, en cours, résolus) pour la période sélectionnée, avec des indicateurs visuels clairs
2. **Given** un administrateur consulte le dashboard, **When** il filtre par installation et période (année, mois), **Then** les statistiques et graphiques sont mis à jour pour refléter les données filtrées
3. **Given** un administrateur visualise les incidents critiques, **When** il consulte la section "Incidents urgents/critiques", **Then** il voit la liste des incidents avec niveau d'urgence critique ou élevé, avec leurs informations essentielles et liens directs
4. **Given** un administrateur analyse les tendances, **When** il consulte le graphique d'évolution mensuelle, **Then** il voit l'évolution du nombre d'incidents par mois avec distinction entre total, critiques, et résolus
5. **Given** un administrateur examine la répartition par type, **When** il consulte la section "Répartition par type", **Then** il voit un graphique ou tableau montrant le nombre et le pourcentage d'incidents par type (intrusion, vol, vandalisme, etc.)
6. **Given** un administrateur évalue les performances, **When** il consulte la section "Temps moyen de résolution", **Then** il voit les temps moyens de résolution par catégorie (critique, grave, modéré, mineur) avec indication si les objectifs sont atteints

---

### User Story 5 - Utilisateur consulte et recherche des incidents (Priority: P2)

Un utilisateur autorisé doit pouvoir consulter la liste des incidents avec filtres avancés, rechercher par mots-clés, visualiser en mode liste ou Kanban, et accéder aux détails complets d'un incident.

**Why this priority**: La consultation et la recherche sont essentielles pour retrouver des incidents spécifiques, analyser des patterns, et suivre l'évolution. C'est une fonctionnalité de base pour tous les utilisateurs travaillant avec les incidents.

**Independent Test**: Un utilisateur accède à la liste des incidents, applique des filtres (statut, type, urgence, installation, période), effectue une recherche par mots-clés, visualise les résultats en mode liste puis en mode Kanban, et ouvre les détails d'un incident. Cela valide les fonctionnalités de consultation et recherche complètes.

**Acceptance Scenarios**:

1. **Given** un utilisateur accède à la liste des incidents, **When** la page se charge, **Then** il voit la liste paginée des incidents avec leurs informations essentielles (code, type, titre, installation, date, statut, urgence)
2. **Given** un utilisateur filtre les incidents, **When** il sélectionne des filtres (statut, type, urgence, installation, période), **Then** la liste est mise à jour pour afficher uniquement les incidents correspondants aux critères
3. **Given** un utilisateur recherche des incidents, **When** il saisit des mots-clés dans le champ de recherche, **Then** le système recherche dans le titre, la description courte, et la description détaillée, et affiche les résultats correspondants
4. **Given** un utilisateur visualise en mode Kanban, **When** il bascule vers la vue Kanban, **Then** les incidents sont organisés par colonnes de statut (nouveau, en investigation, en traitement, résolu, clos), et il peut glisser-déposer pour changer le statut
5. **Given** un utilisateur consulte les détails d'un incident, **When** il clique sur un incident dans la liste, **Then** il accède à la page de détails complète avec toutes les informations, preuves, mesures, historique, et commentaires
6. **Given** un utilisateur exporte des incidents, **When** il sélectionne des incidents et choisit l'export Excel, **Then** un fichier Excel est généré avec les données des incidents sélectionnés

---

### User Story 6 - Système génère un rapport PDF d'incident (Priority: P2)

Le système doit pouvoir générer un rapport PDF professionnel et complet pour un incident, incluant toutes les informations, preuves, mesures, et historique, formaté selon les standards du code ISPS.

**Why this priority**: Les rapports PDF sont nécessaires pour la documentation officielle, les audits, la conformité ISPS, et l'archivage. C'est un livrable essentiel pour la traçabilité et la conformité réglementaire.

**Independent Test**: Un utilisateur accède à un incident résolu ou clos, clique sur "Générer rapport PDF", et reçoit un fichier PDF complet avec page de couverture, résumé exécutif, description détaillée, personnes impliquées, impact, preuves, mesures, chronologie, et conclusion. Le PDF est bien formaté et professionnel. Cela valide la génération complète de rapports.

**Acceptance Scenarios**:

1. **Given** un utilisateur consulte un incident, **When** il clique sur "Générer rapport PDF", **Then** le système génère un PDF professionnel avec toutes les informations de l'incident, et le téléchargement commence
2. **Given** un rapport PDF est généré, **When** le fichier est ouvert, **Then** il contient une page de couverture avec le code incident, le type, l'installation, et le niveau d'urgence mis en évidence
3. **Given** un rapport PDF est généré, **When** le contenu est consulté, **Then** il inclut toutes les sections : résumé exécutif, description détaillée, personnes impliquées (témoins, suspects, victimes), impact, preuves (images intégrées), mesures prises, chronologie complète, et conclusion
4. **Given** un rapport PDF contient des images, **When** les preuves sont incluses, **Then** les images sont correctement intégrées dans le PDF avec légendes et indication si elles sont des éléments de preuve
5. **Given** un rapport PDF est généré, **When** le format est vérifié, **Then** le PDF respecte les standards professionnels avec en-têtes, pieds de page, numérotation des pages, et mise en page cohérente
6. **Given** un rapport PDF est généré pour un incident clos, **When** la conclusion est consultée, **Then** elle indique la date de clôture et résume les mesures préventives mises en place

---

### User Story 7 - Système envoie des notifications automatiques (Priority: P2)

Le système doit envoyer automatiquement des notifications aux utilisateurs concernés lors de la création d'incidents, des changements de statut, des assignations, et des incidents en retard de traitement.

**Why this priority**: Les notifications garantissent que les responsables sont alertés immédiatement des nouveaux incidents et des changements importants. C'est critique pour la réactivité, surtout pour les incidents urgents où chaque minute compte.

**Independent Test**: Un agent crée un incident critique, le RSO reçoit immédiatement une notification dans l'application et un email. Le RSO assigne l'incident à un responsable, qui reçoit une notification. Un incident critique dépasse 6 heures sans traitement, le système envoie une alerte de retard. Cela valide le système de notifications complet.

**Acceptance Scenarios**:

1. **Given** un agent crée un nouvel incident, **When** l'incident est enregistré, **Then** tous les RSO de l'installation reçoivent une notification dans l'application, et si l'incident est critique, ils reçoivent également un email
2. **Given** un incident change de statut, **When** le statut est modifié (ex: "nouveau" → "en investigation"), **Then** le déclarant et le responsable assigné reçoivent une notification du changement
3. **Given** un incident est assigné à un responsable, **When** l'assignation est effectuée, **Then** le nouveau responsable reçoit une notification dans l'application et un email avec les détails de l'incident
4. **Given** un incident critique dépasse 6 heures sans traitement, **When** la tâche automatique s'exécute, **Then** le responsable assigné et les administrateurs reçoivent une alerte de retard
5. **Given** un incident grave dépasse 24 heures sans traitement, **When** la vérification s'exécute, **Then** les notifications de retard sont envoyées selon les seuils définis par niveau d'urgence
6. **Given** un utilisateur reçoit une notification, **When** il clique sur le lien dans la notification, **Then** il est redirigé directement vers la page de détails de l'incident concerné

---

### Edge Cases

- Que se passe-t-il si un agent tente d'enregistrer un incident sans connexion internet ? (brouillon local, synchronisation ultérieure)
- Comment le système gère-t-il les uploads de fichiers très volumineux (>100 MB) ? (validation avant upload, message d'erreur clair)
- Que se passe-t-il si plusieurs RSO sont assignés à la même installation ? (tous reçoivent les notifications)
- Comment le système gère-t-il les incidents créés avec des dates dans le futur ou très anciennes ? (validation des dates, avertissement si date > aujourd'hui ou < 2004)
- Que se passe-t-il si un incident est assigné à un utilisateur qui devient inactif ? (vérification du statut utilisateur, réassignation nécessaire)
- Comment le système gère-t-il la génération de PDF pour des incidents avec beaucoup de preuves (>50 images) ? (optimisation, pagination, ou génération asynchrone)
- Que se passe-t-il si un code d'incident est généré en double ? (vérification d'unicité, génération alternative)
- Comment le système gère-t-il les incidents créés pour une installation qui devient inactive ? (validation, avertissement, ou blocage selon les règles métier)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow agents de sûreté to create incidents with essential information (installation, type, date/time, zone, short description, urgency level)
- **FR-002**: System MUST generate unique incident codes in format INC-YYYY-CODE_INSTALLATION-XXX (e.g., INC-2024-PAD_COM-001)
- **FR-003**: System MUST support upload of evidence files (images, videos, documents) with validation (max 100 MB per file, formats: JPG, PNG, MP4, PDF)
- **FR-004**: System MUST automatically notify RSOs when a new incident is created in their installation
- **FR-005**: System MUST send email notifications for critical incidents in addition to in-app notifications
- **FR-006**: System MUST allow RSOs to assign incidents to responsible persons and change incident status
- **FR-007**: System MUST track incident status workflow: nouveau → en_investigation → en_traitement → resolu → clos → archive
- **FR-008**: System MUST allow users to add comments and investigation notes to incidents
- **FR-009**: System MUST support creation and tracking of measures (immediate, corrective, preventive) with responsible persons, due dates, and status
- **FR-010**: System MUST maintain complete history of all actions performed on an incident (creation, status changes, assignments, comments, measures)
- **FR-011**: System MUST provide a dashboard showing incident statistics (total, new, in progress, resolved) with filters by installation, period, and type
- **FR-012**: System MUST display critical/urgent incidents prominently with visual indicators
- **FR-013**: System MUST provide charts showing monthly evolution of incidents and distribution by type
- **FR-014**: System MUST calculate and display average resolution times by incident category
- **FR-015**: System MUST allow users to search incidents by keywords (searches in title, short description, detailed description)
- **FR-016**: System MUST provide advanced filtering (status, type, urgency, installation, date range, assigned person)
- **FR-017**: System MUST support both list view and Kanban view for incidents, with drag-and-drop status changes in Kanban view
- **FR-018**: System MUST generate professional PDF reports for incidents including all information, evidence, measures, and history
- **FR-019**: System MUST allow export of incident lists to Excel format
- **FR-020**: System MUST automatically detect and notify about delayed incidents based on urgency level thresholds (critical: 6h, high: 24h, moderate: 7 days, minor: 14 days)
- **FR-021**: System MUST classify incidents by type (intrusion, theft, vandalism, fire, accident, unauthorized access, document falsification, equipment failure, procedure violation, cyber incident, other)
- **FR-022**: System MUST classify incidents by category (minor, moderate, grave, critical) and urgency level (low, medium, high, critical)
- **FR-023**: System MUST allow recording of involved persons (witnesses, suspects, victims) with their contact information
- **FR-024**: System MUST allow recording of impact information (material, operational, human) with estimated costs
- **FR-025**: System MUST enforce access control: agents can only create and view incidents for their assigned installation, RSOs can manage incidents for their installations, administrators have full access
- **FR-026**: System MUST support draft saving for incidents, allowing agents to save incomplete incidents and complete them later
- **FR-027**: System MUST validate incident data (dates not in future, required fields, file formats and sizes)
- **FR-028**: System MUST maintain incident statistics in a cache table for performance (daily aggregation)
- **FR-029**: System MUST allow RSOs to validate resolved incidents before closure
- **FR-030**: System MUST support incident archiving for completed incidents older than 2 years after closure date (configurable by administrators)

### Key Entities

- **Incident**: Represents a security incident in a port facility. Key attributes: unique code, title, type, category, urgency level, installation, date/time, location, descriptions, status, priority, assigned person, declarant, impact information, measures, evidence files, and audit timestamps.

- **Incident Media**: Represents evidence files (photos, videos, documents) attached to an incident. Key attributes: file type, filename, file path, thumbnail path, file size, MIME type, description, evidence flag, upload order, and uploader information.

- **Incident History**: Represents a log entry for any action performed on an incident. Key attributes: action type (creation, modification, status change, assignment, media addition, comment, measure, validation, closure), old/new status, comment, modified data, user who performed the action, and timestamp.

- **Incident Comment**: Represents a comment or note added to an incident. Key attributes: comment text, comment type (general, investigation, measure, internal), visibility flag for security agents, author, and timestamps.

- **Incident Measure**: Represents a measure (immediate, corrective, or preventive) taken for an incident. Key attributes: measure type, description, responsible person, due date, status (planned, in progress, completed, cancelled), realization date, estimated/actual cost, effectiveness rating, and creator information.

- **Incident Statistics**: Represents aggregated statistics for incidents. Key attributes: date, installation (optional for global stats), total incidents, incidents by category, incidents by status, average resolution time, and total cost.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Agents can complete rapid incident registration (essential fields only) in under 2 minutes from any device (desktop or mobile)
- **SC-002**: System processes incident creation and sends notifications to RSOs within 5 seconds of submission
- **SC-003**: RSOs receive notifications for new incidents within 10 seconds of creation, with email delivery for critical incidents within 30 seconds
- **SC-004**: Dashboard loads and displays statistics for installations with up to 500 incidents in under 2 seconds
- **SC-005**: PDF report generation completes for incidents with up to 20 evidence files in under 10 seconds
- **SC-006**: Search functionality returns results for keyword queries in under 1 second, even with 1000+ incidents in the database
- **SC-007**: System successfully handles concurrent creation of 10 incidents by different agents without performance degradation
- **SC-008**: File uploads (photos/videos) complete successfully for files up to 100 MB within 30 seconds on standard broadband connection
- **SC-009**: 95% of incident registrations are completed successfully on first attempt without errors
- **SC-010**: System detects and notifies about delayed incidents within 1 hour of exceeding thresholds
- **SC-011**: Users can filter and view incidents by any combination of criteria (status, type, urgency, installation, date range) with results displayed in under 1 second
- **SC-012**: Kanban view supports drag-and-drop status changes with visual feedback and updates reflected immediately for all users viewing the same incident

## Assumptions

- Incident archiving period is set to 2 years after closure date by default, but can be configured by administrators to meet specific regulatory requirements
- File upload limits (100 MB per file) are appropriate for evidence files (photos, videos, documents) in port security contexts
- Incident codes follow format INC-YYYY-CODE_INSTALLATION-XXX where CODE_INSTALLATION is the installation code (e.g., PAD_COM) and XXX is a sequential number
- Critical incidents require immediate email notification in addition to in-app notifications for faster response times
- Delay thresholds for incident treatment are: critical (6 hours), high (24 hours), moderate (7 days), minor (14 days) based on urgency level
- All incident data must be retained for ISPS code compliance and audit purposes, even after archiving
- Evidence files (photos, videos) are stored securely and can be accessed by authorized users even after incident closure
- Incident statistics are aggregated daily for performance optimization, with real-time updates for critical metrics
- Kanban view is primarily used by RSOs and administrators for workflow management, while list view is used for detailed analysis
- PDF reports are generated on-demand and include all available information at the time of generation
- Incident workflow follows strict progression: nouveau → en_investigation → en_traitement → resolu → clos → archive (no skipping of statuses)
- Agents de sûreté can only create incidents for their assigned installation, ensuring data isolation and security
- Multiple RSOs can be assigned to the same installation, and all receive notifications for new incidents
- Incident measures (immediate, corrective, preventive) can have different responsible persons and are tracked independently
- Search functionality uses full-text search on title, short description, and detailed description fields for comprehensive results

## Dependencies

- **Phase 1 (Infrastructure et Authentification)**: Required for user management, role-based access control, authentication, and activity logging. The `rso_users` table and user roles must exist.
- **Phase 2 (Gestion des Installations)**: Required for installation management. The `rso_installations` table must exist to associate incidents with installations.
- **Database Schema**: Requires creation of new tables (`rso_incidents`, `rso_incidents_medias`, `rso_incidents_historique`, `rso_incidents_commentaires`, `rso_incidents_mesures`, `rso_incidents_stats`) with proper foreign keys and indexes.
- **File Storage System**: Required for storing evidence files (photos, videos, documents) with secure access control and thumbnail generation for images.
- **Email Service**: Required for sending email notifications for critical incidents and assignment notifications.
- **PDF Generation Library**: Required for generating professional PDF reports with images, tables, and formatted text.
- **Scheduled Task System**: Required for automatic detection of delayed incidents and daily statistics aggregation (cron jobs or equivalent).
- **Notification System**: Required for in-app notifications (may reuse existing notification infrastructure from previous phases).

## Out of Scope

- Real-time collaboration on incident editing (single-user editing model with history tracking)
- Incident templates or cloning functionality
- Bulk import of incidents from external files
- Integration with external security systems or port management systems
- Mobile native applications (web-based mobile interface only)
- Offline incident creation with sync (online-only with draft saving)
- Video streaming or playback within the application (download required for video evidence)
- Advanced analytics or predictive statistics beyond basic dashboard metrics
- Integration with external notification services (SMS, push notifications to mobile devices)
- Incident escalation workflows beyond basic assignment
- Custom incident types beyond the predefined list
- Multi-language support for incident reports (French only)
- Incident versioning beyond history tracking
- Automated incident classification using AI/ML
- Integration with Phase 3 activities management (incidents are independent entities)

