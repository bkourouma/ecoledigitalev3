# Tasks: Inscriptions & Paiements en Ligne - Module Imhotep Data

**Input**: Design documents from `/specs/018-inscriptions-paiements-ligne/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: No automated test tasks included (manual testing and E2E validation recommended)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Backend**: `apps/api/src/routes/`, `apps/api/src/services/`
- **Frontend**: `apps/web/src/app/`, `apps/web/src/components/`
- **Contracts**: `packages/contracts/src/`
- **Migrations**: `infra/scripts/migrations/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependencies, and basic structure

- [x] T001 Install required dependencies: `pdfkit`, `nodemailer`, `twilio` (or SMS provider), `axios` in `apps/api/package.json`
- [x] T002 [P] Create directory structure: `apps/api/src/services/` for payment provider services
- [x] T003 [P] Create directory structure: `apps/api/src/routes/` for enrollment and payment routes
- [x] T004 [P] Create directory structure: `apps/web/src/app/formations-professionnelles/inscription/` for enrollment pages
- [x] T005 [P] Create directory structure: `apps/web/src/components/inscriptions-pro/` for enrollment components
- [x] T006 [P] Create directory structure: `packages/contracts/src/inscriptions-pro/`, `packages/contracts/src/paiements-pro/`, `packages/contracts/src/codes-promo/`
- [x] T007 Configure environment variables template: Add payment provider API keys, SMTP config, SMS config to `.env.example`

**Checkpoint**: Project structure and dependencies ready

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T008 Create database migration for `reservations_temporaires` table in `infra/scripts/migrations/0039_reservations_temporaires.sql` with RLS policies and indexes
- [x] T009 [P] Create database functions: `generate_enrollment_number()` and `generate_invoice_number()` in migration file
- [x] T010 [P] Create base payment provider service interface `PaymentProviderService` in `apps/api/src/services/payment-provider.interface.ts` with common methods (initiatePayment, verifyPayment, handleWebhook)
- [x] T011 [P] Create base email service structure `EmailService` in `apps/api/src/services/email.service.ts` with SMTP configuration
- [x] T012 [P] Create base SMS service structure `SMSService` in `apps/api/src/services/sms.service.ts` with provider configuration
- [x] T013 [P] Create base invoice service structure `InvoiceService` in `apps/api/src/services/invoice.service.ts` with PDFKit setup
- [x] T014 Create background job structure for reservation cleanup in `apps/api/src/jobs/reservation-cleanup.job.ts` (cron or scheduled task)
- [x] T015 Create shared enrollment number generation utility in `apps/api/src/utils/enrollment-number.util.ts`
- [x] T016 Create shared payment transaction number generation utility in `apps/api/src/utils/transaction-number.util.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Individual Enrollment Flow (Priority: P1) 🎯 MVP

**Goal**: Enable individual users to enroll in training sessions by providing personal information, reviewing summary, and proceeding to payment selection

**Independent Test**: Navigate to session detail page, click enroll, complete individual enrollment form with valid information, review summary, reach payment selection step. Verify enrollment created with status 'en_attente' and temporary reservation created.

### Implementation for User Story 1

- [x] T017 [P] [US1] Create Zod schemas for individual enrollment in `packages/contracts/src/inscriptions-pro/inscription.schema.ts`: `IndividualEnrollmentRequestSchema`, `EnrollmentResponseSchema`
- [x] T018 [P] [US1] Create TypeScript types in `packages/contracts/src/inscriptions-pro/types.ts`: `IndividualEnrollmentRequest`, `EnrollmentResponse`, `EnrollmentStatus`
- [x] T019 [P] [US1] Export contracts from `packages/contracts/src/inscriptions-pro/index.ts`
- [x] T020 [US1] Create enrollment service `InscriptionProService` in `apps/api/src/services/inscription-pro.service.ts` with methods: `checkDisponibilite()`, `createIndividualEnrollment()`, `generateEnrollmentNumber()`, `createTemporaryReservation()`
- [x] T021 [US1] Implement user account auto-creation logic in `InscriptionProService.createApprenantAccount()`: generate password, hash with bcrypt, create user and profile, send account creation email
- [x] T022 [US1] Implement session availability checking in `InscriptionProService.checkDisponibilite()`: query session, check places and status, return availability info
- [x] T023 [US1] Implement enrollment creation with transaction in `InscriptionProService.createIndividualEnrollment()`: validate session availability, create/find user, create enrollment record, create temporary reservation, update session places
- [x] T024 [US1] Create API endpoint `POST /api/v1/inscriptions-pro/verifier-disponibilite` in `apps/api/src/routes/inscriptions-pro.ts` with Fastify schema validation
- [x] T025 [US1] Create API endpoint `POST /api/v1/inscriptions-pro/creer` in `apps/api/src/routes/inscriptions-pro.ts` for individual enrollment creation
- [x] T026 [US1] Create enrollment wizard component `InscriptionWizard` in `apps/web/src/components/inscriptions-pro/InscriptionWizard.tsx` with multi-step form state management
- [x] T027 [US1] Create step 1 form component `Step1InfosForm` in `apps/web/src/components/inscriptions-pro/Step1InfosForm.tsx` with individual enrollment fields (civilite, nom, prenom, email, telephone, poste)
- [x] T028 [US1] Create type selector component `TypeInscriptionSelector` in `apps/web/src/components/inscriptions-pro/TypeInscriptionSelector.tsx` with radio buttons for individual/company
- [x] T029 [US1] Create individual form fields component `IndividualFormFields` in `apps/web/src/components/inscriptions-pro/IndividualFormFields.tsx` with validation
- [x] T030 [US1] Create step 2 summary component `Step2RecapitulatifForm` in `apps/web/src/components/inscriptions-pro/Step2RecapitulatifForm.tsx` displaying enrollment summary
- [x] T031 [US1] Create enrollment page `apps/web/src/app/formations-professionnelles/inscription/session/[sessionId]/page.tsx` integrating wizard components
- [x] T032 [US1] Create TanStack Query hooks in `apps/web/src/lib/hooks/use-inscriptions-pro.ts`: `useCheckAvailability()`, `useCreateEnrollment()`
- [x] T033 [US1] Create reservation timer component `ReservationTimer` in `apps/web/src/components/inscriptions-pro/ReservationTimer.tsx` showing 15-minute countdown
- [x] T034 [US1] Create session availability checker component `SessionDisponibiliteChecker` in `apps/web/src/components/inscriptions-pro/SessionDisponibiliteChecker.tsx` polling availability every 30s
- [x] T035 [US1] Add form validation: email format, phone format, required fields in `Step1InfosForm`
- [x] T036 [US1] Add error handling and user-friendly error messages in enrollment flow
- [x] T037 [US1] Add loading states and skeleton loaders during enrollment creation

**Checkpoint**: At this point, User Story 1 should be fully functional - users can complete individual enrollment and reach payment selection step

---

## Phase 4: User Story 2 - Company Enrollment Flow (Priority: P1)

**Goal**: Enable company representatives to enroll employees by providing company and employee information, with company search/autocomplete

**Independent Test**: Select company enrollment, search for existing company or create new, fill employee details, review summary, reach payment. Verify enrollment created with company link.

### Implementation for User Story 2

- [ ] T038 [P] [US2] Create Zod schemas for company enrollment in `packages/contracts/src/inscriptions-pro/inscription.schema.ts`: `CompanyEnrollmentRequestSchema`, `CompanySearchRequestSchema`
- [ ] T039 [P] [US2] Create TypeScript types in `packages/contracts/src/inscriptions-pro/types.ts`: `CompanyEnrollmentRequest`, `CompanyInfo`, `CompanySearchResponse`
- [ ] T040 [US2] Implement company search service method in `InscriptionProService.searchCompanies()`: query by raison_sociale or SIRET, return matching companies
- [ ] T041 [US2] Implement company creation/get logic in `InscriptionProService.createOrGetEntreprise()`: search by SIRET, create if not exists, return company ID
- [ ] T042 [US2] Extend enrollment creation in `InscriptionProService.createEnrollment()` to handle company enrollment type: validate company info, create/get company, link to enrollment
- [ ] T043 [US2] Create API endpoint `GET /api/v1/entreprises/rechercher` in `apps/api/src/routes/inscriptions-pro.ts` for company search with query parameter
- [ ] T044 [US2] Update `POST /api/v1/inscriptions-pro/creer` endpoint to handle company enrollment request body
- [ ] T045 [US2] Create company form fields component `EntrepriseFormFields` in `apps/web/src/components/inscriptions-pro/EntrepriseFormFields.tsx` with company information fields
- [ ] T046 [US2] Create company autocomplete component `EntrepriseAutocomplete` in `apps/web/src/components/inscriptions-pro/EntrepriseAutocomplete.tsx` with debounced search, suggestions dropdown, "Create new" option
- [ ] T047 [US2] Update `Step1InfosForm` to conditionally show company fields when company enrollment selected
- [ ] T048 [US2] Create TanStack Query hook `useSearchCompanies()` in `apps/web/src/lib/hooks/use-inscriptions-pro.ts` for company search
- [ ] T049 [US2] Update `Step2RecapitulatifForm` to display company information when company enrollment
- [ ] T050 [US2] Add SIRET validation and formatting in `EntrepriseFormFields`
- [ ] T051 [US2] Add company form validation: required fields, email format, phone format

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - individual and company enrollments functional

---

## Phase 5: User Story 3 - Promotional Code Application (Priority: P2)

**Goal**: Enable users to apply promotional codes during enrollment to receive discounts (percentage or fixed amount)

**Independent Test**: Enter valid promotional code on summary step, verify discount calculated correctly, price updates. Enter invalid code, verify error message. Test percentage and fixed amount discounts.

### Implementation for User Story 3

- [X] T052 [P] [US3] Create Zod schemas for promotional code validation in `packages/contracts/src/codes-promo/code-promo.schema.ts`: `PromoCodeValidationRequestSchema`, `PromoCodeValidationResponseSchema`
- [X] T053 [P] [US3] Create TypeScript types in `packages/contracts/src/codes-promo/types.ts`: `PromoCodeValidationRequest`, `PromoCodeValidationResponse`, `PromoCodeType`
- [X] T054 [P] [US3] Export contracts from `packages/contracts/src/codes-promo/index.ts`
- [X] T055 [US3] Create promotional code service `CodePromoService` in `apps/api/src/services/code-promo.service.ts` with methods: `validateCode()`, `calculateDiscount()`, `incrementUsage()`
- [X] T056 [US3] Implement code validation in `CodePromoService.validateCode()`: check active status, validity dates, usage limits, training applicability
- [X] T057 [US3] Implement discount calculation in `CodePromoService.calculateDiscount()`: handle percentage and fixed amount types, ensure discount doesn't exceed amount
- [X] T058 [US3] Create API endpoint `POST /api/v1/codes-promo/valider` in `apps/api/src/routes/codes-promo.ts` with Fastify schema validation
- [X] T059 [US3] Update `InscriptionProService.createEnrollment()` to validate and apply promotional code if provided
- [X] T060 [US3] Create promotional code input component `CodePromoInput` in `apps/web/src/components/inscriptions-pro/CodePromoInput.tsx` with input field, validate button, success/error messages
- [X] T061 [US3] Integrate `CodePromoInput` into `Step2RecapitulatifForm` with discount display
- [X] T062 [US3] Create TanStack Query hook `useValidatePromoCode()` in `apps/web/src/lib/hooks/use-inscriptions-pro.ts` for code validation
- [X] T063 [US3] Update enrollment summary to show discount breakdown when code applied
- [X] T064 [US3] Add code validation error messages: expired, already used, not applicable, invalid code

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should work - promotional codes can be applied during enrollment

---

## Phase 6: User Story 4 - Payment Method Selection and Processing (Priority: P1)

**Goal**: Enable users to select payment method and initiate payment through selected provider (Orange Money, MTN Money, Wave, Bank Card, TresorPay)

**Independent Test**: Select payment method, provide required info (phone for mobile money), initiate payment, verify payment record created, receive instructions or redirect. Test all 5 payment methods.

### Implementation for User Story 4

- [X] T065 [P] [US4] Create Zod schemas for payment initiation in `packages/contracts/src/paiements-pro/paiement.schema.ts`: `PaymentInitiationRequestSchema`, `PaymentInitiationResponseSchema`
- [X] T066 [P] [US4] Create TypeScript types in `packages/contracts/src/paiements-pro/types.ts`: `PaymentInitiationRequest`, `PaymentInitiationResponse`, `PaymentMethod`, `PaymentStatus`
- [X] T067 [P] [US4] Export contracts from `packages/contracts/src/paiements-pro/index.ts`
- [X] T068 [US4] Create payment service `PaiementProService` in `apps/api/src/services/paiement-pro.service.ts` with methods: `initiatePayment()`, `generateTransactionNumber()`, `validatePaymentAmount()`
- [X] T069 [US4] Create Orange Money service `OrangeMoneyService` in `apps/api/src/services/orange-money.service.ts` implementing `PaymentProviderService` interface: OAuth token, payment initiation, webhook handling
- [X] T070 [US4] Create MTN Money service `MTNMoneyService` in `apps/api/src/services/mtn-money.service.ts` implementing `PaymentProviderService` interface: Request to Pay, status checking, webhook handling
- [X] T071 [US4] Create Wave service `WaveService` in `apps/api/src/services/wave.service.ts` implementing `PaymentProviderService` interface: checkout session creation, QR code generation, webhook handling
- [X] T072 [US4] Create bank card service `CarteBancaireService` in `apps/api/src/services/carte-bancaire.service.ts` implementing `PaymentProviderService` interface: CinetPay integration, redirect URL generation
- [X] T073 [US4] Create or extend TresorPay service `TresorPayService` in `apps/api/src/services/tresorpay.service.ts` (may reuse existing) implementing `PaymentProviderService` interface
- [X] T074 [US4] Implement payment initiation in `PaiementProService.initiatePayment()`: validate enrollment, validate amount, generate transaction number, call provider service, create payment record
- [X] T075 [US4] Create API endpoint `POST /api/v1/paiements-pro/initier` in `apps/api/src/routes/paiements-pro.ts` with Fastify schema validation
- [X] T076 [US4] Create payment selection page `apps/web/src/app/formations-professionnelles/inscription/paiement/[inscriptionId]/page.tsx` with payment method selector
- [X] T077 [US4] Create payment method selector component `PaymentMethodSelector` in `apps/web/src/components/inscriptions-pro/PaymentMethodSelector.tsx` with cards for each method (Orange Money, MTN Money, Wave, Bank Card, TresorPay)
- [X] T078 [US4] Create payment details form component `PaymentDetailsForm` in `apps/web/src/components/inscriptions-pro/PaymentDetailsForm.tsx` with conditional fields (phone for mobile money)
- [X] T079 [US4] Create payment recap card component `PaymentRecapCard` in `apps/web/src/components/inscriptions-pro/PaymentRecapCard.tsx` showing enrollment summary and amount
- [X] T080 [US4] Create payment processing modal component `PaymentProcessingModal` in `apps/web/src/components/inscriptions-pro/PaymentProcessingModal.tsx` showing loading state and instructions
- [X] T081 [US4] Create TanStack Query hook `useInitiatePayment()` in `apps/web/src/lib/hooks/use-inscriptions-pro.ts` for payment initiation
- [X] T082 [US4] Implement payment method-specific UI: show phone input for mobile money, redirect message for bank card, QR code display for Wave
- [X] T083 [US4] Add payment amount validation: must match enrollment total
- [X] T084 [US4] Add phone number validation for mobile money methods: format validation, operator detection
- [X] T085 [US4] Handle payment initiation responses: redirect for bank card/TresorPay, show instructions for mobile money, show QR code for Wave

**Checkpoint**: At this point, User Stories 1-4 should work - users can complete enrollment and initiate payment through any method

---

## Phase 7: User Story 5 - Payment Status Verification and Webhooks (Priority: P1)

**Goal**: Automatically verify payment status from providers via webhooks and polling, update enrollment status, trigger confirmation workflow

**Independent Test**: Simulate payment provider webhook, verify payment status updated, enrollment confirmed, session availability updated, notifications sent. Test polling for mobile money payments.

### Implementation for User Story 5

- [X] T086 [US5] Implement webhook signature verification in each payment provider service: `OrangeMoneyService.verifySignature()`, `MTNMoneyService.verifySignature()`, `WaveService.verifySignature()`, `CarteBancaireService.verifySignature()`, `TresorPayService.verifySignature()`
- [X] T087 [US5] Implement webhook handling in each provider service: `OrangeMoneyService.handleWebhook()`, `MTNMoneyService.handleWebhook()`, `WaveService.handleWebhook()`, `CarteBancaireService.handleWebhook()`, `TresorPayService.handleWebhook()`
- [X] T088 [US5] Create webhook route `POST /api/paiements-pro/webhook/:provider` in `apps/api/src/routes/paiements-pro.ts` with provider-specific handlers
- [X] T089 [US5] Implement payment status update logic in `PaiementProService.updatePaymentStatus()`: update payment record, trigger enrollment confirmation if validated, handle failures
- [X] T090 [US5] Implement enrollment confirmation workflow in `PaiementProService.onPaymentValidated()`: update enrollment status, update session availability, generate invoice, send notifications
- [X] T091 [US5] Create payment status polling endpoint `GET /api/v1/paiements-pro/:id/statut` in `apps/api/src/routes/paiements-pro.ts`
- [X] T092 [US5] Implement payment verification endpoint `POST /api/v1/paiements-pro/:id/verifier` in `apps/api/src/routes/paiements-pro.ts` for manual status checks
- [X] T093 [US5] Create payment callback page `apps/web/src/app/formations-professionnelles/inscription/callback/[provider]/page.tsx` for handling provider redirects
- [X] T094 [US5] Create TanStack Query hook `usePaymentStatus()` in `apps/web/src/lib/hooks/use-inscriptions-pro.ts` for polling payment status
- [X] T095 [US5] Implement client-side polling logic: poll every 5 seconds, timeout after 5 minutes, stop when payment validated or failed
- [X] T096 [US5] Update `PaymentProcessingModal` to show polling status and instructions (USSD codes, QR codes)
- [X] T097 [US5] Handle webhook idempotency: prevent duplicate processing of same webhook
- [X] T098 [US5] Add webhook logging: log all webhook events for debugging
- [X] T099 [US5] Implement error handling for webhook failures: retry logic, error notifications

**Checkpoint**: At this point, User Stories 1-5 should work - payments are automatically verified and enrollments confirmed

---

## Phase 8: User Story 6 - Enrollment Confirmation and Invoice Delivery (Priority: P1)

**Goal**: Display enrollment confirmation page with details, generate and deliver invoice PDF, send email/SMS confirmations

**Independent Test**: Complete enrollment and payment, verify confirmation page displays all details, download invoice PDF, verify email received with invoice attachment, verify SMS received.

### Implementation for User Story 6

- [X] T100 [US6] Implement invoice PDF generation in `InvoiceService.generateInvoice()`: create PDF with company branding, enrollment details, pricing breakdown, payment information using PDFKit
- [X] T101 [US6] Implement invoice number generation in `InvoiceService.generateInvoiceNumber()`: format FACT-YYYY-NNNN
- [X] T102 [US6] Save generated invoice PDF to file storage (MinIO/S3) and store URL in enrollment record
- [X] T103 [US6] Create API endpoint `GET /api/v1/inscriptions-pro/:id/facture` in `apps/api/src/routes/inscriptions-pro.ts` returning PDF stream
- [X] T104 [US6] Create API endpoint `GET /api/v1/inscriptions-pro/:id/confirmation` in `apps/api/src/routes/inscriptions-pro.ts` returning enrollment confirmation data
- [X] T105 [US6] Implement email template for enrollment confirmation in `EmailService.sendEnrollmentConfirmation()`: HTML template with enrollment details, invoice attachment
- [X] T106 [US6] Implement SMS confirmation in `SMSService.sendConfirmation()`: short message with enrollment number and key details
- [X] T107 [US6] Integrate email and SMS sending into enrollment confirmation workflow: send after payment validated
- [X] T108 [US6] Create confirmation page `apps/web/src/app/formations-professionnelles/inscription/confirmation/[inscriptionId]/page.tsx` displaying success message and enrollment details
- [X] T109 [US6] Create confirmation header component `SuccessHeader` in `apps/web/src/components/inscriptions-pro/SuccessHeader.tsx` with animated checkmark and success message
- [X] T110 [US6] Create enrollment recap card component `InscriptionRecapCard` in `apps/web/src/components/inscriptions-pro/InscriptionRecapCard.tsx` showing complete enrollment information
- [X] T111 [US6] Create next steps card component `NextStepsCard` in `apps/web/src/components/inscriptions-pro/NextStepsCard.tsx` showing upcoming steps and information
- [X] T112 [US6] Add invoice download button in confirmation page: download PDF on click
- [X] T113 [US6] Create TanStack Query hook `useEnrollmentConfirmation()` in `apps/web/src/lib/hooks/use-inscriptions-pro.ts` for fetching confirmation data
- [X] T114 [US6] Add confetti animation on confirmation page load (optional enhancement)
- [X] T115 [US6] Handle email/SMS delivery failures gracefully: log errors, don't block enrollment confirmation

**Checkpoint**: At this point, User Stories 1-6 should work - complete enrollment-to-confirmation flow with invoice delivery

---

## Phase 9: User Story 7 - View Enrollment History (Priority: P2)

**Goal**: Enable logged-in users to view their enrollment history with filtering, access invoices, and manage enrollments

**Independent Test**: Log in, navigate to enrollment history, view list of enrollments, filter by status/date, view details, download invoices. Verify only user's own enrollments are shown.

### Implementation for User Story 7

- [X] T116 [P] [US7] Create Zod schemas for enrollment history in `packages/contracts/src/inscriptions-pro/inscription-api.schema.ts`: `EnrollmentHistoryQuerySchema`, `EnrollmentHistoryResponseSchema`
- [X] T117 [US7] Create API endpoint `GET /api/v1/mon-compte/inscriptions-pro` in `apps/api/src/routes/inscriptions-pro.ts` with filtering (status, date range, search), pagination, scoped to authenticated user
- [X] T118 [US7] Implement enrollment history query in `InscriptionProService.getUserEnrollments()`: join with sessions and formations, filter by user ID, apply filters, paginate
- [X] T119 [US7] Create enrollment history page `apps/web/src/app/formations-professionnelles/mon-compte/inscriptions/page.tsx` with list and filters
- [X] T120 [US7] Create enrollment history list component `MesInscriptionsPro` in `apps/web/src/components/inscriptions-pro/MesInscriptionsPro.tsx` displaying enrollment cards
- [X] T121 [US7] Create enrollment card component `InscriptionCard` in `apps/web/src/components/inscriptions-pro/InscriptionCard.tsx` showing enrollment summary with status badge
- [X] T122 [US7] Create enrollment filters component `InscriptionFilters` in `apps/web/src/components/inscriptions-pro/InscriptionFilters.tsx` with status dropdown, date range picker, search input
- [X] T123 [US7] Create TanStack Query hook `useEnrollmentHistory()` in `apps/web/src/lib/hooks/use-inscriptions-pro.ts` with filtering and pagination
- [X] T124 [US7] Add enrollment detail modal or page: show complete enrollment information when "View Details" clicked
- [X] T125 [US7] Add invoice download functionality in enrollment history: download button for confirmed enrollments
- [X] T126 [US7] Add "Complete Payment" button for pending enrollments: redirect to payment page
- [X] T127 [US7] Add empty state when no enrollments found
- [X] T128 [US7] Add pagination controls for enrollment history list

**Checkpoint**: At this point, User Stories 1-7 should work - users can view and manage their enrollment history

---

## Phase 10: User Story 8 - Enrollment Cancellation (Priority: P2)

**Goal**: Enable users to cancel enrollments before session start, with refund processing for paid enrollments

**Independent Test**: Cancel pending enrollment, verify status updated, place released. Cancel confirmed enrollment, verify refund initiated, email sent. Attempt to cancel started session, verify prevention.

### Implementation for User Story 8

- [ ] T129 [US8] Implement enrollment cancellation logic in `InscriptionProService.cancelInscription()`: validate cancellation allowed (session not started), update enrollment status, release session place, initiate refund if payment made
- [ ] T130 [US8] Implement refund initiation in `PaiementProService.initiateRefund()`: mark payment for refund, notify admin for manual processing
- [ ] T131 [US8] Create API endpoint `PATCH /api/v1/inscriptions-pro/:id/annuler` in `apps/api/src/routes/inscriptions-pro.ts` with validation (user owns enrollment, session not started)
- [ ] T132 [US8] Implement cancellation email template in `EmailService.sendCancellationConfirmation()`: confirmation message, refund information if applicable
- [ ] T133 [US8] Add cancellation button in enrollment history: show for pending/confirmed enrollments, confirm dialog before cancellation
- [ ] T134 [US8] Add cancellation confirmation dialog: ask user to confirm, show consequences (place release, refund info)
- [ ] T135 [US8] Update `InscriptionCard` to show cancellation option with appropriate conditions
- [ ] T136 [US8] Create TanStack Query hook `useCancelEnrollment()` in `apps/web/src/lib/hooks/use-inscriptions-pro.ts` for cancellation mutation
- [ ] T137 [US8] Add validation: prevent cancellation if session already started (check session date_debut)
- [ ] T138 [US8] Add cancellation success notification and update enrollment list
- [ ] T139 [US8] Handle cancellation errors: display user-friendly messages

**Checkpoint**: At this point, all User Stories 1-8 should work - complete enrollment management lifecycle

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, background jobs, error handling, performance

- [ ] T140 [P] Implement background job for reservation cleanup in `apps/api/src/jobs/reservation-cleanup.job.ts`: find expired reservations, cancel enrollments, release places (run every 5 minutes)
- [ ] T141 [P] Add comprehensive error handling across all enrollment and payment endpoints: user-friendly messages, proper HTTP status codes
- [ ] T142 [P] Add logging for all enrollment and payment operations: enrollment creation, payment initiation, webhook processing, status changes
- [ ] T143 [P] Add rate limiting on payment initiation endpoints to prevent abuse
- [ ] T144 [P] Add database indexes for performance: `idx_inscriptions_professionnelles_date_inscription`, `idx_paiements_professionnels_reference_externe`, `idx_entreprises_clientes_raison_sociale_fts`
- [ ] T145 [P] Add transaction management for enrollment creation: ensure atomicity of enrollment + reservation + session update
- [ ] T146 [P] Add concurrent enrollment prevention: use database row locking (`SELECT ... FOR UPDATE`) to prevent double-booking
- [ ] T147 [P] Add retry logic for payment provider API calls: exponential backoff for failures
- [ ] T148 [P] Add webhook idempotency: prevent duplicate webhook processing using transaction IDs
- [ ] T149 [P] Add email template improvements: professional HTML templates for all email types
- [ ] T150 [P] Add SMS template improvements: concise, informative messages
- [ ] T151 [P] Add invoice template improvements: company branding, professional layout
- [ ] T152 [P] Add loading states and skeleton loaders across all enrollment and payment pages
- [ ] T153 [P] Add accessibility improvements: ARIA labels, keyboard navigation, screen reader support
- [ ] T154 [P] Add responsive design improvements: mobile-friendly enrollment forms and payment pages
- [ ] T155 [P] Add analytics/logging for enrollment conversions: track enrollment completion rates, payment success rates
- [ ] T156 [P] Validate quickstart.md examples: ensure all API examples work correctly
- [ ] T157 [P] Add environment variable documentation: document all required payment provider API keys, SMTP config, SMS config

**Checkpoint**: All polish tasks complete - feature is production-ready

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - **BLOCKS all user stories**
- **User Stories (Phase 3-10)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed) OR sequentially in priority order (P1 → P2)
  - **P1 Stories (US1, US2, US4, US5, US6)**: Can start immediately after Foundational
  - **P2 Stories (US3, US7, US8)**: Can start after Foundational, may integrate with P1 stories but independently testable
- **Polish (Phase 11)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational - Shares enrollment service with US1 but independently testable
- **User Story 3 (P2)**: Can start after Foundational - Integrates with US1/US2 enrollment flow but independently testable
- **User Story 4 (P1)**: Depends on US1/US2 (needs enrollment to exist) - Can start after US1 complete
- **User Story 5 (P1)**: Depends on US4 (needs payment initiation) - Can start after US4 complete
- **User Story 6 (P1)**: Depends on US5 (needs payment validation) - Can start after US5 complete
- **User Story 7 (P2)**: Can start after Foundational - Depends on enrollment creation (US1/US2) but independently testable
- **User Story 8 (P2)**: Depends on US1/US2/US4 (needs enrollments and payments) - Can start after US4 complete

### Within Each User Story

- Contracts (Zod schemas, types) before services
- Services before API endpoints
- API endpoints before frontend components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes:
  - **US1 and US2 can start in parallel** (both P1, independent)
  - **US3 can start in parallel with US1/US2** (P2, integrates but independent)
  - **US4 must wait for US1/US2** (needs enrollment)
  - **US5 must wait for US4** (needs payment initiation)
  - **US6 must wait for US5** (needs payment validation)
  - **US7 can start after US1/US2** (needs enrollments)
  - **US8 must wait for US4** (needs payments)
- Contracts within a story marked [P] can run in parallel
- Payment provider services (T069-T073) can be implemented in parallel
- Polish tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all contract tasks for User Story 1 together:
Task T017: "Create Zod schemas for individual enrollment"
Task T018: "Create TypeScript types"
Task T019: "Export contracts"

# Launch all frontend components for User Story 1 together (after services):
Task T026: "Create enrollment wizard component"
Task T027: "Create step 1 form component"
Task T028: "Create type selector component"
Task T029: "Create individual form fields component"
Task T030: "Create step 2 summary component"
```

---

## Parallel Example: Payment Provider Services

```bash
# Launch all payment provider service implementations together:
Task T069: "Create Orange Money service"
Task T070: "Create MTN Money service"
Task T071: "Create Wave service"
Task T072: "Create bank card service"
Task T073: "Create TresorPay service"
```

---

## Implementation Strategy

### MVP First (User Stories 1, 2, 4, 5, 6 Only - P1 Stories)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (**CRITICAL - blocks all stories**)
3. Complete Phase 3: User Story 1 (Individual Enrollment)
4. Complete Phase 4: User Story 2 (Company Enrollment)
5. Complete Phase 6: User Story 4 (Payment Selection)
6. Complete Phase 7: User Story 5 (Payment Verification)
7. Complete Phase 8: User Story 6 (Confirmation & Invoice)
8. **STOP and VALIDATE**: Test complete enrollment-to-payment flow independently
9. Deploy/demo if ready

**MVP delivers**: Complete enrollment and payment processing for individual and company enrollments with all payment methods, automatic confirmation, and invoice delivery.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (Basic enrollment)
3. Add User Story 2 → Test independently → Deploy/Demo (Company enrollment)
4. Add User Story 4 → Test independently → Deploy/Demo (Payment initiation)
5. Add User Story 5 → Test independently → Deploy/Demo (Payment verification)
6. Add User Story 6 → Test independently → Deploy/Demo (Confirmation & invoice)
7. Add User Story 3 → Test independently → Deploy/Demo (Promotional codes)
8. Add User Story 7 → Test independently → Deploy/Demo (Enrollment history)
9. Add User Story 8 → Test independently → Deploy/Demo (Cancellation)
10. Add Polish tasks → Production-ready

### Parallel Team Strategy

With multiple developers:

1. **Team completes Setup + Foundational together**
2. **Once Foundational is done:**
   - Developer A: User Story 1 (Individual Enrollment)
   - Developer B: User Story 2 (Company Enrollment) - can start in parallel with A
   - Developer C: Payment Provider Services (T069-T073) - can start in parallel
3. **After US1/US2 complete:**
   - Developer A: User Story 4 (Payment Selection)
   - Developer B: User Story 3 (Promotional Codes) - can start in parallel
   - Developer C: User Story 7 (Enrollment History) - can start in parallel
4. **After US4 complete:**
   - Developer A: User Story 5 (Payment Verification)
   - Developer B: User Story 6 (Confirmation) - can start after US5
   - Developer C: User Story 8 (Cancellation) - can start after US4
5. **All developers**: Polish tasks in parallel

---

## Task Summary

- **Total Tasks**: 157
- **Setup Tasks**: 7 (T001-T007)
- **Foundational Tasks**: 9 (T008-T016)
- **User Story 1 Tasks**: 21 (T017-T037)
- **User Story 2 Tasks**: 14 (T038-T051)
- **User Story 3 Tasks**: 13 (T052-T064)
- **User Story 4 Tasks**: 21 (T065-T085)
- **User Story 5 Tasks**: 14 (T086-T099)
- **User Story 6 Tasks**: 16 (T100-T115)
- **User Story 7 Tasks**: 13 (T116-T128)
- **User Story 8 Tasks**: 11 (T129-T139)
- **Polish Tasks**: 18 (T140-T157)

### Parallel Opportunities Identified

- **Phase 1**: 6 parallel tasks (T002-T007)
- **Phase 2**: 7 parallel tasks (T009-T016)
- **User Story 1**: 3 parallel contract tasks (T017-T019), 5 parallel component tasks (T026-T030)
- **User Story 2**: 2 parallel contract tasks (T038-T039)
- **User Story 3**: 3 parallel contract tasks (T052-T054)
- **User Story 4**: 2 parallel contract tasks (T065-T066), 5 parallel payment provider services (T069-T073)
- **User Story 7**: 1 parallel contract task (T116)
- **Phase 11**: 18 parallel polish tasks (T140-T157)

### Independent Test Criteria

- **US1**: Navigate to session, complete individual enrollment form, reach payment selection
- **US2**: Select company enrollment, search/create company, complete enrollment, reach payment
- **US3**: Enter promotional code, verify discount calculated, price updates
- **US4**: Select payment method, initiate payment, receive instructions/redirect
- **US5**: Simulate webhook, verify payment status updated, enrollment confirmed
- **US6**: Complete enrollment, verify confirmation page, download invoice, receive email/SMS
- **US7**: View enrollment history, filter enrollments, access invoices
- **US8**: Cancel enrollment, verify status updated, place released, refund initiated

### Suggested MVP Scope

**MVP = User Stories 1, 2, 4, 5, 6 (P1 stories only)**
- Individual and company enrollment
- Payment method selection and processing
- Payment verification and webhooks
- Enrollment confirmation and invoice delivery

This delivers a complete, production-ready enrollment-to-payment flow. User Stories 3, 7, 8 (P2) can be added incrementally.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Payment provider credentials must be configured in environment variables before testing
- Webhook endpoints must be publicly accessible for payment providers to send notifications
- Background job for reservation cleanup must be scheduled (cron or task scheduler)

