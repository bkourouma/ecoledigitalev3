# Feature Specification: Parent Payments & Finances

**Feature Branch**: `009-parent-payments`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "Payments & finances (/payments) - Payment history, Tuition installments, Payment schedules, Outstanding balances, Receipts, Payment methods"

## Clarifications

### Session 2025-01-27

- Q: Should parents be able to view payments for all their children or filter by specific child? → A: Parents should be able to view payments for all their children with filtering capability by child
- Q: What time period should payment history display by default? → A: Payment history should show the current academic year by default, with ability to filter by date range or semester
- Q: Should outstanding balances include all fee types or be filterable by fee type? → A: Outstanding balances should show all fee types by default, with ability to filter by specific fee type (tuition, inscription, annexes, autres)
- Q: How should payment schedules be displayed - as a calendar or as a list? → A: Payment schedules should be displayed as a list showing upcoming installments with due dates, sorted by due date
- Q: Should receipts be downloadable or viewable only? → A: Receipts should be downloadable as PDF files and viewable in the browser
- Q: Should parents be able to add or modify payment methods? → A: Parents should be able to view their saved payment methods, but adding or modifying payment methods may require separate functionality (out of scope for this feature)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Payment History (Priority: P1) 🎯 MVP

A parent logs into the system and navigates to the payments section. They see a list of all payment transactions for their children with detailed information. Each payment displays the transaction date, child name, fee type (tuition, inscription, annexes, autres), amount, payment method, status (completed, pending, failed), and receipt availability. Parents can filter by child, fee type, date range, and payment status to focus on specific payments.

**Why this priority**: This is the entry point for all payments functionality. Parents need immediate visibility into their payment history to track financial transactions. It provides immediate value by showing parents what payments have been made and when.

**Independent Test**: Can be fully tested by logging in as a parent user and navigating to `/parent/payments` route. The page should display all payment transactions for linked children, showing transaction details and status. This delivers value by giving parents visibility into their payment history.

**Acceptance Scenarios**:

1. **Given** a parent is logged in with multiple children linked to their account, **When** they navigate to `/parent/payments`, **Then** they see a list of all payment transactions for all their children with transaction date, child name, fee type, amount, payment method, status, and receipt availability
2. **Given** a parent is viewing payment history, **When** they filter by a specific child, **Then** only payments for that child are displayed
3. **Given** a parent is viewing payment history, **When** they filter by a specific fee type, **Then** only payments for that fee type are displayed
4. **Given** a parent is viewing payment history, **When** they filter by a date range, **Then** only payments within that date range are displayed
5. **Given** a parent is viewing payment history, **When** they filter by payment status, **Then** only payments with that status are displayed
6. **Given** a parent has no payment transactions, **When** they navigate to `/parent/payments`, **Then** they see an empty state indicating no payments are available

---

### User Story 2 - View Tuition Installments (Priority: P1)

A parent views tuition installments for their children. The view displays each installment with installment number, installment label, due date, amount, status (pending, paid, overdue), amount paid, and late fees (if applicable). Parents can filter by child to see installments for a specific child, or view all children's installments together. Installments are sorted by due date (soonest first).

**Why this priority**: Tuition installments are a critical financial obligation for parents. Providing visibility into upcoming and past installments helps parents plan payments and avoid late fees. This provides immediate value by showing parents what installments are due and when.

**Independent Test**: Can be fully tested by navigating to the tuition installments view. The system should display all tuition installments for linked children, showing installment details and status. This delivers value by helping parents track their tuition payment obligations.

**Acceptance Scenarios**:

1. **Given** a parent is viewing tuition installments, **When** they look at the list, **Then** they see all installments for their children with installment number, installment label, due date, amount, status, amount paid, and late fees (if applicable)
2. **Given** a parent is viewing tuition installments, **When** they filter by a specific child, **Then** only installments for that child are displayed
3. **Given** a parent is viewing tuition installments, **When** they look at the list, **Then** installments are sorted by due date (soonest first)
4. **Given** a child has an installment that is overdue, **When** a parent views that installment, **Then** it is marked with an overdue status and shows late fees if applicable
5. **Given** a child has an installment that is fully paid, **When** a parent views that installment, **Then** it is marked with a paid status and shows the amount paid
6. **Given** a child has no tuition installments, **When** a parent views tuition installments, **Then** they see an empty state indicating no installments are available

---

### User Story 3 - View Payment Schedules (Priority: P2)

A parent views payment schedules for their children's tuition. The view displays the payment schedule with schedule name, academic year, total tuition amount, number of installments, installment amounts, and due dates. Parents can filter by child to see schedules for a specific child, or view all children's schedules together.

**Why this priority**: While individual installments provide detailed information, payment schedules give parents a high-level view of their tuition payment obligations. This helps parents understand the overall payment structure and plan accordingly.

**Independent Test**: Can be fully tested by navigating to the payment schedules view. The system should display payment schedules for linked children, showing schedule details and installment information. This delivers value by helping parents understand their payment structure.

**Acceptance Scenarios**:

1. **Given** a parent is viewing payment schedules, **When** they look at a schedule, **Then** they see schedule name, academic year, total tuition amount, number of installments, installment amounts, and due dates
2. **Given** a parent is viewing payment schedules, **When** they filter by a specific child, **Then** only schedules for that child are displayed
3. **Given** a child has multiple payment schedules (e.g., different academic years), **When** a parent views payment schedules, **Then** all schedules are displayed with clear academic year identification
4. **Given** a child has no payment schedules, **When** a parent views payment schedules, **Then** they see an empty state indicating no schedules are available

---

### User Story 4 - View Outstanding Balances (Priority: P2)

A parent views outstanding balances for their children. The view displays outstanding balances by fee type (tuition, inscription, annexes, autres), showing total outstanding amount, amount paid, and amount due for each fee type. Parents can filter by child to see balances for a specific child, or view aggregated balances for all children. Outstanding balances are calculated from unpaid installments and fees.

**Why this priority**: Outstanding balances help parents understand what they owe and prioritize payments. This provides immediate value by showing parents their financial obligations at a glance.

**Independent Test**: Can be fully tested by navigating to the outstanding balances view. The system should calculate and display outstanding balances for linked children, showing balances by fee type. This delivers value by helping parents understand their financial obligations.

**Acceptance Scenarios**:

1. **Given** a parent is viewing outstanding balances, **When** they look at the balances, **Then** they see outstanding amounts by fee type (tuition, inscription, annexes, autres) with total outstanding, amount paid, and amount due for each fee type
2. **Given** a parent is viewing outstanding balances, **When** they filter by a specific child, **Then** only balances for that child are displayed
3. **Given** a parent is viewing outstanding balances, **When** they have multiple children, **Then** they can see aggregated balances for all children or filter to view one child's balances
4. **Given** a child has no outstanding balances, **When** a parent views outstanding balances, **Then** they see a message indicating all fees are paid
5. **Given** a child has outstanding balances, **When** a parent views outstanding balances, **Then** the balances are calculated correctly from unpaid installments and fees

---

### User Story 5 - View Receipts (Priority: P2)

A parent views payment receipts for their children's payments. The view displays a list of receipts with receipt number, payment date, child name, fee type, amount, payment method, and download/view capability. Parents can filter by child, fee type, and date range to find specific receipts. Receipts can be viewed in the browser or downloaded as PDF files.

**Why this priority**: Receipts are important for record-keeping and tax purposes. Providing easy access to receipts helps parents maintain their financial records. This provides immediate value by giving parents access to their payment documentation.

**Independent Test**: Can be fully tested by navigating to the receipts view. The system should display all receipts for linked children, showing receipt details and download/view capability. This delivers value by helping parents access their payment documentation.

**Acceptance Scenarios**:

1. **Given** a parent is viewing receipts, **When** they look at the list, **Then** they see all receipts with receipt number, payment date, child name, fee type, amount, payment method, and download/view buttons
2. **Given** a parent is viewing receipts, **When** they filter by a specific child, **Then** only receipts for that child are displayed
3. **Given** a parent is viewing receipts, **When** they filter by fee type or date range, **Then** only receipts matching the filter are displayed
4. **Given** a parent is viewing a receipt, **When** they click the view button, **Then** the receipt opens in the browser for viewing
5. **Given** a parent is viewing a receipt, **When** they click the download button, **Then** the receipt is downloaded as a PDF file
6. **Given** a parent has no receipts, **When** they view receipts, **Then** they see an empty state indicating no receipts are available

---

### User Story 6 - View Payment Methods (Priority: P3)

A parent views their saved payment methods for making payments. The view displays payment methods with method type (card, bank transfer, mobile money, etc.), last 4 digits (for cards), expiration date (for cards), and default status. Parents can see which payment methods are available but cannot add or modify payment methods through this feature (requires separate functionality).

**Why this priority**: While viewing payment methods is useful for understanding available payment options, it is less critical than viewing payment history and outstanding balances. This provides value by showing parents their payment options.

**Independent Test**: Can be fully tested by navigating to the payment methods view. The system should display saved payment methods for the parent account. This delivers value by showing parents their available payment options.

**Acceptance Scenarios**:

1. **Given** a parent is viewing payment methods, **When** they look at the list, **Then** they see all saved payment methods with method type, last 4 digits (for cards), expiration date (for cards), and default status
2. **Given** a parent has no saved payment methods, **When** they view payment methods, **Then** they see an empty state indicating no payment methods are saved
3. **Given** a parent has multiple payment methods, **When** they view payment methods, **Then** the default payment method is clearly indicated

---

### Edge Cases

- How does the system handle payments that are partially refunded or cancelled?
- What happens when a payment transaction fails after being marked as completed?
- How does the system handle outstanding balances when a child transfers or withdraws mid-semester?
- What happens when payment schedules change after installments have been generated?
- How does the system handle currency conversions for international payments?
- What happens when a receipt is requested for a payment that doesn't have a receipt generated yet?
- How does the system handle late fees that are added after an installment is due?
- What happens when a parent has multiple children with different payment schedules?
- How does the system handle payments made outside the system (e.g., cash payments recorded manually)?
- What happens when a payment method expires or is no longer valid?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a list of all payment transactions for all children linked to the authenticated parent user account
- **FR-002**: System MUST show each payment transaction with transaction date, child name, fee type, amount, payment method, status, and receipt availability
- **FR-003**: System MUST allow parents to filter payment history by child, fee type, date range, and payment status
- **FR-004**: System MUST display tuition installments with installment number, installment label, due date, amount, status, amount paid, and late fees (if applicable)
- **FR-005**: System MUST allow parents to filter tuition installments by child
- **FR-006**: System MUST sort tuition installments by due date (soonest first)
- **FR-007**: System MUST display payment schedules with schedule name, academic year, total tuition amount, number of installments, installment amounts, and due dates
- **FR-008**: System MUST allow parents to filter payment schedules by child
- **FR-009**: System MUST display outstanding balances by fee type (tuition, inscription, annexes, autres) with total outstanding, amount paid, and amount due
- **FR-010**: System MUST allow parents to filter outstanding balances by child and fee type
- **FR-011**: System MUST calculate outstanding balances correctly from unpaid installments and fees
- **FR-012**: System MUST display payment receipts with receipt number, payment date, child name, fee type, amount, payment method, and download/view capability
- **FR-013**: System MUST allow parents to filter receipts by child, fee type, and date range
- **FR-014**: System MUST allow parents to view receipts in the browser
- **FR-015**: System MUST allow parents to download receipts as PDF files
- **FR-016**: System MUST display payment methods with method type, last 4 digits (for cards), expiration date (for cards), and default status
- **FR-017**: System MUST only display information for children linked to the authenticated parent user (enforce data access control)
- **FR-018**: System MUST handle empty states gracefully when no data is available (no payments, no installments, no schedules, no balances, no receipts, no payment methods)
- **FR-019**: System MUST display appropriate messaging when a child has no data in any section
- **FR-020**: System MUST support filtering and aggregation across multiple children when a parent has multiple children

### Key Entities *(include if feature involves data)*

- **Payment Transaction**: Represents a payment transaction for a student. Key attributes include transaction ID, student ID, enrollment ID, tuition installment ID, fee type, amount, currency, payment method, status, receipt URL, transaction date. Relationship: linked to parent through parent-child relationship and child's enrollment.

- **Tuition Installment**: Represents a tuition installment for a student. Key attributes include installment ID, student ID, enrollment ID, schedule ID, installment number, installment label, amount, due date, status, amount paid, late fees. Relationship: linked to parent through parent-child relationship and child's enrollment.

- **Payment Schedule**: Represents a payment schedule for tuition. Key attributes include schedule ID, student ID, enrollment ID, schedule name, academic year, total tuition amount, number of installments, installment amounts, due dates. Relationship: linked to parent through parent-child relationship and child's enrollment.

- **Outstanding Balance**: Represents outstanding balances for a student. Key attributes include student ID, fee type, total outstanding, amount paid, amount due. Relationship: aggregated from payment transactions and tuition installments.

- **Payment Receipt**: Represents a payment receipt for a transaction. Key attributes include receipt ID, transaction ID, receipt number, payment date, child name, fee type, amount, payment method, receipt URL. Relationship: linked to payment transaction.

- **Payment Method**: Represents a saved payment method for a parent. Key attributes include method ID, parent ID, method type, last 4 digits (for cards), expiration date (for cards), default status. Relationship: linked to parent user account.

- **Parent-Child Relationship**: Represents the link between a parent user account and a student profile. Key attributes include relationship type (parent, guardian, emergency contact), primary contact status. Relationship: enables parent access to child's payment data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Parents can view their complete payment history within 2 seconds of navigating to `/parent/payments` route
- **SC-002**: Parents can filter payment history by child, fee type, date range, or payment status within 1 second of applying filter
- **SC-003**: Parents can view tuition installments with all details displayed correctly
- **SC-004**: Parents can view payment schedules with schedule information displayed correctly
- **SC-005**: Parents can view outstanding balances with balances calculated correctly within 2 seconds
- **SC-006**: Parents can filter outstanding balances by child or fee type within 1 second
- **SC-007**: Parents can view receipts and download them as PDF files within 3 seconds
- **SC-008**: Parents can filter receipts by child, fee type, or date range within 1 second
- **SC-009**: Parents can view payment methods with method details displayed correctly
- **SC-010**: System displays appropriate empty states in 100% of cases where no data is available
- **SC-011**: Parents can only access payment information for children explicitly linked to their account (100% data access control enforcement)
- **SC-012**: Outstanding balances are calculated correctly based on unpaid installments and fees
- **SC-013**: Payment history displays correctly even when payments span multiple academic years or semesters

## Assumptions

- Parent-child relationships are already established in the system through the parent-student relationship management
- Children are enrolled in classes through the existing enrollment system
- Payment transactions and tuition installments are already being tracked and stored in the system
- Payment schedules are already generated and stored in the system
- Receipts are already generated and stored in the system
- Payment methods are already stored in the system (if applicable)
- Parents have access to the system through authenticated user accounts
- The system supports multiple children per parent account
- Payment data includes all necessary information for calculations (amounts, dates, statuses, etc.)
- All data access is properly secured to ensure parents can only view information for their own linked children
- The system supports different fee types (tuition, inscription, annexes, autres) and payment methods (card, bank transfer, mobile money, etc.)
- Outstanding balances can be calculated from unpaid installments and fees stored in the system
