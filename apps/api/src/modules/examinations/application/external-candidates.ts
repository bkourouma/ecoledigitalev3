/**
 * CANDIDATS LIBRES (décision métier Q-E15) : une personne inscrite à une session SANS dossier élève de l'établissement.
 * Identité saisie ou importée (nom, prénoms, naissance, sexe), contact, pièce d'identité, tuteur éventuel.
 *
 *  - MINIMISATION : les coordonnées, la pièce d'identité et le tuteur sont dans une table à part (`external_candidate_profiles`),
 *    lue par la permission `exam.external.read` ; le numéro de pièce est masqué sauf demande expresse ; chaque lecture est auditée
 *    (sans valeur). Aucun de ces champs n'apparaît dans un événement, un audit, un journal ni un export par défaut.
 *  - NUMÉROS : numéro interne (`CEPE2027-00001`) du compteur sans trou de la session, partagé avec les élèves ; numéro officiel
 *    importé = identifiant `OFFICIAL_NUMBER` comme pour un élève.
 *  - ÉLIGIBILITÉ : les faits (classe d'examen déclarée, tentatives déclarées) sont FOURNIS PAR SAISIE ; l'âge est calculé de la date de
 *    naissance et de la date de la session. La règle (de démonstration tant qu'aucun texte officiel n'est publié) est inchangée.
 *  - ANONYMISATION : irréversible, motif obligatoire, sensible ; efface profil et identifiants personnels, conserve numéro, résultat, historique.
 *  - Uniquement dans une session OFFICIELLE (garde de la base) ; jamais d'examen blanc.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { ExamCandidateDto, ExamExternalProfileDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import type { CandidateRow, SessionRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as sess from "../infrastructure/sessions-repo";
import { toCandidateDto, toExternalProfileDto } from "./dto";
import { attempt, EventBuffer, inTx, type ExaminationsDeps } from "./deps";

export interface ExternalIdentityInput {
  lastName: string;
  firstName: string;
  birthDate: string;
  birthPlace?: string | null | undefined;
  sex: "F" | "M";
}

export interface ExternalProfileInput {
  contactPhone?: string | null | undefined;
  contactEmail?: string | null | undefined;
  addressLine?: string | null | undefined;
  idPieceKind?: string | null | undefined;
  idPieceNumber?: string | null | undefined;
  guardianName?: string | null | undefined;
  guardianRelation?: string | null | undefined;
  guardianPhone?: string | null | undefined;
  guardianEmail?: string | null | undefined;
  declaredInExamGrade: boolean;
  declaredPriorAttempts: number;
}

export interface CreateExternalInput {
  identity: ExternalIdentityInput;
  profile: ExternalProfileInput;
  trackCode?: string | null | undefined;
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

function toWrite(p: ExternalProfileInput): cand.ProfileWrite {
  return {
    contactPhone: clean(p.contactPhone),
    contactEmail: clean(p.contactEmail)?.toLowerCase() ?? null,
    addressLine: clean(p.addressLine),
    idPieceKind: clean(p.idPieceKind),
    idPieceNumber: clean(p.idPieceNumber),
    guardianName: clean(p.guardianName),
    guardianRelation: clean(p.guardianRelation),
    guardianPhone: clean(p.guardianPhone),
    guardianEmail: clean(p.guardianEmail)?.toLowerCase() ?? null,
    declaredInExamGrade: p.declaredInExamGrade,
    declaredPriorAttempts: p.declaredPriorAttempts,
  };
}

function checkProfile(w: cand.ProfileWrite): AppError | null {
  if (Boolean(w.idPieceKind) !== Boolean(w.idPieceNumber)) return validation(ExamCode.EXTERNAL_PROFILE_INCOMPLETE, "Type et numéro de la pièce d'identité vont ensemble.", "idPieceNumber");
  if (!w.contactPhone && !w.contactEmail && !w.guardianPhone && !w.guardianEmail) return validation(ExamCode.EXTERNAL_PROFILE_INCOMPLETE, "Au moins un moyen de contact (candidat ou tuteur) est requis.", "contactPhone");
  return null;
}

const identityOf = (i: ExternalIdentityInput): { lastName: string; firstName: string; birthDate: string; birthPlace: string | null; sex: "F" | "M" } => ({
  lastName: i.lastName.trim(),
  firstName: i.firstName.trim(),
  birthDate: i.birthDate,
  birthPlace: clean(i.birthPlace),
  sex: i.sex,
});

async function createInTx(deps: ExaminationsDeps, ctx: RequestContext, tx: Tx, session: SessionRow, input: CreateExternalInput, dataSource: "ENTERED" | "IMPORTED"): Promise<Result<CandidateRow, AppError>> {
  if (session.sessionKind !== "OFFICIAL") return err(conflict(ExamCode.EXTERNAL_OFFICIAL_ONLY, "Un candidat libre n'existe que dans une session officielle."));
  const write = toWrite(input.profile);
  const bad = checkProfile(write);
  if (bad) return err(bad);
  if (input.trackCode) {
    const tracks = await sess.listSessionTracks(tx, session.id);
    if (!tracks.some((t) => t.code === input.trackCode)) return err(validation(ExamCode.TRACK_UNKNOWN, `La série « ${input.trackCode} » n'appartient pas à cette session.`, "trackCode"));
  }
  const c = await cand.insertExternalCandidate(tx, ctx.tenantId, {
    id: deps.newId(), sessionId: session.id, institutionId: session.institutionId, trackCode: input.trackCode ?? null, createdBy: ctx.userId, ...identityOf(input.identity),
  });
  await cand.insertExternalProfile(tx, ctx.tenantId, { ...write, id: deps.newId(), sessionId: session.id, candidateId: c.id, dataSource, enteredBy: ctx.userId });
  return ok(c);
}

async function loadSession(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<SessionRow, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const s = await sess.getSession(tx, sessionId);
    return s ? ok(s) : err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
  }, { readOnly: true });
}

/** Saisie d'UN candidat libre (identité + profil restreint). L'audit ne porte ni nom, ni contact, ni pièce. */
export async function createExternalCandidate(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, input: CreateExternalInput): Promise<Result<ExamCandidateDto, AppError>> {
  const session = await loadSession(deps, ctx, sessionId);
  if (!session.ok) return session;
  return inTx(deps, ctx, async (tx) => {
    const c = await createInTx(deps, ctx, tx, session.value, input, "ENTERED");
    if (!c.ok) return c;
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.external_candidate.create", resourceType: "candidate", resourceId: c.value.id, metadata: { sessionId, source: "ENTERED" } });
    await events.flush(tx);
    return ok(toCandidateDto(c.value));
  });
}

export interface ExternalBatchReport {
  created: Array<{ index: number; candidateId: string }>;
  failed: Array<{ index: number; code: string; message: string }>;
}

/** Saisie ou import en lot : un SAVEPOINT par ligne (un refus n'annule pas les autres), une seule entrée d'audit pour le lot. */
export async function createExternalBatch(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, items: readonly CreateExternalInput[], source: "ENTERED" | "IMPORTED"): Promise<Result<ExternalBatchReport, AppError>> {
  if (items.length > deps.config.bulkMaxItems) return err(validation(ExamCode.INVALID_INPUT, `Un lot compte ${deps.config.bulkMaxItems} lignes au plus.`, "items"));
  const session = await loadSession(deps, ctx, sessionId);
  if (!session.ok) return session;
  return inTx(deps, ctx, async (tx) => {
    const report: ExternalBatchReport = { created: [], failed: [] };
    for (const [index, item] of items.entries()) {
      const r = await attempt(tx, (inner) => createInTx(deps, ctx, inner, session.value, item, source));
      if (r.ok) report.created.push({ index, candidateId: r.value.id });
      else report.failed.push({ index, code: r.error.code, message: r.error.message });
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.external_candidate.create_batch", resourceType: "session", resourceId: sessionId, metadata: { source, items: items.length, created: report.created.length, failed: report.failed.length } });
    await events.flush(tx);
    return ok(report);
  });
}

/** Lecture du profil restreint : permission dédiée (garde de la route), lecture AUDITÉE ; le numéro de pièce n'est entier que sur demande expresse (audité aussi). */
export async function getExternalProfile(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string, options: { reveal?: boolean } = {}): Promise<Result<ExamExternalProfileDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId);
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    if (c.candidateKind !== "EXTERNAL") return err(conflict(ExamCode.EXTERNAL_ONLY, "Ce candidat est un élève de l'établissement : il n'a pas de profil de candidat libre."));
    const profile = await cand.getExternalProfile(tx, candidateId);
    if (!profile) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Profil du candidat libre", candidateId));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.external_profile.read", resourceType: "candidate", resourceId: candidateId, sensitive: Boolean(options.reveal), metadata: { sessionId: c.sessionId, revealed: Boolean(options.reveal) } });
    await events.flush(tx);
    return ok(toExternalProfileDto(profile, { reveal: Boolean(options.reveal) }));
  });
}

/** Mise à jour du profil (et de l'identité tant que le candidat n'est pas inscrit : la base fige l'identité à l'inscription). */
export async function updateExternalCandidate(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string, input: { identity?: ExternalIdentityInput | undefined; profile: ExternalProfileInput }): Promise<Result<ExamCandidateDto, AppError>> {
  const write = toWrite(input.profile);
  const bad = checkProfile(write);
  if (bad) return err(bad);
  return inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId, { forUpdate: true });
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    if (c.candidateKind !== "EXTERNAL") return err(conflict(ExamCode.EXTERNAL_ONLY, "Seul un candidat libre a un profil modifiable ici."));
    if (c.anonymizedAt) return err(conflict(ExamCode.CANDIDATE_ANONYMIZED, "Un candidat anonymisé ne change plus."));
    if (c.registrationStatus === "WITHDRAWN") return err(conflict(ExamCode.CANDIDATE_WITHDRAWN, "Un candidat retiré ne change plus."));
    let row: CandidateRow = c;
    if (input.identity) row = (await cand.updateExternalIdentity(tx, candidateId, identityOf(input.identity))) ?? c;
    await cand.updateExternalProfile(tx, candidateId, write);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.external_candidate.update", resourceType: "candidate", resourceId: candidateId, metadata: { sessionId: c.sessionId, identityChanged: Boolean(input.identity) } });
    await events.flush(tx);
    return ok(toCandidateDto(row));
  });
}

/** Droit à l'effacement : irréversible, motif d'au moins 10 caractères, sensible. Le numéro, le résultat et l'historique restent. */
export async function anonymizeExternalCandidate(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string, reason: string): Promise<Result<ExamCandidateDto, AppError>> {
  if (reason.trim().length < 10) return err(validation(ExamCode.INVALID_INPUT, "Le motif d'une anonymisation compte au moins 10 caractères.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId, { forUpdate: true });
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    await cand.anonymizeExternal(tx, candidateId, reason.trim());
    const fresh = (await cand.getCandidate(tx, candidateId)) as CandidateRow;
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.external_candidate.anonymize", resourceType: "candidate", resourceId: candidateId, sensitive: true, reason: reason.trim(), metadata: { sessionId: c.sessionId, hadNumber: c.candidateNumber !== null } });
    await events.flush(tx);
    return ok(toCandidateDto(fresh));
  });
}
