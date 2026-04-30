# Research: Inscriptions & Paiements en Ligne - Module Imhotep Data

**Date**: 2025-11-20  
**Feature**: Inscriptions & Paiements en Ligne (`018-inscriptions-paiements-ligne`)

## Overview

This document consolidates research findings and technical decisions for implementing the online enrollment and payment system for professional training sessions. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Payment Provider Integration Architecture

**Decision**: Create service-layer abstractions for each payment provider (Orange Money, MTN Money, Wave, Bank Card, TresorPay) with a unified interface, following the existing TresorPay gateway service pattern.

**Rationale**: 
- Existing `TresorPayGatewayService` provides a good pattern to follow
- Service abstraction allows easy addition/removal of providers
- Unified interface simplifies payment processing logic
- Each provider has different API patterns (webhooks, polling, redirects)
- Service layer enables testing and mocking

**Alternatives Considered**:
- Single unified payment service: Rejected - providers have too different APIs and workflows
- Direct integration in route handlers: Rejected - violates separation of concerns, harder to test
- Third-party payment aggregator: Rejected - adds dependency and cost, reduces control

**Implementation Notes**:
- Create base `PaymentProviderService` interface with common methods:
  - `initiatePayment()` - Start payment transaction
  - `verifyPayment()` - Check payment status
  - `handleWebhook()` - Process webhook notifications
  - `generateSignature()` - Webhook signature verification
- Implement provider-specific services:
  - `OrangeMoneyService` - Orange Money API integration
  - `MTNMoneyService` - MTN Money API integration
  - `WaveService` - Wave API integration
  - `CarteBancaireService` - Bank card gateway (CinetPay or similar)
  - `TresorPayService` - Reuse existing service or extend
- Store provider credentials in environment variables
- Each service handles provider-specific authentication, request formatting, response parsing

### Decision 2: Payment Method Selection and User Flow

**Decision**: Implement payment method selection page with conditional form fields (phone number for mobile money), then redirect or show instructions based on provider type.

**Rationale**:
- Different payment methods require different user interactions:
  - Mobile money (Orange/MTN): Phone number + USSD code or QR code
  - Wave: QR code or redirect
  - Bank card: Redirect to secure gateway
  - TresorPay: Redirect to payment page
- Conditional UI reduces confusion and errors
- Clear instructions improve completion rate

**Alternatives Considered**:
- Single form with all fields: Rejected - too complex, many irrelevant fields
- Separate pages per payment method: Rejected - too many pages, harder to maintain
- Auto-detect payment method: Rejected - user should explicitly choose

**Implementation Notes**:
- Payment selection page shows all available methods with icons/descriptions
- When mobile money selected, show phone input field
- When bank card selected, show redirect message
- When Wave selected, show QR code or redirect option
- After payment initiation:
  - Mobile money: Display USSD code instructions + start polling
  - Wave: Display QR code + redirect link + start polling
  - Bank card/TresorPay: Redirect to provider payment page
- Polling for mobile money/Wave: Check status every 5 seconds, timeout after 5 minutes

### Decision 3: Webhook Handling and Payment Status Updates

**Decision**: Implement webhook endpoints for each provider with signature verification, then update payment status and trigger enrollment confirmation workflow.

**Rationale**:
- Webhooks provide real-time payment status updates
- Signature verification ensures webhook authenticity
- Automatic status updates improve user experience
- Reduces need for manual polling

**Alternatives Considered**:
- Polling only: Rejected - inefficient, delayed updates, higher API usage
- Manual verification: Rejected - poor user experience, requires admin intervention
- Webhooks without signature verification: Rejected - security risk, vulnerable to fraud

**Implementation Notes**:
- Create webhook routes: `/api/paiements-pro/webhook/:provider`
- Each route:
  - Verifies webhook signature using provider-specific method
  - Extracts transaction ID and status from payload
  - Updates payment record in database
  - If payment validated: triggers enrollment confirmation workflow
  - Returns appropriate HTTP status (200 OK for success, 400/401 for errors)
- Webhook payloads vary by provider, need provider-specific parsing
- Handle duplicate webhooks (idempotency)
- Log all webhook events for debugging

### Decision 4: Payment Status Polling (Fallback)

**Decision**: Implement polling mechanism for mobile money payments (Orange Money, MTN Money, Wave) that may not have reliable webhooks, with 5-second intervals and 5-minute timeout.

**Rationale**:
- Some mobile money providers have unreliable webhook delivery
- Polling provides fallback when webhooks fail
- 5-second interval balances responsiveness with API rate limits
- 5-minute timeout prevents indefinite polling

**Alternatives Considered**:
- No polling: Rejected - webhooks may fail, users left waiting
- Longer polling intervals: Rejected - poor user experience
- Shorter polling intervals: Rejected - may exceed API rate limits
- Server-side polling only: Rejected - client-side polling provides better UX

**Implementation Notes**:
- Start polling after payment initiation (client-side)
- Poll endpoint: `GET /api/paiements-pro/:id/statut`
- Poll every 5 seconds
- Stop polling when:
  - Payment status is "valide" or "echoue"
  - 5 minutes elapsed (60 polls)
  - User navigates away
- Show loading indicator during polling
- Display timeout message if polling expires

### Decision 5: Temporary Reservation System

**Decision**: Implement 15-minute temporary reservation system using database records with expiration timestamps, automatically released by background job.

**Rationale**:
- Prevents double-booking during enrollment process
- Gives users time to complete payment
- 15 minutes is reasonable for form completion and payment initiation
- Automatic cleanup prevents manual intervention

**Alternatives Considered**:
- No reservation: Rejected - race conditions, double-booking possible
- Longer reservation (30+ minutes): Rejected - blocks places too long
- Shorter reservation (5 minutes): Rejected - not enough time for payment
- Manual cleanup: Rejected - requires admin intervention, error-prone

**Implementation Notes**:
- Create `reservations_temporaires` table (or use existing if available):
  - `inscription_id` (FK)
  - `session_id` (FK)
  - `expire_at` (TIMESTAMP)
- When enrollment created: insert reservation with `expire_at = NOW() + 15 minutes`
- Background job (cron or scheduled task) runs every 5 minutes:
  - Find expired reservations
  - Check if payment completed
  - If no payment: cancel enrollment, release place
- Frontend shows countdown timer
- Warn user when < 5 minutes remaining

### Decision 6: Promotional Code Validation

**Decision**: Implement promotional code validation service that checks active status, validity dates, usage limits, and training applicability before applying discount.

**Rationale**:
- Prevents invalid code usage
- Enforces business rules (dates, limits, applicability)
- Real-time validation improves UX
- Centralized validation logic ensures consistency

**Alternatives Considered**:
- Client-side only validation: Rejected - security risk, can be bypassed
- Database constraints only: Rejected - complex business rules need application logic
- Validation only at payment: Rejected - user should know discount before payment

**Implementation Notes**:
- Validation endpoint: `POST /api/codes-promo/valider`
- Request: `{ code, formation_id, montant }`
- Validation checks:
  1. Code exists and is active
  2. Current date between `date_debut` and `date_fin`
  3. `utilisations_actuelles < utilisations_max` (if limit set)
  4. Training ID in `formations_applicables` array (if specified)
- Calculate discount:
  - Percentage: `reduction = montant * (valeur_reduction / 100)`
  - Fixed amount: `reduction = valeur_reduction`
- Return: `{ valide, code_promo, reduction_montant, nouveau_montant, message }`
- Increment usage count when code applied to enrollment

### Decision 7: Invoice PDF Generation

**Decision**: Use PDFKit library for server-side PDF generation with professional invoice template including company branding, enrollment details, pricing breakdown, and payment information.

**Rationale**:
- PDFKit is lightweight, server-side, and well-documented
- Professional invoices required for accounting and records
- Server-side generation ensures consistency and security
- Can include company logo and branding

**Alternatives Considered**:
- Puppeteer (HTML-to-PDF): Rejected - heavier, requires browser, slower
- Client-side PDF generation: Rejected - security risk, inconsistent formatting
- Third-party invoice service: Rejected - adds dependency and cost
- Pre-generated templates: Rejected - need dynamic content (enrollment details)

**Implementation Notes**:
- Install `pdfkit` package
- Create `InvoiceService` with `generateInvoice(inscriptionId, paiementId)` method
- Invoice template includes:
  - Company header (logo, name, address, contact)
  - Invoice number (FACT-YYYY-NNNN format)
  - Invoice date
  - Billing information (participant or company)
  - Enrollment details (training, session, dates)
  - Pricing breakdown (base price, discount, tax, total)
  - Payment information (method, transaction ID, date)
  - Footer (terms, contact info)
- Save PDF to file storage (MinIO/S3)
- Store PDF URL in enrollment record
- Return PDF as download or email attachment

### Decision 8: Email Notification Service

**Decision**: Use Nodemailer with SMTP configuration for sending enrollment confirmation emails with invoice attachments, following existing email patterns if available.

**Rationale**:
- Nodemailer is standard Node.js email library
- SMTP is widely supported and reliable
- Email templates provide professional communication
- Invoice attachment required for records

**Alternatives Considered**:
- Third-party email service (SendGrid, Mailgun): Rejected - adds cost, existing SMTP available
- No email service: Rejected - specification requires email confirmations
- Plain text emails: Rejected - need HTML templates for professional appearance

**Implementation Notes**:
- Install `nodemailer` package
- Create `EmailService` with methods:
  - `sendEnrollmentConfirmation(inscriptionId)` - Send confirmation with invoice
  - `sendAccountCreated(userId, tempPassword)` - Send account creation email
  - `sendPaymentFailed(inscriptionId)` - Send payment failure notification
  - `sendCancellationConfirmation(inscriptionId)` - Send cancellation email
- Email templates (HTML):
  - Enrollment confirmation: Welcome message, enrollment details, invoice attachment
  - Account created: Welcome, login credentials, password reset link
  - Payment failed: Error message, retry instructions
  - Cancellation: Confirmation, refund information
- SMTP configuration from environment variables
- Handle email delivery failures gracefully (log, don't block enrollment)

### Decision 9: SMS Notification Service

**Decision**: Use Twilio or similar SMS provider for sending enrollment confirmation SMS, with graceful degradation if SMS service unavailable.

**Rationale**:
- SMS provides immediate notification
- Many users prefer SMS for time-sensitive information
- Twilio is reliable and well-documented
- Optional service (enrollment can proceed without SMS)

**Alternatives Considered**:
- No SMS service: Rejected - specification requires SMS confirmations
- Provider-specific SMS APIs: Rejected - Twilio provides unified interface
- Email only: Rejected - SMS provides better reach in target market

**Implementation Notes**:
- Install `twilio` package (or similar)
- Create `SMSService` with `sendConfirmation(phone, message)` method
- SMS content: Short confirmation message with enrollment number and key details
- Handle SMS failures gracefully (log, don't block enrollment)
- Rate limiting to prevent abuse
- Cost considerations (SMS has per-message cost)

### Decision 10: Enrollment Number Generation

**Decision**: Generate unique enrollment numbers in format `INS-DATA-YYYYMMDD-XXX` using database sequence or count-based approach.

**Rationale**:
- Unique identifiers required for tracking and reference
- Date prefix provides chronological organization
- Sequential suffix ensures uniqueness
- Format is human-readable and professional

**Alternatives Considered**:
- UUID only: Rejected - not human-readable, harder for users to reference
- Random alphanumeric: Rejected - harder to track and reference
- Database sequence: Considered - simpler but less flexible

**Implementation Notes**:
- Format: `INS-DATA-YYYYMMDD-XXX`
  - `INS-DATA`: Fixed prefix for Imhotep Data enrollments
  - `YYYYMMDD`: Date of enrollment (e.g., 20241120)
  - `XXX`: Sequential number (001, 002, 003...)
- Generation logic:
  - Query count of enrollments for current date
  - Increment count + 1
  - Format with zero-padding
- Database function or application logic
- Ensure uniqueness with database constraint

### Decision 11: Payment Transaction Number Generation

**Decision**: Generate unique payment transaction numbers in format `TXN-YYYYMMDDHHMMSS-XXXXX` using timestamp and random suffix.

**Rationale**:
- Unique identifiers required for payment tracking
- Timestamp provides chronological organization
- Random suffix ensures uniqueness even for concurrent transactions
- Format is suitable for payment provider references

**Alternatives Considered**:
- UUID only: Rejected - payment providers may have format requirements
- Sequential numbers: Rejected - may conflict with concurrent transactions
- Date-only format: Rejected - not unique enough for high-volume

**Implementation Notes**:
- Format: `TXN-YYYYMMDDHHMMSS-XXXXX`
  - `TXN`: Fixed prefix
  - `YYYYMMDDHHMMSS`: Timestamp (e.g., 20241120143045)
  - `XXXXX`: Random alphanumeric (5 characters)
- Generation: `TXN-${format(new Date(), 'yyyyMMddHHmmss')}-${randomString(5)}`
- Ensure uniqueness with database constraint

### Decision 12: Concurrent Enrollment Prevention

**Decision**: Use database transactions with row-level locking to prevent double-booking when multiple users enroll simultaneously in the same session.

**Rationale**:
- Race conditions can occur with concurrent enrollments
- Database transactions ensure atomicity
- Row-level locking prevents simultaneous updates
- Critical for maintaining capacity limits

**Alternatives Considered**:
- Application-level locking: Rejected - doesn't work across multiple server instances
- Optimistic locking: Considered - but pessimistic locking is safer for payments
- No locking: Rejected - race conditions will cause over-booking

**Implementation Notes**:
- Use PostgreSQL `SELECT ... FOR UPDATE` to lock session row
- Check availability within transaction
- Create enrollment within same transaction
- Update session capacity within transaction
- Rollback if capacity exceeded
- Return appropriate error if enrollment fails

### Decision 13: User Account Auto-Creation

**Decision**: Automatically create user accounts for new participants during enrollment, with email delivery of temporary password and account details.

**Rationale**:
- New users should be able to enroll without pre-existing account
- Auto-creation reduces friction in enrollment process
- Email delivery provides secure password transmission
- Users can access enrollment history after account creation

**Alternatives Considered**:
- Require account creation before enrollment: Rejected - adds friction, reduces conversions
- No account creation: Rejected - users need access to enrollment history
- SMS password delivery: Rejected - email is more secure and standard

**Implementation Notes**:
- Check if user exists by email
- If not exists:
  - Generate random password (12+ characters, mixed case, numbers, symbols)
  - Hash password with bcrypt
  - Create user record with email, hashed password, role='apprenant'
  - Create user profile with enrollment information
  - Send account creation email with temporary password
- If exists: Link enrollment to existing user
- User can change password on first login

### Decision 14: Company Search and Autocomplete

**Decision**: Implement company search/autocomplete using PostgreSQL full-text search on `raison_sociale` and `siret` fields, with option to create new company.

**Rationale**:
- Prevents duplicate company records
- Improves data quality
- Faster enrollment for repeat companies
- Search helps find existing companies quickly

**Alternatives Considered**:
- No search, always create new: Rejected - creates duplicates, poor data quality
- Exact match only: Rejected - too strict, users may not remember exact name
- Third-party company database: Rejected - adds cost and dependency

**Implementation Notes**:
- Search endpoint: `GET /api/entreprises/rechercher?q={query}`
- Query matches `raison_sociale` (ILIKE) or `siret` (exact match)
- Return: `{ entreprises: [{id, raison_sociale, siret}] }`
- Frontend autocomplete:
  - Debounce search input (300ms)
  - Show suggestions dropdown
  - Allow selection or "Create new" option
- If new company: Show full company form

### Decision 15: Real-Time Session Availability Updates

**Decision**: Implement client-side polling (every 30 seconds) to check session availability during enrollment process, with immediate update if session becomes full.

**Rationale**:
- Prevents enrollment attempts for full sessions
- Real-time updates improve user experience
- 30-second interval balances responsiveness with server load
- Prevents wasted time filling forms for unavailable sessions

**Alternatives Considered**:
- No availability checking: Rejected - users may complete form for full session
- WebSocket updates: Rejected - adds complexity, polling is sufficient
- Server-sent events: Rejected - polling is simpler and sufficient

**Implementation Notes**:
- Poll endpoint: `POST /api/inscriptions-pro/verifier-disponibilite`
- Request: `{ session_id }`
- Response: `{ disponible, places_restantes, message, session }`
- Frontend polling:
  - Start when enrollment form loads
  - Poll every 30 seconds
  - Stop when enrollment submitted or user navigates away
  - Show warning if places < 5
  - Block form submission if session full
- Display availability count in UI

## Integration Patterns

### Payment Provider Webhook Pattern

All payment providers follow similar webhook pattern:
1. Provider sends POST request to webhook URL
2. Verify webhook signature (provider-specific)
3. Extract transaction ID and status
4. Update payment record
5. If payment validated: trigger enrollment confirmation
6. Return 200 OK (or appropriate status)

### Enrollment Confirmation Workflow

When payment is validated:
1. Update payment status to "valide"
2. Update enrollment status to "confirmee"
3. Update session availability (decrement places)
4. Generate invoice PDF
5. Send email confirmation with invoice
6. Send SMS confirmation (if phone available)
7. Notify administrators
8. Log conversion event

## Dependencies and Libraries

- **PDFKit**: PDF generation for invoices
- **Nodemailer**: Email sending
- **Twilio**: SMS sending (or alternative SMS provider)
- **Axios**: HTTP client for payment provider APIs
- **crypto**: Webhook signature verification
- **bcrypt**: Password hashing for auto-created accounts
- **date-fns**: Date formatting and manipulation

## Environment Variables Required

- Payment Provider APIs:
  - `ORANGE_MONEY_API_URL`, `ORANGE_MONEY_CLIENT_ID`, `ORANGE_MONEY_CLIENT_SECRET`, `ORANGE_MONEY_MERCHANT_KEY`
  - `MTN_MONEY_API_URL`, `MTN_MONEY_SUBSCRIPTION_KEY`, `MTN_MONEY_ENV`
  - `WAVE_API_URL`, `WAVE_API_KEY`, `WAVE_WEBHOOK_SECRET`
  - `CINETPAY_API_URL`, `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`
  - `TRESORPAY_API_URL`, `TRESORPAY_API_KEY`, `TRESORPAY_SECRET_KEY`, `TRESORPAY_MERCHANT_ID`, `TRESORPAY_WEBHOOK_SECRET`
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- SMS: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- Application: `APP_URL`, `API_URL` (for webhook URLs and redirects)

## Performance Considerations

- Payment provider API calls: Implement retry logic with exponential backoff
- Webhook processing: Should complete in < 30 seconds (async processing if needed)
- Invoice generation: Should complete in < 60 seconds (consider queue for high volume)
- Email/SMS sending: Should not block enrollment confirmation (async)
- Database queries: Use indexes on `inscription_id`, `session_id`, `numero_transaction`
- Polling: Limit concurrent polls, implement rate limiting

## Security Considerations

- Webhook signature verification: Critical for all providers
- Payment provider API keys: Store in environment variables, never in code
- Payment amounts: Validate match enrollment total before processing
- User input: Sanitize email, phone, SIRET inputs
- Temporary passwords: Generate cryptographically secure random passwords
- Invoice access: Verify user owns enrollment before allowing download
- Rate limiting: Implement on payment initiation and webhook endpoints

