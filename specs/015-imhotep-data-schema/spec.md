# Feature Specification: Imhotep Data Database Schema

**Feature Branch**: `015-imhotep-data-schema`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "Imhotep Data Database Schema: Créer le schéma de base de données complet pour le module Imhotep Data (formations professionnelles) avec nouvelles tables sans impacter les tables existantes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Professional Training Catalog Management (Priority: P1)

Administrators need to create and manage a catalog of professional training programs with detailed information including objectives, prerequisites, pricing, and certification details. Each training program must be uniquely identifiable and searchable.

**Why this priority**: This is the foundation for all professional training operations. Without the ability to define training programs, no other functionality can operate.

**Independent Test**: Can be fully tested by creating a professional training program with all required fields, verifying it appears in the catalog, and confirming it doesn't interfere with existing academic courses.

**Acceptance Scenarios**:

1. **Given** an administrator is logged in, **When** they create a new professional training program with title, description, duration, and pricing, **Then** the training is saved and appears in the professional training catalog
2. **Given** a professional training program exists, **When** an administrator searches by title or category, **Then** the training program is found and displayed
3. **Given** multiple professional training programs exist, **When** an administrator filters by status (active/inactive), **Then** only trainings matching the filter are displayed
4. **Given** a professional training program is created, **When** viewing the program details, **Then** all information including objectives, prerequisites, pricing, and certification details are visible

---

### User Story 2 - Training Session Scheduling (Priority: P1)

Administrators need to schedule training sessions for professional programs, specifying dates, location, delivery mode (in-person, remote, hybrid), capacity, and pricing. Each session must track availability and enrollment status.

**Why this priority**: Sessions are required for participants to enroll. This functionality is essential for the training delivery workflow.

**Independent Test**: Can be fully tested by creating a training session linked to a professional training program, verifying dates and capacity are correctly stored, and confirming session status can be updated as enrollment progresses.

**Acceptance Scenarios**:

1. **Given** a professional training program exists, **When** an administrator creates a new session with start date, end date, and capacity, **Then** the session is created with status "planned" and available places equal to capacity
2. **Given** a training session exists, **When** participants enroll, **Then** available places decrease and reserved places increase accordingly
3. **Given** a training session reaches full capacity, **When** checking session status, **Then** the status reflects "full" and no additional enrollments are allowed
4. **Given** a training session is created, **When** viewing session details, **Then** all information including dates, location, delivery mode, and current enrollment status are displayed

---

### User Story 3 - Trainer Management and Assignment (Priority: P2)

Administrators need to manage a roster of trainers (instructors) with their expertise areas, contact information, and professional details. Trainers must be assignable to training sessions with specific roles.

**Why this priority**: Trainers are essential for delivering training, but this can be implemented after basic training and session management is in place.

**Independent Test**: Can be fully tested by creating a trainer profile, assigning the trainer to a training session, and verifying the assignment relationship is correctly stored and retrievable.

**Acceptance Scenarios**:

1. **Given** an administrator is logged in, **When** they create a trainer profile with name, email, specialties, and bio, **Then** the trainer is saved and appears in the trainer directory
2. **Given** a trainer and a training session exist, **When** an administrator assigns the trainer to the session with a role (Principal, Assistant, etc.), **Then** the assignment is created and the trainer appears in the session's trainer list
3. **Given** a trainer is assigned to multiple sessions, **When** viewing the trainer's profile, **Then** all assigned sessions are listed with their dates and roles
4. **Given** a trainer profile exists, **When** searching trainers by specialty or name, **Then** matching trainers are found and displayed

---

### User Story 4 - Company Client Management (Priority: P2)

Administrators need to manage company clients that may enroll employees in professional training programs. Each company must have contact information, business details, and relationship tracking.

**Why this priority**: Many professional trainings are sold to companies rather than individuals. This enables enterprise sales and bulk enrollments.

**Independent Test**: Can be fully tested by creating a company client record, linking it to an enrollment, and verifying company information is correctly associated with the enrollment.

**Acceptance Scenarios**:

1. **Given** an administrator is logged in, **When** they create a company client with business name, SIRET, contact person, and address, **Then** the company is saved and appears in the company directory
2. **Given** a company client exists, **When** viewing company details, **Then** all business information, contact details, and enrollment history are displayed
3. **Given** multiple company clients exist, **When** searching by company name or SIRET, **Then** matching companies are found
4. **Given** a company client has enrollments, **When** viewing company profile, **Then** all associated enrollments and training history are listed

---

### User Story 5 - Participant Enrollment Management (Priority: P1)

Administrators and participants need to enroll individuals or company employees in training sessions. Each enrollment must track participant information, associated company (if applicable), status, and pricing details including any promotional codes applied.

**Why this priority**: Enrollment is the core transaction that connects participants to training sessions. This is essential for the business to operate.

**Independent Test**: Can be fully tested by creating an enrollment for a participant in a training session, applying a promotional code, and verifying the enrollment status and pricing are correctly calculated and stored.

**Acceptance Scenarios**:

1. **Given** a training session with available places exists, **When** an administrator creates an enrollment for a participant, **Then** the enrollment is created with status "pending", available places decrease, and a unique enrollment number is generated
2. **Given** a valid promotional code exists, **When** applying the code during enrollment, **Then** the discount is calculated and applied to the enrollment total
3. **Given** an enrollment exists, **When** updating the enrollment status to "confirmed", **Then** the status change is saved and reflected in enrollment reports
4. **Given** a company client exists, **When** creating an enrollment with type "company", **Then** the enrollment is linked to the company and company contact receives notifications
5. **Given** an enrollment is created, **When** viewing enrollment details, **Then** all information including participant, session, pricing, promotional code, and status are displayed

---

### User Story 6 - Payment Processing and Tracking (Priority: P2)

The system needs to track payments for professional training enrollments, supporting multiple payment methods and maintaining payment status and transaction references.

**Why this priority**: Payment tracking is essential for financial management, but can be implemented after enrollment functionality is in place.

**Independent Test**: Can be fully tested by creating a payment record linked to an enrollment, updating payment status, and verifying payment history is correctly associated with the enrollment.

**Acceptance Scenarios**:

1. **Given** an enrollment exists, **When** a payment is recorded with amount, payment method, and transaction reference, **Then** the payment is saved with status "pending" and linked to the enrollment
2. **Given** a payment exists, **When** updating payment status to "validated", **Then** the status change is saved and the enrollment status may be updated accordingly
3. **Given** multiple payments exist for an enrollment, **When** viewing enrollment payment history, **Then** all payments are listed with amounts, methods, statuses, and dates
4. **Given** a payment is recorded, **When** viewing payment details, **Then** all transaction information including external reference and metadata are displayed

---

### User Story 7 - Promotional Code Management (Priority: P3)

Administrators need to create and manage promotional codes that can be applied to enrollments, with configurable discount types (percentage or fixed amount), validity periods, usage limits, and applicable training programs.

**Why this priority**: Promotional codes support marketing and sales efforts, but are not essential for core operations.

**Independent Test**: Can be fully tested by creating a promotional code, applying it to an enrollment, and verifying the discount is correctly calculated and usage limits are enforced.

**Acceptance Scenarios**:

1. **Given** an administrator is logged in, **When** they create a promotional code with discount type, value, validity dates, and usage limit, **Then** the code is saved and can be used for eligible enrollments
2. **Given** a promotional code with usage limit exists, **When** the code is applied to enrollments, **Then** usage count increments and the code becomes unavailable when limit is reached
3. **Given** a promotional code with validity dates exists, **When** attempting to use the code outside validity period, **Then** the system rejects the code with an appropriate message
4. **Given** a promotional code is configured for specific training programs, **When** applying the code to a non-eligible enrollment, **Then** the system rejects the code

---

### User Story 8 - Training Materials and Resources Management (Priority: P3)

Trainers need to upload and manage training materials (documents, presentations, videos) that can be associated with training programs or specific sessions, with visibility controls for participants.

**Why this priority**: Training materials enhance the learning experience but are not essential for core enrollment and delivery operations.

**Independent Test**: Can be fully tested by uploading a training material, associating it with a training program or session, and verifying it's accessible to authorized users with correct visibility settings.

**Acceptance Scenarios**:

1. **Given** a trainer is logged in, **When** they upload a training material with title, description, and file, **Then** the material is saved and associated with the specified training program or session
2. **Given** training materials exist, **When** viewing a training program or session, **Then** associated materials are listed with download links
3. **Given** a training material is marked as "not visible to participants", **When** a participant views the training, **Then** the material does not appear in their view
4. **Given** training materials are uploaded, **When** searching by title or type, **Then** matching materials are found and displayed

---

### Edge Cases

- What happens when a training session is cancelled after enrollments exist?
- How does the system handle duplicate promotional code creation attempts?
- What happens when a company client is deactivated but has active enrollments?
- How does the system handle payment failures or refunds?
- What happens when a trainer is removed from a session that has already started?
- How does the system handle concurrent enrollment attempts when only one place remains?
- What happens when a promotional code expires while an enrollment is being processed?
- How does the system handle training materials that exceed file size limits?
- What happens when a training program is deactivated but has scheduled sessions?
- How does the system handle enrollments when a session reaches capacity between viewing and submitting?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST store professional training program information including title, description, objectives, prerequisites, duration, pricing, certification details, and program structure
- **FR-002**: System MUST support creating training sessions linked to professional training programs with dates, location, delivery mode, capacity, and pricing
- **FR-003**: System MUST track session enrollment capacity, calculating available places as total capacity minus reserved places
- **FR-004**: System MUST manage trainer profiles with contact information, specialties, professional details, and optional user account linkage
- **FR-005**: System MUST support assigning trainers to training sessions with specific roles (Principal, Assistant, Intervenant)
- **FR-006**: System MUST store company client information including business details, contact information, and relationship history
- **FR-007**: System MUST support creating enrollments for participants in training sessions, distinguishing between individual and company enrollments
- **FR-008**: System MUST generate unique enrollment numbers for each enrollment
- **FR-009**: System MUST track enrollment status (pending, confirmed, cancelled, completed)
- **FR-010**: System MUST support applying promotional codes to enrollments with discount calculation
- **FR-011**: System MUST manage promotional codes with configurable discount types (percentage or fixed amount), validity periods, usage limits, and applicable training programs
- **FR-012**: System MUST track payment transactions linked to enrollments with payment method, amount, status, and external transaction references
- **FR-013**: System MUST support multiple payment methods (mobile money, bank transfer, card, etc.)
- **FR-014**: System MUST track payment status (pending, validated, failed, refunded, cancelled)
- **FR-015**: System MUST allow trainers to upload and manage training materials associated with training programs or sessions
- **FR-016**: System MUST control visibility of training materials to participants
- **FR-017**: System MUST maintain data isolation between Imhotep Data professional training data and Imhotep Academy academic data
- **FR-018**: System MUST support searching and filtering professional training programs by various criteria (title, category, status, etc.)
- **FR-019**: System MUST support searching and filtering training sessions by program, date range, status, and availability
- **FR-020**: System MUST maintain referential integrity between related entities (sessions linked to programs, enrollments linked to sessions, payments linked to enrollments, etc.)
- **FR-021**: System MUST preserve all existing Imhotep Academy data and functionality without modification
- **FR-022**: System MUST support multi-tenant architecture, ensuring data is properly isolated by tenant
- **FR-023**: System MUST maintain audit trails with creation and update timestamps for all entities

### Key Entities *(include if feature involves data)*

- **Professional Training Program**: Represents a professional training offering with title, description, objectives, prerequisites, duration, pricing, certification information, target audience, and program content. Related to training sessions (one-to-many) and can be associated with training materials.

- **Training Session**: Represents a scheduled instance of a professional training program with specific dates, location, delivery mode, capacity, enrollment tracking, and pricing. Related to training program (many-to-one), enrollments (one-to-many), trainers (many-to-many through assignments), and training materials.

- **Trainer**: Represents an instructor who can deliver professional training, with contact information, specialties, professional background, and optional user account linkage. Related to training sessions (many-to-many) and training materials (one-to-many).

- **Company Client**: Represents a business organization that may enroll employees in professional training, with business details, contact information, and relationship history. Related to enrollments (one-to-many).

- **Enrollment**: Represents a participant's registration for a training session, with participant information, associated company (if applicable), enrollment type, status, pricing details, and promotional code usage. Related to training session (many-to-one), participant user (many-to-one), company client (many-to-one), and payments (one-to-many).

- **Promotional Code**: Represents a discount code that can be applied to enrollments, with discount configuration, validity period, usage limits, and applicable training programs. Related to enrollments (one-to-many through usage).

- **Payment**: Represents a financial transaction for an enrollment, with amount, payment method, status, external transaction reference, and metadata. Related to enrollment (many-to-one).

- **Training Material**: Represents educational resources (documents, presentations, videos) associated with training programs or sessions, with file information, visibility controls, and metadata. Related to trainer (many-to-one), training program (many-to-one), and training session (many-to-one).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can create a professional training program with all required information in under 5 minutes
- **SC-002**: System supports creating and managing at least 100 professional training programs without performance degradation
- **SC-003**: System supports scheduling at least 500 training sessions per year with accurate capacity tracking
- **SC-004**: Enrollment creation completes in under 10 seconds including discount calculation
- **SC-005**: System maintains 100% data integrity - no orphaned records or broken relationships between related entities
- **SC-006**: All existing Imhotep Academy functionality remains fully operational with zero data loss or corruption
- **SC-007**: System supports at least 50 concurrent enrollment operations without conflicts or data inconsistencies
- **SC-008**: Search and filter operations on professional training programs return results in under 2 seconds for catalogs of up to 1000 programs
- **SC-009**: Payment tracking supports at least 10 different payment methods with accurate status management
- **SC-010**: Promotional code validation and discount calculation completes in under 1 second
- **SC-011**: Training material upload and association completes successfully for files up to 100MB in size
- **SC-012**: Multi-tenant data isolation is maintained with zero cross-tenant data leakage in queries and operations

## Assumptions

- The existing database uses PostgreSQL with UUID primary keys, multi-tenant architecture with Row Level Security (RLS), and follows established naming conventions
- Existing Imhotep Academy tables (cycles, programmes, courses, teachers, students, etc.) will remain unchanged
- The `users` table can be reused for participants in professional training, with appropriate role-based access control
- Payment processing integration with external providers will be handled at the application layer, not in the database schema
- Training material files will be stored in external storage (MinIO/S3), with the database storing references/URLs
- All new tables will follow the existing pattern of including `tenant_id`, `created_at`, and `updated_at` fields
- The system will use ENUM types for status fields and delivery modes, consistent with existing patterns
- JSON/JSONB fields will be used for flexible data structures (objectives, program content, metadata) where appropriate
- Generated fields (like enrollment numbers, session codes) will follow a consistent naming pattern
- All foreign key relationships will use appropriate CASCADE or SET NULL behaviors based on business rules

## Dependencies

- Existing multi-tenant database infrastructure with RLS policies
- Existing `users` and `tenants` tables for user and tenant management
- Database migration system for applying schema changes
- File storage system (MinIO/S3) for training materials (referenced but not part of this schema)

## Out of Scope

- Application-level business logic for enrollment validation
- Payment gateway integration implementation
- Email notification system for enrollments and payments
- Reporting and analytics dashboards
- User interface components for managing professional training
- API endpoints for professional training operations
- File upload handling for training materials (only database references are in scope)
- Integration with external certification systems
- Automated session scheduling or capacity optimization
