/**
 * Erreurs métier du module `people` (codes `people.*` STABLES, listés dans `contracts/v2/people.ts`).
 * Les messages sont en français, sans donnée personnelle (jamais un nom, un téléphone, une date de naissance).
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type AppError } from "@ecoledigitale/kernel";

type Details = Readonly<Record<string, unknown>>;

const conflict = (code: string, message: string, details?: Details): AppError => new ConflictError(message, { code, ...(details ? { details } : {}) });
/** Erreur de validation de CODE STABLE `people.*` (le code de l'erreur ET celui de la violation de champ). */
const invalid = (code: string, message: string, path: string | ReadonlyArray<string | number> = "body"): AppError =>
  new ValidationError(message, [{ path: typeof path === "string" ? [path] : path, message, code }], { code });

export const PeopleErrors = {
  studentNotFound: (id?: string): AppError => NotFoundError.of("Élève", id, { code: "people.student_not_found" }),
  guardianNotFound: (id?: string): AppError => NotFoundError.of("Tuteur", id, { code: "people.guardian_not_found" }),
  staffNotFound: (id?: string): AppError => NotFoundError.of("Membre du personnel", id, { code: "people.staff_not_found" }),
  personNotFound: (id?: string): AppError => NotFoundError.of("Personne", id, { code: "people.person_not_found" }),
  linkNotFound: (id?: string): AppError => NotFoundError.of("Lien élève-tuteur", id, { code: "people.link_not_found" }),
  assignmentNotFound: (id?: string): AppError => NotFoundError.of("Affectation", id, { code: "people.assignment_not_found" }),
  contractNotFound: (id?: string): AppError => NotFoundError.of("Contrat", id, { code: "people.contract_not_found" }),
  qualificationNotFound: (id?: string): AppError => NotFoundError.of("Qualification", id, { code: "people.qualification_not_found" }),
  emergencyContactNotFound: (id?: string): AppError => NotFoundError.of("Contact d'urgence", id, { code: "people.link_not_found" }),
  priorEducationNotFound: (id?: string): AppError => NotFoundError.of("Antécédent scolaire", id, { code: "people.link_not_found" }),
  classroomNotFound: (id?: string): AppError => NotFoundError.of("Classe", id, { code: "people.classroom_not_found" }),

  possibleDuplicate: (candidates: readonly unknown[]): AppError =>
    conflict("people.possible_duplicate", "Un dossier similaire existe déjà : confirmez avec un motif pour créer quand même.", { candidates }),
  sexRequired: (): AppError => invalid("people.sex_required", "Le sexe est obligatoire pour un élève.", ["person", "sex"]),
  birthDateImplausible: (path: string | ReadonlyArray<string | number> = ["person", "birthDate"]): AppError =>
    invalid("people.birth_date_implausible", "Date de naissance invraisemblable.", path),
  invalidTransition: (from: string, to: string): AppError => conflict("people.invalid_transition", `Passage du statut ${from} à ${to} interdit.`, { from, to }),
  reasonRequired: (what: string): AppError => invalid("people.reason_required", `Un motif est obligatoire (${what}).`, "reasonText"),
  personAlreadyStudent: (): AppError => conflict("people.person_already_student", "Cette personne a déjà un dossier élève."),
  personAlreadyGuardian: (): AppError => conflict("people.person_already_guardian", "Cette personne est déjà enregistrée comme tuteur."),
  personAlreadyStaff: (): AppError => conflict("people.person_already_staff", "Cette personne a déjà une fiche de personnel."),
  primaryGuardianConflict: (): AppError => conflict("people.primary_guardian_conflict", "Cet élève a déjà un contact principal."),
  linkExists: (): AppError => conflict("people.link_exists", "Ce tuteur est déjà lié à cet élève."),
  linkClosed: (): AppError => conflict("people.link_closed", "Ce lien est clos : créez un nouveau lien."),
  relationshipUnknown: (code: string): AppError => invalid("people.relationship_unknown", `Type de lien inconnu ou inactif : ${code}.`, "relationshipCode"),
  relationshipNotGuardian: (): AppError =>
    invalid("people.relationship_not_guardian", "Ce type de lien n'est pas une tutelle : il ne peut pas ouvrir l'accès au portail ni porter l'autorité.", "relationshipCode"),
  categoryUnknown: (code: string): AppError => invalid("people.category_unknown", `Catégorie de personnel inconnue ou inactive : ${code}.`, "categoryCode"),
  categoryForbidden: (code: string): AppError =>
    conflict("people.category_forbidden_to_teach", `La catégorie ${code} ne peut pas recevoir d'affectation d'enseignement.`, { category: code }),
  assignmentStaffNotActive: (status: string): AppError => conflict("people.assignment_staff_not_active", `Le membre du personnel est ${status} : aucune affectation possible.`, { status }),
  assignmentConflict: (message: string, details?: Details): AppError => conflict("people.assignment_conflict", message, details),
  assignmentInvalid: (message: string, path: string | ReadonlyArray<string | number> = "body"): AppError => invalid("people.assignment_invalid", message, path),
  teachingStaffMissing: (missing: readonly unknown[]): AppError =>
    conflict("people.teaching_staff_missing", "Chaque matière obligatoire doit avoir un responsable avant l'ouverture.", { missing }),
  contractTypeUnknown: (code: string): AppError => invalid("people.contract_type_unknown", `Type de contrat inconnu ou inactif : ${code}.`, "contractTypeCode"),
  assignmentClosed: (): AppError => conflict("people.assignment_closed", "Cette affectation est terminée : on ne la réactive pas, on en crée une nouvelle."),
  nodeTransversal: (): AppError => invalid("people.node_transversal", "Un nœud transversal (ex. conduite) n'a jamais d'enseignant.", "curriculumNodeId"),
  nodeNotInClassroom: (): AppError => invalid("people.node_not_in_classroom", "Ce nœud n'appartient pas au curriculum de la classe.", "curriculumNodeId"),
  periodOutsideYear: (): AppError => invalid("people.period_outside_year", "Cette période n'appartient pas à l'année de l'affectation.", "periodId"),
  academicUnavailable: (): AppError => new ConflictError("Le cœur académique n'est pas branché : impossible de vérifier la classe et le nœud.", { code: "people.academic_unavailable" }),
  contractOverlap: (): AppError => conflict("people.contract_overlap", "Un contrat du même type couvre déjà cette période."),
  accountProvisioningUnavailable: (): AppError =>
    new (class extends ConflictError {
      override get httpStatus(): number {
        return 501;
      }
    })("La création de comptes de portail n'est pas disponible.", { code: "people.account_provisioning_unavailable" }),
  accountExists: (): AppError =>
    conflict("people.account_exists", "Un accès existe déjà pour cette adresse e-mail : liez la personne à l'identité existante."),
  accountEmailRequired: (): AppError => invalid("people.account_email_required", "Une adresse e-mail est nécessaire pour inviter la personne.", "email"),
  identityUnknown: (): AppError => invalid("people.identity_unknown", "Cette identité n'a aucun accès dans l'établissement.", "identityId"),
  identityAlreadyLinked: (): AppError => conflict("people.identity_already_linked", "Cette identité est déjà liée à une autre personne, ou la personne a déjà une identité."),
  storageUnavailable: (): AppError => new ConflictError("Le stockage de fichiers n'est pas disponible.", { code: "people.storage_unavailable" }),
  invalidImage: (message: string): AppError => invalid("people.invalid_image", message, "file"),
  invalidDocument: (message: string): AppError => invalid("people.invalid_document", message, "file"),
  documentNotFound: (id?: string): AppError => NotFoundError.of("Pièce", id, { code: "people.document_not_found" }),
  documentExists: (typeCode: string): AppError =>
    conflict("people.document_exists", "Une pièce de ce type existe déjà : remplacez-la pour garder l'historique.", { typeCode }),
  documentNotActive: (): AppError => conflict("people.document_not_active", "Cette pièce a déjà été remplacée ou retirée."),
  retentionNotConfigured: (): AppError =>
    conflict("people.retention_not_configured", "La durée de conservation des dossiers n'est pas fixée : anonymisation impossible."),
  retentionNotElapsed: (eligibleOn: string): AppError => conflict("people.retention_not_elapsed", "Le délai de conservation n'est pas écoulé.", { eligibleOn }),
  notArchived: (): AppError => conflict("people.not_archived", "Seul un dossier archivé peut être anonymisé."),
  alreadyAnonymized: (): AppError => conflict("people.already_anonymized", "Ce dossier est déjà anonymisé."),
  exportTooLarge: (max: number): AppError => conflict("people.export_too_large", `L'export est limité à ${max} lignes : affinez les filtres.`, { max }),
  externalRefConflict: (): AppError => conflict("people.external_ref_conflict", "Cette référence externe est déjà utilisée par une autre fiche."),
  nationalIdConflict: (): AppError => conflict("people.national_id_conflict", "Cet identifiant national est déjà attribué à un autre élève."),
  numberPatternInvalid: (message: string): AppError => invalid("people.number_pattern_invalid", message, "pattern"),
  referenceInUse: (message: string): AppError => conflict("people.reference_in_use", message),
  forbidden: (message = "Action non autorisée."): AppError => new ForbiddenError(message),
} as const;
