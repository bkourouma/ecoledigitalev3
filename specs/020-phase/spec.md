# Feature Specification: Phase 6 - Gestion Administrative & Documents

**Feature Branch**: `020-phase`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "Phase 6: Gestion Administrative & Documents - Module Imhotep Data"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Génération de Documents Administratifs (Priority: P1)

Les administrateurs doivent pouvoir générer automatiquement tous les documents administratifs nécessaires pour les formations professionnelles : conventions de formation, attestations de présence, attestations de réussite, et devis. Ces documents doivent être générés au format PDF professionnel avec numérotation unique, et doivent pouvoir être téléchargés, renvoyés par email, ou générés en masse pour une session complète.

**Why this priority**: La génération de documents est essentielle pour la conformité légale et administrative. Les conventions sont nécessaires avant le début des formations, les attestations après leur completion, et les devis pour les prospects. Sans cette fonctionnalité, l'administration doit créer manuellement ces documents, ce qui est chronophage et source d'erreurs.

**Independent Test**: Un administrateur peut accéder à l'interface de gestion des documents, générer une convention pour une inscription existante, télécharger le PDF généré, puis générer en masse des attestations de présence pour tous les participants présents d'une session terminée. Chaque document généré a un numéro unique et contient toutes les informations nécessaires (formation, dates, participant, formateurs, montants, etc.).

**Acceptance Scenarios**:

1. **Given** une inscription confirmée avec paiement validé, **When** l'administrateur génère une convention de formation, **Then** un PDF professionnel est créé avec numéro unique (format CONV-YYYY-NNNN), contenant toutes les informations de la formation, du participant, des modalités de paiement, et des obligations des parties, et le document est enregistré dans le système
2. **Given** une session terminée avec des participants présents, **When** l'administrateur génère des attestations de présence en masse, **Then** un PDF est généré pour chaque participant présent, chaque attestation contient le nom du participant, la formation suivie, les dates, la durée, les formateurs, et un numéro unique (format ATTP-YYYY-NNNN)
3. **Given** une session terminée avec un participant présent ayant réussi, **When** l'administrateur génère une attestation de réussite, **Then** un PDF est créé mentionnant la réussite, incluant éventuellement la note obtenue, avec numéro unique (format ATTR-YYYY-NNNN)
4. **Given** une session planifiée et des informations client, **When** l'administrateur génère un devis, **Then** un PDF professionnel est créé avec numéro unique (format DEV-YYYY-NNNN), contenant les détails de la formation, les prix HT/TTC, les conditions de règlement, une date de validité (par défaut 30 jours), et les modalités d'inscription
5. **Given** un document généré, **When** l'administrateur consulte la liste des documents, **Then** il peut filtrer par type, session, date, rechercher par numéro ou nom de participant, télécharger le document, le renvoyer par email, ou le supprimer
6. **Given** un devis généré, **When** la date de validité approche (3 jours avant expiration), **Then** un email de rappel est automatiquement envoyé au client concerné

---

### User Story 2 - Gestion des Entreprises Clientes B2B (Priority: P1)

Les administrateurs doivent pouvoir gérer un répertoire complet des entreprises clientes B2B, avec leurs informations de contact, leurs statistiques d'inscriptions, leur chiffre d'affaires, et la possibilité de créer des factures groupées pour plusieurs inscriptions d'une même entreprise.

**Why this priority**: La gestion B2B représente une part importante du business. Les entreprises clientes ont besoin de facturation groupée, de suivi de leurs multiples inscriptions, et d'un historique complet. Sans cette fonctionnalité, la gestion des clients B2B est dispersée et inefficace.

**Independent Test**: Un administrateur peut créer une nouvelle entreprise cliente avec ses informations (raison sociale, SIRET, adresse, contact), consulter la liste des entreprises avec filtres et tri, voir les détails d'une entreprise avec ses statistiques (nombre d'inscriptions, CA total, formations suivies), et générer une facture groupée pour plusieurs inscriptions de cette entreprise.

**Acceptance Scenarios**:

1. **Given** l'administrateur accède à la gestion des entreprises, **When** il crée une nouvelle entreprise avec raison sociale, SIRET, adresse, et contact principal, **Then** l'entreprise est enregistrée avec validation du SIRET (unicité par tenant), et apparaît dans la liste des entreprises
2. **Given** une entreprise existante, **When** l'administrateur consulte ses détails, **Then** il voit les informations de l'entreprise, le nombre total d'inscriptions, le nombre d'apprenants différents, le CA total généré, la liste des formations suivies, et l'historique complet des inscriptions et factures
3. **Given** une entreprise avec plusieurs inscriptions confirmées non facturées, **When** l'administrateur sélectionne plusieurs inscriptions et génère une facture groupée, **Then** un PDF de facture unique est créé listant toutes les inscriptions sélectionnées avec leurs montants, un total HT/TTC, et un numéro de facture unique (format FACTG-YYYY-NNNN)
4. **Given** une liste d'entreprises, **When** l'administrateur applique des filtres (secteur d'activité, statut actif/inactif) et un tri (par nombre d'inscriptions ou CA total), **Then** la liste est filtrée et triée selon les critères, avec pagination
5. **Given** une entreprise avec des inscriptions en cours, **When** l'administrateur tente de supprimer l'entreprise, **Then** l'opération est refusée avec un message indiquant qu'il faut d'abord annuler ou terminer les inscriptions en cours
6. **Given** la liste des entreprises, **When** l'administrateur exporte en Excel, **Then** un fichier Excel est généré contenant toutes les entreprises avec leurs informations principales et statistiques

---

### User Story 3 - Exports de Données Personnalisables (Priority: P2)

Les administrateurs doivent pouvoir exporter les données du système (inscriptions, paiements, présences) dans différents formats (Excel, CSV) avec des filtres personnalisables, des sélections de colonnes, et des options de groupement pour l'analyse.

**Why this priority**: Les exports sont essentiels pour l'analyse de données, la comptabilité, et les rapports externes. Permettre des exports personnalisables réduit le besoin de manipulation manuelle des données et améliore l'efficacité administrative.

**Independent Test**: Un administrateur peut exporter la liste des inscriptions avec filtres par date, formation, statut, sélectionner les colonnes à inclure, choisir le format (Excel ou CSV), et télécharger le fichier généré. Il peut également exporter les paiements avec groupement par méthode de paiement ou par jour, et exporter les feuilles de présence pour une session.

**Acceptance Scenarios**:

1. **Given** l'administrateur accède aux outils d'export, **When** il configure un export d'inscriptions avec filtres (date début, date fin, formation, statut), sélectionne les colonnes à inclure (nom, email, formation, montant, etc.), et choisit le format Excel, **Then** un fichier Excel est généré avec les données filtrées, les colonnes sélectionnées, des en-têtes formatés, et des filtres automatiques sur les colonnes
2. **Given** l'administrateur exporte les paiements, **When** il choisit de grouper par méthode de paiement, **Then** le fichier Excel contient une feuille principale avec tous les paiements détaillés, et une feuille supplémentaire avec le regroupement par méthode montrant le nombre et le total par méthode
3. **Given** une session avec des présences enregistrées, **When** l'administrateur exporte les feuilles de présence, **Then** un fichier Excel est généré avec la liste des participants, leurs statuts de présence, et des statistiques (nombre présents, absents, taux de présence)
4. **Given** l'administrateur exporte le CA par formation pour une année, **When** il choisit le format Excel avec graphiques, **Then** un fichier Excel est généré avec un tableau par formation (nombre d'inscriptions, CA HT, CA TTC, pourcentage du total), et une feuille avec des graphiques visuels (camembert, barres)
5. **Given** l'administrateur configure un export personnalisé avec query builder, **When** il sélectionne plusieurs tables (inscriptions, sessions, formations), définit des colonnes, des filtres, et des groupements, **Then** un fichier est généré avec les données agrégées selon la configuration

---

### User Story 4 - Dashboard et Reporting (Priority: P2)

Les administrateurs doivent avoir accès à un dashboard de reporting avec des métriques clés (inscriptions, CA, taux de remplissage), des graphiques d'évolution, des statistiques détaillées, et des calculs de CA prévisionnel pour la planification.

**Why this priority**: Le reporting permet de suivre les performances, d'identifier les tendances, et de prendre des décisions éclairées. Le CA prévisionnel est crucial pour la planification financière et la gestion de trésorerie.

**Independent Test**: Un administrateur accède au dashboard de reporting, voit les métriques principales pour la période sélectionnée (jour, semaine, mois, année) avec évolution par rapport à la période précédente, consulte les graphiques de CA par formation et par mois, voit les top formations et entreprises, et consulte le CA prévisionnel pour l'année avec répartition par mois et par formation.

**Acceptance Scenarios**:

1. **Given** l'administrateur accède au dashboard de reporting, **When** il sélectionne une période (mois, année), **Then** il voit les métriques principales : nombre d'inscriptions avec évolution en pourcentage, CA total avec évolution, nombre de sessions avec taux de remplissage moyen, et les top 5 formations et entreprises par nombre d'inscriptions ou CA
2. **Given** l'administrateur consulte le CA prévisionnel, **When** il sélectionne une année et optionnellement un trimestre, **Then** il voit le CA réalisé (sessions passées payées), le CA prévisionnel (sessions futures avec inscriptions confirmées payées), le CA potentiel (inscriptions en attente), le CA total estimé, et des tableaux par mois et par formation
3. **Given** l'administrateur consulte les statistiques de taux de conversion, **When** il accède à cette section, **Then** il voit le taux de conversion global (inscriptions → paiements), le taux par formation, le taux par méthode de paiement, et l'évolution mensuelle sur 12 mois
4. **Given** l'administrateur consulte les statistiques détaillées, **When** il sélectionne un type (inscriptions, formations, formateurs, entreprises) et une période, **Then** il voit des données agrégées pertinentes selon le type : pour inscriptions (répartition par statut, évolution temporelle), pour formations (nombre de sessions, taux de remplissage), pour formateurs (nombre de sessions animées), pour entreprises (nombre d'inscriptions, CA généré)

---

### Edge Cases

- Que se passe-t-il si un document est généré deux fois pour la même inscription ? Le système doit détecter l'existence d'un document précédent et proposer de le réutiliser ou de le régénérer
- Comment le système gère-t-il les erreurs de génération PDF (espace disque insuffisant, problème de template) ? Des messages d'erreur clairs doivent être affichés et les erreurs doivent être journalisées
- Que se passe-t-il si une session est annulée après génération de devis ? Les devis restent valides mais peuvent être marqués comme obsolètes
- Comment gérer la génération en masse si une session a 100+ participants ? La génération doit être asynchrone avec une barre de progression et notification de completion
- Que se passe-t-il si un SIRET d'entreprise est invalide ou dupliqué ? Le système doit valider le format et vérifier l'unicité par tenant avant enregistrement
- Comment gérer les exports de très grandes quantités de données (10,000+ inscriptions) ? Les exports doivent être asynchrones avec notification de completion et lien de téléchargement
- Que se passe-t-il si un document est supprimé alors qu'il est référencé dans une facture ou un email ? Le système doit empêcher la suppression ou marquer comme archivé
- Comment gérer les devis expirés ? Le système doit permettre de les régénérer avec une nouvelle date de validité

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST generate professional PDF documents for conventions de formation, attestations de présence, attestations de réussite, and devis with unique sequential numbering per document type
- **FR-002**: System MUST automatically generate convention documents when an enrollment payment is confirmed
- **FR-003**: System MUST allow administrators to generate documents individually or in batch for all eligible participants of a completed session
- **FR-004**: System MUST store all generated documents with metadata (type, number, generation date, related enrollment/session, file path)
- **FR-005**: System MUST allow administrators to download, email, or delete generated documents
- **FR-006**: System MUST send automatic email reminders for quotes expiring within 3 days
- **FR-007**: System MUST allow administrators to create, view, update, and delete enterprise client records with validation of SIRET uniqueness per tenant
- **FR-008**: System MUST display enterprise statistics including total enrollments, unique participants, total revenue, and list of completed trainings
- **FR-009**: System MUST allow administrators to generate grouped invoices for multiple enrollments from the same enterprise
- **FR-010**: System MUST allow administrators to export enrollment data with customizable filters (date range, training, status, session), column selection, and format choice (Excel, CSV)
- **FR-011**: System MUST allow administrators to export payment data with optional grouping by payment method, day, or training
- **FR-012**: System MUST allow administrators to export attendance sheets for sessions with participant presence status and statistics
- **FR-013**: System MUST allow administrators to export revenue by training with charts and visualizations
- **FR-014**: System MUST provide a reporting dashboard with key metrics (enrollments, revenue, session fill rate) for selectable time periods (day, week, month, year) with comparison to previous period
- **FR-015**: System MUST calculate and display forecasted revenue (realized, forecasted, potential) with breakdown by month and by training
- **FR-016**: System MUST calculate and display conversion rates (enrollment to payment) globally, by training, by payment method, and monthly trends
- **FR-017**: System MUST provide detailed statistics for enrollments, trainings, trainers, and enterprises with filtering by date range
- **FR-018**: System MUST prevent deletion of enterprises with active enrollments
- **FR-019**: System MUST validate that attestations can only be generated for completed sessions with present participants
- **FR-020**: System MUST ensure document numbers are unique and sequential per type and year (format: PREFIX-YYYY-NNNN)

### Key Entities *(include if feature involves data)*

- **Document**: Represents a generated administrative document (convention, attestation, quote, invoice). Key attributes: type, unique number, generation date, related enrollment/session, file path, metadata (client info for quotes, note for success certificates). Relationships: belongs to enrollment (optional), belongs to session (optional), belongs to enterprise (optional for grouped invoices)
- **Entreprise Cliente**: Represents a B2B client company. Key attributes: business name, SIRET (unique per tenant), legal form, address, contact person information, business sector, employee count, active status, notes. Relationships: has many enrollments, has many grouped invoices
- **Export Configuration**: Represents a saved export configuration. Key attributes: export type (enrollments, payments, attendance, revenue), filters applied, columns selected, format choice, grouping options. Used to generate export files on demand
- **Reporting Metrics**: Aggregated data for reporting. Key attributes: time period, enrollment counts and trends, revenue totals and trends, session statistics, top trainings, top enterprises, conversion rates. Calculated on-demand from underlying data

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can generate a convention document in under 5 seconds from enrollment selection to PDF download
- **SC-002**: Batch generation of 50 attestations completes in under 2 minutes with progress indication
- **SC-003**: Document list page loads and displays filtered results in under 2 seconds for up to 1,000 documents
- **SC-004**: Enterprise client creation form validates and saves in under 1 second with immediate feedback on SIRET conflicts
- **SC-005**: Enterprise detail page displays complete information and statistics in under 1 second
- **SC-006**: Grouped invoice generation for 10 enrollments completes in under 10 seconds
- **SC-007**: Excel export of 5,000 enrollments with selected columns generates and downloads in under 30 seconds
- **SC-008**: Payment export with grouping generates files with accurate totals and grouping in under 20 seconds for 1,000 payments
- **SC-009**: Reporting dashboard loads all metrics and charts in under 3 seconds for any selected time period
- **SC-010**: CA prévisionnel calculation completes in under 5 seconds for a full year of data
- **SC-011**: 95% of document generation operations complete successfully without errors
- **SC-012**: All generated PDFs are properly formatted, readable, and contain all required legal and administrative information
- **SC-013**: Export files are correctly formatted and openable in standard spreadsheet applications (Excel, Google Sheets) without data corruption
- **SC-014**: Email reminders for expiring quotes are sent automatically within 1 hour of the scheduled time
- **SC-015**: System supports generation of up to 200 documents per hour without performance degradation

## Assumptions

- PDF generation libraries (Puppeteer or PDFKit) are already available in the codebase from previous phases
- Excel generation library (ExcelJS) is already available from previous phases
- Email service infrastructure exists for sending document notifications and reminders
- File storage system exists for storing generated PDF documents
- Database schema for enrollments, sessions, and enterprises already exists from previous phases
- Document storage directory structure can be created and managed (conventions/, attestations/, devis/, factures/)
- Automatic generation of conventions after payment confirmation can be integrated with existing payment webhook system
- Document numbering uniqueness is enforced at the application level (no database-level constraint needed)
- Ivorian legal requirements for training documents are met by the document templates (conventions, attestations)
- SIRET validation follows standard French/Ivorian business registration format
- Time zone handling uses the application's default time zone for all date calculations

## Dependencies

- **Phase 4 (Inscriptions & Paiements)**: Required for enrollment data, payment information, and automatic convention generation after payment
- **Phase 5 (Sessions Management)**: Required for session information, trainer assignments, and session completion status for attestation generation
- **Email Service**: Required for sending document notifications and quote expiration reminders
- **File Storage Service**: Required for storing and serving generated PDF documents
- **Database Schema**: Requires existing tables: inscriptions_professionnelles, sessions_professionnelles, entreprises_clientes, paiements_professionnels

## Out of Scope

- Electronic signature integration for documents (documents are generated but signatures are manual/offline)
- Document versioning and revision history (only latest version is kept)
- Custom document templates editor (templates are predefined)
- Integration with external accounting software (exports are manual)
- Automated tax reporting or compliance document generation beyond basic attestations
- Document workflow approval processes (generation is immediate upon request)
- Multi-language document generation (documents are in French only)
- Document archiving and retention policies (all documents are kept indefinitely unless manually deleted)
- Real-time collaboration on document editing (documents are generated, not edited)
