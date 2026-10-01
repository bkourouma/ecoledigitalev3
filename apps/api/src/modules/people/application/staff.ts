/**
 * Cas d'usage du personnel (spec 009) : fiche, statut, affiliations, contrats (ni tarif ni salaire — paie 032),
 * qualifications, compétences, disponibilités, charge d'enseignement.
 *
 * Une seule entité `staff` pour enseignants, éducateurs, administratifs, direction et appui, fondée sur la même `persons`
 * que les élèves et les tuteurs (une personne peut être parent ET enseignant). Aucune suppression physique. Les contrats
 * sont des données sensibles : leur lecture et leur modification sont auditées.
 */
import { ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation, pgErrorCode, type Tx } from "@ecoledigitale/database";
import {
  PEOPLE_EVENTS,
  type PeopleAvailabilityDto,
  type PeopleContractBody,
  type PeopleContractDto,
  type PeopleCreateStaffBody,
  type PeopleDuplicateCandidateDto,
  type PeopleQualificationDto,
  type PeopleStaffDetailDto,
  type PeopleStaffSummaryDto,
  type PeopleUpdateStaffBody,
} from "@ecoledigitale/contracts/src/v2/people";
import { PeopleErrors } from "../domain/errors";
import { normalizePhone } from "../domain/normalize";
import { formatNumber } from "../domain/number-pattern";
import { canTransitionStaff, deactivatesStaff } from "../domain/status";
import { contractualHours, summarizePlannedHours } from "../domain/teaching-load";
import { getPerson, insertPerson, updatePerson, type PersonPatchValues } from "../infrastructure/persons-repo";
import { getContractType, getStaffCategory, nextNumber } from "../infrastructure/reference-repo";
import * as repo from "../infrastructure/staff-repo";
import * as teaching from "../infrastructure/teaching-repo";
import { actorId, clampPage, EventBuffer, inTx, todayOf, type PeopleDeps } from "./deps";
import { changedPersonFields, defaultCountryOf, detectDuplicates, loadSettings, lockKey, normalizePersonInput, SEE_NO_ROLE, toNewPerson, type RoleVisibility } from "./support";
import { availabilityView, contractView, qualificationView, staffDetailView, staffStatusHistoryView, staffSummaryView } from "./views";

async function detail(tx: Tx, tenantId: string, staffId: string): Promise<PeopleStaffDetailDto | null> {
  const row = await repo.getStaffRow(tx, tenantId, staffId);
  return row ? staffDetailView(row, await repo.listAffiliations(tx, tenantId, staffId)) : null;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function getStaff(deps: PeopleDeps, ctx: RequestContext, staffId: string): Promise<Result<PeopleStaffDetailDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const view = await detail(tx, ctx.tenantId, staffId);
      return view ? ok(view) : err(PeopleErrors.staffNotFound(staffId));
    },
    { readOnly: true },
  );
}

export interface StaffBrief {
  staffId: string;
  displayName: string;
  categoryCode: string;
  status: string;
  staffNumber: string;
  email: string | null;
  phone: string | null;
}

/** Fiches résumées par lots (scheduling, attendance, paie, évaluations) : une requête, identifiants inconnus ignorés. */
export async function getStaffByIds(deps: PeopleDeps, ctx: RequestContext, ids: readonly string[]): Promise<Result<StaffBrief[], AppError>> {
  if (ids.length > deps.config.maxBatchSize) return err(ValidationError.field("ids", `Au plus ${deps.config.maxBatchSize} identifiants par appel.`, "too_many"));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await repo.getStaffRows(tx, ctx.tenantId, [...new Set(ids)]);
      return ok(rows.map((r) => ({ staffId: r.staffId, displayName: staffSummaryView(r).displayName, categoryCode: r.categoryCode, status: r.status, staffNumber: r.staffNumber, email: r.email, phone: r.phone })));
    },
    { readOnly: true },
  );
}

export async function listStaff(
  deps: PeopleDeps,
  ctx: RequestContext,
  query: { q?: string | undefined; status?: string | undefined; categoryCode?: string | undefined; institutionId?: string | undefined; canTeach?: boolean | undefined; sort?: "name" | "load" | undefined; academicYearId?: string | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<Result<{ items: PeopleStaffSummaryDto[]; total: number; limit: number; offset: number }, AppError>> {
  const page = clampPage(deps, query);
  const country = query.q ? await defaultCountryOf(deps, ctx) : null;
  const qPhone = query.q && query.q.replace(/\D/g, "").length >= 5 ? normalizePhone(query.q, country) : null;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      // Le périmètre de lecture suit l'établissement du contexte (R11), en plus de la RLS tenant.
      const institutionId = query.institutionId ?? ctx.institutionId;
      const { rows, total } = await repo.listStaffRows(tx, ctx.tenantId, {
        q: query.q,
        qPhone,
        status: query.status,
        categoryCode: query.categoryCode,
        institutionId,
        canTeach: query.canTeach,
        loadYearId: query.academicYearId,
        sortByLoad: query.sort === "load",
        today: todayOf(deps),
        ...page,
      });
      return ok({ items: rows.map(staffSummaryView), total, ...page });
    },
    { readOnly: true },
  );
}

/** Le dossier de personnel de l'identité (portail enseignant) ; jamais déduit de l'existence de lignes. */
export async function resolveStaffForIdentity(deps: PeopleDeps, ctx: RequestContext, identityId: string): Promise<string | null> {
  return deps.db.run(ctx, async (tx) => (await repo.findStaffByIdentity(tx, ctx.tenantId, identityId))?.staffId ?? null, { readOnly: true });
}

export async function getStaffStatusHistory(deps: PeopleDeps, ctx: RequestContext, staffId: string) {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await repo.getStaffRow(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
      return ok((await repo.listStaffStatusHistory(tx, ctx.tenantId, staffId)).map(staffStatusHistoryView));
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Création et modification
// ---------------------------------------------------------------------------

export type CreateStaffOutcome = { kind: "created"; staff: PeopleStaffDetailDto; replayed: boolean } | { kind: "validated"; duplicates: PeopleDuplicateCandidateDto[] };

/**
 * Crée atomiquement la personne (ou réutilise une personne existante, par exemple un tuteur), la fiche, le numéro
 * gapless, l'historique, l'affiliation principale et l'événement `people.staff.created`. Détecte les doublons (e-mail,
 * nom + date de naissance, téléphone) parmi toutes les personnes du tenant, élèves et tuteurs compris.
 */
export async function createStaff(deps: PeopleDeps, ctx: RequestContext, input: PeopleCreateStaffBody, options: { visibility?: RoleVisibility } = {}): Promise<Result<CreateStaffOutcome, AppError>> {
  const visibility = options.visibility ?? SEE_NO_ROLE;
  const normalized = input.person ? await normalizePersonInput(deps, ctx, input.person) : null;
  if (normalized && !normalized.ok) return normalized;
  const validateOnly = input.validateOnly === true;

  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const today = todayOf(deps);
    const settings = await loadSettings(deps, tx, ctx, { write: !validateOnly });
    const category = await getStaffCategory(tx, ctx.tenantId, input.categoryCode);
    if (!category || !category.active) return err(PeopleErrors.categoryUnknown(input.categoryCode));

    if (input.externalRef) {
      await lockKey(tx, ctx, "staff-ref", input.externalRef);
      const existing = await repo.findStaffByExternalRef(tx, ctx.tenantId, input.externalRef);
      if (existing) return ok<CreateStaffOutcome>({ kind: "created", staff: staffDetailView(existing, await repo.listAffiliations(tx, ctx.tenantId, existing.staffId)), replayed: true });
    }

    let personId: string;
    let reused = false;
    let duplicates: PeopleDuplicateCandidateDto[] = [];
    if (input.personId) {
      const person = await getPerson(tx, ctx.tenantId, input.personId, { forUpdate: true });
      if (!person) return err(PeopleErrors.personNotFound(input.personId));
      if (person.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
      if (await repo.findStaffByPerson(tx, ctx.tenantId, person.personId)) return err(PeopleErrors.personAlreadyStaff());
      personId = person.personId;
      reused = true;
    } else {
      const values = (normalized as { ok: true; value: PersonPatchValues }).value;
      if (settings.duplicateCheckEnabled) {
        duplicates = await detectDuplicates(tx, ctx, { lastName: values.lastName as string, firstName: values.firstName as string, otherNames: values.otherNames, birthDate: values.birthDate, email: values.email, phone: values.phone }, visibility, {
          contactSignals: true,
        });
      }
      personId = deps.newId();
    }
    if (validateOnly) return ok<CreateStaffOutcome>({ kind: "validated", duplicates });
    if (duplicates.length > 0 && !input.acknowledgeDuplicate) return err(PeopleErrors.possibleDuplicate(duplicates));

    try {
      if (!reused) {
        const values = (normalized as { ok: true; value: PersonPatchValues }).value;
        await insertPerson(tx, ctx.tenantId, toNewPerson(personId, values), now);
      }
      const seq = await nextNumber(tx, "STAFF");
      const staffNumber = formatNumber(settings.staffNumberPattern, { seq, year: now.getUTCFullYear(), prefix: settings.numberPrefix });
      const staffId = deps.newId();
      await repo.insertStaff(tx, ctx.tenantId, { id: staffId, personId, staffNumber, categoryCode: input.categoryCode, jobTitle: input.jobTitle, hiredOn: input.hiredOn, primaryInstitutionId: input.primaryInstitutionId, primaryCampusId: input.primaryCampusId, attributes: input.attributes, externalRef: input.externalRef }, now);
      await repo.insertStaffStatusHistory(tx, ctx.tenantId, { id: deps.newId(), staffId, fromStatus: null, toStatus: "ACTIVE", effectiveOn: input.hiredOn && input.hiredOn <= today ? input.hiredOn : today, changedBy: actorId(ctx) }, now);
      if (input.primaryInstitutionId) {
        await repo.replaceAffiliations(tx, ctx.tenantId, staffId, [{ id: deps.newId(), institutionId: input.primaryInstitutionId, campusId: input.primaryCampusId ?? null, validFrom: input.hiredOn ?? today, validTo: null }], now);
      }
      const buffer = new EventBuffer(deps, ctx);
      buffer.add(PEOPLE_EVENTS.staffCreated, { v: 1, staffId, personId, categoryCode: input.categoryCode }, { type: "staff", id: staffId });
      buffer.audit({ action: "people.staff.created", entity: "staff", entityId: staffId, metadata: { personId, categoryCode: input.categoryCode, reusedPerson: reused } });
      if (duplicates.length > 0) {
        buffer.audit({ action: "people.staff.duplicate_acknowledged", entity: "staff", entityId: staffId, severity: "notice", reason: input.duplicateReason ?? null, metadata: { candidates: duplicates.map((d) => d.personId) } });
      }
      await buffer.flush(tx);
      const view = await detail(tx, ctx.tenantId, staffId);
      if (!view) throw new Error("Fiche introuvable après création.");
      return ok<CreateStaffOutcome>({ kind: "created", staff: view, replayed: false });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const text = `${(e as { constraint?: string }).constraint ?? ""} ${(e as Error).message ?? ""}`;
        return err(text.includes("external_ref") ? PeopleErrors.externalRefConflict() : PeopleErrors.personAlreadyStaff());
      }
      throw e;
    }
  });
}

export async function updateStaff(deps: PeopleDeps, ctx: RequestContext, staffId: string, patch: PeopleUpdateStaffBody): Promise<Result<PeopleStaffDetailDto, AppError>> {
  const person = patch.person ? await normalizePersonInput(deps, ctx, patch.person) : null;
  if (person && !person.ok) return person;
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const locked = await repo.lockStaff(tx, ctx.tenantId, staffId);
    if (!locked) return err(PeopleErrors.staffNotFound(staffId));
    if (patch.categoryCode && patch.categoryCode !== locked.categoryCode) {
      const cat = await getStaffCategory(tx, ctx.tenantId, patch.categoryCode);
      if (!cat || !cat.active) return err(PeopleErrors.categoryUnknown(patch.categoryCode));
      if (!cat.canTeach) {
        const active = await teaching.listAssignmentRows(tx, ctx.tenantId, { staffId, status: "ACTIVE" });
        if (active.length > 0) return err(PeopleErrors.categoryForbidden(cat.code));
      }
    }
    const personPatch = person?.value ?? {};
    try {
      if (Object.keys(personPatch).length > 0) await updatePerson(tx, ctx.tenantId, locked.personId, personPatch, now);
      await repo.updateStaff(tx, ctx.tenantId, staffId, { categoryCode: patch.categoryCode, jobTitle: patch.jobTitle, hiredOn: patch.hiredOn, primaryInstitutionId: patch.primaryInstitutionId, primaryCampusId: patch.primaryCampusId, attributes: patch.attributes, externalRef: patch.externalRef }, now);
    } catch (e) {
      if (isUniqueViolation(e)) return err(PeopleErrors.externalRefConflict());
      throw e;
    }
    const fields = [...changedPersonFields(personPatch), ...Object.keys(patch).filter((k) => k !== "person").sort()];
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(PEOPLE_EVENTS.staffUpdated, { v: 1, staffId, fields }, { type: "staff", id: staffId });
    buffer.audit({ action: "people.staff.updated", entity: "staff", entityId: staffId, metadata: { fields } });
    await buffer.flush(tx);
    const view = await detail(tx, ctx.tenantId, staffId);
    return view ? ok(view) : err(PeopleErrors.staffNotFound(staffId));
  });
}

// ---------------------------------------------------------------------------
// Statut
// ---------------------------------------------------------------------------

/**
 * Change le statut. Passer à `LEFT` exige un motif, pose `left_on` et CLÔT les affectations actives dans la même
 * transaction (événements `people.teaching_assignment.ended`) ; la réembauche (`LEFT` → `ACTIVE`) conserve le numéro. Un
 * congé n'a JAMAIS d'effet automatique sur le statut (décision E15).
 */
export async function changeStaffStatus(
  deps: PeopleDeps,
  ctx: RequestContext,
  staffId: string,
  input: { status: PeopleStaffDetailDto["status"]; reasonText?: string | undefined; effectiveOn?: string | undefined; leftOn?: string | undefined },
): Promise<Result<PeopleStaffDetailDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const today = todayOf(deps);
    const locked = await repo.lockStaff(tx, ctx.tenantId, staffId);
    if (!locked) return err(PeopleErrors.staffNotFound(staffId));
    const from = locked.status;
    const to = input.status;
    if (from === to || !canTransitionStaff(from, to)) return err(PeopleErrors.invalidTransition(from, to));
    const effectiveOn = input.effectiveOn ?? today;
    if (effectiveOn > today) return err(ValidationError.field("effectiveOn", "La date d'effet ne peut pas être dans le futur.", "future_date"));
    if ((to === "LEFT" || to === "SUSPENDED" || (from === "LEFT" && to === "ACTIVE")) && !input.reasonText?.trim()) return err(PeopleErrors.reasonRequired(`passage de ${from} à ${to}`));
    const current = await repo.getStaffRow(tx, ctx.tenantId, staffId);
    const leftOn = to === "LEFT" ? (input.leftOn ?? effectiveOn) : from === "LEFT" ? null : undefined;
    if (to === "LEFT" && current?.hiredOn && leftOn && leftOn < current.hiredOn) return err(ValidationError.field("leftOn", "La date de départ précède la date d'embauche.", "before_hire"));
    await repo.setStaffStatus(tx, ctx.tenantId, staffId, to, leftOn, now);
    await repo.insertStaffStatusHistory(tx, ctx.tenantId, { id: deps.newId(), staffId, fromStatus: from, toStatus: to, reasonText: input.reasonText, effectiveOn, changedBy: actorId(ctx) }, now);

    const buffer = new EventBuffer(deps, ctx);
    if (to === "LEFT") {
      const ended = await teaching.endAllActiveOfStaff(tx, ctx.tenantId, staffId, leftOn ?? effectiveOn, now);
      for (const a of ended) {
        await teaching.insertAssignmentHistory(tx, ctx.tenantId, { id: deps.newId(), assignmentId: a.id, kind: "ENDED", reason: "Départ du personnel", actorId: actorId(ctx) }, now);
        buffer.add(PEOPLE_EVENTS.teachingAssignmentEnded, { v: 1, assignmentId: a.id, staffId, classroomId: a.classroomId, reason: "STAFF_LEFT" }, { type: "teaching_assignment", id: a.id });
      }
    }
    buffer.add(PEOPLE_EVENTS.staffStatusChanged, { v: 1, staffId, fromStatus: from, toStatus: to, effectiveOn }, { type: "staff", id: staffId });
    if (deactivatesStaff(to)) buffer.add(PEOPLE_EVENTS.staffDeactivated, { v: 1, staffId, toStatus: to, effectiveOn }, { type: "staff", id: staffId });
    buffer.audit({ action: "people.staff.status_changed", entity: "staff", entityId: staffId, severity: "notice", reason: input.reasonText ?? null, metadata: { from, to, effectiveOn } });
    await buffer.flush(tx);
    const view = await detail(tx, ctx.tenantId, staffId);
    return view ? ok(view) : err(PeopleErrors.staffNotFound(staffId));
  });
}

// ---------------------------------------------------------------------------
// Affiliations
// ---------------------------------------------------------------------------

export async function setAffiliations(
  deps: PeopleDeps,
  ctx: RequestContext,
  staffId: string,
  items: ReadonlyArray<{ institutionId: string; campusId?: string | null | undefined; validFrom?: string | undefined; validTo?: string | null | undefined }>,
): Promise<Result<PeopleStaffDetailDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const today = todayOf(deps);
    if (!(await repo.lockStaff(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
    try {
      await repo.replaceAffiliations(
        tx,
        ctx.tenantId,
        staffId,
        items.map((a) => ({ id: deps.newId(), institutionId: a.institutionId, campusId: a.campusId ?? null, validFrom: a.validFrom ?? today, validTo: a.validTo ?? null })),
        now,
      );
    } catch (e) {
      if (pgErrorCode(e) === "23P01") return err(ValidationError.field("affiliations", "Deux affiliations se chevauchent pour le même établissement et campus.", "overlap"));
      if (pgErrorCode(e) === "23514") return err(ValidationError.field("affiliations", "Une affiliation se termine avant son début.", "invalid_range"));
      throw e;
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.staff.affiliations_set", entity: "staff", entityId: staffId, metadata: { count: items.length } });
    await buffer.flush(tx);
    const view = await detail(tx, ctx.tenantId, staffId);
    return view ? ok(view) : err(PeopleErrors.staffNotFound(staffId));
  });
}

// ---------------------------------------------------------------------------
// Contrats (sensibles : lecture et modification auditées)
// ---------------------------------------------------------------------------

/** Contrats d'un membre. La lecture est AUDITÉE (`notice`). L'appelant a vérifié `staff.contract.read` (ou `staff.own.read` pour soi-même). */
export async function listContracts(deps: PeopleDeps, ctx: RequestContext, staffId: string): Promise<Result<PeopleContractDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await repo.getStaffRow(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
    const rows = await repo.listContracts(tx, ctx.tenantId, staffId);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.staff_contract.read", entity: "staff", entityId: staffId, severity: "notice", metadata: { count: rows.length } });
    await buffer.flush(tx);
    return ok(rows.map(contractView));
  });
}

function contractDbError(e: unknown): AppError | null {
  const code = pgErrorCode(e);
  if (code === "23P01") return PeopleErrors.contractOverlap();
  if (code === "23514") return ValidationError.field("body", "Dates ou volume horaire incohérents.", "invalid_contract");
  return null;
}

export async function addContract(deps: PeopleDeps, ctx: RequestContext, staffId: string, input: PeopleContractBody): Promise<Result<PeopleContractDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    if (!(await repo.lockStaff(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
    const type = await getContractType(tx, ctx.tenantId, input.contractTypeCode);
    if (!type || !type.active) return err(ValidationError.field("contractTypeCode", `Type de contrat inconnu ou inactif : ${input.contractTypeCode}.`, "people.contract_type_unknown"));
    const id = deps.newId();
    try {
      await repo.insertContract(tx, ctx.tenantId, { id, staffId, contractTypeCode: input.contractTypeCode, startsOn: input.startsOn, endsOn: input.endsOn, committedHours: input.committedHours, committedHoursUnit: input.committedHoursUnit, status: input.status ?? "ACTIVE", note: input.note }, now);
    } catch (e) {
      const mapped = contractDbError(e);
      if (mapped) return err(mapped);
      throw e;
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(PEOPLE_EVENTS.staffContractCreated, { v: 1, staffId, contractId: id, contractTypeCode: input.contractTypeCode, startsOn: input.startsOn }, { type: "staff_contract", id });
    buffer.audit({ action: "people.staff_contract.created", entity: "staff_contract", entityId: id, severity: "notice", metadata: { staffId, contractTypeCode: input.contractTypeCode } });
    await buffer.flush(tx);
    const row = await repo.getContract(tx, ctx.tenantId, staffId, id);
    return row ? ok(contractView(row)) : err(PeopleErrors.contractNotFound(id));
  });
}

export async function updateContract(
  deps: PeopleDeps,
  ctx: RequestContext,
  staffId: string,
  contractId: string,
  patch: { startsOn?: string | undefined; endsOn?: string | null | undefined; committedHours?: number | null | undefined; committedHoursUnit?: string | null | undefined; status?: string | undefined; note?: string | null | undefined },
): Promise<Result<PeopleContractDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await repo.getContract(tx, ctx.tenantId, staffId, contractId);
    if (!current) return err(PeopleErrors.contractNotFound(contractId));
    if (current.status === "ENDED" || current.status === "CANCELLED") return err(PeopleErrors.invalidTransition(current.status, patch.status ?? current.status));
    try {
      await repo.updateContract(tx, ctx.tenantId, contractId, patch, deps.clock.now());
    } catch (e) {
      const mapped = contractDbError(e);
      if (mapped) return err(mapped);
      throw e;
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.staff_contract.updated", entity: "staff_contract", entityId: contractId, severity: "notice", metadata: { staffId, fields: Object.keys(patch).sort() } });
    await buffer.flush(tx);
    const row = await repo.getContract(tx, ctx.tenantId, staffId, contractId);
    return row ? ok(contractView(row)) : err(PeopleErrors.contractNotFound(contractId));
  });
}

export async function endContract(deps: PeopleDeps, ctx: RequestContext, staffId: string, contractId: string, input: { endsOn?: string | undefined } = {}): Promise<Result<PeopleContractDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await repo.getContract(tx, ctx.tenantId, staffId, contractId);
    if (!current) return err(PeopleErrors.contractNotFound(contractId));
    if (current.status === "ENDED" || current.status === "CANCELLED") return err(PeopleErrors.invalidTransition(current.status, "ENDED"));
    const endsOn = input.endsOn ?? todayOf(deps);
    if (endsOn < current.startsOn) return err(ValidationError.field("endsOn", "La date de fin précède le début du contrat.", "before_start"));
    try {
      await repo.updateContract(tx, ctx.tenantId, contractId, { endsOn, status: "ENDED" }, deps.clock.now());
    } catch (e) {
      const mapped = contractDbError(e);
      if (mapped) return err(mapped);
      throw e;
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(PEOPLE_EVENTS.staffContractEnded, { v: 1, staffId, contractId, endsOn }, { type: "staff_contract", id: contractId });
    buffer.audit({ action: "people.staff_contract.ended", entity: "staff_contract", entityId: contractId, severity: "notice", metadata: { staffId, endsOn } });
    await buffer.flush(tx);
    const row = await repo.getContract(tx, ctx.tenantId, staffId, contractId);
    return row ? ok(contractView(row)) : err(PeopleErrors.contractNotFound(contractId));
  });
}

// ---------------------------------------------------------------------------
// Qualifications
// ---------------------------------------------------------------------------

export async function listQualifications(deps: PeopleDeps, ctx: RequestContext, staffId: string): Promise<Result<PeopleQualificationDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await repo.getStaffRow(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
      return ok((await repo.listQualifications(tx, ctx.tenantId, staffId)).map(qualificationView));
    },
    { readOnly: true },
  );
}

export async function addQualification(
  deps: PeopleDeps,
  ctx: RequestContext,
  staffId: string,
  input: { kind: string; label: string; issuer?: string | undefined; obtainedOn?: string | undefined; expiresOn?: string | undefined; note?: string | undefined },
): Promise<Result<PeopleQualificationDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await repo.lockStaff(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
    const id = deps.newId();
    try {
      await repo.insertQualification(tx, ctx.tenantId, { id, staffId, ...input }, deps.clock.now());
    } catch (e) {
      if (pgErrorCode(e) === "23514") return err(ValidationError.field("expiresOn", "L'expiration précède l'obtention.", "invalid_range"));
      throw e;
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.staff_qualification.added", entity: "staff", entityId: staffId, metadata: { qualificationId: id, kind: input.kind } });
    await buffer.flush(tx);
    const row = await repo.getQualification(tx, ctx.tenantId, staffId, id);
    return row ? ok(qualificationView(row)) : err(PeopleErrors.qualificationNotFound(id));
  });
}

export async function updateQualification(
  deps: PeopleDeps,
  ctx: RequestContext,
  staffId: string,
  id: string,
  patch: { kind?: string | undefined; label?: string | undefined; issuer?: string | null | undefined; obtainedOn?: string | null | undefined; expiresOn?: string | null | undefined; note?: string | null | undefined },
): Promise<Result<PeopleQualificationDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await repo.getQualification(tx, ctx.tenantId, staffId, id))) return err(PeopleErrors.qualificationNotFound(id));
    try {
      await repo.updateQualification(tx, ctx.tenantId, id, patch, deps.clock.now());
    } catch (e) {
      if (pgErrorCode(e) === "23514") return err(ValidationError.field("expiresOn", "L'expiration précède l'obtention.", "invalid_range"));
      throw e;
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.staff_qualification.updated", entity: "staff", entityId: staffId, metadata: { qualificationId: id, fields: Object.keys(patch).sort() } });
    await buffer.flush(tx);
    const row = await repo.getQualification(tx, ctx.tenantId, staffId, id);
    return row ? ok(qualificationView(row)) : err(PeopleErrors.qualificationNotFound(id));
  });
}

export async function removeQualification(deps: PeopleDeps, ctx: RequestContext, staffId: string, id: string): Promise<Result<{ removed: true }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if ((await repo.deleteQualification(tx, ctx.tenantId, staffId, id)) === 0) return err(PeopleErrors.qualificationNotFound(id));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.staff_qualification.removed", entity: "staff", entityId: staffId, metadata: { qualificationId: id } });
    await buffer.flush(tx);
    return ok({ removed: true as const });
  });
}

/** Qualifications qui expirent dans `withinDays` (par défaut `settings.expiry_alert_days` ; aucune durée en dur). */
export async function listExpiringQualifications(deps: PeopleDeps, ctx: RequestContext, options: { asOf?: string | undefined; withinDays?: number | undefined } = {}): Promise<Result<repo.ExpiringRow[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await loadSettings(deps, tx, ctx, { write: false });
      const within = options.withinDays ?? settings.expiryAlertDays;
      if (within === null || within === undefined) return ok([]);
      return ok(await repo.listExpiring(tx, options.asOf ?? todayOf(deps), within));
    },
    { readOnly: true },
  );
}

/**
 * Job quotidien (par tenant) : publie `people.staff_qualification.expiring` UNE fois par franchissement de seuil
 * (idempotent : `expiry_alerted_for` mémorise la date d'expiration déjà signalée). Sans préavis configuré, aucune alerte.
 */
export async function emitExpiringQualifications(deps: PeopleDeps, ctx: RequestContext, options: { asOf?: string | undefined } = {}): Promise<Result<{ emitted: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const settings = await loadSettings(deps, tx, ctx, { write: false });
    if (settings.expiryAlertDays === null) return ok({ emitted: 0 });
    const asOf = options.asOf ?? todayOf(deps);
    const rows = await repo.lockUnalertedExpiring(tx, ctx.tenantId, asOf, settings.expiryAlertDays);
    const buffer = new EventBuffer(deps, ctx);
    for (const r of rows) {
      buffer.add(
        PEOPLE_EVENTS.staffQualificationExpiring,
        { v: 1, staffId: r.staffId, qualificationId: r.qualificationId, expiresOn: r.expiresOn, daysLeft: r.daysLeft },
        { type: "staff_qualification", id: r.qualificationId },
      );
      await repo.markQualificationAlerted(tx, ctx.tenantId, r.qualificationId, r.expiresOn);
    }
    await buffer.flush(tx);
    return ok({ emitted: rows.length });
  });
}

// ---------------------------------------------------------------------------
// Compétences et disponibilités
// ---------------------------------------------------------------------------

export async function listCompetencies(deps: PeopleDeps, ctx: RequestContext, staffId: string): Promise<Result<repo.CompetencyRow[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await repo.getStaffRow(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
      return ok(await repo.listCompetencies(tx, ctx.tenantId, staffId));
    },
    { readOnly: true },
  );
}

/** Remplace les compétences d'enseignement (information de planification : avertissement, jamais blocage). */
export async function setCompetencies(deps: PeopleDeps, ctx: RequestContext, staffId: string, items: ReadonlyArray<{ subjectId: string; gradeLevelCodes?: readonly string[] | undefined }>): Promise<Result<repo.CompetencyRow[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await repo.lockStaff(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
    const seen = new Set<string>();
    for (const i of items) {
      if (seen.has(i.subjectId)) return err(ValidationError.field("competencies", "Une matière ne peut figurer qu'une fois.", "duplicate"));
      seen.add(i.subjectId);
    }
    await repo.replaceCompetencies(tx, ctx.tenantId, staffId, items.map((i) => ({ id: deps.newId(), subjectId: i.subjectId, gradeLevelCodes: i.gradeLevelCodes ?? [] })), deps.clock.now());
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.staff.competencies_set", entity: "staff", entityId: staffId, metadata: { count: items.length } });
    await buffer.flush(tx);
    return ok(await repo.listCompetencies(tx, ctx.tenantId, staffId));
  });
}

export interface AvailabilityInput {
  campusId?: string | null | undefined;
  weekday: number;
  startTime: string;
  endTime: string;
  kind: "AVAILABLE" | "UNAVAILABLE";
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  reason?: string | null | undefined;
}

/** Remplace les disponibilités hebdomadaires. `UNAVAILABLE` l'emporte ; aucune ligne = décision de scheduling (`OPEN`/`CLOSED`). */
export async function setAvailabilities(deps: PeopleDeps, ctx: RequestContext, staffId: string, items: readonly AvailabilityInput[]): Promise<Result<PeopleAvailabilityDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await repo.lockStaff(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
    try {
      await repo.replaceAvailabilities(
        tx,
        ctx.tenantId,
        staffId,
        items.map((a) => ({ id: deps.newId(), campusId: a.campusId ?? null, weekday: a.weekday, startTime: a.startTime, endTime: a.endTime, kind: a.kind, validFrom: a.validFrom ?? null, validTo: a.validTo ?? null, reason: a.reason ?? null })),
        deps.clock.now(),
      );
    } catch (e) {
      if (pgErrorCode(e) === "23514") return err(ValidationError.field("availabilities", "Créneau invalide : la fin doit suivre le début (pas de chevauchement de minuit).", "invalid_range"));
      throw e;
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.staff.availabilities_set", entity: "staff", entityId: staffId, metadata: { count: items.length } });
    await buffer.flush(tx);
    return ok((await repo.listAvailabilities(tx, ctx.tenantId, [staffId])).map(availabilityView));
  });
}

/** Disponibilités de plusieurs membres sur une période : source des contraintes de scheduling (spec 017). */
export async function listAvailabilities(
  deps: PeopleDeps,
  ctx: RequestContext,
  input: { staffIds: readonly string[]; from?: string | undefined; to?: string | undefined },
): Promise<Result<PeopleAvailabilityDto[], AppError>> {
  if (input.staffIds.length > deps.config.maxBatchSize) return err(ValidationError.field("staffIds", `Au plus ${deps.config.maxBatchSize} identifiants par appel.`, "too_many"));
  return inTx(deps, ctx, async (tx) => ok((await repo.listAvailabilities(tx, ctx.tenantId, [...new Set(input.staffIds)], { from: input.from, to: input.to })).map(availabilityView)), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Charge d'enseignement
// ---------------------------------------------------------------------------

/**
 * Le PRÉVU (heures affectées, par classe et par période) et le CONTRACTUEL (volume des contrats actifs). Aucun seuil,
 * aucune alerte ; le réalisé vient de `scheduling.getStaffWeeklyLoad`.
 */
export async function getTeachingLoad(deps: PeopleDeps, ctx: RequestContext, staffId: string, input: { yearId: string; weeksPerYear?: number | undefined }) {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await repo.getStaffRow(tx, ctx.tenantId, staffId))) return err(PeopleErrors.staffNotFound(staffId));
      const assignments = await teaching.activeAssignmentsOfStaffForYear(tx, ctx.tenantId, staffId, input.yearId);
      const planned = summarizePlannedHours(assignments.map((a) => ({ classroomId: a.classroomId, periodId: a.periodId, plannedHours: a.plannedHours === null ? null : Number(a.plannedHours) })));
      const contracts = await repo.listContracts(tx, ctx.tenantId, staffId);
      const contractual = contractualHours(
        contracts.map((c) => ({ startsOn: c.startsOn, endsOn: c.endsOn, committedHours: c.committedHours === null ? null : Number(c.committedHours), committedHoursUnit: c.committedHoursUnit, status: c.status })),
        todayOf(deps),
        input.weeksPerYear,
      );
      return ok({
        staffId,
        academicYearId: input.yearId,
        plannedHours: planned.total,
        byClassroom: planned.byClassroom,
        byPeriod: planned.byPeriod,
        contractualHoursPerWeek: contractual.perWeek,
        contractualHoursPerYear: contractual.perYear,
        weeksPerYearUsed: contractual.weeksPerYearUsed,
      });
    },
    { readOnly: true },
  );
}
