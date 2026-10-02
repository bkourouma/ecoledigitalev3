/**
 * Événements du module "admissions" : noms <module>.<entité>.<verbe-passé>, payload JSON versionné { v: 1, ... }.
 * Les schémas de payload sont dans `packages/contracts/src/v2/admissions.ts` (`ADMISSIONS_EVENT_TYPES` : un test vérifie que
 * les noms sont identiques). AUCUNE donnée personnelle (nom, naissance, contact) dans un événement : identifiants et codes.
 * Domaine pur : aucun import d'infrastructure.
 */
export const AdmissionsEvents = {
  APPLICATION_SUBMITTED: "admissions.application.submitted",
  APPLICATION_STATUS_CHANGED: "admissions.application.status_changed",
  DECISION_RECORDED: "admissions.decision.recorded",
  OFFER_ISSUED: "admissions.offer.issued",
  OFFER_ACCEPTED: "admissions.offer.accepted",
  OFFER_DECLINED: "admissions.offer.declined",
  OFFER_EXPIRED: "admissions.offer.expired",
  OFFER_WITHDRAWN: "admissions.offer.withdrawn",
  APPLICATION_ENROLLED: "admissions.application.enrolled",
  WAITLIST_PROMOTED: "admissions.waitlist.promoted",
  PROSPECT_CONVERTED: "admissions.prospect.converted",
  APPLICATION_ANONYMIZED: "admissions.application.anonymized",
  INTERVIEW_SCHEDULED: "admissions.interview.scheduled",
  INTERVIEW_RESCHEDULED: "admissions.interview.rescheduled",
  INTERVIEW_CANCELLED: "admissions.interview.cancelled",
} as const;

export const ALL_ADMISSIONS_EVENT_TYPES: readonly string[] = Object.values(AdmissionsEvents);

/** Événements d'AUTRES modules consommés (abonnés : `subscribers.ts`). */
export const ConsumedEvents = {
  ENROLLMENT_CONFIRMED: "academic.enrollment.confirmed",
  ENROLLMENT_CANCELLED: "academic.enrollment.cancelled",
  ENROLLMENT_WITHDRAWN: "academic.enrollment.withdrawn",
  INSTITUTION_CREATED: "tenancy.institution.created",
} as const;
