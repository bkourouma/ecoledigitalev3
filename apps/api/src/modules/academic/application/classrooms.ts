/**
 * Classes / promotions et offres (ex. cohortes d'UE) : création, cycle de vie, ouverture d'un semestre,
 * capacité, finalisation planifiée.
 *
 * `FULL` n'est jamais posé à la main : il est dérivé de la capacité par le déclencheur `sync_offering_fullness`
 * (et recalculé ici quand la capacité ou le statut change sans écriture de sélection).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  AcademicCreateClassroomBody,
  AcademicCreateOfferingBody,
  AcademicOfferingStatus,
  AcademicOpenPeriodOfferingsBody,
} from "@ecoledigitale/contracts/src/v2/academic";
import { CLASSROOM_ACTION_TARGETS, canTransitionClassroom, classroomActivationProblem, classroomDatesProblem, type ClassroomAction } from "../domain/classroom";
import { descendantsOf } from "../domain/curriculum";
import { civilDateOf } from "../domain/dates";
import { AcademicCode, conflict, notFound, validation } from "../domain/errors";
import { AcademicEvents, OFFERING_STATUS_EVENTS } from "../domain/events";
import { canTransitionOffering, checkOfferingDates, deriveOfferingStatus, isOfferingReopening, shouldFinalizeOffering } from "../domain/offering";
import type { AcademicYear, Classroom, CurriculumNode, NodeType, Offering } from "../domain/records";
import * as cal from "../infrastructure/calendar-repository";
import * as repo from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as enr from "../infrastructure/enrollment-repository";
import * as ref from "../infrastructure/reference-repository";
import { loadClassroomInScope } from "./calendar";
import { EventBuffer, actorId, assertInstitutionScope, inReadTx, inTx, type AcademicDeps } from "./deps";

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export async function getClassroom(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<Classroom, AppError>> {
  return inReadTx(deps, ctx, (tx) => loadClassroomInScope(tx, ctx, id));
}

export async function listClassrooms(
  deps: AcademicDeps,
  ctx: RequestContext,
  filter: { institutionId?: string | null; academicYearId?: string | null; programId?: string | null; gradeLevelId?: string | null; status?: string | null; page?: number; pageSize?: number } = {},
): Promise<Result<{ items: Classroom[]; total: number; page: number; pageSize: number }, AppError>> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? deps.config.defaultPageSize));
  return inReadTx(deps, ctx, async (tx) => {
    const r = await repo.listClassrooms(tx, {
      institutionId: filter.institutionId ?? ctx.institutionId ?? null,
      campusId: ctx.campusId ?? null,
      academicYearId: filter.academicYearId ?? null,
      programId: filter.programId ?? null,
      gradeLevelId: filter.gradeLevelId ?? null,
      status: filter.status ?? null,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return ok({ ...r, page, pageSize });
  });
}

function classroomEventPayload(c: Classroom): Record<string, unknown> & { v: 1 } {
  return { v: 1, institutionId: c.institutionId, academicYearId: c.academicYearId, classroomId: c.id, programId: c.programId, gradeLevelId: c.gradeLevelId, status: c.status };
}

export async function createClassroom(deps: AcademicDeps, ctx: RequestContext, input: AcademicCreateClassroomBody): Promise<Result<Classroom, AppError>> {
  const scope = assertInstitutionScope(ctx, input.institutionId);
  if (!scope.ok) return scope;
  // Même garde que createAcademicYear / createProgram : un établissement inconnu est « introuvable », pas une
  // incohérence année/établissement.
  const info = await deps.ports.institutions.getInstitution(ctx, input.institutionId);
  if (!info) return err(notFound(AcademicCode.INSTITUTION_NOT_FOUND, "Établissement", input.institutionId));
  return inTx(deps, ctx, async (tx) => {
    const year = await cal.getYear(tx, input.academicYearId);
    if (!year || year.institutionId !== input.institutionId) {
      return err(year ? validation(AcademicCode.CLASSROOM_YEAR_INSTITUTION, "L'année appartient à un autre établissement.", "academicYearId") : notFound(AcademicCode.YEAR_NOT_FOUND, "Année académique", input.academicYearId));
    }
    if (year.status === "CLOSED" || year.status === "ARCHIVED") return err(conflict(AcademicCode.YEAR_NOT_EDITABLE, "L'année est close : on n'y crée plus de classe."));
    const program = await cur.getProgram(tx, input.programId);
    if (!program || program.institutionId !== input.institutionId) return err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme", input.programId));
    if (program.status !== "ACTIVE") return err(conflict(AcademicCode.PROGRAM_NOT_FOUND, "Le programme est archivé.", { programId: program.id }));
    if (!program.gradeLevelIds.includes(input.gradeLevelId)) return err(validation(AcademicCode.CLASSROOM_LEVEL_NOT_IN_PROGRAM, "Le niveau n'est pas couvert par le programme.", "gradeLevelId"));
    if (input.curriculumVersionId) {
      const v = await cur.getVersion(tx, input.curriculumVersionId);
      if (!v) return err(notFound(AcademicCode.CURRICULUM_NOT_FOUND, "Curriculum", input.curriculumVersionId));
      if (v.programId !== input.programId || v.academicYearId !== input.academicYearId) {
        return err(validation(AcademicCode.CLASSROOM_CURRICULUM_MISMATCH, "La version de curriculum ne correspond pas au programme et à l'année de la classe.", "curriculumVersionId"));
      }
    }
    if (classroomDatesProblem(input.startsOn ?? null, input.endsOn ?? null)) return err(validation(AcademicCode.INVALID_INPUT, "La fin de la classe précède son début.", "endsOn"));
    if ((input.startsOn && input.startsOn < year.startsOn) || (input.endsOn && input.endsOn > year.endsOn)) {
      return err(validation(AcademicCode.INVALID_INPUT, "Les dates de la classe dépassent l'année.", "startsOn"));
    }
    const id = deps.newId();
    await repo.insertClassroom(tx, {
      id,
      institutionId: input.institutionId,
      campusId: input.campusId ?? ctx.campusId ?? null,
      academicYearId: input.academicYearId,
      programId: input.programId,
      gradeLevelId: input.gradeLevelId,
      curriculumVersionId: input.curriculumVersionId ?? null,
      kind: input.kind ?? "CLASS",
      code: input.code,
      name: input.name,
      capacity: input.capacity ?? null,
      capacityIsHard: input.capacityIsHard ?? true,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
    });
    const created = (await repo.getClassroom(tx, id)) as Classroom;
    const events = new EventBuffer(deps, ctx);
    events.add(AcademicEvents.CLASSROOM_CREATED, classroomEventPayload(created), { type: "classroom", id });
    await events.flush(tx);
    return ok(created);
  });
}

export async function updateClassroom(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  patch: { campusId?: string | null | undefined; curriculumVersionId?: string | null | undefined; name?: string | undefined; code?: string | undefined; capacity?: number | null | undefined; capacityIsHard?: boolean | undefined; startsOn?: string | null | undefined; endsOn?: string | null | undefined },
): Promise<Result<Classroom, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadClassroomInScope(tx, ctx, id);
    if (!l.ok) return l;
    const c = l.value;
    if (c.status !== "DRAFT" && c.status !== "ACTIVE") return err(conflict(AcademicCode.CLASSROOM_TRANSITION, `La classe est ${c.status} : elle n'est plus modifiable.`));
    if (patch.curriculumVersionId !== undefined && patch.curriculumVersionId !== c.curriculumVersionId) {
      if ((await repo.listOfferings(tx, { classroomId: id })).length > 0) {
        return err(conflict("academic.classroom_has_offerings", "La classe a des offres : son curriculum ne change plus."));
      }
      if (patch.curriculumVersionId) {
        const v = await cur.getVersion(tx, patch.curriculumVersionId);
        if (!v) return err(notFound(AcademicCode.CURRICULUM_NOT_FOUND, "Curriculum", patch.curriculumVersionId));
        if (v.programId !== c.programId || v.academicYearId !== c.academicYearId) return err(validation(AcademicCode.CLASSROOM_CURRICULUM_MISMATCH, "La version de curriculum ne correspond pas au programme et à l'année.", "curriculumVersionId"));
      } else if (c.status === "ACTIVE") {
        return err(validation(AcademicCode.CLASSROOM_CURRICULUM_REQUIRED, "Une classe active exige un curriculum.", "curriculumVersionId"));
      }
    }
    if (patch.capacity !== undefined && patch.capacity !== null && patch.capacity < c.enrolledCount && (patch.capacityIsHard ?? c.capacityIsHard)) {
      return err(conflict(AcademicCode.CAPACITY_BELOW_RESERVED, `La classe compte déjà ${c.enrolledCount} inscrit(s) : la capacité ne peut pas être inférieure.`));
    }
    const startsOn = patch.startsOn !== undefined ? patch.startsOn : c.startsOn;
    const endsOn = patch.endsOn !== undefined ? patch.endsOn : c.endsOn;
    if (classroomDatesProblem(startsOn, endsOn)) return err(validation(AcademicCode.INVALID_INPUT, "La fin de la classe précède son début.", "endsOn"));
    const clean: Parameters<typeof repo.updateClassroom>[2] = {};
    for (const key of ["campusId", "curriculumVersionId", "name", "code", "capacity", "capacityIsHard", "startsOn", "endsOn"] as const) {
      if (patch[key] !== undefined) (clean as Record<string, unknown>)[key] = patch[key];
    }
    await repo.updateClassroom(tx, id, clean);
    return ok((await repo.getClassroom(tx, id)) as Classroom);
  });
}

/** Cycle de la classe : `activate` (curriculum publié exigé), `complete`, `cancel` (refusé s'il reste des inscrits vivants). */
export async function classroomAction(deps: AcademicDeps, ctx: RequestContext, id: string, action: ClassroomAction, reason?: string | null): Promise<Result<Classroom, AppError>> {
  const target = CLASSROOM_ACTION_TARGETS[action];
  return inTx(deps, ctx, async (tx) => {
    const l = await loadClassroomInScope(tx, ctx, id);
    if (!l.ok) return l;
    const c = l.value;
    if (!canTransitionClassroom(c.status, target)) return err(conflict(AcademicCode.CLASSROOM_TRANSITION, `Transition interdite pour la classe : ${c.status} -> ${target}.`, { from: c.status, to: target }));
    if (target === "ACTIVE") {
      const version = c.curriculumVersionId ? await cur.getVersion(tx, c.curriculumVersionId) : null;
      const problem = classroomActivationProblem({ curriculumVersionId: c.curriculumVersionId, versionStatus: version?.status ?? null });
      if (problem === "curriculum_required") return err(conflict(AcademicCode.CLASSROOM_CURRICULUM_REQUIRED, "Choisissez un curriculum avant d'activer la classe."));
      if (problem === "curriculum_draft") return err(conflict(AcademicCode.CLASSROOM_CURRICULUM_DRAFT, "Le curriculum doit être publié avant d'activer la classe."));
    }
    if (target === "CANCELLED") {
      if ((reason?.trim().length ?? 0) < 5) return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis pour annuler une classe.", "reason"));
      if ((await repo.classroomEnrollmentCount(tx, id)) > 0) return err(conflict("academic.classroom_has_enrollments", "La classe a des inscriptions : transférez-les ou annulez-les d'abord."));
    }
    await repo.setClassroomStatus(tx, id, target);
    const updated = (await repo.getClassroom(tx, id)) as Classroom;
    const events = new EventBuffer(deps, ctx);
    events.add(
      target === "ACTIVE" ? AcademicEvents.CLASSROOM_ACTIVATED : target === "COMPLETED" ? AcademicEvents.CLASSROOM_COMPLETED : AcademicEvents.CLASSROOM_CANCELLED,
      classroomEventPayload(updated),
      { type: "classroom", id },
    );
    await events.flush(tx);
    return ok(updated);
  });
}

// ---------------------------------------------------------------------------
// Offres
// ---------------------------------------------------------------------------

async function loadOfferingInScope(tx: Tx, ctx: RequestContext, id: string, forUpdate = false): Promise<Result<{ offering: Offering; classroom: Classroom }, AppError>> {
  const offering = await repo.getOffering(tx, id, { forUpdate });
  if (!offering) return err(notFound(AcademicCode.OFFERING_NOT_FOUND, "Offre", id));
  const c = await loadClassroomInScope(tx, ctx, offering.classroomId);
  if (!c.ok) return err(notFound(AcademicCode.OFFERING_NOT_FOUND, "Offre", id));
  return ok({ offering, classroom: c.value });
}

export async function getOffering(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<Offering, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const l = await loadOfferingInScope(tx, ctx, id);
    return l.ok ? ok(l.value.offering) : l;
  });
}

export async function listOfferings(deps: AcademicDeps, ctx: RequestContext, filter: { classroomId?: string | null; status?: string | null } = {}): Promise<Result<Offering[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    if (filter.classroomId) {
      const c = await loadClassroomInScope(tx, ctx, filter.classroomId);
      if (!c.ok) return c;
    }
    return ok(await repo.listOfferings(tx, { classroomId: filter.classroomId ?? null, status: filter.status ?? null, institutionId: filter.classroomId ? null : (ctx.institutionId ?? null) }));
  });
}

async function offeringPayload(tx: Tx, o: Offering, c: Classroom, reason: string | null = null): Promise<Record<string, unknown> & { v: 1 }> {
  const node = await cur.getNode(tx, o.curriculumNodeId);
  return {
    v: 1,
    institutionId: c.institutionId,
    academicYearId: c.academicYearId,
    offeringId: o.id,
    classroomId: o.classroomId,
    curriculumNodeId: o.curriculumNodeId,
    lineageId: node?.lineageId ?? null,
    status: o.status,
    reason,
  };
}

/** Nœud offrable : actif, d'un type inscriptible, jamais transversal, dans le curriculum de la classe. */
function offerableProblem(node: CurriculumNode | null, type: NodeType | undefined, classroom: Classroom): AppError | null {
  if (!node || classroom.curriculumVersionId === null || node.versionId !== classroom.curriculumVersionId) {
    return validation(AcademicCode.OFFERING_NODE_NOT_IN_CURRICULUM, "Le nœud n'appartient pas au curriculum de la classe.", "curriculumNodeId");
  }
  if (!type?.isEnrollable) return validation(AcademicCode.OFFERING_NODE_NOT_ENROLLABLE, `Un nœud ${node.nodeTypeCode} ne s'offre pas à l'inscription.`, "curriculumNodeId");
  if (node.isTransversal) return validation(AcademicCode.OFFERING_NODE_TRANSVERSAL, "Une matière transversale n'est jamais offerte à l'inscription.", "curriculumNodeId");
  if (node.status !== "ACTIVE") return validation(AcademicCode.OFFERING_NODE_INACTIVE, "Le nœud est inactif.", "curriculumNodeId");
  return null;
}

function datesProblem(year: AcademicYear, body: { startsOn: string; endsOn: string; registrationOpensAt?: string | null | undefined; registrationClosesAt?: string | null | undefined }): AppError | null {
  const p = checkOfferingDates({ startsOn: body.startsOn, endsOn: body.endsOn, yearStartsOn: year.startsOn, yearEndsOn: year.endsOn, registrationOpensAt: body.registrationOpensAt ?? null, registrationClosesAt: body.registrationClosesAt ?? null });
  return p ? validation(p.code, p.message, "startsOn") : null;
}

export async function createOffering(deps: AcademicDeps, ctx: RequestContext, classroomId: string, body: AcademicCreateOfferingBody): Promise<Result<Offering, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadClassroomInScope(tx, ctx, classroomId);
    if (!l.ok) return l;
    const classroom = l.value;
    if (classroom.status === "CANCELLED" || classroom.status === "ARCHIVED") return err(conflict(AcademicCode.CLASSROOM_TRANSITION, `La classe est ${classroom.status}.`));
    const year = (await cal.getYear(tx, classroom.academicYearId)) as AcademicYear;
    const dp = datesProblem(year, body);
    if (dp) return err(dp);
    const node = await cur.getNode(tx, body.curriculumNodeId);
    const types = await ref.listNodeTypes(tx);
    const problem = offerableProblem(node, types.find((t) => t.code === node?.nodeTypeCode), classroom);
    if (problem) return err(problem);
    const id = deps.newId();
    await repo.insertOffering(tx, {
      id,
      classroomId,
      curriculumNodeId: body.curriculumNodeId,
      label: body.label ?? (node as CurriculumNode).label,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      registrationOpensAt: body.registrationOpensAt ?? null,
      registrationClosesAt: body.registrationClosesAt ?? null,
      capacity: body.capacity ?? null,
    });
    return ok((await repo.getOffering(tx, id)) as Offering);
  });
}

/**
 * Ouvre un semestre pour une classe (AC3.2) : UNE offre par nœud inscriptible du nœud-période, mêmes dates, même
 * fenêtre, même capacité. IDEMPOTENT (`UNIQUE (classe, nœud)`) : un rejeu renvoie les offres existantes sans doublon.
 * Avec `open: true`, chaque offre est ouverte sous réserve de `OfferingReadinessGuard` (tout ou rien).
 */
export async function openOfferingsForPeriod(
  deps: AcademicDeps,
  ctx: RequestContext,
  classroomId: string,
  body: AcademicOpenPeriodOfferingsBody,
): Promise<Result<{ created: Offering[]; existing: Offering[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadClassroomInScope(tx, ctx, classroomId);
    if (!l.ok) return l;
    const classroom = l.value;
    if (classroom.curriculumVersionId === null) return err(conflict(AcademicCode.CLASSROOM_CURRICULUM_REQUIRED, "Choisissez un curriculum pour la classe avant d'ouvrir ses offres."));
    if (classroom.status === "CANCELLED" || classroom.status === "ARCHIVED" || classroom.status === "COMPLETED") return err(conflict(AcademicCode.CLASSROOM_TRANSITION, `La classe est ${classroom.status}.`));
    const year = (await cal.getYear(tx, classroom.academicYearId)) as AcademicYear;
    const dp = datesProblem(year, body);
    if (dp) return err(dp);

    const nodes = await cur.listNodes(tx, classroom.curriculumVersionId);
    const types = new Map((await ref.listNodeTypes(tx)).map((t) => [t.code, t]));
    const periodNode = nodes.find((n) => n.id === body.periodNodeId);
    if (!periodNode) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de période", body.periodNodeId));
    if (!types.get(periodNode.nodeTypeCode)?.requiresPeriodSlot) return err(validation(AcademicCode.INVALID_INPUT, "Le nœud indiqué n'est pas un nœud de période.", "periodNodeId"));

    // Nœuds inscriptibles les plus hauts du sous-arbre (pas d'ancêtre inscriptible entre eux et la période).
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const subtree = descendantsOf(periodNode.id, nodes);
    const candidates = subtree
      .map((id) => byId.get(id) as CurriculumNode)
      .filter((n) => {
        if (offerableProblem(n, types.get(n.nodeTypeCode), classroom)) return false;
        let cursor = n.parentId ? byId.get(n.parentId) : undefined;
        while (cursor && cursor.id !== periodNode.id) {
          if (types.get(cursor.nodeTypeCode)?.isEnrollable) return false;
          cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
        }
        return true;
      })
      .sort((a, b) => a.ordinal - b.ordinal || a.code.localeCompare(b.code));

    const existingOfferings = await repo.listOfferingsOfClassroomNodes(tx, classroomId, candidates.map((n) => n.id));
    const existingByNode = new Map(existingOfferings.map((o) => [o.curriculumNodeId, o]));
    const created: Offering[] = [];
    const events = new EventBuffer(deps, ctx);
    for (const n of candidates) {
      if (existingByNode.has(n.id)) continue;
      const id = deps.newId();
      await repo.insertOffering(tx, {
        id,
        classroomId,
        curriculumNodeId: n.id,
        label: n.label,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
        registrationOpensAt: body.registrationOpensAt ?? null,
        registrationClosesAt: body.registrationClosesAt ?? null,
        capacity: body.capacity ?? null,
      });
      if (body.open) {
        const ready = await deps.ports.readiness.check(ctx, id);
        if (!ready.ok) return err(conflict(AcademicCode.OFFERING_NOT_READY, `L'offre « ${n.label} » ne peut pas être ouverte : responsable d'enseignement manquant.`, { offeringId: id, nodeId: n.id, missing: ready.error.missing }));
        await repo.setOfferingStatus(tx, id, "OPEN");
      }
      const offering = (await repo.getOffering(tx, id)) as Offering;
      if (body.open) events.add(AcademicEvents.OFFERING_OPENED, await offeringPayload(tx, offering, classroom), { type: "offering", id });
      created.push(offering);
    }
    await events.flush(tx);
    return ok({ created, existing: existingOfferings });
  });
}

/** Recalcule `OPEN`/`FULL` (capacité ou statut modifiés hors écriture de sélection). Renvoie l'offre à jour. */
async function resyncFullness(deps: AcademicDeps, tx: Tx, offering: Offering, classroom: Classroom, events: EventBuffer): Promise<Offering> {
  const fresh = (await repo.getOffering(tx, offering.id)) as Offering;
  const derived = deriveOfferingStatus({ status: fresh.status, capacity: fresh.capacity, held: fresh.heldPlaces, registrationClosesAt: fresh.registrationClosesAt, now: deps.clock.now() });
  if (derived === fresh.status) return fresh;
  await repo.setOfferingStatus(tx, fresh.id, derived);
  const updated = (await repo.getOffering(tx, fresh.id)) as Offering;
  events.add(derived === "FULL" ? AcademicEvents.OFFERING_FULL : AcademicEvents.OFFERING_OPENED, await offeringPayload(tx, updated, classroom, derived === "OPEN" ? "place_freed" : null), { type: "offering", id: fresh.id });
  return updated;
}

export async function updateOffering(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  patch: { label?: string | undefined; startsOn?: string | undefined; endsOn?: string | undefined; registrationOpensAt?: string | null | undefined; registrationClosesAt?: string | null | undefined; capacity?: number | null | undefined },
): Promise<Result<Offering, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadOfferingInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const { offering, classroom } = l.value;
    if (offering.status === "COMPLETED" || offering.status === "CANCELLED") return err(conflict(AcademicCode.OFFERING_CLOSED, `L'offre est ${offering.status} : rouvrez-la pour la modifier.`));
    const year = (await cal.getYear(tx, classroom.academicYearId)) as AcademicYear;
    const windowSet = patch.registrationOpensAt !== undefined || patch.registrationClosesAt !== undefined;
    const merged = {
      startsOn: patch.startsOn ?? offering.startsOn,
      endsOn: patch.endsOn ?? offering.endsOn,
      registrationOpensAt: windowSet ? (patch.registrationOpensAt ?? null) : offering.registrationOpensAt,
      registrationClosesAt: windowSet ? (patch.registrationClosesAt ?? null) : offering.registrationClosesAt,
    };
    const dp = datesProblem(year, merged);
    if (dp) return err(dp);
    if (patch.capacity !== undefined && patch.capacity !== null && patch.capacity < offering.heldPlaces) {
      return err(conflict(AcademicCode.CAPACITY_BELOW_RESERVED, `${offering.heldPlaces} place(s) réservée(s) : la capacité ne peut pas être inférieure.`, { held: offering.heldPlaces }));
    }
    const clean: Parameters<typeof repo.updateOffering>[2] = {};
    if (patch.label !== undefined) clean.label = patch.label;
    if (patch.startsOn !== undefined) clean.startsOn = patch.startsOn;
    if (patch.endsOn !== undefined) clean.endsOn = patch.endsOn;
    if (windowSet) {
      clean.windowSet = true;
      clean.registrationOpensAt = merged.registrationOpensAt;
      clean.registrationClosesAt = merged.registrationClosesAt;
    }
    if (patch.capacity !== undefined) clean.capacity = patch.capacity;
    await repo.updateOffering(tx, id, clean);
    const events = new EventBuffer(deps, ctx);
    const updated = await resyncFullness(deps, tx, offering, classroom, events);
    await events.flush(tx);
    return ok(updated);
  });
}

export type OfferingAction = "open" | "start" | "complete" | "cancel";

const OFFERING_ACTION_TARGET: Record<OfferingAction, AcademicOfferingStatus> = { open: "OPEN", start: "IN_PROGRESS", complete: "COMPLETED", cancel: "CANCELLED" };

export async function offeringAction(deps: AcademicDeps, ctx: RequestContext, id: string, action: OfferingAction, reason?: string | null): Promise<Result<Offering, AppError>> {
  const target = OFFERING_ACTION_TARGET[action];
  return inTx(deps, ctx, async (tx) => {
    const l = await loadOfferingInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const { offering, classroom } = l.value;
    if (!canTransitionOffering(offering.status, target) || isOfferingReopening(offering.status, target)) {
      return err(conflict(AcademicCode.OFFERING_TRANSITION, `Transition interdite pour l'offre : ${offering.status} -> ${target}.`, { from: offering.status, to: target }));
    }
    if (action === "cancel" && (reason?.trim().length ?? 0) < 5) return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis pour annuler une offre.", "reason"));
    const events = new EventBuffer(deps, ctx);
    if (action === "open") {
      // Même garde pour TOUS les chemins d'ouverture (bug legacy P-010 : la création directe d'une offre ouverte contournait le garde).
      const ready = await deps.ports.readiness.check(ctx, id);
      if (!ready.ok) return err(conflict(AcademicCode.OFFERING_NOT_READY, "Un responsable d'enseignement est requis pour chaque unité obligatoire avant l'ouverture.", { missing: ready.error.missing }));
    }
    if (action === "cancel") await cancelLiveCourses(deps, ctx, tx, offering, events, "offering_cancelled");
    await repo.setOfferingStatus(tx, id, target);
    let updated = (await repo.getOffering(tx, id)) as Offering;
    events.add(OFFERING_STATUS_EVENTS[target as keyof typeof OFFERING_STATUS_EVENTS], await offeringPayload(tx, updated, classroom, reason ?? null), { type: "offering", id });
    if (action === "open") updated = await resyncFullness(deps, tx, updated, classroom, events);
    await events.flush(tx);
    return ok(updated);
  });
}

/** Annule les sélections vivantes d'une offre annulée (place libérée, finance informée par l'événement). */
async function cancelLiveCourses(deps: AcademicDeps, ctx: RequestContext, tx: Tx, offering: Offering, events: EventBuffer, reason: string): Promise<void> {
  const live = await enr.listLiveCoursesOfOffering(tx, offering.id);
  const node = await cur.getNode(tx, offering.curriculumNodeId);
  for (const c of live) {
    await enr.setCourseStatus(tx, c.id, { status: "CANCELLED", reason });
    await enr.insertHistory(tx, { id: deps.newId(), enrollmentId: c.enrollmentId, kind: "COURSE", from: { courseId: c.id, status: c.status }, to: { courseId: c.id, status: "CANCELLED" }, reason, actorId: actorId(ctx) });
    events.add(
      AcademicEvents.COURSE_CANCELLED,
      {
        v: 1,
        institutionId: c.institutionId,
        academicYearId: c.academicYearId,
        enrollmentId: c.enrollmentId,
        studentId: c.studentId,
        classroomId: c.classroomId,
        enrollmentCourseId: c.id,
        curriculumNodeId: c.curriculumNodeId,
        lineageId: node?.lineageId ?? c.curriculumNodeId,
        offeringId: c.offeringId,
        source: c.source,
        status: "CANCELLED",
        credits: node?.credits ?? null,
        holdExpiresAt: c.holdExpiresAt,
        reason,
      },
      { type: "enrollment_course", id: c.id },
    );
  }
}

/**
 * Réouverture motivée (remplace le « rouvrir un lot » du legacy qui forçait `ouvert` sans contrôle) :
 * `COMPLETED -> OPEN | IN_PROGRESS`, `CANCELLED -> DRAFT`. Exige un motif, une nouvelle date de fin cohérente
 * (dans l'année de la classe) et la permission `academic.classroom.manage` (contrôlée par la route).
 */
export async function reopenOffering(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  input: { reason: string; startsOn?: string | undefined; endsOn: string; registrationOpensAt?: string | null | undefined; registrationClosesAt?: string | null | undefined; status?: "OPEN" | "IN_PROGRESS" | "DRAFT" | undefined },
): Promise<Result<Offering, AppError>> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const l = await loadOfferingInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const { offering, classroom } = l.value;
    const target: AcademicOfferingStatus = offering.status === "CANCELLED" ? "DRAFT" : (input.status ?? "OPEN");
    if (!isOfferingReopening(offering.status, target)) return err(conflict(AcademicCode.OFFERING_TRANSITION, `Seule une offre terminée ou annulée se rouvre (statut : ${offering.status}).`, { from: offering.status, to: target }));
    const year = (await cal.getYear(tx, classroom.academicYearId)) as AcademicYear;
    const windowSet = input.registrationOpensAt !== undefined || input.registrationClosesAt !== undefined;
    const merged = {
      startsOn: input.startsOn ?? offering.startsOn,
      endsOn: input.endsOn,
      registrationOpensAt: windowSet ? (input.registrationOpensAt ?? null) : offering.registrationOpensAt,
      registrationClosesAt: windowSet ? (input.registrationClosesAt ?? null) : offering.registrationClosesAt,
    };
    const dp = datesProblem(year, merged);
    if (dp) return err(dp);
    if (target === "OPEN") {
      const ready = await deps.ports.readiness.check(ctx, id);
      if (!ready.ok) return err(conflict(AcademicCode.OFFERING_NOT_READY, "Un responsable d'enseignement est requis pour chaque unité obligatoire avant l'ouverture.", { missing: ready.error.missing }));
    }
    await repo.updateOffering(tx, id, { startsOn: merged.startsOn, endsOn: merged.endsOn, ...(windowSet ? { windowSet: true, registrationOpensAt: merged.registrationOpensAt, registrationClosesAt: merged.registrationClosesAt } : {}) });
    await repo.setOfferingStatus(tx, id, target);
    const events = new EventBuffer(deps, ctx);
    let updated = (await repo.getOffering(tx, id)) as Offering;
    events.add(AcademicEvents.OFFERING_REOPENED, await offeringPayload(tx, updated, classroom, reason), { type: "offering", id });
    events.audit({ action: "academic.offering.reopened", resourceType: "classroom_offering", resourceId: id, before: { status: offering.status, endsOn: offering.endsOn }, after: { status: target, endsOn: merged.endsOn }, reason });
    updated = await resyncFullness(deps, tx, updated, classroom, events);
    await events.flush(tx);
    return ok(updated);
  });
}

/**
 * Job `academic.finalize-offerings` (AC3.5) : passe à `COMPLETED` les offres `OPEN`/`FULL`/`IN_PROGRESS` dont
 * `ends_on` est passée (date civile de l'établissement). Les offres `DRAFT` et `CANCELLED` sont EXCLUES (le legacy
 * « terminait » aussi les brouillons). Jamais dans un `GET`.
 */
export async function finalizeEndedOfferings(deps: AcademicDeps, ctx: RequestContext): Promise<Result<{ finalized: string[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const candidates = await repo.listEndedOfferingCandidates(tx);
    const todayByInstitution = new Map<string, string>();
    const events = new EventBuffer(deps, ctx);
    const finalized: string[] = [];
    for (const c of candidates) {
      if (!todayByInstitution.has(c.institutionId)) {
        const info = await deps.ports.institutions.getInstitution(ctx, c.institutionId);
        todayByInstitution.set(c.institutionId, civilDateOf(deps.clock.now(), info?.timezone ?? null));
      }
      if (!shouldFinalizeOffering({ status: c.status, endsOn: c.endsOn }, todayByInstitution.get(c.institutionId) as string)) continue;
      await repo.setOfferingStatus(tx, c.id, "COMPLETED");
      const offering = (await repo.getOffering(tx, c.id)) as Offering;
      const classroom = (await repo.getClassroom(tx, c.classroomId)) as Classroom;
      events.add(AcademicEvents.OFFERING_COMPLETED, await offeringPayload(tx, offering, classroom, "ended"), { type: "offering", id: c.id });
      finalized.push(c.id);
    }
    await events.flush(tx);
    return ok({ finalized });
  });
}
