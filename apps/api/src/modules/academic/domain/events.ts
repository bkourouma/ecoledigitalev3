/**
 * Événements de domaine publiés par academic (outbox transactionnelle, ADR-004). Nommage
 * `academic.<entité>.<verbe-passé>` ; payload JSON versionné `{ v: 1, … }` dont les schémas Zod vivent dans
 * `packages/contracts/src/v2/academic.ts`. On ajoute des champs, on n'en retire jamais sans nouvelle version.
 */
export const AcademicEvents = {
  YEAR_OPENED: "academic.year.opened",
  YEAR_CLOSED: "academic.year.closed",
  YEAR_ARCHIVED: "academic.year.archived",
  PERIOD_OPENED: "academic.period.opened",
  PERIOD_GRADING_CLOSED: "academic.period.grading_closed",
  PERIOD_CLOSED: "academic.period.closed",
  PERIOD_REOPENED: "academic.period.reopened",
  CLASSROOM_PERIOD_GRADING_CLOSED: "academic.classroom_period.grading_closed",
  CLASSROOM_PERIOD_CLOSED: "academic.classroom_period.closed",
  CLASSROOM_PERIOD_REOPENED: "academic.classroom_period.reopened",
  CURRICULUM_PUBLISHED: "academic.curriculum.published",
  CURRICULUM_AMENDED: "academic.curriculum.amended",
  CURRICULUM_LOCKED: "academic.curriculum.locked",
  CLASSROOM_CREATED: "academic.classroom.created",
  CLASSROOM_ACTIVATED: "academic.classroom.activated",
  CLASSROOM_COMPLETED: "academic.classroom.completed",
  CLASSROOM_CANCELLED: "academic.classroom.cancelled",
  OFFERING_OPENED: "academic.offering.opened",
  OFFERING_FULL: "academic.offering.full",
  OFFERING_REOPENED: "academic.offering.reopened",
  OFFERING_STARTED: "academic.offering.started",
  OFFERING_COMPLETED: "academic.offering.completed",
  OFFERING_CANCELLED: "academic.offering.cancelled",
  ENROLLMENT_CREATED: "academic.enrollment.created",
  ENROLLMENT_CONFIRMED: "academic.enrollment.confirmed",
  ENROLLMENT_SUSPENDED: "academic.enrollment.suspended",
  ENROLLMENT_RESUMED: "academic.enrollment.resumed",
  ENROLLMENT_WITHDRAWN: "academic.enrollment.withdrawn",
  ENROLLMENT_CANCELLED: "academic.enrollment.cancelled",
  ENROLLMENT_TRANSFERRED: "academic.enrollment.transferred",
  ENROLLMENT_COMPLETED: "academic.enrollment.completed",
  ENROLLMENT_REOPENED: "academic.enrollment.reopened",
  ENROLLMENT_FUNDING_CHANGED: "academic.enrollment.funding_changed",
  ENROLLMENT_OUTCOME_RECORDED: "academic.enrollment.outcome_recorded",
  COURSE_REQUESTED: "academic.enrollment_course.requested",
  COURSE_CONFIRMED: "academic.enrollment_course.confirmed",
  COURSE_COMPLETED: "academic.enrollment_course.completed",
  COURSE_CANCELLED: "academic.enrollment_course.cancelled",
  COURSE_EXPIRED: "academic.enrollment_course.expired",
  COURSE_PAYMENT_ORPHAN: "academic.enrollment_course.payment_orphan",
  ROLLOVER_COMPLETED: "academic.rollover.completed",
} as const;

export type AcademicEventType = (typeof AcademicEvents)[keyof typeof AcademicEvents];
export const ALL_ACADEMIC_EVENT_TYPES: ReadonlyArray<AcademicEventType> = Object.values(AcademicEvents);

/** Événements consommés (les producteurs sont tenancy, finance, people). */
export const ConsumedEvents = {
  INSTITUTION_CREATED: "tenancy.institution.created",
  INVOICE_PAID: "finance.invoice.paid",
  STUDENT_STATUS_CHANGED: "people.student.status_changed",
} as const;

export const ALL_CONSUMED_EVENT_TYPES: ReadonlyArray<string> = Object.values(ConsumedEvents);

/** Événement d'inscription associé à une action d'état. */
export const ENROLLMENT_ACTION_EVENTS = Object.freeze({
  confirm: AcademicEvents.ENROLLMENT_CONFIRMED,
  suspend: AcademicEvents.ENROLLMENT_SUSPENDED,
  resume: AcademicEvents.ENROLLMENT_RESUMED,
  withdraw: AcademicEvents.ENROLLMENT_WITHDRAWN,
  cancel: AcademicEvents.ENROLLMENT_CANCELLED,
  complete: AcademicEvents.ENROLLMENT_COMPLETED,
  reopen: AcademicEvents.ENROLLMENT_REOPENED,
} as const);

export const OFFERING_STATUS_EVENTS = Object.freeze({
  OPEN: AcademicEvents.OFFERING_OPENED,
  FULL: AcademicEvents.OFFERING_FULL,
  IN_PROGRESS: AcademicEvents.OFFERING_STARTED,
  COMPLETED: AcademicEvents.OFFERING_COMPLETED,
  CANCELLED: AcademicEvents.OFFERING_CANCELLED,
} as const);
