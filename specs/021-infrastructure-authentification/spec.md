# Feature Specification: Phase 1 - Infrastructure et Authentification RSO-PFSO

**Feature Branch**: `021-phase`  
**Created**: 2024-12-19  
**Status**: Draft  
**Input**: User description: "Phase 1 Infrastructure Authentification RSO-PFSO"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Administrateur crée et gère les comptes utilisateurs (Priority: P1)

Un administrateur doit pouvoir créer et gérer manuellement tous les types de comptes utilisateurs (Formateurs RSO, Agents PFSO, Agents de Sûreté) pour permettre la mise en place initiale de la plateforme et la gestion continue des accès.

**Why this priority**: Sans cette capacité, aucun utilisateur ne peut accéder à la plateforme. C'est la fonctionnalité fondamentale qui permet l'initialisation et la maintenance du système.

**Independent Test**: Un administrateur peut créer un compte formateur RSO, puis se connecter avec ce compte et accéder au dashboard formateur. Cela démontre que le système d'authentification et de gestion des rôles fonctionne de bout en bout.

**Acceptance Scenarios**:

1. **Given** un administrateur est connecté, **When** il crée un compte formateur RSO avec des informations valides, **Then** le compte est créé avec succès et l'administrateur voit une confirmation
2. **Given** un administrateur est connecté, **When** il tente de créer un compte avec un email déjà utilisé, **Then** le système affiche une erreur claire indiquant que l'email existe déjà
3. **Given** un administrateur est connecté, **When** il modifie le statut d'un utilisateur de "actif" à "inactif", **Then** cet utilisateur ne peut plus se connecter
4. **Given** un administrateur est connecté, **When** il consulte la liste des utilisateurs, **Then** il voit tous les utilisateurs avec leurs informations (nom, email, rôle, statut, dernière connexion)
5. **Given** un administrateur est connecté, **When** il supprime un utilisateur, **Then** le système demande confirmation et l'utilisateur est supprimé de manière sécurisée

---

### User Story 2 - Utilisateur se connecte avec authentification sécurisée (Priority: P1)

Un utilisateur (quel que soit son rôle) doit pouvoir se connecter à la plateforme de manière sécurisée en utilisant son nom d'utilisateur ou email et son mot de passe, avec protection contre les attaques et gestion de session appropriée.

**Why this priority**: L'authentification est la porte d'entrée de toute la plateforme. Sans elle, aucun utilisateur ne peut accéder aux fonctionnalités. La sécurité est critique pour une plateforme de sûreté portuaire.

**Independent Test**: Un utilisateur peut se connecter avec ses identifiants, accéder à son dashboard selon son rôle, et être automatiquement déconnecté après expiration de session. Cela valide le système d'authentification complet.

**Acceptance Scenarios**:

1. **Given** un utilisateur a un compte actif, **When** il saisit correctement son nom d'utilisateur/email et mot de passe, **Then** il est connecté et redirigé vers son dashboard selon son rôle
2. **Given** un utilisateur tente de se connecter, **When** il saisit des identifiants incorrects 3 fois, **Then** un captcha apparaît pour la prochaine tentative
3. **Given** un utilisateur tente de se connecter, **When** il échoue 5 fois en 15 minutes, **Then** son adresse IP est temporairement bloquée pendant 15 minutes
4. **Given** un utilisateur est connecté, **When** sa session expire après 8 heures (ou 30 jours si "se souvenir de moi"), **Then** il est automatiquement déconnecté et doit se reconnecter
5. **Given** un utilisateur coche "Se souvenir de moi" lors de la connexion, **When** il ferme et rouvre son navigateur, **Then** il reste connecté pendant 30 jours

---

### User Story 3 - Utilisateur réinitialise son mot de passe oublié (Priority: P2)

Un utilisateur qui a oublié son mot de passe doit pouvoir le réinitialiser de manière sécurisée via un lien envoyé par email, sans compromettre la sécurité du compte.

**Why this priority**: C'est une fonctionnalité essentielle pour réduire le support technique et permettre aux utilisateurs de récupérer l'accès à leur compte de manière autonome. Cependant, elle peut être implémentée après l'authentification de base.

**Independent Test**: Un utilisateur peut demander une réinitialisation de mot de passe, recevoir un email avec un lien, et définir un nouveau mot de passe conforme aux règles de sécurité. Cela valide le processus complet de récupération.

**Acceptance Scenarios**:

1. **Given** un utilisateur a oublié son mot de passe, **When** il saisit son email sur la page "Mot de passe oublié", **Then** il reçoit un email avec un lien de réinitialisation valide 1 heure
2. **Given** un utilisateur a reçu un lien de réinitialisation, **When** il clique sur le lien (valide), **Then** il accède à un formulaire pour définir un nouveau mot de passe
3. **Given** un utilisateur définit un nouveau mot de passe, **When** le mot de passe ne respecte pas les règles (min 8 caractères, majuscule, minuscule, chiffre, caractère spécial), **Then** le système affiche des messages d'erreur clairs
4. **Given** un utilisateur définit un nouveau mot de passe valide, **When** il soumet le formulaire, **Then** son mot de passe est mis à jour et il peut se connecter avec le nouveau mot de passe
5. **Given** un utilisateur utilise un lien de réinitialisation, **When** le lien a expiré (après 1 heure), **Then** le système affiche un message d'erreur et demande une nouvelle demande

---

### User Story 4 - Formateur RSO crée des agents PFSO (Priority: P2)

Un formateur RSO doit pouvoir créer manuellement des comptes pour les agents PFSO et les associer à une installation portuaire spécifique, permettant la délégation de la gestion des agents opérationnels.

**Why this priority**: Cette fonctionnalité permet aux formateurs RSO de gérer leurs équipes d'agents PFSO sans dépendre de l'administrateur. C'est une délégation importante qui améliore l'efficacité opérationnelle.

**Independent Test**: Un formateur RSO peut créer un compte agent PFSO, l'associer à une installation, et l'agent peut ensuite se connecter et voir uniquement les activités de son installation. Cela valide la délégation et les restrictions d'accès.

**Acceptance Scenarios**:

1. **Given** un formateur RSO est connecté, **When** il crée un compte agent PFSO avec une installation assignée, **Then** le compte est créé et l'agent peut se connecter
2. **Given** un formateur RSO crée un agent PFSO, **When** il omet d'assigner une installation, **Then** le système affiche une erreur car l'installation est obligatoire
3. **Given** un agent PFSO est créé et assigné à une installation, **When** il se connecte et consulte les activités, **Then** il voit uniquement les activités de son installation assignée
4. **Given** un formateur RSO consulte la liste des agents PFSO, **When** il filtre par installation, **Then** il voit uniquement les agents de l'installation sélectionnée

---

### User Story 5 - Agent PFSO consulte les activités en lecture seule (Priority: P2)

Un agent PFSO doit pouvoir consulter les activités RSO qui lui sont autorisées, filtrées par année et type d'activité, avec possibilité de télécharger et imprimer les rapports, mais sans pouvoir modifier ou créer quoi que ce soit.

**Why this priority**: C'est la fonctionnalité principale pour les agents PFSO qui doivent consulter les activités de sûreté portuaire. Cependant, elle dépend de la Phase 3 (Gestion des activités), donc peut être préparée mais pas complètement testée sans les données d'activités.

**Independent Test**: Un agent PFSO peut se connecter, sélectionner une année et un type d'activité, voir la liste des activités correspondantes, et télécharger un rapport. Cela valide l'accès en lecture seule et les restrictions.

**Acceptance Scenarios**:

1. **Given** un agent PFSO est connecté, **When** il sélectionne une année et un type d'activité, **Then** il voit la liste des activités correspondantes de son installation
2. **Given** un agent PFSO consulte une activité, **When** il tente de modifier ou supprimer, **Then** aucun bouton d'édition n'est visible (interface en lecture seule)
3. **Given** un agent PFSO consulte une activité, **When** il clique sur "Télécharger", **Then** un fichier PDF du rapport est téléchargé
4. **Given** un agent PFSO consulte une activité, **When** il clique sur "Imprimer", **Then** une version imprimable s'affiche
5. **Given** un agent PFSO recherche des activités, **When** aucune activité ne correspond aux critères, **Then** un message clair indique qu'aucune activité n'a été trouvée

---

### User Story 6 - Système enregistre toutes les activités de sécurité (Priority: P2)

Le système doit enregistrer automatiquement toutes les actions importantes des utilisateurs (connexions, modifications, créations, suppressions) pour assurer la traçabilité requise par le code ISPS et permettre l'audit de sécurité.

**Why this priority**: La traçabilité est une exigence réglementaire du code ISPS pour la sûreté portuaire. Sans logs complets, la plateforme ne peut pas être utilisée en production. Cependant, elle peut être implémentée progressivement.

**Independent Test**: Un administrateur effectue diverses actions (création utilisateur, modification, connexion), puis consulte l'historique des activités et voit toutes ces actions enregistrées avec les détails (utilisateur, action, date, IP). Cela valide le système de logging complet.

**Acceptance Scenarios**:

1. **Given** un utilisateur se connecte, **When** l'authentification réussit, **Then** une entrée est créée dans les logs avec l'utilisateur, l'heure, l'adresse IP et le user agent
2. **Given** un administrateur crée un utilisateur, **When** l'opération réussit, **Then** une entrée est créée dans les logs avec l'action "create_user", l'ID de l'utilisateur créé, et tous les détails
3. **Given** un administrateur consulte l'historique des activités, **When** il filtre par utilisateur et date, **Then** il voit uniquement les activités correspondantes
4. **Given** un administrateur consulte l'historique, **When** il exporte en CSV, **Then** un fichier CSV est généré avec toutes les données filtrées
5. **Given** un utilisateur tente d'accéder à une page sans permission, **When** l'accès est refusé, **Then** une entrée est créée dans les logs avec l'action "unauthorized_access"

---

### User Story 7 - Utilisateur change son mot de passe (Priority: P3)

Un utilisateur connecté doit pouvoir changer son mot de passe depuis son profil, avec validation de l'ancien mot de passe et déconnexion de toutes les autres sessions pour sécurité.

**Why this priority**: C'est une fonctionnalité de sécurité importante mais moins critique que la réinitialisation de mot de passe. Les utilisateurs peuvent demander une réinitialisation si nécessaire. Elle peut être implémentée après les fonctionnalités principales.

**Independent Test**: Un utilisateur connecté peut accéder à son profil, changer son mot de passe en validant l'ancien, et toutes ses autres sessions sont automatiquement fermées. Cela valide le changement sécurisé de mot de passe.

**Acceptance Scenarios**:

1. **Given** un utilisateur est connecté, **When** il accède à son profil et change son mot de passe, **Then** il doit d'abord saisir son ancien mot de passe pour validation
2. **Given** un utilisateur change son mot de passe, **When** l'ancien mot de passe est incorrect, **Then** le système affiche une erreur sans révéler si c'est l'ancien ou le nouveau qui pose problème
3. **Given** un utilisateur change son mot de passe avec succès, **When** il a d'autres sessions actives, **Then** toutes les autres sessions sont automatiquement fermées
4. **Given** un utilisateur change son mot de passe, **When** le nouveau mot de passe ne respecte pas les règles, **Then** le système affiche des messages d'erreur clairs

---

### Edge Cases

- Que se passe-t-il lorsqu'un utilisateur tente de se connecter avec un compte suspendu ou inactif ?
- Comment le système gère-t-il les tentatives de connexion depuis plusieurs adresses IP différentes pour le même compte ?
- Que se passe-t-il si un utilisateur demande une réinitialisation de mot de passe mais n'a pas accès à son email ?
- Comment le système gère-t-il l'expiration d'un token de réinitialisation pendant que l'utilisateur remplit le formulaire ?
- Que se passe-t-il si un administrateur supprime un utilisateur qui a des sessions actives ?
- Comment le système gère-t-il les caractères spéciaux dans les noms d'utilisateurs et emails (accents, caractères internationaux) ?
- Que se passe-t-il si un formateur RSO tente de créer un agent PFSO avec une installation qui n'existe pas encore ?
- Comment le système gère-t-il les changements de rôle d'un utilisateur (par exemple, promouvoir un agent PFSO en formateur RSO) ?
- Que se passe-t-il si un agent PFSO est réassigné à une autre installation - doit-il perdre l'accès aux anciennes activités ?
- Comment le système gère-t-il les logs si la base de données est temporairement indisponible ?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support four distinct user roles: Administrateur, RSO Formateur, Agent PFSO, and Agent Sûreté, each with specific access permissions
- **FR-002**: System MUST allow users to authenticate using either username or email address as login identifier
- **FR-003**: System MUST enforce password complexity requirements: minimum 8 characters, at least one uppercase letter, one lowercase letter, one digit, and one special character
- **FR-004**: System MUST hash all passwords using industry-standard hashing algorithm before storage
- **FR-005**: System MUST implement session management with configurable duration (default 8 hours, extendable to 30 days with "remember me" option)
- **FR-006**: System MUST automatically log out users when their session expires
- **FR-007**: System MUST protect login endpoint against brute force attacks by limiting failed attempts (5 attempts per IP in 15 minutes)
- **FR-008**: System MUST display CAPTCHA after 3 failed login attempts from the same IP address
- **FR-009**: System MUST temporarily block IP addresses after 5 failed login attempts for 15 minutes
- **FR-010**: System MUST allow administrators to create, modify, activate, deactivate, and delete user accounts for all roles
- **FR-011**: System MUST allow RSO Formateurs to create Agent PFSO accounts and assign them to a specific port facility installation
- **FR-012**: System MUST require that Agent PFSO accounts be assigned to exactly one port facility installation at creation
- **FR-013**: System MUST restrict Agent PFSO access to read-only operations on activities related to their assigned installation
- **FR-014**: System MUST provide password reset functionality via email with time-limited reset tokens (valid for 1 hour)
- **FR-015**: System MUST invalidate password reset tokens after successful use or expiration
- **FR-016**: System MUST allow authenticated users to change their password from their profile, requiring validation of current password
- **FR-017**: System MUST automatically terminate all active sessions when a user changes their password
- **FR-018**: System MUST redirect users to role-specific dashboards after successful login (Administrator dashboard, Formateur dashboard, PFSO consultation page)
- **FR-019**: System MUST log all authentication events (successful logins, failed attempts, logouts) with user ID, timestamp, IP address, and user agent
- **FR-020**: System MUST log all user management actions (create, update, delete, activate, deactivate) with details of who performed the action and what was changed
- **FR-021**: System MUST log all unauthorized access attempts with full context (user, requested resource, timestamp, IP)
- **FR-022**: System MUST provide administrators with a searchable and filterable activity log interface
- **FR-023**: System MUST allow administrators to export activity logs in CSV/Excel format
- **FR-024**: System MUST display user status (actif, inactif, suspendu) and prevent inactive or suspended users from logging in
- **FR-025**: System MUST track and display last login timestamp for each user
- **FR-026**: System MUST validate email uniqueness across all users during account creation and updates
- **FR-027**: System MUST validate username uniqueness across all users during account creation and updates
- **FR-028**: System MUST provide real-time validation feedback during user account creation (checking username/email availability)
- **FR-029**: System MUST require confirmation before deleting user accounts
- **FR-030**: System MUST sanitize and validate all user inputs to prevent injection attacks (XSS, SQL injection)
- **FR-031**: System MUST implement secure token-based authentication mechanism for API requests
- **FR-032**: System MUST automatically refresh authentication tokens 30 minutes before expiration when user is active
- **FR-033**: System MUST support "remember me" functionality that extends session duration to 30 days
- **FR-034**: System MUST display appropriate error messages for authentication failures without revealing whether username/email or password is incorrect
- **FR-035**: System MUST send welcome email to newly created users with their account credentials
- **FR-036**: System MUST send password reset emails with secure, time-limited reset links
- **FR-037**: System MUST provide Formateur RSO dashboard with year selector (2004 to current year) and navigation menu
- **FR-038**: System MUST store selected year in user session for Formateur RSO workflow
- **FR-039**: System MUST provide Agent PFSO consultation interface with mandatory filters (year, installation pre-filled, activity type)
- **FR-040**: System MUST restrict Agent PFSO to view only activities from their assigned installation
- **FR-041**: System MUST provide download and print functionality for activity reports (read-only access for Agent PFSO)
- **FR-042**: System MUST display administrator dashboard with statistics cards (total users, active formateurs, active PFSO agents, active security agents)
- **FR-043**: System MUST display recent activity table on administrator dashboard (last 10 logins with user name, role, date/time, IP)
- **FR-044**: System MUST provide quick action buttons on administrator dashboard (create user, view all logs, manage permissions)
- **FR-045**: System MUST implement role-based access control that enforces permissions at both route and function level
- **FR-046**: System MUST prevent users from accessing routes or functions outside their role permissions
- **FR-047**: System MUST provide user management interface with pagination (20 users per page) and search functionality
- **FR-048**: System MUST allow filtering user lists by role and status
- **FR-049**: System MUST display comprehensive user information in management tables (username, full name, email, phone, status, last login, actions)
- **FR-050**: System MUST record the creator (created_by) for each user account to track account creation chain

### Key Entities *(include if feature involves data)*

- **User Account**: Represents a user in the RSO-PFSO system with authentication credentials, personal information (name, email, phone), role assignment, status (active/inactive/suspended), optional installation assignment for PFSO agents, and audit trail information (created by, timestamps, last login)

- **User Session**: Represents an active authentication session with token, user association, connection metadata (IP address, user agent), login timestamp, expiration time, and status (active/expired/logged out)

- **Activity Log**: Represents a security audit record capturing user actions (login, logout, create, update, delete), entity information (type and ID if applicable), description, connection metadata (IP, user agent), and timestamp for compliance and security monitoring

- **Permission**: Represents role-based access control rules defining what actions (create, read, update, delete) each role can perform on specific modules (activities management, incidents management, etc.)

- **Port Facility Installation**: Represents a port facility location that can be assigned to PFSO agents, restricting their access scope to activities related to that specific installation (Abidjan, San-Pedro, etc.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully authenticate and access their role-specific dashboard within 3 seconds of submitting valid credentials
- **SC-002**: 95% of users can complete account creation process (by administrator) in under 2 minutes without errors
- **SC-003**: System prevents 100% of brute force attacks through rate limiting and IP blocking mechanisms
- **SC-004**: 90% of password reset requests result in successful password change within 15 minutes of email delivery
- **SC-005**: System logs 100% of critical security events (logins, user management actions, unauthorized access attempts) with complete context
- **SC-006**: Administrators can search and filter activity logs to find specific events within 5 seconds
- **SC-007**: Users experience zero unauthorized access to resources outside their role permissions
- **SC-008**: System maintains 99.9% uptime for authentication services during business hours
- **SC-009**: Password reset emails are delivered within 2 minutes of request submission
- **SC-010**: All user account operations (create, update, delete) complete successfully with proper validation in under 5 seconds
- **SC-011**: Agent PFSO users can access and view activities from their assigned installation without seeing activities from other installations
- **SC-012**: Formateur RSO users can create Agent PFSO accounts and assign installations with 100% success rate when valid data is provided
- **SC-013**: System enforces password complexity rules and rejects non-compliant passwords with clear error messages in 100% of cases
- **SC-014**: Session expiration and automatic logout function correctly for 100% of expired sessions
- **SC-015**: Activity log export functionality generates complete CSV/Excel files with all filtered data within 10 seconds for logs containing up to 10,000 entries
