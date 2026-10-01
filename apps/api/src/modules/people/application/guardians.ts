/**
 * Cas d'usage des tuteurs, des liens élève-tuteur et du contrôle d'accès « enfant » (spec 008, US2).
 *
 * Un tuteur est une PERSONNE (aucun compte requis) ; un même tuteur suit plusieurs enfants, y compris dans plusieurs
 * établissements du tenant ; un lien se CLÔT (`valid_to`), il ne se supprime jamais ; la règle « ce parent est bien le
 * parent de cet enfant » (`isGuardianOfStudent`) est LA règle appliquée par tous les modules `*.child.*`.
 */
import { err, ok, ValidationError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation, type Tx } from "@ecoledigitale/database";
import {
  PEOPLE_EVENTS,
  type PeopleChildDto,
  type PeopleCreateGuardianBody,
  type PeopleDuplicateCandidateDto,
  type PeopleGuardianDto,
  type PeopleGuardianLinkDto,
  type PeopleLinkGuardianBody,
  type PeopleOwnContactPatch,
  type PeopleStudentGuardianDto,
  type PeopleStudentSummaryDto,
  type PeopleUpdateLinkBody,
} from "@ecoledigitale/contracts/src/v2/people";
import { PeopleErrors } from "../domain/errors";
import { forbiddenFlagsForKind, resolveLinkFlags, type LinkFlags } from "../domain/guardianship";
import { displayName, normalizePhone } from "../domain/normalize";
import { getPerson, insertPerson, updatePerson, type PersonPatchValues } from "../infrastructure/persons-repo";
import { getRelationshipType } from "../infrastructure/reference-repo";
import * as repo from "../infrastructure/guardians-repo";
import * as students from "../infrastructure/students-repo";
import * as staffRepo from "../infrastructure/staff-repo";
import { clampPage, EventBuffer, inTx, todayOf, type PeopleDeps } from "./deps";
import { updateEmergencyContact } from "./students";
import { changedPersonFields, defaultCountryOf, detectDuplicates, loadSettings, normalizePersonInput, SEE_NO_ROLE, toNewPerson, type RoleVisibility } from "./support";
import { emergencyContactView, guardianView, linkView, studentDetailView, studentSummaryView } from "./views";

// ---------------------------------------------------------------------------
// Tuteurs
// ---------------------------------------------------------------------------

export type CreateGuardianOutcome = { guardian: PeopleGuardianDto; duplicates: PeopleDuplicateCandidateDto[] };

export async function createGuardian(
  deps: PeopleDeps,
  ctx: RequestContext,
  input: PeopleCreateGuardianBody,
  options: { visibility?: RoleVisibility } = {},
): Promise<Result<CreateGuardianOutcome, AppError>> {
  const visibility = options.visibility ?? SEE_NO_ROLE;
  const normalized = input.person ? await normalizePersonInput(deps, ctx, input.person) : null;
  if (normalized && !normalized.ok) return normalized;
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const settings = await loadSettings(deps, tx, ctx, { write: true });
    let personId: string;
    let duplicates: PeopleDuplicateCandidateDto[] = [];
    if (input.personId) {
      const person = await getPerson(tx, ctx.tenantId, input.personId, { forUpdate: true });
      if (!person) return err(PeopleErrors.personNotFound(input.personId));
      if (person.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
      if (await repo.findGuardianByPerson(tx, ctx.tenantId, person.personId)) return err(PeopleErrors.personAlreadyGuardian());
      personId = person.personId;
    } else {
      const values = (normalized as { ok: true; value: PersonPatchValues }).value;
      if (settings.duplicateCheckEnabled) {
        duplicates = await detectDuplicates(tx, ctx, { lastName: values.lastName as string, firstName: values.firstName as string, otherNames: values.otherNames, birthDate: values.birthDate, email: values.email, phone: values.phone }, visibility, {
          contactSignals: true,
        });
        if (duplicates.length > 0 && !input.acknowledgeDuplicate) return err(PeopleErrors.possibleDuplicate(duplicates));
      }
      personId = deps.newId();
      await insertPerson(tx, ctx.tenantId, toNewPerson(personId, values), now);
    }
    const guardianId = deps.newId();
    await repo.insertGuardian(tx, ctx.tenantId, { id: guardianId, personId, occupation: input.occupation, employer: input.employer }, now);
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(PEOPLE_EVENTS.guardianCreated, { v: 1, guardianId, personId }, { type: "guardian", id: guardianId });
    buffer.audit({ action: "people.guardian.created", entity: "guardian", entityId: guardianId, metadata: { personId, reusedPerson: Boolean(input.personId) } });
    if (duplicates.length > 0) {
      buffer.audit({ action: "people.guardian.duplicate_acknowledged", entity: "guardian", entityId: guardianId, severity: "notice", reason: input.duplicateReason ?? null, metadata: { candidates: duplicates.map((d) => d.personId) } });
    }
    await buffer.flush(tx);
    const row = await repo.getGuardianRow(tx, ctx.tenantId, guardianId);
    if (!row) throw new Error("Tuteur introuvable après création.");
    return ok({ guardian: guardianView(row), duplicates });
  });
}

export async function updateGuardian(
  deps: PeopleDeps,
  ctx: RequestContext,
  guardianId: string,
  patch: { person?: Parameters<typeof normalizePersonInput>[2]; occupation?: string | null | undefined; employer?: string | null | undefined },
): Promise<Result<PeopleGuardianDto, AppError>> {
  const person = patch.person ? await normalizePersonInput(deps, ctx, patch.person) : null;
  if (person && !person.ok) return person;
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const row = await repo.getGuardianRow(tx, ctx.tenantId, guardianId);
    if (!row) return err(PeopleErrors.guardianNotFound(guardianId));
    if (row.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
    const personPatch = person?.value ?? {};
    if (Object.keys(personPatch).length > 0) await updatePerson(tx, ctx.tenantId, row.personId, personPatch, now);
    await repo.updateGuardian(tx, ctx.tenantId, guardianId, { occupation: patch.occupation, employer: patch.employer }, now);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.guardian.updated", entity: "guardian", entityId: guardianId, metadata: { fields: [...changedPersonFields(personPatch), ...(patch.occupation !== undefined ? ["occupation"] : []), ...(patch.employer !== undefined ? ["employer"] : [])] } });
    await buffer.flush(tx);
    const updated = await repo.getGuardianRow(tx, ctx.tenantId, guardianId);
    return updated ? ok(guardianView(updated)) : err(PeopleErrors.guardianNotFound(guardianId));
  });
}

export async function getGuardian(deps: PeopleDeps, ctx: RequestContext, guardianId: string): Promise<Result<PeopleGuardianDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await repo.getGuardianRow(tx, ctx.tenantId, guardianId);
      return row ? ok(guardianView(row)) : err(PeopleErrors.guardianNotFound(guardianId));
    },
    { readOnly: true },
  );
}

export async function listGuardians(
  deps: PeopleDeps,
  ctx: RequestContext,
  query: { q?: string | undefined; studentId?: string | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<Result<{ items: PeopleGuardianDto[]; total: number; limit: number; offset: number }, AppError>> {
  const page = clampPage(deps, query);
  const country = query.q ? await defaultCountryOf(deps, ctx) : null;
  const qPhone = query.q && query.q.replace(/\D/g, "").length >= 5 ? normalizePhone(query.q, country) : null;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const { rows, total } = await repo.listGuardianRows(tx, ctx.tenantId, { q: query.q, qPhone, studentId: query.studentId, ...page });
      return ok({ items: rows.map(guardianView), total, ...page });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Liens
// ---------------------------------------------------------------------------

async function loadLinkContext(tx: Tx, ctx: RequestContext, studentId: string): Promise<Result<{ personId: string }, AppError>> {
  const locked = await students.lockStudent(tx, ctx.tenantId, studentId);
  if (!locked) return err(PeopleErrors.studentNotFound(studentId));
  const row = await students.getStudentRow(tx, ctx.tenantId, studentId);
  if (row?.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
  return ok({ personId: locked.personId });
}

function publishLink(buffer: EventBuffer, change: "linked" | "link_changed" | "unlinked", link: { id: string; studentId: string; guardianId: string }): void {
  const type = change === "linked" ? PEOPLE_EVENTS.guardianLinked : change === "link_changed" ? PEOPLE_EVENTS.guardianLinkChanged : PEOPLE_EVENTS.guardianUnlinked;
  const payload = { v: 1 as const, studentId: link.studentId, guardianId: link.guardianId, linkId: link.id };
  buffer.add(type, payload, { type: "student_guardian", id: link.id });
  // Événement agrégé consommé par assess / reportcards (invalidation des accès tuteurs, interfaces-publiees §3).
  buffer.add(PEOPLE_EVENTS.studentGuardianChanged, { ...payload, change }, { type: "student", id: link.studentId });
}

/**
 * Lie un tuteur à un élève. Valeurs par défaut PRUDENTES (`canPickup` et `hasLegalCustody` à faux). Un seul contact
 * principal vivant par élève : en demander un second échoue (`people.primary_guardian_conflict`) ; la bascule explicite se
 * fait par `updateGuardianLink`. Un type de lien qui n'est pas une tutelle (contact d'urgence…) ne peut ni porter
 * l'autorité parentale ni ouvrir le portail.
 */
export async function linkGuardian(deps: PeopleDeps, ctx: RequestContext, studentId: string, input: PeopleLinkGuardianBody): Promise<Result<PeopleGuardianLinkDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const ok0 = await loadLinkContext(tx, ctx, studentId);
    if (!ok0.ok) return ok0;
    const guardian = await repo.getGuardianRow(tx, ctx.tenantId, input.guardianId);
    if (!guardian) return err(PeopleErrors.guardianNotFound(input.guardianId));
    if (guardian.guardianStatus !== "ACTIVE" || guardian.anonymizedAt) return err(PeopleErrors.guardianNotFound(input.guardianId));
    const rel = await getRelationshipType(tx, ctx.tenantId, input.relationshipCode);
    if (!rel || !rel.active) return err(PeopleErrors.relationshipUnknown(input.relationshipCode));
    const flags = resolveLinkFlags(
      {
        isPrimaryContact: input.isPrimaryContact,
        isEmergencyContact: input.isEmergencyContact,
        isFinancialResponsible: input.isFinancialResponsible,
        hasLegalCustody: input.hasLegalCustody,
        canPickup: input.canPickup,
        portalAccess: input.portalAccess,
        priority: input.priority,
      },
      rel.kind,
    );
    if (forbiddenFlagsForKind(rel.kind, flags).length > 0) return err(PeopleErrors.relationshipNotGuardian());
    if (await repo.getAliveLink(tx, ctx.tenantId, studentId, input.guardianId)) return err(PeopleErrors.linkExists());
    if (flags.isPrimaryContact && (await repo.getAlivePrimaryLink(tx, ctx.tenantId, studentId))) return err(PeopleErrors.primaryGuardianConflict());
    const linkId = deps.newId();
    try {
      await repo.insertLink(tx, ctx.tenantId, { id: linkId, studentId, guardianId: input.guardianId, relationshipCode: input.relationshipCode, ...flags, validFrom: input.validFrom ?? todayOf(deps), notes: input.notes }, now);
    } catch (e) {
      if (isUniqueViolation(e)) return err(PeopleErrors.primaryGuardianConflict());
      throw e;
    }
    const buffer = new EventBuffer(deps, ctx);
    publishLink(buffer, "linked", { id: linkId, studentId, guardianId: input.guardianId });
    buffer.audit({
      action: "people.guardian.linked",
      entity: "student_guardian",
      entityId: linkId,
      severity: flags.hasLegalCustody || flags.canPickup || flags.portalAccess ? "notice" : "info",
      metadata: { studentId, guardianId: input.guardianId, relationshipCode: input.relationshipCode, flags: flagNames(flags) },
    });
    await buffer.flush(tx);
    const link = await repo.getLink(tx, ctx.tenantId, linkId);
    return link ? ok(linkView(link)) : err(PeopleErrors.linkNotFound(linkId));
  });
}

const flagNames = (f: LinkFlags): string[] =>
  (["isPrimaryContact", "isEmergencyContact", "isFinancialResponsible", "hasLegalCustody", "canPickup", "portalAccess"] as const).filter((k) => f[k]);

/**
 * Modifie les drapeaux d'un lien VIVANT (`guardian.manage` seulement : un tuteur ne change jamais ses propres drapeaux).
 * Passer un lien en contact principal fait basculer l'ancien principal dans la même transaction.
 */
export async function updateGuardianLink(deps: PeopleDeps, ctx: RequestContext, studentId: string, linkId: string, patch: PeopleUpdateLinkBody): Promise<Result<PeopleGuardianLinkDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const ok0 = await loadLinkContext(tx, ctx, studentId);
    if (!ok0.ok) return ok0;
    const link = await repo.getLink(tx, ctx.tenantId, linkId);
    if (!link || link.studentId !== studentId) return err(PeopleErrors.linkNotFound(linkId));
    if (link.validTo !== null) return err(PeopleErrors.linkClosed());

    let kind = link.relationshipKind;
    if (patch.relationshipCode && patch.relationshipCode !== link.relationshipCode) {
      const rel = await getRelationshipType(tx, ctx.tenantId, patch.relationshipCode);
      if (!rel || !rel.active) return err(PeopleErrors.relationshipUnknown(patch.relationshipCode));
      kind = rel.kind;
    }
    const merged = {
      hasLegalCustody: patch.hasLegalCustody ?? link.hasLegalCustody,
      portalAccess: patch.portalAccess ?? link.portalAccess,
    };
    // Un changement vers un type qui n'est pas une tutelle ferme les accès : sauf demande contraire explicite, on les retire.
    const closing: { -readonly [K in keyof LinkFlags]?: LinkFlags[K] } = {};
    if (kind !== "GUARDIAN" && kind !== link.relationshipKind) {
      if (patch.hasLegalCustody === undefined) closing.hasLegalCustody = false;
      if (patch.portalAccess === undefined) closing.portalAccess = false;
      merged.hasLegalCustody = closing.hasLegalCustody ?? merged.hasLegalCustody;
      merged.portalAccess = closing.portalAccess ?? merged.portalAccess;
    }
    if (forbiddenFlagsForKind(kind, merged).length > 0) return err(PeopleErrors.relationshipNotGuardian());

    const buffer = new EventBuffer(deps, ctx);
    if (patch.isPrimaryContact === true && !link.isPrimaryContact) {
      const current = await repo.getAlivePrimaryLink(tx, ctx.tenantId, studentId);
      if (current && current.id !== linkId) {
        await repo.updateLink(tx, ctx.tenantId, current.id, { isPrimaryContact: false }, now);
        publishLink(buffer, "link_changed", { id: current.id, studentId, guardianId: current.guardianId });
      }
    }
    await repo.updateLink(tx, ctx.tenantId, linkId, { ...patch, ...closing }, now);
    publishLink(buffer, "link_changed", { id: linkId, studentId, guardianId: link.guardianId });
    const changed = Object.keys(patch).sort();
    const sensitiveChange = ["hasLegalCustody", "canPickup", "portalAccess", "isPrimaryContact", "relationshipCode"].some((k) => changed.includes(k));
    buffer.audit({ action: "people.guardian.link_changed", entity: "student_guardian", entityId: linkId, severity: sensitiveChange ? "notice" : "info", metadata: { studentId, guardianId: link.guardianId, fields: changed } });
    await buffer.flush(tx);
    const updated = await repo.getLink(tx, ctx.tenantId, linkId);
    return updated ? ok(linkView(updated)) : err(PeopleErrors.linkNotFound(linkId));
  });
}

/** CLÔT un lien (`valid_to`) : il n'est jamais supprimé, l'historique des tuteurs successifs est conservé. */
export async function unlinkGuardian(
  deps: PeopleDeps,
  ctx: RequestContext,
  studentId: string,
  linkId: string,
  input: { effectiveOn?: string | undefined; reason?: string | undefined } = {},
): Promise<Result<PeopleGuardianLinkDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const today = todayOf(deps);
    const ok0 = await loadLinkContext(tx, ctx, studentId);
    if (!ok0.ok) return ok0;
    const link = await repo.getLink(tx, ctx.tenantId, linkId);
    if (!link || link.studentId !== studentId) return err(PeopleErrors.linkNotFound(linkId));
    if (link.validTo !== null) return err(PeopleErrors.linkClosed());
    const effectiveOn = input.effectiveOn ?? today;
    if (effectiveOn > today) return err(ValidationError.field("effectiveOn", "La date de fin ne peut pas être dans le futur.", "future_date"));
    if (effectiveOn < link.validFrom) return err(ValidationError.field("effectiveOn", "La date de fin précède le début du lien.", "before_start"));
    await repo.closeLink(tx, ctx.tenantId, linkId, effectiveOn, now);
    const buffer = new EventBuffer(deps, ctx);
    publishLink(buffer, "unlinked", { id: linkId, studentId, guardianId: link.guardianId });
    buffer.audit({ action: "people.guardian.unlinked", entity: "student_guardian", entityId: linkId, severity: "notice", reason: input.reason ?? null, metadata: { studentId, guardianId: link.guardianId, effectiveOn } });
    await buffer.flush(tx);
    const closed = await repo.getLink(tx, ctx.tenantId, linkId);
    return closed ? ok(linkView(closed)) : err(PeopleErrors.linkNotFound(linkId));
  });
}

/**
 * Tuteurs d'un élève avec leurs drapeaux et coordonnées de notification (communications 016, répondant financier 014).
 * Par défaut les liens VIVANTS ; `includeClosed` restitue l'historique.
 */
export async function listGuardiansOfStudent(
  deps: PeopleDeps,
  ctx: RequestContext,
  studentId: string,
  options: { includeClosed?: boolean } = {},
): Promise<Result<PeopleStudentGuardianDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await students.getStudentRow(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
      const links = await repo.listLinksOfStudent(tx, ctx.tenantId, studentId, { aliveOnly: !options.includeClosed });
      const out: PeopleStudentGuardianDto[] = [];
      for (const l of links) {
        const g = await repo.getGuardianRow(tx, ctx.tenantId, l.guardianId);
        if (g) out.push({ link: linkView(l), guardian: guardianView(g) });
      }
      return ok(out);
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Accès « enfant » et « moi »
// ---------------------------------------------------------------------------

/** LA règle : l'identité est celle d'un tuteur actif lié à l'élève par un lien vivant avec accès au portail (type de tutelle). */
export async function isGuardianOfStudent(deps: PeopleDeps, ctx: RequestContext, identityId: string, studentId: string): Promise<boolean> {
  return deps.db.run(ctx, (tx) => repo.isGuardianOfStudentSql(tx, ctx.tenantId, identityId, studentId), { readOnly: true });
}

/** Les enfants d'une identité de tuteur (tous établissements du tenant), triés par nom. */
export async function listChildrenOfIdentity(deps: PeopleDeps, ctx: RequestContext, identityId: string): Promise<Result<PeopleStudentSummaryDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const ids = await repo.listChildIdsOfIdentity(tx, ctx.tenantId, identityId);
      const rows = await students.getStudentRows(tx, ctx.tenantId, ids);
      rows.sort((a, b) => a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr") || a.studentId.localeCompare(b.studentId));
      return ok(rows.map(studentSummaryView));
    },
    { readOnly: true },
  );
}

/** Le dossier de l'identité (portails `*.self.*`) ; jamais de repli sur « la fiche la plus récente ». */
export async function resolveStudentForIdentity(deps: PeopleDeps, ctx: RequestContext, identityId: string): Promise<string | null> {
  return deps.db.run(ctx, async (tx) => (await students.findStudentByIdentity(tx, ctx.tenantId, identityId))?.studentId ?? null, { readOnly: true });
}

/** « Mon dossier » (élève). 404 si l'identité n'a aucun dossier. */
export async function getMyStudent(deps: PeopleDeps, ctx: RequestContext, identityId: string): Promise<Result<ReturnType<typeof studentDetailView>, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await students.findStudentByIdentity(tx, ctx.tenantId, identityId);
      if (!row) return err(PeopleErrors.studentNotFound());
      return ok(studentDetailView(row, "SELF", null));
    },
    { readOnly: true },
  );
}

/** Fiche d'un enfant pour son parent : 404 pour tout élève hors lien vivant (aucune fuite d'existence). */
export async function getChildView(deps: PeopleDeps, ctx: RequestContext, identityId: string, studentId: string): Promise<Result<PeopleChildDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await repo.isGuardianOfStudentSql(tx, ctx.tenantId, identityId, studentId))) return err(PeopleErrors.studentNotFound());
      const row = await students.getStudentRow(tx, ctx.tenantId, studentId);
      if (!row) return err(PeopleErrors.studentNotFound());
      const links = await repo.listLinksOfStudent(tx, ctx.tenantId, studentId, { aliveOnly: true });
      const guardians: PeopleChildDto["guardians"] = [];
      for (const l of links) {
        if (l.relationshipKind !== "GUARDIAN") continue;
        const g = await repo.getGuardianRow(tx, ctx.tenantId, l.guardianId);
        if (g) guardians.push({ guardianId: g.guardianId, displayName: displayName(g.lastName, g.firstName), relationshipCode: l.relationshipCode, isPrimaryContact: l.isPrimaryContact });
      }
      const contacts = (await students.listEmergencyContacts(tx, ctx.tenantId, studentId)).map(emergencyContactView);
      return ok({ student: studentDetailView(row, "GUARDIAN", null), guardians, emergencyContacts: contacts });
    },
    { readOnly: true },
  );
}

/**
 * Coordonnées modifiables par la personne elle-même (tuteur, élève, membre du personnel) : e-mail, téléphones, adresse —
 * JAMAIS l'identité, les drapeaux d'un lien ni le statut. Audité.
 */
export async function updateMyContact(
  deps: PeopleDeps,
  ctx: RequestContext,
  identityId: string,
  quality: "GUARDIAN" | "STUDENT" | "STAFF",
  patch: PeopleOwnContactPatch,
): Promise<Result<{ personId: string; fields: string[] }, AppError>> {
  const normalized = await normalizePersonInput(deps, ctx, patch, []);
  if (!normalized.ok) return normalized;
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    let personId: string | undefined;
    let notFound: AppError;
    if (quality === "GUARDIAN") {
      personId = (await repo.findGuardianByIdentity(tx, ctx.tenantId, identityId))?.personId;
      notFound = PeopleErrors.guardianNotFound();
    } else if (quality === "STUDENT") {
      personId = (await students.findStudentByIdentity(tx, ctx.tenantId, identityId))?.personId;
      notFound = PeopleErrors.studentNotFound();
    } else {
      personId = (await staffRepo.findStaffByIdentity(tx, ctx.tenantId, identityId))?.personId;
      notFound = PeopleErrors.staffNotFound();
    }
    if (!personId) return err(notFound);
    await updatePerson(tx, ctx.tenantId, personId, normalized.value, now);
    const fields = changedPersonFields(normalized.value);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: `people.${quality.toLowerCase()}.own_contact_updated`, entity: "person", entityId: personId, metadata: { fields } });
    await buffer.flush(tx);
    return ok({ personId, fields });
  });
}

/** Un tuteur met à jour un contact d'urgence de SON enfant (champs limités, audité) ; 404 hors lien vivant. */
export async function updateChildEmergencyContact(
  deps: PeopleDeps,
  ctx: RequestContext,
  identityId: string,
  studentId: string,
  contactId: string,
  patch: { contactName?: string | undefined; relationshipLabel?: string | null | undefined; phone?: string | undefined; phoneAlt?: string | null | undefined; email?: string | null | undefined; priority?: number | undefined },
): Promise<Result<ReturnType<typeof emergencyContactView>, AppError>> {
  const allowed = await isGuardianOfStudent(deps, ctx, identityId, studentId);
  if (!allowed) return err(PeopleErrors.studentNotFound());
  return updateEmergencyContact(deps, ctx, studentId, contactId, patch, { audit: { actor: "GUARDIAN" } });
}
