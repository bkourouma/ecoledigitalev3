/**
 * Documents officiels (US7) : diplôme, attestation de réussite, attestation d'authenticité.
 *
 * Ce module produit les DONNÉES immuables : un snapshot JSON versionné (`diploma/1`, `attestation-success/1`,
 * `attestation-authenticity/1`) + son empreinte SHA-256 + un code de vérification. Le rendu PDF, le scellement et la page de
 * vérification publique relèvent de `reportcards` (013), qui relit le snapshot et renseigne ensuite le scellement et le rendu.
 *
 *  - AUCUN signataire par défaut : l'émission est REFUSÉE si un emplacement obligatoire n'a pas de signataire en vigueur à la
 *    date d'émission (R-HIG-08) ; le snapshot conserve le signataire en vigueur à l'ÉMISSION ;
 *  - l'attestation d'authenticité porte `AUTH/AAAA/NNN` attribué UNE fois par octroi (idempotent) ;
 *  - la date d'obtention est celle de la dernière acquisition nécessaire (jamais « aujourd'hui ») ;
 *  - un document émis est immuable (R-HIG-12) : la correction passe par révocation et réémission ; un duplicata est une
 *    nouvelle émission liée à l'originale (`/Dn`).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { isCurrentlyValid, lastAcquisitionDate, sumCredits } from "../domain/credits";
import { MENTION_PENDING } from "../domain/diploma";
import { HigherCode, conflict, notFound, validation } from "../domain/errors";
import { HigherEvents } from "../domain/events";
import { duplicateReference, formatAttestationReference, formatAuthenticityReference } from "../domain/numbering";
import { REQUIRED_SLOTS, previousDay, slotInForce } from "../domain/signatures";
import { snapshotHash } from "../domain/snapshot";
import type { DiplomaAward, DocumentKind, DocumentSlot, IsoDate, OfficialDocument, SlotKey, SnapshotSchema, Uuid } from "../domain/types";
import * as diplomas from "../infrastructure/diplomas-repository";
import * as repo from "../infrastructure/documents-repository";
import * as ledger from "../infrastructure/ledger-repository";
import { EventBuffer, currentYear, inTx, insertOrConflict, lockKey, todayOf, type HigherDeps } from "./deps";
import type { CycleResults, RuleScope, SignatoryInfo } from "./ports";

export interface IssuedDocument {
  readonly document: OfficialDocument;
  /** `false` : le document existait déjà (émission idempotente — même numéro, même empreinte). */
  readonly created: boolean;
}

// ---------------------------------------------------------------------------
// Emplacements de signature
// ---------------------------------------------------------------------------

export async function listSlots(deps: HigherDeps, ctx: RequestContext): Promise<Result<DocumentSlot[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listSlots(tx)), { readOnly: true });
}

export interface AssignSlotInput {
  readonly slotKey: SlotKey;
  readonly signatoryId: Uuid;
  readonly validFrom: IsoDate;
  readonly validTo?: IsoDate | null | undefined;
}

/**
 * Affecte un signataire à un emplacement à partir d'une date. L'affectation en cours qui recouvre `validFrom` est CLOSE la
 * veille (historique conservé : un document ancien garde son signataire). Un signataire désactivé ne peut plus être affecté.
 */
export async function assignSlot(deps: HigherDeps, ctx: RequestContext, input: AssignSlotInput): Promise<Result<DocumentSlot, AppError>> {
  const validTo = input.validTo ?? null;
  if (validTo !== null && validTo < input.validFrom) return err(validation(HigherCode.INVALID_INPUT, "La fin de validité précède son début.", "validTo"));
  if (!ctx.userId) return err(validation(HigherCode.INVALID_INPUT, "Un utilisateur est requis.", "userId"));
  const by = ctx.userId;
  const signatory = await deps.ports.signatories.getSignatory(ctx, input.signatoryId);
  if (!signatory) return err(notFound(HigherCode.SIGNATORY_UNKNOWN, "Signataire", input.signatoryId));
  if (!signatory.active) return err(conflict(HigherCode.SIGNATORY_INACTIVE, "Ce signataire est désactivé : il ne peut plus être affecté à un emplacement."));

  return inTx(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, "slot", input.slotKey);
    const overlapping = await repo.listOverlappingSlots(tx, input.slotKey, input.validFrom, validTo);
    for (const o of overlapping) {
      // Seule l'affectation qui COMMENCE avant la nouvelle peut être close la veille ; elle ne doit pas la dépasser.
      const canClose = o.validFrom < input.validFrom && (validTo === null || (o.validTo !== null && o.validTo <= validTo));
      if (!canClose) {
        return err(conflict(HigherCode.SLOT_OVERLAP, "Cette période recouvre une autre affectation de l'emplacement.", { slotId: o.id, validFrom: o.validFrom, validTo: o.validTo }));
      }
      await repo.closeSlot(tx, o.id, previousDay(input.validFrom));
    }
    const inserted = await insertOrConflict(
      tx,
      (t) => repo.insertSlot(t, { id: deps.newId(), tenantId: ctx.tenantId, slotKey: input.slotKey, signatoryId: input.signatoryId, validFrom: input.validFrom, validTo, createdBy: by, createdAt: deps.clock.now() }),
      () => conflict(HigherCode.SLOT_OVERLAP, "Cette période recouvre une autre affectation de l'emplacement."),
    );
    if (!inserted.ok) return inserted;
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "higher.slot.assigned",
      resourceType: "document_slot",
      resourceId: inserted.value.id,
      sensitive: true,
      after: { slotKey: input.slotKey, signatoryId: input.signatoryId, validFrom: input.validFrom, validTo, closedPrevious: overlapping.map((o) => o.id) },
    });
    await events.flush(tx);
    return inserted;
  });
}

// ---------------------------------------------------------------------------
// Résolution des signataires à la date d'émission
// ---------------------------------------------------------------------------

export interface SignatorySnapshot {
  readonly signatoryId: Uuid;
  readonly fullName: string;
  readonly title: string | null;
  readonly function: string | null;
}

async function resolveSignatories(
  deps: HigherDeps,
  ctx: RequestContext,
  tx: Tx,
  kind: DocumentKind,
  on: IsoDate,
): Promise<Result<Record<string, SignatorySnapshot>, AppError>> {
  const slots = await repo.listSlots(tx);
  const out: Record<string, SignatorySnapshot> = {};
  for (const key of REQUIRED_SLOTS[kind]) {
    const slot = slotInForce(slots, key, on);
    if (!slot) {
      return err(conflict(HigherCode.SIGNATORY_MISSING, `Aucun signataire n'est en vigueur pour l'emplacement « ${key} » à la date d'émission : l'émission est refusée.`, { slot: key, on }));
    }
    const info: SignatoryInfo | null = await deps.ports.signatories.getSignatory(ctx, slot.signatoryId);
    if (!info) return err(notFound(HigherCode.SIGNATORY_UNKNOWN, "Signataire", slot.signatoryId));
    if (!info.active) return err(conflict(HigherCode.SIGNATORY_INACTIVE, `Le signataire de l'emplacement « ${key} » est désactivé : réaffectez l'emplacement.`, { slot: key }));
    out[key] = { signatoryId: info.signatoryId, fullName: info.fullName, title: info.title, function: info.function };
  }
  return ok(out);
}

// ---------------------------------------------------------------------------
// Diplôme et attestation d'authenticité (rattachés à un octroi)
// ---------------------------------------------------------------------------

export interface IssueAwardDocumentInput {
  readonly awardId: Uuid;
  readonly kind: "DIPLOMA" | "ATTESTATION_AUTHENTICITY";
  /** Duplicata d'un diplôme déjà émis (nouvelle émission liée à l'originale, qui devient `SUPERSEDED`). */
  readonly duplicate?: boolean | undefined;
}

export async function issueAwardDocument(deps: HigherDeps, ctx: RequestContext, input: IssueAwardDocumentInput): Promise<Result<IssuedDocument, AppError>> {
  if (!ctx.userId) return err(validation(HigherCode.INVALID_INPUT, "Un utilisateur est requis pour émettre un document.", "userId"));
  const issuer = ctx.userId;

  // Lectures d'AUTRES modules, avant la transaction.
  const head = await deps.db.run(ctx, async (tx) => {
    const award = await diplomas.getAward(tx, input.awardId);
    const def = award ? await diplomas.getDefinition(tx, award.definitionId) : null;
    return { award, def };
  }, { readOnly: true });
  if (!head.award || !head.def) return err(notFound(HigherCode.AWARD_NOT_FOUND, "Octroi", input.awardId));
  const { award: headAward, def } = head;
  const identity = await deps.ports.students.getIdentity(ctx, headAward.studentId);
  if (!identity) return err(notFound(HigherCode.STUDENT_NOT_FOUND, "Étudiant", headAward.studentId));
  const institution = await deps.ports.institution.getInstitution(ctx, def.institutionId);
  const lastEnrollment = await deps.ports.enrollments.getLastEnrollment(ctx, { studentId: headAward.studentId, nodeId: def.curriculumNodeId });
  const issuerName = (await deps.ports.actors.displayName(ctx, issuer)) ?? issuer;

  return inTx<IssuedDocument>(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, "doc-award", `${input.awardId}:${input.kind}`);
    const award = await diplomas.getAward(tx, input.awardId, true);
    if (!award) return err(notFound(HigherCode.AWARD_NOT_FOUND, "Octroi", input.awardId));
    if (award.status === "REVOKED") return err(conflict(HigherCode.AWARD_REVOKED, "Ce diplôme est révoqué : aucun document ne peut être émis."));

    const existing = await repo.findIssuedForAward(tx, award.id, input.kind);
    if (input.kind === "ATTESTATION_AUTHENTICITY") {
      if (existing) return ok({ document: existing, created: false });
    } else if (existing && !input.duplicate) {
      return ok({ document: existing, created: false });
    }

    const today = todayOf(deps);
    const signatories = await resolveSignatories(deps, ctx, tx, input.kind, today);
    if (!signatories.ok) return signatories;

    const now = deps.clock.now();
    const year = currentYear(deps);
    const events = new EventBuffer(deps, ctx);
    let reference: string;
    let referenceYear: number;
    let referenceSeq: number;
    let version = 1;
    let supersedesId: Uuid | null = null;
    if (input.kind === "DIPLOMA") {
      referenceYear = award.referenceYear;
      referenceSeq = award.referenceSeq;
      if (existing) {
        version = existing.version + 1;
        supersedesId = existing.id;
        await repo.markSuperseded(tx, existing.id);
      }
      reference = duplicateReference(award.reference, version);
    } else {
      referenceYear = year;
      referenceSeq = await repo.nextNumber(tx, "AUTHENTICITY", year);
      reference = formatAuthenticityReference(referenceYear, referenceSeq);
    }

    const snapshotSchema: SnapshotSchema = input.kind === "DIPLOMA" ? "diploma/1" : "attestation-authenticity/1";
    const snapshot = buildAwardSnapshot({
      schema: snapshotSchema, award, definition: def, identity, institution, signatories: signatories.value, reference, version,
      duplicateOf: supersedesId ? duplicateReference(award.reference, 1) : null, issueDate: today,
      academicYearLabel: lastEnrollment && lastEnrollment.academicYearId === award.academicYearId ? lastEnrollment.academicYearLabel : null,
    });
    const inserted = await insertOrConflict(
      tx,
      (t) =>
        repo.insertDocument(t, {
          id: deps.newId(), tenantId: ctx.tenantId, documentKind: input.kind, awardId: award.id, studentId: award.studentId, programNodeId: null, reference,
          referenceYear, referenceSeq, version, supersedesId, snapshotSchema, snapshot, snapshotHash: snapshotHash(snapshot),
          verificationCode: deps.newVerificationCode(), issuedAt: now, issuedBy: issuer, issuedByName: issuerName,
        }),
      () => conflict(HigherCode.INVALID_INPUT, "Ce document existe déjà."),
    );
    if (!inserted.ok) return inserted;
    const doc = inserted.value;
    events.add(HigherEvents.DOCUMENT_ISSUED, { v: 1, documentId: doc.id, kind: doc.documentKind, awardId: award.id }, { type: "official_document", id: doc.id });
    events.audit({
      action: "higher.document.issued",
      resourceType: "official_document",
      resourceId: doc.id,
      sensitive: true,
      after: { kind: doc.documentKind, reference: doc.reference, version: doc.version, snapshotHash: doc.snapshotHash, signatories: Object.fromEntries(Object.entries(signatories.value).map(([k, v]) => [k, v.signatoryId])) },
    });
    await events.flush(tx);
    return ok({ document: doc, created: true });
  });
}

function buildAwardSnapshot(p: {
  schema: SnapshotSchema;
  award: DiplomaAward;
  definition: { id: Uuid; code: string; label: string; gradeCode: string };
  identity: { studentId: Uuid; fullName: string; matricule: string | null; birthDate: string | null; birthPlace: string | null };
  institution: { name: string; shortName?: string | null | undefined; address?: string | null | undefined; country?: string | null | undefined; logoRef?: string | null | undefined };
  signatories: Record<string, SignatorySnapshot>;
  reference: string;
  version: number;
  duplicateOf: string | null;
  issueDate: IsoDate;
  academicYearLabel: string | null;
}): Record<string, unknown> {
  const base = {
    v: 1,
    schema: p.schema,
    institution: p.institution,
    student: { studentId: p.identity.studentId, fullName: p.identity.fullName, matricule: p.identity.matricule, birthDate: p.identity.birthDate, birthPlace: p.identity.birthPlace },
    diploma: { definitionId: p.definition.id, code: p.definition.code, label: p.definition.label, gradeCode: p.definition.gradeCode, awardReference: p.award.reference },
    reference: p.reference,
    version: p.version,
    issueDate: p.issueDate,
    signatories: p.signatories,
  };
  if (p.schema === "attestation-authenticity/1") return base;
  return {
    ...base,
    duplicateOf: p.duplicateOf,
    creditsTotal: p.award.creditsTotal,
    ues: p.award.requirementsSnapshot.requirements.filter((r) => r.validated).map((r) => ({ code: r.code, label: r.label, credits: r.credits })),
    mention: { code: p.award.mentionCode, average: p.award.cycleAverage },
    acquiredDate: p.award.acquiredDate,
    academicYear: { id: p.award.academicYearId, label: p.academicYearLabel },
    awardedVia: p.award.awardedVia,
  };
}

// ---------------------------------------------------------------------------
// Attestation de réussite (programme complet)
// ---------------------------------------------------------------------------

export interface AttestationRosterRow {
  readonly studentId: Uuid;
  readonly fullName: string | null;
  readonly matricule: string | null;
  readonly classroomId: Uuid;
  readonly academicYearId: Uuid;
  readonly ueAcquired: number;
  readonly ueRequired: number;
  readonly creditsAcquired: number;
  readonly eligible: boolean;
  readonly missingUeNodeIds: readonly Uuid[];
  readonly acquiredDate: IsoDate | null;
  readonly documentId: Uuid | null;
  readonly reference: string | null;
}

/** `GET /attestations/roster` : progression des étudiants d'un programme (éligibles à l'attestation de réussite). */
export async function getAttestationRoster(deps: HigherDeps, ctx: RequestContext, input: { programNodeId: Uuid; classroomId?: Uuid | undefined }): Promise<Result<AttestationRosterRow[], AppError>> {
  const node = await deps.ports.curriculum.getNode(ctx, input.programNodeId);
  if (!node) return err(notFound(HigherCode.CURRICULUM_NODE_NOT_FOUND, "Programme", input.programNodeId));
  const ues = await deps.ports.curriculum.listProgramUe(ctx, input.programNodeId);
  if (ues.length === 0) return err(validation(HigherCode.ATTESTATION_NO_UE, "Aucune UE n'est configurée pour ce programme.", "programNodeId"));
  const enrollments = (await deps.ports.enrollments.listCycleEnrollments(ctx, input.programNodeId)).filter((e) => !input.classroomId || e.classroomId === input.classroomId);
  const latest = new Map<Uuid, (typeof enrollments)[number]>();
  for (const e of enrollments) {
    const cur = latest.get(e.studentId);
    if (!cur || e.academicYearId > cur.academicYearId) latest.set(e.studentId, e);
  }
  const identities = new Map<Uuid, Awaited<ReturnType<typeof deps.ports.students.getIdentity>>>();
  for (const id of latest.keys()) identities.set(id, await deps.ports.students.getIdentity(ctx, id));
  const ueIds = ues.map((u) => u.nodeId);

  return inTx(
    deps,
    ctx,
    async (tx) => {
      const today = todayOf(deps);
      const rows: AttestationRosterRow[] = [];
      for (const e of latest.values()) {
        const entries = (await ledger.listAcquiredForUes(tx, e.studentId, ueIds)).filter((x) => isCurrentlyValid(x, today));
        const have = new Set(entries.map((x) => x.ueNodeId));
        const missing = ueIds.filter((id) => !have.has(id));
        const doc = await repo.findIssuedAttestation(tx, e.studentId, input.programNodeId);
        const idn = identities.get(e.studentId);
        rows.push({
          studentId: e.studentId, fullName: idn?.fullName ?? null, matricule: idn?.matricule ?? null, classroomId: e.classroomId, academicYearId: e.academicYearId,
          ueAcquired: have.size, ueRequired: ueIds.length, creditsAcquired: sumCredits(entries.map((x) => x.credits)), eligible: missing.length === 0,
          missingUeNodeIds: missing, acquiredDate: missing.length === 0 ? lastAcquisitionDate(entries) : null, documentId: doc?.id ?? null, reference: doc?.reference ?? null,
        });
      }
      return ok(rows.sort((a, b) => (a.fullName ?? a.studentId).localeCompare(b.fullName ?? b.studentId)));
    },
    { readOnly: true },
  );
}

/** Émet l'attestation de réussite d'un programme complet (idempotent par étudiant et programme). */
export async function issueSuccessAttestation(deps: HigherDeps, ctx: RequestContext, input: { studentId: Uuid; programNodeId: Uuid }): Promise<Result<IssuedDocument, AppError>> {
  if (!ctx.userId) return err(validation(HigherCode.INVALID_INPUT, "Un utilisateur est requis pour émettre un document.", "userId"));
  const issuer = ctx.userId;
  const node = await deps.ports.curriculum.getNode(ctx, input.programNodeId);
  if (!node) return err(notFound(HigherCode.CURRICULUM_NODE_NOT_FOUND, "Programme", input.programNodeId));
  const ues = await deps.ports.curriculum.listProgramUe(ctx, input.programNodeId);
  if (ues.length === 0) return err(validation(HigherCode.ATTESTATION_NO_UE, "Aucune UE n'est configurée pour ce programme.", "programNodeId"));
  const identity = await deps.ports.students.getIdentity(ctx, input.studentId);
  if (!identity) return err(notFound(HigherCode.STUDENT_NOT_FOUND, "Étudiant", input.studentId));
  const institution = await deps.ports.institution.getInstitution(ctx, null);
  const lastEnrollment = await deps.ports.enrollments.getLastEnrollment(ctx, { studentId: input.studentId, nodeId: input.programNodeId });
  const cycle: CycleResults = await deps.ports.cycleResults.getCycleResults(ctx, { studentId: input.studentId, nodeId: input.programNodeId });
  const issuerName = (await deps.ports.actors.displayName(ctx, issuer)) ?? issuer;

  return inTx<IssuedDocument>(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, "doc-att", `${input.studentId}:${input.programNodeId}`);
    const existing = await repo.findIssuedAttestation(tx, input.studentId, input.programNodeId);
    if (existing) return ok({ document: existing, created: false });

    const today = todayOf(deps);
    const ueIds = ues.map((u) => u.nodeId);
    const entries = (await ledger.listAcquiredForUes(tx, input.studentId, ueIds)).filter((x) => isCurrentlyValid(x, today));
    const byUe = new Map(entries.map((x) => [x.ueNodeId, x]));
    const missing = ues.filter((u) => !byUe.has(u.nodeId));
    if (missing.length > 0) {
      return err(conflict(HigherCode.ATTESTATION_NOT_ELIGIBLE, "Toutes les UE du programme ne sont pas acquises.", { missing: missing.map((u) => ({ ueNodeId: u.nodeId, code: u.code })) }));
    }
    const acquiredDate = lastAcquisitionDate(entries);

    let mention: { code: string; average: string | null } = { code: MENTION_PENDING, average: null };
    if (cycle.complete && cycle.semesters.length > 0) {
      const scope: RuleScope = { curriculumNodeId: input.programNodeId, onDate: today };
      const ev = await deps.ports.rules.evaluateCycle(ctx, { semestres: cycle.semesters.map((s) => ({ moyenne: s.average, credits: s.credits })), scope });
      if (!ev.ok) return ev;
      mention = { code: ev.value.mentionCode, average: ev.value.average };
    }

    const signatories = await resolveSignatories(deps, ctx, tx, "ATTESTATION_SUCCESS", today);
    if (!signatories.ok) return signatories;

    const now = deps.clock.now();
    const year = currentYear(deps);
    const seq = await repo.nextNumber(tx, "ATTESTATION", year);
    const reference = formatAttestationReference(year, seq);
    const snapshot = {
      v: 1,
      schema: "attestation-success/1",
      institution,
      student: { studentId: identity.studentId, fullName: identity.fullName, matricule: identity.matricule, birthDate: identity.birthDate, birthPlace: identity.birthPlace },
      program: { nodeId: input.programNodeId, code: node.code, label: node.label },
      ues: ues.map((u) => ({ code: u.code, label: u.label, credits: (byUe.get(u.nodeId) as { credits: number }).credits })),
      creditsTotal: sumCredits(entries.map((x) => x.credits)),
      mention,
      acquiredDate,
      academicYear: { id: lastEnrollment?.academicYearId ?? null, label: lastEnrollment?.academicYearLabel ?? null },
      reference,
      version: 1,
      issueDate: today,
      signatories: signatories.value,
    };
    const inserted = await insertOrConflict(
      tx,
      (t) =>
        repo.insertDocument(t, {
          id: deps.newId(), tenantId: ctx.tenantId, documentKind: "ATTESTATION_SUCCESS", awardId: null, studentId: input.studentId, programNodeId: input.programNodeId,
          reference, referenceYear: year, referenceSeq: seq, version: 1, supersedesId: null, snapshotSchema: "attestation-success/1", snapshot, snapshotHash: snapshotHash(snapshot),
          verificationCode: deps.newVerificationCode(), issuedAt: now, issuedBy: issuer, issuedByName: issuerName,
        }),
      () => conflict(HigherCode.INVALID_INPUT, "Cette attestation existe déjà."),
    );
    if (!inserted.ok) return inserted;
    const doc = inserted.value;
    const events = new EventBuffer(deps, ctx);
    events.add(HigherEvents.DOCUMENT_ISSUED, { v: 1, documentId: doc.id, kind: doc.documentKind }, { type: "official_document", id: doc.id });
    events.audit({
      action: "higher.document.issued",
      resourceType: "official_document",
      resourceId: doc.id,
      sensitive: true,
      after: { kind: doc.documentKind, reference: doc.reference, snapshotHash: doc.snapshotHash, signatories: Object.fromEntries(Object.entries(signatories.value).map(([k, v]) => [k, v.signatoryId])) },
    });
    await events.flush(tx);
    return ok({ document: doc, created: true });
  });
}

// ---------------------------------------------------------------------------
// Lecture, publication, révocation
// ---------------------------------------------------------------------------

export async function getDocument(deps: HigherDeps, ctx: RequestContext, documentId: Uuid): Promise<Result<OfficialDocument, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const d = await repo.getDocument(tx, documentId);
      return d ? ok(d) : err(notFound(HigherCode.DOCUMENT_NOT_FOUND, "Document", documentId));
    },
    { readOnly: true },
  );
}

export async function listDocuments(
  deps: HigherDeps,
  ctx: RequestContext,
  f: { kind?: DocumentKind | undefined; status?: OfficialDocument["status"] | undefined; studentId?: Uuid | undefined; limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<Result<{ items: OfficialDocument[]; nextCursor: string | null }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listDocuments(tx, f)), { readOnly: true });
}

/** Documents d'un étudiant ; `publishedOnly` pour l'étudiant et son tuteur (AC7.5). */
export async function listStudentDocuments(deps: HigherDeps, ctx: RequestContext, studentId: Uuid, publishedOnly: boolean): Promise<Result<OfficialDocument[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listDocumentsOfStudent(tx, studentId, publishedOnly)), { readOnly: true });
}

/** Rend le document visible de l'étudiant. */
export async function publishDocument(deps: HigherDeps, ctx: RequestContext, documentId: Uuid): Promise<Result<OfficialDocument, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const d = await repo.getDocument(tx, documentId, true);
    if (!d) return err(notFound(HigherCode.DOCUMENT_NOT_FOUND, "Document", documentId));
    if (d.status !== "ISSUED") return err(conflict(HigherCode.DOCUMENT_REVOKED, "Ce document n'est plus valable."));
    const published = await repo.publishDocument(tx, documentId, deps.clock.now());
    if (!published) return err(conflict(HigherCode.DOCUMENT_REVOKED, "Ce document n'est plus valable."));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.document.published", resourceType: "official_document", resourceId: documentId, sensitive: true });
    await events.flush(tx);
    return ok(published);
  });
}

/** Révoque un document (ex. attestation de réussite) ; les documents d'un octroi suivent la révocation de l'octroi. */
export async function revokeDocument(deps: HigherDeps, ctx: RequestContext, input: { documentId: Uuid; reason: string }): Promise<Result<OfficialDocument, AppError>> {
  const reason = input.reason.trim();
  if (reason.length < 10) return err(validation(HigherCode.REVOKE_REASON_REQUIRED, "Le motif de révocation doit faire au moins 10 caractères.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const d = await repo.getDocument(tx, input.documentId, true);
    if (!d) return err(notFound(HigherCode.DOCUMENT_NOT_FOUND, "Document", input.documentId));
    if (d.status === "REVOKED") return err(conflict(HigherCode.DOCUMENT_REVOKED, "Ce document est déjà révoqué."));
    const revoked = await repo.revokeDocument(tx, d.id, reason, deps.clock.now());
    if (!revoked) return err(conflict(HigherCode.DOCUMENT_REVOKED, "Ce document est déjà révoqué."));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.document.revoked", resourceType: "official_document", resourceId: d.id, sensitive: true, reason });
    await events.flush(tx);
    return ok(revoked);
  });
}

/** Scellement et rendu : écrits par `reportcards` (013) après lecture du snapshot. */
export async function recordDocumentSeal(
  deps: HigherDeps,
  ctx: RequestContext,
  input: { documentId: Uuid; signingKeyId: string; signature: string; templateKey?: string | null; templateVersion?: number | null; configVersion?: number | null },
): Promise<Result<OfficialDocument, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const d = await repo.recordSeal(tx, input.documentId, {
      signingKeyId: input.signingKeyId, signature: input.signature, templateKey: input.templateKey ?? null, templateVersion: input.templateVersion ?? null, configVersion: input.configVersion ?? null,
    });
    if (!d) return err(conflict(HigherCode.INVALID_INPUT, "Document introuvable ou déjà scellé."));
    return ok(d);
  });
}

export async function recordDocumentRender(
  deps: HigherDeps,
  ctx: RequestContext,
  input: { documentId: Uuid; status: OfficialDocument["renderStatus"]; objectKey?: string | null; pdfHash?: string | null },
): Promise<Result<OfficialDocument, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const d = await repo.recordRender(tx, input.documentId, { status: input.status, objectKey: input.objectKey ?? null, pdfHash: input.pdfHash ?? null });
    return d ? ok(d) : err(notFound(HigherCode.DOCUMENT_NOT_FOUND, "Document", input.documentId));
  });
}
