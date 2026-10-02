/**
 * Cas d'usage du dossier permanent de l'élève (spec 008). `(deps, ctx, input) => Promise<Result<T, AppError>>`.
 *
 * Principes : un changement de classe ou d'année ne crée jamais un nouvel élève ; aucune suppression physique ; aucun
 * `GET` n'écrit ; les champs sensibles (identifiant national, pièce d'état civil, attributs) ne sortent que par
 * `getStudentSensitive` ; toute lecture sensible et tout export sont audités ; les événements et l'audit ne contiennent
 * aucune donnée personnelle.
 */
import { ForbiddenError, ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import {
  PEOPLE_EVENTS,
  type PeopleChangeStatusBody,
  type PeopleCreateStudentBody,
  type PeopleDuplicateCandidateDto,
  type PeopleEmergencyContactDto,
  type PeopleListStudentsQuery,
  type PeoplePriorEducationDto,
  type PeopleStatusHistoryDto,
  type PeopleStudentDetailDto,
  type PeopleStudentSensitiveDto,
  type PeopleStudentSummaryDto,
  type PeopleUpdateStudentBody,
} from "@ecoledigitale/contracts/src/v2/people";
import { toCsv } from "../domain/csv";
import { PeopleErrors } from "../domain/errors";
import { sniffImage, studentPhotoKey } from "../domain/files";
import { addDays, displayName, isoDate, normalizePhone } from "../domain/normalize";
import { formatNumber } from "../domain/number-pattern";
import { canTransitionStudent, setsLeftOn, studentReasonRequired } from "../domain/status";
import {
  anonymizePerson,
  getPerson,
  setPhotoKey,
  updatePerson,
  insertPerson,
  type PersonPatchValues,
} from "../infrastructure/persons-repo";
import { ensureTenantDefaults, nextNumber } from "../infrastructure/reference-repo";
import { listPrimaryGuardians } from "../infrastructure/guardians-repo";
import * as repo from "../infrastructure/students-repo";
import * as documentsRepo from "../infrastructure/documents-repo";
import { actorId, clampPage, EventBuffer, inTx, todayOf, type PeopleDeps } from "./deps";
import { detectDuplicates, defaultCountryOf, lockKey, loadSettings, normalizePersonInput, toNewPerson, changedPersonFields, SEE_NO_ROLE, type RoleVisibility } from "./support";
import {
  emergencyContactView,
  priorEducationView,
  statusHistoryView,
  studentDetailView,
  studentSummaryView,
  type AccessLevel,
  type PrimaryGuardianFacts,
} from "./views";

const SENSITIVE_PATCH_KEYS = ["nationalStudentId", "birthCertificateNumber", "birthCertificateDate", "civilRegistryOffice", "attributes"] as const;

/** Vrai si le patch touche un champ sensible. */
export function touchesSensitive(patch: Partial<Record<(typeof SENSITIVE_PATCH_KEYS)[number], unknown>>): boolean {
  return SENSITIVE_PATCH_KEYS.some((k) => patch[k] !== undefined);
}

function sensitiveFieldNames(patch: Partial<Record<(typeof SENSITIVE_PATCH_KEYS)[number], unknown>>): string[] {
  return SENSITIVE_PATCH_KEYS.filter((k) => patch[k] !== undefined);
}

function primaryFacts(rows: Awaited<ReturnType<typeof listPrimaryGuardians>>, studentId: string): PrimaryGuardianFacts | null {
  const r = rows.find((x) => x.studentId === studentId);
  return r ? { guardianId: r.guardianId, displayName: displayName(r.lastName, r.firstName), relationshipCode: r.relationshipCode, phone: r.phone } : null;
}

/** Contrainte d'unicité violée → erreur métier explicite (jamais un 500). */
function uniqueViolationToError(e: unknown): AppError | null {
  if (!isUniqueViolation(e)) return null;
  const text = `${(e as { constraint?: string }).constraint ?? ""} ${(e as Error).message ?? ""}`;
  if (text.includes("students_national_id_unique")) return PeopleErrors.nationalIdConflict();
  if (text.includes("external_ref")) return PeopleErrors.externalRefConflict();
  if (text.includes("persons_identity_unique")) return PeopleErrors.identityAlreadyLinked();
  if (text.includes("student")) return PeopleErrors.personAlreadyStudent();
  return null;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Fiche d'un élève (sans champ sensible) au niveau d'accès demandé. `NotFound` si l'élève n'existe pas. */
export async function getStudent(deps: PeopleDeps, ctx: RequestContext, studentId: string, access: AccessLevel = "FULL"): Promise<Result<PeopleStudentDetailDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await repo.getStudentRow(tx, ctx.tenantId, studentId);
      if (!row) return err(PeopleErrors.studentNotFound(studentId));
      const primary = primaryFacts(await listPrimaryGuardians(tx, ctx.tenantId, [studentId]), studentId);
      return ok(studentDetailView(row, access, primary));
    },
    { readOnly: true },
  );
}

/** Résumés par lots (010, 011, 013, 014, 016, 017) : une requête, identifiants inconnus ignorés, ordre non garanti. */
export async function getStudentsByIds(deps: PeopleDeps, ctx: RequestContext, ids: readonly string[]): Promise<Result<PeopleStudentSummaryDto[], AppError>> {
  if (ids.length > deps.config.maxBatchSize) return err(ValidationError.field("ids", `Au plus ${deps.config.maxBatchSize} identifiants par appel.`, "too_many"));
  const unique = [...new Set(ids)];
  return inTx(deps, ctx, async (tx) => ok((await repo.getStudentRows(tx, ctx.tenantId, unique)).map(studentSummaryView)), { readOnly: true });
}

export type StudentScope = { kind: "ALL" } | { kind: "IDS"; ids: readonly string[] };

export interface StudentList {
  items: PeopleStudentSummaryDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Liste filtrée / recherche (`q` : nom, matricule, numéro d'inscription, téléphone d'un tuteur ; identifiant national si autorisé). */
export async function listStudents(
  deps: PeopleDeps,
  ctx: RequestContext,
  query: Partial<PeopleListStudentsQuery>,
  options: { scope?: StudentScope; allowNationalIdSearch?: boolean } = {},
): Promise<Result<StudentList, AppError>> {
  const page = clampPage(deps, query);
  const scope = options.scope ?? { kind: "ALL" };
  if (scope.kind === "IDS" && scope.ids.length === 0) return ok({ items: [], total: 0, limit: page.limit, offset: page.offset });
  const country = query.q ? await defaultCountryOf(deps, ctx) : null;
  const qPhone = query.q && query.q.replace(/\D/g, "").length >= 5 ? normalizePhone(query.q, country) : null;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const { rows, total } = await repo.listStudentRows(tx, ctx.tenantId, {
        q: query.q,
        qPhone,
        allowNationalIdSearch: options.allowNationalIdSearch === true,
        status: query.status,
        includeArchived: query.includeArchived,
        classroomId: query.classroomId,
        academicYearId: query.academicYearId,
        institutionId: query.institutionId,
        programId: query.programId,
        enrollmentStatus: query.enrollmentStatus,
        guardianId: query.guardianId,
        onlyIds: scope.kind === "IDS" ? scope.ids : undefined,
        limit: page.limit,
        offset: page.offset,
      });
      return ok({ items: rows.map(studentSummaryView), total, limit: page.limit, offset: page.offset });
    },
    { readOnly: true },
  );
}

export const searchStudents = listStudents;

/** Candidats de doublon pour un brouillon d'identité (avertissement, jamais une contrainte). */
export async function findDuplicateStudents(
  deps: PeopleDeps,
  ctx: RequestContext,
  draft: { lastName: string; firstName: string; birthDate?: string | undefined },
  visibility: RoleVisibility = SEE_NO_ROLE,
): Promise<Result<PeopleDuplicateCandidateDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await detectDuplicates(tx, ctx, draft, visibility)), { readOnly: true });
}

/**
 * Champs SENSIBLES (identifiant national, état civil, attributs). Chaque lecture est AUDITÉE (`notice`) : le cas d'usage
 * écrit donc dans une transaction non lecture seule. L'appelant a déjà vérifié `student.sensitive.read`.
 */
export async function getStudentSensitive(deps: PeopleDeps, ctx: RequestContext, studentId: string): Promise<Result<PeopleStudentSensitiveDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.getSensitive(tx, ctx.tenantId, studentId);
    if (!row) return err(PeopleErrors.studentNotFound(studentId));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.sensitive_read", entity: "student", entityId: studentId, severity: "notice" });
    await buffer.flush(tx);
    return ok(row);
  });
}

export async function getStatusHistory(deps: PeopleDeps, ctx: RequestContext, studentId: string): Promise<Result<PeopleStatusHistoryDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await repo.getStudentRow(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
      return ok((await repo.listStatusHistory(tx, ctx.tenantId, studentId)).map(statusHistoryView));
    },
    { readOnly: true },
  );
}

export async function listStudentEnrollments(deps: PeopleDeps, ctx: RequestContext, studentId: string): Promise<Result<repo.EnrollmentSummaryRow[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await repo.getStudentRow(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
      return ok(await repo.listEnrollmentSummaries(tx, ctx.tenantId, studentId));
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export type CreateStudentOutcome =
  | { kind: "created"; student: PeopleStudentDetailDto; replayed: boolean }
  | { kind: "validated"; duplicates: PeopleDuplicateCandidateDto[] };

/**
 * Crée atomiquement la personne (ou réutilise une personne existante), le dossier, le numéro gapless, la ligne d'historique
 * `NULL -> ACTIVE` et l'événement `people.student.created`. Idempotent par `externalRef` ; `validateOnly` n'écrit rien.
 */
export async function createStudent(
  deps: PeopleDeps,
  ctx: RequestContext,
  input: PeopleCreateStudentBody,
  options: { visibility?: RoleVisibility; allowSensitive?: boolean } = {},
): Promise<Result<CreateStudentOutcome, AppError>> {
  const visibility = options.visibility ?? SEE_NO_ROLE;
  const sensitiveGiven = touchesSensitive(input);
  if (sensitiveGiven && options.allowSensitive === false) return err(new ForbiddenError("La saisie de données sensibles exige une permission dédiée."));
  const validateOnly = input.validateOnly === true;

  const normalized = input.person ? await normalizePersonInput(deps, ctx, input.person) : null;
  if (normalized && !normalized.ok) return normalized;
  if (input.person && !input.person.sex) return err(PeopleErrors.sexRequired());
  const country = await defaultCountryOf(deps, ctx);

  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const today = todayOf(deps);
    const settings = await loadSettings(deps, tx, ctx, { write: !validateOnly });

    if (input.externalRef) {
      await lockKey(tx, ctx, "student-ref", input.externalRef);
      const existing = await repo.findStudentByExternalRef(tx, ctx.tenantId, input.externalRef);
      if (existing) {
        const primary = primaryFacts(await listPrimaryGuardians(tx, ctx.tenantId, [existing.studentId]), existing.studentId);
        return ok<CreateStudentOutcome>({ kind: "created", student: studentDetailView(existing, "FULL", primary), replayed: true });
      }
    }

    // --- identité : nouvelle personne ou personne existante --------------------------------------------------
    let personId: string;
    let reuse: Awaited<ReturnType<typeof getPerson>> = null;
    let draft: { lastName: string; firstName: string; otherNames?: string | null | undefined; birthDate?: string | null | undefined };
    if (input.personId) {
      reuse = await getPerson(tx, ctx.tenantId, input.personId, { forUpdate: true });
      if (!reuse) return err(PeopleErrors.personNotFound(input.personId));
      if (reuse.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
      if (await repo.findStudentByPerson(tx, ctx.tenantId, reuse.personId)) return err(PeopleErrors.personAlreadyStudent());
      if (!reuse.sex && !input.sex) return err(PeopleErrors.sexRequired());
      personId = reuse.personId;
      draft = reuse;
    } else {
      const values = (normalized as { ok: true; value: PersonPatchValues }).value;
      personId = deps.newId();
      draft = { lastName: values.lastName as string, firstName: values.firstName as string, otherNames: values.otherNames, birthDate: values.birthDate };
    }

    // --- doublons (avertissement humain) ------------------------------------------------------------------
    let duplicates: PeopleDuplicateCandidateDto[] = [];
    if (!reuse && settings.duplicateCheckEnabled) {
      duplicates = await detectDuplicates(tx, ctx, draft, visibility);
    }
    if (validateOnly) return ok<CreateStudentOutcome>({ kind: "validated", duplicates });
    if (duplicates.length > 0 && !input.acknowledgeDuplicate) return err(PeopleErrors.possibleDuplicate(duplicates));

    // --- unicités lisibles avant l'écriture ----------------------------------------------------------------
    if (input.externalRef && (await repo.findStudentByExternalRef(tx, ctx.tenantId, input.externalRef))) return err(PeopleErrors.externalRefConflict());

    const buffer = new EventBuffer(deps, ctx);
    try {
      if (reuse) {
        const fill: PersonPatchValues = {};
        if (!reuse.sex && input.sex) fill.sex = input.sex;
        if (!reuse.nationality && country) fill.nationality = country;
        await updatePerson(tx, ctx.tenantId, personId, fill, now);
      } else {
        const values = (normalized as { ok: true; value: PersonPatchValues }).value;
        await insertPerson(tx, ctx.tenantId, toNewPerson(personId, { ...values, nationality: values.nationality ?? country }, { externalRef: input.externalRef }), now);
      }
      // Le compteur gapless est pris le plus TARD possible : son verrou est tenu jusqu'au COMMIT.
      const seq = await nextNumber(tx, "STUDENT");
      const studentNumber = formatNumber(settings.studentNumberPattern, { seq, year: now.getUTCFullYear(), prefix: settings.numberPrefix });
      const studentId = deps.newId();
      await repo.insertStudent(
        tx,
        ctx.tenantId,
        {
          id: studentId,
          personId,
          studentNumber,
          sequenceNumber: seq,
          nationalStudentId: input.nationalStudentId,
          birthCertificateNumber: input.birthCertificateNumber,
          birthCertificateDate: input.birthCertificateDate,
          civilRegistryOffice: input.civilRegistryOffice,
          attributes: input.attributes,
          externalRef: input.externalRef,
        },
        now,
      );
      await repo.insertStatusHistory(tx, ctx.tenantId, { id: deps.newId(), studentId, fromStatus: null, toStatus: "ACTIVE", reasonCode: "CREATED", effectiveOn: today, changedBy: actorId(ctx) }, now);

      buffer.add(PEOPLE_EVENTS.studentCreated, { v: 1, studentId, personId }, { type: "student", id: studentId });
      buffer.audit({ action: "people.student.created", entity: "student", entityId: studentId, severity: sensitiveGiven ? "notice" : "info", metadata: { personId, reusedPerson: Boolean(reuse), sensitiveFields: sensitiveFieldNames(input) } });
      if (duplicates.length > 0) {
        buffer.audit({ action: "people.student.duplicate_acknowledged", entity: "student", entityId: studentId, severity: "notice", reason: input.duplicateReason ?? null, metadata: { candidates: duplicates.map((d) => d.personId) } });
      }
      await buffer.flush(tx);

      const row = await repo.getStudentRow(tx, ctx.tenantId, studentId);
      if (!row) throw new Error("Élève introuvable après création.");
      return ok<CreateStudentOutcome>({ kind: "created", student: studentDetailView(row, "FULL", null), replayed: false });
    } catch (e) {
      const mapped = uniqueViolationToError(e);
      if (mapped) return err(mapped);
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------
// Modification
// ---------------------------------------------------------------------------

export async function updateStudent(
  deps: PeopleDeps,
  ctx: RequestContext,
  studentId: string,
  patch: PeopleUpdateStudentBody,
  options: { allowSensitive?: boolean } = {},
): Promise<Result<PeopleStudentDetailDto, AppError>> {
  const sensitive = touchesSensitive(patch);
  if (sensitive && options.allowSensitive === false) return err(new ForbiddenError("La modification de données sensibles exige une permission dédiée."));
  const person = patch.person ? await normalizePersonInput(deps, ctx, patch.person) : null;
  if (person && !person.ok) return person;

  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const locked = await repo.lockStudent(tx, ctx.tenantId, studentId);
    if (!locked) return err(PeopleErrors.studentNotFound(studentId));
    const current = await repo.getStudentRow(tx, ctx.tenantId, studentId);
    if (!current) return err(PeopleErrors.studentNotFound(studentId));
    if (current.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
    const personPatch = person?.value ?? {};
    if (personPatch.sex === null) return err(PeopleErrors.sexRequired());
    try {
      if (Object.keys(personPatch).length > 0) await updatePerson(tx, ctx.tenantId, locked.personId, personPatch, now);
      await repo.updateStudent(
        tx,
        ctx.tenantId,
        studentId,
        {
          nationalStudentId: patch.nationalStudentId,
          birthCertificateNumber: patch.birthCertificateNumber,
          birthCertificateDate: patch.birthCertificateDate,
          civilRegistryOffice: patch.civilRegistryOffice,
          externalRef: patch.externalRef,
          attributes: patch.attributes,
        },
        now,
      );
    } catch (e) {
      const mapped = uniqueViolationToError(e);
      if (mapped) return err(mapped);
      throw e;
    }
    const fields = [...changedPersonFields(personPatch), ...Object.keys(patch).filter((k) => k !== "person").sort()];
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(PEOPLE_EVENTS.studentUpdated, { v: 1, studentId, fields }, { type: "student", id: studentId });
    buffer.audit({ action: "people.student.updated", entity: "student", entityId: studentId, severity: sensitive ? "notice" : "info", metadata: { fields } });
    await buffer.flush(tx);
    const row = await repo.getStudentRow(tx, ctx.tenantId, studentId);
    if (!row) return err(PeopleErrors.studentNotFound(studentId));
    return ok(studentDetailView(row, "FULL", primaryFacts(await listPrimaryGuardians(tx, ctx.tenantId, [studentId]), studentId)));
  });
}

// ---------------------------------------------------------------------------
// Statut
// ---------------------------------------------------------------------------

/**
 * Change le statut du dossier : transition légale (la base la garantit aussi), motif exigé pour les sorties et les retours,
 * ligne d'historique (auteur, motif, date d'effet) et événement `people.student.status_changed` (consommé par academic,
 * iam, 010, 014, 016). Le statut est TOUJOURS une action explicite, jamais déduit des inscriptions.
 */
export async function changeStudentStatus(deps: PeopleDeps, ctx: RequestContext, studentId: string, input: PeopleChangeStatusBody): Promise<Result<PeopleStudentDetailDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const today = todayOf(deps);
    const locked = await repo.lockStudent(tx, ctx.tenantId, studentId);
    if (!locked) return err(PeopleErrors.studentNotFound(studentId));
    const from = locked.status;
    const to = input.status;
    if (from === to || !canTransitionStudent(from, to)) return err(PeopleErrors.invalidTransition(from, to));
    const hasReason = Boolean((input.reasonText && input.reasonText.trim()) || (input.reasonCode && input.reasonCode.trim()));
    if (studentReasonRequired(from, to) && !hasReason) return err(PeopleErrors.reasonRequired(`passage de ${from} à ${to}`));
    const effectiveOn = input.effectiveOn ?? today;
    if (effectiveOn > today) return err(ValidationError.field("effectiveOn", "La date d'effet ne peut pas être dans le futur.", "future_date"));
    const current = await repo.getStudentRow(tx, ctx.tenantId, studentId);
    if (current?.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
    if (setsLeftOn(to) && current?.firstEnrolledOn && effectiveOn < current.firstEnrolledOn) {
      return err(ValidationError.field("effectiveOn", "La date de sortie précède la première inscription.", "before_enrollment"));
    }
    const leftOn = setsLeftOn(to) ? effectiveOn : to === "ACTIVE" ? null : undefined;
    await repo.setStudentStatus(tx, ctx.tenantId, studentId, to, leftOn, now);
    await repo.insertStatusHistory(
      tx,
      ctx.tenantId,
      { id: deps.newId(), studentId, fromStatus: from, toStatus: to, reasonCode: input.reasonCode, reasonText: input.reasonText, effectiveOn, changedBy: actorId(ctx) },
      now,
    );
    const buffer = new EventBuffer(deps, ctx);
    // Aucune donnée personnelle ni texte libre dans l'événement : le motif libre reste dans l'historique.
    buffer.add(
      PEOPLE_EVENTS.studentStatusChanged,
      { v: 1, studentId, fromStatus: from, toStatus: to, reasonCode: input.reasonCode ?? null, effectiveOn },
      { type: "student", id: studentId },
    );
    buffer.audit({ action: "people.student.status_changed", entity: "student", entityId: studentId, severity: "notice", reason: input.reasonText ?? input.reasonCode ?? null, metadata: { from, to, effectiveOn } });
    await buffer.flush(tx);
    const row = await repo.getStudentRow(tx, ctx.tenantId, studentId);
    if (!row) return err(PeopleErrors.studentNotFound(studentId));
    return ok(studentDetailView(row, "FULL", primaryFacts(await listPrimaryGuardians(tx, ctx.tenantId, [studentId]), studentId)));
  });
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------

/** Export CSV de la liste (plafonné, audité `notice`). Aucune colonne sensible, aucune coordonnée. */
export async function exportStudents(deps: PeopleDeps, ctx: RequestContext, query: Partial<PeopleListStudentsQuery>): Promise<Result<{ csv: string; count: number }, AppError>> {
  const max = deps.config.exportMaxRows;
  return inTx(deps, ctx, async (tx) => {
    const rows = await repo.listStudentRowsForExport(
      tx,
      ctx.tenantId,
      {
        q: query.q,
        status: query.status,
        includeArchived: query.includeArchived,
        classroomId: query.classroomId,
        academicYearId: query.academicYearId,
        institutionId: query.institutionId,
        programId: query.programId,
        enrollmentStatus: query.enrollmentStatus,
        guardianId: query.guardianId,
      },
      max + 1,
    );
    if (rows.length > max) return err(PeopleErrors.exportTooLarge(max));
    const csv = toCsv(
      ["Matricule", "Nom", "Prénoms", "Sexe", "Statut", "Classe"],
      rows.map((r) => [r.studentNumber, r.lastName, [r.firstName, r.otherNames].filter(Boolean).join(" "), r.sex, r.status, r.ceClassroomName]),
    );
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.exported", entity: "student", severity: "notice", metadata: { count: rows.length, filters: Object.keys(query).sort() } });
    await buffer.flush(tx);
    return ok({ csv, count: rows.length });
  });
}

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------

/** Téléverse la photo (stockage objet, ≤ taille configurée, JPEG / PNG / WebP vérifiés par octets magiques). */
export async function uploadStudentPhoto(deps: PeopleDeps, ctx: RequestContext, studentId: string, bytes: Uint8Array): Promise<Result<{ hasPhoto: true }, AppError>> {
  if (!deps.storage) return err(PeopleErrors.storageUnavailable());
  if (bytes.byteLength === 0) return err(PeopleErrors.invalidImage("Fichier vide."));
  if (bytes.byteLength > deps.config.photoMaxBytes) return err(PeopleErrors.invalidImage(`Photo trop volumineuse (maximum ${Math.floor(deps.config.photoMaxBytes / 1024)} Ko).`));
  const kind = sniffImage(bytes);
  if (!kind) return err(PeopleErrors.invalidImage("Format non reconnu : JPEG, PNG ou WebP attendu."));
  const storage = deps.storage;
  return inTx(deps, ctx, async (tx) => {
    const locked = await repo.lockStudent(tx, ctx.tenantId, studentId);
    if (!locked) return err(PeopleErrors.studentNotFound(studentId));
    const key = studentPhotoKey(ctx.tenantId, studentId);
    await storage.put(key, bytes, { contentType: kind });
    await setPhotoKey(tx, ctx.tenantId, locked.personId, key, deps.clock.now());
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.photo_updated", entity: "student", entityId: studentId, metadata: { contentType: kind, bytes: bytes.byteLength } });
    await buffer.flush(tx);
    return ok({ hasPhoto: true as const });
  });
}

export async function removeStudentPhoto(deps: PeopleDeps, ctx: RequestContext, studentId: string): Promise<Result<{ hasPhoto: false }, AppError>> {
  const storage = deps.storage;
  const result = await inTx(deps, ctx, async (tx) => {
    const row = await repo.getStudentRow(tx, ctx.tenantId, studentId);
    if (!row) return err(PeopleErrors.studentNotFound(studentId));
    await setPhotoKey(tx, ctx.tenantId, row.personId, null, deps.clock.now());
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.photo_removed", entity: "student", entityId: studentId });
    await buffer.flush(tx);
    return ok(row.photoObjectKey);
  });
  if (!result.ok) return result;
  if (storage && result.value) await storage.delete(result.value).catch((e: unknown) => deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "people : suppression de la photo en échec"));
  return ok({ hasPhoto: false as const });
}

/** URL signée à durée courte de la photo (jamais un chemin disque). `null` si l'élève n'a pas de photo. */
export async function getStudentPhotoUrl(deps: PeopleDeps, ctx: RequestContext, studentId: string): Promise<Result<{ url: string; expiresInSec: number } | null, AppError>> {
  if (!deps.storage) return err(PeopleErrors.storageUnavailable());
  const storage = deps.storage;
  const key = await inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await repo.getStudentRow(tx, ctx.tenantId, studentId);
      return row ? ok(row.photoObjectKey) : err(PeopleErrors.studentNotFound(studentId));
    },
    { readOnly: true },
  );
  if (!key.ok) return key;
  if (!key.value) return ok(null);
  return ok({ url: await storage.signedUrl(key.value, { ttlSec: deps.config.signedUrlTtlSec }), expiresInSec: deps.config.signedUrlTtlSec });
}

// ---------------------------------------------------------------------------
// Contacts d'urgence
// ---------------------------------------------------------------------------

export async function listEmergencyContacts(deps: PeopleDeps, ctx: RequestContext, studentId: string): Promise<Result<PeopleEmergencyContactDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await repo.getStudentRow(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
      return ok((await repo.listEmergencyContacts(tx, ctx.tenantId, studentId)).map(emergencyContactView));
    },
    { readOnly: true },
  );
}

interface EmergencyInput {
  contactName: string;
  relationshipLabel?: string | undefined;
  phone: string;
  phoneAlt?: string | undefined;
  email?: string | undefined;
  priority?: number | undefined;
}

async function normalizeEmergencyPhones<T extends { phone?: string | undefined; phoneAlt?: string | null | undefined }>(deps: PeopleDeps, ctx: RequestContext, input: T): Promise<Result<T, AppError>> {
  const country = await defaultCountryOf(deps, ctx);
  const out = { ...input };
  if (input.phone !== undefined) {
    const p = normalizePhone(input.phone, country);
    if (!p) return err(ValidationError.field("phone", "Numéro de téléphone invalide.", "invalid_phone"));
    out.phone = p;
  }
  if (input.phoneAlt) {
    const p = normalizePhone(input.phoneAlt, country);
    if (!p) return err(ValidationError.field("phoneAlt", "Numéro de téléphone invalide.", "invalid_phone"));
    out.phoneAlt = p;
  }
  return ok(out);
}

export async function addEmergencyContact(deps: PeopleDeps, ctx: RequestContext, studentId: string, input: EmergencyInput): Promise<Result<PeopleEmergencyContactDto, AppError>> {
  const normalized = await normalizeEmergencyPhones(deps, ctx, input);
  if (!normalized.ok) return normalized;
  return inTx(deps, ctx, async (tx) => {
    if (!(await repo.lockStudent(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
    const id = deps.newId();
    await repo.insertEmergencyContact(tx, ctx.tenantId, { id, studentId, ...normalized.value }, deps.clock.now());
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.emergency_contact_added", entity: "student", entityId: studentId, metadata: { contactId: id } });
    await buffer.flush(tx);
    const row = await repo.getEmergencyContact(tx, ctx.tenantId, studentId, id);
    return row ? ok(emergencyContactView(row)) : err(PeopleErrors.emergencyContactNotFound(id));
  });
}

export async function updateEmergencyContact(
  deps: PeopleDeps,
  ctx: RequestContext,
  studentId: string,
  contactId: string,
  patch: { contactName?: string | undefined; relationshipLabel?: string | null | undefined; phone?: string | undefined; phoneAlt?: string | null | undefined; email?: string | null | undefined; priority?: number | undefined },
  options: { audit?: { actor: "STAFF" | "GUARDIAN" } } = {},
): Promise<Result<PeopleEmergencyContactDto, AppError>> {
  const normalized = await normalizeEmergencyPhones(deps, ctx, patch);
  if (!normalized.ok) return normalized;
  return inTx(deps, ctx, async (tx) => {
    if (!(await repo.getEmergencyContact(tx, ctx.tenantId, studentId, contactId))) return err(PeopleErrors.emergencyContactNotFound(contactId));
    await repo.updateEmergencyContact(tx, ctx.tenantId, contactId, normalized.value, deps.clock.now());
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({
      action: "people.student.emergency_contact_updated",
      entity: "student",
      entityId: studentId,
      metadata: { contactId, fields: Object.keys(patch).sort(), by: options.audit?.actor ?? "STAFF" },
    });
    await buffer.flush(tx);
    const row = await repo.getEmergencyContact(tx, ctx.tenantId, studentId, contactId);
    return row ? ok(emergencyContactView(row)) : err(PeopleErrors.emergencyContactNotFound(contactId));
  });
}

export async function removeEmergencyContact(deps: PeopleDeps, ctx: RequestContext, studentId: string, contactId: string): Promise<Result<{ removed: true }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const n = await repo.deleteEmergencyContact(tx, ctx.tenantId, studentId, contactId);
    if (n === 0) return err(PeopleErrors.emergencyContactNotFound(contactId));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.emergency_contact_removed", entity: "student", entityId: studentId, metadata: { contactId } });
    await buffer.flush(tx);
    return ok({ removed: true as const });
  });
}

// ---------------------------------------------------------------------------
// Antécédents scolaires
// ---------------------------------------------------------------------------

export async function listPriorEducation(deps: PeopleDeps, ctx: RequestContext, studentId: string, options: { withSensitive: boolean }): Promise<Result<PeoplePriorEducationDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await repo.getStudentRow(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
      const rows = await repo.listPriorEducation(tx, ctx.tenantId, studentId);
      // Les numéros de diplôme sont sensibles : leur restitution est auditée (`notice`).
      if (options.withSensitive && rows.some((r) => r.referenceNumber !== null)) {
        const buffer = new EventBuffer(deps, ctx);
        buffer.audit({ action: "people.student.prior_education_read", entity: "student", entityId: studentId, severity: "notice", metadata: { count: rows.length } });
        await buffer.flush(tx);
      }
      return ok(rows.map((p) => priorEducationView(p, options.withSensitive)));
    },
    { readOnly: false },
  );
}

export async function addPriorEducation(
  deps: PeopleDeps,
  ctx: RequestContext,
  studentId: string,
  input: {
    kind: string;
    label: string;
    institutionName?: string | undefined;
    schoolYear?: string | undefined;
    levelLabel?: string | undefined;
    seriesLabel?: string | undefined;
    obtainedOn?: string | undefined;
    referenceNumber?: string | undefined;
    note?: string | undefined;
  },
  options: { withSensitive: boolean },
): Promise<Result<PeoplePriorEducationDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await repo.lockStudent(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
    const id = deps.newId();
    await repo.insertPriorEducation(tx, ctx.tenantId, { id, studentId, ...input }, deps.clock.now());
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.prior_education_added", entity: "student", entityId: studentId, severity: input.referenceNumber ? "notice" : "info", metadata: { priorEducationId: id } });
    await buffer.flush(tx);
    const row = await repo.getPriorEducation(tx, ctx.tenantId, studentId, id);
    return row ? ok(priorEducationView(row, options.withSensitive)) : err(PeopleErrors.priorEducationNotFound(id));
  });
}

export async function updatePriorEducation(
  deps: PeopleDeps,
  ctx: RequestContext,
  studentId: string,
  id: string,
  patch: Record<"kind" | "label" | "institutionName" | "schoolYear" | "levelLabel" | "seriesLabel" | "obtainedOn" | "referenceNumber" | "note", string | null | undefined>,
  options: { withSensitive: boolean },
): Promise<Result<PeoplePriorEducationDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await repo.getPriorEducation(tx, ctx.tenantId, studentId, id))) return err(PeopleErrors.priorEducationNotFound(id));
    await repo.updatePriorEducation(tx, ctx.tenantId, id, patch, deps.clock.now());
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.prior_education_updated", entity: "student", entityId: studentId, severity: patch.referenceNumber !== undefined ? "notice" : "info", metadata: { priorEducationId: id } });
    await buffer.flush(tx);
    const row = await repo.getPriorEducation(tx, ctx.tenantId, studentId, id);
    return row ? ok(priorEducationView(row, options.withSensitive)) : err(PeopleErrors.priorEducationNotFound(id));
  });
}

export async function removePriorEducation(deps: PeopleDeps, ctx: RequestContext, studentId: string, id: string): Promise<Result<{ removed: true }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if ((await repo.deletePriorEducation(tx, ctx.tenantId, studentId, id)) === 0) return err(PeopleErrors.priorEducationNotFound(id));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.prior_education_removed", entity: "student", entityId: studentId, metadata: { priorEducationId: id } });
    await buffer.flush(tx);
    return ok({ removed: true as const });
  });
}

// ---------------------------------------------------------------------------
// Anonymisation (droit à l'effacement)
// ---------------------------------------------------------------------------

/**
 * Remplace les données personnelles de la personne et des pièces par des valeurs neutres. Uniquement pour un dossier
 * `ARCHIVED` dont la durée de conservation DU TENANT (`settings.student_retention_days`, jamais une durée légale codée) est
 * écoulée ; conserve le matricule, les faits académiques et financiers. IRRÉVERSIBLE : aucune restauration n'existe.
 */
export async function anonymizeStudent(deps: PeopleDeps, ctx: RequestContext, studentId: string, input: { reason: string }): Promise<Result<{ studentId: string; anonymizedAt: string }, AppError>> {
  const storage = deps.storage;
  const result = await inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const today = todayOf(deps);
    const settings = await ensureTenantDefaults(tx, ctx.tenantId, deps.newId, now);
    const locked = await repo.lockStudent(tx, ctx.tenantId, studentId);
    if (!locked) return err(PeopleErrors.studentNotFound(studentId));
    const row = await repo.getStudentRow(tx, ctx.tenantId, studentId);
    if (!row) return err(PeopleErrors.studentNotFound(studentId));
    if (row.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
    if (row.status !== "ARCHIVED") return err(PeopleErrors.notArchived());
    if (settings.studentRetentionDays === null) return err(PeopleErrors.retentionNotConfigured());
    const archived = await repo.lastArchivedAt(tx, ctx.tenantId, studentId);
    const archivedOn = archived?.effectiveOn ?? isoDate(row.updatedAt);
    const eligibleOn = addDays(archivedOn, settings.studentRetentionDays);
    if (today < eligibleOn) return err(PeopleErrors.retentionNotElapsed(eligibleOn));

    const keys: string[] = [];
    if (row.photoObjectKey) keys.push(row.photoObjectKey);
    keys.push(...(await repo.neutralizePriorEducation(tx, ctx.tenantId, studentId, now)));
    keys.push(...(await documentsRepo.wipeAllDocuments(tx, ctx.tenantId, studentId, "Anonymisation du dossier", now)));
    await repo.deleteAllEmergencyContacts(tx, ctx.tenantId, studentId);
    await repo.wipeStudentSensitive(tx, ctx.tenantId, studentId, now);
    await anonymizePerson(tx, ctx.tenantId, locked.personId, now);

    const buffer = new EventBuffer(deps, ctx);
    buffer.add(PEOPLE_EVENTS.studentAnonymized, { v: 1, studentId }, { type: "student", id: studentId });
    buffer.audit({ action: "people.student.anonymized", entity: "student", entityId: studentId, severity: "critical", reason: input.reason });
    await buffer.flush(tx);
    return ok({ studentId, anonymizedAt: now.toISOString(), keys });
  });
  if (!result.ok) return result;
  if (storage) {
    for (const key of result.value.keys) {
      await storage.delete(key).catch((e: unknown) => deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "people : suppression d'une pièce en échec"));
    }
  }
  return ok({ studentId: result.value.studentId, anonymizedAt: result.value.anonymizedAt });
}

