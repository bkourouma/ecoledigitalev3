/**
 * API PUBLIQUE du module `people` — seul point d'import autorisé pour les autres modules.
 *
 *   import { createPeopleDeps, getStudentsByIds, isGuardianOfStudent, createLearnerDirectory } from "../people";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4) ; `deps` vient de
 * `createPeopleDeps({ db, … })`. Les noms ci-dessous sont FIGÉS pour 004, 007, 010, 011, 013, 014, 016, 017, 025, 031 et 032
 * (specs 008 §7 et 009 §7 ; `specs/v2/011-assessments-grades/interfaces-publiees.md`).
 *
 * Aucune fonction de ce module ne renvoie de champ sensible hors `getStudentSensitive` (permission dédiée, lecture auditée).
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as peopleManifest } from "./manifest";

// Plugin Fastify
export { peoplePlugin, default as peopleModulePlugin, registerPeoplePorts, type PeoplePluginOptions } from "./http/plugin";
export { createPeoplePortRegistry, peopleWorkerPorts, resetPeopleWorkerPorts, setPeopleWorkerPorts, type PeoplePortRegistry, type PeoplePortSet } from "./application/port-registry";

// Dépendances et configuration
export { createPeopleDeps, DEFAULT_PEOPLE_CONFIG, inTx as peopleInTx, type PeopleConfig, type PeopleDeps, type PeopleDepsInput } from "./application/deps";

// Ports (consommés) et adaptateurs fournis
export {
  noEnrollmentDirectory,
  noopAudit,
  RecordingAudit,
  type AccountProvisioner,
  type AcademicClassroom,
  type AcademicEnrollment,
  type AcademicNode,
  type AcademicPeriod,
  type AcademicQuery,
  type AuditEntry,
  type AuditPort,
  type CountryProfileProvider,
  type EnrollmentDirectory,
  type InviteInput,
  type StoragePort,
} from "./application/ports";
export { peopleAuditAdapter } from "./infrastructure/audit-adapter";
export { createIamAccountProvisioner, type IamAccountProvisionerOptions, type IamProvisioningLike } from "./infrastructure/iam-account-provisioner";
export { createProjectionEnrollmentDirectory } from "./infrastructure/projection-enrollment-directory";

// Annuaires pour les autres modules
export {
  createLearnerDirectory,
  createStudentDirectory,
  getDisplayNamesOfIdentities,
  type LearnerDirectoryPort,
  type LearnerRefShape,
  type StudentDirectoryPort,
  type StudentRefShape,
} from "./application/directories";

// Résolution de noms par lots (réponse minimale, ids dédoublonnés, `missing` indiscernable, périmètre optionnel)
export {
  dedupeIds,
  getDisplayNamesOfStaff,
  getDisplayNamesOfStudents,
  LOOKUP_MAX_IDS,
  lookupStaff,
  lookupStudents,
  type LookupOptions,
  type LookupResult,
  type LookupScope,
} from "./application/lookup";
// Résolution de références d'élèves d'un fichier (imports 031) : matricule d'origine ou matricule de la plateforme
export { resolveStudentRefs, STUDENT_REFS_MAX, type StudentRefMatch } from "./application/student-refs";
// Audience de la messagerie (016) : comptes joignables d'élèves / tuteurs, recherche par nom (lectures seules)
export {
  AUDIENCE_MAX_STUDENTS,
  listAudienceOfStudents,
  searchAudienceIdentities,
  type AudienceIdentity,
  type IdentityMatch,
  type StudentAudience,
} from "./application/audience";

// Élèves
export {
  addEmergencyContact,
  addPriorEducation,
  anonymizeStudent,
  changeStudentStatus,
  createStudent,
  exportStudents,
  findDuplicateStudents,
  getStatusHistory,
  getStudent,
  getStudentPhotoUrl,
  getStudentSensitive,
  getStudentsByIds,
  listEmergencyContacts,
  listPriorEducation,
  listStudentEnrollments,
  listStudents,
  removeEmergencyContact,
  removePriorEducation,
  removeStudentPhoto,
  searchStudents,
  updateEmergencyContact,
  updatePriorEducation,
  updateStudent,
  uploadStudentPhoto,
  type CreateStudentOutcome,
  type StudentList,
  type StudentScope,
} from "./application/students";

// Tuteurs, liens, accès « enfant » et « moi »
export {
  createGuardian,
  getChildView,
  getGuardian,
  getMyStudent,
  isGuardianOfStudent,
  linkGuardian,
  listChildrenOfIdentity,
  listGuardians,
  listGuardiansOfStudent,
  resolveStudentForIdentity,
  unlinkGuardian,
  updateChildEmergencyContact,
  updateGuardian,
  updateGuardianLink,
  updateMyContact,
  type CreateGuardianOutcome,
} from "./application/guardians";
export { getPersonQualities, linkPersonToIdentity, provisionPortalAccount, type AccountOutcome, type PersonQuality } from "./application/accounts";

// Contrôle d'accès fin
export { classroomsOfCurrentStaff, resolveStaffLookupScope, resolveStudentAudience, resolveStudentListScope, resolveStudentLookupScope, staffCanReadStudent, type PermissionProbe } from "./application/access";

// Personnel
export {
  addContract,
  addQualification,
  changeStaffStatus,
  createStaff,
  emitExpiringQualifications,
  endContract,
  getStaff,
  getStaffByIds,
  getStaffStatusHistory,
  getTeachingLoad,
  listAvailabilities,
  listCompetencies,
  listContracts,
  listExpiringQualifications,
  listQualifications,
  listStaff,
  removeQualification,
  resolveStaffForIdentity,
  setAffiliations,
  setAvailabilities,
  setCompetencies,
  updateContract,
  updateQualification,
  updateStaff,
  type AvailabilityInput,
  type CreateStaffOutcome,
  type StaffBrief,
} from "./application/staff";

// Affectations d'enseignement
export {
  createOfferingReadinessGuard,
  createTeachingAssignment,
  endAssignmentsForScope,
  endTeachingAssignment,
  getResponsibleForNode,
  getTeachingAssignment,
  isStaffAssignedToClassroom,
  listAssignmentsForClassroom,
  listAssignmentsForStaff,
  listClassroomIdsOfStaff,
  listMyClasses,
  listUnstaffedNodes,
  OfferingNotReadyError,
  replaceTeachingAssignment,
  updateTeachingAssignment,
  type AssignmentWarning,
  type CreateAssignmentResult,
  type OfferingReadinessGuard,
  type UnstaffedNode,
} from "./application/teaching";

// Paramètres et référentiels
export {
  getSettings,
  instantiatePeopleReferenceData,
  listContractTypes,
  listRelationshipTypes,
  listStaffCategories,
  updateSettings,
  upsertContractType,
  upsertRelationshipType,
  upsertStaffCategory,
} from "./application/settings";

// Projections (abonnés du worker, exploitation)
export { applyEnrollmentEvent, applyMembershipEvent, getMembershipStatus, rebuildEnrollmentProjection } from "./application/projection";

// Règles de domaine pures réutilisables (tests de contrat des autres modules)
export { isGuardianOfStudentRule, resolveLinkFlags, type GuardianshipFacts, type LinkFlags } from "./domain/guardianship";
export { isActiveOn, isStaffAssigned, listUnstaffedNodes as unstaffedNodesOf, resolveResponsible, type AssignmentFact, type NodeFact, type Responsible } from "./domain/assignments";
export { canTransitionStudent, canTransitionStaff, FINAL_STUDENT_STATUSES } from "./domain/status";
export { formatNumber, validatePattern } from "./domain/number-pattern";
export { normalizePhone, displayName } from "./domain/normalize";
export { PeopleErrors } from "./domain/errors";

// Événements
export { PEOPLE_EVENTS, type PeopleEventType } from "@ecoledigitale/contracts/src/v2/people";
