export * from "./auth";
export * from "./entities";
export * from "./tenant";
export * from "./user";
export * from "./common";
export * from "./academic";
export * from "./academic-year";
export * from "./student";
export * from "./assignment";
export * from "./attendance";
export * from "./materials";
export * from "./evaluations";
export * from "./payments";
// export * from "./student-payments"; // Commented out due to conflicting PaymentReportQuery export
export * from "./schedule-generation";
export * from "./classrooms";

// Export des nouveaux contrats pour les tableaux de bord
export * from './student-dashboard';
export * from './teacher-students';
export * from './parent';

// Export des contrats pour le catalogue de formations professionnelles
export * from './formations-pro';

// Export des contrats pour les inscriptions professionnelles
export * from './inscriptions-pro';

// Export des contrats pour les codes promotionnels
export * from './codes-promo';

// Export des contrats pour les paiements professionnels
export * from './paiements-pro';

// Export des contrats pour la gestion des sessions professionnelles
// Note: Some exports are namespaced to avoid conflicts with existing schemas
export {
  SessionListQuerySchema,
  CalendarQuerySchema,
  CreateSessionSchema,
  UpdateSessionSchema,
  SessionProStatusSchema,
  SessionListItemSchema,
  SessionListResponseSchema,
  CalendarEventSchema,
  CalendarResponseSchema,
  AdminSessionListQuerySchema,
  TrainerAvailabilityQuerySchema,
  EnrollmentListQuerySchema,
  UpdateSessionStatusSchema,
  DuplicateSessionSchema,
  EnrollmentStatusSchema,
  PaymentStatusSchema,
  SessionDetailResponseSchema,
  AvailabilityResponseSchema,
  AdminSessionDetailResponseSchema,
  EnrollmentListResponseSchema,
  TrainerAvailabilityResponseSchema,
  UpdateStatusResponseSchema,
  SessionProErrorResponseSchema,
} from './sessions-pro';

export type {
  SessionListItem,
  SessionDetail,
  AdminSessionDetail,
  CalendarEvent,
  CalendarQuery,
  SessionListQuery,
  EnrollmentDetail,
  TrainerAvailabilityItem,
  SessionProStatus,
  EnrollmentStatus,
  PaymentStatus,
  EnrollmentType,
  FormateurRole,
} from './sessions-pro';

// Export des contrats pour la gestion administrative et documents (Phase 6)
export * from './documents';
export * from './entreprises';
export * from './exports';
export * from './reporting';
export * from "./owner.schema";
export * from "./owner-stats.schema";

// Export des contrats du Module Professionnel (Filière → UE → ECUE) — features 028 → 030
export * from "./professional";

// Export des contrats des Diplômes Professionnels (composés d'UE) — features 029 → 030
export * from "./professional-diplomas";

// Signataires configurables des documents officiels (attestations, diplôme)
export * from "./professional-signataires";











