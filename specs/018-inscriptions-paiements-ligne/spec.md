# Feature Specification: Inscriptions & Paiements en Ligne - Module Imhotep Data

**Feature Branch**: `018-inscriptions-paiements-ligne`  
**Created**: 2025-11-20  
**Status**: Draft  
**Input**: User description: "Phase 4: Inscriptions & Paiements en Ligne - Module Imhotep Data"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Individual Enrollment Flow (Priority: P1)

A prospective learner wants to enroll in a professional training session. They navigate to the session detail page, click "Enroll", and complete a multi-step enrollment form providing their personal information (name, email, phone, job title), accept terms and conditions, review a summary with pricing, and proceed to payment selection.

**Why this priority**: This is the core enrollment transaction that converts interested learners into enrolled participants. Without this flow, users cannot enroll in training sessions, making the entire training business non-functional.

**Independent Test**: Can be fully tested by a user navigating to a session detail page, clicking enroll, completing the enrollment form with valid information, reviewing the summary, and reaching the payment selection step. This delivers immediate value by enabling enrollment conversions.

**Acceptance Scenarios**:

1. **Given** a user views a session detail page with available places, **When** they click "Enroll" or "Register", **Then** they are taken to the enrollment form page
2. **Given** a user is on the enrollment form, **When** they select "Individual enrollment" and fill in required fields (title, first name, last name, email, phone, job title), **Then** the form validates input and allows progression to the next step
3. **Given** a user completes the personal information step, **When** they proceed to the summary step, **Then** they see a complete summary of their enrollment including session details, participant information, and total price
4. **Given** a user is on the summary step, **When** they optionally enter a promotional code and validate it, **Then** the price updates to reflect the discount if the code is valid
5. **Given** a user accepts terms and conditions, **When** they confirm enrollment, **Then** a temporary reservation is created (15 minutes) and they are redirected to payment selection
6. **Given** a user does not complete payment within 15 minutes, **When** the reservation expires, **Then** the reserved place is released and the user is notified

---

### User Story 2 - Company Enrollment Flow (Priority: P1)

A company representative wants to enroll an employee in a professional training session. They navigate to the session, select "Company enrollment", provide company information (business name, SIRET, address) and employee details, review the summary, and proceed to payment.

**Why this priority**: Many professional trainings are sold to companies rather than individuals. This enables enterprise sales and is essential for business operations alongside individual enrollments.

**Independent Test**: Can be fully tested by a user selecting company enrollment, filling in company and employee information, optionally searching for existing company records, reviewing the summary, and reaching payment. This delivers value by enabling B2B enrollment conversions.

**Acceptance Scenarios**:

1. **Given** a user is on the enrollment form, **When** they select "Company enrollment", **Then** additional fields appear for company information (business name, SIRET, address, contact person)
2. **Given** a user selects company enrollment, **When** they start typing a company name or SIRET, **Then** the system suggests matching existing company records that can be selected
3. **Given** a user selects an existing company, **When** they proceed, **Then** company information is pre-filled and they only need to provide employee details
4. **Given** a user creates a new company enrollment, **When** they provide all required company and employee information, **Then** the enrollment is created and linked to the company record
5. **Given** a company enrollment is created, **When** viewing the summary, **Then** both company and employee information are displayed along with pricing

---

### User Story 3 - Promotional Code Application (Priority: P2)

A user wants to apply a promotional code during enrollment to receive a discount. They enter the code on the summary step, the system validates it, and if valid, applies the discount to the total price.

**Why this priority**: Promotional codes support marketing and sales efforts, but enrollment can proceed without them. This enhances the enrollment experience but is not essential for core operations.

**Independent Test**: Can be fully tested by entering a valid promotional code during enrollment, verifying the discount is calculated correctly (percentage or fixed amount), and confirming the final price reflects the discount. This delivers value by enabling promotional campaigns.

**Acceptance Scenarios**:

1. **Given** a user is on the enrollment summary step, **When** they enter a promotional code and click "Validate", **Then** the system checks code validity (active, within date range, usage limits, applicable to training)
2. **Given** a valid promotional code is entered, **When** validation succeeds, **Then** the discount is calculated and applied, the final price updates, and a success message is displayed
3. **Given** an invalid promotional code is entered, **When** validation fails, **Then** an error message explains why (expired, already used, not applicable, etc.)
4. **Given** a promotional code with percentage discount is applied, **When** the discount is calculated, **Then** the reduction amount is shown and the final price reflects the discount
5. **Given** a promotional code with fixed amount discount is applied, **When** the discount is calculated, **Then** the fixed reduction is shown and the final price reflects the discount

---

### User Story 4 - Payment Method Selection and Processing (Priority: P1)

A user has completed enrollment and needs to pay. They select a payment method (Orange Money, MTN Money, Wave, Bank Card, or TresorPay), provide any required information (phone number for mobile money), and complete the payment through the selected provider.

**Why this priority**: Payment completion is essential to confirm enrollments. Without payment processing, enrollments remain pending and cannot be confirmed, blocking the business workflow.

**Independent Test**: Can be fully tested by selecting a payment method, providing required information, initiating payment, and verifying the payment status updates correctly. This delivers value by enabling enrollment confirmation through payment.

**Acceptance Scenarios**:

1. **Given** a user reaches the payment selection page, **When** they view available payment methods, **Then** they see all supported methods (Orange Money, MTN Money, Wave, Bank Card, TresorPay) with clear descriptions
2. **Given** a user selects a mobile money payment method (Orange Money or MTN Money), **When** they proceed, **Then** they are prompted to enter their phone number
3. **Given** a user selects a mobile money method and enters their phone number, **When** they initiate payment, **Then** they receive instructions (USSD code or QR code) to complete payment on their mobile device
4. **Given** a user selects bank card payment, **When** they initiate payment, **Then** they are redirected to a secure payment page where they can enter card details
5. **Given** a user completes payment successfully, **When** payment is confirmed, **Then** they are redirected to a confirmation page and receive email confirmation with invoice
6. **Given** a payment fails, **When** the failure is detected, **Then** the user is notified and can retry payment or select a different method

---

### User Story 5 - Payment Status Verification and Webhooks (Priority: P1)

The system needs to automatically verify payment status from payment providers and update enrollment status accordingly. When a payment provider confirms payment (via webhook or polling), the system updates the payment record, confirms the enrollment, and sends notifications.

**Why this priority**: Automatic payment verification is essential for a smooth user experience. Without this, payments would require manual verification, creating delays and poor user experience.

**Independent Test**: Can be fully tested by simulating a payment provider webhook or status update, verifying the system updates payment status, confirms enrollment, updates session availability, and sends confirmation notifications. This delivers value by automating enrollment confirmation.

**Acceptance Scenarios**:

1. **Given** a payment provider sends a webhook notification confirming payment, **When** the system receives it, **Then** the payment status is updated to "validated", enrollment status changes to "confirmed", and session availability is updated
2. **Given** a payment is validated, **When** the enrollment is confirmed, **Then** an invoice PDF is generated and sent via email to the participant
3. **Given** a payment is validated, **When** confirmation occurs, **Then** the participant receives both email and SMS confirmation with enrollment details
4. **Given** a payment provider indicates payment failure, **When** the system receives the notification, **Then** payment status is updated to "failed", the user is notified, and the reserved place remains available
5. **Given** a payment remains in "pending" status, **When** the system polls payment status, **Then** it checks with the provider and updates status if changed

---

### User Story 6 - Enrollment Confirmation and Invoice Delivery (Priority: P1)

After successful payment, a user needs to receive confirmation of their enrollment with all relevant details and an invoice for their records. They should be able to view this information on a confirmation page and download the invoice.

**Why this priority**: Users need confirmation and documentation of their enrollment. This provides closure to the enrollment process and delivers essential documentation for accounting and records.

**Independent Test**: Can be fully tested by completing a successful enrollment and payment, verifying the confirmation page displays all enrollment details, and confirming the invoice can be downloaded. This delivers value by providing enrollment documentation.

**Acceptance Scenarios**:

1. **Given** a payment is successfully validated, **When** the user is redirected to the confirmation page, **Then** they see a success message, enrollment number, session details, and payment information
2. **Given** a user is on the confirmation page, **When** they view the page, **Then** they see complete enrollment details including training title, session dates, participant information, and payment method used
3. **Given** an enrollment is confirmed, **When** an invoice is generated, **Then** the invoice includes all required information (enrollment number, participant details, training details, pricing breakdown, payment information) in PDF format
4. **Given** a user is on the confirmation page, **When** they click "Download Invoice", **Then** the invoice PDF is downloaded to their device
5. **Given** an enrollment is confirmed, **When** confirmation occurs, **Then** the participant receives an email with enrollment confirmation and invoice attached

---

### User Story 7 - View Enrollment History (Priority: P2)

A logged-in user wants to view their enrollment history to see all past and current enrollments, their statuses, access invoices, and manage their enrollments.

**Why this priority**: Users need to track their enrollments and access documentation. This supports user self-service but enrollment can function without this feature initially.

**Independent Test**: Can be fully tested by a logged-in user accessing their enrollment history page, viewing their enrollments with statuses, filtering by status or date, and accessing enrollment details and invoices. This delivers value by enabling enrollment management.

**Acceptance Scenarios**:

1. **Given** a logged-in user navigates to "My Enrollments", **When** they view the page, **Then** they see a list of all their enrollments (past and current) with status, training title, session dates, and payment status
2. **Given** a user views their enrollment history, **When** they filter by status (confirmed, pending, completed, cancelled), **Then** only enrollments matching the selected status are displayed
3. **Given** a user views an enrollment in their history, **When** they click "View Details", **Then** they see complete enrollment information including session details, participant information, and payment history
4. **Given** a user views a confirmed enrollment, **When** they click "Download Invoice", **Then** the invoice PDF is downloaded
5. **Given** a user has a pending enrollment (payment not completed), **When** they view it in their history, **Then** they can click "Complete Payment" to return to the payment page

---

### User Story 8 - Enrollment Cancellation (Priority: P2)

A user needs to cancel an enrollment (before session start) and receive appropriate refund processing if payment was already made.

**Why this priority**: Users may need to cancel enrollments due to schedule changes or other reasons. This supports user flexibility but is not essential for core enrollment operations.

**Independent Test**: Can be fully tested by a user cancelling a pending or confirmed enrollment, verifying the enrollment status updates, place is released, and refund is initiated if payment was made. This delivers value by enabling enrollment management flexibility.

**Acceptance Scenarios**:

1. **Given** a user views a pending or confirmed enrollment, **When** they request cancellation, **Then** they are asked to confirm the cancellation
2. **Given** a user confirms cancellation of a confirmed enrollment with payment, **When** cancellation is processed, **Then** the enrollment status changes to "cancelled", the place is released, and refund processing is initiated
3. **Given** a user cancels a pending enrollment (no payment), **When** cancellation is processed, **Then** the enrollment status changes to "cancelled" and the place is immediately released
4. **Given** an enrollment is cancelled, **When** cancellation occurs, **Then** the user receives email notification confirming cancellation and refund information if applicable
5. **Given** a user attempts to cancel an enrollment for a session that has already started, **When** they try to cancel, **Then** the system prevents cancellation and explains that the session has begun

---

### Edge Cases

- What happens when a session becomes full while a user is completing enrollment?
- How does the system handle duplicate enrollment attempts (same user, same session)?
- What happens if payment provider webhook is delayed or fails?
- How does the system handle payment provider downtime or errors?
- What happens when a promotional code expires or reaches usage limit during enrollment?
- How does the system handle enrollment for a session that is cancelled after enrollment but before payment?
- What happens if a user's email or phone is already registered but they try to enroll as a new user?
- How does the system handle partial payment scenarios or payment retries?
- What happens when a session date changes after enrollment is confirmed?
- How does the system handle refund processing for different payment methods?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to enroll in professional training sessions by providing personal information (name, email, phone, job title) or company information (business name, SIRET, address, contact person, employee details)
- **FR-002**: System MUST validate all enrollment form fields (email format, phone format, required fields) before allowing progression to next step
- **FR-003**: System MUST support two enrollment types: individual enrollment (personal information only) and company enrollment (company and employee information)
- **FR-004**: System MUST allow users to search for and select existing company records during company enrollment to avoid duplicate company creation
- **FR-005**: System MUST create a temporary reservation (15 minutes) when enrollment form is submitted, reserving a place in the session
- **FR-006**: System MUST automatically release reserved places if payment is not completed within 15 minutes
- **FR-007**: System MUST verify session availability (places available, session status) before allowing enrollment completion
- **FR-008**: System MUST display a summary step showing complete enrollment information (session details, participant information, pricing) before payment
- **FR-009**: System MUST allow users to enter and validate promotional codes during enrollment
- **FR-010**: System MUST validate promotional codes for: active status, validity dates, usage limits, and applicability to the specific training program
- **FR-011**: System MUST calculate and apply discounts correctly for both percentage-based and fixed-amount promotional codes
- **FR-012**: System MUST support multiple payment methods: Orange Money, MTN Money, Wave, Bank Card (via payment gateway), and TresorPay
- **FR-013**: System MUST collect phone number when mobile money payment methods (Orange Money, MTN Money) are selected
- **FR-014**: System MUST provide payment instructions (USSD codes, QR codes, or redirect URLs) based on selected payment method
- **FR-015**: System MUST redirect users to secure payment pages for bank card payments
- **FR-016**: System MUST receive and process payment provider webhooks to update payment status automatically
- **FR-017**: System MUST poll payment status for mobile money payments that may not have immediate webhook confirmation
- **FR-018**: System MUST update enrollment status to "confirmed" when payment is successfully validated
- **FR-019**: System MUST update session availability (decrease available places) when enrollment is confirmed
- **FR-020**: System MUST generate and send invoice PDF automatically when enrollment is confirmed
- **FR-021**: System MUST send email confirmation to participant when enrollment is confirmed, including enrollment details and invoice attachment
- **FR-022**: System MUST send SMS confirmation to participant when enrollment is confirmed (if phone number available)
- **FR-023**: System MUST notify administrators when new enrollments are confirmed
- **FR-024**: System MUST allow logged-in users to view their enrollment history with filtering by status and date
- **FR-025**: System MUST allow users to download invoices for confirmed enrollments from their enrollment history
- **FR-026**: System MUST allow users to cancel enrollments (pending or confirmed) before session start date
- **FR-027**: System MUST initiate refund processing when a confirmed enrollment with payment is cancelled
- **FR-028**: System MUST release reserved places immediately when enrollments are cancelled
- **FR-029**: System MUST prevent enrollment cancellation for sessions that have already started
- **FR-030**: System MUST create user accounts automatically for new participants who enroll without existing accounts
- **FR-031**: System MUST send account creation email with temporary password to newly created user accounts
- **FR-032**: System MUST handle payment failures gracefully, allowing users to retry payment or select different payment method
- **FR-033**: System MUST maintain payment transaction history linked to enrollments
- **FR-034**: System MUST display real-time session availability during enrollment process
- **FR-035**: System MUST prevent enrollment if session becomes full during the enrollment process
- **FR-036**: System MUST generate unique enrollment numbers for each enrollment in format: INS-DATA-YYYYMMDD-XXX
- **FR-037**: System MUST generate unique payment transaction numbers for each payment attempt
- **FR-038**: System MUST log all enrollment and payment actions for audit purposes
- **FR-039**: System MUST validate payment amounts match enrollment total before processing
- **FR-040**: System MUST handle webhook signature verification for payment provider notifications to ensure authenticity

### Key Entities *(include if feature involves data)*

- **Enrollment (Inscription Professionnelle)**: Represents a participant's registration for a training session. Contains enrollment number, participant information, session reference, enrollment type (individual/company), status (pending/confirmed/cancelled/completed), pricing details, promotional code used, and timestamps.

- **Payment (Paiement Professionnel)**: Represents a payment transaction for an enrollment. Contains payment number, enrollment reference, payment method, amount, status (pending/validated/failed/refunded), transaction references (internal and external provider references), payment date, and metadata.

- **Promotional Code (Code Promo)**: Represents a discount code that can be applied to enrollments. Contains code, discount type (percentage/fixed amount), discount value, validity dates, usage limits (maximum uses, current usage count), applicable training programs, and active status.

- **Company Client (Entreprise Cliente)**: Represents a business entity that enrolls employees. Contains business name, SIRET/NIF, address, contact information, and relationship to enrollments.

- **Temporary Reservation**: Represents a time-limited place reservation during enrollment process. Contains enrollment reference, session reference, expiration timestamp, and is automatically cleaned up after expiration.

- **Invoice (Facture)**: Represents a generated invoice document for confirmed enrollment. Contains invoice number, enrollment reference, participant/company information, pricing breakdown, payment information, generation date, and PDF file reference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete individual enrollment (form submission through payment initiation) in under 5 minutes from session detail page to payment selection
- **SC-002**: Users can complete company enrollment (including company and employee information) in under 8 minutes from session detail page to payment selection
- **SC-003**: System processes payment provider webhooks and updates enrollment status within 30 seconds of webhook receipt
- **SC-004**: System generates and delivers invoice PDF within 60 seconds of payment confirmation
- **SC-005**: 95% of promotional code validations complete in under 2 seconds
- **SC-006**: System successfully processes payments from all supported payment methods (Orange Money, MTN Money, Wave, Bank Card, TresorPay) with 99% success rate for valid payment attempts
- **SC-007**: Users receive email confirmation within 2 minutes of enrollment confirmation
- **SC-008**: Users receive SMS confirmation within 5 minutes of enrollment confirmation (when phone number available)
- **SC-009**: System prevents double-booking by accurately tracking and updating session availability in real-time during enrollment process
- **SC-010**: 90% of users successfully complete enrollment on first attempt without requiring support assistance
- **SC-011**: System handles concurrent enrollment attempts for the same session without creating over-bookings (places reserved exceed session capacity)
- **SC-012**: Temporary reservations are automatically released within 1 minute of expiration (15 minutes after creation)
- **SC-013**: Users can view their enrollment history and access invoices within 3 seconds of page load
- **SC-014**: Payment status polling for mobile money payments detects payment completion within 2 minutes of actual payment on user's device
- **SC-015**: System maintains 99.9% uptime for payment processing endpoints to ensure enrollment can proceed without interruption

## Assumptions

- Payment provider APIs (Orange Money, MTN Money, Wave, Bank Card gateway, TresorPay) are available and accessible with appropriate API credentials
- Payment providers support webhook notifications for payment status updates (with polling as fallback for providers without webhooks)
- Email service (SMTP) is configured and operational for sending confirmation emails and invoices
- SMS service is configured and operational for sending confirmation SMS (optional, enrollment can proceed without SMS)
- Session availability is tracked accurately in the database and updates are reflected in real-time
- Users have internet connectivity and access to payment methods (mobile money accounts, bank cards) to complete payments
- Promotional codes are created and managed by administrators through a separate administrative interface (not part of this feature)
- Company records can be searched and selected during enrollment, with option to create new company if not found
- User accounts are created automatically for new participants, with email delivery of temporary passwords
- Invoice PDF generation uses standard PDF library capabilities
- Payment amounts are in FCFA (West African CFA franc) currency
- All payment transactions are logged for audit and reconciliation purposes
- Payment provider webhook endpoints are publicly accessible and can receive notifications from providers
- System has appropriate error handling and retry mechanisms for payment provider API calls
- Session capacity and availability are managed by the session management system (Phase 3)

## Dependencies

- **Session Management System (Phase 3)**: Enrollment depends on session data (dates, capacity, availability, pricing, training details)
- **Training Catalog (Phase 2)**: Enrollment links to training programs from the catalog
- **Database Schema (Phase 1)**: Enrollment and payment tables must exist with proper relationships
- **Authentication System**: User account creation and login functionality for enrollment history access
- **Email Service**: SMTP configuration for sending confirmation emails and invoices
- **SMS Service**: SMS provider integration for sending confirmation SMS (optional)
- **Payment Provider APIs**: Integration with Orange Money, MTN Money, Wave, Bank Card gateway (e.g., CinetPay), and TresorPay APIs
- **PDF Generation Library**: Capability to generate invoice PDFs with proper formatting

## Out of Scope

- Administrative interface for creating and managing promotional codes (assumed to exist separately)
- Administrative interface for managing enrollments (viewing, editing, bulk operations) - this is administrative functionality
- Payment refund processing details and workflows (initiation is in scope, but detailed refund workflows are administrative)
- Session management and calendar functionality (covered in Phase 3)
- Training catalog browsing and search (covered in Phase 2)
- User account management and profile editing (assumed to exist in authentication system)
- Multi-currency support (assumes FCFA only)
- Partial payment or installment payment plans (single full payment per enrollment)
- Waitlist functionality for full sessions (enrollment blocked when session is full)
- Enrollment modification after confirmation (cancellation only, no edits)
- Integration with accounting systems or ERP systems for financial reporting
- Advanced analytics or reporting on enrollment and payment data
