/**
 * Cas d'usage des SESSIONS : création (officielle ou blanche), définition copiée puis figée, cycle de vie, publication.
 *
 *  - La définition d'une session (séries, épreuves, coefficients) est COPIÉE du type puis FIGÉE (`instantiate`) : une session
 *    passée ne change jamais, même si le modèle évolue (R-EXA-03).
 *  - La version de la règle `exam-national@1` applicable est ÉPINGLÉE à la session (`rule_version_ref`) : un changement exige
 *    une nouvelle session. Sans liaison de règle, l'éligibilité automatique et le calcul d'examen blanc sont indisponibles
 *    (saisie manuelle de l'éligibilité avec auteur) ; la session se crée quand même.
 *  - Publier une session officielle publie ses résultats DRAFT dans la même transaction et émet `examinations.result.published`
 *    (issue seule, jamais la moyenne). Une session blanche ne publie jamais d'événement de résultat : un examen blanc n'est pas officiel.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamCreateSessionBody, ExamSessionDetailDto, ExamSessionDto, ExamPage } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExaminationsEvents } from "../domain/events";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { canTransitionSession, SESSION_TRANSITIONS, transitionBlockers } from "../domain/lifecycle";
import type { SessionRow, SessionStatus } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as ref from "../infrastructure/reference-repo";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import { toPaperDto, toSessionDto } from "./dto";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";
import { pinRuleVersion } from "./rule-pin";

const requireActor = (ctx: RequestContext): Result<string, AppError> =>
  ctx.userId ? ok(ctx.userId) : err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));

export async function listSessions(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  filter: { status?: SessionStatus | undefined; sessionKind?: string | undefined; examTypeId?: string | undefined; institutionId?: string | undefined; sessionYear?: number | undefined; page: number; pageSize: number },
): Promise<Result<ExamPage<ExamSessionDto>, AppError>> {
  const pageSize = Math.min(filter.pageSize, deps.config.pageSizeMax);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const { items, total } = await sess.listSessions(tx, { ...filter, pageSize });
      const types = new Map((await ref.listTypes(tx)).map((t) => [t.id, t]));
      return ok({
        items: items.map((s) => toSessionDto(s, types.get(s.examTypeId) ?? { code: "?", label: "?", sourceKind: "institution" })),
        total,
        page: filter.page,
        pageSize,
      });
    },
    { readOnly: true },
  );
}

/** Origine (fictive ou non) de la version de règle épinglée, si le fournisseur la connaît ; jamais bloquant. */
async function pinIsPlaceholder(deps: ExaminationsDeps, ctx: RequestContext, ruleVersionRef: string | null): Promise<boolean> {
  if (!ruleVersionRef) return false;
  try {
    const opened = await deps.ports.rules.open(ctx, ruleVersionRef);
    return opened.ok && opened.value.pin.sourceKind === "placeholder";
  } catch {
    return false;
  }
}

export async function getSessionDetail(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<ExamSessionDetailDto, AppError>> {
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const s = await sess.getSession(tx, id);
      if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", id));
      const type = await ref.getType(tx, s.examTypeId);
      const counts = await sess.sessionCounts(tx, id);
      return ok({ s, type, tracks: await sess.listSessionTracks(tx, id), papers: await sess.listSessionPapers(tx, id), counts });
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const { s, type, tracks, papers, counts } = loaded.value;
  const demoPin = await pinIsPlaceholder(deps, ctx, s.ruleVersionRef);
  const facts = { definitionLocked: s.definitionLockedAt !== null, registeredCount: counts.registered, withoutResultCount: Math.max(0, counts.registered - counts.withResult), unassignedCount: Math.max(0, counts.registered - counts.assigned) };
  const blockers: Partial<Record<SessionStatus, string[]>> = {};
  for (const to of SESSION_TRANSITIONS[s.status]) {
    const b = transitionBlockers(to, facts);
    if (b.length > 0) blockers[to] = b;
  }
  const dto = toSessionDto(s, type ?? { code: "?", label: "?", sourceKind: "institution" }, { demoRulePin: demoPin });
  return ok({
    ...dto,
    tracks: tracks.map((t) => ({ id: t.id, code: t.code, label: t.label })),
    papers: papers.map((p) => {
      const d = toPaperDto({ ...p, examTypeId: s.examTypeId, active: true });
      return { id: p.id, trackCode: d.trackCode, code: d.code, label: d.label, coefficient: d.coefficient, scaleMax: d.scaleMax, isOptional: d.isOptional, ordinal: d.ordinal, sourceKind: d.sourceKind };
    }),
    counts,
    blockers,
  });
}

export async function createSession(deps: ExaminationsDeps, ctx: RequestContext, body: ExamCreateSessionBody): Promise<Result<ExamSessionDto, AppError>> {
  const actor = requireActor(ctx);
  if (!actor.ok) return actor;
  // Lecture hors transaction d'écriture : un port d'un autre module n'est jamais appelé pendant qu'on détient un verrou.
  const inst = await deps.ports.institutions.exists(ctx, body.institutionId);
  if (!inst) return err(validation(ExamCode.INVALID_INPUT, "L'établissement désigné est inconnu.", "institutionId"));
  const typeProbe = await inTx(deps, ctx, async (tx) => {
    const t = await ref.getType(tx, body.examTypeId);
    return t ? ok(t) : err(notFound(ExamCode.TYPE_NOT_FOUND, "Type d'examen", body.examTypeId));
  }, { readOnly: true });
  if (!typeProbe.ok) return typeProbe;
  const type = typeProbe.value;
  if (type.status !== "ACTIVE") return err(conflict(ExamCode.TYPE_ARCHIVED, "Ce type d'examen est archivé : aucune nouvelle session."));
  const referenceDate = body.startsOn ?? body.registrationOpensOn ?? `${body.sessionYear}-01-01`;
  const pin = await pinRuleVersion(deps, ctx, { contractId: type.resultContractId, institutionId: body.institutionId, levelCode: type.gradeLevelCode, date: referenceDate });
  return inTx(deps, ctx, async (tx) => {
    const s = await sess.insertSession(tx, ctx.tenantId, {
      id: deps.newId(), examTypeId: type.id, institutionId: body.institutionId, academicYearId: body.academicYearId ?? null, code: body.code, label: body.label, sessionKind: body.sessionKind,
      attemptKind: body.attemptKind, sessionYear: body.sessionYear, mockOfSessionId: body.mockOfSessionId ?? null, registrationOpensOn: body.registrationOpensOn ?? null,
      registrationClosesOn: body.registrationClosesOn ?? null, startsOn: body.startsOn ?? null, endsOn: body.endsOn ?? null, ruleVersionRef: pin?.ruleVersionId ?? null,
      // Une session d'un type fictif est fictive : l'origine suit celle du type (jamais « réglementaire » par défaut).
      sourceKind: body.sourceKind ?? (type.sourceKind === "placeholder" ? "placeholder" : "institution"),
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.session.create", resourceType: "session", resourceId: s.id, after: { code: s.code, kind: s.sessionKind, year: s.sessionYear, ruleVersionRef: s.ruleVersionRef } });
    await events.flush(tx);
    return ok(toSessionDto(s, type, { demoRulePin: pin?.sourceKind === "placeholder" }));
  });
}

export async function updateSession(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  id: string,
  patch: { label?: string; academicYearId?: string | null; attemptKind?: "NORMAL" | "MAKEUP"; registrationOpensOn?: string | null; registrationClosesOn?: string | null; startsOn?: string | null; endsOn?: string | null },
): Promise<Result<ExamSessionDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const s = await sess.updateSession(tx, id, patch);
    if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", id));
    const type = await ref.getType(tx, s.examTypeId);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.session.update", resourceType: "session", resourceId: id, after: { fields: Object.keys(patch) } });
    await events.flush(tx);
    return ok(toSessionDto(s, type ?? { code: "?", label: "?", sourceKind: "institution" }));
  });
}

/** Copie séries et épreuves ACTIVES du type dans la session puis la fige. Épingle la règle si elle ne l'est pas encore. */
export async function instantiateSession(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<{ session: ExamSessionDto; paperCount: number }, AppError>> {
  const probe = await inTx(deps, ctx, async (tx) => {
    const s = await sess.getSession(tx, id);
    if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", id));
    const type = await ref.getType(tx, s.examTypeId);
    return ok({ s, type });
  }, { readOnly: true });
  if (!probe.ok) return probe;
  const { s: before, type } = probe.value;
  const pin = before.ruleVersionRef ? null : await pinRuleVersion(deps, ctx, { contractId: type?.resultContractId ?? "exam-national@1", institutionId: before.institutionId, levelCode: type?.gradeLevelCode ?? null, date: before.startsOn ?? before.registrationOpensOn ?? `${before.sessionYear}-01-01` });
  return inTx(deps, ctx, async (tx) => {
    const s = await sess.getSession(tx, id, { forUpdate: true });
    if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", id));
    if (pin && !s.ruleVersionRef) await sess.updateSession(tx, id, { ruleVersionRef: pin.ruleVersionId });
    const n = await sess.instantiateDefinition(tx, id);
    const fresh = (await sess.getSession(tx, id)) as SessionRow;
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.session.instantiate", resourceType: "session", resourceId: id, after: { papers: n, ruleVersionRef: fresh.ruleVersionRef } });
    await events.flush(tx);
    return ok({ session: toSessionDto(fresh, type ?? { code: "?", label: "?", sourceKind: "institution" }, { demoRulePin: pin?.sourceKind === "placeholder" }), paperCount: n });
  });
}

/** Passe la session à l'état `to`. `PUBLISHED` publie aussi les résultats (sensible : permission contrôlée par la route). */
export async function transitionSession(deps: ExaminationsDeps, ctx: RequestContext, id: string, to: SessionStatus): Promise<Result<ExamSessionDto, AppError>> {
  const actor = requireActor(ctx);
  if (!actor.ok) return actor;
  return inTx(deps, ctx, async (tx) => {
    const s = await sess.getSession(tx, id, { forUpdate: true });
    if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", id));
    const type = await ref.getType(tx, s.examTypeId);
    if (!canTransitionSession(s.status, to)) {
      return err(conflict(ExamCode.SESSION_TRANSITION, `Passage de « ${s.status} » à « ${to} » interdit.`, { from: s.status, to, allowed: SESSION_TRANSITIONS[s.status] }));
    }
    const counts = await sess.sessionCounts(tx, id);
    const blockers = transitionBlockers(to, { definitionLocked: s.definitionLockedAt !== null, registeredCount: counts.registered, withoutResultCount: Math.max(0, counts.registered - counts.withResult), unassignedCount: Math.max(0, counts.registered - counts.assigned) });
    if (blockers.length > 0) {
      const code = to === "PUBLISHED" ? ExamCode.RESULTS_INCOMPLETE : ExamCode.DEFINITION_NOT_LOCKED;
      return err(conflict(code, blockers.join(" "), { blockers }));
    }
    const events = new EventBuffer(deps, ctx);
    let publishedCount = 0;
    if (to === "PUBLISHED") {
      // Publication des résultats : étape distincte du saisi, faite ici dans la même transaction que le passage d'état.
      const published = await res.publishAllDraft(tx, id, actor.value);
      const students = new Map<string, { studentId: string | null; candidateKind: "STUDENT" | "EXTERNAL" }>();
      for (let i = 0; i < published.length; i += 500) {
        for (const c of await cand.listCandidatesByIds(tx, published.slice(i, i + 500).map((r) => r.candidateId))) students.set(c.id, { studentId: c.studentId, candidateKind: c.candidateKind });
      }
      publishedCount = (await sess.sessionCounts(tx, id)).published;
      if (s.sessionKind === "OFFICIAL") {
        for (const r of published) {
          events.add(
            ExaminationsEvents.RESULT_PUBLISHED,
            { v: 1, sessionId: id, candidateId: r.candidateId, studentId: students.get(r.candidateId)?.studentId ?? null, candidateKind: students.get(r.candidateId)?.candidateKind ?? "STUDENT", institutionId: s.institutionId, examTypeCode: type?.code ?? "", sessionYear: s.sessionYear, outcome: r.resultCode },
            { type: "examinations.result", id: r.id },
          );
        }
      }
    }
    const updated = (await sess.setSessionStatus(tx, id, to)) as SessionRow;
    const base = { v: 1 as const, sessionId: id, institutionId: s.institutionId, examTypeCode: type?.code ?? "" };
    if (to === "REGISTRATION_OPEN") events.add(ExaminationsEvents.SESSION_OPENED, base, { type: "examinations.session", id });
    if (to === "REGISTRATION_CLOSED") events.add(ExaminationsEvents.SESSION_REGISTRATION_CLOSED, { ...base, registeredCount: counts.registered }, { type: "examinations.session", id });
    if (to === "PUBLISHED") events.add(ExaminationsEvents.SESSION_RESULTS_PUBLISHED, { ...base, sessionKind: s.sessionKind, publishedCount }, { type: "examinations.session", id });
    if (to === "ARCHIVED") events.add(ExaminationsEvents.SESSION_ARCHIVED, base, { type: "examinations.session", id });
    events.audit({
      action: to === "PUBLISHED" ? "examinations.session.publish" : "examinations.session.transition",
      resourceType: "session",
      resourceId: id,
      sensitive: to === "PUBLISHED",
      before: { status: s.status },
      after: { status: to },
      metadata: { kind: s.sessionKind, ...(to === "PUBLISHED" ? { published: publishedCount } : {}) },
    });
    await events.flush(tx);
    return ok(toSessionDto(updated, type ?? { code: "?", label: "?", sourceKind: "institution" }));
  });
}
