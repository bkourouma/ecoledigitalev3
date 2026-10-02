/**
 * Contrats du module `people` (routes `/api/v1/people/*`) : dossier permanent des élèves et étudiants, tuteurs,
 * personnel, affectations d'enseignement (specs 008 et 009). Écrits avant les routes (ADR-001 règle 6) ; le client
 * web est typé à partir de ces schémas.
 *
 * Conventions :
 *  - DATES calendaires `AAAA-MM-JJ` ; instants ISO 8601 UTC (`...Z`). IDENTIFIANTS : UUID.
 *  - ENTRÉES `strict()` : un champ inconnu est refusé (jamais ignoré en silence). Une PATCH accepte `null` pour
 *    EFFACER un champ facultatif ; l'absence du champ le laisse intact.
 *  - AUCUNE valeur par défaut de sexe (le legacy « masculin » était une donnée fausse).
 *  - Les sorties de LISTE ne portent jamais de champ sensible (`national_student_id`, pièce d'état civil,
 *    `attributes`) : ceux-ci ne sortent que par `GET /students/:id/sensitive` (permission dédiée, lecture auditée).
 *  - Aucune donnée personnelle (date de naissance, téléphone, e-mail) dans les événements ni les journaux.
 *  - Valeurs d'énumération en anglais, libellés en français.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const peopleUuidSchema = z.string().uuid();
export const peopleDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const instant = z.string().datetime({ offset: true });
export const peopleCountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Code pays ISO 3166-1 alpha-2 attendu (ex. CI).");
export const peopleSexSchema = z.enum(["M", "F"]);
export const peopleCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/, "Code en majuscules, chiffres et « _ » (40 max).");

const text = (max: number) => z.string().trim().min(1).max(max);
const email = z.string().trim().toLowerCase().email("Adresse e-mail invalide.").max(320);
const phone = z.string().trim().min(5, "Téléphone trop court.").max(40, "Téléphone trop long.");
const boolQuery = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());

export const peopleIdParamsSchema = z.object({ id: peopleUuidSchema }).strict();
export const peoplePageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Codes d'erreur stables du module (contrat d'API). */
export const PEOPLE_ERROR_CODES = [
  "people.student_not_found",
  "people.guardian_not_found",
  "people.staff_not_found",
  "people.person_not_found",
  "people.link_not_found",
  "people.assignment_not_found",
  "people.possible_duplicate",
  "people.sex_required",
  "people.birth_date_implausible",
  "people.invalid_transition",
  "people.reason_required",
  "people.person_already_student",
  "people.person_already_guardian",
  "people.person_already_staff",
  "people.primary_guardian_conflict",
  "people.link_exists",
  "people.link_closed",
  "people.relationship_unknown",
  "people.relationship_not_guardian",
  "people.category_unknown",
  "people.category_forbidden_to_teach",
  "people.assignment_staff_not_active",
  "people.assignment_conflict",
  "people.assignment_closed",
  "people.assignment_invalid",
  "people.teaching_staff_missing",
  "people.contract_type_unknown",
  "people.node_transversal",
  "people.node_not_in_classroom",
  "people.period_outside_year",
  "people.classroom_not_found",
  "people.academic_unavailable",
  "people.contract_overlap",
  "people.contract_not_found",
  "people.qualification_not_found",
  "people.account_provisioning_unavailable",
  "people.account_exists",
  "people.account_email_required",
  "people.identity_unknown",
  "people.identity_already_linked",
  "people.storage_unavailable",
  "people.invalid_image",
  "people.retention_not_configured",
  "people.retention_not_elapsed",
  "people.not_archived",
  "people.already_anonymized",
  "people.export_too_large",
  "people.external_ref_conflict",
  "people.national_id_conflict",
  "people.number_pattern_invalid",
  "people.reference_in_use",
] as const;
export type PeopleErrorCode = (typeof PEOPLE_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Énumérations
// ---------------------------------------------------------------------------

export const PEOPLE_STUDENT_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED", "WITHDRAWN", "TRANSFERRED_OUT", "EXCLUDED", "ARCHIVED"] as const;
export const peopleStudentStatusSchema = z.enum(PEOPLE_STUDENT_STATUSES);
export type PeopleStudentStatus = z.infer<typeof peopleStudentStatusSchema>;

export const PEOPLE_STAFF_STATUSES = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "LEFT"] as const;
export const peopleStaffStatusSchema = z.enum(PEOPLE_STAFF_STATUSES);
export type PeopleStaffStatus = z.infer<typeof peopleStaffStatusSchema>;

export const PEOPLE_RELATIONSHIP_KINDS = ["GUARDIAN", "EMERGENCY", "OTHER"] as const;
export const peopleRelationshipKindSchema = z.enum(PEOPLE_RELATIONSHIP_KINDS);

export const PEOPLE_ASSIGNMENT_ROLES = ["LEAD", "CO_TEACHER", "HOMEROOM", "SUBSTITUTE", "SUPERVISOR"] as const;
export const peopleAssignmentRoleSchema = z.enum(PEOPLE_ASSIGNMENT_ROLES);
export type PeopleAssignmentRole = z.infer<typeof peopleAssignmentRoleSchema>;

export const peopleAssignmentStatusSchema = z.enum(["ACTIVE", "ENDED", "CANCELLED"]);
export const peopleContractKindSchema = z.enum(["PERMANENT", "FIXED_TERM", "CASUAL", "OTHER"]);
export const peopleContractStatusSchema = z.enum(["DRAFT", "ACTIVE", "ENDED", "CANCELLED"]);
export const peopleQualificationKindSchema = z.enum(["DIPLOMA", "CERTIFICATION", "AUTHORIZATION", "OTHER"]);
export const peoplePriorEducationKindSchema = z.enum(["SCHOOL", "DIPLOMA", "CERTIFICATE", "OTHER"]);
export const peopleAvailabilityKindSchema = z.enum(["AVAILABLE", "UNAVAILABLE"]);

/** Niveau d'accès avec lequel une fiche a été restituée (information pour l'écran). */
export const peopleAccessLevelSchema = z.enum(["FULL", "CLASS", "SELF", "GUARDIAN"]);

// ---------------------------------------------------------------------------
// Personne (état civil commun)
// ---------------------------------------------------------------------------

/** Identité saisie. `sex` n'a AUCUNE valeur par défaut ; il est exigé à la création d'un élève. */
export const peoplePersonInputSchema = z
  .object({
    lastName: text(120),
    firstName: text(120),
    otherNames: text(200).optional(),
    sex: peopleSexSchema.optional(),
    birthDate: peopleDateSchema.optional(),
    birthPlace: text(160).optional(),
    nationality: peopleCountryCodeSchema.optional(),
    email: email.optional(),
    phone: phone.optional(),
    phoneAlt: phone.optional(),
    addressLine: text(300).optional(),
    city: text(120).optional(),
    residence: text(200).optional(),
  })
  .strict();
export type PeoplePersonInput = z.infer<typeof peoplePersonInputSchema>;

/** Champs modifiables d'une personne (PATCH) ; `null` efface un champ facultatif. */
export const peoplePersonPatchSchema = z
  .object({
    lastName: text(120).optional(),
    firstName: text(120).optional(),
    otherNames: text(200).nullable().optional(),
    sex: peopleSexSchema.nullable().optional(),
    birthDate: peopleDateSchema.nullable().optional(),
    birthPlace: text(160).nullable().optional(),
    nationality: peopleCountryCodeSchema.nullable().optional(),
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    phoneAlt: phone.nullable().optional(),
    addressLine: text(300).nullable().optional(),
    city: text(120).nullable().optional(),
    residence: text(200).nullable().optional(),
  })
  .strict();
export type PeoplePersonPatch = z.infer<typeof peoplePersonPatchSchema>;

/** Coordonnées qu'un tuteur, un élève ou un membre du personnel peut modifier lui-même (jamais l'identité). */
export const peopleOwnContactPatchSchema = z
  .object({
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    phoneAlt: phone.nullable().optional(),
    addressLine: text(300).nullable().optional(),
    city: text(120).nullable().optional(),
    residence: text(200).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune coordonnée à modifier.");
export type PeopleOwnContactPatch = z.infer<typeof peopleOwnContactPatchSchema>;

const attributesSchema = z.record(z.unknown()).refine((v) => JSON.stringify(v).length <= 20_000, "Attributs trop volumineux.");

// ---------------------------------------------------------------------------
// Doublons
// ---------------------------------------------------------------------------

export const peopleDuplicateQuerySchema = z.object({
  lastName: text(120),
  firstName: text(120),
  birthDate: peopleDateSchema.optional(),
});

export const peopleDuplicateCandidateDtoSchema = z.object({
  personId: peopleUuidSchema,
  displayName: z.string(),
  birthDate: peopleDateSchema.nullable(),
  /** `EXACT` : même nom (permutation admise) et même date ; `NEAR` : fautes de frappe ; `NAME_ONLY` : une date manque. */
  match: z.enum(["EXACT", "NEAR", "NAME_ONLY", "EMAIL", "PHONE"]),
  /** Rôles visibles pour l'acteur (filtrés par ses permissions). */
  roles: z.array(z.enum(["STUDENT", "GUARDIAN", "STAFF"])),
  studentId: peopleUuidSchema.nullable(),
  studentNumber: z.string().nullable(),
});
export type PeopleDuplicateCandidateDto = z.infer<typeof peopleDuplicateCandidateDtoSchema>;

const duplicateAckSchema = {
  acknowledgeDuplicate: z.boolean().optional(),
  duplicateReason: text(500).optional(),
};

// ---------------------------------------------------------------------------
// Élèves
// ---------------------------------------------------------------------------

export const peopleCreateStudentBodySchema = z
  .object({
    /** Identité d'une NOUVELLE personne (sexe obligatoire). Exclusif avec `personId`. */
    person: peoplePersonInputSchema.optional(),
    /** Réutilise une personne existante (ex. un tuteur qui devient élève) ; exclusif avec `person`. */
    personId: peopleUuidSchema.optional(),
    /** Sexe à poser quand `personId` désigne une personne dont le sexe est inconnu. */
    sex: peopleSexSchema.optional(),
    nationalStudentId: text(60).optional(),
    birthCertificateNumber: text(80).optional(),
    birthCertificateDate: peopleDateSchema.optional(),
    civilRegistryOffice: text(160).optional(),
    attributes: attributesSchema.optional(),
    externalRef: text(120).optional(),
    /** Valide sans écrire (import 031) : renvoie les erreurs par champ et les doublons. */
    validateOnly: z.boolean().optional(),
    ...duplicateAckSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.person && !v.personId) ctx.addIssue({ code: "custom", path: ["person"], message: "Identité (person) ou personne existante (personId) requise." });
    if (v.person && v.personId) ctx.addIssue({ code: "custom", path: ["personId"], message: "person et personId sont exclusifs." });
    if (v.person && !v.person.sex) ctx.addIssue({ code: "custom", path: ["person", "sex"], message: "Le sexe est obligatoire pour un élève.", params: { code: "people.sex_required" } });
    if (v.acknowledgeDuplicate && !v.duplicateReason) ctx.addIssue({ code: "custom", path: ["duplicateReason"], message: "Un motif est requis pour confirmer un doublon possible." });
  });
export type PeopleCreateStudentBody = z.infer<typeof peopleCreateStudentBodySchema>;

export const peopleUpdateStudentBodySchema = z
  .object({
    person: peoplePersonPatchSchema.optional(),
    nationalStudentId: text(60).nullable().optional(),
    birthCertificateNumber: text(80).nullable().optional(),
    birthCertificateDate: peopleDateSchema.nullable().optional(),
    civilRegistryOffice: text(160).nullable().optional(),
    attributes: attributesSchema.optional(),
    externalRef: text(120).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export type PeopleUpdateStudentBody = z.infer<typeof peopleUpdateStudentBodySchema>;

export const peopleChangeStatusBodySchema = z
  .object({
    status: peopleStudentStatusSchema,
    reasonCode: text(60).optional(),
    reasonText: text(1000).optional(),
    effectiveOn: peopleDateSchema.optional(),
  })
  .strict();
export type PeopleChangeStatusBody = z.infer<typeof peopleChangeStatusBodySchema>;

export const peopleAnonymizeBodySchema = z.object({ reason: text(500) }).strict();

export const peopleListStudentsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: peopleStudentStatusSchema.optional(),
  includeArchived: boolQuery.optional(),
  classroomId: peopleUuidSchema.optional(),
  academicYearId: peopleUuidSchema.optional(),
  institutionId: peopleUuidSchema.optional(),
  programId: peopleUuidSchema.optional(),
  enrollmentStatus: z.string().trim().max(30).optional(),
  guardianId: peopleUuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PeopleListStudentsQuery = z.infer<typeof peopleListStudentsQuerySchema>;

export const peopleCurrentEnrollmentDtoSchema = z.object({
  enrollmentId: peopleUuidSchema,
  academicYearId: peopleUuidSchema,
  institutionId: peopleUuidSchema,
  classroomId: peopleUuidSchema,
  classroomName: z.string().nullable(),
  status: z.string(),
  registrationNumber: z.string().nullable(),
});
export type PeopleCurrentEnrollmentDto = z.infer<typeof peopleCurrentEnrollmentDtoSchema>;

/** Résumé : AUCUN champ sensible (listes, annuaires par lots). */
export const peopleStudentSummaryDtoSchema = z.object({
  id: peopleUuidSchema,
  personId: peopleUuidSchema,
  studentNumber: z.string(),
  sequenceNumber: z.number().int(),
  lastName: z.string(),
  firstName: z.string(),
  displayName: z.string(),
  sex: peopleSexSchema.nullable(),
  status: peopleStudentStatusSchema,
  hasPhoto: z.boolean(),
  currentEnrollment: peopleCurrentEnrollmentDtoSchema.nullable(),
});
export type PeopleStudentSummaryDto = z.infer<typeof peopleStudentSummaryDtoSchema>;

export const peopleStudentListDtoSchema = z.object({
  items: z.array(peopleStudentSummaryDtoSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const peoplePrimaryGuardianDtoSchema = z.object({
  guardianId: peopleUuidSchema,
  displayName: z.string(),
  relationshipCode: z.string(),
  phone: z.string().nullable(),
});

/**
 * Fiche d'un élève SANS champs sensibles. `access` dit avec quel niveau elle est restituée : `CLASS` (enseignant de la
 * classe) masque adresse, lieu de naissance, e-mail et téléphone de l'élève ; `GUARDIAN` masque le téléphone du tuteur
 * principal et l'e-mail des tiers.
 */
export const peopleStudentDetailDtoSchema = peopleStudentSummaryDtoSchema.extend({
  access: peopleAccessLevelSchema,
  otherNames: z.string().nullable(),
  birthDate: peopleDateSchema.nullable(),
  birthPlace: z.string().nullable(),
  nationality: peopleCountryCodeSchema.nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  phoneAlt: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  residence: z.string().nullable(),
  firstEnrolledOn: peopleDateSchema.nullable(),
  leftOn: peopleDateSchema.nullable(),
  primaryGuardian: peoplePrimaryGuardianDtoSchema.nullable(),
  /** État du compte de portail de l'élève : `NONE` (aucun), `active`, `suspended`… */
  portalAccount: z.string(),
  externalRef: z.string().nullable(),
  createdAt: instant,
  updatedAt: instant,
});
export type PeopleStudentDetailDto = z.infer<typeof peopleStudentDetailDtoSchema>;

export const peopleCreateStudentResultDtoSchema = z.object({
  student: peopleStudentDetailDtoSchema,
  /** `true` si `externalRef` désignait déjà un dossier : rien n'a été créé (idempotence). */
  replayed: z.boolean(),
});

export const peopleValidateStudentResultDtoSchema = z.object({
  valid: z.literal(true),
  duplicates: z.array(peopleDuplicateCandidateDtoSchema),
});

export const peopleStudentSensitiveDtoSchema = z.object({
  studentId: peopleUuidSchema,
  nationalStudentId: z.string().nullable(),
  birthCertificateNumber: z.string().nullable(),
  birthCertificateDate: peopleDateSchema.nullable(),
  civilRegistryOffice: z.string().nullable(),
  attributes: z.record(z.unknown()),
});
export type PeopleStudentSensitiveDto = z.infer<typeof peopleStudentSensitiveDtoSchema>;

// ---------------------------------------------------------------------------
// Pièces de l'élève (stockage objet, type réel contrôlé par octets magiques, URL signées, lectures auditées)
// ---------------------------------------------------------------------------

export const PEOPLE_STUDENT_DOCUMENT_TYPES = ["ID_CARD", "BIRTH_CERTIFICATE", "MEDICAL_CERTIFICATE", "PRIOR_REPORT", "TRANSFER_CERTIFICATE", "PHOTO_ID", "OTHER"] as const;
export const peopleStudentDocumentTypeSchema = z.enum(PEOPLE_STUDENT_DOCUMENT_TYPES);
export type PeopleStudentDocumentType = z.infer<typeof peopleStudentDocumentTypeSchema>;

export const PEOPLE_DOCUMENT_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const PEOPLE_DOCUMENT_STATUSES = ["ACTIVE", "REPLACED", "REMOVED"] as const;
/** État d'échéance DÉRIVÉ à la lecture : `NO_EXPIRY`, `VALID`, `EXPIRING` (dans le préavis du tenant), `EXPIRED`. */
export const PEOPLE_DOCUMENT_EXPIRY_STATES = ["NO_EXPIRY", "VALID", "EXPIRING", "EXPIRED"] as const;

export const peopleStudentDocumentDtoSchema = z.object({
  id: peopleUuidSchema,
  studentId: peopleUuidSchema,
  typeCode: peopleStudentDocumentTypeSchema,
  title: z.string().nullable(),
  fileName: z.string(),
  contentType: z.enum(PEOPLE_DOCUMENT_CONTENT_TYPES),
  sizeBytes: z.number().int().positive(),
  sha256: z.string(),
  version: z.number().int().positive(),
  supersedesId: peopleUuidSchema.nullable(),
  status: z.enum(PEOPLE_DOCUMENT_STATUSES),
  issuedOn: peopleDateSchema.nullable(),
  expiresOn: peopleDateSchema.nullable(),
  expiryState: z.enum(PEOPLE_DOCUMENT_EXPIRY_STATES),
  /** Jours restants avant l'échéance (négatif : échue) ; `null` sans date d'expiration. */
  daysLeft: z.number().int().nullable(),
  uploadedBy: peopleUuidSchema.nullable(),
  uploadedAt: instant,
  replacedAt: instant.nullable(),
  removedAt: instant.nullable(),
  removedReason: z.string().nullable(),
});
export type PeopleStudentDocumentDto = z.infer<typeof peopleStudentDocumentDtoSchema>;

/** Métadonnées du dépôt : le FICHIER est le corps binaire de la requête (`PUT`), jamais un champ JSON. */
export const peopleUploadStudentDocumentQuerySchema = z
  .object({
    typeCode: peopleStudentDocumentTypeSchema,
    fileName: text(200),
    title: text(200).optional(),
    issuedOn: peopleDateSchema.optional(),
    expiresOn: peopleDateSchema.optional(),
  })
  .strict()
  .refine((q) => !q.issuedOn || !q.expiresOn || q.expiresOn >= q.issuedOn, { message: "L'expiration précède la date d'émission.", path: ["expiresOn"] });
export type PeopleUploadStudentDocumentQuery = z.infer<typeof peopleUploadStudentDocumentQuerySchema>;

/** Remplacement : même métadonnées, le type est celui de la pièce remplacée. */
export const peopleReplaceStudentDocumentQuerySchema = z
  .object({
    fileName: text(200),
    title: text(200).optional(),
    issuedOn: peopleDateSchema.optional(),
    expiresOn: peopleDateSchema.optional(),
  })
  .strict()
  .refine((q) => !q.issuedOn || !q.expiresOn || q.expiresOn >= q.issuedOn, { message: "L'expiration précède la date d'émission.", path: ["expiresOn"] });
export type PeopleReplaceStudentDocumentQuery = z.infer<typeof peopleReplaceStudentDocumentQuerySchema>;

export const peopleUpdateStudentDocumentBodySchema = z
  .object({ title: text(200).nullable().optional(), issuedOn: peopleDateSchema.nullable().optional(), expiresOn: peopleDateSchema.nullable().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification.");
export type PeopleUpdateStudentDocumentBody = z.infer<typeof peopleUpdateStudentDocumentBodySchema>;

export const peopleRemoveStudentDocumentBodySchema = z.object({ reason: z.string().trim().min(5, "Motif de 5 caractères minimum.").max(500) }).strict();
export type PeopleRemoveStudentDocumentBody = z.infer<typeof peopleRemoveStudentDocumentBodySchema>;

export const peopleListStudentDocumentsQuerySchema = z
  .object({
    /** `true` : y compris les versions remplacées et les pièces retirées (historique). */
    includeHistory: z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional(),
    expiry: z.enum(["EXPIRING", "EXPIRED"]).optional(),
  })
  .strict();
export type PeopleListStudentDocumentsQuery = z.infer<typeof peopleListStudentDocumentsQuerySchema>;

export const peopleStudentDocumentUrlDtoSchema = z.object({
  url: z.string(),
  expiresInSec: z.number().int().positive(),
  fileName: z.string(),
  contentType: z.enum(PEOPLE_DOCUMENT_CONTENT_TYPES),
});
export type PeopleStudentDocumentUrlDto = z.infer<typeof peopleStudentDocumentUrlDtoSchema>;

export const peopleStatusHistoryDtoSchema = z.object({
  id: peopleUuidSchema,
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  effectiveOn: peopleDateSchema,
  changedBy: peopleUuidSchema.nullable(),
  changedAt: instant,
});
export type PeopleStatusHistoryDto = z.infer<typeof peopleStatusHistoryDtoSchema>;

export const peopleStudentEnrollmentDtoSchema = z.object({
  enrollmentId: peopleUuidSchema,
  academicYearId: peopleUuidSchema,
  institutionId: peopleUuidSchema,
  classroomId: peopleUuidSchema,
  classroomName: z.string().nullable(),
  programLabel: z.string().nullable(),
  gradeLevelLabel: z.string().nullable(),
  mode: z.string(),
  status: z.string(),
  fundingType: z.string(),
  registrationNumber: z.string().nullable(),
  enrolledOn: peopleDateSchema,
});

// --- contacts d'urgence -----------------------------------------------------

export const peopleEmergencyContactBodySchema = z
  .object({
    contactName: text(160),
    relationshipLabel: text(80).optional(),
    phone,
    phoneAlt: phone.optional(),
    email: email.optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export const peopleEmergencyContactPatchSchema = z
  .object({
    contactName: text(160).optional(),
    relationshipLabel: text(80).nullable().optional(),
    phone: phone.optional(),
    phoneAlt: phone.nullable().optional(),
    email: email.nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export const peopleEmergencyContactDtoSchema = z.object({
  id: peopleUuidSchema,
  studentId: peopleUuidSchema,
  contactName: z.string(),
  relationshipLabel: z.string().nullable(),
  phone: z.string(),
  phoneAlt: z.string().nullable(),
  email: z.string().nullable(),
  priority: z.number().int(),
});
export type PeopleEmergencyContactDto = z.infer<typeof peopleEmergencyContactDtoSchema>;

// --- historique scolaire d'entrée ------------------------------------------

export const peoplePriorEducationBodySchema = z
  .object({
    kind: peoplePriorEducationKindSchema,
    label: text(200),
    institutionName: text(200).optional(),
    schoolYear: text(20).optional(),
    levelLabel: text(120).optional(),
    seriesLabel: text(120).optional(),
    obtainedOn: peopleDateSchema.optional(),
    referenceNumber: text(80).optional(),
    note: text(1000).optional(),
  })
  .strict();
export const peoplePriorEducationPatchSchema = z
  .object({
    kind: peoplePriorEducationKindSchema.optional(),
    label: text(200).optional(),
    institutionName: text(200).nullable().optional(),
    schoolYear: text(20).nullable().optional(),
    levelLabel: text(120).nullable().optional(),
    seriesLabel: text(120).nullable().optional(),
    obtainedOn: peopleDateSchema.nullable().optional(),
    referenceNumber: text(80).nullable().optional(),
    note: text(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export const peoplePriorEducationDtoSchema = z.object({
  id: peopleUuidSchema,
  studentId: peopleUuidSchema,
  kind: peoplePriorEducationKindSchema,
  label: z.string(),
  institutionName: z.string().nullable(),
  schoolYear: z.string().nullable(),
  levelLabel: z.string().nullable(),
  seriesLabel: z.string().nullable(),
  obtainedOn: peopleDateSchema.nullable(),
  /** Numéro de diplôme / attestation : donnée sensible, renvoyé seulement avec `student.sensitive.read`. */
  referenceNumber: z.string().nullable(),
  hasAttachment: z.boolean(),
  note: z.string().nullable(),
});
export type PeoplePriorEducationDto = z.infer<typeof peoplePriorEducationDtoSchema>;

// ---------------------------------------------------------------------------
// Tuteurs et liens
// ---------------------------------------------------------------------------

export const peopleCreateGuardianBodySchema = z
  .object({
    person: peoplePersonInputSchema.optional(),
    personId: peopleUuidSchema.optional(),
    occupation: text(160).optional(),
    employer: text(160).optional(),
    ...duplicateAckSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.person && !v.personId) ctx.addIssue({ code: "custom", path: ["person"], message: "Identité (person) ou personne existante (personId) requise." });
    if (v.person && v.personId) ctx.addIssue({ code: "custom", path: ["personId"], message: "person et personId sont exclusifs." });
    if (v.acknowledgeDuplicate && !v.duplicateReason) ctx.addIssue({ code: "custom", path: ["duplicateReason"], message: "Un motif est requis pour confirmer un doublon possible." });
  });
export type PeopleCreateGuardianBody = z.infer<typeof peopleCreateGuardianBodySchema>;

export const peopleUpdateGuardianBodySchema = z
  .object({
    person: peoplePersonPatchSchema.optional(),
    occupation: text(160).nullable().optional(),
    employer: text(160).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");

export const peopleListGuardiansQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  studentId: peopleUuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Drapeaux d'un lien ; valeurs par défaut PRUDENTES (`canPickup` et `hasLegalCustody` à faux). */
const linkFlags = {
  isPrimaryContact: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
  isFinancialResponsible: z.boolean().optional(),
  hasLegalCustody: z.boolean().optional(),
  canPickup: z.boolean().optional(),
  portalAccess: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
};

export const peopleLinkGuardianBodySchema = z
  .object({ guardianId: peopleUuidSchema, relationshipCode: peopleCodeSchema, ...linkFlags, validFrom: peopleDateSchema.optional(), notes: text(500).optional() })
  .strict();
export type PeopleLinkGuardianBody = z.infer<typeof peopleLinkGuardianBodySchema>;

export const peopleUpdateLinkBodySchema = z
  .object({ relationshipCode: peopleCodeSchema.optional(), ...linkFlags, notes: text(500).nullable().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export type PeopleUpdateLinkBody = z.infer<typeof peopleUpdateLinkBodySchema>;

export const peopleUnlinkBodySchema = z.object({ effectiveOn: peopleDateSchema.optional(), reason: text(500).optional() }).strict();

export const peopleGuardianLinkDtoSchema = z.object({
  id: peopleUuidSchema,
  studentId: peopleUuidSchema,
  guardianId: peopleUuidSchema,
  relationshipCode: z.string(),
  relationshipKind: peopleRelationshipKindSchema,
  isPrimaryContact: z.boolean(),
  isEmergencyContact: z.boolean(),
  isFinancialResponsible: z.boolean(),
  hasLegalCustody: z.boolean(),
  canPickup: z.boolean(),
  portalAccess: z.boolean(),
  priority: z.number().int(),
  validFrom: peopleDateSchema,
  validTo: peopleDateSchema.nullable(),
  notes: z.string().nullable(),
});
export type PeopleGuardianLinkDto = z.infer<typeof peopleGuardianLinkDtoSchema>;

export const peopleGuardianDtoSchema = z.object({
  id: peopleUuidSchema,
  personId: peopleUuidSchema,
  lastName: z.string(),
  firstName: z.string(),
  displayName: z.string(),
  otherNames: z.string().nullable(),
  sex: peopleSexSchema.nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  phoneAlt: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  occupation: z.string().nullable(),
  employer: z.string().nullable(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  /** Compte de portail : `NONE` ou statut de l'accès IAM (`active`, `suspended`…). */
  portalAccount: z.string(),
  hasStaffRecord: z.boolean().optional(),
  childrenCount: z.number().int(),
});
export type PeopleGuardianDto = z.infer<typeof peopleGuardianDtoSchema>;

/** Tuteur d'un élève, avec son lien (restitué à `guardian.read` et aux communications 016 / finance 014). */
export const peopleStudentGuardianDtoSchema = z.object({
  link: peopleGuardianLinkDtoSchema,
  guardian: peopleGuardianDtoSchema,
});
export type PeopleStudentGuardianDto = z.infer<typeof peopleStudentGuardianDtoSchema>;

// ---------------------------------------------------------------------------
// Portails (élève, parent) et comptes
// ---------------------------------------------------------------------------

/** Fiche d'un enfant pour le parent : identité de l'enfant, classe, noms des tuteurs ; jamais de champ sensible. */
export const peopleChildDtoSchema = z.object({
  student: peopleStudentDetailDtoSchema,
  guardians: z.array(z.object({ guardianId: peopleUuidSchema, displayName: z.string(), relationshipCode: z.string(), isPrimaryContact: z.boolean() })),
  emergencyContacts: z.array(peopleEmergencyContactDtoSchema),
});
export type PeopleChildDto = z.infer<typeof peopleChildDtoSchema>;

export const peoplePortalInvitationBodySchema = z
  .object({
    /** Rôle système à accorder (`parent`, `eleve`, `enseignant`, `educateur`…). Défaut selon la qualité de la personne. */
    role: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/).optional(),
    /** Qualité visée quand la personne en cumule plusieurs (élève, tuteur, personnel) ; détermine le rôle par défaut. */
    quality: z.enum(["STUDENT", "GUARDIAN", "STAFF"]).optional(),
    channel: z.enum(["EMAIL"]).default("EMAIL"),
  })
  .strict();
export type PeoplePortalInvitationBody = z.infer<typeof peoplePortalInvitationBodySchema>;

export const peopleLinkIdentityBodySchema = z.object({ identityId: peopleUuidSchema }).strict();

export const peopleAccountDtoSchema = z.object({
  personId: peopleUuidSchema,
  identityId: peopleUuidSchema,
  status: z.string(),
  /** `true` si un accès vient d'être créé et une invitation envoyée (jamais de mot de passe ni de jeton dans la réponse). */
  invited: z.boolean(),
});

// ---------------------------------------------------------------------------
// Référentiels et paramètres
// ---------------------------------------------------------------------------

export const peopleRelationshipTypeBodySchema = z
  .object({ code: peopleCodeSchema, label: text(120), kind: peopleRelationshipKindSchema, sortOrder: z.number().int().min(0).max(10_000).optional(), active: z.boolean().optional() })
  .strict();
export const peopleRelationshipTypeDtoSchema = z.object({
  id: peopleUuidSchema,
  code: z.string(),
  label: z.string(),
  kind: peopleRelationshipKindSchema,
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type PeopleRelationshipTypeDto = z.infer<typeof peopleRelationshipTypeDtoSchema>;

export const peopleStaffCategoryBodySchema = z
  .object({ code: peopleCodeSchema, label: text(120), canTeach: z.boolean().optional(), canSupervise: z.boolean().optional(), sortOrder: z.number().int().min(0).max(10_000).optional(), active: z.boolean().optional() })
  .strict();
export const peopleStaffCategoryDtoSchema = z.object({
  id: peopleUuidSchema,
  code: z.string(),
  label: z.string(),
  canTeach: z.boolean(),
  canSupervise: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type PeopleStaffCategoryDto = z.infer<typeof peopleStaffCategoryDtoSchema>;

export const peopleContractTypeBodySchema = z
  .object({ code: peopleCodeSchema, label: text(120), kind: peopleContractKindSchema, active: z.boolean().optional() })
  .strict();
export const peopleContractTypeDtoSchema = z.object({
  id: peopleUuidSchema,
  code: z.string(),
  label: z.string(),
  kind: peopleContractKindSchema,
  active: z.boolean(),
});
export type PeopleContractTypeDto = z.infer<typeof peopleContractTypeDtoSchema>;

const numberPattern = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[A-Za-z0-9_\-./]*(\{(SEQ:[1-9]|YYYY|YY|PREFIX)\}[A-Za-z0-9_\-./]*)+$/, "Motif invalide : jetons {SEQ:n}, {YYYY}, {YY}, {PREFIX}.")
  .refine((p) => /\{SEQ:[1-9]\}/.test(p), "Le motif doit contenir {SEQ:n}.");
export const peopleSettingsPatchSchema = z
  .object({
    studentNumberPattern: numberPattern.optional(),
    staffNumberPattern: numberPattern.optional(),
    numberPrefix: z.string().regex(/^[A-Z0-9]{1,12}$/).nullable().optional(),
    duplicateCheckEnabled: z.boolean().optional(),
    expiryAlertDays: z.number().int().min(1).max(365).nullable().optional(),
    studentRetentionDays: z.number().int().min(0).max(36_500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export type PeopleSettingsPatch = z.infer<typeof peopleSettingsPatchSchema>;
export const peopleSettingsDtoSchema = z.object({
  studentNumberPattern: z.string(),
  staffNumberPattern: z.string(),
  numberPrefix: z.string().nullable(),
  duplicateCheckEnabled: z.boolean(),
  expiryAlertDays: z.number().int().nullable(),
  studentRetentionDays: z.number().int().nullable(),
});
export type PeopleSettingsDto = z.infer<typeof peopleSettingsDtoSchema>;

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------

export const peopleCreateStaffBodySchema = z
  .object({
    person: peoplePersonInputSchema.optional(),
    /** Réutilise une personne existante (ex. un parent d'élève qui est aussi enseignant). */
    personId: peopleUuidSchema.optional(),
    categoryCode: peopleCodeSchema,
    jobTitle: text(160).optional(),
    hiredOn: peopleDateSchema.optional(),
    primaryInstitutionId: peopleUuidSchema.optional(),
    primaryCampusId: peopleUuidSchema.optional(),
    attributes: attributesSchema.optional(),
    externalRef: text(120).optional(),
    validateOnly: z.boolean().optional(),
    ...duplicateAckSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.person && !v.personId) ctx.addIssue({ code: "custom", path: ["person"], message: "Identité (person) ou personne existante (personId) requise." });
    if (v.person && v.personId) ctx.addIssue({ code: "custom", path: ["personId"], message: "person et personId sont exclusifs." });
    if (v.acknowledgeDuplicate && !v.duplicateReason) ctx.addIssue({ code: "custom", path: ["duplicateReason"], message: "Un motif est requis pour confirmer un doublon possible." });
  });
export type PeopleCreateStaffBody = z.infer<typeof peopleCreateStaffBodySchema>;

export const peopleUpdateStaffBodySchema = z
  .object({
    person: peoplePersonPatchSchema.optional(),
    categoryCode: peopleCodeSchema.optional(),
    jobTitle: text(160).nullable().optional(),
    hiredOn: peopleDateSchema.nullable().optional(),
    primaryInstitutionId: peopleUuidSchema.nullable().optional(),
    primaryCampusId: peopleUuidSchema.nullable().optional(),
    attributes: attributesSchema.optional(),
    externalRef: text(120).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export type PeopleUpdateStaffBody = z.infer<typeof peopleUpdateStaffBodySchema>;

export const peopleChangeStaffStatusBodySchema = z
  .object({ status: peopleStaffStatusSchema, reasonText: text(1000).optional(), effectiveOn: peopleDateSchema.optional(), leftOn: peopleDateSchema.optional() })
  .strict();
export type PeopleChangeStaffStatusBody = z.infer<typeof peopleChangeStaffStatusBodySchema>;

export const peopleListStaffQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: peopleStaffStatusSchema.optional(),
  categoryCode: peopleCodeSchema.optional(),
  institutionId: peopleUuidSchema.optional(),
  canTeach: boolQuery.optional(),
  sort: z.enum(["name", "load"]).optional(),
  academicYearId: peopleUuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const peopleStaffSummaryDtoSchema = z.object({
  id: peopleUuidSchema,
  personId: peopleUuidSchema,
  staffNumber: z.string(),
  lastName: z.string(),
  firstName: z.string(),
  displayName: z.string(),
  categoryCode: z.string(),
  jobTitle: z.string().nullable(),
  status: peopleStaffStatusSchema,
  primaryInstitutionId: peopleUuidSchema.nullable(),
  /** Charge prévue (heures affectées) si le tri par charge est demandé. */
  plannedHours: z.number().nullable(),
});
export type PeopleStaffSummaryDto = z.infer<typeof peopleStaffSummaryDtoSchema>;

// ---------------------------------------------------------------------------
// Résolution de noms par lots : `GET /students/lookup?ids=…`, `GET /staff/lookup?ids=…`
// ---------------------------------------------------------------------------

/** Plafond d'identifiants DISTINCTS par appel HTTP (URL bornée : 100 UUID ≈ 3,7 Ko). L'API publique `lookup*` accepte 500. */
export const PEOPLE_LOOKUP_MAX_IDS = 100;

/**
 * `ids` : UUID séparés par des virgules (ou paramètre répété). Les doublons sont ignorés ; au plus
 * {@link PEOPLE_LOOKUP_MAX_IDS} identifiants DISTINCTS ; un segment vide ou mal formé refuse la requête (400).
 */
export const peopleLookupQuerySchema = z
  .object({
    ids: z
      .union([z.string(), z.array(z.string())])
      .transform((v) => (Array.isArray(v) ? v.join(",") : v))
      .pipe(z.string().min(1, "Au moins un identifiant est requis.").max(8_000, "Liste d'identifiants trop longue."))
      .transform((s) => s.split(",").map((x) => x.trim()))
      .pipe(z.array(peopleUuidSchema))
      .transform((list) => [...new Set(list)])
      .pipe(z.array(peopleUuidSchema).min(1).max(PEOPLE_LOOKUP_MAX_IDS, `Au plus ${PEOPLE_LOOKUP_MAX_IDS} identifiants distincts par appel.`)),
  })
  .strict();
export type PeopleLookupQuery = z.infer<typeof peopleLookupQuerySchema>;

/** Résumé MINIMAL d'un élève : ni naissance, ni contact, ni photo, ni inscription, ni identifiant national. */
export const peopleStudentLookupItemSchema = z.object({
  id: peopleUuidSchema,
  /** « NOM Prénom ». */
  displayName: z.string(),
  studentNumber: z.string(),
  status: peopleStudentStatusSchema,
});
export type PeopleStudentLookupItem = z.infer<typeof peopleStudentLookupItemSchema>;

/**
 * `items` suit l'ordre des identifiants demandés (dédoublonnés). `missing` = demandés mais non restitués : inconnus,
 * d'un autre tenant OU hors du périmètre de l'appelant — volontairement INDISCERNABLES (aucune fuite d'existence).
 */
export const peopleStudentLookupResponseSchema = z.object({
  items: z.array(peopleStudentLookupItemSchema),
  missing: z.array(peopleUuidSchema),
});
export type PeopleStudentLookupResponse = z.infer<typeof peopleStudentLookupResponseSchema>;

/** Résumé MINIMAL d'un membre du personnel : ni contact, ni compte lié, ni contrat, ni rémunération. */
export const peopleStaffLookupItemSchema = z.object({
  id: peopleUuidSchema,
  displayName: z.string(),
  staffNumber: z.string(),
  status: peopleStaffStatusSchema,
});
export type PeopleStaffLookupItem = z.infer<typeof peopleStaffLookupItemSchema>;

export const peopleStaffLookupResponseSchema = z.object({
  items: z.array(peopleStaffLookupItemSchema),
  missing: z.array(peopleUuidSchema),
});
export type PeopleStaffLookupResponse = z.infer<typeof peopleStaffLookupResponseSchema>;

export const peopleStaffAffiliationDtoSchema = z.object({
  id: peopleUuidSchema,
  institutionId: peopleUuidSchema,
  campusId: peopleUuidSchema.nullable(),
  validFrom: peopleDateSchema,
  validTo: peopleDateSchema.nullable(),
});

export const peopleStaffDetailDtoSchema = peopleStaffSummaryDtoSchema.extend({
  otherNames: z.string().nullable(),
  sex: peopleSexSchema.nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  phoneAlt: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  hiredOn: peopleDateSchema.nullable(),
  leftOn: peopleDateSchema.nullable(),
  primaryCampusId: peopleUuidSchema.nullable(),
  affiliations: z.array(peopleStaffAffiliationDtoSchema),
  portalAccount: z.string(),
  externalRef: z.string().nullable(),
  createdAt: instant,
  updatedAt: instant,
});
export type PeopleStaffDetailDto = z.infer<typeof peopleStaffDetailDtoSchema>;

export const peopleStaffAffiliationsBodySchema = z
  .object({
    affiliations: z
      .array(z.object({ institutionId: peopleUuidSchema, campusId: peopleUuidSchema.nullable().optional(), validFrom: peopleDateSchema.optional(), validTo: peopleDateSchema.nullable().optional() }).strict())
      .max(50),
  })
  .strict();

export const peopleStaffStatusHistoryDtoSchema = z.object({
  id: peopleUuidSchema,
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  reasonText: z.string().nullable(),
  effectiveOn: peopleDateSchema,
  changedBy: peopleUuidSchema.nullable(),
  changedAt: instant,
});

// --- contrats (ni tarif ni salaire : paie 032) -------------------------------

export const peopleContractBodySchema = z
  .object({
    contractTypeCode: peopleCodeSchema,
    startsOn: peopleDateSchema,
    endsOn: peopleDateSchema.optional(),
    committedHours: z.number().min(0).max(99_999).optional(),
    committedHoursUnit: z.enum(["PER_WEEK", "PER_YEAR"]).optional(),
    status: z.enum(["DRAFT", "ACTIVE"]).optional(),
    note: text(1000).optional(),
  })
  .strict()
  .refine((v) => (v.committedHours === undefined) === (v.committedHoursUnit === undefined), "Volume horaire et unité vont ensemble.");
export type PeopleContractBody = z.infer<typeof peopleContractBodySchema>;

export const peopleContractPatchSchema = z
  .object({
    startsOn: peopleDateSchema.optional(),
    endsOn: peopleDateSchema.nullable().optional(),
    committedHours: z.number().min(0).max(99_999).nullable().optional(),
    committedHoursUnit: z.enum(["PER_WEEK", "PER_YEAR"]).nullable().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "CANCELLED"]).optional(),
    note: text(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export const peopleEndContractBodySchema = z.object({ endsOn: peopleDateSchema.optional() }).strict();
export const peopleContractDtoSchema = z.object({
  id: peopleUuidSchema,
  staffId: peopleUuidSchema,
  contractTypeCode: z.string(),
  startsOn: peopleDateSchema,
  endsOn: peopleDateSchema.nullable(),
  committedHours: z.number().nullable(),
  committedHoursUnit: z.enum(["PER_WEEK", "PER_YEAR"]).nullable(),
  status: peopleContractStatusSchema,
  note: z.string().nullable(),
});
export type PeopleContractDto = z.infer<typeof peopleContractDtoSchema>;

// --- qualifications ---------------------------------------------------------

export const peopleQualificationBodySchema = z
  .object({ kind: peopleQualificationKindSchema, label: text(200), issuer: text(200).optional(), obtainedOn: peopleDateSchema.optional(), expiresOn: peopleDateSchema.optional(), note: text(1000).optional() })
  .strict();
export const peopleQualificationPatchSchema = z
  .object({
    kind: peopleQualificationKindSchema.optional(),
    label: text(200).optional(),
    issuer: text(200).nullable().optional(),
    obtainedOn: peopleDateSchema.nullable().optional(),
    expiresOn: peopleDateSchema.nullable().optional(),
    note: text(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export const peopleQualificationDtoSchema = z.object({
  id: peopleUuidSchema,
  staffId: peopleUuidSchema,
  kind: peopleQualificationKindSchema,
  label: z.string(),
  issuer: z.string().nullable(),
  obtainedOn: peopleDateSchema.nullable(),
  expiresOn: peopleDateSchema.nullable(),
  note: z.string().nullable(),
});
export type PeopleQualificationDto = z.infer<typeof peopleQualificationDtoSchema>;
export const peopleExpiringQuerySchema = z.object({ withinDays: z.coerce.number().int().min(1).max(365).optional(), asOf: peopleDateSchema.optional() });
export const peopleExpiringQualificationDtoSchema = z.object({
  qualificationId: peopleUuidSchema,
  staffId: peopleUuidSchema,
  label: z.string(),
  expiresOn: peopleDateSchema,
  daysLeft: z.number().int(),
});

// --- compétences et disponibilités -----------------------------------------

export const peopleCompetenciesBodySchema = z
  .object({ competencies: z.array(z.object({ subjectId: peopleUuidSchema, gradeLevelCodes: z.array(z.string().trim().min(1).max(40)).max(40).optional() }).strict()).max(100) })
  .strict();
export const peopleCompetencyDtoSchema = z.object({ subjectId: peopleUuidSchema, gradeLevelCodes: z.array(z.string()) });

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure attendue au format HH:MM.");
export const peopleAvailabilityInputSchema = z
  .object({
    campusId: peopleUuidSchema.nullable().optional(),
    weekday: z.number().int().min(1).max(7),
    startTime: timeOfDay,
    endTime: timeOfDay,
    kind: peopleAvailabilityKindSchema.default("UNAVAILABLE"),
    validFrom: peopleDateSchema.nullable().optional(),
    validTo: peopleDateSchema.nullable().optional(),
    reason: text(300).nullable().optional(),
  })
  .strict()
  .refine((v) => v.endTime > v.startTime, "La fin doit suivre le début (un créneau ne chevauche pas minuit).");
export const peopleAvailabilitiesBodySchema = z.object({ availabilities: z.array(peopleAvailabilityInputSchema).max(100) }).strict();
export const peopleAvailabilityDtoSchema = z.object({
  id: peopleUuidSchema,
  staffId: peopleUuidSchema,
  campusId: peopleUuidSchema.nullable(),
  weekday: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
  kind: peopleAvailabilityKindSchema,
  validFrom: peopleDateSchema.nullable(),
  validTo: peopleDateSchema.nullable(),
  reason: z.string().nullable(),
});
export type PeopleAvailabilityDto = z.infer<typeof peopleAvailabilityDtoSchema>;

export const peopleMyStaffPatchSchema = z
  .object({ contact: peopleOwnContactPatchSchema.optional(), availabilities: z.array(peopleAvailabilityInputSchema).max(100).optional() })
  .strict()
  .refine((v) => v.contact !== undefined || v.availabilities !== undefined, "Aucune modification.");

// ---------------------------------------------------------------------------
// Affectations d'enseignement
// ---------------------------------------------------------------------------

export const peopleCreateAssignmentBodySchema = z
  .object({
    staffId: peopleUuidSchema,
    academicYearId: peopleUuidSchema,
    classroomId: peopleUuidSchema,
    curriculumNodeId: peopleUuidSchema.optional(),
    periodId: peopleUuidSchema.optional(),
    roleCode: peopleAssignmentRoleSchema,
    replacesAssignmentId: peopleUuidSchema.optional(),
    coversAllSubjects: z.boolean().optional(),
    plannedHours: z.number().min(0).max(99_999).optional(),
    startsOn: peopleDateSchema,
    endsOn: peopleDateSchema.optional(),
    note: text(1000).optional(),
  })
  .strict();
export type PeopleCreateAssignmentBody = z.infer<typeof peopleCreateAssignmentBodySchema>;

export const peopleUpdateAssignmentBodySchema = z
  .object({ plannedHours: z.number().min(0).max(99_999).nullable().optional(), endsOn: peopleDateSchema.nullable().optional(), note: text(1000).nullable().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export const peopleEndAssignmentBodySchema = z.object({ endsOn: peopleDateSchema.optional(), reason: text(500).optional() }).strict();
export const peopleReplaceAssignmentBodySchema = z
  .object({ newStaffId: peopleUuidSchema, effectiveOn: peopleDateSchema, reason: text(500) })
  .strict();

export const peopleListAssignmentsQuerySchema = z.object({
  yearId: peopleUuidSchema.optional(),
  onDate: peopleDateSchema.optional(),
  status: peopleAssignmentStatusSchema.optional(),
});
export const peopleUnstaffedQuerySchema = z.object({ yearId: peopleUuidSchema, classroomId: peopleUuidSchema.optional(), programId: peopleUuidSchema.optional() });

export const peopleAssignmentDtoSchema = z.object({
  id: peopleUuidSchema,
  staffId: peopleUuidSchema,
  staffDisplayName: z.string().nullable(),
  academicYearId: peopleUuidSchema,
  classroomId: peopleUuidSchema,
  curriculumNodeId: peopleUuidSchema.nullable(),
  periodId: peopleUuidSchema.nullable(),
  roleCode: peopleAssignmentRoleSchema,
  replacesAssignmentId: peopleUuidSchema.nullable(),
  coversAllSubjects: z.boolean(),
  plannedHours: z.number().nullable(),
  startsOn: peopleDateSchema,
  endsOn: peopleDateSchema.nullable(),
  status: peopleAssignmentStatusSchema,
  source: z.string(),
  note: z.string().nullable(),
  createdAt: instant,
});
export type PeopleAssignmentDto = z.infer<typeof peopleAssignmentDtoSchema>;

export const peopleCreateAssignmentResultDtoSchema = z.object({
  assignment: peopleAssignmentDtoSchema,
  /** Avertissements non bloquants (ex. `people.no_matching_competency`, `people.no_active_contract`). */
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
});

export const peopleTeachingLoadDtoSchema = z.object({
  staffId: peopleUuidSchema,
  academicYearId: peopleUuidSchema,
  /** Σ des heures prévues des affectations actives de l'année. */
  plannedHours: z.number(),
  byClassroom: z.array(z.object({ classroomId: peopleUuidSchema, plannedHours: z.number() })),
  byPeriod: z.array(z.object({ periodId: peopleUuidSchema.nullable(), plannedHours: z.number() })),
  /** Volume contractuel des contrats actifs exprimé par semaine / par année (unité d'origine), `null` si aucun. */
  contractualHoursPerWeek: z.number().nullable(),
  /**
   * Volume contractuel converti à l'année : `PER_YEAR` tel quel ; `PER_WEEK` n'est converti que si l'appelant fournit
   * `weeksPerYear` (calendrier de l'établissement) — AUCUN nombre de semaines n'est codé dans le module.
   */
  contractualHoursPerYear: z.number().nullable(),
  weeksPerYearUsed: z.number().int().nullable(),
});

export const peopleTeachingLoadQuerySchema = z.object({ yearId: peopleUuidSchema, weeksPerYear: z.coerce.number().int().min(1).max(60).optional() });

export const peopleUnstaffedNodeDtoSchema = z.object({
  classroomId: peopleUuidSchema,
  curriculumNodeId: peopleUuidSchema,
  label: z.string().nullable(),
});

export const peopleMyClassDtoSchema = z.object({
  classroomId: peopleUuidSchema,
  academicYearId: peopleUuidSchema,
  assignments: z.array(z.object({ assignmentId: peopleUuidSchema, roleCode: peopleAssignmentRoleSchema, curriculumNodeId: peopleUuidSchema.nullable(), coversAllSubjects: z.boolean() })),
});

// ---------------------------------------------------------------------------
// Événements publiés (payloads versionnés `{ v: 1 }`, sans donnée personnelle)
// ---------------------------------------------------------------------------

export const PEOPLE_EVENTS = {
  studentCreated: "people.student.created",
  studentUpdated: "people.student.updated",
  studentStatusChanged: "people.student.status_changed",
  studentAnonymized: "people.student.anonymized",
  studentGuardianChanged: "people.student.guardian_changed",
  guardianCreated: "people.guardian.created",
  guardianLinked: "people.guardian.linked",
  guardianLinkChanged: "people.guardian.link_changed",
  guardianUnlinked: "people.guardian.unlinked",
  personIdentityLinked: "people.person.identity_linked",
  staffCreated: "people.staff.created",
  staffUpdated: "people.staff.updated",
  staffStatusChanged: "people.staff.status_changed",
  staffDeactivated: "people.staff.deactivated",
  staffContractCreated: "people.staff_contract.created",
  staffContractEnded: "people.staff_contract.ended",
  staffQualificationExpiring: "people.staff_qualification.expiring",
  studentDocumentExpiring: "people.student_document.expiring",
  teachingAssignmentCreated: "people.teaching_assignment.created",
  teachingAssignmentEnded: "people.teaching_assignment.ended",
  teachingAssignmentReplaced: "people.teaching_assignment.replaced",
} as const;
export type PeopleEventType = (typeof PEOPLE_EVENTS)[keyof typeof PEOPLE_EVENTS];

export const peopleStudentStatusChangedPayloadSchema = z.object({
  v: z.literal(1),
  studentId: peopleUuidSchema,
  fromStatus: z.string().nullable(),
  toStatus: peopleStudentStatusSchema,
  reasonCode: z.string().nullable(),
  effectiveOn: peopleDateSchema,
});
export const peopleStaffStatusChangedPayloadSchema = z.object({
  v: z.literal(1),
  staffId: peopleUuidSchema,
  fromStatus: z.string().nullable(),
  toStatus: peopleStaffStatusSchema,
  effectiveOn: peopleDateSchema,
});
export const peopleGuardianLinkPayloadSchema = z.object({
  v: z.literal(1),
  studentId: peopleUuidSchema,
  guardianId: peopleUuidSchema,
  linkId: peopleUuidSchema,
  change: z.enum(["linked", "link_changed", "unlinked"]),
});

const peopleEv = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });
const peopleAssignmentRef = { assignmentId: peopleUuidSchema, staffId: peopleUuidSchema, classroomId: peopleUuidSchema } as const;

/** `people.teaching_assignment.ended` : consommé par scheduling (séances à remplacer). `reason` : MANUAL, STAFF_LEFT, CLASSROOM_*, YEAR_CLOSED. */
export const peopleTeachingAssignmentEndedPayloadSchema = peopleEv({ ...peopleAssignmentRef, reason: z.string() });

/**
 * Schéma de charge utile de chaque événement PUBLIÉ par people (additif ; validé par les tests de contrat
 * `apps/api/test/events-contracts`). Aucune donnée personnelle ni texte libre.
 */
export const peopleEventPayloadSchemas = {
  "people.student.created": peopleEv({ studentId: peopleUuidSchema, personId: peopleUuidSchema }),
  "people.student.updated": peopleEv({ studentId: peopleUuidSchema, fields: z.array(z.string()) }),
  "people.student.status_changed": peopleStudentStatusChangedPayloadSchema,
  "people.student.anonymized": peopleEv({ studentId: peopleUuidSchema }),
  "people.student.guardian_changed": peopleGuardianLinkPayloadSchema,
  "people.guardian.created": peopleEv({ guardianId: peopleUuidSchema, personId: peopleUuidSchema }),
  "people.guardian.linked": peopleEv({ studentId: peopleUuidSchema, guardianId: peopleUuidSchema, linkId: peopleUuidSchema }),
  "people.guardian.link_changed": peopleEv({ studentId: peopleUuidSchema, guardianId: peopleUuidSchema, linkId: peopleUuidSchema }),
  "people.guardian.unlinked": peopleEv({ studentId: peopleUuidSchema, guardianId: peopleUuidSchema, linkId: peopleUuidSchema }),
  "people.person.identity_linked": peopleEv({ personId: peopleUuidSchema, identityId: peopleUuidSchema, via: z.enum(["invitation", "manual"]) }),
  "people.staff.created": peopleEv({ staffId: peopleUuidSchema, personId: peopleUuidSchema, categoryCode: z.string() }),
  "people.staff.updated": peopleEv({ staffId: peopleUuidSchema, fields: z.array(z.string()) }),
  "people.staff.status_changed": peopleStaffStatusChangedPayloadSchema,
  "people.staff.deactivated": peopleEv({ staffId: peopleUuidSchema, toStatus: peopleStaffStatusSchema, effectiveOn: peopleDateSchema }),
  "people.staff_contract.created": peopleEv({ staffId: peopleUuidSchema, contractId: peopleUuidSchema, contractTypeCode: z.string(), startsOn: peopleDateSchema }),
  "people.staff_contract.ended": peopleEv({ staffId: peopleUuidSchema, contractId: peopleUuidSchema, endsOn: peopleDateSchema }),
  "people.staff_qualification.expiring": peopleEv({ staffId: peopleUuidSchema, qualificationId: peopleUuidSchema, expiresOn: peopleDateSchema, daysLeft: z.number().int() }),
  "people.student_document.expiring": peopleEv({ studentId: peopleUuidSchema, documentId: peopleUuidSchema, typeCode: peopleStudentDocumentTypeSchema, expiresOn: peopleDateSchema, daysLeft: z.number().int() }),
  "people.teaching_assignment.created": peopleEv({ ...peopleAssignmentRef, curriculumNodeId: peopleUuidSchema.nullable(), roleCode: z.string() }),
  "people.teaching_assignment.ended": peopleTeachingAssignmentEndedPayloadSchema,
  "people.teaching_assignment.replaced": peopleEv({
    oldAssignmentId: peopleUuidSchema,
    newAssignmentId: peopleUuidSchema,
    oldStaffId: peopleUuidSchema,
    newStaffId: peopleUuidSchema,
    classroomId: peopleUuidSchema,
    curriculumNodeId: peopleUuidSchema.nullable(),
    effectiveOn: peopleDateSchema,
  }),
} as const;
